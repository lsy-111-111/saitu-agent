import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({
  completed: vi.fn()
}));

vi.mock("@/lib/analytics/server", () => ({
  recordVerifiedRecommendationCompleted: analyticsMocks.completed
}));

import { POST } from "../../src/app/api/ai/competition-recommend/route";
import {
  createCompetitionConversationToken as createSignedCompetitionConversationToken
} from "../../src/lib/ai/competition-conversation-token";
import * as competitionCatalog from "../../src/lib/competitions/catalog";
import {
  getCompetitionRecommendationCandidates,
  selectFinalQualityRecommendations,
  selectFinalThreeRecommendations
} from "../../src/lib/competitions/recommendation-engine";
import {
  assessCompetitionConfirmedSubjectAlignment,
  buildCompetitionQualificationSnapshot,
  hasDominantConfirmedSubjectMatch,
  semanticArchetypeFit
} from "../../src/lib/competitions/scoring";
import { resetRateLimitStateForTests } from "../../src/lib/security/rate-limit";
import {
  readSavedCompetitionStore,
  savedCompetitionScoreDisplay,
  saveRecommendationResult
} from "../../src/lib/competitions/saved-competitions";
import { parseCompetitionRecommendationResponseV5 } from "../../src/lib/competitions/recommendation-runtime-schema";
import { buildCompetitionQuestionnaireRawContext } from "../fixtures/competition-questionnaire-context";
import type {
  CompetitionDynamicExchangeV3,
  CompetitionDynamicQuestionV3,
  CompetitionRecommendationProfileV4,
  CompetitionRecommendationProfileV5
} from "../../src/types/competition-recommendation";
import { COMPETITION_PROFILE_FIELD_IDS } from "../../src/types/competition-recommendation";

const originalEnv = { ...process.env };
const signingSecret = "test-signing-secret-at-least-thirty-two-characters";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const profile: CompetitionRecommendationProfileV5 = {
  profileVersion: "competition-profile.v5",
  questionnaireVersion: "competition-questionnaire.v1",
  confirmedFields: [...COMPETITION_PROFILE_FIELD_IDS],
  confirmedFacts: ["enrollmentStatus", "teamUnit", "teamSize"],
  stage: "undergraduate-2",
  majorFields: ["business"],
  specificSubjects: ["finance-accounting"],
  skills: ["product", "data-analysis", "presentation"],
  interests: ["entrepreneurship"],
  goals: ["award", "employment"],
  preferredOutputs: ["business-plan", "presentation"],
  startingPoint: "coursework",
  weeklyCommitment: "5-10",
  teamStatus: "partial",
  availableResources: ["mentor"],
  participationMode: "flexible",
  participationTiming: "flexible",
  taskFormats: ["product", "entrepreneurship"],
  experienceLevel: "participated",
  evidence: ["project"],
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
  now?: Parameters<typeof createSignedCompetitionConversationToken>[1]
) {
  return createSignedCompetitionConversationToken({
    ...input,
    rawAnswerContext: input.rawAnswerContext ?? buildCompetitionQuestionnaireRawContext(input.profile)
  }, now);
}

const fitQuestion: CompetitionDynamicQuestionV3 = {
  questionId: "dq_business_fit",
  signalKey: "competition-fit",
  prompt: "接下来最希望重点证明哪类能力？",
  selection: "multiple",
  maxSelections: 2,
  options: [
    { value: "product-validation", label: "产品与市场验证" },
    { value: "field-research", label: "调研与数据分析" }
  ],
  allowsNote: true,
  maxNoteLength: 120,
  impact: "material",
  estimatedPreferenceOutcomeChanges: 2
};

const completedTranscript: CompetitionDynamicExchangeV3[] = [
  { question: fitQuestion, answer: { selectedValues: ["product-validation"] } }
];

function createRequest(
  body: unknown,
  ip: string,
  options: { idempotencyKey?: string; requestId?: string } = {}
) {
  return new Request("http://localhost/api/ai/competition-recommend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      ...(options.requestId ? { "X-Request-ID": options.requestId } : {})
    },
    body: JSON.stringify(body)
  });
}

