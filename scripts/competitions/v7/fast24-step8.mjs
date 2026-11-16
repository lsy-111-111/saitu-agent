import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { FAST24, FAST24_MATCH_POLICY_VERSION } from "./fast24-config.mjs";
import { byteHash, canonicalHash } from "./evaluation-policy.mjs";
import { fast24CSlotEvidence } from "./fast24-early-stop.mjs";
import { verifyRankNonThinkingContinuationScope } from "./rank-nonthinking-pilot-proof.mjs";
import { FAST24_REPAIR_VALIDATION_PURPOSE, FAST24_FINAL_ACCEPTANCE_PURPOSE } from "../../../src/lib/ai/execution-policy.mjs";

export const STEP8_RUN_SCHEMA = "saitu.fast24.step8-cohort.v1";
export const STEP8_CLOSURE_SCHEMA = "saitu.fast24.step8-closure.v1";
const REPAIR = FAST24_REPAIR_VALIDATION_PURPOSE;
const FINAL = FAST24_FINAL_ACCEPTANCE_PURPOSE;
const same = (left, right) => canonicalHash(left) === canonicalHash(right);
const assert = (condition, reason) => { if (!condition) throw new Error(`fast24_step8:${reason}`); };
const validHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export async function readStep8BoundFile(root, reference, { json = true } = {}) {
  assert(typeof reference?.path === "string" && validHash(reference.sha256), "bound_reference_required");
  const filename = await realpath(path.resolve(root, reference.path));
  assert(filename.startsWith(path.resolve(root) + path.sep), "bound_file_must_be_in_repository");
  const bytes = await readFile(filename);
  assert(byteHash(bytes) === reference.sha256, "bound_file_bytes_changed");
  return { path: filename, bytes, ...(json ? { value: JSON.parse(bytes) } : {}) };
}

/** Select the first case in each frozen group before looking at any output. */
export function step8SlotPlan(manifest, rankingProfiles) {
  const local = manifest.slots.filter(slot => slot.algorithm === "B" || slot.operation === "constraint_check");
  const recommendations = manifest.slots.filter(slot => slot.algorithm === "C");
  const other = manifest.slots.filter(slot => !slot.algorithm && slot.operation !== "constraint_check");
  assert(local.length === 348 && recommendations.length === 48 && other.length === 72 &&
    rankingProfiles.length === 24 && new Set(rankingProfiles.map(row => row.caseId)).size === 24 &&
    FAST24.groups.every(group => rankingProfiles.filter(row => row.taskGroup === group).length === 4), "fixed_348_48_72_and_six_groups_required");
  const firstCases = new Set(FAST24.groups.map(group => rankingProfiles.find(row => row.taskGroup === group).caseId));
  const first = recommendations.filter(slot => firstCases.has(slot.caseId));
  assert(first.length === 12 && [...firstCases].every(caseId => same(first.filter(slot => slot.caseId === caseId)
    .map(slot => slot.repetition).sort(), [0, 1])), "fixed_first_wave_must_contain_six_complete_pairs");
  return {
    local: local.map(slot => slot.slotId), first: first.map(slot => slot.slotId),
    remainder: recommendations.filter(slot => !firstCases.has(slot.caseId)).map(slot => slot.slotId),
    recommendations: recommendations.map(slot => slot.slotId), other: other.map(slot => slot.slotId),
  };
}

export function step8ScopeMatches(prepared, scope) {
  const plan = prepared.manifest.acceptanceRun;
  assert(plan?.schemaVersion === STEP8_RUN_SCHEMA && [REPAIR, FINAL].includes(plan.runPurpose) &&
    scope?.runPurpose === plan.runPurpose && scope.phase === (plan.runPurpose === REPAIR ? "repair" : "formal") &&
    scope.authorizedPhase === scope.phase && scope.rootIsOnlyDispatcher === true &&
    scope.acceptanceSelectionManifest?.sha256 === prepared.selectionSha256 &&
    path.resolve(scope.acceptanceSelectionManifest.path) === path.join(prepared.output, "manifest.json") &&
    scope.matchPolicyVersion === FAST24_MATCH_POLICY_VERSION && plan.matchPolicyVersion === FAST24_MATCH_POLICY_VERSION &&
    Array.isArray(prepared.manifest.inheritedOriginals) && prepared.manifest.inheritedOriginals.length === 0 &&
    scope.applicationRuntimeSourceSha256 === plan.candidate?.applicationRuntimeSourceSha256 &&
    scope.productionBuildId === plan.candidate?.productionBuildId &&
    scope.candidatePoolSha256 === plan.candidate?.candidatePoolSha256 &&
    validHash(scope.fast24BehaviorImplementationSha256) && validHash(scope.executionRuntimeConfigurationSha256), "frozen_purpose_selection_source_and_build_required");
  const stages = step8SlotPlan(prepared.manifest, prepared.inputs.ranking.profiles);
  assert(same(stages, plan.stages), "frozen_wave_slots_changed");
  if (scope.runPurpose === REPAIR) {
    assert(scope.repairValidation?.selectionSha256 === prepared.selectionSha256 &&
      scope.repairValidation?.applicationRuntimeSourceSha256 === scope.applicationRuntimeSourceSha256 &&
      scope.repairValidation?.productionBuildId === scope.productionBuildId &&
      scope.repairValidation?.candidatePoolSha256 === scope.candidatePoolSha256 && !scope.repairClosure,
    "repair_grant_is_bound_to_this_cohort_only");
  } else {
    assert(!scope.repairValidation && scope.repairClosure?.sha256 === plan.repairClosure?.sha256,
      "final_requires_its_frozen_repair_closure");
  }
  return stages;
}

