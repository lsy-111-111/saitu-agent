import { competitions, type Competition } from "@/content/competitions";

export const COMPETITION_CATALOG_VERSION = "2026-11-04.v7";

const competitionById = new Map(competitions.map((competition) => [competition.id, competition]));

/**
 * Technical redirects for retired directory/service references. A mapping
 * keeps a stale route usable; it does not assert that the retired event and
 * replacement are the same competition identity and must not bind a saved
 * recommendation snapshot.
 */
export const COMPETITION_LEGACY_ID_MIGRATIONS = {
  "china-medical-skills": "graduate-cybersecurity-innovation",
  "ai-application-scenarios": "graduate-rural-revitalization-agritech"
} as const;

export function resolveCatalogCompetitionId(id: string): string | null {
  if (competitionById.has(id)) return id;
  const migratedId = COMPETITION_LEGACY_ID_MIGRATIONS[
    id as keyof typeof COMPETITION_LEGACY_ID_MIGRATIONS
  ];
  return migratedId && competitionById.has(migratedId) ? migratedId : null;
}

export function getCompetitionCatalog(): readonly Competition[] {
  return competitions;
}

/**
 * Resolve only the same stable competition identity. Saved recommendation
 * snapshots must use this boundary so a retired event is never rendered with
 * another event's current name, artwork or details.
 */
export function findCanonicalCatalogCompetition(id: string): Competition | null {
  return competitionById.get(id) ?? null;
}

/**
 * Return only genuine preparation choices. Official fact/eligibility
 * classifications remain in the catalog and qualification snapshot, but are
 * excluded from every dynamic preference-question path.
 */
export function getCompetitionPreferenceQuestionTracks(competition: Competition) {
  return (competition.recommendation.tracks ?? []).filter(
    ({ preferenceQuestionEligible }) => preferenceQuestionEligible !== false
  );
}

export function findCatalogCompetition(id: string): Competition | null {
  const canonicalId = resolveCatalogCompetitionId(id);
  return canonicalId ? competitionById.get(canonicalId) ?? null : null;
}

export function isCatalogCompetitionId(id: string): boolean {
  // Protocol validation intentionally accepts canonical IDs only. Legacy IDs
  // are restricted to explicit read/lookup migration paths above.
  return competitionById.has(id);
}
