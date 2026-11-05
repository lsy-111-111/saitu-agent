import { createHmac } from "node:crypto";
import {
  acquireModelCallPermit,
  type ModelCallGateFailureReason
} from "@/lib/ai/model-call-governor";

export type AiJsonFailureReason =
  | "missing_api_key"
  | "mock_mode"
  | "mock_not_allowed"
  | "provider_not_allowed"
  | "authentication_error"
  | "insufficient_balance"
  | "invalid_request"
  | "rate_limited"
  | "upstream_server_error"
  | "api_error"
  | "response_too_large"
  | "invalid_json"
  | "invalid_output"
  | "empty_content"
  | "truncated"
  | "network_error"
  | "timeout"
  | ModelCallGateFailureReason;

export type TransientAiFailureReason = Extract<
  AiJsonFailureReason,
  "rate_limited" | "upstream_server_error" | "network_error" | "timeout"
>;

export type AiJsonResult<T> =
  | {
      ok: true;
      data: T;
      model: string;
      finishReason: string | null;
      attempts: number;
      httpStatus: number;
      upstreamAttempted: true;
      requestId?: string;
      durationMs: number;
    }
  | {
      ok: false;
      reason: AiJsonFailureReason;
      model: string;
      finishReason?: string | null;
      httpStatus?: number;
      requestId?: string;
      durationMs?: number;
      attempts?: number;
      retryAfterMs?: number;
      upstreamAttempted: boolean;
    };

export type AiTextStreamResult =
  | {
      ok: true;
      stream: ReadableStream<Uint8Array>;
      model: string;
      upstreamAttempted: true;
    }
  | {
      ok: false;
      reason: AiJsonFailureReason;
      model: string;
      httpStatus?: number;
      requestId?: string;
      durationMs?: number;
      upstreamAttempted: boolean;
    };

type JsonRecord = Record<string, unknown>;

type AiOutputSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

export type RequestAiJsonOptions<T> = {
  apiKey?: string;
  apiUrl?: string;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  requestDeadlineMs?: number;
  deadlineEpochMs?: number;
  signal?: AbortSignal;
  maxAttempts?: 1 | 2 | 3;
  schema?: AiOutputSchema<T>;
  thinking?: "disabled" | "enabled";
  operation?: string;
  promptVersion?: string;
  candidateCount?: number;
  retryBaseDelayMs?: number;
  retryInstruction?: string;
};

const defaultApiUrl = "https://api.openai.com/v1/chat/completions";
const deepseekApiUrl = "https://api.deepseek.com/chat/completions";
const defaultTimeoutMs = 12000;
export const DEFAULT_AI_REQUEST_DEADLINE_MS = 45_000;
const MIN_AI_ATTEMPT_WINDOW_MS = 5_000;
export const AI_JSON_MAX_RESPONSE_BYTES = 256 * 1024;
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";

function getTimeoutMs() {
  const timeout = Number(process.env.AI_TIMEOUT_MS);
  return Number.isFinite(timeout) && timeout > 1000 ? timeout : defaultTimeoutMs;
}

function getRequestDeadlineMs<T>(options: RequestAiJsonOptions<T>) {
  if (Number.isFinite(options.requestDeadlineMs) && Number(options.requestDeadlineMs) > 0) {
    return Math.floor(Number(options.requestDeadlineMs));
  }
  const configured = Number(process.env.AI_REQUEST_DEADLINE_MS);
  return Number.isFinite(configured) && configured > 1_000
    ? Math.floor(configured)
    : DEFAULT_AI_REQUEST_DEADLINE_MS;
}

export function getConfiguredAiProvider() {
  return process.env.AI_PROVIDER?.trim().toLowerCase() || "openai-compatible";
}

export function isAiMockAllowed() {
  return process.env.ALLOW_AI_MOCK === "1" && process.env.AI_TEST_MODE === "1";
}

/**
 * Competition consent names DeepSeek as the third-party recipient, so every
 * competition-specific model call must fail closed for any other provider.
 * Mock mode is available only behind both explicit test flags.
 */
export function getCompetitionAiProviderFailureReason(
  provider = getConfiguredAiProvider()
): Extract<AiJsonFailureReason, "mock_not_allowed" | "provider_not_allowed"> | null {
  if (provider === "deepseek") return null;
  if (provider === "mock") return isAiMockAllowed() ? null : "mock_not_allowed";
  return "provider_not_allowed";
}

