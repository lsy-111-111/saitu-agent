import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/ai/competition-clarify/route";
import {
  createCompetitionConversationToken,
  verifyCompetitionConversationToken
} from "../../src/lib/ai/competition-conversation-token";
import { resetRateLimitStateForTests } from "../../src/lib/security/rate-limit";
import {
  COMPETITION_PROFILE_FIELD_IDS,
  type CompetitionDynamicQuestionV3,
  type CompetitionQuestionnaireFieldId,
  type CompetitionRecommendationProfileV5
} from "../../src/types/competition-recommendation";

const originalEnv = { ...process.env };
const profile: CompetitionRecommendationProfileV5 = {
  profileVersion: "competition-profile.v5",
  questionnaireVersion: "competition-questionnaire.v1",
  confirmedFields: [...COMPETITION_PROFILE_FIELD_IDS],
  confirmedFacts: ["enrollmentStatus", "teamUnit", "teamSize"],
  stage: "undergraduate-2",
  majorFields: ["engineering"],
  specificSubjects: ["engineering-practice"],
  skills: ["hardware", "programming"],
  interests: ["engineering"],
  taskFormats: ["hardware", "software"],
  goals: ["project", "employment"],
  preferredOutputs: ["prototype"],
  startingPoint: "coursework",
  weeklyCommitment: "5-10",
  teamStatus: "looking",
  availableResources: ["equipment"],
  participationMode: "flexible",
  participationTiming: "flexible",
  experienceLevel: "participated",
  evidence: ["prototype"],
  enrollmentStatus: "full-time-student",
  teamUnit: "unsure",
  teamSize: "unsure"
};

const question: CompetitionDynamicQuestionV3 = {
  questionId: "dq_unmapped_confirmation_regression",
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

function profileValues(fieldId: CompetitionQuestionnaireFieldId) {
  const value = profile[fieldId as keyof CompetitionRecommendationProfileV5];
  return Array.isArray(value) ? [...value] : [String(value)];
}

function conversationToken() {
  return createCompetitionConversationToken({
    profile,
    rawAnswerContext: [
      ...COMPETITION_PROFILE_FIELD_IDS,
      ...profile.confirmedFacts
    ].map((fieldId) => ({
      fieldId,
      selectedValues: profileValues(fieldId)
    })),
    transcript: [],
    pendingQuestion: question,
    completed: false
  });
}

function request(body: unknown, ip: string) {
  return new Request("http://localhost/api/ai/competition-clarify", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  process.env.FEATURE_AI = "1";
  process.env.FEATURE_COMPETITION_RECOMMENDER = "1";
  process.env.AI_CONSENT_VERSION = "test.v1";
  process.env.AI_PROVIDER = "mock";
  process.env.AI_TEST_MODE = "1";
  process.env.ALLOW_AI_MOCK = "1";
  delete process.env.AI_API_KEY;
  process.env.AI_CONVERSATION_SIGNING_SECRET =
    "dynamic-confirmation-regression-secret-at-least-32-characters";
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

describe("dynamic text confirmation regression", () => {
  it.each(["王一鸣", "欧阳一鸣"])(
    "rejects a Chinese name before upstream fetch or logging: %s",
    async (note) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const response = await POST(request({
        aiConsent: { accepted: true, version: "test.v1" },
        conversationToken: conversationToken(),
        answer: { selectedValues: [], note }
      }, "203.0.113.240"));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ ok: false, error: "INVALID_INPUT" });
      expect(fetchMock).not.toHaveBeenCalled();
      const logged = [console.info, console.warn, console.error]
        .flatMap((logger) => vi.mocked(logger).mock.calls.flat())
        .join("\n");
      expect(logged).not.toContain(note);
    }
  );

  it("closes an unmapped text branch after the user confirms a signed whitelist value", async () => {
    const token = conversationToken();
    const note = "我想做一个能真正解决问题的方向";
    const unresolved = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: token,
      answer: { selectedValues: [], note }
    }, "203.0.113.231"));
    await expect(unresolved.json()).resolves.toMatchObject({
      ok: true,
      status: "needs_confirmation",
      interpretationRequired: true,
      interpretation: { status: "unmapped", suggestedValues: [] }
    });

    const confirmed = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: token,
      answer: { selectedValues: ["hardware-build"], note },
      interpretationConfirmed: true
    }, "203.0.113.232"));
    const body = await confirmed.json();

    expect(confirmed.status).toBe(200);
    expect(body.status).not.toBe("needs_confirmation");
    const verified = verifyCompetitionConversationToken(body.conversationToken);
    expect(verified).toMatchObject({
      ok: true,
      payload: {
        transcript: [{
          question: { questionId: question.questionId },
          answer: { selectedValues: ["hardware-build"] }
        }]
      }
    });
    if (verified.ok) expect(verified.payload.transcript[0]?.answer.note).toBeUndefined();
  });

  it("rejects a confirmation marker without both the original note and a selection", async () => {
    const response = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: conversationToken(),
      answer: { selectedValues: ["hardware-build"] },
      interpretationConfirmed: true
    }, "203.0.113.233"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("keeps an older client compatible when it confirms a signed selection with the original note", async () => {
    const note = "我想做一个能真正解决问题的方向";
    const response = await POST(request({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken: conversationToken(),
      answer: { selectedValues: ["product-validation"], note }
    }, "203.0.113.234"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).not.toBe("needs_confirmation");
    const verified = verifyCompetitionConversationToken(body.conversationToken);
    expect(verified).toMatchObject({
      ok: true,
      payload: {
        transcript: [{ answer: { selectedValues: ["product-validation"] } }]
      }
    });
    if (verified.ok) expect(verified.payload.transcript[0]?.answer.note).toBeUndefined();
  });
});
