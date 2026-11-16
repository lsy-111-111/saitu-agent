#!/usr/bin/env node
// Explicit local-only integration gate; no provider calls or production writes.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, symlink, rename, lstat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { cleanupSecurityState } from '../../scripts/cleanup-security-state.mjs';
import { installSourceLoader } from '../../scripts/lib/load-typescript-source.mjs';
import { loadProductionEcosystem, pm2EntriesFromEcosystem, productionGrantEnvironment, renderEnvironment } from '../helpers/v7-production-environment.mjs';

const root = process.cwd();
const suffix = randomBytes(5).toString('hex');
const database = `saitu_v7_ops_${suffix}`, runtime = `${database}_runtime`, maintenance = `${database}_maint`;
const peerWorkerAdmin = process.env.SAITU_V7_OPS_PEER_WORKER_ADMIN === '1';
const suppliedAdmin = process.env.V7_TEST_ADMIN_DATABASE_URL?.trim();
let isolatedAdmin;
if (suppliedAdmin) {
  try { isolatedAdmin = new URL(suppliedAdmin); } catch { throw new Error('native_v7_isolated_admin_invalid'); }
  if (process.env.RUN_V7_DATABASE_TESTS !== '1' || !['postgres:', 'postgresql:'].includes(isolatedAdmin.protocol)
    || isolatedAdmin.hostname !== '127.0.0.1' || (isolatedAdmin.port && isolatedAdmin.port !== '5432')
    || isolatedAdmin.search || isolatedAdmin.hash || isolatedAdmin.username !== 'postgres'
    || !/^\/resume_ai_test_[a-f0-9]{16}$/.test(isolatedAdmin.pathname)) throw new Error('native_v7_coordinator_namespace_required');
}
const password = peerWorkerAdmin || isolatedAdmin ? '' : await readFile(path.join(root, 'tmp/postgres/private/admin-password'), 'utf8');
const localRoot = process.env.SAITU_V7_OPS_WORK_ROOT || path.join(root, 'tmp/v7-operations', suffix);
if (process.env.SAITU_V7_OPS_WORK_ROOT) {
  const metadata = await lstat(localRoot);
  if (!/^\/tmp\/saitu-v7-native-[A-Za-z0-9]+$/.test(localRoot) || !metadata.isDirectory() || metadata.isSymbolicLink()
    || metadata.uid !== process.getuid() || (metadata.mode & 0o077) !== 0) throw new Error('native_v7_private_scratch_required');
}
const socket = path.join(localRoot, 'socket'), data = path.join(localRoot, 'data');
const binaries = process.env.SAITU_V7_OPS_PG_BIN || path.join(root, 'tmp/postgres/runtime/bin');
const config = { host: socket, port: 55449, user: 'v7_ops_admin' };
const workerConfig = isolatedAdmin ? { host: isolatedAdmin.hostname, port: 5432, user: decodeURIComponent(isolatedAdmin.username), password: decodeURIComponent(isolatedAdmin.password) }
  : peerWorkerAdmin ? { host: '/var/run/postgresql', port: 5432, user: 'postgres' } : { host: '127.0.0.1', port: 5432, user: 'saitu_upgrade_admin', password };
const workerPassword = randomBytes(32).toString('hex');
const admin = new pg.Client({ ...config, database: 'postgres' });
const workerAdmin = new pg.Client({ ...workerConfig, database: isolatedAdmin ? isolatedAdmin.pathname.slice(1) : 'postgres' });
const observations = [];
let client, worker, workerExit, workerError = '', clusterStarted = false, workerDatabaseCreated = false, workerRoleCreated = false;
let productionGrantChain;
function passed(name) { observations.push(name); console.info(`PASS ${name}`); }
async function command(executable, args) {
  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (bytes) => { output += bytes; }); child.stderr.on('data', (bytes) => { output += bytes; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0, output); return output;
}

