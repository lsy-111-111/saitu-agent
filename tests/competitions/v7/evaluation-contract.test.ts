import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { POLICY_VERSION, POLICY_SHA256, EVALUATION_POLICY, TOP5_EFFORT_POLICY, canonicalHash, lowRiskSample } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { validateRegistrationConfig, readImplementationManifest, verifyImplementationManifest } from "../../../scripts/competitions/v7/evaluation-registration.mjs";
import { planEvaluationMatrix, createRankingSlots } from "../../../scripts/competitions/v7/evaluation-matrix.mjs";
import { inspectMigration } from "../../../scripts/competitions/v7/evaluation-migration.mjs";
import { validateFrozenMatrix, createCReuse } from "../../../scripts/competitions/v7/evaluation-reuse.mjs";
import { scoreEvaluationBundle, scoreRankingGate, scorePerformance } from "../../../scripts/competitions/v7/evaluation-score.mjs";
import { LEGACY_FAILURE_RULES, classifyLegacyFailures, applyReviewedLegacyTransition } from "../../../scripts/competitions/v7/evaluation-legacy-applicability.mjs";
import { runtimeBehaviorConfigurationHash, validateExecutionScope } from "../../../scripts/competitions/v7/evaluation-runtime.mjs";
import { evaluationFixture } from "./evaluation.fixture";

const config = () => ({ schemaVersion: "saitu.ranking-registration-config.v7.1", purpose: "ai_proxy_acceptance", policyVersion: POLICY_VERSION,
  policySha256: POLICY_SHA256, algorithms: ["B", "C"], profileCount: 120, repeats: 5, rankingReports: 1200, reuseAlgorithm: "C", candidatePolicy: "full_core_reviewed",
  executionPhase: "formal", invocationConcurrency: 1,
  seed: 6141, reviewSampleSeed: 20261109, runtime: EVALUATION_POLICY.runtime, rankingProtocol: EVALUATION_POLICY.ranking, reviewProtocol: EVALUATION_POLICY.review,
  ...Object.fromEntries(["inputSha256", "productInputSha256", "profileSliceProtocolSha256", "challengeManifestSha256", "sourceSnapshotSha256", "rankingSourceSnapshotSha256", "catalogSha256", "candidatePoolSha256", "runtimeSourceBindingSha256", "implementationSha256", "runtimeConfigurationSha256", "migrationSha256", "publicDevelopmentManifestSha256"].map(key => [key, canonicalHash(key)])),
  migration: { path: "migration.json", sha256: canonicalHash("migrationSha256") }, challengeManifest: { path: "challenge.json", sha256: canonicalHash("challengeManifestSha256") },
  batchPolicy: { order: "profile_then_repeat_then_arm", runsPerBatch: 12, maxCReservationMicros: 10000, maxHttpPerCInvocation: 5, measuredBoundEvidenceSha256: canonicalHash("measured") },
  productBatchPolicy: { runsPerBatch: 10, maxHttpPerInvocation: 8, maxReservationMicros: 10000, measuredBoundEvidenceSha256: canonicalHash("measured-product") },
  publicAdmission: { path: "public-admission.json", sha256: canonicalHash("admission") } });

