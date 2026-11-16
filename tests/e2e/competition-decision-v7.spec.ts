import { expect, test, type Page } from "@playwright/test";
import { AI_EVIDENCE_EXPLANATION_CONSENT_VERSION } from "../../src/lib/ai/consent-disclosure";
import type { RecommendationRunV7 } from "../../src/lib/competitions/v7/contracts";
import { completedRunFixture, legacyTenRunFixture, nextRunFixtureId, recommendationRunFixture, runFixtureId, runItemDetail, topFiveRunFixture } from "../fixtures/recommendation-run-v7";
import { COMPETITION_CLARIFICATION_RESPONSE_VERSION } from "../../src/types/competition-recommendation";

// Browser plugin not available. Exercise the app with the existing Playwright runner.
test.use({ actionTimeout: 15000, launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} });
const storageKey = "saitu.recommendationRun.v7";
// Every test installs its explicit synthetic routes after this fail-closed fallback.
test.beforeEach(async ({ page }) => { await page.route("**/api/**", route => route.abort("blockedbyclient")); });

async function restoreRun(page: Page, run: RecommendationRunV7) {
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: { storageVersion: 1, run, previousList: null, context: { depth: "quick", profile: { stage: "undergraduate-1", skills: ["data-analysis"] }, fixedQuestionTextAnswers: {}, decisionContext: {}, acceptedConsentVersion: AI_EVIDENCE_EXPLANATION_CONSENT_VERSION } } });
}

test("Top5 restores all five compact items and saves only the selected ready item", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const initial = topFiveRunFixture();
  let current = initial;
  let posts = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().includes("/api/ai/competition-recommend")) posts += 1; });
  await page.route(`**/api/ai/competition-recommend/runs/${runFixtureId}`, route => route.fulfill({ json: current }));
  await restoreRun(page, current);
  await page.goto("/competitions/recommend");
  const report = page.getByTestId("decision-report-v7");
  await expect(page).toHaveTitle(/竞赛/);
  await expect(report).toHaveAttribute("data-total-items", "5");
  await expect(report.getByTestId("recommendation-run-item")).toHaveCount(5);
  await expect(report.getByRole("button", { name: /^查看其余/ })).toHaveCount(0);
  await expect(report.getByTestId("recommendation-run-progress")).toContainText("0/5 项");
  const fifth = report.getByTestId("recommendation-run-item").nth(4);
  await fifth.locator("summary").first().click();
  await expect(fifth).toContainText("匹配理由还在准备");
  current = { ...initial, status: "ready", resultVersion: 3, detailsReadyAt: new Date().toISOString(), items: initial.items.map((item, index) => ({ ...item, detailStatus: "ready", detail: runItemDetail(index) })) };
  await expect(fifth.getByText("详情中的专属匹配理由5", { exact: true })).toBeVisible();
  await expect(report.getByRole("table")).toHaveCount(0);
  await expect(fifth.getByRole("heading", { name: "为什么适合你", exact: true })).toBeVisible();
  await fifth.getByRole("checkbox").check();
  await report.getByRole("button", { name: "收藏所选 1 项", exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("saitu.savedDecisionChoices.v6")!).items);
  expect(saved.map((item: { recommendation: { itemId: string } }) => item.recommendation.itemId)).toEqual(["run-item-4"]);
  await page.reload();
  await expect(report.getByTestId("recommendation-run-item")).toHaveCount(5);
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!).run.executionPolicy, storageKey)).toEqual(initial.executionPolicy);
  expect(posts).toBe(0);
  expect(errors).toEqual([]);
  await expect(page.locator("body")).not.toContainText(/Unhandled Runtime Error|Application error: a client-side exception/);
  await page.screenshot({ path: testInfo.outputPath("top5-restored.png"), fullPage: false });
});

