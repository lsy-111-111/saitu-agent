import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompetitionDetailContent } from "@/components/competitions/CompetitionDetailContent";
import { findCanonicalCatalogCompetition } from "@/lib/competitions/catalog";
import { createMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
type DetailPageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: DetailPageProps): Promise<Metadata> {
  const competition = findCanonicalCatalogCompetition((await params).id);
  if (!competition) notFound();
  return createMetadata({
    title: competition.name,
    description: competition.summary,
    canonical: `/competitions/${competition.id}`
  });
}

export default async function CompetitionDetailPage({ params }: DetailPageProps) {
  const competition = findCanonicalCatalogCompetition((await params).id);
  if (!competition) notFound();
  return (
    <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-5 sm:px-7 md:pt-8">
      <Link className="mb-4 inline-flex min-h-11 items-center font-semibold text-brand-700 underline underline-offset-4" href="/competitions">返回竞赛目录</Link>
      <CompetitionDetailContent competition={competition} headingId="competition-detail-title" headingLevel="h1" />
    </main>
  );
}
