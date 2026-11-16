import { readDirectReviewWire } from "./helpers/v7-review-wire";
import { isDeepStrictEqual } from "node:util";
import { readPublicDiagnosticFixture } from "./fixtures/v7-public-diagnostics";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withDecisionEffortPolicy } from "@/lib/ai/effort-context";
import type { CatalogFact } from "@/lib/competitions/v6/catalog-types";
import { matchPlanSchema, type MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { isDecisionEvidenceFact } from "@/lib/competitions/v6/evidence";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { compactCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { compactMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { buildAssertionReviewPacketV7, compactAssertionReviewPacketV7, type ReviewAssertionV7 } from "@/lib/competitions/v7/evidence-packet";
import { buildDecisionContextV7, DECISION_EXPLAIN_PROMPT_VERSION_V7, DECISION_EXPLAIN_SYSTEM_PROMPT_V7, DECISION_REVIEW_SYSTEM_PROMPT_V7,
  explainDecisionV7, type DecisionModelCallV7 } from "@/lib/competitions/v7/model";

const read = (name: string) => readPublicDiagnosticFixture(`artifacts/continuation-v7-20261109/${name}`);
const input = read("explanation-diagnostic-01/input.json"), registration = read("explanation-diagnostic-01/registration.json"), actual = read("explanation-diagnostic-01/result.json");
const manual = read("real-output-review-01/claim-review.json") as { rows: { key: string; text: string; decision: { verdict: string } }[] };
const failedPublicRows = manual.rows.filter(row => row.decision.verdict === "needs_revision");
const context = () => buildDecisionContextV7(input.originalProfile, { profile: structuredClone(input.profile), records: structuredClone(input.records), now: new Date(registration.asOf) });
type Context = ReturnType<typeof context>;
function codec(ctx: Context) {
  return createModelIdentifierCodec({ candidates: ctx.candidates.map(c => c.record.recordId), series: ctx.candidates.map(c => c.record.seriesId),
    facts: ctx.candidates.flatMap(c => c.record.facts.map(f => f.id)), students: ctx.profile.facts.map(f => f.id) });
}
function explained(ctx: Context): MatchPlanV6 { return matchPlanSchema.parse(codec(ctx).decode(JSON.parse(actual.calls[0].saved.receipt.content))); }
function assertions(plan: MatchPlanV6): ReviewAssertionV7[] {
  return [...plan.recommendations.flatMap(item => [...item.reasons.map((reason, index) => ({ key: `${item.itemId}.reason.${index}`, itemId: item.itemId, reason })),
    ...(item.roleReason ? [{ key: `${item.itemId}.role`, itemId: item.itemId, reason: item.roleReason }] : [])]),
    ...(plan.comparison ? [{ key: "comparison", itemId: plan.recommendations[0].itemId, reason: plan.comparison }] : [])];
}
function fixture() { const ctx = context(), plan = explained(ctx); return { ctx, plan, rows: assertions(plan) }; }

// Independent format reader: table expansion precedes dictionary substitution
// because arrays of text references can themselves be represented as tables.
function expandWire(value: unknown, review = false, originalKeys = assertions(explained(context())).map(row => row.key)): Record<string, unknown> {
  const wire = value as Record<string, any>, schemas = wire.tableSchemas ?? {}, dict = wire.evidenceDictionary ?? { texts: {}, scopes: {} };
  if (review && !wire.evidenceBundle) return readDirectReviewWire(wire, originalKeys);
  const table = (v: any): any => {
    if (Array.isArray(v)) return v.map(table);
    if (!v || typeof v !== "object") return v;
    if (Object.keys(v).sort().join(",") === "$table,rows") {
      const cols = schemas[v.$table]; if (!Array.isArray(cols)) throw new Error("missing_schema");
      return v.rows.map((row: unknown[]) => { if (row.length !== cols.length) throw new Error("arity"); return Object.fromEntries(cols.map((key: string, i: number) => [key, table(row[i])])); });
    }
    return Object.fromEntries(Object.entries(v).map(([k, child]) => [k, table(child)]));
  };
  const text = (v: any): any => {
    if (Array.isArray(v)) return v.map(text);
    if (!v || typeof v !== "object") return v;
    if (Object.keys(v).length === 1 && ("$text" in v || "$scope" in v)) {
      const collection = "$text" in v ? dict.texts : dict.scopes, key = v.$text ?? v.$scope;
      if (!Object.hasOwn(collection, key)) throw new Error("missing_dictionary"); return structuredClone(collection[key]);
    }
    return Object.fromEntries(Object.entries(v).map(([k, child]) => [k, text(child)]));
  };
  const { tableSchemas: _t, evidenceDictionary: _d, ...rest } = wire;
  if (!review) return { ...rest, candidates: text(table(wire.candidates)) };
  const { evidenceBundle: _bundle, ...metadata } = rest;
  const bundle = text(table(wire.evidenceBundle)); expect(bundle).toHaveLength(1);
  return { ...metadata, ...bundle[0] };
}

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_test_forbids_http"); })); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("v7 assertion reference packets on the real public twenty-claim output", () => {
  it("keeps all twenty claims and the complete profile including affirmed absence", () => {
    const { ctx, plan, rows } = fixture(), packet = buildAssertionReviewPacketV7(ctx, plan, rows);
    expect(rows).toHaveLength(20); expect(packet.assertions).toEqual(rows); expect(packet.profile).toEqual(ctx.profile);
    const absence = ctx.profile.facts.find(f => f.field === "experienceStatus")!;
    expect(absence.value).toBe("none"); expect(absence.state).toBe("affirmed"); expect(absence.confirmed).toBe(true);
    for (const item of packet.assertionEvidence) expect(item.studentCounterEvidence.facts).toContainEqual(absence);
    expect(packet.candidateBoundaries.map(c => c.conditions)).toEqual(plan.recommendations.map(item => ctx.candidates.find(c => c.record.recordId === item.itemId)!.conditions));
  });
  it("binds every complete cited fact/source only to its own assertion", () => {
    const { ctx, plan, rows } = fixture(), packet = buildAssertionReviewPacketV7(ctx, plan, rows);
    expect(packet.assertionEvidence.map(e => e.key)).toEqual(rows.map(r => r.key));
    for (const e of packet.assertionEvidence) {
      const own = rows.find(r => r.key === e.key)!;
      expect(e.competitionItems.flatMap(c => c.citedFacts.map(f => f.id))).toEqual(own.reason.competitionFactIds);
      expect(e.citedStudentFacts).toEqual(own.reason.studentFactIds.map(id => ctx.profile.facts.find(f => f.id === id)));
      for (const c of e.competitionItems) {
        const record = ctx.candidates.find(r => r.record.recordId === c.itemId)!.record;
        for (const fact of c.citedFacts) expect(fact).toEqual(record.facts.find(f => f.id === fact.id));
        expect(c.sources).toEqual(record.sources.filter(s => c.citedFacts.some(f => f.sourceIds.includes(s.id))));
      }
    }
  });
  it.each(failedPublicRows)("retains the real failed claim $key without uncited editorial task/role support", row => {
    const { ctx, plan, rows } = fixture(), packet = buildAssertionReviewPacketV7(ctx, plan, rows), own = packet.assertionEvidence.find(e => e.key === row.key)!;
    expect(packet.assertions.find(a => a.key === row.key)!.reason.text).toBe(row.text);
    expect(own.competitionItems.flatMap(c => c.citedFacts.map(f => f.id))).toEqual(rows.find(a => a.key === row.key)!.reason.competitionFactIds);
    expect(own).not.toHaveProperty("sections");
    if (own.editorialRoleIdentity) expect(Object.keys(own.editorialRoleIdentity).sort()).toEqual(["name", "prerequisite", "roleIndex", "use"]);
  });
  it("does not supply the uncited Taylor route or public-reference rubric as support", () => {
    const { ctx, plan, rows } = fixture(), packet = buildAssertionReviewPacketV7(ctx, plan, rows);
    const own = packet.assertionEvidence.find(e => e.key.includes("national-college-mathematics") && e.key.endsWith("reason.0"))!;
    expect(own.competitionItems[0].citedFacts).toHaveLength(3);
    expect(own.competitionItems[0].citedFacts.every(f => !/泰勒|Taylor/.test(f.text))).toBe(true);
    expect(own.competitionItems[0].citedFacts.some(f => f.field === "rubric")).toBe(false);
    expect(own.editorialRoleIdentity).toBeUndefined();
    expect(DECISION_EXPLAIN_SYSTEM_PROMPT_V7).toContain("text及conditions中的每个事实性细节都必须由本条");
    expect(DECISION_REVIEW_SYSTEM_PROMPT_V7).toContain("任一事实性子句无本条引用完整支持即supported=false");
  });
  it("roundtrips the entire encoded closure with the existing codecs and separate reader", () => {
    const { ctx, plan, rows } = fixture(), packet = buildAssertionReviewPacketV7(ctx, plan, rows);
    const encoded = codec(ctx).encode(packet), packed = compactAssertionReviewPacketV7(encoded);
    expect(expandWire(packed, true)).toEqual(encoded);
    expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(encoded).length);
    expect(packet.candidateBoundaries.every(c => c.boundaryFacts.every(f => c.boundarySourceBindings.sources.some(s => f.sourceIds.includes(s.id)) || !f.sourceIds.length))).toBe(true);
  });
  it("preserves every explicit section/value condition, unknown and difficulty assumption", () => {
    const { ctx, plan, rows } = fixture(), packet = buildAssertionReviewPacketV7(ctx, plan, rows);
    for (const b of packet.candidateBoundaries) {
      const record = ctx.candidates.find(c => c.record.recordId === b.itemId)!.record;
      const expected = Object.values(record.sections).flat().filter(c => c.conditions.length || c.kind === "unknown" || c.unknownReason);
      for (const c of expected) expect(b.qualifiers.some(q => JSON.stringify(q.value) === JSON.stringify(c))).toBe(true);
      for (const value of record.valueDimensions.filter(v => v.assessment.conditions.length || v.assessment.kind === "unknown" || v.assessment.unknownReason)) expect(b.qualifiers.some(q => JSON.stringify(q.value) === JSON.stringify(value.assessment))).toBe(true);
      expect(b.difficultyAssumptions).toEqual(record.difficulty.map(({ stage, assumptions, factIds }) => ({ stage, assumptions, factIds })));
    }
  });
});

