import { describe, expect, it } from "vitest";
import { competitions } from "@/content/competitions";
import { getCatalogSummary, getCoverageProfiles, getDecisionCatalog, getDecisionRecord, getExpansionCandidates } from "@/lib/competitions/v6/catalog";
import { createCatalogChangeProposal, validateCatalogSnapshot, validateDecisionRecord } from "@/lib/competitions/v6/catalog-validation";
import { hasDualAiReview, hasHumanReview } from "@/lib/competitions/v6/catalog-review";
import { TASK_FAMILIES } from "@/lib/competitions/v6/catalog-types";

const now = new Date("2026-11-05T16:00:00+08:00");
const fixture = () => getDecisionCatalog().find(record => record.seriesId === "national-advertising-art" && record.pilot)!;

describe("v3 decision catalog migration and content gates", () => {
  it("preserves all legacy series, returns 10 pilots, and never invents human sign-off", () => {
    const records = getDecisionCatalog();
    expect(records.length).toBeGreaterThanOrEqual(155);
    const series = new Set(records.map(record => record.seriesId));
    expect(competitions).toHaveLength(135);
    expect(series.size).toBeGreaterThanOrEqual(155);
    expect(getCatalogSummary().verifiedExpansionCount).toBeGreaterThanOrEqual(20);
    expect(competitions.every(item => series.has(item.id))).toBe(true);
    expect(records.filter(record => record.migration.origin === "legacy_135").every(record => competitions.some(item => item.id === record.seriesId))).toBe(true);
    expect(records.filter(record => record.pilot)).toHaveLength(10);
    expect(records.filter(record => record.deepDive)).toHaveLength(records.filter(record => record.deepDive?.status === "draft" || record.deepDive?.status === "reviewed").length);
    expect(records.filter(record => record.deepDive).length).toBeGreaterThanOrEqual(3);
    expect(records.every(record => !hasHumanReview(record) && record.review.humanReview?.status === "not_performed")).toBe(true);
    for (const record of records) {
      if (record.review.status === "ai_dual_reviewed") expect(hasDualAiReview(record)).toBe(true);
      if (record.publication.productionReady) expect(hasDualAiReview(record)).toBe(true);
      if (record.contentTier === "L3") {
        expect(hasDualAiReview(record)).toBe(true);
        expect(record.deepDive?.missingForPublication).toEqual([]);
      }
    }
    expect(records.filter(record => record.contentTier === "L2").length).toBeGreaterThanOrEqual(4);
    expect(validateCatalogSnapshot(records, now).valid).toBe(true);
  });

  it("keeps content quality separate from pending publication review", () => {
    const result = validateDecisionRecord(fixture(), now);
    expect(result.tier).toBe("L2");
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "ai_review_pending", blocks: "publication" }));
    expect(result.recommendationMode).toBe("decision_ready");
  });

  it("cannot promote empty modules by assigning L3", () => {
    const record = fixture();
    record.contentTier = "L3";
    record.sections.deliverables = [];
    expect(validateDecisionRecord(record, now).tier).toBe("L1");
  });

  it("rejects all-unknown core content and all-unknown value", () => {
    const record = fixture();
    record.sections.eligibility = [{ text: "当届资格尚未读取原文，因此暂时不能确认。", kind: "unknown", factIds: [], conditions: [], unknownReason: "原始规则没有取得，等待补充适用通知。" }];
    record.valueDimensions.forEach(value => { value.evidenceLevel = "unknown"; value.assessment.kind = "unknown"; });
    const result = validateDecisionRecord(record, now);
    expect(result.tier).toBe("L1");
    expect(result.issues.map(item => item.code)).toEqual(expect.arrayContaining(["unknown_core_module", "all_value_unknown"]));
  });

  it("requires six distinct value dimensions and three distinct difficulty stages", () => {
    const record = fixture();
    record.valueDimensions[1].dimension = record.valueDimensions[0].dimension;
    record.difficulty[2].stage = record.difficulty[1].stage;
    const result = validateDecisionRecord(record, now);
    expect(result.issues.map(item => item.code)).toEqual(expect.arrayContaining(["value_dimensions_not_unique", "difficulty_stages_not_unique"]));
  });

  it("rejects unsupported facts, metadata-only sources and missing references", () => {
    const record = fixture();
    record.sources.find(source => source.id === "advertising-guide-2026")!.accessStatus = "metadata_only";
    record.sections.eligibility[0].factIds.push("invented-fact");
    const result = validateDecisionRecord(record, now);
    expect(result.tier).toBe("L1");
    expect(result.issues.map(item => item.code)).toEqual(expect.arrayContaining(["dangling_fact", "unsupported_claim"]));
  });

  it("keeps unresolved critical conflicts below L2", () => {
    const record = fixture();
    record.facts.find(fact => fact.id.endsWith(":v2:eligibility"))!.status = "conflicting";
    expect(validateDecisionRecord(record, now).tier).toBe("L1");
  });

  it("does not label an old or unsupported registration as current", () => {
    const record = fixture();
    record.registration = { status: "open", checkedAt: "2026-10-01", factIds: [record.facts.find(fact => fact.id.endsWith(":v2:eligibility"))!.id], note: "测试不应通过" };
    expect(validateDecisionRecord(record, now).currentRegistrationVerified).toBe(false);
    expect(getDecisionCatalog().some(item => item.registration.status === "open")).toBe(false);
  });

  it("does not interpret a per-person fee as guaranteed personal expenditure", () => {
    expect(getDecisionRecord("lanqiao-cup")!.cost?.minimumPersonalCny).toBeNull();
    expect(getDecisionRecord("chinese-classics")!.cost?.maximumPersonalCny).toBeNull();
    const record = fixture();
    record.cost = { minimumPersonalCny: 100, maximumPersonalCny: 80, factIds: [], scope: record.scope, note: "测试无来源费用" };
    expect(validateDecisionRecord(record, now).issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["invalid_cost_range", "unsupported_cost"]));
  });

  it("returns independent copies and stable series/record lookups", () => {
    const record = fixture();
    const id = record.recordId;
    record.name = "changed";
    expect(getDecisionRecord(id)!.name).not.toBe("changed");
    expect(getDecisionRecord("missing")).toBeUndefined();
  });

  it("binds the math undergraduate pilot to its exact existing group, never its vocational sibling", () => {
    const record = getDecisionRecord("national-college-math-modeling")!;
    const legacy = competitions.find(item => item.id === record.seriesId)!;
    expect(record.track.id).toBe("undergraduate-group");
    expect(legacy.recommendation.tracks?.find(track => track.id === record.track.id)?.label).toBe("本科组");
    expect(record.track.id).not.toBe("vocational-group");
    expect(getDecisionRecord("national-college-electronic-design")!).toMatchObject({ track: { id: "main" }, edition: "2025全国主赛（历史届次）", contentTier: "L2" });
  });

  it("defines the agreed four experience/team/budget combinations per task and four stress cases", () => {
    const profiles = getCoverageProfiles();
    expect(profiles).toHaveLength(40);
    expect(new Set(profiles.map(profile => profile.id)).size).toBe(40);
    for (const family of TASK_FAMILIES) {
      const core = profiles.filter(profile => profile.kind === "core" && profile.taskFamily === family);
      expect(core.map(profile => `${profile.experience}/${profile.team}/${profile.budgetCny}`).sort()).toEqual(["beginner/can_form/1000", "beginner/none/300", "coursework/can_form/300", "coursework/none/1000"]);
      expect(core.every(profile => profile.resourceAssumptions?.length && !profile.mentor && !profile.laboratory)).toBe(true);
    }
    expect(profiles.filter(profile => profile.kind === "special")).toHaveLength(4);
    expect(profiles.every(profile => profile.evidence.length && profile.constraints.length && profile.expectedBehavior.length)).toBe(true);
  });

  it("adds original physics deliverables and source-bounded real deep examples without fake L3", () => {
    const physics = getDecisionRecord("physics-experiment-innovation")!;
    expect(physics.contentTier).toBe("L2");
    expect(physics.sections.deliverables[0].text).toContain("16—20分钟");
    expect(physics.sources.find(source => source.id === "physics-teaching-2026")?.authority).toBe("official_host");
    for (const id of ["china-college-computer-design", "market-research-analysis", "national-advertising-art"]) {
      const record = getDecisionRecord(id)!;
      expect(record.deepDive?.workedExample.sourceIds.length).toBeGreaterThan(0);
      expect(record.deepDive?.workedExample.sourceBoundary).toBeTruthy();
      expect(record.deepDive?.missingForPublication.length).toBeGreaterThan(0);
      expect(record.contentTier).toBe("L2");
    }
    const summary = getDecisionRecord("market-research-analysis")!;
    summary.deepDive!.status = "reviewed";
    summary.deepDive!.missingForPublication = [];
    expect(validateDecisionRecord(summary, now).tier).toBe("L2");
  });

  it("distinguishes the original 20 priority candidates from all published expansion series", () => {
    const candidates = getExpansionCandidates();
    expect(candidates).toHaveLength(20);
    expect(new Set(candidates.map(candidate => candidate.id)).size).toBe(20);
    expect(candidates.every(candidate => candidate.checkedAt && candidate.blockers.length > 0)).toBe(true);
    const reviewedSeries = new Set(getDecisionCatalog().filter(record => record.publication.productionReady && hasDualAiReview(record)).map(record => record.seriesId));
    const expected = candidates.filter(candidate => candidate.existingSeriesId && reviewedSeries.has(candidate.existingSeriesId) && candidate.verificationStatus === "verified");
    expect(candidates.filter(candidate => candidate.publishable).map(candidate => candidate.id)).toEqual(expected.map(candidate => candidate.id));
    // D&AD can appear in two editions; its current reviewed-series membership is counted only once.
    expect(candidates.find(candidate=>candidate.id==="C065")?.publishable).toBe(reviewedSeries.has("dandad-new-blood"));
    expect(getCatalogSummary().priorityCandidates).toMatchObject({ total: 20, mapped: 14, unmapped: 6, structuralL2OrL3: 14, published: expected.length });
    for (const candidate of candidates.filter(candidate => candidate.publishable)) {
      expect(candidate.verificationStatus).toBe("verified");
      expect(getDecisionCatalog().some(record => record.seriesId === candidate.existingSeriesId && record.publication.productionReady && hasDualAiReview(record))).toBe(true);
    }
    const published = getDecisionCatalog().filter(record => record.migration.origin === "verified_expansion" && record.publication.productionReady);
    expect(getCatalogSummary().seriesCount).toBeGreaterThanOrEqual(135);
    expect(getCatalogSummary().publishedExpansionCount).toBe(new Set(published.map(record => record.seriesId)).size);
    expect(published.every(hasDualAiReview)).toBe(true);
  });

  it("queues critical changes without modifying the record or fabricating review", () => {
    const before = fixture();
    const proposal = createCatalogChangeProposal({ id: "proposal-1", recordId: before.recordId, sourceId: before.sources[0].id, createdAt: now.toISOString(), field: "sections.eligibility", previousValue: before.sections.eligibility, proposedValue: [], reason: "来源变更待核实" });
    expect(proposal).toMatchObject({ risk: "critical", status: "pending_review", reviewerId: null, reviewedAt: null });
    expect(fixture()).toEqual(before);
    expect(() => createCatalogChangeProposal({ ...proposal, field: "__proto__.polluted" })).toThrow();
  });
});
