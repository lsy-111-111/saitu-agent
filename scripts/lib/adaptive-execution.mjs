import { availableParallelism, freemem, totalmem } from "node:os";
import { getHeapStatistics } from "node:v8";
import { setTimeout as pause } from "node:timers/promises";

export const ADAPTIVE_EXECUTION_POLICY = Object.freeze({ schemaVersion: "saitu.adaptive-execution.v1",
  mode: "physical_resources_and_provider_backpressure", modelConcurrencyLimit: null, totalCallLimit: null,
  totalCostLimitMicros: null, slotRetries: false, checkpointWriter: "single_coordinator", finalization: "all_started_slots_settled" });

/** Node 24 includes reclaimable OS memory; bare free memory understates it. */
export function readAvailableHostMemory({ freeMemoryBytes = freemem(), totalMemoryBytes = totalmem(),
  availableMemoryBytes = process.availableMemory?.() } = {}) {
  if (!Number.isFinite(totalMemoryBytes) || totalMemoryBytes <= 0 || !Number.isFinite(freeMemoryBytes) || freeMemoryBytes < 0 || freeMemoryBytes > totalMemoryBytes)
    throw new Error("actual_host_memory_snapshot_required");
  const nativeAvailable = Number.isFinite(availableMemoryBytes) && availableMemoryBytes >= 0 && availableMemoryBytes <= totalMemoryBytes;
  return { freeMemoryBytes, totalMemoryBytes, availableMemoryBytes: nativeAvailable ? availableMemoryBytes : freeMemoryBytes,
    availableMemorySource: nativeAvailable ? "node_process_available_memory" : "os_freemem_conservative_fallback" };
}

/** Resource observations seed capacity; they are not a model concurrency quota.
 * Further growth is permitted until actual memory or provider pressure intervenes. */
export function createAdaptiveResourceSampler() {
  const baselineRss = process.memoryUsage().rss;
  let observedWorkerBytes = Math.max(1, Math.ceil(baselineRss / availableParallelism()));
  return ({ inFlight = 0 } = {}) => {
    const memory = process.memoryUsage(), heap = getHeapStatistics(), hostMemory = readAvailableHostMemory();
    if (inFlight) observedWorkerBytes = Math.max(observedWorkerBytes, Math.ceil(Math.max(0, memory.rss - baselineRss) / inFlight));
    const availableMemoryBytes = Math.max(0, Math.min(hostMemory.availableMemoryBytes, heap.total_available_size));
    return { initialConcurrency: availableParallelism(), capacity: Math.floor(availableMemoryBytes / observedWorkerBytes),
      ...hostMemory, availableMemoryBytes, hostAvailableMemoryBytes: hostMemory.availableMemoryBytes,
      availableParallelism: availableParallelism(), heapAvailableBytes: heap.total_available_size,
      rssBytes: memory.rss, observedWorkerBytes, basis: "available_cpu_seed_and_observed_worker_memory_physical_capacity" };
  };
}

/** Every original slot starts at most once. Feedback changes only future
 * admissions; failures/unknowns are never converted into invisible retries. */
