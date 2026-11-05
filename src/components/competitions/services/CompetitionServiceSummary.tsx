"use client";

import Image from "next/image";
import type {
  CompetitionServiceMode,
  ResolvedCompetitionResource,
  ResolvedCompetitionService,
  ResolvedCompetitionTeamAvailability
} from "@/lib/competitions/service-resolver";
import {
  resourceStatusPresentation,
  teamStatusDescriptions,
  teamStatusPresentation
} from "@/lib/competitions/service-presentation";

type CompetitionServiceSummaryProps = {
  mode: CompetitionServiceMode;
  onSourceClick: (competitionId: string) => void;
  rank: number;
  service: ResolvedCompetitionService;
};

export function CompetitionServiceSummary({
  mode,
  onSourceClick,
  rank,
  service
}: CompetitionServiceSummaryProps) {
  const titleId = `recommendation-service-${mode}-${service.competitionId}`;

  return (
    <article
      aria-labelledby={titleId}
      className="py-5 first:pt-0 last:pb-0"
      data-competition-id={service.competitionId}
      data-testid="recommendation-service-item"
    >
      <header className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-500 font-serif text-sm font-semibold text-white shadow-soft">
          {String(rank).padStart(2, "0")}
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6 text-ink" id={titleId}>
            {service.name}
          </h3>
          {service.category ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{service.category}</p>
          ) : null}
        </div>
      </header>

      <div className="ml-0 mt-4 sm:ml-14">
        {mode === "resources" ? (
          <CompetitionResourceDetails resources={service.resources} />
        ) : (
          <CompetitionTeamDetails availability={service.team} name={service.name} />
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {service.knownCompetition
              ? service.verifiedAt
                ? `目录信息核验于 ${service.verifiedAt}`
                : "请结合竞赛最新通知核验"
              : "该结果暂时无法关联站内服务目录"}
          </span>
          {service.sourceUrl ? (
            <a
              aria-label={`查看竞赛公开来源：${service.name}（新窗口）`}
              className="inline-flex min-h-9 items-center font-semibold text-brand-700 underline decoration-brand-300 underline-offset-4 hover:decoration-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              href={service.sourceUrl}
              onClick={() => onSourceClick(service.competitionId)}
              rel="noopener noreferrer"
              target="_blank"
            >
              查看竞赛公开来源
              <ExternalLinkIcon />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ExternalLinkIcon() {
  return (
    <svg aria-hidden="true" className="ml-1 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
      <path d="M14 5h5v5M19 5l-8 8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

export function CompetitionResourceDetails({
  resources
}: {
  resources: readonly ResolvedCompetitionResource[];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="recommendation-resource-list">
      {resources.map((resource) => {
        const status = resourceStatusPresentation[resource.availability.status];

        return (
          <div
            className="flex min-h-[76px] items-center justify-between gap-3 rounded-[14px] border border-border bg-white px-4 py-3"
            data-testid="resource-template-card"
            key={resource.kind}
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">{resource.label}</p>
              <p className={`mt-1 flex items-center gap-2 text-xs font-medium ${status.textClassName}`}>
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${status.dotClassName}`}
                />
                {status.label}
              </p>
            </div>
            {resource.availability.status === "available" ? (
              <a
                aria-label={`下载${resource.label}：${resource.availability.fileName}`}
                className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-brand-400 px-3 text-xs font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                download={resource.availability.fileName}
                href={resource.availability.href}
              >
                下载
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function CompetitionTeamDetails({
  availability,
  name
}: {
  availability: ResolvedCompetitionTeamAvailability;
  name: string;
}) {
  const status = teamStatusPresentation[availability.status];

  if (availability.status === "open") {
    return (
      <div
        className="grid gap-4 rounded-[14px] border border-brand-200 bg-brand-50 p-4 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-center"
        data-testid="recommendation-team-open"
      >
        <Image
          alt={`${name}组队入口二维码`}
          className="h-28 w-28 rounded-lg border border-border bg-white object-contain p-1"
          height={112}
          src={availability.qrSrc}
          unoptimized
          width={112}
        />
        <div>
          <p className={`inline-flex items-center gap-2 text-sm font-semibold ${status.textClassName}`}>
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${status.dotClassName}`} />
            {status.label}
          </p>
          <dl className="mt-2 grid gap-1 text-xs leading-5 text-muted-foreground">
            <div><dt className="inline font-semibold text-ink/75">运营方：</dt><dd className="inline">{availability.operator}</dd></div>
            <div><dt className="inline font-semibold text-ink/75">核验日期：</dt><dd className="inline">{availability.verifiedAt}</dd></div>
            <div><dt className="inline font-semibold text-ink/75">预计失效：</dt><dd className="inline">{availability.expiresAt}</dd></div>
          </dl>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">这是第三方入口，加入前请核验运营方与群规则。</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-[14px] border border-border bg-white px-4 py-4"
      data-testid={`recommendation-team-${availability.status}`}
    >
      <p className={`inline-flex items-center gap-2 text-sm font-semibold ${status.textClassName}`}>
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${status.dotClassName}`} />
        {status.label}
      </p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {teamStatusDescriptions[availability.status]}
      </p>
    </div>
  );
}