export function assertStep8Original(scope, raw, slot) {
  const observation = raw.observation;
  const actual = raw.executionScope;
  assert(actual?.runId === scope.runId && actual.runPurpose === scope.runPurpose && actual.phase === scope.phase &&
    actual.applicationRuntimeSourceSha256 === scope.applicationRuntimeSourceSha256 && actual.productionBuildId === scope.productionBuildId &&
    actual.effortConditionSha256 === scope.effortConditionSha256 && actual.authorizationPolicySha256 === scope.authorizationPolicySha256 &&
    observation.freezeBinding?.fast24SelectionSha256 === scope.acceptanceSelectionManifest.sha256 &&
    observation.freezeBinding?.implementationSha256 === scope.fast24BehaviorImplementationSha256 &&
    observation.execution?.executionRuntimeConfigurationSha256 === scope.executionRuntimeConfigurationSha256 &&
    observation.outputSha256 === canonicalHash(observation.output) &&
    ["observed", "error", "indeterminate", "not_run"].includes(observation.status), "original_is_not_from_this_frozen_cohort");
  const local = slot.algorithm === "B" || slot.operation === "constraint_check";
  assert(!local || observation.execution.httpDispatches === 0, "local_slot_dispatched_model");
}

function assertOwner(root, owner, filename) {
  assert(filename.startsWith(path.join(root, "artifacts/step8-first-20261111", owner) + path.sep), "review_must_be_owned_by_its_independent_reviewer");
}

export function firstWaveOriginals(summary, stages) {
  return stages.first.map(slotId => {
    const slot = summary.slots.find(row => row.slotId === slotId);
    assert(slot && slot.status !== "not_run", "all_first_wave_slots_must_settle_before_review");
    return { slotId, status: slot.status, originalSha256: slot.original?.sha256 ?? null };
  });
}

export function step8DispatchSlotIds(prepared, scope, stages, stage, operations) {
  const allowed = scope.runPurpose === REPAIR ? ["local", "first", "remainder", "other"] : ["local", "recommendations", "other"];
  assert(allowed.includes(stage), "dispatch_must_use_the_frozen_stage_slots");
  if (operations === undefined) return stages[stage];
  assert(scope.runPurpose === REPAIR && stage === "other", "diagnostic_operations_require_repair_other_stage");

  const otherIds = new Set(stages.other);
  const slots = prepared.manifest.slots.filter(slot => otherIds.has(slot.slotId));
  const knownOperations = new Set(slots.map(slot => slot.operation));
  assert(Array.isArray(operations) && operations.length > 0 && new Set(operations).size === operations.length &&
    operations.every(operation => knownOperations.has(operation)), "diagnostic_operations_must_be_distinct_frozen_other_operations");
  const requested = new Set(operations);
  const productInputs = new Map(prepared.inputs.product.cases.map(row => [row.caseId, row.input]));
  return slots.filter(slot => {
    if (requested.has(slot.operation)) return true;
    if (slot.operation !== "robustness") return false;
    const input = productInputs.get(slot.caseId);
    // The product executes the two explicit operations in a robustness pair.
    return [input?.base?.operation, input?.perturbed?.operation].some(operation => requested.has(operation));
  }).map(slot => slot.slotId);
}

