import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { FAST24_MATCH_POLICY_VERSION } from "../../../scripts/competitions/v7/fast24-config.mjs";
import { byteHash, canonicalHash } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { fast24RuntimeBinding, readFast24, runFast24, summarizeFast24 } from "../../../scripts/competitions/v7/fast24.mjs";
import { assertStep8Dispatch, firstWaveOriginals, step8DispatchSlotIds, step8OriginalsSha256, step8ScopeMatches, step8SlotPlan, STEP8_RUN_SCHEMA } from "../../../scripts/competitions/v7/fast24-step8.mjs";
import { verifyFast24RepairPolicy } from "../../../scripts/competitions/v7/fast24-repair-authorization.mjs";
import { prepareEffortBudgetCondition } from "../../../scripts/competitions/v6/effort-budget-condition.mjs";
import { runtimeConfigurationHash } from "../../../scripts/competitions/v6/runtime-configuration.mjs";
import { effortPolicySha256, RANK_NON_THINKING_EFFORT_POLICY } from "../../../src/lib/ai/effort-policy.mjs";
import { FAST24_REPAIR_AUTHORIZATION_POLICY, FAST24_REPAIR_AUTHORIZATION_RECORD, USER_UNBOUNDED_GRANT_VERSION } from "../../../src/lib/ai/execution-policy.mjs";

const source = await readFast24("artifacts/fast24-20261109/D/selection-v2");
const candidate = { applicationRuntimeSourceSha256: "1".repeat(64), productionBuildId: "test-build-id", candidatePoolSha256: "2".repeat(64) };
const repair = "repair_validation";
const artifacts = "artifacts/step8-first-20261111";

async function put(root, member, value) {
  const filename = path.join(root, member);
  await mkdir(path.dirname(filename), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(value));
  await writeFile(filename, bytes);
  return { path: filename, sha256: byteHash(bytes) };
}

async function isolated(t, frozenCandidate = candidate) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "saitu-step8-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, artifacts, "D", "validation");
  const stages = step8SlotPlan(source.manifest, source.inputs.ranking.profiles);
  const manifest = { ...source.manifest, inheritedOriginals: [], acceptanceRun: { schemaVersion: STEP8_RUN_SCHEMA,
    runPurpose: repair, matchPolicyVersion: FAST24_MATCH_POLICY_VERSION, candidate: frozenCandidate, stages } };
  const selection = await put(root, path.relative(root, path.join(output, "manifest.json")), manifest);
  const repairValidation = { ...frozenCandidate, schemaVersion: "saitu.fast24.repair-validation.v1", selectionSha256: selection.sha256 };
  const scope = { ...frozenCandidate, runPurpose: repair, phase: "repair", authorizedPhase: "repair", rootIsOnlyDispatcher: true,
    acceptanceSelectionManifest: selection, matchPolicyVersion: FAST24_MATCH_POLICY_VERSION, repairValidation,
    fast24BehaviorImplementationSha256: "3".repeat(64), executionRuntimeConfigurationSha256: "4".repeat(64) };
  const prepared = { ...source, manifest, output, selectionSha256: selection.sha256 };
  return { root, prepared, scope, stages };
}

test("repair selection takes two originals from the first case of each frozen group", async t => {
  const { prepared, stages } = await isolated(t);
  const first = new Set(stages.first);
  const chosen = prepared.manifest.slots.filter(slot => first.has(slot.slotId));
  for (const group of new Set(source.inputs.ranking.profiles.map(profile => profile.taskGroup))) {
    const profile = source.inputs.ranking.profiles.find(profile => profile.taskGroup === group);
    assert.deepEqual(chosen.filter(slot => slot.caseId === profile.caseId).map(slot => slot.repetition), [0, 1]);
  }
  assert.equal(new Set([...stages.local, ...stages.first, ...stages.remainder, ...stages.other]).size, 468);
  assert.equal(stages.remainder.length, 36);
  assert.equal(stages.other.length, 72);
});

