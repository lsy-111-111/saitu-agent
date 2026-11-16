import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";

// Repository regression harness: the actual current executor and production group
// core run against invented transport responses and real temporary fsync files.
const root = process.cwd();
const sourceLoader = await import(pathToFileURL(path.join(root, "scripts/lib/load-typescript-source.mjs")));
sourceLoader.installSourceLoader(root);
const executor = await import(pathToFileURL(path.join(root, "scripts/competitions/v7/evaluation-executor.mjs")));
const runtime = await import(pathToFileURL(path.join(root, "scripts/competitions/v7/evaluation-runtime.mjs")));
const modules = await executor.loadActualProductModules();
const { student, syntheticRecord } = await import(pathToFileURL(path.join(root, "tests/competitions/v6/decision-fixtures.ts")));
const { expandMatchingTables } = await import(pathToFileURL(path.join(root, "src/lib/competitions/v6/model-match-tables.ts")));
const { expandCandidateEvidence } = await import(pathToFileURL(path.join(root, "src/lib/competitions/v6/model-evidence-pack.ts")));
const { canonicalHash } = await import(pathToFileURL(path.join(root, "scripts/competitions/v7/evaluation-policy.mjs")));
const { effortPolicySha256, decisionRequestSha256 } = await import(pathToFileURL(path.join(root, "src/lib/ai/effort-policy.mjs")));
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("candidate_tests_forbid_all_network"); };
after(() => { globalThis.fetch = originalFetch; });
const records = Array.from({ length: 10 }, (_, index) => syntheticRecord(index + 1));
const binding = { implementationSha256: "e".repeat(64) };
const input = { legacy: student({ weeklyCommitment: "5-10", confirmedFields: ["stage", "weeklyCommitment"] }) };
const baseItem = () => ({ caseId: "public-synthetic-bridge", profileId: "synthetic-profile", input: structuredClone(input) });
const parseJournal = filename => fs.readFileSync(filename, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));

