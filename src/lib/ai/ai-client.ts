import { emitProductObservation } from "./product-observation";
import { currentDurableRequestVersionV7, hasDurableAiRun, markDurableDispatch, recordDurableReceipt, runDurableAiAttempt, type DurableReceipt } from "./durable-call";
import { createHmac } from "node:crypto";
import { reserveAiSpend, configuredDevelopmentEffort, type SpendFailure, type SpendReservation } from "@/lib/ai/spend-ledger";
import { decisionRequestSha256, effortPolicySha256, resolveDecisionModelSettingsForOperation } from "./effort-policy.mjs";
import { currentDecisionEffortPolicy } from "./effort-context";
import {
  acquireModelCallPermit,
  readUserUnboundedAuthorizationBeforeV7,
  recordModelCallCapacityFeedbackV7,
  type ModelCallGateFailureReason
} from "@/lib/ai/model-call-governor";
import {isUserUnboundedExecutionMode} from "./execution-policy.mjs";

export type AiJsonFailureReason =
  | "durable_outcome_unknown"
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
  | SpendFailure
  | ModelCallGateFailureReason;

export type TransientAiFailureReason = Extract<
  AiJsonFailureReason,
  "rate_limited" | "upstream_server_error" | "network_error" | "timeout"
>;

export type AiTokenUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number };

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
      usage?: AiTokenUsage;
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
      usage?: AiTokenUsage;
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
  /** Optional DeepSeek flash thinking-mode sampling; unset preserves legacy requests. */
  topP?: number;
  maxTokens?: number;
  timeoutMs?: number;
  requestDeadlineMs?: number;
  deadlineEpochMs?: number;
  signal?: AbortSignal;
  maxAttempts?: 1 | 2 | 3;
  schema?: AiOutputSchema<T>;
  thinking?: "disabled" | "enabled";
  reasoningEffort?: "max" | "high" | "low";
  /** Only offline, preregistered experiments may override max without a promotion. */
  evaluationRun?: boolean;
  operation?: string;
  promptVersion?: string;
  recommendationPolicyVersion?: string;
  implementationVersion?: string;
  candidateCount?: number;
  /** Server-owned metadata only; never sent in the provider body. */
  diagnosticContext?: { invocationId: string; stage: string; reviewId?: string };
  retryBaseDelayMs?: number;
  retryInstruction?: string;
};

const defaultApiUrl = "https://api.openai.com/v1/chat/completions";
const deepseekApiUrl = "https://api.deepseek.com/chat/completions";
const defaultTimeoutMs = 12000;
export const DEFAULT_AI_REQUEST_DEADLINE_MS = 45_000;
const MIN_AI_ATTEMPT_WINDOW_MS = 5_000;
export const AI_JSON_MAX_RESPONSE_BYTES = 256 * 1024;
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";
export const DEFAULT_REASONING_EFFORT = "max";

export function getConfiguredReasoningEffort(): "max" | "high" | "low" {
  // Changing an environment value alone is not evidence for downgrading effort.
  return configuredDevelopmentEffort() ?? DEFAULT_REASONING_EFFORT;
}

export function getAiConfigurationFingerprint() {
  if(process.env.AI_SPEND_AUTHORIZED_EFFORT==="stage"){
    const policy=currentDecisionEffortPolicy(),settings=resolveDecisionModelSettingsForOperation("competition_v7_rank",policy);
    if(settings.thinking==="disabled")return `${DEFAULT_DEEPSEEK_MODEL}:rank-thinking-disabled:temperature-0:stage:${effortPolicySha256(policy)}:flash-policy.v3`;
    return `${DEFAULT_DEEPSEEK_MODEL}:thinking-enabled:stage:${effortPolicySha256(policy)}:flash-policy.v2`;
  }
  return `${DEFAULT_DEEPSEEK_MODEL}:thinking-enabled:${getConfiguredReasoningEffort()}:flash-policy.v1`;
}

