import { describe, expect, it } from "vitest";
import type { AiJsonResult } from "@/lib/ai/ai-client";
import { draftDecisionChatV7, SELF_REPORT_PROMPT_VERSION_V7 } from "@/lib/competitions/v7/chat";
import { applyExplicitCorrectionV7 } from "@/lib/competitions/v7/corrections";
import { applySelfReportedFactsV7, createStudentProfileV7 } from "@/lib/competitions/v7/profile";
import type { DomainFact, ProfileExtraction } from "@/lib/competitions/v6/domain-facts";
import { student } from "../v6/decision-fixtures";

const legacy = student({ skills: ["programming"], weeklyCommitment: "5-10", confirmedFields: ["stage", "skills", "weeklyCommitment"] });
const current = () => ({ legacy, profile: createStudentProfileV7(legacy) });
const success = (data: unknown): AiJsonResult<unknown> => ({ ok: true, data, model: "mock-semantic-extraction", upstreamAttempted: true, finishReason: "stop", attempts: 1, httpStatus: 200, durationMs: 1 });
const fact = (field: string, value: DomainFact["value"], sourceText: string, state: DomainFact["state"] = "affirmed"): DomainFact => ({ field, value, sourceText, state, evidenceLevel: "self_report", confirmed: false });
async function adopt(text: string, facts: DomainFact[], state = current()) {
  const calls: string[] = [];
  const reply = await draftDecisionChatV7(state, text, [], { requestId: "semantic-adoption-fixture", at: "2026-11-09T00:00:00.000Z", modelCall: async (prompt, options) => {
    calls.push(options.operation!);
    expect(options).toMatchObject({ operation: "competition_v7_extract", maxAttempts: 1, reasoningEffort: "high", promptVersion: SELF_REPORT_PROMPT_VERSION_V7 });
    const packet = JSON.parse(prompt);
    expect(packet).toMatchObject({ utterance: text, allowNewDomainFields: true });
    expect(packet.standardValues.taskFormats).toContain("design");
    expect(packet.standardValues.availableResources).toContain("equipment");
    return success({ facts, unknownFields: [] } satisfies ProfileExtraction);
  } });
  return { reply, calls };
}

