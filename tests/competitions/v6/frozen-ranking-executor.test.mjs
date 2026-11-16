import test from 'node:test';
import assert from 'node:assert/strict';
import {executeFrozenRanking,canonicalHash,summarizeBoundRuns,validateReusableRanking} from '../../../scripts/competitions/v6/frozen-ranking-executor.mjs';
import {validateFormalConfig,validateFormalProfiles} from '../../../scripts/competitions/v6/experiment-registration.mjs';
import {planEvaluationMatrix} from '../../../scripts/competitions/v6/plan-evaluation-matrix.mjs';
function fixture(){
  let observer;const seen=[];
  const report={trace:{method:'llm'},fallback:{used:false},recommendations:[{itemId:'a'}]};
  const context={profile:{facts:[]},candidates:['a','b','c'].map(id=>({record:{recordId:id}}))};
  const profile={schemaVersion:'saitu.profile.v6',profileId:'p'};
  const modules={productObservation:{withProductObservation:async(c,fn)=>{observer=c.observer;return fn();}},model:{runDecisionRecommendation:async(_p,options)=>{seen.push(options.experiment);for(const id of ['match','verify','repair','reverify']){observer({type:'ai_budget_reserved',details:{reservationId:id}});observer({type:'ai_transport_dispatch',details:{reservationId:id}});}return report;}}};
  return {profile,context,modules,report,seen,algorithm:'C',caseId:'case',profileId:'p',familyId:'f',taskGroup:'software_data',repetition:1,seed:6141,freezeBinding:{configurationSha256:'frozen'}};
}
test('one invocation produces two hash-bound artifacts, four stages count as one model run',async()=>{
  const input=fixture(),result=await executeFrozenRanking(input);
  assert.equal(input.seen.length,1);assert.equal(input.seen[0].skipIndependentRecall,true);
  assert.deepEqual([...input.seen[0].candidateOrder].sort(),['a','b','c']);
  assert.equal(result.ranking.invocationId,result.observation.invocationId);
  assert.equal(result.observation.inputSha256,canonicalHash({profile:input.profile}));
  assert.equal(result.observation.outputSha256,canonicalHash(input.report));
  assert.deepEqual(summarizeBoundRuns([result.observation]),{recommendationRuns:1,actualModelRuns:1,httpDispatches:4,successfulCRuns:1,fallbackRuns:0});
  assert.equal(validateReusableRanking({observation:result.observation,ranking:result.ranking,input:{profile:input.profile},algorithm:'C',repetition:0,freezeBinding:input.freezeBinding}),result.observation);
  for(const field of ['outputSha256','invocationId','candidateSetSha256'])assert.throws(()=>validateReusableRanking({observation:result.observation,ranking:{...result.ranking,[field]:'changed'},input:{profile:input.profile},algorithm:'C',repetition:0,freezeBinding:input.freezeBinding}),/binding/);
  assert.throws(()=>summarizeBoundRuns([result.observation,result.observation]),/duplicate/);
});
test('fallback is retained and counted as a model run but cannot count as C success',async()=>{
  const input=fixture();input.report.fallback={used:true,reason:'timeout'};input.report.trace.method='rules';
  const result=await executeFrozenRanking(input),totals=summarizeBoundRuns([result.observation]);
  assert.equal(totals.actualModelRuns,1);assert.equal(totals.successfulCRuns,0);assert.equal(totals.fallbackRuns,1);assert.deepEqual(result.ranking.displayedItemIds,['a']);
});
test('zero dispatch and thrown execution cannot invent actual model usage',async()=>{
  const input=fixture();input.modules.model.runDecisionRecommendation=async()=>{throw new Error('budget_denied');};
  const result=await executeFrozenRanking(input);assert.equal(result.observation.status,'error');assert.equal(summarizeBoundRuns([result.observation]).actualModelRuns,0);assert.deepEqual(result.observation.reservationIds,[]);
});
test('reuse refuses changed inputs, selection, repetition and freeze',async()=>{
  const input=fixture(),result=await executeFrozenRanking(input),args={observation:result.observation,ranking:result.ranking,input:{profile:input.profile},algorithm:'C',repetition:0,freezeBinding:input.freezeBinding};
  for(const change of [{input:{profile:{...input.profile,changed:true}}},{algorithm:'A1'},{repetition:1},{freezeBinding:{configurationSha256:'other'}}])assert.throws(()=>validateReusableRanking({...args,...change}));
});
test('formal config refuses reduced matrix, lower effort and missing provenance',()=>{
  const config={schemaVersion:'saitu.ranking-registration-config.v1',purpose:'ai_proxy_acceptance',phase:'E2',candidatePolicy:'full',seed:6141,effort:'max',repeats:5,algorithms:['A1','B','C'],profileCount:120,inputSha256:'a'.repeat(64),challengeManifestSha256:'b'.repeat(64),sourceSnapshotSha256:'c'.repeat(64)};
  assert.equal(validateFormalConfig(config),config);
  for(const change of [{effort:'high'},{repeats:4},{algorithms:['A1','C']},{sourceSnapshotSha256:null}])assert.throws(()=>validateFormalConfig({...config,...change}));
  assert.throws(()=>validateFormalProfiles({origin:'synthetic',profiles:[]}),/120/);
});
test('full matrix cost estimate never makes missing bounds zero and budgets four HTTP stages',()=>{
  const result=planEvaluationMatrix({schemaVersion:'saitu.evaluation-cost-input.v1',totalCapCny:300,fundedLimitCny:230.02,balanceCny:228.07,cumulativeChargedOrHeldCny:8.664228,estimates:{}});
  assert.equal(result.rankingReports,1800);assert.equal(result.selectedArmReportsReused,600);assert.equal(result.additionalSelectedArmPaidRuns,0);assert.equal(result.maxRankingHttpDispatches,2400);assert.equal(result.conservativeReservedCny,null);assert.equal(result.affordable,null);assert.equal(result.executed,false);assert.ok(Math.abs(result.remainingCny-221.355772)<1e-9);
  assert.equal(result.rows.find(row=>row.id==='development_tier_calibration').invocations,15);
  assert.equal(result.rows.find(row=>row.id==='frozen_tier_validation').invocations,90);
  assert.equal(result.rows.find(row=>row.id==='frozen_tier_validation').maxHttpDispatches,360);
  assert.equal(result.rows.find(row=>row.id==='release_paid_checks').maxHttpDispatches,2);
  assert.equal(result.rows.find(row=>row.id==='necessary_repairs').conservativeReservedCny,null);
  assert.throws(()=>planEvaluationMatrix({schemaVersion:'saitu.evaluation-cost-input.v1',totalCapCny:300,balanceCny:228.07,cumulativeChargedOrHeldCny:8.664228}),/explicit_current_budget/);
});
test('altering declared model-run counts without dispatch evidence is rejected',async()=>{
  const input=fixture(),result=await executeFrozenRanking(input);
  result.observation.execution.actualModelRun=false;
  assert.throws(()=>summarizeBoundRuns([result.observation]),/dispatch_evidence/);
});
test('shared order is identical for baseline and C while B cannot silently drop a candidate',async()=>{
  const input=fixture(),c=await executeFrozenRanking(input);
  input.modules.engine={buildRuleMatchPlan:()=>({}),assembleDecisionReport:()=>({...input.report,trace:{method:'rules'}})};
  input.modules.validation={validateDecisionReport:()=>({ok:true})};
  const a=await executeFrozenRanking({...input,algorithm:'A1'});
  assert.deepEqual(a.candidateOrder,c.candidateOrder);
  input.modules.hybrid={rankHybridCandidates:async()=>({itemIds:['a']}),rerankHybridCandidates:x=>x};
  for(const candidate of input.context.candidates)candidate.record={...candidate.record,sections:{task:[],deliverables:[]},roles:[],skills:[],valueDimensions:[]};
  const b=await executeFrozenRanking({...input,algorithm:'B',embeddingProvider:{model:'synthetic-local-test'}});
  assert.equal(b.observation.status,'error');assert.equal(b.report,null);
});
test('combined scoring stays pending without rankings and refuses unverified matrix metadata',async()=>{
  const {scoreEvaluationBundle}=await import('../../../scripts/competitions/v6/score-evaluation-bundle.mjs');
  const modules={scoreProductObservations:()=>({cases:[],allPassed:false}),evaluateRankings:()=>{throw new Error('must not score unverified input');}};
  assert.equal(scoreEvaluationBundle({product:{}},modules).status,'pending_ranking_evidence');
  assert.throws(()=>scoreEvaluationBundle({product:{},rankingEvidence:{input:{},observations:[],freezeBinding:{}}},modules),/verified_matrix_artifact_bytes/);
});
