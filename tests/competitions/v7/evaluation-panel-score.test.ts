import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

vi.mock("../../../scripts/competitions/v7/evaluation-development-exclusions.mjs", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../scripts/competitions/v7/evaluation-development-exclusions.mjs")>();
  return { ...actual, verifyDevelopmentExclusions: async ({ config }: any) => ({
    publicDevelopmentManifestSha256: config.publicDevelopmentManifestSha256,
    materialReviewSha256: "a".repeat(64), finalExecutionAdoptionSha256: "b".repeat(64),
    sourceDependencyVerification: { dependencyManifestSha256: "c".repeat(64) },
  }) };
});

import { canonicalHash, TASK_GROUPS } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { deriveRunSeed, seededShuffle } from "../../../scripts/competitions/v6/frozen-ranking-executor.mjs";
import { loadScoringOriginals, getVerifiedRankingPanels, isVerifiedOriginals } from "../../../scripts/competitions/v7/evaluation-originals.mjs";
import { validateFrozenMatrix } from "../../../scripts/competitions/v7/evaluation-reuse.mjs";
import { scoreEvaluationBundle, scoreRankingGate } from "../../../scripts/competitions/v7/evaluation-score.mjs";
import { evaluationFixture } from "./evaluation.fixture";
import { rankingPanelsFixture, syntheticPanelScoringInputs } from "./evaluation-ranking-panels.fixture";

// This file isolates the separately tested public-development guard. The panel
// reader, product-original reader, WeakMap proofs and scorer are all real.
// Every input file below is invented in a disposable temp root; no provider,
// database, formal answer, real judgment or budget authority is accessed.
type Fixture = Awaited<ReturnType<typeof rankingPanelsFixture>>;
type Inputs = Awaited<ReturnType<typeof syntheticPanelScoringInputs>>;
type Proof = Awaited<ReturnType<typeof loadScoringOriginals>>;
type Prepared = Inputs & { f: Fixture; proof: Proof };
type Display = (row: any, best: string[], worst: string[]) => string[];

function fictionalGrade(f: Fixture, profileId: string, itemId: string) {
  const i = f.plan.profiles.findIndex(row => row.profileId === profileId);
  const j = f.plan.candidates.findIndex(row => row.itemId === itemId);
  // The two deliberately unresolved fixture units receive a third grade of 2.
  return (i === 0 && j === 0) || (i === 1 && j === 1) ? 2 : (i + j) % 4;
}

async function bindSynthetic45Matrix(f: Fixture, inputs: Inputs, display?: Display, noDispatch = false) {
  const { matrix } = inputs.ranking, ids = f.plan.candidates.map(row => row.itemId);
  for (const profile of matrix.profileSnapshot.profiles) profile.candidateItemIds = [...ids];
  const runs = new Map<string, any>(matrix.rankings.runs.map((row: any) => [row.invocationId, row]));
  for (const row of matrix.observations) {
    const best = [...ids].sort((a, b) => fictionalGrade(f, row.profileId, b) - fictionalGrade(f, row.profileId, a) || a.localeCompare(b));
    const worst = [...ids].sort((a, b) => fictionalGrade(f, row.profileId, a) - fictionalGrade(f, row.profileId, b) || a.localeCompare(b));
    const shown = display ? display(row, best, worst) : best.slice(0, 5);
    row.output = { recommendations: shown.map(itemId => ({ itemId })), summary: "source" };
    row.outputSha256 = canonicalHash(row.output);
    row.candidateSetSha256 = canonicalHash([...ids].sort());
    row.shuffleSeed = deriveRunSeed(matrix.seed, row.profileId, row.repetition + 1);
    row.candidateOrder = seededShuffle(ids, row.shuffleSeed);
    if (noDispatch && row.invocationId === "C-0-0") {
      row.events = []; row.reservationIds = [];
      row.execution = { ...row.execution, httpDispatches: 0, actualModelRun: false };
    }
    Object.assign(runs.get(row.invocationId), { displayedItemIds: shown,
      outputSha256: row.outputSha256, candidateSetSha256: row.candidateSetSha256, reservationIds: row.reservationIds });
  }
  const c = new Map<string, any>(matrix.observations.filter((row: any) => row.algorithm === "C").map((row: any) => [row.invocationId, row]));
  inputs.bundle.observations = inputs.bundle.observations.map((row: any) => row.algorithm === "C" ? c.get(row.invocationId) : row);
  inputs.bundle.reviews = structuredClone(inputs.bundle.reviews);
  for (const review of inputs.bundle.reviews) {
    const row = inputs.bundle.observations.find((observation: any) => observation.caseId === review.caseId && observation.repetition === review.repetition);
    review.observationSha256 = canonicalHash(row);
  }
  // Rebind the actual temp original, rather than supplying an in-memory review
  // that the true product-original reader would correctly reject as different.
  const reference = await f.put("synthetic-product-reviews.json", inputs.bundle.reviews);
  const original = JSON.parse(await readFile(path.join(f.root, inputs.bundle.productOriginals.path), "utf8"));
  original.reviews = { path: reference.path, sha256: reference.rawSha256 };
  const updated = await f.put(inputs.bundle.productOriginals.path, original);
  inputs.bundle.productOriginals = { path: updated.path, sha256: updated.rawSha256 };
  validateFrozenMatrix(matrix);
}

