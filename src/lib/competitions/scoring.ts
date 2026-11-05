import { getSeriesBusinessActivities } from "./business-activities";
import { assessDecisionFit, type DecisionFit } from "./decision-fit";
import type { Competition } from "@/content/competitions";
import { getCompetitionTaxonomySignals } from "@/content/competition-taxonomy";
import type {
  CompetitionDifficulty,
  CompetitionDynamicExchangeV3,
  CompetitionDynamicSignalKeyV3,
  CompetitionEligibilityAssessment,
  CompetitionEvidence,
  CompetitionExperienceLevel,
  CompetitionFitSignal,
  CompetitionFitAssessment,
  CompetitionGoal,
  CompetitionMajorField,
  CompetitionPreferredOutput,
  CompetitionQualificationSnapshotV1,
  CompetitionRecommendationProfileV5,
  CompetitionRecommendationRole,
  CompetitionResource,
  CompetitionScoreBreakdown,
  CompetitionSkill,
  CompetitionTeamStatus,
  CompetitionTaskFormat,
  CompetitionWeeklyHours
} from "@/types/competition-recommendation";
import { deriveCompetitionAvailability, type CompetitionAvailability } from "./availability";
import { COMPETITION_CATALOG_VERSION, getCompetitionCatalog } from "./catalog";

export const COMPETITION_SCORER_VERSION = "evidence-fit-2026-11.v1";
export const COMPETITION_GOAL_WEIGHT_PRESET_VERSION = "goal-priorities-2026-08.v1";
/** @deprecated The former whitelist is now part of the fixed ProfileV5 fields. */
export const COMPETITION_CLARIFICATION_SIGNAL_VERSION = "profile-v5-preference-only-signals-2026-08.v1";
export const COMPETITION_SEMANTIC_ARCHETYPE_WEIGHTS = {
  currentProfile: 0.43,
  legacyCompatibility: 0.55
} as const;

export const COMPETITION_GOAL_WEIGHT_PRESETS: Readonly<Record<CompetitionGoal, number>> = {
  project: 1,
  award: 1.15,
  postgraduate: 1.1,
  employment: 1,
  portfolio: 1,
  entrepreneurship: 1,
  networking: 0.85
};

/** Fixed 100-point weights. Unknown catalog dimensions never re-normalize the remaining dimensions upward. */
export const COMPETITION_SCORE_WEIGHTS = {
  subjectTask: 25,
  skillsEvidence: 20,
  goalsOutputs: 15,
  maturity: 10,
  teamResources: 15,
  availabilityTiming: 10,
  dataConfidence: 5
} as const;

/** Cross-domain transfer stays visible but cannot present as a strong match. */
export const COMPETITION_CORE_MISMATCH_MAX_SUBJECT_TASK_POINTS = 7.4;
export const COMPETITION_CORE_MISMATCH_TRANSFER_RATIOS = {
  skillsEvidence: 0.6,
  goalsOutputs: 0.6,
  teamResources: 0.75
} as const;

export const COMPETITION_PROFILE_SIGNAL_WEIGHTS = {
  majorWithinSubjectTask: 0.5,
  interestWithinTaskIntent: 0.15,
  dynamicWithinTaskIntent: 0.35,
  evidenceWithinSkillsEvidence: 0.25,
  /** @deprecated Compatibility aliases for persisted diagnostics. */
  majorFieldsWithinBackground: 0.35,
  preferredOutputsWithinGoal: 0.3,
  teamStatusWithinFeasibility: 0.25,
  availableResourcesWithinFeasibility: 0.2,
  startingPointWithinFeasibility: 0.1,
  evidenceWithinBackground: 0.2,
  taskFormatsWithinBackground: 0.65,
  // The follow-up asks which competition format the user actually wants to
  // demonstrate. Treat that explicit decision as the dominant background
  // signal so broad catalog tags cannot drown it out.
  dynamicFitWithinBackground: 0.8,
} as const;

type CompetitionScoringProfile = CompetitionRecommendationProfileV5;

export type ScoredCompetition = {
  decisionFit?: DecisionFit;
  competition: Competition;
  recommendedTrack?: { id: string; label: string; evidenceRef?: string } | null;
  baseMatchScore: number;
  scoreBreakdown: CompetitionScoreBreakdown;
  availability: CompetitionAvailability;
  eligibility: CompetitionEligibilityAssessment;
  fit: CompetitionFitAssessment;
  dataNotices: string[];
};

type ScoreDimension = keyof typeof COMPETITION_SCORE_WEIGHTS;
type ScoreRatios = Record<ScoreDimension, number | null>;
type CurrentScoreBreakdown = Record<ScoreDimension, number>;

type CompetitionSemanticArchetype =
  | "algorithm"
  | "competitive-programming"
  | "business-simulation"
  | "business-practice"
  | "robotics"
  | "robotics-system-product"
  | "mechanical-hardware-build"
  | "agricultural-hardware-build"
  | "visual-design"
  | "career-planning"
  | "software-product"
  | "digital-business-systems"
  | "chemistry-laboratory"
  | "chemistry-experiment"
  | "digital-building"
  | "medical-research"
  | "electronics-embedded"
  | "embedded-electronic-build"
  | "specialized-chip-build"
  | "finance-case"
  | "mathematical-modeling"
  | "statistical-research-modeling"
  | "ai-research"
  | "public-management"
  | "field-research-case"
  | "culture-communication"
  | "heritage-culture-creation"
  | "language-performance"
  | "design-production-portfolio"
  | "evidence-led-sustainability"
  | "venture-creation"
  | "humanities-original-research"
  | "market-field-research";

function overlapRatio<T>(selected: readonly T[], supported: readonly T[]): number {
  if (selected.length === 0 || supported.length === 0) return 0;
  const supportedSet = new Set(supported);
  const matches = selected.filter(
    (value, index) => selected.indexOf(value) === index && supportedSet.has(value)
  ).length;
  if (matches === 0) return 0;
  return clamp(0.7 + matches / new Set(supported).size * 0.3, 0, 1);
}

function intentAwareOverlapRatio<T>(selected: readonly T[], supported: readonly T[]): number {
  if (selected.length === 0 || supported.length === 0) return 0;
  const requested = [...new Set(selected)];
  const supportedSet = new Set(supported);
  const matches = requested.filter((value) => supportedSet.has(value)).length;
  if (matches === 0) return 0;
  const userCoverage = matches / requested.length;
  const candidatePrecision = matches / supportedSet.size;
  return clamp(userCoverage * 0.85 + candidatePrecision * 0.15, 0, 1);
}

function intentCoverageWithSpecificity<T>(
  requestedGroups: readonly (readonly T[])[],
  supported: readonly T[]
): number {
  if (requestedGroups.length === 0 || supported.length === 0) return 0;
  const supportedSet = new Set(supported);
  const matchedGroups = requestedGroups.filter((group) =>
    group.some((value) => supportedSet.has(value))
  );
  if (matchedGroups.length === 0) return 0;
  const userCoverage = matchedGroups.length / requestedGroups.length;
  const requestedValues = new Set(requestedGroups.flatMap((group) => group));
  const candidateMatches = [...supportedSet].filter((value) => requestedValues.has(value)).length;
  const candidatePrecision = candidateMatches / supportedSet.size;
  return clamp(userCoverage * 0.85 + candidatePrecision * 0.15, 0, 1);
}

const primaryDisciplineMajors = new Set<CompetitionMajorField>([
  "medicine",
  "biology-life-science",
  "chemistry-materials",
  "agriculture-environment",
  "civil-architecture",
  "finance-taxation",
  "public-management",
  "language-culture",
  "physics-geoscience"
]);

export type CompetitionConfirmedSubjectAssessment = {
  requestedPrimaryMajors: CompetitionMajorField[];
  requestedSpecificSubjects: CompetitionRecommendationProfileV5["specificSubjects"];
  ignoredConflictingSpecificSubjects: CompetitionRecommendationProfileV5["specificSubjects"];
  supportedPrimaryMajors: CompetitionMajorField[];
  supportedSpecificSubjects: NonNullable<Competition["recommendation"]["subjects"]>[number][];
  matchedPrimaryMajors: CompetitionMajorField[];
  matchedSpecificSubjects: CompetitionRecommendationProfileV5["specificSubjects"];
};

/**
 * Resolve only user-confirmed discipline signals. A fine subject that belongs
 * to a different discipline than an explicitly selected specialist major is
 * retained in the signed profile, but cannot silently overpower that primary
 * discipline during ranking.
 */
export function assessCompetitionConfirmedSubjectAlignment(
  competition: Competition,
  profile: CompetitionRecommendationProfileV5
): CompetitionConfirmedSubjectAssessment {
  const requestedPrimaryMajors = profile.confirmedFields.includes("majorFields")
    ? profile.majorFields.filter((major) => primaryDisciplineMajors.has(major))
    : [];
  const confirmedSpecificSubjects = profile.confirmedFields.includes("specificSubjects")
    ? [...profile.specificSubjects]
    : [];
  const confirmedMajorSet = new Set<CompetitionMajorField>(
    profile.confirmedFields.includes("majorFields")
      ? profile.majorFields.filter((major) => major !== "other")
      : []
  );
  const requestedSpecificSubjects = requestedPrimaryMajors.length === 0
    ? confirmedSpecificSubjects
    : confirmedSpecificSubjects.filter((subject) =>
        getCompetitionTaxonomySignals([subject]).majors.some((major) => confirmedMajorSet.has(major))
      );
  const requestedSpecificSet = new Set(requestedSpecificSubjects);
  const supportedPrimaryMajors = competition.recommendation.majors.filter((major) =>
    primaryDisciplineMajors.has(major)
  );
  const supportedSpecificSubjects = [...(competition.recommendation.subjects ?? [])];
  const supportedMajorSet = new Set(competition.recommendation.majors);
  const supportedSpecificSet = new Set(supportedSpecificSubjects);
  return {
    requestedPrimaryMajors,
    requestedSpecificSubjects,
    ignoredConflictingSpecificSubjects: confirmedSpecificSubjects.filter(
      (subject) => !requestedSpecificSet.has(subject)
    ),
    supportedPrimaryMajors,
    supportedSpecificSubjects,
    matchedPrimaryMajors: requestedPrimaryMajors.filter((major) => supportedMajorSet.has(major)),
    matchedSpecificSubjects: requestedSpecificSubjects.filter((subject) => supportedSpecificSet.has(subject))
  };
}