test("historical ten-item v7 caches keep their deadlines, expand and save the tenth result", async ({ page }, testInfo) => {
  const old = legacyTenRunFixture();
  const run = { ...old, status: "ready" as const, items: old.items.map((item, index) => ({ ...item, detailStatus: "ready" as const, detail: { ...runItemDetail(index), name: item.name } })) };
  let posts = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().includes("/api/ai/competition-recommend")) posts += 1; });
  await restoreRun(page, run);
  await page.goto("/competitions/recommend");
  const report = page.getByTestId("decision-report-v7");
  await expect(report).toHaveAttribute("data-total-items", "10");
  await expect(report.getByTestId("recommendation-run-item")).toHaveCount(5);
  await report.getByRole("button", { name: "查看其余 5 项", exact: true }).click();
  await expect(report.getByTestId("recommendation-run-item")).toHaveCount(10);
  const tenth = report.getByTestId("recommendation-run-item").nth(9);
  await tenth.locator("summary").first().click();
  await expect(tenth.getByText("详情中的专属匹配理由10", { exact: true })).toBeVisible();
  await tenth.getByRole("checkbox").check();
  await report.getByRole("button", { name: "收藏所选 1 项", exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("saitu.savedDecisionChoices.v6")!).items);
  expect(saved[0].recommendation.itemId).toBe("run-item-9");
  await page.reload();
  await expect(report).toHaveAttribute("data-total-items", "10");
  const restored = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!).run, storageKey);
  expect(restored.policyVersion).toBe(old.policyVersion);
  expect(restored.rankDeadlineAt).toBe(old.rankDeadlineAt);
  expect(restored.detailDeadlineAt).toBe(old.detailDeadlineAt);
  expect(restored.items).toHaveLength(10);
  expect(restored.executionPolicy).toBeUndefined();
  expect(posts).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("legacy-ten-restored.png"), fullPage: false });
});

test("v7 restores a list first, fills clicked detail, isolates detail failure and preserves official links", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  let current = recommendationRunFixture();
  const authorizations: string[] = [];
  let postCount = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().includes("/api/ai/competition-recommend")) postCount += 1; });
  await page.route(`**/api/ai/competition-recommend/runs/${runFixtureId}`, async route => {
    authorizations.push(route.request().headers().authorization ?? "");
    await route.fulfill({ json: current });
  });
  await restoreRun(page, current);
  await page.goto("/competitions/recommend");
  await expect(page).toHaveURL(/\/competitions\/recommend$/);
  await expect(page).toHaveTitle(/竞赛/);
  const result = page.getByTestId("decision-report-v7");
  await expect(result).toBeVisible();
  await expect(result.getByTestId("recommendation-run-item")).toHaveCount(3);
  await expect(result.getByRole("link", { name: "查看官网：列表先出测试竞赛1", exact: true })).toHaveAttribute("href", "https://official.example.org/entry-0");
  await expect(result.getByTestId("recommendation-shortfall")).toHaveText("当前显示 3 项推荐，可修改回答或向乐乐追问。");
  await expect(result.getByText("详情中的专属匹配理由1", { exact: true })).not.toBeVisible();
  await expect(result.getByText("资格初筛通过", { exact: true })).toHaveCount(0);
  await expect(page.getByText("本标签页会暂存输入和推荐，刷新可恢复；关闭标签页后清除。", { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("v7-list-first.png"), fullPage: true });
  await page.screenshot({ path: testInfo.outputPath("v7-list-first-viewport.png"), fullPage: false });

  const first = result.getByTestId("recommendation-run-item").first();
  await first.locator("summary").first().click();
  await expect(first).toContainText("匹配理由还在准备");
  current = completedRunFixture();
  await expect(first.getByText("详情中的专属匹配理由1", { exact: true })).toBeVisible();
  const second = result.getByTestId("recommendation-run-item").nth(1);
  await expect(second.getByText("详情中的专属匹配理由2", { exact: true })).not.toBeVisible();
  const third = result.getByTestId("recommendation-run-item").nth(2);
  await third.locator("summary").first().click();
  await expect(third).toContainText("其他比赛仍可查看");
  await expect(result.getByRole("link", { name: "查看官网：列表先出测试竞赛1", exact: true })).toHaveAttribute("href", "https://official.example.org/entry-0");

  await expect(result.getByRole("table")).toHaveCount(0);
  await expect(result.getByText("比较两到三项，看清怎么取舍", { exact: true })).toHaveCount(0);
  await first.getByRole("checkbox").check();
  await result.getByRole("button", { name: "收藏所选 1 项", exact: true }).click();
  await expect(result).toContainText("已收藏所选 1 项");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("saitu.savedDecisionChoices.v6") ?? "{}").items.length)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("saitu.recommendationRun.v7"))).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("v7-detail-and-compare.png"), fullPage: true });
  await page.screenshot({ path: testInfo.outputPath("v7-detail-and-compare-viewport.png"), fullPage: false });
  await page.reload();
  await expect(page.getByTestId("decision-report-v7").getByTestId("recommendation-run-item")).toHaveCount(3);
  expect(authorizations.every(value => value === `Bearer ${current.decisionToken}`)).toBe(true);
  expect(postCount).toBe(0);
  expect(errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  await expect(page.locator("body")).not.toContainText(/Unhandled Runtime Error|Application error: a client-side exception/);
  await testInfo.attach("dom-console-observation", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    url: page.url(), title: await page.title(), viewport: page.viewportSize(), text: await result.innerText(),
    pageErrors: errors, consoleErrors, horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
  }, null, 2)) });
});

