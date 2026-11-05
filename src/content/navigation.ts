import { site } from "./site";

export type NavigationItem = {
  label: string;
  href: string;
};

export const navigation = {
  header: [
    { label: "竞赛助手", href: "/competitions/recommend" },
    { label: "竞赛信息", href: "/competitions" },
    { label: "竞赛组队", href: "/teams" },
    { label: "关于我们", href: "/about" }
  ],
  footer: [
    { label: "首页", href: "/" },
    { label: "竞赛助手", href: "/competitions/recommend" },
    { label: "竞赛信息", href: "/competitions" },
    { label: "竞赛组队", href: "/teams" },
    { label: "关于我们", href: "/about" },
    ...site.legalLinks
  ],
  mobileCTA: {
    primary: { label: "帮我选第一场竞赛", href: "/competitions/recommend" },
    secondary: { label: "浏览竞赛信息", href: "/competitions" }
  }
} as const;
export function getNavigationItems() {
  return {
    header: [...navigation.header],
    footer: [...navigation.footer]
  };
}
