import * as React from "react";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DecisionClaim } from "@/components/competitions/recommend/DecisionReport";
import { assembleDecisionReport, type DecisionContextV6 } from "@/lib/competitions/v6/engine";
import { matchPlanSchema, type DecisionReportV6, type MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import type { DecisionCompetitionRecord } from "@/lib/competitions/v6/catalog-types";

const originalPath = path.resolve("artifacts/fast24-20261109/B/single-02/raw/receipts.json");
const originalSha256 = "62db590c803ad09472db99625a4563c9442cbcf153aff75898145dcd49d4b9ff";
const factId = "if-student-award:v2:participation";
const recordId = "if-student-award:2025-entry-guide:sdg-design:design-students-graduates:global-2025:v3";
type FrozenContext = Omit<DecisionContextV6, "now" | "excluded"> & { now: string; excluded: [string, string][] };
type Body = { context: FrozenContext; plan: MatchPlanV6; report: DecisionReportV6; detailGroups: { groups: { prepared: { explanation: Pick<MatchPlanV6, "recommendations" | "comparison"> } }[] } };

function actualFixture() {
  const bytes = readFileSync(originalPath);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(originalSha256);
  const body = (JSON.parse(bytes.toString("utf8")) as { runSnapshots: { body: Body }[] }).runSnapshots[0].body;
  const context: DecisionContextV6 = { ...body.context, now: new Date(body.context.now), excluded: new Map(body.context.excluded) };
  const explanations = body.detailGroups.groups.flatMap(group => group.prepared.explanation.recommendations);
  const comparison = body.detailGroups.groups[0].prepared.explanation.comparison;
  const plan = matchPlanSchema.parse({ ...body.plan, recommendations: body.plan.recommendations.map(item => {
    const matches = explanations.filter(explained => explained.itemId === item.itemId);
    expect(matches).toHaveLength(1);
    return matches[0];
  }), ...(comparison ? { comparison } : {}) });
  return { context, plan, original: body.report };
}
function assemble(context: DecisionContextV6, plan: MatchPlanV6, original: DecisionReportV6) {
  return assembleDecisionReport(context, plan, original.trace, original.fallback, { admissionPolicy: "matching", profilePolicy: "self_report" });
}
function changeIfRecord(context: DecisionContextV6, change: (record: DecisionCompetitionRecord) => void) {
  const records = [context.records.find(record => record.recordId === recordId)!, context.candidates.find(candidate => candidate.record.recordId === recordId)!.record];
  records.forEach(change);
}

describe("C actual single-02 iF historical participation fee citation", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("reassembles the actual frozen context and explanation plan, changing only the missing fee anchor", () => {
    const { context, plan, original } = actualFixture(), before = structuredClone(context);
    const report = assemble(context, plan, original);
    const expected = structuredClone(original.recommendations);
    const oldItem = expected.find(item => item.itemId === recordId)!;
    expect(oldItem.opportunityCost.competitionFactIds).toEqual([]);
    oldItem.opportunityCost.competitionFactIds = [factId];
    expect(report.recommendations).toEqual(expected);
    expect(context).toEqual(before);
    const item = report.recommendations.find(item => item.itemId === recordId)!;
    expect(item.opportunityCost.basis).toBe("suggestion");
    expect(item.opportunityCost.text).toContain("2025参赛费明确为零，制作测试预算另计");
    expect(item.opportunityCost.text).toContain("编辑建议四周每周3—5小时");
    expect(item.registration.status).toBe("historical");
    expect(item.sources.find(source => source.id === "b-if-guide")?.scope).toBe("2025全球学生奖参赛与展示规范");
    if (process.env.FAST24_EXPORT_CITATION_FIX === "1") {
      const dir = path.resolve("artifacts/fast24-20261109/C/fee-citation-fix"); mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "offline-reassembled-report.json"), JSON.stringify(report, null, 2) + "\n");
      writeFileSync(path.join(dir, "before-claim.json"), JSON.stringify(original.recommendations.find(row => row.itemId === recordId)!.opportunityCost, null, 2) + "\n");
      writeFileSync(path.join(dir, "after-claim.json"), JSON.stringify(item.opportunityCost, null, 2) + "\n");
      writeFileSync(path.join(dir, "offline-verification.json"), JSON.stringify({ evidenceClass: "actual_output_offline_reassembly", actualModelCalls: 0, originalPath, originalSha256,
        sameFrozenContext: true, sameActualRankAndPreparedExplanationPlan: true, catalogOriginalsChanged: false, originalReceiptsChanged: false,
        onlyRecommendationDifference: "/recommendations/1/opportunityCost/competitionFactIds", addedFactIds: [factId], sourceId: "b-if-guide", scope: "2025全球学生奖参赛与展示规范",
        boundaries: ["historical 2025 entry fee only", "editorial weekly time advice remains suggestion", "production and testing costs remain separate"],
      }, null, 2) + "\n");
    }
  });

  it("renders the actual fee drawer with guide title and 2025 scope while retaining official-entry-only links", () => {
    const { context, plan, original } = actualFixture(), report = assemble(context, plan, original);
    const item = report.recommendations.find(item => item.itemId === recordId)!;
    const html = renderToStaticMarkup(<DecisionClaim claim={item.opportunityCost} item={item} report={report} showSourceLinks={false} />);
    expect(html).toContain("依据来源：");
    expect(html).toContain("iF DESIGN STUDENT AWARD 2025 Entry Guide（西语）");
    expect(html).toContain("2025全球学生奖参赛与展示规范");
    expect(html).toContain("指南声明参赛免费，不包括自主制作和其他支出");
    expect(html).toContain("核查于 2026-11-05");
    expect(html).not.toContain("href=");
    if (process.env.FAST24_EXPORT_CITATION_FIX === "1") writeFileSync(path.resolve("artifacts/fast24-20261109/C/fee-citation-fix/current-ui-drawer.html"), html);
  });

  it.each(["investment-text", "fact-text", "fact-status", "source-scope", "source-access", "participation-section"])("does not attach the exceptional anchor after %s changes", change => {
    const { context, plan, original } = actualFixture();
    changeIfRecord(context, record => {
      const fact = record.facts.find(value => value.id === factId)!;
      if (change === "investment-text") record.sections.investment[0].text = "编辑建议四周每周3—5小时；2026参赛费明确为零，制作测试预算另计。";
      if (change === "fact-text") fact.text = "是否收费尚不确定。";
      if (change === "fact-status") fact.status = "pending_review";
      if (change === "source-scope") record.sources.find(source => source.id === "b-if-guide")!.scope = "2026届尚未核实";
      if (change === "source-access") record.sources.find(source => source.id === "b-if-guide")!.accessStatus = "metadata_only";
      if (change === "participation-section") record.sections.participation[0].factIds = [];
    });
    const item = assemble(context, plan, original).recommendations.find(row => row.itemId === recordId)!;
    expect(item.opportunityCost.competitionFactIds).toEqual([]);
  });

  it("does not assign iF fee evidence to a different record that repeats the same investment text", () => {
    const { context, plan, original } = actualFixture();
    const ifRecord = context.candidates.find(row => row.record.recordId === recordId)!.record;
    const foreign = context.candidates.find(row => row.record.seriesId === "loreal-brandstorm")!.record;
    foreign.sections.investment[0] = { ...structuredClone(ifRecord.sections.investment[0]), factIds: [] };
    const item = assemble(context, plan, original).recommendations.find(row => row.itemId === foreign.recordId)!;
    expect(item.opportunityCost.competitionFactIds).toEqual([]);
  });
});
