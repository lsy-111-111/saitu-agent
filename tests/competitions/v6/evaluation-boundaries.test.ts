import "./mock-publication-boundary";
import { describe, expect, it } from "vitest";
import { buildDecisionContext, buildRuleDecisionReport } from "@/lib/competitions/v6/engine";
import { getDecisionCatalog } from "@/lib/competitions/v6/catalog";
import { validateDecisionReport } from "@/lib/competitions/v6/validation";
import { seedBaseProfile } from "./evaluation-seed-fixtures";
import { syntheticRecord } from "./decision-fixtures";

const now = new Date("2026-11-05T12:00:00+08:00");

describe("v6 task and personal-cost boundaries", () => {
  it("does not turn a hardware task into software or entrepreneurship through generic skills", () => {
    const profile = seedBaseProfile();
    profile.majorFields = ["engineering"]; profile.skills = ["writing", "presentation", "research"];
    profile.taskFormats = ["hardware"]; profile.goals = ["portfolio"];
    profile.confirmedFields.push("majorFields", "skills", "taskFormats", "goals");
    const report = buildRuleDecisionReport(profile, { now });
    const byId = new Map(getDecisionCatalog().map(item => [item.recordId, item]));
    expect(report.recommendations.every(item => !["software-algorithms", "business-practice"].includes(byId.get(item.itemId)!.taskFamily))).toBe(true);
    if (!report.recommendations.length) expect(report.shortlistShortfallReason).toBeTruthy();
    expect(validateDecisionReport(report, buildDecisionContext(profile, { now })).ok).toBe(true);
  });

  it("does not recommend recitation for visual design merely because presentation is available", () => {
    const profile = seedBaseProfile(); profile.majorFields = ["design"]; profile.skills = ["design", "presentation"];
    profile.interests = ["design"]; profile.taskFormats = ["design"];
    profile.confirmedFields.push("majorFields", "skills", "interests", "taskFormats");
    const report = buildRuleDecisionReport(profile, { now });
    expect(report.recommendations.some(item => item.seriesId === "chinese-classics")).toBe(false);
    const byId = new Map(getDecisionCatalog().map(item => [item.recordId, item]));
    expect(report.recommendations.every(item => byId.get(item.itemId)!.taskFamily !== "language-communication")).toBe(true);
  });

  it("keeps presentation-only contribution separate from programming capability", () => {
    const profile = seedBaseProfile(); profile.skills = ["presentation"]; profile.interests = ["data"]; profile.taskFormats = ["software"];
    profile.confirmedFields.push("skills", "interests", "taskFormats");
    profile.decisionContext = { experienceStatus: "provided", experiences: [{ id: "e1", task: "团队项目里只负责PPT展示，程序全部由队友完成", contribution: "assisted", completion: "delivered", challenge: "", confirmed: true }] };
    const report = buildRuleDecisionReport(profile, { now });
    expect(report.profile.facts.some(item => item.field === "skills" && item.value === "programming")).toBe(false);
    expect(report.profile.facts.some(item => item.field.endsWith(".contribution") && item.value === "independent")).toBe(false);
    for (const item of report.recommendations) {
      expect(item.currentRole.basis).toBe("suggestion");
      expect(JSON.stringify(item.reasons)).not.toMatch(/你(?:已|已经)(?:会|能|能够|具备)(?:独立)?(?:开发|编程)/);
    }
    expect(validateDecisionReport(report, buildDecisionContext(profile, { now })).ok).toBe(true);
  });

  it("excludes a proven personal minimum above the confirmed personal budget", () => {
    // A synthetic, source-bound fee fixture exercises the actual production constraint.
    // Current catalog fees may be paid by a school; those are not fabricated personal minima.
    const record = syntheticRecord(901);
    record.facts.push({ id: "fixture.personal-fee", field: "investment", text: "合成约束：本人必须自付至少300元且不能报销。", kind: "official_fact", status: "verified_current",
      sourceIds: [record.sources[0].id], scope: record.scope, checkedAt: "2026-11-05", supersedes: [], conflictsWith: [] });
    record.cost = { minimumPersonalCny: 300, maximumPersonalCny: null, factIds: ["fixture.personal-fee"], scope: record.scope, note: "Synthetic personal cost boundary only" };
    const profile = seedBaseProfile(); profile.decisionContext = { budget: { range: "under100", maximumYuan: 100, scope: "personal" } };
    const context = buildDecisionContext(profile, { now, records: [record] });
    expect(context.candidates).toHaveLength(0);
    expect(context.excluded.get(record.recordId)).toContain("300");
    expect(context.excluded.get(record.recordId)).toContain("100");
  });

  it("does not treat historical, unknown, or possibly reimbursed fees as a proven personal minimum", () => {
    const record = syntheticRecord(902);
    record.cost = { minimumPersonalCny: null, maximumPersonalCny: null, factIds: [record.facts[0].id], scope: record.scope, note: "承担方和总额未知" };
    const profile = seedBaseProfile(); profile.decisionContext = { budget: { range: "zero", maximumYuan: 0, scope: "personal" } };
    const context = buildDecisionContext(profile, { now, records: [record] });
    expect(context.candidates).toHaveLength(1);
    expect(context.candidates[0].conditions.some(item => /费用|支出/.test(item))).toBe(true);
    expect(context.excluded.has(record.recordId)).toBe(false);
  });
});
