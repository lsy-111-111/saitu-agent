import { site } from "@/content/site";
import { competitions } from "@/content/competitions";

function siteUrl(path = "/") {
  return new URL(path, process.env.NEXT_PUBLIC_SITE_URL ?? site.seoBaseUrl).toString();
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function createWebsiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.siteName,
    description: site.siteDescription,
    url: siteUrl("/"),
    hasPart: [
      { "@type": "CollectionPage", name: "竞赛信息", url: siteUrl("/competitions") },
      { "@type": "AboutPage", name: "关于我们", url: siteUrl("/about") }
    ],
    mainEntity: {
      "@type": "ItemList",
      name: "赛途 Campus 大学生竞赛目录",
      numberOfItems: competitions.length,
      itemListElement: competitions.map((competition, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Thing",
          name: competition.name,
          sameAs: competition.sourceUrl
        }
      }))
    }
  };
}
