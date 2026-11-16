import "server-only";
import { z } from "zod";
import { withProductObservation } from "@/lib/ai/product-observation";
import { isDatabaseConfigured } from "@/lib/db/pool";
import { extractProfileFacts,type ProductModelOptions } from "./extract-profile";
import { observeProfileConversation } from "./conversation-observations";
import { qualifySourceCondition,judgeSourceClaims } from "./source-judgments";
import { canonicalProfileInput } from "./canonical-adapter";
import { buildDecisionContext } from "./engine";
import { runDecisionRecommendation } from "./model";
import { getDecisionCatalog } from "./catalog";
import type { DecisionCompetitionRecord } from "./catalog-types";
import { domainFactSchema,domainFieldSchema } from "./domain-facts";
import { withEvidenceRegistry,type EvidenceRegistryLocation } from "./evidence-registry-context";
import { withEvaluationTransportFault } from "./evaluation-transport-fault";
import { runEvaluationChatSteps } from "./evaluation-chat-driver";
import { withEvaluationSourceMutation } from "./evaluation-source-registry";
import { applyEvaluationTextTransform } from "./evaluation-input-transform";
import { invocationSchema,canonicalHash,EVALUATION_ADAPTER_VERSION,EvaluationNotRun,type EvaluationInvocation,type EvaluationObservation,type EvaluationEvent,type EvaluationOperation } from "./evaluation-contracts";
export type EvaluationOptions={modelMode:"disabled"|"live"|"mock_unit";method?:"rules"|"llm";asOf:string;registry?:EvidenceRegistryLocation;records?:DecisionCompetitionRecord[];modelOptions?:ProductModelOptions;requestId?:string;onCandidatePool?:(pool:Record<string,unknown>)=>void};
const sourceInput=z.object({seriesId:z.string(),evidenceIds:z.array(z.string()),editionScope:z.string().optional(),sourcePacket:z.unknown().optional(),question:z.string().optional()}).passthrough();
const claimInput=sourceInput.extend({claims:z.array(z.object({id:z.string(),text:z.string()}))});
const conditionInput=sourceInput.extend({editionScope:z.string(),target:z.object({kind:z.enum(["student_eligibility","submission_constraint","participation_constraint"]),field:z.string()}),facts:z.unknown()});
const extractInput=z.object({utterance:z.string(),context:z.unknown().optional(),requestedFields:z.array(domainFieldSchema)}).passthrough();
const conversationInput=z.object({initialFacts:z.array(domainFactSchema),turns:z.array(z.object({id:z.string(),text:z.string()})),requestedFields:z.array(domainFieldSchema),checkpoints:z.array(z.object({afterTurn:z.union([z.string(),z.number()]),request:z.unknown().optional()}))}).passthrough();
const sourceHazards=new Set(["source_metadata_only","source_scope_mismatch","source_conflicting_update","source_retracted"]);
const chatHazards=new Set(["duplicate_delivery","stale_revision","mismatched_profile_id","mismatched_catalog_version","unconfirmed_side_channel","cancel_before_commit","parallel_profile_updates","response_replay_wrong_case"]);
const textHazards=new Set(["unicode_normalization","fullwidth_numeric","zero_width_separator","quoted_other_person","hypothetical_conditional","control_character_input","oversized_input"]);
export function evaluationCapabilities(options:EvaluationOptions){return ["input_text_transform","profile_full_state","conversation_snapshots","transport_fault",...(options.registry?["source_packet","source_registry_mutation"]:[]),...(isDatabaseConfigured()?["revision_commit","idempotent_commit","cancel_commit","concurrent_commit","response_binding","usage_budget","catalog_version_binding"]:[])];}
function modelAllowed(options:EvaluationOptions){if(options.modelMode==="disabled")throw new EvaluationNotRun("model_execution_not_authorized");if(options.modelMode==="mock_unit"&&process.env.NODE_ENV!=="test")throw new EvaluationNotRun("mock_unit_mode_requires_test_environment");}
export async function invokeDirectProduct(operation:Exclude<EvaluationOperation,"robustness">,raw:unknown,options:EvaluationOptions):Promise<unknown>{
  if(operation==="extract_profile"){modelAllowed(options);return extractProfileFacts(extractInput.parse(raw),options.modelOptions);}
  if(operation==="conversation"){modelAllowed(options);return observeProfileConversation(conversationInput.parse(raw),options.modelOptions);}
  if(operation==="qualify"){modelAllowed(options);const parsed=conditionInput.parse(raw);return qualifySourceCondition({...parsed,facts:parsed.facts},options.modelOptions);}
  if(operation==="fact_check"){modelAllowed(options);return judgeSourceClaims(claimInput.parse(raw),options.modelOptions);}
  const input=z.object({profile:z.unknown()}).passthrough().parse(raw),{profile,legacy}=canonicalProfileInput(input.profile);
  const records=structuredClone(options.records??getDecisionCatalog());
  const context=buildDecisionContext(legacy,{profile,records,now:new Date(options.asOf)});
  if(options.method==="llm")modelAllowed(options);
  const report=await runDecisionRecommendation(legacy,{context,method:options.method??"rules",...options.modelOptions});
  // The report is the real product object; evaluation data is outside its profile and prompts.
  options.onCandidatePool?.({catalogVersion:context.catalogVersion,recordsSha256:canonicalHash(records),candidateItemIds:context.candidates.map(c=>c.record.recordId),excluded:[...context.excluded].map(([itemId,reason])=>({itemId,reason})),rankingEvaluation:"pending_review"});
  return report;
}
export async function invokeEvaluationProduct(raw:EvaluationInvocation,options:EvaluationOptions):Promise<EvaluationObservation>{
  const started=Date.now(),input=invocationSchema.parse(raw),events:EvaluationEvent[]=[];
  const requestId=options.requestId??input.caseId;
  const event=(type:string,origin:EvaluationEvent["origin"],details:Record<string,unknown>={})=>events.push({seq:events.length+1,time:new Date().toISOString(),type,requestId,origin,details});
  options={...options,onCandidatePool:pool=>{event("candidate_pool_frozen","transport",pool);}};
  const base={caseId:input.caseId,inputSha256:input.inputSha256,operation:input.operation,adapterVersion:EVALUATION_ADAPTER_VERSION,capabilities:evaluationCapabilities(options)};
  let status:EvaluationObservation["status"]="observed",output:unknown=null,error:string|null=null;
  const execute=async()=>{
    if(canonicalHash(input.input)!==input.inputSha256)throw new EvaluationNotRun("input_sha256_mismatch");
    if(!Number.isFinite(Date.parse(options.asOf)))throw new EvaluationNotRun("invalid_frozen_time");
    event("request_dispatch","transport",{operation:input.operation,inputSha256:input.inputSha256});
    if(input.operation!=="robustness")return invokeDirectProduct(input.operation,input.input,options);
    const robust=z.object({baseOperation:z.enum(["qualify","fact_check","recommend","extract_profile","conversation"]),baseInput:z.unknown(),baseInputSha256:z.string().optional(),perturbation:z.object({kind:z.string(),payload:z.unknown()}),execution:z.object({requiresCapabilities:z.array(z.string()),path:z.string(),observationMode:z.string()}).optional()}).passthrough().parse(input.input);
    if(robust.baseInputSha256&&canonicalHash(robust.baseInput)!==robust.baseInputSha256)throw new EvaluationNotRun("base_input_sha256_mismatch");
    const missing=robust.execution?.requiresCapabilities.filter(c=>!base.capabilities.includes(c));if(missing?.length)throw new EvaluationNotRun(`missing_capabilities:${missing.join(",")}`);
    if(robust.perturbation.kind==="retry_budget_exhausted")return withEvaluationTransportFault(robust.perturbation.payload,()=>invokeDirectProduct(robust.baseOperation,robust.baseInput,options));
    if(chatHazards.has(robust.perturbation.kind))return runEvaluationChatSteps(robust.perturbation.payload,options);
    if(sourceHazards.has(robust.perturbation.kind)){
      if(!options.registry)throw new EvaluationNotRun("frozen_registry_required");
      const baseResult=await invokeDirectProduct(robust.baseOperation,robust.baseInput,options);
      return withEvaluationSourceMutation(options.registry,robust.perturbation.payload,async(location,mutationProof)=>{
        event("source_registry_mutation","injected",mutationProof);
        const perturbedResult=await withEvidenceRegistry(location,()=>invokeDirectProduct(robust.baseOperation,robust.baseInput,{...options,registry:location}));
        return {baseResult,perturbedResult,mutationProof,applicability:"observed"};
      });
    }
    if(!textHazards.has(robust.perturbation.kind))throw new EvaluationNotRun(`unsupported_actual_hook:${robust.perturbation.kind}`);
    const {transformed,mutationProof}=applyEvaluationTextTransform(robust.baseInput,robust.perturbation.payload);
    const baseResult=await invokeDirectProduct(robust.baseOperation,robust.baseInput,options);
    event("input_text_transform","injected",mutationProof);
    const perturbedResult=await invokeDirectProduct(robust.baseOperation,transformed,options);
    return {baseResult,perturbedResult,mutationProof,applicability:"observed",capabilities:base.capabilities};
  };
  try{output=await withProductObservation({observer:e=>{event(e.type,e.type.endsWith("_injected")?"injected":"product",e.details);}},()=>options.registry?withEvidenceRegistry(options.registry,execute):execute());event("response_received","transport",{outputSha256:canonicalHash(JSON.parse(JSON.stringify(output)))});}catch(failure){status=failure instanceof EvaluationNotRun?"not_run":"error";if(failure instanceof EvaluationNotRun&&failure.partialOutput!==undefined)output=failure.partialOutput;error=failure instanceof Error?failure.message:"product_execution_failed";event("execution_failed","transport",{status,error});}
  const record=output&&typeof output==="object"?output as Record<string,unknown>:{};
  const usage=events.filter(e=>["ai_attempt_result","ai_budget_reserved","ai_budget_settled","ai_budget_denied","ai_settlement_failed"].includes(e.type));
  return {...base,status,output,error,fallback:record.fallback===true||Boolean((record.fallback as {used?:boolean}|undefined)?.used),elapsedMs:Date.now()-started,events,usage:usage.length?usage:null,productBinding:events.filter(e=>e.type==="chat_response_consumed").map(e=>({requestId:e.details.requestId,binding:e.details.binding,accepted:e.details.accepted}))};
}
