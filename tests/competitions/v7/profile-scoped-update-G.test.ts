import { describe, expect, it } from "vitest";
import type { AiJsonResult } from "@/lib/ai/ai-client";
import { applySelfReportedFactsV7, createStudentProfileV7, validateSelfReportedExtractionV7 } from "@/lib/competitions/v7/profile";
import { draftDecisionChatV7, extractSelfReportedFactsV7 } from "@/lib/competitions/v7/chat";
import { isProfileControlClauseV7 } from "@/lib/competitions/v7/corrections";
import { studentLearningOptionsV7 } from "@/lib/competitions/v7/match-learning-selection";
import type { DomainFact } from "@/lib/competitions/v6/domain-facts";
import { student } from "../v6/decision-fixtures";

const fact = (field: string, value: DomainFact["value"], sourceText: string, state: DomainFact["state"] = "affirmed"): DomainFact => ({ field, value, sourceText, state, evidenceLevel: "self_report", confirmed: false });
const source = (text: string, answerId = "scoped-update") => ({ text, answerId, at: "2026-11-09T00:00:00+08:00" });
const success = (data: unknown): AiJsonResult<unknown> => ({ ok: true, data, model: "offline-actual-replay", upstreamAttempted: true, finishReason: "stop", attempts: 1, httpStatus: 200, durationMs: 1 });
const extract = (text: string, facts: DomainFact[]) => validateSelfReportedExtractionV7(text, { facts, unknownFields: [] }, { confirmedSelection: true });

describe("independent completed reservations and unchanged values", () => {
  it("keeps the planned budget separate from an already reserved room, then only corrects the budget", async () => {
    const legacy = student(), initial = createStudentProfileV7(legacy);
    const first = "计划耗材预算369元，已经预约的会议室号码是47。";
    const profile = applySelfReportedFactsV7(initial, { facts: [fact("materials_budget", "369元", "计划耗材预算369元"), fact("room_number", "47", "已经预约的会议室号码是47")], unknownFields: [] }, source(first, "room-first"), legacy);
    const room = profile.facts.find(row => row.field === "room_number")!, budget = profile.facts.find(row => row.field === "materials_budget")!;
    expect(room).toMatchObject({ state: "affirmed", confirmed: true });
    expect(budget).toMatchObject({ state: "conditional", confirmed: false });
    const text = "明确一下：只把材料预算改成409元，会议室号码没变。";
    const reply = await draftDecisionChatV7({ profile, legacy }, text, [], { ...source(text, "room-second"), modelCall: async () => success({ facts: [fact("materials_budget", "409元", "只把材料预算改成409元"), fact("room_number", "未变", "会议室号码没变")], unknownFields: [], unresolvedAssertions: [] }) });
    expect(reply.profile?.facts.find(row => row.field === "room_number")).toEqual(room);
    expect(reply.profile?.facts.find(row => row.field === "materials_budget")).toMatchObject({ value: "409元", state: "affirmed" });
    expect(reply.profile?.updates?.at(-1)?.removedFactIds).toEqual([budget.id]);
    expect(reply.profile?.retractedFactIds).not.toContain(room.id);
  });

  it.each([
    ["如果计划耗材预算369元，已经预约的会议室号码是47。", "已经预约的会议室号码是47"],
    ["计划预算369元，已经预约的会议室号码是47，但这也只是计划。", "已经预约的会议室号码是47"],
    ["计划已经预约的会议室号码是47。", "计划已经预约的会议室号码是47"],
  ])("does not remove a condition or following qualification: %s", (text, quote) => {
    expect(extract(text, [fact("room_number", "47", quote)]).facts[0]).toMatchObject({ state: "conditional", confirmed: false });
  });

  it("does not upgrade a provider's explicitly conditional reservation", () => {
    const text = "计划耗材预算369元，已经预约的会议室号码是47。";
    expect(extract(text, [fact("room_number", "47", "已经预约的会议室号码是47", "conditional")]).facts[0].state).toBe("conditional");
  });

  it.each(["skills", "experience.1.contribution"])("keeps the original plan checks for personal ability or contribution: %s", field => {
    const text = "计划耗材预算369元，已经预约的会议室号码是47。";
    expect(extract(text, [fact(field, "47", "已经预约的会议室号码是47")]).facts[0].state).toBe("conditional");
  });

  it("retains reported-speaker attribution", () => {
    const text = "朋友说，计划耗材预算369元，已经预约的会议室号码是47。";
    expect(() => extract(text, [fact("room_number", "47", "已经预约的会议室号码是47")])).toThrow("quoted_other_person_is_not_self_evidence");
  });

  it.each(["如果会议室号码没变", "老师说会议室号码没变", "会议室号码是否没变？", "样本颜色没变", "会议室号码改为48而非没变"])("does not treat another assertion as a retention control: %s", clause => {
    expect(isProfileControlClauseV7(clause)).toBe(false);
  });

  it("keeps an unchanged-only request on the existing no-model path", async () => {
    const legacy = student(), profile = createStudentProfileV7(legacy);
    let calls = 0;
    const reply = await draftDecisionChatV7({ profile, legacy }, "会议室号码没变。", [], { modelCall: async () => { calls++; throw new Error("unnecessary_extract"); } });
    expect(calls).toBe(0); expect(reply.profile).toBeUndefined();
  });
});

