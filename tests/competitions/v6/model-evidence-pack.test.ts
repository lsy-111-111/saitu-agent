import { describe, expect, it } from "vitest";
import { compactCandidateEvidence, expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";

describe("lossless model evidence transport", () => {
  const text = "仅适用于给定历史届次与组别，报名费用未知，团队成果不代表个人独立完成；不得将未来条件写成已拥有资源。".repeat(3);
  const scope = { editionId: "2025-historical", region: "only-this-region", educationStages: ["undergraduate"], registrationOpen: false };
  const candidates = Array.from({ length: 5 }, (_, i) => ({ itemId: `item-${i}`, seriesId: `series-${i}`, tasks: [{ text, factIds: [`fact-${i}`] }], facts: [{ id: `fact-${i}`, text, scope, status: "historical" }], conditions: [text] }));

  it("reconstructs every byte of evidence and preserves candidates, order and student negation", () => {
    const input = { profile: { facts: [{ id: "student-1", text, state: "negated" }], sourceText: '{"$text":"t0"}' }, candidates };
    const packed = compactCandidateEvidence(input) as typeof input & { evidenceDictionary: unknown };
    expect(packed.evidenceDictionary).toBeDefined();
    expect(packed.profile).toEqual(input.profile);
    expect(packed.candidates.map(c => c.itemId)).toEqual(candidates.map(c => c.itemId));
    expect(expandCandidateEvidence(packed)).toEqual(input);
    expect(Buffer.byteLength(JSON.stringify(packed))).toBeLessThan(Buffer.byteLength(JSON.stringify(input)) * 0.6);
  });

  it("keeps dictionary identities stable when the candidate order is shuffled", () => {
    const first = compactCandidateEvidence({ candidates }) as { evidenceDictionary: unknown };
    const shuffled = compactCandidateEvidence({ candidates: [...candidates].reverse() }) as { evidenceDictionary: unknown };
    expect(first.evidenceDictionary).toEqual(shuffled.evidenceDictionary);
    expect(expandCandidateEvidence(shuffled)).toEqual({ candidates: [...candidates].reverse() });
  });

  it("does not reinterpret literal reference-looking prose or change a unique short payload", () => {
    const input = { candidates: [{ itemId: "literal", text: '{"$text":"t0"}', facts: [] }] };
    expect(compactCandidateEvidence(input)).toBe(input);
    expect(expandCandidateEvidence(input)).toEqual(input);
  });

  it("fails closed when an audit dictionary loses evidence", () => {
    const packed = compactCandidateEvidence({ candidates }) as { evidenceDictionary: { texts: Record<string, string> } };
    packed.evidenceDictionary.texts = {};
    expect(() => expandCandidateEvidence(packed)).toThrow("missing_evidence_dictionary_reference");
  });

  it("deduplicates repeated registration notes and business values without dropping their scope", () => {
    const note = "历史任务只用于探索，不表示目前开放报名，下一届资格与费用仍需要核对。";
    const input = { candidates: Array.from({ length: 39 }, (_, index) => ({ itemId: `candidate-${index}`,
      registration: { status: "historical", note }, personalCost: null,
      milestones: [{ note, precision: "unknown", timezone: "Asia/Shanghai" }],
      conditions: ["队伍与个人资源尚未确认。", note] })) };
    const packed = compactCandidateEvidence(input);
    expect(expandCandidateEvidence(packed)).toEqual(input);
    expect(Buffer.byteLength(JSON.stringify(packed))).toBeLessThan(Buffer.byteLength(JSON.stringify(input)) * 0.6);
  });
});
