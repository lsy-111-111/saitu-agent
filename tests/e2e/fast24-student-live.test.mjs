import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertStudentLiveConfig, assertSupplementalActualOutput, supplement } from './fast24-student-live.mjs';

const plan = JSON.parse(readFileSync(new URL('./fixtures/fast24-student-plan.json', import.meta.url)));
const config = () => ({ schemaVersion: 'saitu.fast24.student-live-config.v1', authorContextId: '/root', denominator: 12,
  spend: { phase: 'formal', authorizedPhase: 'formal', executionMode: 'user-unbounded', executionLimits: { modelConcurrencyLimit: null, totalCallLimit: null, totalCostLimitMicros: null } },
  automaticPaidRetries: false, formal396Credit: false, actualParticipants: 0, supplementalCases: [structuredClone(supplement)], baseUrl: 'http://127.0.0.1:3172/' });

test('accepts one shared formal scope without requiring an empty grant or exclusive ledger', () => {
  const value = config(); value.existingFormalLedgerRows = [{ id: 'other-collector-original' }];
  assert.equal(assertStudentLiveConfig(value, plan), value);
  assert.equal(plan.cases.length, 12);
});
test('rejects calibration, finite caps, rewritten denominator or accidental formal396 credit', () => {
  for (const mutate of [value => { value.spend.phase = 'calibration'; }, value => { value.spend.executionLimits.totalCallLimit = 100; },
    value => { value.denominator = 13; }, value => { value.formal396Credit = true; }, value => { value.automaticPaidRetries = true; },
    value => { value.baseUrl = 'https://public.example.org'; }]) {
    const value = config(); mutate(value); assert.throws(() => assertStudentLiveConfig(value, plan));
  }
});
test('refuses supplemental date restrictions and sample rewrites', () => {
  const value = config(); value.supplementalCases[0].profileNote = '只考虑当前可以报名的比赛';
  assert.throws(() => assertStudentLiveConfig(value, plan));
  assert.doesNotMatch(supplement.profileNote, /当前报名|截止|开赛|赛程|202[0-9]|历史/);
  assert.equal(supplement.excludedTasks.length, 10);
});
test('records zero or three actual proof results without altering the model output', () => {
  for (const count of [0, 3]) {
    const output = { items: Array.from({ length: count }, (_, index) => ({ itemId: `proof-${index}` })), shortfallReason: '只保留与明确任务偏好一致的建议。' };
    const before = structuredClone(output);
    assert.equal(assertSupplementalActualOutput(output, ['proof-0', 'proof-1', 'proof-2']).candidateCount, count);
    assert.deepEqual(output, before);
  }
});
test('preserves a failing actual output with too many candidates or a rejected task', () => {
  assert.throws(() => assertSupplementalActualOutput({ items: [1, 2, 3, 4].map(itemId => ({ itemId })), shortfallReason: '不足五项。' }, [1, 2, 3, 4]));
  const output = { items: [{ itemId: 'software-task' }], shortfallReason: '只给一项。' }, before = structuredClone(output);
  assert.throws(() => assertSupplementalActualOutput(output, ['proof-task'])); assert.deepEqual(output, before);
});
