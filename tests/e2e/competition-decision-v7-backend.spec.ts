import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import type { RecommendationRunV7 } from "../../src/lib/competitions/v7/contracts";

// Browser plugin not available. Real local HTTP routes + isolated PostgreSQL +
// deterministic model fixtures; this is not a real-model quality evaluation.
test.skip(process.env.RUN_V7_BROWSER_BACKEND !== "1", "Use the isolated v7-backend Playwright config.");
const controlFile = path.resolve("tmp/v7-browser-tests/control.json");
async function controls(value: { holdDetails: boolean; releaseDetailsFor: string[]; failDetailsFor: string[] }) {
  await writeFile(`${controlFile}.next`, JSON.stringify(value));
  await rename(`${controlFile}.next`, controlFile);
}
async function choose(page: Page, name: string) {
  await page.getByTestId("conversation-current-question").getByRole("radio", { name, exact: true }).evaluate(element => element.closest("label")?.click());
}
async function next(page: Page) { await page.getByTestId("conversation-current-question").getByRole("button", { name: "回答好了，继续", exact: true }).click(); }
async function skip(page: Page) { await page.getByTestId("conversation-current-question").getByRole("button", { name: "暂不确定，跳过这题", exact: true }).click(); }
async function completeQuestionnaire(page: Page) {
  await page.goto("/competitions/recommend");
  await choose(page, "先发现自己愿意长期做的方向");
  await choose(page, "确认，先按这个方向比较"); await next(page);
  await choose(page, "本科大一"); await next(page);
  await skip(page); await skip(page); await skip(page);
  await choose(page, "暂时想不起或还没有"); await next(page);
  await skip(page);
  await choose(page, "每周 5–10 小时"); await choose(page, "先体验 1–2 周"); await next(page);
  await choose(page, "101–500 元");
  await page.getByRole("spinbutton", { name: /预算上限/ }).fill("300");
  await choose(page, "我个人的总预算"); await next(page);
  await expect(page.locator('[data-phase="summary"]')).toBeVisible();
}
async function submitSummary(page: Page): Promise<RecommendationRunV7> {
  await page.locator('[data-phase="summary"]').getByRole("checkbox").check();
  const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/ai/competition-recommend") && response.request().method() === "POST");
  await page.getByRole("button", { name: "同意，请乐乐开始匹配", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  expect(response.request().postDataJSON().reportVersion).toBe("competition-recommendation.v7");
  return response.json();
}
async function database() {
  const credentials = JSON.parse(await readFile("tmp/v7-browser-tests/private/database.json", "utf8"));
  if (new URL(credentials.runtime).pathname !== "/saitu_v7_browser_test") throw new Error("isolated_browser_database_required");
  const client = new pg.Client({ connectionString: credentials.runtime }); await client.connect(); return client;
}
test.beforeEach(async () => { await controls({ holdDetails: true, releaseDetailsFor: [], failDetailsFor: [] }); });

test("real v7 routes persist list-first delivery, reload, direct correction, comparison and selected saving", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const responses: { path: string; status: number; method: string }[] = [];
  page.on("response", response => { if (response.url().includes("/api/")) responses.push({ path: new URL(response.url()).pathname, status: response.status(), method: response.request().method() }); });
  await completeQuestionnaire(page);
  const queued = await submitSummary(page);
  const report = page.getByTestId("decision-report-v7");
  await expect(report).toHaveAttribute("data-run-id", queued.runId);
  await expect(report.getByTestId("recommendation-run-item")).toHaveCount(5);
  await expect(page.getByTestId("ai-test-mode-notice")).toContainText("没有调用真实模型");
  const first = report.getByTestId("recommendation-run-item").first();
  await expect(first.getByRole("link", { name: /^查看官网/ })).toHaveAttribute("href", /^https?:\/\//);
  expect(await page.title()).toContain("竞赛");
  expect(page.url()).toBe("http://127.0.0.1:3147/competitions/recommend");
  await expect(page.locator("nextjs-portal").getByText(/error/i)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("real-backend-list-arrival.png"), fullPage: false });
  await first.locator("summary").first().click();
  await expect(first).toContainText("匹配理由还在准备");
  await page.screenshot({ path: testInfo.outputPath("real-backend-list-first.png"), fullPage: false });
  const postsBeforeReload = responses.filter(response => response.path === "/api/ai/competition-recommend" && response.method === "POST").length;
  await page.reload();
  await expect(report).toHaveAttribute("data-run-id", queued.runId);
  await expect(report.getByTestId("recommendation-run-item")).toHaveCount(5);
  expect(responses.filter(response => response.path === "/api/ai/competition-recommend" && response.method === "POST")).toHaveLength(postsBeforeReload);
  await controls({ holdDetails: true, releaseDetailsFor: [queued.runId], failDetailsFor: [] });
  await expect(report).toHaveAttribute("data-run-status", "ready");
  await expect(first.getByRole("heading", { name: "为什么适合你", exact: true })).not.toBeVisible();
  await first.locator("summary").first().click();
  await expect(first.getByRole("heading", { name: "为什么适合你", exact: true })).toBeVisible();
  await expect(report.getByTestId("recommendation-run-item")).toHaveCount(5);
  await expect(report.getByRole("button", { name: /^查看其余/ })).toHaveCount(0);
  await expect(report).toHaveAttribute("data-total-items", "5");
  const chat = page.getByTestId("decision-chat-v7");
  await chat.getByRole("textbox", { name: "想追问或更正什么？", exact: true }).fill("我的个人预算改为100元");
  const correctionPromise = page.waitForResponse(response => response.url().endsWith("/api/ai/competition-chat") && response.request().method() === "POST");
  await chat.getByRole("button", { name: "发送", exact: true }).click();
  const correctionResponse = await correctionPromise;
  expect(correctionResponse.ok()).toBe(true);
  const correction = await correctionResponse.json();
  expect(correction.run.runId).not.toBe(queued.runId);
  expect(correction.run.profile.facts.some((fact: { field: string; state: string; value: unknown }) => fact.field === "budget.maximumYuan" && fact.state === "affirmed" && fact.value === 100)).toBe(true);
  await expect(report).toHaveAttribute("data-run-id", correction.run.runId);
  await expect(page.getByTestId("decision-update-proposal")).toHaveCount(0);
  await expect(report.getByTestId("recommendation-run-item")).toHaveCount(5);
  await controls({ holdDetails: true, releaseDetailsFor: [queued.runId, correction.run.runId], failDetailsFor: [] });
  await expect(report).toHaveAttribute("data-run-status", "ready");
  await expect(report.getByRole("table")).toHaveCount(0);
  await expect(report.getByText("比较两到三项，看清怎么取舍", { exact: true })).toHaveCount(0);
  await report.getByTestId("recommendation-run-item").first().getByRole("checkbox").check();
  await report.getByRole("button", { name: "收藏所选 1 项", exact: true }).click();
  await expect(report).toContainText("已收藏所选 1 项");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("real-backend-corrected-and-saved.png"), fullPage: true });
  await report.getByRole("link", { name: "打开我的竞赛", exact: true }).click();
  await expect(page.getByTestId("saved-decision-list").locator("li")).toHaveCount(1);
  const client = await database();
  try {
    const rows = await client.query("select run_id,status from competition_decision_runs where run_id=any($1::uuid[]) order by run_id", [[queued.runId, correction.run.runId]]);
    expect(rows.rows.map(row => row.status).sort()).toEqual(["ready", "superseded"]);
    const paid = await client.query("select count(*)::int as count from ai_spend_ledger"); expect(paid.rows[0].count).toBe(0);
  } finally { await client.end(); }
  expect(errors).toEqual([]);
  await testInfo.attach("integration-boundary", { body: JSON.stringify({ mode: "real HTTP + isolated PostgreSQL + deterministic mock model", paidCalls: 0, realModelQuality: "not measured", responses }), contentType: "application/json" });
});

