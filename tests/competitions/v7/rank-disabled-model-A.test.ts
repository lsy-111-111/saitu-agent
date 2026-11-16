import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { RequestAiJsonOptions } from "@/lib/ai/ai-client";
import { withDecisionEffortPolicy } from "@/lib/ai/effort-context";
import { DEFAULT_EFFORT_POLICY, RANK_NON_THINKING_EFFORT_POLICY, decisionRequestSha256, effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import { getMatchingCatalogRecords } from "@/lib/competitions/v7/catalog";
import { RECOMMENDATION_DETAIL_DEADLINE_MS, RECOMMENDATION_IMPLEMENTATION_VERSION, RECOMMENDATION_POLICY_VERSION, RECOMMENDATION_RANK_HARD_TIMEOUT_MS } from "@/lib/competitions/v7/contracts";
import { assembleReviewedGroupsReportV7, createExplanationGroupSpecsV7, generateGroupExplanationV7, groupCallKeyV7, reviewPreparedGroupV7 } from "@/lib/competitions/v7/explanation-groups";
import { buildDecisionContextV7, createDecisionInvocationV7, rankDecisionV7, type PreparedDecisionCallV7 } from "@/lib/competitions/v7/model";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { decodedGroupWire, matchingRelationReviewBallotFixture, serverBoundGroupReasonFixture } from "./group-reason-fixture";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";

const success = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });
function fixture(records = Array.from({ length: 45 }, (_, index) => syntheticRecord(index + 1))) {
  const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records });
  const raw = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, recommendations: context.candidates.slice(0, 5).reverse().map(({ record }) => ({ itemId: record.recordId, roleIndex: 0, rationale: "自报数据分析可用于记录本任务的清理决策。", ...rankFixtureEvidence(context, record.recordId) })), shortfallReason: null };
  return { context, raw };
}
beforeEach(() => {
  vi.stubEnv("SAITU_V7_DETAIL_LAYOUT", "single");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("rank_disabled_model_test_forbids_http"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("explicit rank-only non-thinking candidate model settings", () => {
  it("keeps the rank content identical across policies apart from the bound version echoes", async () => {
    const f = fixture(getMatchingCatalogRecords()), prompts: string[] = [], requests: RequestAiJsonOptions<unknown>[] = [];
    const now = 1_799_999_000_000; vi.spyOn(Date, "now").mockReturnValue(now);
    for (const policy of [DEFAULT_EFFORT_POLICY, RANK_NON_THINKING_EFFORT_POLICY]) await withDecisionEffortPolicy(policy, async () => {
      const plan = await rankDecisionV7(f.context, { modelCall: async (prompt, options) => {
        prompts.push(prompt); requests.push(options); expect(decodedGroupWire(prompt).candidates).toHaveLength(45); return success(rankFixtureAssessmentReply(f.context, echoRankWireHeaders(prompt, f.raw)));
      } });
      expect(plan.recommendations.map(item => item.itemId)).toEqual(f.raw.recommendations.map(item => item.itemId).sort());
      expect(plan.recommendations.every(item => item.rankRoleIndex === 0)).toBe(true);
    });
    const [wireA, wireB] = prompts.map(prompt => decodedGroupWire(prompt));
    expect(wireA.rankVersionBindingSha256).not.toBe(wireB.rankVersionBindingSha256);
    const rankContent = (wire: typeof wireA) => {
      const body = structuredClone(wire);
      for (const key of ["profileRevision", "catalogVersion", "rankVersionBindingSha256"]) Reflect.deleteProperty(body, key);
      for (const key of ["profileRevision", "catalogVersion"]) Reflect.deleteProperty(body.outputFormat, key);
      Reflect.deleteProperty(body.profile, "revision");
      return body;
    };
    expect(rankContent(wireA)).toEqual(rankContent(wireB));
    expect(requests[0].systemPrompt).toBe(requests[1].systemPrompt); expect(requests[0].promptVersion).toBe(requests[1].promptVersion);
    expect(requests[0]).toMatchObject({ thinking: "enabled", reasoningEffort: "low", topP: 0.95 });
    expect(requests[1]).toMatchObject({ operation: "competition_v7_rank", thinking: "disabled", temperature: 0, topP: 1, reasoningEffort: "low" });
    for (const request of requests) expect(request).toMatchObject({ maxTokens: 8192, maxAttempts: 1, candidateCount: 45, deadlineEpochMs: now + RECOMMENDATION_RANK_HARD_TIMEOUT_MS });
  });

  it("exposes actual rank preparation with distinct policy and wire effort without adding a model call", async () => {
    const f = fixture(), prepared: PreparedDecisionCallV7[] = []; let calls = 0;
    await withDecisionEffortPolicy(RANK_NON_THINKING_EFFORT_POLICY, async () => {
      const invocation = createDecisionInvocationV7(f.context, { modelCall: async (prompt, request) => {
        calls++; expect(prepared).toHaveLength(1); const row = prepared[0];
        expect(row).toMatchObject({ stage: "rank", operation: "competition_v7_rank", thinking: "disabled", reasoningEffort: "low", policyReasoningEffort: "low", wireReasoningEffort: null, temperature: 0, topP: 1, maxTokens: 8192 });
        expect(row.wirePromptSha256).toBe(createHash("sha256").update(prompt).digest("hex"));
        expect(row.durableRequestSha256).toBe(decisionRequestSha256({ prompt, system: request.systemPrompt, model: request.model, maxTokens: request.maxTokens, promptVersion: request.promptVersion,
          operation: request.operation, thinking: "disabled", reasoningEffort: "low", temperature: 0, topP: 1, effortPolicySha256: effortPolicySha256(RANK_NON_THINKING_EFFORT_POLICY), recommendationPolicyVersion: RECOMMENDATION_POLICY_VERSION, implementationVersion: RECOMMENDATION_IMPLEMENTATION_VERSION }));
        return success(f.raw);
      } }, { onPreparedCall: async call => { prepared.push(structuredClone(call)); } });
      await invocation.call("rank", { offline: "preparation evidence" }, z.unknown(), false);
      expect(invocation.trace()).toMatchObject({ callCount: 1, reasoningEffort: "mixed", effortPolicy: RANK_NON_THINKING_EFFORT_POLICY });
    });
    expect(calls).toBe(1);
  });

  it("keeps ordinary enabled preparation and hashing in the original shape", async () => {
    const f = fixture(), prepared: PreparedDecisionCallV7[] = [];
    await withDecisionEffortPolicy(DEFAULT_EFFORT_POLICY, async () => {
      const invocation = createDecisionInvocationV7(f.context, { modelCall: async (prompt, request) => {
        const row = prepared[0]; expect(row.thinking).toBe("enabled"); expect(row).not.toHaveProperty("temperature"); expect(row).not.toHaveProperty("policyReasoningEffort"); expect(row).not.toHaveProperty("wireReasoningEffort");
        const originalHash = createHash("sha256").update(JSON.stringify({ prompt, system: request.systemPrompt, model: request.model, maxTokens: request.maxTokens, promptVersion: request.promptVersion,
          thinking: "enabled", reasoningEffort: "low", effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), recommendationPolicyVersion: RECOMMENDATION_POLICY_VERSION, implementationVersion: RECOMMENDATION_IMPLEMENTATION_VERSION, topP: 0.95 })).digest("hex");
        expect(row.durableRequestSha256).toBe(originalHash); return success(f.raw);
      } }, { onPreparedCall: async call => { prepared.push(structuredClone(call)); } });
      await invocation.call("rank", { offline: "legacy hash evidence" }, z.unknown(), false);
    });
  });

  it("does not let a standalone preparation observer override group prompts or namespaces", () => {
    const f = fixture(), observer = async () => {};
    expect(() => createDecisionInvocationV7(f.context, {}, { onPreparedCall: observer })).not.toThrow();
    expect(() => createDecisionInvocationV7(f.context, {}, { onPreparedCall: observer, explainSystemPrompt: "override" })).toThrow("invalid_group_invocation_contract");
    expect(() => createDecisionInvocationV7(f.context, {}, { onPreparedCall: observer, explainSystemPrompt: "" })).toThrow("invalid_group_invocation_contract");
    expect(() => createDecisionInvocationV7(f.context, {}, { onPreparedCall: observer, promptVersionSuffix: ".detail-v2" })).toThrow("invalid_group_invocation_contract");
    expect(() => createDecisionInvocationV7(f.context, {}, { onPreparedCall: observer, reviewIdPrefix: "detail-v1.g0" as "detail-v2.g0" })).toThrow("invalid_group_call_namespace");
    expect(() => createDecisionInvocationV7(f.context, {}, { onPreparedCall: observer, reviewIdPrefix: "" as "detail-v2.g0" })).toThrow("invalid_group_call_namespace");
  });

  it("retains one definite format repair with the same disabled settings and original remaining cutoff", async () => {
    const f = fixture(); let calls = 0, now = 1_799_999_000_000;
    const deadline = now + 60_000; vi.spyOn(Date, "now").mockImplementation(() => now);
    await withDecisionEffortPolicy(RANK_NON_THINKING_EFFORT_POLICY, async () => {
      await expect(rankDecisionV7(f.context, { deadlineEpochMs: deadline, modelCall: async (prompt, options) => {
        calls++; expect(options).toMatchObject({ thinking: "disabled", temperature: 0, topP: 1, reasoningEffort: "low", maxTokens: 8192, maxAttempts: 1, deadlineEpochMs: deadline, timeoutMs: calls === 1 ? 60_000 : 40_000 });
        now += 20_000; return success(rankFixtureAssessmentReply(f.context, echoRankWireHeaders(prompt, { ...f.raw, invalidExtraRoot: true })));
      } })).rejects.toThrow("invalid_output");
    });
    expect(calls).toBe(2);
  });

  it("still fails a missing selected role once without a guessed role or repair", async () => {
    const f = fixture(); Reflect.deleteProperty(f.raw.recommendations[0], "roleIndex"); let calls = 0;
    await withDecisionEffortPolicy(RANK_NON_THINKING_EFFORT_POLICY, async () => {
      await expect(rankDecisionV7(f.context, { modelCall: async prompt => { calls++; return success(rankFixtureAssessmentReply(f.context, echoRankWireHeaders(prompt, f.raw))); } })).rejects.toThrow("invalid_output");
    });
    expect(calls).toBe(1);
  });

  it("keeps grouped explanation and joint review enabled/low and accepts the truthful mixed-mode report trace", async () => {
    const f = fixture(), requests: RequestAiJsonOptions<unknown>[] = [];
    await withDecisionEffortPolicy(RANK_NON_THINKING_EFFORT_POLICY, async () => {
      const plan = await rankDecisionV7(f.context, { modelCall: async (prompt, options) => { requests.push(options); return success(rankFixtureAssessmentReply(f.context, echoRankWireHeaders(prompt, f.raw))); } });
      const run = { runId: randomUUID(), stateKey: "rank-disabled-full-chain", generation: 0, implementationSha256: "a".repeat(64), effortPolicySha256: effortPolicySha256(RANK_NON_THINKING_EFFORT_POLICY), detailDeadlineEpochMs: Date.now() + RECOMMENDATION_DETAIL_DEADLINE_MS };
      const [spec] = createExplanationGroupSpecsV7(f.context, plan, run), options = { requestId: run.runId, runBinding: run, deadlineEpochMs: run.detailDeadlineEpochMs - 750 };
      const generated = await generateGroupExplanationV7(f.context, plan, spec, { ...options, modelCall: async (prompt, request) => {
        requests.push(request);
        const wire = decodedGroupWire(prompt);
        return success({ schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: wire.groupBindingSha256, groupId: spec.groupId, profileRevision: plan.profileRevision, catalogVersion: plan.catalogVersion, shortfallReason: plan.shortfallReason,
          recommendations: spec.itemIds.map((_itemId, rowIndex) => ({ rowIndex, reason: { ...serverBoundGroupReasonFixture(), factIndex: wire.candidates[rowIndex].rankedSelection.factIndex } })) });
      } });
      const reviewed = await reviewPreparedGroupV7(f.context, plan, generated.prepared, { ...options,
        persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: run.runId, groupId: spec.groupId, groupBindingSha256: generated.prepared.groupBindingSha256, preparedSha256: generated.prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 },
        persistReviewPreparation: async row => { expect(row.call).toMatchObject({ stage: "review", thinking: "enabled", reasoningEffort: "low" }); expect(row.call).not.toHaveProperty("temperature"); expect(row.call).not.toHaveProperty("wireReasoningEffort"); },
        modelCall: async (prompt, request) => { requests.push(request); return success({ checks: decodedGroupWire(prompt).assertions.map((row: { key: string }) => matchingRelationReviewBallotFixture(row.key, "合成原始证据支持四项审核。")) }); }
      });
      const report = assembleReviewedGroupsReportV7(f.context, plan, [{ prepared: generated.prepared, reviewed: reviewed.reviewed }], run, { startedAtEpochMs: 10, completedAtEpochMs: 20,
        calls: ["v7.rank:effort-v1.initial:1", groupCallKeyV7("g0", "explain"), groupCallKeyV7("g0", "review")].map(callKey => ({ runId: run.runId, callId: randomUUID(), reservationId: randomUUID(), callKey, upstreamAttempted: true, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 } })) });
      expect(report.trace).toMatchObject({ reasoningEffort: "mixed", effortPolicy: RANK_NON_THINKING_EFFORT_POLICY, callCount: 3 });
      expect(report.recommendations.map(item => item.itemId)).toEqual(plan.recommendations.map(item => item.itemId));
    });
    expect(requests).toHaveLength(3); expect(requests[0].thinking).toBe("disabled");
    expect(requests.slice(1).every(request => request.thinking === "enabled" && request.reasoningEffort === "low" && request.topP === undefined && request.maxTokens === 16384)).toBe(true);
  });
});
