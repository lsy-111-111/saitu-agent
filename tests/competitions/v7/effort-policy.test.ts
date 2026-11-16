import { describe, expect, it, vi, afterEach } from "vitest";
import { DEFAULT_EFFORT_POLICY, LEGACY_DEFAULT_EFFORT_POLICY, decisionRequestSha256, effortPolicySha256, parseEffortPolicy, readConfiguredEffortPolicy, resolveEffortForOperation } from "../../../src/lib/ai/effort-policy.mjs";
import { currentDecisionEffortPolicy, withDecisionEffortPolicy } from "../../../src/lib/ai/effort-context";
afterEach(() => vi.unstubAllEnvs());
describe("frozen stage effort policy", () => {
  const low = parseEffortPolicy({ ...LEGACY_DEFAULT_EFFORT_POLICY, rank: "low", explain: "low" });
  it("defaults new product stages to low while retaining the explicit historical high policy",()=>{
    expect(DEFAULT_EFFORT_POLICY).toEqual({version:"saitu.effort-policy.v1",rank:"low",explain:"low",review:"low"});
    expect(LEGACY_DEFAULT_EFFORT_POLICY).toEqual({version:"saitu.effort-policy.v1",rank:"high",explain:"high",review:"high"});
  });
  it("rejects unsupported stages and effort aliases instead of silently mapping them", () => {
    expect(() => parseEffortPolicy({ ...low, rank: "medium" })).toThrow();
    expect(() => parseEffortPolicy({ ...low, chat: "low" })).toThrow();
    expect(() => resolveEffortForOperation("arbitrary_operation", low)).toThrow();
  });
  it("keeps normalization and all chat operations high when recommendation stages are low", () => {
    for (const operation of ["competition_normalize", "competition_v7_chat", "competition_v7_extract", "competition_v7_chat_review"]) expect(resolveEffortForOperation(operation, low)).toBe("high");
    expect(resolveEffortForOperation("competition_v7_rank", low)).toBe("low");
    expect(resolveEffortForOperation("competition_v7_review", low)).toBe("high");
  });
  it("rejects an environment/hash mismatch and produces field-order-independent bindings", () => {
    expect(effortPolicySha256({ review: "high", explain: "low", rank: "low", version: "saitu.effort-policy.v1" })).toBe(effortPolicySha256(low));
    expect(() => readConfiguredEffortPolicy({ SAITU_V7_EFFORT_POLICY: JSON.stringify(low), SAITU_V7_EFFORT_POLICY_SHA256: effortPolicySha256(DEFAULT_EFFORT_POLICY) })).toThrow();
  });
  it("isolates simultaneous runs and forbids changing an active run policy", async () => {
    const results = await Promise.all([low, DEFAULT_EFFORT_POLICY].map(policy => withDecisionEffortPolicy(policy, async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      expect(() => withDecisionEffortPolicy(policy === low ? DEFAULT_EFFORT_POLICY : low, () => true)).toThrow();
      return currentDecisionEffortPolicy();
    })));
    expect(results).toEqual([low, DEFAULT_EFFORT_POLICY]);
  });
  it("does not reuse high and low receipts or a different stage policy", () => {
    const input = { prompt: "same", system: "same", model: "deepseek-flash", maxTokens: 8192, promptVersion: "fixed", thinking: "enabled" as const, reasoningEffort: "high" as const, effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY) };
    expect(decisionRequestSha256(input)).not.toBe(decisionRequestSha256({ ...input, reasoningEffort: "low" }));
    expect(decisionRequestSha256(input)).not.toBe(decisionRequestSha256({ ...input, effortPolicySha256: effortPolicySha256(low) }));
    const top5={...input,recommendationPolicyVersion:"saitu.policy.2026-11-09.v7.top5",implementationVersion:"saitu.async.2026-11-09.v7.3.top5"};
    expect(decisionRequestSha256(top5)).not.toBe(decisionRequestSha256(input));
    expect(decisionRequestSha256(top5)).not.toBe(decisionRequestSha256({...top5,implementationVersion:"saitu.async.2026-11-09.v7.2"}));
    expect(()=>decisionRequestSha256({...input,recommendationPolicyVersion:top5.recommendationPolicyVersion})).toThrow("invalid_decision_request_version_binding");
  });
});
