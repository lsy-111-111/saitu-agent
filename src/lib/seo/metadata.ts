import type { Metadata } from "next";
import { site } from "@/content/site";

type MetadataInput = {
  title?: string;
  description?: string;
  canonical?: string;
  path?: string;
  index?: boolean;
};

export function createMetadata({
  title = site.defaultTitle,
  description = site.defaultDescription,
  canonical: canonicalPath,
  path = "/",
  index = true
}: MetadataInput = {}): Metadata {
  const canonical = new URL(canonicalPath ?? path, site.seoBaseUrl).toString();

  return {
    title,
    description,
    alternates: {
      canonical
    },
    robots: {
      index,
      follow: index
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: site.siteName,
      locale: "zh_CN",
      type: "website"
    }
  };
}
