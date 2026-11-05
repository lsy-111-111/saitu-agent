import type {
  CompetitionDynamicExchangeV2,
  CompetitionRecommendationProfileV5,
  CompetitionStudentStage
} from "@/types/competition-recommendation";
import { competitionAnchorPersonasPart1 } from "./competition-quality-anchors-1";
import { competitionAnchorPersonasPart2 } from "./competition-quality-anchors-2";
import { competitionAnchorPersonasPart3 } from "./competition-quality-anchors-3";
import { competitionAnchorPersonasPart4 } from "./competition-quality-anchors-4";
import { staticCompetitionHardNegativePersonas } from "./competition-quality-negative-gold";
import { staticCompetitionNoMatchPersonas } from "./competition-quality-no-match-gold";
import { staticCompetitionRankingHoldoutCases } from "./competition-quality-ranking-gold";

export { competitionYearConstraintBoundaryPersonas } from "./competition-quality-year-gold";

export const QUALITY_BENCHMARK_NOW = new Date("2026-08-23T00:00:00.000Z");

export const QUALITY_STAGE_GROUPS = [
  "vocational",
  "undergraduate-lower",
  "undergraduate-upper",
  "master",
  "doctorate-or-recent"
] as const;
export type QualityStageGroup = (typeof QUALITY_STAGE_GROUPS)[number];

export type CompetitionAnchorPersona = {
  kind: "anchor";
  id: string;
  stageGroup: QualityStageGroup;
  /** Frozen expected identity; never looked up while constructing the profile. */
  expectedId: string;
  expectedName: string;
  evidenceRef: string;
  constraintEvidenceRefs: string[];
  rationale: string;
  officialConstraintRationale: string;
  profile: CompetitionRecommendationProfileV5;
  transcript: CompetitionDynamicExchangeV2[];
};

export type CompetitionRankingLabel = {
  competitionId: string;
  relevance: 1 | 2;
  rationale: string;
  evidenceRef: string;
};

export type CompetitionRankingHoldoutCase = {
  id: string;
  stageGroup: QualityStageGroup;
  profileOrigin: "expert-authored-independent";
  visibleFacts: readonly string[];
  rationale: string;
  profile: CompetitionRecommendationProfileV5;
  transcript: readonly CompetitionDynamicExchangeV2[];
  labels: readonly CompetitionRankingLabel[];
};

export type CompetitionHardNegativeDecisiveFact =
  | "stage"
  | "full-time"
  | "team-size"
  | "same-institution"
  | "required-resource";

export type CompetitionHardNegativePersona = {
  kind: "hard-negative";
  id: string;
  stageGroup: QualityStageGroup;
  forbiddenCompetitionId: string;
  decisiveFact: CompetitionHardNegativeDecisiveFact;
  expectedHardFilterReason:
    | "stage-ineligible"
    | "full-time-status-ineligible"
    | "team-size-ineligible"
    | "same-institution-team-ineligible"
    | "required-resource-ineligible";
  sourceEvidenceRef: string;
  rationale: string;
  officialConstraintRationale: string;
  profile: CompetitionRecommendationProfileV5;
  transcript: CompetitionDynamicExchangeV2[];
};

export type CompetitionYearConstraintBoundaryPersona = {
  id: string;
  competitionId: string;
  sourceEvidenceRef: string;
  expectedHardFilterReason: null;
  expectedEligibilityStatus: "needs_clarification";
  officialConstraintRationale: string;
  profile: CompetitionRecommendationProfileV5;
  transcript: CompetitionDynamicExchangeV2[];
};

export type CompetitionNoMatchPersona = {
  kind: "no-match";
  id: string;
  stageGroup: QualityStageGroup;
  expectedReason: "insufficient-information" | "incompatible-constraints";
  rationale: string;
  profile: CompetitionRecommendationProfileV5;
  transcript: CompetitionDynamicExchangeV2[];
};

export type CompetitionQualityPersona =
  | CompetitionAnchorPersona
  | CompetitionHardNegativePersona
  | CompetitionNoMatchPersona;

/**
 * Static expert-gold records. The source modules contain only literals and type
 * imports; no catalog or scorer module participates in constructing an answer.
 */
export const competitionAnchorPersonas: CompetitionAnchorPersona[] = [
  ...competitionAnchorPersonasPart1,
  ...competitionAnchorPersonasPart2,
  ...competitionAnchorPersonasPart3,
  ...competitionAnchorPersonasPart4
];

export const competitionRankingHoldoutCases: CompetitionRankingHoldoutCase[] =
  staticCompetitionRankingHoldoutCases;

export const competitionHardNegativePersonas: CompetitionHardNegativePersona[] =
  staticCompetitionHardNegativePersonas;

export const competitionNoMatchPersonas: CompetitionNoMatchPersona[] =
  staticCompetitionNoMatchPersonas;

export const competitionQualityPersonas: CompetitionQualityPersona[] = [
  ...competitionAnchorPersonas,
  ...competitionHardNegativePersonas,
  ...competitionNoMatchPersonas
];

export function qualityPersonaStageGroup(profile: CompetitionRecommendationProfileV5): QualityStageGroup {
  return groupForStage(profile.stage);
}

function groupForStage(stage: CompetitionStudentStage): QualityStageGroup {
  if (stage === "vocational") return "vocational";
  if (stage === "undergraduate-1" || stage === "undergraduate-2") return "undergraduate-lower";
  if (stage === "undergraduate-3" || stage === "undergraduate-4") return "undergraduate-upper";
  if (stage === "master") return "master";
  return "doctorate-or-recent";
}
