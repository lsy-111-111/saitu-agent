// Root-dispatched live UI journeys. Preparation/self-check never dispatch.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { chromium, devices, expect } from '@playwright/test';
import { installSourceLoader } from '../../scripts/lib/load-typescript-source.mjs';
import { byteHash, canonicalHash, isHash } from '../../scripts/competitions/v7/evaluation-policy.mjs';
import { analyzePilotEvidence } from '../../scripts/competitions/v7/pilot-contract.mjs';
import { verifyRankNonThinkingContinuationScope } from '../../scripts/competitions/v7/rank-nonthinking-pilot-proof.mjs';
import { installBrowserExecutionAuthorization } from './v7-browser-execution.mjs';
import { createBrowserOriginalCapture } from './v7-browser-originals.mjs';
import { runAdaptiveBrowserCases, BROWSER_SCHEDULING_POLICY } from './v7-browser-scheduling.mjs';
import { assertBrowserEffortEnvironment, assertBrowserEffortGrant, assertBrowserDatabaseLimits, assertBrowserWorkerExecutionMode } from './v7-browser-effort.mjs';
import { pilotProbeBootstrap, startPilotClock, bindPilotRunClock, sendPilotChat, safePilotError } from './v7-pilot-browser.mjs';
import { waitForBrowserDelivery, browserDeliveryLimits } from './v7-browser-timing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SELF = fileURLToPath(import.meta.url);
const PLAN = path.join(ROOT, 'tests/e2e/fixtures/fast24-student-plan.json'), HELPER = path.join(ROOT, 'tests/e2e/fast24-student-journey.ts');
const PRECHECK = path.join(ROOT, 'artifacts/fast24-20261109/C/supplemental-task-boundary-precheck.json');
const exec = promisify(execFile), demand = (condition, message) => { if (!condition) throw new Error(message); };
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const writeNew = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const PIN_KEYS = ['implementationSha256', 'runtimeSourceBindingSha256', 'runtimeConfigurationSha256', 'executionRuntimeConfigurationSha256', 'catalogSha256', 'candidatePoolSha256', 'harnessSha256', 'planSha256'];
export const supplement = { caseId: 'C-supplemental-pure-math-proof', discipline: '公开纯数学证明任务边界', viewport: 'desktop', journey: 'supplemental_fewer',
  major: '数学与理科', subject: '数学、统计与建模', skill: null, stage: '本科大二', weekly: '每周 5–10 小时', budget: 100,
  profileNote: '我只愿做纸笔纯数学证明题，不做算法编程、数据建模、软件、硬件、实验、实证调研、商业、设计、语言或职业展示；不要用相邻任务补齐数量。',
  excludedTasks: ['算法编程与解题', '数据建模与分析', '软件或 AI 应用开发', '硬件、嵌入式或工程制作', '产品策划与用户验证', '商业策划与创业实践', '设计与数字创意', '语言表达与传播', '职业规划与展示', '实验室动手实验'] };

export function assertStudentLiveConfig(config, plan) {
  demand(config.schemaVersion === 'saitu.fast24.student-live-config.v1' && config.authorContextId === '/root', 'root_student_config_required');
  demand(plan.cases.length === 12 && new Set(plan.cases.map(row => row.caseId)).size === 12 && config.denominator === 12, 'original_twelve_unique_cases_required');
  demand(config.spend?.phase === 'formal' && config.spend.authorizedPhase === 'formal' && config.spend.executionMode === 'user-unbounded', 'shared_formal_unbounded_scope_required');
  demand(Object.values(config.spend.executionLimits ?? {}).length === 3 && Object.values(config.spend.executionLimits).every(value => value === null), 'explicit_null_execution_limits_required');
  demand(config.automaticPaidRetries === false && config.formal396Credit === false && config.actualParticipants === 0, 'separate_UI_denominator_and_no_paid_retry_required');
  demand(Array.isArray(config.supplementalCases) && config.supplementalCases.every(row => row.caseId === supplement.caseId && canonicalHash(row) === canonicalHash(supplement)), 'only_separately_identified_public_supplement_required');
  demand(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config.baseUrl).hostname), 'loopback_product_origin_required');
  return config;
}
export function assertSupplementalActualOutput(active, acceptedRecordIds) {
  demand(active.items.length <= 3 && typeof active.shortfallReason === 'string' && active.shortfallReason.trim(), 'supplemental_actual_zero_to_three_shortfall_not_observed');
  demand(active.items.every(item => acceptedRecordIds.includes(item.itemId)), 'supplemental_actual_output_ignored_explicit_task_rejections');
  return { candidateCount: active.items.length, shortfallReason: active.shortfallReason, matchedRecordIds: active.items.map(item => item.itemId), independentActualTextReview: 'pending' };
}

