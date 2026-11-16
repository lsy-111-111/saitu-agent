import test from "node:test";
import assert from "node:assert/strict";
import { assessFast24EarlyStop, fast24CSlotEvidence } from "../../../scripts/competitions/v7/fast24-early-stop.mjs";
import { runAdaptiveSlotQueue } from "../../../scripts/lib/adaptive-execution.mjs";
const slots = Array.from({ length: 24 }, (_, i) => [0, 1].map(repetition => ({ slotId: `case${i}:C:${repetition}`, caseId: `case${i}`, algorithm: "C", repetition }))).flat();
const row = (index, extra = {}) => ({ ...slots[index], terminal: true, technicalComplete: true, rankSeriesIds: ["one"], ...extra });
test("third irreversible C failure stops while two failures still leave46 possible", () => {
  const failure = index => row(index, { technicalComplete: false, rankSeriesIds: null });
  assert.equal(assessFast24EarlyStop({ slots, evidence: [failure(0), failure(2)] }).stop, false);
  const decision = assessFast24EarlyStop({ slots, evidence: [failure(0), failure(2), failure(4)] });
  assert.equal(decision.reason, "complete_C48_optimistic_bound_below46"); assert.equal(decision.completeUpperBound, 45);
});
test("unresolved slots are optimistically complete and cannot cause speculative failure", () => {
  const result = assessFast24EarlyStop({ slots }); assert.equal(result.stop, false); assert.equal(result.jaccardUpperBound, 1);
});
test("three terminal empty reports rule out the nonempty completion target", () => {
  const evidence = [0, 2, 4].map(index => row(index, { rankSeriesIds: [] }));
  const result = assessFast24EarlyStop({ slots, evidence });
  assert.equal(result.definitiveIncompleteC, 3); assert.equal(result.completeUpperBound, 45);
  assert.equal(result.reason, "complete_C48_optimistic_bound_below46"); assert.equal(result.jaccardUpperBound, 21 / 24);
});
test("actual known pair sets determine an optimistic upper bound without caching prior answers", () => {
  const evidence = Array.from({ length: 5 }, (_, i) => [row(i * 2), row(i * 2 + 1, { rankSeriesIds: ["different"] })]).flat();
  assert.equal(assessFast24EarlyStop({ slots, evidence }).jaccardUpperBound, 19 / 24);
});
test("independently confirmed critical errors stop even before the numeric gates fail", () => {
  assert.equal(assessFast24EarlyStop({ slots, confirmedCritical: [{ slotId: slots[0].slotId }] }).reason, "independent_confirmed_critical_error");
});
test("only actual nonempty ready outputs count toward complete reports", () => {
  const empty = fast24CSlotEvidence(slots[0], { observation: { status: "observed", fallback: false,
    output: { recommendations: [] }, groupedRuns: [{ status: "ready", body: { plan: { recommendations: [] } } }] } });
  assert.equal(empty.technicalComplete, false); assert.deepEqual(empty.rankSeriesIds, []);
  const item = { itemId: "series:record" };
  const good = fast24CSlotEvidence(slots[0], { observation: { status: "observed", fallback: false,
    output: { recommendations: [item] }, groupedRuns: [{ status: "ready", body: { plan: { recommendations: [item] } } }] } });
  assert.equal(good.technicalComplete, true); assert.deepEqual(good.rankSeriesIds, ["series"]);
  assert.equal(fast24CSlotEvidence(slots[1], { observation: { status: "indeterminate" } }).technicalComplete, false);
});
test("a reviewed subset completes the slot and its public series drive the fixed Jaccard bound", () => {
  const provisional = ["one:record", "two:record", "three:record"].map(itemId => ({ itemId }));
  const finalized = (index, accepted) => {
    const report = { recommendations: [accepted], trace: { promptVersion: "saitu-explain.v7.48.final-reviewed-selection.detail-v2" } };
    return fast24CSlotEvidence(slots[index], { observation: { status: "observed", fallback: false, output: report,
      groupedRuns: [{ status: "ready", body: { plan: { recommendations: provisional }, report,
        finalPlan: { recommendations: [accepted] }, items: [{ ...accepted, detailStatus: "ready" }] } }] } });
  };
  const left = finalized(0, provisional[0]), right = finalized(1, provisional[1]);
  assert.equal(left.technicalComplete, true);
  assert.deepEqual(left.finalItemIds, ["one:record"]);
  assert.deepEqual(right.rankSeriesIds, ["two"]);
  assert.equal(assessFast24EarlyStop({ slots, evidence: [left, right] }).jaccardUpperBound, 23 / 24);
});
test("a failed slot with a provisional list earns no consistency credit", () => {
  const evidence = fast24CSlotEvidence(slots[0], { observation: { status: "error", fallback: false,
    groupedRuns: [{ status: "failed", body: { plan: { recommendations: [{ itemId: "one:record" }] } } }] } });
  assert.equal(evidence.technicalComplete, false);
  assert.equal(evidence.finalItemIds, null);
  assert.equal(evidence.rankSeriesIds, null);
  assert.equal(assessFast24EarlyStop({ slots, evidence: [evidence, row(1)] }).jaccardUpperBound, 23 / 24);
});
test("a new ready report requires the same accepted items in the report, final plan and ready list", () => {
  const item = { itemId: "one:record" };
  const report = { recommendations: [item], trace: { promptVersion: "saitu-explain.v7.48.final-reviewed-selection.detail-v2" } };
  const body = { report, items: [{ ...item, detailStatus: "ready" }] };
  for (const invalid of [
    body,
    { ...body, finalPlan: { recommendations: [{ itemId: "different:record" }] } },
    { ...body, finalPlan: { recommendations: [item] }, items: [{ ...item, detailStatus: "pending" }] },
    { ...body, finalPlan: { recommendations: [item] }, report: { ...report, recommendations: [] } },
  ]) {
    const rejected = fast24CSlotEvidence(slots[0], { observation: { status: "observed", fallback: false, output: report,
      groupedRuns: [{ status: "ready", body: invalid }] } });
    assert.equal(rejected.technicalComplete, false);
    assert.equal(rejected.rankSeriesIds, null);
  }
});
test("early stop waits for every already admitted slot and leaves all future slots in the denominator", async () => {
  const completed = [], resources = () => ({ capacity: 2, initialConcurrency: 2 });
  let bothStarted; const started = new Promise(resolve => { bothStarted = resolve; });
  const queue = await runAdaptiveSlotQueue([0, 1, 2, 3], { sampleResources: resources,
    run: async index => { if (index === 1) bothStarted(); await started;
      if (index === 1) await new Promise(resolve => setTimeout(resolve, 10)); completed.push(index);
      return { kind: "completed", ...(index === 0 ? { stopScheduling: true, reason: "mathematically_failed" } : {}) }; } });
  assert.deepEqual(completed.sort(), [0, 1]); assert.equal(queue.outcomes.length, 4);
  assert.equal(queue.outcomes[2].kind, "not_run"); assert.equal(queue.stopReason, "mathematically_failed");
});
