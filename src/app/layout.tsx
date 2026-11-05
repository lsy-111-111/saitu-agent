import type { Metadata } from "next";
import { connection } from "next/server";
import { AnalyticsBootstrap } from "@/components/analytics/AnalyticsBootstrap";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { getNavigationItems } from "@/content/navigation";
import { site } from "@/content/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.seoBaseUrl),
  title: {
    default: site.defaultTitle,
    template: `%s | ${site.siteName}`
  },
  description: site.defaultDescription
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A fresh CSP nonce is generated per request by middleware. Nonces cannot be
  // attached to statically generated HTML, so all HTML routes render per request.
  await connection();
  const { footer, header } = getNavigationItems();

  return (
    <html lang="zh-CN">
      <body className="flex min-h-screen flex-col">
        <a
          className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-button bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-action transition-transform focus:translate-y-0 motion-reduce:transition-none"
          href="#main-content"
        >
          跳到主要内容
        </a>
        <AnalyticsBootstrap />
        <SiteHeader items={header} />
        <div className="flex-1" id="main-content" tabIndex={-1}>{children}</div>
        <SiteFooter items={footer} />
      </body>
    </html>
  );
}