async function prepare(cli) {
  const bytes = await readFile(cli['--base-config']); demand(byteHash(bytes) === cli['--base-config-sha256'], 'base_runtime_config_bytes_changed');
  const base = JSON.parse(bytes), planBytes = await readFile(PLAN), plan = JSON.parse(planBytes);
  await verifyRankNonThinkingContinuationScope(ROOT,base.spend);
  const precheckBytes = cli['--include-supplemental'] ? await readFile(PRECHECK) : null;
  const precheck = precheckBytes ? JSON.parse(precheckBytes) : null;
  if (precheck) demand(precheck.recordCount === 45 && precheck.directTaskMatchCount === 3 && precheck.recordPoolSha256 === base.candidatePoolSha256, 'same_actual_45_record_pool_and_three_direct_tasks_required');
  const config = { ...base, schemaVersion: 'saitu.fast24.student-live-config.v1', authorContextId: '/root', purpose: 'twelve_actual_UI_journeys_separate_from_396',
    denominator: 12, actualParticipants: 0, formal396Credit: false, automaticPaidRetries: false,
    originalStudentPlanSha256: byteHash(planBytes), studentHelperSha256: byteHash(await readFile(HELPER)), studentDriverSha256: byteHash(await readFile(SELF)),
    supplementalCases: cli['--include-supplemental'] ? [supplement] : [], schedulingPolicy: BROWSER_SCHEDULING_POLICY,
    ...(precheck ? { supplementalPrecheck: { path: PRECHECK, sha256: byteHash(precheckBytes), acceptedRecordIds: precheck.records.filter(row => row.directlyMatchesOnlyAcceptedTask).map(row => row.recordId) } } : {}),
    sourceRuntimeConfig: { path: path.resolve(cli['--base-config']), sha256: cli['--base-config-sha256'] } };
  assertStudentLiveConfig(config, plan); await writeNew(path.resolve(cli['--output']), config);
  const digest = byteHash(await readFile(cli['--output']));
  console.log(JSON.stringify({ prepared: true, config: path.resolve(cli['--output']), sha256: digest, denominator: 12, supplementalDenominator: config.supplementalCases.length, paidCalls: 0 }));
  return digest;
}

async function checkPins(config, directory, label) {
  await verifyRankNonThinkingContinuationScope(ROOT,config.spend);
  for (const [file, digest] of [[SELF, config.studentDriverSha256], [HELPER, config.studentHelperSha256], [PLAN, config.originalStudentPlanSha256]]) demand(byteHash(await readFile(file)) === digest, 'student_runner_helper_or_original_plan_changed');
  if (config.supplementalCases.length) demand(byteHash(await readFile(config.supplementalPrecheck.path)) === config.supplementalPrecheck.sha256, 'supplemental_actual_context_precheck_changed');
  const file = path.join(directory, `pins-${label}.json`);
  await exec(process.execPath, [path.join(ROOT, 'tests/e2e/v7-public-browser.mjs'), '--pins', '--output', file], { cwd: ROOT, env: process.env, maxBuffer: 1024 * 1024 });
  const pins = await readJson(file); for (const key of PIN_KEYS) demand(pins[key] === config[key], `student_runtime_pin_changed:${key}`);
  demand(process.env.SAITU_V7_SOURCE_SHA256 === config.runtimeSourceBindingSha256, 'same_web_worker_source_required');
  demand(byteHash(await readFile(path.resolve(ROOT, config.spend.approvedPolicyPath))) === config.spend.authorizationPolicySha256, 'authorization_original_bytes_changed');
  const health = await readJson(config.workerHealthFile); assertBrowserWorkerExecutionMode(health, config.spend);
  demand(health.status === 'active' && health.databaseReady && health.sourceSha256 === config.runtimeSourceBindingSha256 && Date.now() - Date.parse(health.updatedAt) < 10_000, 'fresh_same_source_live_worker_required');
  const build = config.productionBuild; demand(build && (await readFile(path.join(build.directory, 'BUILD_ID'), 'utf8')).trim() === build.nextBuildId && build.nextBuildId !== 'development', 'compiled_production_build_required');
  return health;
}