export function hasDominantConfirmedSubjectMatch(
  assessment: CompetitionConfirmedSubjectAssessment
) {
  return assessment.requestedPrimaryMajors.length > 0
    ? assessment.matchedPrimaryMajors.length > 0 ||
        assessment.matchedSpecificSubjects.length > 0
    : assessment.requestedSpecificSubjects.length > 0 &&
        assessment.matchedSpecificSubjects.length > 0;
}

function profileSemanticArchetypes(
  profile: CompetitionScoringProfile
): CompetitionSemanticArchetype[] {
  const majors = new Set(profile.majorFields);
  const skills = new Set(profile.skills);
  const interests = new Set(profile.interests);
  const tasks = new Set(profile.taskFormats);
  const outputs = new Set(profile.preferredOutputs);
  const archetypes: CompetitionSemanticArchetype[] = [];

  const isAiResearch = interests.has("ai") && tasks.has("algorithm") && tasks.has("research");
  // A compound AI-research intent is more specific than generic programming.
  // Treating it as both independently made plain programming contests look
  // equivalent to AI research/application competitions.
  const isCompetitiveProgramming = tasks.has("algorithm") &&
    tasks.has("software") &&
    skills.has("programming") &&
    outputs.has("software");
  if (tasks.has("algorithm") && !isAiResearch) {
    archetypes.push("algorithm");
    if (isCompetitiveProgramming) {
      archetypes.push("competitive-programming");
    }
  }
  if (
    majors.has("finance-taxation") &&
    skills.has("accounting-finance") &&
    tasks.has("entrepreneurship") &&
    tasks.has("product")
  ) {
    archetypes.push("business-simulation");
    archetypes.push("business-practice");
  }
  if (interests.has("robotics") && skills.has("hardware")) archetypes.push("robotics");
  if (
    interests.has("robotics") &&
    tasks.has("hardware") &&
    tasks.has("product") &&
    outputs.has("prototype") &&
    outputs.has("software")
  ) {
    // A complete robot product/system intent is broader than a vehicle-only
    // control build. This distinction comes entirely from the fixed profile:
    // the user must have named product work and both physical and software
    // deliverables before it can affect ordering.
    archetypes.push("robotics-system-product");
  }
  if (
    majors.has("engineering") &&
    skills.has("hardware") &&
    skills.has("structural-design") &&
    tasks.has("hardware") &&
    outputs.has("prototype") &&
    (
      profile.specificSubjects.includes("engineering-practice") ||
      profile.specificSubjects.includes("mechanics-materials")
    )
  ) archetypes.push("mechanical-hardware-build");
  if (
    majors.has("agriculture-environment") &&
    skills.has("hardware") &&
    tasks.has("hardware") &&
    outputs.has("prototype")
  ) archetypes.push("agricultural-hardware-build");
  if (majors.has("design") && (tasks.has("design") || outputs.has("creative-work"))) {
    archetypes.push("visual-design");
  }
  if (interests.has("career") && (tasks.has("career") || outputs.has("career-plan"))) {
    archetypes.push("career-planning");
  }
  if (
    tasks.has("software") &&
    !tasks.has("hardware") &&
    (outputs.has("software") || outputs.has("prototype") || tasks.has("product")) &&
    (profile.startingPoint === "prototype" ||
      profile.startingPoint === "validated" ||
      profile.evidence.includes("project") ||
      profile.evidence.includes("prototype"))
  ) {
    archetypes.push("software-product");
  }
  if (majors.has("chemistry-materials") && skills.has("laboratory")) {
    archetypes.push("chemistry-laboratory");
    if (
      tasks.has("research") &&
      (skills.has("research") || skills.has("data-analysis")) &&
      outputs.has("research-paper")
    ) {
      archetypes.push("chemistry-experiment");
    }
  }
  if (majors.has("civil-architecture") && skills.has("structural-design")) {
    archetypes.push("digital-building");
  }
  if (
    (majors.has("medicine") || majors.has("biology-life-science")) &&
    skills.has("laboratory")
  ) archetypes.push("medical-research");
  const hasElectronicFoundation =
    (majors.has("engineering") && skills.has("programming")) ||
    (majors.has("physics-geoscience") && skills.has("laboratory"));
  const isElectronicBuild =
    !interests.has("robotics") &&
    (majors.has("engineering") || majors.has("physics-geoscience")) &&
    skills.has("hardware") &&
    hasElectronicFoundation &&
    tasks.has("hardware") && tasks.has("software") &&
    outputs.has("prototype");
  if (isElectronicBuild) {
    archetypes.push("electronics-embedded");
    archetypes.push("embedded-electronic-build");
  }
  if (
    majors.has("finance-taxation") &&
    skills.has("accounting-finance") &&
    tasks.has("research")
  ) archetypes.push("finance-case");
  if (tasks.has("modeling")) {
    archetypes.push("mathematical-modeling");
    if (
      tasks.has("research") &&
      skills.has("data-analysis") &&
      skills.has("research") &&
      outputs.has("research-paper")
    ) {
      archetypes.push("statistical-research-modeling");
    }
  }
  if (isAiResearch) {
    archetypes.push("ai-research");
  }
  if (
    majors.has("public-management") &&
    (skills.has("policy-analysis") || skills.has("fieldwork"))
  ) {
    archetypes.push("public-management");
    if (
      tasks.has("research") &&
      outputs.has("research-paper") &&
      (skills.has("fieldwork") || skills.has("research"))
    ) {
      archetypes.push("field-research-case");
    }
  }
  if (
    majors.has("language-culture") &&
    interests.has("culture-language")
  ) archetypes.push("culture-communication");

  if (
    majors.has("language-culture") &&
    interests.has("culture-language") &&
    tasks.has("language") &&
    (tasks.has("research") || tasks.has("design")) &&
    (outputs.has("creative-work") || outputs.has("research-paper"))
  ) {
    archetypes.push("heritage-culture-creation");
  }

  return [...new Set(archetypes)];
}

function competitionSemanticArchetypes(
  competition: Competition
): CompetitionSemanticArchetype[] {
  // Only stable editorial identity/category copy is used here. This is a soft
  // task ontology and must never participate in hard eligibility decisions.
  const text = `${competition.identity?.canonicalName ?? competition.name} ${competition.category}`
    .normalize("NFKC")
    .toLowerCase();
  const archetypes: CompetitionSemanticArchetype[] = [];
  const matches = (pattern: RegExp) => pattern.test(text);
  const fitSignals = competition.recommendation.fit?.signals ?? [];

  if (matches(/算法|程序设计|programming|\bicpc\b/)) archetypes.push("algorithm");
  if (matches(/程序设计|蓝桥杯|码蹄杯|百度之星|competitive programming|\bicpc\b/)) {
    archetypes.push("competitive-programming");
  }
  if (matches(/经营.*模拟|模拟.*经营|创业.*模拟|企业竞争模拟|经营沙盘|商业沙盘|business simulation/)) {
    archetypes.push("business-simulation");
  }
  if (matches(/经营|商业|财会|会计|市场调研|市场调查|商科/)) {
    archetypes.push("business-practice");
  }
  if (matches(/机器人|智能车|\brobocon\b|\brobotac\b|\brobocup\b|\braicom\b/)) {
    archetypes.push("robotics");
  }
  if (
    matches(/机器人|\brobocon\b|\brobotac\b|\brobocup\b|\braicom\b/) &&
    fitSignals.includes("robotics-integration")
  ) {
    // General robot-system events support end-to-end product integration;
    // the narrower intelligent-car family deliberately remains a related,
    // but not exact, match for this fixed-profile prototype.
    archetypes.push("robotics-system-product");
  }
  const subjects = new Set(competition.recommendation.subjects ?? []);
  if (
    (
      fitSignals.includes("hardware-build") ||
      fitSignals.includes("robotics-integration")
    ) &&
    (
      subjects.has("engineering-practice") ||
      subjects.has("robotics-automation") ||
      subjects.has("vocational-skills") ||
      subjects.has("agriculture-equipment")
    )
  ) archetypes.push("mechanical-hardware-build");
  if (
    subjects.has("agriculture-equipment") &&
    (
      fitSignals.includes("hardware-build") ||
      fitSignals.includes("robotics-integration")
    )
  ) archetypes.push("agricultural-hardware-build");
  if (matches(/广告|视觉|数字艺术|设计周|华灿|创意设计/)) archetypes.push("visual-design");
  if (matches(/职业规划|career planning/)) archetypes.push("career-planning");
  if (matches(/软件杯|服务外包|软件创新|应用场景|software cup|service outsourcing/)) {
    archetypes.push("software-product");
  }
  if (matches(/金融科技|金融创新|物流设计|供应链|fintech|supply chain|logistics design/)) {
    archetypes.push("digital-business-systems");
  }
  if (matches(/化学.*实验|化工.*实验|金相/)) archetypes.push("chemistry-laboratory");
  if (matches(/(?:化学|化工).*实验|实验.*(?:化学|化工)/)) {
    archetypes.push("chemistry-experiment");
  }
  if (matches(/结构设计|\bbim\b|数字建筑|数字建造|先进成图|花园设计|测绘/)) {
    archetypes.push("digital-building");
  }
  if (matches(/医学|生命科学|合成生物|\bigem\b/)) archetypes.push("medical-research");
  if (matches(/电子设计|集成电路|芯片|嵌入式|光电/)) archetypes.push("electronics-embedded");
  if (matches(/电子设计|集成电路|芯片|嵌入式/)) {
    archetypes.push("embedded-electronic-build");
  }
  if (matches(/集成电路|芯片|嵌入式/)) archetypes.push("specialized-chip-build");
  if (matches(/税收|税务|财会|会计/)) archetypes.push("finance-case");
  if (matches(/数学建模|统计建模|mathematical modeling|\bmcm\b|\bicm\b/)) {
    archetypes.push("mathematical-modeling");
  }
  if (matches(/统计建模|statistical modeling/)) {
    archetypes.push("statistical-research-modeling");
  }
  if (
    matches(/人工智能.*(?:算法|创新)|ai算法|ai应用/) &&
    !matches(/机器人/)
  ) archetypes.push("ai-research");
  if (
    matches(/人工智能.*创新|ai应用/) &&
    !matches(/机器人/) &&
    fitSignals.includes("software-engineering") &&
    fitSignals.includes("product-validation")
  ) archetypes.push("software-product");
  if (
    matches(/机器人.*人工智能|人工智能.*机器人/) &&
    fitSignals.includes("software-engineering")
  ) archetypes.push("ai-research");
  if (matches(/公共管理/)) archetypes.push("public-management");
  if (
    fitSignals.includes("field-research") &&
    matches(/社会调研|市场调查|案例|学术科技|field research|case study/)
  ) {
    archetypes.push("field-research-case");
  }
  if (matches(/中华经典|文化中国|中华文化|理解当代中国|跨文化/)) {
    archetypes.push("culture-communication");
  }
  if (matches(/中华经典|文化中国|中华文化/) && !matches(/理解当代中国|跨文化/)) {
    archetypes.push("heritage-culture-creation");
  }
  if (matches(/外语|英语|演讲|诵写讲|中华经典|文化中国|翻译|口译/) && !matches(/跨文化/)) {
    archetypes.push("language-performance");
  }
  if (matches(/广告|工业设计|计算机设计|数字媒体|未来设计师|\bncda\b/)) {
    archetypes.push("design-production-portfolio");
  }
  if (
    fitSignals.includes("sustainability-impact") &&
    matches(/节能|减排|低碳|绿色发展|水利|水资源|能源经济/)
  ) {
    archetypes.push("evidence-led-sustainability");
  }
  if (matches(/创业计划|创新创业|互联网\+|中国国际大学生创新|ican/) && !matches(/服务外包/)) {
    archetypes.push("venture-creation");
  }
  if (
    fitSignals.includes("research-provenance") &&
    matches(/挑战杯.*学术|课外学术科技|市场调查|市场研究|能源经济/)
  ) {
    archetypes.push("humanities-original-research");
  }
  if (matches(/市场调查|市场研究/)) {
    archetypes.push("market-field-research");
  }
  return [...new Set(archetypes)];
}