describe("v7 evaluation registration and finite matrix", () => {
  it("fixes formal B/C 120x5 and Flash thinking/low while leaving A1 development only", () => {
    expect(validateRegistrationConfig(config()).algorithms).toEqual(["B", "C"]);
    for (const change of [{ algorithms: ["A1", "B", "C"] }, { rankingReports: 1800 }, { runtime: { ...EVALUATION_POLICY.runtime, reasoningEffort: "max" } },
      { runtime: { ...EVALUATION_POLICY.runtime, reasoningEffort: "high" } }, { candidatePolicy: "published_L3_only" }]) expect(() => validateRegistrationConfig({ ...config(), ...change })).toThrow();
  });
  it("retains measured and unknown cost bounds without creating paid ranking duplicates", () => {
    const plan = planEvaluationMatrix({ schemaVersion: "saitu.evaluation-cost-input.v7.1", balanceCny: 100, cumulativeChargedOrHeldCny: 0, fundedLimitCny: 100, totalCapCny: 300, estimates: {} });
    expect(plan.rankingReports).toBe(1200); expect(plan.rankingCRecommendationRuns).toBe(600); expect(plan.additionalRankingPaidRuns).toBe(0);
    expect(plan.conservativeReservedCny).toBeNull(); expect(plan.affordable).toBeNull(); expect(plan.executed).toBe(false);
    expect(plan.rows.find((row: any) => row.id === "ranking_C_reuse_in_800").maxHttpDispatches).toBe(0);
    expect(plan.rows.find((row: any) => row.id === "hard_constraints")).toMatchObject({ cases: 300, additionalPaidInvocations: 0, maxHttpDispatches: 0 });
    expect(plan.rows.find((row: any) => row.id === "simulation_comparison")).toMatchObject({ invocations: 120, additionalPaidInvocations: 0, maxHttpDispatches: 0 });
    expect(plan.rows.find((row: any) => row.id === "simulation_comprehension")).toMatchObject({ invocations: 120, additionalPaidInvocations: 0, status: "independent_work_context_no_business_provider_cost" });
    expect(plan.simulationComparison).toMatchObject({ pairs: 60, originalReportsReused: 120, additionalRecommendationPaidInvocations: 0 });
    expect(plan.rows.some((row: any) => row.id === "ranking_A1")).toBe(false);
    const metered = planEvaluationMatrix({ schemaVersion: "saitu.evaluation-cost-input.v7.1", balanceCny: 100, cumulativeChargedOrHeldCny: 0, fundedLimitCny: 100, totalCapCny: 300, estimates: {}, simulationComprehensionMode: "metered_provider" });
    expect(metered.rows.find((row: any) => row.id === "simulation_comprehension")).toMatchObject({ invocations: 120, additionalPaidInvocations: 120, status: "pending_measured_usage_and_enforceable_bound" });
    expect(metered.rows.find((row: any) => row.id === "simulation_comparison").additionalPaidInvocations).toBe(0);
  });
  it("schedules exactly 1200 distinct slots without treating repeats as independent families", () => {
    const fixture = evaluationFixture(), slots = createRankingSlots(fixture.matrix.profileSnapshot.profiles, 6141);
    expect(slots).toHaveLength(1200); expect(new Set(slots.map((row: any) => row.slotId)).size).toBe(1200);
    expect(new Set(slots.map((row: any) => row.familyId)).size).toBe(120);
    expect(slots.slice(0, 4).map((row: any) => [row.repetition, row.algorithm])).toEqual([[0, "B"], [0, "C"], [1, "B"], [1, "C"]]);
  });
  it("separates business behavior from bounded execution authority across public and formal phases", () => {
    const environment = { AI_PROVIDER: "deepseek", AI_SPEND_RUN_ID: "public", AI_SPEND_PHASE: "calibration", AI_SPEND_LIMIT_CNY: "2" };
    expect(runtimeBehaviorConfigurationHash(environment)).toBe(runtimeBehaviorConfigurationHash({ ...environment, AI_SPEND_RUN_ID: "formal", AI_SPEND_PHASE: "ranking", AI_SPEND_LIMIT_CNY: "20" }));
    expect(runtimeBehaviorConfigurationHash(environment)).not.toBe(runtimeBehaviorConfigurationHash({ ...environment, SAITU_V7_WORKER_CONCURRENCY: "4" }));
    const scope = { grantVersion: "saitu.v7.top5.v1", effortPolicy: TOP5_EFFORT_POLICY, effortPolicySha256: EVALUATION_POLICY.runtime.effortPolicySha256, runId: "public", phase: "calibration", authorizedPhase: "calibration", authorizedEffort: "stage", authorizationPolicySha256: canonicalHash("approved-document-original-bytes"),
      environmentAuthorizationPolicySha256: canonicalHash("approved-document-original-bytes"), evaluationPolicySha256: POLICY_SHA256,
      authorizationPolicySnapshot: { path: "approved-policy.md", sha256: canonicalHash("approved-document-original-bytes") }, executionRuntimeConfigurationSha256: canonicalHash("execution"), callLimit: 5, fundingLimitCny: 2 };
    expect(validateExecutionScope(scope, { allowedPhases: ["calibration"] })).toEqual(scope);
    expect(() => validateExecutionScope({ ...scope, grantVersion: "legacy" }, { allowedPhases: ["calibration"] })).toThrow("actual_bounded_execution_authority_required");
    expect(() => validateExecutionScope({ ...scope, phase: "formal" }, { allowedPhases: ["calibration"] })).toThrow("actual_bounded_execution_authority_required");
  });
});

