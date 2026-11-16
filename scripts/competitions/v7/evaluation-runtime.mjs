import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalHash, byteHash, POLICY_VERSION, POLICY_SHA256, EVALUATION_POLICY, isHash } from "./evaluation-policy.mjs";
import { TOP5_EFFORT_GRANT_VERSION, effortPolicyForScope, readConfiguredEffortPolicy, evaluationRuntimeForEffort, requireTop5EvaluationRuntime } from "./evaluation-effort.mjs";
import { USER_UNBOUNDED_EXECUTION_MODE, USER_UNBOUNDED_GRANT_VERSION, USER_UNBOUNDED_EXECUTION_LIMITS, readExecutionMode } from "../../../src/lib/ai/execution-policy.mjs";
import { ADAPTIVE_EXECUTION_POLICY } from "../../lib/adaptive-execution.mjs";
import {readConfiguredDetailLayoutV7} from "../../../src/lib/competitions/v7/detail-layout.mjs";

export const V7_GRANT_VERSION = readExecutionMode() === USER_UNBOUNDED_EXECUTION_MODE ? USER_UNBOUNDED_GRANT_VERSION : TOP5_EFFORT_GRANT_VERSION;
const numeric = (value, fallback, minimum = 0) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > minimum ? parsed : fallback; };
/** Broad authored dependency closure also used by the implementation manifest.
 * Hash data/code bytes only; no artifacts, labels, credentials or .env files. */
function behaviorSources(repositoryRoot) {
  const files = [];
  const walk = directory => {
    for (const name of readdirSync(directory).sort()) {
      const filename = path.join(directory, name), stat = lstatSync(filename);
      if (stat.isSymbolicLink()) throw new Error("symlink_in_runtime_behavior_sources");
      if (stat.isDirectory() && name !== "__pycache__") walk(filename);
      else if (stat.isFile() && name !== ".DS_Store" && !name.endsWith(".pyc")) files.push(filename);
    }
  };
  for (const directory of ["src", "db", "scripts", "ops", "public"]) walk(path.join(repositoryRoot, directory));
  for (const member of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".eslintrc.json", ".eslintignore", "tsconfig.json", "next.config.mjs",
    "postcss.config.mjs", "postcss.config.js", "tailwind.config.ts", "vitest.config.ts", "playwright.config.ts", "tests/fixtures/server-only.ts", "tests/fixtures/mock-spend-ledger.setup.ts"]) {
    const filename = path.join(repositoryRoot, member); if (!existsSync(filename)) continue;
    const stat = lstatSync(filename); if (stat.isSymbolicLink()) throw new Error("symlink_in_runtime_behavior_sources");
    if (stat.isFile()) files.push(filename);
  }
  return files.sort().map(filename => ({ path: path.relative(repositoryRoot, filename), sha256: byteHash(readFileSync(filename)) }));
}
/** Behavior identity deliberately excludes run IDs, funded caps, phase and signing secrets.
 * Complete execution provenance is retained separately by the existing runtime-configuration tool. */
