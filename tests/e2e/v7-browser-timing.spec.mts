import { expect, test } from "@playwright/test";
import { browserDeliveryTimeout, deliveryThresholds, installDeliveryProbe, waitForBrowserDelivery } from "./v7-browser-timing.mjs";
import { bindPilotRunClock, pilotProbeBootstrap, startPilotClock } from "./v7-pilot-browser.mjs";

test.use({ launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} });

const runId = "browser-timing-synthetic-run";
const pending = `<main><h1>浏览器时钟合成测试</h1><section data-testid="decision-report-v7" data-run-id="${runId}" data-display-run-id="${runId}" data-run-status="ranking">共 1 项</section></main>`;

test("original click collects a 59-second list and 149-second detail while both performance targets fail", async ({ page }) => {
  await page.clock.install(); await page.setContent(pending);
  const start = await installDeliveryProbe(page);
  await page.clock.fastForward(59_000);
  await page.evaluate(() => {
    const report = document.querySelector('[data-testid="decision-report-v7"]')!;
    report.setAttribute("data-run-status", "explaining");
    report.insertAdjacentHTML("beforeend", '<article data-testid="recommendation-run-item" data-detail-status="pending">名单在59秒出现</article>');
  });
  await waitForBrowserDelivery(page, { originalClickEpochMs: start, runId, phase: "list" });
  const listTiming = await page.evaluate(() => window.__saituPublicProbe);
  expect(listTiming.listMs).toBeGreaterThanOrEqual(59_000);
  expect(listTiming.allDetailsMs).toBeNull();
  await page.clock.fastForward(90_000);
  await page.evaluate(() => {
    document.querySelector('[data-testid="recommendation-run-item"]')!.setAttribute("data-detail-status", "ready");
    document.querySelector('[data-testid="decision-report-v7"]')!.setAttribute("data-run-status", "ready");
  });
  await waitForBrowserDelivery(page, { originalClickEpochMs: start, runId, phase: "details" });
  const timing = await page.evaluate(() => window.__saituPublicProbe);
  expect(timing.allDetailsMs).toBeGreaterThanOrEqual(149_000);
  expect(deliveryThresholds(timing)).toMatchObject({ firstListWithin40s: false, allDetailsWithin120s: false });
});

test("original detail clock rejects a fresh 150-second window after list delivery", async ({ page }) => {
  await page.clock.install(); await page.setContent(pending);
  const start = await installDeliveryProbe(page);
  await page.clock.fastForward(151_000);
  await expect(browserDeliveryTimeout(page, start, "details")).rejects.toThrow("details_original_click_deadline_exceeded");
});

test("the original list and a smaller fully reviewed final list each retain their delivery clock", async ({ page }) => {
  await page.clock.install();
  await page.setContent(pending);
  const start = await installDeliveryProbe(page);
  await page.clock.fastForward(5_000);
  await page.evaluate(() => {
    const report = document.querySelector('[data-testid="decision-report-v7"]')!;
    report.setAttribute("data-run-status", "explaining");
    report.setAttribute("data-total-items", "3");
    for (const itemId of ["a", "b", "c"]) {
      const card = document.createElement("article");
      card.dataset.testid = "recommendation-run-item";
      card.dataset.itemId = itemId;
      card.dataset.detailStatus = "checking";
      report.appendChild(card);
    }
  });
  await waitForBrowserDelivery(page, { originalClickEpochMs: start, runId, phase: "list" });
  const provisional = await page.evaluate(() => window.__saituPublicProbe);
  expect(provisional.expectedCount).toBe(3);
  expect(provisional.initialItemIds).toEqual(["a", "b", "c"]);
  expect(provisional.allDetailsMs).toBeNull();

  await page.clock.fastForward(20_000);
  await page.evaluate(() => {
    const report = document.querySelector('[data-testid="decision-report-v7"]')!;
    report.querySelector('[data-item-id="b"]')!.remove();
    for (const card of report.querySelectorAll('[data-testid="recommendation-run-item"]')) card.setAttribute("data-detail-status", "ready");
    report.setAttribute("data-total-items", "2");
    report.setAttribute("data-run-status", "ready");
  });
  await waitForBrowserDelivery(page, { originalClickEpochMs: start, runId, phase: "details" });
  const final = await page.evaluate(() => window.__saituPublicProbe);
  expect(final.listMs).toBe(provisional.listMs);
  expect(final.allDetailsMs).toBeGreaterThanOrEqual(25_000);
  expect(final.initialItemIds).toEqual(["a", "b", "c"]);
});

