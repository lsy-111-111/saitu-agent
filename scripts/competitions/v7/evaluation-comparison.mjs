import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { POLICY_VERSION, POLICY_SHA256, TASK_GROUPS, canonicalHash, isHash, isTime, isUint32, same, requirePolicy,
  assertRankingGroups, assertUnique, jsonPointer, readBoundJson, readBoundBytes, writeNewJson } from "./evaluation-policy.mjs";
import { inspectFreezeBinding, loadRankingReuse, isVerifiedRankingReuse } from "./evaluation-reuse.mjs";
import { preflightScoringRegistration } from "./evaluation-registration.mjs";
import { readPublicEvaluationJson } from "./evaluation-development-exclusions.mjs";
import { validateExecutionScope } from "./evaluation-runtime.mjs";
import { validateEvaluationRuntime, effortPolicyForScope, assertSameEffortPolicy, assertLedgerEffort, assertDispatchEffort } from "./evaluation-effort.mjs";
import { inspectPilotSavedCall } from "./pilot-contract.mjs";
const { pairedFamilyBootstrap } = createRequire(import.meta.url)("../v6/evaluate-rankings.ts");

export const COMPARISON_SELECTION = "reuse_formal_B_C_report_quality_and_comprehension";
export const COMPREHENSION_COST_PHASE = "calibration";
export const COMPREHENSION_COST_PURPOSE = "simulation_comprehension";
export const COMPARISON_QUALITY_DIMENSIONS = Object.freeze(["personal_task_fit", "actionable_next_step", "unresolved_conditions_honesty", "evidence_clarity"]);
export const COMPREHENSION_QUESTIONS = Object.freeze([
  { id: "contribution", question: "根据这份报告，我可以承担哪项具体任务？" },
  { id: "next_step", question: "报告建议我先做什么？" },
  { id: "unresolved_conditions", question: "哪些条件仍未落实，或者报告没有交代？" },
]);
const policy = { policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256 };
const demand = (ok, message) => { if (!ok) throw new Error(message); };
const text = value => typeof value === "string" && value.trim().length > 0;
const identityFields = ["profileId", "caseId", "familyId", "taskGroup", "inputSha256"];
const verifiedCollections = new WeakMap(), verifiedCosts = new WeakMap();
const identity = row => Object.fromEntries(identityFields.map(key => [key, row[key]]));
const unitKey = row => `${row.comparisonId}:${row.side}`;
const choose = (seed, label, value) => canonicalHash([seed, label, value]);

/** This sees public identities only. Freeze it before the formal report opening. */
export function prepareComparisonPlan({ profiles, seed, frozenAt, freezeBinding, coordinatorContextId, blockedContextIds }) {
  assertRankingGroups(profiles); inspectFreezeBinding(freezeBinding);
  demand(isUint32(seed) && isTime(frozenAt) && text(coordinatorContextId) && Array.isArray(blockedContextIds) && blockedContextIds.every(text), "comparison_prefrozen_seed_time_and_independence_required");
  for (const row of profiles) demand(Object.keys(row).sort().join(",") === [...identityFields].sort().join(",") && isHash(row.inputSha256), "comparison_public_identity_metadata_only");
  const metadata = profiles.map(identity).sort((a, b) => a.profileId.localeCompare(b.profileId));
  const selected = TASK_GROUPS.flatMap(group => metadata.filter(row => row.taskGroup === group).sort((a, b) => choose(seed, "family", a.familyId).localeCompare(choose(seed, "family", b.familyId))).slice(0, 10));
  const pairs = selected.map((row, index) => ({ ...row, comparisonId: `comparison-${String(index + 1).padStart(2, "0")}`,
    repetition: Number.parseInt(choose(seed, "repetition", row.profileId).slice(0, 8), 16) % 5,
    armOrder: Number.parseInt(choose(seed, "arm-order", row.profileId).slice(0, 8), 16) % 2 ? ["C", "B"] : ["B", "C"] }));
  return { schemaVersion: "saitu.report-comparison-plan.v7.1", ...policy, selection: COMPARISON_SELECTION, frozenAt, seed, freezeBinding,
    coordinatorContextId, blockedContextIds: [...new Set([coordinatorContextId, ...blockedContextIds])].sort(), publicProfiles: metadata,
    profileMetadataSha256: canonicalHash(metadata), denominator: 60, reports: 120, pairs, qualityDimensions: COMPARISON_QUALITY_DIMENSIONS,
    qualityScale: { minimum: 0, maximum: 3, meaning: ["absent_or_unusable", "limited", "usable_with_qualification", "clear_and_usable"] },
    comprehensionQuestions: COMPREHENSION_QUESTIONS, additionalRecommendationPaidInvocations: 0, actualParticipants: 0,
    failuresRemainInDenominator: true, independentUIFlowsAndPerformanceRequired: true, productAcceptance: false };
}
export function validateComparisonPlan(plan) {
  requirePolicy(plan);
  const expected = prepareComparisonPlan({ profiles: plan.publicProfiles, seed: plan.seed, frozenAt: plan.frozenAt, freezeBinding: plan.freezeBinding,
    coordinatorContextId: plan.coordinatorContextId, blockedContextIds: plan.blockedContextIds });
  demand(same(expected, plan), "comparison_frozen_selection_or_rubric_changed"); return plan;
}

