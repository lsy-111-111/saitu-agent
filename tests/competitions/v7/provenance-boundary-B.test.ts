import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withDecisionEffortPolicy } from "@/lib/ai/effort-context";
import { DEFAULT_EFFORT_POLICY, effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import type { DecisionCompetitionRecord } from "@/lib/competitions/v6/catalog-types";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { claim } from "@/lib/competitions/v6/engine";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { buildAssertionReviewPacketV7 } from "@/lib/competitions/v7/evidence-packet";
import { assembleReviewedGroupDetailsV7, classifyGroupAssertionsV7, collectGroupAssertionsV7, createExplanationGroupSpecsV7, generateGroupExplanationV7, reviewPreparedGroupV7, type GroupRunBindingV7, type PersistedGroupAckV7, type PreparedGroupExplanationV7 } from "@/lib/competitions/v7/explanation-groups";
import { buildDecisionContextV7, DECISION_EXPLAIN_PROMPT_VERSION_V7, explanationEvidence, isReusedClaim, requiresSupportReviewV7, type DecisionModelCallV7 } from "@/lib/competitions/v7/model";
import { composeGroundedBridgeReasonV7, MATCHING_RELATION_LABEL_V764, studentLearningOptionsV7 } from "@/lib/competitions/v7/match-learning-selection";
import { expandReviewPacketV7, REVIEW_PACKET_PROJECTION_PROMPT_V7, REVIEW_PACKET_PROJECTION_VERSION_V7 } from "@/lib/competitions/v7/review-packet-projection";
import { directAssertionReviewPacketV7, MATCHING_RELATION_REVIEW_CONTRACT_V767 } from "@/lib/competitions/v7/review-transport";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { decodedGroupWire, groundedBridgeFixture, groupReasonFixture, matchingRelationReviewBallotFixture, studentFactBasis } from "./group-reason-fixture";
import { composeTaskConnectionV767 } from "@/lib/competitions/v7/role-task-practice";

const policy = { ...DEFAULT_EFFORT_POLICY, explain: "low" as const, review: "high" as const };
const officialTask = "依次读取整数；冲突时递增为最小未用值，最后输出完整序列。处理每个整数时保留此前使用过的值，并按原来读取顺序记录处理结果；最后给出所有位置的完整结果，不把自行选择的实现方法说成题目指定算法。";
const optionalMethod = "可尝试跳跃索引减少重复扫描，这是编辑提出的练习路线。";
const boundary = "仅任务原文来自主办方；跳跃索引路线是编辑推导，未获官方题解或评测背书。";
const badAssertion = "官方题目要求用跳跃索引完成序列处理。";
const optionalAssertion = "你可尝试用跳跃索引练习序列处理；这是可选编辑方法。";
const generalAction = "可独立建模与实现，交付不变量说明、代码和边界测试。";
const unsupportedScale = "输入规模保证不超过一百；可据此枚举所有排列。";
const success = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const, durationMs: 1, attempts: 1, httpStatus: 200, finishReason: "stop" });

