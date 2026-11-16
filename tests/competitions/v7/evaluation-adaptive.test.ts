import { describe, expect, it } from "vitest";
import { setTimeout as pause } from "node:timers/promises";
import { ADAPTIVE_EXECUTION_POLICY, runAdaptiveSlotQueue } from "../../../scripts/lib/adaptive-execution.mjs";
import { providerCapacityFeedback } from "../../../scripts/competitions/v7/evaluation-executor.mjs";

describe("v7 adaptive original-slot execution", () => {
  it("grows past two from real capacity signals, retains order and serializes checkpoints", async () => {
    const started: number[] = [], events: any[] = []; let inFlight = 0, peak = 0, writing = 0, peakWriters = 0;
    const result = await runAdaptiveSlotQueue(Array.from({ length: 12 }, (_, i) => i), {
      sampleResources: () => ({ initialConcurrency: 1, capacity: 8 }), onEvent: event => events.push(event),
      run: async (slot, _index, feedback) => {
        started.push(slot); peak = Math.max(peak, ++inFlight); await pause(2); await feedback({ healthy: true }); inFlight--;
        return { kind: "observed", slot };
      },
      onCheckpoint: async () => { peakWriters = Math.max(peakWriters, ++writing); await pause(1); writing--; },
    });
    expect(started).toEqual(Array.from({ length: 12 }, (_, i) => i)); expect(new Set(started).size).toBe(12);
    expect(peak).toBeGreaterThan(2); expect(peak).toBeLessThanOrEqual(8); expect(peakWriters).toBe(1);
    expect(result.outcomes.map(row => row.slot)).toEqual(started);
    expect(events.at(-1)).toMatchObject({ type: "coordinator_settled", inFlight: 0 });
    expect(result.policy).toEqual(ADAPTIVE_EXECUTION_POLICY); expect(result.policy.modelConcurrencyLimit).toBeNull();
  });
  it("reduces future admissions after 429 and keeps the original failure without retry", async () => {
    const calls: number[] = []; let clock = 0;
    const result = await runAdaptiveSlotQueue([0, 1, 2, 3], {
      sampleResources: () => ({ initialConcurrency: 1, capacity: 4 }), now: () => clock,
      wait: async ms => { clock += ms; },
      run: async (slot, _index, feedback) => {
        calls.push(slot); if (!slot) { await feedback({ backpressure: true, retryAfterMs: 50, reason: "rate_limited" }); return { kind: "error", httpStatus: 429 }; }
        return { kind: "observed" };
      },
    });
    expect(calls).toEqual([0, 1, 2, 3]); expect(result.outcomes[0]).toEqual({ kind: "error", httpStatus: 429 });
    expect(result.slotTimings[1].startedAtEpochMs).toBeGreaterThanOrEqual(50); expect(result.stopReason).toBeNull();
  });
  it("keeps rapid multi-stage successes from opening the whole queue and grows beyond the seed", async () => {
    const calls: number[] = []; let release!: () => void;
    const finishedStages = new Promise<void>(resolve => { release = resolve; });
    const result = await runAdaptiveSlotQueue(Array.from({ length: 40 }, (_, i) => i), {
      sampleResources: () => ({ initialConcurrency: 3, capacity: 40 }),
      run: async (slot, _index, feedback) => {
        calls.push(slot);
        if (!slot) {
          for (let stage = 0; stage < 24; stage++) await feedback({ healthy: true });
          release();
        } else await finishedStages;
        return { kind: "observed", slot };
      },
    });
    const peak = Math.max(...result.schedulingEvents.filter(event => event.type === "slot_started").map(event => event.inFlight));
    expect(peak).toBeGreaterThan(3); expect(peak).toBeLessThanOrEqual(7);
    expect(calls).toEqual(Array.from({ length: 40 }, (_, i) => i)); expect(new Set(calls).size).toBe(40);
    expect(result.outcomes.every(row => row.kind === "observed")).toBe(true);
    expect(result.policy.modelConcurrencyLimit).toBeNull();
  });
  it("reduces capacity after a dispatched timeout without adding its duration as cooldown", async () => {
    const calls: number[] = []; let clock = 0, waits = 0, release!: () => void;
    const originals = new Promise<void>(resolve => { release = resolve; });
    const result = await runAdaptiveSlotQueue(Array.from({ length: 10 }, (_, i) => i), {
      sampleResources: () => ({ initialConcurrency: 6, capacity: 10 }), now: () => clock,
      wait: async ms => { waits++; clock += ms; },
      run: async (slot, _index, feedback) => {
        calls.push(slot);
        if (!slot) {
          for (let stage = 0; stage < 5; stage++) await feedback({ healthy: true });
          await feedback(providerCapacityFeedback({ upstreamAttempted: true, reason: "timeout", durationMs: 60_000 }, true));
          for (let stage = 0; stage < 3; stage++) await feedback({ healthy: true, afterTimeout: true });
          release();
          return { kind: "indeterminate", reason: "timeout_original_retained" };
        }
        await originals; return { kind: "observed", slot };
      },
    });
    const afterTimeout = result.schedulingEvents.filter(event => event.feedback?.afterTimeout);
    expect(afterTimeout.map(event => event.capacity)).toEqual([3, 3, 4]);
    expect(result.schedulingEvents.find(event => event.feedback?.backpressure)).toMatchObject({ capacity: 3, healthyCredits: 0, inFlight: 6, cooldownUntil: 0 });
    expect(result.slotTimings.slice(6).every(timing => timing.startedAtEpochMs === 0)).toBe(true); expect(waits).toBe(0);
    expect(calls).toEqual(Array.from({ length: 10 }, (_, i) => i)); expect(new Set(calls).size).toBe(10);
    expect(result.outcomes[0]).toEqual({ kind: "indeterminate", reason: "timeout_original_retained" });
    expect(result.outcomes.slice(1).every(row => row.kind === "observed")).toBe(true);
  });
  it("keeps a real Retry-After in force when another in-flight request times out", async () => {
    let clock = 0;
    const result = await runAdaptiveSlotQueue([0, 1], {
      sampleResources: () => ({ initialConcurrency: 1, capacity: 2 }), now: () => clock,
      wait: async ms => { clock += ms; },
      run: async (slot, _index, feedback) => {
        if (!slot) {
          await feedback(providerCapacityFeedback({ upstreamAttempted: true, reason: "rate_limited", httpStatus: 429, retryAfterMs: 50, durationMs: 1 }, true));
          await feedback(providerCapacityFeedback({ upstreamAttempted: true, reason: "timeout", durationMs: 60_000 }, true));
        }
        return { kind: "observed", slot };
      },
    });
    expect(result.schedulingEvents.filter(event => event.feedback?.backpressure).map(event => event.cooldownUntil)).toEqual([50, 50]);
    expect(result.slotTimings[1].startedAtEpochMs).toBe(50);
  });
  it("does not invent provider feedback for pre-dispatch failures, receipt replay or an old unknown guard", () => {
    const timeout = { upstreamAttempted: true, reason: "timeout", durationMs: 60_000 };
    expect(providerCapacityFeedback(timeout)).toBeNull(); expect(providerCapacityFeedback(timeout, false)).toBeNull();
    expect(providerCapacityFeedback({ ...timeout, upstreamAttempted: false, durationMs: 0 }, true)).toBeNull();
    expect(providerCapacityFeedback({ ...timeout, reason: "durable_outcome_unknown" }, true)).toBeNull();
    expect(providerCapacityFeedback({ upstreamAttempted: true, httpStatus: 200 }, false)).toBeNull();
    expect(providerCapacityFeedback({ upstreamAttempted: false, reason: "spend_store_unavailable" }, false)).toEqual({ stop: true, reason: "spend_store_unavailable" });
  });
  it("continues independent slots after an ordinary unknown and stops only an explicit global failure", async () => {
    const calls: number[] = [];
    const result = await runAdaptiveSlotQueue([0, 1, 2], { sampleResources: () => ({ initialConcurrency: 1, capacity: 1 }),
      run: async slot => { calls.push(slot); if (!slot) throw new Error("case_timeout_original_retained"); return { kind: "observed" }; } });
    expect(calls).toEqual([0, 1, 2]); expect(result.outcomes[0].kind).toBe("indeterminate"); expect(result.stopReason).toBeNull();
    let settled = false;
    const stopped = await runAdaptiveSlotQueue([0, 1, 2, 3], { sampleResources: () => ({ initialConcurrency: 2, capacity: 2 }),
      run: async slot => { if (!slot) { await pause(1); const error = new Error("ledger_unavailable") as Error & { globalStop: boolean }; error.globalStop = true; throw error; } await pause(4); settled = true; return { kind: "observed" }; } });
    expect(settled).toBe(true); expect(stopped.stopReason).toBe("global_coordinator_evidence_or_identity_failure");
    expect(stopped.outcomes.slice(2).every(row => row.kind === "not_run")).toBe(true);
    expect(stopped.schedulingEvents.at(-1)?.inFlight).toBe(0);
  });
  it("waits for already started work when physical resource observations fail", async () => {
    let samples = 0, settled = 0;
    const result = await runAdaptiveSlotQueue([0, 1, 2], {
      sampleResources: () => { if (++samples > 1) throw new Error("resource_probe_unavailable"); return { initialConcurrency: 2, capacity: 2 }; },
      run: async () => { await pause(2); settled++; return { kind: "observed" }; },
    });
    expect(settled).toBe(2); expect(result.outcomes[2].kind).toBe("not_run");
    expect(result.stopReason).toBe("coordinator_resource_sampling_failed"); expect(result.schedulingEvents.at(-1)?.inFlight).toBe(0);
  });
  it("keeps quick failed HTTP content neutral rather than rewarding queue growth", () => {
    for (const reason of ["truncated", "invalid_json", "invalid_output", "response_too_large"]) {
      const result = { ok: false, upstreamAttempted: true, httpStatus: 200, reason, durationMs: 100 };
      expect(providerCapacityFeedback(result, true, { elapsedMs: 100, budgetMs: 1000 })).toBeNull();
      expect(providerCapacityFeedback(result, true)).toBeNull();
    }
  });
  it("reduces future admissions for failed content near its original deadline without inventing a 429", () => {
    const result = { ok: false, upstreamAttempted: true, httpStatus: 200, reason: "truncated", finishReason: "length", durationMs: 57882, usage: { outputTokens: 8192 } };
    const original = structuredClone(result);
    const feedback = providerCapacityFeedback(result, true, { elapsedMs: 57874, budgetMs: 59142 });
    expect(feedback).toMatchObject({ backpressure: true, reason: "unsuccessful_request_budget_pressure", successfulResponse: false, httpStatus: 200 });
    expect(feedback.healthy).toBeUndefined(); expect(feedback.retryAfterMs).toBeUndefined();
    expect(result).toEqual(original);
    expect(providerCapacityFeedback(result, true, { elapsedMs: 799, budgetMs: 1000 })).toBeNull();
    expect(providerCapacityFeedback(result, true, { elapsedMs: 800, budgetMs: 1000 })).toMatchObject({ backpressure: true });
  });
});
