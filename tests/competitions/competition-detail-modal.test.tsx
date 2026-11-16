import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CompetitionBoard } from "@/components/competitions/CompetitionBoard";
import { CompetitionCard } from "@/components/competitions/CompetitionCard";
import { CompetitionDetailModal } from "@/components/competitions/CompetitionDetailModal";
import { competitions } from "@/content/competitions";

function renderModal() {
  return renderToStaticMarkup(
    React.createElement(CompetitionDetailModal, {
      competition: competitions[0],
      onClose: () => undefined,
      onSourceClick: () => undefined
    })
  );
}

describe("competition detail actions", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("keeps only competition information and the official source action", () => {
    const html = renderModal();

    expect(html).toContain("适合人群");
    expect(html).toContain("准备建议");
    expect(html).toContain("查看公开来源（新窗口）");
    expect(html).not.toContain("AI生成配图｜赛途原创主题视觉，非赛事官方标识");
    expect(html).toContain(encodeURIComponent(competitions[0].coverImage.src));
    expect(html).not.toContain("/discussions");
    expect(html).not.toContain("/builder");
  });

  it("does not render a default detail panel or dialog in the directory", () => {
    const html = renderToStaticMarkup(React.createElement(CompetitionBoard));

    expect(html).not.toContain("competition-detail-panel");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("正在查看详情");
  });

  it("keeps the card as one detail action and leaves the official source in the dialog", () => {
    const html = renderToStaticMarkup(
      React.createElement(CompetitionCard, {
        competition: competitions[0],
        onOpen: () => undefined
      })
    );

    expect(html).toContain(`查看竞赛详情：${competitions[0].name}`);
    expect(html).not.toContain(`打开公开来源：${competitions[0].name}（新窗口）`);
    expect(html).not.toContain(`href="${competitions[0].sourceUrl}"`);
    expect(html).not.toContain("data-selected");
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("AI生成配图｜赛途原创主题视觉，非赛事官方标识");
    expect(html).toContain(encodeURIComponent(competitions[0].coverImage.src));
  });

  it("keeps public cards and detail headers neutral even during a historical registration window", () => {
    const competition = competitions.find(item => item.id === "energy-economics-academic-creativity")!;
    const card = (at: string) => renderToStaticMarkup(<CompetitionCard competition={competition} availabilityNow={new Date(at)} onOpen={vi.fn()} />);
    expect(card("2026-11-20T00:00:00+08:00")).toBe(card("2027-01-20T00:00:00+08:00"));
    const html = renderToStaticMarkup(<CompetitionDetailModal competition={competition} availabilityNow={new Date("2026-11-20T00:00:00+08:00")} onClose={vi.fn()} onSourceClick={vi.fn()} />);
    expect(html).toContain("赛事资料参考");
    expect(html).toContain("资料按标注届次保留，历史内容用于了解任务与准备方向");
    expect(html).toContain("参赛资格和开赛时间请自行核查官网");
    expect(html).not.toContain("全国报名窗口内");
    expect(html).not.toContain("全国学生团队报名窗口。");
  });
});
