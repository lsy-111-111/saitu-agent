import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const fileKey = file => (isAbsolute(file) ? relative(process.cwd(), file) : file).replaceAll("\\", "/");
const key = row => JSON.stringify([row.file, row.testName]);
function assertions(report) {
  if (!Array.isArray(report.testResults)) throw new Error("Expected an actual Vitest JSON report");
  return report.testResults.flatMap(suite => (suite.assertionResults ?? []).map(row => ({
    file: fileKey(suite.name), testName: row.fullName, status: row.status
  })));
}
const counts = report => ({ total: report.numTotalTests, passed: report.numPassedTests,
  failed: report.numFailedTests, skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0) });

/** Compares observed test identities, never treating missing/skipped old failures as fixed. */
export function compareRegressions(baseline, current) {
  const oldRows = assertions(baseline), newRows = assertions(current);
  const oldFailures = oldRows.filter(row => row.status === "failed");
  const newFailures = newRows.filter(row => row.status === "failed");
  const oldFailureKeys = new Set(oldFailures.map(key)), currentByKey = new Map(newRows.map(row => [key(row), row]));
  const unchanged = newFailures.filter(row => oldFailureKeys.has(key(row)));
  const newlyFailed = newFailures.filter(row => !oldFailureKeys.has(key(row)));
  const resolved = oldFailures.filter(row => currentByKey.get(key(row))?.status === "passed");
  const missingOrUnexecuted = oldFailures.filter(row => !["passed", "failed"].includes(currentByKey.get(key(row))?.status))
    .map(row => ({ ...row, currentStatus: currentByKey.get(key(row))?.status ?? "missing" }));
  const failedSuitesWithoutFailedAssertions = current.testResults.filter(suite => suite.status === "failed" &&
    !(suite.assertionResults ?? []).some(row => row.status === "failed")).map(suite => fileKey(suite.name));
  const countConsistency = {
    baselineAssertionsMatchTotal: oldRows.length === baseline.numTotalTests,
    currentAssertionsMatchTotal: newRows.length === current.numTotalTests,
    baselineFailuresMatchCount: oldFailures.length === baseline.numFailedTests,
    currentFailuresMatchCount: newFailures.length === current.numFailedTests
  };
  const comparisonComplete = Object.values(countConsistency).every(Boolean) && failedSuitesWithoutFailedAssertions.length === 0 &&
    missingOrUnexecuted.length === 0;
  return {
    schemaVersion: "saitu.regression-comparison.v1", generatedAt: new Date().toISOString(),
    baseline: counts(baseline), final: counts(current), failureComparison: "exact file path + full assertion name",
    unchangedFailureCount: unchanged.length, newFailures: newlyFailed, resolvedFailures: resolved,
    missingOrUnexecutedBaselineFailures: missingOrUnexecuted, failedSuitesWithoutFailedAssertions, countConsistency,
    comparisonComplete, allFailuresMatchBaseline: comparisonComplete && newlyFailed.length === 0 && resolved.length === 0 && unchanged.length === oldFailures.length,
    overallTestSuitePassed: current.success === true && current.numFailedTests === 0 && failedSuitesWithoutFailedAssertions.length === 0,
    productionReleasePerformed: false
  };
}

function main() {
  const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  const baselineFile = argument("--baseline") ?? "artifacts/v6/baseline/vitest-baseline.json";
  const currentFile = argument("--current") ?? "artifacts/v6/evaluation/full-regression.json";
  const outputFile = argument("--output") ?? "artifacts/v6/evaluation/regression-comparison.json";
  const baselineRaw = readFileSync(baselineFile), currentRaw = readFileSync(currentFile);
  const result = { ...compareRegressions(JSON.parse(baselineRaw), JSON.parse(currentRaw)), evidence: {
    baseline: baselineFile, final: currentFile, baselineSha256: createHash("sha256").update(baselineRaw).digest("hex"),
    finalSha256: createHash("sha256").update(currentRaw).digest("hex")
  } };
  writeFileSync(outputFile, JSON.stringify(result, null, 2) + "\n");
  // No approval, release decision, baseline recapture or test-source mutation occurs here.
  console.log(JSON.stringify({ output: outputFile, final: result.final, comparisonComplete: result.comparisonComplete,
    allFailuresMatchBaseline: result.allFailuresMatchBaseline, newFailures: result.newFailures.length,
    overallTestSuitePassed: result.overallTestSuitePassed }));
  if (!result.comparisonComplete || result.newFailures.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
