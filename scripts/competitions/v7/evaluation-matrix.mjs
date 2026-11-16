import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POLICY_VERSION, POLICY_SHA256, FORMAL_ARMS, EVALUATION_POLICY, canonicalHash, isHash, isUint32,
  assertRankingGroups, writeNewJson, parseFileCli } from "./evaluation-policy.mjs";
import { USER_UNBOUNDED_EXECUTION_MODE, USER_UNBOUNDED_EXECUTION_LIMITS } from "../../../src/lib/ai/execution-policy.mjs";

export const MATRIX = Object.freeze([
  { id: "ranking_B", cases: 120, repeats: 5, paid: false, formal: true },
  { id: "ranking_C", cases: 120, repeats: 5, paid: true, formal: true },
  { id: "ranking_C_reuse_in_800", cases: 120, repeats: 5, paid: false, reuse: true },
  { id: "hard_constraints", cases: 300, repeats: 1, paid: false },
  { id: "factual", cases: 100, repeats: 1, paid: true },
  { id: "profile", cases: 120, repeats: 1, paid: true },
  { id: "conversation", cases: 80, repeats: 1, paid: true },
  { id: "robustness", cases: 80, repeats: 1, paid: true },
  { id: "new_public_admission", cases: 5, repeats: 1, paid: true },
  { id: "simulation_pilot", cases: 12, repeats: 1, paid: true },
  { id: "simulation_comparison", cases: 60, repeats: 2, paid: false, reuse: true, reuseSource: "formal_B_C_original_reports", comparisonPairs: 60 },
  { id: "simulation_comprehension", cases: 60, repeats: 2, paid: false, optionalMeteredProvider: true, purpose: "additional_simulated_responses_only_not_recommendation_regeneration" },
  { id: "performance", cases: 100, repeats: 1, paid: true },
  { id: "switch_rollback_stability", cases: null, repeats: 1, paid: true },
  { id: "targeted_repairs_and_retests", cases: null, repeats: 1, paid: true },
]);
export const TOP5_HTTP_BOUNDS = Object.freeze({ rank: 2, explain: 2, review: 1, report: 5, factCheck: 3, extractProfile: 1,
  chatTurnWithoutRerank: 3, chatTurnWithRerank: 6, maximumConversation: 77, maximumRobustnessPair: 154 });
