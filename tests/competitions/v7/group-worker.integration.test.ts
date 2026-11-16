import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from "vitest";
import {createHash,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import type pg from "pg";
vi.unmock("@/lib/ai/spend-ledger");
import {getPool} from "@/lib/db/pool";
import {readDurableDecisionJournalV7} from "@/lib/ai/durable-call";
import {effortPolicySha256,RANK_NON_THINKING_EFFORT_POLICY} from "@/lib/ai/effort-policy.mjs";
import {currentDecisionEffortPolicy} from "@/lib/ai/effort-context";
import {buildDecisionContextV7,DECISION_EXPLAIN_PROMPT_VERSION_V7,rankDecisionV7} from "@/lib/competitions/v7/model";
import {studentLearningOptionsV7} from "@/lib/competitions/v7/match-learning-selection";
import {rankTaskFactsV7} from "@/lib/competitions/v7/rank-packet";
import {composeTaskConnectionV767,rankTaskFocusOptionsV7} from "@/lib/competitions/v7/role-task-practice";
import {generateGroupExplanationV7,reviewPreparedGroupV7} from "@/lib/competitions/v7/explanation-groups";
import {decodedGroupWire,matchingRelationReviewBallotFixture,serverBoundGroupReasonFixture,studentFactBasis} from "./group-reason-fixture";
import {processClaimedRunV7} from "@/lib/competitions/v7/worker";
import {claimRunV7,commitRunV7,enqueueRunV7,presentRunV7,readRunV7,submissionKeyV7} from "@/lib/competitions/v7/store";
import {applyExplicitCorrectionV7} from "@/lib/competitions/v7/corrections";
import {createDecisionTokenV7,sealV7,verifyDecisionTokenV7} from "@/lib/competitions/v7/crypto";
import {createModelIdentifierCodec} from "@/lib/competitions/v6/model-identifiers";
import {expandMatchingTables} from "@/lib/competitions/v6/model-match-tables";
import {expandCandidateEvidence} from "@/lib/competitions/v6/model-evidence-pack";
import type {MatchPlanV6} from "@/lib/competitions/v6/contracts";
import {student} from "../v6/decision-fixtures";
import {createV7TestDatabase} from "../../helpers/v7-database-environment";

const integration=process.env.RUN_V7_DATABASE_TESTS==="1"?describe:describe.skip;
integration("grouped worker recovery with real disposable PostgreSQL and synthetic provider transport",()=>{
  const original={...process.env},budget=`v7-groups-test-${randomUUID()}`,batch="saitu-v7-top5-20261109-formal-91";
  const policy={version:"saitu.effort-policy.v1" as const,rank:"low" as const,explain:"low" as const,review:"low" as const};
  const globals=globalThis as typeof globalThis&{__pgPool?:pg.Pool};
  let fixture:Awaited<ReturnType<typeof createV7TestDatabase>>;
  beforeAll(async()=>{
    fixture=await createV7TestDatabase("durable");
    expect((await fixture.admin.query("select current_database() as name")).rows[0].name).toBe(fixture.database);
    expect(fixture.database).toMatch(/^saitu_v7_durable_[a-f0-9]{32}$/);
    // All authorization and ledger rows belong to this disposable database.
    // The real ledger path validates Top5's low/low/low grant; fetch is synthetic.
    await fixture.admin.query(readFileSync("db/migrations/20261109_spend_v7_top5_policy.sql","utf8"));
    const sha=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
    const policyHash=effortPolicySha256(policy),policySha=sha(readFileSync("docs/v7/top5-continuation-contract-20261109.md"));
    const condition={schemaVersion:"saitu.user-approved-budget-condition.v7.top5.v1",model:"deepseek-flash",effort:"stage",phase:"formal",mainRunId:budget,
      policySha256:policySha,effortPolicy:policy,effortPolicySha256:policyHash,sourcePolicy:"docs/v7/top5-continuation-contract-20261109.md",
      policyVersion:"saitu.policy.2026-11-09.v7.top5",implementationVersion:"saitu.async.2026-11-09.v7.3.top5",
      authorization:"user-approved-20261109-top5-continuation",priorLedgerSha256:sha("[]"),freshPgRowsVerified:true};
    const conditionSha=sha(JSON.stringify(condition));
    await fixture.admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,10000000),($2,10000000)",[budget,batch]);
    await fixture.admin.query("insert into ai_spend_authority(singleton,run_id) values(true,$1)",[budget]);
    await fixture.admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,
      baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256,effort_policy,effort_policy_sha256)
      values($1,$2,64,10000000,0,10000000,'{}','Synthetic Top5 group regression in disposable PostgreSQL','stage',$3,$4::jsonb,'saitu.v7.top5.v1','formal',$5,$6::jsonb,$7)`,
      [batch,budget,conditionSha,JSON.stringify(condition),policySha,JSON.stringify(policy),policyHash]);
    await globals.__pgPool?.end();delete globals.__pgPool;
    const sessionSeed=randomUUID()+randomUUID();
    Object.assign(process.env,{DATABASE_URL:fixture.runtimeUrl,AI_PROVIDER:"deepseek",AI_API_KEY:"synthetic-transport-no-live-network",
      AI_CONVERSATION_SIGNING_SECRET:sessionSeed,AI_SPEND_RUN_ID:batch,AI_SPEND_LIMIT_CNY:"10",
      AI_SPEND_FUNDED_CNY:"10",AI_SPEND_PHASE:"formal",AI_CONCURRENCY_MAX:"2",FEATURE_AI:"1",FEATURE_COMPETITION_RECOMMENDER:"1",
      SAITU_V7_EFFORT_POLICY:JSON.stringify(policy),SAITU_V7_EFFORT_POLICY_SHA256:policyHash,
      SAITU_AI_EXECUTION_MODE:"finite",SAITU_V7_DETAIL_LAYOUT:"single",
      AI_SPEND_AUTHORIZED_EFFORT:"stage",AI_SPEND_POLICY_SHA256:policySha,AI_SPEND_EFFORT_CONDITION_SHA256:conditionSha});
  });
  afterEach(async()=>{
    vi.restoreAllMocks();vi.unstubAllGlobals();
    await fixture.admin.query("update competition_decision_runs set status='superseded',lease_owner=null,lease_expires_at=null where status not in ('ready','failed','expired','superseded')");
  });
  afterAll(async()=>{await globals.__pgPool?.end();delete globals.__pgPool;await fixture?.close();process.env={...original};});
  async function start(n=5,transportRank=false){
    const sessionId=randomUUID(),legacy=student({weeklyCommitment:"5-10",interests:["data"],goals:transportRank?["portfolio"]:[],
      confirmedFields:transportRank?["stage","weeklyCommitment","interests","goals"]:["stage","weeklyCommitment","interests"]});
    const context=buildDecisionContextV7(legacy,{profileId:sessionId});
    expect(context.records).toHaveLength(45);
    expect(context.candidates.length).toBeGreaterThanOrEqual(10);
    const interestId=context.profile.facts.find(fact=>fact.field==="interests")!.id;
    const byId=context.candidates.toSorted((left,right)=>left.record.recordId<right.record.recordId?-1:left.record.recordId>right.record.recordId?1:0);
    const directStart=Math.max(0,n-2);
    const rankedFixture=transportRank?[...byId.slice(directStart,n),...byId.slice(0,directStart)]:context.candidates.slice(0,n);
    const plan:MatchPlanV6={profileRevision:context.profile.revision,catalogVersion:context.catalogVersion,
      // This helper supplies a fresh ranking decision, unlike archived static
      // plans. It explicitly selects the same existing zero-based role as the
      // explanation transport below; production has no default-role fallback.
      recommendations:rankedFixture.map(row=>({itemId:row.record.recordId,rankRoleIndex:0,
        rankTaskStepIndex:rankTaskFocusOptionsV7(row.record.roles[0].task).at(-1)!.index,
        reasons:[{text:"合成排序流程测试",basis:"inference",studentFactIds:[interestId],competitionFactIds:[rankTaskFactsV7(row.record)[0].id],conditions:[]}]})),
      shortfallReason:n<5?"本次只保留与已提交任务和限制有意义的候选，不为补足五项添加无关系列；合成流程测试不代表模型排序质量。":null};
    const input={sessionId,expiresAt:Date.now()+180000,legacy,context,submissionKey:submissionKeyV7(sessionId,"initial")};
    const created=await enqueueRunV7(input),first=(await claimRunV7("group-test-ranking"))!;
    expect(first.row.run_id).toBe(created.run.row.run_id);
    const codec=createModelIdentifierCodec({candidates:context.candidates.map(row=>row.record.recordId),series:context.candidates.map(row=>row.record.seriesId),
      facts:context.candidates.flatMap(row=>row.record.facts.map(fact=>fact.id)),students:context.profile.facts.map(row=>row.id)});
    const value={...created,input,context,plan,codec};
    const rankCalls=transportRank?stubTransport(value):[];
    await processClaimedRunV7(first,{rank:transportRank?rankDecisionV7:async()=>plan,generate:generateGroupExplanationV7,review:reviewPreparedGroupV7});
    const ranked=(await readRunV7(first.row.run_id))!;
    expect(ranked.row.status,ranked.body.error).toBe("list_ready");
    expect(ranked.body.plan?.recommendations.map(item=>item.itemId)).toEqual(plan.recommendations.map(item=>item.itemId));
    expect(ranked.body.plan?.recommendations.map(item=>item.rankTaskStepIndex)).toEqual(plan.recommendations.map(item=>item.rankTaskStepIndex));
    return {...value,plan:ranked.body.plan!,rankCalls};
  }
  type Created=Awaited<ReturnType<typeof start>>;
  type TransportInput={context:ReturnType<typeof buildDecisionContextV7>;plan:MatchPlanV6;codec:ReturnType<typeof createModelIdentifierCodec>;run:Awaited<ReturnType<typeof enqueueRunV7>>["run"]};
  const fields=serverBoundGroupReasonFixture("可用数据建模理解原任务中的观察条件如何对应各次结果。");
  const matchingRelation=composeTaskConnectionV767(studentFactBasis(),fields.taskConnection);
  type TaskFocus={index:number;text:string};
  function taskFocusForItem(context:TransportInput["context"],item:MatchPlanV6["recommendations"][number]):TaskFocus {
    const record=context.candidates.find(row=>row.record.recordId===item.itemId)!.record;
    const role=record.roles[item.rankRoleIndex!];
    return rankTaskFocusOptionsV7(role.task).find(option=>option.index===item.rankTaskStepIndex)!;
  }
  function stubTransport(created:TransportInput,hook?:(stage:"rank"|"explain"|"review",groupId:string,payload:Record<string,unknown>)=>Promise<void>,unsupported:readonly number[]|"all"|"missing"=[]){
    const calls:{stage:string;groupId:string}[]=[];
    vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init:RequestInit)=>{
      const body=JSON.parse(String(init.body));
      expect(body.model).toBe("deepseek-flash");expect(body.reasoning_effort).toBe("low");expect(body.thinking).toEqual({type:"enabled"});
      const prompt=body.messages.find((message:{role:string})=>message.role==="user").content;
      const wire=decodedGroupWire(prompt);
      const stage=wire.assertions?"review":wire.groupId?"explain":"rank";
      const payload=created.codec.decode(expandCandidateEvidence(expandMatchingTables(wire))) as Record<string,unknown>;
      if(stage==="rank")expect(payload.profile).toEqual({...created.context.profile,revision:wire.outputFormat.profileRevision});
      else if(stage==="review")expect(payload.profile).toEqual(created.context.profile);
      else{
        expect(payload).not.toHaveProperty("profile");
        expect(payload).toMatchObject({profileRevision:created.context.profile.revision,currentLimits:expect.any(Array)});
      }
      const id=stage==="rank"?"rank":stage==="review"?(payload.fixedOrder as {groupReview:{groupId:string}}).groupReview.groupId:String(payload.groupId);
      calls.push({stage,groupId:id});await hook?.(stage,id,payload);
      let output:unknown;
      if(stage==="rank"){
        const {profileRevision,catalogVersion}=wire.outputFormat as Pick<MatchPlanV6,"profileRevision"|"catalogVersion">;
        const students=payload.studentBasisOptions as {index:number;text:string}[];
        const interest=created.context.profile.facts.find(fact=>fact.field==="interests")!;
        const expected=studentLearningOptionsV7(created.context.profile).facts.find(option=>option.id===interest.id);
        expect(expected).toBeDefined();
        const studentIndex=students.find(option=>option.text===expected?.text)?.index;
        expect(Number.isInteger(studentIndex)).toBe(true);
        const goal=(payload.studentGoalOptions as {index:number;text:string}[]).find(option=>option.text===created.context.profile.primaryGoal);
        expect(goal).toBeDefined();
        const candidates=payload.candidates as {itemId:string;officialTask:{factIds:(string|null)[]}[];
          contributions:{roleIndex:number;task:string;taskSteps?:TaskFocus[]}[]}[];
        expect(candidates).toHaveLength(45);
        expect(candidates.map(row=>row.itemId).toSorted()).toEqual(created.context.candidates.map(row=>row.record.recordId).toSorted());
        const lastId=candidates.map(row=>row.itemId).toSorted().at(-1);
        // The mock includes a sixth valid transfer and replies in reverse order.
        // The actual worker must keep the two direct items and first three transfers.
        output=created.codec.encode({profileRevision,catalogVersion,
          assessments:candidates.toReversed().map(candidate=>{
            const itemIndex=created.plan.recommendations.findIndex(item=>item.itemId===candidate.itemId);
            if(itemIndex<0&&candidate.itemId!==lastId)return {itemId:candidate.itemId,fit:null};
            const factId=candidate.officialTask.flatMap(row=>row.factIds).find(value=>value!==null);
            expect(factId).toBeTruthy();
            const role=candidate.contributions.find(row=>row.roleIndex===0)!;
            const steps=[{index:0,text:role.task},...(role.taskSteps??[])];
            const selected=itemIndex>=0?taskFocusForItem(created.context,created.plan.recommendations[itemIndex]):steps[0];
            expect(steps).toContainEqual(selected);
            const fit={matchKind:itemIndex>=0&&itemIndex<2?"direct":"transfer",roleIndex:0,taskStepIndex:selected.index,
              rationale:"把数据兴趣用于给定角色的记录核对。",
              studentBasisIndices:[studentIndex],goalIndex:goal!.index,competitionFactIds:[factId]};
            return {itemId:candidate.itemId,fit};
          }),shortfallReason:null});
      }else if(stage==="review"){
        const persisted=(await readRunV7(created.run.row.run_id))!.body.detailGroups!.groups.find(group=>group.spec.groupId===id)!;
        expect(payload.reviewContract).toBe("saitu.matching-relation-review.v3");
        expect(payload.fixedOrder).toMatchObject({groupReview:{purpose:"saitu.matching-relation-review.v3"}});
        expect(persisted.reviewPreparation?.call.reviewContract).toBe(payload.reviewContract);
        const raw=JSON.parse(prompt);
        expect(persisted.prepared).toBeDefined();expect(persisted.reviewPreparation?.call.callKey).toBe(`v7.review:detail-v2.${id}.initial:1`);
        expect(persisted.prepared!.assertions).toHaveLength(persisted.prepared!.explanation.recommendations.length*2);
        expect(wire.assertions).toHaveLength(persisted.prepared!.explanation.recommendations.length);
        const focusedAssertions=payload.assertions as {itemId:string;reason:unknown;selectedTaskFocus:string;explicitStudentGoal?:string}[];
        for(const [index,item] of persisted.prepared!.explanation.recommendations.entries()){
          const selected=created.plan.recommendations.find(row=>row.itemId===item.itemId)!;
          const taskFocus=taskFocusForItem(created.context,selected);
          expect(item.roleReason).toEqual(item.reasons[0]);
          expect(item.reasons[0].text).toContain(`\n匹配关系：${matchingRelation}`);
          expect(persisted.prepared!.explanation.taskSelections![index].taskConnection).toBe(fields.taskConnection);
          expect(item.reasons[0].competitionFactIds).toEqual(selected.reasons[0].competitionFactIds);
          expect(focusedAssertions[index].itemId).toBe(item.itemId);
          expect(focusedAssertions[index].reason).toEqual({...item.reasons[0],text:fields.taskConnection});
          expect(focusedAssertions[index].selectedTaskFocus).toBe(taskFocus.text);
          expect(focusedAssertions[index]).toMatchObject({
            learnerBasisSelection:{...studentFactBasis(),studentFactId:wire.assertions[index].reason.studentFactIds[0]},
            selectedTaskStepIndex:taskFocus.index});
          expect(raw.assertions[index].taskScope).toEqual({stepIndex:taskFocus.index,text:taskFocus.text});
          expect(raw.assertions[index]).not.toHaveProperty("relationMode");
          expect(raw.assertions[index]).not.toHaveProperty("actionPrerequisite");
          expect(raw.assertions[index]).not.toHaveProperty("provisionalRankRelation");
          expect(raw.assertions[index]).not.toHaveProperty("provisionalRankSelection");
          expect(raw.assertions[index]).not.toHaveProperty("reviewPurpose");
          expect(focusedAssertions[index].explicitStudentGoal).toBeUndefined();
        }
        expect(persisted.reviewPreparation!.call.reviewKeys).toHaveLength(persisted.prepared!.assertions.length);
        expect(persisted.reviewPreparation!.call.jointReviewBindings).toHaveLength(wire.assertions.length);
        for(const item of persisted.prepared!.explanation.recommendations){
          const keys=persisted.reviewPreparation!.call.reviewKeys;
          expect(keys.find(row=>row.key===`${item.itemId}.reason.0`)!.alias).toBe(keys.find(row=>row.key===`${item.itemId}.role`)!.alias);
        }
        const verdictRows=unsupported==="missing"?wire.assertions.slice(0,-1):wire.assertions;
        output={checks:verdictRows.map((row:{key:string},index:number)=>matchingRelationReviewBallotFixture(row.key,
          "Synthetic transport only, not semantic evidence.",{fit:unsupported!=="all"&&(unsupported==="missing"||!unsupported.includes(index))}))};
      }else{
        const spec=(await readRunV7(created.run.row.run_id))!.body.detailGroups!.groups.find(group=>group.spec.groupId===id)!.spec;
        const candidates=payload.candidates as {rowIndex:number;roles:{roleIndex:number;taskOptions:TaskFocus[]}[];
          rankedSelection:{factIndex:number;taskStepIndex:number};evidenceOptions:{factIndex:number;text:string}[];
          learnerBasisOptions:{index:number;kind:string;factKind?:string;text:string}[]}[];
        expect(payload).not.toHaveProperty("studentBasisOptions");
        expect(payload).not.toHaveProperty("studentGoalOptions");
        expect(payload).not.toHaveProperty("practicePreferences");
        expect(payload).not.toHaveProperty("learningMode");
        output=created.codec.encode({schemaVersion:"saitu.group-explanation.v1",groupBindingSha256:payload.groupBindingSha256,groupId:id,
          profileRevision:created.plan.profileRevision,catalogVersion:created.plan.catalogVersion,shortfallReason:created.plan.shortfallReason,
          recommendations:spec.itemIds.map((itemId,rowIndex)=>{
            const record=created.context.candidates.find(row=>row.record.recordId===itemId)!.record;
            const selected=created.plan.recommendations.find(row=>row.itemId===itemId)!;
            const input=candidates[rowIndex];
            expect(input.rowIndex).toBe(rowIndex);
            expect(input.roles.map(role=>role.roleIndex)).toEqual([selected.rankRoleIndex]);
            expect(input).not.toHaveProperty("fixedStudentBasis");
            expect(input).not.toHaveProperty("rankBasisGoal");
            expect(input).not.toHaveProperty("learningMode");
            const focus=taskFocusForItem(created.context,selected);
            expect(input.rankedSelection.taskStepIndex).toBe(focus.index);
            expect(input.roles[0].taskOptions).toContainEqual(focus);
            expect(input).not.toHaveProperty("provisionalRankRelation");
            const fact=record.facts.find(value=>value.id===selected.reasons[0].competitionFactIds[0]);
            expect(fact).toBeDefined();
            const option=input.evidenceOptions.find(entry=>entry.factIndex===input.rankedSelection.factIndex);
            expect(option).toMatchObject({text:fact!.text});
            expect(option).not.toHaveProperty("id");
            const goal=studentLearningOptionsV7(created.context.profile).goals.find(value=>value.index===selected.rankGoalIndex);
            expect(input.learnerBasisOptions).toEqual([{index:0,kind:"student_fact",factKind:"stated_preference",text:"数据建模"},
              ...(goal?[{index:1,kind:"goal",text:goal.text}]:[])]);
            const [basis]=input.learnerBasisOptions;
            return {rowIndex,reason:{...fields,factIndex:option!.factIndex,...(input.learnerBasisOptions.length>1?{learnerBasisIndex:basis.index}:{})}};
          })});
      }
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)},finish_reason:"stop"}],usage:{prompt_tokens:20,completion_tokens:10,prompt_cache_hit_tokens:5}}),{status:200,headers:{"x-request-id":"group-synthetic-provider"}});
    }));
    return calls;
  }
  async function claim(created:Created){const value=(await claimRunV7(`group-worker-${randomUUID()}`))!;expect(value.row.run_id).toBe(created.run.row.run_id);return value;}
  it("persists all six explicit v2 job fields and restores them for the worker without dispatching under the old v1 grant",async()=>{
    const previousPolicy=process.env.SAITU_V7_EFFORT_POLICY,previousHash=process.env.SAITU_V7_EFFORT_POLICY_SHA256;
    const selected=RANK_NON_THINKING_EFFORT_POLICY;
    Object.assign(process.env,{SAITU_V7_EFFORT_POLICY:JSON.stringify(selected),SAITU_V7_EFFORT_POLICY_SHA256:effortPolicySha256(selected)});
    try{
      const sessionId=randomUUID(),legacy=student({weeklyCommitment:"5-10",confirmedFields:["stage","weeklyCommitment"]});
      const context=buildDecisionContextV7(legacy,{profileId:sessionId});
      const created=await enqueueRunV7({sessionId,expiresAt:Date.now()+180000,legacy,context,submissionKey:submissionKeyV7(sessionId,"explicit-v2")});
      expect(created.run.body.effortPolicy).toEqual(selected);
      expect(Object.keys(created.run.body.effortPolicy)).toHaveLength(6);
      expect(presentRunV7(created.run,created.session).effortPolicy).toEqual(selected);
      const lease=(await claimRunV7("group-worker-explicit-v2"))!;
      expect(lease.row.run_id).toBe(created.run.row.run_id);
      let captured:unknown;
      await processClaimedRunV7(lease,{rank:async()=>{captured=currentDecisionEffortPolicy();throw new Error("SYNTHETIC_NO_V2_PROVIDER_DISPATCH");},generate:generateGroupExplanationV7,review:reviewPreparedGroupV7});
      expect(captured).toEqual(selected);
      const saved=(await readRunV7(lease.row.run_id))!;
      expect(saved.body.effortPolicy).toEqual(selected);
      expect(saved.body.effortPolicySha256).toBe(effortPolicySha256(selected));
      expect(saved.body.error).toBe("SYNTHETIC_NO_V2_PROVIDER_DISPATCH");
      expect(await readDurableDecisionJournalV7(lease.row.run_id)).toHaveLength(0);
    }finally{
      if(previousPolicy===undefined)delete process.env.SAITU_V7_EFFORT_POLICY;else process.env.SAITU_V7_EFFORT_POLICY=previousPolicy;
      if(previousHash===undefined)delete process.env.SAITU_V7_EFFORT_POLICY_SHA256;else process.env.SAITU_V7_EFFORT_POLICY_SHA256=previousHash;
    }
  });
  it("persists one Top5 group, publishes the real five items and creates no g1 ledger call",async()=>{
    const created=await start(5,true),token=createDecisionTokenV7(created.session),calls=stubTransport(created);
    expect(created.rankCalls).toEqual([{stage:"rank",groupId:"rank"}]);
    await processClaimedRunV7(await claim(created));
    const saved=(await readRunV7(created.run.row.run_id))!;
    expect(saved.row.status,saved.body.detailGroups?.groups.map(group=>group.error).join(",")).toBe("ready");expect(saved.body.detailGroups?.groups.map(group=>[group.spec.groupId,group.status])).toEqual([["g0","ready"]]);
    expect(saved.body.detailGroups?.groups[0].spec.explanationPromptVersion).toBe(DECISION_EXPLAIN_PROMPT_VERSION_V7);
    expect(saved.body.items.map(item=>item.rank)).toEqual([1,2,3,4,5]);
    expect(saved.body.plan?.recommendations.map(item=>item.itemId)).toEqual(created.plan.recommendations.map(item=>item.itemId));
    expect(saved.body.plan?.recommendations.map(item=>item.rankRoleIndex)).toEqual([0,0,0,0,0]);
    expect(created.plan.recommendations.some(item=>item.rankTaskStepIndex!>0)).toBe(true);
    expect(saved.body.items.map(item=>item.itemId)).toEqual(created.plan.recommendations.map(item=>item.itemId));
    expect(saved.body.finalPlan?.recommendations.map(item=>item.itemId)).toEqual(created.plan.recommendations.map(item=>item.itemId));
    expect(saved.body.finalPlan?.recommendations.map(item=>item.rankTaskStepIndex)).toEqual(created.plan.recommendations.map(item=>item.rankTaskStepIndex));
    expect(saved.body.finalPlan?.recommendations.map(item=>item.rankGoalIndex)).toEqual(Array.from({length:5},()=>0));
    expect(saved.body.report?.recommendations.map(item=>item.itemId)).toEqual(created.plan.recommendations.map(item=>item.itemId));
    const first=saved.body.report!.recommendations[0],reason=first.reasons[0];
    const anchor=first.evidenceFacts.find(fact=>fact.id===reason.competitionFactIds[0])!;
    const role=created.context.candidates.find(candidate=>candidate.record.recordId===first.itemId)!.record.roles[0];
    const rankedFirst=created.plan.recommendations[0];
    expect(reason.text).toContain(`${anchor.text}\n据此分析：`);
    const analysis=reason.text.split("\n据此分析：")[1];
    expect(analysis).toContain(`\n可选分工（编辑建议）「${role.name}」：${role.task}\n匹配关系：${matchingRelation}`);
    expect(reason.competitionFactIds).toEqual(rankedFirst.reasons[0].competitionFactIds);
    expect(reason.studentFactIds).toEqual([created.context.profile.facts.find(fact=>fact.field==="interests")!.id]);
    expect(reason.basis).toBe("inference");
    expect(saved.body.context.records).toEqual(created.context.records);expect(saved.body.report?.candidateAudit).toHaveLength(45);
    expect(saved.body.shortfallReason).toBeNull();
    expect(saved.body.items.every(item=>item.detailStatus==="ready")).toBe(true);
    expect(calls).toEqual([{stage:"explain",groupId:"g0"},{stage:"review",groupId:"g0"}]);expect(saved.body.report?.trace.callCount).toBe(3);expect(saved.body.report?.trace.inputTokens).toBe(60);
    expect(presentRunV7(saved,created.session).decisionToken).toBe(token);
    const finalPlan=saved.body.finalPlan!;
    const withChangedFocus={...finalPlan,recommendations:finalPlan.recommendations.map(item=>
      item.rankTaskStepIndex?{...item,rankTaskStepIndex:0}:item)};
    expect(()=>presentRunV7({...saved,body:{...saved.body,finalPlan:withChangedFocus}},created.session)).toThrow("INVALID_FINAL_SELECTION_BINDING");
    const rankedPlan=saved.body.plan!;
    const withChangedAnchor={...rankedPlan,recommendations:rankedPlan.recommendations.map(item=>{
      const record=created.context.records.find(candidate=>candidate.recordId===item.itemId)!;
      const reason=item.reasons[0];
      const other=rankTaskFactsV7(record).find(fact=>fact.id!==reason.competitionFactIds[0]);
      return other?{...item,reasons:[{...reason,competitionFactIds:[other.id]}]}:item;
    })};
    expect(withChangedAnchor).not.toEqual(rankedPlan);
    expect(()=>presentRunV7({...saved,body:{...saved.body,plan:withChangedAnchor}},created.session)).toThrow("INVALID_FINAL_SELECTION_BINDING");
    const journal=await readDurableDecisionJournalV7(saved.row.run_id);
    expect(journal.map(row=>row.callKey)).toEqual(["v7.rank:effort-v1.initial:1","v7.explain:detail-v2.g0.initial:1","v7.review:detail-v2.g0.initial:1"]);
    expect(journal.every(row=>row.upstreamAttempted&&row.usage?.inputTokens===20)).toBe(true);
  });
  it("persists two parallel Top5 groups, publishes only the reviewed group first and accounts for all five real transport calls",async()=>{
    process.env.SAITU_V7_DETAIL_LAYOUT="parallel-2";
    let releaseReview!:()=>void;
    const reviewGate=new Promise<void>(resolve=>{releaseReview=resolve;});
    let work:Promise<void>|undefined;
    try{
      const created=await start(5,true);
      expect(created.rankCalls).toEqual([{stage:"rank",groupId:"rank"}]);
      const calls=stubTransport(created,async(stage,id)=>{if(stage==="review"&&id==="g1")await reviewGate;});
      work=processClaimedRunV7(await claim(created));
      await vi.waitFor(async()=>{
        const pending=(await readRunV7(created.run.row.run_id))!;
        expect(pending.body.detailGroups?.groups.map(group=>[group.spec.groupId,group.status])).toEqual([["g0","ready"],["g1","reviewing"]]);
        expect(pending.body.items.map(item=>item.detailStatus)).toEqual(["ready","ready","checking","checking","checking"]);
        expect(pending.body.report).toBeUndefined();
        expect(pending.body.detailsReadyAt).toBeNull();
      },{timeout:5000,interval:25});
      releaseReview();await work;work=undefined;
      const saved=(await readRunV7(created.run.row.run_id))!;
      expect(saved.row.status).toBe("ready");
      expect(saved.body.items.map(item=>[item.itemId,item.rank,item.detailStatus])).toEqual(created.plan.recommendations.map((item,index)=>[item.itemId,index+1,"ready"]));
      expect(saved.body.detailGroups?.groups.map(group=>group.spec.globalRanks)).toEqual([[1,2],[3,4,5]]);
      expect(saved.body.plan?.recommendations.map(item=>item.rankRoleIndex)).toEqual([0,0,0,0,0]);
      const interestId=created.context.profile.facts.find(fact=>fact.field==="interests")!.id;
      const goal=studentLearningOptionsV7(created.context.profile).goals.find(value=>value.text===created.context.profile.primaryGoal)!;
      expect(saved.body.plan?.recommendations.map(item=>item.reasons[0].studentFactIds)).toEqual(Array.from({length:5},()=>[interestId]));
      expect(saved.body.finalPlan?.recommendations.map(item=>item.reasons[0].studentFactIds)).toEqual(Array.from({length:5},()=>[interestId]));
      expect(saved.body.finalPlan?.recommendations.map(item=>item.rankGoalIndex)).toEqual(Array.from({length:5},()=>goal.index));
      expect(saved.body.report?.recommendations.every(item=>item.reasons[0].text.includes(`你的目标是「${goal.text}」`))).toBe(true);
      expect(saved.body.report?.trace.callCount).toBe(5);expect(saved.body.report?.trace.inputTokens).toBe(100);
      const expected=["v7.rank:effort-v1.initial:1","v7.explain:detail-v2.g0.initial:1","v7.review:detail-v2.g0.initial:1","v7.explain:detail-v2.g1.initial:1","v7.review:detail-v2.g1.initial:1"];
      const journal=await readDurableDecisionJournalV7(saved.row.run_id);
      expect(journal.map(row=>row.callKey).sort()).toEqual([...expected].sort());
      expect(journal.every(row=>row.upstreamAttempted&&row.usage?.inputTokens===20)).toBe(true);
      expect(calls).toHaveLength(4);
      expect(calls.filter(row=>row.stage==="explain").map(row=>row.groupId).sort()).toEqual(["g0","g1"]);
      expect(calls.filter(row=>row.stage==="review").map(row=>row.groupId).sort()).toEqual(["g0","g1"]);
    }finally{
      releaseReview();await work;process.env.SAITU_V7_DETAIL_LAYOUT="single";
    }
  });
  for(const n of [1,2,3,4])it(`publishes an explained ${n}-item meaningful shortfall in g0 without filling the list`,async()=>{
    const created=await start(n),calls=stubTransport(created);
    await processClaimedRunV7(await claim(created));
    const saved=(await readRunV7(created.run.row.run_id))!;
    expect(saved.row.status).toBe("ready");expect(saved.body.items).toHaveLength(n);expect(saved.body.report?.recommendations).toHaveLength(n);
    expect(saved.body.detailGroups?.groups.map(group=>group.spec.groupId)).toEqual(["g0"]);
    expect(saved.body.items.map(item=>[item.itemId,item.rank])).toEqual(created.plan.recommendations.map((item,index)=>[item.itemId,index+1]));
    expect(saved.body.items.every(item=>item.detailStatus==="ready"&&item.detail?.rank===item.rank)).toBe(true);
    expect(saved.body.shortfallReason).toBe(created.plan.shortfallReason);expect(saved.body.report?.shortlistShortfallReason).toBe(created.plan.shortfallReason);
    expect(saved.body.detailGroups!.groups[0].prepared!.explanation.shortfallReason).toBe(created.plan.shortfallReason);
    expect(calls.map(row=>row.groupId)).toEqual(["g0","g0"]);
    expect((await readDurableDecisionJournalV7(saved.row.run_id)).some(row=>row.callKey.includes(".g1."))).toBe(false);
  });
  it("retains all five list items and the unknown reservation without redispatching generation",async()=>{
    const created=await start();const calls=stubTransport(created,async(stage,id)=>{if(stage==="explain"&&id==="g0")throw new Error("synthetic_network_disconnect");});
    await processClaimedRunV7(await claim(created));
    const saved=(await readRunV7(created.run.row.run_id))!;
    expect(saved.row.status).toBe("failed");expect(saved.body.items).toHaveLength(5);expect(saved.body.report).toBeUndefined();expect(saved.body.detailsReadyAt).toBeNull();
    expect(saved.body.items.every(item=>item.detailStatus==="failed"&&!item.detail)).toBe(true);
    expect(calls.filter(row=>row.groupId==="g0")).toHaveLength(1);
    const journal=await readDurableDecisionJournalV7(saved.row.run_id);expect(journal).toHaveLength(1);expect(journal.filter(row=>row.usage===null)).toHaveLength(1);
    const held=(await getPool().query("select c.state,l.state as spend_state,l.charged_micros=l.reserved_micros as protected from competition_decision_calls c join ai_spend_ledger l on l.id=c.reservation_id where c.run_id=$1 and c.call_key=$2",[saved.row.run_id,"v7.explain:detail-v2.g0.initial:1"])).rows[0];
    expect(held).toMatchObject({state:"unknown",spend_state:"conservative",protected:true});
  });
  it("keeps all Top5 details checking until the saved explanation finishes review",async()=>{
    const created=await start();let release!:()=>void;
    const blocked=new Promise<void>(resolve=>{release=resolve;});
    stubTransport(created,async(stage,id)=>{if(stage==="review"&&id==="g0")await blocked;});
    const work=processClaimedRunV7(await claim(created));
    try{
      await vi.waitFor(async()=>{
        const partial=(await readRunV7(created.run.row.run_id))!;
        expect(partial.row.status).toBe("explaining");
        expect(partial.body.items.every(item=>item.detailStatus==="checking"&&!item.detail)).toBe(true);
        expect(partial.body.detailGroups!.groups[0].prepared).toBeDefined();
        expect(partial.body.detailGroups!.groups[0].reviewPreparation?.preparedSha256).toBe(partial.body.detailGroups!.groups[0].prepared!.preparedSha256);
        expect(partial.body.report).toBeUndefined();expect(partial.body.detailsReadyAt).toBeNull();
        expect(presentRunV7(partial,created.session).decisionToken).toBe(createDecisionTokenV7(created.session));
      },{timeout:5000,interval:25});
    }finally{release();await work;}
    expect((await readRunV7(created.run.row.run_id))?.row.status).toBe("ready");
  });
  it("publishes four reviewed items in order while preserving the rejected judgment without repair or replacement",async()=>{
    const created=await start(),calls=stubTransport(created,undefined,[0]);
    await processClaimedRunV7(await claim(created));
    const saved=(await readRunV7(created.run.row.run_id))!,group=saved.body.detailGroups!.groups[0];
    const rankedIds=created.plan.recommendations.map(item=>item.itemId),acceptedIds=rankedIds.slice(1);
    const acceptedRanks=acceptedIds.map((itemId,index)=>[itemId,index+1]);
    expect(saved.row.status).toBe("ready");expect(saved.body.error).toBeUndefined();expect(saved.body.detailsReadyAt).toBeTruthy();
    expect(saved.body.plan?.recommendations.map(item=>item.itemId)).toEqual(rankedIds);
    expect(saved.body.finalPlan?.recommendations.map(item=>item.itemId)).toEqual(acceptedIds);
    expect(saved.body.items.map(item=>[item.itemId,item.rank])).toEqual(acceptedRanks);
    expect(saved.body.items.every(item=>item.detailStatus==="ready"&&item.detail?.rank===item.rank)).toBe(true);
    expect(saved.body.report?.recommendations.map(item=>[item.itemId,item.rank])).toEqual(acceptedRanks);
    expect(saved.body.shortfallReason?.trim()).toBeTruthy();
    expect(saved.body.finalPlan?.shortfallReason).toBe(saved.body.shortfallReason);
    expect(saved.body.report?.shortlistShortfallReason).toBe(saved.body.shortfallReason);
    expect(group.prepared!.explanation.recommendations).toHaveLength(5);expect(group.prepared!.assertions).toHaveLength(10);
    expect(group.reviewed!.checks.map(row=>row.supported)).toEqual([false,false,true,true,true,true,true,true,true,true]);
    expect(group.reviewed!.itemOutcomes.map(row=>[row.itemId,row.globalRank,row.status])).toEqual(rankedIds.map((itemId,index)=>[itemId,index+1,index===0?"failed":"ready"]));
    expect(group.reviewPreparation!.preparedSha256).toBe(group.prepared!.preparedSha256);
    expect(group.reviewed!.preparedSha256).toBe(group.prepared!.preparedSha256);
    expect(group.reviewed!.assertionsSha256).toBe(group.prepared!.assertionsSha256);
    const publicRun=presentRunV7(saved,created.session);
    expect(publicRun.items.map(item=>[item.itemId,item.rank])).toEqual(acceptedRanks);
    expect(publicRun.report?.recommendations.map(item=>[item.itemId,item.rank])).toEqual(acceptedRanks);
    expect(()=>presentRunV7({...saved,body:{...saved.body,finalPlan:undefined}},created.session)).toThrow("INVALID_FINAL_SELECTION_BINDING");
    expect(calls).toEqual([{stage:"explain",groupId:"g0"},{stage:"review",groupId:"g0"}]);
    const journal=await readDurableDecisionJournalV7(saved.row.run_id);
    expect(journal.map(row=>row.callKey)).toEqual(["v7.explain:detail-v2.g0.initial:1","v7.review:detail-v2.g0.initial:1"]);
    expect(await claimRunV7("must-not-replace-rejected-item")).toBeNull();
  });
  it("keeps an all-rejected review as a failed delivery without a report or another model attempt",async()=>{
    const created=await start(),calls=stubTransport(created,undefined,"all");
    await processClaimedRunV7(await claim(created));
    const saved=(await readRunV7(created.run.row.run_id))!,group=saved.body.detailGroups!.groups[0];
    expect(saved.row.status).toBe("failed");expect(saved.body.error).toBe("NO_SUPPORTED_RECOMMENDATIONS");
    expect(saved.body.plan?.recommendations).toHaveLength(5);expect(saved.body.report).toBeUndefined();
    expect(saved.body.finalPlan).toBeUndefined();expect(saved.body.detailsReadyAt).toBeNull();expect(saved.body.items).toEqual([]);
    expect(presentRunV7(saved,created.session)).toMatchObject({status:"failed",items:[],error:"NO_SUPPORTED_RECOMMENDATIONS",shortfallReason:"本次未能生成可核实的推荐。"});
    expect(group.reviewed!.checks).toHaveLength(10);expect(group.reviewed!.checks.every(row=>row.supported===false)).toBe(true);
    expect(group.reviewed!.itemOutcomes.every(row=>row.status==="failed")).toBe(true);
    expect(calls.map(row=>row.stage)).toEqual(["explain","review"]);
    expect(await claimRunV7("must-not-refill-all-rejected")).toBeNull();
  });
  it("does not publish any ready subset when the joint review omitted a required verdict",async()=>{
    const created=await start(),calls=stubTransport(created,undefined,"missing");
    await processClaimedRunV7(await claim(created));
    const saved=(await readRunV7(created.run.row.run_id))!,group=saved.body.detailGroups!.groups[0];
    expect(saved.row.status).toBe("failed");expect(saved.body.error).toBe("DETAIL_GROUP_FAILED");
    expect(saved.body.plan?.recommendations).toHaveLength(5);expect(saved.body.report).toBeUndefined();
    expect(saved.body.finalPlan).toBeUndefined();expect(saved.body.detailsReadyAt).toBeNull();
    expect(saved.body.items.every(item=>item.detailStatus==="failed"&&!item.detail)).toBe(true);
    expect(group.prepared).toBeDefined();expect(group.reviewPreparation).toBeDefined();expect(group.reviewed).toBeUndefined();
    expect(calls.map(row=>row.stage)).toEqual(["explain","review"]);
    expect(await claimRunV7("must-not-resample-incomplete-review")).toBeNull();
  });
  it("resumes persisted parsed explanation without regenerating it after worker interruption",async()=>{
    const created=await start(5),calls=stubTransport(created);
    await processClaimedRunV7(await claim(created),{rank:rankDecisionV7,generate:generateGroupExplanationV7,review:async()=>{throw new Error("aborted");}});
    const pending=(await readRunV7(created.run.row.run_id))!;
    expect(pending.body.detailGroups?.groups[0].status).toBe("prepared");expect(pending.row.status).toBe("explaining");
    const preparedHash=pending.body.detailGroups!.groups[0].prepared!.preparedSha256;
    const resumed=await claim(created),plan=resumed.body.plan!;
    const changedPlan={...plan,recommendations:plan.recommendations.map(item=>{
      const record=created.context.records.find(row=>row.recordId===item.itemId)!;
      const reason=item.reasons[0];
      const alternative=rankTaskFactsV7(record).find(fact=>fact.id!==reason.competitionFactIds[0]);
      return alternative?{...item,reasons:[{...reason,competitionFactIds:[alternative.id]}]}:item;
    })};
    expect(changedPlan).not.toEqual(plan);
    await expect(commitRunV7(resumed,"explaining",{...resumed.body,plan:changedPlan})).rejects.toThrow("DECISION_RUN_BINDING_CHANGED");
    await processClaimedRunV7(resumed);
    const final=(await readRunV7(created.run.row.run_id))!;
    expect(final.row.status).toBe("ready");expect(final.body.detailGroups!.groups[0].prepared!.preparedSha256).toBe(preparedHash);
    expect(final.body.plan).toEqual(plan);
    expect(calls.map(row=>row.stage)).toEqual(["explain","review"]);expect(final.body.report?.trace.callCount).toBe(2);
  });
  for(const crashAt of ["generation_receipt","review_receipt"] as const)it(`replays ${crashAt} after interruption with no additional provider dispatch`,async()=>{
    const created=await start(5),rejected=crashAt==="review_receipt"?[0]:[],calls=stubTransport(created,undefined,rejected),stop=new AbortController();
    await processClaimedRunV7(await claim(created),{rank:rankDecisionV7,
      generate:async(...args)=>{const result=await generateGroupExplanationV7(...args);if(crashAt==="generation_receipt")stop.abort();return result;},
      review:async(...args)=>{const result=await reviewPreparedGroupV7(...args);if(crashAt==="review_receipt")stop.abort();return result;}},stop.signal);
    const pending=(await readRunV7(created.run.row.run_id))!;
    expect(pending.row.status).toBe("explaining");expect(pending.body.detailGroups!.groups[0].status).toBe(crashAt==="generation_receipt"?"pending":"reviewing");
    const before=(await getPool().query("select call_id,reservation_id from competition_decision_calls where run_id=$1 order by created_at",[created.run.row.run_id])).rows;
    await processClaimedRunV7(await claim(created));
    const final=(await readRunV7(created.run.row.run_id))!;
    expect(final.row.status).toBe("ready");expect(calls.map(row=>row.stage)).toEqual(["explain","review"]);
    const accepted=created.plan.recommendations.slice(rejected.length).map((item,index)=>[item.itemId,index+1]);
    expect(final.body.items.map(item=>[item.itemId,item.rank])).toEqual(accepted);
    expect(final.body.report?.recommendations.map(item=>[item.itemId,item.rank])).toEqual(accepted);
    expect(final.body.detailGroups!.groups[0].reviewed!.checks.filter(row=>!row.supported)).toHaveLength(rejected.length*2);
    expect(final.body.report?.trace.callCount).toBe(2);expect(final.body.report?.trace.inputTokens).toBe(40);
    const after=(await getPool().query("select call_id,reservation_id from competition_decision_calls where run_id=$1 order by created_at",[created.run.row.run_id])).rows;
    expect(after.slice(0,before.length)).toEqual(before);
  });
  it("settles late review receipt but cannot publish over a corrected profile",async()=>{
    const created=await start(5);let replacement:Awaited<ReturnType<typeof enqueueRunV7>>|undefined;
    stubTransport(created,async(stage)=>{
      if(stage!=="review")return;
      const token=verifyDecisionTokenV7(createDecisionTokenV7(created.session))!;
      const corrected=applyExplicitCorrectionV7(created.session.profile,"刚才填错了，每周8小时改成3小时",created.input.legacy);
      expect(corrected.kind).toBe("applied");
      replacement=await enqueueRunV7({...created.input,context:buildDecisionContextV7(created.input.legacy,{profile:corrected.profile}),previous:token,
        expectedRevision:created.session.profile.revision,submissionKey:submissionKeyV7(token.sessionId,"corrected-during-review")});
    });
    await processClaimedRunV7(await claim(created));
    const old=(await readRunV7(created.run.row.run_id))!,latest=(await readRunV7(replacement!.run.row.run_id))!;
    expect(old.row.status).toBe("superseded");expect(old.body.report).toBeUndefined();expect(latest.row.status).toBe("queued");expect(latest.body.items).toEqual([]);
    expect(latest.body.sessionGeneration).toBe(created.session.generation+1);
    const rows=(await getPool().query("select c.state,l.state as spend_state from competition_decision_calls c join ai_spend_ledger l on l.id=c.reservation_id where c.run_id=$1",[old.row.run_id])).rows;
    expect(rows).toHaveLength(2);expect(rows.every(row=>row.state==="completed"&&row.spend_state==="usage_estimated")).toBe(true);
  });
  it("records a valid empty provisional list without a successful report, explanation group or another provider call",async()=>{
    const created=await start(0),calls=stubTransport(created);
    await processClaimedRunV7(await claim(created));
    const saved=(await readRunV7(created.run.row.run_id))!;
    expect(saved.row.status).toBe("failed");expect(saved.body.error).toBe("NO_SUPPORTED_RECOMMENDATIONS");
    expect(saved.body.detailGroups?.groups).toEqual([]);expect(calls).toEqual([]);
    expect(saved.body.items).toEqual([]);expect(saved.body.report).toBeUndefined();expect(saved.body.finalPlan).toBeUndefined();
    expect(saved.body.plan).toEqual(created.plan);expect(saved.body.detailsReadyAt).toBeNull();
    expect(await readDurableDecisionJournalV7(saved.row.run_id)).toEqual([]);
  });
  it("cannot grant a fresh explanation window when resuming a prepared group",async()=>{
    const created=await start(5),calls=stubTransport(created);
    await processClaimedRunV7(await claim(created),{rank:rankDecisionV7,generate:generateGroupExplanationV7,review:async()=>{throw new Error("aborted");}});
    const before=(await readRunV7(created.run.row.run_id))!;
    await fixture.admin.query("update competition_decision_runs set detail_deadline_at=detail_deadline_at+interval '1 second' where run_id=$1",[before.row.run_id]);
    await processClaimedRunV7(await claim(created));
    const final=(await readRunV7(created.run.row.run_id))!;
    expect(final.row.status).toBe("failed");expect(final.body.error).toBe("DECISION_IMPLEMENTATION_CHANGED");expect(calls).toHaveLength(1);
    expect(final.body.detailGroups?.groups[0].spec.run.detailDeadlineEpochMs).toBe(before.row.detail_deadline_at.getTime());
  });
  it("terminates an incompatible older run without a generation field instead of repeatedly reclaiming it",async()=>{
    const created=await start(5),calls=stubTransport(created);
    const old=(await readRunV7(created.run.row.run_id))!,legacyBody={...old.body} as Partial<typeof old.body>;
    delete legacyBody.sessionGeneration;legacyBody.implementationSha256="a".repeat(64);
    const sealed=sealV7(`run:${old.row.run_id}`,legacyBody);
    await fixture.admin.query("update competition_decision_runs set ciphertext=$2,iv=$3,tag=$4 where run_id=$1",[old.row.run_id,sealed.ciphertext,sealed.iv,sealed.tag]);
    await processClaimedRunV7(await claim(created));
    const final=(await readRunV7(old.row.run_id))!;
    expect(final.row.status).toBe("failed");expect(final.body.error).toBe("DECISION_IMPLEMENTATION_CHANGED");expect(calls).toEqual([]);
    expect(await claimRunV7("must-not-reclaim-incompatible")).toBeNull();
  });
});
