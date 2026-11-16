import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DecisionRunReport } from "../src/components/competitions/recommend/DecisionRunReport";
import { DecisionClaim, DecisionDetails, DecisionOverview } from "../src/components/competitions/recommend/DecisionReport";
import { recommendationRunSchema } from "../src/lib/competitions/v7/contracts";
import { SAVED_DECISIONS_KEY, readSavedDecisions, savedDecisionStoreSchema, saveSelectedRunDecisions } from "../src/lib/competitions/v6/saved-decisions";
import { SAVED_COMPETITIONS_STORAGE_KEY, readSavedCompetitionStore } from "../src/lib/competitions/saved-competitions";
import { freezeContextV7, restoreContextV7, type RunBodyV7 } from "../src/lib/competitions/v7/store";
import { sealV7, unsealV7 } from "../src/lib/competitions/v7/crypto";
import { DEFAULT_EFFORT_POLICY, effortPolicySha256 } from "../src/lib/ai/effort-policy.mjs";
import { syntheticRecord, student } from "./competitions/v6/decision-fixtures";
import { independentLegacyDecisionStore, independentLegacyV5Store, independentReviewRun, reviewOfficialUrls, reviewSourcePrefix } from "./review-v7-official-entry-ui-independent.fixtures";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: vi.fn((key: string) => data.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { data.set(key, value); }), removeItem: vi.fn((key: string) => { data.delete(key); }) };
}

