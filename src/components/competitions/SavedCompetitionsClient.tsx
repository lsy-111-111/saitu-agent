"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { CompetitionDetailModal } from "@/components/competitions/CompetitionDetailModal";
import { findCanonicalCatalogCompetition } from "@/lib/competitions/catalog";
import {
  clearSavedCompetitionStore,
  readSavedCompetitionStore,
  removeSavedCompetition,
  savedCompetitionScoreDisplay,
  type SavedCompetitionEntryV2,
  type SavedCompetitionStorageFailure
} from "@/lib/competitions/saved-competitions";
import { trackEvent } from "@/lib/analytics/track";

type StorageNotice = {
  reason: SavedCompetitionStorageFailure;
  message: string;
};

const roleLabels = {
  "best-match": "最匹配",
  practical: "稳妥选择",
  stretch: "挑战选择",
  portfolio: "作品集方向",
  reference: "参考匹配"
} as const;

const recommendationRoleLabels = {
  best: "最匹配",
  steady: "稳妥选择",
  reference: "参考匹配"
} as const;

const rankingSourceLabels = {
  "evidence-rules": "依据已确认条件匹配",
  deepseek: "DeepSeek 综合排序",
  "rule-fallback": "规则降级排序"
} as const;

const savedDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function formatSavedAt(value: string) {
  return savedDateFormatter.format(new Date(value)).replaceAll("/", ".");
}

