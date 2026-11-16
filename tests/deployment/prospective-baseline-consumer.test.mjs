import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateProspectiveBaseline } from '../../scripts/run-release-evidence.mjs';

const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`
  : JSON.stringify(value);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const v2 = JSON.parse(await readFile(new URL('../fixtures/competition-score-prospective-baseline.json', import.meta.url)));
function resign(value) {
  value.resultsSha256 = digest(value.results);
  const {artifactSha256: _ignored, ...body} = value;
  value.artifactSha256 = digest(body);
  return value;
}
function rejected(change, pattern) {
  const candidate = structuredClone(v2); change(candidate);
  assert.throws(() => validateProspectiveBaseline(resign(candidate)), pattern);
}

test('valid v2 records all 125 inputs and a null hard exclusion without asserting quality', () => {
  assert.equal(validateProspectiveBaseline(v2), v2);
  assert.equal(v2.results.length, 125);
  assert.equal(v2.results.filter(row => row.fixedPairStatus === 'hard_excluded').length, 1);
  assert.ok(v2.results.some(row => row.finalTop3.length < 3));
});

test('retains the existing content-addressed v1 consumer contract', () => {
  const candidate = {schemaVersion:'competition-score-prospective-baseline.v1', captureIntent:'forward-regression-denominator-only'};
  candidate.artifactSha256 = digest(candidate);
  assert.equal(validateProspectiveBaseline(candidate), candidate);
});

test('rejects changed inputs, null/zero confusion, unsupported exclusion and altered denominator', () => {
  rejected(v => { v.results.pop(); }, /denominator/);
  rejected(v => { v.results[0].inputSha256 = '0'.repeat(64); }, /preserved input/);
  rejected(v => { v.results[0].fixedCompetitionId = 'another-series'; }, /preserved input/);
  rejected(v => { v.results.find(r => r.fixedPairStatus === 'hard_excluded').fixedCompetitionDisplayedScore = 0; }, /hard exclusion/);
  rejected(v => { v.results.find(r => r.fixedPairStatus === 'hard_excluded').fixedCompetitionQualification.sourceRefs = []; }, /hard exclusion/);
  rejected(v => { v.results.find(r => r.fixedPairStatus === 'hard_excluded').fixedCompetitionQualification.status = 'needs_clarification'; }, /hard exclusion/);
  rejected(v => { const r = v.results.find(r => r.fixedPairStatus === 'hard_excluded'); r.top10 = [r.fixedCompetitionId]; }, /hard exclusion/);
  rejected(v => { v.results.find(r => r.fixedPairStatus === 'scored').fixedCompetitionDisplayedScore = null; }, /scored outcome/);
  rejected(v => { v.aggregates.anchorScoredPairCount++; }, /aggregate denominator/);
  rejected(v => { v.aggregates.anchorFixedPairMean = 99; }, /aggregate denominator/);
  rejected(v => { v.historicalComparisonAllowed = true; }, /forward-only/);
});

test('rejects invalid output lists, snapshot traversal and canonical artifact tampering', () => {
  rejected(v => { v.results[0].finalTop3.push('fourth'); }, /result list/);
  rejected(v => { v.results[0].top10[1] = v.results[0].top10[0]; }, /result list/);
  rejected(v => { v.sourceSnapshot.files[0].path = 'src/../secret'; }, /snapshot is invalid/);
  rejected(v => { v.sourceSnapshot.files=v.sourceSnapshot.files.filter(row=>!row.path.endsWith('/experience-fit.ts'));v.sourceSnapshot.snapshotSha256=digest(v.sourceSnapshot.files); }, /member set changed/);
  const tampered = structuredClone(v2); tampered.results[0].fixedCompetitionDisplayedScore++;
  assert.throws(() => validateProspectiveBaseline(tampered), /canonical artifact hash/);
});