describe("v7 complete semantic adoption of new statements", () => {
  it.each([
    ["材料仅限校内使用，禁止公开上传。", "materials.useScope", "校内"],
    ["成果只授权线下展览，不接受商业转载。", "work.license", "offline-noncommercial"],
    ["数据不得移交给外部单位。", "data.externalTransferAllowed", false],
  ] as const)("adopts a new domain constraint without requiring a first-person prefix: %s", async (text, field, value) => {
    const before = current();
    const { reply, calls } = await adopt(text, [fact(field, value, text)], before);
    expect(calls).toEqual(["competition_v7_extract"]);
    expect(reply.profile?.revision).not.toBe(before.profile.revision);
    expect(reply.profile?.facts.find(row => row.field === field)).toMatchObject({ value, originalText: text, confirmed: true });
    expect(reply.profile?.updates?.[0].originalText).toBe(text);
    expect(reply.profile?.facts.find(row => row.field === "skills")?.value).toBe("programming");
  });

  it("adopts a newly stated learning goal without presenting the desired skill as existing ability", async () => {
    const text = "本轮最重要的目标是练习绘图。";
    const { reply, calls } = await adopt(text, [fact("goalIntent", "skill", text), fact("goalResolution", "confirmed", text), fact("goal.task", "绘图", text)]);
    expect(calls).toHaveLength(1);
    expect(reply.profile?.primaryGoal).toBe("练习具体能力");
    expect(reply.profile?.facts.find(row => row.field === "goal.task")?.value).toBe("绘图");
    expect(reply.profile?.facts.some(row => row.field === "skills" && row.value === "design")).toBe(false);
  });

  it("reuses an existing nonstandard field when correcting its value", async () => {
    const base = current(), oldText = "成果存储范围仅限校内。";
    const initial = applySelfReportedFactsV7(base.profile, { facts: [fact("storage.scope", "school", oldText)], unknownFields: [] }, { answerId: "initial-scope", text: oldText, at: "2026-11-09T00:00:00.000Z" }, legacy);
    const text = "更正：成果存储范围改为仅限实验室；其他条件不变。";
    const { reply, calls } = await adopt(text, [fact("storage.scope", "laboratory", "更正：成果存储范围改为仅限实验室")], { ...base, profile: initial });
    expect(calls).toHaveLength(1);
    expect(reply.profile?.facts.filter(row => row.field === "storage.scope").map(row => row.value)).toEqual(["laboratory"]);
    expect(reply.profile?.retractedFactIds).toContain(initial.facts.find(row => row.field === "storage.scope")!.id);
  });

  it("adopts standard and new constraints atomically instead of dropping the unrecognized clauses", async () => {
    const text = "我每周能投入3小时，成果仅用于课堂，不能发到公共平台。";
    expect(applyExplicitCorrectionV7(current().profile, text, legacy).kind).toBe("semantic");
    const { reply, calls } = await adopt(text, [fact("weeklyHours", 3, "我每周能投入3小时"), fact("work.use", "classroom", "成果仅用于课堂"), fact("work.publicUploadAllowed", false, "不能发到公共平台", "negated")]);
    expect(calls).toHaveLength(1);
    expect(reply.profile?.facts.find(row => row.field === "weeklyHours")?.value).toBe(3);
    expect(reply.profile?.facts.find(row => row.field === "weeklyCommitment")?.value).toBe("under-5");
    expect(reply.profile?.facts.find(row => row.field === "work.publicUploadAllowed")).toMatchObject({ value: false, state: "negated" });
    expect(reply.profile?.updates).toHaveLength(1);
  });

  it("does not partly update a turn when extraction omits an independent restriction", async () => {
    const text = "我每周能投入3小时，成果不允许公开。";
    const { reply, calls } = await adopt(text, [fact("weeklyHours", 3, "我每周能投入3小时")]);
    expect(calls).toHaveLength(1); expect(reply.profile).toBeUndefined();
    expect(reply.message).toContain("暂未解析成功");
  });

  it("routes opaque content within a standard ability clause through the full semantic pass", async () => {
    const text = "我会Python但交付材料不能公开。";
    const { reply, calls } = await adopt(text, [fact("skills", "programming", "我会Python"), fact("deliverable.publicAllowed", false, "交付材料不能公开", "negated")]);
    expect(calls).toHaveLength(1);
    expect(reply.profile?.facts.some(row => row.field === "deliverable.publicAllowed")).toBe(true);
  });

  it("retains a real ambiguity instead of guessing or applying only other fields", async () => {
    const text = "预算按方案A或方案B处理，材料不得外传。";
    let calls = 0;
    const reply = await draftDecisionChatV7(current(), text, [], { modelCall: async () => { calls++; return success({ facts: [fact("material.externalTransfer", false, "材料不得外传", "negated")], unknownFields: [], unresolvedAssertions: [{ sourceText: "预算按方案A或方案B处理", kind: "value" }] }); } });
    expect(calls).toBe(1); expect(reply.profile).toBeUndefined(); expect(reply.message).toContain("具体新值");
  });

  it.each([
    ["目标改为练习绘图。", [fact("goalIntent", "skill", "目标改为练习绘图"), fact("goal.task", "绘图", "目标改为练习绘图")], "goal.task"],
    ["我目前没有队友并有硬件资源。", [fact("teamStatus", "solo", "我目前没有队友并有硬件资源"), fact("availableResources", "equipment", "我目前没有队友并有硬件资源")], "availableResources"],
    ["请按只能校内展示这个限制推荐。", [fact("work.displayScope", "school", "请按只能校内展示这个限制推荐")], "work.displayScope"],
  ] as const)("uses whole-turn semantics for a detailed target or mixed constraint: %s", async (text, facts, field) => {
    expect(applyExplicitCorrectionV7(current().profile, text, legacy).kind).toBe("semantic");
    const { reply, calls } = await adopt(text, [...facts]);
    expect(calls).toHaveLength(1); expect(reply.profile?.facts.some(row => row.field === field)).toBe(true);
  });
});

