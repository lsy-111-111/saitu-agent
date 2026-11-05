export type CompetitionRequestDeadlines = {
  startedAtEpochMs: number;
  aiDeadlineEpochMs: number;
  producerDeadlineEpochMs: number;
  finalizeDeadlineEpochMs: number;
  duplicateWaitDeadlineEpochMs: number;
  responseDeadlineEpochMs: number;
};

const DEFAULT_DEADLINES_MS = {
  ai: 45_000,
  producer: 50_000,
  finalize: 60_000,
  duplicateWait: 62_000,
  response: 65_000
} as const;

function configuredDuration(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 1_000 ? Math.floor(value) : fallback;
}

export function createCompetitionRequestDeadlines(
  startedAtEpochMs = Date.now()
): CompetitionRequestDeadlines {
  const durations = {
    ai: configuredDuration("AI_REQUEST_DEADLINE_MS", DEFAULT_DEADLINES_MS.ai),
    producer: configuredDuration(
      "AI_PRODUCER_DEADLINE_MS",
      DEFAULT_DEADLINES_MS.producer
    ),
    finalize: configuredDuration(
      "IDEMPOTENCY_FINALIZE_DEADLINE_MS",
      DEFAULT_DEADLINES_MS.finalize
    ),
    duplicateWait: configuredDuration(
      "IDEMPOTENCY_DUPLICATE_WAIT_MS",
      DEFAULT_DEADLINES_MS.duplicateWait
    ),
    response: configuredDuration(
      "APP_RESPONSE_DEADLINE_MS",
      DEFAULT_DEADLINES_MS.response
    )
  };
  if (!(
    durations.ai < durations.producer &&
    durations.producer < durations.finalize &&
    durations.finalize < durations.duplicateWait &&
    durations.duplicateWait < durations.response
  )) {
    throw new Error("Competition request deadlines are not strictly ordered");
  }

  return {
    startedAtEpochMs,
    aiDeadlineEpochMs: startedAtEpochMs + durations.ai,
    producerDeadlineEpochMs: startedAtEpochMs + durations.producer,
    finalizeDeadlineEpochMs: startedAtEpochMs + durations.finalize,
    duplicateWaitDeadlineEpochMs: startedAtEpochMs + durations.duplicateWait,
    responseDeadlineEpochMs: startedAtEpochMs + durations.response
  };
}

export function remainingDeadlineMs(deadlineEpochMs: number) {
  return Math.max(0, Math.floor(deadlineEpochMs - Date.now()));
}

export function deadlineHasElapsed(deadlineEpochMs: number) {
  return remainingDeadlineMs(deadlineEpochMs) <= 0;
}

export function sessionHasRequestBudget(
  sessionExpiresAtEpochSeconds: number,
  deadlines: CompetitionRequestDeadlines
) {
  return sessionExpiresAtEpochSeconds * 1_000 > deadlines.responseDeadlineEpochMs;
}

export function createDeadlineSignal(
  deadlineEpochMs: number,
  parentSignal?: AbortSignal
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, Math.max(0, remainingDeadlineMs(deadlineEpochMs)));
  timeout.unref?.();
  parentSignal?.addEventListener("abort", abort, { once: true });
  if (parentSignal?.aborted) abort();

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    }
  };
}

