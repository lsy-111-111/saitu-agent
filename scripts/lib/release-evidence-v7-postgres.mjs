/** Zero-provider adapter for the mandatory native PostgreSQL14 worker gate.
 * It has no signing authority. The coordinator publishes these raw files only
 * after a real subprocess, and the independent verifier rechecks their binding. */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

export const V7_NATIVE_LEGACY_ASSERTIONS = Object.freeze([
  'runtime has v7 S/I/U without DELETE/TRUNCATE/DDL',
  'actual read-only SQL accepts the complete migrated schema',
  'read-only SQL rejects plaintext',
  'read-only SQL rejects lost-call-parent',
  'read-only SQL rejects lost-idempotency',
  'read-only SQL rejects lost-cipher-cap',
  'read-only SQL rejects missing full grant evidence predicate',
  'read-only SQL rejects weakened full grant evidence predicate',
  'Node cleanup respects child FKs and retains the paid ledger',
  'installed SQL cleanup converges across committed batches without deleting spend',
  'production app.env and PM2 clean env reach the actual high-grant gate; DB formal cap wins; zero dispatch',
  'built worker stays paused before switch, activates, and pauses on rollback',
  'worker exits cleanly on SIGTERM',
]);
export const V7_NATIVE_EFFORT_ASSERTIONS = Object.freeze([...V7_NATIVE_LEGACY_ASSERTIONS, 'stage effort app.env and PM2 reach the actual policy-bound reserve gate; DB cap wins; zero dispatch']);
export const V7_NATIVE_TOP5_ASSERTIONS = Object.freeze([...V7_NATIVE_EFFORT_ASSERTIONS, 'top5 app.env and PM2 reach the actual LLL policy-bound reserve gate; DB cap wins; zero dispatch']);
export const V7_NATIVE_ASSERTIONS = Object.freeze([...V7_NATIVE_TOP5_ASSERTIONS, 'user-unbounded app.env and PM2 reserve beyond finite caps while physical unknown holds remain protected; zero dispatch']);
const digest = value => createHash('sha256').update(value).digest('hex');

export function validateNativeV7PostgresResult(result) {
  const unbounded=result?.schemaVersion === 'saitu.v7-ops-local-evidence.v4',top5=unbounded||result?.schemaVersion === 'saitu.v7-ops-local-evidence.v3',stage=top5||result?.schemaVersion === 'saitu.v7-ops-local-evidence.v2';
  if (!['saitu.v7-ops-local-evidence.v1','saitu.v7-ops-local-evidence.v2','saitu.v7-ops-local-evidence.v3','saitu.v7-ops-local-evidence.v4'].includes(result?.schemaVersion) || result.status !== 'passed'
    || !/^saitu_v7_ops_[a-f0-9]{10}$/.test(result.database ?? '') || !/^14\./.test(result.postgresVersion ?? '')
    || JSON.stringify(result.observations) !== JSON.stringify(unbounded?V7_NATIVE_ASSERTIONS:top5?V7_NATIVE_TOP5_ASSERTIONS:stage?V7_NATIVE_EFFORT_ASSERTIONS:V7_NATIVE_LEGACY_ASSERTIONS)
    || result.paidCalls !== 0 || result.productionTouched !== false
    || result.productionGrantChain?.syntheticGrantInDisposableDatabase !== true || result.productionGrantChain.phase !== 'formal'
    || result.productionGrantChain.configuredCalibrationCallLimit !== 1 || result.productionGrantChain.authoritativePgCallLimit !== 2
    || result.productionGrantChain.authorizedReservations !== 2 || result.productionGrantChain.chargedMicros !== 0
    || result.productionGrantChain.providerDispatches !== 0 || result.productionGrantChain.configurationOnlyNextSeal !== true
    || !/^[a-f0-9]{64}$/.test(result.workerBuild?.sourceSha256 ?? '') || !/^[a-f0-9]{64}$/.test(result.workerBuild?.artifactSha256 ?? ''))
    throw new Error('native_v7_postgres_required_observations_invalid');
  if(stage){const g=result.stageGrantChain;
    if(!g||g.syntheticGrantInDisposableDatabase!==true||g.grantVersion!=='saitu.v7.effort.v1'||!['high','low'].includes(g.rankEffort)||g.authorizedReservations!==2||g.chargedMicros!==0||g.providerDispatches!==0||g.configurationOnlyNextSeal!==true||!/^[a-f0-9]{64}$/.test(g.effortPolicySha256??'')||g.effortPolicySha256!==result.workerBuild?.effortPolicySha256)throw new Error('native_v7_stage_grant_observations_invalid');
  }
  if(top5){const g=result.top5GrantChain;
    if(!g||g.syntheticGrantInDisposableDatabase!==true||g.grantVersion!=='saitu.v7.top5.v1'||g.rankEffort!=='low'||g.authorizedReservations!==2||g.chargedMicros!==0||g.providerDispatches!==0||g.configurationOnlyNextSeal!==true||g.effortPolicySha256!=='04962f576d20346af8a8f076ce64fdbda5aea13fdbd2fae39f3c7456fe30aa48'||g.effortPolicySha256!==result.workerBuild?.effortPolicySha256)throw new Error('native_v7_top5_grant_observations_invalid');
  }
  if(unbounded){const g=result.userUnboundedGrantChain;
    if(result.workerBuild?.executionMode!=='user-unbounded'||!g||g.executionMode!=='user-unbounded'||g.syntheticGrantInDisposableDatabase!==true||g.grantVersion!=='saitu.v7.top5.user-unbounded.v1'||g.rankEffort!=='low'||g.effortPolicySha256!==result.workerBuild.effortPolicySha256||g.authorizedReservations!==3||g.chargedMicros!==0||g.providerDispatches!==0||g.configurationOnlyNextSeal!==true||g.physicalUnknownHoldRejected!==true)throw new Error('native_v7_unbounded_grant_observations_invalid');
  }
  return result;
}

