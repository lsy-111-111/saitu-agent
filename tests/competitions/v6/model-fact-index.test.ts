import { describe, expect, it } from "vitest";
import { indexMatchingEvidence, restoreMatchingEvidence } from "@/lib/competitions/v6/model-fact-index";

describe("matching evidence references with full server dictionary", () => {
  const candidates = Array.from({ length: 27 }, (_, index) => ({ itemId: `c${index}`, conditions: ["资格仍未知"], tasks: [{ text: "实际完整任务", factIds: [`f${index}`] }], roles: [{ task: "完整角色任务", factIds: [`f${index}`] }], facts: [{ id: `f${index}`, field: "track", text: `完整原文${index}：${"必须保留否定、未知及历史范围。".repeat(40)}`, kind: "official_fact", status: "historical", scope: { editionId: "2025", region: "原范围" } }] }));
  it("retains every candidate and exact fact metadata and reconstructs all full text", () => {
    const input = { profile: { facts: [{ text: "我明确不愿意编程", state: "negated" }] }, candidates: candidates.map(row => ({...row, investment:[{text:"长编辑建议".repeat(100)}],benefits:[{text:"条件性收益".repeat(100)}],decisionBounds:{cost:{minimumPersonalCny:100,maximumPersonalCny:null},teamResourcesAndTime:null},difficulty:[{summary:"需补足基础技能"}]})) };
    const indexed = indexMatchingEvidence(input);
    expect(indexed.input.candidates).toHaveLength(27);
    expect(indexed.factCount).toBe(27);
    expect(indexed.input.candidates.map(row => row.itemId)).toEqual(candidates.map(row => row.itemId));
    expect(indexed.input.candidates[0].conditions).toEqual(candidates[0].conditions);
    expect(indexed.input.candidates[0].roles).toEqual(candidates[0].roles);
    expect(restoreMatchingEvidence(indexed.input, indexed.dictionary, indexed.moduleDictionary)).toEqual(input);
    expect(indexed.input.candidates[0].decisionBounds).toEqual(input.candidates[0].decisionBounds);
    expect(indexed.input.candidates[0].difficulty).toEqual(input.candidates[0].difficulty);
    expect(() => restoreMatchingEvidence(indexed.input, indexed.dictionary)).toThrow("missing_frozen_module_reference");
    expect(Buffer.byteLength(JSON.stringify(indexed.input))).toBeLessThan(Buffer.byteLength(JSON.stringify(input)) / 2);
  });
  it("keeps dictionary bytes stable under candidate shuffling and rejects scope drift", () => {
    const first = indexMatchingEvidence({ candidates });
    const shuffled = indexMatchingEvidence({ candidates: [...candidates].reverse() });
    expect(JSON.stringify(first.dictionary)).toBe(JSON.stringify(shuffled.dictionary));
    const changed = structuredClone(first.input);
    changed.candidates[0].facts[0].scope = "another-scope";
    expect(() => restoreMatchingEvidence(changed, first.dictionary)).toThrow("fact_index_dictionary_binding_mismatch");
  });
});
