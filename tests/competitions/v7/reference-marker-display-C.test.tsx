import * as React from "react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DecisionClaim, DecisionReport, decisionDisplayText } from "@/components/competitions/recommend/DecisionReport";
import { DecisionRunReport } from "@/components/competitions/recommend/DecisionRunReport";
import type { DecisionReportV6 } from "@/lib/competitions/v6/contracts";
import { recommendationRunSchema, type RecommendationRunV7 } from "@/lib/competitions/v7/contracts";
import { topFiveRunFixture } from "../../fixtures/recommendation-run-v7";

const rawPath = "artifacts/fast24-20261109/B/public-five-05-r2/raw/v7-public-mobile-design-receipt.json";
const rawSha256 = "721ec1978c39edf83a0c1c7e2090411148b0d4d702eee8a68b1fcb5886f0cece";
const rawBytes = readFileSync(rawPath);
const raw = JSON.parse(rawBytes.toString("utf8")) as { runSnapshot: { items: RecommendationRunV7["items"]; report: DecisionReportV6 } };
const report = raw.runSnapshot.report;
const expectedReasons = [
  "自报设计技能可用于围绕本人创意实践组织五幅静态样稿；但当前暂无可描述经历，需先选定一个真实练习作为素材，不能假定已有作品。",
  "自报设计技能可直接用于本题的SDG概念海报表达，且指南声明参赛免费、不含自主制作等支出，其他成本仍需核实。",
  "自报设计技能可用于把香氛使用需求转成产品、服务及体验的概念呈现，并按命题要求准备3页方案和团队视频；团队与正式参赛资格需另行核实。",
  "自报高职阶段与2024黑龙江赛区列出的高职高专参赛范围方向一致，可用完整产品展板与设计说明练习产品结构和使用系统；全日制、集体报名等条件仍需核实。",
  "自报设计技能可尝试用于本草花创谷农文旅项目的视觉宣传与方案表达；该赛要求2–5人团队并由1–2名导师指导，组队与资格需另行核实。",
];

describe("C actual five05 design machine-reference display boundary", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("removes only reference annotations from all five actual reasons without changing the report", () => {
    expect(createHash("sha256").update(rawBytes).digest("hex")).toBe(rawSha256);
    const before = JSON.stringify(report);
    report.recommendations.forEach((item, index) => {
      const claim = item.reasons[0];
      expect(claim.text).toMatch(/@[FP]\d+/);
      expect(decisionDisplayText(claim.text)).toBe(expectedReasons[index]);
      const html = renderToStaticMarkup(<DecisionClaim claim={claim} report={report} item={item} showSourceLinks={false} />);
      expect(html).toContain(expectedReasons[index]);
      expect(html).not.toMatch(/@[FP]\d+|（\s*）|\(\s*\)/);
      for (const id of claim.competitionFactIds) {
        const fact = item.evidenceFacts.find(value => value.id === id)!;
        expect(html).toContain(renderToStaticMarkup(<>{fact.text}</>));
        for (const sourceId of fact.sourceIds) {
          const source = item.sources.find(value => value.id === sourceId)!;
          expect(html).toContain(renderToStaticMarkup(<>{source.title}</>));
          expect(html).toContain(renderToStaticMarkup(<>{source.scope}</>));
        }
      }
      for (const id of claim.studentFactIds) expect(html).toContain(renderToStaticMarkup(<>{report.profile.facts.find(fact => fact.id === id)!.label}</>));
    });
    expect(JSON.stringify(report)).toBe(before);
    expect(createHash("sha256").update(readFileSync(rawPath)).digest("hex")).toBe(rawSha256);
  });

  it.each([
    ["依据（@F126、@F121）与自述(@P2)。", "依据与自述。"],
    ["依据（@P7, @F296 / @F300）仍需确认。", "依据仍需确认。"],
    ["@F126支持该要求；@P2暂未提供经历。", "支持该要求；暂未提供经历。"],
    ["2025年（历史），每周3–5小时，总额500元；邮箱student@F126.example。", "2025年（历史），每周3–5小时，总额500元；邮箱student@F126.example。"],
    ["保留普通空括号（）、（制作另计）、@Food、@P2code及@C3。", "保留普通空括号（）、（制作另计）、@Food、@P2code及@C3。"],
  ])("keeps the narrow display boundary for %s", (text, expected) => {
    expect(decisionDisplayText(text)).toBe(expected);
  });

  it("cleans legacy comparisons and v7 report claims while retaining structured claim IDs", () => {
    // Exported accounting totals are redacted strings, so the presentation
    // fixture uses unknown totals. Actual claim text and evidence stay intact.
    const copy = { ...structuredClone(report), trace: { ...report.trace, cachedInputTokens: null, inputTokens: null, outputTokens: null } };
    const selected = copy.recommendations.slice(0, 2);
    const claim = { ...selected[0].reasons[0], text: "比较内容（@F126、@P2）仍保留事实。" };
    copy.summary.focusItemIds = selected.map(item => item.itemId);
    copy.comparisons = [{ itemIds: selected.map(item => item.itemId), dimensions: [{ label: "实际任务", values: selected.map(item => ({ itemId: item.itemId, claim })) }], tradeoff: claim }];
    const before = JSON.stringify(copy);
    const run = recommendationRunSchema.parse(topFiveRunFixture({ profileId: copy.profile.profileId, profileRevision: copy.profile.revision, profile: copy.profile, catalogVersion: copy.catalogVersion, status: "ready", report: copy, resultVersion: 3, items: raw.runSnapshot.items.map(item => ({ ...item, detail: copy.recommendations.find(detail => detail.itemId === item.itemId) })) }));
    const legacyHtml = renderToStaticMarkup(<DecisionReport report={copy} turns={[]} onEdit={vi.fn()} />);
    const runHtml = renderToStaticMarkup(<DecisionRunReport run={run} displayRun={run} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    expect(legacyHtml).toContain("比较内容仍保留事实。");
    expect(runHtml).toContain(expectedReasons[0]);
    for (const html of [legacyHtml, runHtml]) expect(html).not.toMatch(/@[FP]\d+/);
    expect(JSON.stringify(copy)).toBe(before);
  });
});