export async function runNativeV7Postgres({ root, output }) {
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.version !== 'v24.20.0') throw new Error('native_v7_linux_x64_node24_required');
  if (!path.isAbsolute(root) || !path.isAbsolute(output) || output === root || output.startsWith(`${root}${path.sep}`)) throw new Error('native_v7_external_output_required');
  if (!process.env.V7_TEST_ADMIN_DATABASE_URL) throw new Error('native_v7_explicit_coordinator_database_required');
  await mkdir(output, { mode: 0o700 });
  const scratch = await mkdtemp('/tmp/saitu-v7-native-');
  const source = 'tests/deployment/v7-ops-postgres.test.mjs';
  const sourceSha256 = digest(await readFile(path.join(root, source)));
  const childEnvironment = {
    PATH: '/opt/nodejs/node-v24.20.0-linux-x64/bin:/usr/bin:/bin', NODE_ENV: 'test',
    RUN_V7_DATABASE_TESTS: '1', SAITU_AI_EXECUTION_MODE:'user-unbounded', V7_TEST_ADMIN_DATABASE_URL: process.env.V7_TEST_ADMIN_DATABASE_URL || '',
    ...(process.env.SAITU_V7_EFFORT_POLICY ? {SAITU_V7_EFFORT_POLICY:process.env.SAITU_V7_EFFORT_POLICY,SAITU_V7_EFFORT_POLICY_SHA256:process.env.SAITU_V7_EFFORT_POLICY_SHA256} : {}),
    SAITU_V7_OPS_WORK_ROOT: scratch, SAITU_V7_OPS_PG_BIN: '/usr/lib/postgresql/14/bin', AI_API_KEY: '',
  };
  let child;
  try {
    const execution = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [path.join(root, source)], { cwd: root, env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks = []; let bytes = 0, overflow = false, timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 210_000);
      const capture = chunk => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) { overflow = true; child.kill('SIGKILL'); } else chunks.push(chunk); };
      child.stdout.on('data', capture); child.stderr.on('data', capture);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, log: Buffer.concat(chunks), overflow, timedOut }); });
    });
    const log = execution.log;
    await writeFile(path.join(output, 'native-v7-postgres.log'), log, { flag: 'wx', mode: 0o600 });
    if (execution.code !== 0 || execution.signal || execution.overflow || execution.timedOut) throw new Error('native_v7_subprocess_failed');
    const result = validateNativeV7PostgresResult(JSON.parse(await readFile(path.join(scratch, 'result.json'), 'utf8')));
    if(result.schemaVersion!=='saitu.v7-ops-local-evidence.v4')throw new Error('native_v7_unbounded_evidence_required');
    if (sourceSha256 !== digest(await readFile(path.join(root, source)))) throw new Error('native_v7_source_changed');
    const receipt = { ...result, execution: { platform: process.platform, arch: process.arch, node: process.version, source, sourceSha256, rawLogSha256: digest(log) } };
    await writeFile(path.join(output, 'native-v7-postgres-result.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return receipt;
  } finally {
    if (child?.exitCode === null) child.kill('SIGKILL');
    await rm(scratch, { recursive: true, force: true });
  }
}
