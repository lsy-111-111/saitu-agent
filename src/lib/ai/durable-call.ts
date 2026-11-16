import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import { sealV7, unsealV7, type SealedV7 } from "@/lib/competitions/v7/crypto";
import type { AiJsonResult, AiTokenUsage } from "./ai-client";
import { effortPolicySha256, resolveDecisionModelSettingsForOperation } from "./effort-policy.mjs";
import { currentDecisionEffortPolicy } from "./effort-context";
import {readExecutionMode,type AiExecutionMode} from "./execution-policy.mjs";

export type DurableRequestVersionV7 = {recommendationPolicyVersion:string;implementationVersion:string};
type ExecutionBindingV7={executionMode?:AiExecutionMode;authorizationRunId?:string};
type RunScope = ExecutionBindingV7&{runId:string;owner:string;fence:string;effortPolicySha256?:string;requestVersion?:DurableRequestVersionV7;chat?:{generation:number;requestId:string};canDispatch?:()=>boolean};
type CallScope = RunScope & {callId:string;reservationId:string|null};
const runs=new AsyncLocalStorage<RunScope>(),calls=new AsyncLocalStorage<CallScope>();
export const withDurableAiRun = <T>(scope:RunScope,work:()=>T):T => {
  if((scope.executionMode??"finite")!==readExecutionMode())throw new Error("DECISION_EXECUTION_MODE_CHANGED");
  if(scope.effortPolicySha256&&scope.effortPolicySha256!==effortPolicySha256(currentDecisionEffortPolicy()))throw new Error("DECISION_EFFORT_POLICY_CHANGED");
  return runs.run(scope,work);
};
export const withDurableAiChat = <T>(runId:string,generation:number,requestId:string,work:()=>T,canDispatch?:()=>boolean,requestVersion?:DurableRequestVersionV7,executionBinding?:ExecutionBindingV7):T =>
  withDurableAiRun({runId,owner:"chat",fence:"0",effortPolicySha256:effortPolicySha256(currentDecisionEffortPolicy()),requestVersion,...executionBinding,chat:{generation,requestId},canDispatch},work);
export const hasDurableAiRun = () => Boolean(runs.getStore());
export const currentDurableRequestVersionV7 = () => runs.getStore()?.requestVersion;
export type DurableReceipt = {model:string;httpStatus:number;requestId?:string;finishReason:string|null;content:unknown;usage?:AiTokenUsage;durationMs:number;attempts:number;
  operation?:string;thinking?:"enabled"|"disabled";reasoningEffort?:"max"|"high"|"low";policyReasoningEffort?:"max"|"high"|"low";wireReasoningEffort?:"max"|"high"|"low"|null;temperature?:number;topP?:number;effortPolicySha256?:string;recommendationPolicyVersion?:string;implementationVersion?:string};
export type PrivateAiPublicReceiptV7 = Pick<DurableReceipt,
  "model"|"httpStatus"|"requestId"|"finishReason"|"usage"|"durationMs"|"attempts"|"operation"|"thinking"|
  "reasoningEffort"|"policyReasoningEffort"|"wireReasoningEffort"|"temperature"|"topP"|"effortPolicySha256"|
  "recommendationPolicyVersion"|"implementationVersion"> & {content:string|null};
type PrivateReceiptTapV7 = (receipt:PrivateAiPublicReceiptV7)=>void|Promise<void>;
const privateReceiptTaps=new AsyncLocalStorage<PrivateReceiptTapV7>();

/** Server-owned evaluation capture, separate from metadata-only diagnostics.
 * Only public answer content is observed; no provider reasoning or headers.
 * The caller owns persistence. This does not add a durable-before-validation
 * guarantee to a direct call without the existing PostgreSQL run scope. */
