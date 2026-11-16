import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claim } from "@/lib/competitions/v6/engine";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { buildAssertionReviewPacketV7 } from "@/lib/competitions/v7/evidence-packet";
import { directAssertionReviewPacketV7 } from "@/lib/competitions/v7/review-transport";
import { getMatchingCatalogRecords } from "@/lib/competitions/v7/catalog";
import { buildDecisionContextV7, completeAssertionReviewPacketV7, DECISION_EXPLAIN_SYSTEM_PROMPT_V7, DECISION_MATCH_EXPLAIN_SYSTEM_PROMPT_V7, DECISION_RANK_SYSTEM_PROMPT_V7, DECISION_REVIEW_SYSTEM_PROMPT_V7, explanationEvidence, matchExplanationInputV7, rankDecisionV7, reviewSchema, validateMatchPlanV7 } from "@/lib/competitions/v7/model";
import { compactRankingCandidatesV7 } from "@/lib/competitions/v7/rank-packet";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("task_bridge_citation_test_forbids_provider"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
function fixture() {
  const records = [syntheticRecord(1), syntheticRecord(2)];
  const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records });
  const record = context.candidates[0].record;
  const plan = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
    recommendations: [{ itemId: record.recordId, reasons: [claim("可以尝试原任务中的分析练习。", "suggestion")], rankRoleIndex: 0 }], shortfallReason: "合成候选只选择一个原任务路径。" };
  return { context, record, plan };
}

