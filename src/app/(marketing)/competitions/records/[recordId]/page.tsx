import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DecisionCatalogDetail } from "@/components/competitions/DecisionCatalogDetail";
import { decisionRecordHref, resolvePublishedDecisionRoute } from "@/lib/competitions/v6/public-catalog";
import { createMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ recordId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const record = resolvePublishedDecisionRoute((await params).recordId);
  if (!record) notFound();
  return createMetadata({ title: `${record.name} · ${record.edition}`, description: record.summary, canonical: decisionRecordHref(record.recordId) });
}

export default async function ReviewedCompetitionPage({ params }: Props) {
  const record = resolvePublishedDecisionRoute((await params).recordId);
  if (!record) notFound();
  return <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-5 sm:px-7 md:pt-8">
    <Link className="mb-4 inline-flex min-h-11 items-center font-semibold text-brand-700 underline underline-offset-4" href={`/competitions/${encodeURIComponent(record.seriesId)}`}>查看这个系列的资料</Link>
    <h1 className="text-2xl font-semibold leading-tight tracking-tight text-ink md:text-3xl">{record.name}</h1>
    <DecisionCatalogDetail record={record} />
  </main>;
}
