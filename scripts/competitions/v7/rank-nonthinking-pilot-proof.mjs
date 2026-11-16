// Read-only promotion evidence for the explicitly approved three-report pilot.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { canonicalHash, byteHash, POLICY_SHA256 } from './evaluation-policy.mjs';
import { runtimeBehaviorConfiguration } from './evaluation-runtime.mjs';
import { evaluationRuntimeForEffort, assertDispatchEffort, rankNonThinkingContinuationForScope } from './evaluation-effort.mjs';
import { RANK_NON_THINKING_EFFORT_POLICY, effortPolicySha256, requireRankNonThinkingEffortPolicy } from '../../../src/lib/ai/effort-policy.mjs';
import {RANK_NONTHINKING_AUTHORIZATION_POLICY,RANK_NONTHINKING_TRIAL_ID} from '../../../src/lib/ai/execution-policy.mjs';
import { FAST24_MATCH_POLICY_VERSION, hasFast24RecommendationCount } from './fast24-config.mjs';
import { fast24FinalReportEvidence } from './fast24-early-stop.mjs';

export const RANK_NONTHINKING_PILOT_SLOTS = Object.freeze([
  Object.freeze({slotId:'completion-dev-06:C:0:rank-nonthinking',caseId:'completion-dev-06',repetition:0,algorithm:'C'}),
  Object.freeze({slotId:'completion-dev-10:C:0:rank-nonthinking',caseId:'completion-dev-10',repetition:0,algorithm:'C'}),
  Object.freeze({slotId:'completion-dev-10:C:1:rank-nonthinking',caseId:'completion-dev-10',repetition:1,algorithm:'C'}),
]);
export const RANK_NONTHINKING_PILOT_ID=RANK_NONTHINKING_TRIAL_ID;
export const RANK_NONTHINKING_PILOT_INPUTS_SHA256='05a4f1ee304e39114c73d0ed2a18015fe0f9ad9860878e61815bb561f9932482';
export const RANK_NONTHINKING_PILOT_CATALOG_SHA256='ddf3eb16f7ca7228004796907c425caa79a2a9a8b458946e3f95d1001fa8a009';
const FIXED_PILOT_RECORD_IDS_SHA256='8800e02536fe4ef6bd1c3734f865a42e2f52dba7319a66b233d6c859a5599e4d';
// Each added catalog is an independently reviewed byte identity over the same 45 records.
const REVIEWED_CATALOG_REVISIONS=Object.freeze({
  v743:Object.freeze({
    catalogSha256:'2341757bdea03e9302c87f3e3c47def7e20bfefaea30d2aaf06d0130d4c74e1a',
    previousCatalogSha256:RANK_NONTHINKING_PILOT_CATALOG_SHA256,
    review:Object.freeze({
      path:'artifacts/accelerate-20261111/E/v743-catalog-revision-review.safe.json',
      sha256:'fb73ef80791d4ce1e0b2dc5295e7548553273e9b805ddd9fab0709cb123cffec',
    }),
  }),
  v748:Object.freeze({
    catalogSha256:'70f38d407fd726d4816774c250ec4795709fd585af71eb431d331b6ca783b90a',
    previousCatalogSha256:'2341757bdea03e9302c87f3e3c47def7e20bfefaea30d2aaf06d0130d4c74e1a',
    review:Object.freeze({
      path:'artifacts/accelerate-20261111/E/v748-catalog-revision-review.safe.json',
      sha256:'dfb12206b6eeb83446bd3d1f40e0d5695f50e268f09d94ef11a0e9265f05e9ae',
    }),
  }),
  v753:Object.freeze({
    catalogSha256:'658d3bc1d9aa3f59f59c49b709b44bead19a365c411a6021d25ad9988652e6a5',
    previousCatalogSha256:'70f38d407fd726d4816774c250ec4795709fd585af71eb431d331b6ca783b90a',
    review:Object.freeze({
      path:'artifacts/accelerate-20261111/E/v753-catalog-revision-review.safe.json',
      sha256:'09952640c3f01ac207aff7a281e29ae69a7de03b812f0d70bdd966d08071ef9d',
    }),
  }),
  v758:Object.freeze({
    catalogSha256:'9aa316b384e3945f0b6972637f59f32e9210e4bf3f070f7889a3e194631abc58',
    previousCatalogSha256:'658d3bc1d9aa3f59f59c49b709b44bead19a365c411a6021d25ad9988652e6a5',
    review:Object.freeze({
      path:'artifacts/step8-first-20261111/E/v758-catalog-revision-review.safe.json',
      sha256:'e201a9fa9835dc7d80e19e2959a33ecd4d181d2abab7aa0cc09ac3afdfab222a',
    }),
  }),
  v762:Object.freeze({
    catalogSha256:'f299d2219896b42bfc796e55161c58d352e7c59cfa3ccef660ba6bd02067b779',
    previousCatalogSha256:'9aa316b384e3945f0b6972637f59f32e9210e4bf3f070f7889a3e194631abc58',
    review:Object.freeze({
      path:'artifacts/step8-first-20261111/E/v762-catalog-revision-review.safe.json',
      sha256:'3c26f18fb34495f0d3a2c90169214ca623b17d5bc50b911a0039f3f4e0f6f4d4',
    }),
  }),
});
const fail=message=>{throw new Error(`rank_nonthinking_pilot_proof:${message}`);};
const check=(value,message)=>{if(!value)fail(message);};
const policy=RANK_NON_THINKING_EFFORT_POLICY,policyHash=effortPolicySha256(policy);
const same=(left,right)=>canonicalHash(left)===canonicalHash(right);
const localPath=(root,filename)=>{
  check(typeof filename==='string'&&filename.length>0,'bound_path_required');
  const resolved=path.resolve(root,filename);check(resolved.startsWith(path.resolve(root)+path.sep),'bound_path_must_stay_in_repository');return resolved;
};
async function bound(root,reference){
  check(reference&&/^[a-f0-9]{64}$/.test(reference.sha256??''),'bound_sha256_required');
  const filename=localPath(root,reference.path),bytes=await readFile(filename);
  check(byteHash(bytes)===reference.sha256,'bound_original_bytes_changed');return{filename,bytes};
}
async function boundJson(root,reference){const result=await bound(root,reference);return{...result,value:JSON.parse(result.bytes)};}

