import Image from "next/image";
import { skillOptions, preferredOutputOptions } from "./recommend/questionContent";
import type { Competition } from "@/content/competitions";
import { OrbitBackdrop } from "@/components/brand/OrbitBackdrop";
import { getDocumentedCompetitionAvailability } from "@/lib/competitions/documented-availability";
import { getCompetitionFactSheet, type CompetitionFactSheet } from "@/content/competition-facts";
import { getCompetitionFieldGuide } from "@/content/competition-field-guides";

type CompetitionDetailContentProps = {
  availabilityNow?: Date;
  competition: Competition;
  headingId: string;
  headingLevel?: "h1" | "h2";
  onSourceClick?: (competitionId: string) => void;
};

const statusTone: Record<string, string> = {
  open: "border-success-200 bg-success-50 text-success-700",
  upcoming: "border-brand-500/25 bg-brand-50 text-brand-700",
  unknown: "border-border bg-surface text-muted-foreground",
  stale: "border-border bg-surface text-muted-foreground",
  closed: "border-border bg-surface text-muted-foreground",
  cancelled: "border-border bg-surface text-muted-foreground"
};

export function CompetitionDetailContent({
  availabilityNow,
  competition,
  headingId,
  headingLevel: Heading = "h2",
  onSourceClick
}: CompetitionDetailContentProps) {
  const availability = getDocumentedCompetitionAvailability(competition, availabilityNow);
  const facts = getCompetitionFactSheet(competition.id);
  const guide = getCompetitionFieldGuide(competition.id);
  const { schedule, tracks, source, supportingSources } = competition.recommendation;
  const namedSources = [source, ...(supportingSources ?? [])];
  const skills = new Map<string, string>(skillOptions.map((option) => [option.value, option.label]));
  const outputs = new Map<string, string>(
    preferredOutputOptions.map((option) => [option.value, option.label])
  );

  return (
    <article>
      <figure className="mb-5 overflow-hidden rounded-card border border-border bg-[#f5f2eb]">
        <div className="relative aspect-[8/3] w-full">
          <Image
            alt={competition.coverImage.alt}
            className="object-cover"
            fill
            sizes="(min-width: 944px) 816px, (min-width: 768px) calc(100vw - 104px), calc(100vw - 40px)"
            src={competition.coverImage.src}
          />
        </div>
      </figure>

      <header className="relative isolate overflow-hidden rounded-card border border-brand-200 bg-brand-50 px-5 py-6 md:px-6 md:py-7">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[68%] opacity-50 md:w-[62%]">
          <OrbitBackdrop compact />
        </div>

        <div className="relative max-w-[42rem]">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="text-brand-700">{competition.direction}</span>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-ink/25" />
            <span className="text-muted-foreground">{competition.category}</span>
          </div>

          <Heading
            className="mt-4 text-2xl font-semibold leading-tight tracking-[-0.025em] text-ink md:text-3xl"
            id={headingId}
          >
            {competition.name}
          </Heading>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-semibold ${statusTone[availability.registrationStatus.status]}`}
            >
              {availability.registrationStatus.label}
            </span>
            {(facts?.edition || schedule.edition) && (
              <span className="text-xs text-muted-foreground">{facts?.edition || schedule.edition}</span>
            )}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {availability.registrationStatus.note}
          </p>
        </div>
      </header>

      <div className="mt-7 divide-y divide-border border-y border-border">
        {guide && (
          <section className="py-5">
            <h3 className="text-lg font-semibold text-ink">这场比赛，你会做什么？</h3>
            <p className="mt-2 text-sm leading-7 text-ink">{guide.task}。</p>
            <dl className="mt-4 grid gap-4 rounded-field bg-brand-50 p-4 text-sm sm:grid-cols-2">
              {Object.entries({
                典型成果: guide.deliverable,
                可以承担的任务: guide.role,
                这些经历用得上: guide.experience,
                投入前先考虑: guide.investment,
                先试这一小步: guide.firstStep
              }).map(([label, value]) => (
                <div key={label}>
                  <dt className="font-semibold text-brand-800">{label}</dt>
                  <dd className="mt-1 leading-6 text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              任务和起步练习是赛途的选赛建议。正式提交物以所选赛道文件为准。
            </p>
          </section>
        )}
        {!!tracks?.length && (
          <details className="py-5">
            <summary className="cursor-pointer font-semibold text-ink">
              查看已整理的赛道与组别（{tracks.length}）
            </summary>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              按可查资料列出，不同届次可能调整。任务提示用于选赛，正式要求请看对应文件。
            </p>
            <ul className="mt-3 space-y-3 text-sm">
              {tracks.map((track) => {
                const document =
                  track.document ??
                  (track.evidenceRef && namedSources.find((item) => item?.evidenceRef === track.evidenceRef));
                const work = track.skills?.map((value) => skills.get(value)).filter(Boolean);
                const results = track.preferredOutputs?.map((value) => outputs.get(value)).filter(Boolean);
                return (
                  <li className="rounded-field bg-brand-50 p-3" key={track.id}>
                    <strong>{track.label}</strong>
                    {track.taskSummary && <p className="mt-1 leading-6">{track.taskSummary}</p>}
                    {!!work?.length && <p className="mt-1">可以用到：{work.join("、")}</p>}
                    {!!results?.length && <p>可能形成的成果：{results.join("、")}</p>}
                    {track.eligibilityNotes?.map((note) => (
                      <p key={note} className="mt-1 text-muted-foreground">
                        {note}
                      </p>
                    ))}
                    {track.document && (
                      <p className="mt-1 text-xs text-muted-foreground">{track.document.scope}</p>
                    )}
                    {document && (
                      <a
                        className="mt-1 inline-block text-brand-700 underline"
                        href={document.url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        核对赛道资料
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        )}
        <DetailSection title="比赛介绍">{competition.detail.intro}</DetailSection>
        <DetailSection title="参加途径">{competition.detail.participationPath}</DetailSection>
        <DetailSection title="你能收获什么">{competition.detail.userValue}</DetailSection>

        <ListSection items={competition.detail.suitableFor} title="适合人群" />
        <ListSection items={competition.detail.preparationTips} title="准备建议" />
      </div>

      {facts && (
        <section className="mt-6 rounded-card border border-border p-5">
          <h3 className="text-lg font-semibold text-ink">报名前，把这些条件核实清楚</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {facts.edition} · 资料核查于 {facts.checkedAt}
          </p>
          <dl className="mt-4 space-y-3 text-sm">
            {Object.entries({
              参赛资格: facts.eligibility,
              组队要求: facts.team,
              指导教师: facts.mentor,
              费用: facts.fee
            }).map(([label, value]) => (
              <div key={label}>
                <dt className="font-semibold text-ink">{label}</dt>
                <dd className="mt-1 leading-6 text-muted-foreground">
                  <CitedFact label={label} text={value} sources={facts.sources} />
                </dd>
              </div>
            ))}
          </dl>
          {facts.nodes.length > 0 && (
            <div className="mt-5">
              <h4 className="text-sm font-semibold">已查到的时间安排</h4>
              <ul className="mt-2 space-y-2 text-sm">
                {facts.nodes.map((node, index) => (
                  <li key={index}>
                    <a
                      href={node.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-700 underline"
                    >
                      {node.date} · {node.kind}
                    </a>
                    <span className="ml-2">{node.scope}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <h4 className="mt-5 text-sm font-semibold">适用文件</h4>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
            {facts.sources.map((source, index) => (
              <li key={index}>
                <a
                  className="text-brand-700 underline"
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {source.title}
                </a>
                <span className="ml-2 text-muted-foreground">{source.scope}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {competition.recommendation.dataNotices.length > 0 ? (
        <div className="mt-5 rounded-field bg-surface p-4 text-xs leading-6 text-muted-foreground">
          <p className="font-semibold text-ink">信息核验提醒</p>
          {competition.recommendation.dataNotices.map((notice) => (
            <p className="mt-1" key={notice}>
              {notice}
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-field bg-surface p-4 text-xs leading-6 text-muted-foreground">
          报名、评审与参赛资格可能调整，提交前请再次核对官方通知。
        </p>
      )}

      <a
        className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-button bg-[linear-gradient(135deg,#3730A3_0%,#4338CA_100%)] px-5 py-3 text-center text-sm font-semibold text-white shadow-[0_10px_24px_rgba(67,56,202,0.2)] transition-transform duration-200 hover:shadow-[0_14px_32px_rgba(67,56,202,0.3)] motion-safe:hover:-translate-y-0.5 motion-reduce:transform-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        href={competition.sourceUrl}
        onClick={onSourceClick && (() => onSourceClick(competition.id))}
        rel="noopener noreferrer"
        target="_blank"
      >
        查看公开来源（新窗口）
        <ExternalLinkIcon />
      </a>
    </article>
  );
}

function DetailSection({ title, children }: { title: string; children: string }) {
  return (
    <section className="py-5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-7 text-muted-foreground">{children}</p>
    </section>
  );
}

function ListSection({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <section className="py-5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
        {items.map((item) => (
          <li className="flex gap-3" key={item}>
            <span
              aria-hidden="true"
              className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CitedFact({
  label,
  text,
  sources
}: {
  label: string;
  text: string;
  sources: CompetitionFactSheet["sources"];
}) {
  return text.split(/(〔\d+〕)/u).map((part, index) => {
    const ref = /^〔(\d+)〕$/u.exec(part);
    const source = ref && sources[Number(ref[1]) - 1];
    return source ? (
      <a
        aria-label={`${label}出处 ${ref[1]}：${source.title}（新窗口）`}
        className="inline-block rounded px-0.5 font-semibold text-brand-700 underline underline-offset-4 focus-visible:outline focus-visible:outline-2"
        href={source.url}
        key={index}
        rel="noopener noreferrer"
        target="_blank"
      >
        {part}
      </a>
    ) : (
      part
    );
  });
}

function ExternalLinkIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M14 5h5v5M19 5l-8 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
