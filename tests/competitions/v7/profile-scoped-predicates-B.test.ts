import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainFact } from "@/lib/competitions/v6/domain-facts";
import { draftDecisionChatV7, extractSelfReportedFactsV7 } from "@/lib/competitions/v7/chat";
import { applySelfReportedFactsV7, createStudentProfileV7 } from "@/lib/competitions/v7/profile";
import { student } from "../v6/decision-fixtures";

const legacy = student();
const source = (answerId: string, text: string) => ({ answerId, text, at: "2026-11-11T08:00:00Z" });
const fact = (field: string, value: DomainFact["value"], sourceText: string, state: DomainFact["state"] = "affirmed"): DomainFact =>
  ({ field, value, sourceText, state, evidenceLevel: "self_report", confirmed: true });
const success = (facts: DomainFact[], unresolvedAssertions: { sourceText: string; kind: "target" | "value" | "scope" }[] = []) => ({
  ok: true as const, data: { facts, unknownFields: [], unresolvedAssertions },
  model: "deepseek-flash", upstreamAttempted: true as const, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });
const profile = (unknownFields: string[] = []) => ({ ...createStudentProfileV7(legacy), unknownFields });
const update = (current: ReturnType<typeof profile>, answerId: string, text: string, facts: DomainFact[]) =>
  applySelfReportedFactsV7(current, { facts, unknownFields: [] }, source(answerId, text), legacy);

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_profile_predicates_forbid_http"); })));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("requested profile fields preserve separately asserted predicates", () => {
  it.each([
    ["mentor_confirmation", "导师明确同意辅导", "这并非我单方猜测", "negated"],
    ["team_country", "两位成员均为法国籍", "分别在法国和荷兰就读", "affirmed"],
    ["travel_permission", "校方请假申请尚未批准", "本人愿意到线下", "affirmed"],
    ["team_future", "尚未询问他们是否组队", "我认识几位同事", "affirmed"],
    ["registration_payment", "仍没缴纳规定的报名费", "我填写了参赛申请表", "affirmed"],
  ] as const)("retains the independent %s clause with its exact text", async (field, anchor, omitted, expectedState) => {
    const result = await extractSelfReportedFactsV7({ utterance: `${omitted}，${anchor}。`, requestedFields: [field] },
      { modelCall: async () => success([fact(field, anchor, anchor)]) });
    expect(result.fallback).toBe(false);
    expect(result.facts).toHaveLength(2);
    expect(result.facts[1]).toMatchObject({ field, state: expectedState, value: omitted, sourceText: omitted });
  });

  it("preserves both stated study locations as one predicate separate from nationality", async () => {
    const field = "team_country", nationality = "两位队员均为法国籍", study = "两位队员分别在法国和荷兰就读";
    const utterance = `${nationality}，但${study}。`;
    const nationalFact = fact(field, "France", nationality);
    for (const narrowed of [[fact(field, "Netherlands", study)], [fact(field, "France", study), fact(field, "Netherlands", study)]]) {
      const response = success([nationalFact, ...narrowed]);
      const result = await extractSelfReportedFactsV7({ utterance, requestedFields: [field] }, { modelCall: async () => response });
      expect(result.fallback).toBe(false);
      expect(result.facts).toEqual([nationalFact, fact(field, study, study)]);
      expect(response.data.facts).toEqual([nationalFact, ...narrowed]);
    }
  });

  it("keeps independent cohorts and leaves incomplete, future or reported study scope as supplied", async () => {
    const field = "team_country", study = "两位队员分别在法国和荷兰就读", otherStudy = "三名队员各自在日本与韩国学习";
    const combined = await extractSelfReportedFactsV7({ utterance: `${study}。${otherStudy}。`, requestedFields: [field] },
      { modelCall: async () => success([fact(field, "Netherlands", study), fact(field, "Korea", otherStudy)]) });
    expect(combined.facts).toEqual([fact(field, study, study), fact(field, otherStudy, otherStudy)]);

    const variants = [
      { utterance: `以后，${study}。`, candidate: fact(field, "Netherlands", study) },
      { utterance: `明年，${study}。`, candidate: fact(field, "Netherlands", study) },
      { utterance: `同学表示，${study}。`, candidate: fact(field, "Netherlands", study) },
      { utterance: `队长说，${study}。`, candidate: fact(field, "Netherlands", study) },
      { utterance: `补充队长的转述：${study}。`, candidate: fact(field, "Netherlands", study) },
      { utterance: `${study}。`, candidate: fact(field, "Netherlands", "荷兰") },
      { utterance: `${study}。`, candidate: fact(field, "尚未确认", study, "unknown") },
    ];
    for (const { utterance, candidate } of variants) {
      const result = await extractSelfReportedFactsV7({ utterance, requestedFields: [field] }, { modelCall: async () => success([candidate]) });
      expect(result.fallback).toBe(false);
      expect(result.facts).toHaveLength(1);
      expect(result.facts[0]).toMatchObject({ value: candidate.value, sourceText: candidate.sourceText, state: candidate.state });
    }
  });

  it.each(["法国、荷兰、德国", "法国、荷兰及德国"])("preserves a complete current study location list (%s)", async locations => {
    const field = "team_country", study = `三位队员分别在${locations}就读`;
    const result = await extractSelfReportedFactsV7({ utterance: `${study}。`, requestedFields: [field] },
      { modelCall: async () => success([fact(field, "Netherlands", study)]) });
    expect(result.facts).toEqual([fact(field, study, study)]);
  });

  it("keeps the total and leaves other requested counts and explicitly scoped source alone", async () => {
    const total = "共采访了二十名受访者", subset = "其中三名参加复访";
    const utterance = `${total}，${subset}。`;
    const facts = [fact("sample_count", 20, total), fact("sample_count", 3, subset)];
    const result = await extractSelfReportedFactsV7({ utterance, requestedFields: ["sample_count"] }, { modelCall: async () => success(facts) });
    expect(result.facts).toEqual([facts[0]]);
    const subsetOnly = await extractSelfReportedFactsV7({ utterance, requestedFields: ["sample_count"] }, { modelCall: async () => success([facts[1]]) });
    expect(subsetOnly.facts).toEqual([facts[1]]);
  });

  it("does not derive willingness from denied or hypothetical school permission", async () => {
    const quote = "校方请假申请尚未批准", provided = fact("travel_permission", false, quote, "negated");
    for (const utterance of [`${quote}。`, `如果校方批准，我愿意到现场。${quote}。`, `朋友说：“我愿意到现场。”${quote}。`]) {
      const result = await extractSelfReportedFactsV7({ utterance, requestedFields: ["travel_permission"] }, { modelCall: async () => success([provided]) });
      expect(result.facts.map(row => row.sourceText)).toEqual([quote]);
    }
  });

  it.each(["260", "２６０"])("keeps a personal numeric materials cap and its funded equipment exclusion: %s", async amount => {
    const cap = `我个人最多承担${amount}元材料费`, exclusion = "不含已经由学校承担的设备费", field = "budget_personal_cny";
    const utterance = `${cap}，${exclusion}。`;
    const answer = success([fact(field, 260, cap)]);
    const result = await extractSelfReportedFactsV7({ utterance, requestedFields: [field] }, { modelCall: async () => answer });
    expect(result.facts).toEqual([fact(field, 260, utterance)]);
    expect(answer.data.facts).toEqual([fact(field, 260, cap)]);
    const separate = `${cap}。另一项目的预算说明不含已经由学校承担的设备费。`;
    const other = await extractSelfReportedFactsV7({ utterance: separate, requestedFields: [field] }, { modelCall: async () => answer });
    expect(other.facts).toEqual([fact(field, 260, cap)]);
  });

  it.each([
    { statement: "十二名访谈对象里有五名接受回访", total: 12, overlap: 5 },
    { statement: "我访谈了１２人，其中４人参加了后续回访", total: 12, overlap: 4 },
    { statement: "二百零一名受访者中有十二名完成回访", total: 201, overlap: 12 },
  ])("assigns nested counts to their requested semantic scope ($statement)", async ({ statement, total, overlap }) => {
    const utterance = `${statement}。`;
    for (const [field, retained] of [["participant_overlap", overlap], ["sample_count", total]] as const) {
      const answer = success([fact(field, total, statement), fact(field, overlap, statement)]);
      const result = await extractSelfReportedFactsV7({ utterance, requestedFields: [field] }, { modelCall: async () => answer });
      expect(result.facts).toEqual([fact(field, retained, statement)]);
      expect(answer.data.facts.map(row => row.value)).toEqual([total, overlap]);
      const wrong = field === "sample_count" ? overlap : total;
      const single = success([fact(field, wrong, statement)]);
      const corrected = await extractSelfReportedFactsV7({ utterance, requestedFields: [field] }, { modelCall: async () => single });
      expect(corrected.facts).toEqual([fact(field, retained, statement)]);
      expect(single.data.facts[0].value).toBe(wrong);
    }
  });

  it("keeps independently sourced overlap, a follow-up exclusion and a conditional target", async () => {
    const field = "participant_overlap", first = "十二名访谈对象里有五名接受回访";
    const qualifier = "这五名不能当新样本", second = "二十名受访者中有十二名完成回访", future = "下一轮计划请八名受访者回访";
    const utterance = `${first}，${qualifier}。${second}。${future}。`;
    const expected = [fact(field, 5, first), fact(field, "新样本", qualifier, "negated"), fact(field, 12, second),
      { ...fact(field, 8, future, "conditional"), confirmed: false }];
    const result = await extractSelfReportedFactsV7({ utterance, requestedFields: [field] }, {
      modelCall: async () => success([fact(field, 12, first), ...expected]),
    });
    expect(result.facts).toEqual(expected);
    const uncertain = "我访谈了十二人，还不确定有几人接受回访。";
    const quote = "还不确定有几人接受回访";
    const unresolved = await extractSelfReportedFactsV7({ utterance: uncertain, requestedFields: [field] }, {
      modelCall: async () => success([fact(field, "unknown", quote, "unknown")]),
    });
    expect(unresolved.facts).toEqual([{ ...fact(field, "unknown", quote, "unknown"), confirmed: false }]);
    const incomplete = await extractSelfReportedFactsV7({ utterance: `${first}。`, requestedFields: [field] }, {
      modelCall: async () => success([fact(field, 12, "十二名访谈对象")]),
    });
    expect(incomplete).toMatchObject({ facts: [], unknownFields: [field], fallback: false });
  });
});