export function SavedCompetitionsClient() {
  const [entries, setEntries] = useState<SavedCompetitionEntryV2[]>([]);
  const [hydrating, setHydrating] = useState(true);
  const [notice, setNotice] = useState<StorageNotice | null>(null);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string | null>(null);
  const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const emptyStateHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocusRef = useRef<
    { kind: "entry"; competitionId: string } | { kind: "empty" } | null
  >(null);

  const loadEntries = useCallback(() => {
    const result = readSavedCompetitionStore();
    if (result.ok) {
      setEntries(result.value.entries);
      setNotice(null);
    } else {
      setEntries([]);
      setNotice({ reason: result.reason, message: result.message });
    }
    setHydrating(false);
  }, []);

  useEffect(() => loadEntries(), [loadEntries]);

  useEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (!pendingFocus) return;
    pendingFocusRef.current = null;

    if (pendingFocus.kind === "entry") {
      removeButtonRefs.current.get(pendingFocus.competitionId)?.focus({ preventScroll: true });
      return;
    }
    emptyStateHeadingRef.current?.focus({ preventScroll: true });
  }, [entries, hydrating, notice]);

  const selectedCompetition = useMemo(
    () => selectedCompetitionId ? findCanonicalCatalogCompetition(selectedCompetitionId) : null,
    [selectedCompetitionId]
  );

  const removeEntry = useCallback((competitionId: string) => {
    const result = removeSavedCompetition(competitionId);
    if (result.ok) {
      const removedIndex = entries.findIndex((entry) => entry.competitionId === competitionId);
      const nextEntry = result.value.entries[
        Math.min(Math.max(removedIndex, 0), result.value.entries.length - 1)
      ];
      pendingFocusRef.current = nextEntry
        ? { kind: "entry", competitionId: nextEntry.competitionId }
        : { kind: "empty" };
      setEntries(result.value.entries);
      setNotice(null);
      setSelectedCompetitionId((current) => current === competitionId ? null : current);
      return;
    }
    setNotice({ reason: result.reason, message: result.message });
  }, [entries]);

  const clearEntries = useCallback(() => {
    if (!window.confirm("确定清空已保存的全部竞赛吗？此操作无法撤销。")) return;
    const result = clearSavedCompetitionStore();
    if (result.ok) {
      pendingFocusRef.current = { kind: "empty" };
      setEntries([]);
      setNotice(null);
      setSelectedCompetitionId(null);
      return;
    }
    setNotice({ reason: result.reason, message: result.message });
  }, []);

  const cleanCorruptData = useCallback(() => {
    const result = clearSavedCompetitionStore();
    if (result.ok) {
      pendingFocusRef.current = { kind: "empty" };
      setEntries([]);
      setNotice(null);
      return;
    }
    setNotice({ reason: result.reason, message: result.message });
  }, []);

  const showDetails = useCallback((competitionId: string) => {
    setSelectedCompetitionId(competitionId);
    trackEvent("competition_detail_open", { competitionId });
  }, []);

  const trackSourceClick = useCallback((competitionId: string) => {
    trackEvent("competition_source_click", { competitionId });
  }, []);
  const closeDetails = useCallback(() => setSelectedCompetitionId(null), []);
  const setRemoveButtonRef = useCallback((competitionId: string, node: HTMLButtonElement | null) => {
    if (node) removeButtonRefs.current.set(competitionId, node);
    else removeButtonRefs.current.delete(competitionId);
  }, []);

  return (
    <>
      <section aria-labelledby="saved-competitions-title" className="mx-auto w-full max-w-[1240px]">
        <div className="border-b border-border pb-8 md:flex md:items-end md:justify-between md:gap-8 md:pb-10">
          <div>
            <h1 className="font-serif text-4xl font-semibold tracking-[-0.035em] text-ink sm:text-5xl" id="saved-competitions-title">
              我的竞赛
            </h1>
            <p className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">保存在当前浏览器中的竞赛会沿用当时的赛道和推荐理由。每次选赛最多推荐三项。</p>
          </div>
          <Link
            className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline decoration-brand-300 underline-offset-4 hover:text-brand-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500 md:mt-0"
            href="/competitions/recommend"
          >
            打开竞赛助手
            <ArrowRightIcon />
          </Link>
        </div>

        <div className="mt-8 border-b border-border pb-7">
          <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
            <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-[14px] border border-brand-200 bg-white text-brand-700 shadow-[0_8px_24px_rgba(67,56,202,0.06)]">
              <FolderIcon />
            </span>
            <div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="font-serif text-2xl font-semibold text-ink sm:text-3xl">我的竞赛</h2>
                {!hydrating && !notice ? (
                  <span className="text-sm font-semibold text-brand-600">已保存 {entries.length} 项</span>
                ) : null}
              </div>
              <p className="mt-2 max-w-2xl text-xs leading-6 text-muted-foreground">
                仅保存在当前浏览器；清除该站点的浏览器数据后会丢失。
              </p>
            </div>
            {entries.length > 0 && !notice ? (
              <button
                className="min-h-11 justify-self-start rounded-full px-1 text-sm font-semibold text-muted-foreground underline decoration-brand-200 underline-offset-4 transition hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500 sm:justify-self-end"
                onClick={clearEntries}
                type="button"
              >
                清空全部
              </button>
            ) : null}
          </div>
        </div>

        <div aria-live="polite" className="mt-8" data-testid="saved-competitions-content">
          {hydrating ? <SavedLoadingState /> : null}
          {!hydrating && notice ? (
            <SavedStorageError notice={notice} onClean={cleanCorruptData} onRetry={loadEntries} />
          ) : null}
          {!hydrating && !notice && entries.length === 0 ? (
            <SavedEmptyState headingRef={emptyStateHeadingRef} />
          ) : null}
          {!hydrating && !notice && entries.length > 0 ? (
            <ol className="divide-y divide-border border-y border-border" data-testid="saved-competition-list">
              {entries.map((entry, index) => (
                <SavedCompetitionRow
                  entry={entry}
                  key={entry.competitionId}
                  onOpen={showDetails}
                  onRemove={removeEntry}
                  priority={index === 0}
                  removeButtonRef={(node) => setRemoveButtonRef(entry.competitionId, node)}
                />
              ))}
            </ol>
          ) : null}
        </div>
      </section>

      <CompetitionDetailModal
        competition={selectedCompetition}
        onClose={closeDetails}
        onSourceClick={trackSourceClick}
      />
    </>
  );
}