export function getConfiguredAiModel(fallback = DEFAULT_DEEPSEEK_MODEL) {
  return process.env.AI_MODEL?.trim() || fallback;
}

function getApiUrl() {
  const configuredUrl = process.env.AI_API_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  const provider = getConfiguredAiProvider().toLowerCase();
  if (provider === "deepseek") {
    return deepseekApiUrl;
  }

  return defaultApiUrl;
}

function isAllowedDeepSeekChatUrl(value: string) {
  // The product consent names DeepSeek as the recipient. Keep this exact, not
  // merely origin-based, so a compromised or mistyped environment cannot send
  // questionnaire content to an unrelated endpoint on a shared host.
  return value === deepseekApiUrl;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function getChoice(payload: JsonRecord) {
  const choices = payload.choices;
  if (Array.isArray(choices)) {
    const firstChoice = asRecord(choices[0]);
    const message = asRecord(firstChoice?.message);
    return {
      content: message?.content,
      finishReason: typeof firstChoice?.finish_reason === "string" ? firstChoice.finish_reason : null
    };
  }

  if (typeof payload.output_text === "string") {
    return { content: payload.output_text, finishReason: null };
  }

  if (typeof payload.content === "string") {
    return { content: payload.content, finishReason: null };
  }

  return { content: undefined, finishReason: null };
}

function normalizeJsonContent(content: string) {
  let normalized = content.replace(/^\uFEFF/, "").trim();
  const fenced = normalized.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  if (fenced) {
    normalized = fenced[1].trim();
  }
  return normalized;
}

export function parseAiJson<T>(content: unknown): T | null {
  if (typeof content === "string") {
    try {
      return JSON.parse(normalizeJsonContent(content)) as T;
    } catch {
      return null;
    }
  }

  if (content && typeof content === "object") {
    return content as T;
  }

  return null;
}

function failureReasonForHttpStatus(status: number): AiJsonFailureReason {
  if (status === 401) return "authentication_error";
  if (status === 402) return "insufficient_balance";
  if (status === 400 || status === 422) return "invalid_request";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "upstream_server_error";
  return "api_error";
}

export function isTransientAiFailureReason(reason: unknown): reason is TransientAiFailureReason {
  return (
    reason === "rate_limited" ||
    reason === "upstream_server_error" ||
    reason === "network_error" ||
    reason === "timeout"
  );
}

function isRetryableAiFailure(reason: AiJsonFailureReason) {
  return (
    isTransientAiFailureReason(reason) ||
    reason === "invalid_json" ||
    reason === "invalid_output" ||
    reason === "empty_content" ||
    reason === "truncated"
  );
}

function getResponseRequestId(response: Response, apiKey: string) {
  const rawRequestId =
    response.headers.get("x-request-id")?.trim() || response.headers.get("request-id")?.trim();
  if (!rawRequestId) return undefined;

  const digest = createHmac("sha256", apiKey)
    .update("ai-upstream-request-id\0")
    .update(rawRequestId)
    .digest("hex")
    .slice(0, 16);
  return `ai_req_${digest}`;
}

type BoundedJsonReadResult =
  | { ok: true; payload: unknown }
  | { ok: false; reason: "response_too_large" | "invalid_json" };

function hasOversizedDeclaredLength(response: Response) {
  const rawLength = response.headers.get("content-length")?.trim();
  if (!rawLength || !/^\d+$/.test(rawLength)) return false;

  const declaredLength = Number(rawLength);
  return !Number.isSafeInteger(declaredLength) || declaredLength > AI_JSON_MAX_RESPONSE_BYTES;
}

async function cancelResponseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The body may already be aborted or locked; the response is discarded either way.
  }
}

