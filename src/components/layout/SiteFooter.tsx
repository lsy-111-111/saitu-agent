import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";
import type { NavigationItem } from "@/content/navigation";
import { site } from "@/content/site";

export function SiteFooter({ items }: { items: readonly NavigationItem[] }) {
  return (
    <footer className="border-t border-border bg-surface px-5 py-10 sm:px-7">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-7 md:flex-row md:items-start md:justify-between">
          <div className="max-w-lg">
            <Link className="inline-flex items-center gap-2.5 rounded-lg" href="/">
              <BrandMark />
            </Link>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{site.siteDescription}</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{site.placeholders.brandNotice}</p>
          </div>
          <nav aria-label="页脚导航" className="flex max-w-xl flex-wrap gap-x-5 gap-y-3 text-sm font-medium text-ink/65">
            {items.map((item) => <Link className="inline-flex min-h-11 items-center transition hover:text-brand-600" href={item.href} key={item.href}>{item.label}</Link>)}
          </nav>
        </div>
        <div className="mt-8 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>联系邮箱：{site.contactEmail}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <a className="transition hover:text-brand-600" href={site.icpRecord.href} rel="noopener noreferrer" target="_blank">{site.icpRecord.label}</a>
            {site.policeRecord.label ? (
              <a className="inline-flex items-center gap-1 transition hover:text-brand-600" href={site.policeRecord.href} rel="noopener noreferrer" target="_blank">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" aria-hidden="true" className="h-3.5 w-3.5" src="/beian-police-badge.png" />
                {site.policeRecord.label}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </footer>
  );
}