async function runOriginals(client, runIds, config, capture, intent) {
  const { unsealV7 } = await import('../../src/lib/competitions/v7/crypto.ts');
  const calls = [], runSnapshots = [];
  for (const runId of runIds) {
    const rows = (await client.query(`select c.call_id,c.call_key,c.prompt_sha256,c.state as call_state,c.ciphertext,c.iv,c.tag,c.reservation_id,c.run_id as product_run_id,
      c.operation as call_operation,c.thinking as call_thinking,c.reasoning_effort as call_reasoning_effort,c.effort_policy_sha256 as call_effort_policy_sha256,
      l.run_id as spend_run_id,l.phase,l.model,l.effort,l.operation,l.effort_policy_sha256,l.state as ledger_state,l.reserved_micros::text,l.charged_micros::text,l.input_tokens,l.output_tokens,l.cached_input_tokens
      from competition_decision_calls c left join ai_spend_ledger l on l.id=c.reservation_id where c.run_id=$1 order by c.created_at,c.call_id`, [runId])).rows;
    for (const { ciphertext, iv, tag, ...metadata } of rows) calls.push({ ...metadata, originalReceipt: ciphertext ? unsealV7(`call:${metadata.call_id}`, { ciphertext, iv, tag }) : null });
    const encrypted = (await client.query('select run_id,state_key,status,result_version,ciphertext,iv,tag from competition_decision_runs where run_id=$1', [runId])).rows[0];
    const { ciphertext, iv, tag, ...rowMetadata } = encrypted ?? {};
    runSnapshots.push({ runId, stateKey: encrypted?.state_key ?? null, rowMetadata, body: encrypted ? unsealV7(`run:${runId}`, encrypted) : null });
  }
  const receipt = { schemaVersion: 'saitu.fast24.student-originals.v1', productRunIds: [...runIds], calls, runSnapshots, captureIssues: [], spendRunId: config.spend.runId,
    authorizationPolicySha256: config.spend.authorizationPolicySha256 };
  await capture.collect(client, receipt); // Exact HTTP request ID and product-run membership, never shared-batch difference.
  receipt.cost = { accountingCny: receipt.ledgerRows.reduce((sum, row) => sum + Number(row.charged_micros ?? row.reserved_micros), 0) / 1_000_000, providerInvoiceCny: null, invoiceVerified: false };
  receipt.journeyBinding = { ...intent, httpOriginals: receipt.httpOriginals.map(row => ({ ...intent, ...row })), accountingTrace: receipt.accountingTrace };
  receipt.evidenceValidation = analyzePilotEvidence(receipt, intent, { config: { spend: config.spend, productPins: config, serverAccountingLog: config.serverAccountingLog } });
  return receipt;
}

