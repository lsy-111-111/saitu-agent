import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceManifest } from "../v6/run-experiment.mjs";
import { POLICY_VERSION, POLICY_SHA256, FORMAL_ARMS, EVALUATION_POLICY, canonicalHash, byteHash, isHash, isTime, isUint32,
  same, requirePolicy, readBoundJson, readBoundBytes, writeNewJson, parseFileCli } from "./evaluation-policy.mjs";
import { inspectMigration } from "./evaluation-migration.mjs";
import { hasBoundProviderDispatch } from "./evaluation-dispatch-evidence.mjs";
import { CALIBRATION_DEVELOPMENT_CONSUMER_VERSION, readPublicEvaluationJson, validateDevelopmentConsumerContract, verifyDevelopmentExclusions } from "./evaluation-development-exclusions.mjs";
import { validateRankingReviewContract, verifyRankingPanelMetadata } from "./evaluation-ranking-panels.mjs";
import { validateEvaluationRuntime, requireTop5EvaluationRuntime, effortPolicyForScope, assertSameEffortPolicy, assertLedgerEffort } from "./evaluation-effort.mjs";
import { USER_UNBOUNDED_EXECUTION_MODE, USER_UNBOUNDED_EXECUTION_LIMITS } from "../../../src/lib/ai/execution-policy.mjs";
import { ADAPTIVE_EXECUTION_POLICY } from "../../lib/adaptive-execution.mjs";

