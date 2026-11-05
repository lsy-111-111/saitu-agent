import type { Competition } from "@/content/competitions";
import { getCompetitionCatalog } from "./catalog";
import type {
  CompetitionDynamicExchangeV2,
  CompetitionDynamicExchangeV3,
  CompetitionMajorField,
  CompetitionRecommendationProfileV2,
  CompetitionRecommendationProfileV3,
  CompetitionRecommendationProfileV4,
  CompetitionRecommendationProfileV5,
  CompetitionSkill,
  CompetitionStrengthArea,
  CompetitionTaskFormat
} from "@/types/competition-recommendation";
import {
  getCompetitionRecommendationCandidatesWithCompatibilityPolicy,
  recommendCompetitionsWithCompatibilityPolicy,
  selectCompetitionRecommendationRecall,
  selectFinalQualityRecommendations,
  type CompetitionFinalQualityCandidate
} from "./recommendation-engine";
import { projectLegacyCompetitionPreferenceTranscript } from "./legacy-preference-adapter";
import {
  buildCompetitionQualificationSnapshot,
  getHardFilterReason,
  scoreCompetitionWithCompatibilityPolicy,
  scoreCompetitionRecommendationsWithCompatibilityPolicy,
  type ScoredCompetition
} from "./scoring";

export type LegacyCompetitionScoringProfile =
  | CompetitionRecommendationProfileV4
  | CompetitionRecommendationProfileV3
  | CompetitionRecommendationProfileV2;

export type LegacyCompetitionPreferenceTranscript = readonly (
  | CompetitionDynamicExchangeV2
  | CompetitionDynamicExchangeV3
)[];

function isSafePreferenceSignal(signalKey: string) {
  return signalKey === "competition-fit" ||
    signalKey === "candidate-goal-tradeoff" ||
    /^track:[a-z0-9-]+$/.test(signalKey);
}

/**
 * Project historical memory to the current preference-only transcript.
 * Removed eligibility/team families, notes and values outside the signed
 * option whitelist are discarded before the legacy calculation is invoked.
 */
export function sanitizeLegacyCompetitionScoringTranscript(
  transcript: LegacyCompetitionPreferenceTranscript = []
): CompetitionDynamicExchangeV3[] {
  const legacyV2 = transcript.filter((exchange): exchange is CompetitionDynamicExchangeV2 =>
    !("impact" in exchange.question)
  );
  const projected = projectLegacyCompetitionPreferenceTranscript(legacyV2);
  const currentV3 = transcript.flatMap((exchange) => {
    if (!("impact" in exchange.question) || !isSafePreferenceSignal(exchange.question.signalKey)) {
      return [];
    }
    const allowed = new Set(exchange.question.options.map(({ value }) => value));
    const selectedValues = [...new Set(
      exchange.answer.selectedValues.filter((value) => allowed.has(value))
    )];
    if (selectedValues.length === 0) return [];
    return [{
      question: exchange.question,
      answer: { selectedValues }
    } satisfies CompetitionDynamicExchangeV3];
  });
  const seen = new Set<string>();
  return [...projected, ...currentV3].filter(({ question }) => {
    if (seen.has(question.signalKey)) return false;
    seen.add(question.signalKey);
    return true;
  });
}

const strengthAreaSignals: Readonly<Record<
  CompetitionStrengthArea,
  { majors: readonly CompetitionMajorField[]; skills: readonly CompetitionSkill[] }
>> = {
  "technology-engineering": {
    majors: ["computer-science", "engineering", "mathematics"],
    skills: ["programming", "data-analysis", "hardware"]
  },
  "research-analysis": {
    majors: ["medicine", "mathematics", "humanities", "computer-science"],
    skills: ["research", "data-analysis"]
  },
  "product-design": {
    majors: ["design", "engineering"],
    skills: ["product", "design"]
  },
  "business-operations": {
    majors: ["business", "humanities"],
    skills: ["product", "data-analysis", "writing"]
  },
  "material-expression": {
    majors: ["humanities", "design", "business"],
    skills: ["writing", "presentation", "design"]
  }
};

