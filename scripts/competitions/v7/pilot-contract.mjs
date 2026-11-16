import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBoundProviderDispatch } from './evaluation-dispatch-evidence.mjs';
import { EVALUATION_POLICY, POLICY_VERSION, POLICY_SHA256 } from './evaluation-policy.mjs';
import { TOP5_EFFORT_GRANT_VERSION, effortPolicyForScope, requireTop5EvaluationRuntime, evaluationRuntimeForEffort, assertLedgerEffort, assertCallEffort, assertDispatchEffort, callOperation, rankNonThinkingContinuationForScope } from './evaluation-effort.mjs';
import { USER_UNBOUNDED_EXECUTION_MODE, USER_UNBOUNDED_GRANT_VERSION, USER_UNBOUNDED_EXECUTION_LIMITS } from '../../../src/lib/ai/execution-policy.mjs';
import { ADAPTIVE_EXECUTION_POLICY } from '../../lib/adaptive-execution.mjs';
import { verifyRankNonThinkingContinuationScope } from './rank-nonthinking-pilot-proof.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const CASES_PATH = path.join(ROOT, 'scripts/competitions/v7/pilot-public-fictional-cases.json');
export const SCHEMA = 'saitu.pilot-registration.v7.1';
export const COMPARISON_60_SELECTION = 'reuse_formal_B_C_report_quality_and_comprehension';
export const GROUPS = ['software_data', 'engineering_design', 'experimental_agriculture', 'business_practice', 'survey_education', 'arts_language'];
export const SCENARIOS = ['followup', 'refresh', 'correction', 'stale_poll_correction', 'poll_disconnect', 'poll_delay'];
export const PIN_KEYS = ['implementationSha256', 'runtimeSourceBindingSha256', 'runtimeConfigurationSha256', 'executionRuntimeConfigurationSha256', 'catalogSha256', 'candidatePoolSha256', 'harnessSha256', 'planSha256'];
export const OWNED_FILES = ['scripts/competitions/v7/pilot-contract.mjs', 'scripts/competitions/v7/pilot-executor.mjs',
  'scripts/competitions/v7/pilot-public-fictional-cases.json', 'scripts/competitions/v7/pilot-executor.test.mjs', 'tests/e2e/v7-pilot-browser.mjs'];
