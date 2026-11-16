import { describe, expect, it } from "vitest";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { claim } from "@/lib/competitions/v6/engine";
import { buildAssertionReviewPacketV7 } from "@/lib/competitions/v7/evidence-packet";
import { buildDecisionContextV7, explanationEvidence } from "@/lib/competitions/v7/model";
import { student, syntheticRecord } from "../v6/decision-fixtures";

describe("fast24 generation-only source metadata projection", () => {
  it("keeps every fact source and the example boundary source while review retains the original research metadata", () => {
    const record = syntheticRecord(1);
    record.sources[0] = { ...record.sources[0], evidenceArtifact: "private-research-location.json", retrievedAt: "2026-11-05" };
    const primary = record.sources[0];
    record.sources.push({ ...primary, id: "boundary-source" }, { ...primary, id: "unused-import-source", accessStatus: "imported_unrechecked" });
    record.deepDive = { status: "reviewed", representativeTask: "合成任务", workedExample: { title: "合成案例", origin: "official_task", sourceIds: ["boundary-source"], sourceBoundary: "案例只用于理解任务，不是官方指定方法。", steps: [], reviewQuestions: [] }, rubricMapping: [], rolePaths: [], fourWeekPlan: [], exitConditions: [], missingForPublication: [] };
    const context = buildDecisionContextV7(student(), { records: [record] }), before = structuredClone(context.records);
    const reason = claim(record.facts[0].text, "official", [], [record.facts[0].id]);
    const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, recommendations: [{ itemId: record.recordId, reasons: [reason] }], shortfallReason: "合成池仅一项。" };
    const [wire] = explanationEvidence(context, plan);
    expect(wire.facts).toEqual(record.facts);
    expect(wire.sources.map(source => source.id)).toEqual([primary.id, "boundary-source"]);
    for (const source of wire.sources) {
      const original = record.sources.find(row => row.id === source.id)!;
      const { evidenceArtifact: _artifact, verificationMethod: _method, retrievedAt: _retrieved, ...expected } = original;
      expect(source).toEqual(expected);
      expect(source).toMatchObject({ authority: "organizer", accessStatus: "body_read", scope: original.scope, url: original.url, checkedAt: original.checkedAt });
    }
    const review = buildAssertionReviewPacketV7(context, plan, [{ key: `${record.recordId}.reason.0`, itemId: record.recordId, reason }]);
    expect(review.assertionEvidence[0].competitionItems[0].sources).toEqual([primary]);
    expect(context.records).toEqual(before);
  });
});
