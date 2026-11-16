import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { competitionDecisionContextSchema } from "@/lib/ai/competition-request-schema";
import { confirmCompetitionQuestionnaire, createCompetitionQuestionnaireToken, normalizeCompetitionQuestionnaire, verifyCompetitionQuestionnaireToken } from "@/lib/ai/competition-questionnaire";
import { decisionQuestionTurns, toCompetitionQuestionnaireDraft, type DecisionContext } from "@/components/competitions/recommend/questionFlow";
import { ExperiencePreferences } from "@/components/competitions/recommend/ExperiencePreferences";
import { GoalPreferences } from "@/components/competitions/recommend/GoalPreferences";
import { DecisionPreferences } from "@/components/competitions/recommend/DecisionPreferences";
import { DecisionReport } from "@/components/competitions/recommend/DecisionReport";
import { readSavedDecisions, saveSelectedDecisions, SAVED_DECISIONS_KEY } from "@/lib/competitions/v6/saved-decisions";
import { decisionReportSchema, type DecisionClaimV6, type DecisionReportV6 } from "@/lib/competitions/v6/contracts";

const claim=(text:string):DecisionClaimV6=>({text,basis:"suggestion",studentFactIds:[],competitionFactIds:[],conditions:[]});
function report():DecisionReportV6 {
  const items=Array.from({length:7},(_,i)=>({rank:i+1,itemId:`item-${i}`,seriesId:`series-${i}`,name:`示例竞赛${i+1}`,trackLabel:"数据任务",edition:"往届任务",contentTier:"L2" as const,eligibilityStatus:"unknown" as const,eligibilityNotes:["资格待核实"],registration:{status:"historical" as const,note:"仅用于任务准备"},preparation:"explore" as const,
    coreTask:claim("整理数据并说明依据"),reasons:[claim("你愿意尝试解释数据")],currentRole:claim("先整理一个小样本"),gaps:[claim("投入时间还需确认")],values:[{dimension:"skill",claim:claim("练习解释与核对")}],difficulty:(["entry","completion","award"] as const).map(stage=>({stage,claim:claim("先体验再判断")})),opportunityCost:claim("需要留出持续修改时间"),nextStep:claim("整理一页资料"),checkpoint:"体验后判断是否愿意继续",sources:[],evidenceFacts:[]}));
  return decisionReportSchema.parse({schemaVersion:"saitu.report.v6",reportId:"report-test",generatedAt:"2026-11-05",catalogVersion:"catalog-test",profile:{schemaVersion:"saitu.profile.v6",profileId:"student-test",revision:"rev1",facts:[],unknownFields:["skills"],retractedFactIds:[],goals:[],primaryGoal:null,tradeoffStatus:"undecided",mode:"quick"},summary:{direction:claim("先用小任务发现兴趣"),personalEvidence:[claim("你愿意尝试整理资料")],mainGap:claim("经验与时间尚不明确"),nextStep:claim("先整理一页资料"),focusItemIds:["item-0","item-1","item-2"]},recommendations:items,shortlistShortfallReason:null,comparisons:[],candidateAudit:[],pendingQuestions:[],schoolPolicyReminder:"学校认定需向本校核实",fallback:{used:false,reason:null},trace:{engineVersion:"test",method:"rules",model:"none",promptVersion:"test",candidateCount:7,callCount:0,elapsedMs:0,verification:"deterministic",inputTokens:null,outputTokens:null,costCny:null}});
}

