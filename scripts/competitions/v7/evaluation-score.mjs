import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const { evaluateRankings, pairedFamilyBootstrap } = createRequire(import.meta.url)("../v6/evaluate-rankings.ts");
const { ordinalAgreement } = createRequire(import.meta.url)("../v6/reviewer-agreement.ts");
import { POLICY_VERSION, POLICY_SHA256, EVALUATION_POLICY, TASK_GROUPS, FORMAL_ARMS, canonicalHash, byteHash, isHash, isTime, same,
  requirePolicy, assertQuotas, assertUnique, jsonPointer, lowRiskSample, writeNewJson, parseFileCli } from "./evaluation-policy.mjs";
import { createCReuse, validateFrozenMatrix, loadRankingReuse } from "./evaluation-reuse.mjs";
import { inspectMigration } from "./evaluation-migration.mjs";
import { isVerifiedOriginals, loadScoringOriginals, getVerifiedRankingPanels } from "./evaluation-originals.mjs";
import { hasVersionedUnknownTemplateContract } from "./evaluation-development-exclusions.mjs";
import { preflightScoringRegistration } from "./evaluation-registration.mjs";
import { validateEvaluationRuntime, assertDispatchEffort } from "./evaluation-effort.mjs";
import { validateCompleteReviewerProvenance } from "./evaluation-packets.mjs";

const CHECK_KINDS = ["hard_constraint", "fact_accuracy", "citation_precision", "citation_coverage", "correction_success", "correction_isolation", "valid_reason", "counterfactual", "profile_semantic_boundary"];
const METRICS = { hard_constraint: "hardConstraintViolations", fact_accuracy: "factAccuracy", citation_precision: "citationPrecision", citation_coverage: "citationCoverage",
  correction_success: "correctionSuccess", correction_isolation: "correctionIsolation", valid_reason: "validReasons", counterfactual: "expectedCounterfactualResponses", profile_semantic_boundary: "profileSemanticBoundaryPass" };
const emptyCount = () => ({ expected: 0, passed: 0, failed: 0, pending: 0 });
const f1 = c => 2 * c.tp + c.fp + c.fn ? 2 * c.tp / (2 * c.tp + c.fp + c.fn) : null;

export function inspectChallengeManifest(manifest) {
  requirePolicy(manifest); assertQuotas(manifest.cases);
  const issues = [];
  if (manifest.schemaVersion !== "saitu.challenge-manifest.v7.1" || manifest.evidenceClass !== "ai_proxy" ||
      !isTime(manifest.frozenAt) || !isTime(manifest.implementationFrozenAt) ||
      (manifest.openedAt !== null && (!isTime(manifest.openedAt) || Date.parse(manifest.openedAt) < Math.max(Date.parse(manifest.frozenAt), Date.parse(manifest.implementationFrozenAt))))) issues.push("v7_challenge_provenance_or_timeline_required");
  for (const key of ["implementationSha256", "runtimeConfigurationSha256", "catalogSha256", "migrationSha256", "sourceSnapshotSha256", "rankingSourceSnapshotSha256", "publicDevelopmentManifestSha256"]) if (!isHash(manifest[key])) issues.push(`challenge_hash_required:${key}`);
  if (!Array.isArray(manifest.developmentFamilyIds) || !Array.isArray(manifest.developmentTemplateFamilyIds) || !Array.isArray(manifest.developmentInputSha256) ||
      !manifest.developmentFamilyIds.length || (!manifest.developmentTemplateFamilyIds.length && !hasVersionedUnknownTemplateContract(manifest)) || !manifest.developmentInputSha256.length) issues.push("public_development_exclusion_inventory_required");
  assertUnique(manifest.cases.map(row => row.inputSha256), "duplicate_v7_challenge_input");
  const implementers = manifest.implementationAuthorContextIds ?? [];
  if (!implementers.length || implementers.some(id => !id)) issues.push("implementation_authors_must_be_recorded");
  for (const row of manifest.cases) {
    if (!row.familyId || !row.templateFamilyId || !row.taskGroup || row.split !== "sealed" ||
        ![row.inputSha256, row.answerSha256, row.sourceSnapshotSha256].every(isHash) || !row.authorContextId) issues.push(`case_metadata_incomplete:${row.caseId}`);
    if (manifest.developmentFamilyIds?.includes(row.familyId) || manifest.developmentTemplateFamilyIds?.includes(row.templateFamilyId) || manifest.developmentInputSha256?.includes(row.inputSha256)) issues.push(`development_contamination:${row.caseId}`);
    if (row.layer !== "ranking") {
      const review = row.keyReview;
      if (!review || !review.contextId || [row.authorContextId, ...implementers].includes(review.contextId) || review.answerSha256 !== row.answerSha256 ||
          review.inputSha256 !== row.inputSha256 || review.policySha256 !== POLICY_SHA256 || review.passed !== true || !isTime(review.sealedAt) ||
          Date.parse(review.sealedAt) > Date.parse(manifest.frozenAt) || !isHash(review.evidenceSha256)) issues.push(`one_independent_key_round_pending:${row.caseId}`);
    }
  }
  const ranking = manifest.cases.filter(row => row.layer === "ranking");
  if (new Set(ranking.map(row => row.familyId)).size !== 120 || TASK_GROUPS.some(group => ranking.filter(row => row.taskGroup === group).length !== 20)) issues.push("six_groups_twenty_independent_families_required");
  const profileCases = new Set(manifest.cases.filter(row => row.layer === "profile").map(row => row.caseId));
  if (!Array.isArray(manifest.profileSlices) || manifest.profileSlices.length < 2 || manifest.profileSliceProtocolSha256 !== canonicalHash(manifest.profileSlices) ||
      new Set(manifest.profileSlices.map(row => row.id)).size !== manifest.profileSlices.length ||
      manifest.profileSlices.some(row => !row.id || !row.title || !Array.isArray(row.caseIds) || !row.caseIds.length || new Set(row.caseIds).size !== row.caseIds.length || row.caseIds.some(id => !profileCases.has(id))) ||
      [...profileCases].some(id => !manifest.profileSlices.some(slice => slice.caseIds.includes(id)))) issues.push("fixed_semantic_profile_slice_membership_required");
  return [...new Set(issues)];
}

