import { describe, expect, it } from "vitest";
import { competitions } from "@/content/competitions";
import { getCatalogSummary, getDecisionCatalog, getDecisionRecord, getDecisionRecordsForSeries } from "@/lib/competitions/v6/catalog";
import { catalogContentDigest, hasDualAiReview } from "@/lib/competitions/v6/catalog-review";
import { sourceDate } from "@/lib/competitions/v6/catalog-identity";
import { validateDecisionRecord } from "@/lib/competitions/v6/catalog-validation";
import type { CatalogAiReview } from "@/lib/competitions/v6/catalog-types";

describe("multi-edition content and authorized AI review policy", () => {
  it("preserves every original track exactly without counting tracks as new series", () => {
    for (const competition of competitions) for (const track of competition.recommendation.tracks ?? []) {
      const records = getDecisionRecordsForSeries(competition.id);
      expect(records.some(record => record.track.id === track.id && JSON.stringify(record.migration.legacyTrack) === JSON.stringify(track))).toBe(true);
    }
    expect(getCatalogSummary().legacyTrackCount).toBe(106);
    expect(getCatalogSummary().migratedLegacyTrackCount).toBe(106);
    expect(new Set(getDecisionCatalog().map(record => record.recordId)).size).toBe(getDecisionCatalog().length);
  });

  it("retains precise identity and old deep links while preserving missing date precision", () => {
    const record = getDecisionRecord("national-advertising-art:graphic:v2")!;
    expect(record.recordId).toContain(record.identity!.editionId);
    expect(record.recordId).toContain(record.identity!.scopeId);
    expect(sourceDate("2027-03")).toEqual({ raw: "2027-03", value: "2027-03", precision: "month", timezone: null });
    expect(sourceDate(null).value).toBeNull();
    expect(getDecisionRecord("lanqiao-cup")!.facts.filter(f => f.id.includes(":v2:")).every(f => f.status !== "verified_current")).toBe(true);
  });

  it("requires two independent source rechecks tied to unmodified content", () => {
    const record = getDecisionRecord("apple-swift-student-challenge")!;
    record.review.aiReviews = [];
    const review: CatalogAiReview = { runId: "test-only-run-1", reviewerId: "test-only-reviewer-1", model: "test-fixture", reviewedAt: "2026-11-05T12:00:00Z", contentDigest: catalogContentDigest(record), method: "independent_source_recheck", sourceIds: record.sources.map(s => s.id), evidenceArtifact: "test-fixture-only", checks: { factualSupport: true, entityScope: true, studentUsefulness: true, temporalAccuracy: true }, outcome: "approved", findings: [] };
    record.review.aiReviews = [review, { ...review, runId: "test-only-run-2" }];
    expect(hasDualAiReview(record)).toBe(false);
    record.review.aiReviews[1].reviewerId = "test-only-reviewer-2";
    expect(hasDualAiReview(record)).toBe(true);
    expect(validateDecisionRecord(record).issues.some(issue => issue.code === "ai_review_pending")).toBe(false);
    expect(record.review.humanReview?.status).toBe("not_performed");
    record.sections.deliverables[0].text += "新增未审核的要求。";
    expect(hasDualAiReview(record)).toBe(false);
    expect(validateDecisionRecord(record).issues.some(issue => issue.code === "ai_review_pending")).toBe(true);
  });

  it("does not approve an unresolved review finding or an unverified original source", () => {
    const record = getDecisionRecord("apple-swift-student-challenge")!;
    record.sources[0].integrity = "requires_recheck";
    expect(validateDecisionRecord(record).tier).toBe("L1");
  });

  it("revokes stale approvals on a later adverse recheck and keeps unresolved third-party dissent blocking", () => {
    const record = getDecisionRecord("apple-swift-student-challenge")!;
    const review: CatalogAiReview = { runId: "test-run-a", reviewerId: "review-a", model: "test-fixture", reviewedAt: "2026-11-05T12:00:00Z", contentDigest: catalogContentDigest(record), method: "independent_source_recheck", sourceIds: record.sources.map(s => s.id), evidenceArtifact: "test-fixture-only", checks: { factualSupport: true, entityScope: true, studentUsefulness: true, temporalAccuracy: true }, outcome: "approved", findings: [] };
    record.review.aiReviews = [review, { ...review, runId: "test-run-b", reviewerId: "review-b" }];
    expect(hasDualAiReview(record)).toBe(true);
    record.review.aiReviews.push({ ...review, runId: "test-run-a2", reviewedAt: "2026-11-05T13:00:00Z", outcome: "changes_requested" });
    expect(hasDualAiReview(record)).toBe(false);
    record.review.aiReviews.reverse();
    expect(hasDualAiReview(record)).toBe(false);
    record.review.aiReviews.push({ ...review, runId: "test-run-a3", reviewedAt: "2026-11-05T14:00:00Z" });
    expect(hasDualAiReview(record)).toBe(true);
    record.review.aiReviews.push({ ...review, runId: "test-run-c", reviewerId: "review-c", outcome: "changes_requested" });
    expect(hasDualAiReview(record)).toBe(false);
    record.review.aiReviews.push({ ...review, runId: "test-run-c2", reviewerId: "review-c" });
    expect(hasDualAiReview(record)).toBe(false); // conflicting equal-time verdicts
  });
});
