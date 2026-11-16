import { describe, expect, it } from "vitest";
// The maintenance CLI deliberately uses Node-native ESM so it works without a build step.
// @ts-expect-error JavaScript CLI is exercised with runtime fixtures.
import { observeSource, proposeSourceChanges } from "../../../scripts/competitions/v6/discover-source-changes.mjs";

describe("source maintenance proposals", () => {
  it("distinguishes a fetched document, a material byte difference and an unavailable source without publishing", async () => {
    const source = { id: "official-page", url: "https://example.org/rules" };
    const first = await observeSource(source, async () => new Response("prior official text"));
    const same = await observeSource(source, async () => new Response("prior official text"));
    const changed = await observeSource(source, async () => new Response("updated official text"));
    const failed = await observeSource(source, async () => new Response("", { status: 503 }));
    expect(proposeSourceChanges([first], [same], {})).toEqual([]);
    expect(proposeSourceChanges([first], [changed], { "official-page": ["series.edition.track"] })[0]).toMatchObject({
      autoPublished: false, status: "pending_review", reason: "document_bytes_changed_not_yet_a_rule_change", recordIds: ["series.edition.track"]
    });
    expect(proposeSourceChanges([first], [failed], {})[0].reason).toBe("source_unavailable_requires_recheck");
    expect(failed.digest).toBeNull();
  });
  it("does not fetch a local URL or store oversized content", async () => {
    const noFetch = async () => { throw new Error("must not fetch"); };
    expect((await observeSource({ id: "x", url: "http://localhost/rules" }, noFetch)).status).toBe("not_checked");
    const result = await observeSource({ id: "x", url: "https://example.org/rules" }, async () => new Response("data", { headers: { "content-length": "2000001" } }));
    expect(result.reason).toBe("document_too_large");
    expect(result.digest).toBeNull();
  });
});
