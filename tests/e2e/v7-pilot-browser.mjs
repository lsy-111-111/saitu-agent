import { readFile, readdir, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import pg from 'pg';
import { chromium, devices, expect } from '@playwright/test';
import { fillPublicBrowserProfile, installPublicBrowserProbe } from './v7-public-browser.mjs';
import { browserEffortRuntime, assertBrowserEffortEnvironment, assertBrowserEffortGrant, browserLedgerEffortMatches, browserCallEffortMatches, hasBrowserBoundProviderDispatch, isBrowserUserUnbounded, assertBrowserLiveExecutionMode, assertBrowserDatabaseLimits, assertBrowserWorkerExecutionMode } from './v7-browser-effort.mjs';
import { installBrowserExecutionAuthorization } from './v7-browser-execution.mjs';
import { createBrowserResourceSampler, BROWSER_SCHEDULING_POLICY } from './v7-browser-scheduling.mjs';
import { classifyBrowserOriginalScheduling } from './v7-browser-originals.mjs';
import { browserDeliveryTimeout, waitForBrowserDelivery, browserDeliveryLimits } from './v7-browser-timing.mjs';
import { runtimeBehaviorConfiguration, runtimeBehaviorConfigurationHash } from '../../scripts/competitions/v7/evaluation-runtime.mjs';
import { runtimeConfigurationHash } from '../../scripts/competitions/v6/runtime-configuration.mjs';
import { POLICY_SHA256 } from '../../scripts/competitions/v7/evaluation-policy.mjs';
import { installSourceLoader } from '../../scripts/lib/load-typescript-source.mjs';
import { assert, byteHash, canonicalHash, isHash, boundBytes, writeNew, binding, PIN_KEYS, ROOT, validateRegistration, analyzePilotEvidence } from '../../scripts/competitions/v7/pilot-contract.mjs';
const exec = promisify(execFile);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const runPath = pathname => /^\/api\/ai\/competition-recommend\/runs\/[^/]+$/.test(pathname);
const accountingPaths = new Set(['/api/competitions/recommend/normalize', '/api/ai/competition-clarify', '/api/ai/competition-recommend', '/api/ai/competition-chat']);
export const safePilotError = error => [process.env.AI_API_KEY, process.env.DATABASE_URL, process.env.AI_CONVERSATION_SIGNING_SECRET].filter(Boolean)
  .reduce((s, secret) => s.split(secret).join('[REDACTED]'), error instanceof Error ? error.message : String(error));

/** Supplemental wall/monotonic bridge persists the original click epoch across
 * document reloads. The existing public probe is also retained in the original
 * document. No server enqueue timestamp is used as a start time. */
export function pilotProbeBootstrap({ key }) {
  const inspect = () => {
    const stored = sessionStorage.getItem(key); if (!stored) return;
    const p = JSON.parse(stored), report = document.querySelector('[data-testid="decision-report-v7"]'); if (!report) return;
    const cards = [...report.querySelectorAll('[data-testid="recommendation-run-item"]')];
    const now = performance.timeOrigin + performance.now(), elapsed = now - p.originalClickEpochMs;
    const currentList = !report.dataset.displayRunId || report.dataset.displayRunId === report.dataset.runId;
    if (cards.length && currentList && p.listMs === null) p.listMs = elapsed;
    p.activeRunId = report.dataset.runId; p.terminalStatus = report.dataset.runStatus;
    const operation = p.runTimings?.[p.activeRunId];
    if (operation && cards.length && currentList && operation.listMs === null) operation.listMs = now - operation.originalClickEpochMs;
    const expected = Number(report.dataset.totalItems ?? report.textContent.match(/共\s+(\d+)\s+项/)?.[1] ?? cards.length);
    if (currentList && report.dataset.runStatus === 'ready' && cards.length > 0 && cards.length === expected && cards.every(c => c.dataset.detailStatus === 'ready')) {
      if (p.allDetailsMs === null) { p.allDetailsMs = elapsed; p.allDetailsRunId = p.activeRunId; }
      if (operation && operation.allDetailsMs === null) operation.allDetailsMs = now - operation.originalClickEpochMs;
      p.latestReadyRunId = p.activeRunId; p.latestReadyMs = elapsed;
    }
    sessionStorage.setItem(key, JSON.stringify(p)); window.__saituPilotProbe = p;
  };
  new MutationObserver(inspect).observe(document, { childList: true, subtree: true, attributes: true });
  document.addEventListener('DOMContentLoaded', inspect);
  window.__saituInspectPilot = inspect;
}
export async function startPilotClock(page, key) {
  await installPublicBrowserProbe(page);
  return page.evaluate(key => {
    const p = { originalClickEpochMs: performance.timeOrigin + performance.now(), originalClickPerformanceMs: performance.now(),
      probeInstalledBeforeOriginalClick: true, usedServerEnqueueAsStart: false, listMs: null, allDetailsMs: null,
      readyExpansionMs: null, activeRunId: null, allDetailsRunId: null, terminalStatus: null, runTimings: {} };
    sessionStorage.setItem(key, JSON.stringify(p)); window.__saituPilotProbe = p; return p.originalClickEpochMs;
  }, key);
}
export async function bindPilotRunClock(page, key, runId, originalClickEpochMs) {
  return page.evaluate(({ key, runId, originalClickEpochMs }) => {
    const p = JSON.parse(sessionStorage.getItem(key)); p.runTimings ??= {};
    const existing = p.runTimings[runId];
    if (existing && existing.originalClickEpochMs !== originalClickEpochMs) throw new Error('pilot_run_clock_cannot_restart');
    p.runTimings[runId] ??= { originalClickEpochMs, listMs: null, allDetailsMs: null };
    sessionStorage.setItem(key, JSON.stringify(p)); window.__saituInspectPilot?.();
  }, { key, runId, originalClickEpochMs });
}
export async function sendPilotChat(page, text, { timeoutMs = 50_000 } = {}) {
  const chat = page.getByTestId('decision-chat-v7'); await expect(chat).toBeVisible();
  await chat.getByRole('textbox', { name: '想追问或更正什么？', exact: true }).fill(text);
  const responsePending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/ai/competition-chat' && r.request().method() === 'POST', { timeout: timeoutMs });
  const clickEpochMs = await page.evaluate(() => performance.timeOrigin + performance.now());
  await chat.getByRole('button', { name: '发送', exact: true }).click();
  const response = await responsePending, request = response.request().postDataJSON(), payload = await response.json();
  assert(response.ok() && payload.responseVersion === 'competition-decision-chat.v7' && payload.requestId === request.requestId && payload.message?.trim(), 'actual_chat_response_binding_failed');
  await expect(chat.getByText(payload.message, { exact: true })).toBeVisible({ timeout: 5000 });
  return { request, payload, clickEpochMs, responseStatus: response.status() };
}
export function assertCorrection(reply, before, correction) {
  const next = reply.payload.run;
  assert(next?.runId && next.runId !== before.runId && next.profileId === before.profileId && next.profileRevision !== before.profileRevision, 'explicit_correction_must_adopt_fresh_run_revision');
  assert(next.profile?.facts?.some(f => f.field === correction.field && f.state === 'affirmed' && f.confirmed === true && canonicalHash(f.value) === canonicalHash(correction.value)), 'corrected_self_report_value_not_applied');
  assert(!next.profile.facts.some(f => f.field === correction.field && f.state === 'affirmed' && canonicalHash(f.value) !== canonicalHash(correction.value)), 'old_budget_still_active_after_correction');
  return next;
}

async function installPollFault(page, scenario, milliseconds, events) {
  let injected = false, armedOldRun = null, held = null, release;
  await page.route(/\/api\/ai\/competition-recommend\/runs\/[^/?]+$/, async route => {
    const request = route.request(); if (request.method() !== 'GET') return route.continue();
    const id = new URL(request.url()).pathname.split('/').at(-1);
    if (armedOldRun === id && !held) {
      const response = await route.fetch();
      held = { runId: id, responseSha256: byteHash(await response.body()), heldAt: Date.now() };
      events.push({ type: 'injected_read_only_old_poll_hold', ...held });
      await new Promise(resolve => { release = resolve; });
      await route.fulfill({ response }).catch(() => undefined); return;
    }
    if (!injected && scenario === 'poll_disconnect') {
      injected = true; events.push({ type: 'injected_read_only_poll_disconnect', runId: id, at: Date.now() });
      await route.abort('connectionfailed'); return;
    }
    if (!injected && scenario === 'poll_delay') {
      injected = true; const response = await route.fetch();
      events.push({ type: 'injected_read_only_poll_delay', runId: id, delayMs: milliseconds, responseSha256: byteHash(await response.body()), at: Date.now() });
      await delay(milliseconds); await route.fulfill({ response }); return;
    }
    await route.continue();
  });
  return { injected: () => injected, arm: runId => { armedOldRun = runId; }, held: () => held, release: () => release?.() };
}

const traceFields = {
  ai_budget_reserved: ['reservationId', 'phase', 'model', 'effort', 'operation', 'effortPolicySha256', 'reservedMicros', 'priceVersion'],
  ai_transport_dispatch: ['reservationId', 'model', 'attempt', 'operation', 'thinkingType', 'reasoningEffort', 'effortPolicySha256', 'maxTokens', 'deadlineEpochMs', 'invocationId', 'stage', 'reviewId'],
  ai_budget_settled: ['reservationId', 'chargedMicros', 'upstreamAttempted', 'state', 'priceVersion', 'operation', 'effort', 'effortPolicySha256'],
  ai_settlement_failed: ['reservationId'],
};
async function readLogOriginal(filename) {
  const file = await open(filename, 'r');
  try {
    const before = await file.stat(); assert(before.isFile() && before.size <= 64 * 1024 * 1024, 'finite_regular_server_log_required');
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) { const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset); assert(bytesRead > 0, 'server_log_truncated_during_capture'); offset += bytesRead; }
    const after = await file.stat(); assert(before.dev === after.dev && before.ino === after.ino && after.size >= bytes.length, 'server_log_identity_or_size_changed');
    return { bytes, device: before.dev, inode: before.ino };
  } finally { await file.close(); }
}
export async function snapshotPilotAccountingLog(log) {
  const { bytes, device, inode } = await readLogOriginal(log.path);
  assert(!bytes.length || bytes.at(-1) === 10, 'server_log_must_be_at_complete_line_before_dispatch');
  return { path: log.path, sourceSha256: log.sourceSha256, device, inode, byteOffset: bytes.length, prefixSha256: byteHash(bytes) };
}
export async function capturePilotAccountingTrace(log, before, httpOriginals) {
  const { bytes, device, inode } = await readLogOriginal(log.path), issues = [], events = [];
  const requestIds = new Set(httpOriginals.map(h => h.requestId));
  const identity = before.path === log.path && before.sourceSha256 === log.sourceSha256 && device === before.device && inode === before.inode && bytes.length >= before.byteOffset && byteHash(bytes.subarray(0, before.byteOffset)) === before.prefixSha256;
  if (!identity) issues.push('server_log_rotation_truncation_or_prefix_changed');
  const segment = bytes.subarray(Math.min(before.byteOffset, bytes.length));
  if (segment.length && segment.at(-1) !== 10) issues.push('server_log_last_line_incomplete');
  let offset = before.byteOffset;
  for (const line of segment.toString('utf8').split('\n')) {
    const lineBytes = Buffer.from(line), lineOffset = offset; offset += lineBytes.length + 1;
    let parsed; try { parsed = JSON.parse(line); } catch { continue; } // Never copy unrelated server output.
    if (parsed?.event !== 'competition_accounting_trace' || !requestIds.has(parsed.requestId) || !traceFields[parsed.type]) continue;
    const allowed = traceFields[parsed.type];
    if (Object.keys(parsed).some(k => !['event', 'requestId', 'time', 'type', 'details'].includes(k)) || !parsed.details || Object.keys(parsed.details).some(k => !allowed.includes(k))) { issues.push('unexpected_fields_in_accounting_trace_not_copied'); continue; }
    events.push({ ...parsed, byteOffset: lineOffset, originalLineBase64: lineBytes.toString('base64'), originalLineSha256: byteHash(lineBytes) });
  }
  return { path: log.path, sourceSha256: log.sourceSha256, deviceBefore: before.device, deviceAfter: device, inodeBefore: before.inode, inodeAfter: inode,
    startOffset: before.byteOffset, endOffset: bytes.length, prefixSha256Before: before.prefixSha256, prefixSha256After: byteHash(bytes.subarray(0, before.byteOffset)),
    segmentSha256: byteHash(segment), complete: issues.length === 0, issues, events,
    rawUnrelatedLogLinesCopied: false, ownershipRule: 'exact_captured_HTTP_request_id_then_reservation_id_not_time_or_batch' };
}