describe("directed counterevidence and profile boundary counterexamples", () => {
  it.each(["supersedes", "conflictsWith"] as const)("keeps a natural incoming-only %s edge and transitive correction without making it positive support", edge => {
    const { ctx, plan, rows } = fixture(), first = rows[0], record = ctx.candidates.find(c => c.record.recordId === first.itemId)!.record;
    const cited = record.facts.find(f => f.id === first.reason.competitionFactIds[0])!;
    const added: CatalogFact = { ...structuredClone(cited), id: `counter-${edge}`, text: "此原文是单向反证，不是当前断言的正面支持。", supersedes: [], conflictsWith: [], status: "conflicting" };
    added[edge] = [cited.id];
    const later = { ...structuredClone(added), id: `later-${edge}`, supersedes: [added.id], conflictsWith: [] };
    record.facts.push(added, later);
    const packet = buildAssertionReviewPacketV7(ctx, plan, [first]), support = packet.assertionEvidence[0].competitionItems[0];
    expect(support.citedFacts.map(f => f.id)).toEqual(first.reason.competitionFactIds);
    expect(support.contradictionContext.facts).toContainEqual(added); expect(support.contradictionContext.facts).toContainEqual(later);
    expect(support.contradictionContext.use).toContain("not_positive_support");
  });
  it("never imports a cross-record incoming correction as same-item counterevidence", () => {
    const { ctx, plan, rows } = fixture(), first = rows[0], record = ctx.candidates.find(c => c.record.recordId === first.itemId)!.record;
    const foreign = ctx.candidates.find(c => c.record.recordId !== first.itemId)!.record;
    const extra = { ...structuredClone(record.facts[0]), id: "foreign-correction", supersedes: [first.reason.competitionFactIds[0]] };
    foreign.facts.push(extra);
    const own = buildAssertionReviewPacketV7(ctx, plan, [first]).assertionEvidence[0].competitionItems[0];
    expect(own.contradictionContext.facts.some(f => f.id === extra.id)).toBe(false);
  });
  it("keeps negative, conditional, unknown, retracted and affirmed absence words with optional supersession omitted", () => {
    const { ctx, plan, rows } = fixture();
    ctx.profile.facts.forEach(f => { delete f.supersedesFactIds; });
    for (const [index, state] of (["negated", "conditional", "unknown", "retracted"] as const).entries()) ctx.profile.facts.push({ ...ctx.profile.facts[0], id: `boundary-${index}`, state, confirmed: state === "negated", originalText: `保留${state}原话` });
    for (const value of ["未做过", "none", false]) ctx.profile.facts.push({ ...ctx.profile.facts[0], id: `absence-${String(value)}`, state: "affirmed", confirmed: true, value, originalText: `原始absence:${value}` });
    ctx.profile.retractedFactIds.push("boundary-3");
    const packet = buildAssertionReviewPacketV7(ctx, plan, rows);
    expect(packet.profile).toEqual(ctx.profile);
    for (const own of packet.assertionEvidence) expect(own.studentCounterEvidence.facts.map(f => f.id)).toEqual(expect.arrayContaining(["boundary-0", "boundary-1", "boundary-2", "boundary-3", "absence-未做过", "absence-none", "absence-false"]));
  });
  it("rejects unknown/inactive/cross-item primary citations, never drops their assertions", () => {
    const { ctx, plan, rows } = fixture();
    const wrong = structuredClone(plan); wrong.recommendations[0].reasons[0].competitionFactIds = [ctx.candidates.find(c => c.record.recordId !== wrong.recommendations[0].itemId)!.record.facts[0].id];
    expect(() => buildAssertionReviewPacketV7(ctx, wrong, [assertions(wrong)[0]])).toThrow("invalid_review_competition_fact_scope");
    const student = ctx.profile.facts.find(f => f.id === rows[0].reason.studentFactIds[0])!; student.state = "retracted";
    expect(() => buildAssertionReviewPacketV7(ctx, plan, [rows[0]])).toThrow("inactive_review_student_fact");
  });
  it("rejects duplicate assertion keys and ambiguous same-record primary fact IDs", () => {
    const { ctx, plan, rows } = fixture();
    expect(() => buildAssertionReviewPacketV7(ctx, plan, [rows[0], rows[0]])).toThrow("invalid_review_assertion_keys");
    const record = ctx.candidates.find(c => c.record.recordId === rows[0].itemId)!.record;
    record.facts.push(structuredClone(record.facts.find(f => f.id === rows[0].reason.competitionFactIds[0])!));
    expect(() => buildAssertionReviewPacketV7(ctx, plan, [rows[0]])).toThrow("invalid_review_competition_fact_scope");
  });
  it("binds comparison to the first two items and rejects a third-item citation", () => {
    const { ctx, plan } = fixture();
    const chosen = plan.recommendations.slice(0, 2).map(item => ctx.candidates.find(c => c.record.recordId === item.itemId)!.record.facts.find(f => f.field === "track")!);
    plan.comparison = { text: "离线comparison结构样例，保留双方原始范围。", basis: "official", studentFactIds: [], competitionFactIds: chosen.map(f => f.id), conditions: ["不得借第三项补证"] };
    const row = assertions(plan).at(-1)!;
    expect(buildAssertionReviewPacketV7(ctx, plan, [row]).assertionEvidence[0].allowedItemIds).toEqual(plan.recommendations.slice(0, 2).map(r => r.itemId));
    plan.comparison.competitionFactIds.push(ctx.candidates.find(c => c.record.recordId === plan.recommendations[2].itemId)!.record.facts.find(f => f.field === "track")!.id);
    expect(() => buildAssertionReviewPacketV7(ctx, plan, [assertions(plan).at(-1)!])).toThrow("invalid_review_competition_fact_scope");
  });
});