function SavedCompetitionRow({
  entry,
  onOpen,
  onRemove,
  priority,
  removeButtonRef
}: {
  entry: SavedCompetitionEntryV2;
  onOpen: (competitionId: string) => void;
  onRemove: (competitionId: string) => void;
  priority: boolean;
  removeButtonRef: (node: HTMLButtonElement | null) => void;
}) {
  const competition = findCanonicalCatalogCompetition(entry.competitionId);
  const snapshot = entry.recommendation;
  const scoreDisplay = savedCompetitionScoreDisplay(snapshot);
  const savedTrack = snapshot.recommendedTrack;
  const currentTrack = savedTrack && competition?.recommendation.tracks?.find(track => track.id === savedTrack.id);
  const trackText = savedTrack === undefined ? "历史快照未记录赛道"
    : savedTrack === null ? "本次推荐为竞赛系列" : `保存时的赛道：${savedTrack.label}`;
  const trackChanged = savedTrack && currentTrack?.label !== savedTrack.label;

  if (!competition) {
    return (
      <li className="grid gap-5 py-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div>
          <p className="font-semibold text-ink">该竞赛已不在当前目录中</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">保存标识：{entry.competitionId} · {trackText}</p>
        </div>
        <button className="min-h-11 rounded-full border border-control-border px-5 text-sm font-semibold text-ink hover:border-brand-400 hover:text-brand-700" onClick={() => onRemove(entry.competitionId)} ref={removeButtonRef} type="button">移除</button>
      </li>
    );
  }

  return (
    <li className="grid gap-5 py-7 md:grid-cols-[280px_minmax(0,1fr)_auto] md:items-start md:gap-7 lg:grid-cols-[320px_minmax(0,1fr)_auto] lg:py-9" data-testid="saved-competition-item">
      <figure className="min-w-0">
        <div className="relative aspect-[8/3] overflow-hidden rounded-[14px] border border-border bg-brand-50">
          <Image
            alt={competition.coverImage.alt}
            className="object-cover"
            fill
            priority={priority}
            sizes="(min-width: 1024px) 320px, (min-width: 768px) 280px, calc(100vw - 40px)"
            src={competition.coverImage.src}
          />
        </div>
      </figure>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold">
          <span className="text-brand-700">#{snapshot.rank} 推荐</span>
          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-ink/25" />
          <span className="text-muted-foreground">
            {snapshot.recommendationRole
              ? recommendationRoleLabels[snapshot.recommendationRole]
              : roleLabels[snapshot.role]}
          </span>
          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-ink/25" />
          <span className="text-muted-foreground">{rankingSourceLabels[snapshot.rankingSource]}</span>
        </div>
        <h3 className="mt-3 text-xl font-semibold leading-snug tracking-[-0.02em] text-ink sm:text-2xl">{competition.name}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{competition.category} · {trackText}</p>
        {trackChanged && <p className="mt-1 text-xs text-muted-foreground">当前目录中的赛道已有变化，请在竞赛详情核对本届规则。</p>}

        <div className="mt-4 grid gap-3 border-l-2 border-brand-200 pl-4 text-sm leading-6 sm:grid-cols-3">
          <SnapshotList label="推荐理由" values={snapshot.explanation.matchReasons} />
          <SnapshotList label="可能差距" values={snapshot.explanation.possibleGaps} />
          <SnapshotList label="准备建议" values={snapshot.explanation.preparationTips} />
        </div>

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-5 text-muted-foreground">
          {snapshot.rankingSource === "evidence-rules" ? <span>已保存当次选赛依据</span> : scoreDisplay.detailText ? (
            <>
              <span>{scoreDisplay.label} <strong className="font-semibold text-ink">{scoreDisplay.scoreText}</strong></span>
              <span>{scoreDisplay.detailText}</span>
            </>
          ) : (
            <span>{scoreDisplay.label} <strong className="font-semibold text-ink">{scoreDisplay.scoreText}</strong></span>
          )}
          <span>{snapshot.registrationStatus.label}</span>
          <span>保存于 {formatSavedAt(entry.latestSavedAt)}</span>
        </div>
        {snapshot.dataNotices.length > 0 ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{snapshot.dataNotices[0]}</p>
        ) : null}
      </div>

      <div className="flex gap-3 md:min-w-[126px] md:flex-col md:items-stretch">
        <button
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 md:flex-none"
          onClick={() => onOpen(entry.competitionId)}
          type="button"
        >
          查看详情
        </button>
        <button
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-control-border bg-white px-5 text-sm font-semibold text-muted-foreground transition hover:border-brand-400 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 md:flex-none"
          onClick={() => onRemove(entry.competitionId)}
          ref={removeButtonRef}
          type="button"
        >
          移除
        </button>
      </div>
    </li>
  );
}

