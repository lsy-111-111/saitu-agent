import type { MetadataRoute } from "next";
import { seo } from "@/content/seo";
import { site } from "@/content/site";

function siteUrl(path = "/") {
  return new URL(path, process.env.NEXT_PUBLIC_SITE_URL ?? site.seoBaseUrl).toString();
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...seo.robotsDisallowRoutes]
    },
    sitemap: siteUrl("/sitemap.xml")
  };
}
