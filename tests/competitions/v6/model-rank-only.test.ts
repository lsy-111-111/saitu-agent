import "./mock-publication-boundary";
import { describe, expect, it } from "vitest";
import { buildDecisionContext, buildRuleMatchPlan } from "@/lib/competitions/v6/engine";
import { bindRankedCatalogSuggestions, runDecisionRecommendation } from "@/lib/competitions/v6/model";
import { validateMatchPlan } from "@/lib/competitions/v6/validation";
import { syntheticCatalog, student } from "./decision-fixtures";
const profile=student({confirmedFields:["stage","interests"],interests:["data"]});
const context=buildDecisionContext(profile,{records:syntheticCatalog,now:new Date("2026-11-05T08:00:00Z")});
describe("rank-only independent C variant",()=>{
 it("keeps LLM order and binds corresponding reviewed roles without a rule reorder",async()=>{
  const selected=[...buildRuleMatchPlan(context).recommendations].reverse().slice(0,5).map(item=>item.itemId),seen:string[]=[];
  const report=await runDecisionRecommendation(profile,{context,method:"llm",modelCall:async(prompt,options)=>{
   const stage=options.promptVersion!.split(".").at(-1)!;seen.push(stage);
   return{ok:true,data:stage==="match"?{itemIds:selected,shortfallReason:null}:{checks:JSON.parse(prompt).assertions.map((row:{key:string})=>({key:row.key,supported:true,reason:"合成支持检查"}))},model:"contract-test",upstreamAttempted:true,httpStatus:200,attempts:1,durationMs:1,finishReason:"stop"};
  }});
  expect(report.recommendations.map(item=>item.itemId)).toEqual(selected);
  expect(seen).toEqual(["match",...Array(context.candidates.length).fill("verify")]);expect(report.fallback.used).toBe(false);
  expect(report.trace.roleSource).toBe("reviewed_catalog_suggestion");expect(report.trace.verification).toBe("model_reviewed");
 });
 it("retains duplicate, unknown and insufficient IDs for the original validator to reject",()=>{
  for(const itemIds of [["unknown"],[context.candidates[0].record.recordId,context.candidates[0].record.recordId]]){
   expect(validateMatchPlan(bindRankedCatalogSuggestions(context,{itemIds,shortfallReason:"测试"}),context).ok).toBe(false);
  }
 });
});
