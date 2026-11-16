// Independent metadata-only bridge probes. Synthetic evidence is never a real
// public-admission approval and no worker, browser, DB or provider is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hasBoundProviderDispatch } from './e2e/v7-browser-evidence.mjs';
import { verifyPublicAdmissionOriginals, inspectPublicAdmission, readImplementationManifest } from '../scripts/competitions/v7/evaluation-registration.mjs';
import { POLICY_VERSION, POLICY_SHA256, EVALUATION_POLICY, canonicalHash } from '../scripts/competitions/v7/evaluation-policy.mjs';

const output = path.resolve('artifacts/continuation-v7-20261109/evaluation/public-receipt-bridge-independent');
const sha = value => createHash('sha256').update(value).digest('hex');
const execFileAsync = promisify(execFile);
const spendRunId = 'independent-synthetic-calibration';
const paid = (id = 'paid-1') => ({ operation: 'competition_v7_rank', effort_policy_sha256: EVALUATION_POLICY.runtime.effortPolicySha256, call_key: 'v7.rank:effort-v1.initial:1', call_operation: 'competition_v7_rank', call_thinking: 'enabled', call_reasoning_effort: 'low', call_effort_policy_sha256: EVALUATION_POLICY.runtime.effortPolicySha256, call_id: id, call_state: 'completed', spend_run_id: spendRunId, model: 'deepseek-flash', effort: 'low', reservation_id: `synthetic-${id}`, originalReceipt: { kind: 'receipt', receipt: { content: '{}', httpStatus: 200 } } });
const repair = () => ({ call_id: 'repair-never-dispatched', call_state: 'completed', spend_run_id: null, model: null, effort: null, reservation_id: null, originalReceipt: { kind: 'result', result: { ok: false, reason: 'timeout', upstreamAttempted: false } } });

async function fixture(calls = [paid(), repair()]) {
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(path.join(output, 'synthetic-originals-'));
  const put = async (name, value, raw = false) => {
    const bytes = raw ? Buffer.from(value) : Buffer.from(JSON.stringify(value) + '\n');
    await writeFile(path.join(directory, name), bytes); return { path: name, sha256: sha(bytes) };
  };
  const pool = [{ competitionId: 'independent-synthetic-competition' }];
  const config = { implementationSha256: '1'.repeat(64), runtimeConfigurationSha256: '2'.repeat(64), catalogSha256: '3'.repeat(64), candidatePoolSha256: canonicalHash(pool), runtimeSourceBindingSha256: '4'.repeat(64), runtime: EVALUATION_POLICY.runtime };
  const runs = [], receipts = [], runChecks = [];
  for (let index = 0; index < 5; index++) {
    const invocationId = `independent-synthetic-run-${index}`, timing = { timeOrigin: 1000, start: 10, listMs: 40000, allDetailsMs: 120000, readyExpansionMs: 1000 };
    const receipt = { schemaVersion: 'saitu.public-browser-receipts.v7.1', invocationId, realProviderDispatch: true, calls: structuredClone(calls), runSnapshot: { context: { records: pool }, items: [{ itemId: 'synthetic-one' }], report: { recommendations: [{ itemId: 'synthetic-one' }] } } };
    const ref = await put(`receipt-${index}.json`, receipt); receipts.push(receipt);
    const success = index < 4;
    runs.push({ invocationId, timing, receiptPath: ref.path, receiptSha256: ref.sha256, realProviderDispatch: true, success, pageDelivered: success, criticalReviewPassed: success });
    const dom = await put(`dom-${index}.json`, { synthetic: true, invocationId, record: { invocationId, timing } });
    const screenshot = await put(`screenshot-${index}.bin`, 'synthetic bytes; no visual or product quality asserted', true);
    runChecks.push({ invocationId, receiptSha256: ref.sha256, criticalReviewPassed: success, dom, screenshot });
  }
  const criticalReview = { schemaVersion: 'saitu.public-critical-review.v7.1', contextId: 'independent-synthetic-reviewer', passed: true, admissionRunsSha256: canonicalHash(runs), runChecks };
  const criticalRef = await put('critical-review.json', criticalReview);
  const admission = { schemaVersion: 'saitu.public-admission.v7.1', policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, authorContextId: 'independent-synthetic-author', ...config, executionScope: { runId: spendRunId, grantVersion: "saitu.v7.top5.v1", authorizedEffort: "stage", effortPolicy: EVALUATION_POLICY.runtime.effortPolicy, effortPolicySha256: EVALUATION_POLICY.runtime.effortPolicySha256 }, runs,
    independentReview: { contextId: criticalReview.contextId, passed: true, evidencePath: criticalRef.path, evidenceSha256: criticalRef.sha256 } };
  async function refresh() {
    for (let index = 0; index < 5; index++) {
      const ref = await put(`receipt-${index}.json`, receipts[index]); runs[index].receiptSha256 = ref.sha256; criticalReview.runChecks[index].receiptSha256 = ref.sha256; criticalReview.runChecks[index].criticalReviewPassed = runs[index].criticalReviewPassed;
    }
    criticalReview.admissionRunsSha256 = canonicalHash(runs);
    const ref = await put('critical-review.json', criticalReview); admission.independentReview.evidenceSha256 = ref.sha256;
  }
  return { directory, admission, config, receipts, criticalReview, refresh, close: () => rm(directory, { recursive: true, force: true }) };
}
async function withFixture(callback, calls) { const value = await fixture(calls); try { await callback(value); } finally { await value.close(); } }

