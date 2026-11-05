export const COMPETITION_STAGES = [
  "vocational",
  "undergraduate-1",
  "undergraduate-2",
  "undergraduate-3",
  "undergraduate-4",
  "master",
  "doctorate",
  "other-or-non-full-time"
] as const;
export type CompetitionStudentStage = (typeof COMPETITION_STAGES)[number];

export const LEGACY_COMPETITION_STAGES = [
  "undergraduate-1",
  "undergraduate-2",
  "undergraduate-3",
  "undergraduate-4",
  "postgraduate"
] as const;
export type LegacyCompetitionStudentStage = (typeof LEGACY_COMPETITION_STAGES)[number];

export const COMPETITION_MAJOR_FIELDS = [
  "computer-science",
  "business",
  "design",
  "engineering",
  "medicine",
  "mathematics",
  "humanities",
  "biology-life-science",
  "chemistry-materials",
  "agriculture-environment",
  "civil-architecture",
  "finance-taxation",
  "public-management",
  "language-culture",
  "physics-geoscience",
  "other"
] as const;
export type CompetitionMajorField = (typeof COMPETITION_MAJOR_FIELDS)[number];

export const COMPETITION_SKILLS = [
  "programming",
  "data-analysis",
  "research",
  "product",
  "design",
  "hardware",
  "writing",
  "presentation",
  "laboratory",
  "structural-design",
  "accounting-finance",
  "policy-analysis",
  "language",
  "fieldwork"
] as const;
export type CompetitionSkill = (typeof COMPETITION_SKILLS)[number];

export const COMPETITION_INTERESTS = [
  "innovation",
  "ai",
  "data",
  "academic-research",
  "language-communication",
  "engineering",
  "robotics",
  "design",
  "media",
  "career",
  "entrepreneurship",
  "medicine-health",
  "biology-life-science",
  "chemistry-materials",
  "agriculture-environment",
  "civil-architecture",
  "culture-language",
  "finance-taxation",
  "public-management",
  "physics-geoscience"
] as const;
export type CompetitionInterest = (typeof COMPETITION_INTERESTS)[number];

export const COMPETITION_OUTPUTS = [
  "software",
  "prototype",
  "research-paper",
  "business-plan",
  "creative-work",
  "presentation",
  "career-plan"
] as const;
export type CompetitionPreferredOutput = (typeof COMPETITION_OUTPUTS)[number];

export const COMPETITION_EXPERIENCE_LEVELS = ["none", "participated", "project-or-award"] as const;
export type CompetitionExperienceLevel = (typeof COMPETITION_EXPERIENCE_LEVELS)[number];

export const COMPETITION_EVIDENCE = ["project", "paper", "prototype", "portfolio", "award", "none"] as const;
export type CompetitionEvidence = (typeof COMPETITION_EVIDENCE)[number];

export const COMPETITION_GOALS = [
  "project",
  "award",
  "postgraduate",
  "employment",
  "portfolio",
  "entrepreneurship",
  "networking"
] as const;
export type CompetitionGoal = (typeof COMPETITION_GOALS)[number];

export const COMPETITION_DIFFICULTIES = ["starter", "balanced", "challenge"] as const;
export type CompetitionDifficulty = (typeof COMPETITION_DIFFICULTIES)[number];

export const COMPETITION_WEEKLY_HOURS = ["under-5", "5-10", "over-10"] as const;
export type CompetitionWeeklyHours = (typeof COMPETITION_WEEKLY_HOURS)[number];

export const COMPETITION_TEAM_STATUSES = ["solo", "looking", "partial", "ready"] as const;
export type CompetitionTeamStatus = (typeof COMPETITION_TEAM_STATUSES)[number];

export const COMPETITION_RESOURCES = [
  "mentor",
  "lab",
  "equipment",
  "data",
  "budget",
  "school-registration",
  "safety-compliance",
  "none"
] as const;
export type CompetitionResource = (typeof COMPETITION_RESOURCES)[number];

