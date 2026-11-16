import { describe, expect, it } from "vitest";
import { RECOMMENDATION_MAX_ITEMS, RECOMMENDATION_EXECUTION_POLICY } from "@/lib/competitions/v7/contracts";
import { EVALUATION_POLICY, POLICY_VERSION, POLICY_SHA256, canonicalHash, requirePolicy } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { scorePerformance, scoreRankingGate } from "../../../scripts/competitions/v7/evaluation-score.mjs";
import { inspectPublicAdmission } from "../../../scripts/competitions/v7/evaluation-registration.mjs";
import { TOP5_HTTP_BOUNDS, operationHttpUpperBound, planEvaluationMatrix } from "../../../scripts/competitions/v7/evaluation-matrix.mjs";
import { deriveRunSeed, seededShuffle } from "../../../scripts/competitions/v6/frozen-ranking-executor.mjs";
import { evaluationFixture } from "./evaluation.fixture";

function full45Fixture() {
  const f = evaluationFixture(), ids = Array.from({ length: 45 }, (_, i) => `item-${i}`);
  for (const p of f.matrix.profileSnapshot.profiles) p.candidateItemIds = [...ids];
  for (const p of f.matrix.rankings.profiles) {
    p.poolItemIds = [...ids]; p.judgments = ids.map(itemId => ({ itemId, seriesId: itemId, relevance: "U" }));
  }
  for (const original of f.gold.originals) for (const p of original.profiles) {
    p.poolItemIds = [...ids]; p.judgments = ids.map((itemId, i) => ({ itemId, relevance: i < 44 ? 3 : 1, reason: "invented full-pool grade" }));
  }
  for (const o of f.matrix.observations) {
    o.candidateSetSha256 = canonicalHash([...ids].sort()); o.shuffleSeed = deriveRunSeed(f.matrix.seed, o.profileId, o.repetition + 1);
    o.candidateOrder = seededShuffle(ids, o.shuffleSeed);
    f.matrix.rankings.runs.find((r: any) => r.invocationId === o.invocationId).candidateSetSha256 = o.candidateSetSha256;
  }
  f.gold.profilePoolSha256 = canonicalHash(f.matrix.rankings.profiles.map((p: any) => ({ profileId: p.profileId, familyId: p.familyId, taskGroup: p.taskGroup,
    poolItemIds: p.poolItemIds, series: p.judgments.map(({ itemId, seriesId }: any) => ({ itemId, seriesId })) })));
  return f;
}
function replaceDisplay(f: ReturnType<typeof evaluationFixture>, arm: string, count: number) {
  for (const o of f.matrix.observations.filter((o: any) => o.algorithm === arm)) {
    o.output.recommendations = f.matrix.profileSnapshot.profiles[0].candidateItemIds.slice(0, count).map((itemId: string) => ({ itemId }));
    o.outputSha256 = canonicalHash(o.output);
    Object.assign(f.matrix.rankings.runs.find((r: any) => r.invocationId === o.invocationId), { displayedItemIds: o.output.recommendations.map((r: any) => r.itemId), outputSha256: o.outputSha256 });
  }
}
const score = (f: ReturnType<typeof evaluationFixture>) => scoreRankingGate(f.matrix, f.gold, f.manifest, f.registration.registeredAt);