describe("v7 semantic adoption keeps attribution and dispatch boundaries", () => {
  it("still adopts an actual constraint beside an instruction not to infer unprovided resources", async () => {
    const text = "不要假设我有未提供的资源，设备只能在校内使用。";
    const { reply, calls } = await adopt(text, [fact("equipment.useScope", "school", "设备只能在校内使用")]);
    expect(calls).toEqual(["competition_v7_extract"]);
    expect(reply.profile?.facts.find(row => row.field === "equipment.useScope")?.value).toBe("school");
    expect(reply.profile?.facts.some(row => row.field === "availableResources")).toBe(false);
  });

  it.each(["如果每周只有3小时，怎么准备？", "比较第一项和第二项", "下一步", "我需要再举证吗？", "谢谢"])("does not extract a pure question or courtesy message: %s", async text => {
    let calls = 0;
    const reply = await draftDecisionChatV7(current(), text, [], { modelCall: async () => { calls++; throw new Error("unnecessary_extract"); } });
    expect(calls).toBe(0); expect(reply.profile).toBeUndefined();
  });

  it("keeps standard clear skills and hours on the no-model path", async () => {
    for (const text of ["我会Python。", "每周从8小时改为3小时。", "我的个人预算改为100元。"]) {
      let calls = 0;
      const reply = await draftDecisionChatV7(current(), text, [], { modelCall: async () => { calls++; throw new Error("unnecessary_extract"); } });
      expect(calls).toBe(0); expect(reply.profile).toBeDefined();
    }
  });

  it("does not relabel team or unspecified budgets as personal limits", () => {
    const team = applyExplicitCorrectionV7(current().profile, "全队预算上限100元。", legacy);
    expect(team.kind).toBe("applied");
    expect(team.profile.facts.find(row => row.field === "budget.teamMaximumYuan")?.value).toBe(100);
    expect(team.profile.facts.some(row => row.field === "budget.maximumYuan")).toBe(false);
    const unspecified = applyExplicitCorrectionV7(current().profile, "预算100元。", legacy);
    expect(unspecified.profile.facts.find(row => row.field === "budget.unspecifiedMaximumYuan")?.value).toBe(100);
  });

  it.each(["每周3–8小时。", "个人预算100元或者200元。"])("does not dispatch a model to guess a clear numeric ambiguity: %s", async text => {
    let calls = 0;
    const reply = await draftDecisionChatV7(current(), text, [], { modelCall: async () => { calls++; throw new Error("unnecessary_extract"); } });
    expect(calls).toBe(0); expect(reply.profile).toBeUndefined(); expect(reply.message).toMatch(/不明确|上限/);
  });

  it("rejects another person's statement being converted into student ability", async () => {
    const text = "朋友说我会做设计。";
    const { reply, calls } = await adopt(text, [fact("skills", "design", text)]);
    expect(calls).toHaveLength(1); expect(reply.profile).toBeUndefined();
  });

  it("retains interest separately and a future ability as conditional", async () => {
    const interest = "我对数据感兴趣，想学分析。";
    const interested = await adopt(interest, [fact("interests", "data", interest)]);
    expect(interested.reply.profile?.facts.some(row => row.field === "skills" && row.value === "data-analysis")).toBe(false);
    expect(interested.reply.profile?.facts.find(row => row.field === "interests")?.value).toBe("data");
    const planned = "如果以后有时间，我计划学Python。";
    const conditional = await adopt(planned, [fact("skills", "programming", planned, "conditional")]);
    expect(conditional.reply.profile?.facts.filter(row => row.field === "skills" && row.value === "programming").map(row => row.state)).toEqual(["affirmed", "conditional"]);
  });

  it("fails closed for invented quotes and reserved field paths", async () => {
    for (const extracted of [fact("storage.scope", "school", "这句并非用户原话"), fact("constructor", true, "资料仅限校内。")]) {
      const { reply, calls } = await adopt("资料仅限校内。", [extracted]);
      expect(calls).toHaveLength(1); expect(reply.profile).toBeUndefined();
    }
  });

  it("does not retry an extraction with an unknown dispatch outcome", async () => {
    let calls = 0;
    const reply = await draftDecisionChatV7(current(), "成果只能用于教学。", [], { modelCall: async () => { calls++; return { ok: false, model: "deepseek-flash", upstreamAttempted: true, reason: "durable_outcome_unknown" }; } });
    expect(calls).toBe(1); expect(reply.profile).toBeUndefined();
  });

  it("never renders a model-authored proof or certification request as clarification", async () => {
    const text = "材料只能校内展示。";
    const reply = await draftDecisionChatV7(current(), text, [], { modelCall: async () => success({ facts: [], unknownFields: [], unresolvedAssertions: [{ sourceText: text, kind: "scope", reason: "请提交作品证明能力，并等待认证。" }] }) });
    expect(reply.profile).toBeUndefined(); expect(reply.message).not.toMatch(/提交作品|证明能力|认证/);
  });

  it("adopts an explicit unknown instead of requiring a confirmed numeric value", async () => {
    const text = "我还不确定每周能投入多少时间。";
    const { reply, calls } = await adopt(text, [fact("weeklyHours", "unknown", text, "unknown")]);
    expect(calls).toHaveLength(1);
    expect(reply.profile?.facts.find(row => row.field === "weeklyHours")).toMatchObject({ value: "unknown", state: "unknown", confirmed: false });
    expect(reply.profile?.unknownFields).toContain("weeklyHours");
    expect(reply.message).not.toContain("新值是什么");
  });

  it.each(["我还不确定设备能否借到。", "目前还不知道材料是否允许公开。"])("adopts a declarative unknown with an embedded question: %s", async text => {
    const { reply, calls } = await adopt(text, [fact("resources.access", "unknown", text, "unknown")]);
    expect(calls).toHaveLength(1);
    expect(reply.profile?.facts.find(row => row.field === "resources.access")).toMatchObject({ value: "unknown", state: "unknown", confirmed: false });
    expect(reply.profile?.unknownFields).toContain("resources.access");
  });

  it("keeps a direct resource question as a question", async () => {
    let calls = 0;
    const reply = await draftDecisionChatV7(current(), "我是否能借到设备？", [], { modelCall: async () => { calls++; throw new Error("unnecessary_extract"); } });
    expect(calls).toBe(0); expect(reply.profile).toBeUndefined();
  });

  it("rejects clear third-person work as student ability while retaining attributed and first-person contributions", async () => {
    const text = "队友完成了 Python 项目，我只做展示。";
    const emptyLegacy = student({ confirmedFields: ["stage"] }), state = { legacy: emptyLegacy, profile: createStudentProfileV7(emptyLegacy) };
    const rejected = await adopt(text, [fact("skills", "programming", "队友完成了 Python 项目")], state);
    expect(rejected.reply.profile).toBeUndefined();
    const attributed = await adopt(text, [fact("other.project", "Python", "队友完成了 Python 项目"), fact("contribution.task", "展示", "我只做展示")], state);
    expect(attributed.reply.profile?.facts.find(row => row.field === "contribution.task")?.value).toBe("展示");
    expect(attributed.reply.profile?.facts.some(row => row.field === "skills" && row.value === "programming")).toBe(false);
    const joint = "我和队友一起完成了 Python 项目。";
    const shared = await adopt(joint, [fact("skills", "programming", joint)], state);
    expect(shared.reply.profile?.facts.find(row => row.field === "skills" && row.value === "programming")?.confirmed).toBe(true);
  });

  it("bounds hint fields without truncating a full valid profile during correction", async () => {
    const base = current();
    const profile = { ...base.profile, facts: [...base.profile.facts, ...Array.from({ length: 160 - base.profile.facts.length }, (_, index) => ({ id: `custom-${index}`, field: `constraint.c${index}`, value: "old", label: `旧条件${index}`, state: "affirmed" as const, evidenceLevel: "self_report" as const, confirmed: true }))] };
    const text = "更正：约束0改为校内使用。";
    let calls = 0;
    const reply = await draftDecisionChatV7({ ...base, profile }, text, [], { modelCall: async prompt => {
      calls++; const packet = JSON.parse(prompt);
      expect(packet.requestedFields.length).toBeLessThanOrEqual(160); expect(packet.context.facts).toHaveLength(160);
      return success({ facts: [fact("constraint.c0", "school", text)], unknownFields: [] });
    } });
    expect(calls).toBe(1); expect(reply.profile?.facts).toHaveLength(160);
    expect(reply.profile?.facts.find(row => row.field === "constraint.c0")?.value).toBe("school");
  });
});
