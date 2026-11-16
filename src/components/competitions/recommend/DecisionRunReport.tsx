"use client";

import Link from "next/link";
import { useState } from "react";
import { saveSelectedRunDecisions } from "@/lib/competitions/v6/saved-decisions";
import type { RecommendationListItemV7, RecommendationRunV7 } from "@/lib/competitions/v7/contracts";
import { CompactDecisionDetails } from "./CompactDecisionDetails";
import type { FixedQuestionTurn } from "./questionFlow";

const box = "rounded-2xl border border-border bg-white p-5";
const button = "inline-flex min-h-11 items-center justify-center rounded-full border border-brand-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 disabled:opacity-40";

function RunCard({ item, run, selected, onSelect, updatesEnded }: {
  item: RecommendationListItemV7; run: RecommendationRunV7; selected: boolean; onSelect: (checked: boolean) => void; updatesEnded: boolean;
}) {
  return <article className={box} data-testid="recommendation-run-item" data-item-id={item.itemId} data-detail-status={item.detailStatus}>
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700">{item.rank}</span>
      <div className="min-w-0 flex-1"><h3 className="text-base font-semibold leading-6 text-ink">{item.name}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{[item.trackLabel, item.edition].filter(Boolean).join(" · ")}</p>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {item.officialUrl ? <a href={item.officialUrl} target="_blank" rel="noopener noreferrer" aria-label={`查看官网：${item.name}`} className={button}>查看官网</a> : <span className="text-xs text-muted-foreground">官网链接暂缺</span>}
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-brand-700"><input type="checkbox" checked={selected} onChange={event => onSelect(event.target.checked)} />选择收藏这一项<span className="sr-only">：{item.name}</span></label>
      <a href="#decision-chat-input-v7" aria-label={`追问乐乐：${item.name}`} className="min-h-11 py-3 text-sm font-semibold text-brand-700 underline underline-offset-4">追问乐乐</a>
    </div>
    <details className="mt-3 border-t border-border pt-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-brand-700">查看比赛详情<span className="sr-only">：{item.name}</span></summary>
      <div className="pt-3">
        {item.detailStatus === "ready" && item.detail ? <CompactDecisionDetails item={item.detail} profile={run.profile ?? run.report?.profile} /> :
          item.detailStatus === "failed" || updatesEnded ? <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6" role="status">这项比赛的详细说明暂未完成，本次更新已结束。其他比赛仍可查看，也可以先核查官网或重新匹配。</p> :
            <p className="rounded-xl bg-brand-50 p-4 text-sm leading-6" role="status">这项比赛的匹配理由还在准备，完成后会自动显示。你可以先查看官网或其他比赛。</p>}
      </div>
    </details>
  </article>;
}

type DecisionRunReportProps = {
  run: RecommendationRunV7; displayRun: RecommendationRunV7 | null; pollError: string; onRetry: () => void;
  onRematch?: () => void;
  turns: readonly FixedQuestionTurn[]; onEdit: (index: number) => void; submitting?: boolean; requestFailed?: boolean;
};

export function DecisionRunReport(props: DecisionRunReportProps) {
  return <DecisionRunReportView key={(props.displayRun ?? props.run).runId} {...props} />;
}