test("real v7 routes retry an explicit failure and renew an expired session from its latest pending profile", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const retries: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/retry")) retries.push(request.url()); });
  await completeQuestionnaire(page);
  const initial = await submitSummary(page);
  const report = page.getByTestId("decision-report-v7");
  await expect(report.getByTestId("recommendation-run-item")).toHaveCount(5);
  await controls({ holdDetails: true, releaseDetailsFor: [initial.runId], failDetailsFor: [initial.runId] });
  await expect(report).toHaveAttribute("data-run-status", "failed");
  expect(retries).toHaveLength(0);
  await report.getByTestId("recommendation-run-item").first().locator("summary").first().click();
  await expect(report.getByTestId("recommendation-run-item").first()).toContainText("本次更新已结束");
  await page.screenshot({ path: testInfo.outputPath("real-backend-detail-failure.png"), fullPage: false });
  const retryPromise = page.waitForResponse(response => response.url().endsWith(`/runs/${initial.runId}/retry`) && response.request().method() === "POST");
  await report.getByRole("button", { name: "重新匹配", exact: true }).click();
  const retryResponse = await retryPromise;
  expect(retryResponse.status()).toBe(202);
  const retried: RecommendationRunV7 = await retryResponse.json();
  expect(retried.runId).not.toBe(initial.runId);
  expect(retried.profileRevision).toBe(initial.profileRevision);
  expect(retried.expiresAt).toBe(initial.expiresAt);
  expect(retries).toHaveLength(1);
  await expect(report).toHaveAttribute("data-run-id", retried.runId);
  await expect(report.getByTestId("recommendation-run-progress")).toContainText("详细说明已完成");
  const chat = page.getByTestId("decision-chat-v7");
  await chat.getByRole("textbox").fill("我的个人预算改为100元");
  const correctionPromise = page.waitForResponse(response => response.url().endsWith("/api/ai/competition-chat") && response.request().method() === "POST");
  await chat.getByRole("button", { name: "发送", exact: true }).click();
  const correctionResponse = await correctionPromise; expect(correctionResponse.ok()).toBe(true);
  const corrected: RecommendationRunV7 = (await correctionResponse.json()).run;
  await expect(report).toHaveAttribute("data-run-id", corrected.runId);
  await expect(report.getByTestId("recommendation-run-progress")).toContainText("详细说明已完成");
  await page.reload();
  await expect(report).toHaveAttribute("data-run-id", corrected.runId);
  const client = await database();
  try {
    // Simulate elapsed retention only in this owned, isolated database. Shift
    // all run times together so the production deadline constraint still holds.
    await client.query("begin");
    await client.query("update competition_decision_states set expires_at=expires_at-interval '2 hours' where state_key=(select state_key from competition_decision_runs where run_id=$1)", [corrected.runId]);
    await client.query("update competition_decision_runs set submitted_at=submitted_at-interval '2 hours',list_deadline_at=list_deadline_at-interval '2 hours',detail_deadline_at=detail_deadline_at-interval '2 hours',expires_at=expires_at-interval '2 hours' where run_id=$1", [corrected.runId]);
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { await client.end(); }
  await expect(report).toHaveAttribute("data-run-status", "expired");
  await expect(report.getByTestId("recommendation-run-item")).toHaveCount(5);
  expect(await page.evaluate(() => sessionStorage.getItem("saitu.recommendationRun.v7"))).toBeNull();
  await report.getByRole("button", { name: "回看答案并重新匹配", exact: true }).click();
  await expect(page.getByTestId("conversation-transcript")).toContainText("不超过100元");
  await expect(page.getByTestId("conversation-transcript")).not.toContainText("300元");
  const renewed = await submitSummary(page);
  expect(renewed.profileId).not.toBe(corrected.profileId);
  expect(renewed.profile.facts.some(fact => fact.field === "budget.maximumYuan" && fact.state === "affirmed" && fact.value === 100)).toBe(true);
  await controls({ holdDetails: false, releaseDetailsFor: [], failDetailsFor: [] });
  await expect(report).toHaveAttribute("data-run-id", renewed.runId);
  await expect(report).toHaveAttribute("data-run-status", "ready");
  await page.screenshot({ path: testInfo.outputPath("real-backend-renewed-latest-profile.png"), fullPage: false });
  const verify = await database();
  try { const paid = await verify.query("select count(*)::int as count from ai_spend_ledger"); expect(paid.rows[0].count).toBe(0); } finally { await verify.end(); }
  expect(errors).toEqual([]);
  await testInfo.attach("integration-boundary", { body: JSON.stringify({ mode: "real HTTP + isolated PostgreSQL + deterministic mock model", expiry: "isolated database timestamps shifted", paidCalls: 0, realModelQuality: "not measured", runs: [initial.runId, retried.runId, corrected.runId, renewed.runId] }), contentType: "application/json" });
});
