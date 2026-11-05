import {
  competitionResourceTemplates,
  defaultCompetitionTeamAvailability,
  type CompetitionResourceAvailability,
  type CompetitionResourceTemplate,
  type CompetitionTeamAvailability
} from "@/content/competition-services";
import { findCatalogCompetition, resolveCatalogCompetitionId } from "@/lib/competitions/catalog";

export type CompetitionServiceMode = "resources" | "teams";

export type UnavailableCompetitionService = {
  status: "unavailable";
};

export type ResolvedCompetitionResource = Omit<CompetitionResourceTemplate, "availability"> & {
  availability: CompetitionResourceAvailability | UnavailableCompetitionService;
};

export type ResolvedCompetitionTeamAvailability =
  | CompetitionTeamAvailability
  | UnavailableCompetitionService;

export type CompetitionServiceOverride = {
  resources?: readonly CompetitionResourceTemplate[];
  team?: CompetitionTeamAvailability;
};

export type CompetitionServiceFallback = {
  category?: string;
  name?: string;
  sourceUrl?: string;
};

export type ResolvedCompetitionService = {
  category?: string;
  competitionId: string;
  knownCompetition: boolean;
  name: string;
  resources: readonly ResolvedCompetitionResource[];
  sourceUrl?: string;
  team: ResolvedCompetitionTeamAvailability;
  verifiedAt?: string;
};

/**
 * Per-competition service records can be added here when verified files or team
 * entrances become available. Until then, every catalog competition inherits
 * the truthful planned states exported by competition-services.
 */
export const competitionServiceOverridesById: Readonly<
  Record<string, CompetitionServiceOverride | undefined>
> = {};

const unavailableResources = competitionResourceTemplates.map((resource) => ({
  ...resource,
  availability: { status: "unavailable" as const }
})) satisfies readonly ResolvedCompetitionResource[];

export function resolveCompetitionService(
  competitionId: string,
  fallback: CompetitionServiceFallback = {}
): ResolvedCompetitionService {
  const canonicalCompetitionId = resolveCatalogCompetitionId(competitionId);
  const competition = canonicalCompetitionId
    ? findCatalogCompetition(canonicalCompetitionId)
    : null;

  if (!canonicalCompetitionId || !competition) {
    return {
      competitionId,
      knownCompetition: false,
      name: fallback.name?.trim() || "未知竞赛",
      ...(fallback.category ? { category: fallback.category } : {}),
      ...(fallback.sourceUrl ? { sourceUrl: fallback.sourceUrl } : {}),
      resources: unavailableResources,
      team: { status: "unavailable" }
    };
  }

  const override = competitionServiceOverridesById[canonicalCompetitionId];

  return {
    competitionId: canonicalCompetitionId,
    knownCompetition: true,
    name: competition.name,
    category: competition.category,
    sourceUrl: competition.sourceUrl,
    verifiedAt: competition.recommendation.schedule.verifiedAt,
    resources: override?.resources ?? competitionResourceTemplates,
    team: override?.team ?? defaultCompetitionTeamAvailability
  };
}
