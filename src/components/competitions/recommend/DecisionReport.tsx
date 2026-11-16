"use client";

import Link from "next/link";
import { useState } from "react";
import { compareDecisionItems, describeDecisionChanges, type DecisionClaimV6, type DecisionRecommendationV6, type DecisionReportV6, type StudentFactV6 } from "@/lib/competitions/v6/contracts";
import { saveSelectedDecisions } from "@/lib/competitions/v6/saved-decisions";
import type { FixedQuestionTurn } from "./questionFlow";

const box="rounded-2xl border border-border bg-white p-5";
const button="min-h-11 rounded-full border border-brand-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700";
const basisLabels={student:"你的自述",official:"官方资料",inference:"匹配判断",suggestion:"准备建议",unknown:"信息待确认"};
const difficultyLabels={entry:"开始体验",completion:"完成有效作品或提交",award:"竞争奖项"};
const valueLabels:Record<string,string>={exploration:"方向探索",skill:"能力训练",portfolio:"可展示作品",employment:"实习与就业相关性",recognition:"评价与认可",research:"研究与深造",explore:"方向探索",job:"实习与就业",award:"奖项与认可",governance:"赛事组织与评价机制",taskRelevance:"任务与你目标的关系",learningFeedback:"训练与反馈机会",industryAcademicAccess:"行业或学术接触机会"};

// Compact model references belong in the structured evidence drawer, not prose.
export function decisionDisplayText(text: string): string {
  return text.replace(/[（(]\s*@[FP]\d+(?:[\s,，、;；/]+@[FP]\d+)*\s*[）)]/gu, "")
    .replace(/(?<![A-Za-z0-9_@])@[FP]\d+(?![A-Za-z0-9_])/gu, "");
}

function providedFactText(fact: StudentFactV6): string {
  const original = fact.originalText?.trim() ? fact.originalText : null;
  const canonical = Boolean(original === String(fact.value) && /^[A-Za-z0-9_.:-]+$/u.test(original));
  if (original && !canonical) return original;
  if (typeof fact.value === "boolean") return `${fact.label}（已提交值：${fact.value ? "是" : "否"}）`;
  return typeof fact.value === "number" && !fact.label.includes(String(fact.value)) ? `${fact.label}（已提交值：${fact.value}）` : fact.label;
}

