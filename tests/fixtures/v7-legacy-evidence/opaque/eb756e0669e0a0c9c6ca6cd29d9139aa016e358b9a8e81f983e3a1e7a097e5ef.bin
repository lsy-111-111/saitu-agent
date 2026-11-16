import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/ai/competition-clarify/route";
import {
  buildSignedCompetitionQualificationSnapshot,
  createCompetitionConversationToken as createSignedCompetitionConversationToken,
  verifyCompetitionConversationToken
} from "../../src/lib/ai/competition-conversation-token";
import {
  createCompetitionQuestionnaireToken,
  verifyCompetitionQuestionnaireToken
} from "../../src/lib/ai/competition-questionnaire";
import {
  rateLimitStateSnapshotForTests,
  resetRateLimitStateForTests
} from "../../src/lib/security/rate-limit";
import {
  COMPETITION_PROFILE_FIELD_IDS,
  type CompetitionQuestionnaireFieldId,
  type CompetitionDynamicExchangeV3,
  type CompetitionDynamicQuestionV3,
  type CompetitionRecommendationProfileV5
} from "../../src/types/competition-recommendation";

const originalEnv = { ...process.env };
const signingSecret = "test-signing-secret-at-least-thirty-two-characters";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const profile: CompetitionRecommendationProfileV5 = {
  profileVersion: "competition-profile.v5",
  questionnaireVersion: "competition-questionnaire.v1",
  confirmedFields: [...COMPETITION_PROFILE_FIELD_IDS],
  confirmedFacts: ["enrollmentStatus", "teamUnit", "teamSize"],
  stage: "undergraduate-1",
  majorFields: ["engineering"],
  specificSubjects: ["engineering-practice"],
  skills: ["hardware", "programming"],
  interests: ["engineering"],
  goals: ["project", "employment"],
  preferredOutputs: ["prototype"],
  startingPoint: "idea_only",
  weeklyCommitment: "5-10",
  teamStatus: "looking",
  availableResources: ["equipment"],
  participationMode: "offline-local",
  participationTiming: "flexible",
  taskFormats: ["hardware", "software"],
  experienceLevel: "participated",
  evidence: ["prototype"],
  enrollmentStatus: "full-time-student",
  teamUnit: "unsure",
  teamSize: "unsure"
};

const questionnaireFieldIds: CompetitionQuestionnaireFieldId[] = [
  ...COMPETITION_PROFILE_FIELD_IDS,
  ...profile.confirmedFacts
];

function profileValues(fieldId: CompetitionQuestionnaireFieldId) {
  const value = profile[fieldId as keyof CompetitionRecommendationProfileV5];
  return Array.isArray(value) ? [...value] : [String(value)];
}

const confirmedRawAnswerContext = questionnaireFieldIds.map((fieldId) => ({
  fieldId,
  selectedValues: profileValues(fieldId)
}));

function confirmedQuestionnaireToken() {
  return createCompetitionQuestionnaireToken({
    rawAnswerContext: confirmedRawAnswerContext,
    interpretations: questionnaireFieldIds.map((fieldId) => ({
      fieldId,
      explicitValues: profileValues(fieldId),
      suggestedValues: [],
      source: "explicit" as const,
      confidence: 1,
      status: "ready" as const,
      rationale: "用户已确认的固定问卷白名单选项。",
      requiresConfirmation: false
    })),
    profile,
    confirmed: true
  });
}

type ConversationTokenInput = Omit<
  Parameters<typeof createSignedCompetitionConversationToken>[0],
  "rawAnswerContext"
> & {
  rawAnswerContext?: Parameters<typeof createSignedCompetitionConversationToken>[0]["rawAnswerContext"];
};

function createCompetitionConversationToken(
  input: ConversationTokenInput,
  now?: Parameters<typeof createSignedCompetitionConversationToken>[1]
) {
  return createSignedCompetitionConversationToken({
    ...input,
    rawAnswerContext: input.rawAnswerContext ?? confirmedRawAnswerContext
  }, now);
}

