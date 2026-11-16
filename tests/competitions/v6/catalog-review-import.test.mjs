import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCatalogReviews} from '../../../scripts/competitions/v6/import-catalog-reviews.mjs';
const record={recordId:'r',seriesId:'s',review:{authorAgentId:'author'},sources:[{id:'official'}]};
const review={runId:'run-a',reviewerId:'review-a',model:'synthetic-test',reviewedAt:'2026-01-01T00:00:00Z',contentDigest:'a'.repeat(64),method:'independent_source_recheck',sourceIds:['official'],evidenceArtifact:'synthetic-only',checks:{factualSupport:true,entityScope:true,studentUsefulness:true,temporalAccuracy:true},outcome:'approved',findings:[]};
const run=(ledger,incoming)=>mergeCatalogReviews({records:[record],reviewedRecords:[record,{...record,digest:'b'.repeat(64)}],ledger,incoming,digest:r=>r.digest??'a'.repeat(64),dualReviewed:r=>new Set((r.review.aiReviews??[]).filter(x=>x.contentDigest==='a'.repeat(64)&&x.outcome==='approved').map(x=>x.reviewerId)).size>=2});
test('review import preserves old digests, rejects self-review and never rewrites an approval',()=>{
  const first=run({},[{recordId:'r',review}]);assert.equal(first.dualReviewedSeries.length,0);
  const next=run(first.ledger,[{recordId:'r',review:{...review,reviewerId:'review-b',runId:'run-b'}}]);assert.deepEqual(next.dualReviewedSeries,['s']);
  const stale=run(first.ledger,[{recordId:'r',review:{...review,reviewerId:'review-b',runId:'run-b',contentDigest:'b'.repeat(64)}}]);assert.equal(stale.dualReviewedSeries.length,0);assert.equal(stale.report[0].current,false);assert.equal(stale.ledger.r.length,2);
  assert.throws(()=>run(first.ledger,[{recordId:'r',review:{...review,outcome:'changes_requested'}}]),/immutable_review_conflict/);
  assert.throws(()=>run({},[{recordId:'r',review:{...review,reviewerId:'author'}}]),/invalid_independent/);
  assert.throws(()=>run({},[{recordId:'r',review:{...review,sourceIds:['not-registered']}}]),/invalid_independent/);
  assert.throws(()=>run({},[{recordId:'r',review:{...review,checks:{...review.checks,factualSupport:false}}}]),/unresolved_checks/);
  const retired=mergeCatalogReviews({records:[],reviewedRecords:[record],ledger:{},incoming:[{recordId:'r',review}],digest:()=> 'a'.repeat(64),dualReviewed:()=>false});
  assert.equal(retired.report[0].retired,true);assert.equal(retired.report[0].current,false);assert.equal(retired.ledger.r.length,1);assert.equal(retired.dualReviewedRecords.length,0);
});