/** Ranking alone requires two independently sealed blind originals. U never becomes grade zero. */
export function resolveRankingGold(matrix, gold, manifest, registeredAt) {
  requirePolicy(gold);
  if (gold.schemaVersion !== "saitu.ranking-gold.v7.1" || gold.catalogSha256 !== manifest.catalogSha256 ||
      gold.rankingSourceSnapshotSha256 !== manifest.rankingSourceSnapshotSha256 || !same(gold.profilePoolSha256, canonicalHash(matrix.rankings.profiles.map(profile => ({
        profileId: profile.profileId, familyId: profile.familyId, taskGroup: profile.taskGroup, poolItemIds: profile.poolItemIds,
        series: profile.judgments.map(({ itemId, seriesId }) => ({ itemId, seriesId })),
      }))))) throw new Error("v7_ranking_gold_frozen_pool_changed");
  const originals = gold.originals;
  if (!Array.isArray(originals) || originals.length !== 2 || new Set(originals.map(row => row.contextId)).size !== 2) throw new Error("v7_two_blind_ranking_originals_required");
  for (const original of originals) {
    if (matrix.runtime?.effortPolicy !== undefined) validateCompleteReviewerProvenance(original, { blockedContextIds: [...manifest.implementationAuthorContextIds, gold.coordinatorContextId].filter(Boolean) });
    if (!original.contextId || manifest.implementationAuthorContextIds.includes(original.contextId) || original.blindToAlgorithms !== true || original.productOutputsRead !== false ||
        !isTime(original.openedAt) || !isTime(original.sealedAt) || !(Date.parse(original.openedAt) <= Date.parse(original.sealedAt) && Date.parse(original.sealedAt) <= Date.parse(registeredAt)) ||
        !Array.isArray(original.profiles) || original.profiles.length !== 120) throw new Error("v7_ranking_original_not_independent_or_prefrozen");
    assertUnique(original.profiles.map(row => row.profileId), "duplicate_ranking_gold_profile");
  }
  const adjudicator = gold.adjudicator, resolutions = new Map(), used = new Set();
  if (adjudicator) {
    if (!adjudicator.contextId || [...originals.map(row => row.contextId), ...manifest.implementationAuthorContextIds].includes(adjudicator.contextId) ||
        !same(adjudicator.resolvesOriginalSha256, originals.map(canonicalHash)) || !isTime(adjudicator.sealedAt) ||
        !(Date.parse(adjudicator.sealedAt) >= Math.max(...originals.map(row => Date.parse(row.sealedAt))) && Date.parse(adjudicator.sealedAt) <= Date.parse(registeredAt))) throw new Error("v7_ranking_adjudication_not_bound_to_originals");
    for (const row of adjudicator.resolutions ?? []) {
      const key = JSON.stringify([row.profileId, row.itemId]);
      if (resolutions.has(key) || ![0, 1, 2, 3, "U"].includes(row.relevance) || !row.reason?.trim()) throw new Error("invalid_ranking_gold_resolution");
      resolutions.set(key, row);
    }
  }
  const resolved = matrix.rankings.profiles.map(pool => {
    const identity = manifest.cases.find(row => row.layer === "ranking" && row.familyId === pool.familyId);
    const rows = originals.map(original => original.profiles.find(row => row.profileId === pool.profileId));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || originals[i].contextId === identity?.authorContextId || !same(row.poolItemIds, pool.poolItemIds) ||
          !Array.isArray(row.judgments) || row.judgments.length !== pool.poolItemIds.length ||
          new Set(row.judgments.map(j => j.itemId)).size !== row.judgments.length ||
          row.judgments.some(j => !pool.poolItemIds.includes(j.itemId) || ![0, 1, 2, 3, "U"].includes(j.relevance) || !j.reason?.trim())) throw new Error("incomplete_or_changed_original_ranking_pool");
    }
    const judgments = pool.judgments.map(item => {
      const first = rows[0].judgments.find(row => row.itemId === item.itemId), second = rows[1].judgments.find(row => row.itemId === item.itemId);
      const key = JSON.stringify([pool.profileId, item.itemId]);
      let relevance = first.relevance;
      if (first.relevance !== second.relevance || first.relevance === "U") {
        const resolution = resolutions.get(key);
        if (!resolution || !same(resolution.originalJudgmentSha256, [canonicalHash(first), canonicalHash(second)])) throw new Error("ranking_disagreement_without_bound_adjudication");
        relevance = resolution.relevance; used.add(key);
      }
      return { itemId: item.itemId, seriesId: item.seriesId, relevance };
    });
    if ([...resolutions.keys()].some(key => JSON.parse(key)[0] === pool.profileId && !used.has(key))) throw new Error("unnecessary_ranking_gold_adjudication");
    return { ...pool, judgments, annotationStatus: "ai_blind_reviewed" };
  });
  if (resolutions.size !== used.size) throw new Error("extra_or_unbound_ranking_gold_adjudication");
  return resolved;
}

