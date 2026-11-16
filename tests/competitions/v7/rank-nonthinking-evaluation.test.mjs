import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHash } from '../../../scripts/competitions/v7/evaluation-policy.mjs';
import { evaluationRuntimeForEffort, requireTop5EvaluationRuntime, rankNonThinkingContinuationForScope, assertDispatchEffort, assertCallEffort } from '../../../scripts/competitions/v7/evaluation-effort.mjs';
import { rankNonThinkingPilotSlotMetrics, RANK_NONTHINKING_PILOT_SLOTS } from '../../../scripts/competitions/v7/rank-nonthinking-pilot-proof.mjs';
import { RANK_NON_THINKING_EFFORT_POLICY as policy, effortPolicySha256, DEFAULT_EFFORT_POLICY } from '../../../src/lib/ai/effort-policy.mjs';
import { RANK_NONTHINKING_AUTHORIZATION_POLICY } from '../../../src/lib/ai/execution-policy.mjs';

const hash=effortPolicySha256(policy),digest='a'.repeat(64),slot=RANK_NONTHINKING_PILOT_SLOTS[0];
const continuation=()=>({proofFile:'artifacts/pilot-proof.json',proofSha256:digest,sourceBindingsSha256:digest,pilotExecutionSha256:digest,pilotPlanSha256:digest,
  complete:3,detailLayout:'single',effortPolicySha256:hash,slotIds:RANK_NONTHINKING_PILOT_SLOTS.map(row=>row.slotId)});
const scope=()=>({effortPolicy:policy,phase:'formal',authorizationPolicySource:RANK_NONTHINKING_AUTHORIZATION_POLICY,approvedPolicyPath:'artifacts/budget/approved-policy.md',pilotContinuation:continuation()});
const dispatch=()=>({operation:'competition_v7_rank',thinkingType:'disabled',policyReasoningEffort:'low',wireReasoningEffort:null,temperature:0,topP:1,effortPolicySha256:hash});

test('v1 default guard stays unchanged and v2 needs an explicit opt-in',()=>{
  assert.deepEqual(requireTop5EvaluationRuntime(evaluationRuntimeForEffort(DEFAULT_EFFORT_POLICY)),DEFAULT_EFFORT_POLICY);
  assert.throws(()=>requireTop5EvaluationRuntime(evaluationRuntimeForEffort(policy)));
  assert.deepEqual(requireTop5EvaluationRuntime(evaluationRuntimeForEffort(policy),{allowRankNonThinking:true}),policy);
});
test('continuation recognizes source identity separately from the copied policy path',()=>{
  assert.deepEqual(rankNonThinkingContinuationForScope(scope()),continuation());
  assert.equal(rankNonThinkingContinuationForScope({effortPolicy:DEFAULT_EFFORT_POLICY}),null);
  for(const patch of [{pilotContinuation:null},{phase:'calibration'},{authorizationPolicySource:'docs/v7/compact-output-contract-20261110.md'},
    {pilotContinuation:{...continuation(),complete:2}},{pilotContinuation:{...continuation(),slotIds:undefined}}])
    assert.throws(()=>rankNonThinkingContinuationForScope({...scope(),...patch}),/verified_continuation_required/);
});
test('disabled rank proves actual sampling and absence of the wire effort key',()=>{
  assertDispatchEffort(dispatch(),policy);
  for(const patch of [{reasoningEffort:'low'},{wireReasoningEffort:'low'},{temperature:1},{topP:.95},{thinkingType:'enabled'}])
    assert.throws(()=>assertDispatchEffort({...dispatch(),...patch},policy));
  const call={call_operation:'competition_v7_rank',operation:'competition_v7_rank',call_key:'v7.rank:fixture',call_thinking:'disabled',call_reasoning_effort:'low',effort:'low',call_effort_policy_sha256:hash,effort_policy_sha256:hash};
  assertCallEffort(call,policy);
  assert.throws(()=>assertCallEffort({...call,call_thinking:'enabled'},policy));
});
function fixture(){
  const started=1_800_000_000_000,records=Array.from({length:45},(_,index)=>({recordId:`fixture-${index}`}));
  const execution={implementationSha256:digest,catalogSha256:canonicalHash(records)};
  const submitted={runId:'fixture-run',submittedAtEpochMs:started,firstListTargetEpochMs:started+40000,listDeadlineEpochMs:started+60000,detailTargetEpochMs:started+120000,detailDeadlineEpochMs:started+150000};
  const responses=['rank','explain','review'].map((stage,index)=>({callId:`fixture-call-${index}`,effortPolicySha256:hash,
    evidenceType:'actual_ai_json_result_and_transport_reservation_events',options:{operation:`competition_v7_${stage}`,thinking:stage==='rank'?'disabled':'enabled',reasoningEffort:'low',
      ...(stage==='rank'?{policyReasoningEffort:'low',wireReasoningEffort:null,temperature:0,topP:1}:{})},
    result:{upstreamAttempted:true},events:[{type:'ai_transport_dispatch',details:stage==='rank'?dispatch():{operation:`competition_v7_${stage}`,thinkingType:'enabled',reasoningEffort:'low',effortPolicySha256:hash}}]}));
  const raw={slotId:slot.slotId,responses,observation:{caseId:slot.caseId,repetition:slot.repetition,algorithm:'C',status:'observed',fallback:false,
    inputSha256:digest,freezeBinding:{implementationSha256:digest},runtime:evaluationRuntimeForEffort(policy),execution:{actualModelRun:true,kind:'live_product',httpDispatches:3},
    output:{recommendations:[{itemId:'fixture'}]},groupedRuns:[{runId:'fixture-run',status:'ready',body:{detailLayout:'single',implementationSha256:digest,effortPolicy:policy,
      listReadyAt:new Date(started+40000).toISOString(),detailsReadyAt:new Date(started+120000).toISOString(),context:{records}}}]}};
  return{raw,submitted,execution};
}
test('fixed 40/120 boundary uses submitted clocks and keeps detail-stage timing separate',()=>{
  const {raw,submitted,execution}=fixture();
  const metrics=rankNonThinkingPilotSlotMetrics(slot,raw,submitted,execution,digest);
  assert.equal(metrics.listMs,40000);assert.equal(metrics.detailsMs,120000);assert.equal(metrics.detailStageMs,80000);
  raw.observation.groupedRuns[0].body.detailsReadyAt=new Date(submitted.submittedAtEpochMs+120001).toISOString();
  assert.throws(()=>rankNonThinkingPilotSlotMetrics(slot,raw,submitted,execution,digest),/40s_120s/);
});
test('missing report, wrong input, missing transport, or an extra dispatch cannot be a passing pilot slot',()=>{
  for(const mutate of [raw=>{raw.observation.status='indeterminate';},raw=>{raw.observation.inputSha256='b'.repeat(64);},
    raw=>{raw.responses[0].events=[];},raw=>{raw.responses[0].events.push(raw.responses[0].events[0]);}]){
    const {raw,submitted,execution}=fixture();mutate(raw);
    assert.throws(()=>rankNonThinkingPilotSlotMetrics(slot,raw,submitted,execution,digest));
  }
});
