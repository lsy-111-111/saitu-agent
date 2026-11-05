import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackEvent } from "@/lib/analytics/track";

describe("browser analytics trust boundary", () => {
  const sendBeacon = vi.fn();

  beforeEach(() => {
    sendBeacon.mockReset();
    sendBeacon.mockReturnValue(true);
    vi.stubGlobal("window", {
      innerWidth: 1280,
      location: { pathname: "/competitions/recommend" }
    });
    vi.stubGlobal("document", {
      referrer: "",
      location: { pathname: "/competitions/recommend" }
    });
    vi.stubGlobal("navigator", { sendBeacon });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["competition_recommend_completed", {
      resultCount: 3,
      fallbackUsed: false,
      fallbackMode: "none",
      provider: "deepseek",
      competitionIds: "iot-design,national-college-math-modeling,graduate-rural-revitalization-agritech"
    }],
    ["competition_recommend_failed", { failureReason: "request_failed" }]
  ] as const)("does not submit the authoritative event %s from browser state", (
    eventName,
    payload
  ) => {
    trackEvent(eventName, payload);

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("preserves ordinary non-authoritative browser telemetry", () => {
    trackEvent("competition_recommend_started");

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon).toHaveBeenCalledWith("/api/track", expect.any(Blob));
  });
});