export const COMPETITION_REGIONS = [
  "north",
  "east",
  "central",
  "south",
  "southwest",
  "northwest",
  "northeast",
  "other"
] as const;
export type CompetitionRegion = (typeof COMPETITION_REGIONS)[number];

export const COMPETITION_PROFILE_VERSION = "competition-profile.v4" as const;
export const COMPETITION_PROFILE_V3_VERSION = "competition-profile.v3" as const;
export const COMPETITION_PROFILE_V5_VERSION = "competition-profile.v5" as const;
export const COMPETITION_QUESTIONNAIRE_VERSION = "competition-questionnaire.v1" as const;
export const COMPETITION_RECOMMENDATION_RESPONSE_VERSION = "competition-recommendation.v5" as const;
export const COMPETITION_CLARIFICATION_RESPONSE_VERSION = "competition-clarification.v6" as const;

export const COMPETITION_PROFILE_V4_FIELD_IDS = [
  "stage",
  "majorFields",
  "skills",
  "interests",
  "goals",
  "preferredOutputs",
  "startingPoint",
  "weeklyCommitment",
  "teamStatus",
  "availableResources",
  "region",
  "participationMode",
  "experienceLevel",
  "evidence"
] as const;

export const COMPETITION_PROFILE_FIELD_IDS = [
  "stage",
  "majorFields",
  "specificSubjects",
  "skills",
  "interests",
  "goals",
  "preferredOutputs",
  "startingPoint",
  "weeklyCommitment",
  "teamStatus",
  "availableResources",
  "participationMode",
  "participationTiming",
  "taskFormats",
  "experienceLevel",
  "evidence"
] as const;
export type CompetitionProfileFieldId = (typeof COMPETITION_PROFILE_FIELD_IDS)[number];

/**
 * Fine-grained, user-confirmed subject signals. These are editorial matching
 * labels, never official eligibility facts. They mirror the catalog subject
 * taxonomy so a broad major (for example engineering) does not erase a more
 * useful discipline signal (for example integrated circuits).
 */
export const COMPETITION_SPECIFIC_SUBJECTS = [
  "medicine-health",
  "civil-architecture",
  "visual-communication",
  "engineering-practice",
  "chemistry-chemical",
  "geoscience-surveying",
  "physics-optics",
  "mechanics-materials",
  "information-communication",
  "biology-life-science",
  "robotics-automation",
  "water-environment",
  "cybersecurity-systems",
  "statistics-mathematics",
  "finance-accounting",
  "digital-construction",
  "agriculture-equipment",
  "language-culture",
  "public-management",
  "vocational-skills",
  "synthetic-biology",
  "tourism-planning",
  "legal-studies",
  "computing-algorithms",
  "business-innovation",
  "arts-performance"
] as const;
export type CompetitionSpecificSubject = (typeof COMPETITION_SPECIFIC_SUBJECTS)[number];

export const COMPETITION_PARTICIPATION_TIMINGS = [
  "current-cycle",
  "within-3-months",
  "next-cycle-ok",
  "flexible"
] as const;
export type CompetitionParticipationTiming = (typeof COMPETITION_PARTICIPATION_TIMINGS)[number];

export const COMPETITION_TASK_FORMATS = [
  "algorithm",
  "modeling",
  "software",
  "hardware",
  "research",
  "product",
  "entrepreneurship",
  "design",
  "language",
  "career"
] as const;
export type CompetitionTaskFormat = (typeof COMPETITION_TASK_FORMATS)[number];

export const COMPETITION_ENROLLMENT_STATUSES = [
  "full-time-student",
  "part-time-student",
  "recent-graduate",
  "graduated",
  "other"
] as const;
export type CompetitionEnrollmentStatus = (typeof COMPETITION_ENROLLMENT_STATUSES)[number];

export const COMPETITION_TEAM_UNITS = ["same-unit", "mixed-unit", "unsure"] as const;
export type CompetitionTeamUnit = (typeof COMPETITION_TEAM_UNITS)[number];

