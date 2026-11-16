import "server-only";
import {withEvaluationCatalogFixture} from "./evaluation-catalog-fixture";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { POST } from "@/app/api/ai/competition-chat/route";
import { isDatabaseConfigured } from "@/lib/db/pool";
import { getCurrentAiConsentDisclosure } from "@/lib/ai/consent-disclosure";
import { withProductBoundaryHook,emitProductObservation } from "@/lib/ai/product-observation";
import { competitionRecommendationProfileV5Schema } from "@/lib/ai/competition-request-schema";
import {createStudentProfile} from "./profile";
import { buildRuleDecisionReport } from "./engine";
import { initializeDecisionState,readDecisionState,verifyDecisionToken } from "./decision-state";
import { acceptDecisionChatResponse,decisionChatReplySchema,type DecisionChatRequest } from "./chat-contracts";
import { canonicalHash,EvaluationNotRun } from "./evaluation-contracts";

const stepSchema=z.object({id:z.string().min(1),action:z.enum(["initialize","propose_goal","confirm_proposal","reject_proposal","read_state","replay_request","cancel","rotate_catalog_fixture","inject_client_fields","swap_response"]),using:z.string().optional(),mutate:z.record(z.unknown()).optional(),parallelGroup:z.string().optional(),hook:z.literal("before_product_commit").optional()}).strict();
const payloadSchema=z.object({fixture:z.object({initialGoal:z.string(),updatedGoal:z.string(),alternateGoal:z.string()}),steps:z.array(stepSchema).min(1).max(40),observe:z.object({durableState:z.literal(true),revision:z.literal(true),upstreamCalls:z.literal(true)})}).strict();
type Step=z.infer<typeof stepSchema>;
type Live={stateId:string;profileId:string;decisionToken:string;profileRevision:string;catalogVersion:string;proposal?:{id:string};request?:Record<string,unknown>;response?:unknown;httpStatus?:number;accepted?:boolean};
/** Shared production HTTP handler, encrypted PG store and browser response-consumption function. */
export async function runEvaluationChatSteps(raw:unknown,options:{asOf:string;modelMode:"disabled"|"live"|"mock_unit"}){
  const payload=payloadSchema.parse(raw);
  return payload.steps.some(step=>step.action==="rotate_catalog_fixture")?withEvaluationCatalogFixture(rotate=>executeChatSteps(payload,options,rotate)):executeChatSteps(payload,options);
}
async function executeChatSteps(raw:unknown,options:{asOf:string;modelMode:"disabled"|"live"|"mock_unit"},rotateCatalog?:(()=>Record<string,unknown>)){
  if(!isDatabaseConfigured())throw new EvaluationNotRun("durable_postgres_required");
  if(options.modelMode==="disabled")throw new EvaluationNotRun("chat_model_execution_not_authorized");
  if(options.modelMode==="mock_unit"&&process.env.NODE_ENV!=="test")throw new EvaluationNotRun("mock_unit_mode_requires_test_environment");
  const payload=payloadSchema.parse(raw),steps=new Map<string,Live>(),latest=new Map<string,Live>(),observations:unknown[]=[];
  const pending=new Map<string,{controller:AbortController;release:()=>void;done:Promise<Live>;settled:Promise<void>}>();
  const knownIds=new Set<string>();for(const step of payload.steps){if(knownIds.has(step.id))throw new EvaluationNotRun("duplicate_chat_step_id");knownIds.add(step.id);}
  const resolve=(reference:unknown):unknown=>{
    if(typeof reference!=="string")throw new EvaluationNotRun("invalid_step_reference");
    const [head,...parts]=reference.split(".");let value:unknown=head==="fixture"?payload.fixture:steps.get(head);
    for(const part of parts){if(["__proto__","prototype","constructor"].includes(part)||!value||typeof value!=="object"||!Object.hasOwn(value,part))throw new EvaluationNotRun("step_reference_missing");value=(value as Record<string,unknown>)[part];}
    return value;
  };
  const emit=(type:string,details:Record<string,unknown>)=>emitProductObservation(type,details);
  const snapshot=async(live:Live)=>{const state=await readDecisionState(live.stateId);return state?{profile:state.report.profile,generation:state.generation,proposal:state.proposal,lastRequestId:state.lastRequestId??null,catalogVersion:state.report.catalogVersion}:null;};
  async function dispatch(live:Live,body:Record<string,unknown>,controller=new AbortController(),swap?:Live):Promise<Live>{
    const before=await snapshot(live),bytes=JSON.stringify(body);
    emit("chat_transport_dispatch",{requestId:body.requestId,profileId:live.profileId,expectedRevision:body.expectedRevision,bodySha256:canonicalHash(body)});
    const response=await POST(new Request("http://localhost/api/ai/competition-chat",{method:"POST",headers:{"content-type":"application/json","x-request-id":String(body.requestId)},body:bytes,signal:controller.signal}));
    const actual=await response.json(),delivered=swap?.response??actual;
    if(swap)emit("chat_response_injected",{origin:"synthetic_fault_injection",actualResponseSha256:canonicalHash(actual),deliveredResponseSha256:canonicalHash(delivered)});
    const parsed=decisionChatReplySchema.safeParse(delivered);
    const accepted=parsed.success&&acceptDecisionChatResponse(parsed.data,body as DecisionChatRequest,live.profileId);
    emit("chat_response_consumed",{requestId:body.requestId,httpStatus:response.status,accepted,binding:parsed.success?parsed.data.binding??null:null,actualResponseSha256:canonicalHash(actual)});
    const result:Live={...live,request:body,response:delivered,httpStatus:response.status,accepted};
    if(accepted&&parsed.success){result.decisionToken=parsed.data.decisionToken;result.profileRevision=parsed.data.profileRevision;result.proposal=parsed.data.proposal;result.catalogVersion=parsed.data.binding!.catalogVersion;latest.set(live.stateId,result);}
    const sanitizedRequest:Record<string,unknown>={...body,decisionTokenSha256:canonicalHash(body.decisionToken)};delete sanitizedRequest.decisionToken;
    const sanitizedResponse=parsed.success?{...parsed.data,decisionToken:undefined,decisionTokenSha256:canonicalHash(parsed.data.decisionToken)}:delivered;
    observations.push({request:sanitizedRequest,response:sanitizedResponse,httpStatus:response.status,accepted,idempotentReplay:response.headers.get("x-idempotent-replay")==="true",before,after:await snapshot(live)});
    return result;
  }
  const consent=()=>({accepted:true,version:getCurrentAiConsentDisclosure().version});
  const bodyFor=(live:Live,action:unknown)=>({decisionToken:live.decisionToken,expectedRevision:live.profileRevision,expectedProfileId:live.profileId,expectedCatalogVersion:live.catalogVersion,requestId:`sealed-${randomUUID()}`,aiConsent:consent(),action});
  async function execute(step:Step,frozenLatest?:Map<string,Live>):Promise<Live>{
    if(step.action==="rotate_catalog_fixture"){
      if(!rotateCatalog||step.mutate?.newFixtureVersion!==true)throw new EvaluationNotRun("actual_catalog_rotation_fixture_required");
      const live=steps.get(step.using??"")??[...latest.values()].at(-1);if(!live)throw new EvaluationNotRun("catalog_switch_requires_initialized_profile");
      const proof=rotateCatalog();emit("catalog_fixture_injected",proof);observations.push({stepId:step.id,action:step.action,mutationProof:proof,state:await snapshot(live)});return live;
    }
    if(step.action==="initialize"){
      const goal=resolve(step.using??"fixture.initialGoal");if(typeof goal!=="string")throw new EvaluationNotRun("initial_goal_string_required");
      // Preregistered neutral stage is an explicit fixture fact, never inferred from a challenge label.
      const legacy=competitionRecommendationProfileV5Schema.parse({profileVersion:"competition-profile.v5",questionnaireVersion:"competition-questionnaire.v1",stage:"undergraduate-2",majorFields:[],specificSubjects:[],skills:[],interests:[],goals:[],preferredOutputs:[],startingPoint:"idea_only",weeklyCommitment:"under-5",teamStatus:"solo",availableResources:[],participationMode:"flexible",participationTiming:"flexible",taskFormats:[],experienceLevel:"none",evidence:[],confirmedFields:["stage"],confirmedFacts:[]});
      const created=await initializeDecisionState({sessionId:`sealed-${randomUUID()}`,expiresAt:Date.now()+20*60_000,legacy,report:buildRuleDecisionReport(legacy,{now:new Date(options.asOf),profile:createStudentProfile(legacy,{profileId:`sealed-profile-${randomUUID()}`})})});
      const stateId=verifyDecisionToken(created.decisionToken)!.id;
      let live:Live={stateId,profileId:created.report.profile.profileId,decisionToken:created.decisionToken,profileRevision:created.report.profile.revision,catalogVersion:created.report.catalogVersion};
      live=await dispatch(live,bodyFor(live,{type:"message",text:`我的目标是${goal}`}));
      if(!live.proposal)throw new EvaluationNotRun(`initial_goal_did_not_produce_real_proposal:${live.httpStatus}:${(live.response as {error?:string;kind?:string})?.error??(live.response as {kind?:string})?.kind??"no_response"}`);
      live=await dispatch(live,bodyFor(live,{type:"confirm_update",proposalId:live.proposal.id}));
      if(!live.accepted||live.httpStatus!==200)throw new EvaluationNotRun("initial_goal_confirmation_failed");
      latest.set(stateId,live);return live;
    }
    if(step.action==="cancel"){
      const target=pending.get(step.using??"");if(!target)throw new EvaluationNotRun("no_parked_actual_request");
      emit("chat_cancel_injected",{stepId:step.id,targetStep:step.using});target.controller.abort(new Error("evaluation_cancel_before_commit"));target.release();
      const result=await target.done;await target.settled;pending.delete(step.using!);return result;
    }
    const referenced=steps.get(step.using??"");if(!referenced)throw new EvaluationNotRun("chat_step_reference_missing");
    const live=(frozenLatest??latest).get(referenced.stateId)??referenced;
    if(step.action==="read_state"){observations.push({stepId:step.id,action:step.action,state:await snapshot(referenced)});return live;}
    const mutation=step.mutate??{};let body:Record<string,unknown>;
    if(step.action==="replay_request"||mutation.exactRequestIdAndPayload===true){if(!referenced.request)throw new EvaluationNotRun("real_request_to_replay_missing");body=structuredClone(referenced.request);}
    else if(step.action==="confirm_proposal"||step.action==="reject_proposal"){
      if(!referenced.proposal)throw new EvaluationNotRun("real_proposal_required");
      body=bodyFor(live,{type:step.action==="confirm_proposal"?"confirm_update":"reject_update",proposalId:referenced.proposal.id});
    }else if(step.action==="inject_client_fields"){
      const utterance=resolve(mutation.utteranceFrom);if(typeof utterance!=="string")throw new EvaluationNotRun("utterance_reference_required");
      body=bodyFor(live,{type:"extract_profile",utterance,requestedFields:["goalIntent"]});
      if(mutation.untrustedFields&&typeof mutation.untrustedFields==="object")for(const [key,value]of Object.entries(mutation.untrustedFields))body[key]=typeof value==="string"&&value.startsWith("fixture.")?resolve(value):value;
    }else {const goal=resolve(mutation.goalFrom??"fixture.updatedGoal");if(typeof goal!=="string")throw new EvaluationNotRun("goal_reference_required");body=bodyFor(live,{type:"message",text:`我的目标改为${goal}`});}
    if(mutation.expectedRevisionFrom)body.expectedRevision=resolve(mutation.expectedRevisionFrom);
    if(mutation.decisionTokenFrom)body.decisionToken=resolve(mutation.decisionTokenFrom);
    const swap=mutation.responseFrom?steps.get(String(mutation.responseFrom)):undefined;
    if(step.action==="swap_response"&&(!swap?.response||mutation.at!=="after_dispatch_before_response"))throw new EvaluationNotRun("real_response_swap_reference_required");
    if(step.hook){
      let release!:()=>void,reached!:()=>void,settle!:()=>void;const settled=new Promise<void>(r=>{settle=r;}),parked=new Promise<void>(r=>{reached=r;}),resume=new Promise<void>(r=>{release=r;}),controller=new AbortController();
      const done=withProductBoundaryHook(async(boundary)=>{if(boundary==="before_product_commit"){reached();await resume;}else if(boundary==="after_product_commit")settle();},()=>dispatch(live,body,controller,swap));
      pending.set(step.id,{controller,release,done,settled});
      let timer:ReturnType<typeof setTimeout>|undefined;
      const outcome=await Promise.race([parked.then(()=>"parked"),done.then(()=>"completed"),new Promise<string>(r=>{timer=setTimeout(()=>r("timeout"),12_000);})]);if(timer)clearTimeout(timer);
      if(outcome!=="parked"){controller.abort();release();await done;pending.delete(step.id);throw new EvaluationNotRun("before_commit_hook_not_reached");}
      emit("chat_commit_parked",{stepId:step.id,stateKey:live.stateId});return live;
    }
    return dispatch(live,body,undefined,swap);
  }
  try{
    for(let index=0;index<payload.steps.length;){const step=payload.steps[index];
      if(step.parallelGroup){const group:Step[]=[];while(payload.steps[index]?.parallelGroup===step.parallelGroup)group.push(payload.steps[index++]);const frozen=new Map(latest);
        const confirms=group.filter(s=>s.action==="confirm_proposal"||s.action==="reject_proposal");
        for(const member of confirms){const referenced=steps.get(member.using??"");const current=referenced?frozen.get(referenced.stateId):undefined;if(!referenced?.proposal||current?.proposal?.id!==referenced.proposal.id)throw new EvaluationNotRun("parallel_proposals_not_simultaneously_applicable_to_real_state");}
        emit("chat_parallel_dispatch",{group:step.parallelGroup,stepIds:group.map(s=>s.id)});const results=await Promise.all(group.map(s=>execute(s,frozen)));group.forEach((s,i)=>steps.set(s.id,results[i]));}
      else {steps.set(step.id,await execute(step));index++;}
    }
    if(pending.size)throw new EvaluationNotRun("parked_request_without_cancel_or_release");
    return {steps:observations,finalStates:await Promise.all([...latest.values()].map(snapshot)),durableState:true,applicability:"observed"};
  }catch(failure){if(failure instanceof EvaluationNotRun)failure.partialOutput={steps:observations,finalStates:await Promise.all([...latest.values()].map(snapshot)),durableState:true,applicability:"not_run"};throw failure;}finally{for(const request of pending.values()){request.controller.abort();request.release();}await Promise.allSettled([...pending.values()].map(p=>p.done));}
}