export async function assertStep8Dispatch(root, { prepared, scope, summary, selected, stage, waveReview, operations }) {
  const stages = step8ScopeMatches(prepared, scope);
  const expected = step8DispatchSlotIds(prepared, scope, stages, stage, operations);
  assert(same(selected.map(slot => slot.slotId), expected), "dispatch_must_use_the_frozen_stage_slots");
  if (["first", "remainder", "recommendations"].includes(stage)) {
    const outcomes = new Map(summary.slots.map(slot => [slot.slotId, slot]));
    assert(stages.local.every(id => outcomes.get(id)?.status === "observed" && outcomes.get(id).original), "finish_fresh_local_348_before_ranking");
  }
  if (stage === "remainder") {
    const review = await readStep8BoundFile(root, waveReview);
    assertOwner(root, "E", review.path);
    const value = review.value;
    assert(value.schemaVersion === "saitu.fast24.first-wave-review.v1" && value.reviewer === "E" && value.independent === true &&
      value.locked === true && value.selectionSha256 === prepared.selectionSha256 && value.decision === "expand" &&
      value.applicationRuntimeSourceSha256 === scope.applicationRuntimeSourceSha256 && value.productionBuildId === scope.productionBuildId &&
      same(value.slots, firstWaveOriginals(summary, stages)) && Array.isArray(value.evidence) && value.evidence.length >= 2 &&
      new Set(value.evidence.map(ref => ref.path)).size === value.evidence.length, "independent_first_wave_expansion_decision_required");
    await Promise.all(value.evidence.map(ref => readStep8BoundFile(root, ref, { json: false })));
  }
  if (stage === "other" && scope.runPurpose === FINAL) {
    const outcomes = new Map(summary.slots.map(slot => [slot.slotId, slot]));
    assert(stages.recommendations.every(id => outcomes.get(id)?.status !== "not_run") && summary.completeCThresholdMet,
      "final_recommendations_must_settle_before_other_operations");
  }
}

const series = itemIds => [...new Set(itemIds.map(id => id.split(":")[0]))];
const jaccard = (a, b) => {
  const union = new Set([...a, ...b]);
  return union.size ? a.filter(id => b.includes(id)).length / union.size : 0;
};

export async function step8RecommendationDiagnostics(output, summary, slotIds) {
  const ids = new Set(slotIds);
  const results = await Promise.all(summary.slots.filter(slot => ids.has(slot.slotId)).map(async slot => {
    const raw = slot.original ? JSON.parse(await readFile(path.join(output, slot.original.path))) : null;
    const observation = raw?.observation;
    const body = observation?.groupedRuns?.at(-1)?.body;
    const provisional = body?.plan?.recommendations?.map(item => item.itemId) ?? [];
    const result = fast24CSlotEvidence(slot, raw);
    const final = result.finalItemIds ?? [];
    return { slotId: slot.slotId, caseId: slot.caseId, repetition: slot.repetition, status: slot.status,
      provisionalItemIds: provisional, finalItemIds: final, technicalComplete: result.technicalComplete,
      retainedFraction: provisional.length ? provisional.filter(id => final.includes(id)).length / provisional.length : null };
  }));
  const pairs = [...new Set(results.map(row => row.caseId))].map(caseId => {
    const [a, b] = results.filter(row => row.caseId === caseId);
    return { caseId, provisionalJaccard: jaccard(series(a.provisionalItemIds), series(b.provisionalItemIds)),
      finalJaccard: jaccard(series(a.finalItemIds), series(b.finalItemIds)), bothDelivered: a.technicalComplete && b.technicalComplete };
  });
  const mean = field => pairs.reduce((total, pair) => total + pair[field], 0) / pairs.length;
  return { complete: results.filter(result => result.technicalComplete).length, total: results.length,
    provisionalMean: mean("provisionalJaccard"), finalMean: mean("finalJaccard"), pairs, results };
}

export function step8OriginalsSha256(summary) {
  assert(summary.recordedOriginals === 468 && summary.slots.length === 468 &&
    summary.slots.every(slot => slot.original && slot.status !== "not_run"), "all_468_fresh_terminal_originals_required");
  return canonicalHash(summary.slots.map(slot => ({ slotId: slot.slotId, status: slot.status, sha256: slot.original.sha256 })));
}

export async function verifyStep8RepairClosure(root, reference, candidate, { behaviorSha256 } = {}) {
  const artifact = await readStep8BoundFile(root, reference);
  assertOwner(root, "D", artifact.path);
  const value = artifact.value;
  assert(value.schemaVersion === STEP8_CLOSURE_SCHEMA && value.runPurpose === REPAIR &&
    value.repairValidationPassed === true && value.finalAcceptancePassed === false && Number.isFinite(Date.parse(value.closedAt)) &&
    same(value.candidate, candidate) && (!behaviorSha256 || value.fast24BehaviorImplementationSha256 === behaviorSha256),
  "same_candidate_passed_repair_closure_required");
  const repairScope = await readStep8BoundFile(root, value.executionScope);
  const repair = repairScope.value;
  assert(path.dirname(repairScope.path) === path.dirname(artifact.path) && repair.runPurpose === REPAIR &&
    repair.fast24BehaviorImplementationSha256 === value.fast24BehaviorImplementationSha256 &&
    repair.acceptanceSelectionManifest?.sha256 === value.selectionSha256, "repair_closure_scope_changed");
  const { summarizeFast24 } = await import("./fast24.mjs");
  const review = await readStep8BoundFile(root, value.review);
  const summary = await summarizeFast24(path.dirname(artifact.path), { write: false, review: review.path });
  const evidence = await assertStep8QualityEvidence(root, { scope: repair, scopeSha256: value.executionScope.sha256,
    summary, review: value.review, secondReview: value.secondReview, blindReview: value.blindReview });
  assert(evidence.originalsSha256 === value.originalsSha256, "closed_repair_originals_changed");
  return value;
}

