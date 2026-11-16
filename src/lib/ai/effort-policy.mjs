import { createHash } from "node:crypto";
export {USER_UNBOUNDED_EXECUTION_MODE,USER_UNBOUNDED_GRANT_VERSION,TOP5_UNBOUNDED_GRANT_VERSION} from "./execution-policy.mjs";

export const EFFORT_POLICY_VERSION = "saitu.effort-policy.v1";
export const EFFORT_POLICY_VERSION_V2 = "saitu.effort-policy.v2";
export const EFFORT_GRANT_VERSION = "saitu.v7.effort.v1";
export const TOP5_EFFORT_GRANT_VERSION = "saitu.v7.top5.v1";
const stages = ["rank", "explain", "review"];
export function parseEffortPolicy(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && value.version === EFFORT_POLICY_VERSION_V2) {
    const keys = ["version", ...stages, "rankThinking", "rankTemperature"];
    if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) ||
        stages.some(stage => value[stage] !== "low") || value.rankThinking !== "disabled" || value.rankTemperature !== 0) {
      throw new Error("invalid_decision_effort_policy");
    }
    return Object.freeze({ version: EFFORT_POLICY_VERSION_V2, rank: "low", explain: "low", review: "low", rankThinking: "disabled", rankTemperature: 0 });
  }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 4 || Object.keys(value).some(key => !["version", ...stages].includes(key)) ||
      value.version !== EFFORT_POLICY_VERSION || stages.some(stage => !["high", "low"].includes(value[stage]))) {
    throw new Error("invalid_decision_effort_policy");
  }
  return Object.freeze({ version: EFFORT_POLICY_VERSION, rank: value.rank, explain: value.explain, review: value.review });
}
export const LEGACY_DEFAULT_EFFORT_POLICY = parseEffortPolicy({ version: EFFORT_POLICY_VERSION, rank: "high", explain: "high", review: "high" });
export const DEFAULT_EFFORT_POLICY = parseEffortPolicy({ version: EFFORT_POLICY_VERSION, rank: "low", explain: "low", review: "low" });
/** Explicit opt-in only. Existing defaults and all v1 request identities stay unchanged. */
export const RANK_NON_THINKING_EFFORT_POLICY = parseEffortPolicy({ version: EFFORT_POLICY_VERSION_V2, rank: "low", explain: "low", review: "low", rankThinking: "disabled", rankTemperature: 0 });
/** Current compact recommendation experiment permits rank high; downstream
 * stages stay low. Historical policy parsing remains fully lossless. */
export function requireCompactRecommendationEffortPolicy(value) {
  const policy = parseEffortPolicy(value);
  if (policy.version !== EFFORT_POLICY_VERSION) throw new Error("compact_recommendation_requires_v1_effort_policy");
  if (policy.explain !== "low" || policy.review !== "low") throw new Error("compact_recommendation_requires_low_explain_review");
  return policy;
}
/** Separate guard: the historical compact grant can never authorise v2. */
export function requireRankNonThinkingEffortPolicy(value) {
  const policy = parseEffortPolicy(value);
  if (policy.version !== EFFORT_POLICY_VERSION_V2) throw new Error("rank_non_thinking_requires_v2_effort_policy");
  return policy;
}
export function effortPolicySha256(policy) {
  return createHash("sha256").update(JSON.stringify(parseEffortPolicy(policy))).digest("hex");
}
export function resolveEffortForOperation(operation, policy) {
  const validated = parseEffortPolicy(policy);
  if (["competition_v7_chat", "competition_v7_extract", "competition_v7_chat_review", "competition_normalize"].includes(operation)) return "high";
  // The isolated release preflight uses this operation for its fixed rank request.
  if (operation === "competition_recommend") return validated.rank;
  const stage = /^competition_v7_(rank|explain|review)$/.exec(operation)?.[1];
  if (!stage) throw new Error("unsupported_decision_effort_operation");
  return validated[stage];
}
/** Policy effort remains available for accounting; an absent wire effort is
 * intentional only for the explicitly authorised non-thinking rank operation. */
