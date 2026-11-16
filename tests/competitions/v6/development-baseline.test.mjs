import assert from "node:assert/strict";
import test from "node:test";
import { selectDevelopmentBaseline } from "../../../scripts/competitions/v6/select-development-baseline.mjs";

function fixture() {
  const algorithms = ["A1","B"], profiles = [], runs = [], rows = [];
  for (let i = 0; i < 6; i++) {
    const profileId = "p"+i, ids = ["x","y"];
    profiles.push({profileId,familyId:"f"+i,taskGroup:"g"+i,poolItemIds:ids,annotationStatus:"pending",judgments:ids.map(id=>({itemId:id,seriesId:id,relevance:"U"}))});
    rows.push(...ids.map((id,n)=>({profileId,itemId:id,seriesId:id,relevance:n===1?3:0,reason:"fixture judgment",profilePointer:"/profile",candidatePointer:"/facts/0"})));
    for (const algorithm of algorithms) for (let j=0; j<5; j++) runs.push({algorithm,profileId,runId:`${algorithm}-${i}-${j}`,modelStatus:"ok",fallbackUsed:false,displayedItemIds:algorithm==="B"?["y","x"]:ids});
  }
  return {input:{schemaVersion:"saitu.ranking-evaluation.v1",purpose:"development",catalogVersion:"test",expectedRunsPerProfile:5,algorithms,profiles,runs},
    review:{schemaVersion:"saitu.public-development-blind-labels.v1",contextId:"unit-test",rows}};
}
test("selects from full development families, using the declared tie-break",()=>{
  const {input,review}=fixture();
  assert.equal(selectDevelopmentBaseline(input,review).algorithm,"B");
  for (const row of input.runs) row.displayedItemIds=["y","x"];
  assert.equal(selectDevelopmentBaseline(input,review).algorithm,"A1");
});
test("missing, duplicated, unknown and sealed inputs cannot select a default",()=>{
  const {input,review}=fixture();
  for (const rows of [review.rows.slice(1), [...review.rows,review.rows[0]], [{...review.rows[0],relevance:"U"},...review.rows.slice(1)]]) {
    assert.throws(()=>selectDevelopmentBaseline(input,{...review,rows}));
  }
  assert.throws(()=>selectDevelopmentBaseline({...input,purpose:"ai_proxy_acceptance"},review));
});