const preferenceTaskFormats: Readonly<Record<string, CompetitionTaskFormat>> = {
  "algorithm-competition": "algorithm",
  "modeling-intensive": "modeling",
  "hardware-build": "hardware",
  "robotics-integration": "hardware",
  "software-engineering": "software",
  "network-systems": "software",
  "field-research": "research",
  "research-provenance": "research",
  "product-validation": "product",
  "venture-readiness": "entrepreneurship",
  "finance-operations": "entrepreneurship",
  "design-portfolio": "design",
  "sustainability-impact": "research",
  "language-communication": "language",
  "career-evidence": "career"
};

function legacyClarificationValues(
  profile: CompetitionRecommendationProfileV2,
  questionId: string
) {
  return profile.clarifications?.[questionId]?.selectedValues ?? [];
}

function inferredLegacyTaskFormats(
  profile: LegacyCompetitionScoringProfile,
  transcript: readonly CompetitionDynamicExchangeV3[]
) {
  const explicit = transcript
    .filter(({ question }) => question.signalKey === "competition-fit")
    .flatMap(({ answer }) => answer.selectedValues)
    .flatMap((signal) => preferenceTaskFormats[signal] ? [preferenceTaskFormats[signal]] : []);
  // The former V4 follow-up was the user's explicit task choice and replaced
  // the broad inferred intent. Preserve that historical meaning inside the
  // adapter without changing the V5 production weighting.
  if (explicit.length > 0) return [...new Set(explicit)];
  const inferred: CompetitionTaskFormat[] = [];
  const skills = "skills" in profile ? profile.skills : [];
  const outputs = "preferredOutputs" in profile ? profile.preferredOutputs : [];
  const interests = new Set(profile.interests);
  if (skills.includes("programming") && outputs.includes("software")) inferred.push("software");
  if (skills.includes("hardware") && outputs.includes("prototype")) inferred.push("hardware");
  if (skills.includes("research") && outputs.includes("research-paper")) inferred.push("research");
  if (skills.includes("design") && outputs.includes("creative-work")) inferred.push("design");
  if (skills.includes("product") && outputs.includes("business-plan")) inferred.push("product", "entrepreneurship");
  if (interests.has("career")) inferred.push("career");
  if (interests.has("language-communication")) inferred.push("language");
  return [...new Set(inferred)];
}

/**
 * Physical legacy boundary: old profile fields are resolved here and projected
 * to a preference-only V5 calculation input. No legacy qualification answer
 * or team answer is represented in the resulting signed-profile shape.
 */
