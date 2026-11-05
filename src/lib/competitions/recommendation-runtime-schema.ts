import { z } from "zod";
import { containsCompetitionGeneratedTextPersonalInfo } from "@/lib/ai/competition-note";
import {
  COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH,
  COMPETITION_FIT_SIGNALS,
  COMPETITION_GOALS,
  COMPETITION_RECOMMENDATION_RESPONSE_VERSION,
  type CompetitionDynamicQuestionV3,
  type CompetitionDynamicSignalKeyV3,
  type CompetitionRecommendationResponseV5,
  type CompetitionScoreBreakdown,
  type CompetitionScoreCalibration
} from "@/types/competition-recommendation";

/** Client-safe runtime contracts shared by the browser boundary and server routes. */
export const MAX_COMPETITION_DYNAMIC_QUESTIONS = 3;
export const MIN_COMPETITION_DYNAMIC_OPTIONS = 2;
export const MAX_COMPETITION_DYNAMIC_OPTIONS = 8;

const unsafeUrlPattern =
  /(?:[a-z][a-z0-9+.-]{1,31}:\/\/|(?:mailto|tel|ftp|file|data):|www\.|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b)/i;
const markdownPattern = /(?:^|\s)(?:#{1,6}|>|[-+*]\s|\d+\.\s)|[`*_\[\]{}]/m;
const sensitiveSolicitationPattern =
  /(?:姓名|真实姓名|名字|姓氏|称呼|手机号|电话号码|联系电话|联系方式|电子邮箱|邮箱|微信号?|QQ号?|身份证|学号|住址|家庭地址|哪所(?:学校|院校|大学|学院|中学|小学|职校)|(?:学校|院校|大学|学院|中学|小学|职校|就读单位)(?:的)?(?:名称|名字|全称|简称|具体信息|就读|在读|是|为|在哪|属于|所属))/i;
const specificSchoolSolicitationPattern =
  /(?:填写|提供|输入|告知|告诉|补充|写下).{0,12}(?:具体|所在|就读|毕业)?(?:学校|院校|大学|学院)(?:名称|名字|全称|简称|信息)?|(?:你|您)(?:的)?(?:目前)?(?:在|就读于|来自|毕业于)?(?:哪所|哪个|什么|具体)(?:学校|院校|大学|学院)|(?:你|您)(?:目前)?(?:的)?(?:所在|就读|毕业)?(?:的)?(?:学校|院校|大学|学院)(?:是)?(?:哪所|哪个|什么|叫什么|名称|名字|全称|简称|[？?]|$)|(?:哪所|哪个|什么)(?:学校|院校|大学|学院)/i;
const forbiddenCurrentEligibilityPromptPattern =
  /(?:资格|已核对且符合|仍需核对|已确认不符合|可参加赛道|是否(?:可|能)参赛|参赛条件|报名条件|官方条件|是否符合|符合(?:条件|要求)|是否满足|满足(?:条件|要求)|学籍|学历阶段|全日制|出生(?:日期|年月|年份|时间)?|入学(?:年份|时间)?|首次接受高等教育|(?:队伍|团队|参赛|队员|成员)(?:人数|数量|规模)|参赛单位|同一参赛单位|申诉通道|地区|院校名称|学校名称)/i;
const forbiddenIdentityClassificationPattern =
  /(?:已创业类|未创业类|(?:工商)?登记|运营满\s*\d*个月|(?:本科生?|研究生|高职).{0,8}组|职业院校(?:组|赛道)|(?:在校)?学生(?:作品)?组|学生赛道|成长赛道|就业赛道)/i;

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function safeGeneratedText(value: string) {
  return (
    !unsafeUrlPattern.test(value) &&
    !markdownPattern.test(value) &&
    !sensitiveSolicitationPattern.test(value) &&
    !specificSchoolSolicitationPattern.test(value) &&
    !containsCompetitionGeneratedTextPersonalInfo(value)
  );
}

export const competitionDynamicSignalKeyV3Schema = z.string().trim().max(120).refine(
  (value) =>
    value === "competition-fit" ||
    value === "candidate-goal-tradeoff" ||
    /^track:[a-z0-9][a-z0-9-]{0,99}$/i.test(value),
  "Unsupported current preference signal key"
).transform((value): CompetitionDynamicSignalKeyV3 => value as CompetitionDynamicSignalKeyV3);

export function competitionDynamicQuestionFamilyV3(
  signalKey: CompetitionDynamicSignalKeyV3
): "track" | "goal" | "fit" {
  if (signalKey.startsWith("track:")) return "track";
  return signalKey === "candidate-goal-tradeoff" ? "goal" : "fit";
}

export function competitionDynamicPromptFingerprint(prompt: string) {
  return prompt
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\p{White_Space}\p{Punctuation}]+/gu, "");
}

