import {scopedAiReservationLimitMicros,scopedAiSpendLimitMicros} from "./spend-run-context";
import { bindDurableSpendReservation } from "./durable-call";
import { emitProductObservation } from "./product-observation";
import { randomUUID } from "node:crypto";
import { getPool, isDatabaseConfigured } from "@/lib/db/pool";
import { LEGACY_DEFAULT_EFFORT_POLICY, EFFORT_GRANT_VERSION, TOP5_EFFORT_GRANT_VERSION, effortPolicySha256, parseEffortPolicy, resolveEffortForOperation } from "./effort-policy.mjs";
import { currentDecisionEffortPolicy } from "./effort-context";
import {isUserUnboundedExecutionMode,USER_UNBOUNDED_GRANT_VERSION} from "./execution-policy.mjs";
import {readUserUnboundedExecutionAuthorizationV7} from "./execution-authorization";
import {createCompetitionRequestDeadlines} from "./request-deadline";
import {setTimeout as delay} from "node:timers/promises";
import type {PoolClient} from "pg";

export const FLASH_PRICE_SNAPSHOT = {
  id: "deepseek-flash-cny-20261105-peak-upper-bound",
  source: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
  uncachedInputPerMillion: 2, cachedInputPerMillion: 0.04, outputPerMillion: 8,
} as const;
export type SpendUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number };
export type SpendReservation = {
  id: string;
  reservedMicros: number;
  settle: (usage?: SpendUsage, upstreamAttempted?: boolean) => Promise<number>;
};
export type SpendFailure = "spend_budget_exhausted" | "spend_store_unavailable" | "spend_configuration_invalid";
export const SPEND_PHASES = ["calibration", "formal", "repair", "performance", "reserve"] as const;
/** A request signal only: the PostgreSQL grant/hash is verified before HTTP. */
export function configuredDevelopmentEffort(): "high" | undefined {
  const run=process.env.AI_SPEND_RUN_ID??"";
  const authorizedRun=/^saitu-c-sync-20261106-[0-9]{2}$/.test(run)||(/^saitu-v7-20261109-(?:calibration|formal|repair|performance|reserve)-[0-9]{2}$/.test(run)&&/^[a-f0-9]{64}$/.test(process.env.AI_SPEND_POLICY_SHA256??""));
  return process.env.AI_REASONING_EFFORT === "high" && process.env.AI_SPEND_AUTHORIZED_EFFORT === "high"
    && authorizedRun
    && /^[a-f0-9]{64}$/.test(process.env.AI_SPEND_HIGH_CONDITION_SHA256 ?? "") ? "high" : undefined;
}
/** Operator control can only lower the immutable 100-call calibration ceiling. */
export function calibrationCallLimit(value = process.env.AI_CALIBRATION_CALL_LIMIT): number | null {
  if (value === undefined || value.trim() === "") return 100;
  if (!/^[1-9][0-9]*$/.test(value.trim())) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count <= 100 ? count : null;
}

/** Conservative peak pricing is an upper estimate, not a provider invoice. */
export function estimateSpendMicros(usage: SpendUsage): number {
  if (![usage.inputTokens, usage.outputTokens, usage.cachedInputTokens].every(n => Number.isSafeInteger(n) && n >= 0) || usage.cachedInputTokens > usage.inputTokens) throw new Error("Invalid token usage");
  const micros=((BigInt(usage.inputTokens)-BigInt(usage.cachedInputTokens))*BigInt(50)
    +BigInt(usage.cachedInputTokens)+BigInt(usage.outputTokens)*BigInt(200)+BigInt(24))/BigInt(25);
  const value=Number(micros);if(!Number.isSafeInteger(value))throw new Error("Spend exceeds safe integer precision");
  return value;
}
export function requestReserveMicros(system: string, prompt: string, outputLimit: number) {
  // One token per UTF-8 byte plus message overhead is a deliberately safe bound.
  return estimateSpendMicros({ inputTokens: Buffer.byteLength(system + prompt, "utf8") + 1024, outputTokens: outputLimit, cachedInputTokens: 0 });
}
/** Even NODE_ENV=test cannot exempt an ordinary CLI/HTTP transport from accounting. */
export function spendLedgerRequired() { return true; }

