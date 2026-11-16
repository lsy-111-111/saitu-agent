import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ledger from "@/content/competitions-v6/ai-review-ledger.json";
import { makeSyntheticPlanRecord, profile, now } from "./formal-plan-fixtures";
import { assessFormalParticipationPlan } from "@/lib/competitions/v6/participation-plan";
import { assessStrictParticipation } from "../../../scripts/competitions/v6/coverage-participation";
import { checkSnapshot, snapshotDigest, type CatalogSnapshot } from "@/lib/competitions/v6/catalog-snapshot";
import { readRuntimeCatalogSnapshot, withCatalogSnapshotPath } from "@/lib/competitions/v6/catalog-runtime";
import { getDecisionCatalog } from "@/lib/competitions/v6/catalog";
import { hasTrustedPlanDualReview } from "@/lib/competitions/v6/trusted-plan-review";

// This file intentionally has NO ledger mock: production ledger and actual snapshot loader are exercised.
describe("canonical ledger boundary for submitted participation plans", () => {
  it("rejects the independently reproduced self-signed record absent from the real ledger", () => {
    const r = makeSyntheticPlanRecord();
    expect(Object.hasOwn(ledger, r.recordId)).toBe(false);
    expect(hasTrustedPlanDualReview(r)).toBe(false);
    expect(assessFormalParticipationPlan(r, profile, now).reasons).toContain("trusted_ledger_current_digest_dual_review_required");
    expect(assessStrictParticipation(r, profile, now).passed).toBe(false);
    const snapshot: CatalogSnapshot = { schemaVersion: "saitu.catalog-snapshot.v1", snapshotId: "SYNTHETIC-SELF-SIGNED-NOT-APPROVED", createdAt: now.toISOString(), policy: "ai_dual_review", digest: snapshotDigest([r]), records: [r] };
    expect(checkSnapshot(snapshot, [], now, true).errors).toContain(`review_required:${r.recordId}`);
    const dir = mkdtempSync(path.join(tmpdir(), "saitu-plan-negative-"));
    try {
      const file = path.join(dir, "snapshot.json"); writeFileSync(file, JSON.stringify(snapshot));
      expect(() => withCatalogSnapshotPath(file, () => readRuntimeCatalogSnapshot([], now))).toThrow("Runtime catalog snapshot rejected");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("preserves an actual approved no-plan record and rejects attaching a newly self-signed plan", () => {
    const r = getDecisionCatalog().find(r => r.contentTier === "L3")!;
    expect(r.participationPlans).toBeUndefined();
    const snapshot: CatalogSnapshot = { schemaVersion: "saitu.catalog-snapshot.v1", snapshotId: "SYNTHETIC-EXISTING-APPROVED-CONTROL", createdAt: now.toISOString(), policy: "ai_dual_review", digest: snapshotDigest([r]), records: [r] };
    expect(checkSnapshot(snapshot, [], now, true).valid).toBe(true);
    r.participationPlans = makeSyntheticPlanRecord().participationPlans;
    expect(hasTrustedPlanDualReview(r)).toBe(false);
  });
});
