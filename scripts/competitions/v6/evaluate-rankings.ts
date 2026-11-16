import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type Relevance = 0 | 1 | 2 | 3 | "U";
export type PoolJudgment = { itemId: string; seriesId: string; relevance: Relevance };
export type EvaluationProfile = {
  profileId: string;
  familyId: string;
  taskGroup: string;
  poolItemIds: string[];
  judgments: PoolJudgment[];
  annotationStatus: "independent_reviewed" | "ai_blind_reviewed" | "single_reviewed" | "synthetic" | "pending";
};
export type RankingRun = {
  algorithm: string;
  profileId: string;
  runId: string;
  modelStatus: "ok" | "empty" | "validation_failed" | "timeout" | "provider_error";
  /** The complete actual user-visible list, including a fallback if one was used. */
  displayedItemIds: string[];
  rawItemIds?: string[];
  fallbackUsed: boolean;
};
export type RankingEvaluationInput = {
  schemaVersion: "saitu.ranking-evaluation.v1";
  purpose: "development" | "sealed_acceptance" | "ai_proxy_acceptance";
  catalogVersion: string;
  algorithms: string[];
  expectedRunsPerProfile: 5;
  profiles: EvaluationProfile[];
  runs: RankingRun[];
};

const average = (values: readonly number[]) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const unique = (values: readonly string[]) => new Set(values).size === values.length;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const dcg = (values: readonly number[], k: number) => values.slice(0, k)
  .reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);

export function inspectPool(profile: EvaluationProfile): string[] {
  const problems: string[] = [];
  if (!unique(profile.poolItemIds)) problems.push("duplicate_pool_item");
  if (!unique(profile.judgments.map(item => item.itemId))) problems.push("duplicate_judgment");
  const labels = new Map(profile.judgments.map(item => [item.itemId, item]));
  if (profile.poolItemIds.some(id => !labels.has(id))) problems.push("missing_pool_judgment");
  if (profile.judgments.some(item => !profile.poolItemIds.includes(item.itemId))) problems.push("judgment_outside_pool");
  if (profile.judgments.some(item => item.relevance === "U")) problems.push("unknown_judgment_needs_review");
  if (profile.annotationStatus === "pending") problems.push("pending_annotation");
  return problems;
}

export function inspectDisplayedList(ids: readonly string[], judgments: readonly PoolJudgment[]): string[] {
  const labels = new Map(judgments.map(item => [item.itemId, item]));
  const issues: string[] = [];
  if (!unique(ids)) issues.push("duplicate_displayed_item");
  if (ids.length > 10) issues.push("more_than_ten_displayed_items");
  if (ids.some(id => !labels.has(id))) issues.push("displayed_item_outside_frozen_pool");
  const series = ids.flatMap(id => labels.has(id) ? [labels.get(id)!.seriesId] : []);
  if (!unique(series)) issues.push("duplicate_displayed_series");
  return issues;
}

/** IDCG selects the best labeled track per series; unjudged items never become zero. */
export function pooledNdcg(ids: readonly string[], profile: EvaluationProfile, k: number): number | null {
  assert(Number.isInteger(k) && k > 0, "k must be a positive integer");
  const issues = [...inspectPool(profile), ...inspectDisplayedList(ids, profile.judgments)];
  assert(issues.length === 0, issues.join(","));
  const byId = new Map(profile.judgments.map(item => [item.itemId, item]));
  const bestBySeries = new Map<string, number>();
  for (const judgment of profile.judgments) {
    const grade = judgment.relevance as number;
    bestBySeries.set(judgment.seriesId, Math.max(bestBySeries.get(judgment.seriesId) ?? 0, grade));
  }
  const ideal = dcg([...bestBySeries.values()].sort((a, b) => b - a), k);
  if (ideal === 0) return null; // Evaluated separately as a no-relevant-candidate case.
  return dcg(ids.map(id => byId.get(id)!.relevance as number), k) / ideal;
}

export function topKJaccard(left: readonly string[], right: readonly string[], k = 5): number {
  const a = new Set(left.slice(0, k)), b = new Set(right.slice(0, k));
  const union = new Set([...a, ...b]);
  return union.size ? [...a].filter(id => b.has(id)).length / union.size : 1;
}

