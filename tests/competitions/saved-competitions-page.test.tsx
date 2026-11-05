import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SavedCompetitionsClient } from "@/components/competitions/SavedCompetitionsClient";
import { metadata } from "@/app/(marketing)/competitions/saved/page";

describe("我的竞赛页面", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("使用当前浏览器的文件夹式标题轨", () => {
    const html = renderToStaticMarkup(<SavedCompetitionsClient />);

    expect(html).toContain("我的竞赛");
    expect(html).toContain("保存在当前浏览器中的竞赛");
    expect(html).toContain("清除该站点的浏览器数据后会丢失");
    expect(html).toContain("正在读取当前浏览器中的竞赛");
  });

  it("明确设置 noindex", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
