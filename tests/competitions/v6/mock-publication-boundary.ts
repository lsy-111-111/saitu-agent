import { vi } from "vitest";
import type { DecisionCompetitionRecord } from "@/lib/competitions/v6/catalog-types";

// Explicit unit-test dependency replacement: these suites isolate ranking,
// eligibility, evidence and model orchestration using unpublished synthetic data.
// Never imported by production or by recommendation-publication.test.ts.
vi.mock("@/lib/competitions/v6/published-records", async () => {
  const { getDecisionCatalog } = await import("@/lib/competitions/v6/catalog");
  return { selectPublishedDecisionRecords: (records?: readonly DecisionCompetitionRecord[]) =>
    (records ?? getDecisionCatalog()).filter(record => ["L2", "L3"].includes(record.contentTier)) };
});
