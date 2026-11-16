import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import type { CompetitionRecommendationProfileV5 } from "@/types/competition-recommendation";
import type { DecisionContextV6 } from "../v6/engine";
import type { DecisionReportV6, MatchPlanV6, StudentProfileV6 } from "../v6/contracts";
import { createModelIdentifierCodec } from "../v6/model-identifiers";
import { LEGACY_RECOMMENDATION_POLICY_VERSION, RECOMMENDATION_EXECUTION_POLICY, RECOMMENDATION_IMPLEMENTATION_VERSION, RECOMMENDATION_POLICY_VERSION, RECOMMENDATION_RESPONSE_VERSION, recommendationExecutionPolicySchema, recommendationRunSchema, type RecommendationExecutionPolicyV7, type RecommendationListItemV7, type RecommendationRunStatusV7 } from "./contracts";
import { createDecisionTokenV7, sealV7, sessionKeyV7, unsealV7, type DecisionTokenV7, type SealedV7 } from "./crypto";
import { recommendationRuntimeBindingV7 } from "./runtime-binding";
import type { RecommendationChatReplyV7 } from "./contracts";
import type { PersistedDetailGroupsV7 } from "./group-state";
import { explicitFactPracticeAnchorV7, groundedBridgeLabelForVersionV7, groupCanonicalSha256V7, isFutureTaskPracticeVersionV7, isIndexedLearnerBasisVersionV7, isQuotedLearnerRelationVersionV759, isRankBoundTaskPracticeVersionV7, isReviewedFinalSelectionVersionV7, isSealedTaskSelectionVersionV7, learnerBasisSelectionMatchesV760, learnerRelationMatchesV759, RANK_BOUND_TASK_PRACTICE_VERSION_V754, readMatchingRelationForVersionV7, resolveGroupTaskSelectionV758, taskPracticeInternalIdsV7, taskPracticeProseProtocolV7, taskSelectionMatchesProseVersionV7, validateArchivedMatchingRelationReviewV7, type GroupTaskSelectionV7 } from "./explanation-groups";
import { matchingRelationReviewContractForVersionV7, validateDecisionReportV7 } from "./model";
import { readGroundedBridgeReasonV7, studentLearningOptionsV7 } from "./match-learning-selection";
import { rankTaskFactsV7, rankTaskFactsV754 } from "./rank-packet";
import { recommendationMatchRecordV7 } from "./recommendation-advisory-evidence";
import { matchingRelationSelectionTextIssueV7, rankTaskFocusOptionsV7, readSealedTaskPracticeFieldsV7, readTaskPracticeFieldsV7, sealedTaskPracticeTextIssueV7, taskPracticeTextIssueV7 } from "./role-task-practice";
import { EFFORT_POLICY_VERSION_V2, effortPolicySha256, parseEffortPolicy, requireCompactRecommendationEffortPolicy, requireRankNonThinkingEffortPolicy, type DecisionEffortPolicy } from "@/lib/ai/effort-policy.mjs";
import {parseDetailLayoutV7,readConfiguredDetailLayoutV7,type DetailLayoutV7} from "./detail-layout.mjs";
import { currentDecisionEffortPolicy } from "@/lib/ai/effort-context";
import {readExecutionMode,USER_UNBOUNDED_EXECUTION_LIMITS,type AiExecutionMode} from "@/lib/ai/execution-policy.mjs";
import {readUserUnboundedExecutionAuthorizationV7,type UserUnboundedExecutionAuthorizationV7} from "@/lib/ai/execution-authorization";

export type DecisionSessionV7 = Omit<DecisionTokenV7,"version"> & {
  currentRunId: string; profile: StudentProfileV6; legacy: CompetitionRecommendationProfileV5;
  history: {role:"user"|"assistant";text:string}[];
};
type FrozenContext = Omit<DecisionContextV6,"now"|"excluded"> & {now:string;excluded:[string,string][]};
export type RunBodyV7 = {
  implementationSha256:string;
  executionPolicy?:RecommendationExecutionPolicyV7;
  executionMode?:AiExecutionMode;
  executionAuthorization?:UserUnboundedExecutionAuthorizationV7;
  sessionGeneration:number;
  effortPolicy:DecisionEffortPolicy;
  effortPolicySha256:string;
  detailLayout?:DetailLayoutV7;
  context: FrozenContext; legacy: CompetitionRecommendationProfileV5; items: RecommendationListItemV7[];
  plan?: MatchPlanV6; finalPlan?: MatchPlanV6; report?: DecisionReportV6; listReadyAt:string|null; detailsReadyAt:string|null;
  detailGroups?:PersistedDetailGroupsV7;
  shortfallReason:string|null; error?:string;
  auditObservations?:{stage:string;kind:"response"|"validation";data:unknown}[];
};
export type RunRowV7 = SealedV7 & {
  run_id:string; state_key:string; submission_key:string; implementation_version:string; status:RecommendationRunStatusV7;
  execution_mode?:AiExecutionMode|null;
  result_version:number; submitted_at:Date; list_deadline_at:Date; detail_deadline_at:Date; expires_at:Date;
  lease_owner:string|null; lease_fence:string; lease_expires_at:Date|null;
};
export type LoadedRunV7 = {row:RunRowV7;body:RunBodyV7};
export type ClaimedRunV7 = LoadedRunV7 & {owner:string;fence:string};