async function harness(item = baseItem(), options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "saitu-group-bridge-")), identity = { synthetic: randomUUID() };
  const journalPath = path.join(directory, `${canonicalHash(identity)}.journal.jsonl`), calls = [];
  let invocationId = options.invocationId ?? randomUUID();
  const ai = { async requestAiJson(prompt, callOptions) {
    const payload = expandCandidateEvidence(expandMatchingTables(JSON.parse(prompt)));
    const stage = callOptions.diagnosticContext?.stage, group = callOptions.diagnosticContext?.reviewId?.match(/detail-v2\.(g[01])/u)?.[1] ?? null;
    const reservationId = randomUUID(), reservedMicros = modules.spend.requestReserveMicros(callOptions.systemPrompt, prompt, callOptions.maxTokens);
    assert.equal(modules.budget.scopedAiReservationLimitMicros(), reservedMicros, "per-call reservation ceiling matches production pricing");
    const call = { prompt, options: callOptions, payload, stage, group, reservationId, reservedMicros, originalsBeforeDispatch: parseJournal(journalPath) };
    calls.push(call);
    await options.beforeRequest?.(call);
    const policySha256 = effortPolicySha256(modules.effortContext.currentDecisionEffortPolicy());
    modules.observer.emitProductObservation("ai_budget_reserved", { reservationId, reservedMicros, phase: "formal", model: "deepseek-flash", effort: callOptions.reasoningEffort, operation: callOptions.operation, effortPolicySha256: policySha256 });
    modules.observer.emitProductObservation("ai_transport_dispatch", { reservationId, model: "deepseek-flash", attempt: 1, operation: callOptions.operation,
      thinkingType: callOptions.thinking, reasoningEffort: callOptions.reasoningEffort, effortPolicySha256: policySha256, ...callOptions.diagnosticContext });
    await new Promise(resolve => setImmediate(resolve));
    const custom = await options.respond?.(call, calls);
    let data;
    if (stage === "v7.rank") data = { profileRevision: payload.profileRevision, catalogVersion: payload.catalogVersion,
      recommendations: payload.candidates.slice(0, 5).map(row => ({ itemId: row.itemId, rationale: "合成流程排序" })), shortfallReason: null };
    else if (stage === "v7.explain") data = { schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: payload.groupBindingSha256, groupId: payload.groupId,
      profileRevision: payload.profileRevision, catalogVersion: payload.catalogVersion, shortfallReason: payload.shortfallReason,
      recommendations: payload.groupSpec.itemIds.map(itemId => {
        const candidate = payload.candidates.find(row => row.itemId === itemId), fact = candidate.facts[0];
        return { itemId, reasons: [{ text: options.critical ? "可以结合该任务尝试一项练习。" : fact.text, basis: options.critical ? "inference" : "official",
          studentFactIds: options.critical ? [payload.profile.facts[0].id] : [], competitionFactIds: [fact.id], conditions: options.critical ? ["合成流程测试，不代表真实模型判断。"] : [] }] };
      }) };
    else if (stage === "v7.review") data = { checks: payload.assertions.map(row => ({ key: row.key, supported: true, reason: "Synthetic transport contract only." })) };
    else throw new Error(`unexpected_synthetic_stage:${stage}`);
    const result = custom ?? { ok: true, data, model: "deepseek-flash", finishReason: "stop", attempts: 1, httpStatus: 200, upstreamAttempted: true,
      durationMs: 1, requestId: `synthetic-${reservationId}`, usage: { inputTokens: 20, outputTokens: 10, cachedInputTokens: 5 } };
    modules.observer.emitProductObservation("ai_budget_settled", { reservationId, chargedMicros: result.usage ? 111 : reservedMicros,
      usage: result.usage ?? null, upstreamAttempted: true, state: result.usage ? "usage_estimated" : "conservative" });
    return result;
  } };
  const actualModules = { ...modules, ai, ...(options.modules ?? {}) };
  const run = async () => executor.checkpointInvocation(directory, identity, journal => executor.executeObservedProduct(item, {
    modules: actualModules, records, asOf: "2026-11-09T00:00:00.000Z", freezeBinding: binding,
    maxHttp: Object.hasOwn(options, "maxHttp") ? options.maxHttp : 20, maxReserveMicros: Object.hasOwn(options, "maxReserveMicros") ? options.maxReserveMicros : 100000000,
    ...(options.executionMode ? { executionMode: options.executionMode } : {}), onCapacityFeedback: options.onCapacityFeedback,
    producerSha256: "a".repeat(64), executionRuntimeConfigurationSha256: "b".repeat(64), algorithm: Object.hasOwn(options, "algorithm") ? options.algorithm : "C", repetition: 0, seed: 6141,
    invocationId, journal, ...(options.effortPolicy ? { effortPolicy: options.effortPolicy } : {}),
  }));
  try {
    const completed = await run(), originals = parseJournal(journalPath);
    const result = { ...completed.value, calls, originals, directory, identity, journalPath, run };
    await options.inspect?.(result);
    return result;
  } catch (error) {
    await options.onFailure?.({ error, directory, identity, journalPath, calls, run });
    throw error;
  } finally { if (!options.keep) await rm(directory, { recursive: true, force: true }); }
}

