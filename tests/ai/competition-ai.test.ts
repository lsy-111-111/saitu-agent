import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AI_JSON_MAX_RESPONSE_BYTES,
  DEFAULT_DEEPSEEK_MODEL,
  requestAiJson,
  requestAiTextStream
} from "../../src/lib/ai/ai-client";
import {
  acquireModelCallPermit,
  modelCallGovernorSnapshotForTests,
  resetModelCallGovernorForTests
} from "../../src/lib/ai/model-call-governor";
import {
  buildCompetitionClarifyAskableContext,
  generateNextCompetitionQuestion,
  getCompetitionClarifyModel,
  materializeCompetitionClarifyQuestion,
  selectAskableQuestionForTurn
} from "../../src/lib/ai/competition-clarify";
import {
  COMPETITION_CONVERSATION_TOKEN_MAX_LENGTH,
  COMPETITION_CONVERSATION_TOKEN_VERSION,
  createCompetitionConversationToken as createSignedCompetitionConversationToken,
  verifyCompetitionConversationToken
} from "../../src/lib/ai/competition-conversation-token";
import {
  competitionDynamicPromptFingerprint,
  competitionDynamicQuestionV3Schema,
  parseCompetitionDynamicAnswer
} from "../../src/lib/ai/competition-dynamic-question";
import {
  containsCompetitionGeneratedTextPersonalInfo,
  containsCompetitionNotePersonalInfo
} from "../../src/lib/ai/competition-note";
import { getCompetitionRecommendModel } from "../../src/lib/ai/competition-ranking";
import { getCompetitionRecommendationCandidates } from "../../src/lib/competitions/recommendation-engine";
import { COMPETITION_CATALOG_VERSION } from "../../src/lib/competitions/catalog";
import {
  COMPETITION_SCORER_VERSION,
  buildCompetitionQualificationSnapshot
} from "../../src/lib/competitions/scoring";
import {
  competitionClarifyRequestSchema,
  competitionRecommendationProfileSchema,
  sanitizeCompetitionTranscriptForAi
} from "../../src/lib/ai/competition-request-schema";
import {
  COMPETITION_PROFILE_VERSION,
  COMPETITION_PROFILE_FIELD_IDS,
  type CompetitionDynamicQuestionV3,
  type CompetitionDynamicExchangeV3,
  type CompetitionRecommendationProfileV4,
  type CompetitionRecommendationProfileV5
} from "../../src/types/competition-recommendation";
import { competitionFreeTextSamples } from "../fixtures/competition-free-text-samples";
import {
  competitionPiiRegressionTexts,
  competitionPiiSafeControlTexts
} from "../fixtures/competition-pii-regression";
import { buildCompetitionQuestionnaireRawContext } from "../fixtures/competition-questionnaire-context";

const originalEnv = { ...process.env };
let warnMock: ReturnType<typeof vi.spyOn>;

const legacyProfile: CompetitionRecommendationProfileV4 = {
  profileVersion: COMPETITION_PROFILE_VERSION,
  stage: "undergraduate-2",
  majorFields: ["computer-science", "engineering"],
  skills: ["programming", "hardware", "presentation"],
  interests: ["ai", "innovation"],
  goals: ["project", "employment"],
  preferredOutputs: ["software", "prototype"],
  startingPoint: "coursework",
  weeklyCommitment: "5-10",
  teamStatus: "looking",
  availableResources: ["mentor"],
  region: "east",
  participationMode: "flexible",
  experienceLevel: "participated",
  evidence: ["project", "prototype"]
};

const profile: CompetitionRecommendationProfileV5 = {
  profileVersion: "competition-profile.v5",
  questionnaireVersion: "competition-questionnaire.v1",
  confirmedFields: [...COMPETITION_PROFILE_FIELD_IDS],
  confirmedFacts: ["enrollmentStatus", "teamUnit", "teamSize"],
  stage: "undergraduate-2",
  majorFields: ["computer-science", "engineering"],
  specificSubjects: ["information-communication", "robotics-automation"],
  skills: ["programming", "hardware", "presentation"],
  interests: ["ai", "innovation"],
  taskFormats: ["software", "hardware"],
  goals: ["project", "employment"],
  preferredOutputs: ["software", "prototype"],
  startingPoint: "coursework",
  weeklyCommitment: "5-10",
  teamStatus: "looking",
  availableResources: ["mentor"],
  participationMode: "flexible",
  participationTiming: "flexible",
  experienceLevel: "participated",
  evidence: ["project", "prototype"],
  enrollmentStatus: "full-time-student",
  teamUnit: "unsure",
  teamSize: "unsure"
};

type ConversationTokenInput = Omit<
  Parameters<typeof createSignedCompetitionConversationToken>[0],
  "rawAnswerContext"
> & {
  rawAnswerContext?: Parameters<typeof createSignedCompetitionConversationToken>[0]["rawAnswerContext"];
};

function createCompetitionConversationToken(
  input: ConversationTokenInput,
  now?: Date
) {
  return createSignedCompetitionConversationToken({
    ...input,
    rawAnswerContext: input.rawAnswerContext ?? buildCompetitionQuestionnaireRawContext(input.profile)
  }, now);
}

const dynamicQuestion: CompetitionDynamicQuestionV3 = {
  questionId: "dq_project_maturity",
  signalKey: "competition-fit",
  prompt: "你更希望从现有课程项目继续深化，还是重新选择题目？",
  selection: "multiple",
  maxSelections: 1,
  options: [
    { value: "product-validation", label: "继续深化现有项目" },
    { value: "research-provenance", label: "重新选择研究题目" }
  ],
  allowsNote: true,
  maxNoteLength: 120,
  impact: "material",
  estimatedPreferenceOutcomeChanges: 2
};

const goalQuestion: CompetitionDynamicQuestionV3 = {
  questionId: "dq_goal_priority",
  signalKey: "candidate-goal-tradeoff",
  prompt: "结合当前候选，你更看重哪一项收获？",
  selection: "single",
  options: [
    { value: "project", label: "项目经历" },
    { value: "employment", label: "就业能力" }
  ],
  allowsNote: true,
  maxNoteLength: 120,
  impact: "material",
  estimatedPreferenceOutcomeChanges: 2
};