function assertStoredMatchingRelationReviewsV7(body:RunBodyV7):void {
  for(const group of body.detailGroups?.groups??[]){
    const {prepared,reviewed,reviewPreparation:receipt}=group;
    const version=group.spec.explanationPromptVersion;
    const selections=prepared?.explanation.taskSelections;
    if(selections!==undefined&&(!Array.isArray(selections)||selections.some(selection=>!taskSelectionMatchesProseVersionV7(selection,version))))
      throw new Error("INVALID_FINAL_SELECTION_BINDING");
    const reviewContract=matchingRelationReviewContractForVersionV7(version);
    if(!reviewContract){
      if(reviewed?.matchingRelationReview!==undefined||receipt?.call.reviewContract!==undefined)
        throw new Error("INVALID_FINAL_SELECTION_BINDING");
      continue;
    }
    if(receipt&&receipt.call.reviewContract!==reviewContract)
      throw new Error("INVALID_FINAL_SELECTION_BINDING");
    if(!reviewed)continue;
    const raw=reviewed.matchingRelationReview;
    if(!raw||!receipt||!prepared||!body.plan||!isDeepStrictEqual(prepared.groupSpec,group.spec)
      ||raw.requestSha256!==receipt.call.durableRequestSha256
      ||!isDeepStrictEqual(raw.ownerKeys,receipt.call.reviewOwnerKeyBindings)
      ||receipt.groupId!==group.spec.groupId||receipt.call.callKey!==reviewed.reviewCallKey
      ||receipt.groupBindingSha256!==prepared.groupBindingSha256||receipt.preparedSha256!==prepared.preparedSha256)
      throw new Error("INVALID_FINAL_SELECTION_BINDING");
    const {preparedSha256,...sealed}=prepared;
    if(groupCanonicalSha256V7(sealed)!==preparedSha256)throw new Error("INVALID_FINAL_SELECTION_BINDING");
    try{validateArchivedMatchingRelationReviewV7(restoreContextV7(body),body.plan,prepared,reviewed);}
    catch{throw new Error("INVALID_FINAL_SELECTION_BINDING");}
  }
}

function readFinalTaskSelectionsV7(body:RunBodyV7,plan:MatchPlanV6,quoted:boolean,indexed:boolean,context:DecisionContextV6,
  learning:ReturnType<typeof studentLearningOptionsV7>){
  const choices=new Map<string,{selection:GroupTaskSelectionV7;detail:MatchPlanV6["recommendations"][number]}>();
  const planHash=groupCanonicalSha256V7(plan);
  const codec=quoted||indexed?createModelIdentifierCodec({candidates:body.context.candidates.map(({record})=>record.recordId),series:[],facts:[],students:[]}):undefined;
  for(const group of body.detailGroups?.groups??[]){
    const {prepared,reviewed}=group;
    if(!prepared||!reviewed||!isSealedTaskSelectionVersionV7(group.spec.explanationPromptVersion)
      ||!isDeepStrictEqual(group.spec,prepared.groupSpec)||group.spec.fullPlanSha256!==planHash
      ||groupCanonicalSha256V7(group.spec)!==prepared.groupBindingSha256)throw new Error("INVALID_FINAL_SELECTION_BINDING");
    const {preparedSha256,...original}=prepared;
    const {reviewedSha256,...review}=reviewed;
    const selections=prepared.explanation.taskSelections;
    const version=group.spec.explanationPromptVersion;
    const matching=taskPracticeProseProtocolV7(version)==="matching_relation";
    const ready=new Set(reviewed.itemOutcomes.filter(outcome=>outcome.status==="ready").map(outcome=>outcome.itemId));
    if(reviewed.preparedSha256!==preparedSha256||groupCanonicalSha256V7(original)!==preparedSha256
      ||groupCanonicalSha256V7(review)!==reviewedSha256||reviewed.groupId!==group.spec.groupId
      ||reviewed.groupBindingSha256!==prepared.groupBindingSha256||reviewed.assertionsSha256!==prepared.assertionsSha256
      ||groupCanonicalSha256V7(prepared.explanation)!==prepared.explanationSha256||groupCanonicalSha256V7(prepared.assertions)!==prepared.assertionsSha256
      ||!selections||selections.some(selection=>quoted!==Boolean(selection.learnerRelation)||indexed!==Boolean(selection.learnerBasisSelection)
        ||!taskSelectionMatchesProseVersionV7(selection,version))
      ||!isDeepStrictEqual(selections.map(selection=>selection.itemId),group.spec.itemIds)
      ||!isDeepStrictEqual(prepared.explanation.recommendations.map(item=>item.itemId),group.spec.itemIds)
      ||!isDeepStrictEqual(reviewed.itemOutcomes.map(outcome=>outcome.itemId),group.spec.itemIds))
      throw new Error("INVALID_FINAL_SELECTION_BINDING");
    if(codec){
      const receipt=group.reviewPreparation;
      const ownerKeys=receipt?.call.reviewOwnerKeyBindings;
      if(!receipt||!ownerKeys||receipt.preparedSha256!==preparedSha256||receipt.groupBindingSha256!==prepared.groupBindingSha256
        ||receipt.call.callKey!==reviewed.reviewCallKey||receipt.keyMapSha256!==groupCanonicalSha256V7(receipt.call.reviewKeys)
        ||receipt.ownerKeyMapSha256!==groupCanonicalSha256V7(ownerKeys)||ownerKeys.length!==group.spec.itemIds.length
        ||new Set(ownerKeys.map(entry=>entry.reviewAlias)).size!==ownerKeys.length)throw new Error("INVALID_FINAL_SELECTION_BINDING");
      for(const [index,{itemId,ownerAlias,reviewAlias}] of ownerKeys.entries()){
        const logicalKeys=receipt.call.reviewKeys.filter(entry=>entry.alias===reviewAlias).map(entry=>entry.key);
        if(itemId!==group.spec.itemIds[index]||!isDeepStrictEqual(codec.encode({itemId}),{itemId:ownerAlias})
          ||!isDeepStrictEqual(logicalKeys,[`${itemId}.reason.0`,`${itemId}.role`]))throw new Error("INVALID_FINAL_SELECTION_BINDING");
      }
    }
    const supportedKeys=new Set(reviewed.checks.filter(check=>check.supported).map(check=>check.key));
    for(const [index,selection] of selections.entries()){
      const detail=prepared.explanation.recommendations[index];
      if(matching){
        const ranked=plan.recommendations.find(item=>item.itemId===selection.itemId);
        const resolved=ranked&&resolveGroupTaskSelectionV758(context,ranked,selection);
        const reason=detail.reasons[0];
        const parsed=resolved&&reason&&readGroundedBridgeReasonV7(resolved.anchor,resolved.role,reason,learning,undefined,groundedBridgeLabelForVersionV7(version));
        if(!resolved||!parsed||detail.reasons.length!==1||detail.roleIndex!==selection.roleIndex||!isDeepStrictEqual(detail.roleReason,reason)
          ||readMatchingRelationForVersionV7(version,resolved.focus.text,parsed.bridge,selection)===undefined
          ||!selection.learnerBasisSelection||!learnerBasisSelectionMatchesV760(selection.learnerBasisSelection,reason.studentFactIds,parsed.explicitStudentGoal,learning))
          throw new Error("INVALID_FINAL_SELECTION_BINDING");
      }
      if(!ready.has(selection.itemId))continue;
      if(choices.has(selection.itemId)||!supportedKeys.has(`${selection.itemId}.reason.0`)||!supportedKeys.has(`${selection.itemId}.role`))
        throw new Error("INVALID_FINAL_SELECTION_BINDING");
      choices.set(selection.itemId,{selection,detail});
    }
  }
  return choices;
}

