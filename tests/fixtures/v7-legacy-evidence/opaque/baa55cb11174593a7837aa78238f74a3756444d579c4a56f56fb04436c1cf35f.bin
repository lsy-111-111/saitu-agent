import type { Competition } from "@/content/competitions";
import type {
  CompetitionRecommendationProfileV5,
  CompetitionDynamicExchangeV3,
  CompetitionRecommendationNoMatchReason,
  CompetitionRecommendationRole,
  CompetitionRegistrationStatus,
  CompetitionScoreCalibration,
  CompetitionScoreBreakdown
} from "@/types/competition-recommendation";
import { COMPETITION_CATALOG_VERSION, getCompetitionCatalog } from "./catalog";
import {
  COMPETITION_SCORER_VERSION,
  assessCompetitionConfirmedSubjectAlignment,
  hasDominantConfirmedSubjectMatch,
  recommendationRole,
  scoreCompetitionRecommendations,
  scoreCompetitionRecommendationsWithCompatibilityPolicy,
  semanticArchetypeFit,
  type ScoredCompetition
} from "./scoring";

export type DeterministicCompetitionRecommendation = {
  decisionFit?: ScoredCompetition["decisionFit"];
  competition: Competition;
  competitionId: string;
  rank: number;
  role: CompetitionRecommendationRole;
  recommendationRole: "best" | "steady" | "reference";
  baseMatchScore: number;
  matchScore: number;
  scoreCalibration: CompetitionScoreCalibration;
  scoreBreakdown: CompetitionScoreBreakdown;
  registrationStatus: CompetitionRegistrationStatus;
  dataNotices: string[];
  eligibility: ScoredCompetition["eligibility"];
  fit: ScoredCompetition["fit"];
  name: string;
  category: string;
  summary: string;
  sourceUrl: string;
  recommendedTrack: { id: string; label: string; evidenceRef?: string } | null;
  /** Internal recall provenance; omitted from the public recommendation response. */
  preferenceRecallProtected?: true;
};

export type CompetitionRecommendationEngineResult = {
  catalogVersion: string;
  scorerVersion: string;
  recommendations: DeterministicCompetitionRecommendation[];
  noMatchReason?: CompetitionRecommendationNoMatchReason;
};

export const COMPETITION_MATCH_QUALITY_GATE_VERSION = "competition-quality-gate.2026-08.v1";
export const COMPETITION_MATCH_QUALITY_THRESHOLDS = {
  profileActionability: 0.35,
  absoluteMatchScore: 55,
  subjectTaskPoints: 7.5,
  teamResourcesPoints: 3
} as const;
export const COMPETITION_FINAL_RECOMMENDATION_LIMIT = 3;
export const COMPETITION_FINAL_ITEM_QUALITY_VERSION = "competition-final-item-quality.2026-08.v3";
export const COMPETITION_FINAL_ITEM_QUALITY_THRESHOLDS = {
  absoluteMatchScore: 55,
  subjectTaskPoints: 7.5,
  teamResourcesPoints: 3
} as const;

type ScoringProfile = CompetitionRecommendationProfileV5;

function scoreRecommendationsForProfile(
  catalog: readonly Competition[],
  profile: ScoringProfile,
  options: { now?: Date; transcript?: readonly CompetitionDynamicExchangeV3[] },
  policy: "current" | "compatibility" = "current"
) {
  return policy === "compatibility"
    ? scoreCompetitionRecommendationsWithCompatibilityPolicy(catalog, profile, options)
    : scoreCompetitionRecommendations(catalog, profile, options);
}

export type CompetitionMatchQualityAssessment = {
  version: typeof COMPETITION_MATCH_QUALITY_GATE_VERSION;
  passes: boolean;
  profileActionability: number;
  absoluteMatchScore: number;
  subjectTaskPoints: number;
  teamResourcesPoints: number;
};

export type CompetitionFinalQualityCandidate = Pick<
  ScoredCompetition,
  "competition" | "recommendedTrack" | "baseMatchScore" | "scoreBreakdown" | "eligibility"
> & { preferenceRecallProtected?: true; decisionFit?: ScoredCompetition["decisionFit"] };

function confirmedCompetitionFitSignals(transcript: readonly CompetitionDynamicExchangeV3[]) {
  return [...new Set(transcript
    .filter(({ question }) => question.signalKey === "competition-fit")
    .flatMap(({ answer }) => answer.selectedValues))];
}