export function semanticArchetypeFit(
  competition: Competition,
  profile: CompetitionScoringProfile
): number | null {
  const requested = profileSemanticArchetypes(profile);
  if (requested.length === 0) return null;
  const supported = new Set(competitionSemanticArchetypes(competition));
  const specificityWeights: Partial<Record<CompetitionSemanticArchetype, number>> = {
    // Fine task subtypes carry more information than their parent family. A
    // generic lab/modeling match remains related, but is not equally exact.
    "chemistry-experiment": 2,
    "statistical-research-modeling": 3,
    "competitive-programming": 4,
    "business-simulation": 3,
    "robotics-system-product": 2,
    "mechanical-hardware-build": 3,
    "agricultural-hardware-build": 4,
    "embedded-electronic-build": 2,
    "specialized-chip-build": 2,
    "software-product": 2,
    "ai-research": 3,
    "digital-business-systems": 2,
    "language-performance": 3,
    "heritage-culture-creation": 4,
    "design-production-portfolio": 3,
    "evidence-led-sustainability": 3,
    "venture-creation": 4,
    "humanities-original-research": 4,
    "market-field-research": 4
  };
  const totalWeight = requested.reduce(
    (sum, archetype) => sum + (specificityWeights[archetype] ?? 1),
    0
  );
  const matchedWeight = requested.reduce(
    (sum, archetype) => sum + (supported.has(archetype) ? specificityWeights[archetype] ?? 1 : 0),
    0
  );
  return matchedWeight / totalWeight;
}

/** Fixed-question evidence required before a V5 item can be a quality match. */
export function hasCompetitionFixedCoreMatch(
  competition: Competition,
  profile: CompetitionRecommendationProfileV5
) {
  const subjectMatch = hasDominantConfirmedSubjectMatch(
    assessCompetitionConfirmedSubjectAlignment(competition, profile)
  );
  const taskMatch =
    profile.confirmedFields.includes("taskFormats") &&
    profile.taskFormats.length > 0 &&
    (semanticArchetypeFit(competition, profile) ?? 0) > 0;
  return subjectMatch || taskMatch;
}

