import { describe, expect, it } from "vitest";
import { getNavigationItems, navigation } from "@/content/navigation";

describe("public navigation", () => {
  it("exposes only the retained product areas and legal pages", () => {
    expect(getNavigationItems()).toEqual({
      header: [...navigation.header],
      footer: [...navigation.footer]
    });

    expect(navigation.header).toEqual([
      { label: "竞赛助手", href: "/competitions/recommend" },
      { label: "竞赛信息", href: "/competitions" },
      { label: "竞赛组队", href: "/teams" },
      { label: "关于我们", href: "/about" }
    ]);
    expect(navigation.footer.map((item) => item.href)).toEqual([
      "/",
      "/competitions/recommend",
      "/competitions",
      "/teams",
      "/about",
      "/privacy",
      "/terms"
    ]);
  });
});