test("repair remainder requires review of the exact twelve originals, while other diagnostics run independently", async t => {
  const { root, prepared, scope, stages } = await isolated(t);
  const settled = new Set([...stages.local, ...stages.first]);
  const summary = { slots: prepared.manifest.slots.map((slot, index) => ({ ...slot,
    ...(settled.has(slot.slotId) ? { status: "observed", original: { sha256: index.toString(16).padStart(64, "0") } } : { status: "not_run" }) })) };
  const run = (stage, waveReview) => assertStep8Dispatch(root, { prepared, scope, summary, stage, waveReview,
    selected: prepared.manifest.slots.filter(slot => stages[stage].includes(slot.slotId)) });
  await run("other");
  await assert.rejects(run("remainder"), /bound_reference_required/);
  const evidence = await Promise.all([put(root, `${artifacts}/E/review.json`, { case: "first wave" }), put(root, `${artifacts}/F/review.json`, { case: "first wave" })]);
  const vote = { schemaVersion: "saitu.fast24.first-wave-review.v1", reviewer: "E", independent: true, locked: true,
    selectionSha256: prepared.selectionSha256, decision: "expand", ...candidate, slots: firstWaveOriginals(summary, stages), evidence };
  const review = await put(root, `${artifacts}/E/wave.json`, vote);
  await run("remainder", review);
  summary.slots.find(slot => slot.slotId === stages.first[0]).original.sha256 = "f".repeat(64);
  await assert.rejects(run("remainder", review), /independent_first_wave_expansion_decision_required/);
  assert.throws(() => step8ScopeMatches(prepared, { ...scope, productionBuildId: "new-build" }), /frozen_purpose_selection_source_and_build_required/);
});

test("budget preparation accepts the repair cohort without a pilot proof and rejects promotion or changed manifest bytes", async t => {
  const { root, prepared, scope } = await isolated(t);
  const policy = await put(root, FAST24_REPAIR_AUTHORIZATION_POLICY, { approval: "disposable repair test" });
  await put(root, FAST24_REPAIR_AUTHORIZATION_RECORD, { schemaVersion: "saitu.step8-first.authorization.v1", policy,
    resumeAuthorized: true, rootOnlyPaidDispatch: true, repairRequiresFreshFixed3: false, eachFull468Fresh: true,
    productionDeployment: false, provider: "deepseek", budget: "user-unbounded" });
  const effort = await put(root, "effort.json", RANK_NON_THINKING_EFFORT_POLICY);
  const binding = await put(root, path.relative(root, path.join(prepared.output, "repair-validation-binding.json")), scope.repairValidation);
  const args = { root, policyFile: policy.path, effortPolicyFile: effort.path, phase: "repair", mainRunId: "test-main", priorLedger: [],
    executionMode: "user-unbounded", repairValidationFile: binding.path };
  const grant = await prepareEffortBudgetCondition(args);
  assert.deepEqual(grant.condition.repairValidation, scope.repairValidation);
  assert.equal(grant.condition.pilotContinuation, null);
  await assert.rejects(prepareEffortBudgetCondition({ ...args, phase: "formal" }), /fast24_repair_phase_and_frozen_binding_required/);
  await assert.rejects(prepareEffortBudgetCondition({ ...args, pilotProofFile: "prior-proof.json" }), /pilot_proof_only_for_rank_nonthinking_continuation/);
  await writeFile(scope.acceptanceSelectionManifest.path, "{}");
  await assert.rejects(prepareEffortBudgetCondition(args), /repair_binding_does_not_match_frozen_candidate/);
});

