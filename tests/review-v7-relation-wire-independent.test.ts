import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchPlanSchema, type MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { buildAssertionReviewPacketV7, compactAssertionReviewPacketV7, type ReviewAssertionV7 } from "@/lib/competitions/v7/evidence-packet";
import { buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import { readPublicDiagnosticFixture } from "./fixtures/v7-public-diagnostics";

const diagnostic = "artifacts/continuation-v7-20261109/explanation-diagnostic-01";
const input = readPublicDiagnosticFixture(`${diagnostic}/input.json`), actual = readPublicDiagnosticFixture(`${diagnostic}/result.json`);
const registration = readPublicDiagnosticFixture(`${diagnostic}/registration.json`);
const context = () => buildDecisionContextV7(input.originalProfile, { profile: structuredClone(input.profile), records: structuredClone(input.records), now: new Date(registration.asOf) });
function codec(ctx: ReturnType<typeof context>) {
  return createModelIdentifierCodec({ candidates: ctx.candidates.map(({ record }) => record.recordId), series: ctx.candidates.map(({ record }) => record.seriesId),
    facts: ctx.candidates.flatMap(({ record }) => record.facts.map(fact => fact.id)), students: ctx.profile.facts.map(fact => fact.id) });
}
function realPlan(ctx: ReturnType<typeof context>) {
  const raw = JSON.parse(actual.calls[0].saved.receipt.content);
  return matchPlanSchema.parse(codec(ctx).decode(Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "type"))));
}
function assertions(plan: MatchPlanV6): ReviewAssertionV7[] {
  return plan.recommendations.flatMap(item => [...item.reasons.map((reason, index) => ({ key: `${item.itemId}.reason.${index}`, itemId: item.itemId, reason })),
    { key: `${item.itemId}.role`, itemId: item.itemId, reason: item.roleReason! }]);
}
function expandedWire(value: unknown) {
  const { evidenceBundle, ...rest } = value as Record<string, unknown>;
  const expanded = expandCandidateEvidence(expandMatchingTables({ ...rest, candidates: evidenceBundle })) as Record<string, unknown>;
  const { candidates, ...metadata } = expanded;
  return { ...metadata, ...(candidates as object[])[0] } as ReturnType<typeof buildAssertionReviewPacketV7>;
}
const observations: unknown[] = [];
const outputDir = process.env.SAITU_V7_INDEPENDENT_REVIEW_ARTIFACT_DIR ? path.resolve(process.env.SAITU_V7_INDEPENDENT_REVIEW_ARTIFACT_DIR) : null;
let newHttpCalls = 0;
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { newHttpCalls++; throw new Error("new_http_forbidden"); })); });
afterEach(() => { expect(newHttpCalls).toBe(0); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
afterAll(() => {
  if (!outputDir) return;
  if (existsSync(path.join(outputDir, "relation-wire-results.json"))) throw new Error("independent_review_output_already_exists");
  mkdirSync(outputDir, { recursive: true });
  const files = ["src/lib/competitions/v7/model.ts", "src/lib/competitions/v7/evidence-packet.ts", "src/lib/competitions/v6/model-identifiers.ts", "tests/review-v7-relation-wire-independent.test.ts"]
    .map(file => ({ path: file, sha256: createHash("sha256").update(readFileSync(path.resolve(file))).digest("hex") }));
  writeFileSync(path.join(outputDir, "relation-wire-results.json"), JSON.stringify({ schemaVersion: "saitu.relation-wire-independent-review.v1", files, observations,
    newHttpCalls, newPaidCalls: 0, productionCodeModified: false, notNewModelVerdict: true, syntheticRelationProbesNotOfficialCorrections: true }, null, 2) + "\n", { flag: "wx" });
});

describe("independent relation identifiers in the actual review wire", () => {
  it("keeps the same aliases in allowed item scopes, item identity and fixed order for all twenty real claims", () => {
    const ctx = context(), plan = realPlan(ctx), rows = assertions(plan), packet = buildAssertionReviewPacketV7(ctx, plan, rows), transport = codec(ctx);
    const wire = expandedWire(compactAssertionReviewPacketV7(transport.encode(packet)));
    expect(wire.assertions).toHaveLength(20);
    expect(wire.assertionEvidence.map(row => row.key)).toEqual(rows.map(row => row.key));
    for (const row of wire.assertionEvidence) {
      expect(row.allowedItemIds).toEqual([row.itemId]);
      expect(row.competitionItems.map(item => item.itemId)).toEqual(row.allowedItemIds);
      expect(wire.fixedOrder.itemIds).toContain(row.itemId);
    }
    observations.push({ label: "twenty_real_claim_scope_aliases", keys: wire.assertionEvidence.map(row => row.key), consistent: true });
  });

  it("encodes nonempty fact/student relation endpoints, preserves unknowns and excludes foreign facts", () => {
    const ctx = context(), plan = realPlan(ctx), row = assertions(plan)[0], record = ctx.candidates.find(candidate => candidate.record.recordId === row.itemId)!.record;
    const cited = record.facts.find(fact => fact.id === row.reason.competitionFactIds[0])!;
    const foreignId = ctx.candidates.find(candidate => candidate.record.recordId !== row.itemId)!.record.facts[0].id;
    const unknownId = "independent:missing:relation-endpoint";
    const counter = { ...structuredClone(cited), id: "independent:counter:first", text: cited.id, status: "conflicting" as const,
      supersedes: [cited.id], conflictsWith: ["independent:counter:second", foreignId, unknownId] };
    const second = { ...structuredClone(counter), id: "independent:counter:second", supersedes: [], conflictsWith: [counter.id] };
    record.facts.push(counter, second);
    const studentBase = ctx.profile.facts[0], retired = { ...structuredClone(studentBase), id: "independent:student:retired", field: "skills", value: "programming",
      originalText: record.recordId, label: record.recordId, state: "retracted" as const, confirmed: false, supersedesFactIds: [] };
    const updated = { ...structuredClone(retired), id: "independent:student:updated", originalText: cited.id, label: cited.id,
      state: "negated" as const, confirmed: true, supersedesFactIds: [retired.id] };
    ctx.profile.facts.push(retired, updated); ctx.profile.retractedFactIds.push(retired.id);
    const packet = buildAssertionReviewPacketV7(ctx, plan, [row]), transport = codec(ctx), alias = (id: string) => (transport.encode({ id }) as { id: string }).id;
    const wire = expandedWire(compactAssertionReviewPacketV7(transport.encode(packet))), own = wire.assertionEvidence[0].competitionItems[0];
    const encodedCounter = own.contradictionContext.facts.find(fact => fact.id === alias(counter.id))!;
    expect(encodedCounter.supersedes).toEqual([alias(cited.id)]);
    expect(encodedCounter.conflictsWith).toEqual([alias(second.id), alias(foreignId), unknownId]);
    expect(own.contradictionContext.unresolvedFactIds).toEqual(expect.arrayContaining([alias(foreignId), unknownId]));
    expect(own.contradictionContext.facts.some(fact => fact.id === alias(foreignId))).toBe(false);
    expect(own.citedFacts.map(fact => fact.id)).toEqual(row.reason.competitionFactIds.map(alias));
    expect(wire.profile.retractedFactIds).toContain(alias(retired.id));
    const encodedStudent = wire.profile.facts.find(fact => fact.id === alias(updated.id))!;
    expect(encodedStudent.supersedesFactIds).toEqual([alias(retired.id)]);
    expect(encodedStudent.originalText).toBe(cited.id); expect(encodedStudent.label).toBe(cited.id);
    expect(encodedCounter.text).toBe(cited.id); expect(wire.assertions[0].key).toBe(row.key);
    expect(transport.decode(wire)).toEqual(packet);
    observations.push({ label: "synthetic_nonempty_fact_and_student_relations", supersedes: encodedCounter.supersedes, conflictsWith: encodedCounter.conflictsWith,
      unresolvedFactIds: own.contradictionContext.unresolvedFactIds, retiredStudentAlias: alias(retired.id), opaqueKeyAndProseUnchanged: true, roundtrip: true });
  });
});
