import { describe, expect, it } from "vitest";
import { getDecisionCatalog } from "@/lib/competitions/v6/catalog";
import { selectPublishedDecisionRecords } from "@/lib/competitions/v6/published-records";
import { isDecisionEvidenceFact, isEvidenceForRecord } from "@/lib/competitions/v6/evidence";
import { buildDecisionContext } from "@/lib/competitions/v6/engine";
import { legacyOfficialEvidence, presentPublishedDecisionAsV5, isPublishedLegacyResponseCurrent } from "@/lib/competitions/v6/legacy-presentation";
import { student, syntheticRecord } from "./decision-fixtures";
const now = new Date("2026-11-06T00:00:00Z");
function actualLegacySourceCase() {
  const found = selectPublishedDecisionRecords().map(record => ({ record, evidence: legacyOfficialEvidence(record),
    context: buildDecisionContext(student(), { now, records: [record], qualificationSource: "record_only" }) }))
    .find(({ record, evidence, context }) => context.candidates.length > 0 && evidence.sources.length > 0 && record.sources.length > 0
      && !evidence.sources.some(source => source.url === record.sources[0].url));
  expect(found, "Current canonical records include unverified legacy first-source metadata").toBeDefined(); return found!;
}
describe("V5 official-fact citation boundary", () => {
  it("projects only exact official-fact source bindings across every current published record", () => {
    const published = selectPublishedDecisionRecords(); expect(published.length).toBeGreaterThan(0);
    for (const record of published) {
      const facts = record.facts.filter(fact => fact.kind === "official_fact" && isDecisionEvidenceFact(record, fact) && isEvidenceForRecord(record, fact));
      const evidence = legacyOfficialEvidence(record); expect(evidence.sources.length, record.recordId).toBeGreaterThan(0);
      for (const source of evidence.sources) {
        expect(source.accessStatus).toBe("body_read"); expect(["organizer", "official_host", "university_local"]).toContain(source.authority);
        expect(facts.some(fact => fact.sourceIds.includes(source.id) && source.scope === (fact.sourceScopes?.find(binding => binding.sourceId === source.id)?.scope ?? fact.scope))).toBe(true);
      }
      for (const reference of evidence.officialFacts) expect(facts.some(fact => fact.text === reference.fact && fact.sourceIds.includes(reference.sourceRef)
        && evidence.sources.some(source => source.id === reference.sourceRef && source.url === reference.sourceUrl))).toBe(true);
    }
  });
  it("skips the actual same-record legacy first source without deleting metadata or changing the V6 report", () => {
    const { record, context, evidence } = actualLegacySourceCase(), before = JSON.stringify(getDecisionCatalog());
    const response = presentPublishedDecisionAsV5(context); expect(response.recommendations).toHaveLength(1);
    const item = response.recommendations[0]; expect(item.sourceUrl).toBe(evidence.sources[0].url); expect(item.sourceUrl).not.toBe(record.sources[0].url);
    expect(item.evidenceRefs!.source).toEqual(evidence.sources.slice(0, 20).map(source => source.url));
    expect(item.evidenceRefs!.source).not.toContain(record.sources[0].url);
    expect(isPublishedLegacyResponseCurrent(response, now)).toBe(true); expect(JSON.stringify(getDecisionCatalog())).toBe(before);
  });
  it.each(["main", "source_list", "official_ref", "official_text", "omit_source_list"])("rejects cached %s replacement even when the URL belongs to the same published record", field => {
    const { record, context } = actualLegacySourceCase(), response = presentPublishedDecisionAsV5(context), item = response.recommendations[0];
    if (field === "main") item.sourceUrl = record.sources[0].url;
    if (field === "source_list") item.evidenceRefs!.source.push(record.sources[0].url);
    if (field === "official_ref") item.evidenceRefs!.officialFacts![0] = { fact: item.evidenceRefs!.officialFacts![0].fact, sourceRef: record.sources[0].id, sourceUrl: record.sources[0].url };
    if (field === "official_text") item.evidenceRefs!.officialFacts![0].fact += " fabricated qualification";
    if (field === "omit_source_list") item.evidenceRefs!.source = [];
    expect(isPublishedLegacyResponseCurrent(response, now)).toBe(false);
  });
  it("does not promote a partly checked multi-source fact and keeps a separately supported fact", () => {
    const record = syntheticRecord(778), fact = record.facts[0], good = record.sources[0];
    const legacy = { ...good, id: "synthetic-unchecked", url: "https://example.org/unverified", accessStatus: "imported_unrechecked" as const };
    record.sources.push(legacy); record.facts.push({ ...fact, id: "partial-fact", sourceIds: [good.id, legacy.id] });
    const evidence = legacyOfficialEvidence(record);
    expect(evidence.sources.map(source => source.id)).toEqual([good.id]); expect(evidence.officialFacts).toHaveLength(1);
    record.facts = [record.facts[1]]; expect(legacyOfficialEvidence(record)).toEqual({ sources: [], officialFacts: [] });
  });
  it.each(["unchecked", "authority", "scope", "entity", "url", "duplicate"])("does not grant citation authority for %s source data", kind => {
    const record = syntheticRecord(779), source = record.sources[0];
    if (kind === "unchecked") source.accessStatus = "metadata_only";
    if (kind === "authority") source.authority = "other";
    if (kind === "scope") source.scope += " another-edition";
    if (kind === "entity") record.facts[0].entity = { editionId: "wrong", trackId: "wrong", groupId: "wrong", scopeId: "wrong" };
    if (kind === "url") source.url = "https://user:password@example.org/";
    if (kind === "duplicate") record.sources.push({ ...source, accessStatus: "metadata_only" });
    expect(legacyOfficialEvidence(record)).toEqual({ sources: [], officialFacts: [] });
  });
  it("fails closed for a changed published context with no usable sources instead of borrowing a sibling", () => {
    const { record } = actualLegacySourceCase(), changed = structuredClone(record);
    changed.sources.forEach(source => { source.accessStatus = "metadata_only"; });
    const context = buildDecisionContext(student(), { now, qualificationSource: "record_only", records: [changed] });
    expect(legacyOfficialEvidence(changed)).toEqual({ sources: [], officialFacts: [] });
    expect(presentPublishedDecisionAsV5(context).recommendations).toEqual([]);
  });
});
