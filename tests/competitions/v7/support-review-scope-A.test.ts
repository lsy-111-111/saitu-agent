import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withDecisionEffortPolicy } from "@/lib/ai/effort-context";
import { DEFAULT_EFFORT_POLICY, effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import { claim } from "@/lib/competitions/v6/engine";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { assembleReviewedGroupDetailsV7, classifyGroupAssertionsV7, createExplanationGroupSpecsV7, generateGroupExplanationV7, reviewPreparedGroupV7, type GroupRunBindingV7 } from "@/lib/competitions/v7/explanation-groups";
import { buildDecisionContextV7, isLowRiskAuditSampleV7, requiresSupportReviewV7 } from "@/lib/competitions/v7/model";
import { matchReasonAnchorPrefixV7 } from "@/lib/competitions/v7/reason-anchor";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { decodedGroupWire, groupReasonFixture, matchingRelationReviewBallotFixture } from "./group-reason-fixture";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_support_scope_test_forbids_http"); })));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("A support review separates factual assertions from optional practice", () => {
  it.each([
    "可先练习基础知识。", "可每天练习一小时，再记录问题。", "需要时可回看练习笔记。",
    "如果以后参加，你可以每天练习一小时。", "你可先整理基础概念，根据需要调整练习时长。",
    "你可以先尝试写一个简单程序。", "如果有余力，可用零成本公开数据练习。",
    "可以先制作一页观察札记。",
  ])("keeps plain practice eligible for offline sampling: %s", text => {
    const advice = { ...claim(text, "suggestion", ["student-goal"], ["task-fact"]), conditions: ["如有余力，可逐步增加练习。"] };
    expect(requiresSupportReviewV7(advice)).toBe(false);
    expect(requiresSupportReviewV7({ ...advice, basis: "unknown" })).toBe(false);
  });

  it.each([
    "你符合参赛资格。", "如果以后参加，仍需要支付报名费。", "该赛道报名已截止。",
    "建议选择这项，个人总支出只要100元。", "可免费参加。", "保证能拿到学分。",
    "官方规定提交报告。", "题目需要两台设备。", "作品采用匿名评审。", "限额为十二。",
    "你已经会Python。", "你具备独立完成任务的能力。", "你的基础足以完成这项任务。",
    "你每周能投入3小时。", "你做过完整项目。", "队友的成果由你完成。", "你希望积累研究经历。",
    "本赛事只接受全日制本科生。", "每队最多三人。", "答辩占总成绩百分之四十。",
    "作品格式为PDF，页数不超过二十页。", "你没有做过完整项目。", "此前的模型由队友独立建立。",
    "可先练习，作品格式为PDF。", "可先练习。你还没写过代码。",
  ])("reviews critical facts even under suggestion: %s", text => {
    for (const basis of ["suggestion", "unknown"] as const) {
      expect(requiresSupportReviewV7(claim(text, basis))).toBe(true);
      expect(requiresSupportReviewV7({ ...claim("可先记录练习。", basis), conditions: [text] })).toBe(true);
    }
  });

  it.each(["student", "official", "inference"] as const)("keeps new %s claims synchronous", basis => {
    expect(requiresSupportReviewV7(claim("当前能力与任务有联系。", basis, ["student"], ["task"]))).toBe(true);
  });

  it("retains deterministic practice samples and reviews new matched reasons as inference through the existing ready flow", async () => {
    const policy = DEFAULT_EFFORT_POLICY;
    await withDecisionEffortPolicy(policy, async () => {
      const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records: Array.from({ length: 6 }, (_, index) => syntheticRecord(index + 1)) });
      const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, shortfallReason: null,
        recommendations: context.candidates.slice(0, 5).map(({ record }) => ({ itemId: record.recordId, reasons: [claim("内部提示。", "suggestion")] })) };
      const run: GroupRunBindingV7 = { runId: randomUUID(), stateKey: "fast24-A-offline", generation: 0, implementationSha256: "a".repeat(64), effortPolicySha256: effortPolicySha256(policy), detailDeadlineEpochMs: Date.now() + 90_000 };
      const [spec] = createExplanationGroupSpecsV7(context, plan, run);
      const studentFactId = context.profile.facts.find(fact => fact.field === "skills")!.id;
      const generated = await generateGroupExplanationV7(context, plan, spec, { runBinding: run, requestId: run.runId, deadlineEpochMs: run.detailDeadlineEpochMs - 750, modelCall: async (prompt, options) => {
        expect(options.thinking).toBe("enabled"); expect(options.reasoningEffort).toBe("low");
        return { ok: true, data: { schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: decodedGroupWire(prompt).groupBindingSha256, groupId: spec.groupId,
          profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, shortfallReason: null,
          recommendations: spec.itemIds.map((_itemId, rowIndex) => ({ rowIndex, reason: groupReasonFixture(0, 0), roleIndex: 0 })) },
        model: "deepseek-flash", upstreamAttempted: true, durationMs: 1, attempts: 1, httpStatus: 200, finishReason: "stop" };
      } });
      expect(generated.prepared.criticalKeys).toHaveLength(10);
      expect(generated.prepared.assertions.every(row => row.reason.basis === "inference")).toBe(true);
      expect(generated.prepared.offlineSamples).toEqual([]);
      const assertions = generated.prepared.assertions.map(row => {
        const anchor = context.candidates.find(candidate => candidate.record.recordId === row.itemId)!.record.facts[0];
        const prefix = matchReasonAnchorPrefixV7(anchor);
        expect(row.reason.text.startsWith(prefix)).toBe(true);
        return { ...row, reason: claim("可以先整理练习笔记，再记录一个待核对的问题。", "suggestion", [studentFactId], [anchor.id]) };
      });
      const first = classifyGroupAssertionsV7(context, assertions), second = classifyGroupAssertionsV7(context, structuredClone(assertions));
      expect(first).toEqual(second);
      expect(first.offlineSamples.map(row => row.key)).toEqual(assertions.filter(row => isLowRiskAuditSampleV7(JSON.stringify([context.catalogVersion, context.profile.revision, row]))).map(row => row.key));
      const reviewer = vi.fn(async (prompt: string) => ({ ok: true as const, data: { checks: decodedGroupWire(prompt).assertions.map((row: { key: string }) => matchingRelationReviewBallotFixture(row.key, "本条引用支持。")) }, model: "deepseek-flash", upstreamAttempted: true as const, durationMs: 1, attempts: 1, httpStatus: 200, finishReason: "stop" })), persistReviewPreparation = vi.fn();
      const result = await reviewPreparedGroupV7(context, plan, generated.prepared, { runBinding: run, requestId: run.runId, deadlineEpochMs: run.detailDeadlineEpochMs - 750, modelCall: reviewer, persistReviewPreparation,
        persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: run.runId, groupId: spec.groupId, groupBindingSha256: generated.prepared.groupBindingSha256, preparedSha256: generated.prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 } });
      expect(reviewer).toHaveBeenCalledTimes(1); expect(persistReviewPreparation).toHaveBeenCalledTimes(1);
      expect(result.reviewed.itemOutcomes.every(row => row.status === "ready")).toBe(true);
      expect(assembleReviewedGroupDetailsV7(context, plan, generated.prepared, result.reviewed, run).map(row => row.itemId)).toEqual(spec.itemIds);
    });
  });
});
