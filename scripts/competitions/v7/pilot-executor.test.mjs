import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { ROOT, CASES_PATH, PIN_KEYS, OWNED_FILES, byteHash, binding, registerPilot, validateCases,
  validateRegistration, validateConfig, validateObservation, summarizePilot, isHash, canonicalHash, analyzePilotEvidence, inspectPilotSavedCall, COMPARISON_60_SELECTION } from './pilot-contract.mjs';
import { executePilot } from './pilot-executor.mjs';
import { EFFORT_GRANT_VERSION, TOP5_EFFORT_GRANT_VERSION, DEFAULT_EFFORT_POLICY, effortPolicySha256 } from './evaluation-effort.mjs';
import { pilotProbeBootstrap, startPilotClock, sendPilotChat, assertCorrection, snapshotPilotAccountingLog, capturePilotAccountingTrace } from '../../../tests/e2e/v7-pilot-browser.mjs';

import { POLICY_VERSION, POLICY_SHA256 } from './evaluation-policy.mjs';
import { USER_UNBOUNDED_EXECUTION_MODE, USER_UNBOUNDED_GRANT_VERSION, USER_UNBOUNDED_EXECUTION_LIMITS } from '../../../src/lib/ai/execution-policy.mjs';
import { ADAPTIVE_EXECUTION_POLICY } from '../../lib/adaptive-execution.mjs';
import { RANK_NON_THINKING_EFFORT_POLICY } from '../../../src/lib/ai/effort-policy.mjs';
import { RANK_NONTHINKING_AUTHORIZATION_POLICY, RANK_NONTHINKING_TRIAL_SLOTS } from '../../../src/lib/ai/execution-policy.mjs';
const H = 'a'.repeat(64), clock = { firstListMs: 40_000, rankHardTimeoutMs: 60_000, allDetailsMs: 120_000, detailHardTimeoutMs: 150_000, readyExpansionMs: 1000, journeyMs: 300_000 };
const fixtureRecords = [{ syntheticOfflineFixtureOnly: true }];
async function workspace(t) { const dir = await mkdtemp(path.join(os.tmpdir(), 'saitu-pilot-fixture-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
async function setup(t, unbounded = false) {
  const dir = await workspace(t), refs = {};
  for (const name of ['nonRankingSourceSnapshot', 'rankingSourceSnapshot', 'spendAuthorization']) { const filename = path.join(dir, `${name}.json`); await writeFile(filename, JSON.stringify({ syntheticUnitFixture: true, name })); refs[name] = await binding(filename); }
  const config = { schemaVersion: 'saitu.pilot-config.v7.1', studyId: 'offline-unit-fixture-only', authorContextId: '/root', comparison60Selection: COMPARISON_60_SELECTION, flow: 'current_v7_only', performanceOverlap: false,
    actualParticipants: 0, failuresRemainInDenominator: true, automaticPaidRetries: false, productPins: { ...Object.fromEntries(PIN_KEYS.map(k => [k, H])), candidatePoolSha256: canonicalHash(fixtureRecords) },
    policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, promptVersions: Object.fromEntries(['ranking', 'explanation', 'profile', 'chat', 'chatReview'].map(k => [k, `synthetic-${k}`])),
    baseUrl: 'http://127.0.0.1:3000/', workerHealthFile: path.join(dir, 'synthetic-not-live-worker.json'), ...refs,
    spend: { grantVersion: TOP5_EFFORT_GRANT_VERSION, effortPolicy: DEFAULT_EFFORT_POLICY, effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), runId: 'synthetic-no-paid-batch', phase: 'calibration', authorizedPhase: 'calibration', authorizedEffort: 'stage', authorizationPolicySha256: refs.spendAuthorization.sha256,
      effortConditionSha256: H, callLimit: 120, perJourneyProviderCallCap: 10, hardLimitMicros: 1000000, fundingLimitMicros: 1000000 }, timeouts: clock, faults: { pollDelayMs: 1500, disconnectsPerJourney: 1 } };
  if (unbounded) {
    Object.assign(config, { executionMode: USER_UNBOUNDED_EXECUTION_MODE, invocationConcurrency: 'adaptive', schedulingPolicy: ADAPTIVE_EXECUTION_POLICY });
    Object.assign(config.spend, { executionMode: USER_UNBOUNDED_EXECUTION_MODE, grantVersion: USER_UNBOUNDED_GRANT_VERSION,
      executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS, callLimit: null, perJourneyProviderCallCap: null, hardLimitMicros: null });
  }
  const registration = await registerPilot(config); return { dir, config, registration, bytes: Buffer.from(JSON.stringify(registration)) };
}
async function continuationFixture(t) {
  const value = await setup(t, true), { config } = value;
  const authorization = await binding(path.join(ROOT, RANK_NONTHINKING_AUTHORIZATION_POLICY));
  config.spendAuthorization = authorization;
  Object.assign(config.spend, { phase: 'formal', authorizedPhase: 'formal', effortPolicy: RANK_NON_THINKING_EFFORT_POLICY,
    effortPolicySha256: effortPolicySha256(RANK_NON_THINKING_EFFORT_POLICY), authorizationPolicySha256: authorization.sha256,
    authorizationPolicySource: RANK_NONTHINKING_AUTHORIZATION_POLICY, approvedPolicyPath: RANK_NONTHINKING_AUTHORIZATION_POLICY,
    pilotContinuation: { proofFile: 'artifacts/compact-20261110/C/synthetic-no-existing-pilot-proof.json', proofSha256: H,
      sourceBindingsSha256: H, pilotExecutionSha256: H, pilotPlanSha256: H, slotIds: [...RANK_NONTHINKING_TRIAL_SLOTS],
      effortPolicySha256: effortPolicySha256(RANK_NON_THINKING_EFFORT_POLICY), detailLayout: 'single', complete: 3 } });
  return value;
}
function fakeHttp(intent, requestId, pathname, requestBody, payload, status = 200) {
  const request = JSON.stringify(requestBody), bytes = Buffer.from(JSON.stringify(payload));
  return { requestId, path: pathname, method: 'POST', requestBody: request, requestBodySha256: byteHash(request),
    intentId: intent.intentId, sessionId: intent.sessionId, caseInputSha256: intent.caseInputSha256, status,
    responseHeaderRequestId: requestId, responseBodyBase64: bytes.toString('base64'), responseBodySha256: byteHash(bytes) };
}
function fakeObservation(c, intent, registration, status = 'passed') {
  const runId = `synthetic-run-${c.caseId}`, reservationId = `synthetic-ledger-${c.caseId}`;
  const decisionToken = Buffer.from(JSON.stringify({ version: 'decision-session.v7', id: H, sessionId: `synthetic-production-session-${c.caseId}`, generation: 0, expiresAt: 9999999999999 })).toString('base64url') + '.c3ludGhldGljLW9ubHktbm90LXByb2R1Y3Rpb24';
  const row = { id: reservationId, run_id: registration.config.spend.runId, phase: registration.config.spend.phase,
    model: 'deepseek-flash', effort: registration.config.spend.effortPolicy.rank, operation: 'competition_v7_rank', state: 'usage_estimated',
    reserved_micros: '20', charged_micros: '10', input_tokens: '2', output_tokens: '1', cached_input_tokens: '0' };
  const stageHash = registration.config.spend.effortPolicySha256;
  if (stageHash) row.effort_policy_sha256 = stageHash;
  const originalReceipt = { kind: 'receipt', receipt: { model: 'deepseek-flash', httpStatus: 200, finishReason: 'stop',
    content: { syntheticOfflineFixtureOnly: true }, durationMs: 1, attempts: 1, usage: { inputTokens: 2, outputTokens: 1, cachedInputTokens: 0 } } };
  return { schemaVersion: 'saitu.pilot-observation.v7.1', intentId: intent.intentId, sessionId: intent.sessionId, caseId: c.caseId,
    registrationSha256: intent.registrationSha256, caseInputSha256: intent.caseInputSha256, actualParticipants: 0, evidenceClass: 'ai_proxy_ui_pilot', status,
    syntheticUnitFixtureOnly: true, steps: ['list_visible', 'clicked_reason_visible', `fixture_${c.scenario}`].map(name => ({ name, status: 'passed' })),
    timing: { originalClickEpochMs: 1000, listMs: 10, allDetailsMs: 20, readyExpansionMs: 1, probeInstalledBeforeOriginalClick: true, usedServerEnqueueAsStart: false },
    receipts: { productRunIds: [runId], ledgerRows: [row], calls: [{ call_id: `synthetic-call-${c.caseId}`, call_key: 'v7.rank', prompt_sha256: H,
      call_state: 'completed', product_run_id: runId, reservation_id: reservationId, spend_run_id: row.run_id, phase: row.phase,
      model: row.model, effort: row.effort, originalReceipt, ...(stageHash ? { operation: row.operation, effort_policy_sha256: stageHash,
        call_operation: row.operation, call_thinking: 'enabled', call_reasoning_effort: row.effort, call_effort_policy_sha256: stageHash } : {}) }], spendRunId: registration.config.spend.runId,
      runSnapshots: [{ runId, stateKey: H, body: { implementationSha256: registration.config.productPins.runtimeSourceBindingSha256, context: { records: fixtureRecords } } }],
      journeyBinding: { ...intent, httpOriginals: [fakeHttp(intent, `synthetic-http-submit-${c.caseId}`, '/api/ai/competition-recommend', { conversationToken: 'SYNTHETIC-OFFLINE-ONLY' }, { runId, decisionToken }, 202)] },
      cost: { accountingCny: 0.00001, providerInvoiceCny: null, invoiceVerified: false },
      authorizationPolicySha256: registration.config.spend.authorizationPolicySha256, realProviderDispatch: true, allPotentialDispatchesBound: true, allLedgerRowsAccounted: true },
    pinValidation: { before: true, after: true }, artifacts: [] };
}
function fakeDriver(registration, { failCase, throwCase, admissionFailure, initializeFailure } = {}) {
  const counts = { initialized: 0, run: 0, closed: 0 };
  return { counts,
    async initialize() { counts.initialized++; if (initializeFailure) throw new Error('synthetic_initialize_rejected_before_UI'); },
    async beforeCase() { if (admissionFailure) throw new Error('synthetic_budget_rejected_before_intent'); return { syntheticUnitFixtureOnly: true, beforeLedgerIds: [] }; },
    async runCase(c, intent) { counts.run++; if (c.caseId === throwCase) throw new Error('synthetic_unknown_dispatch'); return fakeObservation(c, intent, registration, c.caseId === failCase ? 'failed' : 'passed'); },
    async close() { counts.closed++; }, safeError: e => e.message };
}
function fixtureIntent(registration, index = 0) { return { intentId: `fixture-intent-${index}`, caseId: registration.cases[index].caseId,
  sessionId: registration.sessions[index].sessionId, registrationSha256: H, caseInputSha256: registration.sessions[index].caseInputSha256 }; }
async function addNormalizeTraceFixture(dir, registration, intent, o, mutateOriginals) {
  const logPath = path.join(dir, `server-${intent.intentId}.log`);
  registration.config.serverAccountingLog = { path: logPath, format: 'competition_accounting_trace.jsonl', sourceSha256: registration.config.productPins.runtimeSourceBindingSha256 };
  await writeFile(logPath, 'UNRELATED-SECRET-OFFLINE-FIXTURE-DO-NOT-COPY\n');
  const before = await snapshotPilotAccountingLog(registration.config.serverAccountingLog);
  const requestId = `synthetic-normalize-${intent.caseId}`, reservationId = `synthetic-normalize-reservation-${intent.caseId}`;
  const h = fakeHttp(intent, requestId, '/api/competitions/recommend/normalize', { questionnaire: { syntheticOfflineFixtureOnly: true } }, { status: 'confirmed', questionnaireToken: 'OFFLINE-ONLY' });
  o.receipts.journeyBinding.httpOriginals.unshift(h);
  const row = { ...o.receipts.ledgerRows[0], id: reservationId, effort: 'high', operation: 'competition_normalize', state: 'conservative', charged_micros: '15', input_tokens: null, output_tokens: null, cached_input_tokens: null };
  o.receipts.ledgerRows.push(row); o.receipts.cost.accountingCny = 0.000025;
  const stageFields = registration.config.spend.effortPolicySha256 ? { operation: row.operation, effortPolicySha256: registration.config.spend.effortPolicySha256 } : {};
  const event = (type, details) => ({ event: 'competition_accounting_trace', requestId, time: '2026-11-09T00:00:00.000Z', type,
    details: { reservationId, ...details, ...stageFields, ...(registration.config.spend.effortPolicySha256 && type !== 'ai_transport_dispatch' ? { effort: row.effort } : {}) } });
  const originals = [event('ai_budget_reserved', { model: row.model, effort: row.effort, phase: row.phase, reservedMicros: 20, priceVersion: 'offline-price' }),
    event('ai_transport_dispatch', { model: row.model, attempt: 1, operation: row.operation, thinkingType: 'enabled', reasoningEffort: 'high' }),
    event('ai_budget_settled', { chargedMicros: 15, state: row.state, upstreamAttempted: true, priceVersion: 'offline-price' })];
  mutateOriginals?.(originals);
  await writeFile(logPath, originals.map(e => JSON.stringify(e) + '\n').join(''), { flag: 'a' });
  o.receipts.journeyBinding.accountingTrace = await capturePilotAccountingTrace(registration.config.serverAccountingLog, before, o.receipts.journeyBinding.httpOriginals);
  return { logPath, before, h, row, originals };
}

test('public twelve are new fictional identities with six groups, viewports and complete scenario coverage', async () => {
  const document = validateCases(JSON.parse(await readFile(CASES_PATH)));
  assert.equal(document.cases.length, 12); assert.equal(OWNED_FILES.length, 5);
  assert.ok(document.cases.every(c => !c.caseId.startsWith('p_') && c.fictional));
  const duplicate = structuredClone(document); duplicate.cases[1].caseId = duplicate.cases[0].caseId;
  assert.throws(() => validateCases(duplicate), /unique/);
  const missing = structuredClone(document); missing.cases.pop(); assert.throws(() => validateCases(missing), /twelve/);
});
test('changed comparison60 selection, performance reuse, auto paid retry and unbounded funding are rejected', async t => {
  const { config } = await setup(t);
  for (const mutate of [c => c.comparison60Selection = 'replace_with_B_C', c => c.performanceOverlap = true, c => c.automaticPaidRetries = true, c => c.spend.callLimit = Infinity, c => c.spend.fundingLimitMicros = 0]) {
    const invalid = structuredClone(config); mutate(invalid); assert.throws(() => validateConfig(invalid));
  }
  assert.equal(isHash(H + '\n'), false);
  const smallerFunding = structuredClone(config); smallerFunding.spend.hardLimitMicros = 2000000;
  assert.equal(validateConfig(smallerFunding), smallerFunding); // Separate finite funding and run caps need not be equal.
});
test('registration binds actual public cases, owned harness, source snapshots and authorization bytes', async t => {
  const { registration, config } = await setup(t);
  await validateRegistration(registration); assert.equal(registration.harness.length, 5);
  await writeFile(config.nonRankingSourceSnapshot.path, 'changed');
  await assert.rejects(validateRegistration(registration), /bytes_changed/);
});
test('v2 pilot config requires explicit new-document continuation while default and calibration remain closed', async t => {
  const { config } = await continuationFixture(t);
  assert.equal(validateConfig(config), config); // Shape only; fake proof cannot authorize registration.
  for (const patch of [{ pilotContinuation: undefined }, { phase: 'calibration', authorizedPhase: 'calibration' },
    { authorizationPolicySource: 'docs/v7/compact-output-contract-20261110.md' },
    { pilotContinuation: { ...config.spend.pilotContinuation, complete: 2 } }]) {
    assert.throws(() => validateConfig({ ...config, spend: { ...config.spend, ...patch } }), /rank_nonthinking_verified_continuation_required/);
  }
});
test('v2 registration verifies actual passed proof bytes and current authorization instead of trusting marker booleans', async t => {
  const { config, registration } = await continuationFixture(t);
  await assert.rejects(registerPilot(config), /ENOENT/);
  await assert.rejects(validateRegistration(registration), /ENOENT/);
  const changed = structuredClone(config);
  changed.spend.authorizationPolicySha256 = H; changed.spendAuthorization.sha256 = H;
  await assert.rejects(registerPilot(changed), /continuation_authorization_bytes_changed/);
});
test('v2 original evidence checks actual absent wire effort and sampling, retaining failures without manufacturing success', async t => {
  const { config, registration } = await continuationFixture(t), intent = fixtureIntent(registration);
  const original = fakeObservation(registration.cases[0], intent, registration), call = original.receipts.calls[0];
  call.call_thinking = 'disabled';
  Object.assign(call.originalReceipt.receipt, { operation: 'competition_v7_rank', thinking: 'disabled', policyReasoningEffort: 'low', wireReasoningEffort: null,
    temperature: 0, topP: 1, effortPolicySha256: config.spend.effortPolicySha256 });
  assert.equal(analyzePilotEvidence(original.receipts, intent, registration).valid, true);
  for (const patch of [{ reasoningEffort: 'low' }, { wireReasoningEffort: 'low' }, { temperature: 1 }, { topP: 0.95 }, { operation: 'competition_v7_review' }]) {
    const changed = structuredClone(original); Object.assign(changed.receipts.calls[0].originalReceipt.receipt, patch);
    assert.ok(analyzePilotEvidence(changed.receipts, intent, registration).issues.includes('original_call_model_settings_mismatch'));
  }
  const fakeSuccess = structuredClone(original);
  fakeSuccess.receipts.calls[0].originalReceipt = { kind: 'result', result: { ok: true, upstreamAttempted: true, model: 'deepseek-flash', httpStatus: 200, finishReason: 'stop', durationMs: 1, attempts: 1, data: {} } };
  assert.ok(analyzePilotEvidence(fakeSuccess.receipts, intent, registration).issues.includes('original_call_model_settings_mismatch'));
  const withoutMarker = structuredClone(registration); delete withoutMarker.config.spend.pilotContinuation;
  assert.ok(analyzePilotEvidence(original.receipts, intent, withoutMarker).issues.includes('rank_nonthinking_continuation_missing_or_changed'));
});
test('failed and unstarted slots stay in denominator and cannot produce a finite passing p95', async t => {
  const { registration } = await setup(t), intent = { intentId: 'fixture-intent', caseId: registration.cases[0].caseId, sessionId: registration.sessions[0].sessionId, registrationSha256: H, caseInputSha256: registration.sessions[0].caseInputSha256 };
  const observed = fakeObservation(registration.cases[0], intent, registration);
  const summary = summarizePilot(registration, [observed]);
  assert.equal(summary.denominator, 12); assert.equal(summary.notStarted, 11); assert.equal(summary.latency.listP95.valueMs, null);
  assert.equal(summary.pilotGatePassed, false); assert.equal(summary.formal60Executed, 0); assert.equal(summary.passed, 0); assert.equal(summary.fixturePassedNotLivePilot, 1);
});
test('server enqueue timing, negative duration, missing provider proof and mismatched sessions cannot pass', async t => {
  const { registration } = await setup(t), intent = { intentId: 'fixture-intent', caseId: registration.cases[0].caseId, sessionId: registration.sessions[0].sessionId, registrationSha256: H, caseInputSha256: registration.sessions[0].caseInputSha256 };
  for (const mutate of [o => o.timing.usedServerEnqueueAsStart = true, o => o.timing.listMs = -1, o => o.receipts.realProviderDispatch = false, o => o.receipts.allLedgerRowsAccounted = false, o => o.sessionId = 'foreign-session']) {
    const o = fakeObservation(registration.cases[0], intent, registration); mutate(o); assert.throws(() => validateObservation(o, intent, registration));
  }
});
test('strict saved-call shapes accept the real optional fields and reject receipt shells, false usage and unknown failure reasons', () => {
  const saved = { kind: 'receipt', receipt: { model: 'deepseek-flash', httpStatus: 200, finishReason: null, content: {}, durationMs: 0, attempts: 1 } };
  assert.equal(inspectPilotSavedCall(saved).responseObserved, true); // No requestId or usage is promised by the actual type.
  for (const mutate of [s => delete s.receipt, s => delete s.receipt.content, s => s.receipt.attempts = 2,
    s => s.receipt.usage = { inputTokens: 1, outputTokens: 1, cachedInputTokens: 2 }, s => s.receipt.requestId = '', s => s.receipt.durationMs = -1]) {
    const invalid = structuredClone(saved); mutate(invalid); assert.equal(inspectPilotSavedCall(invalid).valid, false);
  }
  assert.equal(inspectPilotSavedCall({ kind: 'result', result: { ok: false, model: 'deepseek-flash', upstreamAttempted: false, reason: 'invented' } }).valid, false);
  assert.equal(inspectPilotSavedCall({ kind: 'result', result: { ok: false, model: 'deepseek-flash', upstreamAttempted: true, reason: 'durable_outcome_unknown' } }).uncertain, true);
});
test('passed proof is recomputed from raw call, ledger, HTTP, input and source originals rather than flags', async t => {
  const { registration } = await setup(t), intent = fixtureIntent(registration), c = registration.cases[0];
  assert.doesNotThrow(() => validateObservation(fakeObservation(c, intent, registration), intent, registration));
  const mutations = [o => o.receipts.calls = [], o => o.receipts.calls[0].originalReceipt = { kind: 'receipt' },
    o => o.receipts.ledgerRows.push({ ...o.receipts.ledgerRows[0], id: 'unrelated-charged-row' }),
    o => o.receipts.calls.push({ ...o.receipts.calls[0], call_id: 'second-call-sharing-reservation' }),
    o => o.receipts.calls[0].product_run_id = 'foreign-run', o => o.receipts.calls[0].prompt_sha256 = 'wrong',
    o => o.receipts.ledgerRows[0].input_tokens = '3', o => o.receipts.cost.accountingCny = 0,
    o => o.receipts.journeyBinding.httpOriginals[0].requestBody = '{}',
    o => o.receipts.journeyBinding.httpOriginals[0].responseHeaderRequestId = 'foreign-request',
    o => o.receipts.journeyBinding.caseInputSha256 = 'b'.repeat(64), o => o.receipts.runSnapshots[0].stateKey = 'b'.repeat(64),
    o => o.receipts.runSnapshots[0].body.context.records = [], o => o.receipts.ledgerRows[0].charged_micros = '01'];
  for (const mutate of mutations) { const o = fakeObservation(c, intent, registration); mutate(o); assert.throws(() => validateObservation(o, intent, registration)); }
});
test('registration rejects duplicates and permuted order while coordinator resolves exact case identity defensively', async t => {
  const { registration, dir } = await setup(t);
  const duplicate = structuredClone(registration); duplicate.sessions[1] = { ...duplicate.sessions[0] };
  await assert.rejects(validateRegistration(duplicate));
  registration.sessions.reverse(); await assert.rejects(validateRegistration(registration), /canonical_case_session_order/);
  const driver = fakeDriver(registration); const originalRun = driver.runCase;
  driver.runCase = async (c, intent) => { assert.equal(intent.caseInputSha256, canonicalHash(c)); assert.equal(intent.sessionId, `${registration.config.studyId}:${c.caseId}`); return originalRun(c, intent); };
  const result = await executePilot(Buffer.from(JSON.stringify(registration)), { output: path.join(dir, 'permuted'), driver, limit: 1 });
  assert.equal(result.manifest.passed, 0); assert.equal(result.manifest.fixturePassedNotLivePilot, 1);
});
test('explicit unpaid and zero cancelled originals remain, but unexplained cancellations cannot disappear', async t => {
  const { registration } = await setup(t), intent = fixtureIntent(registration), o = fakeObservation(registration.cases[0], intent, registration);
  const cancelled = { ...o.receipts.ledgerRows[0], id: 'cancelled-reservation', state: 'cancelled', charged_micros: '0', input_tokens: null, output_tokens: null, cached_input_tokens: null };
  const unpaid = { call_id: 'unpaid-call', call_key: 'v7.review', prompt_sha256: H, product_run_id: o.receipts.productRunIds[0], call_state: 'completed', originalReceipt: { kind: 'result', result: { ok: false, reason: 'capacity_exhausted', model: 'deepseek-flash', upstreamAttempted: false, attempts: 0 } } };
  o.receipts.calls.push(unpaid);
  assert.doesNotThrow(() => validateObservation(o, intent, registration));
  o.receipts.ledgerRows.push(cancelled); assert.throws(() => validateObservation(o, intent, registration), /unmatched_new_ledger_row/);
  o.receipts.calls.push({ ...o.receipts.calls[0], ...unpaid, call_key: 'v7.rank', call_id: 'cancelled-call', reservation_id: cancelled.id, spend_run_id: cancelled.run_id, phase: cancelled.phase, model: cancelled.model, effort: cancelled.effort });
  assert.doesNotThrow(() => validateObservation(o, intent, registration));
  o.receipts.ledgerRows[1].charged_micros = '1'; assert.throws(() => validateObservation(o, intent, registration));
});
test('duplicate request IDs and chat call keys without the exact captured request remain ambiguous', async t => {
  const { registration } = await setup(t), intent = fixtureIntent(registration), o = fakeObservation(registration.cases[0], intent, registration);
  o.receipts.journeyBinding.httpOriginals.push({ ...o.receipts.journeyBinding.httpOriginals[0], requestBody: '{"differentInput":true}', requestBodySha256: byteHash('{"differentInput":true}') });
  assert.throws(() => validateObservation(o, intent, registration), /http_request_original_identity/);
  const chat = fakeObservation(registration.cases[0], intent, registration); chat.receipts.calls[0].call_key = 'chat:uncaptured-client-request:v7.chat';
  assert.throws(() => validateObservation(chat, intent, registration), /chat_call_must_match/);
});
test('a real-shaped chat call must retain both its parent run membership and exact captured client request ID', async t => {
  const { registration } = await setup(t), intent = fixtureIntent(registration), o = fakeObservation(registration.cases[0], intent, registration);
  const initial = JSON.parse(Buffer.from(o.receipts.journeyBinding.httpOriginals[0].responseBodyBase64, 'base64'));
  const clientRequestId = 'synthetic-chat-client-id';
  o.receipts.journeyBinding.httpOriginals.push(fakeHttp(intent, 'synthetic-chat-transport-id', '/api/ai/competition-chat', { requestId: clientRequestId, decisionToken: initial.decisionToken }, { requestId: clientRequestId, decisionToken: initial.decisionToken, message: 'OFFLINE ONLY' }));
  const row = { ...o.receipts.ledgerRows[0], id: 'synthetic-chat-reservation', effort: 'high', operation: 'competition_v7_chat' }; o.receipts.ledgerRows.push(row);
  o.receipts.calls.push({ ...o.receipts.calls[0], call_id: 'synthetic-chat-call', operation: row.operation, call_operation: row.operation, effort: row.effort, call_reasoning_effort: row.effort, call_key: `chat:${clientRequestId}:v7.chat`, reservation_id: row.id });
  o.receipts.cost.accountingCny = 0.00002;
  assert.doesNotThrow(() => validateObservation(o, intent, registration));
  o.receipts.calls[1].product_run_id = 'foreign-run'; assert.throws(() => validateObservation(o, intent, registration), /product_run_membership/);
});
test('cross-session request ID reuse makes both original slots ambiguous and stops new scheduling', async t => {
  const { registration, bytes, dir } = await setup(t), driver = fakeDriver(registration);
  driver.runCase = async (c, intent) => {
    driver.counts.run++;
    const o = fakeObservation(c, intent, registration), h = o.receipts.journeyBinding.httpOriginals[0];
    h.requestId = 'reused-client-header'; h.responseHeaderRequestId = h.requestId;
    return o;
  };
  const output = path.join(dir, 'cross-session-ambiguity'), first = await executePilot(bytes, { output, driver });
  assert.equal(driver.counts.run, 2); assert.equal(first.manifest.indeterminate, 2); assert.equal(first.manifest.notStarted, 10);
  assert.equal(first.manifest.passed, 0); assert.equal(first.manifest.fixturePassedNotLivePilot, 0);
  assert.equal(JSON.parse(await readFile(path.join(output, '01-fictional-pilot-01/observation.json'))).status, 'passed'); // Preserve originals; aggregate detects ambiguous ownership.
  const resumed = fakeDriver(registration); await executePilot(bytes, { output, driver: resumed, resume: true }); assert.equal(resumed.counts.run, 0);
});
test('normalize costs require exact whitelisted server trace, original HTTP and ledger identity with no copied unrelated logs', async t => {
  const { registration, dir } = await setup(t), intent = fixtureIntent(registration), o = fakeObservation(registration.cases[0], intent, registration);
  const { h } = await addNormalizeTraceFixture(dir, registration, intent, o);
  const proof = analyzePilotEvidence(o.receipts, intent, registration); assert.equal(proof.valid, true, JSON.stringify(proof.issues));
  assert.equal(proof.nonDurableNormalizeProofClass, 'metadata_dispatch_and_http_only_not_original_provider_response');
  assert.equal(proof.ledgerClosure.filter(l => l.owners[0].startsWith('metadata_dispatch:')).length, 1);
  assert.equal(JSON.stringify(o.receipts.journeyBinding.accountingTrace).includes('UNRELATED-SECRET'), false);
  for (const mutate of [x => x.receipts.journeyBinding.accountingTrace.events[1].details.reservationId = 'foreign',
    x => x.receipts.journeyBinding.accountingTrace.events[1].originalLineSha256 = H,
    x => x.receipts.journeyBinding.accountingTrace.prefixSha256After = H,
    x => x.receipts.journeyBinding.httpOriginals[0].requestId = 'foreign-http-id']) {
    const invalid = structuredClone(o); mutate(invalid); assert.throws(() => validateObservation(invalid, intent, registration));
  }
  delete h.responseBodyBase64; delete h.responseBodySha256; delete h.responseHeaderRequestId; delete h.status;
  const unknown = analyzePilotEvidence(o.receipts, intent, registration); assert.equal(unknown.valid, false); assert.equal(unknown.uncertain, true);
  assert.equal(unknown.unmatchedLedgerIds.length, 0); assert.equal(o.receipts.ledgerRows.length, 2); // Attribution does not invent response success.
  assert.throws(() => validateObservation(o, intent, registration));
});
test('staged normalize proof rejects rehashed reserved or settled operation and effort policy mismatches', async t => {
  const policy = { version: 'saitu.effort-policy.v1', rank: 'high', explain: 'low', review: 'high' }, hash = effortPolicySha256(policy);
  const mutations = [null, events => events[0].details.operation = 'competition_v7_extract', events => events[0].details.effortPolicySha256 = '0'.repeat(64),
    events => events[2].details.operation = 'competition_v7_chat', events => events[2].details.effortPolicySha256 = '0'.repeat(64), events => events[2].details.effort = 'low'];
  for (const mutate of mutations) {
    const { registration, dir } = await setup(t);
    Object.assign(registration.config.spend, { grantVersion: EFFORT_GRANT_VERSION, authorizedEffort: 'stage', effortPolicy: policy, effortPolicySha256: hash });
    const intent = fixtureIntent(registration), o = fakeObservation(registration.cases[0], intent, registration);
    await addNormalizeTraceFixture(dir, registration, intent, o, mutate);
    const proof = analyzePilotEvidence(o.receipts, intent, registration);
    if (mutate) { assert.equal(proof.valid, false); assert.ok(proof.issues.includes('normalize_reservation_settlement_effort_policy_mismatch'), JSON.stringify(proof.issues)); }
    else assert.equal(proof.valid, true, JSON.stringify(proof.issues));
  }
});
test('trace rotation, partial writes and unexpected fields block proof without copying unrelated output', async t => {
  const { registration, dir } = await setup(t), intent = fixtureIntent(registration), o = fakeObservation(registration.cases[0], intent, registration);
  const { logPath, before, originals } = await addNormalizeTraceFixture(dir, registration, intent, o), log = registration.config.serverAccountingLog;
  await writeFile(logPath, JSON.stringify({ ...originals[0], prompt: 'DO-NOT-COPY-INPUT' }) + '\n', { flag: 'a' });
  const unsafe = await capturePilotAccountingTrace(log, before, o.receipts.journeyBinding.httpOriginals);
  assert.equal(unsafe.complete, false); assert.equal(JSON.stringify(unsafe).includes('DO-NOT-COPY-INPUT'), false);
  await writeFile(logPath, '{"partial":', { flag: 'a' });
  assert.equal((await capturePilotAccountingTrace(log, before, o.receipts.journeyBinding.httpOriginals)).complete, false);
  await writeFile(logPath, 'rotated replacement\n');
  const rotated = await capturePilotAccountingTrace(log, before, o.receipts.journeyBinding.httpOriginals);
  assert.equal(rotated.complete, false); assert.ok(rotated.issues.includes('server_log_rotation_truncation_or_prefix_changed'));
});
test('unknown original result with retained charge stops future sessions and is never resumed or retried', async t => {
  const { registration, bytes, dir } = await setup(t), driver = fakeDriver(registration); let calls = 0;
  driver.runCase = async (c, intent) => { calls++; const o = fakeObservation(c, intent, registration, 'indeterminate');
    o.receipts.calls[0].call_state = 'unknown'; o.receipts.calls[0].originalReceipt = { kind: 'result', result: { ok: false, model: 'deepseek-flash', upstreamAttempted: true, reason: 'durable_outcome_unknown' } };
    return o;
  };
  const output = path.join(dir, 'retained-unknown'), first = await executePilot(bytes, { output, driver });
  assert.equal(first.manifest.indeterminate, 1); assert.equal(first.manifest.notStarted, 11);
  const stored = JSON.parse(await readFile(path.join(output, '01-fictional-pilot-01/observation.json'))); assert.equal(stored.receipts.ledgerRows[0].charged_micros, '10');
  await executePilot(bytes, { output, driver, resume: true }); assert.equal(calls, 1);
});
test('user-unbounded pilot retains an attributed unknown, continues independent journeys and closes all originals before resume', async t => {
  const { registration, bytes, dir } = await setup(t, true), driver = fakeDriver(registration);
  let active = 0, peak = 0, finalized = 0;
  Object.assign(driver, { supportsConcurrentCases: true, sampleResources: () => ({ initialConcurrency: 2, capacity: 3 }),
    finalize: async observations => { finalized++; assert.equal(active, 0); assert.equal(observations.length, 12); return { valid: true, syntheticUnitFixtureOnly: true }; } });
  driver.runCase = async (c, intent, _directory, feedback) => {
    driver.counts.run++; peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 2));
    const o = fakeObservation(c, intent, registration, c === registration.cases[0] ? 'indeterminate' : 'passed');
    if (c.caseId === registration.cases[0].caseId) {
      o.status = 'indeterminate'; o.receipts.calls[0].call_state = 'unknown';
      o.receipts.calls[0].originalReceipt = { kind: 'result', result: { ok: false, model: 'deepseek-flash', upstreamAttempted: true, reason: 'durable_outcome_unknown' } };
      o.receipts.ledgerRows[0].state = 'conservative';
      await feedback({ backpressure: true, durationMs: 1, reason: 'synthetic_driver_exact_original' });
    }
    active--; return o;
  };
  const output = path.join(dir, 'unbounded-originals'), first = await executePilot(bytes, { output, driver });
  assert.equal(driver.counts.run, 12); assert.ok(peak > 1); assert.ok(peak <= 3); assert.equal(finalized, 1);
  assert.equal(first.manifest.indeterminate, 1); assert.equal(first.manifest.notStarted, 0); assert.equal(first.manifest.pilotGatePassed, false);
  assert.deepEqual(first.manifest.blockers, []); assert.equal(first.manifest.finalAccounting.valid, true);
  const events = (await readFile(first.manifest.schedulingTrace.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.filter(e => e.feedback?.reason === 'synthetic_driver_exact_original').length, 1);
  assert.equal(events.filter(e => e.feedback?.reason === 'case_unknown_original_retained_no_retry').length, 0);
  const resumed = fakeDriver(registration); Object.assign(resumed, { supportsConcurrentCases: true,
    finalize: async observations => { assert.equal(observations.length, 12); return { valid: true }; } });
  await executePilot(bytes, { output, driver: resumed, resume: true });
  assert.equal(resumed.counts.initialized, 1); assert.equal(resumed.counts.run, 0); assert.equal(resumed.counts.closed, 1);
});
test('user-unbounded pre-enqueue normalize timeout proves ownership without inventing a completed journey', async t => {
  const { registration, dir } = await setup(t, true), intent = fixtureIntent(registration), o = fakeObservation(registration.cases[0], intent, registration, 'indeterminate');
  const { h, row } = await addNormalizeTraceFixture(dir, registration, intent, o, originals => originals.pop());
  row.state = 'reserved'; row.charged_micros = null;
  o.receipts.calls = []; o.receipts.productRunIds = []; o.receipts.runSnapshots = []; o.receipts.ledgerRows = [row];
  o.receipts.journeyBinding.httpOriginals = [h]; o.receipts.cost.accountingCny = 0.00002;
  for (const k of ['responseBodyBase64', 'responseBodySha256', 'responseHeaderRequestId', 'status']) delete h[k];
  const proof = analyzePilotEvidence(o.receipts, intent, registration);
  assert.equal(proof.ownershipVerified, true, JSON.stringify(proof)); assert.equal(proof.valid, false); assert.equal(proof.uncertain, true);
  assert.ok(proof.flowIssues.includes('one_original_initial_submission_required')); assert.deepEqual(proof.unmatchedLedgerIds, []);
  o.receipts.journeyBinding.accountingTrace.events.pop(); // A reserved original may still be waiting before HTTP dispatch.
  assert.equal(analyzePilotEvidence(o.receipts, intent, registration).ownershipVerified, true);
  row.reserved_micros = '0'; assert.equal(analyzePilotEvidence(o.receipts, intent, registration).ownershipVerified, false);
});
test('user-unbounded pilot refuses to close a batch with missing final reservation ownership', async t => {
  const { registration, bytes, dir } = await setup(t, true), driver = fakeDriver(registration);
  Object.assign(driver, { supportsConcurrentCases: true, sampleResources: () => ({ initialConcurrency: 2, capacity: 3 }),
    finalize: async () => ({ valid: false, unmatchedLedgerIds: ['synthetic-unmatched-original'] }) });
  const result = await executePilot(bytes, { output: path.join(dir, 'unclosed-batch'), driver });
  assert.equal(driver.counts.run, 12); assert.ok(result.manifest.blockers.includes('final_batch_accounting_not_closed_originals_retained'));
  assert.equal(result.manifest.finalAccounting.valid, false);
});
test('one failed original remains failed after all twelve and resume never reissues it', async t => {
  const { registration, bytes, dir } = await setup(t), driver = fakeDriver(registration, { failCase: 'fictional-pilot-03' }), output = path.join(dir, 'run');
  const result = await executePilot(bytes, { output, driver });
  assert.equal(driver.counts.run, 12); assert.equal(result.manifest.passed, 0); assert.equal(result.manifest.fixturePassedNotLivePilot, 11); assert.equal(result.manifest.failed, 1); assert.equal(result.manifest.latency.allDetailsP95.valueMs, null);
  const resumed = fakeDriver(registration); await executePilot(bytes, { output, driver: resumed, resume: true });
  assert.equal(resumed.counts.run, 0); assert.equal(resumed.counts.initialized, 0);
});
test('unknown driver completion is indeterminate and halts later dispatch, including resume', async t => {
  const { registration, bytes, dir } = await setup(t), driver = fakeDriver(registration, { throwCase: 'fictional-pilot-01' }), output = path.join(dir, 'run');
  const r = await executePilot(bytes, { output, driver }); assert.equal(r.manifest.indeterminate, 1); assert.equal(r.manifest.notStarted, 11);
  const resumed = fakeDriver(registration); const later = await executePilot(bytes, { output, driver: resumed, resume: true });
  assert.equal(resumed.counts.run, 0); assert.equal(later.manifest.indeterminate, 1);
});
test('orphaned pre-dispatch intent is not automatically retried or replaced', async t => {
  const { registration, bytes, dir } = await setup(t), output = path.join(dir, 'run');
  await mkdir(output); await mkdir(path.join(output, 'manifests')); await writeFile(path.join(output, 'registration.json'), bytes);
  const slot = path.join(output, '01-fictional-pilot-01'); await mkdir(slot);
  await writeFile(path.join(slot, 'intent.json'), JSON.stringify({ registrationSha256: byteHash(bytes), intentId: 'synthetic-crash-intent',
    caseId: registration.cases[0].caseId, sessionId: registration.sessions[0].sessionId, caseInputSha256: registration.sessions[0].caseInputSha256 }));
  const later = fakeDriver(registration), result = await executePilot(bytes, { output, driver: later, resume: true });
  assert.equal(later.counts.run, 0); assert.equal(result.manifest.indeterminate, 1); assert.equal(result.manifest.denominator, 12);
});
test('resume rejects changed completed evidence instead of silently accepting or replacing it', async t => {
  const { registration, bytes, dir } = await setup(t), output = path.join(dir, 'run');
  await executePilot(bytes, { output, driver: fakeDriver(registration), limit: 1 });
  const original = path.join(output, '01-fictional-pilot-01/observation.json'); await writeFile(original, '{}');
  const driver = fakeDriver(registration);
  await assert.rejects(executePilot(bytes, { output, driver, resume: true }), /bytes_changed/); assert.equal(driver.counts.run, 0);
});
test('budget and initialize rejection before intent retain all twelve unstarted slots without a model call', async t => {
  const { registration, bytes, dir } = await setup(t);
  for (const failure of ['admissionFailure', 'initializeFailure']) {
    const driver = fakeDriver(registration, { [failure]: true }), out = path.join(dir, failure);
    const r = await executePilot(bytes, { output: out, driver }); assert.equal(r.manifest.notStarted, 12); assert.equal(driver.counts.run, 0); assert.equal(driver.counts.closed, 1);
    assert.equal((await readdir(out)).some(name => name.startsWith('01-')), false);
  }
});
test('exclusive output and same-host live coordinator lock prevent duplicate paid scheduling', async t => {
  const { registration, bytes, dir } = await setup(t), output = path.join(dir, 'run');
  let release, entered; const signal = new Promise(resolve => { entered = resolve; });
  const driver = fakeDriver(registration); driver.beforeCase = async () => { entered(); await new Promise(resolve => { release = resolve; }); return { beforeLedgerIds: [] }; };
  const running = executePilot(bytes, { output, driver, limit: 1 }); await signal;
  await assert.rejects(executePilot(bytes, { output, driver: fakeDriver(registration), resume: true }), /dead_lock_takeover/);
  release(); await running;
  await assert.rejects(executePilot(bytes, { output, driver: fakeDriver(registration) }), /EEXIST/);
});
test('explicit lock takeover needs exact bytes and dead same-host PID', async t => {
  const { registration, bytes, dir } = await setup(t), output = path.join(dir, 'run');
  await executePilot(bytes, { output, driver: fakeDriver(registration), limit: 1 });
  const lock = Buffer.from(JSON.stringify({ hostname: os.hostname(), pid: 2147483647 })); await writeFile(path.join(output, 'coordinator.lock.json'), lock);
  await assert.rejects(executePilot(bytes, { output, driver: fakeDriver(registration), resume: true, takeoverLockSha256: H }), /takeover/);
  const r = await executePilot(bytes, { output, driver: fakeDriver(registration), resume: true, takeoverLockSha256: byteHash(lock), limit: 1 });
  assert.equal(r.manifest.passed, 0); assert.equal(r.manifest.fixturePassedNotLivePilot, 2); assert.ok((await readdir(output)).some(n => n.startsWith('dead-lock-')));
});
test('CLI describe is zero-model and accidental --run cannot initialize live transport', () => {
  const tool = path.join(ROOT, 'scripts/competitions/v7/pilot-executor.mjs');
  const description = JSON.parse(execFileSync(process.execPath, [tool, '--describe'], { encoding: 'utf8' }));
  assert.equal(description.paidCalls, 0); assert.equal(description.comparison60Selection, COMPARISON_60_SELECTION);
  assert.throws(() => execFileSync(process.execPath, [tool, '--run', '--output', '/unused-pilot-path'], { stdio: 'pipe', env: { ...process.env, RUN_V7_PILOT_LIVE: '0' } }), /Command failed/);
});
test('explicit correction validates actual adopted facts and rejects stale or contradictory budgets', () => {
  const before = { runId: 'fixture-old', profileId: 'fixture-profile', profileRevision: 'r1' }, correction = { field: 'budget.maximumYuan', value: 100 };
  const next = { runId: 'fixture-new', profileId: before.profileId, profileRevision: 'r2', profile: { facts: [{ field: correction.field, value: 100, state: 'affirmed', confirmed: true }] } };
  assert.equal(assertCorrection({ payload: { run: next } }, before, correction), next);
  assert.throws(() => assertCorrection({ payload: { run: before } }, before, correction), /fresh_run/);
  const bad = structuredClone(next); bad.profile.facts.push({ field: correction.field, value: 300, state: 'affirmed', confirmed: true });
  assert.throws(() => assertCorrection({ payload: { run: bad } }, before, correction), /old_budget/);
});
test('offline Playwright fixture exercises real adapter chat selectors and original-click clock across reload, with zero model requests', async t => {
  let postCount = 0;
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><button id="submit">fixture submit</button><div data-testid="decision-report-v7" data-run-id="fixture-only" data-run-status="ready" hidden>共 1 项<article data-testid="recommendation-run-item" data-detail-status="ready">fixture reason</article></div><section data-testid="decision-chat-v7"><label for="chat">想追问或更正什么？</label><textarea id="chat"></textarea><button id="send">发送</button><p id="reply"></p></section><script>const report=document.querySelector('[data-testid="decision-report-v7"]');if(sessionStorage.getItem('fixture-clock'))report.hidden=false;document.querySelector('#submit').onclick=()=>report.hidden=false;document.querySelector('#send').onclick=async()=>{const response=await fetch('/api/ai/competition-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'fixture-request',expectedRevision:'r1',action:{type:'message',text:document.querySelector('#chat').value}})});const data=await response.json();document.querySelector('#reply').textContent=data.message;};</script></body></html>`;
  const server = createServer(async (req, res) => {
    if (req.url === '/api/ai/competition-chat') { postCount++; let body = ''; for await (const chunk of req) body += chunk; const input = JSON.parse(body); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ responseVersion: 'competition-decision-chat.v7', requestId: input.requestId, profileRevision: 'r1', message: 'OFFLINE FIXTURE REPLY; NO MODEL CALLED' })); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(html); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}); t.after(() => browser.close());
  const context = await browser.newContext(); await context.addInitScript(pilotProbeBootstrap, { key: 'fixture-clock' });
  const page = await context.newPage(); page.setDefaultTimeout(5000); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const start = await startPilotClock(page, 'fixture-clock'); await page.locator('#submit').click();
  await page.waitForFunction(() => window.__saituPilotProbe?.listMs !== null && window.__saituPilotProbe?.allDetailsMs !== null);
  const first = await page.evaluate(() => window.__saituPilotProbe); assert.equal(first.originalClickEpochMs, start); assert.ok(first.listMs >= 0);
  const reply = await sendPilotChat(page, 'Offline adapter selector test; not a real learner.'); assert.equal(reply.payload.profileRevision, 'r1'); assert.equal(postCount, 1);
  await page.reload(); await page.waitForFunction(() => Boolean(window.__saituPilotProbe));
  const restored = await page.evaluate(() => window.__saituPilotProbe); assert.equal(restored.originalClickEpochMs, start); assert.equal(restored.listMs, first.listMs); assert.equal(postCount, 1);
});