describe("current scope is updated using literal source rather than provider field names", () => {
  it("adopts a complete literal application and document label before requesting a model response", async () => {
    const application = "我已经申请了周六工坊时段", identity = "项目记录编号为校验档案7", qualifier = "这里只是文档名称";
    const utterance = `${application}。 ${identity}，${qualifier}。`;
    const modelCall = vi.fn(async () => success([]));
    const reply = await draftDecisionChatV7({ profile: profile(), legacy }, utterance, [], { ...source("direct-intake", utterance), modelCall });
    expect(modelCall).not.toHaveBeenCalled();
    expect(reply.profile?.facts.find(row => row.field === "workshop.appliedTimeSlot")).toMatchObject({ originalText: application, value: "周六工坊时段" });
    expect(reply.profile?.facts.find(row => row.field === "document_label")).toMatchObject({ originalText: `${identity}，${qualifier}`, value: "校验档案7" });
    expect(reply.profile?.facts.some(row => /reservation|count|roomNumber/u.test(row.field))).toBe(false);
  });

  it.each([
    "我没有申请周六工坊时段。 项目记录编号为校验档案7，这里只是文档名称。",
    "我计划申请周六工坊时段。 项目记录编号为校验档案7，这里只是文档名称。",
    "队友说我申请了周六工坊时段。 项目记录编号为校验档案7，这里只是文档名称。",
    "我申请了周六工坊时段。 项目记录编号为校验档案7，这里是参加人数。",
    "我申请了周六工坊时段。 项目记录编号为校验档案7，这里只是文档名称。权限还没核实。",
  ])("leaves negated, future, third-party and incomplete messages on the ordinary extraction path (%s)", async utterance => {
    const modelCall = vi.fn(async () => success([]));
    const reply = await draftDecisionChatV7({ profile: profile(), legacy }, utterance, [], { ...source("ordinary-intake", utterance), modelCall });
    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(reply.profile).toBeUndefined();
  });

  it("retires one sourced current patent stage and preserves earlier documents and other patent contexts", () => {
    const initialText = "我已经拿到本专利申请受理通知书。", grant = "刚收到该件专利授权通知书。";
    const initial = update(profile(["equipment_access"]), "acceptance", initialText, [fact("patent.status", "受理", initialText)]);
    const old = initial.facts.find(row => row.field === "patent.status")!;
    const accepted = update(initial, "grant", grant, [fact("authorization.notice", true, grant)]);
    expect(accepted.facts.find(row => row.field === "patent.status")).toMatchObject({ originalText: grant, sourceSpan: { start: 0, end: grant.length }, supersedesFactIds: [old.id] });
    expect(accepted.retractedFactIds).toContain(old.id);
    expect(accepted.updates?.[0].originalText).toBe(initialText);
    expect(accepted.unknownFields).toContain("equipment_access");
    for (const separate of ["今天收到另一件发明的授权通知。", "假如收到授权通知再提交。", "朋友说他收到授权通知。"] as const) {
      const next = update(initial, "different", separate, [fact("other.authorization.notice", true, separate)]);
      expect(next.facts.some(row => row.id === old.id)).toBe(true);
      expect(next.retractedFactIds).not.toContain(old.id);
    }
    const past = "去年收到专利受理通知。";
    const historical = update(profile(), "past", past, [fact("patent.status", "历史受理", past)]);
    expect(update(historical, "grant", grant, [fact("authorization.notice", true, grant)]).facts.some(row => row.originalText === past)).toBe(true);
  });

  it("keeps the current patent stage in its sourced team scope through a grant notice alias", async () => {
    const field = "team.patent_status", grantField = "authorization.notice_status";
    const accepted = "本团队已拿到本件专利申请受理通知书";
    const doc = "项目记录编号为工作稿17";
    const initial = update(profile(), "team-accepted", `${accepted}。${doc}。`, [fact(field, "受理", accepted), fact("project.documentLabel", "工作稿17", doc)]);
    const old = initial.facts.find(row => row.field === field)!;
    const grant = "刚刚拿到授权通知书", write = "可以明确写授权", utterance = `${grant}，${write}。`;
    const returned = [fact(grantField, true, grant), fact("team.patent.stage", "授权", grant), fact("authorization.write_status", true, write)];
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, utterance, [],
      { ...source("team-granted", utterance), modelCall: async () => success(returned) });
    expect(reply.profile?.facts.filter(row => row.originalText === grant)).toEqual([expect.objectContaining({
      field, value: grant, supersedesFactIds: [old.id], sourceSpan: { start: 0, end: grant.length },
    })]);
    expect(reply.profile?.retractedFactIds).toContain(old.id);
    expect(reply.profile?.facts).toContainEqual(initial.facts.find(row => row.field === "project.documentLabel"));
    expect(reply.profile?.facts).toContainEqual(expect.objectContaining({ field: "authorization.write_status", originalText: write }));
    expect(reply.profile?.updates?.find(row => row.answerId === "team-accepted")?.originalText).toBe(`${accepted}。${doc}。`);
  });

  it("preserves a team acceptance when a grant has another actor, patent, condition or pending scope", () => {
    const field = "team.patent_status", accepted = "我们已经收到专利受理通知", grant = "今天收到授权通知";
    const initial = update(profile(), "team-accepted", accepted, [fact(field, "受理", accepted)]);
    const old = initial.facts.find(row => row.field === field)!;
    const pending = "竞赛公开展示仍在审批", pendingField = "competition_display_permission";
    const secondApproval = update(initial, "second-approval", pending, [fact(pendingField, "审批中", pending, "unknown")]);
    const otherPatent = "我也提交了一项专利申请";
    const secondPatent = update(initial, "second-patent", otherPatent, [fact("patent.stage", "申请", otherPatent)]);
    const scenarios = [
      [initial, "我今天收到授权通知", "authorization.notice_status"],
      [initial, "我们收到另一件发明的授权通知", "authorization.notice_status"],
      [initial, "朋友说他们收到授权通知", "other.authorization.notice_status"],
      [initial, "如果今天收到授权通知就提交", "authorization.notice_status"],
      [secondApproval, grant, "authorization.notice_status"],
      [secondPatent, grant, "authorization.notice_status"],
    ] as const;
    for (const [prior, notice, alias] of scenarios) {
      const next = update(prior, "separate-notice", notice, [fact(alias, true, notice)]);
      expect(next.facts).toContainEqual(old);
      expect(next.retractedFactIds).not.toContain(old.id);
    }
    const explicit = "我们今天收到这件专利授权通知";
    const scoped = update(secondApproval, "explicit-patent-notice", explicit, [fact("authorization.notice_status", true, explicit)]);
    expect(scoped.retractedFactIds).toContain(old.id);
    expect(scoped.facts).toContainEqual(expect.objectContaining({ field, originalText: explicit }));
    expect(scoped.facts).toContainEqual(secondApproval.facts.find(row => row.field === pendingField));
  });

  it("binds the patent change only when stored and current project headings agree", () => {
    const field = "team.patent_status", accepted = "我们已收到这件专利受理通知", grant = "我们刚刚收到该件专利授权通知书";
    const before = "甲项目。" + accepted + "。";
    const initial = update(profile(), "named-acceptance", before, [fact(field, "受理", accepted)]);
    const old = initial.facts.find(row => row.field === field)!;
    const alias = fact("authorization.notice_status", true, grant);
    const same = update(initial, "same-project-grant", "甲项目。" + grant + "。", [alias]);
    expect(same.retractedFactIds).toContain(old.id);
    expect(same.facts).toContainEqual(expect.objectContaining({ field, originalText: grant, supersedesFactIds: [old.id] }));
    for (const prefix of ["乙项目。", "", "另一小组。"]) {
      const separate = update(initial, "unbound-grant", prefix + grant + "。", [alias]);
      expect(separate.facts).toContainEqual(old);
      expect(separate.retractedFactIds).not.toContain(old.id);
    }
  });

  it("extends a uniquely scoped trial while preserving the external class as the feedback actor", () => {
    const before = "这项活动目前只在本组内试用过。", outside = "外班在教师允许下试做后给了反馈。";
    const initial = update(profile(), "before", before, [fact("trial.scope", "仅本组", before)]);
    const old = initial.facts.find(row => row.field === "trial.scope")!;
    const expanded = update(initial, "outside", outside, [fact("other.class.feedback", "外班反馈", outside)]);
    expect(expanded.facts.find(row => row.field === "trial.scope")).toMatchObject({ originalText: outside, supersedesFactIds: [old.id] });
    expect(expanded.facts.find(row => row.field === "other.class.feedback")).toMatchObject({ originalText: outside });
    const different = "外班试用了另一套活动并给出反馈。";
    const next = update(initial, "other", different, [fact("other.class.feedback", "外班反馈", different)]);
    expect(next.facts.some(row => row.id === old.id)).toBe(true);
  });

  it.each(["另一班在老师同意下试用并反馈。", "经教师许可后，外班已经试用并提交反馈。"])(
    "recognizes completed external trial and feedback under permission (%s)", async utterance => {
      const before = "测验只在自己小组做过。", scope = "assessment_scope";
      const initial = update(profile(), "trial-before", before, [fact(scope, "own_group_only", before)]);
      const old = initial.facts.find(row => row.field === scope)!;
      const returned = ["other.class.trial", "other.class.feedback"].map(field => ({
        ...fact(field, "conditional", utterance, "conditional"), evidenceLevel: "unknown" as const, confirmed: false,
      }));
      const response = success(returned);
      const reply = await draftDecisionChatV7({ profile: initial, legacy }, utterance, [],
        { ...source("trial-completed", utterance), modelCall: async () => response });
      expect(reply.profile?.retractedFactIds).toContain(old.id);
      expect(reply.profile?.facts).toContainEqual(expect.objectContaining({ field: scope, state: "affirmed",
        originalText: utterance, supersedesFactIds: [old.id] }));
      for (const field of ["other.class.trial", "other.class.feedback"]) expect(reply.profile?.facts).toContainEqual(expect.objectContaining({
        field, state: "affirmed", confirmed: true, evidenceLevel: "self_report", originalText: utterance,
      }));
      expect(response.data.facts).toEqual(returned);
    });

  it.each([
    ["另一班如果取得老师同意就会试用并反馈。", "另一班如果取得老师同意就会试用并反馈。"],
    ["另一班已获老师同意，但还没试用。", "另一班已获老师同意，但还没试用。"],
    ["另一班在老师同意下试用。", "另一班在老师同意下试用。"],
    ["明年，另一班在老师同意下试用并反馈。", "另一班在老师同意下试用并反馈。"],
    ["朋友说，另一班在老师同意下试用并反馈。", "另一班在老师同意下试用并反馈。"],
    ["另一班在老师同意下试用并反馈。那是他的项目。", "另一班在老师同意下试用并反馈。"],
    ["另一班在老师同意下试用并反馈？", "另一班在老师同意下试用并反馈？"],
  ])("preserves a prior trial limit when realized participation has no complete current source (%s)", (text, quote) => {
    const before = "测验只在自己小组做过。", scope = "assessment_scope";
    const initial = update(profile(), "trial-before", before, [fact(scope, "own_group_only", before)]);
    const old = initial.facts.find(row => row.field === scope)!;
    const next = update(initial, "trial-unrealized", text, [fact("other.class.trial", "conditional", quote, "conditional")]);
    expect(next.facts).toContainEqual(old);
    expect(next.retractedFactIds).not.toContain(old.id);
    expect(next.facts.find(row => row.field === "other.class.trial")?.state).toBe("conditional");
  });

  it("links completed trial scope only to the same named project and assessment subject", () => {
    const scope = "assessment_scope", before = "测验只在自己小组做过", feedback = "这项测试由外班在老师同意下试用并反馈";
    const initial = update(profile(), "named-before", "甲项目。" + before + "。", [fact(scope, "own_group_only", before)]);
    const old = initial.facts.find(row => row.field === scope)!;
    const same = update(initial, "same-trial", "甲项目。" + feedback + "。", [fact("other.class.feedback", true, feedback)]);
    expect(same.retractedFactIds).toContain(old.id);
    const otherProject = update(initial, "other-trial", "乙项目。" + feedback + "。", [fact("other.class.feedback", true, feedback)]);
    expect(otherProject.facts).toContainEqual(old);
    expect(otherProject.retractedFactIds).not.toContain(old.id);
    const differentSubject = feedback.replace("测试", "方案");
    const otherObject = update(initial, "other-object", "甲项目。" + differentSubject + "。", [fact("other.class.feedback", true, differentSubject)]);
    expect(otherObject.facts).toContainEqual(old);
    expect(otherObject.retractedFactIds).not.toContain(old.id);
  });

  it.each(["外班已经在教师同意下试做了，尚未反馈。", "外班经教师同意后已经试做了，尚未反馈。"])(
    "records a completed external trial with a separate lack of feedback (%s)", later => {
    const scope = "assessment_scope", before = "测验只在自己小组做过。";
    const initial = update(profile(), "trial-before", before, [fact(scope, "own_group_only", before)]);
    const old = initial.facts.find(row => row.field === scope)!;
    const next = update(initial, "trial-without-feedback", later, [fact("other.class.trial", true, later, "conditional"),
      fact("other.class.feedback", true, later)]);
    expect(next.retractedFactIds).toContain(old.id);
    expect(next.facts).toContainEqual(expect.objectContaining({ field: "other.class.trial", state: "affirmed" }));
    expect(next.facts).toContainEqual(expect.objectContaining({ field: "other.class.feedback", state: "negated", value: false }));
  });

  it("keeps completed trial and feedback separate from a following future plan", async () => {
    const scope = "assessment_scope", before = "测验只在自己小组做过。";
    const initial = update(profile(), "trial-before", before, [fact(scope, "own_group_only", before)]);
    const old = initial.facts.find(row => row.field === scope)!;
    const trial = "另一班在老师同意下试用并反馈。", plan = "我计划下周整理意见记录。", text = trial + plan;
    const response = success([fact("other.class.trial", true, trial, "conditional"), fact("other.class.feedback", true, trial, "conditional"),
      fact("plan.nextTask", "整理意见记录", plan, "conditional")]);
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, text, [],
      { ...source("trial-and-plan", text), modelCall: async () => response });
    expect(reply.profile?.retractedFactIds).toContain(old.id);
    for (const field of ["other.class.trial", "other.class.feedback", scope]) {
      expect(reply.profile?.facts).toContainEqual(expect.objectContaining({ field, state: "affirmed", originalText: trial }));
    }
    expect(reply.profile?.facts).toContainEqual(expect.objectContaining({ field: "plan.nextTask", state: "conditional", originalText: plan }));
  });

  it.each(["conditional", "affirmed"] as const)("keeps the earlier trial scope when a follow-up says this trial did not occur (%s)", async state => {
    const scope = "assessment_scope", before = "测验只在自己小组做过。";
    const initial = update(profile(), "trial-before", before, [fact(scope, "own_group_only", before)]);
    const old = initial.facts.find(row => row.field === scope)!;
    const trial = "另一班在老师同意下试用并反馈。", qualifier = "这是计划，实际并未试用。", text = trial + qualifier;
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, text, [],
      { ...source("trial-qualification", text), modelCall: async () => success([
        fact("other.class.trial", true, trial, state), fact("other.class.feedback", true, trial, state),
        fact("other.class.trialOccurred", false, qualifier, "negated"),
      ]) });
    expect(reply.profile?.facts).toContainEqual(old);
    expect(reply.profile?.retractedFactIds).not.toContain(old.id);
    expect(reply.profile?.facts.filter(row => row.originalText === trial).map(row => row.state)).toEqual(["conditional", "conditional"]);
    expect(reply.profile?.facts).toContainEqual(expect.objectContaining({ field: "other.class.trialOccurred", state: "negated", originalText: qualifier }));
  });

  it("preserves the absence of an invitation when actual user testing is reported", () => {
    const before = "我还没有邀请他人试用原型。";
    const initial = update(profile(), "prior", before, [fact("work.invitedUsers", true, before, "negated")]);
    const old = initial.facts.find(row => row.field === "work.invitedUsers")!;
    const trial = "三位目标用户试用原型后反馈了操作问题。";
    const next = update(initial, "trial", trial, [fact("work.userTesting", "收到操作反馈", trial)]);
    expect(next.facts).toContainEqual(old);
    expect(next.facts.find(row => row.field === "work.userTesting")).toMatchObject({ originalText: trial, state: "affirmed" });
  });

  it("replaces a storage-only restriction proved by its quote even when the stored value is only a location", () => {
    const before = "本项目只允许在实验室工作站保存采样文件。";
    const initial = update(profile(), "before", before, [fact("project_storage.exclusiveLocation", "实验室工作站", before)]);
    const old = initial.facts.find(row => row.field === "project_storage.exclusiveLocation")!;
    const retain = "实验室工作站仍可用", backup = "另获准在加密硬盘做离线备份", restriction = "不得公开上传";
    const correction = "更正存储：" + retain + "，" + backup + "；" + restriction + "。";
    const next = update(initial, "expanded", correction, [
      fact("storage.workstationAllowed", true, retain), fact("storage.backupLocation", "加密硬盘", backup),
      fact("storage.publicUploadAllowed", false, restriction, "negated"),
    ]);
    expect(next.retractedFactIds).toContain(old.id);
    expect(next.facts.some(row => row.id === old.id)).toBe(false);
    expect(next.updates?.[0].originalText).toBe(before);
    expect(next.facts.find(row => row.field === "storage.backupLocation")).toMatchObject({ originalText: backup });
    expect(next.facts.find(row => row.field === "storage.publicUploadAllowed")).toMatchObject({ state: "negated" });

    const otherProject = "另获准在另一项目的加密硬盘做离线备份";
    const separate = update(initial, "different", "更正存储：" + retain + "，" + otherProject + "。", [
      fact("storage.workstationAllowed", true, retain), fact("storage.backupLocation", "加密硬盘", otherProject),
    ]);
    expect(separate.facts).toContainEqual(old);
  });

  it("binds a named storage correction to the same source project and full field namespace", () => {
    const previous = "本项目只允许在实验室工作站保存采样文件", before = `现在说明甲项目。${previous}。`;
    const retain = "实验室工作站仍可用", backup = "另获准在加密硬盘做离线备份";
    const correction = (subject: string) => `更正${subject}存储：${retain}，${backup}。`;
    const additions = (retainedField: string, backupField: string, quote = retain) => [
      fact(retainedField, true, quote), fact(backupField, "加密硬盘", backup),
    ];
    const initial = update(profile(), "before", before, [fact("project_alpha.exclusiveLocation", "实验室工作站", previous)]);
    const old = initial.facts.find(row => row.field === "project_alpha.exclusiveLocation")!;

    const same = update(initial, "same", correction("甲项目"), additions("project_alpha.workstationAllowed", "project_alpha.backupLocation"));
    expect(same.retractedFactIds).toContain(old.id);
    expect(same.facts.find(row => row.field === "project_alpha.backupLocation")).toMatchObject({ originalText: backup });
    expect(same.updates?.at(-1)?.removedFactIds).toEqual([old.id]);

    const directQuote = `项目甲${previous.slice("本项目".length)}`;
    const direct = update(profile(), "direct", directQuote, [fact(old.field, "实验室工作站", directQuote)]);
    const directId = direct.facts.find(row => row.field === old.field)!.id;
    expect(update(direct, "direct-expansion", correction("项目甲"), additions("project_alpha.workstationAllowed", "project_alpha.backupLocation")).retractedFactIds).toContain(directId);

    const different = [
      { title: "乙项目", field: "project_beta.workstationAllowed", backup: "project_beta.backupLocation", quote: retain },
      { title: "", field: "project_beta.workstationAllowed", backup: "project_beta.backupLocation", quote: retain },
      { title: "甲项目", field: "project_alpha.workstationAllowed", backup: "project_beta.backupLocation", quote: retain },
      { title: "乙项目", field: old.field, backup: "project_alpha.backupLocation", quote: `更正乙项目存储：${retain}` },
    ];
    for (const row of different) {
      const next = update(initial, "different", correction(row.title), additions(row.field, row.backup, row.quote));
      expect(next.facts).toContainEqual(old);
      expect(next.retractedFactIds).not.toContain(old.id);
      expect(next.facts.find(fact => fact.field === row.backup)).toMatchObject({ originalText: backup });
    }
    const unscopedQuote = "只允许在实验室工作站保存采样文件";
    const unscoped = update(profile(), "unknown", unscopedQuote, [fact("storage.exclusiveLocation", "实验室工作站", unscopedQuote)]);
    const unknown = unscoped.facts.find(row => row.field === "storage.exclusiveLocation")!;
    expect(update(unscoped, "unknown-target", correction(""), additions("storage.workstationAllowed", "storage.backupLocation")).facts).toContainEqual(unknown);
  });

  it("recognizes flat storage aliases while keeping their literal project provenance", () => {
    const prior = "补充：本项目只允许在校内服务器保存工作文件。", retain = "校内服务器仍可用";
    const backup = "另获准在加密移动盘做离线备份", text = `更正储存安排：${retain}，${backup}。`;
    const scoped = [fact("storage_serverAvailability", "仍可用", retain), fact("storage_backupPermission", "获准", backup),
      fact("storage_backupArrangement", "加密移动盘离线备份", backup)];
    const initial = update(profile(), "prior", prior, [fact("storage_scope", "仅限校内服务器", prior)]);
    const old = initial.facts.find(row => row.field === "storage_scope")!;
    expect(update(initial, "expand", text, scoped).retractedFactIds).toContain(old.id);

    const quote = "本项目只允许在校内服务器保存工作文件", named = update(profile(), "named", `现在说明甲项目。${quote}。`,
      [fact("storage_scope", "仅限校内服务器", quote)]);
    const namedOld = named.facts.find(row => row.field === "storage_scope")!;
    expect(update(named, "different", `更正乙项目储存：${retain}，${backup}。`, scoped).facts).toContainEqual(namedOld);
    expect(update(named, "same", `更正甲项目储存：${retain}，${backup}。`, scoped).retractedFactIds).toContain(namedOld.id);
    expect(update(initial, "unknown-field", text, [scoped[0], fact("storage_otherProject", "获准", backup)]).facts).toContainEqual(old);
  });

  it("reuses a missing retained storage clause only for the same named project in chat", async () => {
    const previous = "本项目只允许在实验室工作站保存采样文件", before = `现在说明甲项目。${previous}。`;
    const retain = "实验室工作站仍可用", backup = "另获准在加密硬盘做离线备份";
    const initial = update(profile(), "before", before, [fact("project_alpha.exclusiveLocation", "实验室工作站", previous)]);
    const old = initial.facts.find(row => row.field === "project_alpha.exclusiveLocation")!;
    const same = `更正甲项目存储：${retain}，${backup}。`;
    const sameReply = await draftDecisionChatV7({ profile: initial, legacy }, same, [], { ...source("same", same),
      modelCall: async () => success([fact("project_alpha.backupLocation", "加密硬盘", backup)]) });
    expect(sameReply.profile?.retractedFactIds).toContain(old.id);
    expect(sameReply.profile?.facts.find(row => row.field === old.field)).toMatchObject({
      supersedesFactIds: [old.id], sourceSpan: { start: 0, end: same.indexOf(retain) + retain.length },
    });

    const other = `更正乙项目存储：${retain}，${backup}。`;
    const otherReply = await draftDecisionChatV7({ profile: initial, legacy }, other, [], { ...source("other", other),
      modelCall: async () => success([fact("project_beta.backupLocation", "加密硬盘", backup)]) });
    expect(otherReply.profile).toBeUndefined();
    expect(otherReply.message).toContain("暂未解析成功");
  });

  it.each(["project.workFileStorage.policy", "project.workFileStoragePolicy"])(
    "reuses the same project's retained server across a work-file storage alias (%s)", async field => {
      const before = "本项目只允许在校内服务器保存工作文件。";
      const retain = "校内服务器仍可用", backup = "另获准在加密移动盘做离线备份", restriction = "不得公开上传";
      const initial = update(profile(), "stored-server", before, [fact(field, "只允许在校内服务器保存工作文件", before)]);
      const old = initial.facts.find(row => row.field === field)!;
      const text = `更正储存安排：${retain}，${backup}；${restriction}。`;
      const response = success([fact(field, backup, backup), fact(field, restriction, restriction)]);
      const reply = await draftDecisionChatV7({ profile: initial, legacy }, text, [],
        { ...source("expanded-storage", text), modelCall: async () => response });
      expect(reply.profile?.retractedFactIds).toContain(old.id);
      expect(reply.profile?.facts.filter(row => row.field === field)).toEqual([
        expect.objectContaining({ originalText: backup, state: "affirmed" }),
        expect.objectContaining({ originalText: restriction, value: restriction }),
        expect.objectContaining({ originalText: `更正储存安排：${retain}`, value: retain, supersedesFactIds: [old.id] }),
      ]);
    });

  it.each(["conditional", "denied", "different_project"] as const)("does not reconstruct a storage expansion without same-project permission (%s)", async scenario => {
    const field = "project.workFileStorage.policy", before = "本项目只允许在校内服务器保存工作文件。";
    const initial = update(profile(), "stored-server", before, [fact(field, "只允许在校内服务器保存工作文件", before)]);
    const retain = "校内服务器仍可用";
    const backup = scenario === "conditional" ? "如果获准就在加密移动盘做离线备份"
      : scenario === "denied" ? "尚未获准在加密移动盘做离线备份" : "另获准在加密移动盘做离线备份";
    const heading = scenario === "different_project" ? "更正乙项目储存安排" : "更正储存安排";
    const text = `${heading}：${retain}，${backup}。`;
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, text, [],
      { ...source("unbound-storage", text), modelCall: async () => success([fact(field, backup, backup)]) });
    expect(reply.profile).toBeUndefined();
    expect(reply.message).toContain("暂未解析成功");
  });

  it.each(["。", "；"])("keeps an earlier storage grant separate from an independent later plan (%s)", async separator => {
    const field = "project.workFileStorage.policy", before = "本项目只允许在校内服务器保存工作文件。";
    const initial = update(profile(), "stored-server", before, [fact(field, "只允许在校内服务器保存工作文件", before)]);
    const old = initial.facts.find(row => row.field === field)!;
    const retain = "校内服务器仍可用", backup = "另获准在加密移动盘做离线备份", restriction = "不得公开上传";
    const plan = "我计划下周整理意见记录", text = `更正储存安排：${retain}。${backup}；${restriction}${separator}${plan}。`;
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, text, [],
      { ...source("storage-and-plan", text), modelCall: async () => success([
        fact(field, backup, backup), fact(field, restriction, restriction), fact("plan.nextTask", "整理意见记录", plan, "conditional"),
      ]) });
    expect(reply.profile?.retractedFactIds).toContain(old.id);
    expect(reply.profile?.facts.filter(row => row.field === field).map(row => row.value)).toEqual([backup, restriction, retain]);
    expect(reply.profile?.facts).toContainEqual(expect.objectContaining({ field: "plan.nextTask", state: "conditional", originalText: plan }));
  });

  it("retains current storage when the same backup grant takes effect only after approval", async () => {
    const field = "project.workFileStorage.policy", before = "本项目只允许在校内服务器保存工作文件。";
    const initial = update(profile(), "stored-server", before, [fact(field, "只允许在校内服务器保存工作文件", before)]);
    const old = initial.facts.find(row => row.field === field)!;
    const backup = "另获准在加密移动盘做离线备份", restriction = "不得公开上传";
    const correction = `更正储存安排：校内服务器仍可用，${backup}；${restriction}。`;
    const qualifier = "但这条备份许可要等下月批准后才生效。", text = correction + qualifier;
    const effectiveDate = fact("storage.effectiveDate", "下月批准后", qualifier, "conditional");
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, text, [],
      { ...source("deferred-storage", text), modelCall: async () => success([fact(field, backup, backup), fact(field, restriction, restriction), effectiveDate]) });
    expect(reply.profile?.facts).toContainEqual(old);
    expect(reply.profile?.retractedFactIds).not.toContain(old.id);
    expect(reply.profile?.facts).toContainEqual(expect.objectContaining({ field, state: "conditional", originalText: backup }));
    expect(reply.profile?.facts).toContainEqual(expect.objectContaining({ field, originalText: restriction }));
    expect(reply.profile?.facts).toContainEqual(expect.objectContaining({ field: effectiveDate.field, state: "conditional", originalText: qualifier }));

    const combined = await draftDecisionChatV7({ profile: initial, legacy }, text, [],
      { ...source("unseparated-deferred-storage", text), modelCall: async () => success([fact(field, correction, correction), effectiveDate]) });
    expect(combined.profile).toBeUndefined();
    expect(combined.message).toContain("尚未生效");
  });

  it("keeps explicitly reported project ownership and a separately stated permission boundary apart", async () => {
    const report = "同学说她的文件可以共享", ownership = "这是她的作品", denial = "不能替代我的授权";
    const text = [report, ownership, denial].join("，") + "。";
    const facts = [fact("other.classmate.statement", "可以共享", report), fact("work.owner", "同学", ownership),
      fact("sharing.externalApprovalReplacesMine", false, denial, "negated")];
    const before = profile();
    const reply = await draftDecisionChatV7({ profile: before, legacy }, text, [], { ...source("reported-project", text),
      modelCall: async () => success(facts) });
    expect(reply.profile?.facts.find(row => row.field === "other.work.owner")).toMatchObject({ originalText: ownership });
    expect(reply.profile?.facts.some(row => row.field === "work.owner")).toBe(false);
    expect(reply.profile?.facts.find(row => row.field === "sharing.externalApprovalReplacesMine")).toMatchObject({ state: "negated" });

    const conditional = "假如" + text;
    const unresolved = await extractSelfReportedFactsV7({ utterance: conditional, requestedFields: [], allowNewDomainFields: true },
      { modelCall: async () => success(facts) });
    expect(unresolved.fallback).toBe(true);
  });

  it("scopes independent literal relationship ownership without reclassifying the student's own project", () => {
    const friend = "这是我朋友的项目。", own = "这是我的项目。";
    const next = update(profile(), "friend", friend, [fact("work.owner", "朋友", friend)]);
    expect(next.facts.find(row => row.field === "other.work.owner")).toMatchObject({ originalText: friend });
    expect(next.facts.some(row => row.field === "work.owner")).toBe(false);
    const self = update(next, "own", own, [fact("work.owner", "我", own)]);
    expect(self.facts.find(row => row.field === "work.owner")).toMatchObject({ originalText: own });
    expect(self.facts.find(row => row.field === "other.work.owner")).toMatchObject({ originalText: friend });
  });

  it("accepts an independent absence of written funding after reported discussion", async () => {
    const report = "老师说下周再讨论", denial = "没有书面报销安排", text = `${report}，${denial}。`;
    const initial = profile(["budget.responsibility", "equipment_access"]);
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, text, [], { ...source("funding", text),
      modelCall: async () => success([fact("other.teacher.statement", "下周讨论", report), fact("budget.writtenCommitment", false, denial)]) });
    expect(reply.profile?.facts.find(row => row.field === "other.teacher.statement")).toMatchObject({ originalText: report });
    expect(reply.profile?.facts.find(row => row.field === "budget.writtenCommitment")).toMatchObject({ state: "negated", originalText: denial,
      sourceSpan: { start: text.indexOf(denial), end: text.indexOf(denial) + denial.length } });
    expect(reply.profile?.unknownFields).toEqual(["budget.responsibility", "equipment_access"]);
    const quoted = `老师说：“${denial}。”`;
    const quotedResult = await extractSelfReportedFactsV7({ utterance: quoted, requestedFields: [], allowNewDomainFields: true },
      { modelCall: async () => success([fact("budget.writtenCommitment", false, denial)]) });
    expect(quotedResult.fallback).toBe(true);
  });

  it("ignores a redundant personal unknown projected only from an independently quoted report", async () => {
    const waiting = "团队总支出谁承担尚未定。", report = "老师说再商量", absence = "没有书面承担安排", utterance = `${report}，${absence}。`;
    const initial = update(profile(), "waiting", waiting, [fact("budget_responsibility", "尚未定", waiting, "unknown")]);
    const original = initial.facts.find(row => row.field === "budget_responsibility")!;
    const priorFacts = [fact("quoted.teacher.discussionStatus", "再商量", report), fact("budget_responsibility", "再商量", report, "unknown"),
      fact("budget_responsibility.writtenArrangement", "书面承担安排", absence, "negated")];
    const raw = success(priorFacts);
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, utterance, [], { ...source("funding-duplicate", utterance), modelCall: async () => raw });
    expect(reply.profile?.facts.filter(row => row.field === "budget_responsibility")).toEqual([original]);
    expect(reply.profile?.facts.find(row => row.field === "quoted.teacher.discussionStatus")).toMatchObject({ originalText: report });
    expect(reply.profile?.facts.find(row => row.field === "budget_responsibility.writtenArrangement")).toMatchObject({ originalText: absence, state: "negated" });
    expect(raw.data.facts).toEqual(priorFacts);

    const splitFacts = [priorFacts[1], fact("budget.writtenResponsibilityArrangement", false, absence, "negated")];
    const splitResponse = success(splitFacts);
    const splitRaw = { ...splitResponse, data: { ...splitResponse.data, unknownFields: ["budget_responsibility"] } };
    const split = await draftDecisionChatV7({ profile: initial, legacy }, utterance, [],
      { ...source("funding-split", utterance), modelCall: async () => splitRaw });
    expect(split.profile?.facts.filter(row => row.field === "budget_responsibility")).toEqual([original]);
    expect(split.profile?.facts.filter(row => row.originalText === report)).toEqual([expect.objectContaining({
      field: "quoted.statusContext", originalText: report, value: report, state: "affirmed", sourceSpan: { start: 0, end: report.length },
    })]);
    expect(split.profile?.facts).toContainEqual(expect.objectContaining({ field: "budget.writtenResponsibilityArrangement",
      originalText: absence, state: "negated", value: false }));
    expect(splitRaw.data.facts).toEqual(splitFacts);
  });

  it.each([
    ["老师说再商量", "没有书面承担安排", "equipment.access", false, "negated"],
    ["老师说再商量", "没有设备清单", "budget.writtenResponsibilityArrangement", false, "negated"],
    ["老师说再商量", "没有书面承担安排", "budget.writtenArrangement", true, "negated"],
    ["老师说可以报销", "没有书面承担安排", "budget.writtenArrangement", false, "negated"],
    ["同学表示等通知", "没有书面承担安排", "equipment.writtenArrangement", false, "negated"],
    ["老师说再商量", "已经书面承诺报销", "budget.writtenArrangement", false, "affirmed"],
  ] as const)("does not infer a personal state from unbound, conditional or committed reported speech: %s", async (report, predicate, field, conditional, state) => {
    const utterance = `${conditional ? "如果" : ""}${report}，${predicate}。`;
    const result = await extractSelfReportedFactsV7({ utterance, requestedFields: [], allowNewDomainFields: true },
      { modelCall: async () => success([fact("budget_responsibility", "未定", report, "unknown"), fact(field, state === "affirmed", predicate, state)]) });
    expect(result).toMatchObject({ fallback: true, error: "untraceable_extraction", facts: [] });
  });

  it("adopts a traceable written reimbursement denial with an unresolved attributed report", async () => {
    const report = "同学表示等通知", absence = "没有正式书面的报销安排", utterance = `${report}，${absence}。`;
    const result = await extractSelfReportedFactsV7({ utterance, requestedFields: [], allowNewDomainFields: true },
      { modelCall: async () => success([fact("funding.responsibility", "未定", report, "unknown"),
        fact("funding.writtenArrangement", false, absence)]) });
    expect(result.fallback).toBe(false);
    expect(result.facts).toEqual([fact("quoted.statusContext", report, report), fact("funding.writtenArrangement", false, absence, "negated")]);
  });

  it("keeps a previously confirmed room separate from the unique pending workshop on the named day", async () => {
    const application = "我申请了周六工坊时段", room = "已经预约的会议室号码是31";
    let initial = update(profile(), "application", `${application}。`, [fact("workshop.appliedTimeSlot", "周六工坊时段", application)]);
    initial = update(initial, "room", `${room}。`, [fact("meetingRoom.number", 31, room), fact("meetingRoom.reservationStatus", "reserved", room)]);
    const oldRoom = initial.facts.filter(row => row.field.startsWith("meetingRoom."));
    const status = "管理员确认预约", slot = "周六14点到16点", utterance = `${status}，${slot}。`;
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, utterance, [], { ...source("workshop-confirmation", utterance),
      modelCall: async () => success([fact("meetingRoom.reservationStatus", "confirmed", status), fact("meetingRoom.reservationTimeSlot", slot, slot)]) });
    expect(reply.profile?.facts.filter(row => row.field.startsWith("meetingRoom."))).toEqual(oldRoom);
    expect(reply.profile?.facts.find(row => row.field === "workshop.reservationTimeSlot")).toMatchObject({ value: slot, originalText: `${status}，${slot}` });

    const competitor = "我还申请了周六会议室时段";
    const ambiguous = update(initial, "second-application", `${competitor}。`, [fact("reservation.application", true, competitor)]);
    const unclear = await draftDecisionChatV7({ profile: ambiguous, legacy }, utterance, [], { ...source("ambiguous", utterance),
      modelCall: async () => success([fact("meetingRoom.reservationStatus", "confirmed", status), fact("meetingRoom.reservationTimeSlot", slot, slot)]) });
    expect(unclear.profile).toBeUndefined();
    expect(unclear.message).toContain("哪个空间");

    const alreadyBooked = "我已经预约周六的会议室", conflicting = update(initial, "same-day-booking", `${alreadyBooked}。`, [fact("room.booking", true, alreadyBooked)]);
    const uncertain = await draftDecisionChatV7({ profile: conflicting, legacy }, utterance, [], { ...source("same-day-ambiguous", utterance),
      modelCall: async () => success([fact("workshop.reservationStatus", "confirmed", status), fact("workshop.reservationTimeSlot", slot, slot)]) });
    expect(uncertain.profile).toBeUndefined();
    expect(uncertain.message).toContain("哪个空间");

    const explicit = "管理员确认了会议室预约", explicitText = `${explicit}，${slot}。`;
    const confirmed = await draftDecisionChatV7({ profile: ambiguous, legacy }, explicitText, [], { ...source("explicit-room", explicitText),
      modelCall: async () => success([fact("workshop.reservationStatus", "confirmed", explicit), fact("workshop.reservationTimeSlot", slot, slot)]) });
    expect(confirmed.profile?.facts).toContainEqual(oldRoom[0]);
    expect(confirmed.profile?.facts.find(row => row.field === "meetingRoom.reservationTimeSlot")).toMatchObject({ value: slot, originalText: `${explicit}，${slot}` });
    expect(confirmed.profile?.facts.some(row => row.field === "workshop.reservationTimeSlot")).toBe(false);
  });

  it.each([
    { bookings: [{ space: "会议室", day: "周六", field: "meetingRoom" }], ambiguous: true },
    { bookings: [{ space: "会议室", day: "周日", field: "meetingRoom" }], ambiguous: false },
    { bookings: [{ space: "会议室", day: "周六", field: "meetingRoom" }, { space: "实验室", day: "周六", field: "laboratory" }], ambiguous: true },
  ])("checks persisted explicit booking quotes before assigning a generic confirmation ($bookings)", async ({ bookings, ambiguous }) => {
    const application = "我申请了周六工坊时段";
    let current = update(profile(), "apply-workshop", `${application}。`, [fact("workshop.appliedTimeSlot", "周六工坊时段", application)]);
    for (const { space, day, field } of bookings) {
      const status = `管理员确认了${space}预约`, slot = `${day}14点到16点`, utterance = `${status}，${slot}。`;
      const reply = await draftDecisionChatV7({ profile: current, legacy }, utterance, [], { ...source(`book-${field}`, utterance),
        modelCall: async () => success([fact("reservation.status", "confirmed", status), fact("reservation.slot", slot, slot)]) });
      expect(reply.profile?.facts.find(row => row.field === `${field}.reservationTimeSlot`)).toMatchObject({ originalText: `${status}，${slot}` });
      current = reply.profile!;
    }

    const status = "管理员确认预约", slot = "周六14点到16点", utterance = `${status}，${slot}。`;
    const reply = await draftDecisionChatV7({ profile: current, legacy }, utterance, [], { ...source("generic-after-booking", utterance),
      modelCall: async () => success([fact("meetingRoom.reservationStatus", "confirmed", status), fact("meetingRoom.reservationTimeSlot", slot, slot)]) });
    if (ambiguous) {
      expect(reply.profile).toBeUndefined();
      expect(reply.message).toContain("哪个空间");
    } else {
      expect(reply.profile?.facts.find(row => row.field === "workshop.reservationTimeSlot")).toMatchObject({ value: slot });
      expect(reply.profile?.facts.find(row => row.field === "meetingRoom.reservationTimeSlot"))
        .toEqual(current.facts.find(row => row.field === "meetingRoom.reservationTimeSlot"));
    }
  });

  it("keeps the existing pending approval unchanged and still adopts an independent fact", async () => {
    const allowed = "材料已经授权课堂展示", pending = "竞赛公开展示仍在审批", utterance = `${allowed}，${pending}。`;
    const initial = update(profile(), "permission", utterance, [fact("display_permission.classroom", true, allowed), fact("display_permission.public", "审批中", pending)]);
    const guard = "上面的目标调整不等于展示审批已通过";
    const modelCall = vi.fn(async () => success([], [{ sourceText: guard, kind: "target" }]));
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, `${guard}。`, [], {
      ...source("approval-boundary", `${guard}。`), modelCall,
    });
    expect(modelCall).not.toHaveBeenCalled();
    expect(reply.profile).toBeUndefined();
    expect(reply.message).toContain("已保留");
    const training = "我已经看完培训视频", mixed = `${guard}。${training}。`;
    const mixedReply = await draftDecisionChatV7({ profile: initial, legacy }, mixed, [], { ...source("approval-and-training", mixed),
      modelCall: async () => success([fact("training.videoWatched", true, training)], [{ sourceText: guard, kind: "target" }]) });
    expect(mixedReply.profile?.facts.some(row => row.field === "display_permission.approvalInference")).toBe(false);
    expect(mixedReply.profile?.facts.find(row => row.field === "training.videoWatched")).toMatchObject({ originalText: training });
    expect(mixedReply.profile?.facts.find(row => row.field === "competition_display_permission")).toMatchObject({ state: "unknown", originalText: pending });
    expect(mixedReply.profile?.facts.find(row => row.field === "display_permission.classroom")).toMatchObject({ state: "affirmed", originalText: allowed });
  });

  it("updates a concrete public approval decision and allows a genuine withdrawal", async () => {
    const field = "competition_display_permission", pending = "竞赛公开展示仍在审批", denied = "更正：竞赛公开展示审批未通过。";
    const initial = update(profile(), "pending", pending, [fact(field, "审批中", pending)]);
    const denial = await draftDecisionChatV7({ profile: initial, legacy }, denied, [], { ...source("denied", denied),
      modelCall: async () => success([fact(field, false, denied, "negated")]) });
    expect(denial.profile?.facts.find(row => row.field === field)).toMatchObject({ state: "negated", originalText: denied });
    const approved = "竞赛公开展示审批已经通过", withdrawal = "我撤回竞赛公开展示已获批准的说法。";
    const before = update(profile(), "approved", approved, [fact(field, true, approved)]);
    const approvedId = before.facts.find(row => row.field === field)!.id;
    const withdrawn = await draftDecisionChatV7({ profile: before, legacy }, withdrawal, [], { ...source("withdraw-approval", withdrawal),
      modelCall: async () => success([fact(field, true, withdrawal, "retracted")]) });
    expect(withdrawn.profile?.retractedFactIds).toContain(approvedId);
    expect(withdrawn.profile?.facts.some(row => row.id === approvedId)).toBe(false);
  });

  it.each([
    { lead: "", resultField: "competition_display_permission" },
    { lead: "明确更正：", resultField: "competition_display_permission" },
    { lead: "", resultField: "display_permission.competition_public" },
  ])("replaces only the bound pending public display for a concrete approval ($lead$resultField)", async ({ lead, resultField }) => {
    const field = "competition_display_permission", classroom = "材料已经授权课堂展示", pending = "竞赛公开展示仍在审批";
    const first = `${classroom}，${pending}。`;
    let initial = update(profile(), "pending-and-classroom", first, [fact("display_permission.classroom", true, classroom), fact(field, "审批中", pending)]);
    const other = "乙项目在竞赛上公开展示仍待审批";
    initial = update(initial, "other-project", other, [fact(field, "审批中", other, "unknown")]);
    const old = initial.facts.find(row => row.originalText === pending)!;
    const untouched = initial.facts.filter(row => [classroom, other].includes(row.originalText ?? ""));
    const approved = `${lead}竞赛公开展示审批已经通过。`;
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, approved, [], { ...source("approved", approved),
      modelCall: async () => success([fact(resultField, "已通过", approved)]) });
    expect(reply.profile?.retractedFactIds).toContain(old.id);
    expect(reply.profile?.facts.some(row => row.id === old.id)).toBe(false);
    expect(reply.profile?.facts.find(row => row.originalText === approved)).toMatchObject({ state: "affirmed", field: resultField });
    for (const fact of untouched) expect(reply.profile?.facts).toContainEqual(fact);
    expect(reply.profile?.unknownFields).toContain(field);
  });

  it("uses a named project in the saved answer to disambiguate two pending approvals", async () => {
    const field = "competition_display_permission", pending = "本项目竞赛公开展示仍在审批";
    let initial = update(profile(), "alpha", `现在说明甲项目。${pending}。`, [fact(field, "审批中", pending, "unknown")]);
    const other = "乙项目竞赛公开展示仍在审批";
    initial = update(initial, "beta", other, [fact(field, "审批中", other, "unknown")]);
    const alpha = initial.facts.find(row => row.originalText === pending)!;
    const beta = initial.facts.find(row => row.originalText === other)!;
    const generic = "更正：竞赛公开展示审批已经通过。";
    const unscoped = await draftDecisionChatV7({ profile: initial, legacy }, generic, [], { ...source("generic", generic),
      modelCall: async () => success([fact(field, true, generic)]) });
    expect(unscoped.profile).toBeUndefined();
    expect(unscoped.message).toContain("哪一项竞赛公开展示");
    expect(update(initial, "unscoped-direct", generic, [fact(field, true, generic)])).toEqual(initial);

    const named = "甲项目在竞赛上公开展示审批已经通过。";
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, named, [], { ...source("named", named),
      modelCall: async () => success([fact(field, true, named)]) });
    expect(reply.profile?.retractedFactIds).toContain(alpha.id);
    expect(reply.profile?.facts).toContainEqual(beta);

    const another = "丙项目竞赛公开展示审批已经通过。";
    const separate = await draftDecisionChatV7({ profile: initial, legacy }, another, [], { ...source("another-project", another),
      modelCall: async () => success([fact(field, true, another)]) });
    expect(separate.profile?.facts).toContainEqual(alpha);
    expect(separate.profile?.facts).toContainEqual(beta);
    expect(separate.profile?.facts.find(row => row.originalText === another)).toMatchObject({ state: "affirmed" });
  });

  it("clarifies when two unqualified pending approval sources could be the target", async () => {
    const field = "competition_display_permission", before = "竞赛公开展示仍在审批", second = "竞赛公开展示尚待审批";
    let initial = update(profile(), "pending-1", before, [fact(field, "待批", before)]);
    initial = update(initial, "pending-2", second, [fact(field, "待批", second)]);
    expect(initial.facts.filter(row => row.field === field)).toHaveLength(2);
    const result = "竞赛公开展示审批已经通过。";
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, result, [], { ...source("unclear-approval", result),
      modelCall: async () => success([fact(field, true, result)]) });
    expect(reply.profile).toBeUndefined();
    expect(reply.message).toContain("哪一项竞赛公开展示");
    expect(update(initial, "unclear-direct", result, [fact(field, true, result)])).toEqual(initial);
  });

  it.each([false, "未通过"])("preserves explicit denial when the provider affirms a negative value (%s)", async value => {
    const field = "competition_display_permission", pending = "竞赛公开展示仍在审批", denied = "竞赛公开展示审批未通过。";
    const initial = update(profile(), "pending", pending, [fact(field, "待批", pending)]);
    const old = initial.facts.find(row => row.field === field)!;
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, denied, [], { ...source("literal-denial", denied),
      modelCall: async () => success([fact(field, value, denied)]) });
    expect(reply.profile?.retractedFactIds).toContain(old.id);
    expect(reply.profile?.facts.find(row => row.field === field)).toMatchObject({ value: false, state: "negated", originalText: denied });
  });

  it("clears the pending summary when the only bound approval is resolved through another field", async () => {
    const field = "competition_display_permission", pending = "竞赛公开展示仍在审批", approved = "竞赛公开展示审批已经通过。";
    const initial = update(profile(), "pending", pending, [fact(field, "审批中", pending)]);
    expect(initial.unknownFields).toContain(field);
    const resolved = await draftDecisionChatV7({ profile: initial, legacy }, approved, [], { ...source("resolved-alias", approved),
      modelCall: async () => success([fact("display_permission.competition_public", true, approved)]) });
    expect(resolved.profile?.unknownFields).not.toContain(field);
  });

  it("does not turn an application or a third-party approval into the student's permission", async () => {
    const field = "competition_display_permission", pending = "竞赛公开展示仍在审批";
    const initial = update(profile(), "pending", pending, [fact(field, "审批中", pending)]);
    const old = initial.facts.find(row => row.field === field)!;
    const submitted = "更正：竞赛公开展示申请已经提交。";
    const application = await draftDecisionChatV7({ profile: initial, legacy }, submitted, [], { ...source("submitted", submitted),
      modelCall: async () => success([fact(field, "已提交", submitted)]) });
    expect(application.profile?.facts).toContainEqual(old);
    expect(application.profile?.facts.find(row => row.field === `${field}.applicationSubmitted`)).toMatchObject({ originalText: submitted });
    const guard = "上面的目标调整不等于展示审批已通过。", skip = vi.fn(async () => success([]));
    const retained = await draftDecisionChatV7({ profile: application.profile!, legacy }, guard, [], { ...source("retained", guard), modelCall: skip });
    expect(skip).not.toHaveBeenCalled();
    expect(retained.profile).toBeUndefined();
    const report = "朋友说竞赛公开展示审批已经通过。";
    const external = await draftDecisionChatV7({ profile: application.profile!, legacy }, report, [], { ...source("external-approval", report),
      modelCall: async () => success([fact(`other.${field}`, "已通过", report)]) });
    expect(external.profile?.facts.filter(row => row.field === field)).toEqual([old]);
    expect(external.profile?.facts.find(row => row.field === `other.${field}`)).toMatchObject({ originalText: report });
  });

  it("accepts separately quoted old-page context while keeping the named document and goal", async () => {
    const document = "项目记录编号为校验记录", goal = "我的主要目标是完成校验报告";
    const initial = update(profile(), "document-and-goal", `${document}。${goal}。`, [fact("document_label", "校验记录", document), fact("primaryGoal", "完成校验报告", goal)]);
    const external = "旧网页的赛事届次不同", unchanged = "这句话没有修改我的文档名称或目标", utterance = `${external}，${unchanged}。`;
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, utterance, [], { ...source("retained", utterance),
      modelCall: async () => success([fact("other.oldPage.edition", "不同", external), fact("primaryGoal", "未修改", unchanged)], [{ sourceText: unchanged, kind: "target" }]) });
    expect(reply.profile?.primaryGoal).toBe("完成校验报告");
    expect(reply.profile?.facts.filter(row => row.field === "document_label" || row.field === "primaryGoal"))
      .toEqual(initial.facts.filter(row => row.field === "document_label" || row.field === "primaryGoal"));
    expect(reply.profile?.facts.find(row => row.field === "other.oldPage.edition")).toMatchObject({ originalText: external });
  });

  it("acknowledges an empty profile extraction for an attributed old edition and explicit unchanged controls", async () => {
    const initial = profile(), before = structuredClone(initial);
    const text = "旧版赛事页面的竞赛年份与本届不同，这条说明没有修改当前文档名称或主要目标。";
    const modelCall = vi.fn(async () => success([]));
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, text, [], { ...source("external-context-only", text), modelCall });
    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(reply).toEqual({ message: "已沿用现有信息，没有新增自述或改变已保留条件。", claims: [] });
    expect(initial).toEqual(before);
  });

  it("still processes or reports omissions of a real new goal next to an old-page control", async () => {
    const initial = profile(), note = "往届公告的比赛届次有出入，这句话没有修改我的文档名称或目标。";
    const goal = "我的主要目标是完成独立校验", text = note + goal + "。";
    const withGoal = await draftDecisionChatV7({ profile: initial, legacy }, text, [], { ...source("context-and-goal", text),
      modelCall: async () => success([fact("primaryGoal", "完成独立校验", goal)]) });
    expect(withGoal.profile?.primaryGoal).toBe("完成独立校验");
    const omitted = await draftDecisionChatV7({ profile: initial, legacy }, text, [], { ...source("goal-omitted", text),
      modelCall: async () => success([]) });
    expect(omitted.profile).toBeUndefined();
    expect(omitted.message).toContain("暂未解析成功");
  });

  it("answers a requested profile summary after an old-page control", async () => {
    const goal = "我的主要目标是完成原始记录校验";
    const initial = update(profile(), "goal", goal, [fact("primaryGoal", "完成原始记录校验", goal)]);
    const text = "往届公告的比赛届次有出入，这句话没有修改我的文档名称或目标。请总结我当前的档案。";
    const reply = await draftDecisionChatV7({ profile: initial, legacy }, text, [], { ...source("context-summary", text),
      modelCall: async () => success([]) });
    expect(reply.profile).toBeUndefined();
    expect(reply.claims.some(claim => claim.text.includes(goal))).toBe(true);
  });

  it("resolves only the named display and reporting aliases, retaining contest approval and unrelated unknowns", () => {
    const broad = "展示许可还没确认。", grant = "作品已经获准在课内演示", pending = "赛事公开演示仍待审批";
    const initial = update(profile(["display_permission", "competition_display_permission", "reporting_limit", "equipment_access"]), "old", broad,
      [fact("display_permission", "未确认", broad, "unknown")]);
    const classroomOnly = update(initial, "classroom", grant, [fact("display_permission.classroom", true, grant)]);
    expect(classroomOnly.unknownFields).toContain("display_permission");
    const split = update(initial, "scoped", `${grant}，${pending}。`, [fact("display_permission.classroom", true, grant), fact("display_permission.competition_public", "under_review", pending)]);
    expect(split.unknownFields).toEqual(["competition_display_permission", "reporting_limit", "equipment_access"]);
    expect(split.facts.find(row => row.field === "competition_display_permission")).toMatchObject({ state: "unknown", confirmed: false, originalText: pending });
    const control = "刚才的目标更正不代表展示审批已经通过。";
    const afterControl = update(split, "control", control, [fact("display_permission", "unknown", control, "unknown")]);
    expect(afterControl).toEqual(split);
    const restriction = "只可记录自己亲手检查过的材料。";
    const afterReporting = update(afterControl, "reporting", restriction, [fact("reporting.personalVerification", true, restriction)]);
    expect(afterReporting.unknownFields).toEqual(["competition_display_permission", "equipment_access"]);
  });

  it("keeps the same permission and reporting wording in the other person's scope", () => {
    const grant = "作品已经获准在课内演示", pending = "赛事公开演示仍待审批", restriction = "只可记录自己亲手检查过的材料";
    const unknown = ["display_permission", "reporting_limit"];
    const reported = update(profile(unknown), "friend", `朋友说：${grant}，${pending}，${restriction}。`, [
      fact("other.friend.classroom", true, grant), fact("other.friend.contest", "under_review", pending),
      fact("other.friend.reporting", true, restriction),
    ]);
    expect(reported.unknownFields).toEqual(unknown);
    expect(reported.facts.some(row => row.field === "competition_display_permission")).toBe(false);
    expect(reported.facts.filter(row => row.field.startsWith("other.friend.")).map(row => row.originalText)).toEqual([grant, pending, restriction]);
  });
});
