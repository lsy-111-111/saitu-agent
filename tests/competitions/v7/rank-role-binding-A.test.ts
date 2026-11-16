import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EFFORT_POLICY, effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import { matchPlanSchema, type MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { claim } from "@/lib/competitions/v6/engine";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { assembleReviewedGroupDetailsV7, combineReviewedGroupPlanV7, createExplanationGroupSpecsV7, generateGroupExplanationV7, groupCanonicalSha256V7, reviewPreparedGroupV7, validatePreparedGroupV7, type PreparedGroupExplanationV7, type ReviewedPreparedGroupV7 } from "@/lib/competitions/v7/explanation-groups";
import { assertRankRoleBindingsV7, buildDecisionContextV7, DECISION_RANK_SYSTEM_PROMPT_V7, explainDecisionV7, matchExplanationInputV7, rankDecisionV7, validateMatchPlanV7, type DecisionModelCallV7 } from "@/lib/competitions/v7/model";
import { compactRankingCandidatesV7 } from "@/lib/competitions/v7/rank-packet";
import { composeGroundedBridgeReasonV7, MATCHING_RELATION_LABEL_V764, studentLearningOptionsV7 } from "@/lib/competitions/v7/match-learning-selection";
import { composeTaskConnectionV767, rankTaskFocusOptionsV7 } from "@/lib/competitions/v7/role-task-practice";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";
import { decodedGroupWire, groundedBridgeFixture, matchingRelationReviewBallotFixture, serverBoundGroupReasonFixture, studentFactBasis } from "./group-reason-fixture";

function fixture(count = 5) {
  const records = Array.from({ length: 45 }, (_, index) => syntheticRecord(index + 1));
  for (const record of records) record.roles.push({ ...record.roles[0], name: "第二分析角色", task: "核对报告中的处理决策及可复现性", personalDeliverable: "本人形成的分析核对记录" });
  const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records });
  const raw = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
    recommendations: context.candidates.slice(0, count).reverse().map(({ record }) => ({ itemId: record.recordId, roleIndex: 1, rationale: "用自报分析能力在第二角色核对报告可复现性。", ...rankFixtureEvidence(context, record.recordId) })), shortfallReason: count < 5 ? "合成测试仅返回既定数量。" : null };
  const run = { runId: randomUUID(), stateKey: "rank-role-binding-offline", generation: 0, implementationSha256: "a".repeat(64), effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), detailDeadlineEpochMs: Date.now() + 150_000 };
  return { context, raw, run };
}
const success = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });
beforeEach(() => {
  vi.stubEnv("SAITU_V7_DETAIL_LAYOUT", "single");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("rank_role_binding_test_forbids_http"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("rank role identity persists through new generation and review", () => {
  it("marks all 45 candidates' original zero-based roles without changing text, order, or model selection", async () => {
    const f = fixture(), before = structuredClone(f.context), cards = compactRankingCandidatesV7(f.context);
    expect(cards).toHaveLength(45);
    cards.forEach((card, index) => expect(card.contributions).toEqual(f.context.candidates[index].record.roles.map((role, roleIndex) => ({
      roleIndex, name: role.name, task: role.task, personalDeliverable: role.personalDeliverable, prerequisite: role.prerequisite,
      taskSteps: rankTaskFocusOptionsV7(role.task).slice(1),
    }))));
    let calls = 0;
    const plan = await rankDecisionV7({ ...f.context, candidates: [...f.context.candidates].reverse() }, { modelCall: async (prompt, options) => {
      calls++; const wire = decodedGroupWire(prompt); expect(wire.candidates).toHaveLength(45);
      expect(wire.candidates.every((row: { contributions: { roleIndex: number }[] }) => row.contributions.map(role => role.roleIndex).join(",") === "0,1")).toBe(true);
      expect(options).toMatchObject({ thinking: "enabled", reasoningEffort: "low", maxTokens: 8192, maxAttempts: 1 });
      return success(rankFixtureAssessmentReply(f.context, echoRankWireHeaders(prompt, f.raw)));
    } });
    expect(calls).toBe(1); expect(plan.recommendations.map(item => item.itemId)).toEqual(f.raw.recommendations.map(item => item.itemId).sort());
    expect(plan.recommendations.every(item => item.rankRoleIndex === 1 && item.roleIndex === undefined && item.roleReason === undefined)).toBe(true);
    expect(() => assertRankRoleBindingsV7(f.context, plan)).not.toThrow(); expect(f.context).toEqual(before);
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("不对未选全池作未核验的题材归类");
  });

  it.each([undefined, null, "1", -1, 0.5, 2, 31])("rejects rank role %j without defaults, guesses, or a repair", async roleIndex => {
    const f = fixture(), raw = structuredClone(f.raw); Reflect.set(raw.recommendations[0], "roleIndex", roleIndex);
    if (roleIndex === undefined) Reflect.deleteProperty(raw.recommendations[0], "roleIndex");
    let calls = 0;
    const modelCall: DecisionModelCallV7 = async (prompt, options) => {
      calls++; const parsed = options.schema!.safeParse(rankFixtureAssessmentReply(f.context, echoRankWireHeaders(prompt, raw)));
      return parsed.success ? success(parsed.data) : { ok: false, reason: "invalid_output", upstreamAttempted: true, model: "deepseek-flash", attempts: 1 };
    };
    await expect(rankDecisionV7(f.context, { modelCall })).rejects.toThrow("invalid_output"); expect(calls).toBe(1);
  });

  it.each([null, "missing-role-row", []])("does not repair an entirely malformed rank row %j into a guessed role", async row => {
    const f = fixture(); let calls = 0;
    await expect(rankDecisionV7(f.context, { modelCall: async (prompt, options) => {
      calls++; const raw = rankFixtureAssessmentReply(f.context, echoRankWireHeaders(prompt, f.raw)); Reflect.set(raw.assessments, 0, row);
      expect(options.schema!.safeParse(raw).success).toBe(false);
      return { ok: false, reason: "invalid_output", upstreamAttempted: true, model: "deepseek-flash", attempts: 1 };
    } })).rejects.toThrow("invalid_output"); expect(calls).toBe(1);
  });

  it.each(["single", "parallel-2"])("keeps the selected original role through %s generation, joint review, partial publication and merge", async layout => {
    vi.stubEnv("SAITU_V7_DETAIL_LAYOUT", layout);
    const f = fixture(), plan = await rankDecisionV7(f.context, { modelCall: async prompt => success(rankFixtureAssessmentReply(f.context, echoRankWireHeaders(prompt, f.raw))) });
    const specs = createExplanationGroupSpecsV7(f.context, plan, f.run), personal = f.context.profile.facts.find(fact => fact.field === "skills")!;
    const learningOptions = studentLearningOptionsV7(f.context.profile);
    const { taskConnection } = serverBoundGroupReasonFixture();
    const bridge = composeTaskConnectionV767(studentFactBasis(), taskConnection);
    const anchoredText = (itemId: string) => {
      const record = f.context.candidates.find(row => row.record.recordId === itemId)!.record;
      const anchor = record.facts[0];
      return composeGroundedBridgeReasonV7(anchor, record.roles[1], groundedBridgeFixture(anchor.id, personal.id, bridge), learningOptions, MATCHING_RELATION_LABEL_V764)!.text;
    };
    const groups: { prepared: PreparedGroupExplanationV7; reviewed: ReviewedPreparedGroupV7 }[] = [];
    for (const spec of specs) {
      const options = { requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750 };
      const generated = await generateGroupExplanationV7(f.context, plan, spec, { ...options, modelCall: async prompt => {
        const wire = expandCandidateEvidence(expandMatchingTables(decodedGroupWire(prompt))) as { candidates: { rowIndex: number; roles: { roleIndex: number; name: string; taskOptions: { index: number; text: string }[] }[]; rankedSelection: { factIndex: number; taskStepIndex: number } }[]; groupBindingSha256: string };
        expect(wire.candidates.every(row => row.roles.length === 1 && row.roles[0].roleIndex === 1 && row.roles[0].name === "第二分析角色")).toBe(true);
        expect(wire).not.toHaveProperty("studentBasisOptions"); expect(wire).not.toHaveProperty("studentGoalOptions");
        for (const row of wire.candidates) {
          expect(row).not.toHaveProperty("internalRationale");
          expect(row).not.toHaveProperty("fixedStudentBasis");
          expect(row).not.toHaveProperty("rankBasisGoal");
          expect(row.rankedSelection.taskStepIndex).toBe(0);
          expect(row.roles[0].taskOptions).toEqual([{ index: 0, text: "核对报告中的处理决策及可复现性" }]);
        }
        return success({ schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: wire.groupBindingSha256, groupId: spec.groupId,
          profileRevision: plan.profileRevision, catalogVersion: plan.catalogVersion, shortfallReason: plan.shortfallReason,
          recommendations: spec.itemIds.map((_itemId, rowIndex) => ({ rowIndex, reason: { ...serverBoundGroupReasonFixture(), factIndex: wire.candidates[rowIndex].rankedSelection.factIndex } })) });
      } });
      expect(generated.prepared.explanation.recommendations.every(item => item.rankRoleIndex === 1 && item.roleIndex === 1 && item.roleReason?.text === anchoredText(item.itemId))).toBe(true);
      const reviewed = await reviewPreparedGroupV7(f.context, plan, generated.prepared, { ...options,
        persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: f.run.runId, groupId: spec.groupId, groupBindingSha256: generated.prepared.groupBindingSha256, preparedSha256: generated.prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 }, persistReviewPreparation: async () => {},
        modelCall: async prompt => {
          const wire = decodedGroupWire(prompt); expect(wire.assertions).toHaveLength(spec.itemIds.length);
          const focus = "核对报告中的处理决策及可复现性";
          expect(wire.assertions.map((row: { reason: { text: string }; selectedTaskFocus: string }) =>
            ({ focus: row.selectedTaskFocus, bridge: row.reason.text }))).toEqual(spec.itemIds.map(() => ({ focus, bridge: taskConnection })));
          expect(wire.assertions.every((row: { editorialRoleIdentity: { roleIndex: number; name: string }; reviewPurposes: string[] }) => row.editorialRoleIdentity.roleIndex === 1 && row.editorialRoleIdentity.name === "第二分析角色" && row.reviewPurposes.join(",") === "recommendation_fit,selected_role_action")).toBe(true);
          return success({ checks: wire.assertions.map((row: { key: string }) => matchingRelationReviewBallotFixture(row.key, "合成证据支持四项审核。")) });
        } });
      expect(assembleReviewedGroupDetailsV7(f.context, plan, generated.prepared, reviewed.reviewed, f.run).map(row => row.itemId)).toEqual(spec.itemIds);
      const altered = structuredClone(generated.prepared); delete altered.explanation.recommendations[0].rankRoleIndex;
      expect(() => validatePreparedGroupV7(f.context, plan, altered, f.run)).toThrow("invalid_output");
      for (const previousVersion of ["saitu-explain.v7.35.reason180-300", "saitu-explain.v7.36.resource-role-path"]) {
        const olderBinding = structuredClone(generated.prepared);
        olderBinding.groupSpec.explanationPromptVersion = previousVersion;
        expect(() => validatePreparedGroupV7(f.context, plan, olderBinding, f.run)).toThrow("stale_or_changed_group_binding");
        expect(olderBinding.groupSpec.explanationPromptVersion).toBe(previousVersion);
      }
      groups.push({ prepared: generated.prepared, reviewed: reviewed.reviewed });
    }
    const merged = combineReviewedGroupPlanV7(f.context, plan, groups, f.run);
    expect(merged.recommendations.map(item => item.itemId)).toEqual(plan.recommendations.map(item => item.itemId));
    expect(merged.recommendations.every(item => item.rankRoleIndex === 1 && item.roleIndex === 1 && item.reasons[0].text === anchoredText(item.itemId))).toBe(true);
  });

  it.each(["roleIndex", "studentFactIds", "goalIndex"])("rejects an extra generated binding %s in one call", async field => {
    const f = fixture(1), plan = await rankDecisionV7(f.context, { modelCall: async prompt => success(rankFixtureAssessmentReply(f.context, echoRankWireHeaders(prompt, f.raw))) });
    const spec = createExplanationGroupSpecsV7(f.context, plan, f.run)[0], personal = f.context.profile.facts.find(fact => fact.field === "skills")!;
    let calls = 0;
    await expect(generateGroupExplanationV7(f.context, plan, spec, { requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750, modelCall: async (prompt, options) => {
      calls++;
      const item = { rowIndex: 0, reason: { ...serverBoundGroupReasonFixture(), factIndex: decodedGroupWire(prompt).candidates[0].rankedSelection.factIndex } };
      if (field === "roleIndex") Reflect.set(item, field, 0);
      else Reflect.set(item.reason, field, field === "goalIndex" ? 0 : [personal.id]);
      const raw = { schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: decodedGroupWire(prompt).groupBindingSha256, groupId: spec.groupId,
        profileRevision: plan.profileRevision, catalogVersion: plan.catalogVersion, shortfallReason: plan.shortfallReason,
        recommendations: [item] };
      const parsed = options.schema!.safeParse(raw);
      return parsed.success ? success(parsed.data) : { ok: false, reason: "invalid_output", upstreamAttempted: true, model: "deepseek-flash", attempts: 1 };
    } })).rejects.toThrow("invalid_output"); expect(calls).toBe(1);
  });

  it("also binds the legacy direct entry point when its input came from fresh ranking", async () => {
    const f = fixture(1), plan = await rankDecisionV7(f.context, { modelCall: async prompt => success(rankFixtureAssessmentReply(f.context, echoRankWireHeaders(prompt, f.raw))) });
    let calls = 0;
    await expect(explainDecisionV7(f.context, plan, { modelCall: async () => {
      calls++; const reason = claim(f.context.candidates[0].record.facts[0].text, "official", [], [f.context.candidates[0].record.facts[0].id]);
      return success({ ...plan, recommendations: [{ itemId: plan.recommendations[0].itemId, reasons: [reason], roleIndex: 0, roleReason: structuredClone(reason) }] });
    } })).rejects.toThrow("invalid_output"); expect(calls).toBe(1);
  });

  it("leaves old absent bindings absent and their canonical hash unchanged", () => {
    const f = fixture(1), legacy: MatchPlanV6 = { profileRevision: f.context.profile.revision, catalogVersion: f.context.catalogVersion,
      recommendations: [{ itemId: f.context.candidates[0].record.recordId, reasons: [claim("旧排序提示。", "suggestion")] }], shortfallReason: "旧合成一项结果。" };
    const before = groupCanonicalSha256V7(legacy), parsed = matchPlanSchema.parse(legacy);
    expect(parsed).toEqual(legacy); expect(parsed.recommendations[0]).not.toHaveProperty("rankRoleIndex");
    expect(groupCanonicalSha256V7(parsed)).toBe(before); expect(validateMatchPlanV7(parsed, f.context).ok).toBe(true);
    const packet = matchExplanationInputV7(f.context, parsed); expect(packet.candidates[0]).not.toHaveProperty("fixedRoleIndex"); expect(packet.candidates[0].roles).toHaveLength(2);
    expect(() => assertRankRoleBindingsV7(f.context, parsed)).toThrow("invalid_rank_role_binding");
    const mixed = { ...legacy, recommendations: [{ ...legacy.recommendations[0], rankRoleIndex: 1 }, { itemId: f.context.candidates[1].record.recordId, reasons: [claim("无绑定的第二项。", "suggestion")] }] };
    expect(validateMatchPlanV7(mixed, f.context).issues).toContain("incomplete_rank_role_bindings");
  });
});