function averageKnown(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

function averageWithUnknownZero(values: readonly (number | null)[]): number {
  return values.length ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / values.length : 0;
}

function blendOptional(base: number | null, signal: number | null, signalWeight: number): number | null {
  if (base === null) return signal;
  if (signal === null) return base;
  return base * (1 - signalWeight) + signal * signalWeight;
}

function majorFields(profile: CompetitionScoringProfile): CompetitionMajorField[] {
  return profile.majorFields;
}

function preferredOutputs(profile: CompetitionScoringProfile): CompetitionPreferredOutput[] {
  return profile.preferredOutputs;
}

function startingPoint(profile: CompetitionScoringProfile) {
  return profile.startingPoint;
}

function weeklyCommitment(profile: CompetitionScoringProfile) {
  return profile.weeklyCommitment;
}

function teamStatus(profile: CompetitionScoringProfile) {
  return profile.teamStatus;
}

function resources(profile: CompetitionScoringProfile): CompetitionResource[] {
  return profile.availableResources;
}

function participationMode(profile: CompetitionScoringProfile) {
  return profile.participationMode;
}

function profileSkills(profile: CompetitionScoringProfile): CompetitionSkill[] {
  return profile.skills;
}

function experienceLevel(profile: CompetitionScoringProfile) {
  return profile.experienceLevel;
}

function evidence(profile: CompetitionScoringProfile): CompetitionEvidence[] {
  return profile.evidence;
}

function normalizedStage(profile: CompetitionScoringProfile) {
  return profile.stage;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

const difficultyIndex: Record<CompetitionDifficulty, number> = { starter: 0, balanced: 1, challenge: 2 };
const hoursIndex: Record<CompetitionWeeklyHours, number> = { "under-5": 0, "5-10": 1, "over-10": 2 };

function proximity(left: number, right: number): number {
  const distance = Math.abs(left - right);
  return distance === 0 ? 1 : distance === 1 ? 0.65 : 0.25;
}

function fixedStrengthFit(competition: Competition, profile: CompetitionScoringProfile): number {
  return overlapRatio(
    profileSkills(profile),
    competition.recommendation.skillEvidenceSignals ?? competition.recommendation.skills
  );
}

function majorDirectionFit(competition: Competition, profile: CompetitionScoringProfile): number | null {
  const selected = majorFields(profile);
  if (!selected.length) return null;
  const supported = competition.recommendation.majors;
  const requestedSpecialisms = selected.filter((major) => primaryDisciplineMajors.has(major));
  if (!requestedSpecialisms.length) return intentAwareOverlapRatio(selected, supported);

  const supportedSet = new Set(supported);
  const specialismCoverage = requestedSpecialisms.filter((major) => supportedSet.has(major)).length /
    requestedSpecialisms.length;
  const requestedBroad = selected.filter((major) => !primaryDisciplineMajors.has(major));
  const broadCoverage = requestedBroad.length
    ? requestedBroad.filter((major) => supportedSet.has(major)).length / requestedBroad.length
    : 1;
  // A confirmed fine discipline is the dominant signal. Broad umbrella fields
  // remain useful as a small tie-breaker, but cannot let a generic event outrank
  // an exact chemistry/medicine/tax/public-management match.
  return specialismCoverage > 0
    ? clamp(specialismCoverage * 0.82 + broadCoverage * 0.18, 0, 1)
    : intentAwareOverlapRatio(selected, supported) * 0.35;
}

function specificSubjectFit(
  competition: Competition,
  profile: CompetitionScoringProfile
): number | null {
  if (!profile.specificSubjects.length) return null;
  const assessment = assessCompetitionConfirmedSubjectAlignment(competition, profile);
  const selected = assessment.requestedSpecificSubjects;
  if (selected.length === 0) return null;
  const supported = competition.recommendation.subjects ?? [];
  return supported.length
    ? intentAwareOverlapRatio(selected, supported)
    : null;
}

function preferredOutputFit(competition: Competition, profile: CompetitionScoringProfile): number | null {
  const selected = preferredOutputs(profile);
  return selected.length ? overlapRatio(selected, competition.recommendation.preferredOutputs) : null;
}

function startingPointFit(competition: Competition, profile: CompetitionScoringProfile) {
  const value = startingPoint(profile);
  const supported = competition.recommendation.fit?.startingPoints;
  if (!value || !supported?.length) return null;
  return supported.includes(value) ? 1 : 0.35;
}

function experienceDifficultyFit(competition: Competition, profile: CompetitionScoringProfile): number | null {
  const selected = experienceLevel(profile);
  if (!selected || !competition.recommendation.experienceLevels.length) return null;
  const preferred: Record<CompetitionExperienceLevel, CompetitionDifficulty> = {
    none: "starter",
    participated: "balanced",
    "project-or-award": "challenge"
  };
  return proximity(
    difficultyIndex[preferred[selected]],
    difficultyIndex[competition.recommendation.difficulty]
  );
}

function evidenceFit(competition: Competition, profile: CompetitionScoringProfile): number | null {
  const selected = evidence(profile).filter((value) => value !== "none");
  return selected.length && competition.recommendation.evidence.length ? overlapRatio(selected, competition.recommendation.evidence) : null;
}

const taskFormatSignals: Readonly<Record<CompetitionTaskFormat, readonly CompetitionFitSignal[]>> = {
  algorithm: ["algorithm-competition"],
  modeling: ["modeling-intensive"],
  software: ["software-engineering", "network-systems"],
  hardware: ["hardware-build", "robotics-integration"],
  research: ["research-provenance", "field-research"],
  product: ["product-validation"],
  entrepreneurship: ["venture-readiness", "finance-operations"],
  design: ["design-portfolio"],
  language: ["language-communication"],
  career: ["career-evidence"]
};

function taskFormatFit(competition: Competition, profile: CompetitionScoringProfile): number | null {
  const supported = competition.recommendation.fit?.signals ?? [];
  if (supported.length === 0) return null;
  // Signals inside one answer option are alternatives (for example, software
  // can mean application engineering OR network/system work). Requiring every
  // implementation variant incorrectly rewards broad catalog metadata.
  const requestedGroups = profile.taskFormats.map((format) => taskFormatSignals[format]);
  return intentCoverageWithSpecificity(requestedGroups, supported);
}

function stageSpecificityFit(
  competition: Competition,
  profile: CompetitionScoringProfile
): number | null {
  const stages = competition.recommendation.stages;
  if (stages.state === "unknown") return null;
  if (stages.state === "unrestricted") return 0.45;
  const selected = normalizedStage(profile);
  if (!stages.values.includes(selected)) return 0;
  const breadth = new Set(stages.values).size;
  const selectedClusterSize = selected === "vocational"
    ? 1
    : selected === "master" || selected === "doctorate"
      ? 2
      : 4;
  // A rule scoped to the user's whole study-stage cluster is already highly
  // specific; single-stage tracks receive the remaining small advantage.
  return clamp(0.45 + 0.45 * Math.min(1, selectedClusterSize / breadth) + 0.1 / breadth, 0, 1);
}

function participationModeFit(competition: Competition, profile: CompetitionScoringProfile): number | null {
  const supported = competition.recommendation.participationModes;
  if (supported.includes("unknown")) return null;
  const selected = participationMode(profile);
  if (selected === "flexible") return 1;
  if (selected === "remote") return supported.includes("remote") || supported.includes("hybrid") ? 1 : 0;
  return supported.includes("offline") || supported.includes("hybrid") ? 1 : 0;
}

function catalogDataConfidence(competition: Competition): number {
  const metadata = competition.recommendation;
  const expectedFacts = new Set<OfficialEligibilityFact>([
    "identity",
    "stages",
    "teamRequirement"
  ]);
  if (metadata.eligibility) expectedFacts.add("eligibility");
  if (metadata.eligibility?.firstHigherEducationYearCutoff) {
    expectedFacts.add("firstHigherEducationYearCutoff");
  }
  if ((metadata.requiredResources?.length ?? 0) > 0) expectedFacts.add("requiredResources");
  if ((metadata.tracks?.length ?? 0) > 0) expectedFacts.add("trackEligibility");

  const sources = [
    metadata.source,
    metadata.eligibility?.source,
    metadata.eligibility?.firstHigherEducationYearCutoff?.source,
    ...(metadata.supportingSources ?? [])
  ].filter((source): source is NonNullable<typeof source> => Boolean(
    source && source.sourceType !== "unknown" && /^https:\/\//i.test(source.url)
  ));
  const evidencedFacts = new Set(sources.flatMap(({ facts }) => facts ?? []));
  const evidenceCoverage = expectedFacts.size
    ? [...expectedFacts].filter((fact) => evidencedFacts.has(fact)).length / expectedFacts.size
    : 0;
  const credibility = metadata.credibility
    ? clamp(metadata.credibility.total / 100, 0, 1)
    : 0;
  return clamp(
    credibility * 0.5 +
      metadata.dataCompleteness * 0.3 +
      evidenceCoverage * 0.2,
    0,
    1
  );
}

function weeklyCommitmentFit(competition: Competition, profile: CompetitionScoringProfile): number | null {
  const selected = weeklyCommitment(profile);
  if (!selected || !competition.recommendation.weeklyHours.length) return null;
  return Math.max(
    ...competition.recommendation.weeklyHours.map((hours) => proximity(hoursIndex[selected], hoursIndex[hours]))
  );
}

function teamStatusFit(competition: Competition, profile: CompetitionScoringProfile): number | null {
  const selected = teamStatus(profile);
  if (!selected) return null;
  const requirement = competition.recommendation.teamRequirement;
  if (requirement.state === "unknown") return null;
  if (requirement.state === "unrestricted" || requirement.mode === "either") return 1;
  if (requirement.mode === "individual") return selected === "solo" ? 1 : 0.9;
  return { solo: 0, looking: 0.55, partial: 0.8, ready: 1 }[selected];
}

function availableResourcesFit(competition: Competition, profile: CompetitionScoringProfile): number | null {
  const selected = resources(profile);
  if (selected.length === 0) return null;
  const required = competition.recommendation.requiredResources ?? [];
  const helpful = competition.recommendation.helpfulResources ?? competition.recommendation.usefulResources;
  const available = new Set<Exclude<CompetitionResource, "none">>(
    selected.filter((value): value is Exclude<CompetitionResource, "none"> => value !== "none")
  );
  if (required.length === 0 && helpful.length === 0) {
    // Only an explicit official resource fact can establish that no resource is required.
    return hasOfficialVerifiedFact(competition, "requiredResources") ? 1 : null;
  }
  if (available.size === 0) return required.length ? 0.15 : 0.55;
  const coverage = (needs: readonly CompetitionResource[]) =>
    needs.length
      ? needs.filter(
          (value): value is Exclude<CompetitionResource, "none"> =>
            value !== "none" && available.has(value)
        ).length / needs.length
      : 1;
  const requiredCoverage = coverage(required);
  const helpfulCoverage = coverage(helpful);
  return required.length
    ? clamp(0.15 + requiredCoverage * 0.7 + helpfulCoverage * 0.15, 0, 1)
    : clamp(0.65 + helpfulCoverage * 0.35, 0, 1);
}

function dynamicAnswer(
  transcript: readonly CompetitionDynamicExchangeV3[],
  signalKey: CompetitionDynamicSignalKeyV3
) {
  return transcript.find(({ question }) => question.signalKey === signalKey)?.answer.selectedValues ?? [];
}

function dynamicCompetitionFit(
  competition: Competition,
  profile: CompetitionScoringProfile,
  transcript: readonly CompetitionDynamicExchangeV3[]
): number | null {
  const selected = dynamicAnswer(transcript, "competition-fit");
  const tagged = competition.recommendation.fit?.preferenceSignals ??
    competition.recommendation.fit?.signals ?? [];
  // A vocational skills performance can produce career evidence without involving any
  // career-plan preparation. Do not treat its generic career tag as a confirmed task match.
  const supported = profile.preferredOutputs.includes("career-plan") &&
    !competition.recommendation.preferredOutputs.includes("career-plan")
    ? tagged.filter(signal => signal !== "career-evidence") : tagged;
  return selected.length && supported.length
    ? intentCoverageWithSpecificity(selected.map((value) => [value]), supported)
    : null;
}

function dynamicGoalPreference(
  transcript: readonly CompetitionDynamicExchangeV3[]
): CompetitionGoal | null {
  const selected = transcript.find(({ question }) =>
    "impact" in question && question.signalKey === "candidate-goal-tradeoff"
  )?.answer.selectedValues[0];
  return selected && Object.prototype.hasOwnProperty.call(COMPETITION_GOAL_WEIGHT_PRESETS, selected)
    ? selected as CompetitionGoal
    : null;
}

function hasOfficialVerifiedEligibility(competition: Competition) {
  const eligibility = competition.recommendation.eligibility;
  return Boolean(
    eligibility &&
    eligibility.state === "verified" &&
    isOfficialFactSource(eligibility.source, "eligibility")
  );
}

type OfficialEligibilityFact = NonNullable<
  NonNullable<Competition["recommendation"]["source"]>["facts"]
>[number];

function isOfficialFactSource(
  source: NonNullable<Competition["recommendation"]["source"]> | undefined,
  fact: OfficialEligibilityFact
) {
  return Boolean(
    source &&
    source.sourceType !== "unknown" &&
    /^https:\/\//i.test(source.url) &&
    source.evidenceRef?.trim() &&
    source.facts?.includes(fact)
  );
}

function officialFactSources(competition: Competition) {
  const metadata = competition.recommendation;
  return [
    metadata.source,
    metadata.eligibility?.source,
    metadata.eligibility?.firstHigherEducationYearCutoff?.source,
    ...(metadata.supportingSources ?? [])
  ];
}

function hasOfficialVerifiedFact(
  competition: Competition,
  fact: OfficialEligibilityFact
) {
  // Trust is fact-scoped, not inherited from the aggregate eligibility state.
  // A catalog entry may remain `partial` because some rules are unknown while
  // an official supporting source still proves its stage or team constraint.
  return officialFactSources(competition).some((source) => isOfficialFactSource(source, fact));
}

function officialVerifiedTrackSource(
  competition: Competition,
  evidenceRef: string
) {
  return officialFactSources(competition).find((source) => Boolean(
    source?.evidenceRef === evidenceRef &&
    source.sourceType !== "unknown" &&
    /^https:\/\//i.test(source.url) &&
    source.facts?.includes("trackEligibility")
  ));
}

export function hasOfficialRequiredResourcesEvidence(competition: Competition) {
  return hasOfficialVerifiedFact(competition, "requiredResources");
}

function confirmedProfileTeamSizeRange(profile: CompetitionScoringProfile): readonly [number, number] | null {
  if (
    !profile.confirmedFacts.includes("teamSize") ||
    !profile.teamSize ||
    profile.teamSize === "unsure"
  ) {
    return null;
  }
  return ({
    solo: [1, 1],
    two: [2, 2],
    three: [3, 3],
    four: [4, 4],
    five: [5, 5],
    "four-five": [4, 5],
    "over-five": [6, Number.POSITIVE_INFINITY]
  } as const)[profile.teamSize];
}

function majorRestrictionStatus(competition: Competition, profile: CompetitionScoringProfile) {
  const allowed = competition.recommendation.eligibility?.allowedMajorFields;
  if (!allowed?.length || !hasOfficialVerifiedFact(competition, "eligibility")) return null;
  if (!profile.confirmedFields.includes("majorFields") || !profile.majorFields.length) return "unknown";
  if (profile.majorFields.some(major => allowed.includes(major))) return "verify-specialty";
  // Engineering/materials and general science choices can include narrower degree programs.
  const broad = ["other", "engineering", "chemistry-materials", "biology-life-science"];
  return profile.majorFields.some(major => broad.includes(major)) ? "unknown" : "incompatible";
}

function eligibilityAssessment(
  competition: Competition,
  profile: CompetitionScoringProfile
): CompetitionEligibilityAssessment {
  const metadata = competition.recommendation.eligibility;
  if (!metadata) {
    return {
      status: "needs_clarification",
      reasons: [
        "当届官方资格仍需复核。"
      ]
    };
  }
  const unresolvedUserFacts: string[] = [];
  if (majorRestrictionStatus(competition, profile)) {
    unresolvedUserFacts.push("本赛道限制具体专业，请用本人的正式专业名称核对官方范围。");
  }
  const stageClarificationNote = metadata.stageClarificationNotes?.[normalizedStage(profile)];
  if (stageClarificationNote) {
    unresolvedUserFacts.push(stageClarificationNote);
  }
  const partTimeStageClarificationNote = profile.confirmedFacts.includes("enrollmentStatus") &&
    profile.enrollmentStatus === "part-time-student"
    ? metadata.partTimeStageClarificationNotes?.[normalizedStage(profile)]
    : undefined;
  if (partTimeStageClarificationNote) {
    unresolvedUserFacts.push(partTimeStageClarificationNote);
  }
  const higherEducationCutoff = metadata.firstHigherEducationYearCutoff;
  if (higherEducationCutoff?.state === "verified") {
    const confirmedYear = profile.confirmedFacts.includes("firstHigherEducationYear")
      ? profile.firstHigherEducationYear
      : undefined;
    if (confirmedYear === undefined) {
      unresolvedUserFacts.push(
        `首次接受高等教育年份尚未确认（当届门槛为 ${higherEducationCutoff.minimumYear} 年或之后）。`
      );
    } else if (
      confirmedYear < higherEducationCutoff.minimumYear
    ) {
      unresolvedUserFacts.push(
        higherEducationCutoff.alternativeMinimumBirthYear || higherEducationCutoff.petitionAvailable
          ? "首次高等教育年份未达直接门槛，仍需核对出生年份替代条件或申诉通道。"
          : `已确认的首次高等教育年份早于 ${higherEducationCutoff.minimumYear} 年。`
      );
    }
  }
  const requiresFullTimeForStage = metadata.requiresFullTime === true ||
    metadata.requiresFullTimeStages?.includes(normalizedStage(profile)) === true;
  if (
    requiresFullTimeForStage &&
    (!profile.confirmedFacts.includes("enrollmentStatus") ||
      profile.enrollmentStatus !== "full-time-student")
  ) {
    unresolvedUserFacts.push("全日制在读资格尚未确认。");
  }
  if (
    metadata.requiresCurrentEnrollment === true &&
    (
      !profile.confirmedFacts.includes("enrollmentStatus") ||
      profile.enrollmentStatus === undefined ||
      profile.enrollmentStatus === "other"
    )
  ) {
    unresolvedUserFacts.push("当前在校注册状态尚未确认。");
  }
  if (
    metadata.sameInstitutionTeam === true &&
    !(
      (profile.confirmedFacts.includes("teamUnit") &&
        profile.teamUnit === "same-unit")
    )
  ) {
    unresolvedUserFacts.push("同一参赛单位的组队资格尚未确认。");
  }
  const requirement = competition.recommendation.teamRequirement;
  const confirmedTeamRange = confirmedProfileTeamSizeRange(profile);
  const acceptedTeamMin = requirement.state === "known"
    ? requirement.mode === "individual"
      ? 1
      : requirement.mode === "team"
        ? requirement.minimumSizeUnknown
          ? null
          : Math.max(2, requirement.minSize ?? 2)
        : requirement.minSize ?? 1
    : null;
  const acceptedTeamMax = requirement.state === "known"
    ? requirement.mode === "individual" ? 1 : requirement.maxSize ?? Number.POSITIVE_INFINITY
    : null;
  const teamSizeSettled = confirmedTeamRange !== null &&
    acceptedTeamMin !== null &&
    acceptedTeamMax !== null &&
    confirmedTeamRange[0] >= acceptedTeamMin &&
    confirmedTeamRange[1] <= acceptedTeamMax;
  if (
    hasOfficialVerifiedFact(competition, "teamRequirement") &&
    requirement.state === "known" &&
    !teamSizeSettled
  ) {
    unresolvedUserFacts.push("参赛人数资格尚未确认。");
  }
  const blockingClarifications = metadata.blockingClarifications ?? [];
  const unresolvedCatalogFacts = [
    ...(!hasOfficialVerifiedEligibility(competition)
      ? [
        ...(competition.recommendation.stages.state === "unknown"
          ? ["适用学段尚未由当届官方规则完整结构化确认。"]
          : []),
        ...(competition.recommendation.teamRequirement.state === "unknown"
          ? ["参赛人数与组队形式尚未由当届官方规则完整结构化确认。"]
          : []),
        ...(metadata.state === "partial"
          ? ["当届仍有未结构化的报名资格事实需要按官方规则核验。"]
          : metadata.state === "unknown"
            ? ["当届官方报名资格条件尚未完整结构化确认。"]
            : ["当届官方报名资格证据尚未完整核验。"])
        ]
      : [])
  ];
  if (
    blockingClarifications.length > 0 ||
    unresolvedUserFacts.length > 0 ||
    unresolvedCatalogFacts.length > 0
  ) {
    return {
      status: "needs_clarification",
      reasons: stableUnique([
        ...unresolvedUserFacts,
        ...blockingClarifications,
        ...unresolvedCatalogFacts
      ])
    };
  }
  return { status: "eligible", reasons: [] };
}

function getCompetitionHardFilterReasonForProfile(
  competition: Competition,
  profile: CompetitionScoringProfile
): string | null {
  if (majorRestrictionStatus(competition, profile) === "incompatible") return "major-ineligible";
  const stages = competition.recommendation.stages;
  if (
    hasOfficialVerifiedFact(competition, "stages") &&
    stages.state === "known" &&
    !stages.values.includes(normalizedStage(profile))
  ) {
    return "stage-ineligible";
  }
  if (
    profile.confirmedFacts.includes("enrollmentStatus") &&
    profile.enrollmentStatus !== "full-time-student" &&
    profile.enrollmentStatus !== "other" &&
    hasOfficialVerifiedFact(competition, "eligibility") &&
    (
      competition.recommendation.eligibility?.requiresFullTime === true ||
      competition.recommendation.eligibility?.requiresFullTimeStages?.includes(
        normalizedStage(profile)
      ) === true
    )
  ) {
    return "full-time-status-ineligible";
  }
  if (
    profile.confirmedFacts.includes("enrollmentStatus") &&
    (
      profile.enrollmentStatus === "recent-graduate" ||
      profile.enrollmentStatus === "graduated"
    ) &&
    hasOfficialVerifiedFact(competition, "eligibility") &&
    competition.recommendation.eligibility?.requiresCurrentEnrollment === true
  ) {
    return "enrollment-status-ineligible";
  }
  if (
    profile.decisionContext?.unavailableResources?.length &&
    hasOfficialVerifiedFact(competition, "requiredResources") &&
    competition.recommendation.requiredResources?.some(resource => profile.decisionContext?.unavailableResources?.includes(resource))
  ) return "required-resource-unavailable";
  const higherEducationCutoff = competition.recommendation.eligibility?.firstHigherEducationYearCutoff;
  if (
    higherEducationCutoff?.state === "verified" &&
    hasOfficialVerifiedFact(competition, "firstHigherEducationYearCutoff") &&
    (
      (profile.confirmedFacts.includes("firstHigherEducationYear") &&
        profile.firstHigherEducationYear !== undefined &&
        profile.firstHigherEducationYear < higherEducationCutoff.minimumYear)
    ) &&
    higherEducationCutoff.alternativeMinimumBirthYear === undefined &&
    higherEducationCutoff.petitionAvailable !== true
  ) {
    return "first-higher-education-year-ineligible";
  }
  const teamRequirement = competition.recommendation.teamRequirement;
  const confirmedTeamUnit = profile.confirmedFacts.includes("teamUnit")
    ? profile.teamUnit
    : undefined;
  if (
    hasOfficialVerifiedFact(competition, "eligibility") &&
    competition.recommendation.eligibility?.sameInstitutionTeam &&
    profile.decisionContext?.fixedTeam && confirmedTeamUnit === "mixed-unit"
  ) {
    return "same-institution-team-ineligible";
  }
  const profileTeamRange = confirmedProfileTeamSizeRange(profile);
  if (
    hasOfficialVerifiedFact(competition, "teamRequirement") &&
    profile.decisionContext?.fixedTeam && profileTeamRange !== null &&
    teamRequirement.state === "known"
  ) {
    const [teamMin, teamMax] = profileTeamRange;
    const acceptedMin = teamRequirement.mode === "individual"
      ? 1
      : teamRequirement.mode === "team"
        ? teamRequirement.minimumSizeUnknown
          ? null
          : Math.max(2, teamRequirement.minSize ?? 2)
        : teamRequirement.minSize ?? 1;
    const acceptedMax = teamRequirement.mode === "individual"
      ? 1
      : teamRequirement.maxSize ?? Number.POSITIVE_INFINITY;
    if (
      (acceptedMin !== null && teamMax < acceptedMin) || teamMin > acceptedMax
    ) {
      return "team-size-ineligible";
    }
  }
  return eligibilityAssessment(competition, profile).status === "ineligible"
    ? "profile-eligibility-ineligible"
    : null;
}

function normalizedScore(ratios: ScoreRatios) {
  const dimensions = Object.keys(COMPETITION_SCORE_WEIGHTS) as ScoreDimension[];
  const rawContributions = Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      (ratios[dimension] ?? 0) * COMPETITION_SCORE_WEIGHTS[dimension]
    ])
  ) as CurrentScoreBreakdown;
  const breakdown = Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      round(rawContributions[dimension])
    ])
  ) as CurrentScoreBreakdown;
  // Derive the total from independently rounded dimensions so a change in
  // one field can never create a compensating 0.1-point mutation in another.
  const points = round(dimensions.reduce((sum, dimension) => sum + breakdown[dimension], 0));
  return { breakdown, points };
}

