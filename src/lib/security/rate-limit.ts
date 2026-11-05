import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID
} from "node:crypto";
import type { PoolClient } from "pg";
import { NextResponse } from "next/server";
import {
  createCompetitionRequestDeadlines,
  createDeadlineSignal,
  deadlineHasElapsed,
  remainingDeadlineMs,
  type CompetitionRequestDeadlines
} from "@/lib/ai/request-deadline";
import { isEphemeralE2eSecurityStateAllowed } from "@/lib/config/e2e-runtime";
import { getPool, isDatabaseConfigured } from "@/lib/db/pool";

export type BucketName =
  | "session_start_minute"
  | "session_start_daily"
  | "session_transitions"
  | "transition_retries"
  | "track";

type BucketConfig = { limit: number; windowMs: number };
type HitState = { count: number; resetAt: number };
type SessionState = {
  committedTransitions: Set<string>;
  pendingTransitions: Set<string>;
  expiresAt: number;
};
type EncryptedResponse = {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  byteSize: number;
};
type CachedTransition = { expiresAt: number; encrypted: EncryptedResponse };
type RetryState = { expiresAt: number; retries: number };
type PersistentIdempotencyRow = {
  state: "pending" | "completed" | "retryable";
  generation: number;
  producer_retries: number;
  retry_kind: "no_store" | "failure" | null;
  expires_at: Date;
  lease_active: boolean;
  response_ciphertext: Buffer | null;
  response_iv: Buffer | null;
  response_tag: Buffer | null;
  response_bytes: number | null;
};
type PersistentClaim =
  | { action: "produce"; ownerToken: string; generation: number; producerRetries: number }
  | { action: "replay"; row: PersistentIdempotencyRow }
  | { action: "wait"; generation: number }
  | { action: "retry_exhausted"; resetAt: number };
type PersistentExecutionClaim = PersistentClaim & {
  expiresAt: number;
  transitionWasCommitted?: boolean;
};
type CompetitionControlInput = {
  request: Request;
  requestId: string;
  operation: string;
  transitionId: string;
  deadlines?: CompetitionRequestDeadlines;
  responseSignal?: AbortSignal;
  producer: (context: CompetitionProducerContext) => Promise<Response>;
  onOwnerCommitted?: (context: CompetitionOwnerCommittedContext) => Promise<void>;
  sessionId?: string;
};

export type CompetitionProducerContext = {
  deadlines: CompetitionRequestDeadlines;
  signal: AbortSignal;
};

export type CompetitionOwnerCommittedContext = {
  deadlines: CompetitionRequestDeadlines;
  signal: AbortSignal;
  requestId: string;
  status: number;
};

function readNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const buckets: Record<BucketName, BucketConfig> = {
  session_start_minute: {
    limit: readNumber("SESSION_STARTS_PER_IP_MINUTE", 60),
    windowMs: 60_000
  },
  session_start_daily: {
    limit: readNumber("SESSION_STARTS_PER_IP_DAY", 600),
    windowMs: 24 * 60 * 60_000
  },
  session_transitions: {
    limit: readNumber("SESSION_TRANSITIONS_PER_SESSION", 12),
    windowMs: readNumber("SESSION_TTL_SECONDS", 30 * 60) * 1000
  },
  transition_retries: {
    limit: 2,
    windowMs: readNumber("SESSION_TTL_SECONDS", 30 * 60) * 1000
  },
  track: { limit: readNumber("MAX_TRACK_PER_IP_MINUTE", 60), windowMs: 60_000 }
};

const hits = new Map<string, HitState>();
const sessions = new Map<string, SessionState>();
const startedSessionKeys = new Map<string, number>();
const cachedTransitions = new Map<string, CachedTransition>();
const uncachedRetries = new Map<string, RetryState>();
const inFlightTransitions = new Map<string, Promise<Response>>();
type PersistentResponseWaitResult =
  | { outcome: "ready"; row: PersistentIdempotencyRow }
  | { outcome: "owner_gone" }
  | { outcome: "timed_out" };
const persistentResponseWaits = new Map<
  string,
  { generation: number; promise: Promise<PersistentResponseWaitResult> }
>();

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
// The producer is bounded by the application-level AI request deadline.
// Heartbeats keep a live owner fresh; the base lease also prevents a transient
// heartbeat delay from letting a second process execute the same transition.
const IDEMPOTENCY_LEASE_MS = 180_000;
const IDEMPOTENCY_HEARTBEAT_MS = 30_000;
const PRODUCER_MAX_RETRIES = 2;
const MAX_SIGNED_SESSION_REMAINING_MS = 30 * 60_000;
const ENCRYPTION_CONTEXT = "resume-ai/competition-idempotency/v1";
const MAX_RESPONSE_BODY_BYTES = 512 * 1024;
const MAX_ENCRYPTED_RESPONSE_BYTES = 1024 * 1024;
const ephemeralLogHashSalt = randomBytes(32).toString("hex");
let cachedTransitionBytes = 0;
let lastMemoryPruneAt = 0;
let lastPersistentPruneAt = 0;

function normalizedDeadlines(value?: CompetitionRequestDeadlines) {
  return value ?? createCompetitionRequestDeadlines();
}

class PersistentLimitError extends Error {
  constructor(readonly bucket: BucketName, readonly resetAt: number) {
    super("Persistent rate limit exceeded");
    this.name = "PersistentLimitError";
  }
}

class CompetitionDeadlineError extends Error {
  constructor() {
    super("Competition request deadline elapsed");
    this.name = "CompetitionDeadlineError";
  }
}

function memoryLimits() {
  return {
    hits: readNumber("SECURITY_MEMORY_HITS_MAX", 10_000),
    sessions: readNumber("SECURITY_MEMORY_SESSIONS_MAX", 2_000),
    starts: readNumber("SECURITY_MEMORY_START_KEYS_MAX", 10_000),
    idempotency: readNumber("SECURITY_MEMORY_IDEMPOTENCY_MAX", 4_000),
    inFlight: readNumber("SECURITY_MEMORY_INFLIGHT_MAX", 128),
    cacheBytes: readNumber("SECURITY_MEMORY_CACHE_BYTES_MAX", 32 * 1024 * 1024)
  };
}

function persistentSecurityStateRequired() {
  return isDatabaseConfigured() || (
    process.env.NODE_ENV === "production" && !isEphemeralE2eSecurityStateAllowed()
  );
}

