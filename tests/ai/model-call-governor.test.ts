import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireModelCallPermit,
  modelCallGovernorSnapshotForTests,
  resetModelCallGovernorForTests
} from "@/lib/ai/model-call-governor";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.DATABASE_URL = "";
  process.env.AI_CONCURRENCY_MAX = "2";
  process.env.AI_QUEUE_MAX = "1";
  process.env.AI_QUEUE_WAIT_MS = "20";
  process.env.AI_MODEL_CALLS_PER_DAY = "3";
  resetModelCallGovernorForTests();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  resetModelCallGovernorForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("AI model call governor", () => {
  it("bounds active calls and the waiting queue", async () => {
    const first = await acquireModelCallPermit();
    const second = await acquireModelCallPermit();
    expect(first.ok && second.ok).toBe(true);

    const queued = acquireModelCallPermit();
    const rejected = await acquireModelCallPermit();
    expect(rejected).toEqual({ ok: false, reason: "capacity_exhausted" });
    expect(modelCallGovernorSnapshotForTests()).toEqual({ activeCalls: 2, queuedCalls: 1 });

    if (first.ok) first.permit.release();
    const acquiredFromQueue = await queued;
    expect(acquiredFromQueue.ok).toBe(true);
    if (second.ok) second.permit.release();
    if (acquiredFromQueue.ok) acquiredFromQueue.permit.release();
    expect(modelCallGovernorSnapshotForTests()).toEqual({ activeCalls: 0, queuedCalls: 0 });
  });

  it("clips queue waiting to the caller's remaining request deadline", async () => {
    vi.useFakeTimers();
    process.env.AI_CONCURRENCY_MAX = "1";
    process.env.AI_QUEUE_WAIT_MS = "15000";
    const first = await acquireModelCallPermit();
    expect(first.ok).toBe(true);

    const queued = acquireModelCallPermit({ maxWaitMs: 25 });
    expect(modelCallGovernorSnapshotForTests()).toEqual({ activeCalls: 1, queuedCalls: 1 });
    await vi.advanceTimersByTimeAsync(26);

    await expect(queued).resolves.toEqual({ ok: false, reason: "capacity_exhausted" });
    expect(modelCallGovernorSnapshotForTests()).toEqual({ activeCalls: 1, queuedCalls: 0 });
    if (first.ok) first.permit.release();
  });

  it("reserves a content-free daily budget for exactly three calls", async () => {
    for (let index = 0; index < 3; index += 1) {
      const acquired = await acquireModelCallPermit();
      expect(acquired.ok).toBe(true);
      if (acquired.ok) acquired.permit.release();
    }
    expect(await acquireModelCallPermit()).toEqual({
      ok: false,
      reason: "daily_budget_exhausted"
    });
  });

  it("fails closed in production when the persistent budget store is unavailable", async () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    expect(await acquireModelCallPermit()).toEqual({
      ok: false,
      reason: "budget_store_unavailable"
    });
    Reflect.set(process.env, "NODE_ENV", "test");
    expect(modelCallGovernorSnapshotForTests()).toEqual({ activeCalls: 0, queuedCalls: 0 });
  });

  it("permits memory state only behind every isolated production-E2E guard", async () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.E2E_ALLOW_EPHEMERAL_SECURITY_STATE = "1";
    process.env.AI_PROVIDER = "mock";
    process.env.AI_TEST_MODE = "1";
    process.env.ALLOW_AI_MOCK = "1";
    process.env.NEXT_PUBLIC_AI_TEST_MODE = "1";

    const permit = await acquireModelCallPermit();
    expect(permit.ok).toBe(true);
    if (permit.ok) permit.permit.release();

    process.env.ALLOW_AI_MOCK = "0";
    expect(await acquireModelCallPermit()).toEqual({
      ok: false,
      reason: "budget_store_unavailable"
    });
  });
});
