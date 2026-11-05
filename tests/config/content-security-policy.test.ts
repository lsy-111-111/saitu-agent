import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "@/middleware";
import { createContentSecurityPolicy } from "@/lib/security/content-security-policy";

function extractNonce(policy: string) {
  const match = policy.match(/'nonce-([^']+)'/);
  if (!match) {
    throw new TypeError("CSP is missing a nonce source");
  }
  return match[1];
}

describe("nonce Content Security Policy", () => {
  it("does not let prefetch headers bypass the HTML CSP middleware", () => {
    expect(config.matcher[0]).toEqual(expect.objectContaining({ source: expect.any(String) }));
    expect(config.matcher[0]).not.toHaveProperty("missing");
  });

  it("rejects cached thumbnails from the retired certificate gallery", () => {
    expect(config.matcher[1]).toMatchObject({
      source: "/_next/image",
      has: [{ type: "query", key: "url", value: "/competition-gallery/.*" }]
    });
    const response = middleware(new NextRequest("https://siyuanjiaxin.com/_next/image?url=%2Fcompetition-gallery%2Fproject-result-01.jpg&w=640&q=75"));
    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("covers HTML 404s behind API-looking and metadata-looking prefixes", () => {
    const matcher = new RegExp(`^${config.matcher[0].source}$`, "u");

    for (const path of [
      "/api/does-not-exist",
      "/apiary",
      "/robots.txtfoo",
      "/.well-known/security.txtfoo",
      "/_next/imagefoo"
    ]) {
      expect(matcher.test(path), path).toBe(true);
    }

    for (const path of [
      "/_next/static/chunks/app.js",
      "/_next/image",
      "/_next/image/source",
      "/favicon.ico",
      "/icon.png"
    ]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });

  it("never permits inline or evaluated production scripts", () => {
    const policy = createContentSecurityPolicy("test-nonce", "production");
    const scriptDirective = policy
      .split(";")
      .find((directive) => directive.trim().startsWith("script-src"));

    expect(scriptDirective).toContain("'nonce-test-nonce'");
    expect(scriptDirective).toContain("'strict-dynamic'");
    expect(scriptDirective).not.toContain("'unsafe-inline'");
    expect(scriptDirective).not.toContain("'unsafe-eval'");
  });

  it("allows eval only for React's development diagnostics", () => {
    const production = createContentSecurityPolicy("nonce", "production");
    const development = createContentSecurityPolicy("nonce", "development");

    expect(production).not.toContain("script-src 'self' 'nonce-nonce' 'strict-dynamic' 'unsafe-eval'");
    expect(development).toContain("script-src 'self' 'nonce-nonce' 'strict-dynamic' 'unsafe-eval'");
  });

  it("generates a fresh nonce and forwards the same CSP into rendering", () => {
    const first = middleware(new NextRequest("https://siyuanjiaxin.com/"));
    const second = middleware(new NextRequest("https://siyuanjiaxin.com/competitions"));
    const firstPolicy = first.headers.get("Content-Security-Policy");
    const secondPolicy = second.headers.get("Content-Security-Policy");

    expect(firstPolicy).toBeTruthy();
    expect(secondPolicy).toBeTruthy();

    const firstNonce = extractNonce(firstPolicy!);
    const secondNonce = extractNonce(secondPolicy!);

    expect(firstNonce).not.toBe(secondNonce);
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(firstNonce);
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(
      firstPolicy
    );
  });
});