/** Final selection, report and items are one durable publication. Old reports
 * predate finalPlan and retain their existing read contract. */
function assertFinalPlanBindingV7(body:RunBodyV7,status:RecommendationRunStatusV7):void {
  assertStoredMatchingRelationReviewsV7(body);
  const {finalPlan,plan,report,items}=body;
  const traceVersion=report?.trace.promptVersion,groupSuffix=".detail-v2";
  const version=traceVersion?.endsWith(groupSuffix)?traceVersion.slice(0,-groupSuffix.length):undefined;
  const groupVersions=body.detailGroups?.groups.map(group=>group.spec.explanationPromptVersion)??[];
  const reviewedSelection=isReviewedFinalSelectionVersionV7(version)||groupVersions.some(isReviewedFinalSelectionVersionV7);
  const rankBoundVersions=new Set([version,...groupVersions].filter(isRankBoundTaskPracticeVersionV7));
  if(rankBoundVersions.size>1)throw new Error("INVALID_FINAL_SELECTION_BINDING");
  const rankBoundTask=rankBoundVersions.size===1;
  const futureTaskPractice=[...rankBoundVersions].some(isFutureTaskPracticeVersionV7);
  const connectedTaskPractice=[...rankBoundVersions].some(isSealedTaskSelectionVersionV7);
  const quotedTaskPractice=[...rankBoundVersions].some(isQuotedLearnerRelationVersionV759);
  const indexedLearnerBasis=[...rankBoundVersions].some(isIndexedLearnerBasisVersionV7);
  const proseVersion=rankBoundVersions.values().next().value;
  const practiceProseProtocol=taskPracticeProseProtocolV7(proseVersion);
  const anchorFacts=rankBoundVersions.has(RANK_BOUND_TASK_PRACTICE_VERSION_V754)?rankTaskFactsV754:rankTaskFactsV7;
  if(!finalPlan){
    if(reviewedSelection&&(status==="ready"||report))throw new Error("INVALID_FINAL_SELECTION_BINDING");
    return;
  }
  if(!["ready","superseded","expired"].includes(status)||!plan||!report||!finalPlan.recommendations.length
    ||finalPlan.profileRevision!==body.context.profile.revision||report.profile.revision!==finalPlan.profileRevision
    ||finalPlan.catalogVersion!==body.context.catalogVersion||report.catalogVersion!==finalPlan.catalogVersion
    ||body.shortfallReason!==finalPlan.shortfallReason||report.shortlistShortfallReason!==finalPlan.shortfallReason
    ||items.length!==finalPlan.recommendations.length||report.recommendations.length!==items.length)throw new Error("INVALID_FINAL_SELECTION_BINDING");
  const context=reviewedSelection?restoreContextV7(body):undefined;
  const learning=rankBoundTask&&context?studentLearningOptionsV7(context.profile):undefined;
  const internalIds=futureTaskPractice&&context?taskPracticeInternalIdsV7(context):[];
  const explicitFactPractice=futureTaskPractice&&context&&plan.recommendations.every(item=>Boolean(explicitFactPracticeAnchorV7(context,item)));
  const sealedChoices=connectedTaskPractice&&context&&learning?readFinalTaskSelectionsV7(body,plan,quotedTaskPractice,indexedLearnerBasis,context,learning):undefined;
  if(sealedChoices&&sealedChoices.size!==items.length)throw new Error("INVALID_FINAL_SELECTION_BINDING");
  let previous=-1;
  for(const [index,selected] of finalPlan.recommendations.entries()){
    const originalIndex=plan.recommendations.findIndex(item=>item.itemId===selected.itemId);
    const ranked=plan.recommendations[originalIndex],item=items[index],detail=report.recommendations[index];
    const openRole=connectedTaskPractice?ranked?.rankRoleIndex===undefined:explicitFactPractice;
    if(originalIndex<=previous||ranked.rankRoleIndex!==selected.rankRoleIndex
      ||ranked.rankGoalIndex!==selected.rankGoalIndex||ranked.rankTaskStepIndex!==selected.rankTaskStepIndex
      ||item.itemId!==selected.itemId||detail.itemId!==selected.itemId||item.rank!==index+1||detail.rank!==item.rank
      ||item.detailStatus!=="ready"||!isDeepStrictEqual(item.detail,detail)||!isDeepStrictEqual(selected.reasons,detail.reasons)
      ||reviewedSelection&&(selected.roleIndex===undefined||!openRole&&selected.roleIndex!==selected.rankRoleIndex||!selected.roleReason
        ||!isDeepStrictEqual(selected.roleReason,detail.currentRole)||!isDeepStrictEqual(selected.roleReason,detail.nextStep)))throw new Error("INVALID_FINAL_SELECTION_BINDING");
    if(connectedTaskPractice){
      const sealed=sealedChoices?.get(selected.itemId);
      const resolved=sealed&&context&&resolveGroupTaskSelectionV758(context,ranked,sealed.selection);
      const finalReason=selected.reasons[0];
      if(!sealed||!resolved||!learning||selected.reasons.length!==1||sealed.selection.roleIndex!==selected.roleIndex
        ||!isDeepStrictEqual(sealed.detail,selected)||!isDeepStrictEqual(selected.roleReason,finalReason)
        ||!openRole&&(ranked.reasons.length!==1||!isDeepStrictEqual(finalReason.studentFactIds,ranked.reasons[0].studentFactIds)))
        throw new Error("INVALID_FINAL_SELECTION_BINDING");
      const parsed=readGroundedBridgeReasonV7(resolved.anchor,resolved.role,finalReason,learning,undefined,groundedBridgeLabelForVersionV7(proseVersion));
      const {learnerRelation,learnerBasisSelection}=sealed.selection;
      const fields=parsed&&practiceProseProtocol!=="matching_relation"
        &&readSealedTaskPracticeFieldsV7(resolved.focus.text,parsed.bridge,sealed.selection,practiceProseProtocol==="explicit_source");
      const proseValid=parsed&&(practiceProseProtocol==="matching_relation"
        ? readMatchingRelationForVersionV7(proseVersion,resolved.focus.text,parsed.bridge,sealed.selection)!==undefined
          &&!matchingRelationSelectionTextIssueV7(sealed.selection,internalIds,resolved.anchor.text)
        : fields&&!sealedTaskPracticeTextIssueV7(fields,internalIds,resolved.anchor.text,sealed.selection,practiceProseProtocol));
      const expectedGoal=learning.goals.find(goal=>goal.index===ranked.rankGoalIndex)?.text;
      if(!proseValid||!openRole&&(ranked.rankGoalIndex!==undefined&&!expectedGoal||parsed?.explicitStudentGoal!==expectedGoal)
        ||learnerRelation&&!learnerRelationMatchesV759(learnerRelation,finalReason.studentFactIds,parsed?.explicitStudentGoal,learning)
        ||learnerBasisSelection&&!learnerBasisSelectionMatchesV760(learnerBasisSelection,finalReason.studentFactIds,parsed?.explicitStudentGoal,learning))throw new Error("INVALID_FINAL_SELECTION_BINDING");
    }else if(rankBoundTask){
      const originalReason=ranked.reasons[0],finalReason=selected.reasons[0];
      if(ranked.reasons.length!==1||selected.reasons.length!==1||originalReason.competitionFactIds.length!==1
        ||!isDeepStrictEqual(selected.roleReason,finalReason))throw new Error("INVALID_FINAL_SELECTION_BINDING");
      const candidate=context?.candidates.find(row=>row.record.recordId===selected.itemId);
      const role=selected.roleIndex===undefined?undefined:candidate?.record.roles[selected.roleIndex];
      if(!isDeepStrictEqual(finalReason.competitionFactIds,originalReason.competitionFactIds)
        ||!explicitFactPractice&&(ranked.rankTaskStepIndex===undefined
        ||!isDeepStrictEqual(finalReason.studentFactIds,originalReason.studentFactIds)))throw new Error("INVALID_FINAL_SELECTION_BINDING");
      const focus=role&&(explicitFactPractice?role.task:rankTaskFocusOptionsV7(role.task)[ranked.rankTaskStepIndex??-1]?.text);
      const anchor=explicitFactPractice&&context?explicitFactPracticeAnchorV7(context,ranked)
        :candidate&&anchorFacts(recommendationMatchRecordV7(candidate)).find(fact=>fact.id===finalReason.competitionFactIds[0]);
      const expectedGoal=learning?.goals.find(goal=>goal.index===ranked.rankGoalIndex)?.text;
      const parsed=focus&&anchor&&role&&learning&&readGroundedBridgeReasonV7(anchor,role,finalReason,learning,
        bridge=>readTaskPracticeFieldsV7(focus,bridge)!==undefined);
      const fields=parsed&&focus&&readTaskPracticeFieldsV7(focus,parsed.bridge);
      if(!fields||!explicitFactPractice&&(ranked.rankGoalIndex!==undefined&&!expectedGoal||parsed?.explicitStudentGoal!==expectedGoal)
        ||futureTaskPractice&&taskPracticeTextIssueV7(fields,internalIds))throw new Error("INVALID_FINAL_SELECTION_BINDING");
    }
    previous=originalIndex;
  }
  if(context&&!validateDecisionReportV7(report,context,{
    compactReasonItemIds:items.map(item=>item.itemId),compactReasonLengthPolicy:"soft_target",
  }).ok)throw new Error("INVALID_FINAL_SELECTION_BINDING");
}
/** Trusted component diagnostics cannot be claimed by the ordinary worker. */
export const RECOMMENDATION_DIAGNOSTIC_IMPLEMENTATION_VERSION_V7=`${RECOMMENDATION_IMPLEMENTATION_VERSION}.effort-stage-diagnostic`;
export const freezeContextV7 = (context:DecisionContextV6):FrozenContext => ({...context,now:context.now.toISOString(),excluded:[...context.excluded]});
export const restoreContextV7 = (body:RunBodyV7):DecisionContextV6 => ({...body.context,now:new Date(body.context.now),excluded:new Map(body.context.excluded)});
export const submissionKeyV7 = (sessionId:string, transition:unknown) => createHash("sha256").update(JSON.stringify(["v7",sessionId,transition])).digest("hex");
export function readFrozenRunEffortPolicyV7(body:Pick<RunBodyV7,"effortPolicy"|"effortPolicySha256">):DecisionEffortPolicy {
  const policy=parseEffortPolicy(body.effortPolicy);
  if(effortPolicySha256(policy)!==body.effortPolicySha256)throw new Error("DECISION_EFFORT_POLICY_CHANGED");
  return policy;
}
export function readFrozenRunDetailLayoutV7(body:Pick<RunBodyV7,"detailLayout">):DetailLayoutV7 {
  return parseDetailLayoutV7(body.detailLayout??"single");
}
/** Only historical implementations may lack a policy snapshot. Their persisted
 * cutoff columns remain authoritative, including old 30/45 second variants. */
