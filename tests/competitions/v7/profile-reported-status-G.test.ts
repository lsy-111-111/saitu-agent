import { describe, expect, it } from "vitest";
import type { AiJsonResult } from "@/lib/ai/ai-client";
import type { DomainFact } from "@/lib/competitions/v6/domain-facts";
import { draftDecisionChatV7 } from "@/lib/competitions/v7/chat";
import { createStudentProfileV7, validateSelfReportedExtractionV7 } from "@/lib/competitions/v7/profile";
import { student } from "../v6/decision-fixtures";

const fact = (field: string, value: DomainFact["value"], sourceText: string, state: DomainFact["state"] = "affirmed"): DomainFact => ({
  field, value, sourceText, state, evidenceLevel: "self_report", confirmed: true,
});
const success = (data: unknown): AiJsonResult<unknown> => ({ ok: true, data, model: "saved-response-replay", upstreamAttempted: true,
  finishReason: "stop", attempts: 1, httpStatus: 200, durationMs: 1 });
const extract = (text: string, facts: DomainFact[]) => validateSelfReportedExtractionV7(text, { facts, unknownFields: [] }, {
  confirmedSelection: true, allowIndependentReportedClauses: true,
});

describe("reported context beside the student's own status", () => {
  const permissionText = "朋友说他可以把项目文件公开，那是他的项目，不能替代我的许可。";
  const reportedPermission = [fact("other.friend.publicationClaim", true, "朋友说他可以把项目文件公开"),
    fact("other.friend.projectOwnership", true, "那是他的项目")];

  it.each([
    ["permission.friendApprovalCanReplaceMyPermission", false, "negated"],
    ["permission.friendPublicUploadCannotReplaceMyPermission", true, "affirmed"],
    ["disclosure.colleagueConsentCanSubstituteMyApproval", false, "negated"],
  ] as const)("does not classify an embedded Can substring as personal ability: %s", async (field, value, state) => {
    const before = createStudentProfileV7(student());
    let calls = 0;
    const reply = await draftDecisionChatV7({ profile: before }, permissionText, [], { requestId: "reported-permission", at: "2026-11-10T03:00:00.000Z",
      modelCall: async () => { calls++; return success({ facts: [...reportedPermission, fact(field, value, "不能替代我的许可", state)], unknownFields: [], unresolvedAssertions: [] }); } });
    expect(calls).toBe(1);
    expect(reply.profile?.facts.find(row => row.field === field)).toMatchObject({ value, state, confirmed: true, originalText: "不能替代我的许可" });
    expect(reply.profile?.facts.find(row => row.field === "other.friend.publicationClaim")?.originalText).toBe("朋友说他可以把项目文件公开");
    expect(reply.profile?.facts.filter(row => row.field === "skills")).toEqual(before.facts.filter(row => row.field === "skills"));
  });

  it.each([
    ["老师说再商量，没有书面承担安排。", "老师说再商量", "没有书面承担安排", "budget.responsibility", "budget.writtenCommitment"],
    ["同学说等通知，目前没有确定的设备预约。", "同学说等通知", "目前没有确定的设备预约", "equipment.access", "equipment.reservation"],
  ])("preserves an unconfirmed status and its independent explicit absence: %s", async (text, reported, absence, unknownField, absenceField) => {
    let calls = 0;
    const reply = await draftDecisionChatV7({ profile: createStudentProfileV7(student()) }, text, [], {
      requestId: "reported-status", at: "2026-11-10T03:00:00.000Z", modelCall: async () => { calls++; return success({ facts: [
        fact(unknownField, "unknown", text, "unknown"), fact(absenceField, "present", absence, "negated"),
      ], unknownFields: [unknownField], unresolvedAssertions: [{ sourceText: reported, kind: "target" }] }); },
    });
    expect(calls).toBe(1);
    expect(reply.profile?.facts.find(row => row.field === unknownField)).toMatchObject({ value: "unknown", state: "unknown", confirmed: false, originalText: text });
    expect(reply.profile?.facts.find(row => row.field === absenceField)).toMatchObject({ value: "present", state: "negated", confirmed: true, originalText: absence });
    expect(reply.profile?.unknownFields).toContain(unknownField);
  });

  it.each(["skills", "canPublish", "ability.canPublish", "experience.1.contribution"])("continues to reject a personal capability field: %s", field => {
    expect(() => extract(permissionText, [...reportedPermission, fact(field, true, "不能替代我的许可")])).toThrow("quoted_other_person_is_not_self_evidence");
  });

  it.each([
    ["老师说，没有书面承担安排。", "没有书面承担安排", "budget.responsibility", "budget.writtenCommitment", "unknown"],
    ["老师说：“没有书面承担安排。”", "没有书面承担安排", "budget.responsibility", "budget.writtenCommitment", "unknown"],
    ["如果老师说再商量，没有书面承担安排。", "没有书面承担安排", "budget.responsibility", "budget.writtenCommitment", "unknown"],
    ["老师说再商量，没有书面承担安排。", "没有书面承担安排", "equipment.access", "budget.writtenCommitment", "unknown"],
    ["老师说再商量，没有书面承担安排。", "没有书面承担安排", "budget.responsibility", "budget.writtenCommitment", "affirmed"],
  ] as const)("rejects quotation, conditionality, unrelated scope or positive adoption: %s", (text, absence, field, absenceField, state) => {
    expect(() => extract(text, [fact(field, "unknown", text, state), fact(absenceField, "present", absence, "negated")])).toThrow("quoted_other_person_is_not_self_evidence");
  });

  it("does not convert a report alone into a personal unknown", () => {
    const text = "老师说再商量。";
    expect(() => extract(text, [fact("budget.responsibility", "unknown", text, "unknown")])).toThrow("quoted_other_person_is_not_self_evidence");
  });
});