/** Read public operation shape only; never a key, grade or prior judgment. */
export function operationHttpUpperBound(item, depth = 0) {
  if (!item?.input || typeof item.input !== "object") throw new Error("public_operation_input_required_for_cost_bound");
  if (item.operation === "constraint_check") return 0;
  if (item.operation === "fact_check") return TOP5_HTTP_BOUNDS.factCheck;
  if (item.operation === "extract_profile") return TOP5_HTTP_BOUNDS.extractProfile;
  if (item.operation === "conversation") {
    const turns = item.input.turns;
    if (!Array.isArray(turns) || turns.length < 1 || turns.length > 12) throw new Error("finite_conversation_turn_count_required_for_cost_bound");
    return (item.input.prepareReport === true ? TOP5_HTTP_BOUNDS.report : 0) + turns.length *
      (item.input.rerankAfterUpdates === true ? TOP5_HTTP_BOUNDS.chatTurnWithRerank : TOP5_HTTP_BOUNDS.chatTurnWithoutRerank);
  }
  if (item.operation === "robustness" && depth === 0) return operationHttpUpperBound(item.input.base, 1) + operationHttpUpperBound(item.input.perturbed, 1);
  throw new Error("actual_operation_cost_bound_unavailable_or_nested_robustness");
}
const finite = n => typeof n === "number" && Number.isFinite(n) && n >= 0;
/** Planning is read-only. It cannot create a budget batch or invoke a provider. */
export function planEvaluationMatrix(input) {
  const unbounded = input.executionMode === USER_UNBOUNDED_EXECUTION_MODE;
  if (input.schemaVersion !== "saitu.evaluation-cost-input.v7.1" || !finite(input.balanceCny) || !finite(input.cumulativeChargedOrHeldCny) ||
      (unbounded ? input.fundedLimitCny !== null || input.totalCapCny !== null : !finite(input.fundedLimitCny) || input.fundedLimitCny <= 0 || !finite(input.totalCapCny) || input.fundedLimitCny > input.totalCapCny)) throw new Error("explicit_current_execution_mode_and_physical_funding_required");
  const unknownHeldCny = input.unknownHeldCny ?? 0;
  if (!finite(unknownHeldCny)) throw new Error("explicit_nonnegative_unknown_hold_required");
  const balanceAfterUnknownCny = Math.max(0, input.balanceCny - unknownHeldCny);
  const remainingCny = unbounded ? balanceAfterUnknownCny : Math.max(0, Math.min(balanceAfterUnknownCny, input.fundedLimitCny - input.cumulativeChargedOrHeldCny, input.totalCapCny - input.cumulativeChargedOrHeldCny));
  const simulationComprehensionMode = input.simulationComprehensionMode ?? "work_context";
  if (!["work_context", "metered_provider"].includes(simulationComprehensionMode)) throw new Error("explicit_simulation_comprehension_cost_mode_required");
  const rows = MATRIX.map(baseRow => {
    const row = baseRow.id === "simulation_comprehension" ? { ...baseRow, paid: simulationComprehensionMode === "metered_provider", simulationMode: simulationComprehensionMode } : baseRow;
    const estimate = input.estimates?.[row.id], cases = row.cases ?? estimate?.cases ?? null;
    if (cases !== null && (!Number.isSafeInteger(cases) || cases < 1)) throw new Error("positive_scenario_case_count_required");
    const invocations = cases === null ? null : cases * row.repeats;
    if (!row.paid) return { ...row, cases, invocations, additionalPaidInvocations: 0, maxHttpDispatches: 0, usageEstimatedCny: 0, conservativeReservedCny: 0,
      status: row.reuse ? row.id === "simulation_comparison" ? "reuse_original_B_C_reports_no_regeneration" : "reuse_same_C_invocation_no_regeneration" : row.id === "simulation_comprehension" ? "independent_work_context_no_business_provider_cost" : "local_no_provider_cost" };
    const maxCalls = estimate?.maxHttpPerInvocation ?? null;
    if (maxCalls !== null && (!Number.isSafeInteger(maxCalls) || maxCalls < 1)) throw new Error("positive_finite_http_bound_required");
    const bound = invocations !== null && maxCalls !== null ? invocations * maxCalls : null;
    const evidenced = isHash(estimate?.evidenceSha256);
    const usage = evidenced && finite(estimate?.usageEstimatePerInvocationCny) && invocations !== null ? invocations * estimate.usageEstimatePerInvocationCny : null;
    const reserve = evidenced && finite(estimate?.reservePerHttpCny) && bound !== null ? bound * estimate.reservePerHttpCny : null;
    return { ...row, cases, invocations, additionalPaidInvocations: invocations, maxHttpPerInvocation: maxCalls, maxHttpDispatches: bound,
      usageEstimatedCny: usage, conservativeReservedCny: reserve, estimateEvidenceSha256: estimate?.evidenceSha256 ?? null,
      status: usage === null || reserve === null ? unbounded ? "pending_actual_usage_and_request_size_projection" : "pending_measured_usage_and_enforceable_bound" : "estimated_not_invoice" };
  });
  const sum = key => rows.every(row => row[key] !== null) ? rows.reduce((total, row) => total + row[key], 0) : null;
  const reserve = sum("conservativeReservedCny");
  return { schemaVersion: "saitu.evaluation-cost-plan.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    rankingReports: 1200, formalAlgorithms: FORMAL_ARMS, developmentOnly: ["A1"], rankingCRecommendationRuns: 600,
    cReportsReusedIn800: 600, additionalRankingPaidRuns: 0, otherSealedCases: 680, remainingCny, unknownHeldCny, balanceAfterUnknownCny,
    executionMode: input.executionMode ?? "finite", ...(unbounded ? { executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS, projectionNotAuthorizationCap: true,
      aggregateReserveIsNotInstantaneousHold: true } : {}),
    implementationHttpBounds: TOP5_HTTP_BOUNDS, finiteBatchCeiling: unbounded ? null : { calls: 1000, fundingCny: 100, createsAuthorization: false },
    simulationComparison: { pairs: 60, originalReportsReused: 120, additionalRecommendationPaidInvocations: 0,
      selection: "reuse_formal_B_C_report_quality_and_comprehension", additionalSimulationCostsRow: "simulation_comprehension" },
    simulationComprehensionMode,
    usageEstimatedCny: sum("usageEstimatedCny"), conservativeReservedCny: reserve,
    affordable: unbounded ? sum("usageEstimatedCny") === null ? null : sum("usageEstimatedCny") <= remainingCny : reserve === null ? null : reserve <= remainingCny,
    status: unbounded ? "physical_usage_projection_no_artificial_trial_limit" : reserve === null ? "pending_complete_cost_bounds" : reserve <= remainingCny ? "estimate_fits_no_authorization" : "blocked_budget",
    rows, executed: false, formalExecution: { cases: 0, rankingReports: 0 }, actualUsageCny: null, providerInvoiceCny: null,
    notes: ["B/C are 120 independent families x 5 runs each. A1 is development only.", "The 120 ranking cases reuse the exact 600 C observations; no repeated ranking call.",
      "The 60 paired comparisons reuse 120 original B/C reports; no extra recommendation invocation is budgeted.",
      "Additional simulated comprehension responses have a separate finite cost row; work-context simulations must not be reported as metered provider invoices.",
      "HTTP stages, recommendation invocations and independent families are different denominators.", "Timeout, budget refusal, error and unknown dispatch outcomes retain their original slots.",
      "A plan neither authorizes spending nor opens sealed inputs. Missing bounds remain pending."] };
}
/** Deterministic 1200-slot schedule; runtime executors must checkpoint intent before dispatch. */
export function createRankingSlots(profiles, seed) {
  assertRankingGroups(profiles);
  if (!isUint32(seed)) throw new Error("uint32_matrix_seed_required");
  return profiles.flatMap(profile => Array.from({ length: 5 }, (_, repetition) => FORMAL_ARMS.map(algorithm => ({
    slotId: canonicalHash({ policyVersion: POLICY_VERSION, seed, profileId: profile.profileId, repetition, algorithm }),
    profileId: profile.profileId, caseId: profile.caseId, familyId: profile.familyId, taskGroup: profile.taskGroup,
    repetition, algorithm, status: "not_run",
  })))).flat();
}
export const formalRuntime = EVALUATION_POLICY.runtime;
async function main() {
  const options = parseFileCli(process.argv.slice(2));
  const result = planEvaluationMatrix(JSON.parse(await readFile(options["--input"], "utf8")));
  await writeNewJson(options["--output"], result);
  console.log(JSON.stringify({ output: options["--output"], status: result.status, rankingReports: 1200, executed: false }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