describe("canonical Unicode provenance", () => {
  it("restores the original NFD quotation and exact source span while preserving negation", () => {
    const text = "我获准仅在课堂项目使用A\u030angstro\u0308m测量台，没有商业使用许可。";
    const facts = [fact("software_name", "Ångström测量台", "使用Ångström测量台"), fact("software_permission", "仅课堂项目使用", "我获准仅在课堂项目使用Ångström测量台"), fact("software_permission", "商业使用许可", "没有商业使用许可", "negated")];
    const legacy = student(), next = applySelfReportedFactsV7(createStudentProfileV7(legacy), { facts, unknownFields: [] }, source(text), legacy);
    for (const row of next.facts.filter(row => row.answerId === "scoped-update")) expect(text.slice(row.sourceSpan!.start, row.sourceSpan!.end)).toBe(row.originalText);
    expect(next.facts.find(row => row.field === "software_name")?.originalText).toBe("使用A\u030angstro\u0308m测量台");
    expect(next.facts.find(row => row.field === "software_permission" && row.value === "商业使用许可")?.state).toBe("negated");
  });

  it.each([
    ["使用Ａ测量台。", "使用A测量台"],
    ["使用Ångström测量台。", "使用ångström测量台"],
    ["没有商业使用许可。", "已获商业使用许可"],
  ])("still rejects a compatibility, case or meaning change: %s", (text, quote) => {
    expect(() => extract(text, [fact("software_name", "test", quote)])).toThrow("extraction_quote_not_in_utterance");
  });
});

