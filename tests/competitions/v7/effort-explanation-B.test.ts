import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withDecisionEffortPolicy } from "@/lib/ai/effort-context";
import { DEFAULT_EFFORT_POLICY, LEGACY_DEFAULT_EFFORT_POLICY, decisionRequestSha256, effortPolicySha256, type DecisionEffortPolicy } from "@/lib/ai/effort-policy.mjs";
import { claim } from "@/lib/competitions/v6/engine";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { buildDecisionContextV7, createDecisionInvocationV7, decisionEffortTraceV7, reviewSchema, type DecisionModelCallV7, type PreparedDecisionCallV7 } from "@/lib/competitions/v7/model";
import { RECOMMENDATION_IMPLEMENTATION_VERSION, RECOMMENDATION_POLICY_VERSION } from "@/lib/competitions/v7/contracts";
import { assembleReviewedGroupsReportV7, createExplanationGroupSpecsV7, generateGroupExplanationV7, groupCallKeyV7, reviewPreparedGroupV7, type GroupRunBindingV7, type PreparedGroupExplanationV7 } from "@/lib/competitions/v7/explanation-groups";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { decodedGroupWire, groupReasonFixture, matchingRelationReviewBallotFixture } from "./group-reason-fixture";

const mixed: DecisionEffortPolicy = { ...DEFAULT_EFFORT_POLICY, rank: "low", explain: "low", review: "high" };
const success = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const, durationMs: 1, attempts: 1, httpStatus: 200, finishReason: "stop" });
function fixture(policy: DecisionEffortPolicy = mixed) {
  const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records: Array.from({ length: 10 }, (_, i) => syntheticRecord(i + 1)) });
  const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, shortfallReason: null,
    recommendations: context.candidates.slice(0, 5).map(({ record }) => ({ itemId: record.recordId, reasons: [claim("固定的内部任务提示。", "suggestion")] })) };
  const run: GroupRunBindingV7 = { runId: randomUUID(), stateKey: "B-offline-only", generation: 0, implementationSha256: "1".repeat(64), effortPolicySha256: effortPolicySha256(policy), detailDeadlineEpochMs: Date.now() + 90_000 };
  return { context, plan, run };
}
function generation(context: ReturnType<typeof fixture>["context"], spec: ReturnType<typeof createExplanationGroupSpecsV7>[number]) {
  return { schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: createHash("sha256").update("unused").digest("hex"), groupId: spec.groupId,
    profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, shortfallReason: null,
    recommendations: spec.itemIds.map((_itemId, rowIndex) => ({ rowIndex, reason: groupReasonFixture(0, 0),
      roleIndex: 0 })) };
}
function options(run: GroupRunBindingV7, modelCall: DecisionModelCallV7) {
  return { requestId: run.runId, runBinding: run, deadlineEpochMs: run.detailDeadlineEpochMs - 750, modelCall };
}
function persisted(run: GroupRunBindingV7, prepared: PreparedGroupExplanationV7) {
  return { schemaVersion: "saitu.persisted-group-explanation.v1" as const, runId: run.runId, groupId: prepared.groupSpec.groupId, groupBindingSha256: prepared.groupBindingSha256,
    preparedSha256: prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 };
}
afterEach(() => vi.restoreAllMocks());

