"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { CompetitionRecommendationItemV3 } from "@/types/competition-recommendation";

type RecommendationResultCardProps = {
  recommendation: CompetitionRecommendationItemV3;
  onOpenDetails: (competitionId: string) => void;
  onSourceClick: (competitionId: string) => void;
};

const recommendationRoleLabels: Record<CompetitionRecommendationItemV3["recommendationRole"], string> = {
  best: "最匹配",
  steady: "稳妥选择",
  reference: "参考匹配"
};

const fitLabels = {
  goal: "和你的目标有什么关系", task: "你会做哪些任务", experience: "你的经历可以用在哪里",
  readiness: "目前具备的条件", growth: "值得补足的能力", unknowns: "决定前还要核实"
} as const;

const statusStyles: Record<CompetitionRecommendationItemV3["registrationStatus"]["status"], string> = {
  open: "border-success-200 bg-success-50 text-success-700",
  upcoming: "border-brand-200 bg-brand-50 text-brand-700",
  unknown: "border-border bg-white text-muted-foreground",
  stale: "border-border bg-white text-muted-foreground",
  closed: "border-border bg-white text-muted-foreground",
  cancelled: "border-border bg-white text-muted-foreground"
};

type EvidenceDetails = NonNullable<
  NonNullable<CompetitionRecommendationItemV3["evidenceRefs"]>["details"]
>;

const eligibilityPresentation = {
  eligible: {
    label: "资格初筛通过",
    styles: "border-success-200 bg-success-50 text-success-700"
  },
  needs_clarification: {
    label: "资格待核验",
    styles: "border-warning-200 bg-warning-50 text-warning-700"
  },
  ineligible: {
    label: "资格不符合",
    styles: "border-error-200 bg-error-50 text-error-700"
  }
} as const;



const evidenceLabels = {
  "official-fact": "官方事实",
  "editorial-inference": "系统匹配推断",
  "user-confirmed": "用户已确认",
  preparation: "核验／准备建议"
} as const;

const officialFactLabels: Record<string, string> = {
  identity: "赛事身份／主办信息",
  stages: "参赛学段",
  teamRequirement: "队伍要求",
  eligibility: "参赛资格",
  schedule: "赛期／报名状态",
  firstHigherEducationYearCutoff: "首次高等教育年份条件",
  requiredResources: "必需资源",
  trackEligibility: "赛道资格",
  teamCommitment: "团队投入要求",
  participationMode: "参与方式",
  recentActivity: "近期活动"
};

