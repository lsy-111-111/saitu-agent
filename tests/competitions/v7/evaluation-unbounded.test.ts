import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { USER_UNBOUNDED_EXECUTION_MODE as MODE, USER_UNBOUNDED_GRANT_VERSION as GRANT, USER_UNBOUNDED_EXECUTION_LIMITS as LIMITS } from "../../../src/lib/ai/execution-policy.mjs";
import { ADAPTIVE_EXECUTION_POLICY } from "../../../scripts/lib/adaptive-execution.mjs";
import { EVALUATION_POLICY, POLICY_VERSION, POLICY_SHA256, canonicalHash } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { validateRegistrationConfig, verifyPublicBatchOriginals } from "../../../scripts/competitions/v7/evaluation-registration.mjs";
import { runtimeBehaviorConfiguration, validateExecutionScope } from "../../../scripts/competitions/v7/evaluation-runtime.mjs";
import { planEvaluationMatrix } from "../../../scripts/competitions/v7/evaluation-matrix.mjs";

const H = canonicalHash("synthetic_no_provider_or_private_input");
const { runtimeConfiguration } = createRequire(import.meta.url)("../../../scripts/competitions/v6/runtime-configuration.mjs") as {
  runtimeConfiguration: (environment: Record<string, string>) => { schemaVersion: string; values: Record<string, string | null> };
};
function config(): any { return { schemaVersion: "saitu.ranking-registration-config.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
  purpose: "ai_proxy_acceptance", algorithms: ["B", "C"], profileCount: 120, repeats: 5, rankingReports: 1200, reuseAlgorithm: "C", candidatePolicy: "full_core_reviewed",
  seed: 1, reviewSampleSeed: 1, runtime: EVALUATION_POLICY.runtime, rankingProtocol: EVALUATION_POLICY.ranking, reviewProtocol: EVALUATION_POLICY.review,
  ...Object.fromEntries(["inputSha256", "productInputSha256", "profileSliceProtocolSha256", "challengeManifestSha256", "sourceSnapshotSha256", "rankingSourceSnapshotSha256", "catalogSha256", "candidatePoolSha256", "runtimeSourceBindingSha256", "implementationSha256", "runtimeConfigurationSha256", "migrationSha256", "publicDevelopmentManifestSha256"].map(key => [key, H])),
  executionPhase: "formal", executionMode: MODE, executionLimits: LIMITS, schedulingPolicy: ADAPTIVE_EXECUTION_POLICY, invocationConcurrency: "adaptive",
  batchPolicy: { order: "profile_then_repeat_then_arm", runsPerBatch: null, maxCReservationMicros: null, maxHttpPerCInvocation: null },
  productBatchPolicy: { runsPerBatch: null, maxHttpPerInvocation: null, maxReservationMicros: null },
  publicAdmission: { path: "admission.json", sha256: H }, migration: { path: "migration.json", sha256: H }, challengeManifest: { path: "challenge.json", sha256: H } }; }
