// Fast24's 30-request performance path. The older 100-request policy is unchanged.
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { chromium, devices, expect } from '@playwright/test';
import { canonicalHash, byteHash, isHash, POLICY_VERSION } from '../../scripts/competitions/v7/evaluation-policy.mjs';
import { installSourceLoader } from '../../scripts/lib/load-typescript-source.mjs';
import { fillPublicBrowserProfile, installPublicBrowserProbe } from './v7-performance-browser.mjs';
import { browserDeliveryLimits, publicClickEpochMs, browserDeliveryTimeout, waitForBrowserDelivery, deliveryThresholds } from './v7-browser-timing.mjs';
import { assertBrowserEffortEnvironment, assertBrowserEffortGrant, assertBrowserLiveExecutionMode,
  assertBrowserDatabaseLimits, assertBrowserWorkerExecutionMode, hasBrowserBoundProviderDispatch } from './v7-browser-effort.mjs';
import { installBrowserExecutionAuthorization } from './v7-browser-execution.mjs';
import { createBrowserOriginalCapture, closeBrowserBatchOriginals } from './v7-browser-originals.mjs';
import { runAdaptiveBrowserCases, BROWSER_SCHEDULING_POLICY } from './v7-browser-scheduling.mjs';
import { safePilotError } from './v7-pilot-browser.mjs';
import { FAST24_PERFORMANCE, fast24PerformancePlan, hasFast24PerformanceDelivery, scoreFast24Performance } from './fast24-performance-contract.mjs';
import { hasFast24RecommendationCount } from '../../scripts/competitions/v7/fast24-config.mjs';
import { verifyRankNonThinkingContinuationScope } from '../../scripts/competitions/v7/rank-nonthinking-pilot-proof.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SELF = fileURLToPath(import.meta.url);
const PLAN = path.join(ROOT, 'tests/e2e/fixtures/v7-performance-browser-plan.json');
const HARNESS = ['tests/e2e/fast24-performance-browser.mjs', 'tests/e2e/fast24-performance-contract.mjs', 'scripts/competitions/v7/fast24-config.mjs',
  'tests/e2e/v7-performance-browser.mjs', 'tests/e2e/v7-browser-timing.mjs', 'tests/e2e/v7-browser-effort.mjs',
  'tests/e2e/v7-browser-execution.mjs', 'tests/e2e/v7-browser-originals.mjs', 'tests/e2e/v7-browser-scheduling.mjs', 'scripts/lib/adaptive-execution.mjs'];
const demand = (value, message) => { if (!value) throw new Error(message); };
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const writeNew = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const harnessHash = async () => {
  const rows = await Promise.all(HARNESS.map(async name => ({ path: name, sha256: byteHash(await readFile(path.join(ROOT, name))) })));
  return canonicalHash(rows);
};

function options(args) {
  const result = {}, flags = new Set(['--describe', '--prepare', '--run', '--root-dispatch']);
  const names = new Set(['--config', '--config-sha256', '--output', '--next-dist', '--worker-manifest']);
  for (let index = 0; index < args.length; index++) {
    const key = args[index]; demand((flags.has(key) || names.has(key)) && !Object.hasOwn(result, key), 'unsupported_or_duplicate_fast24_option');
    result[key] = flags.has(key) ? true : args[++index]; demand(result[key] !== undefined, 'missing_fast24_option_value');
  }
  demand(['--describe', '--prepare', '--run'].filter(key => result[key]).length === 1, 'choose_one_fast24_mode');
  return result;
}

