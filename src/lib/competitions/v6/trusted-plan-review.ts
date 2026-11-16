import ledger from "@/content/competitions-v6/ai-review-ledger.json";
import type { CatalogAiReview, DecisionCompetitionRecord } from "./catalog-types";
import { catalogContentDigest, hasDualAiReview } from "./catalog-review";

/** Canonical imported ledger is the authority, never reviews serialized by a snapshot caller. */
export function trustedPlanReviewRecord(record: DecisionCompetitionRecord): DecisionCompetitionRecord {
  const entries = (ledger as Record<string, CatalogAiReview[]>)[record.recordId] ?? [];
  return { ...record, review: { ...record.review, policy: "ai_dual_review", aiReviews: entries } };
}
export function hasTrustedPlanDualReview(record: DecisionCompetitionRecord): boolean {
  if (record.review.policy !== "ai_dual_review" || !hasDualAiReview(trustedPlanReviewRecord(record))) return false;
  const factIds = new Set<string>();
  const visit = (value: unknown) => { if (value && typeof value === "object") for (const [key, v] of Object.entries(value)) {
    if ((key === "factIds" || key.endsWith("FactIds")) && Array.isArray(v)) { for (const id of v) if (typeof id === "string") factIds.add(id); }
    else if (key === "conclusionFactId" && typeof v === "string") factIds.add(v);
    else visit(v);
  } };
  visit(record.participationPlans);
  const requiredSources = [...new Set([...factIds].flatMap(id => record.facts.find(f => f.id === id)?.sourceIds ?? []))];
  const reviews = trustedCurrentPlanReviews(record).filter(r => r.reviewerId !== record.review.authorAgentId && r.outcome === "approved" && r.method === "independent_source_recheck" && r.model && r.runId && r.evidenceArtifact && Object.values(r.checks).every(Boolean) && r.findings.every(f => f.resolved) && requiredSources.every(id => r.sourceIds.includes(id)));
  return new Set(reviews.map(r => r.reviewerId)).size >= 2 && new Set(reviews.map(r => r.runId)).size >= 2;
}
export function trustedCurrentPlanReviews(record: DecisionCompetitionRecord): CatalogAiReview[] {
  const digest = catalogContentDigest(record);
  const current = trustedPlanReviewRecord(record).review.aiReviews!.filter(r => r.contentDigest === digest);
  return current.filter(r => !current.some(other => other.reviewerId === r.reviewerId && Date.parse(other.reviewedAt) > Date.parse(r.reviewedAt)));
}