export const assert = (ok, why) => { if (!ok) throw new Error(why); };
export const byteHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const isHash = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, ordered(value[k])])) : value;
export const canonicalHash = value => byteHash(JSON.stringify(ordered(value)));
export const binding = async filename => ({ path: path.resolve(filename), sha256: byteHash(await readFile(filename)) });
export async function boundBytes(ref) {
  assert(ref && path.isAbsolute(ref.path) && isHash(ref.sha256), 'absolute_original_byte_binding_required');
  const bytes = await readFile(ref.path); assert(byteHash(bytes) === ref.sha256, 'bound_original_bytes_changed'); return bytes;
}
export async function writeNew(filename, value) { await writeFile(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return binding(filename); }
export async function harnessBindings() { return Promise.all(OWNED_FILES.map(name => binding(path.join(ROOT, name)))); }
export function validateCases(document) {
  assert(document.schemaVersion === 'saitu.pilot-public-fictional-cases.v7.1' && document.origin === 'new_public_fictional_ui_trial_inputs_not_formal_ranking_profiles' && document.actualParticipants === 0 && document.comparison60Selection === COMPARISON_60_SELECTION, 'public_fictional_pilot_only');
  assert(document.cases?.length === 12 && new Set(document.cases.map(c => c.caseId)).size === 12, 'exactly_twelve_unique_pilot_slots');
  for (const group of GROUPS) assert(document.cases.filter(c => c.taskGroup === group).length === 2, 'two_public_cases_per_group');
  assert(document.cases.filter(c => c.viewport === 'mobile').length === 6 && document.cases.filter(c => c.viewport === 'desktop').length === 6, 'six_mobile_six_desktop');
  for (const c of document.cases) {
    assert(c.fictional === true && /^fictional-pilot-\d{2}$/.test(c.caseId) && SCENARIOS.includes(c.scenario), 'fictional_id_and_journey_required');
    assert(typeof c.stage === 'string' && typeof c.weekly === 'string' && typeof c.skill === 'string' && Number.isSafeInteger(c.budget) && c.budget >= 0 && c.budget <= 500, 'supported_public_questionnaire_values_required');
    if (c.scenario === 'followup') assert(c.followup?.trim() && !c.correction, 'explicit_followup_required');
    if (c.scenario.includes('correction')) assert(c.correction?.text?.trim() && c.correction.field === 'budget.maximumYuan' && Number.isSafeInteger(c.correction.value) && c.correction.value >= 0 && c.correction.value !== c.budget, 'unambiguous_changed_budget_required');
  }
  for (const scenario of SCENARIOS) assert(document.cases.filter(c => c.scenario === scenario).length === 2, 'two_cases_of_every_registered_journey');
  return document;
}
export function validateConfig(config) {
  assert(config.schemaVersion === 'saitu.pilot-config.v7.1' && config.authorContextId === '/root' && /^[A-Za-z0-9._-]{1,100}$/.test(config.studyId), 'root_registered_pilot_identity_required');
  assert(config.comparison60Selection === COMPARISON_60_SELECTION && config.flow === 'current_v7_only' && config.performanceOverlap === false, 'frozen_B_C_report_comparison_and_separate_UI_performance_required');
  assert(config.actualParticipants === 0 && config.failuresRemainInDenominator === true && config.automaticPaidRetries === false, 'fictional_fixed_denominator_no_retry_contract');
  assert(PIN_KEYS.every(k => isHash(config.productPins?.[k])), 'all_product_source_catalog_runtime_pins_required');
  assert(config.policyVersion === POLICY_VERSION && config.policySha256 === POLICY_SHA256, 'evaluation_policy_binding_required');
  assert(config.promptVersions && ['ranking', 'explanation', 'profile', 'chat', 'chatReview'].every(k => typeof config.promptVersions[k] === 'string' && config.promptVersions[k].length), 'actual_prompt_versions_required');
  const url = new URL(config.baseUrl);
  assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'explicit_local_ui_origin_required');
  assert(path.isAbsolute(config.workerHealthFile), 'absolute_worker_health_path_required');
  if (config.serverAccountingLog !== undefined) assert(path.isAbsolute(config.serverAccountingLog?.path) && config.serverAccountingLog.format === 'competition_accounting_trace.jsonl' && config.serverAccountingLog.sourceSha256 === config.productPins.runtimeSourceBindingSha256, 'explicit_same_source_server_accounting_log_required');
  for (const field of ['nonRankingSourceSnapshot', 'rankingSourceSnapshot', 'spendAuthorization']) assert(path.isAbsolute(config[field]?.path) && isHash(config[field]?.sha256), 'source_and_original_authorization_refs_required');
  const spend = config.spend;
  const unbounded = spend?.executionMode === USER_UNBOUNDED_EXECUTION_MODE;
  assert((config.executionMode ?? spend?.executionMode ?? 'finite') === (spend?.executionMode ?? 'finite'), 'pilot_frozen_execution_mode_required');
  assert(spend?.grantVersion === (unbounded ? USER_UNBOUNDED_GRANT_VERSION : TOP5_EFFORT_GRANT_VERSION) && spend.authorizedEffort === 'stage', 'top5_frozen_stage_grant_required');
  requireTop5EvaluationRuntime(evaluationRuntimeForEffort(effortPolicyForScope(spend)), { allowRankNonThinking: Boolean(rankNonThinkingContinuationForScope(spend)) });
  assert(/^[A-Za-z0-9._-]{1,100}$/.test(spend.runId) && /^[A-Za-z0-9._-]{1,80}$/.test(spend.phase) && spend.authorizedPhase === spend.phase, 'actual_run_phase_frozen_effort_grant_required');
  assert(spend.authorizationPolicySha256 === config.spendAuthorization.sha256 && isHash(spend.effortConditionSha256), 'authorization_original_and_effort_condition_bound');
  if (unbounded) {
    assert(canonicalHash(spend.executionLimits ?? null) === canonicalHash(USER_UNBOUNDED_EXECUTION_LIMITS) &&
      spend.callLimit === null && spend.perJourneyProviderCallCap === null && spend.hardLimitMicros === null &&
      config.invocationConcurrency === 'adaptive' && canonicalHash(config.schedulingPolicy ?? null) === canonicalHash(ADAPTIVE_EXECUTION_POLICY), 'user_unbounded_pilot_requires_null_caps_and_frozen_adaptive_policy');
    assert(Number.isSafeInteger(spend.fundingLimitMicros) && spend.fundingLimitMicros >= 0, 'actual_physical_funding_snapshot_required');
  } else {
    assert(spend.executionMode === undefined || spend.executionMode === 'finite', 'pilot_execution_mode_invalid');
    assert(Number.isSafeInteger(spend.callLimit) && spend.callLimit > 0 && Number.isSafeInteger(spend.perJourneyProviderCallCap) && spend.perJourneyProviderCallCap > 0 && spend.perJourneyProviderCallCap <= spend.callLimit, 'finite_total_and_journey_call_caps_required');
    assert(Number.isSafeInteger(spend.hardLimitMicros) && spend.hardLimitMicros > 0 && Number.isSafeInteger(spend.fundingLimitMicros) && spend.fundingLimitMicros > 0, 'finite_hard_and_funding_limits_required');
  }
  assert(config.timeouts?.firstListMs === EVALUATION_POLICY.performance.firstListP95Ms && config.timeouts?.allDetailsMs === EVALUATION_POLICY.performance.allDetailsP95Ms &&
    config.timeouts?.rankHardTimeoutMs === EVALUATION_POLICY.performance.rankHardTimeoutMs && config.timeouts?.detailHardTimeoutMs === EVALUATION_POLICY.performance.detailHardTimeoutMs &&
    config.timeouts?.readyExpansionMs === EVALUATION_POLICY.performance.readyExpansionP95Ms && Number.isSafeInteger(config.timeouts?.journeyMs) && config.timeouts.journeyMs >= 180_000 && config.timeouts.journeyMs <= 600_000, 'registered_product_timing_and_finite_journey_required');
  assert(Number.isSafeInteger(config.faults?.pollDelayMs) && config.faults.pollDelayMs >= 1500 && config.faults.pollDelayMs <= 10_000 && config.faults.disconnectsPerJourney === 1, 'finite_browser_only_fault_plan_required');
  return config;
}
export async function registerPilot(config, { now = new Date().toISOString() } = {}) {
  validateConfig(config);
  if (rankNonThinkingContinuationForScope(config.spend)) await verifyRankNonThinkingContinuationScope(ROOT, config.spend);
  for (const field of ['nonRankingSourceSnapshot', 'rankingSourceSnapshot', 'spendAuthorization']) await boundBytes(config[field]);
  const bytes = await readFile(CASES_PATH), cases = validateCases(JSON.parse(bytes));
  const harness = await harnessBindings();
  return { schemaVersion: SCHEMA, registeredAt: now, executed: false, paidCalls: 0, config,
    cases: cases.cases, casesOriginal: { path: CASES_PATH, sha256: byteHash(bytes) }, harness,
    sessions: cases.cases.map(c => ({ caseId: c.caseId, sessionId: `${config.studyId}:${c.caseId}`, caseInputSha256: canonicalHash(c) })),
    denominator: 12, actualParticipants: 0, flow: 'current_v7_only', comparison60Selection: COMPARISON_60_SELECTION,
    outcome: 'ui_pilot_journey_feasibility_only_not_human_effect_or_formal_comparison', failuresRemainInDenominator: true,
    rawClock: 'browser_performance_now_before_original_submit_click_including_normalize_clarify_network_enqueue_and_DOM',
    noExistingResultsMayBeSpliced: true, noComprehensionKeysOrGradesRead: true, productAcceptance: false };
}
export function sessionForCase(registration, c) {
  const matches = registration.sessions.filter(s => s.caseId === c.caseId);
  assert(matches.length === 1 && matches[0].sessionId === `${registration.config.studyId}:${c.caseId}` && matches[0].caseInputSha256 === canonicalHash(c), 'case_session_input_binding_changed');
  return matches[0];
}
export async function validateRegistration(registration, { verifyBytes = true, requireCanonicalSessionOrder = true } = {}) {
  assert(registration.schemaVersion === SCHEMA && registration.executed === false && registration.denominator === 12 && registration.actualParticipants === 0 && registration.comparison60Selection === COMPARISON_60_SELECTION, 'unexecuted_fixed_twelve_registration_required');
  validateConfig(registration.config);
  assert(registration.sessions?.length === 12 && new Set(registration.sessions.map(s => s.sessionId)).size === 12, 'twelve_unique_sessions_required');
  assert(registration.cases?.length === 12 && new Set(registration.cases.map(c => c.caseId)).size === 12 && new Set(registration.sessions.map(s => s.caseId)).size === 12, 'unique_case_session_bijection_required');
  if (verifyBytes) {
    if (rankNonThinkingContinuationForScope(registration.config.spend)) await verifyRankNonThinkingContinuationScope(ROOT, registration.config.spend);
    const cases = validateCases(JSON.parse(await boundBytes(registration.casesOriginal)));
    assert(canonicalHash(cases.cases) === canonicalHash(registration.cases), 'frozen_cases_changed');
    for (const ref of registration.harness) await boundBytes(ref);
    assert(canonicalHash(registration.harness.map(r => r.path).sort()) === canonicalHash(OWNED_FILES.map(r => path.join(ROOT, r)).sort()), 'full_owned_harness_binding_required');
    for (const field of ['nonRankingSourceSnapshot', 'rankingSourceSnapshot', 'spendAuthorization']) await boundBytes(registration.config[field]);
  }
  for (const [index, c] of registration.cases.entries()) {
    const session = sessionForCase(registration, c);
    if (requireCanonicalSessionOrder) assert(registration.sessions[index] === session, 'canonical_case_session_order_required');
  }
  return registration;
}