/** Parallel journeys own exact captured HTTP reservation IDs and actual run
 * call memberships. A time range or shared spend batch never assigns a row. */
export function selectPilotOwnedLedgerRows(allRows, calls, accountingTrace, httpOriginals) {
  const requestIds = new Set(httpOriginals.map(row => row.requestId)), owned = new Set(calls.map(call => call.reservation_id).filter(Boolean));
  const issues = [];
  for (const event of accountingTrace?.events ?? []) {
    if (!requestIds.has(event.requestId)) { issues.push('accounting_trace_contains_foreign_HTTP_identity'); continue; }
    if (event.details?.reservationId) owned.add(event.details.reservationId);
  }
  const rows = allRows.filter(row => owned.has(row.id));
  if ([...owned].some(id => !rows.some(row => row.id === id))) issues.push('owned_reservation_missing_from_actual_ledger');
  return { rows, issues, ownedReservationIds: [...owned], excludedOtherLedgerRows: allRows.length - rows.length,
    rule: 'exact_HTTP_request_and_actual_product_run_call_membership' };
}
export function pilotBatchLedgerClosure(allRows, observations) {
  const owners = new Map(), duplicateLedgerIds = new Set(), missingLedgerIds = [];
  for (const observation of observations) for (const row of observation.receipts?.ledgerRows ?? []) {
    if (owners.has(row.id)) duplicateLedgerIds.add(row.id);
    else owners.set(row.id, observation.caseId);
    if (!allRows.some(actual => actual.id === row.id)) missingLedgerIds.push(row.id);
  }
  const unmatchedLedgerIds = allRows.filter(row => !owners.has(row.id)).map(row => row.id);
  const unsettledLedgerIds = allRows.filter(row => row.state === 'reserved' || row.charged_micros === null).map(row => row.id);
  const unprotectedLedgerIds = allRows.filter(row => unsettledLedgerIds.includes(row.id) && (!Number.isSafeInteger(Number(row.reserved_micros)) || Number(row.reserved_micros) <= 0)).map(row => row.id);
  return { valid: !duplicateLedgerIds.size && !missingLedgerIds.length && !unmatchedLedgerIds.length && !unprotectedLedgerIds.length,
    ledgerRows: allRows.length, attributedRows: owners.size, duplicateLedgerIds: [...duplicateLedgerIds], missingLedgerIds, unmatchedLedgerIds, unsettledLedgerIds,
    unprotectedLedgerIds, unknownHoldsRemainFinanciallyReserved: !unprotectedLedgerIds.length,
    ownership: [...owners].map(([reservationId, caseId]) => ({ reservationId, caseId })), rule: 'one_original_reservation_one_journey_no_batch_or_time_assignment' };
}

