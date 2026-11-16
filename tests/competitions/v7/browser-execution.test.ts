import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, appendFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { USER_UNBOUNDED_EXECUTION_MODE, USER_UNBOUNDED_GRANT_VERSION, USER_UNBOUNDED_EXECUTION_LIMITS } from "@/lib/ai/execution-policy.mjs";
import { effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import { assertBrowserExecutionLimits, assertBrowserEffortEnvironment, assertBrowserEffortGrant, assertBrowserLiveExecutionMode, assertBrowserDatabaseLimits, assertBrowserWorkerExecutionMode } from "../../e2e/v7-browser-effort.mjs";
// @ts-expect-error Native browser orchestration is a plain Node module.
import { installBrowserExecutionAuthorization } from "../../e2e/v7-browser-execution.mjs";
// @ts-expect-error Native browser orchestration is a plain Node module.
import { BROWSER_SCHEDULING_POLICY, browserResourceCapacity, runAdaptiveBrowserCases } from "../../e2e/v7-browser-scheduling.mjs";
// @ts-expect-error Native original capture is a plain Node module.
import { classifyBrowserOriginalScheduling, createBrowserOriginalCapture } from "../../e2e/v7-browser-originals.mjs";
import { selectPilotOwnedLedgerRows, pilotBatchLedgerClosure } from "../../e2e/v7-pilot-browser.mjs";
import { validatePublicBrowserConfig } from "../../e2e/v7-public-browser.mjs";
// @ts-expect-error Native browser orchestration is a plain Node module.
import { validatePerformanceBrowserConfig } from "../../e2e/v7-performance-browser.mjs";
import { POLICY_VERSION, POLICY_SHA256 } from "../../../scripts/competitions/v7/evaluation-policy.mjs";

const H = "a".repeat(64), policy = { version: "saitu.effort-policy.v1" as const, rank: "low" as const, explain: "low" as const, review: "low" as const };
function scope() {
  const spend = { grantVersion: USER_UNBOUNDED_GRANT_VERSION, executionMode: USER_UNBOUNDED_EXECUTION_MODE, executionLimits: { ...USER_UNBOUNDED_EXECUTION_LIMITS },
    runId: "saitu-v7-top5-unbounded-20261109-calibration-01", phase: "calibration", authorizedPhase: "calibration", authorizedEffort: "stage", effortPolicy: policy,
    effortPolicySha256: effortPolicySha256(policy), effortConditionSha256: H, authorizationPolicySha256: H, maxCalls: null, maxReservedMicros: null, fundingLimitMicros: 1000000 };
  const environment = { SAITU_AI_EXECUTION_MODE: USER_UNBOUNDED_EXECUTION_MODE, AI_SPEND_RUN_ID: spend.runId, AI_SPEND_PHASE: spend.phase,
    AI_SPEND_AUTHORIZED_EFFORT: "stage", AI_SPEND_POLICY_SHA256: H, AI_SPEND_EFFORT_CONDITION_SHA256: H, SAITU_V7_EFFORT_POLICY: JSON.stringify(policy), SAITU_V7_EFFORT_POLICY_SHA256: spend.effortPolicySha256 };
  const batch = { state: "active", run_id: spend.runId, grant_version: spend.grantVersion, execution_mode: spend.executionMode, authorized_phase: spend.phase,
    authorized_effort: "stage", policy_sha256: H, effort_condition_sha256: H, effort_policy_sha256: spend.effortPolicySha256, effort_policy: policy, call_limit: null, funding_limit_micros: "1000000" };
  return { spend, environment, batch, budget: { execution_mode: USER_UNBOUNDED_EXECUTION_MODE, hard_limit_micros: null } };
}
afterEach(() => vi.unstubAllEnvs());

describe("explicit user-unbounded browser execution", () => {
  it("requires the mode, grant, environment and three null limits together without a numeric substitute", () => {
    const f = scope();
    expect(assertBrowserExecutionLimits(f.spend)).toBe(true);
    expect(() => assertBrowserEffortEnvironment(f.spend, f.environment)).not.toThrow();
    expect(() => assertBrowserEffortGrant(f.batch, f.spend, f.environment)).not.toThrow();
    expect(() => assertBrowserLiveExecutionMode(f.spend, f.environment)).not.toThrow();
    for (const patch of [{ maxCalls: 20 }, { maxCalls: Number.MAX_SAFE_INTEGER }, { hardLimitMicros: 3000000 }, { executionLimits: { ...USER_UNBOUNDED_EXECUTION_LIMITS, modelConcurrencyLimit: 2 } }, { grantVersion: "saitu.v7.top5.v1" }])
      expect(() => assertBrowserExecutionLimits({ ...f.spend, ...patch })).toThrow();
    expect(() => assertBrowserLiveExecutionMode(f.spend, {})).toThrow();
  });
  it("checks nullable database authority and worker drain mode while retaining real physical funding", () => {
    const f = scope();
    expect(() => assertBrowserDatabaseLimits(f.batch, f.budget, f.spend)).not.toThrow();
    expect(() => assertBrowserDatabaseLimits(f.batch, { ...f.budget, hard_limit_micros: 3000000 }, f.spend)).toThrow();
    expect(() => assertBrowserDatabaseLimits({ ...f.batch, call_limit: 20 }, f.budget, f.spend)).toThrow();
    expect(() => assertBrowserWorkerExecutionMode({ executionMode: "user-unbounded", concurrency: null }, f.spend)).not.toThrow();
    expect(() => assertBrowserWorkerExecutionMode({ executionMode: "user-unbounded", concurrency: 2 }, f.spend)).toThrow();
  });
  it("accepts new public and performance configuration without finite call/cost caps", () => {
    const f = scope(), pins = Object.fromEntries(["implementationSha256", "runtimeSourceBindingSha256", "runtimeConfigurationSha256", "executionRuntimeConfigurationSha256", "catalogSha256", "candidatePoolSha256", "harnessSha256", "planSha256"].map(key => [key, H]));
    const common = { ...pins, policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, authorContextId: "synthetic-root", invocationConcurrency: "adaptive", browserSchedulingPolicy: BROWSER_SCHEDULING_POLICY,
      serverAccountingLog: { path: "/synthetic/web.log", format: "competition_accounting_trace.jsonl", sourceSha256: H }, baseUrl: "http://127.0.0.1:3173/", workerHealthFile: "/synthetic/health.json", spend: { ...f.spend, approvedPolicyPath: "artifacts/continuation-v7-top5-20261109/budget/synthetic/approved-policy.md" } };
    expect(() => validatePublicBrowserConfig({ ...common, schemaVersion: "saitu.public-browser-config.v7.1" })).not.toThrow();
    expect(() => validatePerformanceBrowserConfig({ ...common, schemaVersion: "saitu.performance-browser-config.v7.1", spend: { ...common.spend, phase: "performance" }, publicEntrance: {
      admission: { path: "artifacts/continuation-v7-top5-20261109/synthetic/admission.json", sha256: H }, review: { path: "artifacts/continuation-v7-top5-20261109/synthetic/review.json", sha256: H } } })).not.toThrow();
  });
  it("refreshes authorization for each local request, strips it on other origins and never returns a token", async () => {
    vi.stubEnv("SAITU_AI_EXECUTION_MODE", "user-unbounded");
    let handler: any, issued = 0;
    const context = { route: vi.fn(async (_pattern: string, callback: any) => { handler = callback; }) };
    const meta = await installBrowserExecutionAuthorization(context, scope().spend, "http://127.0.0.1:3173/", () => `synthetic-capability-${++issued}`);
    const send = async (url: string) => { const fallback = vi.fn(); await handler({ request: () => ({ url: () => url, headers: () => ({ "x-saitu-validation-execution": "stale" }) }), fallback }); return fallback.mock.calls[0][0].headers; };
    expect((await send("http://127.0.0.1:3173/api/ai/example"))["X-Saitu-Validation-Execution"]).toBe("synthetic-capability-1");
    expect((await send("http://127.0.0.1:3173/api/ai/example"))["X-Saitu-Validation-Execution"]).toBe("synthetic-capability-2");
    expect(await send("https://external.example/api/example")).toEqual({});
    expect(issued).toBe(2); expect(JSON.stringify(meta)).not.toContain("synthetic-capability");
  });
});

describe("parallel browser original attribution and resource scheduling", () => {
  it("captures an unanswered pre-run HTTP original by exact trace identity while excluding another in-flight request", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "browser-original-attribution-")), log = path.join(dir, "trace.jsonl");
    await writeFile(log, "");
    try {
      let routeHandler: any, sentHeaders: any;
      const context = { route: async (_pattern: string, callback: any) => { routeHandler = callback; }, on: vi.fn() };
      const spend = scope().spend;
      const capture = await createBrowserOriginalCapture(context, { spend, baseUrl: "http://127.0.0.1:3173/", serverAccountingLog: { path: log, sourceSha256: H } });
      const request = { url: () => "http://127.0.0.1:3173/api/competitions/recommend/normalize", method: () => "POST", postData: () => "{}", headers: () => ({}) };
      await routeHandler({ request: () => request, fallback: async ({ headers }: any) => { sentHeaders = headers; } });
      const event = (requestId: string, reservationId: string) => ({ event: "competition_accounting_trace", requestId, time: new Date().toISOString(), type: "ai_budget_reserved", details: { reservationId, phase: spend.phase, model: "deepseek-flash", operation: "competition_normalize", effort: "high", effortPolicySha256: spend.effortPolicySha256, reservedMicros: 100, priceVersion: "synthetic" } });
      await appendFile(log, [event("other-in-flight-HTTP", "foreign-reservation"), event(sentHeaders["x-request-id"], "own-reservation")].map(value => JSON.stringify(value)).join("\n") + "\n");
      const row = { id: "own-reservation", run_id: spend.runId, phase: spend.phase, model: "deepseek-flash", operation: "competition_normalize", effort: "high", effort_policy_sha256: spend.effortPolicySha256, reserved_micros: "100", charged_micros: null, state: "reserved" };
      const query = vi.fn(async (_sql: string, args: any[]) => { expect(args).toEqual([spend.runId, ["own-reservation"]]); return { rows: [{ raw: row }] }; });
      const receipt = await capture.collect({ query }, { calls: [], realProviderDispatch: false });
      expect(receipt.ledgerRows).toEqual([row]); expect(receipt.ledgerOwnership.issues).toEqual([]);
      expect(receipt.accountingTrace.events).toHaveLength(1);
      expect(receipt.schedulingFeedback).toBeNull(); // Reservation alone does not prove a provider dispatch.
      expect(receipt.httpOriginals).toHaveLength(1); expect(JSON.stringify(receipt.httpOriginals)).not.toContain("Validation-Execution");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("assigns only exact HTTP and run-call reservations to each overlapping journey", () => {
    const rows = ["a-http", "a-rank", "b-http", "b-rank"].map(id => ({ id }));
    const a = selectPilotOwnedLedgerRows(rows, [{ reservation_id: "a-rank" }], { events: [{ requestId: "request-a", details: { reservationId: "a-http" } }] }, [{ requestId: "request-a" }]);
    expect(a.rows.map((row: any) => row.id)).toEqual(["a-http", "a-rank"]); expect(a.issues).toEqual([]); expect(a.excludedOtherLedgerRows).toBe(2);
    const bad = selectPilotOwnedLedgerRows(rows, [], { events: [{ requestId: "request-b", details: { reservationId: "b-http" } }] }, [{ requestId: "request-a" }]);
    expect(bad.rows).toEqual([]); expect(bad.issues).toContain("accounting_trace_contains_foreign_HTTP_identity");
  });
  it("requires one whole-batch original owner per reservation and rejects orphans or unsettled rows", () => {
    const rows = ["a", "b"].map(id => ({ id, state: "usage_estimated", charged_micros: "1" }));
    const observations = rows.map((row, index) => ({ caseId: `case-${index}`, receipts: { ledgerRows: [row] } }));
    expect(pilotBatchLedgerClosure(rows, observations).valid).toBe(true);
    expect(pilotBatchLedgerClosure(rows, [...observations, observations[0]]).valid).toBe(false);
    expect(pilotBatchLedgerClosure(rows, observations.slice(0, 1)).unmatchedLedgerIds).toEqual(["b"]);
    expect(pilotBatchLedgerClosure([{ ...rows[0], state: "reserved", charged_micros: null }], observations.slice(0, 1)).valid).toBe(false);
    expect(pilotBatchLedgerClosure([{ ...rows[0], state: "reserved", charged_micros: null, reserved_micros: "100" }], observations.slice(0, 1))).toMatchObject({ valid: true, unsettledLedgerIds: ["a"], unknownHoldsRemainFinanciallyReserved: true });
  });
  const sampler = () => ({ sample: () => ({ initialConcurrency: 1, capacity: 8, physicalCapacity: 8, pressure: false, actualSyntheticHostFixture: true }), observeBrowser: async () => ({}), close: vi.fn() });
  it("can grow past two using resource capacity without retrying or selecting only successful samples", async () => {
    expect(browserResourceCapacity({ availableParallelism: 8, freeMemoryBytes: 8 * 1024 ** 3, totalMemoryBytes: 16 * 1024 ** 3 })).toBe(8);
    let active = 0, peak = 0;
    const started: string[] = [], cases = Array.from({ length: 12 }, (_, i) => ({ caseId: `case-${i}`, viewport: i % 2 ? "mobile" : "desktop" }));
    const queue = await runAdaptiveBrowserCases(cases, { sampler: sampler(), runCase: async (entry: any) => {
      active++; peak = Math.max(peak, active); started.push(entry.caseId); await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return { caseId: entry.caseId, success: false, timing: null }; // Quality never controls admission.
    } });
    expect(peak).toBeGreaterThan(2); expect(new Set(started).size).toBe(12); expect(queue.outcomes).toHaveLength(12); expect(started).toHaveLength(12);
    expect(queue.schedulingEvents.some((event: any) => event.type === "slot_started" && event.inFlightAtStart > 2)).toBe(true);
  });
  it("continues independent samples after an attributed unknown without retrying that original", async () => {
    const spend = scope().spend, started: string[] = [], cases = Array.from({ length: 6 }, (_, i) => ({ caseId: `case-${i}`, viewport: "desktop" }));
    const receipt = { calls: [{ call_state: "unknown", reservation_id: "reservation-a", originalReceipt: null }], ledgerRows: [{ id: "reservation-a", state: "conservative", run_id: spend.runId, phase: spend.phase, model: "deepseek-flash", operation: "competition_v7_rank", effort: "low", effort_policy_sha256: spend.effortPolicySha256 }], ledgerOwnership: { issues: [] } };
    const feedback = classifyBrowserOriginalScheduling(receipt, spend);
    expect(feedback).toMatchObject({ backpressure: true }); expect(feedback.stop).not.toBe(true);
    const queue = await runAdaptiveBrowserCases(cases, { sampler: sampler(), runCase: async (entry: any) => { started.push(entry.caseId); return { caseId: entry.caseId, success: false, providerBackpressure: feedback }; } });
    expect(started).toHaveLength(6); expect(new Set(started).size).toBe(6); expect(queue.outcomes).toHaveLength(6);
    expect(classifyBrowserOriginalScheduling({ ...receipt, ledgerRows: [] }, spend)).toMatchObject({ stop: true });
    expect(classifyBrowserOriginalScheduling({ calls: [{ call_state: "completed", originalReceipt: { kind: "result", result: { reason: "spend_budget_exhausted", upstreamAttempted: false } } }], ledgerRows: [] }, spend)).toMatchObject({ stop: true, reason: "actual_ledger_or_physical_funding_unavailable" });
    expect(classifyBrowserOriginalScheduling({ calls: [], ledgerRows: [], httpOriginals: [{ responseBodyBase64: Buffer.from(JSON.stringify({ fallbackReason: "spend_budget_exhausted" })).toString("base64") }] }, spend)).toMatchObject({ stop: true, reason: "actual_ledger_or_physical_funding_unavailable" });
  });
  it("does not treat a pre-dispatch timeout or an old unknown guard as new provider pressure", () => {
    const spend = scope().spend;
    expect(classifyBrowserOriginalScheduling({ calls: [{ call_state: "completed", originalReceipt: { kind: "result", result: { reason: "timeout", upstreamAttempted: false, durationMs: 0 } } }], ledgerRows: [] }, spend)).toBeNull();
    const guard = { calls: [{ call_state: "completed", reservation_id: "reservation-a", originalReceipt: { kind: "result", result: { reason: "durable_outcome_unknown", upstreamAttempted: true } } }],
      ledgerRows: [{ id: "reservation-a", state: "conservative", run_id: spend.runId, phase: spend.phase, model: "deepseek-flash", operation: "competition_v7_rank", effort: "low", effort_policy_sha256: spend.effortPolicySha256 }], ledgerOwnership: { issues: [] } };
    expect(classifyBrowserOriginalScheduling(guard, spend)).toBeNull();
  });
  it("stops new samples only for an explicit unproven original identity while retaining every slot", async () => {
    const started: string[] = [], cases = Array.from({ length: 6 }, (_, i) => ({ caseId: `case-${i}`, viewport: "desktop" }));
    const queue = await runAdaptiveBrowserCases(cases, { sampler: sampler(), runCase: async (entry: any) => { started.push(entry.caseId); return { caseId: entry.caseId, stopScheduling: true, reason: "unproven-original-identity" }; } });
    expect(started).toEqual(["case-0"]); expect(queue.outcomes).toHaveLength(6); expect(queue.outcomes.slice(1).every((row: any) => row.kind === "not_run")).toBe(true);
  });
});