/** Reliability uses both untouched originals, never adjudicated replacements or repeated model runs. */
export function originalRankingAgreement(matrix, gold) {
  requirePolicy(gold);
  if (!Array.isArray(gold.originals) || gold.originals.length !== 2) throw new Error("two_original_ranking_reviews_required_for_agreement");
  const pairs = [], groups = new Map(), missing = [];
  for (const pool of matrix.rankings.profiles) {
    const originals = gold.originals.map(original => original.profiles?.find(row => row.profileId === pool.profileId));
    for (const itemId of pool.poolItemIds) {
      const ratings = originals.map((original, index) => {
        const rows = original?.judgments?.filter(row => row.itemId === itemId) ?? [];
        if (!rows.length) { missing.push({ original: index, profileId: pool.profileId, itemId }); return "U"; }
        if (rows.length !== 1) throw new Error("duplicate_original_ranking_grade");
        return rows[0].relevance;
      });
      pairs.push(ratings);
      const group = groups.get(pool.taskGroup) ?? []; group.push(ratings); groups.set(pool.taskGroup, group);
    }
  }
  return { ...ordinalAgreement(pairs), missingOriginalJudgments: missing, coverageComplete: missing.length === 0,
    minimumAlpha: .70, source: "two_sealed_originals_before_adjudication", byTaskGroup: [...groups].map(([taskGroup, values]) => ({ taskGroup, ...ordinalAgreement(values) })) };
}

export function scoreRankingGate(matrix, gold, manifest, registeredAt, verification) {
  const execution = validateFrozenMatrix(matrix);
  let panels = null;
  if (gold?.schemaVersion === "saitu.ranking-gold.v7.2") {
    requirePolicy(gold);
    if (verification && same(verification.bundle?.rankingGold, gold) && same(verification.bundle?.manifest, manifest) &&
        verification.registration?.registeredAt === registeredAt) {
      panels = getVerifiedRankingPanels(verification.verifiedOriginals, { bundle: verification.bundle, matrix, registration: verification.registration });
    }
    if (!panels) return { schemaVersion: "saitu.ranking-gate.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
      status: "failed_or_pending", selectedForReuse: null, blockers: ["raw_v72_ranking_panel_originals_not_verified"], ranking: null,
      taskGroups: [], paired: null, execution, originalAgreement: null, additionalRankingPaidRuns: 0, productAcceptance: false };
  }
  const originalAgreement = panels ? panels.originalAgreement : originalRankingAgreement(matrix, gold);
  const agreementBlockers = [];
  if (!originalAgreement.coverageComplete) agreementBlockers.push("original_blind_label_coverage_incomplete");
  if (originalAgreement.value === null || originalAgreement.paired < 2) agreementBlockers.push("original_blind_agreement_alpha_pending_or_null");
  else if (originalAgreement.value < .70) agreementBlockers.push("original_blind_agreement_alpha_below_070");
  if (panels) {
    agreementBlockers.push(...panels.blockers);
    if (!panels.goldReady || !panels.resolvedProfiles || panels.unresolvedAfterAdjudication !== 0) agreementBlockers.push("v72_ranking_gold_unresolved");
  }
  if (agreementBlockers.length) return { schemaVersion: "saitu.ranking-gate.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    status: "failed_or_pending", selectedForReuse: null, blockers: [...new Set(agreementBlockers)], ranking: null, taskGroups: [], paired: null, execution,
    originalAgreement, additionalRankingPaidRuns: 0, productAcceptance: false };
  const profiles = panels ? panels.resolvedProfiles : resolveRankingGold(matrix, gold, manifest, registeredAt);
  const ranking = evaluateRankings({ ...matrix.rankings, profiles });
  const candidate = ranking.summaries.find(row => row.algorithm === "C"), control = ranking.summaries.find(row => row.algorithm === "B");
  const blockers = [];
  const candidateGroups = TASK_GROUPS.map(taskGroup => {
    const rows = ranking.profileResults.filter(row => row.algorithm === "C" && row.taskGroup === taskGroup);
    const value = rows.length === 20 && rows.every(row => Number.isFinite(row.pooledNdcg5)) ? rows.reduce((sum, row) => sum + row.pooledNdcg5, 0) / rows.length : null;
    return { taskGroup, independentFamilies: rows.length, pooledNdcg5: value };
  });
  if (!candidate?.aiProxyAcceptanceEligible || !control?.aiProxyAcceptanceEligible || candidate.scoredFamilyCount !== 120 || control.scoredFamilyCount !== 120) blockers.push("complete_independent_pool_labels_required");
  // nDCG@10 remains a diagnostic in the legacy calculator, with no Top5 gate.
  for (const [key, target] of [["pooledNdcg5", EVALUATION_POLICY.ranking.ndcg5], ["top5SeriesJaccard", EVALUATION_POLICY.ranking.top5SeriesJaccard]]) if (!Number.isFinite(candidate?.[key]) || candidate[key] < target) blockers.push(`C_${key}_below_gate`);
  if (candidateGroups.some(row => row.pooledNdcg5 === null || row.pooledNdcg5 < .75)) blockers.push("C_task_group_ndcg5_below_gate");
  const pairs = arm => arm.families.filter(row => Number.isFinite(row.pooledNdcg5)).map(row => ({ familyId: row.familyId, value: row.pooledNdcg5 }));
  let paired = null;
  if (candidate && control && pairs(candidate).length === 120 && pairs(control).length === 120) paired = pairedFamilyBootstrap(pairs(candidate), pairs(control), 2000, matrix.seed);
  if (!paired || paired.interval[0] < -.02) blockers.push("C_minus_B_family_bootstrap_lower_below_minus_002");
  if (execution.actualModelRuns !== 600) blockers.push("all_600_C_invocations_must_have_real_dispatch");
  return { schemaVersion: "saitu.ranking-gate.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    status: blockers.length ? "failed_or_pending" : "passed", selectedForReuse: blockers.length ? null : "C", blockers, ranking,
    taskGroups: candidateGroups, paired, execution, originalAgreement, additionalRankingPaidRuns: 0, productAcceptance: false };
}