test("shares the real production worker, preserves global ranks, and aggregates unique originals", async () => {
  const result = await harness(baseItem(), { critical: true });
  assert.equal(result.observation.status, "observed"); assert.equal(result.observation.output.recommendations.length, 5);
  assert.deepEqual(result.observation.output.recommendations.map(row => row.rank), [1, 2, 3, 4, 5]);
  assert.equal(result.calls.length, 3); assert.equal(result.observation.output.trace.callCount, 3);
  assert.equal(result.observation.output.trace.inputTokens, 60); assert.equal(result.observation.output.trace.cachedInputTokens, 15);
  const final = result.observation.groupedRuns[0];
  assert.equal(final.status, "ready"); assert.equal(final.body.legacy, undefined); assert.equal(final.body.context.originalProfile.profileVersion, "competition-profile.v5");
  assert.deepEqual(final.body.detailGroups.groups.map(group => group.spec.globalRanks), [[1, 2, 3, 4, 5]]);
  for (const response of result.responses) {
    const reservations = response.events.filter(row => row.type === "ai_budget_reserved");
    assert.equal(reservations.length, 1); assert.equal(response.events.filter(row => row.type === "ai_transport_dispatch")[0].details.reservationId, reservations[0].details.reservationId);
    assert.equal(response.evidenceType, "actual_ai_json_result_and_transport_reservation_events");
  }
  assert.equal(new Set(result.responses.flatMap(response => response.events.filter(row => row.type === "ai_budget_reserved").map(row => row.details.reservationId))).size, 3);
  const signals = [];
  const unbounded = await harness(baseItem(), { critical: true, executionMode: "user-unbounded", maxHttp: null, maxReserveMicros: null,
    onCapacityFeedback: signal => signals.push(signal) });
  assert.equal(unbounded.observation.status, "observed"); assert.equal(unbounded.calls.length, 3);
  assert.ok(unbounded.responses.every(response => response.executionMode === "user-unbounded" && response.remainingReserve === null));
  assert.equal(signals.filter(signal => signal.healthy).length, 3);
});

test("persists prepared explanation and review request/key map before review dispatch", async () => {
  const result = await harness(baseItem(), { critical: true, beforeRequest(call) {
    if (call.stage !== "v7.review") return;
    const commits = call.originalsBeforeDispatch.filter(row => row.type === "group_run_committed"), state = commits.at(-1).body;
    const group = state.detailGroups.groups.find(row => row.spec.groupId === call.group);
    assert.ok(group.prepared); assert.ok(group.reviewPreparation);
    assert.equal(group.reviewPreparation.call.callKey, `v7.review:detail-v2.${call.group}.initial:1`);
    const intent = call.originalsBeforeDispatch.findLast(row => row.type === "model_call_intent").intent;
    assert.equal(intent.requestSha256, group.reviewPreparation.call.durableRequestSha256);
    assert.equal(group.prepared.preparedSha256, group.reviewPreparation.preparedSha256);
  } });
  assert.equal(result.calls.filter(call => call.stage === "v7.review").length, 1);
  for (const [index, response] of result.responses.entries()) {
    const call = result.calls[index], options = call.options;
    assert.equal(response.options.recommendationPolicyVersion, modules.runContracts.RECOMMENDATION_POLICY_VERSION);
    assert.equal(response.options.implementationVersion, modules.runContracts.RECOMMENDATION_IMPLEMENTATION_VERSION);
    assert.equal(response.requestSha256, decisionRequestSha256({ prompt: call.prompt, system: options.systemPrompt,
      model: options.model, maxTokens: options.maxTokens, promptVersion: options.promptVersion, thinking: options.thinking,
      reasoningEffort: options.reasoningEffort, effortPolicySha256: response.effortPolicySha256,
      recommendationPolicyVersion: options.recommendationPolicyVersion, implementationVersion: options.implementationVersion }));
  }
});

test("keeps the frozen mixed effort policy across all actual grouped stages and original requests", async () => {
  const policy = { version: "saitu.effort-policy.v1", rank: "low", explain: "high", review: "low" };
  const result = await harness(baseItem(), { critical: true, effortPolicy: policy });
  assert.equal(result.observation.status, "observed");
  assert.deepEqual(result.observation.runtime.effortPolicy, policy);
  assert.equal(result.observation.runtime.effortPolicySha256, effortPolicySha256(policy));
  for (const call of result.calls) assert.equal(call.options.reasoningEffort, policy[call.stage.slice(3)]);
  for (const response of result.responses) {
    assert.equal(response.effortPolicySha256, effortPolicySha256(policy));
    assert.equal(response.options.reasoningEffort, policy[response.options.operation.slice("competition_v7_".length)]);
  }
  assert.ok(result.responses.some(response => response.callKey === "v7.rank:effort-v1.initial:1"));
  assert.ok(result.responses.some(response => response.callKey === "v7.review:detail-v2.g0.initial:1"));
});

