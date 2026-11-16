import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { AI_EVIDENCE_EXPLANATION_CONSENT_VERSION } from "../../src/lib/ai/consent-disclosure";
import type { DecisionReportV6 } from "../../src/lib/competitions/v6/contracts";
import { recommendationRunSchema, type RecommendationRunV7 } from "../../src/lib/competitions/v7/contracts";
import { topFiveRunFixture } from "../fixtures/recommendation-run-v7";

// The output is actual single-02 data reassembled offline. The cache clock and
// opaque token are only a presentation fixture; every API route is blocked.
const artifactRoot = "artifacts/fast24-20261109/C/fee-citation-fix";
const report = JSON.parse(readFileSync(`${artifactRoot}/offline-reassembled-report.json`, "utf8")) as DecisionReportV6;
const receipt = JSON.parse(readFileSync("artifacts/fast24-20261109/B/single-02/raw/receipts.json", "utf8")) as { runSnapshots: { runId: string; body: { items: RecommendationRunV7["items"] } }[] };
const snapshot = receipt.runSnapshots[0];
const run = recommendationRunSchema.parse(topFiveRunFixture({ profileId: report.profile.profileId, profileRevision: report.profile.revision, profile: report.profile,
  catalogVersion: report.catalogVersion, status: "ready", report, resultVersion: 3,
  items: snapshot.body.items.map(item => ({ ...item, detail: report.recommendations.find(detail => detail.itemId === item.itemId) })),
}));

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 393, height: 851 }]) {
  test(`actual iF 2025 fee source drawer: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [], calls: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/api/**", async route => { calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`); await route.abort("blockedbyclient"); });
    await page.addInitScript(({ run, consentVersion }) => {
      sessionStorage.setItem("saitu.recommendationRun.v7", JSON.stringify({ storageVersion: 1, run, previousList: null,
        context: { depth: "quick", profile: {}, fixedQuestionTextAnswers: {}, decisionContext: {}, acceptedConsentVersion: consentVersion } }));
    }, { run, consentVersion: AI_EVIDENCE_EXPLANATION_CONSENT_VERSION });
    await page.goto("/competitions/recommend");
    await expect(page).toHaveTitle(/竞赛/);
    const card = page.getByTestId("recommendation-run-item").filter({ hasText: "iF DESIGN STUDENT AWARD" });
    await card.locator("summary").first().click();
    const cost = card.locator("section").filter({ has: page.getByRole("heading", { name: "主要投入与机会成本", exact: true }) });
    await expect(cost).toContainText("2025参赛费明确为零，制作测试预算另计");
    await cost.getByText("准备建议 · 查看依据与条件", { exact: true }).click();
    await expect(cost).toContainText("赛事资料：英文在线提交；指南声明参赛免费，不包括自主制作和其他支出");
    await expect(cost).toContainText("依据来源：iF DESIGN STUDENT AWARD 2025 Entry Guide（西语）");
    await expect(cost).toContainText("2025全球学生奖参赛与展示规范");
    await expect(cost).toContainText("核查于 2026-11-05");
    await expect(card).toContainText("2025届官方参赛指南");
    await expect(card.getByRole("link")).toHaveCount(1);
    await expect(card.getByRole("link", { name: "查看官网：iF DESIGN STUDENT AWARD", exact: true })).toHaveAttribute("href", "https://ifdesign.com/en/if-design-student-award");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.locator("body")).not.toContainText(/Unhandled Runtime Error|Application error: a client-side exception|Build Error/);
    await cost.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`fee-source-${viewport.name}.png`), fullPage: false });
    expect(calls).toEqual([]); expect(errors).toEqual([]);
    await testInfo.attach("offline-ui-observation", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      evidenceClass: "actual_output_offline_ui_reassembly", originalRunId: snapshot.runId, actualModelCalls: 0,
      originalReceiptsChanged: false, catalogOriginalsChanged: false, url: page.url(), viewport,
      renderedFeeSection: await cost.innerText(), pageAndConsoleErrors: errors, apiCalls: calls,
    }, null, 2)) });
  });
}
