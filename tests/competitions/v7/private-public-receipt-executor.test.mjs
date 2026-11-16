import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { installSourceLoader } from '../../../scripts/lib/load-typescript-source.mjs';
import { byteHash, canonicalHash } from '../../../scripts/competitions/v7/evaluation-policy.mjs';
import { RANK_NON_THINKING_EFFORT_POLICY as policy, effortPolicySha256 } from '../../../src/lib/ai/effort-policy.mjs';

// All provider behavior below is invented. Real HTTP and application DB are forbidden.
let networkAttempts = 0, databaseAttempts = 0;
const savedFetch = globalThis.fetch, savedClientConnect = pg.Client.prototype.connect, savedClientQuery = pg.Client.prototype.query;
const savedPoolConnect = pg.Pool.prototype.connect, savedPoolQuery = pg.Pool.prototype.query;
globalThis.fetch = () => { networkAttempts++; throw new Error('private_receipt_fixture_forbids_http'); };
const denyDatabase = () => { databaseAttempts++; throw new Error('private_receipt_fixture_forbids_db'); };
pg.Client.prototype.connect = denyDatabase; pg.Client.prototype.query = denyDatabase; pg.Pool.prototype.connect = denyDatabase; pg.Pool.prototype.query = denyDatabase;
installSourceLoader(process.cwd());
const executor = await import('../../../scripts/competitions/v7/evaluation-executor.mjs');
const modules = await executor.loadActualProductModules();
after(() => {
  globalThis.fetch = savedFetch; pg.Client.prototype.connect = savedClientConnect; pg.Client.prototype.query = savedClientQuery;
  pg.Pool.prototype.connect = savedPoolConnect; pg.Pool.prototype.query = savedPoolQuery;
  assert.equal(networkAttempts, 0); assert.equal(databaseAttempts, 0);
});
const usage = { inputTokens: 12, outputTokens: 7, cachedInputTokens: 2 };
const parseJournal = bytes => bytes.toString().split('\n').filter(Boolean).map(line => JSON.parse(line));
const pause = () => new Promise(resolve => setImmediate(resolve));