async function prepare(options: { mode?: "high" | "low" | "constant"; adjudication?: boolean; stillUnknown?: boolean; display?: Display; noDispatch?: boolean } = {}): Promise<Prepared> {
  const f = await rankingPanelsFixture({ mode: options.mode, adjudication: options.adjudication ?? true });
  try {
    if (options.stillUnknown) await f.putAdjudication(value => { value.resolutions[0].relevance = "U"; });
    // The shared helper targets reader tests. Whole-bundle scoring additionally
    // requires its invented manifest, config and matrix migration binding to
    // agree with the raw migration descriptor written to this temp root.
    const migration = await f.put("synthetic-product-public-migration.json", f.base.migration);
    f.config.migration = { path: migration.path, sha256: migration.rawSha256 };
    f.config.migrationSha256 = f.manifest.migrationSha256 = f.base.matrix.freezeBinding.migrationSha256 = migration.rawSha256;
    const challenge = await f.put("synthetic-product-public-challenge.json", f.manifest);
    f.config.challengeManifest = { path: challenge.path, sha256: challenge.rawSha256 };
    f.config.challengeManifestSha256 = f.base.matrix.freezeBinding.challengeManifestSha256 = challenge.rawSha256;
    const inputs = await syntheticPanelScoringInputs(f);
    await bindSynthetic45Matrix(f, inputs, options.display, options.noDispatch);
    return { f, ...inputs, proof: await loadScoringOriginals({ evidenceRoot: f.root, ...inputs }) };
  } catch (error) { await f.dispose(); throw error; }
}

const context = (p: Prepared) => ({ bundle: p.bundle, matrix: p.ranking.matrix, registration: p.ranking.registration });
function score(p: Prepared, proof: unknown = p.proof, bundle = p.bundle, matrix = p.ranking.matrix, registration = p.ranking.registration) {
  return scoreRankingGate(matrix, bundle.rankingGold, bundle.manifest, registration.registeredAt, { verifiedOriginals: proof, bundle, registration });
}
function expectUnverified(result: any) {
  expect(result).toMatchObject({ status: "failed_or_pending", selectedForReuse: null, ranking: null, originalAgreement: null,
    additionalRankingPaidRuns: 0, productAcceptance: false, blockers: ["raw_v72_ranking_panel_originals_not_verified"] });
}