function expectedCatalogBinding(catalogSha256){
  if(catalogSha256===RANK_NONTHINKING_PILOT_CATALOG_SHA256)return{catalogSha256};
  const entry=Object.entries(REVIEWED_CATALOG_REVISIONS).find(([,row])=>row.catalogSha256===catalogSha256);
  check(entry,'independently_reviewed_pilot_catalog_required');
  const [catalogRevision,row]=entry;
  return{catalogSha256,catalogRevision,catalogRecordIdsSha256:FIXED_PILOT_RECORD_IDS_SHA256,catalogRevisionReview:row.review};
}
function declaredCatalogBinding(record){
  const keys=['catalogSha256','catalogRevision','catalogRecordIdsSha256','catalogRevisionReview'];
  return Object.fromEntries(keys.filter(key=>Object.hasOwn(record,key)).map(key=>[key,record[key]]));
}
async function verifyCatalogBinding(root,record){
  const expected=expectedCatalogBinding(record.catalogSha256);
  check(same(declaredCatalogBinding(record),expected),'locked_catalog_revision_binding_changed');
  for(let revision=expected;revision.catalogRevisionReview;){
    const previousCatalogSha256=REVIEWED_CATALOG_REVISIONS[revision.catalogRevision].previousCatalogSha256;
    const {value}=await boundJson(root,revision.catalogRevisionReview);
    check(value.schemaVersion==='saitu.rank-nonthinking-pilot-catalog-revision-review.v1'&&value.reviewer==='E'&&value.locked===true&&
      value.revision===revision.catalogRevision&&value.previousCatalogSha256===previousCatalogSha256&&
      value.catalogSha256===revision.catalogSha256&&value.recordIdsSha256===revision.catalogRecordIdsSha256,'catalog_revision_independent_review_binding_changed');
    revision=expectedCatalogBinding(previousCatalogSha256);
  }
  return expected;
}

