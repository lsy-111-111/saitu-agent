import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EFFORT_POLICY, effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import { claim } from "@/lib/competitions/v6/engine";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { buildDecisionContextV7, projectReviewedReasonsV7 } from "@/lib/competitions/v7/model";
import { assembleReviewedGroupDetailsV7, assembleReviewedGroupsFinalV7, assembleReviewedGroupsReportV7, combineReviewedGroupPlanV7, createExplanationGroupSpecsV7, generateGroupExplanationV7, groupCallKeyV7, groupCanonicalSha256V7, reviewPreparedGroupV7, type PreparedGroupExplanationV7, type ReviewedPreparedGroupV7 } from "@/lib/competitions/v7/explanation-groups";
import { matchReasonAnchorPrefixV7 } from "@/lib/competitions/v7/reason-anchor";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { decodedGroupWire, groupReasonFixture, matchingRelationReviewBallotFixture } from "./group-reason-fixture";
function fixture(count = 5) {
  const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records: Array.from({ length: 6 }, (_, index) => syntheticRecord(index + 1)) });
  const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
    recommendations: context.candidates.slice(0, count).map(({ record }) => ({ itemId: record.recordId, reasons: [claim("固定排序提示，不是已审核详情。", "suggestion")] })), shortfallReason: count < 5 ? "合成四项有意义短名单，仅测试组边界。" : null };
  const run = { runId: randomUUID(), stateKey: "compact-group-scope-offline", generation: 0, implementationSha256: "a".repeat(64), effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), detailDeadlineEpochMs: Date.now() + 150_000 };
  return { context, plan, run, specs: createExplanationGroupSpecsV7(context, plan, run), personal: context.profile.facts.find(fact => fact.field === "skills")! };
}
const success = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });
async function groupResult(f: ReturnType<typeof fixture>, groupIndex: number, rejected: readonly number[] = []) {
  const spec = f.specs[groupIndex], options = { requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750 };
  const generated = await generateGroupExplanationV7(f.context, f.plan, spec, { ...options, modelCall: async prompt => success({
    schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: decodedGroupWire(prompt).groupBindingSha256, groupId: spec.groupId,
    profileRevision: f.context.profile.revision, catalogVersion: f.context.catalogVersion, shortfallReason: f.plan.shortfallReason,
    recommendations: spec.itemIds.map((_itemId, rowIndex) => ({ rowIndex, reason: groupReasonFixture(0, 0), roleIndex: 0 })),
  }) });
  const reviewed = await reviewPreparedGroupV7(f.context, f.plan, generated.prepared, { ...options,
    persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: f.run.runId, groupId: spec.groupId, groupBindingSha256: generated.prepared.groupBindingSha256, preparedSha256: generated.prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 }, persistReviewPreparation: async () => {},
    modelCall: async prompt => {
      const wire = decodedGroupWire(prompt); expect(wire.assertions).toHaveLength(spec.itemIds.length);
      expect(wire.assertions.every((row: { reviewPurpose: string }) => row.reviewPurpose === "joint_recommendation_fit_and_role_action")).toBe(true);
      expect(wire.fixedOrder.groupReview.groupId).toBe(spec.groupId);
      expect(wire.reviewContract).toBe("saitu.matching-relation-review.v3");
      return success({ checks: wire.assertions.map((row: { key: string }, index: number) => matchingRelationReviewBallotFixture(row.key, rejected.includes(index) ? "保留匹配理由原拒绝。" : "本条原始引用支持。", { fit: !rejected.includes(index) })) });
    },
  });
  return { prepared: generated.prepared, reviewed: reviewed.reviewed };
}
function projectedPlan(f: ReturnType<typeof fixture>, group: { prepared: PreparedGroupExplanationV7; reviewed: ReviewedPreparedGroupV7 }) {
  const byId = new Map(group.prepared.explanation.recommendations.map(item => [item.itemId, item]));
  return { ...f.plan, recommendations: f.plan.recommendations.map(item => byId.get(item.itemId) ?? item) };
}
beforeEach(() => {
  vi.stubEnv("SAITU_V7_DETAIL_LAYOUT", "parallel-2");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("compact_group_scope_test_forbids_http"); }));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("parallel compact review keeps the full plan and exact group coverage", () => {
  it.each([4, 5])("reviews and progressively publishes both groups before assembling the original %i-item order", async count => {
    const f = fixture(count), original = structuredClone(f.plan), groups: { prepared: PreparedGroupExplanationV7; reviewed: ReviewedPreparedGroupV7 }[] = [];
    expect(f.specs.map(spec => spec.itemIds.length)).toEqual([2, count - 2]);
    for (let index = 0; index < f.specs.length; index++) {
      const group = await groupResult(f, index); groups.push(group);
      const partial = assembleReviewedGroupDetailsV7(f.context, f.plan, group.prepared, group.reviewed, f.run);
      expect(partial.map(item => item.itemId)).toEqual(f.specs[index].itemIds);
      expect(partial.map(item => item.rank)).toEqual(f.specs[index].globalRanks);
      for (const item of partial) {
        const record = f.context.candidates.find(row => row.record.recordId === item.itemId)!.record;
        expect(item.reasons[0].text).toContain(matchReasonAnchorPrefixV7(record.facts[0]));
        expect(item.reasons[0].text).toContain(`\n可选分工（编辑建议）「${record.roles[0].name}」：${record.roles[0].task}\n匹配关系：`);
        expect(item.reasons[0].studentFactIds).toEqual([f.personal.id]);
      }
      if (!index) expect(() => combineReviewedGroupPlanV7(f.context, f.plan, groups, f.run)).toThrow("incomplete_reviewed_groups");
    }
    const combined = combineReviewedGroupPlanV7(f.context, f.plan, groups, f.run);
    expect(combined.recommendations.map(item => item.itemId)).toEqual(original.recommendations.map(item => item.itemId));
    expect(combined.shortfallReason).toBe(original.shortfallReason);
    const report = assembleReviewedGroupsReportV7(f.context, f.plan, groups, f.run, { startedAtEpochMs: 10, completedAtEpochMs: 20,
      calls: ["v7.rank:effort-v1.initial:1", ...f.specs.flatMap(spec => [groupCallKeyV7(spec.groupId, "explain"), groupCallKeyV7(spec.groupId, "review")])].map(callKey => ({ runId: f.run.runId, callId: randomUUID(), reservationId: randomUUID(), callKey, upstreamAttempted: true, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 } })) });
    expect(report.recommendations.map(item => item.itemId)).toEqual(original.recommendations.map(item => item.itemId));
    expect(report.recommendations.map(item => item.rank)).toEqual(Array.from({ length: count }, (_, index) => index + 1));
    expect(report.trace.callCount).toBe(5); expect(f.plan).toEqual(original);
  });

  it("publishes only the completely supported final set in original order after every group is reviewed", async () => {
    const f = fixture(), failed = await groupResult(f, 0, [0]), passed = await groupResult(f, 1);
    const originals = structuredClone({ plan: f.plan, failed, passed });
    const projection = projectReviewedReasonsV7(f.context, projectedPlan(f, passed), passed.prepared.assertions, passed.prepared.criticalKeys, passed.reviewed.checks, { allowRolePromotion: false, reviewedItemIds: f.specs[1].itemIds });
    expect(projection.readyItemIds).toEqual(f.specs[1].itemIds);
    expect(projection.bindings.every(binding => f.specs[1].itemIds.includes(binding.itemId))).toBe(true);
    expect(projection.plan.recommendations.slice(0, 2)).toEqual(f.plan.recommendations.slice(0, 2));
    expect(failed.reviewed.checks.slice(0, 2).map(check => check.supported)).toEqual([false, false]);
    expect(assembleReviewedGroupDetailsV7(f.context, f.plan, failed.prepared, failed.reviewed, f.run).map(item => item.rank)).toEqual([2]);
    expect(assembleReviewedGroupDetailsV7(f.context, f.plan, passed.prepared, passed.reviewed, f.run).map(item => item.rank)).toEqual([3, 4, 5]);
    expect(() => combineReviewedGroupPlanV7(f.context, f.plan, [passed], f.run)).toThrow("incomplete_reviewed_groups");
    const { plan, report } = assembleReviewedGroupsFinalV7(f.context, f.plan, [passed, failed], f.run,
      { startedAtEpochMs: 10, completedAtEpochMs: 20, calls: [] });
    const expected = f.plan.recommendations.slice(1).map(item => item.itemId);
    expect(plan.recommendations.map(item => item.itemId)).toEqual(expected);
    expect(report.recommendations.map(item => [item.itemId, item.rank])).toEqual(expected.map((id, i) => [id, i + 1]));
    expect(report.shortlistShortfallReason).toBe(plan.shortfallReason);
    expect(plan.shortfallReason).toContain("4项推荐的理由通过审核");
    expect(report.trace.lastValidModelItemIds).toEqual(f.plan.recommendations.map(item => item.itemId));
    expect(report.trace.unsupportedChecks).toBe(2);
    expect(report.candidateAudit.find(item => item.recordId === f.specs[0].itemIds[0])).toMatchObject({
      status: "not_selected", reason: { text: "这项初选的推荐理由未通过本次审核。" },
    });
    expect({ plan: f.plan, failed, passed }).toEqual(originals);
  });

  it("fails closed for zero supported items and for a split persisted joint verdict", async () => {
    const f = fixture(1), failed = await groupResult(f, 0, [0]);
    expect(() => combineReviewedGroupPlanV7(f.context, f.plan, [failed], f.run)).toThrow("NO_SUPPORTED_RECOMMENDATIONS");
    const { reviewedSha256: _old, ...tampered } = structuredClone(failed.reviewed);
    tampered.checks[0].supported = true;
    tampered.itemOutcomes[0].unsupportedKeys = [tampered.checks[1].key];
    expect(() => combineReviewedGroupPlanV7(f.context, f.plan, [{
      prepared: failed.prepared, reviewed: { ...tampered, reviewedSha256: groupCanonicalSha256V7(tampered) },
    }], f.run)).toThrow("matching_relation_review_conjunction_changed");
  });

  it("rejects changed, missing, duplicated and cross-group assertions or checks rather than inferring coverage", async () => {
    const f = fixture(), group = await groupResult(f, 1), original = projectedPlan(f, group), scope = { allowRolePromotion: false, reviewedItemIds: f.specs[1].itemIds };
    const project = (assertions = group.prepared.assertions, checks = group.reviewed.checks) => projectReviewedReasonsV7(f.context, original, assertions, group.prepared.criticalKeys, checks, scope);
    expect(() => project(group.prepared.assertions.slice(1))).toThrow("projection_original_binding_changed");
    const changed = structuredClone(group.prepared.assertions); changed[0].reason.text += "改变";
    expect(() => project(changed)).toThrow("projection_original_binding_changed");
    const foreign = structuredClone(group.prepared.assertions); foreign[0].itemId = f.specs[0].itemIds[0];
    expect(() => project(foreign)).toThrow("projection_original_binding_changed");
    expect(() => project(undefined, group.reviewed.checks.slice(1))).toThrow("incomplete_support_review");
    const duplicate = structuredClone(group.reviewed.checks); duplicate[1].key = duplicate[0].key;
    expect(() => project(undefined, duplicate)).toThrow("incomplete_support_review");
    for (const reviewedItemIds of [[], ["foreign-item"], [f.specs[1].itemIds[0], f.specs[1].itemIds[0]]])
      expect(() => projectReviewedReasonsV7(f.context, original, group.prepared.assertions, group.prepared.criticalKeys, group.reviewed.checks, { ...scope, reviewedItemIds })).toThrow("invalid_projection_review_scope");
    const borrowed = structuredClone(original);
    borrowed.recommendations[2].reasons[0].competitionFactIds = [f.context.candidates.find(value => value.record.recordId === f.specs[0].itemIds[0])!.record.facts[0].id];
    expect(() => projectReviewedReasonsV7(f.context, borrowed, group.prepared.assertions, group.prepared.criticalKeys, group.reviewed.checks, scope)).toThrow("invalid_projection_plan");
  });

  it("refuses comparison support outside a scope containing both original leading items", async () => {
    const f = fixture(), group = await groupResult(f, 1), original = projectedPlan(f, group);
    const firstFact = f.context.candidates.find(value => value.record.recordId === f.plan.recommendations[0].itemId)!.record.facts[0].id;
    const secondFact = f.context.candidates.find(value => value.record.recordId === f.plan.recommendations[1].itemId)!.record.facts[0].id;
    const withComparison = { ...original, comparison: claim("可对照前两项给定任务。", "inference", [f.personal.id], [firstFact, secondFact]) };
    expect(() => projectReviewedReasonsV7(f.context, withComparison, group.prepared.assertions, group.prepared.criticalKeys, group.reviewed.checks, { allowRolePromotion: false, reviewedItemIds: f.specs[1].itemIds })).toThrow("projection_comparison_outside_review_scope");
  });
});