test("does not pay for a review when all generated claims are reused official facts", async () => {
  const result = await harness();
  assert.equal(result.observation.status, "observed"); assert.equal(result.calls.length, 2);
  assert.equal(result.calls.filter(call => call.stage === "v7.review").length, 0);
  assert.equal(result.observation.output.trace.callCount, 2);
});

test("binds the 40s list target, frozen 60/150 hard clocks and 750 ms dispatch margin", async () => {
  const result = await harness();
  const submitted = result.originals.find(row => row.type === "group_run_submitted");
  assert.equal(submitted.firstListTargetEpochMs - submitted.submittedAtEpochMs, 40000);
  assert.equal(submitted.listDeadlineEpochMs - submitted.submittedAtEpochMs, 60000);
  assert.equal(submitted.detailDeadlineEpochMs - submitted.submittedAtEpochMs, 150000);
  for (const call of result.calls) assert.equal(call.options.deadlineEpochMs, (call.stage === "v7.rank" ? submitted.listDeadlineEpochMs : submitted.detailDeadlineEpochMs) - 750);
  assert.equal(new Set(result.calls.filter(call => call.stage === "v7.explain").map(call => call.options.deadlineEpochMs)).size, 1);
});

test("predebits the Top5 group before await and never overdraws local reserve", async () => {
  const measured = await harness(), cap = measured.calls[0].reservedMicros + measured.calls.find(call => call.group === "g0").reservedMicros - 1;
  const result = await harness(baseItem(), { maxReserveMicros: cap });
  assert.equal(result.calls.length, 1);
  assert.ok(result.calls.reduce((n, call) => n + call.reservedMicros, 0) <= cap);
  assert.equal(result.observation.status, "error");
  assert.equal(result.observation.groupedRuns[0].body.detailGroups.groups.find(group => group.spec.groupId === "g0").error, "spend_budget_exhausted");
  assert.equal(result.observation.execution.budgetExhausted, true);
  assert.equal(result.originals.filter(row => row.type === "model_call_refused").length, 1);
});

test("keeps false Top5 review judgments without repair or replacement", async () => {
  const result = await harness(baseItem(), { critical: true, respond(call) {
    if (call.stage !== "v7.review" || call.group !== "g0") return;
    return { ok: true, data: { checks: call.payload.assertions.map((row, index) => ({ key: row.key, supported: index > 0, reason: index ? "supported synthetic" : "unsupported synthetic" })) },
      model: "deepseek-flash", upstreamAttempted: true, attempts: 1, usage: { inputTokens: 20, outputTokens: 10, cachedInputTokens: 5 } };
  } });
  assert.equal(result.observation.output, null); assert.equal(result.observation.groupedRuns[0].status, "failed");
  const groups = result.observation.groupedRuns[0].body.detailGroups.groups;
  assert.equal(groups[0].reviewed.checks.filter(row => row.supported === false).length, 1); assert.equal(groups.length, 1);
  assert.equal(result.calls.filter(call => call.group === "g0" && call.stage === "v7.review").length, 1);
  assert.equal(result.calls.length, 3); assert.equal(result.responses.find(response => response.callKey === "v7.review:detail-v2.g0.initial:1").result.data.checks[0].supported, false);
});

test("does not redispatch an unknown generation outcome and retains its original reservation", async () => {
  const result = await harness(baseItem(), { respond(call) {
    if (call.group === "g0" && call.stage === "v7.explain") return { ok: false, reason: "network_error", model: "deepseek-flash", upstreamAttempted: true, attempts: 1 };
  } });
  assert.equal(result.calls.filter(call => call.group === "g0").length, 1);
  assert.equal(result.observation.status, "indeterminate");
  const groups = result.observation.groupedRuns[0].body.detailGroups.groups;
  assert.equal(groups[0].error, "network_error"); assert.equal(groups.length, 1);
  assert.ok(result.responses.find(response => response.callKey === "v7.explain:detail-v2.g0.initial:1").events.some(row => row.type === "ai_budget_settled" && row.details.state === "conservative"));
  const signals = [];
  const limited = await harness(baseItem(), { executionMode: "user-unbounded", maxHttp: null, maxReserveMicros: null, onCapacityFeedback: signal => signals.push(signal),
    respond(call) { if (call.stage === "v7.rank") return { ok: false, reason: "rate_limited", httpStatus: 429, retryAfterMs: 12, model: "deepseek-flash", upstreamAttempted: true, attempts: 1 }; } });
  assert.equal(limited.calls.length, 1); assert.equal(limited.responses[0].result.httpStatus, 429);
  assert.ok(signals.some(signal => signal.backpressure && signal.retryAfterMs === 12));
});

