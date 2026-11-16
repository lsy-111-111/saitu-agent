import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { deriveRunSeed, seededShuffle } from "../v6/frozen-ranking-executor.mjs";
import { POLICY_VERSION, POLICY_SHA256, FORMAL_ARMS, canonicalHash, byteHash, isHash, requirePolicy, same,
  assertRankingGroups, assertUnique, readBoundBytes, EVALUATION_POLICY } from "./evaluation-policy.mjs";
import { validateRegistrationConfig } from "./evaluation-registration.mjs";
import { validateEvaluationRuntime, assertDispatchEffort, assertLedgerEffort, assertSameEffortPolicy, effortPolicyForScope } from "./evaluation-effort.mjs";
import { validateExecutionScope } from "./evaluation-runtime.mjs";
import { USER_UNBOUNDED_EXECUTION_MODE, USER_UNBOUNDED_EXECUTION_LIMITS } from "../../../src/lib/ai/execution-policy.mjs";
import { ADAPTIVE_EXECUTION_POLICY } from "../../lib/adaptive-execution.mjs";

const BINDING_HASHES = ["registrationSha256", "challengeManifestSha256", "sourceSnapshotSha256", "rankingSourceSnapshotSha256", "catalogSha256", "implementationSha256", "runtimeConfigurationSha256", "migrationSha256"];
const verifiedRankingReuses = new WeakMap();
const reuseIdentity = value => canonicalHash({ matrix: value.matrix, manifest: value.manifest, registration: value.registration, opening: value.opening, freezeManifestSha256: value.freezeManifestSha256 });
export const isVerifiedRankingReuse = value => Boolean(value && verifiedRankingReuses.has(value) && verifiedRankingReuses.get(value) === reuseIdentity(value));
export function inspectFreezeBinding(binding) {
  requirePolicy(binding);
  if (BINDING_HASHES.some(key => !isHash(binding[key]))) throw new Error("v7_complete_formal_freeze_binding_required");
}
function displayed(output) {
  if (output === null) return [];
  const rows = output.items ?? output.recommendations;
  if (!Array.isArray(rows) || rows.some(row => !row?.itemId)) throw new Error("v7_original_displayed_list_required");
  if (rows.length > EVALUATION_POLICY.recommendationMaxItems || (output.report?.recommendations?.length ?? 0) > EVALUATION_POLICY.recommendationMaxItems)
    throw new Error("top5_original_recommendation_limit_exceeded");
  return rows.map(row => row.itemId);
}
export function validateBoundObservation(observation, ranking, profile, binding, seed, runtime = EVALUATION_POLICY.runtime) {
  const policy = validateEvaluationRuntime(runtime), legacy = runtime.effortPolicy === undefined;
  inspectFreezeBinding(binding); requirePolicy(observation);
  if (observation.schemaVersion !== "saitu.ranking-observation.v7.1" || observation.operation !== "recommend" ||
      !FORMAL_ARMS.includes(observation.algorithm) || observation.profileId !== profile.profileId || observation.caseId !== profile.caseId ||
      !Number.isInteger(observation.repetition) || observation.repetition < 0 || observation.repetition > 4 || !observation.invocationId ||
      !["observed", "error", "not_run", "indeterminate"].includes(observation.status) || typeof observation.fallback !== "boolean" ||
      !same(observation.freezeBinding, binding) || observation.inputSha256 !== canonicalHash(profile.input) ||
      observation.outputSha256 !== canonicalHash(observation.output)) throw new Error("v7_observation_identity_input_output_binding_changed");
  assertUnique(profile.candidateItemIds, "v7_unique_full_core_candidate_pool_required");
  const candidateSetSha256 = canonicalHash([...profile.candidateItemIds].sort());
  const shuffleSeed = deriveRunSeed(seed, profile.profileId, observation.repetition + 1);
  if (observation.candidateSetSha256 !== candidateSetSha256 || observation.shuffleSeed !== shuffleSeed || observation.skipIndependentRecall !== true ||
      !same(observation.candidateOrder, seededShuffle(profile.candidateItemIds, shuffleSeed))) throw new Error("v7_full_candidate_pool_or_order_changed");
  if (!Array.isArray(observation.events) || !observation.execution || !Array.isArray(observation.reservationIds)) throw new Error("v7_dispatch_and_reservation_evidence_required");
  const dispatches = observation.events.filter(event => event.type === "ai_transport_dispatch");
  const reservationIds = [...new Set(observation.events.filter(event => ["ai_budget_reserved", "ai_budget_settled", "ai_settlement_failed"].includes(event.type)).map(event => event.details?.reservationId).filter(Boolean))];
  if (observation.execution.httpDispatches !== dispatches.length || observation.execution.actualModelRun !== (dispatches.length > 0) ||
      !same([...observation.reservationIds].sort(), reservationIds.sort()) || (dispatches.length && !observation.reservationIds.length)) throw new Error("v7_dispatch_model_run_or_reservation_mismatch");
  if (observation.algorithm === "B" && dispatches.length) throw new Error("v7_local_B_cannot_dispatch_provider");
  if (observation.algorithm === "C" && !same(observation.runtime, runtime)) throw new Error("v7_C_runtime_must_match_frozen_stage_effort_policy");
  if (!legacy) for (const dispatch of dispatches) assertDispatchEffort(dispatch.details, policy);
  if ((observation.status === "not_run" && (dispatches.length || observation.output !== null)) ||
      (observation.status === "indeterminate" && (dispatches.length === 0 || observation.output !== null)) ||
      (observation.status === "observed" && observation.output === null)) throw new Error("v7_observation_execution_status_mismatch");
  if (!ranking || ranking.algorithm !== observation.algorithm || ranking.profileId !== profile.profileId || ranking.runId !== observation.invocationId ||
      ranking.fallbackUsed !== observation.fallback || ranking.modelStatus !== observation.execution.modelStatus ||
      !same(ranking.displayedItemIds, displayed(observation.output))) throw new Error("v7_ranking_differs_from_original_display");
  for (const key of ["invocationId", "inputSha256", "outputSha256", "candidateSetSha256", "freezeBinding", "reservationIds"]) {
    if (!same(ranking[key], observation[key])) throw new Error(`v7_ranking_observation_binding_changed:${key}`);
  }
  if (ranking.displayedItemIds.some(itemId => !profile.candidateItemIds.includes(itemId))) throw new Error("v7_display_outside_frozen_core_pool");
  return observation;
}
/** Validate both arms, all five repetitions and every original byte binding before C is exposed. */
export function validateFrozenMatrix(matrix) {
  requirePolicy(matrix); inspectFreezeBinding(matrix.freezeBinding);
  if (matrix.executionMode === USER_UNBOUNDED_EXECUTION_MODE && (!same(matrix.executionLimits, USER_UNBOUNDED_EXECUTION_LIMITS) || !same(matrix.schedulingPolicy, ADAPTIVE_EXECUTION_POLICY))) throw new Error("unbounded_ranking_matrix_policy_changed");
  const runtime = matrix.runtime ?? EVALUATION_POLICY.runtime;
  validateEvaluationRuntime(runtime);
  if (matrix.schemaVersion !== "saitu.frozen-ranking-matrix.v7.1" || matrix.rankings.schemaVersion !== "saitu.ranking-evaluation.v1" ||
      matrix.rankings.purpose !== "ai_proxy_acceptance" || matrix.rankings.expectedRunsPerProfile !== 5 ||
      !same(matrix.rankings.algorithms, FORMAL_ARMS) || matrix.rankings.runs.length !== 1200 || matrix.observations.length !== 1200) throw new Error("v7_reuse_requires_B_C_1200_slot_matrix");
  assertRankingGroups(matrix.profileSnapshot.profiles);
  const profiles = new Map(matrix.profileSnapshot.profiles.map(row => [row.profileId, row]));
  const pools = new Map(matrix.rankings.profiles.map(row => [row.profileId, row]));
  const rankings = new Map(matrix.rankings.runs.map(row => [row.invocationId, row]));
  if (pools.size !== 120 || matrix.rankings.profiles.length !== 120 || rankings.size !== 1200) throw new Error("v7_matrix_duplicate_profile_or_invocation");
  for (const profile of profiles.values()) {
    const pool = pools.get(profile.profileId);
    if (!profile.input || !profile.profile || profile.profile.schemaVersion !== "saitu.profile.v6" || profile.profile.profileId !== profile.profileId ||
        !same(profile.input.profile, profile.profile) || !pool || pool.familyId !== profile.familyId || pool.taskGroup !== profile.taskGroup ||
        !same([...pool.poolItemIds].sort(), [...(profile.assessmentItemIds ?? profile.candidateItemIds)].sort()) || profile.candidateItemIds.some(id => !pool.poolItemIds.includes(id)) ||
        !same([...pool.judgments.map(row => row.itemId)].sort(), [...pool.poolItemIds].sort())) throw new Error("v7_frozen_profile_pool_or_family_changed");
  }
  const keys = new Set(), invocationIds = new Set();
  for (const observation of matrix.observations) {
    const profile = profiles.get(observation.profileId), key = JSON.stringify([observation.profileId, observation.algorithm, observation.repetition]);
    if (!profile || keys.has(key) || invocationIds.has(observation.invocationId)) throw new Error("v7_duplicate_or_foreign_formal_slot");
    keys.add(key); invocationIds.add(observation.invocationId);
    validateBoundObservation(observation, rankings.get(observation.invocationId), profile, matrix.freezeBinding, matrix.seed, runtime);
  }
  for (const profile of profiles.values()) for (const arm of FORMAL_ARMS) for (let repetition = 0; repetition < 5; repetition++) {
    if (!keys.has(JSON.stringify([profile.profileId, arm, repetition]))) throw new Error("v7_missing_formal_slot_no_regeneration");
  }
  const c = matrix.observations.filter(row => row.algorithm === "C");
  return { profiles: 120, independentFamilies: 120, repetitions: 5, algorithms: 2, reports: 1200,
    actualModelRuns: c.filter(row => row.execution.actualModelRun).length,
    successfulCRuns: c.filter(row => row.status === "observed" && row.execution.actualModelRun && !row.fallback && row.execution.modelStatus === "ok").length,
    httpDispatches: c.reduce((sum, row) => sum + row.execution.httpDispatches, 0),
    notRun: matrix.observations.filter(row => row.status === "not_run").length,
    indeterminate: matrix.observations.filter(row => row.status === "indeterminate").length };
}
export function createCReuse(matrix) {
  const counts = validateFrozenMatrix(matrix);
  const observations = new Map(matrix.observations.filter(row => row.algorithm === "C").map(row => [JSON.stringify([row.caseId, row.repetition]), row]));
  const rankings = new Map(matrix.rankings.runs.map(row => [row.invocationId, row]));
  const profiles = new Map(matrix.profileSnapshot.profiles.map(row => [row.caseId, row]));
  return { counts, size: observations.size, algorithm: "C", additionalPaidRuns: 0,
    get({ caseId, repetition, input }) {
      const observation = observations.get(JSON.stringify([caseId, repetition])), profile = profiles.get(caseId);
      if (!observation || !profile) throw new Error("v7_C_reuse_missing_case_no_regeneration");
      if (!same(input, profile.input)) throw new Error("v7_C_reuse_input_changed");
      return validateBoundObservation(observation, rankings.get(observation.invocationId), profile, matrix.freezeBinding, matrix.seed, matrix.runtime ?? EVALUATION_POLICY.runtime);
    } };
}
/** An exact manifest hash is mandatory. Merely passing a parsed object is not byte verification. */
export async function loadRankingReuse({ directory, freezeManifestSha256, expectedBinding }) {
  const root = await realpath(directory), bytes = await readFile(path.join(root, "freeze-manifest.json"));
  if (byteHash(bytes) !== freezeManifestSha256) throw new Error("v7_reuse_freeze_manifest_bytes_changed");
  const manifest = JSON.parse(bytes); requirePolicy(manifest); inspectFreezeBinding(manifest.freezeBinding);
  if (manifest.schemaVersion !== "saitu.experiment-freeze.v7.1" || !same(manifest.freezeBinding, expectedBinding) || !Array.isArray(manifest.files)) throw new Error("v7_reuse_expected_freeze_binding_required");
  assertUnique(manifest.files.map(row => row.path), "duplicate_v7_freeze_manifest_file");
  const files = new Map();
  for (const reference of manifest.files) {
    const result = await readBoundBytes(root, reference);
    files.set(reference.path, { ...result, ...(reference.path.endsWith(".json") ? { value: JSON.parse(result.bytes) } : {}) });
  }
  for (const filename of ["matrix.json", "registration.json", "opening.json"]) if (!files.has(filename)) throw new Error("v7_reuse_bound_original_missing");
  const matrix = files.get("matrix.json").value, registration = files.get("registration.json").value, opening = files.get("opening.json").value;
  validateRegistrationConfig(registration.config); requirePolicy(registration);
  const runtime = registration.config.runtime, policy = validateEvaluationRuntime(runtime), legacy = runtime.effortPolicy === undefined;
  if ((matrix.executionMode ?? "finite") !== (registration.config.executionMode ?? "finite")) throw new Error("ranking_matrix_execution_mode_differs_from_registration");
  if (matrix.executionMode === USER_UNBOUNDED_EXECUTION_MODE) {
    const traces = [...files.entries()].filter(([filename]) => /^adaptive-scheduling-[a-f0-9-]+\.jsonl$/.test(filename));
    if (!traces.length) throw new Error("unbounded_ranking_original_scheduling_trace_required");
    for (const [, file] of traces) {
      const events = file.bytes.toString("utf8").trim().split("\n").map(line => JSON.parse(line));
      if (events.at(-1)?.type !== "coordinator_settled" || events.some(event => event.registrationSha256 !== expectedBinding.registrationSha256) ||
          events.at(-1).inFlight !== 0) throw new Error("unbounded_ranking_original_scheduling_not_settled");
    }
  }
  if (!same(matrix.runtime ?? EVALUATION_POLICY.runtime, runtime)) throw new Error("ranking_matrix_runtime_differs_from_registered_effort_policy");
  if (byteHash(files.get("registration.json").bytes) !== expectedBinding.registrationSha256 ||
      registration.schemaVersion !== "saitu.ranking-registration.v7.1" || registration.inputOpened !== false ||
      !same(matrix.freezeBinding, expectedBinding) || opening.schemaVersion !== "saitu.ranking-opening.v7.1" ||
      opening.registrationSha256 !== expectedBinding.registrationSha256 || opening.inputSha256 !== registration.config.inputSha256 ||
      !Number.isFinite(Date.parse(opening.openedAt)) || !(Date.parse(registration.registeredAt) <= Date.parse(opening.openedAt))) throw new Error("v7_reuse_registration_or_opening_changed");
  for (const key of BINDING_HASHES.filter(key => key !== "registrationSha256")) if (registration.config[key] !== expectedBinding[key]) throw new Error("v7_reuse_registered_binding_changed");
  if (matrix.seed !== registration.config.seed) throw new Error("v7_reuse_registered_seed_changed");
  const receipts = [...files.values()].filter(file => file.value?.observation && file.value?.receipt);
  for (const observation of matrix.observations) {
    const original = receipts.find(file => file.value.observation.invocationId === observation.invocationId)?.value;
    if (!original || !same(original.observation, observation) || original.receipt.observationSha256 !== canonicalHash(observation) ||
        !same(original.receipt.freezeBinding, expectedBinding)) throw new Error("ranking_original_invocation_receipt_missing_or_changed");
    if (!legacy) {
      validateExecutionScope(original.receipt.executionScope, { allowedPhases: ["formal"] });
      if ((original.receipt.executionScope.executionMode ?? "finite") !== (registration.config.executionMode ?? "finite") ||
          (observation.execution.executionMode ?? "finite") !== (registration.config.executionMode ?? "finite")) throw new Error("ranking_original_execution_mode_changed");
      assertSameEffortPolicy(effortPolicyForScope(original.receipt.executionScope), policy);
    }
    for (const dispatch of observation.events.filter(event => event.type === "ai_transport_dispatch")) {
      const ledger = original.receipt.ledgerRows?.find(row => row.id === dispatch.details.reservationId);
      if (!ledger || ledger.model !== "deepseek-flash" || ledger.phase !== "formal" || ledger.run_id !== original.receipt.executionScope?.runId) throw new Error("ranking_dispatch_missing_bound_original_ledger_row");
      assertLedgerEffort(ledger, policy, { legacy });
      if (!legacy && ledger.operation !== dispatch.details.operation) throw new Error("ranking_dispatch_operation_differs_from_original_ledger");
    }
  }
  const result = { ...createCReuse(matrix), matrix, manifest, registration, opening, freezeManifestSha256, policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256 };
  verifiedRankingReuses.set(result, reuseIdentity(result)); return result;
}
