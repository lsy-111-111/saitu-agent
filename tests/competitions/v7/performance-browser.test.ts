import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
// @ts-expect-error The production browser runner is a plain Node module.
import { performanceSample, validatePublicEntrance, validatePublicEntranceFiles } from "../../e2e/v7-performance-browser.mjs";
import { createHash } from "node:crypto";
import { scorePerformance } from "../../../scripts/competitions/v7/evaluation-score.mjs";
import { EVALUATION_POLICY } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { USER_UNBOUNDED_GRANT_VERSION, USER_UNBOUNDED_EXECUTION_LIMITS } from "@/lib/ai/execution-policy.mjs";

type BrowserRecord = { invocationId: string; viewport: string; realProviderDispatch: boolean; receiptSha256: string | null;
  receiptPath: string; success: boolean; timing: { timeOrigin: number; start: number; listMs: number | null;
    allDetailsMs: number | null; readyExpansionMs: number | null } };
const record = (): BrowserRecord => ({ invocationId: "original-browser-request", viewport: "desktop", realProviderDispatch: true,
  receiptSha256: "a".repeat(64), receiptPath: "actual-receipt.json", success: true,
  timing: { timeOrigin: 1794160800000, start: 125, listMs: 23000, allDetailsMs: 67000, readyExpansionMs: 120 } });

describe("v7 actual browser performance evidence", () => {
  it("uses the original browser clock, including submission work before the server run", () => {
    const sample = performanceSample(record());
    expect(sample.originalSubmittedAt).toBe(new Date(1794160800125).toISOString());
    expect(Date.parse(sample.listRenderedAt) - Date.parse(sample.originalSubmittedAt)).toBe(23000);
    expect(Date.parse(sample.detailsRenderedAt) - Date.parse(sample.originalSubmittedAt)).toBe(67000);
    expect(sample.readyExpansionMs).toBe(120);
  });

  it("retains a delivered list but records missing details as a failed detail observation", () => {
    const input = record(); input.success = false; input.timing.allDetailsMs = null; input.timing.readyExpansionMs = null;
    const sample = performanceSample(input);
    expect(sample.listRenderedAt).not.toBeNull(); expect(sample.detailsRenderedAt).toBeNull();
    expect(sample.readyExpansionSucceeded).toBe(false);
  });

  it.each(["provider", "receipt"])("does not score unverified DOM timing as real performance: %s", missing => {
    const input = record(); if (missing === "provider") input.realProviderDispatch = false; else input.receiptSha256 = null;
    const sample = performanceSample(input);
    expect(sample.originalSubmittedAt).toBeNull(); expect(sample.listRenderedAt).toBeNull();
    expect(sample.detailsRenderedAt).toBeNull(); expect(sample.readyExpansionSucceeded).toBe(false);
  });

  it("keeps all failed original attempts in the percentile denominator", () => {
    const samples = Array.from({ length: 100 }, (_, i) => {
      const input = record(); input.invocationId = `original-${i}`; input.viewport = i % 2 ? "desktop" : "mobile";
      if (i < 6) { input.success = false; input.timing.listMs = null; input.timing.allDetailsMs = null; input.timing.readyExpansionMs = null; }
      return performanceSample(input);
    });
    expect(scorePerformance(samples)).toMatchObject({ denominator: 100, desktop: 50, mobile: 50,
      failedListAttempts: 6, failedDetailAttempts: 6, firstListP95Ms: null, allDetailsP95Ms: null, status: "failed" });
  });

  it("predeclares 100 fresh requests with 50 per device without claiming 100 independent students", async () => {
    const plan = JSON.parse(await readFile("tests/e2e/fixtures/v7-performance-browser-plan.json", "utf8")) as { cases: { caseId: string; viewport: string; profileFamilyId: string }[] };
    expect(plan.cases).toHaveLength(100); expect(new Set(plan.cases.map(row => row.caseId)).size).toBe(100);
    for (const device of ["desktop", "mobile"]) expect(plan.cases.filter(row => row.viewport === device)).toHaveLength(50);
    expect(new Set(plan.cases.map(row => row.profileFamilyId)).size).toBe(5);
    expect(plan).toMatchObject({ paidWarmupRequests: 0, requestConcurrency: "adaptive", modelConcurrencyLimit: null, automaticPaidRetries: false, independentStudentSamplesClaimed: false });
  });
});

