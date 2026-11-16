import type { Page } from "@playwright/test";

export type PublicBrowserTiming = { timeOrigin: number; start: number; listMs: number | null; allDetailsMs: number | null; terminalStatus: string | null; expectedCount: number | null; initialItemIds: (string | null)[]; readyExpansionMs: number | null };
export function fillPublicBrowserProfile(page: Page, entry: { stage: string; skill: string | null; weekly: string; budget: number }, baseUrl: string): Promise<void>;
export function installPublicBrowserProbe(page: Page): Promise<number>;
export function validatePublicBrowserConfig(config: unknown): unknown;
declare global {
  interface Window { __saituPublicProbe: PublicBrowserTiming }
}