export function normalizeLegacyCompetitionScoringProfile(
  profile: LegacyCompetitionScoringProfile,
  transcript: readonly CompetitionDynamicExchangeV3[] = []
): CompetitionRecommendationProfileV5 {
  const isV4 = profile.profileVersion === "competition-profile.v4";
  const isV3 = profile.profileVersion === "competition-profile.v3" && "majorFields" in profile;
  const coarse = profile as CompetitionRecommendationProfileV2;
  const strengthAreas = "strengthAreas" in profile ? profile.strengthAreas : [];
  const derivedMajors = strengthAreas.flatMap((area) => strengthAreaSignals[area].majors);
  const derivedSkills = strengthAreas.flatMap((area) => strengthAreaSignals[area].skills);
  const majorFields = isV4 || isV3
    ? profile.majorFields
    : legacyClarificationValues(coarse, "major_direction") as CompetitionMajorField[];
  const preferredOutputs = isV4 || isV3
    ? profile.preferredOutputs
    : legacyClarificationValues(coarse, "preferred_output") as CompetitionRecommendationProfileV5["preferredOutputs"];
  const startingPoint = isV4 || isV3
    ? profile.startingPoint
    : (legacyClarificationValues(coarse, "starting_point")[0] ?? "idea_only") as CompetitionRecommendationProfileV5["startingPoint"];
  const weeklyCommitment = isV4 || isV3
    ? profile.weeklyCommitment
    : (legacyClarificationValues(coarse, "weekly_commitment")[0] ??
      (coarse.constraints.includes("time") ? "under-5" : "5-10")) as CompetitionRecommendationProfileV5["weeklyCommitment"];
  const teamStatus = isV4 || isV3
    ? profile.teamStatus
    : (legacyClarificationValues(coarse, "team_status")[0] ??
      (coarse.constraints.includes("team") ? "solo" : "looking")) as CompetitionRecommendationProfileV5["teamStatus"];
  const availableResources = isV4 || isV3
    ? profile.availableResources
    : (legacyClarificationValues(coarse, "available_resources") as CompetitionRecommendationProfileV5["availableResources"]);
  const participationMode = isV4 || isV3
    ? profile.participationMode
    : (legacyClarificationValues(coarse, "participation_mode")[0] ?? "flexible") as CompetitionRecommendationProfileV5["participationMode"];
  const normalizedBase = {
    profileVersion: "competition-profile.v5" as const,
    questionnaireVersion: "competition-questionnaire.v1" as const,
    // Deliberately omit eligibility facts, specific subjects, taskFormats and
    // resources from the confirmed set. Compatibility data can rank but can
    // never become new official hard-filter evidence.
    confirmedFields: [
      "stage",
      "majorFields",
      "skills",
      "interests",
      "goals",
      "preferredOutputs",
      "startingPoint",
      "experienceLevel",
      "weeklyCommitment",
      "teamStatus",
      "participationTiming",
      "participationMode",
      "evidence"
    ] as CompetitionRecommendationProfileV5["confirmedFields"],
    confirmedFacts: [],
    stage: profile.stage === "postgraduate" ? "master" as const : profile.stage,
    majorFields: [...new Set(majorFields.length ? majorFields : derivedMajors.length ? derivedMajors : ["other" as const])],
    specificSubjects: [],
    skills: isV4 ? profile.skills : [...new Set(derivedSkills)],
    interests: [...profile.interests],
    goals: [...profile.goals],
    preferredOutputs: [...preferredOutputs],
    startingPoint,
    experienceLevel: isV4 ? profile.experienceLevel : "none" as const,
    weeklyCommitment,
    participationTiming: "flexible" as const,
    teamStatus,
    availableResources: availableResources.length ? [...availableResources] : ["none" as const],
    participationMode,
    taskFormats: inferredLegacyTaskFormats(profile, transcript),
    evidence: isV4 ? [...profile.evidence] : ["none" as const]
  } satisfies CompetitionRecommendationProfileV5;
  return normalizedBase;
}

export function getLegacyCompetitionHardFilterReason(
  competition: Competition,
  profile: LegacyCompetitionScoringProfile
) {
  return getHardFilterReason(
    competition,
    normalizeLegacyCompetitionScoringProfile(profile)
  );
}