const nonnegative = n => Number.isFinite(n) && n >= 0;
const money = n => (typeof n === 'string' && /^(0|[1-9][0-9]*)$/.test(n) || Number.isSafeInteger(n) && n >= 0) && Number.isSafeInteger(Number(n));
const nonempty = s => typeof s === 'string' && s.length > 0;
const validUsage = u => u && ['inputTokens', 'outputTokens', 'cachedInputTokens'].every(k => Number.isSafeInteger(u[k]) && u[k] >= 0) && u.cachedInputTokens <= u.inputTokens;
const failureReasons = new Set(['durable_outcome_unknown', 'missing_api_key', 'mock_mode', 'mock_not_allowed', 'provider_not_allowed', 'authentication_error', 'insufficient_balance', 'invalid_request', 'rate_limited', 'upstream_server_error', 'api_error', 'response_too_large', 'invalid_json', 'invalid_output', 'empty_content', 'truncated', 'network_error', 'timeout', 'spend_budget_exhausted', 'spend_store_unavailable', 'spend_configuration_invalid', 'capacity_exhausted', 'daily_budget_exhausted', 'budget_store_unavailable']);
/** Shapes are the actual durable-call/ai-client types. Usage and provider requestId
 * are optional in those types; an empty receipt shell is never a response. */
export function inspectPilotSavedCall(saved) {
  const bad = { valid: false, responseObserved: false, uncertain: true, upstreamAttempted: null };
  if (!saved || typeof saved !== 'object') return bad;
  const r = saved.kind === 'receipt' ? saved.receipt : saved.kind === 'result' ? saved.result : null;
  if (!r || r.model !== 'deepseek-flash' || (r.usage !== undefined && !validUsage(r.usage)) || (r.requestId !== undefined && !nonempty(r.requestId))) return bad;
  const response = Number.isInteger(r.httpStatus) && r.httpStatus >= 100 && r.httpStatus <= 599 && nonnegative(r.durationMs) && r.attempts === 1;
  if (saved.kind === 'receipt') {
    const valid = response && (r.finishReason === null || typeof r.finishReason === 'string') && Object.hasOwn(r, 'content');
    return { valid, responseObserved: valid, uncertain: !valid, upstreamAttempted: valid ? true : null, usage: r.usage };
  }
  if (typeof r.ok !== 'boolean' || typeof r.upstreamAttempted !== 'boolean') return bad;
  if (r.ok) {
    const valid = r.upstreamAttempted && response && (r.finishReason === null || typeof r.finishReason === 'string') && Object.hasOwn(r, 'data');
    return { valid, responseObserved: valid, uncertain: !valid, upstreamAttempted: r.upstreamAttempted, usage: r.usage };
  }
  if (!failureReasons.has(r.reason) || (r.durationMs !== undefined && !nonnegative(r.durationMs)) || (r.httpStatus !== undefined && (!Number.isInteger(r.httpStatus) || r.httpStatus < 100 || r.httpStatus > 599)) || (r.finishReason !== undefined && r.finishReason !== null && typeof r.finishReason !== 'string') || (r.retryAfterMs !== undefined && !nonnegative(r.retryAfterMs)) || (r.attempts !== undefined && (!Number.isSafeInteger(r.attempts) || r.attempts < 0 || r.attempts > 1))) return bad;
  const uncertain = r.upstreamAttempted && (!response || ['durable_outcome_unknown', 'network_error', 'timeout'].includes(r.reason));
  return { valid: true, responseObserved: r.upstreamAttempted && response, uncertain, upstreamAttempted: r.upstreamAttempted, usage: r.usage };
}

/** A policy's accounting effort is not the provider's wire effort. Successful
 * v2 calls must retain the protected response receipt with its actual settings.
 * Explicit failures and unresolved intents remain failures/unknowns; their DB
 * metadata may bind the financial hold, but does not prove a wire response. */
export function assertPilotCallModelSettings(call, policy) {
  if (policy.version !== 'saitu.effort-policy.v2') return;
  const saved = call.originalReceipt;
  if (saved?.kind === 'receipt') {
    const receipt = saved.receipt;
    assert(inspectPilotSavedCall(saved).valid, 'original_response_receipt_shape_invalid');
    assert(receipt?.model === call.model && receipt.operation === call.call_operation && receipt.thinking === call.call_thinking &&
      receipt.effortPolicySha256 === call.call_effort_policy_sha256, 'original_response_mode_or_policy_changed');
    assertDispatchEffort({ operation: receipt.operation, thinkingType: receipt.thinking, reasoningEffort: receipt.reasoningEffort,
      policyReasoningEffort: receipt.policyReasoningEffort, wireReasoningEffort: receipt.wireReasoningEffort,
      temperature: receipt.temperature, topP: receipt.topP, effortPolicySha256: receipt.effortPolicySha256 }, policy);
  } else assert(saved?.kind === 'result' && saved.result?.ok === false || saved == null && ['unknown', 'dispatch_intent', 'response_received'].includes(call.call_state), 'original_response_settings_required_for_success');
}

