import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import pg from "pg";
import {NextRequest} from "next/server";
const db=vi.hoisted(()=>({pool:undefined as pg.Pool|undefined}));
vi.mock("@/lib/db/pool",async importOriginal=>{const actual=await importOriginal<typeof import("@/lib/db/pool")>();return {
  getPool:()=>process.env.RUN_V7_TOP5_PRIVATE_PG==="1"?db.pool!:actual.getPool(),isDatabaseConfigured:()=>process.env.RUN_V7_TOP5_PRIVATE_PG==="1"?Boolean(db.pool):actual.isDatabaseConfigured()};});
vi.unmock("@/lib/ai/spend-ledger");
import {requestAiJson} from "@/lib/ai/ai-client";
import {reserveAiSpend} from "@/lib/ai/spend-ledger";
import {withAiSpendLimit} from "@/lib/ai/spend-run-context";
import {withDurableAiChat,withDurableAiRun} from "@/lib/ai/durable-call";
import {DEFAULT_EFFORT_POLICY,effortPolicySha256} from "@/lib/ai/effort-policy.mjs";
import {USER_UNBOUNDED_EXECUTION_LIMITS,USER_UNBOUNDED_GRANT_VERSION,COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY,COMPACT_RECOMMENDATION_AUTHORIZATION} from "@/lib/ai/execution-policy.mjs";
import {createUserUnboundedValidationTokenV7,isAuthorizedUserUnboundedValidationRequestV7,readUserUnboundedExecutionAuthorizationV7,USER_UNBOUNDED_VALIDATION_HEADER_V7} from "@/lib/ai/execution-authorization";
import {getModelCallGovernorConfigurationSnapshot} from "@/lib/ai/model-call-governor";
import {buildDecisionContextV7} from "@/lib/competitions/v7/model";
import {claimRunV7,commitRunV7,enqueueRunV7,presentRunV7,readRunV7,submissionKeyV7} from "@/lib/competitions/v7/store";
import {processClaimedRunV7} from "@/lib/competitions/v7/worker";
import {getPool} from "@/lib/db/pool";
import {createV7TestDatabase} from "../helpers/v7-database-environment";
import {student} from "../competitions/v6/decision-fixtures";

