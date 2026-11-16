import { AsyncLocalStorage } from "node:async_hooks";
/** Request-scoped, metadata-only diagnostics. Never pass prompts, credentials or model content. */
export type ProductObservation={time:string;type:string;details:Record<string,unknown>};
export type ProductBoundary="before_product_commit"|"after_product_commit";
type Context={observer:(event:ProductObservation)=>void|Promise<void>;boundaryHook?:(boundary:ProductBoundary,details:Record<string,unknown>)=>void|Promise<void>};
const contexts=new AsyncLocalStorage<Context>();
export function withProductObservation<T>(context:Context,work:()=>T):T{return contexts.run(context,work);}
export function emitProductObservation(type:string,details:Record<string,unknown>={}){
  const context=contexts.getStore();if(!context)return;
  try{const result=context.observer({time:new Date().toISOString(),type,details:structuredClone(details)});if(result&&typeof result.then==="function")void result.catch(()=>undefined);}catch{/* Observers cannot change a paid call, retry policy or committed state. */}
}
/** Evaluation/fault hooks are separately scoped, never accepted from HTTP input. */
export async function observeProductBoundary(boundary:ProductBoundary,details:Record<string,unknown>){
  emitProductObservation(boundary,details);
  try{await contexts.getStore()?.boundaryHook?.(boundary,structuredClone(details));}catch{emitProductObservation("boundary_observer_failed",{boundary});}
}

export function withProductBoundaryHook<T>(hook:NonNullable<Context["boundaryHook"]>,work:()=>T):T{
  const current=contexts.getStore();return contexts.run({observer:current?.observer??(()=>undefined),boundaryHook:hook},work);
}

/** Adds a request-local metadata consumer without replacing or awaiting the existing observer. */
export function withProductObservationTap<T>(tap:Context["observer"],work:()=>T):T{
  const current=contexts.getStore();
  return contexts.run({...current,observer:event=>{
    for(const observer of [current?.observer,tap])if(observer)try{const result=observer(structuredClone(event));if(result&&typeof result.then==="function")void result.catch(()=>undefined);}catch{/* diagnostic failures are isolated */}
  }},work);
}

/** Public accounting metadata only. This never logs prompts, responses, tokens or credentials. */
export function withRecommendationAccountingTrace<T>(requestId:string,work:()=>T):T{
  const fields:Record<string,readonly string[]>={
    ai_budget_reserved:["reservationId","phase","model","effort","operation","effortPolicySha256","reservedMicros","priceVersion"],
    ai_transport_dispatch:["reservationId","model","attempt","operation","thinkingType","reasoningEffort","policyReasoningEffort","wireReasoningEffort","temperature","topP","effortPolicySha256","maxTokens","deadlineEpochMs","invocationId","stage","reviewId"],
    ai_budget_settled:["reservationId","chargedMicros","upstreamAttempted","state","priceVersion","operation","effort","effortPolicySha256"],
    ai_settlement_failed:["reservationId"],
    decision_model_invocation:["invocationId","candidateOrderSha256","candidateCount","factIndexSha256","factDictionarySha256","promptVersion"],
    decision_model_stage:["invocationId","stage","reviewId","status","startedAtEpochMs","completedAtEpochMs","deadlineEpochMs","promptSha256","promptBytes","ok","upstreamAttempted","reason"],
    decision_support_binding:["invocationId","startedAtEpochMs","completedAtEpochMs","deadlineEpochMs","selectedItemIds","candidateCount","reviewCount","expectedClaims","coveredClaims","bindings","bindingSha256"],
    chat_answer_stage:["stage","status","issue"],
  };
  return withProductObservationTap(event=>{
    const keys=fields[event.type];if(!keys)return;
    const details=Object.fromEntries(keys.filter(key=>event.details[key]!==undefined&&(key!=="topP"||event.details.thinkingType==="disabled")).map(key=>[key,event.details[key]]));
    console.info(JSON.stringify({event:"competition_accounting_trace",requestId,time:event.time,type:event.type,details}));
  },work);
}
