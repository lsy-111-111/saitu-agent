import { describe, expect, it } from "vitest";
import { createStudentProfileV7, applySelfReportedFactsV7, applyProfileMutationsV7 } from "@/lib/competitions/v7/profile";
import { applyExplicitCorrectionV7 } from "@/lib/competitions/v7/corrections";
import { draftDecisionChatV7 } from "@/lib/competitions/v7/chat";
import { normalizeCompetitionQuestionnaire, confirmCompetitionQuestionnaire } from "@/lib/ai/competition-questionnaire";
import { student } from "../v6/decision-fixtures";

const legacy = student({ confirmedFields: ["stage", "skills", "weeklyCommitment"], skills: ["design", "programming"], weeklyCommitment: "5-10" });
const profile = () => createStudentProfileV7(legacy);
const source = (text: string) => ({ answerId: "self-report-answer", text, at: "2026-11-09T00:00:00.000Z" });

describe("v7 immediate self-report adoption", () => {
  it("uses submitted ability without requiring a concrete experience or another confirmation", () => {
    const text = "我会做数据分析。";
    const next = applySelfReportedFactsV7(profile(), { facts: [{ field: "skills", value: "data-analysis", state: "affirmed", evidenceLevel: "self_report", confirmed: false, sourceText: text }], unknownFields: [] }, source(text), legacy);
    expect(next.facts.find(fact => fact.value === "data-analysis")).toMatchObject({ confirmed: true, evidenceLevel: "self_report", originalText: text });
    expect(next.facts.filter(fact => fact.field === "skills").map(fact => fact.value)).toEqual(["design", "programming", "data-analysis"]);
  });
  it("does not turn an interest into an ability", () => {
    const text = "我对编程感兴趣，想学。";
    expect(() => applySelfReportedFactsV7(profile(), { facts: [{ field: "skills", value: "programming", state: "affirmed", evidenceLevel: "self_report", confirmed: false, sourceText: text }], unknownFields: [] }, source(text), legacy)).toThrow("interest_cannot_become_ability");
  });
  it("keeps conditional plans separate from an existing current ability", () => {
    const text = "如果以后有时间，我计划学编程。";
    const next = applySelfReportedFactsV7(profile(), { facts: [{ field: "skills", value: "programming", state: "conditional", evidenceLevel: "self_report", confirmed: false, sourceText: text }], unknownFields: [] }, source(text), legacy);
    expect(next.facts.filter(fact => fact.field === "skills" && fact.value === "programming").map(fact => fact.state)).toEqual(["affirmed", "conditional"]);
  });
  it("adopts unknown and negated facts without manufacturing positive ability", () => {
    const text = "我不会编程，也不确定能投入多少时间。";
    const next = applySelfReportedFactsV7(profile(), { facts: [{ field: "skills", value: "programming", state: "negated", evidenceLevel: "self_report", confirmed: false, sourceText: "我不会编程" }, { field: "weeklyCommitment", value: "unknown", state: "unknown", evidenceLevel: "unknown", confirmed: false, sourceText: "不确定能投入多少时间" }], unknownFields: ["weeklyCommitment"] }, source(text), legacy);
    expect(next.facts.find(fact => fact.value === "programming")).toMatchObject({ state: "negated", confirmed: true });
    expect(next.facts.find(fact => fact.value === "design")?.state).toBe("affirmed");
    expect(next.unknownFields).toContain("weeklyCommitment");
  });
  it("keeps exact hours and their legacy bucket coherent after extraction and a later bucket edit", () => {
    const text = "我每周能投入3小时。";
    const next = applySelfReportedFactsV7(profile(), { facts: [{ field: "weeklyHours", value: 3, state: "affirmed", evidenceLevel: "self_report", confirmed: false, sourceText: text }], unknownFields: [] }, source(text), legacy);
    expect(next.facts.filter(fact => fact.field === "weeklyCommitment").map(fact => fact.value)).toEqual(["under-5"]);
    const changed = "更正为每周10小时以上";
    const updated = applyProfileMutationsV7(next, [{ operation: "set", field: "weeklyCommitment", value: "over-10", quote: changed, targetFactIds: [] }], { ...source(changed), answerId: "new-bucket" }, legacy);
    expect(updated.facts.some(fact => fact.field === "weeklyHours")).toBe(false);
    expect(updated.retractedFactIds).toContain(next.facts.find(fact => fact.field === "weeklyHours")!.id);
  });
  it("lets explicit unknown hours replace both old representations without becoming zero", () => {
    const text = "现在不确定每周能投入多少时间。";
    const next = applySelfReportedFactsV7(profile(), { facts: [{ field: "weeklyHours", value: "unknown", state: "unknown", evidenceLevel: "unknown", confirmed: false, sourceText: text }], unknownFields: ["weeklyHours"] }, source(text), legacy);
    expect(next.facts.find(fact => fact.field === "weeklyHours")).toMatchObject({ value: "unknown", state: "unknown", confirmed: false });
    expect(next.facts.filter(fact => fact.field === "weeklyCommitment").map(fact => fact.state)).toEqual(["unknown"]);
  });
  it("preserves a team maximum without relabeling it as a personal spending cap", () => {
    const next = createStudentProfileV7(student({ decisionContext: { budget: { range: "under100", maximumYuan: 100, scope: "team" } } }));
    expect(next.facts.some(fact => fact.field === "budget.maximumYuan")).toBe(false);
    expect(next.facts.find(fact => fact.field === "budget.teamMaximumYuan")).toMatchObject({ value: 100, state: "affirmed" });
  });
});