export function getClientIp(request: Request) {
  // Nginx overwrites X-Real-IP with the direct peer in production.
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function securityStateHash(value: string) {
  const key = encryptionKey() ?? Buffer.from(ephemeralLogHashSalt, "hex");
  return createHmac("sha256", key).update(value).digest("hex");
}

function bucketKey(request: Request, bucket: BucketName) {
  return `${bucket}:${hashValue(getClientIp(request))}`;
}

function hashValueForLogs(value: string) {
  const salt = [
    process.env.LOG_HASH_SECRET,
    process.env.RATE_LIMIT_HASH_SALT,
    process.env.AI_CONVERSATION_SIGNING_SECRET,
    process.env.AI_CONSENT_SALT
  ].map((secret) => secret?.trim())
    .find((secret): secret is string => Boolean(secret && secret.length >= 32)) ??
    ephemeralLogHashSalt;
  return createHmac("sha256", salt).update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function competitionTransitionId(operation: string, value: unknown) {
  return hashValue(`${operation}\0${canonicalJson(value)}`);
}

export function getRequestId(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
}

export function withRequestId<T extends Response>(response: T, requestId: string): T {
  response.headers.set("X-Request-ID", requestId);
  return response;
}

export function hashSessionIdForLogs(sessionId: string) {
  return hashValueForLogs(`competition-session\0${sessionId}`).slice(0, 24);
}

function encryptionKey() {
  const configured = process.env.AI_CONVERSATION_SIGNING_SECRET?.trim();
  const secret = configured && configured.length >= 32
    ? configured
    : process.env.NODE_ENV !== "production"
      ? "development-only-competition-token-secret-do-not-deploy"
      : null;
  if (!secret) return null;
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.from("resume-ai/security-state", "utf8"),
    Buffer.from(ENCRYPTION_CONTEXT, "utf8"),
    32
  ));
}

function encryptionAad(key: string, generation: number | "memory") {
  return Buffer.from(`${ENCRYPTION_CONTEXT}\0${key}\0${generation}`, "utf8");
}

async function encryptResponse(
  response: Response,
  key: string,
  generation: number | "memory",
  deadlineEpochMs: number,
  signal: AbortSignal
): Promise<{ encrypted: EncryptedResponse; replayableResponse: Response }> {
  const body = await readBoundedResponseBody(response, deadlineEpochMs, signal);
  if (deadlineHasElapsed(deadlineEpochMs) || signal.aborted) {
    throw new CompetitionDeadlineError();
  }
  const responseHeaders = [...response.headers.entries()];
  const plaintext = Buffer.from(JSON.stringify({
    version: 1,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()].filter(([name]) =>
      name.toLowerCase() !== "x-request-id" && name.toLowerCase() !== "x-idempotent-replay"
    ),
    body: body.toString("base64")
  }), "utf8");
  const derived = encryptionKey();
  if (!derived) throw new Error("Idempotency encryption key is unavailable");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derived, iv);
  cipher.setAAD(encryptionAad(key, generation));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  if (ciphertext.byteLength > MAX_ENCRYPTED_RESPONSE_BYTES) {
    throw new Error("Encrypted idempotency response exceeds the cache ceiling");
  }
  return {
    encrypted: {
      ciphertext,
      iv,
      tag: cipher.getAuthTag(),
      byteSize: ciphertext.byteLength + iv.byteLength + 16
    },
    replayableResponse: new Response(
      response.status === 204 || response.status === 205 || response.status === 304 ? null : body,
      {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      }
    )
  };
}

async function readBoundedResponseBody(
  response: Response,
  deadlineEpochMs: number,
  signal: AbortSignal
) {
  const declaredLength = response.headers.get("content-length")?.trim();
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > MAX_RESPONSE_BODY_BYTES) {
      void response.body?.cancel().catch(() => {
        // The size violation is definitive even if cancellation races cleanup.
      });
      throw new Error("Idempotency response exceeds the encrypted cache ceiling");
    }
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const read = await waitForCallerBeforeDeadline(
        reader.read(),
        deadlineEpochMs,
        signal
      );
      if (!read.settled) {
        void reader.cancel().catch(() => {
          // The caller deadline is authoritative even if stream cleanup races.
        });
        throw new CompetitionDeadlineError();
      }
      const { done, value } = read.value;
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BODY_BYTES) {
        void reader.cancel().catch(() => {
          // The response will not be cached after the bounded read fails.
        });
        throw new Error("Idempotency response exceeds the encrypted cache ceiling");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

function decryptResponse(
  encrypted: EncryptedResponse,
  key: string,
  generation: number | "memory"
) {
  if (
    encrypted.ciphertext.byteLength > MAX_ENCRYPTED_RESPONSE_BYTES ||
    encrypted.iv.byteLength !== 12 || encrypted.tag.byteLength !== 16
  ) throw new Error("Invalid encrypted idempotency response");
  const derived = encryptionKey();
  if (!derived) throw new Error("Idempotency encryption key is unavailable");
  const decipher = createDecipheriv("aes-256-gcm", derived, encrypted.iv);
  decipher.setAAD(encryptionAad(key, generation));
  decipher.setAuthTag(encrypted.tag);
  const parsed = JSON.parse(Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final()
  ]).toString("utf8")) as {
    version?: unknown;
    status?: unknown;
    statusText?: unknown;
    headers?: unknown;
    body?: unknown;
  };
  if (
    parsed.version !== 1 || !Number.isInteger(parsed.status) ||
    (parsed.status as number) < 100 || (parsed.status as number) > 599 ||
    typeof parsed.statusText !== "string" || !Array.isArray(parsed.headers) ||
    !parsed.headers.every((entry) => Array.isArray(entry) && entry.length === 2 &&
      typeof entry[0] === "string" && typeof entry[1] === "string") ||
    typeof parsed.body !== "string"
  ) throw new Error("Invalid decrypted idempotency response");
  const body = Buffer.from(parsed.body, "base64");
  if (body.byteLength > MAX_RESPONSE_BODY_BYTES) {
    throw new Error("Decrypted idempotency response exceeds the cache ceiling");
  }
  const status = parsed.status as number;
  return new Response(status === 204 || status === 205 || status === 304 ? null : body, {
    status,
    statusText: parsed.statusText,
    headers: parsed.headers as [string, string][]
  });
}

function cloneForReplay(response: Response, requestId: string, replay: boolean) {
  const clone = response.clone();
  clone.headers.set("X-Request-ID", requestId);
  if (replay) clone.headers.set("X-Idempotent-Replay", "true");
  return clone;
}

function logCompetitionRequestOutcome(input: {
  request: Request;
  requestId: string;
  operation: string;
  bucket: "session_start" | "session_transitions";
  response: Response;
  sessionId?: string;
}) {
  const entry = JSON.stringify({
    event: "competition_api_request",
    endpoint: new URL(input.request.url).pathname,
    stage: input.operation,
    statusCode: input.response.status,
    bucket: input.bucket,
    source: "application",
    requestId: input.requestId,
    ipHash: hashValueForLogs(`competition-ip\0${getClientIp(input.request)}`).slice(0, 24),
    sessionHash: input.sessionId ? hashSessionIdForLogs(input.sessionId) : undefined,
    idempotentReplay: input.response.headers.get("X-Idempotent-Replay") === "true"
  });
  if (input.response.status >= 500) console.error(entry);
  else console.info(entry);
}

function deleteCachedTransition(key: string) {
  const cached = cachedTransitions.get(key);
  if (!cached) return;
  cachedTransitionBytes = Math.max(0, cachedTransitionBytes - cached.encrypted.byteSize);
  cachedTransitions.delete(key);
}

