import type {
  Competition,
  CompetitionDirection
} from "@/content/competitions";

export const ALL_COMPETITION_DIRECTIONS = "全部方向" as const;
export const COMPETITION_QUERY_MAX_LENGTH = 80;

export type CompetitionDirectionFilter =
  | typeof ALL_COMPETITION_DIRECTIONS
  | CompetitionDirection;

type CompetitionSearchDocument = Pick<
  Competition,
  "name" | "category" | "direction" | "summary"
>;

const whitespacePattern = /\s+/u;

export function limitCompetitionQuery(value: string): string {
  return value.slice(0, COMPETITION_QUERY_MAX_LENGTH);
}

export function normalizeCompetitionSearch(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim();
}

export function tokenizeCompetitionSearch(value: string): readonly string[] {
  const normalized = normalizeCompetitionSearch(value);
  return normalized ? normalized.split(whitespacePattern) : [];
}

export function filterCompetitions<T extends CompetitionSearchDocument>(
  entries: readonly T[],
  query: string,
  direction: CompetitionDirectionFilter
): T[] {
  const terms = tokenizeCompetitionSearch(limitCompetitionQuery(query));

  return entries.filter((competition) => {
    if (
      direction !== ALL_COMPETITION_DIRECTIONS &&
      competition.direction !== direction
    ) {
      return false;
    }

    if (terms.length === 0) {
      return true;
    }

    const searchText = normalizeCompetitionSearch(
      [
        competition.name,
        competition.category,
        competition.direction,
        competition.summary
      ].join(" ")
    );

    return terms.every((term) => searchText.includes(term));
  });
}
