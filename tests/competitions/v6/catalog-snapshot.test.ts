import { describe, expect, it } from "vitest";
import { getDecisionRecord } from "@/lib/competitions/v6/catalog";
import { checkSnapshot, snapshotDigest, type CatalogSnapshot } from "@/lib/competitions/v6/catalog-snapshot";

describe("immutable content publication snapshots", () => {
  it("does not publish author content through forged readiness flags", () => {
    const record = getDecisionRecord("international-mathematics-competition")!;
    record.contentTier = "L3";
    record.publication.productionReady = true;
    record.review.aiReviews = [];
    // Make the tested content gap explicit. The real archive may legitimately
    // gain a complete deep dive after independent source review.
    record.deepDive!.missingForPublication = ["合成测试缺口：代表任务分析尚未完成"];
    const snapshot: CatalogSnapshot = { schemaVersion: "saitu.catalog-snapshot.v1", snapshotId: "test-only", createdAt: "2026-11-05T12:00:00Z", policy: "ai_dual_review", records: [record], digest: snapshotDigest([record]) };
    const result = checkSnapshot(snapshot, [record]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`review_required:${record.recordId}`);
    expect(result.errors).toContain(`deep_content_incomplete:${record.recordId}`);
  });
  it("detects byte-equivalent content tampering and requires explicit rollback to remove records", () => {
    const record = getDecisionRecord("international-mathematics-competition")!;
    const snapshot: CatalogSnapshot = { schemaVersion: "saitu.catalog-snapshot.v1", snapshotId: "test-only", createdAt: "2026-11-05T12:00:00Z", policy: "ai_dual_review", records: [], digest: snapshotDigest([record]) };
    const result = checkSnapshot(snapshot, [record]);
    expect(result.errors).toContain("snapshot_digest_mismatch");
    expect(result.errors).toContain(`record_removed:${record.recordId}`);
    expect(checkSnapshot(snapshot, [record], new Date(), true).errors).not.toContain(`record_removed:${record.recordId}`);
  });
});
