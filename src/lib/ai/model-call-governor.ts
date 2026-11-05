import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { deadlineHasElapsed, remainingDeadlineMs } from "@/lib/ai/request-deadline";
import { isEphemeralE2eSecurityStateAllowed } from "@/lib/config/e2e-runtime";
import { getPool, isDatabaseConfigured } from "@/lib/db/pool";

export type ModelCallGateFailureReason =
  | "capacity_exhausted"
  | "daily_budget_exhausted"
  | "budget_store_unavailable";

type ModelCallPermit = { release: () => void };
type AcquireModelCallPermitOptions = {
  maxWaitMs?: number;
  signal?: AbortSignal;
  deadlineEpochMs?: number;
};
type QueueEntry = {
  resolve: (acquired: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
};
type PersistentAttempt =
  | { outcome: "acquired"; leaseId: string }
  | { outcome: "queued" }
  | { outcome: "capacity_exhausted" }
  | { outcome: "daily_budget_exhausted" };

const GOVERNOR_ADVISORY_LOCK = "724310896145221";
const MODEL_LEASE_MS = 180_000;
const MODEL_HEARTBEAT_MS = 30_000;
const MAX_MEMORY_BUDGET_DAYS = 8;
const PERSISTENT_POLL_INITIAL_MS = 75;
const PERSISTENT_POLL_BASE_MAX_MS = 400;
const PERSISTENT_POLL_JITTER_RATIO = 0.25;
const PERSISTENT_POLL_MAX_MS = 500;

class ModelGateDeadlineError extends Error {
  constructor() {
    super("Model gate deadline elapsed");
    this.name = "ModelGateDeadlineError";
  }
}

let activeCalls = 0;
const waitingCalls: QueueEntry[] = [];
const inMemoryDailyUsage = new Map<string, number>();
const persistentLeaseTimers = new Map<string, ReturnType<typeof setInterval>>();
const pendingReleases = new Set<Promise<unknown>>();

function positiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function governorConfig() {
  return {
    concurrency: positiveInteger("AI_CONCURRENCY_MAX", 8),
    queue: positiveInteger("AI_QUEUE_MAX", 32),
    waitMs: positiveInteger("AI_QUEUE_WAIT_MS", 15_000),
    dailyBudget: positiveInteger("AI_MODEL_CALLS_PER_DAY", 1200)
  };
}

function persistentGovernorRequired() {
  return isDatabaseConfigured() || (
    process.env.NODE_ENV === "production" && !isEphemeralE2eSecurityStateAllowed()
  );
}

function usageDay(now = new Date()) {
  const configured = process.env.AI_BUDGET_TIMEZONE?.trim() || "Asia/Shanghai";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: configured,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((entry) => entry.type === type)?.value;
    const year = part("year");
    const month = part("month");
    const day = part("day");
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // Invalid time zones fall back to UTC, never to an unbounded bucket.
  }
  return now.toISOString().slice(0, 10);
}

function logGate(reason: ModelCallGateFailureReason, details: Record<string, unknown> = {}) {
  const entry = JSON.stringify({
    event: "ai_model_gate",
    source: "application",
    bucket: reason === "capacity_exhausted"
      ? "model_concurrency"
      : "global_daily_model_calls",
    reason,
    outcome: "fallback",
    ...details
  });
  if (reason === "budget_store_unavailable") console.error(entry);
  else console.warn(entry);
}

function releaseMemorySlot() {
  activeCalls = Math.max(0, activeCalls - 1);
  while (waitingCalls.length > 0) {
    const next = waitingCalls.shift()!;
    clearTimeout(next.timer);
    if (next.abort) next.signal?.removeEventListener("abort", next.abort);
    if (next.signal?.aborted) {
      next.resolve(false);
      continue;
    }
    activeCalls += 1;
    next.resolve(true);
    return;
  }
}

function boundedWaitMs(configuredWaitMs: number, requestedWaitMs?: number) {
  if (requestedWaitMs === undefined) return configuredWaitMs;
  if (!Number.isFinite(requestedWaitMs) || requestedWaitMs <= 0) return 0;
  return Math.min(configuredWaitMs, Math.floor(requestedWaitMs));
}