export function readFrozenRunExecutionPolicyV7(run:LoadedRunV7):RecommendationExecutionPolicyV7 {
  if(run.body.executionPolicy){
    const policy=recommendationExecutionPolicySchema.parse(run.body.executionPolicy);
    if(run.row.list_deadline_at.getTime()!==run.row.submitted_at.getTime()+policy.rankHardTimeoutMs||run.row.detail_deadline_at.getTime()!==run.row.submitted_at.getTime()+policy.detailHardTimeoutMs)throw new Error("DECISION_EXECUTION_POLICY_CHANGED");
    return policy;
  }
  if(run.row.implementation_version.startsWith(RECOMMENDATION_IMPLEMENTATION_VERSION))throw new Error("DECISION_EXECUTION_POLICY_MISSING");
  return {policyVersion:LEGACY_RECOMMENDATION_POLICY_VERSION,maxItems:10,listTargetMs:30_000,
    rankHardTimeoutMs:run.row.list_deadline_at.getTime()-run.row.submitted_at.getTime(),detailTargetMs:90_000,
    detailHardTimeoutMs:run.row.detail_deadline_at.getTime()-run.row.submitted_at.getTime()};
}
export function readFrozenRunExecutionModeV7(run:LoadedRunV7):AiExecutionMode {
  const mode=run.body.executionMode??"finite";
  if(!["finite","user-unbounded"].includes(mode)||(run.row.execution_mode??"finite")!==mode
    ||mode==="user-unbounded"&&!run.body.executionAuthorization||mode==="finite"&&run.body.executionAuthorization)throw new Error("DECISION_EXECUTION_MODE_CHANGED");
  return mode;
}