function tokenPayload(token) {
  try {
    if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
    const bytes = Buffer.from(token.split('.')[0], 'base64url'), t = JSON.parse(bytes);
    return bytes.toString('base64url') === token.split('.')[0] && t.version === 'decision-session.v7' && isHash(t.id) && nonempty(t.sessionId) && Number.isSafeInteger(t.generation) && t.generation >= 0 ? t : null;
  } catch { return null; }
}

/** Recomputed from originals, never from the collector's booleans. The shared
 * dispatch helper supplies its existing potential-dispatch/batch rule; strict
 * shapes, request identity and a ledger/reservation bijection are added here. */
export function analyzePilotEvidence(receipts, intent, registration) {
  const issues = [], require = (ok, why) => { if (!ok) issues.push(why); return Boolean(ok); };
  const config = registration.config, rows = receipts.ledgerRows ?? [], calls = receipts.calls ?? [], runs = receipts.productRunIds ?? [];
  const policy = effortPolicyForScope(config.spend), legacy = config.spend.authorizedEffort !== 'stage';
  const unbounded = config.spend.executionMode === USER_UNBOUNDED_EXECUTION_MODE;
  const flowIssues = [], requireFlow = (ok, why) => { if (!ok) (unbounded ? flowIssues : issues).push(why); };
  const runtime = legacy ? EVALUATION_POLICY.runtime : evaluationRuntimeForEffort(policy);
  const checkEffort = (work, why) => { try { work(); } catch { require(false, why); } };
  if (!legacy) checkEffort(() => rankNonThinkingContinuationForScope(config.spend), 'rank_nonthinking_continuation_missing_or_changed');
  require((receipts.captureIssues ?? []).every(issue => issue === 'unmatched_or_duplicate_or_foreign_new_ledger_reservation'), 'original_capture_error_blocks_evidence');
  const unique = (values, why) => require(values.every(nonempty) && new Set(values).size === values.length, why);
  unique(rows.map(r => r.id), 'duplicate_or_missing_ledger_id'); unique(calls.map(c => c.call_id), 'duplicate_or_missing_call_id'); unique(runs, 'duplicate_or_missing_product_run');
  if (config.spend.executionMode !== USER_UNBOUNDED_EXECUTION_MODE) require(rows.filter(r => r.state !== 'cancelled').length <= config.spend.perJourneyProviderCallCap, 'journey_admission_allowance_exceeded');
  const rowById = new Map(rows.map(r => [r.id, r])), links = new Map(rows.map(r => [r.id, []]));
  let realResponse = false, uncertain = false;
  for (const r of rows) {
    require(r.run_id === config.spend.runId && r.phase === config.spend.phase && r.model === 'deepseek-flash', 'foreign_ledger_scope');
    checkEffort(() => assertLedgerEffort(r, policy, { legacy }), 'ledger_effort_policy_mismatch');
    require(money(r.reserved_micros) && (r.charged_micros === null || money(r.charged_micros)) && ['reserved', 'usage_estimated', 'conservative', 'cancelled'].includes(r.state), 'malformed_ledger_amount_or_state');
    if (r.state === 'reserved' || r.charged_micros === null) { uncertain = true; require(Number(r.reserved_micros) > 0, 'unknown_ledger_requires_positive_financial_hold'); }
    if (r.state === 'cancelled') require(Number(r.charged_micros) === 0, 'cancelled_row_must_retain_zero_charge');
  }
  const j = receipts.journeyBinding;
  require(j && ['intentId', 'caseId', 'sessionId', 'caseInputSha256', 'registrationSha256'].every(k => j[k] === intent[k]), 'original_request_journey_identity_required');
  const http = j?.httpOriginals ?? [], requests = new Map();
  for (const h of http) {
    const valid = require(h.method === 'POST' && nonempty(h.requestId) && !requests.has(h.requestId) && typeof h.requestBody === 'string' && byteHash(h.requestBody) === h.requestBodySha256 && h.caseInputSha256 === intent.caseInputSha256 && h.sessionId === intent.sessionId && h.intentId === intent.intentId, 'http_request_original_identity_or_bytes_invalid');
    let request = null, payload = null;
    try { request = JSON.parse(h.requestBody); } catch { require(false, 'http_request_json_invalid'); }
    if (h.responseBodyBase64 !== undefined) {
      const bytes = Buffer.from(h.responseBodyBase64, 'base64');
      require(bytes.toString('base64') === h.responseBodyBase64 && byteHash(bytes) === h.responseBodySha256 && h.responseHeaderRequestId === h.requestId && Number.isInteger(h.status), 'http_response_original_identity_or_bytes_invalid');
      try { payload = JSON.parse(bytes); } catch { require(false, 'http_response_json_invalid'); }
    } else uncertain = true;
    if (valid) requests.set(h.requestId, { ...h, request, payload });
  }
  const snapshots = receipts.runSnapshots ?? [], runById = new Map(snapshots.map(s => [s.runId, s]));
  require(snapshots.length === runs.length && new Set(snapshots.map(s => s.runId)).size === runs.length, 'one_original_snapshot_per_run_required');
  const runTokens = new Map(), chatRequests = new Map();
  let initialSubmissions = 0;
  for (const h of requests.values()) {
    if (h.path === '/api/ai/competition-recommend') {
      initialSubmissions++;
      if (h.status === 202 && h.payload?.runId) runTokens.set(h.payload.runId, tokenPayload(h.payload.decisionToken));
    }
    if (h.path === '/api/ai/competition-chat') {
      require(nonempty(h.request?.requestId) && !chatRequests.has(h.request.requestId), 'unique_actual_chat_request_id_required');
      chatRequests.set(h.request?.requestId, h);
      if (h.payload) require(h.payload.requestId === h.request?.requestId, 'chat_http_reply_request_mismatch');
      if (h.payload?.run?.runId) runTokens.set(h.payload.run.runId, tokenPayload(h.payload.run.decisionToken));
    }
  }
  requireFlow(initialSubmissions === 1, 'one_original_initial_submission_required');
  if (unbounded) require(http.length > 0 && initialSubmissions <= 1, 'captured_HTTP_identity_without_repeated_initial_submission_required');
  const productionSessions = new Set();
  for (const id of runs) {
    const snapshot = runById.get(id), token = runTokens.get(id);
    require(snapshot?.body?.implementationSha256 === config.productPins.runtimeSourceBindingSha256 && Array.isArray(snapshot?.body?.context?.records) && canonicalHash(snapshot.body.context.records) === config.productPins.candidatePoolSha256, 'actual_run_source_or_catalog_binding_changed');
    require(token && snapshot?.stateKey === token.id, 'captured_HTTP_run_token_and_DB_session_required');
    if (token) productionSessions.add(token.sessionId);
  }
  requireFlow(runs.length > 0 && productionSessions.size === 1, 'one_production_session_for_fictional_journey_required');
  if (unbounded) require(productionSessions.size <= 1, 'multiple_production_sessions_cannot_share_one_journey');
  for (const c of calls) {
    require(nonempty(c.call_key) && isHash(c.prompt_sha256) && runs.includes(c.product_run_id) && runById.has(c.product_run_id), 'actual_call_prompt_and_product_run_membership_required');
    if (c.call_key?.startsWith('chat:')) {
      const h = chatRequests.get(c.call_key.split(':')[1]), token = tokenPayload(h?.request?.decisionToken);
      require(h && token && runById.get(c.product_run_id)?.stateKey === token.id && productionSessions.has(token.sessionId), 'chat_call_must_match_actual_HTTP_request_and_session');
    }
    const proof = inspectPilotSavedCall(c.originalReceipt);
    const retainedUnknown = unbounded && c.originalReceipt === null && ['unknown', 'dispatch_intent', 'response_received'].includes(c.call_state) &&
      rowById.has(c.reservation_id) && ['reserved', 'conservative'].includes(rowById.get(c.reservation_id).state);
    require(proof.valid || retainedUnknown, 'malformed_original_durable_receipt_or_result');
    const potential = proof.upstreamAttempted !== false || Boolean(c.reservation_id) || ['dispatch_intent', 'unknown', 'response_received'].includes(c.call_state);
    if (potential) {
      const row = rowById.get(c.reservation_id);
      require(row && c.spend_run_id === config.spend.runId && c.phase === config.spend.phase && c.model === 'deepseek-flash', 'potential_dispatch_without_this_journey_ledger');
      checkEffort(() => assertCallEffort(c, policy, { legacy }), 'call_effort_policy_mismatch');
      if (!legacy) checkEffort(() => assertPilotCallModelSettings(c, policy), 'original_call_model_settings_mismatch');
      if (!legacy && row) checkEffort(() => assert(callOperation(c) === row.operation && c.effort === row.effort, 'call_ledger_operation_mismatch'), 'call_ledger_operation_mismatch');
      if (row) {
        links.get(row.id).push(`durable:${c.call_id}`);
        if (row.state === 'cancelled') require(proof.valid && proof.upstreamAttempted === false, 'cancelled_call_cannot_have_upstream_response');
        else require(proof.upstreamAttempted === true || retainedUnknown, 'charged_call_must_retain_dispatch_outcome');
        if (proof.usage && row.state === 'usage_estimated') require([['input_tokens', 'inputTokens'], ['output_tokens', 'outputTokens'], ['cached_input_tokens', 'cachedInputTokens']].every(([ledgerKey, usageKey]) => row[ledgerKey] !== null && Number(row[ledgerKey]) === proof.usage[usageKey]), 'usage_receipt_ledger_mismatch');
      }
    }
    realResponse ||= proof.valid && proof.responseObserved;
    uncertain ||= proof.uncertain || c.call_state === 'unknown' || c.call_state === 'dispatch_intent';
  }
  if (calls.some(c => inspectPilotSavedCall(c.originalReceipt).responseObserved)) require(hasBoundProviderDispatch(calls, config.spend.runId, runtime), 'shared_potential_dispatch_binding_failed');
  // Non-durable normalize has metadata proof, explicitly not a durable model
  // response. Exact request ID/reservation identity is the ownership boundary.
  const trace = j?.accountingTrace, events = trace?.events ?? [];
  if (trace) require(config.serverAccountingLog && trace.path === config.serverAccountingLog.path && trace.sourceSha256 === config.productPins.runtimeSourceBindingSha256 && trace.inodeBefore === trace.inodeAfter && trace.deviceBefore === trace.deviceAfter && Number.isSafeInteger(trace.startOffset) && Number.isSafeInteger(trace.endOffset) && trace.endOffset >= trace.startOffset && isHash(trace.segmentSha256) && isHash(trace.prefixSha256Before) && trace.prefixSha256After === trace.prefixSha256Before && trace.complete === true && trace.issues?.length === 0, 'append_only_bound_server_trace_original_required');
  const eventGroups = new Map();
  for (const e of events) {
    require(requests.has(e.requestId) && e.event === 'competition_accounting_trace' && isHash(e.originalLineSha256) && nonempty(e.details?.reservationId), 'trace_must_match_captured_HTTP_and_original_line');
    try {
      const bytes = Buffer.from(e.originalLineBase64, 'base64'), raw = JSON.parse(bytes);
      require(bytes.toString('base64') === e.originalLineBase64 && byteHash(bytes) === e.originalLineSha256 && canonicalHash(raw) === canonicalHash(Object.fromEntries(['event', 'requestId', 'time', 'type', 'details'].map(k => [k, e[k]]))) && Number.isSafeInteger(e.byteOffset) && e.byteOffset >= trace.startOffset && e.byteOffset + bytes.length <= trace.endOffset, 'trace_original_line_bytes_or_position_invalid');
    } catch { require(false, 'trace_original_line_unreadable'); }
    const id = e.details?.reservationId; if (!eventGroups.has(id)) eventGroups.set(id, []); eventGroups.get(id).push(e);
  }
  for (const [id, group] of eventGroups) {
    const row = rowById.get(id);
    require(row, 'trace_reservation_missing_from_new_ledger');
    if (!row) continue;
    if (links.get(id).length) {
      const c = calls.find(c => c.reservation_id === id), h = requests.get(group[0].requestId);
      require(new Set(group.map(e => e.requestId)).size === 1 && (c?.call_key?.startsWith('chat:') ? h?.path === '/api/ai/competition-chat' && c.call_key.split(':')[1] === h.request?.requestId : h?.path === '/api/ai/competition-recommend'), 'durable_trace_HTTP_request_mismatch');
      continue; // Durable originals remain the authority for durable calls.
    }
    const requestIds = [...new Set(group.map(e => e.requestId))], h = requests.get(requestIds[0]);
    const reserved = group.filter(e => e.type === 'ai_budget_reserved'), dispatched = group.filter(e => e.type === 'ai_transport_dispatch'), settled = group.filter(e => e.type === 'ai_budget_settled');
    const nonDurableOperation = { '/api/competitions/recommend/normalize': 'competition_normalize', '/api/ai/competition-clarify': 'competition_clarify' }[h?.path];
    const protectedUnknown = unbounded && row.state === 'reserved' && row.charged_micros === null && Number(row.reserved_micros) > 0 && settled.length === 0 && dispatched.length <= 1;
    const valid = require(requestIds.length === 1 && nonDurableOperation === row.operation && reserved.length === 1 &&
      (protectedUnknown || settled.length === 1 && !group.some(e => e.type === 'ai_settlement_failed')), 'non_durable_normalize_requires_exact_original_trace');
    if (!valid) continue;
    const r = reserved[0].details, s = settled[0]?.details, d = dispatched[0]?.details;
    require(r.model === row.model && r.effort === row.effort && r.phase === row.phase && money(r.reservedMicros) && Number(r.reservedMicros) === Number(row.reserved_micros) &&
      (protectedUnknown || money(s.chargedMicros) && Number(s.chargedMicros) === Number(row.charged_micros) && s.state === row.state), 'normalize_trace_and_raw_ledger_mismatch');
    if (!legacy) require([r, ...(protectedUnknown ? [] : [s])].every(details => details.operation === row.operation && details.effort === row.effort && details.effortPolicySha256 === config.spend.effortPolicySha256), 'normalize_reservation_settlement_effort_policy_mismatch');
    require(protectedUnknown ? dispatched.length === 0 || d.model === row.model && d.attempt === 1 && d.operation === row.operation :
      row.state === 'cancelled' ? dispatched.length === 0 && s.upstreamAttempted === false && Number(s.chargedMicros) === 0 : dispatched.length === 1 && d.model === row.model && d.attempt === 1 && d.operation === row.operation && s.upstreamAttempted === true, 'normalize_dispatch_or_explicit_cancellation_proof_required');
    if (dispatched.length === 1) checkEffort(() => assertDispatchEffort(d, policy, { legacy }), 'normalize_dispatch_effort_policy_mismatch');
    links.get(id).push(`metadata_dispatch:${requestIds[0]}`);
    if (!h.payload || h.status < 200 || h.status >= 300) uncertain = true;
  }
  for (const [id, owners] of links) require(owners.length === 1, owners.length ? 'ledger_reservation_has_multiple_calls' : 'unmatched_new_ledger_row');
  const accountingMicros = rows.reduce((n, r) => n + (money(r.charged_micros ?? r.reserved_micros) ? Number(r.charged_micros ?? r.reserved_micros) : 0), 0);
  require(Number.isSafeInteger(accountingMicros), 'accounting_sum_not_safe_integer');
  require(receipts.cost?.accountingCny === accountingMicros / 1_000_000 && receipts.cost?.providerInvoiceCny === null && receipts.cost?.invoiceVerified === false, 'raw_ledger_cost_must_be_recomputed_no_invoice_claim');
  return { valid: issues.length === 0 && flowIssues.length === 0 && realResponse && !uncertain, ownershipVerified: issues.length === 0, issues: [...new Set(issues)], flowIssues, realProviderResponseObserved: realResponse, uncertain, accountingMicros,
    unmatchedLedgerIds: [...links].filter(([, owners]) => owners.length !== 1).map(([id]) => id),
    ledgerClosure: [...links].map(([reservationId, owners]) => ({ reservationId, owners })),
    nonDurableNormalizeProofClass: 'metadata_dispatch_and_http_only_not_original_provider_response' };
}
export function validateObservation(o, intent, registration) {
  assert(o.schemaVersion === 'saitu.pilot-observation.v7.1' && o.intentId === intent.intentId && o.sessionId === intent.sessionId && o.caseId === intent.caseId && o.registrationSha256 === intent.registrationSha256 && o.caseInputSha256 === intent.caseInputSha256, 'observation_intent_session_input_binding_required');
  assert(['passed', 'failed', 'abandoned', 'indeterminate'].includes(o.status) && o.actualParticipants === 0 && o.evidenceClass === 'ai_proxy_ui_pilot', 'pilot_only_outcome_required');
  assert(Array.isArray(o.steps) && o.steps.every(s => s.name && ['passed', 'failed', 'not_exercised'].includes(s.status)), 'raw_journey_steps_required');
  assert(o.receipts && Array.isArray(o.receipts.productRunIds) && Array.isArray(o.receipts.ledgerRows) && Array.isArray(o.receipts.calls), 'raw_receipt_ledger_arrays_required_even_for_failures');
  assert(o.receipts.spendRunId === registration.config.spend.runId && o.receipts.authorizationPolicySha256 === registration.config.spend.authorizationPolicySha256, 'observation_spend_scope_binding_required');
  const c = registration.cases.find(c => c.caseId === intent.caseId), session = c && sessionForCase(registration, c);
  assert(c && intent.caseInputSha256 === canonicalHash(c) && intent.sessionId === session.sessionId, 'observation_dispatched_case_identity_required');
  if (o.status === 'passed') {
    assert(o.steps.length >= 3 && o.steps.every(s => s.status === 'passed') && o.steps.some(s => s.name === 'list_visible') && o.steps.some(s => s.name === 'clicked_reason_visible'), 'all_actual_journey_steps_must_pass');
    assert(o.timing && Number.isFinite(o.timing.originalClickEpochMs) && o.timing.originalClickEpochMs > 0 && Number.isFinite(o.timing.listMs) && o.timing.listMs >= 0 && Number.isFinite(o.timing.allDetailsMs) && o.timing.allDetailsMs >= o.timing.listMs && Number.isFinite(o.timing.readyExpansionMs) && o.timing.readyExpansionMs >= 0 && o.timing.probeInstalledBeforeOriginalClick === true && o.timing.usedServerEnqueueAsStart === false, 'raw_original_click_to_DOM_timing_required');
    assert(o.receipts.realProviderDispatch === true && o.receipts.allPotentialDispatchesBound === true && o.receipts.allLedgerRowsAccounted === true && o.receipts.productRunIds.length && o.receipts.ledgerRows.length, 'passed_live_journey_requires_actual_dispatch_and_raw_ledger');
    const proof = analyzePilotEvidence(o.receipts, intent, registration);
    assert(proof.valid, `passed_journey_original_evidence_rejected:${proof.issues.join(',') || 'unknown_dispatch_or_missing_original_response'}`);
    assert(o.pinValidation?.before === true && o.pinValidation?.after === true, 'before_after_live_source_prompt_catalog_pins_required');
  }
  return o;
}
export function summarizePilot(registration, observations, indeterminate = []) {
  const byCase = new Map(observations.map(o => [o.caseId, o]));
  assert(byCase.size === observations.length && observations.every(o => registration.cases.some(c => c.caseId === o.caseId)), 'no_duplicate_or_foreign_case_observations');
  const owners = new Map(), ambiguous = new Set();
  for (const o of observations) {
    const identities = [...(o.receipts?.journeyBinding?.httpOriginals ?? []).map(h => `http:${h.requestId}`),
      ...(o.receipts?.ledgerRows ?? []).map(r => `ledger:${r.id}`), ...(o.receipts?.calls ?? []).map(c => `call:${c.call_id}`),
      ...(o.receipts?.productRunIds ?? []).map(id => `run:${id}`)];
    for (const id of identities) {
      if (owners.has(id)) { ambiguous.add(owners.get(id)); ambiguous.add(o.caseId); }
      else owners.set(id, o.caseId);
    }
  }
  const fixture = o => o?.syntheticUnitFixtureOnly === true || o?.syntheticOfflineFixtureOnly === true;
  const slots = registration.cases.map(c => { const o = byCase.get(c.caseId); return { caseId: c.caseId, status: ambiguous.has(c.caseId) ? 'indeterminate' : fixture(o) && o.status === 'passed' ? 'fixture_passed' : o?.status ?? (indeterminate.includes(c.caseId) ? 'indeterminate' : 'not_started') }; });
  const p95 = key => {
    const values = registration.cases.map(c => { const o = byCase.get(c.caseId); return o?.status === 'passed' && !fixture(o) && !ambiguous.has(c.caseId) && Number.isFinite(o.timing?.[key]) ? o.timing[key] : Infinity; }).sort((a, b) => a - b);
    const value = values[Math.ceil(values.length * 0.95) - 1];
    return { valueMs: Number.isFinite(value) ? value : null, status: Number.isFinite(value) ? 'measured' : 'unbounded_due_to_failed_unknown_or_unstarted_slot', denominator: 12 };
  };
  return { schemaVersion: 'saitu.pilot-manifest.v7.1', denominator: 12, slots,
    ambiguousCrossJourneyEvidenceCases: [...ambiguous].sort(), ambiguityDoesNotRewriteOriginalObservations: true,
    passed: slots.filter(s => s.status === 'passed').length, fixturePassedNotLivePilot: slots.filter(s => s.status === 'fixture_passed').length, failed: slots.filter(s => ['failed', 'abandoned'].includes(s.status)).length,
    indeterminate: slots.filter(s => s.status === 'indeterminate').length, notStarted: slots.filter(s => s.status === 'not_started').length,
    latency: { listP95: p95('listMs'), allDetailsP95: p95('allDetailsMs'), readyExpansionP95: p95('readyExpansionMs') },
    failuresRemainInDenominator: true, actualParticipants: 0, comparison60Selection: COMPARISON_60_SELECTION, formal60Executed: 0,
    pilotGatePassed: false, independentJourneyReview: 'pending', formalProductAcceptance: false,
    notes: ['12 fictional UI journeys only; no human outcome measured', 'No completed or failed or unknown-dispatch intent is reissued', 'Browser-only injected poll faults do not prove provider/PG failure recovery', '12 pilot times do not satisfy the performance100 denominator'] };
}

