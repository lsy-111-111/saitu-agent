// Read-only wall-clock stability observation. It never posts to an AI endpoint.
import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { byteHash, isHash } from '../../scripts/competitions/v7/evaluation-policy.mjs';
import { safePilotError } from './v7-pilot-browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DURATION = 30 * 60_000, INTERVAL = 15_000;
const demand = (condition, code) => { if (!condition) throw new Error(code); };
const writeNew = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
function options(args) {
  const result = {}, flags = new Set(['--describe', '--run', '--root-dispatch']);
  for (let index = 0; index < args.length; index++) {
    const key = args[index]; demand((flags.has(key) || ['--config', '--config-sha256', '--output'].includes(key)) && !Object.hasOwn(result, key), 'unsupported_or_duplicate_stability_option');
    result[key] = flags.has(key) ? true : args[++index]; demand(result[key] !== undefined, 'missing_stability_option_value');
  }
  demand(Boolean(result['--describe']) !== Boolean(result['--run']), 'choose_stability_description_or_run');
  return result;
}

export async function main(args = process.argv.slice(2)) {
  const cli = options(args);
  if (cli['--describe']) {
    console.log(JSON.stringify({ schemaVersion: 'saitu.fast24-stability-description.v1', durationMs: DURATION, intervalMs: INTERVAL,
      actualWallClock: true, providerCalls: 0, databaseWrites: 0,
      checks: ['actual production GET and BUILD_ID', 'PostgreSQL SELECT 1', 'same active worker identity, source and fresh heartbeat', 'same worker and Next artifact bytes'],
      execution: '--run --root-dispatch --config PERFORMANCE_CONFIG --config-sha256 HASH --output NEW_DIRECTORY' }, null, 2)); return;
  }
  demand(process.cwd() === ROOT && Number(process.versions.node.split('.')[0]) === 24, 'repository_root_and_node24_required');
  demand(cli['--root-dispatch'] && cli['--config'] && isHash(cli['--config-sha256']) && cli['--output'], 'root_start_with_exact_config_required');
  const bytes = await readFile(cli['--config']); demand(byteHash(bytes) === cli['--config-sha256'], 'stability_config_bytes_changed');
  const config = JSON.parse(bytes), base = new URL(config.baseUrl), build = config.productionBuild;
  demand(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname) && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'local_stability_target_required');
  demand(isHash(config.runtimeSourceBindingSha256) && path.isAbsolute(config.workerHealthFile) &&
    build && path.isAbsolute(build.directory) && build.nextBuildId && build.nextBuildId !== 'development' && path.isAbsolute(build.workerManifestPath) &&
    isHash(build.workerManifestSha256) && isHash(build.nextBindingSha256), 'production_worker_build_bindings_required');
  const target = new URL(process.env.DATABASE_URL ?? '');
  demand(['127.0.0.1', 'localhost'].includes(target.hostname) && (!target.port || target.port === '5432'), 'actual_local_postgres_required');
  const output = path.resolve(cli['--output']); await mkdir(output, { mode: 0o700 });
  await writeFile(path.join(output, 'config.json'), bytes, { flag: 'wx', mode: 0o600 });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c default_transaction_read_only=on',
    connectionTimeoutMillis: 3_000, query_timeout: 3_000, max: 1 });
  const startedAtEpochMs = Date.now(), startedMonotonicMs = performance.now();
  const samples = []; let workerIdentity;
  await writeNew(path.join(output, 'start.json'), { schemaVersion: 'saitu.fast24-stability-start.v1', startedAt: new Date(startedAtEpochMs).toISOString(),
    startedAtEpochMs, startedMonotonicMs, minimumDurationMs: DURATION, intervalMs: INTERVAL,
    runtimeSourceBindingSha256: config.runtimeSourceBindingSha256, nextBuildId: build.nextBuildId, providerCalls: 0, databaseWrites: 0 });
  try {
    for (;;) {
      const sample = { sequence: samples.length + 1, sampledAt: new Date().toISOString(), elapsedWallMs: Date.now() - startedAtEpochMs,
        elapsedMonotonicMs: performance.now() - startedMonotonicMs, issues: [] };
      if (samples.length) {
        sample.gapSincePreviousSampleMs = sample.elapsedMonotonicMs - samples[samples.length - 1].elapsedMonotonicMs;
        if (sample.gapSincePreviousSampleMs > 30_000) sample.issues.push('continuous_observation_gap_exceeded_30_seconds');
      }
      const checks = await Promise.allSettled([
        (async () => {
          const response = await fetch(new URL('/competitions/recommend', base), { signal: AbortSignal.timeout(10_000), redirect: 'error' });
          const html = await response.text();
          sample.http = { status: response.status, productionBuildIdObserved: html.includes(build.nextBuildId), htmlSha256: byteHash(Buffer.from(html)) };
          demand(response.status === 200 && sample.http.productionBuildIdObserved, 'production_page_unavailable_or_different_build');
        })(),
        (async () => {
          await pool.query('select 1 as ready'); sample.postgresReady = true;
        })(),
        (async () => {
          const health = JSON.parse(await readFile(config.workerHealthFile, 'utf8'));
          sample.worker = health;
          const identity = `${health.owner}:${health.pid}`;
          if (workerIdentity === undefined) workerIdentity = identity;
          demand(identity === workerIdentity && health.schemaVersion === 'saitu.worker-health.v7' && health.status === 'active' && health.databaseReady === true &&
            health.sourceSha256 === config.runtimeSourceBindingSha256 && health.executionMode === 'user-unbounded' && health.concurrency === null &&
            Number.isFinite(Date.parse(health.updatedAt)) && Date.now() - Date.parse(health.updatedAt) >= 0 && Date.now() - Date.parse(health.updatedAt) < 10_000,
          'worker_identity_source_or_fresh_health_changed');
        })(),
        (async () => {
          const manifestBytes = await readFile(build.workerManifestPath), manifest = JSON.parse(manifestBytes);
          const bindingBytes = await readFile(path.join(build.directory, 'decision-worker-binding.json'));
          demand(byteHash(manifestBytes) === build.workerManifestSha256 && byteHash(bindingBytes) === build.nextBindingSha256 &&
            (await readFile(path.join(build.directory, 'BUILD_ID'), 'utf8')).trim() === build.nextBuildId &&
            manifest.sourceSha256 === config.runtimeSourceBindingSha256 && manifest.nextBuildId === build.nextBuildId &&
            byteHash(await readFile(path.join(path.dirname(build.workerManifestPath), 'worker.mjs'))) === manifest.artifactSha256,
          'production_artifact_bytes_changed_during_stability'); sample.artifactsUnchanged = true;
        })(),
      ]);
      for (const result of checks) if (result.status === 'rejected') sample.issues.push(safePilotError(result.reason));
      if (Math.abs(sample.elapsedWallMs - sample.elapsedMonotonicMs) > 5_000) sample.issues.push('wall_clock_changed_relative_to_monotonic_time');
      sample.passed = sample.issues.length === 0; samples.push(sample);
      await appendFile(path.join(output, 'samples.jsonl'), JSON.stringify(sample) + '\n', { mode: 0o600 });
      // Both clocks must cover thirty genuine minutes; no shortened or replay mode.
      const remaining = Math.max(DURATION - (Date.now() - startedAtEpochMs), DURATION - (performance.now() - startedMonotonicMs));
      if (remaining <= 0) break;
      await delay(Math.min(INTERVAL, remaining));
    }
    const elapsedWallMs = Date.now() - startedAtEpochMs, elapsedMonotonicMs = performance.now() - startedMonotonicMs;
    await writeNew(path.join(output, 'stability-result.json'), { schemaVersion: 'saitu.fast24-stability-result.v1',
      startedAt: new Date(startedAtEpochMs).toISOString(), finishedAt: new Date().toISOString(), minimumDurationMs: DURATION,
      elapsedWallMs, elapsedMonotonicMs, sampleCount: samples.length, failedSamples: samples.filter(row => !row.passed).map(row => row.sequence),
      passed: elapsedWallMs >= DURATION && elapsedMonotonicMs >= DURATION && samples.length >= 61 && samples.every(row => row.passed),
      configSha256: byteHash(bytes), runtimeSourceBindingSha256: config.runtimeSourceBindingSha256, nextBuildId: build.nextBuildId,
      providerCalls: 0, databaseWrites: 0, limitations: ['Read-only availability observation; paid business flows are proven by the separate performance originals'] });
  } finally { await pool.end(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(safePilotError(error)); process.exitCode = 1; });
