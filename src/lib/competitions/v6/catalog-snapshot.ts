import { createHash } from "node:crypto";
import type { DecisionCompetitionRecord } from "./catalog-types";
import { validateCatalogSnapshot, validateDecisionRecord } from "./catalog-validation";
import { hasTrustedPlanDualReview } from "./trusted-plan-review";
import { catalogContentDigest, hasDualAiReview, hasHumanReview } from "./catalog-review";

export type CatalogSnapshot = {
  schemaVersion: "saitu.catalog-snapshot.v1";
  snapshotId: string;
  createdAt: string;
  policy: "ai_dual_review" | "human_review";
  digest: string;
  records: DecisionCompetitionRecord[];
};

export function snapshotDigest(records: DecisionCompetitionRecord[]) {
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

/** Publication never trusts serialized contentTier or productionReady flags. */
export function checkSnapshot(candidate: CatalogSnapshot, previous: DecisionCompetitionRecord[], now = new Date(), allowRemoval = false) {
  const errors: string[] = [];
  if (candidate.schemaVersion !== "saitu.catalog-snapshot.v1" || !/^[a-zA-Z0-9._-]+$/.test(candidate.snapshotId)) errors.push("invalid_snapshot_identity");
  if (!Number.isFinite(Date.parse(candidate.createdAt))) errors.push("invalid_snapshot_time");
  if (candidate.digest !== snapshotDigest(candidate.records)) errors.push("snapshot_digest_mismatch");
  if (!["ai_dual_review", "human_review"].includes(candidate.policy)) errors.push("unsupported_review_policy");
  if (!validateCatalogSnapshot(candidate.records, now).valid) errors.push("structurally_invalid_catalog");
  const current = new Map(previous.map(record => [record.recordId, record]));
  const next = new Map(candidate.records.map(record => [record.recordId, record]));
  for (const record of previous) if (!allowRemoval && !next.has(record.recordId)) errors.push(`record_removed:${record.recordId}`);
  for (const record of candidate.records) {
    const old = current.get(record.recordId);
    const changed = !old || catalogContentDigest(old) !== catalogContentDigest(record);
    const validation = validateDecisionRecord(record, now);
    if (Number(record.contentTier?.slice(1)) > Number(validation.tier.slice(1))) errors.push(`tier_overclaimed:${record.recordId}`);
    const policyApproved = (record.participationPlans === undefined || hasTrustedPlanDualReview(record)) && (candidate.policy === "ai_dual_review" ? hasDualAiReview(record) : hasHumanReview(record));
    if (record.publication.productionReady && (!policyApproved || !["L2", "L3"].includes(validation.tier))) errors.push(`readiness_overclaimed:${record.recordId}`);
    // Historical L1 records may remain as explicitly unknown discovery entries.
    // A new/changed record or any decision-ready record requires the selected review policy.
    if (changed || ["L2", "L3"].includes(validation.tier)) {
      if (!policyApproved || !["L2", "L3"].includes(validation.tier)) errors.push(`review_required:${record.recordId}`);
      if (record.targetTier === "L3" && validation.tier !== "L3") errors.push(`deep_content_incomplete:${record.recordId}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
