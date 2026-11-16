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
import {withDecisionEffortPolicy} from "@/lib/ai/effort-context";
import {DEFAULT_EFFORT_POLICY,RANK_NON_THINKING_EFFORT_POLICY,decisionRequestSha256,effortPolicySha256,type DecisionEffortPolicy} from "@/lib/ai/effort-policy.mjs";
import {readDurableDecisionJournalV7,withDurableAiRun} from "@/lib/ai/durable-call";
import {withProductObservation,type ProductObservation} from "@/lib/ai/product-observation";
import {USER_UNBOUNDED_EXECUTION_LIMITS,USER_UNBOUNDED_GRANT_VERSION,COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY,COMPACT_RECOMMENDATION_AUTHORIZATION,RANK_NONTHINKING_AUTHORIZATION_POLICY,RANK_NONTHINKING_AUTHORIZATION,RANK_NONTHINKING_TRIAL_ID,RANK_NONTHINKING_TRIAL_SLOTS} from "@/lib/ai/execution-policy.mjs";
import {buildDecisionContextV7} from "@/lib/competitions/v7/model";
import {claimRunV7,commitRunV7,enqueueRunV7,submissionKeyV7} from "@/lib/competitions/v7/store";
import {RECOMMENDATION_IMPLEMENTATION_VERSION,RECOMMENDATION_POLICY_VERSION} from "@/lib/competitions/v7/contracts";
import {sealV7,unsealV7} from "@/lib/competitions/v7/crypto";
import {student} from "../competitions/v6/decision-fixtures";

