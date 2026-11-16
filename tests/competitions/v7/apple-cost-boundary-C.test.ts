import { describe, expect, it } from "vitest";
import { getMatchingCatalogRecords, inspectMatchingRecord } from "@/lib/competitions/v7/catalog";
import { buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import { assembleDecisionReport, claim } from "@/lib/competitions/v6/engine";
import { student } from "../v6/decision-fixtures";

describe("Apple editorial cost boundary", () => {
  it("keeps all 45 core-admitted records and removes the unverified free-registration premise", () => {
    const records = getMatchingCatalogRecords();
    expect(records).toHaveLength(45);
    const apple = records.find(record => record.seriesId === "apple-swift-student-challenge")!;
    expect(inspectMatchingRecord(apple).eligibleForMatching).toBe(true);
    const investment = apple.sections.investment[0];
    expect(investment.kind).toBe("editorial_inference");
    expect(investment.text).not.toContain("免费");
    expect(investment.text).toContain("开发者注册相关支出、设备成本与个人总费用仍需逐项确认");
    expect(investment.factIds).toEqual([]);
  });

  it("assembles the real Apple record as a preparation suggestion without inventing a fee source", () => {
    const context = buildDecisionContextV7(student(), { records: getMatchingCatalogRecords(), now: new Date("2026-11-10T00:00:00.000Z") });
    const apple = context.candidates.find(candidate => candidate.record.seriesId === "apple-swift-student-challenge")!.record;
    const report = assembleDecisionReport(context, {
      profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
      recommendations: [{ itemId: apple.recordId, reasons: [claim("先尝试个人离线交互作品。", "suggestion")] }],
      shortfallReason: "定向离线组装，仅检查Apple费用说明。",
    }, {}, { used: false, reason: null }, { admissionPolicy: "matching", profilePolicy: "self_report" });
    const cost = report.recommendations[0].opportunityCost;
    expect(cost.basis).toBe("suggestion");
    expect(cost.text).not.toContain("免费");
    expect(cost.text).toContain(apple.sections.investment[0].text);
    expect(cost.text).toContain("开发者注册相关支出、设备成本与个人总费用仍需逐项确认");
    expect(cost.competitionFactIds).toEqual([]);
    expect(cost.conditions).toContain("投入估计是准备建议，实际成本需逐项核对。");
  });
});
