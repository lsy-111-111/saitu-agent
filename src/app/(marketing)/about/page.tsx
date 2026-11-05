import type { Metadata } from "next";
import { AboutPageContent } from "@/components/about/AboutPageContent";
import { seo } from "@/content/seo";
import { createMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createMetadata(seo.pages.about);

export default function AboutPage() {
  return (
    <main className="bg-paper">
      <AboutPageContent />
    </main>
  );
}
