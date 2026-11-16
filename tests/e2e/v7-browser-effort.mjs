import { EFFORT_GRANT_VERSION, TOP5_EFFORT_GRANT_VERSION, requireTop5EvaluationRuntime, effortPolicyForScope, evaluationRuntimeForEffort, assertSameEffortPolicy,
  readConfiguredEffortPolicy, assertLedgerEffort, assertDispatchEffort, assertCallEffort, rankNonThinkingContinuationForScope } from '../../scripts/competitions/v7/evaluation-effort.mjs';
import { hasBoundProviderDispatch } from './v7-browser-evidence.mjs';
import { assertPilotCallModelSettings } from '../../scripts/competitions/v7/pilot-contract.mjs';
import { USER_UNBOUNDED_EXECUTION_MODE, USER_UNBOUNDED_GRANT_VERSION, USER_UNBOUNDED_EXECUTION_LIMITS, readExecutionMode } from '../../src/lib/ai/execution-policy.mjs';

const demand = (ok, message) => { if (!ok) throw new Error(message); };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const nonnegative = value => value !== null && value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0;

export const isBrowserUserUnbounded = spend => spend?.executionMode === USER_UNBOUNDED_EXECUTION_MODE;
export function assertBrowserExecutionLimits(spend) {
  const unbounded = isBrowserUserUnbounded(spend);
  if (unbounded) {
    demand(spend.grantVersion === USER_UNBOUNDED_GRANT_VERSION && spend.executionLimits &&
      Object.keys(spend.executionLimits).length === Object.keys(USER_UNBOUNDED_EXECUTION_LIMITS).length &&
      Object.keys(USER_UNBOUNDED_EXECUTION_LIMITS).every(key => spend.executionLimits[key] === null), 'explicit_user_unbounded_limits_required');
    for (const key of ['maxCalls', 'callLimit', 'maxReservedMicros', 'hardLimitMicros', 'perJourneyProviderCallCap'])
      demand(spend[key] === undefined || spend[key] === null, 'unbounded_execution_cannot_hide_numeric_caps');
  } else demand(spend?.grantVersion !== USER_UNBOUNDED_GRANT_VERSION && (spend?.executionMode === undefined || spend.executionMode === 'finite'), 'grant_and_execution_mode_must_match');
  return unbounded;
}
export function assertBrowserLiveExecutionMode(spend, environment = process.env) {
  demand(assertBrowserExecutionLimits(spend) && readExecutionMode(environment) === USER_UNBOUNDED_EXECUTION_MODE, 'new_live_execution_requires_user_unbounded_authorization');
}
export function assertBrowserWorkerExecutionMode(health, spend) {
  if (isBrowserUserUnbounded(spend)) demand(health?.executionMode === USER_UNBOUNDED_EXECUTION_MODE && health.concurrency === null, 'worker_user_unbounded_mode_without_fixed_slots_required');
}
export function assertBrowserDatabaseLimits(batch, budget, spend) {
  if (assertBrowserExecutionLimits(spend)) {
    demand(batch.execution_mode === USER_UNBOUNDED_EXECUTION_MODE && batch.call_limit === null && budget?.execution_mode === USER_UNBOUNDED_EXECUTION_MODE &&
      budget.hard_limit_micros === null && nonnegative(batch.funding_limit_micros), 'actual_database_unbounded_mode_and_null_limits_required');
  } else demand(positive(batch.call_limit) && Number(batch.call_limit) <= (spend.maxCalls ?? spend.callLimit) &&
    positive(budget?.hard_limit_micros) && Number(budget.hard_limit_micros) <= (spend.maxReservedMicros ?? spend.hardLimitMicros) && positive(batch.funding_limit_micros), 'actual_database_finite_limits_changed');
}
export function browserExecutionScopeLimits(batch, budget, spend) {
  const unbounded = assertBrowserExecutionLimits(spend);
  return { executionMode: unbounded ? USER_UNBOUNDED_EXECUTION_MODE : 'finite',
    ...(unbounded ? { executionLimits: { ...USER_UNBOUNDED_EXECUTION_LIMITS } } : {}),
    callLimit: unbounded ? null : Number(batch.call_limit), hardLimitCny: unbounded ? null : Number(budget.hard_limit_micros) / 1_000_000,
    fundingLimitCny: Number(batch.funding_limit_micros) / 1_000_000,
    ...(unbounded ? { fundingSemantics: 'actual_physical_available_snapshot_not_an_authorized_cost_cap' } : {}) };
}

/** New live browser executions require the exact staged grant. Legacy artifacts
 * remain readable by the evaluation readers; they are not a new execution grant. */
