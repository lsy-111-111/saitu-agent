import { randomUUID } from 'node:crypto';
import { byteHash } from '../../scripts/competitions/v7/evaluation-policy.mjs';
import { browserLedgerEffortMatches } from './v7-browser-effort.mjs';
import { providerBrowserBackpressure } from './v7-browser-scheduling.mjs';

const paths = new Set(['/api/competitions/recommend/normalize', '/api/ai/competition-clarify', '/api/ai/competition-recommend', '/api/ai/competition-chat']);
export function classifyBrowserOriginalScheduling(receipt, spend) {
  const calls = receipt.calls ?? [], rows = receipt.ledgerRows ?? [], issues = receipt.ledgerOwnership?.issues ?? [];
  const reasons = calls.map(call => call.originalReceipt?.result?.reason).filter(Boolean);
  for (const request of receipt.httpOriginals ?? []) {
    if (!request.responseBodyBase64) continue;
    let body; try { body = JSON.parse(Buffer.from(request.responseBodyBase64, 'base64').toString('utf8')); } catch { continue; }
    for (const key of ['fallbackReason', 'reason']) if (typeof body?.[key] === 'string') reasons.push(body[key]);
  }
  if (issues.length || rows.some(row => row.run_id !== spend.runId || row.phase !== spend.phase || !browserLedgerEffortMatches(row, spend)))
    return { stop: true, reason: 'original_reservation_identity_or_scope_not_proven' };
  if (reasons.some(reason => ['spend_store_unavailable', 'budget_store_unavailable', 'spend_configuration_invalid', 'insufficient_balance', 'spend_budget_exhausted'].includes(reason)))
    return { stop: true, reason: 'actual_ledger_or_physical_funding_unavailable' };
  const uncertainCalls = calls.filter(call => ['dispatch_intent', 'unknown'].includes(call.call_state) || call.originalReceipt?.result?.reason === 'durable_outcome_unknown');
  if (uncertainCalls.some(call => !call.reservation_id || !rows.some(row => row.id === call.reservation_id)))
    return { stop: true, reason: 'unknown_original_without_exact_reservation_identity' };
  const unanswered = (receipt.httpOriginals ?? []).filter(request => request.responseBodyBase64 === undefined);
  if (unanswered.length && !rows.length) return { stop: true, reason: 'unanswered_HTTP_original_without_attributed_dispatch_or_non_dispatch_proof' };
  const dispatchedCalls = calls.filter(call => {
    const result = call.originalReceipt?.result, row = rows.find(row => row.id === call.reservation_id);
    if (!row || result?.upstreamAttempted === false || result?.reason === 'durable_outcome_unknown') return false;
    return call.originalReceipt?.kind === 'receipt' || result?.upstreamAttempted === true ||
      call.call_state === 'dispatch_intent' || call.call_state === 'unknown' && row.state === 'conservative';
  });
  const traceDispatched = (receipt.accountingTrace?.events ?? []).some(event => rows.some(row => row.id === event.details?.reservationId) &&
    (event.type === 'ai_transport_dispatch' || event.type === 'ai_budget_settled' && event.details?.upstreamAttempted === true));
  const provider = providerBrowserBackpressure(dispatchedCalls);
  if (provider) return { backpressure: true, ...provider };
  if (dispatchedCalls.some(call => ['dispatch_intent', 'unknown'].includes(call.call_state) ||
    ['timeout', 'network_error'].includes(call.originalReceipt?.result?.reason)) ||
    traceDispatched && (unanswered.length || reasons.some(reason => ['timeout', 'network_error'].includes(reason)))) {
    const durations = dispatchedCalls.map(call => call.originalReceipt?.result?.durationMs ?? call.originalReceipt?.receipt?.durationMs).filter(value => Number.isFinite(value) && value > 0);
    return { backpressure: true, durationMs: durations.length ? Math.max(...durations) : 1, reason: 'well_attributed_unknown_or_timeout_original_retained_without_retry' };
  }
  return null;
}

/** Capture metadata capabilities only in transit. Raw evidence deliberately
 * omits all request headers except the non-secret correlation identifier. */
