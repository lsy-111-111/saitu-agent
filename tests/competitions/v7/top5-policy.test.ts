import {describe,expect,it} from "vitest";
import {LEGACY_DEFAULT_EFFORT_POLICY,effortPolicySha256} from "@/lib/ai/effort-policy.mjs";
import {assembleDecisionReport,claim} from "@/lib/competitions/v6/engine";
import type {MatchPlanV6} from "@/lib/competitions/v6/contracts";
import {applyReviewedRoleActionsV7,buildDecisionContextV7} from "@/lib/competitions/v7/model";
import {LEGACY_RECOMMENDATION_POLICY_VERSION,RECOMMENDATION_EXECUTION_POLICY,RECOMMENDATION_IMPLEMENTATION_VERSION,RECOMMENDATION_POLICY_VERSION,recommendationRunSchema} from "@/lib/competitions/v7/contracts";
import {FUTURE_TASK_PRACTICE_VERSION_V756,INDEXED_TASK_PRACTICE_VERSION_V757,RANK_BOUND_TASK_PRACTICE_VERSION_V754,RANK_BOUND_TASK_PRACTICE_VERSION_V755,REVIEWED_FINAL_SELECTION_VERSION_V7} from "@/lib/competitions/v7/explanation-groups";
import {composeGroundedBridgeReasonV7,studentLearningOptionsV7} from "@/lib/competitions/v7/match-learning-selection";
import {composeRankBoundTaskPracticeBridgeV7} from "@/lib/competitions/v7/role-task-practice";
import {presentRunV7,readFrozenRunExecutionPolicyV7,type DecisionSessionV7,type LoadedRunV7} from "@/lib/competitions/v7/store";
import {legacyTenRunFixture,topFiveRunFixture} from "../../fixtures/recommendation-run-v7";
import {student,syntheticRecord} from "../v6/decision-fixtures";

