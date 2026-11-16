import type { CatalogFact, DecisionCompetitionRecord } from "../v6/catalog-types";
import { approvedPublishedWorkFactsV734, candidatePublishedWorkFactsV734, PUBLISHED_WORK_FACTS_VERSION_V734, type PublishedWorkFactBindingV734 } from "@/content/competitions-v6/published-work-facts-v734";
import { reviewedPublishedWorkBindingsV734, REVIEWED_PUBLISHED_WORK_BINDINGS_VERSION_V734 } from "@/content/competitions-v6/published-work-approvals-v734";

/** Browser-safe compiled trust anchor. Primary bytes/page anchors are checked
 * offline before an exact candidate is approved; production never reads caches. */
const candidates: PublishedWorkFactBindingV734[] = Array.from(candidatePublishedWorkFactsV734, binding => structuredClone(binding));
const approved: PublishedWorkFactBindingV734[] = Array.from(approvedPublishedWorkFactsV734, binding => structuredClone(binding));
const reviewed = Object.freeze({ ...reviewedPublishedWorkBindingsV734 });
const identityKeys = ["editionId", "trackId", "groupId", "scopeId"] as const;
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`).join(",")}}`;
  throw new Error("invalid_published_work_evidence_json");
}
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const localArtifact = (value: string) => Boolean(value && !value.startsWith("/") && !value.split(/[\\/]/).includes(".."));

/** Protect the new namespace even when an unapproved atom changes kind/field.
 * Legacy non-material participant reports retain their previous reader rules. */
export function isPublishedWorkFactNamespaceV734(fact: CatalogFact): boolean {
  return fact.field.startsWith("material.") || fact.id.includes(":material:v734:") || candidates.some(binding => binding.fact.id === fact.id);
}

function bindingFor(record: DecisionCompetitionRecord, fact: CatalogFact): PublishedWorkFactBindingV734 | undefined {
  if (PUBLISHED_WORK_FACTS_VERSION_V734 !== "saitu.published-work-facts.v7.34"
    || REVIEWED_PUBLISHED_WORK_BINDINGS_VERSION_V734 !== "saitu.reviewed-published-work-bindings.v7.34" || fact.kind !== "participant_report"
    || fact.status !== "historical" || !fact.field.startsWith("material.") || fact.field.startsWith("deep.")) return;
  const matching = approved.filter(binding => binding.ownerId === record.recordId && binding.fact.id === fact.id);
  const source = candidates.filter(binding => binding.ownerId === record.recordId && binding.fact.id === fact.id);
  if (matching.length !== 1 || source.length !== 1 || candidates.filter(binding => binding.fact.id === fact.id).length !== 1
    || approved.filter(binding => binding.fact.id === fact.id).length !== 1 || !same(matching[0], source[0])
    || reviewed[fact.id] !== canonical(matching[0]) || !same(fact, matching[0].fact)) return;
  const binding = matching[0];
  if (binding.ownerSeriesId !== record.seriesId || binding.ownerCatalogVersion !== record.catalogVersion) return;
  if (!record.identity || !fact.entity || identityKeys.some(key => !record.identity![key] || record.identity![key] !== fact.entity![key])) return;
  if (!fact.sourceScopes || !fact.sourceIds.length || new Set(fact.sourceIds).size !== fact.sourceIds.length
    || binding.sources.length !== fact.sourceIds.length || new Set(binding.sources.map(row => row.id)).size !== binding.sources.length
    || fact.sourceScopes.length !== fact.sourceIds.length || new Set(fact.sourceScopes.map(row => row.sourceId)).size !== fact.sourceScopes.length
    || fact.scope !== fact.sourceScopes.map(row => row.scope).join("；")) return;
  for (const id of fact.sourceIds) {
    const original = record.sources.filter(row => row.id === id), expected = binding.sources.filter(row => row.id === id);
    const scopes = fact.sourceScopes.filter(row => row.sourceId === id), proofs = binding.sourceProofs.filter(row => row.sourceId === id);
    if (original.length !== 1 || expected.length !== 1 || !same(original[0], expected[0]) || original[0].accessStatus !== "body_read"
      || scopes.length !== 1 || scopes[0].scope !== original[0].scope || !proofs.length) return;
    // One HTML/PDF source may have several separately checked images/bodies.
    if (proofs.some(proof => !hash(proof.sha256) || !hash(proof.bodySha256) || !localArtifact(proof.artifactPath)
      || !localArtifact(proof.bodyArtifactPath) || !proof.locator.trim() || !proof.anchors.length
      || proof.anchors.some(anchor => !anchor.text.trim() || anchor.page !== undefined && (!Number.isInteger(anchor.page) || anchor.page < 1)))) return;
  }
  if (binding.sourceProofs.some(proof => !fact.sourceIds.includes(proof.sourceId))) return;
  return binding;
}

/** An exact approved author/material observation is evidence about that work,
 * never an organiser rule, independent effect proof, or a student's resource. */
export function isApprovedPublishedWorkFactV734(record: DecisionCompetitionRecord, fact: CatalogFact): boolean {
  try {
    return record.facts.filter(row => row.id === fact.id).length === 1
      && same(record.facts.find(row => row.id === fact.id), fact) && Boolean(bindingFor(record, fact));
  } catch { return false; }
}

/** Only the current catalog getter appends approved atoms. Frozen caller-owned
 * contexts are not backfilled, and existing facts/roles/sources are never edited. */
export function appendApprovedPublishedWorkFactsV734(records: readonly DecisionCompetitionRecord[]): DecisionCompetitionRecord[] {
  return records.map(record => {
    const extra: CatalogFact[] = [];
    for (const binding of approved.filter(row => row.ownerId === record.recordId)) {
      if (record.facts.some(fact => fact.id === binding.fact.id)) continue;
      try { if (bindingFor(record, binding.fact)) extra.push(structuredClone(binding.fact)); } catch { /* Invalid approval stays unavailable. */ }
    }
    return extra.length ? { ...record, facts: [...record.facts, ...extra] } : record;
  });
}
