import "./mock-publication-boundary";
import { describe,expect,it } from "vitest";
import { buildDecisionContext } from "@/lib/competitions/v6/engine";
import { rankingDecisionTable,rankingStudentTable } from "@/lib/competitions/v6/ranking-decision-table";
import { syntheticRecord,student } from "./decision-fixtures";
describe("business decision table",()=>{
 it("retains every candidate, unresolved condition, known cost and unknown resource without guessing",()=>{
  const records=Array.from({length:39},(_,index)=>syntheticRecord(index+1000));
  records[0].cost={minimumPersonalCny:100,maximumPersonalCny:null,scope:records[0].scope,factIds:[records[0].facts[0].id],note:"仅已知一项费用，总费用仍未知"};
  records[0].participationRequirements={teamSize:{value:{minimum:2,maximum:3},factIds:[]},mentor:{value:null,factIds:[]},laboratory:{value:null,factIds:[]},equipment:{value:null,factIds:[]},attendance:{value:"travel",factIds:[]},weeklyHours:{value:8,meaning:"official_event_duration",factIds:[]}};
  const context=buildDecisionContext(student(),{records,now:new Date("2026-11-05T08:00:00Z")}),table=rankingDecisionTable(context);
  expect(table.map(row=>row.itemId)).toEqual(context.candidates.map(candidate=>candidate.record.recordId));
  const item=table.find(row=>row.itemId===records[0].recordId)!,original=context.candidates.find(candidate=>candidate.record.recordId===item.itemId)!;
  expect(item.personalCost).toMatchObject({minimumPersonalCny:100,maximumPersonalCny:null,verifiedCurrent:false,note:records[0].cost.note,scope:records[0].scope});
  expect(item.teamResourcesAndTime).toMatchObject({mentor:{value:null},weeklyHours:{value:8,meaning:"official_event_duration"},attendance:{value:"travel"}});
  expect(item.eligibility).toBe(original.eligibility);expect(item.conditions).toEqual(original.conditions);
  expect(item.difficulty).toEqual(original.record.difficulty.map(({stage,summary,assumptions})=>({stage,summary,assumptions})));
 });
 it("preserves all active personal semantics, including exact conditional wording",()=>{
  const context=buildDecisionContext(student(),{records:[syntheticRecord(2000)]});
  context.profile.facts.push({id:"conditional",field:"availableResources",value:"lab",label:"实验室需要另行许可",state:"conditional",confirmed:true,evidenceLevel:"self_report",originalText:"只有导师批准并安排带教时才可以用实验室"});
  const table=rankingStudentTable(context.profile);
  expect(table.facts.find(fact=>fact.field==="availableResources")).toMatchObject({state:"conditional",originalText:"只有导师批准并安排带教时才可以用实验室"});
  expect(table.unknownFields).toEqual(context.profile.unknownFields);
 });
});
