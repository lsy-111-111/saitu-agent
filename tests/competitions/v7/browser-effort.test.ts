import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EFFORT_GRANT_VERSION, TOP5_EFFORT_GRANT_VERSION, RANK_NON_THINKING_EFFORT_POLICY, effortPolicySha256, resolveEffortForOperation, type DecisionEffortPolicy } from "@/lib/ai/effort-policy.mjs";
import { USER_UNBOUNDED_GRANT_VERSION, USER_UNBOUNDED_EXECUTION_LIMITS, RANK_NONTHINKING_AUTHORIZATION_POLICY, RANK_NONTHINKING_TRIAL_SLOTS } from "@/lib/ai/execution-policy.mjs";
import { browserEffortRuntime, assertBrowserEffortEnvironment, assertBrowserEffortGrant, browserLedgerEffortMatches,
  browserCallEffortMatches, hasBrowserBoundProviderDispatch } from "../../e2e/v7-browser-effort.mjs";
import { validatePublicBrowserConfig } from "../../e2e/v7-public-browser.mjs";
// @ts-expect-error This existing production runner is a plain Node module.
import { validatePerformanceBrowserConfig } from "../../e2e/v7-performance-browser.mjs";
import { snapshotPilotAccountingLog, capturePilotAccountingTrace } from "../../e2e/v7-pilot-browser.mjs";
import { withRecommendationAccountingTrace, emitProductObservation } from "@/lib/ai/product-observation";
import { POLICY_VERSION, POLICY_SHA256, byteHash } from "../../../scripts/competitions/v7/evaluation-policy.mjs";

const H = "a".repeat(64), condition = "b".repeat(64);
const mixed = { version: "saitu.effort-policy.v1" as const, rank: "low" as const, explain: "high" as const, review: "low" as const };
function fixture(policy: DecisionEffortPolicy = mixed) {
  const spend = { grantVersion: EFFORT_GRANT_VERSION, authorizedEffort: "stage", effortPolicy: policy, effortPolicySha256: effortPolicySha256(policy),
    effortConditionSha256: condition, runId: "saitu-v7-effort-20261109-calibration-01", phase: "calibration", authorizationPolicySha256: H };
  const environment = { SAITU_V7_EFFORT_POLICY: JSON.stringify(policy), SAITU_V7_EFFORT_POLICY_SHA256: spend.effortPolicySha256,
    AI_SPEND_AUTHORIZED_EFFORT: "stage", AI_SPEND_EFFORT_CONDITION_SHA256: condition, AI_SPEND_RUN_ID: spend.runId, AI_SPEND_PHASE: spend.phase, AI_SPEND_POLICY_SHA256: H };
  const batch = { run_id: spend.runId, state: "active", grant_version: spend.grantVersion, authorized_effort: "stage", authorized_phase: spend.phase,
    effort_policy: policy, effort_policy_sha256: spend.effortPolicySha256, effort_condition_sha256: condition, policy_sha256: H, call_limit: 50, funding_limit_micros: "1000000" };
  const call = (operation = "competition_v7_rank") => ({ call_id: "synthetic-call", call_key: operation.replace("competition_v7_", "v7.") + ":synthetic:1", call_state: "completed",
    call_operation: operation, call_thinking: "enabled", call_reasoning_effort: resolveEffortForOperation(operation, policy), call_effort_policy_sha256: spend.effortPolicySha256,
    spend_run_id: spend.runId, phase: spend.phase, model: "deepseek-flash", operation, effort: resolveEffortForOperation(operation, policy), effort_policy_sha256: spend.effortPolicySha256,
    reservation_id: "synthetic-reservation", originalReceipt: { kind: "result", result: { ok: true, upstreamAttempted: true } } });
  return { spend, environment, batch, call };
}
function v2ContinuationFixture() {
  const f = fixture(RANK_NON_THINKING_EFFORT_POLICY);
  // This marker passes only synchronous shape checks. No proof file exists, so
  // an asynchronous live entrypoint cannot authorize this offline fixture.
  const spend = { ...f.spend, grantVersion: USER_UNBOUNDED_GRANT_VERSION, executionMode: "user-unbounded", executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS,
    phase: "formal", authorizedPhase: "formal", authorizationPolicySha256: byteHash(readFileSync(path.join(process.cwd(), RANK_NONTHINKING_AUTHORIZATION_POLICY))),
    approvedPolicyPath: "artifacts/compact-20261110/C/synthetic-budget/approved-policy.md", authorizationPolicySource: RANK_NONTHINKING_AUTHORIZATION_POLICY,
    pilotContinuation: { proofFile: "artifacts/compact-20261110/C/synthetic-no-existing-pilot-proof.json", proofSha256: H, sourceBindingsSha256: H, pilotExecutionSha256: H, pilotPlanSha256: H,
      slotIds: [...RANK_NONTHINKING_TRIAL_SLOTS], effortPolicySha256: f.spend.effortPolicySha256, detailLayout: "single", complete: 3 } };
  const call = (operation = "competition_v7_rank") => {
    const value = { ...f.call(operation), phase: spend.phase, call_thinking: operation === "competition_v7_rank" ? "disabled" : "enabled" };
    return { ...value, originalReceipt: { kind: "receipt", receipt: { model: value.model, operation, thinking: value.call_thinking,
      effortPolicySha256: value.call_effort_policy_sha256,
      ...(operation === "competition_v7_rank" ? { policyReasoningEffort: "low", wireReasoningEffort: null, temperature: 0, topP: 1 } : { reasoningEffort: value.call_reasoning_effort }),
      httpStatus: 200, durationMs: 1, attempts: 1, finishReason: "stop", content: "synthetic-offline-response" } } };
  };
  return { spend, call };
}