export const COMPETITION_TEAM_SIZES = [
  "solo",
  "two",
  "three",
  "four",
  "five",
  // Kept for signed V5 tokens created before exact four/five answers existed.
  // New questionnaires never offer this overlapping legacy value.
  "four-five",
  "over-five",
  "unsure"
] as const;
export type CompetitionTeamSize = (typeof COMPETITION_TEAM_SIZES)[number];

export const COMPETITION_ELIGIBILITY_FACT_IDS = [
  "enrollmentStatus",
  "firstHigherEducationYear",
  "teamUnit",
  "teamSize"
] as const;
export type CompetitionEligibilityFactId = (typeof COMPETITION_ELIGIBILITY_FACT_IDS)[number];

export const COMPETITION_INITIAL_QUESTIONNAIRE_FIELD_IDS = [
  ...COMPETITION_PROFILE_FIELD_IDS,
  "enrollmentStatus",
  "teamUnit",
  "teamSize"
] as const;

export const COMPETITION_QUESTIONNAIRE_FIELD_IDS = [
  ...COMPETITION_PROFILE_FIELD_IDS,
  ...COMPETITION_ELIGIBILITY_FACT_IDS
] as const;
export type CompetitionQuestionnaireFieldId = (typeof COMPETITION_QUESTIONNAIRE_FIELD_IDS)[number];

export const COMPETITION_STRENGTH_AREAS = [
  "technology-engineering",
  "research-analysis",
  "product-design",
  "business-operations",
  "material-expression"
] as const;
export type CompetitionStrengthArea = (typeof COMPETITION_STRENGTH_AREAS)[number];

export const COMPETITION_CONSTRAINTS = [
  "time",
  "team",
  "mentor",
  "equipment-data",
  "travel-offline",
  "none"
] as const;
export type CompetitionConstraint = (typeof COMPETITION_CONSTRAINTS)[number];

export const COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH = 120;

export const COMPETITION_STARTING_POINTS = [
  "idea_only",
  "coursework",
  "prototype",
  "validated"
] as const;
export type CompetitionStartingPoint = (typeof COMPETITION_STARTING_POINTS)[number];

export const COMPETITION_PARTICIPATION_PREFERENCES = [
  "remote",
  "offline-local",
  "travel",
  "flexible"
] as const;
export type CompetitionParticipationPreference =
  (typeof COMPETITION_PARTICIPATION_PREFERENCES)[number];

export type CompetitionClarificationAnswer = {
  selectedValues: string[];
  note?: string;
};
export type CompetitionClarificationAnswers = Record<string, CompetitionClarificationAnswer>;

/**
 * Compatibility shape for callers that still render the former five-card questionnaire.
 * New API requests only accept CompetitionRecommendationProfileV5.
 */
export type CompetitionRecommendationProfileV2 = {
  profileVersion: "competition-profile.v2" | typeof COMPETITION_PROFILE_V3_VERSION;
  stage: LegacyCompetitionStudentStage;
  strengthAreas: CompetitionStrengthArea[];
  interests: CompetitionInterest[];
  goals: CompetitionGoal[];
  constraints: CompetitionConstraint[];
  clarifications?: CompetitionClarificationAnswers;
};

/**
 * Anonymous profile collected in exactly five UI turns. Related fields may share one
 * turn, but every value reaching the server is controlled and schema validated.
 */
export type CompetitionRecommendationProfileV3 = {
  profileVersion: typeof COMPETITION_PROFILE_V3_VERSION;
  stage: LegacyCompetitionStudentStage;
  majorFields: CompetitionMajorField[];
  strengthAreas: CompetitionStrengthArea[];
  interests: CompetitionInterest[];
  goals: CompetitionGoal[];
  preferredOutputs: CompetitionPreferredOutput[];
  startingPoint: CompetitionStartingPoint;
  weeklyCommitment: CompetitionWeeklyHours;
  teamStatus: CompetitionTeamStatus;
  availableResources: CompetitionResource[];
  region: CompetitionRegion;
  participationMode: CompetitionParticipationPreference;
};