export function runtimeBehaviorConfiguration(environment = process.env) {
  const executionMode = readExecutionMode(environment), unbounded = executionMode === USER_UNBOUNDED_EXECUTION_MODE;
  const detailLayout=readConfiguredDetailLayoutV7(environment), effortRuntime=evaluationRuntimeForEffort(readConfiguredEffortPolicy(environment));
  const provider = environment.AI_PROVIDER?.trim().toLowerCase() || "openai-compatible";
  const endpoint = environment.AI_API_URL?.trim() || (provider === "deepseek" ? "https://api.deepseek.com/chat/completions" : "https://api.openai.com/v1/chat/completions");
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash) throw new Error("credential_bearing_behavior_endpoint_forbidden");
  const concurrency = unbounded ? "adaptive" : Number(environment.SAITU_V7_WORKER_CONCURRENCY ?? 2);
  if (!unbounded && (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)) throw new Error("v7_worker_concurrency_range_1_4");
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const behaviorSourceBindings = behaviorSources(repositoryRoot);
  const modelSource = readFileSync(path.join(repositoryRoot, "src/lib/competitions/v7/model.ts"), "utf8");
  const chatSource = readFileSync(path.join(repositoryRoot, "src/lib/competitions/v7/chat.ts"), "utf8");
  const groupSource = readFileSync(path.join(repositoryRoot, "src/lib/competitions/v7/explanation-groups.ts"), "utf8");
  const governorSource = readFileSync(path.join(repositoryRoot, "src/lib/ai/model-call-governor.ts"), "utf8");
  const contractsSource = readFileSync(path.join(repositoryRoot, "src/lib/competitions/v7/contracts.ts"), "utf8");
  const prompt = (source, expression) => { const value = source.match(expression)?.[1]; if (!value) throw new Error("v7_actual_prompt_version_not_resolved_from_source"); return value; };
  const explainVersion = prompt(modelSource, /DECISION_EXPLAIN_PROMPT_VERSION_V7\s*=\s*["']([^"']+)["']/);
  const groupSuffix = prompt(groupSource, /EXPLANATION_GROUP_PROMPT_VERSION_V7\s*=\s*`\$\{DECISION_EXPLAIN_PROMPT_VERSION_V7\}([^`]+)`/);
  const governorHardMax = unbounded ? null : Number(prompt(governorSource, /MODEL_CALL_TRANSPORT_CONCURRENCY_MAX\s*=\s*([0-9_]+)/).replaceAll("_", ""));
  const governorDefault = key => Number(prompt(governorSource, new RegExp(`positiveInteger\\(["']${key}["'],\\s*([0-9_]+)\\)`)).replaceAll("_", ""));
  const positive = (value, fallback) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback; };
  const governorConfiguredMax = unbounded ? null : positive(environment.AI_CONCURRENCY_MAX, governorHardMax);
  const businessDeadline = key => Number(prompt(contractsSource, new RegExp(`${key}\\s*=\\s*([0-9_]+)`)).replaceAll("_", ""));
  const operationPrompt = operation => {
    const match = chatSource.match(new RegExp(`operation:\\s*["']${operation}["'][\\s\\S]{0,160}?promptVersion:\\s*(?:["']([^"']+)["']|([A-Z][A-Z0-9_]+))`));
    if (match?.[1]) return match[1];
    if (match?.[2]) return prompt(chatSource, new RegExp(`${match[2]}\\s*=\\s*["']([^"']+)["']`));
    throw new Error("v7_actual_operation_prompt_version_not_resolved_from_source");
  };
  const executionPolicy = { policyVersion: prompt(contractsSource, /export const RECOMMENDATION_POLICY_VERSION\s*=\s*["']([^"']+)["']/),
    maxItems: businessDeadline("RECOMMENDATION_MAX_ITEMS"), listTargetMs: businessDeadline("RECOMMENDATION_LIST_DEADLINE_MS"),
    rankHardTimeoutMs: businessDeadline("RECOMMENDATION_RANK_HARD_TIMEOUT_MS"), detailTargetMs: businessDeadline("RECOMMENDATION_DETAIL_TARGET_MS"),
    detailHardTimeoutMs: businessDeadline("RECOMMENDATION_DETAIL_DEADLINE_MS") };
  if (executionPolicy.policyVersion !== POLICY_VERSION || executionPolicy.maxItems !== EVALUATION_POLICY.recommendationMaxItems ||
      executionPolicy.listTargetMs !== EVALUATION_POLICY.performance.firstListP95Ms || executionPolicy.rankHardTimeoutMs !== EVALUATION_POLICY.performance.rankHardTimeoutMs ||
      executionPolicy.detailTargetMs !== EVALUATION_POLICY.performance.allDetailsP95Ms || executionPolicy.detailHardTimeoutMs !== EVALUATION_POLICY.performance.detailHardTimeoutMs)
    throw new Error("evaluation_policy_differs_from_actual_product_execution_contract");
  return { schemaVersion: "saitu.runtime-behavior.v7.3.top5", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    executionMode, ...(unbounded ? { executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS, formalSchedulingPolicy: ADAPTIVE_EXECUTION_POLICY } : {}),
    ...effortRuntime, provider, endpoint: url.href, transportTemperature: effortRuntime.rankModelSettings ? "rank_actual_0_other_thinking_api_default" : "omitted_thinking_api_default",
    candidatePolicy: "full_core_reviewed", maxAttemptsPerStage: 1, invalidOutputRepairsPerStage: 1,
    promptVersions: { ranking: prompt(modelSource, /DECISION_RANK_PROMPT_VERSION_V7\s*=\s*["']([^"']+)["']/), explanation: explainVersion, groupExplanation: `${explainVersion}${groupSuffix}`,
      profile: operationPrompt("competition_v7_extract"), chat: operationPrompt("competition_v7_chat"), chatReview: operationPrompt("competition_v7_chat_review") },
    maxTokens: { rank: 8192, explain: 16384, explanationSupportReview: 16384, profile: 8192, chat: 8192, chatReview: 4096 },
    executionPolicy,
    limits: { maxPromptBytes: 600000, maxResponseBytes: 262144, recommendationMaxItems: executionPolicy.maxItems, firstListDeadlineMs: executionPolicy.listTargetMs,
      rankHardDeadlineMs: executionPolicy.rankHardTimeoutMs, allDetailsTargetMs: executionPolicy.detailTargetMs, allDetailsDeadlineMs: executionPolicy.detailHardTimeoutMs, workerDispatchMarginMs: 750 },
    groupedDetails: { orchestrator: "processDetailGroupsV7", detailLayout, explanationGroupSize: detailLayout==="parallel-2"?3:5, groupIds: detailLayout==="parallel-2"?["g0","g1"]:["g0"], globalOrderPreserved: true,
      preparationBeforeReview: "fsynced_local_business_commit", reviewPreparationBeforeInvoke: "fsynced_local_business_commit", traceAccounting: "unique_original_call_reservation_settlement_rows",
      originalEvidence: "actual_ai_json_result_and_transport_reservation_events_not_pg_provider_receipt", localBudgetAdmission: "synchronous_exact_requestReserveMicros_predebit_and_per_reservation_scope",
      noCriticalAssertions: "no_review_dispatch", falseReview: "preserved_failed_item_no_repair", unknownOutcome: "original_intent_no_regeneration" },
    governor: { policyVersion: prompt(governorSource, /MODEL_CALL_GOVERNOR_POLICY_VERSION\s*=\s*["']([^"']+)["']/),
      transportConcurrencyHardMax: governorHardMax, transportConcurrencyConfiguredMax: governorConfiguredMax, transportConcurrencyEffectiveMax: unbounded ? null : Math.min(governorHardMax, governorConfiguredMax),
      queueMax: unbounded ? null : positive(environment.AI_QUEUE_MAX, governorDefault("AI_QUEUE_MAX")), queueWaitMs: unbounded ? null : positive(environment.AI_QUEUE_WAIT_MS, governorDefault("AI_QUEUE_WAIT_MS")),
      dailyBudget: unbounded ? null : positive(environment.AI_MODEL_CALLS_PER_DAY, governorDefault("AI_MODEL_CALLS_PER_DAY")), budgetTimezoneConfigured: environment.AI_BUDGET_TIMEZONE?.trim() || "Asia/Shanghai",
      databaseConfigured: Boolean(environment.DATABASE_URL?.trim()), nodeEnvironment: environment.NODE_ENV?.trim() || "development", scope: "governed_participants_sharing_the_same_postgresql_gate" },
    transport: { rankExplainDeadlinePolicy: "explicit_remaining_absolute_worker_window_overrides_default", defaultTimeoutMs: numeric(environment.AI_TIMEOUT_MS, 12000, 1000), requestDeadlineMs: Math.floor(numeric(environment.AI_REQUEST_DEADLINE_MS, 45000, 1000)),
      // Explicitly retain this public knob even though the v7 business calls use one transport attempt.
      retryMaxDelayMsConfigured: environment.AI_RETRY_MAX_DELAY_MS?.trim() || null },
    workerConcurrency: concurrency, testMode: environment.AI_TEST_MODE === "1", allowMock: environment.ALLOW_AI_MOCK === "1",
    ephemeralSecurityState: { allowed: environment.E2E_ALLOW_EPHEMERAL_SECURITY_STATE === "1", publicTestMode: environment.NEXT_PUBLIC_AI_TEST_MODE === "1" }, behaviorSourceBindings,
  };
}
export const runtimeBehaviorConfigurationHash = environment => canonicalHash(runtimeBehaviorConfiguration(environment));