describe("v7 explicit user-unbounded evaluation consumers", () => {
  it("requires explicit null caps, frozen adaptive scheduling and unchanged full experiment denominators", () => {
    expect(validateRegistrationConfig(config())).toMatchObject({ profileCount: 120, repeats: 5, rankingReports: 1200 });
    for (const mutate of [(c: any) => c.invocationConcurrency = 999, (c: any) => c.batchPolicy.maxHttpPerCInvocation = 1000,
      (c: any) => c.productBatchPolicy.maxReservationMicros = Number.MAX_SAFE_INTEGER, (c: any) => c.executionLimits.totalCostLimitMicros = 100000000,
      (c: any) => c.executionMode = "finite"]) {
      const changed = structuredClone(config()); mutate(changed); expect(() => validateRegistrationConfig(changed)).toThrow();
    }
  });
  it("binds the new grant and real physical funding while rejecting a finite grant under the new mode", () => {
    const scope = { executionMode: MODE, executionLimits: LIMITS, grantVersion: GRANT, effortPolicy: EVALUATION_POLICY.runtime.effortPolicy,
      effortPolicySha256: EVALUATION_POLICY.runtime.effortPolicySha256, authorizedEffort: "stage", runId: "saitu-v7-top5-unbounded-20261109-formal-01",
      phase: "formal", authorizedPhase: "formal", authorizationPolicySha256: H, environmentAuthorizationPolicySha256: H, evaluationPolicySha256: POLICY_SHA256,
      authorizationPolicySnapshot: { path: "approved-policy.md", sha256: H }, executionRuntimeConfigurationSha256: H,
      callLimit: null, hardLimitMicros: null, fundingLimitCny: 182.04086 };
    expect(validateExecutionScope(scope, { allowedPhases: ["formal"] })).toBe(scope);
    for (const changed of [{ ...scope, grantVersion: "saitu.v7.top5.v1" }, { ...scope, callLimit: 1000 }, { ...scope, fundingLimitCny: -1 }])
      expect(() => validateExecutionScope(changed, { allowedPhases: ["formal"] })).toThrow();
  });
  it("hashes execution mode and ignores former numeric artificial limits only for the new mode", () => {
    const environment = { SAITU_AI_EXECUTION_MODE: MODE, AI_PROVIDER: "deepseek", AI_CALIBRATION_CALL_LIMIT: "99999", AI_SPEND_LIMIT_CNY: "0.01", AI_SPEND_FUNDED_CNY: "0.01", SAITU_V7_WORKER_CONCURRENCY: "99999", AI_CONCURRENCY_MAX: "1", AI_MODEL_CALLS_PER_DAY: "1" };
    const runtime = runtimeConfiguration(environment); expect(runtime).toMatchObject({ executionMode: MODE, executionLimits: LIMITS });
    expect(runtime.values).toMatchObject({ AI_CALIBRATION_CALL_LIMIT: null, AI_SPEND_LIMIT_CNY: null, AI_SPEND_FUNDED_CNY: null });
    const behavior = runtimeBehaviorConfiguration(environment); expect(behavior.workerConcurrency).toBe("adaptive");
    expect(behavior.governor).toMatchObject({ transportConcurrencyHardMax: null, transportConcurrencyEffectiveMax: null, queueMax: null, dailyBudget: null });
    expect(runtimeConfiguration({}).schemaVersion).toBe("saitu.runtime-configuration.v1");
    expect(() => runtimeConfiguration({ AI_CALIBRATION_CALL_LIMIT: "101" })).toThrow();
  });
  it("separates physical usage projection and cumulative hypothetical reserves from authorization limits", () => {
    const result = planEvaluationMatrix({ schemaVersion: "saitu.evaluation-cost-input.v7.1", executionMode: MODE, balanceCny: 208.7,
      unknownHeldCny: 26.65914, cumulativeChargedOrHeldCny: 500, fundedLimitCny: null, totalCapCny: null, estimates: {} });
    expect(result.remainingCny).toBeCloseTo(182.04086); expect(result.finiteBatchCeiling).toBeNull();
    expect(result).toMatchObject({ rankingReports: 1200, rankingCRecommendationRuns: 600, otherSealedCases: 680, cReportsReusedIn800: 600, projectionNotAuthorizationCap: true, aggregateReserveIsNotInstantaneousHold: true });
  });
  it("recomputes unique raw reservation ownership and rejects copied rows or a forged batch summary", () => {
    const scope = { runId: "synthetic", phase: "calibration" }, row = { id: "r1", run_id: scope.runId, phase: scope.phase, model: "deepseek-flash",
      operation: "competition_v7_rank", effort: "low", effort_policy_sha256: EVALUATION_POLICY.runtime.effortPolicySha256, state: "reserved", reserved_micros: "20", charged_micros: null };
    const trace = { complete: true, issues: [], inodeBefore: 1, inodeAfter: 1, deviceBefore: 1, deviceAfter: 1, prefixSha256Before: H, prefixSha256After: H, segmentSha256: H, events: [] };
    const original = { run: { caseId: "case1", ownedLedgerIds: [row.id] }, receipt: { calls: [{ call_id: "c1", reservation_id: row.id }], ledgerRows: [row], accountingTrace: trace } };
    const batch = { executionMode: MODE, spendRunId: scope.runId, valid: true, actualLedgerRows: [row], ownership: [{ reservationId: row.id, caseId: "case1" }] };
    expect(verifyPublicBatchOriginals(batch, [original], scope, EVALUATION_POLICY.runtime).verified).toBe(true);
    expect(verifyPublicBatchOriginals({ ...batch, actualLedgerRows: [{ ...row, state: "conservative", charged_micros: "20" }] }, [original], scope, EVALUATION_POLICY.runtime).verified).toBe(true);
    expect(() => verifyPublicBatchOriginals(batch, [original, original], scope, EVALUATION_POLICY.runtime)).toThrow();
    expect(() => verifyPublicBatchOriginals({ ...batch, actualLedgerRows: [row, { ...row, id: "hidden" }] }, [original], scope, EVALUATION_POLICY.runtime)).toThrow();
    expect(() => verifyPublicBatchOriginals({ ...batch, ownership: [{ reservationId: row.id, caseId: "foreign" }] }, [original], scope, EVALUATION_POLICY.runtime)).toThrow();
  });
});
