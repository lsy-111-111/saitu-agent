import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyPublicAdmissionOriginals, inspectPublicAdmission } from "../../../scripts/competitions/v7/evaluation-registration.mjs";
import { byteHash, canonicalHash, POLICY_VERSION, POLICY_SHA256 } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { hasBoundProviderDispatch } from "../../../scripts/competitions/v7/evaluation-dispatch-evidence.mjs";
// @ts-expect-error Plain Node browser bridge deliberately has no standalone TS declaration.
import { hasBoundProviderDispatch as browserDispatch } from "../../e2e/v7-browser-evidence.mjs";

const paid = () => ({ spend_run_id: "registered-public-scope", model: "deepseek-flash", effort: "high", reservation_id: "synthetic-bound-reservation",
  originalReceipt: { kind: "receipt", receipt: { httpStatus: 200 } } });
const unpaid = () => ({ reservation_id: null, originalReceipt: { kind: "result", result: { upstreamAttempted: false, reason: "timeout" } } });
async function originalFixture(calls: any[] = [paid(), unpaid()]) {
  const directory = await mkdtemp(path.join(tmpdir(), "saitu-v7-public-originals-"));
  const config = Object.fromEntries(["implementationSha256", "runtimeConfigurationSha256", "catalogSha256", "runtimeSourceBindingSha256"].map(key => [key, canonicalHash(key)]));
  config.candidatePoolSha256 = canonicalHash([]);
  const runs = [], runChecks = [];
  for (let index = 0; index < 5; index++) {
    const invocationId = `synthetic-only-invocation-${index}`, receiptPath = `receipt-${index}.json`;
    const receipt = { schemaVersion: "saitu.public-browser-receipts.v7.1", invocationId, realProviderDispatch: true, calls, runSnapshot: { context: { records: [] } } };
    await writeFile(path.join(directory, receiptPath), JSON.stringify(receipt));
    const receiptSha256 = byteHash(await readFile(path.join(directory, receiptPath)));
    await writeFile(path.join(directory, `dom-${index}.json`), JSON.stringify({ syntheticOnly: true }));
    await writeFile(path.join(directory, `screenshot-${index}.png`), "synthetic-bytes-not-a-product-screenshot");
    runs.push({ invocationId, receiptPath, receiptSha256, realProviderDispatch: true, success: index < 4, pageDelivered: index < 4, criticalReviewPassed: index < 4 });
    runChecks.push({ invocationId, receiptSha256, criticalReviewPassed: index < 4,
      dom: { path: `dom-${index}.json`, sha256: byteHash(await readFile(path.join(directory, `dom-${index}.json`))) },
      screenshot: { path: `screenshot-${index}.png`, sha256: byteHash(await readFile(path.join(directory, `screenshot-${index}.png`))) } });
  }
  const review = { schemaVersion: "saitu.public-critical-review.v7.1", contextId: "synthetic-independent-reviewer", passed: true, admissionRunsSha256: canonicalHash(runs), runChecks };
  await writeFile(path.join(directory, "review.json"), JSON.stringify(review));
  const admission = { schemaVersion: "saitu.public-admission.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, authorContextId: "synthetic-author", ...config,
    executionScope: { runId: "registered-public-scope" }, runs,
    independentReview: { contextId: review.contextId, passed: true, evidencePath: "review.json", evidenceSha256: byteHash(await readFile(path.join(directory, "review.json"))) } };
  return { admission, config, directory };
}

describe("formal public receipt dispatch bridge", () => {
  it("uses the same pure classifier as both live browser collectors", async () => {
    expect(browserDispatch).toBe(hasBoundProviderDispatch);
    for (const file of ["tests/e2e/v7-public-browser.mjs", "tests/e2e/v7-performance-browser.mjs"]) {
      const source = await readFile(path.join(process.cwd(), file), "utf8");
      const members = source.match(/const harnessFiles = (\[[^\n]+\]);/)?.[1];
      expect(members).toContain("tests/e2e/v7-browser-evidence.mjs");
      expect(members).toContain("scripts/competitions/v7/evaluation-dispatch-evidence.mjs");
    }
  });
  it("verifies the real original chain while keeping an explicitly unpaid rejected repair", async () => {
    const f = await originalFixture();
    try {
      expect(inspectPublicAdmission(f.admission, f.config)).toEqual([]);
      expect(await verifyPublicAdmissionOriginals(f.admission, f.config, f.directory)).toEqual({ originalRunsVerified: 5, successRequired: 4, independentCriticalReviewVerified: true });
      const receipt = JSON.parse(await readFile(path.join(f.directory, f.admission.runs[0].receiptPath), "utf8"));
      expect(receipt.calls).toHaveLength(2); expect(receipt.calls[1]).toEqual(unpaid());
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it.each([undefined, "", "   "])("rejects missing expected execution scope rather than learning it from call rows: %s", async runId => {
    const f = await originalFixture();
    try {
      (f.admission.executionScope as any).runId = runId;
      await expect(verifyPublicAdmissionOriginals(f.admission, f.config, f.directory)).rejects.toThrow("funded_execution_scope_required");
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it.each([
    { ...paid(), spend_run_id: "foreign-scope" },
    { ...paid(), reservation_id: null },
    { ...paid(), effort: "max" },
    { ...paid(), call_state: "unknown", originalReceipt: null, reservation_id: null },
    { ...paid(), call_state: "dispatch_intent", originalReceipt: null, spend_run_id: "foreign-scope" },
    { ...paid(), call_state: "response_received", originalReceipt: null, model: "wrong-model" },
    { call_state: "completed", originalReceipt: null },
  ])("does not let a bound attempt conceal another unbound proven or possible paid call: %j", async invalid => {
    const f = await originalFixture([paid(), invalid]);
    try { await expect(verifyPublicAdmissionOriginals(f.admission, f.config, f.directory)).rejects.toThrow("dispatch_summary_differs"); }
    finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it("requires at least one original proof and retains the independent four-of-five entrance gate", async () => {
    const noProof = await originalFixture([unpaid()]);
    try { await expect(verifyPublicAdmissionOriginals(noProof.admission, noProof.config, noProof.directory)).rejects.toThrow("dispatch_summary_differs"); }
    finally { await rm(noProof.directory, { recursive: true, force: true }); }
    const failed = await originalFixture();
    try {
      for (const run of failed.admission.runs) { run.success = false; run.pageDelivered = false; run.criticalReviewPassed = false; }
      expect(inspectPublicAdmission(failed.admission, failed.config)).toContain("new_public_five_runs_require_four_real_successes");
      await expect(verifyPublicAdmissionOriginals(failed.admission, failed.config, failed.directory)).rejects.toThrow("four_real_successes");
    } finally { await rm(failed.directory, { recursive: true, force: true }); }
  });
});
