import { readFile, mkdir, readdir, writeFile, unlink, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USER_UNBOUNDED_EXECUTION_MODE } from '../../../src/lib/ai/execution-policy.mjs';
import { runAdaptiveSlotQueue } from '../../lib/adaptive-execution.mjs';
import { providerCapacityFeedback } from './evaluation-executor.mjs';
import { assert, byteHash, binding, boundBytes, writeNew, registerPilot, validateRegistration, validateObservation,
  summarizePilot, analyzePilotEvidence, sessionForCase, canonicalHash, REGISTRATION_SCHEMA, OWNED_FILES, ROOT, SCHEMA, COMPARISON_60_SELECTION } from './pilot-contract.mjs';

async function exists(filename) { try { await readFile(filename); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function acquireLock(output, registrationSha256, takeoverSha256) {
  const filename = path.join(output, 'coordinator.lock.json');
  if (await exists(filename)) {
    const bytes = await readFile(filename), prior = JSON.parse(bytes);
    assert(takeoverSha256 && byteHash(bytes) === takeoverSha256 && prior.hostname === os.hostname(), 'explicit_exact_same_host_dead_lock_takeover_required');
    assert(Number.isSafeInteger(prior.pid) && prior.pid > 0, 'lock_pid_invalid');
    let dead = false; try { process.kill(prior.pid, 0); } catch (error) { dead = error.code === 'ESRCH'; }
    assert(dead, 'live_or_unknown_coordinator_cannot_be_taken_over');
    assert(byteHash(await readFile(filename)) === takeoverSha256, 'lock_changed_before_takeover');
    await rename(filename, path.join(output, `dead-lock-${takeoverSha256}.json`));
  }
  const value = { pid: process.pid, hostname: os.hostname(), nonce: randomUUID(), registrationSha256, createdAt: new Date().toISOString() };
  await writeNew(filename, value);
  return async () => {
    const current = JSON.parse(await readFile(filename));
    assert(current.nonce === value.nonce, 'coordinator_lock_ownership_changed'); await unlink(filename);
  };
}

/** At-most-once coordinator. Only the root-started browser driver can
 * perform UI work; register/describe/schema never create a driver or HTTP call. */
export async function executePilot(registrationBytes, { output, driver, resume = false, limit = 12, takeoverLockSha256, verifyBytes = true }) {
  const registrationSha256 = byteHash(registrationBytes), registration = JSON.parse(registrationBytes);
  // The public registration validator requires canonical order. The coordinator
  // also defends against permutations by resolving every session by identity;
  // original registration bytes remain untouched and hash-bound on resume.
  await validateRegistration(registration, { verifyBytes, requireCanonicalSessionOrder: false });
  assert(Number.isSafeInteger(limit) && limit >= 1 && limit <= 12, 'finite_1_to_12_slot_limit_required');
  const unbounded = registration.config.spend.executionMode === USER_UNBOUNDED_EXECUTION_MODE;
  if (unbounded) assert(limit === 12 && driver.supportsConcurrentCases === true && typeof driver.finalize === 'function', 'unbounded_pilot_requires_complete_matrix_concurrent_driver_and_final_accounting');
  output = path.resolve(output);
  if (!resume) {
    await mkdir(output, { mode: 0o700 });
    await writeFile(path.join(output, 'registration.json'), registrationBytes, { flag: 'wx', mode: 0o600 });
    await mkdir(path.join(output, 'manifests'), { mode: 0o700 });
  } else assert(byteHash(await readFile(path.join(output, 'registration.json'))) === registrationSha256, 'resume_exact_original_registration_required');
  const releaseLock = await acquireLock(output, registrationSha256, takeoverLockSha256);
  const observations = [], indeterminate = [], blockers = [];
  let dispatched = 0, initialized = false, scheduling = null, finalAccounting = null, schedulingTrace = null;
  try {
    for (const name of (await readdir(path.join(output, 'manifests'))).filter(n => /^\d+\.json$/.test(n))) {
      const prior = JSON.parse(await readFile(path.join(output, 'manifests', name)));
      assert(prior.registrationSha256 === registrationSha256, 'prior_manifest_registration_changed');
      for (const ref of prior.observations ?? []) await boundBytes(ref);
    }
    // Reuse completed originals, and classify orphaned intents before any new UI.
    for (let index = 0; index < registration.cases.length; index++) {
      const c = registration.cases[index], dir = path.join(output, `${String(index + 1).padStart(2, '0')}-${c.caseId}`);
      const session = sessionForCase(registration, c);
      const intentPath = path.join(dir, 'intent.json'), observationPath = path.join(dir, 'observation.json');
      if (await exists(intentPath)) {
        const intentBytes = await readFile(intentPath), intent = JSON.parse(intentBytes);
        assert(intent.registrationSha256 === registrationSha256 && intent.caseId === c.caseId && intent.sessionId === session.sessionId && intent.caseInputSha256 === canonicalHash(c), 'existing_intent_binding_changed');
        if (await exists(observationPath)) {
          const observed = validateObservation(JSON.parse(await readFile(observationPath)), intent, registration);
          assert(observed.intentOriginal?.sha256 === byteHash(intentBytes) && observed.intentOriginal.path === intentPath, 'pre_dispatch_intent_bytes_changed');
          if (intent.admission?.sourcePins) await boundBytes(intent.admission.sourcePins);
          for (const ref of observed.artifacts ?? []) await boundBytes(ref);
          observations.push(observed);
          if ((!unbounded && observed.status === 'indeterminate') || observed.stopFurtherDispatch === true) blockers.push('prior_indeterminate_or_stop_original_blocks_further_dispatch');
          if (observed.receipts.ledgerRows.length || observed.receipts.calls.length) {
            const proof = analyzePilotEvidence(observed.receipts, intent, registration);
            if (unbounded ? !proof.ownershipVerified : !proof.valid) blockers.push('prior_unclosed_original_accounting_blocks_further_dispatch');
          }
        } else indeterminate.push(c.caseId);
      } else assert(!await exists(observationPath), 'observation_without_pre_dispatch_intent');
    }
    if (indeterminate.length) blockers.push('orphaned_intent_not_reissued_unknown_dispatch');
    if (summarizePilot(registration, observations, indeterminate).ambiguousCrossJourneyEvidenceCases.length) blockers.push('ambiguous_reused_HTTP_or_run_call_ledger_identity_no_further_dispatch');
    async function initializeDriver() {
      if (initialized) return;
      initialized = true;
      try { await driver.initialize(registration, output); }
      catch (error) { blockers.push(`pre_dispatch_initialize_failed:${driver.safeError?.(error) ?? error.message}`); }
    }
    async function runCase(c, index, feedback) {
      if (blockers.length) return { kind: 'not_run', reason: blockers.at(-1), stopScheduling: true };
      const session = sessionForCase(registration, c);
      let admission;
      try { admission = await driver.beforeCase(c, index); }
      catch (error) { blockers.push(`pre_dispatch_admission_failed:${driver.safeError?.(error) ?? error.message}`); return { kind: 'not_run', stopScheduling: true, reason: blockers.at(-1) }; }
      const dir = path.join(output, `${String(index + 1).padStart(2, '0')}-${c.caseId}`);
      await mkdir(dir, { mode: 0o700 });
      const intent = { schemaVersion: 'saitu.pilot-intent.v7.1', intentId: randomUUID(), caseId: c.caseId,
        sessionId: session.sessionId, caseInputSha256: canonicalHash(c),
        registrationSha256, createdAt: new Date().toISOString(), attempt: 1, admission,
        spendRunId: registration.config.spend.runId, sourceRuntimePins: registration.config.productPins,
        promptVersions: registration.config.promptVersions, actualParticipants: 0, automaticPaidRetries: false };
      const intentBinding = await writeNew(path.join(dir, 'intent.json'), intent);
      dispatched++;
      let observed, feedbackReported = false;
      const caseFeedback = feedback ? async signal => { feedbackReported = true; await feedback(signal); } : undefined;
      try { observed = await driver.runCase(c, intent, dir, caseFeedback); }
      catch (error) {
        observed = { schemaVersion: 'saitu.pilot-observation.v7.1', intentId: intent.intentId, caseId: c.caseId,
          sessionId: intent.sessionId, registrationSha256, caseInputSha256: intent.caseInputSha256,
          observedAt: new Date().toISOString(), status: 'indeterminate', evidenceClass: 'ai_proxy_ui_pilot', actualParticipants: 0,
          steps: [{ name: 'driver_completion', status: 'failed', failure: driver.safeError?.(error) ?? error.message }], timing: null,
          receipts: { productRunIds: [], ledgerRows: [], calls: [], spendRunId: registration.config.spend.runId,
            authorizationPolicySha256: registration.config.spend.authorizationPolicySha256, realProviderDispatch: false,
            allPotentialDispatchesBound: false, allLedgerRowsAccounted: false },
          pinValidation: { before: false, after: false }, artifacts: [], stopFurtherDispatch: true, failure: 'driver_did_not_return_original_evidence_no_automatic_retry' };
      }
      observed.intentOriginal = intentBinding;
      validateObservation(observed, intent, registration);
      for (const ref of observed.artifacts ?? []) await boundBytes(ref);
      await writeNew(path.join(dir, 'observation.json'), observed); observations.push(observed);
      if (summarizePilot(registration, observations, indeterminate).ambiguousCrossJourneyEvidenceCases.length) blockers.push('ambiguous_reused_HTTP_or_run_call_ledger_identity_no_further_dispatch');
      if (!unbounded && observed.status === 'indeterminate') blockers.push('indeterminate_dispatch_or_unsettled_ledger_no_further_slots');
      if (observed.stopFurtherDispatch === true) blockers.push('driver_requested_global_stop_preserving_remaining_slots');
      if (observed.receipts.ledgerRows.length || observed.receipts.calls.length) {
        const proof = analyzePilotEvidence(observed.receipts, intent, registration);
        if (unbounded ? !proof.ownershipVerified : !proof.valid) blockers.push('unclosed_original_accounting_no_further_slots');
      }
      if (feedback && !feedbackReported) {
        for (const call of observed.receipts.calls) {
          const saved = call.originalReceipt, result = saved?.kind === 'receipt' ? { ...saved.receipt, upstreamAttempted: true } : saved?.result;
          const actualDispatch = Boolean(call.reservation_id && (saved?.kind === 'receipt' ||
            saved?.kind === 'result' && result?.upstreamAttempted === true && result.reason !== 'durable_outcome_unknown'));
          const signal = providerCapacityFeedback(result, actualDispatch);
          if (signal) await feedback(signal);
        }
      }
      await writeNew(path.join(dir, 'checkpoint.json'), { ...summarizePilot(registration, observations, indeterminate), registrationSha256, blockers: [...blockers] });
      return { kind: 'completed', value: observed, stopScheduling: blockers.length > 0, reason: blockers.at(-1) ?? null };
    }
    if (unbounded) {
      // Exact-resume closure also runs when every original journey already exists.
      await initializeDriver();
      if (!blockers.length) {
        const filename = path.join(output, `adaptive-scheduling-${randomUUID()}.jsonl`);
        const slots = registration.cases.map((c, index) => ({ c, index })).filter(({ c }) => !observations.some(o => o.caseId === c.caseId));
        scheduling = await runAdaptiveSlotQueue(slots, { run: ({ c, index }, _slotIndex, feedback) => runCase(c, index, feedback),
          sampleResources: driver.sampleResources?.bind(driver), shouldStopOnError: () => true,
          onEvent: async event => { await writeFile(filename, JSON.stringify(event) + '\n', { flag: 'a', mode: 0o600 }); } });
        schedulingTrace = await binding(filename);
        if (scheduling.stopReason) blockers.push(scheduling.stopReason);
      }
    } else {
      for (let index = 0; index < registration.cases.length && dispatched < limit && !blockers.length; index++) {
        const c = registration.cases[index]; if (observations.some(o => o.caseId === c.caseId)) continue;
        await initializeDriver(); if (blockers.length) break;
        await runCase(c, index);
      }
    }
    observations.sort((a, b) => registration.cases.findIndex(c => c.caseId === a.caseId) - registration.cases.findIndex(c => c.caseId === b.caseId));
    if (unbounded && initialized) {
      try {
        finalAccounting = await driver.finalize(observations);
        if (finalAccounting?.valid !== true) blockers.push('final_batch_accounting_not_closed_originals_retained');
      } catch (error) { finalAccounting = { valid: false, error: driver.safeError?.(error) ?? error.message }; blockers.push('final_batch_accounting_failed'); }
    }
    const summary = summarizePilot(registration, observations, indeterminate);
    const manifest = { ...summary, ...(unbounded ? { pilotGatePassed: summary.pilotGatePassed && !blockers.length && finalAccounting?.valid === true } : {}), createdAt: new Date().toISOString(), registrationSha256,
      blockers: [...new Set(blockers)], sourceBindings: registration.harness, modelCallsDispatchedByCoordinator: 0,
      executionMode: registration.config.spend.executionMode ?? 'finite',
      ...(unbounded ? { schedulingPolicy: registration.config.schedulingPolicy, driverSchedulingPolicy: driver.schedulingPolicy ?? null,
        schedulingTrace, schedulingStopReason: scheduling?.stopReason ?? null, finalAccounting } : {}),
      actualModelCalls: 'read_original_driver_receipts_and_ledger_not_inferred_from_journey_count',
      observations: await Promise.all(observations.map(o => binding(path.join(output, `${String(registration.cases.findIndex(c => c.caseId === o.caseId) + 1).padStart(2, '0')}-${o.caseId}`, 'observation.json')))) };
    const manifestSequence = (await readdir(path.join(output, 'manifests'))).filter(f => /^\d+\.json$/.test(f)).length + 1;
    const manifestBinding = await writeNew(path.join(output, 'manifests', `${String(manifestSequence).padStart(4, '0')}.json`), manifest);
    return { manifest, manifestBinding };
  } finally {
    try { if (initialized) await driver.close(); } finally { await releaseLock(); }
  }
}

function argumentsOf(argv) {
  const value = {}, flags = new Set(['--describe', '--schema', '--register', '--run', '--execute', '--root-dispatch', '--resume']);
  const named = new Set(['--config', '--registration', '--registration-sha256', '--output', '--limit', '--takeover-lock-sha256']);
  for (let i = 0; i < argv.length; i++) { const k = argv[i]; assert((flags.has(k) || named.has(k)) && !Object.hasOwn(value, k), 'unsupported_or_duplicate_pilot_option'); value[k] = flags.has(k) ? true : argv[++i]; assert(value[k] !== undefined, 'missing_pilot_option_value'); }
  assert(['--describe', '--schema', '--register', '--run'].filter(k => value[k]).length === 1, 'choose_one_pilot_mode'); return value;
}
async function main() {
  const cli = argumentsOf(process.argv.slice(2));
  if (cli['--describe']) { console.log(JSON.stringify({ paidCalls: 0, executed: false, owner: '/root/v7_rank_adjudicator', ownedFiles: OWNED_FILES,
    denominator: 12, actualParticipants: 0, comparison60Selection: COMPARISON_60_SELECTION, driver: 'tests/e2e/v7-pilot-browser.mjs',
    liveGuard: 'root must explicitly --run --execute --root-dispatch and RUN_V7_PILOT_LIVE=1 with real DB grant',
    registrationSchema: SCHEMA, commands: ['--schema --output NEW_SCHEMA.json', '--register --config ROOT_CONFIG.json --output NEW_REGISTRATION.json', '--run --execute --root-dispatch --registration REG.json --registration-sha256 SHA --output NEW_DIR [--limit 1..12]', 'same command plus --resume; failed/indeterminate intents are never reissued'] }, null, 2)); return; }
  assert(cli['--output'], 'new_output_required');
  if (cli['--schema']) { console.log(JSON.stringify(await writeNew(cli['--output'], REGISTRATION_SCHEMA))); return; }
  if (cli['--register']) { assert(cli['--config'], 'root_config_required'); const registered = await registerPilot(JSON.parse(await readFile(cli['--config']))); console.log(JSON.stringify(await writeNew(cli['--output'], registered))); return; }
  assert(cli['--execute'] && cli['--root-dispatch'] && process.env.RUN_V7_PILOT_LIVE === '1', 'root_explicit_live_dispatch_required');
  assert(process.cwd() === ROOT && cli['--registration'] && cli['--registration-sha256'], 'root_cwd_registration_and_hash_required');
  const bytes = await readFile(cli['--registration']); assert(byteHash(bytes) === cli['--registration-sha256'], 'original_registration_hash_changed');
  const { createPilotBrowserDriver } = await import(path.join(ROOT, 'tests/e2e/v7-pilot-browser.mjs'));
  const result = await executePilot(bytes, { output: cli['--output'], resume: Boolean(cli['--resume']), limit: cli['--limit'] ? Number(cli['--limit']) : 12,
    takeoverLockSha256: cli['--takeover-lock-sha256'], driver: createPilotBrowserDriver() });
  console.log(JSON.stringify({ manifest: result.manifestBinding, denominator: 12, passed: result.manifest.passed,
    failed: result.manifest.failed, indeterminate: result.manifest.indeterminate, notStarted: result.manifest.notStarted,
    comparison60Selection: COMPARISON_60_SELECTION, formalProductAcceptance: false }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  const message = [process.env.AI_API_KEY, process.env.DATABASE_URL, process.env.AI_CONVERSATION_SIGNING_SECRET].filter(Boolean)
    .reduce((message, secret) => message.split(secret).join('[REDACTED]'), error instanceof Error ? error.message : 'pilot_tool_failed');
  console.error(message); process.exitCode = 1;
});
