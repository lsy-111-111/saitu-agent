import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/competitions/recommend/normalize/route";
import {
  COMPETITION_QUESTIONNAIRE_TOKEN_TTL_SECONDS,
  competitionQuestionnaireV1Schema,
  createCompetitionQuestionnaireToken,
  normalizeCompetitionQuestionnaire,
  verifyCompetitionQuestionnaireToken
} from "../../src/lib/ai/competition-questionnaire";
import {
  rateLimitStateSnapshotForTests,
  resetRateLimitStateForTests
} from "../../src/lib/security/rate-limit";
import type {
  CompetitionQuestionnaireFieldId,
  CompetitionQuestionnaireV1
} from "../../src/types/competition-recommendation";
import { competitionPiiRegressionTexts } from "../fixtures/competition-pii-regression";

const originalEnv = { ...process.env };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const completeResourceSet = [
  "mentor",
  "lab",
  "equipment",
  "data",
  "budget",
  "school-registration",
  "safety-compliance"
] as const;

type FieldAnswer = {
  fieldId: CompetitionQuestionnaireFieldId;
  selectedValues: string[];
  freeText?: string;
};

const questionFields = {
  stage: ["stage", "enrollmentStatus"],
  majorFields: ["majorFields", "specificSubjects"],
  skills: ["skills"], interests: ["interests"], taskFormats: ["taskFormats"], goals: ["goals"],
  preferredOutputs: ["preferredOutputs"], startingPoint: ["startingPoint"],
  experienceLevel: ["experienceLevel", "evidence"], weeklyCommitment: ["weeklyCommitment"],
  participationTiming: ["participationTiming"], teamStatus: ["teamStatus", "teamSize", "teamUnit"],
  availableResources: ["availableResources"], participationMode: ["participationMode"]
} as const satisfies Readonly<Record<CompetitionQuestionnaireV1["answers"][number]["fieldId"], readonly CompetitionQuestionnaireFieldId[]>>;

function questionnaire(overrides: Partial<Record<CompetitionQuestionnaireFieldId, FieldAnswer>> = {}): CompetitionQuestionnaireV1 {
  const baseFields: FieldAnswer[] = [
    { fieldId: "stage", selectedValues: ["undergraduate-3"] },
    { fieldId: "majorFields", selectedValues: ["computer-science"] },
    { fieldId: "specificSubjects", selectedValues: ["information-communication"] },
    { fieldId: "skills", selectedValues: ["programming"] },
    { fieldId: "interests", selectedValues: ["ai"] },
    { fieldId: "goals", selectedValues: ["project"] },
    { fieldId: "preferredOutputs", selectedValues: ["software"] },
    { fieldId: "startingPoint", selectedValues: ["prototype"] },
    { fieldId: "weeklyCommitment", selectedValues: ["5-10"] },
    { fieldId: "teamStatus", selectedValues: ["partial"] },
    { fieldId: "availableResources", selectedValues: ["mentor"] },
    { fieldId: "participationMode", selectedValues: ["flexible"] },
    { fieldId: "participationTiming", selectedValues: ["current-cycle"] },
    { fieldId: "taskFormats", selectedValues: ["software"] },
    { fieldId: "experienceLevel", selectedValues: ["participated"] },
    { fieldId: "evidence", selectedValues: ["project"] },
    { fieldId: "enrollmentStatus", selectedValues: ["full-time-student"] },
    { fieldId: "teamSize", selectedValues: ["three"] },
    { fieldId: "teamUnit", selectedValues: ["same-unit"] }
  ];
  const fields = baseFields.map((answer) => overrides[answer.fieldId] ?? answer);
  return {
    version: "competition-questionnaire.v1",
    answers: Object.entries(questionFields).map(([questionId, fieldIds]) => {
      const answers = fieldIds.map((fieldId) => fields.find((answer) => answer.fieldId === fieldId)!);
      const freeText = answers.find((answer) => answer.freeText)?.freeText;
      return {
        fieldId: questionId as CompetitionQuestionnaireV1["answers"][number]["fieldId"],
        selectedValues: answers.flatMap((answer) =>
          answer.selectedValues.map((value) => `${answer.fieldId}:${value}`)
        ),
        ...(freeText ? { freeText } : {})
      };
    })
  };
}