const HASH_FIELDS = ["inputSha256", "productInputSha256", "profileSliceProtocolSha256", "challengeManifestSha256", "sourceSnapshotSha256", "rankingSourceSnapshotSha256", "catalogSha256", "candidatePoolSha256", "runtimeSourceBindingSha256", "implementationSha256", "runtimeConfigurationSha256", "migrationSha256", "publicDevelopmentManifestSha256"];
export const REGISTRATION_METADATA_FIELDS = Object.freeze(["schemaVersion", "policyVersion", "policySha256", "registeredAt", "inputOpened", "formalRunsExecuted", "config", "implementation", "implementationSha256", "publicDevelopmentVerification", "rankingPanelMetadataVerification"]);
export const REGISTRATION_CONFIG_FIELDS = Object.freeze(["schemaVersion", "policyVersion", "policySha256", "purpose", "algorithms", "profileCount", "repeats", "rankingReports", "reuseAlgorithm", "candidatePolicy", "seed", "reviewSampleSeed", "runtime", "rankingProtocol", "reviewProtocol", ...HASH_FIELDS,
  "executionPhase", "executionMode", "executionLimits", "schedulingPolicy", "invocationConcurrency", "batchPolicy", "productBatchPolicy", "publicAdmission", "migration", "challengeManifest", "publicDevelopmentContract", "publicDevelopmentManifest", "publicSpecificationSha256", "finalPromptSha256", "productionProfileAdapterSha256", "materialApplicabilityReview", "preparation", "rankingReviewContract"]);
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
function requireKnownRoot(value, fields, message) {
  if (!isRecord(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error(message);
}
function validateRankingMetadataSummary(value) {
  const hashes = ["contractSha256", "publicPlanRawSha256", "publicPlanCanonicalSha256", "assignmentsRawSha256", "sealedCollectionRawSha256", "partitionSha256", "inputMetadataSha256", "profilePoolSha256", "publicDevelopmentManifestSha256"];
  requireKnownRoot(value, ["schemaVersion", ...hashes, "originalAuthors", "profiles", "pairedUnits", "latestOriginalSealedAt", "adjudicationReference", "rawGradesOpened"], "ranking_panel_metadata_summary_only_required");
  if (value.schemaVersion !== "saitu.ranking-panel-metadata-verification.v7.2" || hashes.some(key => !isHash(value[key])) || value.originalAuthors !== 48 || value.profiles !== 120 || value.pairedUnits !== 5400 ||
    !isTime(value.latestOriginalSealedAt) || value.rawGradesOpened !== false || value.adjudicationReference !== null && (!isRecord(value.adjudicationReference) ||
      Object.keys(value.adjudicationReference).sort().join(",") !== "canonicalSha256,path,rawSha256" || typeof value.adjudicationReference.path !== "string" || !isHash(value.adjudicationReference.rawSha256) || !isHash(value.adjudicationReference.canonicalSha256)))
    throw new Error("ranking_panel_metadata_summary_scalar_or_structure_invalid");
}
/** Metadata schema, not a classifier for secrets hidden in ordinary text. Nested
 * public evidence/annotation structures retain their explicitly declared uses. */
export function validateRegistrationMetadata(registration) {
  requireKnownRoot(registration, REGISTRATION_METADATA_FIELDS, "metadata_only_scoring_registration_required");
  requirePolicy(registration);
  if (registration.schemaVersion !== "saitu.ranking-registration.v7.1" || registration.inputOpened !== false || registration.formalRunsExecuted !== 0 ||
      !isTime(registration.registeredAt) || !isHash(registration.implementationSha256) || !Array.isArray(registration.implementation) ||
      registration.implementation.some(row => !isRecord(row) || typeof row.path !== "string" || !row.path || !isHash(row.sha256) || Object.keys(row).some(key => !["path", "sha256"].includes(key))) ||
      !isRecord(registration.config) || registration.publicDevelopmentVerification !== undefined && !isRecord(registration.publicDevelopmentVerification)) throw new Error("v7_registration_metadata_scalar_or_structure_invalid");
  requireKnownRoot(registration.config, REGISTRATION_CONFIG_FIELDS, "unknown_or_invalid_v7_registration_config_field");
  if (registration.config.rankingReviewContract !== undefined) {
    validateRankingReviewContract(registration.config.rankingReviewContract, { config: registration.config, registeredAt: registration.registeredAt });
    validateRankingMetadataSummary(registration.rankingPanelMetadataVerification);
  } else if (registration.rankingPanelMetadataVerification !== undefined) throw new Error("ranking_panel_metadata_contract_required");
  return registration;
}
export const readImplementationManifest = sourceManifest;
export async function verifyImplementationManifest(repositoryRoot, expectedManifest, expectedSha256) {
  if (!isHash(expectedSha256) || canonicalHash(expectedManifest) !== expectedSha256) throw new Error("v7_source_manifest_artifact_changed");
  const actual = await sourceManifest(repositoryRoot);
  if (canonicalHash(actual) !== expectedSha256) throw new Error("v7_actual_source_bytes_changed_since_freeze");
  return { files: actual.length, sha256: expectedSha256, actualSourceBytesVerified: true };
}
export function validateRegistrationConfig(config) {
  requireKnownRoot(config, REGISTRATION_CONFIG_FIELDS, "unknown_or_invalid_v7_registration_config_field");
  requirePolicy(config);
  if (config.publicDevelopmentContract !== undefined) validateDevelopmentConsumerContract(config);
  if (config.rankingReviewContract !== undefined) validateRankingReviewContract(config.rankingReviewContract, { config });
  validateEvaluationRuntime(config.runtime);
  const unbounded = config.executionMode === USER_UNBOUNDED_EXECUTION_MODE;
  if (config.executionMode !== undefined && !["finite", USER_UNBOUNDED_EXECUTION_MODE].includes(config.executionMode)) throw new Error("registered_execution_mode_invalid");
  if (unbounded && (!same(config.executionLimits, USER_UNBOUNDED_EXECUTION_LIMITS) || !same(config.schedulingPolicy, ADAPTIVE_EXECUTION_POLICY) || config.invocationConcurrency !== "adaptive")) throw new Error("unbounded_registration_requires_adaptive_resources_and_explicit_null_limits");
  if (!unbounded && (config.executionLimits !== undefined || config.schedulingPolicy !== undefined)) throw new Error("legacy_finite_registration_cannot_claim_unbounded_limits");
  if (config.schemaVersion !== "saitu.ranking-registration-config.v7.1" || config.purpose !== "ai_proxy_acceptance" ||
      !same(config.algorithms, FORMAL_ARMS) || config.profileCount !== 120 || config.repeats !== 5 || config.rankingReports !== 1200 ||
      config.reuseAlgorithm !== "C" || config.candidatePolicy !== "full_core_reviewed" || !isUint32(config.seed) || !isUint32(config.reviewSampleSeed) ||
      config.executionPhase !== "formal" || (!unbounded && ![1, 2].includes(config.invocationConcurrency))) throw new Error("v7_formal_matrix_must_be_120x5x_B_C_flash_frozen_effort_full_core");
  if (HASH_FIELDS.some(key => !isHash(config[key]))) throw new Error("v7_formal_registration_all_frozen_hashes_required");
  if (!same(config.rankingProtocol, EVALUATION_POLICY.ranking) || !same(config.reviewProtocol, EVALUATION_POLICY.review)) throw new Error("v7_preregistered_ranking_and_review_protocol_required");
  const batch = config.batchPolicy;
  if (unbounded) {
    if (!batch || batch.order !== "profile_then_repeat_then_arm" || ["runsPerBatch", "maxCReservationMicros", "maxHttpPerCInvocation"].some(key => batch[key] !== null)) throw new Error("unbounded_ranking_policy_requires_null_total_and_invocation_caps");
  } else if (!batch || batch.order !== "profile_then_repeat_then_arm" || !Number.isSafeInteger(batch.runsPerBatch) || batch.runsPerBatch < 1 || batch.runsPerBatch > 1200 ||
      !Number.isSafeInteger(batch.maxCReservationMicros) || batch.maxCReservationMicros < 1 || !Number.isSafeInteger(batch.maxHttpPerCInvocation) || batch.maxHttpPerCInvocation < 1 ||
      !isHash(batch.measuredBoundEvidenceSha256)) throw new Error("v7_explicit_finite_batch_and_measured_cost_bounds_required");
  const productBatch = config.productBatchPolicy;
  if (unbounded) {
    if (!productBatch || ["runsPerBatch", "maxHttpPerInvocation", "maxReservationMicros"].some(key => productBatch[key] !== null)) throw new Error("unbounded_product_policy_requires_null_total_and_invocation_caps");
  } else if (!productBatch || !Number.isSafeInteger(productBatch.runsPerBatch) || productBatch.runsPerBatch < 1 || productBatch.runsPerBatch > 680 ||
      !Number.isSafeInteger(productBatch.maxHttpPerInvocation) || productBatch.maxHttpPerInvocation < 1 ||
      !Number.isSafeInteger(productBatch.maxReservationMicros) || productBatch.maxReservationMicros < 1 || !isHash(productBatch.measuredBoundEvidenceSha256)) throw new Error("v7_finite_nonranking_product_batch_policy_required");
  if (!config.publicAdmission || !isHash(config.publicAdmission.sha256) || typeof config.publicAdmission.path !== "string") throw new Error("v7_new_five_public_runs_admission_required");
  for (const [key, hashKey] of [["migration", "migrationSha256"], ["challengeManifest", "challengeManifestSha256"]]) if (!config[key] || config[key].sha256 !== config[hashKey] || typeof config[key].path !== "string") throw new Error("v7_registered_public_challenge_and_migration_references_required");
  for (const key of ["publicSpecificationSha256", "finalPromptSha256", "productionProfileAdapterSha256"]) if (config[key] !== undefined && !isHash(config[key])) throw new Error(`v7_registration_metadata_hash_invalid:${key}`);
  for (const key of ["publicDevelopmentManifest", "materialApplicabilityReview"]) if (config[key] !== undefined && (!isRecord(config[key]) || typeof config[key].path !== "string" || !isHash(config[key].sha256))) throw new Error(`v7_registration_metadata_reference_invalid:${key}`);
  if (config.preparation !== undefined && !isRecord(config.preparation)) throw new Error("v7_registration_preparation_metadata_object_required");
  return config;
}
export function inspectPublicAdmission(admission, config) {
  const issues = [];
  if (admission.schemaVersion !== "saitu.public-admission.v7.1" || admission.policyVersion !== POLICY_VERSION || admission.policySha256 !== POLICY_SHA256 ||
      admission.implementationSha256 !== config.implementationSha256 || admission.runtimeConfigurationSha256 !== config.runtimeConfigurationSha256 ||
      admission.catalogSha256 !== config.catalogSha256 || admission.candidatePoolSha256 !== config.candidatePoolSha256 || admission.runtimeSourceBindingSha256 !== config.runtimeSourceBindingSha256) issues.push("new_v7_public_admission_binding_required");
  if (!Array.isArray(admission.runs) || admission.runs.length !== 5 || new Set(admission.runs.map(row => row.invocationId)).size !== 5 ||
      admission.runs.filter(row => row.realProviderDispatch === true && row.success === true && row.pageDelivered === true && row.criticalReviewPassed === true && publicRunWithinTargets(row)).length < 4 ||
      admission.runs.some(row => !row.invocationId || !isHash(row.receiptSha256))) issues.push("new_public_five_runs_require_four_real_successes");
  if (!admission.independentReview?.contextId || admission.independentReview.contextId === admission.authorContextId || admission.independentReview.passed !== true ||
      !isHash(admission.independentReview.evidenceSha256)) issues.push("public_admission_independent_review_required");
  return issues;
}
function publicRunWithinTargets(run) {
  const t = run?.timing, p = EVALUATION_POLICY.performance;
  return t && Number.isFinite(t.timeOrigin) && Number.isFinite(t.start) && t.timeOrigin + t.start > 0 &&
    Number.isFinite(t.listMs) && t.listMs >= 0 && t.listMs <= p.firstListP95Ms &&
    Number.isFinite(t.allDetailsMs) && t.allDetailsMs >= t.listMs && t.allDetailsMs <= p.allDetailsP95Ms &&
    Number.isFinite(t.readyExpansionMs) && t.readyExpansionMs >= 0 && t.readyExpansionMs <= p.readyExpansionP95Ms;
}
/** Boolean summaries cannot replace the five original receipts and an independent DOM/source audit. */
export async function verifyPublicAdmissionOriginals(admission, config, directory) {
  const issues = inspectPublicAdmission(admission, config); if (issues.length) throw new Error(issues.join(","));
  const spendRunId = admission.executionScope?.runId;
  if (typeof spendRunId !== "string" || !spendRunId.trim()) throw new Error("public_original_funded_execution_scope_required");
  if ((admission.executionScope.executionMode ?? "finite") !== (config.executionMode ?? "finite")) throw new Error("public_admission_execution_mode_differs_from_registration");
  if (config.runtime.effortPolicy !== undefined) assertSameEffortPolicy(effortPolicyForScope(admission.executionScope), validateEvaluationRuntime(config.runtime));
  const review = admission.independentReview;
  const unbounded = config.executionMode === USER_UNBOUNDED_EXECUTION_MODE, receiptOriginals = [];
  const originalReview = (await readBoundJson(directory, { path: review.evidencePath, sha256: review.evidenceSha256 })).value;
  if (originalReview.schemaVersion !== "saitu.public-critical-review.v7.1" || originalReview.contextId !== review.contextId || originalReview.passed !== true ||
      originalReview.admissionRunsSha256 !== canonicalHash(admission.runs) || !Array.isArray(originalReview.runChecks) || originalReview.runChecks.length !== 5) throw new Error("actual_independent_public_critical_review_required");
  for (const run of admission.runs) {
    const receipt = (await readBoundJson(directory, { path: run.receiptPath, sha256: run.receiptSha256 })).value;
    receiptOriginals.push({ run, receipt });
    if (unbounded && receipt.accountingTrace && receipt.accountingTrace.sourceSha256 !== config.runtimeSourceBindingSha256) throw new Error("public_parallel_trace_source_changed");
    if (receipt.schemaVersion !== "saitu.public-browser-receipts.v7.1" || receipt.invocationId !== run.invocationId || !Array.isArray(receipt.calls)) throw new Error("public_original_receipt_identity_changed");
    const real = hasBoundProviderDispatch(receipt.calls, spendRunId, config.runtime);
    if (run.realProviderDispatch !== real || receipt.realProviderDispatch !== real) throw new Error("public_dispatch_summary_differs_from_original_receipts");
    const checked = originalReview.runChecks.find(row => row.invocationId === run.invocationId);
    if (!checked || checked.receiptSha256 !== run.receiptSha256 || checked.criticalReviewPassed !== run.criticalReviewPassed) throw new Error("public_critical_review_not_bound_to_each_original_run");
    if (run.success && run.pageDelivered) {
      if (canonicalHash(receipt.runSnapshot?.context?.records) !== config.candidatePoolSha256) throw new Error("public_original_full_pool_changed");
      const items = receipt.runSnapshot?.items, detailItems = receipt.runSnapshot?.report?.recommendations;
      if (!Array.isArray(items) || !Array.isArray(detailItems) || items.length > EVALUATION_POLICY.recommendationMaxItems || detailItems.length !== items.length ||
          !same(items.map(row => row.itemId), detailItems.map(row => row.itemId))) throw new Error("public_original_top5_list_and_details_required");
      const dom = (await readBoundJson(directory, checked.dom)).value;
      if (!same(dom.record?.timing, run.timing) || dom.record?.invocationId !== run.invocationId) throw new Error("public_timing_not_bound_to_original_DOM_capture");
      await readBoundBytes(directory, checked.screenshot);
    }
  }
  if (unbounded) {
    if (admission.executionIntegrityPassed !== true || !admission.batchOriginals) throw new Error("public_parallel_batch_originals_required");
    const batch = (await readBoundJson(directory, admission.batchOriginals)).value;
    verifyPublicBatchOriginals(batch, receiptOriginals, admission.executionScope, config.runtime);
  }
  return { originalRunsVerified: 5, successRequired: 4, independentCriticalReviewVerified: true, ...(unbounded ? { originalBatchOwnershipVerified: true } : {}) };
}
/** Recompute exact ownership from captured request IDs and original call
 * reservations. Neither a shared batch nor a time interval assigns expenses. */
export function verifyPublicBatchOriginals(batch, originals, scope, runtime) {
  const fail = () => { throw new Error("public_parallel_original_reservation_ownership_not_closed"); };
  if (batch?.executionMode !== USER_UNBOUNDED_EXECUTION_MODE || batch.spendRunId !== scope.runId || batch.valid !== true ||
      !Array.isArray(batch.actualLedgerRows) || !Array.isArray(batch.ownership)) fail();
  const actual = new Map(), owners = new Map(), requestIds = new Set(), caseIds = new Set(), callIds = new Set(), policy = validateEvaluationRuntime(runtime);
  for (const row of batch.actualLedgerRows) {
    if (!row?.id || actual.has(row.id) || row.run_id !== scope.runId || row.phase !== scope.phase || row.model !== "deepseek-flash") fail();
    assertLedgerEffort(row, policy, { legacy: false });
    if ((row.state === "reserved" || row.charged_micros === null) && (!Number.isSafeInteger(Number(row.reserved_micros)) || Number(row.reserved_micros) <= 0)) fail();
    actual.set(row.id, row);
  }
  for (const { run, receipt } of originals) {
    if (typeof run.caseId !== "string" || !run.caseId || caseIds.has(run.caseId)) fail();
    caseIds.add(run.caseId);
    const rows = receipt.ledgerRows ?? [], calls = receipt.calls ?? [], http = receipt.httpOriginals ?? [], trace = receipt.accountingTrace;
    for (const call of calls) { if (!call.call_id || callIds.has(call.call_id)) fail(); callIds.add(call.call_id); }
    const owned = new Set(calls.map(call => call.reservation_id).filter(Boolean)), localRequests = new Set();
    if (rows.length || calls.length || http.length) {
      if (!trace || trace.complete !== true || trace.issues?.length || trace.inodeBefore !== trace.inodeAfter || trace.deviceBefore !== trace.deviceAfter ||
          !isHash(trace.prefixSha256Before) || trace.prefixSha256After !== trace.prefixSha256Before || !isHash(trace.segmentSha256)) fail();
    }
    for (const h of http) {
      if (!h.requestId || requestIds.has(h.requestId) || h.method !== "POST" || typeof h.requestBody !== "string" || byteHash(h.requestBody) !== h.requestBodySha256) fail();
      requestIds.add(h.requestId); localRequests.add(h.requestId);
      if (h.responseBodyBase64 !== undefined) {
        const bytes = Buffer.from(h.responseBodyBase64, "base64");
        if (bytes.toString("base64") !== h.responseBodyBase64 || byteHash(bytes) !== h.responseBodySha256 || h.responseHeaderRequestId !== h.requestId) fail();
      }
    }
    for (const event of trace?.events ?? []) {
      const bytes = Buffer.from(event.originalLineBase64 ?? "", "base64");
      let raw; try { raw = JSON.parse(bytes); } catch { fail(); }
      if (!localRequests.has(event.requestId) || bytes.toString("base64") !== event.originalLineBase64 || byteHash(bytes) !== event.originalLineSha256 ||
          !same(raw, Object.fromEntries(["event", "requestId", "time", "type", "details"].map(key => [key, event[key]]))) ||
          !Number.isSafeInteger(event.byteOffset) || event.byteOffset < trace.startOffset || event.byteOffset + bytes.length > trace.endOffset || !event.details?.reservationId) fail();
      owned.add(event.details.reservationId);
    }
    if (new Set(rows.map(row => row.id)).size !== rows.length || !same([...owned].sort(), rows.map(row => row.id).sort()) ||
        !same([...owned].sort(), [...(run.ownedLedgerIds ?? [])].sort())) fail();
    for (const row of rows) {
      // Settlements can advance between one journey's capture and whole-batch
      // closure. Preserve both originals and compare immutable identity/hold.
      const finalRow = actual.get(row.id), immutable = ["id", "run_id", "phase", "model", "operation", "effort", "effort_policy_sha256", "reserved_micros"];
      if (!finalRow || immutable.some(key => !same(finalRow[key] ?? null, row[key] ?? null)) || owners.has(row.id)) fail();
      owners.set(row.id, run.caseId);
    }
  }
  if (owners.size !== actual.size || batch.ownership.length !== owners.size || new Set(batch.ownership.map(row => row.reservationId)).size !== owners.size ||
      batch.ownership.some(row => owners.get(row.reservationId) !== row.caseId)) fail();
  return { verified: true, originalReservations: owners.size, unknownHoldsPreserved: true };
}
/** Registration consumes public metadata/reviews only; it never reads a sealed input or key. */
export async function createRegistration(config, { repositoryRoot, evidenceRoot = repositoryRoot, now = new Date().toISOString() }) {
  validateRegistrationConfig(config);
  if (!isTime(now)) throw new Error("valid_registration_time_required");
  const implementation = await sourceManifest(repositoryRoot);
  if (canonicalHash(implementation) !== config.implementationSha256) throw new Error("v7_implementation_not_frozen");
  const migration = (await readPublicEvaluationJson(evidenceRoot, config.migration)).value;
  if (config.migration.sha256 !== config.migrationSha256) throw new Error("v7_migration_reference_hash_mismatch");
  const migrationReview = inspectMigration(migration);
  if (!migrationReview.ready) throw new Error(`v7_independent_800_applicability_review_pending:${migrationReview.blockers.join(",")}`);
  for (const key of ["catalogSha256", "implementationSha256", "runtimeConfigurationSha256"]) if (migration.reviewBasis[key] !== config[key]) throw new Error("v7_applicability_review_basis_differs_from_registered_source_runtime");
  const challenge = (await readPublicEvaluationJson(evidenceRoot, config.challengeManifest)).value;
  const { inspectChallengeManifest } = await import("./evaluation-score.mjs");
  if (challenge.openedAt !== null || inspectChallengeManifest(challenge).length ||
      !same(migrationReview.cases.map(row => ({ caseId: row.caseId, layer: row.layer, inputSha256: row.inputSha256, answerSha256: row.answerSha256 })),
        challenge.cases.map(row => ({ caseId: row.caseId, layer: row.layer, inputSha256: row.inputSha256, answerSha256: row.answerSha256 })))) throw new Error("v7_unopened_challenge_does_not_match_independent_migration");
  for (const key of ["catalogSha256", "sourceSnapshotSha256", "rankingSourceSnapshotSha256", "implementationSha256", "runtimeConfigurationSha256", "migrationSha256", "publicDevelopmentManifestSha256", "profileSliceProtocolSha256"]) if (challenge[key] !== config[key]) throw new Error("v7_public_challenge_binding_differs_from_registration");
  const publicDevelopmentVerification = await verifyDevelopmentExclusions({ evidenceRoot, manifest: challenge, config, migration, registeredAt: now });
  requireTop5EvaluationRuntime(config.runtime);
  if (config.rankingReviewContract !== undefined) throw new Error("new_registration_uses_two_complete_blind_originals_not_panels");
  const rankingPanelMetadataVerification = config.rankingReviewContract ? await verifyRankingPanelMetadata({ evidenceRoot, contract: config.rankingReviewContract, config, manifest: challenge, migration, registeredAt: now }) : undefined;
  const admissionFile = await readBoundJson(evidenceRoot, config.publicAdmission), admission = admissionFile.value;
  const issues = inspectPublicAdmission(admission, config);
  if (issues.length) throw new Error(issues.join(","));
  await verifyPublicAdmissionOriginals(admission, config, path.dirname(admissionFile.filename));
  return { schemaVersion: "saitu.ranking-registration.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    registeredAt: now, inputOpened: false, formalRunsExecuted: 0, config, implementation, implementationSha256: canonicalHash(implementation), publicDevelopmentVerification,
    ...(rankingPanelMetadataVerification ? { rankingPanelMetadataVerification } : {}) };
}
export function verifyRegistration(registration, options) {
  validateRegistrationMetadata(registration); validateRegistrationConfig(registration.config);
  if (registration.schemaVersion !== "saitu.ranking-registration.v7.1" || registration.inputOpened !== false || !isTime(registration.registeredAt) ||
      registration.implementationSha256 !== registration.config.implementationSha256 || canonicalHash(registration.implementation) !== registration.implementationSha256) throw new Error("v7_registration_provenance_changed");
  for (const key of HASH_FIELDS) if (options[key] !== registration.config[key]) throw new Error(`v7_frozen_configuration_changed:${key}`);
  for (const key of ["algorithms", "runtime", "seed", "candidatePolicy", "reviewSampleSeed", "batchPolicy", "productBatchPolicy", "executionPhase", "invocationConcurrency", "executionMode", "executionLimits", "schedulingPolicy"]) {
    if (options[key] === undefined && registration.config[key] === undefined) continue;
    if (!same(options[key] ?? null, registration.config[key] ?? null)) throw new Error(`v7_frozen_configuration_changed:${key}`);
  }
  if (registration.config.publicDevelopmentContract) for (const key of ["publicDevelopmentContract", "publicDevelopmentManifest", "publicSpecificationSha256", "finalPromptSha256", "productionProfileAdapterSha256"]) if (!same(options[key], registration.config[key])) throw new Error(`v7_frozen_configuration_changed:${key}`);
  if ((options.rankingReviewContract !== undefined || registration.config.rankingReviewContract !== undefined) && !same(options.rankingReviewContract ?? null, registration.config.rankingReviewContract ?? null)) throw new Error("v7_frozen_configuration_changed:rankingReviewContract");
  return registration;
}
/** CLI bootstrap: reads only a separately byte-bound registration/public metadata
 * graph before any scoring bundle, ranking matrix, observation or key is opened. */
export async function preflightScoringRegistration({ evidenceRoot, reference }) {
  const original = await readPublicEvaluationJson(evidenceRoot, reference), registration = original.value;
  validateRegistrationMetadata(registration);
  verifyRegistration(registration, registration.config);
  const config = registration.config;
  const migration = (await readPublicEvaluationJson(evidenceRoot, config.migration)).value;
  const challenge = (await readPublicEvaluationJson(evidenceRoot, config.challengeManifest)).value;
  if (config.migration.sha256 !== config.migrationSha256 || config.challengeManifest.sha256 !== config.challengeManifestSha256 || challenge.openedAt !== null) throw new Error("registered_public_metadata_reference_changed");
  const { inspectChallengeManifest } = await import("./evaluation-score.mjs");
  const reviewed = inspectMigration(migration);
  if (!reviewed.ready || inspectChallengeManifest(challenge).length || !same(reviewed.cases.map(row => ({ caseId: row.caseId, layer: row.layer, inputSha256: row.inputSha256, answerSha256: row.answerSha256 })),
    challenge.cases.map(row => ({ caseId: row.caseId, layer: row.layer, inputSha256: row.inputSha256, answerSha256: row.answerSha256 })))) throw new Error("registered_scoring_public_migration_or_challenge_not_ready");
  for (const key of ["catalogSha256", "sourceSnapshotSha256", "rankingSourceSnapshotSha256", "implementationSha256", "runtimeConfigurationSha256", "migrationSha256", "publicDevelopmentManifestSha256", "profileSliceProtocolSha256"]) if (challenge[key] !== config[key]) throw new Error("registered_scoring_public_binding_changed");
  const publicDevelopmentVerification = await verifyDevelopmentExclusions({ evidenceRoot, manifest: challenge, config, migration, registeredAt: registration.registeredAt });
  if (!registration.publicDevelopmentVerification || ["publicDevelopmentManifestSha256", "materialReviewSha256", "finalExecutionAdoptionSha256", "caseBindingsSha256"].some(key => registration.publicDevelopmentVerification[key] !== publicDevelopmentVerification[key])) throw new Error("registered_public_readthrough_verification_changed");
  if (config.publicDevelopmentContract?.schemaVersion === CALIBRATION_DEVELOPMENT_CONSUMER_VERSION && ["calibrationScopeSha256", "calibrationDeltaReviewSha256"].some(key => registration.publicDevelopmentVerification[key] !== publicDevelopmentVerification[key])) throw new Error("registered_public_calibration_verification_changed");
  const rankingPanelMetadataVerification = config.rankingReviewContract ? await verifyRankingPanelMetadata({ evidenceRoot, contract: config.rankingReviewContract, config, manifest: challenge, migration, registeredAt: registration.registeredAt }) : undefined;
  if (rankingPanelMetadataVerification && !same(registration.rankingPanelMetadataVerification, rankingPanelMetadataVerification)) throw new Error("registered_ranking_panel_metadata_verification_changed");
  return { registration, registrationSha256: reference.sha256, publicDevelopmentVerification, ...(rankingPanelMetadataVerification ? { rankingPanelMetadataVerification } : {}) };
}
async function main() {
  const options = parseFileCli(process.argv.slice(2), ["--config", "--output"]);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const config = JSON.parse(await readFile(options["--config"], "utf8"));
  const registration = await createRegistration(config, { repositoryRoot: root });
  await writeNewJson(options["--output"], registration);
  console.log(JSON.stringify({ path: options["--output"], sha256: byteHash(await readFile(options["--output"])), rankingReports: 1200, reusedCReports: 600, inputOpened: false, labels: "pending_execution" }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