function persistentPollDelayMs(attempt: number, remainingMs: number) {
  const exponential = PERSISTENT_POLL_INITIAL_MS * (2 ** Math.min(attempt, 3));
  const baseMs = Math.min(PERSISTENT_POLL_BASE_MAX_MS, exponential);
  const jitterCeiling = Math.floor(baseMs * PERSISTENT_POLL_JITTER_RATIO);
  const jitterMs = jitterCeiling > 0
    ? Math.floor(Math.random() * (jitterCeiling + 1))
    : 0;
  return Math.max(0, Math.min(
    remainingMs,
    PERSISTENT_POLL_MAX_MS,
    baseMs + jitterMs
  ));
}

async function acquireMemorySlot(maxWaitMs?: number, signal?: AbortSignal) {
  const config = governorConfig();
  if (signal?.aborted) return false;
  if (activeCalls < config.concurrency) {
    activeCalls += 1;
    return true;
  }
  if (waitingCalls.length >= config.queue) return false;
  const waitMs = boundedWaitMs(config.waitMs, maxWaitMs);
  if (waitMs <= 0) return false;
  return new Promise<boolean>((resolve) => {
    const entry: QueueEntry = {
      resolve,
      timer: setTimeout(() => {
        const index = waitingCalls.indexOf(entry);
        if (index >= 0) waitingCalls.splice(index, 1);
        if (entry.abort) signal?.removeEventListener("abort", entry.abort);
        resolve(false);
      }, waitMs)
    };
    entry.signal = signal;
    entry.abort = () => {
      const index = waitingCalls.indexOf(entry);
      if (index >= 0) waitingCalls.splice(index, 1);
      clearTimeout(entry.timer);
      signal?.removeEventListener("abort", entry.abort!);
      resolve(false);
    };
    waitingCalls.push(entry);
    signal?.addEventListener("abort", entry.abort, { once: true });
    if (signal?.aborted) entry.abort();
  });
}

function reserveMemoryDailyBudget() {
  const config = governorConfig();
  const day = usageDay();
  if (!inMemoryDailyUsage.has(day) && inMemoryDailyUsage.size >= MAX_MEMORY_BUDGET_DAYS) {
    for (const expiredDay of [...inMemoryDailyUsage.keys()].sort()) {
      if (expiredDay === day) continue;
      inMemoryDailyUsage.delete(expiredDay);
      if (inMemoryDailyUsage.size < MAX_MEMORY_BUDGET_DAYS) break;
    }
    if (inMemoryDailyUsage.size >= MAX_MEMORY_BUDGET_DAYS) return "unavailable" as const;
  }
  const current = inMemoryDailyUsage.get(day) ?? 0;
  if (current >= config.dailyBudget) return "exhausted" as const;
  inMemoryDailyUsage.set(day, current + 1);
  return "reserved" as const;
}

async function acquireMemoryPermit(maxWaitMs?: number, signal?: AbortSignal): Promise<
  | { ok: true; permit: ModelCallPermit }
  | { ok: false; reason: ModelCallGateFailureReason }
> {
  const slotAcquired = await acquireMemorySlot(maxWaitMs, signal);
  if (!slotAcquired) {
    logGate("capacity_exhausted", { activeCalls, queuedCalls: waitingCalls.length });
    return { ok: false, reason: "capacity_exhausted" };
  }
  const budget = reserveMemoryDailyBudget();
  if (budget !== "reserved") {
    releaseMemorySlot();
    const reason = budget === "exhausted"
      ? "daily_budget_exhausted" as const
      : "budget_store_unavailable" as const;
    logGate(reason);
    return { ok: false, reason };
  }
  let released = false;
  return {
    ok: true,
    permit: {
      release() {
        if (released) return;
        released = true;
        releaseMemorySlot();
      }
    }
  };
}

async function connectBefore(deadlineEpochMs: number, signal?: AbortSignal) {
  const remainingMs = remainingDeadlineMs(deadlineEpochMs);
  if (remainingMs <= 0 || signal?.aborted) throw new ModelGateDeadlineError();
  const connection = getPool().connect();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const settled = await (async () => {
    try {
      return await Promise.race([
        connection.then((client) => ({ client })),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), remainingMs);
        }),
        new Promise<null>((resolve) => {
          abort = () => resolve(null);
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
        })
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
    }
  })();
  if (!settled) {
    void connection.then((client) => client.release(true)).catch(() => undefined);
    throw new ModelGateDeadlineError();
  }
  return settled.client;
}

