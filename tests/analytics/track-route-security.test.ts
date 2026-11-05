import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  store: vi.fn()
}));

vi.mock("@/lib/supabase/server", () => ({
  createAnalyticsSupabaseClient: supabaseMocks.createClient,
  storeAnalyticsEvent: supabaseMocks.store
}));

import { POST } from "@/app/api/track/route";
import { resetRateLimitStateForTests } from "@/lib/security/rate-limit";

const endpoint = "https://siyuanjiaxin.com/api/track";

function trackRequest(input: {
  body?: unknown;
  endpoint?: string;
  headers?: Record<string, string>;
  ip?: string;
  requestId?: string;
} = {}) {
  return new Request(input.endpoint ?? endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://siyuanjiaxin.com",
      "Sec-Fetch-Site": "same-origin",
      "X-Real-IP": input.ip ?? "203.0.113.10",
      "X-Request-ID": input.requestId ?? "track-request-0001",
      ...input.headers
    },
    body: JSON.stringify(input.body ?? {
      eventName: "page_view_home",
      payload: { path: "/" }
    })
  });
}

function streamedTrackRequest(input: {
  chunks: string[];
  headers?: Record<string, string>;
  onCancel?: (reason: unknown) => void;
  requestId: string;
}) {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = input.chunks[index];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunk));
      index += 1;
    },
    cancel(reason) {
      input.onCancel?.(reason);
    }
  });

  return new Request(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://siyuanjiaxin.com",
      "Sec-Fetch-Site": "same-origin",
      "X-Real-IP": "203.0.113.80",
      "X-Request-ID": input.requestId,
      ...input.headers
    },
    body,
    duplex: "half"
  } as RequestInit & { duplex: "half" });
}

