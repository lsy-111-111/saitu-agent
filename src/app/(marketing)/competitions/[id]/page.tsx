import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompetitionDetailContent } from "@/components/competitions/CompetitionDetailContent";
import { findCanonicalCatalogCompetition } from "@/lib/competitions/catalog";
import { createMetadata } from "@/lib/seo/metadata";
import { getDecisionRecord } from "@/lib/competitions/v6/catalog";
import { getPublishedDecisionRecords } from "@/lib/competitions/v6/public-catalog";
import { ReviewedRecordLinks } from "@/components/competitions/ReviewedRecordLinks";
import { findDirectorySeries } from "@/lib/competitions/directory-series";

export const dynamic = "force-dynamic";
type DetailPageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: DetailPageProps): Promise<Metadata> {
  const id = (await params).id;
  const competition = findCanonicalCatalogCompetition(id);
  const series = competition ? undefined : findDirectorySeries(id);
  if (!competition && !series) notFound();
  return createMetadata({
    title: competition?.name ?? series!.name,
    description: competition?.summary ?? series!.summary,
    canonical: `/competitions/${encodeURIComponent(id)}`
  });
}

export default async function CompetitionDetailPage({ params }: DetailPageProps) {
  const id = (await params).id;
  const competition = findCanonicalCatalogCompetition(id);
  const series = competition ? undefined : findDirectorySeries(id);
  const records = getPublishedDecisionRecords().filter(record => record.seriesId === id);
  if (!competition && !series) notFound();
  return (
    <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-5 sm:px-7 md:pt-8">
      <Link className="mb-4 inline-flex min-h-11 items-center font-semibold text-brand-700 underline underline-offset-4" href="/competitions">返回竞赛目录</Link>
      {competition ? <CompetitionDetailContent competition={competition} decisionRecord={getDecisionRecord(competition.id)} recordLinks={<ReviewedRecordLinks records={records} />} headingId="competition-detail-title" headingLevel="h1" /> : <>
        <h1 id="competition-detail-title" className="text-2xl font-semibold leading-tight text-ink md:text-3xl">{series!.name}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">主办及组织信息：{series!.organizer}</p>
        {series!.officialSource ? <section className="mt-5 rounded-2xl border border-border bg-white p-5" aria-label="已有官方资料">
          <a className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline" href={series!.officialSource.url} target="_blank" rel="noopener noreferrer">查看官方资料（新窗口）</a>
          <p className="mt-2 text-sm leading-6">{series!.officialSource.title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">发布方：{series!.officialSource.publisher}{series!.officialSource.scope ? ` · 资料范围：${series!.officialSource.scope}` : ""}</p>
        </section> : <p className="mt-4 text-sm leading-6 text-muted-foreground">官方资料入口尚待核对。</p>}
        {records.length ? <ReviewedRecordLinks records={records} /> : <section className="mt-5 rounded-2xl border border-border bg-slate-50 p-5" data-testid="series-basic-information">
          <h2 className="text-lg font-semibold">赛事基本资料</h2>
          <p className="mt-2 text-sm leading-7">具体任务、准备建议与完整参赛要求尚待核实。参赛资格、开赛时间和费用请自行核对对应官方资料。</p>
        </section>}
      </>}
    </main>
  );
}
