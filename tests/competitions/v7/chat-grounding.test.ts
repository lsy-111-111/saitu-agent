import { describe, expect, it } from "vitest";
import type { AiJsonResult } from "@/lib/ai/ai-client";
import { withDecisionEffortPolicy } from "@/lib/ai/effort-context";
import { buildDecisionContextV7, explainDecisionV7, EXPLICIT_SOURCE_TASK_PRACTICE_PROMPT_VERSION_V763 } from "@/lib/competitions/v7/model";
import { draftDecisionChatV7 } from "@/lib/competitions/v7/chat";
import { student, syntheticRecord } from "../v6/decision-fixtures";

const success = (data: unknown): AiJsonResult<unknown> => ({ ok: true, data, model: "deepseek-flash", upstreamAttempted: true, attempts: 1, finishReason: "stop", httpStatus: 200, durationMs: 1 });
const matchingTraces = [
  "saitu-explain.v7.64.bound-matching-relation.detail-v2",
  "saitu-explain.v7.65.axis-reviewed-matching-relation.detail-v2",
  "saitu-explain.v7.66.bound-task-relation.detail-v2",
  "saitu-explain.v7.67.bound-task-connection.detail-v2",
] as const;
const legacyTrace = `${EXPLICIT_SOURCE_TASK_PRACTICE_PROMPT_VERSION_V763}.detail-v2`;
async function state() {
  const legacy = student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] });
  const context = buildDecisionContextV7(legacy, { records: [syntheticRecord(1), syntheticRecord(2)] });
  const plan = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, recommendations: context.candidates.map(candidate => ({
    itemId: candidate.record.recordId, reasons: [{ text: candidate.record.facts[0].text, basis: "official" as const, studentFactIds: [], competitionFactIds: [candidate.record.facts[0].id], conditions: [] }],
  })), shortfallReason: "本次合成池只有两项。" };
  const report = await explainDecisionV7(context, plan, { modelCall: async () => success(plan) });
  return { legacy, profile: context.profile, context, report };
}

