import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, constants, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";
import { mkdir, readFile, writeFile, lstat, readdir, rename, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveRunSeed, seededShuffle } from "../v6/frozen-ranking-executor.mjs";
import { runtimeConfigurationHash } from "../v6/runtime-configuration.mjs";
import { POLICY_VERSION, POLICY_SHA256, EVALUATION_POLICY, canonicalHash, byteHash, same, requirePolicy, assertQuotas, assertRankingGroups,
  readBoundBytes, writeNewJson } from "./evaluation-policy.mjs";
import { readImplementationManifest, validateRegistrationConfig, verifyImplementationManifest } from "./evaluation-registration.mjs";
import { runtimeBehaviorConfigurationHash, validateExecutionScope } from "./evaluation-runtime.mjs";
import { createRankingSlots } from "./evaluation-matrix.mjs";
import { validateFrozenMatrix } from "./evaluation-reuse.mjs";
import { evaluationRuntimeForEffort, parseEffortPolicy, readConfiguredEffortPolicy, effortPolicySha256,
  requireTop5EvaluationRuntime, effortPolicyForScope, assertSameEffortPolicy, resolveDecisionModelSettingsForOperation, assertDispatchEffort, rankNonThinkingContinuationForScope } from "./evaluation-effort.mjs";
import { verifyRankNonThinkingContinuationScope } from "./rank-nonthinking-pilot-proof.mjs";
import { decisionRequestSha256 } from "../../../src/lib/ai/effort-policy.mjs";
import { USER_UNBOUNDED_EXECUTION_MODE, USER_UNBOUNDED_EXECUTION_LIMITS, readExecutionMode, RANK_NONTHINKING_AUTHORIZATION_POLICY } from "../../../src/lib/ai/execution-policy.mjs";
import { runAdaptiveSlotQueue } from "../../lib/adaptive-execution.mjs";
import { readConfiguredDetailLayoutV7 } from "../../../src/lib/competitions/v7/detail-layout.mjs";