/** Fresh preparation binds actual catalog content and preserves every original record identity. */
export async function rankNonThinkingPilotCatalogBinding(repositoryRoot,records){
  check(Array.isArray(records)&&records.length===45&&
    canonicalHash(records.map(record=>record.recordId).sort())===FIXED_PILOT_RECORD_IDS_SHA256,'fixed_45_catalog_record_ids_changed');
  return verifyCatalogBinding(path.resolve(repositoryRoot),expectedCatalogBinding(canonicalHash(records)));
}

/** Restrict each independent vote to its reviewer's evidence directory. */
export function isRankNonThinkingReviewOwnerPath(root,reviewer,filename){
  if(!['E','F'].includes(reviewer)||typeof filename!=='string')return false;
  const resolved=path.resolve(root,filename);
  return ['artifacts/compact-20261110','artifacts/resume-20261111','artifacts/accelerate-20261111','artifacts/step8-first-20261111'].some(cohort=>
    resolved.startsWith(path.join(path.resolve(root),cohort,reviewer)+path.sep));
}

/** Existing runtime source discovery, with public settings only; no grant or IO side effects. */
export function rankNonThinkingPilotSourceBindings(){
  return runtimeBehaviorConfiguration({AI_PROVIDER:'deepseek',AI_MODEL:'deepseek-flash',SAITU_AI_EXECUTION_MODE:'user-unbounded',
    SAITU_V7_DETAIL_LAYOUT:'single',SAITU_V7_EFFORT_POLICY:JSON.stringify(policy),SAITU_V7_EFFORT_POLICY_SHA256:policyHash}).behaviorSourceBindings;
}

