import type { CatalogFact, DecisionCompetitionRecord } from "./catalog-types";
import { isApprovedPublishedWorkFactV734, isPublishedWorkFactNamespaceV734 } from "../v7/published-work-evidence";

/** Deep case requirements describe one example, not the whole recommended track. */
export function isDecisionEvidenceFact(
  record: DecisionCompetitionRecord,
  fact: CatalogFact,
): boolean {
  if (
    !["verified_current", "historical"].includes(fact.status) ||
    fact.field.startsWith("deep.")
  )
    return false;
  if (isPublishedWorkFactNamespaceV734(fact)) return isApprovedPublishedWorkFactV734(record, fact);
  if (fact.kind !== "official_fact") return true;
  const bindings=fact.sourceScopes;
  if((fact.entity||bindings)&&!isEvidenceForRecord(record,fact))return false;
  if(bindings && (bindings.length!==fact.sourceIds.length || new Set(bindings.map(b=>b.sourceId)).size!==bindings.length || bindings.some(b=>!fact.sourceIds.includes(b.sourceId)||!b.scope.trim())))return false;
  return (
    fact.sourceIds.length > 0 && new Set(fact.sourceIds).size === fact.sourceIds.length &&
    fact.sourceIds.every((id) =>
      record.sources.some(
        (source) =>
          source.id === id &&
          source.accessStatus === "body_read" &&
          ["organizer", "official_host", "university_local"].includes(source.authority) &&
          source.scope === (bindings ? bindings.find(b=>b.sourceId===id)?.scope : fact.scope),
      ),
    )
  );
}

/** Entity scope must bind all four dimensions; an edition match alone cannot cross tracks. */
export function isEvidenceForRecord(record:DecisionCompetitionRecord,fact:CatalogFact):boolean {
  if(fact.entity){
    if(!record.identity)return false;
    return (["editionId","trackId","groupId","scopeId"] as const).every(key=>Boolean(fact.entity![key])&&fact.entity![key]===record.identity![key]);
  }
  return !fact.sourceScopes && fact.scope===record.scope;
}
