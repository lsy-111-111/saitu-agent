import { beforeEach, describe, expect, it } from "vitest";
import { getClientIp, resetRateLimitStateForTests } from "@/lib/security/rate-limit";

beforeEach(() => resetRateLimitStateForTests());

describe("shared API client IP resolution", () => {
  it("prefers the reverse proxy's real IP over a spoofable forwarded chain", () => {
    const request = new Request("https://example.test/api/ai/competition-recommend", {
      headers: {
        "x-real-ip": "203.0.113.10",
        "x-forwarded-for": "198.51.100.99, 203.0.113.10"
      }
    });

    expect(getClientIp(request)).toBe("203.0.113.10");
  });

  it("keeps forwarded-for as a development fallback when no real IP is present", () => {
    const request = new Request("https://example.test/api/ai/competition-recommend", {
      headers: { "x-forwarded-for": "198.51.100.20, 192.0.2.3" }
    });

    expect(getClientIp(request)).toBe("198.51.100.20");
  });
});
