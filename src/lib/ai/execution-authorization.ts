import "server-only";
import {createHmac,timingSafeEqual} from "node:crypto";
import type {PoolClient} from "pg";
import {getPool} from "@/lib/db/pool";
import {currentDecisionEffortPolicy} from "./effort-context";
import {effortPolicySha256,parseEffortPolicy,requireCompactRecommendationEffortPolicy,requireRankNonThinkingEffortPolicy} from "./effort-policy.mjs";
import {isUserUnboundedExecutionMode,USER_UNBOUNDED_AUTHORIZATION,USER_UNBOUNDED_AUTHORIZATION_POLICY,USER_UNBOUNDED_CONDITION_SCHEMA,USER_UNBOUNDED_EXECUTION_LIMITS,USER_UNBOUNDED_GRANT_VERSION,COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY,COMPACT_RECOMMENDATION_AUTHORIZATION,RANK_NONTHINKING_AUTHORIZATION_POLICY,RANK_NONTHINKING_AUTHORIZATION,RANK_NONTHINKING_TRIAL_ID,RANK_NONTHINKING_TRIAL_SLOTS} from "./execution-policy.mjs";
import { FAST24_REPAIR_AUTHORIZATION_POLICY, FAST24_REPAIR_AUTHORIZATION, FAST24_REPAIR_VALIDATION_PURPOSE, isFast24RepairValidationBinding } from "./execution-policy.mjs";
import { LOCAL_PREVIEW_AUTHORIZATION_POLICY, LOCAL_PREVIEW_AUTHORIZATION, LOCAL_PREVIEW_PURPOSE, isLocalPreviewBinding } from "./execution-policy.mjs";
import { readLocalDecisionPreviewV7 } from "@/lib/competitions/v7/active-release";

type QueryClient=Pick<PoolClient,"query">;
export type UserUnboundedExecutionAuthorizationV7={runId:string;mainRunId:string;phase:string;policySha256:string;effortPolicySha256:string;conditionSha256:string};
/** An environment flag is a request for this authority, never the authority.
 * All three consumers (governor, ledger, validation API) verify the active DB grant. */