test('formal positive retains a separately proven dispatch beside an explicit unpaid repair slot', async () => {
  await withFixture(async f => {
    assert.equal(hasBoundProviderDispatch(f.receipts[0].calls, spendRunId), true);
    assert.deepEqual(inspectPublicAdmission(f.admission, f.config), []);
    assert.equal((await verifyPublicAdmissionOriginals(f.admission, f.config, f.directory)).originalRunsVerified, 5);
  });
});

test('all proven and crash-window attempts remain bound to the finite public scope', () => {
  assert.equal(hasBoundProviderDispatch([], spendRunId), false);
  assert.equal(hasBoundProviderDispatch([repair()], spendRunId), false);
  assert.equal(hasBoundProviderDispatch([paid(), repair()], spendRunId), true);
  for (const call_state of ['dispatch_intent', 'unknown', 'response_received', 'completed']) {
    const potential = { ...paid('potential'), call_state, originalReceipt: null };
    assert.equal(hasBoundProviderDispatch([potential], spendRunId), false, `${call_state}:not-proof`);
    assert.equal(hasBoundProviderDispatch([paid(), potential], spendRunId), true, `${call_state}:bound`);
    for (const mutation of [{ spend_run_id: 'foreign-batch' }, { model: 'wrong-model' }, { effort: 'max' }, { reservation_id: null }]) {
      assert.equal(hasBoundProviderDispatch([paid(), { ...potential, ...mutation }], spendRunId), false, `${call_state}:${JSON.stringify(mutation)}`);
    }
  }
  assert.equal(hasBoundProviderDispatch([paid(), { ...repair(), originalReceipt: { kind: 'result', result: { upstreamAttempted: true } } }], spendRunId), false);
});

test('formal original receipt verification rejects every wrong-scope or unbound potential dispatch', async () => {
  for (const call_state of ['dispatch_intent', 'unknown', 'response_received', 'completed']) {
    for (const mutation of [{ spend_run_id: 'foreign-batch' }, { model: 'wrong-model' }, { effort: 'max' }, { reservation_id: null }]) {
      await withFixture(async f => {
        f.receipts[0].calls.push({ ...paid('potential'), call_state, originalReceipt: null, ...mutation }); await f.refresh();
        await assert.rejects(verifyPublicAdmissionOriginals(f.admission, f.config, f.directory));
      });
    }
  }
});

test('formal original receipt verification requires the explicit expected public spend scope', async () => {
  for (const value of [undefined, null, '', 'foreign-batch']) {
    await withFixture(async f => {
      f.admission.executionScope = value === undefined ? undefined : { runId: value };
      await assert.rejects(verifyPublicAdmissionOriginals(f.admission, f.config, f.directory));
    });
  }
});

test('forged dispatch booleans cannot replace original receipt proof', async () => {
  for (const calls of [[], [repair()], [{ ...paid(), originalReceipt: null, call_state: 'dispatch_intent' }]]) {
    await withFixture(async f => { await assert.rejects(verifyPublicAdmissionOriginals(f.admission, f.config, f.directory)); }, calls);
  }
});

