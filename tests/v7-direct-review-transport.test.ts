import { describe, expect, it } from "vitest";
import { claim } from "@/lib/competitions/v6/engine";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import { buildAssertionReviewPacketV7, type ReviewAssertionV7 } from "@/lib/competitions/v7/evidence-packet";
import { directAssertionReviewPacketV7 } from "@/lib/competitions/v7/review-transport";
import { student, syntheticRecord } from "./competitions/v6/decision-fixtures";
import { readDirectReviewWire } from "./helpers/v7-review-wire";

function fixture() {
  const ctx = buildDecisionContextV7(student(), { records: [syntheticRecord(1), syntheticRecord(2)] });
  const plan: MatchPlanV6 = { profileRevision: ctx.profile.revision, catalogVersion: ctx.catalogVersion,
    recommendations: ctx.candidates.map(({ record }) => ({ itemId: record.recordId,
      reasons: [claim(record.facts[0].text, "official", [], [record.facts[0].id])] })), shortfallReason: null };
  plan.comparison = claim("合成的前两项比较，用于核查双项证据绑定。", "inference", [], ctx.candidates.map(({ record }) => record.facts[0].id));
  const rows: ReviewAssertionV7[] = [...plan.recommendations.map(item => ({ key: `${item.itemId}.reason.0`, itemId: item.itemId, reason: item.reasons[0] })),
    { key: "comparison", itemId: plan.recommendations[0].itemId, reason: plan.comparison }];
  return { ctx, plan, rows, packet: buildAssertionReviewPacketV7(ctx, plan, rows) };
}

