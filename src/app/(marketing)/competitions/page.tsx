import type { Metadata } from "next";
import { CompetitionBoard } from "@/components/competitions/CompetitionBoard";
import { CompetitionPageHero } from "@/components/competitions/CompetitionPageHero";
import { Section } from "@/components/layout/Section";
import { seo } from "@/content/seo";
import {
  parseCompetitionDirection,
  parseCompetitionPage,
  parseCompetitionQuery
} from "@/lib/competitions/search";
import { createMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createMetadata(seo.pages.competitions);

type CompetitionsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CompetitionsPage({ searchParams }: CompetitionsPageProps) {
  const params = await searchParams;
  const availabilityAsOfMs = Date.now();
  const initialQuery = parseCompetitionQuery(params.q);
  const initialDirection = parseCompetitionDirection(params.direction);
  const initialPage = parseCompetitionPage(params.page);

  return (
    <main className="bg-paper">
      <Section className="pb-14 pt-8 md:pb-20 md:pt-12" wide>
        <div className="mx-auto max-w-[1240px]">
          <CompetitionPageHero />
          <CompetitionBoard
            availabilityAsOfMs={availabilityAsOfMs}
            initialDirection={initialDirection}
            initialPage={initialPage}
            initialQuery={initialQuery}
          />
        </div>
      </Section>
    </main>
  );
}
