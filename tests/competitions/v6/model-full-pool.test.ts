import "./mock-publication-boundary";
import { describe, expect, it } from "vitest";
import { buildDecisionContext, buildRuleMatchPlan } from "@/lib/competitions/v6/engine";
import { runDecisionRecommendation, supportEvidencePack, modelEvidenceRegistry } from "@/lib/competitions/v6/model";
import { syntheticRecord, student } from "./decision-fixtures";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";

const profile = student({ confirmedFields: ["stage", "interests"], interests: ["data"] });
const success = (data: unknown) => ({ ok: true as const, data, model: "contract-test", upstreamAttempted: true as const,
  httpStatus: 200, attempts: 1, durationMs: 1, finishReason: "stop", usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0 } });

describe("full-pool C production path", () => {
  it("sends every candidate and fact above twenty without a discovery cutoff", async () => {
    const context = buildDecisionContext(profile, { records: Array.from({ length: 27 }, (_, index) => syntheticRecord(index + 100)), now: new Date("2026-11-05T08:00:00Z") });
    expect(context.candidates).toHaveLength(27);
    const plan = buildRuleMatchPlan(context), stages: string[] = [];
    const report = await runDecisionRecommendation(profile, { context, method: "llm", modelCall: async (prompt, options) => {
      const input = expandMatchingTables(JSON.parse(prompt)), stage = options.promptVersion!.split(".").at(-1)!;
      stages.push(stage);
      if (stage === "match") {
        expect(input.candidates).toHaveLength(27);
        expect(new Set(input.candidates.map((row: { itemId: string }) => row.itemId)).size).toBe(27);
        expect(input.candidates.every((row: { taskFamily: string; outcomes:{forms:string[]} }) => row.taskFamily === "data-modeling" && row.outcomes.forms.length > 0)).toBe(true);
        expect(modelEvidenceRegistry(context).factCount).toBe(27);
        return success({itemIds:plan.recommendations.map(item=>item.itemId),shortfallReason:null});
      }
      return success({ checks: input.assertions.map((row: { key: string }) => ({ key: row.key, supported: true, reason: "合成支持检查" })) });
    } });
    expect(stages).toEqual(["match", ...Array(27).fill("verify")]);
    expect(report.trace.candidateCount).toBe(27);
    expect(report.fallback.used).toBe(false);
  });

  it("explicitly falls back on an oversized complete pack before any paid transport", async () => {
    const records = Array.from({ length: 150 }, (_, index) => {
      const record = syntheticRecord(index + 999);
      record.facts[0].text = `候选${index}的不同原文：${"完整事实".repeat(350)}`;
      record.sections.task[0].text = record.facts[0].text;
      return record;
    });
    const context = buildDecisionContext(profile, { records, now: new Date("2026-11-05T08:00:00Z") });
    let invoked = false;
    const report = await runDecisionRecommendation(profile, { context, method: "llm", modelCall: async () => { invoked = true; return success({}); } });
    expect(invoked).toBe(false);
    expect(report.fallback).toEqual({ used: true, reason: "context_budget_exceeded" });
    expect(report.trace.callCount).toBe(0);
    expect(report.trace.candidateCount).toBe(150);
  });

  it("retains cited task and role facts, full scopes and every unresolved condition for support review", () => {
    const context = buildDecisionContext(profile, { records: [syntheticRecord(777)], now: new Date("2026-11-05T08:00:00Z") });
    const candidate = context.candidates[0];
    candidate.record.facts.push({ ...candidate.record.facts[0], id: "unrelated-uncited-fact", text: "另一未引用事项" });
    const plan = buildRuleMatchPlan(context);
    plan.recommendations[0].roleIndex = 0;
    const packed = supportEvidencePack(context, plan)[0];
    expect(packed.facts.map(fact => fact.id)).toContain(candidate.record.facts[0].id);
    expect(packed.facts.map(fact => fact.id)).not.toContain("unrelated-uncited-fact");
    expect(packed.facts[0].scope).toEqual(candidate.record.facts[0].scope);
    expect(packed.conditions).toEqual(candidate.conditions);
    expect(packed.roles.map(role => role.roleIndex)).toEqual([0]);
  });
});
