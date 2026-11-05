import { describe, expect, it, vi } from "vitest";

// @ts-expect-error The production cleanup entry point is intentionally plain Node ESM.
import { AI_CONSENT_RETENTION_DAYS, assertLocalCleanupDatabaseUrl, cleanupSecurityState, SECURITY_STATE_CLEANUP_OPERATIONS } from "../../scripts/cleanup-security-state.mjs";

const allowedTables = new Set([
  "ai_consents",
  "ai_model_call_leases",
  "ai_model_call_waiters",
  "competition_idempotency",
  "competition_rate_limit_counters",
  "competition_session_starts",
  "competition_session_transitions",
  "competition_sessions"
]);

type QueryResult = { rowCount?: number; rows?: Array<Record<string, unknown>> };
type QueryClient = { query: ReturnType<typeof vi.fn> };

function sqlText(value: unknown) {
  return String(value).replace(/\s+/gu, " ").trim().toLowerCase();
}

describe("scheduled security-state cleanup", () => {
  it.each([
    "postgresql://maintenance:secret@127.0.0.1:5432/resume_ai",
    "postgres://maintenance:secret@localhost/resume_ai",
    "postgresql://maintenance:secret@[::1]/resume_ai",
    "postgresql:///resume_ai?host=%2Fvar%2Frun%2Fpostgresql",
    "postgresql:///resume_ai?host=%2Frun%2Fpostgresql"
  ])("allows only a loopback endpoint or PostgreSQL system socket: %s", (url) => {
    expect(() => assertLocalCleanupDatabaseUrl(url)).not.toThrow();
  });

  it.each([
    "postgresql://maintenance:secret@database.example.com/resume_ai",
    "postgresql://maintenance:secret@10.1.2.3/resume_ai",
    "postgresql://maintenance:secret@127.0.0.1:5433/resume_ai",
    "postgresql://maintenance:secret@127.0.0.1:5432/resume_ai?sslmode=disable",
    "postgresql://maintenance:secret@localhost/resume_ai?options=-c%20role%3Dpostgres",
    "postgresql://maintenance:secret@localhost/resume_ai#unexpected",
    "postgresql:///resume_ai",
    "postgresql:///resume_ai?host=%2Ftmp",
    "postgresql:///resume_ai?host=%2Fvar%2Frun%2Fpostgresql&host=%2Frun%2Fpostgresql",
    "postgresql:///resume_ai?host=%2Fvar%2Frun%2Fpostgresql&connect_timeout=5",
    "postgresql://127.0.0.1/resume_ai?host=%2Fvar%2Frun%2Fpostgresql",
    "postgresql://127.0.0.1/",
    "postgresql://127.0.0.1/resume_ai/extra",
    "postgresql://127.0.0.1/resume%ZZai",
    "https://127.0.0.1/resume_ai",
    "not-a-url"
  ])("rejects a non-local or invalid cleanup database URL: %s", (url) => {
    expect(() => assertLocalCleanupDatabaseUrl(url)).toThrow(/DATABASE_URL/u);
  });

  it("uses a closed table allowlist and expiry-only predicates", () => {
    expect(SECURITY_STATE_CLEANUP_OPERATIONS.map(({ name }: { name: string }) => name).sort())
      .toEqual([...allowedTables].sort());

    for (const operation of SECURITY_STATE_CLEANUP_OPERATIONS as Array<{
      name: string;
      sql: string;
      parameters?: number[];
    }>) {
      const normalized = sqlText(operation.sql);
      const deleteTargets = [...normalized.matchAll(/delete from ([a-z_]+)/gu)]
        .map((match) => match[1]);
      expect(deleteTargets).toEqual([operation.name]);
      expect(allowedTables.has(operation.name)).toBe(true);
      expect(normalized).toContain("limit $1");
      expect(normalized).toMatch(/where (?:expires_at|reset_at|created_at) <=/u);
      expect(normalized).not.toContain("truncate");
      expect(normalized).not.toContain("drop ");
    }

    const consent = SECURITY_STATE_CLEANUP_OPERATIONS.find(
      ({ name }: { name: string }) => name === "ai_consents"
    );
    expect(consent?.parameters).toEqual([180]);
    expect(AI_CONSENT_RETENTION_DAYS).toBe(180);
  });

  it("deletes every expired batch without needing an application request", async () => {
    const deleteCalls = new Map<string, number>();
    const client: QueryClient = {
      query: vi.fn(async (sql: unknown, parameters?: unknown[]): Promise<QueryResult> => {
        const normalized = sqlText(sql);
        if (normalized.startsWith("select pg_try_advisory_lock")) {
          return { rows: [{ acquired: true }] };
        }
        if (normalized.startsWith("select pg_advisory_unlock")) return { rows: [] };
        if (normalized.includes("delete from ")) {
          const table = normalized.match(/delete from ([a-z_]+)/u)?.[1] ?? "unknown";
          const count = deleteCalls.get(table) ?? 0;
          deleteCalls.set(table, count + 1);
          if (table === "competition_idempotency") {
            return { rowCount: count === 0 ? 2 : 1, rows: [] };
          }
          if (table === "ai_consents") expect(parameters).toEqual([2, 180]);
          return { rowCount: 0, rows: [] };
        }
        return { rows: [] };
      })
    };

    await expect(cleanupSecurityState(client, { batchSize: 2 })).resolves.toMatchObject({
      status: "ok",
      deleted: {
        competition_idempotency: 3,
        ai_consents: 0,
        ai_model_call_leases: 0,
        ai_model_call_waiters: 0
      }
    });
    expect(deleteCalls.get("competition_idempotency")).toBe(2);
    expect(client.query).toHaveBeenCalledWith(
      "select pg_advisory_unlock($1::bigint)",
      ["724310896145222"]
    );
  });

  it("does not delete when another scheduled cleanup owns the lock", async () => {
    const client: QueryClient = {
      query: vi.fn(async (): Promise<QueryResult> => ({ rows: [{ acquired: false }] }))
    };

    await expect(cleanupSecurityState(client)).resolves.toEqual({
      status: "already_running",
      deleted: {}
    });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("rolls back a failed batch and releases the scheduler lock", async () => {
    const statements: string[] = [];
    const client: QueryClient = {
      query: vi.fn(async (sql: unknown): Promise<QueryResult> => {
        const normalized = sqlText(sql);
        statements.push(normalized);
        if (normalized.startsWith("select pg_try_advisory_lock")) {
          return { rows: [{ acquired: true }] };
        }
        if (normalized.includes("delete from competition_idempotency")) {
          throw new Error("fixture database failure");
        }
        return { rows: [] };
      })
    };

    await expect(cleanupSecurityState(client)).rejects.toThrow("fixture database failure");
    expect(statements).toContain("rollback");
    expect(statements.at(-1)).toBe("select pg_advisory_unlock($1::bigint)");
  });

  it("rejects unsafe batch sizes before opening a cleanup lock", async () => {
    const client: QueryClient = { query: vi.fn() };
    await expect(cleanupSecurityState(client, { batchSize: 0 })).rejects.toThrow(
      "Cleanup batch size"
    );
    await expect(cleanupSecurityState(client, { batchSize: 5_001 })).rejects.toThrow(
      "Cleanup batch size"
    );
    expect(client.query).not.toHaveBeenCalled();
  });
});
