import Image from "next/image";
import type { Competition } from "@/content/competitions";
import { getDocumentedCompetitionAvailability } from "@/lib/competitions/documented-availability";
import { getCompetitionFactSheet } from "@/content/competition-facts";

type CompetitionCardProps = {
  availabilityNow?: Date;
  competition: Competition;
  onOpen: (competitionId: string) => void;
};

const statusTone: Record<string, string> = {
  open: "border-success-200 bg-success-50 text-success-700",
  upcoming: "border-brand-200 bg-brand-50 text-brand-700",
  unknown: "border-border bg-surface text-muted-foreground",
  stale: "border-border bg-surface text-muted-foreground",
  closed: "border-border bg-surface text-muted-foreground",
  cancelled: "border-border bg-surface text-muted-foreground"
};

export function CompetitionCard({
  availabilityNow,
  competition,
  onOpen
}: CompetitionCardProps) {
  const summaryId = `competition-summary-${competition.id}`;
  const availability = getDocumentedCompetitionAvailability(competition, availabilityNow);
  const edition = getCompetitionFactSheet(competition.id)?.edition ?? competition.recommendation.schedule.edition;
  const coverImage = competition.coverImage;

  return (
    <article
      className="group relative h-full overflow-hidden rounded-card border border-border bg-card shadow-[0_8px_22px_rgba(49,46,129,0.04)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-[0_14px_30px_rgba(67,56,202,0.1)] motion-reduce:transform-none"
      data-testid="competition-card"
    >
      <button
        aria-describedby={summaryId}
        aria-label={`查看竞赛详情：${competition.name}`}
        className="absolute inset-0 z-10 rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        onClick={() => onOpen(competition.id)}
        type="button"
      />

      <div className="pointer-events-none flex h-full min-w-0 flex-col">
        <figure className="shrink-0 border-b border-border bg-[#f5f2eb]">
          <div className="relative aspect-[8/3] w-full overflow-hidden">
            <Image
              alt={coverImage.alt}
              className="object-cover transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.015] motion-reduce:transition-none"
              data-testid="competition-cover-image"
              fill
              sizes="(min-width: 1280px) 298px, (min-width: 1024px) calc((100vw - 72px) / 3), (min-width: 640px) calc((100vw - 56px) / 2), calc(100vw - 40px)"
              src={coverImage.src}
            />
          </div>
        </figure>

        <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold leading-5">
            <span className="text-brand-700">{competition.direction}</span>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-ink/25" />
            <span className="text-muted-foreground">{competition.category}</span>
          </div>
          <h3 className="mt-3 line-clamp-2 text-base font-semibold leading-snug tracking-[-0.015em] text-ink sm:text-lg">
            {competition.name}
          </h3>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground" id={summaryId}>
            {competition.summary}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-semibold ${statusTone[availability.registrationStatus.status]}`}
            >
              {availability.registrationStatus.label}
            </span>
            {edition ? (
              <span className="text-xs font-medium text-muted-foreground">{edition}</span>
            ) : null}
          </div>

          <div className="mt-auto border-t border-border pt-3 text-sm font-semibold">
            <span className="inline-flex min-h-9 items-center gap-2 text-brand-700 group-hover:text-brand-500">
              查看详情
              <ArrowIcon />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M5 12h13M14 7l5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
