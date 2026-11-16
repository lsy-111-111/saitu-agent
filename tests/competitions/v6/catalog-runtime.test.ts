import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAuthoredDecisionCatalog, getDecisionCatalog, getDecisionRecord, getCatalogSummary } from "@/lib/competitions/v6/catalog";
import { withCatalogSnapshotPath } from "@/lib/competitions/v6/catalog-runtime";
import { checkSnapshot, snapshotDigest, type CatalogSnapshot } from "@/lib/competitions/v6/catalog-snapshot";
import { catalogContentDigest } from "@/lib/competitions/v6/catalog-review";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

/** Synthetic approvals exist only in a temporary test file, never in the author ledger. */
function fixture(version: string): CatalogSnapshot {
  const record = getAuthoredDecisionCatalog().find(record => record.seriesId === "atcoder-beginner-contest")!;
  record.catalogVersion = version;
  record.targetTier = "L2";
  // This fixture deliberately removes L3 content; the copied production
  // record's previously audited tier must not survive that transformation.
  record.contentTier = "L2";
  delete record.deepDive;
  record.review.aiReviews = [1, 2].map(i => ({ runId: `test-only-run-${i}`, reviewerId: `test-only-reviewer-${i}`,
    model: "synthetic-test-fixture", reviewedAt: "2026-11-05T12:00:00Z", method: "independent_source_recheck", outcome: "approved",
    contentDigest: catalogContentDigest(record), sourceIds: record.sources.map(source => source.id), evidenceArtifact: "test-fixture-only-not-real-review",
    checks: { factualSupport: true, entityScope: true, studentUsefulness: true, temporalAccuracy: true }, findings: [] }));
  const records = [record];
  return { schemaVersion: "saitu.catalog-snapshot.v1", snapshotId: version, createdAt: "2026-11-05T12:00:00Z", policy: "ai_dual_review", digest: snapshotDigest(records), records };
}
function file(snapshot: CatalogSnapshot) {
  const directory = mkdtempSync(join(tmpdir(), "saitu-runtime-test-")); directories.push(directory);
  const path = join(directory, "active.json"); writeFileSync(path, JSON.stringify(snapshot)); return path;
}

describe("real runtime catalog file boundary", () => {
  it("observes an atomic approved file switch in the same process and returns isolated records", () => {
    const first = fixture("fixture-v1"), next = fixture("fixture-v2");
    expect(checkSnapshot(first, [], new Date("2026-11-05T12:00:00Z")).errors).toEqual([]);
    const path = file(first);
    withCatalogSnapshotPath(path, () => {
      expect(getCatalogSummary().catalogVersion).toBe("fixture-v1");
      const before = getDecisionCatalog(); before[0].name = "caller mutation";
      expect(getDecisionRecord(before[0].recordId)!.name).not.toBe("caller mutation");
      writeFileSync(`${path}.next`, JSON.stringify(next)); renameSync(`${path}.next`, path);
      expect(getCatalogSummary().catalogVersion).toBe("fixture-v2");
      expect(getDecisionCatalog()[0].catalogVersion).toBe("fixture-v2");
    });
  });
  it("rejects changed unreviewed content, corrupted bytes and missing files rather than falling back", () => {
    const snapshot = fixture("fixture-v1"), path = file(snapshot);
    withCatalogSnapshotPath(path, () => {
      expect(getDecisionCatalog()).toHaveLength(1);
      snapshot.records[0].sections.deliverables[0].text += "未审新要求";
      snapshot.digest = snapshotDigest(snapshot.records);
      writeFileSync(path, JSON.stringify(snapshot));
      expect(() => getDecisionCatalog()).toThrow(/review_required/);
      writeFileSync(path, "null"); expect(() => getDecisionCatalog()).toThrow(/invalid_snapshot_shape/);
      rmSync(path); expect(() => getDecisionCatalog()).toThrow(/Runtime catalog snapshot rejected/);
    });
  });
  it("keeps concurrent asynchronous snapshot contexts separate", async () => {
    const a = file(fixture("fixture-a")), b = file(fixture("fixture-b"));
    const result = await Promise.all([a, b].map(path => withCatalogSnapshotPath(path, async () => {
      await Promise.resolve(); return getCatalogSummary().catalogVersion;
    })));
    expect(result).toEqual(["fixture-a", "fixture-b"]);
    expect(getDecisionCatalog().length).toBeGreaterThan(1);
  });
});
