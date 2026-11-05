import { describe, expect, it } from "vitest";
import {
  applyFieldAnswer,
  fixedQuestionTurns,
  getFieldAnswer,
  isFieldComplete,
  isTopicComplete,
  isTurnComplete,
  normalizeMultipleAnswer,
  questionTopics,
  toCompetitionQuestionnaireDraft,
  toCompleteProfile,
  turnAnswerLabel,
  type DraftCompetitionProfile
} from "@/components/competitions/recommend/questionFlow";
import {
  FIXED_AUTO_ADVANCE_DELAY_MS,
  MAX_CLARIFICATION_QUESTIONS,
  appendRecentCompetitionSignal,
  canReuseConfirmedQuestionnaireForSessionRecovery,
  clarificationSignalFamily,
  isSafePreferenceQuestion,
  keepClarificationAnswersThroughIndex,
  isCompetitionDynamicSignalKey,
  isCompetitionSessionRecoveryErrorCode,
  normalizeClarificationSelection,
  retryAfterSeconds,
  serviceUnavailableRetryAfterSeconds
} from "@/components/competitions/recommend/useRecommendationConversation";
import { parseCompetitionRecommendationResponseV5 } from "@/lib/competitions/recommendation-runtime-schema";
import {
  isDynamicAnswerConfirmationResolved,
  normalizeDynamicAnswerConfirmationValues,
  parseDynamicAnswerConfirmation
} from "@/components/competitions/recommend/dynamicAnswerConfirmation";
import {
  COMPETITION_PROFILE_FIELD_IDS,
  type CompetitionDynamicQuestionV3,
  type CompetitionDynamicSignalKeyV3
} from "@/types/competition-recommendation";

function answerEveryTurn(): DraftCompetitionProfile {
  return {
    stage: "undergraduate-2",
    enrollmentStatus: "full-time-student",
    majorFields: ["computer-science"],
    specificSubjects: ["information-communication"],
    skills: ["programming", "data-analysis"],
    interests: ["ai"],
    experienceLevel: "participated",
    evidence: ["prototype"],
    goals: ["project", "portfolio"],
    preferredOutputs: ["software"],
    startingPoint: "coursework",
    weeklyCommitment: "5-10",
    teamStatus: "looking",
    teamSize: "unsure",
    teamUnit: "unsure",
    availableResources: ["mentor"],
    participationMode: "remote",
    participationTiming: "within-3-months",
    taskFormats: ["software", "modeling"]
  };
}

const dynamicQuestions: CompetitionDynamicQuestionV3[] = [0, 1, 2].map((index) => ({
  questionId: `dq_dynamic_${index + 1}`,
  signalKey: `track:competition-${index + 1}`,
  prompt: `动态问题 ${index + 1}`,
  selection: "single",
  options: [
    { value: "first", label: "选项一" },
    { value: "second", label: "选项二" }
  ],
  allowsNote: true,
  maxNoteLength: 120,
  impact: "material",
  estimatedPreferenceOutcomeChanges: 2
}));

function validRecommendationResponse() {
  return {
    responseVersion: "competition-recommendation.v5",
    status: "matched",
    catalogVersion: "catalog.v1",
    scorerVersion: "scorer.v1",
    promptVersion: "prompt.v4",
    model: "deepseek-test",
    provider: "deepseek",
    rankingSource: "deepseek",
    fallbackUsed: false,
    fallbackMode: "none",
    recommendations: [0, 1, 2].map((index) => {
      const availabilityTiming = 10 - index * 5;
      const baseMatchScore = 80 + availabilityTiming;
      const rawAlignment = 0.5 * 22 / 25 + 0.3 * 18 / 20 + 0.2 * 13 / 15;
      const adjustment = Math.round(Math.min(
        8,
        (100 - baseMatchScore) * 0.6 * rawAlignment
      ) * 10) / 10;
      return {
        rank: index + 1,
        competitionId: `competition-${index + 1}`,
        role: index === 0 ? "best-match" : index === 1 ? "practical" : "stretch",
        recommendationRole: index === 0 ? "best" : "steady",
        baseMatchScore,
        matchScore: Math.round(Math.min(95, baseMatchScore + adjustment) * 10) / 10,
        scoreCalibration: {
          version: "competition-score-calibration.v1",
          qualified: true,
          alignment: Math.round(rawAlignment * 10_000) / 10_000,
          evidenceConfidence: 1,
          adjustment
        },
        rankingSource: "deepseek",
        scoreBreakdown: {
          subjectTask: 22,
          skillsEvidence: 18,
          goalsOutputs: 13,
          maturity: 8,
          teamResources: 14,
          availabilityTiming,
          dataConfidence: 5,
          interest: 22,
          background: 18,
          goal: 13,
          difficulty: 8,
          access: availabilityTiming,
          feasibility: 14,
          completenessPenalty: 0
        },
        registrationStatus: { status: "unknown", label: "待核验报名时间" },
        eligibility: { status: "eligible", reasons: [] },
        fit: { score: baseMatchScore, matchedSignals: ["programming"], gaps: [] },
        recommendedTrack: null,
        dataNotices: ["时间以官方通知为准"],
        name: `竞赛 ${index + 1}`,
        category: "程序设计",
        summary: "用于运行时边界校验的完整推荐项。",
        sourceUrl: `https://example.com/competition-${index + 1}`,
        explanationSource: "deepseek",
        explanation: {
          matchReasons: ["学科与任务相符"],
          possibleGaps: ["需要核验本届时间"],
          preparationTips: ["先完成一个最小作品"]
        }
      };
    })
  };
}

