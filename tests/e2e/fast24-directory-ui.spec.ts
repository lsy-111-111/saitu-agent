import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Browser plugin not available. Read-only public route/UI checks; no AI calls.
const metadata = JSON.parse(readFileSync("artifacts/fast24-20261109/C/directory-167-plan/missing-15-existing-metadata.json", "utf8")) as { seriesId: string; name: string; recordId: string; officialCandidates: { url: string; title: string; publisher: string; scope: string }[] }[];
const core = JSON.parse(readFileSync("artifacts/fast24-20261109/C/directory-167-plan/before-matching-pool-binding.json", "utf8")) as { recordIds: string[] };

test("all15 basic series and original45 exact details remain addressable", async ({ request }, testInfo) => {
  const observations = [];
  for (const entry of metadata) {
    const response = await request.get(`/competitions/${entry.seriesId}`), body = await response.text();
    expect(response.status(), entry.seriesId).toBe(200); expect(body).toContain("series-basic-information"); expect(body).not.toContain("decision-catalog-detail");
    expect((await request.get(`/competitions/records/${encodeURIComponent(entry.recordId)}`)).status()).toBe(404);
    observations.push({ seriesId: entry.seriesId, seriesStatus: response.status(), unreviewedExactDetailStatus: 404 });
  }
  for (const id of core.recordIds) expect((await request.get(`/competitions/records/${encodeURIComponent(id)}`)).status(), id).toBe(200);
  expect((await request.get("/competitions/missing-competition-xyz")).status()).toBe(404);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const entry of metadata) expect(sitemap).toContain(`/competitions/${entry.seriesId}`);
  await testInfo.attach("readonly-route-statuses", { contentType: "application/json", body: Buffer.from(JSON.stringify({ observations, checkedExactDetailCount: core.recordIds.length, paidCalls: 0 }, null, 2)) });
});

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 393, height: 851 }]) {
  test(`167 directory search and basic official materials: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/api/**", route => new URL(route.request().url()).pathname === "/api/track" ? route.fulfill({ status: 204 }) : route.abort("blockedbyclient"));
    await page.goto("/competitions");
    await expect(page).toHaveTitle(/竞赛/); await expect(page.getByTestId("competition-directory-total")).toContainText("167");
    await expect(page.locator("[data-directory-series]")).toHaveCount(32);
    await page.screenshot({ path: testInfo.outputPath(`directory-first-${viewport.name}.png`), fullPage: false });
    for (const id of ["schneider-go-green", "national-software-testing"]) {
      const entry = metadata.find(item => item.seriesId === id)!;
      await page.getByRole("searchbox", { name: "搜索竞赛", exact: true }).fill(entry.name);
      const card = page.locator(`[data-directory-series="${id}"]`);
      await expect(card).toBeVisible(); await expect(card).toContainText("尚待核对");
      const officialUrl = await card.getByRole("link", { name: `查看官方资料：${entry.name}`, exact: true }).getAttribute("href");
      const officialSource = entry.officialCandidates.find(source => source.url === officialUrl)!;
      expect(officialSource).toBeDefined();
      await card.getByRole("link", { name: entry.name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/competitions/${id}$`));
      await expect(page.getByRole("heading", { level: 1, name: entry.name, exact: true })).toBeVisible();
      await expect(page.getByTestId("series-basic-information")).toBeVisible();
      await expect(page.getByTestId("decision-catalog-detail")).toHaveCount(0);
      await expect(page.getByTestId("reviewed-record-links")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "查看官方资料（新窗口）", exact: true })).toHaveAttribute("href", officialSource.url);
      await expect(page.locator("main")).toContainText(officialSource.scope);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${id}-${viewport.name}.png`), fullPage: false });
      await page.getByRole("link", { name: "返回竞赛目录", exact: true }).click();
    }
    await expect(page.locator("body")).not.toContainText(/Unhandled Runtime Error|Application error: a client-side exception|Build Error/);
    expect(errors).toEqual([]);
  });
}
