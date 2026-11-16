import "server-only";
import { readDurableDecisionJournalV7 } from "@/lib/ai/durable-call";
import type { DecisionContextV6 } from "../v6/engine";
import type { MatchPlanV6 } from "../v6/contracts";
import {
  assembleReviewedGroupDetailsV7, assembleReviewedGroupsFinalV7, createExplanationGroupSpecsV7,
  generateGroupExplanationV7, groupCanonicalSha256V7, reviewPreparedGroupV7,
  isReviewedFinalSelectionVersionV7, validatePreparedGroupV7, validateReviewedGroupV7,
} from "./explanation-groups";
import type { ExplanationGroupIdV7, GroupRunBindingV7, PersistedGroupAckV7 } from "./group-contracts";
import type { PersistedDetailGroupV7 } from "./group-state";
import { DECISION_EXPLAIN_PROMPT_VERSION_V7, type DecisionModelOptionsV7 } from "./model";
import type { RunBodyV7, RunRowV7 } from "./store";
import { isRecommendationRunTerminal, type RecommendationRunStatusV7 } from "./contracts";

export type GroupWorkerModelsV7 = {generate:typeof generateGroupExplanationV7;review:typeof reviewPreparedGroupV7};
export type GroupWorkerBodyV7=Pick<RunBodyV7,"implementationSha256"|"sessionGeneration"|"effortPolicySha256"|"items"|"detailGroups"|"plan"|"finalPlan"|"report"|"shortfallReason"|"error"|"detailsReadyAt">;
const interrupted = new Set(["DECISION_LEASE_LOST","DECISION_RELEASE_INACTIVE","aborted"]);
const safeError = (error:unknown) => {
  const text=error instanceof Error?error.message:"DETAIL_GROUP_FAILED";
  return /^[A-Za-z0-9_.:-]{1,180}$/.test(text)?text:"DETAIL_GROUP_FAILED";
};

function requireFinalReviewBinding(group:PersistedDetailGroupV7,resultVersion:number) {
  const {prepared,reviewed,reviewPreparation:receipt}=group;
  const preparedResultVersion=group.preparedResultVersion??-1,preparedGroupVersion=group.preparedGroupVersion??-1;
  if(!prepared||!reviewed||!receipt||receipt.schemaVersion!=="saitu.group-review-preparation.v1"
    ||!reviewed.reviewCallKey||receipt.call.callKey!==reviewed.reviewCallKey
    ||receipt.groupId!==group.spec.groupId||receipt.groupBindingSha256!==prepared.groupBindingSha256
    ||receipt.preparedSha256!==prepared.preparedSha256||receipt.call.stage!=="review"||receipt.call.repair
    ||!Number.isSafeInteger(preparedResultVersion)||preparedResultVersion<1||preparedResultVersion>=resultVersion
    ||!Number.isSafeInteger(preparedGroupVersion)||preparedGroupVersion<1||group.version<=preparedGroupVersion
    ||receipt.criticalAssertionsSha256!==groupCanonicalSha256V7(prepared.assertions.filter(row=>prepared.criticalKeys.includes(row.key)))
    ||receipt.keyMapSha256!==groupCanonicalSha256V7(receipt.call.reviewKeys)
    ||groupCanonicalSha256V7(receipt.call.reviewKeys.map(row=>row.key))!==groupCanonicalSha256V7(prepared.criticalKeys)
    ||group.status!==(reviewed.itemOutcomes.every(row=>row.status==="ready")?"ready":"failed"))throw new Error("DETAIL_FINAL_REVIEW_BINDING_CHANGED");
  const joints=receipt.call.jointReviewBindings??[];
  const aliases=new Set(joints.map(row=>row.alias));
  const keys=new Map(receipt.call.reviewKeys.map(row=>[row.key,row.alias]));
  if(joints.length!==group.spec.itemIds.length||aliases.size!==joints.length||group.spec.itemIds.some(itemId=>{
    const fit=`${itemId}.reason.0`,role=`${itemId}.role`,alias=keys.get(fit);
    const joint=joints.find(row=>row.alias===alias);
    return !alias||keys.get(role)!==alias||!joint||joint.keys.length!==2||joint.keys[0]!==fit||joint.keys[1]!==role
      ||joint.verdictSemantics!=="conjunction_single_provider_verdict"
      ||joint.reviewPurposes[0]!=="recommendation_fit"||joint.reviewPurposes[1]!=="selected_role_action";
  }))throw new Error("DETAIL_FINAL_REVIEW_BINDING_CHANGED");
}