test("a previous displayed list cannot be counted as the corrected run's delivery", async ({ page }) => {
  await page.setContent(pending);
  const start = await installDeliveryProbe(page);
  await page.evaluate(() => {
    const report = document.querySelector('[data-testid="decision-report-v7"]')!;
    report.setAttribute("data-display-run-id", "previous-synthetic-run");
    report.insertAdjacentHTML("beforeend", '<article data-testid="recommendation-run-item" data-detail-status="ready">保留的旧名单</article>');
  });
  const wait = waitForBrowserDelivery(page, { originalClickEpochMs: start, runId, phase: "list" });
  const observed = await Promise.race([wait.then(() => "incorrectly_delivered"), page.waitForTimeout(100).then(() => "still_waiting")]);
  expect(observed).toBe("still_waiting");
  expect((await page.evaluate(() => window.__saituPublicProbe)).listMs).toBeNull();
  await page.evaluate(() => document.querySelector('[data-testid="decision-report-v7"]')!.setAttribute("data-display-run-id", "browser-timing-synthetic-run"));
  await wait;
  expect((await page.evaluate(() => window.__saituPublicProbe)).listMs).not.toBeNull();
});

test("one failed detail remains an incomplete journey even when the run is terminal", async ({ page }) => {
  await page.setContent(pending);
  const start = await installDeliveryProbe(page);
  await page.evaluate(() => {
    const report = document.querySelector('[data-testid="decision-report-v7"]')!;
    report.setAttribute("data-run-status", "ready");
    report.insertAdjacentHTML("beforeend", '<article data-testid="recommendation-run-item" data-detail-status="failed">保留名单，理由失败</article>');
  });
  await waitForBrowserDelivery(page, { originalClickEpochMs: start, runId, phase: "list" });
  await expect(waitForBrowserDelivery(page, { originalClickEpochMs: start, runId, phase: "details" })).rejects.toThrow("details_not_delivered_before_terminal_ready");
  expect((await page.evaluate(() => window.__saituPublicProbe)).allDetailsMs).toBeNull();
});

test("pilot refresh and correction keep each run's original click instead of reusing the previous displayed list", async ({ page, baseURL }) => {
  const key = "synthetic-pilot-clock", nextId = "corrected-synthetic-run";
  await page.route("**/synthetic-timing-fixture", route => route.fulfill({ contentType: "text/html", body: pending }));
  await page.addInitScript(pilotProbeBootstrap, { key });
  await page.goto(`${baseURL}/synthetic-timing-fixture`);
  const start = await startPilotClock(page, key); await bindPilotRunClock(page, key, runId, start);
  await page.evaluate(() => document.querySelector('[data-testid="decision-report-v7"]')!.insertAdjacentHTML("beforeend", '<article data-testid="recommendation-run-item" data-detail-status="pending">第一轮名单</article>'));
  const before = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), key);
  expect(before.listMs).not.toBeNull();
  await page.reload();
  const after = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), key);
  expect(after.originalClickEpochMs).toBe(start); expect(after.listMs).toBe(before.listMs);
  expect(after.runTimings[runId].originalClickEpochMs).toBe(start);
  await expect(bindPilotRunClock(page, key, runId, start + 1000)).rejects.toThrow("pilot_run_clock_cannot_restart");
  const correctionStart = await page.evaluate(() => performance.timeOrigin + performance.now());
  await bindPilotRunClock(page, key, nextId, correctionStart);
  await page.evaluate(nextId => {
    const report = document.querySelector('[data-testid="decision-report-v7"]')!;
    report.setAttribute("data-run-id", nextId);
    report.insertAdjacentHTML("beforeend", '<article data-testid="recommendation-run-item" data-detail-status="ready">仍是旧名单</article>');
  }, nextId);
  const retained = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), key);
  expect(retained.runTimings[nextId].listMs).toBeNull();
  await page.evaluate(nextId => {
    const report = document.querySelector('[data-testid="decision-report-v7"]')!;
    report.setAttribute("data-display-run-id", nextId); report.setAttribute("data-run-status", "ready");
  }, nextId);
  await waitForBrowserDelivery(page, { originalClickEpochMs: correctionStart, runId: nextId, phase: "details" });
  const corrected = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), key);
  expect(corrected.originalClickEpochMs).toBe(start);
  expect(corrected.runTimings[nextId].originalClickEpochMs).toBe(correctionStart);
  expect(corrected.runTimings[nextId].listMs).not.toBeNull();
  expect(corrected.runTimings[nextId].allDetailsMs).not.toBeNull();
});
