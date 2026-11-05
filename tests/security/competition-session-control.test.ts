import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  competitionTransitionId,
  executeCompetitionSessionStart,
  executeCompetitionSessionTransition,
  rateLimitStateSnapshotForTests,
  resetRateLimitStateForTests
} from "@/lib/security/rate-limit";

const originalEnv = { ...process.env };

function request(
  idempotencyKey: string,
  ip = "203.0.113.40",
  signal?: AbortSignal
) {
  return new Request("https://example.test/api/competitions/recommend/normalize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Real-IP": ip
    },
    body: "{}",
    signal
  });
}

beforeEach(() => {
  resetRateLimitStateForTests();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("competition session-aware request control", () => {
  it("uses ephemeral state in a production build only for the fully isolated E2E runtime", async () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.DATABASE_URL = "";
    process.env.E2E_ALLOW_EPHEMERAL_SECURITY_STATE = "1";
    process.env.AI_PROVIDER = "mock";
    process.env.AI_TEST_MODE = "1";
    process.env.ALLOW_AI_MOCK = "1";
    process.env.NEXT_PUBLIC_AI_TEST_MODE = "1";
    process.env.AI_CONVERSATION_SIGNING_SECRET =
      "production-e2e-signing-secret-with-more-than-thirty-two-characters";

    const acceptedProducer = vi.fn(async () => Response.json({ ok: true }));
    const accepted = await executeCompetitionSessionStart({
      request: request("production-e2e-start-0001"),
      requestId: "production-e2e-request-0001",
      operation: "competition_normalize",
      transitionId: competitionTransitionId("competition_normalize", { index: 1 }),
      producer: acceptedProducer
    });
    expect(accepted.status).toBe(200);
    expect(acceptedProducer).toHaveBeenCalledTimes(1);

    process.env.NEXT_PUBLIC_AI_TEST_MODE = "0";
    const rejectedProducer = vi.fn(async () => Response.json({ ok: true }));
    const rejected = await executeCompetitionSessionStart({
      request: request("production-e2e-start-0002"),
      requestId: "production-e2e-request-0002",
      operation: "competition_normalize",
      transitionId: competitionTransitionId("competition_normalize", { index: 2 }),
      producer: rejectedProducer
    });
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toMatchObject({ error: "SECURITY_STATE_UNAVAILABLE" });
    expect(rejectedProducer).not.toHaveBeenCalled();
  });

  it("deduplicates identical session starts without running the producer twice", async () => {
    const producer = vi.fn(async () => Response.json({ ok: true, token: "signed" }));
    const onOwnerCommitted = vi.fn(async () => undefined);
    const input = {
      request: request("normalize-request-0001"),
      operation: "competition_normalize",
      transitionId: competitionTransitionId("competition_normalize", { answers: [1] }),
      producer,
      onOwnerCommitted
    };

    const first = await executeCompetitionSessionStart({ ...input, requestId: "request-id-0001" });
    const replay = await executeCompetitionSessionStart({ ...input, requestId: "request-id-0002" });

    expect(producer).toHaveBeenCalledTimes(1);
    expect(await first.json()).toEqual({ ok: true, token: "signed" });
    expect(await replay.json()).toEqual({ ok: true, token: "signed" });
    expect(replay.headers.get("X-Idempotent-Replay")).toBe("true");
    expect(replay.headers.get("X-Request-ID")).toBe("request-id-0002");
    expect(onOwnerCommitted).toHaveBeenCalledTimes(1);
    expect(onOwnerCommitted).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "request-id-0001",
      status: 200,
      signal: expect.any(AbortSignal)
    }));
  });

  it("stops reading an oversized chunked response before idempotency encryption", async () => {
    let pulls = 0;
    const onOwnerCommitted = vi.fn(async () => undefined);
    const producer = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(256 * 1024));
      }
    }), { headers: { "Content-Type": "application/octet-stream" } }));

    const response = await executeCompetitionSessionStart({
      request: request("oversized-response-0001"),
      requestId: "oversized-response-request-0001",
      operation: "competition_normalize",
      transitionId: competitionTransitionId("competition_normalize", { oversized: true }),
      producer,
      onOwnerCommitted
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "SECURITY_STATE_UNAVAILABLE" });
    expect(producer).toHaveBeenCalledTimes(1);
    expect(onOwnerCommitted).not.toHaveBeenCalled();
    expect(pulls).toBeLessThanOrEqual(4);
  });

  it("allows only two producer retries for a no-store fallback", async () => {
    const producer = vi.fn(async () => {
      const response = Response.json({ ok: true, fallbackReason: "capacity_exhausted" });
      response.headers.set("X-Idempotency-Cache", "no-store");
      return response;
    });
    const input = {
      request: request("normalize-transient-0001"),
      operation: "competition_normalize",
      transitionId: competitionTransitionId("competition_normalize", { answers: ["text"] }),
      producer,
      onOwnerCommitted: vi.fn(async () => undefined)
    };

    expect((await executeCompetitionSessionStart({ ...input, requestId: "transient-request-1" })).status).toBe(200);
    expect((await executeCompetitionSessionStart({ ...input, requestId: "transient-request-2" })).status).toBe(200);
    expect((await executeCompetitionSessionStart({ ...input, requestId: "transient-request-3" })).status).toBe(200);
    const exhausted = await executeCompetitionSessionStart({ ...input, requestId: "transient-request-4" });
    expect(exhausted.status).toBe(429);
    expect(await exhausted.json()).toMatchObject({ bucket: "transition_retries" });
    expect(producer).toHaveBeenCalledTimes(3);
    expect(input.onOwnerCommitted).not.toHaveBeenCalled();
  });

  it("caps repeated non-ok and thrown producer attempts for one logical transition", async () => {
    const sessionId = "15798217-4acf-432d-a304-5d878f184a7b";
    const transitionId = competitionTransitionId("competition_clarify", { answer: "stable" });
    const failedProducer = vi.fn(async () => Response.json({ ok: false }, { status: 503 }));
    for (let index = 0; index < 3; index += 1) {
      const response = await executeCompetitionSessionTransition({
        request: request(`failed-retry-${index}`),
        requestId: `failed-retry-request-${index}`,
        operation: "competition_clarify",
        sessionId,
        transitionId,
        producer: failedProducer
      });
      expect(response.status).toBe(503);
    }
    const exhausted = await executeCompetitionSessionTransition({
      request: request("failed-retry-3"),
      requestId: "failed-retry-request-3",
      operation: "competition_clarify",
      sessionId,
      transitionId,
      producer: failedProducer
    });
    expect(exhausted.status).toBe(429);
    expect(await exhausted.json()).toMatchObject({ bucket: "transition_retries" });
    expect(failedProducer).toHaveBeenCalledTimes(3);

    const thrownTransition = competitionTransitionId("competition_clarify", { answer: "throws" });
    const thrownProducer = vi.fn(async (): Promise<Response> => { throw new Error("synthetic"); });
    for (let index = 0; index < 3; index += 1) {
      await expect(executeCompetitionSessionTransition({
        request: request(`thrown-retry-${index}`),
        requestId: `thrown-retry-request-${index}`,
        operation: "competition_clarify",
        sessionId,
        transitionId: thrownTransition,
        producer: thrownProducer
      })).rejects.toThrow("synthetic");
    }
    const thrownExhausted = await executeCompetitionSessionTransition({
      request: request("thrown-retry-3"),
      requestId: "thrown-retry-request-3",
      operation: "competition_clarify",
      sessionId,
      transitionId: thrownTransition,
      producer: thrownProducer
    });
    expect(thrownExhausted.status).toBe(429);
    expect(thrownProducer).toHaveBeenCalledTimes(3);
  });

  it("allows fifty independent sessions behind one campus NAT", async () => {
    const responses = await Promise.all(Array.from({ length: 50 }, (_, index) =>
      executeCompetitionSessionStart({
        request: request(`campus-session-${String(index).padStart(4, "0")}`),
        requestId: `campus-request-${String(index).padStart(4, "0")}`,
        operation: "competition_normalize",
        transitionId: competitionTransitionId("competition_normalize", { index }),
        producer: async () => Response.json({ ok: true })
      })
    ));
    expect(responses).toHaveLength(50);
    expect(responses.every(({ status }) => status === 200)).toBe(true);
  });

  it("limits only the sixty-first unique session start in one minute", async () => {
    for (let index = 0; index < 60; index += 1) {
      const response = await executeCompetitionSessionStart({
        request: request(`threshold-session-${String(index).padStart(4, "0")}`),
        requestId: `threshold-request-${String(index).padStart(4, "0")}`,
        operation: "competition_normalize",
        transitionId: competitionTransitionId("competition_normalize", { index }),
        producer: async () => Response.json({ ok: true })
      });
      expect(response.status).toBe(200);
    }

    const limited = await executeCompetitionSessionStart({
      request: request("threshold-session-0060"),
      requestId: "threshold-request-0060",
      operation: "competition_normalize",
      transitionId: competitionTransitionId("competition_normalize", { index: 60 }),
      producer: async () => Response.json({ ok: true })
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      ok: false,
      error: "RATE_LIMITED",
      source: "application",
      bucket: "session_start_minute",
      requestId: "threshold-request-0060"
    });
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(limited.headers.get("X-RateLimit-Source")).toBe("application");
    const finalOutcome = vi.mocked(console.info).mock.calls
      .flat()
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => JSON.parse(entry) as Record<string, unknown>)
      .find((entry) => entry.event === "competition_api_request" &&
        entry.requestId === "threshold-request-0060");
    expect(finalOutcome).toMatchObject({
      stage: "competition_normalize",
      statusCode: 429,
      bucket: "session_start",
      source: "application",
      idempotentReplay: false
    });
  });

  it("permits twelve unique transitions, replays for free, then rejects the thirteenth", async () => {
    const sessionId = "7f8e15dd-76cb-4f75-8bf8-3196582a0b84";
    const responses: Response[] = [];
    for (let index = 0; index < 12; index += 1) {
      responses.push(await executeCompetitionSessionTransition({
        request: request(`transition-${String(index).padStart(4, "0")}`),
        requestId: `transition-request-${String(index).padStart(4, "0")}`,
        operation: "competition_clarify",
        sessionId,
        transitionId: competitionTransitionId("competition_clarify", { index }),
        producer: async () => Response.json({ ok: true, index })
      }));
    }
    expect(responses.every(({ status }) => status === 200)).toBe(true);

    const replayProducer = vi.fn(async () => Response.json({ ok: true, index: 0 }));
    const replay = await executeCompetitionSessionTransition({
      request: request("transition-replay-0000"),
      requestId: "transition-replay-request",
      operation: "competition_clarify",
      sessionId,
      transitionId: competitionTransitionId("competition_clarify", { index: 0 }),
      producer: replayProducer
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("X-Idempotent-Replay")).toBe("true");
    expect(replayProducer).not.toHaveBeenCalled();

    const limited = await executeCompetitionSessionTransition({
      request: request("transition-0012"),
      requestId: "transition-request-0012",
      operation: "competition_recommend",
      sessionId,
      transitionId: competitionTransitionId("competition_recommend", { index: 12 }),
      producer: async () => Response.json({ ok: true })
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ bucket: "session_transitions" });
  });

  it("reserves in-flight unique transitions so concurrency cannot exceed twelve", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const sessionId = "1e194d50-45bf-4c5b-b981-eb25b5d1d609";
    const active = Array.from({ length: 12 }, (_, index) =>
      executeCompetitionSessionTransition({
        request: request(`parallel-transition-${String(index).padStart(4, "0")}`),
        requestId: `parallel-request-${String(index).padStart(4, "0")}`,
        operation: "competition_clarify",
        sessionId,
        transitionId: competitionTransitionId("competition_clarify", { parallel: index }),
        producer: async () => {
          await pending;
          return Response.json({ ok: true, index });
        }
      })
    );
    const limited = await executeCompetitionSessionTransition({
      request: request("parallel-transition-0012"),
      requestId: "parallel-request-0012",
      operation: "competition_clarify",
      sessionId,
      transitionId: competitionTransitionId("competition_clarify", { parallel: 12 }),
      producer: async () => Response.json({ ok: true })
    });
    expect(limited.status).toBe(429);
    finish();
    expect((await Promise.all(active)).every(({ status }) => status === 200)).toBe(true);
  });

  it("shares one in-flight result and does not commit failed transitions", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const producer = vi.fn(async () => {
      await pending;
      return Response.json({ ok: true });
    });
    const common = {
      request: request("in-flight-transition"),
      operation: "competition_clarify",
      sessionId: "31db6810-aa32-4ab0-9fe0-97ba04dbf7fc",
      transitionId: competitionTransitionId("competition_clarify", { answer: "same" }),
      producer
    };
    const first = executeCompetitionSessionTransition({ ...common, requestId: "in-flight-request-1" });
    const second = executeCompetitionSessionTransition({ ...common, requestId: "in-flight-request-2" });
    finish();
    expect((await first).status).toBe(200);
    expect((await second).headers.get("X-Idempotent-Replay")).toBe("true");
    expect(producer).toHaveBeenCalledTimes(1);

    for (let index = 0; index < 20; index += 1) {
      const failed = await executeCompetitionSessionTransition({
        request: request(`failed-transition-${String(index).padStart(4, "0")}`),
        requestId: `failed-request-${String(index).padStart(4, "0")}`,
        operation: "competition_clarify",
        sessionId: "f52fa531-1468-42ec-9f9e-1bbb0d672cc8",
        transitionId: competitionTransitionId("competition_clarify", { failed: index }),
        producer: async () => Response.json({ ok: false }, { status: 503 })
      });
      expect(failed.status).toBe(503);
    }
    const stillAllowed = await executeCompetitionSessionTransition({
      request: request("success-after-failures"),
      requestId: "success-after-failures",
      operation: "competition_clarify",
      sessionId: "f52fa531-1468-42ec-9f9e-1bbb0d672cc8",
      transitionId: competitionTransitionId("competition_clarify", { success: true }),
      producer: async () => Response.json({ ok: true })
    });
    expect(stillAllowed.status).toBe(200);
  });

  it("releases an aborted duplicate waiter without cancelling its owner", async () => {
    let announceStarted!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => { announceStarted = resolve; });
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const producer = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      announceStarted();
      await pending;
      expect(signal.aborted).toBe(false);
      return Response.json({ ok: true });
    });
    const sessionId = "41db6810-aa32-4ab0-9fe0-97ba04dbf7fc";
    const transitionId = competitionTransitionId("competition_clarify", { answer: "same" });
    const owner = executeCompetitionSessionTransition({
      request: request("aborted-waiter-owner"),
      requestId: "aborted-waiter-owner-request",
      operation: "competition_clarify",
      sessionId,
      transitionId,
      producer
    });
    await started;

    const caller = new AbortController();
    const duplicate = executeCompetitionSessionTransition({
      request: request("aborted-waiter-owner", "203.0.113.40", caller.signal),
      requestId: "aborted-waiter-duplicate-request",
      operation: "competition_clarify",
      sessionId,
      transitionId,
      producer
    });
    caller.abort();

    const duplicateResult = await Promise.race([
      duplicate.then((response) => ({ response })),
      new Promise<{ response: null }>((resolve) => {
        setTimeout(() => resolve({ response: null }), 250);
      })
    ]);
    expect(duplicateResult.response).not.toBeNull();
    expect(duplicateResult.response?.status).toBe(503);
    expect(producer).toHaveBeenCalledTimes(1);

    finish();
    expect((await owner).status).toBe(200);
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it("enforces the producer deadline when a producer ignores its abort signal", async () => {
    const startedAtEpochMs = Date.now();
    const deadlines = {
      startedAtEpochMs,
      aiDeadlineEpochMs: startedAtEpochMs + 20,
      producerDeadlineEpochMs: startedAtEpochMs + 40,
      finalizeDeadlineEpochMs: startedAtEpochMs + 70,
      duplicateWaitDeadlineEpochMs: startedAtEpochMs + 90,
      responseDeadlineEpochMs: startedAtEpochMs + 120
    };
    const producer = vi.fn(async () => new Promise<Response>(() => {
      // Deliberately ignores the supplied AbortSignal.
    }));
    const execution = executeCompetitionSessionStart({
      request: request("hard-producer-deadline-0001"),
      requestId: "hard-producer-deadline-request-0001",
      operation: "competition_normalize",
      transitionId: competitionTransitionId("competition_normalize", { hanging: true }),
      deadlines,
      producer
    });

    const outcome = await Promise.race([
      execution.then((response) => ({ response })),
      new Promise<{ response: null }>((resolve) => {
        setTimeout(() => resolve({ response: null }), 200);
      })
    ]);
    expect(outcome.response).not.toBeNull();
    expect(outcome.response?.status).toBe(503);
    expect(producer).toHaveBeenCalledTimes(1);
    expect(rateLimitStateSnapshotForTests()).toMatchObject({ inFlight: 0 });
  });

  it("isolates identical transition hashes across signed sessions", async () => {
    const transitionId = competitionTransitionId("competition_clarify", { answer: "same" });
    const firstProducer = vi.fn(async () => Response.json({ ok: true, session: "first" }));
    const secondProducer = vi.fn(async () => Response.json({ ok: true, session: "second" }));

    const first = await executeCompetitionSessionTransition({
      request: request("cross-session-first"),
      requestId: "cross-session-request-first",
      operation: "competition_clarify",
      sessionId: "1d56c297-f8fa-4f03-9c2f-23064aa31c70",
      transitionId,
      producer: firstProducer
    });
    const second = await executeCompetitionSessionTransition({
      request: request("cross-session-second"),
      requestId: "cross-session-request-second",
      operation: "competition_clarify",
      sessionId: "91362cec-1d5d-40ec-9d39-608510503ffd",
      transitionId,
      producer: secondProducer
    });

    expect(await first.json()).toMatchObject({ session: "first" });
    expect(await second.json()).toMatchObject({ session: "second" });
    expect(second.headers.get("X-Idempotent-Replay")).toBeNull();
    expect(firstProducer).toHaveBeenCalledTimes(1);
    expect(secondProducer).toHaveBeenCalledTimes(1);
  });

  it("does not extend a signed root session expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T10:00:00.000Z"));
    const expiresAt = Math.floor(Date.now() / 1000) + 2;
    const producer = vi.fn(async () => Response.json({ ok: true }));
    expect((await executeCompetitionSessionTransition({
      request: request("fixed-expiry-first"),
      requestId: "fixed-expiry-first",
      operation: "competition_clarify",
      sessionId: "e2c84387-fb8f-4732-9dd8-5816335472fa",
      sessionExpiresAtEpochSeconds: expiresAt,
      transitionId: competitionTransitionId("competition_clarify", { index: 1 }),
      producer
    })).status).toBe(200);

    vi.advanceTimersByTime(2_100);
    const expired = await executeCompetitionSessionTransition({
      request: request("fixed-expiry-second"),
      requestId: "fixed-expiry-second",
      operation: "competition_clarify",
      sessionId: "e2c84387-fb8f-4732-9dd8-5816335472fa",
      sessionExpiresAtEpochSeconds: expiresAt,
      transitionId: competitionTransitionId("competition_clarify", { index: 2 }),
      producer
    });
    expect(expired.status).toBe(429);
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it("fails closed at the hard in-memory session cap", async () => {
    process.env.SECURITY_MEMORY_SESSIONS_MAX = "1";
    const first = await executeCompetitionSessionTransition({
      request: request("memory-cap-first"),
      requestId: "memory-cap-first",
      operation: "competition_clarify",
      sessionId: "1a77869d-0b0d-4840-9104-0d70846264db",
      transitionId: competitionTransitionId("competition_clarify", { index: 1 }),
      producer: async () => Response.json({ ok: true })
    });
    expect(first.status).toBe(200);
    const secondProducer = vi.fn(async () => Response.json({ ok: true }));
    const second = await executeCompetitionSessionTransition({
      request: request("memory-cap-second"),
      requestId: "memory-cap-second",
      operation: "competition_clarify",
      sessionId: "2a77869d-0b0d-4840-9104-0d70846264db",
      transitionId: competitionTransitionId("competition_clarify", { index: 2 }),
      producer: secondProducer
    });
    expect(second.status).toBe(503);
    expect(await second.json()).toMatchObject({ error: "SECURITY_STATE_UNAVAILABLE" });
    expect(secondProducer).not.toHaveBeenCalled();
  });

  it("reports memory counter exhaustion as unavailable instead of a fake threshold 429", async () => {
    process.env.SECURITY_MEMORY_HITS_MAX = "2";
    expect((await executeCompetitionSessionStart({
      request: request("memory-hit-cap-first", "203.0.113.10"),
      requestId: "memory-hit-cap-first",
      operation: "competition_normalize",
      transitionId: competitionTransitionId("competition_normalize", { index: 1 }),
      producer: async () => Response.json({ ok: true })
    })).status).toBe(200);

    const producer = vi.fn(async () => Response.json({ ok: true }));
    const unavailable = await executeCompetitionSessionStart({
      request: request("memory-hit-cap-second", "203.0.113.11"),
      requestId: "memory-hit-cap-second",
      operation: "competition_normalize",
      transitionId: competitionTransitionId("competition_normalize", { index: 2 }),
      producer
    });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      error: "SECURITY_STATE_UNAVAILABLE",
      bucket: "session_start_minute"
    });
    expect(producer).not.toHaveBeenCalled();
  });

  it("does not reset signed-session quota when configured memory TTL is shorter", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T10:00:00.000Z"));
    process.env.SESSION_TTL_SECONDS = "60";
    vi.resetModules();
    const limiter = await import("@/lib/security/rate-limit");
    const sessionId = "c1ec71e8-bfad-42eb-9410-c72078b98770";
    const signedExpiry = Math.floor(Date.now() / 1000) + 1800;
    for (let index = 0; index < 12; index += 1) {
      const response = await limiter.executeCompetitionSessionTransition({
        request: request(`short-config-ttl-${index}`),
        requestId: `short-config-ttl-${index}`,
        operation: "competition_clarify",
        sessionId,
        sessionExpiresAtEpochSeconds: signedExpiry,
        transitionId: limiter.competitionTransitionId("competition_clarify", { index }),
        producer: async () => Response.json({ ok: true })
      });
      expect(response.status).toBe(200);
    }

    vi.advanceTimersByTime(61_000);
    const producer = vi.fn(async () => Response.json({ ok: true }));
    const limited = await limiter.executeCompetitionSessionTransition({
      request: request("short-config-ttl-thirteenth"),
      requestId: "short-config-ttl-thirteenth",
      operation: "competition_clarify",
      sessionId,
      sessionExpiresAtEpochSeconds: signedExpiry,
      transitionId: limiter.competitionTransitionId("competition_clarify", { index: 12 }),
      producer
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ bucket: "session_transitions" });
    expect(producer).not.toHaveBeenCalled();
  });
});