export function scoreLegacyCompetition(
  competition: Competition,
  profile: LegacyCompetitionScoringProfile,
  now = new Date(),
  transcript: LegacyCompetitionPreferenceTranscript = []
) {
  const safeTranscript = sanitizeLegacyCompetitionScoringTranscript(transcript);
  const scored = scoreCompetitionWithCompatibilityPolicy(
    competition,
    normalizeLegacyCompetitionScoringProfile(profile, safeTranscript),
    now,
    safeTranscript
  );
  if (!scored) return null;

  // The former scorer gave an explicit, signed ability choice two additional
  // comparator points. Preserve that historical score meaning only inside the
  // compatibility adapter; current V5 scoring keeps the approved seven
  // dimensions and preference weights unchanged.
  const requestedFitSignals = safeTranscript
    .filter(({ question }) => question.signalKey === "competition-fit")
    .flatMap(({ answer }) => answer.selectedValues);
  const recommendedTrack = scored.recommendedTrack
    ? competition.recommendation.tracks?.find(({ id }) => id === scored.recommendedTrack?.id)
    : undefined;
  const supportedFitSignals = new Set<string>(
    recommendedTrack?.fitSignals ?? competition.recommendation.fit?.signals ?? []
  );
  const hasExplicitFit = requestedFitSignals.some((signal) => supportedFitSignals.has(signal));
  const subjectTask = scored.scoreBreakdown.subjectTask ?? 0;
  const compatibilityDelta = hasExplicitFit
    ? Math.max(0, Math.min(2, 25 - subjectTask, 100 - scored.baseMatchScore))
    : 0;
  if (compatibilityDelta === 0) return scored;
  const adjustedBaseMatchScore = Math.round(
    (scored.baseMatchScore + compatibilityDelta + Number.EPSILON) * 10
  ) / 10;
  const adjustedSubjectTask = Math.round(
    (subjectTask + compatibilityDelta + Number.EPSILON) * 10
  ) / 10;
  return {
    ...scored,
    baseMatchScore: adjustedBaseMatchScore,
    scoreBreakdown: {
      ...scored.scoreBreakdown,
      subjectTask: adjustedSubjectTask,
      interest: adjustedSubjectTask
    },
    fit: {
      ...scored.fit,
      score: adjustedBaseMatchScore
    }
  };
}

function hasEvery<T>(values: readonly T[], required: readonly T[]) {
  const available = new Set(values);
  return required.every((value) => available.has(value));
}

/**
 * Recreate the former compound-intent comparator from structured, catalog
 * evidence. This remains deliberately isolated from production V5 ranking:
 * it lets persisted V4 profiles retain their historical nearby-event meaning
 * without reintroducing old profile branches into the current scorer.
 */