describe("v7 source freeze", () => {
  it("reads actual current source bytes and rejects a changed source mirror or manifest", async () => {
    const current = await readImplementationManifest(process.cwd());
    const member = current.find(row => row.path === "src/lib/competitions/v7/contracts.ts")!;
    expect(member).toBeDefined();
    const bytes = await readFile(path.join(process.cwd(), member.path));
    const mirror = await mkdtemp(path.join(os.tmpdir(), "saitu-v7-source-freeze-"));
    try {
      for (const directory of ["src/lib/competitions/v7", "db", "scripts", "ops", "public"]) await mkdir(path.join(mirror, directory), { recursive: true });
      await writeFile(path.join(mirror, member.path), bytes);
      const frozen = await readImplementationManifest(mirror), digest = canonicalHash(frozen);
      expect(await verifyImplementationManifest(mirror, frozen, digest)).toMatchObject({ actualSourceBytesVerified: true, sha256: digest });
      await expect(verifyImplementationManifest(mirror, [{ ...frozen[0], sha256: canonicalHash("forged") }], digest)).rejects.toThrow("source_manifest_artifact_changed");
      await writeFile(path.join(mirror, member.path), Buffer.concat([bytes, Buffer.from("\n// changed after registration\n")]));
      await expect(verifyImplementationManifest(mirror, frozen, digest)).rejects.toThrow("actual_source_bytes_changed_since_freeze");
    } finally { await rm(mirror, { recursive: true, force: true }); }
  });
});

describe("v7 independent 800-case policy migration", () => {
  it("requires same-layer replacement for retired registration and evidence-certification cases", () => {
    const fixture = evaluationFixture(); expect(inspectMigration(fixture.migration).ready).toBe(true);
    const changed = structuredClone(fixture.migration); changed.rows[0].action = "retain";
    expect(() => inspectMigration(changed)).toThrow("retired_v6_scope_requires_equal_layer_replacement");
    const dropped = structuredClone(fixture.migration); dropped.rows.pop(); expect(() => inspectMigration(dropped)).toThrow();
    const relabelled = structuredClone(fixture.migration); relabelled.rows[0].replacement.inputSha256 = relabelled.rows[0].originalInputSha256;
    expect(() => inspectMigration(relabelled)).toThrow("retired_case_cannot_be_relabelled_as_replacement");
  });
  it("keeps applicability pending when the author reviews their own migration or the exact runtime changes", () => {
    const fixture = evaluationFixture(); fixture.migration.rows[0].applicabilityReview.contextId = "implementer";
    const pending = inspectMigration(fixture.migration); expect(pending.ready).toBe(false); expect(pending.pending).toBe(1);
    fixture.migration.rows[0].applicabilityReview.contextId = "independent-key-reviewer";
    fixture.migration.reviewBasis.runtimeConfigurationSha256 = canonicalHash("changed-runtime");
    expect(inspectMigration(fixture.migration).pending).toBe(800);
  });
  it("samples exactly a seeded 20 percent of low-risk recommendations regardless of input order", () => {
    const ids = Array.from({ length: 103 }, (_, i) => `low-risk-${i}`), sample = lowRiskSample(ids, 20261109);
    expect(sample).toHaveLength(21); expect(lowRiskSample([...ids].reverse(), 20261109)).toEqual(sample);
    expect(lowRiskSample(ids, 20261110)).not.toEqual(sample);
  });
});