test("allows one invalid generation repair with the actual production call namespace", async () => {
  const result = await harness(baseItem(), { respond(call) {
    if (call.group === "g0" && call.stage === "v7.explain" && call.options.diagnosticContext.reviewId.endsWith(".initial")) return { ok: false, reason: "invalid_json", model: "deepseek-flash", upstreamAttempted: true, attempts: 1 };
  } });
  assert.equal(result.observation.status, "observed");
  assert.deepEqual(result.calls.filter(call => call.group === "g0").map(call => call.options.diagnosticContext.reviewId), ["detail-v2.g0.initial", "detail-v2.g0.invalid-output-repair"]);
  assert.equal(result.observation.output.trace.callCount, 3);
});

test("does not repair invalid review output", async () => {
  const result = await harness(baseItem(), { critical: true, respond(call) {
    if (call.group === "g0" && call.stage === "v7.review") return { ok: false, reason: "invalid_json", model: "deepseek-flash", upstreamAttempted: true, attempts: 1 };
  } });
  assert.equal(result.observation.status, "error"); assert.equal(result.calls.filter(call => call.group === "g0" && call.stage === "v7.review").length, 1);
});

test("routes explicit fact plans through the same core without ranking or invented students", async () => {
  const item = { ...baseItem(), operation: "fact_check", input: { ...structuredClone(input), itemIds: [records[0].recordId, records[1].recordId, records[2].recordId] } };
  const result = await harness(item, { algorithm: null });
  assert.equal(result.observation.status, "observed"); assert.equal(result.calls.length, 1); assert.equal(result.calls[0].stage, "v7.explain");
  assert.equal(result.observation.output.recommendations.length, 3); assert.equal(result.observation.groupedRuns.length, 1);
});

test("routes prepared conversation and a correction rerank through distinct bound grouped runs", async () => {
  const item = { ...baseItem(), operation: "conversation", input: { ...structuredClone(input), prepareReport: true, rerankAfterUpdates: true,
    turns: [{ text: "刚才填错了，每周8小时改成3小时" }] } };
  const result = await harness(item, { algorithm: null });
  assert.equal(result.observation.status, "observed"); assert.equal(result.observation.groupedRuns.length, 2);
  assert.notEqual(result.observation.groupedRuns[0].runId, result.observation.groupedRuns[1].runId);
  assert.deepEqual(result.observation.groupedRuns.map(row => row.body.sessionGeneration), [0, 1]);
  assert.equal(result.calls.filter(call => call.stage === "v7.rank").length, 2); assert.equal(result.calls.length, 4);
  assert.equal(result.observation.output.checkpoints[0].report.profile.revision, result.observation.output.profileRevision);
});

test("routes both robustness report sides through the same core and keeps side event ranges", async () => {
  const operation = itemIds => ({ operation: "fact_check", input: { ...structuredClone(input), itemIds } });
  const item = { ...baseItem(), operation: "robustness", input: { base: operation([records[0].recordId]), perturbed: operation([records[1].recordId]) } };
  const result = await harness(item, { algorithm: null });
  assert.equal(result.observation.status, "observed"); assert.equal(result.observation.groupedRuns.length, 2);
  assert.equal(result.observation.output.baseOutcome.status, "observed"); assert.equal(result.observation.output.perturbedOutcome.status, "observed");
  assert.ok(result.observation.output.baseOutcome.eventRange[1] <= result.observation.output.perturbedOutcome.eventRange[0]);
});

