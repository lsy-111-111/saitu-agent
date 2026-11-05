import { businessActivityValues } from "@/lib/competitions/business-activities";
import { z } from "zod";
import {
  competitionDynamicAnswerSchema,
  competitionDynamicSignalKeyV3Schema
} from "@/lib/ai/competition-dynamic-question";
import {
  COMPETITION_GOALS,
  COMPETITION_EVIDENCE,
  COMPETITION_ELIGIBILITY_FACT_IDS,
  COMPETITION_ENROLLMENT_STATUSES,
  COMPETITION_EXPERIENCE_LEVELS,
  COMPETITION_INTERESTS,
  COMPETITION_MAJOR_FIELDS,
  COMPETITION_OUTPUTS,
  COMPETITION_PARTICIPATION_PREFERENCES,
  COMPETITION_PARTICIPATION_TIMINGS,
  COMPETITION_PROFILE_FIELD_IDS,
  COMPETITION_PROFILE_VERSION,
  COMPETITION_PROFILE_V5_VERSION,
  COMPETITION_QUESTIONNAIRE_VERSION,
  COMPETITION_REGIONS,
  COMPETITION_RESOURCES,
  COMPETITION_SKILLS,
  COMPETITION_SPECIFIC_SUBJECTS,
  COMPETITION_STAGES,
  COMPETITION_STARTING_POINTS,
  COMPETITION_TEAM_STATUSES,
  COMPETITION_TEAM_SIZES,
  COMPETITION_TEAM_UNITS,
  COMPETITION_TASK_FORMATS,
  COMPETITION_WEEKLY_HOURS,
  type CompetitionDynamicExchangeV3,
  type CompetitionQuestionnaireV1,
  type CompetitionRecommendationProfileV2,
  type CompetitionRecommendationProfileV3,
  type CompetitionRecommendationProfileV4,
  type CompetitionRecommendationProfileV5
} from "@/types/competition-recommendation";

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function exclusiveNone(values: readonly string[]) {
  return values.length === 1 || !values.includes("none");
}

export const competitionRecommendationProfileSchema = z
  .object({
    profileVersion: z.literal(COMPETITION_PROFILE_VERSION),
    stage: z.enum(COMPETITION_STAGES),
    majorFields: z.array(z.enum(COMPETITION_MAJOR_FIELDS)).min(1).max(3).refine(unique),
    skills: z.array(z.enum(COMPETITION_SKILLS)).min(1).max(3).refine(unique),
    interests: z.array(z.enum(COMPETITION_INTERESTS)).min(1).max(3).refine(unique),
    goals: z.array(z.enum(COMPETITION_GOALS)).min(1).max(2).refine(unique),
    preferredOutputs: z.array(z.enum(COMPETITION_OUTPUTS)).min(1).max(2).refine(unique),
    startingPoint: z.enum(COMPETITION_STARTING_POINTS),
    weeklyCommitment: z.enum(COMPETITION_WEEKLY_HOURS),
    teamStatus: z.enum(COMPETITION_TEAM_STATUSES),
    availableResources: z
      .array(z.enum(COMPETITION_RESOURCES))
      .min(1)
      .max(7)
      .refine(unique)
      .refine(exclusiveNone),
    region: z.enum(COMPETITION_REGIONS),
    participationMode: z.enum(COMPETITION_PARTICIPATION_PREFERENCES),
    experienceLevel: z.enum(COMPETITION_EXPERIENCE_LEVELS),
    evidence: z
      .array(z.enum(COMPETITION_EVIDENCE))
      .min(1)
      .max(3)
      .refine(unique)
      .refine(exclusiveNone)
  })
  .strict();

export const competitionDecisionContextSchema = z.object({
  businessActivity: z.enum(businessActivityValues).optional(),
  fixedTeam: z.boolean().optional(),
  excludedTaskFormats: z.array(z.enum([...COMPETITION_TASK_FORMATS, "laboratory"])).max(11).refine(unique).optional(),
  obtainableResources: z.array(z.enum(COMPETITION_RESOURCES)).max(7).refine(unique).refine(values => !values.includes("none")).optional(),
  unavailableResources: z.array(z.enum(COMPETITION_RESOURCES)).max(7).refine(unique).refine(values => !values.includes("none")).optional(),
  experienceRole: z.enum(["observed", "assisted", "independent", "led", "unknown"]).optional(),
  primaryGoal: z.enum(COMPETITION_GOALS).optional()
}).strict().refine(value => !value.obtainableResources?.some(resource => value.unavailableResources?.includes(resource)), "Resource states conflict");