/** Mechanical receipt check; semantic pass still requires both independent locked reviews. */
export function rankNonThinkingPilotSlotMetrics(slot,raw,submitted,execution,expectedInputSha256){
  const observation=raw?.observation;
  check(raw?.slotId===slot.slotId&&observation?.caseId===slot.caseId&&observation.repetition===slot.repetition&&observation.algorithm==='C','fixed_slot_identity_changed');
  check(observation.status==='observed'&&observation.fallback===false&&Array.isArray(observation.output?.recommendations),'all_three_complete_reports_required');
  check(hasFast24RecommendationCount(observation.output.recommendations.length),'one_to_five_recommendations_required');
  check(observation.inputSha256===expectedInputSha256&&observation.freezeBinding?.implementationSha256===execution.implementationSha256,'input_or_source_binding_changed');
  check(same(observation.runtime,evaluationRuntimeForEffort(policy))&&observation.execution?.actualModelRun===true&&observation.execution.kind==='live_product','real_v2_runtime_required');
  const ready=observation.groupedRuns?.findLast(row=>row.status==='ready');
  check(ready&&ready.body.detailLayout==='single'&&ready.body.implementationSha256===execution.implementationSha256&&same(ready.body.effortPolicy,policy),'same_source_ready_product_run_required');
  const final=fast24FinalReportEvidence(observation);
  check(final?.technicalComplete,'final_ready_report_and_plan_must_agree');
  check(submitted?.runId===ready.runId&&Number.isSafeInteger(submitted.submittedAtEpochMs),'same_original_submission_clock_required');
  const listMs=Date.parse(ready.body.listReadyAt)-submitted.submittedAtEpochMs;
  const detailsMs=Date.parse(ready.body.detailsReadyAt)-submitted.submittedAtEpochMs;
  check(Number.isFinite(listMs)&&Number.isFinite(detailsMs)&&listMs>=0&&detailsMs>=listMs&&listMs<=40000&&detailsMs<=120000,'fixed_40s_120s_targets_not_met');
  check(submitted.firstListTargetEpochMs===submitted.submittedAtEpochMs+40000&&submitted.listDeadlineEpochMs===submitted.submittedAtEpochMs+60000&&
    submitted.detailTargetEpochMs===submitted.submittedAtEpochMs+120000&&submitted.detailDeadlineEpochMs===submitted.submittedAtEpochMs+150000,'original_deadlines_changed');
  const responses=raw.responses;
  check(Array.isArray(responses)&&new Set(responses.map(row=>row.callId)).size===responses.length,'unique_original_calls_required');
  let actualRankCalls=0,actualDispatches=0;
  for(const response of responses){
    const operation=response.options?.operation;
    check(['competition_v7_rank','competition_v7_explain','competition_v7_review'].includes(operation),'pilot_operation_changed');
    check(response.effortPolicySha256===policyHash&&response.evidenceType==='actual_ai_json_result_and_transport_reservation_events','original_policy_or_provenance_changed');
    const events=response.events??[],dispatches=events.filter(event=>event.type==='ai_transport_dispatch');
    check(dispatches.length<=1&&Boolean(response.result?.upstreamAttempted)===(dispatches.length===1),'one_attempt_transport_provenance_required');
    for(const event of dispatches){assertDispatchEffort(event.details,policy);actualDispatches+=1;}
    if(operation==='competition_v7_rank'){
      check(response.options.thinking==='disabled'&&response.options.reasoningEffort==='low'&&response.options.temperature===0&&response.options.topP===1&&
        response.options.policyReasoningEffort==='low'&&response.options.wireReasoningEffort===null,'actual_disabled_temperature0_topP1_required');
      actualRankCalls+=dispatches.length;
    }else check(response.options.thinking==='enabled'&&response.options.reasoningEffort==='low','explain_review_must_stay_enabled_low');
  }
  check(actualRankCalls>=1&&actualDispatches===observation.execution.httpDispatches,'real_rank_dispatch_and_exact_call_count_required');
  const context=ready.body.context;
  check(Array.isArray(context?.records)&&context.records.length===45&&canonicalHash(context.records)===execution.catalogSha256,'same45_candidate_pool_required');
  return{slotId:slot.slotId,caseId:slot.caseId,repetition:slot.repetition,listMs,detailsMs,
    detailStageMs:detailsMs-listMs,itemCount:final.itemIds.length,actualDispatches};
}