describe("v7 same-invocation C reuse and ranking gates", () => {
  it("checks both arms and all 1200 original bindings before exposing 600 C observations", () => {
    const fixture = evaluationFixture(); expect(validateFrozenMatrix(fixture.matrix)).toMatchObject({ reports: 1200, algorithms: 2, independentFamilies: 120, actualModelRuns: 600 });
    const reuse = createCReuse(fixture.matrix), profile = fixture.matrix.profileSnapshot.profiles[0];
    expect(reuse.size).toBe(600); expect(reuse.additionalPaidRuns).toBe(0);
    expect(reuse.get({ caseId: profile.caseId, repetition: 0, input: profile.input }).invocationId).toBe("C-0-0");
    expect(() => reuse.get({ caseId: "missing", repetition: 0, input: {} })).toThrow("no_regeneration");
    const changedB = structuredClone(fixture.matrix); changedB.observations[0].candidateOrder.reverse();
    expect(() => createCReuse(changedB)).toThrow("full_candidate_pool_or_order_changed");
    const duplicate = structuredClone(fixture.matrix); duplicate.observations[1] = duplicate.observations[0]; expect(() => createCReuse(duplicate)).toThrow();
  });
  it("accepts a tied C/B family result without the retired .03 superiority gate", () => {
    const fixture = evaluationFixture(), result = scoreRankingGate(fixture.matrix, fixture.gold, fixture.manifest, fixture.registration.registeredAt);
    expect(result.status).toBe("passed"); expect(result.paired.meanDifference).toBe(0); expect(result.paired.interval).toEqual([0, 0]);
    expect(result.paired.familyCount).toBe(120); expect(result.selectedForReuse).toBe("C");
  });
  it("accepts small negative C/B differences only when the paired family interval stays above minus .02", () => {
    for (const [affectedFamilies, expected] of [[2, "passed"], [24, "failed_or_pending"]] as const) {
      const fixture = evaluationFixture();
      for (const observation of fixture.matrix.observations.filter((row: any) => row.algorithm === "C" && Number(row.profileId.split("-")[1]) < affectedFamilies)) {
        observation.output.recommendations = observation.output.recommendations.slice(0, 4); observation.outputSha256 = canonicalHash(observation.output);
        const ranking = fixture.matrix.rankings.runs.find((row: any) => row.invocationId === observation.invocationId);
        ranking.outputSha256 = observation.outputSha256; ranking.displayedItemIds = observation.output.recommendations.map((row: any) => row.itemId);
      }
      const result = scoreRankingGate(fixture.matrix, fixture.gold, fixture.manifest, fixture.registration.registeredAt);
      expect(result.status).toBe(expected); expect(result.paired.meanDifference).toBeLessThan(0);
      if (expected === "passed") expect(result.paired.interval[0]).toBeGreaterThanOrEqual(-.02);
      else expect(result.blockers).toContain("C_minus_B_family_bootstrap_lower_below_minus_002");
    }
  });
  it("blocks missing labels and double-blind disagreement without a bound adjudicator", () => {
    const fixture = evaluationFixture(); fixture.gold.originals[0].profiles[0].judgments[0].relevance = 0;
    expect(() => scoreRankingGate(fixture.matrix, fixture.gold, fixture.manifest, fixture.registration.registeredAt)).toThrow("disagreement_without_bound_adjudication");
    fixture.gold.originals[1].profiles[0].judgments[0].relevance = "U";
    fixture.gold.originals[0].profiles[0].judgments[0].relevance = "U";
    expect(() => scoreRankingGate(fixture.matrix, fixture.gold, fixture.manifest, fixture.registration.registeredAt)).toThrow("disagreement_without_bound_adjudication");
  });
  it("retains the original ordinal alpha .70 gate and blocks null, low or missing original coverage", () => {
    const missing = evaluationFixture(); missing.gold.originals[0].profiles[0].judgments.pop();
    const incomplete = scoreRankingGate(missing.matrix, missing.gold, missing.manifest, missing.registration.registeredAt);
    expect(incomplete.blockers).toContain("original_blind_label_coverage_incomplete"); expect(incomplete.originalAgreement.missingOriginalJudgments).toHaveLength(1);
    const constant = evaluationFixture(); for (const original of constant.gold.originals) for (const pool of original.profiles) for (const judgment of pool.judgments) judgment.relevance = 3;
    const noVariation = scoreRankingGate(constant.matrix, constant.gold, constant.manifest, constant.registration.registeredAt);
    expect(noVariation.originalAgreement.value).toBeNull(); expect(noVariation.blockers).toContain("original_blind_agreement_alpha_pending_or_null");
    const contrary = evaluationFixture(); for (const pool of contrary.gold.originals[1].profiles) for (const judgment of pool.judgments) judgment.relevance = judgment.relevance === 3 ? 0 : 3;
    const low = scoreRankingGate(contrary.matrix, contrary.gold, contrary.manifest, contrary.registration.registeredAt);
    expect(low.originalAgreement.value).toBeLessThan(.70); expect(low.blockers).toContain("original_blind_agreement_alpha_below_070"); expect(low.selectedForReuse).toBeNull();
  });
});