describe("actual browser staged effort authority", () => {
  it("checks exact operation effort for all eight frozen maps, including fixed-high chat and extraction", () => {
    for (const rank of ["high", "low"] as const) for (const explain of ["high", "low"] as const) for (const review of ["high", "low"] as const) {
      const f = fixture({ version: mixed.version, rank, explain, review });
      expect(assertBrowserEffortGrant(f.batch, f.spend, f.environment).effortPolicy).toEqual(f.spend.effortPolicy);
      for (const operation of ["competition_v7_rank", "competition_v7_explain", "competition_v7_review", "competition_v7_chat", "competition_v7_extract", "competition_v7_chat_review"]) {
        const call = f.call(operation); expect(browserCallEffortMatches(call, f.spend)).toBe(true);
        expect(browserCallEffortMatches({ ...call, effort: call.effort === "high" ? "low" : "high" }, f.spend)).toBe(false);
      }
    }
  });

  it("refuses legacy execution grants and every mismatched actual grant or environment field", () => {
    const f = fixture();
    expect(() => browserEffortRuntime({ ...f.spend, grantVersion: "saitu.v7", authorizedEffort: "high" })).toThrow();
    for (const patch of [{ authorized_effort: "high" }, { grant_version: "saitu.v7" }, { authorized_phase: "formal" }, { run_id: "foreign-run" },
      { effort_policy_sha256: H }, { effort_condition_sha256: H }, { effort_policy: { ...mixed, rank: "high" } }, { policy_sha256: condition }, { funding_limit_micros: "0" }]) {
      expect(() => assertBrowserEffortGrant({ ...f.batch, ...patch }, f.spend, f.environment)).toThrow();
    }
    for (const patch of [{ AI_SPEND_AUTHORIZED_EFFORT: "high" }, { AI_SPEND_PHASE: "formal" }, { SAITU_V7_EFFORT_POLICY_SHA256: H },
      { AI_SPEND_EFFORT_CONDITION_SHA256: H }, { SAITU_V7_EFFORT_POLICY: JSON.stringify({ ...mixed, rank: "high" }) }]) {
      expect(() => assertBrowserEffortEnvironment(f.spend, { ...f.environment, ...patch })).toThrow();
    }
  });

  it("rejects identical low rank/review relabeling, call-ledger disagreement, wrong phase and missing request fields", () => {
    const f = fixture(), good = f.call(); expect(browserCallEffortMatches(good, f.spend)).toBe(true);
    for (const patch of [{ operation: "competition_v7_review", call_operation: "competition_v7_review" }, { call_operation: "competition_v7_review" },
      { call_reasoning_effort: "high" }, { call_thinking: "disabled" }, { call_effort_policy_sha256: H }, { phase: "formal" }, { call_operation: undefined }]) {
      expect(browserCallEffortMatches({ ...good, ...patch }, f.spend)).toBe(false);
    }
    expect(browserLedgerEffortMatches({ run_id: f.spend.runId, phase: f.spend.phase, model: "deepseek-flash", operation: good.operation, effort: good.effort, effort_policy_sha256: good.effort_policy_sha256 }, f.spend)).toBe(true);
    expect(browserLedgerEffortMatches({ run_id: f.spend.runId, phase: f.spend.phase, model: "deepseek-flash", operation: good.operation, effort: "high", effort_policy_sha256: good.effort_policy_sha256 }, f.spend)).toBe(false);
  });

  it("does not let one valid receipt conceal a wrong-stage or foreign unknown paid call", () => {
    const f = fixture(), good = f.call();
    expect(hasBrowserBoundProviderDispatch([good], f.spend)).toBe(true);
    const unknown = { ...f.call(), call_id: "unknown-call", call_state: "unknown", originalReceipt: null };
    expect(hasBrowserBoundProviderDispatch([good, unknown], f.spend)).toBe(true);
    for (const patch of [{ effort: "high" }, { phase: "formal" }, { call_effort_policy_sha256: H }, { operation: "competition_v7_review", call_operation: "competition_v7_review" }]) {
      expect(hasBrowserBoundProviderDispatch([good, { ...unknown, ...patch }], f.spend)).toBe(false);
    }
    const unpaid = { call_state: "completed", originalReceipt: { kind: "result", result: { upstreamAttempted: false } }, reservation_id: null };
    expect(hasBrowserBoundProviderDispatch([good, unpaid], f.spend)).toBe(true);
    expect(hasBrowserBoundProviderDispatch([unpaid], f.spend)).toBe(false);
  });

  it("requires the explicit new-document continuation marker and never enables v2 from its version alone", () => {
    const f = v2ContinuationFixture();
    expect(browserEffortRuntime(f.spend).effortPolicy).toEqual(RANK_NON_THINKING_EFFORT_POLICY);
    for (const patch of [{ pilotContinuation: undefined }, { authorizationPolicySource: "docs/v7/compact-output-contract-20261110.md" },
      { phase: "calibration" }, { pilotContinuation: { ...f.spend.pilotContinuation, complete: 2 } },
      { pilotContinuation: { ...f.spend.pilotContinuation, effortPolicySha256: H } }]) {
      expect(() => browserEffortRuntime({ ...f.spend, ...patch })).toThrow("rank_nonthinking_verified_continuation_required");
    }
    expect(() => browserEffortRuntime({ ...f.spend, executionMode: "finite", grantVersion: EFFORT_GRANT_VERSION })).toThrow("browser_rank_nonthinking_requires_unbounded_grant");
  });

  it("verifies the actual disabled rank receipt while retaining low only as the policy and ledger effort", () => {
    const f = v2ContinuationFixture(), call = f.call();
    expect(call.call_reasoning_effort).toBe("low");
    expect(call.originalReceipt.receipt).not.toHaveProperty("reasoningEffort");
    expect(browserCallEffortMatches(call, f.spend)).toBe(true);
    expect(hasBrowserBoundProviderDispatch([call], f.spend)).toBe(true);
    for (const patch of [{ reasoningEffort: "low" }, { wireReasoningEffort: "low" }, { wireReasoningEffort: undefined },
      { policyReasoningEffort: "high" }, { temperature: 0.1 }, { topP: 0.95 }, { thinking: "enabled" },
      { operation: "competition_v7_review" }, { effortPolicySha256: H }]) {
      expect(browserCallEffortMatches({ ...call, originalReceipt: { kind: "receipt", receipt: { ...call.originalReceipt.receipt, ...patch } } }, f.spend)).toBe(false);
    }
    expect(browserCallEffortMatches({ ...call, call_thinking: "enabled" }, f.spend)).toBe(false);
    expect(browserCallEffortMatches({ ...call, originalReceipt: { kind: "result", result: { ok: true, upstreamAttempted: true } } }, f.spend)).toBe(false);
  });

  it("retains unresolved v2 holds without inventing an observed wire response or concealing a wrong mode", () => {
    const f = v2ContinuationFixture(), call = f.call();
    const unknown = { ...call, call_id: "synthetic-v2-unknown", call_state: "unknown", reservation_id: "synthetic-v2-hold", originalReceipt: null };
    expect(browserCallEffortMatches(unknown, f.spend)).toBe(true);
    expect(hasBrowserBoundProviderDispatch([unknown], f.spend)).toBe(false);
    expect(hasBrowserBoundProviderDispatch([call, unknown], f.spend)).toBe(true);
    expect(hasBrowserBoundProviderDispatch([call, { ...unknown, call_thinking: "enabled" }], f.spend)).toBe(false);
    expect(browserCallEffortMatches({ ...call, originalReceipt: { kind: "result", result: { ok: false, upstreamAttempted: true, reason: "timeout" } } }, f.spend)).toBe(true);
  });

  it("keeps v2 explanation and review enabled low and profile/chat enabled high", () => {
    const f = v2ContinuationFixture();
    for (const operation of ["competition_v7_explain", "competition_v7_review", "competition_v7_chat", "competition_v7_extract", "competition_v7_chat_review"]) {
      const call = f.call(operation);
      expect(browserCallEffortMatches(call, f.spend)).toBe(true);
      expect(call.call_thinking).toBe("enabled");
      expect(call.call_reasoning_effort).toBe(["competition_v7_explain", "competition_v7_review"].includes(operation) ? "low" : "high");
    }
  });

  it("actual public/performance config entrypoints require the new explicit map and grant", () => {
    const f = fixture({ version: mixed.version, rank: "low", explain: "low", review: "low" }), pins = Object.fromEntries(["implementationSha256", "runtimeSourceBindingSha256", "runtimeConfigurationSha256", "executionRuntimeConfigurationSha256", "catalogSha256", "candidatePoolSha256", "harnessSha256", "planSha256"].map(k => [k, H]));
    const common = { ...pins, authorContextId: "synthetic-author", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
      baseUrl: "http://127.0.0.1:3166/", workerHealthFile: "/synthetic-only/worker.json", spend: { ...f.spend, grantVersion: TOP5_EFFORT_GRANT_VERSION, maxCalls: 50, maxReservedMicros: 1000000, approvedPolicyPath: "artifacts/continuation-v7-top5-20261109/budget/synthetic/approved-policy.md" } };
    expect(() => validatePublicBrowserConfig({ ...common, schemaVersion: "saitu.public-browser-config.v7.1" })).not.toThrow();
    expect(() => validatePublicBrowserConfig({ ...common, schemaVersion: "saitu.public-browser-config.v7.1", spend: { ...common.spend, authorizedEffort: "high" } })).toThrow();
    expect(() => validatePublicBrowserConfig({ ...common, schemaVersion: "saitu.public-browser-config.v7.1", spend: { ...common.spend, grantVersion: EFFORT_GRANT_VERSION } })).toThrow("top5_browser_execution_grant_required");
    const performance = { ...common, schemaVersion: "saitu.performance-browser-config.v7.1", spend: { ...common.spend, phase: "performance", maxCalls: 500 }, publicEntrance: {
      admission: { path: "artifacts/continuation-v7-top5-20261109/synthetic/admission.json", sha256: H }, review: { path: "artifacts/continuation-v7-top5-20261109/synthetic/review.json", sha256: H } } };
    expect(() => validatePerformanceBrowserConfig(performance)).not.toThrow();
    expect(() => validatePerformanceBrowserConfig({ ...performance, spend: { ...performance.spend, effortPolicySha256: H } })).toThrow();
  });

  it("captures the actual root accounting emitter stage fields while rejecting unrelated trace data", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "saitu-browser-stage-trace-")), filename = path.join(directory, "synthetic.jsonl");
    await writeFile(filename, ""); const log = { path: filename, sourceSha256: H }, info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const before = await snapshotPilotAccountingLog(log);
      withRecommendationAccountingTrace("synthetic-http", () => {
        emitProductObservation("ai_budget_reserved", { reservationId: "synthetic-reservation", phase: "calibration", model: "deepseek-flash", effort: "high", operation: "competition_normalize", effortPolicySha256: H, reservedMicros: 1, priceVersion: "synthetic" });
        emitProductObservation("ai_transport_dispatch", { reservationId: "synthetic-reservation", model: "deepseek-flash", attempt: 1, operation: "competition_normalize", thinkingType: "enabled", reasoningEffort: "high", effortPolicySha256: H });
        emitProductObservation("ai_budget_settled", { reservationId: "synthetic-reservation", chargedMicros: 1, upstreamAttempted: true, state: "usage_estimated", priceVersion: "synthetic", operation: "competition_normalize", effort: "high", effortPolicySha256: H });
      });
      const lines = info.mock.calls.map(([line]) => String(line)); await writeFile(filename, lines.join("\n") + "\n");
      const captured = await capturePilotAccountingTrace(log, before, [{ requestId: "synthetic-http" }]);
      expect(captured).toMatchObject({ complete: true, issues: [] }); expect(captured.events).toHaveLength(3);
      const bad = JSON.parse(lines[1]); bad.details.unrelatedRawPrompt = "synthetic-never-copied";
      await writeFile(filename, [lines[0], JSON.stringify(bad), lines[2]].join("\n") + "\n");
      const rejected = await capturePilotAccountingTrace(log, before, [{ requestId: "synthetic-http" }]);
      expect(rejected.complete).toBe(false); expect(JSON.stringify(rejected.events)).not.toContain("synthetic-never-copied");
    } finally { info.mockRestore(); await rm(directory, { recursive: true, force: true }); }
  });
});