test('zero-of-five and three-of-five remain rejected even with bound real calls', async () => {
  for (const successful of [0, 3]) {
    await withFixture(async f => {
      f.admission.runs.forEach((run, index) => { run.success = index < successful; run.pageDelivered = index < successful; run.criticalReviewPassed = index < successful; }); await f.refresh();
      assert.ok(inspectPublicAdmission(f.admission, f.config).includes('new_public_five_runs_require_four_real_successes'));
      await assert.rejects(verifyPublicAdmissionOriginals(f.admission, f.config, f.directory), /new_public_five_runs_require_four_real_successes/);
    });
  }
});

test('the two original public batches retain their byte identities and rejected entrance', async () => {
  const expected = { '01': '45436cd7f986b8f6836497904de6b1f205ac346269671eac633ffcd79d5746e9', '02': '77fa763c805529f0ba6d2c64c658473c77aff28cddb7c8b13c1b2bb8320f7bb9' };
  for (const [batch, hash] of Object.entries(expected)) {
    const bytes = await readFile(`artifacts/continuation-v7-20261109/frontend/public-admission-${batch}/observations/public-admission.json`), admission = JSON.parse(bytes);
    assert.equal(sha(bytes), hash);
    assert.equal(admission.runs.filter(row => row.success && row.pageDelivered && row.criticalReviewPassed).length, 0);
    assert.ok(inspectPublicAdmission(admission, admission).includes('new_public_five_runs_require_four_real_successes'));
    await assert.rejects(verifyPublicAdmissionOriginals(admission, admission, path.resolve(`artifacts/continuation-v7-20261109/frontend/public-admission-${batch}/observations`)), /new_public_five_runs_require_four_real_successes/);
  }
});

test('both future harness pins bind the browser bridge and every new runtime helper byte', async () => {
  const sharedPath = 'scripts/competitions/v7/evaluation-dispatch-evidence.mjs';
  const shared = await import('../scripts/competitions/v7/evaluation-dispatch-evidence.mjs');
  assert.equal(hasBoundProviderDispatch, shared.hasBoundProviderDispatch, 'browser bridge must reexport the same function');
  const manifest = await readImplementationManifest(process.cwd());
  for (const relative of [sharedPath, 'scripts/competitions/v7/evaluation-dispatch-evidence.d.mts']) {
    const row = manifest.find(item => item.path === relative);
    assert.ok(row, `${relative}:implementation-manifest-member`);
    assert.equal(row.sha256, sha(await readFile(relative)), `${relative}:implementation-byte-binding`);
  }
  for (const harness of ['tests/e2e/v7-public-browser.mjs', 'tests/e2e/v7-performance-browser.mjs']) {
    const source = await readFile(harness, 'utf8'), match = /const harnessFiles\s*=\s*(\[[\s\S]*?\]);/.exec(source);
    assert.ok(match, `${harness}:actual-harness-files`);
    const files = JSON.parse(match[1]);
    assert.ok(files.includes('tests/e2e/v7-browser-evidence.mjs'), `${harness}:bridge-is-pinned`);
    assert.ok(files.includes(sharedPath), `${harness}:new-runtime-helper-is-pinned`);
    const entries = await Promise.all(files.map(async relative => ({ path: relative, sha256: sha(await readFile(relative)) })));
    const scratch = await mkdtemp(path.join(output, 'synthetic-harness-pins-'));
    try {
      const destination = path.join(scratch, 'pins.json');
      await execFileAsync(process.execPath, [harness, '--pins', '--output', destination], { cwd: process.cwd(), timeout: 30_000, maxBuffer: 1024 * 1024,
        env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, NODE_ENV: 'development', DATABASE_URL: '', AI_API_KEY: '' } });
      const actual = JSON.parse(await readFile(destination)); assert.equal(actual.harnessSha256, canonicalHash(entries), `${harness}:real-cli-pins`);
      assert.equal(actual.executed, false); assert.equal(actual.paidCalls, 0);
      const hypotheticalSha256 = sha(Buffer.concat([await readFile(sharedPath), Buffer.from('\n// independent hypothetical mutation\n')]));
      const modified = entries.map(row => row.path === sharedPath ? { ...row, sha256: hypotheticalSha256 } : row);
      assert.notEqual(canonicalHash(modified), actual.harnessSha256, `${harness}:helper-change-invalidates-pin`);
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
});