async function connectSpendBefore(deadline:number,signal?:AbortSignal):Promise<PoolClient|null>{
  if(Date.now()>=deadline||signal?.aborted)return null;
  const connection=getPool().connect();let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
  try{
    const value=await Promise.race([connection.then(client=>({client})),new Promise<null>(resolve=>{
      timer=setTimeout(()=>resolve(null),Math.max(1,deadline-Date.now()));
      abort=()=>resolve(null);signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
    })]);
    if(value)return value.client;
    void connection.then(client=>client.release()).catch(()=>undefined);return null;
  }finally{if(timer)clearTimeout(timer);if(abort)signal?.removeEventListener("abort",abort);}
}
/** Wait only before any reservation/HTTP. A busy global lock is backpressure,
 * not a store outage. Roll back and release each miss before sleeping. */
async function beginSpendBefore(deadline:number,signal?:AbortSignal):Promise<PoolClient|null>{
  while(Date.now()<deadline&&!signal?.aborted){
    const client=await connectSpendBefore(deadline,signal);if(!client)return null;
    let handedOff=false;
    try{
      await client.query("begin");
      const remaining=Math.max(1,deadline-Date.now());
      await client.query("select set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)",
        [`${Math.min(2000,remaining)}ms`,`${Math.min(1500,remaining)}ms`]);
      const acquired=(await client.query<{acquired:boolean}>("select pg_try_advisory_xact_lock(724310896145225::bigint) as acquired")).rows[0]?.acquired===true;
      if(acquired&&Date.now()<deadline&&!signal?.aborted){handedOff=true;return client;}
      await client.query("rollback");
    }catch(error){await client.query("rollback").catch(()=>undefined);throw error;}
    finally{if(!handedOff)client.release();}
    const remaining=deadline-Date.now();if(remaining<=0||signal?.aborted)return null;
    await delay(Math.min(remaining,25+Math.floor(Math.random()*50)),undefined,{signal}).catch(()=>undefined);
  }
  return null;
}

