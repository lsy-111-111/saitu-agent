import { expect, type Page } from "@playwright/test";
import type { SavedDecisionStore } from "../../src/lib/competitions/v6/saved-decisions";
import type { RecommendationListItemV7, RecommendationRunV7 } from "../../src/lib/competitions/v7/contracts";

// UI-only helpers. They do not launch a browser, call a provider, grant spending,
// or synthesize API replies. The root's existing collector owns live execution.
export type Fast24StudentCase = {
  caseId: string; discipline: string; viewport: string; journey: string;
  major: string; subject: string; skill: string | null; stage: string;
  weekly: string | null; budget: number | null; undecided?: boolean; profileNote?: string;
  excludedTasks?: string[];
  experience?: { task: string; contribution: string; completion: string };
  chatText?: string; expectedField?: string; expectedValue?: string | number;
};

async function choose(page: Page, name: string, role: "radio" | "checkbox" = "radio") {
  const matching = page.getByTestId("conversation-current-question").getByRole(role, { name, exact: true });
  await matching.first().waitFor({ state: "attached" });
  const options = await matching.all();
  let option = options[0];
  for (const candidate of options) if (!await candidate.isChecked()) { option = candidate; break; }
  if (!await option.isChecked()) await option.locator("..").click();
  await expect(option).toBeChecked();
}
async function next(page: Page) {
  await page.getByTestId("conversation-current-question").getByRole("button", { name: "回答好了，继续", exact: true }).click();
}
async function skip(page: Page) {
  await page.getByTestId("conversation-current-question").getByRole("button", { name: "暂不确定，跳过这题", exact: true }).click();
}

export async function fillFast24StudentProfile(page: Page, entry: Fast24StudentCase, baseUrl: string) {
  await page.goto(new URL("/competitions/recommend", baseUrl).href);
  if (entry.undecided) await choose(page, "暂不决定，先看不同方向的取舍");
  else {
    await choose(page, "先发现自己愿意长期做的方向");
    await choose(page, "确认，先按这个方向比较");
  }
  await next(page);
  await choose(page, entry.stage); await next(page);
  await choose(page, entry.major, "checkbox"); await choose(page, entry.subject, "checkbox"); await next(page);
  await skip(page); // Interests remain unknown unless the student supplies them.
  if (entry.skill) { await choose(page, entry.skill, "checkbox"); await next(page); } else await skip(page);
  if (entry.experience) {
    await choose(page, "有，我想补充一段具体经历");
    const question = page.getByTestId("conversation-current-question");
    await question.getByRole("textbox", { name: "具体做了什么？", exact: true }).fill(entry.experience.task);
    await question.getByRole("combobox", { name: "其中你本人负责哪种程度的工作？", exact: true }).selectOption(entry.experience.contribution);
    await question.getByRole("combobox", { name: "这件事最后到哪一步？", exact: true }).selectOption(entry.experience.completion);
  } else await choose(page, entry.undecided ? "暂不确定" : "暂时想不起或还没有");
  await next(page);
  if (entry.excludedTasks?.length) {
    const question = page.getByTestId("conversation-current-question");
    await question.getByText("有没有明确不想做的任务？", { exact: true }).click();
    const excluded = question.getByRole("group", { name: "我希望避开", exact: true });
    for (const label of entry.excludedTasks) {
      const option = excluded.getByRole("checkbox", { name: label, exact: true });
      await option.locator("..").click();
      await expect(option).toBeChecked();
    }
  }
  if (entry.profileNote) {
    const question = page.getByTestId("conversation-current-question");
    await question.getByRole("button", { name: /展开.*文字回答/ }).click();
    await question.getByRole("textbox", { name: /^文字回答：/ }).fill(entry.profileNote);
    await next(page);
  } else await skip(page);
  if (entry.weekly) {
    await choose(page, entry.weekly); await choose(page, "先体验 1–2 周"); await next(page);
  } else await skip(page);
  if (entry.budget === null) await skip(page);
  else {
    await choose(page, entry.budget === 0 ? "暂不自费" : entry.budget <= 100 ? "不超过 100 元" : "101–500 元");
    if (entry.budget > 0) await page.getByRole("spinbutton", { name: /预算上限/ }).fill(String(entry.budget));
    await choose(page, "我个人的总预算"); await next(page);
  }
  const summary = page.locator('[data-phase="summary"]');
  await expect(summary).toBeVisible();
  await summary.getByRole("checkbox").check();
}

export async function readFast24VisibleList(page: Page) {
  return page.getByTestId("decision-report-v7").evaluate(element => {
    const report = element as HTMLElement;
    const cards = [...report.querySelectorAll<HTMLElement>('[data-testid="recommendation-run-item"]')];
    return { runId: report.dataset.runId, status: report.dataset.runStatus, declaredCount: Number(report.dataset.totalItems),
      itemIds: cards.map(card => card.dataset.itemId), allReady: cards.length > 0 && cards.every(card => card.dataset.detailStatus === "ready") };
  });
}