function validateInput(input: RankingEvaluationInput) {
  assert(input.schemaVersion === "saitu.ranking-evaluation.v1", "unsupported schemaVersion");
  assert(["development", "sealed_acceptance", "ai_proxy_acceptance"].includes(input.purpose), "invalid evaluation purpose");
  assert(typeof input.catalogVersion === "string" && input.catalogVersion.length > 0, "catalogVersion required");
  assert(input.expectedRunsPerProfile === 5, "five runs per profile are required; missing runs remain visible");
  assert(Array.isArray(input.algorithms) && input.algorithms.length > 0 && unique(input.algorithms), "unique algorithms required");
  assert(Array.isArray(input.profiles) && input.profiles.length > 0, "profiles required");
  assert(unique(input.profiles.map(profile => profile.profileId)), "duplicate profileId");
  assert(Array.isArray(input.runs), "runs must be an array");
  const frozenSeriesByItem = new Map<string, string>();
  for (const profile of input.profiles) {
    assert(profile.profileId && profile.familyId && profile.taskGroup, "profile identity, family and task group required");
    assert(Array.isArray(profile.poolItemIds) && Array.isArray(profile.judgments), "explicit frozen pool required");
    assert(["independent_reviewed", "ai_blind_reviewed", "single_reviewed", "synthetic", "pending"].includes(profile.annotationStatus), "invalid annotation status");
    for (const item of profile.judgments) {
      assert(item.itemId && item.seriesId, "item and series identities required");
      assert([0, 1, 2, 3, "U"].includes(item.relevance), "relevance must be 0,1,2,3 or U");
      assert(!frozenSeriesByItem.has(item.itemId) || frozenSeriesByItem.get(item.itemId) === item.seriesId, "item-to-series mapping changed between pools");
      frozenSeriesByItem.set(item.itemId, item.seriesId);
    }
  }
  const profiles = new Set(input.profiles.map(profile => profile.profileId));
  const keys = input.runs.map(run => JSON.stringify([run.algorithm, run.profileId, run.runId]));
  assert(unique(keys), "duplicate algorithm/profile/run identity");
  for (const run of input.runs) {
    assert(input.algorithms.includes(run.algorithm), "unregistered algorithm");
    assert(profiles.has(run.profileId), "unregistered profile");
    assert(typeof run.runId === "string" && run.runId.length > 0, "runId required");
    assert(["ok", "empty", "validation_failed", "timeout", "provider_error"].includes(run.modelStatus), "invalid model status");
    assert(Array.isArray(run.displayedItemIds) && run.displayedItemIds.every(id => typeof id === "string"), "actual displayed IDs required");
    assert(typeof run.fallbackUsed === "boolean", "fallbackUsed required");
    assert(run.modelStatus === "ok" || run.fallbackUsed || run.displayedItemIds.length === 0,
      "failed generation with nonempty displayed output must identify its fallback");
  }
}

export function evaluateRankings(input: RankingEvaluationInput) {
  validateInput(input);
  const rows = input.algorithms.flatMap(algorithm => input.profiles.map(profile => {
    const runs = input.runs.filter(run => run.algorithm === algorithm && run.profileId === profile.profileId);
    const issues = inspectPool(profile);
    if (runs.length !== input.expectedRunsPerProfile) issues.push(`expected_5_runs_observed_${runs.length}`);
    const scoredRuns = runs.map(run => {
      const displayIssues = inspectDisplayedList(run.displayedItemIds, profile.judgments);
      const rawIssues = run.rawItemIds ? inspectDisplayedList(run.rawItemIds, profile.judgments) : [];
      if (rawIssues.length && !run.fallbackUsed) displayIssues.push("unaccounted_invalid_raw_output");
      if (displayIssues.length) issues.push(...displayIssues.map(issue => `${run.runId}:${issue}`));
      const canScore = inspectPool(profile).length === 0 && displayIssues.length === 0;
      return {
        runId: run.runId, modelStatus: run.modelStatus, fallbackUsed: run.fallbackUsed,
        displayedItemIds: run.displayedItemIds, rawContractIssues: rawIssues, displayedContractIssues: displayIssues,
        pooledNdcg5: canScore ? pooledNdcg(run.displayedItemIds, profile, 5) : null,
        pooledNdcg10: canScore ? pooledNdcg(run.displayedItemIds, profile, 10) : null
      };
    });
    const noRelevantPool = !inspectPool(profile).length && profile.judgments.every(item => item.relevance === 0);
    const canAggregate = issues.length === 0 && !noRelevantPool;
    const stability: number[] = [];
    // Equivalent tracks from the same series are compared as the same displayed series.
    const seriesById = new Map(profile.judgments.map(item => [item.itemId, item.seriesId]));
    for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
      stability.push(topKJaccard(runs[i].displayedItemIds.map(id => seriesById.get(id) ?? id),
        runs[j].displayedItemIds.map(id => seriesById.get(id) ?? id)));
    }
    return {
      algorithm, profileId: profile.profileId, familyId: profile.familyId, taskGroup: profile.taskGroup,
      annotationStatus: profile.annotationStatus, status: issues.length ? "blocked" : noRelevantPool ? "no_relevant_pool" : "scored",
      issues, runCount: runs.length, runs: scoredRuns,
      pooledNdcg5: canAggregate ? average(scoredRuns.map(run => run.pooledNdcg5!)) : null,
      pooledNdcg10: canAggregate ? average(scoredRuns.map(run => run.pooledNdcg10!)) : null,
      top5SeriesJaccard: issues.length ? null : average(stability),
      noRelevantPoolEmptyOutputRate: noRelevantPool && runs.length ? runs.filter(run => run.displayedItemIds.length === 0).length / runs.length : null
    };
  }));
  const summaries = input.algorithms.map(algorithm => {
    const allRows = rows.filter(row => row.algorithm === algorithm);
    const families = [...new Set(input.profiles.map(profile => profile.familyId))].map(familyId => {
      const familyRows = allRows.filter(row => row.familyId === familyId);
      const relevantRows = familyRows.filter(row => row.status === "scored");
      const blocked = familyRows.some(row => row.status === "blocked");
      return {
        familyId, status: blocked ? "blocked" : relevantRows.length ? "scored" : "no_relevant_pool",
        profileCount: familyRows.length,
        pooledNdcg5: blocked ? null : average(relevantRows.map(row => row.pooledNdcg5!)),
        pooledNdcg10: blocked ? null : average(relevantRows.map(row => row.pooledNdcg10!)),
        top5SeriesJaccard: blocked ? null : average(relevantRows.map(row => row.top5SeriesJaccard!))
      };
    });
    const blocked = allRows.some(row => row.status === "blocked");
    const scoredFamilies = families.filter(family => family.status === "scored");
    const runs = input.runs.filter(run => run.algorithm === algorithm);
    return {
      algorithm, status: blocked ? "blocked_incomplete_or_invalid_evaluation" : "complete",
      independentAcceptanceEligible: !blocked && input.purpose === "sealed_acceptance" && input.profiles.every(profile => profile.annotationStatus === "independent_reviewed"),
      aiProxyAcceptanceEligible: !blocked && input.purpose === "ai_proxy_acceptance" && input.profiles.every(profile => profile.annotationStatus === "ai_blind_reviewed"),
      profileCount: allRows.length, familyCount: families.length, scoredFamilyCount: scoredFamilies.length,
      actualRunCount: runs.length, expectedRunCount: input.profiles.length * 5,
      blockedProfileIds: allRows.filter(row => row.status === "blocked").map(row => row.profileId),
      noRelevantProfileIds: allRows.filter(row => row.status === "no_relevant_pool").map(row => row.profileId),
      pooledNdcg5: blocked ? null : average(scoredFamilies.map(family => family.pooledNdcg5!)),
      pooledNdcg10: blocked ? null : average(scoredFamilies.map(family => family.pooledNdcg10!)),
      top5SeriesJaccard: blocked ? null : average(scoredFamilies.map(family => family.top5SeriesJaccard!)),
      generationFailureCount: runs.filter(run => run.modelStatus !== "ok").length,
      fallbackCount: runs.filter(run => run.fallbackUsed).length,
      families
    };
  });
  return {
    schemaVersion: "saitu.ranking-evaluation-result.v1" as const,
    metricScope: "pooled; best-track-per-series IDCG; mean runs, then profiles within family, then equal family weights",
    purpose: input.purpose, catalogVersion: input.catalogVersion, summaries, profileResults: rows,
    productQualityProven: false,
    limitations: ["Candidate pool coverage and human judgment provenance must be independently audited.",
      "Independent-review status is supplied evidence metadata, not an automatic certification.",
      "No student understanding, factual accuracy or eligibility gate is measured by nDCG."]
  };
}

