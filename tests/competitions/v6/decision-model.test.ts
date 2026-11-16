import "./mock-publication-boundary";
import { describe, expect, it } from "vitest";
import {
  buildDecisionContext,
  buildRuleMatchPlan,
} from "@/lib/competitions/v6/engine";
import {
  runDecisionRecommendation,
  type DecisionModelCall,
} from "@/lib/competitions/v6/model";
import { student, syntheticCatalog } from "./decision-fixtures";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";

const options = {
  records: syntheticCatalog,
  now: new Date("2026-11-05T08:00:00Z"),
};
const baseProfile = student({
  confirmedFields: ["stage", "interests"],
  interests: ["data"],
});
function success(data: unknown) {
  return {
    ok: true as const,
    data,
    model: "contract-test-model",
    finishReason: "stop",
    attempts: 1,
    httpStatus: 200,
    upstreamAttempted: true as const,
    durationMs: 1,
    usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 },
  };
}
describe("v6 model orchestration with explicit contract doubles", () => {
  it("keeps confirmed negative and conditional context while excluding withdrawn or unconfirmed text", async () => {
    const context = buildDecisionContext(baseProfile, options);
    const fact = (id: string, state: "affirmed" | "negated" | "conditional", confirmed = true) => ({
      id, field: "noviceTask", value: "build-tool", label: id, state, confirmed, evidenceLevel: "self_report" as const,
    });
    context.profile.facts.push(fact("明确不愿编程", "negated"), fact("获准以后才能用实验室", "conditional"),
      fact("撤销文字不可发送", "affirmed"), fact("未确认文字不可发送", "affirmed", false));
    context.profile.retractedFactIds.push("撤销文字不可发送");
    const plan = buildRuleMatchPlan(context);
    const seen: string[] = [];
    const modelCall: DecisionModelCall = async (prompt, config) => {
      const input = expandMatchingTables(JSON.parse(prompt));
      seen.push(config.promptVersion!.split(".").at(-1)!);
      expect(input.profile.facts.find((row: { label: string }) => row.label === "明确不愿编程").state).toBe("negated");
      expect(input.profile.facts.find((row: { label: string }) => row.label === "获准以后才能用实验室").state).toBe("conditional");
      expect(input.profile.facts.some((row: { label: string }) => row.label === "撤销文字不可发送" || row.label === "未确认文字不可发送")).toBe(false);
      if (config.promptVersion!.endsWith("match")) return success(plan);
      return success({ checks: input.assertions.map((assertion: { key: string }) => ({ key: assertion.key, supported: true, reason: "合成合同检查" })) });
    };
    const report = await runDecisionRecommendation(baseProfile, { ...options, context, method: "llm", legacyPlanTransport: true, modelCall });
    expect(seen).toEqual(["match", "verify"]);
    expect(report.fallback.used).toBe(false);
  });
  it("passes the entire small eligible pool without a redundant discovery call and freezes the decision", async () => {
    const context = buildDecisionContext(baseProfile, options);
    const plan = buildRuleMatchPlan(context);
    plan.recommendations.reverse();
    const stages: string[] = [];
    const modelCall: DecisionModelCall = async (prompt, config) => {
      const stage = config.promptVersion!.split(".").at(-1)!;
      stages.push(stage);
      const input = expandMatchingTables(JSON.parse(prompt));
      if (stage === "discover") {
        expect(input.candidates).toHaveLength(6);
        return success({
          itemIds: context.candidates.map((c) => c.record.recordId),
        });
      }
      if (stage === "match") { expect(input.candidates).toHaveLength(6); expect(config.reasoningEffort).toBe("max"); return success(plan); }
      return success({
        checks: input.assertions.map((a: { key: string }) => ({
          key: a.key,
          supported: true,
          reason: "合成任务事实支持合成断言",
        })),
      });
    };
    const report = await runDecisionRecommendation(baseProfile, {
      ...options,
      method: "llm", legacyPlanTransport: true,
      modelCall,
    });
    expect(stages).toEqual(["match", "verify"]);
    expect(report.trace.method).toBe("llm");
    expect(report.trace.inputTokens).toBe(200);
    expect(report.recommendations.map((r) => r.itemId)).toEqual(
      plan.recommendations.map((r) => r.itemId),
    );
    expect(report.fallback.used).toBe(false);
  });
  it("repairs a malformed evidence plan only once", async () => {
    const context = buildDecisionContext(baseProfile, options);
    const valid = buildRuleMatchPlan(context);
    const stages: string[] = [];
    const modelCall: DecisionModelCall = async (prompt, config) => {
      const stage = config.promptVersion!.split(".").at(-1)!;
      stages.push(stage);
      if (stage === "discover")
        return success({
          itemIds: context.candidates.map((c) => c.record.recordId),
        });
      if (stage === "match") {
        const bad = structuredClone(valid);
        bad.recommendations[0].reasons[0].studentFactIds = ["fake"];
        return success(bad);
      }
      if (stage === "repair") return success(valid);
      return success({
        checks: expandMatchingTables(JSON.parse(prompt)).assertions.map((a: { key: string }) => ({
          key: a.key,
          supported: true,
          reason: "支持",
        })),
      });
    };
    const report = await runDecisionRecommendation(baseProfile, {
      ...options,
      method: "llm", legacyPlanTransport: true,
      modelCall,
    });
    expect(stages.filter((s) => s === "repair")).toHaveLength(1);
    expect(report.trace.method).toBe("llm");
  });
  it("falls back when citations exist but the semantic reviewer finds no support", async () => {
    const context = buildDecisionContext(baseProfile, options);
    const plan = buildRuleMatchPlan(context);
    const stages: string[] = [];
    const modelCall: DecisionModelCall = async (prompt, config) => {
      const stage = config.promptVersion!.split(".").at(-1)!;
      stages.push(stage);
      if (stage === "discover")
        return success({
          itemIds: context.candidates.map((c) => c.record.recordId),
        });
      if (stage === "match" || stage === "repair") return success(plan);
      return success({
        checks: expandMatchingTables(JSON.parse(prompt)).assertions.map((a: { key: string }) => ({
          key: a.key,
          supported: false,
          reason: "引用不支持该推断",
        })),
      });
    };
    const report = await runDecisionRecommendation(baseProfile, {
      ...options,
      method: "llm", legacyPlanTransport: true,
      modelCall,
    });
    expect(stages.filter((s) => s === "repair")).toHaveLength(1);
    expect(report.trace.method).toBe("rules");
    expect(report.fallback).toEqual({
      used: true,
      reason: "unsupported_reason",
    });
  });
  it("rejects missing support-review checks and unknown decision IDs", async () => {
    for (const invalidDiscovery of [true, false]) {
      const context = buildDecisionContext(baseProfile, options);
      const modelCall: DecisionModelCall = async (_prompt, config) =>
        config.promptVersion!.endsWith("discover")
          ? success({
              itemIds: invalidDiscovery
                ? ["fake"]
                : context.candidates.map((c) => c.record.recordId),
            })
          : config.promptVersion!.endsWith("match")
            ? success(invalidDiscovery ? { ...buildRuleMatchPlan(context), recommendations: [{ itemId: "fake", reasons: [] }]} : buildRuleMatchPlan(context))
            : success({ checks: [] });
      const report = await runDecisionRecommendation(baseProfile, {
        ...options,
        method: "llm", legacyPlanTransport: true,
        modelCall,
      });
      expect(report.fallback.used).toBe(true);
      expect(report.trace.method).toBe("rules");
    }
  });
  it("handles blank, truncated and timed-out outputs with an honest usable fallback", async () => {
    for (const reason of ["empty_content", "truncated", "timeout"] as const) {
      const modelCall: DecisionModelCall = async () => ({
        ok: false,
        reason,
        model: "contract-test-model",
        upstreamAttempted: true,
      });
      const report = await runDecisionRecommendation(baseProfile, {
        ...options,
        method: "llm", legacyPlanTransport: true,
        modelCall,
      });
      expect(report.fallback.reason).toBe(reason);
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.trace.inputTokens).toBeNull();
    }
  });
  it("evaluates the legacy semantic scorer against the same entire pool and rejects a silently truncated pool", async () => {
    for (const complete of [true, false]) {
      const modelCall: DecisionModelCall = async (prompt) => {
        const input = expandMatchingTables(JSON.parse(prompt));
        expect(input.candidates).toHaveLength(6);
        return success({
          scores: input.candidates
            .slice(0, complete ? 6 : 3)
            .map((c: { itemId: string }, i: number) => ({
              itemId: c.itemId,
              goal: null,
              task: 4 - i / 10,
              experience: null,
              readiness: null,
              growth: 3,
            })),
        });
      };
      const report = await runDecisionRecommendation(baseProfile, {
        ...options,
        method: "semantic",
        modelCall,
      });
      expect(report.trace.method).toBe(complete ? "semantic" : "rules");
      expect(report.fallback.used).toBe(!complete);
    }
  });
});
