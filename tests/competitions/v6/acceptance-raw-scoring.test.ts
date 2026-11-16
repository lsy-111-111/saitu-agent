import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { deriveSealedExecution } from "../../../scripts/competitions/v6/acceptance-raw-scoring";
import { evaluateProductAcceptance } from "../../../scripts/competitions/v6/acceptance-gate";
import { acceptanceCanonicalHash } from "../../../scripts/competitions/v6/acceptance-artifact-derivation";
import { rawScoringFixture } from "./acceptance-raw-scoring.fixture";

const roots: string[] = [];
function fixture() { const root = mkdtempSync(path.join(tmpdir(), "saitu-synthetic-scoring-")); roots.push(root); return { root, ...rawScoringFixture(root) }; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("raw scoring candidate; synthetic fixtures cannot certify formal 800 acceptance", () => {
  it("recomputes all 800 cases, the 1800 matrix and exact 600 reuse, but self-named reviewers do not establish independence", () => {
    const f = fixture(), result = deriveSealedExecution(f.data, f.root);
    expect(result.reason).toBe("independent_ai_review_registration_required");
    expect(result.rawValidated).toBe(true);
    expect(result.status).toBe("pending");
    expect(result.execution).toHaveLength(800);
    expect(result.scoring?.counts).toEqual({ passed: 800, failed: 0, not_run: 0, pending: 0 });
    expect(result.scoring?.ranking.profileResults).toHaveLength(360);
    expect(result.scoring?.ranking.summaries.every(row => row.actualRunCount === 600 && row.expectedRunCount === 600)).toBe(true);
    const gate = evaluateProductAcceptance(f.data, f.root);
    expect(gate.agreedAiProxyGatesPassed).toBe(false);
    expect(gate.blockers).toContain("sealed_case_execution:independent_ai_review_registration_required");
    expect(gate.blockers).toContain("all_800_cases_must_execute_and_pass");
    expect(gate.gates.find(row => row.id === "pooledNdcg5")?.passed).toBe(false);
  });
  it.each(["not_run", "error"])("retains %s in the 800 denominator despite caller passed claims", status => {
    const f = fixture();
    f.mutateProductRows(rows => rows.map(row => row.caseId === "hard_constraints-0" ? { ...row, status } : row)); f.persist();
    const result = deriveSealedExecution(f.data, f.root);
    expect(result.rawValidated).toBe(true);
    expect(result.execution).toHaveLength(800);
    expect(result.execution.find(row => row.caseId === "hard_constraints-0")?.status).toBe(status === "error" ? "failed" : "not_run");
    expect(result.pendingRequirements).toContain("raw_800_not_all_passed");
    expect(evaluateProductAcceptance(f.data, f.root).agreedAiProxyGatesPassed).toBe(false);
  });
  it.each(["empty", "one_nonempty", "missing_label", "unknown_label"])("keeps all-zero pools separate from pooled nDCG: %s", variant => {
    const f = fixture();
    for (const review of f.rankingReviews.filter(row => row.profileId === "profile-0")) {
      const judgments = review.judgments as Record<string, unknown>[];
      for (const judgment of judgments) judgment.relevance = 0;
      if (variant === "missing_label") judgments.pop();
      if (variant === "unknown_label") judgments[0].relevance = "U";
    }
    for (const observation of f.matrix.filter(row => row.profileId === "profile-0" && row.algorithm === "B")) {
      if (variant === "one_nonempty" && observation.repetition === 0) continue;
      observation.output = { ...(observation.output as Record<string, unknown>), recommendations: [] };
      observation.outputSha256 = acceptanceCanonicalHash(observation.output);
      observation.execution = { ...(observation.execution as Record<string, unknown>), modelStatus: "empty" };
      const run = f.runs.find(row => row.invocationId === observation.invocationId)!;
      run.displayedItemIds = []; run.outputSha256 = observation.outputSha256; run.modelStatus = "empty";
    }
    f.persist();
    const result = deriveSealedExecution(f.data, f.root);
    expect(result.rawValidated).toBe(true);
    expect(result.status).toBe("pending"); // no synthetic independent registration
    const row = result.scoring?.ranking.profileResults.find(row => row.algorithm === "B" && row.profileId === "profile-0");
    expect(row?.pooledNdcg5).toBeNull(); expect(row?.pooledNdcg10).toBeNull();
    expect(result.execution.find(row => row.caseId === "ranking-0")?.status).toBe(variant === "empty" ? "passed" : "pending");
    if (variant === "empty") {
      expect(row?.status).toBe("no_relevant_pool"); expect(row?.noRelevantPoolEmptyOutputRate).toBe(1);
      expect(result.scoring?.counts).toEqual({ passed: 800, failed: 0, not_run: 0, pending: 0 });
      const summary = result.scoring?.ranking.summaries.find(row => row.algorithm === "B");
      expect(summary?.noRelevantProfileIds).toEqual(["profile-0"]);
      expect(summary?.scoredFamilyCount).toBe(119); expect(summary?.pooledNdcg5).toBe(1);
      expect(result.pendingRequirements).toEqual(["independent_ai_review_registration_required"]);
    } else expect(result.pendingRequirements).toContain("raw_800_not_all_passed");
  });
  it.each(["missing", "U"])("does not coerce %s full-pool labels into zero or completed reviews", mutation => {
    const f = fixture();
    for (const review of f.rankingReviews.filter(row => row.profileId === "profile-0")) {
      const judgments = review.judgments as Record<string, unknown>[];
      if (mutation === "missing") judgments.pop(); else judgments[0].relevance = "U";
    }
    f.persist(); const result = deriveSealedExecution(f.data, f.root);
    expect(result.rawValidated).toBe(true);
    expect(result.pendingRequirements).toContain("ranking_labels_incomplete_or_unresolved");
    expect(result.execution.find(row => row.caseId === "ranking-0")?.status).toBe("pending");
    expect(result.scoring?.ranking.summaries.every(row => row.status === "blocked_incomplete_or_invalid_evaluation")).toBe(true);
  });
  it.each(["duplicate", "delete", "replace_reuse"])("rejects rehashed raw observation %s attacks", mutation => {
    const f = fixture();
    f.mutateProductRows(rows => {
      if (mutation === "delete") return rows.slice(1);
      if (mutation === "duplicate") { rows[1] = { ...rows[0] }; return rows; }
      return rows.map(row => row.operation === "recommend" ? { ...row, invocationId: `regenerated-${row.invocationId}` } : row);
    }); f.persist();
    const result = deriveSealedExecution(f.data, f.root);
    expect(result.status).toBe("invalid"); expect(result.rawValidated).toBe(false);
  });
  it("rejects duplicated calls in a nonselected arm even if all selected 600 rows are unchanged", () => {
    const f = fixture(), a = f.matrix.findIndex(row => row.algorithm === "A1"); f.matrix[a + 1] = { ...f.matrix[a] }; f.persist();
    expect(deriveSealedExecution(f.data, f.root).status).toBe("invalid");
  });
  it.each(["answer", "input", "reviewer", "runtime", "implementation"])("rejects rehashed %s provenance drift", mutation => {
    const f = fixture();
    if (mutation === "answer") f.keys[0].scoring = { expected: { decision: "satisfied" } };
    if (mutation === "input") f.cases[0].input = { changed: true };
    if (mutation === "reviewer") f.rankingReviews[0].contextId = "self-approved-new-name";
    if (mutation === "runtime") f.runtime.values.AI_PROVIDER = "unregistered-provider";
    if (mutation === "implementation") writeFileSync(path.join(f.root, "synthetic-implementation.ts"), "export const changed = true;\n");
    f.persist(); expect(deriveSealedExecution(f.data, f.root).status).toBe("invalid");
  });
  it("retains failed matrix output and fallback state in ranking scores instead of dropping it", () => {
    const f = fixture(), index = f.matrix.findIndex(row => row.algorithm === "B");
    const observation = f.matrix[index], ranking = f.runs[index];
    observation.status = "error"; observation.output = null; observation.outputSha256 = f.write("null-hash-helper.json", null).sha256;
    observation.execution = { modelStatus: "provider_error", actualModelRun: false, httpDispatches: 0 };
    ranking.modelStatus = "provider_error"; ranking.displayedItemIds = []; ranking.outputSha256 = observation.outputSha256;
    f.persist(); const result = deriveSealedExecution(f.data, f.root);
    expect(result.rawValidated).toBe(true);
    expect(result.execution.find(row => row.caseId === "ranking-0")?.status).toBe("failed");
    const selected = result.scoring?.ranking.summaries.find(row => row.algorithm === "B");
    expect(selected?.actualRunCount).toBe(600); expect(selected?.generationFailureCount).toBe(1);
  });
  it("does not expose a caller registration hook or accept summary-only evidence", () => {
    const f = fixture(), envelope = JSON.parse(readFileSync(path.join(f.root, "raw-scoring.json"), "utf8"));
    envelope.trustedReview = true; envelope.counts = { passed: 800 };
    f.data.rawScoringEvidence = f.write("raw-scoring.json", envelope);
    expect(deriveSealedExecution(f.data, f.root).reason).toBe("raw_scoring_unknown_envelope_field");
    f.data.rawScoringEvidence = f.write("raw-scoring.json", { schemaVersion: "saitu.acceptance-raw-scoring.v1" });
    expect(deriveSealedExecution(f.data, f.root).status).toBe("pending");
  });
  it("rejects raw source drift even when the wrapper envelope has matching bytes", () => {
    const f = fixture(); writeFileSync(path.join(f.root, "synthetic.body.txt"), "substituted source");
    expect(deriveSealedExecution(f.data, f.root).reason).toBe("raw_scoring_bytes_changed");
  });
  it("rejects configuration drift despite rehashing the changed registration and envelope", () => {
    const f = fixture(), registration = JSON.parse(readFileSync(path.join(f.root, "product-registration.json"), "utf8"));
    registration.config.seed++;
    const updated = f.write("product-registration.json", registration);
    const envelope = JSON.parse(readFileSync(path.join(f.root, "raw-scoring.json"), "utf8")); envelope.productRegistration = updated;
    f.data.rawScoringEvidence = f.write("raw-scoring.json", envelope);
    expect(deriveSealedExecution(f.data, f.root).reason).toBe("raw_scoring_product_configuration_changed");
  });
  it("does not treat a failed runner or a single aliased snapshot as completed execution", () => {
    const f = fixture(), envelope = JSON.parse(readFileSync(path.join(f.root, "raw-scoring.json"), "utf8"));
    const integrity = JSON.parse(readFileSync(path.join(f.root, "execution-integrity.json"), "utf8")); integrity.status = "failed";
    envelope.executionIntegrity = f.write("execution-integrity.json", integrity);
    f.data.rawScoringEvidence = f.write("raw-scoring.json", envelope);
    expect(deriveSealedExecution(f.data, f.root).reason).toBe("raw_product_execution_incomplete");
    f.persist(); const alias = JSON.parse(readFileSync(path.join(f.root, "raw-scoring.json"), "utf8")); alias.runtimeAfter = alias.runtimeBefore;
    f.data.rawScoringEvidence = f.write("raw-scoring.json", alias);
    expect(deriveSealedExecution(f.data, f.root).reason).toBe("raw_scoring_distinct_before_after_originals_required");
  });
  it("remains callable from the native synchronous Node CLI and reports pending rather than 800 acceptance", () => {
    const f = fixture(); f.write("acceptance.json", f.data);
    const result = spawnSync(process.execPath, [path.join(process.cwd(), "scripts/competitions/v6/acceptance-gate.ts"), "--input", path.join(f.root, "acceptance.json"), "--output", path.join(f.root, "result.json")], { cwd: f.root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(1);
    const output = JSON.parse(readFileSync(path.join(f.root, "result.json"), "utf8"));
    expect(output.executionDerivation.rawValidated).toBe(true);
    expect(output.executionDerivation.reason).toBe("independent_ai_review_registration_required");
    expect(output.agreedAiProxyGatesPassed).toBe(false);
  });
});
