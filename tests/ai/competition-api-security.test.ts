import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as clarify } from "../../src/app/api/ai/competition-clarify/route";
import { POST as recommend } from "../../src/app/api/ai/competition-recommend/route";
import { POST as normalize } from "../../src/app/api/competitions/recommend/normalize/route";
import {
  COMPETITION_AI_MAX_REQUEST_BYTES,
  readCompetitionAiJson
} from "../../src/lib/ai/competition-api";

const originalEnv = { ...process.env };
const routes = [
  ["clarify", "http://localhost/api/ai/competition-clarify", clarify],
  ["recommend", "http://localhost/api/ai/competition-recommend", recommend],
  ["normalize", "http://localhost/api/competitions/recommend/normalize", normalize]
] as const;

function request(
  url: string,
  headers: Record<string, string>,
  options: { body?: string; mode?: RequestMode } = {}
) {
  return new Request(url, {
    method: "POST",
    headers,
    body: options.body ?? JSON.stringify({}),
    ...(options.mode ? { mode: options.mode } : {})
  });
}

beforeEach(() => {
  process.env.FEATURE_AI = "1";
  process.env.FEATURE_COMPETITION_RECOMMENDER = "1";
  process.env.AI_CONSENT_VERSION = "test.v1";
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("shared competition AI byte boundary", () => {
  function jsonBodyAtSize(byteLength: number) {
    const prefix = '{"padding":"';
    const suffix = '"}';
    return `${prefix}${"x".repeat(byteLength - prefix.length - suffix.length)}${suffix}`;
  }

  it("accepts a valid JSON body at exactly 64 KiB", async () => {
    const body = jsonBodyAtSize(COMPETITION_AI_MAX_REQUEST_BYTES);
    expect(Buffer.byteLength(body)).toBe(COMPETITION_AI_MAX_REQUEST_BYTES);

    const result = await readCompetitionAiJson(request(
      "http://localhost/api/ai/competition-clarify",
      { "Content-Type": "application/json" },
      { body }
    ));

    expect(result).toMatchObject({ ok: true });
  });

  it("rejects a streamed valid JSON body one byte above 64 KiB", async () => {
    const body = jsonBodyAtSize(COMPETITION_AI_MAX_REQUEST_BYTES + 1);
    expect(Buffer.byteLength(body)).toBe(COMPETITION_AI_MAX_REQUEST_BYTES + 1);

    const result = await readCompetitionAiJson(request(
      "http://localhost/api/ai/competition-clarify",
      { "Content-Type": "application/json" },
      { body }
    ));

    expect(result).toEqual({ ok: false, error: "PAYLOAD_TOO_LARGE" });
  });
});

describe("shared competition AI origin boundary", () => {
  const jsonHeaders = { "Content-Type": "application/json" };

  it.each([
    {
      name: "IPv4 loopback",
      url: "http://localhost:3000/api/ai/competition-clarify",
      headers: {
        ...jsonHeaders,
        Host: "127.0.0.1:3000",
        Origin: "http://127.0.0.1:3000"
      }
    },
    {
      name: "DNS host",
      url: "http://localhost/api/ai/competition-clarify",
      headers: {
        ...jsonHeaders,
        Host: "campus.example",
        Origin: "http://campus.example"
      }
    },
    {
      name: "IPv6 loopback",
      url: "http://localhost:3111/api/ai/competition-clarify",
      headers: {
        ...jsonHeaders,
        Host: "[::1]:3111",
        Origin: "http://[::1]:3111"
      }
    },
    {
      name: "default HTTP port",
      url: "http://localhost/api/ai/competition-clarify",
      headers: {
        ...jsonHeaders,
        Host: "campus.example:80",
        Origin: "http://campus.example"
      }
    },
    {
      name: "default HTTPS port behind a proxy",
      url: "http://localhost/api/ai/competition-clarify",
      headers: {
        ...jsonHeaders,
        Host: "campus.example:443",
        Origin: "https://campus.example",
        "X-Forwarded-Proto": "https"
      }
    },
    {
      name: "first forwarded protocol",
      url: "http://localhost/api/ai/competition-clarify",
      headers: {
        ...jsonHeaders,
        Host: "campus.example",
        Origin: "https://campus.example",
        "X-Forwarded-Proto": "https, http"
      }
    }
  ])("accepts a pure same-origin $name authority", async ({ url, headers }) => {
    await expect(readCompetitionAiJson(request(url, headers))).resolves.toMatchObject({ ok: true });
  });

  it("ignores X-Forwarded-Host and uses Host as the external authority", async () => {
    await expect(readCompetitionAiJson(request(
      "http://localhost/api/ai/competition-clarify",
      {
        ...jsonHeaders,
        Host: "campus.example",
        Origin: "https://campus.example",
        "X-Forwarded-Host": "attacker.example",
        "X-Forwarded-Proto": "https"
      }
    ))).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["empty Host", "", undefined],
    ["userinfo Host", "user@campus.example", undefined],
    ["path Host", "campus.example/path", undefined],
    ["backslash Host", "campus.example\\path", undefined],
    ["query Host", "campus.example?query", undefined],
    ["fragment Host", "campus.example#fragment", undefined],
    ["comma Host", "campus.example,attacker.example", undefined],
    ["empty port Host", "campus.example:", undefined],
    ["out-of-range port Host", "campus.example:99999", undefined],
    ["unbracketed IPv6 Host", "::1", undefined],
    ["empty forwarded protocol", "campus.example", ""],
    ["colon-suffixed forwarded protocol", "campus.example", "https:"],
    ["non-HTTP forwarded protocol", "campus.example", "ftp"],
    ["empty first forwarded protocol", "campus.example", ",https"]
  ])("rejects a malformed %s", async (_name, host, forwardedProto) => {
    const headers: Record<string, string> = {
      ...jsonHeaders,
      Host: host,
      Origin: "http://campus.example"
    };
    if (forwardedProto !== undefined) headers["X-Forwarded-Proto"] = forwardedProto;

    await expect(readCompetitionAiJson(request(
      "http://localhost/api/ai/competition-clarify",
      headers
    ))).resolves.toEqual({ ok: false, error: "UNSAFE_REQUEST" });
  });

  it.each([
    ["opaque origin", "null"],
    ["non-HTTP origin", "ftp://campus.example"],
    ["userinfo origin", "http://user@campus.example"],
    ["path origin", "http://campus.example/path"],
    ["backslash origin", "http://campus.example\\path"],
    ["query origin", "http://campus.example?query"],
    ["fragment origin", "http://campus.example#fragment"],
    ["multiple origins", "http://campus.example https://campus.example"]
  ])("rejects a malformed %s header", async (_name, origin) => {
    await expect(readCompetitionAiJson(request(
      "http://localhost/api/ai/competition-clarify",
      { ...jsonHeaders, Host: "campus.example", Origin: origin }
    ))).resolves.toEqual({ ok: false, error: "UNSAFE_REQUEST" });
  });

  it.each([
    {
      name: "hostname",
      headers: { Host: "127.0.0.1:3000", Origin: "http://localhost:3000" }
    },
    {
      name: "protocol",
      headers: {
        Host: "campus.example",
        Origin: "http://campus.example",
        "X-Forwarded-Proto": "https"
      }
    },
    {
      name: "port",
      headers: { Host: "campus.example:3000", Origin: "http://campus.example:3001" }
    },
    {
      name: "same-site subdomain",
      headers: {
        Host: "api.example.test",
        Origin: "http://www.example.test",
        "Sec-Fetch-Site": "same-site"
      }
    },
    {
      name: "same-origin metadata with a foreign Origin",
      headers: {
        Host: "campus.example",
        Origin: "http://attacker.example",
        "Sec-Fetch-Site": "same-origin"
      }
    }
  ])("rejects a mismatched $name", async ({ headers }) => {
    const requestHeaders: Record<string, string> = { ...jsonHeaders };
    for (const [name, value] of Object.entries(headers)) {
      if (typeof value === "string") requestHeaders[name] = value;
    }
    await expect(readCompetitionAiJson(request(
      "http://localhost:3000/api/ai/competition-clarify",
      requestHeaders
    ))).resolves.toEqual({ ok: false, error: "UNSAFE_REQUEST" });
  });
});

describe.each(routes)("%s competition AI request boundary", (_name, url, post) => {
  it("rejects a text/plain no-cors request before parsing its body", async () => {
    const privateBodyMarker = "private-questionnaire-body-marker";
    const response = await post(request(
      url,
      { "Content-Type": "text/plain" },
      { body: privateBodyMarker, mode: "no-cors" }
    ));

    expect(response.status).toBe(415);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ ok: false, error: "UNSUPPORTED_MEDIA_TYPE" });
    const logged = [console.info, console.warn, console.error]
      .flatMap((logger) => vi.mocked(logger).mock.calls.flat())
      .join(" ");
    expect(logged).not.toContain(privateBodyMarker);
  });

  it("rejects a foreign browser Origin with a uniform no-store response", async () => {
    const response = await post(request(url, {
      "Content-Type": "application/json",
      Origin: "https://attacker.example"
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ ok: false, error: "UNSAFE_REQUEST" });
  });

  it("rejects Sec-Fetch-Site cross-site even without an Origin header", async () => {
    const response = await post(request(url, {
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "cross-site"
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ ok: false, error: "UNSAFE_REQUEST" });
  });

  it("accepts JSON with a charset from a same-origin browser", async () => {
    const response = await post(request(url, {
      "Content-Type": "application/json; charset=UTF-8",
      Origin: "http://localhost",
      "Sec-Fetch-Site": "same-origin"
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "AI_CONSENT_REQUIRED" });
  });

  it("accepts a 127.0.0.1 browser Origin when Next normalized request.url to localhost", async () => {
    const response = await post(request(url, {
      "Content-Type": "application/json",
      Host: "127.0.0.1:3000",
      Origin: "http://127.0.0.1:3000",
      "Sec-Fetch-Site": "same-origin"
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "AI_CONSENT_REQUIRED" });
  });

  it("accepts an HTTPS browser Origin forwarded by the trusted proxy", async () => {
    const response = await post(request(url, {
      "Content-Type": "application/json",
      Host: "campus.example",
      Origin: "https://campus.example",
      "Sec-Fetch-Site": "same-origin",
      "X-Forwarded-Proto": "https"
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "AI_CONSENT_REQUIRED" });
  });

  it("rejects a same-origin fetch marker when the external Origin does not match Host", async () => {
    const response = await post(request(url, {
      "Content-Type": "application/json",
      Host: "campus.example",
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "same-origin",
      "X-Forwarded-Proto": "https"
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ ok: false, error: "UNSAFE_REQUEST" });
  });

  it("keeps application/json requests without Origin available to trusted server clients", async () => {
    const response = await post(request(url, { "Content-Type": "application/json" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "AI_CONSENT_REQUIRED" });
  });
});
