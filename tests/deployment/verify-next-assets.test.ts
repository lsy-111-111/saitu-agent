import { describe, expect, it, vi } from "vitest";

// @ts-expect-error The production health checker is intentionally a plain Node ESM script.
import { verifyNextAssets } from "../../scripts/verify-next-assets.mjs";

type StubResponse = {
  body: string;
  contentType: string;
  status?: number;
};

function createFetchStub(responses: Record<string, StubResponse>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    const response = responses[url];
    if (!response) return new Response("not found", { status: 404 });

    return new Response(response.body, {
      status: response.status ?? 200,
      headers: { "Content-Type": response.contentType }
    });
  });
}

describe("Next.js static asset verification", () => {
  it("accepts non-empty same-origin CSS and JavaScript assets", async () => {
    const fetchStub = createFetchStub({
      "http://127.0.0.1:3000/": {
        body:
          '<!doctype html><link rel="stylesheet" href="/_next/static/css/app.css">' +
          '<link rel="stylesheet" href="https://cdn.example.com/external.css">' +
          '<script src="/_next/static/chunks/app.js"></script>',
        contentType: "text/html; charset=utf-8"
      },
      "http://127.0.0.1:3000/_next/static/css/app.css": {
        body: "body { display: flex; }",
        contentType: "text/css; charset=utf-8"
      },
      "http://127.0.0.1:3000/_next/static/chunks/app.js": {
        body: "self.webpackChunk_N_E = self.webpackChunk_N_E || [];",
        contentType: "application/javascript; charset=utf-8"
      }
    });

    const result = await verifyNextAssets("http://127.0.0.1:3000/", { fetchImpl: fetchStub });

    expect(result).toMatchObject({ cssCount: 1, javascriptCount: 1, assetCount: 2 });
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it("rejects a referenced asset that returns 404", async () => {
    const fetchStub = createFetchStub({
      "http://127.0.0.1:3000/": {
        body:
          '<link rel="stylesheet" href="/_next/static/css/missing.css">' +
          '<script src="/_next/static/chunks/app.js"></script>',
        contentType: "text/html"
      },
      "http://127.0.0.1:3000/_next/static/css/missing.css": {
        body: "not found",
        contentType: "text/plain",
        status: 404
      },
      "http://127.0.0.1:3000/_next/static/chunks/app.js": {
        body: "console.log('ready');",
        contentType: "text/javascript"
      }
    });

    await expect(
      verifyNextAssets("http://127.0.0.1:3000/", { fetchImpl: fetchStub })
    ).rejects.toThrow("CSS asset http://127.0.0.1:3000/_next/static/css/missing.css returned HTTP 404");
  });

  it("rejects a homepage redirect without fetching assets from the redirect target", async () => {
    const fetchStub = vi.fn(async () => new Response("", {
      status: 302,
      headers: { Location: "https://siyuanjiaxin.com/" }
    }));

    await expect(
      verifyNextAssets("http://127.0.0.1:3001/", { fetchImpl: fetchStub })
    ).rejects.toThrow("returned HTTP 302");

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/",
      expect.objectContaining({ redirect: "error" })
    );
  });

  it("rejects an asset served with the wrong MIME type", async () => {
    const fetchStub = createFetchStub({
      "http://127.0.0.1:3000/": {
        body:
          '<link rel="stylesheet" href="/_next/static/css/app.css">' +
          '<script src="/_next/static/chunks/app.js"></script>',
        contentType: "text/html"
      },
      "http://127.0.0.1:3000/_next/static/css/app.css": {
        body: "<!doctype html><title>fallback</title>",
        contentType: "text/html; charset=utf-8"
      },
      "http://127.0.0.1:3000/_next/static/chunks/app.js": {
        body: "console.log('ready');",
        contentType: "application/javascript"
      }
    });

    await expect(
      verifyNextAssets("http://127.0.0.1:3000/", { fetchImpl: fetchStub })
    ).rejects.toThrow(
      "CSS asset http://127.0.0.1:3000/_next/static/css/app.css returned MIME text/html; expected text/css"
    );
  });
});