function candidateFitSignals(item: CompetitionFinalQualityCandidate) {
  const track = item.recommendedTrack
    ? item.competition.recommendation.tracks?.find(({ id }) => id === item.recommendedTrack?.id)
    : undefined;
  return track?.preferenceFitSignals ??
    track?.fitSignals ??
    item.competition.recommendation.fit?.preferenceSignals ??
    item.competition.recommendation.fit?.signals ??
    [];
}

function competitionProfileActionabilityForProfile(profile: ScoringProfile) {
  const has = <T>(values: readonly T[], predicate: (value: T) => boolean) => values.some(predicate);
  const signals = [
    has(profile.majorFields, (value) => value !== "other") ? 0.2 : 0,
    profile.skills.length > 0 ? 0.05 : 0,
    has(profile.evidence, (value) => value !== "none") ? 0.2 : 0,
    profile.startingPoint !== "idea_only" ? 0.15 : 0,
    profile.experienceLevel !== "none" ? 0.15 : 0,
    profile.weeklyCommitment !== "under-5" ? 0.1 : 0,
    has(profile.availableResources, (value) => value !== "none") ? 0.1 : 0,
    profile.teamStatus !== "solo" ? 0.05 : 0,
    profile.confirmedFacts.length > 0 ? 0.05 : 0
  ];
  return Math.round(signals.reduce((sum, value) => sum + value, 0) * 100) / 100;
}

function evaluateCompetitionMatchQualityForProfile(
  profile: ScoringProfile,
  candidates: readonly CompetitionFinalQualityCandidate[]
): CompetitionMatchQualityAssessment {
  const top = candidates[0];
  const actionability = competitionProfileActionabilityForProfile(profile);
  const absoluteMatchScore = top?.baseMatchScore ?? 0;
  const subjectTaskPoints = top?.scoreBreakdown.subjectTask ?? 0;
  const teamResourcesPoints = top?.scoreBreakdown.teamResources ?? 0;
  return {
    version: COMPETITION_MATCH_QUALITY_GATE_VERSION,
    passes:
      actionability >= COMPETITION_MATCH_QUALITY_THRESHOLDS.profileActionability &&
      absoluteMatchScore >= COMPETITION_MATCH_QUALITY_THRESHOLDS.absoluteMatchScore &&
      subjectTaskPoints >= COMPETITION_MATCH_QUALITY_THRESHOLDS.subjectTaskPoints &&
      teamResourcesPoints >= COMPETITION_MATCH_QUALITY_THRESHOLDS.teamResourcesPoints,
    profileActionability: actionability,
    absoluteMatchScore,
    subjectTaskPoints,
    teamResourcesPoints
  };
}