function legacyCompoundIntentBonus(
  profile: CompetitionRecommendationProfileV5,
  competition: Competition,
  requestedFitSignals: readonly string[]
) {
  const metadata = competition.recommendation;
  const identityText = [
    competition.name,
    competition.category,
    competition.direction
  ].join(" ");
  const descriptiveText = `${identityText} ${competition.summary}`;
  const fitSignals = new Set<string>([
    ...(metadata.fit?.signals ?? []),
    ...(metadata.tracks ?? []).flatMap(({ fitSignals: trackSignals }) => trackSignals ?? [])
  ]);
  const subjects = new Set(metadata.subjects ?? []);

  const electronicSystemBuild =
    profile.majorFields.includes("engineering") &&
    hasEvery(profile.skills, ["hardware", "programming"] as const) &&
    profile.preferredOutputs.includes("prototype") &&
    requestedFitSignals.includes("hardware-build");
  if (
    electronicSystemBuild &&
    fitSignals.has("hardware-build") &&
    /(?:电子设计|芯片|嵌入式|集成电路|物联网|IoT)/i.test(identityText)
  ) {
    const graduateSpecific =
      (profile.stage === "master" || profile.stage === "doctorate") &&
      /(?:研究生|硕士|博士)/.test(identityText);
    return graduateSpecific ? 22 : 14;
  }

  const humanitiesOriginalResearch =
    profile.majorFields.includes("humanities") &&
    hasEvery(profile.skills, ["research", "writing"] as const) &&
    profile.interests.includes("academic-research") &&
    profile.preferredOutputs.includes("research-paper") &&
    requestedFitSignals.includes("research-provenance");
  if (
    humanitiesOriginalResearch &&
    /(?:挑战杯.*学术|课外学术科技|市场调查|市场研究|能源经济学术)/.test(descriptiveText)
  ) {
    return /(?:挑战杯.*学术|课外学术科技)/.test(descriptiveText) ? 22 : 18;
  }

  const languagePerformance =
    profile.majorFields.includes("humanities") &&
    profile.interests.includes("language-communication") &&
    profile.skills.includes("presentation") &&
    profile.preferredOutputs.includes("presentation") &&
    requestedFitSignals.includes("language-communication");
  if (
    languagePerformance &&
    fitSignals.has("language-communication") &&
    /(?:文化中国|中华经典|英语演讲|21世纪)/.test(identityText)
  ) {
    return /(?:研究生|硕士|博士)/.test(identityText) ? 22 : 14;
  }

  const designProduction =
    profile.majorFields.includes("design") &&
    profile.skills.includes("design") &&
    profile.preferredOutputs.includes("creative-work") &&
    requestedFitSignals.includes("design-portfolio");
  if (
    designProduction &&
    fitSignals.has("design-portfolio") &&
    /(?:广告|工业设计|计算机设计|数字媒体|未来设计师|NCDA)/i.test(identityText)
  ) {
    return 26;
  }

  const evidenceLedSustainability =
    profile.majorFields.includes("engineering") &&
    profile.majorFields.includes("business") &&
    hasEvery(profile.skills, ["research", "data-analysis", "hardware"] as const) &&
    profile.preferredOutputs.includes("prototype") &&
    profile.preferredOutputs.includes("research-paper") &&
    requestedFitSignals.includes("sustainability-impact");
  if (
    evidenceLedSustainability &&
    fitSignals.has("sustainability-impact") &&
    (
      subjects.has("water-environment") ||
      subjects.has("engineering-practice") ||
      subjects.has("finance-accounting")
    )
  ) {
    return 18;
  }

  const softwareProduct =
    profile.majorFields.includes("computer-science") &&
    hasEvery(profile.skills, ["programming", "product"] as const) &&
    profile.preferredOutputs.includes("software") &&
    requestedFitSignals.includes("software-engineering");
  if (
    softwareProduct &&
    fitSignals.has("software-engineering") &&
    /(?:软件杯|计算机设计|服务外包)/.test(identityText)
  ) {
    return 18;
  }

  const ventureCreation =
    profile.majorFields.includes("business") &&
    profile.majorFields.includes("engineering") &&
    profile.skills.includes("product") &&
    profile.preferredOutputs.includes("business-plan") &&
    requestedFitSignals.includes("venture-readiness");
  if (
    ventureCreation &&
    fitSignals.has("venture-readiness") &&
    /(?:挑战杯.*创业|创业计划|中国国际.*创新|互联网\+)/.test(identityText)
  ) {
    return /(?:中国国际.*创新|互联网\+)/.test(identityText) ? 24 : 22;
  }

  return 0;
}

export function buildLegacyCompetitionQualificationSnapshot(
  profile: LegacyCompetitionScoringProfile,
  catalog?: readonly Competition[],
  now = new Date()
) {
  return buildCompetitionQualificationSnapshot(
    normalizeLegacyCompetitionScoringProfile(profile),
    catalog,
    now
  );
}

export function scoreLegacyCompetitionRecommendations(
  competitions: readonly Competition[],
  profile: LegacyCompetitionScoringProfile,
  options: {
    now?: Date;
    transcript?: LegacyCompetitionPreferenceTranscript;
  } = {}
) {
  const safeTranscript = sanitizeLegacyCompetitionScoringTranscript(options.transcript);
  return scoreCompetitionRecommendationsWithCompatibilityPolicy(
    competitions,
    normalizeLegacyCompetitionScoringProfile(profile, safeTranscript),
    {
      now: options.now,
      transcript: safeTranscript
    }
  );
}

