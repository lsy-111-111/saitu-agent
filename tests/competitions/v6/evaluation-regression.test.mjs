import { test } from "node:test";
import assert from "node:assert/strict";
import { compareRegressions } from "../../../scripts/competitions/v6/evaluate-regression.mjs";

const report = statuses => ({ numTotalTests: statuses.length, numPassedTests: statuses.filter(s => s === "passed").length,
  numFailedTests: statuses.filter(s => s === "failed").length, numPendingTests: statuses.filter(s => s === "pending").length,
  success: !statuses.includes("failed"), testResults: [{ name: "tests/example.test.ts", status: statuses.includes("failed") ? "failed" : "passed",
    assertionResults: statuses.map((status, i) => ({ fullName: `assertion-${i}`, status })) }] });
test("same failure identities remain open even if new passing tests increase totals", () => {
  const value = compareRegressions(report(["failed"]), report(["failed", "passed"]));
  assert.equal(value.allFailuresMatchBaseline, true); assert.equal(value.overallTestSuitePassed, false);
});
test("missing or skipped old failures are not reported as resolved", () => {
  for (const status of [[], ["pending"]]) {
    const value = compareRegressions(report(["failed"]), report(status));
    assert.equal(value.comparisonComplete, false); assert.equal(value.resolvedFailures.length, 0);
  }
});
test("new failure and true resolved failure are separate", () => {
  const value = compareRegressions(report(["failed", "passed"]), report(["passed", "failed"]));
  assert.equal(value.newFailures.length, 1); assert.equal(value.resolvedFailures.length, 1);
  assert.equal(value.allFailuresMatchBaseline, false);
});
test("failed suite without assertion is not silently ignored", () => {
  const current = report(["passed"]); current.testResults.push({ name: "tests/load-error.test.ts", status: "failed", assertionResults: [] });
  const value = compareRegressions(report(["passed"]), current);
  assert.equal(value.comparisonComplete, false); assert.equal(value.overallTestSuitePassed, false);
});