type ResolvedRequestEffort = {effort:"max"|"high"|"low";thinking:"enabled"|"disabled";temperature?:0;topP?:1;policySha256?:string;requestVersion?:{recommendationPolicyVersion:string;implementationVersion:string}};
function resolveRequestEffort<T>(options:RequestAiJsonOptions<T>):ResolvedRequestEffort {
  const durableVersion=currentDurableRequestVersionV7();
  const suppliedVersion=options.recommendationPolicyVersion===undefined&&options.implementationVersion===undefined?undefined:
    {recommendationPolicyVersion:options.recommendationPolicyVersion!,implementationVersion:options.implementationVersion!};
  if(suppliedVersion&&(Object.values(suppliedVersion).some(value=>typeof value!=="string"||!value||value.length>180)
    ||durableVersion&&JSON.stringify(durableVersion)!==JSON.stringify(suppliedVersion)))throw new Error("decision_request_version_mismatch");
  const requestVersion=durableVersion??suppliedVersion;
  if(/^competition_v7_(rank|explain|review|chat|extract|chat_review)$/.test(options.operation??"")||process.env.AI_SPEND_AUTHORIZED_EFFORT==="stage"){
    const policy=currentDecisionEffortPolicy(),settings=resolveDecisionModelSettingsForOperation(options.operation??"",policy),effort=settings.policyReasoningEffort;
    if(options.reasoningEffort!==undefined&&options.reasoningEffort!==effort)throw new Error("decision_effort_option_mismatch");
    if(options.thinking!==undefined&&options.thinking!==settings.thinking)throw new Error("decision_thinking_option_mismatch");
    if(settings.thinking==="disabled"&&(options.temperature!==undefined&&options.temperature!==0||options.topP!==undefined&&options.topP!==1||options.maxAttempts!==undefined&&options.maxAttempts!==1))throw new Error("decision_non_thinking_sampling_mismatch");
    if(settings.thinking==="disabled"&&(options.model?.trim()||getConfiguredAiModel())!==DEFAULT_DEEPSEEK_MODEL)throw new Error("decision_non_thinking_model_mismatch");
    return {effort,thinking:settings.thinking,...(settings.thinking==="disabled"?{temperature:0 as const,topP:1 as const}:{}),policySha256:effortPolicySha256(policy),requestVersion};
  }
  if(options.thinking==="disabled")throw new Error("decision_non_thinking_authorization_required");
  return {effort:options.evaluationRun?(options.reasoningEffort??DEFAULT_REASONING_EFFORT):getConfiguredReasoningEffort(),thinking:"enabled"};
}

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
  context: Pick<RequestAiJsonOptions<T>, "operation" | "promptVersion" | "candidateCount" | "topP"> & {
    provider: string;
    attempt: number;
  }
) {
  emitProductObservation("ai_attempt_result",{operation:context.operation??"unspecified",model:result.model,attempt:context.attempt,upstreamAttempted:result.upstreamAttempted,ok:result.ok,reason:result.ok?null:result.reason,httpStatus:result.httpStatus??null,providerRequestId:result.requestId??null,finishReason:result.finishReason??null,durationMs:result.durationMs??null,usage:"usage" in result?result.usage??null:null,...(context.topP === undefined ? {} : { topP: context.topP })});
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
    ...(context.topP === undefined ? {} : { topP: context.topP }),
    outcome: result.ok ? "success" : "failure"
  });
  if (result.ok) {
    console.info(entry);
  } else {
    console.warn(entry);
  }
}