function round1(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function calibrateCompetitionScoreForProfile(
  profile: ScoringProfile,
  item: Pick<ScoredCompetition, "baseMatchScore" | "scoreBreakdown">
): { matchScore: number; scoreCalibration: CompetitionScoreCalibration } {
  const subjectTask = item.scoreBreakdown.subjectTask ?? 0;
  const skillsEvidence = item.scoreBreakdown.skillsEvidence ?? 0;
  const goalsOutputs = item.scoreBreakdown.goalsOutputs ?? 0;
  const teamResources = item.scoreBreakdown.teamResources ?? 0;
  const dataConfidence = item.scoreBreakdown.dataConfidence ?? 0;
  const rawAlignment =
    0.5 * subjectTask / 25 +
    0.3 * skillsEvidence / 20 +
    0.2 * goalsOutputs / 15;
  const rawEvidenceConfidence = dataConfidence / 5;
  const alignment = round4(rawAlignment);
  const evidenceConfidence = round4(rawEvidenceConfidence);
  const qualified =
    competitionProfileActionabilityForProfile(profile) >= COMPETITION_MATCH_QUALITY_THRESHOLDS.profileActionability &&
    item.baseMatchScore >= COMPETITION_MATCH_QUALITY_THRESHOLDS.absoluteMatchScore &&
    subjectTask >= COMPETITION_MATCH_QUALITY_THRESHOLDS.subjectTaskPoints &&
    teamResources >= COMPETITION_MATCH_QUALITY_THRESHOLDS.teamResourcesPoints;
  const adjustment = qualified
    ? round1(Math.min(
        8,
        (100 - item.baseMatchScore) * 0.6 * rawAlignment * rawEvidenceConfidence
      ))
    : 0;
  return {
    matchScore: round1(Math.min(95, item.baseMatchScore + adjustment)),
    scoreCalibration: {
      version: "competition-score-calibration.v1",
      qualified,
      alignment,
      evidenceConfidence,
      adjustment
    }
  };
}

function toRecommendation(
  item: ScoredCompetition,
  index: number,
  profile: ScoringProfile
): DeterministicCompetitionRecommendation {
  const rank = index + 1;
  const calibrated = item.decisionFit ? {
    matchScore: item.baseMatchScore,
    scoreCalibration: { version: "competition-evidence-interval.v1" as const, qualified: item.decisionFit.actionable,
      alignment: item.baseMatchScore / 100, evidenceConfidence: 1 - (item.decisionFit.upper - item.decisionFit.lower) / 100, adjustment: 0 }
  } : calibrateCompetitionScoreForProfile(profile, item);
  const currentRecommendationRole = !calibrated.scoreCalibration.qualified
    ? "reference" as const
    : rank === 1
      ? "best" as const
      : "steady" as const;
  return {
    decisionFit: item.decisionFit,
    competition: item.competition,
    competitionId: item.competition.id,
    rank,
    role: calibrated.scoreCalibration.qualified ? recommendationRole(item, rank) : "reference",
    recommendationRole: currentRecommendationRole,
    baseMatchScore: item.baseMatchScore,
    ...calibrated,
    scoreBreakdown: item.scoreBreakdown,
    registrationStatus: item.availability.registrationStatus,
    dataNotices: item.dataNotices,
    eligibility: item.eligibility,
    fit: item.fit,
    name: item.competition.name,
    category: item.competition.category,
    summary: item.competition.summary,
    sourceUrl: item.competition.sourceUrl,
    recommendedTrack: item.recommendedTrack ?? null,
    ...((item as ScoredCompetition & { preferenceRecallProtected?: true }).preferenceRecallProtected
      ? { preferenceRecallProtected: true as const }
      : {})
  };
}

function appendUniqueRecommendations<T extends CompetitionFinalQualityCandidate>(
  target: T[],
  candidates: readonly T[]
) {
  if (target.length >= COMPETITION_FINAL_RECOMMENDATION_LIMIT) return;
  const selectedIds = new Set(target.map(({ competition }) => competition.id));
  for (const candidate of candidates) {
    if (selectedIds.has(candidate.competition.id)) continue;
    target.push(candidate);
    selectedIds.add(candidate.competition.id);
    if (target.length >= COMPETITION_FINAL_RECOMMENDATION_LIMIT) break;
  }
}

function buildCompetitionFinalQualityPoolForProfile<T extends CompetitionFinalQualityCandidate>(
  recalled: readonly T[],
  profile: ScoringProfile,
  transcript: readonly CompetitionDynamicExchangeV3[] = []
): T[] {
  if (recalled.length === 0) return [];

  // Quality-pool membership is determined only by the fixed questionnaire:
  // a confirmed dominant subject match OR a confirmed task-format semantic
  // match. Dynamic competition-fit answers may refine scoring and model order,
  // but must never remove a fixed-profile match from this union.
  const subjectMatched = recalled.map((item, index) => ({
        item,
        index,
        assessment: assessCompetitionConfirmedSubjectAlignment(item.competition, profile)
      }))
        .filter(({ assessment }) => hasDominantConfirmedSubjectMatch(assessment))
        .sort((left, right) =>
          // Base score remains authoritative. For an exact deterministic tie,
          // prefer the candidate with stronger evidenced subject/task fit.
          (right.item.baseMatchScore === left.item.baseMatchScore
            ? (right.item.scoreBreakdown.subjectTask ?? 0) -
              (left.item.scoreBreakdown.subjectTask ?? 0)
            : 0) ||
          left.index - right.index
        )
        .map(({ item }) => item);
  const subjectIds = new Set(subjectMatched.map(({ competition }) => competition.id));
  const taskMatched = profile.confirmedFields.includes("taskFormats")
    ? recalled.filter((item) =>
        !subjectIds.has(item.competition.id) &&
        (semanticArchetypeFit(item.competition, profile) ?? 0) > 0
      )
    : [];
  const requestedFitSignals = confirmedCompetitionFitSignals(transcript);
  const selectedTrackCompetitionIds = new Set(
    transcript
      .filter(({ question, answer }) =>
        question.signalKey.startsWith("track:") && answer.selectedValues.length > 0
      )
      .map(({ question }) => question.signalKey.slice("track:".length))
  );
  const preferenceCoverage = (item: T) => {
    if (requestedFitSignals.length === 0) return 0;
    const supported = new Set<string>(candidateFitSignals(item));
    return requestedFitSignals.filter((signal) => supported.has(signal)).length /
      requestedFitSignals.length;
  };
  const qualityOrderingScore = (item: T) =>
    item.baseMatchScore +
    (item.scoreBreakdown.subjectTask ?? 0) +
    (transcript.length === 0
      ? 4 * (semanticArchetypeFit(item.competition, profile) ?? 0)
      : 0) +
    (requestedFitSignals.length > 1 ? 18 : 24) * preferenceCoverage(item) +
    (requestedFitSignals.length === 1 && item.preferenceRecallProtected
      ? 8 * preferenceCoverage(item)
      : 0);
  // Keep the pool as the required subject OR confirmed-task union. Rank this
  // union by the V3 ability preference and complete structured base score.
  // Before any follow-up, exact semantic task-prototype evidence contributes
  // at most four tie-break points. Once the user states a preference, the
  // preference itself is authoritative and the semantic tie-breaker is not
  // applied again. A single explicit ability preference contributes up to 24
  // comparator points. A catalog member retrieved from just outside the fixed
  // Top10 receives at most eight additional visibility points, allowing a
  // fully supported answer to cross one strong but preference-unsupported
  // neighbour without changing either item's score.
  // When the user deliberately combines two preferences, cap that
  // blend at 18 so one full-coverage neighbour cannot erase the stronger
  // fixed-profile match merely because another supports only one half.
  // These preferences can resolve nearby members without changing the
  // structured score or eligibility.
  const subjectOrTaskMatched = [...subjectMatched, ...taskMatched]
    .map((item, index) => ({ item, index }))
    .sort((left, right) =>
      qualityOrderingScore(right.item) - qualityOrderingScore(left.item) ||
      (right.item.scoreBreakdown.subjectTask ?? 0) -
        (left.item.scoreBreakdown.subjectTask ?? 0) ||
      right.item.baseMatchScore - left.item.baseMatchScore ||
      left.index - right.index
    )
    .map(({ item }) => item);
  // A selected track is a content decision about a known candidate, not a
  // reason to force that candidate to rank first. If its natural quality order
  // would place it outside the visible three, retain it in the third slot so
  // the user's refinement remains observable while earlier evidence-based
  // ordering stays intact.
  for (const competitionId of selectedTrackCompetitionIds) {
    const currentIndex = subjectOrTaskMatched.findIndex(
      ({ competition }) => competition.id === competitionId
    );
    if (currentIndex <= 2) continue;
    const [selectedTrackItem] = subjectOrTaskMatched.splice(currentIndex, 1);
    if (selectedTrackItem) subjectOrTaskMatched.splice(2, 0, selectedTrackItem);
  }
  const subjectPool = subjectOrTaskMatched;
  if (subjectPool.length === 0) return [];
  // Use the same absolute subject/task threshold as score calibration. A
  // relative cutoff derived from a broad neighbour could otherwise erase an
  // exact fixed-profile member even though it clears every approved gate.
  const minimumSubjectTask = COMPETITION_FINAL_ITEM_QUALITY_THRESHOLDS.subjectTaskPoints;
  const passesItemQuality = (item: T, subjectTaskFloor: number) => {
    if (
      item.baseMatchScore < COMPETITION_FINAL_ITEM_QUALITY_THRESHOLDS.absoluteMatchScore ||
      (item.scoreBreakdown.subjectTask ?? 0) < subjectTaskFloor ||
      (item.scoreBreakdown.teamResources ?? 0) < COMPETITION_FINAL_ITEM_QUALITY_THRESHOLDS.teamResourcesPoints
    ) {
      return false;
    }
    return true;
  };
  const qualityEligible = subjectPool.filter((item) => passesItemQuality(item, minimumSubjectTask));
  return qualityEligible;
}

function selectFinalQualityRecommendationsForProfile<T extends CompetitionFinalQualityCandidate>(
  recalled: readonly T[],
  profile: ScoringProfile,
  transcript: readonly CompetitionDynamicExchangeV3[] = []
): T[] {
  const qualityEligible = buildCompetitionFinalQualityPoolForProfile(recalled, profile, transcript);
  return qualityEligible.slice(0, COMPETITION_FINAL_RECOMMENDATION_LIMIT);
}

/**
 * Fill the final Top3 from the complete model ordering without weakening the
 * official hard-eligibility boundary applied during scoring/recall.
 *
 * Each tier preserves the incoming (DeepSeek or deterministic fallback) order:
 * score-qualified items, confirmed subject/task intent, practical
 * compatibility, then every remaining hard-eligible recalled candidate.
 */
function selectFinalThreeRecommendationsForProfile<T extends CompetitionFinalQualityCandidate>(
  recalled: readonly T[],
  profile: ScoringProfile,
  _transcript: readonly CompetitionDynamicExchangeV3[] = []
): T[] {
  const selected: T[] = [];
  const isQualified = (item: T) => calibrateCompetitionScoreForProfile(profile, item).scoreCalibration.qualified;
  const tiers = [
    recalled.filter((item) => isQualified(item) && item.eligibility.status === "eligible"),
    recalled.filter((item) => isQualified(item) && item.eligibility.status === "needs_clarification"),
    recalled.filter((item) => !isQualified(item) && item.eligibility.status === "eligible"),
    recalled.filter((item) => !isQualified(item) && item.eligibility.status === "needs_clarification")
  ];
  for (const tier of tiers) appendUniqueRecommendations(selected, tier);
  return selected;
}

/** A stable signature of the actual comparison evidence, excluding identity, dates and contact services. */
export function competitionDecisionBasis(item: CompetitionFinalQualityCandidate): string {
  if (!item.decisionFit) return item.competition.id;
  const metadata = item.competition.recommendation;
  const track = metadata.tracks?.find(value => value.id === item.recommendedTrack?.id);
  // If two series have indistinguishable catalog evidence for this student,
  // leave both in the expandable set and use only one main decision slot.
  const stable = (values: readonly string[] | undefined) => [...new Set(values)].sort();
  return JSON.stringify([
    item.eligibility.status, track?.label ?? null,
    stable(track?.subjects ?? metadata.subjects), stable(track?.fitSignals ?? metadata.fit?.signals),
    stable(track?.skills ?? metadata.skills), stable(track?.preferredOutputs ?? metadata.preferredOutputs),
    stable(track?.mandatoryTasks ?? metadata.mandatoryTasks),
    item.decisionFit.dimensions, item.decisionFit.upper,
    metadata.teamRequirement, stable(metadata.requiredResources)
  ]);
}

/**
 * Production-visible deterministic Top3 composition. The quality pool may
 * promote confirmed subject/task matches, while the complete hard-eligible
 * recall is retained as a backfill before the four qualification/quality
 * tiers are applied. Clarification counterfactuals must use this helper rather
 * than comparing the raw recall Top3.
 */
function selectFinalVisibleCompetitionRecommendationsForProfile<
  T extends CompetitionFinalQualityCandidate
>(
  recalled: readonly T[],
  profile: ScoringProfile,
  transcript: readonly CompetitionDynamicExchangeV3[] = []
): T[] {
  if (recalled.some(item => item.decisionFit)) {
    const visible: T[] = [];
    const represented = new Set<string>();
    // Callers may present candidates in provider order; keep their already computed, signed-profile rank.
    const inServerOrder = [...recalled].sort((a,b) => {
      const rank = (item: T) => "rank" in item && typeof item.rank === "number" ? item.rank : 0;
      return rank(a) - rank(b);
    });
    for (const item of inServerOrder) {
      if (!item.decisionFit?.actionable) continue;
      const basis = competitionDecisionBasis(item);
      if (represented.has(basis)) continue;
      represented.add(basis);
      visible.push(item);
      if (visible.length === COMPETITION_FINAL_RECOMMENDATION_LIMIT) break;
    }
    return visible;
  }
  const qualityPreferred = selectFinalQualityRecommendationsForProfile(recalled, profile, transcript);
  const qualityPreferredIds = new Set(
    qualityPreferred.map(({ competition }) => competition.id)
  );
  return selectFinalThreeRecommendationsForProfile([
    ...qualityPreferred,
    ...recalled.filter(({ competition }) => !qualityPreferredIds.has(competition.id))
  ], profile, transcript);
}

/** Official-hard-filtered Top10 recall, with deterministic score only as model context. */
function getCompetitionRecommendationCandidatesForProfile(
  profile: ScoringProfile,
  options: {
    now?: Date;
    catalog?: readonly Competition[];
    transcript?: readonly CompetitionDynamicExchangeV3[];
  } = {},
  policy: "current" | "compatibility" = "current"
): CompetitionRecommendationEngineResult {
  const scored = scoreRecommendationsForProfile(options.catalog ?? getCompetitionCatalog(), profile, {
    now: options.now,
    transcript: options.transcript
  }, policy);
  const recalled = selectCompetitionRecommendationRecallForProfile(
    scored,
    profile,
    options.transcript
  );
  return {
    catalogVersion: COMPETITION_CATALOG_VERSION,
    scorerVersion: COMPETITION_SCORER_VERSION,
    recommendations: recalled.map((item, index) => toRecommendation(item, index, profile)),
    ...(scored.length === 0
      ? { noMatchReason: "no_eligible_candidates" as const }
      : recalled.length === 0
        ? { noMatchReason: "no_current_cycle_candidates" as const }
        : {})
  };
}

/** Deterministic exact-Top3 fallback retained for non-API callers and tests. */
function recommendCompetitionsForProfile(
  profile: ScoringProfile,
  options: {
    now?: Date;
    catalog?: readonly Competition[];
    transcript?: readonly CompetitionDynamicExchangeV3[];
  } = {},
  policy: "current" | "compatibility" = "current"
): CompetitionRecommendationEngineResult {
  const scored = scoreRecommendationsForProfile(options.catalog ?? getCompetitionCatalog(), profile, {
    now: options.now,
    transcript: options.transcript
  }, policy);
  const recalled = selectCompetitionRecommendationRecallForProfile(
    scored,
    profile,
    options.transcript
  );
  const selected = selectFinalVisibleCompetitionRecommendationsForProfile(
    recalled,
    profile,
    options.transcript
  );
  if (policy === "current") return {catalogVersion: COMPETITION_CATALOG_VERSION, scorerVersion: COMPETITION_SCORER_VERSION, recommendations: selected.map((item, index) => toRecommendation(item, index, profile)), ...(selected.length ? {} : {noMatchReason: scored.length ? "below_quality_threshold" as const : "no_eligible_candidates" as const})};
  // The fixed subject/task union controls which candidates are promoted, but
  // an empty union must not misclassify an otherwise qualified reference
  // backfill as "no match". Assess the actual four-tier visible result so the
  // no-match state remains consistent with its displayed role/calibration.
  const quality = evaluateCompetitionMatchQualityForProfile(profile, selected);
  // A reference is intentionally allowed to sit below the 7.5 subject/task
  // calibration gate: that is what distinguishes it from a qualified match.
  // It still prevents a false `no match` when the profile is actionable and
  // the catalog offers a sufficiently evidenced, feasible transfer option.
  const hasActionableReference =
    quality.profileActionability >= COMPETITION_MATCH_QUALITY_THRESHOLDS.profileActionability &&
    quality.absoluteMatchScore >= COMPETITION_MATCH_QUALITY_THRESHOLDS.absoluteMatchScore &&
    quality.teamResourcesPoints >= COMPETITION_MATCH_QUALITY_THRESHOLDS.teamResourcesPoints;
  return {
    catalogVersion: COMPETITION_CATALOG_VERSION,
    scorerVersion: COMPETITION_SCORER_VERSION,
    recommendations: selected.map((item, index) => toRecommendation(item, index, profile)),
    ...(scored.length === 0
      ? { noMatchReason: "no_eligible_candidates" as const }
      : recalled.length === 0
        ? { noMatchReason: "no_current_cycle_candidates" as const }
        : !hasActionableReference
          ? { noMatchReason: "below_quality_threshold" as const }
        : {})
  };
}

export const COMPETITION_RECOMMENDATION_RECALL_LIMIT = 10;

function selectCompetitionRecommendationRecallForProfile(
  scored: readonly ScoredCompetition[],
  profile?: ScoringProfile,
  transcript: readonly CompetitionDynamicExchangeV3[] = []
): ScoredCompetition[] {
  // Every eligible series has already been evaluated on every registered track.
  // There is no date-based bucket or pre-ranking cutoff.
  return [...scored];
}

/** Current recommendation boundary: only signed V5 profiles reach production. */
export function competitionProfileActionability(
  profile: CompetitionRecommendationProfileV5
) {
  return competitionProfileActionabilityForProfile(profile);
}

export function evaluateCompetitionMatchQuality(
  profile: CompetitionRecommendationProfileV5,
  candidates: readonly CompetitionFinalQualityCandidate[]
) {
  return evaluateCompetitionMatchQualityForProfile(profile, candidates);
}

export function calibrateCompetitionScore(
  profile: CompetitionRecommendationProfileV5,
  item: Pick<ScoredCompetition, "baseMatchScore" | "scoreBreakdown">
) {
  return calibrateCompetitionScoreForProfile(profile, item);
}

export function buildCompetitionFinalQualityPool<T extends CompetitionFinalQualityCandidate>(
  recalled: readonly T[],
  profile: CompetitionRecommendationProfileV5,
  transcript: readonly CompetitionDynamicExchangeV3[] = []
) {
  return recalled.some(item => item.decisionFit)
    ? recalled.filter(item => item.decisionFit?.actionable)
    : buildCompetitionFinalQualityPoolForProfile(recalled, profile, transcript);
}

export function selectFinalQualityRecommendations<T extends CompetitionFinalQualityCandidate>(
  recalled: readonly T[],
  profile: CompetitionRecommendationProfileV5,
  transcript: readonly CompetitionDynamicExchangeV3[] = []
) {
  return recalled.some(item => item.decisionFit)
    ? selectFinalVisibleCompetitionRecommendationsForProfile(recalled, profile, transcript)
    : selectFinalQualityRecommendationsForProfile(recalled, profile, transcript);
}

export function selectFinalThreeRecommendations<T extends CompetitionFinalQualityCandidate>(
  recalled: readonly T[],
  profile: CompetitionRecommendationProfileV5,
  transcript: readonly CompetitionDynamicExchangeV3[] = []
) {
  return recalled.some(item => item.decisionFit)
    ? selectFinalVisibleCompetitionRecommendationsForProfile(recalled, profile, transcript)
    : selectFinalThreeRecommendationsForProfile(recalled, profile, transcript);
}

export function selectFinalVisibleCompetitionRecommendations<
  T extends CompetitionFinalQualityCandidate
>(
  recalled: readonly T[],
  profile: CompetitionRecommendationProfileV5,
  transcript: readonly CompetitionDynamicExchangeV3[] = []
) {
  return selectFinalVisibleCompetitionRecommendationsForProfile(recalled, profile, transcript);
}

export function getCompetitionRecommendationCandidates(
  profile: CompetitionRecommendationProfileV5,
  options: {
    now?: Date;
    catalog?: readonly Competition[];
    transcript?: readonly CompetitionDynamicExchangeV3[];
  } = {}
) {
  return getCompetitionRecommendationCandidatesForProfile(profile, options);
}

/** Called only by the isolated old-profile adapter after projection to V5. */
export function getCompetitionRecommendationCandidatesWithCompatibilityPolicy(
  profile: CompetitionRecommendationProfileV5,
  options: {
    now?: Date;
    catalog?: readonly Competition[];
    transcript?: readonly CompetitionDynamicExchangeV3[];
  } = {}
) {
  return getCompetitionRecommendationCandidatesForProfile(profile, options, "compatibility");
}

export function recommendCompetitions(
  profile: CompetitionRecommendationProfileV5,
  options: {
    now?: Date;
    catalog?: readonly Competition[];
    transcript?: readonly CompetitionDynamicExchangeV3[];
  } = {}
) {
  return recommendCompetitionsForProfile(profile, options);
}

/** Called only by the isolated old-profile adapter after projection to V5. */
export function recommendCompetitionsWithCompatibilityPolicy(
  profile: CompetitionRecommendationProfileV5,
  options: {
    now?: Date;
    catalog?: readonly Competition[];
    transcript?: readonly CompetitionDynamicExchangeV3[];
  } = {}
) {
  return recommendCompetitionsForProfile(profile, options, "compatibility");
}

export function selectCompetitionRecommendationRecall(
  scored: readonly ScoredCompetition[],
  profile?: CompetitionRecommendationProfileV5,
  transcript: readonly CompetitionDynamicExchangeV3[] = []
) {
  return selectCompetitionRecommendationRecallForProfile(scored, profile, transcript);
}

/** @deprecated Use selectCompetitionRecommendationRecall. */
export const selectQualifiedCompetitionRecommendations = selectCompetitionRecommendationRecall;