describe("v7 reviewed legacy required-set transition", () => {
  const baseline = () => ({ numTotalTests: 1775, numPassedTests: 1673, numFailedTests: 26, numPendingTests: 76,
    testResults: LEGACY_FAILURE_RULES.map(rule => ({ name: `/synthetic-repository/${rule.file}`, assertionResults: [{ fullName: `legacy suite ${rule.title}`, status: "failed", failureMessages: ["Original synthetic failure"] }] })) });
  it("classifies exactly the original thirteen failures and keeps two historical integrity failures failed", () => {
    const report = classifyLegacyFailures(baseline(), { baselineSha256: canonicalHash("original-machine-json"), repositoryRoot: "/synthetic-repository", authorContextId: "migration-author" });
    expect(report.classifiedOriginalFailures).toBe(13); expect(report.historicalIntegrityFailures).toBe(2);
    expect(report.oldFailuresConvertedToPass).toBe(false); expect(report.rows.every((row: any) => row.originalStatus === "failed" && row.releasePassClaim === false)).toBe(true);
  });
  it("requires independent per-test retirement approval and passed meaningful replacements", () => {
    const report = classifyLegacyFailures(baseline(), { baselineSha256: canonicalHash("original-machine-json"), repositoryRoot: "/synthetic-repository", authorContextId: "migration-author" });
    const review = { contextId: "independent-reviewer", reportSha256: canonicalHash(report), policySha256: POLICY_SHA256, passed: true,
      decisions: report.rows.map((row: any) => ({ file: row.file, fullName: row.fullName, disposition: "retire_from_v7_required_set", reason: "verified new workflow and replacement gates" })) };
    expect(() => applyReviewedLegacyTransition(report, { ...review, contextId: "migration-author" }, [])).toThrow("independent_exact_legacy_transition_review_required");
    expect(() => applyReviewedLegacyTransition(report, review, [])).toThrow("replacement_not_passed");
    const files = new Map<string, Set<string>>();
    for (const row of report.rows) for (const test of row.replacementTests) { if (!files.has(test.file)) files.set(test.file, new Set()); files.get(test.file)!.add(test.fullName); }
    const replacements = [{ testResults: [...files].map(([file, titles]) => ({ name: `/synthetic-repository/${file}`, assertionResults: [...titles].map(fullName => ({ fullName, status: "passed" })) })) }];
    expect(() => applyReviewedLegacyTransition(report, review, replacements)).toThrow("formal_800_1200_quality_artifact_required");
  });
});

