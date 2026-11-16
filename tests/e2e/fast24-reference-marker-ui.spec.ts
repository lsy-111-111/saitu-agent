import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { AI_EVIDENCE_EXPLANATION_CONSENT_VERSION } from "../../src/lib/ai/consent-disclosure";
import type { DecisionReportV6 } from "../../src/lib/competitions/v6/contracts";
import { recommendationRunSchema, type RecommendationRunV7 } from "../../src/lib/competitions/v7/contracts";
import { topFiveRunFixture } from "../fixtures/recommendation-run-v7";

// Browser plugin unavailable. Replay unmodified actual claim/evidence content;
// only cache time/token and redacted accounting totals are presentation fixtures.
// Every API route is blocked and this test never requests another model output.
const artifactRoot = "artifacts/fast24-20261109/C/reference-marker-display-fix";
const proof = JSON.parse(readFileSync(`${artifactRoot}/offline-display-proof.json`, "utf8")) as {
  raw: { path: string; sha256: string }; rows: { itemId: string; name: string; displayedText: string }[];
};
const rawBytes = readFileSync(proof.raw.path);
if (createHash("sha256").update(rawBytes).digest("hex") !== proof.raw.sha256) throw new Error("Actual raw output changed");
const raw = JSON.parse(rawBytes.toString("utf8")) as { invocationId: string; runSnapshot: { items: RecommendationRunV7["items"]; report: DecisionReportV6 } };
const report = { ...raw.runSnapshot.report, trace: { ...raw.runSnapshot.report.trace, cachedInputTokens: null, inputTokens: null, outputTokens: null } };
const run = recommendationRunSchema.parse(topFiveRunFixture({ profileId: report.profile.profileId, profileRevision: report.profile.revision, profile: report.profile,
  catalogVersion: report.catalogVersion, status: "ready", report, resultVersion: 3,
  items: raw.runSnapshot.items.map(item => ({ ...item, detail: report.recommendations.find(detail => detail.itemId === item.itemId) })),
}));

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 393, height: 851 }]) {
  test(`actual five05 design reasons and compact citations: ${viewport.name}`, async ({ page }, testInfo) => {
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
    await expect(page.getByTestId("recommendation-run-item")).toHaveCount(5);
    const observations = [];
    for (const row of proof.rows) {
      const item = report.recommendations.find(value => value.itemId === row.itemId)!;
      const card = page.getByTestId("recommendation-run-item").filter({ has: page.getByRole("heading", { name: row.name, exact: true }) });
      await card.locator("summary").first().click();
      const reasons = card.locator("section").filter({ has: page.getByRole("heading", { name: "为什么适合你", exact: true }) });
      await expect(reasons.locator("p").first()).toContainText(row.displayedText);
      await expect(reasons).not.toContainText(/@[FP]\d+|（\s*）|\(\s*\)/);
      const facts = item.evidenceFacts.filter(fact => item.reasons[0].competitionFactIds.includes(fact.id));
      for (const fact of facts) {
        for (const id of fact.sourceIds) {
          const source = item.sources.find(value => value.id === id)!;
          const link = reasons.locator(`a[data-source-id="${source.id}"]`);
          await expect(link).toHaveAttribute("href", source.url);
          await expect(link).toHaveAttribute("title", `${source.title}${source.scope ? ` · ${source.scope}` : ""}`);
        }
      }
      await expect(reasons.getByText("查看依据与条件", { exact: false })).toHaveCount(0);
      if (item.rank <= 2) {
        await reasons.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`reason-${item.rank}-${viewport.name}.png`), fullPage: false });
      }
      observations.push({ itemId: item.itemId, displayedText: row.displayedText, evidenceFacts: facts.length, renderedReasons: await reasons.innerText() });
      await card.locator("summary").first().click();
    }
    await expect(page.getByText("比较两到三项，看清怎么取舍", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("decision-report-v7").getByRole("table")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.locator("body")).not.toContainText(/Unhandled Runtime Error|Application error: a client-side exception|Build Error/);
    expect(calls).toEqual([]); expect(errors).toEqual([]);
    await testInfo.attach("actual-output-offline-replay", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      evidenceClass: "actual_provider_output_offline_ui_replay", originalInvocationId: raw.invocationId, originalRawSha256: proof.raw.sha256,
      rawReportAndEvidenceUnchanged: true, normalizedRedactedTraceTotalsOnlyForCache: true, actualNewModelCalls: 0, viewport, observations, pageAndConsoleErrors: errors, apiCalls: calls,
    }, null, 2)) });
  });
}
