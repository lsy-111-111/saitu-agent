import Link from "next/link";
import { useState } from "react";
import { competitions } from "@/content/competitions";
import { findCanonicalCatalogCompetition } from "@/lib/competitions/catalog";
import { getCompetitionFactSheet } from "@/content/competition-facts";
import { getDocumentedCompetitionAvailability } from "@/lib/competitions/documented-availability";
import { clearSavedCompetitionStore, saveRecommendationResult, type SavedCompetitionStorageFailure } from "@/lib/competitions/saved-competitions";
import type { CompetitionRecommendationResponseV5 } from "@/types/competition-recommendation";
import type { FixedQuestionTurn } from "./questionFlow";

const box = "rounded-2xl border border-border bg-white px-5 py-4";
const disclosure = "cursor-pointer py-1 font-semibold text-brand-700";

function RegistrationMonthReference({ items }: { items: CompetitionRecommendationResponseV5["recommendations"] }) {
  const [asOf, setAsOf] = useState<Date | null>(null);
  if (!items.length) return null;
  const month = asOf && new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit"
  }).format(asOf);
  return <details className={box} onToggle={event => {
    if (event.currentTarget.open) setAsOf(new Date());
  }}>
    <summary className={disclosure}>这个月能报名吗？</summary>
    {asOf && month && <div className="mt-3" data-testid="monthly-registration-reference">
      <p className="text-sm text-muted-foreground">{month} · 以下是本次推荐对应的届次和已核实节点。校内选拔、赛区和赛道可能有各自的截止时间。</p>
      <ol className="mt-3 divide-y divide-border">{items.map(item => {
        const facts = getCompetitionFactSheet(item.competitionId);
        const competition = findCanonicalCatalogCompetition(item.competitionId);
        const status = competition && getDocumentedCompetitionAvailability(competition, asOf).registrationStatus;
        const nodes = facts?.nodes ?? [];
        const thisMonth = nodes.filter(node => node.date.startsWith(month));
        const source = facts?.sources[0];
        return <li key={item.competitionId} className="py-3 text-sm leading-6" data-monthly-series={item.competitionId}>
          <h3 className="font-semibold text-ink">{item.name}</h3>
          <p className="text-xs text-muted-foreground">{facts ? `${facts.edition} · 资料核查于 ${facts.checkedAt}` : "当前届次和核查时间待确认"}</p>
          <p className="mt-1">{status?.status === "open" && facts
            ? "官方全国报名窗口目前开放，个人参赛资格和本校提交时间仍须核实。"
            : thisMonth.length ? "本月有以下安排，能否报名请核对节点类型及适用范围。"
            : "尚未查到能确认你本人本月可以报名的通知。"}</p>
          {nodes.length > 0 && <ul className="mt-1 space-y-1">{(thisMonth.length ? thisMonth : nodes).map((node, index) =>
            <li key={index}><a href={node.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 underline underline-offset-2">
              {node.date} · {node.kind}</a> · {node.scope}</li>)}</ul>}
          <a href={source?.url || item.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-brand-700 underline underline-offset-2">
            {source?.title || "核对赛事公开来源"}</a>
        </li>;
      })}</ol>
    </div>}
  </details>;
}

export function SelectionResultActions({ result, turns, editTurn, openDetails }: {
  result: CompetitionRecommendationResponseV5;
  turns: readonly FixedQuestionTurn[];
  editTurn: (index: number) => void;
  openDetails: (id: string) => void;
}) {
  const [lookup, setLookup] = useState("");
  const [editIndex, setEditIndex] = useState(0);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<{reason: SavedCompetitionStorageFailure; message: string} | null>(null);
  const selectedIds = new Set(result.recommendations.map(item => item.competitionId));
  const candidates = [...result.recommendations, ...(result.alternatives ?? [])];
  const found = lookup.trim() ? competitions.filter(item =>
    [item.name, ...(item.identity.aliases ?? [])].some(name => name.toLowerCase().includes(lookup.trim().toLowerCase()))
  ).slice(0, 10) : [];
  function save() {
    const outcome = saveRecommendationResult(result);
    if (outcome.ok) window.location.assign("/competitions/saved");
    else setSaveError(outcome);
  }
  function clearDamaged() {
    if (saveError?.reason === "quota" && !window.confirm("确定清理当前浏览器中已保存的竞赛吗？")) return;
    const outcome = clearSavedCompetitionStore();
    setSaveError(outcome.ok ? null : outcome);
  }
  return <div className="mt-5 grid gap-3">
    <RegistrationMonthReference items={result.recommendations} />
    {Boolean(result.alternatives?.length) && <details className={box}><summary className={disclosure}>展开更多候选</summary>
      <ul className="mt-3 space-y-3">{result.alternatives?.map(item => <li key={item.competitionId}>
        <button className="font-semibold text-brand-700 underline underline-offset-2" type="button" onClick={() => openDetails(item.competitionId)}>{item.name}</button>
        <p className="mt-1 text-sm text-muted-foreground">{item.reason}</p></li>)}</ul></details>}
    {candidates.length > 1 && <details className={box}><summary className={disclosure}>比较两到三项竞赛</summary>
      <fieldset className="mt-3 flex flex-wrap gap-3"><legend className="mb-2 text-sm text-muted-foreground">选择想比较的竞赛</legend>
        {candidates.map(item => <label className="flex items-center gap-2 text-sm" key={item.competitionId}>
          <input type="checkbox" checked={compareIds.includes(item.competitionId)} disabled={!compareIds.includes(item.competitionId) && compareIds.length >= 3}
            onChange={e => setCompareIds(e.target.checked ? [...compareIds, item.competitionId] : compareIds.filter(id => id !== item.competitionId))} />
          {item.name}</label>)}</fieldset>
      {compareIds.length >= 2 && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{compareIds.map(id => {
        const item = findCanonicalCatalogCompetition(id);
        if (!item) return null;
        const match = result.recommendations.find(candidate => candidate.competitionId === id);
        const extra = result.alternatives?.find(candidate => candidate.competitionId === id);
        return <article className="rounded-xl bg-brand-50 p-4 text-sm leading-6" key={id}>
          <h3 className="font-semibold">{item.name}</h3>
          <dl className="mt-3 space-y-2"><div><dt className="font-semibold">任务与赛道</dt>
            <dd>{match?.recommendedTrack?.label || item.category} · {item.summary}</dd></div>
            <div><dt className="font-semibold">对你的价值</dt><dd>{match?.explanation.matchReasons[0] || extra?.reason}</dd></div>
            <div><dt className="font-semibold">要补什么</dt><dd>{match?.explanation.possibleGaps[0] || item.detail.preparationTips[0]}</dd></div>
            <div><dt className="font-semibold">第一步</dt><dd>{match?.explanation.preparationTips[0] || item.detail.participationPath}</dd></div></dl>
        </article>;
      })}</div>}</details>}
    <details className={box}><summary className={disclosure}>为什么没推荐某场比赛？</summary>
      <label className="mt-3 block text-sm font-semibold">输入比赛名称或简称
        <input className="mt-2 block w-full rounded-lg border border-control-border px-3 py-2" placeholder="例如：化学实验" value={lookup} onChange={e => setLookup(e.target.value)} /></label>
      <ul className="mt-3 space-y-2 text-sm" aria-live="polite">{found.map(item => <li key={item.id}>
        <strong>{item.name}</strong><p>{selectedIds.has(item.id) ? "已在本次重点推荐中。" :
          result.candidateAudit?.find(candidate => candidate.competitionId === item.id)?.reason ?? "这次结果没有记录该项的判断依据，请打开官方资料核实。"}
        </p></li>)}{lookup.trim() && !found.length && <li>在当前目录中未找到这个名称，可以试试完整名称或其他简称。</li>}</ul>
    </details>
    <div className={box}><label className="block text-sm font-semibold" htmlFor="edit-decision-field">想调整哪项条件？</label>
      <div className="mt-2 flex flex-wrap gap-2"><select className="max-w-full rounded-lg border border-control-border bg-white px-2 py-2 text-sm" id="edit-decision-field" value={editIndex} onChange={e => setEditIndex(Number(e.target.value))}>
        {turns.map((turn, index) => <option key={turn.id} value={index}>{turn.prompt}</option>)}</select>
        <button type="button" className="min-h-11 rounded-full border border-brand-300 px-4 text-sm font-semibold text-brand-700" onClick={() => editTurn(editIndex)}>修改条件后重新推荐</button></div>
    </div>
    {result.recommendations.length > 0 && <button className="min-h-11 justify-self-start rounded-full bg-brand-600 px-5 py-2 font-semibold text-white" type="button" onClick={save}>保存并打开我的竞赛</button>}
    {saveError && <div role="alert" className="text-sm text-error-700">{saveError.message}
      {(saveError.reason === "quota" || saveError.reason === "corrupt") && <button type="button" className="ml-2 underline" onClick={clearDamaged}>清理后重试</button>}</div>}
    <div className="mt-2 border-t border-border pt-5 text-sm text-muted-foreground">想把这场比赛了解得更深入？ <Link className="font-semibold text-brand-700 underline underline-offset-4" href="/about#contact">联系 Emily 学姐</Link></div>
  </div>;
}