export function getLegacyCompetitionRecommendationCandidates(
  profile: LegacyCompetitionScoringProfile,
  options: {
    now?: Date;
    catalog?: readonly Competition[];
    transcript?: LegacyCompetitionPreferenceTranscript;
  } = {}
) {
  const safeTranscript = sanitizeLegacyCompetitionScoringTranscript(options.transcript);
  const normalizedProfile = normalizeLegacyCompetitionScoringProfile(profile, safeTranscript);
  const catalog = options.catalog ?? getCompetitionCatalog();
  const baseline = getCompetitionRecommendationCandidatesWithCompatibilityPolicy(normalizedProfile, {
    now: options.now,
    catalog,
    transcript: safeTranscript
  });
  // Compatibility ranking is intentionally outside the production recall
  // implementation. Score each historical catalog entry through the current
  // V5 boundary, then apply only the whitelisted old preference comparator.
  const allRecommendations = catalog.flatMap((competition) =>
    getCompetitionRecommendationCandidatesWithCompatibilityPolicy(normalizedProfile, {
      now: options.now,
      catalog: [competition],
      transcript: safeTranscript
    }).recommendations
  );
  const selectedFitSignals = safeTranscript
    .filter(({ question }) => question.signalKey === "competition-fit")
    .flatMap(({ answer }) => answer.selectedValues);
  const ordered = allRecommendations
    .map((item, index) => {
      const track = item.recommendedTrack
        ? item.competition.recommendation.tracks?.find(({ id }) => id === item.recommendedTrack?.id)
        : undefined;
      const supported = new Set(track?.fitSignals ?? item.competition.recommendation.fit?.signals ?? []);
      const preferenceCoverage = selectedFitSignals.length
        ? selectedFitSignals.filter((signal) => supported.has(signal as never)).length /
          selectedFitSignals.length
        : 0;
      const compoundIntentBonus = legacyCompoundIntentBonus(
        normalizedProfile,
        item.competition,
        selectedFitSignals
      );
      return {
        item,
        index,
        compoundIntentBonus,
        orderingScore:
          item.baseMatchScore +
          24 * preferenceCoverage +
          compoundIntentBonus
      };
    })
    .sort((left, right) =>
      Number(right.compoundIntentBonus > 0) - Number(left.compoundIntentBonus > 0) ||
      right.orderingScore - left.orderingScore ||
      right.item.baseMatchScore - left.item.baseMatchScore ||
      left.index - right.index
    )
    .slice(0, 10)
    .map(({ item }, index) => ({ ...item, rank: index + 1 }));
  return { ...baseline, recommendations: ordered };
}

export function recommendLegacyCompetitions(
  profile: LegacyCompetitionScoringProfile,
  options: {
    now?: Date;
    catalog?: readonly Competition[];
    transcript?: LegacyCompetitionPreferenceTranscript;
  } = {}
) {
  const safeTranscript = sanitizeLegacyCompetitionScoringTranscript(options.transcript);
  const normalizedProfile = normalizeLegacyCompetitionScoringProfile(profile, safeTranscript);
  const baseline = recommendCompetitionsWithCompatibilityPolicy(normalizedProfile, {
    now: options.now,
    catalog: options.catalog,
    transcript: safeTranscript
  });
  const recalled = getLegacyCompetitionRecommendationCandidates(profile, options).recommendations;
  const selected = recalled.slice(0, 3).map((item, index) => ({
    ...item,
    rank: index + 1,
    recommendationRole: item.scoreCalibration.qualified
      ? index === 0 ? "best" as const : "steady" as const
      : "reference" as const,
    role: item.scoreCalibration.qualified ? item.role : "reference" as const
  }));
  return { ...baseline, recommendations: selected };
}

export function selectLegacyFinalQualityRecommendations<
  T extends CompetitionFinalQualityCandidate
>(
  recalled: readonly T[],
  profile: LegacyCompetitionScoringProfile,
  transcript: LegacyCompetitionPreferenceTranscript = []
) {
  const safeTranscript = sanitizeLegacyCompetitionScoringTranscript(transcript);
  return selectFinalQualityRecommendations(
    recalled,
    normalizeLegacyCompetitionScoringProfile(profile, safeTranscript),
    safeTranscript
  );
}

export function selectLegacyCompetitionRecommendationRecall(
  scored: readonly ScoredCompetition[],
  profile?: LegacyCompetitionScoringProfile
) {
  return selectCompetitionRecommendationRecall(
    scored,
    profile ? normalizeLegacyCompetitionScoringProfile(profile) : undefined
  );
}
