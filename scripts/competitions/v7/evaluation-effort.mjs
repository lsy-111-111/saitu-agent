import { DEFAULT_EFFORT_POLICY, LEGACY_DEFAULT_EFFORT_POLICY, EFFORT_GRANT_VERSION, TOP5_EFFORT_GRANT_VERSION, parseEffortPolicy, effortPolicySha256, effortForPolicyTrace,
  resolveEffortForOperation, readConfiguredEffortPolicy, requireCompactRecommendationEffortPolicy, resolveDecisionModelSettingsForOperation, requireRankNonThinkingEffortPolicy } from "../../../src/lib/ai/effort-policy.mjs";
import { EVALUATION_POLICY, LEGACY_EVALUATION_RUNTIME, same } from "./evaluation-policy.mjs";
import { USER_UNBOUNDED_GRANT_VERSION, RANK_NONTHINKING_AUTHORIZATION_POLICY, RANK_NONTHINKING_TRIAL_SLOTS } from "../../../src/lib/ai/execution-policy.mjs";
export { USER_UNBOUNDED_EXECUTION_MODE, USER_UNBOUNDED_GRANT_VERSION, USER_UNBOUNDED_AUTHORIZATION_POLICY,
  USER_UNBOUNDED_EXECUTION_LIMITS, readExecutionMode, isUserUnboundedExecutionMode } from "../../../src/lib/ai/execution-policy.mjs";