async function requestAiJsonOnceInternal<T>(
  prompt: string,
  options: RequestAiJsonOptions<T>,
  attempt: number,
  deadline: number,
  binding:ResolvedRequestEffort
): Promise<AiJsonResult<T>> {
  const startedAt = Date.now();
  const provider = getConfiguredAiProvider();
  const apiKey = options.apiKey?.trim() || process.env.AI_API_KEY?.trim();
  const model = options.model?.trim() || getConfiguredAiModel();
  const effort = binding.effort;

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
  if (model !== DEFAULT_DEEPSEEK_MODEL && process.env.NODE_ENV !== "test") {
    return { ok: false, upstreamAttempted: false, reason: "invalid_request", model, attempts: attempt };
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

  const maxTokens = options.maxTokens ?? 8192;
  const systemPrompt = options.systemPrompt ?? "You return only valid JSON. Do not invent facts not present in the user input.";
  const requestPrompt = attempt === 1 ? prompt : `${prompt}\n\nCorrection: the previous response was unusable. Return one complete JSON object only, with no commentary.${options.retryInstruction ? ` ${options.retryInstruction}` : ""}`;
  const spend = await reserveAiSpend({ system: systemPrompt, prompt: requestPrompt, maxTokens, model, effort, operation: options.operation,effortPolicySha256:binding.policySha256,deadlineEpochMs:deadline,signal:options.signal });
  if (!spend.ok) {
    gate.permit.release();
    return { ok: false, upstreamAttempted: false, reason: spend.reason, model, attempts: attempt, durationMs: getDurationMs(startedAt) };
  }
  let actualUsage: AiTokenUsage | undefined;
  let upstreamAttempted = false;

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeoutId = windowlessSetTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(options.timeoutMs ?? getTimeoutMs(), deadline - Date.now()))
  );

  try {
    const body: JsonRecord = {
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: requestPrompt
        }
      ],
      thinking: { type: binding.thinking },
      ...(binding.thinking==="disabled"?{temperature:0,top_p:1}:{reasoning_effort:effort,...(options.topP === undefined ? {} : { top_p: options.topP })}),
      max_tokens: maxTokens,
      response_format: {
        type: "json_object"
      }
    };

    if (Date.now() >= deadline || options.signal?.aborted) return { ok: false, upstreamAttempted: false, reason: "timeout", model, attempts: attempt };
    await markDurableDispatch();
    upstreamAttempted = true;
    emitProductObservation("ai_transport_dispatch",{model,attempt,operation:options.operation??"unspecified",reservationId:spend.reservation.id,
      thinkingType: (body.thinking as { type: string }).type,
      ...(binding.thinking==="disabled"?{policyReasoningEffort:effort,wireReasoningEffort:null,temperature:body.temperature}:{reasoningEffort:body.reasoning_effort}),
      effortPolicySha256:binding.policySha256??null,
      maxTokens: body.max_tokens, deadlineEpochMs: deadline,
      ...(binding.thinking==="disabled"?{topP:body.top_p}:options.topP === undefined ? {} : { topP: options.topP }),
      ...options.diagnosticContext});
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    emitProductObservation("ai_transport_response",{model,attempt,httpStatus:response.status});
    recordModelCallCapacityFeedbackV7(response.status,getRetryAfterMs(response));
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

    const rawUsage = asRecord(payload.usage);
    const inputTokens = rawUsage?.prompt_tokens;
    const outputTokens = rawUsage?.completion_tokens;
    const cachedInputTokens = rawUsage?.prompt_cache_hit_tokens === undefined ? 0 : rawUsage.prompt_cache_hit_tokens;
    // Invalid provider counters are unknown usage, never clamp them into a cheaper valid bill.
    const usage: AiTokenUsage | undefined =
      typeof inputTokens === "number" && typeof outputTokens === "number" && typeof cachedInputTokens === "number" &&
      [inputTokens, outputTokens, cachedInputTokens].every(n => Number.isSafeInteger(n) && n >= 0) &&
      cachedInputTokens <= inputTokens && outputTokens <= maxTokens &&
      inputTokens <= Buffer.byteLength(systemPrompt + requestPrompt, "utf8") + 1024
        ? {inputTokens, outputTokens, cachedInputTokens} : undefined;
    actualUsage = usage;
    const choice = getChoice(payload);
    await recordDurableReceipt({model,httpStatus:response.status,requestId,finishReason:choice.finishReason,content:choice.content,usage,durationMs:getDurationMs(startedAt),attempts:attempt,
      operation:options.operation,thinking:binding.thinking,
      ...(binding.thinking==="disabled"?{policyReasoningEffort:effort,wireReasoningEffort:null,temperature:0}:{reasoningEffort:effort}),
      effortPolicySha256:binding.policySha256,...binding.requestVersion,
      ...(binding.thinking==="disabled"?{topP:1}:options.topP === undefined ? {} : { topP: options.topP })});
    if (choice.finishReason === "length") {
      return {
        ok: false,
        upstreamAttempted: true,
        ...(usage ? { usage } : {}),
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
        ...(usage ? { usage } : {}),
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
        ...(usage ? { usage } : {}),
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
        ...(usage ? { usage } : {}),
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
        ...(usage ? { usage } : {}),
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
        ...(usage ? { usage } : {}),
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
        ...(usage ? { usage } : {}),
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
        ...(usage ? { usage } : {}),
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
      upstreamAttempted,
      reason: error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error",
      model,
      durationMs: getDurationMs(startedAt),
      attempts: attempt
    };
  } finally {
    await spend.reservation.settle(actualUsage, upstreamAttempted).catch(() => {emitProductObservation("ai_settlement_failed",{reservationId:spend.reservation.id,usage:actualUsage??null,upstreamAttempted});});
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromCaller);
    gate.permit.release();
  }
}

