import { describe, expect, it } from "vitest";
import type { AiJsonResult } from "@/lib/ai/ai-client";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import type { DecisionContextV6 } from "@/lib/competitions/v6/engine";
import { isDecisionEvidenceFact } from "@/lib/competitions/v6/evidence";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import {
  buildDecisionContextV7, DECISION_RANK_PROMPT_VERSION_V7, DECISION_RANK_SYSTEM_PROMPT_V7,
  explainDecisionV7, rankDecisionV7,
} from "@/lib/competitions/v7/model";
import { readableRankInputV7 } from "@/lib/competitions/v7/rank-packet";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";

const context = (count = 10) => buildDecisionContextV7(student({
  skills: ["data-analysis"], confirmedFields: ["stage", "skills"],
}), { records: Array.from({ length: count }, (_, index) => syntheticRecord(index + 1)) });
const success = (data: unknown): AiJsonResult<unknown> => ({
  ok: true, data, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200,
  attempts: 1, durationMs: 1, finishReason: "stop",
});
const rankOutput = (ctx: DecisionContextV6, rationale = "自报数据能力可用于分析任务") => ({
  profileRevision: ctx.profile.revision, catalogVersion: ctx.catalogVersion,
  recommendations: ctx.candidates.slice(0, 5).reverse().map(({ record }) => ({ itemId: record.recordId, roleIndex: 0, rationale, ...rankFixtureEvidence(ctx, record.recordId) })),
  shortfallReason: ctx.candidates.length < 5 ? "当前合成池没有更多不同系列的任务。" : null,
});

function unpack<T = ReturnType<typeof readableRankInputV7> & {
  assertions: { key: string; reason: { text: string } }[];
}>(prompt: string, ctx: DecisionContextV6): T {
  const codec = createModelIdentifierCodec({ candidates: ctx.candidates.map(({ record }) => record.recordId),
    series: ctx.candidates.map(({ record }) => record.seriesId),
    facts: ctx.candidates.flatMap(({ record }) => record.facts.map(fact => fact.id)),
    students: ctx.profile.facts.map(fact => fact.id) });
  const wire = JSON.parse(prompt) as Record<string, unknown>;
  if (Array.isArray(wire.assertions) && !wire.evidenceBundle) return codec.decode(wire) as T;
  const review = Array.isArray(wire.evidenceBundle);
  const { evidenceBundle, ...rest } = wire;
  const expanded = expandCandidateEvidence(expandMatchingTables(review ? { ...rest, candidates: evidenceBundle } : wire)) as Record<string, unknown>;
  if (!review) return codec.decode(expanded) as T;
  const { candidates, ...metadata } = expanded;
  expect(candidates).toHaveLength(1);
  return codec.decode({ ...metadata, ...(candidates as Record<string, unknown>[])[0] }) as T;
}

function officialPlan(ctx: DecisionContextV6, plan: MatchPlanV6): MatchPlanV6 {
  return { ...plan, recommendations: plan.recommendations.map(item => {
    const fact = ctx.candidates.find(({ record }) => record.recordId === item.itemId)!.record.facts[0];
    if (item.rankRoleIndex === undefined) throw new Error("fresh_rank_fixture_requires_explicit_role_binding");
    const reason = { text: fact.text, basis: "official" as const, studentFactIds: [], competitionFactIds: [fact.id], conditions: [] };
    return { itemId: item.itemId, reasons: [reason], roleIndex: item.rankRoleIndex, roleReason: structuredClone(reason) };
  }) };
}

