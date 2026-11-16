import path from "node:path";
import { EVALUATION_POLICY, canonicalHash, same, requirePolicy, isTime, readBoundJson, readBoundBytes } from "./evaluation-policy.mjs";
import { validateExecutionScope } from "./evaluation-runtime.mjs";
import { readPublicEvaluationJson, verifyDevelopmentExclusions } from "./evaluation-development-exclusions.mjs";
import { loadRankingPanelsOriginals, isVerifiedRankingPanels } from "./evaluation-ranking-panels.mjs";
import { validateEvaluationRuntime, assertLedgerEffort, assertSameEffortPolicy, effortPolicyForScope } from "./evaluation-effort.mjs";
import { validateCompleteReviewerProvenance } from "./evaluation-packets.mjs";
import { USER_UNBOUNDED_EXECUTION_MODE, USER_UNBOUNDED_EXECUTION_LIMITS } from "../../../src/lib/ai/execution-policy.mjs";

const verifiedOriginals = new WeakMap();
const verifiedPanels = new WeakMap();
export const isVerifiedOriginals = (value, context) => Boolean(value && context && verifiedOriginals.has(value) &&
  same(verifiedOriginals.get(value), { bundle: canonicalHash(context.bundle), matrix: canonicalHash(context.matrix), registration: canonicalHash(context.registration) }));
/** Only a successful raw reader can expose the v7.2 analysis to the scorer. */
export function getVerifiedRankingPanels(proof, context) {
  const state = verifiedPanels.get(proof);
  return state && isVerifiedOriginals(proof, context) && state.proofSha256 === canonicalHash(proof) && isVerifiedRankingPanels(state.result, state.context) ? state.result : null;
}