function replayDurableReceipt<T>(receipt:DurableReceipt,options:RequestAiJsonOptions<T>,binding:ResolvedRequestEffort):AiJsonResult<T> {
  const base={model:receipt.model,httpStatus:receipt.httpStatus,requestId:receipt.requestId,finishReason:receipt.finishReason,usage:receipt.usage,durationMs:receipt.durationMs,attempts:receipt.attempts,upstreamAttempted:true as const};
  if(binding.thinking==="disabled"&&(receipt.operation!=="competition_v7_rank"||receipt.effortPolicySha256!==binding.policySha256||receipt.thinking!=="disabled"||receipt.temperature!==0||receipt.topP!==1||receipt.policyReasoningEffort!==binding.effort||receipt.wireReasoningEffort!==null||receipt.reasoningEffort!==undefined))return {...base,ok:false,reason:"invalid_request"};
  if(receipt.finishReason==="length")return {...base,ok:false,reason:"truncated"};
  if(receipt.finishReason!==null&&receipt.finishReason!=="stop")return {...base,ok:false,reason:"api_error"};
  const parsed=parseAiJson<unknown>(receipt.content);
  if(parsed===null)return {...base,ok:false,reason:"invalid_json"};
  const validated=options.schema?.safeParse(parsed);
  if(validated&&!validated.success)return {...base,ok:false,reason:"invalid_output"};
  return {...base,ok:true,data:(validated?.success?validated.data:parsed) as T};
}
async function requestAiJsonOnce<T>(prompt:string,options:RequestAiJsonOptions<T>,attempt:number,deadline:number,binding:ResolvedRequestEffort):Promise<AiJsonResult<T>> {
  const request={prompt,system:options.systemPrompt,model:binding.thinking==="disabled"?(options.model?.trim()||getConfiguredAiModel()):options.model,maxTokens:options.maxTokens,promptVersion:options.promptVersion};
  const samplingBinding=binding.thinking==="disabled"?{operation:options.operation,temperature:0,topP:1}:options.topP === undefined ? {} : {topP:options.topP};
  const boundRequest=binding.policySha256?{...request,thinking:binding.thinking,reasoningEffort:binding.effort as "high"|"low",effortPolicySha256:binding.policySha256,...binding.requestVersion,...samplingBinding}:{...request,...samplingBinding};
  return runDurableAiAttempt({key:`${options.diagnosticContext?.stage??options.operation??"json"}:${options.diagnosticContext?.reviewId??"batch"}:${attempt}`,
    prompt:JSON.stringify(boundRequest),requestSha256:binding.policySha256?decisionRequestSha256(boundRequest as Parameters<typeof decisionRequestSha256>[0]):undefined,
    operation:options.operation,thinking:binding.thinking,reasoningEffort:binding.effort,effortPolicySha256:binding.policySha256,
    ...(binding.thinking==="disabled"?{temperature:0,topP:1}:{})},
    ()=>requestAiJsonOnceInternal(prompt,options,attempt,deadline,binding),receipt=>replayDurableReceipt(receipt,options,binding));
}