describe("v7 grounded follow-up answers", () => {
  it("answers a follow-up with an anti-invention instruction without extracting profile facts", async () => {
    const current = await state(), before = structuredClone(current.profile), operations: string[] = [];
    const focus = current.report.recommendations[0];
    const reply = await draftDecisionChatV7(current, `请解释“${focus.name}”与我已经提供的信息有什么关系，不要假设我有没提过的经历。`, [], {
      modelCall: async (_prompt, options) => {
        operations.push(options.operation!);
        return success({ message: "匹配说明", claims: focus.reasons });
      },
    });
    expect(operations).toEqual([]);
    expect(reply.message).toBe(`${focus.name}的匹配依据：`);
    expect(reply.claims).toEqual(focus.reasons);
    expect(reply.profile).toBeUndefined();
    expect(current.profile).toEqual(before);
  });

  it.each(matchingTraces)("shows a single complete matching relation in %s", async version => {
    const current = await state(), focus = current.report.recommendations[0];
    current.report.trace.promptVersion = version;
    focus.currentRole = { ...focus.currentRole, text: "用原文了解模型假设与适用范围。", conditions: ["先核实材料使用许可"] };
    focus.nextStep = structuredClone(focus.currentRole);
    const before = structuredClone(current.report);
    const reply = await draftDecisionChatV7(current, "怎么开始", [focus.itemId], { modelCall: async () => { throw new Error("unexpected_chat_model"); } });
    expect(reply.message).toBe(`关于${focus.name}，可以参考任务说明和匹配依据。`);
    expect(reply.claims).toEqual([focus.coreTask, focus.currentRole]);
    expect(reply.claims[1]).toBe(focus.currentRole);
    expect(current.report).toEqual(before);
  });

  it.each(matchingTraces.slice(1))("preserves distinct claim metadata in %s and the original wording of other versions", async version => {
    const current = await state(), focus = current.report.recommendations[0];
    current.report.trace.promptVersion = version;
    const relation = { ...focus.currentRole, studentFactIds: [current.profile.facts.find(fact => fact.field === "skills")!.id],
      competitionFactIds: [...focus.coreTask.competitionFactIds], conditions: ["先核实材料使用许可"] };
    focus.currentRole = relation;
    const options = { modelCall: async () => { throw new Error("unexpected_chat_model"); } };
    for (const distinct of [{ conditions: [] }, { studentFactIds: [] }, { competitionFactIds: [] }, { basis: "official" as const }]) {
      focus.nextStep = { ...relation, ...distinct };
      const reply = await draftDecisionChatV7(current, "怎么开始", [focus.itemId], options);
      expect(reply.claims).toEqual([focus.coreTask, relation, focus.nextStep]);
    }
    focus.nextStep = structuredClone(relation);
    for (const version of [legacyTrace, "saitu-explain.v7.64.bound-matching-relation",
      "saitu-explain.v7.65.axis-reviewed-matching-relation.detail-v3", "saitu-explain.v7.66.bound-task-relation.detail-v3",
      "saitu-explain.v7.67.bound-task-connection.detail-v3"]) {
      current.report.trace.promptVersion = version;
      const reply = await draftDecisionChatV7(current, "怎么开始", [focus.itemId], options);
      expect(JSON.stringify(reply)).toBe(JSON.stringify({ message: `${focus.name}可以这样开始：`, claims: [focus.coreTask, relation, focus.nextStep] }));
    }
  });

  it("uses neutral matching-relation fallback wording with the same claims and one failed request", async () => {
    const current = await state(), focus = current.report.recommendations[0];
    for (const version of [...matchingTraces, legacyTrace]) {
      current.report.trace.promptVersion = version;
      let calls = 0;
      const reply = await draftDecisionChatV7(current, "这种做法有什么限制？", [focus.itemId], { modelCall: async () => {
        calls++;
        return { ok: false, model: "deepseek-flash", reason: "timeout", upstreamAttempted: true };
      } });
      expect(calls).toBe(1);
      expect(reply.claims).toEqual([focus.coreTask, focus.nextStep]);
      expect(reply.message).toBe(version !== legacyTrace
        ? `这次追问暂未得到可核实的补充，可参考${focus.name}的任务和匹配依据。`
        : `这次追问暂未得到可核实的补充，可先参考${focus.name}的任务与行动建议：`);
    }
  });

  it("does not display an uncited factual assertion hidden in the model message", async () => {
    const current = await state(); let count = 0;
    const reply = await draftDecisionChatV7(current, "这种做法有什么限制？", [], { modelCall: async () => {
      count++; return success({ message: "学校确认参加这个比赛就一定保研。", claims: [current.report.recommendations[0].coreTask] });
    } });
    expect(count).toBe(1);
    expect(reply.message).not.toContain("保研");
    expect(reply.claims).toEqual([current.report.recommendations[0].coreTask]);
  });
  it("independently rejects new false rules despite a valid but unrelated citation", async () => {
    const current = await state(), stages: string[] = [];
    const reply = await draftDecisionChatV7(current, "这种做法有什么限制？", [], { requestId: "chat-grounding", modelCall: async (_prompt, options) => {
      stages.push(options.diagnosticContext!.stage);
      if (options.operation === "competition_v7_chat_review") return success({ checks: [{ key: "chat.0", supported: false, reason: "给定原文未要求纸质材料" }] });
      return success({ message: "一项要求", claims: [{ ...current.report.recommendations[0].coreTask, text: "该赛事必须提交纸质材料。" }] });
    } });
    expect(stages).toEqual(["v7.chat", "v7.review"]);
    expect(reply.claims.some(claim => claim.text.includes("必须提交纸质"))).toBe(false);
    expect(reply.message).toContain("暂未得到可核实");
  });
  it("does not treat a missing or foreign support-review key as approval", async () => {
    const current = await state();
    const reply = await draftDecisionChatV7(current, "这种做法有什么限制？", [], { modelCall: async (_prompt, options) => options.operation === "competition_v7_chat_review"
      ? success({ checks: [{ key: "foreign-claim", supported: true, reason: "已确认" }] })
      : success({ message: "要求", claims: [{ ...current.report.recommendations[0].coreTask, text: "该赛事要求纸质材料。" }] }) });
    expect(reply.claims.some(claim => claim.text.includes("要求纸质"))).toBe(false);
  });
  it("does not repay a timeout while answering a follow-up", async () => {
    const current = await state(); let count = 0;
    const reply = await draftDecisionChatV7(current, "这种做法有什么限制？", [], { modelCall: async () => { count++; return { ok: false, model: "deepseek-flash", reason: "timeout", upstreamAttempted: true }; } });
    expect(count).toBe(1); expect(reply.message).toContain("暂未得到可核实");
  });
  it("keeps chat and its support review high when recommendation review is low", async () => {
    const current = await state(), operations: string[] = [];
    const deadlineEpochMs = Date.now() + 5_000;
    await withDecisionEffortPolicy({ version: "saitu.effort-policy.v1", rank: "low", explain: "low", review: "low" }, () =>
      draftDecisionChatV7(current, "这种做法有什么限制？", [], { deadlineEpochMs, modelCall: async (_prompt, options) => {
        operations.push(options.operation!);
        expect(options).toMatchObject({ thinking: "enabled", reasoningEffort: "high", maxAttempts: 1, timeoutMs: 45_000, deadlineEpochMs });
        if (options.operation === "competition_v7_chat_review") return success({ checks: [{ key: "chat.0", supported: false, reason: "给定原文未要求纸质材料" }] });
        return success({ message: "要求", claims: [{ ...current.report.recommendations[0].coreTask, text: "该赛事必须提交纸质材料。" }] });
      } }));
    expect(operations).toEqual(["competition_v7_chat", "competition_v7_chat_review"]);
  });
});
