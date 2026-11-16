import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, devices } from "@playwright/test";
import { fillPublicBrowserProfile, installPublicBrowserProbe } from "./v7-public-browser.mjs";
import { installSourceLoader } from "../../scripts/lib/load-typescript-source.mjs";

// Rehearsal only: every API path is intercepted, including an abort fallback.
// No request reaches a model or database. Run with the fixed Node runtime.
installSourceLoader(process.cwd());
const { topFiveRunFixture, runItemDetail } = await import("../fixtures/recommendation-run-v7.ts");
const { COMPETITION_CLARIFICATION_RESPONSE_VERSION } = await import("../../src/types/competition-recommendation.ts");
const baseUrl = process.argv[2], output = process.argv[3];
if (!baseUrl || !output || !["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname)) throw new Error("local_rehearsal_url_and_new_output_required");
await mkdir(output);
for (let attempt = 0; attempt < 60; attempt++) { try { if ((await fetch(baseUrl)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 500)); }
const plan = JSON.parse(await readFile("tests/e2e/fixtures/v7-public-browser-plan.json", "utf8"));
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const results = [];
try {
  for (const entry of plan.cases) {
    const context = await browser.newContext(entry.viewport === "mobile" ? devices["Pixel 5"] : devices["Desktop Chrome"]);
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    let normalizeCount = 0, recommendCount = 0;
    const run = topFiveRunFixture({ items: Array.from({ length: 5 }, (_, index) => ({ rank: index + 1, itemId: `run-item-${index}`, seriesId: `run-series-${index}`, name: `公开演练竞赛${index + 1}`, trackLabel: "流程演练", edition: "测试", officialUrl: "https://example.org/", detailStatus: "pending" })), shortfallReason: null });
    let current = run;
    await page.route("**/api/**", route => route.abort("blockedbyclient"));
    await page.route("**/api/competitions/recommend/normalize", async route => {
      normalizeCount += 1;
      expect(route.request().postDataJSON().questionnaire.decisionContext.budget.maximumYuan ?? 0).toBe(entry.budget);
      await route.fulfill({ json: { status: "confirmed", questionnaireToken: "public-rehearsal-questionnaire-token-0000000000" } });
    });
    await page.route("**/api/ai/competition-clarify", route => route.fulfill({ json: { responseVersion: COMPETITION_CLARIFICATION_RESPONSE_VERSION, status: "completed", nextQuestion: null, conversationToken: "public-rehearsal-conversation-token-0000000000" } }));
    await page.route("**/api/ai/competition-recommend", async route => { recommendCount += 1; await route.fulfill({ status: 202, json: run }); });
    await page.route(`**/api/ai/competition-recommend/runs/${run.runId}`, route => route.fulfill({ json: current }));
    await fillPublicBrowserProfile(page, entry, baseUrl);
    expect(normalizeCount).toBe(0); expect(recommendCount).toBe(0);
    await installPublicBrowserProbe(page);
    await page.getByRole("button", { name: "同意，请乐乐开始匹配", exact: true }).click();
    const report = page.getByTestId("decision-report-v7");
    await expect(report.getByTestId("recommendation-run-item")).toHaveCount(5);
    const firstTiming = await page.evaluate(() => window.__saituPublicProbe);
    expect(firstTiming.listMs).toBeGreaterThan(0); expect(firstTiming.allDetailsMs).toBeNull();
    current = { ...run, status: "ready", resultVersion: 3, items: run.items.map((item, index) => ({ ...item, detailStatus: "ready", detail: { ...runItemDetail(index), name: item.name } })) };
    await expect(report).toHaveAttribute("data-run-status", "ready");
    await expect(report.getByRole("button", { name: /^查看其余/ })).toHaveCount(0);
    await page.waitForFunction(() => window.__saituPublicProbe.allDetailsMs !== null);
    const timing = await page.evaluate(() => window.__saituPublicProbe);
    expect(timing.allDetailsMs).toBeGreaterThanOrEqual(timing.listMs); expect(timing.expectedCount).toBe(5);
    expect(normalizeCount).toBe(1); expect(recommendCount).toBe(1); expect(errors).toEqual([]);
    await page.screenshot({ path: path.join(output, `${entry.caseId}.png`), fullPage: false });
    results.push({ caseId: entry.caseId, viewport: entry.viewport, mode: "mock API rehearsal", timing, paidCalls: 0 });
    await context.close();
  }
  await writeFile(path.join(output, "rehearsal.json"), JSON.stringify({ schemaVersion: "saitu.public-browser-rehearsal.v7.1", passed: true, realModelRunsExecuted: 0, paidCalls: 0, results }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ passed: true, publicForms: results.length, realModelRunsExecuted: 0, paidCalls: 0 }));
} finally { await browser.close(); }