describe("direct per-assertion review transport", () => {
  it("conserves claims, cited facts and counterevidence while omitting only exact copies and tooling", () => {
    const { packet, rows } = fixture(), original = structuredClone(packet);
    const transport = directAssertionReviewPacketV7(packet);
    const restored = readDirectReviewWire(transport.packet, rows.map(row => row.key));
    expect(restored.assertions).toEqual(original.assertions);
    expect(restored.profile).toEqual(original.profile);
    const requestBeforeMutation = structuredClone(transport.packet);
    for (const [index, assertion] of transport.packet.assertions.entries()) {
      const expected = original.assertionEvidence[index];
      expect(assertion.citedStudentFacts).toEqual(expected.citedStudentFacts);
      expect(assertion.studentCounterEvidence).toEqual(expected.studentCounterEvidence);
      for (const item of assertion.competitionItems) {
        const own = expected.competitionItems.find(row => row.itemId === item.itemId)!;
        expect(item.citedFacts).toEqual(own.citedFacts);
        expect(item.contradictionContext.facts).toEqual(own.contradictionContext.facts);
        expect(item.sources).toEqual(own.sources.map(({ evidenceArtifact: _artifact, verificationMethod: _method, retrievedAt: _retrieved, ...source }) => source));
        const boundary = original.candidateBoundaries.find(row => row.itemId === item.itemId)!;
        const shared = transport.packet.sharedCandidateBoundaries.find(row => row.boundaryId === item.candidateBoundaryId)!;
        expect(shared.itemId).toBe(item.itemId);
        expect(shared.boundary.conditions).toEqual(boundary.conditions);
        expect(shared.boundary.qualifiers).toEqual(boundary.qualifiers);
        for (const fact of boundary.boundaryFacts) expect([...item.citedFacts, ...item.contradictionContext.facts, ...shared.boundary.boundaryFacts]).toContainEqual(fact);
      }
    }
    expect(transport.packet.assertions[2].competitionItems).toHaveLength(2);
    expect(transport.packet).not.toHaveProperty("tableSchemas");
    expect(transport.packet).not.toHaveProperty("evidenceDictionary");
    packet.profile.facts[0].originalText = "later mutation must not change this request";
    packet.candidateBoundaries[0].conditions.push("later boundary mutation");
    packet.assertions[0].reason.text = "later assertion mutation";
    expect(transport.packet).toEqual(requestBeforeMutation);
  });

  it("isolates unrelated selected-item boundaries while preserving the complete fixed order", () => {
    const { ctx, plan, rows } = fixture();
    const packet = buildAssertionReviewPacketV7(ctx, plan, [rows[0]]), transport = directAssertionReviewPacketV7(packet);
    expect(transport.packet).not.toHaveProperty("additionalCandidateBoundaries");
    expect(transport.packet.assertions[0].competitionItems).toHaveLength(1);
    expect(transport.packet.fixedOrder.itemIds).toEqual(plan.recommendations.map(row => row.itemId));
    const restored = readDirectReviewWire(transport.packet, [rows[0].key], [plan.recommendations[0].itemId]);
    expect(restored.assertions).toEqual(packet.assertions);
    expect(restored.assertionEvidence[0].competitionItems[0].citedFacts).toEqual(packet.assertionEvidence[0].competitionItems[0].citedFacts);
  });

  it("retains budget unknowns, conditional editorial limits and a changed same-ID fact instead of deduplicating by ID", () => {
    const { packet } = fixture(), boundary = packet.candidateBoundaries[0];
    const fact = packet.assertionEvidence[0].competitionItems[0].citedFacts[0];
    const changed = { ...structuredClone(fact), text: "个人设备使用权和总支出仍需核实。", status: "pending_review" as const, conflictsWith: [fact.id] };
    boundary.boundaryFacts.push(changed);
    boundary.conditions.push("个人总支出仍需核实，尚不能认定符合已报预算。");
    boundary.editorialSectionBoundaries.push({ path: "/sections/task/0", text: "先独立推导状态转移并展开算法证明。", kind: "editorial_inference", factIds: [fact.id], conditions: [], factIdsArePremisesOnly: true, use: boundary.use },
      { path: "/sections/nextStep/0", text: "没有获得设备权限时不能完成实测。", kind: "editorial_inference", factIds: [fact.id], conditions: ["需要核实个人设备使用权"], factIdsArePremisesOnly: true, use: boundary.use });
    const wire = directAssertionReviewPacketV7(packet).packet;
    const result = wire.sharedCandidateBoundaries.find(row => row.boundaryId === wire.assertions[0].competitionItems[0].candidateBoundaryId)!.boundary;
    expect(result.conditions).toContain("个人总支出仍需核实，尚不能认定符合已报预算。");
    expect(result.boundaryFacts).toContainEqual(changed);
    expect(result.editorialSectionBoundaries.find(row => row.path === "/sections/task/0")).not.toHaveProperty("text");
    expect(result.editorialSectionBoundaries.find(row => row.path === "/sections/nextStep/0")).toEqual(boundary.editorialSectionBoundaries[1]);
  });

  it("shares each exact owner boundary once and rejects a cross-owner reference in the independent reader", () => {
    const { packet, rows } = fixture();
    packet.candidateBoundaries[0].conditions.push("owner-A-only resource limit");
    packet.candidateBoundaries[1].conditions.push("owner-B-only resource limit");
    const wire = directAssertionReviewPacketV7(packet).packet;
    expect(wire.sharedCandidateBoundaries).toHaveLength(2);
    const ownerA = wire.sharedCandidateBoundaries.find(row => row.itemId === packet.candidateBoundaries[0].itemId)!;
    const ownerB = wire.sharedCandidateBoundaries.find(row => row.itemId === packet.candidateBoundaries[1].itemId)!;
    expect(ownerA.boundary.conditions).not.toContain("owner-B-only resource limit");
    expect(ownerB.boundary.conditions).not.toContain("owner-A-only resource limit");
    expect(wire.assertions[0].competitionItems[0].candidateBoundaryId).toBe(ownerA.boundaryId);
    expect(wire.assertions[2].competitionItems[0].candidateBoundaryId).toBe(ownerA.boundaryId);
    expect(wire.assertions.flatMap(row => row.competitionItems).every(item => !Object.hasOwn(item, "candidateBoundaries"))).toBe(true);
    expect(readDirectReviewWire(wire, rows.map(row => row.key)).assertions).toEqual(packet.assertions);
    const crossed = structuredClone(wire);
    crossed.assertions[0].competitionItems[0].candidateBoundaryId = ownerB.boundaryId;
    expect(() => readDirectReviewWire(crossed, rows.map(row => row.key))).toThrow();
  });

  it("restores only keys, preserving order, rejected verdicts and strict-schema extras", () => {
    const { packet, rows } = fixture(), transport = directAssertionReviewPacketV7(packet);
    const checks = [2, 0, 1].map(index => ({ key: `R0${index + 1}`, supported: index !== 0, reason: `fixture-${index}`, unexpected: true }));
    expect(transport.restoreChecks({ checks, unexpected: true })).toEqual({ unexpected: true,
      checks: [2, 0, 1].map(index => ({ key: rows[index].key, supported: index !== 0, reason: `fixture-${index}`, unexpected: true })) });
    expect(checks[1].key).toBe("R01");
  });

  it.each(["missing", "duplicate", "foreign", "original-key", "empty", "wrong-shape"])("rejects %s keys rather than silently accepting an incomplete review", kind => {
    const { packet, rows } = fixture(), transport = directAssertionReviewPacketV7(packet);
    const checks = rows.map((_row, index) => ({ key: `R0${index + 1}`, supported: true, reason: "offline fixture" }));
    if (kind === "missing") checks.pop();
    if (kind === "duplicate") checks[1].key = checks[0].key;
    if (kind === "foreign") checks[0].key = "R64";
    if (kind === "original-key") checks[0].key = rows[0].key;
    if (kind === "empty") checks.length = 0;
    expect(() => transport.restoreChecks(kind === "wrong-shape" ? { checks: null } : { checks })).toThrow("incomplete_support_review");
  });

  it.each(["missing-evidence", "duplicate-evidence", "wrong-owner", "missing-boundary", "duplicate-boundary", "duplicate-assertion", "no-assertion"])("rejects malformed internal %s input before dispatch", kind => {
    const { packet } = fixture();
    if (kind === "missing-evidence") packet.assertionEvidence.pop();
    if (kind === "duplicate-evidence") packet.assertionEvidence[1] = packet.assertionEvidence[0];
    if (kind === "wrong-owner") packet.assertionEvidence[0].itemId = "unselected";
    if (kind === "missing-boundary") packet.candidateBoundaries.pop();
    if (kind === "duplicate-boundary") packet.candidateBoundaries[1] = packet.candidateBoundaries[0];
    if (kind === "duplicate-assertion") packet.assertions[1] = packet.assertions[0];
    if (kind === "no-assertion") packet.assertions.length = 0;
    expect(() => directAssertionReviewPacketV7(packet)).toThrow("invalid_review_packet");
  });
});
