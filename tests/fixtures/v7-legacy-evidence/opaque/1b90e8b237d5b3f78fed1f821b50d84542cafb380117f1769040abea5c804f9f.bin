import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { processEnv } from "@next/env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  DEFAULT_DEEPSEEK_MODEL
} from "../../src/lib/ai/ai-client";
import {
  competitionQuestionnaireV1Schema,
  confirmCompetitionQuestionnaire,
  normalizeCompetitionQuestionnaire
} from "../../src/lib/ai/competition-questionnaire";
import { rankCompetitionRecommendations } from "../../src/lib/ai/competition-ranking";
import { verifyCompetitionConversationToken } from "../../src/lib/ai/competition-conversation-token";
import { competitionDynamicQuestionFamilyV3 } from "../../src/lib/ai/competition-dynamic-question";
import { competitionRecommendationProfileV5Schema } from "../../src/lib/ai/competition-request-schema";
import { getAiConsentVersion } from "../../src/lib/config/features";
import { isCatalogCompetitionId } from "../../src/lib/competitions/catalog";
import {
  getCompetitionRecommendationCandidates,
  selectFinalVisibleCompetitionRecommendations
} from "../../src/lib/competitions/recommendation-engine";
import {
  DEEPSEEK_LIVE_REQUIRED_MAJOR_FIELDS,
  DEEPSEEK_LIVE_ROUNDS,
  deepSeekLivePersonas,
  questionnaireForDeepSeekLivePersona,
  type DeepSeekLivePersona
} from "../fixtures/deepseek-live-personas";
import {
  COMPETITION_GOALS,
  COMPETITION_RECOMMENDATION_RESPONSE_VERSION,
  type CompetitionDynamicAnswerV3,
  type CompetitionDynamicExchangeV3,
  type CompetitionDynamicQuestionV3,
  type CompetitionFitSignal,
  type CompetitionNormalizeResponseV1,
  type CompetitionRecommendationExplanation,
  type CompetitionRecommendationProfileV5,
  type CompetitionRecommendationResponseV5
} from "../../src/types/competition-recommendation";

const RUN_LIVE = process.env.RUN_DEEPSEEK_LIVE === "1";
const LIVE_DIAGNOSTIC_PERSONA_ID = process.env.DEEPSEEK_LIVE_DIAGNOSTIC_PERSONA?.trim();
const RUN_FULL_LIVE = RUN_LIVE && !LIVE_DIAGNOSTIC_PERSONA_ID;
const DEEPSEEK_MODELS_URL = "https://api.deepseek.com/models";
const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";
const LIVE_TEST_TIMEOUT_MS = 3_600_000;
const FORBIDDEN_QUALIFICATION_FOLLOWUP_TEXT =
  /(?:已核对且符合|仍需核对|已确认不符合|可参加赛道|资格|官方条件|全日制|学籍|学历阶段|入学(?:年份|时间)?|出生(?:日期|年月|年份|时间)?|参赛单位|(?:队伍|团队|参赛|队员|成员)(?:人数|数量|规模)|申诉通道|地区)/;

const modelsSchema = z
  .object({ data: z.array(z.object({ id: z.string().min(1) }).passthrough()) })
  .passthrough();

type RoutePost = (request: Request) => Promise<Response>;
type LivePhase = "normalize" | "confirm" | "clarify" | "recommend";
type ClarifySuccessBase = {
  ok: true;
  status: "question" | "optional_question" | "completed";
  nextQuestion: CompetitionDynamicQuestionV3 | null;
  conversationToken: string;
  askedQuestionCount: number;
  provider: string;
  model: string;
  promptVersion: string;
  fallback: false;
};
type ClarifySuccess = ClarifySuccessBase;

class LiveProtocolError extends Error {
  constructor(
    readonly phase: LivePhase,
    readonly safeReason: string
  ) {
    super(`${phase}:${safeReason}`);
  }
}

function loadLocalEnvWithNext(): NodeJS.ProcessEnv {
  if (!existsSync(".env.local")) return { ...process.env };
  const [combinedEnv] = processEnv(
    [{ path: ".env.local", contents: readFileSync(".env.local", "utf8"), env: {} }],
    process.cwd(),
    { info: () => undefined, error: () => undefined },
    true
  );
  return combinedEnv as NodeJS.ProcessEnv;
}

if (RUN_LIVE) {
  const localEnv = loadLocalEnvWithNext();
  if (localEnv.AI_API_KEY?.trim()) process.env.AI_API_KEY = localEnv.AI_API_KEY;
  process.env.AI_PROVIDER = "deepseek";
  process.env.AI_API_URL = DEEPSEEK_CHAT_URL;
  process.env.AI_MODELS_URL = DEEPSEEK_MODELS_URL;
  process.env.AI_MODEL = localEnv.AI_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;
  process.env.AI_COMPETITION_NORMALIZE_MODEL =
    localEnv.AI_COMPETITION_NORMALIZE_MODEL?.trim() || process.env.AI_MODEL;
  process.env.AI_COMPETITION_RECOMMEND_MODEL =
    localEnv.AI_COMPETITION_RECOMMEND_MODEL?.trim() || process.env.AI_MODEL;
  process.env.AI_TIMEOUT_MS = "60000";
  process.env.AI_RETRY_MAX_DELAY_MS = "2000";
  process.env.DATABASE_URL = "";
  process.env.FEATURE_AI = "1";
  process.env.FEATURE_COMPETITION_RECOMMENDER = "1";
  process.env.ALLOW_AI_MOCK = "0";
  process.env.AI_TEST_MODE =
    process.env.AI_CLARIFY_SCHEMA_DIAGNOSTICS === "1" ||
    process.env.AI_RANK_SCHEMA_DIAGNOSTICS === "1"
      ? "1"
      : "0";
  process.env.AI_CONVERSATION_SIGNING_SECRET =
    "deepseek-live-signing-secret-at-least-thirty-two-characters";
}