describe("explicit main goal metadata and own-profile summaries", () => {
  it.each([
    ["primaryGoal", "我的首要目标是练习用删除操作核对子序列", "练习用删除操作核对子序列", "打算先做两个小例子"],
    ["goal.description", "目前的主要目标是核对采样记录", "核对采样记录", "我计划先整理一张表"],
  ])("keeps an independent current %s beside a separate action plan", (field, quote, value, action) => {
    const legacy = student(), text = `${quote}，${action}。`;
    const checked = extract(text, [fact(field, value, quote)]);
    expect(checked.facts[0]).toMatchObject({ state: "affirmed", confirmed: true, sourceText: quote });
    const next = applySelfReportedFactsV7(createStudentProfileV7(legacy), checked, source(text), legacy);
    expect(next.primaryGoal).toBe(value);
    const choices = studentLearningOptionsV7(next);
    expect(choices.goals).toEqual([{ index: 0, text: value }]);
    expect(choices.facts.length).toBeGreaterThan(0);
    for (const choice of choices.facts) {
      const row = next.facts.find(candidate => candidate.id === choice.id)!;
      expect(["primaryGoal", "goal.description"]).toContain(row.field);
      expect(row).toMatchObject({ originalText: quote, evidenceLevel: "self_report" });
      expect(text.slice(row.sourceSpan!.start, row.sourceSpan!.end)).toBe(quote);
    }
  });

  const ownGoalQuote = "我的首要目标是练习用删除操作核对子序列";
  const ownGoalValue = "练习用删除操作核对子序列";
  it.each([
    [`如果有导师，${ownGoalQuote}，打算先做两个小例子。`, ownGoalQuote, ownGoalValue],
    [`${ownGoalQuote}，打算先做两个小例子，如果能借到设备。`, ownGoalQuote, ownGoalValue],
    ["我的首要目标是只有导师同意才练习数据清洗，打算先问导师。", "我的首要目标是只有导师同意才练习数据清洗", "只有导师同意才练习数据清洗"],
    [`${ownGoalQuote}，打算先做两个小例子；之后再决定是否保留这个目标。`, ownGoalQuote, ownGoalValue],
    [`以下只是旧笔记：“${ownGoalQuote}，打算先做两个小例子。”`, ownGoalQuote, ownGoalValue],
    ["我打算以后学会核对子序列。", "我打算以后学会核对子序列", "学会核对子序列"],
    [`${ownGoalQuote}，打算先做两个小例子。`, ownGoalQuote, "做两个小例子"],
    [`${ownGoalQuote}，打算先做两个小例子。`, `${ownGoalQuote}，打算先做两个小例子`, "做两个小例子"],
    [`${ownGoalQuote}，打算先做小例子再决定是否保留这个目标。`, ownGoalQuote, ownGoalValue],
  ])("does not upgrade a conditional, quoted or misattributed goal: %s", (text, quote, value) => {
    const legacy = student(), checked = extract(text, [fact("primaryGoal", value, quote)]);
    expect(checked.facts[0]).toMatchObject({ state: "conditional", confirmed: false });
    const next = applySelfReportedFactsV7(createStudentProfileV7(legacy), checked, source(text), legacy);
    expect(next.primaryGoal).toBeNull();
    expect(studentLearningOptionsV7(next)).toEqual({ facts: [], goals: [] });
  });

  it("keeps third-person attribution and an explicit goal denial", () => {
    expect(() => extract(`同学说：“${ownGoalQuote}，打算先做两个小例子。”`, [fact("primaryGoal", ownGoalValue, ownGoalQuote)]))
      .toThrow("quoted_other_person_is_not_self_evidence");
    const legacy = student(), quote = `我的首要目标不是${ownGoalValue}`, text = `${quote}，打算先了解其他方向。`;
    const checked = extract(text, [fact("primaryGoal", ownGoalValue, quote, "negated")]);
    expect(checked.facts[0].state).toBe("negated");
    const next = applySelfReportedFactsV7(createStudentProfileV7(legacy), checked, source(text), legacy);
    expect(next.primaryGoal).toBeNull();
    expect(studentLearningOptionsV7(next)).toEqual({ facts: [], goals: [] });
  });

  it.each(["skills", "experience.1.contribution", "equipment.access"])("does not apply the goal exception to %s", field => {
    const text = `${ownGoalQuote}，打算先做两个小例子。`;
    expect(extract(text, [fact(field, ownGoalValue, ownGoalQuote)]).facts[0]).toMatchObject({ state: "conditional", confirmed: false });
  });

  it("keeps an explicit main goal from an open description in canonical metadata and preserves withdrawal", () => {
    const legacy = student(), profile = createStudentProfileV7(legacy), text = "主要目标是保留真实失败和改进记录。";
    const next = applySelfReportedFactsV7(profile, { facts: [fact("goal.description", "保留真实失败和改进记录", text)], unknownFields: [] }, source(text), legacy);
    expect(next.primaryGoal).toBe("保留真实失败和改进记录");
    expect(next.facts.find(row => row.field === "goal.description")?.originalText).toBe(text);
    expect(next.facts.find(row => row.field === "primaryGoal")?.originalText).toBe(text);
    const withdrawal = "撤回主要目标的自述。";
    const retracted = applySelfReportedFactsV7(next, { facts: [fact("goal.description", "保留真实失败和改进记录", withdrawal, "retracted")], unknownFields: [] }, source(withdrawal, "goal-withdrawn"), legacy);
    expect(retracted.primaryGoal).toBeNull();
    expect(retracted.facts.some(row => row.field === "primaryGoal")).toBe(false);
  });

  it.each(["次要愿望是保留改进记录。", "如果将来有时间，主要目标是保留改进记录。"])("does not promote a secondary or conditional goal: %s", text => {
    const legacy = student(), next = applySelfReportedFactsV7(createStudentProfileV7(legacy), { facts: [fact("goal.description", "保留改进记录", text)], unknownFields: [] }, source(text), legacy);
    expect(next.facts.some(row => row.field === "primaryGoal")).toBe(false);
  });

  it("summarizes only the current own file without extracting other-student profile context", async () => {
    const legacy = student(); let profile = createStudentProfileV7(legacy);
    for (const [index, text] of ["我的主要目标是改进试验复现。", "更正主要目标为交付复现实验记录。"].entries()) profile = applySelfReportedFactsV7(profile, { facts: [fact("primaryGoal", index ? "交付复现实验记录" : "改进试验复现", text)], unknownFields: [] }, source(text, `goal-${index}`), legacy);
    const text = "另一位同学的档案里写先修复依赖环境；请只总结我这份档案。";
    let calls = 0;
    const reply = await draftDecisionChatV7({ profile, legacy }, text, [], { ...source(text, "summary"), modelCall: async () => { calls++; return success({ facts: [fact("other.student.profile.content", "先修复依赖环境", "另一位同学的档案里写先修复依赖环境")], unknownFields: [], unresolvedAssertions: [] }); } });
    const displayed = reply.claims.map(row => row.text).join("\n");
    expect(calls).toBe(0); expect(displayed).toContain("交付复现实验记录");
    expect(displayed).not.toContain("先修复依赖环境"); expect(displayed).not.toContain("改进试验复现");
    expect(reply.profile).toBeUndefined();
    expect(reply.claims.every(row => row.studentFactIds.every(id => profile.facts.some(fact => fact.id === id && !fact.field.startsWith("other."))))).toBe(true);
  });

  it("can summarize existing unknown and conditional self reports without a model or a report", async () => {
    const legacy = student(), text = "我不确定参观权限；计划下周借设备。";
    const profile = applySelfReportedFactsV7(createStudentProfileV7(legacy), { facts: [fact("visit.permission", "unknown", "我不确定参观权限", "unknown"), fact("equipment.access", "计划下周借设备", "计划下周借设备", "conditional")], unknownFields: [] }, source(text), legacy);
    const reply = await draftDecisionChatV7({ profile, legacy }, "只总结我这份档案。", [], { modelCall: async () => { throw new Error("unnecessary_model_call"); } });
    expect(reply.profile).toBeUndefined();
    expect(reply.claims.some(row => row.text.startsWith("尚不确定："))).toBe(true);
    expect(reply.claims.some(row => row.text.startsWith("条件计划："))).toBe(true);
  });
});

it("passes the existing shorter outer deadline alongside the profile-only 45-second transport maximum", async () => {
  const deadlineEpochMs = Date.now() + 5_000;
  await extractSelfReportedFactsV7({ utterance: "材料仅限校内。", requestedFields: ["material.scope"] }, { deadlineEpochMs, modelCall: async (_prompt, options) => {
    expect(options).toMatchObject({ operation: "competition_v7_extract", timeoutMs: 45_000, deadlineEpochMs, thinking: "enabled", reasoningEffort: "high", maxAttempts: 1 });
    return success({ facts: [fact("material.scope", "school", "材料仅限校内")], unknownFields: [], unresolvedAssertions: [] });
  } });
});
