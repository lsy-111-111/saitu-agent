import { describe, expect, it } from "vitest";
import { COMPACT_TASK_COPY_V7 } from "@/content/competitions-v6/compact-task-copy";
import { COMPACT_VALUE_COPY_V7 } from "@/content/competitions-v6/compact-value-copy";
import { getMatchingCatalogRecords, matchingCoreDigest } from "@/lib/competitions/v7/catalog";
import { compactContentLengthV7, compactTaskClaimV7, selectCompactValuesV7 } from "@/lib/competitions/v7/compact-content";
import { decisionGoalLabels } from "@/lib/competitions/v6/profile";
import type { DecisionClaimV6, DecisionRecommendationV6 } from "@/lib/competitions/v6/contracts";

const makeClaim = (text: string, basis: DecisionClaimV6["basis"] = "suggestion"): DecisionClaimV6 => ({
  text, basis, studentFactIds: ["student-self-report"], competitionFactIds: ["scoped-official-fact"],
  conditions: ["以实际完成相应工作为前提。"],
});
const values = (): DecisionRecommendationV6["values"] => [
  "governance", "taskRelevance", "portfolio", "learningFeedback", "industryAcademicAccess", "recognition",
].map(dimension => ({ dimension, claim: makeClaim(`${dimension}的原有说明。`) }));

describe("compact task sidecar", () => {
  it("covers the actual 45-record pool, binds its original task evidence, and leaves catalog hashes unchanged", () => {
    const records = getMatchingCatalogRecords();
    const hashes = records.map(matchingCoreDigest);
    expect(records).toHaveLength(45);
    expect(Object.keys(COMPACT_TASK_COPY_V7).sort()).toEqual(records.map(record => record.recordId).sort());
    for (const record of records) {
      const task = record.sections.task[0];
      const coreTask: DecisionClaimV6 = {
        text: task.text, basis: "suggestion", studentFactIds: [],
        competitionFactIds: [...task.factIds], conditions: [...task.conditions, "测试保留的适用条件。"],
      };
      const output = compactTaskClaimV7({ itemId: record.recordId, coreTask });
      expect(compactContentLengthV7(output.text), record.recordId).toBeGreaterThanOrEqual(40);
      expect(compactContentLengthV7(output.text), record.recordId).toBeLessThanOrEqual(70);
      expect(output.text).toBe(COMPACT_TASK_COPY_V7[record.recordId].text);
      expect({ ...output, text: task.text }).toEqual(coreTask);
      expect(output).not.toBe(coreTask);
      expect(output.conditions).not.toBe(coreTask.conditions);
      expect(task.factIds.every(id => record.facts.some(fact => fact.id === id))).toBe(true);
    }
    expect(records.map(matchingCoreDigest)).toEqual(hashes);
    expect(getMatchingCatalogRecords().map(matchingCoreDigest)).toEqual(hashes);
  });

  it("keeps unknown, differently cited, changed, and unrecognised archived claims verbatim", () => {
    const [itemId, copy] = Object.entries(COMPACT_TASK_COPY_V7)[0];
    const original: DecisionClaimV6 = { text: copy.sourceText, basis: "suggestion", studentFactIds: [], competitionFactIds: [...copy.sourceFactIds], conditions: ["原有条件。"] };
    for (const coreTask of [
      { ...original, basis: "unknown" as const },
      { ...original, basis: "official" as const },
      { ...original, text: "这份旧报告的任务原文不同，不应被当前目录覆盖。" },
      { ...original, competitionFactIds: ["different-scope"] },
      { ...original, studentFactIds: ["personalised-student-fact"] },
    ]) expect(compactTaskClaimV7({ itemId, coreTask })).toEqual(coreTask);
    expect(compactTaskClaimV7({ itemId: "unknown-archived-id", coreTask: original })).toEqual(original);
    expect(compactTaskClaimV7({ itemId: "__proto__", coreTask: original })).toEqual(original);
  });
});