function scoreCompetitionForProfile(
  competition: Competition,
  profile: CompetitionScoringProfile,
  now = new Date(),
  transcript: readonly CompetitionDynamicExchangeV3[] = [],
  recommendedTrack: { id: string; label: string; evidenceRef?: string } | null = null,
  hardEligibilityCompetition: Competition = competition,
  additionalEligibilityReasons: readonly string[] = [],
  fixedCoreCompetition: Competition = competition,
  semanticArchetypeWeight: number = COMPETITION_SEMANTIC_ARCHETYPE_WEIGHTS.currentProfile
): ScoredCompetition | null {
  if (getCompetitionHardFilterReasonForProfile(hardEligibilityCompetition, profile)) return null;
  const metadata = competition.recommendation;
  // Negative task intent concerns essential work; broad, multi-role tags alone cannot exclude an event.
  const refused = profile.decisionContext?.excludedTaskFormats ?? [];
  if (refused.includes("laboratory") && ["chemistry-experiment-innovation", "chemical-engineering-experiment"].includes(competition.id)) return null;
  if (metadata.mandatoryTasks?.some(task => refused.includes(task))) return null;
  const signals = metadata.fit?.signals ?? [];
  // A single task prototype can identify an unavoidable work format, but a
  // multi-role team cannot be rejected from one incidental preference tag.
  if (!metadata.mandatoryTasks && signals.length === 1 && refused.some(task =>
    task !== "laboratory" && taskFormatSignals[task].includes(signals[0]!))) return null;
  const availability = deriveCompetitionAvailability(metadata.schedule, now);
  const interestRatio = overlapRatio(profile.interests, metadata.interests);
  const directSkillRatio = fixedStrengthFit(competition, profile);
  const evidenceRatio = evidenceFit(competition, profile);
  const skillsEvidenceRatio =
    directSkillRatio * (1 - COMPETITION_PROFILE_SIGNAL_WEIGHTS.evidenceWithinSkillsEvidence) +
    (evidenceRatio ?? 0) * COMPETITION_PROFILE_SIGNAL_WEIGHTS.evidenceWithinSkillsEvidence;
  const majorRatio = majorDirectionFit(competition, profile);
  const disciplineRatio = specificSubjectFit(competition, profile);
  const declaredTaskFit = taskFormatFit(competition, profile);
  const dynamicTaskFit = dynamicCompetitionFit(competition, profile, transcript);
  const declaredTaskIntent = declaredTaskFit;
  const taskWithDynamic = dynamicTaskFit === null
    ? declaredTaskIntent
    : declaredTaskIntent === null
      ? dynamicTaskFit
      : declaredTaskIntent * (1 - COMPETITION_PROFILE_SIGNAL_WEIGHTS.dynamicWithinTaskIntent) +
        dynamicTaskFit * COMPETITION_PROFILE_SIGNAL_WEIGHTS.dynamicWithinTaskIntent;
  const taskIntentRatio =
    (taskWithDynamic ?? 0) * (1 - COMPETITION_PROFILE_SIGNAL_WEIGHTS.interestWithinTaskIntent) +
    interestRatio * COMPETITION_PROFILE_SIGNAL_WEIGHTS.interestWithinTaskIntent;
  const backgroundRatio = disciplineRatio === null
    ? (majorRatio ?? 0)
    : disciplineRatio * 0.7 + (majorRatio ?? 0) * 0.3;
  const semanticSubjectTaskRatio =
    backgroundRatio * COMPETITION_PROFILE_SIGNAL_WEIGHTS.majorWithinSubjectTask +
    taskIntentRatio * (1 - COMPETITION_PROFILE_SIGNAL_WEIGHTS.majorWithinSubjectTask);
  const archetypeRatio = semanticArchetypeFit(competition, profile);
  const specializedSubjectTaskRatio = archetypeRatio === null
    ? semanticSubjectTaskRatio
    : semanticSubjectTaskRatio * (1 - semanticArchetypeWeight) +
      archetypeRatio * semanticArchetypeWeight;
  const stageSpecificity = stageSpecificityFit(competition, profile);
  const subjectTaskRatio = stageSpecificity === null
    ? specializedSubjectTaskRatio
    : specializedSubjectTaskRatio * 0.85 + stageSpecificity * 0.15;
  const selectedGoalWeights = profile.goals.map((goal) => COMPETITION_GOAL_WEIGHT_PRESETS[goal]);
  const goalWeightTotal = selectedGoalWeights.reduce((sum, weight) => sum + weight, 0);
  const fixedGoalRatio = goalWeightTotal
    ? profile.goals.reduce(
        (sum, goal, index) => sum + metadata.goalValues[goal] * selectedGoalWeights[index],
        0
      ) / goalWeightTotal
    : null;
  const originalGoalOutputRatio = blendOptional(
    fixedGoalRatio,
    preferredOutputFit(competition, profile),
    COMPETITION_PROFILE_SIGNAL_WEIGHTS.preferredOutputsWithinGoal
  );
  const priorityGoal = dynamicGoalPreference(transcript);
  const goalRatio = priorityGoal === null
    ? originalGoalOutputRatio
    : originalGoalOutputRatio === null
      ? metadata.goalValues[priorityGoal]
      : originalGoalOutputRatio * 0.75 + metadata.goalValues[priorityGoal] * 0.25;
  const starting = startingPointFit(competition, profile);
  const baseMaturityRatio = averageKnown([
    experienceDifficultyFit(competition, profile),
    starting
  ]) ?? 0;
  const maturityRatio = baseMaturityRatio;
  const currentTeamResourceSignals = [
    weeklyCommitmentFit(competition, profile),
    teamStatusFit(competition, profile),
    availableResourcesFit(competition, profile)
  ];
  const baseTeamResources = averageKnown(currentTeamResourceSignals) ?? 0;
  const teamResourcesRatio = baseTeamResources;
  const availabilityTimingRatio = participationModeFit(competition, profile);
  // Track-scoped soft fields refine that track's score, but the fixed-core
  // transfer boundary remains anchored to the mother competition selected
  // from the signed questionnaire. Otherwise choosing a content track could
  // silently reclassify every transferable dimension and break the public
  // goal-refinement formula.
  const confirmedSubjectAssessment = assessCompetitionConfirmedSubjectAlignment(
    fixedCoreCompetition,
    profile
  );
  const hasConfirmedSubjectIntent = Boolean(
    confirmedSubjectAssessment &&
    (
      confirmedSubjectAssessment.requestedPrimaryMajors.length > 0 ||
      confirmedSubjectAssessment.requestedSpecificSubjects.length > 0
    )
  );
  const fixedCoreMismatch = Boolean(
    hasConfirmedSubjectIntent &&
    profile.confirmedFields.includes("taskFormats") &&
    profile.taskFormats.length > 0 &&
    !hasCompetitionFixedCoreMatch(fixedCoreCompetition, profile)
  );
  const hasIncompleteSpecificSubjectMatch =
    confirmedSubjectAssessment.requestedSpecificSubjects.length > 0 &&
    confirmedSubjectAssessment.matchedSpecificSubjects.length <
      confirmedSubjectAssessment.requestedSpecificSubjects.length;
  const hasNoSemanticTaskPrototype = (archetypeRatio ?? 0) === 0;
  const hasOnlyWeakSemanticTaskPrototype =
    archetypeRatio !== null && archetypeRatio > 0 && archetypeRatio < 0.25;
  const isSubjectOnlyNeighbourWithoutTaskSpecificity =
    hasNoSemanticTaskPrototype &&
    ((declaredTaskFit ?? 0) === 0 || hasIncompleteSpecificSubjectMatch);
  const lacksQualityTaskSpecificity =
    metadata.qualityTaskPrototypeRequired === true &&
    (hasOnlyWeakSemanticTaskPrototype || isSubjectOnlyNeighbourWithoutTaskSpecificity);
  // A candidate outside both confirmed core routes can retain transferable
  // evidence, goals and resources, but its primary subject/task dimension
  // must remain below the approved 7.5-point quality boundary. This keeps the
  // public calibration formula exact instead of introducing a hidden fifth
  // qualification condition.
  const applicableSubjectTaskRatio = fixedCoreMismatch || lacksQualityTaskSpecificity
    ? Math.min(
        subjectTaskRatio,
        COMPETITION_CORE_MISMATCH_MAX_SUBJECT_TASK_POINTS /
          COMPETITION_SCORE_WEIGHTS.subjectTask
      )
    : subjectTaskRatio;
  // Preserve monotonic differences instead of flattening every cross-domain
  // candidate at a single total-score ceiling. Direct ability/goal evidence is
  // partially transferable; general feasibility resources transfer more
  // strongly. Each original dimension remains ordered after attenuation.
  const applicableSkillsEvidenceRatio = skillsEvidenceRatio * (
    fixedCoreMismatch ? COMPETITION_CORE_MISMATCH_TRANSFER_RATIOS.skillsEvidence : 1
  );
  const applicableGoalRatio = goalRatio === null
    ? null
    : goalRatio * (
        fixedCoreMismatch ? COMPETITION_CORE_MISMATCH_TRANSFER_RATIOS.goalsOutputs : 1
      );
  const applicableTeamResourcesRatio = teamResourcesRatio * (
    fixedCoreMismatch ? COMPETITION_CORE_MISMATCH_TRANSFER_RATIOS.teamResources : 1
  );
  const known = (field: CompetitionRecommendationProfileV5["confirmedFields"][number]) => profile.confirmedFields.includes(field);
  const task = averageKnown([
    (known("taskFormats") && profile.taskFormats.length) || dynamicTaskFit !== null ? taskWithDynamic : null,
    known("interests") && profile.interests.length ? interestRatio : null,
    known("specificSubjects") && profile.specificSubjects.length ? disciplineRatio : null,
    known("majorFields") && profile.majorFields.some(value => value !== "other") ? majorRatio : null,
    known("taskFormats") || known("specificSubjects") || known("majorFields") ? archetypeRatio : null
  ]);
  // The follow-up explicitly resolves a tradeoff that broad skills and interests could not.
  // Its confirmed task is a stronger signal than a general language or engineering tag.
  const confirmedTask = dynamicTaskFit === null ? task : 0.75 * dynamicTaskFit + 0.25 * (task ?? dynamicTaskFit);
  const businessActivity = profile.decisionContext?.businessActivity;
  const seriesActivities = getSeriesBusinessActivities(competition.id);
  // An explicit fine-grained task can distinguish events with the same broad finance labels.
  const refinedTask = businessActivity && seriesActivities
    ? 0.7 * Number(seriesActivities.includes(businessActivity)) + 0.3 * (confirmedTask ?? 0)
    : confirmedTask;
  const role = profile.decisionContext?.experienceRole;
  const experience = averageKnown([
    known("skills") && profile.skills.length ? directSkillRatio : null,
    known("evidence") ? evidenceRatio : null,
    known("experienceLevel") ? experienceDifficultyFit(competition, profile) : null
  ]);
  const fitPolicy = assessDecisionFit(competition, profile, {
    goal: priorityGoal ?? profile.decisionContext?.primaryGoal ?? profile.goals[0],
    task: refinedTask, experience: experience === null ? null : experience * (role === "observed" ? 0.55 : role === "assisted" ? 0.8 : 1),
    readiness: averageKnown([known("weeklyCommitment") ? weeklyCommitmentFit(competition, profile) : null,
      known("teamStatus") ? teamStatusFit(competition, profile) : null,
      known("availableResources") ? availableResourcesFit(competition, {...profile, availableResources: [...new Set([...profile.availableResources, ...(profile.decisionContext?.obtainableResources ?? [])])]}) : null,
      known("participationMode") ? availabilityTimingRatio : null]),
    growth: known("preferredOutputs") && profile.preferredOutputs.length ? preferredOutputFit(competition, profile) : null,
    trackLabel: recommendedTrack?.label
  });
  const currentPolicy = semanticArchetypeWeight === COMPETITION_SEMANTIC_ARCHETYPE_WEIGHTS.currentProfile;
  const normalized = currentPolicy
    ? { points: fitPolicy.lower, breakdown: {
        subjectTask: fitPolicy.dimensions.task, skillsEvidence: fitPolicy.dimensions.experience,
        goalsOutputs: fitPolicy.dimensions.goal, maturity: fitPolicy.dimensions.growth,
        teamResources: fitPolicy.dimensions.readiness, availabilityTiming: 0, dataConfidence: 0
      }}
    : normalizedScore({subjectTask: applicableSubjectTaskRatio, skillsEvidence: applicableSkillsEvidenceRatio,
        goalsOutputs: applicableGoalRatio, maturity: maturityRatio, teamResources: applicableTeamResourcesRatio,
        availabilityTiming: availabilityTimingRatio, dataConfidence: catalogDataConfidence(competition)});
  const baseEligibility = eligibilityAssessment(hardEligibilityCompetition, profile);
  const combinedEligibilityReasons = stableUnique([
    ...baseEligibility.reasons,
    ...additionalEligibilityReasons
  ]);
  const eligibility: CompetitionEligibilityAssessment = combinedEligibilityReasons.length > 0
    ? { status: "needs_clarification", reasons: combinedEligibilityReasons }
    : baseEligibility;
  const notices = [...metadata.dataNotices];
  if (availability.registrationStatus.note && !notices.includes(availability.registrationStatus.note)) {
    notices.push(availability.registrationStatus.note);
  }

  const baseMatchScore = round(clamp(normalized.points, 0, 100));
  const available = new Set([...resources(profile), ...(profile.decisionContext?.obtainableResources ?? [])]);
  const resourceGaps = (metadata.requiredResources ?? []).filter((resource) => !available.has(resource));
  const matchedSignals = [
    ...profileSkills(profile).filter((skill) => metadata.skills.includes(skill)),
    ...dynamicAnswer(transcript, "competition-fit").filter((signal) => metadata.fit?.signals.includes(signal as never))
  ];
  const fit: CompetitionFitAssessment = {
    score: baseMatchScore,
    matchedSignals: [...new Set(matchedSignals)].slice(0, 6),
    gaps: [
      ...(fixedCoreMismatch ? ["固定主学科与任务原型均未命中，跨领域能力按可迁移比例计分。"] : []),
      ...resourceGaps.map((resource) => `准备条件待核对：${({mentor:"指导老师",lab:"实验室",equipment:"设备",data:"数据",budget:"预算","school-registration":"校内报名","safety-compliance":"安全保障",none:"资源"} as const)[resource]}`),
      ...(eligibility.status === "needs_clarification" ? eligibility.reasons.slice(0, 2) : []),
      ...additionalEligibilityReasons
    ].slice(0, 4)
  };

  return {
    competition,
    ...(currentPolicy ? { decisionFit: fitPolicy } : {}),
    recommendedTrack,
    baseMatchScore,
    scoreBreakdown: {
      ...normalized.breakdown,
      interest: normalized.breakdown.subjectTask,
      background: normalized.breakdown.skillsEvidence,
      goal: normalized.breakdown.goalsOutputs,
      difficulty: normalized.breakdown.maturity,
      access: normalized.breakdown.availabilityTiming,
      feasibility: normalized.breakdown.teamResources,
      completenessPenalty: 0
    },
    availability,
    eligibility,
    fit,
    dataNotices: notices
  };
}

