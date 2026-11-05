import newSeries from "../../src/content/competition-series-20261104.json";
import { expect, test } from "@playwright/test";
import { expectIndexable, expectNoindex } from "./helpers";

const CATALOG_SIZE = 100 + newSeries.length;
const LAST_PAGE = Math.ceil(CATALOG_SIZE / 12);
const posterDisclosure = "AI生成配图｜赛途原创主题视觉，非赛事官方标识";

const retiredLinkSelector = [
  'a[href^="/discussions"]',
  'a[href="/templates"]',
  'a[href^="/start"]',
  'a[href^="/check"]',
  'a[href^="/builder"]',
  'a[href^="/export"]'
].join(",");

test("competition directory supports filtering and opens details in one responsive dialog", async ({ page, isMobile }) => {
  await page.goto("/competitions");
  await expectIndexable(page);

  await expect(page.getByRole("heading", { name: "找到适合你的大学生竞赛入口" })).toBeVisible();
  await expect(page.getByText("当前收录", { exact: true })).toHaveCount(0);
  const directoryLele = page.getByAltText("乐乐手持资料夹介绍竞赛目录");
  await expect(directoryLele).toBeVisible();
  await expect(directoryLele).toHaveJSProperty("complete", true);
  await expect(page.getByTestId("lele-half-body-portrait")).toBeVisible();
  await expect(page.getByTestId("competition-card")).toHaveCount(12);
  const coverImages = page.getByTestId("competition-cover-image");
  await expect(coverImages).toHaveCount(12);
  await expect(page.getByText(posterDisclosure, { exact: true })).toHaveCount(0);
  for (let index = 0; index < 12; index += 1) {
    const image = coverImages.nth(index);
    await image.scrollIntoViewIfNeeded();
    await expect(image).toHaveJSProperty("complete", true);
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByTestId("competition-detail-panel")).toHaveCount(0);
  await expect(page.locator(retiredLinkSelector)).toHaveCount(0);

  const gridColumns = await page.getByTestId("competition-grid").evaluate((element) =>
    window.getComputedStyle(element).gridTemplateColumns.split(" ").length
  );
  expect(gridColumns).toBe(isMobile ? 1 : 4);

  const targetName = "中国国际大学生创新大赛";
  const detailTrigger = page.getByRole("button", { name: `查看竞赛详情：${targetName}`, exact: true });
  await detailTrigger.click();

  const dialog = page.getByRole("dialog", { name: targetName });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("competition-cover-image")).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "适合人群" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "准备建议" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "查看公开来源（新窗口）" })).toHaveAttribute("target", "_blank");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  const closeDialogButton = dialog.getByRole("button", { name: "关闭竞赛详情" });
  await expect(closeDialogButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("link", { name: "查看公开来源（新窗口）" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeDialogButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await expect(detailTrigger).toBeFocused();

  const filterButton = page.getByRole("button", { name: "筛选", exact: true });
  await filterButton.click();
  const filterDialog = page.getByRole("dialog", { name: "筛选竞赛方向" });
  const directionRadio = filterDialog.getByRole("radio", { name: "工程与制造" });
  await directionRadio.focus();
  await directionRadio.press("Space");
  await expect(directionRadio).toBeChecked();
  await expect(directionRadio).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Escape");
  await expect(filterDialog).toBeHidden();
  await expect(filterButton).toBeFocused();

  await page.getByRole("button", { name: "工程与制造", exact: true }).click();
  const filteredCount = await page.getByTestId("competition-card").count();
  expect(filteredCount).toBeGreaterThan(0);
  expect(filteredCount).toBeLessThan(CATALOG_SIZE);
  await expect(page.getByText(new RegExp(`展示 1-${filteredCount} /`))).toBeVisible();
});

test("competition pagination updates the URL and moves focus to the new result set", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/competitions");

  const resultSummary = page.getByTestId("competition-result-summary");
  const cards = page.getByTestId("competition-card");
  const nextPage = page.getByRole("button", { name: "下一页" });
  const previousPage = page.getByRole("button", { name: "上一页" });

  await expect(resultSummary).toContainText(`展示 1-12 / ${CATALOG_SIZE} 项符合条件的内容`);
  await nextPage.click();

  await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2");
  await expect(resultSummary).toContainText(`展示 13-24 / ${CATALOG_SIZE} 项符合条件的内容`);
  await expect(resultSummary).toBeFocused();
  await expect(page.getByRole("button", { name: "第 2 页" })).toHaveAttribute("aria-current", "page");
  await expect(cards.first().getByText("中国软件杯大学生软件设计大赛", { exact: true })).toBeVisible();

  const headerBounds = await page.locator("header").first().boundingBox();
  const summaryBounds = await resultSummary.boundingBox();
  const viewport = page.viewportSize();
  expect(headerBounds).not.toBeNull();
  expect(summaryBounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(summaryBounds!.y).toBeGreaterThanOrEqual(headerBounds!.y + headerBounds!.height);
  expect(summaryBounds!.y).toBeLessThan(viewport!.height / 2);

  await previousPage.click();
  await expect.poll(() => new URL(page.url()).searchParams.has("page")).toBe(false);
  await expect(resultSummary).toContainText(`展示 1-12 / ${CATALOG_SIZE} 项符合条件的内容`);
  await expect(resultSummary).toBeFocused();

  await page.getByRole("button", { name: `第 ${LAST_PAGE} 页` }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe(String(LAST_PAGE));
  await expect(resultSummary).toContainText(`展示 ${(LAST_PAGE - 1) * 12 + 1}-${CATALOG_SIZE} / ${CATALOG_SIZE} 项符合条件的内容`);
  await expect(cards).toHaveCount(CATALOG_SIZE - (LAST_PAGE - 1) * 12);
  await expect(nextPage).toBeDisabled();
});

test("competition search restores URL state, combines filters, and clears predictably", async ({ page }) => {
  const direction = "人工智能与物联";
  const initialQuery = "IOT 传感器";
  await page.goto(
    `/competitions?campaign=campus&q=${encodeURIComponent(initialQuery)}&direction=${encodeURIComponent(direction)}#competition-directory-title`
  );
  await expectIndexable(page);

  const searchRegion = page.getByRole("search");
  const searchBox = searchRegion.getByRole("searchbox", { name: "搜索竞赛" });
  const resultAnnouncement = page.locator('[aria-live="polite"][aria-atomic="true"]').filter({
    hasText: "展示"
  });

  await expect(searchBox).toHaveValue(initialQuery);
  await expect(page.getByRole("button", { name: direction, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("competition-card")).toHaveCount(1);
  await expect(page.getByText("全国大学生物联网设计竞赛", { exact: true })).toBeVisible();
  await expect(resultAnnouncement).toContainText("展示 1-1 / 1 项符合条件的内容");

  await page.reload();
  await expect(searchBox).toHaveValue(initialQuery);
  await expect(page.getByTestId("competition-card")).toHaveCount(1);

  const searchBoxBounds = await searchBox.boundingBox();
  const viewport = page.viewportSize();
  expect(searchBoxBounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(searchBoxBounds!.x).toBeGreaterThanOrEqual(0);
  expect(searchBoxBounds!.x + searchBoxBounds!.width).toBeLessThanOrEqual(viewport!.width);

  const clearSearch = page.getByRole("button", { name: "清除搜索" });
  const clearBounds = await clearSearch.boundingBox();
  expect(clearBounds).not.toBeNull();
  expect(clearBounds!.width).toBeGreaterThanOrEqual(44);
  expect(clearBounds!.height).toBeGreaterThanOrEqual(44);
  await clearSearch.click();

  await expect(searchBox).toHaveValue("");
  await expect(searchBox).toBeFocused();
  const directionCount = await page.getByTestId("competition-card").count();
  expect(directionCount).toBeGreaterThan(1);
  expect(directionCount).toBeLessThan(CATALOG_SIZE);
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get("direction")).toBe(direction);
  expect(new URL(page.url()).searchParams.get("campaign")).toBe("campus");
  expect(new URL(page.url()).hash).toBe("#competition-directory-title");

  await searchBox.fill("完全不存在的竞赛");
  await expect(page.getByTestId("competition-empty-state")).toBeVisible();
  await expect(page.getByTestId("competition-card")).toHaveCount(0);
  await expect(resultAnnouncement).toContainText("展示 0-0 / 0 项符合条件的内容");

  await page.getByRole("button", { name: "清除搜索与筛选" }).click();
  await expect(searchBox).toHaveValue("");
  await expect(resultAnnouncement).toBeFocused();
  await expect(page.getByRole("button", { name: "全部方向", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("competition-card")).toHaveCount(12);
  await expect.poll(() => new URL(page.url()).searchParams.has("direction")).toBe(false);
  await expect.poll(() => new URL(page.url()).searchParams.has("q")).toBe(false);
  expect(new URL(page.url()).searchParams.get("campaign")).toBe("campus");
  expect(new URL(page.url()).hash).toBe("#competition-directory-title");

  await searchBox.fill("飞行器");
  const targetName = "“创新杯”第十二届全国未来飞行器设计大赛";
  await page.getByRole("button", { name: `查看竞赛详情：${targetName}` }).click();
  await expect(page.getByRole("dialog", { name: targetName })).toBeVisible();

  await searchBox.evaluate((element) => {
    const input = element as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    valueSetter?.call(input, "完全不存在的竞赛");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByRole("dialog", { name: targetName })).toBeHidden();
  await expect(page.getByTestId("competition-empty-state")).toBeVisible();
});

test("retired resource bookmarks reach the competition catalog", async ({ page }) => {
  await page.goto("/resources");
  await expect(page).toHaveURL(/\/competitions$/);
  await expect(page.getByRole("search").first()).toBeVisible();
});

test("competition profiles open from the dialog and can be shared by stable ID", async ({ page, request }) => {
  await page.goto("/competitions?q=勘探地球物理");
  await page.getByRole("button", {name: "查看竞赛详情：全国大学生勘探地球物理大赛"}).click();
  await page.getByRole("dialog").getByRole("link", {name:"打开可分享的详情页"}).click();
  await expect(page).toHaveURL(/\/competitions\/exploration-geophysics$/);
  await expect(page.getByRole("heading", {level:1, name:"全国大学生勘探地球物理大赛"})).toBeVisible();
  await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", /\/competitions\/exploration-geophysics$/);
  await expect(page.getByRole("link", {name:"返回竞赛目录"})).toHaveAttribute("href","/competitions");
  const chemistry = await page.goto("/competitions/chemistry-experiment-innovation");
  expect(chemistry?.status()).toBe(200);
  await expect(page.getByRole("heading", {level:1, name:"全国大学生化学实验创新设计大赛"})).toBeVisible();
  expect((await request.get("/competitions/missing-competition-xyz")).status()).toBe(404);
});

test("a cited team requirement links directly to its supporting edition document", async ({page}) => {
  await page.goto("/competitions?q=CCPC");
  await page.getByRole("button", {name:"查看竞赛详情：中国大学生程序设计竞赛（CCPC）",exact:true}).click();
  const dialog = page.getByRole("dialog");
  const team = dialog.locator("dt").filter({hasText:"组队要求"}).locator("..");
  await expect(team).toContainText("每队3名选手");
  const secondSource = dialog.locator("ol li a").nth(1);
  const href = await secondSource.getAttribute("href");
  expect(href).toMatch(/^https?:\/\//);
  const inline = team.getByRole("link", {name:/组队要求出处 2/});
  await expect(inline).toHaveAttribute("href", href!);
  await expect(inline).toHaveAttribute("target", "_blank");
});

test("public decision pages and the sitemap omit the retired resource directory", async ({page, request}) => {
  for (const route of ["/", "/competitions", "/competitions/recommend", "/competitions/saved", "/teams", "/about", "/privacy", "/terms"]) {
    await page.goto(route);
    await expect(page.locator('a[href="/resources"], a[href^="/resources?"], a[href^="/resources/"]')).toHaveCount(0);
    await expect(page.getByTestId("assistant-intro")).toHaveCount(0);
    await expect(page.getByRole("button", {name:/下一步：竞赛(资源|组队)/})).toHaveCount(0);
  }
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBeTruthy();
  expect(await sitemap.text()).not.toMatch(/<loc>[^<]*\/resources/);
});

test("team groups show a current code or a contact path for a replacement", async ({ page }) => {
  await page.goto("/teams");
  await expectNoindex(page);
  await expect(page.getByRole("heading", { name: "找一起参赛的队友" })).toBeVisible();
  await expect(page.locator("main li")).toHaveCount(8);
  const first = page.locator("main li").first();
  await expect(first.getByRole("heading", { name: "大学生竞赛资源共享群" })).toBeVisible();
  if (Date.now() < Date.parse("2026-11-11T00:00:00+08:00")) {
    await expect(first.getByRole("img")).toBeVisible();
    await expect(first.getByRole("link")).toHaveAttribute("href", "/community/group-92.png");
  } else {
    await expect(first.getByRole("img")).toHaveCount(0);
    await expect(first.getByRole("link")).toHaveAttribute("href", "/about#contact");
  }
  await page.getByRole("link", { name: /群满或二维码失效/ }).click();
  await expect(page.getByAltText("Emily 学姐个人微信二维码")).toBeVisible();
});

test("competition service heroes keep portraits in bounds without overlapping search", async ({ page, isMobile }) => {
  test.skip(isMobile, "The desktop project covers the explicit responsive viewport matrix.");

  const pages = [
    { path: "/competitions", heroLabel: "competition-page-title" },

  ];

  for (const width of [390, 768, 1024, 1280, 1564]) {
    await page.setViewportSize({ width, height: 900 });

    for (const entry of pages) {
      await page.goto(entry.path);

      const hero = page.locator(`section[aria-labelledby="${entry.heroLabel}"]`);
      const heroLayout = entry.path === "/competitions"
        ? hero.locator(":scope > div").first()
        : hero;
      const portrait = hero.getByTestId("lele-half-body-portrait");
      const search = page.getByRole("search").first();
      await expect(portrait).toBeVisible();
      await expect(search).toBeVisible();

      const heroBounds = await hero.boundingBox();
      const portraitBounds = await portrait.boundingBox();
      const searchBounds = await search.boundingBox();
      const heroColumnCount = await heroLayout.evaluate((element) =>
        window.getComputedStyle(element).gridTemplateColumns.split(" ").length
      );
      expect(heroBounds).not.toBeNull();
      expect(portraitBounds).not.toBeNull();
      expect(searchBounds).not.toBeNull();
      expect(portraitBounds!.x).toBeGreaterThanOrEqual(heroBounds!.x - 1);
      expect(portraitBounds!.y).toBeGreaterThanOrEqual(heroBounds!.y - 1);
      expect(portraitBounds!.x + portraitBounds!.width).toBeLessThanOrEqual(
        heroBounds!.x + heroBounds!.width + 1
      );
      expect(portraitBounds!.y + portraitBounds!.height).toBeLessThanOrEqual(
        heroBounds!.y + heroBounds!.height + 1
      );
      expect(heroColumnCount).toBe(width >= 1024 ? 2 : 1);
      const portraitToSearchGap = searchBounds!.y - (portraitBounds!.y + portraitBounds!.height);
      expect(portraitToSearchGap).toBeGreaterThanOrEqual(31);
      expect(portraitToSearchGap).toBeLessThanOrEqual(33);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  }
});

test("about displays Emily and only the 18 distinct redacted credentials", async ({ page, request }) => {
  await page.goto("/about");
  await expectIndexable(page);
  await expect(page.getByAltText("Emily 学姐个人微信二维码")).toBeVisible();
  await expect(page.getByRole("heading", { name: "团队竞赛经历与荣誉" })).toBeVisible();
  const links = page.locator('a[href^="/certificates/"]');
  await expect(links).toHaveCount(18);
  expect(new Set(await links.evaluateAll((items) => items.map((item) => item.getAttribute("href")))).size).toBe(18);
  await expect(page.locator('[href*="competition-gallery/"]')).toHaveCount(0);
  expect((await request.get("/competition-gallery/project-result-01.jpg")).status()).toBe(404);
  expect((await request.get("/_next/image?url=%2Fcompetition-gallery%2Fproject-result-01.jpg&w=640&q=75")).status()).toBe(410);

  const image = links.first().getByRole("img");
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect((await request.get((await links.first().getAttribute("href"))!)).headers()["content-type"]).toContain("image/webp");
});

test("daylight orbit branding uses the production assets and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "选完之后，你会知道什么？" })).toBeVisible();

  await expect(page.locator('img[src*="/brand/saitu-mark-gradient.svg"]')).toHaveCount(2);
  await expect(page.locator('img[src*="saitu-mark-gold"], img[src*="/brand/lele-full.png"]')).toHaveCount(0);

  const lele = page.getByAltText("乐乐，一位手持平板、伸手欢迎的竞赛助手");
  await expect(lele).toHaveCount(1);
  await expect(lele).toHaveAttribute("src", /lele-cutout\.png/);
  await expect(lele).toHaveJSProperty("complete", true);
  await expect.poll(() => lele.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  await expect(page.locator("body")).toHaveCSS("color", "rgb(11, 16, 38)");
  await expect(page.locator(".animate-orbit-drift, .animate-orbit-drift-reverse")).toHaveCount(0);
  await expect(page.locator(".hero-character-stage")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".hero-character-idle")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".hero-character-greeting")).toHaveCSS("transform", "none");
  await expect(page.getByText("智能竞赛助手", { exact: true })).toHaveCount(0);
});

test("home character uses a restrained idle and greets on hover or tap", async ({ page, isMobile }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");

  const stage = page.locator(".hero-character-stage");
  const idleLayer = page.locator(".hero-character-idle");
  const greetingLayer = page.locator(".hero-character-greeting");
  await expect(stage).toHaveCSS("animation-name", "hero-character-enter");
  await expect(idleLayer).toHaveCSS("animation-name", "hero-character-idle");
  await expect(idleLayer).toHaveCSS("animation-duration", "6.8s");
  if (isMobile) {
    await stage.click();
    await expect(stage).toHaveAttribute("aria-pressed", "true");
  } else {
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect.poll(() => stage.evaluate((element) => element.matches(":hover"))).toBe(true);
  }
  await expect.poll(() => greetingLayer.evaluate((element) => getComputedStyle(element).transform)).not.toBe("none");
  await expect(page.getByText("嗨，一起看看吧。", { exact: true })).toHaveCSS("opacity", "1");
});

test("public navigation contains only retained product destinations", async ({ page, isMobile }) => {
  await page.goto("/");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳到主要内容" })).toBeFocused();

  const openMenuButton = page.getByRole("button", { name: "打开导航菜单" });
  if (isMobile) {
    await openMenuButton.click();
    const mobileDialog = page.getByRole("dialog", { name: "主导航菜单" });
    await expect(mobileDialog).toBeVisible();
    const closeMenuButton = mobileDialog.getByRole("button", { name: "关闭导航菜单" });
    await expect(closeMenuButton).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(mobileDialog.getByRole("link", { name: "打开竞赛助手" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeMenuButton).toBeFocused();
  }
  const navigation = page.getByRole("navigation", { name: isMobile ? "移动端主导航" : "主导航" });
  await expect(navigation.getByRole("link", { name: "竞赛助手" })).toHaveAttribute("href", "/competitions/recommend");
  await expect(navigation.getByRole("link", { name: "竞赛信息" })).toHaveAttribute("href", "/competitions");
  await expect(navigation.getByRole("link", { name: "竞赛资源" })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "竞赛组队" })).toHaveAttribute("href", "/teams");
  await expect(navigation.getByRole("link", { name: "关于我们" })).toHaveAttribute("href", "/about");
  await expect(page.locator(retiredLinkSelector)).toHaveCount(0);

  if (isMobile) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "主导航菜单" })).toBeHidden();
    await expect(openMenuButton).toBeFocused();
  }
});