export function browserEffortRuntime(spend) {
  assertBrowserExecutionLimits(spend);
  demand([EFFORT_GRANT_VERSION, TOP5_EFFORT_GRANT_VERSION, USER_UNBOUNDED_GRANT_VERSION].includes(spend?.grantVersion) && spend.authorizedEffort === 'stage' && hash(spend.effortConditionSha256) &&
    hash(spend.authorizationPolicySha256) && typeof spend.runId === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(spend.runId) &&
    typeof spend.phase === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(spend.phase), 'browser_new_stage_effort_grant_required');
  const runtime = evaluationRuntimeForEffort(effortPolicyForScope(spend));
  if (runtime.effortPolicy.version === 'saitu.effort-policy.v2') demand(isBrowserUserUnbounded(spend) && spend.grantVersion === USER_UNBOUNDED_GRANT_VERSION, 'browser_rank_nonthinking_requires_unbounded_grant');
  if ([TOP5_EFFORT_GRANT_VERSION, USER_UNBOUNDED_GRANT_VERSION].includes(spend.grantVersion) || runtime.effortPolicy.version === 'saitu.effort-policy.v2')
    requireTop5EvaluationRuntime(runtime, { allowRankNonThinking: Boolean(rankNonThinkingContinuationForScope(spend)) });
  return runtime;
}
export const configuredBrowserEffortRuntime = (environment = process.env) => evaluationRuntimeForEffort(readConfiguredEffortPolicy(environment));

export function assertBrowserEffortEnvironment(spend, environment = process.env) {
  const runtime = browserEffortRuntime(spend);
  demand(readExecutionMode(environment) === (isBrowserUserUnbounded(spend) ? USER_UNBOUNDED_EXECUTION_MODE : 'finite'), 'browser_environment_execution_mode_changed');
  assertSameEffortPolicy(readConfiguredEffortPolicy(environment), runtime.effortPolicy);
  demand(environment.SAITU_V7_EFFORT_POLICY_SHA256 === runtime.effortPolicySha256 &&
    environment.AI_SPEND_AUTHORIZED_EFFORT === 'stage' && environment.AI_SPEND_EFFORT_CONDITION_SHA256 === spend.effortConditionSha256 &&
    environment.AI_SPEND_RUN_ID === spend.runId && environment.AI_SPEND_PHASE === spend.phase &&
    environment.AI_SPEND_POLICY_SHA256 === spend.authorizationPolicySha256, 'browser_actual_environment_effort_or_scope_changed');
  return runtime;
}

export function assertBrowserEffortGrant(batch, spend, environment = process.env) {
  const runtime = assertBrowserEffortEnvironment(spend, environment);
  demand(batch?.state === 'active' && batch.run_id === spend.runId && batch.grant_version === spend.grantVersion &&
    batch.authorized_effort === 'stage' && batch.authorized_phase === spend.phase && batch.policy_sha256 === spend.authorizationPolicySha256 &&
    batch.effort_condition_sha256 === spend.effortConditionSha256 && batch.effort_policy_sha256 === runtime.effortPolicySha256 &&
    (isBrowserUserUnbounded(spend) ? batch.execution_mode === USER_UNBOUNDED_EXECUTION_MODE && batch.call_limit === null && nonnegative(batch.funding_limit_micros) : positive(batch.call_limit) && positive(batch.funding_limit_micros)), 'browser_actual_database_stage_grant_changed');
  assertSameEffortPolicy(batch.effort_policy, runtime.effortPolicy);
  return runtime;
}

export function browserLedgerEffortMatches(row, spend) {
  try {
    const runtime = browserEffortRuntime(spend);
    demand(row?.run_id === spend.runId && row.phase === spend.phase && row.model === 'deepseek-flash', 'browser_ledger_scope_changed');
    assertLedgerEffort(row, runtime.effortPolicy); return true;
  } catch { return false; }
}

export function browserCallEffortMatches(call, spend) {
  try {
    const runtime = browserEffortRuntime(spend);
    demand(call?.spend_run_id === spend.runId && call.phase === spend.phase && call.model === 'deepseek-flash' &&
      call.call_operation === call.operation && call.call_reasoning_effort === call.effort &&
      call.call_effort_policy_sha256 === call.effort_policy_sha256, 'browser_call_and_ledger_effort_binding_changed');
    const stage = /^v7\.(rank|explain|review)(?::|$)/.exec(call.call_key ?? '')?.[1];
    if (stage) demand(call.call_operation === `competition_v7_${stage}`, 'browser_call_key_operation_changed');
    assertLedgerEffort(call, runtime.effortPolicy);
    if (runtime.effortPolicy.version === 'saitu.effort-policy.v2') {
      assertCallEffort(call, runtime.effortPolicy);
      assertPilotCallModelSettings(call, runtime.effortPolicy);
    } else assertDispatchEffort({ operation: call.call_operation, reasoningEffort: call.call_reasoning_effort,
      thinkingType: call.call_thinking, effortPolicySha256: call.call_effort_policy_sha256 }, runtime.effortPolicy);
    return true;
  } catch { return false; }
}

export function hasBrowserBoundProviderDispatch(calls, spend) {
  const runtime = browserEffortRuntime(spend);
  const potential = call => call.originalReceipt?.kind === 'receipt' || call.originalReceipt?.result?.upstreamAttempted === true ||
    ['dispatch_intent', 'unknown', 'response_received'].includes(call.call_state) || Boolean(call.reservation_id) ||
    call.call_state === 'completed' && !call.originalReceipt;
  return calls.filter(potential).every(call => browserCallEffortMatches(call, spend)) && hasBoundProviderDispatch(calls, spend.runId, runtime);
}