export async function runAdaptiveSlotQueue(slots, { run, sampleResources = createAdaptiveResourceSampler(), initialConcurrency,
  resourceCapacity, onEvent = () => {}, onCheckpoint = async () => {}, now = Date.now,
  shouldStopOnError = error => error?.globalStop === true,
  wait = (ms, signal) => pause(ms, undefined, { signal }).catch(error => { if (error.name !== "AbortError") throw error; }) }) {
  if (!Array.isArray(slots) || typeof run !== "function" || typeof sampleResources !== "function") throw new Error("adaptive_slots_runner_and_resource_sampler_required");
  const outcomes = Array(slots.length), slotTimings = Array(slots.length), failures = [], schedulingEvents = [], active = new Set();
  const enqueuedAt = now();
  let cursor = 0, stopped = false, stopReason = null, capacity, healthyCredits = 0, cooldownUntil = 0, sequence = 0, checkpointTail = Promise.resolve(), eventTail = Promise.resolve();
  let wakeResolve, changed = new Promise(resolve => { wakeResolve = resolve; });
  const wake = () => { wakeResolve(); changed = new Promise(resolve => { wakeResolve = resolve; }); };
  const state = () => ({ inFlight: active.size, started: cursor, completed: outcomes.filter(Boolean).length, capacity, healthyCredits, cooldownUntil });
  const emit = (type, details = {}) => {
    const event = { sequence: ++sequence, type, atEpochMs: now(), ...state(), ...details }; schedulingEvents.push(event);
    eventTail = eventTail.then(() => onEvent(event)).catch(error => {
      stopped = true; stopReason = "adaptive_scheduling_evidence_write_failed";
      failures.push({ reason: stopReason, error: error instanceof Error ? error.message : String(error) }); wake();
    });
    return eventTail;
  };
  const checkpoint = () => {
    const snapshot = Array.from({ length: slots.length }, (_, index) => outcomes[index] ?? { kind: "not_run", reason: "not_started" });
    checkpointTail = checkpointTail.then(() => onCheckpoint(snapshot, { ...state(), stopReason }));
    return checkpointTail;
  };
  async function feedback(signal = {}) {
    if (signal.stop === true) { stopped = true; stopReason = signal.reason ?? "physical_or_provider_unavailable"; }
    if (signal.backpressure === true) {
      capacity = Math.max(1, Math.floor(capacity / 2));
      healthyCredits = 0;
      // Request duration is not a provider retry instruction. Keep any real
      // Retry-After already in force, without adding a second deadline window.
      const observedDelay = Number.isFinite(signal.retryAfterMs) && signal.retryAfterMs >= 0 ? signal.retryAfterMs : 0;
      if (observedDelay > 0) cooldownUntil = Math.max(cooldownUntil, now() + observedDelay);
    } else if (signal.healthy === true && !stopped) {
      // A full capacity-sized success window earns one more admission, even
      // when a multi-stage slot reports several successful model calls.
      healthyCredits += 1;
      if (healthyCredits >= capacity) {
        capacity = Math.min(slots.length || 1, capacity + 1);
        healthyCredits = 0;
      }
    }
    await emit("capacity_feedback", { feedback: signal }); wake();
  }
  function launch(index, resources) {
    const startedAtEpochMs = now();
    slotTimings[index] = { enqueuedAtEpochMs: enqueuedAt, startedAtEpochMs, queueWaitMs: startedAtEpochMs - enqueuedAt, inFlightAtStart: active.size + 1 };
    let job;
    job = (async () => {
      await emit("slot_started", { slotIndex: index, inFlight: active.size + 1, ...slotTimings[index], resources });
      try {
        if (stopped) { outcomes[index] = { kind: "not_run", reason: stopReason }; return; }
        outcomes[index] = await run(slots[index], index, feedback);
        if (outcomes[index]?.stopScheduling === true) await feedback({ stop: true, reason: outcomes[index].reason ?? "slot_requested_stop" });
      } catch (error) {
        outcomes[index] = { kind: "indeterminate", reason: "coordinator_slot_error_no_regeneration", error: error instanceof Error ? error.message : String(error) };
        failures.push(outcomes[index]);
        if (shouldStopOnError(error, slots[index], index)) { stopped = true; stopReason = "global_coordinator_evidence_or_identity_failure"; }
        // The failed original is retained. Only transport evidence supplied by
        // the caller can establish provider pressure, not a coordinator error.
      } finally {
        slotTimings[index].finishedAtEpochMs = now();
        await emit("slot_finished", { slotIndex: index, outcomeKind: outcomes[index]?.kind ?? null, ...slotTimings[index] });
        try { await checkpoint(); } catch (error) {
          failures.push({ reason: "coordinator_checkpoint_failed", error: String(error) }); stopped = true; stopReason = "coordinator_checkpoint_failed";
        }
      }
    })().finally(() => { active.delete(job); wake(); });
    active.add(job);
  }
  try { while ((!stopped && cursor < slots.length) || active.size) {
    const resources = await sampleResources(state());
    const physicalCapacity = typeof resourceCapacity === "function" ? resourceCapacity(resources, state()) : resourceCapacity ?? resources?.capacity;
    if (!Number.isSafeInteger(physicalCapacity) || physicalCapacity < 0) throw new Error("actual_nonnegative_physical_resource_capacity_required");
    if (capacity === undefined) {
      const seed = typeof initialConcurrency === "function" ? initialConcurrency(resources) : initialConcurrency ?? resources?.initialConcurrency;
      if (!Number.isSafeInteger(seed) || seed < 1) throw new Error("actual_positive_initial_resource_capacity_required");
      capacity = seed;
    }
    while (!stopped && cursor < slots.length && active.size < Math.min(capacity, physicalCapacity) && now() >= cooldownUntil) {
      launch(cursor++, resources);
    }
    if (!active.size) {
      if (stopped || cursor >= slots.length) break;
      if (!physicalCapacity) { stopped = true; stopReason = "physical_resource_unavailable_before_next_slot"; await emit("resource_paused", { resources, stopReason }); break; }
    }
    if (active.size || now() < cooldownUntil) {
      const controller = new AbortController(), signals = [...active, changed];
      if (now() < cooldownUntil) signals.push(wait(cooldownUntil - now(), controller.signal));
      try { await Promise.race(signals); } finally { controller.abort(); }
    }
  } } catch (error) {
    stopped = true; stopReason = "coordinator_resource_sampling_failed";
    failures.push({ reason: stopReason, error: error instanceof Error ? error.message : String(error) });
  }
  await Promise.allSettled([...active]);
  await checkpointTail.catch(() => {}); await emit("coordinator_settled", { stopReason }); await eventTail;
  return { outcomes: Array.from({ length: slots.length }, (_, index) => outcomes[index] ?? { kind: "not_run", reason: stopReason ?? "coordinator_stopped_before_slot" }),
    failures, schedulingEvents, slotTimings, stopReason, policy: ADAPTIVE_EXECUTION_POLICY };
}