export function withPrivateAiPublicReceiptTap<T>(tap:PrivateReceiptTapV7,work:()=>T):T {
  return privateReceiptTaps.run(tap,work);
}
function capturePrivateAiPublicReceipt(receipt:DurableReceipt) {
  const tap=privateReceiptTaps.getStore();if(!tap)return;
  try {
    const picked:PrivateAiPublicReceiptV7={model:receipt.model,httpStatus:receipt.httpStatus,
      finishReason:receipt.finishReason,content:typeof receipt.content==="string"?receipt.content:null,
      durationMs:receipt.durationMs,attempts:receipt.attempts,
      ...(receipt.usage?{usage:{inputTokens:receipt.usage.inputTokens,outputTokens:receipt.usage.outputTokens,cachedInputTokens:receipt.usage.cachedInputTokens}}:{})};
    // Explicit primitive keys only: future provider fields cannot silently
    // enter private originals, public observations, or application logs.
    for(const key of ["requestId","operation","thinking","reasoningEffort","policyReasoningEffort","wireReasoningEffort",
      "temperature","topP","effortPolicySha256","recommendationPolicyVersion","implementationVersion"] as const) {
      const value=receipt[key];
      if(typeof value==="string"||(typeof value==="number"&&Number.isFinite(value))||(key==="wireReasoningEffort"&&value===null))
        Object.assign(picked,{[key]:value});
    }
    const result=tap(structuredClone(picked));
    if(result&&typeof result.then==="function")void result.catch(()=>undefined);
  } catch { /* Capture failures cannot change provider classification, retries or accounting. */ }
}
type SavedCall = {kind:"result";result:AiJsonResult<unknown>}|{kind:"receipt";receipt:DurableReceipt};
type CallRow = SealedV7 & {call_id:string;state:string;prompt_sha256:string;reservation_id:string|null};

/** Accounting is read once from unique persisted calls, not summed from model
 * results that may have been replayed. A missing usage stays unknown. */
export async function readDurableDecisionJournalV7(runId:string) {
  const rows=(await getPool().query<{
    call_id:string;run_id:string;call_key:string;reservation_id:string|null;dispatched_at:Date|null;
    input_tokens:string|null;output_tokens:string|null;cached_input_tokens:string|null;operation:string|null;thinking:string|null;reasoning_effort:string|null;effort_policy_sha256:string|null;
  }>(`select c.call_id,c.run_id,c.call_key,c.reservation_id,c.dispatched_at,
      l.input_tokens,l.output_tokens,l.cached_input_tokens,c.operation,c.thinking,c.reasoning_effort,c.effort_policy_sha256
    from competition_decision_calls c left join ai_spend_ledger l on l.id=c.reservation_id
    where c.run_id=$1 and c.call_key not like 'chat:%' order by c.created_at,c.call_id`,[runId])).rows;
  const tokenCount=(value:string)=>{
    const count=Number(value);
    if(!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(count))throw new Error("INVALID_DURABLE_TOKEN_USAGE");
    return count;
  };
  return rows.map(row=>({runId:row.run_id,callId:row.call_id,callKey:row.call_key,reservationId:row.reservation_id,
    operation:row.operation,...(row.thinking==="disabled"?{thinking:"disabled" as const,policyReasoningEffort:row.reasoning_effort,wireReasoningEffort:null,temperature:0,topP:1}:{reasoningEffort:row.reasoning_effort}),effortPolicySha256:row.effort_policy_sha256,
    upstreamAttempted:row.dispatched_at!==null,
    usage:row.dispatched_at!==null&&row.input_tokens!==null&&row.output_tokens!==null&&row.cached_input_tokens!==null
      ?{inputTokens:tokenCount(row.input_tokens),outputTokens:tokenCount(row.output_tokens),cachedInputTokens:tokenCount(row.cached_input_tokens)}:null}));
}