export const competitionRecommendationProfileV5Schema: z.ZodType<
  CompetitionRecommendationProfileV5,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    profileVersion: z.literal(COMPETITION_PROFILE_V5_VERSION),
    questionnaireVersion: z.literal(COMPETITION_QUESTIONNAIRE_VERSION),
    decisionContext: competitionDecisionContextSchema.optional(),
    confirmedFields: z.array(z.enum(COMPETITION_PROFILE_FIELD_IDS)).min(1).max(COMPETITION_PROFILE_FIELD_IDS.length).refine(unique),
    confirmedFacts: z.array(z.enum(COMPETITION_ELIGIBILITY_FACT_IDS)).max(COMPETITION_ELIGIBILITY_FACT_IDS.length).refine(unique),
    stage: z.enum(COMPETITION_STAGES),
    majorFields: z.array(z.enum(COMPETITION_MAJOR_FIELDS)).max(3).refine(unique),
    specificSubjects: z.array(z.enum(COMPETITION_SPECIFIC_SUBJECTS)).max(3).refine(unique),
    skills: z.array(z.enum(COMPETITION_SKILLS)).max(3).refine(unique),
    interests: z.array(z.enum(COMPETITION_INTERESTS)).max(3).refine(unique),
    goals: z.array(z.enum(COMPETITION_GOALS)).max(2).refine(unique),
    preferredOutputs: z.array(z.enum(COMPETITION_OUTPUTS)).max(2).refine(unique),
    startingPoint: z.enum(COMPETITION_STARTING_POINTS),
    weeklyCommitment: z.enum(COMPETITION_WEEKLY_HOURS),
    teamStatus: z.enum(COMPETITION_TEAM_STATUSES),
    availableResources: z.array(z.enum(COMPETITION_RESOURCES)).max(7).refine(unique).refine(exclusiveNone),
    participationMode: z.enum(COMPETITION_PARTICIPATION_PREFERENCES),
    participationTiming: z.enum(COMPETITION_PARTICIPATION_TIMINGS),
    taskFormats: z.array(z.enum(COMPETITION_TASK_FORMATS)).max(3).refine(unique),
    experienceLevel: z.enum(COMPETITION_EXPERIENCE_LEVELS),
    evidence: z.array(z.enum(COMPETITION_EVIDENCE)).max(3).refine(unique).refine(exclusiveNone),
    enrollmentStatus: z.enum(COMPETITION_ENROLLMENT_STATUSES).optional(),
    firstHigherEducationYear: z.number().int().min(1970).max(2035).optional(),
    teamUnit: z.enum(COMPETITION_TEAM_UNITS).optional(),
    teamSize: z.enum(COMPETITION_TEAM_SIZES).optional()
  })
  .strict()
  .superRefine((profile, context) => {
    if (!profile.confirmedFields.includes("stage")) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Current study stage is required", path: ["stage"] });
    }
    if (profile.decisionContext?.primaryGoal && !profile.goals.includes(profile.decisionContext.primaryGoal)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Primary goal must be selected", path: ["decisionContext", "primaryGoal"] });
    }
    if (profile.availableResources.some(resource => profile.decisionContext?.unavailableResources?.includes(resource))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Unavailable resource marked as available", path: ["availableResources"] });
    }
    const presentFacts = COMPETITION_ELIGIBILITY_FACT_IDS.filter((field) => profile[field] !== undefined);
    if (
      presentFacts.length !== profile.confirmedFacts.length ||
      presentFacts.some((field) => !profile.confirmedFacts.includes(field))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only explicitly confirmed eligibility facts may be stored in Profile V5",
        path: ["confirmedFacts"]
      });
    }
  });

export function toCompetitionRecommendationProfileV4(
  profile: CompetitionRecommendationProfileV4 | CompetitionRecommendationProfileV5
): CompetitionRecommendationProfileV4 {
  if (profile.profileVersion === COMPETITION_PROFILE_VERSION) return profile;
  return {
    profileVersion: COMPETITION_PROFILE_VERSION,
    stage: profile.stage,
    majorFields: [...profile.majorFields],
    skills: [...profile.skills],
    interests: [...profile.interests],
    goals: [...profile.goals],
    preferredOutputs: [...profile.preferredOutputs],
    startingPoint: profile.startingPoint,
    weeklyCommitment: profile.weeklyCommitment,
    teamStatus: profile.teamStatus,
    availableResources: [...profile.availableResources],
    // Region is intentionally absent from V5. "other" is a neutral internal
    // compatibility value and must never be shown as a user answer.
    region: "other",
    participationMode: profile.participationMode,
    experienceLevel: profile.experienceLevel,
    evidence: [...profile.evidence]
  };
}