type CompetitionTrack = NonNullable<Competition["recommendation"]["tracks"]>[number];

function trackScopedCompetitions(competition: Competition, track: CompetitionTrack) {
  const metadata = competition.recommendation;
  const trackFacts = new Set(track.verifiedFacts ?? []);
  const trackEvidenceSource = track.evidenceRef
    ? officialVerifiedTrackSource(competition, track.evidenceRef)
    : undefined;
  const trackStagesOfficial = Boolean(trackEvidenceSource && trackFacts.has("stages"));
  const trackTeamRequirementOfficial = Boolean(
    trackEvidenceSource && trackFacts.has("teamRequirement")
  );
  const trackEligibilityOfficial = Boolean(
    trackEvidenceSource && trackFacts.has("eligibility")
  );
  const hardTrackFactSource = trackEvidenceSource &&
    (trackStagesOfficial || trackTeamRequirementOfficial || trackEligibilityOfficial)
    ? {
        ...trackEvidenceSource,
        facts: [
          ...(trackEvidenceSource.facts ?? []),
          ...(trackStagesOfficial ? (["stages"] as const) : []),
          ...(trackTeamRequirementOfficial ? (["teamRequirement"] as const) : []),
          ...(trackEligibilityOfficial ? (["eligibility"] as const) : [])
        ]
      }
    : undefined;
  const scoring: Competition = {
    ...competition,
    recommendation: {
      ...metadata,
      stages: track.stages ?? metadata.stages,
      teamRequirement: track.teamRequirement ?? metadata.teamRequirement,
      mandatoryTasks: track.mandatoryTasks ?? metadata.mandatoryTasks,
      subjects: track.subjects ?? metadata.subjects,
      skills: track.skills ?? metadata.skills,
      skillEvidenceSignals: track.skills ?? metadata.skillEvidenceSignals,
      interests: track.interests ?? metadata.interests,
      preferredOutputs: track.preferredOutputs ?? metadata.preferredOutputs,
      fit: {
        ...metadata.fit,
        preferenceSignals: track.preferenceFitSignals ??
          track.fitSignals ??
          metadata.fit?.preferenceSignals ??
          metadata.fit?.signals ??
          [],
        signals: track.fitSignals ?? metadata.fit?.signals ?? []
      },
      tracks: [track]
    }
  };
  const hardEligibility: Competition = {
    ...competition,
    recommendation: {
      ...metadata,
      stages: trackStagesOfficial && track.stages ? track.stages : metadata.stages,
      teamRequirement: trackTeamRequirementOfficial && track.teamRequirement
        ? track.teamRequirement
        : metadata.teamRequirement,
      ...(trackEligibilityOfficial && hardTrackFactSource
        ? {
            eligibility: {
              ...(metadata.eligibility ?? {}),
              state: "verified" as const,
              ...(track.requiresFullTime !== undefined
                ? { requiresFullTime: track.requiresFullTime }
                : {}),
              ...(track.requiresCurrentEnrollment !== undefined
                ? { requiresCurrentEnrollment: track.requiresCurrentEnrollment }
                : {}),
              ...(track.sameInstitutionTeam !== undefined
                ? { sameInstitutionTeam: track.sameInstitutionTeam }
                : {}),
              notes: track.eligibilityNotes ?? [],
              source: hardTrackFactSource
            }
          }
        : {}),
      ...(hardTrackFactSource
        ? {
            supportingSources: [
              ...(metadata.supportingSources ?? []),
              hardTrackFactSource
            ]
          }
        : {})
    }
  };
  return { scoring, hardEligibility };
}