export function validateFast24PerformanceConfig(config) {
  demand(config.schemaVersion === 'saitu.fast24-performance-config.v1' && config.purpose === 'fast24_performance', 'fast24_performance_config_required');
  const base = new URL(config.baseUrl);
  demand(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname) && !base.username && !base.password && base.pathname === '/' && !base.search && !base.hash, 'explicit_local_url_required');
  demand(isHash(config.runtimeSourceBindingSha256) && isHash(config.candidatePoolSha256) && isHash(config.runnerSha256) && isHash(config.fast24HarnessSha256), 'fast24_current_source_and_collector_bindings_required');
  demand(path.isAbsolute(config.workerHealthFile) && path.isAbsolute(config.serverAccountingLog?.path ?? '') && config.serverAccountingLog.format === 'competition_accounting_trace.jsonl' && config.serverAccountingLog.sourceSha256 === config.runtimeSourceBindingSha256, 'same_source_worker_and_accounting_files_required');
  demand(config.spend?.phase === 'performance' && isHash(config.spend.authorizationPolicySha256) && typeof config.spend.approvedPolicyPath === 'string' && !path.isAbsolute(config.spend.approvedPolicyPath) && !config.spend.approvedPolicyPath.split(/[\\/]/).includes('..'), 'fresh_performance_grant_reference_required');
  demand(config.productionBuild && path.isAbsolute(config.productionBuild.directory) && typeof config.productionBuild.nextBuildId === 'string' && config.productionBuild.nextBuildId !== 'development' && config.productionBuild.nextBuildId.length >= 8 &&
    path.isAbsolute(config.productionBuild.workerManifestPath) && isHash(config.productionBuild.workerManifestSha256) && isHash(config.productionBuild.nextBindingSha256), 'actual_production_build_binding_required');
  demand(canonicalHash(config.plan) === config.fast24PlanSha256 && config.plan.matchPolicyVersion === FAST24_PERFORMANCE.matchPolicyVersion && config.plan.cases.length === 30 &&
    new Set(config.plan.cases.map(row => row.caseId)).size === 30 && ['desktop', 'mobile'].every(viewport => config.plan.cases.filter(row => row.viewport === viewport).length === 15), 'frozen_30_request_plan_required');
  browserDeliveryLimits(config.timeouts);
  assertBrowserLiveExecutionMode(config.spend);
  assertBrowserEffortEnvironment(config.spend);
  return config;
}

async function validateCurrentArtifacts(config) {
  await verifyRankNonThinkingContinuationScope(ROOT,config.spend);
  demand(byteHash(await readFile(SELF)) === config.runnerSha256 && await harnessHash() === config.fast24HarnessSha256, 'fast24_collector_bytes_changed');
  demand(canonicalHash(fast24PerformancePlan(await json(PLAN))) === config.fast24PlanSha256, 'fast24_plan_changed');
  demand(byteHash(await readFile(path.join(ROOT, config.spend.approvedPolicyPath))) === config.spend.authorizationPolicySha256, 'original_authorization_bytes_changed');
  demand(process.env.SAITU_V7_SOURCE_SHA256 === config.runtimeSourceBindingSha256, 'driver_web_worker_source_binding_required');
  installSourceLoader(ROOT);
  const { recommendationRuntimeBindingV7 } = await import('../../src/lib/competitions/v7/runtime-binding.ts');
  const previousMode = process.env.NODE_ENV, configured = process.env.SAITU_V7_SOURCE_SHA256;
  delete process.env.SAITU_V7_SOURCE_SHA256; process.env.NODE_ENV = 'development';
  let current;
  try { current = recommendationRuntimeBindingV7(); } finally {
    process.env.SAITU_V7_SOURCE_SHA256 = configured;
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
  }
  demand(current === config.runtimeSourceBindingSha256, 'current_source_changed_since_production_build');
  const build = config.productionBuild, manifestBytes = await readFile(build.workerManifestPath);
  const manifest = JSON.parse(manifestBytes), nextBindingBytes = await readFile(path.join(build.directory, 'decision-worker-binding.json'));
  const nextBinding = JSON.parse(nextBindingBytes);
  demand(byteHash(manifestBytes) === build.workerManifestSha256 && byteHash(nextBindingBytes) === build.nextBindingSha256 &&
    (await readFile(path.join(build.directory, 'BUILD_ID'), 'utf8')).trim() === build.nextBuildId &&
    manifest.nextBuildId === build.nextBuildId && nextBinding.nextBuildId === build.nextBuildId &&
    manifest.sourceSha256 === config.runtimeSourceBindingSha256 && nextBinding.sourceSha256 === config.runtimeSourceBindingSha256 &&
    byteHash(await readFile(path.join(path.dirname(build.workerManifestPath), 'worker.mjs'))) === manifest.artifactSha256 &&
    nextBinding.workerArtifactSha256 === manifest.artifactSha256 &&
    manifest.executionMode === 'user-unbounded' && manifest.effortPolicySha256 === config.spend.effortPolicySha256,
  'current_production_next_worker_binding_changed');
}

