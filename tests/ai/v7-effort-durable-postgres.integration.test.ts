import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import pg from "pg";
const db=vi.hoisted(()=>({pool:undefined as pg.Pool|undefined}));
vi.mock("@/lib/db/pool",async importOriginal=>{
  const actual=await importOriginal<typeof import("@/lib/db/pool")>();
  return {getPool:()=>{if(process.env.RUN_V7_EFFORT_PRIVATE_PG!=="1"&&process.env.RUN_V7_TOP5_PRIVATE_PG!=="1")return actual.getPool();if(!db.pool)throw new Error("private_effort_pool_not_ready");return db.pool;},
    isDatabaseConfigured:()=>(process.env.RUN_V7_EFFORT_PRIVATE_PG==="1"||process.env.RUN_V7_TOP5_PRIVATE_PG==="1")?Boolean(db.pool):actual.isDatabaseConfigured()};
});
vi.unmock("@/lib/ai/spend-ledger");
import {requestAiJson} from "@/lib/ai/ai-client";
import {reserveAiSpend} from "@/lib/ai/spend-ledger";
import {readDurableDecisionJournalV7,withDurableAiRun} from "@/lib/ai/durable-call";
import {currentDecisionEffortPolicy,withDecisionEffortPolicy} from "@/lib/ai/effort-context";
import {DEFAULT_EFFORT_POLICY,LEGACY_DEFAULT_EFFORT_POLICY,decisionRequestSha256,effortPolicySha256,parseEffortPolicy,type DecisionEffortPolicy} from "@/lib/ai/effort-policy.mjs";
import {claimRunV7,commitRunV7,enqueueRunV7,readRunV7,RECOMMENDATION_DIAGNOSTIC_IMPLEMENTATION_VERSION_V7,submissionKeyV7} from "@/lib/competitions/v7/store";
import {sealV7,unsealV7} from "@/lib/competitions/v7/crypto";
import {processClaimedRunV7} from "@/lib/competitions/v7/worker";
import {buildDecisionContextV7} from "@/lib/competitions/v7/model";
import {student} from "../competitions/v6/decision-fixtures";
import {getPool} from "@/lib/db/pool";
import {createV7TestDatabase} from "../helpers/v7-database-environment";