async function replay(failedKey?: string, mutateVerdict?: (v: any) => void) {
  const ctx = context(), fullPlan = matchPlanSchema.parse(actual.plan), fullExplanation = explained(ctx);
  // The historical ten-item receipt above stays intact. Exercise the new
  // production limit with a five-item fixture containing the targeted owner,
  // so every original failed public assertion still receives its own test.
  const failedOwner = assertions(fullExplanation).find(row => row.key === failedKey)?.itemId;
  const start = failedOwner ? Math.floor(fullPlan.recommendations.findIndex(item => item.itemId === failedOwner) / 5) * 5 : 0;
  const plan = { ...fullPlan, recommendations: fullPlan.recommendations.slice(start, start + 5), shortfallReason: null };
  const ids = new Set(plan.recommendations.map(item => item.itemId));
  const { comparison, ...explanationBody } = fullExplanation;
  const explanation = { ...explanationBody, recommendations: fullExplanation.recommendations.filter(item => ids.has(item.itemId)), shortfallReason: null,
    ...(start === 0 && comparison ? { comparison } : {}) };
  const rows = assertions(explanation), requests: { stage: string; prompt: string; options: any }[] = [];
  if (failedKey && !rows.some(row => row.key === failedKey)) throw new Error("missing_targeted_public_assertion");
  const modelCall: DecisionModelCallV7 = async (prompt, options) => {
    const stage = options.operation!.replace("competition_v7_", ""); requests.push({ stage, prompt, options });
    let data: any;
    if (stage === "explain") data = codec(ctx).encode(explanation);
    else if (stage === "review") {
      const payload = JSON.parse(prompt);
      data = { checks: payload.assertions.map((row: { key: string }) => ({ key: row.key, supported: row.key !== `R${String(rows.findIndex(value => value.key === failedKey) + 1).padStart(2, "0")}`, reason: "离线明确注入判定，只验证错误传播与完整覆盖，不是新模型判断。" })) };
      mutateVerdict?.(data);
    } else throw new Error("unexpected_stage_no_dispatch");
    // Match the production success union. This is an injected offline transport
    // fixture; fetch is forbidden and no provider/ledger work executes.
    return { ok: true, data, model: "deepseek-flash", durationMs: 0, attempts: 1, upstreamAttempted: true,
      finishReason: "stop", httpStatus: 200, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } };
  };
  const promise = withDecisionEffortPolicy({ version: "saitu.effort-policy.v1", rank: "low", explain: "low", review: "low" }, () =>
    explainDecisionV7(ctx, plan, { modelCall, deadlineEpochMs: Date.now() + 90_000 }));
  return { ctx, requests, promise, rows };
}

