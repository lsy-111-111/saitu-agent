import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompetitionRecommendationWizard } from "@/components/competitions/recommend/CompetitionRecommendationWizard";
import { seo } from "@/content/seo";
import { getCurrentAiConsentDisclosure } from "@/lib/ai/consent-disclosure";
import { isCompetitionRecommenderEnabled } from "@/lib/config/features";
import { createMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createMetadata(seo.pages.competitionRecommend);
export const dynamic = "force-dynamic";

export default function CompetitionRecommendationPage() {
  if (!isCompetitionRecommenderEnabled()) {
    notFound();
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-white pb-16">
      <section className="px-5 pb-12 pt-5 md:pb-20 md:pt-8">
        <div className="mx-auto w-full max-w-[1516px]">
          <CompetitionRecommendationWizard aiConsentDisclosure={getCurrentAiConsentDisclosure()} />
        </div>
      </section>
    </main>
  );
}
