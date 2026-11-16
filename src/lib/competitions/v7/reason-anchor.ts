import type { CatalogFact, DecisionCompetitionRecord } from "../v6/catalog-types";
import { decisionClaimSchema } from "../v6/contracts";
import { isDecisionEvidenceFact } from "../v6/evidence";
import { isApprovedPublishedWorkFactV734 } from "./published-work-evidence";

/** Keep the fact and scope byte-for-byte. The prefix distinguishes historical
 * records without claiming they are the current formal competition rules. */
export function matchReasonAnchorPrefixV7(fact: Pick<CatalogFact, "text" | "scope" | "status">): string {
  return `已核资料（${fact.status === "historical" ? "历史资料，" : ""}${fact.scope}）：${fact.text}\n据此分析：`;
}

/** The very same set is sent to generation and checked again after decoding.
 * A fact that leaves no room for a nonempty analysis cannot be selected. */
export function matchReasonAnchorFactsV7(record: DecisionCompetitionRecord): CatalogFact[] {
  const ids = new Set<string>(), duplicateIds = new Set<string>();
  for (const { id } of record.facts) {
    if (ids.has(id)) duplicateIds.add(id);
    ids.add(id);
  }
  return record.facts.filter(fact => !duplicateIds.has(fact.id) && (fact.kind === "official_fact" || isApprovedPublishedWorkFactV734(record, fact))
    && isDecisionEvidenceFact(record, fact) && fact.text.trim() && fact.scope.trim()
    && decisionClaimSchema.shape.text.safeParse(`${matchReasonAnchorPrefixV7(fact)}审`).success);
}
