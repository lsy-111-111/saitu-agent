import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { RANK_NON_THINKING_EFFORT_POLICY as effortPolicy } from "../../../src/lib/ai/effort-policy.mjs";
import { checkpointInvocation, executeGroupedReportV7 } from "../../../scripts/competitions/v7/evaluation-executor.mjs";
import { canonicalHash } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { installSourceLoader } from "../../../scripts/lib/load-typescript-source.mjs";

installSourceLoader();
const { RECOMMENDATION_EXECUTION_POLICY } = await import("../../../src/lib/competitions/v7/contracts.ts");
const diagnostic = {
  stage: "v7.audit", kind: "validation",
  data: { source: "rank_diagnostics", callKey: "rank:fixture", requestSha256: "a".repeat(64), status: "valid" },
};
const audit = { stage: "v7.audit", kind: "validation", data: { source: "explanation_sample" } };
const rankResponse = { stage: "v7.rank", kind: "response", data: { ok: true } };
const report = { fixture: "ready" };

async function fixture(t, rankDiagnostic) {
  const directory = await mkdtemp(path.join(tmpdir(), "saitu-formal-rank-diagnostic-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const identity = { fixture: "rank-diagnostics" };
  const journalPath = path.join(directory, canonicalHash(identity) + ".journal.jsonl");
  const context = { now: new Date("2026-11-11T00:00:00Z"), excluded: new Map(), candidates: [{
    record: { recordId: "fixture-record", seriesId: "fixture-series", name: "Fixture", track: { name: "Fixture track" }, edition: "2026" },
  }] };
  const counts = { rank: 0, detail: 0 };
  const commits = [];
  const unexpectedModelCall = () => assert.fail("Fixture may not call a provider");
  const modules = {
    effortContext: { currentDecisionEffortPolicy: () => effortPolicy },
    runContracts: { RECOMMENDATION_EXECUTION_POLICY },
    model: { async rankDecisionV7(_context, { onObservation }) {
      counts.rank++;
      await onObservation(rankResponse);
      if (rankDiagnostic) {
        await onObservation(rankDiagnostic);
        await onObservation(rankDiagnostic);
      }
      await onObservation(audit);
      return { recommendations: [{ itemId: "fixture-record" }], shortfallReason: "One fixture recommendation." };
    } },
    groupWorker: { async processDetailGroupsV7({ writer }) {
      counts.detail++;
      await writer.update(body => ({ status: "ready", body: { ...body, report } }));
    } },
    groups: { generateGroupExplanationV7: unexpectedModelCall, reviewPreparedGroupV7: unexpectedModelCall },
  };
  const run = () => checkpointInvocation(directory, identity, journal => executeGroupedReportV7(context, {
    modules, journal, modelCall: unexpectedModelCall, effortPolicy,
    implementationSha256: "e".repeat(64), invocationId: "rank-diagnostics-fixture",
    onGroupCommit: commit => commits.push(commit),
  }));
  const journal = async () => (await readFile(journalPath, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
  return { run, journal, journalPath, directory, counts, commits };
}

async function failJournalSyncFor(predicate, run) {
  const originalWrite = fs.writeSync, originalSync = fs.fsyncSync;
  let pending, attemptedFailures = 0;
  fs.writeSync = (...args) => {
    try { pending = JSON.parse(args[1].toString()); } catch { pending = undefined; }
    return originalWrite(...args);
  };
  fs.fsyncSync = (...args) => {
    if (predicate(pending)) {
      attemptedFailures++;
      throw new Error("fixture_journal_fsync_failed");
    }
    return originalSync(...args);
  };
  syncBuiltinESMExports();
  try { await run(); } finally {
    fs.writeSync = originalWrite;
    fs.fsyncSync = originalSync;
    syncBuiltinESMExports();
  }
  return attemptedFailures;
}

test("rank diagnostics use the existing private list commit and create no standalone writes", async t => {
  const baseline = await fixture(t);
  const observed = await fixture(t, diagnostic);
  assert.deepEqual((await baseline.run()).value, report);
  const failureAttempts = await failJournalSyncFor(record =>
    (record?.type === "model_business_observation" && record.event?.data?.source === "rank_diagnostics") ||
    (record?.type === "group_run_committed" && record.status === "ranking" &&
      record.body.auditObservations?.some(event => event.data.source === "rank_diagnostics")),
  async () => assert.deepEqual((await observed.run()).value, report));
  assert.equal(failureAttempts, 0);
  assert.deepEqual(observed.counts, { rank: 1, detail: 1 });
  assert.deepEqual(observed.counts, baseline.counts);
  assert.deepEqual(observed.commits.map(({ status, resultVersion }) => [status, resultVersion]),
    baseline.commits.map(({ status, resultVersion }) => [status, resultVersion]));
  assert.deepEqual(observed.commits.map(row => row.status), ["ranking", "ranking", "list_ready", "ready"]);

  const originals = await observed.journal();
  assert.deepEqual(originals.filter(row => row.type === "model_business_observation").map(row => row.event), [rankResponse, audit]);
  const list = originals.find(row => row.type === "group_run_committed" && row.status === "list_ready");
  assert.deepEqual(list.body.auditObservations, [audit, diagnostic]);
  assert.equal((await stat(observed.journalPath)).mode & 0o777, 0o600);
  assert.deepEqual((await observed.run()).value, report);
  assert.deepEqual(observed.counts, { rank: 1, detail: 1 });
});

test("an unserializable optional rank diagnostic leaves ordinary audit and list readiness intact", async t => {
  const malformed = structuredClone(diagnostic);
  malformed.data.invalid = malformed.data;
  const observed = await fixture(t, malformed);
  assert.deepEqual((await observed.run()).value, report);
  assert.deepEqual(observed.commits.find(row => row.status === "list_ready").body.auditObservations, [audit]);
  assert.deepEqual(observed.counts, { rank: 1, detail: 1 });
});

for (const [name, predicate] of [
  ["ordinary audit journal", record => record?.type === "model_business_observation" && record.event?.data?.source === audit.data.source],
  ["ordinary audit commit", record => record?.type === "group_run_committed" && record.status === "ranking" && record.body.auditObservations?.length],
  ["list-ready commit carrying diagnostics", record => record?.type === "group_run_committed" && record.status === "list_ready" &&
    record.body.auditObservations?.some(event => event.data.source === "rank_diagnostics")],
]) {
  test(`a failed ${name} remains fatal and does not redispatch on resume`, async t => {
    const observed = await fixture(t, diagnostic);
    const failureAttempts = await failJournalSyncFor(predicate, () =>
      assert.rejects(observed.run(), { name: "FormalOriginalPersistenceError", message: "formal_original_persistence_failed" }));
    assert.equal(failureAttempts, 1);
    assert.deepEqual(observed.counts, { rank: 1, detail: 0 });
    assert.equal((await observed.run()).kind, "indeterminate");
    assert.deepEqual(observed.counts, { rank: 1, detail: 0 });
    assert.equal((await readdir(observed.directory)).some(name => name.endsWith(".json") && !name.endsWith(".intent.json")), false);
  });
}