async function harness(configurations, inspect, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'saitu-private-receipt-')), identity = { fixture: randomUUID() }, invocationId = randomUUID();
  const journalPath = path.join(directory, canonicalHash(identity) + '.journal.jsonl'), resultPath = path.join(directory, canonicalHash(identity) + '.json');
  const calls = [], feedback = [], publicLogs = [], returned = [];
  const originalConsoleInfo = console.info; console.info = value => { publicLogs.push(value); };
  const ai = { async requestAiJson(prompt, callOptions) {
    const config = configurations.find(row => row.prompt === prompt), reservationId = randomUUID(); calls.push({ prompt, options: callOptions, reservationId });
    assert.ok(config);
    const disabled = callOptions.thinking === 'disabled';
    const metadata = { reservationId, operation: callOptions.operation, model: 'deepseek-flash', attempt: 1, thinkingType: callOptions.thinking,
      effortPolicySha256: effortPolicySha256(policy), ...(disabled ? { policyReasoningEffort: 'low', wireReasoningEffort: null, temperature: 0, topP: 1 } : { reasoningEffort: 'low' }) };
    modules.observer.emitProductObservation('ai_budget_reserved', { reservationId, reservedMicros: 101 });
    modules.observer.withRecommendationAccountingTrace('private-fixture-public-trace', () => modules.observer.emitProductObservation('ai_transport_dispatch', metadata));
    await config.beforeReceipt?.();
    const receipt = { model: 'deepseek-flash', httpStatus: 200, requestId: 'provider-' + config.prompt, finishReason: config.finishReason ?? 'stop',
      content: Object.hasOwn(config, 'content') ? config.content : '{"answer":"okay","rawOnly":"PRIVATE_RAW_' + config.prompt + '"}',
      usage: structuredClone(usage), durationMs: 2, attempts: 1, operation: callOptions.operation, thinking: callOptions.thinking,
      ...(disabled ? { policyReasoningEffort: 'low', wireReasoningEffort: null, temperature: 0, topP: 1 } : { reasoningEffort: 'low' }),
      effortPolicySha256: effortPolicySha256(policy), recommendationPolicyVersion: callOptions.recommendationPolicyVersion, implementationVersion: callOptions.implementationVersion,
      reasoning_content: 'HIDDEN_REASONING_MUST_NOT_PERSIST', headers: { authorization: 'FIXTURE_SECRET_HEADER' }, apiKey: 'FIXTURE_SECRET_KEY' };
    if (config.patchReceipt) Object.assign(receipt, config.patchReceipt);
    if (!config.noReceipt) await modules.durable.recordDurableReceipt(receipt);
    if (config.duplicateReceipt) await modules.durable.recordDurableReceipt(receipt);
    if (config.mutateAfterTap) { receipt.content = 'MUTATED_AFTER_CAPTURE'; receipt.usage.inputTokens = 999; }
    await config.afterReceipt?.();
    const result = config.result ?? { ok: true, data: { answer: 'okay' }, model: 'deepseek-flash', upstreamAttempted: true, attempts: 1,
      httpStatus: 200, requestId: 'provider-' + config.prompt, finishReason: config.finishReason ?? 'stop', durationMs: 9, usage: structuredClone(usage) };
    modules.observer.emitProductObservation('ai_budget_settled', { reservationId, usage: result.usage ?? null, state: result.usage ? 'usage_estimated' : 'conservative', chargedMicros: result.usage ? 53 : 101 });
    returned.push(result); return result;
  } };
  const actual = { ...modules, ai, spend: { ...modules.spend, requestReserveMicros: () => 101 }, budget: { ...modules.budget, withAiReservationLimit: (_limit, work) => work() },
    ...(options.noTapModule ? { durable: undefined } : {}), chat: { ...modules.chat, async extractSelfReportedFactsV7(_input, operationOptions) {
      const results = await Promise.all(configurations.map((config, index) => operationOptions.modelCall(config.prompt, {
        model: 'deepseek-flash', maxAttempts: 1, maxTokens: config.disabled ? 8192 : 16384,
        operation: config.disabled ? 'competition_v7_rank' : 'competition_v7_explain', thinking: config.disabled ? 'disabled' : 'enabled', reasoningEffort: 'low',
        ...(config.disabled ? { temperature: 0, topP: 1 } : {}), systemPrompt: 'synthetic fixed system', apiKey: 'FIXTURE_REQUEST_SECRET', promptVersion: 'private-fixture.v1',
        recommendationPolicyVersion: modules.runContracts.RECOMMENDATION_POLICY_VERSION, implementationVersion: modules.runContracts.RECOMMENDATION_IMPLEMENTATION_VERSION,
        timeoutMs: 10000, requestDeadlineMs: 10000, deadlineEpochMs: operationOptions.deadlineEpochMs,
        diagnosticContext: { invocationId, stage: config.disabled ? 'v7.rank' : 'v7.explain', reviewId: 'private-fixture-' + index },
      })));
      results.forEach(result => assert.strictEqual(result, returned.find(row => row === result), 'executor returns the original result object'));
      return { fixtureOnly: true, results };
    } } };
  const run = () => executor.checkpointInvocation(directory, identity, journal => executor.executeObservedProduct({ caseId: 'private-capture-fixture', operation: 'extract_profile', input: {} }, {
    modules: actual, records: [], asOf: '2026-11-10T00:00:00.000Z', freezeBinding: { implementationSha256: 'a'.repeat(64) },
    producerSha256: 'b'.repeat(64), executionRuntimeConfigurationSha256: 'c'.repeat(64), invocationId,
    effortPolicy: policy, executionMode: 'finite', maxHttp: 10, maxReserveMicros: 1000000, journal,
    onCapacityFeedback: value => feedback.push(value),
  }));
  try {
    const completed = await run(), rawBytes = await readFile(resultPath), raw = JSON.parse(rawBytes), journal = parseJournal(await readFile(journalPath));
    assert.deepEqual(completed.value.responses, raw.responses);
    assert.equal((await stat(resultPath)).mode & 0o777, 0o600); assert.equal((await stat(journalPath)).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(directory)).sort(), [canonicalHash(identity) + '.intent.json', canonicalHash(identity) + '.journal.jsonl', canonicalHash(identity) + '.json'].sort());
    const serializedPublic = JSON.stringify({ events: raw.observation.events, output: raw.observation.output, logs: publicLogs });
    assert.doesNotMatch(serializedPublic, /PRIVATE_RAW_|PRIVATE_INVALID|PRIVATE_TRUNCATED|privateProviderReceipt|HIDDEN_REASONING|FIXTURE_SECRET|FIXTURE_REQUEST_SECRET/);
    const serializedAll = rawBytes.toString() + JSON.stringify(journal);
    assert.doesNotMatch(serializedAll, /HIDDEN_REASONING_MUST_NOT_PERSIST|FIXTURE_SECRET_HEADER|FIXTURE_SECRET_KEY|FIXTURE_REQUEST_SECRET|reasoning_content/);
    await inspect({ raw, journal, calls, feedback, returned, run, resultPath, rawBytes });
  } finally { console.info = originalConsoleInfo; await rm(directory, { recursive: true, force: true }); }
}
function failure(reason, finishReason = 'stop') {
  return { ok: false, reason, model: 'deepseek-flash', upstreamAttempted: true, attempts: 1, httpStatus: 200,
    requestId: 'provider-' + reason, finishReason, durationMs: 9, usage: structuredClone(usage) };
}
function assertBinding(response) {
  const capture = response.privateProviderReceipt; assert.equal(capture.status, 'captured'); assert.equal(capture.captureCount, 1);
  const row = capture.observations[0];
  for (const key of ['callId', 'invocationId', 'runId', 'callKey', 'requestSha256', 'promptSha256']) assert.equal(row[key], response[key]);
  assert.equal(row.reservationId, response.events.find(event => event.type === 'ai_transport_dispatch').details.reservationId);
  assert.equal(row.actualDispatchCount, 1); assert.equal(row.binding.exactSingleDispatch, true); assert.equal(row.binding.actualDispatchMatchesResult, true);
  assert.equal(row.binding.intentMatchesReceipt, true); assert.equal(row.binding.resultMatchesReceipt, true);
  assert.equal(capture.httpToJournalCrashWindowClosed, false);
  return row;
}