test("repair diagnostics select direct operations and robustness pairs that execute them in frozen order", async t => {
  const { prepared, scope, stages } = await isolated(t);
  const slots = new Map(prepared.manifest.slots.map(slot => [slot.slotId, slot]));
  const inputs = new Map(prepared.inputs.product.cases.map(row => [row.caseId, row.input]));
  for (const [operation, directCount, dependentCount] of [["fact_check", 24, 3], ["extract_profile", 24, 6], ["conversation", 12, 2], ["robustness", 12, 0]]) {
    const picked = step8DispatchSlotIds(prepared, scope, stages, "other", [operation]);
    assert.equal(picked.filter(id => slots.get(id).operation === operation).length, directCount);
    const dependent = picked.filter(id => slots.get(id).operation !== operation);
    assert.equal(dependent.length, dependentCount);
    for (const id of dependent) {
      const slot = slots.get(id), input = inputs.get(slot.caseId);
      assert.equal(slot.operation, "robustness");
      assert([input.base.operation, input.perturbed.operation].includes(operation));
    }
    assert.deepEqual(picked, stages.other.filter(id => picked.includes(id)));
  }
  const requested = ["conversation", "fact_check", "robustness"];
  const allRobustness = step8DispatchSlotIds(prepared, scope, stages, "other", requested);
  assert.equal(allRobustness.length, 48);
  assert.deepEqual(allRobustness, step8DispatchSlotIds(prepared, scope, stages, "other", [...requested].reverse()));
  for (const invalid of [[], [""], ["fact_check", "fact_check"], ["unknown"], ["constraint_check"]]) {
    assert.throws(() => step8DispatchSlotIds(prepared, scope, stages, "other", invalid), /distinct_frozen_other_operations/);
  }
  assert.throws(() => step8DispatchSlotIds(prepared, scope, stages, "first", ["fact_check"]), /require_repair_other_stage/);
  const finalScope = { ...scope, runPurpose: "final_acceptance" };
  assert.throws(() => step8DispatchSlotIds(prepared, finalScope, stages, "other", ["fact_check"]), /require_repair_other_stage/);
  assert.deepEqual(step8DispatchSlotIds(prepared, finalScope, stages, "other"), stages.other);
});