async function workerReady(config) {
  const health = await json(config.workerHealthFile);
  assertBrowserWorkerExecutionMode(health, config.spend);
  demand(health.schemaVersion === 'saitu.worker-health.v7' && health.sourceSha256 === config.runtimeSourceBindingSha256 && health.status === 'active' && health.databaseReady === true && Date.now() - Date.parse(health.updatedAt) < 10_000, 'fresh_actual_worker_health_required');
  return health;
}

async function receipts(client, runId, config) {
  const { unsealV7 } = await import('../../src/lib/competitions/v7/crypto.ts');
  const rows = (await client.query(`select c.call_id,c.call_key,c.prompt_sha256,c.state as call_state,c.ciphertext,c.iv,c.tag,c.reservation_id,
    c.operation as call_operation,c.thinking as call_thinking,c.reasoning_effort as call_reasoning_effort,c.effort_policy_sha256 as call_effort_policy_sha256,
    l.run_id as spend_run_id,l.phase,l.model,l.effort,l.operation,l.effort_policy_sha256,l.state as ledger_state,l.reserved_micros::text,l.charged_micros::text,l.input_tokens,l.output_tokens,l.cached_input_tokens
    from competition_decision_calls c left join ai_spend_ledger l on l.id=c.reservation_id where c.run_id=$1 order by c.created_at,c.call_id`, [runId])).rows;
  const calls = rows.map(({ ciphertext, iv, tag, ...metadata }) => ({ ...metadata, originalReceipt: ciphertext ? unsealV7(`call:${metadata.call_id}`, { ciphertext, iv, tag }) : null }));
  const encrypted = (await client.query('select ciphertext,iv,tag from competition_decision_runs where run_id=$1', [runId])).rows[0];
  const body = encrypted ? unsealV7(`run:${runId}`, encrypted) : null;
  demand(body?.implementationSha256 === config.runtimeSourceBindingSha256 && canonicalHash(body.context.records) === config.candidatePoolSha256, 'actual_run_source_or_candidate_pool_changed');
  return { schemaVersion: 'saitu.fast24-performance-receipts.v1', invocationId: runId,
    realProviderDispatch: hasBrowserBoundProviderDispatch(calls, config.spend), calls,
    runSnapshot: { context: body.context, items: body.items, report: body.report, error: body.error, auditObservations: body.auditObservations ?? [] } };
}

