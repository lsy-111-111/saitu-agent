import { readDirectReviewWire } from "./helpers/v7-review-wire";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPublicDiagnosticFixture } from "./fixtures/v7-public-diagnostics";
import { matchPlanSchema, type MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { buildAssertionReviewPacketV7 } from "@/lib/competitions/v7/evidence-packet";
import { buildDecisionContextV7, DECISION_RANK_PROMPT_VERSION_V7, DECISION_EXPLAIN_PROMPT_VERSION_V7,
  rankDecisionV7, explainDecisionV7, type DecisionModelCallV7 } from "@/lib/competitions/v7/model";

const read = (name: string) => readPublicDiagnosticFixture(`artifacts/continuation-v7-20261109/${name}`);
const input = read("explanation-diagnostic-01/input.json"), registration = read("explanation-diagnostic-01/registration.json"), actual = read("explanation-diagnostic-01/result.json");
const ranking = read("pipeline-diagnostic-02/result.json");
const context = () => buildDecisionContextV7(input.originalProfile, { profile: structuredClone(input.profile), records: structuredClone(input.records), now: new Date(registration.asOf) });
type Context = ReturnType<typeof context>;
function codec(ctx: Context) {
  return createModelIdentifierCodec({ candidates: ctx.candidates.map(c => c.record.recordId), series: ctx.candidates.map(c => c.record.seriesId),
    facts: ctx.candidates.flatMap(c => c.record.facts.map(f => f.id)), students: ctx.profile.facts.map(f => f.id) });
}
const base = context();
const historicalExplanation = matchPlanSchema.parse(codec(base).decode(JSON.parse(actual.calls[0].saved.receipt.content)));
// Explicit offline Top5 fixture projection. The historical receipt stays intact
// and is never relabeled as a fresh five-item model result.
const originalExplanation = { ...historicalExplanation, recommendations: historicalExplanation.recommendations.slice(0, 5), shortfallReason: null };
// Expand transport tables/dictionaries only. Never identifier-decode before
// checking wire relationships: decoding first can hide mixed aliases/raw IDs.
function unaliasExpanded(prompt: string, review = false, plan = originalExplanation): any {
  const packet = JSON.parse(prompt);
  if (!review) return expandCandidateEvidence(expandMatchingTables(packet));
  if (!packet.evidenceBundle) {
    const keys = [...plan.recommendations.flatMap(item => [...item.reasons.map((_r, i) => `${item.itemId}.reason.${i}`), ...(item.roleReason ? [`${item.itemId}.role`] : [])]), ...(plan.comparison ? ["comparison"] : [])];
    return readDirectReviewWire(packet, keys);
  }
  const { evidenceBundle, ...rest } = packet;
  const { candidates, ...metadata } = expandCandidateEvidence(expandMatchingTables({ ...rest, candidates: evidenceBundle })) as any;
  expect(candidates).toHaveLength(1);
  return { ...metadata, ...candidates[0] };
}
type Captured = { stage: string; prompt: string; version: string };
async function capture(ctx: Context, plan: MatchPlanV6 = originalExplanation) {
  const requests: Captured[] = [];
  const modelCall: DecisionModelCallV7 = async (prompt, options) => {
    const stage = options.operation!.replace("competition_v7_", ""); requests.push({ stage, prompt, version: options.promptVersion! });
    const fullRank = JSON.parse(ranking.calls[0].saved.receipt.content);
    const data = stage === "rank" ? { ...fullRank, recommendations: fullRank.recommendations.slice(0, 5), shortfallReason: null }
      : stage === "explain" ? codec(ctx).encode(plan)
        : { checks: JSON.parse(prompt).assertions.map((row: { key: string }) => ({ key: row.key, supported: true, reason: "Explicit offline wiring fixture, not a fresh model verdict." })) };
    return { ok: true, data, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 0,
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } };
  };
  const ranked = await rankDecisionV7(ctx, { modelCall });
  await explainDecisionV7(ctx, ranked, { modelCall });
  expect(requests.map(r => r.stage)).toEqual(["rank", "explain", "review"]);
  return requests;
}
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_relationship_test_forbids_http"); })); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("production wire relationship IDs", () => {
  it("matches every real review allowedItemIds endpoint to the same wire @C entity", async () => {
    const requests = await capture(context());
    const wire = unaliasExpanded(requests[2].prompt, true);
    expect(wire.assertions).toHaveLength(10); expect(wire.assertionEvidence).toHaveLength(10);
    for (const row of wire.assertionEvidence) {
      expect(row.itemId).toMatch(/^@C\d+$/);
      expect(row.allowedItemIds).toEqual([row.itemId]);
      expect(row.competitionItems.map((c: any) => c.itemId)).toEqual(row.allowedItemIds);
      expect(wire.fixedOrder.itemIds).toContain(row.itemId);
      expect(wire.assertions.find((a: any) => a.key === row.key).itemId).toBe(row.itemId);
    }
    const expectedRows = originalExplanation.recommendations.flatMap(item => [...item.reasons.map((reason, i) => ({ key: `${item.itemId}.reason.${i}`, reason })),
      ...(item.roleReason ? [{ key: `${item.itemId}.role`, reason: item.roleReason }] : [])]);
    expect(wire.assertions.map((a: any) => a.key)).toEqual(expectedRows.map(r => r.key));
    expect(wire.assertions.map((a: any) => a.reason.text)).toEqual(expectedRows.map(r => r.reason.text));
  });

  it("preserves scope aliases for a comparison's exact first two items", async () => {
    const plan = structuredClone(originalExplanation), ctx = context();
    const facts = plan.recommendations.slice(0, 2).map(item => ctx.candidates.find(c => c.record.recordId === item.itemId)!.record.facts.find(f => f.field === "track")!);
    plan.comparison = { text: "Offline two-item scope fixture.", basis: "official", studentFactIds: [], competitionFactIds: facts.map(f => f.id), conditions: [] };
    const requests = await capture(ctx, plan), wire = unaliasExpanded(requests[2].prompt, true, plan), comparison = wire.assertionEvidence.find((row: any) => row.key === "comparison");
    expect(comparison.allowedItemIds).toEqual(wire.fixedOrder.itemIds.slice(0, 2));
    expect(comparison.competitionItems.map((c: any) => c.itemId)).toEqual(comparison.allowedItemIds);
  });

  it("keeps rank/explain/review retraction, supersession and update endpoints consistent without changing original words", async () => {
    const ctx = context(), live = ctx.profile.facts.find(f => f.id === originalExplanation.recommendations[0].reasons[0].studentFactIds[0])!;
    const old = { ...structuredClone(live), id: "zz-old-student", label: "Wire retracted student", originalText: "zz-old-student is original prose", state: "retracted" as const, confirmed: false };
    ctx.profile.facts.push(old); ctx.profile.retractedFactIds.push(old.id, "truly-unknown-student");
    live.supersedesFactIds = [old.id, "truly-unknown-student"];
    ctx.profile.updates = [{ id: "wire-update", answerId: "wire-update-answer", originalText: "Keep this original answer text.", updatedAt: "2026-11-09T00:00:00.000Z",
      previousRevision: ctx.profile.revision, removedFactIds: [old.id], addedFactIds: [live.id] }];
    const requests = await capture(ctx);
    for (const request of requests) {
      const wire = unaliasExpanded(request.prompt, request.stage === "review"), profile = wire.profile;
      const oldWire = profile.facts.find((f: any) => f.label === old.label), liveWire = profile.facts.find((f: any) => f.label === live.label);
      expect(oldWire.id).toMatch(/^@P\d+$/);
      expect(profile.retractedFactIds).toEqual(expect.arrayContaining([oldWire.id, "truly-unknown-student"]));
      expect(liveWire.supersedesFactIds).toEqual([oldWire.id, "truly-unknown-student"]);
      expect(profile.updates[0].removedFactIds).toEqual([oldWire.id]); expect(profile.updates[0].addedFactIds).toEqual([liveWire.id]);
      expect(oldWire.originalText).toBe(old.originalText); expect(oldWire.state).toBe("retracted");
      expect((codec(ctx).decode(wire) as any).profile).toEqual(ctx.profile);
    }
  });

  it("aliases known unresolved endpoints but never imports an out-of-record fact as support or counterevidence", async () => {
    const ctx = context(), itemId = originalExplanation.recommendations[0].itemId;
    const candidate = ctx.candidates.find(c => c.record.recordId === itemId)!, record = candidate.record;
    const cited = record.facts.find(f => f.id === originalExplanation.recommendations[0].reasons[0].competitionFactIds[0])!;
    const foreign = ctx.candidates.find(c => c.record.recordId !== itemId)!.record.facts.find(f => f.field === "track")!;
    const correction = { ...structuredClone(cited), id: "zz-wire-correction", text: "Wire correction remains counterevidence only.", status: "conflicting" as const,
      supersedes: [cited.id, foreign.id, "truly-unknown-fact"], conflictsWith: [cited.id] };
    record.facts.push(correction); record.cost = { scope: record.scope, minimumPersonalCny: null, maximumPersonalCny: null,
      factIds: [cited.id, foreign.id, "truly-unknown-fact"], note: "Offline unresolved-boundary fixture; no cost inferred." };
    const requests = await capture(ctx), wire = unaliasExpanded(requests[2].prompt, true);
    const own = wire.assertionEvidence.find((e: any) => e.itemId === (codec(ctx).encode({ itemId }) as any).itemId).competitionItems[0];
    const corrected = own.contradictionContext.facts.find((f: any) => f.text === correction.text);
    const citedId = own.citedFacts.find((f: any) => f.text === cited.text).id;
    const foreignId = (codec(ctx).encode({ id: foreign.id }) as any).id;
    expect(corrected.id).toMatch(/^@F\d+$/); expect(corrected.supersedes).toEqual([citedId, foreignId, "truly-unknown-fact"]);
    expect(corrected.conflictsWith).toEqual([citedId]);
    expect(own.contradictionContext.unresolvedFactIds).toEqual(expect.arrayContaining([foreignId, "truly-unknown-fact"]));
    expect([...own.citedFacts, ...own.contradictionContext.facts].some((f: any) => f.id === foreignId)).toBe(false);
    const boundary = wire.candidateBoundaries.find((c: any) => c.itemId === own.itemId);
    expect(boundary.unresolvedBoundaryFactIds).toEqual(expect.arrayContaining([foreignId, "truly-unknown-fact"]));
    expect(boundary.boundaryFacts.some((f: any) => f.id === foreignId)).toBe(false);
    const explainWire = unaliasExpanded(requests[1].prompt), explanationItem = explainWire.candidates.find((c: any) => c.itemId === own.itemId);
    expect(explanationItem.cost.factIds).toEqual([citedId, foreignId, "truly-unknown-fact"]);
    const rankWire = unaliasExpanded(requests[0].prompt), rankItem = rankWire.candidates.find((c: any) => c.itemId === own.itemId);
    expect(rankItem.personalCost).not.toHaveProperty("factIds");
    expect(rankItem.personalCost.verifiedCurrent).toBe(false);
  });

  it("does not widen primary citation permission after whole-pool aliases are known", () => {
    const ctx = context(), plan = structuredClone(originalExplanation), item = plan.recommendations[0];
    item.reasons[0].competitionFactIds = [ctx.candidates.find(c => c.record.recordId !== item.itemId)!.record.facts[0].id];
    expect(() => buildAssertionReviewPacketV7(ctx, plan, [{ key: `${item.itemId}.reason.0`, itemId: item.itemId, reason: item.reasons[0] }])).toThrow("invalid_review_competition_fact_scope");
  });

  it("binds changed rank and explanation transports to new explicit versions", () => {
    expect(DECISION_RANK_PROMPT_VERSION_V7).toBe("saitu-match.v7.17.mechanism-goal-path");
    expect(DECISION_EXPLAIN_PROMPT_VERSION_V7).toBe("saitu-explain.v7.26.future-material-path");
  });
});
