import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolConstructor = vi.hoisted(() => vi.fn());

vi.mock("pg", () => ({
  Pool: class {
    constructor(options: unknown) {
      poolConstructor(options);
    }
  }
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  poolConstructor.mockClear();
  Reflect.deleteProperty(globalThis, "__pgPool");
  vi.resetModules();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "__pgPool");
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("PostgreSQL connection confinement", () => {
  it.each([
    "postgresql://resume_ai:secret@127.0.0.1:5432/resume_ai",
    "postgres://resume_ai:secret@localhost/resume_ai",
    "postgresql://resume_ai:secret@[::1]/resume_ai",
    "postgresql:///resume_ai?host=%2Fvar%2Frun%2Fpostgresql",
    "postgresql:///resume_ai?host=%2Frun%2Fpostgresql"
  ])("allows only an explicit loopback endpoint or PostgreSQL system socket: %s", async (url) => {
    process.env.DATABASE_URL = url;
    const { getPool } = await import("@/lib/db/pool");

    getPool();

    expect(poolConstructor).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: url,
      ssl: false,
      application_name: "resume-ai",
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
      lock_timeout: 5_000,
      idle_in_transaction_session_timeout: 15_000,
      query_timeout: 12_000
    }));
  });

  it.each([
    "postgresql://resume_ai:secret@database.example.com/resume_ai",
    "postgresql://resume_ai:secret@10.1.2.3/resume_ai",
    "postgresql://resume_ai:secret@127.0.0.1:5433/resume_ai",
    "postgresql://resume_ai:secret@127.0.0.1:5432/resume_ai?sslmode=disable",
    "postgresql://resume_ai:secret@localhost/resume_ai?options=-c%20role%3Dpostgres",
    "postgresql://resume_ai:secret@localhost/resume_ai#unexpected",
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
  ])("fails closed before constructing a non-local or invalid connection: %s", async (url) => {
    process.env.DATABASE_URL = url;
    const { getPool } = await import("@/lib/db/pool");

    expect(() => getPool()).toThrow(/DATABASE_URL/);
    expect(poolConstructor).not.toHaveBeenCalled();
  });
});
