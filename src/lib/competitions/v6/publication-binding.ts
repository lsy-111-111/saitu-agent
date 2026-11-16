import { createHash } from "node:crypto";
import { getDecisionCatalog } from "./catalog";
import { catalogContentDigest } from "./catalog-review";
import { selectPublishedDecisionRecords } from "./published-records";
import { getMatchingCatalogMetadata, getMatchingCatalogRecords, MATCHING_CATALOG_POLICY_VERSION, matchingCoreDigest, matchingMetadataDigest } from "../v7/catalog";

/** Server-owned identity includes current content and the exact currently
 * approved set. A revoked review changes it even if substantive text is equal. */
export function currentDecisionPublicationBinding(): string {
  const records = getDecisionCatalog();
  const published = selectPublishedDecisionRecords(records).map(record => ({
    recordId: record.recordId, contentDigest: catalogContentDigest(record),
  })).sort((a, b) => a.recordId.localeCompare(b.recordId));
  const matching = getMatchingCatalogRecords().map(record => {
    const metadata = getMatchingCatalogMetadata(record);
    return { recordId: record.recordId, coreDigest: matchingCoreDigest(record), metadataDigest: metadata ? matchingMetadataDigest(metadata) : null };
  }).sort((a, b) => a.recordId.localeCompare(b.recordId));
  return createHash("sha256").update(JSON.stringify({ policyVersion: MATCHING_CATALOG_POLICY_VERSION, records, published, matching })).digest("hex");
}
