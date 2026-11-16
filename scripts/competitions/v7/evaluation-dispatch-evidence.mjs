/** An unpaid rejected repair slot is retained in the receipt but is not a
 * provider dispatch. Every actual dispatch still needs the original ledger
 * binding; one valid call must not conceal an unbound paid call. */
export function hasBoundProviderDispatch(calls, spendRunId, runtime = EVALUATION_POLICY.runtime) {
  const policy = validateEvaluationRuntime(runtime), legacy = runtime.effortPolicy === undefined;
  const proven = call => call.originalReceipt?.kind === "receipt" || call.originalReceipt?.result?.upstreamAttempted === true;
  const potential = call => proven(call) || ["dispatch_intent", "unknown", "response_received"].includes(call.call_state) || Boolean(call.reservation_id) || (call.call_state === "completed" && !call.originalReceipt);
  return calls.some(proven) && calls.filter(potential).every(call => {
    try { assertCallEffort(call, policy, { legacy }); } catch { return false; }
    return call.spend_run_id === spendRunId && call.model === "deepseek-flash" && typeof call.reservation_id === "string" && call.reservation_id.length > 0;
  });
}
import { EVALUATION_POLICY } from "./evaluation-policy.mjs";
import { validateEvaluationRuntime, assertCallEffort } from "./evaluation-effort.mjs";