test('loads the real private receipt API without creating a durable DB run', () => {
  assert.equal(typeof modules.durable.withPrivateAiPublicReceiptTap, 'function'); assert.equal(modules.durable.hasDurableAiRun(), false);
});
for (const [name, content, result] of [
  ['success', '  {"answer":"okay","rawOnly":"PRIVATE_RAW_success"}\n', undefined],
  ['invalid_output', '{"unexpected":"PRIVATE_INVALID"}', failure('invalid_output')],
  ['truncated', '{"checks":[{"reason":"PRIVATE_TRUNCATED', failure('truncated', 'length')],
  ['empty_content', '', failure('empty_content')],
  ['null_content', null, failure('null_content')],
]) test('retains private public content for ' + name + ' with the original result and accounting', async () => {
  const normalizedResult = result ? { ...result, reason: name === 'null_content' ? 'empty_content' : result.reason, requestId: 'provider-' + name } : undefined;
  await harness([{ prompt: name, content, result: normalizedResult, finishReason: name === 'truncated' ? 'length' : 'stop' }], ({ raw, journal, calls, returned }) => {
    const response = raw.responses[0], row = assertBinding(response);
    assert.equal(row.receipt.content, content); assert.equal(row.contentSha256, content === null ? null : byteHash(content));
    assert.equal(row.contentUtf8Bytes, content === null ? null : Buffer.byteLength(content));
    assert.deepEqual(response.result, returned[0]); assert.equal(calls.length, 1);
    assert.equal(response.events.filter(event => event.type === 'ai_budget_settled').length, 1);
    assert.deepEqual(journal.find(event => event.type === 'model_response').response.privateProviderReceipt, response.privateProviderReceipt);
  });
});
test('missing legacy failure result metadata is diagnosed without being a mismatch', async () => {
  const result = { ok: false, reason: 'invalid_output', model: 'deepseek-flash', upstreamAttempted: true };
  await harness([{ prompt: 'legacy-missing', result }], ({ raw, feedback }) => {
    const row = assertBinding(raw.responses[0]);
    assert.ok(row.binding.resultComparison.missingExpectedFields.includes('requestId'));
    assert.deepEqual(row.binding.resultComparison.mismatchedFields, []); assert.deepEqual(raw.responses[0].result, result); assert.deepEqual(feedback, []);
  });
});
test('required receipt operation and effort metadata missing is a binding mismatch', async () => {
  await harness([{ prompt: 'missing-receipt-fields', patchReceipt: { operation: undefined, effortPolicySha256: undefined, reasoningEffort: undefined } }], ({ raw, returned, feedback }) => {
    const capture = raw.responses[0].privateProviderReceipt; assert.equal(capture.status, 'binding_mismatch');
    const comparison = capture.observations[0].binding.intentComparison;
    assert.ok(comparison.missingReceiptFields.includes('operation')); assert.ok(comparison.missingReceiptFields.includes('effortPolicySha256'));
    assert.ok(comparison.missingReceiptFields.includes('reasoningEffort')); assert.equal(comparison.matchesPresentFields, false);
    assert.deepEqual(raw.responses[0].result, returned[0]); assert.equal(feedback.length, 1); assert.equal(feedback[0].healthy, true);
  });
});
test('different present request/usage metadata stays mismatch without rewriting result', async () => {
  await harness([{ prompt: 'mismatch', patchReceipt: { requestId: 'different-request', usage: { ...usage, outputTokens: 6 } } }], ({ raw, returned }) => {
    const capture = raw.responses[0].privateProviderReceipt; assert.equal(capture.status, 'binding_mismatch');
    assert.deepEqual(capture.observations[0].binding.resultComparison.mismatchedFields.sort(), ['requestId', 'usage']);
    assert.deepEqual(raw.responses[0].result, returned[0]);
  });
});
test('non-thinking receipt cannot claim a wire reasoning effort or an extra attempt', async () => {
  await harness([{ prompt: 'forbidden-disabled-metadata', disabled: true, patchReceipt: { reasoningEffort: 'low', attempts: 2 } }], ({ raw, returned, calls }) => {
    const capture = raw.responses[0].privateProviderReceipt; assert.equal(capture.status, 'binding_mismatch');
    assert.ok(capture.observations[0].binding.intentComparison.mismatchedFields.includes('forbidden_wire_reasoningEffort'));
    assert.ok(capture.observations[0].binding.intentComparison.mismatchedFields.includes('attempts'));
    assert.deepEqual(raw.responses[0].result, returned[0]); assert.equal(calls.length, 1);
  });
});
test('concurrent out-of-order calls keep their content, hashes, dispatch and policy isolated', async () => {
  let release; const held = new Promise(resolve => { release = resolve; });
  await harness([{ prompt: 'slow', disabled: true, beforeReceipt: () => held, mutateAfterTap: true },
    { prompt: 'fast', afterReceipt: async () => { await pause(); release(); } }], ({ raw }) => {
    assert.equal(raw.responses.length, 2); assert.equal(new Set(raw.responses.map(row => row.callId)).size, 2);
    for (const response of raw.responses) {
      const row = assertBinding(response), label = response.result.requestId.replace('provider-', '');
      assert.ok(row.receipt.content.includes('PRIVATE_RAW_' + label)); assert.equal(row.receipt.usage.inputTokens, usage.inputTokens);
      assert.equal(row.contentSha256, byteHash(row.receipt.content)); assert.doesNotMatch(row.receipt.content, /MUTATED/);
      if (label === 'slow') { assert.equal(row.receipt.thinking, 'disabled'); assert.equal(row.receipt.wireReasoningEffort, null); assert.equal(row.receipt.temperature, 0); assert.equal(row.receipt.topP, 1); assert.equal(Object.hasOwn(row.receipt, 'reasoningEffort'), false); }
    }
  });
});
test('multiple observed receipts are retained as an anomaly without a second request', async () => {
  await harness([{ prompt: 'duplicate', duplicateReceipt: true }], ({ raw, calls }) => {
    const capture = raw.responses[0].privateProviderReceipt; assert.equal(capture.status, 'multiple_observed'); assert.equal(capture.captureCount, 2);
    assert.equal(capture.observations.length, 2); assert.equal(calls.length, 1);
  });
});
test('a timeout without a receipt keeps not_observed and the original failure', async () => {
  const result = { ok: false, reason: 'timeout', model: 'deepseek-flash', upstreamAttempted: true };
  await harness([{ prompt: 'timeout', noReceipt: true, result }], ({ raw, calls }) => {
    assert.equal(raw.responses[0].privateProviderReceipt.status, 'not_observed'); assert.equal(raw.responses[0].privateProviderReceipt.notObservedReason, 'no_receipt_callback');
    assert.deepEqual(raw.responses[0].result, result); assert.equal(calls.length, 1);
  });
});
test('a supplied legacy module set without the optional private tap retains the same result', async () => {
  await harness([{ prompt: 'legacy-module' }], ({ raw, calls }) => {
    assert.equal(raw.responses[0].privateProviderReceipt.status, 'not_observed'); assert.equal(raw.responses[0].privateProviderReceipt.notObservedReason, 'tap_unavailable'); assert.equal(calls.length, 1);
  }, { noTapModule: true });
});
test('opening a prior completed original without capture fields does not dispatch or backfill it', async () => {
  await harness([{ prompt: 'old-original' }], async ({ raw, run, resultPath, calls }) => {
    for (const response of raw.responses) delete response.privateProviderReceipt;
    const priorBytes = Buffer.from(JSON.stringify(raw, null, 2) + '\n'); await writeFile(resultPath, priorBytes, { mode: 0o600 });
    const count = calls.length, reopened = await run();
    assert.equal(calls.length, count); assert.equal(Object.hasOwn(reopened.value.responses[0], 'privateProviderReceipt'), false);
    assert.deepEqual(await readFile(resultPath), priorBytes);
  });
});
