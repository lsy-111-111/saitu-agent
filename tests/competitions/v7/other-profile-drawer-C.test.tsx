import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DecisionClaim } from "@/components/competitions/recommend/DecisionReport";
import type { DecisionReportV6, StudentFactV6 } from "@/lib/competitions/v6/contracts";

const path = "artifacts/fast24-20261109/D/constraints-current-01/invocations/bf54ded713064a46cd4e11f63096b92aaf766dda925f77fbd8be064d36edb694.json";
const raw = JSON.parse(readFileSync(path, "utf8"));
const body = raw.observation.groupedRuns[0].body;
// Mechanical failed support review in this original. Use the actual ready
// CUMCM detail; the rejected original is never promoted into a delivered item.
const item = body.items.find((row: { seriesId: string }) => row.seriesId === "national-college-math-modeling").detail;
const report = { profile: body.context.profile, recommendations: [item] } as DecisionReportV6;
const fact = (id: string, patch: Partial<StudentFactV6> = {}): StudentFactV6 => ({ id, field: `open.${id}`, value: id, label: id, state: "affirmed", confirmed: true, evidenceLevel: "self_report", ...patch });

describe("C provided context remains visible without becoming a new claim citation", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("shows the actual room-temperature constraint in a separate drawer section without changing any original", () => {
    const before = JSON.stringify(report), claim = item.reasons[0];
    expect(claim.studentFactIds).not.toContain("a_ba76acd7aafe4c85b47480e6b19f98e1");
    const html = renderToStaticMarkup(<DecisionClaim claim={claim} item={item} report={report} showSourceLinks={false} />);
    expect(html).toContain("已提供的其他信息与限制");
    expect(html).toContain("未作为本条判断的引用依据");
    expect(html.split('data-testid="decision-other-profile-information"')[1]).toContain("不食用实验样品，只有常温条件");
    expect(html).toContain("赛事资料："); expect(html).toContain("依据来源：");
    expect(JSON.stringify(report)).toBe(before);
  });

  it("retains arbitrary open fields, budget values, negatives, conditional scope and another person's contribution", () => {
    const copy = structuredClone(report);
    copy.profile.facts.push(
      fact("budget", { field: "travel.maximumYuan", value: 20, label: "个人出行上限", originalText: "我个人最多自费20元" }),
      fact("cold", { field: "resources.refrigeration", state: "negated", originalText: "我现在不能冷藏样品" }),
      fact("condition", { field: "material.usePermission", state: "conditional", confirmed: false, originalText: "只有取得导师同意才能使用样品" }),
      fact("unknown", { field: "open.resource", state: "unknown", confirmed: false, originalText: "我还不知道能否借到设备" }),
      fact("teammate", { field: "other.contribution", originalText: "实验由队友完成，我只记录数据" }),
    );
    const html = renderToStaticMarkup(<DecisionClaim claim={{ ...item.reasons[0], conditions: [] }} item={item} report={copy} showSourceLinks={false} />);
    for (const text of ["我个人最多自费20元", "否定信息：我现在不能冷藏样品", "条件性信息：只有取得导师同意才能使用样品", "尚未确定：我还不知道能否借到设备", "实验由队友完成，我只记录数据"]) expect(html).toContain(text);
  });

  it("omits already cited, withdrawn, superseded and unadopted positive facts from the other-information section", () => {
    const copy = structuredClone(report), citedId = item.reasons[0].studentFactIds[0];
    copy.profile.facts.push(fact("withdrawn", { state: "retracted" }), fact("in-list"), fact("old"), fact("new", { supersedesFactIds: ["old"] }), fact("unadopted", { confirmed: false }));
    copy.profile.retractedFactIds.push("in-list");
    const html = renderToStaticMarkup(<DecisionClaim claim={item.reasons[0]} item={item} report={copy} showSourceLinks={false} />);
    const other = html.split('data-testid="decision-other-profile-information"')[1];
    for (const text of ["withdrawn", "in-list", "unadopted", ">old<", copy.profile.facts.find(row => row.id === citedId)!.label]) expect(other).not.toContain(text);
    expect(other).toContain("new");
  });

  it("uses readable labels and explicit values for canonical submissions without inventing historical quotes", () => {
    const copy = structuredClone(report);
    copy.profile.facts.push(fact("canonical", { field: "resources.lab", value: false, label: "具备实验室条件", originalText: "false", answerId: "structured-input.v7.example" }), fact("limit", { value: 30, label: "个人预算上限", originalText: "30", answerId: "structured-input.v7.number" }));
    const html = renderToStaticMarkup(<DecisionClaim claim={item.reasons[0]} item={item} report={copy} showSourceLinks={false} />);
    expect(html).toContain("已提交信息：具备实验室条件（已提交值：否）");
    expect(html).toContain("已提交信息：个人预算上限（已提交值：30）");
    expect(html).not.toContain("你的历史原话");
  });
});
