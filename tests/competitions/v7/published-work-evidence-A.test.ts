import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishedWorkFactBindingV734 } from "@/content/competitions-v6/published-work-facts-v734";
import { syntheticRecord, student } from "../v6/decision-fixtures";

const registry = vi.hoisted(() => ({ candidates: [] as PublishedWorkFactBindingV734[], approved: [] as PublishedWorkFactBindingV734[], reviewed: {} as Record<string, string>, version: "saitu.published-work-facts.v7.34", reviewVersion: "saitu.reviewed-published-work-bindings.v7.34" }));
vi.mock("@/content/competitions-v6/published-work-facts-v734", () => ({ get candidatePublishedWorkFactsV734() { return registry.candidates; }, get approvedPublishedWorkFactsV734() { return registry.approved; }, get PUBLISHED_WORK_FACTS_VERSION_V734() { return registry.version; } }));
vi.mock("@/content/competitions-v6/published-work-approvals-v734", () => ({ get reviewedPublishedWorkBindingsV734() { return registry.reviewed; }, get REVIEWED_PUBLISHED_WORK_BINDINGS_VERSION_V734() { return registry.reviewVersion; } }));
const canonical = (value: any): string => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
function fixture() {
  const record = syntheticRecord(1);
  record.identity = { editionId: "2026", trackId: "analysis", groupId: "undergraduate", scopeId: "test-material", stageIds: [], supersedesRecordIds: [], legacyRecordIds: [] };
  const source = { ...record.sources[0], id: "author-material", authority: "other" as const, scope: "作者公开作品范围", evidenceArtifact: "artifacts/test-material-reading.json" };
  record.sources.push(source);
  const fact = { ...record.facts[0], id: "fixture:material:v734:observation", field: "material.observation", text: "作者材料报告一项观察，不等于效果验证。", kind: "participant_report" as const, status: "historical" as const,
    sourceIds: [source.id], scope: source.scope, sourceScopes: [{ sourceId: source.id, scope: source.scope }], entity: { editionId: "2026", trackId: "analysis", groupId: "undergraduate", scopeId: "test-material" } };
  const binding: PublishedWorkFactBindingV734 = { ownerId: record.recordId, ownerSeriesId: record.seriesId, ownerCatalogVersion: record.catalogVersion, fact, sources: [source], sourceProofs: [{ sourceId: source.id, artifactPath: "artifacts/test-material.pdf", sha256: "a".repeat(64), bodyArtifactPath: "artifacts/test-material.txt", bodySha256: "b".repeat(64), locator: "第1页", anchors: [{ page: 1, text: "原文锚点" }] }] };
  record.facts.push(fact);
  return { record, fact, source, binding };
}
let f: ReturnType<typeof fixture>;
function approve(binding = f.binding) {
  registry.candidates = [structuredClone(binding)]; registry.approved = [structuredClone(binding)]; registry.reviewed = { [binding.fact.id]: canonical(binding) };
}
beforeEach(() => {
  vi.resetModules(); f = fixture(); approve(); registry.version = "saitu.published-work-facts.v7.34"; registry.reviewVersion = "saitu.reviewed-published-work-bindings.v7.34";
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("published_work_gate_test_forbids_provider"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("exact reviewed published-work evidence gate", () => {
  it("accepts only the exact approved participant observation, preserving source authority and legacy records", async () => {
    const gate = await import("@/lib/competitions/v7/published-work-evidence");
    expect(gate.isApprovedPublishedWorkFactV734(f.record, f.fact)).toBe(true);
    const raw = { ...f.record, facts: f.record.facts.filter(fact => fact.id !== f.fact.id) }, before = structuredClone(raw);
    const [augmented] = gate.appendApprovedPublishedWorkFactsV734([raw]);
    expect(raw).toEqual(before); expect(augmented.facts.at(-1)).toEqual(f.fact);
    expect(augmented.sources).toEqual(raw.sources); expect(augmented.roles).toEqual(raw.roles);
    expect(augmented.sources.find(source => source.id === f.source.id)!.authority).toBe("other");
    expect(gate.appendApprovedPublishedWorkFactsV734([augmented])[0]).toBe(augmented);
  });

  it.each(["owner", "series", "record-catalog-version", "edition", "track", "group", "scope", "text", "field", "kind", "status", "source-authority", "source-scope", "source-url", "source-artifact", "source-access"])("rejects exact-binding drift: %s", async defect => {
    const { isApprovedPublishedWorkFactV734 } = await import("@/lib/competitions/v7/published-work-evidence");
    const record = structuredClone(f.record), fact = record.facts.at(-1)!;
    if (defect === "owner") record.recordId += "-other";
    if (defect === "series") record.seriesId += "-other";
    if (defect === "record-catalog-version") record.catalogVersion += "-other";
    if (["edition", "track", "group", "scope"].includes(defect)) Reflect.set(record.identity!, `${defect}Id`, "other");
    if (defect === "text") fact.text += "另加无据内容";
    if (defect === "field") fact.field = "track";
    if (defect === "kind") fact.kind = "official_fact";
    if (defect === "status") fact.status = "verified_current";
    const source = record.sources.find(source => source.id === f.source.id)!;
    if (defect === "source-authority") source.authority = "organizer";
    if (defect === "source-scope") source.scope += "另届";
    if (defect === "source-url") source.url += "?changed=1";
    if (defect === "source-artifact") source.evidenceArtifact += ".changed";
    if (defect === "source-access") source.accessStatus = "metadata_only";
    expect(isApprovedPublishedWorkFactV734(record, fact)).toBe(false);
  });

  it.each(["text", "proof-hash", "proof-body-hash", "proof-locator", "source-metadata", "proof-extra-undefined", "supersedes-sparse"])("does not inherit approval when candidate and active row are both edited: %s", async defect => {
    const changed = structuredClone(f.binding);
    if (defect === "text") changed.fact.text += "改写";
    if (defect === "proof-hash") changed.sourceProofs[0].sha256 = "c".repeat(64);
    if (defect === "proof-body-hash") changed.sourceProofs[0].bodySha256 = "d".repeat(64);
    if (defect === "proof-locator") changed.sourceProofs[0].locator = "另一页";
    if (defect === "source-metadata") changed.sources[0].locator += "另一段";
    if (defect === "proof-extra-undefined") Reflect.set(changed.sourceProofs[0], "unreviewed", undefined);
    if (defect === "supersedes-sparse") changed.fact.supersedes = new Array<string>(1);
    registry.candidates = [changed]; registry.approved = [structuredClone(changed)];
    const record = structuredClone(f.record); record.facts[record.facts.length - 1] = changed.fact; record.sources[record.sources.length - 1] = changed.sources[0];
    const gate = await import("@/lib/competitions/v7/published-work-evidence");
    expect(gate.isApprovedPublishedWorkFactV734(record, changed.fact)).toBe(false);
  });

  it("allows several separately reviewed artifacts for one material source", async () => {
    f.binding.sourceProofs.push({ ...f.binding.sourceProofs[0], artifactPath: "artifacts/test-table.png", bodyArtifactPath: "artifacts/test-table.png", sha256: "e".repeat(64), bodySha256: "e".repeat(64), anchors: [{ page: 2, text: "图像标题" }] }); approve();
    expect((await import("@/lib/competitions/v7/published-work-evidence")).isApprovedPublishedWorkFactV734(f.record, f.fact)).toBe(true);
  });

  it("fails closed before activation and prevents reserved ID/field escape while retaining old non-material behavior", async () => {
    registry.approved = [];
    const gate = await import("@/lib/competitions/v7/published-work-evidence"), { isDecisionEvidenceFact } = await import("@/lib/competitions/v6/evidence");
    expect(gate.isApprovedPublishedWorkFactV734(f.record, f.fact)).toBe(false);
    expect(isDecisionEvidenceFact(f.record, { ...f.fact, field: "task", kind: "editorial_inference" })).toBe(false);
    expect(isDecisionEvidenceFact(f.record, { ...f.fact, id: "unregistered:material:v734:fact", field: "task" })).toBe(false);
    expect(isDecisionEvidenceFact(f.record, { ...f.fact, field: "deep.example" })).toBe(false);
    expect(isDecisionEvidenceFact(f.record, { ...f.fact, id: "legacy-participant", field: "legacy.feedback" })).toBe(true);
    expect(isDecisionEvidenceFact(f.record, f.record.facts[0])).toBe(true);
  });

  it("keeps author facts as participant evidence through generation/validation/review and never supports official basis", async () => {
    const { buildDecisionContextV7, matchExplanationInputV7, validateMatchPlanV7, isReusedClaim } = await import("@/lib/competitions/v7/model");
    const { claim } = await import("@/lib/competitions/v6/engine"), { buildAssertionReviewPacketV7 } = await import("@/lib/competitions/v7/evidence-packet");
    const context = buildDecisionContextV7(student(), { records: [f.record] }), reason = claim("可根据作者报告自拟一个未来核对计划。", "inference", [context.profile.facts[0].id], [f.fact.id]);
    const plan = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, recommendations: [{ itemId: f.record.recordId, reasons: [reason] }], shortfallReason: "合成仅一项。" };
    const input = matchExplanationInputV7(context, plan), atom = input.candidates[0].facts.find(fact => fact.id === f.fact.id)!;
    expect(atom.kind).toBe("participant_report"); expect(input.candidates[0].citationRules.competitionFactIds).toContain(f.fact.id);
    expect(validateMatchPlanV7(plan, context).ok).toBe(true);
    const official = { ...reason, basis: "official" as const, text: f.fact.text, studentFactIds: [] };
    expect(validateMatchPlanV7({ ...plan, recommendations: [{ itemId: f.record.recordId, reasons: [official] }] }, context).issues).toContain("chat.0: official_claim_without_official_fact");
    expect(isReusedClaim(context, f.record.recordId, official)).toBe(false);
    const packet = buildAssertionReviewPacketV7(context, plan, [{ key: `${f.record.recordId}.reason.0`, itemId: f.record.recordId, reason }]);
    expect(packet.assertionEvidence[0].competitionItems[0].citedFacts[0]).toEqual(f.fact);
    expect(packet.assertionEvidence[0].competitionItems[0].sources[0]).toEqual(f.source);
  });
});
