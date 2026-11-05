import { expect, type Page } from "@playwright/test";

export async function expectNoindex(page: Page) {
  await expect
    .poll(() => page.locator('meta[name="robots"][content*="noindex"]').count())
    .toBeGreaterThan(0);
}

export async function expectIndexable(page: Page) {
  await expect.poll(() => page.locator('meta[name="robots"][content*="noindex"]').count()).toBe(0);
}