export async function checkFast24Details(page: Page, expectedItem?: RecommendationListItemV7) {
  const item = expectedItem ?? await page.evaluate(() => {
    const raw = sessionStorage.getItem("saitu.recommendationRun.v7");
    return raw ? (JSON.parse(raw) as { run: RecommendationRunV7 }).run.items[0] : undefined;
  });
  if (!item?.detail) throw new Error("actual_ready_detail_required");
  const detail = item.detail;
  const report = page.getByTestId("decision-report-v7");
  const first = report.getByTestId("recommendation-run-item").first();
  await expect(first).toHaveAttribute("data-item-id", item.itemId);
  const summary = first.locator("summary").first();
  if (!await first.locator(":scope > details[open]").count()) await summary.click();
  for (const heading of ["具体做什么", "为什么适合你", "价值与收获"]) {
    await expect(first.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  for (const removed of ["你现在可以从哪里开始", "想走得更远，需要补什么", "三个阶段的难度", "主要投入与机会成本", "先做这一件事", "查看依据与条件"]) await expect(first.getByText(removed, { exact: true })).toHaveCount(0);
  expect(await first.locator('[data-claim-field="value"][data-testid="compact-claim"]').count()).toBeLessThanOrEqual(2);
  const officialLink = first.getByRole("link", { name: /^查看官网：/ });
  if (!item.officialUrl || !/^https?:\/\//u.test(item.officialUrl)) throw new Error("actual_official_entry_required");
  await expect(officialLink).toHaveAttribute("href", item.officialUrl);
  const citations = [];
  for (const [field, claim] of [["coreTask", detail.coreTask], ["reason", detail.reasons[0]]] as const) {
    const paragraph = first.locator(`[data-testid="compact-claim"][data-claim-field="${field}"]`);
    await expect(paragraph).toBeVisible();
    const sourceIds = new Set(detail.evidenceFacts.filter(fact => claim.competitionFactIds.includes(fact.id)).flatMap(fact => fact.sourceIds));
    const expected = detail.sources.filter(source => sourceIds.has(source.id)).map(source => ({ id: source.id, url: source.url }));
    const visible = await paragraph.locator("a[data-source-id]").evaluateAll(links => links.map(link => ({
      id: link.getAttribute("data-source-id"), url: link.getAttribute("href"),
    })));
    expect(visible).toEqual(expected);
    citations.push({ field, sources: visible });
  }
  return { itemId: item.itemId, citations };
}

export async function checkFast24Comparison(page: Page) {
  const report = page.getByTestId("decision-report-v7");
  await expect(report.getByText("比较两到三项，看清怎么取舍", { exact: true })).toHaveCount(0);
  await expect(report.getByRole("table")).toHaveCount(0);
  const chat = page.getByTestId("decision-chat-v7");
  await expect(chat.getByRole("button", { name: "比较两项", exact: true })).toHaveCount(0);
  await expect(chat.getByRole("textbox", { name: "想追问或更正什么？", exact: true })).toBeEnabled();
}

export async function fillFast24Chat(page: Page, text: string, topic?: string) {
  const chat = page.getByTestId("decision-chat-v7");
  const input = chat.getByRole("textbox", { name: "想追问或更正什么？", exact: true });
  if (topic && topic !== "比较两项") {
    await chat.getByRole("button", { name: topic, exact: true }).click();
    await expect(input).toBeFocused();
    await expect(input).not.toHaveValue("");
  }
  await input.fill(text);
  // Sending is deliberately left to the root's accounting-aware collector.
}

export async function saveFast24FirstResult(page: Page) {
  const report = page.getByTestId("decision-report-v7");
  const first = report.getByTestId("recommendation-run-item").first();
  const itemId = await first.getAttribute("data-item-id");
  const name = await first.getByRole("heading", { level: 3 }).innerText();
  await first.getByRole("checkbox").check();
  await report.getByRole("button", { name: "收藏所选 1 项", exact: true }).click();
  await expect(report.getByText("已收藏所选 1 项。", { exact: true })).toBeVisible();
  return { itemId, name };
}

export async function checkFast24SavedResult(page: Page, item: RecommendationListItemV7) {
  if (!item.detail) throw new Error("actual_ready_detail_required");
  const saved = await page.evaluate(itemId => {
    const raw = localStorage.getItem("saitu.savedDecisionChoices.v6");
    return raw ? (JSON.parse(raw) as SavedDecisionStore).items.find(entry => entry.recommendation.itemId === itemId) : undefined;
  }, item.itemId);
  expect(saved?.recommendation).toEqual(item.detail);
  expect(saved?.officialEntry?.url).toBe(item.officialUrl);
  const row = page.locator(`[data-saved-decision=${JSON.stringify(item.itemId)}]`);
  await expect(row.getByRole("heading", { level: 3 })).toHaveText(item.name);
  if (item.officialUrl) await expect(row.getByRole("link", { name: /^查看官网：/ })).toHaveAttribute("href", item.officialUrl);
  await row.locator("summary").click();
  await expect(row.getByText("主要任务", { exact: true })).toBeVisible();
  await expect(row.getByText("第一步", { exact: true })).toBeVisible();
  await expect(row.locator(":scope > details > p").first()).toHaveText(item.detail.reasons.map(reason => reason.text).join("；"));
  const notes = [...new Set(item.detail.eligibilityNotes.filter(note => /^(参赛提醒：|预算提醒：|任务边界：)/u.test(note)))];
  const advisories = row.getByTestId("compact-recommendation-advisories");
  await expect(advisories.locator("[data-advisory-note]")).toHaveCount(notes.length);
  for (const note of notes) await expect(advisories.getByText(note, { exact: false })).toBeVisible();
  return { itemId: item.itemId, recommendationMatches: true, advisoryCount: notes.length };
}

export async function checkFast24PageHealth(page: Page) {
  await expect(page).toHaveTitle(/竞赛/);
  await expect(page.locator("main")).not.toBeEmpty();
  await expect(page.locator("body")).not.toContainText(/Unhandled Runtime Error|Application error: a client-side exception|Build Error/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