const materialQuestion: CompetitionDynamicQuestionV3 = {
  questionId: "dq_material_fit",
  signalKey: "competition-fit",
  prompt: "你希望优先验证哪一类原型能力？",
  selection: "multiple",
  maxSelections: 2,
  options: [
    { value: "hardware-build", label: "硬件功能验证" },
    { value: "product-validation", label: "完整系统联调" }
  ],
  allowsNote: true,
  maxNoteLength: 120,
  impact: "material",
  estimatedPreferenceOutcomeChanges: 2
};

const optionalQuestion: CompetitionDynamicQuestionV3 = {
  questionId: "dq_optional_goal",
  signalKey: "candidate-goal-tradeoff",
  prompt: "结合当前候选，如果只能优先一种收获，你更看重哪一项？",
  selection: "single",
  options: [
    { value: "project", label: "项目经历" },
    { value: "employment", label: "就业能力" }
  ],
  allowsNote: true,
  maxNoteLength: 120,
  impact: "optional",
  estimatedPreferenceOutcomeChanges: 1
};

const goalQuestion: CompetitionDynamicQuestionV3 = {
  ...optionalQuestion,
  questionId: "dq_material_goal",
  impact: "material",
  estimatedPreferenceOutcomeChanges: 2
};

const trackQuestion: CompetitionDynamicQuestionV3 = {
  questionId: "dq_material_track",
  signalKey: "track:fixture",
  prompt: "《测试赛事》的这些候选方向中，你更想优先准备哪个赛道？",
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

function createRequest(body: unknown, ip: string) {
  return new Request("http://localhost/api/ai/competition-clarify", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function signedLegacyToken(version = "competition-conversation.v4") {
  const encoded = Buffer.from(JSON.stringify({ version })).toString("base64url");
  const signature = createHmac("sha256", signingSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

beforeEach(() => {
  process.env.FEATURE_AI = "1";
  process.env.FEATURE_COMPETITION_RECOMMENDER = "1";
  process.env.AI_CONSENT_VERSION = "test.v1";
  process.env.AI_PROVIDER = "deepseek";
  process.env.AI_API_KEY = "unused-for-server-question-selection";
  process.env.AI_CONVERSATION_SIGNING_SECRET = signingSecret;
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

describe("POST /api/ai/competition-clarify preference policy", () => {
  it("replays one semantic multi-select answer despite order and unsigned recent-history changes", async () => {
    const conversationToken = createCompetitionConversationToken({
      profile,
      transcript: [],
      pendingQuestion: materialQuestion,
      completed: false
    });
    const first = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken,
      answer: {
        selectedValues: ["hardware-build", "product-validation"]
      },
      recentSignalKeys: ["candidate-goal-tradeoff"]
    }, "203.0.113.201"));
    const firstBody = await first.json();
    const stateAfterOwner = rateLimitStateSnapshotForTests();
    const replay = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken,
      answer: {
        selectedValues: ["product-validation", "hardware-build"]
      },
      recentSignalKeys: ["competition-fit"]
    }, "203.0.113.202"));
    const replayBody = await replay.json();

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("X-Idempotent-Replay")).toBe("true");
    expect(replayBody).toEqual(firstBody);
    expect(rateLimitStateSnapshotForTests()).toEqual(stateAfterOwner);
  });

  it("requires current explicit consent", async () => {
    const response = await POST(createRequest({
      questionnaireToken: confirmedQuestionnaireToken()
    }, "203.0.113.1"));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("uses only server-authored preference questions and never calls a model to select one", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: confirmedQuestionnaireToken()
    }, "203.0.113.2"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      responseVersion: "competition-clarification.v6",
      status: expect.stringMatching(/^(?:question|optional_question|completed)$/),
      provider: "server",
      model: "deterministic-preference-policy.v1",
      promptVersion: "competition-clarify.v8",
      askedQuestionCount: 0,
      conversationToken: expect.any(String)
    });
    if (body.nextQuestion) {
      expect(body.nextQuestion.signalKey).toMatch(/^(?:competition-fit|candidate-goal-tradeoff|track:)/);
      expect(body.nextQuestion.signalKey).not.toMatch(/^(?:team-eligibility|eligibility:)/);
      expect(JSON.stringify(body.nextQuestion)).not.toMatch(/已核对且符合|仍需核对|已确认不符合|可参加赛道/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("inherits the stable questionnaire root in every V6 conversation token", async () => {
    const questionnaireToken = confirmedQuestionnaireToken();
    const questionnaire = verifyCompetitionQuestionnaireToken(questionnaireToken);
    expect(questionnaire.ok).toBe(true);
    if (!questionnaire.ok) throw new Error("questionnaire fixture must verify");
    expect(questionnaire.payload).toMatchObject({
      version: "competition-questionnaire-token.v2",
      sessionId: expect.stringMatching(uuidPattern),
      nonce: expect.stringMatching(uuidPattern)
    });
    expect(questionnaire.payload.sessionId).not.toBe(questionnaire.payload.nonce);

    const first = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken
    }, "203.0.113.200"));
    const firstBody = await first.json();
    const firstToken = verifyCompetitionConversationToken(firstBody.conversationToken);
    expect(firstToken).toMatchObject({
      ok: true,
      payload: {
        version: "competition-conversation.v6",
        sessionId: questionnaire.payload.sessionId,
        issuedAt: questionnaire.payload.issuedAt,
        expiresAt: questionnaire.payload.expiresAt
      }
    });
    if (firstToken.ok) expect(firstToken.payload.nonce).not.toBe(questionnaire.payload.nonce);
    if (!firstToken.ok || !firstBody.nextQuestion) return;

    const second = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: firstBody.conversationToken,
      ...(firstBody.status === "optional_question"
        ? { action: "skip_optional" as const }
        : { answer: { selectedValues: [firstBody.nextQuestion.options[0].value] } })
    }, "203.0.113.200"));
    const secondBody = await second.json();
    expect(verifyCompetitionConversationToken(secondBody.conversationToken)).toMatchObject({
      ok: true,
      payload: {
        sessionId: questionnaire.payload.sessionId,
        issuedAt: questionnaire.payload.issuedAt,
        expiresAt: questionnaire.payload.expiresAt
      }
    });
  });

  it("never issues a fourth question", async () => {
    let response = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: confirmedQuestionnaireToken()
    }, "203.0.113.3"));
    let body = await response.json();
    let answered = 0;
    while (body.nextQuestion && answered < 4) {
      if (body.status === "optional_question") {
        response = await POST(createRequest({
          aiConsent: { accepted: true, version: "test.v1" },
          conversationToken: body.conversationToken,
          action: "skip_optional"
        }, `203.0.113.${4 + answered}`));
      } else {
        response = await POST(createRequest({
          aiConsent: { accepted: true, version: "test.v1" },
          conversationToken: body.conversationToken,
          answer: { selectedValues: [body.nextQuestion.options[0].value] }
        }, `203.0.113.${4 + answered}`));
        answered += 1;
      }
      body = await response.json();
    }
    expect(answered).toBeLessThanOrEqual(3);
    expect(body).toMatchObject({ status: "completed", nextQuestion: null });
    expect(verifyCompetitionConversationToken(body.conversationToken)).toMatchObject({
      ok: true,
      payload: { completed: true, pendingQuestion: null }
    });
  });

  it("allows skip_optional only for a signed optional goal question", async () => {
    const optionalToken = createCompetitionConversationToken({
      profile,
      transcript: [],
      pendingQuestion: optionalQuestion,
      completed: false
    });
    const skipped = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: optionalToken,
      action: "skip_optional"
    }, "203.0.113.20"));
    const skippedBody = await skipped.json();
    expect(skippedBody).toMatchObject({
      responseVersion: "competition-clarification.v6",
      status: "completed",
      nextQuestion: null,
      askedQuestionCount: 0
    });
    expect(verifyCompetitionConversationToken(skippedBody.conversationToken)).toMatchObject({
      ok: true,
      payload: { completed: true, transcript: [], pendingQuestion: null }
    });

    const materialToken = createCompetitionConversationToken({
      profile,
      transcript: [],
      pendingQuestion: materialQuestion,
      completed: false
    });
    const rejected = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: materialToken,
      action: "skip_optional"
    }, "203.0.113.21"));
    expect(rejected.status).toBe(409);
    await expect(rejected.json()).resolves.toMatchObject({ error: "OPTIONAL_SKIP_NOT_ALLOWED" });
  });

  it("rejects a still-valid root session that cannot outlive one complete request budget", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const nearlyExpired = createCompetitionConversationToken({
      profile,
      transcript: [],
      pendingQuestion: materialQuestion,
      completed: false
    }, new Date(Date.now() - (30 * 60_000 - 30_000)));

    const response = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: nearlyExpired,
      answer: { selectedValues: [materialQuestion.options[0].value] }
    }, "203.0.113.222"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "CONVERSATION_EXPIRED"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("completes immediately after an optional answer", async () => {
    const token = createCompetitionConversationToken({
      profile,
      transcript: [],
      pendingQuestion: optionalQuestion,
      completed: false
    });
    const response = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: token,
      answer: { selectedValues: ["project"] }
    }, "203.0.113.22"));
    const body = await response.json();
    expect(body).toMatchObject({ status: "completed", nextQuestion: null, askedQuestionCount: 1 });
  });

  it("keeps pure text outside the transcript until whitelist confirmation", async () => {
    const token = createCompetitionConversationToken({
      profile,
      transcript: [],
      pendingQuestion: materialQuestion,
      completed: false
    });
    const response = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: token,
      answer: { selectedValues: [], note: "硬件功能验证" }
    }, "203.0.113.23"));
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      status: "needs_confirmation",
      interpretationRequired: true,
      interpretation: { suggestedValues: ["hardware-build"] }
    });
    expect(body.interpretation).not.toHaveProperty("upstreamAttempted");
    expect(verifyCompetitionConversationToken(token)).toMatchObject({
      ok: true,
      payload: { transcript: [], pendingQuestion: materialQuestion }
    });
  });

  it.each(["competition-conversation.v4", "competition-conversation.v5"])(
    "returns a specific policy error for an authentically signed %s token",
    async (version) => {
      const token = signedLegacyToken(version);
      expect(verifyCompetitionConversationToken(token)).toEqual({ ok: false, reason: "policy_changed" });
      const response = await POST(createRequest({
        aiConsent: { accepted: true, version: "test.v1" },
        conversationToken: token,
        answer: { selectedValues: ["project"] }
      }, "203.0.113.24"));
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: "CONVERSATION_POLICY_CHANGED" });
    }
  );

  it("rejects a signed token whose frozen qualification digest does not match", async () => {
    const evaluatedAt = Math.floor(Date.now() / 1000);
    const frozen = buildSignedCompetitionQualificationSnapshot(profile, evaluatedAt);
    const token = createCompetitionConversationToken({
      profile,
      qualificationSnapshot: { ...frozen.summary, digest: "0".repeat(64) },
      transcript: [],
      pendingQuestion: optionalQuestion,
      completed: false
    }, new Date(evaluatedAt * 1000));
    const response = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: token,
      action: "skip_optional"
    }, "203.0.113.25"));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "QUALIFICATION_SNAPSHOT_CHANGED" });
  });

  it("rejects a signed V5 question that injects a hard-ineligible track", async () => {
    const evaluatedAt = Math.floor(Date.now() / 1000);
    const frozen = buildSignedCompetitionQualificationSnapshot(profile, evaluatedAt);
    const target = frozen.snapshot.entries.find((entry) =>
      entry.status !== "ineligible" &&
      entry.tracks.some(({ status }) => status === "ineligible") &&
      entry.tracks.some(({ status }) => status !== "ineligible")
    );
    expect(target, "fixture must contain both allowed and hard-ineligible tracks").toBeDefined();
    const rejectedTrack = target!.tracks.find(({ status }) => status === "ineligible")!;
    const allowedTrack = target!.tracks.find(({ status }) => status !== "ineligible")!;
    const injectedQuestion: CompetitionDynamicQuestionV3 = {
      questionId: "dq_injected_ineligible_track",
      signalKey: `track:${target!.competitionId}`,
      prompt: "《候选赛事》的这些候选方向中，你更想优先准备哪个赛道？",
      selection: "single",
      options: [
        { value: rejectedTrack.trackId, label: "被硬规则排除的方向" },
        { value: allowedTrack.trackId, label: "仍可评估的方向" }
      ],
      allowsNote: true,
      maxNoteLength: 120,
      impact: "material",
      estimatedPreferenceOutcomeChanges: 2
    };
    const token = createCompetitionConversationToken({
      profile,
      qualificationSnapshot: frozen.summary,
      transcript: [],
      pendingQuestion: injectedQuestion,
      completed: false
    }, new Date(evaluatedAt * 1000));
    const response = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: token,
      answer: { selectedValues: [rejectedTrack.trackId] }
    }, "203.0.113.251"));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_DYNAMIC_QUESTION" });
  });

  it("rejects a signed question that turns a factual class into a track preference", async () => {
    const evaluatedAt = Math.floor(Date.now() / 1000);
    const frozen = buildSignedCompetitionQualificationSnapshot(profile, evaluatedAt);
    const competitionId = "challenge-cup-entrepreneurship-plan";
    const snapshotTracks = frozen.snapshot.entries.find(
      (entry) => entry.competitionId === competitionId
    )?.tracks;
    expect(snapshotTracks?.map(({ trackId }) => trackId)).toEqual(["registered", "unregistered"]);
    const injectedQuestion: CompetitionDynamicQuestionV3 = {
      questionId: "dq_injected_factual_classification",
      signalKey: `track:${competitionId}`,
      prompt: "《挑战杯创业计划竞赛》的这些候选方向中，你更想优先准备哪个赛道？",
      selection: "single",
      options: [
        { value: "registered", label: "方向 A" },
        { value: "unregistered", label: "方向 B" }
      ],
      allowsNote: true,
      maxNoteLength: 120,
      impact: "material",
      estimatedPreferenceOutcomeChanges: 2
    };
    const token = createCompetitionConversationToken({
      profile,
      qualificationSnapshot: frozen.summary,
      transcript: [],
      pendingQuestion: injectedQuestion,
      completed: false
    }, new Date(evaluatedAt * 1000));
    const response = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: token,
      answer: { selectedValues: ["registered"] }
    }, "203.0.113.252"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_DYNAMIC_QUESTION" });
  });

  it("rejects China International study-stage and registration groups injected as preferences", async () => {
    const evaluatedAt = Math.floor(Date.now() / 1000);
    const frozen = buildSignedCompetitionQualificationSnapshot(profile, evaluatedAt);
    const competitionId = "china-international-college-innovation";
    expect(frozen.snapshot.entries.find(
      (entry) => entry.competitionId === competitionId
    )?.tracks.map(({ trackId }) => trackId)).toEqual([
      "graduate-creative",
      "graduate-startup",
      "undergraduate-creative",
      "undergraduate-startup",
      "vocational-creative",
      "vocational-startup"
    ]);
    const injectedQuestion: CompetitionDynamicQuestionV3 = {
      questionId: "dq_injected_china_international_fact_group",
      signalKey: `track:${competitionId}`,
      prompt: "《中国国际大学生创新大赛》的这些候选方向中，你更想优先准备哪个赛道？",
      selection: "single",
      options: [
        { value: "undergraduate-creative", label: "方向 A" },
        { value: "undergraduate-startup", label: "方向 B" }
      ],
      allowsNote: true,
      maxNoteLength: 120,
      impact: "material",
      estimatedPreferenceOutcomeChanges: 2
    };
    const token = createCompetitionConversationToken({
      profile,
      qualificationSnapshot: frozen.summary,
      transcript: [],
      pendingQuestion: injectedQuestion,
      completed: false
    }, new Date(evaluatedAt * 1000));
    const response = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: token,
      answer: { selectedValues: ["undergraduate-creative"] }
    }, "203.0.113.253"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_DYNAMIC_QUESTION" });
  });

  it("rejects career growth and employment fact groups injected as preferences", async () => {
    const evaluatedAt = Math.floor(Date.now() / 1000);
    const frozen = buildSignedCompetitionQualificationSnapshot(profile, evaluatedAt);
    const competitionId = "career-planning";
    const snapshotTracks = frozen.snapshot.entries.find(
      (entry) => entry.competitionId === competitionId
    )?.tracks;
    expect(snapshotTracks?.map(({ trackId }) => trackId)).toEqual(["employment", "growth"]);
    expect(snapshotTracks?.every(({ status }) => status !== "ineligible")).toBe(true);
    const injectedQuestion: CompetitionDynamicQuestionV3 = {
      questionId: "dq_injected_career_fact_group",
      signalKey: `track:${competitionId}`,
      prompt: "《全国大学生职业规划大赛》的这些候选方向中，你更想优先准备哪个赛道？",
      selection: "single",
      options: [
        { value: "growth", label: "方向 A" },
        { value: "employment", label: "方向 B" }
      ],
      allowsNote: true,
      maxNoteLength: 120,
      impact: "material",
      estimatedPreferenceOutcomeChanges: 2
    };
    const token = createCompetitionConversationToken({
      profile,
      qualificationSnapshot: frozen.summary,
      transcript: [],
      pendingQuestion: injectedQuestion,
      completed: false
    }, new Date(evaluatedAt * 1000));
    const response = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: token,
      answer: { selectedValues: ["growth"] }
    }, "203.0.113.254"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_DYNAMIC_QUESTION" });
  });

  it("enforces the three-question and unique-family token invariants", () => {
    const transcript: CompetitionDynamicExchangeV3[] = [
      { question: materialQuestion, answer: { selectedValues: ["hardware-build"] } },
      { question: goalQuestion, answer: { selectedValues: ["project"] } },
      { question: trackQuestion, answer: { selectedValues: ["track-a"] } }
    ];
    expect(() => createCompetitionConversationToken({
      profile,
      transcript,
      pendingQuestion: { ...trackQuestion, questionId: "dq_fourth", signalKey: "track:other" },
      completed: false
    })).toThrow();
    expect(() => createCompetitionConversationToken({
      profile,
      transcript: [{ question: materialQuestion, answer: { selectedValues: ["hardware-build"] } }],
      pendingQuestion: { ...materialQuestion, questionId: "dq_duplicate_fit" },
      completed: false
    })).toThrow();
  });

  it("rejects legacy recent signals at the request boundary", async () => {
    const response = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      questionnaireToken: confirmedQuestionnaireToken(),
      recentSignalKeys: ["team-eligibility"]
    }, "203.0.113.26"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_INPUT" });
  });

  it("rejects direct profiles so every new conversation starts from the confirmed 14-question token", async () => {
    const response = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      profile
    }, "203.0.113.27"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_INPUT" });
  });
});
