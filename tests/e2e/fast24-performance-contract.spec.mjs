import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fast24PerformancePlan, scoreFast24Performance } from './fast24-performance-contract.mjs';

const records = () => Array.from({ length: 30 }, (_, index) => ({ caseId: `request-${index}`, viewport: index % 2 ? 'mobile' : 'desktop',
  realProviderDispatch: true, receiptSha256: 'a'.repeat(64), success: true, pageDelivered: true,
  listItemCount: 3, listItemIds: ['a', 'b', 'c'], finalListItemCount: 3, finalListItemIds: ['a', 'b', 'c'],
  reportItemCount: 3, reportItemIds: ['a', 'b', 'c'],
  timing: { listMs: 12_000, allDetailsMs: 30_000, readyExpansionMs: 100 } }));

test('30 new original requests, balanced across actual viewport settings', async () => {
  const original = JSON.parse(await readFile(new URL('./fixtures/v7-performance-browser-plan.json', import.meta.url)));
  const plan = fast24PerformancePlan(original);
  assert.equal(plan.cases.length, 30);
  assert.equal(plan.cases.filter(row => row.viewport === 'desktop').length, 15);
  assert.equal(plan.cases.filter(row => row.viewport === 'mobile').length, 15);
  assert.equal(new Set(plan.cases.map(row => row.caseId)).size, 30);
  assert.equal(original.cases.length, 100);
  assert.equal(plan.automaticPaidRetries, false);
});

test('29 complete originals can pass while the failed original stays in p95 and denominator', () => {
  const rows = records(); rows[0] = { ...rows[0], success: false, pageDelivered: false, timing: null };
  const score = scoreFast24Performance(rows);
  assert.equal(score.denominator, 30); assert.equal(score.completed, 29); assert.equal(score.passed, true);
  assert.equal(score.metrics.firstList.denominator, 30); assert.equal(score.metrics.firstList.missingOrFailed, 1);
  assert.deepEqual(score.failedCaseIds, ['request-0']);
});

test('two failed originals cannot disappear from a passing percentile', () => {
  const rows = records(); rows[0].success = false; rows[1].success = false;
  const score = scoreFast24Performance(rows);
  assert.equal(score.completed, 28); assert.equal(score.passed, false);
  assert.equal(score.metrics.firstList.p95Ms, null); assert.equal(score.metrics.firstList.p95IsUndelivered, true);
});

test('a receipt without real provider dispatch cannot count as completed', () => {
  const rows = records(); rows[0].realProviderDispatch = false; rows[1].receiptSha256 = null;
  const score = scoreFast24Performance(rows);
  assert.equal(score.completed, 28); assert.equal(score.passed, false);
});

test('an audited subset may be smaller than the provisional list', () => {
  const rows = records();
  rows[0] = { ...rows[0], finalListItemCount: 2, finalListItemIds: ['a', 'c'], reportItemCount: 2, reportItemIds: ['a', 'c'] };
  const score = scoreFast24Performance(rows);
  assert.equal(score.completed, 30);
  assert.equal(score.passed, true);
});

test('an empty final report or a final list and report count mismatch is a failed delivery', () => {
  const rows = records();
  rows[0].reportItemCount = 0;
  rows[1].reportItemCount = 2;
  const score = scoreFast24Performance(rows);
  assert.equal(score.completed, 28);
  assert.equal(score.metrics.allDetails.missingOrFailed, 2);
  assert.deepEqual(score.failedCaseIds, ['request-0', 'request-1']);
});

test('equal counts cannot hide final membership differences, replacements or reordering', () => {
  const rows = records();
  rows[0].reportItemIds = ['a', 'c', 'b'];
  rows[1].finalListItemIds = rows[1].reportItemIds = ['a', 'b', 'd'];
  rows[2].finalListItemIds = rows[2].reportItemIds = ['a', 'c', 'b'];
  rows[3].finalListItemIds = rows[3].reportItemIds = ['a', 'b', 'b'];
  const score = scoreFast24Performance(rows);
  assert.equal(score.completed, 26);
  assert.deepEqual(score.failedCaseIds, ['request-0', 'request-1', 'request-2', 'request-3']);
});

test('list, details and expansion each retain their own hard target', () => {
  for (const [key, value, metric] of [['listMs', 40_001, 'firstList'], ['allDetailsMs', 120_001, 'allDetails'], ['readyExpansionMs', 1_001, 'readyExpansion']]) {
    const rows = records(); for (const row of rows) row.timing[key] = value;
    const score = scoreFast24Performance(rows);
    assert.equal(score.metrics[metric].passed, false); assert.equal(score.passed, false);
  }
});

test('late results beyond original 60s/150s are not completed flows', () => {
  const rows = records(); rows[0].timing.listMs = 60_001; rows[1].timing.allDetailsMs = 150_001;
  const score = scoreFast24Performance(rows); assert.equal(score.completed, 28); assert.equal(score.passed, false);
});

test('a backwards browser clock is not a completed delivery', () => {
  const rows = records(); rows[0].timing.allDetailsMs = 1; rows[1].timing.listMs = -1;
  assert.equal(scoreFast24Performance(rows).completed, 28);
});

test('missing requests, duplicates and viewport relabelling are rejected', () => {
  assert.throws(() => scoreFast24Performance(records().slice(1)), /30_unique_requests/);
  const duplicates = records(); duplicates[1].caseId = duplicates[0].caseId;
  assert.throws(() => scoreFast24Performance(duplicates), /30_unique_requests/);
  const unbalanced = records(); unbalanced[0].viewport = 'mobile';
  assert.throws(() => scoreFast24Performance(unbalanced), /30_unique_requests/);
});
