import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { buildDecisionContext, buildRuleDecisionReport } from "@/lib/competitions/v6/engine";
import { describeDecisionChanges, type DecisionReportV6 } from "@/lib/competitions/v6/contracts";
import { validateDecisionReport } from "@/lib/competitions/v6/validation";
import type { CompetitionRecommendationProfileV5 } from "@/types/competition-recommendation";
import { seedBaseProfile } from "./evaluation-seed-fixtures";

const now = new Date("2026-11-05T12:00:00+08:00");
type Scenario = { id: string; title: string; studentStatement: string; profile: CompetitionRecommendationProfileV5; after?: CompetitionRecommendationProfileV5 };
function confirmed(input: Partial<CompetitionRecommendationProfileV5>): CompetitionRecommendationProfileV5 {
  return { ...seedBaseProfile(), confirmedFields: ["stage", "majorFields", "skills", "interests", "goals", "taskFormats", "weeklyCommitment"], ...input };
}
const correctionBefore = confirmed({ majorFields: ["computer-science"], skills: ["programming", "data-analysis", "presentation"],
  interests: ["data"], goals: ["portfolio", "employment"], taskFormats: ["software", "modeling"], weeklyCommitment: "5-10",
  decisionContext: { goalResolution: "confirmed", primaryGoal: "portfolio", experienceStatus: "provided", experiences: [
    { id: "data", task: "独立用Python清洗课程数据并画图", contribution: "independent", completion: "delivered", challenge: "记录了缺失值处理方式", confirmed: true },
    { id: "web", task: "协助队友完成一个展示网页", contribution: "assisted", completion: "delivered", challenge: "整理页面内容", confirmed: true }
  ] }
});
const correctionAfter: CompetitionRecommendationProfileV5 = { ...structuredClone(correctionBefore), skills: ["writing", "presentation"],
  decisionContext: { ...correctionBefore.decisionContext, experiences: [
    { id: "data", task: "更正：清洗和画图代码由队友完成，我整理了数据字段与需求说明", contribution: "assisted", completion: "delivered", challenge: "向队友解释表格字段", confirmed: true },
    { id: "web", task: "更正：网页程序也是队友完成，我只协助内容整理和PPT演示", contribution: "assisted", completion: "delivered", challenge: "解释演示流程", confirmed: true }
  ] }
};
const scenarios: Scenario[] = [
  { id: "novice", title: "零竞赛经历与零作品的新手", studentStatement: "我没有参赛或作品经历，愿意试试整理信息，暂时不知道擅长什么。",
    profile: confirmed({ skills: [], interests: [], goals: [], taskFormats: [], weeklyCommitment: "under-5",
      decisionContext: { goalIntent: "explore", experienceStatus: "none", noviceTaskPreferences: [{ task: "organize-information", preference: "try" }] } }) },
  { id: "cross-major", title: "跨专业，用实际任务而非专业名称选择", studentStatement: "我是历史学方向学生，独立做过地方史展览海报，想继续做视觉作品。",
    profile: confirmed({ majorFields: ["humanities"], skills: ["design", "writing"], interests: ["design", "culture-language"], goals: ["portfolio"], taskFormats: ["design"], weeklyCommitment: "5-10",
      decisionContext: { goalIntent: "portfolio", goalResolution: "confirmed", experienceStatus: "provided", experiences: [{ id: "poster", task: "为地方史展览独立设计海报并修改信息层级", contribution: "independent", completion: "feedback", challenge: "根据观众反馈调整标题与文字", confirmed: true }] } }) },
  { id: "goal-conflict", title: "作品与奖项目标冲突，先讲取舍再确认", studentStatement: "我想有可展示作品，也想获奖；不确定该优先哪一个。",
    profile: confirmed({ majorFields: ["computer-science"], skills: ["programming"], interests: ["data"], goals: ["portfolio", "award"], taskFormats: ["software", "algorithm"], weeklyCommitment: "5-10",
      decisionContext: { goalResolution: "undecided", experienceStatus: "unknown" } }) },
  { id: "resource-limits", title: "资源不足且预算明确", studentStatement: "对化学实验感兴趣，但没有实验室、设备和导师，个人不能花钱，每周不到5小时。",
    profile: confirmed({ majorFields: ["chemistry-materials"], skills: [], interests: ["chemistry-materials"], goals: ["project"], taskFormats: ["research"], weeklyCommitment: "under-5",
      availableResources: [], decisionContext: { experienceStatus: "none", unavailableResources: ["lab", "equipment", "mentor"], budget: { range: "zero", maximumYuan: 0, scope: "personal" }, preparationHorizon: "one-month" } }) },
  { id: "starting-point-growth", title: "区分当前起点与未来成长", studentStatement: "我刚开始学习数据处理，希望长期形成作品，先做一个小任务来判断自己是否喜欢。",
    profile: confirmed({ stage: "undergraduate-1", majorFields: ["mathematics"], skills: [], interests: ["data"], goals: ["project"], taskFormats: ["modeling"], weeklyCommitment: "5-10",
      decisionContext: { goalIntent: "skill", goalResolution: "confirmed", experienceStatus: "none", preparationHorizon: "long-term", noviceTaskPreferences: [{ task: "organize-information", preference: "try" }] } }) },
  { id: "correction", title: "更正本人贡献后真实重算", studentStatement: "起初称独立数据清洗、协助网页；随后更正代码均由队友完成，本人只做需求、内容和演示。", profile: correctionBefore, after: correctionAfter }
];
const artifacts: { scenario: Scenario; report: DecisionReportV6; validation: ReturnType<typeof validateDecisionReport>; afterReport?: DecisionReportV6; afterValidation?: ReturnType<typeof validateDecisionReport>; changes?: string[] }[] = [];
function references(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => key === "studentFactIds" && Array.isArray(item) ? item : references(item));
}