export async function verifyStep8FinalPrerequisites(root, prepared, scope) {
  const closure = await verifyStep8RepairClosure(root, scope.repairClosure, prepared.manifest.acceptanceRun.candidate,
    { behaviorSha256: scope.fast24BehaviorImplementationSha256 });
  const verified = await verifyRankNonThinkingContinuationScope(root, scope);
  assert(verified?.complete === 3, "fresh_passing_fixed_three_required");
  const proof = JSON.parse(await readFile(verified.proofFile));
  const execution = (await readStep8BoundFile(root, proof.execution)).value;
  const build = (await readStep8BoundFile(root, execution.buildVerification)).value;
  assert(Date.parse(execution.startedAt) > Date.parse(closure.closedAt) &&
    build.passed === true && build.sourceSha256 === scope.applicationRuntimeSourceSha256 &&
    build.nextBuildId === scope.productionBuildId && build.artifactSha256 === closure.candidate.workerArtifactSha256 &&
    execution.approvedCandidateSourceSha256 === scope.applicationRuntimeSourceSha256 &&
    execution.catalogSha256 === scope.candidatePoolSha256, "passing_fixed_three_must_follow_repair_closure_on_same_build");
  return closure;
}

export async function assertStep8QualityEvidence(root, { scope, scopeSha256, summary, review, secondReview, blindReview }) {
  const originalsSha256 = step8OriginalsSha256(summary);
  assert(summary.completeCThresholdMet && summary.independentQuality?.passed === true, "full_quality_thresholds_must_pass");
  const [primary, secondary, blind] = await Promise.all([review, secondReview, blindReview].map(ref => readStep8BoundFile(root, ref)));
  assertOwner(root, "E", primary.path);
  assertOwner(root, "F", secondary.path);
  const matches = value => value.runPurpose === scope.runPurpose && value.selectionSha256 === summary.selectionSha256 &&
    value.executionScopeSha256 === scopeSha256 && value.applicationRuntimeSourceSha256 === scope.applicationRuntimeSourceSha256 &&
    value.productionBuildId === scope.productionBuildId;
  assert(matches(primary.value) && primary.value.reviewer === "E" && primary.value.independent === true &&
    primary.value.locked === true && primary.value.originalsSha256 === originalsSha256, "locked_primary_review_must_bind_all_current_originals");
  await readStep8BoundFile(root, primary.value.review, { json: false });
  const frozenSecond = (await readStep8BoundFile(root, scope.secondReviewScope.fixedSelection)).value.fixedSlotIds;
  assert(matches(secondary.value) && secondary.value.schemaVersion === "saitu.fast24.step8-second-review.safe.v1" &&
    secondary.value.reviewer === "F" && secondary.value.independent === true && secondary.value.locked === true &&
    secondary.value.originalsSha256 === originalsSha256 && secondary.value.unresolvedDisputes === 0 &&
    same([...secondary.value.reviewedFixedSlotIds].sort(), [...frozenSecond].sort()), "fixed_second_review_and_dispute_closure_required");
  assert(matches(blind.value) && blind.value.schemaVersion === "saitu.fast24.step8-blind-closure.safe.v1" &&
    blind.value.frozenMappingSha256 === scope.blindMapping.sha256 && blind.value.originalsSha256 === originalsSha256 &&
    blind.value.fixedPairDenominator === 12 && blind.value.unresolvedDisputes === 0 &&
    blind.value.pairs?.length === 12 && new Set(blind.value.pairs.map(pair => pair.pairId)).size === 12 &&
    blind.value.pairs.filter(pair => pair.winner === "C" || pair.winner === "tie").length === primary.value.metrics.blindCNotWorse &&
    blind.value.pairs.every(pair => ["B", "C", "tie", "unscorable"].includes(pair.winner)), "fixed_twelve_locked_blind_decisions_required");
  const mapping = (await readStep8BoundFile(root, scope.blindMapping)).value;
  assert(same(blind.value.pairs.map(pair => pair.pairId).sort(), mapping.pairs.map(pair => pair.originalPairId).sort()), "blind_pair_identities_changed");
  for (const lock of [secondary.value, blind.value]) {
    assert(Array.isArray(lock.evidence) && lock.evidence.length > 0, "locked_review_evidence_required");
    await Promise.all(lock.evidence.map(ref => readStep8BoundFile(root, ref, { json: false })));
  }
  return { originalsSha256, metrics: summary.independentQuality.metrics };
}
