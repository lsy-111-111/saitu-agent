import test from 'node:test';
import assert from 'node:assert/strict';
import { readAvailableHostMemory } from '../../scripts/lib/adaptive-execution.mjs';
import { browserResourceCapacity, createBrowserResourceSampler } from './v7-browser-scheduling.mjs';

const GiB = 1024 ** 3;
test('reclaimable available memory allows real capacity despite low bare free RAM', () => {
  const host = readAvailableHostMemory({ totalMemoryBytes: 48 * GiB, freeMemoryBytes: GiB, availableMemoryBytes: 16 * GiB });
  assert.equal(host.availableMemorySource, 'node_process_available_memory');
  assert.equal(host.freeMemoryBytes, GiB);
  assert.equal(browserResourceCapacity({ ...host, availableParallelism: 18 }), 18);
});
test('zero or genuinely insufficient available memory preserves zero capacity', () => {
  for (const availableMemoryBytes of [0, GiB]) {
    const host = readAvailableHostMemory({ totalMemoryBytes: 48 * GiB, freeMemoryBytes: GiB, availableMemoryBytes });
    assert.equal(host.availableMemoryBytes, availableMemoryBytes);
    assert.equal(browserResourceCapacity({ ...host, availableParallelism: 18 }), 0);
  }
});
test('unavailable or invalid native memory falls back conservatively', () => {
  for (const availableMemoryBytes of [null, NaN, -1, 49 * GiB]) {
    const host = readAvailableHostMemory({ totalMemoryBytes: 48 * GiB, freeMemoryBytes: GiB, availableMemoryBytes });
    assert.equal(host.availableMemorySource, 'os_freemem_conservative_fallback');
    assert.equal(host.availableMemoryBytes, GiB);
    assert.equal(browserResourceCapacity({ ...host, availableParallelism: 18 }), 0);
  }
});
test('existing free-memory fixtures remain supported without inventing capacity', () => {
  assert.equal(browserResourceCapacity({ totalMemoryBytes: 48 * GiB, freeMemoryBytes: GiB, availableParallelism: 18 }), 0);
});
test('observed per-context growth uses available memory rather than cache fluctuations', () => {
  let snapshot = 0;
  const sampler = createBrowserResourceSampler({ hostSnapshot: () => ({ totalMemoryBytes: 48 * GiB, freeMemoryBytes: (snapshot++ ? .5 : 1) * GiB,
    availableMemoryBytes: 16 * GiB, availableParallelism: 18 }) });
  try { const state = sampler.sample({ inFlight: 1 }); assert.equal(state.observedContextBytes, 256 * 1024 ** 2); assert.equal(state.physicalCapacity, 18); }
  finally { sampler.close(); }
});
test('invalid snapshots fail rather than forcing a positive physical capacity', () => {
  assert.throws(() => readAvailableHostMemory({ totalMemoryBytes: 1, freeMemoryBytes: 2, availableMemoryBytes: 2 }), /actual_host_memory_snapshot/);
  assert.throws(() => browserResourceCapacity({ totalMemoryBytes: GiB, availableMemoryBytes: 2 * GiB, availableParallelism: 18 }), /actual_browser_host_resource/);
});
