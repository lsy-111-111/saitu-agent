import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {isRankNonThinkingReviewOwnerPath, RANK_NONTHINKING_PILOT_SLOTS, rankNonThinkingPilotSlotMetrics} from './rank-nonthinking-pilot-proof.mjs';

const root=path.resolve('/tmp/saitu-proof-owner-test');
for(const cohort of ['compact-20261110','resume-20261111','accelerate-20261111'])for(const owner of ['E','F']){
  test(`accepts locked ${owner} evidence under explicit ${cohort} cohort`,()=>{
    assert.equal(isRankNonThinkingReviewOwnerPath(root,owner,path.join(root,'artifacts',cohort,owner,'fixed3','review.safe.json')),true);
  });
}
test('an observed but empty pilot report cannot satisfy the development gate',()=>{
  const slot=RANK_NONTHINKING_PILOT_SLOTS[0];
  assert.throws(()=>rankNonThinkingPilotSlotMetrics(slot,{slotId:slot.slotId,observation:{...slot,
    status:'observed',fallback:false,output:{recommendations:[]}}}),/one_to_five_recommendations_required/);
});
for(const [owner,member] of [
  ['E','artifacts/resume-20261111/F/review.safe.json'],
  ['F','artifacts/resume-20261111/E/review.safe.json'],
  ['E','artifacts/resume-20261111/E-other/review.safe.json'],
  ['E','artifacts/resume-20261111/E/../D/review.safe.json'],
  ['E','artifacts/resume-20261112/E/review.safe.json'],
  ['E','artifacts/compact-20261110-copy/E/review.safe.json'],
  ['E','artifacts/fast24-20261109/E/review.safe.json'],
  ['E','../outside/artifacts/resume-20261111/E/review.safe.json'],
  ['D','artifacts/resume-20261111/D/review.safe.json'],
  ['E','artifacts/resume-20261111/E'],
])test(`rejects mismatched owner or unapproved cohort: ${owner} ${member}`,()=>{
  assert.equal(isRankNonThinkingReviewOwnerPath(root,owner,path.resolve(root,member)),false);
});