async function withTransaction<T>(
  deadlineEpochMs: number,
  signal: AbortSignal | undefined,
  work: (client: PoolClient) => Promise<T>
) {
  if (signal?.aborted) throw new ModelGateDeadlineError();
  const client = await connectBefore(deadlineEpochMs, signal);
  let transactionOpen = false;
  let destroyClient = false;
  const queryBeforeDeadline = async (args: unknown[]) => {
    const remainingMs = remainingDeadlineMs(deadlineEpochMs);
    if (remainingMs <= 0 || signal?.aborted) throw new ModelGateDeadlineError();
    const query = Reflect.apply(client.query, client, args) as Promise<unknown>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const settled = await (async () => {
      try {
        return await Promise.race([
          query.then((result) => ({ result })),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), remainingMs);
          }),
          new Promise<null>((resolve) => {
            abort = () => resolve(null);
            signal?.addEventListener("abort", abort, { once: true });
            if (signal?.aborted) abort();
          })
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (abort) signal?.removeEventListener("abort", abort);
      }
    })();
    if (!settled) {
      destroyClient = true;
      void query.catch(() => undefined);
      throw new ModelGateDeadlineError();
    }
    return settled.result;
  };
  const boundedClient = new Proxy(client, {
    get(target, property, receiver) {
      if (property === "query") {
        return (...args: unknown[]) => queryBeforeDeadline(args);
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as PoolClient;
  try {
    await queryBeforeDeadline(["begin"]);
    transactionOpen = true;
    const remainingMs = remainingDeadlineMs(deadlineEpochMs);
    if (remainingMs <= 0 || signal?.aborted) throw new ModelGateDeadlineError();
    await boundedClient.query(
      `select set_config('statement_timeout', $1, true),
              set_config('lock_timeout', $2, true)`,
      [
        `${remainingMs}ms`,
        `${Math.max(1, Math.min(5_000, remainingMs))}ms`
      ]
    );
    const result = await work(boundedClient);
    if (deadlineHasElapsed(deadlineEpochMs) || signal?.aborted) {
      throw new ModelGateDeadlineError();
    }
    await queryBeforeDeadline(["commit"]);
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen && !destroyClient) {
      const rollback = client.query("rollback");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const settled = await Promise.race([
          rollback.then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), 1_000);
          })
        ]);
        if (!settled) {
          destroyClient = true;
          void rollback.catch(() => undefined);
        }
      } catch {
        destroyClient = true;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

async function reservePersistentDailyBudget(client: PoolClient) {
  const config = governorConfig();
  const result = await client.query<{ call_count: number }>(
    `insert into ai_model_daily_usage (usage_day, bucket, call_count, updated_at)
     values ($1::date, 'global', 1, now())
     on conflict (usage_day, bucket) do update
       set call_count = ai_model_daily_usage.call_count + 1, updated_at = now()
     where ai_model_daily_usage.call_count < $2
     returning call_count`,
    [usageDay(), config.dailyBudget]
  );
  return result.rowCount === 1;
}

async function tryPersistentPermit(
  waiterId: string,
  queueDeadlineEpochMs: number,
  leaseDeadlineEpochMs: number,
  alreadyQueued: boolean,
  signal?: AbortSignal
): Promise<PersistentAttempt> {
  return withTransaction(queueDeadlineEpochMs, signal, async (client) => {
    const config = governorConfig();
    await client.query(`select pg_advisory_xact_lock($1::bigint)`, [GOVERNOR_ADVISORY_LOCK]);
    await client.query(`select public.resume_ai_runtime_prune_model_gate()`);

    const active = await client.query<{ active_count: string }>(
      `select count(*)::text as active_count from ai_model_call_leases`
    );
    const activeCount = Number(active.rows[0]?.active_count ?? 0);
    const firstWaiter = await client.query<{ waiter_id: string }>(
      `select waiter_id::text from ai_model_call_waiters
        order by enqueued_at, waiter_id limit 1`
    );
    const firstWaiterId = firstWaiter.rows[0]?.waiter_id;

    if (activeCount < config.concurrency && (!firstWaiterId || firstWaiterId === waiterId)) {
      if (alreadyQueued) {
        const removed = await client.query<{ deleted: boolean }>(
          `select public.resume_ai_runtime_delete_model_waiter($1::uuid) as deleted`,
          [waiterId]
        );
        if (removed.rows[0]?.deleted !== true) return { outcome: "capacity_exhausted" };
      }
      if (!await reservePersistentDailyBudget(client)) {
        return { outcome: "daily_budget_exhausted" };
      }
      const leaseId = randomUUID();
      await client.query(
        `insert into ai_model_call_leases (lease_id, expires_at, created_at, updated_at)
         values ($1::uuid, $2, now(), now())`,
        [leaseId, new Date(leaseDeadlineEpochMs)]
      );
      return { outcome: "acquired", leaseId };
    }

    if (!alreadyQueued) {
      const queued = await client.query<{ queued_count: string }>(
        `select count(*)::text as queued_count from ai_model_call_waiters`
      );
      if (Number(queued.rows[0]?.queued_count ?? 0) >= config.queue) {
        return { outcome: "capacity_exhausted" };
      }
      await client.query(
        `insert into ai_model_call_waiters (waiter_id, expires_at, enqueued_at)
         values ($1::uuid, $2, now())`,
        [waiterId, new Date(queueDeadlineEpochMs)]
      );
    }
    return { outcome: "queued" };
  });
}

function startPersistentLeaseHeartbeat(leaseId: string, leaseDeadlineEpochMs: number) {
  const timer = setInterval(() => {
    if (deadlineHasElapsed(leaseDeadlineEpochMs)) return;
    void getPool().query(
      `update ai_model_call_leases
          set expires_at = least(
                $2::timestamptz,
                now() + ($3::bigint * interval '1 millisecond')
              ), updated_at = now()
        where lease_id = $1::uuid`,
      [leaseId, new Date(leaseDeadlineEpochMs), MODEL_LEASE_MS]
    ).catch(() => logGate("budget_store_unavailable", { phase: "lease_heartbeat" }));
  }, MODEL_HEARTBEAT_MS);
  timer.unref?.();
  persistentLeaseTimers.set(leaseId, timer);
}

function releasePersistentLease(leaseId: string) {
  const timer = persistentLeaseTimers.get(leaseId);
  if (timer) clearInterval(timer);
  persistentLeaseTimers.delete(leaseId);
  const release = getPool().query(
    `select public.resume_ai_runtime_delete_model_lease($1::uuid)`,
    [leaseId]
  ).catch(() => {
    // The heartbeat is already stopped. The short lease temporarily reduces
    // capacity but cannot allow more than the configured global concurrency.
    logGate("budget_store_unavailable", { phase: "lease_release" });
  });
  pendingReleases.add(release);
  void release.finally(() => pendingReleases.delete(release));
}

function removePersistentWaiter(waiterId: string) {
  void getPool().query(
      `select public.resume_ai_runtime_delete_model_waiter($1::uuid)`,
      [waiterId]
    ).catch(() => {
    // Its expiry is fixed to the wait deadline, so a failed cleanup can only
    // cause temporary fail-closed queue pressure.
    });
}

async function waitForPendingReleases(waitMs: number, signal?: AbortSignal) {
  if (pendingReleases.size === 0) return true;
  if (waitMs <= 0 || signal?.aborted) return false;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.allSettled([...pendingReleases]).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), waitMs);
      }),
      new Promise<false>((resolve) => {
        abort = () => resolve(false);
        signal?.addEventListener("abort", abort, { once: true });
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

async function acquirePersistentPermit(
  maxWaitMs: number | undefined,
  leaseDeadlineEpochMs: number,
  signal?: AbortSignal
): Promise<
  | { ok: true; permit: ModelCallPermit }
  | { ok: false; reason: ModelCallGateFailureReason }
> {
  const config = governorConfig();
  const waitBudgetMs = boundedWaitMs(config.waitMs, maxWaitMs);
  const waitStartedAt = Date.now();
  if (!await waitForPendingReleases(waitBudgetMs, signal)) {
    logGate("capacity_exhausted", { phase: "pending_release" });
    return { ok: false, reason: "capacity_exhausted" };
  }
  const waitMs = Math.max(0, waitBudgetMs - (Date.now() - waitStartedAt));
  if (waitMs <= 0) {
    logGate("capacity_exhausted");
    return { ok: false, reason: "capacity_exhausted" };
  }
  const waiterId = randomUUID();
  const deadline = Date.now() + waitMs;
  let alreadyQueued = false;
  let pollAttempt = 0;
  try {
    while (Date.now() < deadline && !signal?.aborted) {
      const attempt = await tryPersistentPermit(
        waiterId,
        deadline,
        leaseDeadlineEpochMs,
        alreadyQueued,
        signal
      );
      if (attempt.outcome === "acquired") {
        if (deadlineHasElapsed(deadline) || signal?.aborted) {
          releasePersistentLease(attempt.leaseId);
          logGate("capacity_exhausted", { phase: "post_acquire_deadline" });
          return { ok: false, reason: "capacity_exhausted" };
        }
        startPersistentLeaseHeartbeat(attempt.leaseId, leaseDeadlineEpochMs);
        let released = false;
        return {
          ok: true,
          permit: {
            release() {
              if (released) return;
              released = true;
              releasePersistentLease(attempt.leaseId);
            }
          }
        };
      }
      if (attempt.outcome === "capacity_exhausted") {
        if (alreadyQueued) removePersistentWaiter(waiterId);
        logGate("capacity_exhausted");
        return { ok: false, reason: "capacity_exhausted" };
      }
      if (attempt.outcome === "daily_budget_exhausted") {
        if (alreadyQueued) removePersistentWaiter(waiterId);
        logGate("daily_budget_exhausted");
        return { ok: false, reason: "daily_budget_exhausted" };
      }
      alreadyQueued = true;
      const pollMs = persistentPollDelayMs(
        pollAttempt,
        remainingDeadlineMs(deadline)
      );
      pollAttempt += 1;
      await new Promise<void>((resolve) => {
        const finish = () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        };
        const timer = setTimeout(finish, Math.min(pollMs, remainingDeadlineMs(deadline)));
        const abort = () => {
          clearTimeout(timer);
          finish();
        };
        signal?.addEventListener("abort", abort, { once: true });
      });
    }
    if (alreadyQueued) removePersistentWaiter(waiterId);
    logGate("capacity_exhausted");
    return { ok: false, reason: "capacity_exhausted" };
  } catch {
    if (alreadyQueued) removePersistentWaiter(waiterId);
    logGate("budget_store_unavailable", { phase: "acquire" });
    return { ok: false, reason: "budget_store_unavailable" };
  }
}

export async function acquireModelCallPermit(
  options: AcquireModelCallPermitOptions = {}
): Promise<
  | { ok: true; permit: ModelCallPermit }
  | { ok: false; reason: ModelCallGateFailureReason }
> {
  if (!persistentGovernorRequired()) {
    return acquireMemoryPermit(options.maxWaitMs, options.signal);
  }
  if (!isDatabaseConfigured()) {
    logGate("budget_store_unavailable", { phase: "configuration" });
    return { ok: false, reason: "budget_store_unavailable" };
  }
  return acquirePersistentPermit(
    options.maxWaitMs,
    Number.isFinite(options.deadlineEpochMs)
      ? Math.floor(Number(options.deadlineEpochMs))
      : Date.now() + MODEL_LEASE_MS,
    options.signal
  );
}

export function resetModelCallGovernorForTests() {
  if (process.env.NODE_ENV !== "test") return;
  activeCalls = 0;
  for (const entry of waitingCalls.splice(0)) {
    clearTimeout(entry.timer);
    if (entry.abort) entry.signal?.removeEventListener("abort", entry.abort);
    entry.resolve(false);
  }
  inMemoryDailyUsage.clear();
  for (const timer of persistentLeaseTimers.values()) clearInterval(timer);
  persistentLeaseTimers.clear();
  pendingReleases.clear();
}

export function modelCallGovernorSnapshotForTests() {
  if (process.env.NODE_ENV !== "test") return null;
  return { activeCalls, queuedCalls: waitingCalls.length };
}
