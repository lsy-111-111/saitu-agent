import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { AI_EVIDENCE_EXPLANATION_CONSENT_VERSION } from "../src/lib/ai/consent-disclosure";
import { compareDecisionItems } from "../src/lib/competitions/v6/contracts";
import { recommendationRunFixture } from "./fixtures/recommendation-run-v7";
import type { RecommendationRunV7 } from "../src/lib/competitions/v7/contracts";
import { independentLegacyDecisionStore, independentLegacyV5Store, independentReviewRun, reviewClaim, reviewOfficialUrls, reviewSourcePrefix } from "./review-v7-official-entry-ui-independent.fixtures";

// Browser plugin not available. Existing Playwright controls installed Google Chrome.
const artifacts = path.resolve("artifacts/continuation-v7-20261109/official-entry-ui-independent-review");
const runKey = "saitu.recommendationRun.v7";
const savedKey = "saitu.savedDecisionChoices.v6";
const v5Key = "saitu.savedCompetitions.v1";

async function seed(page: Page, run: RecommendationRunV7, savedBytes = JSON.stringify(independentLegacyDecisionStore())) {
  await page.addInitScript(({ run, savedBytes, consent, runKey, savedKey, v5Key, v5Store }) => {
    if (!sessionStorage.getItem(runKey)) sessionStorage.setItem(runKey, JSON.stringify({ storageVersion: 1, run, previousList: null,
      context: { depth: "quick", profile: { stage: "undergraduate-1", skills: ["data-analysis"] }, fixedQuestionTextAnswers: {}, decisionContext: {}, acceptedConsentVersion: consent } }));
    if (localStorage.getItem(savedKey) === null) localStorage.setItem(savedKey, savedBytes);
    if (localStorage.getItem(v5Key) === null) localStorage.setItem(v5Key, JSON.stringify(v5Store));
  }, { run, savedBytes, consent: AI_EVIDENCE_EXPLANATION_CONSENT_VERSION, runKey, savedKey, v5Key, v5Store: independentLegacyV5Store });
}

async function guards(page: Page, state: { current: RecommendationRunV7; malformed?: unknown }) {
  const requests: { method: string; path: string; kind: string }[] = [];
  const escaped: string[] = [];
  const pageErrors: string[] = [];
  const consoleMessages: { type: string; text: string }[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => { if (["warning", "error"].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() }); });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3154") { escaped.push(`${url.origin}${url.pathname}`); await route.abort("blockedbyclient"); }
    else await route.continue();
  });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === `/api/ai/competition-recommend/runs/${state.current.runId}` && request.method() === "GET") {
      requests.push({ method: request.method(), path: pathname, kind: "mock-run" });
      expect(request.headers().authorization).toBe(`Bearer ${state.current.decisionToken}`);
      await route.fulfill({ json: state.malformed ?? state.current });
    } else if (pathname === "/api/ai/competition-chat" && request.method() === "POST") {
      requests.push({ method: request.method(), path: pathname, kind: "mock-chat" });
      const input = request.postDataJSON();
      expect(input.expectedRevision).toBe(state.current.profileRevision);
      const details = state.current.items.slice(0, 2).map(item => item.detail!);
      await route.fulfill({ json: { responseVersion: "competition-decision-chat.v7", requestId: input.requestId,
        message: "独立复审受控对话回复", profileRevision: state.current.profileRevision, decisionToken: state.current.decisionToken,
        claims: [reviewClaim("独立复审对话依据")], comparison: compareDecisionItems(details) } });
    } else if (pathname.startsWith("/api/ai/") || pathname.includes("/recommend/normalize")) {
      escaped.push(pathname); await route.abort("blockedbyclient");
    } else {
      requests.push({ method: request.method(), path: pathname, kind: "mock-non-ai" }); await route.fulfill({ status: 204 });
    }
  });
  return { requests, escaped, pageErrors, consoleMessages };
}

async function saveEvidence(page: Page, info: TestInfo, label: string, evidence: object) {
  const stem = `${info.project.name}-${label}`;
  const noFrameworkOverlay = await page.locator("[data-nextjs-dialog],[data-nextjs-error-overlay]").count() === 0;
  expect(noFrameworkOverlay).toBe(true);
  await page.screenshot({ path: path.join(artifacts, `${stem}.png`), fullPage: false });
  await writeFile(path.join(artifacts, `${stem}.json`), JSON.stringify({ url: page.url(), title: await page.title(), viewport: page.viewportSize(),
    bodyText: await page.locator("body").innerText(), links: await page.locator("a[href]").evaluateAll(links => links.map(link => ({ text: link.textContent, href: link.getAttribute("href") }))),
    noFrameworkOverlay,
    noHorizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), ...evidence }, null, 2) + "\n");
}