/**
 * Anonymous fourteen-field profile used by the current API. Direct skills replace
 * the former coarse strength groups; stage now distinguishes vocational, master
 * and doctorate eligibility without collecting an institution or identity.
 */
export type CompetitionRecommendationProfileV4 = {
  profileVersion: typeof COMPETITION_PROFILE_VERSION;
  stage: CompetitionStudentStage;
  majorFields: CompetitionMajorField[];
  skills: CompetitionSkill[];
  interests: CompetitionInterest[];
  goals: CompetitionGoal[];
  preferredOutputs: CompetitionPreferredOutput[];
  startingPoint: CompetitionStartingPoint;
  weeklyCommitment: CompetitionWeeklyHours;
  teamStatus: CompetitionTeamStatus;
  availableResources: CompetitionResource[];
  region: CompetitionRegion;
  participationMode: CompetitionParticipationPreference;
  experienceLevel: CompetitionExperienceLevel;
  evidence: CompetitionEvidence[];
};

/**
 * Canonical profile produced by the signed questionnaire-v1 normalization flow.
 * Current scoring, qualification, clarification and ranking consume this type
 * directly. Older profiles are accepted only by isolated legacy adapters.
 */
export type CompetitionDecisionContext = {
  businessActivity?: import("@/lib/competitions/business-activities").BusinessActivity;
  fixedTeam?: boolean;
  excludedTaskFormats?: (CompetitionTaskFormat | "laboratory")[];
  obtainableResources?: CompetitionResource[];
  unavailableResources?: CompetitionResource[];
  experienceRole?: "observed" | "assisted" | "independent" | "led" | "unknown";
  primaryGoal?: CompetitionGoal;
};

export type CompetitionFitEvidence = {
  goal: string[]; task: string[]; experience: string[]; readiness: string[];
  growth: string[]; unknowns: string[];
};

export type CompetitionRecommendationProfileV5 = Omit<
  CompetitionRecommendationProfileV4,
  "profileVersion" | "region"
> & {
  profileVersion: typeof COMPETITION_PROFILE_V5_VERSION;
  questionnaireVersion: typeof COMPETITION_QUESTIONNAIRE_VERSION;
  decisionContext?: CompetitionDecisionContext;
  confirmedFields: CompetitionProfileFieldId[];
  confirmedFacts: CompetitionEligibilityFactId[];
  specificSubjects: CompetitionSpecificSubject[];
  participationTiming: CompetitionParticipationTiming;
  taskFormats: CompetitionTaskFormat[];
  enrollmentStatus?: CompetitionEnrollmentStatus;
  firstHigherEducationYear?: number;
  teamUnit?: CompetitionTeamUnit;
  teamSize?: CompetitionTeamSize;
};

export const COMPETITION_FIXED_QUESTION_IDS = [
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
] as const;
export type CompetitionFixedQuestionId = (typeof COMPETITION_FIXED_QUESTION_IDS)[number];

export type CompetitionQuestionnaireAnswerV1 = {
  /** One envelope per visible question; values use the `fieldId:value` form. */
  fieldId: CompetitionFixedQuestionId;
  selectedValues: string[];
  freeText?: string;
};

export type CompetitionQuestionnaireV1 = {
  version: typeof COMPETITION_QUESTIONNAIRE_VERSION;
  decisionContext?: CompetitionDecisionContext;
  /** One envelope per answered question. Omitted inputs remain unconfirmed. */
  answers: CompetitionQuestionnaireAnswerV1[];
};

export type CompetitionQuestionnaireInterpretationStatus =
  | "ready"
  | "conflict"
  | "ambiguous"
  | "unmapped";

export type CompetitionQuestionnaireClientInterpretation = {
  fieldId: CompetitionQuestionnaireFieldId;
  explicitValues: string[];
  suggestedValues: string[];
  source: "explicit" | "deterministic" | "model" | "mixed" | "unresolved";
  confidence: number;
  status: CompetitionQuestionnaireInterpretationStatus;
  originalText?: string;
  evidenceSpan?: string;
  rationale: string;
  requiresConfirmation: boolean;
  allowedOptions: CompetitionDynamicQuestionOption[];
  numericRange?: { min: number; max: number };
};

