import {expect,it} from "vitest";
import {aggregateReasonAudit} from "../../../scripts/competitions/v6/reason-audit";
import {scoringHash} from "../../../scripts/competitions/v6/score-product-observations";
it("does not accept reviewer approval of a reason that uses a withdrawn personal fact",()=>{
  const claim={text:"你已经做过这个项目",basis:"student",studentFactIds:["old"],competitionFactIds:[],conditions:[]};
  const obs={caseId:"rank",repetition:0,operation:"recommend",status:"observed" as const,inputSha256:"f",events:[],
    output:{profile:{facts:[{id:"old",confirmed:true,state:"affirmed"}],retractedFactIds:["old"]},recommendations:[{reasons:[claim],evidenceFacts:[]}]}};
  const reviews=(["reviewer_a","reviewer_b"] as const).map(role=>({caseId:"rank",repetition:0,role,contextId:role,observationSha256:scoringHash(obs),
    rows:[{pointer:"/output/recommendations/0/reasons/0",claimSha256:scoringHash(claim),valid:true,reason:"original decision",proof:[]}]}));
  const input={observations:[obs],identities:[{caseId:"rank",authorContextId:"author",reviewerContextIds:["reviewer_a","reviewer_b"] as [string,string]}],sources:[],reviews};
  expect(aggregateReasonAudit(input)).toMatchObject({complete:false,valid:0,displayed:1,completedReports:1});
  expect(aggregateReasonAudit({...input,reviews:reviews.slice(1)})).toMatchObject({unresolved:1,completedReports:0});
  reviews[0].rows[0].pointer="/output/summary";
  expect(()=>aggregateReasonAudit(input)).toThrow("reason_audit_changed_claim_or_verdict");
});
