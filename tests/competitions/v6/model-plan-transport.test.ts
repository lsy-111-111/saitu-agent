import "./mock-publication-boundary";
import { describe, expect, it } from "vitest";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { expandModelPlanTransport, modelPlanTransportSchema } from "@/lib/competitions/v6/model-plan-transport";
import { buildDecisionContext, buildRuleMatchPlan } from "@/lib/competitions/v6/engine";
import { validateMatchPlan } from "@/lib/competitions/v6/validation";
import { runDecisionRecommendation, DECISION_VERIFICATION_SYSTEM_PROMPT, decisionVerificationSchema } from "@/lib/competitions/v6/model";
import { student, syntheticCatalog } from "./decision-fixtures";

describe("compact model plan transport", () => {
  const context = buildDecisionContext(student({ confirmedFields: ["stage", "interests"], interests: ["data"] }), {
    records: syntheticCatalog, now: new Date("2026-11-05T08:00:00Z"),
  });
  const candidate = context.candidates[0];
  const factId = candidate.record.facts[0].id;
  const studentId = context.profile.facts[0].id;
  const codec = createModelIdentifierCodec({ candidates: [candidate.record.recordId], series: [], facts: [factId], students: [studentId] });
  const binding = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion };

  it("expands tuple aliases into the existing evidence contract without inventing references", () => {
    const wire = modelPlanTransportSchema.parse({ selections: [["@C0", 0, ["按确认目标探索", ["@P0"], ["@F0"], ["先核实条件"]], ["可先尝试资料整理", [], ["@F0"], []]]], shortfallReason: "仅合成样例", comparison: ["比较条件", [], ["@F0"], []] });
    const expanded = expandModelPlanTransport(wire, binding, codec.decode);
    expect(expanded.recommendations[0].itemId).toBe(candidate.record.recordId);
    expect(expanded.recommendations[0].reasons[0]).toEqual({ text: "按确认目标探索", basis: "inference", studentFactIds: [studentId], competitionFactIds: [factId], conditions: ["先核实条件"] });
    expect(expanded.recommendations[0].roleReason?.basis).toBe("suggestion");
    expect(expanded.profileRevision).toBe(context.profile.revision);
    expect(expanded.catalogVersion).toBe(context.catalogVersion);
    expect(validateMatchPlan(expanded, context).ok).toBe(true);
  });

  it("retains invalid aliases for the original validator to reject", () => {
    const wire = modelPlanTransportSchema.parse({ selections: [["@C99", 0, ["探索", ["@P99"], ["@F99"], []], ["整理", [], [], []]]], shortfallReason: "合成反例" });
    const expanded = expandModelPlanTransport(wire, binding, codec.decode);
    expect(expanded.recommendations[0].itemId).toBe("@C99");
    expect(validateMatchPlan(expanded, context).ok).toBe(false);
  });

  it("rejects malformed tuple claims and caller-owned revision fields", () => {
    expect(modelPlanTransportSchema.safeParse({ selections: [["@C0", 0, ["无引用字段"], []]], shortfallReason: null }).success).toBe(false);
    expect(modelPlanTransportSchema.safeParse({ selections: [], shortfallReason: "不足", profileRevision: "forged" }).success).toBe(false);
  });

  it("runs compact generation through unchanged structural and separate semantic verification", async () => {
    const stages: string[] = [];
    const plan = buildRuleMatchPlan(context);
    const result = await runDecisionRecommendation(student({ confirmedFields: ["stage", "interests"], interests: ["data"] }), {
      context, method: "llm", legacyPlanTransport: true, modelCall: async (prompt, options) => {
        const stage = options.promptVersion!.split(".").at(-1)!;
        stages.push(stage);
        expect(options.thinking).toBe("enabled");
        expect(options.reasoningEffort).toBe("max");
        expect(options.maxAttempts).toBe(1);
        let data: unknown;
        if (stage === "match") data = {
          selections: plan.recommendations.map(item => {
            const reason = item.reasons[0];
            const record = context.candidates.find(candidate => candidate.record.recordId === item.itemId)!.record;
            return [item.itemId, 0, [reason.text.slice(0, 120), reason.studentFactIds, reason.competitionFactIds, reason.conditions],
              ["先探索此任务并核实资源", [], [record.facts[0].id], []]];
          }), shortfallReason: plan.shortfallReason,
        };
        else {
          expect(options.systemPrompt).toBe(DECISION_VERIFICATION_SYSTEM_PROMPT);
          data = { checks: JSON.parse(prompt).assertions.map((row: { key: string }) => ({ key: row.key, supported: true, reason: "合成支持检查" })) };
        }
        return { ok: true, data, model: "contract-test", upstreamAttempted: true, httpStatus: 200, attempts: 1, durationMs: 1, finishReason: "stop", usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0 } };
      },
    });
    expect(stages).toEqual(["match", "verify"]);
    expect(result.fallback.used).toBe(false);
    expect(result.trace.method).toBe("llm");
    expect(result.trace.verification).toBe("model_reviewed");
  });

  it("uses the actual model-selected order, roles and anchor provenance rather than the rule shortlist", async () => {
    const selected = [...buildRuleMatchPlan(context).recommendations].reverse().slice(0, 5);
    const wire = { selections: selected.map(item => {
      const record = context.candidates.find(candidate => candidate.record.recordId === item.itemId)!.record;
      return [item.itemId, 0, [studentId], [record.facts[0].id]];
    }), shortfallReason: selected.length < 5 ? "合成不足" : null };
    const stages: string[] = [];
    const result = await runDecisionRecommendation(student(), {
      context, method: "llm", legacyPlanTransport: true, modelCall: async (prompt, options) => {
        const stage = options.promptVersion!.split(".").at(-1)!;
        stages.push(stage);
        const data = stage === "match" ? wire : { checks: JSON.parse(prompt).assertions.map((row: { key: string }) => ({ key: row.key, supported: true, reason: "合成支持检查" })) };
        return { ok: true, data, model: "contract-test", upstreamAttempted: true, httpStatus: 200, attempts: 1, durationMs: 1, finishReason: "stop", usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0 } };
      },
    });
    expect(stages).toEqual(["match", "verify"]);
    expect(result.fallback.used).toBe(false);
    expect(result.recommendations.map(item => item.itemId)).toEqual(selected.map(item => item.itemId));
    expect(result.trace.explanationSource).toBe("server_evidence_anchors");
    expect(result.trace.method).toBe("llm");
    expect(result.recommendations[0].reasons[0].studentFactIds).toEqual([studentId]);
    expect(result.recommendations[0].reasons[0].competitionFactIds).toEqual(wire.selections[0][3]);
  });

  it("keeps malformed anchor expansion within the usable bounded fallback contract", async () => {
    const report = await runDecisionRecommendation(student(), {
      context, method: "llm", legacyPlanTransport: true, modelCall: async () => ({
        ok: true, data: { selections: [["x".repeat(400), 0, ["@P0"], ["@F0"]]], shortfallReason: "合成错误锚点" },
        model: "contract-test", upstreamAttempted: true, httpStatus: 200, attempts: 1, durationMs: 1, finishReason: "stop",
      }),
    });
    expect(report.fallback).toEqual({ used: true, reason: "invalid_evidence_plan" });
    expect(report.trace.method).toBe("rules");
    expect(report.recommendations.length).toBeGreaterThan(0);
  });
});

it("requires a real verdict and a nonempty justification for each compact check",()=>{
  expect(decisionVerificationSchema.parse({rows:[["r0:0",1,"当前学生事实与该项任务相符"],["r0:role",0,"没有本人完成这项工作的依据"]]})).toEqual({checks:[
    {key:"r0:0",supported:true,reason:"当前学生事实与该项任务相符"},{key:"r0:role",supported:false,reason:"没有本人完成这项工作的依据"},
  ]});
  expect(decisionVerificationSchema.safeParse({rows:[["r0:0",1,""]]}).success).toBe(false);
  expect(decisionVerificationSchema.safeParse({rows:[["r0:0",2,"不明确"]]}).success).toBe(false);
});
