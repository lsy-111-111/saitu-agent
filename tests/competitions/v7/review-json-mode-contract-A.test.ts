import { afterEach, describe, expect, it, vi } from "vitest";
import { claim } from "@/lib/competitions/v6/engine";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { buildAssertionReviewPacketV7 } from "@/lib/competitions/v7/evidence-packet";
import { buildDecisionContextV7, createDecisionInvocationV7, reviewSchema } from "@/lib/competitions/v7/model";
import { student, syntheticRecord } from "../v6/decision-fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("review JSON-mode provider contract", () => {
  it("works after tooling paths are removed and preserves a false verdict without retrying", async () => {
    const fetch = vi.fn(() => { throw new Error("offline_json_mode_contract_forbids_http"); });
    vi.stubGlobal("fetch", fetch);
    const record = syntheticRecord(1), context = buildDecisionContextV7(student(), { records: [record] });
    const reason = claim("个人总支出已经在预算内。", "suggestion", [], [record.facts[0].id]);
    const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, recommendations: [{ itemId: record.recordId, reasons: [reason] }], shortfallReason: "合成池一项。" };
    const key = `${record.recordId}.reason.0`, packet = buildAssertionReviewPacketV7(context, plan, [{ key, itemId: record.recordId, reason }]);
    let calls = 0;
    const invocation = createDecisionInvocationV7(context, { modelCall: async (prompt, options) => {
      calls++;
      // A legal projected packet need not contain any JSON filename. Enforce
      // the provider's documented JSON-mode precondition at this fake boundary.
      expect(prompt).not.toMatch(/json/i);
      expect(options.systemPrompt).toContain("“设计/计划”不等于已执行");
      expect(options.systemPrompt).toContain("准确的普通未来学习建议仍允许");
      expect(options.systemPrompt).toContain("未来由本人自拟阅读维度或记录表");
      expect(options.systemPrompt).toContain("该存在前提仍须由本条原文支持");
      expect(options.systemPrompt).toContain("不把待查维度、尚待选择的阅读对象或明确未来拟开展的活动，当作已指定作品已有栏目、内容或本人既往经历");
      expect(options.systemPrompt).toContain("不能自动推出其中已有目标、方法、分析、结论或任何未述内部组成");
      expect(options.systemPrompt).toContain("boundaryId相同且itemId与该候选相同");
      if (!/json/i.test(options.systemPrompt ?? "")) return { ok: false, reason: "invalid_request", model: "deepseek-flash", upstreamAttempted: true, httpStatus: 400 };
      return { ok: true, data: { checks: [{ key: "R01", supported: false, reason: "任务原文不证明个人总支出。" }] }, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 };
    } });
    const result = await invocation.call("review", packet, reviewSchema, false);
    expect(result.checks).toEqual([{ key, supported: false, reason: "任务原文不证明个人总支出。" }]);
    expect(calls).toBe(1); expect(fetch).not.toHaveBeenCalled();
  });
});
