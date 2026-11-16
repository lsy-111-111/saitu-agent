import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { AI_EVIDENCE_EXPLANATION_CONSENT_VERSION } from "../../src/lib/ai/consent-disclosure";
import type { DecisionReportV6 } from "../../src/lib/competitions/v6/contracts";
import { recommendationRunSchema, type RecommendationRunV7 } from "../../src/lib/competitions/v7/contracts";
import { topFiveRunFixture } from "../fixtures/recommendation-run-v7";

// Browser plugin not available. Reuse an unmodified historical provider report
// for presentation only, with every API intercepted and zero paid calls.
const proof = JSON.parse(readFileSync("artifacts/fast24-20261109/C/reference-marker-display-fix/offline-display-proof.json", "utf8")) as { raw: { path: string; sha256: string } };
const original = readFileSync(proof.raw.path);
if (createHash("sha256").update(original).digest("hex") !== proof.raw.sha256) throw new Error("Historical report original changed");
const raw = JSON.parse(original.toString("utf8")) as { invocationId: string; runSnapshot: { items: RecommendationRunV7["items"]; report: DecisionReportV6 } };
const report = { ...raw.runSnapshot.report, trace: { ...raw.runSnapshot.report.trace, cachedInputTokens: null, inputTokens: null, outputTokens: null } };

function readyRun() {
  return recommendationRunSchema.parse(topFiveRunFixture({
    profileId: report.profile.profileId, profileRevision: report.profile.revision, profile: report.profile,
    catalogVersion: report.catalogVersion, status: "ready", report, resultVersion: 3,
    items: raw.runSnapshot.items.map(item => ({ ...item, detail: report.recommendations.find(detail => detail.itemId === item.itemId) })),
  }));
}

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 393, height: 851 }]) {
  test(`compact historical report and interactions: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const run = readyRun(), errors: string[] = [], blocked: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/api/**", async route => {
      if (new URL(route.request().url()).pathname === "/api/track") { await route.fulfill({ status: 204 }); return; }
      blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort("blockedbyclient");
    });
    await page.addInitScript(({ run, consentVersion }) => sessionStorage.setItem("saitu.recommendationRun.v7", JSON.stringify({
      storageVersion: 1, run, previousList: null,
      context: { depth: "quick", profile: {}, fixedQuestionTextAnswers: {}, decisionContext: {}, acceptedConsentVersion: consentVersion },
    })), { run, consentVersion: AI_EVIDENCE_EXPLANATION_CONSENT_VERSION });
    await page.goto("/competitions/recommend");
    await expect(page).toHaveURL(/\/competitions\/recommend$/);
    await expect(page).toHaveTitle(/竞赛/);
    const result = page.getByTestId("decision-report-v7"), cards = result.getByTestId("recommendation-run-item");
    await expect(cards).toHaveCount(5);
    await expect(result.locator("details[open]")).toHaveCount(0);
    await expect(result.getByRole("table")).toHaveCount(0);
    await expect(result.getByText("比较两到三项，看清怎么取舍", { exact: true })).toHaveCount(0);
    const first = cards.first();
    await result.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`compact-${viewport.name}-collapsed.png`), fullPage: false });
    await first.locator("summary").first().click();
    const detail = first.getByTestId("compact-decision-details");
    await expect(detail.getByRole("heading")).toHaveText(["具体做什么", "为什么适合你", "价值与收获"]);
    const values = detail.locator('[data-testid="compact-claim"][data-claim-field="value"]');
    expect(await values.count()).toBeLessThanOrEqual(2);
    await expect(first).not.toContainText("三个阶段的难度");
    await expect(first).not.toContainText("主要投入与机会成本");
    await expect(first).not.toContainText("查看依据与条件");
    for (const field of ["coreTask", "reason"] as const) {
      const claim = field === "coreTask" ? run.items[0].detail!.coreTask : run.items[0].detail!.reasons[0];
      const item = run.items[0].detail!;
      const expectedIds = [...new Set(item.evidenceFacts.filter(fact => claim.competitionFactIds.includes(fact.id)).flatMap(fact => fact.sourceIds))];
      for (const source of item.sources.filter(source => expectedIds.includes(source.id))) {
        await expect(detail.locator(`a[data-claim-field="${field}"][data-source-id="${source.id}"]`)).toHaveAttribute("href", source.url);
      }
    }
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`compact-${viewport.name}-expanded.png`), fullPage: false });
    await first.getByRole("checkbox").check();
    await result.getByRole("button", { name: "收藏所选 1 项", exact: true }).click();
    await expect(result.getByText("已收藏所选 1 项。", { exact: true })).toBeVisible();
    await first.getByRole("link", { name: /^追问乐乐：/ }).click();
    await expect(page.getByRole("textbox", { name: "想追问或更正什么？", exact: true })).toBeFocused();
    await result.getByTestId("compact-answer-edit").locator("summary").click();
    await expect(result.getByRole("button", { name: "修改后重新匹配", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "比较两项", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.locator("main")).not.toBeEmpty();
    await expect(page.locator("body")).not.toContainText(/Unhandled Runtime Error|Application error: a client-side exception|Build Error/);
    expect(errors).toEqual([]); expect(blocked).toEqual([]);
    await testInfo.attach("compact-replay-evidence", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      classification: "historical_actual_provider_report_offline_ui_replay", originalInvocationId: raw.invocationId,
      originalSha256: proof.raw.sha256, newModelCalls: 0, viewport, url: page.url(), title: await page.title(),
      sourceLinks: await detail.locator("a[data-source-id]").evaluateAll(elements => elements.map(element => ({
        claimField: element.getAttribute("data-claim-field"), sourceId: element.getAttribute("data-source-id"), url: element.getAttribute("href"),
      }))), pageAndConsoleErrors: errors,
    }, null, 2)) });
  });
}
