import {
  competitionDirections,
  type CompetitionDirection
} from "@/content/competitions";
import {
  ALL_COMPETITION_DIRECTIONS,
  limitCompetitionQuery,
  type CompetitionDirectionFilter
} from "@/lib/competitions/directory-filter";

export {
  ALL_COMPETITION_DIRECTIONS,
  COMPETITION_QUERY_MAX_LENGTH,
  filterCompetitions,
  limitCompetitionQuery,
  normalizeCompetitionSearch,
  tokenizeCompetitionSearch,
  type CompetitionDirectionFilter
} from "@/lib/competitions/directory-filter";

type CompetitionDirectoryFilters = {
  query: string;
  direction: CompetitionDirectionFilter;
  page?: number;
};

const validDirections = new Set<CompetitionDirection>(competitionDirections);
const positiveIntegerPattern = /^[1-9]\d*$/;
const MAX_DIRECTORY_PAGE = 10_000;

function firstQueryParameter(value: string | readonly string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export function parseCompetitionQuery(
  value: string | readonly string[] | undefined
): string {
  return limitCompetitionQuery(firstQueryParameter(value).normalize("NFKC").trim());
}

export function parseCompetitionDirection(
  value: string | readonly string[] | undefined
): CompetitionDirectionFilter {
  const candidate = firstQueryParameter(value);
  return validDirections.has(candidate as CompetitionDirection)
    ? (candidate as CompetitionDirection)
    : ALL_COMPETITION_DIRECTIONS;
}

export function parseCompetitionPage(
  value: string | readonly string[] | undefined
): number {
  const candidate = firstQueryParameter(value).trim();
  if (!positiveIntegerPattern.test(candidate)) return 1;
  return Math.min(Number(candidate), MAX_DIRECTORY_PAGE);
}

export function buildCompetitionDirectoryUrl(
  href: string,
  { query, direction, page = 1 }: CompetitionDirectoryFilters
): string {
  const url = new URL(href);
  const normalizedQuery = parseCompetitionQuery(limitCompetitionQuery(query));

  if (normalizedQuery) {
    url.searchParams.set("q", normalizedQuery);
  } else {
    url.searchParams.delete("q");
  }

  if (direction === ALL_COMPETITION_DIRECTIONS) {
    url.searchParams.delete("direction");
  } else {
    url.searchParams.set("direction", direction);
  }

  const normalizedPage = parseCompetitionPage(String(page));
  if (normalizedPage > 1) {
    url.searchParams.set("page", String(normalizedPage));
  } else {
    url.searchParams.delete("page");
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