test("v7 recovers a disconnected poll and applies a correction to a fresh run without confirmation", async ({ page }) => {
  const initial = recommendationRunFixture();
  let disconnected = true;
  await page.route(`**/api/ai/competition-recommend/runs/${runFixtureId}`, async route => {
    if (disconnected) await route.abort("connectionfailed");
    else await route.fulfill({ json: completedRunFixture() });
  });
  await restoreRun(page, initial);
  await page.goto("/competitions/recommend");
  await expect(page.getByTestId("recommendation-run-item")).toHaveCount(3);
  await expect(page.getByTestId("decision-report-v7")).toContainText("连接暂时中断");
  disconnected = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("decision-report-v7")).toHaveAttribute("data-run-status", "ready");

  const next = recommendationRunFixture({ runId: nextRunFixtureId, decisionToken: "opaque-v7-second-token-12345678901234567890", profileRevision: "revision-two", status: "ranking", resultVersion: 0, listReadyAt: null, items: [] });
  let nextList = next;
  await page.route(`**/api/ai/competition-recommend/runs/${nextRunFixtureId}`, route => route.fulfill({ json: nextList }));
  await page.route("**/api/ai/competition-chat", async route => {
    const request = route.request().postDataJSON();
    expect(request.action.type).toBe("message");
    expect(request.expectedRevision).toBe("revision-one");
    await route.fulfill({ json: { responseVersion: "competition-decision-chat.v7", requestId: request.requestId, message: "已采用你的更正，正在更新名单。", profileRevision: next.profileRevision, decisionToken: next.decisionToken, run: next, claims: [] } });
  });
  const chat = page.getByTestId("decision-chat-v7");
  await expect(chat).toBeVisible();
  await chat.getByRole("textbox", { name: "想追问或更正什么？", exact: true }).fill("我的个人预算改为100元");
  await chat.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByTestId("decision-report-v7")).toHaveAttribute("data-run-id", nextRunFixtureId);
  await expect(page.getByTestId("decision-report-v7")).toHaveAttribute("data-display-run-id", runFixtureId);
  await expect(page.getByTestId("recommendation-run-item")).toHaveCount(3);
  await expect(page.getByTestId("decision-report-v7")).toContainText("先保留上次交付的名单");
  await expect(page.getByTestId("decision-update-proposal")).toHaveCount(0);
  const completed = completedRunFixture();
  nextList = { ...next, status: "ready", resultVersion: 3, listReadyAt: new Date().toISOString(), detailsReadyAt: new Date().toISOString(), items: completed.items.map(item => ({ ...item, name: `更正后${item.name}`, ...(item.detail ? { detail: { ...item.detail, name: `更正后${item.name}` } } : {}) })) };
  await expect(page.getByTestId("recommendation-run-item").first()).toContainText("更正后列表先出测试竞赛1");
  await expect(page.getByTestId("decision-report-v7")).toHaveAttribute("data-run-id", nextRunFixtureId);
  await expect(page.getByTestId("decision-report-v7")).toHaveAttribute("data-display-run-id", nextRunFixtureId);
  await page.getByRole("button", { name: "清除本标签页记录", exact: true }).click();
  await expect(page.getByTestId("decision-report-v7")).toHaveCount(0);
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).toBeNull();
});