const dynamicQuestionOptionSchema = z
  .object({
    value: z.string().trim().min(1).max(48).regex(/^[a-z0-9][a-z0-9_-]*$/i),
    label: z.string().trim().min(1).max(48).refine(safeGeneratedText, "Unsafe option label")
  })
  .strict();

export const competitionDynamicQuestionV3Schema: z.ZodType<
  CompetitionDynamicQuestionV3,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    questionId: z.string().trim().min(1).max(64).regex(/^dq_[a-z0-9][a-z0-9_-]*$/i),
    signalKey: competitionDynamicSignalKeyV3Schema,
    prompt: z
      .string()
      .trim()
      .min(4)
      .max(160)
      .refine(safeGeneratedText, "Unsafe question prompt")
      .refine((value) => !forbiddenCurrentEligibilityPromptPattern.test(value), "Eligibility questions are forbidden")
      .refine((value) => !forbiddenIdentityClassificationPattern.test(value), "Identity classification questions are forbidden"),
    selection: z.enum(["single", "multiple"]),
    options: z.array(dynamicQuestionOptionSchema).min(MIN_COMPETITION_DYNAMIC_OPTIONS).max(MAX_COMPETITION_DYNAMIC_OPTIONS),
    maxSelections: z.number().int().min(1).max(MAX_COMPETITION_DYNAMIC_OPTIONS).optional(),
    allowsNote: z.literal(true),
    maxNoteLength: z.literal(COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH),
    impact: z.enum(["material", "optional"]),
    estimatedPreferenceOutcomeChanges: z.number().int().min(1).max(64)
  })
  .strict()
  .superRefine((question, context) => {
    const values = question.options.map((option) => option.value.toLowerCase());
    const labels = question.options.map((option) => option.label.toLocaleLowerCase("zh-CN"));
    question.options.forEach((option, index) => {
      if (
        forbiddenCurrentEligibilityPromptPattern.test(option.label) ||
        forbiddenIdentityClassificationPattern.test(option.label)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Eligibility language is forbidden in current option labels",
          path: ["options", index, "label"]
        });
      }
    });
    if (!unique(values)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Option values must be unique", path: ["options"] });
    }
    if (!unique(labels)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Option labels must be unique", path: ["options"] });
    }
    if (question.selection === "single" && question.maxSelections !== undefined && question.maxSelections !== 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Single choice maxSelections must be 1", path: ["maxSelections"] });
    }
    if (
      question.selection === "multiple" &&
      (question.maxSelections === undefined || question.maxSelections > question.options.length)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Multiple choice maxSelections is required and cannot exceed option count",
        path: ["maxSelections"]
      });
    }
    const optionValues = new Set(question.options.map(({ value }) => value));
    if (
      question.signalKey === "competition-fit" &&
      [...optionValues].some((value) => !COMPETITION_FIT_SIGNALS.includes(value as (typeof COMPETITION_FIT_SIGNALS)[number]))
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Unsupported fit signal", path: ["options"] });
    }
    if (question.signalKey === "competition-fit" && question.selection !== "multiple") {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Competition fit must be multiple choice", path: ["selection"] });
    }
    if (
      question.signalKey === "candidate-goal-tradeoff" &&
      [...optionValues].some((value) => !COMPETITION_GOALS.includes(value as (typeof COMPETITION_GOALS)[number]))
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Unsupported goal signal", path: ["options"] });
    }
    if (question.signalKey === "candidate-goal-tradeoff" && question.selection !== "single") {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Goal tradeoff must be single choice", path: ["selection"] });
    }
    if (question.signalKey === "candidate-goal-tradeoff" && question.options.length > 4) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Goal tradeoff supports two to four options", path: ["options"] });
    }
    if (question.signalKey.startsWith("track:") && question.selection !== "single") {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Track preference must be single choice", path: ["selection"] });
    }
    if (question.impact === "optional" && question.signalKey !== "candidate-goal-tradeoff") {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Only goal tradeoff can be optional", path: ["impact"] });
    }
    if (question.impact === "material" && question.estimatedPreferenceOutcomeChanges < 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Material questions require at least two preference outcomes",
        path: ["estimatedPreferenceOutcomeChanges"]
      });
    }
  });

