import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decisionEffortPolicySchema } from "@/lib/ai/effort-contract.mjs";
import { DEFAULT_EFFORT_POLICY, LEGACY_DEFAULT_EFFORT_POLICY, RANK_NON_THINKING_EFFORT_POLICY,
  EFFORT_POLICY_VERSION, EFFORT_POLICY_VERSION_V2, parseEffortPolicy, effortPolicySha256, effortForPolicyTrace,
  readConfiguredEffortPolicy, requireCompactRecommendationEffortPolicy, requireRankNonThinkingEffortPolicy,
  resolveEffortForOperation, resolveDecisionModelSettingsForOperation, decisionRequestSha256 } from "@/lib/ai/effort-policy.mjs";

// Frozen before v2 implementation. These are legacy request identities, never live outputs.
const legacyRequestVectors = [
  {
    "input": {
      "prompt": "synthetic policy preservation prompt",
      "system": "synthetic system",
      "model": "deepseek-flash",
      "maxTokens": 8192,
      "promptVersion": "original-v1",
      "thinking": "enabled",
      "reasoningEffort": "low",
      "effortPolicySha256": "04962f576d20346af8a8f076ce64fdbda5aea13fdbd2fae39f3c7456fe30aa48"
    },
    "sha256": "4b250ed0a92d5d301fb32b4258c9bf0912e135ed9397d8e9250539d54ecc3b4a"
  },
  {
    "input": {
      "prompt": "synthetic policy preservation prompt",
      "system": "synthetic system",
      "model": "deepseek-flash",
      "maxTokens": 8192,
      "promptVersion": "original-v1",
      "thinking": "enabled",
      "reasoningEffort": "low",
      "effortPolicySha256": "04962f576d20346af8a8f076ce64fdbda5aea13fdbd2fae39f3c7456fe30aa48",
      "topP": 0.95
    },
    "sha256": "ac62ec47ee3daf0b84470c29182a31547d5e22ec7a6708c5c852150acad3cf12"
  },
  {
    "input": {
      "prompt": "synthetic policy preservation prompt",
      "system": "synthetic system",
      "model": "deepseek-flash",
      "maxTokens": 8192,
      "promptVersion": "original-v1",
      "thinking": "enabled",
      "reasoningEffort": "low",
      "effortPolicySha256": "04962f576d20346af8a8f076ce64fdbda5aea13fdbd2fae39f3c7456fe30aa48",
      "topP": 1
    },
    "sha256": "384a09488361f09ecede96dbe0c60c05275baf598bd7b80421270647bc41ba34"
  },
  {
    "input": {
      "prompt": "synthetic policy preservation prompt",
      "system": "synthetic system",
      "model": "deepseek-flash",
      "maxTokens": 8192,
      "promptVersion": "original-v1",
      "thinking": "enabled",
      "reasoningEffort": "low",
      "effortPolicySha256": "04962f576d20346af8a8f076ce64fdbda5aea13fdbd2fae39f3c7456fe30aa48",
      "recommendationPolicyVersion": "saitu.policy.2026-11-09.v7.top5",
      "implementationVersion": "saitu.async.2026-11-09.v7.3.top5"
    },
    "sha256": "2d47bb57203c5430233c4387fdfc1834dbc6663eccafd218b57d4c64e3ddf09a"
  },
  {
    "input": {
      "prompt": "synthetic policy preservation prompt",
      "system": "synthetic system",
      "model": "deepseek-flash",
      "maxTokens": 8192,
      "promptVersion": "original-v1",
      "thinking": "enabled",
      "reasoningEffort": "low",
      "effortPolicySha256": "04962f576d20346af8a8f076ce64fdbda5aea13fdbd2fae39f3c7456fe30aa48",
      "temperature": 0
    },
    "sha256": "4b250ed0a92d5d301fb32b4258c9bf0912e135ed9397d8e9250539d54ecc3b4a"
  },
  {
    "input": {
      "prompt": "synthetic policy preservation prompt",
      "system": "synthetic system",
      "model": "deepseek-flash",
      "maxTokens": 8192,
      "promptVersion": "original-v1",
      "thinking": "enabled",
      "reasoningEffort": "low",
      "effortPolicySha256": "04962f576d20346af8a8f076ce64fdbda5aea13fdbd2fae39f3c7456fe30aa48",
      "temperature": 1,
      "operation": "competition_v7_rank"
    },
    "sha256": "4b250ed0a92d5d301fb32b4258c9bf0912e135ed9397d8e9250539d54ecc3b4a"
  }
] as const;
const v2 = { version: "saitu.effort-policy.v2", rank: "low", explain: "low", review: "low", rankThinking: "disabled", rankTemperature: 0 } as const;
const v2Sha = "ecd106664dd8656d6a3be9076b8e03f5b32da0c2c5c1c94e2efaf4a2b1da71eb";
const disabledRequest = { prompt: "a synthetic rank prompt", system: "synthetic rank system", model: "deepseek-flash", maxTokens: 8192,
  promptVersion: "synthetic-v2-rank", thinking: "disabled", reasoningEffort: "low", effortPolicySha256: v2Sha,
  recommendationPolicyVersion: "saitu.policy.2026-11-09.v7.top5", implementationVersion: "saitu.async.2026-11-09.v7.3.top5",
  operation: "competition_v7_rank", temperature: 0, topP: 1 } as const;

