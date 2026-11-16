import "server-only";
import { randomUUID } from "node:crypto";
import { withDurableAiRun } from "@/lib/ai/durable-call";
import { getOfficialEntry } from "./catalog";
import { rankDecisionV7, explainDecisionV7, assertRankRoleBindingsV7 } from "./model";
import { generateGroupExplanationV7, reviewPreparedGroupV7 } from "./explanation-groups";
import { processDetailGroupsV7, type GroupWorkerModelsV7 } from "./group-worker";
import { recommendationRuntimeBindingV7 } from "./runtime-binding";
import { claimRunV7, createRunWriterV7, readFrozenRunEffortPolicyV7, readFrozenRunDetailLayoutV7, readFrozenRunExecutionPolicyV7, readFrozenRunExecutionModeV7, releaseRunLeaseV7, renewRunLeaseV7, restoreContextV7, type ClaimedRunV7, type RunBodyV7 } from "./store";
import { RECOMMENDATION_IMPLEMENTATION_VERSION, RECOMMENDATION_POLICY_VERSION } from "./contracts";
import { withDecisionEffortPolicy } from "@/lib/ai/effort-context";
import {readExecutionMode} from "@/lib/ai/execution-policy.mjs";
import {readUserUnboundedAuthorizationBeforeV7} from "@/lib/ai/model-call-governor";
import {EFFORT_POLICY_VERSION_V2,requireCompactRecommendationEffortPolicy,requireRankNonThinkingEffortPolicy} from "@/lib/ai/effort-policy.mjs";
import {readConfiguredDetailLayoutV7} from "./detail-layout.mjs";