export async function createBrowserOriginalCapture(context, config) {
  const { snapshotPilotAccountingLog, capturePilotAccountingTrace, selectPilotOwnedLedgerRows } = await import('./v7-pilot-browser.mjs');
  let before;
  try { before = await snapshotPilotAccountingLog(config.serverAccountingLog); }
  catch (error) { error.globalStop = true; throw error; }
  const origin = new URL(config.baseUrl).origin;
  const requests = [], bindings = new Map(), pending = [];
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || request.method() !== 'POST' || !paths.has(url.pathname)) return route.fallback();
    const requestId = `browser-original-${randomUUID()}`, requestBody = request.postData() ?? '';
    const original = { requestId, path: url.pathname, method: 'POST', requestBody, requestBodySha256: byteHash(requestBody) };
    requests.push(original); bindings.set(request, original);
    await route.fallback({ headers: { ...request.headers(), 'x-request-id': requestId } });
  });
  context.on('response', response => {
    const original = bindings.get(response.request()); if (!original) return;
    pending.push((async () => {
      const body = await response.body();
      Object.assign(original, { status: response.status(), responseHeaderRequestId: response.headers()['x-request-id'] ?? null,
        responseBodyBase64: body.toString('base64'), responseBodySha256: byteHash(body) });
    })().catch(error => { original.captureFailure = error instanceof Error ? error.name : 'response_capture_failed'; }));
  });
  context.on('requestfailed', request => { const original = bindings.get(request); if (original) original.transportFailure = request.failure()?.errorText ?? 'request_failed'; });
  return { async collect(client, receipt) {
    await Promise.allSettled(pending);
    const trace = await capturePilotAccountingTrace(config.serverAccountingLog, before, requests);
    const provisional = selectPilotOwnedLedgerRows([], receipt.calls ?? [], trace, requests), ids = provisional.ownedReservationIds;
    const rows = ids.length ? (await client.query('select row_to_json(l) as raw from ai_spend_ledger l where run_id=$1 and id=any($2::uuid[]) order by created_at,id', [config.spend.runId, ids])).rows.map(row => row.raw) : [];
    const ownership = selectPilotOwnedLedgerRows(rows, receipt.calls ?? [], trace, requests);
    if (!trace.complete) ownership.issues.push('original_HTTP_accounting_trace_incomplete');
    receipt.httpOriginals = requests; receipt.accountingTrace = trace; receipt.ledgerRows = rows; receipt.ledgerOwnership = ownership;
    receipt.schedulingFeedback = classifyBrowserOriginalScheduling(receipt, config.spend);
    return receipt;
  } };
}

export async function closeBrowserBatchOriginals(client, spend, records) {
  const actualLedgerRows = (await client.query('select row_to_json(l) as raw from ai_spend_ledger l where run_id=$1 order by created_at,id', [spend.runId])).rows.map(row => row.raw);
  const owners = new Map(), duplicateReservationIds = [];
  for (const record of records) for (const id of record.ownedLedgerIds ?? []) {
    if (owners.has(id)) duplicateReservationIds.push(id); else owners.set(id, record.caseId);
  }
  const unmatchedReservationIds = actualLedgerRows.filter(row => !owners.has(row.id)).map(row => row.id);
  const missingReservationIds = [...owners.keys()].filter(id => !actualLedgerRows.some(row => row.id === id));
  const unknownHeldReservationIds = actualLedgerRows.filter(row => row.state === 'reserved' || row.charged_micros === null).map(row => row.id);
  const unprotectedReservationIds = actualLedgerRows.filter(row => unknownHeldReservationIds.includes(row.id) && (!Number.isSafeInteger(Number(row.reserved_micros)) || Number(row.reserved_micros) <= 0)).map(row => row.id);
  return { valid: !duplicateReservationIds.length && !unmatchedReservationIds.length && !missingReservationIds.length && !unprotectedReservationIds.length,
    spendRunId: spend.runId, executionMode: spend.executionMode, actualLedgerRows,
    ownership: [...owners].map(([reservationId, caseId]) => ({ reservationId, caseId })), duplicateReservationIds, unmatchedReservationIds, missingReservationIds,
    unknownHeldReservationIds, unprotectedReservationIds, unknownOriginalsNeverReissued: true, providerCalls: 0, databaseWrites: 0 };
}
