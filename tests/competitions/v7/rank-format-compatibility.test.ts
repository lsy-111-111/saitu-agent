import { describe, expect, it } from "vitest";
import { buildDecisionContextV7, rankDecisionV7 } from "@/lib/competitions/v7/model";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";

describe("v7 observed JSON response marker compatibility", () => {
  const context = () => buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records: [syntheticRecord(1), syntheticRecord(2)] });
  function output(ctx: ReturnType<typeof context>) {
    return { type: "json_object", profileRevision: ctx.profile.revision, catalogVersion: ctx.catalogVersion,
      recommendations: ctx.candidates.slice().reverse().map(({ record }) => ({ itemId: record.recordId, roleIndex: 0, rationale: "用自报分析能力检查清理前后的输入。", ...rankFixtureEvidence(ctx, record.recordId) })),
      shortfallReason: "合成候选仅包含两个系列。" };
  }
  it("accepts the fixed transport marker without publishing it and with stable accepted order", async () => {
    const ctx = context(); let attempts = 0;
    const plan = await rankDecisionV7(ctx, { modelCall: async (prompt, options) => {
      attempts++; const parsed = options.schema!.safeParse(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, output(ctx))));
      expect(parsed.success).toBe(true);
      return { ok: true, data: parsed.success ? parsed.data : null, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 };
    } });
    expect(attempts).toBe(1); expect(plan).not.toHaveProperty("type");
    expect(plan.recommendations.map(item => item.itemId)).toEqual(output(ctx).recommendations.map(item => item.itemId).sort());
  });
  it.each(["wrong-marker", "extra-key", "outside-candidate", "stale-profile"])("keeps the original semantic and unknown-field checks: %s", failure => {
    const ctx = context(); let attempts = 0;
    return expect(rankDecisionV7(ctx, { modelCall: async (prompt, options) => {
      attempts++; const value = echoRankWireHeaders(prompt, output(ctx));
      if (failure === "wrong-marker") value.type = "anything-else";
      if (failure === "extra-key") Reflect.set(value, "unverifiedWinner", true);
      if (failure === "outside-candidate") value.recommendations[0].itemId = "not-in-the-pool";
      if (failure === "stale-profile") value.profileRevision = "old-profile";
      const parsed = options.schema!.safeParse(rankFixtureAssessmentReply(ctx, value));
      return parsed.success ? { ok: true, data: parsed.data, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 } : { ok: false, reason: "invalid_output", model: "deepseek-flash", upstreamAttempted: true, attempts: 1 };
    } })).rejects.toThrow("invalid_output").then(() => { expect(attempts).toBe(["outside-candidate", "stale-profile"].includes(failure) ? 1 : 2); });
  });
});
