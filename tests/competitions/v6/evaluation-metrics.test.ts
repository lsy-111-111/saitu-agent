import { describe, expect, it } from "vitest";
import {
  evaluateRankings, pairedFamilyBootstrap, pooledNdcg, topKJaccard,
  type EvaluationProfile, type RankingEvaluationInput, type RankingRun
} from "../../../scripts/competitions/v6/evaluate-rankings";

const profile = (id = "p1", family = "f1"): EvaluationProfile => ({
  profileId: id, familyId: family, taskGroup: "software-data", annotationStatus: "synthetic",
  poolItemIds: ["a1", "a2", "b", "c"],
  judgments: [
    { itemId: "a1", seriesId: "a", relevance: 3 },
    { itemId: "a2", seriesId: "a", relevance: 3 },
    { itemId: "b", seriesId: "b", relevance: 2 },
    { itemId: "c", seriesId: "c", relevance: 0 }
  ]
});
const fiveRuns = (profileId: string, displayedItemIds: string[], extra: Partial<RankingRun> = {}): RankingRun[] =>
  Array.from({ length: 5 }, (_, index) => ({ algorithm: "C", profileId, runId: `run-${index + 1}`,
    displayedItemIds, modelStatus: "ok", fallbackUsed: false, ...extra }));
const dataset = (): RankingEvaluationInput => ({
  schemaVersion: "saitu.ranking-evaluation.v1", purpose: "development", catalogVersion: "synthetic-only",
  algorithms: ["C"], expectedRunsPerProfile: 5, profiles: [profile()], runs: fiveRuns("p1", ["a1", "b"])
});

describe("v6 pooled ranking evaluation", () => {
  it("computes best-track-per-series IDCG and accepts equivalent representative tracks", () => {
    expect(pooledNdcg(["a1", "b"], profile(), 5)).toBe(1);
    expect(pooledNdcg(["a2", "b"], profile(), 5)).toBe(1);
    expect(pooledNdcg(["b", "a1"], profile(), 5)).toBeCloseTo((3 + 7 / Math.log2(3)) / (7 + 3 / Math.log2(3)));
  });
  it("rejects duplicate series even below the requested Top5 cutoff", () => {
    expect(() => pooledNdcg(["a1", "b", "a2"], profile(), 1)).toThrow("duplicate_displayed_series");
  });
  it("does not turn unknown or absent pool judgments into zero relevance", () => {
    const p = profile(); p.judgments[3].relevance = "U";
    expect(() => pooledNdcg(["a1", "b"], p, 5)).toThrow("unknown_judgment");
    p.judgments.pop();
    expect(() => pooledNdcg(["a1", "b"], p, 5)).toThrow("missing_pool_judgment");
  });
  it("does not judge unseen outputs using a different series representative's label", () => {
    expect(() => pooledNdcg(["a3"], profile(), 5)).toThrow("outside_frozen_pool");
  });
  it("rejects a changed item-to-series mapping across profiles", () => {
    const input = dataset(); input.profiles.push(profile("p2", "f2"));
    input.profiles[1].judgments[0].seriesId = "new-series";
    expect(() => evaluateRankings(input)).toThrow("item-to-series mapping changed");
  });
  it("counts an empty failed output as zero when there are relevant choices", () => {
    const input = dataset(); input.runs = fiveRuns("p1", [], { modelStatus: "timeout" });
    const result = evaluateRankings(input).summaries[0];
    expect(result.pooledNdcg5).toBe(0);
    expect(result.generationFailureCount).toBe(5);
  });
  it("scores actual fallback output and reports the failed raw generation separately", () => {
    const input = dataset(); input.runs = fiveRuns("p1", ["a1", "b"], {
      modelStatus: "validation_failed", rawItemIds: ["a1", "a2"], fallbackUsed: true
    });
    const result = evaluateRankings(input);
    expect(result.summaries[0].pooledNdcg5).toBe(1);
    expect(result.summaries[0].fallbackCount).toBe(5);
    expect(result.profileResults[0].runs[0].rawContractIssues).toContain("duplicate_displayed_series");
  });
  it("will not silently de-duplicate a raw invalid ranking and call it successful", () => {
    const input = dataset(); input.runs[0].rawItemIds = ["a1", "a2"];
    expect(evaluateRankings(input).summaries[0].pooledNdcg5).toBeNull();
  });
  it("blocks the headline instead of dropping an invalid or unjudged profile", () => {
    const input = dataset(); input.profiles.push(profile("p2", "f2"));
    input.profiles[1].judgments[3].relevance = "U";
    input.runs.push(...fiveRuns("p2", ["a1", "b"]));
    const result = evaluateRankings(input).summaries[0];
    expect(result.pooledNdcg5).toBeNull();
    expect(result.blockedProfileIds).toEqual(["p2"]);
  });
  it("requires exactly five runs per profile, including recorded failures", () => {
    const input = dataset(); input.runs.pop();
    expect(evaluateRankings(input).summaries[0].pooledNdcg5).toBeNull();
    input.runs.push({ ...input.runs[0] });
    expect(() => evaluateRankings(input)).toThrow("duplicate algorithm/profile/run");
  });
  it("weights families equally, after within-profile repeated generations", () => {
    const input = dataset(); input.profiles = [profile("p1", "large"), profile("p2", "large"), profile("p3", "small")];
    input.runs = [...fiveRuns("p1", ["a1", "b"]), ...fiveRuns("p2", ["a1", "b"]), ...fiveRuns("p3", [])];
    const summary = evaluateRankings(input).summaries[0];
    expect(summary.pooledNdcg5).toBe(0.5);
    expect(summary.familyCount).toBe(2);
    expect(summary.profileCount).toBe(3);
    expect(summary.actualRunCount).toBe(15);
  });
  it("reports all-zero pools outside the ordinary ranking denominator", () => {
    const input = dataset(); input.profiles[0].judgments.forEach(item => { item.relevance = 0; });
    input.runs = fiveRuns("p1", []);
    const result = evaluateRankings(input);
    expect(result.summaries[0].pooledNdcg5).toBeNull();
    expect(result.summaries[0].noRelevantProfileIds).toEqual(["p1"]);
    expect(result.profileResults[0].noRelevantPoolEmptyOutputRate).toBe(1);
  });
  it("keeps synthetic metric fixtures out of independent acceptance", () => {
    const input = dataset(); input.purpose = "sealed_acceptance";
    expect(evaluateRankings(input).summaries[0].independentAcceptanceEligible).toBe(false);
    expect(evaluateRankings(input).productQualityProven).toBe(false);
  });
  it("measures set stability and pairs bootstrap by independent family", () => {
    expect(topKJaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
    const result = pairedFamilyBootstrap([{ familyId: "f1", value: 0.8 }, { familyId: "f2", value: 0.9 }],
      [{ familyId: "f2", value: 0.8 }, { familyId: "f1", value: 0.7 }]);
    expect(result.familyCount).toBe(2);
    expect(result.meanDifference).toBeCloseTo(0.1);
    expect(result.interval[0]).toBeCloseTo(0.1);
    expect(() => pairedFamilyBootstrap([{ familyId: "f1", value: 0.8 }], [{ familyId: "f1", value: 0.7 }])).toThrow();
  });
});
