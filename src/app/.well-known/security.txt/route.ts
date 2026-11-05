import { site } from "@/content/site";

const securityTextExpiresAt = "2027-08-26T00:00:00.000Z";

export function GET() {
  const canonicalUrl = new URL("/.well-known/security.txt", site.seoBaseUrl).toString();
  const policyUrl = new URL("/privacy", site.seoBaseUrl).toString();
  const body = [
    `Contact: mailto:${site.contactEmail}`,
    `Expires: ${securityTextExpiresAt}`,
    `Canonical: ${canonicalUrl}`,
    `Policy: ${policyUrl}`,
    "Preferred-Languages: zh-CN, en",
    ""
  ].join("\n");

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
