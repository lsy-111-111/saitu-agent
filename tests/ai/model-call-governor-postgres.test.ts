import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeDb = vi.hoisted(() => {
  const state: {
    handler: (sql: string, params: unknown[]) => Promise<unknown>;
  } = { handler: async () => ({ rowCount: 0, rows: [] }) };
  const client = {
    query: (sql: string, params: unknown[] = []) => state.handler(sql, params),
    release: vi.fn()
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn((sql: string, params: unknown[] = []) => state.handler(sql, params))
  };
  return { state, pool, client };
});

vi.mock("@/lib/db/pool", () => ({
  getPool: () => fakeDb.pool,
  isDatabaseConfigured: () => Boolean(process.env.DATABASE_URL?.trim())
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://fixture.invalid/resume_ai";
  process.env.AI_CONCURRENCY_MAX = "1";
  process.env.AI_QUEUE_MAX = "1";
  process.env.AI_QUEUE_WAIT_MS = "20";
  process.env.AI_MODEL_CALLS_PER_DAY = "2";
  fakeDb.pool.connect.mockClear();
  fakeDb.pool.query.mockClear();
  fakeDb.client.release.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  process.env = { ...originalEnv };
});

describe("PostgreSQL model call governor", () => {
  it("fails closed when the global lease transaction cannot start", async () => {
    fakeDb.pool.connect.mockRejectedValueOnce(new Error("synthetic database outage"));
    const { acquireModelCallPermit } = await import("@/lib/ai/model-call-governor");
    expect(await acquireModelCallPermit()).toEqual({
      ok: false,
      reason: "budget_store_unavailable"
    });
  });

  it("fails closed before the absolute queue deadline when commit never settles", async () => {
    fakeDb.state.handler = async (rawSql) => {
      const sql = rawSql.replace(/\s+/g, " ").trim().toLowerCase();
      if (sql === "commit") return new Promise(() => undefined);
      if (sql === "begin" || sql === "rollback") return { rowCount: null, rows: [] };
      if (sql.startsWith("select set_config('statement_timeout'")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.startsWith("select pg_advisory_xact_lock") ||
          sql.startsWith("select public.resume_ai_runtime_prune_model_gate")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes("count(*)::text as active_count")) {
        return { rowCount: 1, rows: [{ active_count: "0" }] };
      }
      if (sql.startsWith("select waiter_id::text")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.startsWith("insert into ai_model_daily_usage")) {
        return { rowCount: 1, rows: [{ call_count: 1 }] };
      }
      if (sql.startsWith("insert into ai_model_call_leases")) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected SQL in hanging-commit fixture: ${sql}`);
    };
    const { acquireModelCallPermit } = await import("@/lib/ai/model-call-governor");
    const startedAt = Date.now();
    const outcome = await Promise.race([
      acquireModelCallPermit({
        maxWaitMs: 20,
        deadlineEpochMs: Date.now() + 100
      }),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 150))
    ]);

    expect(outcome).toEqual({ ok: false, reason: "budget_store_unavailable" });
    expect(Date.now() - startedAt).toBeLessThan(150);
    expect(fakeDb.client.release).toHaveBeenCalledWith(true);
  });

  it("shares concurrency, queue and daily budget across fresh module instances", async () => {
    const leases = new Map<string, Date>();
    const waiters = new Map<string, { expiresAt: Date; enqueuedAt: number }>();
    let dailyUsage = 0;
    let order = 0;
    let advisoryLocks = 0;

    fakeDb.state.handler = async (rawSql, params) => {
      const sql = rawSql.replace(/\s+/g, " ").trim().toLowerCase();
      if (sql === "begin" || sql === "commit" || sql === "rollback") {
        return { rowCount: null, rows: [] };
      }
      if (sql.startsWith("select set_config('statement_timeout'")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.startsWith("select pg_advisory_xact_lock")) {
        advisoryLocks += 1;
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.startsWith("select public.resume_ai_runtime_prune_model_gate")) {
        for (const [id, expiry] of leases) if (expiry.getTime() <= Date.now()) leases.delete(id);
        for (const [id, waiter] of waiters) {
          if (waiter.expiresAt.getTime() <= Date.now()) waiters.delete(id);
        }
        return { rowCount: 1, rows: [{ resume_ai_runtime_prune_model_gate: 0 }] };
      }
      if (sql.includes("count(*)::text as active_count")) {
        return { rowCount: 1, rows: [{ active_count: String(leases.size) }] };
      }
      if (sql.startsWith("select waiter_id::text")) {
        const first = [...waiters.entries()].sort((left, right) =>
          left[1].enqueuedAt - right[1].enqueuedAt || left[0].localeCompare(right[0])
        )[0];
        return { rowCount: first ? 1 : 0, rows: first ? [{ waiter_id: first[0] }] : [] };
      }
      if (sql.includes("count(*)::text as queued_count")) {
        return { rowCount: 1, rows: [{ queued_count: String(waiters.size) }] };
      }
      if (sql.startsWith("insert into ai_model_call_waiters")) {
        waiters.set(String(params[0]), { expiresAt: params[1] as Date, enqueuedAt: order++ });
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("select public.resume_ai_runtime_delete_model_waiter")) {
        const removed = waiters.delete(String(params[0]));
        return { rowCount: 1, rows: [{ deleted: removed }] };
      }
      if (sql.startsWith("insert into ai_model_daily_usage")) {
        const limit = Number(params[1]);
        if (dailyUsage >= limit) return { rowCount: 0, rows: [] };
        dailyUsage += 1;
        return { rowCount: 1, rows: [{ call_count: dailyUsage }] };
      }
      if (sql.startsWith("insert into ai_model_call_leases")) {
        leases.set(String(params[0]), new Date((params[1] as Date).getTime()));
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("select public.resume_ai_runtime_delete_model_lease")) {
        const removed = leases.delete(String(params[0]));
        return { rowCount: 1, rows: [{ resume_ai_runtime_delete_model_lease: removed }] };
      }
      if (sql.startsWith("update ai_model_call_leases")) {
        const id = String(params[0]);
        if (leases.has(id)) leases.set(id, new Date((params[1] as Date).getTime()));
        return { rowCount: leases.has(id) ? 1 : 0, rows: [] };
      }
      throw new Error(`Unexpected SQL in model governor fixture: ${sql}`);
    };

    const firstModule = await import("@/lib/ai/model-call-governor");
    const first = await firstModule.acquireModelCallPermit();
    expect(first.ok).toBe(true);
    expect(leases.size).toBe(1);
    expect(dailyUsage).toBe(1);

    vi.resetModules();
    const secondModule = await import("@/lib/ai/model-call-governor");
    expect(await secondModule.acquireModelCallPermit()).toEqual({
      ok: false,
      reason: "capacity_exhausted"
    });
    expect(dailyUsage).toBe(1);
    expect(waiters.size).toBe(0);

    if (first.ok) first.permit.release();
    await Promise.resolve();
    expect(leases.size).toBe(0);

    vi.resetModules();
    const thirdModule = await import("@/lib/ai/model-call-governor");
    const third = await thirdModule.acquireModelCallPermit();
    expect(third.ok).toBe(true);
    expect(dailyUsage).toBe(2);
    if (third.ok) third.permit.release();
    await Promise.resolve();

    vi.resetModules();
    const fourthModule = await import("@/lib/ai/model-call-governor");
    expect(await fourthModule.acquireModelCallPermit()).toEqual({
      ok: false,
      reason: "daily_budget_exhausted"
    });
    expect(dailyUsage).toBe(2);
    expect(advisoryLocks).toBeGreaterThanOrEqual(4);
  });

  it("backs off persistent queue polling and bounds per-waiter transaction pressure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    process.env.AI_CONCURRENCY_MAX = "1";
    process.env.AI_QUEUE_MAX = "1";
    process.env.AI_QUEUE_WAIT_MS = "15000";
    process.env.AI_MODEL_CALLS_PER_DAY = "1200";

    const leases = new Map<string, Date>();
    const waiters = new Map<string, { expiresAt: Date; enqueuedAt: number }>();
    const queuedAttemptTimes: number[] = [];
    let order = 0;
    let dailyUsage = 0;
    let countQueuedAttempts = false;

    fakeDb.state.handler = async (rawSql, params) => {
      const sql = rawSql.replace(/\s+/g, " ").trim().toLowerCase();
      if (sql === "begin" || sql === "commit" || sql === "rollback") {
        return { rowCount: null, rows: [] };
      }
      if (sql.startsWith("select set_config('statement_timeout'")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.startsWith("select pg_advisory_xact_lock")) {
        if (countQueuedAttempts) queuedAttemptTimes.push(Date.now());
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.startsWith("select public.resume_ai_runtime_prune_model_gate")) {
        for (const [id, expiry] of leases) if (expiry.getTime() <= Date.now()) leases.delete(id);
        for (const [id, waiter] of waiters) {
          if (waiter.expiresAt.getTime() <= Date.now()) waiters.delete(id);
        }
        return { rowCount: 1, rows: [{ resume_ai_runtime_prune_model_gate: 0 }] };
      }
      if (sql.includes("count(*)::text as active_count")) {
        return { rowCount: 1, rows: [{ active_count: String(leases.size) }] };
      }
      if (sql.startsWith("select waiter_id::text")) {
        const first = [...waiters.entries()].sort((left, right) =>
          left[1].enqueuedAt - right[1].enqueuedAt || left[0].localeCompare(right[0])
        )[0];
        return { rowCount: first ? 1 : 0, rows: first ? [{ waiter_id: first[0] }] : [] };
      }
      if (sql.includes("count(*)::text as queued_count")) {
        return { rowCount: 1, rows: [{ queued_count: String(waiters.size) }] };
      }
      if (sql.startsWith("insert into ai_model_call_waiters")) {
        waiters.set(String(params[0]), { expiresAt: params[1] as Date, enqueuedAt: order++ });
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("select public.resume_ai_runtime_delete_model_waiter")) {
        const removed = waiters.delete(String(params[0]));
        return { rowCount: 1, rows: [{ deleted: removed }] };
      }
      if (sql.startsWith("insert into ai_model_daily_usage")) {
        dailyUsage += 1;
        return { rowCount: 1, rows: [{ call_count: dailyUsage }] };
      }
      if (sql.startsWith("insert into ai_model_call_leases")) {
        leases.set(String(params[0]), new Date((params[1] as Date).getTime()));
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("select public.resume_ai_runtime_delete_model_lease")) {
        const removed = leases.delete(String(params[0]));
        return { rowCount: 1, rows: [{ resume_ai_runtime_delete_model_lease: removed }] };
      }
      if (sql.startsWith("update ai_model_call_leases")) {
        return { rowCount: leases.has(String(params[0])) ? 1 : 0, rows: [] };
      }
      throw new Error(`Unexpected SQL in queue backoff fixture: ${sql}`);
    };

    const governor = await import("@/lib/ai/model-call-governor");
    const active = await governor.acquireModelCallPermit({
      deadlineEpochMs: Date.now() + 180_000
    });
    expect(active.ok).toBe(true);
    countQueuedAttempts = true;

    const queued = governor.acquireModelCallPermit({
      maxWaitMs: 15_000,
      deadlineEpochMs: Date.now() + 180_000
    });
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(queued).resolves.toEqual({ ok: false, reason: "capacity_exhausted" });
    expect(queuedAttemptTimes.length).toBeLessThanOrEqual(40);
    expect(queuedAttemptTimes.slice(1, 5).map((time, index) =>
      time - queuedAttemptTimes[index]!
    )).toEqual([75, 150, 300, 400]);
    expect(random).toHaveBeenCalled();

    queuedAttemptTimes.length = 0;
    random.mockReturnValue(0.999);
    const queuedAfterRelease = governor.acquireModelCallPermit({
      maxWaitMs: 15_000,
      deadlineEpochMs: Date.now() + 180_000
    });
    await vi.advanceTimersByTimeAsync(1_155);
    expect(queuedAttemptTimes.slice(1, 5).map((time, index) =>
      time - queuedAttemptTimes[index]!
    )).toEqual([93, 187, 375, 500]);
    const releasedAt = Date.now();
    if (active.ok) active.permit.release();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    const acquiredAfterRelease = await queuedAfterRelease;
    expect(acquiredAfterRelease.ok).toBe(true);
    expect(queuedAttemptTimes.at(-1)! - releasedAt).toBeLessThanOrEqual(500);
    if (acquiredAfterRelease.ok) acquiredAfterRelease.permit.release();
    await Promise.resolve();
  });
});