export async function requestAiJson<T>(prompt: string, options: RequestAiJsonOptions<T> = {}): Promise<AiJsonResult<T>> {
  if (options.topP !== undefined && (!Number.isFinite(options.topP) || options.topP < 0.95 || options.topP > 1)) return { ok: false, reason: "invalid_request", model: options.model ?? getConfiguredAiModel(), upstreamAttempted: false };
  const maxAttempts = options.maxAttempts ?? 1;
  const provider = getConfiguredAiProvider();
  let binding:ResolvedRequestEffort;
  try {binding=resolveRequestEffort(options);}catch {return {ok:false,reason:"spend_configuration_invalid",model:options.model??getConfiguredAiModel(),upstreamAttempted:false};}
  const relativeDeadline = Date.now() + getRequestDeadlineMs(options);
  const deadline = Number.isFinite(options.deadlineEpochMs)
    ? Math.min(relativeDeadline, Math.floor(Number(options.deadlineEpochMs)))
    : relativeDeadline;
  if(binding.thinking==="disabled"){
    try{
      if(!isUserUnboundedExecutionMode())throw new Error("decision_non_thinking_authorization_required");
      await readUserUnboundedAuthorizationBeforeV7(deadline,options.signal);
    }catch{return {ok:false,reason:options.signal?.aborted||Date.now()>=deadline?"timeout":"spend_configuration_invalid",model:options.model??getConfiguredAiModel(),upstreamAttempted:false};}
  }
  let result = await requestAiJsonOnce(prompt, options, 1, deadline,binding);
  logAiAttempt(result, { ...options, provider, attempt: 1 });

  for (let attempt = 2; attempt <= maxAttempts && !result.ok; attempt += 1) {
    // Unknown outcomes cannot trigger another paid request after crash/timeout.
    if((hasDurableAiRun()||isUserUnboundedExecutionMode())&&!["invalid_json","invalid_output","empty_content","truncated"].includes(result.reason))break;
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
    emitProductObservation("ai_retry_wait",{attempt,retryWaitMs,previousReason:result.reason});
    if (!await waitBeforeRetry(retryWaitMs, deadline, options.signal)) break;
    result = await requestAiJsonOnce(prompt, options, attempt, deadline,binding);
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
  let spendReservation: SpendReservation | undefined;
  let streamAttempted = false;
  try {
    const spend = await reserveAiSpend({ system: systemPrompt, prompt, maxTokens: 8192, model, effort: getConfiguredReasoningEffort(), operation: "text_stream",deadlineEpochMs:deadline,signal:controller.signal });
    if (!spend.ok) return { ok: false, upstreamAttempted: false, reason: spend.reason, model };
    spendReservation = spend.reservation;
    streamAttempted = true;
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
        thinking: { type: "enabled" },
        reasoning_effort: getConfiguredReasoningEffort(),
        max_tokens: 8192,
        stream: true
      }),
      signal: controller.signal
    });

    recordModelCallCapacityFeedbackV7(response.status,getRetryAfterMs(response));
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
    // Streaming usage is not available in the legacy interface; keep its full
    // reservation as a conservative charge rather than report an invented cost.
    await spendReservation?.settle(undefined, streamAttempted).catch(() => undefined);
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
