import { readFile, mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { browserEffortRuntime, configuredBrowserEffortRuntime, assertBrowserEffortEnvironment, assertBrowserEffortGrant, hasBrowserBoundProviderDispatch, isBrowserUserUnbounded, assertBrowserLiveExecutionMode, assertBrowserDatabaseLimits, browserExecutionScopeLimits, assertBrowserWorkerExecutionMode } from "./v7-browser-effort.mjs";
import { installDeliveryProbe, publicClickEpochMs, browserDeliveryTimeout, waitForBrowserDelivery, deliveryThresholds, browserDeliveryLimits } from "./v7-browser-timing.mjs";
import { createBrowserOriginalCapture, closeBrowserBatchOriginals } from "./v7-browser-originals.mjs";
import { runAdaptiveBrowserCases, BROWSER_SCHEDULING_POLICY } from "./v7-browser-scheduling.mjs";
import { installBrowserExecutionAuthorization } from "./v7-browser-execution.mjs";
import { chromium, devices, expect } from "@playwright/test";
import { sourceManifest } from "../../scripts/competitions/v6/run-experiment.mjs";
import { runtimeConfiguration, runtimeConfigurationHash } from "../../scripts/competitions/v6/runtime-configuration.mjs";
import { runtimeBehaviorConfiguration, runtimeBehaviorConfigurationHash, V7_GRANT_VERSION } from "../../scripts/competitions/v7/evaluation-runtime.mjs";
import { USER_UNBOUNDED_GRANT_VERSION } from "../../src/lib/ai/execution-policy.mjs";
import { TOP5_EFFORT_GRANT_VERSION } from "../../scripts/competitions/v7/evaluation-effort.mjs";
import { canonicalHash, byteHash, POLICY_VERSION, POLICY_SHA256, isHash } from "../../scripts/competitions/v7/evaluation-policy.mjs";
import { installSourceLoader } from "../../scripts/lib/load-typescript-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const planFile = path.join(root, "tests/e2e/fixtures/v7-public-browser-plan.json");
const harnessFiles = ["tests/e2e/v7-public-browser.mjs", "tests/e2e/fixtures/v7-public-browser-plan.json", "tests/e2e/v7-browser-evidence.mjs", "tests/e2e/v7-browser-timing.mjs", "tests/e2e/v7-browser-effort.mjs", "tests/e2e/v7-browser-execution.mjs", "tests/e2e/v7-browser-scheduling.mjs", "tests/e2e/v7-browser-originals.mjs", "scripts/lib/adaptive-execution.mjs", "scripts/competitions/v7/evaluation-dispatch-evidence.mjs"];
const hashKeys = ["implementationSha256", "runtimeSourceBindingSha256", "runtimeConfigurationSha256", "executionRuntimeConfigurationSha256", "catalogSha256", "candidatePoolSha256", "harnessSha256", "planSha256"];
function requireValue(condition, code) { if (!condition) throw new Error(code); }
async function json(filename) { return JSON.parse(await readFile(filename, "utf8")); }
async function writeNew(filename, value) { await writeFile(filename, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); }
function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index]; requireValue(["--describe", "--pins", "--register", "--run", "--config", "--registration", "--registration-sha256", "--output"].includes(key) && !Object.hasOwn(result, key), "unsupported_or_duplicate_public_browser_option");
    result[key] = ["--describe", "--pins", "--register", "--run"].includes(key) ? true : args[++index];
  }
  requireValue(["--describe", "--pins", "--register", "--run"].filter(key => result[key]).length === 1, "choose_one_public_browser_mode");
  return result;
}
async function bindings() {
  installSourceLoader(root);
  const { recommendationRuntimeBindingV7 } = await import("../../src/lib/competitions/v7/runtime-binding.ts");
  const { getMatchingCatalogRecords } = await import("../../src/lib/competitions/v7/catalog.ts");
  const { getDecisionCatalog } = await import("../../src/lib/competitions/v6/catalog.ts");
  const configured = process.env.SAITU_V7_SOURCE_SHA256;
  const configuredNodeEnv = process.env.NODE_ENV;
  delete process.env.SAITU_V7_SOURCE_SHA256;
  process.env.NODE_ENV = "development";
  let runtimeSourceBindingSha256;
  try { runtimeSourceBindingSha256 = recommendationRuntimeBindingV7(); } finally {
    if (configured !== undefined) process.env.SAITU_V7_SOURCE_SHA256 = configured;
    if (configuredNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = configuredNodeEnv;
  }
  return { implementationSha256: canonicalHash(await sourceManifest(root)), runtimeSourceBindingSha256,
    runtimeConfigurationSha256: runtimeBehaviorConfigurationHash(), executionRuntimeConfigurationSha256: runtimeConfigurationHash(), catalogSha256: canonicalHash(getDecisionCatalog()),
    candidatePoolSha256: canonicalHash(getMatchingCatalogRecords()),
    harnessSha256: canonicalHash(await Promise.all(harnessFiles.map(async name => ({ path: name, sha256: byteHash(await readFile(path.join(root, name))) })))),
    planSha256: byteHash(await readFile(planFile)) };
}
export function validatePublicBrowserConfig(config) {
  requireValue(config.schemaVersion === "saitu.public-browser-config.v7.1" && config.policyVersion === POLICY_VERSION && config.policySha256 === POLICY_SHA256, "v7_public_policy_binding_required");
  requireValue(hashKeys.every(key => isHash(config[key])) && typeof config.authorContextId === "string" && config.authorContextId.length > 0, "all_public_browser_pins_required");
  const base = new URL(config.baseUrl);
  requireValue(base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname) && !base.username && !base.password && !base.search && !base.hash && base.pathname === "/", "explicit_local_public_browser_url_required");
  requireValue(path.isAbsolute(config.workerHealthFile), "absolute_live_worker_health_file_required");
  browserEffortRuntime(config.spend);
  requireValue([TOP5_EFFORT_GRANT_VERSION, USER_UNBOUNDED_GRANT_VERSION].includes(config.spend.grantVersion), "top5_browser_execution_grant_required");
  browserDeliveryLimits(config.timeouts);
  if (isBrowserUserUnbounded(config.spend)) requireValue(config.invocationConcurrency === "adaptive" && canonicalHash(config.browserSchedulingPolicy) === canonicalHash(BROWSER_SCHEDULING_POLICY), "frozen_adaptive_browser_scheduling_required");
  if (isBrowserUserUnbounded(config.spend)) requireValue(path.isAbsolute(config.serverAccountingLog?.path ?? "") && config.serverAccountingLog.format === "competition_accounting_trace.jsonl" && config.serverAccountingLog.sourceSha256 === config.runtimeSourceBindingSha256, "same_source_accounting_trace_required_for_parallel_original_ownership");
  requireValue(config.spend?.phase === "calibration" && /^[A-Za-z0-9._-]{1,100}$/.test(config.spend.runId) && (isBrowserUserUnbounded(config.spend) || Number.isSafeInteger(config.spend.maxCalls) && config.spend.maxCalls >= 10 && config.spend.maxCalls <= 100 && Number.isSafeInteger(config.spend.maxReservedMicros) && config.spend.maxReservedMicros > 0), "finite_public_five_run_spend_batch_required");
  requireValue(isHash(config.spend.authorizationPolicySha256) && typeof config.spend.approvedPolicyPath === "string" && !path.isAbsolute(config.spend.approvedPolicyPath) && !config.spend.approvedPolicyPath.split(/[\\/]/).includes("..") && ["artifacts/continuation-v7-20261109/budget/", "artifacts/continuation-v7-effort-20261109/budget/", "artifacts/continuation-v7-top5-20261109/budget/"].some(prefix => config.spend.approvedPolicyPath.startsWith(prefix)) && path.basename(config.spend.approvedPolicyPath) === "approved-policy.md", "frozen_original_spend_authorization_reference_required");
  return config;
}
const validateConfig = validatePublicBrowserConfig;
async function validatePins(config) {
  const current = await bindings();
  for (const key of hashKeys) requireValue(current[key] === config[key], `public_browser_pin_changed:${key}`);
  requireValue(byteHash(await readFile(path.join(root, config.spend.approvedPolicyPath))) === config.spend.authorizationPolicySha256, "original_spend_authorization_bytes_changed");
  requireValue(process.env.SAITU_V7_SOURCE_SHA256 === config.runtimeSourceBindingSha256, "shared_web_worker_runtime_source_pin_required");
  return current;
}
async function workerReady(config) {
  const health = await json(config.workerHealthFile);
  assertBrowserWorkerExecutionMode(health, config.spend);
  requireValue(health.schemaVersion === "saitu.worker-health.v7" && health.sourceSha256 === config.runtimeSourceBindingSha256 && health.status === "active" && health.databaseReady === true && Date.now() - Date.parse(health.updatedAt) < 10_000, "fresh_actual_live_worker_health_required");
  return health;
}
async function liveGate(config) {
  requireValue(process.env.RUN_V7_PUBLIC_LIVE === "1", "explicit_public_live_execution_required");
  requireValue(process.env.AI_PROVIDER === "deepseek" && process.env.AI_MODEL === "deepseek-flash" && process.env.AI_API_KEY?.trim() && process.env.AI_TEST_MODE !== "1" && process.env.ALLOW_AI_MOCK !== "1" && process.env.NEXT_PUBLIC_AI_TEST_MODE !== "1", "real_flash_staged_effort_configuration_required");
  requireValue(process.env.AI_SPEND_RUN_ID === config.spend.runId && process.env.AI_SPEND_PHASE === config.spend.phase, "registered_public_spend_batch_required");
  assertBrowserLiveExecutionMode(config.spend);
  const effortRuntime = assertBrowserEffortEnvironment(config.spend);
  const target = new URL(process.env.DATABASE_URL ?? "");
  requireValue(["127.0.0.1", "localhost"].includes(target.hostname) && (!target.port || target.port === "5432"), "actual_local_postgres_ledger_required");
  await validatePins(config); await workerReady(config);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, options: "-c default_transaction_read_only=on" });
  await client.connect();
  try {
    const batch = (await client.query("select run_id,call_limit,execution_mode,authorized_effort,state,effort_condition_sha256,effort_policy,effort_policy_sha256,grant_version,authorized_phase,policy_sha256,funding_limit_micros::text from ai_spend_development_batches where run_id=$1", [config.spend.runId])).rows[0];
    const budget = (await client.query("select hard_limit_micros::text,execution_mode from ai_spend_budgets where run_id=$1", [config.spend.runId])).rows[0];
    assertBrowserEffortGrant(batch, config.spend);
    assertBrowserDatabaseLimits(batch, budget, config.spend);
    const used = (await client.query("select count(*)::int as calls from ai_spend_ledger where run_id=$1", [config.spend.runId])).rows[0];
    requireValue(used.calls === 0, "public_five_runs_require_new_empty_batch_not_historical_splice");
    return { client, executionScope: { grantVersion: batch.grant_version, runId: config.spend.runId, phase: config.spend.phase, authorizedPhase: batch.authorized_phase,
      authorizedEffort: batch.authorized_effort, effortPolicy: effortRuntime.effortPolicy, effortPolicySha256: effortRuntime.effortPolicySha256, effortConditionSha256: batch.effort_condition_sha256, evaluationPolicySha256: POLICY_SHA256, authorizationPolicySha256: batch.policy_sha256, environmentAuthorizationPolicySha256: process.env.AI_SPEND_POLICY_SHA256,
      approvedPolicyPath: config.spend.approvedPolicyPath, ...browserExecutionScopeLimits(batch, budget, config.spend), executionRuntimeConfigurationSha256: config.executionRuntimeConfigurationSha256 } };
  } catch (error) { await client.end(); throw error; }
}
async function choose(page, name, role = "radio") { await page.getByTestId("conversation-current-question").getByRole(role, { name, exact: true }).evaluate(element => element.closest("label")?.click()); }
async function next(page) { await page.getByTestId("conversation-current-question").getByRole("button", { name: "回答好了，继续", exact: true }).click(); }
async function skip(page) { await page.getByTestId("conversation-current-question").getByRole("button", { name: "暂不确定，跳过这题", exact: true }).click(); }
export async function fillPublicBrowserProfile(page, entry, baseUrl) {
  await page.goto(new URL("/competitions/recommend", baseUrl).href);
  await choose(page, "先发现自己愿意长期做的方向"); await choose(page, "确认，先按这个方向比较"); await next(page);
  await choose(page, entry.stage); await next(page); await skip(page); await skip(page);
  if (entry.skill) { await choose(page, entry.skill, "checkbox"); await next(page); } else await skip(page);
  await choose(page, "暂时想不起或还没有"); await next(page); await skip(page);
  await choose(page, entry.weekly); await choose(page, "先体验 1–2 周"); await next(page);
  await choose(page, entry.budget === 0 ? "暂不自费" : entry.budget <= 100 ? "不超过 100 元" : "101–500 元");
  if (entry.budget > 0) await page.getByRole("spinbutton", { name: /预算上限/ }).fill(String(entry.budget));
  await choose(page, "我个人的总预算"); await next(page);
  await expect(page.locator('[data-phase="summary"]')).toBeVisible();
  await page.locator('[data-phase="summary"]').getByRole("checkbox").check();
}
export async function installPublicBrowserProbe(page) {
  return installDeliveryProbe(page);
}

