"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompetitionCard } from "@/components/competitions/CompetitionCard";
import { CompetitionDetailModal } from "@/components/competitions/CompetitionDetailModal";
import { CompetitionTrustNotice } from "@/components/competitions/CompetitionTrustNotice";
import { AccessibleDirectoryDialog } from "@/components/directory/AccessibleDirectoryDialog";
import { competitionDirections, competitions } from "@/content/competitions";
import { trackEvent } from "@/lib/analytics/track";
import {
  ALL_COMPETITION_DIRECTIONS,
  COMPETITION_QUERY_MAX_LENGTH,
  buildCompetitionDirectoryUrl,
  filterCompetitions,
  limitCompetitionQuery,
  type CompetitionDirectionFilter
} from "@/lib/competitions/search";

const COMPETITIONS_PER_PAGE = 12;
const directionOptions = [ALL_COMPETITION_DIRECTIONS, ...competitionDirections] as const;

type CompetitionBoardProps = {
  availabilityAsOfMs?: number;
  initialDirection?: CompetitionDirectionFilter;
  initialPage?: number;
  initialQuery?: string;
};

export function CompetitionBoard({
  availabilityAsOfMs,
  initialDirection = ALL_COMPETITION_DIRECTIONS,
  initialPage = 1,
  initialQuery = ""
}: CompetitionBoardProps = {}) {
  const [direction, setDirection] = useState<CompetitionDirectionFilter>(initialDirection);
  const [query, setQuery] = useState(() => limitCompetitionQuery(initialQuery));
  const [page, setPage] = useState(() => Math.max(1, initialPage));
  const [openCompetitionId, setOpenCompetitionId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftDirection, setDraftDirection] = useState<CompetitionDirectionFilter>(initialDirection);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsStartRef = useRef<HTMLParagraphElement>(null);
  const paginationScrollPendingRef = useRef(false);
  const availabilityNow = useMemo(
    () => availabilityAsOfMs === undefined ? undefined : new Date(availabilityAsOfMs),
    [availabilityAsOfMs]
  );

  const filteredCompetitions = useMemo(
    () => filterCompetitions(competitions, query, direction),
    [direction, query]
  );
  const pageCount = Math.max(1, Math.ceil(filteredCompetitions.length / COMPETITIONS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const firstVisibleIndex = (currentPage - 1) * COMPETITIONS_PER_PAGE;
  const visibleCompetitions = filteredCompetitions.slice(
    firstVisibleIndex,
    firstVisibleIndex + COMPETITIONS_PER_PAGE
  );

  const openCompetition = useMemo(
    () => competitions.find((competition) => competition.id === openCompetitionId) ?? null,
    [openCompetitionId]
  );

  const replaceDirectoryUrl = useCallback(
    (nextQuery: string, nextDirection: CompetitionDirectionFilter, nextPage: number) => {
      const nextUrl = buildCompetitionDirectoryUrl(window.location.href, {
        query: nextQuery,
        direction: nextDirection,
        page: nextPage
      });
      window.history.replaceState(window.history.state, "", nextUrl);
    },
    []
  );

  useEffect(() => {
    if (page === currentPage) return;
    paginationScrollPendingRef.current = false;
    setPage(currentPage);
    replaceDirectoryUrl(query, direction, currentPage);
  }, [currentPage, direction, page, query, replaceDirectoryUrl]);

  useEffect(() => {
    if (!paginationScrollPendingRef.current) return;
    paginationScrollPendingRef.current = false;

    const frame = window.requestAnimationFrame(() => {
      const target = resultsStartRef.current;
      if (!target) return;

      target.focus({ preventScroll: true });
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [currentPage]);

  const updateQuery = useCallback(
    (nextQuery: string) => {
      const limitedQuery = limitCompetitionQuery(nextQuery);
      paginationScrollPendingRef.current = false;
      setQuery(limitedQuery);
      setPage(1);
      setOpenCompetitionId(null);
      replaceDirectoryUrl(limitedQuery, direction, 1);
    },
    [direction, replaceDirectoryUrl]
  );

  const selectDirection = useCallback(
    (nextDirection: CompetitionDirectionFilter) => {
      paginationScrollPendingRef.current = false;
      setDirection(nextDirection);
      setDraftDirection(nextDirection);
      setPage(1);
      setOpenCompetitionId(null);
      replaceDirectoryUrl(query, nextDirection, 1);
    },
    [query, replaceDirectoryUrl]
  );

  const resetFilters = useCallback(() => {
    paginationScrollPendingRef.current = false;
    setQuery("");
    setDirection(ALL_COMPETITION_DIRECTIONS);
    setDraftDirection(ALL_COMPETITION_DIRECTIONS);
    setPage(1);
    setOpenCompetitionId(null);
    replaceDirectoryUrl("", ALL_COMPETITION_DIRECTIONS, 1);
    resultsStartRef.current?.focus({ preventScroll: true });
  }, [replaceDirectoryUrl]);

  const clearQuery = useCallback(() => {
    updateQuery("");
    searchInputRef.current?.focus({ preventScroll: true });
  }, [updateQuery]);

  const goToPage = useCallback(
    (nextPage: number) => {
      const normalizedPage = Math.min(Math.max(1, nextPage), pageCount);
      if (normalizedPage === currentPage) return;

      paginationScrollPendingRef.current = true;
      setPage(normalizedPage);
      setOpenCompetitionId(null);
      replaceDirectoryUrl(query, direction, normalizedPage);
    },
    [currentPage, direction, pageCount, query, replaceDirectoryUrl]
  );

  const showCompetition = useCallback((competitionId: string) => {
    setOpenCompetitionId(competitionId);
    trackEvent("competition_detail_open", { competitionId });
  }, []);
  const closeCompetition = useCallback(() => setOpenCompetitionId(null), []);
  const trackSourceClick = useCallback((competitionId: string) => {
    trackEvent("competition_source_click", { competitionId });
  }, []);

  const openFilters = useCallback(() => {
    setDraftDirection(direction);
    setFilterOpen(true);
  }, [direction]);
  const closeFilters = useCallback(() => setFilterOpen(false), []);
  const applyFilters = useCallback(() => {
    setFilterOpen(false);
    selectDirection(draftDirection);
  }, [draftDirection, selectDirection]);

  const visibleRangeStart = filteredCompetitions.length === 0 ? 0 : firstVisibleIndex + 1;
  const visibleRangeEnd = firstVisibleIndex + visibleCompetitions.length;

  return (
    <section aria-labelledby="competition-directory-title" className="mt-8">
      <h2 className="sr-only" id="competition-directory-title">竞赛目录</h2>

      <div aria-labelledby="competition-search-label" className="mt-5 rounded-card border border-control-border bg-card p-4 shadow-[0_8px_22px_rgba(49,46,129,0.04)] sm:p-5" role="search">
        <label className="text-sm font-semibold text-ink" htmlFor="competition-search" id="competition-search-label">
          搜索竞赛
        </label>
        <p className="mt-1 text-xs leading-5 text-muted-foreground" id="competition-search-help">
          可搜索竞赛名称、类别、方向或简介，多个关键词需同时匹配。
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <SearchIcon />
            <input
              aria-controls="competition-grid"
              aria-describedby="competition-search-help"
              className="min-h-12 w-full rounded-field border border-control-border bg-paper py-2.5 pl-11 pr-12 text-base text-ink outline-none placeholder:text-muted-foreground/75 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              enterKeyHint="search"
              id="competition-search"
              inputMode="search"
              maxLength={COMPETITION_QUERY_MAX_LENGTH}
              onChange={(event) => updateQuery(event.currentTarget.value)}
              placeholder="例如：AI 应用、IOT 传感器、飞行器"
              role="searchbox"
              ref={searchInputRef}
              type="text"
              value={query}
            />
            {query ? (
              <button aria-label="清除搜索" className="absolute inset-y-0 right-0 inline-flex min-h-12 min-w-12 items-center justify-center rounded-field text-muted-foreground hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-brand-500" onClick={clearQuery} type="button">
                <ClearIcon />
              </button>
            ) : null}
          </div>
          <button aria-expanded={filterOpen} aria-haspopup="dialog" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-field border border-control-border bg-white px-5 text-sm font-semibold text-ink transition hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700" onClick={openFilters} type="button">
            <FilterIcon />
            筛选
            {direction !== ALL_COMPETITION_DIRECTIONS ? (
              <span aria-label="已启用 1 项筛选" className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] text-white">1</span>
            ) : null}
          </button>
        </div>
      </div>

      <div aria-label="竞赛方向快捷筛选" className="mt-5 flex gap-3 overflow-x-auto pb-2" role="group">
        {directionOptions.map((option) => {
          const active = direction === option;
          return (
            <button
              aria-label={option}
              aria-pressed={active}
              className={`min-h-[72px] min-w-[150px] shrink-0 rounded-card border px-4 py-3 text-left text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${active ? "border-brand-500 bg-brand-50 text-brand-700 shadow-[0_8px_20px_rgba(67,56,202,0.08)]" : "border-border bg-white text-ink/80 hover:border-brand-300 hover:bg-brand-50/55"}`}
              key={option}
              onClick={() => selectDirection(option)}
              type="button"
            >
              <span className="block">{option}</span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">{active ? "当前方向" : "查看该方向"}</span>
            </button>
          );
        })}
      </div>

      <p
        aria-atomic="true"
        aria-live="polite"
        className="mt-3 scroll-mt-4 rounded-sm text-sm text-muted-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500 md:scroll-mt-6"
        data-testid="competition-result-summary"
        ref={resultsStartRef}
        tabIndex={-1}
      >
        展示 <span className="font-semibold text-ink">{visibleRangeStart}-{visibleRangeEnd}</span>
        {" / "}{filteredCompetitions.length} 项符合条件的内容
      </p>

      {visibleCompetitions.length > 0 ? (
        <>
          <div className="mt-4 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="competition-grid" id="competition-grid">
            {visibleCompetitions.map((competition) => (
              <CompetitionCard availabilityNow={availabilityNow} competition={competition} key={competition.id} onOpen={showCompetition} />
            ))}
          </div>
          {pageCount > 1 ? <Pagination currentPage={currentPage} onPageChange={goToPage} pageCount={pageCount} /> : null}
        </>
      ) : (
        <div className="mt-8 rounded-card border border-dashed border-control-border bg-card px-6 py-12 text-center" data-testid="competition-empty-state" id="competition-grid">
          <h3 className="text-xl font-semibold text-ink">没有找到符合条件的竞赛</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">可以换一个关键词，或清除搜索和方向筛选后查看全部竞赛。</p>
          <button className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full border border-brand-500 px-5 text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" onClick={resetFilters} type="button">
            清除搜索与筛选
          </button>
        </div>
      )}

      <div className="mt-7"><CompetitionTrustNotice /></div>

      <AccessibleDirectoryDialog description="选择一个竞赛方向筛选目录" onClose={closeFilters} open={filterOpen} title="筛选竞赛方向">
        <fieldset>
          <legend className="text-sm font-semibold text-ink">竞赛方向</legend>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {directionOptions.map((option) => (
              <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium ${draftDirection === option ? "border-brand-500 bg-brand-50 text-brand-700" : "border-border bg-white text-ink hover:border-brand-300"}`} key={option}>
                <input checked={draftDirection === option} className="h-4 w-4 accent-brand-600" name="competition-direction" onChange={() => setDraftDirection(option)} type="radio" value={option} />
                {option}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-6 grid gap-3 border-t border-border pt-5 sm:grid-cols-2">
          <button className="inline-flex min-h-12 items-center justify-center rounded-button border border-control-border bg-white px-5 text-sm font-semibold text-ink hover:border-brand-500 hover:bg-brand-50" onClick={() => setDraftDirection(ALL_COMPETITION_DIRECTIONS)} type="button">清除方向筛选</button>
          <button className="inline-flex min-h-12 items-center justify-center rounded-button bg-brand-gradient px-5 text-sm font-semibold text-white shadow-soft" onClick={applyFilters} type="button">应用筛选</button>
        </div>
      </AccessibleDirectoryDialog>

      <CompetitionDetailModal availabilityNow={availabilityNow} competition={openCompetition} onClose={closeCompetition} onSourceClick={trackSourceClick} />
    </section>
  );
}

type PaginationProps = {
  currentPage: number;
  onPageChange: (page: number) => void;
  pageCount: number;
};

function Pagination({ currentPage, onPageChange, pageCount }: PaginationProps) {
  return (
    <nav aria-label="竞赛分页" className="mt-8 flex flex-wrap items-center justify-center gap-2">
      <button aria-label="上一页" className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-control-border bg-white text-ink disabled:cursor-not-allowed disabled:opacity-40" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)} type="button">
        <PaginationArrow direction="previous" />
      </button>
      {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
        <button aria-current={pageNumber === currentPage ? "page" : undefined} aria-label={`第 ${pageNumber} 页`} className={`inline-flex h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-sm font-semibold ${pageNumber === currentPage ? "border-brand-600 bg-brand-600 text-white" : "border-control-border bg-white text-ink hover:border-brand-500 hover:bg-brand-50"}`} key={pageNumber} onClick={() => onPageChange(pageNumber)} type="button">
          {pageNumber}
        </button>
      ))}
      <button aria-label="下一页" className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-control-border bg-white text-ink disabled:cursor-not-allowed disabled:opacity-40" disabled={currentPage === pageCount} onClick={() => onPageChange(currentPage + 1)} type="button">
        <PaginationArrow direction="next" />
      </button>
    </nav>
  );
}

function PaginationArrow({ direction }: { direction: "next" | "previous" }) {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d={direction === "next" ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function SearchIcon() {
  return <svg aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" /><path d="m16 16 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

function ClearIcon() {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

function FilterIcon() {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}