/** Exact original outputs are copied; no missing report is regenerated or replaced. */
export function collectComparisonReports(plan, ranking) {
  validateComparisonPlan(plan);
  demand(isVerifiedRankingReuse(ranking), "comparison_raw_formal_B_C_originals_required");
  demand(same(plan.freezeBinding, ranking.matrix.freezeBinding) && Date.parse(plan.frozenAt) <= Date.parse(ranking.opening.openedAt), "comparison_plan_must_precede_report_opening_and_match_registration");
  const matrix = ranking.matrix;
  const pairs = plan.pairs.map(selection => {
    const profile = matrix.profileSnapshot.profiles.find(row => row.profileId === selection.profileId);
    demand(profile && same(identity({ ...profile, inputSha256: canonicalHash(profile.input) }), identity(selection)), "comparison_frozen_profile_input_changed");
    const reports = selection.armOrder.map((algorithm, index) => {
      const observation = matrix.observations.find(row => row.profileId === selection.profileId && row.repetition === selection.repetition && row.algorithm === algorithm);
      demand(observation, "comparison_missing_formal_slot_no_regeneration");
      return { side: index === 0 ? "A" : "B", algorithm, invocationId: observation.invocationId, observationSha256: canonicalHash(observation),
        reportSha256: observation.outputSha256, report: observation.output, status: observation.status, fallback: observation.fallback };
    });
    return { ...selection, profileInput: profile.input, reports };
  });
  const collection = { schemaVersion: "saitu.report-comparison-originals.v7.1", ...policy, plan, planSha256: canonicalHash(plan),
    freezeManifestSha256: ranking.freezeManifestSha256, pairs, denominator: 60, originalReports: 120, additionalRecommendationPaidInvocations: 0,
    originalPaidReservationIds: [...new Set(matrix.observations.flatMap(row => row.reservationIds))].sort(),
    runtime: ranking.registration.config.runtime, rankingRawOriginalBytesVerified: true, applicabilityPreflightVerified: false, rawOriginalBytesVerified: false, actualParticipants: 0, productAcceptance: false,
    blindingLimit: "arm_identity_hidden_in_packets_report_shape_may_still_reveal_the_arm" };
  return collection;
}
export function isVerifiedComparisonCollection(collection) {
  const state = verifiedCollections.get(collection);
  return Boolean(state && state.hash === canonicalHash(collection) && isVerifiedRankingReuse(state.ranking));
}
/** Give each fresh simulated reader one side only, without reference answers. */
export function comparisonReaderPackets(collection) {
  return collection.pairs.flatMap(pair => pair.reports.map(report => ({ schemaVersion: "saitu.simulated-reader-packet.v7.1", ...policy,
    comparisonId: pair.comparisonId, side: report.side, profileInput: pair.profileInput, report: report.report, reportSha256: report.reportSha256,
    status: report.status, questions: COMPREHENSION_QUESTIONS, actualParticipants: 0, evidenceClass: "simulated_ai_not_real_student" })));
}
function evidence(entries, pair, report, response) {
  demand(Array.isArray(entries) && entries.length > 0, "comparison_bound_text_evidence_required");
  for (const entry of entries) {
    const source = entry.target === "report" ? report.report : entry.target === "profile" ? pair.profileInput : entry.target === "response" ? response : undefined;
    demand(source !== undefined && canonicalHash(jsonPointer(source, entry.pointer)) === entry.valueSha256, "comparison_evidence_pointer_or_value_changed");
  }
}
const uniqueRows = (rows, label) => { demand(Array.isArray(rows), `comparison_${label}_array_required`); assertUnique(rows.map(unitKey), `comparison_duplicate_${label}_unit`); return new Map(rows.map(row => [unitKey(row), row])); };

