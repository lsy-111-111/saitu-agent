import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDecisionContextV7, rankDecisionV7, type DecisionModelCallV7 } from "@/lib/competitions/v7/model";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_rationale_tolerance_forbids_http"); })));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

function fixture() {
  const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records: Array.from({ length: 45 }, (_, index) => syntheticRecord(index + 1)) });
  const output = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
    recommendations: context.candidates.slice(0, 5).reverse().map(({ record }) => ({ itemId: record.recordId, roleIndex: 0, rationale: "用自报的数据分析能力检查每项清理决策。", ...rankFixtureEvidence(context, record.recordId) })), shortfallReason: null };
  return { context, output };
}

describe("rank rationale writing target and validation tolerance", () => {
  it.each([41, 42, 82, 160])("retains a %i-character rationale and stable item order without a second call", async length => {
    const { context, output } = fixture(), rationale = "学".repeat(length); output.recommendations[1].rationale = rationale;
    let calls = 0;
    const modelCall: DecisionModelCallV7 = async (prompt, options) => {
      calls++;
      expect(options).toMatchObject({ operation: "competition_v7_rank", thinking: "enabled", reasoningEffort: "low", maxTokens: 8192, maxAttempts: 1 });
      expect(options.systemPrompt).toContain("以30–50字为宜，上限160字");
      const wire = rankFixtureAssessmentReply(context, echoRankWireHeaders(prompt, output));
      const parsed = options.schema!.safeParse(wire); expect(parsed.success).toBe(true);
      return { ok: true, upstreamAttempted: true, data: wire, model: "deepseek-flash", attempts: 1, httpStatus: 200, finishReason: "stop", durationMs: 0 };
    };
    const plan = await rankDecisionV7(context, { modelCall });
    expect(calls).toBe(1); expect(plan.recommendations.map(row => row.itemId)).toEqual(output.recommendations.map(row => row.itemId).sort());
    expect(plan.recommendations.find(row => row.itemId === output.recommendations[1].itemId)!.reasons[0].text).toBe(rationale);
  });

  it("keeps over-160 and extra-field validation strict without truncating the input", async () => {
    const { context, output } = fixture(); output.recommendations[0].rationale = "学".repeat(161);
    let calls = 0;
    const modelCall: DecisionModelCallV7 = async (prompt, options) => {
      const wire = rankFixtureAssessmentReply(context, echoRankWireHeaders(prompt, output));
      calls++; expect(options.schema!.safeParse(wire).success).toBe(false);
      expect(options.schema!.safeParse({ ...wire, assessments: [], shortfallReason: "合成空名单", extra: true }).success).toBe(false);
      return { ok: false, upstreamAttempted: true, reason: "invalid_output", model: "deepseek-flash", attempts: 1 };
    };
    await expect(rankDecisionV7(context, { modelCall })).rejects.toThrow("invalid_output");
    expect(calls).toBe(2); expect(output.recommendations[0].rationale).toHaveLength(161);
  });

  it.each(["unknown-candidate", "duplicate-series", "stale-version"])("rejects %s without repairing the selected identities", async defect => {
    const { context, output } = fixture();
    if (defect === "unknown-candidate") output.recommendations[0].itemId = "outside-the-frozen-pool";
    if (defect === "duplicate-series") output.recommendations[1].itemId = output.recommendations[0].itemId;
    if (defect === "stale-version") output.profileRevision = "stale-profile";
    let calls = 0;
    const modelCall: DecisionModelCallV7 = async (prompt, options) => {
      calls++;
      const wire = rankFixtureAssessmentReply(context, echoRankWireHeaders(prompt, output));
      if (defect === "stale-version") wire.profileRevision = output.profileRevision;
      expect(options.schema!.safeParse(wire).success).toBe(defect !== "stale-version");
      return { ok: true, upstreamAttempted: true, data: wire, model: "deepseek-flash", attempts: 1, httpStatus: 200, finishReason: "stop", durationMs: 0 };
    };
    await expect(rankDecisionV7(context, { modelCall })).rejects.toThrow("invalid_output");
    expect(calls).toBe(1);
  });
});