describe("B frozen explanation and support-review effort", () => {
  it.each([LEGACY_DEFAULT_EFFORT_POLICY, { ...DEFAULT_EFFORT_POLICY, rank: "low", explain: "low", review: "low" } as DecisionEffortPolicy, mixed])("reports the complete stage map truthfully for %j", policy => {
    expect(decisionEffortTraceV7(policy)).toEqual({ reasoningEffort: new Set([policy.rank, policy.explain, policy.review]).size === 1 ? policy.rank : "mixed", effortPolicy: policy });
  });

  it("isolates the new call namespace and binds effective effort, thinking and policy into the shared request hash", async () => {
    const { context } = fixture(); const calls: PreparedDecisionCallV7[] = [];
    await withDecisionEffortPolicy(mixed, async () => {
      const invocation = createDecisionInvocationV7(context, { requestId: randomUUID(), modelCall: async (prompt, request) => {
        expect(request.reasoningEffort).toBe("high"); expect(request.thinking).toBe("enabled");
        const prepared = calls.at(-1)!;
        const requestVersion = { recommendationPolicyVersion: RECOMMENDATION_POLICY_VERSION, implementationVersion: RECOMMENDATION_IMPLEMENTATION_VERSION };
        expect(request).toMatchObject(requestVersion); expect(prepared).toMatchObject(requestVersion);
        expect(prepared.durableRequestSha256).toBe(decisionRequestSha256({ prompt, system: request.systemPrompt, model: request.model, maxTokens: request.maxTokens,
          promptVersion: request.promptVersion, thinking: "enabled", reasoningEffort: "high", effortPolicySha256: effortPolicySha256(mixed), ...requestVersion }));
        expect(prepared.callKey).toBe("v7.review:detail-v2.g0.initial:1");
        return success({ checks: [{ key: "R01", supported: false, reason: "本条缺少引用。" }] });
      } }, { reviewIdPrefix: "detail-v2.g0", promptVersionSuffix: ".detail-v2", explainSystemPrompt: "offline", onPreparedCall: async call => { calls.push(call); } });
      const packet = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, profile: context.profile, fixedOrder: { itemIds: ["item"] },
        candidateBoundaries: [{ itemId: "item", boundaryFacts: [], editorialSectionBoundaries: [], editorialRoleBoundaries: [], qualifiers: [], displayedRecommendation: { currentRole: claim("冻结断言。", "suggestion"), nextStep: claim("冻结断言。", "suggestion"), checkpoint: "合成核对点" }, boundarySourceBindings: { sources: [], unresolvedSourceIds: [], ambiguousSourceIds: [] } }], assertions: [{ key: "item.reason.0", itemId: "item", reason: claim("冻结断言。", "suggestion") }],
        assertionEvidence: [{ key: "item.reason.0", itemId: "item", citedStudentFacts: [], studentAnswerUpdates: [], studentCounterEvidence: { facts: [], unresolvedFactIds: [], use: "conditions_and_counterevidence_only_not_positive_support" }, competitionItems: [{ itemId: "item", citedFacts: [], sources: [], contradictionContext: { facts: [], unresolvedFactIds: [], sourceBindings: { sources: [], unresolvedSourceIds: [], ambiguousSourceIds: [] }, use: "conditions_and_counterevidence_only_not_positive_support" } }] }] };
      const verdict = await invocation.call("review", packet, reviewSchema, false);
      expect(verdict.checks[0]).toMatchObject({ key: "item.reason.0", supported: false });
      expect(invocation.trace()).toMatchObject({ reasoningEffort: "mixed", effortPolicy: mixed });
      await expect(invocation.call("review", packet, reviewSchema, true)).rejects.toThrow("review_repair_forbidden");
    });
    expect(calls).toHaveLength(1);
  });

  it("refuses moving an invocation into another policy before any model dispatch", async () => {
    const { context } = fixture(); const modelCall = vi.fn();
    const invocation = withDecisionEffortPolicy(mixed, () => createDecisionInvocationV7(context, { modelCall }));
    await withDecisionEffortPolicy(DEFAULT_EFFORT_POLICY, async () => {
      await expect(invocation.call("rank", {}, reviewSchema, false)).rejects.toThrow("decision_effort_policy_changed");
    });
    expect(modelCall).not.toHaveBeenCalled();
  });

  it("keeps the entire Top5 in one group and persists it before low generation/high review", async () => {
    await withDecisionEffortPolicy(mixed, async () => {
      const { context, plan, run } = fixture(); const specs = createExplanationGroupSpecsV7(context, plan, run);
      expect(specs.map(spec => spec.globalRanks)).toEqual([[1, 2, 3, 4, 5]]);
      expect(specs.map(spec => spec.groupId)).toEqual(["g0"]);
      expect(context.candidates).toHaveLength(10);
      expect(specs.every(spec => spec.effortPolicySha256 === run.effortPolicySha256)).toBe(true);
      const groups = [];
      for (const spec of specs) {
        let reviewPreparationSaved = false;
        const generated = await generateGroupExplanationV7(context, plan, spec, options(run, async (prompt, request) => {
          expect(request.reasoningEffort).toBe("low"); expect(request.maxAttempts).toBe(1); expect(request.maxTokens).toBe(16384);
          const value = generation(context, spec); value.groupBindingSha256 = decodedGroupWire(prompt).groupBindingSha256;
          return success(value);
        }));
        const reviewed = await reviewPreparedGroupV7(context, plan, generated.prepared, { ...options(run, async (prompt, request) => {
          expect(reviewPreparationSaved).toBe(true); expect(request.reasoningEffort).toBe("high");
          return success({ checks: decodedGroupWire(prompt).assertions.map((row: { key: string }) => matchingRelationReviewBallotFixture(row.key, "本条自报与任务引用支持。")) });
        }), persisted: persisted(run, generated.prepared), persistReviewPreparation: async value => {
          expect(value.call.effortPolicySha256).toBe(run.effortPolicySha256); expect(value.call.reasoningEffort).toBe("high"); reviewPreparationSaved = true;
        } });
        expect(generated.localTrace).toMatchObject({ reasoningEffort: "mixed", effortPolicy: mixed });
        groups.push({ prepared: generated.prepared, reviewed: reviewed.reviewed });
      }
      const keys = ["v7.rank:effort-v1.initial:1", ...specs.flatMap(spec => [groupCallKeyV7(spec.groupId, "explain"), groupCallKeyV7(spec.groupId, "review")])];
      const report = assembleReviewedGroupsReportV7(context, plan, groups, run, { startedAtEpochMs: 10, completedAtEpochMs: 20,
        calls: keys.map((callKey, index) => ({ runId: run.runId, callId: `call-${index}`, reservationId: `reservation-${index}`, callKey, upstreamAttempted: true, usage: null })) });
      expect(report.trace).toMatchObject({ reasoningEffort: "mixed", effortPolicy: mixed, callCount: 3, candidateCount: 10 });
      expect(report.recommendations.map(row => row.itemId)).toEqual(plan.recommendations.map(row => row.itemId));
    });
  });

  it("rejects a stale policy-bound group and old detail-v1 identity instead of replaying it", () => {
    withDecisionEffortPolicy(mixed, () => {
      const { context, plan, run } = fixture(DEFAULT_EFFORT_POLICY);
      expect(() => createExplanationGroupSpecsV7(context, plan, run)).toThrow("group_effort_policy_changed");
      expect(() => createDecisionInvocationV7(context, {}, { reviewIdPrefix: "detail-v1.g0" as "detail-v2.g0", promptVersionSuffix: ".detail-v2", explainSystemPrompt: "offline" })).toThrow("invalid_group_call_namespace");
    });
  });
});
