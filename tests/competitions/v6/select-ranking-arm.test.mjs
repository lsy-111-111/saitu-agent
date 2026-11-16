import test from "node:test";
import assert from "node:assert/strict";
import {chooseRankingArm} from "../../../scripts/competitions/v6/select-ranking-arm.mjs";
function fixture(values){
 const summaries=[],profileResults=[];
 for(const [algorithm,value] of Object.entries(values)){
  const families=Array.from({length:120},(_,i)=>({familyId:"f"+i,pooledNdcg5:value}));
  summaries.push({algorithm,aiProxyAcceptanceEligible:true,actualRunCount:600,scoredFamilyCount:120,pooledNdcg5:value,pooledNdcg10:value,top5SeriesJaccard:1,families});
  families.forEach((f,i)=>profileResults.push({algorithm,taskGroup:"g"+Math.floor(i/20),pooledNdcg5:f.pooledNdcg5}));
 }
 return {summaries,profileResults};
}
test("uses C only after absolute thresholds, actual model runs and paired improvement over the preregistered control",()=>{
 const ranking=fixture({A1:0.87,B:0.89,C:0.95}), alpha={value:0.8,paired:4000,candidates:4032};
 assert.equal(chooseRankingArm(ranking,"B",alpha,{actualModelRuns:600}).selectedForReuse,"C");
 assert.equal(chooseRankingArm(ranking,"B",alpha,{actualModelRuns:599}).selectedForReuse,"B");
 assert.equal(chooseRankingArm(ranking,"B",{...alpha,value:0.6},{actualModelRuns:600}).selectedForReuse,null);
 assert.equal(chooseRankingArm(fixture({A1:0.71,B:0.72,C:0.8}),"B",alpha,{actualModelRuns:600}).selectedForReuse,null);
});
