#!/usr/bin/env node
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { installSourceLoader } from '../../lib/load-typescript-source.mjs';

const args = process.argv.slice(2);
let output = path.resolve('dist/decision-worker'), nextExecutable;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--output' && args[index + 1]) output = path.resolve(args[++index]);
  else if (args[index] === '--with-next' && args[index + 1]) nextExecutable = path.resolve(args[++index]);
  else if (args[index] !== '--binding-only') throw new Error('Usage: build-worker.mjs [--output DIRECTORY] [--with-next NEXT_BINARY] [--binding-only]');
}
// A caller-provided binding must never freeze stale code into a new artifact.
delete process.env.SAITU_V7_SOURCE_SHA256;
const previousMode = process.env.NODE_ENV;
process.env.NODE_ENV = 'development';
installSourceLoader(process.cwd());
const { readConfiguredEffortPolicy, effortPolicySha256, resolveDecisionModelSettingsForOperation } = await import('../../../src/lib/ai/effort-policy.mjs');
const effortPolicy = readConfiguredEffortPolicy();
const effortPolicySha = effortPolicySha256(effortPolicy);
const rankSettings = effortPolicy.version === 'saitu.effort-policy.v2' ? resolveDecisionModelSettingsForOperation('competition_v7_rank', effortPolicy) : null;
// Keep accounting effort separate from the absent provider reasoning_effort.
// Old v1 build manifests and bindings do not gain inferred sampling fields.
const rankModelSettings = rankSettings ? { thinking: rankSettings.thinking, policyReasoningEffort: rankSettings.policyReasoningEffort, wireReasoningEffort: rankSettings.wireReasoningEffort ?? null, temperature: rankSettings.temperature, topP: rankSettings.topP } : null;
const {readExecutionMode}=await import('../../../src/lib/ai/execution-policy.mjs');
const executionMode=readExecutionMode();
const {readConfiguredDetailLayoutV7}=await import('../../../src/lib/competitions/v7/detail-layout.mjs');
const detailLayout=readConfiguredDetailLayoutV7();
process.env.SAITU_V7_DETAIL_LAYOUT=detailLayout;
process.env.SAITU_V7_EFFORT_POLICY = JSON.stringify(effortPolicy);
process.env.SAITU_V7_EFFORT_POLICY_SHA256 = effortPolicySha;
const { recommendationRuntimeBindingV7 } = await import('../../../src/lib/competitions/v7/runtime-binding.ts');
const sourceSha256 = recommendationRuntimeBindingV7();
if (previousMode === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = previousMode;
if (args.includes('--binding-only')) {
  process.stdout.write(`${sourceSha256}\n`);
} else {
  const require = createRequire(import.meta.url);
  // The reviewed Vite toolchain already pins esbuild. No new dependency or
  // package-manager resolution enters the production worker.
  const vitestRequire = createRequire(require.resolve('vitest/package.json'));
  const viteRequire = createRequire(vitestRequire.resolve('vite/package.json'));
  const esbuild = viteRequire('esbuild');
  await mkdir(output, { recursive: true });
  const result = await esbuild.build({
    entryPoints: ['scripts/competitions/v7/worker-entry.ts'],
    outfile: path.join(output, 'worker.mjs'), bundle: true, platform: 'node',
    target: 'node24', format: 'esm', packages: 'external', metafile: true,
    define: { 'process.env.SAITU_V7_SOURCE_SHA256': JSON.stringify(sourceSha256),
      'process.env.SAITU_V7_EFFORT_POLICY': JSON.stringify(JSON.stringify(effortPolicy)),
      'process.env.SAITU_V7_EFFORT_POLICY_SHA256': JSON.stringify(effortPolicySha),
      'process.env.SAITU_V7_DETAIL_LAYOUT': JSON.stringify(detailLayout),
      'process.env.SAITU_AI_EXECUTION_MODE':JSON.stringify(executionMode) },
    plugins: [{ name: 'server-only-marker', setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'marker' }));
      build.onLoad({ filter: /.*/, namespace: 'marker' }, () => ({ contents: 'export {};', loader: 'js' }));
    } }]
  });
  const artifactSha256 = createHash('sha256').update(await readFile(path.join(output, 'worker.mjs'))).digest('hex');
  const manifest = { schemaVersion: 'saitu.worker-build.v7', sourceSha256, artifactSha256, nodeMajor: 24, inputs: Object.keys(result.metafile.inputs).sort(), effortPolicy, effortPolicySha256: effortPolicySha,...(rankModelSettings?{rankModelSettings}:{}),detailLayout,...(executionMode==='user-unbounded'?{executionMode}:{}) };
  if (nextExecutable) {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [nextExecutable, 'build'], {
        stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production', SAITU_V7_SOURCE_SHA256: sourceSha256 }
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
    });
    if (exitCode !== 0) throw new Error('V7_NEXT_BUILD_FAILED');
    const nextRoot = path.resolve(process.env.NEXT_DIST_DIR || '.next');
    manifest.nextBuildId = (await readFile(path.join(nextRoot, 'BUILD_ID'), 'utf8')).trim();
    const binding = `${JSON.stringify({ schemaVersion: 'saitu.next-worker-binding.v7', sourceSha256, workerArtifactSha256: artifactSha256, nextBuildId: manifest.nextBuildId, effortPolicy, effortPolicySha256: effortPolicySha,...(rankModelSettings?{rankModelSettings}:{}),detailLayout,...(executionMode==='user-unbounded'?{executionMode}:{}) }, null, 2)}\n`;
    await writeFile(path.join(nextRoot, 'decision-worker-binding.json'), binding);
    manifest.nextBindingSha256 = createHash('sha256').update(binding).digest('hex');
  }
  process.env.NODE_ENV = 'development';
  if (recommendationRuntimeBindingV7() !== sourceSha256) throw new Error('V7_SOURCE_CHANGED_DURING_BUILD');
  if (previousMode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousMode;
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.info(JSON.stringify({ output, sourceSha256, artifactSha256, nextBuildId: manifest.nextBuildId ?? null }));
}
