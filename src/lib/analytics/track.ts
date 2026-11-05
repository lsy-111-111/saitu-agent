import { analyticsEvents } from "@/lib/analytics/constants";
import { isAuthoritativeAnalyticsEventName } from "@/lib/analytics/events";
import type { AnalyticsEventName, AnalyticsPayload } from "@/types/analytics";

function deviceType() {
  if (typeof window === "undefined") {
    return "server";
  }

  return window.innerWidth < 768 ? "mobile" : "desktop";
}

function basePayload(): AnalyticsPayload {
  if (typeof window === "undefined") {
    return {};
  }

  return {
    source: document.referrer ? "referral" : "direct",
    device: deviceType(),
    path: window.location.pathname
  };
}

export function trackEvent(eventName: AnalyticsEventName, payload: AnalyticsPayload = {}) {
  if (
    typeof window === "undefined" ||
    !(eventName in analyticsEvents) ||
    isAuthoritativeAnalyticsEventName(eventName)
  ) {
    return;
  }

  const body = JSON.stringify({
    eventName,
    payload: {
      ...basePayload(),
      ...payload
    }
  });

  if ("sendBeacon" in navigator) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon("/api/track", blob);
    return;
  }

  void fetch("/api/track", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body,
    keepalive: true
  });
}
