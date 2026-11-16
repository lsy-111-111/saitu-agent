import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { assembleDecisionReport } from "@/lib/competitions/v6/engine";
import { getMatchingCatalogRecords } from "@/lib/competitions/v7/catalog";
import { applyReviewedRoleActionsV7, buildDecisionContextV7, explainDecisionV7, validateMatchPlanV7 } from "@/lib/competitions/v7/model";
import { assembleReviewedGroupDetailsV7, assembleReviewedGroupsReportV7, createExplanationGroupSpecsV7, generateGroupExplanationV7, groupCallKeyV7, reviewPreparedGroupV7 } from "@/lib/competitions/v7/explanation-groups";
import { DEFAULT_EFFORT_POLICY, effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import type { DecisionModelCallV7 } from "@/lib/competitions/v7/model";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { student } from "../v6/decision-fixtures";
import { decodedGroupWire, groupReasonFixture, matchingRelationReviewBallotFixture } from "./group-reason-fixture";

function fixture() {
  const record = getMatchingCatalogRecords().find(row => row.seriesId === "if-student-award")!;
  const context = buildDecisionContextV7(student({ skills: ["research"], confirmedFields: ["stage", "skills"] }), { records: [record] });
  const fact = record.facts.find(row => row.field === "track")!, personal = context.profile.facts.find(row => row.field === "skills")!;
  const roleReason = { text: "未来可尝试比较用户体验路径，写出体验脚本和信息层级，并记录一处待核假设。", basis: "inference" as const,
    studentFactIds: [personal.id], competitionFactIds: [fact.id], conditions: [] };
  const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
    recommendations: [{ itemId: record.recordId, reasons: [{ text: fact.text, basis: "official", studentFactIds: [], competitionFactIds: [fact.id], conditions: [] }] }], shortfallReason: "本地接线只检查一个候选。" };
  const chosen: MatchPlanV6 = { ...plan, recommendations: [{ ...plan.recommendations[0], roleIndex: 1, roleReason }] };
  return { record, context, plan, chosen, roleReason };
}
const success = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });

it("uses only a valid reviewed role action, preserves optional legacy assembly and does not invent an Apple role", () => {
  const { record, context, plan, chosen, roleReason } = fixture();
  const base = assembleDecisionReport(context, chosen, { method: "llm", model: "deepseek-flash" }, { used: false, reason: null }, { admissionPolicy: "matching", profilePolicy: "self_report" });
  expect(base.recommendations[0].nextStep.text).toContain("气流");
  const aligned = applyReviewedRoleActionsV7(base, chosen, context);
  expect(aligned.recommendations[0].nextStep).toEqual(roleReason);
  expect(aligned.recommendations[0].checkpoint).toBe(record.roles[1].personalDeliverable);
  expect(aligned.summary.nextStep).toEqual(roleReason);
  expect(aligned.recommendations[0].nextStep.text).not.toMatch(/气流|通风/);
  expect(applyReviewedRoleActionsV7(base, plan, context)).toBe(base);
  const bad = { ...chosen, recommendations: [{ ...chosen.recommendations[0], roleIndex: 99 }] };
  expect(applyReviewedRoleActionsV7(base, bad, context)).toBe(base);
  const apple = getMatchingCatalogRecords().find(row => row.seriesId === "apple-swift-student-challenge")!;
  expect(apple.roles).toHaveLength(1); expect(apple.roles[0].task).toContain("自己实现");
  const appleContext = buildDecisionContextV7(student(), { records: [apple] });
  expect(validateMatchPlanV7({ ...chosen, profileRevision: appleContext.profile.revision, catalogVersion: appleContext.catalogVersion,
    recommendations: [{ ...chosen.recommendations[0], itemId: apple.recordId }] }, appleContext).ok).toBe(false);
});

