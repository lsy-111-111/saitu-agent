import { describe, expect, it } from "vitest";
import { draftDecisionChatV7 } from "@/lib/competitions/v7/chat";
import { applySelfReportedFactsV7, createStudentProfileV7 } from "@/lib/competitions/v7/profile";
import { projectProfileToLegacy } from "@/lib/competitions/v6/profile";
import type { DomainFact } from "@/lib/competitions/v6/domain-facts";
import { buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import { student } from "../v6/decision-fixtures";

const fact = (field: string, value: DomainFact["value"], sourceText: string, state: DomainFact["state"] = "affirmed"): DomainFact => ({ field, value, sourceText, state, evidenceLevel: "self_report", confirmed: false });
const source = (text: string, at = "2026-11-09T00:00:00+08:00") => ({ answerId: "actual-adoption-regression", text, at });

it.each([
  ["2026-11-09T00:00:00+08:00", "2026-11-08T16:00:00.000Z"],
  ["2026-11-09T00:00:00-05:00", "2026-11-09T05:00:00.000Z"],
])("adopts an offset timestamp at the same instant: %s", (at, utc) => {
  const legacy = student(), profile = createStudentProfileV7(legacy), text = "材料仅限校内。";
  const next = applySelfReportedFactsV7(profile, { facts: [fact("material.scope", "school", text)], unknownFields: [] }, source(text, at), legacy);
  expect(next.facts.find(row => row.field === "material.scope")).toMatchObject({ updatedAt: utc, originalText: text, confirmed: true });
  expect(next.updates?.at(-1)).toMatchObject({ updatedAt: utc, originalText: text });
});

it("continues to reject an invalid timestamp before changing a profile", () => {
  const legacy = student(), profile = createStudentProfileV7(legacy), before = structuredClone(profile), text = "材料仅限校内。";
  expect(() => applySelfReportedFactsV7(profile, { facts: [fact("material.scope", "school", text)], unknownFields: [] }, source(text, "invalid-time"), legacy)).toThrow("invalid_profile_source");
  expect(profile).toEqual(before);
});

it("adopts a stage-free canonical submission through the chat path with an offset timestamp", async () => {
  const legacy = student(), profile = { ...createStudentProfileV7(legacy), facts: [], goals: [], primaryGoal: null, unknownFields: ["laboratory_access", "primaryGoal"] };
  const text = "实验室目前只允许参观。主要目标是整理可交付的验证报告。";
  let calls = 0;
  const reply = await draftDecisionChatV7({ profile }, text, [], { ...source(text), modelCall: async () => {
    calls++;
    return { ok: true, data: { facts: [fact("laboratory_access", "只允许参观", "实验室目前只允许参观"), fact("primaryGoal", "整理可交付的验证报告", "主要目标是整理可交付的验证报告")], unknownFields: [], unresolvedAssertions: [] }, model: "offline-actual-replay", upstreamAttempted: true, finishReason: "stop", attempts: 1, httpStatus: 200, durationMs: 1 };
  } });
  expect(calls).toBe(1);
  expect(reply.profile?.facts).toHaveLength(2);
  expect(reply.profile?.primaryGoal).toBe("整理可交付的验证报告");
  expect(reply.profile?.updates?.[0].updatedAt).toBe("2026-11-08T16:00:00.000Z");
});

describe("v7 open facts and the narrower legacy compatibility view", () => {
  it("keeps the corrected own and team contributions, retracts independent work, and builds a fresh context", () => {
    const legacy = student({ decisionContext: { experiences: [{ id: "one", task: "整理实验数据并写了课程报告", contribution: "independent", completion: "delivered", challenge: "", confirmed: true }] } });
    const profile = createStudentProfileV7(legacy), previous = profile.facts.find(row => row.field === "experience.1.contribution")!;
    const text = "更正：实验和数据分析都是队友做的，我本人只帮忙整理资料。请撤回我独立完成实验或数据分析的说法，重新匹配。";
    const next = applySelfReportedFactsV7(profile, { facts: [
      fact("experience.1.teamContribution", "experiment-and-data-analysis", "实验和数据分析都是队友做的"),
      fact("experience.1.contribution", "organizing-materials-only", "我本人只帮忙整理资料"),
      fact("experience.1.contribution", "independent", "请撤回我独立完成实验或数据分析的说法", "retracted"),
    ], unknownFields: [] }, source(text), legacy);
    expect(next.facts.find(row => row.field === "experience.1.contribution")).toMatchObject({ value: "organizing-materials-only", originalText: "我本人只帮忙整理资料" });
    expect(next.facts.find(row => row.field === "experience.1.teamContribution")).toMatchObject({ originalText: "实验和数据分析都是队友做的" });
    expect(next.retractedFactIds).toContain(previous.id);
    expect(next.facts.some(row => row.id === previous.id)).toBe(false);
    const compatible = projectProfileToLegacy(next, legacy, { openDomain: true });
    expect(compatible.decisionContext?.experiences).toEqual([]);
    expect(compatible.decisionContext?.experienceRole).toBeUndefined();
    const context = buildDecisionContextV7(compatible, { profile: next, records: [] });
    expect(context.profile).toEqual(next);
    expect(() => projectProfileToLegacy(next, legacy)).toThrow();
  });

  it("preserves an explicit main goal alongside its broad category without inventing a legacy goal enum", () => {
    const legacy = student(), profile = createStudentProfileV7(legacy), text = "我的主要目标是为后续项目做好权限记录。";
    const next = applySelfReportedFactsV7(profile, { facts: [fact("primaryGoal", "为后续项目做好权限记录", text), fact("goalIntent", "project", text), fact("goalResolution", "confirmed", text)], unknownFields: [] }, source(text), legacy);
    expect(next.primaryGoal).toBe("为后续项目做好权限记录");
    expect(next.facts.find(row => row.field === "primaryGoal")).toMatchObject({ value: next.primaryGoal, originalText: text });
    expect(projectProfileToLegacy(next, legacy, { openDomain: true }).decisionContext?.goalIntent).toBe("project");
    const onlyMain = applySelfReportedFactsV7(profile, { facts: [fact("primaryGoal", "为后续项目做好权限记录", text)], unknownFields: [] }, source(text), legacy);
    expect(projectProfileToLegacy(onlyMain, legacy, { openDomain: true }).decisionContext?.primaryGoal).toBeUndefined();
    expect(onlyMain.primaryGoal).toBe("为后续项目做好权限记录");
  });
});

describe("independent own permission restrictions after a reported claim", () => {
  const text = "朋友说他可以把项目文件公开，那是他的项目，不能替代我的许可。";
  it.each([
    ["permission.selfConsentRequired", "affirmed"],
    ["user.projectFile.disclosure.friendPermissionSubstitutesMyPermission", "negated"],
    ["projectFilesPublic.requiresMyPermission", "affirmed"],
  ] as const)("preserves the own boundary and the other person's provenance: %s", (field, state) => {
    const legacy = student(), profile = createStudentProfileV7(legacy);
    const next = applySelfReportedFactsV7(profile, { facts: [
      fact("other.friend.publicationClaim", "可以把项目文件公开", "朋友说他可以把项目文件公开"),
      fact("other.friend.projectOwnership", "friend", "那是他的项目"),
      fact(field, true, "不能替代我的许可", state),
    ], unknownFields: [] }, source(text), legacy);
    expect(next.facts.find(row => row.field === field)).toMatchObject({ state, value: true, originalText: "不能替代我的许可" });
    expect(next.facts.find(row => row.field === "other.friend.publicationClaim")).toMatchObject({ originalText: "朋友说他可以把项目文件公开" });
    expect(next.facts.some(row => row.field === "skills")).toBe(false);
  });

  it.each([
    ["朋友说我有公开许可。", "朋友说我有公开许可", "permission.selfConsentRequired"],
    ["朋友说，不能替代我的许可。", "不能替代我的许可", "permission.selfConsentRequired"],
    ["朋友说：“不能替代我的许可。”", "不能替代我的许可", "permission.selfConsentRequired"],
    [text, "不能替代我的许可", "skills"],
    [text, "不能替代我的许可", "experience.1.contribution"],
  ])("continues to reject a quoted or personal-ability attribution: %s", (utterance, quote, field) => {
    const legacy = student(), profile = createStudentProfileV7(legacy);
    expect(() => applySelfReportedFactsV7(profile, { facts: [fact(field, true, quote)], unknownFields: [] }, source(utterance), legacy)).toThrow("quoted_other_person_is_not_self_evidence");
  });
});