/** Only this hashed file reader can issue the internal proof consumed by formal scoring. */
export async function loadScoringOriginals({ evidenceRoot, bundle, ranking }) {
  const { registration, matrix } = ranking, config = registration.config;
  const challenge = await readPublicEvaluationJson(evidenceRoot, config.challengeManifest), migration = await readPublicEvaluationJson(evidenceRoot, config.migration);
  if (config.challengeManifest.sha256 !== config.challengeManifestSha256 || config.migration.sha256 !== config.migrationSha256 ||
      !same(migration.value, bundle.migration)) throw new Error("registered_migration_original_differs_from_scoring_bundle");
  const originalManifest = challenge.value;
  if (originalManifest.openedAt !== null || !same({ ...originalManifest, openedAt: bundle.manifest.openedAt }, bundle.manifest)) throw new Error("registered_challenge_original_differs_from_scoring_bundle");
  const publicDevelopment = await verifyDevelopmentExclusions({ evidenceRoot, manifest: originalManifest, config, migration: migration.value, registeredAt: registration.registeredAt });
  // Historical programmatic readers used the exact implicit all-high runtime;
  // CLI registration preflight still requires the complete runtime metadata.
  const runtime = config.runtime ?? matrix.runtime ?? EVALUATION_POLICY.runtime;
  const policy = validateEvaluationRuntime(runtime), legacy = runtime.effortPolicy === undefined;
  if (!legacy && config.rankingReviewContract === undefined) {
    const gold = bundle.rankingGold;
    requirePolicy(gold);
    if (gold.schemaVersion !== "saitu.ranking-gold.v7.1" || !Array.isArray(gold.originals) || gold.originals.length !== 2 || new Set(gold.originals.map(row => row.contextId)).size !== 2) throw new Error("two_complete_new_stage_blind_originals_required");
    const blockedContextIds = [...(originalManifest.implementationAuthorContextIds ?? []), ...originalManifest.cases.map(row => row.authorContextId), gold.coordinatorContextId].filter(Boolean);
    for (const original of gold.originals) validateCompleteReviewerProvenance(original, { blockedContextIds });
  }
  const sourceDependencies = publicDevelopment.sourceDependencyVerification;
  let rankingPanels = null, rankingPanelContext;
  if (config.rankingReviewContract !== undefined || bundle.rankingGold?.schemaVersion === "saitu.ranking-gold.v7.2") {
    const gold = bundle.rankingGold;
    if (!gold || gold.schemaVersion !== "saitu.ranking-gold.v7.2" || Object.keys(gold).some(key => !["schemaVersion", "policyVersion", "policySha256", "reviewContract"].includes(key)) ||
        !config.rankingReviewContract || !same(gold.reviewContract, config.rankingReviewContract) || !registration.rankingPanelMetadataVerification) throw new Error("registered_v72_panel_contract_and_metadata_required");
    requirePolicy(gold);
    rankingPanelContext = { contract: config.rankingReviewContract, manifest: originalManifest, registeredAt: registration.registeredAt, expectedProfiles: matrix.rankings.profiles };
    rankingPanels = await loadRankingPanelsOriginals({ evidenceRoot, ...rankingPanelContext, config, migration: migration.value,
      expectedMetadataVerification: registration.rankingPanelMetadataVerification });
  }
  const run = await readBoundJson(evidenceRoot, bundle.productOriginals); requirePolicy(run.value);
  const original = run.value;
  if (original.schemaVersion !== "saitu.product-originals.v7.1" || !same(original.freezeBinding, matrix.freezeBinding) ||
      !isTime(original.openedAt) || original.openedAt !== bundle.manifest.openedAt || Date.parse(original.openedAt) < Date.parse(registration.registeredAt) ||
      original.producer?.path !== "scripts/competitions/v7/evaluation-executor.mjs" ||
      !registration.implementation.some(row => row.path === original.producer.path && row.sha256 === original.producer.sha256)) throw new Error("registered_actual_v7_product_producer_required");
  const runRoot = path.dirname(run.filename);
  const executionManifest = await readBoundJson(runRoot, original.executionManifest);
  const execution = executionManifest.value, executionRoot = path.dirname(executionManifest.filename);
  requirePolicy(execution);
  if (execution.schemaVersion !== "saitu.product-execution-manifest.v7.1" || execution.originalNonrankingSlots !== 680 ||
      execution.productInputSha256 !== config.productInputSha256 || !same(execution.producer, original.producer) || !same(execution.freezeBinding, original.freezeBinding) ||
      execution.openedAt !== original.openedAt) throw new Error("original_execution_manifest_does_not_match_registered_680_run");
  if ((execution.executionMode ?? "finite") !== (config.executionMode ?? "finite")) throw new Error("product_execution_mode_differs_from_registration");
  if (config.executionMode === USER_UNBOUNDED_EXECUTION_MODE) {
    if (!same(execution.executionLimits, USER_UNBOUNDED_EXECUTION_LIMITS) || !same(execution.schedulingPolicy, config.schedulingPolicy) || !Array.isArray(execution.schedulingTraces) || !execution.schedulingTraces.length) throw new Error("unbounded_product_adaptive_scheduling_originals_required");
    for (const reference of execution.schedulingTraces) {
      const trace = (await readBoundBytes(executionRoot, reference)).bytes.toString("utf8").trim().split("\n").map(line => JSON.parse(line));
      if (trace.at(-1)?.type !== "coordinator_settled") throw new Error("unbounded_product_scheduler_not_settled");
    }
  }
  if (!Array.isArray(execution.originalAttempts) || !execution.originalAttempts.length) throw new Error("all_original_product_attempts_must_remain_bound");
  for (const reference of execution.originalAttempts) await readBoundBytes(executionRoot, reference);
  const loaded = {};
  for (const key of ["cases", "keys", "reviews", "sources"]) loaded[key] = (await readBoundJson(runRoot, original[key])).value;
  loaded.observations = (await readBoundJson(executionRoot, execution.observations)).value;
  if (loaded.observations.length !== 680 || loaded.observations.some(row => row.operation === "recommend")) throw new Error("680_nonranking_originals_required_separate_from_reused_C");
  const merged = [...loaded.observations, ...matrix.observations.filter(row => row.algorithm === "C")];
  const normalize = values => [...values].sort((a, b) => `${a.caseId}:${a.repetition ?? 0}`.localeCompare(`${b.caseId}:${b.repetition ?? 0}`));
  if (!same(normalize(merged), normalize(bundle.observations))) throw new Error("scoring_observations_differ_from_product_originals_and_same_C_invocations");
  for (const key of ["cases", "keys", "reviews", "sources"]) if (!same(loaded[key], bundle[key])) throw new Error(`scoring_${key}_differ_from_bound_originals`);
  const receipts = new Map(), receiptRows = (await readBoundJson(executionRoot, execution.receipts)).value;
  for (const receipt of receiptRows) {
    if (!receipt.invocationId || receipts.has(receipt.invocationId)) throw new Error("duplicate_original_product_receipt");
    receipts.set(receipt.invocationId, receipt);
  }
  for (const observation of loaded.observations) {
    const receipt = receipts.get(observation.invocationId);
    if (!receipt || receipt.schemaVersion !== "saitu.product-execution-receipt.v7.1" || receipt.observationSha256 !== canonicalHash(observation) ||
        receipt.producerSha256 !== original.producer.sha256 || receipt.inputSha256 !== observation.inputSha256 ||
        !same(receipt.freezeBinding, matrix.freezeBinding) || receipt.executionRuntimeConfigurationSha256 !== receipt.executionScope?.executionRuntimeConfigurationSha256 ||
        !same(receipt.events, observation.events)) throw new Error("nonranking_observation_missing_original_execution_receipt");
    validateExecutionScope(receipt.executionScope, { allowedPhases: ["formal"] });
    if ((receipt.executionScope.executionMode ?? "finite") !== (config.executionMode ?? "finite") || (observation.execution.executionMode ?? "finite") !== (config.executionMode ?? "finite")) throw new Error("product_original_execution_mode_changed");
    assertSameEffortPolicy(effortPolicyForScope(receipt.executionScope), policy);
    if (!legacy && !same(observation.runtime, runtime)) throw new Error("product_original_runtime_effort_policy_changed");
    await readBoundBytes(evidenceRoot, receipt.executionScope.authorizationPolicySnapshot);
    if (!execution.executionScopes.some(scope => same(scope, receipt.executionScope))) throw new Error("original_execution_scope_not_in_batch_manifest");
    for (const dispatch of observation.events.filter(event => event.type === "ai_transport_dispatch")) {
      const ledger = receipt.ledgerRows?.find(row => row.id === dispatch.details.reservationId);
      if (!ledger || ledger.run_id !== receipt.executionScope.runId || ledger.phase !== "formal" || ledger.model !== "deepseek-flash") throw new Error("product_dispatch_not_bound_to_actual_authorized_ledger_row");
      assertLedgerEffort(ledger, policy, { legacy });
      if (!legacy && ledger.operation !== dispatch.details.operation) throw new Error("product_dispatch_operation_differs_from_original_ledger");
    }
  }
  const proof = { schemaVersion: "saitu.raw-scoring-verification.v7.1", rawOriginalBytesVerified: true,
    registeredChallengeSha256: config.challengeManifestSha256, registeredMigrationSha256: config.migrationSha256,
    productOriginalsSha256: bundle.productOriginals.sha256, matrixFreezeSha256: ranking.freezeManifestSha256,
    registrationSha256: matrix.freezeBinding.registrationSha256, originalProductObservations: 680, reusedCObservations: 600,
    caseSourceDependenciesSha256: sourceDependencies.dependencyManifestSha256, sourceDependencyVerification: sourceDependencies,
    publicDevelopmentManifestSha256: publicDevelopment.publicDevelopmentManifestSha256, materialReviewSha256: publicDevelopment.materialReviewSha256,
    finalExecutionAdoptionSha256: publicDevelopment.finalExecutionAdoptionSha256, publicDevelopmentVerification: publicDevelopment };
  if (rankingPanels) proof.rankingPanelsVerification = { schemaVersion: "saitu.ranking-panels-scoring-proof.v7.2", metadata: rankingPanels.metadataVerification,
    rawOriginalBytesVerified: true, rawRowsSha256: canonicalHash(rankingPanels.rows), panelsSha256: canonicalHash(rankingPanels.panels),
    originalAgreement: rankingPanels.originalAgreement, unresolvedAfterAdjudication: rankingPanels.unresolvedAfterAdjudication,
    resolvedProfilesSha256: canonicalHash(rankingPanels.resolvedProfiles), goldReady: rankingPanels.goldReady, blockers: rankingPanels.blockers };
  verifiedOriginals.set(proof, { bundle: canonicalHash(bundle), matrix: canonicalHash(matrix), registration: canonicalHash(registration) });
  if (rankingPanels) verifiedPanels.set(proof, { result: rankingPanels, context: rankingPanelContext, proofSha256: canonicalHash(proof) });
  return proof;
}