function DecisionRunReportView({ run, displayRun, pollError, onRetry, onRematch, turns, onEdit, submitting = false, requestFailed = false }: DecisionRunReportProps) {
  const shown = displayRun ?? run;
  const [showAll, setShowAll] = useState(false);
  const [saveIds, setSaveIds] = useState<string[]>([]);
  const [saveNotice, setSaveNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [editIndex, setEditIndex] = useState(0);
  const staleList = shown.runId !== run.runId || submitting;
  const noSupported = run.status === "failed" && run.error === "NO_SUPPORTED_RECOMMENDATIONS";
  const items = noSupported ? [] : shown.items;
  const visible = showAll ? items : items.slice(0, 5);
  const readyCount = items.filter(item => item.detailStatus === "ready").length;
  const selectedItems = items.filter(item => saveIds.includes(item.itemId));
  const canSave = selectedItems.length > 0 && selectedItems.every(item => item.detailStatus === "ready");
  const failed = run.status === "failed" || run.status === "expired" || run.status === "superseded";
  const emptyReady = shown.status === "ready" && items.length === 0 && !staleList && !noSupported;
  // A delivered shortlist proves its count, not a model's blanket account of
  // every unselected candidate. Keep the original reason in the run/API only.
  const shortfallNotice = shown.shortfallReason
    ? items.length > 0 && items.length < 5
      ? `当前显示 ${items.length} 项推荐，可修改回答或向乐乐追问。`
      : items.length > 0 || emptyReady ? shown.shortfallReason : null
    : null;

  return <div className="space-y-5" data-testid="decision-report-v7" data-run-id={run.runId} data-display-run-id={shown.runId} data-run-status={run.status} data-policy-version={shown.policyVersion} data-total-items={items.length}>
    <details className={`${box} py-3`} data-testid="compact-answer-edit"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-brand-700">修改回答</summary><label className="mt-2 block text-sm font-semibold" htmlFor="decision-edit-field-v7">想修改目标、经历或投入条件？</label><div className="mt-3 flex flex-wrap gap-3"><select id="decision-edit-field-v7" className="max-w-full rounded-lg border border-control-border bg-white p-3 text-sm" value={editIndex} onChange={event => setEditIndex(Number(event.target.value))}>{turns.map((turn, index) => <option key={turn.id} value={index}>{turn.prompt}</option>)}</select><button type="button" className={button} onClick={() => onEdit(editIndex)}>修改后重新匹配</button></div></details>
    <section className="rounded-2xl border border-brand-300 bg-brand-50/50 p-5 md:p-6">
      <h2 id="recommendation-results-title" className="font-serif text-2xl font-semibold">{noSupported ? "本次未能生成可核实的推荐" : items.length ? "这些竞赛值得你了解" : emptyReady ? "暂时没有合适的竞赛" : failed ? "这次匹配暂未完成" : "正在为你整理竞赛名单"}</h2>
      <p className="mt-3 text-sm leading-6">{items.length ? `共 ${items.length} 项，展开了解比赛任务、匹配理由与收获。` : emptyReady ? "根据你当前的回答，暂时没有找到有充分依据的推荐。" : failed ? "你的答案仍可回看，可修改回答后重新匹配。" : "名单会先显示，详细理由会继续准备并自动更新。"}</p>
      {items.length > 5 ? <p className="mt-2 text-xs leading-5 text-muted-foreground">这是一份历史推荐记录，先显示前5项，其余可按需展开。</p> : null}
      <p className="mt-2 text-xs leading-5 text-muted-foreground">参赛资格和开赛时间请自行核查官网</p>
      <p className="mt-3 text-sm leading-6 text-brand-700" role="status" data-testid="recommendation-run-progress">
        {submitting ? "正在按更新后的画像重新匹配，先保留上次交付的名单。" : failed || requestFailed ? (items.length ? staleList ? "本次更新未完成。下方为上次推荐及详情，尚未按本次更正更新。" : "本次更新未能全部完成，已显示的名单和详情仍可查看。" : "这次匹配未能完成，可以重新匹配。") : staleList ? "正在按更新后的画像重新匹配，先保留上次交付的名单。" :
          run.status === "ready" ? "本次匹配已完成。" : items.length ? `候选名单已显示，详细说明已完成 ${readyCount}/${items.length} 项。最终名单会保留有充分依据的项目。` : "正在比较你自报的目标、能力与投入条件。"}
      </p>
      {pollError ? <div className="mt-3 text-sm leading-6" role="status"><p>{pollError}</p>{!failed || requestFailed ? <button type="button" className="min-h-11 font-semibold text-brand-700 underline disabled:opacity-40" disabled={submitting} onClick={onRetry}>{requestFailed ? "重试这次匹配" : "立即恢复更新"}</button> : null}</div> : null}
      {failed && onRematch && !requestFailed ? <button type="button" className={`${button} mt-3`} disabled={submitting} onClick={onRematch}>{submitting ? "正在重新匹配…" : run.status === "failed" ? "重新匹配" : "回看答案并重新匹配"}</button> : null}
    </section>

    <section aria-label="竞赛推荐名单" className="space-y-3">
      {visible.map(item => <RunCard key={item.itemId} item={item} run={shown} updatesEnded={staleList || failed} selected={saveIds.includes(item.itemId)} onSelect={checked => setSaveIds(current => checked ? [...current, item.itemId] : current.filter(id => id !== item.itemId))} />)}
      {shortfallNotice ? <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6" data-testid="recommendation-shortfall">{shortfallNotice}</p> : null}
      {items.length > 5 ? <button type="button" className={button} onClick={() => setShowAll(value => !value)}>{showAll ? "收起到前 5 项" : `查看其余 ${items.length - 5} 项`}</button> : null}
    </section>

    {items.length ? <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={button} disabled={!canSave} onClick={() => {
          const result = saveSelectedRunDecisions(shown, selectedItems.map(item => item.itemId));
          setSaveNotice({ ok: result.ok, message: result.ok ? `已收藏所选 ${selectedItems.length} 项。` : result.message });
        }}>收藏所选 {selectedItems.length} 项</button>
        <Link className="min-h-11 py-3 text-sm font-semibold text-brand-700 underline" href="/competitions/saved">打开我的竞赛</Link>
      </div>
      {selectedItems.length > 0 && !canSave ? <p className="text-xs leading-5 text-muted-foreground">所选比赛的详情完成后即可收藏。</p> : null}
      {saveNotice ? <p role={saveNotice.ok ? "status" : "alert"} className="text-sm">{saveNotice.message}</p> : null}
    </div> : null}
  </div>;
}