const refSchema = { type: 'object', required: ['path', 'sha256'], properties: { path: { type: 'string', minLength: 1 }, sha256: { type: 'string', pattern: '^[a-f0-9]{64}$', minLength: 64, maxLength: 64 } }, additionalProperties: false };
export const REGISTRATION_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'saitu.pilot-registration.v7.1', type: 'object',
  required: ['schemaVersion', 'registeredAt', 'executed', 'config', 'cases', 'casesOriginal', 'harness', 'sessions', 'denominator', 'actualParticipants', 'comparison60Selection', 'rawClock'],
  properties: { schemaVersion: { const: SCHEMA }, registeredAt: { type: 'string', format: 'date-time' }, executed: { const: false }, denominator: { const: 12 }, actualParticipants: { const: 0 },
    comparison60Selection: { const: COMPARISON_60_SELECTION }, casesOriginal: refSchema, harness: { type: 'array', minItems: 5, maxItems: 5, items: refSchema },
    cases: { type: 'array', minItems: 12, maxItems: 12, items: { type: 'object', required: ['caseId', 'fictional', 'taskGroup', 'viewport', 'scenario'], properties: { fictional: { const: true }, taskGroup: { enum: GROUPS }, viewport: { enum: ['desktop', 'mobile'] }, scenario: { enum: SCENARIOS } } } },
    config: { type: 'object', required: ['schemaVersion', 'studyId', 'authorContextId', 'productPins', 'promptVersions', 'spend', 'nonRankingSourceSnapshot', 'rankingSourceSnapshot', 'spendAuthorization', 'comparison60Selection'],
      properties: { schemaVersion: { const: 'saitu.pilot-config.v7.1' }, authorContextId: { const: '/root' }, comparison60Selection: { const: COMPARISON_60_SELECTION },
        productPins: { type: 'object', required: PIN_KEYS, properties: Object.fromEntries(PIN_KEYS.map(k => [k, { type: 'string', pattern: '^[a-f0-9]{64}$', minLength: 64, maxLength: 64 }])) },
        nonRankingSourceSnapshot: refSchema, rankingSourceSnapshot: refSchema, spendAuthorization: refSchema } },
    sessions: { type: 'array', minItems: 12, maxItems: 12 }, rawClock: { type: 'string' } },
  $comment: 'The exported validateRegistration additionally checks actual bytes, complete session/case membership, source/prompt/funding bindings and the fixed scenario/group matrix. A JSON schema alone is not execution authorization.' };