export async function verifyRankNonThinkingPilotProof(repositoryRoot,proofFile){
  const root=path.resolve(repositoryRoot),filename=localPath(root,proofFile),proofBytes=await readFile(filename),proof=JSON.parse(proofBytes);
  check(proof.schemaVersion==='saitu.rank-nonthinking-pilot-proof.v1'&&proof.effortPolicySha256===policyHash&&proof.detailLayout==='single','explicit_v2_pilot_proof_required');
  const plan=await boundJson(root,proof.plan),execution=await boundJson(root,proof.execution);
  if (['artifacts/accelerate-20261111','artifacts/step8-first-20261111'].some(cohort=>execution.filename.startsWith(path.join(root,cohort)+path.sep)))
    check(plan.value.matchPolicyVersion===FAST24_MATCH_POLICY_VERSION&&execution.value.matchPolicyVersion===FAST24_MATCH_POLICY_VERSION,'current_match_policy_binding_required');
  check(plan.value.schemaVersion==='saitu.rank-nonthinking-pilot-plan.v1'&&execution.value.schemaVersion==='saitu.rank-nonthinking-pilot-run.v1','pilot_plan_and_execution_schema_required');
  check(plan.value.pilotId===RANK_NONTHINKING_PILOT_ID&&execution.value.pilotId===RANK_NONTHINKING_PILOT_ID&&
    path.dirname(execution.filename)===localPath(root,plan.value.outputDirectory),'single_predeclared_pilot_directory_required');
  check(same(plan.value.slots,RANK_NONTHINKING_PILOT_SLOTS)&&same(execution.value.slots,RANK_NONTHINKING_PILOT_SLOTS),'fixed_three_slots_changed');
  check(plan.value.reportCap===3&&plan.value.failuresReplaced===false&&execution.value.priorAnswersInjected===false&&execution.value.independentInvocations===true,'fixed_cap_and_independent_invocations_required');
  requireRankNonThinkingEffortPolicy(execution.value.effortPolicy);
  check(execution.value.effortPolicySha256===policyHash&&execution.value.detailLayout==='single'&&execution.value.plan?.sha256===proof.plan.sha256,'pilot_policy_or_plan_changed');
  check(execution.value.seed===plan.value.seed&&plan.value.seed===20261110&&execution.value.asOf===plan.value.asOf,'input_seed_or_clock_changed');
  const catalogBinding=await verifyCatalogBinding(root,plan.value);
  check(same(declaredCatalogBinding(execution.value),catalogBinding),'same_frozen_catalog_for_plan_and_originals_required');
  const input=await boundJson(root,plan.value.inputs);
  check(canonicalHash(input.value)===plan.value.inputCanonicalSha256&&plan.value.inputCanonicalSha256===RANK_NONTHINKING_PILOT_INPUTS_SHA256&&
    plan.value.seed===input.value.seed&&plan.value.asOf===input.value.asOf,'pilot_public_input_bytes_changed');
  const scope=await boundJson(root,execution.value.scope);
  check(scope.value.phase==='calibration'&&scope.value.authorizedPhase==='calibration'&&scope.value.effortPolicySha256===policyHash&&
    scope.value.detailLayout==='single'&&scope.value.implementationSha256===execution.value.implementationSha256&&scope.value.evaluationPolicySha256===POLICY_SHA256,'independent_calibration_scope_required');
  const authorization=await bound(root,scope.value.authorizationPolicySnapshot);
  check(authorization.filename===path.join(root,RANK_NONTHINKING_AUTHORIZATION_POLICY)&&scope.value.authorizationPolicySnapshot.sha256===scope.value.authorizationPolicySha256,'explicit_original_trial_authorization_required');
  const sourceBindings=execution.value.behaviorSourceBindings;
  check(Array.isArray(sourceBindings)&&sourceBindings.length>0&&execution.value.sourceBindingsSha256===canonicalHash(sourceBindings)&&
    proof.sourceBindingsSha256===execution.value.sourceBindingsSha256,'source_binding_list_hash_changed');
  const currentBindings=rankNonThinkingPilotSourceBindings();
  check(same(sourceBindings,currentBindings),'current_source_files_differ_from_passed_pilot');
  for(const reference of sourceBindings)await bound(root,reference);
  check(Array.isArray(proof.originals)&&proof.originals.length===3&&new Set(proof.originals.map(row=>row.slotId)).size===3,'three_actual_originals_required');
  const metrics=[],invocationIds=new Set(),callIds=new Set(),allowedOriginals=new Set();
  for(const slot of RANK_NONTHINKING_PILOT_SLOTS){
    const entry=proof.originals.find(row=>row.slotId===slot.slotId);check(entry,'fixed_original_missing');
    const original=await boundJson(root,entry.original),journal=await bound(root,entry.journal);
    const key=canonicalHash({executionSha256:canonicalHash(execution.value),slotId:slot.slotId});
    const expectedBase=path.join(path.dirname(execution.filename),'invocations',key);
    check(original.filename===expectedBase+'.json'&&journal.filename===expectedBase+'.journal.jsonl','original_must_be_exact_frozen_execution_slot');
    allowedOriginals.add(key+'.json');allowedOriginals.add(key+'.intent.json');allowedOriginals.add(key+'.journal.jsonl');
    check(!invocationIds.has(original.value.observation?.invocationId),'independent_invocation_ids_required');invocationIds.add(original.value.observation?.invocationId);
    for(const call of original.value.responses??[]){check(!callIds.has(call.callId),'provider_calls_may_not_be_reused_across_slots');callIds.add(call.callId);}
    let submitted=null;
    for(const line of journal.bytes.toString().split('\n')){
      if(!line)continue;const row=JSON.parse(line);
      if(row.type==='group_run_submitted'&&row.parentInvocationId===original.value.observation?.invocationId){submitted=row;break;}
    }
    const profile=input.value.profiles.find(row=>row.caseId===slot.caseId);check(profile,'fixed_public_profile_missing');
    metrics.push(rankNonThinkingPilotSlotMetrics(slot,original.value,submitted,execution.value,canonicalHash(profile.input)));
  }
  const originalFiles=await readdir(path.join(path.dirname(execution.filename),'invocations'));
  check(originalFiles.every(name=>allowedOriginals.has(name)),'extra_or_replacement_pilot_invocations_forbidden');
  check(Array.isArray(proof.reviews)&&proof.reviews.length===2,'two_independent_locked_reviews_required');
  const reviews=[];
  for(const reviewer of ['E','F']){
    const reference=proof.reviews.find(row=>row.reviewer===reviewer);check(reference,'independent_reviewer_missing');
    const review=await boundJson(root,reference);
    check(isRankNonThinkingReviewOwnerPath(root,reviewer,review.filename),'review_must_be_owned_by_independent_reviewer');
    const value=review.value;
    check(value.schemaVersion==='saitu.rank-nonthinking-pilot-review.v1'&&value.reviewer===reviewer&&value.independent===true&&value.locked===true&&
      value.otherReviewerVotesReadBeforeLock===false&&value.executionSha256===proof.execution.sha256&&value.planSha256===proof.plan.sha256,'independent_locked_review_binding_changed');
    check(Array.isArray(value.slots)&&value.slots.length===3&&new Set(value.slots.map(row=>row.slotId)).size===3,'all_three_review_slots_required');
    for(const slot of RANK_NONTHINKING_PILOT_SLOTS){
      const vote=value.slots.find(row=>row.slotId===slot.slotId),original=proof.originals.find(row=>row.slotId===slot.slotId);
      check(vote&&vote.originalSha256===original.original.sha256&&vote.semanticPass===true&&vote.criticalErrors===0,'all_three_semantic_passes_and_zero_critical_required');
    }
    reviews.push({reviewer,path:review.filename,sha256:reference.sha256});
  }
  return{proofFile:filename,proofSha256:byteHash(proofBytes),sourceBindingsSha256:proof.sourceBindingsSha256,
    pilotExecutionSha256:proof.execution.sha256,pilotPlanSha256:proof.plan.sha256,slotIds:RANK_NONTHINKING_PILOT_SLOTS.map(row=>row.slotId),
    effortPolicySha256:policyHash,detailLayout:'single',complete:3,metrics,reviews};
}

