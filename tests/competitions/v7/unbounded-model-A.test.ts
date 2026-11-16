import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiJsonResult } from "@/lib/ai/ai-client";
import { buildDecisionContextV7, explainDecisionV7, rankDecisionV7 } from "@/lib/competitions/v7/model";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";

const context = () => buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records: Array.from({ length: 8 }, (_, index) => syntheticRecord(index + 1)) });
type Context = ReturnType<typeof context>;
const success = (data: unknown): AiJsonResult<unknown> => ({ ok: true, data, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", durationMs: 1, attempts: 1 });
const output = (ctx: Context) => ({ profileRevision: ctx.profile.revision, catalogVersion: ctx.catalogVersion,
  recommendations: ctx.candidates.slice(0, 5).reverse().map(({ record }) => ({ itemId: record.recordId, roleIndex: 0, rationale: "用自报分析能力整理清理前后的差异。", ...rankFixtureEvidence(ctx, record.recordId) })), shortfallReason: null });
beforeEach(() => {
  vi.stubEnv("SAITU_AI_EXECUTION_MODE", "user-unbounded");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_model_test_forbids_http"); }));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe("unbounded mode preserves model reliability without a local quota", () => {
  it("allows twelve independent model invocations to enter together without a local two-call gate", async () => {
    const ctx = context(), invocations = new Set<string>(), release: (() => void)[] = [];
    let active = 0;
    // Only the product wrapper is under test. C separately verifies the real
    // shared transport governor; this injected model seam never calls a provider.
    const pending = Array.from({ length: 12 }, () => rankDecisionV7(ctx, { requestId: randomUUID(), modelCall: async (prompt, options) => {
      expect(options).toMatchObject({ maxAttempts: 1, thinking: "enabled", reasoningEffort: "low", candidateCount: 8 });
      expect(options).not.toHaveProperty("callLimit"); expect(options).not.toHaveProperty("maxConcurrency");
      invocations.add(options.diagnosticContext!.invocationId); active++;
      await new Promise<void>(resolve => release.push(resolve));
      return success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, output(ctx))));
    } }));
    try {
      await vi.waitFor(() => expect(active).toBe(12));
      expect(invocations.size).toBe(12); expect(release).toHaveLength(12);
    } finally { for (const resolve of release) resolve(); }
    const plans = await Promise.all(pending);
    expect(plans.every(plan => plan.recommendations.length === 5)).toBe(true);
  });

  it.each(["timeout", "network_error", "durable_outcome_unknown"] as const)("never repeats an initial %s outcome", async reason => {
    let calls = 0;
    await expect(rankDecisionV7(context(), { modelCall: async () => {
      calls++; return { ok: false, reason, model: "deepseek-flash", upstreamAttempted: true };
    } })).rejects.toThrow(reason);
    expect(calls).toBe(1);
  });

  it("allows one definite format repair with the original remaining deadline, then stops", async () => {
    const ctx = context(), startedAt = 1_799_999_000_000, deadline = startedAt + 60_000;
    let now = startedAt, calls = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await expect(rankDecisionV7(ctx, { deadlineEpochMs: deadline, modelCall: async (prompt, options) => {
      calls++;
      expect(options.maxAttempts).toBe(1); expect(options.deadlineEpochMs).toBe(deadline);
      expect(options.timeoutMs).toBe(calls === 1 ? 60_000 : 36_997);
      expect(options.requestDeadlineMs).toBe(calls === 1 ? 60_000 : 36_997);
      now += 23_003;
      return success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, { ...output(ctx), unrecognizedRoot: true })));
    } })).rejects.toThrow("invalid_output");
    expect(calls).toBe(2);
  });

  it("does not repair an illegal candidate even though the financial mode is unbounded", async () => {
    const ctx = context(); let calls = 0;
    await expect(rankDecisionV7(ctx, { modelCall: async prompt => {
      calls++; const value = echoRankWireHeaders(prompt, output(ctx)); value.recommendations[0].itemId = "outside-the-pool"; return success(rankFixtureAssessmentReply(ctx, value));
    } })).rejects.toThrow("invalid_output");
    expect(calls).toBe(1);
  });

  it("keeps the sixty/one-hundred-fifty second default hard cutoffs", async () => {
    const ctx = context(), now = 1_799_999_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const plan = await rankDecisionV7(ctx, { modelCall: async (prompt, options) => {
      expect(options.deadlineEpochMs).toBe(now + 60_000); return success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, output(ctx))));
    } });
    await explainDecisionV7(ctx, plan, { modelCall: async (_prompt, options) => {
      expect(options.deadlineEpochMs).toBe(now + 150_000);
      return success({ ...plan, recommendations: plan.recommendations.map(item => {
        const fact = ctx.candidates.find(({ record }) => record.recordId === item.itemId)!.record.facts[0];
        const reason = { text: fact.text, basis: "official", studentFactIds: [], competitionFactIds: [fact.id], conditions: [] };
        return { itemId: item.itemId, reasons: [reason], roleIndex: item.rankRoleIndex, roleReason: structuredClone(reason) };
      }) });
    } });
  });

  it("does not dispatch after an original deadline has elapsed", async () => {
    const ctx = context(), call = vi.fn();
    await expect(rankDecisionV7(ctx, { deadlineEpochMs: Date.now() - 1, modelCall: call })).rejects.toThrow("timeout");
    expect(call).not.toHaveBeenCalled();
  });
});