describe("analytics route request boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-service-role-key");
    resetRateLimitStateForTests();
    supabaseMocks.insert.mockResolvedValue({ error: null });
    supabaseMocks.from.mockReturnValue({ insert: supabaseMocks.insert });
    supabaseMocks.createClient.mockReturnValue({ from: supabaseMocks.from });
    supabaseMocks.store.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a cross-site no-cors-shaped text/plain request before storage", async () => {
    const response = await POST(trackRequest({
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site"
      }
    }));

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      reason: "unsupported_media_type"
    });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-request-id")).toBe("track-request-0001");
    expect(supabaseMocks.store).not.toHaveBeenCalled();
  });

  it.each(["cross-site", "same-site", "none"])(
    "rejects Sec-Fetch-Site: %s even when Origin matches",
    async (fetchSite) => {
      const response = await POST(trackRequest({
        headers: { "Sec-Fetch-Site": fetchSite }
      }));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        reason: "unsafe_request"
      });
      expect(supabaseMocks.store).not.toHaveBeenCalled();
    }
  );

  it("rejects a mismatched Origin", async () => {
    const response = await POST(trackRequest({
      headers: { Origin: "https://attacker.example" }
    }));

    expect(response.status).toBe(403);
    expect(supabaseMocks.store).not.toHaveBeenCalled();
  });

  it.each([
    [
      "competition_recommend_completed",
      {
        resultCount: 3,
        fallbackUsed: false,
        fallbackMode: "none",
        provider: "deepseek",
        competitionIds: "iot-design,national-college-math-modeling,graduate-rural-revitalization-agritech"
      }
    ],
    ["competition_recommend_failed", { failureReason: "request_failed" }]
  ])("rejects forged authoritative event %s even from a same-origin browser", async (
    eventName,
    payload
  ) => {
    const response = await POST(trackRequest({ body: { eventName, payload } }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      reason: "untrusted_authoritative_event"
    });
    expect(supabaseMocks.store).not.toHaveBeenCalled();
  });

  it("does not treat omitted browser metadata as authority to assert a business result", async () => {
    const request = trackRequest({
      body: {
        eventName: "competition_recommend_failed",
        payload: { failureReason: "request_failed" }
      },
      requestId: "track-forged-server-shape"
    });
    request.headers.delete("origin");
    request.headers.delete("sec-fetch-site");

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(response.headers.get("x-request-id")).toBe("track-forged-server-shape");
    expect(supabaseMocks.store).not.toHaveBeenCalled();
  });

  it("keeps trusted server compatibility when browser metadata is absent", async () => {
    const request = trackRequest();
    request.headers.delete("origin");
    request.headers.delete("sec-fetch-site");

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, stored: true });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-request-id")).toBe("track-request-0001");
    expect(supabaseMocks.store).toHaveBeenCalledWith(
      "page_view_home",
      { path: "/" },
      { signal: request.signal }
    );
  });

  it("keeps the same-origin browser request working", async () => {
    const response = await POST(trackRequest({
      body: {
        eventName: "competition_detail_open",
        payload: {
          competitionId: "national-college-math-modeling",
          privateAnswer: "must not be stored"
        }
      }
    }));

    expect(response.status).toBe(200);
    expect(supabaseMocks.store).toHaveBeenCalledWith(
      "competition_detail_open",
      { competitionId: "national-college-math-modeling" },
      { signal: expect.any(AbortSignal) }
    );
  });

  it.each([
    ["without Content-Length", {}],
    ["with a forged smaller Content-Length", { "Content-Length": "16" }]
  ])("stream-rejects a chunked body over 8 KiB %s", async (_label, headers) => {
    const onCancel = vi.fn();
    const hasDeclaredLength = "Content-Length" in headers;
    const body = JSON.stringify({
      eventName: "page_view_home",
      payload: { path: "/", padding: "x".repeat(9 * 1024) }
    });
    const chunks = Array.from({ length: Math.ceil(body.length / 257) }, (_, index) =>
      body.slice(index * 257, (index + 1) * 257)
    );
    const response = await POST(streamedTrackRequest({
      chunks,
      headers,
      onCancel,
      requestId: hasDeclaredLength ? "track-small-length" : "track-no-length"
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "PAYLOAD_TOO_LARGE"
    });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-request-id")).toBe(
      hasDeclaredLength ? "track-small-length" : "track-no-length"
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.store).not.toHaveBeenCalled();
  });

  it("uses actual stream bytes instead of rejecting a small body with an inflated length", async () => {
    const response = await POST(streamedTrackRequest({
      chunks: [JSON.stringify({ eventName: "page_view_home", payload: { path: "/" } })],
      headers: { "Content-Length": "99999" },
      requestId: "track-inflated-length"
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, stored: true });
  });

  it("rejects invalid allowed-field values before storage", async () => {
    const response = await POST(trackRequest({
      body: {
        eventName: "cta_click",
        payload: {
          ctaName: "student@example.com",
          position: "/competitions"
        }
      },
      requestId: "track-invalid-payload"
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, reason: "invalid_payload" });
    expect(response.headers.get("x-request-id")).toBe("track-invalid-payload");
    expect(supabaseMocks.store).not.toHaveBeenCalled();
  });

  it("uses the forwarded protocol and Host when validating behind the reverse proxy", async () => {
    const response = await POST(trackRequest({
      endpoint: "http://127.0.0.1:3000/api/track",
      headers: {
        Host: "siyuanjiaxin.com",
        "X-Forwarded-Proto": "https"
      }
    }));

    expect(response.status).toBe(200);
    expect(supabaseMocks.store).toHaveBeenCalledTimes(1);
  });

  it("returns the unified rate-limit envelope and correlation headers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let index = 0; index < 60; index += 1) {
      const response = await POST(trackRequest({
        ip: "203.0.113.60",
        requestId: `track-allowed-${String(index).padStart(3, "0")}`
      }));
      expect(response.status).toBe(200);
    }

    const response = await POST(trackRequest({
      ip: "203.0.113.60",
      requestId: "track-limited-061"
    }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toMatchObject({
      ok: false,
      error: "RATE_LIMITED",
      source: "application",
      bucket: "track",
      requestId: "track-limited-061"
    });
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-ratelimit-source")).toBe("application");
    expect(response.headers.get("x-request-id")).toBe("track-limited-061");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"stage":"analytics_track"'));
  });

  it("returns 503 instead of a false threshold 429 when the memory state map is full", async () => {
    vi.stubEnv("SECURITY_MEMORY_HITS_MAX", "1");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await POST(trackRequest({
      ip: "203.0.113.70",
      requestId: "track-state-first"
    }))).status).toBe(200);

    const response = await POST(trackRequest({
      ip: "203.0.113.71",
      requestId: "track-state-unavailable"
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "SECURITY_STATE_UNAVAILABLE",
      retryAfter: 5,
      source: "application",
      bucket: "track",
      requestId: "track-state-unavailable"
    });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("retry-after")).toBe("5");
    expect(response.headers.get("x-ratelimit-source")).toBe("application");
    expect(response.headers.get("x-request-id")).toBe("track-state-unavailable");
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(
      '"event":"competition_security_state_unavailable"'
    ));
  });
});
