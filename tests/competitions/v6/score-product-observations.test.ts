import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { scoreProductObservations, scoringHash, scoringPointer, semanticRulePointers, type ProductSemanticReview } from "../../../scripts/competitions/v6/score-product-observations";

// Synthetic fixtures exercise the evaluator. They are not challenge cases or evidence of product quality.
function fixture() {
  const item={caseId:"synthetic",operation:"qualify",input:{editionScope:"historical-test",target:{kind:"submission_constraint"}}};
  const key={caseId:item.caseId,authorContextId:"test-author",annotationStatus:"adjudicated" as const,scoring:{expected:{decision:"violated"},required:["Keep the submission condition separate from overall eligibility."],forbidden:["Inventing current registration availability."]}};
  const source={sourceId:"test-source",scope:"historical-test",body:"A submitted paper has at most four pages.",bodySha256:""};
  source.bodySha256=createHash("sha256").update(source.body).digest("hex");
  const observation={caseId:item.caseId,operation:item.operation,inputSha256:scoringHash(item.input),status:"observed" as const,
    output:{decision:"violated",targetKind:"submission_constraint",scope:"historical-test",reason:"This submission exceeds the stated limit.",evidence:[{sourceId:source.sourceId,quote:source.body,scope:source.scope}]},events:[]};
  const reviews:ProductSemanticReview[] = (["reviewer_a","reviewer_b"] as const).map(role=>({caseId:item.caseId,repetition:0,contextId:role,role,keySha256:scoringHash(key),observationSha256:scoringHash(observation),decisions:semanticRulePointers(key).map(rulePointer=>({rulePointer,status:"passed",reason:"Test-only semantic judgment.",observations:[{pointer:"/output",valueSha256:scoringHash(observation.output)}],sources:[{sourceId:source.sourceId,bodySha256:source.bodySha256,quote:source.body}]}))}));
  return {cases:[item],keys:[key],observations:[observation],sources:[source],semanticReviews:reviews,expectedRankingRepeats:5 as const};
}

describe("sealed scoring refuses unsupported success",()=>{
  it("leaves matching labels pending without two bound semantic reviews",()=>{
    const data=fixture(); data.semanticReviews=[];
    expect(scoreProductObservations(data).counts).toEqual({passed:0,failed:0,not_run:0,pending:1});
  });
  it("scores a fully bound synthetic case without claiming overall acceptance",()=>{
    const result=scoreProductObservations(fixture());
    expect(result.allPassed).toBe(true);expect(result.productAcceptance).toBe(false);
  });
  it("rejects changed output, author self-review and a fabricated supporting quote",()=>{
    const data=fixture();data.observations[0].output.reason="Changed after review";
    expect(scoreProductObservations(data).cases[0].status).toBe("pending");
    const own=fixture();own.semanticReviews[0].contextId=own.keys[0].authorContextId;
    expect(scoreProductObservations(own).cases[0].status).toBe("pending");
    const fabricated=fixture();fabricated.observations[0].output.evidence[0].quote="Made up rule";
    expect(scoreProductObservations(fabricated).cases[0].status).toBe("failed");
  });
  it("retains missing and unavailable executions in the denominator",()=>{
    const data=fixture();data.observations=[];
    const result=scoreProductObservations(data);expect(result.denominator).toBe(1);expect(result.counts.not_run).toBe(1);expect(result.allPassed).toBe(false);
  });
  it("cannot turn an explicit wrong label into pass with agreeing reviewers",()=>{
    const data=fixture();data.observations[0].output.decision="satisfied";
    for(const review of data.semanticReviews){review.observationSha256=scoringHash(data.observations[0]);for(const verdict of review.decisions)verdict.observations[0].valueSha256=scoringHash(data.observations[0].output);}
    expect(scoreProductObservations(data).cases[0].status).toBe("failed");
  });
  it("preserves disagreements until a fresh adjudicator binds both original reviews",()=>{
    const data=fixture();data.semanticReviews[1].decisions[0].status="failed";
    expect(scoreProductObservations(data).cases[0].status).toBe("pending");
    data.semanticReviews.push({...structuredClone(data.semanticReviews[0]),contextId:"fresh-test-adjudicator",role:"adjudicator",resolvesReviewSha256:[scoringHash(data.semanticReviews[0]),scoringHash(data.semanticReviews[1])]});
    expect(scoreProductObservations(data).cases[0].status).toBe("passed");
    data.semanticReviews[2].resolvesReviewSha256=undefined;
    expect(scoreProductObservations(data).cases[0].status).toBe("pending");
  });
  it("rejects duplicate observations, unknown sources and prototype pointer traversal",()=>{
    const data=fixture();data.observations.push(data.observations[0]);
    expect(()=>scoreProductObservations(data)).toThrow("duplicate_or_extra_observation");
    const changed=fixture();changed.sources[0].body="Other body";
    expect(()=>scoreProductObservations(changed)).toThrow("frozen_source_body_hash_mismatch");
    expect(()=>scoringPointer({},"/__proto__/toString")).toThrow("unsafe_pointer");
  });
  it("does not convert a complete five-run ranking into relevance labels",()=>{
    const item={caseId:"rank-only",operation:"recommend",input:{profile:{}}};
    const result=scoreProductObservations({cases:[item],keys:[{caseId:item.caseId,authorContextId:"test-author",annotationStatus:"adjudicated",scoring:{labels:null}}],observations:Array.from({length:5},(_,repetition)=>({caseId:item.caseId,operation:item.operation,inputSha256:scoringHash(item.input),status:"observed",output:{items:[]},events:[],repetition})),sources:[],semanticReviews:[],expectedRankingRepeats:5});
    expect(result.cases[0].runs).toHaveLength(5);expect(result.cases[0].status).toBe("pending");
  });
});
