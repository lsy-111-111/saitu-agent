import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { containsCompetitionNotePersonalInfo } from "@/lib/ai/competition-note";
import { extractSelfReportedFactsV7 } from "@/lib/competitions/v7/chat";
import { isProfileControlClauseV7 } from "@/lib/competitions/v7/corrections";
import type { DecisionModelCallV7 } from "@/lib/competitions/v7/model";
import { competitionPiiRegressionTexts, competitionPiiSafeControlTexts } from "../../fixtures/competition-pii-regression";

const success = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_extraction_protocol_forbids_http"); })));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("explicit extraction protocol and ordinary resource text", () => {
  it("tells the model the accepted fact enums while retaining rejection of corrected", async () => {
    const modelCall = vi.fn<DecisionModelCallV7>(async (_prompt, options) => {
      expect(options).toMatchObject({ operation: "competition_v7_extract", reasoningEffort: "high", thinking: "enabled", maxAttempts: 1 });
      for (const token of ["affirmed", "negated", "unknown", "conditional", "retracted", "self_report", "concrete_experience", "confirmed", "布尔值"]) expect(options.systemPrompt).toContain(token);
      const facts = [{ field: "budget.maximumYuan", value: 100, state: "affirmed", evidenceLevel: "self_report", confirmed: true, sourceText: "我的个人总预算改为100元" },
        { field: "budget.maximumYuan", value: 300, state: "retracted", evidenceLevel: "self_report", confirmed: true, sourceText: "不是300元" }];
      expect(options.schema!.safeParse({ facts: [{ ...facts[0], state: "corrected" }], unknownFields: [], unresolvedAssertions: [] }).success).toBe(false);
      expect(options.schema!.safeParse({ facts: [{ ...facts[0], evidenceLevel: "user_claim" }], unknownFields: [], unresolvedAssertions: [] }).success).toBe(false);
      return success({ facts, unknownFields: [], unresolvedAssertions: [] });
    });
    const result = await extractSelfReportedFactsV7({ utterance: "更正：我的个人总预算改为100元，不是300元。请按100元重新匹配。", requestedFields: ["budget.maximumYuan"], allowNewDomainFields: true }, { modelCall });
    expect(result.fallback).toBe(false); expect(result.facts.map(fact => [fact.value, fact.state])).toEqual([[100, "affirmed"], [300, "retracted"]]);
    expect(modelCall).toHaveBeenCalledTimes(1);
  });

  it("does not require a fact for a standalone reranking control clause or lose an actual withdrawal", async () => {
    for (const text of ["重新匹配", "请重新匹配", "重新匹配！", "并保留文档名称", "最早那项文档信息和当前主要目标都保留"]) expect(isProfileControlClauseV7(text)).toBe(true);
    for (const text of ["我没有自己写过程序", "我撤回之前会编程的回答", "只能在校内重新匹配数据", "保留我的作品署名权", "文档名称改为新报告", "主要目标是完成代码"]) expect(isProfileControlClauseV7(text)).toBe(false);
    const facts = [{ field: "skills", value: "programming", state: "retracted", evidenceLevel: "self_report", confirmed: true, sourceText: "我撤回之前会编程的回答" },
      { field: "programming.selfWrittenPrograms", value: false, state: "affirmed", evidenceLevel: "self_report", confirmed: true, sourceText: "没有自己写过程序" }];
    const result = await extractSelfReportedFactsV7({ utterance: "我撤回之前会编程的回答，没有自己写过程序，并保留文档名称，重新匹配。", requestedFields: ["skills"], allowNewDomainFields: true }, { modelCall: async () => success({ facts, unknownFields: [], unresolvedAssertions: [] }) });
    expect(result.fallback).toBe(false); expect(result.facts).toHaveLength(2);
    expect(result.facts[0]).toMatchObject({ state: "retracted", confirmed: false }); expect(result.facts[1].value).toBe(false);
  });

  it("allows dormitory resource descriptions while retaining real identifiers and room locations", () => {
    for (const text of ["商业软件只能在校内机房使用，宿舍电脑没有许可。", "寝室电脑不能运行商业软件。", "宿舍网络不稳定。", ...competitionPiiSafeControlTexts]) expect(containsCompetitionNotePersonalInfo(text), text).toBe(false);
    for (const text of ["宿舍在桂园三舍201室", "宿舍：桂园三舍201", "宿舍3号楼203", "寝室A栋203", "宿舍301", "宿舍电脑没有许可，手机号13800138000", "寝室网络不稳，邮箱student@example.com", ...competitionPiiRegressionTexts]) expect(containsCompetitionNotePersonalInfo(text), text).toBe(true);
  });
});