const enabled=process.env.RUN_V7_TOP5_PRIVATE_PG==="1",run=enabled?describe:describe.skip;
const main="synthetic-non-thinking-main",batch="saitu-v7-top5-unbounded-20261109-calibration-93",original={...process.env};
const sha=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex"),policy=RANK_NON_THINKING_EFFORT_POLICY,policyHash=effortPolicySha256(policy);
const clearSql="truncate competition_decision_chat_requests,competition_decision_calls,competition_decision_runs,competition_decision_states,ai_spend_ledger,ai_spend_development_batches,ai_spend_authority,ai_spend_budgets,ai_model_call_leases,ai_model_call_waiters,ai_model_daily_usage";
run("rank non-thinking authority, actual HTTP serializer and durable records on owned socket PostgreSQL",()=>{
  let admin:pg.Client;
  let config:{host:string;port:number;database:string;runtime:string;dataDirectory:string;nonce:string};
  const bodies:Record<string,unknown>[]=[];
  async function guard(){
    expect((await admin.query("select current_database() as db,session_user as role,current_setting('unix_socket_directories') as socket,current_setting('data_directory') as data,current_setting('listen_addresses') as addresses")).rows[0]).toEqual({db:config.database,role:"top5_admin",socket:config.host,data:config.dataDirectory,addresses:""});
    expect((await admin.query("select nonce from top5_test_control")).rows[0].nonce).toBe(config.nonce);
  }
  function configure(value:DecisionEffortPolicy){Object.assign(process.env,{SAITU_V7_EFFORT_POLICY:JSON.stringify(value),SAITU_V7_EFFORT_POLICY_SHA256:effortPolicySha256(value)});}
  async function grant(value:DecisionEffortPolicy=policy){
    const nonThinking=value.version==="saitu.effort-policy.v2",sourcePolicy=nonThinking?RANK_NONTHINKING_AUTHORIZATION_POLICY:COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY;
    const policySha256=sha(readFileSync(sourcePolicy));
    const condition={schemaVersion:"saitu.user-approved-budget-condition.v7.top5.user-unbounded.v1",model:"deepseek-flash",effort:"stage",phase:"calibration",mainRunId:main,
      policySha256,sourcePolicy,authorization:nonThinking?RANK_NONTHINKING_AUTHORIZATION:COMPACT_RECOMMENDATION_AUTHORIZATION,
      policyVersion:RECOMMENDATION_POLICY_VERSION,implementationVersion:RECOMMENDATION_IMPLEMENTATION_VERSION,effortPolicy:value,effortPolicySha256:effortPolicySha256(value),
      freshPgRowsVerified:true,priorLedgerSha256:sha("[]"),executionMode:"user-unbounded",executionLimits:USER_UNBOUNDED_EXECUTION_LIMITS,
      ...(nonThinking?{rankModelSettings:{thinking:"disabled",policyReasoningEffort:"low",wireReasoningEffort:null,temperature:0,topP:1},developmentTrial:{id:RANK_NONTHINKING_TRIAL_ID,maxReports:3,slotIds:[...RANK_NONTHINKING_TRIAL_SLOTS]},pilotContinuation:null}:{})};
    const conditionHash=sha(JSON.stringify(condition));
    await admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros,execution_mode) values($1,300000000,null),($2,null,'user-unbounded')",[main,batch]);
    await admin.query("insert into ai_spend_authority(singleton,run_id) values(true,$1)",[main]);
    await admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256,effort_policy,effort_policy_sha256,execution_mode)
      values($1,$2,null,10000000,0,10000000,'{}','Synthetic rank-only non-thinking authority','stage',$3,$4::jsonb,$5,'calibration',$6,$7::jsonb,$8,'user-unbounded')`,
      [batch,main,conditionHash,JSON.stringify(condition),USER_UNBOUNDED_GRANT_VERSION,policySha256,JSON.stringify(value),effortPolicySha256(value)]);
    configure(value);Object.assign(process.env,{AI_SPEND_RUN_ID:batch,AI_SPEND_PHASE:"calibration",AI_SPEND_AUTHORIZED_EFFORT:"stage",AI_SPEND_EFFORT_CONDITION_SHA256:conditionHash,AI_SPEND_POLICY_SHA256:policySha256});
  }
  async function create(){
    const sessionId=randomUUID(),legacy=student(),context=buildDecisionContextV7(legacy,{profileId:sessionId});
    const created=await enqueueRunV7({sessionId,legacy,context,expiresAt:Date.now()+180000,submissionKey:submissionKeyV7(sessionId,"initial")});
    const lease=(await claimRunV7("synthetic-non-thinking-worker"))!;expect(lease).not.toBeNull();await commitRunV7(lease,"ranking",lease.body);
    return {created,lease};
  }
  const options=()=>({operation:"competition_v7_rank",model:"deepseek-flash",systemPrompt:"Synthetic system",promptVersion:"synthetic-rank-non-thinking",maxTokens:32,maxAttempts:1 as const,
    thinking:"disabled" as const,reasoningEffort:"low" as const,temperature:0,topP:1,recommendationPolicyVersion:RECOMMENDATION_POLICY_VERSION,implementationVersion:RECOMMENDATION_IMPLEMENTATION_VERSION,
    diagnosticContext:{invocationId:"synthetic-non-thinking",stage:"v7.rank",reviewId:"effort-v1.initial"}});
  const scope=(lease:Awaited<ReturnType<typeof claimRunV7>> & {})=>({runId:lease.row.run_id,owner:lease.owner,fence:lease.fence,effortPolicySha256:policyHash,executionMode:"user-unbounded" as const,authorizationRunId:batch,
    requestVersion:{recommendationPolicyVersion:RECOMMENDATION_POLICY_VERSION,implementationVersion:RECOMMENDATION_IMPLEMENTATION_VERSION}});
  function transport(){vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init:RequestInit)=>{
    bodies.push(JSON.parse(String(init.body)));return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:'{"ok":true}'}}],usage:{prompt_tokens:20,completion_tokens:10,prompt_cache_hit_tokens:5}}));
  }));}
  beforeAll(async()=>{
    const filename=process.env.V7_TOP5_PRIVATE_CONFIG??"";expect(filename).toMatch(/^\/(?:private\/)?tmp\/saitu-top5-c-[A-Za-z0-9]+\/client\.json$/);config=JSON.parse(readFileSync(filename,"utf8"));expect(config.database).toMatch(/^top5_private_[a-f0-9]{16}$/);expect(config.port).toBe(55479);
    admin=new pg.Client({host:config.host,port:config.port,user:"top5_admin",database:config.database});await admin.connect();await guard();
    // Older regression suites intentionally replay a pre-compact CHECK in this
    // disposable cluster. Rebuild only its stale marker before the new upgrade.
    const expression=(await admin.query("select pg_get_expr(conbin,conrelid) as expression from pg_constraint where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_development_effort_evidence_check'")).rows[0].expression as string;
    if(!expression.includes(COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY))await admin.query("alter table ai_spend_development_batches drop constraint if exists ai_spend_compact_effort_forward_check");
    await admin.query(readFileSync("db/migrations/20261110_compact_rank_high_authority.sql","utf8"));
    await admin.query(readFileSync("db/migrations/20261110_rank_nonthinking_authority.sql","utf8"));
    db.pool=new pg.Pool({host:config.host,port:config.port,user:config.runtime,database:config.database,max:10});
    vi.spyOn(console,"info").mockImplementation(()=>undefined);vi.spyOn(console,"warn").mockImplementation(()=>undefined);vi.spyOn(console,"error").mockImplementation(()=>undefined);
  });
  beforeEach(async()=>{
    await guard();await admin.query(clearSql);process.env={...original};Object.assign(process.env,{NODE_ENV:"test",AI_PROVIDER:"deepseek",AI_API_KEY:"synthetic-never-sent",AI_MODEL:"deepseek-flash",SAITU_AI_EXECUTION_MODE:"user-unbounded",AI_CONVERSATION_SIGNING_SECRET:"synthetic-non-thinking-secret-000000000000",SAITU_V7_SOURCE_SHA256:"d".repeat(64)});
    bodies.length=0;vi.stubGlobal("fetch",()=>{throw new Error("live_provider_forbidden");});await grant();
  });
  afterEach(()=>{vi.unstubAllGlobals();});
  afterAll(async()=>{if(admin){await guard();await admin.query(clearSql);}await db.pool?.end();db.pool=undefined;await admin?.end();process.env={...original};vi.restoreAllMocks();});

  it("persists exact disabled wire settings, policy ledger classification and canonical hash, then replays once",async()=>{
    transport();const {lease}=await create(),events:ProductObservation[]=[];
    const result=await withProductObservation({observer:event=>{events.push(event);}},()=>withDecisionEffortPolicy(policy,()=>withDurableAiRun(scope(lease),()=>requestAiJson("Synthetic private rank",options()))));
    expect(result.ok).toBe(true);expect(bodies).toHaveLength(1);expect(bodies[0]).toMatchObject({thinking:{type:"disabled"},temperature:0,top_p:1});expect(bodies[0]).not.toHaveProperty("reasoning_effort");
    const row=(await admin.query("select * from competition_decision_calls where run_id=$1",[lease.row.run_id])).rows[0];
    const expectedHash=decisionRequestSha256({prompt:"Synthetic private rank",system:"Synthetic system",model:"deepseek-flash",maxTokens:32,promptVersion:options().promptVersion,thinking:"disabled",reasoningEffort:"low",effortPolicySha256:policyHash,
      recommendationPolicyVersion:RECOMMENDATION_POLICY_VERSION,implementationVersion:RECOMMENDATION_IMPLEMENTATION_VERSION,operation:"competition_v7_rank",temperature:0,topP:1});
    expect(row).toMatchObject({thinking:"disabled",reasoning_effort:"low",effort_policy_sha256:policyHash,prompt_sha256:expectedHash,state:"completed"});
    const receipt=unsealV7<{receipt:Record<string,unknown>}>(`call:${row.call_id}`,row).receipt;
    expect(receipt).toMatchObject({thinking:"disabled",temperature:0,topP:1,wireReasoningEffort:null,policyReasoningEffort:"low"});expect(receipt).not.toHaveProperty("reasoningEffort");
    expect((await readDurableDecisionJournalV7(lease.row.run_id))[0]).toMatchObject({thinking:"disabled",temperature:0,topP:1,policyReasoningEffort:"low",wireReasoningEffort:null,upstreamAttempted:true});
    expect(events.find(e=>e.type==="ai_transport_dispatch")?.details).toMatchObject({thinkingType:"disabled",wireReasoningEffort:null,policyReasoningEffort:"low",temperature:0,topP:1});
    expect((await admin.query("select effort,effort_policy_sha256 from ai_spend_ledger")).rows).toEqual([{effort:"low",effort_policy_sha256:policyHash}]);
    expect((await withDecisionEffortPolicy(policy,()=>withDurableAiRun(scope(lease),()=>requestAiJson("Synthetic private rank",options())))).ok).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
    expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(1);
  });
  it("keeps enabled downstream low and profile/chat high on the actual new grant",async()=>{
    transport();
    const operations=["competition_v7_explain","competition_v7_review","competition_v7_extract","competition_v7_chat","competition_v7_chat_review"];
    for(const operation of operations)expect((await requestAiJson("Synthetic downstream",{operation,model:"deepseek-flash",thinking:"enabled",maxTokens:32,maxAttempts:1})).ok).toBe(true);
    expect(bodies.map(body=>body.reasoning_effort)).toEqual(["low","low","high","high","high"]);
    expect(bodies.every(body=>(body.thinking as {type:string}).type==="enabled"&&!Object.hasOwn(body,"temperature"))).toBe(true);
    expect((await admin.query("select effort from ai_spend_ledger order by created_at,id")).rows.map(row=>row.effort)).toEqual(["low","low","high","high","high"]);
  });
  it("refuses every non-rank disabled operation before durable rows, reservations and HTTP",async()=>{
    const {lease}=await create();transport();
    for(const operation of ["competition_v7_explain","competition_v7_review","competition_v7_extract","competition_v7_chat","competition_v7_chat_review","competition_normalize","competition_recommend"]){
      expect(await withDecisionEffortPolicy(policy,()=>withDurableAiRun(scope(lease),()=>requestAiJson("Synthetic",{...options(),operation})))).toMatchObject({ok:false,upstreamAttempted:false,reason:"spend_configuration_invalid"});
    }
    expect(fetch).not.toHaveBeenCalled();expect((await admin.query("select count(*)::int as n from competition_decision_calls")).rows[0].n).toBe(0);expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(0);
  });
  it("rejects old or closed grants before durable preparation, ledger reservation or HTTP",async()=>{
    transport();
    await admin.query("update ai_spend_development_batches set state='closed',closed_at=now() where run_id=$1",[batch]);
    expect(await requestAiJson("Synthetic",options())).toMatchObject({ok:false,upstreamAttempted:false,reason:"spend_configuration_invalid"});
    await admin.query(clearSql);await grant(DEFAULT_EFFORT_POLICY);configure(policy);
    expect(await requestAiJson("Synthetic",options())).toMatchObject({ok:false,upstreamAttempted:false,reason:"spend_configuration_invalid"});
    expect(fetch).not.toHaveBeenCalled();expect((await admin.query("select count(*)::int as n from competition_decision_calls")).rows[0].n).toBe(0);expect((await admin.query("select count(*)::int as n from ai_spend_ledger")).rows[0].n).toBe(0);
  });
  it("retains an uncertain disabled dispatch and forbids regeneration under a new call namespace",async()=>{
    const {lease}=await create();vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("synthetic_unknown_transport");}));
    const first=await withDecisionEffortPolicy(policy,()=>withDurableAiRun(scope(lease),()=>requestAiJson("Synthetic private rank",options())));expect(first).toMatchObject({ok:false,upstreamAttempted:true,reason:"network_error"});
    const held=(await admin.query("select * from ai_spend_ledger")).rows;
    expect(held).toHaveLength(1);expect(held[0].state).toBe("conservative");expect(held[0].charged_micros).toBe(held[0].reserved_micros);
    for(const changed of [options(),{...options(),diagnosticContext:{...options().diagnosticContext,reviewId:"other-namespace"}}])expect(await withDecisionEffortPolicy(policy,()=>withDurableAiRun(scope(lease),()=>requestAiJson("Synthetic private rank",changed)))).toMatchObject({ok:false,upstreamAttempted:true,reason:"durable_outcome_unknown"});
    expect(fetch).toHaveBeenCalledTimes(1);expect((await admin.query("select * from ai_spend_ledger")).rows).toEqual(held);expect((await admin.query("select count(*)::int as n from competition_decision_calls")).rows[0].n).toBe(1);
  });
  it.each([{field:"reasoningEffort",value:"low"},{field:"operation",value:"competition_v7_explain"},{field:"effortPolicySha256",value:effortPolicySha256(DEFAULT_EFFORT_POLICY)}])("rejects rewritten disabled receipt metadata %j without another dispatch",async mutation=>{
    const {lease}=await create();transport();expect((await withDecisionEffortPolicy(policy,()=>withDurableAiRun(scope(lease),()=>requestAiJson("Synthetic private rank",options())))).ok).toBe(true);
    const row=(await admin.query("select * from competition_decision_calls")).rows[0],saved=unsealV7<{kind:string;receipt:Record<string,unknown>}>(`call:${row.call_id}`,row);
    saved.receipt[mutation.field]=mutation.value;const sealed=sealV7(`call:${row.call_id}`,saved);
    await admin.query("update competition_decision_calls set ciphertext=$2,iv=$3,tag=$4 where call_id=$1",[row.call_id,sealed.ciphertext,sealed.iv,sealed.tag]);
    expect(await withDecisionEffortPolicy(policy,()=>withDurableAiRun(scope(lease),()=>requestAiJson("Synthetic private rank",options())))).toMatchObject({ok:false,upstreamAttempted:true,reason:"invalid_request"});expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps v1 request hashes and receipts unchanged under the forward schema",async()=>{
    await admin.query(clearSql);await grant(DEFAULT_EFFORT_POLICY);const {lease}=await create();transport();
    const oldHash=effortPolicySha256(DEFAULT_EFFORT_POLICY),oldOptions={...options(),thinking:"enabled" as const,topP:0.95};
    expect((await withDecisionEffortPolicy(DEFAULT_EFFORT_POLICY,()=>withDurableAiRun({...scope(lease),effortPolicySha256:oldHash},()=>requestAiJson("Synthetic old rank",oldOptions)))).ok).toBe(true);
    const row=(await admin.query("select * from competition_decision_calls")).rows[0];
    expect(row.prompt_sha256).toBe(decisionRequestSha256({prompt:"Synthetic old rank",system:"Synthetic system",model:"deepseek-flash",maxTokens:32,promptVersion:oldOptions.promptVersion,thinking:"enabled",reasoningEffort:"low",effortPolicySha256:oldHash,
      recommendationPolicyVersion:RECOMMENDATION_POLICY_VERSION,implementationVersion:RECOMMENDATION_IMPLEMENTATION_VERSION,topP:0.95}));
    expect(bodies[0]).toMatchObject({thinking:{type:"enabled"},reasoning_effort:"low",top_p:0.95});expect(bodies[0]).not.toHaveProperty("temperature");
    const receipt=unsealV7<{receipt:Record<string,unknown>}>(`call:${row.call_id}`,row).receipt;expect(receipt).toMatchObject({thinking:"enabled",reasoningEffort:"low",topP:0.95});expect(receipt).not.toHaveProperty("temperature");expect(receipt).not.toHaveProperty("wireReasoningEffort");expect(receipt).not.toHaveProperty("policyReasoningEffort");
  });
  it("enforces the forward calls CHECK for disabled mode without rejecting historical NULL metadata",async()=>{
    const {lease}=await create();
    for(const [operation,effort,hash] of [["competition_v7_explain","low",policyHash],["competition_v7_rank","high",policyHash],["competition_v7_rank","low",effortPolicySha256(DEFAULT_EFFORT_POLICY)],[null,"low",policyHash],["competition_v7_rank",null,policyHash],["competition_v7_rank","low",null]]){
      await expect(admin.query("insert into competition_decision_calls(call_id,run_id,call_key,prompt_sha256,state,operation,thinking,reasoning_effort,effort_policy_sha256) values($1,$2,$3,$4,'prepared',$5,'disabled',$6,$7)",[randomUUID(),lease.row.run_id,randomUUID(),sha("Synthetic"),operation,effort,hash])).rejects.toMatchObject({code:"23514"});
    }
    await expect(admin.query("insert into competition_decision_calls(call_id,run_id,call_key,prompt_sha256,state) values($1,$2,$3,$4,'prepared')",[randomUUID(),lease.row.run_id,"historical-null",sha("Synthetic")])).resolves.toMatchObject({rowCount:1});
  });
});
