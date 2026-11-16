import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import pg from "pg";
const db=vi.hoisted(()=>({pool:undefined as pg.Pool|undefined}));
vi.mock("@/lib/db/pool",async importOriginal=>{
  const actual=await importOriginal<typeof import("@/lib/db/pool")>();
  return {getPool:()=>process.env.RUN_V7_TOP5_PRIVATE_PG==="1"?db.pool!:actual.getPool(),isDatabaseConfigured:()=>process.env.RUN_V7_TOP5_PRIVATE_PG==="1"?Boolean(db.pool):actual.isDatabaseConfigured()};
});
vi.unmock("@/lib/ai/spend-ledger");
import {requestAiJson} from "@/lib/ai/ai-client";
import {reserveAiSpend} from "@/lib/ai/spend-ledger";
import {DEFAULT_EFFORT_POLICY,LEGACY_DEFAULT_EFFORT_POLICY,decisionRequestSha256,effortPolicySha256} from "@/lib/ai/effort-policy.mjs";
import {withDecisionEffortPolicy} from "@/lib/ai/effort-context";
import {withDurableAiRun} from "@/lib/ai/durable-call";
import {buildDecisionContextV7} from "@/lib/competitions/v7/model";
import {RECOMMENDATION_EXECUTION_POLICY,RECOMMENDATION_IMPLEMENTATION_VERSION,RECOMMENDATION_POLICY_VERSION} from "@/lib/competitions/v7/contracts";
import {claimRunV7,commitRunV7,enqueueRunV7,presentRunV7,readRunV7,submissionKeyV7} from "@/lib/competitions/v7/store";
import {processClaimedRunV7} from "@/lib/competitions/v7/worker";
import {sealV7,unsealV7} from "@/lib/competitions/v7/crypto";
import type {MatchPlanV6} from "@/lib/competitions/v6/contracts";
import {student} from "../competitions/v6/decision-fixtures";
import {createV7TestDatabase} from "../helpers/v7-database-environment";
import {getPool} from "@/lib/db/pool";

