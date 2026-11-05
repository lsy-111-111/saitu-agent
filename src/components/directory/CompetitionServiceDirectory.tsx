"use client";

import Image from "next/image";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  CompetitionResourceDetails,
  CompetitionTeamDetails
} from "@/components/competitions/services/CompetitionServiceSummary";
import { AccessibleDirectoryDialog } from "@/components/directory/AccessibleDirectoryDialog";
import type { CompetitionCoverImage, CompetitionDirection } from "@/content/competitions";
import {
  ALL_COMPETITION_DIRECTIONS,
  COMPETITION_QUERY_MAX_LENGTH,
  filterCompetitions,
  limitCompetitionQuery,
  type CompetitionDirectionFilter
} from "@/lib/competitions/directory-filter";
import { teamStatusPresentation } from "@/lib/competitions/service-presentation";
import { resolveCompetitionService } from "@/lib/competitions/service-resolver";
import { trackEvent } from "@/lib/analytics/track";

export type CompetitionDirectoryItem = {
  id: string;
  name: string;
  category: string;
  coverImage: Pick<CompetitionCoverImage, "alt" | "src">;
  direction: CompetitionDirection;
  summary: string;
  sourceUrl?: string;
  verifiedAt?: string;
};

type CompetitionServiceDirectoryProps = {
  competitions: readonly CompetitionDirectoryItem[];
  directions: readonly CompetitionDirection[];
  mode: "resources" | "teams";
};