describe("v7 performance public entrance dependency", () => {
  function evidence() {
    const pins = Object.fromEntries(["implementationSha256", "runtimeSourceBindingSha256", "runtimeConfigurationSha256", "catalogSha256", "candidatePoolSha256", "policySha256"].map(key => [key, "a".repeat(64)]));
    const runs = Array.from({ length: 5 }, (_, i) => ({ caseId: `case-${i}`, invocationId: `run-${i}`, receiptSha256: String(i).repeat(64), realProviderDispatch: true, success: true, pageDelivered: true, timing: { timeOrigin: 1794160800000, start: 125, listMs: 25000, allDetailsMs: 80000, readyExpansionMs: 100 } }));
    const admission = { schemaVersion: "saitu.public-admission.v7.1", ...pins, policyVersion: "v7", authorContextId: "author", registrationSha256: "b".repeat(64), harnessSha256: "c".repeat(64), runs };
    const review = { schemaVersion: "saitu.independent-public-admission-review.v1", reviewerContextId: "independent", reviewCompleted: true, passed: true, entranceDecision: "accepted", sourcePath: "artifacts/continuation-v7-20261109/test/admission.json", sourceSha256: "", registrationSha256: admission.registrationSha256, harnessSha256: admission.harnessSha256, originalReceiptAndDomBindingsVerified: true, failuresRetainedInDenominator: true, denominator: 5, requiredAccepted: 4, accepted: 5, rows: runs.map(row => ({ caseId: row.caseId, invocationId: row.invocationId, receiptSha256: row.receiptSha256, accepted: true })) };
    const config = { ...pins, policyVersion: "v7", publicEntrance: { admission: { path: review.sourcePath, sha256: "" }, review: { path: "artifacts/continuation-v7-20261109/test/review.json", sha256: "" } } };
    const seal = () => {
      const admissionBytes = Buffer.from(JSON.stringify(admission));
      review.sourceSha256 = config.publicEntrance.admission.sha256 = createHash("sha256").update(admissionBytes).digest("hex");
      const reviewBytes = Buffer.from(JSON.stringify(review));
      config.publicEntrance.review.sha256 = createHash("sha256").update(reviewBytes).digest("hex");
      return [config, admissionBytes, reviewBytes] as const;
    };
    return { config, admission, review, seal };
  }
  it("accepts four reviewed complete observations while retaining the fifth failure", () => {
    const e = evidence(); e.review.accepted = 4; e.review.rows[4].accepted = false; e.admission.runs[4].success = false;
    expect(validatePublicEntrance(...e.seal())).toMatchObject({ accepted: 4, denominator: 5 });
  });
  async function originalFiles(emptyFifth = false) {
    const root = await mkdtemp(path.join(os.tmpdir(), "performance-originals-synthetic-")), e: any = evidence();
    const directory = path.join(root, path.dirname(e.config.publicEntrance.admission.path));
    await mkdir(directory, { recursive: true });
    const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    const put = async (name: string, value: unknown) => { const bytes = Buffer.from(JSON.stringify(value)); await writeFile(path.join(directory, name), bytes); return { path: name, sha256: sha(bytes) }; };
    const scope = { grantVersion: USER_UNBOUNDED_GRANT_VERSION, executionMode: "user-unbounded", executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS,
      runId: "synthetic-new-public", phase: "calibration", authorizedEffort: "stage", effortPolicy: EVALUATION_POLICY.runtime.effortPolicy,
      effortPolicySha256: EVALUATION_POLICY.runtime.effortPolicySha256, effortConditionSha256: "a".repeat(64), authorizationPolicySha256: "a".repeat(64), callLimit: null, hardLimitMicros: null };
    e.config.spend = scope; e.admission.executionScope = scope; e.admission.executionIntegrityPassed = true;
    const rows = [];
    for (const [i, run] of e.admission.runs.entries()) {
      if (emptyFifth && i === 4) {
        const ref = await put(`${run.caseId}-receipt.json`, { syntheticOnly: true, outcome: "not-delivered", ledgerRows: [], calls: [] });
        Object.assign(run, { ownedLedgerIds: [], receiptPath: ref.path, receiptSha256: ref.sha256, success: false, realProviderDispatch: false, pageDelivered: false, outcome: "not_run" });
        Object.assign(e.review.rows[i], { receiptSha256: ref.sha256, accepted: false });
        e.review.accepted = 4;
        continue;
      }
      const row = { id: `synthetic-r-${i}`, run_id: scope.runId, phase: scope.phase, model: "deepseek-flash", operation: "competition_v7_rank", effort: "low", effort_policy_sha256: scope.effortPolicySha256, state: "usage_estimated", reserved_micros: "20", charged_micros: "20" };
      rows.push(row); run.ownedLedgerIds = [row.id];
      const trace = { sourceSha256: e.config.runtimeSourceBindingSha256, complete: true, issues: [], inodeBefore: 1, inodeAfter: 1, deviceBefore: 1, deviceAfter: 1, startOffset: 0, endOffset: 0, prefixSha256Before: "a".repeat(64), prefixSha256After: "a".repeat(64), segmentSha256: "a".repeat(64), events: [] };
      const ref = await put(`${run.caseId}-receipt.json`, { syntheticOnly: true, ledgerRows: [row], calls: [{ call_id: `synthetic-c-${i}`, reservation_id: row.id }], accountingTrace: trace });
      run.receiptPath = ref.path; run.receiptSha256 = ref.sha256; e.review.rows[i].receiptSha256 = ref.sha256;
    }
    const batch = { syntheticOnly: true, executionMode: "user-unbounded", spendRunId: scope.runId, valid: true, actualLedgerRows: rows, ownership: rows.map((row, i) => ({ reservationId: row.id, caseId: e.admission.runs[i].caseId })) };
    e.admission.batchOriginals = await put("batch-ledger-originals.json", batch);
    const [config, admissionBytes, reviewBytes] = e.seal();
    await writeFile(path.join(root, config.publicEntrance.admission.path), admissionBytes);
    await writeFile(path.join(root, config.publicEntrance.review.path), reviewBytes);
    return { root, config, batchPath: path.join(directory, "batch-ledger-originals.json"), close: () => rm(root, { recursive: true, force: true }) };
  }
  it("rereads and recomputes the five original reservation owners before performance admission", async () => {
    const f = await originalFiles(); try { expect(await validatePublicEntranceFiles(f.config, f.root)).toMatchObject({ accepted: 5, originalBatchReservationsVerified: 5 }); } finally { await f.close(); }
    const four = await originalFiles(true); try { expect(await validatePublicEntranceFiles(four.config, four.root)).toMatchObject({ accepted: 4, denominator: 5, originalBatchReservationsVerified: 4 }); } finally { await four.close(); }
  });
  it.each(["changed", "missing"])("rejects a %s raw public batch despite an unchanged accepted summary", async kind => {
    const f = await originalFiles();
    try {
      if (kind === "changed") await writeFile(f.batchPath, "{}"); else await rm(f.batchPath);
      await expect(validatePublicEntranceFiles(f.config, f.root)).rejects.toThrow();
    } finally { await f.close(); }
  });
  it.each(["list", "details", "expansion", "missing-expansion"])("does not admit performance from a quality-approved five with invalid Top5 timing: %s", kind => {
    const e = evidence();
    for (const run of e.admission.runs) {
      if (kind === "list") run.timing.listMs = 40_001;
      if (kind === "details") run.timing.allDetailsMs = 120_001;
      if (kind === "expansion") run.timing.readyExpansionMs = 1001;
      if (kind === "missing-expansion") Reflect.deleteProperty(run.timing, "readyExpansionMs");
    }
    expect(() => validatePublicEntrance(...e.seal())).toThrow("accepted_public_observation_must_jointly_meet_top5_targets");
  });
  it.each(["source", "catalog", "reviewer", "failed", "fake-success", "duplicate", "receipt"])("rejects an inapplicable public entrance: %s", kind => {
    const e = evidence();
    if (kind === "source") Reflect.set(e.admission, "implementationSha256", "f".repeat(64));
    if (kind === "catalog") Reflect.set(e.admission, "candidatePoolSha256", "f".repeat(64));
    if (kind === "reviewer") e.review.reviewerContextId = "author";
    if (kind === "failed") { e.review.passed = false; e.review.entranceDecision = "rejected"; }
    if (kind === "fake-success") e.admission.runs[0].realProviderDispatch = false;
    if (kind === "duplicate") e.review.rows[1].caseId = e.review.rows[0].caseId;
    if (kind === "receipt") e.review.rows[0].receiptSha256 = "e".repeat(64);
    expect(() => validatePublicEntrance(...e.seal())).toThrow();
  });
  it("rejects changed original bytes despite an unchanged review", () => {
    const e = evidence(), [config, bytes, review] = e.seal();
    expect(() => validatePublicEntrance(config, Buffer.concat([bytes, Buffer.from(" ")]), review)).toThrow("public_entrance_original_bytes_changed");
  });
});