export async function executeStudentLive(cli) {
  demand(cli['--root-dispatch'] && process.env.RUN_FAST24_STUDENT_UI_LIVE === '1', 'explicit_root_live_UI_dispatch_required');
  demand(process.cwd() === ROOT && Number(process.versions.node.split('.')[0]) === 24 && process.env.NODE_ENV === 'production', 'repository_node24_production_required');
  demand(process.env.AI_PROVIDER === 'deepseek' && process.env.AI_MODEL === 'deepseek-flash' && process.env.AI_API_KEY?.trim() && ['AI_TEST_MODE', 'ALLOW_AI_MOCK', 'NEXT_PUBLIC_AI_TEST_MODE'].every(key => process.env[key] === '0'), 'real_provider_no_mock_required');
  const bytes = await readFile(cli['--config']); demand(byteHash(bytes) === cli['--config-sha256'], 'student_config_bytes_changed');
  const config = assertStudentLiveConfig(JSON.parse(bytes), await readJson(PLAN)); assertBrowserEffortEnvironment(config.spend);
  installSourceLoader(ROOT);
  const { readLocalDecisionPreviewV7 } = await import('../../src/lib/competitions/v7/active-release.ts');
  const preview = readLocalDecisionPreviewV7(); demand(preview && preview.origin === new URL(config.baseUrl).origin && preview.healthFile === config.workerHealthFile, 'current_local_production_binding_required');
  const ui = await import('./fast24-student-journey.ts');
  const output = path.resolve(cli['--output']); await mkdir(output, { mode: 0o700 }); // A prior directory forbids paid reissue/resume.
  await writeFile(path.join(output, 'config.json'), bytes, { flag: 'wx', mode: 0o600 });
  const plan = await readJson(PLAN), entries = [...plan.cases, ...config.supplementalCases];
  const results = Array(entries.length), captures = new Map(), runIdsByCase = new Map();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 3000 });
  let browser, checkpoint = 0;
  try {
    await client.connect(); await checkPins(config, output, 'batch-before');
    const batch = (await client.query('select row_to_json(b) as raw from ai_spend_development_batches b where run_id=$1', [config.spend.runId])).rows[0]?.raw;
    const budget = (await client.query('select hard_limit_micros::text,execution_mode from ai_spend_budgets where run_id=$1', [config.spend.runId])).rows[0];
    assertBrowserEffortGrant(batch, config.spend); assertBrowserDatabaseLimits(batch, budget, config.spend);
    const scopeRows = async () => (await client.query('select row_to_json(l) as raw from ai_spend_ledger l where run_id=$1 order by created_at,id', [config.spend.runId])).rows.map(row => row.raw);
    await writeNew(path.join(output, 'shared-scope-before.json'), { batch, budget, ledgerRows: await scopeRows(), sharedWithFormalCollector: true, emptyGrantRequired: false });
    browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
    const scheduling = await runAdaptiveBrowserCases(entries, {
      onEvent: event => writeFile(path.join(output, `scheduling-${randomUUID()}.json`), JSON.stringify(event), { flag: 'wx', mode: 0o600 }),
      onCheckpoint: async (outcomes, state) => writeNew(path.join(output, `checkpoint-${++checkpoint}.json`), { denominator: 12, completed: state.completed, outcomes }),
      runCase: async (entry, index, control) => {
        const directory = path.join(output, entry.caseId); await mkdir(directory, { mode: 0o700 });
        const intent = { intentId: randomUUID(), caseId: entry.caseId, sessionId: `fast24-student:${randomUUID()}`, caseInputSha256: canonicalHash(entry), registrationSha256: cli['--config-sha256'] };
        const result = { caseId: entry.caseId, discipline: entry.discipline, viewport: entry.viewport, journey: entry.journey, formal396Credit: false,
          status: 'failed', steps: [], failure: null, timing: null, productRunIds: [], ownedLedgerIds: [], scheduling: control.scheduling };
        const step = (name, details = {}) => result.steps.push({ name, status: 'passed', at: new Date().toISOString(), ...details });
        let context, page, capture, receipt; const errors = [], networkFailures = [], pendingDiagnostics = [], runIds = new Set(); let submitPosts = 0;
        runIdsByCase.set(entry.caseId, runIds);
        try {
          await checkPins(config, directory, 'before');
          context = await browser.newContext(entry.viewport === 'mobile' ? devices['Pixel 5'] : devices['Desktop Chrome']);
          capture = await createBrowserOriginalCapture(context, config); captures.set(entry.caseId, { capture, intent, directory });
          await installBrowserExecutionAuthorization(context, config.spend, config.baseUrl);
          page = await context.newPage(); page.setDefaultTimeout(15_000);
          const key = `fast24.student.clock.${entry.caseId}`;
          await page.addInitScript(pilotProbeBootstrap, { key });
          page.on('pageerror', error => errors.push(safePilotError(error)));
          page.on('console', message => { if (message.type() === 'error') errors.push(safePilotError(message.text())); });
          page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/ai/competition-recommend') submitPosts++; });
          page.on('response', response => {
            if (response.status() < 400) return;
            pendingDiagnostics.push((async () => {
              const request = response.request(), headers = await request.allHeaders(), responseHeaders = response.headers();
              let body = null; try { body = await response.json(); } catch { /* Non-JSON errors still retain transport metadata. */ }
              const source = responseHeaders['x-ratelimit-source'] ?? body?.source;
              networkFailures.push({ method: request.method(), path: new URL(response.url()).pathname, status: response.status(),
                requestId: responseHeaders['x-request-id'] ?? headers['x-request-id'] ?? null,
                retryAfter: responseHeaders['retry-after'] ?? null, source: ['application', 'gateway'].includes(source) ? source : null,
                bucket: typeof body?.bucket === 'string' ? body.bucket : null,
                hasValidationExecutionMarker: Boolean(headers['x-saitu-validation-execution']) });
            })().catch(error => networkFailures.push({ captureFailure: safePilotError(error) })));
          });
          page.on('response', response => { if (response.request().method() === 'POST' && ['/api/ai/competition-recommend', '/api/ai/competition-chat'].includes(new URL(response.url()).pathname)) void response.json().then(payload => { if (payload.runId) runIds.add(payload.runId); if (payload.run?.runId) runIds.add(payload.run.runId); }).catch(() => undefined); });
          await ui.fillFast24StudentProfile(page, entry, config.baseUrl); step('actual_form_completed');
          demand((await page.content()).includes(config.productionBuild.nextBuildId), 'served_production_build_id_changed');
          await expect(page.getByTestId('ai-test-mode-notice')).toHaveCount(0); await control.observeBrowser(page);
          const click = await startPilotClock(page, key), limits = browserDeliveryLimits(config.timeouts);
          await writeNew(path.join(directory, 'intent.json'), { ...intent, entry, originalClickEpochMs: click, denominator: 12, supplemental: index >= 12, formal396Credit: false });
          const responsePending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/ai/competition-recommend', { timeout: limits.list });
          void responsePending.catch(() => undefined);
          await page.getByRole('button', { name: '同意，请乐乐开始匹配', exact: true }).click();
          const response = await responsePending; demand(response.status() === 202, 'actual_initial_submission_not_accepted');
          let active = await response.json(); runIds.add(active.runId); await bindPilotRunClock(page, key, active.runId, click);
          demand(active.executionMode === config.spend.executionMode && canonicalHash(active.executionLimits) === canonicalHash(config.spend.executionLimits) && active.executionPolicy?.maxItems === 5, 'actual_top5_scope_changed');
          const report = page.getByTestId('decision-report-v7');
          async function ready(run, fromClick) {
            await waitForBrowserDelivery(page, { runId: run.runId, originalClickEpochMs: fromClick, phase: 'details', limits });
            const delivered = await page.evaluate(() => JSON.parse(sessionStorage.getItem('saitu.recommendationRun.v7')).run);
            const visible = await ui.readFast24VisibleList(page);
            demand(visible.runId === run.runId && visible.status === 'ready' && visible.allReady && visible.declaredCount === visible.itemIds.length &&
              canonicalHash(visible.itemIds) === canonicalHash(delivered.items.map(item => item.itemId)), 'actual_final_list_differs_from_recovered_run');
            step('final_ready_list', visible);
            return delivered;
          }
          if (index >= 12) {
            await expect(report).toHaveAttribute('data-run-status', 'ready', { timeout: limits.details });
            active = await page.evaluate(() => JSON.parse(sessionStorage.getItem('saitu.recommendationRun.v7')).run);
            const assessment = assertSupplementalActualOutput(active, config.supplementalPrecheck.acceptedRecordIds);
            result.shortfallBoundary = { ...assessment, observed: true, neverForced: true };
            if(active.items.length)await expect(report.getByTestId('recommendation-shortfall')).toHaveText(`当前显示 ${active.items.length} 项推荐，可修改回答或向乐乐追问。`);
            else await expect(report).toContainText(active.shortfallReason);
            step('actual_supplemental_shortfall', assessment);
          } else {
            await waitForBrowserDelivery(page, { runId: active.runId, originalClickEpochMs: click, phase: 'list', limits });
            const firstVisible = await ui.readFast24VisibleList(page), count = firstVisible.declaredCount;
            demand(firstVisible.runId === active.runId && count >= 1 && count <= 5 && firstVisible.itemIds.length === count, 'actual_full_list_required');
            step('list_visible', { candidateCount: count, observedStatus: firstVisible.status, itemIds: firstVisible.itemIds });
            await page.screenshot({ path: path.join(directory, 'list.png'), fullPage: false });
            if (entry.journey === 'refresh') { await page.reload(); await expect(report).toHaveAttribute('data-run-id', active.runId); demand(submitPosts === 1, 'refresh_reissued_original_submit'); step('same_run_restored_without_POST'); }
            active = await ready(active, click);
            const first = report.getByTestId('recommendation-run-item').first();
            const expansionStart = await page.evaluate(() => performance.now()); await first.locator('summary').first().click();
            await expect(first.getByRole('heading', { name: '为什么适合你', exact: true })).toBeVisible();
            await page.evaluate(({ key, started }) => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
              const timing = JSON.parse(sessionStorage.getItem(key)); timing.readyExpansionMs = performance.now() - started;
              sessionStorage.setItem(key, JSON.stringify(timing)); resolve(timing.readyExpansionMs);
            }))), { key, started: expansionStart });
            step('clicked_reason_visible', await ui.checkFast24Details(page, active.items[0]));
            await first.getByRole('heading', { name: '为什么适合你', exact: true }).scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(directory, 'detail.png'), fullPage: false });
            if (entry.journey === 'compare') { await ui.checkFast24Comparison(page); step('comparison_available_through_freeform_chat'); }
            if (entry.journey === 'unknown') {
              const facts = active.profile?.facts ?? [], live = facts.filter(fact => fact.confirmed && fact.state === 'affirmed' && !active.profile.retractedFactIds.includes(fact.id));
              demand(!live.some(fact => ['skills', 'weeklyHours', 'weeklyCommitment', 'budget.maximumYuan'].includes(fact.field)), 'unknown_fields_must_not_be_invented');
              step('actual_unknown_profile_retained', { unknownFields: active.profile.unknownFields });
            }
            const texts = { compare: '这两项主要区别是什么？结合我的时间和目标说明怎么取舍。', why_not: '为什么没有推荐全国大学生数学建模竞赛？未入选是否说明不适合我？', dislike: '我不喜欢需要现场路演的方向，明确不想做路演。请按这个偏好重新匹配。' };
            const text = entry.chatText ?? texts[entry.journey];
            if (text) {
              const before = active, topic = entry.chatText ? '更正或撤回回答' : { compare: '比较两项', why_not: '为什么没推荐？', dislike: '不喜欢这些推荐' }[entry.journey];
              await ui.fillFast24Chat(page, text, topic);
              const reply = await sendPilotChat(page, text, { timeoutMs: 50_000 });
              const changes = ['dislike', 'correction', 'self_other', 'withdraw', 'corrected_refresh'].includes(entry.journey);
              if (changes) {
                demand(reply.payload.run?.runId && reply.payload.run.runId !== before.runId && reply.payload.profileRevision !== before.profileRevision, 'explicit_change_requires_fresh_actual_run');
                active = reply.payload.run; runIds.add(active.runId); await bindPilotRunClock(page, key, active.runId, reply.clickEpochMs);
                await expect(page.getByTestId('decision-update-proposal')).toHaveCount(0);
                active = await ready(active, reply.clickEpochMs);
                const live = active.profile.facts.filter(fact => fact.confirmed && fact.state === 'affirmed' && !active.profile.retractedFactIds.includes(fact.id));
                if (entry.journey === 'withdraw') demand(!live.some(fact => fact.field === 'skills' && fact.value === entry.expectedValue), 'withdrawn_programming_fact_still_active');
                else if (entry.expectedField) demand(live.some(fact => fact.field === entry.expectedField && fact.value === entry.expectedValue) && !live.some(fact => fact.field === entry.expectedField && fact.value !== entry.expectedValue), 'corrected_value_not_adopted');
                if (entry.journey === 'corrected_refresh') { await page.reload(); await expect(report).toHaveAttribute('data-run-id', active.runId); }
                step('updated_reason_visible', await ui.checkFast24Details(page, active.items[0]));
                step('actual_change_reranked_without_confirmation', { previousRunId: before.runId, nextRunId: active.runId, revision: active.profileRevision });
              } else {
                demand(reply.payload.profileRevision === before.profileRevision, 'question_only_message_changed_profile');
                if (entry.journey === 'compare') {
                  const compared = reply.payload.comparison?.itemIds ?? [], finalIds = new Set(before.items.map(item => item.itemId));
                  demand(compared.every(id => finalIds.has(id)), 'comparison_cites_removed_candidate');
                  step('actual_comparison_scope', { compared, finalItemCount: finalIds.size });
                }
                step('actual_followup_rendered_same_revision');
              }
            }
            if (entry.journey === 'fewer') {
              result.shortfallBoundary = { actualCandidateCount: active.items.length, actualShortfallReason: active.shortfallReason, observed: active.items.length < 5 && Boolean(active.shortfallReason), neverForced: true };
              if (active.items.length < 5 && active.shortfallReason) {
                if(active.items.length)await expect(report.getByTestId('recommendation-shortfall')).toHaveText(`当前显示 ${active.items.length} 项推荐，可修改回答或向乐乐追问。`);
                else await expect(report).toContainText(active.shortfallReason);
                result.shortfallBoundary.displayedShortfallText=await report.getByTestId('recommendation-shortfall').innerText();
              }
              step('actual_count_and_shortfall_recorded_without_forcing');
            }
            if (entry.journey === 'saved') {
              const saved = await ui.saveFast24FirstResult(page); step('actual_choice_saved', saved);
              await Promise.all([page.waitForURL('**/competitions/saved'), report.getByRole('link', { name: '打开我的竞赛', exact: true }).click()]);
              await page.reload();
              step('actual_saved_choice_survived_navigation_and_refresh', await ui.checkFast24SavedResult(page, active.items[0]));
            }
          }
          result.timing = await page.evaluate(key => { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : null; }, key);
          await ui.checkFast24PageHealth(page); demand(submitPosts === 1 && errors.length === 0, 'duplicate_submit_or_browser_error');
          await page.screenshot({ path: path.join(directory, 'journey.png'), fullPage: false }); step('page_health_and_screenshot');
          result.status = 'passed';
        } catch (error) { result.failure = safePilotError(error); result.steps.push({ name: 'journey_failure', status: 'failed', failure: result.failure }); }
        finally {
          if (page && !page.isClosed()) {
            await writeNew(path.join(directory, 'dom.json'), { url: page.url(), title: await page.title(), text: await page.locator('body').innerText(), errors }).catch(() => undefined);
            await page.screenshot({ path: path.join(directory, 'final.png'), fullPage: false }).catch(() => undefined);
          }
          await Promise.allSettled(pendingDiagnostics);
          result.networkFailures = networkFailures;
          await context?.close().catch(() => undefined);
          try {
            receipt = await runOriginals(client, runIds, config, capture, intent); await writeNew(path.join(directory, 'receipts.json'), receipt);
            result.productRunIds = [...runIds]; result.ownedLedgerIds = receipt.ledgerOwnership.ownedReservationIds;
            if (!receipt.evidenceValidation.valid) { result.status = 'indeterminate'; result.failure ??= 'actual_original_receipt_or_accounting_not_closed'; }
            if (receipt.schedulingFeedback) { await control.reportSchedulingFeedback(receipt.schedulingFeedback); result.schedulingFeedbackApplied = true; }
            result.stopScheduling = receipt.evidenceValidation.ownershipVerified !== true;
          } catch (error) { result.status = 'indeterminate'; result.failure = `receipt_capture_failed:${safePilotError(error)}`; result.stopScheduling = true; }
          try { await checkPins(config, directory, 'after'); } catch (error) { result.status = 'indeterminate'; result.failure = safePilotError(error); result.stopScheduling = true; }
          result.submitPosts = submitPosts; result.errors = errors; await writeNew(path.join(directory, 'observation.json'), result); results[index] = result;
        }
        return result;
      },
    });
    for (let index = 0; index < entries.length; index++) if (!results[index]) results[index] = { caseId: entries[index].caseId, status: 'not_started', failure: scheduling.outcomes[index]?.reason ?? 'scheduler_stopped', formal396Credit: false };
    // A final read-only closure retains the first outcome; it never reissues a request.
    const ownIds = new Set(), duplicates = [];
    for (const result of results) {
      const retained = captures.get(result.caseId); if (!retained) continue;
      const receipt = await runOriginals(client, runIdsByCase.get(result.caseId), config, retained.capture, retained.intent);
      await writeNew(path.join(retained.directory, 'final-receipts-readonly.json'), receipt);
      for (const id of receipt.ledgerOwnership.ownedReservationIds) { if (ownIds.has(id)) duplicates.push(id); ownIds.add(id); }
    }
    const after = await scopeRows();
    await writeNew(path.join(output, 'shared-scope-after.json'), { ledgerRows: after, ownedUIReservationIds: [...ownIds], duplicateUIReservationIds: duplicates,
      otherCollectorRows: after.filter(row => !ownIds.has(row.id)), otherCollectorRowsAreNotUIFailures: true, ownershipRule: 'exact_HTTP_request_and_product_run_membership_only' });
    const original = results.slice(0, 12), supplemental = results.slice(12);
    const summary = { schemaVersion: 'saitu.fast24.student-live-summary.v1', denominator: 12, cases: original, passed: original.filter(row => row.status === 'passed').length,
      failed: original.filter(row => row.status !== 'passed').length, supplementalDenominator: supplemental.length, supplemental,
      actualParticipants: 0, formal396Credit: false, noAutomaticPaidRetry: true, sharedFormalScope: config.spend.runId, duplicateUIReservationIds: duplicates,
      actualFewerThanFiveObserved: original.some(row => row.shortfallBoundary?.observed) || supplemental.some(row => row.status === 'passed'),
      noActualOldRecordClaim: true, oldRecordCompatibilityEvidence: 'Separate previously passed synthetic historical-cache tests, not fabricated model history.',
      independentActualOutputReview: 'pending', formalProductAcceptance: false };
    await writeNew(path.join(output, 'summary.json'), summary); console.log(JSON.stringify({ output, denominator: 12, passed: summary.passed, failed: summary.failed, supplementalDenominator: supplemental.length, formal396Credit: false }));
    if (summary.failed || duplicates.length) process.exitCode = 2;
    return summary;
  } catch (error) {
    await writeNew(path.join(output, 'fatal.json'), { denominator: 12, failure: safePilotError(error), automaticPaidRetries: false,
      cases: plan.cases.map((entry, index) => results[index] ?? { caseId: entry.caseId, status: 'not_started', failure: 'batch_fatal_before_this_case' }),
      supplementalCases: results.slice(12), formal396Credit: false }).catch(() => undefined);
    throw error;
  } finally { await browser?.close().catch(() => undefined); await client.end().catch(() => undefined); }
}