export async function readUserUnboundedExecutionAuthorizationV7(client:QueryClient=getPool()):Promise<UserUnboundedExecutionAuthorizationV7> {
  if(!isUserUnboundedExecutionMode())throw new Error("USER_UNBOUNDED_AUTHORIZATION_REQUIRED");
  const runId=process.env.AI_SPEND_RUN_ID??"",phase=process.env.AI_SPEND_PHASE??"";
  if(!/^(calibration|formal|repair|performance|reserve)$/.test(phase)||!new RegExp(`^saitu-v7-top5-unbounded-20261109-${phase}-[0-9]{2}$`).test(runId))throw new Error("USER_UNBOUNDED_AUTHORIZATION_REQUIRED");
  const row=(await client.query<{main_run_id:string;grant_version:string;state:string;authorized_phase:string;authorized_effort:string;policy_sha256:string;effort_condition_sha256:string;effort_condition:Record<string,unknown>;effort_policy:unknown;effort_policy_sha256:string;execution_mode:string|null;call_limit:number|null;budget_mode:string|null;hard_limit_micros:string|null}>(`select b.main_run_id,b.grant_version,b.state,b.authorized_phase,b.authorized_effort,b.policy_sha256,b.effort_condition_sha256,b.effort_condition,b.effort_policy,b.effort_policy_sha256,b.execution_mode,b.call_limit,
    q.execution_mode as budget_mode,q.hard_limit_micros::text from ai_spend_development_batches b join ai_spend_budgets q on q.run_id=b.run_id
    join ai_spend_authority a on a.singleton=true and a.run_id=b.main_run_id where b.run_id=$1`,[runId])).rows[0];
  if(!row||row.grant_version!==USER_UNBOUNDED_GRANT_VERSION||row.state!=="active"||row.authorized_phase!==phase||row.authorized_effort!=="stage"||row.execution_mode!=="user-unbounded"||row.budget_mode!=="user-unbounded"||row.call_limit!==null||row.hard_limit_micros!==null)throw new Error("USER_UNBOUNDED_AUTHORIZATION_REQUIRED");
  const policy=parseEffortPolicy(row.effort_policy),policyHash=effortPolicySha256(policy),condition=row.effort_condition;
  const limits=condition?.executionLimits as Record<string,unknown>|undefined;
  const compact=condition?.sourcePolicy===COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY;
  const fastRank=condition?.sourcePolicy===RANK_NONTHINKING_AUTHORIZATION_POLICY;
  const step8Repair=condition?.sourcePolicy===FAST24_REPAIR_AUTHORIZATION_POLICY;
  const localPreview=condition?.sourcePolicy===LOCAL_PREVIEW_AUTHORIZATION_POLICY;
  if(compact){try{requireCompactRecommendationEffortPolicy(policy);}catch{throw new Error("USER_UNBOUNDED_AUTHORIZATION_REQUIRED");}}
  if(fastRank||step8Repair||localPreview){
    try{requireRankNonThinkingEffortPolicy(policy);}catch{throw new Error("USER_UNBOUNDED_AUTHORIZATION_REQUIRED");}
    const settings=condition.rankModelSettings as Record<string,unknown>|undefined,trial=condition.developmentTrial as Record<string,unknown>|undefined;
    const continuation=condition.pilotContinuation as Record<string,unknown>|null|undefined;
    if(!settings||Object.keys(settings).sort().join(",")!=="policyReasoningEffort,temperature,thinking,topP,wireReasoningEffort"||settings.thinking!=="disabled"||settings.policyReasoningEffort!=="low"||settings.wireReasoningEffort!==null||settings.temperature!==0||settings.topP!==1)
      throw new Error("USER_UNBOUNDED_AUTHORIZATION_REQUIRED");
    if(localPreview){
      const local=readLocalDecisionPreviewV7(),binding=condition.localPreview;
      if(phase!=="reserve"||condition.runPurpose!==LOCAL_PREVIEW_PURPOSE||continuation!==null||trial!==undefined||condition.repairValidation!==undefined||
        !isLocalPreviewBinding(binding)||!local||local.origin!==binding.origin||binding.applicationRuntimeSourceSha256!==process.env.SAITU_V7_SOURCE_SHA256||
        binding.productionBuildId!==process.env.SAITU_LOCAL_PREVIEW_BUILD_ID||binding.workerArtifactSha256!==process.env.SAITU_LOCAL_PREVIEW_WORKER_SHA256||
        binding.nextBindingSha256!==process.env.SAITU_LOCAL_PREVIEW_NEXT_BINDING_SHA256)throw new Error("USER_UNBOUNDED_AUTHORIZATION_REQUIRED");
    }else if(step8Repair){
      if(phase!=="repair"||condition.runPurpose!==FAST24_REPAIR_VALIDATION_PURPOSE||continuation!==null||trial!==undefined||
        !isFast24RepairValidationBinding(condition.repairValidation)||condition.repairValidation.applicationRuntimeSourceSha256!==process.env.SAITU_V7_SOURCE_SHA256||
        !(/^[a-f0-9]{64}$/.test(String(condition.repairAuthorizationRecordSha256??""))))throw new Error("USER_UNBOUNDED_AUTHORIZATION_REQUIRED");
    }else if(!trial||Object.keys(trial).sort().join(",")!=="id,maxReports,slotIds"||trial.id!==RANK_NONTHINKING_TRIAL_ID||trial.maxReports!==3||JSON.stringify(trial.slotIds)!==JSON.stringify(RANK_NONTHINKING_TRIAL_SLOTS)
      ||(phase==="calibration"?continuation!==null:!continuation||continuation.complete!==3||continuation.detailLayout!=="single"||continuation.effortPolicySha256!==policyHash
        ||JSON.stringify(continuation.slotIds)!==JSON.stringify(RANK_NONTHINKING_TRIAL_SLOTS)
        ||![continuation.proofSha256,continuation.sourceBindingsSha256,continuation.pilotExecutionSha256,continuation.pilotPlanSha256].every(value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value))))throw new Error("USER_UNBOUNDED_AUTHORIZATION_REQUIRED");
  }
  const expectedAuthorization=localPreview?LOCAL_PREVIEW_AUTHORIZATION:step8Repair?FAST24_REPAIR_AUTHORIZATION:fastRank?RANK_NONTHINKING_AUTHORIZATION:compact?COMPACT_RECOMMENDATION_AUTHORIZATION:USER_UNBOUNDED_AUTHORIZATION;
  const expectedPolicy=localPreview?LOCAL_PREVIEW_AUTHORIZATION_POLICY:step8Repair?FAST24_REPAIR_AUTHORIZATION_POLICY:fastRank?RANK_NONTHINKING_AUTHORIZATION_POLICY:compact?COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY:USER_UNBOUNDED_AUTHORIZATION_POLICY;
  if(!fastRank&&!step8Repair&&!localPreview&&policy.version!=="saitu.effort-policy.v1"||!compact&&!fastRank&&!step8Repair&&!localPreview&&![policy.rank,policy.explain,policy.review].every(value=>value==="low")||policyHash!==row.effort_policy_sha256||effortPolicySha256(currentDecisionEffortPolicy())!==policyHash
    ||process.env.AI_SPEND_AUTHORIZED_EFFORT!=="stage"||process.env.AI_SPEND_POLICY_SHA256!==row.policy_sha256||process.env.AI_SPEND_EFFORT_CONDITION_SHA256!==row.effort_condition_sha256
    ||!(/^[a-f0-9]{64}$/.test(row.policy_sha256))||!(/^[a-f0-9]{64}$/.test(row.effort_condition_sha256))
    ||condition?.schemaVersion!==USER_UNBOUNDED_CONDITION_SCHEMA||condition.authorization!==expectedAuthorization||condition.sourcePolicy!==expectedPolicy
    ||condition.executionMode!=="user-unbounded"||condition.policyVersion!=="saitu.policy.2026-11-09.v7.top5"||condition.implementationVersion!=="saitu.async.2026-11-09.v7.3.top5"
    ||condition.model!=="deepseek-flash"||condition.effort!=="stage"||condition.mainRunId!==row.main_run_id||condition.phase!==phase||condition.policySha256!==row.policy_sha256
    ||condition.effortPolicySha256!==policyHash||condition.freshPgRowsVerified!==true||!(/^[a-f0-9]{64}$/.test(String(condition.priorLedgerSha256??"")))
    ||!limits||Object.keys(limits).sort().join(",")!==Object.keys(USER_UNBOUNDED_EXECUTION_LIMITS).sort().join(",")||Object.values(limits).some(value=>value!==null))throw new Error("USER_UNBOUNDED_AUTHORIZATION_REQUIRED");
  return {runId,mainRunId:row.main_run_id,phase,policySha256:row.policy_sha256,effortPolicySha256:policyHash,conditionSha256:row.effort_condition_sha256};
}

