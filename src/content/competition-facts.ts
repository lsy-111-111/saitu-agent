import records from "./competition-fact-sheets.json";
import newSeries from "./competition-series-20261104.json";

export type CompetitionFactSheet = {
  edition: string;
  eligibility: string;
  team: string;
  mentor: string;
  fee: string;
  checkedAt: string;
  sources: { title: string; url: string; scope: string }[];
  nodes: { kind: string; scope: string; date: string; sourceUrl: string }[];
};

const factSheets: Record<string, CompetitionFactSheet> = records;
const researchIds = new Map(newSeries.map(({ id, researchId }) => [id, researchId]));

export function getCompetitionFactSheet(competitionId: string): CompetitionFactSheet | undefined {
  const key = researchIds.get(competitionId) ?? competitionId;
  return Object.hasOwn(factSheets, key) ? factSheets[key] : undefined;
}