export const EXECUTOR_VERSION = "saitu.actual-product-executor.v7.4.top5.execution-mode";
export const PRODUCT_OPERATIONS = Object.freeze(["constraint_check", "fact_check", "extract_profile", "conversation", "robustness"]);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const executorPath = "scripts/competitions/v7/evaluation-executor.mjs";
const plain = value => JSON.parse(JSON.stringify(value));
const existing = filename => lstat(filename).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
const invocationJournals = new WeakMap();
const terminalRunStatuses = new Set(["ready", "failed", "expired"]);
const epoch = value => { if (!Number.isSafeInteger(value) || value < 1) throw new Error("formal_original_run_clock_required"); return value; };
function syncFile(filename) { const fd = openSync(filename, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
function persistenceFailure(cause) { const error = new Error("formal_original_persistence_failed", { cause }); error.name = "FormalOriginalPersistenceError"; return error; }
function readInvocationJournal(journal) {
  const state = invocationJournals.get(journal);
  if (!state) throw new Error("formal_group_fsync_invocation_journal_required");
  if (state.failure) throw state.failure;
  try { return readFileSync(state.filename, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { state.failure = persistenceFailure(error); throw state.failure; }
}
function appendDurableJournal(filename) {
  try { const fd = openSync(filename, "ax", 0o600); try { fsyncSync(fd); } finally { closeSync(fd); } syncFile(path.dirname(filename)); }
  catch (error) { throw persistenceFailure(error); }
  const state = { filename, failure: null };
  const journal = record => {
    if (state.failure) throw state.failure;
    try {
      const bytes = Buffer.from(JSON.stringify(record) + "\n"), fd = openSync(filename, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
      try { let offset = 0; while (offset < bytes.length) { const count = writeSync(fd, bytes, offset); if (!count) throw new Error("formal_journal_zero_byte_write"); offset += count; } fsyncSync(fd); }
      finally { closeSync(fd); }
    } catch (error) { state.failure = persistenceFailure(error); throw state.failure; }
  };
  invocationJournals.set(journal, state);
  return journal;
}

/** The production modules are loaded unchanged; no alternative scoring/chat implementation is used. */
export async function loadActualProductModules() {
  const { installSourceLoader } = await import("../../lib/load-typescript-source.mjs"); installSourceLoader();
  const [model, baseline, chat, canonical, profile, contracts, legacySchema, catalog, observer, ai, budget, database, evidence, profileV7, groups, groupWorker, spend, runContracts, effortContext, requestDeadline, durable] = await Promise.all([
    import("../../../src/lib/competitions/v7/model.ts"), import("../../../src/lib/competitions/v7/baseline.ts"),
    import("../../../src/lib/competitions/v7/chat.ts"), import("../../../src/lib/competitions/v6/canonical-adapter.ts"),
    import("../../../src/lib/competitions/v6/profile.ts"), import("../../../src/lib/competitions/v6/contracts.ts"),
    import("../../../src/lib/ai/competition-request-schema.ts"), import("../../../src/lib/competitions/v7/catalog.ts"),
    import("../../../src/lib/ai/product-observation.ts"), import("../../../src/lib/ai/ai-client.ts"),
    import("../../../src/lib/ai/spend-run-context.ts"), import("../../../src/lib/db/pool.ts"), import("../../../src/lib/competitions/v6/evidence.ts"), import("../../../src/lib/competitions/v7/profile.ts"),
    import("../../../src/lib/competitions/v7/explanation-groups.ts"), import("../../../src/lib/competitions/v7/group-worker.ts"),
    import("../../../src/lib/ai/spend-ledger.ts"),
    import("../../../src/lib/competitions/v7/contracts.ts"),
    import("../../../src/lib/ai/effort-context.ts"),
    import("../../../src/lib/ai/request-deadline.ts"),
    import("../../../src/lib/ai/durable-call.ts"),
  ]);
  return { model, baseline, chat, canonical, profile, contracts, legacySchema, catalog, observer, ai, budget, database, evidence, profileV7, groups, groupWorker, spend, runContracts, effortContext, requestDeadline, durable };
}
function contextFor(input, modules, records, asOf, profileId, submission = {}) {
  if (input.profile) {
    const materialized = modules.profileV7.materializeStructuredProfileV7(input.profile, { kind: "explicit_canonical_submission",
      inputSha256: canonicalHash(submission.envelope ?? input), profilePointer: submission.profilePointer ?? "/profile" });
    const context = modules.model.buildDecisionContextV7(undefined, { records, now: new Date(asOf), profileId, profile: materialized.profile });
    submission.onCompatibility?.({ adapter: "materializeStructuredProfileV7", provenance: materialized.provenance });
    return context;
  }
  const legacy = modules.legacySchema.competitionRecommendationProfileV5Schema.parse(input.legacy);
  return modules.model.buildDecisionContextV7(legacy, { records, now: new Date(asOf), profileId });
}
const contextOutput = context => ({ profile: context.profile, profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
  candidateItemIds: context.candidates.map(row => row.record.recordId),
  candidateNotices: context.candidates.map(row => ({ itemId: row.record.recordId,
    conditions: row.conditions.filter(condition => /^(参赛提醒|预算提醒|任务边界)：/.test(condition)) })),
  excluded: [...context.excluded].map(([itemId, reason]) => ({ itemId, reason })) });
function explicitFactPlan(context, itemIds, modules) {
  if (!Array.isArray(itemIds) || !itemIds.length || itemIds.length > 3 || new Set(itemIds).size !== itemIds.length) throw new Error("fact_check_requires_one_to_three_explicit_catalog_items");
  return { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, recommendations: itemIds.map(itemId => {
    const candidate = context.candidates.find(row => row.record.recordId === itemId);
    if (!candidate) throw new Error("fact_check_target_outside_actual_v7_context");
    const fact = candidate.record.facts.find(row => ["task", "track", "deliverables"].includes(row.field) && row.kind === "official_fact" && modules.evidence.isDecisionEvidenceFact(candidate.record, row));
    if (!fact) throw new Error("fact_check_target_has_no_official_core_fact");
    return { itemId, reasons: [{ text: fact.text, basis: "official", studentFactIds: [], competitionFactIds: [fact.id], conditions: [] }] };
  }), shortfallReason: "本项事实核验只解释题目指定的候选，不比较或补齐其他候选。" };
}

/** The local original is AiJsonResult + real transport/reservation/settlement
 * metadata. It is not a production PostgreSQL durable provider receipt. */
function originalGroupCalls(journal, runId) {
  const records = readInvocationJournal(journal), intents = new Map(), responses = new Map();
  for (const record of records) {
    const value = record.intent ?? record.response;
    if (value?.runId !== runId) continue;
    const index = record.type === "model_call_intent" ? intents : record.type === "model_response" ? responses : null;
    if (!index) continue;
    if (index.has(value.callId)) throw new Error("duplicate_formal_original_call_record");
    index.set(value.callId, value);
  }
  if (responses.size !== intents.size) throw new Error("formal_original_call_incomplete_or_changed");
  return [...intents.values()].map(intent => {
    const response = responses.get(intent.callId);
    if (!response || response.callKey !== intent.callKey || response.requestSha256 !== intent.requestSha256) throw new Error("formal_original_call_incomplete_or_changed");
    const events = response.events, reservations = events.filter(row => row.type === "ai_budget_reserved"), dispatches = events.filter(row => row.type === "ai_transport_dispatch");
    if (reservations.length > 1 || dispatches.length > 1) throw new Error("formal_one_attempt_originals_required");
    const reservationId = reservations[0]?.details.reservationId ?? null, upstreamAttempted = dispatches.length === 1;
    if (Boolean(response.result.upstreamAttempted) !== upstreamAttempted || upstreamAttempted && (!reservationId || dispatches[0].details.reservationId !== reservationId)) throw new Error("formal_original_transport_binding_missing");
    const settlements = events.filter(row => row.type === "ai_budget_settled");
    if (settlements.length > 1 || settlements.some(row => row.details.reservationId !== reservationId)) throw new Error("formal_original_settlement_binding_changed");
    const usage = upstreamAttempted ? settlements[0]?.details.usage ?? null : null;
    if (usage && response.result.usage && !same(usage, response.result.usage)) throw new Error("formal_original_usage_changed");
    return { runId, callId: intent.callId, callKey: intent.callKey, reservationId, upstreamAttempted, usage,
      operation: intent.options.operation, reasoningEffort: intent.options.reasoningEffort, effortPolicySha256: intent.effortPolicySha256,
      ...(intent.options.thinking === "disabled" ? { thinking: "disabled", policyReasoningEffort: intent.options.reasoningEffort,
        wireReasoningEffort: null, temperature: intent.options.temperature, topP: intent.options.topP } : {}) };
  });
}

/** I/O adapter only. Business transitions and acknowledgements remain in the
 * unchanged production group worker. Every resolved update has been fsynced. */
function createFormalGroupWriter(claim, journal, onCommit) {
  readInvocationJournal(journal);
  let tail = Promise.resolve(), storageError, poisoned = false, terminal = false;
  return {
    update(change) {
      const next = tail.then(() => {
        if (poisoned) throw storageError;
        if (terminal) throw new Error("DECISION_RUN_ALREADY_TERMINAL");
        const patch = change(claim.body, claim.row.status); if (!patch) return;
        if (patch.body.implementationSha256 !== claim.body.implementationSha256 || patch.body.sessionGeneration !== claim.body.sessionGeneration ||
            patch.body.detailLayout !== claim.body.detailLayout || !same(patch.body.effortPolicy,claim.body.effortPolicy) || patch.body.effortPolicySha256 !== claim.body.effortPolicySha256 ||
            !same(patch.body.context, claim.body.context)) throw new Error("DECISION_RUN_BINDING_CHANGED");
        const resultVersion = claim.row.result_version + 1, body = plain(patch.body);
        try { journal({ type: "group_run_committed", schemaVersion: "saitu.formal-group-state-commit.v1", runId: claim.row.run_id,
          previousResultVersion: claim.row.result_version, resultVersion, status: patch.status, body, committedAt: new Date().toISOString() }); }
        catch (error) { storageError = error; poisoned = true; throw error; }
        claim.body = body; claim.row = { ...claim.row, status: patch.status, result_version: resultVersion };
        terminal = terminalRunStatuses.has(patch.status);
        onCommit?.({ runId: claim.row.run_id, resultVersion, status: patch.status, body: plain(body) });
      });
      tail = next.catch(() => {}); return next;
    },
    async flush() { await tail; if (poisoned) throw storageError; },
  };
}

/** One actual production grouped-core report lifecycle. No PG session, legacy
 * identity or lease is invented; only the worker's local structural port is used. */
export async function executeGroupedReportV7(context, { modules, plan, modelCall, journal, implementationSha256, invocationId,
  submittedAtEpochMs = Date.now(), deadlineEpochMs, generation = 0, onGroupCommit, operation = "recommend",
  effortPolicy = modules.effortContext.currentDecisionEffortPolicy() }) {
  readInvocationJournal(journal);
  effortPolicy = parseEffortPolicy(effortPolicy);
  assertSameEffortPolicy(modules.effortContext.currentDecisionEffortPolicy(), effortPolicy);
  if (!/^[a-f0-9]{64}$/.test(implementationSha256 ?? "")) throw new Error("formal_group_implementation_binding_required");
  if (!modules.groupWorker?.processDetailGroupsV7 || !modules.groups?.generateGroupExplanationV7 || !modules.groups?.reviewPreparedGroupV7) throw new Error("actual_production_group_core_required");
  const executionPolicy = modules.runContracts?.RECOMMENDATION_EXECUTION_POLICY;
  if (!executionPolicy || executionPolicy.policyVersion !== POLICY_VERSION || executionPolicy.maxItems !== EVALUATION_POLICY.recommendationMaxItems ||
      executionPolicy.listTargetMs !== EVALUATION_POLICY.performance.firstListP95Ms || executionPolicy.rankHardTimeoutMs !== EVALUATION_POLICY.performance.rankHardTimeoutMs ||
      executionPolicy.detailTargetMs !== EVALUATION_POLICY.performance.allDetailsP95Ms || executionPolicy.detailHardTimeoutMs !== EVALUATION_POLICY.performance.detailHardTimeoutMs)
    throw new Error("actual_production_top5_execution_contract_required");
  const submitted = epoch(submittedAtEpochMs), detailDeadline = Math.min(epoch(deadlineEpochMs ?? submitted + executionPolicy.detailHardTimeoutMs), submitted + executionPolicy.detailHardTimeoutMs),
    listDeadline = Math.min(detailDeadline, submitted + executionPolicy.rankHardTimeoutMs);
  const runId = randomUUID(), controller = new AbortController();
  const claim = { row: { run_id: runId, state_key: `formal:${invocationId}`, status: "queued", result_version: 0,
    submitted_at: new Date(submitted), list_deadline_at: new Date(listDeadline), detail_deadline_at: new Date(detailDeadline) },
    body: { implementationSha256, executionPolicy: plain(executionPolicy), sessionGeneration: generation, effortPolicy, effortPolicySha256: effortPolicySha256(effortPolicy),detailLayout:readConfiguredDetailLayoutV7(),
      context: plain({ ...context, now: context.now.toISOString(), excluded: [...context.excluded] }), items: [], listReadyAt: null, detailsReadyAt: null, shortfallReason: null } };
  journal({ type: "group_run_submitted", schemaVersion: "saitu.formal-group-run.v1", runId, parentInvocationId: invocationId, operation,
    submittedAtEpochMs: submitted, firstListTargetEpochMs: submitted + executionPolicy.listTargetMs, listDeadlineEpochMs: listDeadline,
    detailTargetEpochMs: submitted + executionPolicy.detailTargetMs, detailDeadlineEpochMs: detailDeadline, body: claim.body });
  const writer = createFormalGroupWriter(claim, journal, onGroupCommit);
  let rankDiagnostic;
  const onObservation = async event => {
    if (event.stage === "v7.audit" && event.kind === "validation" && event.data?.source === "rank_diagnostics") {
      // This optional observation shares the private list-ready journal commit.
      // A separate append could poison the journal before the list is ready.
      try { rankDiagnostic = plain(event); } catch { /* Ignore only malformed optional diagnostics. */ }
      return;
    }
    journal({ type: "model_business_observation", runId, event: plain(event) });
    if (event.stage !== "v7.audit") return;
    await writer.update((body, status) => {
      const previous = body.auditObservations ?? [];
      if (previous.some(row => same(row, event))) return null;
      return { status, body: { ...body, auditObservations: [...previous, plain(event)] } };
    });
  };
  try {
    if (!plan) {
      if (Date.now() >= listDeadline) throw new Error("LIST_DEADLINE_EXCEEDED");
      await writer.update(body => ({ status: "ranking", body }));
      plan = await modules.model.rankDecisionV7(context, { requestId: runId, modelCall, deadlineEpochMs: listDeadline - 750, onObservation });
      if (Date.now() >= listDeadline) throw new Error("LIST_DEADLINE_EXCEEDED");
    }
    if (plan.recommendations.length > executionPolicy.maxItems || plan.recommendations.length < executionPolicy.maxItems && !plan.shortfallReason?.trim()) throw new Error("INVALID_RANKING_ITEM_COUNT");
    const series = new Set();
    const items = plan.recommendations.map((chosen, index) => {
      const candidate = context.candidates.find(row => row.record.recordId === chosen.itemId);
      if (!candidate || series.has(candidate.record.seriesId)) throw new Error("INVALID_RANKING_IDENTITY");
      const record = candidate.record; series.add(record.seriesId);
      return { rank: index + 1, itemId: record.recordId, seriesId: record.seriesId, name: record.name, trackLabel: record.track.name, edition: record.edition,
        officialUrl: modules.catalog?.getOfficialEntry?.(record)?.url ?? null, detailStatus: "pending" };
    });
    await writer.update(body => {
      const auditObservations = body.auditObservations ?? [];
      const addDiagnostic = rankDiagnostic && !auditObservations.some(event => same(event, rankDiagnostic));
      return { status: "list_ready", body: { ...body, plan: plain(plan), items, listReadyAt: new Date().toISOString(), shortfallReason: plan.shortfallReason,
        ...(addDiagnostic ? { auditObservations: [...auditObservations, rankDiagnostic] } : {}) } };
    });
    await modules.groupWorker.processDetailGroupsV7({ claim, writer, context, plan, controller, onObservation,
      models: { generate: (ctx, fullPlan, spec, options) => modules.groups.generateGroupExplanationV7(ctx, fullPlan, spec, { ...options, modelCall }),
        review: (ctx, fullPlan, prepared, options) => modules.groups.reviewPreparedGroupV7(ctx, fullPlan, prepared, { ...options, modelCall }) },
      readJournal: async id => originalGroupCalls(journal, id) });
    await writer.flush();
    if (claim.row.status !== "ready" || !claim.body.report) {
      const failure = new Error(claim.body.error ?? "DETAIL_GROUP_FAILED");
      failure.groupedOutcomeUnknown = (claim.body.detailGroups?.groups ?? []).some(group => /timeout|network|durable_outcome_unknown|aborted/u.test(group.error ?? ""));
      throw failure;
    }
    return claim.body.report;
  } catch (failure) {
    if (!terminalRunStatuses.has(claim.row.status)) await writer.update(body => ({ status: "failed", body: { ...body,
      error: failure instanceof Error ? failure.message : "FORMAL_GROUP_RUN_FAILED", detailsReadyAt: null,
      items: body.items.map(item => item.detailStatus === "ready" ? item : { ...item, detailStatus: "failed" }) } }));
    throw failure;
  } finally {
    await writer.flush();
    journal({ type: "group_run_finished", runId, resultVersion: claim.row.result_version, status: claim.row.status, body: plain(claim.body) });
  }
}

/** Public operation surface supplied to the fresh input author. No arbitrary hook/URL/code is accepted. */
export async function executeProductOperation(item, { modules, records, asOf, modelCall, invocationId, deadlineEpochMs, depth = 0, submissionEnvelope, profilePointer = "/profile", onCompatibility, eventPosition = () => 0,
  journal, implementationSha256, submittedAtEpochMs = Date.now(), onGroupCommit, userActionWindows = false, onActionWindow }) {
  const input = item.input, options = { requestId: invocationId, modelCall, deadlineEpochMs };
  if (!PRODUCT_OPERATIONS.includes(item.operation)) throw new Error("unsupported_actual_v7_product_operation");
  if (item.operation === "extract_profile") return modules.chat.extractSelfReportedFactsV7(input, options);
  if (item.operation === "robustness") {
    if (depth || !input.base || !input.perturbed || [input.base, input.perturbed].some(row => row.operation === "robustness" || !PRODUCT_OPERATIONS.includes(row.operation))) throw new Error("robustness_requires_two_explicit_supported_nonrecursive_operations");
    const common = { modules, records, asOf, modelCall, deadlineEpochMs, depth: 1, submissionEnvelope: submissionEnvelope ?? input, onCompatibility, eventPosition,
      journal, implementationSha256, submittedAtEpochMs, onGroupCommit, userActionWindows, onActionWindow };
    const side = async (name, operation) => {
      const sideSubmittedAt = Date.now(), startedAt = new Date(sideSubmittedAt).toISOString(), eventStart = eventPosition();
      const sideWindow = userActionWindows ? { submittedAtEpochMs: sideSubmittedAt, deadlineEpochMs: sideSubmittedAt + modules.runContracts.RECOMMENDATION_DETAIL_DEADLINE_MS } : {};
      if (userActionWindows) onActionWindow?.({ actionId: `${invocationId}:${name}`, kind: "robustness_side", operation: operation.operation, ...sideWindow });
      try {
        const output = await executeProductOperation(operation, { ...common, ...sideWindow, invocationId: `${invocationId}:${name}`, profilePointer: `/${name}/input/profile` });
        return { status: "observed", output, error: null, productError: output?.error ?? null, explicitInputRejection: false, startedAt, completedAt: new Date().toISOString(), eventRange: [eventStart, eventPosition()] };
      } catch (failure) {
        if (failure?.name === "FormalOriginalPersistenceError") throw failure;
        const error = failure instanceof Error ? failure.message : "execution_failed", explicitInputRejection = failure?.name === "ZodError" || /^(?:invalid_extraction_input|invalid_chat_input|fact_check_requires_|conversation_requires_)/.test(error);
        return { status: explicitInputRejection ? "input_rejected" : failure?.groupedOutcomeUnknown ? "indeterminate" : "execution_error", output: null, error, explicitInputRejection,
          startedAt, completedAt: new Date().toISOString(), eventRange: [eventStart, eventPosition()] };
      }
    };
    const base = await side("base", input.base), perturbed = await side("perturbed", input.perturbed);
    return { baseResult: base.output, perturbedResult: perturbed.output, baseOutcome: base, perturbedOutcome: perturbed };
  }
  let context = contextFor(input, modules, records, asOf, item.caseId, { envelope: submissionEnvelope ?? input, profilePointer, onCompatibility });
  if (item.operation === "constraint_check") return contextOutput(context);
  const reportOptions = { modules, modelCall, journal, implementationSha256, invocationId, deadlineEpochMs, submittedAtEpochMs, onGroupCommit };
  if (item.operation === "fact_check") return executeGroupedReportV7(context, { ...reportOptions, plan: explicitFactPlan(context, input.itemIds, modules), operation: "fact_check" });
  if (!Array.isArray(input.turns) || !input.turns.length || input.turns.length > 12 || input.turns.some(row => typeof row.text !== "string" || !row.text.trim() || row.text.length > 1600)) throw new Error("conversation_requires_one_to_twelve_actual_chat_turns");
  let report = null, legacy = context.originalProfile;
  let generation = 0;
  if (input.prepareReport === true) {
    if (userActionWindows) onActionWindow?.({ actionId: `${invocationId}:prepare`, kind: "recommendation", submittedAtEpochMs,
      rankDeadlineEpochMs: submittedAtEpochMs + modules.runContracts.RECOMMENDATION_RANK_HARD_TIMEOUT_MS, deadlineEpochMs });
    report = await executeGroupedReportV7(context, { ...reportOptions, operation: "conversation_prepare" });
  }
  const checkpoints = [];
  for (let index = 0; index < input.turns.length; index++) {
    const turn = input.turns[index], before = context.profile;
    const turnSubmittedAt = Date.now(), turnWindow = userActionWindows ? { submittedAtEpochMs: turnSubmittedAt,
      deadlineEpochMs: Math.min(modules.requestDeadline.createCompetitionRequestDeadlines(turnSubmittedAt).aiDeadlineEpochMs,
        turnSubmittedAt + modules.runContracts.RECOMMENDATION_DETAIL_DEADLINE_MS) } : null;
    if (turnWindow) onActionWindow?.({ actionId: `${invocationId}:turn:${index}`, kind: "chat", ...turnWindow });
    // This is the same actual draftDecisionChatV7 path used by the product API.
    const reply = await modules.chat.draftDecisionChatV7({ profile: context.profile, legacy, report, context }, turn.text, turn.itemIds ?? [],
      { ...options, ...(turnWindow ? { deadlineEpochMs: turnWindow.deadlineEpochMs } : {}), requestId: `${invocationId}:turn:${index}`, answerId: `${invocationId}:answer:${index}`, at: asOf });
    if (reply.profile) {
      const correctionSubmittedAt = userActionWindows ? turnSubmittedAt : Date.now();
      if (legacy) legacy = modules.profile.projectProfileToLegacy(reply.profile, legacy, { openDomain: true });
      context = modules.model.buildDecisionContextV7(legacy, { records, now: new Date(asOf), profile: reply.profile });
      if (input.rerankAfterUpdates === true) {
        const correctionWindow = userActionWindows ? { deadlineEpochMs: correctionSubmittedAt + modules.runContracts.RECOMMENDATION_DETAIL_DEADLINE_MS } : {};
        if (userActionWindows) onActionWindow?.({ actionId: `${invocationId}:turn:${index}:rerank`, kind: "recommendation", submittedAtEpochMs: correctionSubmittedAt,
          rankDeadlineEpochMs: correctionSubmittedAt + modules.runContracts.RECOMMENDATION_RANK_HARD_TIMEOUT_MS, ...correctionWindow });
        report = await executeGroupedReportV7(context, { ...reportOptions, ...correctionWindow, generation: ++generation,
          submittedAtEpochMs: correctionSubmittedAt, operation: "conversation_rerank" });
      }
    }
    checkpoints.push({ turn: index, inputProfileRevision: before.revision, reply, ...contextOutput(context), report, ...(turnWindow ? { actionWindow: turnWindow } : {}) });
  }
  return { ...contextOutput(context), checkpoints, report };
}

// Diagnostic timings affect future admissions only. They do not alter the
// response, reservation, deadline or the disposition of any in-flight call.
function providerCapacityTiming(options, events) {
  const dispatch = events.find(event => event.type === "ai_transport_dispatch");
  const completed = events.findLast(event => event.type === "ai_attempt_result");
  const start = Date.parse(dispatch?.time), end = Date.parse(completed?.time);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  const budgets = [options.timeoutMs, options.requestDeadlineMs,
    Number.isFinite(dispatch?.details?.deadlineEpochMs) ? dispatch.details.deadlineEpochMs - start : undefined]
    .filter(value => Number.isFinite(value) && value > 0);
  return budgets.length ? { elapsedMs: end - start, budgetMs: Math.min(...budgets) } : undefined;
}

export function providerCapacityFeedback(result, actualDispatch = false, timing) {
  if (["insufficient_balance", "spend_budget_exhausted", "spend_store_unavailable", "spend_configuration_invalid"].includes(result?.reason)) return { stop: true, reason: result.reason };
  if (!actualDispatch || result?.upstreamAttempted !== true || result.reason === "durable_outcome_unknown") return null;
  if (result?.httpStatus === 429 || ["rate_limited", "capacity_exhausted", "network_error", "timeout", "durable_outcome_unknown"].includes(result?.reason)) return {
    backpressure: true, reason: result.reason ?? "rate_limited", retryAfterMs: result.retryAfterMs ?? null, durationMs: result.durationMs ?? null };
  if (result?.upstreamAttempted === true && result.httpStatus >= 200 && result.httpStatus < 400) {
    // Relative budget use is pressure even when an HTTP success is malformed.
    // Failed content never earns healthy credit or becomes a synthetic 429.
    // Missing actual timing cannot establish pressure; failed content stays neutral.
    if (Number.isFinite(timing?.elapsedMs) && timing.elapsedMs >= 0
      && Number.isFinite(timing?.budgetMs) && timing.budgetMs > 0 && timing.elapsedMs >= timing.budgetMs * 0.8) return {
      backpressure: true, reason: result.ok === true ? "successful_request_budget_pressure" : "unsuccessful_request_budget_pressure", successfulResponse: result.ok === true, httpStatus: result.httpStatus,
      durationMs: result.durationMs ?? null, elapsedMs: timing.elapsedMs, budgetMs: timing.budgetMs, budgetFraction: timing.elapsedMs / timing.budgetMs };
    return result.ok === true ? { healthy: true, durationMs: result.durationMs ?? null } : null;
  }
  return null;
}
/** Evaluation originals only. Never send these receipts to product observers,
 * business traces, browser DTOs or console output. Old originals omit this field. */
function privatePublicReceiptSnapshot(receipt) {
  const keys = ["model", "httpStatus", "requestId", "finishReason", "durationMs", "attempts", "operation", "thinking", "reasoningEffort",
    "policyReasoningEffort", "wireReasoningEffort", "temperature", "topP", "effortPolicySha256", "recommendationPolicyVersion", "implementationVersion"];
  return plain({ ...Object.fromEntries(keys.filter(key => receipt[key] !== undefined).map(key => [key, receipt[key]])),
    content: typeof receipt.content === "string" ? receipt.content : null,
    ...(receipt.usage ? { usage: { inputTokens: receipt.usage.inputTokens, outputTokens: receipt.usage.outputTokens, cachedInputTokens: receipt.usage.cachedInputTokens } } : {}) });
}
function privatePublicReceiptRecord(intent, receipts, events, result, tapAvailable, captureCallbackFailed) {
  const base = { schemaVersion: "saitu.private-provider-public-receipt.v1", tapAvailable, captureCount: receipts.length, captureCallbackFailed };
  try {
    const compare = (expected, actual, keys) => {
      const missingExpectedFields = [], missingReceiptFields = [], mismatchedFields = [];
      for (const key of keys) {
        if (expected[key] === undefined) { if (actual[key] !== undefined) missingExpectedFields.push(key); continue; }
        if (actual[key] === undefined) { missingReceiptFields.push(key); continue; }
        if (!same(expected[key], actual[key])) mismatchedFields.push(key);
      }
      return { matchesPresentFields: mismatchedFields.length === 0 && missingReceiptFields.length === 0, missingExpectedFields, missingReceiptFields, mismatchedFields };
    };
    const dispatches = events.filter(event => event.type === "ai_transport_dispatch"), dispatch = dispatches[0]?.details ?? {};
    const reservationId = typeof dispatch.reservationId === "string" ? dispatch.reservationId : null;
    const exactSingleDispatch = dispatches.length === 1 && reservationId !== null;
    const expectedIntent = { ...intent.options, attempts: 1, effortPolicySha256: intent.effortPolicySha256 };
    // The intent's reasoningEffort remains a local ledger class for disabled
    // rank; the private receipt correctly omits its wire reasoningEffort key.
    if (expectedIntent.thinking === "disabled") delete expectedIntent.reasoningEffort;
    const intentKeys = ["model", "operation", "thinking", "attempts", "reasoningEffort", "policyReasoningEffort", "wireReasoningEffort", "temperature", "topP",
      "effortPolicySha256", "recommendationPolicyVersion", "implementationVersion"];
    const expectedDispatch = { model: intent.options.model, operation: intent.options.operation, thinkingType: intent.options.thinking, attempt: 1,
      effortPolicySha256: intent.effortPolicySha256, ...(intent.options.thinking === "disabled"
        ? { policyReasoningEffort: intent.options.policyReasoningEffort, wireReasoningEffort: null, temperature: intent.options.temperature, topP: intent.options.topP }
        : { reasoningEffort: intent.options.reasoningEffort }) };
    const dispatchComparison = compare(expectedDispatch, dispatch, Object.keys(expectedDispatch));
    const actualDispatchMatchesResult = Boolean(result.upstreamAttempted) === (dispatches.length === 1);
    const observations = receipts.map(receipt => {
      const intentComparison = compare(expectedIntent, receipt, intentKeys);
      if (intent.options.thinking === "disabled" && receipt.reasoningEffort !== undefined) {
        intentComparison.mismatchedFields.push("forbidden_wire_reasoningEffort"); intentComparison.matchesPresentFields = false;
      }
      // Duration is measured at different instants. Compare only common result
      // metadata; a missing legacy field is explicitly distinct from mismatch.
      const resultComparison = compare(result, receipt, ["model", "httpStatus", "requestId", "finishReason", "attempts", "usage"]);
      return { callId: intent.callId, invocationId: intent.invocationId, runId: intent.runId, callKey: intent.callKey,
        requestSha256: intent.requestSha256, promptSha256: intent.promptSha256, reservationId, actualDispatchCount: dispatches.length,
        contentSha256: receipt.content === null ? null : byteHash(receipt.content), contentUtf8Bytes: receipt.content === null ? null : Buffer.byteLength(receipt.content, "utf8"),
        receipt, binding: { intentMatchesReceipt: intentComparison.matchesPresentFields, resultMatchesReceipt: resultComparison.matchesPresentFields,
          exactSingleDispatch, actualDispatchMatchesResult, intentComparison, resultComparison, dispatchComparison } };
    });
    const mismatch = observations.some(row => !row.binding.intentMatchesReceipt || !row.binding.resultMatchesReceipt || !row.binding.exactSingleDispatch ||
      !row.binding.actualDispatchMatchesResult || !row.binding.dispatchComparison.matchesPresentFields);
    return { ...base, status: !receipts.length ? "not_observed" : receipts.length > 1 ? "multiple_observed" : mismatch ? "binding_mismatch" : "captured",
      ...(!receipts.length ? { notObservedReason: captureCallbackFailed ? "capture_callback_failed" : tapAvailable ? "no_receipt_callback" : "tap_unavailable" } : {}), observations,
      persistence: "pre_validation_memory_capture_then_existing_strict_model_response_journal",
      httpToJournalCrashWindowClosed: false };
  } catch {
    // Diagnostic construction cannot turn an HTTP result into a provider
    // failure, trigger a retry, change charges, or alter capacity feedback.
    return { ...base, status: "not_observed", notObservedReason: "capture_record_failed", observations: [], httpToJournalCrashWindowClosed: false };
  }
}

function actualModelCall(modules, { invocationId, maxHttp, maxReserveMicros, responses, journal, effortPolicy, executionMode, onCapacityFeedback }) {
  const unbounded = executionMode === USER_UNBOUNDED_EXECUTION_MODE;
  if (unbounded ? maxHttp !== null || maxReserveMicros !== null : !Number.isSafeInteger(maxHttp) || maxHttp < 1 || !Number.isSafeInteger(maxReserveMicros) || maxReserveMicros < 1) throw new Error("formal_explicit_execution_mode_and_invocation_allowance_required");
  if (!modules.spend?.requestReserveMicros || !modules.budget?.withAiReservationLimit || !modules.observer?.withProductObservationTap) throw new Error("formal_actual_reservation_scope_required");
  let attempts = 0, remainingReserve = maxReserveMicros;
  const calls = new Map();
  return async (prompt, options) => {
    assertSameEffortPolicy(modules.effortContext.currentDecisionEffortPolicy(), effortPolicy);
    const settings = resolveDecisionModelSettingsForOperation(options.operation, effortPolicy);
    if (options.model !== "deepseek-flash" || options.reasoningEffort !== settings.policyReasoningEffort || options.thinking !== settings.thinking || options.maxAttempts !== 1 ||
        settings.thinking === "disabled" && (options.temperature !== 0 || options.topP !== 1)) throw new Error("executor_forbids_runtime_effort_model_drift");
    const runId = options.diagnosticContext?.invocationId ?? invocationId;
    const callKey = `${options.diagnosticContext?.stage ?? options.operation ?? "json"}:${options.diagnosticContext?.reviewId ?? "batch"}:1`;
    const requestSha256 = decisionRequestSha256({ prompt, system: options.systemPrompt, model: options.model, maxTokens: options.maxTokens, promptVersion: options.promptVersion,
      thinking: options.thinking, reasoningEffort: options.reasoningEffort, effortPolicySha256: effortPolicySha256(effortPolicy),
      operation: options.operation, ...(settings.thinking === "disabled" ? { temperature: options.temperature } : {}),
      ...(options.topP === undefined ? {} : { topP: options.topP }),
      ...(options.recommendationPolicyVersion === undefined ? {} : { recommendationPolicyVersion: options.recommendationPolicyVersion }),
      ...(options.implementationVersion === undefined ? {} : { implementationVersion: options.implementationVersion }) });
    const identity = `${runId}\0${callKey}`, previous = calls.get(identity);
    if (previous) {
      if (previous.requestSha256 !== requestSha256) throw new Error("formal_original_call_binding_changed");
      if (!previous.result) throw new Error("durable_outcome_unknown");
      return previous.result;
    }
    // Both limits are claimed synchronously, before a provider/governor/DB await.
    // The actual production pricing function gives the same conservative amount
    // as reserveAiSpend. Observer delivery never controls this financial boundary.
    const reservedMicros = modules.spend.requestReserveMicros(options.systemPrompt, prompt, options.maxTokens);
    if (!Number.isSafeInteger(reservedMicros) || reservedMicros < 1) throw new Error("formal_invalid_request_reservation");
    if (!unbounded && (attempts >= maxHttp || reservedMicros > remainingReserve)) {
      const result = { ok: false, reason: "spend_budget_exhausted", model: "deepseek-flash", upstreamAttempted: false };
      journal?.({ type: "model_call_refused", runId, callKey, requestSha256, reservedMicros, remainingReserve, attempts, result });
      return result;
    }
    attempts++; if (!unbounded) remainingReserve -= reservedMicros;
    const callId = randomUUID(), callEvents = [], state = { requestSha256, result: null };
    calls.set(identity, state);
    const intent = plain({ schemaVersion: "saitu.formal-model-call-intent.v1", callId, invocationId, runId, callKey, requestSha256, effortPolicySha256: effortPolicySha256(effortPolicy),
      executionMode, ...(unbounded ? { executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS } : {}),
      promptSha256: byteHash(prompt), reservedMicros, remainingReserve, options: { model: options.model, thinking: options.thinking, reasoningEffort: options.reasoningEffort,
        ...(settings.thinking === "disabled" ? { policyReasoningEffort: settings.policyReasoningEffort, wireReasoningEffort: null, temperature: options.temperature } : {}),
        operation: options.operation, promptVersion: options.promptVersion, maxTokens: options.maxTokens, maxAttempts: options.maxAttempts,
        ...(options.topP === undefined ? {} : { topP: options.topP }),
        ...(options.recommendationPolicyVersion === undefined ? {} : { recommendationPolicyVersion: options.recommendationPolicyVersion }),
        ...(options.implementationVersion === undefined ? {} : { implementationVersion: options.implementationVersion }),
        timeoutMs: options.timeoutMs ?? null, requestDeadlineMs: options.requestDeadlineMs ?? null, deadlineEpochMs: options.deadlineEpochMs ?? null } });
    journal?.({ type: "model_call_intent", intent });
    const privateReceipts = [], tapAvailable = typeof modules.durable?.withPrivateAiPublicReceiptTap === "function";
    let result, captureCallbackFailed = false;
    try {
      const request = () => modules.budget.withAiReservationLimit(reservedMicros, () => modules.ai.requestAiJson(prompt, options));
      result = await modules.observer.withProductObservationTap(event => { callEvents.push(plain(event)); }, () => tapAvailable
        ? modules.durable.withPrivateAiPublicReceiptTap(receipt => {
          try { privateReceipts.push(privatePublicReceiptSnapshot(receipt)); } catch { captureCallbackFailed = true; }
        }, request) : request());
    } catch (failure) {
      journal?.({ type: "model_call_failure", callId, invocationId, runId, callKey, requestSha256, events: callEvents,
        error: failure instanceof Error ? failure.message : "model_execution_failed", outcome: "unknown_no_regeneration" });
      if (onCapacityFeedback && callEvents.some(event => event.type === "ai_transport_dispatch"))
        await onCapacityFeedback({ backpressure: true, reason: "original_provider_exception_retained_no_retry" });
      throw failure;
    }
    const response = plain({ ...intent, evidenceType: "actual_ai_json_result_and_transport_reservation_events", events: callEvents, result,
      privateProviderReceipt: privatePublicReceiptRecord(intent, privateReceipts, callEvents, result, tapAvailable, captureCallbackFailed) });
    // Unlike diagnostic observers, this strict append is allowed to fail the
    // operation. A group cannot be prepared/reviewed until its original is durable.
    journal?.({ type: "model_response", response }); responses.push(response); state.result = result;
    if (settings.thinking === "disabled") for (const event of callEvents.filter(row => row.type === "ai_transport_dispatch")) assertDispatchEffort(event.details, effortPolicy);
    const feedback = providerCapacityFeedback(result, callEvents.some(event => event.type === "ai_transport_dispatch"), providerCapacityTiming(options, callEvents));
    if (feedback && onCapacityFeedback) await onCapacityFeedback(feedback);
    return result;
  };
}

/** Every invocation is observed in the real product functions and retains dispatch/reservation provenance. */
export async function executeObservedProduct(item, { modules, records, asOf, freezeBinding, maxHttp, maxReserveMicros, producerSha256, executionRuntimeConfigurationSha256,
  algorithm, repetition = 0, seed, embeddingProvider, journal, invocationId = randomUUID(), effortPolicy = readConfiguredEffortPolicy(), executionMode = readExecutionMode(), onCapacityFeedback,
  userActionWindows = false }) {
  effortPolicy = parseEffortPolicy(effortPolicy);
  if (!modules.effortContext?.withDecisionEffortPolicy || !modules.effortContext?.currentDecisionEffortPolicy) throw new Error("actual_frozen_effort_context_required");
  const startedAtEpochMs = Date.now(), events = [], responses = [], compatibility = [], groupRuns = new Map(), actionWindows = [];
  if (!["finite", USER_UNBOUNDED_EXECUTION_MODE].includes(executionMode)) throw new Error("registered_execution_mode_invalid");
  const runtime = evaluationRuntimeForEffort(effortPolicy), inputSha256 = canonicalHash(item.input), modelCall = actualModelCall(modules, { invocationId, maxHttp, maxReserveMicros, responses, journal, effortPolicy, executionMode, onCapacityFeedback });
  const groupOptions = { journal, implementationSha256: freezeBinding?.implementationSha256, submittedAtEpochMs: startedAtEpochMs, effortPolicy,
    onGroupCommit: state => groupRuns.set(state.runId, state) };
  let output = null, error = null, context = null, candidateOrder = null, shuffleSeed = null;
  try {
    output = await modules.effortContext.withDecisionEffortPolicy(effortPolicy, () => modules.observer.withProductObservation({ observer: event => { events.push(plain(event)); journal?.({ type: "product_event", event }); } }, async () => {
      const detailHardMs = modules.runContracts?.RECOMMENDATION_DETAIL_DEADLINE_MS;
      if (!Number.isSafeInteger(detailHardMs) || detailHardMs !== EVALUATION_POLICY.performance.detailHardTimeoutMs) throw new Error("actual_production_detail_deadline_contract_required");
      if (!algorithm) return executeProductOperation(item, { modules, records, asOf, modelCall, invocationId, deadlineEpochMs: startedAtEpochMs + detailHardMs, ...groupOptions,
        userActionWindows, onActionWindow: window => { actionWindows.push(plain(window)); journal?.({ type: "product_action_window", window }); },
        onCompatibility: proof => compatibility.push(plain(proof)), eventPosition: () => events.length });
      context = contextFor(item.input, modules, records, asOf, item.profileId, { onCompatibility: proof => compatibility.push(plain(proof)) });
      shuffleSeed = deriveRunSeed(seed, item.profileId, repetition + 1);
      candidateOrder = seededShuffle(context.candidates.map(row => row.record.recordId), shuffleSeed);
      const indexed = new Map(context.candidates.map(row => [row.record.recordId, row]));
      const shuffled = { ...context, candidates: candidateOrder.map(id => indexed.get(id)) };
      if (algorithm === "B") {
        const baseline = await modules.baseline.buildBaselineMatchPlanV7(shuffled, { embeddingProvider, candidateOrder, seed: shuffleSeed });
        return { ...baseline.plan, diagnostics: baseline.diagnostics };
      }
      if (algorithm !== "C") throw new Error("formal_executor_only_B_C");
      return executeGroupedReportV7(shuffled, { modules, modelCall, invocationId, deadlineEpochMs: startedAtEpochMs + detailHardMs, ...groupOptions });
    }));
    output = plain(output);
  } catch (failure) { if (failure?.name === "FormalOriginalPersistenceError") throw failure; error = failure instanceof Error ? failure.message : "product_execution_failed"; }
  const dispatches = events.filter(row => row.type === "ai_transport_dispatch");
  const groupErrors = [...groupRuns.values()].flatMap(run => (run.body.detailGroups?.groups ?? []).map(group => group.error).filter(Boolean));
  const unknown = output === null && dispatches.length > 0 && [error, ...groupErrors].some(code => /timeout|network|durable_outcome_unknown|aborted/u.test(code ?? ""));
  const budgetNotDispatched = output === null && dispatches.length === 0 && error === "spend_budget_exhausted";
  const budgetExhausted = error === "spend_budget_exhausted" || output?.error === "spend_budget_exhausted" ||
    output?.baseOutcome?.productError === "spend_budget_exhausted" || output?.perturbedOutcome?.productError === "spend_budget_exhausted" || groupErrors.includes("spend_budget_exhausted");
  const reservationIds = [...new Set(events.filter(row => ["ai_budget_reserved", "ai_budget_settled", "ai_settlement_failed"].includes(row.type)).map(row => row.details.reservationId).filter(Boolean))];
  const observation = { schemaVersion: algorithm ? "saitu.ranking-observation.v7.1" : "saitu.product-observation.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    caseId: item.caseId, operation: algorithm ? "recommend" : item.operation, invocationId, repetition, inputSha256, output, outputSha256: canonicalHash(output), freezeBinding,
    status: output !== null ? "observed" : budgetNotDispatched ? "not_run" : unknown ? "indeterminate" : "error", error, fallback: Boolean(output?.fallback?.used ?? output?.fallback === true), events, reservationIds,
    observedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAtEpochMs, compatibility, runtime, groupedRuns: [...groupRuns.values()],
    ...(userActionWindows ? { userActionWindows: true, actionWindows } : {}),
    execution: { producerVersion: EXECUTOR_VERSION, producerPath: executorPath, producerSha256, executionRuntimeConfigurationSha256,
      executionMode, ...(executionMode === USER_UNBOUNDED_EXECUTION_MODE ? { executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS } : {}),
      kind: dispatches.length ? "live_product" : "local_product", actualModelRun: dispatches.length > 0, httpDispatches: dispatches.length, budgetExhausted,
      modelStatus: output === null ? /timeout/.test(error ?? "") ? "timeout" : "provider_error" : output.recommendations?.length === 0 ? "empty" : "ok" },
    ...(algorithm ? { algorithm, profileId: item.profileId, candidateOrder, shuffleSeed, skipIndependentRecall: true,
      candidateSetSha256: canonicalHash([...(candidateOrder ?? [])].sort()) } : {}) };
  return { observation, responses };
}

/** An intent without a completed original is indeterminate; resume never dispatches it a second time. */
export async function checkpointInvocation(directory, identity, work) {
  const key = canonicalHash(identity), resultPath = path.join(directory, `${key}.json`), intentPath = path.join(directory, `${key}.intent.json`), journalPath = path.join(directory, `${key}.journal.jsonl`);
  if (await existing(resultPath)) return { kind: "completed", value: JSON.parse(await readFile(resultPath, "utf8")) };
  if (await existing(intentPath)) return { kind: "indeterminate", identity, reason: "original_intent_without_completed_receipt_no_regeneration" };
  await writeNewJson(intentPath, { schemaVersion: "saitu.execution-intent.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, identity, createdAt: new Date().toISOString() });
  try { syncFile(intentPath); syncFile(directory); } catch (failure) { throw persistenceFailure(failure); }
  const journal = appendDurableJournal(journalPath);
  const value = await work(journal); await writeNewJson(resultPath, value);
  try { syncFile(resultPath); syncFile(directory); } catch (failure) { throw persistenceFailure(failure); }
  return { kind: "completed", value };
}

/** A single coordinator owns every mutable checkpoint/final manifest in this output directory. */
export async function acquireCoordinatorLock(directory, identity, recoverSha256 = null) {
  const filename = path.join(directory, "coordinator.lock.json"), token = randomUUID();
  const lock = { schemaVersion: "saitu.execution-coordinator-lock.v7.1", token, pid: process.pid, hostname: hostname(), identity, acquiredAt: new Date().toISOString() };
  try { await writeNewJson(filename, lock); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!recoverSha256) throw new Error("exclusive_coordinator_already_present_or_recovery_not_authorized");
    // Serialize recovery independently of the stale main lock. A second recoverer must
    // never rename a new live coordinator after observing the same old bytes earlier.
    const recoveryFilename = path.join(directory, "coordinator.recovery.lock.json"), recoveryToken = randomUUID();
    try { await writeNewJson(recoveryFilename, { schemaVersion: "saitu.execution-coordinator-recovery-lock.v7.1", token: recoveryToken,
      pid: process.pid, hostname: hostname(), recoverSha256, identity, acquiredAt: new Date().toISOString() }); }
    catch (failure) { if (failure.code === "EEXIST") throw new Error("exclusive_coordinator_recovery_already_present"); throw failure; }
    try {
      // Re-read only after obtaining the recovery mutex; the earlier EEXIST is not a CAS.
      const bytes = await readFile(filename), previous = JSON.parse(bytes);
      if (byteHash(bytes) !== recoverSha256 || previous.hostname !== hostname() || !same(previous.identity, identity) || !Number.isSafeInteger(previous.pid) || previous.pid < 1) throw new Error("exclusive_coordinator_already_present_or_recovery_not_authorized");
      let dead = false;
      try { process.kill(previous.pid, 0); } catch (failure) { if (failure.code === "ESRCH") dead = true; }
      if (!dead) throw new Error("coordinator_process_may_still_be_alive");
      await rename(filename, path.join(directory, `coordinator.abandoned-${recoverSha256}-${randomUUID()}.json`));
      await writeNewJson(filename, lock);
    } finally {
      const recovery = JSON.parse(await readFile(recoveryFilename, "utf8"));
      if (recovery.token !== recoveryToken) throw new Error("coordinator_recovery_lock_ownership_changed");
      await unlink(recoveryFilename);
    }
  }
  return async () => {
    const current = JSON.parse(await readFile(filename, "utf8"));
    if (current.token !== token) throw new Error("coordinator_lock_ownership_changed");
    await unlink(filename);
  };
}

/** Bound independent invocations; each work function retains its own sequential business stages. */
export async function runBoundedSlotQueue(slots, { concurrency, run, onCheckpoint = async () => {} }) {
  if (![1, 2].includes(concurrency)) throw new Error("explicit_invocation_concurrency_must_be_1_or_2");
  const outcomes = Array(slots.length), failures = []; let cursor = 0, stopped = false, checkpointTail = Promise.resolve();
  const checkpoint = () => {
    const snapshot = Array.from({ length: slots.length }, (_, index) => outcomes[index] ?? { kind: "not_run", reason: "not_started" });
    checkpointTail = checkpointTail.then(() => onCheckpoint(snapshot)); return checkpointTail;
  };
  async function worker() {
    while (!stopped) {
      const index = cursor++; if (index >= slots.length) return;
      try { outcomes[index] = await run(slots[index], index); if (outcomes[index].stopScheduling === true) stopped = true; }
      catch (error) { outcomes[index] = { kind: "indeterminate", reason: "coordinator_slot_error_no_regeneration", error: error instanceof Error ? error.message : "execution_error" }; failures.push(outcomes[index]); stopped = true; }
      try { await checkpoint(); } catch (error) { failures.push({ reason: "coordinator_checkpoint_failed", error: String(error) }); stopped = true; }
    }
  }
  await Promise.allSettled(Array.from({ length: concurrency }, worker));
  await checkpointTail.catch(() => {});
  return { outcomes: Array.from({ length: slots.length }, (_, index) => outcomes[index] ?? { kind: "not_run", reason: "coordinator_stopped_before_slot" }), failures };
}

function serializedEmbeddings(provider) {
  let tail = Promise.resolve();
  return { ...provider, async embed(texts) { const previous = tail; let release; tail = new Promise(resolve => { release = resolve; }); await previous;
    try { return await provider.embed(texts); } finally { release(); } } };
}

/** Only a proved pre-dispatch budget refusal may be attempted in an explicitly different scope. */
export async function checkpointRegisteredInvocation(directory, identity, scope, work, admitNewAttempt = () => true) {
  const slotDirectory = path.join(directory, canonicalHash(identity)); await mkdir(slotDirectory, { recursive: true, mode: 0o700 });
  const files = await readdir(slotDirectory), scopeSha256 = canonicalHash(scope);
  for (const filename of files.filter(name => name.endsWith(".intent.json"))) {
    const result = filename.replace(/\.intent\.json$/, ".json");
    if (!files.includes(result)) return { kind: "indeterminate", identity, reason: "prior_scope_intent_without_original_receipt_no_regeneration" };
  }
  const completed = [];
  for (const filename of files.filter(name => name.endsWith(".json") && !name.endsWith(".intent.json"))) {
    const value = JSON.parse(await readFile(path.join(slotDirectory, filename), "utf8"));
    if (value.observation?.status !== "not_run" || value.observation.execution?.actualModelRun !== false) completed.push(value);
  }
  if (completed.length > 1) throw new Error("multiple_terminal_originals_for_one_slot");
  if (completed.length) return { kind: "completed", value: completed[0] };
  const attemptIdentity = { ...identity, financialScopeSha256: scopeSha256 };
  const currentResult = path.join(slotDirectory, `${canonicalHash(attemptIdentity)}.json`);
  if (await existing(currentResult)) return { kind: "completed", value: JSON.parse(await readFile(currentResult, "utf8")) };
  if (!admitNewAttempt()) return { kind: "not_run", reason: "finite_batch_limit" };
  return checkpointInvocation(slotDirectory, attemptIdentity, work);
}

async function originalInvocationFiles(directory) {
  const files = [];
  async function walk(relative) {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const member = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error("symlink_in_original_invocation_evidence");
      if (entry.isDirectory()) await walk(member);
      else if (entry.isFile()) files.push({ path: member, sha256: byteHash(await readFile(path.join(directory, member))) });
    }
  }
  await walk("invocations"); return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function verifyActualScope(modules, scope) {
  const continuation = rankNonThinkingContinuationForScope(scope);
  validateExecutionScope(scope, { allowedPhases: ["formal"], allowRankNonThinking: Boolean(continuation) });
  if (continuation) await verifyRankNonThinkingContinuationScope(repositoryRoot, scope);
  await readBoundBytes(repositoryRoot, scope.authorizationPolicySnapshot);
  if (scope.runId !== process.env.AI_SPEND_RUN_ID || scope.phase !== process.env.AI_SPEND_PHASE || scope.authorizationPolicySha256 !== process.env.AI_SPEND_POLICY_SHA256 ||
      scope.executionRuntimeConfigurationSha256 !== runtimeConfigurationHash() || (scope.executionMode ?? "finite") !== readExecutionMode()) throw new Error("executor_actual_environment_differs_from_registered_financial_scope");
  const unbounded = scope.executionMode === USER_UNBOUNDED_EXECUTION_MODE;
  const result = await modules.database.getPool().query("select run_id,grant_version,authorized_phase,authorized_effort,effort_policy,effort_policy_sha256,policy_sha256,call_limit,execution_mode,effort_condition,funding_limit_micros::text,state from ai_spend_development_batches where run_id=$1", [scope.runId]);
  const row = result.rows[0];
  if (!row || row.state !== "active" || row.grant_version !== scope.grantVersion || row.authorized_phase !== scope.phase || row.authorized_effort !== scope.authorizedEffort ||
      row.policy_sha256 !== scope.authorizationPolicySha256 || (unbounded ? row.call_limit !== null || row.execution_mode !== USER_UNBOUNDED_EXECUTION_MODE ||
        row.effort_condition?.executionMode !== USER_UNBOUNDED_EXECUTION_MODE || !same(row.effort_condition?.executionLimits ?? null, USER_UNBOUNDED_EXECUTION_LIMITS) :
        Number(row.call_limit) !== scope.callLimit || row.execution_mode != null) || Number(row.funding_limit_micros) / 1000000 !== scope.fundingLimitCny) throw new Error("executor_actual_database_grant_does_not_match_financial_scope");
  if (unbounded) {
    const budget = (await modules.database.getPool().query("select execution_mode,hard_limit_micros from ai_spend_budgets where run_id=$1", [scope.runId])).rows[0];
    if (!budget || budget.execution_mode !== USER_UNBOUNDED_EXECUTION_MODE || budget.hard_limit_micros !== null) throw new Error("executor_actual_database_unbounded_budget_required");
  }
  if (scope.authorizedEffort === "stage" && (row.effort_policy_sha256 !== scope.effortPolicySha256 || !same(row.effort_policy, scope.effortPolicy))) throw new Error("executor_actual_database_effort_policy_changed");
  if (continuation && (row.effort_condition?.sourcePolicy !== RANK_NONTHINKING_AUTHORIZATION_POLICY || !same(row.effort_condition?.pilotContinuation ?? null, continuation))) throw new Error("executor_actual_database_verified_continuation_required");
}
export async function deriveProfilePools({ profiles, binding, modules, records, asOf }) {
  requirePolicy(binding); assertRankingGroups(profiles);
  return profiles.map(row => {
    const compatibility = [];
    const context = contextFor(row.input, modules, records, asOf, row.profileId, { onCompatibility: proof => compatibility.push(plain(proof)) });
    const evidence = { inputSha256: canonicalHash(row.input), policySha256: POLICY_SHA256, implementationSha256: binding.implementationSha256 ?? null,
      poolDerivationSourceSha256: binding.poolDerivationSourceSha256 ?? null,
      candidateItemIds: context.candidates.map(candidate => candidate.record.recordId), excluded: [...context.excluded], compatibility };
    return { ...row, candidateItemIds: evidence.candidateItemIds, assessmentItemIds: records.map(record => record.recordId), poolDerivation: { ...evidence, evidenceSha256: canonicalHash(evidence) } };
  });
}

function optionsFrom(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]; if (Object.hasOwn(result, flag)) throw new Error("duplicate_executor_option");
    if (["--open", "--execute", "--resume", "--prepare-pools"].includes(flag)) result[flag] = true;
    else if (["--mode", "--registration", "--registration-sha256", "--input", "--output", "--scope", "--e5-cache", "--binding", "--recover-lock-sha256"].includes(flag)) {
      const value = args[++index]; if (!value || value.startsWith("--")) throw new Error("executor_option_value_required"); result[flag] = value;
    } else throw new Error("unsupported_executor_option");
  }
  return result;
}
async function main() {
  const options = optionsFrom(process.argv.slice(2));
  if (!options["--input"] || !options["--output"]) throw new Error("executor_input_and_new_output_required");
  const modules = await loadActualProductModules(), records = modules.catalog.getMatchingCatalogRecords();
  if (options["--prepare-pools"]) {
    if (options["--execute"] || options["--open"] || !options["--binding"]) throw new Error("pool_preparation_is_input_only_no_execution");
    const input = JSON.parse(await readFile(options["--input"], "utf8")), binding = JSON.parse(await readFile(options["--binding"], "utf8"));
    await writeNewJson(options["--output"], { ...input, profiles: await deriveProfilePools({ profiles: input.profiles, binding, modules, records, asOf: input.asOf }) });
    console.log(JSON.stringify({ output: options["--output"], profiles: 120, productExecutions: 0, modelCalls: 0 })); return;
  }
  if (!options["--open"] || !options["--execute"] || !options["--registration"] || !options["--scope"] || !["ranking", "product"].includes(options["--mode"])) throw new Error("explicit_registered_open_execute_scope_and_mode_required");
  const registrationBytes = await readFile(options["--registration"]);
  if (byteHash(registrationBytes) !== options["--registration-sha256"]) throw new Error("executor_registration_bytes_changed");
  const registration = JSON.parse(registrationBytes), config = validateRegistrationConfig(registration.config);
  const scope = JSON.parse(await readFile(options["--scope"], "utf8")); await verifyActualScope(modules, scope);
  const effortPolicy = requireTop5EvaluationRuntime(config.runtime, { allowRankNonThinking: Boolean(rankNonThinkingContinuationForScope(scope)) });
  await verifyImplementationManifest(repositoryRoot, registration.implementation, config.implementationSha256);
  if (runtimeBehaviorConfigurationHash() !== config.runtimeConfigurationSha256) throw new Error("executor_behavior_configuration_changed");
  if ((scope.executionMode ?? "finite") !== (config.executionMode ?? "finite")) throw new Error("executor_registered_execution_mode_differs_from_actual_scope");
  assertSameEffortPolicy(effortPolicyForScope(scope), effortPolicy);
  await executeRegisteredBatch({ options, registration, registrationBytes, config, scope, modules, records });
}

async function executeRegisteredBatch({ options, registration, registrationBytes, config, scope, modules, records }) {
  const directory = path.resolve(options["--output"]);
  if (!options["--resume"]) await mkdir(directory, { recursive: false, mode: 0o700 });
  const release = await acquireCoordinatorLock(directory, { registrationSha256: byteHash(registrationBytes), mode: options["--mode"] }, options["--recover-lock-sha256"] ?? null);
  try { return await executeRegisteredBatchOwned({ options, registration, registrationBytes, config, scope, modules, records }); }
  finally { await release(); }
}

async function executeRegisteredBatchOwned({ options, registration, registrationBytes, config, scope, modules, records }) {
  const output = path.resolve(options["--output"]), mode = options["--mode"], registrationSha256 = byteHash(registrationBytes);
  const expectedInputSha256 = mode === "ranking" ? config.inputSha256 : config.productInputSha256;
  if (!expectedInputSha256) throw new Error("separate_registered_product_input_hash_required");
  if (!options["--resume"]) {
    await mkdir(path.join(output, "invocations"), { mode: 0o700 });
    await writeFile(path.join(output, "registration.json"), registrationBytes, { flag: "wx", mode: 0o600 });
    await writeNewJson(path.join(output, "opening.json"), { schemaVersion: mode === "ranking" ? "saitu.ranking-opening.v7.1" : "saitu.product-opening.v7.1", registrationSha256,
      inputSha256: expectedInputSha256, openedAt: new Date().toISOString(), mode, policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256 });
  }
  const opening = JSON.parse(await readFile(path.join(output, "opening.json"), "utf8"));
  if (opening.registrationSha256 !== registrationSha256 || opening.inputSha256 !== expectedInputSha256 || opening.mode !== mode) throw new Error("executor_resume_original_opening_changed");
  const bytes = await readFile(options["--input"]); if (byteHash(bytes) !== expectedInputSha256) throw new Error("executor_registered_sealed_input_changed");
  const input = JSON.parse(bytes), producerSha256 = byteHash(await readFile(path.join(repositoryRoot, executorPath)));
  const freezeBinding = { policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, registrationSha256,
    ...Object.fromEntries(["challengeManifestSha256", "sourceSnapshotSha256", "rankingSourceSnapshotSha256", "catalogSha256", "implementationSha256", "runtimeConfigurationSha256", "migrationSha256"].map(key => [key, config[key]])) };
  let embeddingProvider;
  if (mode === "ranking") {
    assertRankingGroups(input.profiles);
    const derived = await deriveProfilePools({ profiles: input.profiles, binding: freezeBinding, modules, records, asOf: input.asOf });
    if (!same(derived.map(row => row.candidateItemIds), input.profiles.map(row => row.candidateItemIds))) throw new Error("actual_v7_pool_changed_since_blind_review");
    if (scope.executionMode === USER_UNBOUNDED_EXECUTION_MODE) {
      const { createIsolatedLocalE5 } = await import("./evaluation-local-e5.mjs");
      embeddingProvider = serializedEmbeddings(await createIsolatedLocalE5({ cacheDir: options["--e5-cache"] }));
    } else {
      const { createLocalE5 } = await import("../v6/local-e5.mjs"); embeddingProvider = serializedEmbeddings(await createLocalE5({ cacheDir: options["--e5-cache"], allowDownload: false }));
    }
  } else assertQuotas(input.cases);
  const slots = mode === "ranking" ? createRankingSlots(input.profiles, config.seed) : input.cases.filter(row => row.layer !== "ranking").map(row => ({ caseId: row.caseId, repetition: 0, algorithm: null }));
  const observations = [], receipts = [], pending = []; let newlyDispatched = 0, newlyAllocated = 0, progressVersion = 0, queue;
  const unbounded = scope.executionMode === USER_UNBOUNDED_EXECUTION_MODE;
  const batchLimit = mode === "ranking" ? config.batchPolicy.runsPerBatch : config.productBatchPolicy?.runsPerBatch;
  if (unbounded ? batchLimit !== null : !Number.isSafeInteger(batchLimit) || batchLimit < 1) throw new Error("explicit_product_execution_mode_and_batch_policy_required");
  const schedulingTraceName = unbounded ? `adaptive-scheduling-${randomUUID()}.jsonl` : null;
  try {
    const runner = unbounded ? runAdaptiveSlotQueue : runBoundedSlotQueue;
    queue = await runner(slots, { concurrency: config.invocationConcurrency,
      // Product/provider failures are already preserved as observations by
      // executeObservedProduct; an exception here loses coordinator evidence.
      shouldStopOnError: () => true, onEvent: event => {
      if (schedulingTraceName) appendFileSync(path.join(output, schedulingTraceName), JSON.stringify({ ...event, registrationSha256, executionScopeSha256: canonicalHash(scope) }) + "\n", { mode: 0o600 });
    }, run: async (slot, _index, feedback) => {
      const item = mode === "ranking" ? input.profiles.find(row => row.caseId === slot.caseId) : input.cases.find(row => row.caseId === slot.caseId);
      const identity = { registrationSha256, mode, caseId: slot.caseId, repetition: slot.repetition, algorithm: slot.algorithm };
      const result = await checkpointRegisteredInvocation(path.join(output, "invocations"), identity, scope, async journal => {
        newlyDispatched++;
        const result = await executeObservedProduct(item, { modules, records, asOf: input.asOf, freezeBinding, algorithm: slot.algorithm, repetition: slot.repetition,
          seed: config.seed, embeddingProvider, producerSha256, executionRuntimeConfigurationSha256: scope.executionRuntimeConfigurationSha256, journal,
          effortPolicy: requireTop5EvaluationRuntime(config.runtime, { allowRankNonThinking: Boolean(rankNonThinkingContinuationForScope(scope)) }),
          executionMode: scope.executionMode ?? "finite", onCapacityFeedback: feedback,
          maxHttp: mode === "ranking" ? config.batchPolicy.maxHttpPerCInvocation : config.productBatchPolicy.maxHttpPerInvocation,
          maxReserveMicros: mode === "ranking" ? config.batchPolicy.maxCReservationMicros : config.productBatchPolicy.maxReservationMicros });
        const ids = result.observation.reservationIds;
        const ledgerRows = ids.length ? (await modules.database.getPool().query("select id,run_id,phase,model,effort,operation,effort_policy_sha256,state,reserved_micros::text,charged_micros::text,input_tokens,output_tokens,cached_input_tokens from ai_spend_ledger where id=any($1::uuid[])", [ids])).rows : [];
        return { observation: result.observation, receipt: { schemaVersion: "saitu.product-execution-receipt.v7.1", invocationId: result.observation.invocationId,
          inputSha256: result.observation.inputSha256, observationSha256: canonicalHash(result.observation), producerSha256, freezeBinding,
          executionRuntimeConfigurationSha256: scope.executionRuntimeConfigurationSha256, executionScope: scope, events: result.observation.events, responses: result.responses, ledgerRows } };
      }, () => { // Synchronous reservation before intent creation; completed originals use no new batch token.
        if (!unbounded && newlyAllocated >= batchLimit) return false;
        newlyAllocated++; return true;
      });
      if (result.value?.observation?.execution?.budgetExhausted && same(result.value.receipt.executionScope, scope)) return { ...result, stopScheduling: true };
      return result;
    }, onCheckpoint: async (outcomes, resourceState) => {
      const progress = { schemaVersion: "saitu.execution-progress.v7.1", mode, expectedSlots: slots.length, invocationConcurrency: config.invocationConcurrency,
        executionMode: scope.executionMode ?? "finite", ...(unbounded ? { executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS, schedulingPolicy: config.schedulingPolicy, resourceState } : {}),
        newlyAttempted: newlyDispatched, checkpointVersion: ++progressVersion, updatedAt: new Date().toISOString(),
        slots: slots.map((slot, index) => ({ ...slot, status: outcomes[index].kind === "completed" ? outcomes[index].value?.observation?.status ?? "not_run" : outcomes[index].kind, reason: outcomes[index].reason ?? null })) };
      const temporary = path.join(output, `progress-${randomUUID()}.tmp`); await writeNewJson(temporary, progress); await rename(temporary, path.join(output, "progress.json"));
      appendFileSync(path.join(output, "progress-events.jsonl"), JSON.stringify({ checkpointVersion: progress.checkpointVersion, at: progress.updatedAt, completed: outcomes.filter(row => row.kind === "completed").length, newlyAttempted: newlyDispatched }) + "\n", { mode: 0o600 });
    } });
  } finally { await embeddingProvider?.dispose(); }
  for (let index = 0; index < slots.length; index++) {
    const result = queue.outcomes[index];
    if (result.kind !== "completed" || !result.value?.observation || result.value.observation.status === "not_run") pending.push({ ...slots[index], status: result.kind === "indeterminate" ? "indeterminate" : "not_run", reason: result.reason ?? "not_dispatched_in_authorized_scope" });
    else { observations.push(result.value.observation); receipts.push(result.value.receipt); }
  }
  await verifyImplementationManifest(repositoryRoot, registration.implementation, config.implementationSha256);
  const checkpoint = { schemaVersion: "saitu.execution-checkpoint.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, mode, expectedSlots: slots.length,
    completedOriginals: observations.length, pending, newlyAttempted: newlyDispatched, executionScope: scope, originalObservationSha256: canonicalHash(observations),
    invocationConcurrency: config.invocationConcurrency, coordinatorFailures: queue.failures,
    executionMode: scope.executionMode ?? "finite", ...(unbounded ? { executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS, schedulingPolicy: config.schedulingPolicy,
      schedulerStopReason: queue.stopReason, schedulingTrace: { path: schedulingTraceName, sha256: byteHash(await readFile(path.join(output, schedulingTraceName))) } } : {}),
    status: pending.length || queue.failures.length ? "incomplete_no_missing_slot_regeneration" : "complete_originals_recorded_not_quality_acceptance" };
  const suffix = randomUUID(); await writeNewJson(path.join(output, `checkpoint-${suffix}.json`), checkpoint);
  if (!pending.length && !queue.failures.length) {
    if (mode === "ranking") {
      const rankings = { schemaVersion: "saitu.ranking-evaluation.v1", purpose: "ai_proxy_acceptance", catalogVersion: contextFor(input.profiles[0].input, modules, records, input.asOf, input.profiles[0].profileId).catalogVersion,
        algorithms: ["B", "C"], expectedRunsPerProfile: 5, profiles: input.profiles.map(row => ({ profileId: row.profileId, familyId: row.familyId, taskGroup: row.taskGroup,
          poolItemIds: row.assessmentItemIds ?? row.candidateItemIds, judgments: (row.assessmentItemIds ?? row.candidateItemIds).map(itemId => ({ itemId, seriesId: records.find(record => record.recordId === itemId).seriesId, relevance: "U" })), annotationStatus: "pending" })),
        runs: observations.map(row => ({ algorithm: row.algorithm, profileId: row.profileId, runId: row.invocationId, modelStatus: row.execution.modelStatus,
          displayedItemIds: row.output?.recommendations.map(item => item.itemId) ?? [], fallbackUsed: row.fallback,
          ...Object.fromEntries(["invocationId", "inputSha256", "outputSha256", "freezeBinding", "candidateSetSha256", "reservationIds"].map(key => [key, row[key]])) })) };
      const matrix = { schemaVersion: "saitu.frozen-ranking-matrix.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, seed: config.seed, freezeBinding,
        executionMode: scope.executionMode ?? "finite", ...(unbounded ? { executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS, schedulingPolicy: config.schedulingPolicy } : {}),
        runtime: config.runtime, profileSnapshot: input, rankings, observations }; validateFrozenMatrix(matrix); await writeNewJson(path.join(output, "matrix.json"), matrix);
      const files = await originalInvocationFiles(output);
      for (const member of ["matrix.json", "registration.json", "opening.json"]) files.push({ path: member, sha256: byteHash(await readFile(path.join(output, member))) });
      if (unbounded) for (const member of (await readdir(output)).filter(name => /^adaptive-scheduling-[a-f0-9-]+\.jsonl$/.test(name))) files.push({ path: member, sha256: byteHash(await readFile(path.join(output, member))) });
      await writeNewJson(path.join(output, "freeze-manifest.json"), { schemaVersion: "saitu.experiment-freeze.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, freezeBinding, files });
    } else {
      await writeNewJson(path.join(output, "observations.json"), observations); await writeNewJson(path.join(output, "execution-receipts.json"), receipts);
      await writeNewJson(path.join(output, "execution-manifest.json"), { schemaVersion: "saitu.product-execution-manifest.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
        producer: { path: executorPath, sha256: producerSha256 }, freezeBinding, executionScopes: [...new Map(receipts.map(receipt => [canonicalHash(receipt.executionScope), receipt.executionScope])).values()],
        productInputSha256: expectedInputSha256, openedAt: opening.openedAt,
        executionMode: scope.executionMode ?? "finite", ...(unbounded ? { executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS, schedulingPolicy: config.schedulingPolicy,
          schedulingTraces: await Promise.all((await readdir(output)).filter(name => /^adaptive-scheduling-[a-f0-9-]+\.jsonl$/.test(name)).map(async name => ({ path: name, sha256: byteHash(await readFile(path.join(output, name))) }))) } : {}),
        observations: { path: "observations.json", sha256: byteHash(await readFile(path.join(output, "observations.json"))) },
        receipts: { path: "execution-receipts.json", sha256: byteHash(await readFile(path.join(output, "execution-receipts.json"))) },
        originalAttempts: await originalInvocationFiles(output), originalNonrankingSlots: 680 });
    }
  }
  console.log(JSON.stringify({ mode, output, completedOriginals: observations.length, expectedSlots: slots.length, pending: pending.length, newlyAttempted: newlyDispatched, qualityAcceptance: false }));
  if (pending.length || queue.failures.length) process.exitCode = 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