export { DEFAULT_EFFORT_POLICY, LEGACY_DEFAULT_EFFORT_POLICY, EFFORT_GRANT_VERSION, TOP5_EFFORT_GRANT_VERSION, parseEffortPolicy, effortPolicySha256, resolveEffortForOperation, readConfiguredEffortPolicy, resolveDecisionModelSettingsForOperation };
const fail = message => { throw new Error(message); };
export function evaluationRuntimeForEffort(policy) {
  const effortPolicy = parseEffortPolicy(policy);
  const rank = resolveDecisionModelSettingsForOperation("competition_v7_rank", effortPolicy);
  return { ...EVALUATION_POLICY.runtime, reasoningEffort: effortForPolicyTrace(effortPolicy), effortPolicy, effortPolicySha256: effortPolicySha256(effortPolicy),
    ...(rank.thinking === "disabled" ? { thinking: "stage", rankModelSettings: { ...rank, wireReasoningEffort: null } } : {}) };
}
/** The old exact all-high record stays readable. New runs bind all three stages. */
export function validateEvaluationRuntime(runtime, { requireStagePolicy = false } = {}) {
  if (same(runtime, LEGACY_EVALUATION_RUNTIME)) {
    if (requireStagePolicy) fail("new_execution_requires_frozen_stage_effort_policy");
    return LEGACY_DEFAULT_EFFORT_POLICY;
  }
  const policy = parseEffortPolicy(runtime?.effortPolicy);
  if (!same(runtime, evaluationRuntimeForEffort(policy))) fail("frozen_evaluation_runtime_effort_policy_changed");
  return policy;
}
export function requireTop5EvaluationRuntime(runtime, { allowRankNonThinking = false } = {}) {
  const policy = validateEvaluationRuntime(runtime, { requireStagePolicy: true });
  if (allowRankNonThinking && policy.version === "saitu.effort-policy.v2") return requireRankNonThinkingEffortPolicy(policy);
  return requireCompactRecommendationEffortPolicy(policy);
}
export function effortPolicyForScope(scope) {
  if ([EFFORT_GRANT_VERSION, TOP5_EFFORT_GRANT_VERSION, USER_UNBOUNDED_GRANT_VERSION].includes(scope?.grantVersion) && scope.authorizedEffort === "stage") {
    const policy = parseEffortPolicy(scope.effortPolicy);
    if (scope.effortPolicySha256 !== effortPolicySha256(policy)) fail("execution_scope_effort_policy_hash_changed");
    return policy;
  }
  if (scope?.grantVersion === "saitu.v7" && scope.authorizedEffort === "high" &&
      (scope.effortPolicy === undefined || same(scope.effortPolicy, LEGACY_DEFAULT_EFFORT_POLICY)) &&
      (scope.effortPolicySha256 === undefined || scope.effortPolicySha256 === effortPolicySha256(LEGACY_DEFAULT_EFFORT_POLICY))) return LEGACY_DEFAULT_EFFORT_POLICY;
  fail("registered_stage_effort_grant_required");
}
export function assertSameEffortPolicy(actual, expected) {
  if (effortPolicySha256(actual) !== effortPolicySha256(expected)) fail("frozen_stage_effort_policy_changed");
}
/** Explicit continuation marker only. Async entrypoints also verify its actual proof bytes. */
export function rankNonThinkingContinuationForScope(scope) {
  if (scope?.effortPolicy?.version !== "saitu.effort-policy.v2") return null;
  const policy = requireRankNonThinkingEffortPolicy(scope.effortPolicy), continuation = scope.pilotContinuation;
  const source = scope.authorizationPolicySource ?? scope.sourcePolicy ?? scope.authorizationPolicySnapshot?.path ?? scope.approvedPolicyPath;
  const normalized = typeof source === "string" ? source.replaceAll("\\", "/") : "";
  if (!(normalized === RANK_NONTHINKING_AUTHORIZATION_POLICY || normalized.endsWith(`/${RANK_NONTHINKING_AUTHORIZATION_POLICY}`)) ||
      !["formal", "performance", "repair", "reserve"].includes(scope.phase) || !continuation || continuation.complete !== 3 ||
      continuation.detailLayout !== "single" || continuation.effortPolicySha256 !== effortPolicySha256(policy) ||
      !Array.isArray(continuation.slotIds) || !same(continuation.slotIds, RANK_NONTHINKING_TRIAL_SLOTS) || typeof continuation.proofFile !== "string" ||
      ![continuation.proofSha256, continuation.sourceBindingsSha256, continuation.pilotExecutionSha256, continuation.pilotPlanSha256].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)))
    fail("rank_nonthinking_verified_continuation_required");
  return continuation;
}
export function assertDispatchEffort(details, policy, { legacy = false } = {}) {
  if (legacy) {
    if (details?.reasoningEffort !== "high" || details?.thinkingType !== "enabled") fail("legacy_dispatch_must_remain_high");
    return;
  }
  const settings = resolveDecisionModelSettingsForOperation(details?.operation, policy);
  if (details?.thinkingType !== settings.thinking || details?.effortPolicySha256 !== effortPolicySha256(policy)) fail("dispatch_differs_from_frozen_stage_effort_policy");
  if (settings.thinking === "disabled") {
    if (details.reasoningEffort !== undefined || details.wireReasoningEffort !== null || details.policyReasoningEffort !== settings.policyReasoningEffort ||
        details.temperature !== 0 || details.topP !== 1) fail("non_thinking_rank_dispatch_mode_or_sampling_changed");
  } else if (details.reasoningEffort !== settings.wireReasoningEffort) fail("dispatch_differs_from_frozen_stage_effort_policy");
}
export function assertLedgerEffort(row, policy, { legacy = false } = {}) {
  if (legacy) { if (row?.effort !== "high") fail("legacy_ledger_must_remain_high"); return; }
  if (row?.effort !== resolveEffortForOperation(row?.operation, policy) || row?.effort_policy_sha256 !== effortPolicySha256(policy)) fail("ledger_differs_from_frozen_stage_effort_policy");
}
export function callOperation(call) {
  if (typeof call?.operation === "string") return call.operation;
  const stage = /^v7\.(rank|explain|review)(?::|$)/.exec(call?.call_key ?? "")?.[1];
  if (stage) return `competition_v7_${stage}`;
  fail("original_call_operation_binding_required");
}
export function assertCallEffort(call, policy, { legacy = false } = {}) {
  if (legacy) { if (call?.effort !== "high") fail("legacy_call_must_remain_high"); return; }
  const operation = call?.call_operation, settings = resolveDecisionModelSettingsForOperation(operation, policy), expectedEffort = settings.policyReasoningEffort, hash = effortPolicySha256(policy);
  if (call?.call_thinking !== settings.thinking || call?.call_reasoning_effort !== expectedEffort || call?.call_effort_policy_sha256 !== hash ||
      call?.operation !== operation || call?.effort !== expectedEffort || call?.effort_policy_sha256 !== hash) fail("original_call_differs_from_frozen_stage_effort_policy");
  const stage = /^v7\.(rank|explain|review)(?::|$)/.exec(call?.call_key ?? "")?.[1];
  if (stage && operation !== `competition_v7_${stage}`) fail("original_call_key_operation_changed");
  const chatStage = /:v7\.(chat|review)$/.exec(call?.call_key ?? "")?.[1];
  if (chatStage && operation !== (chatStage === "chat" ? "competition_v7_chat" : "competition_v7_chat_review")) fail("original_chat_call_key_operation_changed");
}
