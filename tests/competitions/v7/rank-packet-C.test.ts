import { describe, expect, it } from "vitest";
import { compactRankInputV7 } from "../../../src/lib/competitions/v7/rank-packet";
import { compactCandidateEvidence, expandCandidateEvidence } from "../../../src/lib/competitions/v6/model-evidence-pack";
import { compactMatchingTables, expandMatchingTables } from "../../../src/lib/competitions/v6/model-match-tables";

const boundary = "原始范围完整保留；历史版本不能用于新届保证，未知费用不能当免费。";
function fixture() {
  const unknowns = [{ modules: ["investment"], text: boundary, reason: null, conditions: ["资源条件尚未确认"], factIds: [] }];
  return {
    profile: { revision: "profile-original", primaryGoal: null, retractedFactIds: ["student-3"],
      facts: ["affirmed", "negated", "conditional", "retracted", "unknown", "affirmed", "affirmed", "negated"].map((state, i) => ({
        id: `student-${i}`, state, originalText: `学生原话${i}：不是已经会，条件未满足；不要改成已有能力。`, answerId: `answer-${i}` })),
      updates: [{ answerId: "answer-7", originalText: "更正：没有独立做过，保留否定与撤回关系。", retracts: ["student-3"] }] },
    candidates: Array.from({ length: 45 }, (_, i) => ({
      itemId: `candidate-${i}`, seriesId: `series-${i}`, name: `竞赛${i}`, unknowns: structuredClone(unknowns),
      taskEvidence: { official_fact: { historical: Array.from({ length: i < 25 ? 5 : 4 }, (_, j) => ({
        id: `fact-${i}-${j}`, field: j === 0 ? "track" : "participation", text: j === 0 ? boundary : `完整任务${i}-${j}、角色关系和投入条件`,
        scopeParts: [boundary], usable: true })) } },
      editorialRoleCapabilities: Array.from({ length: i < 36 ? 2 : 1 }, (_, j) => ({ name: `角色${j}`, task: "可选任务路径", skills: ["已有技能及可学技能不混同"], prerequisite: boundary, factIds: [`fact-${i}-0`] })),
      participationBounds: i < 36 ? [{ field: "equipment", operator: "unknown", value: "不能假定已经拥有", note: boundary,
        evidence: [{ id: `separate-bound-${i}`, kind: "unknown", status: "unknown", scope: boundary, usable: false }] }] : [],
    })),
    candidateConditions: Array.from({ length: 87 }, (_, i) => ({ text: `原始条件${i}：日期与设备约束在同一句中，不能拆掉资源要求。`, itemIds: [`candidate-${i % 45}`] })),
  };
}

// Existing independent v6 decoders retain ownership of table/dictionary scope.
function restore(wire: unknown) {
  const decoded = expandCandidateEvidence(expandMatchingTables(wire)) as ReturnType<typeof fixture> & { candidateDefaults?: { unknowns: unknown } };
  if (!decoded.candidateDefaults) return decoded;
  const { candidateDefaults, ...rest } = decoded;
  return { ...rest, candidates: rest.candidates.map(candidate => ({ ...candidateDefaults, ...candidate })) };
}

describe("rank-only lossless wire packing", () => {
  it("preserves the full45 pool, profile corrections,205 facts,81 roles,36 bounds and87 conditions", () => {
    const input = fixture(), wire = compactRankInputV7(input) as { candidateDefaults: { unknowns: { text: unknown }[] } };
    expect(restore(wire)).toEqual(input);
    expect(typeof wire.candidateDefaults.unknowns[0].text).toBe("string");
    expect(JSON.stringify(wire.candidateDefaults)).not.toContain('"$text"');
    expect(input.candidates).toHaveLength(45);
    expect(input.candidates.flatMap(c => c.taskEvidence.official_fact.historical)).toHaveLength(205);
    expect(input.candidates.flatMap(c => c.editorialRoleCapabilities)).toHaveLength(81);
    expect(input.candidates.flatMap(c => c.participationBounds)).toHaveLength(36);
  });

  it("keeps each original unknowns value when just one candidate has a different resource or conflict condition", () => {
    const input = fixture();
    input.candidates[17].unknowns[0].conditions.push("仅此候选：下届日期未知且需要实验室，不可当作无需设备");
    const wire = compactRankInputV7(input) as Record<string, unknown>;
    expect(wire).not.toHaveProperty("candidateDefaults");
    expect(restore(wire)).toEqual(input);
  });

  it("uses existing ordinary-array decoding for smaller text references without changing dictionary meaning", () => {
    const input = fixture();
    input.candidates[1].unknowns[0].text = "此候选不同的完整未知条件，不能合并整列";
    const original = compactMatchingTables(compactCandidateEvidence(input));
    const compact = compactRankInputV7(input);
    expect(restore(compact)).toEqual(input);
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(Buffer.byteLength(JSON.stringify(original)));
    expect(compact).not.toHaveProperty("candidateDefaults");
    expect((compact as Record<string, unknown>).evidenceDictionary).toEqual((original as Record<string, unknown>).evidenceDictionary);
  });
});