/** Paired bootstrap over independent families, never over five repeated generations. */
export function pairedFamilyBootstrap(
  left: ReadonlyArray<{ familyId: string; value: number }>,
  right: ReadonlyArray<{ familyId: string; value: number }>,
  samples = 2000, seed = 6141
) {
  assert(left.length > 1 && unique(left.map(item => item.familyId)) && unique(right.map(item => item.familyId)), "at least two unique paired families required");
  const byId = new Map(right.map(item => [item.familyId, item.value]));
  assert(left.length === right.length && left.every(item => byId.has(item.familyId)), "paired family sets must be identical");
  assert(Number.isInteger(samples) && samples >= 100, "at least 100 bootstrap samples required");
  const differences = [...left].sort((a, b) => a.familyId.localeCompare(b.familyId)).map(item => item.value - byId.get(item.familyId)!);
  assert(differences.every(Number.isFinite), "finite family scores required");
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
  const boot = Array.from({ length: samples }, () => average(differences.map(() => differences[Math.floor(random() * differences.length)]))!)
    .sort((a, b) => a - b);
  return { meanDifference: average(differences), confidenceLevel: 0.95, familyCount: differences.length, bootstrapSamples: samples, seed,
    interval: [boot[Math.floor(samples * 0.025)], boot[Math.ceil(samples * 0.975) - 1]],
    qualification: "descriptive paired family bootstrap; sampling representativeness and preregistration require independent review" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const inputIndex = process.argv.indexOf("--input"), outputIndex = process.argv.indexOf("--output");
  if (inputIndex < 0 || !process.argv[inputIndex + 1]) {
    console.error("Usage: node scripts/competitions/v6/evaluate-rankings.ts --input INPUT.json [--output RESULT.json]");
    process.exitCode = 2;
  } else {
    const result = evaluateRankings(JSON.parse(readFileSync(process.argv[inputIndex + 1], "utf8")) as RankingEvaluationInput);
    const json = JSON.stringify(result, null, 2) + "\n";
    if (outputIndex >= 0 && process.argv[outputIndex + 1]) writeFileSync(process.argv[outputIndex + 1], json);
    else process.stdout.write(json);
    if (result.summaries.some(summary => summary.status !== "complete")) process.exitCode = 1;
  }
}