function signedLegacyToken() {
  const encoded = Buffer.from(JSON.stringify({ version: "competition-conversation.v4" })).toString("base64url");
  const signature = createHmac("sha256", signingSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}


beforeEach(() => {
  process.env.FEATURE_AI = "1";
  process.env.FEATURE_COMPETITION_RECOMMENDER = "1";
  process.env.AI_CONSENT_VERSION = "test.v1";
  process.env.AI_PROVIDER = "mock";
  process.env.AI_TEST_MODE = "1";
  process.env.ALLOW_AI_MOCK = "1";
  process.env.AI_CONVERSATION_SIGNING_SECRET = signingSecret;
  resetRateLimitStateForTests();
  analyticsMocks.completed.mockReset();
  analyticsMocks.completed.mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("POST /api/ai/competition-recommend", () => {
  it("keeps the V5 token creator compile-time isolated from legacy profiles", () => {
    const legacyProfile = {} as CompetitionRecommendationProfileV4;
    if (false) {
      createSignedCompetitionConversationToken({
        // @ts-expect-error V5 envelopes can only be created from a confirmed V5 profile.
        profile: legacyProfile,
        transcript: [],
        pendingQuestion: null,
        completed: true
      });
      // @ts-expect-error Production ranking accepts only a confirmed V5 profile.
      buildCompetitionRankingPromptCandidates(legacyProfile, [], []);
    }
    expect(true).toBe(true);
  });

  it("rejects a valid completed token that cannot outlive one full request budget", async () => {
    const conversationToken = createCompetitionConversationToken({
      profile,
      transcript: completedTranscript,
      pendingQuestion: null,
      completed: true
    }, new Date(Date.now() - (30 * 60 - 64) * 1_000));

    const response = await POST(createRequest({
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken
    }, "198.51.100.9"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "CONVERSATION_EXPIRED" });
    expect(analyticsMocks.completed).not.toHaveBeenCalled();
  });

  it("returns exactly three unique hard-eligible recommendations in explicit mock mode", async () => {
    const conversationToken = createCompetitionConversationToken({
      profile,
      transcript: completedTranscript,
      pendingQuestion: null,
      completed: true
    });
    const response = await POST(createRequest(
      { aiConsent: { accepted: true, version: "test.v1" }, conversationToken },
      "198.51.100.10"
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toMatchObject({
      responseVersion: "competition-recommendation.v5",
      provider: "server",
      model: "structured-fit",
      status: "matched",
      rankingSource: "evidence-rules",
      fallbackUsed: false,
      fallbackMode: "none"
    });
    expect(body.recommendations).toHaveLength(3);
    expect(new Set(body.recommendations.map((item: { competitionId: string }) => item.competitionId))).toHaveProperty("size", 3);
    const completionLog = vi.mocked(console.info).mock.calls
      .flatMap((call) => call)
      .find((entry) => typeof entry === "string" && entry.includes('"event":"ai_route_completed"'));
    expect(JSON.parse(completionLog as string).candidateCount).toBeGreaterThan(10);
    expect(body.candidateAudit).toHaveLength(competitionCatalog.getCompetitionCatalog().length);
    expect(analyticsMocks.completed).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "matched",
        recommendations: expect.arrayContaining([
          expect.objectContaining({ competitionId: expect.any(String) })
        ])
      }),
      {
        sessionId: expect.any(String),
        signal: expect.any(AbortSignal),
        deadlineEpochMs: expect.any(Number)
      }
    );
    for (const recommendation of body.recommendations) {
      expect(recommendation).toMatchObject({
        competitionId: expect.any(String),
        name: expect.any(String),
        baseMatchScore: expect.any(Number),
        matchScore: expect.any(Number),
        scoreCalibration: {
          version: "competition-evidence-interval.v1",
          qualified: expect.any(Boolean),
          adjustment: expect.any(Number)
        },
        recommendationRole: expect.stringMatching(/^(best|steady|reference)$/),
        rankingSource: "evidence-rules",
        explanationSource: "rule"
      });
      expect(recommendation.totalScore).toBeUndefined();
      expect(recommendation.competition).toBeUndefined();
    }
  });

  it("saves, reloads, and redisplays the unmodified real recommendation API response", async () => {
    const conversationToken = createCompetitionConversationToken({
      profile,
      transcript: completedTranscript,
      pendingQuestion: null,
      completed: true
    });
    const response = await POST(createRequest(
      { aiConsent: { accepted: true, version: "test.v1" }, conversationToken },
      "198.51.100.12"
    ));
    const body = await response.json();
    const storage = new MemoryStorage();

    expect(response.status).toBe(200);
    expect(parseCompetitionRecommendationResponseV5(body)).not.toBeNull();
    const saved = saveRecommendationResult(body, storage, new Date("2026-08-25T08:00:00.000Z"));
    expect(saved.ok).toBe(true);
    const reloaded = readSavedCompetitionStore(storage);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;

    expect(reloaded.value.entries).toHaveLength(3);
    type ApiScoreItem = {
      competitionId: string;
      baseMatchScore: number;
      matchScore: number;
      scoreCalibration: { adjustment: number };
    };
    const apiById = new Map<string, ApiScoreItem>(
      body.recommendations.map((item: ApiScoreItem) => [item.competitionId, item] as const)
    );
    for (const entry of reloaded.value.entries) {
      const apiItem = apiById.get(entry.competitionId)!;
      expect("responseVersion" in entry.recommendation).toBe(true);
      if ("responseVersion" in entry.recommendation) {
        expect(entry.recommendation.responseVersion).toBe(body.responseVersion);
      }
      expect(savedCompetitionScoreDisplay(entry.recommendation)).toEqual({
        label: "综合匹配分",
        scoreText: `${Number.isInteger(apiItem.matchScore) ? apiItem.matchScore : apiItem.matchScore.toFixed(1)}/100`,
        detailText: `基础 ${Number.isInteger(apiItem.baseMatchScore) ? apiItem.baseMatchScore : apiItem.baseMatchScore.toFixed(1)} + 校准 ${Number.isInteger(apiItem.scoreCalibration.adjustment) ? apiItem.scoreCalibration.adjustment : apiItem.scoreCalibration.adjustment.toFixed(1)}`
      });
    }
  });

  it("records a committed owner once and never duplicates completion analytics on replay", async () => {
    const conversationToken = createCompetitionConversationToken({
      profile,
      transcript: completedTranscript,
      pendingQuestion: null,
      completed: true
    });
    const body = {
      aiConsent: { accepted: true, version: "test.v1" },
      conversationToken
    };

    const first = await POST(createRequest(body, "198.51.100.110", {
      idempotencyKey: "recommend-analytics-owner-0001",
      requestId: "recommend-analytics-request-0001"
    }));
    const replay = await POST(createRequest(body, "198.51.100.110", {
      idempotencyKey: "recommend-analytics-owner-0001",
      requestId: "recommend-analytics-request-0002"
    }));

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("x-idempotent-replay")).toBe("true");
    expect(replay.headers.get("x-request-id")).toBe("recommend-analytics-request-0002");
    expect(analyticsMocks.completed).toHaveBeenCalledTimes(1);
  });

  it("accepts a completed preference-only token", async () => {
    const conversationToken = createCompetitionConversationToken({
      profile,
      transcript: completedTranscript,
      pendingQuestion: null,
      completed: true
    });
    const requestBody = { aiConsent: { accepted: true, version: "test.v1" }, conversationToken };
    const response = await POST(createRequest(requestBody, "198.51.100.15"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("matched");
    expect(body.recommendations).toHaveLength(3);
    expect(body.recommendations.every((item: { role: string; scoreCalibration: { qualified: boolean; adjustment: number } }) =>
      item.scoreCalibration.qualified || (item.role === "reference" && item.scoreCalibration.adjustment === 0)
    )).toBe(true);
  });

  it.each(["mock", "deepseek"])("ranks on the server with %s configured, without upstream access", async provider => {
    process.env.AI_PROVIDER = provider;
    const fetchMock = vi.fn().mockRejectedValue(new Error("upstream is unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const conversationToken = createCompetitionConversationToken({profile, transcript:completedTranscript, pendingQuestion:null, completed:true});
    const response = await POST(createRequest({aiConsent:{accepted:true,version:"test.v1"},conversationToken},"198.51.100.48"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rankingSource).toBe("evidence-rules");
    expect(parseCompetitionRecommendationResponseV5(body)).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.alternatives.every((item: {competitionId:string}) => !body.recommendations.some((match:{competitionId:string}) => match.competitionId === item.competitionId))).toBe(true);
  });

  it("represents zero eligible series as a successful empty decision", async () => {
    vi.spyOn(competitionCatalog, "getCompetitionCatalog").mockReturnValue([]);
    const conversationToken = createCompetitionConversationToken({profile, transcript:[], pendingQuestion:null, completed:true});
    const response = await POST(createRequest({aiConsent:{accepted:true,version:"test.v1"},conversationToken},"198.51.100.19"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({status:"no_match",recommendations:[],candidateAudit:[]});
    expect(parseCompetitionRecommendationResponseV5(body)).not.toBeNull();
  });

  it("rejects a completed token when the fixed-fact qualification snapshot changes", async () => {
    const conversationToken = createCompetitionConversationToken({
      profile,
      transcript: completedTranscript,
      pendingQuestion: null,
      completed: true
    });
    vi.spyOn(competitionCatalog, "getCompetitionCatalog").mockReturnValue([]);

    const response = await POST(createRequest(
      { aiConsent: { accepted: true, version: "test.v1" }, conversationToken },
      "198.51.100.29"
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "QUALIFICATION_SNAPSHOT_CHANGED"
    });
  });

  it("rejects a signed transcript that injects an ineligible or unknown track", async () => {
    const snapshot = buildCompetitionQualificationSnapshot(profile);
    const forbiddenEntry = snapshot.entries.find((entry) =>
      entry.tracks.some(({ status }) => status === "ineligible")
    );
    const forbiddenTrack = forbiddenEntry?.tracks.find(({ status }) => status === "ineligible");
    expect(forbiddenEntry).toBeDefined();
    expect(forbiddenTrack).toBeDefined();
    if (!forbiddenEntry || !forbiddenTrack) throw new Error("Expected an ineligible catalog track fixture");
    const injectedQuestion: CompetitionDynamicQuestionV3 = {
      questionId: "dq_injected_track",
      signalKey: `track:${forbiddenEntry.competitionId}`,
      prompt: "这些候选方向中，你更想优先准备哪个赛道？",
      selection: "single",
      options: [
        { value: forbiddenTrack.trackId, label: "硬性不合格方向" },
        { value: "invented-track-b", label: "不存在方向 B" }
      ],
      allowsNote: true,
      maxNoteLength: 120,
      impact: "material",
      estimatedPreferenceOutcomeChanges: 2
    };
    const conversationToken = createCompetitionConversationToken({
      profile,
      transcript: [{
        question: injectedQuestion,
        answer: { selectedValues: [forbiddenTrack.trackId] }
      }],
      pendingQuestion: null,
      completed: true
    });

    const response = await POST(createRequest(
      { aiConsent: { accepted: true, version: "test.v1" }, conversationToken },
      "198.51.100.30"
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "INVALID_DYNAMIC_QUESTION"
    });
  });

  it("rejects a signed transcript that injects factual classes as track preferences", async () => {
    const competitionId = "challenge-cup-entrepreneurship-plan";
    const snapshot = buildCompetitionQualificationSnapshot(profile);
    expect(snapshot.entries.find(({ competitionId: id }) => id === competitionId)?.tracks
      .map(({ trackId }) => trackId)).toEqual(["registered", "unregistered"]);
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
    const conversationToken = createCompetitionConversationToken({
      profile,
      transcript: [{
        question: injectedQuestion,
        answer: { selectedValues: ["registered"] }
      }],
      pendingQuestion: null,
      completed: true
    });

    const response = await POST(createRequest(
      { aiConsent: { accepted: true, version: "test.v1" }, conversationToken },
      "198.51.100.31"
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "INVALID_DYNAMIC_QUESTION"
    });
  });

  it("rejects China International fact-determined groups in a completed transcript", async () => {
    const competitionId = "china-international-college-innovation";
    const snapshot = buildCompetitionQualificationSnapshot(profile);
    expect(snapshot.entries.find(({ competitionId: id }) => id === competitionId)?.tracks
      .map(({ trackId }) => trackId)).toEqual([
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
    const conversationToken = createCompetitionConversationToken({
      profile,
      transcript: [{
        question: injectedQuestion,
        answer: { selectedValues: ["undergraduate-creative"] }
      }],
      pendingQuestion: null,
      completed: true
    });

    const response = await POST(createRequest(
      { aiConsent: { accepted: true, version: "test.v1" }, conversationToken },
      "198.51.100.32"
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "INVALID_DYNAMIC_QUESTION"
    });
  });

  it("rejects career growth and employment fact groups in a completed transcript", async () => {
    const competitionId = "career-planning";
    const snapshot = buildCompetitionQualificationSnapshot(profile);
    const snapshotTracks = snapshot.entries.find(
      ({ competitionId: id }) => id === competitionId
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
    const conversationToken = createCompetitionConversationToken({
      profile,
      transcript: [{
        question: injectedQuestion,
        answer: { selectedValues: ["employment"] }
      }],
      pendingQuestion: null,
      completed: true
    });

    const response = await POST(createRequest(
      { aiConsent: { accepted: true, version: "test.v1" }, conversationToken },
      "198.51.100.33"
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "INVALID_DYNAMIC_QUESTION"
    });
  });

  it("rejects a direct profile and requires a completed signed conversation", async () => {
    const direct = await POST(createRequest(
      { aiConsent: { accepted: true, version: "test.v1" }, profile },
      "198.51.100.11"
    ));
    expect(direct.status).toBe(400);

    const incompleteToken = createCompetitionConversationToken({
      profile,
      transcript: [],
      pendingQuestion: {
        questionId: "dq_pending",
        signalKey: "competition-fit",
        prompt: "你更偏向哪一种准备方式？",
        selection: "multiple",
        maxSelections: 2,
        options: [
          { value: "product-validation", label: "产品验证" },
          { value: "field-research", label: "调研分析" }
        ],
        allowsNote: true,
        maxNoteLength: 120,
        impact: "material",
        estimatedPreferenceOutcomeChanges: 2
      },
      completed: false
    });
    const incomplete = await POST(createRequest(
      { aiConsent: { accepted: true, version: "test.v1" }, conversationToken: incompleteToken },
      "198.51.100.12"
    ));
    expect(incomplete.status).toBe(409);
    await expect(incomplete.json()).resolves.toMatchObject({ error: "CONVERSATION_NOT_COMPLETED" });

    const legacyProfileToken = signedLegacyToken();
    const legacyProfileResponse = await POST(createRequest(
      { aiConsent: { accepted: true, version: "test.v1" }, conversationToken: legacyProfileToken },
      "198.51.100.121"
    ));
    expect(legacyProfileResponse.status).toBe(409);
    await expect(legacyProfileResponse.json()).resolves.toMatchObject({
      error: "CONVERSATION_POLICY_CHANGED"
    });
    expect(analyticsMocks.completed).not.toHaveBeenCalled();
  });

  it("honors the dedicated recommender feature flag", async () => {
    process.env.FEATURE_COMPETITION_RECOMMENDER = "0";
    const conversationToken = createCompetitionConversationToken({ profile, transcript: completedTranscript, pendingQuestion: null, completed: true });
    const response = await POST(createRequest(
      { aiConsent: { accepted: true, version: "test.v1" }, conversationToken },
      "198.51.100.13"
    ));
    expect(response.status).toBe(503);
  });

  it("records completion metadata without logging the signed profile or answers", async () => {
    const privateNote = "private-note-that-must-not-be-logged";
    const conversationToken = createCompetitionConversationToken({
      profile,
      transcript: [
        { question: fitQuestion, answer: { selectedValues: ["product-validation"], note: privateNote } }
      ],
      pendingQuestion: null,
      completed: true
    });
    const response = await POST(createRequest(
      { aiConsent: { accepted: true, version: "test.v1" }, conversationToken },
      "198.51.100.14"
    ));
    expect(response.status).toBe(200);
    const logs = vi.mocked(console.info).mock.calls.flat().join("\n");
    expect(logs).toContain('"rankingSource":"evidence-rules"');
    expect(logs).not.toContain(privateNote);
  });
});
