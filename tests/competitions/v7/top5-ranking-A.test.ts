import { describe, expect, it, vi } from "vitest";
import type { AiJsonResult } from "@/lib/ai/ai-client";
import { matchPlanSchema } from "@/lib/competitions/v6/contracts";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { RECOMMENDATION_DETAIL_DEADLINE_MS, RECOMMENDATION_IMPLEMENTATION_VERSION, RECOMMENDATION_MAX_ITEMS, RECOMMENDATION_POLICY_VERSION, RECOMMENDATION_RANK_HARD_TIMEOUT_MS } from "@/lib/competitions/v7/contracts";
import { buildDecisionContextV7, DECISION_RANK_PROMPT_VERSION_V7, DECISION_RANK_SYSTEM_PROMPT_V7, explainDecisionV7, rankDecisionV7, validateMatchPlanV7 } from "@/lib/competitions/v7/model";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";

const context = () => buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records: Array.from({ length: 45 }, (_, index) => syntheticRecord(index + 1)) });
type Context = ReturnType<typeof context>;
const success = (data: unknown): AiJsonResult<unknown> => ({ ok: true, data, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });
function output(ctx: Context, count: number, shortfallReason: string | null = null) {
  return { profileRevision: ctx.profile.revision, catalogVersion: ctx.catalogVersion,
    recommendations: ctx.candidates.slice(0, count).reverse().map(({ record }) => ({ itemId: record.recordId, roleIndex: 0, rationale: "用数据分析能力检查本项处理记录的可复现性。", ...rankFixtureEvidence(ctx, record.recordId) })), shortfallReason };
}

