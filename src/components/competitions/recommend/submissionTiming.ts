// A timing token belongs to one user submission. Reading/retrying/reloading it
// must never create a later start time. The server remains the timing authority.
export const SUBMISSION_TIMING_STORAGE_KEY_V7 = "saitu.submissionTiming.v7";
export type SubmissionTimingV7 = { version: 1; originalClickEpochMs: number; token: string | null;
  retry?: { runId: string; requestId: string } };
const tokenIsValid = (value: unknown): value is string => typeof value === "string" && value.length <= 2048 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const invalidTiming = () => new Error("本次匹配的计时记录无法核对，已保留原记录。请回看答案后重新匹配，或清除本标签页记录。");
export const submissionClockEpochMsV7 = () => performance.timeOrigin + performance.now();

export function newSubmissionTimingV7(): SubmissionTimingV7 {
  return { version: 1, originalClickEpochMs: submissionClockEpochMsV7(), token: null };
}

export function restoreSubmissionTimingV7(): SubmissionTimingV7 | null {
  let raw: string | null;
  try { raw = window.sessionStorage.getItem(SUBMISSION_TIMING_STORAGE_KEY_V7); } catch { return null; }
  if (raw === null) return null;
  try {
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || !("version" in saved) || saved.version !== 1 ||
        !("originalClickEpochMs" in saved) || typeof saved.originalClickEpochMs !== "number" || !Number.isFinite(saved.originalClickEpochMs) || saved.originalClickEpochMs <= 0 ||
        !("token" in saved) || saved.token !== null && !tokenIsValid(saved.token)) throw invalidTiming();
    const retry = "retry" in saved ? saved.retry : undefined;
    let restoredRetry: SubmissionTimingV7["retry"];
    if (retry !== undefined) {
      if (!retry || typeof retry !== "object" || !("runId" in retry) || !("requestId" in retry)) throw invalidTiming();
      const { runId, requestId } = retry;
      if (!isUuid(runId) || !isUuid(requestId)) throw invalidTiming();
      restoredRetry = { runId, requestId };
    }
    return { version: 1, originalClickEpochMs: saved.originalClickEpochMs, token: saved.token,
      ...(restoredRetry ? { retry: restoredRetry } : {}) };
  } catch { throw invalidTiming(); }
}

export function persistSubmissionTimingV7(timing: SubmissionTimingV7) {
  try { window.sessionStorage.setItem(SUBMISSION_TIMING_STORAGE_KEY_V7, JSON.stringify(timing)); } catch { /* In-memory timing remains valid. */ }
}

export function clearSubmissionTimingV7() {
  try { window.sessionStorage.removeItem(SUBMISSION_TIMING_STORAGE_KEY_V7); } catch { /* Storage is optional. */ }
}

export function submissionHeadersV7(timing: SubmissionTimingV7, initial?: HeadersInit) {
  const headers = new Headers(initial);
  headers.set("X-Saitu-Submission-Elapsed-Ms", String(Math.max(0, Math.ceil(submissionClockEpochMsV7() - timing.originalClickEpochMs))));
  if (timing.token) headers.set("X-Saitu-Submission-Timing", timing.token);
  return headers;
}

export function acceptSubmissionTimingV7(timing: SubmissionTimingV7, response: Response) {
  const token = response.headers.get("X-Saitu-Submission-Timing");
  if (token === null) return;
  if (!tokenIsValid(token)) throw invalidTiming();
  timing.token = token;
}