test("v7 explicitly retries a failed run with one stable request ID and preserves its list", async ({ page }, testInfo) => {
  const initial = recommendationRunFixture({ status: "failed", error: "TEST_DETAIL_FAILURE" });
  await restoreRun(page, initial);
  let retryCount = 0;
  const ids: string[] = [];
  const next = recommendationRunFixture({ runId: nextRunFixtureId, decisionToken: "retry-v7-second-token-12345678901234567890", status: "ranking", resultVersion: 0, items: [] });
  let nextState = next;
  await page.route(`**/api/ai/competition-recommend/runs/${nextRunFixtureId}`, route => route.fulfill({ json: nextState }));
  await page.route(`**/api/ai/competition-recommend/runs/${runFixtureId}/retry`, async route => {
    const input = route.request().postDataJSON();
    expect(input.decisionToken).toBe(initial.decisionToken);
    expect(input.expectedRevision).toBe(initial.profileRevision);
    ids.push(input.requestId); retryCount += 1;
    if (retryCount === 1) await route.abort("connectionfailed");
    else await route.fulfill({ status: 202, json: next });
  });
  await page.goto("/competitions/recommend");
  const result = page.getByTestId("decision-report-v7");
  await expect(result).toHaveAttribute("data-run-status", "failed");
  expect(retryCount).toBe(0);
  const first = result.getByTestId("recommendation-run-item").first();
  await first.locator("summary").first().click();
  await expect(first).toContainText("本次更新已结束");
  await expect(first).not.toContainText("完成后会自动显示");
  await result.getByRole("button", { name: "重新匹配", exact: true }).click();
  await expect(result.getByRole("button", { name: "重试这次匹配", exact: true })).toBeVisible();
  const retryIntent = await page.evaluate(() => JSON.parse(sessionStorage.getItem("saitu.submissionTiming.v7")!));
  expect(retryIntent.retry.requestId).toBe(ids[0]);
  await page.reload();
  await expect(result).toHaveAttribute("data-run-id", runFixtureId);
  await result.getByRole("button", { name: "重新匹配", exact: true }).click();
  await expect(result).toHaveAttribute("data-run-id", nextRunFixtureId);
  await expect(result.getByTestId("recommendation-run-item")).toHaveCount(3);
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("saitu.submissionTiming.v7")!).originalClickEpochMs)).toBe(retryIntent.originalClickEpochMs);
  await expect(result).toContainText("先保留上次交付的名单");
  await page.reload();
  await expect(result).toHaveAttribute("data-run-id", nextRunFixtureId);
  await expect(result.getByTestId("recommendation-run-item")).toHaveCount(3);
  nextState = { ...completedRunFixture(), runId: nextRunFixtureId, decisionToken: next.decisionToken };
  await expect(result).toHaveAttribute("data-run-status", "ready");
  await page.screenshot({ path: testInfo.outputPath("v7-retried-list.png"), fullPage: false });
});

