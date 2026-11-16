import type { CatalogFact } from "./catalog-types";
import type { ResearchedContent } from "@/content/competitions-v6/research-types";

/** Preserve the author's exact source and time scope. This does not approve a fact. */
export function authoredEligibilityFacts(content: ResearchedContent): CatalogFact[] {
  const ids = new Set<string>();
  return (content.eligibilityFacts ?? []).map(item => {
    if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(item.idSuffix) || !item.text.trim() || ids.has(item.idSuffix) || new Set(item.sourceIds).size !== item.sourceIds.length) throw new Error("Invalid authored eligibility fact");
    ids.add(item.idSuffix);
    if (item.kind === "unknown") {
      if (item.sourceIds.length || !item.scope?.trim() || (item.status !== undefined && item.status !== "unknown" && item.status !== "pending_review")) throw new Error("Invalid unknown eligibility fact");
      return {
        id: `${content.seriesId}:v2:eligibility.${item.idSuffix}`,
        field: `eligibility.${item.idSuffix}`, text: item.text, kind: "unknown",
        status: item.status ?? "unknown", sourceIds: [], sourceScopes: [],
        scope: item.scope.trim(), checkedAt: null, supersedes: [], conflictsWith: [],
      };
    }
    if ((item.kind !== undefined && item.kind !== "official_fact") || !item.sourceIds.length) throw new Error("Invalid authored eligibility fact");
    const sources = item.sourceIds.map(id => content.sources.find(source => source.id === id));
    if (sources.some(source => !source)) throw new Error("Missing authored eligibility source");
    const evidence = sources.map(source => source!);
    return {
      id: `${content.seriesId}:v2:eligibility.${item.idSuffix}`,
      field: `eligibility.${item.idSuffix}`, text: item.text, kind: "official_fact",
      status: item.status ?? content.factStatus ?? "historical", sourceIds: [...item.sourceIds],
      sourceScopes: evidence.map(source => ({sourceId:source.id,scope:source.scope})),
      scope: evidence.map(source => source.scope).join("；"), checkedAt: evidence[0].checkedAt,
      supersedes: [], conflictsWith: [],
    };
  });
}
