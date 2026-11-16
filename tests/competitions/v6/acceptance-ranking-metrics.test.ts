import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { acceptanceCanonicalHash as hash, deriveMetricArtifact, RANKING_METRIC_AGGREGATION } from "../../../scripts/competitions/v6/acceptance-artifact-derivation";
import type { MetricEvidence } from "../../../scripts/competitions/v6/acceptance-gate";
import { rawScoringFixture } from "./acceptance-raw-scoring.fixture";
const ids = ["pooledNdcg5", "pooledNdcg10", "minimumTaskGroupNdcg5", "completePoolLabelCoverage", "unresolvedLabels", "top5Jaccard"];
const roots: string[] = [];
const bytesHash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const record = (value: unknown) => value as Record<string, unknown>;
function fixture(protocol: unknown = RANKING_METRIC_AGGREGATION) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "saitu-ranking-metrics-synthetic-"))); roots.push(base);
  const root = path.join(base, "evidence"), modules = path.join(base, "verifier"); mkdirSync(root); mkdirSync(modules);
  const registration = { protocol, registeredAt: "2026-11-05T11:30:00Z", openedAt: "2026-11-05T12:00:00Z", startedAt: "2026-11-05T12:00:01Z" };
  const f = rawScoringFixture(root, undefined, registration);
  const refreshClaims = () => { f.data.metrics = Object.fromEntries(ids.map(id => [id, {
    value: id === "unresolvedLabels" ? 0 : 1, denominator: id === "unresolvedLabels" ? 240 : id === "minimumTaskGroupNdcg5" ? 20 : 120,
    evidenceClass: "ai_proxy", evidencePath: f.data.rawScoringEvidence!.path, evidenceSha256: f.data.rawScoringEvidence!.sha256,
  } satisfies MetricEvidence])); };
  const files = ["acceptance-gate.ts", "acceptance-artifact-derivation.ts", "select-development-baseline.mjs","state-obligation-audit.ts","reason-audit.ts","fact-claim-audit.ts","constraint-audit.ts", "profile-gold.ts","profile-atom-metrics.ts", "reviewer-agreement.ts","ranking-batches.mjs","acceptance-raw-scoring.ts", "evaluate-rankings.ts", "score-product-observations.ts", "ranking-reuse.mjs", "frozen-ranking-executor.mjs", "experiment-registration.mjs", "runtime-configuration.mjs", "product-performance.mjs"].map(name => `scripts/competitions/v6/${name}`).concat(["src/lib/competitions/v6/contracts.ts", "tests/fixtures/spend-ledger-baseline-20261105.json"]);
  for (const file of files) { const target = path.join(modules, file); mkdirSync(path.dirname(target), { recursive: true }); cpSync(path.join(process.cwd(), file), target); }
  mkdirSync(path.join(modules, "node_modules")); cpSync(realpathSync(path.join(process.cwd(), "node_modules/zod")), path.join(modules, "node_modules/zod"), { recursive: true, dereference: true });
  const rawModule = path.join(modules, "scripts/competitions/v6/acceptance-raw-scoring.ts");
  const original = readFileSync(rawModule, "utf8");
  function pinSyntheticCopy(instrument = false) {
    // TEST ONLY: a generated keyless review and finite pin in a disposable V.
    // No production trust table, C, actual review or private material is changed.
    const bindingSha256 = hash(JSON.parse(readFileSync(path.join(root, "raw-scoring.json"), "utf8")));
    const report = f.write("synthetic-independent-review.json", { schemaVersion: "saitu.raw-scoring-independent-review.v1", bindingSha256, mode: "ai_proxy", status: "approved" });
    let source = original.replace("const TRUSTED_SCORING_REVIEWS: readonly TrustedReview[] = Object.freeze([]);", `const TRUSTED_SCORING_REVIEWS: readonly TrustedReview[] = Object.freeze(${JSON.stringify([{ bindingSha256, report, reportSha256: report.sha256 }])});`);
    if (instrument) source = source.replace("export function deriveSealedExecution(input: AcceptanceInput, root: string): RawScoringDerivation {", "export function deriveSealedExecution(input: AcceptanceInput, root: string): RawScoringDerivation {\n(globalThis as { replayCount?: number }).replayCount = ((globalThis as { replayCount?: number }).replayCount ?? 0) + 1;");
    writeFileSync(rawModule, source);
  }
  function run(instrument = false) {
    f.write("acceptance.json", f.data); const output = path.join(base, "result.json");
    const entry = path.join(modules, "scripts/competitions/v6/acceptance-gate.ts");
    let argv = [entry, "--input", path.join(root, "acceptance.json"), "--output", output];
    if (instrument) {
      const runner = path.join(base, "count-replay.mjs");
      writeFileSync(runner, `import {createRequire} from 'node:module';import {readFileSync,writeFileSync} from 'node:fs';const {evaluateProductAcceptance}=createRequire(import.meta.url)(${JSON.stringify(entry)});const result=evaluateProductAcceptance(JSON.parse(readFileSync(${JSON.stringify(path.join(root, "acceptance.json"))})),${JSON.stringify(root)});writeFileSync(${JSON.stringify(output)},JSON.stringify({result,replayCount:globalThis.replayCount}));process.exitCode=result.agreedAiProxyGatesPassed?0:1;`);
      argv = [runner];
    }
    const execution = spawnSync(process.execPath, argv, { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 32 * 1024 ** 2 });
    expect(execution.status, execution.stderr).toBe(1); return JSON.parse(readFileSync(output, "utf8"));
  }
  function persist() { f.persist(); refreshClaims(); }
  refreshClaims(); return { ...f, root, base, modules, registration, persist, refreshClaims, pinSyntheticCopy, run };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function replaceDisplay(f: ReturnType<typeof fixture>, profileId: string, repetition: number, displayed: string[]) {
  const observation = f.matrix.find(row => row.algorithm === "B" && row.profileId === profileId && row.repetition === repetition)!;
  observation.output = { ...record(observation.output), recommendations: displayed.map(itemId => ({ itemId })) };
  observation.outputSha256 = hash(observation.output); observation.execution = { ...record(observation.execution), modelStatus: displayed.length ? "ok" : "empty" };
  const run = f.runs.find(row => row.invocationId === observation.invocationId)!;
  run.displayedItemIds = displayed; run.outputSha256 = observation.outputSha256; run.modelStatus = displayed.length ? "ok" : "empty";
}
describe("raw ranking metric derivation; synthetic proof chains are not formal collection", () => {
  it("keeps all six metrics pending behind the actual empty review register", () => {
    const f = fixture();
    for (const id of ids) expect(deriveMetricArtifact(id, f.data.metrics[id], f.data, f.root)).toMatchObject({ status: "pending", reason: "independent_ai_review_registration_required", derived: null });
    const output = f.run(); expect(output.agreedAiProxyGatesPassed).toBe(false);
    expect(ids.every(id => output.artifactDerivations[id].status === "pending")).toBe(true);
  });
  it("native Node CLI derives only the six requested metrics from a synthetic registered full chain", () => {
    const f = fixture(); f.pinSyntheticCopy(); const output = f.run();
    expect(output.executionDerivation.status).toBe("derived");
    for (const id of ids) expect(output.artifactDerivations[id]).toMatchObject({ status: "derived", derived: { value: f.data.metrics[id].value, denominator: f.data.metrics[id].denominator, evidenceClass: "ai_proxy" } });
    expect(output.artifactDerivations.top5Jaccard.details.jaccard).toEqual({ pairsPerFamily: 10, totalObservedPairs: 1200, aggregatedPairs: 1200, effectiveIndependentFamilies: 120, excludedFamilyIds: [] });
    expect(output.agreedAiProxyGatesPassed).toBe(false); expect(output.gates.find((row: { id: string }) => row.id === "profileMicroF1").passed).toBe(false);
  });
  it("computes agreement from both original reviewers, not the adjudicated grades", () => {
    const f = fixture(); f.pinSyntheticCopy();
    f.data.metrics.rawReviewerAgreementAlpha = {...f.data.metrics.pooledNdcg5, value:1, denominator:240};
    const result=f.run().artifactDerivations.rawReviewerAgreementAlpha;
    expect(result).toMatchObject({status:"derived",derived:{value:1,denominator:240},details:{originalAgreement:{candidates:240,paired:240}}});
  });
  it("replays raw evidence exactly once per acceptance invocation without a caller-provided proof hook", () => {
    const f = fixture(); f.pinSyntheticCopy(true); const output = f.run(true);
    expect(output.replayCount).toBe(1); expect(output.result.artifactDerivations.pooledNdcg5.status).toBe("derived");
  });
  it("does not infer preregistration merely because the scorer exists", () => {
    const f = fixture(null); f.pinSyntheticCopy(); const output = f.run();
    expect(output.executionDerivation.status).toBe("derived");
    for (const id of ids) expect(output.artifactDerivations[id]).toMatchObject({ status: "pending", reason: "ranking_metric_aggregation_not_preregistered" });
  });
  it.each([
    ["2026-11-05T11:00:00Z", "invalid", "ranking_metric_registration_after_challenge_opening"],
    ["2026-11-05T11:29:59.999Z", "invalid", "ranking_metric_registration_after_challenge_opening"],
    ["2026-11-05T11:30:00Z", "derived", null],
    ["2026-11-05T19:30:00+08:00", "derived", null],
    ["2026-11-05T11:45:00Z", "derived", null],
    [null, "pending", "ranking_challenge_opening_timeline_required"],
    ["", "pending", "ranking_challenge_opening_timeline_required"],
    ["2026-11-05T12:00:00", "invalid", "ranking_challenge_opening_timeline_invalid"],
    ["2026-11-05T09:59:59Z", "invalid", "ranking_challenge_opening_before_freeze"],
  ])("binds policy to actual challenge opening %s (%s)", (openedAt, status, reason) => {
    const f = fixture(); f.data.challengeManifest.openedAt = openedAt;
    f.persist(); f.pinSyntheticCopy(); const output = f.run();
    for (const id of ids) expect(output.artifactDerivations[id]).toMatchObject({ status, reason });
    expect(output.agreedAiProxyGatesPassed).toBe(false);
  });
  it.each(["changed_policy", "late_registration", "missing_timestamp"])("rejects or pends %s before aggregating", variant => {
    const f = fixture();
    if (variant === "changed_policy") f.registration.protocol = { ...RANKING_METRIC_AGGREGATION, familyWeighting: "runs" };
    else f.registration.registeredAt = variant === "late_registration" ? "2026-11-05T12:01:00Z" : "";
    f.persist(); f.pinSyntheticCopy(); const output = f.run();
    expect(output.artifactDerivations.top5Jaccard.status).toBe(variant === "missing_timestamp" ? "pending" : "invalid");
  });
  it.each(["value", "denominator", "evidence_class", "numerator", "different_envelope"])("rejects caller %s certification", variant => {
    const f = fixture(); f.pinSyntheticCopy();
    if (variant === "value") f.data.metrics.pooledNdcg5.value = 0.99;
    if (variant === "denominator") f.data.metrics.pooledNdcg5.denominator = 600;
    if (variant === "evidence_class") f.data.metrics.pooledNdcg5.evidenceClass = "live_model";
    if (variant === "numerator") f.data.metrics.pooledNdcg5.numerator = 120;
    if (variant === "different_envelope") { const alternate = f.write("identical-other-path.json", JSON.parse(readFileSync(path.join(f.root, "raw-scoring.json"), "utf8"))); f.data.metrics.pooledNdcg5.evidencePath = alternate.path; f.data.metrics.pooledNdcg5.evidenceSha256 = alternate.sha256; }
    expect(f.run().artifactDerivations.pooledNdcg5.status).toBe("invalid");
  });
  it("retains zero-relevant families separately without padding 119 to 120", () => {
    const f = fixture();
    for (const review of f.rankingReviews.filter(row => row.profileId === "profile-0")) for (const item of review.judgments as Record<string, unknown>[]) item.relevance = 0;
    for (let repetition = 0; repetition < 5; repetition++) replaceDisplay(f, "profile-0", repetition, []);
    f.persist(); f.pinSyntheticCopy();
    for (const id of ["pooledNdcg5", "pooledNdcg10", "top5Jaccard"]) f.data.metrics[id].denominator = 119;
    f.data.metrics.minimumTaskGroupNdcg5.denominator = 19;
    const output = f.run();
    expect(output.artifactDerivations.pooledNdcg5).toMatchObject({ status: "derived", derived: { value: 1, denominator: 119 } });
    expect(output.artifactDerivations.pooledNdcg5.details.noRelevantFamilies).toHaveLength(1);
    expect(output.artifactDerivations.pooledNdcg5.details.noRelevantFamilies[0]).toMatchObject({ pooledNdcg5: null, pooledNdcg10: null, runCount: 5, emptyOutputRate: 1 });
    expect(output.gates.find((row: { id: string }) => row.id === "pooledNdcg5").reason).toBe("insufficient_denominator");
    expect(output.artifactDerivations.top5Jaccard.details.jaccard).toMatchObject({ aggregatedPairs: 1190, effectiveIndependentFamilies: 119, excludedFamilyIds: ["ranking-family-0"] });
  });
  it("all zero pools remain null with zero effective nDCG/Jaccard families", () => {
    const f = fixture(); for (const review of f.rankingReviews) for (const item of review.judgments as Record<string, unknown>[]) item.relevance = 0;
    for (let profile = 0; profile < 120; profile++) for (let repetition = 0; repetition < 5; repetition++) replaceDisplay(f, `profile-${profile}`, repetition, []);
    f.persist(); f.pinSyntheticCopy(); for (const id of ["pooledNdcg5", "pooledNdcg10", "minimumTaskGroupNdcg5", "top5Jaccard"]) { f.data.metrics[id].value = null; f.data.metrics[id].denominator = 0; }
    const output = f.run(); expect(output.artifactDerivations.pooledNdcg5).toMatchObject({ status: "derived", derived: { value: null, denominator: 0 } });
    expect(output.artifactDerivations.pooledNdcg5.details.noRelevantFamilies).toHaveLength(120); expect(output.gates.find((row: { id: string }) => row.id === "pooledNdcg5").passed).toBe(false);
  });
  it("aggregates actual five repeats then equal families, with ten Jaccard pairs per family", () => {
    const f = fixture(); replaceDisplay(f, "profile-0", 0, ["candidate-1"]); f.persist(); f.pinSyntheticCopy();
    const runScore = 7 / (7 + 3 / Math.log2(3)), familyScore = (runScore + 4) / 5;
    f.data.metrics.pooledNdcg5.value = (familyScore + 119) / 120; f.data.metrics.pooledNdcg10.value = f.data.metrics.pooledNdcg5.value;
    f.data.metrics.minimumTaskGroupNdcg5.value = (familyScore + 19) / 20; f.data.metrics.top5Jaccard.value = (0.8 + 119) / 120;
    const output = f.run(); for (const id of ["pooledNdcg5", "pooledNdcg10", "minimumTaskGroupNdcg5", "top5Jaccard"]) expect(output.artifactDerivations[id].status).toBe("derived");
  });
  it.each(["missing", "U", "duplicate", "missing_reviewer"])("never maps %s labels/reviews to complete zero-error labeling", variant => {
    const f = fixture(); const review = f.rankingReviews.find(row => row.profileId === "profile-0")!; const judgments = review.judgments as Record<string, unknown>[];
    if (variant === "missing") judgments.pop(); if (variant === "U") judgments[0].relevance = "U"; if (variant === "duplicate") judgments.push({ ...judgments[0] }); if (variant === "missing_reviewer") f.rankingReviews.splice(f.rankingReviews.indexOf(review), 1);
    f.persist(); f.pinSyntheticCopy(); const output = f.run(); expect(["pending", "invalid"]).toContain(output.artifactDerivations.completePoolLabelCoverage.status); expect(output.artifactDerivations.completePoolLabelCoverage.derived).toBeNull();
  });
  it("keeps all five failed runs in their family mean and the 600-run denominator", () => {
    const f = fixture();
    for (const observation of f.matrix.filter(row => row.algorithm === "B" && row.profileId === "profile-0")) {
      observation.status = "error"; observation.output = null; observation.outputSha256 = hash(null);
      observation.execution = { modelStatus: "provider_error", actualModelRun: false, httpDispatches: 0 };
      const run = f.runs.find(row => row.invocationId === observation.invocationId)!;
      run.modelStatus = "provider_error"; run.displayedItemIds = []; run.outputSha256 = observation.outputSha256;
    }
    f.persist(); f.pinSyntheticCopy(); const output = f.run();
    const selected = output.executionDerivation.scoring.ranking.summaries.find((row: { algorithm: string }) => row.algorithm === "B");
    expect(selected).toMatchObject({ actualRunCount: 600, familyCount: 120, scoredFamilyCount: 120, generationFailureCount: 5, pooledNdcg5: 119 / 120 });
    expect(output.artifactDerivations.pooledNdcg5.status).toBe("pending");
    expect(output.artifactDerivations.pooledNdcg5.details.generationFailureCount).toBe(5);
  });
  it("retains fallback outputs in ranking quality and reports fallback/failure counts", () => {
    const f = fixture(); const observation = f.matrix.find(row => row.algorithm === "B")!;
    observation.fallback = true; observation.output = { ...record(observation.output), fallback: { used: true } };
    observation.outputSha256 = hash(observation.output); observation.execution = { ...record(observation.execution), modelStatus: "provider_error" };
    const run = f.runs.find(row => row.invocationId === observation.invocationId)!;
    run.fallbackUsed = true; run.modelStatus = "provider_error"; run.outputSha256 = observation.outputSha256;
    f.persist(); f.pinSyntheticCopy(); const output = f.run();
    expect(output.artifactDerivations.pooledNdcg5).toMatchObject({ status: "derived", derived: { value: 1, denominator: 120 }, details: { fallbackCount: 1, generationFailureCount: 1, actualRunCount: 600 } });
  });
  it.each(["not_run", "error"])("retains %s in the raw denominator and blocks formal metrics", status => {
    const f = fixture(); f.mutateProductRows(rows => rows.map(row => row.caseId === "hard_constraints-0" ? { ...row, status } : row)); f.persist(); f.pinSyntheticCopy(); const output = f.run();
    expect(output.executionDerivation.execution).toHaveLength(800); expect(output.artifactDerivations.pooledNdcg5.status).toBe("pending");
  });
  it.each(["deleted_run", "duplicate_run", "source_drift", "configuration_drift"])("rejects %s even if submitted metrics are perfect", variant => {
    const f = fixture();
    if (variant === "deleted_run") f.matrix.pop(); if (variant === "duplicate_run") f.matrix[1] = { ...f.matrix[0] };
    f.persist(); f.pinSyntheticCopy();
    if (variant === "source_drift") writeFileSync(path.join(f.root, "synthetic.body.txt"), "changed source bytes");
    if (variant === "configuration_drift") f.data.challengeManifest.configurationSha256 = "a".repeat(64);
    expect(f.run().artifactDerivations.pooledNdcg5.status).toBe("invalid");
  });
  it("does not cache validation across calls after evidence bytes change", () => {
    const f = fixture(); expect(deriveMetricArtifact("pooledNdcg5", f.data.metrics.pooledNdcg5, f.data, f.root).status).toBe("pending");
    writeFileSync(path.join(f.root, "synthetic.body.txt"), "changed between invocations"); expect(deriveMetricArtifact("pooledNdcg5", f.data.metrics.pooledNdcg5, f.data, f.root).status).toBe("invalid");
  });
  it("keeps paired gain and CI pending without independent provenance or a preselected control", () => {
    const f = fixture(); const metric = f.data.metrics.pooledNdcg5;
    expect(deriveMetricArtifact("relativeNdcg5Gain", metric, f.data, f.root).reason).toBe("independent_ai_review_registration_required");
    f.pinSyntheticCopy();
    for (const id of ["relativeNdcg5Gain","relativeNdcg5CiLower"]) f.data.metrics[id] = {...metric};
    const result = f.run();
    for (const id of ["relativeNdcg5Gain","relativeNdcg5CiLower"]) expect(result.artifactDerivations[id].reason).toBe("preselected_development_baseline_required");
    expect(readFileSync("scripts/competitions/v6/acceptance-raw-scoring.ts", "utf8")).toContain("const TRUSTED_SCORING_REVIEWS: readonly TrustedReview[] = Object.freeze([]);");
    expect(bytesHash(readFileSync("scripts/competitions/v6/acceptance-raw-scoring.ts"))).toMatch(/^[a-f0-9]{64}$/);
  });
});
