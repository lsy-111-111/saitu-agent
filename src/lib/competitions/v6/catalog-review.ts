import { createHash } from "node:crypto";
import type { DecisionCompetitionRecord } from "./catalog-types";

/** Approval binds to the full substantive record, not an editable tier or a series name. */
export function catalogContentDigest(record: DecisionCompetitionRecord): string {
  const { review: _review, publication: _publication, contentTier: _tier, catalogVersion: _version, ...content } = record;
  if (content.deepDive) content.deepDive = { ...content.deepDive, status: "draft" };
  return createHash("sha256").update(JSON.stringify({ authorAgentId: record.review.authorAgentId, content })).digest("hex");
}

export function hasDualAiReview(record: DecisionCompetitionRecord): boolean {
  if (record.review.policy !== "ai_dual_review" || !record.review.authorAgentId) return false;
  const digest = catalogContentDigest(record);
  const requiredSources = new Set([...record.facts.filter(fact => fact.kind === "official_fact" && ["historical", "verified_current"].includes(fact.status)).flatMap(fact => fact.sourceIds), ...(record.deepDive?.workedExample.sourceIds ?? [])]);
  // A later recheck can revoke an earlier approval without changing the text.
  // Preserve all history, but only each reviewer's latest verdict has authority.
  // Equal-time conflicting verdicts fail closed, independently of ledger order.
  const current = (record.review.aiReviews ?? []).filter(review =>
    review.contentDigest === digest && review.reviewerId !== record.review.authorAgentId);
  if (current.some(review => !review.reviewerId || !Number.isFinite(Date.parse(review.reviewedAt)))) return false;
  const latest = current.filter(review => !current.some(other =>
    other.reviewerId === review.reviewerId && Date.parse(other.reviewedAt) > Date.parse(review.reviewedAt)));
  if (latest.some(review => review.outcome !== "approved" || review.findings.some(finding => !finding.resolved))) return false;
  const approved = latest.filter(review =>
    review.outcome === "approved" && review.method === "independent_source_recheck" &&
    review.reviewerId !== record.review.authorAgentId && review.contentDigest === digest &&
    review.runId && review.model && Number.isFinite(Date.parse(review.reviewedAt)) &&
    review.evidenceArtifact && requiredSources.size > 0 &&
    [...requiredSources].every(sourceId => review.sourceIds.includes(sourceId)) &&
    ["factualSupport", "entityScope", "studentUsefulness", "temporalAccuracy"].every(key => review.checks[key as keyof typeof review.checks] === true) &&
    review.findings.every(finding => finding.resolved)
  );
  return new Set(approved.map(review => review.runId)).size >= 2 && new Set(approved.map(review => review.reviewerId)).size >= 2;
}

export function hasHumanReview(record: DecisionCompetitionRecord): boolean {
  const human = record.review.humanReview;
  if (human) return human.status === "performed" && human.reviewerIds.length > 0 && Boolean(human.reviewedAt);
  return ["human_reviewed", "independently_reviewed"].includes(record.review.status) && record.review.reviewerIds.length > 0 && Boolean(record.review.reviewedAt);
}
