import { appendFileSync } from "node:fs";
import { mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { FAST24, FAST24_MATCH_POLICY_VERSION } from "./fast24-config.mjs";
import { canonicalHash, byteHash, writeNewJson, POLICY_SHA256 } from "./evaluation-policy.mjs";
import { deriveRunSeed, seededShuffle } from "../v6/frozen-ranking-executor.mjs";
import { acquireCoordinatorLock, checkpointInvocation, executeObservedProduct, loadActualProductModules } from "./evaluation-executor.mjs";
import { runAdaptiveSlotQueue } from "../../lib/adaptive-execution.mjs";
import { runtimeBehaviorConfiguration } from "./evaluation-runtime.mjs";
import { effortPolicySha256, readConfiguredEffortPolicy, effortPolicyForScope, assertSameEffortPolicy, rankNonThinkingContinuationForScope } from "./evaluation-effort.mjs";
import { verifyRankNonThinkingContinuationScope } from "./rank-nonthinking-pilot-proof.mjs";
import { assessFast24EarlyStop, fast24CSlotEvidence, fast24FinalReportEvidence } from "./fast24-early-stop.mjs";
import { STEP8_RUN_SCHEMA, step8ScopeMatches, assertStep8Original, assertStep8Dispatch, verifyStep8FinalPrerequisites } from "./fast24-step8.mjs";
import { verifyFast24RepairAuthorization } from "./fast24-repair-authorization.mjs";
import { runtimeConfigurationHash } from "../v6/runtime-configuration.mjs";
import { USER_UNBOUNDED_EXECUTION_MODE, USER_UNBOUNDED_AUTHORIZATION_POLICY, USER_UNBOUNDED_GRANT_VERSION,
  USER_UNBOUNDED_EXECUTION_LIMITS, readExecutionMode, RANK_NONTHINKING_AUTHORIZATION_POLICY, FAST24_REPAIR_AUTHORIZATION_POLICY,
  FAST24_REPAIR_VALIDATION_PURPOSE, FAST24_FINAL_ACCEPTANCE_PURPOSE } from "../../../src/lib/ai/execution-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const assert = (condition, message) => { if (!condition) throw new Error(`fast24:${message}`); };
const json = async filename => JSON.parse(await readFile(filename, "utf8"));
const exists = filename => readFile(filename).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
const sample = (rows, count, label, seed) => seededShuffle([...rows].sort((a, b) => a.caseId.localeCompare(b.caseId)), deriveRunSeed(seed, label, 0)).slice(0, count);
const slotId = (row, algorithm = null, repetition = 0) => `${row.caseId}:${algorithm ?? row.operation}:${repetition}`;
const originalPath = (output, reference) => path.isAbsolute(reference.path) ? reference.path : path.join(output, reference.path);
const inheritedFor = (manifest, slot) => manifest.inheritedOriginals?.find(row => row.slotId === slot.slotId);

/** Bind production bytes and actual runtime knobs; unrelated evidence scripts do not change this run. */
export function fast24RuntimeBinding(environment = process.env) {
  const behavior = runtimeBehaviorConfiguration(environment), directScripts = new Set([
    "scripts/competitions/v7/fast24.mjs", "scripts/competitions/v7/fast24-config.mjs", "scripts/competitions/v7/fast24-early-stop.mjs", "scripts/competitions/v7/evaluation-executor.mjs",
    "scripts/competitions/v7/evaluation-policy.mjs", "scripts/competitions/v7/evaluation-effort.mjs", "scripts/competitions/v7/evaluation-runtime.mjs",
    "scripts/competitions/v7/rank-nonthinking-pilot-proof.mjs",
    "scripts/competitions/v7/fast24-step8.mjs", "scripts/competitions/v7/fast24-repair-authorization.mjs",
    "scripts/competitions/v7/evaluation-local-e5.mjs", "scripts/competitions/v6/frozen-ranking-executor.mjs",
    "scripts/competitions/v6/local-e5.mjs", "scripts/competitions/v6/runtime-configuration.mjs",
    "scripts/lib/load-typescript-source.mjs", "scripts/lib/adaptive-execution.mjs",
  ]);
  behavior.behaviorSourceBindings = behavior.behaviorSourceBindings.filter(row => !row.path.startsWith("scripts/") || directScripts.has(row.path));
  return canonicalHash(behavior);
}

/** Only input metadata is consumed. Neither private labels nor model outputs enter selection. */
export function selectFast24({ product, ranking, exclusions, seed = FAST24.seed, ensureProfileAttribution = true }) {
  assert(product.asOf === ranking.asOf, "source_clocks_differ");
  assert(Array.isArray(exclusions.developmentInputSha256) && Array.isArray(exclusions.developmentFamilyIds), "development_exclusion_fingerprints_required");
  const hashes = new Set(exclusions.developmentInputSha256), families = new Set(exclusions.developmentFamilyIds), templates = new Set(exclusions.developmentTemplateFamilyIds ?? []);
  const allowed = row => !hashes.has(canonicalHash(row.input)) && !hashes.has(row.originalInputCanonicalSha256) && !families.has(row.familyId) && !templates.has(row.templateFamilyId);
  const selectedProduct = [], selectedRanking = [], excluded = [];
  for (const row of [...product.cases.filter(row => row.operation !== "recommend"), ...ranking.profiles]) if (!allowed(row)) excluded.push(row.caseId);
  for (const [operation, count] of Object.entries(FAST24.counts).filter(([operation]) => operation !== "ranking")) {
    const source = product.cases.filter(row => row.operation === operation);
    if (operation === "constraint_check") assert(source.length === count && source.every(allowed), "all_300_constraints_required_without_development_overlap");
    const picked = sample(source.filter(allowed), count, operation, seed);
    assert(picked.length === count, `insufficient_${operation}_inputs`); selectedProduct.push(...picked);
    if (operation === "extract_profile" && ensureProfileAttribution) {
      const attributionFields = ["translation_role", "design_role", "project_role", "experiment_role"];
      if (!picked.some(row => row.input.requestedFields?.some(field => attributionFields.includes(field)))) {
        const attribution = source.find(row => allowed(row) && row.input.requestedFields?.includes("translation_role"));
        assert(attribution, "existing_profile_attribution_input_required"); selectedProduct[selectedProduct.length - 1] = attribution;
      }
    }
  }
  for (const taskGroup of FAST24.groups) {
    const picked = sample(ranking.profiles.filter(row => row.taskGroup === taskGroup && allowed(row)), 4, taskGroup, seed);
    assert(picked.length === 4, `insufficient_ranking_group_${taskGroup}`); selectedRanking.push(...picked);
  }
  const cases = [...selectedProduct, ...selectedRanking];
  assert(cases.length === 396 && new Set(cases.map(row => row.caseId)).size === 396, "396_distinct_case_identities_required");
  assert(new Set(cases.map(row => canonicalHash(row.input))).size === 396, "396_distinct_inputs_required");
  const slots = selectedProduct.map(row => ({ slotId: slotId(row), caseId: row.caseId, operation: row.operation, algorithm: null, repetition: 0 }));
  for (const row of selectedRanking) for (let repetition = 0; repetition < FAST24.repetitions; repetition++) for (const algorithm of ["B", "C"])
    slots.push({ slotId: slotId(row, algorithm, repetition), caseId: row.caseId, operation: "recommend", algorithm, repetition });
  const blindPairs = FAST24.groups.flatMap(taskGroup => sample(selectedRanking.filter(row => row.taskGroup === taskGroup), FAST24.blindPairsPerGroup, `blind:${taskGroup}`, seed))
    .map((row, index) => ({ pairId: `fast24-blind-${String(index + 1).padStart(2, "0")}`, caseId: row.caseId, taskGroup: row.taskGroup,
      // Private allocation is omitted from reviewer packets until their decisions are locked.
      leftSlotId: slotId(row, deriveRunSeed(seed, row.caseId, 99) % 2 ? "B" : "C"),
      rightSlotId: slotId(row, deriveRunSeed(seed, row.caseId, 99) % 2 ? "C" : "B") }));
  return { product: { asOf: product.asOf, cases: selectedProduct }, ranking: { asOf: ranking.asOf, profiles: selectedRanking },
    slots, blindPairs, excludedDevelopmentCaseIds: [...new Set(excluded)].sort() };
}

export async function prepareFast24({ output = FAST24.output, productSource = FAST24.productSource, rankingSource = FAST24.rankingSource,
  developmentExclusions = FAST24.developmentExclusions } = {}) {
  output = path.resolve(root, output);
  assert(!await exists(path.join(output, "manifest.json")), "selection_already_frozen_use_existing_manifest");
  const sources = await Promise.all([productSource, rankingSource, developmentExclusions].map(async filename => {
    const bytes = await readFile(path.resolve(root, filename)); return { path: path.resolve(root, filename), sha256: byteHash(bytes), value: JSON.parse(bytes) };
  }));
  const selection = selectFast24({ product: sources[0].value, ranking: sources[1].value, exclusions: sources[2].value });
  await mkdir(path.join(output, "inputs"), { recursive: true, mode: 0o700 });
  const inputs = {};
  for (const kind of ["product", "ranking"]) {
    const filename = path.join(output, "inputs", `${kind}.json`); await writeNewJson(filename, selection[kind]);
    inputs[kind] = { path: `inputs/${kind}.json`, sha256: byteHash(await readFile(filename)) };
  }
  const manifest = { schemaVersion: "saitu.fast24-selection.v1", version: FAST24.version, seed: FAST24.seed, preparedAt: new Date().toISOString(),
    selectionBeforeProductOutputs: true, selectedDistinctInputs: 396, expectedSlots: 468, expectedCReports: 48,
    thresholds: FAST24.thresholds, inputSources: sources.map(({ path, sha256 }) => ({ path, sha256 })), inputs,
    cases: [...selection.product.cases, ...selection.ranking.profiles].map(row => ({ caseId: row.caseId, familyId: row.familyId,
      templateFamilyId: row.templateFamilyId ?? null, taskGroup: row.taskGroup, operation: row.operation ?? "recommend", inputSha256: canonicalHash(row.input) })),
    excludedDevelopmentCaseIds: selection.excludedDevelopmentCaseIds, slots: selection.slots, blindPairsPrivateAllocation: selection.blindPairs,
    independentReview: { owner: "E", acceptance: "pending_actual_output_review", answerLabelsReadByProducer: false },
    historicalFormalPolicyChanged: false };
  await writeNewJson(path.join(output, "manifest.json"), manifest);
  return { output, selectedDistinctInputs: 396, expectedSlots: 468, expectedCReports: 48, providerCalls: 0 };
}

export async function readFast24(output) {
  output = path.resolve(root, output); const bytes = await readFile(path.join(output, "manifest.json")), manifest = JSON.parse(bytes), inputs = {};
  assert(manifest.version === FAST24.version && manifest.seed === FAST24.seed, "unsupported_manifest");
  for (const [kind, reference] of Object.entries(manifest.inputs)) {
    const content = await readFile(path.join(output, reference.path)); assert(byteHash(content) === reference.sha256, "selected_input_bytes_changed"); inputs[kind] = JSON.parse(content);
  }
  const rows = [...inputs.product.cases, ...inputs.ranking.profiles];
  assert(rows.length === 396 && rows.every(row => manifest.cases.find(item => item.caseId === row.caseId)?.inputSha256 === canonicalHash(row.input)), "selected_case_identity_changed");
  assert(manifest.slots.length === 468 && new Set(manifest.slots.map(row => row.slotId)).size === 468, "slot_denominator_changed");
  return { output, manifest, selectionSha256: byteHash(bytes), inputs, rows };
}

const identityFor = (selectionSha256, slot) => ({ version: FAST24.version, selectionSha256, slotId: slot.slotId });
export async function summarizeFast24(output, { write = true, review } = {}) {
  const prepared = await readFast24(output), { manifest, selectionSha256 } = prepared; output = prepared.output;
  const step8Scope = manifest.acceptanceRun?.schemaVersion === STEP8_RUN_SCHEMA ? await json(path.join(output, "execution-scope.json")) : null;
  if (step8Scope) step8ScopeMatches(prepared, step8Scope);
  const prior = await exists(path.join(output, "summary.json")) ? await json(path.join(output, "summary.json")) : null;
  assert(!prior || prior.selectionSha256 === selectionSha256, "selection_changed_after_execution_started");
  const slots = [], observations = [];
  for (const slot of manifest.slots) {
    const key = canonicalHash(identityFor(selectionSha256, slot)), inherited = inheritedFor(manifest, slot);
    const member = inherited?.original.path ?? `invocations/${key}.json`, filename = originalPath(output, { path: member });
    if (await exists(filename)) {
      const bytes = await readFile(filename), result = JSON.parse(bytes), observation = result.observation;
      assert(!inherited || byteHash(bytes) === inherited.original.sha256, "inherited_original_bytes_changed");
      assert(observation?.caseId === slot.caseId && observation.repetition === slot.repetition && (observation.algorithm ?? null) === slot.algorithm &&
        observation.inputSha256 === manifest.cases.find(row => row.caseId === slot.caseId).inputSha256, "original_identity_changed");
      if (step8Scope) assertStep8Original(step8Scope, result, slot);
      observations.push(observation);
      slots.push({ ...slot, status: observation.status, error: observation.error, invocationId: observation.invocationId,
        outputSha256: observation.outputSha256, httpDispatches: observation.execution.httpDispatches, original: { path: member, sha256: byteHash(bytes) },
        ...(inherited ? { inheritedFromSelectionSha256: inherited.selectionSha256 } : {}) });
    } else {
      assert(!inherited, "inherited_original_missing");
      const pendingIntent = await exists(path.join(output, `invocations/${key}.intent.json`));
      slots.push({ ...slot, status: pendingIntent ? "indeterminate" : "not_run", reason: pendingIntent ? "original_intent_is_never_reissued" : "not_started" });
    }
  }
  const complete = observations.filter(row => row.algorithm === "C" && fast24FinalReportEvidence(row)?.technicalComplete);
  const summary = { schemaVersion: "saitu.fast24-summary.v1", version: FAST24.version, selectionSha256, updatedAt: new Date().toISOString(),
    distinctInputs: manifest.cases.length, expectedSlots: manifest.slots.length, expectedCReports: 48, recordedOriginals: observations.length,
    statuses: Object.fromEntries(["observed", "error", "indeterminate", "not_run"].map(status => [status, slots.filter(row => row.status === status).length])),
    completedCReports: complete.length, completeCThresholdMet: complete.length >= FAST24.thresholds.completeCReports,
    httpDispatches: observations.reduce((total, row) => total + row.execution.httpDispatches, 0),
    independentQualityAcceptance: "pending_E_review", thresholds: FAST24.thresholds, failuresRemainInDenominator: true, slots,
    ...(step8Scope ? { runPurpose: step8Scope.runPurpose, applicationRuntimeSourceSha256: step8Scope.applicationRuntimeSourceSha256,
      productionBuildId: step8Scope.productionBuildId, finalAcceptancePassed: false } : {}) };
  if (review) {
    const report = await json(path.resolve(root, review));
    if (manifest.acceptanceRun?.matchPolicyVersion === FAST24_MATCH_POLICY_VERSION)
      assert(report.matchPolicyVersion === FAST24_MATCH_POLICY_VERSION && report.metrics?.completeC <= complete.length,
        "current_review_must_count_only_nonempty_delivered_reports");
    summary.independentQuality = assessIndependentQuality(report, selectionSha256);
    summary.independentQualityAcceptance = summary.independentQuality.status;
    summary.independentQuality.source = { path: path.resolve(root, review), sha256: byteHash(await readFile(path.resolve(root, review))) };
  }
  if (write) { const temp = path.join(output, `summary-${randomUUID()}.tmp`); await writeNewJson(temp, summary); await rename(temp, path.join(output, "summary.json")); }
  return summary;
}

/** Consume E's aggregate only. Private answers, semantic atoms and claim labels stay with the evaluator. */
export function assessIndependentQuality(report, selectionSha256) {
  assert(report.schemaVersion === "saitu.fast24.independent-acceptance-summary.safe.v1" && report.selectionSha256 === selectionSha256 &&
    !["claims", "outcomes", "profileAlignments", "expectedAtoms"].some(key => Object.hasOwn(report, key)), "independent_safe_summary_binding_required");
  const m = report.metrics ?? {}, t = FAST24.thresholds, minimum = (key, threshold) => Number.isFinite(m[key]) && m[key] >= threshold;
  const gates = { completeC: minimum("completeC", t.completeCReports), fit: minimum("fitMean", t.top5Fit),
    groupFit: FAST24.groups.every(group => Number.isFinite(m.groupFit?.[group]) && m.groupFit[group] >= t.minimumGroupFit),
    jaccard: minimum("jaccardMean", t.top5SeriesJaccard), distinctFacts: minimum("distinctFacts", t.distinctFacts),
    factAccuracy: minimum("factAccuracy", t.factAccuracy), citationPrecision: minimum("citationPrecision", t.citationPrecision),
    citationCoverage: minimum("citationCoverage", t.citationCoverage), keyCoverage: minimum("keyCoverage", 1),
    profile: minimum("profileMicroF1", t.profileMicroF1), correction: minimum("correctionSuccess", 1), isolation: minimum("correctionIsolation", 1),
    conversation: minimum("conversationPasses", 11), robustness: minimum("robustnessPasses", 11), blind: minimum("blindCNotWorse", 10),
    constraints: report.counts?.constraintsReviewed === 300 && report.counts?.constraintsPassed === 300,
    allSlotsReviewed: report.counts?.reviewedOutcomes === 468,
    noCriticalErrors: ["fact", "attribution", "correction", "isolation", "constraint"].every(key => report.criticalErrors?.[key] === 0) };
  const complete = ["complete", "reviewed"].includes(report.status), passed = complete && report.passed === true && Object.values(gates).every(Boolean);
  return { status: !complete ? "pending_E_review" : passed ? "passed" : "failed", passed, reviewer: report.reviewer,
    review: report.review, metrics: m, counts: report.counts, criticalErrors: report.criticalErrors, gates };
}

async function verifyLiveScope(modules, scope) {
  const repair = scope?.runPurpose === FAST24_REPAIR_VALIDATION_PURPOSE;
  const continuation = repair ? null : rankNonThinkingContinuationForScope(scope);
  if (repair) await verifyFast24RepairAuthorization(root, scope);
  if (continuation) await verifyRankNonThinkingContinuationScope(root, scope);
  assert(scope && scope.runId === process.env.AI_SPEND_RUN_ID && scope.phase === process.env.AI_SPEND_PHASE &&
    scope.authorizationPolicySha256 === process.env.AI_SPEND_POLICY_SHA256 && scope.executionRuntimeConfigurationSha256 === runtimeConfigurationHash() &&
    scope.executionMode === USER_UNBOUNDED_EXECUTION_MODE && readExecutionMode() === scope.executionMode, "live_scope_environment_changed");
  const row = (await modules.database.getPool().query("select state,execution_mode,authorized_phase,effort_policy_sha256,policy_sha256,effort_condition_sha256,effort_condition from ai_spend_development_batches where run_id=$1", [scope.runId])).rows[0];
  assert(row?.state === "active" && row.execution_mode === scope.executionMode && row.authorized_phase === scope.phase &&
    row.policy_sha256 === scope.authorizationPolicySha256 && row.effort_policy_sha256 === effortPolicySha256(effortPolicyForScope(scope)), "existing_live_grant_required");
  assertSameEffortPolicy(readConfiguredEffortPolicy(), effortPolicyForScope(scope));
  if (continuation) assert(row.effort_condition?.sourcePolicy === RANK_NONTHINKING_AUTHORIZATION_POLICY &&
    canonicalHash(row.effort_condition?.pilotContinuation ?? null) === canonicalHash(continuation), "actual_verified_continuation_grant_required");
  if (repair) assert(row.effort_condition?.sourcePolicy === FAST24_REPAIR_AUTHORIZATION_POLICY &&
    row.effort_condition_sha256 === scope.effortConditionSha256 && row.effort_condition.runPurpose === scope.runPurpose &&
    row.effort_condition.repairAuthorizationRecordSha256 === scope.repairAuthorizationRecordSha256 &&
    canonicalHash(row.effort_condition.repairValidation) === canonicalHash(scope.repairValidation) && row.effort_condition.pilotContinuation === null,
  "actual_repair_validation_grant_must_match_frozen_cohort");
}

/** Read the existing production authorization; never create/fund/alter an authority. */
export async function createFast24Scope({ output, authorizationPolicy } = {}) {
  assert(output, "new_scope_file_required");
  const modules = await loadActualProductModules();
  try {
    const { readUserUnboundedExecutionAuthorizationV7 } = await import("../../../src/lib/ai/execution-authorization.ts");
    const authority = await readUserUnboundedExecutionAuthorizationV7(), effortPolicy = readConfiguredEffortPolicy();
    const row = (await modules.database.getPool().query("select funding_limit_micros::text,effort_condition from ai_spend_development_batches where run_id=$1", [authority.runId])).rows[0];
    const nonThinking = effortPolicy.version === "saitu.effort-policy.v2";
    const sourcePolicy = row?.effort_condition?.sourcePolicy;
    const repair = sourcePolicy === FAST24_REPAIR_AUTHORIZATION_POLICY;
    if (nonThinking) assert(repair || sourcePolicy === RANK_NONTHINKING_AUTHORIZATION_POLICY, "explicit_new_policy_database_grant_required");
    const policyPath = path.resolve(root, authorizationPolicy ?? (nonThinking ? sourcePolicy : USER_UNBOUNDED_AUTHORIZATION_POLICY)), policySha256 = byteHash(await readFile(policyPath));
    assert(policySha256 === authority.policySha256, "existing_authorization_policy_bytes_changed");
    const scope = { schemaVersion: "saitu.fast24-execution-scope.v1", version: FAST24.version, createdAt: new Date().toISOString(),
      runId: authority.runId, mainRunId: authority.mainRunId, phase: authority.phase, authorizedPhase: authority.phase,
      grantVersion: USER_UNBOUNDED_GRANT_VERSION, authorizedEffort: "stage", effortPolicy,
      effortPolicySha256: authority.effortPolicySha256, effortConditionSha256: authority.conditionSha256,
      executionMode: USER_UNBOUNDED_EXECUTION_MODE, executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS, callLimit: null,
      fundingLimitCny: Number(row.funding_limit_micros) / 1_000_000, authorizationPolicySha256: policySha256,
      environmentAuthorizationPolicySha256: policySha256, evaluationPolicySha256: POLICY_SHA256,
      authorizationPolicySnapshot: { path: policyPath, sha256: policySha256 }, executionRuntimeConfigurationSha256: runtimeConfigurationHash(),
      ...(nonThinking ? { authorizationPolicySource: sourcePolicy, pilotContinuation: row.effort_condition.pilotContinuation } : {}),
      ...(repair ? { runPurpose: row.effort_condition.runPurpose, repairValidation: row.effort_condition.repairValidation,
        repairAuthorizationRecordSha256: row.effort_condition.repairAuthorizationRecordSha256 } : {}) };
    await verifyLiveScope(modules, scope); await writeNewJson(path.resolve(root, output), scope);
    return { output: path.resolve(root, output), runId: authority.runId, phase: authority.phase, providerCalls: 0, grantsCreated: 0 };
  } finally { await modules.database.getPool().end(); }
}

/** Root is the only live dispatcher. This never creates grants or bypasses production governance. */
export async function runFast24({ output = FAST24.output, phase = "constraints", slotIds, scope, executePaid = false, e5Cache = FAST24.e5Cache, recoverLockSha256,
  modules: suppliedModules, embeddingProvider: suppliedEmbeddings, execute = executeObservedProduct, sampleResources, review, earlyStop = null, step8Stage, waveReview, operations } = {}) {
  const prepared = await readFast24(output), { manifest, selectionSha256, inputs, rows } = prepared; output = prepared.output;
  assert(["constraints", "ranking", "product", "all"].includes(phase), "phase_required");
  const phaseSlots = manifest.slots.filter(slot => phase === "all" || phase === "constraints" && slot.operation === "constraint_check" ||
    phase === "ranking" && slot.algorithm || phase === "product" && !slot.algorithm && slot.operation !== "constraint_check");
  assert(!slotIds || slotIds.length > 0 && new Set(slotIds).size === slotIds.length && slotIds.every(id => phaseSlots.some(slot => slot.slotId === id)), "requested_slots_not_in_selected_phase");
  const selected = slotIds ? phaseSlots.filter(slot => slotIds.includes(slot.slotId)) : phaseSlots;
  const step8 = manifest.acceptanceRun?.schemaVersion === STEP8_RUN_SCHEMA;
  assert(step8 || ![FAST24_REPAIR_VALIDATION_PURPOSE, FAST24_FINAL_ACCEPTANCE_PURPOSE].includes(scope?.runPurpose), "step8_authority_requires_its_frozen_cohort");
  assert(step8 || operations === undefined, "diagnostic_operations_require_step8");
  const paid = selected.some(slot => slot.algorithm === "C" || !slot.algorithm && slot.operation !== "constraint_check");
  assert(!paid || executePaid, "root_execute_paid_and_existing_scope_required");
  const release = await acquireCoordinatorLock(output, { version: FAST24.version, selectionSha256 }, recoverLockSha256 ?? null);
  let embeddings = suppliedEmbeddings;
  try {
    const priorSummary = await summarizeFast24(output, { write: false });
    const modules = suppliedModules ?? await loadActualProductModules(), records = modules.catalog.getMatchingCatalogRecords();
    const effortPolicy = paid ? effortPolicyForScope(scope) : readConfiguredEffortPolicy();
    const implementationSha256 = fast24RuntimeBinding(), producerSha256 = byteHash(await readFile(path.join(root, "scripts/competitions/v7/evaluation-executor.mjs")));
    if (step8) {
      const frozenScope = await json(path.join(output, "execution-scope.json"));
      assert(canonicalHash(scope) === canonicalHash(frozenScope) && implementationSha256 === scope.fast24BehaviorImplementationSha256 &&
        runtimeConfigurationHash() === scope.executionRuntimeConfigurationSha256 && records.length === 45 &&
        canonicalHash(records) === scope.candidatePoolSha256 && process.env.SAITU_V7_SOURCE_SHA256 === scope.applicationRuntimeSourceSha256,
      "step8_runtime_source_or_cohort_changed");
      await assertStep8Dispatch(root, { prepared, scope, summary: priorSummary, selected, stage: step8Stage, waveReview, operations });
      if (scope.runPurpose === FAST24_FINAL_ACCEPTANCE_PURPOSE) await verifyStep8FinalPrerequisites(root, prepared, scope);
    }
    if (paid) await verifyLiveScope(modules, scope);
    // An original or a durable intent belongs to this run even after an error.
    const unstarted = new Set(priorSummary.slots.filter(slot => slot.status === "not_run" && !slot.original).map(slot => slot.slotId));
    const scheduled = step8 ? selected.filter(slot => unstarted.has(slot.slotId)) : selected;
    await mkdir(path.join(output, "invocations"), { recursive: true, mode: 0o700 });
    if (scheduled.some(slot => slot.algorithm === "B") && !embeddings) {
      const { createIsolatedLocalE5 } = await import("./evaluation-local-e5.mjs"); embeddings = await createIsolatedLocalE5({ cacheDir: e5Cache });
    }
    const trace = path.join(output, `scheduling-${randomUUID()}.jsonl`); let checkpointVersion = 0;
    const cSlots = manifest.slots.filter(slot => slot.algorithm === "C"), cEvidence = new Map();
    let earlyStopDecision = null;
    if (earlyStop) {
      assert(earlyStop.enabled === true, "explicit_early_stop_enable_required");
      await Promise.all(cSlots.map(async slot => {
        const key = canonicalHash(identityFor(selectionSha256, slot));
        const filename = path.join(output, "invocations", `${key}.json`);
        if (await exists(filename)) cEvidence.set(slot.slotId, fast24CSlotEvidence(slot, await json(filename)));
      }));
    }
    const checkEarlyStop = async () => {
      if (!earlyStop || earlyStopDecision?.stop) return earlyStopDecision;
      const confirmedCritical = [];
      if (earlyStop.reviewSignalPath && await exists(path.resolve(root, earlyStop.reviewSignalPath))) {
        const signal = await json(path.resolve(root, earlyStop.reviewSignalPath));
        assert(signal.schemaVersion === "saitu.fast24.early-stop-review.v1" && signal.selectionSha256 === selectionSha256 &&
          signal.implementationSha256 === implementationSha256 && signal.independent === true &&
          typeof signal.reviewer === "string" && signal.reviewer.length > 0 && Array.isArray(signal.confirmedCritical), "early_stop_review_identity_changed");
        for (const finding of signal.confirmedCritical) {
          const slot = manifest.slots.find(row => row.slotId === finding.slotId);
          assert(slot && finding.confirmed === true && ["fact", "attribution", "correction", "isolation", "constraint"].includes(finding.kind), "early_stop_critical_not_independently_confirmed");
          const filename = originalPath(output, finding.original), originalBytes = await readFile(filename);
          const key = canonicalHash(identityFor(selectionSha256, slot));
          assert(path.resolve(filename) === path.join(output, "invocations", `${key}.json`) && byteHash(originalBytes) === finding.original.sha256,
            "early_stop_critical_original_binding_changed");
          confirmedCritical.push({ slotId: finding.slotId, kind: finding.kind, original: finding.original });
        }
      }
      const decision = assessFast24EarlyStop({ slots: cSlots, evidence: [...cEvidence.values()], confirmedCritical });
      if (decision.stop) {
        earlyStopDecision = { ...decision, at: new Date().toISOString(), selectionSha256, implementationSha256 };
        appendFileSync(trace, JSON.stringify({ type: "acceptance_early_stop", ...earlyStopDecision }) + "\n", { mode: 0o600 });
      }
      return decision;
    };
    const queue = await runAdaptiveSlotQueue(scheduled, { ...(sampleResources ? { sampleResources } : {}), shouldStopOnError: () => true,
      onEvent: event => appendFileSync(trace, JSON.stringify({ ...event, selectionSha256, phase,
        ...(step8 ? { stage: step8Stage, slotId: scheduled[event.slotIndex]?.slotId, operations } : {}) }) + "\n", { mode: 0o600 }),
      run: async (slot, _index, feedback) => {
        const before = await checkEarlyStop();
        if (before?.stop) return { kind: "not_run", stopScheduling: true, reason: before.reason };
        const inherited = inheritedFor(manifest, slot);
        if (inherited) return { kind: "completed", value: await json(originalPath(output, inherited.original)) };
        const outcome = await checkpointInvocation(path.join(output, "invocations"), identityFor(selectionSha256, slot), async journal => {
        const result = await execute(rows.find(row => row.caseId === slot.caseId), { modules, records, asOf: inputs.product.asOf,
          freezeBinding: { fast24SelectionSha256: selectionSha256, implementationSha256 }, producerSha256,
          executionRuntimeConfigurationSha256: scope?.executionRuntimeConfigurationSha256 ?? runtimeConfigurationHash(),
          algorithm: slot.algorithm, repetition: slot.repetition, seed: manifest.seed, embeddingProvider: embeddings, journal,
          userActionWindows: true,
          effortPolicy, executionMode: paid ? scope.executionMode : "finite", maxHttp: paid ? null : 1,
          maxReserveMicros: paid ? null : 1, onCapacityFeedback: feedback });
        const ids = result.observation.reservationIds;
        const ledgerRows = ids.length ? (await modules.database.getPool().query("select id,run_id,phase,operation,state,reserved_micros::text,charged_micros::text,input_tokens,output_tokens,cached_input_tokens from ai_spend_ledger where id=any($1::uuid[])", [ids])).rows : [];
          return { ...result, executionScope: scope ?? null, ledgerRows };
        });
        if (slot.algorithm === "C" && outcome.value?.observation) cEvidence.set(slot.slotId, fast24CSlotEvidence(slot, outcome.value));
        const after = await checkEarlyStop();
        if (after?.stop) return { ...outcome, stopScheduling: true, reason: after.reason };
        return outcome.value?.observation.execution?.budgetExhausted ? { ...outcome, stopScheduling: true, reason: "production_budget_stop" } : outcome;
      // Every original/journal is already durable. Avoid repeatedly parsing all large receipts in model deadline windows.
      }, onCheckpoint: () => ++checkpointVersion % 10 ? Promise.resolve() : summarizeFast24(output) });
    const summary = await summarizeFast24(output, { review }); return { output, phase, selectedSlots: selected.length, recordedOriginals: summary.recordedOriginals,
      ...(step8 ? { unstartedSlotsAtLaunch: scheduled.length, ...(operations !== undefined ? { operations } : {}) } : {}),
      completedCReports: summary.completedCReports, coordinatorFailures: queue.failures, statuses: summary.statuses, qualityAcceptance: summary.independentQualityAcceptance,
      stopReason: queue.stopReason, earlyStop: earlyStopDecision };
  } finally { if (!suppliedEmbeddings) await embeddings?.dispose(); await release(); }
}

/** Reviewer gets no algorithm, trace, candidate diagnostics, or allocation key. No new calls. */
export async function exportBlindPackets(output = FAST24.output) {
  const { output: directory, manifest, selectionSha256, rows } = await readFast24(output), summary = await summarizeFast24(directory), packets = [];
  for (const pair of manifest.blindPairsPrivateAllocation) {
    const sides = [];
    for (const id of [pair.leftSlotId, pair.rightSlotId]) {
      const slot = summary.slots.find(row => row.slotId === id); assert(slot?.original, "blind_pair_original_not_recorded");
      const result = await json(originalPath(directory, slot.original));
      const anonymize = value => JSON.parse(JSON.stringify(value).replaceAll("本地基线", "本方法"));
      const common = ["itemId", "name", "trackLabel", "seriesId", "reasons", "coreTask", "currentRole", "gaps", "values", "difficulty", "opportunityCost", "nextStep", "checkpoint", "sources", "evidenceFacts"];
      sides.push({ status: result.observation.status, shortfallReason: result.observation.output?.shortlistShortfallReason ?? result.observation.output?.shortfallReason ?? null,
        items: result.observation.output?.recommendations?.map(item => anonymize(Object.fromEntries(common.filter(key => item[key] !== undefined).map(key => [key, item[key]])))) ?? [] });
    }
    packets.push({ pairId: pair.pairId, taskGroup: pair.taskGroup, input: rows.find(row => row.caseId === pair.caseId).input, left: sides[0], right: sides[1] });
  }
  const destination = path.join(directory, "blind-packets.json");
  await writeNewJson(destination, { schemaVersion: "saitu.fast24-blind-packets.v1", selectionSha256, pairs: packets });
  return { output: destination, pairs: packets.length, additionalProviderCalls: 0 };
}

async function main() {
  const [command, ...args] = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]; assert(["--output", "--phase", "--slots", "--scope", "--review", "--authorization-policy", "--execute-paid", "--e5-cache", "--recover-lock-sha256"].includes(flag) && !Object.hasOwn(options, flag), "invalid_option");
    options[flag] = flag === "--execute-paid" ? true : args[++index]; assert(options[flag], "option_value_required");
  }
  const output = options["--output"] ?? FAST24.output;
  if (["run", "scope"].includes(command)) { const { loadEnvConfig } = (await import("@next/env")).default; loadEnvConfig(root); }
  if (command === "prepare") console.log(JSON.stringify(await prepareFast24({ output })));
  else if (command === "scope") console.log(JSON.stringify(await createFast24Scope({ output: options["--output"], authorizationPolicy: options["--authorization-policy"] })));
  else if (command === "summary") { const result = await summarizeFast24(output, { review: options["--review"] }); console.log(JSON.stringify({ ...result, slots: undefined })); }
  else if (command === "blind") console.log(JSON.stringify(await exportBlindPackets(output)));
  else if (command === "run") {
    console.log(JSON.stringify(await runFast24({ output, phase: options["--phase"] ?? "constraints", executePaid: options["--execute-paid"] === true,
      slotIds: options["--slots"]?.split(","), scope: options["--scope"] ? await json(options["--scope"]) : undefined,
      e5Cache: options["--e5-cache"], recoverLockSha256: options["--recover-lock-sha256"], review: options["--review"] })));
  } else throw new Error("usage: fast24.mjs prepare|run|summary|blind|scope [--output PATH] [--phase constraints|product|ranking|all] [--scope FILE --execute-paid]");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
