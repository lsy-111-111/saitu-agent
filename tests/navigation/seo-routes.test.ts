import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { serializeJsonLd } from "@/lib/seo/structured-data";

describe("public route indexing", () => {
  it("indexes the catalog and about, excluding retired resources and the team contact page", () => {
    const paths = sitemap().map((entry) => new URL(entry.url).pathname);

    expect(paths).not.toContain("/resources");
    expect(paths).toContain("/about");
    expect(paths).toContain("/competitions/exploration-geophysics");
    expect(paths).toContain("/competitions/chemistry-experiment-innovation");
    expect(paths).not.toContain("/teams");
    expect(paths).not.toContain("/competitions/saved");
  });

  it("allows crawlers to read route-level noindex while disallowing APIs", () => {
    const rules = robots().rules;
    expect(Array.isArray(rules)).toBe(false);
    if (!Array.isArray(rules)) {
      expect(rules.disallow).toEqual(["/api/"]);
      expect(rules.disallow).not.toEqual(expect.arrayContaining(["/competitions/recommend", "/teams"]));
    }
  });

  it("serializes JSON-LD without allowing a script-closing sequence", () => {
    const serialized = serializeJsonLd({
      value: "</script><script>alert(1)</script>&\u2028\u2029"
    });

    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain(">");
    expect(serialized).not.toContain("&");
    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
    expect(JSON.parse(serialized)).toEqual({
      value: "</script><script>alert(1)</script>&\u2028\u2029"
    });
  });
});