const completedTranscript: CompetitionDynamicExchangeV3[] = [
  { question: dynamicQuestion, answer: { selectedValues: ["product-validation"] } },
  { question: goalQuestion, answer: { selectedValues: ["project"] } }
];

function aiResponse(content: string, finishReason = "stop") {
  return new Response(
    JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

beforeEach(() => {
  process.env.AI_PROVIDER = "deepseek";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_COMPETITION_CLARIFY_MODEL = "test-pro";
  process.env.AI_CONVERSATION_SIGNING_SECRET = "test-signing-secret-at-least-thirty-two-characters";
  warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  resetModelCallGovernorForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("requestAiTextStream", () => {
  it("fails closed before fetch when the DeepSeek endpoint is not approved", async () => {
    process.env.AI_API_URL = "https://attacker.example/chat/completions";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestAiTextStream("private prompt", "system")).resolves.toMatchObject({
      ok: false,
      reason: "provider_not_allowed"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels a non-success upstream response body before returning", async () => {
    process.env.DATABASE_URL = "";
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 503 }))
    );

    const result = await requestAiTextStream("prompt", "system");

    expect(result).toMatchObject({ ok: false, reason: "upstream_server_error", httpStatus: 503 });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(modelCallGovernorSnapshotForTests()).toMatchObject({ activeCalls: 0 });
  });

  it("releases model capacity when a successful stream is never consumed", async () => {
    vi.useFakeTimers();
    process.env.DATABASE_URL = "";
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 }))
    );

    const result = await requestAiTextStream("prompt", "system", { timeoutMs: 25 });

    expect(result.ok).toBe(true);
    expect(modelCallGovernorSnapshotForTests()).toMatchObject({ activeCalls: 1 });
    await vi.advanceTimersByTimeAsync(26);
    expect(modelCallGovernorSnapshotForTests()).toMatchObject({ activeCalls: 0 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("keeps caller cancellation active after response headers arrive", async () => {
    process.env.DATABASE_URL = "";
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 }))
    );
    const caller = new AbortController();

    const result = await requestAiTextStream("prompt", "system", {
      signal: caller.signal,
      timeoutMs: 1_000
    });
    expect(result.ok).toBe(true);
    expect(modelCallGovernorSnapshotForTests()).toMatchObject({ activeCalls: 1 });

    caller.abort();
    await Promise.resolve();
    expect(modelCallGovernorSnapshotForTests()).toMatchObject({ activeCalls: 0 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels a queued stream request before any upstream call", async () => {
    process.env.DATABASE_URL = "";
    process.env.AI_CONCURRENCY_MAX = "1";
    process.env.AI_QUEUE_MAX = "1";
    process.env.AI_QUEUE_WAIT_MS = "15000";
    const holder = await acquireModelCallPermit();
    expect(holder.ok).toBe(true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const caller = new AbortController();

    const pending = requestAiTextStream("private prompt", "system", {
      signal: caller.signal,
      timeoutMs: 10_000
    });
    expect(modelCallGovernorSnapshotForTests()).toMatchObject({ activeCalls: 1, queuedCalls: 1 });
    caller.abort();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      reason: "timeout",
      upstreamAttempted: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(modelCallGovernorSnapshotForTests()).toMatchObject({ activeCalls: 1, queuedCalls: 0 });
    if (holder.ok) holder.permit.release();
  });
});

