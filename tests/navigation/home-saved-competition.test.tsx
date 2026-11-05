import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CompetitionHeroSection } from "@/components/marketing/CompetitionHeroSection";

describe("首页我的竞赛入口", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("将次要按钮指向已保存竞赛", () => {
    const html = renderToStaticMarkup(<CompetitionHeroSection />);

    expect(html).toContain('href="/competitions/saved"');
    expect(html).toContain("我的竞赛");
    expect(html).not.toContain("先浏览竞赛信息");
  });
});
