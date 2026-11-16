import { describe, expect, it } from "vitest";
import { BROWSER_DELIVERY_LIMITS, BROWSER_PERFORMANCE_TARGETS, browserDeliveryLimits, deliveryThresholds, remainingDeliveryMs } from "../../e2e/v7-browser-timing.mjs";
import { RECOMMENDATION_RANK_HARD_TIMEOUT_MS, RECOMMENDATION_DETAIL_DEADLINE_MS, RECOMMENDATION_DETAIL_TARGET_MS, RECOMMENDATION_LIST_DEADLINE_MS } from "@/lib/competitions/v7/contracts";

describe("v7 original browser click windows", () => {
  const start = 1_794_164_400_000;
  it("collects a valid 42-second list while retaining its failed 40-second performance result", () => {
    expect(BROWSER_DELIVERY_LIMITS.list).toBe(RECOMMENDATION_RANK_HARD_TIMEOUT_MS);
    expect(BROWSER_PERFORMANCE_TARGETS.list).toBe(RECOMMENDATION_LIST_DEADLINE_MS);
    expect(BROWSER_PERFORMANCE_TARGETS.details).toBe(RECOMMENDATION_DETAIL_TARGET_MS);
    expect(remainingDeliveryMs(start, start + 42_000, "list")).toBe(18_000);
    expect(deliveryThresholds({ listMs: 42_000, allDetailsMs: 115_000, readyExpansionMs: 100 })).toEqual({
      firstListWithin40s: false, allDetailsWithin120s: true, readyExpansionWithin1s: true });
  });
  it("includes normalize, clarification, network and persistence time before acceptance", () => {
    expect(remainingDeliveryMs(start, start + 12_000, "list")).toBe(48_000);
    expect(remainingDeliveryMs(start, start + 12_000, "details")).toBe(138_000);
  });
  it("does not open another 150 seconds after a slow list or refresh", () => {
    expect(BROWSER_DELIVERY_LIMITS.details).toBe(RECOMMENDATION_DETAIL_DEADLINE_MS);
    expect(remainingDeliveryMs(start, start + 59_000, "details")).toBe(91_000);
    expect(remainingDeliveryMs(start, start + 150_001, "details")).toBe(0);
    expect(remainingDeliveryMs(start, start + 60_001, "list")).toBe(0);
  });
  it.each([null, {}, { listMs: -1, allDetailsMs: Infinity, readyExpansionMs: NaN }])("never treats missing or invalid timing as passing: %j", timing => {
    expect(deliveryThresholds(timing)).toEqual({ firstListWithin40s: false, allDetailsWithin120s: false, readyExpansionWithin1s: false });
  });
  it("accepts the target boundaries but keeps collection limits separate", () => {
    const timeouts = { firstListMs: 40_000, allDetailsMs: 120_000, readyExpansionMs: 1000, rankHardTimeoutMs: 60_000, detailHardTimeoutMs: 150_000 };
    expect(browserDeliveryLimits(timeouts)).toEqual(BROWSER_DELIVERY_LIMITS);
    expect(deliveryThresholds({ listMs: 40_000, allDetailsMs: 120_000, readyExpansionMs: 1000 })).toEqual({ firstListWithin40s: true, allDetailsWithin120s: true, readyExpansionWithin1s: true });
    expect(() => browserDeliveryLimits({ ...timeouts, rankHardTimeoutMs: 40_000 })).toThrow("top5_browser_targets_and_hard_limits_required");
    expect(() => browserDeliveryLimits({ ...timeouts, detailHardTimeoutMs: 90_000 })).toThrow("top5_browser_targets_and_hard_limits_required");
  });
  it("rejects an absent original clock rather than substituting a server timestamp", () => {
    expect(() => remainingDeliveryMs(NaN, start, "list")).toThrow("original_browser_click_clock_required");
  });
});