type CompetitionNormalizeResponseBase = {
  ok: true;
  questionnaireToken: string;
  interpretations: CompetitionQuestionnaireClientInterpretation[];
  promptVersion: string;
  provider: string;
  model: string;
  aiUsed: boolean;
};

export type CompetitionNormalizeResponseV1 =
  | (CompetitionNormalizeResponseBase & {
      status: "needs_confirmation";
      fallbackReason?: string;
    })
  | (CompetitionNormalizeResponseBase & {
      status: "confirmed";
      profile: CompetitionRecommendationProfileV5;
    });

export const COMPETITION_FIT_SIGNALS = [
  "algorithm-competition",
  "modeling-intensive",
  "hardware-build",
  "software-engineering",
  "network-systems",
  "robotics-integration",
  "field-research",
  "research-provenance",
  "product-validation",
  "venture-readiness",
  "design-portfolio",
  "sustainability-impact",
  "finance-operations",
  "language-communication",
  "career-evidence"
] as const;
export type CompetitionFitSignal = (typeof COMPETITION_FIT_SIGNALS)[number];

export const COMPETITION_TEAM_ELIGIBILITY_SIGNALS = [
  "solo",
  "team-2",
  "team-3-same-unit",
  "team-3-mixed-unit",
  "team-4-same-unit",
  "team-5-same-unit",
  // Legacy signed transcript value; no new clarification question emits it.
  "team-4-5-same-unit",
  "team-over-5",
  "unsure"
] as const;
export type CompetitionTeamEligibilitySignal =
  (typeof COMPETITION_TEAM_ELIGIBILITY_SIGNALS)[number];

export type CompetitionDynamicSignalKey =
  | "competition-fit"
  | "team-eligibility"
  | `eligibility:${string}`
  | `track:${string}`;

/**
 * Preference-only follow-ups accepted by the current conversation policy.
 * Eligibility facts are intentionally absent: the signed fixed questionnaire
 * and official catalog are the only inputs allowed to settle eligibility.
 */
export type CompetitionDynamicSignalKeyV3 =
  | "competition-fit"
  | "candidate-goal-tradeoff"
  | `track:${string}`;

export type CompetitionDynamicQuestionImpactV3 = "material" | "optional";

export type CompetitionDynamicQuestionOption = {
  value: string;
  label: string;
};

export type CompetitionDynamicQuestionV1 = {
  questionId: string;
  prompt: string;
  selection: "single" | "multiple";
  options: CompetitionDynamicQuestionOption[];
  maxSelections?: number;
  allowsNote: true;
  maxNoteLength: typeof COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH;
};

export type CompetitionDynamicQuestionV2 = CompetitionDynamicQuestionV1 & {
  /** Machine-readable objective used by deterministic scoring and eligibility. */
  signalKey: CompetitionDynamicSignalKey;
};

export type CompetitionDynamicQuestionV3 = CompetitionDynamicQuestionV1 & {
  /** Preference-only objective used by the current scorer and ranker. */
  signalKey: CompetitionDynamicSignalKeyV3;
  /** Optional questions are shown only after the user elects to refine an already-sufficient result. */
  impact: CompetitionDynamicQuestionImpactV3;
  /** Number of distinct ordered Top-3/track outcomes found by server-side counterfactual simulation. */
  estimatedPreferenceOutcomeChanges: number;
};

export type CompetitionDynamicAnswerV1 = {
  selectedValues: string[];
  note?: string;
};

export type CompetitionDynamicExchangeV1 = {
  question: CompetitionDynamicQuestionV1;
  answer: CompetitionDynamicAnswerV1;
};

export type CompetitionDynamicAnswerV2 = CompetitionDynamicAnswerV1;

export type CompetitionDynamicExchangeV2 = {
  question: CompetitionDynamicQuestionV2;
  answer: CompetitionDynamicAnswerV2;
};

export type CompetitionDynamicAnswerV3 = CompetitionDynamicAnswerV1;