function SnapshotList({ label, values }: { label: string; values: readonly string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold text-ink">{label}</p>
      <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{values[0] || "本次推荐未提供该项说明。"}</p>
    </div>
  );
}

function SavedLoadingState() {
  return (
    <div className="border-y border-border py-14 text-center" role="status">
      <span className="text-sm text-muted-foreground">正在读取当前浏览器中的竞赛…</span>
    </div>
  );
}

function SavedEmptyState({ headingRef }: { headingRef: Ref<HTMLHeadingElement> }) {
  return (
    <div className="border-y border-border py-14 text-center sm:py-20" data-testid="saved-competitions-empty">
      <span aria-hidden="true" className="mx-auto flex h-16 w-16 items-center justify-center rounded-[18px] border border-brand-200 bg-white text-brand-600 shadow-[0_8px_24px_rgba(67,56,202,0.06)]">
        <FolderIcon />
      </span>
      <h2 className="mt-6 rounded-sm font-serif text-2xl font-semibold text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500" ref={headingRef} tabIndex={-1}>还没有保存的竞赛</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
        每次选赛最多给出三项重点建议，依据不足时也可能没有结果。找到想继续了解的竞赛后，可以在结果页主动保存。
      </p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        <Link className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand-600 px-6 text-sm font-semibold text-white shadow-soft hover:bg-brand-700" href="/competitions/recommend">打开竞赛助手</Link>
        <Link className="inline-flex min-h-12 items-center justify-center rounded-full border border-control-border bg-white px-6 text-sm font-semibold text-ink hover:border-brand-400 hover:text-brand-700" href="/competitions">浏览全部竞赛</Link>
      </div>
    </div>
  );
}

function SavedStorageError({
  notice,
  onClean,
  onRetry
}: {
  notice: StorageNotice;
  onClean: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="border-y border-border py-12 sm:py-16" data-testid="saved-competitions-error" role="alert">
      <div className="max-w-2xl">
        <h2 className="text-xl font-semibold text-ink">暂时无法读取“我的竞赛”</h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">{notice.message}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {notice.reason === "corrupt" ? (
            <button className="min-h-11 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700" onClick={onClean} type="button">清理损坏数据</button>
          ) : null}
          <button className="min-h-11 rounded-full border border-control-border bg-white px-5 text-sm font-semibold text-ink hover:border-brand-400 hover:text-brand-700" onClick={onRetry} type="button">重试</button>
        </div>
      </div>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" fill="none" viewBox="0 0 32 32">
      <path d="M4.5 9.5h8l2.5 3h12.5v10.2a3.3 3.3 0 0 1-3.3 3.3H7.8a3.3 3.3 0 0 1-3.3-3.3V9.5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M4.5 13h23" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg aria-hidden="true" className="ml-2 h-4 w-4" fill="none" viewBox="0 0 20 20">
      <path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}
