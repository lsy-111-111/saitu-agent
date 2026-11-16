#!/usr/bin/env node
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, open, symlink, unlink, access } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import nextEnv from '@next/env';
import pg from 'pg';
import { ROOT, PREVIEW_ROOT, json, writeJson, requireValue, verifyBuild, buildPreview, policyEnvironment } from './local-preview-build.mjs';
import { LOCAL_PREVIEW_AUTHORIZATION_POLICY, LOCAL_PREVIEW_ORIGIN } from '../../../src/lib/ai/execution-policy.mjs';

const exec = promisify(execFile), pointer = path.join(PREVIEW_ROOT, 'current.json');
const preload = path.join(ROOT, 'scripts/competitions/v7/local-preview-env.mjs');
const budgetTool = 'scripts/competitions/v6/development-budget.mjs';
const stamp = () => `${Date.now()}`;
const exists = filename => access(filename).then(() => true, () => false);
async function database(callback) {
  nextEnv.loadEnvConfig(ROOT, false, { info() {}, error() {} });
  const url = new URL(process.env.DATABASE_URL || '');
  requireValue(url.hostname === '127.0.0.1' && url.port === '5432' && url.pathname === '/saitu_upgrade', 'existing_local_database_required');
  const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 3000 });
  await client.connect();
  try { return await callback(client); } finally { await client.end(); }
}
async function ensureLocalDatabase() {
  try { await database(client => client.query('select 1')); return; }
  catch (error) {
    // Only a stopped listener permits startup. Bad credentials, wrong endpoints
    // and other database failures remain errors; existing data is never reset.
    if (error?.code !== 'ECONNREFUSED') throw error;
  }
  const data = path.join(ROOT, 'tmp/postgres/data');
  const binary = path.join(ROOT, 'tmp/postgres/runtime/bin/pg_ctl');
  await access(path.join(data, 'PG_VERSION')); await access(binary);
  await mkdir(PREVIEW_ROOT, { recursive: true, mode: 0o700 });
  await exec(binary, ['-D', data, '-l', path.join(PREVIEW_ROOT, 'postgres-start.log'), '-o', '-h 127.0.0.1 -p 5432', '-w', '-t', '30', 'start'], { cwd: ROOT, timeout: 35000 });
  await database(client => client.query('select 1'));
}
async function operator(command, extra = []) {
  const output = path.join(ROOT, 'artifacts/compact-20261110/budget', `local-preview-${command}-${stamp()}`);
  await exec(process.execPath, [budgetTool, command, '--output', output, '--execution-mode', 'user-unbounded', '--v7-policy', LOCAL_PREVIEW_AUTHORIZATION_POLICY, ...extra], { cwd: ROOT, maxBuffer: 2 * 1024 * 1024 });
  return output;
}
async function current() { return await exists(pointer) ? json((await json(pointer)).configPath) : null; }
async function grant(config) {
  return database(async client => (await client.query('select state,authorized_phase,effort_condition from ai_spend_development_batches where run_id=$1', [config.runId])).rows[0]);
}
async function identity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try { return (await exec('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command='])).stdout.trim() || null; } catch { return null; }
}
async function processMatches(record) { return Boolean(record?.pid && record.identity && await identity(record.pid) === record.identity); }
async function readProcesses(config) { return await exists(path.join(config.runtimeDirectory, 'processes.json')) ? json(path.join(config.runtimeDirectory, 'processes.json')) : {}; }
async function status(config) {
  if (!config) return { running: false, prepared: false, origin: LOCAL_PREVIEW_ORIGIN };
  const processes = await readProcesses(config), health = await json(path.join(config.runtimeDirectory, 'worker-health.json')).catch(() => null);
  const web = await processMatches(processes.web), worker = await processMatches(processes.worker), batch = await grant(config);
  const accounting = await database(async client => (await client.query(`select count(*)::int as calls,count(*) filter(where state='reserved')::int as pending,
    coalesce(sum(coalesce(charged_micros,reserved_micros)),0)::text as accounted_micros from ai_spend_ledger where run_id=$1`, [config.runId])).rows[0]);
  return { version: config.build.version, origin: config.origin, prepared: true, running: Boolean(web && worker && batch?.state === 'active' && health?.status === 'active' && health.databaseReady && Date.now() - Date.parse(health.updatedAt) < 10000), web, worker, batchState: batch?.state, workerState: health?.status, databaseReady: health?.databaseReady, sourceSha256: config.build.sourceSha256, nextBuildId: config.build.nextBuildId, runId: config.runId, accounting, runtimeDirectory: config.runtimeDirectory, formalAcceptanceCredit: false };
}
async function prepare() {
  const build = await json(path.join(PREVIEW_ROOT, 'build.json')), manifest = await verifyBuild(build);
  const prior = await current();
  if (prior && (await grant(prior))?.state === 'active') {
    requireValue(prior.build.sourceSha256 === build.sourceSha256 && prior.build.nextBuildId === build.nextBuildId, 'active_preview_must_be_stopped_and_closed_before_new_build');
    return prior;
  }
  const rows = await database(async client => (await client.query('select run_id,state from ai_spend_development_batches')).rows);
  requireValue(!rows.some(row => row.state === 'active'), 'another_batch_is_active');
  const used = new Set(rows.map(row => row.run_id));
  const runId = Array.from({ length: 99 }, (_, i) => `saitu-v7-top5-unbounded-20261109-reserve-${String(i + 1).padStart(2, '0')}`).find(value => !used.has(value));
  requireValue(runId, 'preview_run_ids_exhausted');
  const runtimeDirectory = path.join(PREVIEW_ROOT, 'runs', `${build.version}-${stamp()}`);
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  await symlink(ROOT, path.join(runtimeDirectory, 'current'));
  const pinsFile = path.join(runtimeDirectory, 'pins.json');
  await exec(process.execPath, ['tests/e2e/v7-public-browser.mjs', '--pins', '--output', pinsFile], { cwd: ROOT, env: { ...process.env, ...policyEnvironment, AI_PROVIDER: 'deepseek', AI_MODEL: 'deepseek-flash', AI_API_KEY: '', DATABASE_URL: '' }, maxBuffer: 1024 * 1024 });
  const pins = await json(pinsFile);
  requireValue(pins.runtimeSourceBindingSha256 === build.sourceSha256, 'preview_pins_source_changed');
  const binding = { schemaVersion: 'saitu.local-preview.binding.v1', applicationRuntimeSourceSha256: build.sourceSha256,
    candidatePoolSha256: pins.candidatePoolSha256, productionBuildId: build.nextBuildId, workerArtifactSha256: manifest.artifactSha256, nextBindingSha256: manifest.nextBindingSha256, origin: LOCAL_PREVIEW_ORIGIN };
  const bindingFile = path.join(runtimeDirectory, 'binding.json'), effortFile = path.join(runtimeDirectory, 'effort.json');
  await writeJson(bindingFile, binding, true); await writeJson(effortFile, manifest.effortPolicy, true);
  await operator('install');
  const budgetDirectory = await operator('open', ['--run-id', runId, '--phase', 'reserve', '--effort-policy', effortFile, '--local-preview', bindingFile]);
  const config = { schemaVersion: 'saitu.local-preview.runtime.v1', runPurpose: 'local_preview', origin: LOCAL_PREVIEW_ORIGIN, build, runId, runtimeDirectory, budgetDirectory, binding, createdAt: new Date().toISOString(), formalAcceptanceCredit: false };
  const configPath = path.join(runtimeDirectory, 'config.json');
  await writeJson(configPath, config, true); await writeJson(pointer, { configPath });
  return config;
}
async function ensurePortFree() {
  await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', () => reject(new Error('port_3177_occupied')));
    server.listen(3177, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve()));
  });
}
async function launch(config, name, args) {
  const handle = await open(path.join(config.runtimeDirectory, `${name}.log`), 'a', 0o600);
  try {
    const child = spawn(process.execPath, ['--import', preload, ...args], { cwd: ROOT, detached: true,
      env: { ...process.env, SAITU_LOCAL_PREVIEW_CONFIG: path.join(config.runtimeDirectory, 'config.json'), NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', handle.fd, handle.fd] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
    return { pid: child.pid, identity: await identity(child.pid) };
  } finally { await handle.close(); }
}
async function start(config) {
  await verifyBuild(config.build); requireValue((await grant(config))?.state === 'active', 'preview_grant_closed_prepare_new_run');
  const previous = await status(config);
  if (previous.running) return previous;
  requireValue(!previous.web && !previous.worker, 'partial_preview_running_use_stop_before_resume');
  await ensurePortFree();
  if (!await exists(path.join(config.runtimeDirectory, 'current'))) await symlink(ROOT, path.join(config.runtimeDirectory, 'current'));
  const processes = { worker: await launch(config, 'worker', [path.join(config.build.workerDirectory, 'worker.mjs')]) };
  await writeJson(path.join(config.runtimeDirectory, 'processes.json'), processes);
  processes.web = await launch(config, 'web', ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3177']);
  await writeJson(path.join(config.runtimeDirectory, 'processes.json'), processes);
  for (let attempt = 0; attempt < 90; attempt++) {
    const health = await json(path.join(config.runtimeDirectory, 'worker-health.json')).catch(() => null);
    const response = await fetch(`${config.origin}/competitions/recommend`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (response?.status === 200 && health?.pid === processes.worker.pid && health.status === 'active' && health.databaseReady && health.sourceSha256 === config.build.sourceSha256 && Date.now() - Date.parse(health.updatedAt) < 10000) {
      processes.web.identity = await identity(processes.web.pid); processes.worker.identity = await identity(processes.worker.pid);
      requireValue(processes.web.identity && processes.worker.identity, 'preview_process_exited');
      await writeJson(path.join(config.runtimeDirectory, 'processes.json'), processes);
      return status(config);
    }
    await delay(1000);
  }
  // Refresh exact identities even on a partial startup, enabling a safe stop.
  for (const record of Object.values(processes)) record.identity = await identity(record.pid);
  await writeJson(path.join(config.runtimeDirectory, 'processes.json'), processes);
  throw new Error(`preview_start_timeout_inspect_${config.runtimeDirectory}`);
}
async function stop(config, close = false) {
  if (!config) return { stopped: true, prepared: false };
  const processes = await readProcesses(config);
  if (await processMatches(processes.web)) process.kill(processes.web.pid, 'SIGTERM');
  // Let accepted jobs settle. No force kill and no automatic redispatch.
  for (let attempt = 0; attempt < 170; attempt++) {
    const pending = await database(async client => Number((await client.query("select count(*) as n from ai_spend_ledger where run_id=$1 and state='reserved'", [config.runId])).rows[0].n));
    const health = await json(path.join(config.runtimeDirectory, 'worker-health.json')).catch(() => null);
    if (!pending && (!await processMatches(processes.worker) || health?.inFlight === 0) && !await processMatches(processes.web)) break;
    if (attempt === 169) throw new Error('preview_drain_pending_services_preserved');
    await delay(1000);
  }
  await unlink(path.join(config.runtimeDirectory, 'current')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (await processMatches(processes.worker)) process.kill(processes.worker.pid, 'SIGTERM');
  for (let i = 0; i < 15 && await processMatches(processes.worker); i++) await delay(1000);
  requireValue(!await processMatches(processes.worker), 'preview_worker_still_draining');
  if (close && (await grant(config))?.state === 'active') await operator('close', ['--run-id', config.runId]);
  return { stopped: true, grantClosed: close, runId: config.runId, recordsPreserved: true };
}
async function main() {
  requireValue(process.cwd() === ROOT && Number(process.versions.node.split('.')[0]) === 24, 'repository_node24_required');
  const [command = 'status', version, ...extra] = process.argv.slice(2);
  requireValue(!extra.length && (!version || command === 'build'), 'usage_local_preview_build_start_stop_status_resume_close');
  let result;
  if (command === 'build') result = await buildPreview(version);
  else if (command === 'start' || command === 'resume') { await ensureLocalDatabase(); result = await start(await prepare()); }
  else if (command === 'status') result = await status(await current());
  else if (command === 'stop' || command === 'close') result = await stop(await current(), command === 'close');
  else throw new Error('usage_local_preview_build_start_stop_status_resume_close');
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => {
  // Never serialize database URLs, provider secrets or child-process environment.
  let message = error instanceof Error ? error.message : 'local_preview_failed';
  for (const secret of [process.env.AI_API_KEY, process.env.DATABASE_URL, process.env.AI_CONVERSATION_SIGNING_SECRET].filter(Boolean)) message = message.split(secret).join('[REDACTED]');
  console.error(message.slice(0, 1600)); process.exitCode = 1;
});