describe("v6 questionnaire and understandable report",()=>{
  beforeAll(()=>vi.stubGlobal("React",React));
  afterAll(()=>vi.unstubAllGlobals());
  it("keeps zero-experience task preferences separate from demonstrated ability",()=>{
    const html=renderToStaticMarkup(<ExperiencePreferences context={{experienceStatus:"none"}} depth="quick" onChange={vi.fn()}/>);
    expect(html).toContain("只说明兴趣，不会当作已有能力");
    expect(html).toContain("把零散资料整理成别人看得懂的一页说明");
    expect(html).not.toContain('type="file"');
  });
  it("explains goal tradeoffs and offers an undecided state",()=>{
    const html=renderToStaticMarkup(<GoalPreferences profile={{goals:["award","portfolio"]}} context={{goalIntent:"portfolio"}} onChange={vi.fn()}/>);
    expect(html).toContain("需要留时间做验证和整理");
    expect(html).toContain("暂不决定，先看不同方向的取舍");
    expect(html).toContain("先发现自己愿意长期做的方向");
  });
  it("adopts self-reported experiences without a second acknowledgement and preserves an undecided goal",()=>{
    const context:DecisionContext={goalIntent:"portfolio",goalResolution:"undecided",experienceStatus:"provided",experiences:[
      {id:"first",task:"独立整理课程问卷",contribution:"independent",completion:"delivered",challenge:"记录缺失项目",confirmed:true},
      {id:"second",task:"尚未确认的原始文字",contribution:"unknown",completion:"unknown",challenge:"",confirmed:false}
    ]};
    const profile={stage:"undergraduate-1" as const,goals:["award" as const,"portfolio" as const]};
    const draft=toCompetitionQuestionnaireDraft(profile,{}, {turns:decisionQuestionTurns("quick",profile),context});
    expect(draft?.decisionContext?.primaryGoal).toBeUndefined();
    expect(draft?.decisionContext?.experiences?.map(item=>item.id)).toEqual(["first","second"]);
    expect(draft?.decisionContext?.experiences?.every(item=>item.confirmed)).toBe(true);
  });
  it("preserves independent contribution per experience through signed confirmation",()=>{
    const context:DecisionContext={mode:"deep",experiences:[{id:"first",task:"整理问卷",contribution:"assisted",completion:"draft",challenge:"",confirmed:true},{id:"second",task:"编写一个小工具",contribution:"independent",completion:"delivered",challenge:"检查边界输入",confirmed:true}],budget:{range:"100-500",scope:"personal"}};
    const profile={stage:"undergraduate-2" as const};
    const draft=toCompetitionQuestionnaireDraft(profile,{}, {turns:decisionQuestionTurns("deep",profile),context});
    const normalized=normalizeCompetitionQuestionnaire(draft);
    expect(normalized.ok).toBe(true);if(!normalized.ok)return;
    const confirmed=confirmCompetitionQuestionnaire(normalized.interpretations,[],context);
    expect(confirmed.ok).toBe(true);if(!confirmed.ok)return;
    const token=createCompetitionQuestionnaireToken({rawAnswerContext:normalized.questionnaire.answers,interpretations:normalized.interpretations,profile:confirmed.profile,confirmed:true,decisionContext:context});
    const checked=verifyCompetitionQuestionnaireToken(token);
    expect(checked.ok).toBe(true);
    expect(confirmed.profile.decisionContext?.experiences?.map(item=>item.contribution)).toEqual(["assisted","independent"]);
    expect(confirmed.profile.confirmedFields).not.toContain("skills");
    expect(confirmed.profile.confirmedFields).not.toContain("weeklyCommitment");
  });
  it("rejects personal information, oversized experience text and duplicate experience IDs",()=>{
    const experience={id:"first",task:"整理资料",contribution:"assisted",completion:"draft",challenge:"",confirmed:true};
    for(const patch of [{task:"电话13800138000"},{challenge:"邮件test@example.com"},{task:"长".repeat(121)},{task:""}])expect(competitionDecisionContextSchema.safeParse({experiences:[{...experience,...patch}]}).success).toBe(false);
    expect(competitionDecisionContextSchema.safeParse({experiences:[experience,experience]}).success).toBe(false);
    expect(competitionDecisionContextSchema.safeParse({}).success).toBe(true);
  });
  it("accepts an optional exact budget within every paid range and rejects mismatched bounds",()=>{
    const accepted = (range:string, maximumYuan?:number) => competitionDecisionContextSchema.safeParse({budget:{range,maximumYuan,scope:"personal"}}).success;
    for (const [range, maximum] of [["under100",1],["under100",100],["100-500",101],["100-500",300],["100-500",500],["over500",501],["over500",1000],["over500",1000000]] as const) expect(accepted(range,maximum)).toBe(true);
    for (const [range, maximum] of [["under100",0],["under100",101],["100-500",100],["100-500",501],["over500",300],["over500",1000001],["zero",1],["unknown",300],["100-500",300.5]] as const) expect(accepted(range,maximum)).toBe(false);
    for (const range of ["zero","unknown","under100","100-500","over500"]) expect(accepted(range)).toBe(true);
    const turn=decisionQuestionTurns("deep",{}).find(item=>item.id==="availableResources")!;
    const html=renderToStaticMarkup(<DecisionPreferences turn={turn} profile={{}} context={{budget:{range:"100-500",maximumYuan:300,scope:"personal"}}} onChange={vi.fn()}/>);
    expect(html).toContain('min="101" max="500"');
    expect(html).toContain('value="300"');
    expect(html).not.toContain('role="alert"');
  });
  it("shows five cards first while retaining comparison, correction and a clear route to all results",()=>{
    const html=renderToStaticMarkup(<DecisionReport report={report()} turns={decisionQuestionTurns("quick",{})} onEdit={vi.fn()}/>);
    expect(html).toContain('id="decision-5"');
    expect(html).not.toContain('id="decision-6"');
    expect(html).toContain("查看其余 2 项");
    expect(html).toContain("不需要同时报名");
    expect(html).not.toContain("优先了解 3");
    const firstSection=html.slice(0,html.indexOf("</section>"));
    expect(firstSection).not.toContain("先用小任务发现兴趣");
    expect(firstSection).toContain("参赛资格和开赛时间请自行核查官网");
    expect(html.match(/<summary[^>]*>[\s\S]*?<\/summary>/g)?.some(summary=>summary.includes("你愿意尝试解释数据"))).toBe(false);
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
    expect(html).toContain("比较两到三项");
    expect(html).toContain("修改后重新匹配");
    expect(html).toContain("你现在可以从哪里开始");
    expect(html).toContain("想走得更远，需要补什么");
  });
  it("keeps goal paths readable behind a closed detail while the initial list has no global reasons",()=>{
    const input=report();
    input.goalPaths=[
      {goal:"积累可展示作品",condition:"如果这次优先完成作品，需要留出验证与整理时间。",itemIds:["item-0"],nextStep:claim("先完成一个能演示的小成果")},
      {goal:"争取竞赛奖项",condition:"如果优先竞争奖项，需要接受评审与结果的不确定性。",itemIds:["item-1"],nextStep:claim("先了解评审要求与自己的差距")}
    ];
    const html=renderToStaticMarkup(<DecisionReport report={input} turns={decisionQuestionTurns("quick",{})} onEdit={vi.fn()}/>);
    expect(html).toContain("查看整体建议与目标取舍");
    expect(html).toContain("目标还没定，可以这样分别考虑");
    expect(html).toContain("当前还没有确认首要目标");
    expect(html.match(/data-goal-path=/g)).toHaveLength(2);
    expect(html).toContain("先完成一个能演示的小成果");
    expect(html).toContain("先了解评审要求与自己的差距");
    expect(html).toContain("回到目标题确认后重新匹配");
    expect(html.indexOf('data-testid="decision-overview"')).toBeGreaterThan(html.indexOf('aria-label="完整竞赛建议"'));
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
  });
  it("only saves actively selected items and leaves the old store intact",()=>{
    const data=new Map<string,string>([["saitu.savedCompetitions.v1","legacy"]]);
    const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
    const result=saveSelectedDecisions(report(),["item-1"],storage);
    expect(result.ok).toBe(true);
    const saved=readSavedDecisions(storage);expect(saved.ok).toBe(true);
    if(saved.ok)expect(saved.value.items.map(item=>item.recommendation.itemId)).toEqual(["item-1"]);
    expect(data.get("saitu.savedCompetitions.v1")).toBe("legacy");
    expect(data.get(SAVED_DECISIONS_KEY)).not.toContain('"facts"');
  });
  it("does not overwrite an unreadable existing v6 collection",()=>{
    const storage={getItem:vi.fn(()=>"broken"),setItem:vi.fn()};
    expect(saveSelectedDecisions(report(),["item-0"],storage).ok).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
