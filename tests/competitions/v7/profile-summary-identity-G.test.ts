import { describe, expect, it } from "vitest";
import type { StudentFactV6, StudentProfileV6 } from "@/lib/competitions/v6/contracts";
import type { DomainFact } from "@/lib/competitions/v6/domain-facts";
import { draftDecisionChatV7 } from "@/lib/competitions/v7/chat";
import { applySelfReportedFactsV7 } from "@/lib/competitions/v7/profile";

const at = "2026-11-10T03:04:53.981Z";
const fact = (id: string, field: string, value: StudentFactV6["value"], quote: string, state: StudentFactV6["state"] = "affirmed"): StudentFactV6 => ({
  id, field, value, label: String(value), state, confirmed: state === "affirmed" || state === "negated", evidenceLevel: "self_report",
  answerId: "initial-no-update-record", originalText: quote, sourceSpan: { start: 0, end: quote.length }, updatedAt: at, supersedesFactIds: [],
});
const profile = (facts: StudentFactV6[], profileId = "own-summary"): StudentProfileV6 => ({ schemaVersion: "saitu.profile.v6", profileId,
  revision: `${profileId}.initial`, facts, unknownFields: [], retractedFactIds: [], goals: [], primaryGoal: null, tradeoffStatus: "undecided", mode: "deep" });
const extract = (field: string, value: DomainFact["value"], quote: string, state: DomainFact["state"] = "affirmed"): DomainFact => ({
  field, value, sourceText: quote, state, evidenceLevel: "self_report", confirmed: true,
});
const summarize = (value: StudentProfileV6) => draftDecisionChatV7({ profile: value }, "请总结我当前的档案。", [], {
  modelCall: async () => { throw new Error("summary_must_not_call_model"); },
});
const text = (reply: Awaited<ReturnType<typeof summarize>>) => reply.claims.map(row => row.text).join("\n");

describe("profile summary literal identities and their wider original context", () => {
  const old = "只允许在课程盘保存评读草案。";
  const initial = () => profile([fact("old-limit", "storage.location", "only-course-drive", old), fact("title", "document.title", "评读草案", old)]);

  it("uses the retained document title after applying the actual G3-shaped replacement without an initial update record", async () => {
    const before = initial();
    const utterance = "更正存储安排：保存地点改为图书馆内网；撤回只允许存到课程盘的旧限制；文档名称不变。";
    const next = applySelfReportedFactsV7(before, { facts: [extract("storage.location", "图书馆内网", "保存地点改为图书馆内网"),
      extract("storage.location", "只允许存到课程盘", "撤回只允许存到课程盘的旧限制", "retracted")], unknownFields: [] },
    { answerId: "new-storage", text: utterance, at }, undefined);
    const saved = structuredClone(next), reply = await summarize(next);
    expect(next.retractedFactIds).toContain("old-limit");
    expect(text(reply)).toContain("图书馆内网"); expect(text(reply)).toContain("评读草案"); expect(text(reply)).not.toContain("只允许在课程盘保存");
    expect(reply.claims.flatMap(row => row.studentFactIds)).toContain("title");
    expect(next).toEqual(saved); expect(next.facts.find(row => row.id === "title")?.originalText).toBe(old);
  });

  it("preserves a still-current storage condition before any correction", async () => {
    const reply = await summarize(initial());
    expect(text(reply)).toContain(old); expect(text(reply)).toContain("评读草案");
    expect(reply.claims.flatMap(row => row.studentFactIds)).toContain("old-limit");
  });

  it("does not revive the old condition after a withdrawal without a replacement", async () => {
    const utterance = "撤回只允许存到课程盘的旧限制。";
    const next = applySelfReportedFactsV7(initial(), { facts: [extract("storage.location", "only-course-drive", utterance, "retracted")], unknownFields: [] },
      { answerId: "withdraw-storage", text: utterance, at }, undefined);
    const reply = await summarize(next);
    expect(text(reply)).toContain("评读草案"); expect(text(reply)).not.toContain("只允许在课程盘保存");
    expect(next.facts.some(row => row.field === "storage.location")).toBe(false);
  });

  it.each(["只允许存到课程盘", "课程盘", "不得公开的文档", "图书馆内网"])("preserves an exact title even when its words resemble conditions: %s", async title => {
    const reply = await summarize(profile([fact("title", "document.title", title, `原文档名称是${title}，旧存储限制已经撤回。`)]));
    expect(text(reply)).toContain(`标题：${title}`);
  });

  it("keeps nonidentity constraints, personal denials and contradictory current statements intact", async () => {
    const restrictions = [fact("storage", "storage.location", "only-course-drive", old),
      fact("other-grant", "storage.alternate", "library", "我同时确认图书馆内网仍可使用。"),
      fact("no-publish", "permission.publication", true, "我不允许公开上传。", "negated"),
      fact("not-title", "storage.note", "评读草案", old)];
    const reply = await summarize(profile([fact("title", "document.title", "评读草案", old), ...restrictions]));
    for (const row of restrictions) expect(text(reply)).toContain(row.originalText);
    expect(text(reply)).toContain("否定自述：我不允许公开上传。");
    for (const row of restrictions) expect(reply.claims.flatMap(claim => claim.studentFactIds)).toContain(row.id);
  });

  it.each(["unknown", "conditional", "negated"] as const)("preserves the full qualification for a nonaffirmed identity: %s", async state => {
    const quote = state === "unknown" ? "我还不知道文档名称能否改成评读草案。" : state === "conditional" ? "如果获得许可，文档名称才改成评读草案。" : "文档名称不是评读草案。";
    const reply = await summarize(profile([fact("title", "document.title", "评读草案", quote, state)]));
    expect(text(reply)).toContain(quote); expect(text(reply)).not.toContain("标题：评读草案");
  });

  it("keeps quoted identities out of the own summary and never shares names across profiles", async () => {
    const first = profile([fact("own-title", "document.title", "只允许存到课程盘", "文件名是只允许存到课程盘。"),
      fact("quoted-title", "quoted.classmate.document.title", "另一位的档案", "同学说她的文件名是另一位的档案。")], "first-owner");
    const second = profile([fact("second-title", "document.title", "校内试读", "文档名称是校内试读。")], "second-owner");
    const a = await summarize(first), b = await summarize(second);
    expect(text(a)).toContain("只允许存到课程盘"); expect(text(a)).not.toContain("另一位的档案"); expect(text(a)).not.toContain("校内试读");
    expect(text(b)).toContain("校内试读"); expect(text(b)).not.toContain("课程盘");
    expect(a.claims.flatMap(row => row.studentFactIds)).not.toContain("quoted-title");
    expect(b.claims.flatMap(row => row.studentFactIds)).toEqual(["second-title"]);
  });
});
