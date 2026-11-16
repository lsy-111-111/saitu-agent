import "server-only";
import {getPool,isDatabaseConfigured} from "@/lib/db/pool";
import {withAiSpendLimit} from "@/lib/ai/spend-run-context";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { emitProductObservation,withProductObservationTap } from "@/lib/ai/product-observation";
import { EvaluationNotRun } from "./evaluation-contracts";
const payloadSchema=z.object({fault:z.enum(["budget_denied","timeout","aborted","retry_after_exhaustion"]),at:z.enum(["before_dispatch","after_dispatch_before_response"]),allowedAttempts:z.number().int().nonnegative(),maxAdditionalCalls:z.number().int().nonnegative(),requestAiJsonBoundary:z.literal(true)}).strict();
type Fault={payload:z.infer<typeof payloadSchema>;boundaryAttempts:number;actualNetworkDispatches:number;injections:number};
const faults=new AsyncLocalStorage<Fault>();
let installed:typeof fetch|undefined;
/** Harness-only transport wrapper. Outside an explicit ALS fault context it is exactly a passthrough. */
function install(){
 if(globalThis.fetch===installed)return;
 const native=globalThis.fetch;
 installed=async(input,init)=>{
  const context=faults.getStore();
  const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
  if(!context||url.hostname!=="api.deepseek.com"||!/^\/(?:v1\/)?chat\/completions$/.test(url.pathname))return native(input,init);
  context.boundaryAttempts++;
  const {payload}=context;
  let dispatched=false;
  if(payload.at==="after_dispatch_before_response"&&context.actualNetworkDispatches<payload.maxAdditionalCalls){
    context.actualNetworkDispatches++;dispatched=true;
    const response=await native(input,init);
    // A discarded paid response has unknown usage. Do not infer zero or free a reservation.
    await response.body?.cancel().catch(()=>undefined);
  }
  context.injections++;
  emitProductObservation("transport_fault_injected",{origin:"synthetic_fault_injection",fault:payload.fault,at:payload.at,boundaryAttempt:context.boundaryAttempts,actualNetworkDispatched:dispatched,actualNetworkDispatches:context.actualNetworkDispatches,allowedAttempts:payload.allowedAttempts,maxAdditionalCalls:payload.maxAdditionalCalls,providerUsage:null,providerCharge:null});
  if(payload.fault==="retry_after_exhaustion")return new Response(JSON.stringify({error:{message:"synthetic retry-after exhaustion fixture"}}),{status:429,headers:{"content-type":"application/json","retry-after":"86400","x-saitu-synthetic-fault":"1"}});
  throw new DOMException(`synthetic_${payload.fault}_transport_fault`,"AbortError");
 };
 globalThis.fetch=installed;
}
/** Changes an actual requestAiJson fetch boundary, never a wrapper verdict or expected-answer rule. */
export async function withEvaluationTransportFault<T>(raw:unknown,work:()=>Promise<T>){
 const payload=payloadSchema.parse(raw);
 if(payload.fault==="budget_denied"){
   if(!isDatabaseConfigured())throw new EvaluationNotRun("actual_budget_postgres_required");
   if(payload.at!=="before_dispatch")throw new EvaluationNotRun("budget_reservation_precedes_transport_dispatch");
   const runId=process.env.AI_SPEND_RUN_ID?.trim();if(!runId)throw new EvaluationNotRun("existing_main_budget_authority_required");
   // This server-only fault reduces the effective cap; it cannot create or select a different run.
   const before=await getPool().query("select count(*)::int as reservations,coalesce(sum(coalesce(charged_micros,reserved_micros)),0)::text as charged_micros from ai_spend_ledger where run_id=$1",[runId]);
   emitProductObservation("budget_fixture_injected",{origin:"synthetic_fault_injection",runId,hardLimitMicros:1,actualDatabase:true,scope:"lower_cap_only"});
   const context:Fault={payload,boundaryAttempts:0,actualNetworkDispatches:0,injections:0};install();
   let denied=0;
   const output=await withProductObservationTap(event=>{if(event.type==="ai_budget_denied")denied++;},()=>faults.run(context,()=>withAiSpendLimit(1,work)));
   const rows=await getPool().query("select count(*)::int as reservations,coalesce(sum(coalesce(charged_micros,reserved_micros)),0)::text as charged_micros from ai_spend_ledger where run_id=$1",[runId]);
   const ledger={reservations:rows.rows[0].reservations-before.rows[0].reservations,charged_micros:Number(rows.rows[0].charged_micros)-Number(before.rows[0].charged_micros)};
   if(!denied)throw new EvaluationNotRun("actual_budget_denial_boundary_not_reached");
   emitProductObservation("budget_fixture_observed",{runId,hardLimitMicros:1,reservations:ledger.reservations,chargedMicros:Number(ledger.charged_micros),actualNetworkDispatches:context.actualNetworkDispatches,transportBoundaryAttempts:context.boundaryAttempts});
   return {perturbedResult:output,mutationProof:{fault:payload.fault,runId,actualDatabase:true,hardLimitMicros:1,reservations:ledger.reservations,chargedMicros:Number(ledger.charged_micros),transportBoundaryAttempts:context.boundaryAttempts,actualNetworkDispatches:context.actualNetworkDispatches},applicability:"observed"};
 }
 if(payload.at==="after_dispatch_before_response"&&payload.maxAdditionalCalls<1)throw new EvaluationNotRun("after_dispatch_fault_requires_authorized_network_attempt");
 const context:Fault={payload,boundaryAttempts:0,actualNetworkDispatches:0,injections:0};install();
 const output=await faults.run(context,work);
 if(!context.injections)throw new EvaluationNotRun("actual_requestAiJson_transport_boundary_not_reached");
 return {perturbedResult:output,mutationProof:{fault:payload.fault,at:payload.at,boundaryAttempts:context.boundaryAttempts,actualNetworkDispatches:context.actualNetworkDispatches,allowedAttempts:payload.allowedAttempts,maxAdditionalCalls:payload.maxAdditionalCalls,providerUsage:null,providerCharge:null},applicability:"observed"};
}
