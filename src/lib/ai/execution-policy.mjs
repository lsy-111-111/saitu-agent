export const USER_UNBOUNDED_EXECUTION_MODE = "user-unbounded";
export const USER_UNBOUNDED_GRANT_VERSION = "saitu.v7.top5.user-unbounded.v1";
export const TOP5_UNBOUNDED_GRANT_VERSION = USER_UNBOUNDED_GRANT_VERSION;
export const USER_UNBOUNDED_AUTHORIZATION_POLICY = "docs/v7/top5-unbounded-execution-contract-20261109.md";
export const USER_UNBOUNDED_CONDITION_SCHEMA = "saitu.user-approved-budget-condition.v7.top5.user-unbounded.v1";
export const USER_UNBOUNDED_AUTHORIZATION = "user-approved-20261109-top5-unbounded-execution";
export const COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY = "docs/v7/compact-output-contract-20261110.md";
export const COMPACT_RECOMMENDATION_AUTHORIZATION = "user-approved-20261110-compact-rank-high";
export const RANK_NONTHINKING_AUTHORIZATION_POLICY = "docs/v7/rank-nonthinking-trial-contract-20261110.md";
export const RANK_NONTHINKING_AUTHORIZATION = "user-approved-20261110-rank-nonthinking-temperature-zero";
export const RANK_NONTHINKING_TRIAL_ID = "rank-nonthinking-three-20261110-v1";
export const RANK_NONTHINKING_TRIAL_SLOTS = Object.freeze(["completion-dev-06:C:0:rank-nonthinking","completion-dev-10:C:0:rank-nonthinking","completion-dev-10:C:1:rank-nonthinking"]);
export const FAST24_REPAIR_AUTHORIZATION_POLICY = "docs/v7/step8-first-delivery-20261111.md";
export const FAST24_REPAIR_AUTHORIZATION = "user-approved-20261111-fast24-step8-first";
export const FAST24_REPAIR_AUTHORIZATION_RECORD = "artifacts/step8-first-20261111/root/user-implementation-authorization.safe.json";
export const FAST24_REPAIR_VALIDATION_PURPOSE = "repair_validation";
export const FAST24_FINAL_ACCEPTANCE_PURPOSE = "final_acceptance";
export const LOCAL_PREVIEW_AUTHORIZATION_POLICY = "docs/v7/local-preview-contract-20261112.md";
export const LOCAL_PREVIEW_AUTHORIZATION = "user-approved-20261112-local-preview";
export const LOCAL_PREVIEW_PURPOSE = "local_preview";
export const LOCAL_PREVIEW_ORIGIN = "http://127.0.0.1:3177";
export function isLocalPreviewBinding(value) {
  const keys = ["applicationRuntimeSourceSha256", "candidatePoolSha256", "nextBindingSha256", "origin", "productionBuildId", "schemaVersion", "workerArtifactSha256"];
  return Boolean(value && typeof value === "object" && Object.keys(value).sort().join(",") === keys.join(",") &&
    value.schemaVersion === "saitu.local-preview.binding.v1" && value.origin === LOCAL_PREVIEW_ORIGIN &&
    [value.applicationRuntimeSourceSha256, value.candidatePoolSha256, value.workerArtifactSha256, value.nextBindingSha256].every(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)) &&
    typeof value.productionBuildId === "string" && value.productionBuildId !== "development" && /^[A-Za-z0-9_-]{6,128}$/.test(value.productionBuildId));
}
const fast24BindingKeys = ["applicationRuntimeSourceSha256", "candidatePoolSha256", "productionBuildId", "schemaVersion", "selectionSha256"];
export function isFast24RepairValidationBinding(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).sort().join(",") === fast24BindingKeys.join(",") &&
    value.schemaVersion === "saitu.fast24.repair-validation.v1" &&
    [value.selectionSha256, value.applicationRuntimeSourceSha256, value.candidatePoolSha256].every(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)) &&
    typeof value.productionBuildId === "string" && value.productionBuildId !== "development" && /^[A-Za-z0-9_-]{6,128}$/.test(value.productionBuildId));
}
export const USER_UNBOUNDED_RUN_PREFIX = "saitu-v7-top5-unbounded-20261109";
export const USER_UNBOUNDED_EXECUTION_LIMITS = Object.freeze({modelConcurrencyLimit:null,totalCallLimit:null,totalCostLimitMicros:null});
export function readExecutionMode(environment) {
  const raw=environment===undefined?process.env.SAITU_AI_EXECUTION_MODE:environment.SAITU_AI_EXECUTION_MODE;
  if(raw===undefined||raw===""||raw==="finite")return "finite";
  if(raw===USER_UNBOUNDED_EXECUTION_MODE)return USER_UNBOUNDED_EXECUTION_MODE;
  throw new Error("invalid_ai_execution_mode");
}
export const isUserUnboundedExecutionMode = environment => readExecutionMode(environment)===USER_UNBOUNDED_EXECUTION_MODE;
