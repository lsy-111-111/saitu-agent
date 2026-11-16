import { expect, it } from "vitest";
import { aggregateConstraintAudit } from "../../../scripts/competitions/v6/constraint-audit";
import { scoringHash } from "../../../scripts/competitions/v6/score-product-observations";
it("counts a false eligibility approval even if both reviews miss it, and keeps an unreviewed case pending",()=>{
  const source={sourceId:"edition",body:"requires a team of three",bodySha256:"f".repeat(64),scope:"2025"};
  const input={evidenceIds:["edition"]}, key={caseId:"1",authorContextId:"author",annotationStatus:"adjudicated" as const,scoring:{expected:{decision:"violated"}}};
  const obs={caseId:"1",repetition:0,status:"observed" as const,operation:"qualify",inputSha256:scoringHash(input),output:{decision:"satisfied"},events:[]};
  const reviews=(["reviewer_a","reviewer_b"] as const).map(role=>({caseId:"1",role,contextId:role,repetition:0,keySha256:scoringHash(key),observationSha256:scoringHash(obs),decisions:[],
    hardConstraintAudit:{violated:false,reason:"fixture reviewers miss the unsafe approval",evidence:[{pointer:"/output/decision",valueSha256:scoringHash("satisfied")}],sources:[{sourceId:"edition",bodySha256:source.bodySha256,quote:"three"}]}}));
  const cases=[{caseId:"1",operation:"qualify",input},{caseId:"2",operation:"qualify",input}];
  const bundle={cases,keys:[key],observations:[obs],reviews,sources:[source]};
  expect(aggregateConstraintAudit(bundle)).toMatchObject({assessed:1,violations:["1"],pending:["2"],complete:false});
  reviews[1].hardConstraintAudit.sources[0].quote="two";
  expect(()=>aggregateConstraintAudit(bundle)).toThrow("constraint_verdict_not_bound_to_case_source");
});