/** Derives descriptive paired outcomes. Numerical formal quality gates are unchanged. */
export function scoreComparisonRecords(collection, assessment, { costsVerified = false } = {}) {
  requirePolicy(collection); validateComparisonPlan(collection.plan); requirePolicy(assessment);
  demand(assessment.schemaVersion === "saitu.report-comparison-assessment.v7.1" && assessment.collectionSha256 === canonicalHash(collection), "comparison_assessment_must_bind_original_collection");
  const references = uniqueRows(assessment.references, "reference"), responses = uniqueRows(assessment.responses, "response"), judgments = uniqueRows(assessment.judgments, "judgment");
  const expectedKeys = new Set(collection.pairs.flatMap(pair => pair.reports.map(report => `${pair.comparisonId}:${report.side}`)));
  for (const rows of [references, responses, judgments]) demand([...rows.keys()].every(key => expectedKeys.has(key)), "comparison_foreign_assessment_unit");
  const blocked = new Set(collection.plan.blockedContextIds), results = [], readerContexts = new Set(); let paidSimulationCalls = 0, simulationAccountingMicros = 0, uncertainSimulationCosts = 0;
  for (const pair of collection.pairs) for (const report of pair.reports) {
    const key = `${pair.comparisonId}:${report.side}`, reference = references.get(key), response = responses.get(key), judgment = judgments.get(key);
    const available = report.status === "observed" && report.report !== null && report.fallback === false;
    const result = { comparisonId: pair.comparisonId, familyId: pair.familyId, taskGroup: pair.taskGroup, side: report.side, algorithm: report.algorithm,
      available, quality: 0, comprehension: 0, assessed: false, status: available ? "pending" : "original_report_unavailable" };
    if (!available) { results.push(result); continue; }
    if (!reference || !response || !judgment) { results.push(result); continue; }
    demand(text(reference.contextId) && !blocked.has(reference.contextId) && reference.reportSha256 === report.reportSha256 && isTime(reference.preparedAt), "independent_report_reference_required");
    demand(same(Object.keys(reference.quality).sort(), [...COMPARISON_QUALITY_DIMENSIONS].sort()), "comparison_complete_frozen_quality_dimensions_required");
    for (const dimension of COMPARISON_QUALITY_DIMENSIONS) {
      const row = reference.quality[dimension]; demand(Number.isInteger(row.value) && row.value >= 0 && row.value <= 3 && text(row.reason), "comparison_quality_score_and_reason_required"); evidence(row.evidence, pair, report);
    }
    demand(Array.isArray(reference.questions) && reference.questions.length === 3 && same(reference.questions.map(row => row.id), COMPREHENSION_QUESTIONS.map(row => row.id)), "comparison_three_prefrozen_comprehension_references_required");
    for (const question of reference.questions) { demand(text(question.expectedAnswer), "comparison_expected_answer_required"); evidence(question.evidence, pair, report); }
    demand(text(response.contextId) && !blocked.has(response.contextId) && response.contextId !== reference.contextId && !readerContexts.has(response.contextId) && response.freshContext === true &&
      response.blindToArm === true && response.otherArmRead === false && response.referenceAnswersRead === false && response.evidenceClass === "simulated_ai_not_real_student" &&
      response.referenceSha256 === canonicalHash(reference) && response.reportSha256 === report.reportSha256 && isTime(response.openedAt) && isTime(response.sealedAt) &&
      Date.parse(reference.preparedAt) <= Date.parse(response.openedAt) && Date.parse(response.openedAt) <= Date.parse(response.sealedAt), "fresh_blind_simulated_reader_and_reference_timeline_required");
    readerContexts.add(response.contextId);
    demand(["observed", "failed", "indeterminate", "not_run"].includes(response.status), "comparison_original_simulation_status_required");
    const accounting = response.accounting;
    if (accounting?.kind === "work_context") demand(accounting.paidCalls === 0 && accounting.accountingMicros === 0 && accounting.providerInvoiceCny === null && response.model === "gpt-6.1-sol" && response.reasoningEffort === "max", "work_context_simulation_cannot_claim_provider_spend_or_human_effect");
    else {
      demand(accounting?.kind === "metered_provider" && accounting.originals && isHash(accounting.originals.sha256), "separate_simulation_original_cost_binding_required");
      if (!costsVerified) { result.status = "simulation_cost_originals_pending"; results.push(result); continue; }
      const cost = verifiedCosts.get(assessment)?.rows.get(key); demand(cost, "actual_separate_simulation_cost_originals_required");
      paidSimulationCalls += cost.calls; simulationAccountingMicros += cost.accountingMicros; uncertainSimulationCosts += Number(cost.uncertain);
    }
    result.quality = COMPARISON_QUALITY_DIMENSIONS.reduce((sum, dimension) => sum + reference.quality[dimension].value, 0) / COMPARISON_QUALITY_DIMENSIONS.length;
    if (response.status !== "observed") { result.assessed = true; result.status = response.status; results.push(result); continue; }
    demand(Array.isArray(response.answers) && response.answers.length === 3 && same(response.answers.map(row => row.id), COMPREHENSION_QUESTIONS.map(row => row.id)) && response.answers.every(row => text(row.text)), "comparison_complete_simulated_answers_required");
    demand(judgment.contextId === reference.contextId && judgment.responseSha256 === canonicalHash(response) && judgment.referenceSha256 === canonicalHash(reference) && isTime(judgment.reviewedAt) &&
      Date.parse(response.sealedAt) <= Date.parse(judgment.reviewedAt) && Array.isArray(judgment.answers) && judgment.answers.length === 3 && same(judgment.answers.map(row => row.id), COMPREHENSION_QUESTIONS.map(row => row.id)), "independent_comprehension_judgment_must_bind_sealed_response");
    for (const answer of judgment.answers) { demand(typeof answer.correct === "boolean" && text(answer.reason), "comparison_answer_judgment_required"); evidence(answer.evidence, pair, report, response); }
    result.comprehension = judgment.answers.filter(row => row.correct).length / 3; result.assessed = true; result.status = "assessed"; results.push(result);
  }
  const summaries = ["B", "C"].map(algorithm => {
    const rows = results.filter(row => row.algorithm === algorithm); demand(rows.length === 60, "comparison_all_sixty_pairs_must_remain_in_denominator");
    return { algorithm, denominator: 60, assessed: rows.filter(row => row.assessed).length, unavailableReports: rows.filter(row => !row.available).length,
      qualityMean: rows.reduce((sum, row) => sum + row.quality, 0) / 60, comprehensionAccuracy: rows.reduce((sum, row) => sum + row.comprehension, 0) / 60 };
  });
  const paired = metric => pairedFamilyBootstrap(results.filter(row => row.algorithm === "C").map(row => ({ familyId: row.familyId, value: row[metric] })),
    results.filter(row => row.algorithm === "B").map(row => ({ familyId: row.familyId, value: row[metric] })), 2000, collection.plan.seed);
  const incomplete = results.filter(row => row.available && !row.assessed).length;
  return { schemaVersion: "saitu.report-comparison-result.v7.1", ...policy, selection: COMPARISON_SELECTION, denominator: 60, originalReports: 120,
    additionalRecommendationPaidInvocations: 0, results, summaries, pairedCMinusB: { quality: paired("quality"), comprehension: paired("comprehension") },
    incompleteUnits: incomplete, actualParticipants: 0, additionalSimulationPaidCalls: paidSimulationCalls, simulationAccountingMicros,
    uncertainSimulationCostUnits: uncertainSimulationCosts, providerInvoiceCny: null, rawOriginalBytesVerified: false, status: "fixture_or_unverified_originals_only", numericalFormalQualityGatesChanged: false,
    UIAndPerformanceAcceptance: false, productAcceptance: false, evidenceLimit: "simulated_report_quality_and_comprehension_not_real_student_effect" };
}

