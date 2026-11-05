import { headers } from "next/headers";
import { CompetitionHeroSection } from "@/components/marketing/CompetitionHeroSection";
import { InformationPrinciples } from "@/components/marketing/InformationPrinciples";
import { seo } from "@/content/seo";
import { createMetadata } from "@/lib/seo/metadata";
import { createWebsiteJsonLd, serializeJsonLd } from "@/lib/seo/structured-data";

export const metadata = createMetadata(seo.pages.home);

export default async function HomePage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <main>
      <script
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(createWebsiteJsonLd())
        }}
        nonce={nonce}
        suppressHydrationWarning
        type="application/ld+json"
      />
      <CompetitionHeroSection />
      <InformationPrinciples />
    </main>
  );
}
