import type { Metadata } from "next";
import { SavedCompetitionsClient } from "@/components/competitions/SavedCompetitionsClient";
import { Section } from "@/components/layout/Section";
import { createMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createMetadata({
  title: "我的竞赛 | 赛途 Campus",
  description: "查看保存在当前浏览器中的竞赛助手推荐。",
  path: "/competitions/saved",
  index: false
});

export default function SavedCompetitionsPage() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-white">
      <Section className="pb-16 pt-9 md:pb-24 md:pt-14" wide>
        <SavedCompetitionsClient />
      </Section>
    </main>
  );
}