function pruneExpiredMemory(now: number, force = false) {
  if (!force && now - lastMemoryPruneAt < 1_000) return;
  lastMemoryPruneAt = now;
  for (const [key, state] of hits) if (state.resetAt <= now) hits.delete(key);
  for (const [key, state] of sessions) if (state.expiresAt <= now) sessions.delete(key);
  for (const [key, expiresAt] of startedSessionKeys) {
    if (expiresAt <= now) startedSessionKeys.delete(key);
  }
  for (const [key, state] of cachedTransitions) {
    if (state.expiresAt <= now) deleteCachedTransition(key);
  }
  for (const [key, state] of uncachedRetries) {
    if (state.expiresAt <= now) uncachedRetries.delete(key);
  }
}

function hasMemoryCapacity(kind: keyof ReturnType<typeof memoryLimits>, current: number) {
  pruneExpiredMemory(Date.now());
  return current < memoryLimits()[kind];
}

export function checkRateLimit(request: Request, bucket: BucketName) {
  const now = Date.now();
  const config = buckets[bucket];
  const key = bucketKey(request, bucket);
  const current = hits.get(key);
  pruneExpiredMemory(now);
  if (!current || current.resetAt <= now) {
    if (!hasMemoryCapacity("hits", hits.size)) {
      return {
        ok: false as const,
        remaining: 0,
        resetAt: now + config.windowMs,
        stateUnavailable: true as const
      };
    }
    hits.set(key, { count: 1, resetAt: now + config.windowMs });
    return {
      ok: true as const,
      remaining: config.limit - 1,
      resetAt: now + config.windowMs,
      stateUnavailable: false as const
    };
  }
  if (current.count >= config.limit) {
    return {
      ok: false as const,
      remaining: 0,
      resetAt: current.resetAt,
      stateUnavailable: false as const
    };
  }
  current.count += 1;
  return {
    ok: true as const,
    remaining: config.limit - current.count,
    resetAt: current.resetAt,
    stateUnavailable: false as const
  };
}

export function rateLimitResponse(
  resetAt: number,
  context: {
    bucket?: BucketName;
    operation?: string;
    request?: Request;
    requestId?: string;
    sessionId?: string;
    source?: "application" | "gateway";
  } = {}
) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  const requestId = context.requestId ??
    (context.request ? getRequestId(context.request) : randomUUID());
  const source = context.source ?? "application";
  console.warn(JSON.stringify({
    event: "rate_limit_exceeded",
    endpoint: context.request ? new URL(context.request.url).pathname : undefined,
    stage: context.operation ?? "unspecified",
    statusCode: 429,
    source,
    bucket: context.bucket ?? "track",
    retryAfter,
    requestId,
    ipHash: context.request
      ? hashValueForLogs(`competition-ip\0${getClientIp(context.request)}`).slice(0, 24)
      : undefined,
    sessionHash: context.sessionId ? hashSessionIdForLogs(context.sessionId) : undefined
  }));
  return NextResponse.json(
    {
      ok: false,
      error: "RATE_LIMITED",
      retryAfter,
      source,
      bucket: context.bucket ?? "track",
      requestId
    },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Retry-After": String(retryAfter),
        "X-RateLimit-Source": source,
        "X-Request-ID": requestId
      }
    }
  );
}

export function securityStateUnavailableResponse(
  input: Pick<CompetitionControlInput, "request" | "requestId" | "operation" | "sessionId">,
  bucket: BucketName
) {
  const retryAfter = 5;
  console.error(JSON.stringify({
    event: "competition_security_state_unavailable",
    endpoint: new URL(input.request.url).pathname,
    stage: input.operation,
    statusCode: 503,
    bucket,
    source: "application",
    requestId: input.requestId,
    ipHash: hashValueForLogs(`competition-ip\0${getClientIp(input.request)}`).slice(0, 24),
    sessionHash: input.sessionId ? hashSessionIdForLogs(input.sessionId) : undefined
  }));
  return NextResponse.json(
    {
      ok: false,
      error: "SECURITY_STATE_UNAVAILABLE",
      retryAfter,
      source: "application",
      bucket,
      requestId: input.requestId
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Retry-After": String(retryAfter),
        "X-RateLimit-Source": "application",
        "X-Request-ID": input.requestId
      }
    }
  );
}

function requestInProgressResponse(
  input: Pick<CompetitionControlInput, "requestId">
) {
  return NextResponse.json(
    {
      ok: false,
      error: "REQUEST_IN_PROGRESS",
      retryAfter: 1,
      requestId: input.requestId
    },
    {
      status: 409,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Retry-After": "1",
        "X-Idempotency-Status": "pending",
        "X-Request-ID": input.requestId
      }
    }
  );
}

function replayKey(scope: string, operation: string, transitionId: string) {
  return securityStateHash(`${scope}\0${operation}\0${transitionId}`);
}

function markMemoryRetryable(key: string, expiresAt: number, exhausted = false) {
  if (!uncachedRetries.has(key)) {
    uncachedRetries.set(key, {
      expiresAt,
      retries: exhausted ? PRODUCER_MAX_RETRIES : 0
    });
  } else if (exhausted) {
    uncachedRetries.get(key)!.retries = PRODUCER_MAX_RETRIES;
  }
}

async function waitForMemoryInFlight(
  input: CompetitionControlInput,
  inFlight: Promise<Response>
) {
  const deadlines = normalizedDeadlines(input.deadlines);
  const settled = await waitForCallerBeforeDeadline(
    inFlight,
    deadlines.duplicateWaitDeadlineEpochMs,
    input.responseSignal ?? input.request.signal
  );
  return settled.settled ? settled.value : null;
}

