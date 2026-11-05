import { expect, test } from "@playwright/test";
import { expectNoindex } from "./helpers";

const savedStore = {
  schemaVersion: "saitu.savedCompetitions.v1",
  entries: [
    ["future-aircraft-design", 1, "best-match", 92],
    ["vocational-innovation-entrepreneurship", 2, "practical", 86],
    ["iot-design", 3, "stretch", 81]
  ].map(([competitionId, rank, role, baseMatchScore]) => ({
    competitionId,
    source: "competition-recommendation",
    batchId: "2026-08-22T08:00:00.000Z:e2e",
    firstSavedAt: "2026-08-22T08:00:00.000Z",
    latestSavedAt: "2026-08-22T08:00:00.000Z",
    recommendation: {
      rank,
      role,
      baseMatchScore,
      scoreBreakdown: {
        interest: 20,
        background: 18,
        goal: 16,
        difficulty: 12,
        access: 12,
        feasibility: 12,
        completenessPenalty: 0
      },
      rankingSource: "deepseek",
      registrationStatus: { status: "unknown", label: "请核验本届通知" },
      dataNotices: ["报名时间待核验"],
      explanation: {
        matchReasons: ["与本次结构化条件匹配。"],
        possibleGaps: ["需要核验本届参赛条件。"],
        preparationTips: ["从官方通知和最小作品开始。"]
      },
      catalogVersion: "e2e-catalog.v1",
      scorerVersion: "e2e-scorer.v1",
      promptVersion: "e2e-prompt.v1",
      fallbackUsed: false,
      fallbackMode: "none"
    }
  }))
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((store) => {
    window.localStorage.setItem("saitu.savedCompetitions.v1", JSON.stringify(store));
  }, savedStore);
});

test("我的竞赛读取三项快照，可查看详情、移除和确认清空", async ({ page }) => {
  await page.goto("/competitions/saved");
  await expectNoindex(page);
  await expect(page.getByText(/历史快照未记录赛道/)).toHaveCount(3);

  await expect(page.getByRole("heading", { level: 1, name: "我的竞赛" })).toBeVisible();
  await expect(page.getByText("已保存 3 项")).toBeVisible();
  const items = page.getByTestId("saved-competition-item");
  await expect(items).toHaveCount(3);
  await expect(page.getByText("历史基础分")).toHaveCount(3);
  await expect(page.getByText("推荐理由", { exact: true })).toHaveCount(3);
  await expect(page.getByText("可能差距", { exact: true })).toHaveCount(3);
  await expect(page.getByText("准备建议", { exact: true })).toHaveCount(3);

  await items.first().getByRole("button", { name: "查看详情" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "关闭竞赛详情" }).click();

  await items.first().getByRole("button", { name: "移除" }).click();
  await expect(items).toHaveCount(2);
  await expect(items.first().getByRole("button", { name: "移除" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => {
    const raw = window.localStorage.getItem("saitu.savedCompetitions.v1");
    return raw ? JSON.parse(raw).entries.length : -1;
  })).toBe(2);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "清空全部" }).click();
  await expect(page.getByTestId("saved-competitions-empty")).toBeVisible();
  await expect(page.getByRole("heading", { name: "还没有保存的竞赛" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("saitu.savedCompetitions.v1"))).toBeNull();
});

test("首页次要入口直达我的竞赛", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "我的竞赛", exact: true })).toHaveAttribute("href", "/competitions/saved");
});