const privateMode=process.env.RUN_V7_TOP5_PRIVATE_PG==="1",run=privateMode||process.env.RUN_V7_DATABASE_TESTS==="1"?describe:describe.skip;
const main="synthetic-unbounded-main",batch="saitu-v7-top5-unbounded-20261109-calibration-91",sha=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
run("explicit user-unbounded authority with actual disposable PostgreSQL and synthetic transport",()=>{
  const original={...process.env};let admin:pg.Client,fixture:Awaited<ReturnType<typeof createV7TestDatabase>>|undefined;
  const policy=DEFAULT_EFFORT_POLICY,policyHash=effortPolicySha256(policy),conditionHash=sha("Synthetic new condition");
  async function grant(){
    const policySha=sha(readFileSync("docs/v7/top5-unbounded-execution-contract-20261109.md"));
    const condition={schemaVersion:"saitu.user-approved-budget-condition.v7.top5.user-unbounded.v1",authorization:"user-approved-20261109-top5-unbounded-execution",sourcePolicy:"docs/v7/top5-unbounded-execution-contract-20261109.md",executionMode:"user-unbounded",executionLimits:USER_UNBOUNDED_EXECUTION_LIMITS,
      policyVersion:"saitu.policy.2026-11-09.v7.top5",implementationVersion:"saitu.async.2026-11-09.v7.3.top5",model:"deepseek-flash",effort:"stage",phase:"calibration",mainRunId:main,policySha256:policySha,effortPolicy:policy,effortPolicySha256:policyHash,freshPgRowsVerified:true,priorLedgerSha256:sha("[]")};
    await admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros,execution_mode) values($1,300000000,null),($2,null,'user-unbounded')",[main,batch]);
    await admin.query("insert into ai_spend_authority(singleton,run_id) values(true,$1)",[main]);
    await admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256,effort_policy,effort_policy_sha256,execution_mode)
      values($1,$2,null,10000000,0,10000000,'{}','Synthetic explicit user-unbounded authority','stage',$3,$4,$5,'calibration',$6,$7,$8,'user-unbounded')`,[batch,main,conditionHash,JSON.stringify(condition),USER_UNBOUNDED_GRANT_VERSION,policySha,JSON.stringify(policy),policyHash]);
    Object.assign(process.env,{SAITU_AI_EXECUTION_MODE:"user-unbounded",AI_SPEND_RUN_ID:batch,AI_SPEND_PHASE:"calibration",AI_SPEND_AUTHORIZED_EFFORT:"stage",AI_SPEND_EFFORT_CONDITION_SHA256:conditionHash,AI_SPEND_POLICY_SHA256:policySha,
      SAITU_V7_EFFORT_POLICY:JSON.stringify(policy),SAITU_V7_EFFORT_POLICY_SHA256:policyHash,AI_CONCURRENCY_MAX:"1",AI_QUEUE_MAX:"1",AI_MODEL_CALLS_PER_DAY:"1",AI_CALIBRATION_CALL_LIMIT:"1",AI_SPEND_LIMIT_CNY:"0.000001",AI_SPEND_FUNDED_CNY:"0.000001"});
  }
  const spend=()=>reserveAiSpend({system:"Synthetic",prompt:"Synthetic",maxTokens:32,model:"deepseek-flash",effort:"low",operation:"competition_v7_rank",effortPolicySha256:policyHash});
  const options={operation:"competition_v7_rank",systemPrompt:"Synthetic",maxTokens:32,maxAttempts:1 as const,diagnosticContext:{invocationId:"synthetic-unbounded",stage:"v7.rank",reviewId:"effort-v1.initial"}};
  async function create(){const sessionId=randomUUID(),legacy=student(),context=buildDecisionContextV7(legacy,{profileId:sessionId});const input={sessionId,legacy,context,expiresAt:Date.now()+180000,submissionKey:submissionKeyV7(sessionId,"initial")};return {...await enqueueRunV7(input),input,context};}
  beforeAll(async()=>{
    if(privateMode){const filename=process.env.V7_TOP5_PRIVATE_CONFIG??"";expect(filename).toMatch(/^\/(?:private\/)?tmp\/saitu-top5-c-[A-Za-z0-9]+\/client\.json$/);const config=JSON.parse(readFileSync(filename,"utf8"));
      expect(config.database).toMatch(/^top5_private_[a-f0-9]{16}$/);expect(config.port).toBe(55479);admin=new pg.Client({host:config.host,port:config.port,user:"top5_admin",database:config.database});await admin.connect();
      expect((await admin.query("select current_database() as db,session_user as role,current_setting('unix_socket_directories') as socket,current_setting('listen_addresses') as addresses")).rows[0]).toEqual({db:config.database,role:"top5_admin",socket:config.host,addresses:""});
      expect((await admin.query("select nonce from top5_test_control")).rows[0].nonce).toBe(config.nonce);db.pool=new pg.Pool({host:config.host,port:config.port,user:config.runtime,database:config.database,max:10});
    }else {fixture=await createV7TestDatabase("durable");admin=fixture.admin;process.env.DATABASE_URL=fixture.runtimeUrl;db.pool=getPool();}
    // Private multi-suite rehearsal shares only this owned disposable cluster;
    // legacy migration replay scenarios may leave an intentionally older CHECK.
    await admin.query(readFileSync("db/migrations/20261109_spend_user_unbounded_execution.sql","utf8"));
    await admin.query(readFileSync("db/migrations/20261110_compact_rank_high_authority.sql","utf8"));
    vi.spyOn(console,"info").mockImplementation(()=>undefined);vi.spyOn(console,"warn").mockImplementation(()=>undefined);vi.spyOn(console,"error").mockImplementation(()=>undefined);
  });
  beforeEach(async()=>{
    await admin.query("truncate competition_decision_chat_requests,competition_decision_calls,competition_decision_runs,competition_decision_states,ai_spend_ledger,ai_spend_development_batches,ai_spend_authority,ai_spend_budgets,ai_model_call_leases,ai_model_call_waiters,ai_model_daily_usage");
    process.env={...original};Object.assign(process.env,{NODE_ENV:"test",AI_PROVIDER:"deepseek",AI_API_KEY:"synthetic-never-sent",AI_CONVERSATION_SIGNING_SECRET:"synthetic-unbounded-secret-0000000000",SAITU_V7_SOURCE_SHA256:"c".repeat(64)});if(fixture)process.env.DATABASE_URL=fixture.runtimeUrl;
    vi.stubGlobal("fetch",()=>{throw new Error("live_provider_forbidden");});await grant();
  });
  afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
  afterAll(async()=>{await db.pool?.end();db.pool=undefined;delete (globalThis as typeof globalThis&{__pgPool?:pg.Pool}).__pgPool;if(fixture)await fixture.close();else await admin?.end();process.env={...original};vi.restoreAllMocks();});

  it("requires explicit null limits and the active new authorization, not an environment switch alone",async()=>{
    expect(await readUserUnboundedExecutionAuthorizationV7()).toMatchObject({runId:batch,mainRunId:main});
    expect(getModelCallGovernorConfigurationSnapshot()).toMatchObject({executionMode:"user-unbounded",transportConcurrencyHardMax:null,transportConcurrencyEffectiveMax:null,dailyCallLimit:null});
    for(const sql of ["update ai_spend_development_batches set call_limit=1000 where run_id=$1","update ai_spend_development_batches set execution_mode=null where run_id=$1","update ai_spend_budgets set hard_limit_micros=100000000 where run_id=$1"])
      await expect(admin.query(sql,[batch])).rejects.toMatchObject({code:"23514"});
    process.env.AI_SPEND_RUN_ID=main;expect(await spend()).toMatchObject({ok:false,reason:"spend_configuration_invalid"});expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(0);
  });
  it("permits six actual concurrent transports despite all old numeric caps being one and observes every call",async()=>{
    let active=0,peak=0,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
    vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init:RequestInit)=>{const body=JSON.parse(String(init.body));expect(body.reasoning_effort).toBe("low");expect(body.thinking.type).toBe("enabled");active+=1;peak=Math.max(peak,active);await held;active-=1;
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:'{"ok":true}'}}],usage:{prompt_tokens:20,completion_tokens:10,prompt_cache_hit_tokens:0}}));}));
    const attempts=withAiSpendLimit(0,()=>Promise.all(Array.from({length:6},(_,i)=>requestAiJson(`Synthetic ${i}`,options))));
    try{for(let i=0;i<200&&peak<6;i++)await new Promise(resolve=>setTimeout(resolve,10));expect(peak).toBe(6);}finally{release();}
    expect((await attempts).every(value=>value.ok)).toBe(true);expect(fetch).toHaveBeenCalledTimes(6);
    expect((await admin.query("select call_count from ai_model_daily_usage where bucket='global'")).rows[0].call_count).toBe(6);
    expect((await admin.query("select count(*)::int as n from ai_spend_ledger where state='usage_estimated'")).rows[0].n).toBe(6);
  });
  it("waits beyond the former 1.5 second global budget lock window and dispatches only once",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:'{"ok":true}'}}],usage:{prompt_tokens:20,completion_tokens:10,prompt_cache_hit_tokens:0}}))));
    await admin.query("select pg_advisory_lock(724310896145225::bigint)");
    const started=Date.now(),pending=requestAiJson("Synthetic held budget lock",{...options,deadlineEpochMs:started+10000,timeoutMs:10000});
    try{
      await new Promise(resolve=>setTimeout(resolve,1650));
      expect(fetch).not.toHaveBeenCalled();expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(0);
    }finally{await admin.query("select pg_advisory_unlock(724310896145225::bigint)");}
    expect(await pending).toMatchObject({ok:true,upstreamAttempted:true});expect(Date.now()-started).toBeGreaterThanOrEqual(1650);
    expect(fetch).toHaveBeenCalledTimes(1);expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(1);
  });
  it("stops budget-lock admission at the caller deadline or abort without creating a reservation",async()=>{
    await admin.query("select pg_advisory_lock(724310896145225::bigint)");
    try{
      const started=Date.now(),abort=new AbortController();
      const request={system:"Synthetic",prompt:"no HTTP before reservation",maxTokens:32,model:"deepseek-flash",effort:"low",operation:"competition_v7_rank",effortPolicySha256:policyHash};
      const expired=reserveAiSpend({...request,deadlineEpochMs:started+150});
      const cancelled=reserveAiSpend({...request,deadlineEpochMs:started+5000,signal:abort.signal});
      setTimeout(()=>abort.abort(),50);
      expect(await Promise.all([expired,cancelled])).toEqual([{ok:false,reason:"spend_store_unavailable"},{ok:false,reason:"spend_store_unavailable"}]);
      expect(Date.now()-started).toBeLessThan(1000);expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(0);
    }finally{await admin.query("select pg_advisory_unlock(724310896145225::bigint)");}
  });
  it("does not reinstate legacy 100 or 1000 total-call ceilings while preserving physical funding protection",async()=>{
    await admin.query(`insert into ai_spend_ledger(id,run_id,model,effort,operation,price_version,reserved_micros,charged_micros,state,phase,effort_policy_sha256)
      select gen_random_uuid(),$1,'deepseek-flash','low','synthetic-history','synthetic',0,0,'usage_estimated','calibration',$2 from generate_series(1,1001)`,[batch,policyHash]);
    const reserved=await withAiSpendLimit(0,spend);expect(reserved.ok).toBe(true);if(reserved.ok)await reserved.reservation.settle(undefined,false);
    await admin.query(`insert into ai_spend_ledger(id,run_id,model,effort,operation,price_version,reserved_micros,charged_micros,state,phase) values($1,$2,'deepseek-flash','low','synthetic-unknown','synthetic',9999999,9999999,'conservative','calibration')`,[randomUUID(),batch]);
    const before=(await admin.query("select * from ai_spend_ledger where operation='synthetic-unknown'")).rows;
    expect(await spend()).toMatchObject({ok:false,reason:"spend_budget_exhausted"});expect((await admin.query("select * from ai_spend_ledger where operation='synthetic-unknown'")).rows).toEqual(before);
  });
  it("freezes the new mode and grant on a run and never claims or pays an old finite run",async()=>{
    process.env.SAITU_AI_EXECUTION_MODE="finite";const historical=await create();delete historical.run.body.executionMode;
    process.env.SAITU_AI_EXECUTION_MODE="user-unbounded";expect(await claimRunV7("new-worker-only")).toBeNull();
    expect(()=>withDurableAiChat(historical.run.row.run_id,historical.session.generation,"old-chat",()=>Promise.resolve())).toThrow("DECISION_EXECUTION_MODE_CHANGED");
    const created=await create(),lease=(await claimRunV7("new-mode-worker"))!;expect(lease.row.run_id).toBe(created.run.row.run_id);
    expect(created.run.body.executionMode).toBe("user-unbounded");expect(created.run.body.executionAuthorization?.runId).toBe(batch);expect(presentRunV7(created.run,created.session).executionLimits).toEqual(USER_UNBOUNDED_EXECUTION_LIMITS);
    await expect(commitRunV7(lease,"ranking",{...lease.body,executionMode:"finite"})).rejects.toThrow("DECISION_RUN_BINDING_CHANGED");
    await processClaimedRunV7(lease,{rank:async()=>{throw new Error("SYNTHETIC_STOP");},generate:vi.fn(),review:vi.fn()});
    expect((await readRunV7(historical.run.row.run_id))?.row.status).toBe("queued");expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(0);
  });
  it("retains one unknown charge and refuses paid retry under a new key or changed execution mode",async()=>{
    const created=await create(),lease=(await claimRunV7("unknown-new-mode"))!;await commitRunV7(lease,"ranking",lease.body);
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("synthetic_disconnect");}));
    const scope={runId:created.run.row.run_id,owner:lease.owner,fence:lease.fence,executionMode:"user-unbounded" as const,authorizationRunId:batch,effortPolicySha256:policyHash};
    await withDurableAiRun(scope,async()=>{
      expect(await requestAiJson("Synthetic",options)).toMatchObject({ok:false,reason:"network_error",upstreamAttempted:true});
      expect(await requestAiJson("new-key",{...options,diagnosticContext:{...options.diagnosticContext,reviewId:"next-key"}})).toMatchObject({ok:false,reason:"durable_outcome_unknown"});
    });
    process.env.SAITU_AI_EXECUTION_MODE="finite";expect(()=>withDurableAiRun(scope,()=>Promise.resolve())).toThrow("DECISION_EXECUTION_MODE_CHANGED");
    expect(fetch).toHaveBeenCalledTimes(1);expect((await admin.query("select state,charged_micros=reserved_micros as held from ai_spend_ledger")).rows).toEqual([{state:"conservative",held:true}]);
  });
  it("accepts only short-lived signed loopback validation requests combined with the same active DB grant",async()=>{
    const origin="http://localhost:3000",token=createUserUnboundedValidationTokenV7(origin,Date.now()+30000),request=new Request(`${origin}/api/test`,{headers:{[USER_UNBOUNDED_VALIDATION_HEADER_V7]:token}});
    expect(await isAuthorizedUserUnboundedValidationRequestV7(request)).toBe(true);
    for(const host of ["localhost","127.0.0.1","[::1]"]){
      const localToken=createUserUnboundedValidationTokenV7(`http://${host}:3000`,Date.now()+30000);
      expect(await isAuthorizedUserUnboundedValidationRequestV7(new NextRequest(`http://${host}:3000/api/test`,{headers:{[USER_UNBOUNDED_VALIDATION_HEADER_V7]:localToken}}))).toBe(true);
    }
    expect(await isAuthorizedUserUnboundedValidationRequestV7(new NextRequest("http://127.0.0.1:3001/api/test",{headers:{[USER_UNBOUNDED_VALIDATION_HEADER_V7]:token}}))).toBe(false);
    expect(await isAuthorizedUserUnboundedValidationRequestV7(new NextRequest("https://127.0.0.1:3000/api/test",{headers:{[USER_UNBOUNDED_VALIDATION_HEADER_V7]:token}}))).toBe(false);
    expect(await isAuthorizedUserUnboundedValidationRequestV7(new Request(`${origin}/api/test`))).toBe(false);
    expect(await isAuthorizedUserUnboundedValidationRequestV7(new Request(`${origin}/api/test`,{headers:{[USER_UNBOUNDED_VALIDATION_HEADER_V7]:`${token}x`}}))).toBe(false);
    expect(await isAuthorizedUserUnboundedValidationRequestV7(new Request("https://example.com/api/test",{headers:{[USER_UNBOUNDED_VALIDATION_HEADER_V7]:token}}))).toBe(false);
    expect(()=>createUserUnboundedValidationTokenV7("https://example.com")).toThrow("VALIDATION_EXECUTION_INVALID");
    await admin.query("update ai_spend_development_batches set state='closed',closed_at=now() where run_id=$1",[batch]);expect(await isAuthorizedUserUnboundedValidationRequestV7(request)).toBe(false);
    expect(await isAuthorizedUserUnboundedValidationRequestV7(new NextRequest("http://127.0.0.1:3000/api/test",{headers:{[USER_UNBOUNDED_VALIDATION_HEADER_V7]:token}}))).toBe(false);
  });
  it("treats a provider 429 as a single real result without unlimited retry",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response('{}',{status:429})));expect(await requestAiJson("Synthetic",options)).toMatchObject({ok:false,reason:"rate_limited",upstreamAttempted:true});expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("creates a separate compact HLL grant, dispatches its frozen stage efforts and preserves the old LLL run",async()=>{
    const old=await create(),oldBytes=(await admin.query("select * from competition_decision_runs where run_id=$1",[old.run.row.run_id])).rows[0];
    await admin.query("update ai_spend_development_batches set state='closed',closed_at=now() where run_id=$1",[batch]);
    const newBatch="saitu-v7-top5-unbounded-20261109-calibration-92",highPolicy={...policy,rank:"high" as const},highHash=effortPolicySha256(highPolicy),policySha=sha(readFileSync(COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY));
    const condition={schemaVersion:"saitu.user-approved-budget-condition.v7.top5.user-unbounded.v1",authorization:COMPACT_RECOMMENDATION_AUTHORIZATION,sourcePolicy:COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY,
      executionMode:"user-unbounded",executionLimits:USER_UNBOUNDED_EXECUTION_LIMITS,policyVersion:"saitu.policy.2026-11-09.v7.top5",implementationVersion:"saitu.async.2026-11-09.v7.3.top5",model:"deepseek-flash",effort:"stage",phase:"calibration",mainRunId:main,policySha256:policySha,effortPolicy:highPolicy,effortPolicySha256:highHash,freshPgRowsVerified:true,priorLedgerSha256:sha("[]")};
    await admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros,execution_mode) values($1,null,'user-unbounded')",[newBatch]);
    await admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256,effort_policy,effort_policy_sha256,execution_mode)
      values($1,$2,null,10000000,0,10000000,'{}','Synthetic compact HLL authority','stage',$3,$4,$5,'calibration',$6,$7,$8,'user-unbounded')`,[newBatch,main,sha(JSON.stringify(condition)),JSON.stringify(condition),USER_UNBOUNDED_GRANT_VERSION,policySha,JSON.stringify(highPolicy),highHash]);
    const originalGrant=(await admin.query("select * from ai_spend_development_batches where run_id=$1",[batch])).rows;
    for(const patch of [{sourcePolicy:"docs/v7/top5-unbounded-execution-contract-20261109.md"},{authorization:"user-approved-20261109-top5-unbounded-execution"}])
      await expect(admin.query("update ai_spend_development_batches set effort_condition=effort_condition||$2::jsonb where run_id=$1",[newBatch,JSON.stringify(patch)])).rejects.toMatchObject({code:"23514"});
    for(const stage of ["explain","review"])
      await expect(admin.query("update ai_spend_development_batches set effort_policy=effort_policy||$2::jsonb,effort_condition=jsonb_set(effort_condition,'{effortPolicy}',effort_policy||$2::jsonb) where run_id=$1",[newBatch,JSON.stringify({[stage]:"high"})])).rejects.toMatchObject({code:"23514"});
    for(const field of ["version","rank","explain","review"])
      await expect(admin.query("update ai_spend_development_batches set effort_policy=effort_policy-$2::text,effort_condition=jsonb_set(effort_condition,'{effortPolicy}',effort_policy-$2::text) where run_id=$1",[newBatch,field])).rejects.toMatchObject({code:"23514"});
    for(const sql of ["update ai_spend_development_batches set effort_condition=null where run_id=$1","update ai_spend_development_batches set authorized_phase=null where run_id=$1","update ai_spend_development_batches set effort_condition=effort_condition-'phase' where run_id=$1"])
      await expect(admin.query(sql,[newBatch])).rejects.toThrow();
    Object.assign(process.env,{AI_SPEND_RUN_ID:newBatch,AI_SPEND_POLICY_SHA256:policySha,AI_SPEND_EFFORT_CONDITION_SHA256:sha(JSON.stringify(condition)),SAITU_V7_EFFORT_POLICY:JSON.stringify(highPolicy),SAITU_V7_EFFORT_POLICY_SHA256:highHash,SAITU_V7_DETAIL_LAYOUT:"parallel-2",SAITU_V7_SOURCE_SHA256:"d".repeat(64)});
    expect(await readUserUnboundedExecutionAuthorizationV7()).toMatchObject({runId:newBatch,effortPolicySha256:highHash});
    const upstream:Record<string,unknown>[]=[];
    vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init:RequestInit)=>{upstream.push(JSON.parse(String(init.body)));return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:'{"ok":true}'}}],usage:{prompt_tokens:20,completion_tokens:10,prompt_cache_hit_tokens:0}}));}));
    for(const operation of ["competition_v7_rank","competition_v7_explain","competition_v7_review","competition_v7_extract","competition_v7_chat"])
      expect(await requestAiJson("Synthetic compact",{...options,operation})).toMatchObject({ok:true});
    expect(upstream.map(row=>row.reasoning_effort)).toEqual(["high","low","low","high","high"]);
    expect(upstream.every(row=>(row.thinking as {type:string}).type==="enabled")).toBe(true);
    const created=await create();expect(created.run.body.effortPolicy).toEqual(highPolicy);expect(created.run.body.detailLayout).toBe("parallel-2");
    const replay=await enqueueRunV7(old.input);expect(replay.run.body.effortPolicy).toEqual(policy);expect(replay.run.body.detailLayout).toBe("single");
    expect((await admin.query("select * from competition_decision_runs where run_id=$1",[old.run.row.run_id])).rows[0]).toEqual(oldBytes);
    expect((await admin.query("select * from ai_spend_development_batches where run_id=$1",[batch])).rows).toEqual(originalGrant);
    const staleLease=(await claimRunV7("compact-old-source-worker"))!,neverRank=vi.fn();
    expect(staleLease.row.run_id).toBe(old.run.row.run_id);
    await processClaimedRunV7(staleLease,{rank:neverRank,generate:vi.fn(),review:vi.fn()});
    expect(neverRank).not.toHaveBeenCalled();expect((await readRunV7(old.run.row.run_id))?.body.effortPolicy).toEqual(policy);
    const lease=(await claimRunV7("compact-high-worker"))!;expect(lease.row.run_id).toBe(created.run.row.run_id);
    await processClaimedRunV7(lease,{rank:async context=>{
      expect(await requestAiJson("Synthetic frozen HLL worker",options)).toMatchObject({ok:true});
      return {profileRevision:context.profile.revision,catalogVersion:context.catalogVersion,recommendations:[],shortfallReason:"Synthetic no-match worker contract case."};
    },generate:vi.fn(),review:vi.fn()});
    expect((await readRunV7(created.run.row.run_id))?.row.status).toBe("list_ready");
    expect(upstream).toHaveLength(6);expect(upstream[5].reasoning_effort).toBe("high");
  });
  it("preserves original authority, grants and unknown ledger rows while the forward migration replays",async()=>{
    const result=await spend();expect(result.ok).toBe(true);if(result.ok)await result.reservation.settle(undefined,true);
    const snapshot=async()=>({authority:(await admin.query("select * from ai_spend_authority")).rows,budgets:(await admin.query("select * from ai_spend_budgets order by run_id")).rows,grants:(await admin.query("select * from ai_spend_development_batches order by run_id")).rows,ledger:(await admin.query("select * from ai_spend_ledger order by id")).rows});
    const before=await snapshot();await admin.query(readFileSync("db/migrations/20261109_spend_user_unbounded_execution.sql","utf8"));expect(await snapshot()).toEqual(before);
  });
});
