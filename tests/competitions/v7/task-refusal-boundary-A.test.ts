import { describe, expect, it } from "vitest";
import { getMatchingCatalogRecords } from "@/lib/competitions/v7/catalog";
import { buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import { RECOMMENDATION_ADVISORY_PREFIXES } from "@/lib/competitions/v7/recommendation-notes";
import { student, syntheticRecord } from "../v6/decision-fixtures";

const refusal = () => student({ stage: "undergraduate-2", decisionContext: { excludedTaskFormats: ["modeling"] } });

describe("applied modeling refusal follows the actual official task", () => {
  it("keeps both pure proof and applied modeling tracks and marks only the latter", () => {
    const proof = ["international-mathematics-competition", "national-college-mathematics", "yau-college-mathematics"];
    const applied = ["national-college-math-modeling", "comap-mcm-icm", "mathorcup"];
    const records = getMatchingCatalogRecords().filter(record => [...proof, ...applied].includes(record.seriesId));
    expect(records).toHaveLength(6); expect(records.every(record => record.taskFamily === "data-modeling")).toBe(true);
    const baseline = buildDecisionContextV7(student({ stage: "undergraduate-2" }), { records });
    expect(baseline.candidates).toHaveLength(6);
    const context = buildDecisionContextV7(refusal(), { records });
    expect(context.candidates.map(candidate => candidate.record.seriesId).sort()).toEqual([...proof, ...applied].sort());
    expect(context.excluded.size).toBe(0);
    const noted = context.candidates.filter(candidate => candidate.conditions.some(note => note.startsWith(RECOMMENDATION_ADVISORY_PREFIXES.task) && note.includes("数据建模与分析")));
    expect(noted.map(candidate => candidate.record.seriesId).sort()).toEqual([...applied].sort());
  });

  it("does not infer an unavoidable task from editorial labels or an explicitly negated modeling requirement", () => {
    const record = syntheticRecord(1);
    record.facts[0].text = "只需完成有限群数学证明，不需要数据建模或数据分析。";
    record.roles[0].task = "编辑可选的数据分析练习";
    record.sections.task[0].text = "可选建模路线";
    expect(buildDecisionContextV7(refusal(), { records: [record] }).candidates[0].conditions.some(note => note.startsWith(RECOMMENDATION_ADVISORY_PREFIXES.task))).toBe(false);
    record.facts[0].status = "pending_review";
    record.facts[0].text = "必须建立数学模型。";
    expect(buildDecisionContextV7(refusal(), { records: [record] }).candidates[0].conditions.some(note => note.startsWith(RECOMMENDATION_ADVISORY_PREFIXES.task))).toBe(false);
  });

  it("still honors directly supported data analysis and positive modeling requirements beside negative statements", () => {
    const analysis = syntheticRecord(1), mixed = syntheticRecord(2);
    mixed.facts[0].text = "不要求数据分析，但必须建立连续时间模型。";
    const context = buildDecisionContextV7(refusal(), { records: [analysis, mixed] });
    expect(context.candidates).toHaveLength(2); expect(context.excluded.size).toBe(0);
    expect(context.candidates.every(candidate => candidate.conditions.some(note => note.startsWith(RECOMMENDATION_ADVISORY_PREFIXES.task)))).toBe(true);
  });
});
