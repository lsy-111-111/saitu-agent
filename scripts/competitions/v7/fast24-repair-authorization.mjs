import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { byteHash } from "./evaluation-policy.mjs";
import { requireRankNonThinkingEffortPolicy } from "../../../src/lib/ai/effort-policy.mjs";
import { FAST24_REPAIR_AUTHORIZATION_POLICY, FAST24_REPAIR_AUTHORIZATION_RECORD, FAST24_REPAIR_VALIDATION_PURPOSE,
  isFast24RepairValidationBinding } from "../../../src/lib/ai/execution-policy.mjs";

const assert = (condition, reason) => { if (!condition) throw new Error(`fast24_repair_authorization:${reason}`); };

export async function verifyFast24RepairPolicy(repositoryRoot) {
  const root = await realpath(repositoryRoot);
  const policyPath = path.join(root, FAST24_REPAIR_AUTHORIZATION_POLICY);
  const recordPath = path.join(root, FAST24_REPAIR_AUTHORIZATION_RECORD);
  assert(await realpath(policyPath) === policyPath && await realpath(recordPath) === recordPath, "local_policy_and_approval_required");
  const [policy, approval] = await Promise.all([readFile(policyPath), readFile(recordPath)]);
  const policySha256 = byteHash(policy);
  const record = JSON.parse(approval);
  assert(record.schemaVersion === "saitu.step8-first.authorization.v1" && record.policy?.path === policyPath &&
    record.policy.sha256 === policySha256 && record.resumeAuthorized === true && record.rootOnlyPaidDispatch === true &&
    record.repairRequiresFreshFixed3 === false && record.eachFull468Fresh === true && record.productionDeployment === false &&
    record.provider === "deepseek" && record.budget === "user-unbounded", "current_user_approval_required");
  return { policySha256, repairAuthorizationRecordSha256: byteHash(approval) };
}

export async function verifyFast24RepairAuthorization(repositoryRoot, scope) {
  const { repairValidation, authorizationPolicySnapshot } = scope;
  const root = await realpath(repositoryRoot);
  assert(scope.runPurpose === FAST24_REPAIR_VALIDATION_PURPOSE && scope.phase === "repair" &&
    scope.authorizationPolicySource === FAST24_REPAIR_AUTHORIZATION_POLICY && scope.pilotContinuation === null &&
    isFast24RepairValidationBinding(repairValidation), "repair_only_separately_bound_authority_required");
  requireRankNonThinkingEffortPolicy(scope.effortPolicy);
  const approval = await verifyFast24RepairPolicy(root);
  const snapshotPath = path.resolve(root, authorizationPolicySnapshot?.path ?? "");
  assert((await realpath(snapshotPath)).startsWith(root + path.sep) &&
    authorizationPolicySnapshot?.sha256 === approval.policySha256 &&
    byteHash(await readFile(snapshotPath)) === approval.policySha256 &&
    scope.authorizationPolicySha256 === approval.policySha256 &&
    scope.repairAuthorizationRecordSha256 === approval.repairAuthorizationRecordSha256, "repair_approval_or_snapshot_changed");
  return repairValidation;
}

/** Grant preparation verifies a frozen manifest before a budget can be opened. */
export async function readFast24RepairValidationBinding(repositoryRoot, bindingFile) {
  const root = await realpath(repositoryRoot);
  const filename = await realpath(path.resolve(root, bindingFile));
  const permitted = path.join(root, "artifacts/step8-first-20261111/D") + path.sep;
  assert(filename.startsWith(permitted) && path.basename(filename) === "repair-validation-binding.json", "frozen_repair_binding_required");
  const binding = JSON.parse(await readFile(filename));
  assert(isFast24RepairValidationBinding(binding), "invalid_repair_binding");
  const manifest = await readFile(path.join(path.dirname(filename), "manifest.json"));
  const plan = JSON.parse(manifest).acceptanceRun;
  assert(plan?.runPurpose === FAST24_REPAIR_VALIDATION_PURPOSE && byteHash(manifest) === binding.selectionSha256 &&
    plan.candidate?.applicationRuntimeSourceSha256 === binding.applicationRuntimeSourceSha256 &&
    plan.candidate.productionBuildId === binding.productionBuildId && plan.candidate.candidatePoolSha256 === binding.candidatePoolSha256,
  "repair_binding_does_not_match_frozen_candidate");
  return binding;
}