describe("independent v7 official-entry UI policy review", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("uses source-linked synthetic data accepted by actual run and saved schemas", () => {
    const run = independentReviewRun();
    expect(recommendationRunSchema.safeParse(run).success).toBe(true);
    expect(run.report!.recommendations.every(item => item.reasons[0].competitionFactIds.length && item.evidenceFacts.length && item.sources.length === 2)).toBe(true);
    expect(savedDecisionStoreSchema.safeParse(independentLegacyDecisionStore()).success).toBe(true);
  });

  it("suppresses historical links in every SSR v7 card/overview while leaving closed explanations and official URLs", () => {
    const run = independentReviewRun();
    const html = renderToStaticMarkup(React.createElement(DecisionRunReport, { run, displayRun: run, pollError: "", onRetry: vi.fn(), turns: [], onEdit: vi.fn() }));
    expect(html).toContain(`href="${reviewOfficialUrls[0]}"`);
    expect(html).toContain(`href="${reviewOfficialUrls[1]}"`);
    expect(html).not.toContain(reviewSourcePrefix);
    expect(html).toContain("官网链接暂缺");
    expect(html).toContain("独立复审理由1");
    expect(html).toContain("独立复审总览方向");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
    expect(html).not.toContain("资格初筛通过");
    expect(html).toContain("参赛资格和开赛时间请自行核查官网");
  });

  it("keeps shared Claim/Details/Overview legacy links by default and removes them only when explicitly disabled", () => {
    const run = independentReviewRun();
    const item = run.items[0].detail!;
    for (const [Component, props] of [
      [DecisionClaim, { claim: item.coreTask, item, report: run.report }],
      [DecisionDetails, { item, report: run.report }],
      [DecisionOverview, { report: run.report!, turns: [], onEdit: vi.fn() }],
    ] as const) {
      // Each component has a different required prop shape; this test iterates their common policy.
      const render = (showSourceLinks?: boolean) => renderToStaticMarkup(React.createElement(Component as React.ComponentType<object>, { ...props, ...(showSourceLinks === undefined ? {} : { showSourceLinks }) }));
      expect(render()).toContain(`${reviewSourcePrefix}rules-0.pdf`);
      expect(render(false)).not.toContain(reviewSourcePrefix);
      expect(render(false)).toContain("独立复审资料事实1");
    }
  });

  it("preserves v7 official URL/null and all sources/facts through save and read, while leaving legacy rows unmodified", () => {
    const run = independentReviewRun();
    const legacy = independentLegacyDecisionStore();
    const storage = memoryStorage({ [SAVED_DECISIONS_KEY]: JSON.stringify(legacy) });
    const result = saveSelectedRunDecisions(run, run.items.map(item => item.itemId), storage);
    expect(result.ok).toBe(true);
    const read = readSavedDecisions(storage);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.message);
    expect(read.value.items).toHaveLength(4);
    expect(read.value.items.find(item => item.recommendation.itemId === "review-legacy-v6")).toEqual(legacy.items[0]);
    for (const item of run.items) {
      const saved = read.value.items.find(entry => entry.recommendation.itemId === item.itemId)!;
      expect(saved.officialEntry).toEqual({ sourcePolicy: "official-entry-only.v7", url: item.officialUrl });
      expect(saved.recommendation).toEqual(item.detail);
    }
    const bytes = storage.getItem(SAVED_DECISIONS_KEY);
    storage.setItem.mockClear();
    expect(readSavedDecisions(storage).ok).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem(SAVED_DECISIONS_KEY)).toBe(bytes);
  });

  it("preserves full raw source/fact metadata through the backend freeze and sealed-body round trip without a database", () => {
    const record = syntheticRecord(991);
    const run = independentReviewRun();
    const context = { profile: run.profile, candidates: [{ record, score: null, eligibility: "unknown" as const, conditions: [], relevant: true }],
      records: [record], excluded: new Map<string, string>(), catalogVersion: "independent-synthetic-backend", now: new Date("2026-11-09T00:00:00.000Z") };
    const body: RunBodyV7 = { implementationSha256: "independent-synthetic-only", sessionGeneration: 0, effortPolicy: DEFAULT_EFFORT_POLICY, effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), context: freezeContextV7(context), legacy: student(), items: run.items,
      report: run.report, listReadyAt: run.listReadyAt, detailsReadyAt: run.detailsReadyAt, shortfallReason: null };
    vi.stubEnv("AI_CONVERSATION_SIGNING_SECRET", "independent-review-synthetic-key-no-user-secret-used");
    try {
      const stored = unsealV7<RunBodyV7>("independent-review-raw-pack", sealV7("independent-review-raw-pack", body));
      const restored = restoreContextV7(stored);
      expect(restored).toEqual(context);
      expect(restored.records[0].sources).toEqual(record.sources);
      expect(restored.candidates[0].record.facts).toEqual(record.facts);
      expect(stored.report?.recommendations[0].sources).toEqual(run.report!.recommendations[0].sources);
      expect(stored.report?.recommendations[0].evidenceFacts).toEqual(run.report!.recommendations[0].evidenceFacts);
    } finally { vi.unstubAllEnvs(); }
  });

  it("reads both legacy v5/v6 snapshots without rewriting stored bytes", () => {
    const bytes = JSON.stringify(independentLegacyDecisionStore());
    const v5 = JSON.stringify(independentLegacyV5Store);
    const storage = memoryStorage({ [SAVED_DECISIONS_KEY]: bytes, [SAVED_COMPETITIONS_STORAGE_KEY]: v5 });
    expect(readSavedDecisions(storage).ok).toBe(true);
    expect(readSavedCompetitionStore(storage).ok).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem(SAVED_DECISIONS_KEY)).toBe(bytes);
    expect(storage.getItem(SAVED_COMPETITIONS_STORAGE_KEY)).toBe(v5);
  });

  it.each(["javascript:alert(1)", "data:text/html,bad", "ftp://review.example/entry", "//review.example/entry", "not a URL"])("rejects unsafe v7 official URL %s before touching old data", url => {
    const run = independentReviewRun();
    const bytes = JSON.stringify(independentLegacyDecisionStore());
    const storage = memoryStorage({ [SAVED_DECISIONS_KEY]: bytes });
    run.items[0].officialUrl = url;
    expect(saveSelectedRunDecisions(run, [run.items[0].itemId], storage).ok).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem(SAVED_DECISIONS_KEY)).toBe(bytes);
  });

  it("rejects malformed selected identity, nonready or missing detail, and invalid save metadata without overwriting", () => {
    for (const mutate of [
      (run: ReturnType<typeof independentReviewRun>) => { run.items[0].detail!.itemId = "wrong-item"; },
      (run: ReturnType<typeof independentReviewRun>) => { run.items[0].detailStatus = "pending"; },
      (run: ReturnType<typeof independentReviewRun>) => { delete run.items[0].detail; },
      (run: ReturnType<typeof independentReviewRun>) => { run.items[0].detail!.coreTask.text = ""; },
      (run: ReturnType<typeof independentReviewRun>) => { run.items[0].officialUrl = undefined as unknown as string; },
      (run: ReturnType<typeof independentReviewRun>) => { run.catalogVersion = 7 as unknown as string; },
    ]) {
      const run = independentReviewRun(); mutate(run);
      const bytes = JSON.stringify(independentLegacyDecisionStore());
      const storage = memoryStorage({ [SAVED_DECISIONS_KEY]: bytes });
      expect(saveSelectedRunDecisions(run, [run.items[0].itemId], storage).ok).toBe(false);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.getItem(SAVED_DECISIONS_KEY)).toBe(bytes);
    }
  });

  it("preserves corrupt/unsupported existing stores and rejects invalid optional-entry markers", () => {
    for (const bytes of ["{", JSON.stringify({ schemaVersion: "future", items: [] }), JSON.stringify({ ...independentLegacyDecisionStore(), items: [{ ...independentLegacyDecisionStore().items[0], officialEntry: { sourcePolicy: "unknown", url: reviewOfficialUrls[0] } }] })]) {
      const storage = memoryStorage({ [SAVED_DECISIONS_KEY]: bytes });
      expect(readSavedDecisions(storage).ok).toBe(false);
      expect(saveSelectedRunDecisions(independentReviewRun(), ["run-item-0"], storage).ok).toBe(false);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.getItem(SAVED_DECISIONS_KEY)).toBe(bytes);
    }
  });

  it("fails cleanly when storage reads or writes are denied", () => {
    const readBlocked = { getItem: () => { throw new Error("denied"); }, setItem: vi.fn() };
    expect(saveSelectedRunDecisions(independentReviewRun(), ["run-item-0"], readBlocked).ok).toBe(false);
    expect(readBlocked.setItem).not.toHaveBeenCalled();
    const bytes = JSON.stringify(independentLegacyDecisionStore());
    const writeBlocked = { getItem: () => bytes, setItem: vi.fn(() => { throw new Error("quota"); }) };
    expect(saveSelectedRunDecisions(independentReviewRun(), ["run-item-0"], writeBlocked).ok).toBe(false);
    expect(writeBlocked.getItem()).toBe(bytes);
  });
});
