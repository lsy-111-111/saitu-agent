import { expect,it } from "vitest";
import { aggregateFactAudit } from "../../../scripts/competitions/v6/fact-claim-audit";
import { scoringHash } from "../../../scripts/competitions/v6/score-product-observations";
type Input=Parameters<typeof aggregateFactAudit>[0];
function fixture():Input {
  const item={caseId:"q",operation:"fact_check",input:{claims:[{id:"f",text:"three members"}],evidenceIds:["source"]}};
  const obs={caseId:"q",operation:item.operation,inputSha256:scoringHash(item.input),status:"observed" as const,events:[],
    output:{judgments:[{id:"f",status:"supported",reason:"three members",evidence:[{sourceId:"source",quote:"three members"}]}]}};
  const source={sourceId:"source",scope:"2025 only",body:"required: three members",bodySha256:"d".repeat(64)};
  const proof={sourceId:source.sourceId,scope:source.scope,bodySha256:source.bodySha256,quote:"three members"};
  const reviews:Input["reviews"]=(["reviewer_a","reviewer_b"] as const).map(role=>({role,caseId:"q",contextId:role,observationSha256:scoringHash(obs),
    passages:["reason","status"].map((key,i)=>({pointer:"/output/judgments/0/"+key,textSha256:scoringHash(i?"supported · three members":"three members"),complete:true,
      atoms:[{start:0,end:3,truth:"supported",critical:i===1,needsCitation:true,reason:"observed condition supported by scoped source",proof:[proof],citations:[{sourceId:"source",supports:true,proof:[proof]}]}]}))}));
  return {cases:[item],observations:[obs],reviews,sources:[source],identities:[{caseId:"q",reviewerContextIds:["reviewer_a","reviewer_b"],adjudicatorContextId:"judge",authorContextId:"author"}]};
}
it("binds the verdict and displayed citations to their original source scope and keeps the incomplete case denominator",()=>{
  const f=fixture();expect(aggregateFactAudit(f)).toMatchObject({complete:false,counts:{factualCases:1,atoms:2,accurate:2,supported:2,criticalCovered:1}});
  f.reviews[0].passages[0].atoms[0].proof[0].scope="2026";
  expect(()=>aggregateFactAudit(f)).toThrow("fact_audit_evidence_source_scope_or_bytes_changed");
});
it("requires disagreement adjudication and rejects dropped displayed citations or passages",()=>{
  const f=fixture(),[a,b]=f.reviews; b.passages[0].atoms[0].truth="contradicted";
  expect(aggregateFactAudit(f).pending).toEqual(["q"]);
  f.reviews.push({...a,role:"adjudicator",contextId:"judge",resolvesReviewSha256:[scoringHash(a),scoringHash(b)]});
  expect(aggregateFactAudit(f).pending).toEqual([]);
  b.passages[0].atoms[0].citations=[];
  expect(()=>aggregateFactAudit(f)).toThrow("fact_audit_dropped_or_invented_displayed_citation");
  b.passages.pop();expect(()=>aggregateFactAudit(f)).toThrow("fact_audit_missing_or_duplicate_passage");
});
