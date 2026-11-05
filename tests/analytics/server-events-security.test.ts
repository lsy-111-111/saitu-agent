import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsStoreMocks = vi.hoisted(() => ({
  configured: vi.fn(),
  store: vi.fn()
}));

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: analyticsStoreMocks.configured
}));

vi.mock("@/lib/supabase/server", () => ({
  storeAnalyticsEvent: analyticsStoreMocks.store
}));

import {
  recordVerifiedRecommendationCompleted
} from "@/lib/analytics/server";

describe("verified recommendation analytics", () => {
  beforeEach(() => {
    analyticsStoreMocks.configured.mockReset();
    analyticsStoreMocks.store.mockReset();
    analyticsStoreMocks.configured.mockReturnValue(true);
    analyticsStoreMocks.store.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("derives completion metadata from the actual server response without persisting session data", async () => {
    const signal = new AbortController().signal;
    const deadlineEpochMs = Date.now() + 1_000;

    await expect(recordVerifiedRecommendationCompleted({
      fallbackUsed: true,
      fallbackMode: "full",
      fallbackReason: "timeout",
      provider: "deepseek",
      recommendations: [
        { competitionId: "iot-design" },
        { competitionId: "national-college-math-modeling" },
        { competitionId: "graduate-rural-revitalization-agritech" }
      ]
    }, {
      sessionId: "876f3891-a4df-4bdf-a05a-83e17765116b",
      signal,
      deadlineEpochMs
    })).resolves.toBe(true);

    expect(analyticsStoreMocks.store).toHaveBeenCalledWith(
      "competition_recommend_completed",
      {
        device: "server",
        path: "/competitions/recommend",
        resultCount: 3,
        fallbackUsed: true,
        fallbackMode: "full",
        fallbackReason: "timeout",
        provider: "deepseek",
        competitionIds: "iot-design,national-college-math-modeling,graduate-rural-revitalization-agritech"
      },
      { signal, deadlineEpochMs }
    );
    const serialized = JSON.stringify(analyticsStoreMocks.store.mock.calls[0]);
    expect(serialized).not.toContain("876f3891-a4df-4bdf-a05a-83e17765116b");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("answer");
  });

  it("does not start or continue a write after cancellation or deadline expiry", async () => {
    const controller = new AbortController();
    controller.abort();

    const response = {
      fallbackUsed: false,
      fallbackMode: "none" as const,
      provider: "server",
      recommendations: [{ competitionId: "iot-design" }]
    };
    await expect(recordVerifiedRecommendationCompleted(response, {
      sessionId: "876f3891-a4df-4bdf-a05a-83e17765116b",
      signal: controller.signal,
      deadlineEpochMs: Date.now() + 1_000
    })).resolves.toBe(false);
    await expect(recordVerifiedRecommendationCompleted(response, {
      sessionId: "876f3891-a4df-4bdf-a05a-83e17765116b",
      signal: new AbortController().signal,
      deadlineEpochMs: Date.now()
    })).resolves.toBe(false);

    expect(analyticsStoreMocks.store).not.toHaveBeenCalled();
  });

  it("fails closed when result IDs do not satisfy the analytics contract", async () => {
    await expect(recordVerifiedRecommendationCompleted({
      fallbackUsed: false,
      fallbackMode: "none",
      provider: "server",
      recommendations: [{ competitionId: "attacker-controlled-id" }]
    }, {
      sessionId: "876f3891-a4df-4bdf-a05a-83e17765116b",
      signal: new AbortController().signal,
      deadlineEpochMs: Date.now() + 1_000
    })).resolves.toBe(false);

    expect(analyticsStoreMocks.store).not.toHaveBeenCalled();
  });

  it("does not accept an arbitrary caller label as a signed session context", async () => {
    await expect(recordVerifiedRecommendationCompleted({
      fallbackUsed: false,
      fallbackMode: "none",
      provider: "server",
      recommendations: [{ competitionId: "iot-design" }]
    }, {
      sessionId: "browser-claims-this-is-verified",
      signal: new AbortController().signal,
      deadlineEpochMs: Date.now() + 1_000
    })).resolves.toBe(false);

    expect(analyticsStoreMocks.store).not.toHaveBeenCalled();
  });
});
