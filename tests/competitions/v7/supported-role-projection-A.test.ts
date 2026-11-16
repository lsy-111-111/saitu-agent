import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claim } from "@/lib/competitions/v6/engine";
import { buildDecisionContextV7, explainDecisionV7, projectReviewedReasonsV7, type DecisionModelCallV7 } from "@/lib/competitions/v7/model";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { student, syntheticRecord } from "../v6/decision-fixtures";

function fixture() {
  const context = buildDecisionContextV7(student({ skills: ["programming"], confirmedFields: ["stage", "skills"] }), { records: [syntheticRecord(1), syntheticRecord(2), syntheticRecord(3)] });
  const personal = context.profile.facts.find(f => f.field === "skills")!;
  const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, shortfallReason: "合成三项候选。",
    recommendations: context.candidates.map(({ record }) => ({ itemId: record.recordId,
      reasons: [claim("可从自报技能尝试该任务。", "inference", [personal.id], [record.facts[0].id])], roleIndex: 0,
      roleReason: claim("未来可先形成一份本人练习草稿，并记录修订点。", "inference", [personal.id], [record.facts[0].id]) })) };
  const assertions = plan.recommendations.flatMap(item => [{ key: `${item.itemId}.reason.0`, itemId: item.itemId, reason: item.reasons[0] }, { key: `${item.itemId}.role`, itemId: item.itemId, reason: item.roleReason! }]);
  const critical = assertions.map(row => row.key), checks = critical.map((key, index) => ({ key, supported: index !== 0, reason: index ? "原引用支持未来动作。" : "保留原拒绝。" }));
  return { context, plan, assertions, critical, checks };
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_projection_forbids_http"); })));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("same-owner reviewed role content projection", () => {
  it("retains original false/key/count and copies only the whole explicitly true role claim", () => {
    const { context, plan, assertions, critical, checks } = fixture(), before = structuredClone({ plan, assertions, checks });
    const projected = projectReviewedReasonsV7(context, plan, assertions, critical, checks);
    expect(projected.readyItemIds).toEqual(plan.recommendations.map(row => row.itemId));
    expect(projected.plan.recommendations[0].reasons).toEqual([plan.recommendations[0].roleReason]);
    expect(projected.plan.recommendations[0].roleIndex).toBe(plan.recommendations[0].roleIndex);
    expect(projected.bindings[0]).toMatchObject({ visibleKey: critical[0], sourceKey: critical[1], itemId: plan.recommendations[0].itemId, supported: true });
    expect(projected.rejectedOriginalKeys).toEqual([critical[0]]); expect(projected.promoted).toBe(1);
    expect({ plan, assertions, checks }).toEqual(before);
  });

  it.each(["all-false", "role-false", "conditions", "no-role"])("keeps %s content blocked", defect => {
    const { context, plan, assertions, critical, checks } = fixture();
    if (defect === "all-false") checks.forEach(row => { row.supported = false; });
    if (defect === "role-false") checks[1].supported = false;
    if (defect === "conditions") plan.recommendations[0].reasons[0].conditions.push("必要资源尚未落实。");
    if (defect === "no-role") { delete plan.recommendations[0].roleIndex; delete plan.recommendations[0].roleReason; assertions.splice(1, 1); critical.splice(1, 1); checks.splice(1, 1); }
    const result = projectReviewedReasonsV7(context, plan, assertions, critical, checks);
    expect(result.readyItemIds).not.toContain(plan.recommendations[0].itemId);
  });

  it.each(["missing", "duplicate", "foreign", "cross-owner", "changed-claim", "wrong-role"])("rejects %s review/source bindings", defect => {
    const { context, plan, assertions, critical, checks } = fixture();
    if (defect === "missing") checks.pop();
    if (defect === "duplicate") checks[1].key = checks[0].key;
    if (defect === "foreign") checks[0].key = "unselected.role";
    if (defect === "cross-owner") assertions[1].itemId = plan.recommendations[1].itemId;
    if (defect === "changed-claim") plan.recommendations[0].roleReason = { ...plan.recommendations[0].roleReason!, text: "未审过的新句子。" };
    if (defect === "wrong-role") plan.recommendations[0].roleIndex = 99;
    expect(() => projectReviewedReasonsV7(context, plan, assertions, critical, checks)).toThrow();
  });

  it("carries the same original true role through the direct path and existing audit trace without another call", async () => {
    const { context, plan, checks } = fixture(), events: unknown[] = []; let calls = 0;
    const modelCall: DecisionModelCallV7 = async (prompt, options) => {
      calls++; expect(options).not.toHaveProperty("topP");
      const value = options.operation === "competition_v7_explain" ? plan : { checks: JSON.parse(prompt).assertions.map((row: { key: string }, index: number) => ({ ...checks[index], key: row.key })) };
      return { ok: true, data: value, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 0 };
    };
    const report = await explainDecisionV7(context, plan, { modelCall, onObservation: async event => { events.push(event); } });
    expect(calls).toBe(2); expect(report.recommendations[0].reasons).toEqual([plan.recommendations[0].roleReason]);
    expect(report.recommendations[0].nextStep).toEqual(plan.recommendations[0].roleReason);
    expect(report.trace.supportChecks).toBe(6); expect(report.trace.unsupportedChecks).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ stage: "v7.audit", data: expect.objectContaining({ policy: "same-owner-reviewed-role-projection-v1", rejectedOriginalKeys: [checks[0].key] }) }));
  });
});
