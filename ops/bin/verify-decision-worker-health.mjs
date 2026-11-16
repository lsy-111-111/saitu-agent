#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [release, expectedStatus, ...arguments_] = process.argv.slice(2);
let explicitHealthFile, expectedPid, requireIdle = false;
for (let index = 0; index < arguments_.length; index += 1) {
  if (arguments_[index] === '--pid' && arguments_[index + 1]) expectedPid = Number(arguments_[++index]);
  else if (arguments_[index] === '--idle') requireIdle = true;
  else if (!explicitHealthFile && !arguments_[index].startsWith('--')) explicitHealthFile = arguments_[index];
  else throw new Error('invalid worker health option');
}
if (!release || !path.isAbsolute(release) || !['active', 'paused'].includes(expectedStatus)) throw new Error('usage: verify-decision-worker-health.mjs ABSOLUTE_RELEASE active|paused [HEALTH_FILE]');
const filename = explicitHealthFile || `/var/cache/resume-ai/${path.basename(release)}/decision-worker-health.json`;
const metadata = fs.lstatSync(filename);
if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o077) !== 0) throw new Error('V7_WORKER_HEALTH_FILE_UNSAFE');
const health = JSON.parse(fs.readFileSync(filename, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(release, 'dist/decision-worker/manifest.json'), 'utf8'));
if(Object.hasOwn(manifest,'executionMode')&&manifest.executionMode!=='user-unbounded')throw new Error('V7_WORKER_EXECUTION_MODE_FAILED');
if(manifest.executionMode==='user-unbounded' ? health.executionMode!=='user-unbounded'||health.concurrency!==null : Object.hasOwn(health,'executionMode'))throw new Error('V7_WORKER_EXECUTION_MODE_FAILED');
const age = Date.now() - Date.parse(health.updatedAt);
if (health.schemaVersion !== 'saitu.worker-health.v7' || health.releaseDirectory !== release || health.sourceSha256 !== manifest.sourceSha256 || health.status !== expectedStatus || health.databaseReady !== true || !Number.isInteger(health.pid) || health.pid < 1 || !Number.isFinite(age) || age < -2_000 || age > 10_000) throw new Error('V7_WORKER_HEALTH_FAILED');
if ((expectedPid !== undefined && (!Number.isInteger(expectedPid) || expectedPid < 1 || health.pid !== expectedPid)) || (requireIdle && health.inFlight !== 0)) throw new Error('V7_WORKER_PID_OR_DRAIN_FAILED');
process.kill(health.pid, 0);
console.info(JSON.stringify({ schemaVersion: 'saitu.worker-health-verification.v7', status: 'passed', ...(manifest.executionMode==='user-unbounded'?{executionMode:'user-unbounded'}:{}), workerStatus: expectedStatus, sourceSha256: health.sourceSha256, pid: health.pid }));