function AdviceList({
  items,
  emptyText,
  evidenceRefs = [],
  evidenceDetails = []
}: {
  items: string[];
  emptyText: string;
  evidenceRefs?: readonly string[];
  evidenceDetails?: EvidenceDetails;
}) {
  if (items.length === 0) return <p className="mt-2 text-sm leading-6 text-muted-foreground">{emptyText}</p>;

  return (
    <ul className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
      {items.map((item, index) => {
        const evidenceRef = evidenceRefs[index];
        const detail = evidenceDetails.find((entry) => entry.evidenceRef === evidenceRef);
        return (
          <li className="flex gap-2.5" key={`${item}-${index}`}>
            <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
            <span>
              <span className="block">{item}</span>
              {detail ? detail.sourceUrl ? (
                <a
                  className="mt-1 inline-flex rounded-full border border-brand-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-brand-700 hover:border-brand-400 hover:text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                  data-evidence-ref={detail.evidenceRef}
                  href={detail.sourceUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                  title={`打开官方证据：${detail.sourceRef ?? detail.evidenceRef}`}
                >
                  {evidenceLabels[detail.provenance]}
                  <span className="sr-only">，证据引用 {detail.sourceRef ?? detail.evidenceRef}</span>
                </a>
              ) : (
                <span
                  className="mt-1 inline-flex rounded-full border border-brand-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-brand-700"
                  data-evidence-ref={detail.evidenceRef}
                  title={`依据类型：${evidenceLabels[detail.provenance]}`}
                >
                  {evidenceLabels[detail.provenance]}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function RecommendationResultCard({
  recommendation,
  onOpenDetails,
  onSourceClick
}: RecommendationResultCardProps) {
  const [expanded, setExpanded] = useState(recommendation.rank === 1);
  const eligibility = eligibilityPresentation[recommendation.eligibility.status];
  const titleId = `recommendation-title-${recommendation.competitionId}`;
  const contentId = `recommendation-content-${recommendation.competitionId}`;
  const officialEvidenceSources = [...new Set(
    (recommendation.evidenceRefs?.officialFacts ?? []).map(({ sourceRef }) => sourceRef)
  )].map((sourceRef) => {
    const entries = (recommendation.evidenceRefs?.officialFacts ?? [])
      .filter((entry) => entry.sourceRef === sourceRef);
    return {
      sourceRef,
      sourceUrl: entries[0]?.sourceUrl,
      facts: [...new Set(entries.map(({ fact }) => fact))]
    };
  });

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "overflow-hidden rounded-[22px] border bg-white transition",
        expanded
          ? "border-brand-300 shadow-soft"
          : "border-border hover:border-brand-300"
      )}
    >
      <button
        aria-controls={contentId}
        aria-expanded={expanded}
        className="grid min-h-[112px] w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-brand-500 md:grid-cols-[64px_1fr_auto] md:px-6"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-500 font-serif text-lg font-semibold text-white shadow-soft md:h-14 md:w-14">
          {String(recommendation.rank).padStart(2, "0")}
        </span>

        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-brand-600">
              {recommendationRoleLabels[recommendation.recommendationRole]}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusStyles[recommendation.registrationStatus.status]}`}>
              {recommendation.registrationStatus.label}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${eligibility.styles}`}>
              {eligibility.label}
            </span>
          </span>
          <span className="mt-2 block text-base font-semibold leading-6 text-ink md:text-lg" id={titleId}>
            {recommendation.name}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">{recommendation.category}</span>
          {recommendation.recommendedTrack ? (
            <span className="mt-2 inline-flex rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700">
              推荐赛道：{recommendation.recommendedTrack.label}
            </span>
          ) : <span className="mt-2 block text-xs text-muted-foreground">按整个系列推荐，报名组别请对照对应届次文件。</span>}
        </span>

        <span className="flex items-center gap-3">
          <svg
            aria-hidden="true"
            className={cn("h-5 w-5 text-muted-foreground transition-transform", expanded && "rotate-180")}
            fill="none"
            viewBox="0 0 24 24"
          >
            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
          </svg>
        </span>
      </button>

      <div className={expanded ? "block" : "hidden"} id={contentId}>
        <div className="border-t border-border px-4 py-5 md:px-6 md:py-6">
          {recommendation.registrationStatus.note ? (
            <p className="mb-5 rounded-[14px] border border-border bg-brand-50 px-4 py-3 text-xs leading-5 text-muted-foreground">
              {recommendation.registrationStatus.note}
            </p>
          ) : null}

          {recommendation.eligibility.status === "needs_clarification" ? (
            <div className="mb-5 rounded-[14px] border border-warning-200 bg-warning-50 px-4 py-3 text-xs leading-5 text-warning-700" data-testid="recommendation-eligibility-pending">
              <p className="font-semibold">资格待核验</p>
              <p className="mt-1">
                {recommendation.eligibility.reasons[0] || "目前缺少官方条件的确认信息，请以当届通知为准。"}
              </p>
            </div>
          ) : null}

          {recommendation.recommendationRole === "reference" ? (
            <div className="mb-5 rounded-[14px] border border-border bg-white px-4 py-3 text-xs leading-5 text-muted-foreground" data-testid="recommendation-reference-notice">
              <p className="font-semibold text-ink">参考匹配</p>
              <p className="mt-1">请先检查下方尚待核实的条件，再决定是否投入准备。</p>
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
            <div>
              <h3 className="text-sm font-semibold text-ink">竞赛简介</h3>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">{recommendation.summary}</p>

              {recommendation.fitEvidence && <dl className="mt-4 grid gap-3">
                {(Object.keys(fitLabels) as Array<keyof typeof fitLabels>).map(key => {
                  const entries = recommendation.fitEvidence?.[key] ?? [];
                  return entries.length > 0 && <div key={key}><dt className="text-xs font-semibold text-brand-700">{fitLabels[key]}</dt>
                    <dd className="mt-1 text-sm leading-6 text-muted-foreground">{entries.join("；")}</dd></div>;
                })}
              </dl>}
            </div>

            <section className="rounded-[18px] border border-brand-200 bg-brand-50 p-4 md:p-5" aria-labelledby={`${titleId}-analysis`}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-ink" id={`${titleId}-analysis`}>
                  乐乐的推荐分析
                </h3>
                <span className="text-[11px] font-semibold text-brand-600">
                  {recommendation.rankingSource === "evidence-rules" ? "依据已确认条件匹配" : recommendation.rankingSource === "deepseek" ? "DeepSeek 排序" : "规则降级排序"} · 仅供参考
                </span>
              </div>
              <div className="mt-4 grid gap-4">
                <div>
                  <p className="text-xs font-semibold text-ink/80">为什么匹配</p>
                  {recommendation.explanationSource === "deepseek" && recommendation.rankingSource === "evidence-rules" && <p className="mt-1 text-xs text-muted-foreground">AI 从站内已有依据中挑选了以下理由。推荐顺序由本站程序决定。</p>}
                  <AdviceList
                    emptyText="当前缺少更具体的经历依据，可修改回答后重新比较。"
                    evidenceDetails={recommendation.evidenceRefs?.details}
                    evidenceRefs={recommendation.evidenceRefs?.match}
                    items={recommendation.explanation.matchReasons}
                  />
                </div>
                <div>
                  <p className="text-xs font-semibold text-ink/80">可能的差距</p>
                  <AdviceList
                    emptyText="暂无明显差距，仍需核验官方资格要求。"
                    evidenceDetails={recommendation.evidenceRefs?.details}
                    evidenceRefs={recommendation.evidenceRefs?.gaps}
                    items={recommendation.explanation.possibleGaps}
                  />
                </div>
                <div>
                  <p className="text-xs font-semibold text-ink/80">准备建议</p>
                  <AdviceList
                    emptyText="先阅读最新官方通知，再安排备赛节奏。"
                    evidenceDetails={recommendation.evidenceRefs?.details}
                    evidenceRefs={recommendation.evidenceRefs?.tips}
                    items={recommendation.explanation.preparationTips}
                  />
                </div>
              </div>
            </section>
          </div>

          {recommendation.dataNotices.length > 0 ? (
            <aside className="mt-5 border-l-2 border-brand-400 pl-3">
              <p className="text-xs font-semibold text-ink/80">信息核验提醒</p>
              <ul className="mt-1 space-y-1 text-xs leading-5 text-muted-foreground">
                {recommendation.dataNotices.map((notice, index) => (
                  <li key={`${notice}-${index}`}>{notice}</li>
                ))}
              </ul>
            </aside>
          ) : null}

          {officialEvidenceSources.length > 0 ? (
            <details className="mt-5 rounded-[14px] border border-border bg-white px-4 py-3">
              <summary className="cursor-pointer text-xs font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
                查看本条推荐使用的官方证据（{officialEvidenceSources.length}）
              </summary>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
                {officialEvidenceSources.map(({ sourceRef, sourceUrl, facts }, index) => (
                  <li className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2" key={sourceRef}>
                    {sourceUrl ? (
                      <a
                        className="font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
                        href={sourceUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        官方证据 {index + 1}
                      </a>
                    ) : <span className="font-semibold text-ink">官方证据 {index + 1}</span>}
                    <span>{facts.map((fact) => officialFactLabels[fact] ?? fact).join("、")}</span>
                    <span className="sr-only">证据引用 {sourceRef}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="mt-6 grid gap-2 border-t border-border pt-5 sm:grid-cols-2">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 motion-reduce:transform-none"
              onClick={() => onOpenDetails(recommendation.competitionId)}
              type="button"
            >
              查看竞赛详情
            </button>
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-control-border px-4 py-2 text-center text-sm font-semibold text-ink transition hover:border-brand-400 hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              href={recommendation.sourceUrl}
              onClick={() => onSourceClick(recommendation.competitionId)}
              rel="noopener noreferrer"
              target="_blank"
            >
              查看官方 / 来源页面
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}