export async function verifyRankNonThinkingContinuationScope(repositoryRoot,scope){
  const declared=rankNonThinkingContinuationForScope(scope);if(!declared)return null;
  const root=path.resolve(repositoryRoot),doc=await readFile(path.join(root,RANK_NONTHINKING_AUTHORIZATION_POLICY));
  check(byteHash(doc)===scope.authorizationPolicySha256,'continuation_authorization_bytes_changed');
  if(scope.authorizationPolicySnapshot){
    const snapshot=await bound(root,scope.authorizationPolicySnapshot);
    check(byteHash(snapshot.bytes)===scope.authorizationPolicySha256,'continuation_snapshot_bytes_changed');
  }else{
    const snapshot=await readFile(localPath(root,scope.approvedPolicyPath));
    check(byteHash(snapshot)===scope.authorizationPolicySha256,'continuation_snapshot_bytes_changed');
  }
  const verified=await verifyRankNonThinkingPilotProof(root,declared.proofFile);
  for(const field of ['proofSha256','sourceBindingsSha256','pilotExecutionSha256','pilotPlanSha256','effortPolicySha256','detailLayout','complete'])
    check(verified[field]===declared[field],'declared_continuation_differs_from_verified_proof');
  check(same(verified.slotIds,declared.slotIds),'declared_continuation_slots_changed');
  return verified;
}
