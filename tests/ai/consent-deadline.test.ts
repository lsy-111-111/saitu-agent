import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeDb = vi.hoisted(() => ({
  connect: vi.fn(),
  configured: vi.fn(() => true)
}));

vi.mock("@/lib/db/pool", () => ({
  getPool: () => ({ connect: fakeDb.connect }),
  isDatabaseConfigured: () => fakeDb.configured()
}));

import { recordAiConsent } from "@/lib/ai/consent";

const originalEnv = { ...process.env };

function request() {
  return new Request("https://example.test/api/ai/competition-recommend", {
    headers: { "X-Real-IP": "203.0.113.73" }
  });
}

beforeEach(() => {
  Reflect.set(process.env, "NODE_ENV", "test");
  process.env.AI_CONSENT_VERSION = "test.v1";
  fakeDb.connect.mockReset();
  fakeDb.configured.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("AI consent audit deadlines", () => {
  it("does not write after the caller aborts while waiting for a connection", async () => {
    let resolveConnection!: (client: {
      query: ReturnType<typeof vi.fn>;
      release: ReturnType<typeof vi.fn>;
    }) => void;
    const query = vi.fn();
    const release = vi.fn();
    fakeDb.connect.mockReturnValue(new Promise((resolve) => {
      resolveConnection = resolve;
    }));
    const caller = new AbortController();
    const recording = recordAiConsent(
      request(),
      "competition_recommend",
      { provider: "server", model: "policy.v1" },
      { deadlineEpochMs: Date.now() + 500, signal: caller.signal }
    );

    caller.abort();
    await recording;
    resolveConnection({ query, release });
    await Promise.resolve();
    await Promise.resolve();

    expect(query).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(true);
  });

  it("destroys the connection when an insert ignores the absolute deadline", async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("insert into ai_consents")) {
        return new Promise(() => undefined);
      }
      return { rowCount: null, rows: [] };
    });
    fakeDb.connect.mockResolvedValue({ query, release });
    const startedAt = Date.now();
    await recordAiConsent(
      request(),
      "competition_clarify",
      { provider: "deepseek", model: "deepseek-chat" },
      { deadlineEpochMs: Date.now() + 40 }
    );
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledWith(true);
    }, { timeout: 100 });

    expect(Date.now() - startedAt).toBeLessThan(150);
  });
});