function validateEvidence(observation, evidence, sources) {
  if (!Array.isArray(evidence) || !evidence.length) throw new Error("independent_verdict_requires_original_output_evidence");
  for (const point of evidence) {
    if (!point.pointer?.startsWith("/output/") || point.valueSha256 !== canonicalHash(jsonPointer(observation, point.pointer))) throw new Error("review_not_bound_to_original_output");
    if (point.source) {
      const source = sources.find(row => row.sourceId === point.source.sourceId);
      if (!source || source.bodySha256 !== byteHash(source.body) || source.bodySha256 !== point.source.bodySha256 ||
          !point.source.quote?.trim() || !source.body.includes(point.source.quote)) throw new Error("review_not_bound_to_original_source_bytes");
    }
  }
}
function profileAtoms(output) {
  if (!output || !Array.isArray(output.facts) || !Array.isArray(output.unknownFields)) return null;
  return [...output.facts.map(value => ({ kind: "fact", value })), ...output.unknownFields.map(value => ({ kind: "unknown", value }))];
}
function semanticAtoms(raw, declared, document, prefix, rawIndexForPointer) {
  if (!declared) return raw;
  if (!Array.isArray(declared)) throw new Error("exhaustive_semantic_atomization_required");
  const seen = new Set(), covered = new Set();
  for (const atom of declared) {
    const point = atom.evidence;
    if (!["fact", "unknown"].includes(atom.kind) || !point || !point.pointer?.startsWith(prefix) ||
        point.valueSha256 !== canonicalHash(jsonPointer(document, point.pointer))) throw new Error("semantic_atom_not_bound_to_original_record");
    const value = jsonPointer(document, point.pointer), text = typeof value === "string" ? value : JSON.stringify(value);
    const suffix = point.pointer.slice(prefix.length), index = rawIndexForPointer ? rawIndexForPointer(point.pointer) : Number(suffix.split("/")[0]);
    if (!Number.isSafeInteger(index) || index < 0 || index >= raw.length) throw new Error("semantic_atom_outside_raw_atom_inventory");
    if (point.span === undefined || point.span === null) {
      if (typeof value === "string" || !same(atom.value, raw[index].value)) throw new Error("semantic_atom_span_required_for_partial_or_string_proposition");
    } else if (typeof point.span !== "string" || !point.span.trim() || !text.includes(point.span)) throw new Error("semantic_atom_span_not_in_original_value");
    if (atom.kind !== raw[index].kind) throw new Error("semantic_atom_kind_changed");
    const identity = JSON.stringify([point.pointer, point.span ?? null]); if (seen.has(identity)) throw new Error("duplicate_semantic_atom_span"); seen.add(identity);
    covered.add(index);
  }
  if (covered.size !== raw.length) throw new Error("semantic_atomization_not_exhaustive");
  return declared.map(({ kind, value }) => ({ kind, value }));
}
function scoreProduct(bundle, matrix, runtime) {
  const policy = validateEvaluationRuntime(runtime), legacy = runtime.effortPolicy === undefined;
  const { manifest, cases, keys, observations, reviews, sources } = bundle;
  assertQuotas(cases); assertUnique(keys.map(row => row.caseId), "duplicate_product_scoring_key");
  const identities = new Map(manifest.cases.map(row => [row.caseId, row]));
  const byKey = new Map(keys.map(row => [row.caseId, row])), observed = new Map(), reviewMap = new Map();
  if (keys.length !== 800 || keys.some(row => !identities.has(row.caseId))) throw new Error("exact_800_scoring_key_scope_required");
  const reuse = createCReuse(matrix), counts = Object.fromEntries(CHECK_KINDS.map(kind => [kind, emptyCount()]));
  const criticalFacts = emptyCount(), criticalCoverage = emptyCount(), profileCounts = { cases: 0, tp: 0, fp: 0, fn: 0 }, slices = new Map(), pendingProfile = [];
  const lowRiskIds = keys.flatMap(key => (key.checks ?? []).filter(check => check.kind === "valid_reason" && check.risk === "low").map(check => `${key.caseId}:${check.id}`));
  const selectedLowRisk = lowRiskSample(lowRiskIds, bundle.reviewSampleSeed), selectedLowRiskSet = new Set(selectedLowRisk);
  for (const observation of observations) {
    const key = JSON.stringify([observation.caseId, observation.repetition ?? 0]);
    const identity = identities.get(observation.caseId);
    if (observed.has(key) || !identity || !Number.isInteger(observation.repetition ?? 0) || (observation.repetition ?? 0) < 0 ||
        (observation.repetition ?? 0) >= (identity.layer === "ranking" ? 5 : 1)) throw new Error("duplicate_or_foreign_product_observation");
    if (identity.layer !== "ranking") {
      requirePolicy(observation);
      if (observation.schemaVersion !== "saitu.product-observation.v7.1" || !observation.invocationId || !observation.execution || !Array.isArray(observation.events) ||
          !["local_product", "live_product"].includes(observation.execution.kind) || !isHash(observation.execution.producerSha256) ||
          observation.execution.producerPath !== "scripts/competitions/v7/evaluation-executor.mjs" || !isHash(observation.execution.executionRuntimeConfigurationSha256) ||
          !["observed", "error", "not_run", "indeterminate"].includes(observation.status)) throw new Error("actual_nonranking_product_execution_provenance_required");
      const dispatches = observation.events.filter(event => event.type === "ai_transport_dispatch");
      if (observation.execution.httpDispatches !== dispatches.length || observation.execution.actualModelRun !== Boolean(dispatches.length) ||
          dispatches.some(event => event.details?.model !== "deepseek-flash" || !event.details?.reservationId)) throw new Error("nonranking_actual_dispatch_evidence_mismatch");
      if (!legacy && !same(observation.runtime, runtime)) throw new Error("nonranking_runtime_effort_policy_changed");
      for (const event of dispatches) assertDispatchEffort(event.details, policy, { legacy });
    }
    observed.set(key, observation);
  }
  assertUnique(observations.map(row => row.invocationId), "duplicate_product_invocation_identity");
  for (const review of reviews) {
    const key = JSON.stringify([review.caseId, review.repetition]);
    const identity = identities.get(review.caseId);
    if (reviewMap.has(key) || !identity || !Number.isInteger(review.repetition) || review.repetition < 0 || review.repetition >= (identity.layer === "ranking" ? 5 : 1)) throw new Error("one_independent_output_review_per_case_run_required");
    reviewMap.set(key, review);
  }
  const results = [];
  for (const item of cases) {
    const identity = identities.get(item.caseId), key = byKey.get(item.caseId);
    if (!identity || identity.layer !== item.layer || identity.inputSha256 !== canonicalHash(item.input) || !key || identity.answerSha256 !== canonicalHash(key) || key.authorContextId !== identity.authorContextId) throw new Error("product_case_or_key_changed_since_freeze");
    const checks = key.checks ?? [];
    assertUnique(checks.map(check => check.id), "duplicate_key_obligation");
    if (checks.some(check => !CHECK_KINDS.includes(check.kind) || (check.critical !== undefined && typeof check.critical !== "boolean"))) throw new Error("unknown_v7_scoring_obligation");
    if (checks.some(check => check.kind === "counterfactual" && item.layer !== "robustness")) throw new Error("robustness_counterfactual_metric_cannot_include_profile_or_other_layers");
    const mandatory = { hard_constraints: ["hard_constraint"], factual: ["fact_accuracy", "citation_precision", "citation_coverage"], conversation: ["correction_success", "correction_isolation"], robustness: ["counterfactual"] }[item.layer] ?? [];
    if (mandatory.some(kind => !checks.some(check => check.kind === kind))) throw new Error(`layer_obligations_missing:${item.caseId}`);
    const repeats = item.layer === "ranking" ? 5 : 1, runs = [];
    for (let repetition = 0; repetition < repeats; repetition++) {
      const observation = observed.get(JSON.stringify([item.caseId, repetition]));
      if (observation && (observation.inputSha256 !== identity.inputSha256 || observation.outputSha256 !== canonicalHash(observation.output) ||
          !same(observation.freezeBinding, matrix.freezeBinding))) throw new Error("product_observation_binding_changed");
      if (item.layer === "ranking") {
        const original = reuse.get({ caseId: item.caseId, repetition, input: item.input });
        if (!observation || !same(original, observation)) throw new Error("800_ranking_must_reuse_exact_original_C_observation");
      }
      const review = reviewMap.get(JSON.stringify([item.caseId, repetition]));
      const available = observation?.status === "observed";
      if (review && (!observation || !review.contextId || [identity.authorContextId, ...manifest.implementationAuthorContextIds].includes(review.contextId) ||
          review.observationSha256 !== canonicalHash(observation) || review.keySha256 !== identity.answerSha256 || review.policySha256 !== POLICY_SHA256 ||
          !isTime(review.reviewedAt) || !review.rationale?.trim())) throw new Error("v7_output_review_not_independent_or_bound");
      const extraFacts = review?.factAudit?.additionalClaims ?? [];
      if (!Array.isArray(extraFacts) || extraFacts.some(row => !row.id?.startsWith("additional_fact:") || checks.some(check => check.id === row.id))) throw new Error("additional_factual_claims_require_distinct_audit_ids");
      const sampledChecks = [...checks.filter(check => check.kind !== "valid_reason" || check.risk !== "low" || selectedLowRiskSet.has(`${item.caseId}:${check.id}`)),
        ...extraFacts.map(row => ({ id: row.id, kind: "fact_accuracy", critical: row.critical === true }))];
      if (review) {
        assertUnique((review.outcomes ?? []).map(row => row.id), "duplicate_independent_review_outcome");
        if ((review.outcomes ?? []).some(row => !sampledChecks.some(check => check.id === row.id))) throw new Error("review_outside_frozen_obligation_or_sample");
      }
      const factualChecks = sampledChecks.filter(check => check.kind === "fact_accuracy");
      const completeFactAudit = review?.factAudit?.complete === true && same([...(review.factAudit.observedClaimIds ?? [])].sort(), factualChecks.map(check => check.id).sort());
      const observedFactSpans = new Set();
      const states = [];
      for (const check of sampledChecks) {
        const outcome = review?.outcomes?.find(row => row.id === check.id) ?? extraFacts.find(row => row.id === check.id);
        let status = "pending";
        if (observation?.status === "error") status = "failed";
        else if (available && outcome && [true, false].includes(outcome.passed) && outcome.reason?.trim() && (check.kind !== "fact_accuracy" || completeFactAudit)) {
          validateEvidence(observation, outcome.evidence, sources);
          if (["fact_accuracy", "citation_precision", "citation_coverage"].includes(check.kind) && !outcome.evidence.some(point => point.source)) throw new Error("fact_and_citation_verdict_requires_frozen_source");
          if (check.kind === "fact_accuracy") {
            const span = outcome.claimText?.trim();
            if (!span || !outcome.evidence.some(point => { const value = jsonPointer(observation, point.pointer); return (typeof value === "string" ? value : JSON.stringify(value)).includes(span); })) throw new Error("fact_accuracy_unit_requires_an_actual_output_claim_span");
            if (observedFactSpans.has(span)) throw new Error("duplicate_factual_claim_cannot_inflate_500_assertion_denominator");
            observedFactSpans.add(span);
          }
          status = outcome.passed ? "passed" : "failed";
        }
        for (const count of [counts[check.kind], ...(check.kind === "fact_accuracy" && check.critical ? [criticalFacts] : []), ...(check.kind === "citation_coverage" && check.critical ? [criticalCoverage] : [])]) {
          count.expected++; count[status]++;
        }
        states.push({ id: check.id, kind: check.kind, status });
      }
      if (item.layer === "profile") {
        let expected = key.profile?.expectedAtoms, actual = observation?.status === "error" ? [] : profileAtoms(observation?.output);
        if (!Array.isArray(expected) || key.profile.complete !== true || expected.some(atom => !["fact", "unknown"].includes(atom.kind))) throw new Error("exhaustive_independently_reviewed_profile_reference_required");
        const alignment = review?.profileAlignment;
        // Expected semantic atoms are frozen inside the independently reviewed key, before any product output.
        expected = semanticAtoms(expected, key.profile.expectedSemanticAtoms, key, "/profile/expectedAtoms/");
        if (actual && alignment?.actualSemanticAtoms) {
          const factCount = observation.output.facts.length;
          actual = semanticAtoms(actual, alignment.actualSemanticAtoms, observation, "/output/", pointer => {
            const fact = pointer.match(/^\/output\/facts\/(\d+)(?:\/|$)/), unknown = pointer.match(/^\/output\/unknownFields\/(\d+)(?:\/|$)/);
            return fact ? Number(fact[1]) : unknown ? factCount + Number(unknown[1]) : -1;
          });
        }
        let pairs = null;
        if (observation?.status === "error") pairs = [];
        else if (available && actual && alignment?.complete === true && Array.isArray(alignment.pairs)) {
          const left = new Set(), right = new Set();
          for (const pair of alignment.pairs) {
            if (!Number.isSafeInteger(pair.expected) || !Number.isSafeInteger(pair.observed) || !expected[pair.expected] || !actual[pair.observed] ||
                expected[pair.expected].kind !== actual[pair.observed].kind || left.has(pair.expected) || right.has(pair.observed) || !pair.reason?.trim()) throw new Error("profile_alignment_must_be_one_to_one");
            left.add(pair.expected); right.add(pair.observed);
          }
          pairs = alignment.pairs;
        }
        if (pairs === null) pendingProfile.push(item.caseId);
        else for (const counter of [profileCounts, ...manifest.profileSlices.filter(slice => slice.caseIds.includes(item.caseId)).map(slice => slices.get(slice.id) ?? (slices.set(slice.id, { cases: 0, tp: 0, fp: 0, fn: 0 }), slices.get(slice.id)))]) {
          counter.cases++; counter.tp += pairs.length; counter.fp += actual.length - pairs.length; counter.fn += expected.length - pairs.length;
        }
      }
      runs.push({ repetition, invocationId: observation?.invocationId ?? null, status: !observation || ["not_run", "indeterminate"].includes(observation.status) ? "not_run" :
        observation.status === "error" ? "failed" : states.some(row => row.status === "pending") || (item.layer === "profile" && pendingProfile.includes(item.caseId)) ? "pending" :
        states.some(row => row.status === "failed") ? "failed" : "passed", checks: states });
    }
    results.push({ caseId: item.caseId, layer: item.layer, runs, status: runs.some(row => row.status === "not_run") ? "not_run" : runs.some(row => row.status === "pending") ? "pending" : runs.some(row => row.status === "failed") ? "failed" : "passed" });
  }
  const expectedObservationCount = 1280;
  if (observations.length > expectedObservationCount) throw new Error("product_observations_exceed_680_plus_reused_600");
  const metrics = {};
  for (const [kind, count] of Object.entries(counts)) metrics[METRICS[kind]] = { ...count, value: count.pending || !count.expected ? null : kind === "hard_constraint" ? count.failed : count.passed / count.expected };
  metrics.criticalFactErrors = { ...criticalFacts, value: criticalFacts.pending || !criticalFacts.expected ? null : criticalFacts.failed };
  metrics.criticalCitationCoverage = { ...criticalCoverage, value: criticalCoverage.pending || !criticalCoverage.expected ? null : criticalCoverage.passed / criticalCoverage.expected };
  const profileSlices = [...slices].map(([name, count]) => ({ name, ...count, f1: f1(count) }));
  const profileComplete = profileCounts.cases === 120 && pendingProfile.length === 0;
  metrics.profileMicroF1 = { value: profileComplete ? f1(profileCounts) : null, denominator: 120, ...profileCounts, pendingCaseIds: pendingProfile };
  metrics.profileMinimumSliceF1 = { value: profileComplete && profileSlices.length && profileSlices.every(row => row.f1 !== null) ? Math.min(...profileSlices.map(row => row.f1)) : null, denominator: profileSlices.length, slices: profileSlices };
  return { cases: results, metrics, lowRiskReview: { population: lowRiskIds.length, sampled: selectedLowRisk.length, sampleIds: selectedLowRisk, seed: bundle.reviewSampleSeed, rate: .20 },
    counts: Object.fromEntries(["passed", "failed", "not_run", "pending"].map(status => [status, results.filter(row => row.status === status).length])),
    observationDenominator: expectedObservationCount, observedSlots: observations.length };
}