export function validateSimulationCostScope(original, runtime) {
  demand(original?.purpose === COMPREHENSION_COST_PURPOSE, "separate_simulation_comprehension_purpose_required");
  const scope = validateExecutionScope(original.executionScope, { allowedPhases: [COMPREHENSION_COST_PHASE] });
  assertSameEffortPolicy(effortPolicyForScope(scope), validateEvaluationRuntime(runtime)); return scope;
}
async function verifySimulationCosts(evidenceRoot, assessment, collection) {
  const rows = new Map(), reservations = new Set(collection.originalPaidReservationIds);
  for (const response of assessment.responses) {
    if (response.accounting?.kind !== "metered_provider") continue;
    const original = (await readBoundJson(evidenceRoot, response.accounting.originals)).value, scope = validateSimulationCostScope(original, collection.runtime);
    const policy = effortPolicyForScope(scope);
    await readBoundBytes(evidenceRoot, scope.authorizationPolicySnapshot);
    const calls = original.calls, ledger = original.ledgerRows;
    demand(Array.isArray(calls) && calls.length === 1 && Array.isArray(ledger) && ledger.length === 1, "one_separately_metered_simulation_response_original_required");
    const call = calls[0], row = ledger[0], saved = inspectPilotSavedCall(call.originalReceipt), result = call.originalReceipt?.result;
    demand(saved.valid && (response.status === "observed" ? saved.responseObserved && !saved.uncertain && result?.ok === true && same(result.data, { answers: response.answers }) : result?.ok === false) &&
      call.reservationId === row.id && !reservations.has(row.id) && row.run_id === scope.runId && row.phase === COMPREHENSION_COST_PHASE && row.model === "deepseek-flash" && row.operation === "competition_v7_chat", "simulation_response_or_separate_ledger_scope_changed");
    assertLedgerEffort(row, policy);
    const dispatched = Boolean(call.dispatch);
    if (dispatched) { assertDispatchEffort(call.dispatch, policy); demand(call.dispatch.reservationId === row.id && call.dispatch.operation === row.operation, "simulation_dispatch_original_ledger_changed"); }
    const accountingMicros = Number(row.charged_micros ?? row.reserved_micros);
    demand(Number.isSafeInteger(accountingMicros) && accountingMicros >= 0 && ["usage_estimated", "conservative", "reserved", "cancelled"].includes(row.state) &&
      (saved.upstreamAttempted === true ? dispatched : !dispatched) && (row.state !== "cancelled" || accountingMicros === 0 && saved.upstreamAttempted === false), "actual_simulation_dispatch_and_usage_or_protected_hold_required");
    reservations.add(row.id); rows.set(unitKey(response), { calls: Number(dispatched), accountingMicros, uncertain: saved.uncertain || row.charged_micros === null || row.state === "reserved" });
  }
  verifiedCosts.set(assessment, { hash: canonicalHash(assessment), rows });
}
export async function scoreComparisonOriginals(collection, assessment, { evidenceRoot }) {
  demand(isVerifiedComparisonCollection(collection), "comparison_original_report_proof_missing_or_changed");
  await verifySimulationCosts(evidenceRoot, assessment, collection);
  const result = scoreComparisonRecords(collection, assessment, { costsVerified: true });
  demand(verifiedCosts.get(assessment)?.hash === canonicalHash(assessment) && isVerifiedComparisonCollection(collection), "comparison_originals_changed_during_scoring");
  result.rawOriginalBytesVerified = true; result.status = result.incompleteUnits ? "incomplete_original_slots_retained" : result.results.some(row => !row.available || row.status !== "assessed") ? "simulated_comparison_completed_with_original_failures" : "simulated_comparison_completed_requires_other_product_gates";
  return result;
}
export async function loadComparisonOriginals({ evidenceRoot, registration, plan: planReference, directory, freezeManifestSha256 }) {
  // The actual public applicability/adoption preflight precedes every private read.
  const preflight = await preflightScoringRegistration({ evidenceRoot, reference: registration });
  const plan = validateComparisonPlan((await readPublicEvaluationJson(evidenceRoot, planReference)).value);
  demand(plan.freezeBinding.registrationSha256 === preflight.registrationSha256, "comparison_registration_differs_from_public_preflight");
  const ranking = await loadRankingReuse({ directory, freezeManifestSha256, expectedBinding: plan.freezeBinding });
  demand(same(ranking.registration, preflight.registration), "comparison_actual_registration_changed");
  const collection = collectComparisonReports(plan, ranking);
  collection.applicabilityPreflightVerified = true; collection.rawOriginalBytesVerified = true;
  verifiedCollections.set(collection, { hash: canonicalHash(collection), ranking }); return collection;
}

