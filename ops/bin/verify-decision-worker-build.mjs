#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [releaseRoot, ...options] = process.argv.slice(2);
if (!releaseRoot || !path.isAbsolute(releaseRoot) || new Set(options).size !== options.length || options.some(option => !['--worker-only', '--local-development'].includes(option))) throw new Error('usage: verify-decision-worker-build.mjs ABSOLUTE_RELEASE [--worker-only] [--local-development]');
const workerOnly = options.includes('--worker-only');
// The v2 non-thinking trial is authorized for local execution only. Production
// callers retain the original v1 gate. This flag does not authorize PM2 or a
// signed release, whose independent policy parsers remain v1-only.
const localDevelopment = options.includes('--local-development');
const root = fs.realpathSync(releaseRoot);
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
function bytes(relative) {
  const filename = path.join(root, relative), metadata = fs.lstatSync(filename);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || fs.realpathSync(filename) !== filename) throw new Error(`unsafe worker build member: ${relative}`);
  return fs.readFileSync(filename);
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(bytes('dist/decision-worker/manifest.json'));
if (manifest.schemaVersion !== 'saitu.worker-build.v7' || manifest.nodeMajor !== 24 || !hex(manifest.sourceSha256) || !hex(manifest.artifactSha256) || manifest.artifactSha256 !== hash(bytes('dist/decision-worker/worker.mjs'))) throw new Error('V7_WORKER_ARTIFACT_BINDING_FAILED');
const effortRequired = fs.existsSync(path.join(root,'src/lib/ai/effort-policy.mjs'));
const carriesEffort = Object.hasOwn(manifest,'effortPolicy') || Object.hasOwn(manifest,'effortPolicySha256');
const carriesExecutionMode=Object.hasOwn(manifest,'executionMode');
const carriesDetailLayout=Object.hasOwn(manifest,'detailLayout');
const detailLayoutRequired=fs.existsSync(path.join(root,'src/lib/competitions/v7/detail-layout.mjs'));
if(detailLayoutRequired&&!carriesDetailLayout)throw new Error('V7_WORKER_DETAIL_LAYOUT_REQUIRED');
if(carriesDetailLayout&&!['single','parallel-2'].includes(manifest.detailLayout))throw new Error('V7_WORKER_DETAIL_LAYOUT_INVALID');
const executionRequired=fs.existsSync(path.join(root,'src/lib/ai/execution-policy.mjs'))||fs.existsSync(path.join(root,'db/migrations/20261109_spend_user_unbounded_execution.sql'));
if(executionRequired&&!carriesExecutionMode)throw new Error('V7_WORKER_EXECUTION_MODE_REQUIRED');
if(carriesExecutionMode&&manifest.executionMode!=='user-unbounded')throw new Error('V7_WORKER_EXECUTION_MODE_INVALID');
let effortPolicy, effortPolicySha256, rankModelSettings;
if (effortRequired || carriesEffort) {
 const p=manifest.effortPolicy;
 const v1=p&&Object.keys(p).sort().join(',')==='explain,rank,review,version'&&p.version==='saitu.effort-policy.v1'&&['rank','explain','review'].every(stage=>['high','low'].includes(p[stage]));
 const v2=p&&Object.keys(p).sort().join(',')==='explain,rank,rankTemperature,rankThinking,review,version'&&p.version==='saitu.effort-policy.v2'&&['rank','explain','review'].every(stage=>p[stage]==='low')&&p.rankThinking==='disabled'&&p.rankTemperature===0;
 if(!v1&&!v2)throw new Error('V7_WORKER_EFFORT_POLICY_REQUIRED');
 if(v2&&!localDevelopment)throw new Error('V7_WORKER_EFFORT_POLICY_LOCAL_ONLY');
 effortPolicy={version:p.version,rank:p.rank,explain:p.explain,review:p.review,...(v2?{rankThinking:p.rankThinking,rankTemperature:p.rankTemperature}:{})}; effortPolicySha256=hash(JSON.stringify(effortPolicy));
 if(manifest.effortPolicySha256!==effortPolicySha256)throw new Error('V7_WORKER_EFFORT_POLICY_MISMATCH');
 if(v2)rankModelSettings={thinking:'disabled',policyReasoningEffort:'low',wireReasoningEffort:null,temperature:0,topP:1};
}
if(rankModelSettings ? JSON.stringify(manifest.rankModelSettings)!==JSON.stringify(rankModelSettings) : Object.hasOwn(manifest,'rankModelSettings'))throw new Error('V7_WORKER_RANK_MODEL_SETTINGS_MISMATCH');
if (!workerOnly) {
  const bindingBytes = bytes('.next/decision-worker-binding.json');
  const binding = JSON.parse(bindingBytes);
  const nextBuildId = bytes('.next/BUILD_ID').toString('utf8').trim();
  const nextConfig = JSON.parse(bytes('.next/required-server-files.json')).config;
  if(carriesDetailLayout ? binding.detailLayout!==manifest.detailLayout||nextConfig?.env?.SAITU_V7_DETAIL_LAYOUT!==manifest.detailLayout : Object.hasOwn(binding,'detailLayout')||nextConfig?.env?.SAITU_V7_DETAIL_LAYOUT!==undefined)throw new Error('V7_NEXT_WORKER_DETAIL_LAYOUT_MISMATCH');
  if(carriesExecutionMode ? binding.executionMode!==manifest.executionMode||nextConfig?.env?.SAITU_AI_EXECUTION_MODE!==manifest.executionMode : Object.hasOwn(binding,'executionMode')||nextConfig?.env?.SAITU_AI_EXECUTION_MODE!==undefined)throw new Error('V7_NEXT_WORKER_EXECUTION_MODE_MISMATCH');
  if(effortPolicySha256 ? binding.effortPolicySha256!==effortPolicySha256||JSON.stringify(binding.effortPolicy)!==JSON.stringify(effortPolicy)||nextConfig?.env?.SAITU_V7_EFFORT_POLICY!==JSON.stringify(effortPolicy)||nextConfig?.env?.SAITU_V7_EFFORT_POLICY_SHA256!==effortPolicySha256 : Object.hasOwn(binding,'effortPolicy')||Object.hasOwn(binding,'effortPolicySha256')||nextConfig?.env?.SAITU_V7_EFFORT_POLICY!==undefined||nextConfig?.env?.SAITU_V7_EFFORT_POLICY_SHA256!==undefined)throw new Error('V7_NEXT_WORKER_EFFORT_MISMATCH');
  if(rankModelSettings ? JSON.stringify(binding.rankModelSettings)!==JSON.stringify(rankModelSettings) : Object.hasOwn(binding,'rankModelSettings'))throw new Error('V7_NEXT_WORKER_RANK_MODEL_SETTINGS_MISMATCH');
  if (!hex(manifest.nextBindingSha256) || hash(bindingBytes) !== manifest.nextBindingSha256 || binding.schemaVersion !== 'saitu.next-worker-binding.v7' || binding.sourceSha256 !== manifest.sourceSha256 || binding.workerArtifactSha256 !== manifest.artifactSha256 || nextConfig?.env?.SAITU_V7_SOURCE_SHA256 !== manifest.sourceSha256 || !nextBuildId || binding.nextBuildId !== nextBuildId || manifest.nextBuildId !== nextBuildId) throw new Error('V7_NEXT_WORKER_BUILD_MISMATCH');
}
console.info(JSON.stringify({ schemaVersion: 'saitu.worker-build-verification.v7', status: 'passed', sourceSha256: manifest.sourceSha256, artifactSha256: manifest.artifactSha256, nextBuildId: manifest.nextBuildId ?? null, ...(effortPolicySha256 ? {effortPolicySha256} : {}),...(carriesExecutionMode?{executionMode:manifest.executionMode}:{}),...(localDevelopment?{localDevelopment:true}:{}) }));
