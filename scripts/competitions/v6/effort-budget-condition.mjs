import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { effortPolicySha256, parseEffortPolicy, requireCompactRecommendationEffortPolicy, requireRankNonThinkingEffortPolicy, EFFORT_POLICY_VERSION } from '../../../src/lib/ai/effort-policy.mjs';
import {USER_UNBOUNDED_AUTHORIZATION_POLICY,USER_UNBOUNDED_AUTHORIZATION,USER_UNBOUNDED_CONDITION_SCHEMA,USER_UNBOUNDED_EXECUTION_LIMITS,USER_UNBOUNDED_GRANT_VERSION,USER_UNBOUNDED_RUN_PREFIX,COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY,COMPACT_RECOMMENDATION_AUTHORIZATION,RANK_NONTHINKING_AUTHORIZATION_POLICY,RANK_NONTHINKING_AUTHORIZATION,RANK_NONTHINKING_TRIAL_ID,RANK_NONTHINKING_TRIAL_SLOTS} from '../../../src/lib/ai/execution-policy.mjs';
import { FAST24_REPAIR_AUTHORIZATION_POLICY, FAST24_REPAIR_AUTHORIZATION, FAST24_REPAIR_VALIDATION_PURPOSE } from '../../../src/lib/ai/execution-policy.mjs';

import { LOCAL_PREVIEW_AUTHORIZATION_POLICY, LOCAL_PREVIEW_AUTHORIZATION, LOCAL_PREVIEW_PURPOSE, isLocalPreviewBinding } from '../../../src/lib/ai/execution-policy.mjs';

