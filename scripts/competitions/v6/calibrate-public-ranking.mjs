/** Public development calibration only. Never reads sealed cases or changes the formal runner. */
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { canonicalHash, deriveRunSeed, seededShuffle } from './frozen-ranking-executor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outputRoot = path.join(root, 'artifacts/specialist-20261106/c-development');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
const runName = args[args.indexOf('--name') + 1];
const live = args.includes('--live');
const diagnosticStageMs = args.includes('--diagnostic-stage-ms') ? Number(args[args.indexOf('--diagnostic-stage-ms') + 1]) : null;
if (diagnosticStageMs !== null && (!Number.isInteger(diagnosticStageMs) || diagnosticStageMs < 40000 || diagnosticStageMs > 120000)) throw new Error('bounded_nonproduction_diagnostic_timeout_required');
if (!args.includes('--name') || !/^[a-z0-9-]{1,80}$/.test(runName ?? '')) throw new Error('requires_unique_public_run_name');
const repetitions = args.includes('--repeats') ? Number(args[args.indexOf('--repeats') + 1]) : 5;
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) throw new Error('one_to_five_preregistered_repetitions_required');
const output = path.join(outputRoot, runName);
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
await mkdir(output, { recursive: false, mode: 0o700 });
const snapshot = path.join(output, 'source');
await mkdir(snapshot);