test("completed originals replay without new provider calls", async () => {
  await harness(baseItem(), { inspect: async result => {
    const before = result.calls.length, replayed = await result.run();
    assert.equal(replayed.kind, "completed"); assert.equal(result.calls.length, before);
    assert.equal(replayed.value.observation.outputSha256, result.observation.outputSha256);
  } });
});

test("requires a genuine fsynced journal before grouped model work", async () => {
  const context = modules.model.buildDecisionContextV7(student(), { records }); let calls = 0;
  await assert.rejects(executor.executeGroupedReportV7(context, { modules, journal: () => {}, implementationSha256: binding.implementationSha256,
    invocationId: randomUUID(), modelCall: async () => { calls++; throw new Error("must_not_dispatch"); } }), /formal_group_fsync_invocation_journal_required/u);
  assert.equal(calls, 0);
});

async function failSyncFor(predicate, run) {
  const originalWrite = fs.writeSync, originalSync = fs.fsyncSync; let pending;
  fs.writeSync = (...args) => { try { pending = JSON.parse(args[1].toString()); } catch { pending = null; } return originalWrite(...args); };
  fs.fsyncSync = (...args) => { if (predicate(pending)) throw new Error("synthetic_fsync_failure"); return originalSync(...args); };
  syncBuiltinESMExports();
  try { await run(); } finally { fs.writeSync = originalWrite; fs.fsyncSync = originalSync; syncBuiltinESMExports(); }
}

test("a prepared-state fsync failure cannot start review or yield a completed original", async () => {
  let providerReviews = 0;
  await failSyncFor(record => record?.type === "group_run_committed" && record.body.detailGroups?.groups.some(group => group.status === "prepared"), async () => {
    await assert.rejects(harness(baseItem(), { critical: true, beforeRequest: call => { if (call.stage === "v7.review") providerReviews++; } }), /formal_original_persistence_failed/u);
  });
  assert.equal(providerReviews, 0);
});

test("a review-preparation fsync failure cannot invoke the review provider", async () => {
  let providerReviews = 0;
  await failSyncFor(record => record?.type === "group_run_committed" && record.body.detailGroups?.groups.some(group => group.status === "reviewing"), async () => {
    await assert.rejects(harness(baseItem(), { critical: true, beforeRequest: call => { if (call.stage === "v7.review") providerReviews++; } }), /formal_original_persistence_failed/u);
  });
  assert.equal(providerReviews, 0);
});

test("an invocation intent fsync failure prevents provider work and remains indeterminate on resume", async () => {
  let failed = false;
  await failSyncFor(record => { if (record || failed) return false; failed = true; return true; }, async () => {
    await assert.rejects(harness(baseItem(), { onFailure: async state => {
      assert.equal(state.calls.length, 0);
      const replayed = await state.run(); assert.equal(replayed.kind, "indeterminate"); assert.equal(state.calls.length, 0);
      assert.equal((await readdir(state.directory)).some(name => name.endsWith(".json") && !name.endsWith(".intent.json")), false);
    } }), /formal_original_persistence_failed/u);
  });
  assert.equal(failed, true);
});

test("an original model-response fsync failure poisons the journal and cannot be paid again", async () => {
  await failSyncFor(record => record?.type === "model_response", async () => {
    await assert.rejects(harness(baseItem(), { critical: true, onFailure: async state => {
      assert.equal(state.calls.length, 1); assert.equal(state.calls[0].stage, "v7.rank");
      const replayed = await state.run(); assert.equal(replayed.kind, "indeterminate"); assert.equal(state.calls.length, 1);
      assert.equal(parseJournal(state.journalPath).some(row => row.type === "group_run_committed" && row.body.detailGroups?.groups.some(group => group.prepared)), false);
    } }), /formal_original_persistence_failed/u);
  });
});