Object.assign(REGISTRATION_SCHEMA.properties.config, {
  required: ['schemaVersion', 'studyId', 'authorContextId', 'baseUrl', 'workerHealthFile', 'policyVersion', 'policySha256', 'productPins',
    'promptVersions', 'spend', 'nonRankingSourceSnapshot', 'rankingSourceSnapshot', 'spendAuthorization', 'comparison60Selection',
    'flow', 'performanceOverlap', 'actualParticipants', 'failuresRemainInDenominator', 'automaticPaidRetries', 'timeouts', 'faults'],
});
Object.assign(REGISTRATION_SCHEMA.properties.config.properties, {
  executionMode: { enum: ['finite', USER_UNBOUNDED_EXECUTION_MODE] }, invocationConcurrency: { const: 'adaptive' }, schedulingPolicy: { const: ADAPTIVE_EXECUTION_POLICY },
  serverAccountingLog: { type: 'object', required: ['path', 'format', 'sourceSha256'], additionalProperties: false, properties: { path: { type: 'string', minLength: 1 }, format: { const: 'competition_accounting_trace.jsonl' }, sourceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, $comment: 'Required by the live driver before dispatch. The actual append-only file identity, offsets and captured trace hashes are retained. The log is not a substitute for durable provider response originals.' },
  studyId: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,100}$' }, baseUrl: { type: 'string', format: 'uri' }, workerHealthFile: { type: 'string', minLength: 1 },
  policyVersion: { const: POLICY_VERSION }, policySha256: { const: POLICY_SHA256 },
  flow: { const: 'current_v7_only' }, performanceOverlap: { const: false }, actualParticipants: { const: 0 }, failuresRemainInDenominator: { const: true }, automaticPaidRetries: { const: false },
  promptVersions: { type: 'object', required: ['ranking', 'explanation', 'profile', 'chat', 'chatReview'],
    properties: Object.fromEntries(['ranking', 'explanation', 'profile', 'chat', 'chatReview'].map(k => [k, { type: 'string', minLength: 1 }])) },
  spend: { type: 'object', required: ['grantVersion', 'runId', 'phase', 'authorizedPhase', 'authorizedEffort', 'effortPolicy', 'effortPolicySha256', 'authorizationPolicySha256', 'effortConditionSha256', 'callLimit', 'perJourneyProviderCallCap', 'hardLimitMicros', 'fundingLimitMicros'],
    properties: { grantVersion: { enum: [TOP5_EFFORT_GRANT_VERSION, USER_UNBOUNDED_GRANT_VERSION] }, executionMode: { enum: ['finite', USER_UNBOUNDED_EXECUTION_MODE] }, executionLimits: { const: USER_UNBOUNDED_EXECUTION_LIMITS }, runId: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,100}$' }, phase: { type: 'string', minLength: 1 }, authorizedPhase: { type: 'string', minLength: 1 }, authorizedEffort: { const: 'stage' },
      effortPolicy: { type: 'object', required: ['version', 'rank', 'explain', 'review'], additionalProperties: false, properties: { version: { const: 'saitu.effort-policy.v1' }, ...Object.fromEntries(['rank', 'explain', 'review'].map(stage => [stage, { enum: ['high', 'low'] }])) } },
      effortPolicySha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      authorizationPolicySha256: { type: 'string', pattern: '^[a-f0-9]{64}$', minLength: 64, maxLength: 64 }, effortConditionSha256: { type: 'string', pattern: '^[a-f0-9]{64}$', minLength: 64, maxLength: 64 },
      callLimit: { type: ['integer', 'null'], minimum: 1 }, perJourneyProviderCallCap: { type: ['integer', 'null'], minimum: 1 }, hardLimitMicros: { type: ['integer', 'null'], minimum: 1 }, fundingLimitMicros: { type: 'integer', minimum: 0 } },
    allOf: [{ if: { required: ['executionMode'], properties: { executionMode: { const: USER_UNBOUNDED_EXECUTION_MODE } } },
      then: { required: ['executionLimits'], properties: { grantVersion: { const: USER_UNBOUNDED_GRANT_VERSION }, callLimit: { const: null }, perJourneyProviderCallCap: { const: null }, hardLimitMicros: { const: null } } },
      else: { properties: { grantVersion: { const: TOP5_EFFORT_GRANT_VERSION }, callLimit: { type: 'integer' }, perJourneyProviderCallCap: { type: 'integer' }, hardLimitMicros: { type: 'integer' }, fundingLimitMicros: { minimum: 1 } } } }],
    $comment: 'The explicit user-unbounded grant has null artificial totals. fundingLimitMicros is its physical balance snapshot. Every original call, reservation and unknown hold remains bound.' },
  timeouts: { type: 'object', required: ['firstListMs', 'rankHardTimeoutMs', 'allDetailsMs', 'detailHardTimeoutMs', 'readyExpansionMs', 'journeyMs'], properties: {
    firstListMs: { const: EVALUATION_POLICY.performance.firstListP95Ms }, rankHardTimeoutMs: { const: EVALUATION_POLICY.performance.rankHardTimeoutMs },
    allDetailsMs: { const: EVALUATION_POLICY.performance.allDetailsP95Ms }, detailHardTimeoutMs: { const: EVALUATION_POLICY.performance.detailHardTimeoutMs },
    readyExpansionMs: { const: EVALUATION_POLICY.performance.readyExpansionP95Ms }, journeyMs: { type: 'integer', minimum: 180000, maximum: 600000 } } },
  faults: { type: 'object', required: ['pollDelayMs', 'disconnectsPerJourney'], properties: { pollDelayMs: { type: 'integer', minimum: 1500, maximum: 10000 }, disconnectsPerJourney: { const: 1 } } },
});
REGISTRATION_SCHEMA.properties.sessions.items = { type: 'object', required: ['caseId', 'sessionId', 'caseInputSha256'],
  properties: { caseId: { type: 'string' }, sessionId: { type: 'string', minLength: 1 }, caseInputSha256: { type: 'string', pattern: '^[a-f0-9]{64}$', minLength: 64, maxLength: 64 } }, additionalProperties: false };