describe("Top5 policy and historical response reads",()=>{
  it("accepts historical ten-item payloads and rejects a sixth new-policy item",()=>{
    const old=legacyTenRunFixture(),current=topFiveRunFixture();
    expect(recommendationRunSchema.parse(old).items).toHaveLength(10);
    expect(recommendationRunSchema.parse(current).items).toHaveLength(5);
    expect(recommendationRunSchema.safeParse({...old,policyVersion:RECOMMENDATION_POLICY_VERSION}).success).toBe(false);
  });
  it("separates performance targets from hard cutoffs in the versioned snapshot",()=>{
    expect(RECOMMENDATION_EXECUTION_POLICY).toEqual({policyVersion:RECOMMENDATION_POLICY_VERSION,maxItems:5,listTargetMs:40000,rankHardTimeoutMs:60000,detailTargetMs:120000,detailHardTimeoutMs:150000});
    const run=topFiveRunFixture();
    expect(recommendationRunSchema.safeParse({...run,executionPolicy:{...run.executionPolicy!,maxItems:10}}).success).toBe(false);
    expect(recommendationRunSchema.safeParse({...run,executionPolicy:{...run.executionPolicy!,detailHardTimeoutMs:90000}}).success).toBe(false);
  });
  function savedLegacy(){
    const old=legacyTenRunFixture(),legacy=student(),context=buildDecisionContextV7(legacy,{profileId:old.profileId});
    const submitted=new Date(old.submittedAt),expires=new Date(old.expiresAt),id="a".repeat(64);
    const run:LoadedRunV7={row:{run_id:old.runId,state_key:id,submission_key:"synthetic-legacy",implementation_version:"saitu.async.2026-11-09.v7.2",status:"list_ready",result_version:1,
      submitted_at:submitted,list_deadline_at:new Date(submitted.getTime()+45000),detail_deadline_at:new Date(submitted.getTime()+90000),expires_at:expires,
      lease_owner:null,lease_fence:"0",lease_expires_at:null,ciphertext:Buffer.alloc(0),iv:Buffer.alloc(0),tag:Buffer.alloc(0)},
      body:{implementationSha256:"b".repeat(64),sessionGeneration:0,effortPolicy:LEGACY_DEFAULT_EFFORT_POLICY,effortPolicySha256:effortPolicySha256(LEGACY_DEFAULT_EFFORT_POLICY),
        context:{...context,now:context.now.toISOString(),excluded:[...context.excluded]},legacy,items:old.items,listReadyAt:old.listReadyAt,detailsReadyAt:null,shortfallReason:null}};
    const session:DecisionSessionV7={id,sessionId:"synthetic-legacy-session",generation:0,expiresAt:expires.getTime(),currentRunId:old.runId,profile:context.profile,legacy,history:[]};
    return {run,session};
  }
  it("presents an unmodified historical body with its original policy and persisted deadlines",()=>{
    const {run,session}=savedLegacy(),before=JSON.stringify(run);
    const response=presentRunV7(run,session);
    expect(response.policyVersion).toBe(LEGACY_RECOMMENDATION_POLICY_VERSION);
    expect(response.implementationVersion).toBe("saitu.async.2026-11-09.v7.2");
    expect(response.items).toHaveLength(10);expect(response.executionPolicy?.maxItems).toBe(10);
    expect(response.rankDeadlineAt).toBe(run.row.list_deadline_at.toISOString());
    expect(response.detailDeadlineAt).toBe(run.row.detail_deadline_at.toISOString());
    expect(response.effortPolicy).toEqual(LEGACY_DEFAULT_EFFORT_POLICY);expect(JSON.stringify(run)).toBe(before);
  });
  it("rejects a new implementation without its frozen policy or with mismatched persisted cutoffs",()=>{
    const {run}=savedLegacy();run.row.implementation_version=RECOMMENDATION_IMPLEMENTATION_VERSION;
    expect(()=>readFrozenRunExecutionPolicyV7(run)).toThrow("DECISION_EXECUTION_POLICY_MISSING");
    run.body.executionPolicy={...RECOMMENDATION_EXECUTION_POLICY};
    expect(()=>readFrozenRunExecutionPolicyV7(run)).toThrow("DECISION_EXECUTION_POLICY_CHANGED");
  });
  it.each([REVIEWED_FINAL_SELECTION_VERSION_V7,"saitu-explain.v7.50.server-bound-reason","saitu-explain.v7.52.server-bound-task-step"])("presents only the ordered accepted subset for %s",version=>{
    const {run,session}=savedLegacy(),context=buildDecisionContextV7(student(),{records:[syntheticRecord(1),syntheticRecord(2)]});
    const plan:MatchPlanV6={profileRevision:context.profile.revision,catalogVersion:context.catalogVersion,shortfallReason:"本次先选两项。",
      recommendations:context.candidates.map(({record})=>({itemId:record.recordId,rankRoleIndex:0,reasons:[claim(record.facts[0].text,"official",[],[record.facts[0].id])]}))};
    const accepted=plan.recommendations[1];
    const finalPlan:MatchPlanV6={...plan,recommendations:[{...accepted,roleIndex:0,roleReason:structuredClone(accepted.reasons[0])}],shortfallReason:"本次仅一项通过。"};
    const report=applyReviewedRoleActionsV7(assembleDecisionReport(context,finalPlan,{promptVersion:`${version}.detail-v2`},undefined,
      {admissionPolicy:"matching",profilePolicy:"self_report"}),finalPlan,context);
    const [detail]=report.recommendations;
    run.row.status="ready";
    run.body={...run.body,context:{...context,now:context.now.toISOString(),excluded:[...context.excluded]},plan,finalPlan,report,
      shortfallReason:finalPlan.shortfallReason,items:[{rank:detail.rank,itemId:detail.itemId,seriesId:detail.seriesId,name:detail.name,
        trackLabel:detail.trackLabel,edition:detail.edition,officialUrl:null,detailStatus:"ready",detail}]};
    const current={...session,profile:context.profile};
    const presented=presentRunV7(run,current);
    expect(presented.items.map(item=>item.itemId)).toEqual([detail.itemId]);
    expect(presented.report?.recommendations.map(item=>item.itemId)).toEqual([detail.itemId]);
    expect(presented).not.toHaveProperty("plan");
    expect(run.body.plan?.recommendations).toHaveLength(2);
    delete run.body.finalPlan;
    expect(()=>presentRunV7(run,current)).toThrow("INVALID_FINAL_SELECTION_BINDING");
    const withoutRank=(value:MatchPlanV6):MatchPlanV6=>({...value,recommendations:value.recommendations.map(({rankRoleIndex:_rankRole,...row})=>row)});
    run.body.plan=withoutRank(plan);
    run.body.finalPlan=withoutRank(finalPlan);
    expect(()=>presentRunV7(run,current)).toThrow("INVALID_FINAL_SELECTION_BINDING");
    run.body.plan=plan;
    run.body.finalPlan=finalPlan;
    run.row.status="superseded";
    expect(presentRunV7(run,{...current,currentRunId:"new-run"}).status).toBe("superseded");
    run.body.finalPlan={...finalPlan,recommendations:plan.recommendations.slice(0,1)};
    expect(()=>presentRunV7(run,current)).toThrow("INVALID_FINAL_SELECTION_BINDING");
    run.body.finalPlan=finalPlan;
    const tampered=structuredClone(detail);
    tampered.evidenceFacts[0].text="篡改了原来源的任务文字。";
    run.body.report={...report,recommendations:[tampered]};
    run.body.items=[{...run.body.items[0],detail:tampered}];
    expect(()=>presentRunV7(run,current)).toThrow("INVALID_FINAL_SELECTION_BINDING");
  });

  function savedRankBound(version:string,anchorSource:"scoring"|"task"|"another-record",
    practiceText="可标记同一记录的清理前后变化") {
    const {run,session}=savedLegacy();
    const legacy=student({skills:["data-analysis"],confirmedFields:["stage","skills"]});
    const own=syntheticRecord(1),other=syntheticRecord(2);
    const scoring={...own.facts[0],id:`${own.seriesId}.rubric`,field:"rubric",text:"书面报告占20分，现场陈述占30分。"};
    own.facts.push(scoring);
    const context=buildDecisionContextV7(legacy,{records:[own,other]});
    const studentFact=context.profile.facts.find(fact=>fact.field==="skills")!;
    const anchor=anchorSource==="scoring"?scoring:anchorSource==="task"?own.facts[0]:other.facts[0];
    const selected={itemId:own.recordId,rankRoleIndex:0,rankTaskStepIndex:0,
      reasons:[claim("初选数据分析环节。","inference",[studentFact.id],[anchor.id])]};
    const plan:MatchPlanV6={profileRevision:context.profile.revision,catalogVersion:context.catalogVersion,shortfallReason:"仅有两项初选。",
      recommendations:[{...selected,itemId:other.recordId,reasons:[claim("初选另一项。","inference",[studentFact.id],[other.facts[0].id])]},selected]};
    const role=own.roles[0];
    const practice=composeRankBoundTaskPracticeBridgeV7(role.task,{practice:practiceText,check:"比较处理决定与变化是否逐条对应。"});
    const reason=composeGroundedBridgeReasonV7(anchor,role,{competitionFactIds:[anchor.id],studentFactIds:[studentFact.id],bridge:practice},studentLearningOptionsV7(context.profile))!;
    const finalPlan:MatchPlanV6={...plan,recommendations:[{...selected,roleIndex:0,reasons:[reason],roleReason:structuredClone(reason)}],shortfallReason:"仅有一项通过。"};
    const report=applyReviewedRoleActionsV7(assembleDecisionReport(context,finalPlan,{promptVersion:`${version}.detail-v2`},undefined,
      {admissionPolicy:"matching",profilePolicy:"self_report"}),finalPlan,context);
    const [detail]=report.recommendations;
    run.row.status="ready";
    run.body={...run.body,legacy,context:{...context,now:context.now.toISOString(),excluded:[...context.excluded]},plan,finalPlan,report,
      shortfallReason:finalPlan.shortfallReason,items:[{rank:detail.rank,itemId:detail.itemId,seriesId:detail.seriesId,name:detail.name,
        trackLabel:detail.trackLabel,edition:detail.edition,officialUrl:null,detailStatus:"ready",detail}]};
    return {run,session:{...session,legacy,profile:context.profile},detail};
  }

  it("reads a v754 scoring anchor while requiring v757 task evidence and the same candidate owner",()=>{
    const historical=savedRankBound(RANK_BOUND_TASK_PRACTICE_VERSION_V754,"scoring");
    const before=JSON.stringify(historical.run);
    expect(presentRunV7(historical.run,historical.session).items).toHaveLength(1);
    expect(JSON.stringify(historical.run)).toBe(before);
    const current=savedRankBound(INDEXED_TASK_PRACTICE_VERSION_V757,"task");
    expect(presentRunV7(current.run,current.session).report?.recommendations).toEqual([current.detail]);
    const invalid=savedRankBound(INDEXED_TASK_PRACTICE_VERSION_V757,"scoring");
    expect(()=>presentRunV7(invalid.run,invalid.session)).toThrow("INVALID_FINAL_SELECTION_BINDING");
    const foreign=savedRankBound(RANK_BOUND_TASK_PRACTICE_VERSION_V754,"another-record");
    expect(()=>presentRunV7(foreign.run,foreign.session)).toThrow("INVALID_FINAL_SELECTION_BINDING");
  });

  it("retains the v755 read contract while rejecting the same unsafe practice from a v757 saved result",()=>{
    const prose="在@C19成本分析参数表中区分固定投入与单位变动成本";
    const historical=savedRankBound(RANK_BOUND_TASK_PRACTICE_VERSION_V755,"task",prose);
    expect(presentRunV7(historical.run,historical.session).items).toHaveLength(1);
    const current=savedRankBound(INDEXED_TASK_PRACTICE_VERSION_V757,"task",prose);
    expect(()=>presentRunV7(current.run,current.session)).toThrow("INVALID_FINAL_SELECTION_BINDING");
    const invalidHistorical=savedRankBound(RANK_BOUND_TASK_PRACTICE_VERSION_V755,"scoring");
    expect(()=>presentRunV7(invalidHistorical.run,invalidHistorical.session)).toThrow("INVALID_FINAL_SELECTION_BINDING");
  });

  it.each([
    [FUTURE_TASK_PRACTICE_VERSION_V756,false],[FUTURE_TASK_PRACTICE_VERSION_V756,true],
    [INDEXED_TASK_PRACTICE_VERSION_V757,false],[INDEXED_TASK_PRACTICE_VERSION_V757,true],
  ])("rechecks the %s explicit-fact bridge when a saved no-rank result is read (unsafe: %s)",(version,unsafe)=>{
    const fixture=savedRankBound(version,"task",
      unsafe?"在＠Ｃ１９所指参数表中重新分类":"可标记同一记录的清理前后变化");
    const {run,session}=fixture,{plan,finalPlan,context}=run.body;
    for(const item of plan!.recommendations){
      const fact=context.candidates.find(row=>row.record.recordId===item.itemId)!.record.facts[0];
      delete item.rankRoleIndex;
      delete item.rankTaskStepIndex;
      item.reasons=[claim(fact.text,"official",[],[fact.id])];
    }
    delete finalPlan!.recommendations[0].rankRoleIndex;
    delete finalPlan!.recommendations[0].rankTaskStepIndex;
    if(unsafe)expect(()=>presentRunV7(run,session)).toThrow("INVALID_FINAL_SELECTION_BINDING");
    else expect(presentRunV7(run,session).items).toHaveLength(1);
  });
});