export type CompetitionDynamicExchangeV3 = {
  question: CompetitionDynamicQuestionV3;
  answer: CompetitionDynamicAnswerV3;
};

export type CompetitionScoreBreakdown = {
  /** Present on current V5 responses; optional only when reading persisted legacy results. */
  subjectTask?: number;
  skillsEvidence?: number;
  goalsOutputs?: number;
  maturity?: number;
  teamResources?: number;
  availabilityTiming?: number;
  dataConfidence?: number;
  /** @deprecated Compatibility aliases for saved legacy responses. */
  interest: number | null;
  /** @deprecated Compatibility alias of skillsEvidence. */
  background: number | null;
  /** @deprecated Compatibility alias of goalsOutputs. */
  goal: number | null;
  /** @deprecated Compatibility alias of maturity. */
  difficulty: number | null;
  /** @deprecated Compatibility alias of availabilityTiming. */
  access: number | null;
  /** @deprecated Compatibility alias of teamResources. */
  feasibility: number | null;
  /** @deprecated Current scoring incorporates confidence as a positive five-point dimension. */
  completenessPenalty: number;
};

export type CompetitionRegistrationStatusCode =
  | "open"
  | "upcoming"
  | "unknown"
  | "stale"
  | "closed"
  | "cancelled";

export type CompetitionRegistrationStatus = {
  status: CompetitionRegistrationStatusCode;
  label: string;
  note?: string;
  registrationStart?: string;
  registrationEnd?: string;
};

export type CompetitionRecommendationRole =
  | "best-match"
  | "practical"
  | "stretch"
  | "portfolio"
  | "reference";

export type CompetitionScoreCalibration = {
  version: "competition-score-calibration.v1" | "competition-evidence-interval.v1";
  qualified: boolean;
  alignment: number;
  evidenceConfidence: number;
  adjustment: number;
};

/** Product-facing recommendation tier used by the V5 response and persisted V2 saves. */
export type CompetitionRecommendationRoleV2 = "best" | "steady" | "reference";

export type CompetitionRecommendationExplanation = {
  matchReasons: string[];
  possibleGaps: string[];
  preparationTips: string[];
};

export type CompetitionRecommendationExplanationSource = "deepseek" | "rule";
export type CompetitionRecommendationFallbackMode = "none" | "partial" | "full";
export type CompetitionRecommendationFallbackReason =
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
  | "capacity_exhausted"
  | "daily_budget_exhausted"
  | "budget_store_unavailable";

export type CompetitionRecommendationItemV1 = {
  rank: number;
  competitionId: string;
  role: CompetitionRecommendationRole;
  totalScore: number;
  scoreBreakdown: CompetitionScoreBreakdown;
  registrationStatus: CompetitionRegistrationStatus;
  dataNotices: string[];
  name: string;
  category: string;
  summary: string;
  sourceUrl: string;
  explanationSource: CompetitionRecommendationExplanationSource;
  explanation: CompetitionRecommendationExplanation;
};

export type CompetitionRecommendationResponseV1 = {
  catalogVersion: string;
  scorerVersion: string;
  promptVersion: string;
  model: string;
  provider: string;
  fallbackUsed: boolean;
  fallbackMode: CompetitionRecommendationFallbackMode;
  fallbackReason?: CompetitionRecommendationFallbackReason;
  recommendations: CompetitionRecommendationItemV1[];
};

export type CompetitionRecommendationRankingSource = "deepseek" | "rule-fallback" | "evidence-rules";