describe("v7 clear correction and ambiguity", () => {
  it("applies 8-to-3 hours immediately and retains exact new hours plus the original wording", () => {
    const text = "更正一下，每周时间从8小时改为3小时。";
    const next = applyExplicitCorrectionV7(profile(), text, legacy, { answerId: "hours-change", at: source(text).at });
    expect(next.kind).toBe("applied");
    expect(next.profile.facts.find(fact => fact.field === "weeklyHours")).toMatchObject({ value: 3, originalText: text });
    expect(next.profile.facts.filter(fact => fact.field === "weeklyCommitment").map(fact => fact.value)).toEqual(["under-5"]);
    expect(next.profile.revision).not.toBe(profile().revision);
    expect(next.profile.retractedFactIds).toContain(profile().facts.find(fact => fact.field === "weeklyCommitment")!.id);
  });
  it("asks only for a genuinely ambiguous time value", () => {
    expect(applyExplicitCorrectionV7(profile(), "每周可能3小时或者8小时。", legacy).kind).toBe("clarification");
    expect(applyExplicitCorrectionV7(profile(), "如果每周只有3小时，怎么准备？", legacy).kind).toBe("none");
  });
  it("immediately removes a denied ability while preserving the other self-reported skills", () => {
    const next = applyExplicitCorrectionV7(profile(), "其实我不会编程。", legacy);
    expect(next.kind).toBe("applied");
    expect(next.profile.facts.find(fact => fact.value === "programming")?.state).toBe("negated");
    expect(next.profile.facts.find(fact => fact.value === "design")?.state).toBe("affirmed");
  });
  it("adopts all clear corrections in one turn with one provenance update", () => {
    const text = "更正一下，每周从8小时改为3小时，个人预算改为99.5元；我不会编程，但我会设计和写作。";
    const next = applyExplicitCorrectionV7(profile(), text, legacy, { answerId: "multi-field", at: source(text).at });
    expect(next.kind).toBe("applied");
    expect(next.profile.facts.find(fact => fact.field === "weeklyHours")?.value).toBe(3);
    expect(next.profile.facts.find(fact => fact.field === "budget.maximumYuan")?.value).toBe(99.5);
    expect(next.profile.facts.find(fact => fact.value === "programming")?.state).toBe("negated");
    expect(next.profile.facts.find(fact => fact.value === "design")?.state).toBe("affirmed");
    expect(next.profile.facts.find(fact => fact.value === "writing")?.state).toBe("affirmed");
    expect(next.profile.updates).toHaveLength(1);
    expect(next.profile.updates?.[0].originalText).toBe(text);
  });
  it("withdraws a skill assertion without asserting that the student cannot do it", () => {
    const next = applyExplicitCorrectionV7(profile(), "撤回编程能力的自述。", legacy);
    expect(next.kind).toBe("applied");
    expect(next.profile.facts.some(fact => fact.field === "skills" && fact.value === "programming")).toBe(false);
    expect(next.profile.retractedFactIds).toContain(profile().facts.find(fact => fact.value === "programming")!.id);
  });
  it("can withdraw a numeric limit without supplying a replacement number", () => {
    const initial = student({ decisionContext: { budget: { range: "under100", scope: "personal", maximumYuan: 100 } } });
    const next = applyExplicitCorrectionV7(createStudentProfileV7(initial), "撤回我的预算限制。", initial);
    expect(next.kind).toBe("applied");
    expect(next.profile.facts.some(fact => fact.field.startsWith("budget"))).toBe(false);
  });
  it("lets chat use a clear self report without a paid model call", async () => {
    const reply = await draftDecisionChatV7({ profile: profile(), legacy }, "我会Python。", [], { modelCall: async () => { throw new Error("unnecessary_call"); } });
    expect(reply.profile?.facts.find(fact => fact.value === "programming")).toMatchObject({ state: "affirmed", evidenceLevel: "self_report" });
  });
  it("withdraws a concrete experience and its dependent contribution", () => {
    const withExperience = student({ decisionContext: { experiences: [{ id: "one", task: "清理数据并写报告", contribution: "independent", completion: "delivered", challenge: "", confirmed: false }] } });
    const old = createStudentProfileV7(withExperience);
    const next = applyExplicitCorrectionV7(old, "撤回第一段经历。", withExperience);
    expect(next.kind).toBe("applied");
    expect(next.profile.facts.some(fact => fact.field.startsWith("experience.1."))).toBe(false);
  });
  it("adopts an unambiguous questionnaire text answer while keeping legacy normalization readable", () => {
    const questionnaire = { version: "competition-questionnaire.v1", answers: [{ fieldId: "stage", selectedValues: ["stage:undergraduate-1"] }, { fieldId: "skills", selectedValues: [], freeText: "programming" }] };
    const old = normalizeCompetitionQuestionnaire(questionnaire);
    const next = normalizeCompetitionQuestionnaire(questionnaire, { policy: "v7" });
    expect(old.ok && old.interpretations.find(item => item.fieldId === "skills")?.requiresConfirmation).toBe(true);
    expect(next.ok && next.interpretations.find(item => item.fieldId === "skills")?.requiresConfirmation).toBe(false);
    expect(next.ok && confirmCompetitionQuestionnaire(next.interpretations, []).ok).toBe(true);
  });
});
