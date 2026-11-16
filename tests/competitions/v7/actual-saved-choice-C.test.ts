import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readSavedDecisions, saveSelectedRunDecisions } from "@/lib/competitions/v6/saved-decisions";
import { recommendationRunSchema } from "@/lib/competitions/v7/contracts";
import { topFiveRunFixture } from "../../fixtures/recommendation-run-v7";

describe("C actual live01 CFA saved choice", () => {
  it("persists and reloads the actual saved recommendation through the existing product store", () => {
    const receipt = JSON.parse(readFileSync("artifacts/fast24-20261109/C/live-01/C11-business-saved-legacy/receipts.json", "utf8"));
    const body = receipt.runSnapshots[0].body, report = body.report;
    const run = recommendationRunSchema.parse(topFiveRunFixture({ profileId: report.profile.profileId, profileRevision: report.profile.revision, profile: report.profile, catalogVersion: report.catalogVersion, status: "ready", report, resultVersion: 3, items: body.items }));
    const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const saved = saveSelectedRunDecisions(run, [run.items[0].itemId], storage); expect(saved.ok).toBe(true);
    const loaded = readSavedDecisions({ ...storage }); if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.value.items).toHaveLength(1);
    expect(loaded.value.items[0].recommendation).toEqual(run.items[0].detail);
    expect(loaded.value.items[0].officialEntry?.url).toBe(run.items[0].officialUrl);
    expect(loaded.value.items[0].recommendation.name).toBe("CFA Institute Research Challenge");
  });
});