const finiteScore = (maximum: number) => z.number().finite().min(0).max(maximum);

const scoreAliasMap = {
  interest: "subjectTask",
  background: "skillsEvidence",
  goal: "goalsOutputs",
  difficulty: "maturity",
  access: "availabilityTiming",
  feasibility: "teamResources"
} as const;

/** Seven-dimensional V5 breakdown. Legacy aliases may be present but may not disagree. */
export const competitionCurrentScoreBreakdownSchema = z.object({
  subjectTask: finiteScore(25),
  skillsEvidence: finiteScore(20),
  goalsOutputs: finiteScore(30),
  maturity: finiteScore(10),
  teamResources: finiteScore(15),
  availabilityTiming: finiteScore(10),
  dataConfidence: finiteScore(5),
  interest: z.number().finite().nullable().optional(),
  background: z.number().finite().nullable().optional(),
  goal: z.number().finite().nullable().optional(),
  difficulty: z.number().finite().nullable().optional(),
  access: z.number().finite().nullable().optional(),
  feasibility: z.number().finite().nullable().optional(),
  completenessPenalty: z.literal(0)
}).strict().superRefine((breakdown, context) => {
  for (const [alias, dimension] of Object.entries(scoreAliasMap) as Array<
    [keyof typeof scoreAliasMap, (typeof scoreAliasMap)[keyof typeof scoreAliasMap]]
  >) {
    const aliasValue = breakdown[alias];
    if (aliasValue !== undefined && aliasValue !== null && aliasValue !== breakdown[dimension]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${alias} must equal ${dimension}`,
        path: [alias]
      });
    }
  }
});

export const competitionScoreCalibrationSchema = z.object({
  version: z.enum(["competition-score-calibration.v1", "competition-evidence-interval.v1"]),
  qualified: z.boolean(),
  alignment: finiteScore(1),
  evidenceConfidence: finiteScore(1),
  adjustment: finiteScore(8)
}).strict();

function round1(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function sameNumber(left: number, right: number) {
  return Math.abs(left - right) <= 1e-9;
}

type CurrentScoreInput = {
  baseMatchScore: number;
  matchScore: number;
  scoreBreakdown: CompetitionScoreBreakdown;
  scoreCalibration: CompetitionScoreCalibration;
};

/**
 * Validates every score invariant derivable from the response. The remaining
 * profileActionability >= 0.35 gate is recomputed from the signed V5 profile
 * on the server and is intentionally not duplicated in a recommendation item.
 */
export function hasValidCompetitionScoreInvariant(input: CurrentScoreInput) {
  const breakdownResult = competitionCurrentScoreBreakdownSchema.safeParse(input.scoreBreakdown);
  const calibrationResult = competitionScoreCalibrationSchema.safeParse(input.scoreCalibration);
  if (!breakdownResult.success || !calibrationResult.success) return false;
  if (!Number.isFinite(input.baseMatchScore) || input.baseMatchScore < 0 || input.baseMatchScore > 100) return false;
  if (!Number.isFinite(input.matchScore) || input.matchScore < 0 || input.matchScore > 100) return false;

  const breakdown = breakdownResult.data;
  const calibration = calibrationResult.data;
  const dimensions = [
    breakdown.subjectTask,
    breakdown.skillsEvidence,
    breakdown.goalsOutputs,
    breakdown.maturity,
    breakdown.teamResources,
    breakdown.availabilityTiming,
    breakdown.dataConfidence
  ];
  if (calibration.version === "competition-evidence-interval.v1") {
    return calibration.adjustment === 0 && input.matchScore === input.baseMatchScore &&
      sameNumber(input.baseMatchScore, round1(dimensions.reduce((n, x) => n + x, 0))) &&
      sameNumber(calibration.alignment, input.baseMatchScore / 100) &&
      breakdown.dataConfidence === 0 && breakdown.availabilityTiming === 0;
  }
  if (breakdown.goalsOutputs > 15 || input.matchScore > 95) return false;
  const expectedBase = round1(dimensions.reduce((sum, score) => sum + score, 0));
  const rawAlignment =
    0.5 * breakdown.subjectTask / 25 +
    0.3 * breakdown.skillsEvidence / 20 +
    0.2 * breakdown.goalsOutputs / 15;
  const rawEvidenceConfidence = breakdown.dataConfidence / 5;
  const expectedAdjustment = calibration.qualified
    ? round1(Math.min(8, (100 - input.baseMatchScore) * 0.6 * rawAlignment * rawEvidenceConfidence))
    : 0;
  const expectedMatch = round1(Math.min(95, input.baseMatchScore + expectedAdjustment));

  return (
    sameNumber(input.baseMatchScore, expectedBase) &&
    sameNumber(calibration.alignment, round4(rawAlignment)) &&
    sameNumber(calibration.evidenceConfidence, round4(rawEvidenceConfidence)) &&
    sameNumber(calibration.adjustment, expectedAdjustment) &&
    sameNumber(input.matchScore, expectedMatch) &&
    (!calibration.qualified || (
      input.baseMatchScore >= 55 &&
      breakdown.subjectTask >= 7.5 &&
      breakdown.teamResources >= 3
    )) &&
    (calibration.qualified || calibration.adjustment === 0)
  );
}

const boundedString = (maximum = 500) => z.string().min(1).max(maximum);
const boundedStringArray = (maximumItems = 20, maximumLength = 500) =>
  z.array(boundedString(maximumLength)).max(maximumItems);
const rankingSourceSchema = z.enum(["deepseek", "rule-fallback", "evidence-rules"]);
const recommendationRoleSchema = z.enum(["best-match", "practical", "stretch", "portfolio", "reference"]);
const recommendationRoleV2Schema = z.enum(["best", "steady", "reference"]);

const registrationStatusSchema = z.object({
  status: z.enum(["open", "upcoming", "unknown", "stale", "closed", "cancelled"]),
  label: boundedString(100),
  note: boundedString(500).optional(),
  registrationStart: boundedString(64).optional(),
  registrationEnd: boundedString(64).optional()
}).strict();

const explanationSchema = z.object({
  matchReasons: boundedStringArray(10),
  possibleGaps: boundedStringArray(10),
  preparationTips: boundedStringArray(10)
}).strict();

const officialEvidenceDetailSchema = z.object({
  evidenceRef: boundedString(500),
  kind: z.enum(["match", "gap", "tip"]),
  provenance: z.literal("official-fact"),
  fact: boundedString(1_000),
  sourceRef: boundedString(500),
  sourceUrl: z.string().url().max(2_048)
}).strict();

const nonOfficialEvidenceDetailSchema = z.object({
  evidenceRef: boundedString(500),
  kind: z.enum(["match", "gap", "tip"]),
  provenance: z.enum(["editorial-inference", "user-confirmed", "preparation"])
}).strict();

const recommendationItemSchema = z.object({
  rank: z.number().int().min(1).max(3),
  competitionId: z.string().min(1).max(160).regex(/^[a-z0-9][a-z0-9-]*$/i),
  role: recommendationRoleSchema,
  recommendationRole: recommendationRoleV2Schema,
  baseMatchScore: finiteScore(100),
  matchScore: finiteScore(100),
  scoreCalibration: competitionScoreCalibrationSchema,
  rankingSource: rankingSourceSchema,
  scoreBreakdown: competitionCurrentScoreBreakdownSchema,
  registrationStatus: registrationStatusSchema,
  eligibility: z.object({
    status: z.enum(["eligible", "needs_clarification"]),
    reasons: boundedStringArray(20, 1_000)
  }).strict(),
  fit: z.object({
    score: finiteScore(100),
    matchedSignals: boundedStringArray(20),
    gaps: boundedStringArray(20, 1_000)
  }).strict(),
  evidenceRefs: z.object({
    match: boundedStringArray(20),
    gaps: boundedStringArray(20),
    source: boundedStringArray(20, 2_048),
    tips: boundedStringArray(20).optional(),
    details: z.array(z.union([officialEvidenceDetailSchema, nonOfficialEvidenceDetailSchema])).max(60).optional(),
    officialFacts: z.array(z.object({
      fact: boundedString(1_000),
      sourceRef: boundedString(500),
      sourceUrl: z.string().url().max(2_048)
    }).strict()).max(40).optional()
  }).strict().optional(),
  recommendedTrack: z.object({
    id: boundedString(160),
    label: boundedString(200),
    evidenceRef: boundedString(500).optional()
  }).strict().nullable().optional(),
  fitEvidence: z.object({goal: boundedStringArray(10), task: boundedStringArray(10), experience: boundedStringArray(10), readiness: boundedStringArray(10), growth: boundedStringArray(10), unknowns: boundedStringArray(10)}).strict().optional(),
  evaluatedTrackId: boundedString(160).optional(),
  dataNotices: boundedStringArray(20, 1_000),
  name: boundedString(300),
  category: boundedString(200),
  summary: boundedString(2_000),
  sourceUrl: z.string().url().max(2_048),
  explanationSource: z.enum(["deepseek", "rule"]),
  explanation: explanationSchema
}).strict().superRefine((recommendation, context) => {
  if (!hasValidCompetitionScoreInvariant(recommendation as CurrentScoreInput)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid score arithmetic", path: ["scoreCalibration"] });
  }
  if (!sameNumber(recommendation.fit.score, recommendation.baseMatchScore)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Fit score must equal base score", path: ["fit", "score"] });
  }

  const qualified = recommendation.scoreCalibration.qualified;
  const expectedCurrentRole = qualified
    ? recommendation.rank === 1 ? "best" : "steady"
    : "reference";
  if (recommendation.recommendationRole !== expectedCurrentRole) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Recommendation role disagrees with qualification", path: ["recommendationRole"] });
  }
  if (!qualified && recommendation.role !== "reference") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Unqualified recommendations must be references", path: ["role"] });
  }
  if (qualified && (recommendation.role === "reference" || (recommendation.rank === 1) !== (recommendation.role === "best-match"))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Legacy role disagrees with final rank", path: ["role"] });
  }
});

const fallbackReasonSchema = z.enum([
  "missing_api_key",
  "mock_mode",
  "mock_not_allowed",
  "provider_not_allowed",
  "authentication_error",
  "insufficient_balance",
  "invalid_request",
  "rate_limited",
  "upstream_server_error",
  "api_error",
  "response_too_large",
  "invalid_json",
  "invalid_output",
  "empty_content",
  "truncated",
  "network_error",
  "timeout",
  "capacity_exhausted",
  "daily_budget_exhausted",
  "budget_store_unavailable"
]);

export const competitionRecommendationResponseV5Schema = z.object({
  responseVersion: z.literal(COMPETITION_RECOMMENDATION_RESPONSE_VERSION),
  status: z.enum(["matched", "no_match"]),
  catalogVersion: boundedString(120),
  scorerVersion: boundedString(120),
  promptVersion: boundedString(120),
  model: boundedString(200),
  provider: boundedString(100),
  rankingSource: rankingSourceSchema,
  fallbackUsed: z.boolean(),
  fallbackMode: z.enum(["none", "partial", "full"]),
  fallbackReason: fallbackReasonSchema.optional(),
  alternatives: z.array(z.object({competitionId: boundedString(160), name: boundedString(300), reason: boundedString(1000)}).strict()).max(7).optional(),
  candidateAudit: z.array(z.object({competitionId: boundedString(160), reason: boundedString(1000)}).strict()).max(2000).optional(),
  recommendations: z.array(recommendationItemSchema).max(3)
}).strict().superRefine((response, context) => {
  const ids = response.recommendations.map(({ competitionId }) => competitionId);
  if ((response.status === "no_match") !== (ids.length === 0)) context.addIssue({code: z.ZodIssueCode.custom, message: "No-match responses must be empty", path: ["recommendations"]});
  if (!unique(ids)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Recommendation ids must be unique", path: ["recommendations"] });
  }
  response.recommendations.forEach((recommendation, index) => {
    if (recommendation.rank !== index + 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Ranks must be 1, 2, 3 in order", path: ["recommendations", index, "rank"] });
    }
    if (recommendation.rankingSource !== response.rankingSource) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Item ranking source must match response", path: ["recommendations", index, "rankingSource"] });
    }
  });
  const tier = (recommendation: (typeof response.recommendations)[number]) =>
    recommendation.scoreCalibration.qualified
      ? recommendation.eligibility.status === "eligible" ? 1 : 2
      : recommendation.eligibility.status === "eligible" ? 3 : 4;
  const tiers = response.recommendations.map(tier);
  if (response.rankingSource !== "evidence-rules" && tiers.some((value, index) => index > 0 && value < tiers[index - 1])) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Final recommendations violate tier ordering", path: ["recommendations"] });
  }
  if (!response.fallbackUsed && (response.fallbackMode !== "none" || response.fallbackReason !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Non-fallback responses cannot carry fallback metadata", path: ["fallbackUsed"] });
  }
  if (response.fallbackUsed && (response.fallbackMode === "none" || response.fallbackReason === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Fallback responses require mode and reason", path: ["fallbackUsed"] });
  }
});

export function parseCompetitionRecommendationResponseV5(
  value: unknown
): CompetitionRecommendationResponseV5 | null {
  const parsed = competitionRecommendationResponseV5Schema.safeParse(value);
  return parsed.success ? parsed.data as CompetitionRecommendationResponseV5 : null;
}
