import { decodedGroupWire, matchingRelationReviewBallotFixture, serverBoundGroupReasonFixture, studentFactBasis } from "./group-reason-fixture";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withDecisionEffortPolicy } from "@/lib/ai/effort-context";
import { DEFAULT_EFFORT_POLICY, effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import { claim } from "@/lib/competitions/v6/engine";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { combineReviewedGroupPlanV7, createExplanationGroupSpecsV7, generateGroupExplanationV7, reviewPreparedGroupV7, type GroupRunBindingV7 } from "@/lib/competitions/v7/explanation-groups";
import { buildDecisionContextV7, matchExplanationInputV7 } from "@/lib/competitions/v7/model";
import { getMatchingCatalogRecords } from "@/lib/competitions/v7/catalog";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { matchReasonAnchorPrefixV7 } from "@/lib/competitions/v7/reason-anchor";
import { composeTaskConnectionV767, rankTaskFocusOptionsV7 } from "@/lib/competitions/v7/role-task-practice";

function fixture() {
  const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"], decisionContext: { goalIntent: "explore", goalResolution: "confirmed", experienceStatus: "none" } }), { records: Array.from({ length: 6 }, (_, index) => syntheticRecord(index + 1)) });
  const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, shortfallReason: null,
    recommendations: context.candidates.slice(0, 5).map(({ record }) => ({ itemId: record.recordId, reasons: [claim("内部排序提示。", "suggestion")] })) };
  return { context, plan };
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_match_projection_forbids_http"); })));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("new grouped matching-only generation", () => {
  it("separates positive fit facts from budget, negative permissions and withdrawn facts without changing context", () => {
    const { context, plan } = fixture(), base = context.profile.facts[0];
    const denied = { ...base, id: "s.public-denied", field: "work.publicUploadAllowed", value: false, state: "negated" as const, originalText: "作品不能公开。" };
    const withdrawn = { ...base, id: "s.withdrawn-skill", field: "skills", value: "programming", state: "retracted" as const, confirmed: false, originalText: "已撤回编程技能。" };
    const budget = { ...base, id: "s.zero-budget", field: "budget.maximumYuan", value: 0, originalText: "个人预算为零。" };
    context.profile.facts.push(denied, withdrawn, budget); context.profile.retractedFactIds.push(withdrawn.id);
    const before = structuredClone(context), input = matchExplanationInputV7(context, plan);
    expect(input.profile.facts.some(fact => [denied.id, withdrawn.id, budget.id].includes(fact.id))).toBe(false);
    expect(input.profile.constraintsOnly.facts).toEqual(expect.arrayContaining([denied, withdrawn, budget]));
    expect(input.candidates.map(item => item.itemId)).toEqual(plan.recommendations.map(item => item.itemId));
    for (const item of input.candidates) { expect(Object.keys(item)).toEqual(["itemId", "roles", "facts", "citationRules", "boundaries"]); expect(item.roles).toHaveLength(context.candidates.find(row => row.record.recordId === item.itemId)!.record.roles.length); expect(item.facts).toHaveLength(1); expect(item.citationRules.competitionFactIds).toEqual(item.facts.map(fact => fact.id)); expect(item.facts[0]).toMatchObject({ field: "task", kind: "official_fact", status: "historical", text: context.candidates.find(row => row.record.recordId === item.itemId)!.record.facts[0].text }); }
    expect(context).toEqual(before);
  });

  it("retains only an affirmed current stage as background when there is no fit fact", () => {
    const context = buildDecisionContextV7(student(), { records: [syntheticRecord(1)] });
    const input = matchExplanationInputV7(context, { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, recommendations: [], shortfallReason: "合成空名单。" });
    expect(input.profile.backgroundOnly).toBe(true); expect(input.profile.facts.map(fact => fact.field)).toEqual(["stage"]);
    expect(input.studentBasisOptions).toEqual([]);
  });

  it("supplies usable official deliverables alongside the selected roles with the original evidence IDs", () => {
    const { context, plan } = fixture(), record = context.candidates[0].record, base = record.facts[0];
    const deliverable = { ...base, id: "role-deliverable", field: "deliverables", text: "创作示例可采用五幅静态作品。" };
    record.facts.push(deliverable,
      { ...deliverable, id: "unverified-deliverable", status: "pending_review" },
      { ...deliverable, id: "editorial-deliverable", kind: "editorial_inference" });
    const before = structuredClone(context), input = matchExplanationInputV7(context, plan);
    expect(input.candidates[0].facts.map(fact => fact.id)).toContain(deliverable.id);
    expect(input.candidates[0].facts.find(fact => fact.id === deliverable.id)).toMatchObject({ id: deliverable.id, field: deliverable.field,
      text: deliverable.text, kind: deliverable.kind, status: deliverable.status, scope: deliverable.scope, sourceIds: deliverable.sourceIds });
    expect(input.candidates[0].facts.map(fact => fact.id)).not.toContain("unverified-deliverable");
    expect(input.candidates[0].facts.map(fact => fact.id)).not.toContain("editorial-deliverable");
    expect(context).toEqual(before);
  });

  it("retains legacy experience and goals while treating every other open field only as a constraint", () => {
    const { context, plan } = fixture(), base = context.profile.facts[0];
    const experience = { ...base, id: "s.own-experience", field: "experience", value: "本人做过传感器程序调试", originalText: "本人做过传感器程序调试" };
    const constraint = { ...base, id: "s.task-limit", field: "constraints", value: "只愿做程序与资料，不做焊接", originalText: "只愿做程序与资料，不做焊接" };
    const resource = { ...base, id: "s.lab-limit", field: "laboratory_access", value: "无实验室权限", originalText: "无实验室权限" };
    const stage = { ...base, id: "s.stage", field: "stage", value: "undergraduate-2" };
    context.profile.facts = [experience, constraint, resource, stage];
    context.profile.goals = ["形成本人代码与验证报告"]; context.profile.primaryGoal = context.profile.goals[0];
    const input = matchExplanationInputV7(context, plan);
    expect(input.profile.facts).toEqual([experience]); expect(input.profile.backgroundOnly).toBe(false);
    expect(input.profile.goals).toEqual(context.profile.goals); expect(input.profile.primaryGoal).toBe(context.profile.primaryGoal);
    expect(input.profile.constraintsOnly.facts).toEqual([constraint, resource, stage]);
    expect([...input.profile.facts, ...input.profile.constraintsOnly.facts].map(fact => fact.id).sort()).toEqual(context.profile.facts.map(fact => fact.id).sort());
  });

  it("retains raw task preferences verbatim while negative and withdrawn states remain constraints", () => {
    const { context, plan } = fixture(), base = context.profile.facts[0];
    const raw = { ...base, id: "s.raw-task", field: "taskFormats.raw", value: "我只愿整理资料，不愿焊接", originalText: "我只愿整理资料，不愿焊接", evidenceLevel: "self_report" as const };
    const negative = { ...raw, id: "s.raw-negative", state: "negated" as const, value: false };
    const withdrawn = { ...raw, id: "s.raw-withdrawn", state: "retracted" as const, confirmed: false };
    context.profile.facts.push(raw, negative, withdrawn);
    const input = matchExplanationInputV7(context, plan);
    expect(input.profile.facts).toContainEqual(raw);
    expect(input.profile.facts.some(fact => [negative.id, withdrawn.id].includes(fact.id))).toBe(false);
    expect(input.profile.constraintsOnly.facts).toEqual(expect.arrayContaining([negative, withdrawn]));
  });

  it("keeps affirmed resource wording, ownership, unknowns and retractions raw without manufacturing availability or citations", () => {
    const { context, plan } = fixture(), base = context.profile.facts[0];
    const resourceFacts = [
      { ...base, id: "s.friend-permission", field: "resources.condition1", value: "朋友已获准使用其项目文件，我的材料权限尚未知。", label: "朋友已获准使用其项目文件，我的材料权限尚未知。", originalText: "朋友已获准使用其项目文件，我的材料权限尚未知。", state: "affirmed" as const },
      { ...base, id: "s.obtainable-device", field: "obtainableResource", value: "有机会争取电脑使用权。", label: "有机会争取电脑使用权。", originalText: "有机会争取电脑使用权。", state: "affirmed" as const },
      { ...base, id: "s.denied-network", field: "resources.network", value: false, label: "当前不能使用该网络。", originalText: "当前不能使用该网络。", state: "negated" as const },
      { ...base, id: "s.withdrawn-device", field: "resources.computer", value: "撤回设备可用的说法。", label: "撤回设备可用的说法。", originalText: "撤回设备可用的说法。", state: "retracted" as const, confirmed: false },
    ];
    context.profile.facts.push(...resourceFacts); context.profile.retractedFactIds.push("s.withdrawn-device");
    const bound = { ...plan, recommendations: plan.recommendations.map((item, index) => ({ ...item, rankRoleIndex: 0,
      reasons: [claim(index === 0 ? "现有电脑可完成任务，这是待核排序计划，不能当资源事实。" : `第${index + 1}项原任务的待核排序计划。`, "suggestion")] })) };
    const before = structuredClone({ context, bound }), input = matchExplanationInputV7(context, bound);
    expect(input.profile.constraintsOnly.facts).toEqual(expect.arrayContaining(resourceFacts));
    expect(input.profile.facts.some(fact => resourceFacts.some(resource => resource.id === fact.id))).toBe(false);
    expect(input.profile.constraintsOnly.retractedFactIds).toContain("s.withdrawn-device");
    for (const [index, candidate] of input.candidates.entries()) {
      expect(candidate.fixedRoleIndex).toBe(0); expect(candidate.internalRationale).toEqual(bound.recommendations[index].reasons);
      expect(candidate.facts).toEqual(matchExplanationInputV7(context, plan).candidates[index].facts);
      expect(candidate.citationRules.competitionFactIds).toEqual(candidate.facts.map(fact => fact.id));
      expect(candidate.facts.some(fact => fact.text === bound.recommendations[index].reasons[0].text)).toBe(false);
    }
    input.candidates[0].internalRationale![0].text = "修改投影不能反写原排序计划。";
    expect({ context, bound }).toEqual(before);
  });

  it("keeps full-context aliases and assembles one reviewed bridge without rewriting the response", async () => {
    await withDecisionEffortPolicy(DEFAULT_EFFORT_POLICY, async () => {
      const { context, plan } = fixture(), studentFact = context.profile.facts.find(fact => fact.field === "skills")!;
      const run: GroupRunBindingV7 = { runId: randomUUID(), stateKey: "match-only-offline", generation: 0, implementationSha256: "a".repeat(64), effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), detailDeadlineEpochMs: Date.now() + 90_000 };
      const [spec] = createExplanationGroupSpecsV7(context, plan, run);
      const fields = serverBoundGroupReasonFixture("数据分析与建模能帮助理解同一数据清理决定怎样影响结果，以及报告为什么要求可追溯。");
      let rawResponse: { recommendations: { rowIndex: number; reason: { factIndex: number; studentBasisIndices: number[] } & typeof fields; roleIndex: number }[] } | undefined;
      const result = await generateGroupExplanationV7(context, plan, spec, { requestId: run.runId, runBinding: run, deadlineEpochMs: run.detailDeadlineEpochMs - 750, modelCall: async (prompt, options) => {
        const wire = decodedGroupWire(prompt);
        expect(wire).not.toHaveProperty("profile");
        expect(wire).not.toHaveProperty("groupSpec");
        expect(wire).not.toHaveProperty("practicePreferences");
        expect(wire).not.toHaveProperty("learningMode");
        expect(wire.candidates.every((candidate: object) => !Object.hasOwn(candidate, "learningMode"))).toBe(true);
        expect(wire.studentBasisOptions).toContainEqual({ index: 0, kind: "reported_skill", text: "数据分析与建模" });
        expect(prompt).not.toMatch(/@[CFPS]\d+/u);
        expect(options).toMatchObject({ thinking: "enabled", reasoningEffort: "low", maxAttempts: 1 });
        const data = { schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: wire.groupBindingSha256, groupId: spec.groupId, profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, shortfallReason: null,
          recommendations: spec.itemIds.map((_itemId, rowIndex) => ({ rowIndex, reason: {
            factIndex: 0, studentBasisIndices: [0], ...fields,
          }, roleIndex: 0 })) };
        expect(options.systemPrompt).toContain("taskConnection只解释一个具体联系");
        expect(options.systemPrompt).toContain("无需安排操作、核对表、成果或实验");
        expect(options.systemPrompt).toContain("尊重学生实际限制和只读目标");
        expect(options.systemPrompt).toContain("不另写学生经历、已有资料或重复已引事实");
        expect(options.systemPrompt).not.toMatch(/taskRelation|practicePreferences|prerequisite|learningMode/u);
        for (const extra of [
          { text: "要交付设计说明、主要图纸和比例样机。" },
          { text: "可先了解官方题面和样例。" },
          { text: "你没有现成实验条件。" },
          { conditions: ["现有条件只有常温"] },
          { basis: "inference" },
          { learningLens: "evidence_comparison" },
          { practice: "旧练习不属于当前信封" },
          { futureUse: "一项练习\n额外分工" },
          { prerequisite: " " },
          { taskConnection: { mode: "understand", taskPoint: "原任务对象" } },
          { taskRelation: { mode: "understand", taskPoint: "原任务对象", prerequisite: "工具可用" } },
          { taskRelation: { mode: "apply", taskPoint: "原任务对象", learnerQuote: "附加学生旧说法" } },
          { check: " " },
          { connection: " " },
          { bridge: "旧自由段不属于当前信封" },
          { studentBasisIndices: [] },
          { studentBasisIndices: [0, 0] },
          { studentFactIds: [studentFact.id] },
        ]) {
          const invalid = structuredClone(data); Object.assign(invalid.recommendations[0].reason, extra);
          expect(options.schema!.safeParse(invalid).success).toBe(false);
        }
        const { reason, roleIndex, ...itemId } = data.recommendations[0];
        const duplicate = { ...data, recommendations: [{ ...itemId, roleIndex, reasons: [reason, { ...reason, studentBasisIndices: [], goalIndex: 0 }] }] };
        expect(options.schema!.safeParse(duplicate).success).toBe(false);
        expect(options.schema!.safeParse({ ...data, recommendations: [{ ...itemId, reason }] }).success).toBe(false);
        expect(options.schema!.safeParse({ ...data, recommendations: [{ ...itemId, roleIndex, reason: { ...reason, goalIndex: 0 } }] }).success).toBe(true);
        const negativeAnchor = structuredClone(data); negativeAnchor.recommendations[0].reason.factIndex = -1;
        expect(options.schema!.safeParse(negativeAnchor).success).toBe(false);
        const twoAnchors = structuredClone(data); Object.assign(twoAnchors.recommendations[0].reason, { factIndex: [0, 1] });
        expect(options.schema!.safeParse(twoAnchors).success).toBe(false);
        rawResponse = data;
        return { ok: true, data, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 };
      } });
      expect(rawResponse!.recommendations.map(item => item.reason)).toEqual(spec.itemIds.map(() => ({ factIndex: 0,
        studentBasisIndices: [0], taskConnection: fields.taskConnection })));
      expect(result.prepared.explanation.taskSelections?.map(item => item.taskConnection)).toEqual(spec.itemIds.map(() => fields.taskConnection));
      expect(result.prepared.assertions.every(row => row.reason.basis === "inference")).toBe(true);
      expect(rawResponse!.recommendations.every(item => !Object.hasOwn(item, "roleReason"))).toBe(true);
      for (const row of result.prepared.assertions) {
        const record = context.candidates.find(candidate => candidate.record.recordId === row.itemId)!.record;
        const fact = record.facts[0];
        expect(row.reason.text).toBe(`${matchReasonAnchorPrefixV7(fact)}你提到「数据分析与建模」。\n可选分工（编辑建议）「数据整理」：${record.roles[0].task}\n匹配关系：${composeTaskConnectionV767(studentFactBasis(), fields.taskConnection)}`);
        expect(row.reason.competitionFactIds).toEqual([fact.id]);
        expect(row.reason.studentFactIds).toEqual([studentFact.id]); expect(row.reason.conditions).toEqual([]);
      }
    });
  });

  it("keeps both explicit targets when only the reader's knowledge of the sources changes", async () => {
    // The v755 robustness pair used the same Kick Start track fact. The
    // perturbed draft imported the unrelated output-format fact into its check.
    const records = getMatchingCatalogRecords().filter(record =>
      record.seriesId === "google-kick-start" && record.track.id === "round-a-speed-typing"
      || record.seriesId === "china-college-computer-design" && record.track.id === "ai-industrial-vision");
    expect(records).toHaveLength(2);
    const legacy = student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] });
    const seen = "我只见到一个标题和链接，尚未读官方正文；不要因此声称所有规则已经核实。";
    const goal = "形成有依据的任务与成果对照";
    const kept: string[][] = [];
    const success = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const,
      httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });
    for (const perturbed of [false, true]) {
      const context = buildDecisionContextV7(legacy, { records, profileId: randomUUID() });
      context.profile.primaryGoal = goal;
      context.profile.goals = [goal];
      const own = context.profile.facts.find(fact => fact.field === "skills")!;
      if (perturbed) context.profile.facts.push({ ...own, id: "s.quoted-source-authority", field: "quoted.sourceAuthority",
        value: "unknown", label: seen, originalText: seen, state: "unknown", confirmed: false, evidenceLevel: "unknown" });
      const taskFact = (seriesId: string) => {
        const record = context.candidates.find(row => row.record.seriesId === seriesId)!.record;
        const fact = record.facts.find(row => ["task", "track", "deliverables"].includes(row.field) && row.kind === "official_fact")!;
        return { itemId: record.recordId, record, fact };
      };
      const programming = taskFact("google-kick-start"), vision = taskFact("china-college-computer-design");
      expect(programming.fact.id).toBe("google-kick-start:v2:track");
      const format = programming.record.facts.find(fact => fact.text.includes("Case #x"))!;
      expect(format.id).not.toBe(programming.fact.id);
      const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
        recommendations: [programming, vision].map(({ itemId, fact }) => ({ itemId, reasons: [claim(fact.text, "official", [], [fact.id])] })),
        shortfallReason: "本项事实核验只解释指定的两项。" };
      const run: GroupRunBindingV7 = { runId: randomUUID(), stateKey: "explicit-two-offline", generation: 0,
        implementationSha256: "a".repeat(64), effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), detailDeadlineEpochMs: Date.now() + 150_000 };
      const [spec] = createExplanationGroupSpecsV7(context, plan, run);
      const options = { requestId: run.runId, runBinding: run, deadlineEpochMs: run.detailDeadlineEpochMs - 750 };
      const response = (prompt: string, wrongAnchor: boolean) => {
        const wire = expandCandidateEvidence(expandMatchingTables(decodedGroupWire(prompt))) as { groupBindingSha256: string; studentGoalOptions: unknown[];
          candidates: { rowIndex: number; specifiedExcerpt: { text: string }; evidenceOptions?: unknown }[] };
        expect(wire).not.toHaveProperty("learningMode");
        expect(wire.studentGoalOptions).toEqual([{ index: 0, kind: "future_goal", text: goal }]);
        expect(wire.candidates.map(item => item.specifiedExcerpt.text)).toEqual([programming.fact.text, vision.fact.text]);
        expect(wire.candidates.map(item => item.rowIndex)).toEqual([0, 1]);
        expect(wire.candidates.every(item => item.evidenceOptions === undefined)).toBe(true);
        expect(prompt).not.toMatch(/@[CFPS]\d+/u);
        expect(prompt).not.toContain("Case #x");
        expect(prompt).not.toContain(seen);
        return success({ schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: wire.groupBindingSha256, groupId: spec.groupId,
          profileRevision: plan.profileRevision, catalogVersion: plan.catalogVersion, shortfallReason: plan.shortfallReason, recommendations: [
            { rowIndex: 0, roleIndex: 0, reason: { ...(wrongAnchor ? { factIndex: 1 } : {}), studentBasisIndices: [], goalIndex: 0,
              taskConnection: "由目标串和实际输入的保序关系，了解删除数量何时可以求得，何时应是不可行。" } },
            { rowIndex: 1, roleIndex: 0, reason: { studentBasisIndices: [], goalIndex: 0,
              taskConnection: "由原文的分类、计数、缺陷、尺寸和编号，了解各类视觉识别结果要说明什么。" } },
          ] });
      };
      const explain = vi.fn(async (prompt: string) => response(prompt, false));
      const { prepared } = await generateGroupExplanationV7(context, plan, spec, { ...options, modelCall: explain });
      expect(explain).toHaveBeenCalledTimes(1);
      const review = vi.fn(async (prompt: string) => {
        const wire = decodedGroupWire(prompt);
        expect(wire.assertions).toHaveLength(2);
        expect(wire.profile.facts.some((fact: { originalText?: string }) => fact.originalText === seen)).toBe(perturbed);
        expect(wire.assertions.every((row: { reason: { text: string } }) => !row.reason.text.includes("Case #x"))).toBe(true);
        return success({ checks: wire.assertions.map((row: { key: string }) => matchingRelationReviewBallotFixture(row.key, "离线注入审核票。")) });
      });
      const { reviewed } = await reviewPreparedGroupV7(context, plan, prepared, { ...options, modelCall: review,
        persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: run.runId, groupId: spec.groupId,
          groupBindingSha256: prepared.groupBindingSha256, preparedSha256: prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 },
        persistReviewPreparation: async () => {},
      });
      expect(review).toHaveBeenCalledTimes(1);
      const final = combineReviewedGroupPlanV7(context, plan, [{ prepared, reviewed }], run);
      kept.push(final.recommendations.map(row => row.itemId));
      if (perturbed) {
        const swap = vi.fn(async (prompt: string) => response(prompt, true));
        await expect(generateGroupExplanationV7(context, plan, spec, { ...options, modelCall: swap }))
          .rejects.toMatchObject({ issues: [`explicit_fact_anchor_changed:${programming.itemId}`] });
        expect(swap).toHaveBeenCalledTimes(1);
      }
    }
    expect(kept).toEqual([kept[0], kept[0]]);
    expect(kept[0]).toHaveLength(2);
  });

  it.each([
    "把原始任务与交付边界讲清楚",
    "辨别可执行步骤与官方要求",
    "保留历史范围而不误报当前报名",
    "比较需要完成的产出和评审依据",
    "形成有依据的任务与成果对照",
    "只读来源并核对引文",
    "制作实体样机并现场测量，然后核对原始任务与交付要求",
    "先核对官方要求，再自己搭建实体原型并实测",
  ])("preserves the complete goal without imposing a practice mode: %s", async goal => {
    const { context, plan } = fixture();
    context.profile.primaryGoal = goal;
    context.profile.goals = [goal];
    const readingOnly = goal === "只读来源并核对引文";
    const onlyPaper = "只用纸面原型";
    const mixed = "同伴获准公开他的原型，我只在自己的作品获准公开后才会展示。";
    const unresolved = "目前无法确认我是否可以借用电脑。";
    const currentConstraint = { field: "constraints", state: "affirmed", confirmed: true, use: "constraints_and_counterevidence_only" };
    const constraint = (id: string, text: string) => ({ ...context.profile.facts[0], id, field: "constraints", value: text,
      label: text, originalText: text, state: "affirmed" as const, confirmed: true, evidenceLevel: "self_report" as const });
    context.profile.facts.push(constraint("s.planned-format", "先用可点击原型"));
    if (readingOnly) context.profile.facts.push(
      constraint("s.reading-only", "只阅读公开题面"), constraint("s.only-paper", onlyPaper),
      { ...constraint("s.conditional-publication", mixed), value: "conditional", state: "conditional", confirmed: false },
      { ...constraint("s.unknown-computer", unresolved), value: "unknown", state: "unknown", confirmed: false },
    );
    const run: GroupRunBindingV7 = { runId: randomUUID(), stateKey: "goal-mode-offline", generation: 0,
      implementationSha256: "a".repeat(64), effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), detailDeadlineEpochMs: Date.now() + 150_000 };
    const [spec] = createExplanationGroupSpecsV7(context, plan, run);
    const captured = new Error("offline_goal_mode_captured");
    await expect(generateGroupExplanationV7(context, plan, spec, { requestId: run.runId, runBinding: run,
      deadlineEpochMs: run.detailDeadlineEpochMs - 750, modelCall: async prompt => {
        const wire = decodedGroupWire(prompt);
        expect(wire.studentGoalOptions).toEqual([{ index: 0, kind: "future_goal", text: goal }]);
        expect(wire.sourceReadingOnly).toBe(readingOnly ? true : undefined);
        if (readingOnly) {
          expect(wire.currentLimits).toEqual([
            { ...currentConstraint, text: "只阅读公开题面" },
            { ...currentConstraint, text: onlyPaper },
            { ...currentConstraint, state: "conditional", confirmed: false, text: mixed, value: "conditional" },
            { ...currentConstraint, state: "unknown", confirmed: false, text: unresolved, value: "unknown" },
          ]);
          expect(wire.studentBasisOptions.every((option: { text: string }) => ![onlyPaper, mixed, unresolved].includes(option.text))).toBe(true);
        }
        expect(prompt).not.toMatch(/learningMode|learningFocus|practicePreferences|declaredLearningGoal|先用可点击原型/u);
        throw captured;
      },
    })).rejects.toBe(captured);
  });

  it("keeps the unsupported CUPT sixth problem outside the selected official fact", async () => {
    const record = getMatchingCatalogRecords().find(row => row.seriesId === "china-undergraduate-physics-tournament")!;
    const context = buildDecisionContextV7(student(), { records: [record] });
    const goal = "保留历史范围而不误报当前报名";
    context.profile.primaryGoal = goal;
    context.profile.goals = [goal];
    const anchor = record.facts.find(fact => fact.id === "china-undergraduate-physics-tournament:v2:track")!;
    expect(anchor.text).not.toContain("第6题");
    expect(record.deepDive?.workedExample.sourceBoundary).toContain("已读第6题完整题干");
    const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
      recommendations: [{ itemId: record.recordId, reasons: [claim(anchor.text, "official", [], [anchor.id])] }], shortfallReason: "固定事实核验一项。" };
    const run: GroupRunBindingV7 = { runId: randomUUID(), stateKey: "cupt-explicit-offline", generation: 0,
      implementationSha256: "a".repeat(64), effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), detailDeadlineEpochMs: Date.now() + 150_000 };
    const [spec] = createExplanationGroupSpecsV7(context, plan, run);
    const options = { requestId: run.runId, runBinding: run, deadlineEpochMs: run.detailDeadlineEpochMs - 750 };
    const result = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const,
      httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });
    const { prepared } = await generateGroupExplanationV7(context, plan, spec, { ...options, modelCall: async prompt => {
      const wire = expandCandidateEvidence(expandMatchingTables(decodedGroupWire(prompt))) as { groupBindingSha256: string; candidates: unknown[]; studentGoalOptions: unknown[] };
      expect(wire.studentGoalOptions).toEqual([{ index: 0, kind: "future_goal", text: goal }]);
      expect(wire.candidates[0]).toMatchObject({ rowIndex: 0, specifiedExcerpt: { text: anchor.text, scope: anchor.scope } });
      expect(wire.candidates[0]).not.toHaveProperty("evidenceOptions");
      expect(prompt).not.toContain("已读第6题完整题干");
      expect(prompt).not.toMatch(/@[CFPS]\d+/u);
      return result({ schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: wire.groupBindingSha256, groupId: spec.groupId,
        profileRevision: plan.profileRevision, catalogVersion: plan.catalogVersion, shortfallReason: plan.shortfallReason,
        recommendations: [{ rowIndex: 0, roleIndex: 0, reason: { studentBasisIndices: [], goalIndex: 0,
          taskConnection: "已读第6题题干能帮助区分历史题面的已给条件和待查范围。" } }] });
    } });
    expect(prepared.explanation.recommendations[0].reasons[0].competitionFactIds).toEqual([anchor.id]);
    const { reviewed } = await reviewPreparedGroupV7(context, plan, prepared, { ...options, modelCall: async prompt => {
      const wire = decodedGroupWire(prompt);
      expect(wire.assertions[0].competitionItems[0].citedFacts[0].text).toBe(anchor.text);
      expect(wire.assertions[0].reason.text).toContain("已读第6题题干");
      expect(JSON.stringify(wire.sharedCandidateBoundaries)).toContain("已读第6题完整题干");
      return result({ checks: [matchingRelationReviewBallotFixture(wire.assertions[0].key, "第6题题干超出所引规则。", { source: false })] });
    }, persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: run.runId, groupId: spec.groupId,
      groupBindingSha256: prepared.groupBindingSha256, preparedSha256: prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 },
    persistReviewPreparation: async () => {} });
    expect(reviewed.checks.every(check => !check.supported)).toBe(true);
    expect(() => combineReviewedGroupPlanV7(context, plan, [{ prepared, reviewed }], run)).toThrow("NO_SUPPORTED_RECOMMENDATIONS");
  });

  it.each([true, false])("binds the current CUPT problem source before review and projects the object-specific verdict (%s)", async supported => {
    const records = getMatchingCatalogRecords();
    const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records });
    const record = context.candidates.find(candidate => candidate.record.seriesId === "china-undergraduate-physics-tournament")!.record;
    const taskFact = record.facts.find(fact => fact.id === "china-undergraduate-physics-tournament:v2:task")!;
    const provisional = record.facts.find(fact => fact.id === "china-undergraduate-physics-tournament:v2:track")!;
    expect(taskFact).toMatchObject({ kind: "official_fact", status: "historical", sourceIds: ["iypt-2020-problem6"] });
    expect(taskFact.text).toContain("Saxon Bowl");
    expect(provisional.sourceIds).toEqual(["cupt-2020-rules"]);
    const personal = context.profile.facts.find(fact => fact.field === "skills")!;
    const experience = "用小模型比较遮阳角度和室温变化";
    Object.assign(personal, { field: "experience.1.task", originalText: experience, value: experience, label: experience });
    const task = rankTaskFocusOptionsV7(record.roles[0].task).find(step => step.text === "记录误差并比较模型预测与观察")!;
    const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
      recommendations: [{ itemId: record.recordId, rankRoleIndex: 0, rankTaskStepIndex: task.index,
        reasons: [claim("用公开题研究比较条件和结果的一步。", "inference", [personal.id], [provisional.id])] }], shortfallReason: "离线任务证据对照。" };
    const unchangedPlan = structuredClone(plan);
    const run: GroupRunBindingV7 = { runId: randomUUID(), stateKey: "cupt-same-owner-source-offline", generation: 0,
      implementationSha256: "a".repeat(64), effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), detailDeadlineEpochMs: Date.now() + 150_000 };
    const [spec] = createExplanationGroupSpecsV7(context, plan, run);
    const options = { requestId: run.runId, runBinding: run, deadlineEpochMs: run.detailDeadlineEpochMs - 750 };
    const reply = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const,
      httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });
    const taskConnection = supported ? "比较条件与结果的思路有助于理解有孔碗沉没时间怎样对应不同候选参数。" :
      "这个赛题可只改变遮阳小模型的角度，记录室温读数并与预测并列。";
    const { prepared } = await generateGroupExplanationV7(context, plan, spec, { ...options, modelCall: async (prompt, request) => {
      const wire = JSON.parse(prompt), [row] = wire.candidates;
      expect(row.learnerBasisOptions).toEqual([{ index: 0, kind: "student_fact", factKind: "reported_experience", text: experience }]);
      expect(row.roles[0].taskOptions).toEqual([task]);
      expect(row.evidenceOptions[row.rankedSelection.factIndex].text).toBe(provisional.text);
      const selected = row.evidenceOptions.find((choice: { text: string }) => choice.text === taskFact.text);
      expect(selected).toMatchObject({ kind: "official_fact", status: "historical", scope: taskFact.scope });
      expect(request.systemPrompt).toContain("优先选本行evidenceOptions中确有该对象的原文");
      expect(prompt).not.toContain(taskFact.id);
      return reply({ schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: wire.groupBindingSha256,
        groupId: spec.groupId, profileRevision: plan.profileRevision, catalogVersion: plan.catalogVersion, shortfallReason: plan.shortfallReason,
        recommendations: [{ rowIndex: 0, reason: { factIndex: selected.factIndex, taskConnection } }] });
    } });
    expect(prepared.explanation.taskSelections).toEqual([expect.objectContaining({ itemId: record.recordId, roleIndex: 0,
      taskStepIndex: task.index, competitionFactId: taskFact.id, learnerBasisSelection: studentFactBasis() })]);
    expect(prepared.explanation.recommendations[0].reasons[0].competitionFactIds).toEqual([taskFact.id]);
    const { reviewed } = await reviewPreparedGroupV7(context, plan, prepared, { ...options,
      persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: run.runId, groupId: spec.groupId,
        groupBindingSha256: prepared.groupBindingSha256, preparedSha256: prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 },
      persistReviewPreparation: async () => {}, modelCall: async (prompt, request) => {
        const wire = decodedGroupWire(prompt), [row] = wire.assertions;
        expect(row.selectedTaskFocus).toBe(task.text);
        expect(row.competitionItems[0].citedFacts).toEqual([expect.objectContaining({ text: taskFact.text, sourceIds: ["iypt-2020-problem6"] })]);
        expect(row.competitionItems[0].sources).toEqual([expect.objectContaining({ id: "iypt-2020-problem6" })]);
        expect(row.reason.text).toBe(taskConnection);
        expect(row).not.toHaveProperty("relationMode");
        expect(row).not.toHaveProperty("actionPrerequisite");
        expect(request.systemPrompt).toContain("符合本项citedFacts和sources");
        // A predetermined verdict tests the real review and binding path without provider traffic.
        return reply({ checks: [matchingRelationReviewBallotFixture(row.key, supported ? "原题对象与未来核对对应" : "练习替换了原题对象", { fit: supported })] });
      },
    });
    expect(plan).toEqual(unchangedPlan);
    expect(reviewed.checks.every(row => row.supported === supported)).toBe(true);
    expect(reviewed.itemOutcomes[0].status).toBe(supported ? "ready" : "failed");
  });
});
