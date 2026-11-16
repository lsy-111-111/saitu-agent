import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, open, access } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { RANK_NON_THINKING_EFFORT_POLICY, effortPolicySha256 } from '../../../src/lib/ai/effort-policy.mjs';
import { LOCAL_PREVIEW_ORIGIN } from '../../../src/lib/ai/execution-policy.mjs';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
export const PREVIEW_ROOT = path.join(ROOT, 'artifacts/local-preview-v767');
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = async filename => JSON.parse(await readFile(filename, 'utf8'));
export const writeJson = async (filename, value, exclusive = false) => writeFile(filename, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, ...(exclusive ? { flag: 'wx' } : {}) });
export const policyEnvironment = {
  SAITU_AI_EXECUTION_MODE: 'user-unbounded', SAITU_V7_DETAIL_LAYOUT: 'single',
  SAITU_V7_EFFORT_POLICY: JSON.stringify(RANK_NON_THINKING_EFFORT_POLICY),
  SAITU_V7_EFFORT_POLICY_SHA256: effortPolicySha256(RANK_NON_THINKING_EFFORT_POLICY),
};
export function requireValue(value, code) { if (!value) throw new Error(code); }
export async function currentSource() {
  const env = { ...process.env, ...policyEnvironment }; delete env.SAITU_V7_SOURCE_SHA256;
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/competitions/v7/build-worker.mjs', '--binding-only'], { cwd: ROOT, env });
  return stdout.trim();
}
export async function verifyBuild(build, checkSource = true) {
  for (const filename of [build.nextDirectory, build.workerDirectory]) requireValue(path.resolve(filename).startsWith(ROOT + path.sep), 'preview_build_path_invalid');
  const manifest = await json(path.join(build.workerDirectory, 'manifest.json'));
  const bindingBytes = await readFile(path.join(build.nextDirectory, 'decision-worker-binding.json'));
  const binding = JSON.parse(bindingBytes), buildId = (await readFile(path.join(build.nextDirectory, 'BUILD_ID'), 'utf8')).trim();
  requireValue(manifest.schemaVersion === 'saitu.worker-build.v7' && manifest.nodeMajor === 24 && binding.schemaVersion === 'saitu.next-worker-binding.v7', 'preview_build_schema_invalid');
  requireValue(manifest.sourceSha256 === build.sourceSha256 && binding.sourceSha256 === build.sourceSha256 && buildId === build.nextBuildId && manifest.nextBuildId === buildId && binding.nextBuildId === buildId, 'preview_source_or_build_changed');
  requireValue(sha(bindingBytes) === manifest.nextBindingSha256 && sha(await readFile(path.join(build.workerDirectory, 'worker.mjs'))) === manifest.artifactSha256 && binding.workerArtifactSha256 === manifest.artifactSha256, 'preview_build_bytes_changed');
  for (const artifact of [manifest, binding]) requireValue(isDeepStrictEqual(artifact.effortPolicy, RANK_NON_THINKING_EFFORT_POLICY) && artifact.effortPolicySha256 === policyEnvironment.SAITU_V7_EFFORT_POLICY_SHA256 && artifact.executionMode === 'user-unbounded' && artifact.detailLayout === 'single' && isDeepStrictEqual(artifact.rankModelSettings, { thinking: 'disabled', policyReasoningEffort: 'low', wireReasoningEffort: null, temperature: 0, topP: 1 }), 'preview_model_settings_changed');
  if (checkSource) requireValue(await currentSource() === build.sourceSha256, 'preview_source_changed_rebuild_required');
  return manifest;
}
export async function buildPreview(version = 'v767-preview.1') {
  requireValue(/^v767-preview\.[1-9][0-9]*$/.test(version), 'preview_version_invalid');
  requireValue(process.cwd() === ROOT && Number(process.versions.node.split('.')[0]) === 24, 'repository_node24_required');
  const versionDirectory = path.join(PREVIEW_ROOT, 'builds', version);
  let revision = 1, directory = versionDirectory;
  // Rebuilds keep the requested release name and preserve every prior artifact.
  while (await access(path.join(directory, 'build.log')).then(() => true, () => false)) {
    revision++; directory = path.join(versionDirectory, `revision-${revision}`);
  }
  const nextName = `.next-local-preview-${version.replace('.', '-')}${revision > 1 ? `-r${revision}` : ''}`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const build = { version, buildRevision: revision, nextDirectory: path.join(ROOT, nextName), workerDirectory: path.join(directory, 'worker') };
  const env = { ...process.env, ...policyEnvironment, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}`, NODE_ENV: 'production', NEXT_DIST_DIR: nextName, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SITE_URL: LOCAL_PREVIEW_ORIGIN,
    AI_PROVIDER: 'deepseek', AI_MODEL: 'deepseek-flash', AI_API_KEY: '', DATABASE_URL: '', AI_TEST_MODE: '0', ALLOW_AI_MOCK: '0', AI_SPEND_RUN_ID: '', AI_SPEND_PHASE: 'reserve', NEXT_PUBLIC_AI_TEST_MODE: '0' };
  const before = await currentSource(), log = await open(path.join(directory, 'build.log'), 'wx', 0o600);
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/competitions/v7/build-worker.mjs', '--output', build.workerDirectory, '--with-next', 'node_modules/next/dist/bin/next'], { cwd: ROOT, env, stdio: ['ignore', log.fd, log.fd] });
      child.once('error', reject); child.once('exit', (value, signal) => resolve(signal ? 1 : value));
    });
    requireValue(code === 0, `preview_build_failed_read_${path.join(directory, 'build.log')}`);
  } finally { await log.close(); }
  const manifest = await json(path.join(build.workerDirectory, 'manifest.json'));
  Object.assign(build, { sourceSha256: before, nextBuildId: manifest.nextBuildId });
  await verifyBuild(build);
  const result = { ...build, schemaVersion: 'saitu.local-preview.build.v1', createdAt: new Date().toISOString(), passed: true, formalAcceptanceCredit: false };
  await writeJson(path.join(directory, 'build-verification.json'), result, true);
  await writeJson(path.join(PREVIEW_ROOT, 'build.json'), result);
  return result;
}