export function DecisionClaim({claim,report,item,showSourceLinks=true}:{claim:DecisionClaimV6;report?:DecisionReportV6;item?:DecisionRecommendationV6;showSourceLinks?:boolean}) {
  const studentFacts=(report?.profile.facts??[]).filter(fact=>claim.studentFactIds.includes(fact.id));
  const inactiveIds=new Set([...(report?.profile.retractedFactIds??[]),...(report?.profile.facts??[]).flatMap(fact=>fact.supersedesFactIds??[])]);
  const otherFacts=(report?.profile.facts??[]).filter(fact=>!claim.studentFactIds.includes(fact.id)&&!inactiveIds.has(fact.id)&&fact.state!=="retracted"&&(fact.confirmed||fact.state==="conditional"||fact.state==="unknown"));
  const candidates=item?[item]:(report?.recommendations??[]);
  const facts=[...new Map(candidates.flatMap(candidate=>candidate.evidenceFacts).filter(fact=>claim.competitionFactIds.includes(fact.id)).map(fact=>[fact.id,fact])).values()];
  const sourceIds=new Set(facts.flatMap(fact=>fact.sourceIds));
  const sources=[...new Map(candidates.flatMap(candidate=>candidate.sources).filter(source=>sourceIds.has(source.id)).map(source=>[source.id,source])).values()];
  return <div className="text-sm leading-6"><p>{decisionDisplayText(claim.text)}</p>
    <details className="mt-1 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer text-brand-700">{basisLabels[claim.basis]} · 查看依据与条件</summary>
      <div className="mt-2 space-y-2 rounded-xl bg-brand-50/50 p-3">
        {studentFacts.map(fact=><p key={fact.id}>你的回答：{providedFactText(fact)}</p>)}
        {facts.map(fact=><p key={fact.id}>赛事资料：{fact.text}（{fact.scope}）</p>)}
        {sources.map(source=><p key={source.id}>{showSourceLinks?<a className="font-semibold text-brand-700 underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>:<span>依据来源：{source.title}</span>} · {source.scope}{source.checkedAt?` · 核查于 ${source.checkedAt}`:" · 核查日期待确认"}</p>)}
        {claim.conditions.map((condition,index)=><p key={index}>成立条件：{decisionDisplayText(condition)}</p>)}
        {!studentFacts.length&&!facts.length&&!claim.conditions.length?<p>{claim.basis==="suggestion"?"这是供你选择下一步的建议，实际体验后可以调整。":"现有资料不足以给出更确定的判断。"}</p>:null}
        {otherFacts.length?<section className="mt-3 space-y-2 border-t border-border pt-3" data-testid="decision-other-profile-information">
          <p className="font-semibold text-ink">已提供的其他信息与限制</p>
          <p>以下信息未作为本条判断的引用依据，供你核对背景、限制和适用范围。</p>
          {otherFacts.map(fact=><p key={fact.id}>{fact.state==="negated"?"否定信息：":fact.state==="conditional"?"条件性信息：":fact.state==="unknown"?"尚未确定：":"已提交信息："}{providedFactText(fact)}</p>)}
        </section>:null}
      </div>
    </details>
  </div>;
}

export function DecisionDetails({item,report,showSourceLinks=true}:{item:DecisionRecommendationV6;report?:DecisionReportV6;showSourceLinks?:boolean}) {
  return <div className="space-y-5">
        <section><h4 className="mb-2 font-semibold">具体做什么</h4><DecisionClaim claim={item.coreTask} item={item} report={report} showSourceLinks={showSourceLinks}/></section>
        <section><h4 className="mb-2 font-semibold">为什么与你有关</h4><div className="space-y-3">{item.reasons.map((claim,index)=><DecisionClaim key={index} claim={claim} item={item} report={report} showSourceLinks={showSourceLinks}/>)}</div></section>
        <section className="grid gap-4 md:grid-cols-2"><div className="rounded-xl bg-brand-50 p-4"><h4 className="mb-2 font-semibold">你现在可以从哪里开始</h4><DecisionClaim claim={item.currentRole} item={item} report={report} showSourceLinks={showSourceLinks}/></div><div className="rounded-xl bg-slate-50 p-4"><h4 className="mb-2 font-semibold">想走得更远，需要补什么</h4><div className="space-y-3">{item.gaps.slice(0,3).map((claim,index)=><DecisionClaim key={index} claim={claim} item={item} report={report} showSourceLinks={showSourceLinks}/>)}</div>{item.gaps.length>3?<details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-brand-700">查看其余 {item.gaps.length-3} 条准备与核实事项</summary><div className="mt-3 space-y-3">{item.gaps.slice(3).map((claim,index)=><DecisionClaim key={index} claim={claim} item={item} report={report} showSourceLinks={showSourceLinks}/>)}</div></details>:null}</div></section>
        <section><h4 className="mb-2 font-semibold">对你的价值与可能收获</h4><div className="space-y-3">{item.values.map((value,index)=><div key={index}><p className="text-xs font-semibold text-brand-700">{valueLabels[value.dimension]??"与你目标相关的价值"}</p><DecisionClaim claim={value.claim} item={item} report={report} showSourceLinks={showSourceLinks}/>{value.claim.conditions[0]?<p className="mt-1 text-xs leading-5 text-muted-foreground">前提：{decisionDisplayText(value.claim.conditions[0])}</p>:null}</div>)}</div></section>
        <section><h4 className="mb-2 font-semibold">三个阶段的难度</h4><div className="grid gap-3 md:grid-cols-3">{item.difficulty.map(difficulty=><div className="rounded-xl border border-border p-3" key={difficulty.stage}><p className="mb-2 text-sm font-semibold">{difficultyLabels[difficulty.stage]}</p><DecisionClaim claim={difficulty.claim} item={item} report={report} showSourceLinks={showSourceLinks}/></div>)}</div></section>
        <section><h4 className="mb-2 font-semibold">主要投入与机会成本</h4><DecisionClaim claim={item.opportunityCost} item={item} report={report} showSourceLinks={showSourceLinks}/></section>
        <section><h4 className="mb-2 font-semibold">先做这一件事</h4><DecisionClaim claim={item.nextStep} item={item} report={report} showSourceLinks={showSourceLinks}/><p className="mt-2 text-sm">再判断的时点：{item.checkpoint}</p></section>
        <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-muted-foreground">参赛资格和开赛时间请自行核查官网</p>
      </div>;
}

export function DecisionOverview({report,turns,onEdit,showSourceLinks=true}:{report:DecisionReportV6;turns:readonly FixedQuestionTurn[];onEdit:(index:number)=>void;showSourceLinks?:boolean}) {
  const goalTurnIndex=turns.findIndex(turn=>turn.id==="goals");
  return <details className={box} data-testid="decision-overview"><summary className="cursor-pointer font-semibold text-brand-700">查看整体建议与目标取舍</summary>
    <div className="mt-4 space-y-4"><DecisionClaim claim={report.summary.direction} report={report} showSourceLinks={showSourceLinks}/>
      {report.summary.personalEvidence.map((claim,index)=><DecisionClaim key={index} claim={claim} report={report} showSourceLinks={showSourceLinks}/>)}
      <section><h3 className="mb-2 font-semibold">当前最需要弄清的一点</h3><DecisionClaim claim={report.summary.mainGap} report={report} showSourceLinks={showSourceLinks}/></section>
      <section><h3 className="mb-2 font-semibold">你现在可以做的第一步</h3><DecisionClaim claim={report.summary.nextStep} report={report} showSourceLinks={showSourceLinks}/></section>
      {report.goalPaths.length?<section className="space-y-3 border-t border-border pt-4" data-testid="goal-paths"><h3 className="font-semibold">目标还没定，可以这样分别考虑</h3><p className="text-sm leading-6">以下路径说明不同目标的取舍，当前还没有确认首要目标。确认目标后可以更新完整推荐。</p>{report.goalPaths.slice(0,2).map((path,index)=><article className="rounded-xl bg-slate-50 p-4" key={`${path.goal}-${index}`} data-goal-path={path.goal}><h4 className="font-semibold">{path.goal}</h4><p className="mt-2 text-sm leading-6">{path.condition}</p>{path.itemIds.length?<p className="mt-2 text-xs leading-6 text-muted-foreground">可以结合这些候选理解：{(path.itemNames??report.recommendations.filter(item=>path.itemIds.includes(item.itemId)).map(item=>item.name)).join("、")||"候选条件仍需确认"}</p>:null}<div className="mt-3"><p className="mb-1 text-xs font-semibold text-brand-700">先做这一小步</p><DecisionClaim claim={path.nextStep} report={report} showSourceLinks={showSourceLinks}/></div></article>)}{goalTurnIndex>=0?<button type="button" className={button} onClick={()=>onEdit(goalTurnIndex)}>回到目标题确认后重新匹配</button>:null}</section>:null}
      <p className="text-xs leading-5 text-muted-foreground">{report.schoolPolicyReminder}</p>
    </div>
  </details>;
}

function DecisionCard({item,report,selected,onSelect}:{item:DecisionRecommendationV6;report:DecisionReportV6;selected:boolean;onSelect:(checked:boolean)=>void}) {
  return <article id={`decision-${item.rank}`} className={box}>
    <details>
      <summary className="cursor-pointer list-none">
        <div className="flex items-start gap-3"><span className="rounded-full bg-brand-100 px-3 py-2 font-semibold text-brand-700">{item.rank}</span><div className="min-w-0 flex-1">
          <h3 className="font-semibold text-ink">{item.name}</h3><p className="mt-1 text-sm text-muted-foreground">{item.trackLabel} · {item.edition}</p>
          <span className="mt-3 inline-block text-xs font-semibold text-brand-700">查看匹配理由与下一步</span>
        </div></div>
      </summary>
      <div className="mt-5 border-t border-border pt-5"><DecisionDetails item={item} report={report}/></div>
    </details>
    <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-2 border-t border-border pt-3 text-sm font-semibold text-brand-700"><input type="checkbox" checked={selected} onChange={event=>onSelect(event.target.checked)}/>选择收藏这一项</label>
  </article>;
}

export function DecisionReport({report,previousReport,turns,onEdit}:{report:DecisionReportV6;previousReport?:DecisionReportV6|null;turns:readonly FixedQuestionTurn[];onEdit:(index:number)=>void}) {
  const [showAll,setShowAll]=useState(false);
  const [compareIds,setCompareIds]=useState<string[]>(report.summary.focusItemIds.slice(0,2));
  const [saveIds,setSaveIds]=useState<string[]>([]);
  const [saveMessage,setSaveMessage]=useState("");
  const [saveOk,setSaveOk]=useState(false);
  const [editIndex,setEditIndex]=useState(0);
  const [lookup,setLookup]=useState("");
  const visible=showAll?report.recommendations:report.recommendations.slice(0,5);
  const chosen=report.recommendations.filter(item=>compareIds.includes(item.itemId));
  const comparison=chosen.length>=2?(report.comparisons.find(value=>value.itemIds.length===chosen.length&&chosen.every(item=>value.itemIds.includes(item.itemId)))??compareDecisionItems(chosen)):null;
  const changes=previousReport&&previousReport.profile.revision!==report.profile.revision?describeDecisionChanges(previousReport,report):[];
  const found=lookup.trim()?report.candidateAudit.filter(item=>item.name.toLowerCase().includes(lookup.trim().toLowerCase())).slice(0,10):[];
  return <div className="space-y-5" data-testid="decision-report-v6">
    <section className="rounded-2xl border border-brand-300 bg-brand-50/50 p-5 md:p-6">
      <h2 id="recommendation-results-title" className="font-serif text-2xl font-semibold">这些竞赛值得你了解</h2>
      <p className="mt-3 text-sm leading-6">共 {report.recommendations.length} 项。点击一项查看匹配理由、适合的角色、难度与下一步，不需要同时报名。</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">参赛资格和开赛时间请自行核查官网</p>
    </section>
    {changes.length?<details className={box}><summary className="cursor-pointer font-semibold text-brand-700">查看修改后的变化</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{changes.map((change,index)=><li key={index}>{change}</li>)}</ul></details>:null}
    <section aria-label="完整竞赛建议" className="space-y-3"><h3 className="font-semibold">逐项了解，共 {report.recommendations.length} 项</h3>{visible.map(item=><DecisionCard key={item.itemId} item={item} report={report} selected={saveIds.includes(item.itemId)} onSelect={checked=>setSaveIds(current=>checked?[...current,item.itemId]:current.filter(id=>id!==item.itemId))}/>)}
      {report.shortlistShortfallReason?<p className="rounded-xl bg-slate-50 p-4 text-sm leading-6">{report.shortlistShortfallReason}</p>:null}
      {report.recommendations.length>5?<button type="button" className={button} onClick={()=>setShowAll(value=>!value)}>{showAll?"收起到前 5 项":`查看其余 ${report.recommendations.length-5} 项`}</button>:null}
    </section>
    <DecisionOverview report={report} turns={turns} onEdit={onEdit}/>
    {report.recommendations.length>=2?<details className={box}><summary className="cursor-pointer font-semibold text-brand-700">比较两到三项，看清怎么取舍</summary>
      <fieldset className="mt-4 flex flex-wrap gap-3"><legend className="mb-2 text-sm">选择 2–3 项</legend>{report.recommendations.map(item=><label key={item.itemId} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={compareIds.includes(item.itemId)} disabled={!compareIds.includes(item.itemId)&&compareIds.length>=3}
        onChange={event=>setCompareIds(current=>event.target.checked?[...current,item.itemId]:current.filter(id=>id!==item.itemId))}/>{item.name}</label>)}</fieldset>
      {comparison?<div className="mt-4 space-y-4"><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr><th className="p-3">比较维度</th>{chosen.map(item=><th className="p-3" key={item.itemId}>{item.name}</th>)}</tr></thead><tbody>{comparison.dimensions.map((dimension,index)=><tr className="border-t border-border align-top" key={index}><th className="p-3">{dimension.label}</th>{chosen.map(item=><td className="p-3" key={item.itemId}>{decisionDisplayText(dimension.values.find(value=>value.itemId===item.itemId)?.claim.text??"信息待核实")}</td>)}</tr>)}</tbody></table></div><DecisionClaim claim={comparison.tradeoff} report={report}/></div>:<p className="mt-3 text-sm">再选择一项，即可并排比较。</p>}
    </details>:null}
    <details className={box}><summary className="cursor-pointer font-semibold text-brand-700">为什么没推荐某场比赛？</summary><label className="mt-3 block text-sm">输入比赛名称<input className="mt-2 w-full rounded-lg border border-control-border p-3" value={lookup} onChange={event=>setLookup(event.target.value)}/></label><div aria-live="polite" className="mt-3 space-y-4">{found.map(item=><article key={item.seriesId}><h4 className="mb-1 font-semibold">{item.name}</h4><DecisionClaim claim={item.reason} report={report}/></article>)}{lookup.trim()&&!found.length?<p className="text-sm">本次候选记录没有这个名称，不能据此判断它不适合你。</p>:null}</div></details>
    {report.pendingQuestions.length?<details className={box}><summary className="cursor-pointer font-semibold text-brand-700">下一次选择前，值得确认</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{report.pendingQuestions.map((question,index)=><li key={index}>{question}</li>)}</ul></details>:null}
    <section className={box}><label className="block font-semibold" htmlFor="decision-edit-field">想修改目标、经历或投入条件？</label><div className="mt-3 flex flex-wrap gap-3"><select id="decision-edit-field" className="max-w-full rounded-lg border border-control-border bg-white p-3 text-sm" value={editIndex} onChange={event=>setEditIndex(Number(event.target.value))}>{turns.map((turn,index)=><option key={turn.id} value={index}>{turn.prompt}</option>)}</select><button type="button" className={button} onClick={()=>onEdit(editIndex)}>修改后重新匹配</button></div><p className="mt-2 text-xs text-muted-foreground">修改会重新计算推荐依据；旧回答不会继续当作新的判断依据。</p></section>
    <div className="flex flex-wrap items-center gap-3"><button type="button" className={`${button} disabled:opacity-40`} disabled={!saveIds.length} onClick={()=>{const outcome=saveSelectedDecisions(report,saveIds);setSaveOk(outcome.ok);setSaveMessage(outcome.ok?`已收藏所选 ${saveIds.length} 项。`:outcome.message);}}>收藏所选 {saveIds.length} 项</button><Link className="text-sm font-semibold text-brand-700 underline" href="/competitions/saved">打开我的竞赛</Link></div>
    {saveMessage?<p role={saveOk?"status":"alert"} className={`text-sm ${saveOk?"text-brand-700":"text-error-700"}`}>{saveMessage}</p>:null}
  </div>;
}
