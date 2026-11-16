import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDecisionContextV7, explainDecisionV7, type DecisionModelCallV7 } from "@/lib/competitions/v7/model";
import { draftDecisionChatV7, extractSelfReportedFactsV7 } from "@/lib/competitions/v7/chat";
import { student, syntheticRecord } from "../v6/decision-fixtures";

const success = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });
afterEach(() => vi.unstubAllGlobals());

async function state() {
  const legacy = student(), context = buildDecisionContextV7(legacy, { records: [syntheticRecord(1), syntheticRecord(2)] });
  const plan = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, recommendations: context.candidates.map(({ record }) => ({ itemId: record.recordId,
    reasons: [{ text: record.facts[0].text, basis: "official" as const, studentFactIds: [], competitionFactIds: [record.facts[0].id], conditions: [] }] })), shortfallReason: "合成池仅两项。" };
  const report = await explainDecisionV7(context, plan, { modelCall: async () => success(plan) });
  return { legacy, context, profile: context.profile, report };
}

describe("profile and follow-up JSON-mode provider contract", () => {
  it.each(["competition_v7_extract", "competition_v7_chat", "competition_v7_chat_review"])("does not rely on a JSON filename for %s", async target => {
    const fetch = vi.fn(() => { throw new Error("offline_chat_json_contract_forbids_http"); });
    vi.stubGlobal("fetch", fetch);
    const current = await state(), calls: string[] = [];
    const paraphrase = { ...current.report.recommendations[0].coreTask, text: "该任务让你制作可复现的数据分析报告。" };
    const modelCall: DecisionModelCallV7 = async (prompt, options) => {
      const operation = options.operation!; calls.push(operation);
      expect(options).toMatchObject({ thinking: "enabled", reasoningEffort: "high", maxAttempts: 1 });
      if (operation === target) {
        expect(prompt).not.toMatch(/json/i);
        if (!/json/i.test(options.systemPrompt ?? "")) return { ok: false, reason: "invalid_request", model: "deepseek-flash", upstreamAttempted: true, httpStatus: 400 };
      }
      if (operation === "competition_v7_extract") return success({ facts: [{ field: "skills", value: "programming", state: "affirmed", evidenceLevel: "self_report", confirmed: true, sourceText: "我会Python" }], unknownFields: [], unresolvedAssertions: [] });
      if (operation === "competition_v7_chat") return success({ message: "关于任务可参考：", claims: [target === "competition_v7_chat_review" ? paraphrase : current.report.recommendations[0].coreTask] });
      return success({ checks: [{ key: "chat.0", supported: true, reason: "同条任务原文支持这句转述。" }] });
    };
    if (target === "competition_v7_extract") {
      const extracted = await extractSelfReportedFactsV7({ utterance: "我会Python。", requestedFields: ["skills"] }, { modelCall });
      expect(extracted.fallback).toBe(false); expect(extracted.facts[0]).toMatchObject({ field: "skills", value: "programming", sourceText: "我会Python" });
      expect(calls).toEqual([target]);
    } else {
      const reply = await draftDecisionChatV7(current, "这种做法有什么限制？", [], { modelCall });
      expect(reply.claims).toEqual([target === "competition_v7_chat_review" ? paraphrase : current.report.recommendations[0].coreTask]);
      expect(calls).toEqual(target === "competition_v7_chat_review" ? ["competition_v7_chat", target] : [target]);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