export function CompetitionServiceDirectory({
  competitions: entries,
  directions,
  mode
}: CompetitionServiceDirectoryProps) {
  const [direction, setDirection] = useState<CompetitionDirectionFilter>(
    ALL_COMPETITION_DIRECTIONS
  );
  const [query, setQuery] = useState("");
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredCompetitions = useMemo(
    () => filterCompetitions(entries, query, direction),
    [direction, entries, query]
  );
  const selectedCompetition = useMemo(
    () =>
      entries.find((competition) => competition.id === selectedCompetitionId) ?? null,
    [entries, selectedCompetitionId]
  );
  const selectedService = useMemo(
    () => selectedCompetition ? resolveCompetitionService(selectedCompetition.id) : null,
    [selectedCompetition]
  );

  const closeDialog = useCallback(() => setSelectedCompetitionId(null), []);
  const directoryId = mode === "resources" ? "resource-directory" : "team-directory";
  const searchId = `${directoryId}-search`;

  const updateQuery = useCallback((value: string) => {
    setQuery(limitCompetitionQuery(value));
  }, []);

  const clearFilters = useCallback(() => {
    setQuery("");
    setDirection(ALL_COMPETITION_DIRECTIONS);
    searchInputRef.current?.focus({ preventScroll: true });
  }, []);

  const clearQuery = useCallback(() => {
    setQuery("");
    searchInputRef.current?.focus({ preventScroll: true });
  }, []);

  const selectCompetition = useCallback((competitionId: string) => {
    setSelectedCompetitionId(competitionId);
    trackEvent(
      mode === "resources" ? "competition_resource_open" : "competition_team_open",
      { competitionId }
    );
  }, [mode]);

  return (
    <section
      aria-labelledby={`${directoryId}-title`}
      className="pt-8"
      id={directoryId}
    >
      <div className={mode === "teams" ? "max-w-[785px]" : "max-w-2xl"} role="search">
        <label className="sr-only" htmlFor={searchId}>
          {mode === "resources" ? "搜索竞赛名称、方向或简介" : "搜索竞赛名称或简介"}
        </label>
        <div className="relative">
          <SearchIcon />
          <input
            className="min-h-12 w-full rounded-lg border border-control-border bg-white py-3 pl-12 pr-12 text-base text-ink outline-none placeholder:text-muted-foreground/70 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            id={searchId}
            maxLength={COMPETITION_QUERY_MAX_LENGTH}
            onChange={(event) => updateQuery(event.currentTarget.value)}
            placeholder={
              mode === "resources" ? "搜索竞赛名称、方向或简介" : "搜索竞赛名称"
            }
            ref={searchInputRef}
            type="search"
            value={query}
          />
          {query ? (
            <button
              aria-label="清除搜索"
              className="absolute inset-y-0 right-0 inline-flex min-h-12 min-w-12 items-center justify-center text-muted-foreground hover:text-brand-700"
              onClick={clearQuery}
              type="button"
            >
              <CloseSmallIcon />
            </button>
          ) : null}
        </div>
      </div>

      {mode === "resources" ? (
        <div aria-label="按竞赛方向筛选" className="mt-5 flex gap-2 overflow-x-auto pb-2" role="group">
          {([ALL_COMPETITION_DIRECTIONS, ...directions] as const).map((option) => {
            const active = option === direction;
            return (
              <button
                aria-pressed={active}
                className={`min-h-9 shrink-0 rounded-lg border px-4 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${active ? "border-brand-600 bg-brand-600 text-white" : "border-border bg-white text-ink/80 hover:border-brand-300 hover:bg-brand-50"}`}
                key={option}
                onClick={() => setDirection(option)}
                type="button"
              >
                {option}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="mt-8 flex items-end justify-between gap-4 border-b border-directory-divider pb-4">
        <h2
          className="font-serif text-2xl font-semibold tracking-[-0.02em] text-ink"
          id={`${directoryId}-title`}
        >
          {mode === "resources" ? "竞赛目录" : "组队目录"}
        </h2>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          共 <span className="font-semibold text-ink">{filteredCompetitions.length}</span> 项
        </p>
      </div>

      {filteredCompetitions.length > 0 ? (
        mode === "resources" ? (
          <ResourceDirectoryList
            competitions={filteredCompetitions}
            onSelect={selectCompetition}
          />
        ) : (
          <TeamDirectoryList
            competitions={filteredCompetitions}
            onSelect={selectCompetition}
          />
        )
      ) : (
        <div className="border-b border-dashed border-directory-divider bg-white px-6 py-14 text-center">
          <p className="font-serif text-2xl font-semibold text-ink">暂未找到匹配的竞赛</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {mode === "resources"
              ? "可以换一个关键词，或清除当前筛选后查看全部竞赛。"
              : "可以换一个关键词，或清除搜索后查看全部竞赛。"}
          </p>
          <button
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-button border border-brand-500 bg-white px-5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            onClick={clearFilters}
            type="button"
          >
            {mode === "resources" ? "清除搜索与筛选" : "清除搜索"}
          </button>
        </div>
      )}

      <AccessibleDirectoryDialog
        description={
          mode === "resources"
            ? "查看该竞赛计划提供的资源类型"
            : "查看该竞赛的组队入口状态"
        }
        onClose={closeDialog}
        open={Boolean(selectedCompetition)}
        title={selectedCompetition?.name ?? "竞赛信息"}
      >
        {selectedCompetition && selectedService ? (
          mode === "resources" ? (
            <>
              <CompetitionResourceDetails resources={selectedService.resources} />
              <DirectorySourceLink
                sourceUrl={selectedService.sourceUrl}
                verifiedAt={selectedService.verifiedAt}
              />
            </>
          ) : (
            <>
              <CompetitionTeamDetails
                availability={selectedService.team}
                name={selectedService.name}
              />
              <DirectorySourceLink
                sourceUrl={selectedService.sourceUrl}
                verifiedAt={selectedService.verifiedAt}
              />
            </>
          )
        ) : null}
      </AccessibleDirectoryDialog>
    </section>
  );
}

type DirectoryListProps = {
  competitions: readonly CompetitionDirectoryItem[];
  onSelect: (competitionId: string) => void;
};

const directoryRowClassName =
  "group relative flex w-full items-center text-left transition-colors duration-150 hover:bg-slate-50 focus-visible:z-10 focus-visible:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-500";

function resourceDividerClassName(index: number, count: number) {
  const isLastMobileItem = index === count - 1;
  const desktopLastRowStart = count - (count % 2 || 2);
  const isInLastDesktopRow = index >= desktopLastRowStart;

  return [
    isLastMobileItem ? "border-b-0" : "border-b border-directory-divider",
    isInLastDesktopRow
      ? "lg:border-b-0"
      : "lg:border-b lg:border-directory-divider"
  ].join(" ");
}

function ResourceDirectoryList({ competitions: entries, onSelect }: DirectoryListProps) {
  return (
    <div className="grid lg:grid-cols-2" data-testid="resource-directory-list">
      {entries.map((competition, index) => (
        <button
          aria-label={`查看资源：${competition.name}；${competition.direction} · ${competition.category}`}
          className={`${directoryRowClassName} min-h-[78px] gap-4 px-2 py-4 lg:odd:pr-6 lg:even:pl-6 ${resourceDividerClassName(index, entries.length)}`}
          data-testid="resource-directory-item"
          key={competition.id}
          onClick={() => onSelect(competition.id)}
          type="button"
        >
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-[15px] font-semibold leading-6 text-ink/90 transition-colors group-hover:text-brand-700">
              {competition.name}
            </span>
            <span className="mt-1 block truncate text-xs leading-5 text-muted-foreground">
              {competition.direction} · {competition.category}
            </span>
          </span>
          <ArrowIcon />
        </button>
      ))}
    </div>
  );
}

function TeamDirectoryList({ competitions: entries, onSelect }: DirectoryListProps) {
  return (
    <div className="bg-white" data-testid="team-directory-list">
      {entries.map((competition, index) => {
        const team = resolveCompetitionService(competition.id).team;
        const status = teamStatusPresentation[team.status];
        const actionLabel = team.status === "open" ? "查看组队入口" : "查看入口状态";

        return (
          <button
            aria-label={`查看组队入口状态：${competition.name}；${status.label}`}
            className={`${directoryRowClassName} min-h-[100px] gap-4 px-2 py-4 sm:gap-5 sm:px-4 md:min-h-[112px] ${
              index === entries.length - 1
                ? "border-b-0"
                : "border-b border-directory-divider"
            }`}
            data-testid="team-directory-item"
            key={competition.id}
            onClick={() => onSelect(competition.id)}
            type="button"
          >
            <span className="relative aspect-[8/3] w-24 shrink-0 overflow-hidden rounded-lg bg-brand-50 sm:w-28 md:w-32 lg:w-40" data-testid="team-cover-frame">
              <Image
                alt=""
                className="object-contain"
                data-testid="team-cover-image"
                fill
                sizes="(min-width: 1024px) 160px, (min-width: 768px) 128px, (min-width: 640px) 112px, 96px"
                src={competition.coverImage.src}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 font-semibold leading-6 text-ink transition-colors group-hover:text-brand-700">
                {competition.name}
              </span>
              <span className="mt-1 hidden line-clamp-1 text-sm leading-6 text-muted-foreground md:block">
                {competition.summary}
              </span>
              <span className={`mt-2 inline-flex items-center gap-2 text-xs font-medium ${status.textClassName}`}>
                <i aria-hidden="true" className={`h-2 w-2 rounded-full ${status.dotClassName}`} />
                {status.label}
              </span>
            </span>
            <span className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 text-sm font-semibold text-brand-700">
              <span className="hidden md:inline">{actionLabel}</span>
              <ArrowIcon />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DirectorySourceLink({ sourceUrl, verifiedAt }: { sourceUrl?: string; verifiedAt?: string }) {
  if (!sourceUrl) return null;

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
      <span className="text-muted-foreground">
        信息来源{verifiedAt ? ` · 核验于 ${verifiedAt}` : ""}
      </span>
      {sourceUrl ? (
        <a
          className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-4 hover:decoration-brand-700"
          href={sourceUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          查看竞赛公开来源 ↗
        </a>
      ) : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground/65"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.7" />
      <path d="m16 16 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

function CloseSmallIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-muted-foreground/70 transition group-hover:translate-x-0.5 group-hover:text-brand-600 motion-reduce:transform-none"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
