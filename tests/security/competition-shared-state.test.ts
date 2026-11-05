import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeDb = vi.hoisted(() => {
  const state: {
    handler: (sql: string, params: unknown[]) => Promise<unknown>;
    released: number;
  } = {
    handler: async () => ({ rowCount: 0, rows: [] }),
    released: 0
  };
  const client = {
    query: (sql: string, params: unknown[] = []) => state.handler(sql, params),
    release: () => { state.released += 1; }
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn((sql: string, params: unknown[] = []) => state.handler(sql, params))
  };
  return {
    state,
    pool,
    configured: vi.fn(() => Boolean(process.env.DATABASE_URL?.trim()))
  };
});

vi.mock("@/lib/db/pool", () => ({
  getPool: () => fakeDb.pool,
  isDatabaseConfigured: () => fakeDb.configured()
}));

const originalEnv = { ...process.env };

function request(requestId: string) {
  return new Request("https://example.test/api/competitions/recommend/normalize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "shared-start-key-0001",
      "X-Real-IP": "203.0.113.92",
      "X-Request-ID": requestId
    },
    body: "{}"
  });
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://fixture.invalid/resume_ai";
  process.env.AI_CONVERSATION_SIGNING_SECRET =
    "fixture-signing-secret-with-more-than-thirty-two-characters";
  fakeDb.state.released = 0;
  fakeDb.pool.connect.mockClear();
  fakeDb.pool.query.mockClear();
  fakeDb.configured.mockClear();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  process.env = { ...originalEnv };
});