async function readBoundedJsonResponse(response: Response): Promise<BoundedJsonReadResult> {
  if (hasOversizedDeclaredLength(response)) {
    await cancelResponseBody(response);
    return { ok: false, reason: "response_too_large" };
  }
  if (!response.body) {
    return { ok: false, reason: "invalid_json" };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > AI_JSON_MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The size violation is already definitive even if cancellation races an abort.
        }
        return { ok: false, reason: "response_too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, payload: JSON.parse(jsonText) as unknown };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

function getDurationMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

function getRetryAfterMs(response: Response) {
  const header = response.headers.get("retry-after")?.trim();
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const retryAt = Date.parse(header);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : undefined;
}

function getRetryMaxDelayMs() {
  const configured = Number(process.env.AI_RETRY_MAX_DELAY_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : 5000;
}

function retryDelayMs<T>(result: Exclude<AiJsonResult<T>, { ok: true }>, options: RequestAiJsonOptions<T>) {
  if (result.retryAfterMs !== undefined) {
    return result.retryAfterMs;
  }
  if (isTransientAiFailureReason(result.reason)) {
    return Math.max(0, options.retryBaseDelayMs ?? 150);
  }
  return 0;
}

async function waitBeforeRetry(
  delayMs: number,
  deadlineEpochMs = Number.POSITIVE_INFINITY,
  signal?: AbortSignal
) {
  if (signal?.aborted || Date.now() >= deadlineEpochMs) return false;
  if (delayMs <= 0) return true;
  if (delayMs > deadlineEpochMs - Date.now()) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const completed = await Promise.race([
      new Promise<true>((resolve) => {
        timer = windowlessSetTimeout(() => resolve(true), delayMs);
      }),
      new Promise<false>((resolve) => {
        abort = () => resolve(false);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      })
    ]);
    return completed && !signal?.aborted && Date.now() < deadlineEpochMs;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

export async function waitForAiRetry<T>(
  result: AiJsonResult<T>,
  options: RequestAiJsonOptions<T> = {}
) {
  if (result.ok) return false;
  const delayMs = retryDelayMs(result, options);
  if (delayMs > getRetryMaxDelayMs()) return false;
  const relativeDeadline = Date.now() + getRequestDeadlineMs(options);
  const deadline = Number.isFinite(options.deadlineEpochMs)
    ? Math.min(relativeDeadline, Math.floor(Number(options.deadlineEpochMs)))
    : relativeDeadline;
  return waitBeforeRetry(delayMs, deadline, options.signal);
}

function logAiAttempt<T>(
  result: AiJsonResult<T>,
  context: Pick<RequestAiJsonOptions<T>, "operation" | "promptVersion" | "candidateCount"> & {
    provider: string;
    attempt: number;
  }
) {
  if (context.provider === "mock") return;

  const entry = JSON.stringify({
    event: "ai_upstream_attempt",
    operation: context.operation ?? "unspecified",
    provider: context.provider,
    model: result.model,
    promptVersion: context.promptVersion,
    attempt: context.attempt,
    durationMs: result.durationMs,
    httpStatus: result.httpStatus,
    requestId: result.requestId,
    finishReason: result.finishReason,
    fallbackReason: result.ok ? undefined : result.reason,
    candidateCount: context.candidateCount,
    outcome: result.ok ? "success" : "failure"
  });
  if (result.ok) {
    console.info(entry);
  } else {
    console.warn(entry);
  }
}

async function requestAiJsonOnce<T>(
  prompt: string,
  options: RequestAiJsonOptions<T>,
  attempt: number,
  deadline: number
): Promise<AiJsonResult<T>> {
  const startedAt = Date.now();
  const provider = getConfiguredAiProvider();
  const apiKey = options.apiKey?.trim() || process.env.AI_API_KEY?.trim();
  const model = options.model?.trim() || getConfiguredAiModel();

  if (provider === "mock") {
    return {
      ok: false,
      upstreamAttempted: false,
      reason: isAiMockAllowed() ? "mock_mode" : "mock_not_allowed",
      model: "mock",
      durationMs: getDurationMs(startedAt),
      attempts: attempt
    };
  }
  const apiUrl = options.apiUrl?.trim() || getApiUrl();
  if (provider !== "deepseek" || !isAllowedDeepSeekChatUrl(apiUrl)) {
    return {
      ok: false,
      upstreamAttempted: false,
      reason: "provider_not_allowed",
      model,
      durationMs: getDurationMs(startedAt),
      attempts: attempt
    };
  }
  if (!apiKey) {
    return {
      ok: false,
      upstreamAttempted: false,
      reason: "missing_api_key",
      model,
      durationMs: getDurationMs(startedAt),
      attempts: attempt
    };
  }

  const remainingBeforeQueue = deadline - Date.now();
  if (remainingBeforeQueue < MIN_AI_ATTEMPT_WINDOW_MS || options.signal?.aborted) {
    return {
      ok: false,
      upstreamAttempted: false,
      reason: "timeout",
      model,
      durationMs: getDurationMs(startedAt),
      attempts: attempt
    };
  }

  const gate = await acquireModelCallPermit({
    maxWaitMs: remainingBeforeQueue - MIN_AI_ATTEMPT_WINDOW_MS,
    deadlineEpochMs: deadline,
    signal: options.signal
  });
  if (!gate.ok) {
    return {
      ok: false,
      upstreamAttempted: false,
      reason: options.signal?.aborted ? "timeout" : gate.reason,
      model,
      durationMs: getDurationMs(startedAt),
      attempts: attempt
    };
  }

  const remainingBeforeFetch = deadline - Date.now();
  if (remainingBeforeFetch < MIN_AI_ATTEMPT_WINDOW_MS || options.signal?.aborted) {
    gate.permit.release();
    return {
      ok: false,
      upstreamAttempted: false,
      reason: "timeout",
      model,
      durationMs: getDurationMs(startedAt),
      attempts: attempt
    };
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeoutId = windowlessSetTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(options.timeoutMs ?? getTimeoutMs(), remainingBeforeFetch))
  );

  try {
    const body: JsonRecord = {
      model,
      messages: [
        {
          role: "system",
          content: options.systemPrompt ?? "You return only valid JSON. Do not invent facts not present in the user input."
        },
        {
          role: "user",
          content:
            attempt === 1
              ? prompt
              : `${prompt}\n\nCorrection: the previous response was unusable. Return one complete JSON object only, with no commentary.${
                  options.retryInstruction ? ` ${options.retryInstruction}` : ""
                }`
        }
      ],
      temperature: options.temperature ?? 0,
      response_format: {
        type: "json_object"
      }
    };

    if (options.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens;
    }
    if (options.thinking !== undefined) {
      body.thinking = { type: options.thinking };
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const requestId = getResponseRequestId(response, apiKey);

    if (!response.ok) {
      const retryAfterMs = getRetryAfterMs(response);
      await cancelResponseBody(response);
      return {
        ok: false,
        upstreamAttempted: true,
        reason: failureReasonForHttpStatus(response.status),
        model,
        httpStatus: response.status,
        requestId,
        durationMs: getDurationMs(startedAt),
        attempts: attempt,
        retryAfterMs
      };
    }

    const boundedJson = await readBoundedJsonResponse(response);
    if (!boundedJson.ok) {
      return {
        ok: false,
        upstreamAttempted: true,
        reason: boundedJson.reason,
        model,
        httpStatus: response.status,
        requestId,
        durationMs: getDurationMs(startedAt),
        attempts: attempt
      };
    }
    const payload = asRecord(boundedJson.payload);
    if (!payload) {
      return {
        ok: false,
        upstreamAttempted: true,
        reason: "invalid_json",
        model,
        httpStatus: response.status,
        requestId,
        durationMs: getDurationMs(startedAt),
        attempts: attempt
      };
    }

    const choice = getChoice(payload);
    if (choice.finishReason === "length") {
      return {
        ok: false,
        upstreamAttempted: true,
        reason: "truncated",
        model,
        finishReason: choice.finishReason,
        httpStatus: response.status,
        requestId,
        durationMs: getDurationMs(startedAt),
        attempts: attempt
      };
    }
    if (choice.finishReason !== null && choice.finishReason !== "stop") {
      return {
        ok: false,
        upstreamAttempted: true,
        reason: "api_error",
        model,
        finishReason: choice.finishReason,
        httpStatus: response.status,
        requestId,
        durationMs: getDurationMs(startedAt),
        attempts: attempt
      };
    }
    if (choice.content === null || choice.content === undefined) {
      return {
        ok: false,
        upstreamAttempted: true,
        reason: "empty_content",
        model,
        finishReason: choice.finishReason,
        httpStatus: response.status,
        requestId,
        durationMs: getDurationMs(startedAt),
        attempts: attempt
      };
    }
    if (typeof choice.content === "string" && !choice.content.trim()) {
      return {
        ok: false,
        upstreamAttempted: true,
        reason: "empty_content",
        model,
        finishReason: choice.finishReason,
        httpStatus: response.status,
        requestId,
        durationMs: getDurationMs(startedAt),
        attempts: attempt
      };
    }

    const parsedContent = parseAiJson<unknown>(choice.content);
    if (parsedContent === null) {
      return {
        ok: false,
        upstreamAttempted: true,
        reason: "invalid_json",
        model,
        finishReason: choice.finishReason,
        httpStatus: response.status,
        requestId,
        durationMs: getDurationMs(startedAt),
        attempts: attempt
      };
    }

    if (options.schema) {
      const validated = options.schema.safeParse(parsedContent);
      if (!validated.success) {
        return {
          ok: false,
          upstreamAttempted: true,
          reason: "invalid_output",
          model,
          finishReason: choice.finishReason,
          httpStatus: response.status,
          requestId,
          durationMs: getDurationMs(startedAt),
          attempts: attempt
        };
      }
      return {
        ok: true,
        upstreamAttempted: true,
        data: validated.data,
        model,
        finishReason: choice.finishReason,
        attempts: attempt,
        httpStatus: response.status,
        requestId,
        durationMs: getDurationMs(startedAt)
      };
    }

    return {
      ok: true,
      upstreamAttempted: true,
      data: parsedContent as T,
      model,
      finishReason: choice.finishReason,
      attempts: attempt,
      httpStatus: response.status,
      requestId,
      durationMs: getDurationMs(startedAt)
    };
  } catch (error) {
    return {
      ok: false,
      upstreamAttempted: true,
      reason: error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error",
      model,
      durationMs: getDurationMs(startedAt),
      attempts: attempt
    };
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromCaller);
    gate.permit.release();
  }
}

export async function requestAiJson<T>(prompt: string, options: RequestAiJsonOptions<T> = {}): Promise<AiJsonResult<T>> {
  const maxAttempts = options.maxAttempts ?? 1;
  const provider = getConfiguredAiProvider();
  const relativeDeadline = Date.now() + getRequestDeadlineMs(options);
  const deadline = Number.isFinite(options.deadlineEpochMs)
    ? Math.min(relativeDeadline, Math.floor(Number(options.deadlineEpochMs)))
    : relativeDeadline;
  let result = await requestAiJsonOnce(prompt, options, 1, deadline);
  logAiAttempt(result, { ...options, provider, attempt: 1 });

  for (let attempt = 2; attempt <= maxAttempts && !result.ok; attempt += 1) {
    const remainingBeforeRetry = deadline - Date.now();
    if (!isRetryableAiFailure(result.reason) || remainingBeforeRetry <= 0) {
      break;
    }
    const retryWaitMs = retryDelayMs(result, options);
    if (
      retryWaitMs > getRetryMaxDelayMs() ||
      retryWaitMs + MIN_AI_ATTEMPT_WINDOW_MS > remainingBeforeRetry
    ) {
      break;
    }
    if (!await waitBeforeRetry(retryWaitMs, deadline, options.signal)) break;
    result = await requestAiJsonOnce(prompt, options, attempt, deadline);
    logAiAttempt(result, { ...options, provider, attempt });
  }

  return result;
}

export async function requestAiTextStream(
  prompt: string,
  systemPrompt = "You are a careful university competition matching assistant.",
  options: { signal?: AbortSignal; timeoutMs?: number; deadlineEpochMs?: number } = {}
): Promise<AiTextStreamResult> {
  const startedAt = Date.now();
  const provider = getConfiguredAiProvider();
  const apiKey = process.env.AI_API_KEY?.trim();
  const model = getConfiguredAiModel();

  if (provider === "mock" || !apiKey) {
    const failure = {
      ok: false as const,
      upstreamAttempted: false,
      reason: (provider === "mock"
        ? isAiMockAllowed()
          ? "mock_mode"
          : "mock_not_allowed"
        : "missing_api_key") as AiJsonFailureReason,
      model: provider === "mock" ? "mock" : model,
      durationMs: getDurationMs(startedAt)
    };
    logAiAttempt(failure, { provider, attempt: 1 });
    return failure;
  }

  const apiUrl = getApiUrl();
  if (provider !== "deepseek" || !isAllowedDeepSeekChatUrl(apiUrl)) {
    const failure = {
      ok: false as const,
      upstreamAttempted: false,
      reason: "provider_not_allowed" as const,
      model,
      durationMs: getDurationMs(startedAt)
    };
    logAiAttempt(failure, { provider, attempt: 1 });
    return failure;
  }

  const timeoutMs = options.timeoutMs ?? getTimeoutMs();
  const relativeDeadline = Date.now() + timeoutMs;
  const deadline = Number.isFinite(options.deadlineEpochMs)
    ? Math.min(relativeDeadline, Math.floor(Number(options.deadlineEpochMs)))
    : relativeDeadline;
  const remainingBeforeQueue = deadline - Date.now();
  if (remainingBeforeQueue <= 0 || options.signal?.aborted) {
    const failure = {
      ok: false as const,
      upstreamAttempted: false,
      reason: "timeout" as const,
      model,
      durationMs: getDurationMs(startedAt)
    };
    logAiAttempt(failure, { provider, attempt: 1 });
    return failure;
  }
  const gate = await acquireModelCallPermit({
    maxWaitMs: remainingBeforeQueue,
    deadlineEpochMs: deadline,
    signal: options.signal
  });
  if (!gate.ok) {
    const failure = {
      ok: false as const,
      upstreamAttempted: false,
      reason: options.signal?.aborted ? "timeout" as const : gate.reason,
      model,
      durationMs: getDurationMs(startedAt)
    };
    logAiAttempt(failure, { provider, attempt: 1 });
    return failure;
  }

  const controller = new AbortController();
  const remainingBeforeFetch = Math.max(0, deadline - Date.now());
  if (remainingBeforeFetch <= 0 || options.signal?.aborted) {
    gate.permit.release();
    const failure = {
      ok: false as const,
      upstreamAttempted: false,
      reason: "timeout" as const,
      model,
      durationMs: getDurationMs(startedAt)
    };
    logAiAttempt(failure, { provider, attempt: 1 });
    return failure;
  }
  const timeoutId = windowlessSetTimeout(
    () => controller.abort(),
    Math.max(1, remainingBeforeFetch)
  );
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (options.signal?.aborted) {
    controller.abort();
  }

  let releaseWhenReturning = true;
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2,
        stream: true
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const requestId = getResponseRequestId(response, apiKey);

    if (!response.ok) {
      await cancelResponseBody(response);
      const failure = {
        ok: false as const,
        upstreamAttempted: true,
        reason: failureReasonForHttpStatus(response.status),
        model,
        httpStatus: response.status,
        requestId,
        durationMs: getDurationMs(startedAt)
      };
      logAiAttempt(failure, { provider, attempt: 1 });
      return failure;
    }
    if (!response.body) {
      const failure = {
        ok: false as const,
        upstreamAttempted: true,
        reason: "empty_content" as const,
        model,
        httpStatus: response.status,
        requestId,
        durationMs: getDurationMs(startedAt)
      };
      logAiAttempt(failure, { provider, attempt: 1 });
      return failure;
    }

    releaseWhenReturning = false;
    options.signal?.removeEventListener("abort", abortFromCaller);
    return {
      ok: true,
      upstreamAttempted: true,
      stream: releaseModelPermitWhenStreamEnds(response.body, {
        release: gate.permit.release,
        upstreamController: controller,
        callerSignal: options.signal,
        timeoutMs: Math.max(1, deadline - Date.now())
      }),
      model
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const failure = {
      ok: false as const,
      upstreamAttempted: true,
      reason: (error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error") as AiJsonFailureReason,
      model,
      durationMs: getDurationMs(startedAt)
    };
    logAiAttempt(failure, { provider, attempt: 1 });
    return failure;
  }
  finally {
    options.signal?.removeEventListener("abort", abortFromCaller);
    if (releaseWhenReturning) gate.permit.release();
  }
}

function releaseModelPermitWhenStreamEnds(
  stream: ReadableStream<Uint8Array>,
  options: {
    release: () => void;
    upstreamController: AbortController;
    callerSignal?: AbortSignal;
    timeoutMs: number;
  }
) {
  const reader = stream.getReader();
  let released = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    options.callerSignal?.removeEventListener("abort", abortStream);
    options.release();
  };
  const abortStream = () => {
    options.upstreamController.abort();
    releaseOnce();
    void reader.cancel("stream_aborted").catch(() => {
      // The permit is already released; cancellation is only best-effort cleanup.
    });
  };

  options.callerSignal?.addEventListener("abort", abortStream, { once: true });
  timeoutId = windowlessSetTimeout(abortStream, options.timeoutMs);
  if (options.callerSignal?.aborted) abortStream();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          releaseOnce();
          controller.close();
          return;
        }
        if (value) controller.enqueue(value);
      } catch (error) {
        releaseOnce();
        controller.error(error);
      }
    },
    async cancel(reason) {
      options.upstreamController.abort();
      releaseOnce();
      try {
        await reader.cancel(reason);
      } catch {
        // Cancellation raced the upstream abort; cleanup is already complete.
      }
    }
  });
}

function windowlessSetTimeout(callback: () => void, timeout: number) {
  return setTimeout(callback, timeout);
}