const privateTop5=process.env.RUN_V7_TOP5_PRIVATE_PG==="1",privateMode=process.env.RUN_V7_EFFORT_PRIVATE_PG==="1"||privateTop5;
const run=privateMode||process.env.RUN_V7_DATABASE_TESTS==="1"?describe:describe.skip;
const original={...process.env},main="synthetic-private-main",batch="saitu-v7-effort-20261109-formal-91";
const policy=parseEffortPolicy({version:"saitu.effort-policy.v1",rank:"low",explain:"high",review:"low"});
const sha=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
run("stage effort on owned socket PostgreSQL with synthetic provider",()=>{
  let admin:pg.Client,config:{host:string;port:number;database:string;runtime:string;dataDirectory:string;nonce:string};
  let releaseFixture:Awaited<ReturnType<typeof createV7TestDatabase>>|undefined;
  const observeCalls:Record<string,unknown>[]=[];
  async function guard(){
    if(!privateMode){
      expect(releaseFixture?.database).toMatch(/^saitu_v7_durable_[a-f0-9]{32}$/);
      expect((await admin.query("select current_database() as database")).rows[0].database).toBe(releaseFixture!.database);return;
    }
    const row=(await admin.query("select current_database() as db,session_user as role,current_setting('unix_socket_directories') as socket,current_setting('data_directory') as data,current_setting('listen_addresses') as addresses")).rows[0];
    expect(row).toEqual({db:config.database,role:privateTop5?"top5_admin":"effort_admin",socket:config.host,data:config.dataDirectory,addresses:""});
    expect((await admin.query(privateTop5?"select nonce from top5_test_control":"select nonce from effort_test_control")).rows[0].nonce).toBe(config.nonce);
  }
  function configure(value:DecisionEffortPolicy){Object.assign(process.env,{SAITU_V7_EFFORT_POLICY:JSON.stringify(value),SAITU_V7_EFFORT_POLICY_SHA256:effortPolicySha256(value)});}
  async function grant(value:DecisionEffortPolicy=policy,callLimit=20){
    const policyHash=effortPolicySha256(value),policySha=sha(readFileSync("docs/v7/effort-continuation-contract-20261109.md"));
    const condition={schemaVersion:"saitu.user-approved-budget-condition.v7.effort.v1",model:"deepseek-flash",effort:"stage",phase:"formal",mainRunId:main,
      policySha256:policySha,effortPolicy:value,effortPolicySha256:policyHash,authorization:"user-approved-20261109-effort-exploration",freshPgRowsVerified:true};
    await admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,300000000),($2,3000000)",[main,batch]);
    await admin.query("insert into ai_spend_authority(singleton,run_id) values(true,$1)",[main]);
    await admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256,effort_policy,effort_policy_sha256)
      values($1,$2,$3,300000000,0,300000000,'{}','synthetic private grant','stage',$4,$5::jsonb,'saitu.v7.effort.v1','formal',$6,$7::jsonb,$8)`,
      [batch,main,callLimit,sha(JSON.stringify(condition)),JSON.stringify(condition),policySha,JSON.stringify(value),policyHash]);
    configure(value);Object.assign(process.env,{AI_SPEND_RUN_ID:batch,AI_SPEND_PHASE:"formal",AI_SPEND_LIMIT_CNY:"3",AI_SPEND_FUNDED_CNY:"3",AI_SPEND_AUTHORIZED_EFFORT:"stage",
      AI_SPEND_POLICY_SHA256:policySha,AI_SPEND_EFFORT_CONDITION_SHA256:sha(JSON.stringify(condition))});
  }
  function syntheticFetch(hook?:()=>Promise<void>){
    vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init:RequestInit)=>{
      const body=JSON.parse(String(init.body));observeCalls.push(body);await hook?.();
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:'{"ok":true}'}}],usage:{prompt_tokens:20,completion_tokens:10,prompt_cache_hit_tokens:5}}));
    }));
  }
  async function create(submittedAtEpochMs?:number){
    const sessionId=randomUUID(),legacy=student(),context=buildDecisionContextV7(legacy,{profileId:sessionId});
    const input={sessionId,expiresAt:Date.now()+180000,legacy,context,submissionKey:submissionKeyV7(sessionId,"initial"),submittedAtEpochMs};
    // Explicit historical fixture: an admin restores original v7.2/LHL bytes.
    // New Top5 submissions themselves always require LLL.
    const created=await withDecisionEffortPolicy(DEFAULT_EFFORT_POLICY,()=>enqueueRunV7(input));
    const body={...created.run.body,effortPolicy:policy,effortPolicySha256:effortPolicySha256(policy)};delete body.executionPolicy;
    const sealed=sealV7(`run:${created.run.row.run_id}`,body),origin=created.run.row.submitted_at.getTime();
    await admin.query("update competition_decision_runs set implementation_version='saitu.async.2026-11-09.v7.2',ciphertext=$2,iv=$3,tag=$4,list_deadline_at=$5,detail_deadline_at=$6 where run_id=$1",[created.run.row.run_id,sealed.ciphertext,sealed.iv,sealed.tag,new Date(origin+45000),new Date(origin+90000)]);
    return {...created,run:(await readRunV7(created.run.row.run_id))!,input,context};
  }
  async function createTop5(){
    const sessionId=randomUUID(),legacy=student(),context=buildDecisionContextV7(legacy,{profileId:sessionId});
    const input={sessionId,expiresAt:Date.now()+180000,legacy,context,submissionKey:submissionKeyV7(sessionId,"top5")};
    return {...await withDecisionEffortPolicy(DEFAULT_EFFORT_POLICY,()=>enqueueRunV7(input)),input,context};
  }
  async function claim(){
    const row=(await admin.query("update competition_decision_runs set status='ranking',lease_owner='effort-private-worker',lease_fence=lease_fence+1,lease_expires_at=now()+interval '20 seconds' where run_id=(select run_id from competition_decision_runs where status='queued' order by submitted_at limit 1) returning run_id,lease_fence")).rows[0];
    expect(row).toBeTruthy();return {...(await readRunV7(row.run_id))!,owner:"effort-private-worker",fence:String(row.lease_fence)};
  }
  const request=(operation="competition_v7_rank")=>({system:"Synthetic system",prompt:"Synthetic no provider",maxTokens:32,model:"deepseek-flash",effort:operation==="competition_v7_explain"?"high":"low",operation,effortPolicySha256:effortPolicySha256(policy)});
  const options=(operation="competition_v7_rank",reviewId="effort-v1.initial")=>({operation,model:"deepseek-flash",systemPrompt:"Synthetic system",maxTokens:32,maxAttempts:1 as const,
    diagnosticContext:{invocationId:"synthetic",stage:operation.replace("competition_","v7.").replace("v7.v7_","v7."),reviewId}});
  beforeAll(async()=>{
    if(privateMode){
      const filename=(privateTop5?process.env.V7_TOP5_PRIVATE_CONFIG:process.env.V7_EFFORT_PRIVATE_CONFIG)??"";expect(filename).toMatch(privateTop5?/^\/(?:private\/)?tmp\/saitu-top5-c-[A-Za-z0-9]+\/client\.json$/:/^\/(?:private\/)?tmp\/saitu-effort-c-[A-Za-z0-9]+\/client\.json$/);
      config=JSON.parse(readFileSync(filename,"utf8"));expect(config.database).toMatch(privateTop5?/^top5_private_[a-f0-9]{16}$/:/^effort_private_[a-f0-9]{16}$/);expect(config.host).toMatch(privateTop5?/^\/(?:private\/)?tmp\/saitu-top5-c-[A-Za-z0-9]+\/socket$/:/^\/(?:private\/)?tmp\/saitu-effort-c-[A-Za-z0-9]+\/socket$/);expect(config.port).toBe(privateTop5?55479:55439);
      admin=new pg.Client({host:config.host,port:config.port,user:privateTop5?"top5_admin":"effort_admin",database:config.database});await admin.connect();await guard();
      db.pool=new pg.Pool({host:config.host,port:config.port,user:config.runtime,database:config.database,max:10});
      const identity=(await db.pool.query("select current_database() as db,session_user as role,inet_server_addr() is null as unix_only")).rows[0];
      expect(identity).toEqual({db:config.database,role:config.runtime,unix_only:true});
    }else{
      releaseFixture=await createV7TestDatabase("durable");admin=releaseFixture.admin;
      process.env.DATABASE_URL=releaseFixture.runtimeUrl;db.pool=getPool();await guard();
    }
    vi.spyOn(console,"info").mockImplementation(()=>undefined);vi.spyOn(console,"warn").mockImplementation(()=>undefined);
  });
  beforeEach(async()=>{
    await guard();await admin.query(`truncate competition_decision_chat_requests,competition_decision_calls,competition_decision_runs,competition_decision_states,
      ai_spend_ledger,ai_spend_development_batches,ai_spend_authority,ai_spend_budgets,ai_model_call_leases,ai_model_call_waiters,ai_model_daily_usage`);
    process.env={...original};Object.assign(process.env,{SAITU_AI_EXECUTION_MODE:"finite",NODE_ENV:"test",AI_PROVIDER:"deepseek",AI_API_KEY:"synthetic-never-sent",AI_CONVERSATION_SIGNING_SECRET:"synthetic-effort-private-signing-secret-0000",SAITU_V7_SOURCE_SHA256:"c".repeat(64)});
    if(releaseFixture)process.env.DATABASE_URL=releaseFixture.runtimeUrl;
    observeCalls.length=0;vi.stubGlobal("fetch",()=>{throw new Error("native_provider_fetch_forbidden");});await grant();
  });
  afterEach(()=>{vi.unstubAllGlobals();});
  afterAll(async()=>{await db.pool?.end();db.pool=undefined;
    const globals=globalThis as typeof globalThis&{__pgPool?:pg.Pool};delete globals.__pgPool;
    if(releaseFixture)await releaseFixture.close();else await admin?.end();process.env={...original};vi.restoreAllMocks();});

  it("runs real low/high/low reservations and persists actual operation and policy",async()=>{
    syntheticFetch();
    for(const stage of ["rank","explain","review"])expect((await requestAiJson("synthetic",options(`competition_v7_${stage}`))).ok).toBe(true);
    expect(observeCalls.map(row=>row.reasoning_effort)).toEqual(["low","high","low"]);
    const ledger=(await admin.query("select operation,effort,effort_policy_sha256,state from ai_spend_ledger order by created_at")).rows;
    expect(ledger.map(row=>row.effort)).toEqual(["low","high","low"]);
    expect(ledger.every(row=>row.effort_policy_sha256===effortPolicySha256(policy)&&row.state==="usage_estimated")).toBe(true);
  });
  it("refuses mismatched condition, policy, phase, effort and operation before ledger insertion",async()=>{
    const condition=process.env.AI_SPEND_EFFORT_CONDITION_SHA256;process.env.AI_SPEND_EFFORT_CONDITION_SHA256="0".repeat(64);
    expect(await reserveAiSpend(request())).toMatchObject({ok:false,reason:"spend_configuration_invalid"});process.env.AI_SPEND_EFFORT_CONDITION_SHA256=condition;
    for(const changed of [{effort:"high"},{effortPolicySha256:"0".repeat(64)},{operation:"unapproved"}])expect(await reserveAiSpend({...request(),...changed})).toMatchObject({ok:false,reason:"spend_configuration_invalid"});
    process.env.AI_SPEND_PHASE="repair";expect(await reserveAiSpend(request())).toMatchObject({ok:false,reason:"spend_configuration_invalid"});
    expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(0);
  });
  it("retains finite call limits atomically under concurrent attempts",async()=>{
    await admin.query("update ai_spend_development_batches set call_limit=2 where run_id=$1",[batch]);
    const results=await Promise.all(Array.from({length:8},()=>reserveAiSpend(request())));
    expect(results.filter(row=>row.ok)).toHaveLength(2);expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(2);
  });
  it("preserves an unknown full charge and refuses a fresh namespace without another reservation",async()=>{
    const created=await create(),lease=await claim();vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("synthetic_disconnect");}));
    await withDecisionEffortPolicy(policy,()=>withDurableAiRun({runId:created.run.row.run_id,owner:lease.owner,fence:lease.fence,effortPolicySha256:effortPolicySha256(policy)},async()=>{
      expect(await requestAiJson("synthetic",options())).toMatchObject({ok:false,reason:"network_error",upstreamAttempted:true});
      const before=(await admin.query("select * from ai_spend_ledger")).rows;
      expect(await requestAiJson("changed namespace",options("competition_v7_rank","effort-v2.initial"))).toMatchObject({ok:false,reason:"durable_outcome_unknown"});
      expect((await admin.query("select * from ai_spend_ledger")).rows).toEqual(before);
    }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await admin.query("select state,charged_micros=reserved_micros as held from ai_spend_ledger")).rows).toEqual([{state:"conservative",held:true}]);
  });
  it("blocks an old unknown row before inserting a new implementation key",async()=>{
    const created=await create(),lease=await claim();
    await admin.query("insert into competition_decision_calls(call_id,run_id,call_key,prompt_sha256,state) values($1,$2,'v7.rank:batch:1',$3,'unknown')",[randomUUID(),created.run.row.run_id,"a".repeat(64)]);
    await withDecisionEffortPolicy(policy,()=>withDurableAiRun({runId:created.run.row.run_id,owner:lease.owner,fence:lease.fence,effortPolicySha256:effortPolicySha256(policy)},async()=>{
      expect(await requestAiJson("new prompt",options())).toMatchObject({ok:false,reason:"durable_outcome_unknown"});
    }));
    expect((await admin.query("select count(*)::int as n from competition_decision_calls")).rows[0].n).toBe(1);
    expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(0);
  });
  it("allows two same-lease in-flight siblings and retains two unique receipts",async()=>{
    const created=await create(),lease=await claim();let release!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve;});syntheticFetch(()=>pending);
    try {
      const both=withDecisionEffortPolicy(policy,()=>withDurableAiRun({runId:created.run.row.run_id,owner:lease.owner,fence:lease.fence,effortPolicySha256:effortPolicySha256(policy)},()=>
        Promise.all([requestAiJson("rank",options()),requestAiJson("explain",options("competition_v7_explain","detail-v2.g0.initial"))])));
      for(let i=0;i<100&&observeCalls.length<2;i++)await new Promise(resolve=>setTimeout(resolve,10));
      expect(observeCalls).toHaveLength(2);release();expect((await both).every(value=>value.ok)).toBe(true);
      expect((await readDurableDecisionJournalV7(created.run.row.run_id))).toHaveLength(2);
    }finally{release();}
  });
  it("replays a durable raw receipt without duplicate spend and pins the actual request SHA",async()=>{
    const created=await create(),lease=await claim();syntheticFetch();const callOptions=options();
    await withDecisionEffortPolicy(policy,()=>withDurableAiRun({runId:created.run.row.run_id,owner:lease.owner,fence:lease.fence,effortPolicySha256:effortPolicySha256(policy)},async()=>{
      expect((await requestAiJson("synthetic",callOptions)).ok).toBe(true);configure(DEFAULT_EFFORT_POLICY);
      expect((await requestAiJson("synthetic",callOptions)).ok).toBe(true);
    }));
    expect(observeCalls).toHaveLength(1);
    const row=(await admin.query("select * from competition_decision_calls")).rows[0];
    expect(row.prompt_sha256).toBe(decisionRequestSha256({prompt:"synthetic",system:callOptions.systemPrompt,model:callOptions.model,maxTokens:callOptions.maxTokens,thinking:"enabled",reasoningEffort:"low",effortPolicySha256:effortPolicySha256(policy)}));
    expect(row).toMatchObject({operation:"competition_v7_rank",reasoning_effort:"low",effort_policy_sha256:effortPolicySha256(policy)});
    const saved=unsealV7<{receipt:Record<string,unknown>}>(`call:${row.call_id}`,row);
    expect(saved.receipt).toMatchObject({operation:"competition_v7_rank",thinking:"enabled",reasoningEffort:"low",effortPolicySha256:effortPolicySha256(policy)});
    expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(1);
  });
  it("rejects a direct policy switch even with an otherwise valid lease",async()=>{
    const created=await create(),lease=await claim();
    await expect(withDecisionEffortPolicy(DEFAULT_EFFORT_POLICY,()=>withDurableAiRun({runId:created.run.row.run_id,owner:lease.owner,fence:lease.fence,effortPolicySha256:effortPolicySha256(DEFAULT_EFFORT_POLICY)},()=>requestAiJson("switch",options())))).rejects.toThrow("DECISION_EFFORT_POLICY_CHANGED");
    expect((await admin.query("select count(*)::int as n from competition_decision_calls")).rows[0].n).toBe(0);
  });
  it("binds topP to one real reservation and durable receipt while refusing a changed sampling replay before spending",async()=>{
    const created=await create(),lease=await claim();syntheticFetch();
    const callOptions={...options(),topP:0.95};
    await withDecisionEffortPolicy(policy,()=>withDurableAiRun({runId:created.run.row.run_id,owner:lease.owner,fence:lease.fence,effortPolicySha256:effortPolicySha256(policy)},async()=>{
      expect((await requestAiJson("synthetic",callOptions)).ok).toBe(true);
      expect((await requestAiJson("synthetic",callOptions)).ok).toBe(true);
      await expect(requestAiJson("synthetic",{...callOptions,topP:1})).rejects.toThrow("durable_prompt_changed");
    }));
    expect(observeCalls).toHaveLength(1);expect(observeCalls[0]).toMatchObject({model:"deepseek-flash",top_p:0.95,thinking:{type:"enabled"},reasoning_effort:"low"});
    const row=(await admin.query("select * from competition_decision_calls")).rows[0];
    expect(row.prompt_sha256).toBe(decisionRequestSha256({prompt:"synthetic",system:callOptions.systemPrompt,model:callOptions.model,maxTokens:callOptions.maxTokens,topP:0.95,thinking:"enabled",reasoningEffort:"low",effortPolicySha256:effortPolicySha256(policy)}));
    const saved=unsealV7<{receipt:Record<string,unknown>}>(`call:${row.call_id}`,row);
    expect(saved.receipt).toMatchObject({topP:0.95,reasoningEffort:"low"});
    const ledger=(await admin.query("select state,charged_micros,input_tokens,output_tokens from ai_spend_ledger")).rows;
    expect(ledger).toHaveLength(1);expect(ledger[0]).toMatchObject({state:"usage_estimated",input_tokens:"20",output_tokens:"10"});expect(Number(ledger[0].charged_micros)).toBeGreaterThan(0);
  });
  it("keeps historical submitted clocks and original 45/90 cutoffs on replay after a new policy",async()=>{
    const origin=Date.now()-10000,created=await create(origin);
    expect(created.run.row.submitted_at.getTime()).toBe(origin);expect(created.run.row.list_deadline_at.getTime()).toBe(origin+45000);expect(created.run.row.detail_deadline_at.getTime()).toBe(origin+90000);
    configure(DEFAULT_EFFORT_POLICY);const replay=await enqueueRunV7({...created.input,submittedAtEpochMs:Date.now()+100000});
    expect(replay.run.row.run_id).toBe(created.run.row.run_id);expect(replay.run.row.submitted_at).toEqual(created.run.row.submitted_at);expect(replay.run.body.effortPolicy).toEqual(policy);
  });
  it("rejects future and elapsed new clocks without a persistent task",async()=>{
    await expect(create(Date.now()+100000)).rejects.toThrow("DECISION_SUBMISSION_TIME_INVALID");
    await expect(create(Date.now()-61000)).rejects.toThrow("LIST_DEADLINE_EXCEEDED");
    configure(DEFAULT_EFFORT_POLICY);const sessionId=randomUUID(),legacy=student();await expect(enqueueRunV7({sessionId,expiresAt:Date.now()-1,legacy,context:buildDecisionContextV7(legacy,{profileId:sessionId}),submissionKey:submissionKeyV7(sessionId,"expired"),submittedAtEpochMs:Date.now()-10000})).rejects.toThrow("DECISION_SESSION_EXPIRED");
    expect((await admin.query("select count(*)::int as n from competition_decision_runs")).rows[0].n).toBe(0);
  });
  it("atomically keeps trusted component diagnostics out of ordinary worker claims",async()=>{
    configure(DEFAULT_EFFORT_POLICY);
    const sessionId=randomUUID(),legacy=student(),context=buildDecisionContextV7(legacy,{profileId:sessionId});
    const created=await enqueueRunV7({sessionId,expiresAt:Date.now()+180000,legacy,context,submissionKey:submissionKeyV7(sessionId,"diagnostic"),diagnosticOnly:true});
    expect(created.run.row.implementation_version).toBe(RECOMMENDATION_DIAGNOSTIC_IMPLEMENTATION_VERSION_V7);
    expect(await claimRunV7("ordinary-worker")).toBeNull();
    expect((await readRunV7(created.run.row.run_id))?.row.status).toBe("queued");
  });
  it("rejects a policy-changing CAS and keeps the frozen body unchanged",async()=>{
    const created=await create(),lease=await claim();
    await expect(commitRunV7(lease,"ranking",{...lease.body,effortPolicy:DEFAULT_EFFORT_POLICY,effortPolicySha256:effortPolicySha256(DEFAULT_EFFORT_POLICY)})).rejects.toThrow("DECISION_RUN_BINDING_CHANGED");
    expect((await readRunV7(created.run.row.run_id))?.body.effortPolicy).toEqual(policy);
  });
  it("restores frozen scope for a worker lease after environment changes",async()=>{
    const created=await createTop5(),lease=(await claimRunV7("worker-scope"))!;configure(LEGACY_DEFAULT_EFFORT_POLICY);let captured:unknown;
    await processClaimedRunV7(lease,{rank:async()=>{captured=currentDecisionEffortPolicy();throw new Error("SYNTHETIC_STOP");},generate:async()=>{throw new Error("unexpected");},review:async()=>{throw new Error("unexpected");}});
    expect(captured).toEqual(DEFAULT_EFFORT_POLICY);expect((await readRunV7(created.run.row.run_id))?.body.effortPolicy).toEqual(DEFAULT_EFFORT_POLICY);
  });
  it("terminates a pre-policy body without transport or repeated reclamation",async()=>{
    const created=await createTop5(),body={...created.run.body} as Partial<typeof created.run.body>;delete body.effortPolicy;delete body.effortPolicySha256;
    const sealed=sealV7(`run:${created.run.row.run_id}`,body);await admin.query("update competition_decision_runs set ciphertext=$2,iv=$3,tag=$4 where run_id=$1",[created.run.row.run_id,sealed.ciphertext,sealed.iv,sealed.tag]);
    await processClaimedRunV7((await claimRunV7("old-worker"))!);
    const saved=(await readRunV7(created.run.row.run_id))!;expect(saved.row.status).toBe("failed");expect(saved.body.error).toBe("DECISION_IMPLEMENTATION_CHANGED");expect(await claimRunV7("again")).toBeNull();
  });
  it("keeps runtime unable to mint budgets, change authority or grant effort",async()=>{
    for(const sql of ["insert into ai_spend_budgets(run_id,hard_limit_micros) values('forbidden',1)","update ai_spend_authority set run_id=run_id","update ai_spend_development_batches set authorized_effort='stage'"])
      await expect(db.pool!.query(sql)).rejects.toMatchObject({code:"42501"});
  });
  it("preserves legacy max/high grants and bytes while old and new migrations replay",async()=>{
    await admin.query("update ai_spend_development_batches set state='closed',closed_at=now() where run_id=$1",[batch]);
    await admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros) values('legacy-max',10000),('legacy-high',10000)");
    await admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,state,closed_at,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,authorized_effort)
      values('legacy-max',$1,100,'closed',now(),10000,0,10000,'{}','synthetic legacy max','max')`,[main]);
    const condition={schemaVersion:"saitu.max-failure-budget-condition.v1",initialEffort:"max",nextPermittedEffort:"high",sourceRunId:"legacy-max",freshPgRowsVerified:true};
    await admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,state,closed_at,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition)
      values('legacy-high',$1,100,'closed',now(),10000,0,10000,'{}','synthetic legacy high','high',$2,$3)`,[main,sha(JSON.stringify(condition)),JSON.stringify(condition)]);
    const before=(await admin.query("select * from ai_spend_development_batches order by run_id")).rows;
    for(const name of ["20261106_ai_spend_development_effort.sql","20261109_spend_v7_batches.sql","20261109_spend_v7_effort_policy.sql","20261109_spend_v7_effort_policy.sql","20261109_spend_v7_top5_policy.sql","20261109_spend_user_unbounded_execution.sql"])
      await admin.query(readFileSync(`db/migrations/${name}`,"utf8"));
    expect((await admin.query("select * from ai_spend_development_batches order by run_id")).rows).toEqual(before);
  });
  it("still admits an old v7 high grant and rejects low without its new stage authorization",async()=>{
    await admin.query("update ai_spend_development_batches set state='closed',closed_at=now() where run_id=$1",[batch]);
    const oldRun="saitu-v7-20261109-calibration-92",policySha="b".repeat(64);
    const condition={schemaVersion:"saitu.user-approved-budget-condition.v7",model:"deepseek-flash",effort:"high",phase:"calibration",policySha256:policySha,authorization:"user-approved-20261109-continuation",freshPgRowsVerified:true};
    await admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,3000000)",[oldRun]);
    await admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256)
      values($1,$2,100,300000000,0,300000000,'{}','synthetic unchanged v7 high','high',$3,$4,'saitu.v7','calibration',$5)`,[oldRun,main,sha(JSON.stringify(condition)),JSON.stringify(condition),policySha]);
    configure(LEGACY_DEFAULT_EFFORT_POLICY);Object.assign(process.env,{AI_SPEND_RUN_ID:oldRun,AI_SPEND_PHASE:"calibration",AI_SPEND_AUTHORIZED_EFFORT:"high",AI_SPEND_HIGH_CONDITION_SHA256:sha(JSON.stringify(condition)),AI_SPEND_POLICY_SHA256:policySha});
    const accepted=await reserveAiSpend({...request(),effort:"high",effortPolicySha256:effortPolicySha256(LEGACY_DEFAULT_EFFORT_POLICY)});expect(accepted.ok).toBe(true);
    if(accepted.ok)await accepted.reservation.settle(undefined,false);
    expect(await withDecisionEffortPolicy(policy,()=>reserveAiSpend(request()))).toMatchObject({ok:false,reason:"spend_configuration_invalid"});
  });
  it("keeps the historical main calibration ceiling of 100 non-cancelled calls",async()=>{
    await admin.query("update ai_spend_development_batches set state='closed',closed_at=now() where run_id=$1",[batch]);
    await admin.query(`insert into ai_spend_ledger(id,run_id,model,effort,operation,price_version,reserved_micros,charged_micros,state,phase)
      select gen_random_uuid(),$1,'deepseek-flash','max','synthetic-history','synthetic',0,0,'conservative','calibration' from generate_series(1,100)`,[main]);
    Object.assign(process.env,{AI_SPEND_RUN_ID:main,AI_SPEND_PHASE:"calibration",AI_SPEND_AUTHORIZED_EFFORT:"max",AI_CALIBRATION_CALL_LIMIT:"100"});
    expect(await reserveAiSpend({system:"synthetic",prompt:"no provider",model:"deepseek-flash",maxTokens:32,effort:"max"})).toMatchObject({ok:false,reason:"spend_budget_exhausted"});
    expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(100);
  });
  it("rejects broadened or mismatched stage grants at the database boundary",async()=>{
    for(const sql of ["update ai_spend_development_batches set effort_policy=effort_policy||'{\"chat\":\"low\"}' where run_id=$1",
      "update ai_spend_development_batches set effort_condition=effort_condition-'mainRunId' where run_id=$1",
      "update ai_spend_development_batches set effort_policy_sha256=repeat('0',64) where run_id=$1",
      "update ai_spend_development_batches set authorized_effort='low' where run_id=$1"])
      await expect(admin.query(sql,[batch])).rejects.toMatchObject({code:"23514"});
  });
});