/** All values are derived from bound originals; caller-supplied aggregate metrics are ignored. */
export function scoreEvaluationBundle(bundle, { frozenMatrix, registration, verifiedOriginals }) {
  requirePolicy(bundle);
  if (bundle.schemaVersion !== "saitu.evaluation-bundle.v7.1" || !frozenMatrix || !registration) throw new Error("verified_v7_matrix_and_registration_required");
  const manifest = bundle.manifest, blockers = inspectChallengeManifest(manifest);
  if (!isVerifiedOriginals(verifiedOriginals, { bundle, matrix: frozenMatrix, registration })) blockers.push("raw_680_product_originals_not_verified_fixture_only");
  const migration = inspectMigration(bundle.migration);
  if (!migration.ready || !same(migration.cases.map(row => ({ caseId: row.caseId, layer: row.layer, inputSha256: row.inputSha256, answerSha256: row.answerSha256 })),
      manifest.cases.map(row => ({ caseId: row.caseId, layer: row.layer, inputSha256: row.inputSha256, answerSha256: row.answerSha256 })))) blockers.push("independent_migration_does_not_match_frozen_challenge");
  if (manifest.openedAt === null) blockers.push("v7_sealed_set_not_opened_or_executed");
  if (bundle.reviewSampleSeed !== registration.config.reviewSampleSeed) throw new Error("review_sampling_seed_changed_after_registration");
  for (const key of ["catalogSha256", "sourceSnapshotSha256", "rankingSourceSnapshotSha256", "implementationSha256", "runtimeConfigurationSha256", "migrationSha256"]) {
    if (manifest[key] !== frozenMatrix.freezeBinding[key] || manifest[key] !== registration.config[key]) throw new Error("v7_product_ranking_freeze_binding_changed");
  }
  if (manifest.publicDevelopmentManifestSha256 !== registration.config.publicDevelopmentManifestSha256) throw new Error("registered_public_development_manifest_changed");
  if (manifest.profileSliceProtocolSha256 !== registration.config.profileSliceProtocolSha256) throw new Error("registered_profile_slice_membership_changed");
  const ranking = scoreRankingGate(frozenMatrix, bundle.rankingGold, manifest, registration.registeredAt, { verifiedOriginals, bundle, registration });
  const runtime = registration.config.runtime ?? frozenMatrix.runtime ?? EVALUATION_POLICY.runtime;
  if (!same(frozenMatrix.runtime ?? EVALUATION_POLICY.runtime, runtime)) throw new Error("scoring_matrix_effort_policy_differs_from_registration");
  const product = scoreProduct(bundle, frozenMatrix, runtime);
  blockers.push(...ranking.blockers);
  if (product.counts.not_run || product.counts.pending || product.observedSlots !== 1280) blockers.push("all_800_cases_and_1280_original_slots_must_be_assessed");
  for (const [key, target] of Object.entries(EVALUATION_POLICY.quality)) {
    const metric = product.metrics[key];
    if (!metric || !Number.isFinite(metric.value) || (["hardConstraintViolations", "criticalFactErrors"].includes(key) ? metric.value !== target : metric.value < target)) blockers.push(`quality_gate:${key}`);
  }
  if (product.metrics.hardConstraintViolations.expected < 300 || product.metrics.factAccuracy.expected < 500) blockers.push("original_constraint_and_fact_denominators_not_preserved");
  return { schemaVersion: "saitu.evaluation-result.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    status: blockers.length ? "pending_or_failed" : "evaluation_gates_passed_requires_remaining_product_acceptance", blockers: [...new Set(blockers)],
    product, ranking, formalDenominators: { cases: 800, rankingReports: 1200, independentRankingFamilies: 120, cReportsReused: 600, additionalRankingPaidRuns: 0 },
    productAcceptance: false, remainingProductGates: ["performance", "simulation_pilot_12", "simulation_comparison_60", "signed_candidate_and_release_checks", "switch_rollback_and_30_minute_stability", "budget_and_provider_ledger_reconciliation"],
    evidenceClass: "ai_proxy", realStudentOutcomesProven: false };
}