describe("six complete synthetic student decision scenarios on the actual catalog", () => {
  for (const scenario of scenarios) {
    it(scenario.title, () => {
      const options = { now, profileId: `synthetic-scenario-${scenario.id}` };
      const report = buildRuleDecisionReport(scenario.profile, options);
      const validation = validateDecisionReport(report, buildDecisionContext(scenario.profile, options));
      const artifact: typeof artifacts[number] = { scenario, report, validation };
      expect(validation.issues).toEqual([]);
      if (report.recommendations.length < 5) expect(report.shortlistShortfallReason).toBeTruthy();
      if (scenario.id === "novice") {
        expect(report.profile.facts.some(item => item.field === "skills" || item.evidenceLevel === "concrete_experience")).toBe(false);
        expect(report.recommendations.every(item => item.preparation !== "ready")).toBe(true);
      }
      if (scenario.id === "cross-major") expect(report.profile.facts.some(item => item.field === "majorFields" && item.value === "humanities")).toBe(true);
      if (scenario.id === "goal-conflict") {
        expect(report.profile.primaryGoal).toBeNull(); expect(report.profile.tradeoffStatus).toBe("undecided");
        expect(report.pendingQuestions.length).toBeGreaterThan(0);
        expect(report.goalPaths).toHaveLength(2);
        expect(new Set(report.goalPaths.map(path => path.goal)).size).toBe(2);
      }
      if (scenario.id === "resource-limits") expect(report.profile.facts.some(item => item.field === "unavailableResource" && item.value === "lab")).toBe(true);
      if (scenario.id === "starting-point-growth") {
        for (const item of report.recommendations) {
          expect(new Set(item.difficulty.map(d => d.stage)).size).toBe(3);
          expect(item.nextStep.text.length).toBeGreaterThan(0);
          expect(item.preparation).not.toBe("ready");
        }
      }
      if (scenario.after) {
        const afterReport = buildRuleDecisionReport(scenario.after, options);
        const afterValidation = validateDecisionReport(afterReport, buildDecisionContext(scenario.after, options));
        expect(afterValidation.issues).toEqual([]);
        expect(afterReport.profile.profileId).toBe(report.profile.profileId);
        expect(afterReport.profile.revision).not.toBe(report.profile.revision);
        const current = new Set(afterReport.profile.facts.map(item => item.id));
        const removed = report.profile.facts.filter(item => !current.has(item.id)).map(item => item.id);
        expect(removed.length).toBeGreaterThan(0);
        expect(references(afterReport).filter(id => removed.includes(id))).toEqual([]);
        expect(afterReport.profile.facts.some(item => item.field === "skills" && ["programming", "data-analysis"].includes(String(item.value)))).toBe(false);
        expect(afterReport.profile.facts.some(item => item.field.endsWith(".contribution") && item.value === "independent")).toBe(false);
        artifact.afterReport = afterReport; artifact.afterValidation = afterValidation;
        artifact.changes = describeDecisionChanges(report, afterReport);
      }
      artifacts.push(artifact);
    });
  }
});

afterAll(() => {
  if (process.env.V6_WRITE_EVALUATION_ARTIFACTS !== "1") return;
  const generatedAt = new Date().toISOString();
  const sourceSha256 = Object.fromEntries(["engine", "profile", "catalog", "contracts", "validation"].map(name => {
    const file = `src/lib/competitions/v6/${name}.ts`;
    return [file, createHash("sha256").update(readFileSync(file)).digest("hex")];
  }));
  for (const artifact of artifacts) writeFileSync(`artifacts/v6/evaluation/scenario-${artifact.scenario.id}.json`, JSON.stringify({
    provenance: { student: "synthetic_confirmed_choices", catalog: "actual_current_repository", generation: "actual_rule_engine", liveModel: false,
      generatedAt, asOf: now.toISOString(), sourceSha256,
      independentSuitabilityReview: "pending", humanStudentStudy: "not_performed", command: "V6_WRITE_EVALUATION_ARTIFACTS=1 node node_modules/vitest/vitest.mjs run tests/competitions/v6/evaluation-scenarios.test.ts" }, ...artifact
  }, null, 2) + "\n");
  writeFileSync("artifacts/v6/evaluation/six-scenario-manifest.json", JSON.stringify({ generatedAt, asOf: now.toISOString(), sourceSha256, scenarioCount: artifacts.length,
    actualReports: artifacts.reduce((count, item) => count + (item.afterReport ? 2 : 1), 0),
    scenarios: artifacts.map(item => ({ id: item.scenario.id, title: item.scenario.title, file: `scenario-${item.scenario.id}.json`,
      recommendationCount: item.report.recommendations.length, afterRecommendationCount: item.afterReport?.recommendations.length ?? null,
      reportValid: item.validation.ok, afterReportValid: item.afterValidation?.ok ?? null, catalogVersion: item.report.catalogVersion })),
    productQualityProven: false, independentReview: "pending", realStudentStudy: "pending"
  }, null, 2) + "\n");
});