// Evaluate the actual psql condition/gset protocol without rewriting the SQL
// contracts. Queries still execute in a real READ ONLY PostgreSQL transaction.
async function runPsqlSql(connection, source) {
  const variables = { expected_session: config.user }, conditions = [];
  let pending = '';
  const enabled = () => conditions.every((condition) => condition);
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('\\if ')) {
      const expression = line.slice(4);
      const value = expression.startsWith(':{?') ? Object.hasOwn(variables, expression.slice(3, -1)) : variables[expression.replace(/^:/u, '')];
      conditions.push(enabled() && [true, 'true', 't', 'on', 1, '1'].includes(value)); continue;
    }
    if (line === '\\else') { const previous = conditions.pop(); conditions.push(conditions.every(Boolean) && !previous); continue; }
    if (line === '\\endif') { conditions.pop(); continue; }
    if (!enabled() || !line || line.startsWith('--') || line.startsWith('\\echo')) continue;
    if (line.startsWith('\\set ')) { const [, name, value] = line.split(/\s+/u); variables[name] = value; continue; }
    const isGset = /\\gset$/u.test(line);
    pending += `${raw.replace(/\s*\\gset$/u, '').replaceAll(":'expected_session'", `'${config.user}'`)}\n`;
    if (isGset || /;\s*$/u.test(line)) {
      const result = await connection.query(pending); pending = '';
      if (isGset) Object.assign(variables, result.rows[0]);
    }
  }
  if (pending.trim()) await connection.query(pending);
  return variables;
}
async function readonlyContract() {
  // The production session contract requires a local Unix socket, not TCP.
  const verifier = new pg.Client({ ...config, database, options: '-c default_transaction_read_only=on' });
  await verifier.connect();
  try { await runPsqlSql(verifier, await readFile('ops/postgresql/verify-production-database-readonly.sql', 'utf8')); }
  finally { await verifier.end(); }
}
async function seedExpired(label) {
  const state = randomBytes(32).toString('hex'), run = randomUUID();
  await client.query("insert into competition_decision_states(state_key,ciphertext,iv,tag,expires_at) values($1,$2,$3,$4,now()-interval '1 hour')", [state, Buffer.from('encrypted'), Buffer.alloc(12), Buffer.alloc(16)]);
  await client.query("insert into competition_decision_runs(run_id,state_key,submission_key,implementation_version,status,ciphertext,iv,tag,submitted_at,list_deadline_at,detail_deadline_at,expires_at) values($1,$2,$3,'fixture-never-dispatched','ready',$4,$5,$6,now()-interval '3 hour',now()-interval '179 minute',now()-interval '178 minute',now()-interval '1 hour')", [run, state, randomBytes(32).toString('hex'), Buffer.from('encrypted'), Buffer.alloc(12), Buffer.alloc(16)]);
  await client.query("insert into competition_decision_calls(call_id,run_id,call_key,prompt_sha256,state) select gen_random_uuid(),$1,$2||n::text,repeat('a',64),'unknown' from generate_series(1,1201) n", [run, label]);
  await client.query("insert into competition_decision_chat_requests(run_id,request_id,request_sha256,ciphertext,iv,tag) values($1,$2,repeat('b',64),$3,$4,$5)", [run, label, Buffer.from('encrypted'), Buffer.alloc(12), Buffer.alloc(16)]);
}
async function waitHealth(status, healthFile) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (workerExit !== undefined) throw new Error(`worker_exited_before_health: ${workerError}`);
    try {
      const value = JSON.parse(await readFile(healthFile, 'utf8'));
      if (value.status === status && value.databaseReady === true && value.pid === worker.pid) return value;
    } catch { /* A heartbeat rename may not have happened yet. */ }
    await delay(100);
  }
  throw new Error(`worker_health_timeout_${status}`);
}