describe("v7.33 explicit task-method bridge and citation namespaces", () => {
  it("retains every role and all 45 original candidate texts without a native default shortlist", () => {
    const context = buildDecisionContextV7(student(), { records: getMatchingCatalogRecords() }), before = structuredClone(context), packet = compactRankingCandidatesV7(context);
    expect(packet).toHaveLength(45);
    for (const [index, row] of packet.entries()) expect(row.contributions).toMatchObject(context.candidates[index].record.roles.map((role, roleIndex) => ({
      roleIndex, name: role.name, task: role.task, personalDeliverable: role.personalDeliverable, prerequisite: role.prerequisite,
    })));
    expect(context).toEqual(before);
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("不能换成学生目标场景");
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("fit填null");
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).not.toMatch(/最多5|先输出有据的正项/u);
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("各项依据同一标准判断，互不影响");
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("若学生的目标本身就是训练该通用流程");
    expect(DECISION_REVIEW_SYSTEM_PROMPT_V7).toContain("不要要求目标题材也出现在官方任务里");
  });

  it("gives each owner only its usable fact IDs, preserves fact/source originals, and encodes the namespace consistently", () => {
    const f = fixture(), original = f.record.facts[0];
    f.record.facts.push({ ...original, id: "unusable-task-id", status: "pending_review" });
    const before = structuredClone(f.context), input = matchExplanationInputV7(f.context, f.plan), candidate = input.candidates[0];
    expect(candidate.citationRules.competitionFactIds).toEqual([original.id]);
    expect(candidate.citationRules.competitionFactIds).toEqual(candidate.facts.map(fact => fact.id));
    expect(candidate.facts[0]).toMatchObject({ id: original.id, text: original.text, sourceIds: original.sourceIds });
    expect(candidate.citationRules.competitionFactIds).not.toContain(f.record.sources[0].id);
    expect(candidate.citationRules.competitionFactIds).not.toContain(f.context.candidates[1].record.facts[0].id);
    expect(explanationEvidence(f.context, f.plan)[0].citationRules.competitionFactIds).toEqual([original.id]);
    const codec = createModelIdentifierCodec({ candidates: f.context.candidates.map(row => row.record.recordId), series: f.context.candidates.map(row => row.record.seriesId),
      facts: f.context.candidates.flatMap(row => row.record.facts.map(fact => fact.id)), students: f.context.profile.facts.map(fact => fact.id) });
    const encoded = codec.encode(input) as typeof input;
    expect(encoded.candidates[0].citationRules.competitionFactIds).toEqual(encoded.candidates[0].facts.map(fact => fact.id));
    expect(encoded.candidates[0].citationRules.competitionFactIds.every(id => /^@F\d+$/.test(id))).toBe(true);
    expect(encoded.candidates[0].facts[0].sourceIds).toEqual(original.sourceIds);
    expect(f.context).toEqual(before);
  });

  it("keeps source IDs invalid even when the claim also cites a valid fact, without rewriting either reference", () => {
    const f = fixture(), sourceId = f.record.sources[0].id, factId = f.record.facts[0].id;
    const reason = claim("可根据原任务尝试分析并保留条件。", "inference", [f.context.profile.facts[0].id], [factId, sourceId]);
    const invalid = { ...f.plan, recommendations: [{ ...f.plan.recommendations[0], reasons: [reason], roleIndex: 0, roleReason: structuredClone(reason) }] };
    const before = structuredClone(invalid), checked = validateMatchPlanV7(invalid, f.context);
    expect(checked.ok).toBe(false);
    expect(checked.issues).toContain(`source_id_not_fact_id:${f.record.recordId}:${sourceId}`);
    expect(checked.issues.filter(issue => issue.includes(`unsupported_competition_fact:${sourceId}`))).toHaveLength(2);
    expect(invalid).toEqual(before);
    const validReason = { ...reason, competitionFactIds: [factId] };
    const valid = { ...invalid, recommendations: [{ ...invalid.recommendations[0], reasons: [validReason], roleReason: structuredClone(validReason) }] };
    expect(validateMatchPlanV7(valid, f.context).ok).toBe(true);
  });

  it("keeps source namespace warnings and the same-role bridge obligations in both generation routes", () => {
    for (const prompt of [DECISION_EXPLAIN_SYSTEM_PROMPT_V7, DECISION_MATCH_EXPLAIN_SYSTEM_PROMPT_V7]) {
      expect(prompt).toContain("citationRules.competitionFactIds");
      expect(prompt).toContain("fixedRoleIndex");
    }
    expect(DECISION_EXPLAIN_SYSTEM_PROMPT_V7).toContain("不把sourceId猜换成");
    expect(DECISION_MATCH_EXPLAIN_SYSTEM_PROMPT_V7).toContain("来源ID、角色文字、internalRationale、boundaries都不能替代赛事事实");
    expect(DECISION_MATCH_EXPLAIN_SYSTEM_PROMPT_V7).toContain("180–300字");
    expect(DECISION_MATCH_EXPLAIN_SYSTEM_PROMPT_V7).toContain("别选只有资格、费用、数字或格式的旁支事实");
    expect(DECISION_MATCH_EXPLAIN_SYSTEM_PROMPT_V7).toContain("原角色是编辑建议");
    expect(DECISION_MATCH_EXPLAIN_SYSTEM_PROMPT_V7).toContain("不能把任何未引事实填成已知栏值");
    expect(DECISION_REVIEW_SYSTEM_PROMPT_V7).toContain("supported=true必须是这两组义务全部成立的合取");
  });

  it.each([1, 2])("keeps the ranked %i strong matches, roles and distinct concrete internal rationales", async count => {
    const { context } = fixture();
    const rows = context.candidates.slice(0, count).map(({ record }, index) => ({
      itemId: record.recordId, roleIndex: 0, rationale: `你提到的数据分析可用于第${index + 1}项的清理记录，比较修改前后的字段与缺失项。`,
    }));
    const call = vi.fn(async (prompt: string, request: { systemPrompt?: string }) => {
      expect(request.systemPrompt).toContain("了解型指出原任务哪项具体内容可由原文弄清，不强求实测结果");
      expect(request.systemPrompt).toContain("各项依据同一标准判断，互不影响");
      const data = rankFixtureAssessmentReply(context, echoRankWireHeaders(prompt, { recommendations: rows.map(row => ({ ...row, ...rankFixtureEvidence(context, row.itemId) })), shortfallReason: "当前明确对应的任务只保留这些。" }));
      return { ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 };
    });
    const ranked = await rankDecisionV7(context, { modelCall: call });
    expect(call).toHaveBeenCalledTimes(1);
    expect(ranked.recommendations.map(({ itemId, rankRoleIndex, reasons }) => ({ itemId, roleIndex: rankRoleIndex, rationale: reasons[0].text }))).toEqual(rows);
    expect(matchExplanationInputV7(context, ranked).candidates.map(row => row.internalRationale?.[0].text)).toEqual(rows.map(row => row.rationale));
  });

  it("adds the complete original bound role and task conflict/source closure without changing cited evidence or joint verdict ownership", () => {
    const f = fixture(), fact = f.record.facts[0];
    const correction = { ...fact, id: "newer-task-correction", text: "补充限制：不得采集未获许可的数据。", supersedes: [fact.id] };
    f.record.facts.push(correction);
    const reason = claim("先核对原任务数据处理，再把核对方法用于目标分析；许可待核。", "inference", [f.context.profile.facts[0].id], [fact.id]);
    const plan = { ...f.plan, recommendations: [{ ...f.plan.recommendations[0], reasons: [reason], roleIndex: 0, roleReason: structuredClone(reason) }] };
    const assertions = [{ key: `${f.record.recordId}.reason.0`, itemId: f.record.recordId, reason }, { key: `${f.record.recordId}.role`, itemId: f.record.recordId, reason: structuredClone(reason) }];
    const raw = buildAssertionReviewPacketV7(f.context, plan, assertions);
    // Exercise the explicit missing-task branch; ordinary complete boundaries
    // must not grow another identical task context.
    raw.candidateBoundaries[0].boundaryFacts = [];
    const before = structuredClone(raw);
    const complete = completeAssertionReviewPacketV7(f.context, plan, raw), boundary = complete.candidateBoundaries[0];
    expect(boundary.selectedRoleOriginal).toEqual({ roleIndex: 0, ...f.record.roles[0], kind: "editorial_inference", use: "editorial_role_identity_and_action_boundary_not_official_or_student_positive_evidence" });
    expect(boundary.originalTaskContext!.facts).toEqual([fact, correction]);
    expect(boundary.originalTaskContext!.sourceBindings.sources).toEqual(f.record.sources);
    expect(complete.assertionEvidence).toEqual(before.assertionEvidence); expect(complete.assertions).toEqual(before.assertions); expect(raw).toEqual(before);
    const transport = directAssertionReviewPacketV7({ ...complete, fixedOrder: { ...complete.fixedOrder, groupReview: { studentPresentation: "compact_action_reason_v2" } } });
    expect(transport.jointReviewBindings).toHaveLength(1); expect(transport.packet.assertions).toHaveLength(1);
    expect(reviewSchema.parse(transport.restoreChecks({ checks: [{ key: transport.reviewKeys[0].alias, supported: false, reason: "原桥接缺口保留。" }] })).checks.map(row => row.supported)).toEqual([false, false]);
    const changed = structuredClone(raw); changed.assertionEvidence[1].editorialRoleIdentity!.name = "生成理由声称的另一角色";
    expect(() => completeAssertionReviewPacketV7(f.context, plan, changed)).toThrow("review_role_identity_changed");
  });

  it("does not infer a default role for an old unbound plan", () => {
    const f = fixture(), reason = claim(f.record.facts[0].text, "official", [], [f.record.facts[0].id]);
    const plan = { ...f.plan, recommendations: [{ itemId: f.record.recordId, reasons: [reason] }] };
    const raw = buildAssertionReviewPacketV7(f.context, plan, [{ key: `${f.record.recordId}.reason.0`, itemId: f.record.recordId, reason }]);
    expect(completeAssertionReviewPacketV7(f.context, plan, raw).candidateBoundaries[0]).not.toHaveProperty("selectedRoleOriginal");
  });
});
