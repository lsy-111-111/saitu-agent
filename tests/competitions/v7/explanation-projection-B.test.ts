import { describe, expect, it } from "vitest";
import { auditExplanationSectionProjectionV7, buildAssertionReviewPacketV7, explanationRolesV7, explanationSectionsV7, matchingExplanationSectionsV7 } from "@/lib/competitions/v7/evidence-packet";
import { buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import { claim } from "@/lib/competitions/v6/engine";
import type { DecisionClaim } from "@/lib/competitions/v6/catalog-types";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { student, syntheticRecord } from "../v6/decision-fixtures";

describe("B conservative generation section projection", () => {
  it("only omits a same-owner exact official fact and keeps the full helper and record untouched", () => {
    const record = syntheticRecord(1), before = structuredClone(record), full = explanationSectionsV7(record), projected = auditExplanationSectionProjectionV7(record);
    expect(projected.omitted).toContainEqual(expect.objectContaining({ path: "/sections/track/0", rule: "exact_official_fact", coveredBy: ["/facts/0"] }));
    expect(projected.sections.track).toBeUndefined();
    for (const sectionName of ["investment", "eligibility", "participation", "difficulty"]) expect(projected.sections[sectionName]).toEqual(full[sectionName]);
    expect(record).toEqual(before); expect(explanationSectionsV7(record)).toEqual(full);
    projected.omitted[0].original.factIds.push("caller-mutation"); expect(record).toEqual(before);
  });

  it("retains unknowns, conditions and free-text fees or resource limits even with empty conditions", () => {
    const record = syntheticRecord(1), factIds = [record.facts[0].id];
    record.sections.investment = [{ text: "完整费用未知；题目的材料数量不是采购预算。", kind: "editorial_inference", factIds, conditions: [] }];
    record.sections.nextStep = [{ text: "完成试验必须先借到专用设备。", kind: "editorial_inference", factIds, conditions: [] }];
    record.sections.rubric = [{ text: record.facts[0].text, kind: "official_fact", factIds, conditions: ["仅限本地历史规则"] }];
    record.sections.value = [{ text: "相关资格未知。", kind: "unknown", factIds: [], conditions: [], unknownReason: "没有直接来源" }];
    const projected = matchingExplanationSectionsV7(record), full = explanationSectionsV7(record);
    for (const sectionName of ["investment", "nextStep", "rubric", "value"]) expect(projected[sectionName]).toEqual(full[sectionName]);
  });

  it("only removes the exact role template and falls back to the full sentence after any role or reference change", () => {
    const record = syntheticRecord(1), role = record.roles[0];
    record.sections.skills = [{ text: `${role.name}：${role.task}。需要的经历证据：${role.evidenceToAsk}`, kind: "editorial_inference", factIds: [...role.factIds], conditions: [] }];
    const projected = auditExplanationSectionProjectionV7(record);
    expect(projected.sections.skills).toBeUndefined();
    const proof = projected.omitted.find(row => row.path === "/sections/skills/0")!;
    const wireRole = explanationRolesV7(record)[0];
    expect(proof.original.text).toBe(`${wireRole.name}：${wireRole.task}。需要的经历证据：${wireRole.evidenceToAsk}`);
    expect(wireRole).toMatchObject({ kind: "editorial_inference", factIdsArePremisesOnly: true });
    record.roles[0].task += "，并保留新增限制";
    expect(matchingExplanationSectionsV7(record).skills).toEqual(explanationSectionsV7(record).skills);
  });

  it("keeps a unique negative value statement unless the complete same-kind text and citations remain in an assessment", () => {
    const record = syntheticRecord(1), text = "该练习不产生获奖身份或教师资格。";
    const original: DecisionClaim = { text, kind: "editorial_inference", factIds: [record.facts[0].id], conditions: [] };
    record.sections.value = [original];
    expect(matchingExplanationSectionsV7(record).value).toEqual(explanationSectionsV7(record).value);
    record.valueDimensions[0].assessment = { ...structuredClone(original), conditions: ["实际完成后仍需分别核验"] };
    expect(matchingExplanationSectionsV7(record).value).toEqual(explanationSectionsV7(record).value);
    record.valueDimensions[0].assessment.conditions = [];
    expect(matchingExplanationSectionsV7(record).value).toBeUndefined();
    expect(record.valueDimensions[0].assessment.text).toBe(text);
    record.valueDimensions[0].assessment.text = "该练习产生获奖身份。";
    expect(matchingExplanationSectionsV7(record).value).toEqual(explanationSectionsV7(record).value);
  });

  it("retains changed, ambiguous or no-longer-usable fact copies and unknown future narrative", () => {
    for (const change of ["text", "duplicate", "status"] as const) {
      const record = syntheticRecord(1);
      if (change === "text") record.facts[0].text += "新限制。";
      if (change === "duplicate") record.facts.push(structuredClone(record.facts[0]));
      if (change === "status") record.facts[0].status = "pending_review";
      expect(matchingExplanationSectionsV7(record).track).toEqual(explanationSectionsV7(record).track);
    }
    const record = syntheticRecord(2);
    record.sections.task = [{ text: "一段未来新增的自由说明，可能包含未知约束。", kind: "editorial_inference", factIds: [], conditions: [] }];
    expect(matchingExplanationSectionsV7(record).task).toEqual(explanationSectionsV7(record).task);
  });
});

describe("B review boundary owners", () => {
  function fixture() {
    const records = Array.from({ length: 10 }, (_, i) => syntheticRecord(i + 1));
    const context = buildDecisionContextV7(student(), { records });
    const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, shortfallReason: null,
      recommendations: context.candidates.slice(0, 5).map(row => ({ itemId: row.record.recordId, reasons: [claim("冻结内部提示。", "suggestion")] })) };
    return { context, plan };
  }

  it("keeps both top-two comparison owners and B's unique unknown cost even with no B citation or ordinary assertion", () => {
    const { context, plan } = fixture(), [a, b] = plan.recommendations;
    const recordA = context.candidates.find(row => row.record.recordId === a.itemId)!.record, recordB = context.candidates.find(row => row.record.recordId === b.itemId)!.record;
    recordB.cost = { minimumPersonalCny: null, maximumPersonalCny: null, factIds: [], scope: recordB.scope, note: "B的个人总费用与必要设备费用均未知。" };
    recordB.sections.investment.push({ text: "B仍须核对专用设备。", kind: "unknown", factIds: [], conditions: [], unknownReason: "未确认本人持有设备" });
    plan.comparison = claim("A比B更省钱。", "suggestion", [], [recordA.facts[0].id]);
    const packet = buildAssertionReviewPacketV7(context, plan, [{ key: "comparison", itemId: a.itemId, reason: plan.comparison }]);
    expect(packet.fixedOrder.itemIds).toEqual(plan.recommendations.map(row => row.itemId));
    expect(packet.fixedOrder.itemIds).toHaveLength(5);
    expect(packet.candidateBoundaries.map(row => row.itemId)).toEqual([a.itemId, b.itemId]);
    expect(packet.assertionEvidence[0].allowedItemIds).toEqual([a.itemId, b.itemId]);
    expect(packet.assertionEvidence[0].competitionItems[1].citedFacts).toEqual([]);
    expect(packet.candidateBoundaries[1].cost).toEqual(recordB.cost);
    expect(packet.candidateBoundaries[1].qualifiers).toContainEqual(expect.objectContaining({ value: recordB.sections.investment.at(-1) }));
  });

  it("never supplies an unrelated selected owner's boundaries as support or accepts its foreign citation", () => {
    const { context, plan } = fixture(), [a, , c] = plan.recommendations;
    const own = context.candidates.find(row => row.record.recordId === a.itemId)!.record, foreign = context.candidates.find(row => row.record.recordId === c.itemId)!.record;
    a.reasons = [claim("A比未授权的C更便宜。", "suggestion", [], [own.facts[0].id])];
    const packet = buildAssertionReviewPacketV7(context, plan, [{ key: `${a.itemId}.reason.0`, itemId: a.itemId, reason: a.reasons[0] }]);
    expect(packet.candidateBoundaries.map(row => row.itemId)).toEqual([a.itemId]);
    expect(packet.assertionEvidence[0].allowedItemIds).toEqual([a.itemId]);
    expect(packet.assertions[0].reason.text).toBe("A比未授权的C更便宜。");
    a.reasons[0].competitionFactIds.push(foreign.facts[0].id);
    expect(() => buildAssertionReviewPacketV7(context, plan, [{ key: `${a.itemId}.reason.0`, itemId: a.itemId, reason: a.reasons[0] }])).toThrow("invalid_review_competition_fact_scope");
  });
});