/** Failed attempts stay in the 100-request denominator, from before the original browser click. */
export function scorePerformance(samples) {
  if (!Array.isArray(samples) || samples.length !== 100 || ["desktop", "mobile"].some(device => samples.filter(row => row.device === device).length !== 50)) throw new Error("performance_requires_50_desktop_50_mobile_original_requests");
  assertUnique(samples.map(row => row.requestId), "duplicate_performance_request");
  if (samples.some(row => row.clock !== EVALUATION_POLICY.performance.clock)) throw new Error("performance_requires_original_browser_submit_to_DOM_clock");
  const failed = row => row.completeFlowSucceeded === false || row.realProviderDispatch === false;
  const elapsed = (row, key) => !failed(row) && isTime(row.originalSubmittedAt) && isTime(row[key]) && Date.parse(row[key]) >= Date.parse(row.originalSubmittedAt) ? Date.parse(row[key]) - Date.parse(row.originalSubmittedAt) : Infinity;
  const p95 = values => { const value = [...values].sort((a, b) => a - b)[Math.ceil(.95 * values.length) - 1]; return Number.isFinite(value) ? value : null; };
  const firstList = samples.map(row => elapsed(row, "listRenderedAt")), details = samples.map(row => elapsed(row, "detailsRenderedAt"));
  const expansion = samples.map(row => !failed(row) && row.readyExpansionSucceeded === true && Number.isFinite(row.readyExpansionMs) && row.readyExpansionMs >= 0 ? row.readyExpansionMs : Infinity);
  const firstListP95Ms = p95(firstList), allDetailsP95Ms = p95(details), readyExpansionP95Ms = p95(expansion);
  return { clock: EVALUATION_POLICY.performance.clock, denominator: 100, desktop: 50, mobile: 50, firstListP95Ms, allDetailsP95Ms, readyExpansionP95Ms,
    failedListAttempts: firstList.filter(value => !Number.isFinite(value)).length, failedDetailAttempts: details.filter(value => !Number.isFinite(value)).length,
    targets: EVALUATION_POLICY.performance,
    status: firstListP95Ms !== null && firstListP95Ms <= EVALUATION_POLICY.performance.firstListP95Ms && allDetailsP95Ms !== null && allDetailsP95Ms <= EVALUATION_POLICY.performance.allDetailsP95Ms && readyExpansionP95Ms !== null && readyExpansionP95Ms <= EVALUATION_POLICY.performance.readyExpansionP95Ms ? "passed" : "failed" };
}

