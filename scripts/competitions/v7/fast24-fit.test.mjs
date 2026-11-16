import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFast24Fit } from './fast24-fit.mjs';
import { FAST24 } from './fast24-config.mjs';
const hash = 'a'.repeat(64);
const rows = () => FAST24.groups.flatMap((taskGroup, g) => Array.from({length:8},(_,i) => ({slotId:`${g}:${i}`,taskGroup,technicalComplete:true,displayedCount:5,fittingCount:5,originalSha256:hash})));
const empty = (row, reviews) => ({...row,displayedCount:0,fittingCount:0,emptyReviews:reviews});
const review = (reviewer, reasonableEmpty=true, originalSha256=hash) => ({reviewer,reasonableEmpty,originalSha256});
test('historical scoring preserves the two-review empty credit',()=>{
 const input=rows();input[0]=empty(input[0],[review('E'),review('F')]);input[1]=empty(input[1],[review('E'),review('F')]);
 const scored=scoreFast24Fit(input,{legacyReasonableEmpty:true});
 assert.equal(scored.fitMean,1);assert.equal(scored.legacyFitMean,46/48);
 assert.equal(scored.groupFit.software_data,1);assert.equal(scored.legacyGroupFit.software_data,6/8);
 assert.equal(scored.doubleReviewedReasonableEmptyReports,2);assert.equal(scored.denominator,48);assert.equal(scored.jaccardDefinitionChanged,false);
});
test('current scoring excludes empty and nonmatching reports even when technically delivered',()=>{
 const input=rows();
 input[0]=empty(input[0],[review('E'),review('F')]);
 input[1]={...input[1],displayedCount:3,fittingCount:0};
 const scored=scoreFast24Fit(input);
 assert.equal(scored.fitMean,46/48);
 assert.equal(scored.completeC,46);
 assert.equal(scored.rows[0].complete,false);
 assert.equal(scored.rows[0].fit,0);
 assert.equal(scored.rows[1].complete,false);
});
test('pending, same-reviewer, wrong-original and disputed empty outcomes receive no clarified credit',()=>{
 for(const reviews of [[],[review('E')],[review('E'),review('E')],[review('E'),review('F',true,'b'.repeat(64))],[review('E'),review('F'),review('G',false)]]){
  const input=rows();input[0]=empty(input[0],reviews);const scored=scoreFast24Fit(input);
  assert.equal(scored.fitMean,47/48);assert.equal(scored.doubleReviewedReasonableEmptyReports,0);
 }
});
test('unknown and failed reports stay in the48 denominator even with stray approval metadata',()=>{
 const input=rows();input[0]={...empty(input[0],[review('E'),review('F')]),technicalComplete:false};
 const scored=scoreFast24Fit(input);assert.equal(scored.fitMean,47/48);assert.equal(scored.legacyFitMean,47/48);
});
test('partial nonempty suitability uses displayed item fraction and rejects fabricated counts',()=>{
 const input=rows();input[0]={...input[0],displayedCount:3,fittingCount:2};
 assert.equal(scoreFast24Fit(input).rows[0].fit,2/3);
 input[0].fittingCount=4;assert.throws(()=>scoreFast24Fit(input),/independent_fit_count/);
});
test('removing failures, duplicating slots or changing group denominators is rejected',()=>{
 assert.throws(()=>scoreFast24Fit(rows().slice(1)),/fixed48/);
 const duplicate=rows();duplicate[1].slotId=duplicate[0].slotId;assert.throws(()=>scoreFast24Fit(duplicate),/fixed48/);
 const wrongGroup=rows();wrongGroup[0].taskGroup=FAST24.groups[1];assert.throws(()=>scoreFast24Fit(wrongGroup),/fixed8/);
});
