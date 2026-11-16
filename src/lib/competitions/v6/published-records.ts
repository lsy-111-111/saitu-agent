import reviewLedger from "@/content/competitions-v6/ai-review-ledger.json";
import { getDecisionCatalog } from "./catalog";
import { catalogContentDigest, hasDualAiReview } from "./catalog-review";
import type { CatalogAiReview, DecisionCompetitionRecord } from "./catalog-types";

/** Caller-supplied snapshots are content to verify, never a publication authority.
 * Both current canonical publication and canonical current-digest dual review are
 * required. No alternate ledger, approval flag or environment bypass is accepted. */
export function selectPublishedDecisionRecords(records?: readonly DecisionCompetitionRecord[]): DecisionCompetitionRecord[] {
  const canonical = getDecisionCatalog();
  const byId = new Map(canonical.map(record => [record.recordId, record]));
  return (records ?? canonical).filter(record => {
    const published = byId.get(record.recordId);
    if (!published || !published.publication.productionReady || !record.publication.productionReady ||
      !["L2", "L3"].includes(published.contentTier) || record.contentTier !== published.contentTier || record.publication.mode !== published.publication.mode ||
      record.review.policy !== "ai_dual_review" || published.review.policy !== "ai_dual_review" ||
      catalogContentDigest(record) !== catalogContentDigest(published)) return false;
    const reviews = (reviewLedger as Record<string, CatalogAiReview[]>)[record.recordId] ?? [];
    return hasDualAiReview({ ...record, review: { ...record.review, aiReviews: reviews } });
  });
}
