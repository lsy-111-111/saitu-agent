import { expect, test } from "@playwright/test";

// Browser plugin not available. Public library migration uses the repo runner.
test.use({ launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} });
test("public library and detail use historical references and official self-checks", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/competitions?q=能源经济");
  const cards = page.getByTestId("competition-card");
  await expect(cards.first()).toBeVisible();
  await expect(cards.first()).toContainText("赛事资料参考");
  await expect(cards.first()).not.toContainText(/当前可报名|全国报名窗口内/);
  await page.screenshot({ path: testInfo.outputPath("public-catalog-neutral.png"), fullPage: false });
  await cards.first().screenshot({ path: testInfo.outputPath("public-catalog-card-neutral.png") });
  await page.goto("/competitions/energy-economics-academic-creativity");
  await expect(page).toHaveTitle(/竞赛|能源/);
  await expect(page.getByText("赛事资料参考", { exact: true })).toBeVisible();
  await expect(page.getByText("资料按标注届次保留，历史内容用于了解任务与准备方向；参赛资格和开赛时间请自行核查官网。", { exact: true })).toBeVisible();
  await expect(page.getByText(/全国报名窗口内|官方全国报名窗口目前开放/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "查看公开来源（新窗口）", exact: true })).toHaveAttribute("href", /^https?:\/\//);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("public-detail-historical.png"), fullPage: false });
  expect(errors).toEqual([]);
});
