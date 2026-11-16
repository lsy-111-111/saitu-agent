import type { DecisionEffortPolicy } from "../../../src/lib/ai/effort-policy.mjs";
export { USER_UNBOUNDED_EXECUTION_MODE, USER_UNBOUNDED_GRANT_VERSION, USER_UNBOUNDED_AUTHORIZATION_POLICY,
  USER_UNBOUNDED_EXECUTION_LIMITS, readExecutionMode, isUserUnboundedExecutionMode } from "../../../src/lib/ai/execution-policy.mjs";
export { DEFAULT_EFFORT_POLICY, LEGACY_DEFAULT_EFFORT_POLICY, EFFORT_GRANT_VERSION, TOP5_EFFORT_GRANT_VERSION, parseEffortPolicy, effortPolicySha256, resolveEffortForOperation, readConfiguredEffortPolicy, resolveDecisionModelSettingsForOperation } from "../../../src/lib/ai/effort-policy.mjs";
export function evaluationRuntimeForEffort(policy: DecisionEffortPolicy): any;
export function requireTop5EvaluationRuntime(runtime: any, options?: { allowRankNonThinking?: boolean }): DecisionEffortPolicy;
export function validateEvaluationRuntime(runtime: any, options?: { requireStagePolicy?: boolean }): DecisionEffortPolicy;
export function effortPolicyForScope(scope: any): DecisionEffortPolicy;
export function assertSameEffortPolicy(actual: DecisionEffortPolicy, expected: DecisionEffortPolicy): void;
export function rankNonThinkingContinuationForScope(scope: any): any | null;
export function assertDispatchEffort(details: any, policy: DecisionEffortPolicy, options?: { legacy?: boolean }): void;
export function assertLedgerEffort(row: any, policy: DecisionEffortPolicy, options?: { legacy?: boolean }): void;
export function callOperation(call: any): string;
export function assertCallEffort(call: any, policy: DecisionEffortPolicy, options?: { legacy?: boolean }): void;