describe("v7 raw scoring replacement gates", () => {
  it("derives the 800-case gates from raw bound observations and retains separate product acceptance", () => {
    const fixture = evaluationFixture(), result = scoreEvaluationBundle(fixture.bundle, { frozenMatrix: fixture.matrix, registration: fixture.registration });
    expect(result.blockers).toEqual(["raw_680_product_originals_not_verified_fixture_only"]); expect(result.product.counts).toEqual({ passed: 800, failed: 0, not_run: 0, pending: 0 });
    expect(result.product.metrics.factAccuracy.expected).toBe(500); expect(result.product.metrics.profileMicroF1.value).toBe(1);
    expect(result.formalDenominators.rankingReports).toBe(1200); expect(result.productAcceptance).toBe(false);
  });
  it("does not turn missing independent review into a passed fact or remove it from the denominator", () => {
    const fixture = evaluationFixture(); fixture.bundle.reviews = fixture.bundle.reviews.filter((row: any) => row.caseId !== "factual-0");
    fixture.bundle.metrics = { factAccuracy: 1 };
    const result = scoreEvaluationBundle(fixture.bundle, { frozenMatrix: fixture.matrix, registration: fixture.registration });
    expect(result.product.metrics.factAccuracy.expected).toBe(500); expect(result.product.metrics.factAccuracy.pending).toBe(5);
    expect(result.product.metrics.factAccuracy.value).toBeNull(); expect(result.blockers).toContain("quality_gate:factAccuracy");
  });
  it("rejects stale citations, self-review and duplicate profile atom matches", () => {
    for (const mutate of [
      (fixture: any) => { fixture.bundle.sources[0].body = "changed"; },
      (fixture: any) => { fixture.bundle.reviews[0].contextId = "case-author"; },
      (fixture: any) => { const review = fixture.bundle.reviews.find((row: any) => row.caseId === "profile-0"); review.profileAlignment.pairs.push(review.profileAlignment.pairs[0]); },
    ]) { const fixture = evaluationFixture(); mutate(fixture); expect(() => scoreEvaluationBundle(fixture.bundle, { frozenMatrix: fixture.matrix, registration: fixture.registration })).toThrow(); }
  });
  it("rejects regenerating or replacing any of the 600 C observations in the 800-case bundle", () => {
    const fixture = evaluationFixture(), index = fixture.bundle.observations.findIndex((row: any) => row.caseId === "ranking-0");
    fixture.bundle.observations[index] = { ...fixture.bundle.observations[index], invocationId: "repaid-duplicate" };
    expect(() => scoreEvaluationBundle(fixture.bundle, { frozenMatrix: fixture.matrix, registration: fixture.registration })).toThrow("exact_original_C_observation");
  });
  it("never accepts an invented nonranking execution or a changed preregistered exclusion inventory", () => {
    const missing = evaluationFixture(); delete missing.bundle.observations[0].execution;
    expect(() => scoreEvaluationBundle(missing.bundle, { frozenMatrix: missing.matrix, registration: missing.registration })).toThrow("execution_provenance_required");
    const changed = evaluationFixture(); changed.manifest.publicDevelopmentManifestSha256 = canonicalHash("changed-after-register");
    expect(() => scoreEvaluationBundle(changed.bundle, { frozenMatrix: changed.matrix, registration: changed.registration })).toThrow("registered_public_development_manifest_changed");
  });
  it("does not count the same factual claim five times toward the 500 assertion denominator", () => {
    const fixture = evaluationFixture(), review = fixture.bundle.reviews.find((row: any) => row.caseId === "factual-0");
    for (const outcome of review.outcomes.filter((row: any) => row.id.startsWith("fact-"))) { outcome.claimText = "source-0"; outcome.evidence[0].pointer = "/output/statements/0"; outcome.evidence[0].valueSha256 = canonicalHash("source-0"); }
    expect(() => scoreEvaluationBundle(fixture.bundle, { frozenMatrix: fixture.matrix, registration: fixture.registration })).toThrow("duplicate_factual_claim_cannot_inflate_500");
  });
  it("keeps a failing preregistered semantic minority slice visible despite a high overall profile F1", () => {
    const fixture = evaluationFixture();
    fixture.manifest.profileSlices.push({ id: "critical-small-slice", title: "Three preregistered semantic boundary cases", caseIds: ["profile-0", "profile-1", "profile-2"] });
    fixture.manifest.profileSliceProtocolSha256 = canonicalHash(fixture.manifest.profileSlices); fixture.registration.config.profileSliceProtocolSha256 = fixture.manifest.profileSliceProtocolSha256;
    for (const observation of fixture.bundle.observations.filter((row: any) => ["profile-0", "profile-1", "profile-2"].includes(row.caseId))) {
      observation.status = "error"; observation.output = null; observation.outputSha256 = canonicalHash(null);
      fixture.bundle.reviews.find((row: any) => row.caseId === observation.caseId).observationSha256 = canonicalHash(observation);
    }
    const result = scoreEvaluationBundle(fixture.bundle, { frozenMatrix: fixture.matrix, registration: fixture.registration });
    expect(result.product.metrics.profileMicroF1.value).toBeGreaterThan(.95); expect(result.product.metrics.profileMinimumSliceF1.value).toBe(0);
    expect(result.blockers).toContain("quality_gate:profileMinimumSliceF1");
  });
  it("keeps timeout attempts in 100-sample latency gates from the original browser submission", () => {
    const samples = Array.from({ length: 100 }, (_, i) => ({ requestId: `request-${i}`, device: i < 50 ? "desktop" : "mobile", clock: EVALUATION_POLICY.performance.clock,
      originalSubmittedAt: "2026-11-09T00:00:00Z", listRenderedAt: "2026-11-09T00:00:20Z", detailsRenderedAt: "2026-11-09T00:01:00Z", readyExpansionSucceeded: true, readyExpansionMs: 100 }));
    expect(scorePerformance(samples).status).toBe("passed");
    const failed = samples.map((row, i) => i < 6 ? { ...row, listRenderedAt: null, detailsRenderedAt: null } : row);
    expect(scorePerformance(failed)).toMatchObject({ denominator: 100, failedListAttempts: 6, failedDetailAttempts: 6, firstListP95Ms: null, status: "failed" });
    expect(() => scorePerformance(samples.map(row => ({ ...row, clock: "server_enqueued_at" })))).toThrow("original_browser_submit_to_DOM_clock");
  });
});
