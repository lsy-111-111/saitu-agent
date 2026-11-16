import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDecisionContextV7, DECISION_RANK_SYSTEM_PROMPT_V7, DECISION_REVIEW_SYSTEM_PROMPT_V7, rankDecisionV7 } from "@/lib/competitions/v7/model";
import { compactRankingCandidatesV7, readableRankingCandidatesV7, rankingLearningBoundaryV7, rankingTaskConditionV7, rankingTaskTextV7 } from "@/lib/competitions/v7/rank-packet";
import { getMatchingCatalogRecords } from "@/lib/competitions/v7/catalog";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";

afterEach(() => vi.unstubAllGlobals());

describe("readable rank-only task projection", () => {
  it("carries all 81 original personal deliverables beside their original role indexes across the complete 45-item pool", () => {
    const context = buildDecisionContextV7(student(), { records: getMatchingCatalogRecords() }), before = structuredClone(context);
    const cards = compactRankingCandidatesV7(context);
    expect(cards).toHaveLength(45);
    expect(cards.flatMap(card => card.contributions)).toHaveLength(81);
    cards.forEach((card, index) => {
      const record = context.candidates[index].record;
      expect(card.itemId).toBe(record.recordId);
      expect(card.contributions).toMatchObject(record.roles.map((role, roleIndex) => ({ roleIndex, name: role.name,
        task: role.task, personalDeliverable: role.personalDeliverable, prerequisite: role.prerequisite })));
    });
    expect(context).toEqual(before);
  });

  it("keeps every task and explicit profile boundary, and stably orders positives", async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_only"); }));
    const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records: Array.from({ length: 7 }, (_, i) => syntheticRecord(i + 1)) });
    const before = structuredClone(context), prompts: string[] = [];
    const chosen = [context.candidates[4].record.recordId, context.candidates[0].record.recordId];
    for (const candidates of [context.candidates, [...context.candidates].reverse()]) {
      const plan = await rankDecisionV7({ ...context, candidates }, { modelCall: async (prompt, options) => {
        prompts.push(prompt);
        const wire = JSON.parse(prompt);
        expect(wire).not.toHaveProperty("tableSchemas"); expect(wire).not.toHaveProperty("evidenceDictionary");
        expect(wire.candidates).toHaveLength(7); expect(wire.profile.facts).toHaveLength(context.profile.facts.length);
        const sorted = [...context.candidates].sort((a, b) => a.record.recordId < b.record.recordId ? -1 : a.record.recordId > b.record.recordId ? 1 : 0);
        for (const [index, card] of wire.candidates.entries()) expect(card.contributions).toMatchObject(sorted[index].record.roles.map((role, roleIndex) => ({
          roleIndex, name: role.name, task: role.task, personalDeliverable: role.personalDeliverable, prerequisite: role.prerequisite,
        })));
        expect(wire.candidateBoundaries.items.map((row: { itemId: string }) => row.itemId)).toEqual(wire.candidateIds);
        expect(options).toMatchObject({ thinking: "enabled", reasoningEffort: "low", maxTokens: 8192, maxAttempts: 1 });
        return { ok: true, data: rankFixtureAssessmentReply(context, echoRankWireHeaders(prompt, {
          recommendations: chosen.map(itemId => ({ itemId, roleIndex: 0, rationale: "用数据分析能力在本任务中核对清理后的输入。", ...rankFixtureEvidence(context, itemId) })), shortfallReason: "其余候选没有足够具体的方法联系。" })),
        model: "deepseek-flash", upstreamAttempted: true as const, httpStatus: 200, finishReason: "stop", durationMs: 1, attempts: 1 };
      } });
      expect(plan.recommendations.map(item => item.itemId)).toEqual([...chosen].sort());
    }
    expect(prompts[0]).toBe(prompts[1]); expect(context).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves a rubric-only mechanism, permission boundary and unknown total cost", () => {
    const taskText = rankingTaskTextV7("rubric", "报告20分、创意30分；若角色分配无效则整份提交无分。输入大小最多二十万，必须独立实现。");
    expect(taskText).toContain("报告20分、创意30分；");
    expect(taskText).toContain("若角色分配无效则整份提交无分。输入大小最多二十万，必须独立实现。");
    expect(rankingTaskTextV7("participation", "经过学校遴选推荐；必须离线运行，不得上传用户数据。")).toBe("必须离线运行，不得上传用户数据。");
    expect(rankingTaskConditionV7("下届资格另核；个人总支出、设备使用权与许可未知。")).toBe("个人总支出、设备使用权与许可未知。");
    const mixedTask = "任务书说明能量集成、经济分析及相关源文件计入评分，不能仅交美化后的图。";
    expect(rankingTaskTextV7("rubric", mixedTask)).toBe(mixedTask);
    const dimensions = rankingTaskTextV7("rubric", "书面评分100分：财务20、风险15、ESG15。");
    expect(dimensions).toContain("财务"); expect(dimensions).toContain("风险"); expect(dimensions).toContain("ESG");
    expect(rankingTaskTextV7("rubric", "该题425分、2秒1024MiB。")).toBe("该题425分、2秒1024MiB。");
    expect(rankingTaskTextV7("rubric", "同分时每次错误提交罚5分钟，已解题的拒绝提交每次罚20分钟。")).toBe("同分时每次错误提交罚5分钟，已解题的拒绝提交每次罚20分钟。");
    expect(rankingTaskTextV7("rubric", "官方样例为33分。")).toBe("官方样例为33分。");
    expect(rankingLearningBoundaryV7("不给实际装置操作指令。")).toBe("不给实际装置操作指令。");
    for (const cost of ["下一届资格、收费与评分未核。", "当届新队报名是否仍开放与具体费率未核。"]) expect(rankingTaskConditionV7(cost)).toBe(cost);
    const context = buildDecisionContextV7(student(), { records: [syntheticRecord(1)] });
    const row = readableRankingCandidatesV7(context)[0];
    expect(row.editorialRoles).toHaveLength(context.candidates[0].record.roles.length);
    expect(JSON.stringify(row)).not.toContain("fourWeekPlan"); expect(JSON.stringify(row)).not.toContain("contributionProof");
  });

  it("distinguishes concrete adjacent methods from generic activity and keeps future-review limits", () => {
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("同一种具体操作或判断");
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("目标单独成立时使用goalIndex和空的studentBasisIndices");
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("不把未知写成不符合或已满足");
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("各项依据同一标准判断，互不影响");
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("已知限制不得假定借用、买入或换队即可解除");
    expect(DECISION_REVIEW_SYSTEM_PROMPT_V7).toContain("保留原届次、赛道及来源范围");
    expect(DECISION_REVIEW_SYSTEM_PROMPT_V7).toContain("不从范围标题推机制、数值、资格或要求");
    expect(DECISION_REVIEW_SYSTEM_PROMPT_V7).toContain("不要求不存在的独立目标factId");
    expect(DECISION_REVIEW_SYSTEM_PROMPT_V7).toContain("不等于已执行，也不等于已有材料、记录或结果");
    expect(DECISION_REVIEW_SYSTEM_PROMPT_V7).toContain("事实前提须有相应用途引用");
  });
});
