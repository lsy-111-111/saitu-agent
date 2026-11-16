import type { DecisionCompetitionRecord } from "./catalog-types";
import type { StudentProfileV6 } from "./contracts";
import { activeStudentFacts } from "./profile";
import { experienceEvidence } from "./experience-fit";
import { isDecisionEvidenceFact } from "./evidence";

export const nativeTaskFamilies: Record<string, string[]> = {
  algorithm:["software-algorithms"],software:["software-algorithms"],modeling:["data-modeling"],hardware:["engineering-prototype"],research:["experimental-research","investigation","data-modeling"],product:["business-practice","investigation","software-algorithms","visual-interaction"],entrepreneurship:["business-practice"],design:["visual-interaction"],language:["language-communication","teaching-service"],career:["teaching-service"],
  "organize-information":["investigation","data-modeling"],"explain-ideas":["language-communication","teaching-service"],"observe-record":["experimental-research","investigation"],"make-content":["visual-interaction","language-communication"],"build-tool":["software-algorithms","engineering-prototype"],
};
const goalOutputs: Record<string,string[]> = {
  project:["prototype","software","research-paper","business-plan","creative-work","portfolio"],portfolio:["portfolio","creative-work","prototype","software"],postgraduate:["research-paper","research","academic-paper"],employment:["portfolio","prototype","software","business-plan"],entrepreneurship:["business-plan","prototype"],
};
export type NativeFitScore = { lower:number; upper:number; dimensions:{name:string;weight:number;lower:number;upper:number;studentFactIds:string[];basis:string}[] };
/** A1 uses the same catalog metadata and confirmed evidence for every series. No ID, migration origin,
 * legacy score or tier is an input. Unknown evidence is an interval, never invented readiness. */
export function scoreNativeDecision(record:DecisionCompetitionRecord, profile:StudentProfileV6):NativeFitScore {
  const facts=activeStudentFacts(profile).filter(f=>f.state==="affirmed");
  const selected=(fields:string[])=>facts.filter(f=>fields.includes(f.field));
  const dimensions:NativeFitScore["dimensions"]=[];
  const add=(name:string,weight:number,score:number|null,evidence:typeof facts,basis:string)=>dimensions.push({name,weight,lower:score===null?0:weight*score,upper:score===null?weight:weight*score,studentFactIds:evidence.map(f=>f.id),basis});
  const resolvedGoal=selected(["primaryGoal","goalIntent"]);
  const goals=profile.tradeoffStatus==="undecided"?[]:resolvedGoal.length?resolvedGoal:selected(["goals"]);
  const outputs=selected(["preferredOutputs"]);
  const relevantOutputs=goals.flatMap(f=>goalOutputs[String(f.value)]??[]);
  const goalValue=goals.some(f=>["skill","explore"].includes(String(f.value)))?0.7:relevantOutputs.length?Number(relevantOutputs.some(v=>record.preferredOutputs.includes(v))):null;
  add("goal",30,goalValue,goals,"已确认目标对照目录成果标签；未确认目标保留未知，奖项与升学收益不作保证");
  const tasks=selected(["taskFormats","noviceTask"]);
  const interests=selected(["interests"]);
  const taskEvidence=tasks.length?tasks:interests;
  const taskValue=tasks.length?Number(tasks.some(f=>nativeTaskFamilies[String(f.value)]?.includes(record.taskFamily))):interests.length?Number(interests.some(f=>record.interests.includes(String(f.value)))):null;
  add("task",25,taskValue,taskEvidence,"愿意实际承担的任务；只有未选具体任务时才用兴趣作探索线索，不推断能力");
  const skills=selected(["skills"]);
  const experience=experienceEvidence(record,profile);
  const experienceFacts=facts.filter(f=>experience.some(e=>e.factIds.includes(f.id)));
  const explicitNoExperience=facts.some(f=>f.field==="experienceStatus"&&f.value==="none");
  add("experience",20,experience.length?Math.min(1,experience.reduce((sum,e)=>sum+e.weight,0)):explicitNoExperience?0:null,experienceFacts,"同类任务、本人贡献与完成程度");
  const preparation=selected(["weeklyCommitment","preparationHorizon","availableResources"]);
  const required=record.roles.filter(r=>r.prerequisite==="required").flatMap(r=>r.skills);
  const prerequisiteFit=required.length&&skills.length?required.filter(v=>skills.some(f=>f.value===v)).length/required.length:record.roles.some(r=>r.prerequisite==="learnable")?0.7:null;
  const time=facts.find(f=>f.field==="weeklyCommitment");
  const timeFit=time?({"under-5":0.25,"5-10":0.65,"over-10":1}[String(time.value)]??null):null;
  const horizon=facts.find(f=>f.field==="preparationHorizon");
  const horizonFit=horizon?({"1-2-weeks":0.25,"one-month":0.5,"2-3-months":0.8,"long-term":1}[String(horizon.value)]??null):null;
  const budget=selected(["budget.maximumYuan"]), maximum=budget.at(-1)?.value;
  const cost=record.cost;
  const verified=cost?.factIds.length&&cost.factIds.every(id=>record.facts.some(f=>f.id===id&&f.status==="verified_current"&&f.kind==="official_fact"&&f.scope===cost.scope&&isDecisionEvidenceFact(record,f)));
  const budgetFit=typeof maximum==="number"&&verified&&cost?.maximumPersonalCny!=null?Number(cost.maximumPersonalCny<=maximum):null;
  // All four preparation components retain their share of uncertainty. In
  // particular, an unknown personal total is never scored as affordable.
  const preparationParts=[timeFit,horizonFit,preparation.length&&skills.length?prerequisiteFit:null,budgetFit];
  const preparationLower=preparationParts.reduce<number>((sum,value)=>sum+(value??0),0)/4;
  const preparationUpper=preparationParts.reduce<number>((sum,value)=>sum+(value??1),0)/4;
  dimensions.push({name:"preparation",weight:15,lower:15*preparationLower,upper:15*preparationUpper,studentFactIds:[...preparation,...skills,...budget].map(f=>f.id),basis:"时间、周期、入门前置条件及完整个人费用分别核对；未知份额保留区间"});
  const growthValue=outputs.length?Number(outputs.some(f=>record.preferredOutputs.includes(String(f.value)))):null;
  add("growth",10,growthValue,outputs,"希望形成的可展示成果与任务产出对照；不承诺获奖或就业收益");
  return {lower:dimensions.reduce((sum,d)=>sum+d.lower,0),upper:dimensions.reduce((sum,d)=>sum+d.upper,0),dimensions};
}