export const aiConsentSchema = z
  .object({
    accepted: z.boolean(),
    version: z.string().min(1).max(80)
  })
  .strict();

export const COMPETITION_RECENT_SIGNAL_HISTORY_LIMIT = 24;
export const competitionRecentSignalKeysSchema = z
  .array(competitionDynamicSignalKeyV3Schema)
  .max(COMPETITION_RECENT_SIGNAL_HISTORY_LIMIT);

const normalizedClarifyRequestSchema = z
  .object({
    aiConsent: aiConsentSchema,
    questionnaireToken: z.string().min(32).max(48 * 1024),
    recentSignalKeys: competitionRecentSignalKeysSchema.optional()
  })
  .strict();

const continuingClarifyRequestSchema = z
  .object({
    aiConsent: aiConsentSchema,
    conversationToken: z.string().min(32).max(48 * 1024),
    answer: competitionDynamicAnswerSchema,
    interpretationConfirmed: z.literal(true).optional(),
    recentSignalKeys: competitionRecentSignalKeysSchema.optional()
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.interpretationConfirmed &&
      (!request.answer.note || request.answer.selectedValues.length === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A text interpretation confirmation requires the original note and a whitelist selection",
        path: ["interpretationConfirmed"]
      });
    }
  });

const skipOptionalClarifyRequestSchema = z
  .object({
    aiConsent: aiConsentSchema,
    conversationToken: z.string().min(32).max(48 * 1024),
    action: z.literal("skip_optional"),
    recentSignalKeys: competitionRecentSignalKeysSchema.optional()
  })
  .strict();

export const competitionClarifyRequestSchema = z.union([
  normalizedClarifyRequestSchema,
  continuingClarifyRequestSchema,
  skipOptionalClarifyRequestSchema
]);

export const competitionRecommendRequestSchema = z
  .object({
    aiConsent: aiConsentSchema,
    conversationToken: z.string().min(32).max(48 * 1024)
  })
  .strict();

export type CompetitionClarifyRequestV5 = z.infer<typeof competitionClarifyRequestSchema>;
export type CompetitionRecommendRequestV5 = z.infer<typeof competitionRecommendRequestSchema>;
/** @deprecated Current recommendation requests use the V5 signed conversation token. */
export type CompetitionRecommendRequestV4 = CompetitionRecommendRequestV5;

export function sanitizeCompetitionProfileForAi(
  profile: CompetitionRecommendationProfileV5
): CompetitionRecommendationProfileV5 {
  return profile;
}

function sanitizeLegacyCompetitionProfileForAi<
  T extends CompetitionRecommendationProfileV4 | CompetitionRecommendationProfileV3 | CompetitionRecommendationProfileV2
>(profile: T): T {
  return profile;
}

export function sanitizeCompetitionTranscriptForAi(
  transcript: readonly CompetitionDynamicExchangeV3[]
): CompetitionDynamicExchangeV3[] {
  return transcript.map(({ question, answer }) => ({
    question: {
      questionId: question.questionId,
      signalKey: question.signalKey,
      prompt: question.prompt,
      selection: question.selection,
      options: question.options.map(({ value, label }) => ({ value, label })),
      ...(question.maxSelections === undefined ? {} : { maxSelections: question.maxSelections }),
      allowsNote: true,
      maxNoteLength: question.maxNoteLength,
      impact: question.impact,
      estimatedPreferenceOutcomeChanges: question.estimatedPreferenceOutcomeChanges
    },
    answer: { selectedValues: [...answer.selectedValues] }
  }));
}

/** @deprecated Legacy, non-route helper; current clarification is deterministic and V5-only. */
export const sanitizeCompetitionProfileForClarification = sanitizeLegacyCompetitionProfileForAi;
/** @deprecated Legacy explanation helper; the current recommendation route uses V5 ranking/explanations. */
export const sanitizeCompetitionProfileForExplanation = sanitizeLegacyCompetitionProfileForAi;