function getLiveApiKey() {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("AI_API_KEY is required in .env.local for the opt-in DeepSeek live test");
  }
  return apiKey;
}

async function expectConfiguredModelsAreAvailable(apiKey: string) {
  const response = await fetch(DEEPSEEK_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000)
  });
  expect(response.status).toBe(200);
  const parsed = modelsSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("DeepSeek /models returned an unexpected payload shape");
  const available = parsed.data.data.map(({ id }) => id);
  expect(available).toContain(process.env.AI_COMPETITION_NORMALIZE_MODEL);
  expect(available).toContain(process.env.AI_COMPETITION_RECOMMEND_MODEL);
}

function createRouteRequest(pathname: string, body: unknown, ip: string) {
  return new Request(`http://127.0.0.1${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1",
      "Sec-Fetch-Site": "same-origin",
      "x-forwarded-for": ip
    },
    body: JSON.stringify(body)
  });
}

function routeIp(personaIndex: number, round: number, phase: LivePhase) {
  const phaseOctet: Record<LivePhase, number> = { normalize: 10, confirm: 11, clarify: 12, recommend: 13 };
  return `198.18.${phaseOctet[phase]}.${personaIndex * DEEPSEEK_LIVE_ROUNDS + round}`;
}

function safeRouteError(phase: LivePhase, response: Response, body: unknown): never {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const codes = [...new Set([record.error, record.reason, record.status]
    .filter((value): value is string => typeof value === "string" && value.length <= 80))];
  throw new LiveProtocolError(phase, `http_${response.status}${codes.length ? `_${codes.join("_")}` : ""}`);
}

async function postLiveClarifyTurn(
  postClarify: RoutePost,
  requestBody: unknown,
  ip: string
) {
  const response = await postClarify(createRouteRequest(
    "/api/ai/competition-clarify",
    requestBody,
    ip
  ));
  const body = await response.json() as ClarifySuccess | Record<string, unknown>;
  return { response, body };
}

function assertLiveContract(condition: unknown, phase: LivePhase, safeReason: string): asserts condition {
  if (!condition) throw new LiveProtocolError(phase, safeReason);
}

function liveProfilesEqual(
  actual: CompetitionRecommendationProfileV5,
  expected: CompetitionRecommendationProfileV5
) {
  return isDeepStrictEqual(actual, expected);
}

async function normalizePersona(
  postNormalize: RoutePost,
  persona: DeepSeekLivePersona,
  personaIndex: number,
  round: number,
  aiConsent: { accepted: true; version: string }
) {
  const response = await postNormalize(createRouteRequest(
    "/api/competitions/recommend/normalize",
    { aiConsent, questionnaire: questionnaireForDeepSeekLivePersona(persona) },
    routeIp(personaIndex, round, "normalize")
  ));
  const body = await response.json() as CompetitionNormalizeResponseV1 | Record<string, unknown>;
  if (response.status !== 200 || body.ok !== true) safeRouteError("normalize", response, body);
  const normalizedBody = body as CompetitionNormalizeResponseV1;
  assertLiveContract(normalizedBody.promptVersion === "competition-normalize.v1", "normalize", "wrong_prompt_version");
  assertLiveContract(normalizedBody.provider === "deepseek", "normalize", "wrong_provider");
  assertLiveContract(typeof normalizedBody.questionnaireToken === "string", "normalize", "missing_token");
  assertLiveContract(
    !("fallbackReason" in normalizedBody) || normalizedBody.fallbackReason === undefined,
    "normalize",
    "fallback_used"
  );
  assertLiveContract(
    normalizedBody.aiUsed === true,
    "normalize",
    "wrong_ai_usage"
  );
  assertLiveContract(
    normalizedBody.model === process.env.AI_COMPETITION_NORMALIZE_MODEL,
    "normalize",
    "wrong_model"
  );
  assertLiveContract(normalizedBody.status === "needs_confirmation", "normalize", "text_was_not_confirmed");
  assertLiveContract(
    normalizedBody.questionnaireToken.length >= 32 && normalizedBody.questionnaireToken.length <= 48 * 1024,
    "normalize",
    "invalid_pending_token_length"
  );
  const expected = persona.textNormalization;
  const required = normalizedBody.interpretations.filter(({ requiresConfirmation }) => requiresConfirmation);
  assertLiveContract(required.length === 1, "normalize", "unexpected_confirmation_count");
  const interpretation = required[0];
  assertLiveContract(interpretation?.fieldId === expected.fieldId, "normalize", "wrong_confirmation_field");
  assertLiveContract(interpretation?.source === "model", "normalize", "normalization_did_not_use_model");
  assertLiveContract(interpretation?.status === "ready", "normalize", "normalization_not_unique");
  assertLiveContract(interpretation?.originalText === expected.freeText, "normalize", "wrong_original_text");
  assertLiveContract(
    JSON.stringify(interpretation?.suggestedValues) === JSON.stringify(expected.confirmedValues),
    "normalize",
    "wrong_text_normalization"
  );
  const pendingQuestionnaireToken = normalizedBody.questionnaireToken;
  const confirmationResponse = await postNormalize(createRouteRequest(
    "/api/competitions/recommend/normalize",
    {
      aiConsent,
      questionnaireToken: pendingQuestionnaireToken,
      confirmations: [{ fieldId: expected.fieldId, values: expected.confirmedValues }]
    },
    routeIp(personaIndex, round, "confirm")
  ));
  const confirmationBody = await confirmationResponse.json() as CompetitionNormalizeResponseV1 | Record<string, unknown>;
  if (confirmationResponse.status !== 200 || confirmationBody.ok !== true) {
    safeRouteError("confirm", confirmationResponse, confirmationBody);
  }
  const confirmedBody = confirmationBody as CompetitionNormalizeResponseV1;

  assertLiveContract(confirmedBody.status === "confirmed", "confirm", "not_confirmed");
  if (confirmedBody.status !== "confirmed") throw new LiveProtocolError("confirm", "not_confirmed");
  assertLiveContract(confirmedBody.aiUsed === true, "confirm", "lost_ai_usage");
  assertLiveContract(confirmedBody.promptVersion === "competition-normalize.v1", "confirm", "wrong_prompt_version");
  assertLiveContract(confirmedBody.provider === "deepseek", "confirm", "wrong_provider");
  assertLiveContract(
    confirmedBody.model === process.env.AI_COMPETITION_NORMALIZE_MODEL,
    "confirm",
    "wrong_model"
  );
  assertLiveContract(
    confirmedBody.questionnaireToken.length >= 32 && confirmedBody.questionnaireToken.length <= 48 * 1024,
    "confirm",
    "invalid_confirmed_token_length"
  );
  assertLiveContract(
    confirmedBody.questionnaireToken !== pendingQuestionnaireToken,
    "confirm",
    "pending_token_reused"
  );
  assertLiveContract(
    liveProfilesEqual(confirmedBody.profile, persona.profile),
    "confirm",
    "profile_mismatch"
  );
  return { questionnaireToken: confirmedBody.questionnaireToken, profile: confirmedBody.profile };
}

function expectCandidateRelatedQuestion(
  profile: CompetitionRecommendationProfileV5,
  transcript: readonly CompetitionDynamicExchangeV3[],
  question: CompetitionDynamicQuestionV3
) {
  const candidates = getCompetitionRecommendationCandidates(profile, { transcript }).recommendations.slice(0, 10);
  const candidateIds = new Set(candidates.map(({ competitionId }) => competitionId));
  assertLiveContract(
    /^(?:competition-fit|candidate-goal-tradeoff|track:[a-z0-9-]+)$/.test(question.signalKey),
    "clarify",
    "forbidden_signal_family"
  );
  assertLiveContract(
    !FORBIDDEN_QUALIFICATION_FOLLOWUP_TEXT.test(
      `${question.prompt} ${question.options.map(({ label }) => label).join(" ")}`
    ),
    "clarify",
    "qualification_followup_text"
  );
  assertLiveContract(
    question.impact === "optional" || question.estimatedPreferenceOutcomeChanges >= 2,
    "clarify",
    "non_material_automatic_question"
  );
  if (question.signalKey === "competition-fit") {
    const fitSignals = new Set(candidates.flatMap(({ competition }) => competition.recommendation.fit?.signals ?? []));
    assertLiveContract(
      question.options.every(({ value }) => fitSignals.has(value as CompetitionFitSignal)),
      "clarify",
      "unrelated_fit_option"
    );
    return;
  }
  if (question.signalKey === "candidate-goal-tradeoff") {
    assertLiveContract(
      question.selection === "single" &&
        question.options.length >= 2 &&
        question.options.length <= 4 &&
        question.options.every(({ value }) => COMPETITION_GOALS.includes(value as never)),
      "clarify",
      "invalid_goal_tradeoff"
    );
    return;
  }
  const [, targetId] = question.signalKey.split(":");
  assertLiveContract(Boolean(targetId && candidateIds.has(targetId)), "clarify", "unknown_candidate_question");
  const target = candidates.find(({ competitionId }) => competitionId === targetId);
  assertLiveContract(Boolean(target), "clarify", "missing_candidate_question");
  const allowedTracks = new Set((target!.competition.recommendation.tracks ?? []).map(({ id }) => id));
  assertLiveContract(
    question.options.every(({ value }) => allowedTracks.has(value)),
    "clarify",
    "unknown_track_option"
  );
}

function answerQuestion(
  persona: DeepSeekLivePersona,
  question: CompetitionDynamicQuestionV3
): CompetitionDynamicAnswerV3 {
  let preferences: readonly string[] = [];
  if (question.signalKey === "competition-fit") preferences = persona.preferredFitSignals;
  else if (question.signalKey === "candidate-goal-tradeoff") preferences = persona.profile.goals;
  const optionValues = new Set(question.options.map(({ value }) => value));
  const preferred = preferences.filter((value) => optionValues.has(value));
  const fallback = question.options[0]?.value;
  assertLiveContract(Boolean(preferred.length || fallback), "clarify", "question_without_options");
  const limit = question.selection === "single" ? 1 : question.maxSelections ?? 3;
  return { selectedValues: (preferred.length ? preferred : [fallback!]).slice(0, limit) };
}

async function clarifyPersona(
  postClarify: RoutePost,
  persona: DeepSeekLivePersona,
  personaIndex: number,
  round: number,
  aiConsent: { accepted: true; version: string },
  questionnaireToken: string,
  profile: CompetitionRecommendationProfileV5
) {
  const transcript: CompetitionDynamicExchangeV3[] = [];
  const askedSignals = new Set<string>();
  const askedFamilies = new Set<string>();
  let conversationToken = "";
  let requestBody: unknown = { aiConsent, questionnaireToken };

  while (true) {
    const turn = await postLiveClarifyTurn(
      postClarify,
      requestBody,
      routeIp(personaIndex, round, "clarify")
    );
    const { response, body } = turn;
    if (response.status !== 200 || body.ok !== true) safeRouteError("clarify", response, body);
    const clarification = body as ClarifySuccess;
    assertLiveContract(clarification.provider === "server", "clarify", "wrong_provider");
    assertLiveContract(clarification.fallback === false, "clarify", "unexpected_fallback");
    assertLiveContract(clarification.promptVersion === "competition-clarify.v8", "clarify", "wrong_prompt_version");
    assertLiveContract(
      clarification.model === "deterministic-preference-policy.v1",
      "clarify",
      "wrong_model"
    );
    assertLiveContract(typeof clarification.conversationToken === "string", "clarify", "missing_token");
    assertLiveContract(clarification.askedQuestionCount === transcript.length, "clarify", "wrong_question_count");
    conversationToken = clarification.conversationToken;
    if (clarification.status === "completed") {
      assertLiveContract(clarification.nextQuestion === null, "clarify", "completed_with_question");
      break;
    }
    assertLiveContract(Boolean(clarification.nextQuestion), "clarify", "missing_question");
    if (!clarification.nextQuestion) throw new LiveProtocolError("clarify", "missing_question");

    assertLiveContract(transcript.length < 3, "clarify", "more_than_three_questions");
    assertLiveContract(/^dq_/.test(clarification.nextQuestion.questionId), "clarify", "invalid_question_id");
    assertLiveContract(!askedSignals.has(clarification.nextQuestion.signalKey), "clarify", "duplicate_signal");
    const family = competitionDynamicQuestionFamilyV3(clarification.nextQuestion.signalKey);
    assertLiveContract(!askedFamilies.has(family), "clarify", "duplicate_question_family");
    expectCandidateRelatedQuestion(profile, transcript, clarification.nextQuestion);
    askedSignals.add(clarification.nextQuestion.signalKey);
    askedFamilies.add(family);
    if (clarification.status === "optional_question" && (personaIndex + round) % 2 === 0) {
      assertLiveContract(clarification.nextQuestion.impact === "optional", "clarify", "invalid_optional_impact");
      requestBody = { aiConsent, conversationToken, action: "skip_optional" };
      continue;
    }
    assertLiveContract(
      clarification.status === "optional_question"
        ? clarification.nextQuestion.impact === "optional"
        : clarification.nextQuestion.impact === "material",
      "clarify",
      "wrong_question_impact"
    );
    const answer = answerQuestion(persona, clarification.nextQuestion);
    transcript.push({ question: clarification.nextQuestion, answer });
    requestBody = { aiConsent, conversationToken, answer };
  }

  assertLiveContract(
    Number.isInteger(transcript.length) && transcript.length >= 0 && transcript.length <= 3,
    "clarify",
    "invalid_question_count"
  );
  return {
    conversationToken,
    clarificationCount: transcript.length,
    transientRetryCount: 0,
    fallbackReasons: [] as string[]
  };
}

function expectExplanationConstraints(explanation: CompetitionRecommendationExplanation) {
  assertLiveContract(explanation.matchReasons.length >= 1 && explanation.matchReasons.length <= 3, "recommend", "invalid_match_reasons");
  assertLiveContract(explanation.possibleGaps.length >= 1 && explanation.possibleGaps.length <= 3, "recommend", "invalid_gap_reasons");
  assertLiveContract(explanation.preparationTips.length >= 2 && explanation.preparationTips.length <= 3, "recommend", "invalid_tips");
  for (const value of [
    ...explanation.matchReasons,
    ...explanation.possibleGaps,
    ...explanation.preparationTips
  ]) {
    assertLiveContract(value.trim().length > 0 && value.length <= 180, "recommend", "invalid_explanation_text");
  }
}

function recommendationTier(item: {
  scoreCalibration: { qualified: boolean };
  eligibility: { status: "eligible" | "needs_clarification" | "ineligible" };
}) {
  if (item.scoreCalibration.qualified) {
    return item.eligibility.status === "eligible" ? 0 : 1;
  }
  return item.eligibility.status === "eligible" ? 2 : 3;
}

async function recommendPersona(
  postRecommend: RoutePost,
  personaIndex: number,
  round: number,
  aiConsent: { accepted: true; version: string },
  conversationToken: string
) {
  const response = await postRecommend(createRouteRequest(
    "/api/ai/competition-recommend",
    { aiConsent, conversationToken },
    routeIp(personaIndex, round, "recommend")
  ));
  const body = await response.json() as CompetitionRecommendationResponseV5 | Record<string, unknown>;
  if (response.status !== 200 || body.status !== "matched") safeRouteError("recommend", response, body);
  const result = body as CompetitionRecommendationResponseV5;
  assertLiveContract(
    result.responseVersion === COMPETITION_RECOMMENDATION_RESPONSE_VERSION,
    "recommend",
    "wrong_response_version"
  );
  assertLiveContract(result.provider === "deepseek", "recommend", "wrong_provider");
  assertLiveContract(result.model === process.env.AI_COMPETITION_RECOMMEND_MODEL, "recommend", "wrong_model");
  assertLiveContract(result.promptVersion === "competition-rank.v4", "recommend", "wrong_prompt_version");
  assertLiveContract(result.rankingSource === "deepseek", "recommend", "rule_fallback_used");
  assertLiveContract(result.fallbackUsed === false && result.fallbackMode === "none", "recommend", "fallback_used");
  assertLiveContract(result.recommendations.length === 3, "recommend", "invalid_result_count");
  const ids = result.recommendations.map(({ competitionId }) => competitionId);
  assertLiveContract(new Set(ids).size === ids.length, "recommend", "duplicate_result");
  const verifiedToken = verifyCompetitionConversationToken(conversationToken);
  assertLiveContract(verifiedToken.ok, "recommend", "invalid_completed_token");
  if (!verifiedToken.ok) throw new LiveProtocolError("recommend", "invalid_completed_token");
  const frozenCandidates = getCompetitionRecommendationCandidates(verifiedToken.payload.profile, {
    now: new Date(verifiedToken.payload.qualificationSnapshot.evaluatedAt * 1000),
    transcript: verifiedToken.payload.transcript
  }).recommendations;
  const frozenCandidateIds = new Set(frozenCandidates.map(({ competitionId }) => competitionId));
  assertLiveContract(
    ids.every((competitionId) => frozenCandidateIds.has(competitionId)),
    "recommend",
    "result_outside_frozen_top10"
  );
  const tiers = result.recommendations.map(recommendationTier);
  assertLiveContract(
    tiers.every((tier, index) => index === 0 || tier >= tiers[index - 1]!),
    "recommend",
    "final_tier_order_changed"
  );
  for (const [index, item] of result.recommendations.entries()) {
    assertLiveContract(item.rank === index + 1, "recommend", "invalid_rank");
    assertLiveContract(isCatalogCompetitionId(item.competitionId), "recommend", "unknown_competition");
    assertLiveContract(item.rankingSource === "deepseek", "recommend", "wrong_item_source");
    assertLiveContract(item.explanationSource === "deepseek", "recommend", "wrong_explanation_source");
    assertLiveContract(item.matchScore <= 95 && item.matchScore >= item.baseMatchScore, "recommend", "invalid_match_score");
    assertLiveContract(item.scoreCalibration.adjustment >= 0 && item.scoreCalibration.adjustment <= 8, "recommend", "invalid_calibration");
    assertLiveContract(item.eligibility.status !== "ineligible", "recommend", "hard_ineligible_result");
    assertLiveContract(
      item.recommendationRole !== "reference" ||
        (!item.scoreCalibration.qualified && item.scoreCalibration.adjustment === 0),
      "recommend",
      "reference_was_calibrated"
    );
    assertLiveContract(
      item.scoreCalibration.qualified || item.recommendationRole === "reference",
      "recommend",
      "unqualified_result_not_reference"
    );
    assertLiveContract(
      item.recommendationRole !== "best" || (index === 0 && item.scoreCalibration.qualified),
      "recommend",
      "unqualified_best_label"
    );
    assertLiveContract(
      (item as typeof item & { competition?: unknown }).competition === undefined,
      "recommend",
      "embedded_catalog_record"
    );
    expectExplanationConstraints(item.explanation);
  }
  return ids[0]!;
}

function sanitizedFailure(error: unknown) {
  return error instanceof LiveProtocolError
    ? { phase: error.phase, reason: error.safeReason }
    : { phase: "contract", reason: "unexpected_protocol_assertion" };
}

describe("DeepSeek live acceptance contract (offline)", () => {
  it("defines exactly twenty-one valid V5 questionnaire personas across every required stage and discipline", () => {
    expect(deepSeekLivePersonas).toHaveLength(21);
    expect(deepSeekLivePersonas.length * DEEPSEEK_LIVE_ROUNDS).toBe(63);
    expect(new Set(deepSeekLivePersonas.map(({ id }) => id)).size).toBe(deepSeekLivePersonas.length);
    expect(new Set(deepSeekLivePersonas.map(({ textNormalization }) => textNormalization.freeText)).size)
      .toBe(deepSeekLivePersonas.length);
    for (const persona of deepSeekLivePersonas) {
      const questionnaire = questionnaireForDeepSeekLivePersona(persona);
      expect(competitionRecommendationProfileV5Schema.safeParse(persona.profile).success, persona.id).toBe(true);
      expect(competitionQuestionnaireV1Schema.safeParse(questionnaire).success, persona.id).toBe(true);
      expect(persona.profile.profileVersion).toBe("competition-profile.v5");
      expect(persona.acceptableIds.length, persona.id).toBeGreaterThan(0);
      expect(persona.acceptableIds.every(isCatalogCompetitionId), persona.id).toBe(true);

      const rawTextAnswers = questionnaire.answers.filter(({ freeText }) => Boolean(freeText));
      expect(rawTextAnswers, persona.id).toHaveLength(1);
      expect(rawTextAnswers[0]?.freeText, persona.id).toBe(persona.textNormalization.freeText);
      const local = normalizeCompetitionQuestionnaire(questionnaire);
      expect(local.ok, persona.id).toBe(true);
      if (!local.ok) continue;
      const pending = local.interpretations.filter(({ requiresConfirmation }) => requiresConfirmation);
      expect(pending, persona.id).toHaveLength(1);
      expect(pending[0], persona.id).toMatchObject({
        fieldId: persona.textNormalization.fieldId,
        suggestedValues: [],
        source: "unresolved",
        status: "unmapped",
        requiresConfirmation: true
      });
      const confirmed = confirmCompetitionQuestionnaire(local.interpretations, [{
        fieldId: persona.textNormalization.fieldId,
        values: persona.textNormalization.confirmedValues
      }]);
      expect(confirmed.ok, persona.id).toBe(true);
      if (confirmed.ok) expect(confirmed.profile, persona.id).toEqual(persona.profile);
    }

    const stageGroups = new Set(deepSeekLivePersonas.map(({ stageGroup }) => stageGroup));
    expect(stageGroups).toEqual(new Set([
      "vocational",
      "undergraduate-lower",
      "undergraduate-upper",
      "master",
      "doctorate",
      "recent-graduate"
    ]));
    const coveredMajors = new Set(deepSeekLivePersonas.flatMap(({ profile }) => profile.majorFields));
    expect(DEEPSEEK_LIVE_REQUIRED_MAJOR_FIELDS.every((major) => coveredMajors.has(major))).toBe(true);
    expect(deepSeekLivePersonas.some(({ profile }) => profile.enrollmentStatus === "recent-graduate")).toBe(true);
    expect(deepSeekLivePersonas.filter(({ textNormalization }) => textNormalization).length)
      .toBeGreaterThanOrEqual(20);
    expect(DEEPSEEK_LIVE_ROUNDS).toBe(3);
  });

  it("restricts live clarification to the three preference-only families", () => {
    expect(competitionDynamicQuestionFamilyV3("competition-fit")).toBe("fit");
    expect(competitionDynamicQuestionFamilyV3("candidate-goal-tradeoff")).toBe("goal");
    expect(competitionDynamicQuestionFamilyV3("track:fixture")).toBe("track");
  });

  it("compares confirmed profiles by deep value while rejecting field and array drift", () => {
    const profile = deepSeekLivePersonas[0]!.profile;
    const reordered = Object.fromEntries(Object.entries(profile).reverse()) as unknown as
      CompetitionRecommendationProfileV5;
    expect(liveProfilesEqual(reordered, profile)).toBe(true);
    expect(liveProfilesEqual({
      ...profile,
      weeklyCommitment: profile.weeklyCommitment === "under-5" ? "5-10" : "under-5"
    }, profile)).toBe(false);
    expect(liveProfilesEqual({
      ...profile,
      confirmedFields: [...profile.confirmedFields].reverse()
    }, profile)).toBe(false);
  });

  it("does not configure or call a DeepSeek clarify model", async () => {
    const postClarify = vi.fn<RoutePost>().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      status: "completed",
      nextQuestion: null,
      conversationToken: "signed-server-token",
      askedQuestionCount: 0,
      provider: "server",
      model: "deterministic-preference-policy.v1",
      promptVersion: "competition-clarify.v8",
      fallback: false
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await postLiveClarifyTurn(postClarify, { safe: true }, "198.18.12.1");

    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({
      provider: "server",
      model: "deterministic-preference-policy.v1",
      fallback: false
    });
    expect(postClarify).toHaveBeenCalledTimes(1);
  });
});

function aiResponse(content: string) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("DeepSeek live acceptance deterministic safety net (offline)", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    process.env.AI_PROVIDER = "deepseek";
    process.env.AI_API_KEY = "offline-test-key";
    process.env.AI_COMPETITION_RECOMMEND_MODEL = "offline-test-model";
    process.env.AI_TIMEOUT_MS = "50";
    process.env.AI_RETRY_MAX_DELAY_MS = "5000";
    process.env.AI_TEST_MODE = "0";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = savedEnv;
  });

  it.each([
    {
      label: "empty/incomplete ordering",
      expectedReason: "invalid_output",
      fetcher: () => vi.fn().mockImplementation(() => Promise.resolve(aiResponse('{"recommendations":[]}')))
    },
    {
      label: "invalid JSON",
      expectedReason: "invalid_json",
      fetcher: () => vi.fn().mockImplementation(() => Promise.resolve(aiResponse("not-json")))
    },
    {
      label: "timeout",
      expectedReason: "timeout",
      fetcher: () => vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }))
    },
    {
      label: "provider unavailable",
      expectedReason: "upstream_server_error",
      fetcher: () => vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      }))
    }
  ])("preserves every legal recall candidate after $label", async ({ expectedReason, fetcher }) => {
    const persona = deepSeekLivePersonas[0]!;
    const candidates = getCompetitionRecommendationCandidates(persona.profile).recommendations;
    const expectedIds = candidates.slice(0, 10).map(({ competitionId }) => competitionId);
    expect(expectedIds.length).toBeGreaterThan(0);
    const fetchMock = fetcher();
    vi.stubGlobal("fetch", fetchMock);

    const result = await rankCompetitionRecommendations(persona.profile, [], candidates);

    expect(result).toMatchObject({
      promptVersion: "competition-rank.v4",
      rankingSource: "rule-fallback",
      fallbackUsed: true,
      fallbackMode: "full",
      fallbackReason: expectedReason
    });
    expect(result.recommendations.map(({ competitionId }) => competitionId)).toEqual(expectedIds);
    expect(result.recommendations.length).toBe(expectedIds.length);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const candidatesById = new Map(candidates.map((item) => [item.competitionId, item] as const));
    const rankedCandidates = result.recommendations.map(({ competitionId }) => candidatesById.get(competitionId)!);
    const finalThree = selectFinalVisibleCompetitionRecommendations(
      rankedCandidates,
      persona.profile,
      []
    );
    expect(finalThree).toHaveLength(3);
    expect(new Set(finalThree.map(({ competitionId }) => competitionId)).size).toBe(3);
    expect(finalThree.every(({ eligibility }) => eligibility.status !== "ineligible")).toBe(true);
    expect(finalThree.every(item => item.decisionFit?.actionable)).toBe(true);
  });
});

describe.skipIf(!RUN_LIVE || !LIVE_DIAGNOSTIC_PERSONA_ID)("DeepSeek live selected-persona diagnostic", () => {
  it("runs one selected V5 persona through normalization, clarification and ranking three times", async () => {
    const persona = deepSeekLivePersonas.find(({ id }) => id === LIVE_DIAGNOSTIC_PERSONA_ID);
    expect(persona, `Unknown diagnostic persona: ${LIVE_DIAGNOSTIC_PERSONA_ID}`).toBeDefined();
    const apiKey = getLiveApiKey();
    await expectConfiguredModelsAreAvailable(apiKey);
    const [{ POST: postNormalize }, { POST: postClarify }, { POST: postRecommend }] = await Promise.all([
      import("../../src/app/api/competitions/recommend/normalize/route"),
      import("../../src/app/api/ai/competition-clarify/route"),
      import("../../src/app/api/ai/competition-recommend/route")
    ]);
    const aiConsent = { accepted: true as const, version: getAiConsentVersion() };
    const outcomes: Array<{
      round: number;
      status: "success" | "failure";
      clarificationCount?: number;
      transientRetryCount?: number;
      fallbackReasons?: string[];
      top1?: string;
      phase?: string;
      reason?: string;
    }> = [];
    for (let round = 1; round <= DEEPSEEK_LIVE_ROUNDS; round += 1) {
      try {
        const normalized = await normalizePersona(postNormalize, persona!, 0, round, aiConsent);
        const clarification = await clarifyPersona(
          postClarify,
          persona!,
          0,
          round,
          aiConsent,
          normalized.questionnaireToken,
          normalized.profile
        );
        const top1 = await recommendPersona(
          postRecommend,
          0,
          round,
          aiConsent,
          clarification.conversationToken
        );
        assertLiveContract(persona!.acceptableIds.includes(top1), "recommend", "unacceptable_top1");
        outcomes.push({
          round,
          status: "success",
          clarificationCount: clarification.clarificationCount,
          transientRetryCount: clarification.transientRetryCount,
          fallbackReasons: clarification.fallbackReasons,
          top1
        });
      } catch (error) {
        outcomes.push({ round, status: "failure", ...sanitizedFailure(error) });
      }
    }
    console.info(JSON.stringify({
      scope: "deepseek-live-clarification-diagnostic",
      personaId: persona!.id,
      outcomes
    }));
    expect(outcomes.filter(({ status }) => status === "failure"), JSON.stringify(outcomes)).toEqual([]);
  }, LIVE_TEST_TIMEOUT_MS);
});

describe.skipIf(!RUN_FULL_LIVE)("DeepSeek live competition acceptance", () => {
  it("passes 21 V5 questionnaire personas three times at all hard acceptance gates", async () => {
    const startedAt = Date.now();
    const apiKey = getLiveApiKey();
    await expectConfiguredModelsAreAvailable(apiKey);
    const [{ POST: postNormalize }, { POST: postClarify }, { POST: postRecommend }] = await Promise.all([
      import("../../src/app/api/competitions/recommend/normalize/route"),
      import("../../src/app/api/ai/competition-clarify/route"),
      import("../../src/app/api/ai/competition-recommend/route")
    ]);
    const aiConsent = { accepted: true as const, version: getAiConsentVersion() };
    const totalRuns = deepSeekLivePersonas.length * DEEPSEEK_LIVE_ROUNDS;
    const top1ByPersona = new Map<string, string[]>();
    const clarificationHistogram = new Map<number, number>();
    const protocolFailures: Array<{
      personaId: string;
      round: number;
      phase: string;
      reason: string;
    }> = [];
    const unacceptable: Array<{ personaId: string; round: number; competitionId: string }> = [];
    let protocolSuccesses = 0;
    let expertAcceptable = 0;
    let normalizationConfirmSuccesses = 0;
    let clarifyTransientRetryCount = 0;
    let clarifyFallbackCount = 0;
    const clarifyFallbackReasonCounts = new Map<string, number>();

    for (const [personaIndex, persona] of deepSeekLivePersonas.entries()) {
      top1ByPersona.set(persona.id, []);
      for (let round = 1; round <= DEEPSEEK_LIVE_ROUNDS; round += 1) {
        try {
          const normalized = await normalizePersona(
            postNormalize,
            persona,
            personaIndex,
            round,
            aiConsent
          );
          normalizationConfirmSuccesses += 1;
          const clarification = await clarifyPersona(
            postClarify,
            persona,
            personaIndex,
            round,
            aiConsent,
            normalized.questionnaireToken,
            normalized.profile
          );
          clarificationHistogram.set(
            clarification.clarificationCount,
            (clarificationHistogram.get(clarification.clarificationCount) ?? 0) + 1
          );
          clarifyTransientRetryCount += clarification.transientRetryCount;
          clarifyFallbackCount += clarification.fallbackReasons.length;
          clarification.fallbackReasons.forEach((reason) => {
            clarifyFallbackReasonCounts.set(
              reason,
              (clarifyFallbackReasonCounts.get(reason) ?? 0) + 1
            );
          });
          const top1 = await recommendPersona(
            postRecommend,
            personaIndex,
            round,
            aiConsent,
            clarification.conversationToken
          );
          protocolSuccesses += 1;
          top1ByPersona.get(persona.id)!.push(top1);
          if (persona.acceptableIds.includes(top1)) {
            expertAcceptable += 1;
          } else {
            unacceptable.push({ personaId: persona.id, round, competitionId: top1 });
          }
        } catch (error) {
          protocolFailures.push({ personaId: persona.id, round, ...sanitizedFailure(error) });
        }
      }
    }

    const stability = deepSeekLivePersonas.map(({ id }) => {
      const values = top1ByPersona.get(id) ?? [];
      const counts = new Map<string, number>();
      values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
      const modalCount = Math.max(0, ...counts.values());
      return {
        personaId: id,
        completedRuns: values.length,
        distinctTop1Count: counts.size,
        modalCount,
        rate: modalCount / DEEPSEEK_LIVE_ROUNDS
      };
    });
    const unstable = stability.filter(({ rate }) => rate < 0.9);
    const protocolSuccessRate = protocolSuccesses / totalRuns;
    const expertAcceptanceRate = expertAcceptable / totalRuns;
    const expertAcceptanceAmongProtocolSuccesses = protocolSuccesses
      ? expertAcceptable / protocolSuccesses
      : 0;
    console.info(JSON.stringify({
      scope: "deepseek-live-acceptance-summary",
      personaCount: deepSeekLivePersonas.length,
      roundsPerPersona: DEEPSEEK_LIVE_ROUNDS,
      totalRuns,
      durationMs: Date.now() - startedAt,
      normalizationConfirmSuccesses,
      protocolSuccesses,
      protocolSuccessRate,
      expertAcceptable,
      expertAcceptanceRate,
      expertAcceptanceAmongProtocolSuccesses,
      stablePersonaRate: (stability.length - unstable.length) / stability.length,
      clarificationCountHistogram: Object.fromEntries([...clarificationHistogram.entries()].sort()),
      clarifyTransientRetryCount,
      clarifyFallbackCount,
      clarifyFallbackReasonCounts: Object.fromEntries(
        [...clarifyFallbackReasonCounts.entries()].sort(([left], [right]) => left.localeCompare(right))
      ),
      protocolFailures,
      unacceptable,
      stability
    }));

    expect(protocolFailures, JSON.stringify(protocolFailures)).toEqual([]);
    expect(normalizationConfirmSuccesses).toBe(totalRuns);
    expect(protocolSuccessRate).toBe(1);
    expect(unacceptable, JSON.stringify(unacceptable)).toEqual([]);
    expect(expertAcceptanceRate).toBe(1);
    expect(unstable, JSON.stringify(unstable)).toEqual([]);
    expect(stability.every(({ completedRuns }) => completedRuns === DEEPSEEK_LIVE_ROUNDS)).toBe(true);
    expect(stability.every(({ rate }) => rate >= 0.9)).toBe(true);
  }, LIVE_TEST_TIMEOUT_MS);
});