function redact(value) {
  return JSON.parse(JSON.stringify(value, (key, entry) => /token|secret|password|apiKey/i.test(key) ? "[REDACTED]" : entry));
}
async function receipts(client, runId, config) {
  const { unsealV7 } = await import("../../src/lib/competitions/v7/crypto.ts");
  const rows = (await client.query(`select c.call_id,c.call_key,c.prompt_sha256,c.state as call_state,c.ciphertext,c.iv,c.tag,c.reservation_id,
    c.operation as call_operation,c.thinking as call_thinking,c.reasoning_effort as call_reasoning_effort,c.effort_policy_sha256 as call_effort_policy_sha256,
    l.run_id as spend_run_id,l.phase,l.model,l.effort,l.operation,l.effort_policy_sha256,l.state as ledger_state,l.reserved_micros::text,l.charged_micros::text,l.input_tokens,l.output_tokens,l.cached_input_tokens
    from competition_decision_calls c left join ai_spend_ledger l on l.id=c.reservation_id where c.run_id=$1 order by c.created_at,c.call_id`, [runId])).rows;
  const calls = rows.map(({ ciphertext, iv, tag, ...metadata }) => ({ ...metadata, originalReceipt: ciphertext ? unsealV7(`call:${metadata.call_id}`, { ciphertext, iv, tag }) : null }));
  const realProviderDispatch = hasBrowserBoundProviderDispatch(calls, config.spend);
  const run = (await client.query("select ciphertext,iv,tag from competition_decision_runs where run_id=$1", [runId])).rows[0];
  const body = run ? unsealV7(`run:${runId}`, run) : null;
  requireValue(body?.implementationSha256 === config.runtimeSourceBindingSha256 && canonicalHash(body.context.records) === config.candidatePoolSha256, "actual_run_source_or_full_pool_binding_changed");
  return { schemaVersion: "saitu.public-browser-receipts.v7.1", invocationId: runId, realProviderDispatch, calls, runSnapshot: redact({ context: body.context, items: body.items, report: body.report, error: body.error, auditObservations: body.auditObservations ?? [] }) };
}
async function execute(registration, output, registrationSha256, registrationBytes) {
  const config = validateConfig(registration.config);
  const deliveryLimits = browserDeliveryLimits(config.timeouts);
  requireValue(registration.schemaVersion === "saitu.public-browser-registration.v7.1" && registration.executed === false && registration.planSha256 === config.planSha256, "unexecuted_public_browser_registration_required");
  requireValue(canonicalHash(registration.plan) === canonicalHash(await json(planFile)), "public_registered_plan_changed");
  const { client, executionScope } = await liveGate(config);
  let browser;
  try {
    // mkdir without recursive forbids overwriting or appending to any old batch.
    await mkdir(output);
    await writeFile(path.join(output, "registration.json"), registrationBytes, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(output, "approved-policy.md"), await readFile(path.join(root, config.spend.approvedPolicyPath)), { flag: "wx", mode: 0o600 });
    executionScope.authorizationPolicy = { path: "approved-policy.md", sha256: config.spend.authorizationPolicySha256 };
    executionScope.authorizationPolicySnapshot = { ...executionScope.authorizationPolicy };
    browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
    const results = Array(registration.plan.cases.length);
    let checkpointSequence = 0;
    const scheduling = await runAdaptiveBrowserCases(registration.plan.cases, {
      onEvent: event => appendFile(path.join(output, "browser-scheduling.events.jsonl"), JSON.stringify(event) + "\n", { mode: 0o600 }),
      onCheckpoint: async (outcomes, state) => writeNew(path.join(output, `checkpoint-${++checkpointSequence}.json`), { completed: state.completed, denominator: 5, outcomes }),
      runCase: async (entry, index, control) => {
      try { await validatePins(config); await workerReady(config); } catch (error) { error.globalStop = true; throw error; }
      const context = await browser.newContext(entry.viewport === "mobile" ? devices["Pixel 5"] : devices["Desktop Chrome"]);
      const originalCapture = await createBrowserOriginalCapture(context, config);
      await installBrowserExecutionAuthorization(context, config.spend, config.baseUrl);
      const page = await context.newPage(); page.setDefaultTimeout(15_000);
      const errors = [], responses = [], record = { caseId: entry.caseId, viewport: entry.viewport, invocationId: `attempt-${entry.caseId}`, runId: null, realProviderDispatch: false, success: false, pageDelivered: false, criticalReviewPassed: false, receiptSha256: null, timing: null, scheduling: control.scheduling };
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      page.on("response", response => { if (response.url().includes("/api/")) responses.push({ path: new URL(response.url()).pathname, status: response.status(), method: response.request().method() }); });
      try {
        await fillPublicBrowserProfile(page, entry, config.baseUrl);
        await expect(page.getByTestId("ai-test-mode-notice")).toHaveCount(0);
        record.browserResourceProbe = await control.observeBrowser(page);
        await installPublicBrowserProbe(page); // Begins before click and all network/persistence work.
        const originalClickEpochMs = await publicClickEpochMs(page);
        const submitTimeout = await browserDeliveryTimeout(page, originalClickEpochMs, "list", deliveryLimits);
        const submitted = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/ai/competition-recommend", { timeout: submitTimeout });
        await page.getByRole("button", { name: "同意，请乐乐开始匹配", exact: true }).click();
        const response = await submitted; requireValue(response.status() === 202, "initial_durable_submission_not_accepted");
        const accepted = await response.json(); requireValue(accepted.policyVersion === POLICY_VERSION && accepted.executionPolicy?.maxItems === 5 && accepted.executionMode === config.spend.executionMode && canonicalHash(accepted.executionLimits) === canonicalHash(config.spend.executionLimits), "top5_submission_policy_and_execution_mode_required"); record.invocationId = accepted.runId; record.runId = accepted.runId;
        const report = page.getByTestId("decision-report-v7");
        await waitForBrowserDelivery(page, { originalClickEpochMs, runId: accepted.runId, phase: "list", limits: deliveryLimits });
        await expect(report.getByTestId("recommendation-run-item").first()).toBeVisible({ timeout: 1000 });
        const itemCount = Number(await report.getAttribute("data-total-items"));
        requireValue(Number.isInteger(itemCount) && itemCount >= 1 && itemCount <= 5 && await report.getByTestId("recommendation-run-item").count() === itemCount, "top5_full_list_must_be_visible_without_hidden_items");
        await page.screenshot({ path: path.join(output, `${entry.caseId}-list.png`), fullPage: false });
        const expand = report.getByRole("button", { name: /^查看其余/ });
        if (await expand.count()) await expand.click();
        await waitForBrowserDelivery(page, { originalClickEpochMs, runId: accepted.runId, phase: "details", limits: deliveryLimits });
        record.timing = await page.evaluate(() => window.__saituPublicProbe);
        if (record.timing.allDetailsMs !== null) {
          const first = report.getByTestId("recommendation-run-item").first();
          await page.evaluate(() => { const start = performance.now(); const card = document.querySelector('[data-testid="recommendation-run-item"]'); new MutationObserver(() => { if (card.querySelector("details[open]")) requestAnimationFrame(() => requestAnimationFrame(() => { window.__saituPublicProbe.readyExpansionMs = performance.now() - start; })); }).observe(card, { attributes: true, subtree: true }); });
          await first.locator("summary").first().click(); await expect(first.getByRole("heading", { name: "为什么适合你", exact: true })).toBeVisible();
          await page.waitForFunction(() => window.__saituPublicProbe.readyExpansionMs !== null);
          record.timing = await page.evaluate(() => window.__saituPublicProbe);
        }
        record.pageDelivered = record.timing.listMs !== null && record.timing.allDetailsMs !== null;
        record.success = record.pageDelivered && errors.length === 0 && await report.getAttribute("data-run-status") === "ready";
        await page.screenshot({ path: path.join(output, `${entry.caseId}-detail.png`), fullPage: false });
      } catch (error) { record.failure = error instanceof Error ? error.message : "public_browser_run_failed"; record.timing = await page.evaluate(() => window.__saituPublicProbe ?? null).catch(() => null); }
      try {
        const receipt = record.runId ? await receipts(client, record.runId, config) : { schemaVersion: "saitu.public-browser-receipts.v7.1", invocationId: record.invocationId, realProviderDispatch: false, calls: [], failure: record.failure };
        await originalCapture.collect(client, receipt);
        const filename = `${entry.caseId}-receipt.json`; await writeNew(path.join(output, filename), receipt);
        record.receiptSha256 = byteHash(await readFile(path.join(output, filename))); record.receiptPath = filename; record.realProviderDispatch = receipt.realProviderDispatch;
        record.ownedLedgerIds = receipt.ledgerOwnership.ownedReservationIds;
        record.originalSchedulingFeedback = receipt.schedulingFeedback;
        record.stopScheduling = receipt.schedulingFeedback?.stop === true;
        if (record.stopScheduling) record.reason = receipt.schedulingFeedback.reason;
        if (receipt.schedulingFeedback) { await control.reportSchedulingFeedback(receipt.schedulingFeedback); record.schedulingFeedbackApplied = true; }
      } catch (error) {
        record.success = false; record.receiptFailure = error instanceof Error ? error.message : "receipt_unavailable";
        record.stopScheduling = true; record.reason = "original_receipt_or_ledger_capture_unavailable";
        await control.reportSchedulingFeedback({ stop: true, reason: record.reason }); record.schedulingFeedbackApplied = true;
        const filename = `${entry.caseId}-receipt-failure.json`;
        await writeNew(path.join(output, filename), { schemaVersion: "saitu.public-browser-receipts.v7.1", invocationId: record.invocationId, realProviderDispatch: false, calls: [], failure: record.receiptFailure });
        record.receiptPath = filename; record.receiptSha256 = byteHash(await readFile(path.join(output, filename)));
      }
      record.consoleErrors = errors; record.responses = responses;
      record.thresholds = deliveryThresholds(record.timing);
      await writeNew(path.join(output, `${entry.caseId}-dom.json`), { url: page.url(), title: await page.title(), text: await page.locator("body").innerText(), record });
      results[index] = record; await context.close(); return record;
      }
    });
    for (const [index, entry] of registration.plan.cases.entries()) if (!results[index]) {
      const outcome = scheduling.outcomes[index];
      const record = { caseId: entry.caseId, viewport: entry.viewport, invocationId: `attempt-${entry.caseId}`, runId: null, realProviderDispatch: false, success: false, pageDelivered: false, criticalReviewPassed: false, timing: null, failure: outcome?.reason ?? "adaptive_case_not_started", scheduling: scheduling.slotTimings[index] ?? null, outcomeKind: outcome?.kind ?? "not_run" };
      const receiptPath = `${entry.caseId}-not-delivered-receipt.json`;
      await writeNew(path.join(output, receiptPath), { schemaVersion: "saitu.public-browser-receipts.v7.1", invocationId: record.invocationId, realProviderDispatch: false, calls: [], outcome, noAutomaticRetry: true });
      record.receiptPath = receiptPath; record.receiptSha256 = byteHash(await readFile(path.join(output, receiptPath))); results[index] = record;
      await writeNew(path.join(output, `${entry.caseId}-not-delivered.json`), { noDOMDeliveryClaimed: true, record });
    }
    await writeNew(path.join(output, "browser-scheduling.json"), { policy: BROWSER_SCHEDULING_POLICY, ...scheduling, denominator: 5, failuresRemainInDenominator: true });
    const batchOriginals = await closeBrowserBatchOriginals(client, config.spend, results);
    await writeNew(path.join(output, "batch-ledger-originals.json"), batchOriginals);
    await validatePins(config);
    await writeNew(path.join(output, "public-admission.json"), { schemaVersion: "saitu.public-admission.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, authorContextId: config.authorContextId,
      ...Object.fromEntries(hashKeys.map(key => [key, config[key]])), registrationSha256, status: batchOriginals.valid ? "pending_independent_critical_review" : "blocked_batch_original_attribution", executionIntegrityPassed: batchOriginals.valid, batchOriginals: { path: "batch-ledger-originals.json", sha256: byteHash(await readFile(path.join(output, "batch-ledger-originals.json"))) }, runs: results,
      executionRuntimeConfiguration: runtimeConfiguration(), executionScope, browserSchedulingPolicy: BROWSER_SCHEDULING_POLICY, schedulingEvidence: { path: "browser-scheduling.json", sha256: byteHash(await readFile(path.join(output, "browser-scheduling.json"))) }, runtimeBehaviorConfiguration: runtimeBehaviorConfiguration(),
      independentReview: { contextId: null, passed: false, evidenceSha256: null }, limitations: ["Five public synthetic profiles; no human user effect measured", "No retries or historical results added", "Independent critical review must be completed separately"] });
  } finally { await browser?.close(); await client.end(); }
}
async function main() {
  requireValue(process.cwd() === root, "run_public_browser_tool_from_repository_root");
  const cli = options(process.argv.slice(2));
  if (cli["--describe"]) { console.log(JSON.stringify({ execution: "not_started", paidCalls: 0, requiredPins: hashKeys, requiredRuntime: configuredBrowserEffortRuntime(), requiredGrantVersion: V7_GRANT_VERSION, requiredSpendFields: ["grantVersion", "authorizedEffort", "effortPolicy", "effortPolicySha256", "effortConditionSha256"], requiredEnvironment: ["RUN_V7_PUBLIC_LIVE=1", "SAITU_V7_SOURCE_SHA256", "AI_PROVIDER", "AI_MODEL", "AI_REASONING_EFFORT", "AI_API_KEY", "AI_CONVERSATION_SIGNING_SECRET", "DATABASE_URL", "AI_SPEND_RUN_ID", "AI_SPEND_PHASE", "AI_SPEND_AUTHORIZED_EFFORT", "AI_SPEND_EFFORT_CONDITION_SHA256", "SAITU_V7_EFFORT_POLICY", "SAITU_V7_EFFORT_POLICY_SHA256", "AI_SPEND_POLICY_SHA256"], plan: await json(planFile), runtimeConfiguration: runtimeConfiguration(), runtimeBehaviorConfiguration: runtimeBehaviorConfiguration() }, null, 2)); return; }
  if (cli["--pins"]) {
    requireValue(cli["--output"], "new_pin_output_required");
    await writeNew(cli["--output"], { schemaVersion: "saitu.public-browser-pins.v7.1", generatedAt: new Date().toISOString(), policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256, executed: false, paidCalls: 0, ...await bindings() }); return;
  }
  if (cli["--register"]) {
    requireValue(cli["--config"] && cli["--output"], "config_and_new_output_required");
    const config = validateConfig(await json(cli["--config"])); await validatePins(config);
    const plan = await json(planFile); requireValue(plan.cases.length === 5 && plan.cases.filter(entry => entry.viewport === "mobile").length >= 1, "five_new_desktop_mobile_cases_required");
    await writeNew(cli["--output"], { schemaVersion: "saitu.public-browser-registration.v7.1", registeredAt: new Date().toISOString(), executed: false, paidCalls: 0, config, plan, planSha256: config.planSha256 }); return;
  }
  requireValue(cli["--registration"] && cli["--output"] && isHash(cli["--registration-sha256"]), "registration_hash_and_new_output_directory_required");
  const registrationBytes = await readFile(cli["--registration"]);
  requireValue(byteHash(registrationBytes) === cli["--registration-sha256"], "registered_public_browser_original_bytes_changed");
  await execute(JSON.parse(registrationBytes), path.resolve(cli["--output"]), cli["--registration-sha256"], registrationBytes);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { const secrets = [process.env.AI_API_KEY, process.env.DATABASE_URL, process.env.AI_CONVERSATION_SIGNING_SECRET].filter(Boolean); const message = secrets.reduce((text, secret) => text.split(secret).join("[REDACTED]"), error instanceof Error ? error.message : "public_browser_tool_failed"); console.error(message); process.exitCode = 1; });
