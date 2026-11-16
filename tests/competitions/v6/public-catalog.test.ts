import { afterEach, describe, expect, it, vi } from "vitest";
import * as catalog from "@/lib/competitions/v6/catalog";
import { decisionRecordHref, getPublishedDecisionRecord, getPublishedDecisionRecords, resolvePublishedDecisionRoute } from "@/lib/competitions/v6/public-catalog";

afterEach(() => vi.restoreAllMocks());

describe("public reviewed competition records", () => {
  it("makes approved new-series records addressable without changing legacy series selection", () => {
    const legacy = catalog.getDecisionRecord("national-college-math-modeling")!;
    const records = getPublishedDecisionRecords();
    const swift = records.find(record => record.seriesId === "apple-swift-student-challenge")!;
    expect(swift).toBeDefined();
    expect(getPublishedDecisionRecord(swift.recordId)?.recordId).toBe(swift.recordId);
    expect(catalog.getDecisionRecord("national-college-math-modeling")?.recordId).toBe(legacy.recordId);
    expect(records.some(record => record.seriesId === legacy.seriesId && record.recordId !== legacy.recordId && record.contentTier === "L3")).toBe(true);
  });

  it("resolves only the exact published edition, never a series or unknown record", () => {
    const record = getPublishedDecisionRecords()[0];
    expect(getPublishedDecisionRecord(record.seriesId)).toBeUndefined();
    expect(getPublishedDecisionRecord(`${record.recordId}:missing`)).toBeUndefined();
    expect(decisionRecordHref(record.recordId)).toBe(`/competitions/records/${encodeURIComponent(record.recordId)}`);
  });

  it("shares the checked core pool even when a legacy full-record publication flag is false", () => {
    const record = getPublishedDecisionRecords()[0];
    record.publication.productionReady = false;
    vi.spyOn(catalog, "getDecisionCatalog").mockReturnValue([record]);
    expect(getPublishedDecisionRecords().map(item => item.recordId)).toEqual([record.recordId]);
    record.summary += "未经独立核查的任务变更";
    expect(getPublishedDecisionRecords()).toEqual([]);
  });

  it("supports direct encoded URLs and decoded navigation without repeated decoding", () => {
    const record = getPublishedDecisionRecords()[0];
    expect(resolvePublishedDecisionRoute(record.recordId)?.recordId).toBe(record.recordId);
    expect(resolvePublishedDecisionRoute(encodeURIComponent(record.recordId))?.recordId).toBe(record.recordId);
    expect(resolvePublishedDecisionRoute(encodeURIComponent(encodeURIComponent(record.recordId)))).toBeUndefined();
    expect(resolvePublishedDecisionRoute("%E0%A4")).toBeUndefined();
  });

  it("rejects changed content and caller self-approval against the canonical ledger", () => {
    const record = getPublishedDecisionRecords()[0];
    record.summary += "未经审查的新规则";
    vi.spyOn(catalog, "getDecisionCatalog").mockReturnValue([record]);
    expect(getPublishedDecisionRecords()).toEqual([]);
    record.recordId = "self-signed-record";
    expect(getPublishedDecisionRecord(record.recordId)).toBeUndefined();
  });

  it("does not use legacy content tiers or review-policy labels as new core-pool gates", () => {
    const record = getPublishedDecisionRecords()[0];
    vi.spyOn(catalog, "getDecisionCatalog").mockReturnValue([record]);
    record.contentTier = "L1";
    expect(getPublishedDecisionRecords()).toHaveLength(1);
    record.contentTier = "L3";
    record.review.policy = undefined;
    expect(getPublishedDecisionRecords()).toHaveLength(1);
    record.sources.forEach(source => source.accessStatus = "unavailable");
    expect(getPublishedDecisionRecords()).toEqual([]);
  });
});
