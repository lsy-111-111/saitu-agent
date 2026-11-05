import { expect, test } from "@playwright/test";

const html404Paths = [
  "/api/does-not-exist",
  "/apiary",
  "/robots.txtfoo",
  "/.well-known/security.txtfoo",
  "/_next/imagefoo"
] as const;

for (const path of html404Paths) {
  test(`nonce CSP protects HTML 404 response at ${path}`, async ({ request }) => {
    const response = await request.get(path, {
      headers: { Accept: "text/html" }
    });
    const contentType = response.headers()["content-type"] ?? "";
    const policy = response.headers()["content-security-policy"] ?? "";
    const body = await response.text();
    const nonce = policy.match(/'nonce-([^']+)'/u)?.[1];
    const scriptPolicy = policy
      .split(";")
      .find((directive) => directive.trim().startsWith("script-src"));

    expect(response.status()).toBe(404);
    expect(contentType).toContain("text/html");
    expect(nonce).toBeTruthy();
    expect(scriptPolicy).toBeTruthy();
    expect(scriptPolicy).not.toContain("'unsafe-inline'");
    expect(scriptPolicy).not.toContain("'unsafe-eval'");

    const scripts = [...body.matchAll(/<script\b([^>]*)>/giu)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attributes] of scripts) {
      expect(attributes).toMatch(new RegExp(`\\bnonce=["']${nonce}["']`, "u"));
    }
  });
}
