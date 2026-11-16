import { describe, expect, it, vi } from "vitest";
import { getDecisionCatalog, getCoverageProfiles } from "@/lib/competitions/v6/catalog";
import { catalogContentDigest, hasDualAiReview } from "@/lib/competitions/v6/catalog-review";
import { selectPublishedDecisionRecords } from "@/lib/competitions/v6/published-records";
import { getPublishedDecisionRecords } from "@/lib/competitions/v6/public-catalog";
import { buildDecisionContext, buildRuleDecisionReport, buildRuleMatchPlan, assembleDecisionReport, selectUsefulQuestions } from "@/lib/competitions/v6/engine";
import { runDecisionRecommendation } from "@/lib/competitions/v6/model";
import { validateDecisionReport } from "@/lib/competitions/v6/validation";
import { decisionReportSchema } from "@/lib/competitions/v6/contracts";
import { evaluateCoverage } from "../../../scripts/competitions/v6/evaluate-coverage";
import { student, syntheticRecord } from "./decision-fixtures";

// Intentionally no publication or ledger mock: all authority is the real canonical dependency.
const now = new Date("2026-11-06T00:00:00Z");
const unpublished = () => getDecisionCatalog().find(r => r.seriesId === "asme-sme-manufacturing-design")!;
const approved = () => getPublishedDecisionRecords()[0];
function selfSign(record: ReturnType<typeof approved>) {
  record.review.policy = "ai_dual_review"; record.review.authorAgentId = "untrusted-snapshot-author";
  record.review.aiReviews = ["A", "B"].map(id => ({ reviewerId: `untrusted-${id}`, runId: `untrusted-run-${id}`, model: "synthetic-only",
    reviewedAt: now.toISOString(), contentDigest: catalogContentDigest(record), method: "independent_source_recheck", sourceIds: record.sources.map(s => s.id), evidenceArtifact: "synthetic-self-signed", checks: { factualSupport: true, entityScope: true, studentUsefulness: true, temporalAccuracy: true }, outcome: "approved", findings: [] }));
}
describe("canonical publication at every recommendation entry", () => {
  it("removes the real ASME/SME leak while retaining the full catalog audit", () => {
    const context = buildDecisionContext(student(), { now }); const published = new Set(getPublishedDecisionRecords().map(r => r.recordId));
    expect(context.candidates.length).toBeGreaterThan(0);
    expect(context.candidates.every(c => published.has(c.record.recordId))).toBe(true);
    expect(context.candidates.some(c => c.record.recordId === unpublished().recordId)).toBe(false);
    const report = buildRuleDecisionReport(student(), { now });
    expect(report.candidateAudit).toHaveLength(context.records.length);
    expect(report.candidateAudit.find(r => r.recordId === unpublished().recordId)?.status).toBe("content_pending");
    expect(report.recommendations.every(r => published.has(r.itemId))).toBe(true);
    expect(validateDecisionReport(report, context).ok).toBe(true);
  }, 20_000); // Full real catalog under concurrent suites; production latency is measured separately.
  it("applies identical publication to default and supplied frozen catalogs", () => {
    const records = structuredClone(getDecisionCatalog());
    const fromDefault = buildDecisionContext(student(), { now }); const supplied = buildDecisionContext(student(), { now, records });
    expect(supplied.candidates.map(c => c.record.recordId)).toEqual(fromDefault.candidates.map(c => c.record.recordId));
    expect(selectPublishedDecisionRecords(records).map(r => r.recordId).sort()).toEqual(getPublishedDecisionRecords().map(r => r.recordId).sort());
  });
  it("rejects forged productionReady plus formally valid embedded double approval", () => {
    const r = unpublished(); r.publication.productionReady = true; r.contentTier = "L3"; selfSign(r);
    expect(hasDualAiReview(r)).toBe(true);
    expect(selectPublishedDecisionRecords([r])).toEqual([]);
    expect(buildDecisionContext(student(), { now, records: [r] }).candidates).toEqual([]);
  });
  it("rejects changed approved content even after recomputing embedded reviews", () => {
    const r = approved(); r.summary += " Unauthorized changed rule."; selfSign(r);
    expect(hasDualAiReview(r)).toBe(true); expect(selectPublishedDecisionRecords([r])).toEqual([]);
  });
  it("rejects caller-only publication and tier mutations without changing a content digest", () => {
    const r = approved(), digest = catalogContentDigest(r); r.contentTier = "L2";
    expect(catalogContentDigest(r)).toBe(digest); expect(selectPublishedDecisionRecords([r])).toEqual([]);
    const draft = unpublished(); const original = catalogContentDigest(draft); draft.publication.productionReady = true;
    expect(catalogContentDigest(draft)).toBe(original); expect(selectPublishedDecisionRecords([draft])).toEqual([]);
    const mode = approved(); mode.publication.mode = "discovery_only";
    expect(selectPublishedDecisionRecords([mode])).toEqual([]);
  });
  it("does not accept a synthetic record absent from canonical publication", () => {
    const r = syntheticRecord(992); r.publication.productionReady = true; selfSign(r);
    expect(selectPublishedDecisionRecords([r])).toEqual([]);
  });
  it("keeps an unpublished sibling content_pending when an approved track is selected", () => {
    const records = getDecisionCatalog(), allowed = selectPublishedDecisionRecords(records);
    const good = allowed.find(r => records.some(s => s.seriesId === r.seriesId && s.recordId !== r.recordId && !s.publication.productionReady))!;
    const sibling = records.find(s => s.seriesId === good.seriesId && s.recordId !== good.recordId && !s.publication.productionReady)!;
    const context = buildDecisionContext(student(), { now, records: [good, sibling] });
    expect(context.candidates).toHaveLength(1);
    const report = assembleDecisionReport(context, buildRuleMatchPlan(context));
    expect(report.recommendations).toHaveLength(1); expect(report.shortlistShortfallReason).toBeTruthy();
    expect(report.candidateAudit.find(r => r.recordId === good.recordId)?.status).toBe("selected");
    expect(report.candidateAudit.find(r => r.recordId === sibling.recordId)?.status).toBe("content_pending");
    expect(validateDecisionReport(report, context).ok).toBe(true);
    report.candidateAudit[1].status = "selected";
    expect(validateDecisionReport(report, context).issues).toContain("audit_record_status_mismatch");
  });
  it("rechecks reused model, ranking and counterfactual contexts before selecting", async () => {
    const r = unpublished(); const context = buildDecisionContext(student(), { now, records: [r] });
    context.candidates.push({ record: r, score: null, eligibility: "unknown", conditions: [], relevant: true });
    expect(buildRuleMatchPlan(context).recommendations).toEqual([]);
    expect(selectUsefulQuestions(context)).toEqual([]);
    expect(() => assembleDecisionReport(context, { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, recommendations: [{ itemId: r.recordId, reasons: [] }], shortfallReason: null })).toThrow("Unknown decision candidate");
    const modelCall = vi.fn(async () => { throw Error("unpublished context reached a model"); });
    const report = await runDecisionRecommendation(student(), { now, context, method: "llm", modelCall });
    expect(modelCall).not.toHaveBeenCalled(); expect(report.recommendations).toEqual([]);
  });
  it("keeps evaluation candidates under the same boundary", () => {
    const result = evaluateCoverage({ now, records: [unpublished()], profiles: [getCoverageProfiles()[0]] });
    expect(result.results[0].nonConflictingCandidateSeries).toEqual([]);
    expect(result.results[0].candidateAssessments).toEqual([]);
  });
  it("checks exact audit identity while still parsing historical reports without recordId", () => {
    const context = buildDecisionContext(student(), { now }), report = buildRuleDecisionReport(student(), { now });
    const historical = structuredClone(report); historical.candidateAudit.forEach(item => { delete item.recordId; });
    expect(decisionReportSchema.safeParse(historical).success).toBe(true);
    report.candidateAudit[0].seriesId = "wrong-series";
    expect(validateDecisionReport(report, context).issues).toContain("audit_record_identity_mismatch");
  });
});