describe("strict opt-in non-thinking rank policy", () => {
  it("keeps both historical defaults, v1 shape and pre-change policy fingerprints", () => {
    expect(EFFORT_POLICY_VERSION).toBe("saitu.effort-policy.v1");
    expect(JSON.stringify(DEFAULT_EFFORT_POLICY)).toBe('{"version":"saitu.effort-policy.v1","rank":"low","explain":"low","review":"low"}');
    expect(effortPolicySha256(DEFAULT_EFFORT_POLICY)).toBe("04962f576d20346af8a8f076ce64fdbda5aea13fdbd2fae39f3c7456fe30aa48");
    expect(effortPolicySha256(LEGACY_DEFAULT_EFFORT_POLICY)).toBe("00977233fa809e28830ee25457a564c70e72bfc7654161e3ae62db2e38e3cd8c");
    expect(effortPolicySha256({ version: "saitu.effort-policy.v1", rank: "high", explain: "low", review: "low" })).toBe("6feeab682f15bb044df79766a7ffe8eb12352b4d9a1f60a3b93bcd71c8510988");
    expect(decisionEffortPolicySchema.parse(DEFAULT_EFFORT_POLICY)).toEqual(DEFAULT_EFFORT_POLICY);
    expect(parseEffortPolicy(DEFAULT_EFFORT_POLICY)).not.toHaveProperty("rankThinking");
    expect(parseEffortPolicy(DEFAULT_EFFORT_POLICY)).not.toHaveProperty("rankTemperature");
    expect(readConfiguredEffortPolicy({})).toEqual(DEFAULT_EFFORT_POLICY);
  });

  it.each(legacyRequestVectors)("preserves a frozen pre-v2 enabled digest", ({ input, sha256 }) => {
    expect(decisionRequestSha256(input)).toBe(sha256);
    expect(decisionRequestSha256({ ...input, operation: "competition_v7_rank", temperature: Number.POSITIVE_INFINITY })).toBe(sha256);
  });

  it("accepts exactly six canonical v2 fields, freezes them and binds field-order independently", () => {
    expect(EFFORT_POLICY_VERSION_V2).toBe(v2.version);
    expect(RANK_NON_THINKING_EFFORT_POLICY).toEqual(v2);
    expect(Object.keys(parseEffortPolicy(v2))).toEqual(["version", "rank", "explain", "review", "rankThinking", "rankTemperature"]);
    expect(Object.isFrozen(parseEffortPolicy(v2))).toBe(true);
    expect(effortPolicySha256(v2)).toBe(v2Sha);
    const reordered = { rankTemperature: 0, rankThinking: "disabled", review: "low", explain: "low", rank: "low", version: v2.version };
    expect(effortPolicySha256(parseEffortPolicy(reordered))).toBe(v2Sha);
    expect(JSON.stringify(decisionEffortPolicySchema.parse(reordered))).toBe(JSON.stringify(v2));
    expect(readConfiguredEffortPolicy({ SAITU_V7_EFFORT_POLICY: JSON.stringify(v2), SAITU_V7_EFFORT_POLICY_SHA256: v2Sha })).toEqual(v2);
    expect(() => readConfiguredEffortPolicy({ SAITU_V7_EFFORT_POLICY: JSON.stringify(v2), SAITU_V7_EFFORT_POLICY_SHA256: effortPolicySha256(DEFAULT_EFFORT_POLICY) })).toThrow("decision_effort_policy_hash_mismatch");
  });

  it.each(Object.keys(v2))("rejects v2 missing %s instead of silently filling a default", key => {
    const value: Record<string, unknown> = { ...v2 }; delete value[key];
    expect(() => parseEffortPolicy(value)).toThrow("invalid_decision_effort_policy");
    expect(decisionEffortPolicySchema.safeParse(value).success).toBe(false);
  });

  it.each([
    { ...v2, rank: "high" }, { ...v2, explain: "high" }, { ...v2, review: "high" },
    { ...v2, rankThinking: "enabled" }, { ...v2, rankThinking: false },
    { ...v2, rankTemperature: 1 }, { ...v2, rankTemperature: null }, { ...v2, rankTemperature: "0" },
    { ...v2, rankTemperature: Number.NaN }, { ...v2, rankTemperature: Number.POSITIVE_INFINITY },
    { ...v2, extra: true }, { ...v2, version: "saitu.effort-policy.v3" },
    { ...DEFAULT_EFFORT_POLICY, rankThinking: "disabled" }, { ...DEFAULT_EFFORT_POLICY, rankTemperature: 0 },
  ])("rejects non-authorised policy variants in native and browser readers", value => {
    expect(() => parseEffortPolicy(value)).toThrow("invalid_decision_effort_policy");
    expect(decisionEffortPolicySchema.safeParse(value).success).toBe(false);
  });

  it("does not let the historical compact grant guard authorise v2", () => {
    expect(requireCompactRecommendationEffortPolicy(DEFAULT_EFFORT_POLICY)).toEqual(DEFAULT_EFFORT_POLICY);
    expect(requireCompactRecommendationEffortPolicy({ version: "saitu.effort-policy.v1", rank: "high", explain: "low", review: "low" }).rank).toBe("high");
    expect(() => requireCompactRecommendationEffortPolicy(v2)).toThrow("compact_recommendation_requires_v1_effort_policy");
    expect(requireRankNonThinkingEffortPolicy(v2)).toEqual(v2);
    expect(() => requireRankNonThinkingEffortPolicy(DEFAULT_EFFORT_POLICY)).toThrow("rank_non_thinking_requires_v2_effort_policy");
  });

  it("disables only the exact v7 rank operation and omits its wire effort key", () => {
    expect(resolveDecisionModelSettingsForOperation("competition_v7_rank", v2)).toEqual({ thinking: "disabled", policyReasoningEffort: "low", temperature: 0, topP: 1 });
    expect(resolveDecisionModelSettingsForOperation("competition_v7_rank", v2)).not.toHaveProperty("wireReasoningEffort");
    expect(resolveEffortForOperation("competition_v7_rank", v2)).toBe("low");
    for (const operation of ["competition_v7_explain", "competition_v7_review", "competition_recommend"]) {
      expect(resolveDecisionModelSettingsForOperation(operation, v2)).toEqual({ thinking: "enabled", policyReasoningEffort: "low", wireReasoningEffort: "low" });
    }
    for (const operation of ["competition_normalize", "competition_v7_extract", "competition_v7_chat", "competition_v7_chat_review"]) {
      expect(resolveDecisionModelSettingsForOperation(operation, v2)).toEqual({ thinking: "enabled", policyReasoningEffort: "high", wireReasoningEffort: "high" });
    }
    expect(() => resolveDecisionModelSettingsForOperation("competition_v7_rank_extra", v2)).toThrow("unsupported_decision_effort_operation");
    expect(resolveDecisionModelSettingsForOperation("competition_v7_rank", DEFAULT_EFFORT_POLICY)).toEqual({ thinking: "enabled", policyReasoningEffort: "low", wireReasoningEffort: "low", topP: 0.95 });
    expect(resolveDecisionModelSettingsForOperation("competition_v7_rank", LEGACY_DEFAULT_EFFORT_POLICY)).toEqual({ thinking: "enabled", policyReasoningEffort: "high", wireReasoningEffort: "high", topP: 0.95 });
    expect(effortForPolicyTrace(v2)).toBe("mixed");
    expect(effortForPolicyTrace(DEFAULT_EFFORT_POLICY)).toBe("low");
    expect(effortForPolicyTrace(LEGACY_DEFAULT_EFFORT_POLICY)).toBe("high");
  });

  it("binds disabled actual operation, temperature and topP in the agreed canonical order", () => {
    const manualCanonical = { prompt: disabledRequest.prompt, system: disabledRequest.system, model: disabledRequest.model,
      maxTokens: disabledRequest.maxTokens, promptVersion: disabledRequest.promptVersion, thinking: "disabled", reasoningEffort: "low", effortPolicySha256: v2Sha,
      recommendationPolicyVersion: disabledRequest.recommendationPolicyVersion, implementationVersion: disabledRequest.implementationVersion,
      operation: "competition_v7_rank", temperature: 0, topP: 1 };
    const expected = createHash("sha256").update(JSON.stringify(manualCanonical)).digest("hex");
    expect(decisionRequestSha256(disabledRequest)).toBe(expected);
    expect(decisionRequestSha256({ ...disabledRequest, thinking: "enabled" })).not.toBe(expected);
    expect(decisionRequestSha256({ ...disabledRequest, prompt: "different exact prompt" })).not.toBe(expected);
  });

  it.each([
    { ...disabledRequest, operation: "competition_recommend" },
    { ...disabledRequest, operation: "competition_v7_explain" },
    { ...disabledRequest, operation: "competition_v7_review" },
    { ...disabledRequest, operation: undefined },
    { ...disabledRequest, model: "deepseek-reasoner" },
    { ...disabledRequest, reasoningEffort: "high" as const },
    { ...disabledRequest, effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY) },
    { ...disabledRequest, effortPolicySha256: "a".repeat(64) },
    { ...disabledRequest, temperature: undefined }, { ...disabledRequest, temperature: 1 },
    { ...disabledRequest, topP: undefined }, { ...disabledRequest, topP: 0.95 },
  ])("refuses disabled hashes lacking an exact authorised policy, operation or sampler", input => {
    expect(() => decisionRequestSha256(input)).toThrow(/invalid_decision_request_(?:effort|sampling)_binding/);
  });
});