test("v7 expiry starts a fresh session from the latest pending profile without stale form wording", async ({ page }, testInfo) => {
  const base = recommendationRunFixture();
  const profile = { ...base.profile, revision: "revision-corrected-before-detail", facts: [...base.profile.facts,
    { id: "budget-new", field: "budget.maximumYuan", value: 100, label: "个人预算100元", state: "affirmed" as const, confirmed: true, evidenceLevel: "self_report" as const }] };
  const corrected = recommendationRunFixture({ profile, profileRevision: profile.revision });
  await restoreRun(page, corrected);
  await page.route(`**/api/ai/competition-recommend/runs/${runFixtureId}`, route => route.fulfill({ status: 410, json: { error: "RUN_EXPIRED" } }));
  let normalizeCount = 0;
  await page.route("**/api/competitions/recommend/normalize", async route => {
    const input = route.request().postDataJSON(); normalizeCount += 1;
    expect(input.recommendationPolicy).toBe("v7");
    expect(input.questionnaire.decisionContext.budget.maximumYuan).toBe(100);
    expect(JSON.stringify(input.questionnaire)).not.toContain("300");
    await route.fulfill({ json: { status: "confirmed", questionnaireToken: "mock-normalized-questionnaire-token-12345678901234567890" } });
  });
  await page.route("**/api/ai/competition-clarify", async route => {
    expect(route.request().postDataJSON().recommendationPolicy).toBe("v7");
    await route.fulfill({ json: { responseVersion: COMPETITION_CLARIFICATION_RESPONSE_VERSION, status: "completed", nextQuestion: null, conversationToken: "mock-new-conversation-token-12345678901234567890" } });
  });
  const next = recommendationRunFixture({ runId: nextRunFixtureId, profile, profileRevision: profile.revision, decisionToken: "renew-v7-second-token-12345678901234567890", status: "ready", items: [] });
  let recommendCount = 0;
  await page.route("**/api/ai/competition-recommend", async route => {
    const input = route.request().postDataJSON(); recommendCount += 1;
    expect(input.decisionEdit).toBeUndefined();
    await route.fulfill({ status: 202, json: next });
  });
  await page.goto("/competitions/recommend");
  const result = page.getByTestId("decision-report-v7");
  await expect(result).toHaveAttribute("data-run-status", "expired");
  await expect(result.getByTestId("recommendation-run-item")).toHaveCount(3);
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).toBeNull();
  await result.getByRole("button", { name: "回看答案并重新匹配", exact: true }).click();
  await expect(page.locator('[data-phase="summary"]')).toBeVisible();
  await expect(page.getByTestId("conversation-transcript")).toContainText("不超过100元");
  await page.locator('[data-phase="summary"]').getByRole("checkbox").check();
  await page.getByRole("button", { name: "同意，请乐乐开始匹配", exact: true }).click();
  await expect(result).toHaveAttribute("data-run-id", nextRunFixtureId);
  expect(normalizeCount).toBe(1); expect(recommendCount).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("v7-expired-new-session.png"), fullPage: false });
});

test("v7 ignores an old delayed poll after a correction and clears a delayed chat on restart", async ({ page }) => {
  const initial = recommendationRunFixture();
  await restoreRun(page, initial);
  let releaseOld: (() => void) | undefined;
  const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
  await page.route(`**/api/ai/competition-recommend/runs/${runFixtureId}`, async route => { await oldGate; await route.fulfill({ json: completedRunFixture() }).catch(() => undefined); });
  const next = recommendationRunFixture({ runId: nextRunFixtureId, profileRevision: "revision-new", decisionToken: "delay-v7-second-token-12345678901234567890", status: "ready", items: initial.items.map(item => ({ ...item, name: `新名单${item.rank}` })) });
  let releaseChat: (() => void) | undefined;
  let chatCount = 0;
  await page.route("**/api/ai/competition-chat", async route => {
    const input = route.request().postDataJSON(); chatCount += 1;
    if (chatCount > 1) await new Promise<void>(resolve => { releaseChat = resolve; });
    await route.fulfill({ json: { responseVersion: "competition-decision-chat.v7", requestId: input.requestId, message: "已采用更正", profileRevision: next.profileRevision, decisionToken: next.decisionToken, run: next, claims: [] } }).catch(() => undefined);
  });
  const oldRequest = page.waitForRequest(request => request.url().includes(`/runs/${runFixtureId}`));
  await page.goto("/competitions/recommend"); await oldRequest;
  const chat = page.getByTestId("decision-chat-v7");
  await chat.getByRole("textbox").fill("我的预算改为100元"); await chat.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByTestId("decision-report-v7")).toHaveAttribute("data-run-id", nextRunFixtureId);
  releaseOld!();
  await expect(page.getByTestId("recommendation-run-item").first()).toContainText("新名单1");
  await chat.getByRole("textbox").fill("我的预算改为200元"); await chat.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => chatCount).toBe(2);
  await page.getByRole("button", { name: "清除本标签页记录", exact: true }).click();
  releaseChat!();
  await expect(page.getByTestId("decision-report-v7")).toHaveCount(0);
  await expect(page.getByTestId("assistant-welcome-message")).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).toBeNull();
});

