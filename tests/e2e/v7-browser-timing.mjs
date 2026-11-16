// Browser delivery cutoffs and performance targets have different purposes.
// Every wait spends the remainder of the original click's window.
export const BROWSER_DELIVERY_LIMITS = Object.freeze({ list: 60_000, details: 150_000 });
export const BROWSER_PERFORMANCE_TARGETS = Object.freeze({ list: 40_000, details: 120_000, expansion: 1000 });

export function browserDeliveryLimits(timeouts) {
  if (!timeouts) return BROWSER_DELIVERY_LIMITS;
  if (timeouts.firstListMs !== BROWSER_PERFORMANCE_TARGETS.list || timeouts.allDetailsMs !== BROWSER_PERFORMANCE_TARGETS.details ||
      timeouts.readyExpansionMs !== BROWSER_PERFORMANCE_TARGETS.expansion || timeouts.rankHardTimeoutMs !== BROWSER_DELIVERY_LIMITS.list ||
      timeouts.detailHardTimeoutMs !== BROWSER_DELIVERY_LIMITS.details) throw new Error("top5_browser_targets_and_hard_limits_required");
  return { list: timeouts.rankHardTimeoutMs, details: timeouts.detailHardTimeoutMs };
}

export function remainingDeliveryMs(originalClickEpochMs, nowEpochMs, phase, limits = BROWSER_DELIVERY_LIMITS) {
  if (!Number.isFinite(originalClickEpochMs) || originalClickEpochMs <= 0 || !Number.isFinite(nowEpochMs) ||
      !Object.hasOwn(limits, phase) || !Number.isFinite(limits[phase]) || limits[phase] <= 0) throw new Error("original_browser_click_clock_required");
  return Math.max(0, originalClickEpochMs + limits[phase] - nowEpochMs);
}

export function deliveryThresholds(timing) {
  const within = (value, limit) => Number.isFinite(value) && value >= 0 && value <= limit;
  return { firstListWithin40s: within(timing?.listMs, BROWSER_PERFORMANCE_TARGETS.list),
    allDetailsWithin120s: within(timing?.allDetailsMs, BROWSER_PERFORMANCE_TARGETS.details),
    readyExpansionWithin1s: within(timing?.readyExpansionMs, BROWSER_PERFORMANCE_TARGETS.expansion) };
}

export async function installDeliveryProbe(page) {
  return page.evaluate(() => {
    window.__saituDeliveryObserver?.disconnect();
    const probe = { timeOrigin: performance.timeOrigin, start: performance.now(), listMs: null, allDetailsMs: null,
      terminalStatus: null, expectedCount: null, initialItemIds: [], readyExpansionMs: null };
    window.__saituPublicProbe = probe;
    const inspect = () => {
      const report = document.querySelector('[data-testid="decision-report-v7"]'); if (!report) return;
      const cards = [...report.querySelectorAll('[data-testid="recommendation-run-item"]')];
      const currentList = !report.dataset.displayRunId || report.dataset.displayRunId === report.dataset.runId;
      const expectedCount = Number(report.dataset.totalItems ?? report.textContent.match(/共\s+(\d+)\s+项/)?.[1] ?? cards.length);
      if (cards.length && currentList && probe.listMs === null) {
        probe.listMs = performance.now() - probe.start;
        probe.expectedCount = expectedCount;
        probe.initialItemIds = cards.map(card => card.dataset.itemId ?? null);
      }
      if (["ready", "failed", "expired", "superseded"].includes(report.dataset.runStatus)) probe.terminalStatus = report.dataset.runStatus;
      if (probe.allDetailsMs === null && currentList && report.dataset.runStatus === "ready" && cards.length > 0 &&
          cards.length === expectedCount && cards.every(card => card.dataset.detailStatus === "ready")) probe.allDetailsMs = performance.now() - probe.start;
    };
    window.__saituDeliveryObserver = new MutationObserver(inspect);
    window.__saituDeliveryObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
    return probe.timeOrigin + probe.start;
  });
}

export async function publicClickEpochMs(page) {
  return page.evaluate(() => {
    const p = window.__saituPublicProbe;
    if (!p || !Number.isFinite(p.timeOrigin) || !Number.isFinite(p.start)) throw new Error("original_browser_click_clock_required");
    return p.timeOrigin + p.start;
  });
}

export async function browserDeliveryTimeout(page, originalClickEpochMs, phase, limits = BROWSER_DELIVERY_LIMITS) {
  const now = await page.evaluate(() => performance.timeOrigin + performance.now());
  const remaining = remainingDeliveryMs(originalClickEpochMs, now, phase, limits);
  if (remaining <= 0) throw new Error(`${phase}_original_click_deadline_exceeded`);
  return Math.max(1, Math.ceil(remaining));
}

export async function waitForBrowserDelivery(page, { originalClickEpochMs, runId, phase, limits = BROWSER_DELIVERY_LIMITS }) {
  const timeout = await browserDeliveryTimeout(page, originalClickEpochMs, phase, limits);
  const result = await page.waitForFunction(({ runId, phase, deadlineEpochMs }) => {
    if (performance.timeOrigin + performance.now() > deadlineEpochMs) return null;
    const report = document.querySelector('[data-testid="decision-report-v7"]');
    if (!report || report.dataset.runId !== runId) return null;
    const cards = [...report.querySelectorAll('[data-testid="recommendation-run-item"]')];
    const currentList = !report.dataset.displayRunId || report.dataset.displayRunId === runId;
    const expected = Number(report.dataset.totalItems ?? report.textContent.match(/共\s+(\d+)\s+项/)?.[1] ?? cards.length);
    const complete = currentList && cards.length > 0 && (phase === "list" || report.dataset.runStatus === "ready" &&
      cards.length === expected && cards.every(card => card.dataset.detailStatus === "ready"));
    const terminal = ["ready", "failed", "expired", "superseded"].includes(report.dataset.runStatus);
    return complete || terminal ? { complete, status: report.dataset.runStatus } : null;
  }, { runId, phase, deadlineEpochMs: originalClickEpochMs + limits[phase] }, { timeout });
  const state = await result.jsonValue(); await result.dispose();
  if (!state.complete) throw new Error(`${phase}_not_delivered_before_terminal_${state.status}`);
}