describe("v7.2 ranking-panel scorer integration with real raw proofs", () => {
  let valid: Prepared;
  beforeAll(async () => { valid = await prepare(); }, 20000);
  afterAll(async () => { await valid?.f.dispose(); });

  it("passes 120 full45 pools with Top5 displays using resolved originals while retaining pre-adjudication alpha and B/C denominators", () => {
    const panel = getVerifiedRankingPanels(valid.proof, context(valid))!, result = score(valid);
    expect(isVerifiedOriginals(valid.proof, context(valid))).toBe(true);
    expect(panel).toMatchObject({ goldReady: true, unresolvedAfterAdjudication: 0 });
    expect(panel.resolvedProfiles).toHaveLength(120);
    expect(panel.resolvedProfiles!.every(row => row.judgments.length === 45 && row.judgments.every(item => item.relevance !== "U"))).toBe(true);
    expect(valid.ranking.matrix.rankings.profiles.every((row: any) => row.judgments.every((item: any) => item.relevance === "U"))).toBe(true);
    expect(valid.ranking.matrix.profileSnapshot.profiles.every((row: any) => row.candidateItemIds.length === 45)).toBe(true);
    expect(valid.ranking.matrix.rankings.runs.every((row: any) => row.displayedItemIds.length === 5)).toBe(true);
    expect(result).toMatchObject({ status: "passed", selectedForReuse: "C", blockers: [], additionalRankingPaidRuns: 0, productAcceptance: false,
      execution: { profiles: 120, independentFamilies: 120, repetitions: 5, algorithms: 2, reports: 1200, actualModelRuns: 600 } });
    expect(result.originalAgreement).toBe(panel.originalAgreement);
    expect(result.originalAgreement).toMatchObject({ paired: 5399, denominator: 5400, unknownPairs: 1, actualAuthorCount: 48,
      minimumAlpha: .70, source: "48_actual_shard_authors_two_sealed_panels_before_adjudication" });
    expect(result.originalAgreement.value).toBeGreaterThanOrEqual(.70);
    expect(result.paired).toMatchObject({ meanDifference: 0, interval: [0, 0], familyCount: 120 });
    expect(result.ranking.summaries.every((row: any) => row.pooledNdcg10 < .80)).toBe(true);
    expect(result.blockers).not.toContain("C_pooledNdcg10_below_gate");
    expect(result.taskGroups).toHaveLength(6);
    expect(result.taskGroups.every((row: any) => row.independentFamilies === 20 && row.pooledNdcg5 === 1)).toBe(true);
    expect(result.ranking.summaries.map((row: any) => [row.algorithm, row.scoredFamilyCount, row.pooledNdcg5, row.top5SeriesJaccard])).toEqual([
      ["B", 120, 1, 1], ["C", 120, 1, 1],
    ]);
  });

  it("passes the proof through scoreEvaluationBundle without weakening the remaining product gates", () => {
    const result = scoreEvaluationBundle(valid.bundle, { frozenMatrix: valid.ranking.matrix, registration: valid.ranking.registration, verifiedOriginals: valid.proof });
    expect(result).toMatchObject({ status: "evaluation_gates_passed_requires_remaining_product_acceptance", blockers: [],
      productAcceptance: false, realStudentOutcomesProven: false, ranking: { status: "passed", selectedForReuse: "C" },
      product: { counts: { passed: 800, failed: 0, not_run: 0, pending: 0 }, observedSlots: 1280 },
      formalDenominators: { cases: 800, rankingReports: 1200, independentRankingFamilies: 120, cReportsReused: 600, additionalRankingPaidRuns: 0 } });
    expect(result.remainingProductGates).toContain("budget_and_provider_ledger_reconciliation");
  });

  it("rejects a missing raw proof even when caller-supplied ranking labels or panel summaries claim success", () => {
    expectUnverified(scoreRankingGate(valid.ranking.matrix, valid.bundle.rankingGold, valid.bundle.manifest, valid.ranking.registration.registeredAt));
    expectUnverified(score(valid, { schemaVersion: "saitu.raw-scoring-verification.v7.1", rawOriginalBytesVerified: true,
      rankingPanelsVerification: { goldReady: true, blockers: [], originalAgreement: { value: 1, coverageComplete: true, paired: 5400 } } }));
    const result = scoreEvaluationBundle(valid.bundle, { frozenMatrix: valid.ranking.matrix, registration: valid.ranking.registration });
    expect(result.blockers).toContain("raw_680_product_originals_not_verified_fixture_only");
    expect(result.blockers).toContain("raw_v72_ranking_panel_originals_not_verified");
  });

  it.each(["object-spread", "deep-copy", "JSON-roundtrip"])("rejects a %s of a genuine proof", method => {
    const clone = method === "object-spread" ? { ...valid.proof } : method === "deep-copy" ? structuredClone(valid.proof) : JSON.parse(JSON.stringify(valid.proof));
    expectUnverified(score(valid, clone));
  });

  it("rejects a changed genuine proof, including an added success claim, and a changed exposed panel result", () => {
    const verification = valid.proof.rankingPanelsVerification as any, savedAlpha = verification.originalAgreement.value;
    try {
      verification.originalAgreement.value = 1;
      expectUnverified(score(valid));
    } finally { verification.originalAgreement.value = savedAlpha; }
    try {
      valid.proof.callerClaim = "force passed";
      expectUnverified(score(valid));
    } finally { delete valid.proof.callerClaim; }
    const panel = getVerifiedRankingPanels(valid.proof, context(valid))!, item = panel.resolvedProfiles![0].judgments[0], savedGrade = item.relevance;
    try { item.relevance = savedGrade === 3 ? 0 : 3; expectUnverified(score(valid)); }
    finally { item.relevance = savedGrade; }
    expect(score(valid).status).toBe("passed");
  });

  it.each(["bundle", "matrix", "registration", "contract", "gold", "manifest", "registeredAt"])("rejects a genuine proof after its %s binding changes", member => {
    const bundle = structuredClone(valid.bundle), matrix = structuredClone(valid.ranking.matrix), registration = structuredClone(valid.ranking.registration);
    if (member === "bundle") bundle.reviewSampleSeed++;
    if (member === "matrix") matrix.rankings.profiles[0].judgments[0].relevance = 3;
    if (member === "registration") registration.syntheticChanged = true;
    if (member === "contract") {
      bundle.rankingGold.reviewContract.partitionSha256 = canonicalHash("invented-other-contract");
      registration.config.rankingReviewContract.partitionSha256 = bundle.rankingGold.reviewContract.partitionSha256;
    }
    if (member === "gold") bundle.rankingGold.inventedAggregate = { goldReady: true };
    if (member === "manifest") bundle.manifest.implementationAuthorContextIds.push("invented-other-author");
    if (member === "registeredAt") registration.registeredAt = "2026-11-09T00:01:01Z";
    expectUnverified(score(valid, valid.proof, bundle, matrix, registration));
  });

  it("rejects a mismatched direct gold, manifest or registered time even with the original verification context", () => {
    const registration = valid.ranking.registration, verification = { verifiedOriginals: valid.proof, bundle: valid.bundle, registration };
    const gold = structuredClone(valid.bundle.rankingGold); gold.reviewContract.roundId = "invented-other-round";
    const manifest = structuredClone(valid.bundle.manifest); manifest.implementationAuthorContextIds.push("invented-other-implementer");
    expectUnverified(scoreRankingGate(valid.ranking.matrix, gold, valid.bundle.manifest, registration.registeredAt, verification));
    expectUnverified(scoreRankingGate(valid.ranking.matrix, valid.bundle.rankingGold, manifest, registration.registeredAt, verification));
    expectUnverified(scoreRankingGate(valid.ranking.matrix, valid.bundle.rankingGold, valid.bundle.manifest, "2026-11-09T00:01:01Z", verification));
  });

  it.each([false, true])("retains U as unresolved when adjudication still leaves U: %s", async stillUnknown => {
    const p = await prepare({ adjudication: stillUnknown, stillUnknown });
    try {
      const panel = getVerifiedRankingPanels(p.proof, context(p))!, result = score(p);
      expect(panel.rawOriginalBytesVerified).toBe(true); expect(panel.goldReady).toBe(false);
      expect(panel.unresolvedAfterAdjudication).toBe(stillUnknown ? 1 : 2);
      expect(result).toMatchObject({ status: "failed_or_pending", selectedForReuse: null, ranking: null, paired: null });
      expect(result.blockers).toContain("ranking_panel_adjudication_pending_or_U");
      expect(result.blockers).toContain("v72_ranking_gold_unresolved");
      expect(result.originalAgreement).toMatchObject({ paired: 5399, unknownPairs: 1 });
      expect(result.originalAgreement.value).toBeGreaterThanOrEqual(.70);
    } finally { await p.f.dispose(); }
  }, 20000);

  it.each(["low", "constant"] as const)("keeps %s original alpha failed despite a real raw proof", async mode => {
    const p = await prepare({ mode });
    try {
      const panel = getVerifiedRankingPanels(p.proof, context(p))!, result = score(p);
      expect(panel.rawOriginalBytesVerified).toBe(true);
      expect(result).toMatchObject({ status: "failed_or_pending", selectedForReuse: null, ranking: null, paired: null });
      expect(result.originalAgreement).toBe(panel.originalAgreement);
      if (mode === "low") {
        expect(result.originalAgreement.value).toBeLessThan(.70);
        expect(result.blockers).toContain("original_blind_agreement_alpha_below_070");
      } else {
        expect(result.originalAgreement.value).toBeNull();
        expect(result.blockers).toContain("original_blind_agreement_alpha_pending_or_null");
      }
    } finally { await p.f.dispose(); }
  }, 20000);

  it.each(["ndcg5", "stability", "task-group", "B-completeness", "600-dispatches"])("preserves the %s ranking gate with genuine panel proof", async gate => {
    const p = await prepare({ noDispatch: gate === "600-dispatches", display: (row, best, worst) => {
      if (gate === "B-completeness" && row.algorithm === "B") return [best[0], best[0], ...best.slice(2, 5)];
      if (row.algorithm !== "C") return best.slice(0, 5);
      if (gate === "ndcg5") return worst.slice(0, 5);
      if (gate === "stability" && row.repetition > 0) return best.slice(5, 10);
      if (gate === "task-group" && Number(row.profileId.split("-")[1]) < 20) return best.slice(0, 3);
      return best.slice(0, 5);
    } });
    try {
      const result = score(p);
      expect(result.status).toBe("failed_or_pending"); expect(result.selectedForReuse).toBeNull();
      expect(result.originalAgreement.value).toBeGreaterThanOrEqual(.70);
      const blocker: Record<string, string> = { ndcg5: "C_pooledNdcg5_below_gate", 
        stability: "C_top5SeriesJaccard_below_gate", "task-group": "C_task_group_ndcg5_below_gate",
        "B-completeness": "complete_independent_pool_labels_required", "600-dispatches": "all_600_C_invocations_must_have_real_dispatch" };
      expect(result.blockers).toContain(blocker[gate]);
      if (gate === "stability" || gate === "600-dispatches") expect(result.blockers).toEqual([blocker[gate]]);
      if (gate === "B-completeness") expect(result.blockers).toEqual([blocker[gate], "C_minus_B_family_bootstrap_lower_below_minus_002"]);
      if (gate === "task-group") {
        expect(result.blockers).not.toContain("C_pooledNdcg5_below_gate");
        expect(result.taskGroups.find((row: any) => row.taskGroup === TASK_GROUPS[0]).pooledNdcg5).toBeLessThan(.75);
      }
    } finally { await p.f.dispose(); }
  }, 20000);

  it.each([2, 24])("retains minus .02 family-bootstrap noninferiority with %s slightly worse C families", async affected => {
    const p = await prepare({ display: (row, best) => best.slice(0, row.algorithm === "C" && Number(row.profileId.split("-")[1]) < affected ? 4 : 5) });
    try {
      const result = score(p);
      expect(result.paired.familyCount).toBe(120); expect(result.paired.meanDifference).toBeLessThan(0);
      if (affected === 2) {
        expect(result.status).toBe("passed"); expect(result.selectedForReuse).toBe("C");
        expect(result.paired.interval[0]).toBeGreaterThanOrEqual(-.02);
      } else {
        expect(result.status).toBe("failed_or_pending"); expect(result.selectedForReuse).toBeNull();
        expect(result.paired.interval[0]).toBeLessThan(-.02);
        expect(result.blockers).toEqual(["C_minus_B_family_bootstrap_lower_below_minus_002"]);
      }
    } finally { await p.f.dispose(); }
  }, 20000);

  it("keeps the legacy v7.1 gold path and alpha gate independent of optional v7.2 proof", () => {
    const f = evaluationFixture(), baseline = scoreRankingGate(f.matrix, f.gold, f.manifest, f.registration.registeredAt);
    expect(baseline).toMatchObject({ status: "passed", selectedForReuse: "C", blockers: [],
      originalAgreement: { source: "two_sealed_originals_before_adjudication", paired: 1200, minimumAlpha: .70 },
      paired: { meanDifference: 0, interval: [0, 0], familyCount: 120 } });
    expect(scoreRankingGate(f.matrix, f.gold, f.manifest, f.registration.registeredAt, { verifiedOriginals: valid.proof, bundle: valid.bundle, registration: valid.ranking.registration })).toEqual(baseline);
    for (const pool of f.gold.originals[1].profiles) for (const item of pool.judgments) item.relevance = item.relevance === 3 ? 0 : 3;
    const failed = scoreRankingGate(f.matrix, f.gold, f.manifest, f.registration.registeredAt);
    expect(failed.blockers).toContain("original_blind_agreement_alpha_below_070"); expect(failed.ranking).toBeNull();
  });
});
