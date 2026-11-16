import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { effortPolicySha256, parseEffortPolicy, readConfiguredEffortPolicy, type DecisionEffortPolicy } from "./effort-policy.mjs";

const policies = new AsyncLocalStorage<DecisionEffortPolicy>();
export function currentDecisionEffortPolicy(): DecisionEffortPolicy {
  return policies.getStore() ?? readConfiguredEffortPolicy();
}
/** A durable run may not switch policy partway through its call graph. */
export function withDecisionEffortPolicy<T>(policy: DecisionEffortPolicy, work: () => T): T {
  const validated = parseEffortPolicy(policy), current = policies.getStore();
  if (current && effortPolicySha256(current) !== effortPolicySha256(validated)) throw new Error("decision_effort_policy_changed_within_run");
  return policies.run(validated, work);
}
