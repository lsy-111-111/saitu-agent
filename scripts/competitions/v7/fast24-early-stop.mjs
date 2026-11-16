import { isDeepStrictEqual } from "node:util";
import { hasFast24RecommendationCount } from "./fast24-config.mjs";

/** Optimistic failure bounds only. Unresolved outputs never become successes. */
export const FAST24_EARLY_STOP_VERSION = "saitu.fast24.early-stop.v1";

const matchesItemOrder = (rows, itemIds) => Array.isArray(rows) && rows.length === itemIds.length &&
  rows.every((row, index) => row?.itemId === itemIds[index]);
const finalSelectionVersion = value => {
  const version = typeof value === "string" ? /^saitu-explain\.v7\.(\d+)\./u.exec(value) : null;
  return version && Number(version[1]) >= 48;
};

/** The final public report owns completion and item identity. The first list is only a rank receipt. */
export function fast24FinalReportEvidence(observation) {
  if (observation?.status !== "observed" || observation.fallback !== false || observation.output?.fallback?.used === true) return null;
  const recommendations = observation.output?.recommendations;
  const ready = Array.isArray(observation.groupedRuns) ? observation.groupedRuns.findLast(row => row.status === "ready") : null;
  if (!Array.isArray(recommendations) || !ready) return null;
  const itemIds = recommendations.map(row => row?.itemId);
  if (itemIds.some(id => typeof id !== "string" || !id.trim()) || new Set(itemIds).size !== itemIds.length) return null;
  const body = ready.body ?? {};
  if (body.report && !isDeepStrictEqual(body.report, observation.output)) return null;
  const groups = body.detailGroups?.groups;
  const versionRequiresFinalPlan = finalSelectionVersion(observation.output.trace?.promptVersion) ||
    finalSelectionVersion(body.report?.trace?.promptVersion) ||
    Array.isArray(groups) && groups.some(group => finalSelectionVersion(group?.prepared?.groupSpec?.explanationPromptVersion));
  if ((versionRequiresFinalPlan || Object.hasOwn(body, "finalPlan")) && (!body.report || !matchesItemOrder(body.finalPlan?.recommendations, itemIds) ||
      !matchesItemOrder(body.items, itemIds) || !body.items.every(item => item.detailStatus === "ready"))) return null;
  return { ready, itemIds, technicalComplete: hasFast24RecommendationCount(itemIds.length) };
}

export function fast24CSlotEvidence(slot, result) {
  const observation = result?.observation;
  const report = fast24FinalReportEvidence(observation);
  const technicalComplete = report?.technicalComplete === true;
  const itemIds = technicalComplete || report?.itemIds.length === 0 ? report.itemIds : null;
  return { slotId: slot.slotId, caseId: slot.caseId, repetition: slot.repetition,
    terminal: Boolean(observation), technicalComplete, finalItemIds: itemIds,
    rankSeriesIds: itemIds ? [...new Set(itemIds.map(id => id.split(":")[0]))].sort() : null };
}

export function assessFast24EarlyStop({ slots, evidence = [], minimumComplete = 46, minimumJaccard = .80,
  confirmedCritical = [] }) {
  if (slots.length !== 48 || new Set(slots.map(row => row.slotId)).size !== 48 ||
      slots.some(row => row.algorithm !== "C") || minimumComplete !== 46 || minimumJaccard !== .80)
    throw new Error("fast24_early_stop:fixed48_and_unchanged_thresholds_required");
  const byId = new Map(evidence.map(row => [row.slotId, row]));
  if (byId.size !== evidence.length || evidence.some(row => !slots.some(slot => slot.slotId === row.slotId)))
    throw new Error("fast24_early_stop:evidence_identity_changed");
  const failed = slots.filter(slot => {
    const row = byId.get(slot.slotId);
    return row?.terminal && (!row.technicalComplete || row.rankSeriesIds?.length === 0);
  });
  const profiles = [...new Set(slots.map(row => row.caseId))];
  if (profiles.length !== 24 || profiles.some(caseId => {
    const repetitions = slots.filter(row => row.caseId === caseId).map(row => row.repetition).sort();
    return repetitions.length !== 2 || repetitions[0] !== 0 || repetitions[1] !== 1;
  }))
    throw new Error("fast24_early_stop:fixed24_pairs_required");
  let upperPairSum = 0, resolvedPairs = 0;
  for (const caseId of profiles) {
    const [left, right] = slots.filter(row => row.caseId === caseId).map(slot => byId.get(slot.slotId));
    const a = left?.rankSeriesIds, b = right?.rankSeriesIds;
    let upper = 1;
    // An original terminal without a rank is permanently missing; empty/empty remains0.
    if (left?.terminal && (!left.technicalComplete || a === null) ||
        right?.terminal && (!right.technicalComplete || b === null) || a?.length === 0 || b?.length === 0) upper = 0;
    else if (Array.isArray(a) && Array.isArray(b)) {
      const union = new Set([...a, ...b]); upper = union.size ? a.filter(id => b.includes(id)).length / union.size : 0;
    }
    if (upper !== 1 || Array.isArray(a) && Array.isArray(b)) resolvedPairs += 1;
    upperPairSum += upper;
  }
  const completeUpperBound = 48 - failed.length, jaccardUpperBound = upperPairSum / 24;
  const reason = confirmedCritical.length ? "independent_confirmed_critical_error" :
    completeUpperBound < minimumComplete ? "complete_C48_optimistic_bound_below46" :
      jaccardUpperBound + Number.EPSILON < minimumJaccard ? "Jaccard24_optimistic_bound_below0.80" : null;
  return { schemaVersion: FAST24_EARLY_STOP_VERSION, stop: Boolean(reason), reason,
    fixedCReportDenominator: 48, fixedPairDenominator: 24, terminalC: evidence.filter(row => row.terminal).length,
    definitiveIncompleteC: failed.length, completeUpperBound, jaccardUpperBound, resolvedPairs,
    criticalSignals: confirmedCritical.length,
    interpretation: "Only future admissions stop. Started slots settle; every failed, unknown and unstarted slot remains in its fixed denominator." };
}