async function main(args) {
  const cli = {}, flags = new Set(['--prepare', '--execute', '--run', '--root-dispatch', '--include-supplemental', '--self-check']);
  const names = new Set(['--base-config', '--base-config-sha256', '--config', '--config-sha256', '--output']);
  for (let index = 0; index < args.length; index++) { const key = args[index]; demand((flags.has(key) || names.has(key)) && !Object.hasOwn(cli, key), 'unknown_or_duplicate_argument'); cli[key] = flags.has(key) ? true : args[++index]; demand(cli[key] !== undefined, 'missing_argument_value'); }
  if (cli['--self-check']) {
    const plan = await readJson(PLAN); demand(plan.cases.length === 12 && plan.cases.every(row => row.caseId && row.viewport), 'original_twelve_plan_required');
    installSourceLoader(ROOT); const ui = await import('./fast24-student-journey.ts'); demand(typeof ui.fillFast24StudentProfile === 'function', 'actual_profile_helper_import_required');
    console.log(JSON.stringify({ cases: 12, paidCalls: 0, databaseConnections: 0, driverSha256: byteHash(await readFile(SELF)), helperSha256: byteHash(await readFile(HELPER)), planSha256: byteHash(await readFile(PLAN)) })); return;
  }
  demand(['--prepare', '--execute', '--run'].filter(mode => cli[mode]).length === 1, 'choose_one_prepare_execute_or_run');
  if (cli['--run']) {
    demand(cli['--root-dispatch'] && process.env.RUN_FAST24_STUDENT_UI_LIVE === '1', 'explicit_root_live_UI_dispatch_required');
    const configFile = `${path.resolve(cli['--output'])}.config.json`;
    const digest = await prepare({ ...cli, '--output': configFile });
    return executeStudentLive({ '--root-dispatch': true, '--config': configFile, '--config-sha256': digest, '--output': cli['--output'] });
  }
  if (cli['--prepare']) return prepare(cli);
  demand(cli['--config'] && isHash(cli['--config-sha256']) && cli['--output'], 'bound_config_and_new_output_required');
  return executeStudentLive(cli);
}
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).catch(error => { console.error(safePilotError(error)); process.exitCode = 1; });