test("resuming a repair cohort dispatches only unstarted slots after filtered diagnostics", async t => {
  const records = Array.from({ length: 45 }, (_, index) => ({ id: `isolated-record-${index}` }));
  const { prepared, scope, stages } = await isolated(t, { ...candidate, candidatePoolSha256: canonicalHash(records) });
  const output = prepared.output;
  await cp(path.join(source.output, "inputs"), path.join(output, "inputs"), { recursive: true });
  const { policySha256, repairAuthorizationRecordSha256 } = await verifyFast24RepairPolicy(process.cwd());
  const effortPolicy = RANK_NON_THINKING_EFFORT_POLICY, effortHash = effortPolicySha256(effortPolicy);
  const environment = { AI_PROVIDER: "deepseek", AI_MODEL: "deepseek-flash", AI_SPEND_RUN_ID: "isolated-repair-run", AI_SPEND_PHASE: "repair",
    AI_SPEND_POLICY_SHA256: policySha256, SAITU_AI_EXECUTION_MODE: "user-unbounded", SAITU_V7_SOURCE_SHA256: scope.applicationRuntimeSourceSha256,
    SAITU_V7_EFFORT_POLICY: JSON.stringify(effortPolicy), SAITU_V7_EFFORT_POLICY_SHA256: effortHash };
  const prior = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  Object.assign(process.env, environment);
  Object.assign(scope, { runId: environment.AI_SPEND_RUN_ID, grantVersion: USER_UNBOUNDED_GRANT_VERSION, authorizedEffort: "stage",
    executionMode: "user-unbounded", effortPolicy, effortPolicySha256: effortHash, effortConditionSha256: "a".repeat(64),
    authorizationPolicySource: FAST24_REPAIR_AUTHORIZATION_POLICY, pilotContinuation: null, authorizationPolicySha256: policySha256,
    authorizationPolicySnapshot: { path: FAST24_REPAIR_AUTHORIZATION_POLICY, sha256: policySha256 }, repairAuthorizationRecordSha256,
    fast24BehaviorImplementationSha256: fast24RuntimeBinding(), executionRuntimeConfigurationSha256: runtimeConfigurationHash() });
  await put(output, "execution-scope.json", scope);

  const operations = ["fact_check"], chosen = step8DispatchSlotIds(prepared, scope, stages, "other", operations);
  const failed = chosen[0], unknown = chosen.at(-1), calls = [];
  let grantState = "active";
  const modules = { catalog: { getMatchingCatalogRecords: () => records }, database: { getPool: () => ({ query: async (sql, args) => {
    assert.match(sql, /from ai_spend_development_batches/);
    assert.deepEqual(args, [scope.runId]);
    return { rows: [{ state: grantState, execution_mode: scope.executionMode, authorized_phase: scope.phase,
      policy_sha256: policySha256, effort_policy_sha256: effortHash, effort_condition_sha256: scope.effortConditionSha256,
      effort_condition: { sourcePolicy: scope.authorizationPolicySource, runPurpose: scope.runPurpose, repairAuthorizationRecordSha256,
        repairValidation: scope.repairValidation, pilotContinuation: null } }] };
  } }) } };
  const execute = async (row, options) => {
    const slotId = `${row.caseId}:${row.operation}:${options.repetition}`;
    calls.push(slotId);
    if (slotId === unknown) throw new Error("isolated_interruption_after_intent");
    const output = { slotId };
    return { observation: { caseId: row.caseId, repetition: options.repetition, inputSha256: canonicalHash(row.input),
      status: slotId === failed ? "error" : "observed", output, outputSha256: canonicalHash(output), freezeBinding: options.freezeBinding,
      execution: { httpDispatches: 0, executionRuntimeConfigurationSha256: options.executionRuntimeConfigurationSha256 }, reservationIds: [] } };
  };
  const run = { output, phase: "product", scope, executePaid: true, step8Stage: "other", modules, execute,
    sampleResources: () => ({ initialConcurrency: 1, capacity: 1 }) };
  await assert.rejects(runFast24({ ...run, operations, slotIds: stages.other }), /dispatch_must_use_the_frozen_stage_slots/);
  const targeted = await runFast24({ ...run, operations, slotIds: chosen });
  assert.deepEqual(calls, chosen);
  assert.equal(targeted.unstartedSlotsAtLaunch, 27);
  assert.deepEqual(targeted.statuses, { observed: 25, error: 1, indeterminate: 1, not_run: 441 });
  const beforeResume = await summarizeFast24(output, { write: false });
  assert.throws(() => step8OriginalsSha256(beforeResume), /all_468_fresh_terminal_originals_required/);

  process.env.SAITU_V7_SOURCE_SHA256 = "f".repeat(64);
  await assert.rejects(runFast24({ ...run, slotIds: stages.other }), /step8_runtime_source_or_cohort_changed/);
  process.env.SAITU_V7_SOURCE_SHA256 = environment.SAITU_V7_SOURCE_SHA256;
  const full = await runFast24({ ...run, slotIds: stages.other });
  const missing = stages.other.filter(id => !chosen.includes(id));
  assert.deepEqual(calls, [...chosen, ...missing]);
  assert.equal(full.selectedSlots, 72);
  assert.equal(full.unstartedSlotsAtLaunch, 45);
  assert.deepEqual(full.statuses, { observed: 70, error: 1, indeterminate: 1, not_run: 396 });
  const afterResume = await summarizeFast24(output, { write: false });
  const current = new Map(afterResume.slots.map(slot => [slot.slotId, slot]));
  for (const slot of beforeResume.slots.filter(slot => chosen.includes(slot.slotId))) assert.deepEqual(current.get(slot.slotId), slot);
  assert.equal(afterResume.expectedSlots, 468);
  assert.equal(afterResume.finalAcceptancePassed, false);
  const traceFiles = (await readdir(output)).filter(name => name.startsWith("scheduling-"));
  const starts = [];
  for (const name of traceFiles) {
    const events = (await readFile(path.join(output, name), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    starts.push(...events.filter(event => event.type === "slot_started").map(event => event.slotId));
  }
  assert.deepEqual(starts.sort(), [...stages.other].sort());
  grantState = "closed";
  await assert.rejects(runFast24({ ...run, slotIds: stages.other }), /existing_live_grant_required/);
  assert.equal(calls.length, 72);
});
