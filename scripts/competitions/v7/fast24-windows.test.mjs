import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeProductOperation, checkpointInvocation } from "./evaluation-executor.mjs";
import { EVALUATION_POLICY, TOP5_EFFORT_POLICY } from "./evaluation-policy.mjs";

const asOf = "2026-11-09T00:00:00Z", profile = { profileId: "local-profile", revision: "r0", facts: [] };
function modulesFor(chat) {
  return { chat, profileV7: { materializeStructuredProfileV7: value => ({ profile: value, provenance: {} }) },
    model: { buildDecisionContextV7: (_legacy, options) => ({ profile: options.profile, records: [], candidates: [], excluded: new Map(), catalogVersion: "local", now: new Date(asOf) }) },
    requestDeadline: { createCompetitionRequestDeadlines: startedAt => ({ aiDeadlineEpochMs: startedAt + 45_000 }) },
    runContracts: { RECOMMENDATION_DETAIL_DEADLINE_MS: 150_000, RECOMMENDATION_RANK_HARD_TIMEOUT_MS: 60_000,
      RECOMMENDATION_EXECUTION_POLICY: { policyVersion: EVALUATION_POLICY.policyVersion, maxItems: 5, listTargetMs: 40_000,
        rankHardTimeoutMs: 60_000, detailTargetMs: 120_000, detailHardTimeoutMs: 150_000 } },
    effortContext: { currentDecisionEffortPolicy: () => TOP5_EFFORT_POLICY } };
}
const optionsFor = modules => ({ modules, records: [], asOf, invocationId: "local-window-test", deadlineEpochMs: 151_000, submittedAtEpochMs: 1000 });

test("six legal chat requests can span180s while each keeps the actual45s request window; formal default retains its shared deadline", async () => {
  const originalClock = Date.now; let clock = 1000, starts = [], deadlines = [];
  Date.now = () => clock;
  try {
    const modules = modulesFor({ draftDecisionChatV7: async (_state, _text, _items, options) => {
      starts.push(clock); deadlines.push(options.deadlineEpochMs); clock += 30_000;
      if (clock > options.deadlineEpochMs) throw new Error("model_deadline_elapsed");
      return { message: "local response", claims: [] };
    } });
    const item = { caseId: "six-turns", operation: "conversation", input: { profile, turns: Array.from({ length: 6 }, () => ({ text: "local question" })) } }, windows = [];
    const output = await executeProductOperation(item, { ...optionsFor(modules), userActionWindows: true, onActionWindow: value => windows.push(value) });
    assert.equal(output.checkpoints.length, 6); assert.equal(clock, 181_000);
    assert.deepEqual(deadlines.map((deadline, index) => deadline - starts[index]), Array(6).fill(45_000));
    assert.equal(windows.length, 6); assert(windows.every(window => window.kind === "chat"));
    clock = 1000; starts = []; deadlines = [];
    await assert.rejects(executeProductOperation(item, optionsFor(modules)), /model_deadline_elapsed/);
    assert(deadlines.every(deadline => deadline === 151_000));
  } finally { Date.now = originalClock; }
});

test("robustness sides have independent windows without replaying either side", async () => {
  const originalClock = Date.now; let clock = 1000, calls = 0; Date.now = () => clock;
  try {
    const modules = modulesFor({ extractSelfReportedFactsV7: async (_input, options) => {
      calls++; clock += 100_000; if (clock > options.deadlineEpochMs) throw new Error("model_deadline_elapsed"); return { facts: [], unknownFields: [] };
    } });
    const item = { caseId: "two-sides", operation: "robustness", input: { base: { operation: "extract_profile", input: {} }, perturbed: { operation: "extract_profile", input: {} } } }, windows = [];
    const output = await executeProductOperation(item, { ...optionsFor(modules), userActionWindows: true, onActionWindow: value => windows.push(value) });
    assert.equal(calls, 2); assert.equal(output.baseOutcome.status, "observed"); assert.equal(output.perturbedOutcome.status, "observed");
    assert.deepEqual(windows.map(row => row.deadlineEpochMs - row.submittedAtEpochMs), [150_000, 150_000]);
    clock = 1000; calls = 0;
    const shared = await executeProductOperation(item, optionsFor(modules));
    assert.equal(calls, 2); assert.equal(shared.perturbedOutcome.status, "execution_error");
  } finally { Date.now = originalClock; }
});

test("each correction's60/150s ranking window starts at that user action, including extraction time", async () => {
  const originalClock = Date.now, directory = await mkdtemp(path.join(os.tmpdir(), "saitu-fast24-windows-")); let clock = 1000;
  Date.now = () => clock;
  try {
    const rankDeadlines = [], windows = [], modules = modulesFor({ draftDecisionChatV7: async state => {
      clock += 30_000; return { message: "local correction", claims: [], profile: { ...state.profile, revision: `r${clock}` } };
    } });
    modules.model.rankDecisionV7 = async (_context, options) => { rankDeadlines.push(options.deadlineEpochMs); return { recommendations: [], shortfallReason: "local no candidates" }; };
    modules.groups = { generateGroupExplanationV7() {}, reviewPreparedGroupV7() {} };
    modules.groupWorker = { processDetailGroupsV7: async ({ writer }) => writer.update(body => ({ status: "ready", body: { ...body, report: { recommendations: [] } } })) };
    const item = { caseId: "correction-windows", operation: "conversation", input: { profile, rerankAfterUpdates: true,
      turns: [{ text: "first correction" }, { text: "second correction" }] } };
    await checkpointInvocation(directory, { local: "corrections" }, journal => executeProductOperation(item, { ...optionsFor(modules), userActionWindows: true,
      onActionWindow: value => windows.push(value), journal, implementationSha256: "a".repeat(64) }));
    assert.deepEqual(rankDeadlines, [1000 + 60_000 - 750, 31_000 + 60_000 - 750]);
    const recommendations = windows.filter(row => row.kind === "recommendation");
    assert.deepEqual(recommendations.map(row => row.submittedAtEpochMs), [1000, 31_000]);
    assert(recommendations.every(row => row.deadlineEpochMs - row.submittedAtEpochMs === 150_000));
    const journalFile = (await readdir(directory)).find(filename => filename.endsWith(".journal.jsonl"));
    const submissions = (await readFile(path.join(directory, journalFile), "utf8")).trim().split("\n").map(line => JSON.parse(line)).filter(row => row.type === "group_run_submitted");
    assert.deepEqual(submissions.map(row => row.submittedAtEpochMs), [1000, 31_000]);
  } finally { Date.now = originalClock; await rm(directory, { recursive: true, force: true }); }
});