export function resolveDecisionModelSettingsForOperation(operation, policy) {
  const validated = parseEffortPolicy(policy);
  const policyReasoningEffort = resolveEffortForOperation(operation, validated);
  if (validated.version === EFFORT_POLICY_VERSION_V2 && operation === "competition_v7_rank") {
    return Object.freeze({ thinking: "disabled", policyReasoningEffort, temperature: 0, topP: 1 });
  }
  return Object.freeze({ thinking: "enabled", policyReasoningEffort, wireReasoningEffort: policyReasoningEffort,
    ...(operation === "competition_v7_rank" ? { topP: 0.95 } : {}) });
}
export function effortForPolicyTrace(policy) {
  const validated = parseEffortPolicy(policy);
  if (validated.version === EFFORT_POLICY_VERSION_V2) return "mixed";
  return new Set(stages.map(stage => validated[stage])).size === 1 ? validated.rank : "mixed";
}
export function readConfiguredEffortPolicy(environment) {
  // Next and the worker builder freeze these direct reads into their artifacts.
  // An explicit environment remains a pure parser input for tools and tests.
  const raw = environment === undefined ? process.env.SAITU_V7_EFFORT_POLICY : environment.SAITU_V7_EFFORT_POLICY;
  const policy = raw === undefined ? DEFAULT_EFFORT_POLICY : parseEffortPolicy(JSON.parse(raw));
  const expected = environment === undefined ? process.env.SAITU_V7_EFFORT_POLICY_SHA256 : environment.SAITU_V7_EFFORT_POLICY_SHA256;
  if (expected !== undefined && (!/^[a-f0-9]{64}$/.test(expected) || expected !== effortPolicySha256(policy))) {
    throw new Error("decision_effort_policy_hash_mismatch");
  }
  return policy;
}
/** Identical ordering is used by the product, diagnostics and formal producer. */
export function decisionRequestSha256(input) {
  if (input.thinking === "disabled") {
    if (input.operation !== "competition_v7_rank" || input.model !== "deepseek-flash" || input.reasoningEffort !== "low" ||
        input.effortPolicySha256 !== effortPolicySha256(RANK_NON_THINKING_EFFORT_POLICY)) throw new Error("invalid_decision_request_effort_binding");
    if (input.temperature !== 0 || input.topP !== 1) throw new Error("invalid_decision_request_sampling_binding");
    const versionBinding = input.recommendationPolicyVersion === undefined && input.implementationVersion === undefined ? {} :
      { recommendationPolicyVersion: input.recommendationPolicyVersion, implementationVersion: input.implementationVersion };
    if (Object.keys(versionBinding).length && Object.values(versionBinding).some(value => typeof value !== "string" || !value || value.length > 180)) throw new Error("invalid_decision_request_version_binding");
    return createHash("sha256").update(JSON.stringify({ prompt: input.prompt, system: input.system,
      model: input.model, maxTokens: input.maxTokens, promptVersion: input.promptVersion,
      thinking: input.thinking, reasoningEffort: input.reasoningEffort, effortPolicySha256: input.effortPolicySha256, ...versionBinding,
      operation: input.operation, temperature: input.temperature, topP: input.topP })).digest("hex");
  }
  if (input.thinking !== "enabled" || !["high", "low"].includes(input.reasoningEffort) ||
      !/^[a-f0-9]{64}$/.test(input.effortPolicySha256)) throw new Error("invalid_decision_request_effort_binding");
  if (input.topP !== undefined && (!Number.isFinite(input.topP) || input.topP < 0.95 || input.topP > 1)) throw new Error("invalid_decision_request_sampling_binding");
  const versionBinding=input.recommendationPolicyVersion===undefined&&input.implementationVersion===undefined?{}:
    {recommendationPolicyVersion:input.recommendationPolicyVersion,implementationVersion:input.implementationVersion};
  if(Object.keys(versionBinding).length&&Object.values(versionBinding).some(value=>typeof value!=="string"||!value||value.length>180))throw new Error("invalid_decision_request_version_binding");
  return createHash("sha256").update(JSON.stringify({ prompt: input.prompt, system: input.system,
    model: input.model, maxTokens: input.maxTokens, promptVersion: input.promptVersion,
    thinking: input.thinking, reasoningEffort: input.reasoningEffort, effortPolicySha256: input.effortPolicySha256, ...versionBinding,
    ...(input.topP === undefined ? {} : { topP: input.topP }) })).digest("hex");
}