test("independent v7 list → expanded evidence/overview/comparison/chat → save → reload keeps only official entries", async ({ page }, info) => {
  const ready = independentReviewRun();
  const state = { current: recommendationRunFixture() };
  const network = await guards(page, state);
  await seed(page, state.current);
  await page.goto("/competitions/recommend");
  await expect(page).toHaveTitle(/竞赛/);
  const report = page.getByTestId("decision-report-v7");
  await expect(report).toBeVisible();
  await expect(report.getByTestId("recommendation-run-item")).toHaveCount(3);
  const first = report.getByTestId("recommendation-run-item").first();
  await first.scrollIntoViewIfNeeded();
  await expect(first.getByRole("link", { name: /查看官网/ })).toHaveAttribute("href", "https://official.example.org/entry-0");
  await expect(report.getByText("独立复审理由1", { exact: true })).toHaveCount(0);
  await saveEvidence(page, info, "list-pending", network);
  state.current = ready;
  await expect(report).toHaveAttribute("data-run-status", "ready");
  await expect(report.getByText("独立复审理由1", { exact: true })).not.toBeVisible();
  await expect(report.getByText("独立复审总览方向", { exact: true })).not.toBeVisible();
  await expect(first.getByRole("link", { name: /查看官网/ })).toHaveAttribute("href", reviewOfficialUrls[0]);
  await expect(report.locator(`a[href^="${reviewSourcePrefix}"]`)).toHaveCount(0);
  await first.scrollIntoViewIfNeeded();
  await saveEvidence(page, info, "list-ready-closed", network);

  await first.locator("summary").first().click();
  await expect(first.getByText("独立复审理由1", { exact: true })).toBeVisible();
  await first.getByText("查看其余 2 条准备与核实事项", { exact: true }).click();
  const firstClaim = first.locator("details details").first();
  await firstClaim.locator("summary").first().click();
  await expect(firstClaim).toContainText("独立复审资料事实1");
  await expect(firstClaim.locator("a[href]")).toHaveCount(0);
  const overview = report.getByTestId("decision-overview");
  await overview.locator("summary").first().click();
  await expect(overview.getByText("独立复审总览方向", { exact: true })).toBeVisible();
  await overview.locator("details summary").first().click();
  await expect(overview.locator("a[href]")).toHaveCount(0);
  await report.getByText("比较两到三项，看清怎么取舍", { exact: true }).click();
  const comparisons = report.getByRole("group", { name: "选择 2–3 项" });
  await comparisons.getByRole("checkbox", { name: ready.items[0].name, exact: true }).check();
  await comparisons.getByRole("checkbox", { name: ready.items[1].name, exact: true }).check();
  await expect(report.getByRole("table")).toBeVisible();
  await expect(report.locator(`a[href^="${reviewSourcePrefix}"]`)).toHaveCount(0);

  const chat = page.getByTestId("decision-chat-v7");
  await chat.getByRole("textbox").fill("请比较两项推荐的任务");
  await chat.getByRole("button", { name: "发送", exact: true }).click();
  await expect(chat.getByText("独立复审受控对话回复", { exact: true })).toBeVisible();
  await chat.locator("details summary").first().click();
  await expect(chat).toContainText("独立复审资料事实1");
  await expect(chat.locator("a[href]")).toHaveCount(0);
  await expect(report.locator('a[href^="http"]')).toHaveCount(2);
  await expect(report.getByText("官网链接暂缺", { exact: true })).toBeVisible();
  await saveEvidence(page, info, "expanded-chat", network);

  for (const item of ready.items) await report.locator(`[data-item-id="${item.itemId}"]`).getByRole("checkbox").check();
  await report.getByRole("button", { name: "收藏所选 3 项", exact: true }).click();
  await expect(report.getByText("已收藏所选 3 项。", { exact: true })).toBeVisible();
  const savedRaw = await page.evaluate(key => localStorage.getItem(key), savedKey);
  const stored = JSON.parse(savedRaw!);
  expect(stored.items).toHaveLength(4);
  expect(stored.items.find((item: { recommendation: { itemId: string } }) => item.recommendation.itemId === "review-legacy-v6")).toEqual(independentLegacyDecisionStore().items[0]);
  for (const item of ready.items) {
    const entry = stored.items.find((entry: { recommendation: { itemId: string } }) => entry.recommendation.itemId === item.itemId);
    expect(entry.officialEntry).toEqual({ sourcePolicy: "official-entry-only.v7", url: item.officialUrl });
    expect(entry.recommendation.sources).toEqual(item.detail!.sources);
    expect(entry.recommendation.evidenceFacts).toEqual(item.detail!.evidenceFacts);
  }
  await report.getByRole("link", { name: "打开我的竞赛", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3154/competitions/saved");
  await expect(page.getByRole("heading", { level: 1, name: "我的竞赛" })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("saved-decision-list").locator(":scope > li")).toHaveCount(4);
  expect(await page.evaluate(key => localStorage.getItem(key), savedKey)).toBe(savedRaw);
  expect(await page.evaluate(key => localStorage.getItem(key), v5Key)).toBe(JSON.stringify(independentLegacyV5Store));
  for (const [index, item] of ready.items.entries()) {
    const row = page.locator(`[data-saved-decision="${item.itemId}"]`);
    await expect(row.getByText(item.detail!.reasons[0].text, { exact: true })).not.toBeVisible();
    await row.locator("summary").click();
    await expect(row.getByText(item.detail!.reasons[0].text, { exact: true })).toBeVisible();
    await expect(row.locator(`a[href^="${reviewSourcePrefix}"]`)).toHaveCount(0);
    if (reviewOfficialUrls[index]) await expect(row.getByRole("link", { name: /查看官网/ })).toHaveAttribute("href", reviewOfficialUrls[index]!);
    else { await expect(row.locator("a[href]")).toHaveCount(0); await expect(row.getByText("官网链接暂缺")).toBeVisible(); }
  }
  const legacy = page.locator('[data-saved-decision="review-legacy-v6"]');
  await legacy.locator("summary").click();
  await expect(legacy.locator(`a[href^="${reviewSourcePrefix}"]`)).toHaveCount(2);
  await expect(page.getByText("独立复审旧v5理由", { exact: true })).toBeVisible();
  await expect(page.getByTestId("saved-competition-item")).toHaveCount(1);
  await expect(page.getByTestId("saved-competition-item").getByText("当前可报名", { exact: true })).toHaveCount(0);
  const officialRow = page.locator('[data-saved-decision="run-item-0"]');
  await officialRow.scrollIntoViewIfNeeded();
  expect(network.escaped).toEqual([]);
  expect(network.pageErrors).toEqual([]);
  expect(network.consoleMessages.filter(message => message.type === "error")).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await saveEvidence(page, info, "saved-reloaded", { ...network, savedPolicyPreserved: true, legacyBytesUnchanged: true, liveModelCalls: 0, backendCallsFromBrowser: 0 });
});

test("independent malformed official URL from polling is rejected while the delivered list remains usable", async ({ page }, info) => {
  const initial = recommendationRunFixture();
  const malformed = independentReviewRun();
  malformed.items[0].officialUrl = "javascript:alert(1)";
  const state = { current: initial, malformed };
  const network = await guards(page, state);
  await seed(page, initial);
  await page.goto("/competitions/recommend");
  const report = page.getByTestId("decision-report-v7");
  await expect(report).toContainText("暂未取得完整更新");
  await expect(report.getByTestId("recommendation-run-item")).toHaveCount(3);
  await expect(report.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(report.getByTestId("recommendation-run-item").first().getByRole("link", { name: /查看官网/ })).toHaveAttribute("href", "https://official.example.org/entry-0");
  expect(network.pageErrors).toEqual([]); expect(network.escaped).toEqual([]);
  await saveEvidence(page, info, "invalid-poll-rejected", network);
});

test("independent malformed saved marker is surfaced without rewriting or silently falling back to sources", async ({ page }, info) => {
  const malformedStore = independentLegacyDecisionStore();
  const bytes = JSON.stringify({ ...malformedStore, items: [{ ...malformedStore.items[0], officialEntry: { sourcePolicy: "official-entry-only.v7", url: "javascript:alert(1)" } }] });
  const network = await guards(page, { current: independentReviewRun() });
  await seed(page, independentReviewRun(), bytes);
  await page.goto("/competitions/saved");
  await expect(page.getByTestId("saved-competitions-content").getByRole("alert")).toContainText("已有新版收藏格式无法读取，已保留原数据");
  expect(await page.evaluate(key => localStorage.getItem(key), savedKey)).toBe(bytes);
  await expect(page.getByTestId("saved-decision-list")).toHaveCount(0);
  await expect(page.locator(`a[href^="${reviewSourcePrefix}"]`)).toHaveCount(0);
  await expect(page.getByText("独立复审旧v5理由", { exact: true })).toBeVisible();
  expect(network.pageErrors).toEqual([]); expect(network.escaped).toEqual([]);
  await saveEvidence(page, info, "malformed-saved-retained", network);
});