describe("Top5 generation uses the complete candidate pool", () => {
  it("assesses all 45 and selects supported series in stable order", async () => {
    const ctx = context(); let calls = 0;
    const plan = await rankDecisionV7(ctx, { modelCall: async (prompt, options) => {
      calls++;
      const packet = expandMatchingTables(JSON.parse(prompt));
      expect(packet.candidates).toHaveLength(45);
      expect(packet.candidateIds).toEqual(packet.candidates.map((row: { itemId: string }) => row.itemId));
      expect(packet.instruction).toContain("每个itemId恰好一条");
      expect(packet.instruction).toContain("按candidateIds原顺序独立判断");
      expect(packet.outputFormat.assessments.map((row: { fit: unknown }) => row.fit)).toEqual([
        expect.objectContaining({ studentBasisIndices: [0] }), expect.objectContaining({ studentBasisIndices: [], goalIndex: 0 }), null,
      ]);
      expect(options.promptVersion).toBe(`${DECISION_RANK_PROMPT_VERSION_V7}.rank`);
      expect(options).toMatchObject({ thinking: "enabled", reasoningEffort: "low", candidateCount: 45,
        recommendationPolicyVersion: RECOMMENDATION_POLICY_VERSION, implementationVersion: RECOMMENDATION_IMPLEMENTATION_VERSION });
      expect(options.systemPrompt?.split("\n")[0]).toContain("一项有效本人兴趣、目标、能力或经历为何与这个子步有关");
      expect(options.systemPrompt).toContain("本人兴趣、明确目标、自报能力或经历直接对应真实任务的具体内容或未来用途");
      expect(options.systemPrompt).toContain("只引目标时不借画像中的其他事实");
      return success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, output(ctx, 5))));
    } });
    expect(RECOMMENDATION_MAX_ITEMS).toBe(5); expect(calls).toBe(1);
    expect(plan.recommendations.map(row => row.itemId)).toEqual(output(ctx, 5).recommendations.map(row => row.itemId).sort());
    expect(plan.shortfallReason).toBeNull();
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).not.toMatch(/最多5|先输出有据的正项/u);
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("各项依据同一标准判断，互不影响");
  });

  it.each([0, 1, 2, 3, 4])("derives a count-based explanation for %i positives", async count => {
    const ctx = context(), value = output(ctx, count, "其余赛事全部不符合资格并且设备不可用。");
    const modelCall = vi.fn(async (prompt: string) => success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, value))));
    const plan = await rankDecisionV7(ctx, { modelCall });
    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(plan.recommendations).toHaveLength(count);
    expect(plan.recommendations.map(row => row.itemId)).toEqual(value.recommendations.map(row => row.itemId).sort());
    expect(plan.shortfallReason).toBe(count ? `本次初选有${count}项进入详情审核。` : "本次初选没有形成可供审核的具体任务关联。");
  });

  it.each([0, 1, 2, 3, 4])("rejects incomplete coverage with %i positive rows", async count => {
    const ctx = context(); let calls = 0;
    await expect(rankDecisionV7(ctx, { modelCall: async prompt => {
      calls++; const reply = rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, output(ctx, count)));
      reply.assessments.pop();
      return success(reply);
    } })).rejects.toThrow("invalid_output");
    expect(calls).toBe(2);
  });

  it.each([6, 10])("evaluates %i positive assessments before choosing five", async count => {
    const ctx = context(); let calls = 0;
    const selected = output(ctx, count).recommendations;
    const plan = await rankDecisionV7(ctx, { modelCall: async prompt => {
      calls++; const raw = rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, { recommendations: selected.map((row, i) => ({ ...row, matchKind: i === 0 ? "direct" : "transfer" })), shortfallReason: null }));
      raw.assessments.reverse();
      return success(raw);
    } });
    expect(calls).toBe(1);
    expect(plan.recommendations.map(row => row.itemId)).toEqual([selected[0].itemId, ...selected.slice(1).map(row => row.itemId).sort().slice(0, 4)]);
    const legacyShape = { ...output(ctx, count), recommendations: ctx.candidates.slice(0, count).map(({ record }) => ({ itemId: record.recordId,
      reasons: [{ text: "可探索这个方向。", basis: "suggestion", studentFactIds: [], competitionFactIds: [], conditions: [] }] })) };
    expect(matchPlanSchema.safeParse(legacyShape).success).toBe(true);
    expect(validateMatchPlanV7(legacyShape, ctx).issues).toContain("recommendation_limit_exceeded");
  });

  it.each(["unknown-candidate", "duplicate-item", "extra-root", "extra-row", "wrong-version"])("rejects a strict or semantic defect: %s", async defect => {
    const ctx = context(); let calls = 0;
    await expect(rankDecisionV7(ctx, { modelCall: async prompt => {
      calls++; const value = echoRankWireHeaders(prompt, output(ctx, 5));
      if (defect === "unknown-candidate") value.recommendations[0].itemId = "outside-the-full-pool";
      if (defect === "duplicate-item") value.recommendations[1].itemId = value.recommendations[0].itemId;
      if (defect === "extra-root") Reflect.set(value, "hiddenRecommendations", []);
      if (defect === "extra-row") Reflect.set(value.recommendations[0], "hiddenScore", 1);
      if (defect === "wrong-version") value.catalogVersion = "stale-catalog";
      return success(rankFixtureAssessmentReply(ctx, value));
    } })).rejects.toThrow("invalid_output");
    expect(calls).toBe(["unknown-candidate", "duplicate-item", "wrong-version"].includes(defect) ? 1 : 2);
  });

  it("validates every positive before projection, including a later sibling and a low-tier sixth item", async () => {
    const ctx = context();
    const rows = output(ctx, 6).recommendations.map((row, i) => ({ ...row, matchKind: i === 0 ? "transfer" : "direct" }));
    const original = ctx.candidates.find(({ record }) => record.recordId === rows[0].itemId)!.record;
    ctx.candidates.find(({ record }) => record.recordId === rows[1].itemId)!.record.seriesId = original.seriesId;
    const makeReply = (prompt: string) => rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, { recommendations: rows, shortfallReason: null }));
    const result = await rankDecisionV7(ctx, { modelCall: async prompt => success(makeReply(prompt)) });
    expect(result.recommendations).toHaveLength(5);
    expect(result.recommendations.some(row => row.itemId === rows[0].itemId)).toBe(false);
    expect(result.recommendations.some(row => row.itemId === rows[1].itemId)).toBe(true);
    await expect(rankDecisionV7(ctx, { modelCall: async prompt => {
      const reply = makeReply(prompt);
      reply.assessments[0].fit!.competitionFactIds = rows[2].competitionFactIds;
      return success(reply);
    } })).rejects.toThrow("invalid_output");
  });

  it("rejects an old shortlist response even with the current version headers", async () => {
    const ctx = context(); let calls = 0;
    await expect(rankDecisionV7(ctx, { modelCall: async prompt => {
      calls++;
      return success(echoRankWireHeaders(prompt, output(ctx, 5)));
    } })).rejects.toThrow("invalid_output");
    expect(calls).toBe(2);
  });

  it("defaults new stages to their hard cutoffs and preserves an explicit earlier deadline", async () => {
    const now = 1_799_999_000_000, ctx = context(), seen: { operation?: string; deadline?: number }[] = [];
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const plan = await rankDecisionV7(ctx, { modelCall: async (prompt, options) => {
        seen.push({ operation: options.operation, deadline: options.deadlineEpochMs }); return success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, output(ctx, 5))));
      } });
      const explained = { ...plan, recommendations: plan.recommendations.map(item => {
        const fact = ctx.candidates.find(({ record }) => record.recordId === item.itemId)!.record.facts[0];
        const reason = { text: fact.text, basis: "official", studentFactIds: [], competitionFactIds: [fact.id], conditions: [] };
        return { itemId: item.itemId, reasons: [reason], roleIndex: item.rankRoleIndex, roleReason: structuredClone(reason) };
      }) };
      await explainDecisionV7(ctx, plan, { modelCall: async (_prompt, options) => {
        seen.push({ operation: options.operation, deadline: options.deadlineEpochMs }); return success(explained);
      } });
      await rankDecisionV7(ctx, { deadlineEpochMs: now + 5_000, modelCall: async (prompt, options) => {
        seen.push({ operation: options.operation, deadline: options.deadlineEpochMs }); return success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, output(ctx, 5))));
      } });
      expect(seen).toEqual([
        { operation: "competition_v7_rank", deadline: now + RECOMMENDATION_RANK_HARD_TIMEOUT_MS },
        { operation: "competition_v7_explain", deadline: now + RECOMMENDATION_DETAIL_DEADLINE_MS },
        { operation: "competition_v7_rank", deadline: now + 5_000 },
      ]);
    } finally { clock.mockRestore(); }
  });
});