describe("PostgreSQL competition security state", () => {
  it("fails closed before producer execution when the shared store is unavailable", async () => {
    fakeDb.pool.connect.mockRejectedValueOnce(new Error("synthetic database outage"));
    const producer = vi.fn(async () => Response.json({ ok: true }));
    const { competitionTransitionId, executeCompetitionSessionStart } =
      await import("@/lib/security/rate-limit");
    const response = await executeCompetitionSessionStart({
      request: request("shared-outage-0001"),
      requestId: "shared-outage-0001",
      operation: "competition_normalize",
      transitionId: competitionTransitionId("competition_normalize", { answer: 1 }),
      producer
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ error: "SECURITY_STATE_UNAVAILABLE" });
    expect(producer).not.toHaveBeenCalled();
  });

  it("returns before the application deadline when a state-store commit never settles", async () => {
    fakeDb.state.handler = async (rawSql) => {
      const sql = rawSql.replace(/\s+/g, " ").trim().toLowerCase();
      if (sql === "commit") return new Promise(() => undefined);
      if (sql === "begin" || sql === "rollback") return { rowCount: null, rows: [] };
      if (sql.startsWith("select set_config('statement_timeout'")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.startsWith("select public.resume_ai_runtime_prune_competition_state") ||
          sql.startsWith("select public.resume_ai_runtime_delete_expired_session_start")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.startsWith("insert into competition_session_starts")) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("insert into competition_rate_limit_counters")) {
        return { rowCount: 1, rows: [{ reset_at: new Date(Date.now() + 60_000) }] };
      }
      if (sql.startsWith("insert into competition_idempotency")) {
        return { rowCount: 1, rows: [{ generation: 1 }] };
      }
      throw new Error(`Unexpected SQL in hanging-commit fixture: ${sql}`);
    };
    const producer = vi.fn(async () => Response.json({ ok: true }));
    const rateLimiter = await import("@/lib/security/rate-limit");
    const startedAtEpochMs = Date.now();
    const execution = rateLimiter.executeCompetitionSessionStart({
      request: request("shared-hanging-commit-0001"),
      requestId: "shared-hanging-commit-0001",
      operation: "competition_normalize",
      transitionId: rateLimiter.competitionTransitionId(
        "competition_normalize",
        { hangingCommit: true }
      ),
      deadlines: {
        startedAtEpochMs,
        aiDeadlineEpochMs: startedAtEpochMs + 20,
        producerDeadlineEpochMs: startedAtEpochMs + 40,
        finalizeDeadlineEpochMs: startedAtEpochMs + 70,
        duplicateWaitDeadlineEpochMs: startedAtEpochMs + 90,
        responseDeadlineEpochMs: startedAtEpochMs + 120
      },
      producer
    });
    const outcome = await Promise.race([
      execution.then((response) => ({ response })),
      new Promise<{ response: null }>((resolve) => {
        setTimeout(() => resolve({ response: null }), 180);
      })
    ]);

    expect(outcome.response).not.toBeNull();
    expect(outcome.response?.status).toBe(503);
    expect(producer).not.toHaveBeenCalled();
  });

  it("replays encrypted state after a fresh module instance without consuming quota twice", async () => {
    type Stored = {
      state: "pending" | "completed" | "retryable";
      owner: string | null;
      generation: number;
      producerRetries: number;
      retryKind: "no_store" | "failure" | null;
      expiresAt: Date;
      ciphertext: Buffer | null;
      iv: Buffer | null;
      tag: Buffer | null;
      bytes: number | null;
    };
    const starts = new Set<string>();
    let stored: Stored | null = null;
    let counterReservations = 0;
    let storedStartKey = "";

    fakeDb.state.handler = async (rawSql, params) => {
      const sql = rawSql.replace(/\s+/g, " ").trim().toLowerCase();
      if (sql === "begin" || sql === "commit" || sql === "rollback") {
        return { rowCount: null, rows: [] };
      }
      if (sql.startsWith("select set_config('statement_timeout'")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.startsWith("select public.resume_ai_runtime_prune_competition_state")) {
        return { rowCount: 1, rows: [{ resume_ai_runtime_prune_competition_state: 0 }] };
      }
      if (sql.startsWith("select public.resume_ai_runtime_delete_expired_session_start")) {
        return { rowCount: 1, rows: [{ resume_ai_runtime_delete_expired_session_start: false }] };
      }
      if (sql.startsWith("insert into competition_session_starts")) {
        const key = String(params[0]);
        storedStartKey = key;
        if (starts.has(key)) return { rowCount: 0, rows: [] };
        starts.add(key);
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("insert into competition_rate_limit_counters")) {
        counterReservations += 1;
        return { rowCount: 1, rows: [{ reset_at: new Date(Date.now() + 60_000) }] };
      }
      if (sql.startsWith("insert into competition_idempotency")) {
        if (stored) return { rowCount: 0, rows: [] };
        stored = {
          state: "pending",
          owner: String(params[1]),
          generation: 1,
          producerRetries: 0,
          retryKind: null,
          expiresAt: params[2] as Date,
          ciphertext: null,
          iv: null,
          tag: null,
          bytes: null
        };
        return { rowCount: 1, rows: [{ generation: 1 }] };
      }
      if (sql.startsWith("select state, generation") && sql.includes("for update")) {
        if (!stored) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [{
            state: stored.state,
            generation: stored.generation,
            producer_retries: stored.producerRetries,
            retry_kind: stored.retryKind,
            expires_at: stored.expiresAt,
            lease_active: false,
            response_ciphertext: stored.ciphertext,
            response_iv: stored.iv,
            response_tag: stored.tag,
            response_bytes: stored.bytes
          }]
        };
      }
      if (sql.startsWith("update competition_idempotency set expires_at = least")) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("update competition_idempotency") && sql.includes("set state = $3")) {
        if (!stored || stored.owner !== String(params[1])) return { rowCount: 0, rows: [] };
        stored.state = String(params[2]) as Stored["state"];
        stored.owner = null;
        stored.retryKind = params[3] as Stored["retryKind"];
        stored.ciphertext = params[4] as Buffer;
        stored.iv = params[5] as Buffer;
        stored.tag = params[6] as Buffer;
        stored.bytes = Number(params[7]);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected SQL in shared-state fixture: ${sql}`);
    };

    const sensitiveToken = "signed-token-that-must-never-appear-in-postgres-plaintext";
    const firstProducer = vi.fn(async () => Response.json({ ok: true, token: sensitiveToken }));
    const firstModule = await import("@/lib/security/rate-limit");
    const transitionId = firstModule.competitionTransitionId(
      "competition_normalize",
      { answer: "same" }
    );
    const first = await firstModule.executeCompetitionSessionStart({
      request: request("shared-first-0001"),
      requestId: "shared-first-0001",
      operation: "competition_normalize",
      transitionId,
      producer: firstProducer
    });
    expect(first.status).toBe(200);
    expect(firstProducer).toHaveBeenCalledTimes(1);
    expect(counterReservations).toBe(2);
    expect(storedStartKey).toMatch(/^[0-9a-f]{64}$/);
    expect(storedStartKey).not.toContain("203.0.113.92");
    expect(stored).not.toBeNull();
    expect(stored!.iv).toHaveLength(12);
    expect(stored!.tag).toHaveLength(16);
    expect(stored!.ciphertext!.includes(Buffer.from(sensitiveToken))).toBe(false);

    vi.resetModules();
    const secondProducer = vi.fn(async () => Response.json({ ok: true, token: "wrong" }));
    const secondModule = await import("@/lib/security/rate-limit");
    const replay = await secondModule.executeCompetitionSessionStart({
      request: request("shared-second-0002"),
      requestId: "shared-second-0002",
      operation: "competition_normalize",
      transitionId,
      producer: secondProducer
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("X-Idempotent-Replay")).toBe("true");
    expect(replay.headers.get("X-Request-ID")).toBe("shared-second-0002");
    expect(await replay.json()).toEqual({ ok: true, token: sensitiveToken });
    expect(secondProducer).not.toHaveBeenCalled();
    expect(counterReservations).toBe(2);
  });

  it("enforces initial plus two uncached producer attempts in shared state", async () => {
    const starts = new Set<string>();
    let row: {
      state: "pending" | "retryable";
      owner: string | null;
      generation: number;
      retries: number;
      retryKind: "no_store" | "failure" | null;
      expiresAt: Date;
      ciphertext: Buffer | null;
      iv: Buffer | null;
      tag: Buffer | null;
      bytes: number | null;
    } | null = null;
    let counterReservations = 0;

    fakeDb.state.handler = async (rawSql, params) => {
      const sql = rawSql.replace(/\s+/g, " ").trim().toLowerCase();
      if (sql === "begin" || sql === "commit" || sql === "rollback") {
        return { rowCount: null, rows: [] };
      }
      if (sql.startsWith("select set_config('statement_timeout'")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.startsWith("select public.resume_ai_runtime_prune_competition_state")) {
        return { rowCount: 1, rows: [{ resume_ai_runtime_prune_competition_state: 0 }] };
      }
      if (sql.startsWith("select public.resume_ai_runtime_delete_expired_session_start")) {
        return { rowCount: 1, rows: [{ resume_ai_runtime_delete_expired_session_start: false }] };
      }
      if (sql.startsWith("insert into competition_session_starts")) {
        const key = String(params[0]);
        if (starts.has(key)) return { rowCount: 0, rows: [] };
        starts.add(key);
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("insert into competition_rate_limit_counters")) {
        counterReservations += 1;
        return { rowCount: 1, rows: [{ reset_at: new Date(Date.now() + 60_000) }] };
      }
      if (sql.startsWith("insert into competition_idempotency")) {
        if (row) return { rowCount: 0, rows: [] };
        row = {
          state: "pending",
          owner: String(params[1]),
          generation: 1,
          retries: 0,
          retryKind: null,
          expiresAt: params[2] as Date,
          ciphertext: null,
          iv: null,
          tag: null,
          bytes: null
        };
        return { rowCount: 1, rows: [{ generation: 1 }] };
      }
      if (sql.startsWith("select state, generation") && sql.includes("for update")) {
        if (!row) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [{
            state: row.state,
            generation: row.generation,
            producer_retries: row.retries,
            retry_kind: row.retryKind,
            expires_at: row.expiresAt,
            lease_active: false,
            response_ciphertext: row.ciphertext,
            response_iv: row.iv,
            response_tag: row.tag,
            response_bytes: row.bytes
          }]
        };
      }
      if (sql.startsWith("update competition_idempotency set expires_at = least")) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("update competition_idempotency") &&
          sql.includes("generation = generation + 1")) {
        if (!row) return { rowCount: 0, rows: [] };
        row.state = "pending";
        row.owner = String(params[1]);
        row.generation += 1;
        row.retries = Number(params[2]);
        row.retryKind = null;
        row.ciphertext = null;
        row.iv = null;
        row.tag = null;
        row.bytes = null;
        return { rowCount: 1, rows: [{ generation: row.generation }] };
      }
      if (sql.startsWith("update competition_idempotency") && sql.includes("set state = $3")) {
        if (!row || row.owner !== String(params[1])) return { rowCount: 0, rows: [] };
        row.state = "retryable";
        row.owner = null;
        row.retryKind = params[3] as "no_store";
        row.ciphertext = params[4] as Buffer;
        row.iv = params[5] as Buffer;
        row.tag = params[6] as Buffer;
        row.bytes = Number(params[7]);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected SQL in retry fixture: ${sql}`);
    };

    const producer = vi.fn(async () => {
      const response = Response.json({ ok: true, fallbackReason: "capacity_exhausted" });
      response.headers.set("X-Idempotency-Cache", "no-store");
      return response;
    });
    const rateLimiter = await import("@/lib/security/rate-limit");
    const transitionId = rateLimiter.competitionTransitionId("competition_normalize", { same: true });
    for (let index = 0; index < 3; index += 1) {
      expect((await rateLimiter.executeCompetitionSessionStart({
        request: request(`shared-retry-000${index}`),
        requestId: `shared-retry-000${index}`,
        operation: "competition_normalize",
        transitionId,
        producer
      })).status).toBe(200);
    }
    const exhausted = await rateLimiter.executeCompetitionSessionStart({
      request: request("shared-retry-0003"),
      requestId: "shared-retry-0003",
      operation: "competition_normalize",
      transitionId,
      producer
    });
    expect(exhausted.status).toBe(429);
    expect(await exhausted.json()).toMatchObject({ bucket: "transition_retries" });
    expect(producer).toHaveBeenCalledTimes(3);
    expect(row!.retries).toBe(2);
    expect(counterReservations).toBe(2);
  });
});
