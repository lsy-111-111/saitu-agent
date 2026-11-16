import { POLICY_VERSION, POLICY_SHA256, CASE_QUOTAS, TASK_GROUPS, EVALUATION_POLICY, canonicalHash, byteHash } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { deriveRunSeed, seededShuffle } from "../../../scripts/competitions/v6/frozen-ranking-executor.mjs";

/** Synthetic in-memory contract fixtures. No provider, sealed case, or actual gold is used. */
export function evaluationFixture() {
  const stamp = "2026-11-09T00:00:00Z", hash = (value: string) => canonicalHash(value), binding: Record<string, string> = {
    policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    ...Object.fromEntries(["registrationSha256", "challengeManifestSha256", "sourceSnapshotSha256", "rankingSourceSnapshotSha256", "catalogSha256", "implementationSha256", "runtimeConfigurationSha256", "migrationSha256"].map(key => [key, hash(key)])),
  };
  const matrix: any = { schemaVersion: "saitu.frozen-ranking-matrix.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, seed: 6141, freezeBinding: binding, runtime: EVALUATION_POLICY.runtime,
    profileSnapshot: { profiles: [] }, rankings: { schemaVersion: "saitu.ranking-evaluation.v1", purpose: "ai_proxy_acceptance", catalogVersion: "synthetic-v7",
      algorithms: ["B", "C"], expectedRunsPerProfile: 5, profiles: [], runs: [] }, observations: [] };
  const candidates = Array.from({ length: 10 }, (_, i) => `item-${i}`);
  for (let index = 0; index < 120; index++) {
    const profileId = `p-${index}`, caseId = `ranking-${index}`, familyId = `rank-family-${index}`, taskGroup = TASK_GROUPS[Math.floor(index / 20)];
    const profile = { schemaVersion: "saitu.profile.v6", profileId, facts: [] }, input = { profile };
    matrix.profileSnapshot.profiles.push({ profileId, caseId, familyId, taskGroup, profile, input, candidateItemIds: [...candidates] });
    matrix.rankings.profiles.push({ profileId, familyId, taskGroup, poolItemIds: [...candidates], annotationStatus: "pending",
      judgments: candidates.map(itemId => ({ itemId, seriesId: itemId, relevance: "U" })) });
    for (const algorithm of ["B", "C"]) for (let repetition = 0; repetition < 5; repetition++) {
      const invocationId = `${algorithm}-${index}-${repetition}`, output = { recommendations: candidates.slice(0, 5).map(itemId => ({ itemId })), summary: "source" };
      const events = algorithm === "C" ? [{ type: "ai_budget_reserved", details: { reservationId: invocationId } }, { type: "ai_transport_dispatch", details: { model: "deepseek-flash", operation: "competition_v7_rank", thinkingType: "enabled", reasoningEffort: "low", effortPolicySha256: EVALUATION_POLICY.runtime.effortPolicySha256, reservationId: invocationId } }] : [];
      const observation = { schemaVersion: "saitu.ranking-observation.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
        algorithm, profileId, caseId, repetition, invocationId, operation: "recommend", status: "observed", fallback: false,
        inputSha256: canonicalHash(input), output, outputSha256: canonicalHash(output), freezeBinding: binding,
        candidateSetSha256: canonicalHash([...candidates].sort()), candidateOrder: seededShuffle(candidates, deriveRunSeed(6141, profileId, repetition + 1)),
        shuffleSeed: deriveRunSeed(6141, profileId, repetition + 1), skipIndependentRecall: true, events,
        execution: { httpDispatches: algorithm === "C" ? 1 : 0, actualModelRun: algorithm === "C", modelStatus: "ok" },
        reservationIds: algorithm === "C" ? [invocationId] : [], runtime: EVALUATION_POLICY.runtime };
      matrix.observations.push(observation);
      matrix.rankings.runs.push({ algorithm, profileId, runId: invocationId, displayedItemIds: candidates.slice(0, 5), modelStatus: "ok", fallbackUsed: false,
        ...Object.fromEntries(["invocationId", "inputSha256", "outputSha256", "freezeBinding", "candidateSetSha256", "reservationIds"].map(key => [key, (observation as any)[key]])) });
    }
  }
  const manifest: any = { schemaVersion: "saitu.challenge-manifest.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    evidenceClass: "ai_proxy", frozenAt: stamp, implementationFrozenAt: stamp, openedAt: "2026-11-09T00:03:00Z",
    ...Object.fromEntries(["sourceSnapshotSha256", "rankingSourceSnapshotSha256", "catalogSha256", "implementationSha256", "runtimeConfigurationSha256", "migrationSha256"].map(key => [key, binding[key as keyof typeof binding]])),
    publicDevelopmentManifestSha256: hash("public-development"), developmentFamilyIds: ["development-family"], developmentTemplateFamilyIds: ["development-template"],
    developmentInputSha256: [hash("development-input")], implementationAuthorContextIds: ["implementer"], cases: [] };
  const cases: any[] = [], keys: any[] = [], observations: any[] = [], reviews: any[] = [];
  const sourceBody = "source source-0 source-1 source-2 source-3 source-4";
  const source = { sourceId: "synthetic-official", body: sourceBody, bodySha256: byteHash(sourceBody) };
  for (const [layer, quota] of Object.entries(CASE_QUOTAS)) for (let i = 0; i < quota; i++) {
    const ranked = layer === "ranking" ? matrix.profileSnapshot.profiles[i] : null;
    const caseId = ranked?.caseId ?? `${layer}-${i}`, input = ranked?.input ?? { utterance: `学生自述-${layer}-${i}`, syntheticId: caseId };
    const checks: any[] = layer === "hard_constraints" ? [{ id: "constraint", kind: "hard_constraint" }] : layer === "factual" ? [
      ...Array.from({ length: 5 }, (_, j) => ({ id: `fact-${j}`, kind: "fact_accuracy", critical: j === 0 })),
      { id: "citation-support", kind: "citation_precision" }, { id: "citation-cover", kind: "citation_coverage", critical: true },
    ] : layer === "conversation" ? [{ id: "correction", kind: "correction_success" }, { id: "isolation", kind: "correction_isolation" }] :
      layer === "robustness" ? [{ id: "counterfactual", kind: "counterfactual" }] : layer === "ranking" ? [{ id: "reason", kind: "valid_reason", risk: "standard" }] : [];
    const key: any = { caseId, authorContextId: "case-author", checks };
    if (layer === "profile") key.profile = { complete: true, expectedAtoms: [{ kind: "fact", value: { field: "self_report", value: input.utterance, sourceText: input.utterance } }] };
    const identity = { caseId, layer, inputSha256: canonicalHash(input), answerSha256: canonicalHash(key), sourceSnapshotSha256: binding.sourceSnapshotSha256,
      authorContextId: "case-author", familyId: ranked?.familyId ?? `${layer}-family-${i}`, templateFamilyId: `${layer}-template-${Math.floor(i / 20)}`,
      taskGroup: ranked?.taskGroup ?? TASK_GROUPS[i % 6], split: "sealed", scope: { hard_constraints: "explicit_student_constraint", factual: "source_scoped_fact", ranking: "full_core_ranking",
        profile: "direct_student_profile", conversation: "direct_correction_conversation", robustness: "robustness_and_recovery" }[layer],
      keyReview: { contextId: "independent-key-reviewer", inputSha256: canonicalHash(input), answerSha256: canonicalHash(key), policySha256: POLICY_SHA256,
        passed: true, sealedAt: stamp, evidenceSha256: hash("key-review") } };
    manifest.cases.push(identity); cases.push({ ...identity, input }); keys.push(key);
    for (let repetition = 0; repetition < (layer === "ranking" ? 5 : 1); repetition++) {
      const original = ranked ? matrix.observations.find((row: any) => row.caseId === caseId && row.algorithm === "C" && row.repetition === repetition) : null;
      const output = layer === "profile" ? { facts: [{ field: "self_report", value: input.utterance, sourceText: input.utterance }], unknownFields: [], summary: "source" } :
        layer === "factual" ? { summary: "source", statements: Array.from({ length: 5 }, (_, j) => `source-${j}`) } : { summary: "source" };
      const observation = original ?? { caseId, repetition, invocationId: `product-${caseId}`, inputSha256: canonicalHash(input), output, outputSha256: canonicalHash(output),
        freezeBinding: binding, status: "observed" };
      observations.push(observation);
      const review: any = { caseId, repetition, contextId: "independent-output-reviewer", policySha256: POLICY_SHA256, keySha256: canonicalHash(key),
        observationSha256: canonicalHash(observation), reviewedAt: "2026-11-09T00:05:00Z", rationale: "Synthetic contract check", outcomes: checks.map(check => ({ id: check.id, passed: true,
          reason: "Synthetic contract check", ...(check.kind === "fact_accuracy" ? { claimText: `source-${check.id.split("-")[1]}` } : {}),
          evidence: [{ pointer: check.kind === "fact_accuracy" ? `/output/statements/${check.id.split("-")[1]}` : "/output/summary", valueSha256: canonicalHash(check.kind === "fact_accuracy" ? `source-${check.id.split("-")[1]}` : "source"),
            ...(["fact_accuracy", "citation_precision", "citation_coverage"].includes(check.kind) ? { source: { sourceId: source.sourceId, bodySha256: source.bodySha256, quote: "source" } } : {}) }] })) };
      if (layer === "profile") review.profileAlignment = { complete: true, pairs: [{ expected: 0, observed: 0, reason: "same student statement" }] };
      if (layer === "factual") review.factAudit = { complete: true, observedClaimIds: checks.filter(check => check.kind === "fact_accuracy").map(check => check.id), additionalClaims: [] };
      reviews.push(review);
    }
  }
  manifest.profileSlices = Array.from({ length: 6 }, (_, group) => ({ id: `semantic-profile-slice-${group}`, title: `Synthetic semantic slice ${group}`,
    caseIds: manifest.cases.filter((row: any) => row.layer === "profile").slice(group * 20, group * 20 + 20).map((row: any) => row.caseId) }));
  manifest.profileSliceProtocolSha256 = canonicalHash(manifest.profileSlices);
  for (const observation of observations.filter(row => !row.algorithm)) Object.assign(observation, { schemaVersion: "saitu.product-observation.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    runtime: EVALUATION_POLICY.runtime, events: [], execution: { kind: "local_product", actualModelRun: false, httpDispatches: 0, producerPath: "scripts/competitions/v7/evaluation-executor.mjs", producerSha256: hash("synthetic-producer"),
      executionRuntimeConfigurationSha256: hash("synthetic-execution-runtime") } });
  for (const review of reviews) review.observationSha256 = canonicalHash(observations.find(row => row.caseId === review.caseId && row.repetition === review.repetition));
  const reviewBasis = { publicSpecificationSha256: hash("public-spec"), catalogSha256: binding.catalogSha256, implementationSha256: binding.implementationSha256,
    runtimeConfigurationSha256: binding.runtimeConfigurationSha256 };
  const migration: any = { schemaVersion: "saitu.evaluation-migration.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    originalInventorySha256: hash("old-public-inventory"), originalEvidencePreserved: true, authorContextId: "migration-author", implementationAuthorContextIds: ["implementer"], reviewBasis,
    rows: manifest.cases.map((row: any) => ({ originalCaseId: `old-${row.caseId}`, layer: row.layer, originalInputSha256: hash(`old-${row.caseId}`),
      action: "replace", scope: "ability_certification", rationale: "replace retired evidence-verification semantics", replacement: row,
      applicabilityReview: { contextId: "independent-key-reviewer", policySha256: POLICY_SHA256, inputSha256: row.inputSha256, answerSha256: row.answerSha256,
        basisSha256: canonicalHash(reviewBasis), decision: "applicable", reason: "same layer new policy", reviewedAt: stamp, evidenceSha256: hash("applicability-review") } })) };
  migration.independentReview = { contextId: "independent-migration-reviewer", decisionsSha256: canonicalHash(migration.rows), basisSha256: canonicalHash(reviewBasis),
    policySha256: POLICY_SHA256, passed: true, reviewedAt: stamp, evidenceSha256: hash("migration-review") };
  const gold: any = { schemaVersion: "saitu.ranking-gold.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, catalogSha256: manifest.catalogSha256,
    rankingSourceSnapshotSha256: manifest.rankingSourceSnapshotSha256, profilePoolSha256: canonicalHash(matrix.rankings.profiles.map((profile: any) => ({ profileId: profile.profileId, familyId: profile.familyId,
      taskGroup: profile.taskGroup, poolItemIds: profile.poolItemIds, series: profile.judgments.map(({ itemId, seriesId }: any) => ({ itemId, seriesId })) }))),
    originals: ["rank-reviewer-a", "rank-reviewer-b"].map(contextId => ({ contextId, blindToAlgorithms: true, productOutputsRead: false, freshContext: true, oldJudgmentsRead: false, otherReviewerJudgmentsRead: false, authorModel: "gpt-6.1-sol", authorEffort: "max", openedAt: stamp, sealedAt: stamp,
      profiles: matrix.rankings.profiles.map((pool: any) => ({ profileId: pool.profileId, poolItemIds: pool.poolItemIds,
        judgments: pool.poolItemIds.map((itemId: string) => ({ itemId, relevance: Number(itemId.split("-")[1]) < 5 ? 3 : 1, reason: "synthetic preregistered relevance" })) })) })) };
  const registration: any = { registeredAt: "2026-11-09T00:01:00Z", config: { runtime: EVALUATION_POLICY.runtime, ...Object.fromEntries(Object.keys(binding).filter(key => key.endsWith("Sha256")).map(key => [key, binding[key as keyof typeof binding]])), reviewSampleSeed: 20261109,
    publicDevelopmentManifestSha256: manifest.publicDevelopmentManifestSha256, profileSliceProtocolSha256: manifest.profileSliceProtocolSha256 } };
  const bundle: any = { schemaVersion: "saitu.evaluation-bundle.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, manifest, migration,
    cases, keys, observations, reviews, sources: [source], rankingGold: gold, reviewSampleSeed: 20261109 };
  return { matrix, manifest, gold, migration, registration, bundle };
}
