import type {DecisionEffortPolicy} from "../../../src/lib/ai/effort-policy.mjs";
export const EFFORT_AUTHORIZATION_POLICY:"docs/v7/effort-continuation-contract-20261109.md";
export const TOP5_AUTHORIZATION_POLICY:"docs/v7/top5-continuation-contract-20261109.md";
export const TOP5_POLICY_VERSION:"saitu.policy.2026-11-09.v7.top5";
export const TOP5_IMPLEMENTATION_VERSION:"saitu.async.2026-11-09.v7.3.top5";
export function prepareEffortBudgetCondition(input:{root:string;policyFile:string;effortPolicyFile:string;phase:string;mainRunId:string;priorLedger:unknown[];executionMode?:"finite"|"user-unbounded";pilotProofFile?:string;repairValidationFile?:string}):Promise<{
  policyBytes:Buffer;policySha256:string;effortPolicy:DecisionEffortPolicy;effortPolicySha256:string;condition:Record<string,unknown>;conditionSha256:string;
  grantVersion:"saitu.v7.effort.v1"|"saitu.v7.top5.v1"|"saitu.v7.top5.user-unbounded.v1";runIdPrefix:"saitu-v7-effort-20261109"|"saitu-v7-top5-20261109"|"saitu-v7-top5-unbounded-20261109";executionMode:"finite"|"user-unbounded";
}>;