try {
  await mkdir(socket, { recursive: true, mode: 0o700 });
  await command(path.join(binaries, 'initdb'), ['-D', data, '--username=v7_ops_admin', '--encoding=UTF8', '--locale=C', '--auth=trust']);
  await command(path.join(binaries, 'pg_ctl'), ['-D', data, '-l', path.join(localRoot, 'server.log'), '-o', `-c listen_addresses='' -k '${socket}' -p 55449`, '-w', 'start']);
  clusterStarted = true;
  await admin.connect();
  await admin.query(`create database ${database}`);
  await admin.query(`create role ${runtime} login nosuperuser nocreatedb nocreaterole noinherit password '${randomBytes(32).toString('hex')}'`);
  await admin.query(`create role ${maintenance} nologin nosuperuser nocreatedb nocreaterole noinherit`);
  client = new pg.Client({ ...config, database }); await client.connect();
  await client.query(await readFile('db/schema.sql', 'utf8'));
  for (const row of (await readFile('ops/config/migrations.manifest', 'utf8')).split('\n')) {
    if (!row || row.startsWith('#')) continue;
    const [, name] = row.split(/\s+/u); await client.query(await readFile(path.join('db/migrations', name), 'utf8'));
  }
  // PostgreSQL 14 grants CREATE on public by default; production's runtime
  // provisioner removes that inherited DDL and database TEMP privilege.
  await client.query('revoke create on schema public from public');
  await client.query(`revoke create,temporary on database ${database} from public`);
  await client.query(`grant usage on schema public to ${runtime},${maintenance}`);
  for (const row of (await readFile('ops/postgresql/runtime-table-privileges.conf', 'utf8')).split('\n')) {
    if (!row || row.startsWith('#')) continue;
    const [table, privileges] = row.split('='); assert.match(table, /^[a-z_]+$/u); assert.match(privileges, /^(SELECT|INSERT|UPDATE)(,(SELECT|INSERT|UPDATE))*$/u);
    await client.query(`grant ${privileges} on ${table} to ${runtime}`);
  }
  const retention = { competition_decision_chat_requests: 'run_id', competition_decision_calls: 'run_id', competition_decision_runs: 'expires_at', competition_decision_states: 'expires_at', competition_idempotency: 'expires_at', competition_session_transitions: 'expires_at', competition_session_starts: 'expires_at', competition_sessions: 'expires_at', competition_rate_limit_counters: 'reset_at', ai_model_call_leases: 'expires_at', ai_model_call_waiters: 'expires_at', ai_consents: 'created_at' };
  for (const [table, column] of Object.entries(retention)) {
    await client.query(`grant select,delete on ${table} to ${maintenance}`);
    await client.query(`grant update(${column}) on ${table} to ${maintenance}`);
  }
  for (const table of ['competition_decision_runs', 'competition_decision_calls', 'competition_decision_chat_requests']) {
    const result = await client.query("select (has_table_privilege($1,$2,'SELECT') and has_table_privilege($1,$2,'INSERT') and has_table_privilege($1,$2,'UPDATE')) as dml,has_table_privilege($1,$2,'DELETE') as deletion,has_table_privilege($1,$2,'TRUNCATE') as truncation", [runtime, table]);
    assert.deepEqual(result.rows[0], { dml: true, deletion: false, truncation: false });
  }
  await client.query(`set role ${runtime}`);
  await assert.rejects(client.query('create table forbidden_runtime_ddl(id int)'), { code: '42501' });
  await assert.rejects(client.query('create temporary table forbidden_runtime_temp(id int)'), { code: '42501' });
  await client.query('reset role');
  passed('runtime has v7 S/I/U without DELETE/TRUNCATE/DDL');
  await readonlyContract(); passed('actual read-only SQL accepts the complete migrated schema');
  for (const [name, mutate, restore] of [
    ['plaintext', 'alter table competition_decision_runs add column harmless_notes text', 'alter table competition_decision_runs drop column harmless_notes'],
    ['lost-call-parent', 'alter table competition_decision_calls drop constraint competition_decision_calls_run_id_fkey', 'alter table competition_decision_calls add foreign key(run_id) references competition_decision_runs(run_id)'],
    ['lost-idempotency', 'alter table competition_decision_calls drop constraint competition_decision_calls_run_id_call_key_key', 'alter table competition_decision_calls add unique(run_id,call_key)'],
    ['lost-cipher-cap', 'alter table competition_decision_runs drop constraint competition_decision_runs_ciphertext_check', 'alter table competition_decision_runs add check(octet_length(ciphertext)<=8388608)']
  ]) {
    await client.query(mutate); await assert.rejects(readonlyContract()); await client.query(restore); passed(`read-only SQL rejects ${name}`);
  }
  await readonlyContract();
  const grantCheck = (await client.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_development_effort_evidence_check'")).rows[0].definition;
  for (const weakened of [false, true]) {
    await client.query('alter table ai_spend_development_batches drop constraint ai_spend_development_effort_evidence_check');
    if (weakened) await client.query('alter table ai_spend_development_batches add constraint ai_spend_development_effort_evidence_check check(true)');
    await assert.rejects(readonlyContract());
    if (weakened) await client.query('alter table ai_spend_development_batches drop constraint ai_spend_development_effort_evidence_check');
    await client.query(`alter table ai_spend_development_batches add constraint ai_spend_development_effort_evidence_check ${grantCheck}`);
    passed(`read-only SQL rejects ${weakened ? 'weakened' : 'missing'} full grant evidence predicate`);
  }
  await client.query("insert into ai_spend_budgets(run_id,hard_limit_micros) values('retention-fixture',1000000)");
  await client.query("insert into ai_spend_ledger(id,run_id,model,effort,operation,price_version,reserved_micros,charged_micros,state) values(gen_random_uuid(),'retention-fixture','deepseek-flash','max','fixture','fixture',100,100,'conservative')");
  await seedExpired('node-cleanup');
  await client.query(`set role ${maintenance}`);
  const cleanup = await cleanupSecurityState(client, { batchSize: 500 });
  assert.equal(cleanup.deleted.competition_decision_calls, 1201); assert.equal(cleanup.deleted.competition_decision_runs, 1); assert.equal(cleanup.deleted.competition_decision_chat_requests, 1); assert.equal(cleanup.deleted.competition_decision_states, 1);
  await assert.rejects(client.query('delete from ai_spend_ledger'), { code: '42501' });
  await client.query('reset role'); passed('Node cleanup respects child FKs and retains the paid ledger');
  await seedExpired('sql-cleanup');
  const cleanupSql = (await readFile('ops/postgresql/cleanup-security-state.sql', 'utf8')).replaceAll('resume_ai_security_maintenance', maintenance);
  let passes = 0;
  for (; passes < 10; passes += 1) { const vars = await runPsqlSql(client, cleanupSql); if (!vars.cleanup_remaining) break; }
  assert.ok(passes >= 2 && passes < 10);
  assert.equal((await client.query('select count(*)::int as count from competition_decision_runs')).rows[0].count, 0);
  assert.equal((await client.query('select count(*)::int as count from ai_spend_ledger')).rows[0].count, 1);
  passed('installed SQL cleanup converges across committed batches without deleting spend');
  // Run the built worker against this empty, isolated test database. Missing
  // API credentials plus no queued tasks make this a zero-provider-call gate.
  // getPool deliberately requires local port 5432, so only this empty database
  // is created on the already running local test cluster. The schema verifier
  // above used a separate socket-only server and did not relax its peer gate.
  await workerAdmin.connect(); await workerAdmin.query(`create database ${database}`); workerDatabaseCreated = true;
  await workerAdmin.query(`create role ${runtime} login nosuperuser nocreatedb nocreaterole noinherit password '${workerPassword}'`); workerRoleCreated = true;
  const workerDatabase = new pg.Client({ ...workerConfig, database }); await workerDatabase.connect();
  try {
    await workerDatabase.query(await readFile('db/schema.sql', 'utf8'));
    await workerDatabase.query('revoke create on schema public from public');
    await workerDatabase.query(`revoke create,temporary on database ${database} from public`);
    await workerDatabase.query(`grant usage on schema public to ${runtime}`);
    for (const row of (await readFile('ops/postgresql/runtime-table-privileges.conf', 'utf8')).split('\n')) {
      if (!row || row.startsWith('#')) continue;
      const [table, privileges] = row.split('=');
      await workerDatabase.query(`grant ${privileges} on ${table} to ${runtime}`);
    }
  } finally { await workerDatabase.end(); }
  const releaseId = '20261109T090909Z';
  const release = path.join(localRoot, releaseId), previous = path.join(localRoot, 'previous'), activeLink = path.join(localRoot, 'current'), healthFile = path.join(localRoot, 'health.json');
  await mkdir(path.join(release, 'dist/decision-worker'), { recursive: true }); await mkdir(previous, { recursive: true });
  // The worker intentionally externalizes reviewed packages. A scratch release
  // outside the source tree needs the same dependency closure as a real slot.
  await symlink(path.join(root, 'node_modules'), path.join(release, 'node_modules'), 'dir');
  const build = spawn(process.execPath, ['scripts/competitions/v7/build-worker.mjs', '--output', path.join(release, 'dist/decision-worker')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buildOutput = ''; build.stdout.on('data', (bytes) => { buildOutput += bytes; }); build.stderr.on('data', (bytes) => { buildOutput += bytes; });
  assert.equal(await new Promise((resolve) => build.once('exit', resolve)), 0, buildOutput);
  // This synthetic Next seal exercises the real configuration reader only.
  // The actual bundled worker above still runs below; this is not a Next build.
  const manifestFile = path.join(release, 'dist/decision-worker/manifest.json'), manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const digest = value => createHash('sha256').update(value).digest('hex');
  const nextBuildId = 'configuration-only-fixture';
  const binding = JSON.stringify({ ...(manifest.executionMode?{executionMode:manifest.executionMode}:{}),schemaVersion: 'saitu.next-worker-binding.v7', sourceSha256: manifest.sourceSha256, workerArtifactSha256: manifest.artifactSha256, nextBuildId,effortPolicy:manifest.effortPolicy,effortPolicySha256:manifest.effortPolicySha256 });
  await mkdir(path.join(release, '.next')); await mkdir(path.join(release, 'scripts/competitions/v7'), { recursive: true });
  await writeFile(path.join(release, 'scripts/competitions/v7/worker-entry.ts'), '// configuration fixture marker\n');
  await writeFile(path.join(release, '.next/BUILD_ID'), nextBuildId);
  await writeFile(path.join(release, '.next/decision-worker-binding.json'), binding);
  await writeFile(path.join(release, '.next/required-server-files.json'), JSON.stringify({ config: { env: { ...(manifest.executionMode?{SAITU_AI_EXECUTION_MODE:manifest.executionMode}:{}),SAITU_V7_SOURCE_SHA256: manifest.sourceSha256,SAITU_V7_EFFORT_POLICY:JSON.stringify(manifest.effortPolicy),SAITU_V7_EFFORT_POLICY_SHA256:manifest.effortPolicySha256 } } }));
  await writeFile(manifestFile, JSON.stringify({ ...manifest, nextBuildId, nextBindingSha256: digest(binding) }));
  await mkdir(path.join(release,'src/lib/ai'),{recursive:true});
  await writeFile(path.join(release,'src/lib/ai/effort-policy.mjs'),'// configuration-only new-source marker\n');
  const legacyReleaseId='20261109T090908Z',legacyConfigRelease=path.join(localRoot,legacyReleaseId);
  await mkdir(legacyConfigRelease);
  const privateDirectory = path.join(localRoot, 'private'); await mkdir(privateDirectory, { mode: 0o700 });
  const appEnvFile = path.join(privateDirectory, 'app.env'), quotaEnvFile = path.join(privateDirectory, 'quota.env');
  const workerUrl = `postgresql://${runtime}:${workerPassword}@127.0.0.1:5432/${database}`;
  const grantRun = 'saitu-v7-20261109-formal-99', mainRun = 'v7-ops-config-main', policyHash = digest(await readFile('docs/v7/implementation-contract.md'));
  const condition = { schemaVersion: 'saitu.user-approved-budget-condition.v7', model: 'deepseek-flash', effort: 'high', phase: 'formal', policySha256: policyHash, authorization: 'user-approved-20261109-continuation', freshPgRowsVerified: true };
  const conditionHash = digest(JSON.stringify(condition));
  const environment = productionGrantEnvironment({ databaseUrl: workerUrl, runId: grantRun, policySha256: policyHash, conditionSha256: conditionHash, callLimit: '1' });
  await writeFile(appEnvFile, renderEnvironment(environment), { mode: 0o640 });
  await writeFile(quotaEnvFile, await readFile('ops/generated/application-quota.env'), { mode: 0o640 });
  await command('bash', ['ops/bin/validate-app-env.sh', 'production', appEnvFile]);
  const ecosystem = loadProductionEcosystem({ root, releaseDirectory: legacyConfigRelease, appEnvFile, quotaEnvFile });
  for (const app of ecosystem.apps) for (const key of ['AI_SPEND_AUTHORIZED_EFFORT', 'AI_SPEND_HIGH_CONDITION_SHA256', 'AI_CALIBRATION_CALL_LIMIT']) assert.equal(app.env[key], environment[key]);
  const entries = pm2EntriesFromEcosystem(ecosystem), liveFile = path.join(privateDirectory, 'live.json'), dumpFile = path.join(privateDirectory, 'dump.json');
  await writeFile(liveFile, JSON.stringify(entries), { mode: 0o600 }); await writeFile(dumpFile, JSON.stringify(entries), { mode: 0o600 });
  await command(process.execPath, ['ops/bin/verify-pm2-topology.mjs', liveFile, dumpFile, localRoot, '3000', legacyReleaseId, 'none', 'none', appEnvFile, quotaEnvFile]);
  const grantAdmin = new pg.Client({ ...workerConfig, database }); await grantAdmin.connect();
  const priorEnvironment = { ...process.env }, priorFetch = globalThis.fetch;
  let providerDispatches = 0, poolModule;
  try {
    await grantAdmin.query('insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,1000000),($2,1000000)', [mainRun, grantRun]);
    await grantAdmin.query('insert into ai_spend_authority(singleton,run_id) values(true,$1)', [mainRun]);
    await grantAdmin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256)
      values($1,$2,2,1000000,0,1000000,'{}','synthetic disposable config gate','high',$3,$4::jsonb,'saitu.v7','formal',$5)`, [grantRun, mainRun, conditionHash, JSON.stringify(condition), policyHash]);
    process.env = { ...ecosystem.apps[0].env };
    globalThis.fetch = async () => { providerDispatches += 1; throw new Error('PROVIDER_DISPATCH_FORBIDDEN_IN_CONFIG_GATE'); };
    installSourceLoader(root);
    const { configuredDevelopmentEffort, reserveAiSpend } = await import('../../src/lib/ai/spend-ledger.ts');
    poolModule = await import('../../src/lib/db/pool.ts');
    assert.equal(configuredDevelopmentEffort(), 'high');
    const input = { system: 'isolated config gate', prompt: 'No provider dispatch', maxTokens: 100, model: 'deepseek-flash', effort: 'high' };
    for (const [key, wrong] of [['AI_SPEND_AUTHORIZED_EFFORT', 'max'], ['AI_SPEND_HIGH_CONDITION_SHA256', 'e'.repeat(64)], ['AI_SPEND_POLICY_SHA256', 'f'.repeat(64)], ['AI_SPEND_PHASE', 'performance']]) {
      const before = process.env[key]; process.env[key] = wrong;
      assert.deepEqual(await reserveAiSpend(input), { ok: false, reason: 'spend_configuration_invalid' }); process.env[key] = before;
    }
    const first = await reserveAiSpend(input), second = await reserveAiSpend(input);
    assert.equal(first.ok, true); assert.equal(second.ok, true);
    assert.deepEqual(await reserveAiSpend(input), { ok: false, reason: 'spend_budget_exhausted' });
    await first.reservation.settle(undefined, false); await second.reservation.settle(undefined, false);
    const rows = (await grantAdmin.query('select count(*)::int as count,coalesce(sum(charged_micros),0)::int as charged from ai_spend_ledger where run_id=$1', [grantRun])).rows[0];
    assert.deepEqual(rows, { count: 2, charged: 0 }); assert.equal(providerDispatches, 0);
    productionGrantChain = { syntheticGrantInDisposableDatabase: true, phase: 'formal', configuredCalibrationCallLimit: 1, authoritativePgCallLimit: 2, authorizedReservations: 2, chargedMicros: 0, providerDispatches, configurationOnlyNextSeal: true };
  } finally {
    if (poolModule) { await poolModule.getPool().end(); delete globalThis.__pgPool; }
    process.env = priorEnvironment; globalThis.fetch = priorFetch; await grantAdmin.end();
  }
  passed('production app.env and PM2 clean env reach the actual high-grant gate; DB formal cap wins; zero dispatch');
  await symlink(previous, activeLink);
  worker = spawn(process.execPath, [path.join(release, 'dist/decision-worker/worker.mjs')], { stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_URL: workerUrl, AI_API_KEY: '', APP_RELEASE_DIR: release, SAITU_V7_WORKER_ACTIVE_LINK: activeLink, SAITU_V7_WORKER_HEALTH_FILE: healthFile, SAITU_V7_WORKER_CONCURRENCY: '1' } });
  worker.stderr.on('data', bytes => { workerError = `${workerError}${bytes.toString('utf8')}`.slice(-16_384); });
  worker.once('exit', (code) => { workerExit = code ?? -1; });
  const firstHealth=await waitHealth('paused', healthFile);assert.equal(manifest.executionMode,'user-unbounded');assert.equal(firstHealth.executionMode,'user-unbounded');assert.equal(firstHealth.concurrency,null);
  await symlink(release, `${activeLink}.next`); await rename(`${activeLink}.next`, activeLink); await waitHealth('active', healthFile);
  await symlink(previous, `${activeLink}.next`); await rename(`${activeLink}.next`, activeLink); await waitHealth('paused', healthFile);
  passed('built worker stays paused before switch, activates, and pauses on rollback');
  worker.kill('SIGTERM');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker_shutdown_timeout')), 15_000);
    worker.once('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(workerExit, 0); worker = undefined; passed('worker exits cleanly on SIGTERM');
  // Separate new-source configuration chain. Old high observations above stay
  // unchanged; neither seal claims a real Next build or provider success.
  async function stageGrantObservation(top5,unbounded=false) {
  if(top5){
    const marker=(await client.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_top5_grant_check'")).rows[0].definition;
    await client.query('alter table ai_spend_development_batches drop constraint ai_spend_top5_grant_check');
    await assert.rejects(readonlyContract());
    await client.query(`alter table ai_spend_development_batches add constraint ai_spend_top5_grant_check ${marker}`);
    await readonlyContract();
  }
  const stageRun=`saitu-v7-${unbounded?'top5-unbounded':top5?'top5':'effort'}-20261109-formal-99`,stagePolicyHash=digest(await readFile(unbounded?'docs/v7/top5-unbounded-execution-contract-20261109.md':top5?'docs/v7/top5-continuation-contract-20261109.md':'docs/v7/effort-continuation-contract-20261109.md'));
  const grantVersion=unbounded?'saitu.v7.top5.user-unbounded.v1':top5?'saitu.v7.top5.v1':'saitu.v7.effort.v1';
  if(top5){await mkdir(path.join(release,'db/migrations'),{recursive:true});await writeFile(path.join(release,'db/migrations/20261109_spend_v7_top5_policy.sql'),'-- configuration-only Top5 source marker\n');}
  if(unbounded)await writeFile(path.join(release,'src/lib/ai/execution-policy.mjs'),'// configuration-only mode capability marker\n');
  const stageBinding=JSON.parse(binding),stageManifest={...manifest,nextBuildId};
  if(unbounded){stageBinding.executionMode='user-unbounded';stageManifest.executionMode='user-unbounded';}else{delete stageBinding.executionMode;delete stageManifest.executionMode;}
  const stageBindingBytes=JSON.stringify(stageBinding);
  await writeFile(path.join(release,'.next/decision-worker-binding.json'),stageBindingBytes);
  await writeFile(manifestFile,JSON.stringify({...stageManifest,nextBindingSha256:digest(stageBindingBytes)}));
  await writeFile(path.join(release,'.next/required-server-files.json'),JSON.stringify({config:{env:{SAITU_V7_SOURCE_SHA256:manifest.sourceSha256,SAITU_V7_EFFORT_POLICY:JSON.stringify(manifest.effortPolicy),SAITU_V7_EFFORT_POLICY_SHA256:manifest.effortPolicySha256,...(unbounded?{SAITU_AI_EXECUTION_MODE:'user-unbounded'}:{})}}}));
  const effortPolicy=manifest.effortPolicy,effortPolicySha256=manifest.effortPolicySha256;
  const stageCondition={schemaVersion:unbounded?'saitu.user-approved-budget-condition.v7.top5.user-unbounded.v1':top5?'saitu.user-approved-budget-condition.v7.top5.v1':'saitu.user-approved-budget-condition.v7.effort.v1',model:'deepseek-flash',effort:'stage',mainRunId:mainRun,phase:'formal',policySha256:stagePolicyHash,effortPolicy,effortPolicySha256,authorization:unbounded?'user-approved-20261109-top5-unbounded-execution':top5?'user-approved-20261109-top5-continuation':'user-approved-20261109-effort-exploration',freshPgRowsVerified:true,...(top5?{sourcePolicy:unbounded?'docs/v7/top5-unbounded-execution-contract-20261109.md':'docs/v7/top5-continuation-contract-20261109.md',policyVersion:'saitu.policy.2026-11-09.v7.top5',implementationVersion:'saitu.async.2026-11-09.v7.3.top5',priorLedgerSha256:digest('synthetic local evidence only')} : {}),...(unbounded?{executionMode:'user-unbounded',executionLimits:{modelConcurrencyLimit:null,totalCallLimit:null,totalCostLimitMicros:null}}:{})};
  const stageEnvironment={...productionGrantEnvironment({databaseUrl:workerUrl,runId:stageRun,policySha256:stagePolicyHash,conditionSha256:'',callLimit:'1'}),AI_SPEND_AUTHORIZED_EFFORT:'stage',AI_SPEND_EFFORT_CONDITION_SHA256:digest(JSON.stringify(stageCondition)),SAITU_V7_EFFORT_POLICY:JSON.stringify(effortPolicy),SAITU_V7_EFFORT_POLICY_SHA256:effortPolicySha256,...(unbounded?{SAITU_AI_EXECUTION_MODE:'user-unbounded',AI_SPEND_LIMIT_CNY:'0',AI_SPEND_FUNDED_CNY:'0',AI_CALIBRATION_CALL_LIMIT:'0',SAITU_V7_WORKER_CONCURRENCY:'0'}:{})};
  await writeFile(appEnvFile,renderEnvironment(stageEnvironment),{mode:0o640});
  await command('bash',['ops/bin/validate-app-env.sh','production',appEnvFile]);
  const stageEcosystem=loadProductionEcosystem({root,releaseDirectory:release,appEnvFile,quotaEnvFile});
  for(const app of stageEcosystem.apps)for(const key of ['AI_SPEND_AUTHORIZED_EFFORT','AI_SPEND_EFFORT_CONDITION_SHA256','SAITU_V7_EFFORT_POLICY_SHA256'])assert.equal(app.env[key],stageEnvironment[key]);
  await writeFile(liveFile,JSON.stringify(pm2EntriesFromEcosystem(stageEcosystem)),{mode:0o600});await writeFile(dumpFile,JSON.stringify(pm2EntriesFromEcosystem(stageEcosystem)),{mode:0o600});
  await command(process.execPath,['ops/bin/verify-pm2-topology.mjs',liveFile,dumpFile,localRoot,'3000',releaseId,'none','none',appEnvFile,quotaEnvFile]);
  const stageAdmin=new pg.Client({...workerConfig,database});await stageAdmin.connect();
  const stagePriorEnvironment={...process.env},stagePriorFetch=globalThis.fetch;let stageDispatches=0,stagePoolModule,stageGrantChain;
  try{
    await stageAdmin.query(`insert into ai_spend_budgets(run_id,hard_limit_micros${unbounded?',execution_mode':''}) values($1,${unbounded?"null,'user-unbounded'":'1000000'})`,[stageRun]);
    await stageAdmin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256,effort_policy,effort_policy_sha256${unbounded?',execution_mode':''}) values($1,$2,${unbounded?'null':'2'},1000000,0,1000000,'{}','synthetic isolated stage config','stage',$3,$4::jsonb,'${grantVersion}','formal',$5,$6::jsonb,$7${unbounded?",'user-unbounded'":''})`,[stageRun,mainRun,stageEnvironment.AI_SPEND_EFFORT_CONDITION_SHA256,JSON.stringify(stageCondition),stagePolicyHash,JSON.stringify(effortPolicy),effortPolicySha256]);
    process.env={...stageEcosystem.apps[1].env};globalThis.fetch=async()=>{stageDispatches++;throw new Error('PROVIDER_DISPATCH_FORBIDDEN_IN_STAGE_CONFIG_GATE');};
    const {reserveAiSpend}=await import('../../src/lib/ai/spend-ledger.ts');stagePoolModule=await import('../../src/lib/db/pool.ts');
    const input={system:'isolated stage gate',prompt:'No provider dispatch',maxTokens:100,model:'deepseek-flash',effort:effortPolicy.rank,operation:'competition_v7_rank',effortPolicySha256};
    for(const [key,wrong] of [['AI_SPEND_AUTHORIZED_EFFORT','high'],['AI_SPEND_EFFORT_CONDITION_SHA256','e'.repeat(64)],['SAITU_V7_EFFORT_POLICY_SHA256','f'.repeat(64)],['AI_SPEND_PHASE','performance']]){const prior=process.env[key];process.env[key]=wrong;assert.deepEqual(await reserveAiSpend(input),{ok:false,reason:'spend_configuration_invalid'});process.env[key]=prior;}
    assert.deepEqual(await reserveAiSpend({...input,effortPolicySha256:'e'.repeat(64)}),{ok:false,reason:'spend_configuration_invalid'});
    const reserved=[];for(let i=0;i<(unbounded?3:2);i++){const value=await reserveAiSpend(input);assert.equal(value.ok,true);reserved.push(value);}
    if(!unbounded)assert.deepEqual(await reserveAiSpend(input),{ok:false,reason:'spend_budget_exhausted'});
    for(const value of reserved)await value.reservation.settle(undefined,false);
    const rows=(await stageAdmin.query('select count(*)::int as count,coalesce(sum(charged_micros),0)::int as charged from ai_spend_ledger where run_id=$1 and effort_policy_sha256=$2 and effort=$3',[stageRun,effortPolicySha256,effortPolicy.rank])).rows[0];assert.deepEqual(rows,{count:unbounded?3:2,charged:0});assert.equal(stageDispatches,0);
    if(unbounded){await stageAdmin.query("insert into ai_spend_ledger(id,run_id,model,effort,effort_policy_sha256,phase,operation,price_version,reserved_micros,charged_micros,state) values($1,$2,'deepseek-flash','low',$3,'formal','native-unbounded-physical-hold','fixture',1000000,1000000,'conservative')",[randomUUID(),stageRun,effortPolicySha256]);assert.deepEqual(await reserveAiSpend(input),{ok:false,reason:'spend_budget_exhausted'});}
    stageGrantChain={syntheticGrantInDisposableDatabase:true,grantVersion,effortPolicySha256,rankEffort:effortPolicy.rank,authorizedReservations:unbounded?3:2,chargedMicros:0,providerDispatches:stageDispatches,configurationOnlyNextSeal:true,...(unbounded?{executionMode:'user-unbounded',physicalUnknownHoldRejected:true}: {})};
  }finally{if(stagePoolModule){await stagePoolModule.getPool().end();delete globalThis.__pgPool;}process.env=stagePriorEnvironment;globalThis.fetch=stagePriorFetch;await stageAdmin.end();}
  passed(unbounded?'user-unbounded app.env and PM2 reserve beyond finite caps while physical unknown holds remain protected; zero dispatch':top5?'top5 app.env and PM2 reach the actual LLL policy-bound reserve gate; DB cap wins; zero dispatch':'stage effort app.env and PM2 reach the actual policy-bound reserve gate; DB cap wins; zero dispatch');
  return stageGrantChain;
  }
  const stageGrantChain=await stageGrantObservation(false),top5GrantChain=await stageGrantObservation(true),userUnboundedGrantChain=await stageGrantObservation(true,true);
  const postgresVersion = (await client.query('show server_version')).rows[0].server_version;
  await writeFile(path.join(localRoot, 'result.json'), `${JSON.stringify({ schemaVersion: 'saitu.v7-ops-local-evidence.v4', status: 'passed', database, postgresVersion, observations, productionGrantChain,stageGrantChain,top5GrantChain,userUnboundedGrantChain, workerBuild: { sourceSha256: manifest.sourceSha256, artifactSha256: manifest.artifactSha256,effortPolicySha256:manifest.effortPolicySha256,executionMode:manifest.executionMode }, paidCalls: 0, productionTouched: false }, null, 2)}\n`);
  console.info(JSON.stringify({ status: 'passed', observations: observations.length, paidCalls: 0, productionTouched: false, result: path.join(localRoot, 'result.json') }));
} finally {
  if (worker) { worker.kill('SIGTERM'); await delay(500); if (workerExit === undefined) worker.kill('SIGKILL'); }
  await client?.end().catch(() => undefined);
  await admin.query(`drop database if exists ${database} with (force)`).catch(() => undefined);
  await admin.query(`drop role if exists ${runtime}`).catch(() => undefined);
  await admin.query(`drop role if exists ${maintenance}`).catch(() => undefined);
  await admin.end().catch(() => undefined);
  if (workerDatabaseCreated) await workerAdmin.query(`drop database if exists ${database} with (force)`).catch(() => undefined);
  if (workerRoleCreated) await workerAdmin.query(`drop role if exists ${runtime}`).catch(() => undefined);
  await workerAdmin.end().catch(() => undefined);
  if (clusterStarted) await command(path.join(binaries, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']);
}
