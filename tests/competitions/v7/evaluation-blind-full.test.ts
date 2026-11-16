import { describe, expect, it } from "vitest";
import { inspectCompleteBlindOriginals, buildAdjudicationPacket } from "../../../scripts/competitions/v7/evaluation-packets.mjs";
import { resolveRankingGold } from "../../../scripts/competitions/v7/evaluation-score.mjs";
import { POLICY_VERSION, POLICY_SHA256, TASK_GROUPS, canonicalHash } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { evaluationFixture } from "./evaluation.fixture";

function completeFixture() {
  const items = Array.from({ length: 45 }, (_, index) => `synthetic-item-${index}`);
  const cleanPacket: any = { schemaVersion: "saitu.ranking-review-packet.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    coordinatorContextId: "synthetic-coordinator", profilePoolSha256: canonicalHash("synthetic-full-pool"), candidateRegistry: items.map(itemId => ({ itemId })),
    profiles: Array.from({ length: 120 }, (_, index) => ({ profileId: `synthetic-profile-${index}`, caseId: `synthetic-case-${index}`, familyId: `synthetic-family-${index}`,
      taskGroup: TASK_GROUPS[Math.floor(index / 20)], input: { syntheticOnly: true }, poolItemIds: [...items] })) };
  const originals = ["synthetic-fresh-a", "synthetic-fresh-b"].map(contextId => ({ contextId, authorModel: "gpt-6.1-sol", authorEffort: "max", freshContext: true,
    oldJudgmentsRead: false, otherReviewerJudgmentsRead: false, blindToAlgorithms: true, productOutputsRead: false,
    openedAt: "2026-11-09T00:00:00Z", sealedAt: "2026-11-09T00:05:00Z",
    profiles: cleanPacket.profiles.map((row: any) => ({ profileId: row.profileId, poolItemIds: [...items], judgments: items.map((itemId, index) => ({ itemId, relevance: index % 4 as number | "U", reason: "Synthetic independent-original contract fixture only." })) })) }));
  return { cleanPacket, originalA: originals[0], originalB: originals[1], adjudicatorContextId: "synthetic-fresh-third" };
}

describe("two complete fresh ranking reviewers", () => {
  it("retains two 120x45 originals and computes anonymous raw alpha before any adjudication", () => {
    const f = completeFixture(), before = canonicalHash([f.originalA, f.originalB]), result = inspectCompleteBlindOriginals(f);
    expect(result).toMatchObject({ reviewers: 2, profilesPerReviewer: 120, judgmentsPerReviewer: 5400, pairedUnitDenominator: 5400, rawOriginalAlpha: 1, eligibleForAdjudication: true, rawOriginalBytesVerified: false });
    expect(result).not.toHaveProperty("profiles"); expect(result).not.toHaveProperty("judgments");
    expect(canonicalHash([f.originalA, f.originalB])).toBe(before);
  });
  it("refuses to construct a dispute packet when raw original alpha is below .70 or null", () => {
    const low = completeFixture(); for (const row of low.originalB.profiles) for (const judgment of row.judgments) judgment.relevance = 0;
    expect(inspectCompleteBlindOriginals(low).eligibleForAdjudication).toBe(false);
    expect(() => buildAdjudicationPacket(low)).toThrow("alpha_below_070_or_null_no_adjudication");
    const constant = completeFixture(); for (const original of [constant.originalA, constant.originalB]) for (const row of original.profiles) for (const judgment of row.judgments) judgment.relevance = 0;
    expect(inspectCompleteBlindOriginals(constant).rawOriginalAlpha).toBeNull();
    expect(() => buildAdjudicationPacket(constant)).toThrow("no_adjudication");
  });
  it("retains shared U as a real unresolved dispute after the original alpha passes", () => {
    const f = completeFixture(); f.originalA.profiles[0].judgments[0].relevance = "U"; f.originalB.profiles[0].judgments[0].relevance = "U";
    expect(inspectCompleteBlindOriginals(f)).toMatchObject({ numericPairs: 5399, unknownPairs: 1, disagreementsPlusUnknown: 1, eligibleForAdjudication: true });
    const packet = buildAdjudicationPacket(f); expect(packet.disputes).toHaveLength(1); expect(packet.disputes[0].originals.map((row: any) => row.relevance)).toEqual(["U", "U"]);
  });
  it("rejects missing judgments, reused contexts or declarations that read prior labels", () => {
    for (const mutate of [
      (f: any) => f.originalA.profiles[0].judgments.pop(), (f: any) => f.originalB.contextId = f.originalA.contextId,
      (f: any) => f.originalA.contextId = f.cleanPacket.coordinatorContextId, (f: any) => f.originalA.freshContext = false,
      (f: any) => f.originalA.oldJudgmentsRead = true, (f: any) => f.originalA.authorEffort = "high",
    ]) { const f = completeFixture(); mutate(f); expect(() => inspectCompleteBlindOriginals(f)).toThrow(); }
  });
  it("requires bound third-reviewer resolution for shared U in the preserved v7.1 gold path", () => {
    const f = evaluationFixture(), rows = f.gold.originals.map((original: any) => original.profiles[0].judgments[9]);
    for (const row of rows) row.relevance = "U";
    expect(() => resolveRankingGold(f.matrix, f.gold, f.manifest, f.registration.registeredAt)).toThrow("disagreement_without_bound_adjudication");
    f.gold.adjudicator = { contextId: "fresh-third", resolvesOriginalSha256: f.gold.originals.map(canonicalHash), sealedAt: "2026-11-09T00:00:30Z",
      resolutions: [{ profileId: f.matrix.rankings.profiles[0].profileId, itemId: rows[0].itemId, relevance: 1, reason: "Synthetic bound resolution.", originalJudgmentSha256: rows.map(canonicalHash) }] };
    expect(resolveRankingGold(f.matrix, f.gold, f.manifest, f.registration.registeredAt)[0].judgments[9].relevance).toBe(1);
  });
});
