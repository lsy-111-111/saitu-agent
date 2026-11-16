import type { MetadataRoute } from "next";
import { site } from "@/content/site";
import { getDirectorySeries } from "@/lib/competitions/directory-series";
import { getCompetitionFactSheet } from "@/content/competition-facts";

const indexableRoutes = ["/", "/competitions", "/about", "/privacy", "/terms"] as const;

function siteUrl(path: string) {
  return new URL(path, process.env.NEXT_PUBLIC_SITE_URL ?? site.seoBaseUrl).toString();
}

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = indexableRoutes.map((route) => ({
    url: siteUrl(route),
    lastModified: "2026-11-05",
    changeFrequency: route === "/" ? "weekly" : "monthly",
    priority: route === "/" ? 1 : 0.7
  }));
  return [...pages, ...getDirectorySeries().map(series => ({
    url: siteUrl(`/competitions/${series.seriesId}`),
    lastModified: getCompetitionFactSheet(series.seriesId)?.checkedAt ?? series.officialSource?.checkedAt ?? undefined,
    changeFrequency: "monthly" as const,
    priority: 0.6
  }))];
}