function stableUnique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

const QUALIFICATION_SOURCE_FACTS = new Set<OfficialEligibilityFact>([
  "stages",
  "teamRequirement",
  "eligibility",
  "firstHigherEducationYearCutoff",
  "requiredResources",
  "trackEligibility"
]);

function officialQualificationSourceRefs(competition: Competition) {
  return stableUnique(officialFactSources(competition).flatMap((source) =>
    source &&
    source.sourceType !== "unknown" &&
    /^https:\/\//i.test(source.url) &&
    source.evidenceRef?.trim() &&
    source.facts?.some((fact) =>
      QUALIFICATION_SOURCE_FACTS.has(fact)
    )
      ? [source.evidenceRef]
      : []
  ));
}

function qualificationForCompetition(
  competition: Competition,
  profile: CompetitionScoringProfile,
  additionalReasons: readonly string[] = []
) {
  const hardFilterReason = getCompetitionHardFilterReasonForProfile(competition, profile);
  const assessed = eligibilityAssessment(competition, profile);
  const reasons = stableUnique([
    ...(hardFilterReason ? [hardFilterReason] : assessed.reasons),
    ...additionalReasons
  ]);
  return {
    status: hardFilterReason
      ? "ineligible" as const
      : reasons.length > 0
        ? "needs_clarification" as const
        : assessed.status,
    reasons,
    hardFilterReason,
    sourceRefs: officialQualificationSourceRefs(competition)
  };
}