describe("competition recommendation conversation flow", () => {
  it("uses exactly fourteen flat fixed questions", () => {
    expect(questionTopics).toHaveLength(5);
    expect(fixedQuestionTurns).toHaveLength(14);
    expect(fixedQuestionTurns.map((turn) => turn.id)).toEqual([
      "stage",
      "majorFields",
      "skills",
      "interests",
      "taskFormats",
      "goals",
      "preferredOutputs",
      "startingPoint",
      "experienceLevel",
      "weeklyCommitment",
      "participationTiming",
      "teamStatus",
      "availableResources",
      "participationMode"
    ]);
    expect(fixedQuestionTurns.find((turn) => turn.id === "stage")?.fields.map((field) => field.id)).toEqual([
      "stage",
      "enrollmentStatus"
    ]);
    expect(fixedQuestionTurns.find((turn) => turn.id === "majorFields")?.fields.map((field) => field.id)).toEqual([
      "majorFields",
      "specificSubjects"
    ]);
    expect(fixedQuestionTurns.find((turn) => turn.id === "experienceLevel")?.fields.map((field) => field.id)).toEqual([
      "experienceLevel",
      "evidence"
    ]);
    expect(fixedQuestionTurns.find((turn) => turn.id === "teamStatus")?.fields.map((field) => field.id)).toEqual([
      "teamStatus",
      "teamSize",
      "teamUnit"
    ]);
    expect(new Set(fixedQuestionTurns.flatMap((turn) => turn.fields.map((field) => field.id)))).toEqual(
      new Set([...COMPETITION_PROFILE_FIELD_IDS, "enrollmentStatus", "teamSize", "teamUnit"])
    );
    expect(FIXED_AUTO_ADVANCE_DELAY_MS).toBe(0);
    expect(MAX_CLARIFICATION_QUESTIONS).toBe(3);
  });

  it("maps individual replies to the V4 recommendation profile shape", () => {
    const stageField = fixedQuestionTurns.find((turn) => turn.id === "stage")!.fields[0];
    const majorField = fixedQuestionTurns.find((turn) => turn.id === "majorFields")!.fields[0];
    let profile = applyFieldAnswer({}, stageField, "undergraduate-3");
    profile = applyFieldAnswer(profile, majorField, ["computer-science"]);

    expect(getFieldAnswer(stageField, profile)).toBe("undergraduate-3");
    expect(profile.majorFields).toEqual(["computer-science"]);
    expect(getFieldAnswer(majorField, profile)).toEqual(["computer-science"]);
  });

  it("keeps the none resource mutually exclusive", () => {
    const resourceField = fixedQuestionTurns.find((turn) => turn.id === "availableResources")!.fields[0];

    expect(resourceField.maxSelections).toBe(7);
    expect(resourceField.options.map(({ value }) => value)).toEqual(
      expect.arrayContaining(["school-registration", "safety-compliance"])
    );
    expect(normalizeMultipleAnswer(resourceField, ["mentor", "none"], ["mentor"])).toEqual(["none"]);
    expect(normalizeMultipleAnswer(resourceField, ["none", "mentor"], ["none"])).toEqual(["mentor"]);
  });

  it("normalizes generated choices and re-walks later answers after edits", () => {
    expect(normalizeClarificationSelection(dynamicQuestions[0], ["first", "first", "invented"]))
      .toEqual(["first"]);

    const questions = dynamicQuestions;
    const answers = {
      [questions[0].questionId]: { selectedValues: [questions[0].options[0].value] },
      [questions[1].questionId]: { selectedValues: [questions[1].options[0].value] },
      [questions[2].questionId]: { selectedValues: [questions[2].options[0].value] }
    };
    expect(Object.keys(keepClarificationAnswersThroughIndex(answers, questions, 1))).toEqual([
      questions[0].questionId,
      questions[1].questionId
    ]);
  });

  it("只接受偏好信号并把页面内追问历史限制在最近二十四项", () => {
    expect(isCompetitionDynamicSignalKey("competition-fit")).toBe(true);
    expect(isCompetitionDynamicSignalKey("candidate-goal-tradeoff")).toBe(true);
    expect(isCompetitionDynamicSignalKey("track:iot-design")).toBe(true);
    expect(isCompetitionDynamicSignalKey("team-eligibility")).toBe(false);
    expect(isCompetitionDynamicSignalKey("eligibility:iot-design")).toBe(false);
    expect(isCompetitionDynamicSignalKey("eligibility:../../bad")).toBe(false);

    let history: CompetitionDynamicSignalKeyV3[] = [];
    for (let index = 0; index < 30; index += 1) {
      history = appendRecentCompetitionSignal(history, `track:competition-${index}`);
    }
    expect(history).toHaveLength(24);
    expect(history[0]).toBe("track:competition-6");
    expect(history.at(-1)).toBe("track:competition-29");
  });

  it("阻止资格类文案并将所有赛道问题视为同一问题族", () => {
    expect(clarificationSignalFamily("track:competition-one")).toBe("track");
    expect(clarificationSignalFamily("track:competition-two")).toBe("track");
    expect(clarificationSignalFamily("candidate-goal-tradeoff")).toBe("goal");
    expect(isSafePreferenceQuestion(dynamicQuestions[0])).toBe(true);
    expect(isSafePreferenceQuestion({
      ...dynamicQuestions[0],
      prompt: "你是否已核对且符合当届资格？"
    })).toBe(false);
    expect(isSafePreferenceQuestion({
      ...dynamicQuestions[0],
      signalKey: "eligibility:iot-design"
    })).toBe(false);
  });

  it("使用共享 V3 schema 拒绝选项重复、错误白名单和备注协议篡改", () => {
    const fitQuestion: CompetitionDynamicQuestionV3 = {
      ...dynamicQuestions[0],
      questionId: "dq_fit_runtime",
      signalKey: "competition-fit",
      selection: "multiple",
      maxSelections: 2,
      options: [
        { value: "algorithm-competition", label: "算法与编程" },
        { value: "software-engineering", label: "软件交付" }
      ]
    };
    expect(isSafePreferenceQuestion(fitQuestion)).toBe(true);
    expect(isSafePreferenceQuestion({
      ...fitQuestion,
      options: [fitQuestion.options[0], fitQuestion.options[0]]
    })).toBe(false);
    expect(isSafePreferenceQuestion({
      ...fitQuestion,
      options: [{ value: "invented", label: "模型自行编写" }, fitQuestion.options[1]]
    })).toBe(false);
    expect(isSafePreferenceQuestion({ ...fitQuestion, allowsNote: false })).toBe(false);
    expect(isSafePreferenceQuestion({ ...fitQuestion, maxNoteLength: 119 })).toBe(false);
    expect(isSafePreferenceQuestion({ ...fitQuestion, prompt: "请核对当届资格条件" })).toBe(false);
  });

  it("把过期、无效、旧策略和快照失效统一归入重建会话路径", () => {
    expect([
      "CONVERSATION_EXPIRED",
      "CONVERSATION_TOKEN_EXPIRED",
      "INVALID_CONVERSATION_TOKEN",
      "QUESTIONNAIRE_EXPIRED",
      "INVALID_QUESTIONNAIRE_TOKEN",
      "CONVERSATION_POLICY_CHANGED",
      "QUALIFICATION_SNAPSHOT_CHANGED",
      "INVALID_DYNAMIC_QUESTION",
      "CONVERSATION_NOT_COMPLETED"
    ].every(isCompetitionSessionRecoveryErrorCode)).toBe(true);
    expect([
      "CONVERSATION_POLICY_CHANGED",
      "QUALIFICATION_SNAPSHOT_CHANGED",
      "INVALID_DYNAMIC_QUESTION",
      "CONVERSATION_NOT_COMPLETED"
    ].every(canReuseConfirmedQuestionnaireForSessionRecovery)).toBe(true);
    expect(canReuseConfirmedQuestionnaireForSessionRecovery("CONVERSATION_EXPIRED")).toBe(false);
    expect(isCompetitionSessionRecoveryErrorCode("RATE_LIMITED")).toBe(false);
  });

  it("完整校验 V5 推荐响应的三项排名、七维求和、校准公式和角色不变量", () => {
    const response = validRecommendationResponse();
    expect(parseCompetitionRecommendationResponseV5(response)?.recommendations).toHaveLength(3);

    const invalidMutations: Array<(value: ReturnType<typeof validRecommendationResponse>) => void> = [
      (value) => { value.recommendations[1].competitionId = value.recommendations[0].competitionId; },
      (value) => { value.recommendations[1].rank = 3; },
      (value) => { value.recommendations[0].scoreBreakdown.subjectTask = 26; },
      (value) => { value.recommendations[0].baseMatchScore = 89; },
      (value) => { value.recommendations[0].scoreCalibration.alignment = 0.1; },
      (value) => { value.recommendations[0].scoreCalibration.adjustment = 1; },
      (value) => { value.recommendations[1].recommendationRole = "reference"; },
      (value) => { value.recommendations[0].eligibility.status = "ineligible" as "eligible"; },
      (value) => { (value.recommendations[0] as Record<string, unknown>).unexpected = true; }
    ];
    for (const mutate of invalidMutations) {
      const invalid = structuredClone(response);
      mutate(invalid);
      expect(parseCompetitionRecommendationResponseV5(invalid)).toBeNull();
    }
  });

  it("accepts the dedicated dynamic text confirmation response using only the signed option whitelist", () => {
    const question = dynamicQuestions[0];
    const confirmation = parseDynamicAnswerConfirmation({
      ok: true,
      status: "needs_confirmation",
      interpretationRequired: true,
      interpretation: {
        status: "ready",
        originalText: "被篡改的服务端原文",
        suggestedValues: ["first"],
        rationale: "文字与白名单选项唯一对应。",
        allowedOptions: [
          { value: "first", label: "伪造标签" },
          { value: "second", label: "另一个伪造标签" },
          { value: "invented", label: "伪造选项" }
        ]
      }
    }, question, "我原本填写的回答");

    expect(confirmation).toMatchObject({
      originalText: "我原本填写的回答",
      questionId: question.questionId,
      resolvedValues: ["first"],
      suggestedValues: ["first"]
    });
    expect(confirmation?.allowedOptions).toEqual(question.options);
    expect(confirmation && isDynamicAnswerConfirmationResolved(confirmation, question)).toBe(true);
  });

  it("requires a manual whitelist correction when dynamic text cannot be mapped", () => {
    const question = dynamicQuestions[0];
    const confirmation = parseDynamicAnswerConfirmation({
      error: "DYNAMIC_ANSWER_CONFIRMATION_REQUIRED",
      interpretationRequired: true,
      interpretation: {
        status: "unmapped",
        suggestedValues: ["invented"],
        rationale: "无法唯一对应。",
        allowedOptions: question.options
      }
    }, question, "我想做一个跨学科方向");

    expect(confirmation).toMatchObject({
      originalText: "我想做一个跨学科方向",
      resolvedValues: [],
      status: "unmapped",
      suggestedValues: []
    });
    expect(confirmation && isDynamicAnswerConfirmationResolved(confirmation, question)).toBe(false);
    expect(confirmation && normalizeDynamicAnswerConfirmationValues(
      confirmation,
      question,
      ["invented", "second", "second"]
    )).toEqual(["second"]);
  });

  it("does not preselect a suggestion when the dynamic interpretation is ambiguous or conflicting", () => {
    const question = dynamicQuestions[0];
    const confirmation = parseDynamicAnswerConfirmation({
      error: "DYNAMIC_ANSWER_CONFIRMATION_REQUIRED",
      interpretationRequired: true,
      interpretation: {
        status: "ambiguous",
        suggestedValues: ["first"],
        rationale: "原回答可能对应多个方向。",
        allowedOptions: question.options
      }
    }, question, "这两种方向都可以");

    expect(confirmation).toMatchObject({
      resolvedValues: [],
      status: "ambiguous",
      suggestedValues: ["first"]
    });
    expect(confirmation && isDynamicAnswerConfirmationResolved(confirmation, question)).toBe(false);
  });

  it("rejects a malformed confirmation response that omits a signed-question option", () => {
    const question = dynamicQuestions[0];
    expect(parseDynamicAnswerConfirmation({
      error: "DYNAMIC_ANSWER_CONFIRMATION_REQUIRED",
      interpretationRequired: true,
      interpretation: {
        status: "ready",
        suggestedValues: ["first"],
        allowedOptions: [{ value: "first", label: "选项一" }]
      }
    }, question, "选项一")).toBeNull();
  });

  it("builds complete structured questionnaire values and reports all topics complete", () => {
    const draft = answerEveryTurn();
    const profile = toCompleteProfile(draft);

    expect(profile).toEqual({
      stage: "undergraduate-2",
      majorFields: ["computer-science"],
      specificSubjects: ["information-communication"],
      skills: ["programming", "data-analysis"],
      interests: ["ai"],
      experienceLevel: "participated",
      evidence: ["prototype"],
      goals: ["project", "portfolio"],
      preferredOutputs: ["software"],
      startingPoint: "coursework",
      weeklyCommitment: "5-10",
      teamStatus: "looking",
      availableResources: ["mentor"],
      participationMode: "remote",
      participationTiming: "within-3-months",
      taskFormats: ["software", "modeling"]
    });
    expect(questionTopics.every((_, index) => isTopicComplete(index, draft))).toBe(true);
  });

  it("refuses to create an API profile while a fixed question is unanswered", () => {
    const draft = answerEveryTurn();
    delete draft.participationMode;

    expect(toCompleteProfile(draft)).toBeNull();
    expect(isTopicComplete(3, draft)).toBe(false);
  });

  it("accepts text-only or option-plus-text answers while rejecting personal information", () => {
    const stageTurn = fixedQuestionTurns.find((turn) => turn.id === "stage")!;
    const stageField = stageTurn.fields[0];

    expect(isFieldComplete(stageField, {}, { stage: "目前在读大二" })).toBe(true);
    expect(isTurnComplete(stageTurn, {}, { stage: "目前在读大二，全日制在读" })).toBe(true);
    expect(isFieldComplete(stageField, { stage: "undergraduate-2" }, {
      stage: "我是星河大学的学生"
    })).toBe(false);
    expect(turnAnswerLabel(stageTurn, {
      stage: "undergraduate-2",
      enrollmentStatus: "full-time-student"
    }, {
      stage: "目前课程较多"
    })).toContain("全日制在读；补充：目前课程较多");
  });

  it("serializes every V5 field as selectedValues plus optional freeText for normalization", () => {
    const profile = answerEveryTurn();
    delete profile.stage;
    const questionnaire = toCompetitionQuestionnaireDraft(profile, {
      stage: "目前在读本科二年级",
      taskFormats: "也希望做一些用户调研"
    });

    expect(questionnaire?.version).toBe("competition-questionnaire.v1");
    expect(questionnaire?.answers).toHaveLength(14);
    expect(questionnaire?.answers.find(({ fieldId }) => fieldId === "stage")).toEqual({
      fieldId: "stage",
      selectedValues: ["enrollmentStatus:full-time-student"],
      freeText: "目前在读本科二年级"
    });
    expect(questionnaire?.answers.find(({ fieldId }) => fieldId === "taskFormats")).toEqual({
      fieldId: "taskFormats",
      selectedValues: ["taskFormats:software", "taskFormats:modeling"],
      freeText: "也希望做一些用户调研"
    });
  });

  it("requires both fields in the combined experience-and-evidence turn", () => {
    const turn = fixedQuestionTurns.find((item) => item.id === "experienceLevel")!;
    const profile: DraftCompetitionProfile = { experienceLevel: "participated" };

    expect(isTurnComplete(turn, profile)).toBe(false);
    expect(isTurnComplete(turn, profile, { experienceLevel: "有一份课程项目报告" })).toBe(true);
    expect(turnAnswerLabel(turn, profile, { experienceLevel: "有一份课程项目报告" })).toContain(
      "补充：有一份课程项目报告"
    );
  });

  it("parses both delta-seconds and HTTP-date Retry-After values", () => {
    const now = Date.parse("2026-08-26T04:00:00.000Z");
    expect(retryAfterSeconds(
      new Response(null, { status: 429, headers: { "Retry-After": "42" } }),
      null,
      now
    )).toBe(42);
    expect(retryAfterSeconds(
      new Response(null, {
        status: 429,
        headers: { "Retry-After": new Date(now + 37_000).toUTCString() }
      }),
      null,
      now
    )).toBe(37);
    expect(retryAfterSeconds(
      new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
      { retryAfter: 9 },
      now
    )).toBe(9);
  });

  it("honors bounded retry hints for unavailable security state", () => {
    const response = new Response(null, {
      status: 503,
      headers: { "Retry-After": "5" }
    });
    expect(serviceUnavailableRetryAfterSeconds(response, {
      error: "SECURITY_STATE_UNAVAILABLE",
      retryAfter: 5
    })).toBe(5);
    expect(serviceUnavailableRetryAfterSeconds(
      new Response(null, { status: 503 }),
      { error: "GENERIC_UNAVAILABLE" }
    )).toBe(0);
  });
});