async function assertLease(client:Pick<PoolClient,"query">,scope:RunScope) {
  if(scope.canDispatch&&!scope.canDispatch())throw new Error("DECISION_RELEASE_INACTIVE");
  if(scope.effortPolicySha256&&scope.effortPolicySha256!==effortPolicySha256(currentDecisionEffortPolicy()))throw new Error("DECISION_EFFORT_POLICY_CHANGED");
  if((scope.executionMode??"finite")!==readExecutionMode())throw new Error("DECISION_EXECUTION_MODE_CHANGED");
  if(scope.chat){
    const active=await client.query<SealedV7&{implementation_version:string;execution_mode:string|null}>(`select r.run_id,r.implementation_version,r.execution_mode,r.ciphertext,r.iv,r.tag from competition_decision_runs r join competition_decision_states s on s.state_key=r.state_key
      where r.run_id=$1 and s.generation=$2 and s.expires_at>now() and r.expires_at>now() and r.status not in ('superseded','expired')`,[scope.runId,scope.chat.generation]);
    if(active.rows.length!==1)throw new Error("DECISION_REVISION_CHANGED");
    if(scope.effortPolicySha256&&unsealV7<{effortPolicySha256?:string}>(`run:${scope.runId}`,active.rows[0]).effortPolicySha256!==scope.effortPolicySha256)throw new Error("DECISION_EFFORT_POLICY_CHANGED");
    assertRequestVersion(scope,active.rows[0]);
    return;
  }
  const result=await client.query<SealedV7&{implementation_version:string;execution_mode:string|null}>(`select run_id,implementation_version,execution_mode,ciphertext,iv,tag from competition_decision_runs where run_id=$1 and lease_owner=$2 and lease_fence=$3
    and lease_expires_at>now() and detail_deadline_at>now() and expires_at>now() and status in ('ranking','explaining','list_ready','partial_ready')`,[scope.runId,scope.owner,scope.fence]);
  if(result.rows.length!==1)throw new Error("DECISION_LEASE_LOST");
  if(scope.effortPolicySha256&&unsealV7<{effortPolicySha256?:string}>(`run:${scope.runId}`,result.rows[0]).effortPolicySha256!==scope.effortPolicySha256)throw new Error("DECISION_EFFORT_POLICY_CHANGED");
  assertRequestVersion(scope,result.rows[0]);
}
function assertRequestVersion(scope:RunScope,row:SealedV7&{implementation_version:string;execution_mode?:string|null}) {
  const body=unsealV7<{executionPolicy?:{policyVersion:string};executionMode?:AiExecutionMode;executionAuthorization?:{runId:string}}>(`run:${scope.runId}`,row);
  const mode=scope.executionMode??"finite";
  if((body.executionMode??"finite")!==mode||(row.execution_mode??"finite")!==mode||mode==="user-unbounded"&&(!scope.authorizationRunId||scope.authorizationRunId!==body.executionAuthorization?.runId||scope.authorizationRunId!==process.env.AI_SPEND_RUN_ID))throw new Error("DECISION_EXECUTION_MODE_CHANGED");
  if(scope.requestVersion&&(scope.requestVersion.implementationVersion!==row.implementation_version||scope.requestVersion.recommendationPolicyVersion!==body.executionPolicy?.policyVersion))throw new Error("DECISION_IMPLEMENTATION_CHANGED");
}
/** Atomic with the spend reservation: neither half can survive by itself. */
export async function bindDurableSpendReservation(client:PoolClient,reservationId:string) {
  const call=calls.getStore();if(!call)return;
  await assertLease(client,call);
  const result=await client.query(`update competition_decision_calls c set reservation_id=$2,state='reserved',updated_at=now()
    where call_id=$1 and state='prepared' and reservation_id is null and (c.effort_policy_sha256 is null or exists
      (select 1 from ai_spend_ledger l where l.id=$2 and l.operation=c.operation and l.effort=c.reasoning_effort and l.effort_policy_sha256=c.effort_policy_sha256))`,[call.callId,reservationId]);
  if(result.rowCount!==1)throw new Error("durable_reservation_conflict");
  call.reservationId=reservationId;
}
export async function markDurableDispatch() {
  const call=calls.getStore();if(!call)return;
  const client=await getPool().connect();
  try{
    await client.query("begin");await assertLease(client,call);
    const result=await client.query("update competition_decision_calls set state='dispatch_intent',dispatch_owner=$3,dispatch_fence=$4,dispatched_at=now(),updated_at=now() where call_id=$1 and state='reserved' and reservation_id=$2",[call.callId,call.reservationId,call.owner,call.fence]);
    if(result.rowCount!==1)throw new Error("durable_dispatch_conflict");
    await client.query("commit");
  }catch(error){await client.query("rollback").catch(()=>undefined);throw error;}finally{client.release();}
}
/** Only content and accounting are retained; hidden reasoning is never persisted. */
export async function recordDurableReceipt(receipt:DurableReceipt) {
  capturePrivateAiPublicReceipt(receipt);
  const call=calls.getStore();if(!call)return;
  if(receipt.thinking==="disabled"&&(receipt.operation!=="competition_v7_rank"||receipt.effortPolicySha256!==call.effortPolicySha256||receipt.policyReasoningEffort!=="low"||receipt.wireReasoningEffort!==null||receipt.reasoningEffort!==undefined||receipt.temperature!==0||receipt.topP!==1))throw new Error("invalid_durable_non_thinking_receipt");
  const sealed=sealV7(`call:${call.callId}`,{kind:"receipt",receipt} satisfies SavedCall,1_048_576);
  const result=await getPool().query("update competition_decision_calls set state='response_received',ciphertext=$2,iv=$3,tag=$4,response_at=now(),updated_at=now() where call_id=$1 and state in ('dispatch_intent','unknown') and reservation_id=$5",[call.callId,sealed.ciphertext,sealed.iv,sealed.tag,call.reservationId]);
  if(result.rowCount!==1)throw new Error("durable_receipt_unavailable");
}
export async function runDurableAiAttempt<T>(input:{key:string;prompt:string;requestSha256?:string;operation?:string;thinking?:"enabled"|"disabled";reasoningEffort?:"max"|"high"|"low";temperature?:number;topP?:number;effortPolicySha256?:string},work:()=>Promise<AiJsonResult<T>>,replay:(receipt:DurableReceipt)=>AiJsonResult<T>):Promise<AiJsonResult<T>> {
  if(input.thinking==="disabled"){
    const policy=currentDecisionEffortPolicy(),settings=resolveDecisionModelSettingsForOperation(input.operation??"",policy);
    if(settings.thinking!=="disabled"||input.reasoningEffort!==settings.policyReasoningEffort||input.temperature!==0||input.topP!==1||input.effortPolicySha256!==effortPolicySha256(policy))throw new Error("invalid_durable_non_thinking_request");
  }
  const storedScope=runs.getStore();if(!storedScope)return work();
  const scope=input.effortPolicySha256?{...storedScope,effortPolicySha256:storedScope.effortPolicySha256??input.effortPolicySha256}:storedScope;
  const callKey=scope.chat?`chat:${scope.chat.requestId}:${input.key}`:input.key;
  const promptHash=createHash("sha256").update(input.prompt).digest("hex");
  if(input.requestSha256!==undefined&&input.requestSha256!==promptHash)throw new Error("durable_request_hash_mismatch");
  if(scope.effortPolicySha256&&input.effortPolicySha256&&scope.effortPolicySha256!==input.effortPolicySha256)throw new Error("DECISION_EFFORT_POLICY_CHANGED");
  const client=await getPool().connect();let row:CallRow;
  try{
    await client.query("begin");await assertLease(client,scope);
    // A namespace or policy upgrade cannot turn a previously uncertain paid
    // attempt into a fresh key. Already-dispatched siblings may still settle.
    const unresolved=(await client.query(`select call_id from competition_decision_calls where run_id=$1 and call_key<>$2
      and state in ('dispatch_intent','unknown') and (state='unknown' or dispatch_owner is distinct from $4 or dispatch_fence is distinct from $5::bigint)
      and ($3::text is null and call_key not like 'chat:%' or $3::text is not null and left(call_key,length($3))=$3)
      limit 1`,[scope.runId,callKey,scope.chat?`chat:${scope.chat.requestId}:`:null,scope.owner,scope.fence])).rows[0];
    if(unresolved){await client.query("commit");return {ok:false,reason:"durable_outcome_unknown",model:"deepseek-flash",upstreamAttempted:true};}
    await client.query(`insert into competition_decision_calls(call_id,run_id,call_key,prompt_sha256,state,operation,thinking,reasoning_effort,effort_policy_sha256)
      values($1,$2,$3,$4,'prepared',$5,$6,$7,$8) on conflict(run_id,call_key) do nothing`,
      [randomUUID(),scope.runId,callKey,promptHash,input.operation??null,input.thinking??null,input.reasoningEffort??null,input.effortPolicySha256??null]);
    row=(await client.query<CallRow>("select * from competition_decision_calls where run_id=$1 and call_key=$2 for update",[scope.runId,callKey])).rows[0];
    if(row.prompt_sha256!==promptHash)throw new Error("durable_prompt_changed");
    if(row.state==="dispatch_intent"||row.state==="unknown"||(row.state==="reserved"&&scope.chat)){
      await client.query("update competition_decision_calls set state='unknown',updated_at=now() where call_id=$1",[row.call_id]);
      await client.query("commit");
      return {ok:false,reason:"durable_outcome_unknown",model:"deepseek-flash",upstreamAttempted:true};
    }
    if(row.state==="reserved"){
      // No dispatch intent was committed. It is safe to release this reservation.
      await client.query("update ai_spend_ledger set charged_micros=0,state='cancelled',settled_at=now() where id=$1 and state='reserved'",[row.reservation_id]);
      await client.query("update competition_decision_calls set state='prepared',reservation_id=null,updated_at=now() where call_id=$1",[row.call_id]);
    }
    await client.query("commit");
  }catch(error){await client.query("rollback").catch(()=>undefined);throw error;}finally{client.release();}
  if(row.state==="completed"||row.state==="response_received"){
    const saved=unsealV7<SavedCall>(`call:${row.call_id}`,row);
    const usage=saved.kind==="result"?saved.result.usage:saved.receipt.usage;
    if(row.reservation_id&&usage){
      const {estimateSpendMicros}=await import("./spend-ledger");
      await getPool().query("update ai_spend_ledger set charged_micros=$2,state='usage_estimated',input_tokens=$3,output_tokens=$4,cached_input_tokens=$5,settled_at=now() where id=$1 and state='reserved'",[row.reservation_id,estimateSpendMicros(usage),usage.inputTokens,usage.outputTokens,usage.cachedInputTokens]);
    }
    return saved.kind==="result"?saved.result as AiJsonResult<T>:replay(saved.receipt);
  }
  const attempt:CallScope={...scope,callId:row.call_id,reservationId:null};
  return calls.run(attempt,async()=>{
    const result=await work();
    if(!result.upstreamAttempted&&scope.canDispatch&&!scope.canDispatch())throw new Error("DECISION_RELEASE_INACTIVE");
    const uncertain=!result.ok&&result.upstreamAttempted&&["network_error","timeout","durable_outcome_unknown"].includes(result.reason);
    const sealed=sealV7(`call:${row.call_id}`,{kind:"result",result} satisfies SavedCall,1_048_576);
    // Bind completion to the reservation owned by this attempt. A stale owner
    // cannot overwrite a successor's dispatch; a failure cannot erase a receipt.
    // Keep the response saved before schema validation, even after a definitive
    // invalid output. Replaying that receipt revalidates without another paid
    // dispatch, and preserves the original content for diagnosis and recovery.
    await getPool().query(`update competition_decision_calls set state=case when $5 and state in ('dispatch_intent','unknown') then 'unknown' else 'completed' end,
      ciphertext=case when state='response_received' then ciphertext else $2 end,
      iv=case when state='response_received' then iv else $3 end,
      tag=case when state='response_received' then tag else $4 end,updated_at=now() where call_id=$1 and reservation_id is not distinct from $6::uuid
      and state not in ('completed') and not ($5 and state='response_received')`,[row.call_id,sealed.ciphertext,sealed.iv,sealed.tag,uncertain,attempt.reservationId]);
    return result;
  });
}