test("v7 carries the original submit timing through normalize, clarification and recommendation", async ({ page }) => {
  const calls: { path: string; elapsed: number; token: string | undefined }[] = [];
  const timingToken = "syntheticoriginalclick.syntheticsignature";
  const run = completedRunFixture();
  await page.route("**/api/**", route => route.abort("blockedbyclient"));
  await page.route("**/api/competitions/recommend/normalize", async route => {
    const headers = route.request().headers();
    calls.push({ path: "normalize", elapsed: Number(headers["x-saitu-submission-elapsed-ms"]), token: headers["x-saitu-submission-timing"] });
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.fulfill({ headers: { "X-Saitu-Submission-Timing": timingToken }, json: {
      status: "confirmed", questionnaireToken: "mock-timing-questionnaire-token-12345678901234567890" } });
  });
  await page.route("**/api/ai/competition-clarify", async route => {
    const headers = route.request().headers();
    calls.push({ path: "clarify", elapsed: Number(headers["x-saitu-submission-elapsed-ms"]), token: headers["x-saitu-submission-timing"] });
    await route.fulfill({ headers: { "X-Saitu-Submission-Timing": timingToken }, json: {
      responseVersion: COMPETITION_CLARIFICATION_RESPONSE_VERSION, status: "completed", nextQuestion: null,
      conversationToken: "mock-timing-conversation-token-12345678901234567890" } });
  });
  await page.route("**/api/ai/competition-recommend", async route => {
    const headers = route.request().headers();
    calls.push({ path: "recommend", elapsed: Number(headers["x-saitu-submission-elapsed-ms"]), token: headers["x-saitu-submission-timing"] });
    await route.fulfill({ status: 202, json: run });
  });
  const choose = async (name: string) => page.getByTestId("conversation-current-question").getByRole("radio", { name, exact: true }).evaluate(element => element.closest("label")?.click());
  const next = async () => page.getByTestId("conversation-current-question").getByRole("button", { name: "回答好了，继续", exact: true }).click();
  const skip = async () => page.getByTestId("conversation-current-question").getByRole("button", { name: "暂不确定，跳过这题", exact: true }).click();
  await page.goto("/competitions/recommend");
  await choose("先发现自己愿意长期做的方向"); await choose("确认，先按这个方向比较"); await next();
  await choose("本科大一"); await next(); await skip(); await skip(); await skip();
  await choose("暂时想不起或还没有"); await next(); await skip();
  await choose("每周 5–10 小时"); await choose("先体验 1–2 周"); await next();
  await choose("不超过 100 元"); await page.getByRole("spinbutton", { name: /预算上限/ }).fill("100");
  await choose("我个人的总预算"); await next();
  await expect(page.locator('[data-phase="summary"]')).toBeVisible();
  await page.locator('[data-phase="summary"]').getByRole("checkbox").check();
  expect(calls).toEqual([]);
  await page.getByRole("button", { name: "同意，请乐乐开始匹配", exact: true }).click();
  await expect(page.getByTestId("decision-report-v7")).toHaveAttribute("data-run-id", run.runId);
  expect(calls.map(call => call.path)).toEqual(["normalize", "clarify", "recommend"]);
  expect(calls[0].token).toBeUndefined();
  expect(calls.every(call => Number.isFinite(call.elapsed) && call.elapsed >= 0)).toBe(true);
  expect(calls[1].elapsed - calls[0].elapsed).toBeGreaterThanOrEqual(140);
  expect(calls[2].elapsed).toBeGreaterThanOrEqual(calls[1].elapsed);
  expect(calls.slice(1).every(call => call.token === timingToken)).toBe(true);
  const saved = await page.evaluate(() => sessionStorage.getItem("saitu.submissionTiming.v7"));
  expect(JSON.parse(saved!).token).toBe(timingToken);
  await page.reload();
  await expect(page.getByTestId("decision-report-v7")).toHaveAttribute("data-run-id", run.runId);
  expect(calls).toHaveLength(3);
  expect(await page.evaluate(() => sessionStorage.getItem("saitu.submissionTiming.v7"))).toBe(saved);
});
