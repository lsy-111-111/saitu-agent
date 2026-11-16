import { describe, expect, it } from "vitest";
import type { AiJsonResult } from "@/lib/ai/ai-client";
import { draftDecisionChatV7, extractSelfReportedFactsV7 } from "@/lib/competitions/v7/chat";
import { applySelfReportedFactsV7, createStudentProfileV7 } from "@/lib/competitions/v7/profile";
import { isProfileControlClauseV7, isQuotedProfileContextOnlyV7 } from "@/lib/competitions/v7/corrections";
import type { DomainFact } from "@/lib/competitions/v6/domain-facts";
import { student } from "../v6/decision-fixtures";
const fact = (field: string, value: DomainFact["value"], sourceText: string, state: DomainFact["state"] = "affirmed"): DomainFact => ({ field, value, sourceText, state, evidenceLevel: "self_report", confirmed: false });
const success = (facts: DomainFact[], unresolvedAssertions: { sourceText: string; kind: "target" | "value" | "scope" }[] = []): AiJsonResult<unknown> => ({ ok: true, data: { facts, unknownFields: [], unresolvedAssertions }, model: "offline-replay", upstreamAttempted: true, finishReason: "stop", attempts: 1, httpStatus: 200, durationMs: 1 });
const source = (text: string, answerId = "operations") => ({ text, answerId, at: "2026-11-09T00:00:00+08:00" });

describe("scope and profile-update instructions", () => {
  it("keeps a literal naming qualifier in the original adjacent quotation without guessing a value", async () => {
    const text = "草图只做过单元检查。目录项叫序列Q，这只是一个界面标题。";
    const reply = await draftDecisionChatV7({ profile: createStudentProfileV7(student()) }, text, [], { ...source(text), modelCall: async () => success([
      fact("draft.validation", "单元检查", "草图只做过单元检查"), fact("catalog.label", "序列Q", "目录项叫序列Q"),
    ], [{ sourceText: "这只是一个界面标题", kind: "target" }]) });
    const label = reply.profile?.facts.find(row => row.field === "catalog.label");
    expect(label).toMatchObject({ value: "序列Q", originalText: "目录项叫序列Q，这只是一个界面标题" });
    expect(text.slice(label!.sourceSpan!.start, label!.sourceSpan!.end)).toBe(label?.originalText);
    expect(reply.profile?.facts.some(row => /skill|qualification/.test(row.field))).toBe(false);
  });

  it("does not use a naming qualifier to bless a personal ability or a nonadjacent fact", async () => {
    for (const field of ["skills", "experience.1.contribution"]) {
      const result = await extractSelfReportedFactsV7({ utterance: "我会设计，这只是一个标题。", requestedFields: [], allowNewDomainFields: true }, { modelCall: async () => success([fact(field, "design", "我会设计")], [{ sourceText: "这只是一个标题", kind: "target" }]) });
      expect(result.clarification).toContain("哪一项条件"); expect(result.facts).toEqual([]);
    }
  });

  it("normalizes only a presentation prefix and terminal punctuation for coverage", async () => {
    const text = "补充：这些资料不得外传。";
    const reply = await draftDecisionChatV7({ profile: createStudentProfileV7(student()) }, text, [], { ...source(text), modelCall: async () => success([fact("materials.disclosure", false, "这些资料不得外传。", "negated")]) });
    expect(reply.profile?.facts.find(row => row.field === "materials.disclosure")).toMatchObject({ state: "negated", value: false, originalText: "这些资料不得外传。", sourceSpan: { start: 3, end: text.length } });
  });

  it("still rejects an omitted independent restriction atomically", async () => {
    const text = "补充：每周3小时，材料不得公开。";
    const reply = await draftDecisionChatV7({ profile: createStudentProfileV7(student()) }, text, [], { ...source(text), modelCall: async () => success([fact("weeklyHours", 3, "每周3小时")]) });
    expect(reply.profile).toBeUndefined(); expect(reply.message).toContain("暂未解析成功");
  });

  it("keeps a genuinely unresolved numeric correction atomic", async () => {
    const text = "预算按方案甲还是乙，设备只准校内使用。";
    const reply = await draftDecisionChatV7({ profile: createStudentProfileV7(student()) }, text, [], { ...source(text), modelCall: async () => success([fact("equipment.scope", "school", "设备只准校内使用")], [{ sourceText: "预算按方案甲还是乙", kind: "value" }]) });
    expect(reply.profile).toBeUndefined(); expect(reply.message).toContain("具体新值");
  });

  it.each(["不新增确认", "重复上一条质量要求", "不新增经历", "也不改变文档名称", "主要目标稍后再说", "我现在只确认文档名称", "并没有撤回关于主要目标和其他事实的陈述"])("routes a complete update instruction as control: %s", clause => {
    expect(isProfileControlClauseV7(clause)).toBe(true);
  });

  it.each(["我没有经历", "现在还不承诺", "没有商业使用许可", "不愿做硬件", "我不会绘图", "如果不新增确认", "老师说不新增确认", "我只确认预算是50元", "不改变文档名称A改成B"])("does not swallow a factual denial, condition, report or new value: %s", clause => {
    expect(isProfileControlClauseV7(clause)).toBe(false);
  });

  it("delivers a summary with a no-new-confirmation instruction without another model call", async () => {
    const legacy = student(), text = "主要目标是交付实验记录。";
    const profile = applySelfReportedFactsV7(createStudentProfileV7(legacy), { facts: [fact("primaryGoal", "交付实验记录", text)], unknownFields: [] }, source(text), legacy);
    const reply = await draftDecisionChatV7({ profile, legacy }, "请沿用上述边界做总结，不新增确认。", [], { modelCall: async () => { throw new Error("unnecessary_model_call"); } });
    expect(reply.claims.some(row => row.text.includes("交付实验记录"))).toBe(true); expect(reply.profile).toBeUndefined();
  });

  it("keeps an explicitly old non-self quotation out of current personal facts", async () => {
    const text = "以下引号内容不是本人事实：“我已经精通编程。”";
    expect(isQuotedProfileContextOnlyV7(text)).toBe(true);
    const profile = createStudentProfileV7(student());
    const reply = await draftDecisionChatV7({ profile }, text, [], { modelCall: async () => { throw new Error("unnecessary_model_call"); } });
    expect(reply.profile).toBeUndefined(); expect(reply.message).toContain("未作为本人的新事实");
    expect(isQuotedProfileContextOnlyV7("我不会编程。" + text)).toBe(false);
    expect(isQuotedProfileContextOnlyV7("下面引用笔记：“我会编程。”")).toBe(false);
  });
});