function request(
  body: unknown,
  ip = "198.51.100.90",
  idempotencyKey?: string
) {
  return new Request("http://localhost/api/competitions/recommend/normalize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    body: JSON.stringify(body)
  });
}

function aiResponse(value: unknown) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

beforeEach(() => {
  process.env.FEATURE_AI = "1";
  process.env.FEATURE_COMPETITION_RECOMMENDER = "1";
  process.env.AI_CONSENT_VERSION = "test.v1";
  process.env.AI_PROVIDER = "mock";
  process.env.AI_TEST_MODE = "1";
  process.env.ALLOW_AI_MOCK = "1";
  process.env.AI_CONVERSATION_SIGNING_SECRET = "test-signing-secret-at-least-thirty-two-characters";
  resetRateLimitStateForTests();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("POST /api/competitions/recommend/normalize", () => {
  it("replays one semantic questionnaire when answer and selected-value order changes", async () => {
    const canonical = questionnaire({
      skills: {
        fieldId: "skills",
        selectedValues: ["hardware", "programming"]
      }
    });
    const permuted: CompetitionQuestionnaireV1 = {
      ...canonical,
      answers: [...canonical.answers].reverse().map((answer) => ({
        ...answer,
        selectedValues: [...answer.selectedValues].reverse()
      }))
    };
    const idempotencyKey = "normalize-semantic-questionnaire-0001";
    const first = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: canonical
    }, "198.51.100.146", idempotencyKey));
    const firstBody = await first.json();
    const stateAfterOwner = rateLimitStateSnapshotForTests();
    const replay = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: permuted
    }, "198.51.100.146", idempotencyKey));
    const replayBody = await replay.json();

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("X-Idempotent-Replay")).toBe("true");
    expect(replayBody).toEqual(firstBody);
    expect(rateLimitStateSnapshotForTests()).toEqual(stateAfterOwner);
  });

  it("returns a signed canonical Profile V5 when every answer is an explicit whitelist value", async () => {
    const response = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: questionnaire()
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      status: "confirmed",
      profile: {
        profileVersion: "competition-profile.v5",
        questionnaireVersion: "competition-questionnaire.v1",
        participationTiming: "current-cycle",
        taskFormats: ["software"]
      },
      questionnaireToken: expect.any(String),
      aiUsed: false
    });
    expect(body.profile).not.toHaveProperty("region");
    expect(verifyCompetitionQuestionnaireToken(body.questionnaireToken)).toMatchObject({
      ok: true,
      payload: {
        version: "competition-questionnaire-token.v2",
        sessionId: expect.stringMatching(uuidPattern),
        nonce: expect.stringMatching(uuidPattern),
        confirmed: true,
        profile: {
          profileVersion: "competition-profile.v5",
          confirmedFacts: ["enrollmentStatus", "teamUnit", "teamSize"]
        },
        rawAnswerContext: expect.arrayContaining([{ fieldId: "skills", selectedValues: ["programming"] }])
      }
    });
    const verified = verifyCompetitionQuestionnaireToken(body.questionnaireToken);
    expect(verified.ok && verified.payload.rawAnswerContext).toHaveLength(19);
    if (verified.ok) expect(verified.payload.sessionId).not.toBe(verified.payload.nonce);
  });

  it("accepts exactly fourteen unique visible-question envelopes and rejects the legacy expanded shape", () => {
    const compact = questionnaire();
    const expectedQuestionIds = Object.keys(questionFields).sort();

    expect(compact.answers).toHaveLength(14);
    expect(compact.answers.map(({ fieldId }) => fieldId).sort()).toEqual(expectedQuestionIds);
    expect(competitionQuestionnaireV1Schema.safeParse(compact).success).toBe(true);

    const legacyExpanded = {
      version: compact.version,
      answers: compact.answers.flatMap((answer) => answer.selectedValues.map((encoded) => {
        const separator = encoded.indexOf(":");
        return {
          fieldId: encoded.slice(0, separator),
          selectedValues: [encoded.slice(separator + 1)]
        };
      }))
    };
    expect(legacyExpanded.answers.length).toBeGreaterThan(14);
    expect(competitionQuestionnaireV1Schema.safeParse(legacyExpanded).success).toBe(false);

    const duplicate = structuredClone(compact);
    duplicate.answers[13] = { ...duplicate.answers[0] };
    expect(competitionQuestionnaireV1Schema.safeParse(duplicate).success).toBe(false);
  });

  it("extracts a necessary first-higher-education year inside the first visible answer", () => {
    const withYear = questionnaire({
      stage: {
        fieldId: "stage",
        selectedValues: ["undergraduate-3"],
        freeText: "我在 2022 年首次接受高等教育"
      }
    });
    const normalized = normalizeCompetitionQuestionnaire(withYear);

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.questionnaire.answers).toHaveLength(20);
    expect(normalized.interpretations.find(({ fieldId }) => fieldId === "firstHigherEducationYear")).toMatchObject({
      suggestedValues: ["2022"],
      status: "ready",
      requiresConfirmation: true
    });
  });

  it("preserves the original free text and requires signed confirmation before adopting its suggestion", async () => {
    const freeTextQuestionnaire = questionnaire({
      skills: { fieldId: "skills", selectedValues: [], freeText: "编程" }
    });
    const normalized = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: freeTextQuestionnaire
    }, "198.51.100.91"));
    const normalizedBody = await normalized.json();

    expect(normalizedBody).toMatchObject({
      status: "needs_confirmation",
      interpretations: expect.arrayContaining([expect.objectContaining({
        fieldId: "skills",
        originalText: "编程",
        evidenceSpan: "编程",
        suggestedValues: ["programming"],
        status: "ready",
        requiresConfirmation: true
      })])
    });
    const pendingToken = verifyCompetitionQuestionnaireToken(normalizedBody.questionnaireToken);
    expect(pendingToken).toMatchObject({
      ok: true,
      payload: {
        version: "competition-questionnaire-token.v2",
        sessionId: expect.stringMatching(uuidPattern),
        nonce: expect.stringMatching(uuidPattern),
        confirmed: false
      }
    });
    if (!pendingToken.ok) throw new Error("pending questionnaire token must verify");

    const confirmed = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: normalizedBody.questionnaireToken,
      confirmations: [{ fieldId: "skills", values: ["programming"] }]
    }, "198.51.100.92"));
    const confirmedBody = await confirmed.json();
    expect(confirmedBody).toMatchObject({
      status: "confirmed",
      profile: { profileVersion: "competition-profile.v5", skills: ["programming"] }
    });
    const verified = verifyCompetitionQuestionnaireToken(confirmedBody.questionnaireToken);
    expect(verified.ok && verified.payload.rawAnswerContext).toHaveLength(19);
    if (verified.ok) {
      expect(verified.payload).toMatchObject({
        sessionId: pendingToken.payload.sessionId,
        issuedAt: pendingToken.payload.issuedAt,
        expiresAt: pendingToken.payload.expiresAt,
        confirmed: true
      });
      expect(verified.payload.nonce).not.toBe(pendingToken.payload.nonce);
      expect(verified.payload.rawAnswerContext.find(({ fieldId }) => fieldId === "skills")).toMatchObject({
        selectedValues: [],
        freeText: "编程"
      });
    }
  });

  it("rejects a valid confirmation token that cannot outlive one full request budget", async () => {
    const normalized = normalizeCompetitionQuestionnaire(questionnaire({
      skills: { fieldId: "skills", selectedValues: [], freeText: "编程" }
    }));
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const token = createCompetitionQuestionnaireToken({
      rawAnswerContext: normalized.questionnaire.answers,
      interpretations: normalized.interpretations,
      profile: null,
      confirmed: false
    }, new Date(Date.now() - (COMPETITION_QUESTIONNAIRE_TOKEN_TTL_SECONDS - 64) * 1_000));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: token,
      confirmations: [{ fieldId: "skills", values: ["programming"] }]
    }, "198.51.100.149"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "QUESTIONNAIRE_EXPIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps one root session across two valid confirmation branches from the same pending token", async () => {
    const normalized = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: questionnaire({
        skills: { fieldId: "skills", selectedValues: [], freeText: "编程" }
      })
    }, "198.51.100.140"));
    const normalizedBody = await normalized.json();
    const pending = verifyCompetitionQuestionnaireToken(normalizedBody.questionnaireToken);
    expect(pending.ok).toBe(true);
    if (!pending.ok) throw new Error("pending questionnaire token must verify");

    const firstResponse = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: normalizedBody.questionnaireToken,
      confirmations: [{ fieldId: "skills", values: ["programming"] }]
    }, "198.51.100.141"));
    const secondResponse = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: normalizedBody.questionnaireToken,
      confirmations: [{ fieldId: "skills", values: ["hardware"] }]
    }, "198.51.100.142"));
    const firstBody = await firstResponse.json();
    const secondBody = await secondResponse.json();
    expect(firstBody).toMatchObject({ status: "confirmed", profile: { skills: ["programming"] } });
    expect(secondBody).toMatchObject({ status: "confirmed", profile: { skills: ["hardware"] } });

    const first = verifyCompetitionQuestionnaireToken(firstBody.questionnaireToken);
    const second = verifyCompetitionQuestionnaireToken(secondBody.questionnaireToken);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("confirmation branches must verify");
    for (const branch of [first.payload, second.payload]) {
      expect(branch.sessionId).toBe(pending.payload.sessionId);
      expect(branch.issuedAt).toBe(pending.payload.issuedAt);
      expect(branch.expiresAt).toBe(pending.payload.expiresAt);
      expect(branch.nonce).not.toBe(pending.payload.nonce);
    }
    expect(first.payload.nonce).not.toBe(second.payload.nonce);
  });

  it("replays a confirmation when only confirmation and value ordering changes", async () => {
    const normalized = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: questionnaire({
        skills: { fieldId: "skills", selectedValues: [], freeText: "编程和硬件" },
        interests: { fieldId: "interests", selectedValues: [], freeText: "人工智能" }
      })
    }, "198.51.100.143"));
    const normalizedBody = await normalized.json();
    expect(normalizedBody.status).toBe("needs_confirmation");

    const firstResponse = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: normalizedBody.questionnaireToken,
      confirmations: [
        { fieldId: "skills", values: ["hardware", "programming"] },
        { fieldId: "interests", values: ["ai"] }
      ]
    }, "198.51.100.144"));
    const firstBody = await firstResponse.json();
    const replayResponse = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: normalizedBody.questionnaireToken,
      confirmations: [
        { fieldId: "interests", values: ["ai"] },
        { fieldId: "skills", values: ["programming", "hardware"] }
      ]
    }, "198.51.100.145"));
    const replayBody = await replayResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(200);
    expect(firstResponse.headers.get("X-Idempotent-Replay")).toBeNull();
    expect(replayResponse.headers.get("X-Idempotent-Replay")).toBe("true");
    expect(replayBody).toEqual(firstBody);
    expect(replayBody).toMatchObject({
      status: "confirmed",
      profile: { skills: ["hardware", "programming"], interests: ["ai"] }
    });
  });

  it("rejects duplicate confirmation fields before consuming transition state", async () => {
    const normalized = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: questionnaire({
        skills: { fieldId: "skills", selectedValues: [], freeText: "编程和硬件" }
      })
    }, "198.51.100.147"));
    const normalizedBody = await normalized.json();
    expect(normalizedBody.status).toBe("needs_confirmation");
    const stateBeforeInvalidRequest = rateLimitStateSnapshotForTests();

    const response = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: normalizedBody.questionnaireToken,
      confirmations: [
        { fieldId: "skills", values: ["programming"] },
        { fieldId: "skills", values: ["hardware"] }
      ]
    }, "198.51.100.148"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_INPUT" });
    expect(rateLimitStateSnapshotForTests()).toEqual(stateBeforeInvalidRequest);
  });

  it("preserves and confirms the optional first-higher-education year as the twentieth signed field", async () => {
    const normalized = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: questionnaire({
        stage: {
          fieldId: "stage",
          selectedValues: ["undergraduate-3"],
          freeText: "我在 2022 年首次接受高等教育"
        }
      })
    }, "198.51.100.93"));
    const normalizedBody = await normalized.json();
    expect(normalizedBody.status).toBe("needs_confirmation");

    const confirmed = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: normalizedBody.questionnaireToken,
      confirmations: [
        { fieldId: "stage", values: ["undergraduate-3"] },
        { fieldId: "enrollmentStatus", values: ["full-time-student"] },
        { fieldId: "firstHigherEducationYear", values: ["2022"] }
      ]
    }, "198.51.100.94"));
    const confirmedBody = await confirmed.json();
    expect(confirmedBody).toMatchObject({
      status: "confirmed",
      profile: {
        firstHigherEducationYear: 2022,
        confirmedFacts: ["enrollmentStatus", "firstHigherEducationYear", "teamUnit", "teamSize"]
      }
    });
    const verified = verifyCompetitionQuestionnaireToken(confirmedBody.questionnaireToken);
    expect(verified.ok && verified.payload.rawAnswerContext).toHaveLength(20);
    if (verified.ok) {
      expect(verified.payload.rawAnswerContext).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldId: "firstHigherEducationYear", freeText: "我在 2022 年首次接受高等教育" })
      ]));
    }
  });

  it("rejects expanded PII forms before AI, token creation or logging", async () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.AI_API_KEY = "test-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(competitionQuestionnaireV1Schema.safeParse(questionnaire()).success).toBe(true);

    for (const [index, freeText] of competitionPiiRegressionTexts.entries()) {
      const piiQuestionnaire = questionnaire({
        skills: { fieldId: "skills", selectedValues: ["programming"], freeText }
      });
      expect(competitionQuestionnaireV1Schema.safeParse(piiQuestionnaire).success, freeText).toBe(false);
      const response = await POST(request({
        aiConsent: { accepted: true, version: "test.v1" },
        questionnaire: piiQuestionnaire
      }, `198.51.101.${index + 1}`));
      const body = await response.json();

      expect(response.status, freeText).toBe(400);
      expect(body, freeText).toEqual({ ok: false, error: "INVALID_INPUT" });
      expect(JSON.stringify(body), freeText).not.toContain(freeText);
    }

    expect(fetchMock).not.toHaveBeenCalled();
    const logged = [console.info, console.warn, console.error]
      .flatMap((logger) => vi.mocked(logger).mock.calls.flat())
      .join("\n");
    for (const freeText of competitionPiiRegressionTexts) {
      expect(logged).not.toContain(freeText);
    }
  });

  it("maps punctuation-bearing UI labels and bounded common input mistakes before calling AI", () => {
    const samples = [
      ["majorFields", "化学、化工与材料", "chemistry-materials"],
      ["majorFields", "财会、金融与税务", "finance-taxation"],
      ["skills", "演讲、路演与答辩", "presentation"],
      ["skills", "数据分析建摸", "data-analysis"],
      ["interests", "人工智能和A1", "ai"],
      ["availableResources", "有实验室和创客间", "lab"],
      ["participationTiming", "下一届也可", "next-cycle-ok"],
      ["enrollmentStatus", "刚毕业不到五年", "recent-graduate"]
    ] as const;

    for (const [fieldId, freeText, expected] of samples) {
      const normalized = normalizeCompetitionQuestionnaire(questionnaire({
        [fieldId]: { fieldId, selectedValues: [], freeText }
      }));
      expect(normalized.ok, `${fieldId}: ${freeText}`).toBe(true);
      if (!normalized.ok) continue;
      expect(
        normalized.interpretations.find((item) => item.fieldId === fieldId)?.suggestedValues,
        `${fieldId}: ${freeText}`
      ).toEqual([expected]);
    }
  });

  it("uses DeepSeek only for unresolved natural language and assigns server confidence", async () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.AI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(aiResponse({
      mappings: [{
        fieldId: "skills",
        status: "unique",
        values: ["programming"],
        evidenceSpan: "Python写项目",
        rationale: "原文明确描述了编程项目经验。"
      }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: questionnaire({
        skills: { fieldId: "skills", selectedValues: [], freeText: "平时用Python写项目" }
      })
    }, "198.51.100.93"));
    const body = await response.json();
    const interpretation = body.interpretations.find((item: { fieldId: string }) => item.fieldId === "skills");

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "needs_confirmation", aiUsed: true, promptVersion: "competition-normalize.v1" });
    expect(interpretation).toMatchObject({
      source: "model",
      confidence: 0.75,
      status: "ready",
      suggestedValues: ["programming"],
      evidenceSpan: "Python写项目"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps unresolved text local when the configured provider is not DeepSeek", async () => {
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_API_URL = "https://example.invalid/chat/completions";
    process.env.AI_API_KEY = "must-not-be-used";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: questionnaire({
        skills: { fieldId: "skills", selectedValues: [], freeText: "平时用Python写项目" }
      })
    }, "198.51.100.139"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "needs_confirmation",
      provider: "openai-compatible",
      aiUsed: false,
      fallbackReason: "provider_not_allowed"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "current and next cycle are both acceptable",
      freeText: "本届或下一届都可以，我不限定开始时间",
      firstMapping: { status: "ambiguous", values: [] }
    },
    {
      label: "current cycle is accepted and the next remains acceptable",
      freeText: "当前届合适就参加，错过了也愿意等下一届",
      firstMapping: { status: "unique", values: ["next-cycle-ok"] }
    },
    {
      label: "any suitable cycle is acceptable",
      freeText: "不急着马上参赛，合适的届次都能接受",
      firstMapping: { status: "ambiguous", values: [] }
    }
  ])("retries a model response that violates the strong timing policy: $label", async ({
    freeText,
    firstMapping
  }) => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.AI_API_KEY = "test-key";
    process.env.AI_RETRY_MAX_DELAY_MS = "0";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(aiResponse({
        mappings: [{
          fieldId: "participationTiming",
          ...firstMapping,
          rationale: "首次返回不符合字段语义边界。"
        }]
      }))
      .mockResolvedValueOnce(aiResponse({
        mappings: [{
          fieldId: "participationTiming",
          status: "unique",
          values: ["flexible"],
          rationale: "原文明确表示对届次或时间没有限制。"
        }]
      }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: questionnaire({
        participationTiming: {
          fieldId: "participationTiming",
          selectedValues: [],
          freeText
        }
      })
    }, "198.51.102.1"));
    const body = await response.json();
    const interpretation = body.interpretations.find(
      (item: { fieldId: string }) => item.fieldId === "participationTiming"
    );

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "needs_confirmation", aiUsed: true });
    expect(interpretation).toMatchObject({
      source: "model",
      status: "ready",
      suggestedValues: ["flexible"]
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>;
    };
    const retryRequest = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>;
    };
    expect(firstRequest.messages[1]?.content).toContain("semanticPolicy");
    expect(retryRequest.messages[1]?.content).toContain("accepting the current and next cycle");

    const confirmed = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: body.questionnaireToken,
      confirmations: [{ fieldId: "participationTiming", values: ["flexible"] }]
    }, "198.51.102.2"));
    await expect(confirmed.json()).resolves.toMatchObject({
      status: "confirmed",
      profile: { participationTiming: "flexible" }
    });
  });

  it("keeps a genuinely uncertain timing answer ambiguous instead of forcing flexible", async () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.AI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(aiResponse({
      mappings: [{
        fieldId: "participationTiming",
        status: "ambiguous",
        values: [],
        rationale: "原文把下一届作为本届无法参加时的条件性备选。"
      }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: questionnaire({
        participationTiming: {
          fieldId: "participationTiming",
          selectedValues: [],
          freeText: "想赶本届，不行就下一届"
        }
      })
    }, "198.51.102.3"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "needs_confirmation",
      aiUsed: true,
      interpretations: expect.arrayContaining([expect.objectContaining({
        fieldId: "participationTiming",
        source: "unresolved",
        status: "ambiguous",
        suggestedValues: []
      })])
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves all seven allowed resources through model normalization and signed confirmation", async () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.AI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(aiResponse({
      mappings: [{
        fieldId: "availableResources",
        status: "unique",
        values: completeResourceSet,
        evidenceSpan: "完整支持",
        rationale: "原文表示七类资源均已具备。"
      }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    const normalized = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: questionnaire({
        availableResources: {
          fieldId: "availableResources",
          selectedValues: [],
          freeText: "学校可以提供完整支持"
        }
      })
    }, "198.51.100.96"));
    const normalizedBody = await normalized.json();

    expect(normalized.status).toBe(200);
    expect(normalizedBody).toMatchObject({
      status: "needs_confirmation",
      interpretations: expect.arrayContaining([expect.objectContaining({
        fieldId: "availableResources",
        suggestedValues: completeResourceSet
      })])
    });

    const confirmed = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: normalizedBody.questionnaireToken,
      confirmations: [{ fieldId: "availableResources", values: completeResourceSet }]
    }, "198.51.100.97"));

    expect(confirmed.status).toBe(200);
    await expect(confirmed.json()).resolves.toMatchObject({
      status: "confirmed",
      profile: { availableResources: completeResourceSet }
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the lower field-specific selection ceiling for non-resource answers", async () => {
    const response = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: questionnaire({
        majorFields: {
          fieldId: "majorFields",
          selectedValues: ["computer-science", "engineering", "mathematics", "business"]
        }
      })
    }, "198.51.100.98"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_INPUT" });
  });

  it.each(["enrollmentStatus", "teamSize", "teamUnit"] as const)(
    "keeps an unanswered %s fact unknown on the signed profile",
    async (fieldId) => {
      const incomplete = questionnaire();
      incomplete.answers = incomplete.answers.map((answer) => ({
        ...answer,
        selectedValues: answer.selectedValues.filter((value) => !value.startsWith(`${fieldId}:`))
      }));

      const response = await POST(request({
        aiConsent: { accepted: true, version: "test.v1" },
        questionnaire: incomplete
      }, `198.51.100.${fieldId.length + 100}`));

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.profile.confirmedFacts).not.toContain(fieldId);
      expect(result.profile[fieldId]).toBeUndefined();
    }
  );

  it("rejects a questionnaire token whose signed sessionId was tampered", async () => {
    const normalized = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaire: questionnaire({ skills: { fieldId: "skills", selectedValues: [], freeText: "编程" } })
    }, "198.51.100.94"));
    const body = await normalized.json();
    const [encodedPayload, signature] = String(body.questionnaireToken).split(".");
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
      sessionId: string;
    };
    payload.sessionId = payload.sessionId === "00000000-0000-4000-8000-000000000001"
      ? "00000000-0000-4000-8000-000000000002"
      : "00000000-0000-4000-8000-000000000001";
    const tamperedToken = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
    expect(verifyCompetitionQuestionnaireToken(tamperedToken)).toEqual({
      ok: false,
      reason: "invalid_token"
    });
    const response = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: tamperedToken,
      confirmations: [{ fieldId: "skills", values: ["programming"] }]
    }, "198.51.100.95"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_QUESTIONNAIRE_TOKEN" });
  });
});