export async function reserveAiSpend(input: { system: string; prompt: string; maxTokens: number; model: string; effort: string; operation?: string;effortPolicySha256?:string;deadlineEpochMs?:number;signal?:AbortSignal }): Promise<{ ok: true; reservation: SpendReservation } | { ok: false; reason: SpendFailure }> {
  let userUnbounded:boolean;
  try{userUnbounded=isUserUnboundedExecutionMode();}catch{return {ok:false,reason:"spend_configuration_invalid"};}
  const runId = process.env.AI_SPEND_RUN_ID?.trim();
  const totalLimit = Number(process.env.AI_SPEND_LIMIT_CNY ?? 300);
  const fundedLimit = Number(process.env.AI_SPEND_FUNDED_CNY);
  const phase = process.env.AI_SPEND_PHASE?.trim() || "calibration";
  const callLimit = calibrationCallLimit();
  if (!runId || !/^[a-zA-Z0-9._-]{1,100}$/.test(runId) || input.model !== "deepseek-flash" ||
      !["max", "high", "low"].includes(input.effort) || !SPEND_PHASES.includes(phase as typeof SPEND_PHASES[number]) ||
      !userUnbounded&&(!Number.isFinite(totalLimit) || totalLimit <= 0 || !Number.isSafeInteger(Math.floor(totalLimit * 1_000_000)) ||
      !Number.isFinite(fundedLimit) || fundedLimit <= 0 || !Number.isSafeInteger(Math.floor(fundedLimit * 1_000_000))) || !Number.isSafeInteger(input.maxTokens) || input.maxTokens < 1 || (!userUnbounded&&phase === "calibration" && callLimit === null))
    return { ok: false, reason: "spend_configuration_invalid" };
  if (!isDatabaseConfigured()) return { ok: false, reason: "spend_store_unavailable" };
  const limitMicros = userUnbounded?null:Math.min(Math.floor(Math.min(totalLimit, fundedLimit) * 1_000_000), scopedAiSpendLimitMicros() ?? Infinity);
  const reservedMicros = requestReserveMicros(input.system, input.prompt, input.maxTokens);
  let resolvedPolicySha256=input.effortPolicySha256;
  if(reservedMicros>(scopedAiReservationLimitMicros()??Infinity))return {ok:false,reason:"spend_budget_exhausted"};
  const id = randomUUID();
  try {
    const deadline=input.deadlineEpochMs??createCompetitionRequestDeadlines().aiDeadlineEpochMs;
    if(!Number.isFinite(deadline))return {ok:false,reason:"spend_configuration_invalid"};
    const client = await beginSpendBefore(deadline,input.signal);
    if(!client)return {ok:false,reason:"spend_store_unavailable"};
    try {
      // Only an administrator may initialize authority. A mistyped/new run cannot mint another budget.
      const authority = await client.query<{run_id:string}>("select run_id from ai_spend_authority where singleton=true");
      if(authority.rows.length!==1){
        await client.query("rollback");
        return {ok:false,reason:"spend_configuration_invalid"};
      }
      const mainRunId=authority.rows[0].run_id;
      const batches=await client.query<{run_id:string;main_run_id:string;call_limit:number;state:string;funding_limit_micros:string;baseline_reservation_ids:string[];authorized_effort:string;effort_condition_sha256:string|null;effort_condition:Record<string,unknown>|null;grant_version:string;authorized_phase:string;policy_sha256:string|null;effort_policy:unknown;effort_policy_sha256:string|null}>(
        "select run_id,main_run_id,call_limit,state,funding_limit_micros::text,baseline_reservation_ids,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256,effort_policy,effort_policy_sha256 from ai_spend_development_batches where run_id=$1 or run_id=(select run_id from ai_spend_development_batches order by created_at desc,run_id desc limit 1) order by created_at desc,run_id desc",[runId]);
      const batch=batches.rows.find(row=>row.run_id===runId);
      const unboundedGrant=batch?.grant_version===USER_UNBOUNDED_GRANT_VERSION;
      const top5=batch?.grant_version===TOP5_EFFORT_GRANT_VERSION;
      const staged=batch?.grant_version===EFFORT_GRANT_VERSION||top5||unboundedGrant;
      if(runId!==mainRunId&&(!batch||batch.main_run_id!==mainRunId||batch.state!=="active"||phase!==batch.authorized_phase||!staged&&input.effort!==batch.authorized_effort||
        (batch.grant_version==="saitu.v7"&&(!/^[a-f0-9]{64}$/.test(batch.policy_sha256??"")||process.env.AI_SPEND_POLICY_SHA256!==batch.policy_sha256))||
        (batch.authorized_effort==="high"&&(!/^[a-f0-9]{64}$/.test(batch.effort_condition_sha256??"")||
          process.env.AI_SPEND_AUTHORIZED_EFFORT!=="high"||process.env.AI_SPEND_HIGH_CONDITION_SHA256!==batch.effort_condition_sha256)))){
        await client.query("rollback");return {ok:false,reason:"spend_configuration_invalid"};
      }
      try {
        if(userUnbounded||unboundedGrant){
          if(!userUnbounded||!unboundedGrant)throw new Error("unbounded_grant_mismatch");
          const authority=await readUserUnboundedExecutionAuthorizationV7(client),policy=currentDecisionEffortPolicy();
          resolvedPolicySha256=authority.effortPolicySha256;
          if(input.effortPolicySha256!==resolvedPolicySha256||input.effort!==resolveEffortForOperation(input.operation??"",policy))throw new Error("unbounded_operation_mismatch");
        }else if(staged){
          const policy=parseEffortPolicy(batch.effort_policy),current=currentDecisionEffortPolicy();
          resolvedPolicySha256=effortPolicySha256(current);
          const condition=batch.effort_condition;
          if(batch.authorized_effort!=="stage"||!(top5?/^saitu-v7-top5-20261109-(?:calibration|formal|repair|performance|reserve)-[0-9]{2}$/:/^saitu-v7-effort-20261109-(?:calibration|formal|repair|performance|reserve)-[0-9]{2}$/).test(runId)
            ||effortPolicySha256(policy)!==batch.effort_policy_sha256||resolvedPolicySha256!==batch.effort_policy_sha256
            ||input.effortPolicySha256!==resolvedPolicySha256||input.effort!==resolveEffortForOperation(input.operation??"",policy)
            ||process.env.AI_SPEND_AUTHORIZED_EFFORT!=="stage"||process.env.AI_SPEND_EFFORT_CONDITION_SHA256!==batch.effort_condition_sha256
            ||!(/^[a-f0-9]{64}$/.test(batch.effort_condition_sha256??""))||!(/^[a-f0-9]{64}$/.test(batch.policy_sha256??""))
            ||process.env.AI_SPEND_POLICY_SHA256!==batch.policy_sha256)throw new Error("effort_grant_mismatch");
          if(top5&&(!condition||condition.schemaVersion!=="saitu.user-approved-budget-condition.v7.top5.v1"
            ||condition.authorization!=="user-approved-20261109-top5-continuation"||condition.sourcePolicy!=="docs/v7/top5-continuation-contract-20261109.md"
            ||condition.policyVersion!=="saitu.policy.2026-11-09.v7.top5"||condition.implementationVersion!=="saitu.async.2026-11-09.v7.3.top5"
            ||condition.mainRunId!==mainRunId||condition.phase!==phase||condition.policySha256!==batch.policy_sha256
            ||condition.effortPolicySha256!==batch.effort_policy_sha256||condition.freshPgRowsVerified!==true
            ||!["rank","explain","review"].every(stage=>policy[stage as "rank"|"explain"|"review"]==="low")))throw new Error("top5_grant_mismatch");
        }else if(input.effortPolicySha256||/^competition_v7_/.test(input.operation??"")){
          const policy=currentDecisionEffortPolicy();resolvedPolicySha256=effortPolicySha256(policy);
          if(resolvedPolicySha256!==effortPolicySha256(LEGACY_DEFAULT_EFFORT_POLICY)
            ||input.effortPolicySha256!==undefined&&input.effortPolicySha256!==resolvedPolicySha256
            ||input.effort!==resolveEffortForOperation(input.operation??"",policy))throw new Error("legacy_effort_grant_mismatch");
        }
      }catch {await client.query("rollback");return {ok:false,reason:"spend_configuration_invalid"};}
      // Old grants retain their original controls. New grants are finite DB
      // authorizations and do not reinterpret the old 100/30/300 user limits.
      if(!userUnbounded&&!batch&&(totalLimit>300||fundedLimit>300)){
        await client.query("rollback");return {ok:false,reason:"spend_configuration_invalid"};
      }
      const funding=batches.rows[0];
      if(funding){
        if(funding.main_run_id!==mainRunId){await client.query("rollback");return {ok:false,reason:"spend_configuration_invalid"};}
        // UUID checkpoints avoid timestamp races and never count old settled
        // spend a second time against a fresh provider balance. Every uncertain
        // old call is separately held in the administrator's funding snapshot.
        const fresh=await client.query<{total:string}>(`select coalesce(sum(coalesce(charged_micros,reserved_micros)),0)::text as total
          from ai_spend_ledger where (run_id=$1 or run_id in (select run_id from ai_spend_development_batches))
          and not(id=any($2::uuid[]))`,[mainRunId,funding.baseline_reservation_ids]);
        if(Number(fresh.rows[0].total)+reservedMicros>Number(funding.funding_limit_micros)){
          await client.query("rollback");return {ok:false,reason:"spend_budget_exhausted"};
        }
      }
      const budget = await client.query<{ hard_limit_micros: string|null;execution_mode:string|null }>("select hard_limit_micros::text,execution_mode from ai_spend_budgets where run_id=$1", [runId]);
      if(budget.rows.length!==1){await client.query("rollback");return {ok:false,reason:"spend_configuration_invalid"};}
      if(userUnbounded&&(budget.rows[0].execution_mode!=="user-unbounded"||budget.rows[0].hard_limit_micros!==null)){
        await client.query("rollback");return {ok:false,reason:"spend_configuration_invalid"};
      }
      if(!userUnbounded){
        const spent = await client.query<{ total: string }>("select coalesce(sum(coalesce(charged_micros,reserved_micros)),0)::text as total from ai_spend_ledger where run_id=$1", [runId]);
        const cap = Math.min(limitMicros!, Number(budget.rows[0]?.hard_limit_micros ?? 0));
        if (Number(spent.rows[0]?.total ?? 0) + reservedMicros > cap) {
        await client.query("rollback");
        emitProductObservation("ai_budget_denied",{reservationId:id,phase,reservedMicros,reason:"spend_budget_exhausted"});
        return { ok: false, reason: "spend_budget_exhausted" };
        }
      }
      if (!userUnbounded&&(phase === "calibration" || batch?.grant_version === "saitu.v7" || staged)) {
        const calibration = await client.query<{ total: string; calls: string }>("select coalesce(sum(coalesce(charged_micros,reserved_micros)),0)::text as total, count(*) filter (where state <> 'cancelled')::text as calls from ai_spend_ledger where run_id=$1 and phase=$2", [runId,phase]);
        if (Number(calibration.rows[0]?.calls ?? 0) >= (batch ? batch.call_limit : Math.min(100, callLimit ?? 0)) || (!batch && Number(calibration.rows[0]?.total ?? 0) + reservedMicros > 30_000_000)) {
          await client.query("rollback");
          emitProductObservation("ai_budget_denied",{reservationId:id,phase,reservedMicros,reason:"spend_budget_exhausted"});
          return { ok: false, reason: "spend_budget_exhausted" };
        }
      }
      if(Date.now()>=deadline||input.signal?.aborted){await client.query("rollback");return {ok:false,reason:"spend_store_unavailable"};}
      await client.query("insert into ai_spend_ledger (id,run_id,model,effort,operation,price_version,reserved_micros,state,phase,effort_policy_sha256) values ($1,$2,$3,$4,$5,$6,$7,'reserved',$8,$9)", [id,runId,input.model,input.effort,input.operation??"unspecified",FLASH_PRICE_SNAPSHOT.id,reservedMicros,phase,resolvedPolicySha256??null]);
      await bindDurableSpendReservation(client,id);
      await client.query("commit");
      emitProductObservation("ai_budget_reserved",{reservationId:id,phase,model:input.model,operation:input.operation??"unspecified",effort:input.effort,effortPolicySha256:resolvedPolicySha256??null,reservedMicros,priceVersion:FLASH_PRICE_SNAPSHOT.id});
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
    finally { client.release(); }
    let settlement: Promise<number> | undefined;
    return { ok: true, reservation: { id, reservedMicros, settle: (usage, upstreamAttempted = true) => {
      if (settlement) return settlement;
      settlement = (async () => {
      const charged = upstreamAttempted ? (usage ? estimateSpendMicros(usage) : reservedMicros) : 0;
      // If settlement fails the full reservation remains charged. Never free an uncertain call.
      await getPool().query("update ai_spend_ledger set charged_micros=$2,state=$3,input_tokens=$4,output_tokens=$5,cached_input_tokens=$6,settled_at=now() where id=$1 and state='reserved'", [id,charged,usage ? "usage_estimated" : upstreamAttempted ? "conservative" : "cancelled",usage?.inputTokens ?? null,usage?.outputTokens ?? null,usage?.cachedInputTokens ?? null]);
      emitProductObservation("ai_budget_settled",{reservationId:id,operation:input.operation??"unspecified",effort:input.effort,effortPolicySha256:resolvedPolicySha256??null,chargedMicros:charged,usage:usage??null,upstreamAttempted,state:usage?"usage_estimated":upstreamAttempted?"conservative":"cancelled",priceVersion:FLASH_PRICE_SNAPSHOT.id});
      return charged / 1_000_000;
      })();
      return settlement;
    } } };
  } catch { return { ok: false, reason: "spend_store_unavailable" }; }
}