function options(argv) {
  const result = {}, flags = new Set(["--prepare", "--collect", "--score", "--open"]), names = new Set(["--evidence-root", "--input", "--input-sha256", "--registration", "--registration-sha256", "--plan", "--plan-sha256", "--ranking-run", "--freeze-manifest-sha256", "--assessment", "--assessment-sha256", "--output"]);
  for (let index = 0; index < argv.length; index++) { const key = argv[index]; demand((flags.has(key) || names.has(key)) && result[key] === undefined, "unknown_or_duplicate_comparison_option"); result[key] = flags.has(key) ? true : argv[++index]; demand(result[key] !== undefined, "comparison_option_value_required"); }
  demand(["--prepare", "--collect", "--score"].filter(key => result[key]).length === 1 && result["--output"], "one_comparison_mode_and_new_output_required"); return result;
}
async function main() {
  const cli = options(process.argv.slice(2)), evidenceRoot = path.resolve(cli["--evidence-root"] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
  const reference = (name, hash) => ({ path: path.isAbsolute(cli[name]) ? path.relative(evidenceRoot, cli[name]) : cli[name], sha256: cli[hash] });
  if (cli["--prepare"]) {
    demand(cli["--input"] && cli["--input-sha256"] && !cli["--open"], "comparison_preparation_public_metadata_only");
    const prepared = prepareComparisonPlan((await readPublicEvaluationJson(evidenceRoot, reference("--input", "--input-sha256"))).value);
    await writeNewJson(cli["--output"], prepared); console.log(JSON.stringify({ denominator: 60, additionalRecommendationPaidInvocations: 0, executed: false })); return;
  }
  demand(cli["--open"] && ["--registration", "--registration-sha256", "--plan", "--plan-sha256", "--ranking-run", "--freeze-manifest-sha256"].every(key => cli[key]), "comparison_explicit_open_and_registered_originals_required");
  if (cli["--score"]) demand(cli["--assessment"] && cli["--assessment-sha256"], "comparison_bound_assessment_original_required");
  const collection = await loadComparisonOriginals({ evidenceRoot, registration: reference("--registration", "--registration-sha256"), plan: reference("--plan", "--plan-sha256"), directory: cli["--ranking-run"], freezeManifestSha256: cli["--freeze-manifest-sha256"] });
  const result = cli["--collect"] ? { collection, readerPackets: comparisonReaderPackets(collection) } : await scoreComparisonOriginals(collection,
    (await readBoundJson(evidenceRoot, reference("--assessment", "--assessment-sha256"))).value, { evidenceRoot });
  await writeNewJson(cli["--output"], result); console.log(JSON.stringify({ denominator: 60, additionalRecommendationPaidInvocations: 0, providerCallsExecutedByTool: 0, productAcceptance: false }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