async function run(config, configBytes, output) {
  demand(process.env.RUN_FAST24_PERFORMANCE_LIVE === '1' && process.env.AI_PROVIDER === 'deepseek' && process.env.AI_MODEL === 'deepseek-flash' && process.env.SAITU_DECISION_STRATEGY === 'llm' && process.env.AI_API_KEY?.trim() && process.env.AI_CONVERSATION_SIGNING_SECRET?.trim().length >= 32, 'explicit_root_real_flash_performance_runtime_required');
  demand(['AI_TEST_MODE', 'ALLOW_AI_MOCK', 'NEXT_PUBLIC_AI_TEST_MODE'].every(key => process.env[key] === '0'), 'explicit_zero_mock_flags_required');
  const database = new URL(process.env.DATABASE_URL ?? '');
  demand(['127.0.0.1', 'localhost'].includes(database.hostname) && (!database.port || database.port === '5432'), 'actual_local_postgres_required');
  await validateCurrentArtifacts(config); await workerReady(config);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 3000 });
  await client.connect();
  let browser;
  try {
    const batch = (await client.query('select row_to_json(b) as raw from ai_spend_development_batches b where run_id=$1', [config.spend.runId])).rows[0]?.raw;
    const budget = (await client.query('select hard_limit_micros::text,execution_mode from ai_spend_budgets where run_id=$1', [config.spend.runId])).rows[0];
    assertBrowserEffortGrant(batch, config.spend); assertBrowserDatabaseLimits(batch, budget, config.spend);
    demand((await client.query('select count(*)::int as calls from ai_spend_ledger where run_id=$1', [config.spend.runId])).rows[0].calls === 0, 'new_empty_performance_batch_required');
    await mkdir(output, { mode: 0o700 });
    await writeFile(path.join(output, 'config.json'), configBytes, { flag: 'wx', mode: 0o600 });
    await writeNew(path.join(output, 'grant-before.json'), { batch, budget, ledgerRows: [] });
    browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
    const results = Array(30); let checkpoint = 0;
    const scheduling = await runAdaptiveBrowserCases(config.plan.cases, {
      onEvent: event => appendFile(path.join(output, 'scheduling.events.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 }),
      onCheckpoint: (outcomes, state) => writeNew(path.join(output, `checkpoint-${++checkpoint}.json`), { completed: state.completed, denominator: 30, outcomes }),
      runCase: async (entry, index, control) => {
        try { await validateCurrentArtifacts(config); await workerReady(config); } catch (error) { error.globalStop = true; throw error; }
        const context = await browser.newContext(entry.viewport === 'mobile' ? devices['Pixel 5'] : devices['Desktop Chrome']);
        const record = { caseId: entry.caseId, viewport: entry.viewport, invocationId: `attempt-${entry.caseId}`, runId: null,
          realProviderDispatch: false, success: false, pageDelivered: false, listItemCount: null, listItemIds: [],
          finalListItemCount: null, finalListItemIds: [], reportItemCount: null, reportItemIds: [],
          timing: null, scheduling: control.scheduling };
        let capture, page; const errors = [];
        try {
          capture = await createBrowserOriginalCapture(context, config);
          await installBrowserExecutionAuthorization(context, config.spend, config.baseUrl);
          page = await context.newPage(); page.setDefaultTimeout(15_000);
          page.on('pageerror', error => errors.push(safePilotError(error)));
          page.on('console', message => { if (message.type() === 'error') errors.push(safePilotError(message.text())); });
          await fillPublicBrowserProfile(page, entry, config.baseUrl);
          // A successful build on disk alone cannot turn a dev server into a production sample.
          const html = await page.content();
          demand(html.includes(config.productionBuild.nextBuildId), 'served_page_must_contain_registered_production_build_id');
          record.productionPage = { buildId: config.productionBuild.nextBuildId, htmlSha256: byteHash(Buffer.from(html)), verifiedBeforeClick: true };
          await expect(page.getByTestId('ai-test-mode-notice')).toHaveCount(0);
          record.browserResourceProbe = await control.observeBrowser(page);
          await installPublicBrowserProbe(page);
          const originalClickEpochMs = await publicClickEpochMs(page); record.originalClickEpochMs = originalClickEpochMs;
          const limits = browserDeliveryLimits(config.timeouts);
          const submitted = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/ai/competition-recommend', { timeout: await browserDeliveryTimeout(page, originalClickEpochMs, 'list', limits) });
          void submitted.catch(() => undefined);
          await page.getByRole('button', { name: '同意，请乐乐开始匹配', exact: true }).click();
          const response = await submitted; demand(response.status() === 202, 'initial_durable_submission_not_accepted');
          const accepted = await response.json();
          demand(typeof accepted.runId === 'string' && accepted.runId.length > 0, 'actual_product_run_id_required');
          record.runId = accepted.runId; record.invocationId = accepted.runId;
          demand(accepted.policyVersion === POLICY_VERSION && accepted.executionPolicy?.maxItems === 5 && accepted.executionMode === config.spend.executionMode && canonicalHash(accepted.executionLimits) === canonicalHash(config.spend.executionLimits), 'top5_submission_policy_and_execution_mode_required');
          const report = page.getByTestId('decision-report-v7');
          await waitForBrowserDelivery(page, { originalClickEpochMs, runId: accepted.runId, phase: 'list', limits });
          const initialList = await page.evaluate(() => window.__saituPublicProbe);
          record.listItemCount = initialList.expectedCount;
          record.listItemIds = initialList.initialItemIds;
          demand(hasFast24RecommendationCount(record.listItemCount) && record.listItemIds.length === record.listItemCount &&
            await report.getByRole('button', { name: /^查看其余/ }).count() === 0, 'all_top5_items_visible_without_expansion_required');
          await page.screenshot({ path: path.join(output, `${entry.caseId}-list.png`), fullPage: false });
          await waitForBrowserDelivery(page, { originalClickEpochMs, runId: accepted.runId, phase: 'details', limits });
          const finalList = await report.evaluate(element => ({ count: Number(element.dataset.totalItems),
            ids: [...element.querySelectorAll('[data-testid="recommendation-run-item"]')].map(card => card.dataset.itemId ?? null) }));
          record.finalListItemCount = finalList.count;
          record.finalListItemIds = finalList.ids;
          await page.evaluate(() => {
            const started = performance.now(), card = document.querySelector('[data-testid="recommendation-run-item"]');
            const observer = new MutationObserver(() => { if (card.querySelector('details[open]')) {
              observer.disconnect(); requestAnimationFrame(() => requestAnimationFrame(() => { window.__saituPublicProbe.readyExpansionMs = performance.now() - started; }));
            } }); observer.observe(card, { attributes: true, subtree: true });
          });
          const first = report.getByTestId('recommendation-run-item').first();
          await first.locator('summary').first().click();
          await expect(first.getByRole('heading', { name: '为什么适合你', exact: true })).toBeVisible();
          await page.waitForFunction(() => window.__saituPublicProbe.readyExpansionMs !== null);
          record.timing = await page.evaluate(() => window.__saituPublicProbe);
          record.pageDelivered = record.timing.listMs !== null && record.timing.allDetailsMs !== null;
          record.success = record.pageDelivered && errors.length === 0 && await report.getAttribute('data-run-status') === 'ready';
          await page.screenshot({ path: path.join(output, `${entry.caseId}-detail.png`), fullPage: false });
        } catch (error) {
          record.failure = safePilotError(error);
          record.timing = await page?.evaluate(() => window.__saituPublicProbe ?? null).catch(() => null) ?? null;
        }
        try {
          const receipt = record.runId ? await receipts(client, record.runId, config) : { schemaVersion: 'saitu.fast24-performance-receipts.v1', invocationId: record.invocationId, realProviderDispatch: false, calls: [], failure: record.failure };
          demand(capture, 'original_capture_not_started'); await capture.collect(client, receipt);
          record.receiptPath = `${entry.caseId}-receipt.json`; await writeNew(path.join(output, record.receiptPath), receipt);
          record.receiptSha256 = byteHash(await readFile(path.join(output, record.receiptPath))); record.realProviderDispatch = receipt.realProviderDispatch;
          const recommendations = receipt.runSnapshot?.report?.recommendations;
          record.reportItemCount = Array.isArray(recommendations) ? recommendations.length : null;
          record.reportItemIds = Array.isArray(recommendations) ? recommendations.map(item => item.itemId) : [];
          const persistedItems = receipt.runSnapshot?.items;
          const persistedItemsMatch = Array.isArray(persistedItems) && persistedItems.length === record.reportItemCount &&
            persistedItems.every((item, index) => item.detailStatus === 'ready' && item.itemId === record.reportItemIds[index] && item.detail?.itemId === item.itemId);
          if (record.success && (!hasFast24PerformanceDelivery(record) || !persistedItemsMatch)) {
            record.success = false;
            record.failure = 'final_visible_list_and_persisted_report_require_same_nonempty_ranked_subset';
          }
          record.ownedLedgerIds = receipt.ledgerOwnership.ownedReservationIds; record.originalSchedulingFeedback = receipt.schedulingFeedback;
          if (receipt.schedulingFeedback) { await control.reportSchedulingFeedback(receipt.schedulingFeedback); record.schedulingFeedbackApplied = true; }
        } catch (error) {
          record.success = false; record.receiptFailure = safePilotError(error);
          await control.reportSchedulingFeedback({ stop: true, reason: 'original_receipt_or_ledger_capture_unavailable' }); record.schedulingFeedbackApplied = true;
        }
        record.consoleErrors = errors; record.thresholds = deliveryThresholds(record.timing);
        await writeNew(path.join(output, `${entry.caseId}-dom.json`), { url: page?.url(), title: await page?.title().catch(() => ''), text: await page?.locator('body').innerText().catch(() => ''), record });
        results[index] = record; await context.close(); return record;
      },
    });
    for (const [index, entry] of config.plan.cases.entries()) if (!results[index]) results[index] = {
      caseId: entry.caseId, viewport: entry.viewport, invocationId: `attempt-${entry.caseId}`, runId: null,
      realProviderDispatch: false, success: false, pageDelivered: false, listItemCount: null, listItemIds: [],
      finalListItemCount: null, finalListItemIds: [], reportItemCount: null, reportItemIds: [], timing: null,
      failure: scheduling.outcomes[index]?.reason ?? 'case_not_started', outcomeKind: scheduling.outcomes[index]?.kind ?? 'not_run' };
    await writeNew(path.join(output, 'scheduling.json'), { policy: BROWSER_SCHEDULING_POLICY, ...scheduling, denominator: 30 });
    const originals = await closeBrowserBatchOriginals(client, config.spend, results);
    await writeNew(path.join(output, 'batch-ledger-originals.json'), originals);
    let artifactsCurrent = true;
    try { await validateCurrentArtifacts(config); } catch (error) { artifactsCurrent = false; await writeNew(path.join(output, 'source-after-failure.json'), { failure: safePilotError(error) }); }
    const score = scoreFast24Performance(results);
    await writeNew(path.join(output, 'performance-score.json'), score);
    await writeNew(path.join(output, 'performance-runs.json'), { schemaVersion: 'saitu.fast24-performance-runs.v1', configSha256: byteHash(configBytes),
      runtimeSourceBindingSha256: config.runtimeSourceBindingSha256, productionBuild: config.productionBuild,
      denominator: 30, executionIntegrityPassed: originals.valid && artifactsCurrent,
      timingPassed: score.passed, independentQualityReview: 'pending', runs: results });
  } finally { await browser?.close(); await client.end(); }
}

export async function main(args = process.argv.slice(2)) {
  demand(process.cwd() === ROOT && Number(process.versions.node.split('.')[0]) === 24, 'repository_root_and_node24_required');
  const cli = options(args);
  const plan = fast24PerformancePlan(await json(PLAN));
  if (cli['--describe']) { console.log(JSON.stringify({ schemaVersion: 'saitu.fast24-performance-description.v1', executed: false, paidCalls: 0,
    policy: FAST24_PERFORMANCE, plan, browser: 'Playwright; Browser plugin not available',
    preparation: '--prepare --config BASE_CONFIG --next-dist .next-fast24 --worker-manifest artifacts/fast24-20261109/F/decision-worker/manifest.json --output NEW_CONFIG',
    execution: '--run --root-dispatch --config NEW_CONFIG --config-sha256 HASH --output NEW_DIRECTORY',
    requiredRuntime: 'root-created fresh performance grant; actual production page; local PostgreSQL and active matching worker' }, null, 2)); return; }
  demand(cli['--config'] && cli['--output'], 'config_and_new_output_required');
  if (cli['--prepare']) {
    const base = await json(cli['--config']), directory = path.resolve(cli['--next-dist'] ?? '.next-fast24');
    const workerManifestPath = path.resolve(cli['--worker-manifest'] ?? 'artifacts/fast24-20261109/F/decision-worker/manifest.json');
    const workerBytes = await readFile(workerManifestPath);
    const config = { ...base, schemaVersion: 'saitu.fast24-performance-config.v1', purpose: 'fast24_performance',
      runnerSha256: byteHash(await readFile(SELF)), fast24HarnessSha256: await harnessHash(),
      plan, fast24PlanSha256: canonicalHash(plan), productionBuild: { directory,
        nextBuildId: (await readFile(path.join(directory, 'BUILD_ID'), 'utf8')).trim(), workerManifestPath,
        workerManifestSha256: byteHash(workerBytes), nextBindingSha256: byteHash(await readFile(path.join(directory, 'decision-worker-binding.json'))) } };
    validateFast24PerformanceConfig(config); await validateCurrentArtifacts(config); await writeNew(path.resolve(cli['--output']), config); return;
  }
  demand(cli['--root-dispatch'] && isHash(cli['--config-sha256']), 'explicit_root_dispatch_and_original_config_hash_required');
  const bytes = await readFile(cli['--config']); demand(byteHash(bytes) === cli['--config-sha256'], 'fast24_config_original_bytes_changed');
  await run(validateFast24PerformanceConfig(JSON.parse(bytes)), bytes, path.resolve(cli['--output']));
}
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) main().catch(error => { console.error(safePilotError(error)); process.exitCode = 1; });