/** The parent owns the lease, heartbeat, durable scope and sole commit queue.
 * Group tasks share them; only model work runs concurrently. */
export async function processDetailGroupsV7<Body extends GroupWorkerBodyV7>(input:{
  claim:{row:Pick<RunRowV7,"run_id"|"state_key"|"result_version"|"status"|"submitted_at"|"detail_deadline_at">;body:Body};
  writer:{update(change:(current:Body,status:RecommendationRunStatusV7)=>{body:Body;status:RecommendationRunStatusV7}|null):Promise<void>;flush():Promise<void>};
  context:DecisionContextV6;plan:MatchPlanV6;
  controller:AbortController;canDispatch?:()=>boolean;onObservation:DecisionModelOptionsV7["onObservation"];
  models?:GroupWorkerModelsV7;
  /** The formal collector supplies its own persisted call journal. Product
   * workers always use the PostgreSQL reader; this is not an HTTP option. */
  readJournal?:typeof readDurableDecisionJournalV7;
}):Promise<void> {
  const {claim,writer,context,plan,controller,canDispatch,onObservation}=input;
  if(isRecommendationRunTerminal(claim.row.status))return;
  const models=input.models??{generate:generateGroupExplanationV7,review:reviewPreparedGroupV7};
  const run:GroupRunBindingV7={runId:claim.row.run_id,stateKey:claim.row.state_key,generation:claim.body.sessionGeneration,
    implementationSha256:claim.body.implementationSha256,effortPolicySha256:claim.body.effortPolicySha256,detailDeadlineEpochMs:claim.row.detail_deadline_at.getTime()};
  const specs=createExplanationGroupSpecsV7(context,plan,run);
  const finalSelection=isReviewedFinalSelectionVersionV7(DECISION_EXPLAIN_PROMPT_VERSION_V7);
  const assertActive=()=>{
    if(controller.signal.aborted)throw new Error("aborted");
    if(canDispatch&&!canDispatch())throw new Error("DECISION_RELEASE_INACTIVE");
    if(Date.now()>=run.detailDeadlineEpochMs)throw new Error("DETAIL_DEADLINE_EXCEEDED");
  };
  const groupIn=(body:Body,id:ExplanationGroupIdV7):PersistedDetailGroupV7=>{
    const state=body.detailGroups;
    if(!state||state.schemaVersion!=="saitu.persisted-detail-groups.v1"||state.groups.length!==specs.length
      ||new Set(state.groups.map(group=>group.spec.groupId)).size!==specs.length)throw new Error("INVALID_PERSISTED_GROUPS");
    for(const spec of specs){
      const group=state.groups.find(value=>value.spec.groupId===spec.groupId);
      if(!group||groupCanonicalSha256V7(group.spec)!==groupCanonicalSha256V7(spec)
        ||!Number.isSafeInteger(group.version)||group.version<0)throw new Error("DETAIL_GROUP_BINDING_CHANGED");
    }
    return state.groups.find(group=>group.spec.groupId===id)!;
  };
  const patchGroup=async(id:ExplanationGroupIdV7,change:(group:PersistedDetailGroupV7,body:Body)=>{group:PersistedDetailGroupV7;items?:Body["items"]}|null,requireActive=true)=>{
    await writer.update(body=>{
      if(requireActive)assertActive();
      const old=groupIn(body,id),patch=change(old,body);
      if(!patch)return null;
      if(patch.group.spec!==old.spec||patch.group.version!==old.version+1)throw new Error("DETAIL_GROUP_PATCH_INVALID");
      const items=patch.items??body.items;
      return {status:items.some(item=>item.detailStatus==="ready")?"partial_ready":"explaining",body:{...body,items,
        detailGroups:{schemaVersion:"saitu.persisted-detail-groups.v1",groups:body.detailGroups!.groups.map(group=>group.spec.groupId===id?patch.group:group)}}};
    });
  };
  await writer.update(body=>{
    assertActive();
    if(body.detailGroups){for(const spec of specs)groupIn(body,spec.groupId);return null;}
    return {status:"explaining",body:{...body,detailGroups:{schemaVersion:"saitu.persisted-detail-groups.v1",
      groups:specs.map(spec=>({spec,version:0,status:"pending",updatedAt:new Date().toISOString()}))}}};
  });
  const outcomes=await Promise.allSettled(specs.map(async spec=>{
    try{
      assertActive();
      let group=groupIn(claim.body,spec.groupId);
      if(group.status==="ready"||group.status==="failed")return;
      const options={requestId:run.runId,runBinding:run,signal:controller.signal,deadlineEpochMs:run.detailDeadlineEpochMs-750,onObservation};
      if(!group.prepared){
        if(group.status!=="pending")throw new Error("DETAIL_GROUP_PREPARED_MISSING");
        const expectedVersion=group.version;
        const {prepared}=await models.generate(context,plan,spec,options);
        validatePreparedGroupV7(context,plan,prepared,run);
        await patchGroup(spec.groupId,(current,body)=>{
          if(current.version!==expectedVersion||current.prepared)throw new Error("DETAIL_GROUP_VERSION_CHANGED");
          return {group:{...current,version:current.version+1,status:"prepared",prepared,preparedResultVersion:claim.row.result_version+1,
            preparedGroupVersion:current.version+1,updatedAt:new Date().toISOString()},items:body.items.map(item=>spec.itemIds.includes(item.itemId)?{...item,detailStatus:"checking"}:item)};
        });
        group=groupIn(claim.body,spec.groupId);
      }
      const prepared=group.prepared!;
      validatePreparedGroupV7(context,plan,prepared,run);
      const persisted:PersistedGroupAckV7={schemaVersion:"saitu.persisted-group-explanation.v1",runId:run.runId,groupId:spec.groupId,
        groupBindingSha256:prepared.groupBindingSha256,preparedSha256:prepared.preparedSha256,
        persistedResultVersion:group.preparedResultVersion!,groupVersion:group.preparedGroupVersion!};
      const {reviewed}=await models.review(context,plan,prepared,{...options,persisted,persistReviewPreparation:async preparation=>{
        await patchGroup(spec.groupId,current=>{
          if(current.prepared?.preparedSha256!==prepared.preparedSha256||preparation.groupBindingSha256!==prepared.groupBindingSha256
            ||preparation.preparedSha256!==prepared.preparedSha256||preparation.groupId!==spec.groupId)throw new Error("DETAIL_REVIEW_BINDING_CHANGED");
          if(current.reviewPreparation){
            if(groupCanonicalSha256V7(current.reviewPreparation)!==groupCanonicalSha256V7(preparation))throw new Error("DETAIL_REVIEW_PREPARATION_CHANGED");
            return null;
          }
          return {group:{...current,version:current.version+1,status:"reviewing",reviewPreparation:preparation,updatedAt:new Date().toISOString()}};
        });
      }});
      validateReviewedGroupV7(context,plan,prepared,reviewed,run);
      const details=assembleReviewedGroupDetailsV7(context,plan,prepared,reviewed,run);
      await patchGroup(spec.groupId,(current,body)=>{
        if(current.prepared?.preparedSha256!==prepared.preparedSha256||current.reviewed)throw new Error("DETAIL_GROUP_REVIEW_CHANGED");
        if(reviewed.reviewCallKey&&current.reviewPreparation?.call.callKey!==reviewed.reviewCallKey)throw new Error("DETAIL_REVIEW_NOT_PERSISTED");
        const items=body.items.map(item=>{
          if(!spec.itemIds.includes(item.itemId))return item;
          const outcome=reviewed.itemOutcomes.find(value=>value.itemId===item.itemId&&value.globalRank===item.rank);
          if(!outcome)throw new Error("DETAIL_GROUP_OUTCOME_MISSING");
          if(outcome.status==="failed")return {...item,detailStatus:"failed" as const};
          const detail=details.find(value=>value.itemId===item.itemId&&value.rank===item.rank&&value.seriesId===item.seriesId);
          if(!detail)throw new Error("MISSING_SELECTED_DETAIL");
          return {...item,detailStatus:"ready" as const,detail};
        });
        return {group:{...current,version:current.version+1,status:reviewed.itemOutcomes.every(row=>row.status==="ready")?"ready":"failed",
          reviewed,updatedAt:new Date().toISOString()},items};
      });
    }catch(error){
      const code=safeError(error);
      if(controller.signal.aborted||interrupted.has(code)){controller.abort();throw error;}
      await patchGroup(spec.groupId,(group,body)=>{
        if(group.status==="ready"||group.status==="failed")return null;
        return {group:{...group,version:group.version+1,status:"failed",error:code,updatedAt:new Date().toISOString()},
          items:body.items.map(item=>spec.itemIds.includes(item.itemId)&&item.detailStatus!=="ready"?{...item,detailStatus:"failed"}:item)};
      },false);
    }
  }));
  await writer.flush();
  const rejection=outcomes.find(value=>value.status==="rejected");
  if(rejection?.status==="rejected")throw rejection.reason;
  assertActive();
  const persisted=claim.body.detailGroups!.groups;
  if(persisted.some(group=>finalSelection
    ? group.error||!group.prepared||!group.reviewed||group.status!=="ready"&&group.status!=="failed"
    : group.status!=="ready")){
    await writer.update(body=>({status:"failed",body:{...body,error:"DETAIL_GROUP_FAILED",detailsReadyAt:null}}));return;
  }
  if(finalSelection)for(const group of persisted)requireFinalReviewBinding(group,claim.row.result_version);
  const groups=persisted.map(group=>({prepared:group.prepared!,reviewed:group.reviewed!}));
  const groupsSha=groupCanonicalSha256V7(claim.body.detailGroups);
  const assertFinalSnapshot=(body:Body)=>{
    assertActive();
    if(!body.plan||groupCanonicalSha256V7(body.plan)!==groupCanonicalSha256V7(plan)||!body.detailGroups
      ||groupCanonicalSha256V7(body.detailGroups)!==groupsSha||body.finalPlan||body.report||body.error
      ||body.items.length!==plan.recommendations.length||body.items.some((item,index)=>item.itemId!==plan.recommendations[index].itemId||item.rank!==index+1))
      throw new Error("DETAIL_FINAL_SNAPSHOT_CHANGED");
  };
  const journal=await (input.readJournal??readDurableDecisionJournalV7)(run.runId);
  if(finalSelection&&groups.some(group=>!journal.some(call=>call.callKey===group.reviewed.reviewCallKey&&call.upstreamAttempted)))
    throw new Error("DETAIL_FINAL_REVIEW_JOURNAL_MISSING");
  let final;
  try{
    final=assembleReviewedGroupsFinalV7(context,plan,groups,run,{calls:journal,startedAtEpochMs:claim.row.submitted_at.getTime(),completedAtEpochMs:Date.now()});
  }catch(error){
    if(safeError(error)!=="NO_SUPPORTED_RECOMMENDATIONS")throw error;
    await writer.update(body=>{
      assertFinalSnapshot(body);
      return {status:"failed",body:{...body,items:[],shortfallReason:"本次未能生成可核实的推荐。",error:"NO_SUPPORTED_RECOMMENDATIONS",detailsReadyAt:null}};
    });return;
  }
  const {plan:finalPlan,report}=final;
  await writer.update(body=>{
    assertFinalSnapshot(body);
    const selected=new Set(finalPlan.recommendations.map(item=>item.itemId));
    if(body.items.some(item=>selected.has(item.itemId)?item.detailStatus!=="ready"||!item.detail:item.detailStatus!=="failed"||item.detail))
      throw new Error("DETAIL_FINAL_ITEM_COVERAGE_CHANGED");
    const items=report.recommendations.map((detail,index)=>{
      const original=body.items.find(item=>item.itemId===detail.itemId);
      if(!original?.detail||finalPlan.recommendations[index]?.itemId!==detail.itemId||detail.rank!==index+1
        ||groupCanonicalSha256V7({...original.detail,rank:detail.rank})!==groupCanonicalSha256V7(detail))
        throw new Error("DETAIL_FINAL_ITEM_BINDING_CHANGED");
      return {...original,rank:detail.rank,detail};
    });
    if(items.length!==finalPlan.recommendations.length||finalSelection&&!items.length)throw new Error("DETAIL_FINAL_ITEM_COVERAGE_CHANGED");
    return {status:"ready",body:{...body,items,report,...(finalSelection?{finalPlan}:{}),shortfallReason:finalPlan.shortfallReason,detailsReadyAt:new Date().toISOString()}};
  });
}