async function transaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client=await getPool().connect();
  try { await client.query("begin");const value=await work(client);await client.query("commit");return value; }
  catch(error){await client.query("rollback").catch(()=>undefined);throw error;}
  finally{client.release();}
}
type SessionRow = SealedV7 & {generation:number;expires_at:Date};
function decodeSession(id:string,row:SessionRow):DecisionSessionV7 {
  const session=unsealV7<DecisionSessionV7>(`session:${id}`,row);
  if(session.id!==id||session.generation!==row.generation||session.expiresAt!==row.expires_at.getTime())throw new Error("decision_state_mismatch");
  return session;
}
export async function readSessionV7(token:DecisionTokenV7,options:{allowStale?:boolean}={}):Promise<DecisionSessionV7|null> {
  const result=await getPool().query<SessionRow>("select ciphertext,iv,tag,generation,expires_at from competition_decision_states where state_key=$1 and expires_at>now()",[token.id]);
  if(!result.rows[0])return null;
  const session=decodeSession(token.id,result.rows[0]);
  if(session.sessionId!==token.sessionId||session.expiresAt!==token.expiresAt)return null;
  if(!options.allowStale&&session.generation!==token.generation)throw new Error("DECISION_REVISION_CHANGED");
  return session;
}
export async function findSubmittedRunV7(submissionKey:string,session:DecisionSessionV7):Promise<LoadedRunV7|null> {
  const result=await getPool().query<RunRowV7>("select * from competition_decision_runs where submission_key=$1 and state_key=$2 and expires_at>now()",[submissionKey,session.id]);
  const row=result.rows[0];
  if(!row)return null;
  if(row.run_id!==session.currentRunId)throw new Error("DECISION_REVISION_CHANGED");
  return {row,body:unsealV7<RunBodyV7>(`run:${row.run_id}`,row)};
}
export async function appendRunChatHistoryV7(session:DecisionSessionV7,turns:DecisionSessionV7["history"]):Promise<boolean> {
  return transaction(async client=>{
    const row=(await client.query<SessionRow>("select ciphertext,iv,tag,generation,expires_at from competition_decision_states where state_key=$1 and expires_at>now() for update",[session.id])).rows[0];
    if(!row||row.generation!==session.generation)return false;
    const current=decodeSession(session.id,row);
    const sealed=sealV7(`session:${session.id}`,{...current,history:[...current.history,...turns].slice(-12)},1_048_576);
    await client.query("update competition_decision_states set ciphertext=$2,iv=$3,tag=$4,updated_at=now() where state_key=$1",[session.id,sealed.ciphertext,sealed.iv,sealed.tag]);
    return true;
  });
}
export type ChatSnapshotV7 = {history:DecisionSessionV7["history"];report?:DecisionReportV6;at:string;reply?:RecommendationChatReplyV7;auditObservations?:RunBodyV7["auditObservations"]};
type ChatRowV7=SealedV7 & {request_sha256:string};
export async function beginChatRequestV7(session:DecisionSessionV7,run:LoadedRunV7,requestId:string,input:unknown):Promise<ChatSnapshotV7> {
  const hash=createHash("sha256").update(JSON.stringify(input)).digest("hex"),aad=`chat:${run.row.run_id}:${requestId}`;
  return transaction(async client=>{
    const state=(await client.query<SessionRow>("select ciphertext,iv,tag,generation,expires_at from competition_decision_states where state_key=$1 and expires_at>now() for update",[session.id])).rows[0];
    if(!state||state.generation!==session.generation)throw new Error("DECISION_REVISION_CHANGED");
    const current=decodeSession(session.id,state);
    if(current.currentRunId!==run.row.run_id)throw new Error("DECISION_REVISION_CHANGED");
    const row=(await client.query<ChatRowV7>("select * from competition_decision_chat_requests where run_id=$1 and request_id=$2",[run.row.run_id,requestId])).rows[0];
    if(row){if(row.request_sha256!==hash)throw new Error("DECISION_REQUEST_CHANGED");return unsealV7<ChatSnapshotV7>(aad,row);}
    assertFinalPlanBindingV7(run.body,run.row.status);
    const snapshot:ChatSnapshotV7={history:current.history,report:run.row.status==="ready"?run.body.report:undefined,at:new Date().toISOString()};
    const sealed=sealV7(aad,snapshot);
    await client.query("insert into competition_decision_chat_requests(run_id,request_id,request_sha256,ciphertext,iv,tag) values($1,$2,$3,$4,$5,$6)",[run.row.run_id,requestId,hash,sealed.ciphertext,sealed.iv,sealed.tag]);
    return snapshot;
  });
}
/** Reply and history are one commit, so a replay never appends the same turn twice. */
export async function finishChatRequestV7(session:DecisionSessionV7,requestId:string,reply:RecommendationChatReplyV7,turns:DecisionSessionV7["history"]):Promise<RecommendationChatReplyV7> {
  return transaction(async client=>{
    const state=(await client.query<SessionRow>("select ciphertext,iv,tag,generation,expires_at from competition_decision_states where state_key=$1 and expires_at>now() for update",[session.id])).rows[0];
    if(!state||state.generation!==session.generation)throw new Error("DECISION_REVISION_CHANGED");
    const current=decodeSession(session.id,state);
    if(current.currentRunId!==session.currentRunId)throw new Error("DECISION_REVISION_CHANGED");
    const row=(await client.query<ChatRowV7>("select * from competition_decision_chat_requests where run_id=$1 and request_id=$2 for update",[session.currentRunId,requestId])).rows[0];
    if(!row)throw new Error("DECISION_CHAT_SNAPSHOT_MISSING");
    const aad=`chat:${session.currentRunId}:${requestId}`,snapshot=unsealV7<ChatSnapshotV7>(aad,row);
    if(snapshot.reply)return snapshot.reply;
    const saved=sealV7(aad,{...snapshot,reply}),sealed=sealV7(`session:${session.id}`,{...current,history:[...current.history,...turns].slice(-12)},1_048_576);
    await client.query("update competition_decision_chat_requests set ciphertext=$3,iv=$4,tag=$5,updated_at=now() where run_id=$1 and request_id=$2",[session.currentRunId,requestId,saved.ciphertext,saved.iv,saved.tag]);
    await client.query("update competition_decision_states set ciphertext=$2,iv=$3,tag=$4,updated_at=now() where state_key=$1",[session.id,sealed.ciphertext,sealed.iv,sealed.tag]);
    return reply;
  });
}
export async function appendChatAuditV7(session:DecisionSessionV7,requestId:string,event:NonNullable<RunBodyV7["auditObservations"]>[number]):Promise<void> {
  await transaction(async client=>{
    const row=(await client.query<ChatRowV7>("select * from competition_decision_chat_requests where run_id=$1 and request_id=$2 for update",[session.currentRunId,requestId])).rows[0];
    if(!row)throw new Error("DECISION_CHAT_SNAPSHOT_MISSING");
    const aad=`chat:${session.currentRunId}:${requestId}`,snapshot=unsealV7<ChatSnapshotV7>(aad,row);
    const observations=snapshot.auditObservations??[];
    if(observations.some(value=>JSON.stringify(value)===JSON.stringify(event)))return;
    const sealed=sealV7(aad,{...snapshot,auditObservations:[...observations,event]});
    await client.query("update competition_decision_chat_requests set ciphertext=$3,iv=$4,tag=$5,updated_at=now() where run_id=$1 and request_id=$2",[session.currentRunId,requestId,sealed.ciphertext,sealed.iv,sealed.tag]);
  });
}
export async function readRunV7(runId:string):Promise<LoadedRunV7|null> {
  const result=await getPool().query<RunRowV7>("select * from competition_decision_runs where run_id=$1 and expires_at>now()",[runId]);
  return result.rows[0]?{row:result.rows[0],body:unsealV7<RunBodyV7>(`run:${runId}`,result.rows[0])}:null;
}
export function presentRunV7(run:LoadedRunV7,session:DecisionSessionV7) {
  if(run.row.state_key!==session.id)throw new Error("DECISION_SESSION_EXPIRED");
  assertFinalPlanBindingV7(run.body,run.row.status);
  const status=run.row.run_id!==session.currentRunId?"superseded":run.row.expires_at.getTime()<=Date.now()?"expired":run.row.status;
  const executionPolicy=readFrozenRunExecutionPolicyV7(run);
  const executionMode=readFrozenRunExecutionModeV7(run);
  return recommendationRunSchema.parse({responseVersion:RECOMMENDATION_RESPONSE_VERSION,runId:run.row.run_id,
    decisionToken:createDecisionTokenV7(session),profile:run.body.context.profile,profileId:run.body.context.profile.profileId,profileRevision:run.body.context.profile.revision,
    catalogVersion:run.body.context.catalogVersion,policyVersion:executionPolicy.policyVersion,implementationVersion:run.row.implementation_version,executionPolicy,executionMode,
    ...(executionMode==="user-unbounded"?{executionLimits:USER_UNBOUNDED_EXECUTION_LIMITS}:{}),status,
    resultVersion:run.row.result_version,submittedAt:run.row.submitted_at.toISOString(),
    listTargetAt:new Date(run.row.submitted_at.getTime()+executionPolicy.listTargetMs).toISOString(),rankDeadlineAt:run.row.list_deadline_at.toISOString(),
    detailTargetAt:new Date(run.row.submitted_at.getTime()+executionPolicy.detailTargetMs).toISOString(),detailDeadlineAt:run.row.detail_deadline_at.toISOString(),expiresAt:run.row.expires_at.toISOString(),listReadyAt:run.body.listReadyAt,detailsReadyAt:run.body.detailsReadyAt,
    pollAfterMs:750,items:run.body.items,shortfallReason:run.body.shortfallReason,
    ...(run.body.effortPolicy?{effortPolicy:run.body.effortPolicy,effortPolicySha256:run.body.effortPolicySha256}:{}),
    ...(run.body.report?{report:run.body.report}:{}),...(run.body.error?{error:run.body.error}:{})});
}
export async function enqueueRunV7(input:{sessionId:string;expiresAt:number;legacy:CompetitionRecommendationProfileV5;context:DecisionContextV6;submissionKey:string;previous?:DecisionTokenV7;expectedRevision?:string;history?:DecisionSessionV7["history"];submittedAtEpochMs?:number;diagnosticOnly?:true}) {
  const receivedAt=Date.now(),id=sessionKeyV7(input.sessionId);
  return transaction(async client=>{
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[id]);
    const oldRow=(await client.query<SessionRow>("select ciphertext,iv,tag,generation,expires_at from competition_decision_states where state_key=$1 for update",[id])).rows[0];
    const old=oldRow?decodeSession(id,oldRow):null;
    const existing=(await client.query<RunRowV7>("select * from competition_decision_runs where submission_key=$1",[input.submissionKey])).rows[0];
    if(existing){
      if(!old||existing.state_key!==id||old.expiresAt<=Date.now())throw new Error("DECISION_SESSION_EXPIRED");
      if(old.currentRunId!==existing.run_id)throw new Error("DECISION_REVISION_CHANGED");
      return {session:old,run:{row:existing,body:unsealV7<RunBodyV7>(`run:${existing.run_id}`,existing)}};
    }
    // Only the trusted HTTP submission context supplies this value. A replay
    // returns its original persisted clock before inspecting any new timestamp.
    const submittedAt=input.submittedAtEpochMs??receivedAt;
    if(input.diagnosticOnly!==undefined&&input.diagnosticOnly!==true)throw new Error("DECISION_DIAGNOSTIC_SCOPE_INVALID");
    if(!Number.isSafeInteger(submittedAt)||submittedAt<=0||submittedAt>receivedAt)throw new Error("DECISION_SUBMISSION_TIME_INVALID");
    const executionPolicy={...RECOMMENDATION_EXECUTION_POLICY};
    const executionMode=readExecutionMode();
    const executionAuthorization=executionMode==="user-unbounded"?await readUserUnboundedExecutionAuthorizationV7(client):undefined;
    let effortPolicy:DecisionEffortPolicy;
    try{const configured=currentDecisionEffortPolicy();effortPolicy=configured.version===EFFORT_POLICY_VERSION_V2?requireRankNonThinkingEffortPolicy(configured):requireCompactRecommendationEffortPolicy(configured);}catch{throw new Error("DECISION_EFFORT_POLICY_CHANGED");}
    const detailLayout=readConfiguredDetailLayoutV7();
    if(submittedAt+executionPolicy.rankHardTimeoutMs<=Date.now())throw new Error("LIST_DEADLINE_EXCEEDED");
    if(Math.min(input.expiresAt,old?.expiresAt??Infinity)<=Date.now()||Math.min(input.expiresAt,old?.expiresAt??Infinity)<submittedAt+executionPolicy.detailHardTimeoutMs+15_000)throw new Error("DECISION_SESSION_EXPIRED");
    if(input.previous&&(!old||input.previous.id!==id||old.generation!==input.previous.generation||old.profile.revision!==input.expectedRevision))throw new Error("DECISION_REVISION_CHANGED");
    if(old&&!input.previous)throw new Error("DECISION_REVISION_CHANGED");
    const runId=randomUUID();
    const session:DecisionSessionV7={id,sessionId:input.sessionId,generation:old?old.generation+1:0,expiresAt:old?.expiresAt??input.expiresAt,
      currentRunId:runId,profile:input.context.profile,legacy:input.legacy,history:input.history??[]};
    const sealedSession=sealV7(`session:${id}`,session,1_048_576);
    await client.query(`insert into competition_decision_states(state_key,generation,ciphertext,iv,tag,expires_at) values($1,$2,$3,$4,$5,$6)
      on conflict(state_key) do update set generation=excluded.generation,ciphertext=excluded.ciphertext,iv=excluded.iv,tag=excluded.tag,expires_at=excluded.expires_at,updated_at=now()`,
      [id,session.generation,sealedSession.ciphertext,sealedSession.iv,sealedSession.tag,new Date(session.expiresAt)]);
    if(old)await client.query("update competition_decision_runs set status='superseded',lease_owner=null,lease_expires_at=null,result_version=result_version+1,updated_at=now() where run_id=$1",[old.currentRunId]);
    const body:RunBodyV7={implementationSha256:recommendationRuntimeBindingV7(),executionPolicy,executionMode,...(executionAuthorization?{executionAuthorization}:{}),sessionGeneration:session.generation,
      effortPolicy,effortPolicySha256:effortPolicySha256(effortPolicy),detailLayout,context:freezeContextV7(input.context),legacy:input.legacy,items:[],listReadyAt:null,detailsReadyAt:null,shortfallReason:null};
    const sealed=sealV7(`run:${runId}`,body);
    const result=await client.query<RunRowV7>(`insert into competition_decision_runs(run_id,state_key,submission_key,implementation_version,status,ciphertext,iv,tag,submitted_at,list_deadline_at,detail_deadline_at,expires_at,execution_mode)
      values($1,$2,$3,$4,'queued',$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [runId,id,input.submissionKey,input.diagnosticOnly?RECOMMENDATION_DIAGNOSTIC_IMPLEMENTATION_VERSION_V7:RECOMMENDATION_IMPLEMENTATION_VERSION,sealed.ciphertext,sealed.iv,sealed.tag,new Date(submittedAt),new Date(submittedAt+executionPolicy.rankHardTimeoutMs),new Date(submittedAt+executionPolicy.detailHardTimeoutMs),new Date(session.expiresAt),executionMode==="user-unbounded"?executionMode:null]);
    return {session,run:{row:result.rows[0],body}};
  });
}
export async function claimRunV7(owner:string):Promise<ClaimedRunV7|null> {
  return transaction(async client=>{
    const selected=(await client.query<RunRowV7>(`select * from competition_decision_runs where implementation_version=$1 and coalesce(execution_mode,'finite')=$2
      and status in ('queued','ranking','list_ready','explaining','partial_ready') and expires_at>now()
      and (lease_expires_at is null or lease_expires_at<now()) order by case when status in ('queued','ranking') then 0 else 1 end,submitted_at
      for update skip locked limit 1`,[RECOMMENDATION_IMPLEMENTATION_VERSION,readExecutionMode()])).rows[0];
    if(!selected)return null;
    const row=(await client.query<RunRowV7>("update competition_decision_runs set lease_owner=$2,lease_fence=lease_fence+1,lease_expires_at=now()+interval '20 seconds',updated_at=now() where run_id=$1 returning *",[selected.run_id,owner])).rows[0];
    return {row,body:unsealV7<RunBodyV7>(`run:${row.run_id}`,row),owner,fence:String(row.lease_fence)};
  });
}
export async function renewRunLeaseV7(claim:ClaimedRunV7):Promise<boolean> {
  const result=await getPool().query(`update competition_decision_runs set lease_expires_at=now()+interval '20 seconds' where run_id=$1 and lease_owner=$2 and lease_fence=$3
    and lease_expires_at>now() and expires_at>now() and status in ('queued','ranking','list_ready','explaining','partial_ready')`,[claim.row.run_id,claim.owner,claim.fence]);
  return result.rowCount===1;
}
export async function releaseRunLeaseV7(claim:ClaimedRunV7):Promise<void> {
  await getPool().query("update competition_decision_runs set lease_owner=null,lease_expires_at=null where run_id=$1 and lease_owner=$2 and lease_fence=$3",[claim.row.run_id,claim.owner,claim.fence]);
}
export async function commitRunV7(claim:ClaimedRunV7,status:RecommendationRunStatusV7,body:RunBodyV7):Promise<void> {
  // An older v7 run may predate the encrypted generation field. It may only
  // terminate as incompatible, never resume generation or publish details.
  let validPolicy=true;
  try {readFrozenRunEffortPolicyV7(body);}catch {validPolicy=false;}
  let validExecutionPolicy=true;
  try {const policy=readFrozenRunExecutionPolicyV7({row:claim.row,body});
    if(policy.policyVersion===RECOMMENDATION_POLICY_VERSION&&(body.items.length>policy.maxItems||(body.plan?.recommendations.length??0)>policy.maxItems||(body.finalPlan?.recommendations.length??0)>policy.maxItems||(body.report?.recommendations.length??0)>policy.maxItems))validExecutionPolicy=false;
  }catch {validExecutionPolicy=false;}
  const legacyTermination=(body.sessionGeneration===undefined&&claim.body.sessionGeneration===undefined||!validPolicy)
    &&status==="failed"&&body.error==="DECISION_IMPLEMENTATION_CHANGED";
  const incompatibleTermination=legacyTermination||!validExecutionPolicy&&status==="failed"&&body.error==="DECISION_IMPLEMENTATION_CHANGED";
  if((!Number.isSafeInteger(body.sessionGeneration)&&!incompatibleTermination)||body.sessionGeneration!==claim.body.sessionGeneration
    ||(!validPolicy&&!incompatibleTermination)||(!validExecutionPolicy&&!incompatibleTermination)||body.effortPolicySha256!==claim.body.effortPolicySha256
    ||JSON.stringify(body.executionPolicy)!==JSON.stringify(claim.body.executionPolicy)
    ||body.executionMode!==claim.body.executionMode||JSON.stringify(body.executionAuthorization)!==JSON.stringify(claim.body.executionAuthorization)
    ||JSON.stringify(body.effortPolicy)!==JSON.stringify(claim.body.effortPolicy)
    ||body.detailLayout!==claim.body.detailLayout
    ||body.implementationSha256!==claim.body.implementationSha256
    ||JSON.stringify(body.context)!==JSON.stringify(claim.body.context))throw new Error("DECISION_RUN_BINDING_CHANGED");
  if(claim.body.plan?.recommendations.some(item=>item.rankTaskStepIndex!==undefined)
    &&!isDeepStrictEqual(body.plan,claim.body.plan))throw new Error("DECISION_RUN_BINDING_CHANGED");
  assertFinalPlanBindingV7(body,status);
  if(body.finalPlan&&(status!=="ready"||!isDeepStrictEqual(body.plan,claim.body.plan)))throw new Error("INVALID_FINAL_SELECTION_BINDING");
  const sealed=sealV7(`run:${claim.row.run_id}`,body),terminal=["ready","failed","expired"].includes(status);
  const expectedVersion=claim.row.result_version;
  const row=await transaction(async client=>{
    // Use the same session -> run lock order as corrections. The transaction
    // contains only validation and persistence, never a model call.
    const state=(await client.query<SessionRow>("select ciphertext,iv,tag,generation,expires_at from competition_decision_states where state_key=$1 and expires_at>now() for share",[claim.row.state_key])).rows[0];
    if(!state||(!incompatibleTermination&&state.generation!==body.sessionGeneration))throw new Error("DECISION_LEASE_LOST");
    const session=decodeSession(claim.row.state_key,state);
    if(session.currentRunId!==claim.row.run_id||session.profile.revision!==body.context.profile.revision)throw new Error("DECISION_LEASE_LOST");
    const result=await client.query<RunRowV7>(`update competition_decision_runs set status=$4,ciphertext=$5,iv=$6,tag=$7,result_version=result_version+1,updated_at=now(),
      lease_owner=case when $8 then null else lease_owner end,lease_expires_at=case when $8 then null else lease_expires_at end
      where run_id=$1 and lease_owner=$2 and lease_fence=$3 and lease_expires_at>now() and expires_at>now()
      and result_version=$9 and status not in ('superseded','ready','failed','expired') returning *`,[claim.row.run_id,claim.owner,claim.fence,status,sealed.ciphertext,sealed.iv,sealed.tag,terminal,expectedVersion]);
    if(!result.rows[0])throw new Error("DECISION_LEASE_LOST");
    return result.rows[0];
  });
  claim.row=row;claim.body=body;
}

/** Every writer belonging to one lease must share this queue. Compute patches
 * inside the callback from the latest committed body, never a captured copy. */
export function createRunWriterV7(claim:ClaimedRunV7) {
  let tail:Promise<void>=Promise.resolve();
  let failure:unknown;
  let failed=false;
  let terminal=false;
  return {
    update(change:(current:RunBodyV7,status:RecommendationRunStatusV7)=>{body:RunBodyV7;status:RecommendationRunStatusV7}|null):Promise<void> {
      const next=tail.then(async()=>{
        if(failed)throw failure;
        if(terminal)throw new Error("DECISION_RUN_ALREADY_TERMINAL");
        const update=change(claim.body,claim.row.status);
        if(!update)return;
        try {await commitRunV7(claim,update.status,update.body);}
        catch(error){failure=error;failed=true;throw error;}
        terminal=["ready","failed","expired"].includes(update.status);
      });
      // A rejected local patch did not touch storage; the caller may persist a
      // failure outcome. A failed/ambiguous database commit stops all writers.
      tail=next.then(()=>undefined,()=>undefined);
      return next;
    },
    async flush():Promise<void> {await tail;if(failed)throw failure;},
  };
}
