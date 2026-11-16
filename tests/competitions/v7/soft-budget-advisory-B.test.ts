import { describe, expect, it } from "vitest";
import { assembleDecisionReport, claim } from "@/lib/competitions/v6/engine";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { applyReviewedRoleActionsV7, buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import { displayedRecommendationAdvisoriesV7, RECOMMENDATION_ADVISORY_PREFIXES } from "@/lib/competitions/v7/recommendation-notes";
import { student, syntheticRecord } from "../v6/decision-fixtures";

function paidRecord() {
  const record = syntheticRecord(1);
  const fact = {
    ...record.facts[0], id: "fixture.personal-cost", field: "cost", status: "verified_current" as const,
    text: "本场个人必付费用至少120元，且最高可达150元。",
  };
  record.facts.push(fact);
  record.cost = { scope: record.scope, factIds: [fact.id], note: fact.text, minimumPersonalCny: 120, maximumPersonalCny: 150 };
  return record;
}

function preference(scope: "personal" | "team", maximumYuan = 100) {
  return student({ interests: ["data"], confirmedFields: ["stage", "interests"],
    decisionContext: { budget: { scope, range: "100-500", maximumYuan } } });
}

const budgetNotice = (conditions: string[]) => conditions.find(note => note.startsWith(RECOMMENDATION_ADVISORY_PREFIXES.budget));

describe("known personal budget limit as a non-excluding, visible recommendation advisory", () => {
  it("retains the matching record and carries both sourced amounts to the student report", () => {
    const record = paidRecord();
    const context = buildDecisionContextV7(preference("personal"), { records: [record] });
    expect(context.excluded.has(record.recordId)).toBe(false);
    expect(context.candidates.map(row => row.record.recordId)).toEqual([record.recordId]);
    const note = budgetNotice(context.candidates[0].conditions);
    expect(note).toEqual(expect.stringContaining("120元"));
    expect(note).toEqual(expect.stringContaining("100元"));
    const plan: MatchPlanV6 = {
      profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, shortfallReason: null,
      recommendations: [{ itemId: record.recordId, reasons: [claim("你自述对数据感兴趣，可先做一份可复现的数据分析笔记。", "suggestion")] }],
    };
    const report = assembleDecisionReport(context, plan, {}, undefined, { admissionPolicy: "matching", profilePolicy: "self_report" });
    const [detail] = applyReviewedRoleActionsV7(report, plan, context).recommendations;
    expect(detail.eligibilityNotes).toContain(note);
    const shown = displayedRecommendationAdvisoriesV7(detail).find(row => row.text === note)?.claim;
    expect(shown?.competitionFactIds).toEqual(["fixture.personal-cost"]);
    expect(shown?.studentFactIds).toEqual([context.profile.facts.find(fact => fact.field === "budget.maximumYuan")?.id]);
  });

  it("does not mislabel a team cap, an equal personal cap, or a historical/mismatched source as a known overrun", () => {
    const historical = paidRecord();
    historical.facts.at(-1)!.status = "historical";
    const outOfScope = paidRecord();
    outOfScope.sources[0].scope = "其他届次和范围";
    const cases = [
      { record: paidRecord(), profile: preference("team") },
      { record: paidRecord(), profile: preference("personal", 120) },
      { record: historical, profile: preference("personal") },
      { record: outOfScope, profile: preference("personal") },
    ];
    for (const { record, profile } of cases) {
      const context = buildDecisionContextV7(profile, { records: [record] });
      expect(context.candidates.map(row => row.record.recordId)).toEqual([record.recordId]);
      expect(budgetNotice(context.candidates[0].conditions)).toBeUndefined();
    }
  });
});
