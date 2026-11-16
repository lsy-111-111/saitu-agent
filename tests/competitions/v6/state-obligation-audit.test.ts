import {expect,it} from "vitest";
import {aggregateStateObligations} from "../../../scripts/competitions/v6/state-obligation-audit";
import {scoringHash} from "../../../scripts/competitions/v6/score-product-observations";
type Input=Parameters<typeof aggregateStateObligations>[0];
function fixture():Input {
 const keys:Input["keys"]=[],cases:Input["cases"]=[],identities:Input["identities"]=[],rows:Input["plan"]["rows"]=[];
 for(let i=0;i<800;i++) {
  const caseId=String(i),item={caseId,operation:"robustness",input:{caseId}};
  const key={caseId,authorContextId:"author",annotationStatus:"adjudicated" as const,scoring:{required:["must respond to changed input"]}};
  cases.push(item);keys.push(key);identities.push({caseId,authorContextId:"author",reviewerContextIds:["a","b"],adjudicatorContextId:"judge"});
  rows.push({caseId,repetition:0,inputSha256:scoringHash(item.input),keySha256:scoringHash(key),items:i?[]:[{
    id:"compare",kind:"counterfactual",keyPointer:"/scoring/required/0",expectedSha256:scoringHash(key.scoring.required[0]),
    observationPointers:["/output/baseResult","/output/perturbedResult"]}]});
 }
 const obs={caseId:"0",repetition:0,operation:"robustness",inputSha256:rows[0].inputSha256,status:"observed" as const,events:[],output:{baseResult:"team",perturbedResult:"unknown"}};
 const reviews=(["reviewer_a","reviewer_b"] as const).map((role,j)=>({caseId:"0",repetition:0,role,contextId:j?"b":"a",observationSha256:scoringHash(obs),
 outcomes:[{id:"compare",passed:true,reason:"changed response linked to both observed outputs",evidence:[{pointer:"/output/baseResult",valueSha256:scoringHash("team")},{pointer:"/output/perturbedResult",valueSha256:scoringHash("unknown")}]}]}));
 return {plan:{schemaVersion:"saitu.800-state-obligations.v1",rows},cases,keys,observations:[obs],identities,reviews};
}
it("binds both sides of an actual counterfactual, never accepting a scalar or a missing mutation",()=>{
 const f=fixture();expect(aggregateStateObligations(f).counterfactual).toEqual({expected:1,passed:1,failed:0,pending:0});
 f.reviews[0].outcomes[0].evidence.pop();expect(()=>aggregateStateObligations(f)).toThrow("state_verdict_missing_original_evidence");
 f.observations=[];f.reviews=[];expect(aggregateStateObligations(f).counterfactual.pending).toBe(1);
});
it("keeps original disagreement pending until an independent reviewed decision binds both original bytes",()=>{
 const f=fixture(),[a,b]=f.reviews;b.outcomes[0].passed=false;
 expect(aggregateStateObligations(f).counterfactual.pending).toBe(1);
 f.reviews.push({...a,role:"adjudicator",contextId:"judge",resolvesReviewSha256:[scoringHash(a),scoringHash(b)]});
 expect(aggregateStateObligations(f).counterfactual.passed).toBe(1);
});