describe("Top5 evaluation contract", () => {
  it("binds the product five-item limit, low stages, 40/120 targets and 60/150 cutoffs to a new policy", () => {
    expect(POLICY_VERSION).toBe(RECOMMENDATION_EXECUTION_POLICY.policyVersion);
    expect(EVALUATION_POLICY.recommendationMaxItems).toBe(RECOMMENDATION_MAX_ITEMS);
    expect(EVALUATION_POLICY.performance).toMatchObject({ firstListP95Ms: RECOMMENDATION_EXECUTION_POLICY.listTargetMs,
      rankHardTimeoutMs: RECOMMENDATION_EXECUTION_POLICY.rankHardTimeoutMs, allDetailsP95Ms: RECOMMENDATION_EXECUTION_POLICY.detailTargetMs,
      detailHardTimeoutMs: RECOMMENDATION_EXECUTION_POLICY.detailHardTimeoutMs, readyExpansionP95Ms: 1000, samples: 100, desktop: 50, mobile: 50 });
    expect(EVALUATION_POLICY.runtime).toMatchObject({ thinking: "enabled", effortPolicy: { rank: "low", explain: "low", review: "low" } });
    expect(EVALUATION_POLICY.ranking).not.toHaveProperty("ndcg10");
    expect(() => requirePolicy({ policyVersion: "saitu.policy.2026-11-09.v7", policySha256: POLICY_SHA256 })).toThrow("policy_binding");
  });
  it("scores five displayed results against all 45 candidates and retires the nDCG10 gate", () => {
    const f = full45Fixture(), r = score(f);
    expect(r.status).toBe("passed"); expect(r.execution).toMatchObject({ reports: 1200, independentFamilies: 120, repetitions: 5, actualModelRuns: 600 });
    expect(r.ranking.summaries.every((a: any) => a.pooledNdcg5 === 1 && a.pooledNdcg10 < .80)).toBe(true);
    replaceDisplay(f, "C", 1);
    const short = score(f);
    expect(short.ranking.summaries.find((a: any) => a.algorithm === "C").pooledNdcg5).toBeLessThan(.4);
    expect(short.blockers).toContain("C_pooledNdcg5_below_gate");
    expect(f.matrix.rankings.profiles.every((p: any) => p.poolItemIds.length === 45)).toBe(true);
  });
  it.each(["B", "C"])("rejects a sixth actual displayed result from arm %s", arm => {
    const f = full45Fixture(); replaceDisplay(f, arm, 6); expect(() => score(f)).toThrow("top5_original_recommendation_limit_exceeded");
  });
  it("keeps failed requests with existing timestamps in the 100-request p95 denominator", () => {
    const samples = Array.from({ length: 100 }, (_, i) => ({ requestId: `synthetic-${i}`, device: i < 50 ? "desktop" : "mobile",
      clock: EVALUATION_POLICY.performance.clock, originalSubmittedAt: "2026-11-09T00:00:00.000Z", listRenderedAt: "2026-11-09T00:00:40.000Z",
      detailsRenderedAt: "2026-11-09T00:02:00.000Z", readyExpansionSucceeded: true, readyExpansionMs: 1000, completeFlowSucceeded: true, realProviderDispatch: true }));
    expect(scorePerformance(samples).status).toBe("passed");
    for (const s of samples.slice(0, 6)) s.completeFlowSucceeded = false;
    expect(scorePerformance(samples)).toMatchObject({ denominator: 100, failedListAttempts: 6, failedDetailAttempts: 6, firstListP95Ms: null, allDetailsP95Ms: null, readyExpansionP95Ms: null, status: "failed" });
  });
  it("requires four of the same five public runs to jointly meet content and timing targets", () => {
    const h = canonicalHash("invented"), config = Object.fromEntries(["implementationSha256", "runtimeConfigurationSha256", "catalogSha256", "candidatePoolSha256", "runtimeSourceBindingSha256"].map(k => [k, h]));
    const admission = { schemaVersion: "saitu.public-admission.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, ...config,
      authorContextId: "synthetic-author", independentReview: { contextId: "synthetic-reviewer", passed: true, evidenceSha256: h },
      runs: Array.from({ length: 5 }, (_, i) => ({ invocationId: `synthetic-${i}`, receiptSha256: h, realProviderDispatch: true, success: true, pageDelivered: true, criticalReviewPassed: true,
        timing: { timeOrigin: 1000, start: 10, listMs: 40000, allDetailsMs: 120000, readyExpansionMs: 1000 } })) };
    expect(inspectPublicAdmission(admission, config)).toEqual([]);
    admission.runs[0].timing.allDetailsMs++; expect(inspectPublicAdmission(admission, config)).toEqual([]);
    admission.runs[1].timing.listMs++; expect(inspectPublicAdmission(admission, config)).toContain("new_public_five_runs_require_four_real_successes");
  });
  it("plans finite operation bounds and protects unknown holds without inventing measured costs", () => {
    const conversation = { operation: "conversation", input: { prepareReport: true, rerankAfterUpdates: true, turns: Array.from({ length: 12 }, () => ({ text: "invented" })) } };
    expect(operationHttpUpperBound(conversation)).toBe(77);
    expect(operationHttpUpperBound({ operation: "robustness", input: { base: conversation, perturbed: conversation } })).toBe(154);
    expect(TOP5_HTTP_BOUNDS.report).toBe(5);
    const p = planEvaluationMatrix({ schemaVersion: "saitu.evaluation-cost-input.v7.1", balanceCny: 208.7, unknownHeldCny: 26.65914,
      cumulativeChargedOrHeldCny: 42.125167, fundedLimitCny: 300, totalCapCny: 300, estimates: {} });
    expect(p.remainingCny).toBeCloseTo(182.04086); expect(p.conservativeReservedCny).toBeNull(); expect(p.affordable).toBeNull();
    expect(p.finiteBatchCeiling).toEqual({ calls: 1000, fundingCny: 100, createsAuthorization: false });
    expect(p.simulationComparison).toMatchObject({ pairs: 60, originalReportsReused: 120, additionalRecommendationPaidInvocations: 0 });
  });
});