/**
 * Freeze official eligibility before preference follow-ups begin. This helper
 * deliberately has no transcript parameter, so a preference answer cannot
 * upgrade, downgrade, or otherwise rewrite an eligibility fact.
 */
function buildCompetitionQualificationSnapshotForProfile(
  profile: CompetitionScoringProfile,
  catalog: readonly Competition[] = getCompetitionCatalog(),
  _now = new Date()
): CompetitionQualificationSnapshotV1 {
  const entries = catalog.map((competition) => {
    const base = qualificationForCompetition(competition, profile);
    const tracks = (competition.recommendation.tracks ?? []).map((track) => {
      const { hardEligibility } = trackScopedCompetitions(competition, track);
      return {
        trackId: track.id,
        ...qualificationForCompetition(
          hardEligibility,
          profile,
          track.blockingClarifications ?? []
        )
      };
    }).sort((left, right) => left.trackId < right.trackId ? -1 : left.trackId > right.trackId ? 1 : 0);
    const aggregate = (() => {
      if (tracks.length === 0) return base;
      const eligibleTracks = tracks.filter(({ status }) => status === "eligible");
      if (eligibleTracks.length > 0) {
        return {
          status: "eligible" as const,
          reasons: [],
          hardFilterReason: null,
          sourceRefs: stableUnique([
            ...base.sourceRefs,
            ...eligibleTracks.flatMap(({ sourceRefs }) => sourceRefs)
          ])
        };
      }
      const unresolvedTracks = tracks.filter(({ status }) => status === "needs_clarification");
      if (unresolvedTracks.length > 0) {
        return {
          status: "needs_clarification" as const,
          reasons: stableUnique(unresolvedTracks.flatMap(({ reasons }) => reasons)),
          hardFilterReason: null,
          sourceRefs: stableUnique([
            ...base.sourceRefs,
            ...unresolvedTracks.flatMap(({ sourceRefs }) => sourceRefs)
          ])
        };
      }
      const trackHardReasons = stableUnique(tracks.flatMap(({ hardFilterReason }) =>
        hardFilterReason ? [hardFilterReason] : []
      ));
      return {
        status: "ineligible" as const,
        reasons: stableUnique(tracks.flatMap(({ reasons }) => reasons)),
        hardFilterReason: trackHardReasons.length === 1
          ? trackHardReasons[0]!
          : "all-tracks-ineligible",
        sourceRefs: stableUnique([
          ...base.sourceRefs,
          ...tracks.flatMap(({ sourceRefs }) => sourceRefs)
        ])
      };
    })();
    return {
      competitionId: competition.id,
      ...aggregate,
      tracks
    };
  }).sort((left, right) => left.competitionId < right.competitionId ? -1 : left.competitionId > right.competitionId ? 1 : 0);
  return {
    version: "competition-qualification-snapshot.v1",
    catalogVersion: COMPETITION_CATALOG_VERSION,
    scorerVersion: COMPETITION_SCORER_VERSION,
    entries
  };
}

function scoreCompetitionRecommendationsForProfile(
  competitions: readonly Competition[],
  profile: CompetitionScoringProfile,
  options: { now?: Date; transcript?: readonly CompetitionDynamicExchangeV3[] } = {},
  semanticArchetypeWeight: number = COMPETITION_SEMANTIC_ARCHETYPE_WEIGHTS.currentProfile
): ScoredCompetition[] {
  type ScoringUnit = {
    original: Competition;
    scoring: Competition;
    hardEligibility: Competition;
    track: { id: string; label: string; evidenceRef?: string } | null;
    additionalEligibilityReasons: readonly string[];
  };
  const scoringUnits = competitions.flatMap<ScoringUnit>((competition) => {
    const tracks = competition.recommendation.tracks ?? [];
    if (tracks.length === 0) {
      return [{
        original: competition,
        scoring: competition,
        hardEligibility: competition,
        track: null,
        additionalEligibilityReasons: []
      }];
    }
    const selectedTrackId = dynamicAnswer(options.transcript ?? [], `track:${competition.id}`)[0];
    // A signed track answer must resolve to that exact catalog track. Falling
    // back to every track would silently reinterpret an injected or stale ID.
    const tracksToScore = selectedTrackId
      ? tracks.filter(({ id }) => id === selectedTrackId)
      : tracks;
    return tracksToScore.map((track) => {
      const { scoring, hardEligibility } = trackScopedCompetitions(competition, track);
      return {
        original: competition,
        scoring,
        hardEligibility,
        track: {
          id: track.id,
          label: track.label,
          ...(track.evidenceRef ? { evidenceRef: track.evidenceRef } : {})
        },
        additionalEligibilityReasons: track.blockingClarifications ?? []
      };
    });
  });
  const sorted = scoringUnits
    .map(({ original, scoring, hardEligibility, track, additionalEligibilityReasons }) => {
      const scored = scoreCompetitionForProfile(
        scoring,
        profile,
        options.now,
        options.transcript,
        track,
        hardEligibility,
        additionalEligibilityReasons,
        original,
        semanticArchetypeWeight
      );
      return scored ? { ...scored, competition: original } : null;
    })
    .filter((competition): competition is ScoredCompetition => competition !== null)
    .sort(
      (left, right) =>
        right.baseMatchScore - left.baseMatchScore ||
        left.competition.id.localeCompare(right.competition.id) ||
        (left.recommendedTrack?.id ?? "").localeCompare(right.recommendedTrack?.id ?? "")
    );
  if (semanticArchetypeWeight === COMPETITION_SEMANTIC_ARCHETYPE_WEIGHTS.currentProfile) {
    const pending = [...sorted];
    sorted.length = 0;
    while (pending.length) {
      const maxLower = Math.max(...pending.map(item => item.decisionFit!.lower));
      const comparable = pending.filter(item => item.decisionFit!.upper >= maxLower);
      const group = new Set(comparable);
      comparable.sort((left, right) => Number(right.decisionFit!.actionable) - Number(left.decisionFit!.actionable) ||
        right.decisionFit!.lower - left.decisionFit!.lower ||
        right.decisionFit!.dimensions.task - left.decisionFit!.dimensions.task ||
        right.decisionFit!.dimensions.experience - left.decisionFit!.dimensions.experience ||
        left.competition.id.localeCompare(right.competition.id) ||
        (left.recommendedTrack?.id ?? "").localeCompare(right.recommendedTrack?.id ?? ""));
      sorted.push(...comparable);
      for (let i = pending.length - 1; i >= 0; i--) if (group.has(pending[i]!)) pending.splice(i, 1);
    }
  }
  const seen = new Set<string>();
  return sorted.filter(({ competition }) => {
    if (seen.has(competition.id)) return false;
    seen.add(competition.id);
    return true;
  });
}

/** Current scorer boundary: only the signed fourteen-question V5 profile is accepted. */
export function getHardFilterReason(
  competition: Competition,
  profile: CompetitionRecommendationProfileV5
) {
  return getCompetitionHardFilterReasonForProfile(competition, profile);
}

/** Current scorer boundary: eligibility inputs cannot be supplied by callers. */
export function scoreCompetition(
  competition: Competition,
  profile: CompetitionRecommendationProfileV5,
  now = new Date(),
  transcript: readonly CompetitionDynamicExchangeV3[] = []
) {
  return scoreCompetitionForProfile(competition, profile, now, transcript);
}

/** Compatibility-only scorer used after an old profile is projected to V5. */
export function scoreCompetitionWithCompatibilityPolicy(
  competition: Competition,
  profile: CompetitionRecommendationProfileV5,
  now = new Date(),
  transcript: readonly CompetitionDynamicExchangeV3[] = []
) {
  return scoreCompetitionForProfile(
    competition,
    profile,
    now,
    transcript,
    null,
    competition,
    [],
    competition,
    COMPETITION_SEMANTIC_ARCHETYPE_WEIGHTS.legacyCompatibility
  );
}

export function buildCompetitionQualificationSnapshot(
  profile: CompetitionRecommendationProfileV5,
  catalog: readonly Competition[] = getCompetitionCatalog(),
  now = new Date()
) {
  return buildCompetitionQualificationSnapshotForProfile(profile, catalog, now);
}

export function scoreCompetitionRecommendations(
  competitions: readonly Competition[],
  profile: CompetitionRecommendationProfileV5,
  options: { now?: Date; transcript?: readonly CompetitionDynamicExchangeV3[] } = {}
) {
  return scoreCompetitionRecommendationsForProfile(competitions, profile, options);
}

/** Compatibility-only list scorer; production V5 callers cannot choose this policy. */
export function scoreCompetitionRecommendationsWithCompatibilityPolicy(
  competitions: readonly Competition[],
  profile: CompetitionRecommendationProfileV5,
  options: { now?: Date; transcript?: readonly CompetitionDynamicExchangeV3[] } = {}
) {
  return scoreCompetitionRecommendationsForProfile(
    competitions,
    profile,
    options,
    COMPETITION_SEMANTIC_ARCHETYPE_WEIGHTS.legacyCompatibility
  );
}

/** Preserve match-first ordering; availability only breaks equal-score ties upstream. */
export function selectCompetitionRecommendations(scored: readonly ScoredCompetition[]): ScoredCompetition[] {
  return scored.slice(0, 3);
}

export function recommendationRole(item: ScoredCompetition, rank: number): CompetitionRecommendationRole {
  if (rank === 1) return "best-match";
  if (item.competition.recommendation.difficulty === "challenge") return "stretch";
  if (item.competition.recommendation.goalValues.portfolio >= 0.8) return "portfolio";
  return "practical";
}