function record(index: number): DecisionCompetitionRecord {
  const value = syntheticRecord(index), factId = value.facts[0].id;
  value.facts[0] = { ...value.facts[0], field: "track", text: officialTask };
  value.sections.track = [{ text: officialTask, kind: "official_fact", factIds: [factId], conditions: [] }];
  // Deliberately share the official task's ID. It supplies a premise, not an
  // official endorsement of the editorial sentence or the proposed method.
  value.sections.task = [{ text: optionalMethod, kind: "editorial_inference", factIds: [factId], conditions: [] }];
  value.roles[0].task = optionalMethod;
  value.deepDive = { status: "reviewed", representativeTask: officialTask,
    workedExample: { title: "序列练习", origin: "official_task", sourceIds: [value.sources[0].id], sourceBoundary: boundary, steps: [optionalMethod], reviewQuestions: [] },
    rubricMapping: [], rolePaths: [], fourWeekPlan: [], exitConditions: [], missingForPublication: [] };
  return value;
}
function fixture() {
  const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records: Array.from({ length: 10 }, (_, i) => record(i + 1)) });
  const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, shortfallReason: null,
    recommendations: context.candidates.slice(0, 5).map(({ record: value }) => ({ itemId: value.recordId, reasons: [claim("固定内部排序提示。", "suggestion")] })) };
  const run: GroupRunBindingV7 = { runId: randomUUID(), stateKey: "B-provenance-offline-only", generation: 0, implementationSha256: "a".repeat(64), effortPolicySha256: effortPolicySha256(policy), detailDeadlineEpochMs: Date.now() + 90_000 };
  return { context, plan, run };
}
function codec(context: ReturnType<typeof fixture>["context"]) {
  return createModelIdentifierCodec({ candidates: context.candidates.map(row => row.record.recordId), series: context.candidates.map(row => row.record.seriesId),
    facts: context.candidates.flatMap(row => row.record.facts.map(fact => fact.id)), students: context.profile.facts.map(fact => fact.id) });
}
function persisted(run: GroupRunBindingV7, prepared: PreparedGroupExplanationV7): PersistedGroupAckV7 {
  return { schemaVersion: "saitu.persisted-group-explanation.v1", runId: run.runId, groupId: prepared.groupSpec.groupId, groupBindingSha256: prepared.groupBindingSha256,
    preparedSha256: prepared.preparedSha256, persistedResultVersion: 3, groupVersion: 1 };
}
beforeEach(() => { vi.stubEnv("SAITU_V7_DETAIL_LAYOUT", "parallel-2"); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_provenance_test_forbids_http"); })); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("source provenance at the explanation and newly prepared review boundaries", () => {
  it("treats new conditions as part of an assertion while preserving empty and exact-section reuse", () => {
    const { context } = fixture(), own = context.candidates[0].record, itemId = own.recordId, factId = own.facts[0].id;
    const exact = claim(officialTask, "official", [], [factId]);
    expect(isReusedClaim(context, itemId, exact)).toBe(true);
    const conditionOnly = { ...exact, conditions: ["本届报名已经结束。"] };
    expect(isReusedClaim(context, itemId, conditionOnly)).toBe(false);
    expect(classifyGroupAssertionsV7(context, [{ itemId, key: `${itemId}.reason.0`, reason: conditionOnly }]).critical).toHaveLength(1);
    const studentFact = context.profile.facts.find(row => row.field === "skills")!;
    const studentQuote = claim(studentFact.originalText!, "student", [studentFact.id]);
    expect(isReusedClaim(context, itemId, studentQuote)).toBe(true);
    expect(isReusedClaim(context, itemId, { ...studentQuote, conditions: ["限额为十二。"] })).toBe(false);
    const plain = claim("可整理练习记录。", "suggestion");
    expect(requiresSupportReviewV7(plain)).toBe(false);
    expect(requiresSupportReviewV7({ ...plain, conditions: ["限额为十二。"] })).toBe(true);
    expect(classifyGroupAssertionsV7(context, [{ itemId, key: `${itemId}.reason.0`, reason: plain }]).critical).toEqual([]);
    const section = { text: "可对照已引任务做一次练习。", kind: "editorial_inference" as const, factIds: [factId], conditions: ["仅作练习"] };
    own.sections.nextStep = [section];
    expect(isReusedClaim(context, itemId, { ...claim(section.text, "suggestion", [], [factId]), conditions: [...section.conditions] })).toBe(true);
  });
  it("reviews an official relabeling of an exact editorial sentence while retaining optional reuse", () => {
    const { context } = fixture(), itemId = context.candidates[0].record.recordId, factId = context.candidates[0].record.facts[0].id;
    const official = claim(optionalMethod, "official", [], [factId]), optional = claim(optionalMethod, "suggestion", [], [factId]);
    expect(isReusedClaim(context, itemId, optional)).toBe(true);
    expect(isReusedClaim(context, itemId, official)).toBe(false);
    expect(classifyGroupAssertionsV7(context, [{ itemId, key: `${itemId}.reason.0`, reason: official }]).critical).toEqual([{ itemId, key: `${itemId}.reason.0`, reason: official }]);
    expect(isReusedClaim(context, itemId, claim(officialTask, "official", [], [factId]))).toBe(true);
    // Even an exact CatalogFact can be editorial. Its text must not bypass the
    // same official provenance guard through the earlier exact-fact branch.
    context.candidates[0].record.facts[0] = { ...context.candidates[0].record.facts[0], text: optionalMethod, kind: "editorial_inference" };
    expect(isReusedClaim(context, itemId, official)).toBe(false);
    expect(isReusedClaim(context, itemId, optional)).toBe(true);
  });
  it("keeps same-ID official text and optional editorial provenance distinct, including a missing sourceBoundary", async () => {
    const { context, plan, run } = fixture(), before = structuredClone(context.records);
    const captured: { title: string; roles: unknown[]; evidenceOptions: { text: string }[]; boundaries: { sourceBoundary: unknown; use: string } }[] = [], captureComplete = new Error("offline_generation_wire_captured");
    await withDecisionEffortPolicy(policy, async () => {
      for (const spec of createExplanationGroupSpecsV7(context, plan, run)) {
        await expect(generateGroupExplanationV7(context, plan, spec, { requestId: run.runId, runBinding: run, deadlineEpochMs: run.detailDeadlineEpochMs - 750,
          modelCall: async prompt => {
            const wire = expandCandidateEvidence(expandMatchingTables(decodedGroupWire(prompt))) as { candidates: typeof captured };
            expect(prompt).not.toMatch(/@[CFPS]\d+/u);
            captured.push(...wire.candidates); throw captureComplete;
          } })).rejects.toBe(captureComplete);
      }
    });
    expect(captured.map(row => row.title)).toEqual(plan.recommendations.map(row => context.candidates.find(candidate => candidate.record.recordId === row.itemId)!.record.name));
    for (const row of captured) {
      expect(row.evidenceOptions.map(fact => fact.text)).toEqual([officialTask]);
      expect(row.roles[0]).toMatchObject({ task: optionalMethod, kind: "editorial_inference" });
      expect(row.boundaries.sourceBoundary).toMatchObject({ origin: "official_task", use: "conditions_and_counterevidence_only_not_positive_support" });
      expect(row.boundaries.sourceBoundary).not.toHaveProperty("sourceBoundary");
      expect(row.boundaries.use).toBe("conditions_and_counterevidence_only_not_positive_support");
      expect(row).not.toHaveProperty("sections");
    }
    // The full evidence helper remains available to review and storage; the
    // compact generation wire carries only official positive facts and bounds.
    const candidates = explanationEvidence(context, plan);
    for (const row of candidates) {
      const original = before.find(record => record.recordId === row.itemId)!;
      expect(row.sections.track).toBeUndefined();
      expect(row.facts).toEqual(original.facts);
      expect(row.sources).toEqual(original.sources.map(({ evidenceArtifact: _artifact, verificationMethod: _method, retrievedAt: _retrieved, ...source }) => source));
      expect(row.facts[0]).toMatchObject({ text: officialTask, kind: "official_fact", sourceIds: [original.sources[0].id], scope: original.scope });
      expect(row.sections.task).toEqual([{ text: optionalMethod, kind: "editorial_inference", factIds: [row.facts[0].id], conditions: [],
        use: "optional_editorial_advice_not_official_requirement", factIdsArePremisesOnly: true }]);
      expect(row.roles[0]).toMatchObject({ task: optionalMethod, kind: "editorial_inference", use: "optional_editorial_advice_not_official_requirement", factIdsArePremisesOnly: true });
      expect(row.sourceBoundary).toMatchObject({ sourceBoundary: boundary, origin: "official_task", originMeaning: "origin_of_example_task_not_official_status_of_solution_steps",
        use: "conditions_and_counterevidence_only_not_positive_support" });
    }
    candidates[0].sections.task[0].factIds.push("caller-only-mutation");
    expect(context.records).toEqual(before);
    delete context.candidates[0].record.deepDive!.workedExample.sourceBoundary;
    const missing = explanationEvidence(context, plan)[0];
    expect(missing.sourceBoundary).toBeNull();
    expect(missing.roles[0]).toMatchObject({ kind: "editorial_inference", factIdsArePremisesOnly: true });
    expect(missing.sections.task[0]).toMatchObject({ kind: "editorial_inference", factIdsArePremisesOnly: true });
  });

  it.each([
    { text: "可整理练习记录。", conditions: ["本届报名已经结束。"], supported: false },
    { text: "可整理练习记录。", conditions: ["当前报名状态需核验。"], supported: true },
    { text: badAssertion, conditions: [], supported: false },
    { text: optionalAssertion, conditions: [], supported: true },
    { text: generalAction, conditions: [], supported: true },
    { text: unsupportedScale, conditions: [], supported: false },
  ])("keeps legacy raw assertion and condition judgments separate: $text $conditions", ({ text, conditions, supported }) => {
    const { context, plan } = fixture();
    const itemId = plan.recommendations[0].itemId;
    const record = context.candidates.find(row => row.record.recordId === itemId)!.record;
    const roleReason = claim("可整理练习记录。", "inference", [context.profile.facts.find(row => row.field === "skills")!.id], [record.facts[0].id]);
    const reason = { ...roleReason, text, basis: "suggestion" as const, studentFactIds: [], conditions };
    const item = { itemId, roleIndex: 0, reasons: [reason], roleReason };
    const legacy = { ...plan, recommendations: [item, ...plan.recommendations.slice(1)] };
    const raw = buildAssertionReviewPacketV7(context, legacy, collectGroupAssertionsV7({ recommendations: [item] }));
    const transport = directAssertionReviewPacketV7({ ...raw, fixedOrder: { ...raw.fixedOrder, groupReview: { studentPresentation: "compact_action_reason_v2" } } });
    expect(transport.packet.assertions).toHaveLength(2);
    expect(transport.jointReviewBindings).toEqual([]);
    expect(transport.packet.assertions[0].reason).toEqual(reason);
    const checks = transport.packet.assertions.map((row, index) => ({ key: row.key, supported: index === 0 ? supported : true, reason: "离线传输测试。" }));
    expect(transport.restoreChecks({ checks })).toEqual({ checks: [
      { key: `${itemId}.reason.0`, supported, reason: "离线传输测试。" },
      { key: `${itemId}.role`, supported: true, reason: "离线传输测试。" },
    ] });
  });

  // Injected reviewer judgments only test transport, persistence and outcome
  // propagation. A paid model's semantic rejection remains a separate study.
  it.each([false, true])("sends one g1 structured reason through both actual wires and retains supported=%s", async supported => {
    await withDecisionEffortPolicy(policy, async () => {
      const { context, plan, run } = fixture(), spec = createExplanationGroupSpecsV7(context, plan, run).find(row => row.groupId === "g1")!;
      const targetId = spec.itemIds[0], studentFactId = context.profile.facts.find(row => row.field === "skills")!.id;
      const record = context.candidates.find(row => row.record.recordId === targetId)!.record;
      const anchor = record.facts[0];
      const choice = groupReasonFixture(0, 0, "原题按读取次序保留各位置输出，便于判断不同实现是否处理了同样的冲突。");
      const bridge = composeTaskConnectionV767(studentFactBasis(), choice.taskConnection);
      const anchoredText = composeGroundedBridgeReasonV7(anchor, record.roles[0], groundedBridgeFixture(anchor.id, studentFactId, bridge), studentLearningOptionsV7(context.profile), MATCHING_RELATION_LABEL_V764)!.text;
      const requests: { operation: string; prompt: string }[] = [];
      const options = { requestId: run.runId, runBinding: run, deadlineEpochMs: run.detailDeadlineEpochMs - 750 };
      const generated = await generateGroupExplanationV7(context, plan, spec, { ...options, modelCall: async (prompt, request) => {
        requests.push({ operation: request.operation!, prompt });
        expect(request.promptVersion).toBe(`${DECISION_EXPLAIN_PROMPT_VERSION_V7}.detail-v2.explain`);
        expect(request.systemPrompt).toContain("标题或代码标记");
        expect(request.systemPrompt).toContain("180–300字");
        const wire = expandCandidateEvidence(expandMatchingTables(decodedGroupWire(prompt))) as { groupBindingSha256: string; candidates: { rowIndex: number; boundaries: { sourceBoundary: { origin: string } }; roles: { task: string; kind: string }[]; evidenceOptions: { text: string }[] }[] };
        expect(wire.candidates.map(row => row.rowIndex)).toEqual([0, 1, 2]);
        expect(prompt).not.toMatch(/@[CFPS]\d+/u);
        for (const row of wire.candidates) {
          expect(row.boundaries.sourceBoundary).not.toHaveProperty("sourceBoundary");
          expect(row.boundaries.sourceBoundary?.origin).toBe("official_task");
          expect(row).not.toHaveProperty("sections");
          expect(row.roles[0]).toMatchObject({ task: optionalMethod, kind: "editorial_inference" });
          expect(row.evidenceOptions[0].text).toBe(officialTask);
        }
        return success({ schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: wire.groupBindingSha256, groupId: "g1", profileRevision: context.profile.revision,
          catalogVersion: context.catalogVersion, shortfallReason: null, recommendations: spec.itemIds.map((_itemId, rowIndex) => ({ rowIndex, reason: choice, roleIndex: 0 })) });
      } });
      expect(generated.prepared.criticalKeys).toEqual(spec.itemIds.flatMap(itemId => [`${itemId}.reason.0`, `${itemId}.role`]));
      expect(generated.prepared.groupSpec.globalRanks).toEqual([3, 4, 5]);
      const immutablePrepared = structuredClone(generated.prepared), ack = persisted(run, generated.prepared);
      let preparationCommitted = false;
      const reviewer: DecisionModelCallV7 = async (prompt, request) => {
        requests.push({ operation: request.operation!, prompt });
        expect(preparationCommitted).toBe(true);
        const projectedWire = decodedGroupWire(prompt);
        expect(projectedWire.reviewProjection).toBe(REVIEW_PACKET_PROJECTION_VERSION_V7);
        expect(request.systemPrompt).toContain(REVIEW_PACKET_PROJECTION_PROMPT_V7);
        expect(request.systemPrompt).toContain("符合本项citedFacts和sources");
        const wire = codec(context).decode(expandReviewPacketV7(projectedWire)) as { assertions: { key: string; reason: { text: string; conditions: string[] }; competitionItems: { itemId: string; citedFacts: { text: string }[]; candidateBoundaryId: string }[] }[];
          sharedCandidateBoundaries: { boundaryId: string; itemId: string; boundary: ReturnType<typeof buildAssertionReviewPacketV7>["candidateBoundaries"][number] }[];
          fixedOrder: { groupReview: { preparedSha256: string; purpose: string } } };
        expect(wire.fixedOrder.groupReview.preparedSha256).toBe(ack.preparedSha256);
        expect(wire.fixedOrder.groupReview.purpose).toBe(MATCHING_RELATION_REVIEW_CONTRACT_V767);
        // The exact same-owner reason/action pair shares one provider verdict.
        expect(wire.assertions).toHaveLength(3);
        const target = wire.assertions.find(row => row.competitionItems[0].itemId === targetId)!;
        expect(target.reason.text).toBe(choice.taskConnection);
        expect(target.reason.conditions).toEqual([]);
        const own = target.competitionItems[0];
        expect(own.itemId).toBe(targetId);
        expect(own.citedFacts.map(fact => fact.text)).toEqual([officialTask]);
        expect(JSON.stringify(own.citedFacts)).not.toContain(optionalMethod);
        expect(JSON.stringify(own.citedFacts)).not.toContain(boundary);
        const shared = wire.sharedCandidateBoundaries.find(row => row.boundaryId === own.candidateBoundaryId)!;
        expect(shared.itemId).toBe(own.itemId);
        expect(shared.boundary.sourceBoundary).toMatchObject({ sourceBoundary: boundary, origin: "official_task", use: "conditions_and_counterevidence_only_not_positive_support" });
        expect(shared.boundary.editorialSectionBoundaries).toContainEqual(expect.objectContaining({ path: "/sections/task/0", kind: "editorial_inference", factIds: [context.candidates.find(row => row.record.recordId === targetId)!.record.facts[0].id], factIdsArePremisesOnly: true, use: "conditions_and_counterevidence_only_not_positive_support" }));
        // Shared review boundaries deliberately omit editorial prose from the
        // positive evidence surface, while retaining its original path/kind.
        expect(shared.boundary.editorialSectionBoundaries[0]).not.toHaveProperty("text");
        expect(shared.boundary.editorialRoleBoundaries[0]).toMatchObject({ kind: "editorial_inference", factIdsArePremisesOnly: true, use: "conditions_and_counterevidence_only_not_positive_support" });
        return success({ checks: wire.assertions.map(row => matchingRelationReviewBallotFixture(row.key, "离线注入结论，仅核验原判与原文传播。", { source: row.key !== target.key || supported })) });
      };
      const reviewed = await reviewPreparedGroupV7(context, plan, generated.prepared, { ...options, modelCall: reviewer, persisted: ack, persistReviewPreparation: async preparation => {
        expect(preparation.preparedSha256).toBe(ack.preparedSha256);
        expect(preparation.groupBindingSha256).toBe(ack.groupBindingSha256);
        expect(preparation.call.reasoningEffort).toBe("high");
        expect(preparation.call.reviewKeys).toHaveLength(6);
        expect(new Set(preparation.call.reviewKeys.map(row => row.alias)).size).toBe(3);
        expect(preparation.call.jointReviewBindings).toHaveLength(3);
        for (const binding of preparation.call.jointReviewBindings!) {
          expect(binding.keys).toHaveLength(2);
          expect(binding.reviewPurposes).toEqual(["recommendation_fit", "selected_role_action"]);
          expect(binding.verdictSemantics).toBe("conjunction_single_provider_verdict");
        }
        const whyAlias = preparation.call.reviewKeys.find(row => row.key === `${targetId}.reason.0`)!.alias;
        const roleAlias = preparation.call.reviewKeys.find(row => row.key === `${targetId}.role`)!.alias;
        expect(whyAlias).toBe(roleAlias);
        preparationCommitted = true;
      } });
      expect(requests.map(row => row.operation)).toEqual(["competition_v7_explain", "competition_v7_review"]);
      expect(generated.prepared).toEqual(immutablePrepared);
      expect(reviewed.reviewed.checks).toHaveLength(6);
      expect(reviewed.reviewed.checks.find(row => row.key === `${targetId}.reason.0`)).toEqual({ key: `${targetId}.reason.0`, supported, reason: "离线注入结论，仅核验原判与原文传播。" });
      expect(reviewed.reviewed.checks.find(row => row.key === `${targetId}.role`)?.supported).toBe(supported);
      expect(reviewed.reviewed.itemOutcomes[0]).toMatchObject({ itemId: targetId, globalRank: 3, status: supported ? "ready" : "failed" });
      const details = assembleReviewedGroupDetailsV7(context, plan, generated.prepared, reviewed.reviewed, run);
      expect(details.some(item => item.itemId === targetId)).toBe(supported);
      if (supported) expect(details.find(item => item.itemId === targetId)?.reasons[0].text).toBe(anchoredText);
    });
  });
});