test("a local model-call intent fsync failure prevents dispatch and cannot resume with another payment", async () => {
  await failSyncFor(record => record?.type === "model_call_intent", async () => {
    await assert.rejects(harness(baseItem(), { onFailure: async state => {
      assert.equal(state.calls.length, 0); assert.equal((await state.run()).kind, "indeterminate"); assert.equal(state.calls.length, 0);
      assert.equal(parseJournal(state.journalPath).some(row => row.type === "model_response"), false);
    } }), /formal_original_persistence_failed/u);
  });
});

test("a 41s ranking remains eligible under the authorized 60s hard timeout and keeps original details clock", async () => {
  const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
  try {
    const result = await harness(baseItem(), { beforeRequest(call) { if (call.stage === "v7.rank") now += 41000; } });
    assert.equal(result.calls.length, 2); assert.equal(result.observation.status, "observed");
    const submitted = result.originals.find(row => row.type === "group_run_submitted");
    assert.equal(result.observation.elapsedMs, 41000);
    assert.ok(result.observation.elapsedMs > submitted.firstListTargetEpochMs - submitted.submittedAtEpochMs);
    assert.ok(result.calls.filter(call => call.stage === "v7.explain").every(call => call.options.deadlineEpochMs === submitted.submittedAtEpochMs + 150000 - 750));
  } finally { Date.now = originalNow; }
});

test("a consumed 60s ranking window cannot create a fresh detail/group clock", async () => {
  const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
  try {
    const result = await harness(baseItem(), { beforeRequest(call) { if (call.stage === "v7.rank") now += 61000; } });
    assert.equal(result.calls.length, 1); assert.equal(result.observation.error, "LIST_DEADLINE_EXCEEDED");
    assert.equal(result.observation.groupedRuns[0].body.detailGroups, undefined); assert.equal(result.observation.groupedRuns[0].status, "failed");
  } finally { Date.now = originalNow; }
});

test("canonical profile reports never invent a legacy identity or session", async () => {
  const canonical = modules.profileV7.createStudentProfileV7(student(), { profileId: "public-canonical-only" });
  const result = await harness({ ...baseItem(), input: { profile: canonical } });
  assert.equal(result.observation.status, "observed");
  const body = result.observation.groupedRuns[0].body;
  assert.equal(body.legacy, undefined); assert.equal(body.context.originalProfile, undefined); assert.equal(body.sessionId, undefined);
  assert.equal(body.context.profile.profileId, canonical.profileId);
});

test("runtime behavior binds grouped sources, full dependencies and hard/effective governor caps", () => {
  const config = runtime.runtimeBehaviorConfiguration({ AI_PROVIDER: "deepseek", AI_CONCURRENCY_MAX: "999", SAITU_V7_WORKER_CONCURRENCY: "2" });
  assert.equal(config.governor.transportConcurrencyHardMax, 2); assert.equal(config.governor.transportConcurrencyEffectiveMax, 2);
  assert.equal(config.governor.transportConcurrencyConfiguredMax, 999);
  assert.equal(config.promptVersions.groupExplanation, modules.groups.EXPLANATION_GROUP_PROMPT_VERSION_V7);
  assert.equal(config.limits.firstListDeadlineMs, 40000); assert.equal(config.limits.rankHardDeadlineMs, 60000); assert.equal(config.limits.allDetailsDeadlineMs, 150000);
  for (const member of ["src/lib/competitions/v7/explanation-groups.ts", "src/lib/competitions/v7/group-contracts.ts", "src/lib/competitions/v7/group-state.ts", "src/lib/competitions/v7/group-worker.ts",
    "src/lib/competitions/v7/review-transport.ts", "src/lib/ai/durable-call.ts", "src/lib/ai/model-call-governor.ts", "src/lib/ai/spend-run-context.ts", "src/lib/ai/spend-ledger.ts",
    "scripts/competitions/v7/evaluation-executor.mjs", "scripts/competitions/v7/evaluation-runtime.mjs", "pnpm-lock.yaml"]) assert.ok(config.behaviorSourceBindings.some(row => row.path === member), member);
  assert.equal(runtime.runtimeBehaviorConfiguration({ AI_CONCURRENCY_MAX: "1" }).governor.transportConcurrencyEffectiveMax, 1);
});