/** This checks provenance, never grants authority or writes a budget batch. The live DB gate remains authoritative. */
export function validateExecutionScope(scope, { allowedPhases, allowRankNonThinking = false }) {
  try { requireTop5EvaluationRuntime(evaluationRuntimeForEffort(effortPolicyForScope(scope)), { allowRankNonThinking }); } catch (cause) { throw new Error("v7_actual_bounded_execution_authority_required", { cause }); }
  const unbounded = scope.executionMode === USER_UNBOUNDED_EXECUTION_MODE;
  if (scope.executionMode !== undefined && !["finite", USER_UNBOUNDED_EXECUTION_MODE].includes(scope.executionMode)) throw new Error("registered_execution_mode_invalid");
  if (unbounded ? scope.grantVersion !== USER_UNBOUNDED_GRANT_VERSION || scope.callLimit !== null ||
      canonicalHash(scope.executionLimits ?? null) !== canonicalHash(USER_UNBOUNDED_EXECUTION_LIMITS) ||
      scope.hardLimitMicros !== undefined && scope.hardLimitMicros !== null || scope.hardLimitCny !== undefined && scope.hardLimitCny !== null ||
      !new RegExp(`^saitu-v7-top5-unbounded-20261109-${scope.phase}-[0-9]{2}$`).test(scope.runId ?? "") :
      scope.grantVersion !== TOP5_EFFORT_GRANT_VERSION || !Number.isSafeInteger(scope.callLimit) || scope.callLimit < 1)
    throw new Error("v7_actual_bounded_execution_authority_required");
  if (!Array.isArray(allowedPhases) || !allowedPhases.length || !scope.runId ||
      !allowedPhases.includes(scope.phase) || scope.authorizedPhase !== scope.phase ||
      !isHash(scope.authorizationPolicySha256) || scope.authorizationPolicySha256 !== scope.environmentAuthorizationPolicySha256 ||
      scope.evaluationPolicySha256 !== POLICY_SHA256 || !scope.authorizationPolicySnapshot ||
      scope.authorizationPolicySnapshot.sha256 !== scope.authorizationPolicySha256 || typeof scope.authorizationPolicySnapshot.path !== "string" ||
      !isHash(scope.executionRuntimeConfigurationSha256) ||
      !Number.isFinite(scope.fundingLimitCny) || (unbounded ? scope.fundingLimitCny < 0 : scope.fundingLimitCny <= 0)) throw new Error("v7_actual_bounded_execution_authority_required");
  return scope;
}