it("withdraws all facets of one source-bound assertion while preserving independent facts and the main goal", async () => {
  const legacy = student(), text = "我愿意协助一次观察记录；地点仅限校内；主要目标是完成实训报告。";
  const profile = applySelfReportedFactsV7(createStudentProfileV7(legacy), { facts: [fact("help.willingness", true, "我愿意协助一次观察记录"), fact("help.task", "观察记录", "我愿意协助一次观察记录"), fact("help.frequency", "一次", "我愿意协助一次观察记录"), fact("help.location", "校内", "地点仅限校内"), fact("primaryGoal", "完成实训报告", "主要目标是完成实训报告")], unknownFields: [] }, source(text), legacy);
  const withdrawal = "撤回刚才的协助承诺；并没有撤回关于主要目标和其他事实的陈述。";
  const reply = await draftDecisionChatV7({ profile, legacy }, withdrawal, [], { ...source(withdrawal, "withdrawal"), modelCall: async () => success([fact("help.willingness", true, "撤回刚才的协助承诺", "retracted")]) });
  expect(reply.profile?.facts.filter(row => ["help.willingness", "help.task", "help.frequency"].includes(row.field))).toEqual([]);
  expect(reply.profile?.facts.find(row => row.field === "help.location")?.value).toBe("校内");
  expect(reply.profile?.primaryGoal).toBe("完成实训报告");
  expect(reply.profile?.updates?.at(-1)?.removedFactIds).toHaveLength(3);
});

it("does not cascade a field-level withdrawal across a compound or independently sourced assertion", () => {
  const legacy = student(), text = "我愿意观察，也愿意归档。";
  const profile = applySelfReportedFactsV7(createStudentProfileV7(legacy), { facts: [fact("help.first", "观察", text), fact("help.second", "归档", text)], unknownFields: [] }, source(text), legacy);
  const withdrawal = "撤回观察部分。";
  const next = applySelfReportedFactsV7(profile, { facts: [fact("help.first", "观察", withdrawal, "retracted")], unknownFields: [] }, source(withdrawal, "withdraw-first"), legacy);
  expect(next.facts.find(row => row.field === "help.second")?.value).toBe("归档");
});

describe("typed reported provenance beside an independent negative status", () => {
  it("preserves the reported words and the separate absence of a written arrangement", async () => {
    const text = "老师说再商量，没有书面承担安排。";
    const reply = await draftDecisionChatV7({ profile: createStudentProfileV7(student()) }, text, [], { ...source(text), modelCall: async () => success([
      fact("quoted.teacher.nextStep", "再商量", "老师说再商量"), fact("budget_responsibility", "书面承担安排", "没有书面承担安排", "negated"),
    ]) });
    expect(reply.profile?.facts.find(row => row.field === "quoted.teacher.nextStep")).toMatchObject({ originalText: "老师说再商量", value: "再商量" });
    expect(reply.profile?.facts.find(row => row.field === "budget_responsibility")).toMatchObject({ state: "negated", originalText: "没有书面承担安排" });
  });

  it.each([
    ["朋友说会编程，我会Python。", "我会Python", "skills", "affirmed"],
    ["老师说，没有书面承担安排。", "没有书面承担安排", "budget_responsibility", "negated"],
    ["老师说再商量，我没有独立完成项目。", "我没有独立完成项目", "experience.1.contribution", "negated"],
  ] as const)("does not turn reported or personal-ability material into self evidence: %s", async (text, quote, field, state) => {
    const reported = text.split("，")[0];
    const reply = await draftDecisionChatV7({ profile: createStudentProfileV7(student()) }, text, [], { ...source(text), modelCall: async () => success([
      fact("quoted.speaker.statement", "reported", reported), fact(field, "programming", quote, state),
    ]) });
    expect(reply.profile).toBeUndefined(); expect(reply.message).toContain("暂未解析成功");
  });
});

it("does not expand a field-only withdrawal just because two facts share a quote and namespace", () => {
  const legacy = student(), text = "联系标签含姓名及年级。";
  const profile = applySelfReportedFactsV7(createStudentProfileV7(legacy), { facts: [fact("contact.label", "甲", text), fact("contact.year", "大二", text)], unknownFields: [] }, source(text), legacy);
  const withdrawal = "撤回联系标签。";
  const next = applySelfReportedFactsV7(profile, { facts: [fact("contact.label", "甲", withdrawal, "retracted")], unknownFields: [] }, source(withdrawal, "withdraw-label"), legacy);
  expect(next.facts.find(row => row.field === "contact.year")?.value).toBe("大二");
});