export const EFFORT_AUTHORIZATION_POLICY = 'docs/v7/effort-continuation-contract-20261109.md';
export const TOP5_AUTHORIZATION_POLICY = 'docs/v7/top5-continuation-contract-20261109.md';
export const TOP5_POLICY_VERSION = 'saitu.policy.2026-11-09.v7.top5';
export const TOP5_IMPLEMENTATION_VERSION = 'saitu.async.2026-11-09.v7.3.top5';
const sha = value => createHash('sha256').update(value).digest('hex');
/** Pure file preparation only. This never reads env/secrets, grants or dispatches. */
export async function prepareEffortBudgetCondition({ root, policyFile, effortPolicyFile, phase, mainRunId, priorLedger,executionMode='finite',pilotProofFile, repairValidationFile, localPreviewFile }) {
  const sourcePolicy=[EFFORT_AUTHORIZATION_POLICY,TOP5_AUTHORIZATION_POLICY,USER_UNBOUNDED_AUTHORIZATION_POLICY,COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY,RANK_NONTHINKING_AUTHORIZATION_POLICY,FAST24_REPAIR_AUTHORIZATION_POLICY,LOCAL_PREVIEW_AUTHORIZATION_POLICY].find(value=>path.resolve(policyFile??'')===path.join(path.resolve(root),value));
  const compact=sourcePolicy===COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY;
  const fastRank=sourcePolicy===RANK_NONTHINKING_AUTHORIZATION_POLICY;
  const step8Repair=sourcePolicy===FAST24_REPAIR_AUTHORIZATION_POLICY;
  const localPreview=sourcePolicy===LOCAL_PREVIEW_AUTHORIZATION_POLICY;
  const userUnbounded=sourcePolicy===USER_UNBOUNDED_AUTHORIZATION_POLICY||compact||fastRank||step8Repair||localPreview;
  if(executionMode!==(userUnbounded?'user-unbounded':'finite'))throw new Error('explicit_execution_mode_required');
  if (!sourcePolicy || !effortPolicyFile ||
      !['calibration', 'formal', 'repair', 'performance', 'reserve'].includes(phase) ||
      typeof mainRunId !== 'string' || !mainRunId || !Array.isArray(priorLedger)) throw new Error('approved_stage_effort_policy_required');
  if(await realpath(policyFile)!==path.join(await realpath(root),sourcePolicy))throw new Error('approved_stage_effort_policy_required');
  const policyBytes = await readFile(path.resolve(policyFile));
  const effortPolicy = parseEffortPolicy(JSON.parse(await readFile(path.resolve(effortPolicyFile), 'utf8')));
  const top5=sourcePolicy===TOP5_AUTHORIZATION_POLICY||userUnbounded;
  if(fastRank||step8Repair||localPreview)requireRankNonThinkingEffortPolicy(effortPolicy);
  else if(effortPolicy.version!==EFFORT_POLICY_VERSION)throw new Error('legacy_authorization_requires_v1_policy');
  if(compact)requireCompactRecommendationEffortPolicy(effortPolicy);
  else if(top5&&['rank','explain','review'].some(stage=>effortPolicy[stage]!=='low'))throw new Error('approved_top5_low_policy_required');
  let pilotContinuation=null;
  if(fastRank&&phase!=='calibration') {
    if(!pilotProofFile)throw new Error('passed_rank_nonthinking_pilot_proof_required');
    const {verifyRankNonThinkingPilotProof}=await import('../v7/rank-nonthinking-pilot-proof.mjs');
    pilotContinuation=await verifyRankNonThinkingPilotProof(root,pilotProofFile);
  } else if(pilotProofFile!==undefined)throw new Error('pilot_proof_only_for_rank_nonthinking_continuation');
  const policySha256 = sha(policyBytes), policyHash = effortPolicySha256(effortPolicy);
  let repairBinding;
  if (step8Repair) {
    if (phase !== 'repair' || !repairValidationFile) throw new Error('fast24_repair_phase_and_frozen_binding_required');
    const { verifyFast24RepairPolicy, readFast24RepairValidationBinding } = await import('../v7/fast24-repair-authorization.mjs');
    const approval = await verifyFast24RepairPolicy(root);
    if (approval.policySha256 !== policySha256) throw new Error('fast24_repair_authorization_changed');
    repairBinding = { runPurpose: FAST24_REPAIR_VALIDATION_PURPOSE, repairAuthorizationRecordSha256: approval.repairAuthorizationRecordSha256,
      repairValidation: await readFast24RepairValidationBinding(root, repairValidationFile) };
  } else if (repairValidationFile !== undefined) throw new Error('fast24_repair_binding_requires_current_repair_policy');
  let previewBinding;
  if (localPreview) {
    if (phase !== 'reserve' || !localPreviewFile) throw new Error('local_preview_reserve_binding_required');
    const filename = await realpath(localPreviewFile);
    if (!filename.startsWith((await realpath(root)) + path.sep)) throw new Error('local_preview_binding_must_stay_in_repository');
    const binding = JSON.parse(await readFile(filename, 'utf8'));
    if (!isLocalPreviewBinding(binding)) throw new Error('local_preview_binding_invalid');
    previewBinding = { runPurpose: LOCAL_PREVIEW_PURPOSE, localPreview: binding };
  } else if (localPreviewFile !== undefined) throw new Error('local_preview_binding_requires_local_preview_policy');
  const condition = { schemaVersion: userUnbounded?USER_UNBOUNDED_CONDITION_SCHEMA:top5?'saitu.user-approved-budget-condition.v7.top5.v1':'saitu.user-approved-budget-condition.v7.effort.v1', model: 'deepseek-flash', effort: 'stage',
    phase, mainRunId, policySha256, authorization: localPreview?LOCAL_PREVIEW_AUTHORIZATION:step8Repair?FAST24_REPAIR_AUTHORIZATION:fastRank?RANK_NONTHINKING_AUTHORIZATION:compact?COMPACT_RECOMMENDATION_AUTHORIZATION:userUnbounded?USER_UNBOUNDED_AUTHORIZATION:top5?'user-approved-20261109-top5-continuation':'user-approved-20261109-effort-exploration', freshPgRowsVerified: true,
    sourcePolicy, ...(top5?{policyVersion:TOP5_POLICY_VERSION,implementationVersion:TOP5_IMPLEMENTATION_VERSION}:{}),
    effortPolicy, effortPolicySha256: policyHash, priorLedgerSha256: sha(JSON.stringify(priorLedger)),
    ...(userUnbounded?{executionMode,executionLimits:USER_UNBOUNDED_EXECUTION_LIMITS}:{}),
    ...(fastRank?{rankModelSettings:{thinking:'disabled',policyReasoningEffort:'low',wireReasoningEffort:null,temperature:0,topP:1},developmentTrial:{id:RANK_NONTHINKING_TRIAL_ID,maxReports:3,slotIds:RANK_NONTHINKING_TRIAL_SLOTS},pilotContinuation}:{}),
    ...(step8Repair||localPreview?{rankModelSettings:{thinking:'disabled',policyReasoningEffort:'low',wireReasoningEffort:null,temperature:0,topP:1},pilotContinuation}:{}),
    ...repairBinding, ...previewBinding };
  return { policyBytes, policySha256, effortPolicy, effortPolicySha256: policyHash, condition, conditionSha256: sha(JSON.stringify(condition)),
    grantVersion:userUnbounded?USER_UNBOUNDED_GRANT_VERSION:top5?'saitu.v7.top5.v1':'saitu.v7.effort.v1',runIdPrefix:userUnbounded?USER_UNBOUNDED_RUN_PREFIX:top5?'saitu-v7-top5-20261109':'saitu-v7-effort-20261109',executionMode };
}