async function main() {
  const args = process.argv.slice(2), rootIndex = args.indexOf("--evidence-root");
  let selectedRoot;
  if (rootIndex !== -1) {
    if (args.lastIndexOf("--evidence-root") !== rootIndex || !args[rootIndex + 1] || args[rootIndex + 1].startsWith("--")) throw new Error("one_explicit_evidence_root_required");
    selectedRoot = args[rootIndex + 1]; args.splice(rootIndex, 2);
  }
  const options = parseFileCli(args, ["--open", "--registration", "--registration-sha256", "--input", "--input-sha256", "--ranking-run", "--freeze-manifest-sha256", "--output"]);
  const evidenceRoot = path.resolve(selectedRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
  const registrationPath = path.isAbsolute(options["--registration"]) ? path.relative(evidenceRoot, options["--registration"]) : options["--registration"];
  const preflight = await preflightScoringRegistration({ evidenceRoot, reference: { path: registrationPath, sha256: options["--registration-sha256"] } });
  const bytes = await readFile(options["--input"]);
  if (byteHash(bytes) !== options["--input-sha256"]) throw new Error("v7_scoring_bundle_bytes_changed");
  const bundle = JSON.parse(bytes);
  if (bundle.freezeBinding?.registrationSha256 !== preflight.registrationSha256) throw new Error("scoring_bundle_differs_from_preflight_registration");
  const loaded = await loadRankingReuse({ directory: options["--ranking-run"], freezeManifestSha256: options["--freeze-manifest-sha256"], expectedBinding: bundle.freezeBinding });
  if (!same(loaded.registration, preflight.registration)) throw new Error("ranking_registration_differs_from_public_preflight");
  const proof = await loadScoringOriginals({ evidenceRoot, bundle, ranking: loaded });
  const result = scoreEvaluationBundle(bundle, { frozenMatrix: loaded.matrix, registration: loaded.registration, verifiedOriginals: proof });
  result.evidenceVerification = { ...proof, bundleSha256: byteHash(bytes) };
  await writeNewJson(options["--output"], result);
  console.log(JSON.stringify({ output: options["--output"], status: result.status, counts: result.product.counts, productAcceptance: false }));
  if (result.blockers.length) process.exitCode = 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
