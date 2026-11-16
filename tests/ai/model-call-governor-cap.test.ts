import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireModelCallPermit,
  getModelCallGovernorConfigurationSnapshot,
  MODEL_CALL_GOVERNOR_POLICY_VERSION,
  MODEL_CALL_TRANSPORT_CONCURRENCY_MAX,
  resetModelCallGovernorForTests
} from "@/lib/ai/model-call-governor";

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.DATABASE_URL = "";
  process.env.AI_QUEUE_WAIT_MS = "20";
  process.env.AI_QUEUE_MAX = "1";
  process.env.AI_MODEL_CALLS_PER_DAY = "100";
  resetModelCallGovernorForTests();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  Reflect.set(process.env, "NODE_ENV", "test");
  resetModelCallGovernorForTests();
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("immutable two-transport ceiling", () => {
  it.each([undefined, "2", "8", "128", "NaN", "0", "-1", "1.9"])(
    "cannot raise the source ceiling through env=%s",
    async (configured) => {
      if (configured === undefined) delete process.env.AI_CONCURRENCY_MAX;
      else process.env.AI_CONCURRENCY_MAX = configured;
      const cap = configured === "1.9" ? 1 : 2;
      expect(MODEL_CALL_TRANSPORT_CONCURRENCY_MAX).toBe(2);
      expect(getModelCallGovernorConfigurationSnapshot()).toMatchObject({
        policyVersion: MODEL_CALL_GOVERNOR_POLICY_VERSION,
        transportConcurrencyHardMax: 2,
        transportConcurrencyEffectiveMax: cap
      });
      const active = [];
      for (let i = 0; i < cap; i += 1) active.push(await acquireModelCallPermit());
      expect(active.every(value => value.ok)).toBe(true);
      expect(await acquireModelCallPermit({ maxWaitMs: 0 })).toEqual({ ok: false, reason: "capacity_exhausted" });
      for (const result of active) if (result.ok) result.permit.release();
    }
  );

  it("retains an operator's conservative cap=1", async () => {
    process.env.AI_CONCURRENCY_MAX = "1";
    const first = await acquireModelCallPermit();
    expect(first.ok).toBe(true);
    expect(await acquireModelCallPermit({ maxWaitMs: 0 })).toEqual({ ok: false, reason: "capacity_exhausted" });
    if (first.ok) first.permit.release();
  });

  it("exposes only content-free policy and persistence fields", () => {
    expect(Object.keys(getModelCallGovernorConfigurationSnapshot()).sort()).toEqual([
      "databaseConfigured", "persistentRequired", "policyVersion", "schemaVersion",
      "transportConcurrencyEffectiveMax", "transportConcurrencyHardMax"
    ]);
  });

  it("fails closed for real production DeepSeek even if every synthetic flag is set", async () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    Object.assign(process.env, {
      AI_PROVIDER: "deepseek", E2E_ALLOW_EPHEMERAL_SECURITY_STATE: "1",
      AI_TEST_MODE: "1", ALLOW_AI_MOCK: "1", NEXT_PUBLIC_AI_TEST_MODE: "1"
    });
    expect(getModelCallGovernorConfigurationSnapshot()).toMatchObject({ persistentRequired: true, databaseConfigured: false });
    expect(await acquireModelCallPermit()).toEqual({ ok: false, reason: "budget_store_unavailable" });
  });

  it("retains the existing isolated mock-only production E2E memory path", async () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    Object.assign(process.env, {
      AI_PROVIDER: "mock", E2E_ALLOW_EPHEMERAL_SECURITY_STATE: "1",
      AI_TEST_MODE: "1", ALLOW_AI_MOCK: "1", NEXT_PUBLIC_AI_TEST_MODE: "1"
    });
    expect(getModelCallGovernorConfigurationSnapshot().persistentRequired).toBe(false);
    const result = await acquireModelCallPermit();
    expect(result.ok).toBe(true);
    if (result.ok) result.permit.release();
  });
});
