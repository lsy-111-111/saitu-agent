import type { Metadata } from "next";
import { Section } from "@/components/layout/Section";
import { Card } from "@/components/ui/Card";
import { legalPages } from "@/content/legal";
import { seo } from "@/content/seo";
import { createMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createMetadata(seo.pages.terms);

export default function TermsPage() {
  const page = legalPages.terms;

  return (
    <main className="bg-paper">
      <Section className="pb-24 pt-10 md:pt-16" narrow>
        <div className="mb-9 border-b border-border pb-8">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="h-1.5 w-8 rounded-full bg-[linear-gradient(90deg,#3730A3_0%,#06B6D4_100%)]" />
            <p className="text-sm font-semibold tracking-[0.1em] text-brand-700">{page.eyebrow}</p>
          </div>
          <h1 className="mt-4 font-serif text-4xl font-semibold tracking-[-0.03em] text-ink md:text-5xl">{page.title}</h1>
          <p className="mt-5 text-sm leading-7 text-muted-foreground md:text-base">{page.description}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            {page.updatedAtLabel}
            {page.updatedAt}
          </p>
        </div>

        <Card className="rounded-[22px] p-6 md:p-9">
          <p className="rounded-field border border-brand-200 border-l-4 border-l-brand-500 bg-surface p-4 text-sm leading-7 text-ink/90">{page.notice}</p>
          <div className="mt-9 grid">
            {page.sections.map((section) => (
              <section className="border-t border-border py-8 first:border-t-0 first:pt-0 last:pb-0" key={section.title}>
                <h2 className="text-xl font-semibold text-ink">{section.title}</h2>
                <div className="mt-4 grid gap-3">
                  {section.body.map((paragraph) => (
                    <p className="text-sm leading-7 text-muted-foreground" key={paragraph}>
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Card>
      </Section>
    </main>
  );
}
