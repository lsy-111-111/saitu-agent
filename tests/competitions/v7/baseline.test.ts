import { describe, expect, it } from "vitest";
import { buildBaselineMatchPlanV7, BASELINE_E5_MODEL_V7, BASELINE_E5_REVISION_V7 } from "@/lib/competitions/v7/baseline";
import { buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import { student, syntheticRecord } from "../v6/decision-fixtures";

function provider(onEmbed?: (texts: string[]) => void) {
  return { model: BASELINE_E5_MODEL_V7, revision: BASELINE_E5_REVISION_V7, embed: async (texts: string[]) => { onEmbed?.(texts); return texts.map(() => [1, 0]); } };
}
function context() {
  return buildDecisionContextV7(student({ skills: ["data-analysis"], interests: ["data"], confirmedFields: ["stage", "skills", "interests"] }), {
    records: Array.from({ length: 12 }, (_, index) => syntheticRecord(index + 1)),
  });
}

describe("v7 transparent local B adapter", () => {
  it("scores the exact full C pool and returns five distinct series with complete local diagnostics", async () => {
    const ctx = context(), before = structuredClone(ctx), sent: string[][] = [];
    const { plan, diagnostics } = await buildBaselineMatchPlanV7(ctx, { embeddingProvider: provider(texts => sent.push(texts)), candidateOrder: [...ctx.candidates].reverse().map(candidate => candidate.record.recordId), seed: 71 });
    expect(sent).toHaveLength(1); expect(sent[0]).toHaveLength(13);
    expect(plan.recommendations).toHaveLength(5);
    expect(new Set(plan.recommendations.map(item => ctx.candidates.find(candidate => candidate.record.recordId === item.itemId)!.record.seriesId)).size).toBe(5);
    expect(diagnostics).toMatchObject({ algorithm: "B", providerDispatch: false, candidateCount: 12, seed: 71, retrieval: { rrfK: 60, recallApplied: false, independentRecall: false }, reranking: { weights: { fit: 0.9, retrieval: 0.1 } } });
    expect(diagnostics.scores).toHaveLength(12); expect(diagnostics.evidencePacks).toHaveLength(12);
    expect(diagnostics.evidencePacks[0].facts[0].sourceIds).toContain(diagnostics.evidencePacks[0].sources[0].id);
    expect(ctx).toEqual(before);
  });
  it("recomputes native fit instead of consuming stale v6 candidate scores and preserves unknown intervals", async () => {
    const ctx = context();
    const first = await buildBaselineMatchPlanV7(ctx, { embeddingProvider: provider() });
    for (const candidate of ctx.candidates) candidate.nativeScore = { lower: 100, upper: 100, dimensions: [] };
    const poisoned = await buildBaselineMatchPlanV7(ctx, { embeddingProvider: provider(), candidateOrder: [...ctx.candidates].reverse().map(candidate => candidate.record.recordId) });
    expect(poisoned.plan.recommendations.map(item => item.itemId)).toEqual(first.plan.recommendations.map(item => item.itemId));
    expect(poisoned.diagnostics.scores.some(row => row.unknowns.includes("experience"))).toBe(true);
    expect(poisoned.diagnostics.scores.every(row => row.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0) === 100)).toBe(true);
  });
  it("fails when the evaluator passes a shortlist, duplicate order, or unpinned embedding model", async () => {
    const ctx = context(), ids = ctx.candidates.map(candidate => candidate.record.recordId);
    await expect(buildBaselineMatchPlanV7(ctx, { embeddingProvider: provider(), candidateOrder: ids.slice(0, 5) })).rejects.toThrow("same_candidate_pool");
    await expect(buildBaselineMatchPlanV7(ctx, { embeddingProvider: provider(), candidateOrder: ids.map(() => ids[0]) })).rejects.toThrow("same_candidate_pool");
    await expect(buildBaselineMatchPlanV7(ctx, { embeddingProvider: { ...provider(), revision: "a".repeat(40) } })).rejects.toThrow("pinned_local_e5");
  });
  it("does not replace unavailable E5 by a lexical-only or model fallback", async () => {
    await expect(buildBaselineMatchPlanV7(context(), { embeddingProvider: { ...provider(), embed: async () => { throw new Error("missing_local_weights"); } } })).rejects.toThrow("missing_local_weights");
  });
});