type WorkerModels = {rank:typeof rankDecisionV7}&(GroupWorkerModelsV7|{explain:typeof explainDecisionV7});
/** One phase per lease lets waiting rankings run before background explanations. */
export async function processClaimedRunV7(claim:ClaimedRunV7,models:WorkerModels={rank:rankDecisionV7,generate:generateGroupExplanationV7,review:reviewPreparedGroupV7},signal?:AbortSignal,canDispatch?:()=>boolean) {
  const writer=createRunWriterV7(claim);
  const controller=new AbortController();const abort=()=>controller.abort();
  signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)controller.abort();
  const heartbeat=setInterval(()=>{void renewRunLeaseV7(claim).then(ok=>{if(!ok)controller.abort();},()=>controller.abort());},6000);
  heartbeat.unref();
  try{
    if(canDispatch&&!canDispatch())throw new Error("DECISION_RELEASE_INACTIVE");
    if(claim.row.implementation_version!==RECOMMENDATION_IMPLEMENTATION_VERSION||claim.body.implementationSha256!==recommendationRuntimeBindingV7()||claim.body.sessionGeneration===undefined)throw new Error("DECISION_IMPLEMENTATION_CHANGED");
    const executionMode=readFrozenRunExecutionModeV7(claim);
    if(executionMode!==readExecutionMode())throw new Error("DECISION_EXECUTION_MODE_CHANGED");
    if(executionMode==="user-unbounded"){
      const deadline=(claim.body.plan?claim.row.detail_deadline_at:claim.row.list_deadline_at).getTime();
      if(Date.now()>=deadline)throw new Error(claim.body.plan?"DETAIL_DEADLINE_EXCEEDED":"LIST_DEADLINE_EXCEEDED");
      if(JSON.stringify(await readUserUnboundedAuthorizationBeforeV7(deadline,controller.signal))!==JSON.stringify(claim.body.executionAuthorization))throw new Error("DECISION_EXECUTION_AUTHORIZATION_CHANGED");
    }
    let effortPolicy,executionPolicy;
    try {effortPolicy=readFrozenRunEffortPolicyV7(claim.body);executionPolicy=readFrozenRunExecutionPolicyV7(claim);
      if(effortPolicy.version===EFFORT_POLICY_VERSION_V2)requireRankNonThinkingEffortPolicy(effortPolicy);
      else requireCompactRecommendationEffortPolicy(effortPolicy);
      if(executionPolicy.policyVersion!==RECOMMENDATION_POLICY_VERSION||readFrozenRunDetailLayoutV7(claim.body)!==readConfiguredDetailLayoutV7())throw new Error("invalid_execution_policy");
    }catch {throw new Error("DECISION_IMPLEMENTATION_CHANGED");}
    const context=restoreContextV7(claim.body);
    let rankDiagnostic: NonNullable<RunBodyV7["auditObservations"]>[number] | undefined;
    const onObservation:NonNullable<Parameters<typeof rankDecisionV7>[1]>["onObservation"]=async event=>{
      if(event.stage!=="v7.audit")return;
      if(event.kind==="validation"&&event.data!==null&&typeof event.data==="object"&&Reflect.get(event.data,"source")==="rank_diagnostics"){
        // Persist with the existing ranked result. An optional observation
        // must never add a write to the deadline or poison the run writer.
        rankDiagnostic=event;
        return;
      }
      await writer.update((body,status)=>{
        const observations=body.auditObservations??[];
        if(observations.some(value=>JSON.stringify(value)===JSON.stringify(event)))return null;
        return {status,body:{...body,auditObservations:[...observations,event]}};
      });
    };
    await withDecisionEffortPolicy(effortPolicy,()=>withDurableAiRun({runId:claim.row.run_id,owner:claim.owner,fence:claim.fence,canDispatch,effortPolicySha256:claim.body.effortPolicySha256,executionMode,authorizationRunId:claim.body.executionAuthorization?.runId,
      requestVersion:{recommendationPolicyVersion:executionPolicy.policyVersion,implementationVersion:claim.row.implementation_version}},async()=>{
      if(!claim.body.plan){
        if(Date.now()>=claim.row.list_deadline_at.getTime())throw new Error("LIST_DEADLINE_EXCEEDED");
        await writer.update(body=>({status:"ranking",body}));
        const plan=await models.rank(context,{requestId:claim.row.run_id,signal:controller.signal,deadlineEpochMs:claim.row.list_deadline_at.getTime()-750,onObservation});
        if(controller.signal.aborted)throw new Error("DECISION_LEASE_LOST");
        if(Date.now()>=claim.row.list_deadline_at.getTime())throw new Error("LIST_DEADLINE_EXCEEDED");
        if(plan.recommendations.length>executionPolicy.maxItems||plan.recommendations.length<executionPolicy.maxItems&&!plan.shortfallReason?.trim())throw new Error("INVALID_RANKING_ITEM_COUNT");
        const usedSeries=new Set<string>();
        const items=plan.recommendations.map((chosen,index)=>{
          const candidate=context.candidates.find(candidate=>candidate.record.recordId===chosen.itemId);
          if(!candidate||usedSeries.has(candidate.record.seriesId))throw new Error("INVALID_RANKING_IDENTITY");
          usedSeries.add(candidate.record.seriesId);const record=candidate.record;
          return {rank:index+1,itemId:record.recordId,seriesId:record.seriesId,name:record.name,trackLabel:record.track.name,
            edition:record.edition,officialUrl:getOfficialEntry(record)?.url??null,detailStatus:"pending" as const};
        });
        // A fresh model decision must carry its exact same-owner role path.
        // Existing persisted plans are read as frozen, never filled from prose.
        assertRankRoleBindingsV7(context,plan);
        await writer.update(body=>{
          const observations=body.auditObservations??[];
          const additional=rankDiagnostic&&!observations.some(value=>JSON.stringify(value)===JSON.stringify(rankDiagnostic))
            ? {auditObservations:[...observations,rankDiagnostic]} : {};
          return {status:"list_ready",body:{...body,plan,items,listReadyAt:new Date().toISOString(),shortfallReason:plan.shortfallReason,
            ...additional}};
        });
      }else{
        if(Date.now()>=claim.row.detail_deadline_at.getTime())throw new Error("DETAIL_DEADLINE_EXCEEDED");
        if(!("explain" in models)){
          await processDetailGroupsV7({claim,writer,context,plan:claim.body.plan,controller,canDispatch,onObservation,models});
          return;
        }
        // Retain the explicit legacy model-injection seam for old contract
        // regressions; normal worker execution always uses the grouped core.
        await writer.update(body=>({status:"explaining",body}));
        const report=await models.explain(context,claim.body.plan,{requestId:claim.row.run_id,signal:controller.signal,deadlineEpochMs:claim.row.detail_deadline_at.getTime()-750,onObservation});
        if(controller.signal.aborted)throw new Error("DECISION_LEASE_LOST");
        if(Date.now()>=claim.row.detail_deadline_at.getTime())throw new Error("DETAIL_DEADLINE_EXCEEDED");
        if(report.profile.revision!==context.profile.revision||report.catalogVersion!==context.catalogVersion||report.fallback.used||report.trace.method!=="llm"||report.recommendations.length!==claim.body.items.length||report.recommendations.length>executionPolicy.maxItems)throw new Error("INVALID_DETAIL_BINDING");
        const items=claim.body.items.map(item=>{
          const detail=report.recommendations.find(value=>value.itemId===item.itemId&&value.rank===item.rank&&value.seriesId===item.seriesId);
          if(!detail)throw new Error("MISSING_SELECTED_DETAIL");
          return {...item,detailStatus:"ready" as const,detail};
        });
        await writer.update(body=>({status:"ready",body:{...body,items,report,detailsReadyAt:new Date().toISOString()}}));
      }
    }));
  }catch(error){
    const message=error instanceof Error?error.message:"DECISION_WORKER_FAILED";
    const code=/^[A-Za-z0-9_.:-]{1,180}$/.test(message)?message:"DECISION_WORKER_FAILED";
    if(!controller.signal.aborted&&!["DECISION_LEASE_LOST","DECISION_RELEASE_INACTIVE","aborted"].includes(code))await writer.update(body=>({status:"failed",body:{...body,error:code,items:body.items.map(item=>item.detailStatus==="ready"?item:{...item,detailStatus:"failed"})}})).catch(()=>undefined);
    console.warn(JSON.stringify({event:"decision_v7_worker_failed",runId:claim.row.run_id,code}));
  }finally{clearInterval(heartbeat);signal?.removeEventListener("abort",abort);await releaseRunLeaseV7(claim);}
}
export async function workNextRunV7(owner=`worker-${randomUUID()}`,signal?:AbortSignal,canDispatch?:()=>boolean) {
  if(canDispatch&&!canDispatch())return false;
  const claim=await claimRunV7(owner);if(!claim)return false;
  await processClaimedRunV7(claim,undefined,signal,canDispatch);return true;
}