async function files(directory, base = directory) {
  const found = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(file, base));
    else if (entry.isFile()) found.push({ path: path.relative(base, file), sha256: sha(await readFile(file)) });
  }
  return found;
}
const original = await files(path.join(root, 'src'));
await cp(path.join(root, 'src'), path.join(snapshot, 'src'), { recursive: true });
await mkdir(path.join(snapshot, 'tests/fixtures'), { recursive: true });
await cp(path.join(root, 'tests/fixtures/server-only.ts'), path.join(snapshot, 'tests/fixtures/server-only.ts'));
await cp(path.join(root, 'package.json'), path.join(snapshot, 'package.json'));
await symlink(path.join(root, 'node_modules'), path.join(snapshot, 'node_modules'), 'dir');
const copied = await files(path.join(snapshot, 'src'));
if (canonicalHash(original) !== canonicalHash(copied) || canonicalHash(original) !== canonicalHash(await files(path.join(root, 'src')))) throw new Error('source_changed_while_copying');
const implementationSha256 = canonicalHash(copied);
await writeFile(path.join(output, 'implementation-snapshot.json'), JSON.stringify({ implementationSha256, files: copied }, null, 2) + '\n', { flag: 'wx' });
const inputBytes = await readFile(path.join(root, 'artifacts/v6/evaluation/experiment-profiles.json'));
const sourceInput = JSON.parse(inputBytes);
const publicRow = sourceInput.profiles.find(row => row.profileId === 'SEED-049');
if (!publicRow || sourceInput.origin !== 'synthetic_confirmed_choices_from_public_development_seeds') throw new Error('exact_public_development_input_required');
const input = JSON.parse(JSON.stringify(publicRow));
await writeFile(path.join(output, 'public-input.json'), JSON.stringify({ origin: sourceInput.origin, input }, null, 2) + '\n', { flag: 'wx' });

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(root, true, { info() {}, error() {} }, true);
if (process.env.AI_PROVIDER !== 'deepseek' || !process.env.AI_API_KEY || process.env.AI_SPEND_PHASE !== 'calibration' || process.env.AI_TEST_MODE === '1' || process.env.ALLOW_AI_MOCK === '1') throw new Error('existing_real_flash_calibration_configuration_required');
const database = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) throw new Error('isolated_local_existing_ledger_required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 3000 });
const runId = process.env.AI_SPEND_RUN_ID;
async function ledger(ids) {
  const where = ids ? 'and id = any($2::uuid[])' : '';
  const rows = (await pool.query(`select id,run_id,model,effort,operation,phase,state,reserved_micros::text,charged_micros::text,input_tokens::text,output_tokens::text,cached_input_tokens::text,created_at,settled_at from ai_spend_ledger where run_id=$1 ${where} order by created_at,id`, ids ? [runId, ids] : [runId])).rows;
  return { observedAt: new Date().toISOString(), runId, rows, calls: rows.filter(row => row.state !== 'cancelled').length, accountedMicros: rows.reduce((sum, row) => sum + Number(row.charged_micros ?? row.reserved_micros), 0) };
}
const allocationPath = path.join(outputRoot, 'allocation-start.json');
try { await readFile(allocationPath); } catch {
  await writeFile(allocationPath, JSON.stringify({ createdAt: new Date().toISOString(), incrementalHttpLimit: 28, incrementalAccountedMicrosLimit: 12_000_000, totalCalibrationCallsLimit: 100, totalCalibrationMicrosLimit: 30_000_000, ledger: await ledger() }, null, 2) + '\n', { flag: 'wx' });
}
const eventPath = path.join(outputRoot, 'accounting-events.jsonl');
let previousEvents = [];
try { previousEvents = (await readFile(eventPath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse); } catch {}
const ownIds = new Set(previousEvents.filter(event => event.type === 'ai_budget_reserved').map(event => event.details.reservationId));
let ownDispatches = previousEvents.filter(event => event.type === 'ai_transport_dispatch').length;
const ledgerBefore = await ledger();
await writeFile(path.join(output, 'ledger-before.json'), JSON.stringify(ledgerBefore, null, 2) + '\n', { flag: 'wx' });
const dependencies = createRequire(import.meta.resolve('vitest/package.json'));
const { createServer } = await import(dependencies.resolve('vite'));
const server = await createServer({ root: snapshot, configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, watch: null }, resolve: { alias: { '@': path.join(snapshot, 'src'), 'server-only': path.join(snapshot, 'tests/fixtures/server-only.ts') } }, appType: 'custom', logLevel: 'silent' });
try {
  const [engine, model, ai, observation, spend, scope, pack, validation] = await Promise.all([
    '/src/lib/competitions/v6/engine.ts', '/src/lib/competitions/v6/model.ts', '/src/lib/ai/ai-client.ts', '/src/lib/ai/product-observation.ts', '/src/lib/ai/spend-ledger.ts', '/src/lib/ai/spend-run-context.ts', '/src/lib/competitions/v6/model-evidence-pack.ts', '/src/lib/competitions/v6/validation.ts',
  ].map(module => server.ssrLoadModule(module)));
  if (ai.getConfiguredAiModel() !== 'deepseek-flash' || ai.getConfiguredReasoningEffort() !== 'max') throw new Error('exact_flash_max_required');
  const asOf = new Date();
  const context = engine.buildDecisionContext(input.profile, { now: asOf, profileId: input.profileId });
  const contextJson = JSON.parse(JSON.stringify(context));
  const candidateIds = context.candidates.map(candidate => candidate.record.recordId);
  if (!candidateIds.length) throw new Error('nonempty_full_published_pool_required');
  const seed = 61106049;
  const orders = Array.from({ length: repetitions }, (_, index) => {
    const repetition = index + 1, shuffleSeed = deriveRunSeed(seed, input.profileId, repetition);
    return { repetition, shuffleSeed, candidateOrder: seededShuffle(candidateIds, shuffleSeed) };
  });
  const registration = { schemaVersion: 'saitu.public-ranking-calibration.v1', registeredAt: new Date().toISOString(), runName, origin: sourceInput.origin, acceptanceEligible: false, sealedInputsRead: 0, model: 'deepseek-flash', thinking: 'enabled', reasoningEffort: 'max', method: 'llm', repeats: repetitions, seed, implementationSha256, publicSourceSha256: sha(inputBytes), inputSha256: canonicalHash(input), contextSha256: canonicalHash(contextJson), catalogSha256: canonicalHash(contextJson.records), candidateSetSha256: canonicalHash([...candidateIds].sort()), candidateCount: candidateIds.length, skipIndependentRecall: true, orders, allocation: { incrementalHttpLimit: 28, incrementalAccountedMicrosLimit: 12_000_000, cumulativeCalibrationCalls: 100, cumulativeCalibrationMicros: 30_000_000 }, liveRequested: live, diagnosticTransportOnly: diagnosticStageMs !== null, diagnosticStageMs, config: { provider: 'deepseek', reasoningEffort: 'max', spendRunId: runId, spendPhase: process.env.AI_SPEND_PHASE, apiTimeoutMs: Number(process.env.AI_TIMEOUT_MS) || null, requestDeadlineMs: Number(process.env.AI_REQUEST_DEADLINE_MS) || null, mock: false } };
  await writeFile(path.join(output, 'context.json'), JSON.stringify(contextJson, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(output, 'registration.json'), JSON.stringify(registration, null, 2) + '\n', { flag: 'wx' });
  if (!live) { console.log(JSON.stringify({ output, registered: repetitions, candidateCount: candidateIds.length, paidCalls: 0 })); }
  else {
    const results = [];
    for (const order of orders) {
      const invocationId = randomUUID(), events = [], stages = [], requests = [], startedAt = new Date().toISOString();
      const start = Date.now();
      const observer = event => {
        const entry = { ...event, runName, invocationId };
        events.push(entry);
        if (event.type.startsWith('ai_')) appendFileSync(eventPath, JSON.stringify(entry) + '\n', { mode: 0o600 });
        if (event.type === 'ai_budget_reserved') ownIds.add(event.details.reservationId);
        if (event.type === 'ai_transport_dispatch') ownDispatches++;
      };
      const guardedCall = async (prompt, options) => {
        if (diagnosticStageMs !== null) options = { ...options, timeoutMs: diagnosticStageMs, deadlineEpochMs: Date.now() + diagnosticStageMs, requestDeadlineMs: diagnosticStageMs };
        const own = await ledger([...ownIds]);
        const reserveMicros = spend.requestReserveMicros(options.systemPrompt ?? '', prompt, options.maxTokens ?? 8192);
        const expanded = pack.expandCandidateEvidence(JSON.parse(prompt));
        requests.push({ stage: options.promptVersion.split('.').at(-1), promptSha256: sha(prompt), promptBytes: Buffer.byteLength(prompt), expandedPromptBytes: Buffer.byteLength(JSON.stringify(expanded)), candidateCount: expanded.candidates?.length ?? null, candidateIds: expanded.candidates?.map(candidate => candidate.itemId) ?? [], reserveMicros, model: options.model, thinking: options.thinking, reasoningEffort: options.reasoningEffort, timeoutMs: options.timeoutMs, deadlineEpochMs: options.deadlineEpochMs, maxTokens: options.maxTokens });
        if (ownDispatches >= 28 || own.accountedMicros + reserveMicros > 12_000_000) return { ok: false, reason: 'spend_budget_exhausted', upstreamAttempted: false, model: 'deepseek-flash', attempts: 0 };
        const all = await ledger();
        return scope.withAiSpendLimit(Math.min(all.accountedMicros + 12_000_000 - own.accountedMicros, Number(process.env.AI_SPEND_LIMIT_CNY) * 1_000_000), () => ai.requestAiJson(prompt, options));
      };
      const report = await observation.withProductObservation({ observer }, () => model.runDecisionRecommendation(input.profile, { method: 'llm', context, experiment: { candidateItemIds: [...candidateIds], candidateOrder: order.candidateOrder, shuffleSeed: order.shuffleSeed, skipIndependentRecall: true, reasoningEffort: 'max' }, modelCall: guardedCall, onObservation: async event => stages.push(event) }));
      const checked = validation.validateDecisionReport(report, context);
      const row = { invocationId, repetition: order.repetition, startedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - start, candidateSetSha256: registration.candidateSetSha256, candidateOrder: order.candidateOrder, fullPoolCount: candidateIds.length, outputSha256: canonicalHash(report), report, validation: checked, requests, stages, events, realHttpDispatches: events.filter(event => event.type === 'ai_transport_dispatch').length, reservationIds: events.filter(event => event.type === 'ai_budget_reserved').map(event => event.details.reservationId), contextUnchanged: canonicalHash(JSON.parse(JSON.stringify(context))) === registration.contextSha256 };
      await writeFile(path.join(output, `run-${order.repetition}.json`), JSON.stringify(row, null, 2) + '\n', { flag: 'wx' });
      results.push(row);
      console.log(JSON.stringify({ runName, repetition: order.repetition, elapsedMs: row.elapsedMs, fallback: report.fallback, modelCalls: report.trace.callCount, httpDispatches: row.realHttpDispatches, outputCount: report.recommendations.length, validation: checked.ok }));
    }
    const own = await ledger([...ownIds]);
    const finalFiles = await files(path.join(snapshot, 'src'));
    const completedModelReports = results.filter(row => !row.report.fallback.used && row.report.trace.method === 'llm' && row.report.trace.verification === 'model_reviewed' && row.report.recommendations.length > 0).length;
    const summary = { schemaVersion: 'saitu.public-ranking-calibration-result.v1', runName, completedAt: new Date().toISOString(), registeredRuns: repetitions, completedRuns: results.length, successfulCRuns: diagnosticStageMs === null ? completedModelReports : 0, diagnosticCompletedModelReports: diagnosticStageMs !== null ? completedModelReports : 0, fallbackRuns: results.filter(row => row.report.fallback.used).length, actualHttpDispatches: results.reduce((sum, row) => sum + row.realHttpDispatches, 0), allocationHttpDispatches: ownDispatches, allocationAccountedMicros: own.accountedMicros, frozenSourceUnchanged: canonicalHash(finalFiles) === implementationSha256, contextsUnchanged: results.every(row => row.contextUnchanged), implementationSha256, candidateCount: candidateIds.length, actualObservedLatencyMs: results.map(row => row.elapsedMs), diagnosticTransportOnly: diagnosticStageMs !== null, diagnosticStageMs, qualityLabelsAvailable: false, acceptanceEligible: false, pageOrBrowserExecution: false, paidUsageIsPriceSnapshotEstimateNotInvoice: true };
    await writeFile(path.join(output, 'ledger-after.json'), JSON.stringify(await ledger(), null, 2) + '\n', { flag: 'wx' });
    await writeFile(path.join(output, 'allocation-ledger-after.json'), JSON.stringify(own, null, 2) + '\n', { flag: 'wx' });
    await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(summary));
  }
} finally { await server.close(); await pool.end(); }
