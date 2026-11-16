import { afterEach, expect, it, vi } from "vitest";
import type { CatalogAiReview } from "@/lib/competitions/v6/catalog-types";
const { isolatedLedger } = vi.hoisted(() => ({ isolatedLedger: {} as Record<string, CatalogAiReview[]> }));
// Ledger-module isolation only; publication code remains real and disk ledger is never written.
vi.mock("@/content/competitions-v6/ai-review-ledger.json", async importOriginal => {
  const actual = await importOriginal<{ default: Record<string, CatalogAiReview[]> }>();
  Object.assign(isolatedLedger, structuredClone(actual.default));
  return { default: isolatedLedger };
});
import { selectPublishedDecisionRecords } from "@/lib/competitions/v6/published-records";
import { catalogContentDigest } from "@/lib/competitions/v6/catalog-review";
const record = selectPublishedDecisionRecords()[0];
const original = structuredClone(isolatedLedger[record.recordId]);
afterEach(() => { isolatedLedger[record.recordId] = structuredClone(original); });
it.each(["later", "equal-time"])("honors a %s canonical denial despite retained embedded approvals", variant => {
  expect(selectPublishedDecisionRecords([record])).toHaveLength(1);
  const approved = original.find(r => r.contentDigest === catalogContentDigest(record) && r.outcome === "approved")!;
  isolatedLedger[record.recordId].push({ ...approved, reviewedAt: variant === "later" ? "2099-01-01T00:00:00Z" : approved.reviewedAt,
    outcome: "changes_requested", findings: [{ severity: "major", id: "synthetic-denial", description: "Synthetic isolated revocation", resolved: false }] });
  expect(selectPublishedDecisionRecords([record])).toEqual([]);
});
