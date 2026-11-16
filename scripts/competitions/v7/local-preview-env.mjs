// Explicit local preview only. Credentials remain in the existing server environment.
import nextEnv from '@next/env';
import path from 'node:path';
import { ROOT, json, verifyBuild, requireValue, policyEnvironment } from './local-preview-build.mjs';
import { LOCAL_PREVIEW_AUTHORIZATION_POLICY, LOCAL_PREVIEW_ORIGIN, isLocalPreviewBinding } from '../../../src/lib/ai/execution-policy.mjs';

const filename = process.env.SAITU_LOCAL_PREVIEW_CONFIG;
requireValue(typeof filename === 'string' && path.resolve(filename).startsWith(path.join(ROOT, 'artifacts/local-preview-v767/runs/')), 'local_preview_config_required');
export const config = await json(filename);
requireValue(config.schemaVersion === 'saitu.local-preview.runtime.v1' && config.origin === LOCAL_PREVIEW_ORIGIN && isLocalPreviewBinding(config.binding), 'local_preview_config_invalid');
await import(path.join(config.budgetDirectory, 'safe-env.mjs'));
const receipt = await json(path.join(config.budgetDirectory, 'receipt.json')), batch = receipt.batch;
requireValue(receipt.command === 'open' && batch?.phase === 'reserve' && batch.runPurpose === 'local_preview' && batch.authorizationPolicySource === LOCAL_PREVIEW_AUTHORIZATION_POLICY && JSON.stringify(batch.localPreview) === JSON.stringify(config.binding), 'local_preview_grant_binding_invalid');
const manifest = await verifyBuild(config.build);
requireValue(config.binding.applicationRuntimeSourceSha256 === config.build.sourceSha256 && config.binding.productionBuildId === manifest.nextBuildId && config.binding.workerArtifactSha256 === manifest.artifactSha256 && config.binding.nextBindingSha256 === manifest.nextBindingSha256, 'local_preview_compiled_binding_invalid');
const overlay = { ...policyEnvironment,
  NODE_ENV: 'production', AI_PROVIDER: 'deepseek', AI_MODEL: 'deepseek-flash', AI_API_URL: 'https://api.deepseek.com/chat/completions',
  AI_COMPETITION_NORMALIZE_MODEL: 'deepseek-flash', AI_COMPETITION_CLARIFY_MODEL: 'deepseek-flash', AI_COMPETITION_RECOMMEND_MODEL: 'deepseek-flash',
  SAITU_DECISION_STRATEGY: 'llm', AI_REASONING_EFFORT: 'high', AI_TEST_MODE: '0', ALLOW_AI_MOCK: '0', NEXT_PUBLIC_AI_TEST_MODE: '0', E2E_ALLOW_EPHEMERAL_SECURITY_STATE: '0',
  AI_CONCURRENCY_MAX: '', SAITU_V7_WORKER_CONCURRENCY: '', AI_TIMEOUT_MS: '30000', AI_REQUEST_DEADLINE_MS: '45000', AI_RETRY_MAX_DELAY_MS: '5000', AI_BUDGET_TIMEZONE: 'Asia/Shanghai', FEATURE_COMPETITION_RECOMMENDER: '1',
  APP_RELEASE_DIR: ROOT, SAITU_V7_LOCAL_PREVIEW: '1', SAITU_V7_WORKER_ACTIVE_LINK: path.join(config.runtimeDirectory, 'current'),
  SAITU_V7_WORKER_HEALTH_FILE: path.join(config.runtimeDirectory, 'worker-health.json'), NEXT_PUBLIC_SITE_URL: LOCAL_PREVIEW_ORIGIN,
  NEXT_DIST_DIR: path.relative(ROOT, config.build.nextDirectory), SAITU_V7_SOURCE_SHA256: config.build.sourceSha256,
  SAITU_LOCAL_PREVIEW_BUILD_ID: manifest.nextBuildId, SAITU_LOCAL_PREVIEW_WORKER_SHA256: manifest.artifactSha256, SAITU_LOCAL_PREVIEW_NEXT_BINDING_SHA256: manifest.nextBindingSha256,
};
Object.assign(process.env, overlay);
const scopeKeys = ['SAITU_AI_EXECUTION_MODE', 'AI_SPEND_RUN_ID', 'AI_SPEND_PHASE', 'AI_SPEND_LIMIT_CNY', 'AI_SPEND_FUNDED_CNY', 'AI_CALIBRATION_CALL_LIMIT', 'AI_SPEND_AUTHORIZED_EFFORT', 'AI_SPEND_HIGH_CONDITION_SHA256', 'AI_SPEND_EFFORT_CONDITION_SHA256', 'AI_SPEND_POLICY_SHA256'];
nextEnv.updateInitialEnv({ ...overlay, ...Object.fromEntries(scopeKeys.map(key => [key, process.env[key] ?? ''])) });
