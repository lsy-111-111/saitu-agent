import { availableParallelism, loadavg } from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { runAdaptiveSlotQueue, readAvailableHostMemory } from '../../scripts/lib/adaptive-execution.mjs';

export const BROWSER_SCHEDULING_POLICY = Object.freeze({ schemaVersion: 'saitu.normal-page-browser-scheduling.v1',
  mode: 'adaptive_physical_browser_resources', initialConcurrentJourneys: 1, modelConcurrencyLimit: null,
  contextMemoryEstimateBytes: 256 * 1024 * 1024, memoryHeadroomFraction: .10,
  eventLoopPressureMs: 50, browserRoundTripPressureMs: 250, browserFramePressureMs: 100,
  adaptationUsesProductLatencyOrQuality: false, originalClickPerSample: true, automaticSlotRetries: false });

export function browserResourceCapacity(resource, contextBytes = BROWSER_SCHEDULING_POLICY.contextMemoryEstimateBytes) {
  const availableMemoryBytes = resource.availableMemoryBytes ?? resource.freeMemoryBytes;
  if (!Number.isSafeInteger(resource.availableParallelism) || resource.availableParallelism < 1 || !Number.isFinite(availableMemoryBytes) ||
      !Number.isFinite(resource.totalMemoryBytes) || availableMemoryBytes < 0 || availableMemoryBytes > resource.totalMemoryBytes || resource.totalMemoryBytes <= 0 || !Number.isFinite(contextBytes) || contextBytes <= 0)
    throw new Error('actual_browser_host_resource_snapshot_required');
  const memoryCapacity = Math.max(0, Math.floor((availableMemoryBytes - resource.totalMemoryBytes * BROWSER_SCHEDULING_POLICY.memoryHeadroomFraction) / contextBytes));
  return Math.min(resource.availableParallelism, memoryCapacity);
}
export function createBrowserResourceSampler({ hostSnapshot = () => ({ ...readAvailableHostMemory(), availableParallelism: availableParallelism(), loadAverageOneMinute: loadavg()[0] }) } = {}) {
  const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
  const baseline = hostSnapshot(), baselineAvailable = baseline.availableMemoryBytes ?? baseline.freeMemoryBytes;
  let observedContextBytes = BROWSER_SCHEDULING_POLICY.contextMemoryEstimateBytes, browserRoundTripMs = 0, browserFrameMs = 0, browserVisibility = 'not_yet_observed';
  let latest = null;
  const sample = (state = {}) => {
    const host = hostSnapshot();
    if (state.inFlight > 0) observedContextBytes = Math.max(observedContextBytes, Math.ceil(Math.max(0, baselineAvailable - (host.availableMemoryBytes ?? host.freeMemoryBytes)) / state.inFlight));
    const eventLoopP95Ms = lag.percentile(95) / 1_000_000;
    const pressure = eventLoopP95Ms > BROWSER_SCHEDULING_POLICY.eventLoopPressureMs || browserRoundTripMs > BROWSER_SCHEDULING_POLICY.browserRoundTripPressureMs || browserFrameMs > BROWSER_SCHEDULING_POLICY.browserFramePressureMs || browserVisibility === 'hidden';
    const physicalCapacity = browserResourceCapacity(host, observedContextBytes);
    latest = { ...host, sampledAtEpochMs: Date.now(), eventLoopP95Ms, browserRoundTripMs, browserFrameMs, browserVisibility,
      observedContextBytes, contextMemorySeedIsEstimate: true, physicalCapacity, pressure,
      initialConcurrency: 1, capacity: pressure ? Math.min(physicalCapacity, Math.max(1, state.inFlight ?? 0)) : physicalCapacity,
      basis: 'actual_host_memory_CPU_and_eventloop_browser_observations_not_product_outcome' };
    return latest;
  };
  return { sample, latest: () => latest, close: () => lag.disable(),
    async observeBrowser(page) {
      const started = performance.now();
      const observation = await page.evaluate(() => new Promise(resolve => {
        const started = performance.now();
        const timer = setTimeout(() => resolve({ visibilityState: document.visibilityState, frameGapMs: performance.now() - started, frameProbeTimedOut: true }), 500);
        requestAnimationFrame(() => { clearTimeout(timer); resolve({ visibilityState: document.visibilityState, frameGapMs: performance.now() - started, frameProbeTimedOut: false }); });
      }));
      browserRoundTripMs = performance.now() - started; browserFrameMs = observation.frameGapMs; browserVisibility = observation.visibilityState;
      return { ...observation, browserRoundTripMs };
    } };
}

export async function runAdaptiveBrowserCases(cases, { runCase, onEvent, onCheckpoint, sampler = createBrowserResourceSampler() }) {
  let state = { inFlight: 0 };
  const started = new Map();
  try {
    return await runAdaptiveSlotQueue(cases, { initialConcurrency: 1, sampleResources: value => { state = value; return sampler.sample(value); },
      onEvent: event => {
        if (event.type === 'slot_started') started.set(event.slotIndex, event);
        return onEvent?.({ ...event, ...(Number.isInteger(event.slotIndex) ? { caseId: cases[event.slotIndex].caseId, viewport: cases[event.slotIndex].viewport } : {}) });
      },
      onCheckpoint,
      run: async (entry, index, feedback) => {
        const event = started.get(index);
        const result = await runCase(entry, index, { observeBrowser: page => sampler.observeBrowser(page), reportSchedulingFeedback: feedback, scheduling: {
          enqueuedAtEpochMs: event.enqueuedAtEpochMs, startedAtEpochMs: event.startedAtEpochMs,
          queueWaitMs: event.queueWaitMs, inFlightAtStart: event.inFlightAtStart, resourcesAtStart: event.resources } });
        const resources = sampler.sample(state);
        if (result.stopScheduling === true && !result.schedulingFeedbackApplied) await feedback({ stop: true, reason: result.reason ?? 'unknown_original_outcome' });
        else if (result.schedulingFeedbackApplied) { /* Feedback was persisted as soon as the original was observed. */ }
        else if (result.providerBackpressure) await feedback({ backpressure: true, ...result.providerBackpressure });
        else if (!resources.pressure && resources.physicalCapacity > 0) await feedback({ healthy: true });
        return result;
      } });
  } finally { sampler.close(); }
}

export function providerBrowserBackpressure(calls = []) {
  for (const call of calls) {
    const original = call.originalReceipt?.receipt ?? call.originalReceipt?.result;
    if (original?.httpStatus === 429 || original?.reason === 'rate_limited') return { retryAfterMs: Number.isFinite(original.retryAfterMs) && original.retryAfterMs >= 0 ? original.retryAfterMs : null, observedHttpStatus: original.httpStatus ?? null };
  }
  return null;
}