describe("requestAiJson", () => {
  it("fails closed before fetch when the DeepSeek endpoint is not approved", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestAiJson("private prompt", {
      apiUrl: "http://127.0.0.1:5432/internal",
      maxAttempts: 1
    })).resolves.toMatchObject({
      ok: false,
      reason: "provider_not_allowed",
      attempts: 1
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels a non-success upstream response body before returning", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, {
        status: 429,
        headers: { "Retry-After": "2" }
      }))
    );

    const result = await requestAiJson("return JSON", { maxAttempts: 1 });

    expect(result).toMatchObject({
      ok: false,
      reason: "rate_limited",
      httpStatus: 429,
      retryAfterMs: 2_000
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(modelCallGovernorSnapshotForTests()).toMatchObject({ activeCalls: 0 });
  });

  it("validates JSON output with the supplied strict schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(aiResponse('{"value":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", {
      model: "test-model",
      maxTokens: 512,
      maxAttempts: 2,
      schema: z.object({ value: z.literal("ok") }).strict(),
      thinking: "disabled"
    });

    expect(result).toMatchObject({ ok: true, data: { value: "ok" }, attempts: 1, finishReason: "stop" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody).toMatchObject({
      model: "test-model",
      temperature: 0,
      max_tokens: 512,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" }
    });
  });

  it.each(['\uFEFF{"value":"ok"}', '```json\n{"value":"ok"}\n```'])(
    "accepts BOM or one complete JSON fence without extracting arbitrary text",
    async (content) => {
      const fetchMock = vi.fn().mockResolvedValue(aiResponse(content));
      vi.stubGlobal("fetch", fetchMock);

      const result = await requestAiJson("return JSON", {
        schema: z.object({ value: z.literal("ok") }).strict()
      });

      expect(result).toMatchObject({ ok: true, data: { value: "ok" } });
    }
  );

  it("does not extract JSON from surrounding model commentary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(aiResponse('Here is the result: {"value":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON");

    expect(result).toMatchObject({ ok: false, reason: "invalid_json" });
  });

  it("retries malformed model JSON once and returns the valid second response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(aiResponse("not-json"))
      .mockResolvedValueOnce(aiResponse('{"value":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", {
      maxAttempts: 2,
      schema: z.object({ value: z.literal("ok") }).strict()
    });

    expect(result).toMatchObject({ ok: true, data: { value: "ok" }, attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the second malformed JSON failure after one retry", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(aiResponse("not-json")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 2 });

    expect(result).toMatchObject({ ok: false, reason: "invalid_json", attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries truncated output once", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(aiResponse('{"value":', "length")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 2 });

    expect(result).toMatchObject({ ok: false, reason: "truncated", attempts: 2, finishReason: "length" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects non-stop finish reasons without retrying API failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(aiResponse('{"value":"ok"}', "content_filter"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 2 });

    expect(result).toMatchObject({ ok: false, reason: "api_error", finishReason: "content_filter", attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a network failure once", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 2 });

    expect(result).toMatchObject({ ok: false, reason: "network_error", attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a malformed upstream JSON response body at most once", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response("not a response object", { status: 200, headers: { "Content-Type": "application/json" } }))
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 2 });

    expect(result).toMatchObject({ ok: false, reason: "invalid_json", attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an oversized declared response before reading and never retries it", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      cancel
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: {
          "Content-Length": String(AI_JSON_MAX_RESPONSE_BYTES + 1),
          "Content-Type": "application/json"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 3 });

    expect(result).toMatchObject({ ok: false, reason: "response_too_large", attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("counts a chunked response and cancels as soon as it crosses the byte limit", async () => {
    const cancel = vi.fn();
    let chunkIndex = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunkIndex === 0) {
          chunkIndex += 1;
          controller.enqueue(new Uint8Array(AI_JSON_MAX_RESPONSE_BYTES));
          return;
        }
        if (chunkIndex === 1) {
          chunkIndex += 1;
          controller.enqueue(new Uint8Array([0x20]));
        }
      },
      cancel
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: {
          "Content-Length": "1",
          "Content-Type": "application/json"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 3 });

    expect(result).toMatchObject({ ok: false, reason: "response_too_large", attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("accepts a valid JSON response exactly at the byte limit", async () => {
    const envelope = {
      choices: [{ finish_reason: "stop", message: { content: '{"value":"ok"}' } }],
      padding: ""
    };
    const baseBody = JSON.stringify(envelope);
    envelope.padding = "x".repeat(AI_JSON_MAX_RESPONSE_BYTES - Buffer.byteLength(baseBody));
    const responseBody = JSON.stringify(envelope);
    expect(Buffer.byteLength(responseBody)).toBe(AI_JSON_MAX_RESPONSE_BYTES);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(responseBody, {
        status: 200,
        headers: {
          "Content-Length": String(AI_JSON_MAX_RESPONSE_BYTES),
          "Content-Type": "application/json"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", {
      maxAttempts: 2,
      schema: z.object({ value: z.literal("ok") }).strict()
    });

    expect(result).toMatchObject({ ok: true, data: { value: "ok" }, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid UTF-8 instead of applying a lossy JSON decode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([0xff]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 1 });

    expect(result).toMatchObject({ ok: false, reason: "invalid_json", attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries content that fails the output schema and accepts a valid second response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(aiResponse('{"value":"wrong"}'))
      .mockResolvedValueOnce(aiResponse('{"value":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", {
      maxAttempts: 2,
      schema: z.object({ value: z.literal("ok") }).strict()
    });

    expect(result).toMatchObject({ ok: true, data: { value: "ok" }, attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns invalid_output when both schema validation attempts fail", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(aiResponse('{"value":"wrong"}')));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", {
      maxAttempts: 2,
      schema: z.object({ value: z.literal("ok") }).strict()
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid_output", attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("supports an initial attempt plus two protocol retries and succeeds on the third attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(aiResponse('{"value":"wrong"}'))
      .mockResolvedValueOnce(aiResponse('{"value":"still-wrong"}'))
      .mockResolvedValueOnce(aiResponse('{"value":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", {
      maxAttempts: 3,
      schema: z.object({ value: z.literal("ok") }).strict(),
      operation: "test_protocol_retry",
      retryInstruction: "Use the exact supplied schema."
    });

    expect(result).toMatchObject({ ok: true, data: { value: "ok" }, attempts: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const requestBodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string));
    expect(requestBodies[0].messages[1].content).toBe("return JSON");
    for (const requestBody of requestBodies.slice(1)) {
      expect(requestBody.messages[1].content).toContain("Correction: the previous response was unusable.");
      expect(requestBody.messages[1].content).toContain("Use the exact supplied schema.");
    }
    const attemptLogs = [
      ...warnMock.mock.calls.map(([entry]) => JSON.parse(String(entry))),
      ...vi.mocked(console.info).mock.calls.map(([entry]) => JSON.parse(String(entry)))
    ]
      .filter(({ event, operation }) => event === "ai_upstream_attempt" && operation === "test_protocol_retry")
      .sort((left, right) => left.attempt - right.attempt);
    expect(attemptLogs.map(({ attempt, outcome }) => ({ attempt, outcome }))).toEqual([
      { attempt: 1, outcome: "failure" },
      { attempt: 2, outcome: "failure" },
      { attempt: 3, outcome: "success" }
    ]);
  });

  it("re-evaluates the retry wait policy after every failed attempt", async () => {
    process.env.AI_RETRY_MAX_DELAY_MS = "5";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(aiResponse('{"value":"wrong"}'))
      .mockResolvedValueOnce(new Response(null, {
        status: 429,
        headers: { "Retry-After": "0.01" }
      }))
      .mockResolvedValueOnce(aiResponse('{"value":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", {
      maxAttempts: 3,
      schema: z.object({ value: z.literal("ok") }).strict()
    });

    expect(result).toMatchObject({ ok: false, reason: "rate_limited", attempts: 2, retryAfterMs: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([null, "", "   "])("retries empty content %# once and accepts a valid second response", async (content) => {
    const emptyResponse = new Response(
      JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce(aiResponse('{"value":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 2 });

    expect(result).toMatchObject({ ok: true, data: { value: "ok" }, attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, "authentication_error"],
    [402, "insufficient_balance"],
    [400, "invalid_request"],
    [422, "invalid_request"]
  ] as const)("classifies HTTP %s without retrying", async (status, reason) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 2 });

    expect(result).toMatchObject({ ok: false, reason, httpStatus: status, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, "rate_limited"],
    [500, "upstream_server_error"],
    [503, "upstream_server_error"]
  ] as const)("retries transient HTTP %s at most once", async (status, reason) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 2 });

    expect(result).toMatchObject({ ok: false, reason, httpStatus: status, attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors an upstream Retry-After value before retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "0.001" } }))
      .mockResolvedValueOnce(aiResponse('{"value":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 2 });

    expect(result).toMatchObject({ ok: true, data: { value: "ok" }, attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry earlier than an upstream Retry-After beyond the configured wait budget", async () => {
    process.env.AI_RETRY_MAX_DELAY_MS = "5";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 429, headers: { "Retry-After": "0.01" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 2 });

    expect(result).toMatchObject({
      ok: false,
      reason: "rate_limited",
      attempts: 1,
      retryAfterMs: 10
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts an HTTP-date Retry-After value", async () => {
    const alreadyElapsed = new Date(Date.now() - 1_000).toUTCString();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { "Retry-After": alreadyElapsed } }))
      .mockResolvedValueOnce(aiResponse('{"value":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 2 });

    expect(result).toMatchObject({ ok: true, data: { value: "ok" }, attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a timeout at most once", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchMock = vi.fn().mockRejectedValue(timeout);
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 2 });

    expect(result).toMatchObject({ ok: false, reason: "timeout", attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bounds queue, retry delay, and every upstream attempt by one request deadline", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 429,
        headers: { "Retry-After": "1" }
      }))
      .mockImplementationOnce((_: string, init: RequestInit) => new Promise<Response>((_, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        );
      }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = requestAiJson("return JSON", {
      maxAttempts: 2,
      timeoutMs: 30_000,
      requestDeadlineMs: 10_000
    });
    await vi.advanceTimersByTimeAsync(10_001);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      reason: "timeout",
      attempts: 2
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(modelCallGovernorSnapshotForTests()).toMatchObject({ activeCalls: 0 });
  });

  it("counts real governor queue time against the same retry and fetch deadline", async () => {
    vi.useFakeTimers();
    process.env.DATABASE_URL = "";
    process.env.AI_CONCURRENCY_MAX = "1";
    process.env.AI_QUEUE_MAX = "1";
    process.env.AI_QUEUE_WAIT_MS = "15000";
    process.env.AI_MODEL_CALLS_PER_DAY = "10";
    const holder = await acquireModelCallPermit();
    expect(holder.ok).toBe(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 429,
        headers: { "Retry-After": "1" }
      }))
      .mockImplementationOnce((_: string, init: RequestInit) => new Promise<Response>((_, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        );
      }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = requestAiJson("return JSON", {
      maxAttempts: 2,
      timeoutMs: 30_000,
      requestDeadlineMs: 10_000
    });
    expect(modelCallGovernorSnapshotForTests()).toMatchObject({ activeCalls: 1, queuedCalls: 1 });
    await vi.advanceTimersByTimeAsync(4_000);
    if (holder.ok) holder.permit.release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_001);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      reason: "timeout",
      attempts: 2
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(modelCallGovernorSnapshotForTests()).toMatchObject({ activeCalls: 0, queuedCalls: 0 });
  });

  it("preserves timeout classification while reading a bounded response stream", async () => {
    const fetchMock = vi.fn().mockImplementation((_: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener(
            "abort",
            () => controller.error(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        }
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "Content-Type": "application/json" } })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("return JSON", { maxAttempts: 1, timeoutMs: 5 });

    expect(result).toMatchObject({ ok: false, reason: "timeout", attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["x-request-id", "request-id"] as const)(
    "hashes an untrusted %s before returning or logging it",
    async (headerName) => {
      const rawRequestId = "private-profile-text-13800138000";
      const apiKey = "private-api-key";
      const safeRequestId = `ai_req_${createHmac("sha256", apiKey)
        .update("ai-upstream-request-id\0")
        .update(rawRequestId)
        .digest("hex")
        .slice(0, 16)}`;
      const fetchMock = vi.fn().mockResolvedValue(
        new Response("private-upstream-body", {
          status: 401,
          headers: { [headerName]: rawRequestId }
        })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await requestAiJson("private-profile-prompt", {
        apiKey,
        maxAttempts: 2,
        model: "deepseek-v4-pro",
        operation: "competition_recommend",
        promptVersion: "private-prompt-version",
        candidateCount: 3
      });

      expect(result).toMatchObject({ ok: false, requestId: safeRequestId });
      expect(JSON.stringify(result)).not.toContain(rawRequestId);
      expect(warnMock).toHaveBeenCalledTimes(1);
      const logEntry = String(warnMock.mock.calls[0][0]);
      const metadata = JSON.parse(logEntry) as Record<string, unknown>;
      expect(metadata).toMatchObject({
        event: "ai_upstream_attempt",
        operation: "competition_recommend",
        provider: "deepseek",
        model: "deepseek-v4-pro",
        httpStatus: 401,
        fallbackReason: "authentication_error",
        attempt: 1,
        durationMs: expect.any(Number),
        requestId: safeRequestId,
        promptVersion: "private-prompt-version",
        candidateCount: 3,
        outcome: "failure"
      });
      expect(Number(metadata.durationMs)).toBeGreaterThanOrEqual(0);
      expect(logEntry).not.toContain("private-profile-prompt");
      expect(logEntry).not.toContain("private-api-key");
      expect(logEntry).not.toContain("private-upstream-body");
      expect(logEntry).not.toContain(rawRequestId);
    }
  );

  it.each([
    {
      reason: "invalid_json" as const,
      content: "private-upstream-body",
      schema: undefined
    },
    {
      reason: "invalid_output" as const,
      content: '{"private-upstream-body":true}',
      schema: z.object({ value: z.literal("ok") }).strict()
    }
  ])("logs only safe structured metadata for both $reason attempts", async ({ reason, content, schema }) => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(aiResponse(content)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiJson("private-profile-prompt", {
      apiKey: "private-api-key",
      maxAttempts: 2,
      model: "deepseek-v4-pro",
      schema
    });

    expect(result).toMatchObject({ ok: false, reason, attempts: 2 });
    expect(warnMock).toHaveBeenCalledTimes(2);
    const logEntries = warnMock.mock.calls.map(([entry]) => String(entry));
    expect(logEntries.map((entry) => JSON.parse(entry))).toEqual([
      expect.objectContaining({
        event: "ai_upstream_attempt",
        operation: "unspecified",
        provider: "deepseek",
        model: "deepseek-v4-pro",
        httpStatus: 200,
        fallbackReason: reason,
        outcome: "failure",
        attempt: 1,
        durationMs: expect.any(Number)
      }),
      expect.objectContaining({
        event: "ai_upstream_attempt",
        operation: "unspecified",
        provider: "deepseek",
        model: "deepseek-v4-pro",
        httpStatus: 200,
        fallbackReason: reason,
        outcome: "failure",
        attempt: 2,
        durationMs: expect.any(Number)
      })
    ]);
    for (const logEntry of logEntries) {
      expect(logEntry).not.toContain("private-profile-prompt");
      expect(logEntry).not.toContain("private-api-key");
      expect(logEntry).not.toContain("private-upstream-body");
    }
  });

  it("permits mock only in an explicitly marked test environment", async () => {
    process.env.AI_PROVIDER = "mock";
    delete process.env.AI_API_KEY;
    delete process.env.ALLOW_AI_MOCK;
    delete process.env.AI_TEST_MODE;

    await expect(requestAiJson("return JSON")).resolves.toMatchObject({
      ok: false,
      reason: "mock_not_allowed",
      model: "mock"
    });

    process.env.ALLOW_AI_MOCK = "1";
    process.env.AI_TEST_MODE = "1";
    await expect(requestAiJson("return JSON")).resolves.toMatchObject({
      ok: false,
      reason: "mock_mode",
      model: "mock"
    });
  });

  it("fails safely without making a request when the API key is missing", async () => {
    delete process.env.AI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestAiJson("return JSON", { maxAttempts: 2 })).resolves.toMatchObject({
      ok: false,
      reason: "missing_api_key",
      attempts: 1
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("competition recommendation input", () => {
  it("accepts the complete ProfileV4 and rejects missing, legacy, or unknown fields", () => {
    expect(competitionRecommendationProfileSchema.safeParse(legacyProfile).success).toBe(true);
    expect(competitionRecommendationProfileSchema.safeParse({ ...legacyProfile, school: "某大学" }).success).toBe(false);
    const { majorFields: _majorFields, ...missingCoreField } = legacyProfile;
    expect(competitionRecommendationProfileSchema.safeParse(missingCoreField).success).toBe(false);
    expect(competitionRecommendationProfileSchema.safeParse({ ...legacyProfile, profileVersion: "competition-profile.v2" }).success).toBe(false);
    expect(competitionRecommendationProfileSchema.safeParse({ ...legacyProfile, availableResources: ["none", "mentor"] }).success).toBe(false);
  });

  it("accepts only a confirmed questionnaire token or signed-conversation request", () => {
    expect(competitionClarifyRequestSchema.safeParse({
      aiConsent: { accepted: false, version: "test.v1" },
      profile,
      recentSignalKeys: ["competition-fit", "candidate-goal-tradeoff"]
    }).success).toBe(false);
    expect(competitionClarifyRequestSchema.safeParse({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: "x".repeat(40),
      recentSignalKeys: ["competition-fit", "candidate-goal-tradeoff"]
    }).success).toBe(true);
    expect(competitionClarifyRequestSchema.safeParse({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: "x".repeat(40),
      answer: { selectedValues: ["product-validation"], note: "周末可以集中投入" }
    }).success).toBe(true);
    expect(competitionClarifyRequestSchema.safeParse({
      aiConsent: { accepted: true, version: "test.v1" },
      profile,
      askedQuestionIds: []
    }).success).toBe(false);

    const requestAtLimit = {
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: "x".repeat(COMPETITION_CONVERSATION_TOKEN_MAX_LENGTH),
      answer: { selectedValues: ["product-validation"] }
    };
    expect(competitionClarifyRequestSchema.safeParse(requestAtLimit).success).toBe(true);
    expect(competitionClarifyRequestSchema.safeParse({
      ...requestAtLimit,
      conversationToken: `${requestAtLimit.conversationToken}x`
    }).success).toBe(false);
    expect(competitionClarifyRequestSchema.safeParse({
      ...requestAtLimit,
      recentSignalKeys: Array.from({ length: 25 }, () => "competition-fit")
    }).success).toBe(false);
    expect(competitionClarifyRequestSchema.safeParse({
      ...requestAtLimit,
      recentSignalKeys: ["model-authored-signal"]
    }).success).toBe(false);
  });
});

describe("dynamic competition questions", () => {
  it("applies bare-name detection only to user-entered text", () => {
    expect(containsCompetitionNotePersonalInfo("王一鸣")).toBe(true);
    expect(containsCompetitionGeneratedTextPersonalInfo("王一鸣")).toBe(false);
    expect(containsCompetitionNotePersonalInfo("名字：鹿晗羽")).toBe(true);
    expect(containsCompetitionGeneratedTextPersonalInfo("名字：鹿晗羽")).toBe(true);
  });

  it("normalizes prompt fingerprints with NFKC and without whitespace or punctuation", () => {
    expect(competitionDynamicPromptFingerprint("ＡＢＣ， 资格？"))
      .toBe(competitionDynamicPromptFingerprint("abc资格?"));
  });

  it("keeps dynamic notes in signed state but removes them from downstream AI context", () => {
    const marker = "SYSTEM_OVERRIDE_CANDIDATE_ORDER";
    const sanitized = sanitizeCompetitionTranscriptForAi([{
      question: dynamicQuestion,
      answer: { selectedValues: ["product-validation"], note: marker }
    }]);

    expect(sanitized[0]?.answer.selectedValues).toEqual(["product-validation"]);
    expect(sanitized[0]?.answer.note).toBeUndefined();
    expect(JSON.stringify(sanitized)).not.toContain(marker);
  });

  it.each([
    "全国大学生数学建模竞赛",
    "高校大学生创新创业大赛",
    "我是大学生",
    "作为一名大学生",
    "周末",
    ...competitionPiiSafeControlTexts
  ])("allows a non-identifying competition note: %s", (note) => {
    expect(containsCompetitionNotePersonalInfo(note)).toBe(false);
    expect(parseCompetitionDynamicAnswer(dynamicQuestion, {
      selectedValues: ["product-validation"],
      note
    })).toMatchObject({ note });
  });

  it("does not classify the reusable non-PII interpretation fixture as personal information", () => {
    const falsePositives = competitionFreeTextSamples
      .filter(({ category }) => category !== "pii")
      .filter(({ text }) => containsCompetitionNotePersonalInfo(text));

    expect(
      falsePositives.map(({ id, text }) => `${id}: ${text}`),
      falsePositives.map(({ id, text }) => `${id}: ${text}`).join("\n")
    ).toEqual([]);
  });

  it.each([
    "清华大学生",
    "清华大学生参加竞赛",
    "北京大学生物系学生",
    "清华",
    "北大计算机系",
    "张三，想参加编程比赛",
    "张\u200B三，想参加编程比赛",
    "微信号: zhangsan_2026",
    "QQ：12345678",
    "学号: 2026123456",
    "家住北京市海淀区中关村大街27号",
    "座机010-12345678",
    "手机号 １３８-１２３４-５６７８",
    ...competitionPiiRegressionTexts
  ])("rejects a personal-information competition note: %s", (note) => {
    expect(containsCompetitionNotePersonalInfo(note)).toBe(true);
    expect(parseCompetitionDynamicAnswer(dynamicQuestion, {
      selectedValues: ["product-validation"],
      note
    })).toBeNull();
  });

  it("allows generic competition names containing 大学生 without accepting a school name", () => {
    expect(competitionDynamicQuestionV3Schema.safeParse({
      ...dynamicQuestion,
      prompt: "针对全国大学生数学建模竞赛，你想优先展示哪类能力？"
    }).success).toBe(true);
    expect(competitionDynamicQuestionV3Schema.safeParse({
      ...dynamicQuestion,
      prompt: "请填写你的北京大学参赛资格信息"
    }).success).toBe(false);
  });

  it("accepts a bounded original question and validates its answer against signed options", () => {
    expect(competitionDynamicQuestionV3Schema.safeParse(dynamicQuestion).success).toBe(true);
    expect(parseCompetitionDynamicAnswer(dynamicQuestion, { selectedValues: ["product-validation"] })).toEqual({
      selectedValues: ["product-validation"]
    });
    expect(parseCompetitionDynamicAnswer(dynamicQuestion, { selectedValues: ["invented"] })).toBeNull();
    expect(parseCompetitionDynamicAnswer(dynamicQuestion, { selectedValues: ["product-validation", "research-provenance"] })).toBeNull();
    expect(parseCompetitionDynamicAnswer(dynamicQuestion, {
      selectedValues: ["product-validation"],
      note: "手机 13800138000"
    })).toBeNull();
  });

  it("enforces the selection contract for every current preference family", () => {
    expect(competitionDynamicQuestionV3Schema.safeParse({
      ...dynamicQuestion,
      selection: "single",
      maxSelections: 1
    }).success).toBe(false);
    expect(competitionDynamicQuestionV3Schema.safeParse({
      ...dynamicQuestion,
      signalKey: "track:test-competition",
      selection: "multiple",
      maxSelections: 2,
      options: [
        { value: "track-a", label: "赛道甲" },
        { value: "track-b", label: "赛道乙" }
      ]
    }).success).toBe(false);
    expect(competitionDynamicQuestionV3Schema.safeParse({
      ...goalQuestion,
      options: [
        { value: "project", label: "项目经历" },
        { value: "award", label: "竞赛奖项" },
        { value: "postgraduate", label: "科研升学" },
        { value: "employment", label: "就业能力" },
        { value: "portfolio", label: "作品集" }
      ]
    }).success).toBe(false);
  });

  it.each([
    [{ ...dynamicQuestion, prompt: "请填写所在学校名称" }, "sensitive solicitation"],
    [{ ...dynamicQuestion, prompt: "请填写你的具体学校" }, "specific school form field"],
    [{ ...dynamicQuestion, prompt: "你在哪所学校就读？" }, "natural-language school solicitation"],
    [{ ...dynamicQuestion, prompt: "你就读于哪所大学？" }, "university solicitation"],
    [{ ...dynamicQuestion, prompt: "你的学校叫什么名字？" }, "school-name question"],
    [{ ...dynamicQuestion, prompt: "你的学校是？" }, "direct school question"],
    [{ ...dynamicQuestion, prompt: "来自哪个学校？" }, "school-origin question"],
    [{ ...dynamicQuestion, prompt: "请填写学校" }, "bare school form field"],
    [{ ...dynamicQuestion, prompt: "你的名字是什么？" }, "natural-language identity solicitation"],
    [{ ...dynamicQuestion, options: [{ value: "a", label: "北京大学" }, { value: "b", label: "其他方向" }] }, "school entity option"],
    [{ ...dynamicQuestion, options: [{ value: "a", label: "13800138000" }, { value: "b", label: "其他方式" }] }, "contact option"],
    [{ ...dynamicQuestion, prompt: "请打开 https://example.com" }, "URL"],
    [{ ...dynamicQuestion, prompt: "请查看 example.io" }, "generic domain"],
    [{ ...dynamicQuestion, prompt: "请发送到 mailto:demo@example.io" }, "URI scheme"],
    [{ ...dynamicQuestion, prompt: "**请选择**" }, "Markdown"],
    [{ ...dynamicQuestion, options: [{ value: "same", label: "相同" }, { value: "same", label: "不同" }] }, "duplicate option"]
  ])("rejects generated question content containing %s", (input) => {
    expect(competitionDynamicQuestionV3Schema.safeParse(input).success).toBe(false);
  });

  it.each(["学历阶段", "团队人数", "参赛人数", "地区", "是否符合官方条件"]) (
    "rejects forbidden fixed-qualification wording in prompts and option labels: %s",
    (forbiddenText) => {
      expect(competitionDynamicQuestionV3Schema.safeParse({
        ...dynamicQuestion,
        prompt: `请补充${forbiddenText}偏好`
      }).success).toBe(false);
      expect(competitionDynamicQuestionV3Schema.safeParse({
        ...dynamicQuestion,
        options: [
          { ...dynamicQuestion.options[0], label: `${forbiddenText}选项` },
          dynamicQuestion.options[1]
        ]
      }).success).toBe(false);
    }
  );

  it.each([
    "已创业类",
    "未创业类",
    "项目已完成工商登记",
    "本科生创意组",
    "研究生组",
    "高职组",
    "职业院校赛道",
    "学生组",
    "在校学生作品组",
    "成长赛道",
    "就业赛道"
  ])("rejects factual identity classifications in prompts and option labels: %s", (classification) => {
    expect(competitionDynamicQuestionV3Schema.safeParse({
      ...dynamicQuestion,
      prompt: `请选择${classification}`
    }).success).toBe(false);
    expect(competitionDynamicQuestionV3Schema.safeParse({
      ...dynamicQuestion,
      options: [
        { ...dynamicQuestion.options[0], label: classification },
        dynamicQuestion.options[1]
      ]
    }).success).toBe(false);
  });

  it("does not confuse content groups such as English tracks with identity groups", () => {
    expect(competitionDynamicQuestionV3Schema.safeParse({
      ...dynamicQuestion,
      options: [
        { ...dynamicQuestion.options[0], label: "英语组短视频" },
        { ...dynamicQuestion.options[1], label: "英语组笔译" }
      ]
    }).success).toBe(true);
  });

  it("selects and materializes preference questions entirely on the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const candidates = getCompetitionRecommendationCandidates(profile).recommendations;
    const snapshot = buildCompetitionQualificationSnapshot(profile);
    const selected = selectAskableQuestionForTurn(
      buildCompetitionClarifyAskableContext(profile, candidates, [], [], snapshot)
    );
    const result = await generateNextCompetitionQuestion(profile, [], candidates, [], snapshot);

    expect(selected?.signalKey).toMatch(/^(?:competition-fit|candidate-goal-tradeoff|track:)/);
    expect(result).toMatchObject({
      ok: true,
      fallback: false,
      provider: "server",
      promptVersion: "competition-clarify.v8"
    });
    if (selected) {
      expect(result.nextQuestion).toEqual(materializeCompetitionClarifyQuestion(selected, 1));
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("competition conversation token", () => {
  it("requires the complete unique fixed-questionnaire context and its fixed eligibility facts", () => {
    const completeContext = buildCompetitionQuestionnaireRawContext(profile);
    expect(() => createCompetitionConversationToken({
      profile,
      rawAnswerContext: completeContext.slice(1),
      transcript: completedTranscript,
      pendingQuestion: null,
      completed: true
    })).toThrow(/every signed fixed-questionnaire field exactly once/);

    expect(() => createCompetitionConversationToken({
      profile,
      rawAnswerContext: [completeContext[0], ...completeContext.slice(1, -1), completeContext[0]],
      transcript: completedTranscript,
      pendingQuestion: null,
      completed: true
    })).toThrow(/every signed fixed-questionnaire field exactly once/);

    const profileWithoutFixedFacts: CompetitionRecommendationProfileV5 = {
      ...profile,
      confirmedFacts: [],
      enrollmentStatus: undefined,
      teamUnit: undefined,
      teamSize: undefined
    };
    expect(() => createCompetitionConversationToken({
      profile: profileWithoutFixedFacts,
      rawAnswerContext: completeContext,
      transcript: completedTranscript,
      pendingQuestion: null,
      completed: true
    })).toThrow(/every signed fixed-questionnaire field exactly once/);
  });

  it("round-trips the optional first-higher-education year only as the twentieth signed field", () => {
    const profileWithYear: CompetitionRecommendationProfileV5 = {
      ...profile,
      confirmedFacts: ["enrollmentStatus", "firstHigherEducationYear", "teamUnit", "teamSize"],
      firstHigherEducationYear: 2022
    };
    const rawAnswerContext = buildCompetitionQuestionnaireRawContext(profileWithYear);
    expect(rawAnswerContext).toHaveLength(20);
    const token = createCompetitionConversationToken({
      profile: profileWithYear,
      rawAnswerContext,
      transcript: completedTranscript,
      pendingQuestion: null,
      completed: true
    }, new Date("2026-08-22T00:00:00Z"));
    expect(verifyCompetitionConversationToken(token, new Date("2026-08-22T00:10:00Z"))).toMatchObject({
      ok: true,
      payload: {
        profile: { firstHigherEducationYear: 2022 },
        rawAnswerContext: expect.arrayContaining([{
          fieldId: "firstHigherEducationYear",
          selectedValues: ["2022"]
        }])
      }
    });
  });

  it("accepts an exactly 48 KiB signed token and rejects the next byte", () => {
    const compact = createCompetitionConversationToken({
      profile,
      transcript: completedTranscript,
      pendingQuestion: null,
      completed: true
    }, new Date("2026-08-22T00:00:00Z"));
    const [compactPayload] = compact.split(".");
    const payloadJson = Buffer.from(compactPayload, "base64url").toString("utf8");
    const targetEncodedLength = COMPETITION_CONVERSATION_TOKEN_MAX_LENGTH - 1 - 43;
    let targetPayloadBytes = Math.floor(targetEncodedLength * 3 / 4);
    while (Buffer.alloc(targetPayloadBytes).toString("base64url").length < targetEncodedLength) {
      targetPayloadBytes += 1;
    }
    while (Buffer.alloc(targetPayloadBytes).toString("base64url").length > targetEncodedLength) {
      targetPayloadBytes -= 1;
    }
    const paddedPayloadJson = `${payloadJson}${" ".repeat(targetPayloadBytes - Buffer.byteLength(payloadJson))}`;
    const encodedPayload = Buffer.from(paddedPayloadJson).toString("base64url");
    expect(encodedPayload.length).toBe(targetEncodedLength);
    const encodedSignature = createHmac(
      "sha256",
      process.env.AI_CONVERSATION_SIGNING_SECRET!
    ).update(encodedPayload).digest("base64url");
    const boundaryToken = `${encodedPayload}.${encodedSignature}`;

    expect(boundaryToken.length).toBe(COMPETITION_CONVERSATION_TOKEN_MAX_LENGTH);
    expect(verifyCompetitionConversationToken(
      boundaryToken,
      new Date("2026-08-22T00:10:00Z")
    )).toMatchObject({ ok: true });
    expect(verifyCompetitionConversationToken(
      `${boundaryToken}x`,
      new Date("2026-08-22T00:10:00Z")
    )).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("round-trips a signed pending question and rejects tampering", () => {
    const token = createCompetitionConversationToken({
      profile,
      transcript: [],
      pendingQuestion: dynamicQuestion,
      completed: false
    }, new Date("2026-08-22T00:00:00Z"));
    expect(verifyCompetitionConversationToken(token, new Date("2026-08-22T00:10:00Z"))).toMatchObject({
      ok: true,
      payload: {
        version: COMPETITION_CONVERSATION_TOKEN_VERSION,
        catalogVersion: COMPETITION_CATALOG_VERSION,
        scorerVersion: COMPETITION_SCORER_VERSION,
        profile,
        pendingQuestion: dynamicQuestion,
        completed: false
      }
    });
    const [payload, encodedSignature] = token.split(".");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const finalIndex = alphabet.indexOf(encodedSignature.at(-1)!);
    const nonCanonicalFinal = alphabet[(finalIndex & ~3) | 1];
    const nonCanonicalSignature = `${encodedSignature.slice(0, -1)}${nonCanonicalFinal}`;
    expect(Buffer.from(nonCanonicalSignature, "base64url")).toEqual(Buffer.from(encodedSignature, "base64url"));
    expect(verifyCompetitionConversationToken(
      `${payload}.${nonCanonicalSignature}`,
      new Date("2026-08-22T00:10:00Z")
    )).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("rejects same-round duplicate preference families and normalized prompt fingerprints", () => {
    const firstTrackQuestion: CompetitionDynamicQuestionV3 = {
      questionId: "dq_track_first",
      signalKey: "track:first",
      prompt: "《测试竞赛甲》的候选方向中，你优先准备哪个赛道？",
      selection: "single",
      options: [
        { value: "track-a", label: "方向甲" },
        { value: "track-b", label: "方向乙" }
      ],
      allowsNote: true,
      maxNoteLength: 120,
      impact: "material",
      estimatedPreferenceOutcomeChanges: 2
    };
    const duplicateFamilyQuestion: CompetitionDynamicQuestionV3 = {
      ...firstTrackQuestion,
      questionId: "dq_track_second",
      signalKey: "track:second",
      prompt: "《测试竞赛乙》的候选方向中，你优先准备哪个赛道？"
    };
    expect(() => createCompetitionConversationToken({
      profile,
      transcript: [{ question: firstTrackQuestion, answer: { selectedValues: ["track-a"] } }],
      pendingQuestion: duplicateFamilyQuestion,
      completed: false
    })).toThrow(/Question families must be unique/);

    const firstPromptQuestion: CompetitionDynamicQuestionV3 = {
      ...dynamicQuestion,
      questionId: "dq_fingerprint_fit",
      prompt: "请选择：当前方向？"
    };
    const duplicatePromptQuestion: CompetitionDynamicQuestionV3 = {
      ...goalQuestion,
      questionId: "dq_fingerprint_goal",
      prompt: "请选择 当前方向?"
    };
    expect(() => createCompetitionConversationToken({
      profile,
      transcript: [{ question: firstPromptQuestion, answer: { selectedValues: ["product-validation"] } }],
      pendingQuestion: duplicatePromptQuestion,
      completed: false
    })).toThrow(/Question prompt fingerprints must be unique/);
  });

  it("reports the policy change for correctly signed conversation V4 tokens", () => {
    const token = createCompetitionConversationToken({
      profile,
      transcript: [],
      pendingQuestion: dynamicQuestion,
      completed: false
    }, new Date("2026-08-22T00:00:00Z"));
    const [encodedPayload] = token.split(".");
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    payload.version = "competition-conversation.v4";
    const stalePayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const staleSignature = createHmac(
      "sha256",
      process.env.AI_CONVERSATION_SIGNING_SECRET!
    ).update(stalePayload).digest("base64url");

    expect(verifyCompetitionConversationToken(
      `${stalePayload}.${staleSignature}`,
      new Date("2026-08-22T00:10:00Z")
    )).toEqual({ ok: false, reason: "policy_changed" });
  });

  it("rejects correctly signed tokens from a stale catalog or scorer version", () => {
    const token = createCompetitionConversationToken({
      profile,
      transcript: completedTranscript,
      pendingQuestion: null,
      completed: true
    }, new Date("2026-08-22T00:00:00Z"));
    const [encodedPayload] = token.split(".");
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    payload.catalogVersion = "stale-catalog.v0";
    payload.scorerVersion = "stale-scorer.v0";
    const stalePayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const staleSignature = createHmac(
      "sha256",
      process.env.AI_CONVERSATION_SIGNING_SECRET!
    ).update(stalePayload).digest("base64url");

    expect(verifyCompetitionConversationToken(
      `${stalePayload}.${staleSignature}`,
      new Date("2026-08-22T00:10:00Z")
    )).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("expires after the bounded lifetime", () => {
    const token = createCompetitionConversationToken({ profile, transcript: completedTranscript, pendingQuestion: null, completed: true }, new Date(0));
    expect(verifyCompetitionConversationToken(token, new Date(31 * 60 * 1000))).toEqual({
      ok: false,
      reason: "expired_token"
    });
  });
});

describe("competition AI model configuration", () => {
  it("uses a deterministic policy model for questions regardless of AI model variables", () => {
    process.env.AI_MODEL = "shared-model";
    process.env.AI_COMPETITION_CLARIFY_MODEL = "configured-clarify";
    process.env.AI_COMPETITION_RECOMMEND_MODEL = "configured-recommend";

    expect(getCompetitionClarifyModel()).toBe("deterministic-preference-policy.v1");
    expect(getCompetitionRecommendModel()).toBe("configured-recommend");
  });

  it("falls back from dedicated variables to the shared model", () => {
    delete process.env.AI_COMPETITION_CLARIFY_MODEL;
    delete process.env.AI_COMPETITION_RECOMMEND_MODEL;
    process.env.AI_MODEL = "shared-model";

    expect(getCompetitionClarifyModel()).toBe("deterministic-preference-policy.v1");
    expect(getCompetitionRecommendModel()).toBe("shared-model");
  });

  it("uses DeepSeek V4 Pro when no model variable is configured", () => {
    delete process.env.AI_COMPETITION_CLARIFY_MODEL;
    delete process.env.AI_COMPETITION_RECOMMEND_MODEL;
    delete process.env.AI_MODEL;

    expect(getCompetitionClarifyModel()).toBe("deterministic-preference-policy.v1");
    expect(getCompetitionRecommendModel()).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(DEFAULT_DEEPSEEK_MODEL).toBe("deepseek-v4-pro");
  });
});
