import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompetitionRequestDeadlines,
  sessionHasRequestBudget
} from "@/lib/ai/request-deadline";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.AI_REQUEST_DEADLINE_MS = "45000";
  process.env.AI_PRODUCER_DEADLINE_MS = "50000";
  process.env.IDEMPOTENCY_FINALIZE_DEADLINE_MS = "60000";
  process.env.IDEMPOTENCY_DUPLICATE_WAIT_MS = "62000";
  process.env.APP_RESPONSE_DEADLINE_MS = "65000";
});

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...originalEnv };
});

describe("competition request deadlines", () => {
  it("anchors every phase to one HTTP start time", () => {
    const startedAt = Date.parse("2026-08-26T12:00:00.000Z");
    const deadlines = createCompetitionRequestDeadlines(startedAt);

    expect(deadlines).toEqual({
      startedAtEpochMs: startedAt,
      aiDeadlineEpochMs: startedAt + 45_000,
      producerDeadlineEpochMs: startedAt + 50_000,
      finalizeDeadlineEpochMs: startedAt + 60_000,
      duplicateWaitDeadlineEpochMs: startedAt + 62_000,
      responseDeadlineEpochMs: startedAt + 65_000
    });
  });

  it("fails closed when configured phase deadlines are not strictly ordered", () => {
    process.env.AI_REQUEST_DEADLINE_MS = "55000";
    process.env.AI_PRODUCER_DEADLINE_MS = "50000";

    expect(() => createCompetitionRequestDeadlines()).toThrow(
      "Competition request deadlines are not strictly ordered"
    );
  });

  it("rejects a signed session that cannot outlive the complete response budget", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
    const deadlines = createCompetitionRequestDeadlines();
    const nowSeconds = Math.floor(Date.now() / 1_000);

    expect(sessionHasRequestBudget(nowSeconds + 66, deadlines)).toBe(true);
    expect(sessionHasRequestBudget(nowSeconds + 65, deadlines)).toBe(false);
  });
});