export type CompetitionRecommendationItemV2 = Omit<CompetitionRecommendationItemV1, "totalScore"> & {
  /** Structured-data score used as context; it does not determine the DeepSeek order. */
  baseMatchScore: number;
  rankingSource: CompetitionRecommendationRankingSource;
  eligibility: CompetitionEligibilityAssessment;
  fit: CompetitionFitAssessment;
  evidenceRefs?: {
    match: string[];
    gaps: string[];
    source: string[];
    tips?: string[];
    /** Per-reference provenance. Only official-fact entries may carry fact/sourceRef. */
    details?: Array<{
      evidenceRef: string;
      kind: "match" | "gap" | "tip";
      provenance: "official-fact" | "editorial-inference" | "user-confirmed" | "preparation";
      fact?: string;
      sourceRef?: string;
      sourceUrl?: string;
    }>;
    /** Official sources for structured facts surfaced with this recommendation. */
    officialFacts?: Array<{ fact: string; sourceRef: string; sourceUrl: string }>;
  };
  recommendedTrack?: { id: string; label: string; evidenceRef?: string } | null;
};

/** Current recommendation item with an auditable display-score calibration. */
export type CompetitionRecommendationItemV3 = CompetitionRecommendationItemV2 & {
  fitEvidence?: CompetitionFitEvidence;
  evaluatedTrackId?: string;
  matchScore: number;
  scoreCalibration: CompetitionScoreCalibration;
  recommendationRole: CompetitionRecommendationRoleV2;
};

export type CompetitionRecommendationResponseV2 = Omit<
  CompetitionRecommendationResponseV1,
  "recommendations"
> & {
  rankingSource: CompetitionRecommendationRankingSource;
  recommendations: CompetitionRecommendationItemV2[];
};

export type CompetitionEligibilityStatus = "eligible" | "needs_clarification" | "ineligible";

export type CompetitionEligibilityAssessment = {
  status: CompetitionEligibilityStatus;
  reasons: string[];
};

export type CompetitionQualificationSnapshotTrackV1 = CompetitionEligibilityAssessment & {
  trackId: string;
  hardFilterReason: string | null;
  sourceRefs: string[];
};

export type CompetitionQualificationSnapshotEntryV1 = CompetitionEligibilityAssessment & {
  competitionId: string;
  hardFilterReason: string | null;
  sourceRefs: string[];
  tracks: CompetitionQualificationSnapshotTrackV1[];
};

/**
 * Eligibility frozen from the signed fixed questionnaire plus official catalog.
 * Preference follow-ups may select an existing branch but never mutate it.
 */
export type CompetitionQualificationSnapshotV1 = {
  version: "competition-qualification-snapshot.v1";
  catalogVersion: string;
  scorerVersion: string;
  entries: CompetitionQualificationSnapshotEntryV1[];
};

export type CompetitionFitAssessment = {
  score: number;
  matchedSignals: string[];
  gaps: string[];
};

export type CompetitionRecommendationNoMatchReason =
  | "no_eligible_candidates"
  | "no_current_cycle_candidates"
  | "below_quality_threshold";

type CompetitionRecommendationResponseV3Base = Omit<
  CompetitionRecommendationResponseV2,
  "recommendations"
>;

export type CompetitionRecommendationResponseV3 = CompetitionRecommendationResponseV3Base &
  (
    | {
        status: "matched";
        /** Runtime validation limits this collection to one through three items. */
        recommendations: CompetitionRecommendationItemV2[];
      }
    | {
        status: "no_match";
        recommendations: [];
        noMatchReason: CompetitionRecommendationNoMatchReason;
      }
  );

/** Current API contract: successful recommendation responses always contain exactly three items. */
export type CompetitionRecommendationResponseV4 = Omit<
  CompetitionRecommendationResponseV2,
  "recommendations"
> & {
  status: "matched";
  recommendations: [
    CompetitionRecommendationItemV2,
    CompetitionRecommendationItemV2,
    CompetitionRecommendationItemV2
  ];
};

/** Short, evidence-qualified shortlist. A valid profile may have no reliable match. */
export type CompetitionRecommendationResponseV5 = Omit<
  CompetitionRecommendationResponseV2, "recommendations"
> & {
  responseVersion: typeof COMPETITION_RECOMMENDATION_RESPONSE_VERSION;
  status: "matched" | "no_match";
  recommendations: CompetitionRecommendationItemV3[];
  alternatives?: { competitionId: string; name: string; reason: string }[];
  candidateAudit?: { competitionId: string; reason: string }[];
};
