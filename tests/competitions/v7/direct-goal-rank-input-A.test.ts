import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rankDecisionV7, buildDecisionContextV7, matchExplanationInputV7 } from "@/lib/competitions/v7/model";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_rank_boundary_forbids_http"); })));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("complete rank input and direct-goal responsibility", () => {
  it("canonicalizes the whole input without mutating context and orders positive witnesses stably", async () => {
    const context = buildDecisionContextV7(student({ decisionContext: { goalIntent: "explore", goalResolution: "confirmed" } }), { records: Array.from({ length: 7 }, (_, index) => syntheticRecord(index + 1)) });
    const explicitGoal = "练习核对数据清理前后的缺失值，写出可复现处理记录。";
    context.profile.goals.push(explicitGoal);
    context.candidates.forEach((candidate, index) => { candidate.conditions = [index % 2 ? "设备条件尚未落实" : "只能使用现有设备"]; });
    const snapshot = structuredClone(context), prompts: string[] = [];
    const expected = [context.candidates[5].record.recordId, context.candidates[1].record.recordId];
    for (const candidates of [[...context.candidates].reverse(), [...context.candidates.slice(3), ...context.candidates.slice(0, 3)]]) {
      const plan = await rankDecisionV7({ ...context, candidates }, { modelCall: async (prompt, options) => {
        prompts.push(prompt);
        expect(options).toMatchObject({ thinking: "enabled", reasoningEffort: "low", maxAttempts: 1 });
        expect(options.systemPrompt).toContain("候选留池不代表满足全部个人限制");
        expect(options.systemPrompt).toContain("一项有效本人兴趣、目标、能力或经历为何与这个子步有关");
        expect(options.systemPrompt).toContain("未知或条件化资源");
        expect(options.systemPrompt).toContain("同一种具体操作或判断");
        const input = JSON.parse(prompt);
        expect(input.studentBasisOptions).toEqual([]);
        expect(input.studentGoalOptions).toEqual([{ index: 1, text: explicitGoal }]);
        return { ok: true, data: rankFixtureAssessmentReply(context, echoRankWireHeaders(prompt, { recommendations: expected.map(itemId => ({ itemId, roleIndex: 0,
          rationale: "把目标中的缺失值核对接到这项任务的清理记录，核对哪些条目改变。", ...rankFixtureEvidence(context, itemId, 1) })),
        shortfallReason: "合成测试只选择两条有实质联系的任务。" })), model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", durationMs: 1, attempts: 1 };
      } });
      expect(plan.recommendations.map(item => item.itemId)).toEqual([...expected].sort());
      expect(plan.recommendations.every(item => item.rankGoalIndex === 1 && item.reasons[0].studentFactIds.length === 0)).toBe(true);
      expect(matchExplanationInputV7(context, plan).candidates.map(item => item.rankBasisGoal)).toEqual(expected.map(() => ({ index: 1, text: explicitGoal })));
    }
    expect(prompts[0]).toBe(prompts[1]);
    const wire = expandCandidateEvidence(expandMatchingTables(JSON.parse(prompts[0]))) as { candidates: unknown[] };
    expect(wire.candidates).toHaveLength(7); expect(prompts[0]).toContain("只能使用现有设备"); expect(prompts[0]).toContain("设备条件尚未落实");
    expect(context).toEqual(snapshot);
  });

  it.each(["broad-goal", "out-of-range", "mixed-alias", "old-field", "other-owner", "fee"])("rejects %s as sole positive ranking evidence", async defect => {
    const records = [syntheticRecord(1), syntheticRecord(2)];
    const original = records[0].facts[0];
    const fee = { ...original, id: "rank-same-owner-fee", field: "fee", text: "合成的个人费用为100元。" };
    records[0].facts.push(fee);
    const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"],
      decisionContext: { goalIntent: "explore", goalResolution: "confirmed" } }), { records });
    const active = context.profile.facts.find(fact => fact.field === "skills")!;
    const unknown = { ...active, id: "rank-unknown-skill", state: "unknown" as const, confirmed: false, originalText: "还不确定会不会清理数据。" };
    context.profile.facts.push(unknown);
    const itemId = records[0].recordId;
    let attempts = 0;
    await expect(rankDecisionV7(context, { modelCall: async prompt => {
      attempts++;
      const { studentBasisOptions, studentGoalOptions, candidates, profile } = JSON.parse(prompt);
      expect(studentBasisOptions).toEqual([{ index: 0, text: "数据分析与建模" }]);
      const unknownOnWire = profile.facts.find((fact: { originalText: string }) => fact.originalText === unknown.originalText);
      expect(unknownOnWire.state).toBe("unknown");
      expect(studentGoalOptions).toEqual([]);
      const citedTaskIds = candidates.flatMap((candidate: { officialTask: { factIds: (string | null)[] }[] }) => candidate.officialTask.flatMap(group => group.factIds));
      expect(citedTaskIds.filter((id: string | null) => id !== null)).toHaveLength(2);
      const row = { itemId, roleIndex: 0, rationale: "把本人数据分析用于清理任务并核对缺失值。", ...rankFixtureEvidence(context, itemId) };
      if (defect === "broad-goal") { row.studentBasisIndices = []; row.goalIndex = 0; }
      if (defect === "out-of-range") row.studentBasisIndices = [1];
      if (defect === "mixed-alias") Reflect.set(row, "studentBasisIndices", [0, unknownOnWire.id]);
      if (defect === "old-field") { Reflect.deleteProperty(row, "studentBasisIndices"); Reflect.set(row, "studentFactIds", [unknownOnWire.id]); }
      if (defect === "other-owner") row.competitionFactIds = [records[1].facts[0].id];
      if (defect === "fee") row.competitionFactIds = [fee.id];
      return { ok: true, data: rankFixtureAssessmentReply(context, echoRankWireHeaders(prompt, { recommendations: [row], shortfallReason: "合成测试只比较一项。" })),
        model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", durationMs: 1, attempts: 1 };
    } })).rejects.toThrow("invalid_output");
    expect(attempts).toBe(2);
  });

  it("maps the dedicated indices back to the exact original student facts in the selected order", async () => {
    const context = buildDecisionContextV7(student({ skills: ["data-analysis"], interests: ["data"], confirmedFields: ["stage", "skills", "interests"] }),
      { records: [syntheticRecord(1)] });
    const originalFacts = context.profile.facts.filter(fact => ["skills", "interests"].includes(fact.field));
    const constraint = { ...originalFacts[0], id: "rank-permission-constraint", field: "constraints", originalText: "只能在获准之后处理材料。" };
    context.profile.facts.splice(1, 0, constraint);
    const itemId = context.candidates[0].record.recordId;
    const ranked = await rankDecisionV7(context, { modelCall: async prompt => {
      const wire = JSON.parse(prompt);
      expect(wire.studentBasisOptions.map((option: { index: number }) => option.index)).toEqual([0, 1]);
      expect(wire.studentBasisOptions.every((option: object) => !Object.hasOwn(option, "id"))).toBe(true);
      expect(wire.profile.facts).toContainEqual(expect.objectContaining({ field: "constraints", originalText: constraint.originalText }));
      return { ok: true, data: rankFixtureAssessmentReply(context, echoRankWireHeaders(prompt, { recommendations: [{ itemId, roleIndex: 0,
        rationale: "用所报分析能力和数据兴趣练习清理前后记录的核对。", ...rankFixtureEvidence(context, itemId), studentBasisIndices: [1, 0] }],
      shortfallReason: "合成池只有此一项。" })), model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", durationMs: 1, attempts: 1 };
    } });
    expect(ranked.recommendations[0].reasons[0].studentFactIds).toEqual(originalFacts.map(fact => fact.id).reverse());
  });

  it("allows a meaningful zero-result shortfall without selecting to fill five", async () => {
    const context = buildDecisionContextV7(student(), { records: [syntheticRecord(1), syntheticRecord(2)] });
    const result = await rankDecisionV7(context, { modelCall: async (prompt, options) => {
      expect(options.systemPrompt).toContain("各项依据同一标准判断，互不影响");
      return { ok: true, data: rankFixtureAssessmentReply(context, echoRankWireHeaders(prompt, { recommendations: [], shortfallReason: "合成任务未能直接服务当前目标且不突破已知限制。" })), model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", durationMs: 1, attempts: 1 };
    } });
    expect(result.recommendations).toEqual([]); expect(result.shortfallReason).toBeTruthy();
  });
});