describe("compact value selection without generation", () => {
  it.each([
    ["project", ["portfolio", "taskRelevance"]],
    ["award", ["recognition", "governance"]],
    ["postgraduate", ["learningFeedback", "portfolio"]],
    ["employment", ["portfolio", "taskRelevance"]],
    ["portfolio", ["portfolio", "taskRelevance"]],
    ["entrepreneurship", ["taskRelevance", "portfolio"]],
    ["networking", ["industryAcademicAccess", "learningFeedback"]],
    ["explore", ["taskRelevance", "learningFeedback"]],
    ["skill", ["learningFeedback", "portfolio"]],
  ])("uses the existing %s goal and keeps its two relevant dimensions", (goal, expected) => {
    for (const primaryGoal of [goal, decisionGoalLabels[goal as string]]) {
      expect(selectCompactValuesV7({ values: values() }, { primaryGoal: primaryGoal as string, goals: [] }).map(value => value.dimension)).toEqual(expected);
    }
  });

  it("respects confirmed priority and gives both undecided goals a relevant dimension", () => {
    const item = { values: values() };
    expect(selectCompactValuesV7(item, { primaryGoal: "争取奖项", goals: ["积累项目经历", "争取奖项"] }).map(value => value.dimension)).toEqual(["recognition", "governance"]);
    expect(selectCompactValuesV7(item, { primaryGoal: null, goals: ["积累项目经历", "争取奖项"] }).map(value => value.dimension)).toEqual(["portfolio", "recognition"]);
    expect(selectCompactValuesV7(item, { primaryGoal: "未识别的自定目标", goals: [] }).map(value => value.dimension)).toEqual(["taskRelevance", "portfolio"]);
  });

  it("prefers supported copy over unknown opportunities and preserves unknown wording when needed", () => {
    const item = { values: values() };
    item.values.find(value => value.dimension === "industryAcademicAccess")!.claim = makeClaim("尚无可核实的导师接触机会，不作保证。", "unknown");
    const selected = selectCompactValuesV7(item, { primaryGoal: "认识合作伙伴", goals: [] });
    expect(selected.map(value => value.dimension)).toEqual(["learningFeedback", "taskRelevance"]);
    const sparse = { values: [item.values[4], item.values[3]] };
    const result = selectCompactValuesV7(sparse, { primaryGoal: "认识合作伙伴", goals: [] });
    expect(result.map(value => value.dimension)).toEqual(["learningFeedback", "industryAcademicAccess"]);
    expect(result[1].claim).toEqual(item.values[4].claim);
    expect(result[1].claim.basis).toBe("unknown");
  });

  it("keeps sources and conditions intact, deduplicates text, and never mutates the report", () => {
    const item = { values: values() };
    item.values[1].claim = makeClaim("同一条已有价值说明。");
    item.values[2].claim = makeClaim("同一条已有价值说明。");
    const before = structuredClone(item);
    const result = selectCompactValuesV7(item);
    expect(result.map(value => value.dimension)).toEqual(["taskRelevance", "learningFeedback"]);
    expect(result[0].claim).toEqual(before.values[1].claim);
    expect(result[0].claim).not.toBe(item.values[1].claim);
    result[0].claim.conditions.push("只改展示副本。");
    result[0].claim.competitionFactIds.push("not-original");
    expect(item).toEqual(before);
    expect(selectCompactValuesV7({ values: [before.values[1], before.values[2]] })).toHaveLength(1);
    expect(selectCompactValuesV7({ values: [] })).toEqual([]);
  });

  it("continues reading archived dimension names without relabelling their claims", () => {
    const item = { values: [
      { dimension: "employment", claim: makeClaim("旧版就业相关说明。") },
      { dimension: "skill", claim: makeClaim("旧版训练说明。") },
      { dimension: "portfolio", claim: makeClaim("旧版作品说明。") },
    ] };
    expect(selectCompactValuesV7(item, { primaryGoal: "networking", goals: [] })).toEqual(item.values.slice(0, 2));
  });

  it("shortens all 135 known task, work and feedback values while retaining citations and conditions", () => {
    const records = getMatchingCatalogRecords();
    const currentTexts = new Set<string>();
    for (const record of records) for (const value of record.valueDimensions) {
      if (!["taskRelevance", "portfolio", "learningFeedback"].includes(value.dimension)) continue;
      const source: DecisionClaimV6 = { text: value.assessment.text, basis: "suggestion", studentFactIds: [], competitionFactIds: [...value.assessment.factIds], conditions: [...value.assessment.conditions] };
      currentTexts.add(source.text);
      const [output] = selectCompactValuesV7({ values: [{ dimension: value.dimension, claim: source }] });
      expect(output.claim.text).toBe(COMPACT_VALUE_COPY_V7[source.text].text);
      expect(compactContentLengthV7(output.claim.text)).toBeLessThanOrEqual(60);
      expect({ ...output.claim, text: source.text }).toEqual(source);
      expect(output.claim.conditions).not.toBe(source.conditions);
      if (value.dimension === "taskRelevance") {
        expect(output.claim.text).not.toContain("该路径实际任务为");
        expect(output.claim.text).not.toContain(record.sections.task[0].text);
      }
      if (value.dimension === "learningFeedback") expect(output.claim.text).toContain("不承诺赛事个人反馈");
    }
    expect(currentTexts.size).toBe(135);
    const currentCopies = [...currentTexts].map(text => COMPACT_VALUE_COPY_V7[text]);
    const archivedCopies = Object.entries(COMPACT_VALUE_COPY_V7).filter(([text]) => !currentTexts.has(text));
    expect(archivedCopies).toHaveLength(6);
    for (const [text, copy] of archivedCopies) {
      expect(currentCopies).toContainEqual(copy);
      const claim = { ...makeClaim(text), studentFactIds: [], competitionFactIds: [...copy.sourceFactIds] };
      expect(selectCompactValuesV7({ values: [{ dimension: "portfolio", claim }] })[0].claim).toEqual({ ...claim, text: copy.text });
    }
  });

  it("never rewrites unknown, personally bound or differently sourced benefit claims", () => {
    const [sourceText, copy] = Object.entries(COMPACT_VALUE_COPY_V7)[0];
    const base: DecisionClaimV6 = { text: sourceText, basis: "suggestion", studentFactIds: [], competitionFactIds: [...copy.sourceFactIds], conditions: ["原适用条件。"] };
    for (const claim of [
      { ...base, basis: "unknown" as const },
      { ...base, basis: "official" as const },
      { ...base, studentFactIds: ["personal-claim"] },
      { ...base, competitionFactIds: ["new-evidence-scope"] },
      { ...base, text: `${sourceText}原文已有更新。` },
    ]) expect(selectCompactValuesV7({ values: [{ dimension: "taskRelevance", claim }] })[0].claim).toEqual(claim);
  });
});
