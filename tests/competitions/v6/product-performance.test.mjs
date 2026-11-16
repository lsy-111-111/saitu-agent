import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePerformanceRegistration,validatePerformanceProfileReview,performanceProfileSemantics,summarizePerformance} from '../../../scripts/competitions/v6/product-performance.mjs';
import {canonicalHash} from '../../../scripts/competitions/v6/frozen-ranking-executor.mjs';
const registration=()=>({schemaVersion:'saitu.browser-performance-registration.v1',purpose:'formal',latencyClock:'confirmed_submission_to_browser_report',retries:0,timeoutMs:60000,implementationSha256:'a'.repeat(64),runtimeConfigurationSha256:'b'.repeat(64),profileIndependenceReviewSha256:'a'.repeat(64),journeys:Array.from({length:100},(_,index)=>({journeyId:`j${index}`,profileId:`p${index%60}`,profileInput:{schemaVersion:'saitu.performance-profile.v1',facts:[{field:'experience.1.task',value:`synthetic task ${index%60}`,state:'affirmed',confirmed:true,evidenceLevel:'concrete_experience'}],unknownFields:[],goals:[],primaryGoal:null,tradeoffStatus:'undecided',mode:index%2?'quick':'deep'},viewport:index<50?'desktop':'mobile',flow:index%2?'quick':'deep',steps:[{action:'click',selector:'button',startDecisionClock:true}]}))});
test('formal performance registration preserves 100 runs, 60 inputs, both views and flows',()=>{
  assert.deepEqual(validatePerformanceRegistration(registration()),{journeys:100,profiles:60,desktop:50,mobile:50});
  for(const mutate of [r=>r.journeys.pop(),r=>r.retries=1,r=>r.journeys[99].viewport='desktop',r=>r.journeys.forEach(j=>j.flow='quick'),r=>r.journeys[1].profileInput=r.journeys[0].profileInput,r=>r.journeys[1].journeyId='../outside']){
    const value=registration();mutate(value);assert.throws(()=>validatePerformanceRegistration(value));
  }
});
test('failed, missing, fallback and slow runs remain in original performance denominator',()=>{
  const input=registration(),rows=input.journeys.map((j,index)=>{
    const report={profile:{...j.profileInput,schemaVersion:'saitu.profile.v6'}};
    const first=index<94?1000:20000,full=index<94?2000:50000;
    return {journeyId:j.journeyId,status:'observed',flow:j.flow,profileMatched:true,actualProfileSha256:canonicalHash(performanceProfileSemantics(j.profileInput,{registered:true})),outputSha256:canonicalHash(report),responses:[{status:200,responseVersion:'competition-recommendation.v6',report}],firstDecisionMs:first,fullReportMs:full,browserClock:{clock:{start:0,responseAt:500,first,full,boundary:{requestPath:'/api/competitions/recommend/normalize',registeredClick:true,trustedClick:true}}},fallback:index===0};
  });
  assert.equal(summarizePerformance(input,rows).firstDecisionP95Ms,20000);
  assert.equal(summarizePerformance(input,rows).fullReportP95Ms,50000);
  assert.equal(summarizePerformance(input,rows).fallbacks,1);
  assert.equal(summarizePerformance(input,rows).actualMatchedProfiles,60);
  const altered=structuredClone(rows);for(const row of altered){row.firstDecisionMs=1;row.fullReportMs=2;}
  assert.equal(summarizePerformance(input,altered).firstDecisionP95Ms,null);
  assert.equal(summarizePerformance(input,altered).failed,100);
  const impossible=structuredClone(rows);for(const row of impossible){row.firstDecisionMs=row.browserClock.clock.first=1;row.fullReportMs=row.browserClock.clock.full=2;}
  assert.equal(summarizePerformance(input,impossible).failed,100);
  assert.equal(summarizePerformance(input,rows.slice(0,94)).firstDecisionP95Ms,null);
  assert.equal(summarizePerformance(input,rows.slice(0,94)).notRun,6);
  for(const row of rows.slice(94))row.status='timeout';
  assert.equal(summarizePerformance(input,rows).firstDecisionP95Ms,null);
  assert.equal(summarizePerformance(input,rows).failed,6);
  assert.equal(summarizePerformance(input,rows).acceptancePassed,false);
  assert.throws(()=>summarizePerformance(input,[rows[0],rows[0]]));
});

test('unused labels and unbound observed profile declarations do not count as sixty actual profiles',()=>{
  const input=registration();input.journeys[0].profileInput.unusedLabel='invented';
  assert.throws(()=>validatePerformanceRegistration(input),/strict_performance_profile/);
  const valid=registration();const rows=valid.journeys.map(j=>({journeyId:j.journeyId,status:'observed',firstDecisionMs:1,fullReportMs:2,flow:j.flow}));
  assert.equal(summarizePerformance(valid,rows).actualMatchedProfiles,0);
  assert.equal(summarizePerformance(valid,rows).firstDecisionP95Ms,null);
  assert.equal(summarizePerformance(valid,rows).failed,100);
});

test('independent review binds every registered semantic profile and distinct family',()=>{
  const input=registration(),profiles=[...new Map(input.journeys.map(j=>[j.profileId,{profileId:j.profileId,semanticSha256:canonicalHash(performanceProfileSemantics(j.profileInput,{registered:true})),familyId:`family-${j.profileId}`,outcome:'approved'}])).values()];
  const review={schemaVersion:'saitu.performance-profile-review.v1',authorContextId:'author',reviewerContextIds:['a','b'],profiles};
  assert.equal(validatePerformanceProfileReview(input,review),true);
  assert.throws(()=>validatePerformanceProfileReview(input,{status:'approved'}));
  review.profiles[0].semanticSha256='f'.repeat(64);
  assert.throws(()=>validatePerformanceProfileReview(input,review));
});
