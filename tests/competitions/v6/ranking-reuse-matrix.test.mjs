import test from 'node:test';
import assert from 'node:assert/strict';
import {executeFrozenRanking} from '../../../scripts/competitions/v6/frozen-ranking-executor.mjs';
import {validateFrozenMatrix} from '../../../scripts/competitions/v6/ranking-reuse.mjs';

// Synthetic transport fixtures only: these are not labels or formal reports.
async function matrixFixture(){
  const groups=['software_data','engineering_design','experimental_agriculture','business_practice','survey_education','arts_language'];
  const binding={registrationSha256:'synthetic-test-only'},seed=6141;
  const profileSnapshot={origin:'ai_authored_sealed',profiles:[]};
  const rankings={purpose:'ai_proxy_acceptance',expectedRunsPerProfile:5,algorithms:['A1','B','C'],profiles:[],runs:[]},observations=[];
  const report=method=>({trace:{method},fallback:{used:false},recommendations:[{itemId:'a'}]});
  const modules={
    productObservation:{withProductObservation:async(_context,fn)=>fn()},
    model:{runDecisionRecommendation:async()=>report('llm')},
    engine:{buildRuleMatchPlan:()=>({}),assembleDecisionReport:(_context,_plan,trace)=>report(trace.method)},
    validation:{validateDecisionReport:()=>({ok:true})},
    hybrid:{rankHybridCandidates:async({documents})=>({itemIds:documents.map(d=>d.itemId)}),rerankHybridCandidates:result=>result},
  };
  for(let index=0;index<120;index++){
    const profileId=`p${index}`,caseId=`case${index}`,familyId=`family${index}`,taskGroup=groups[Math.floor(index/20)];
    const profile={schemaVersion:'saitu.profile.v6',profileId,facts:[]},input={profile};
    profileSnapshot.profiles.push({profileId,caseId,familyId,taskGroup,profile,input});
    const context={profile,candidates:['a','b'].map(recordId=>({record:{recordId,sections:{task:[],deliverables:[]},roles:[],skills:[],valueDimensions:[]}}))};
    rankings.profiles.push({profileId,familyId,taskGroup,poolItemIds:['a','b'],judgments:[{itemId:'a',seriesId:'a'},{itemId:'b',seriesId:'b'}]});
    for(const algorithm of ['A1','B','C'])for(let repetition=1;repetition<=5;repetition++){
      const result=await executeFrozenRanking({algorithm,profile,input,context,profileId,caseId,familyId,taskGroup,repetition,seed,freezeBinding:binding,modules,embeddingProvider:{model:'synthetic-local'}});
      observations.push(result.observation);rankings.runs.push(result.ranking);
    }
  }
  return {profileSnapshot,rankings,observations,binding,seed};
}
test('reuse checks all 1800 identities and permutations before selecting any arm',async()=>{
  const fixture=await matrixFixture();
  assert.deepEqual(validateFrozenMatrix(fixture),{profiles:120,repetitions:5,algorithms:3,reports:1800});
  const alter=mutation=>{const copy=structuredClone(fixture);mutation(copy);assert.throws(()=>validateFrozenMatrix(copy));};
  // Counts remain 1800 in every negative: duplicated or relabelled nonselected
  // reports must not be accepted merely because the chosen A1 arm is intact.
  alter(copy=>{copy.observations[6]=structuredClone(copy.observations[5]);});
  alter(copy=>{copy.observations[5].caseId='case1';});
  alter(copy=>{copy.observations[5].repetition=5;});
  alter(copy=>{copy.rankings.runs[5].profileId='p1';});
  alter(copy=>{copy.observations[5].events[0].details.candidateOrder.reverse();});
  alter(copy=>{copy.observations[5].output.recommendations[0].itemId='unbound';});
  alter(copy=>{copy.profileSnapshot.profiles[0].input.profile.facts=[{field:'changed'}];});
  alter(copy=>{copy.rankings.profiles[0].familyId='different';});
  alter(copy=>{copy.observations[5].execution.actualModelRun=true;});
});