async function waitForCallerBeforeDeadline<T>(
  work: Promise<T>,
  deadlineEpochMs: number,
  signal: AbortSignal
): Promise<{ settled: true; value: T } | { settled: false }> {
  const remainingMs = remainingDeadlineMs(deadlineEpochMs);
  if (remainingMs <= 0 || signal.aborted) {
    void work.catch(() => undefined);
    return { settled: false };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      work.then((value) => ({ settled: true, value }) as const),
      new Promise<{ settled: false }>((resolve) => {
        timer = setTimeout(() => resolve({ settled: false }), remainingMs);
      }),
      new Promise<{ settled: false }>((resolve) => {
        abort = () => resolve({ settled: false });
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}

async function awaitBeforeCompetitionDeadline<T>(
  work: Promise<T>,
  deadlineEpochMs: number,
  signal: AbortSignal
) {
  const settled = await waitForCallerBeforeDeadline(work, deadlineEpochMs, signal);
  if (!settled.settled) throw new CompetitionDeadlineError();
  return settled.value;
}

async function notifyOwnerCommitted(
  input: CompetitionControlInput,
  response: Response,
  deadlines: CompetitionRequestDeadlines
) {
  if (!input.onOwnerCommitted) return;
  const signal = input.responseSignal ?? input.request.signal;
  const callbackDeadlineEpochMs = Math.min(
    deadlines.responseDeadlineEpochMs,
    Date.now() + 1_500
  );
  try {
    await awaitBeforeCompetitionDeadline(
      input.onOwnerCommitted({
        deadlines,
        signal,
        requestId: input.requestId,
        status: response.status
      }),
      callbackDeadlineEpochMs,
      signal
    );
  } catch {
    console.warn(JSON.stringify({
      event: "competition_owner_commit_callback_failed",
      endpoint: new URL(input.request.url).pathname,
      stage: input.operation,
      requestId: input.requestId
    }));
  }
}

async function executeMemoryIdempotently(
  input: CompetitionControlInput,
  key: string,
  expiresAt: number,
  onSuccess?: () => void,
  onFailure?: () => void
) {
  const now = Date.now();
  const cached = cachedTransitions.get(key);
  if (cached && cached.expiresAt > now) {
    try {
      return cloneForReplay(
        decryptResponse(cached.encrypted, key, "memory"),
        input.requestId,
        true
      );
    } catch {
      deleteCachedTransition(key);
      return securityStateUnavailableResponse(input, "session_transitions");
    }
  }
  if (cached) deleteCachedTransition(key);

  const inFlight = inFlightTransitions.get(key);
  if (inFlight) {
    const response = await waitForMemoryInFlight(input, inFlight);
    return response
      ? cloneForReplay(response, input.requestId, true)
      : requestInProgressResponse(input);
  }

  const retry = uncachedRetries.get(key);
  const hasRetryReservation = Boolean(retry && retry.expiresAt > now);
  if (retry && retry.expiresAt > now) {
    if (retry.retries >= PRODUCER_MAX_RETRIES) {
      return rateLimitResponse(retry.expiresAt, {
        bucket: "transition_retries",
        operation: input.operation,
        request: input.request,
        requestId: input.requestId,
        sessionId: input.sessionId
      });
    }
    retry.retries += 1;
  } else if (retry) {
    uncachedRetries.delete(key);
  }

  const limits = memoryLimits();
  if (
    inFlightTransitions.size >= limits.inFlight ||
    (!hasRetryReservation &&
      cachedTransitions.size + uncachedRetries.size + inFlightTransitions.size >= limits.idempotency)
  ) {
    return securityStateUnavailableResponse(input, "session_transitions");
  }

  const work = (async () => {
    let response: Response;
    const deadlines = normalizedDeadlines(input.deadlines);
    const responseSignal = input.responseSignal ?? input.request.signal;
    if (deadlineHasElapsed(deadlines.producerDeadlineEpochMs) || responseSignal.aborted) {
      onFailure?.();
      markMemoryRetryable(key, expiresAt);
      return securityStateUnavailableResponse(input, "session_transitions");
    }
    const deadlineSignal = createDeadlineSignal(
      deadlines.producerDeadlineEpochMs,
      responseSignal
    );
    try {
      response = withRequestId(await awaitBeforeCompetitionDeadline(
        input.producer({ deadlines, signal: deadlineSignal.signal }),
        deadlines.producerDeadlineEpochMs,
        deadlineSignal.signal
      ), input.requestId);
    } catch (error) {
      onFailure?.();
      markMemoryRetryable(key, expiresAt);
      inFlightTransitions.delete(key);
      if (error instanceof CompetitionDeadlineError) {
        return securityStateUnavailableResponse(input, "session_transitions");
      }
      throw error;
    } finally {
      deadlineSignal.dispose();
    }

    try {
      if (!response.ok) {
        onFailure?.();
        markMemoryRetryable(key, expiresAt);
      } else if (response.headers.get("X-Idempotency-Cache") === "no-store") {
        onSuccess?.();
        if (!uncachedRetries.has(key)) {
          if (cachedTransitions.size + uncachedRetries.size >= limits.idempotency) {
            return securityStateUnavailableResponse(input, "session_transitions");
          }
          markMemoryRetryable(key, expiresAt);
        }
      } else {
        let encrypted: EncryptedResponse;
        try {
          const buffered = await encryptResponse(
            response,
            key,
            "memory",
            deadlines.finalizeDeadlineEpochMs,
            responseSignal
          );
          encrypted = buffered.encrypted;
          response = buffered.replayableResponse;
          if (cachedTransitionBytes + encrypted.byteSize > limits.cacheBytes) {
            throw new Error("In-memory encrypted response cache is full");
          }
        } catch (error) {
          onFailure?.();
          markMemoryRetryable(
            key,
            expiresAt,
            !(error instanceof CompetitionDeadlineError)
          );
          return securityStateUnavailableResponse(input, "session_transitions");
        }
        onSuccess?.();
        uncachedRetries.delete(key);
        cachedTransitions.set(key, { expiresAt, encrypted });
        cachedTransitionBytes += encrypted.byteSize;
        await notifyOwnerCommitted(input, response, deadlines);
      }
      return response;
    } finally {
      inFlightTransitions.delete(key);
    }
  })();
  inFlightTransitions.set(key, work);
  return cloneForReplay(await work, input.requestId, false);
}

async function connectBefore(deadlineEpochMs: number, signal?: AbortSignal) {
  const remainingMs = remainingDeadlineMs(deadlineEpochMs);
  if (remainingMs <= 0 || signal?.aborted) throw new CompetitionDeadlineError();
  const connection = getPool().connect();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const result = await (async () => {
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
  if (!result) {
    void connection.then((client) => client.release(true)).catch(() => undefined);
    throw new CompetitionDeadlineError();
  }
  return result.client;
}

async function withTransaction<T>(
  deadlineEpochMs: number,
  work: (client: PoolClient) => Promise<T>,
  signal?: AbortSignal
) {
  const client = await connectBefore(deadlineEpochMs, signal);
  let transactionOpen = false;
  let destroyClient = false;
  const queryBeforeDeadline = async (args: unknown[]) => {
    const remainingMs = remainingDeadlineMs(deadlineEpochMs);
    if (remainingMs <= 0 || signal?.aborted) throw new CompetitionDeadlineError();
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
      throw new CompetitionDeadlineError();
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
    if (remainingMs <= 0 || signal?.aborted) throw new CompetitionDeadlineError();
    await boundedClient.query(
      `select set_config('statement_timeout', $1, true),
              set_config('lock_timeout', $2, true)`,
      [
        `${remainingMs}ms`,
        `${Math.max(1, Math.min(5_000, remainingMs))}ms`
      ]
    );
    const result = await work(boundedClient);
    if (deadlineHasElapsed(deadlineEpochMs)) throw new CompetitionDeadlineError();
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

async function maybePrunePersistentState(client: PoolClient) {
  const now = Date.now();
  if (now - lastPersistentPruneAt < 60_000) return;
  await client.query(`select public.resume_ai_runtime_prune_competition_state()`);
  lastPersistentPruneAt = now;
}

async function consumePersistentCounter(
  client: PoolClient,
  bucket: "session_start_minute" | "session_start_daily",
  scopeKey: string
) {
  const config = buckets[bucket];
  const result = await client.query<{ reset_at: Date }>(
    `insert into competition_rate_limit_counters
       (bucket, scope_key, hit_count, reset_at, updated_at)
     values ($1, $2, 1, now() + ($3::bigint * interval '1 millisecond'), now())
     on conflict (bucket, scope_key) do update
       set hit_count = case
             when competition_rate_limit_counters.reset_at <= now() then 1
             else competition_rate_limit_counters.hit_count + 1
           end,
           reset_at = case
             when competition_rate_limit_counters.reset_at <= now()
               then now() + ($3::bigint * interval '1 millisecond')
             else competition_rate_limit_counters.reset_at
           end,
           updated_at = now()
       where competition_rate_limit_counters.reset_at <= now()
          or competition_rate_limit_counters.hit_count < $4
     returning reset_at`,
    [bucket, scopeKey, config.windowMs, config.limit]
  );
  if (result.rowCount === 1) return;
  const current = await client.query<{ reset_at: Date }>(
    `select reset_at from competition_rate_limit_counters
      where bucket = $1 and scope_key = $2`,
    [bucket, scopeKey]
  );
  throw new PersistentLimitError(
    bucket,
    current.rows[0]?.reset_at.getTime() ?? Date.now() + config.windowMs
  );
}

async function claimPersistentIdempotency(
  client: PoolClient,
  key: string,
  expiresAt: number,
  ownerDeadlineEpochMs: number
): Promise<PersistentClaim> {
  const ownerToken = randomUUID();
  const inserted = await client.query<{ generation: number }>(
    `insert into competition_idempotency
       (cache_key, state, owner_token, generation, producer_retries,
        expires_at, lease_expires_at, updated_at)
     values ($1, 'pending', $2::uuid, 1, 0, $3, $4, now())
     on conflict (cache_key) do nothing
     returning generation`,
    [key, ownerToken, new Date(expiresAt), new Date(ownerDeadlineEpochMs)]
  );
  if (inserted.rowCount === 1) {
    return { action: "produce", ownerToken, generation: 1, producerRetries: 0 };
  }

  const selected = await client.query<PersistentIdempotencyRow>(
    `select state, generation, producer_retries, retry_kind, expires_at,
            lease_expires_at > now() as lease_active,
            response_ciphertext, response_iv, response_tag, response_bytes
       from competition_idempotency where cache_key = $1 for update`,
    [key]
  );
  const row = selected.rows[0];
  if (!row) throw new Error("Idempotency row disappeared while locked");
  if (row.expires_at.getTime() <= Date.now()) {
    const reset = await client.query<{ generation: number }>(
      `update competition_idempotency
          set state = 'pending', owner_token = $2::uuid,
              generation = generation + 1, producer_retries = 0,
              retry_kind = null, expires_at = $3,
              lease_expires_at = $4,
              response_ciphertext = null, response_iv = null, response_tag = null,
              response_bytes = null, updated_at = now()
        where cache_key = $1 returning generation`,
      [key, ownerToken, new Date(expiresAt), new Date(ownerDeadlineEpochMs)]
    );
    return {
      action: "produce",
      ownerToken,
      generation: reset.rows[0]!.generation,
      producerRetries: 0
    };
  }

  await client.query(
    `update competition_idempotency
        set expires_at = least(expires_at, $2), updated_at = now()
      where cache_key = $1`,
    [key, new Date(expiresAt)]
  );
  row.expires_at = new Date(Math.min(row.expires_at.getTime(), expiresAt));
  if (row.state === "completed") return { action: "replay", row };
  if (row.state === "pending" && row.lease_active) {
    return { action: "wait", generation: row.generation };
  }
  const retryableExecution = row.state === "retryable" ||
    (row.state === "pending" && !row.lease_active);
  if (retryableExecution && row.producer_retries >= PRODUCER_MAX_RETRIES) {
    return { action: "retry_exhausted", resetAt: row.expires_at.getTime() };
  }

  const nextProducerRetries = retryableExecution
    ? row.producer_retries + 1
    : row.producer_retries;
  const claimed = await client.query<{ generation: number }>(
    `update competition_idempotency
        set state = 'pending', owner_token = $2::uuid, generation = generation + 1,
            producer_retries = $3, retry_kind = null,
            lease_expires_at = $4,
            response_ciphertext = null, response_iv = null, response_tag = null,
            response_bytes = null, updated_at = now()
      where cache_key = $1 returning generation`,
    [key, ownerToken, nextProducerRetries, new Date(ownerDeadlineEpochMs)]
  );
  return {
    action: "produce",
    ownerToken,
    generation: claimed.rows[0]!.generation,
    producerRetries: nextProducerRetries
  };
}

async function beginPersistentStart(
  input: CompetitionControlInput,
  key: string,
  expiresAt: number
): Promise<PersistentExecutionClaim> {
  const deadlines = normalizedDeadlines(input.deadlines);
  return withTransaction(deadlines.producerDeadlineEpochMs, async (client) => {
    await maybePrunePersistentState(client);
    await client.query(
      `select public.resume_ai_runtime_delete_expired_session_start($1)`,
      [key]
    );
    const start = await client.query(
      `insert into competition_session_starts (start_key, expires_at, created_at)
       values ($1, $2, now()) on conflict (start_key) do nothing`,
      [key, new Date(expiresAt)]
    );
    if (start.rowCount === 1) {
      const ipScope = securityStateHash(`competition-ip\0${getClientIp(input.request)}`);
      await consumePersistentCounter(client, "session_start_minute", ipScope);
      await consumePersistentCounter(client, "session_start_daily", ipScope);
    }
    return {
      ...(await claimPersistentIdempotency(
        client,
        key,
        expiresAt,
        deadlines.finalizeDeadlineEpochMs
      )),
      expiresAt
    };
  }, input.responseSignal ?? input.request.signal);
}

async function beginPersistentTransition(
  input: CompetitionControlInput & { sessionId: string },
  sessionKey: string,
  key: string,
  desiredExpiry: number
): Promise<PersistentExecutionClaim> {
  const deadlines = normalizedDeadlines(input.deadlines);
  return withTransaction(deadlines.producerDeadlineEpochMs, async (client) => {
    await maybePrunePersistentState(client);
    await client.query(
      `insert into competition_sessions (session_key, expires_at, created_at, updated_at)
       values ($1, $2, now(), now()) on conflict (session_key) do nothing`,
      [sessionKey, new Date(desiredExpiry)]
    );
    const selectedSession = await client.query<{ expires_at: Date }>(
      `select expires_at from competition_sessions where session_key = $1 for update`,
      [sessionKey]
    );
    const existingExpiry = selectedSession.rows[0]?.expires_at.getTime();
    if (existingExpiry === undefined) throw new Error("Session row disappeared while locked");
    let expiresAt = Math.min(existingExpiry, desiredExpiry);
    if (existingExpiry <= Date.now()) {
      await client.query(
        `select public.resume_ai_runtime_reset_expired_session_transitions($1)`,
        [sessionKey]
      );
      expiresAt = desiredExpiry;
    }
    await client.query(
      `update competition_sessions set expires_at = $2, updated_at = now()
        where session_key = $1`,
      [sessionKey, new Date(expiresAt)]
    );

    const existingTransition = await client.query<{ state: "pending" | "committed" }>(
      `select state from competition_session_transitions
        where session_key = $1 and transition_key = $2 for update`,
      [sessionKey, key]
    );
    const transitionWasCommitted = existingTransition.rows[0]?.state === "committed";
    if (existingTransition.rowCount !== 1) {
      const count = await client.query<{ transition_count: string }>(
        `select count(*)::text as transition_count
           from competition_session_transitions where session_key = $1`,
        [sessionKey]
      );
      if (Number(count.rows[0]?.transition_count ?? 0) >= buckets.session_transitions.limit) {
        throw new PersistentLimitError("session_transitions", expiresAt);
      }
      await client.query(
        `insert into competition_session_transitions
           (session_key, transition_key, state, expires_at, created_at, updated_at)
         values ($1, $2, 'pending', $3, now(), now())`,
        [sessionKey, key, new Date(expiresAt)]
      );
    } else {
      await client.query(
        `update competition_session_transitions
            set expires_at = least(expires_at, $3), updated_at = now()
          where session_key = $1 and transition_key = $2`,
        [sessionKey, key, new Date(expiresAt)]
      );
    }

    return {
      ...(await claimPersistentIdempotency(
        client,
        key,
        expiresAt,
        deadlines.finalizeDeadlineEpochMs
      )),
      expiresAt,
      transitionWasCommitted
    };
  }, input.responseSignal ?? input.request.signal);
}

function encryptedResponseFromRow(row: PersistentIdempotencyRow): EncryptedResponse {
  if (!row.response_ciphertext || !row.response_iv || !row.response_tag) {
    throw new Error("Persistent idempotency response is incomplete");
  }
  return {
    ciphertext: row.response_ciphertext,
    iv: row.response_iv,
    tag: row.response_tag,
    byteSize: row.response_bytes ??
      row.response_ciphertext.byteLength + row.response_iv.byteLength + row.response_tag.byteLength
  };
}

async function queryPersistentResponseBefore(
  key: string,
  deadlineEpochMs: number
) {
  const remainingMs = remainingDeadlineMs(deadlineEpochMs);
  if (remainingMs <= 0) return null;
  const query = getPool().query<PersistentIdempotencyRow>(
    `select state, generation, producer_retries, retry_kind, expires_at,
            lease_expires_at > now() as lease_active,
            response_ciphertext, response_iv, response_tag, response_bytes
       from competition_idempotency where cache_key = $1`,
    [key]
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await (async () => {
    try {
      return await Promise.race([
        query.then((result) => ({ result })),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), remainingMs);
        })
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  })();
  if (!settled) {
    void query.catch(() => undefined);
    return null;
  }
  return settled.result;
}

async function pollForPersistentResponse(
  key: string,
  generation: number,
  deadlineEpochMs: number
): Promise<PersistentResponseWaitResult> {
  let pollMs = 75;
  const deadline = deadlineEpochMs;
  while (Date.now() < deadline) {
    const result = await queryPersistentResponseBefore(key, deadline);
    if (!result) return { outcome: "timed_out" };
    const row = result.rows[0];
    if (!row || row.expires_at.getTime() <= Date.now()) return { outcome: "owner_gone" };
    if (row.generation >= generation && row.state !== "pending" && row.response_ciphertext) {
      return { outcome: "ready", row };
    }
    if (row.state === "pending" && !row.lease_active) return { outcome: "owner_gone" };
    const sleepMs = Math.min(pollMs, remainingDeadlineMs(deadline));
    if (sleepMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
    pollMs = Math.min(500, pollMs * 2);
  }
  return { outcome: "timed_out" };
}

function waitForPersistentResponse(
  key: string,
  generation: number,
  deadlines: CompetitionRequestDeadlines
) {
  const existing = persistentResponseWaits.get(key);
  if (existing?.generation === generation) return existing.promise;
  if (persistentResponseWaits.size >= memoryLimits().inFlight) {
    return Promise.resolve({ outcome: "timed_out" } as const);
  }

  const promise = pollForPersistentResponse(
    key,
    generation,
    deadlines.duplicateWaitDeadlineEpochMs
  ).finally(() => {
    const current = persistentResponseWaits.get(key);
    if (current?.promise === promise) persistentResponseWaits.delete(key);
  });
  persistentResponseWaits.set(key, { generation, promise });
  return promise;
}

function startIdempotencyHeartbeat(
  key: string,
  ownerToken: string,
  ownerDeadlineEpochMs: number
) {
  const timer = setInterval(() => {
    if (deadlineHasElapsed(ownerDeadlineEpochMs)) return;
    void getPool().query(
      `update competition_idempotency
          set lease_expires_at = least(
                $3::timestamptz,
                now() + ($4::bigint * interval '1 millisecond')
              ),
              updated_at = now()
        where cache_key = $1 and owner_token = $2::uuid and state = 'pending'`,
      [key, ownerToken, new Date(ownerDeadlineEpochMs), IDEMPOTENCY_LEASE_MS]
    ).catch(() => {
      console.error(JSON.stringify({ event: "competition_idempotency_heartbeat_failed" }));
    });
  }, IDEMPOTENCY_HEARTBEAT_MS);
  timer.unref?.();
  return timer;
}

async function finalizePersistentExecution(
  key: string,
  claim: Extract<PersistentExecutionClaim, { action: "produce" }>,
  response: Response,
  encrypted: EncryptedResponse,
  deadlines: CompetitionRequestDeadlines,
  transition?: { sessionKey: string; wasCommitted: boolean }
) {
  const cacheable = response.ok && response.headers.get("X-Idempotency-Cache") !== "no-store";
  const retryKind = cacheable ? null : response.ok ? "no_store" : "failure";
  await withTransaction(deadlines.finalizeDeadlineEpochMs, async (client) => {
    if (transition) {
      if (response.ok) {
        const committed = await client.query(
          `update competition_session_transitions set state = 'committed', updated_at = now()
            where session_key = $1 and transition_key = $2`,
          [transition.sessionKey, key]
        );
        if (committed.rowCount !== 1) {
          throw new Error("Persistent transition reservation was lost");
        }
      } else if (!transition.wasCommitted) {
        await client.query(
          `select public.resume_ai_runtime_delete_pending_transition($1, $2)`,
          [transition.sessionKey, key]
        );
      }
    }
    const updated = await client.query(
      `update competition_idempotency
          set state = $3, owner_token = null, lease_expires_at = null,
              retry_kind = $4, response_ciphertext = $5,
              response_iv = $6, response_tag = $7, response_bytes = $8,
              updated_at = now()
        where cache_key = $1 and owner_token = $2::uuid and state = 'pending'`,
      [
        key,
        claim.ownerToken,
        cacheable ? "completed" : "retryable",
        retryKind,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.tag,
        encrypted.byteSize
      ]
    );
    if (updated.rowCount !== 1) throw new Error("Persistent idempotency ownership was lost");
  });
}

async function abandonPersistentExecution(
  key: string,
  claim: Extract<PersistentExecutionClaim, { action: "produce" }>,
  deadlines: CompetitionRequestDeadlines,
  transition?: { sessionKey: string; wasCommitted: boolean }
) {
  await withTransaction(deadlines.finalizeDeadlineEpochMs, async (client) => {
    if (transition && !transition.wasCommitted) {
      await client.query(
        `select public.resume_ai_runtime_delete_pending_transition($1, $2)`,
        [transition.sessionKey, key]
      );
    }
    const updated = await client.query(
      `update competition_idempotency
          set state = 'retryable', owner_token = null, lease_expires_at = null,
              retry_kind = 'failure', response_ciphertext = null,
              response_iv = null, response_tag = null, response_bytes = null,
              updated_at = now()
        where cache_key = $1 and owner_token = $2::uuid and state = 'pending'`,
      [key, claim.ownerToken]
    );
    if (updated.rowCount !== 1) throw new Error("Persistent idempotency ownership was lost");
  });
}

async function executePersistentClaim(
  input: CompetitionControlInput,
  key: string,
  claim: PersistentExecutionClaim,
  bucket: "session_start_minute" | "session_transitions",
  transition?: { sessionKey: string; wasCommitted: boolean }
) {
  if (claim.action === "retry_exhausted") {
    return rateLimitResponse(claim.resetAt, {
      bucket: "transition_retries",
      operation: input.operation,
      request: input.request,
      requestId: input.requestId,
      sessionId: input.sessionId
    });
  }
  if (claim.action === "replay") {
    try {
      return cloneForReplay(
        decryptResponse(encryptedResponseFromRow(claim.row), key, claim.row.generation),
        input.requestId,
        true
      );
    } catch {
      return securityStateUnavailableResponse(input, bucket);
    }
  }
  if (claim.action === "wait") {
    try {
      const deadlines = normalizedDeadlines(input.deadlines);
      const callerWait = await waitForCallerBeforeDeadline(
        waitForPersistentResponse(key, claim.generation, deadlines),
        deadlines.duplicateWaitDeadlineEpochMs,
        input.responseSignal ?? input.request.signal
      );
      if (!callerWait.settled) return requestInProgressResponse(input);
      const wait = callerWait.value;
      if (wait.outcome === "timed_out") return requestInProgressResponse(input);
      if (wait.outcome === "owner_gone") {
        return securityStateUnavailableResponse(input, bucket);
      }
      return cloneForReplay(
        decryptResponse(
          encryptedResponseFromRow(wait.row),
          key,
          wait.row.generation
        ),
        input.requestId,
        true
      );
    } catch {
      return securityStateUnavailableResponse(input, bucket);
    }
  }

  const deadlines = normalizedDeadlines(input.deadlines);
  const responseSignal = input.responseSignal ?? input.request.signal;
  const heartbeat = startIdempotencyHeartbeat(
    key,
    claim.ownerToken,
    deadlines.finalizeDeadlineEpochMs
  );
  let response: Response;
  if (deadlineHasElapsed(deadlines.producerDeadlineEpochMs) || responseSignal.aborted) {
    clearInterval(heartbeat);
    try {
      await abandonPersistentExecution(key, claim, deadlines, transition);
    } catch {
      console.error(JSON.stringify({ event: "competition_idempotency_abandon_failed" }));
    }
    return securityStateUnavailableResponse(input, bucket);
  }
  const deadlineSignal = createDeadlineSignal(
    deadlines.producerDeadlineEpochMs,
    responseSignal
  );
  try {
    response = withRequestId(await awaitBeforeCompetitionDeadline(
      input.producer({ deadlines, signal: deadlineSignal.signal }),
      deadlines.producerDeadlineEpochMs,
      deadlineSignal.signal
    ), input.requestId);
  } catch (error) {
    clearInterval(heartbeat);
    try {
      await abandonPersistentExecution(key, claim, deadlines, transition);
    } catch {
      console.error(JSON.stringify({ event: "competition_idempotency_abandon_failed" }));
    }
    if (error instanceof CompetitionDeadlineError) {
      return securityStateUnavailableResponse(input, bucket);
    }
    throw error;
  } finally {
    deadlineSignal.dispose();
  }
  clearInterval(heartbeat);
  let encrypted: EncryptedResponse;
  try {
    const buffered = await encryptResponse(
      response,
      key,
      claim.generation,
      deadlines.finalizeDeadlineEpochMs,
      responseSignal
    );
    encrypted = buffered.encrypted;
    response = buffered.replayableResponse;
  } catch {
    try {
      await abandonPersistentExecution(key, claim, deadlines, transition);
    } catch {
      console.error(JSON.stringify({ event: "competition_idempotency_abandon_failed" }));
    }
    return securityStateUnavailableResponse(input, bucket);
  }
  try {
    await finalizePersistentExecution(
      key,
      claim,
      response,
      encrypted,
      deadlines,
      transition
    );
  } catch {
    return securityStateUnavailableResponse(input, bucket);
  }
  if (response.ok && response.headers.get("X-Idempotency-Cache") !== "no-store") {
    await notifyOwnerCommitted(input, response, deadlines);
  }
  return cloneForReplay(response, input.requestId, false);
}

function memorySessionStart(input: CompetitionControlInput, key: string, expiresAt: number) {
  const now = Date.now();
  pruneExpiredMemory(now);
  const knownExecution = cachedTransitions.has(key) ||
    uncachedRetries.has(key) || inFlightTransitions.has(key);
  if (!knownExecution) {
    const priorStartExpiry = startedSessionKeys.get(key);
    if (!priorStartExpiry || priorStartExpiry <= now) {
      if (!hasMemoryCapacity("starts", startedSessionKeys.size)) {
        return Promise.resolve(securityStateUnavailableResponse(input, "session_start_minute"));
      }
      const minute = checkRateLimit(input.request, "session_start_minute");
      if (!minute.ok) {
        if (minute.stateUnavailable) {
          return Promise.resolve(securityStateUnavailableResponse(input, "session_start_minute"));
        }
        return Promise.resolve(rateLimitResponse(minute.resetAt, {
          bucket: "session_start_minute",
          operation: input.operation,
          request: input.request,
          requestId: input.requestId
        }));
      }
      const daily = checkRateLimit(input.request, "session_start_daily");
      if (!daily.ok) {
        if (daily.stateUnavailable) {
          return Promise.resolve(securityStateUnavailableResponse(input, "session_start_daily"));
        }
        return Promise.resolve(rateLimitResponse(daily.resetAt, {
          bucket: "session_start_daily",
          operation: input.operation,
          request: input.request,
          requestId: input.requestId
        }));
      }
      startedSessionKeys.set(key, expiresAt);
    }
  }
  return executeMemoryIdempotently(input, key, expiresAt);
}

type CompetitionSessionStartInput = {
  request: Request;
  requestId: string;
  operation: string;
  transitionId: string;
  deadlines?: CompetitionRequestDeadlines;
  producer: (context: CompetitionProducerContext) => Promise<Response>;
  onOwnerCommitted?: (context: CompetitionOwnerCommittedContext) => Promise<void>;
};

type CompetitionSessionTransitionInput = CompetitionSessionStartInput & {
  sessionId: string;
  sessionExpiresAtEpochSeconds?: number;
};

async function executeCompetitionSessionStartInternal(
  input: CompetitionSessionStartInput & {
    deadlines: CompetitionRequestDeadlines;
    responseSignal: AbortSignal;
  }
) {
  const suppliedKey = input.request.headers.get("idempotency-key")?.trim();
  const clientKey = suppliedKey && IDEMPOTENCY_KEY_PATTERN.test(suppliedKey)
    ? suppliedKey
    : input.requestId;
  const ipScope = securityStateHash(`competition-start\0${getClientIp(input.request)}`);
  const key = replayKey(ipScope, input.operation, hashValue(`${clientKey}\0${input.transitionId}`));
  const expiresAt = Date.now() + buckets.session_transitions.windowMs;
  let response: Response;

  if (persistentSecurityStateRequired()) {
    if (!isDatabaseConfigured() || !encryptionKey()) {
      response = securityStateUnavailableResponse(input, "session_start_minute");
    } else {
      try {
        const claim = await beginPersistentStart(input, key, expiresAt);
        response = await executePersistentClaim(input, key, claim, "session_start_minute");
      } catch (error) {
        response = error instanceof PersistentLimitError
          ? rateLimitResponse(error.resetAt, {
              bucket: error.bucket,
              operation: input.operation,
              request: input.request,
              requestId: input.requestId
            })
          : securityStateUnavailableResponse(input, "session_start_minute");
      }
    }
  } else {
    response = await memorySessionStart(input, key, expiresAt);
  }
  logCompetitionRequestOutcome({ ...input, bucket: "session_start", response });
  return response;
}

async function executeCompetitionSessionTransitionInternal(
  input: CompetitionSessionTransitionInput & {
    deadlines: CompetitionRequestDeadlines;
    responseSignal: AbortSignal;
  }
) {
  const now = Date.now();
  const signedExpiry = input.sessionExpiresAtEpochSeconds === undefined
    ? now + buckets.session_transitions.windowMs
    : input.sessionExpiresAtEpochSeconds * 1000;
  const desiredExpiry = signedExpiry;
  if (
    !Number.isFinite(desiredExpiry) || desiredExpiry <= now ||
    (input.sessionExpiresAtEpochSeconds !== undefined &&
      desiredExpiry > now + MAX_SIGNED_SESSION_REMAINING_MS)
  ) {
    const response = rateLimitResponse(now + 1_000, {
      bucket: "session_transitions",
      operation: input.operation,
      request: input.request,
      requestId: input.requestId,
      sessionId: input.sessionId
    });
    logCompetitionRequestOutcome({ ...input, bucket: "session_transitions", response });
    return response;
  }

  const sessionKey = securityStateHash(`competition-session\0${input.sessionId}`);
  const key = replayKey(sessionKey, input.operation, input.transitionId);
  let response: Response;
  if (persistentSecurityStateRequired()) {
    if (!isDatabaseConfigured() || !encryptionKey()) {
      response = securityStateUnavailableResponse(input, "session_transitions");
    } else {
      try {
        const claim = await beginPersistentTransition(input, sessionKey, key, desiredExpiry);
        response = await executePersistentClaim(
          input,
          key,
          claim,
          "session_transitions",
          { sessionKey, wasCommitted: claim.transitionWasCommitted ?? false }
        );
      } catch (error) {
        response = error instanceof PersistentLimitError
          ? rateLimitResponse(error.resetAt, {
              bucket: error.bucket,
              operation: input.operation,
              request: input.request,
              requestId: input.requestId,
              sessionId: input.sessionId
            })
          : securityStateUnavailableResponse(input, "session_transitions");
      }
    }
  } else {
    pruneExpiredMemory(now);
    let session = sessions.get(sessionKey);
    if (!session || session.expiresAt <= now) {
      if (!hasMemoryCapacity("sessions", sessions.size)) {
        response = securityStateUnavailableResponse(input, "session_transitions");
        logCompetitionRequestOutcome({ ...input, bucket: "session_transitions", response });
        return response;
      }
      session = {
        committedTransitions: new Set<string>(),
        pendingTransitions: new Set<string>(),
        expiresAt: desiredExpiry
      };
      sessions.set(sessionKey, session);
    } else {
      session.expiresAt = Math.min(session.expiresAt, desiredExpiry);
    }

    const wasCommitted = session.committedTransitions.has(key);
    const knownTransition = wasCommitted || session.pendingTransitions.has(key);
    if (
      !knownTransition &&
      session.committedTransitions.size + session.pendingTransitions.size >=
        buckets.session_transitions.limit
    ) {
      response = rateLimitResponse(session.expiresAt, {
        bucket: "session_transitions",
        operation: input.operation,
        request: input.request,
        requestId: input.requestId,
        sessionId: input.sessionId
      });
    } else {
      session.pendingTransitions.add(key);
      response = await executeMemoryIdempotently(
        input,
        key,
        session.expiresAt,
        () => {
          session!.pendingTransitions.delete(key);
          session!.committedTransitions.add(key);
        },
        () => {
          session!.pendingTransitions.delete(key);
          if (!wasCommitted) session!.committedTransitions.delete(key);
        }
      );
    }
  }

  logCompetitionRequestOutcome({ ...input, bucket: "session_transitions", response });
  return response;
}

async function executeWithinResponseDeadline(
  input: CompetitionSessionStartInput & { sessionId?: string },
  bucket: "session_start_minute" | "session_transitions",
  work: (
    deadlines: CompetitionRequestDeadlines,
    responseSignal: AbortSignal
  ) => Promise<Response>
) {
  const deadlines = normalizedDeadlines(input.deadlines);
  const responseGuard = createDeadlineSignal(
    deadlines.responseDeadlineEpochMs,
    input.request.signal
  );
  try {
    if (responseGuard.signal.aborted) {
      return securityStateUnavailableResponse(input, bucket);
    }
    return await awaitBeforeCompetitionDeadline(
      work(deadlines, responseGuard.signal),
      deadlines.responseDeadlineEpochMs,
      responseGuard.signal
    );
  } catch (error) {
    if (error instanceof CompetitionDeadlineError) {
      return securityStateUnavailableResponse(input, bucket);
    }
    throw error;
  } finally {
    responseGuard.dispose();
  }
}

export function executeCompetitionSessionStart(input: CompetitionSessionStartInput) {
  return executeWithinResponseDeadline(
    input,
    "session_start_minute",
    (deadlines, responseSignal) => executeCompetitionSessionStartInternal({
      ...input,
      deadlines,
      responseSignal
    })
  );
}

export function executeCompetitionSessionTransition(
  input: CompetitionSessionTransitionInput
) {
  return executeWithinResponseDeadline(
    input,
    "session_transitions",
    (deadlines, responseSignal) => executeCompetitionSessionTransitionInternal({
      ...input,
      deadlines,
      responseSignal
    })
  );
}

export function resetRateLimitStateForTests() {
  if (process.env.NODE_ENV !== "test") return;
  hits.clear();
  sessions.clear();
  startedSessionKeys.clear();
  cachedTransitions.clear();
  uncachedRetries.clear();
  inFlightTransitions.clear();
  persistentResponseWaits.clear();
  cachedTransitionBytes = 0;
  lastMemoryPruneAt = 0;
  lastPersistentPruneAt = 0;
}

export function rateLimitStateSnapshotForTests() {
  if (process.env.NODE_ENV !== "test") return null;
  return {
    hits: hits.size,
    sessions: sessions.size,
    starts: startedSessionKeys.size,
    cached: cachedTransitions.size,
    retryStates: uncachedRetries.size,
    inFlight: inFlightTransitions.size,
    cachedBytes: cachedTransitionBytes
  };
}

export function rejectLargeRequest(request: Request, maxBytes: number) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    return NextResponse.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }
  return null;
}