const privateMode=process.env.RUN_V7_TOP5_PRIVATE_PG==="1",run=privateMode||process.env.RUN_V7_DATABASE_TESTS==="1"?describe:describe.skip;
const main="synthetic-top5-main",batch="saitu-v7-top5-20261109-formal-91",policy=DEFAULT_EFFORT_POLICY;
const sha=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
run("Top5 frozen execution and finite authorization on disposable PostgreSQL",()=>{
  const original={...process.env};let admin:pg.Client,fixture:Awaited<ReturnType<typeof createV7TestDatabase>>|undefined;
  let config:{host:string;port:number;database:string;runtime:string;dataDirectory:string;nonce:string};
  const upstream:Record<string,unknown>[]=[];
  async function guard(){
    if(!privateMode){expect(fixture?.database).toMatch(/^saitu_v7_durable_[a-f0-9]{32}$/);return;}
    const row=(await admin.query("select current_database() as db,session_user as role,current_setting('unix_socket_directories') as socket,current_setting('data_directory') as data,current_setting('listen_addresses') as addresses")).rows[0];
    expect(row).toEqual({db:config.database,role:"top5_admin",socket:config.host,data:config.dataDirectory,addresses:""});
    expect((await admin.query("select nonce from top5_test_control")).rows[0].nonce).toBe(config.nonce);
  }
  function condition(){return {schemaVersion:"saitu.user-approved-budget-condition.v7.top5.v1",model:"deepseek-flash",effort:"stage",phase:"formal",mainRunId:main,
    policySha256:sha(readFileSync("docs/v7/top5-continuation-contract-20261109.md")),sourcePolicy:"docs/v7/top5-continuation-contract-20261109.md",
    policyVersion:RECOMMENDATION_POLICY_VERSION,implementationVersion:RECOMMENDATION_IMPLEMENTATION_VERSION,effortPolicy:policy,effortPolicySha256:effortPolicySha256(policy),
    authorization:"user-approved-20261109-top5-continuation",freshPgRowsVerified:true,priorLedgerSha256:sha("[]")};}
  async function grant(){
    const value=condition();
    await admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,300000000),($2,3000000)",[main,batch]);
    await admin.query("insert into ai_spend_authority(singleton,run_id) values(true,$1)",[main]);
    await admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256,effort_policy,effort_policy_sha256)
      values($1,$2,20,300000000,0,300000000,'{}','Synthetic private Top5 authorization','stage',$3,$4::jsonb,'saitu.v7.top5.v1','formal',$5,$6::jsonb,$7)`,
      [batch,main,sha(JSON.stringify(value)),JSON.stringify(value),value.policySha256,JSON.stringify(policy),value.effortPolicySha256]);
    Object.assign(process.env,{AI_SPEND_RUN_ID:batch,AI_SPEND_PHASE:"formal",AI_SPEND_LIMIT_CNY:"3",AI_SPEND_FUNDED_CNY:"3",AI_SPEND_AUTHORIZED_EFFORT:"stage",
      AI_SPEND_EFFORT_CONDITION_SHA256:sha(JSON.stringify(value)),AI_SPEND_POLICY_SHA256:value.policySha256,SAITU_V7_EFFORT_POLICY:JSON.stringify(policy),SAITU_V7_EFFORT_POLICY_SHA256:value.effortPolicySha256});
  }
  const request=(operation="competition_v7_rank")=>({system:"Synthetic system",prompt:"Synthetic private request",maxTokens:32,model:"deepseek-flash",effort:"low",operation,effortPolicySha256:effortPolicySha256(policy)});
  const options=(operation="competition_v7_rank")=>({operation,model:"deepseek-flash",systemPrompt:"Synthetic system",maxTokens:32,maxAttempts:1 as const,
    diagnosticContext:{invocationId:"synthetic-top5",stage:"v7.rank",reviewId:"effort-v1.initial"}});
  function transport(){vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init:RequestInit)=>{
    upstream.push(JSON.parse(String(init.body)));return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:'{"ok":true}'}}],usage:{prompt_tokens:20,completion_tokens:10,prompt_cache_hit_tokens:5}}));
  }));}
  async function create(submittedAtEpochMs?:number){
    const sessionId=randomUUID(),legacy=student(),context=buildDecisionContextV7(legacy,{profileId:sessionId});
    const input={sessionId,expiresAt:Date.now()+180000,legacy,context,submissionKey:submissionKeyV7(sessionId,"initial"),submittedAtEpochMs};
    return {...await enqueueRunV7(input),input,context};
  }
  function plan(created:Awaited<ReturnType<typeof create>>,count=5):MatchPlanV6{return {profileRevision:created.context.profile.revision,catalogVersion:created.context.catalogVersion,
    recommendations:created.context.candidates.slice(0,count).map(candidate=>({itemId:candidate.record.recordId,rankRoleIndex:0,reasons:[{text:"Synthetic ranking reason",basis:"suggestion",studentFactIds:[],competitionFactIds:[],conditions:[]}]})),
    shortfallReason:count<5?"Only these candidates have meaningful support.":null};}
  beforeAll(async()=>{
    if(privateMode){
      const filename=process.env.V7_TOP5_PRIVATE_CONFIG??"";expect(filename).toMatch(/^\/(?:private\/)?tmp\/saitu-top5-c-[A-Za-z0-9]+\/client\.json$/);
      config=JSON.parse(readFileSync(filename,"utf8"));expect(config.database).toMatch(/^top5_private_[a-f0-9]{16}$/);expect(config.port).toBe(55479);
      admin=new pg.Client({host:config.host,port:config.port,user:"top5_admin",database:config.database});await admin.connect();await guard();
      db.pool=new pg.Pool({host:config.host,port:config.port,user:config.runtime,database:config.database,max:10});
      expect((await db.pool.query("select current_database() as db,session_user as role,inet_server_addr() is null as unix_only")).rows[0]).toEqual({db:config.database,role:config.runtime,unix_only:true});
    }else {fixture=await createV7TestDatabase("durable");admin=fixture.admin;process.env.DATABASE_URL=fixture.runtimeUrl;db.pool=getPool();}
    vi.spyOn(console,"info").mockImplementation(()=>undefined);vi.spyOn(console,"warn").mockImplementation(()=>undefined);
  });
  beforeEach(async()=>{
    await guard();await admin.query("truncate competition_decision_chat_requests,competition_decision_calls,competition_decision_runs,competition_decision_states,ai_spend_ledger,ai_spend_development_batches,ai_spend_authority,ai_spend_budgets,ai_model_call_leases,ai_model_call_waiters,ai_model_daily_usage");
    process.env={...original};Object.assign(process.env,{SAITU_AI_EXECUTION_MODE:"finite",NODE_ENV:"test",AI_PROVIDER:"deepseek",AI_API_KEY:"synthetic-never-sent",AI_CONVERSATION_SIGNING_SECRET:"synthetic-top5-signing-secret-000000000",SAITU_V7_SOURCE_SHA256:"c".repeat(64)});
    if(fixture)process.env.DATABASE_URL=fixture.runtimeUrl;
    upstream.length=0;vi.stubGlobal("fetch",()=>{throw new Error("native_provider_fetch_forbidden");});await grant();
  });
  afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
  afterAll(async()=>{await db.pool?.end();db.pool=undefined;delete (globalThis as typeof globalThis&{__pgPool?:pg.Pool}).__pgPool;
    if(fixture)await fixture.close();else await admin?.end();process.env={...original};vi.restoreAllMocks();});

  it("dispatches low product stages and high profile/chat with thinking enabled under the same finite grant",async()=>{
    transport();
    for(const operation of ["competition_v7_rank","competition_v7_explain","competition_v7_review","competition_normalize","competition_v7_chat","competition_v7_chat_review"])
      expect((await requestAiJson("Synthetic private request",options(operation))).ok).toBe(true);
    expect(upstream.map(row=>row.reasoning_effort)).toEqual(["low","low","low","high","high","high"]);
    expect(upstream.every(row=>(row.thinking as {type:string}).type==="enabled")).toBe(true);
    expect((await admin.query("select effort from ai_spend_ledger order by created_at")).rows.map(row=>row.effort)).toEqual(["low","low","low","high","high","high"]);
  });
  it("rejects a wrong contract, authorization, policy version, implementation or stage at the database boundary",async()=>{
    for(const patch of [{sourcePolicy:"docs/v7/effort-continuation-contract-20261109.md"},{authorization:"user-approved-20261109-effort-exploration"},{policyVersion:"saitu.policy.2026-11-09.v7"},{implementationVersion:"saitu.async.2026-11-09.v7.2"},{mainRunId:"other-main"},{phase:"repair"}])
      await expect(admin.query("update ai_spend_development_batches set effort_condition=effort_condition||$2::jsonb where run_id=$1",[batch,JSON.stringify(patch)])).rejects.toMatchObject({code:"23514"});
    await expect(admin.query("update ai_spend_development_batches set effort_policy=effort_policy||'{\"rank\":\"high\"}' where run_id=$1",[batch])).rejects.toMatchObject({code:"23514"});
    expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(0);
  });
  it("refuses mismatched environment bindings before reservations or provider dispatch",async()=>{
    for(const name of ["AI_SPEND_POLICY_SHA256","AI_SPEND_EFFORT_CONDITION_SHA256"]){const previous=process.env[name];process.env[name]="0".repeat(64);
      expect(await reserveAiSpend(request())).toMatchObject({ok:false,reason:"spend_configuration_invalid"});process.env[name]=previous;}
    for(const patch of [{operation:"unapproved"},{effort:"high"},{effortPolicySha256:"0".repeat(64)}])expect(await reserveAiSpend({...request(),...patch})).toMatchObject({ok:false,reason:"spend_configuration_invalid"});
    process.env.AI_SPEND_PHASE="repair";expect(await reserveAiSpend(request())).toMatchObject({ok:false,reason:"spend_configuration_invalid"});
    expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(0);expect(upstream).toHaveLength(0);
  });
  it("preserves finite call limits atomically under parallel reservations",async()=>{
    await admin.query("update ai_spend_development_batches set call_limit=2 where run_id=$1",[batch]);
    const values=await Promise.all(Array.from({length:8},()=>reserveAiSpend(request())));
    expect(values.filter(value=>value.ok)).toHaveLength(2);expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(2);
  });
  it("freezes new targets and cutoffs from the original click and replays them without resetting effort",async()=>{
    const origin=Date.now()-45000,created=await create(origin),response=presentRunV7(created.run,created.session);
    expect(created.run.body.executionPolicy).toEqual(RECOMMENDATION_EXECUTION_POLICY);
    expect(created.run.row.list_deadline_at.getTime()).toBe(origin+60000);expect(created.run.row.detail_deadline_at.getTime()).toBe(origin+150000);
    expect(response.listTargetAt).toBe(new Date(origin+40000).toISOString());expect(response.detailTargetAt).toBe(new Date(origin+120000).toISOString());
    process.env.SAITU_V7_EFFORT_POLICY=JSON.stringify(LEGACY_DEFAULT_EFFORT_POLICY);process.env.SAITU_V7_EFFORT_POLICY_SHA256=effortPolicySha256(LEGACY_DEFAULT_EFFORT_POLICY);
    const replay=await enqueueRunV7({...created.input,submittedAtEpochMs:Date.now()+100000});
    expect(replay.run.row.run_id).toBe(created.run.row.run_id);expect(replay.run.body).toEqual(created.run.body);expect(replay.run.row.list_deadline_at).toEqual(created.run.row.list_deadline_at);
  });
  it("refuses a non-low product policy before creating a new Top5 task",async()=>{
    process.env.SAITU_V7_EFFORT_POLICY=JSON.stringify(LEGACY_DEFAULT_EFFORT_POLICY);process.env.SAITU_V7_EFFORT_POLICY_SHA256=effortPolicySha256(LEGACY_DEFAULT_EFFORT_POLICY);
    await expect(create()).rejects.toThrow("DECISION_EFFORT_POLICY_CHANGED");
    expect((await admin.query("select count(*)::int as n from competition_decision_runs")).rows[0].n).toBe(0);
    expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(0);
  });
  it("reads a historical ten-item task with original 45/90 cutoffs and excludes it from new worker claims",async()=>{
    const created=await create(),body={...created.run.body,items:Array.from({length:10},(_,index)=>({rank:index+1,itemId:`old-${index}`,seriesId:`old-series-${index}`,name:`Historical ${index}`,trackLabel:"old",edition:"2026",officialUrl:null,detailStatus:"pending" as const})),effortPolicy:LEGACY_DEFAULT_EFFORT_POLICY,effortPolicySha256:effortPolicySha256(LEGACY_DEFAULT_EFFORT_POLICY)};
    delete body.executionPolicy;const sealed=sealV7(`run:${created.run.row.run_id}`,body),origin=created.run.row.submitted_at;
    await admin.query("update competition_decision_runs set implementation_version='saitu.async.2026-11-09.v7.2',ciphertext=$2,iv=$3,tag=$4,list_deadline_at=$5,detail_deadline_at=$6 where run_id=$1",[created.run.row.run_id,sealed.ciphertext,sealed.iv,sealed.tag,new Date(origin.getTime()+45000),new Date(origin.getTime()+90000)]);
    const saved=(await readRunV7(created.run.row.run_id))!,response=presentRunV7(saved,created.session);
    expect(response.policyVersion).toBe("saitu.policy.2026-11-09.v7");expect(response.items).toHaveLength(10);expect(response.effortPolicy).toEqual(LEGACY_DEFAULT_EFFORT_POLICY);
    expect(response.rankDeadlineAt).toBe(new Date(origin.getTime()+45000).toISOString());expect(response.detailDeadlineAt).toBe(new Date(origin.getTime()+90000).toISOString());
    expect(await claimRunV7("new-worker")).toBeNull();expect((await readRunV7(created.run.row.run_id))?.body).toEqual(saved.body);
  });
  it("allows ranking after its target, publishes only five and includes frozen versions in actual durable hashes",async()=>{
    transport();const created=await create(Date.now()-45000),lease=(await claimRunV7("top5-version-worker"))!;
    const rank=vi.fn(async(_context,execution)=>{expect(execution.deadlineEpochMs).toBe(lease.row.submitted_at.getTime()+60000-750);
      expect((await requestAiJson("Synthetic private request",options())).ok).toBe(true);return plan(created);});
    await processClaimedRunV7(lease,{rank,generate:vi.fn(),review:vi.fn()});
    const saved=(await readRunV7(created.run.row.run_id))!;expect(saved.row.status).toBe("list_ready");expect(saved.body.items).toHaveLength(5);
    const call=(await admin.query("select * from competition_decision_calls where run_id=$1",[created.run.row.run_id])).rows[0];
    expect(call.prompt_sha256).toBe(decisionRequestSha256({prompt:"Synthetic private request",system:"Synthetic system",model:"deepseek-flash",maxTokens:32,thinking:"enabled",reasoningEffort:"low",effortPolicySha256:effortPolicySha256(policy),recommendationPolicyVersion:RECOMMENDATION_POLICY_VERSION,implementationVersion:RECOMMENDATION_IMPLEMENTATION_VERSION}));
    expect(unsealV7<{receipt:Record<string,unknown>}>(`call:${call.call_id}`,call).receipt).toMatchObject({recommendationPolicyVersion:RECOMMENDATION_POLICY_VERSION,implementationVersion:RECOMMENDATION_IMPLEMENTATION_VERSION});
    expect(upstream).toHaveLength(1);expect(upstream[0]).not.toHaveProperty("recommendationPolicyVersion");
  });
  it("rejects a sixth generated item or unexplained shortfall before publication",async()=>{
    for(const count of [6,4]){const created=await create(),lease=(await claimRunV7(`invalid-count-${count}`))!;
      const invalid={...plan(created,count),shortfallReason:null};
      await processClaimedRunV7(lease,{rank:async()=>invalid,generate:vi.fn(),review:vi.fn()});
      const saved=(await readRunV7(created.run.row.run_id))!;expect(saved.row.status).toBe("failed");expect(saved.body.error).toBe("INVALID_RANKING_ITEM_COUNT");expect(saved.body.items).toHaveLength(0);}
  });
  it("rejects missing, fractional or out-of-owner fresh rank role indices before publishing a list",async()=>{
    for(const rankRoleIndex of [undefined,-1,9999,0.5]){
      const created=await create(),lease=(await claimRunV7(`invalid-role-${String(rankRoleIndex)}`))!,invalid=plan(created,1);
      if(rankRoleIndex===undefined)delete invalid.recommendations[0].rankRoleIndex;
      else invalid.recommendations[0].rankRoleIndex=rankRoleIndex;
      await processClaimedRunV7(lease,{rank:async()=>invalid,generate:vi.fn(),review:vi.fn()});
      const saved=(await readRunV7(created.run.row.run_id))!;
      expect(saved.row.status).toBe("failed");expect(saved.body.error).toBe("invalid_rank_role_binding");
      expect(saved.body.items).toEqual([]);expect(saved.body.listReadyAt).toBeNull();expect(saved.body.plan).toBeUndefined();
    }
    expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(0);expect(upstream).toHaveLength(0);
  });
  it("persists the model's actual nondefault owner role index and replays it without guessing from prose",async()=>{
    const created=await create(),lease=(await claimRunV7("explicit-owner-role"))!,chosen=plan(created,1);
    const candidate=created.context.candidates.find(value=>value.record.roles.length>1)!;
    const index=candidate.record.roles.length-1;expect(index).toBeGreaterThan(0);
    chosen.recommendations[0].itemId=candidate.record.recordId;chosen.recommendations[0].rankRoleIndex=index;
    await processClaimedRunV7(lease,{rank:async()=>chosen,generate:vi.fn(),review:vi.fn()});
    const saved=(await readRunV7(created.run.row.run_id))!;
    expect(saved.row.status).toBe("list_ready");expect(saved.body.plan?.recommendations[0].rankRoleIndex).toBe(index);
    expect(saved.body.plan?.recommendations[0].roleIndex).toBeUndefined();expect(saved.body.plan?.recommendations[0].roleReason).toBeUndefined();
    const replay=await enqueueRunV7(created.input);expect(replay.run.body.plan).toEqual(chosen);
    expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(0);expect(upstream).toHaveLength(0);
  });
  it("prevents changing frozen execution policy and suppresses uncertain paid retries across namespaces",async()=>{
    const created=await create(),lease=(await claimRunV7("top5-unknown-worker"))!;await commitRunV7(lease,"ranking",lease.body);
    await expect(commitRunV7(lease,"ranking",{...lease.body,executionPolicy:{...RECOMMENDATION_EXECUTION_POLICY,maxItems:10}})).rejects.toThrow("DECISION_RUN_BINDING_CHANGED");
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("synthetic_disconnect");}));
    await withDecisionEffortPolicy(policy,()=>withDurableAiRun({runId:created.run.row.run_id,owner:lease.owner,fence:lease.fence,effortPolicySha256:effortPolicySha256(policy),requestVersion:{recommendationPolicyVersion:RECOMMENDATION_POLICY_VERSION,implementationVersion:RECOMMENDATION_IMPLEMENTATION_VERSION}},async()=>{
      expect(await requestAiJson("Synthetic private request",options())).toMatchObject({ok:false,reason:"network_error",upstreamAttempted:true});
      expect(await requestAiJson("Changed namespace",{...options(),diagnosticContext:{invocationId:"synthetic-top5",stage:"v7.rank",reviewId:"future-key"}})).toMatchObject({ok:false,reason:"durable_outcome_unknown"});
    }));
    expect(fetch).toHaveBeenCalledTimes(1);expect((await admin.query("select state,charged_micros=reserved_micros as held from ai_spend_ledger")).rows).toEqual([{state:"conservative",held:true}]);
    expect((await readRunV7(created.run.row.run_id))?.body.executionPolicy).toEqual(RECOMMENDATION_EXECUTION_POLICY);
  });
  it("rejects caller version substitution before spend and replays an explicitly versioned receipt once",async()=>{
    const created=await create(),lease=(await claimRunV7("top5-version-replay"))!;await commitRunV7(lease,"ranking",lease.body);transport();
    const requestVersion={recommendationPolicyVersion:RECOMMENDATION_POLICY_VERSION,implementationVersion:RECOMMENDATION_IMPLEMENTATION_VERSION};
    await withDecisionEffortPolicy(policy,()=>withDurableAiRun({runId:created.run.row.run_id,owner:lease.owner,fence:lease.fence,effortPolicySha256:effortPolicySha256(policy),requestVersion},async()=>{
      expect(await requestAiJson("Synthetic private request",{...options(),...requestVersion,implementationVersion:"saitu.async.2026-11-09.v7.2"})).toMatchObject({ok:false,reason:"spend_configuration_invalid",upstreamAttempted:false});
      expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(0);
      expect((await requestAiJson("Synthetic private request",{...options(),...requestVersion})).ok).toBe(true);
      expect((await requestAiJson("Synthetic private request",options())).ok).toBe(true);
    }));
    expect(upstream).toHaveLength(1);expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(1);
  });
  it("continues details after the 120 second target and stops at the original 150 second hard cutoff",async()=>{
    for(const elapsed of [125000,151000]){
      const created=await create(),origin=Date.now()-elapsed,ranking=plan(created);
      const body={...created.run.body,plan:ranking,items:created.context.candidates.slice(0,5).map((candidate,index)=>({rank:index+1,itemId:candidate.record.recordId,seriesId:candidate.record.seriesId,name:candidate.record.name,trackLabel:candidate.record.track.name,edition:candidate.record.edition,officialUrl:null,detailStatus:"pending" as const})),listReadyAt:new Date(origin+50000).toISOString()};
      const sealed=sealV7(`run:${created.run.row.run_id}`,body);
      await admin.query("update competition_decision_runs set status='list_ready',ciphertext=$2,iv=$3,tag=$4,submitted_at=$5,list_deadline_at=$6,detail_deadline_at=$7 where run_id=$1",[created.run.row.run_id,sealed.ciphertext,sealed.iv,sealed.tag,new Date(origin),new Date(origin+60000),new Date(origin+150000)]);
      const lease=(await claimRunV7(`detail-boundary-${elapsed}`))!,explain=vi.fn(async(_context,_plan,execution)=>{expect(execution.deadlineEpochMs).toBe(origin+150000-750);throw new Error("DETAIL_BOUNDARY_PROBE");});
      await processClaimedRunV7(lease,{rank:vi.fn(),explain});
      const saved=(await readRunV7(created.run.row.run_id))!;
      expect(explain).toHaveBeenCalledTimes(elapsed<150000?1:0);expect(saved.body.error).toBe(elapsed<150000?"DETAIL_BOUNDARY_PROBE":"DETAIL_DEADLINE_EXCEEDED");
      expect(saved.row.detail_deadline_at.getTime()).toBe(origin+150000);expect(saved.body.items).toHaveLength(5);
    }
  });
  it("keeps historical grants and ledger rows unchanged when the forward migration replays",async()=>{
    const accepted=await reserveAiSpend(request());expect(accepted.ok).toBe(true);if(accepted.ok)await accepted.reservation.settle(undefined,true);
    const before={grants:(await admin.query("select * from ai_spend_development_batches order by run_id")).rows,ledger:(await admin.query("select * from ai_spend_ledger order by id")).rows};
    await admin.query(readFileSync("db/migrations/20261109_spend_v7_top5_policy.sql","utf8"));
    expect({grants:(await admin.query("select * from ai_spend_development_batches order by run_id")).rows,ledger:(await admin.query("select * from ai_spend_ledger order by id")).rows}).toEqual(before);
    for(const sql of ["insert into ai_spend_budgets(run_id,hard_limit_micros) values('forbidden',1)","update ai_spend_authority set run_id=run_id","update ai_spend_development_batches set authorized_effort='stage'"])
      await expect(db.pool!.query(sql)).rejects.toMatchObject({code:"42501"});
  });
});