it("carries the existing optional role through generation, support review, full and progressive v7 assembly", async () => {
  const { record, context, plan, chosen } = fixture();
  const run = { runId: randomUUID(), stateKey: "role-action-offline", generation: 1, implementationSha256: "a".repeat(64), effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), detailDeadlineEpochMs: Date.now() + 150_000 };
  const spec = createExplanationGroupSpecsV7(context, plan, run)[0]; const keys: string[] = [];
  const modelCall: DecisionModelCallV7 = async (prompt, options) => {
    keys.push(options.operation!); const wire = decodedGroupWire(prompt);
    if (options.operation === "competition_v7_explain") return success({ schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: wire.groupBindingSha256, groupId: spec.groupId,
      profileRevision: plan.profileRevision, catalogVersion: plan.catalogVersion, recommendations: chosen.recommendations.map((item, rowIndex) => ({ rowIndex, roleIndex: item.roleIndex, reason: groupReasonFixture(undefined, 0, "可以先比较两条用户体验路径，把观察到的问题和需要继续核对的假设分开记录。") })), shortfallReason: plan.shortfallReason });
    expect(wire.assertions).toHaveLength(1);
    expect(wire.assertions[0].reviewPurposes).toEqual(["recommendation_fit", "selected_role_action"]);
    return success({ checks: wire.assertions.map((row: { key: string }) => matchingRelationReviewBallotFixture(row.key, "离线接线测试")) });
  };
  const options = { requestId: run.runId, runBinding: run, deadlineEpochMs: run.detailDeadlineEpochMs - 750, modelCall };
  const generated = await generateGroupExplanationV7(context, plan, spec, options);
  expect(generated.prepared.explanation.recommendations[0].roleIndex).toBe(1);
  expect(generated.prepared.criticalKeys).toContain(`${record.recordId}.role`);
  const reviewed = await reviewPreparedGroupV7(context, plan, generated.prepared, { ...options,
    persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: run.runId, groupId: spec.groupId, groupBindingSha256: generated.prepared.groupBindingSha256, preparedSha256: generated.prepared.preparedSha256, persistedResultVersion: 2, groupVersion: 1 }, persistReviewPreparation: async () => {} });
  const detail = assembleReviewedGroupDetailsV7(context, plan, generated.prepared, reviewed.reviewed, run)[0], jointReason = generated.prepared.explanation.recommendations[0].reasons[0];
  expect(generated.prepared.explanation.recommendations[0].roleReason).toEqual(jointReason);
  expect(detail.nextStep).toEqual(jointReason); expect(detail.checkpoint).toBe(record.roles[1].personalDeliverable);
  const report = assembleReviewedGroupsReportV7(context, plan, [{ prepared: generated.prepared, reviewed: reviewed.reviewed }], run, { calls: ["explain", "review"].map(stage => ({ runId: run.runId, callId: randomUUID(), reservationId: randomUUID(), callKey: groupCallKeyV7(spec.groupId, stage as "explain" | "review"), upstreamAttempted: true, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 } })), startedAtEpochMs: Date.now() - 10, completedAtEpochMs: Date.now() });
  expect(report.recommendations[0].nextStep).toEqual(detail.nextStep); expect(report.summary.nextStep).toEqual(jointReason);
  expect(keys).toEqual(["competition_v7_explain", "competition_v7_review"]);
});

it("aligns the direct explain route only after its role claim passes the existing review", async () => {
  const { context, plan, chosen, roleReason } = fixture();
  const report = await explainDecisionV7(context, plan, { modelCall: async (prompt, options) => options.operation === "competition_v7_explain" ? success(chosen) : success({ checks: decodedGroupWire(prompt).assertions.map((row: { key: string }) => ({ key: row.key, supported: true, reason: "离线接线测试" })) }) });
  expect(report.recommendations[0].nextStep).toEqual(roleReason); expect(report.summary.nextStep).toEqual(roleReason);
  await expect(explainDecisionV7(context, plan, { modelCall: async (prompt, options) => options.operation === "competition_v7_explain" ? success(chosen) : success({ checks: decodedGroupWire(prompt).assertions.map((row: { key: string }) => ({ key: row.key, supported: false, reason: "保留真实拒绝" })) }) })).rejects.toThrow("unsupported_reason");
});