describe("production explanation/review wiring without HTTP", () => {
  it("replays five items/ten checks with lossless explanation evidence, full profile, low and one-attempt bounds", async () => {
    const { ctx, requests, promise, rows } = await replay(); const report = await promise;
    expect(report.recommendations).toHaveLength(5); expect(report.trace.supportChecks).toBe(10);
    expect(requests.map(r => r.stage)).toEqual(["explain", "review"]);
    const explain = codec(ctx).decode(expandWire(JSON.parse(requests[0].prompt))) as any;
    expect(explain.profile).toEqual(ctx.profile);
    for (const c of explain.candidates) {
      const record = ctx.candidates.find(row => row.record.recordId === c.itemId)!.record;
      const expectedClaim = (value: typeof record.sections.task[number]) => value.kind === "editorial_inference"
        ? { ...value, use: "optional_editorial_advice_not_official_requirement", factIdsArePremisesOnly: true } : value;
      for (const sectionName of ["investment", "eligibility", "participation", "difficulty"] as const) expect(c.sections[sectionName]).toEqual(record.sections[sectionName].map(expectedClaim));
      for (const [sectionName, claims] of Object.entries(record.sections)) for (const value of claims) {
        const sameSection = (c.sections[sectionName] ?? []).some((row: unknown) => isDeepStrictEqual(row, expectedClaim(value)));
        if (sameSection) continue;
        expect(value.conditions).toEqual([]); expect(value.unknownReason).toBeFalsy(); expect(value.kind).not.toBe("unknown");
        // Coverage comes from the captured wire, never from the projection
        // helper: complete official facts or complete same-kind editorial data.
        if (value.kind === "official_fact") {
          expect(value.factIds).toHaveLength(1);
          expect(c.facts).toContainEqual(record.facts.find(fact => fact.id === value.factIds[0] && fact.text === value.text && fact.kind === value.kind));
        } else {
          const roleCoverage = c.roles.some((role: any) => role.kind === value.kind && value.text === `${role.name}：${role.task}。需要的经历证据：${role.evidenceToAsk}` && JSON.stringify(role.factIds) === JSON.stringify(value.factIds));
          const assessmentCoverage = c.valueDimensions.some(({ assessment }: any) => assessment.kind === value.kind && assessment.text === value.text
            && JSON.stringify(assessment.factIds) === JSON.stringify(value.factIds) && JSON.stringify(assessment.conditions) === JSON.stringify(value.conditions));
          expect(roleCoverage || assessmentCoverage).toBe(true);
        }
      }
      for (const [sectionName, claims] of Object.entries(c.sections)) for (const value of claims as unknown[]) expect(record.sections[sectionName as keyof typeof record.sections].map(expectedClaim)).toContainEqual(value);
      expect(c.roles).toEqual(record.roles.map((role, roleIndex) => ({ roleIndex, ...role, kind: "editorial_inference", use: "optional_editorial_advice_not_official_requirement", factIdsArePremisesOnly: true })));
      expect(c.valueDimensions).toEqual(record.valueDimensions); expect(c.difficulty).toEqual(record.difficulty);
      expect(c.cost).toEqual(record.cost ?? null); expect(c.participationRequirements).toEqual(record.participationRequirements ?? null);
      expect(c.sourceBoundary?.sourceBoundary ?? null).toBe(record.deepDive?.workedExample.sourceBoundary ?? null);
      const usedSourceIds = new Set([...c.facts.flatMap((fact: typeof record.facts[number]) => fact.sourceIds), ...(record.deepDive?.workedExample.sourceIds ?? [])]);
      expect(c.sources).toEqual(record.sources.filter(source => usedSourceIds.has(source.id)).map(({ evidenceArtifact: _artifact, verificationMethod: _method, retrievedAt: _retrieved, ...source }) => source));
      expect(c.facts).toEqual(record.facts.filter(fact => isDecisionEvidenceFact(record, fact)));
    }
    expect(ctx.records).toEqual(input.records); expect(ctx.profile).toEqual(input.profile);
    const review = codec(ctx).decode(expandWire(JSON.parse(requests[1].prompt), true, rows.map(row => row.key))) as any;
    expect(review.profile).toEqual(ctx.profile); expect(review.assertions).toEqual(rows);
    expect(review.assertionEvidence).toHaveLength(10);
    for (const r of requests) {
      expect(r.options.thinking).toBe("enabled"); expect(r.options.reasoningEffort).toBe("low"); expect(r.options.maxAttempts).toBe(1);
      expect(r.options.timeoutMs).toBeLessThanOrEqual(90_000); expect(r.options.maxTokens).toBe(16384);
      expect(r.options.promptVersion).toBe(`${DECISION_EXPLAIN_PROMPT_VERSION_V7}.${r.options.operation?.replace("competition_v7_", "")}`);
    }
    // This codec control is fully lossless, unlike the intentional review projection.
    const raw = { candidates: explain.candidates, profile: explain.profile };
    expect(expandWire(compactMatchingTables(compactCandidateEvidence(raw)))).toEqual(raw);
  });
  it.each(failedPublicRows)("surfaces an injected false verdict for $key while reviewing every original claim in its Top5 fixture", async row => {
    const { requests, promise, rows } = await replay(row.key);
    await expect(promise).rejects.toThrow("unsupported_reason");
    expect(requests.map(r => r.stage)).toEqual(["explain", "review"]);
    const wire = JSON.parse(requests[1].prompt); expect(wire.assertions).toHaveLength(10);
    expect(readDirectReviewWire(wire, rows.map(value => value.key)).assertions.find(a => a.key === row.key)?.reason).toMatchObject({ text: row.text });
  });
  it.each(["missing", "duplicate", "unknown"])("rejects %s review keys without retrying or reducing support checks", async kind => {
    const { requests, promise } = await replay(undefined, verdict => {
      if (kind === "missing") verdict.checks.pop();
      else if (kind === "duplicate") verdict.checks[1] = verdict.checks[0];
      else verdict.checks[0].key = "outside-key";
    });
    await expect(promise).rejects.toThrow("incomplete_support_review");
    expect(requests.map(r => r.stage)).toEqual(["explain", "review"]);
  });
  it("preserves the strict review output schema", async () => {
    const { requests, promise } = await replay(undefined, verdict => { verdict.extra = true; });
    await expect(promise).rejects.toThrow("invalid_output"); expect(requests).toHaveLength(2);
  });
});