describe("v7 direct comparison latency candidate", () => {
  it("keeps a 40-character rationale and stable accepted order without reducing generation or deadline budgets", async () => {
    const ctx = context(), deadlineEpochMs = Date.now() + 30_000;
    ctx.candidates.forEach((candidate, index) => {
      candidate.nativeScore = { lower: index * 1000, upper: index * 1000 + 1, dimensions: [] };
    });
    let calls = 0;
    const plan = await rankDecisionV7(ctx, { deadlineEpochMs, modelCall: async (prompt, options) => {
      calls++;
      expect(options).toMatchObject({ model: "deepseek-flash", thinking: "enabled", reasoningEffort: "low",
        maxAttempts: 1, maxTokens: 8192, deadlineEpochMs, promptVersion: `${DECISION_RANK_PROMPT_VERSION_V7}.rank` });
      expect(options.timeoutMs).toBeGreaterThan(0);
      expect(options.timeoutMs).toBeLessThanOrEqual(30_000);
      const { candidates, candidateBoundaries } = unpack(prompt, ctx);
      expect({ candidates, candidateBoundaries }).toEqual(readableRankInputV7(ctx));
      expect(candidates).toHaveLength(10);
      expect(prompt).not.toContain("nativeScore");
      // Concise internal writing does not reduce the full output or deadline budgets.
      return success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, rankOutput(ctx, "依".repeat(40)))));
    } });
    expect(calls).toBe(1);
    expect(plan.recommendations.map(item => item.itemId)).toEqual(rankOutput(ctx).recommendations.map(item => item.itemId).sort());
    expect(plan.recommendations.every(item => item.reasons[0].text.length === 40)).toBe(true);
    expect(plan.recommendations.every(item => item.reasons[0].basis === "inference" && item.reasons[0].competitionFactIds.length === 1)).toBe(true);
  });

  it("keeps historical foreign fees, unknown total cost and every resource condition in the ranking input", async () => {
    const ctx = context(1), record = ctx.candidates[0].record;
    const fee = { ...record.facts[0], id: "historical-fee", field: "fee", text: "历史届次报名费为15英镑。",
      scope: "合成2025届报名费范围", sourceIds: ["historical-fee-source"] };
    record.sources.push({ ...record.sources[0], id: "historical-fee-source", scope: fee.scope });
    record.facts.push(fee);
    record.cost = { scope: fee.scope, factIds: [fee.id], minimumPersonalCny: null,
      maximumPersonalCny: null, note: "历史报名费，不含个人其他支出。" };
    const uncertainty = "日期另核；个人总支出、汇率与设备费用未知。";
    ctx.candidates[0].conditions.push(uncertainty);
    record.sections.investment = [{ kind: "unknown", text: "个人总投入尚未核实。", factIds: [],
      conditions: ["不得由报名费推定个人总支出"], unknownReason: "其他支出与汇率没有适用来源。" }];
    await rankDecisionV7(ctx, { modelCall: async prompt => {
      const { candidates, candidateBoundaries } = unpack(prompt, ctx);
      const [row] = candidateBoundaries.items;
      expect({ candidates, candidateBoundaries }).toEqual(readableRankInputV7(ctx));
      const { factIds: _factIds, ...cost } = record.cost!;
      expect(row.personalCost).toEqual({ ...cost, verifiedCurrent: false });
      expect(row.resources).toContainEqual(expect.objectContaining({ kind: fee.kind, status: fee.status, usable: true, text: fee.text }));
      expect(candidateBoundaries.candidateDefaults?.unknowns).toContainEqual({ modules: ["investment"], text: "个人总投入尚未核实。",
        conditions: ["不得由报名费推定个人总支出"], reason: "其他支出与汇率没有适用来源。" });
      expect(candidateBoundaries.candidateConditions).toContainEqual({ text: uncertainty, itemIds: [record.recordId] });
      return success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, rankOutput(ctx))));
    } });
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("按candidateIds原顺序独立判断完整候选池");
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("费用保留原届次与范围");
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("历史价格不是当前保证，报名费不等于个人总支出");
    expect(DECISION_RANK_SYSTEM_PROMPT_V7).toContain("缺金额或资源不能推成免费、预算内或可获得");
  });

  it.each(["long-basis", "missing-basis", "truncated"])("keeps %s failures visible instead of returning a shortened success", async defect => {
    const ctx = context(); let calls = 0;
    await expect(rankDecisionV7(ctx, { modelCall: async (prompt, options) => {
      calls++;
      expect(options.maxTokens).toBe(8192);
      if (defect === "truncated") return { ok: false, reason: "truncated", model: "deepseek-flash", upstreamAttempted: true };
      const output = echoRankWireHeaders(prompt, rankOutput(ctx));
      if (defect === "long-basis") output.recommendations[0].rationale = "依".repeat(161);
      else Reflect.deleteProperty(output.recommendations[0], "rationale");
      return success(rankFixtureAssessmentReply(ctx, output));
    } })).rejects.toThrow("invalid_output");
    expect(calls).toBe(2);
  });

  it("keeps a meaningful shortfall below five rather than filling it with program-selected candidates", async () => {
    const ctx = context(), output = rankOutput(ctx);
    output.recommendations = output.recommendations.slice(0, 3);
    output.shortfallReason = "其余任务与学生明确方向没有足够有意义的关联。";
    const plan = await rankDecisionV7(ctx, { modelCall: async prompt => success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, output))) });
    expect(plan.recommendations.map(item => item.itemId)).toEqual(output.recommendations.map(item => item.itemId).sort());
    expect(plan.shortfallReason).toBe("本次初选有3项进入详情审核。");
  });
});

describe("v7 short internal basis preserves final support checks", () => {
  it.each(["该赛事免费且个人全部支出为零。", "15英镑折合人民币后已满足预算。", "题目不要求购买打印机或墨盒，因此个人总支出已在300元预算内。"])("still reviews and rejects an unsupported resource assertion: %s", async text => {
    const ctx = context(2);
    ctx.candidates[0].conditions.push("历史费用与个人总支出仍需核实。");
    const plan = await rankDecisionV7(ctx, { modelCall: async prompt => success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, rankOutput(ctx)))) });
    const stages: string[] = [];
    await expect(explainDecisionV7(ctx, plan, { modelCall: async (prompt, options) => {
      stages.push(options.operation!);
      if (options.operation === "competition_v7_review") {
        const { assertions } = unpack(prompt, ctx);
        expect(assertions).toHaveLength(1);
        expect(assertions[0].reason.text).toBe(text);
        return success({ checks: [{ key: assertions[0].key, supported: false, reason: "原文没有当前总支出或适用汇率。" }] });
      }
      expect(options.systemPrompt).toContain("均不能推出个人总成本在用户预算内");
      const decoded = unpack<{ candidates: { itemId: string; internalRationale: unknown;
        facts: unknown; sources: unknown; conditions: unknown }[] }>(prompt, ctx);
      for (const row of decoded.candidates) {
        const candidate = ctx.candidates.find(({ record }) => record.recordId === row.itemId)!;
        expect(row.internalRationale).toEqual(plan.recommendations.find(item => item.itemId === row.itemId)!.reasons);
        expect(row.facts).toEqual(candidate.record.facts.filter(fact => isDecisionEvidenceFact(candidate.record, fact)));
        expect(row.sources).toEqual(candidate.record.sources.map(({ evidenceArtifact: _artifact, verificationMethod: _method, retrievedAt: _retrieved, ...source }) => source));
        expect(row.conditions).toEqual(candidate.conditions);
      }
      const output = officialPlan(ctx, plan);
      output.recommendations[0].reasons = [{ text, basis: "suggestion", studentFactIds: [], competitionFactIds: [], conditions: [] }];
      return success(output);
    } })).rejects.toThrow("unsupported_reason");
    expect(stages).toEqual(["competition_v7_explain", "competition_v7_review"]);
  });
});