export function createPilotBrowserDriver() {
  let registration, config, output, client, browser, unseal, verifyToken, allowedLedgerIds = new Set(), seenProductRunIds = new Set(), ordinal = 0;
  const activeJourneys = new Set();
  const resourceSampler = createBrowserResourceSampler();
  async function ledgerRows() { return (await client.query('select row_to_json(l) as raw from ai_spend_ledger l where run_id=$1 order by created_at,id', [config.spend.runId])).rows.map(r => r.raw); }
  async function livePins(label) {
    await validateRegistration(registration);
    assert(process.env.SAITU_V7_SOURCE_SHA256 === config.productPins.runtimeSourceBindingSha256, 'web_worker_same_frozen_source_required');
    assert(runtimeBehaviorConfigurationHash() === config.productPins.runtimeConfigurationSha256 && runtimeConfigurationHash() === config.productPins.executionRuntimeConfigurationSha256 && canonicalHash(runtimeBehaviorConfiguration().promptVersions) === canonicalHash(config.promptVersions), 'actual_runtime_or_prompt_binding_changed');
    const filename = path.join(output, `product-pins-${label}-${++ordinal}.json`);
    await exec(process.execPath, [path.join(ROOT, 'tests/e2e/v7-public-browser.mjs'), '--pins', '--output', filename], { cwd: ROOT, env: process.env, maxBuffer: 1024 * 1024 });
    const actual = JSON.parse(await readFile(filename));
    for (const key of PIN_KEYS) assert(actual[key] === config.productPins[key], `pilot_product_pin_changed:${key}`);
    const health = JSON.parse(await readFile(config.workerHealthFile));
    assertBrowserWorkerExecutionMode(health, config.spend);
    assert(health.schemaVersion === 'saitu.worker-health.v7' && health.sourceSha256 === config.productPins.runtimeSourceBindingSha256 && health.status === 'active' && health.databaseReady === true && Date.now() - Date.parse(health.updatedAt) < 10_000, 'fresh_live_worker_health_required');
    return binding(filename);
  }
  async function grant() {
    const raw = (await client.query('select row_to_json(b) as raw from ai_spend_development_batches b where run_id=$1', [config.spend.runId])).rows[0]?.raw;
    const budget = (await client.query('select row_to_json(b) as raw from ai_spend_budgets b where run_id=$1', [config.spend.runId])).rows[0]?.raw;
    const s = config.spend;
    assertBrowserEffortGrant(raw, s);
    assertBrowserDatabaseLimits(raw, budget, s);
    return { raw, budget };
  }
  async function collectReceipts(productRunIds, beforeIds, accountingTrace, httpOriginals) {
    // Raw originals and the shared strict stage mapper are validated separately
    // from collector booleans before a journey can be accepted.
    const issues = [];
    if (new Set(productRunIds).size !== productRunIds.length || !productRunIds.every(id => !seenProductRunIds.has(id))) issues.push('product_run_reused_across_fictional_sessions');
    const allRows = await ledgerRows();
    if (![...beforeIds].every(id => allRows.some(r => r.id === id))) issues.push('previous_ledger_row_disappeared');
    const unpacked = [], runSnapshots = [];
    for (const runId of productRunIds) {
      try {
        const calls = (await client.query(`select c.call_id,c.call_key,c.prompt_sha256,c.state as call_state,c.ciphertext,c.iv,c.tag,c.reservation_id,c.run_id as product_run_id,
          c.operation as call_operation,c.thinking as call_thinking,c.reasoning_effort as call_reasoning_effort,c.effort_policy_sha256 as call_effort_policy_sha256,
          l.run_id as spend_run_id,l.phase,l.model,l.effort,l.operation,l.effort_policy_sha256,l.state as ledger_state,l.reserved_micros::text,l.charged_micros::text,l.input_tokens,l.output_tokens,l.cached_input_tokens
          from competition_decision_calls c left join ai_spend_ledger l on l.id=c.reservation_id where c.run_id=$1 order by c.created_at,c.call_id`, [runId])).rows;
        for (const { ciphertext, iv, tag, ...metadata } of calls) {
          if (metadata.product_run_id !== undefined && metadata.product_run_id !== runId) issues.push('query_returned_foreign_product_run_call');
          let originalReceipt = null;
          try { if (ciphertext) originalReceipt = unseal(`call:${metadata.call_id}`, { ciphertext, iv, tag }); }
          catch { issues.push('original_call_decryption_failed'); }
          // Membership is the actual WHERE c.run_id=$1 query, never row time or spend batch.
          unpacked.push({ ...metadata, product_run_id: metadata.product_run_id ?? runId, originalReceipt });
        }
        const encrypted = (await client.query('select run_id,state_key,ciphertext,iv,tag from competition_decision_runs where run_id=$1', [runId])).rows[0];
        const body = encrypted ? unseal(`run:${runId}`, encrypted) : null;
        if (encrypted?.run_id !== undefined && encrypted.run_id !== runId) issues.push('query_returned_foreign_run_snapshot');
        if (!(body?.implementationSha256 === config.productPins.runtimeSourceBindingSha256 && Array.isArray(body.context?.records) && canonicalHash(body.context.records) === config.productPins.candidatePoolSha256)) issues.push('actual_run_source_or_full_catalog_pool_changed');
        runSnapshots.push({ runId, stateKey: encrypted?.state_key ?? null, body });
      } catch { issues.push('run_call_or_snapshot_capture_failed'); }
    }
    const ownership = isBrowserUserUnbounded(config.spend) ? selectPilotOwnedLedgerRows(allRows, unpacked, accountingTrace, httpOriginals) : { rows: allRows.filter(r => !beforeIds.has(r.id)), issues: [], rule: 'historical_serial_before_ledger_difference' };
    const rows = ownership.rows; issues.push(...ownership.issues);
    const money = value => (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) || Number.isSafeInteger(value) && value >= 0) && Number.isSafeInteger(Number(value));
    const validUsage = u => u && ['inputTokens', 'outputTokens', 'cachedInputTokens'].every(k => Number.isSafeInteger(u[k]) && u[k] >= 0) && u.cachedInputTokens <= u.inputTokens;
    const failureReasons = new Set(['durable_outcome_unknown', 'missing_api_key', 'mock_mode', 'mock_not_allowed', 'provider_not_allowed', 'authentication_error', 'insufficient_balance', 'invalid_request', 'rate_limited', 'upstream_server_error', 'api_error', 'response_too_large', 'invalid_json', 'invalid_output', 'empty_content', 'truncated', 'network_error', 'timeout', 'spend_budget_exhausted', 'spend_store_unavailable', 'spend_configuration_invalid', 'capacity_exhausted', 'daily_budget_exhausted', 'budget_store_unavailable']);
    const shape = saved => {
      const r = saved?.kind === 'receipt' ? saved.receipt : saved?.kind === 'result' ? saved.result : null;
      if (!r || r.model !== 'deepseek-flash' || r.usage !== undefined && !validUsage(r.usage) || r.requestId !== undefined && (typeof r.requestId !== 'string' || !r.requestId.length)) return false;
      const response = Number.isInteger(r.httpStatus) && r.httpStatus >= 100 && r.httpStatus <= 599 && Number.isFinite(r.durationMs) && r.durationMs >= 0 && r.attempts === 1;
      return saved.kind === 'receipt' ? response && (r.finishReason === null || typeof r.finishReason === 'string') && Object.hasOwn(r, 'content') :
        typeof r.ok === 'boolean' && typeof r.upstreamAttempted === 'boolean' && (r.ok ? r.upstreamAttempted && response && Object.hasOwn(r, 'data') && (r.finishReason === null || typeof r.finishReason === 'string') : failureReasons.has(r.reason) && (r.httpStatus === undefined || Number.isInteger(r.httpStatus) && r.httpStatus >= 100 && r.httpStatus <= 599) && (r.durationMs === undefined || Number.isFinite(r.durationMs) && r.durationMs >= 0) && (r.attempts === undefined || Number.isInteger(r.attempts) && r.attempts >= 0 && r.attempts <= 1));
    };
    const rawResponse = c => shape(c.originalReceipt) && (c.originalReceipt.kind === 'receipt' || c.originalReceipt.result.upstreamAttempted === true && Number.isInteger(c.originalReceipt.result.httpStatus) && Number.isFinite(c.originalReceipt.result.durationMs) && c.originalReceipt.result.attempts === 1);
    const rowScope = rows.every(r => r.run_id === config.spend.runId && r.phase === config.spend.phase && r.model === 'deepseek-flash' && browserLedgerEffortMatches(r, config.spend) && money(r.reserved_micros) && (r.charged_micros === null || money(r.charged_micros)) && ['reserved', 'usage_estimated', 'conservative', 'cancelled'].includes(r.state) && (r.state !== 'cancelled' || Number(r.charged_micros) === 0));
    const unique = new Set(rows.map(r => r.id)).size === rows.length && rows.every(r => typeof r.id === 'string' && r.id.length) && new Set(unpacked.map(c => c.call_id)).size === unpacked.length;
    const potential = c => c.originalReceipt?.kind === 'receipt' || c.originalReceipt?.result?.upstreamAttempted !== false || Boolean(c.reservation_id) || ['dispatch_intent', 'unknown', 'response_received'].includes(c.call_state);
    const closedRows = rows.every(r => unpacked.filter(c => c.reservation_id === r.id).length === 1);
    const closedCalls = unpacked.filter(potential).every(c => {
      const matching = rows.filter(r => r.id === c.reservation_id), upstream = c.originalReceipt?.kind === 'receipt' ? true : c.originalReceipt?.result?.upstreamAttempted;
      return matching.length === 1 && c.spend_run_id === config.spend.runId && c.phase === config.spend.phase && c.model === 'deepseek-flash' && browserCallEffortMatches(c, config.spend) && (matching[0].state === 'cancelled' ? upstream === false : upstream === true);
    });
    const validCalls = unpacked.every(c => c.call_id && c.call_key && isHash(c.prompt_sha256) && productRunIds.includes(c.product_run_id) && shape(c.originalReceipt));
    const accounted = rowScope && unique && closedRows && closedCalls;
    if (!accounted) issues.push('unmatched_or_duplicate_or_foreign_new_ledger_reservation');
    if (!validCalls) issues.push('malformed_original_call_or_receipt');
    const settled = rowScope && rows.every(r => r.state !== 'reserved' && r.charged_micros !== null);
    const real = validCalls && unpacked.some(c => rawResponse(c) && rows.some(r => r.id === c.reservation_id && r.state !== 'cancelled')) && hasBrowserBoundProviderDispatch(unpacked, config.spend);
    rows.forEach(r => allowedLedgerIds.add(r.id)); productRunIds.forEach(id => seenProductRunIds.add(id));
    return { schemaVersion: 'saitu.pilot-original-receipts.v7.1', productRunIds, spendRunId: config.spend.runId,
      authorizationPolicySha256: config.spend.authorizationPolicySha256, promptVersions: config.promptVersions,
      originalSourceBindings: { nonRanking: config.nonRankingSourceSnapshot, ranking: config.rankingSourceSnapshot },
      allLedgerRowsAccounted: accounted, allPotentialDispatchesBound: closedCalls && rowScope && unique && validCalls, realProviderDispatch: real,
      captureIssues: issues, unmatchedLedgerIds: rows.filter(r => unpacked.filter(c => c.reservation_id === r.id).length !== 1).map(r => r.id),
      ledgerRows: rows, calls: unpacked, runSnapshots, allLedgerReservationsSettled: settled,
      cost: { accountingCny: rows.every(r => money(r.charged_micros ?? r.reserved_micros)) ? rows.reduce((n, r) => n + Number(r.charged_micros ?? r.reserved_micros), 0) / 1_000_000 : null,
        reservedOrEstimatedCostsRetained: true, providerInvoiceCny: null, invoiceVerified: false },
      executionMode: config.spend.executionMode ?? 'finite', executionLimits: config.spend.executionLimits, ledgerOwnership: ownership,
      globalHardDispatchCap: config.spend.callLimit, perJourneyAllowanceIsAdmissionAndStopBoundOnly: !isBrowserUserUnbounded(config.spend),
      overJourneyAdmissionAllowance: !isBrowserUserUnbounded(config.spend) && rows.filter(r => r.state !== 'cancelled').length > config.spend.perJourneyProviderCallCap };
  }
  return {
    supportsConcurrentCases: true,
    schedulingPolicy: BROWSER_SCHEDULING_POLICY,
    sampleResources: state => resourceSampler.sample(state),
    safeError: safePilotError,
    async initialize(value, out) {
      registration = value; config = value.config; output = out;
      assert(process.env.RUN_V7_PILOT_LIVE === '1' && config.authorContextId === '/root', 'root_live_pilot_opt_in_required');
      assert(config.serverAccountingLog, 'root_append_only_server_accounting_log_config_required_before_any_dispatch');
      await snapshotPilotAccountingLog(config.serverAccountingLog);
      assert(config.policySha256 === POLICY_SHA256 && process.env.AI_PROVIDER === 'deepseek' && process.env.AI_MODEL === 'deepseek-flash' && process.env.AI_API_KEY?.trim() && !['AI_TEST_MODE', 'ALLOW_AI_MOCK', 'NEXT_PUBLIC_AI_TEST_MODE'].some(k => process.env[k] === '1'), 'real_flash_staged_effort_no_mock_required');
      const s = config.spend;
      assertBrowserLiveExecutionMode(s);
      browserEffortRuntime(s);
      assertBrowserEffortEnvironment(s);
      const target = new URL(process.env.DATABASE_URL ?? ''); assert(['127.0.0.1', 'localhost'].includes(target.hostname) && (!target.port || target.port === '5432'), 'actual_local_PG_ledger_required');
      installSourceLoader(ROOT); ({ unsealV7: unseal, verifyDecisionTokenV7: verifyToken } = await import('../../src/lib/competitions/v7/crypto.ts'));
      client = new pg.Client({ connectionString: process.env.DATABASE_URL, options: '-c default_transaction_read_only=on' }); await client.connect();
      await grant(); await livePins('initialize');
      // A resumed batch may contain only the exact ledger IDs retained in its originals.
      for (const name of await readdir(output)) if (/^\d{2}-fictional-pilot-\d{2}$/.test(name)) {
        try { const o = JSON.parse(await readFile(path.join(output, name, 'observation.json'))); o.receipts.ledgerRows.forEach(r => allowedLedgerIds.add(r.id)); o.receipts.productRunIds.forEach(id => seenProductRunIds.add(id)); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      assert((await ledgerRows()).every(r => allowedLedgerIds.has(r.id)), 'new_empty_or_exact_resumed_pilot_batch_required_no_historical_splice');
      browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
    },
    async beforeCase(c) {
      const pins = await livePins(`${c.caseId}-before`), currentGrant = await grant(), rows = await ledgerRows();
      if (!isBrowserUserUnbounded(config.spend)) {
        assert(rows.every(r => allowedLedgerIds.has(r.id)), 'unexpected_concurrent_ledger_activity');
        assert(rows.every(r => r.state !== 'reserved'), 'unsettled_previous_dispatch_blocks_new_session');
      }
      const used = rows.filter(r => r.state !== 'cancelled').length;
      const cost = rows.reduce((n, r) => n + Number(r.charged_micros ?? r.reserved_micros), 0);
      const effectiveCap = isBrowserUserUnbounded(config.spend) ? null : Math.min(config.spend.hardLimitMicros, config.spend.fundingLimitMicros);
      if (!isBrowserUserUnbounded(config.spend)) assert(used + config.spend.perJourneyProviderCallCap <= config.spend.callLimit && cost < effectiveCap, 'finite_root_batch_capacity_exhausted_before_intent');
      return { validatedAt: new Date().toISOString(), beforeLedgerIds: rows.map(r => r.id), beforeLedgerSha256: canonicalHash(rows),
        accountingLogBefore: await snapshotPilotAccountingLog(config.serverAccountingLog),
        grantSha256: canonicalHash(currentGrant), sourcePins: pins, globalHardCallLimit: config.spend.callLimit,
        executionMode: config.spend.executionMode ?? 'finite', executionLimits: config.spend.executionLimits, activeJourneys: [...activeJourneys], observedCalls: used, observedChargedOrHeldMicros: cost,
        remainingCalls: isBrowserUserUnbounded(config.spend) ? null : config.spend.callLimit - used, remainingMicros: isBrowserUserUnbounded(config.spend) ? null : effectiveCap - cost,
        perJourneyAllowanceIsNotASeparateProviderGuarantee: true, actualProductSpendLedgerIsFinancialAuthority: true };
    },
    async runCase(c, intent, dir, schedulingFeedback) {
      assert(!activeJourneys.has(c.caseId), 'same_pilot_case_cannot_be_started_twice'); activeJourneys.add(c.caseId);
      const context = await browser.newContext(c.viewport === 'mobile' ? devices['Pixel 5'] : devices['Desktop Chrome']);
      const key = `saitu.pilot.clock:${intent.sessionId}`;
      await context.addInitScript(pilotProbeBootstrap, { key });
      const page = await context.newPage(); page.setDefaultTimeout(15_000);
      const deliveryLimits = browserDeliveryLimits(config.timeouts);
      const journeyTimer = setTimeout(() => { void page.close().catch(() => undefined); }, config.timeouts.journeyMs);
      const steps = [], apiOriginals = [], responseTasks = [], events = [], pageErrors = [], consoleErrors = [], productRunIds = new Set(), artifacts = [];
      const requestOriginals = [], requestBindings = new Map();
      // Unique metadata header only; questionnaire/chat bodies and UI semantics
      // stay unchanged. A missing response can still be associated with the
      // exact outbound request and server dispatch trace, never a time window.
      await context.route('**/api/**', async route => {
        const request = route.request(); if (request.method() !== 'POST' || !accountingPaths.has(new URL(request.url()).pathname)) return route.continue();
        const requestId = `pilot-${randomUUID()}`, requestBody = request.postData() ?? '';
        const original = { requestId, path: new URL(request.url()).pathname, method: 'POST', requestBody, requestBodySha256: byteHash(requestBody),
          intentId: intent.intentId, sessionId: intent.sessionId, caseInputSha256: intent.caseInputSha256 };
        requestBindings.set(request, original); requestOriginals.push(original);
        await route.continue({ headers: { ...request.headers(), 'x-request-id': requestId } });
      });
      let timing = null, status = 'failed', failure = null, pinAfter = false, receipts = null, initial = null, submitPosts = 0;
      const step = (name, evidence = {}) => steps.push({ name, status: 'passed', observedAt: new Date().toISOString(), ...evidence });
      page.on('pageerror', e => pageErrors.push(e.message)); page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/ai/competition-recommend') submitPosts++; });
      page.on('requestfailed', request => { const original = requestBindings.get(request); if (original) original.transportFailure = request.failure()?.errorText ?? 'request_failed'; });
      page.on('response', response => {
        const url = new URL(response.url()); if (!url.pathname.startsWith('/api/')) return;
        responseTasks.push((async () => {
          const request = response.request(), bytes = await response.body();
          let payload; try { payload = JSON.parse(bytes); } catch { payload = null; }
          if (payload?.runId && (url.pathname === '/api/ai/competition-recommend' || runPath(url.pathname))) productRunIds.add(payload.runId);
          if (payload?.run?.runId) productRunIds.add(payload.run.runId);
          const original = { path: url.pathname, method: request.method(), status: response.status(), observedAt: Date.now(),
            responseHeaderRequestId: response.headers()['x-request-id'] ?? null,
            requestBody: request.postData(), responseBodyBase64: bytes.toString('base64'), responseBodySha256: byteHash(bytes) };
          if (requestBindings.has(request)) Object.assign(requestBindings.get(request), original);
          apiOriginals.push(original);
        })().catch(error => events.push({ type: 'response_capture_failure', error: safePilotError(error) })));
      });
      const fault = await installPollFault(page, c.scenario, config.faults.pollDelayMs, events);
      const report = page.getByTestId('decision-report-v7');
      const expandAll = async () => { const b = report.getByRole('button', { name: /^查看其余/ }); if (await b.count()) await b.click(); };
      const ready = async (runId, originalClickEpochMs) => {
        await waitForBrowserDelivery(page, { originalClickEpochMs, runId, phase: 'list', limits: deliveryLimits });
        await expandAll();
        await waitForBrowserDelivery(page, { originalClickEpochMs, runId, phase: 'details', limits: deliveryLimits });
        const count = Number(await report.getAttribute('data-total-items'));
        assert(Number.isInteger(count) && count >= 1 && count <= 5 && await report.getByTestId('recommendation-run-item').count() === count, 'top5_full_list_must_be_visible_without_hidden_items');
        const states = await report.getByTestId('recommendation-run-item').evaluateAll(cards => cards.map(c => c.dataset.detailStatus));
        assert(states.every(s => s === 'ready'), 'ready_with_incomplete_details');
      };
      try {
        await installBrowserExecutionAuthorization(context, config.spend, config.baseUrl);
        await fillPublicBrowserProfile(page, c, config.baseUrl);
        await expect(page.getByTestId('ai-test-mode-notice')).toHaveCount(0);
        events.push({ type: 'browser_resource_probe_before_original_click', ...await resourceSampler.observeBrowser(page) });
        const originalClickEpochMs = await startPilotClock(page, key);
        const submitTimeout = await browserDeliveryTimeout(page, originalClickEpochMs, 'list', deliveryLimits);
        const accepted = page.waitForResponse(r => new URL(r.url()).pathname === '/api/ai/competition-recommend' && r.request().method() === 'POST', { timeout: submitTimeout });
        await page.getByRole('button', { name: '同意，请乐乐开始匹配', exact: true }).click();
        const response = await accepted; assert(response.status() === 202, 'initial_durable_submit_not_accepted');
        initial = await response.json(); assert(initial.runId, 'missing_actual_initial_run_id');
        assert(initial.policyVersion === config.policyVersion && initial.executionPolicy?.maxItems === 5 && initial.executionMode === config.spend.executionMode && canonicalHash(initial.executionLimits) === canonicalHash(config.spend.executionLimits), 'top5_submission_policy_and_execution_mode_required'); productRunIds.add(initial.runId);
        await bindPilotRunClock(page, key, initial.runId, originalClickEpochMs);
        step('original_submit_accepted', { runId: initial.runId });
        if (c.scenario === 'poll_disconnect') {
          await expect(report.getByText(/连接暂时中断/)).toBeVisible({ timeout: 20_000 });
          assert(fault.injected(), 'disconnect_was_not_exercised'); step('browser_only_poll_disconnect_visible');
          await page.evaluate(() => window.dispatchEvent(new Event('online')));
        }
        await waitForBrowserDelivery(page, { originalClickEpochMs, runId: initial.runId, phase: 'list', limits: deliveryLimits });
        await expect(report.getByTestId('recommendation-run-item').first()).toBeVisible({ timeout: 1000 });
        step('list_visible', { runId: initial.runId }); await expandAll();
        await report.getByTestId('recommendation-run-item').first().locator('summary').first().click();
        step('reason_clicked_before_waiting_for_all_details');
        if (c.scenario === 'poll_delay') { assert(fault.injected(), 'delay_was_not_exercised'); step('browser_only_poll_delay_recovered', { injectedDelayMs: config.faults.pollDelayMs }); }
        if (c.scenario === 'refresh') {
          const before = submitPosts; await page.reload(); await expect(report).toHaveAttribute('data-run-id', initial.runId);
          assert(submitPosts === before, 'refresh_reissued_paid_submission'); step('refresh_restored_same_run_without_POST');
        }
        let active = initial;
        if (c.scenario === 'stale_poll_correction') {
          assert(await report.getAttribute('data-run-status') !== 'ready', 'old_poll_window_not_exercised_initial_already_ready');
          fault.arm(initial.runId);
          const heldDeadline = Date.now() + 12_000;
          while (!fault.held() && Date.now() < heldDeadline) await delay(50);
          assert(fault.held(), 'old_read_only_poll_not_observed'); step('old_actual_poll_held', { runId: initial.runId });
        } else await ready(initial.runId, originalClickEpochMs);
        if (c.scenario === 'followup') {
          const reply = await sendPilotChat(page, c.followup);
          assert(reply.payload.profileRevision === initial.profileRevision && (!reply.payload.run || reply.payload.run.runId === initial.runId && reply.payload.run.profileRevision === initial.profileRevision), 'reason_only_followup_changed_profile');
          step('followup_reply_rendered_same_revision', { requestId: reply.request.requestId });
        }
        if (c.scenario.includes('correction')) {
          const reply = await sendPilotChat(page, c.correction.text); active = assertCorrection(reply, initial, c.correction); productRunIds.add(active.runId);
          await bindPilotRunClock(page, key, active.runId, reply.clickEpochMs);
          await expect(page.getByTestId('decision-update-proposal')).toHaveCount(0); await expect(report).toHaveAttribute('data-run-id', active.runId);
          step('explicit_correction_adopted_without_confirmation', { requestId: reply.request.requestId, newRunId: active.runId, correctionClickEpochMs: reply.clickEpochMs });
          if (c.scenario === 'stale_poll_correction') {
            fault.release(); await delay(250); await expect(report).toHaveAttribute('data-run-id', active.runId);
            step('delayed_old_actual_poll_cannot_replace_corrected_run');
          }
          await ready(active.runId, reply.clickEpochMs);
        }
        if (c.scenario === 'poll_disconnect') step('same_run_recovered_after_injected_GET_failure', { runId: active.runId });
        const first = report.getByTestId('recommendation-run-item').first();
        if (await first.locator('details[open]').count()) await first.locator('summary').first().click();
        const expansionStart = await page.evaluate(() => performance.now()); await first.locator('summary').first().click();
        await expect(first.getByRole('heading', { name: '为什么适合你', exact: true })).toBeVisible();
        const expansionMs = await page.evaluate(start => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)))), expansionStart);
        step('clicked_reason_visible', { runId: active.runId });
        timing = await page.evaluate(({ key, expansionMs }) => { const p = JSON.parse(sessionStorage.getItem(key)); p.readyExpansionMs = expansionMs; return p; }, { key, expansionMs });
        assert(submitPosts === 1, 'unexpected_extra_original_submit_POST');
        assert(pageErrors.length === 0, 'unexpected_browser_page_error');
        await first.getByRole('checkbox').check(); await report.getByRole('button', { name: '收藏所选 1 项', exact: true }).click();
        await expect(report.getByText(/已收藏所选 1 项/)).toBeVisible(); step('saved_selected_actual_ready_result');
        await page.screenshot({ path: path.join(dir, 'journey.png'), fullPage: false }); artifacts.push(await binding(path.join(dir, 'journey.png')));
        status = 'passed';
      } catch (error) {
        failure = safePilotError(error); steps.push({ name: 'journey_failure', status: 'failed', failure, observedAt: new Date().toISOString() });
        timing = await page.evaluate(key => { const s = sessionStorage.getItem(key); return s ? JSON.parse(s) : null; }, key).catch(() => null);
      } finally {
        fault.release(); clearTimeout(journeyTimer);
        const dom = await page.locator('body').innerText().catch(() => null);
        await context.close(); await Promise.allSettled(responseTasks);
        try {
          let accountingTrace;
          try { accountingTrace = await capturePilotAccountingTrace(config.serverAccountingLog, intent.admission.accountingLogBefore, requestOriginals); }
          catch (error) { accountingTrace = { complete: false, issues: [`server_trace_capture_failed:${safePilotError(error)}`], events: [] }; }
          receipts = await collectReceipts([...productRunIds], new Set(intent.admission.beforeLedgerIds), accountingTrace, requestOriginals);
          for (const h of requestOriginals) {
            if (!h.responseBodyBase64) continue;
            let payload; try { payload = JSON.parse(Buffer.from(h.responseBodyBase64, 'base64')); } catch { continue; }
            const token = payload?.run?.decisionToken ?? payload?.decisionToken;
            if (token && !verifyToken(token)) accountingTrace.issues.push('actual_response_decision_token_signature_invalid');
          }
          receipts.journeyBinding = { intentId: intent.intentId, caseId: c.caseId, sessionId: intent.sessionId, caseInputSha256: canonicalHash(c),
            registrationSha256: intent.registrationSha256, httpOriginals: requestOriginals, accountingTrace };
          const proof = analyzePilotEvidence(receipts, intent, registration);
          receipts.transportOnlyCollectorSummary = { realProviderDispatch: receipts.realProviderDispatch, allLedgerRowsAccounted: receipts.allLedgerRowsAccounted,
            allPotentialDispatchesBound: receipts.allPotentialDispatchesBound, captureIssues: receipts.captureIssues };
          receipts.evidenceValidation = proof;
          receipts.realProviderDispatch = proof.realProviderResponseObserved;
          receipts.allLedgerRowsAccounted = !proof.unmatchedLedgerIds.length && !proof.issues.length;
          receipts.allPotentialDispatchesBound = isBrowserUserUnbounded(config.spend) ? proof.ownershipVerified === true : !proof.issues.length && !proof.uncertain;
          receipts.unmatchedLedgerIds = proof.unmatchedLedgerIds;
          if (!proof.valid || !receipts.allLedgerReservationsSettled || receipts.overJourneyAdmissionAllowance) {
            status = 'indeterminate'; failure ??= 'original_dispatch_identity_or_accounting_closure_not_proven_no_retry';
          }
          if (isBrowserUserUnbounded(config.spend)) {
            receipts.schedulingFeedback = proof.ownershipVerified !== true ? { stop: true, reason: 'pilot_original_identity_or_ledger_not_proven' }
              : classifyBrowserOriginalScheduling({ ...receipts, httpOriginals: requestOriginals }, config.spend);
            if (!receipts.schedulingFeedback && proof.uncertain) receipts.schedulingFeedback = { backpressure: true, durationMs: Math.max(1, Date.now() - Date.parse(intent.createdAt)), reason: 'attributed_unknown_pilot_original_retained_no_retry' };
            if (receipts.schedulingFeedback) await schedulingFeedback?.(receipts.schedulingFeedback);
          }
        } catch (error) {
          status = 'indeterminate'; failure = `receipt_capture_failed:${safePilotError(error)}`;
          await schedulingFeedback?.({ stop: true, reason: 'pilot_original_receipt_or_ledger_unavailable' });
          receipts = { productRunIds: [...productRunIds], ledgerRows: [], calls: [], ...receipts, captureFailure: failure, spendRunId: config.spend.runId,
            authorizationPolicySha256: config.spend.authorizationPolicySha256, realProviderDispatch: false, allPotentialDispatchesBound: false, allLedgerRowsAccounted: false, allLedgerReservationsSettled: false };
        }
        try { artifacts.push(await livePins(`${c.caseId}-after`)); pinAfter = true; } catch (error) { if (status !== 'indeterminate') status = 'failed'; failure = `after_pin_validation_failed:${safePilotError(error)}`; }
        artifacts.push(await writeNew(path.join(dir, 'http-originals.json'), { sessionId: intent.sessionId, caseInputSha256: intent.caseInputSha256, requests: requestOriginals, responses: apiOriginals, events, pageErrors, consoleErrors, originalSubmitPOSTs: submitPosts }));
        artifacts.push(await writeNew(path.join(dir, 'receipts-and-ledger.json'), receipts));
        artifacts.push(await writeNew(path.join(dir, 'dom-original.json'), { sessionId: intent.sessionId, text: dom, timing, failure, simulatedBrowserFaults: events.filter(e => e.type.startsWith('injected_')) }));
      }
      activeJourneys.delete(c.caseId);
      return { schemaVersion: 'saitu.pilot-observation.v7.1', intentId: intent.intentId, sessionId: intent.sessionId, caseId: c.caseId,
        registrationSha256: intent.registrationSha256, caseInputSha256: intent.caseInputSha256, observedAt: new Date().toISOString(),
        evidenceClass: 'ai_proxy_ui_pilot', actualParticipants: 0, status, steps, timing, failure,
        pinValidation: { before: true, after: pinAfter }, receipts, artifacts,
        stopFurtherDispatch: !pinAfter || receipts.allLedgerRowsAccounted !== true || receipts.allPotentialDispatchesBound !== true || receipts.overJourneyAdmissionAllowance === true || receipts.schedulingFeedback?.stop === true || !isBrowserUserUnbounded(config.spend) && status === 'indeterminate',
        sourceAndPromptCatalogBindings: { productPins: config.productPins, promptVersions: config.promptVersions, nonRanking: config.nonRankingSourceSnapshot, ranking: config.rankingSourceSnapshot },
        injectedPollFaultsAreNotProviderFailures: true, qualityAssessment: 'pending_independent_actual_output_review', formalProductAcceptance: false };
    },
    async finalize(observations = []) {
      if (!client) return { valid: false, reason: 'readonly_driver_initialization_required_before_batch_finalization' };
      const rows = await ledgerRows(), closure = pilotBatchLedgerClosure(rows, observations);
      return { ...closure, valid: closure.valid && activeJourneys.size === 0, activeJourneys: [...activeJourneys],
        observedAt: new Date().toISOString(), executionMode: config.spend.executionMode ?? 'finite', spendRunId: config.spend.runId,
        actualLedgerRows: rows, databaseWrites: 0, providerCalls: 0, finalizationAfterAllStartedJourneysSettled: activeJourneys.size === 0 };
    },
    async close() { resourceSampler.close(); try { await browser?.close(); } finally { await client?.end(); } },
  };
}
