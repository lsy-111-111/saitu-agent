import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptSubmissionTimingV7, clearSubmissionTimingV7, newSubmissionTimingV7, persistSubmissionTimingV7,
  restoreSubmissionTimingV7, submissionHeadersV7, SUBMISSION_TIMING_STORAGE_KEY_V7 } from "@/components/competitions/recommend/submissionTiming";

describe("v7 client timing token continuity", () => {
  let now = 1000;
  const stored = new Map<string, string>();
  beforeEach(() => {
    now = 1000; stored.clear();
    vi.stubGlobal("performance", { timeOrigin: 1_794_164_400_000, now: () => now });
    vi.stubGlobal("window", { sessionStorage: { getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("carries the signed first-stage token and cumulative elapsed time into later stages and network retries", () => {
    const timing = newSubmissionTimingV7(); now = 1210;
    const initial = submissionHeadersV7(timing, { "Content-Type": "application/json", "Idempotency-Key": "same-key" });
    expect(initial.get("X-Saitu-Submission-Elapsed-Ms")).toBe("210");
    expect(initial.get("Idempotency-Key")).toBe("same-key");
    expect(initial.has("X-Saitu-Submission-Timing")).toBe(false);
    acceptSubmissionTimingV7(timing, new Response("", { headers: { "X-Saitu-Submission-Timing": "syntheticpayload.syntheticsignature" } }));
    now = 15_000;
    const retried = submissionHeadersV7(timing);
    expect(retried.get("X-Saitu-Submission-Timing")).toBe("syntheticpayload.syntheticsignature");
    expect(retried.get("X-Saitu-Submission-Elapsed-Ms")).toBe("14000");
    expect(timing.originalClickEpochMs).toBe(1_794_164_401_000);
  });

  it("restores the original click and token after a document reload instead of restarting the window", () => {
    const timing = newSubmissionTimingV7(); timing.token = "syntheticpayload.syntheticsignature"; persistSubmissionTimingV7(timing);
    vi.stubGlobal("performance", { timeOrigin: 1_794_164_430_000, now: () => 500 });
    const restored = restoreSubmissionTimingV7(); expect(restored).toEqual(timing);
    expect(submissionHeadersV7(restored!).get("X-Saitu-Submission-Elapsed-Ms")).toBe("29500");
    expect(submissionHeadersV7(restored!).get("X-Saitu-Submission-Timing")).toBe(timing.token);
  });

  it("starts an explicit new operation without carrying the previous timing token", () => {
    const old = newSubmissionTimingV7(); old.token = "syntheticpayload.syntheticsignature"; persistSubmissionTimingV7(old);
    clearSubmissionTimingV7(); now = 20_000;
    const next = newSubmissionTimingV7();
    expect(restoreSubmissionTimingV7()).toBeNull(); expect(next.token).toBeNull();
    expect(next.originalClickEpochMs).toBeGreaterThan(old.originalClickEpochMs);
  });

  it("atomically restores the same unknown-outcome retry ID and original clock after reload", () => {
    const timing = newSubmissionTimingV7();
    timing.retry = { runId: "91e5ae60-60b4-4cb6-8e20-fb2e55751001", requestId: "91e5ae60-60b4-4cb6-8e20-fb2e55751002" };
    timing.token = "syntheticpayload.syntheticsignature"; persistSubmissionTimingV7(timing);
    now += 12_000;
    const restored = restoreSubmissionTimingV7(); expect(restored).toEqual(timing);
    expect(restored?.retry?.requestId).toBe(timing.retry.requestId);
    expect(submissionHeadersV7(restored!).get("X-Saitu-Submission-Elapsed-Ms")).toBe("12000");
  });

  it("rejects a corrupt persisted retry intent without discarding its old timing", () => {
    const timing = newSubmissionTimingV7();
    stored.set(SUBMISSION_TIMING_STORAGE_KEY_V7, JSON.stringify({ ...timing, retry: { runId: "invalid", requestId: "invalid" } }));
    expect(() => restoreSubmissionTimingV7()).toThrow("计时记录无法核对");
    expect(stored.has(SUBMISSION_TIMING_STORAGE_KEY_V7)).toBe(true);
  });

  it("rejects malformed timing without clearing the original or silently starting another window", () => {
    const timing = newSubmissionTimingV7(); timing.token = "syntheticpayload.syntheticsignature";
    expect(() => acceptSubmissionTimingV7(timing, new Response("", { headers: { "X-Saitu-Submission-Timing": "untrusted token with spaces" } }))).toThrow("计时记录无法核对");
    expect(timing.token).toBe("syntheticpayload.syntheticsignature");
    stored.set(SUBMISSION_TIMING_STORAGE_KEY_V7, JSON.stringify({ version: 1, originalClickEpochMs: "invented", token: null }));
    expect(() => restoreSubmissionTimingV7()).toThrow("计时记录无法核对");
    expect(stored.has(SUBMISSION_TIMING_STORAGE_KEY_V7)).toBe(true);
  });

  it("keeps in-memory elapsed time when browser storage is blocked", () => {
    vi.stubGlobal("window", { get sessionStorage() { throw new Error("blocked"); } });
    const timing = newSubmissionTimingV7(); expect(() => persistSubmissionTimingV7(timing)).not.toThrow();
    expect(restoreSubmissionTimingV7()).toBeNull(); now += 5000;
    expect(submissionHeadersV7(timing).get("X-Saitu-Submission-Elapsed-Ms")).toBe("5000");
  });
});