export const USER_UNBOUNDED_VALIDATION_HEADER_V7="X-Saitu-Validation-Execution";
const VALIDATION_TOKEN_MAX_TTL_MS=30*60_000;
function isolatedValidationOrigin(origin:string){try{const url=new URL(origin);return ["http:","https:"].includes(url.protocol)&&url.origin===origin&&["localhost","127.0.0.1","[::1]"].includes(url.hostname);}catch{return false;}}
/** NextURL normalizes allowed loopback aliases. Preserve scheme and port. */
function canonicalValidationOrigin(origin:string){
  if(!isolatedValidationOrigin(origin))return null;
  const url=new URL(origin);url.hostname="localhost";return url.origin;
}
function validationSecret(){const value=process.env.AI_CONVERSATION_SIGNING_SECRET?.trim();if(!value||value.length<32)throw new Error("VALIDATION_EXECUTION_UNAVAILABLE");return value;}
const signValidation=(encoded:string)=>createHmac("sha256",validationSecret()).update(`saitu.validation-execution.v1\0${encoded}`).digest();
/** Collector-only helper. Do not serialize this short-lived capability into evidence. */
export function createUserUnboundedValidationTokenV7(origin:string,expiresAt=Date.now()+VALIDATION_TOKEN_MAX_TTL_MS){
  if(!isUserUnboundedExecutionMode()||!isolatedValidationOrigin(origin)||!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+VALIDATION_TOKEN_MAX_TTL_MS)throw new Error("VALIDATION_EXECUTION_INVALID");
  const encoded=Buffer.from(JSON.stringify({version:"saitu.validation-execution.v1",runId:process.env.AI_SPEND_RUN_ID,policySha256:process.env.AI_SPEND_POLICY_SHA256,origin,expiresAt})).toString("base64url");
  return `${encoded}.${signValidation(encoded).toString("base64url")}`;
}
export async function isAuthorizedUserUnboundedValidationRequestV7(request:Request,client?:QueryClient):Promise<boolean>{
  const token=request.headers.get(USER_UNBOUNDED_VALIDATION_HEADER_V7);if(!token||!isUserUnboundedExecutionMode())return false;
  try{
    if(token.length>4096||!/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(token))return false;
    const [encoded,mac]=token.split("."),signature=Buffer.from(mac,"base64url"),expected=signValidation(encoded),bytes=Buffer.from(encoded,"base64url");
    if(signature.length!==expected.length||signature.toString("base64url")!==mac||bytes.toString("base64url")!==encoded||!timingSafeEqual(signature,expected))return false;
    const value=JSON.parse(bytes.toString("utf8")),now=Date.now();
    if(value.version!=="saitu.validation-execution.v1"||!isolatedValidationOrigin(value.origin)||canonicalValidationOrigin(value.origin)!==canonicalValidationOrigin(new URL(request.url).origin)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt>now+VALIDATION_TOKEN_MAX_TTL_MS)return false;
    const authority=await readUserUnboundedExecutionAuthorizationV7(client);
    return value.runId===authority.runId&&value.policySha256===authority.policySha256;
  }catch{return false;}
}
