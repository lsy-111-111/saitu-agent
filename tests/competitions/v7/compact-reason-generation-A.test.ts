import { decodedGroupWire, goalBasis, matchingRelationReviewBallotFixture, studentFactBasis } from "./group-reason-fixture";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EFFORT_POLICY, effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import { claim } from "@/lib/competitions/v6/engine";
import { matchPlanSchema, type MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { buildDecisionContextV7, compactMatchReasonTextSchemaV7, countCompactReasonCharactersV7, matchExplanationInputV7, projectReviewedReasonsV7, validateDecisionReportV7, validateMatchPlanV7 } from "@/lib/competitions/v7/model";
import { assembleReviewedGroupDetailsV7, assembleReviewedGroupsReportV7, combineReviewedGroupPlanV7, createExplanationGroupSpecsV7, generateGroupExplanationV7, groupCallKeyV7, groupCanonicalSha256V7, isReviewedFinalSelectionVersionV7, reviewPreparedGroupV7, validatePreparedGroupV7, validateReviewedGroupV7, type GroupReviewPreparationV7, type PreparedGroupExplanationV7, type ReviewedPreparedGroupV7, type UniqueGroupJournalCallV7 } from "@/lib/competitions/v7/explanation-groups";
import { matchReasonAnchorPrefixV7 } from "@/lib/competitions/v7/reason-anchor";
import { composeGroundedBridgeReasonV7, MATCHING_RELATION_LABEL_V764, isComposedLearningReasonV7, isGroundedBridgeReasonV7, studentLearningOptionsV7, type GroundedBridgeSelectionV7 } from "@/lib/competitions/v7/match-learning-selection";
import { MATCHING_RELATION_REVIEW_CONTRACT_V767 } from "@/lib/competitions/v7/review-transport";
import { composeTaskConnectionV767, composeRankBoundTaskPracticeBridgeV7, rankTaskFocusOptionsV7, readRankBoundTaskPracticeBridgeV7, roleTaskStepOptionsV7, taskPracticeSelectionSchemaV7, taskPracticeTextIssueV7 } from "@/lib/competitions/v7/role-task-practice";
import { student, syntheticRecord } from "../v6/decision-fixtures";

const compactPractice = "对照同一对象的处理前后记录";
const compactCheck = "查差异能否追溯到原文。";
const compactConnection = "同一对象的处理前后记录如何对照。";
function publicConnectionText(text: string) {
  const relation = text.split("\n匹配关系：")[1];
  return relation.slice(relation.indexOf("。") + 1);
}
function fixture(count = 1, taskFact?: string) {
  const records = Array.from({ length: 6 }, (_, index) => syntheticRecord(index + 1));
  if (taskFact !== undefined) records[0].facts[0].text = taskFact;
  records[0].suitability.uncertainties.push("设备使用权和个人支出尚未确认。");
  const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records });
  const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
    recommendations: context.candidates.slice(0, count).map(({ record }) => ({ itemId: record.recordId, reasons: [claim("内部排序提示，不是学生可见的匹配理由。", "suggestion")] })),
    shortfallReason: count < 5 ? "合成测试仅选择既定数量，不测试排序适配质量。" : null };
  const run = { runId: randomUUID(), stateKey: "compact-model-offline", generation: 0, implementationSha256: "a".repeat(64), effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), detailDeadlineEpochMs: Date.now() + 150_000 };
  const personal = context.profile.facts.find(fact => fact.field === "skills")!;
  const specs = createExplanationGroupSpecsV7(context, plan, run);
  return { context, plan, run, specs, personal };
}
const success = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });
function envelope(f: ReturnType<typeof fixture>, prompt: string) {
  const wire = decodedGroupWire(prompt), spec = f.specs.find(value => value.groupId === wire.groupId)!;
  return { schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: wire.groupBindingSha256, groupId: spec.groupId,
    profileRevision: f.context.profile.revision, catalogVersion: f.context.catalogVersion, shortfallReason: f.plan.shortfallReason,
    recommendations: spec.itemIds.map((itemId, rowIndex) => {
      const initial = f.plan.recommendations.find(row => row.itemId === itemId)!;
      const factIndex = initial.reasons[0].basis === "official" ? undefined : 0;
      const studentBasisIndex = studentLearningOptionsV7(f.context.profile).facts.findIndex(fact => fact.id === f.personal.id);
      return { rowIndex, reason: { ...(factIndex === undefined ? {} : { factIndex }), studentBasisIndices: [studentBasisIndex],
        taskConnection: compactConnection }, roleIndex: 0 };
    }) };
}
function rankBoundEnvelope(f: ReturnType<typeof fixture>, prompt: string) {
  const { recommendations, ...header } = envelope(f, prompt);
  const wire = decodedGroupWire(prompt);
  return { ...header, recommendations: recommendations.map(({ rowIndex, reason: { taskConnection } }) =>
    ({ rowIndex, reason: { taskConnection, learnerBasisIndex: 0,
      factIndex: wire.candidates[rowIndex].rankedSelection.factIndex as number } })) };
}
function rankedBasisFixture() {
  const f = fixture();
  const rankedGoal = "把问卷观察整理成可核对的数据表";
  const secondGoal = "练习用图表说明样本的差别";
  const experience = "我自己核对过社团调查的原始记录。";
  const second = { ...f.personal, id: "s.other-basis", answerId: "a.other-basis", field: "experience.1.task",
    label: experience, value: experience, originalText: experience };
  f.context.profile.facts.push(second);
  f.context.profile.primaryGoal = rankedGoal;
  f.context.profile.goals = [rankedGoal, secondGoal];
  return { ...f, second, rankedGoal };
}
function anchored(f: ReturnType<typeof fixture>, itemId: string): string {
  const record = f.context.candidates.find(row => row.record.recordId === itemId)!.record, role = record.roles[0];
  return `${matchReasonAnchorPrefixV7(record.facts[0])}你提到「数据分析与建模」。\n可选分工（编辑建议）「${role.name}」：${role.task}\n匹配关系：${composeTaskConnectionV767(studentFactBasis(), compactConnection)}`;
}
beforeEach(() => {
  vi.stubEnv("SAITU_V7_DETAIL_LAYOUT", "single");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("compact_offline_test_forbids_http"); }));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("compact reason generation and presentation boundary", () => {
  it("keeps both historical final-selection formats and recognizes the current task-step format", () => {
    expect(isReviewedFinalSelectionVersionV7("saitu-explain.v7.48.final-reviewed-selection")).toBe(true);
    expect(isReviewedFinalSelectionVersionV7("saitu-explain.v7.50.server-bound-reason")).toBe(true);
    expect(isReviewedFinalSelectionVersionV7("saitu-explain.v7.52.server-bound-task-step")).toBe(true);
    expect(isReviewedFinalSelectionVersionV7("saitu-explain.v7.53.structured-task-practice")).toBe(true);
    expect(isReviewedFinalSelectionVersionV7("saitu-explain.v7.64.bound-matching-relation")).toBe(true);
    expect(isReviewedFinalSelectionVersionV7("saitu-explain.v7.65.axis-reviewed-matching-relation")).toBe(true);
    expect(isReviewedFinalSelectionVersionV7("saitu-explain.v7.66.bound-task-relation")).toBe(true);
    expect(isReviewedFinalSelectionVersionV7("saitu-explain.v7.67.bound-task-connection")).toBe(true);
    expect(isReviewedFinalSelectionVersionV7("saitu-explain.v7.47.focused-future-bridge")).toBe(false);
  });

  it("offers original task clauses while keeping combined objects and scoped tasks intact", () => {
    const ordinary = "设计输入、状态与反馈，检查分支和边界";
    expect(roleTaskStepOptionsV7(ordinary)).toEqual([
      { index: 0, text: ordinary }, { index: 1, text: "设计输入、状态与反馈" }, { index: 2, text: "检查分支和边界" },
    ]);
    for (const scoped of ["在获准条件下采集记录，核对对象变化", "设计测试，不能接入外部电源", "比较处理前，处理后记录",
      "核对资料（报告，附录），记录缺页", "整理记录，且保留未确认的项目", "整理原始记录\n比较同一对象前后变化"]) {
      expect(roleTaskStepOptionsV7(scoped)).toEqual([{ index: 0, text: scoped }]);
    }
    const choice = { competitionFactIds: ["task"], taskStepIndex: 0, practice: "可核对来源", check: "列出缺少日期的记录" };
    expect(taskPracticeSelectionSchemaV7.safeParse(choice).success).toBe(true);
    expect(taskPracticeSelectionSchemaV7.safeParse({ ...choice, practice: "练习；核对：伪造分隔" }).success).toBe(false);
    expect(taskPracticeSelectionSchemaV7.safeParse({ ...choice, check: "\n" }).success).toBe(false);
  });

  it("does not split a bare conjunction inside a task word or lose a comparison side", () => {
    const combined = "整理合并分析结果并记录误差";
    expect(rankTaskFocusOptionsV7(combined)).toEqual([{ index: 0, text: combined }]);
    const explicit = "整理合并分析结果，并记录误差";
    expect(rankTaskFocusOptionsV7(explicit)).toEqual([
      { index: 0, text: explicit }, { index: 1, text: "整理合并分析结果" }, { index: 2, text: "记录误差" },
    ]);
    const comparison = "比较处理前，处理后记录";
    expect(rankTaskFocusOptionsV7(comparison)).toEqual([{ index: 0, text: comparison }]);
  });

  it("omits the duplicate sentence ending before the check and still reads stored v754 punctuation", () => {
    const focus = "对照处理前与处理后记录";
    const check = "检查两列是否使用同一个对象。";
    const practice = "可对照公开原文中的同一对象。";
    expect(composeRankBoundTaskPracticeBridgeV7(focus, { practice, check })).toBe(
      `聚焦「${focus}」。练习：可对照公开原文中的同一对象；核对：${check}`);
    expect(readRankBoundTaskPracticeBridgeV7(focus, `聚焦「${focus}」。练习：${practice}；核对：${check}`)).toBe(
      `练习：${practice}；核对：${check}`);
  });

  it("rejects invented prior methods and internal IDs while allowing legitimate person references", () => {
    const rawId = "a_9c5296c5e6a6423386fb2e60f2818757";
    for (const practice of [
      "借序列比对核验公开样例的分层核对法整理",
      "把小模型比较遮阳角度与室温时先定变量再比结果的做法用于填表",
      "再用此表定位自己情景讨论卡上记录的一处理解错误",
      "像你校准传感器后用烘干对照追溯读数那样为每组写来源",
      "检查自己讨论卡上一处提问",
      "用自己测试选择理解时“对方选完能否说出理由”作为判定标准",
      "用自己测试选择理解时追问“为何这样选”的问法",
    ]) expect(taskPracticeTextIssueV7({ practice, check: compactCheck }, [rawId])).toBe("student_attribution");
    for (const check of [`按${rawId}的字段检查。`, "对照＠Ｃ１９所列条件。", "对照@F231里的步骤。"]) {
      expect(taskPracticeTextIssueV7({ practice: compactPractice, check }, [rawId])).toBe("internal_identifier");
    }
    for (const practice of [
      "对照《儿童权利你我他》第三课设计一个口述理由的问题",
      "设计一个让儿童解释自己选择理由的问题",
      "你可以先把两类记录放进一张自拟核对表",
      "待确认样本有公开授权后，可将本人未来整理的比较结果按条件归档",
    ]) expect(taskPracticeTextIssueV7({ practice, check: compactCheck }, [rawId])).toBeUndefined();
  });

  it.each([180, 300])("accepts %i Unicode characters without imposing that limit on stored claims", length => {
    expect(compactMatchReasonTextSchemaV7.safeParse("学".repeat(length - 1) + "🧭").success).toBe(true);
    expect(matchPlanSchema.safeParse(fixture().plan).success).toBe(true);
  });

  it.each([70, 100])("retains a historical %i-character claim without treating it as new generation", length => {
    const f = fixture(), historical = { ...f.plan, recommendations: f.plan.recommendations.map(item => ({ ...item, reasons: [claim("学".repeat(length), "suggestion")] })) };
    const before = structuredClone(historical);
    expect(matchPlanSchema.safeParse(historical).success).toBe(true);
    expect(compactMatchReasonTextSchemaV7.safeParse(historical.recommendations[0].reasons[0].text).success).toBe(false);
    expect(historical).toEqual(before);
  });

  it("does not count internal whitespace as matching explanation content", () => {
    expect(compactMatchReasonTextSchemaV7.safeParse("学".repeat(179) + " \n\t ").success).toBe(false);
    expect(compactMatchReasonTextSchemaV7.safeParse("学".repeat(180) + " \n\t ").success).toBe(true);
  });

  it.each([169, 173, 301])("retains and records %i characters without a repair", async length => {
    const f = fixture(), itemId = f.plan.recommendations[0].itemId, observe = vi.fn();
    const fact = f.context.candidates[0].record.facts[0];
    fact.text = "学".repeat(length - countCompactReasonCharactersV7(anchored(f, itemId)) + countCompactReasonCharactersV7(fact.text));
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const call = vi.fn(async (prompt: string) => success(envelope(f, prompt)));
    const result = await generateGroupExplanationV7(f.context, f.plan, f.specs[0], { requestId: f.run.runId, runBinding: f.run,
      deadlineEpochMs: f.run.detailDeadlineEpochMs - 750, modelCall: call, onObservation: observe });
    expect(call).toHaveBeenCalledTimes(1);
    expect(result.prepared.explanation.recommendations[0].reasons[0].text).toBe(anchored(f, itemId));
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ stage: "v7.explain", kind: "validation", data: expect.objectContaining({
      reasonCharacterCounts: [{ itemId: f.plan.recommendations[0].itemId, characters: length }],
    }) }));
  });

  it.each([
    { fact: "报告明确说明仅四人参加访谈，并分别列出访谈记录与观察记录。", supported: true },
    { fact: "报告分别呈现设备测试记录与测量偏差说明。", supported: true, resourceUnknown: true },
    { fact: "材料仅核实一份活动的署名和提交日期。", supported: false, editorialTask: true },
  ])("keeps the task text and leaves learner-and-role relevance to the joint review ($supported)", async ({ fact, supported, resourceUnknown, editorialTask }) => {
    const f = fixture(1, fact);
    if (resourceUnknown) f.context.profile.facts.push({ ...f.personal, id: "s.unknown-resource", field: "resources.lab_access", value: "unknown",
      label: "场地与设备许可未知。", originalText: "场地与设备许可未知。", state: "unknown", confirmed: false, evidenceLevel: "unknown" });
    if (editorialTask) f.context.candidates[0].record.roles[0].task = "可选练习：设计理解问题与四维自评表。";
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const spec = f.specs[0], itemId = spec.itemIds[0];
    const expected = anchored(f, itemId);
    const options = { requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750 };
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...options, modelCall: async (prompt, request) => {
      expect(request.systemPrompt).toContain("从本行evidenceOptions选择支持所写对象、操作或判据的原文");
      const wire = decodedGroupWire(prompt);
      expect(wire).not.toHaveProperty("practicePreferences");
      if (resourceUnknown) expect(wire.currentLimits).toContainEqual({ field: "resources.lab_access", state: "unknown",
        confirmed: false, text: "场地与设备许可未知。", value: "unknown", use: "constraints_and_counterevidence_only" });
      expect(request.systemPrompt).toContain("标题或代码标记");
      return success(envelope(f, prompt));
    } });
    const review = vi.fn(async (prompt: string, options: { systemPrompt?: string }) => {
      expect(prompt).toContain(fact);
      if (resourceUnknown) expect(prompt).toContain("场地与设备许可未知");
      if (editorialTask) expect(prompt).toContain("可选练习：设计理解问题与四维自评表");
      expect(options.systemPrompt).toContain("角色背景与反证不补正证");
      const wire = decodedGroupWire(prompt);
      expect(wire.assertions).toHaveLength(1);
      expect(wire.fixedOrder.groupReview.purpose).toBe(MATCHING_RELATION_REVIEW_CONTRACT_V767);
      expect(wire.fixedOrder.groupReview).not.toHaveProperty("reasonAssembly");
      expect(wire.reviewContract).toBe(MATCHING_RELATION_REVIEW_CONTRACT_V767);
      expect(wire.assertions[0].reason.text).toBe(publicConnectionText(expected));
      expect(wire.assertions[0]).not.toHaveProperty("relationMode");
      expect(wire.assertions[0]).not.toHaveProperty("actionPrerequisite");
      return success({ checks: [matchingRelationReviewBallotFixture(wire.assertions[0].key,
        supported ? "有据关联，保留原条件。" : "材料未证数据分析环节。", { fit: supported })] });
    });
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, prepared, { ...options, persisted: {
      schemaVersion: "saitu.persisted-group-explanation.v1", runId: f.run.runId, groupId: spec.groupId, groupBindingSha256: prepared.groupBindingSha256,
      preparedSha256: prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1,
    }, persistReviewPreparation: async () => {}, modelCall: review });
    expect(review).toHaveBeenCalledTimes(1);
    const ready = assembleReviewedGroupDetailsV7(f.context, f.plan, prepared, reviewed, f.run);
    expect(ready.map(item => item.reasons[0].text)).toEqual(supported ? [expected] : []);
    expect(prepared.explanation.recommendations[0].reasons[0].text).toBe(expected);
    expect(() => validatePreparedGroupV7(f.context, f.plan, prepared, f.run)).not.toThrow();
    const changed = structuredClone(prepared), item = changed.explanation.recommendations.find(row => row.itemId === itemId)!;
    item.reasons[0].text = item.reasons[0].text.replace("可选分工（编辑建议）", "必须承担的分工");
    item.roleReason = structuredClone(item.reasons[0]);
    expect(() => validatePreparedGroupV7(f.context, f.plan, changed, f.run)).toThrow("invalid_output");
    item.reasons[0].text = expected + "额外推断";
    item.roleReason = structuredClone(item.reasons[0]);
    expect(() => validatePreparedGroupV7(f.context, f.plan, changed, f.run)).toThrow(
      expect.objectContaining({ issues: expect.arrayContaining([`invalid_learning_reason:${itemId}`]) }));
  });

  it.each([
    { bridge: "样机方案中的功能观察怎样按同一口径对照，哪些差异需要复核。", supported: true },
    { bridge: "先整理比赛必须交的设计说明、主要图纸和比例样机，再作数据对照。", supported: false },
    { bridge: "从官方题面和样例取出测试记录，再按同一口径对照。", supported: false },
  ])("preserves the published alternatives and jointly reviews every bridge assertion ($supported)", async ({ bridge, supported }) => {
    const task = "交报名材料、设计说明、主要图纸、实物或比例样机，以及不超过3分钟的功能视频。";
    const f = fixture(1, task), record = f.context.candidates[0].record;
    Object.assign(record.roles[0], { name: "样机方案与材料整理", task: "对照样机方案并整理功能观察记录" });
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const [spec] = f.specs;
    const options = { requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750 };
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...options,
      modelCall: async (prompt, request) => {
        const value = envelope(f, prompt); value.recommendations[0].reason.taskConnection = bridge;
        expect(request.schema!.safeParse(value).success).toBe(true);
        return success(value);
      },
    });
    const expected = `${matchReasonAnchorPrefixV7(record.facts[0])}你提到「数据分析与建模」。\n可选分工（编辑建议）「样机方案与材料整理」：${record.roles[0].task}\n匹配关系：${composeTaskConnectionV767(studentFactBasis(), bridge)}`;
    expect(prepared.explanation.recommendations[0].reasons[0].text).toBe(expected);
    expect(prepared.criticalKeys).toHaveLength(2);
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, prepared, { ...options,
      persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: f.run.runId, groupId: spec.groupId,
        groupBindingSha256: prepared.groupBindingSha256, preparedSha256: prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 },
      persistReviewPreparation: async () => {}, modelCall: async (prompt, request) => {
        const wire = decodedGroupWire(prompt);
        expect(wire.assertions[0].reason.text).toBe(publicConnectionText(expected));
        expect(request.systemPrompt).toContain("实际声称的规则、作者、对象、数值、结果与范围符合本项citedFacts和sources");
        return success({ checks: [matchingRelationReviewBallotFixture(wire.assertions[0].key,
          supported ? "有据的可选数据对照。" : "含本条未证的义务或样例。", { source: supported })] });
      },
    });
    expect(assembleReviewedGroupDetailsV7(f.context, f.plan, prepared, reviewed, f.run).map(item => item.reasons[0].text)).toEqual(supported ? [expected] : []);
  });

  it.each([
    {
      bridge: "不同测量位置的读数怎样用于比较预测和观察，哪些差异值得复核观测误差。",
      fact: "观察记录对照事前预测和现场读数，并标注不同测量位置。",
      role: "观测与判断",
      task: "比较预测与观察，说明哪些解释得到支持，再整理结果图表",
      goal: "学会读懂温度记录的变化与观测误差",
      supported: true,
    },
    {
      bridge: "情境提问中，选择某个安全步骤的理由怎样暴露对该步骤的理解缺口。",
      fact: "公开教学案例使用情境讨论，让参与者口述选择理由，并由老师记录。",
      role: "教学提问设计",
      task: "分析情境与目标，设计让学习者说明理由的问题",
      goal: "把公开安全说明改成易懂的学习材料，并检查理解缺口",
      supported: true,
    },
    {
      bridge: "执行装置的功能检查，分别记录预期输出和测试结果。",
      fact: "公开教学案例使用情境讨论，让参与者口述选择理由，并由老师记录。",
      role: "教学提问设计",
      task: "分析情境与目标，设计让学习者说明理由的问题",
      goal: "把公开安全说明改成易懂的学习材料，并检查理解缺口",
      supported: false,
    },
  ])("preserves the concrete bridge to $role through the joint verdict ($supported)", async example => {
    const f = fixture(1, example.fact), record = f.context.candidates[0].record;
    Object.assign(record.roles[0], { name: example.role, task: example.task });
    f.context.profile.primaryGoal = example.goal;
    f.context.profile.goals = [example.goal];
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const [spec] = f.specs;
    const basis = goalBasis;
    const expected = `${matchReasonAnchorPrefixV7(record.facts[0])}你的目标是「${example.goal}」。\n可选分工（编辑建议）「${example.role}」：${example.task}\n匹配关系：${composeTaskConnectionV767(basis, example.bridge)}`;
    const options = { requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750 };
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...options, modelCall: async (prompt, request) => {
      expect(request.systemPrompt).toContain("taskConnection");
      const raw = envelope(f, prompt), choice = raw.recommendations[0].reason;
      Object.assign(choice, { goalIndex: 0, studentBasisIndices: [], taskConnection: example.bridge });
      expect(request.schema!.safeParse(raw).success).toBe(true);
      return success(raw);
    } });
    const restored = JSON.parse(JSON.stringify(prepared)) as PreparedGroupExplanationV7;
    expect(() => validatePreparedGroupV7(f.context, f.plan, restored, f.run)).not.toThrow();
    const item = restored.explanation.recommendations[0];
    expect(item.reasons[0].text).toBe(expected);
    expect(isGroundedBridgeReasonV7(record.facts[0], { ...record.roles[0], task: "替换过的任务" }, item.reasons[0], studentLearningOptionsV7(f.context.profile))).toBe(false);
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, restored, { ...options,
      persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: f.run.runId, groupId: spec.groupId,
        groupBindingSha256: restored.groupBindingSha256, preparedSha256: restored.preparedSha256, persistedResultVersion: 1, groupVersion: 1 },
      persistReviewPreparation: async () => {}, modelCall: async (prompt, request) => {
        const wire = decodedGroupWire(prompt);
        expect(wire.assertions[0].reason.text).toBe(publicConnectionText(expected));
        expect(wire.assertions[0].explicitStudentGoal).toBe(example.goal);
        expect(wire.assertions[0].reviewPurposes).toEqual(["recommendation_fit", "selected_role_action"]);
        expect(wire.assertions[0].reason.studentFactIds).toEqual([]);
        expect(wire.assertions[0].citedStudentFacts).toEqual([]);
        expect(request.systemPrompt).toContain("了解该环节可以成立");
        expect(request.systemPrompt).toContain("泛题材、通用整理或只核出处不够");
        return success({ checks: [matchingRelationReviewBallotFixture(wire.assertions[0].key,
          example.supported ? "学生目标与同角色有据环节有关。" : "装置测试不支持教学提问。", { fit: example.supported })] });
      },
    });
    expect(assembleReviewedGroupDetailsV7(f.context, f.plan, restored, reviewed, f.run).map(item => item.reasons[0].text)).toEqual(example.supported ? [expected] : []);
  });

  it.each([
    {
      label: "independent skill and weighing experience",
      student: "我会用电子表格，曾协助称量家中盆栽浇水前后的质量。",
      fact: "资料列出一次处理前后的重量观测记录及重复测量结果。",
      task: "整理质量变化记录，检查结果对观测误差的敏感性",
      good: "用表格区分前后称量的记录和重复读数，可以理解哪些质量变化仍需复核。",
      bad: "把称量盆栽浇水前后质量时用电子表格记账的做法，用来整理一组质量随时间变化的记录。",
    },
    {
      label: "public-source skill with an unreported past method",
      student: "我会整理公开资料，但没有教学实验经验。",
      fact: "作者按不同受众组织公开说明和互动方案，并列出不同讲解材料。",
      task: "根据受众组织材料，并自拟理解检查问题",
      good: "原文的受众分层怎样组织不同说明材料，并为每类受众的理解检查提供依据。",
      bad: "可把学生整理公开资料时按来源和读者分类的做法，用于给该科普作品画一张受众分层表。",
    },
    {
      label: "personal cost calculation without a retained expense ledger",
      student: "我在校园义卖时算过个人材料费用。",
      fact: "作者的公开成本表区分材料费用和固定投入，并列出两年的变化。",
      task: "读公开成本表，辨认不同成本类别对年度变化的影响",
      good: "原表将材料费用与固定投入分开，便于理解单项材料费用的计算怎样进入年度成本比较。",
      bad: "可用你已有的材料费用台账对照原表，辨认材料费用和固定投入的年度变化。",
    },
  ].flatMap(example => [{ ...example, bridge: example.good, supported: true }, { ...example, bridge: example.bad, supported: false }]))(
    "keeps the real provenance for $label and passes only the supported task connection ($supported)", async example => {
      const f = fixture(1, example.fact), record = f.context.candidates[0].record;
      Object.assign(f.personal, { value: example.student, originalText: example.student, label: example.student,
        sourceSpan: { start: 0, end: example.student.length } });
      record.roles[0].task = example.task;
      f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
      const [spec] = f.specs;
      const options = { requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750 };
      const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...options, modelCall: async (prompt, request) => {
        expect(request.systemPrompt).toContain("taskConnection");
        const raw = envelope(f, prompt);
        raw.recommendations[0].reason.taskConnection = example.bridge;
        expect(request.schema!.safeParse(raw).success).toBe(true);
        expect(request.schema!.safeParse({ ...raw, reasonAssembly: "grounded_optional_bridge_v1" }).success).toBe(false);
        return success(raw);
      } });
      const expected = `${matchReasonAnchorPrefixV7(record.facts[0])}你提到「${example.student}」。\n可选分工（编辑建议）「数据整理」：${example.task}\n匹配关系：${composeTaskConnectionV767(studentFactBasis(), example.bridge)}`;
      const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, prepared, { ...options,
        persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: f.run.runId, groupId: spec.groupId,
          groupBindingSha256: prepared.groupBindingSha256, preparedSha256: prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 },
        persistReviewPreparation: async () => {}, modelCall: async (prompt, request) => {
          const wire = decodedGroupWire(prompt);
          expect(wire.fixedOrder.groupReview.purpose).toBe(MATCHING_RELATION_REVIEW_CONTRACT_V767);
          expect(wire.assertions[0].reason.text).toBe(publicConnectionText(expected));
          expect(wire.assertions[0].reviewPurposes).toEqual(["recommendation_fit", "selected_role_action"]);
          expect(wire.assertions[0].citedStudentFacts).toEqual([expect.objectContaining({ originalText: example.student })]);
          expect(request.systemPrompt).toContain("learnerBasisSelection指向完整所选原话或目标");
          expect(request.systemPrompt).toContain("保留主体、时态、否定和条件");
          return success({ checks: [matchingRelationReviewBallotFixture(wire.assertions[0].key,
            example.supported ? "学生依据与具体任务有关。" : "原话未证实该做法或已有材料。", { learnerAttribution: example.supported })] });
        },
      });
      expect(reviewed.checks.map(row => row.supported)).toEqual([example.supported, example.supported]);
      expect(assembleReviewedGroupDetailsV7(f.context, f.plan, prepared, reviewed, f.run).map(item => item.reasons[0].text))
        .toEqual(example.supported ? [expected] : []);
    });

  it("preserves v743 and v744 assembly rules and requires the exact v745 prefix", () => {
    const f = fixture(), record = f.context.candidates[0].record, role = record.roles[0], fact = record.facts[0];
    const options = studentLearningOptionsV7(f.context.profile);
    const v743 = claim(`${matchReasonAnchorPrefixV7(fact)}你提到「数据分析与建模」。从「数据整理」这项可选分工入手，可以练习把设计思路落实为可检查的步骤，并区分预期结果和实际表现。`,
      "inference", [f.personal.id], [fact.id]);
    const v744 = claim(`${matchReasonAnchorPrefixV7(fact)}你提到「数据分析与建模」。\n可选分工（编辑建议）「${role.name}」：${role.task}\n学习用途：可以练习把程序或装置的设计拆成可以实际运行的功能检查，分别记录预期输出与测试结果。`,
      "inference", [f.personal.id], [fact.id]);
    const v745 = composeGroundedBridgeReasonV7(fact, role, { competitionFactIds: [fact.id], studentFactIds: [f.personal.id], bridge: compactPractice }, options)!;
    expect(isComposedLearningReasonV7(fact, role, v743, options, true)).toBe(true);
    expect(isComposedLearningReasonV7(fact, role, v743, options)).toBe(false);
    expect(isComposedLearningReasonV7(fact, role, v744, options, true)).toBe(false);
    expect(isComposedLearningReasonV7(fact, role, v744, options)).toBe(true);
    expect(isGroundedBridgeReasonV7(fact, role, v744, options)).toBe(false);
    expect(isGroundedBridgeReasonV7(fact, role, v745, options)).toBe(true);
    expect(isGroundedBridgeReasonV7(fact, role, { ...v745, text: `${v745.text}\n额外分工：改写原任务。` }, options)).toBe(false);
  });

  it("keeps the original task object distinct from a student's other domain through generation, restore and review", async () => {
    const f = rankedBasisFixture(), record = f.context.candidates[0].record;
    const experience = "我在社团项目里比较过屋顶遮阳前后的温度记录。";
    Object.assign(f.second, { originalText: experience, value: experience, label: experience });
    record.roles[0].task = "整理外套通风路径记录、核查缺失值，比较处理前与处理后记录";
    const original = record.facts[0];
    const anchor = { ...original, id: `${original.id}.observations`, text: "对比外套两种开口布置的通风路径记录，并解释差异。" };
    record.facts.push(anchor);
    const limit = "只能选用已公开且去标识化的记录。";
    f.context.profile.facts.push({ ...f.personal, id: "s.limit", answerId: "a.limit", field: "constraints",
      label: limit, value: limit, originalText: limit });
    f.context.profile.facts.push({ ...f.personal, id: "s.old-limit", answerId: "a.old-limit", field: "budget.maximumYuan",
      label: "此前自付上限300元", value: 300, originalText: "此前自付上限300元", confirmed: false, state: "retracted" });
    f.context.profile.retractedFactIds.push("s.old-limit");
    const ranked = f.plan.recommendations[0];
    ranked.rankRoleIndex = 0;
    ranked.rankGoalIndex = 0;
    const focus = rankTaskFocusOptionsV7(record.roles[0].task).find(step => step.text === "比较处理前与处理后记录")!;
    ranked.rankTaskStepIndex = focus.index;
    ranked.reasons = [claim("用自报数据分析能力核对处理前后的记录。", "inference", [f.personal.id, f.second.id], [anchor.id])];
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const structured = { taskConnection: "原文两种外套开口的通风路径怎样按同一位置作前后对照。", learnerBasisIndex: 1 };
    const expectedBridge = composeTaskConnectionV767(studentFactBasis(1), structured.taskConnection);
    const validChoice: GroundedBridgeSelectionV7 = { competitionFactIds: [anchor.id],
      studentFactIds: [f.personal.id, f.second.id], goalIndex: 0, bridge: expectedBridge };
    const options = { requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750 };
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, f.specs[0], {
      ...options,
      modelCall: async (prompt, request) => {
        const wire = expandCandidateEvidence(expandMatchingTables(decodedGroupWire(prompt))) as {
          candidates: Array<{ rowIndex: number }>;
          currentLimits: unknown[];
        };
        expect(wire).not.toHaveProperty("studentBasisOptions");
        expect(wire).not.toHaveProperty("studentGoalOptions");
        expect(wire.candidates[0]).not.toHaveProperty("internalRationale");
        expect(wire.candidates[0]).not.toHaveProperty("provisionalRankRelation");
        expect(wire.candidates[0]).toMatchObject({ rowIndex: 0,
          rankedSelection: { taskStepIndex: focus.index, factIndex: 1 },
          evidenceOptions: expect.arrayContaining([{ factIndex: 1, text: anchor.text, scope: anchor.scope, kind: anchor.kind, status: anchor.status }]),
          roles: [{ task: record.roles[0].task, taskOptions: [focus] }],
          learnerBasisOptions: [{ index: 0, kind: "student_fact", factKind: "reported_skill", text: "数据分析与建模" },
            { index: 1, kind: "student_fact", factKind: "reported_experience", text: f.second.originalText },
            { index: 2, kind: "goal", text: f.rankedGoal }] });
        expect(request.systemPrompt).toContain("原焦点为完整角色时可在该角色列出的任务选项中收窄");
        expect(request.systemPrompt).toContain("taskConnection");
        expect(request.systemPrompt).toContain("学生依据只选索引");
        expect(wire).not.toHaveProperty("practicePreferences");
        expect(wire.candidates[0]).not.toHaveProperty("learningMode");
        expect(wire.candidates[0]).not.toHaveProperty("fixedStudentBasis");
        expect(wire.candidates[0]).not.toHaveProperty("rankBasisGoal");
        expect(wire).not.toHaveProperty("profile");
        expect(prompt).not.toContain(f.second.id);
        expect(prompt).not.toContain(f.context.profile.goals[1]);
        expect(wire.currentLimits).toContainEqual({ field: "constraints", state: "affirmed", confirmed: true,
          text: limit, use: "constraints_and_counterevidence_only" });
        expect(prompt).not.toContain("此前自付上限300元");
        const raw = rankBoundEnvelope(f, prompt);
        raw.recommendations[0].reason = { ...structured, factIndex: 1 };
        expect(request.schema!.safeParse(raw).success).toBe(true);
        return success(raw);
      },
    });
    const restored = JSON.parse(JSON.stringify(prepared)) as PreparedGroupExplanationV7;
    expect(() => validatePreparedGroupV7(f.context, f.plan, restored, f.run)).not.toThrow();
    expect(restored.explanation.recommendations[0].reasons[0]).toMatchObject({
      text: expect.stringContaining(`你的目标是「${f.rankedGoal}」。`),
      competitionFactIds: [anchor.id], studentFactIds: validChoice.studentFactIds,
    });
    expect(restored.explanation.recommendations[0].reasons[0].text).toContain(`「${record.roles[0].name}」：${record.roles[0].task}`);
    expect(restored.explanation.recommendations[0].reasons[0].text).not.toContain("聚焦「");
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, restored, { ...options,
      persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: f.run.runId, groupId: f.specs[0].groupId,
        groupBindingSha256: restored.groupBindingSha256, preparedSha256: restored.preparedSha256, persistedResultVersion: 1, groupVersion: 1 },
      persistReviewPreparation: async () => {}, modelCall: async (prompt, request) => {
        const raw = JSON.parse(prompt);
        const wire = decodedGroupWire(prompt);
        expect(wire.assertions).toHaveLength(1);
        expect(raw.assertions[0].taskScope).toEqual({ stepIndex: focus.index, text: focus.text });
        expect(raw.assertions[0]).not.toHaveProperty("selectedTaskFocus");
        expect(raw.assertions[0]).not.toHaveProperty("provisionalRankRelation");
        expect(raw.assertions[0]).not.toHaveProperty("provisionalRankSelection");
        expect(wire.assertions[0]).toMatchObject({ selectedTaskFocus: focus.text,
          learnerBasisSelection: { ...studentFactBasis(1), studentFactId: wire.assertions[0].reason.studentFactIds[0] },
          reason: { text: publicConnectionText(restored.explanation.recommendations[0].reasons[0].text),
            studentFactIds: [wire.assertions[0].citedStudentFacts[0].id] },
          citedStudentFacts: [expect.objectContaining({ originalText: experience })],
          competitionItems: [{ citedFacts: [{ text: anchor.text }] }] });
        expect(wire.assertions[0]).not.toHaveProperty("explicitStudentGoal");
        expect(wire.sharedCandidateBoundaries[0].boundary.selectedRoleOriginal.task).toBe(record.roles[0].task);
        expect(request).toMatchObject({ thinking: "enabled", reasoningEffort: "low", maxTokens: 16384, maxAttempts: 1 });
        expect(request.systemPrompt).toContain("taskScope与原角色是范围背景");
        expect(request.systemPrompt).toContain("实际声称的规则、作者、对象、数值、结果与范围符合本项citedFacts和sources");
        const limitId = wire.profile.facts.find((fact: { field: string }) => fact.field === "constraints").id;
        expect(wire.currentStudentConstraintFactIds).toEqual([limitId]);
        expect(wire.profile.goals).toContain(f.rankedGoal);
        expect(wire.profile.facts).toContainEqual(expect.objectContaining({ field: "constraints", originalText: limit }));
        expect(wire.profile.facts).toContainEqual(expect.objectContaining({ field: "budget.maximumYuan", state: "retracted" }));
        return success({ checks: [matchingRelationReviewBallotFixture(wire.assertions[0].key,
          "拟练动作与所选依据未建立联系。", { fit: false })] });
      },
    });
    expect(reviewed.checks.map(check => check.supported)).toEqual([false, false]);
    expect(assembleReviewedGroupDetailsV7(f.context, f.plan, restored, reviewed, f.run)).toEqual([]);
    const substituted = structuredClone(restored);
    const substitutedReason = composeGroundedBridgeReasonV7(original, record.roles[0],
      { ...validChoice, competitionFactIds: [original.id] }, studentLearningOptionsV7(f.context.profile), MATCHING_RELATION_LABEL_V764)!;
    substituted.explanation.recommendations[0].reasons = [substitutedReason];
    substituted.explanation.recommendations[0].roleReason = structuredClone(substitutedReason);
    expect(() => validatePreparedGroupV7(f.context, f.plan, substituted, f.run)).toThrow(
      expect.objectContaining({ issues: expect.arrayContaining([`invalid_group_task_selection:${ranked.itemId}`]) }));
    for (const invalidChoice of [{ ...validChoice, studentFactIds: [f.second.id] },
      { ...validChoice, studentFactIds: [...validChoice.studentFactIds].reverse() }, { ...validChoice, goalIndex: 1 }]) {
      const tampered = structuredClone(restored), row = tampered.explanation.recommendations[0];
      const reason = composeGroundedBridgeReasonV7(anchor, record.roles[0], invalidChoice, studentLearningOptionsV7(f.context.profile), MATCHING_RELATION_LABEL_V764)!;
      row.reasons = [reason];
      row.roleReason = structuredClone(reason);
      expect(() => validatePreparedGroupV7(f.context, f.plan, tampered, f.run)).toThrow(
        expect.objectContaining({ issues: expect.arrayContaining([`rank_student_basis_changed:${ranked.itemId}`]) }));
    }
    for (const replaced of [expectedBridge.replace("原文两种外套开口的通风路径", "通用数据学习"), expectedBridge + "；核对：多出的条件"]) {
      const tampered = structuredClone(restored), row = tampered.explanation.recommendations[0];
      row.reasons[0].text = row.reasons[0].text.replace(expectedBridge, replaced);
      row.roleReason = structuredClone(row.reasons[0]);
      expect(() => validatePreparedGroupV7(f.context, f.plan, tampered, f.run)).toThrow(
        expect.objectContaining({ issues: expect.arrayContaining([`invalid_learning_reason:${ranked.itemId}`]) }));
    }
  });

  it.each([
    { field: "roleIndex", value: 1 },
    { field: "studentFactIds", value: ["s.other-basis"] },
    { field: "goalIndex", value: 1 },
    { field: "taskStepIndex", value: 99 },
    { field: "competitionFactIds", value: ["another-item-fact"] },
  ])("rejects a model attempt to override fixed $field without a redraw", async ({ field, value }) => {
    const f = rankedBasisFixture(), ranked = f.plan.recommendations[0], original = f.context.candidates[0].record.facts[0];
    const rankIds = [f.personal.id, f.second.id];
    ranked.rankRoleIndex = 0;
    ranked.rankGoalIndex = 0;
    ranked.rankTaskStepIndex = 0;
    ranked.reasons = [claim("把本人数据分析与已述的记录核对联系到赛事报告。", "inference", rankIds, [original.id])];
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const modelCall = vi.fn(async (prompt: string) => {
      const raw = rankBoundEnvelope(f, prompt), row = raw.recommendations[0];
      Object.assign(field === "roleIndex" ? row : row.reason, { [field]: value });
      return success(raw);
    });
    await expect(generateGroupExplanationV7(f.context, f.plan, f.specs[0], {
      requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750, modelCall,
    })).rejects.toMatchObject({ issues: expect.arrayContaining([field === "taskStepIndex"
      ? `invalid_group_task_selection:${ranked.itemId}` : expect.stringMatching(/:unrecognized_keys$/u)]) });
    expect(modelCall).toHaveBeenCalledTimes(1);
  });

  it("rejects incomplete rank authority before generation and keeps explicit unranked fact plans independent", async () => {
    const f = rankedBasisFixture(), ranked = f.plan.recommendations[0], fact = f.context.candidates[0].record.facts[0];
    const modelCall = vi.fn(async (prompt: string) => success(envelope(f, prompt)));
    const options = { requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750, modelCall };
    ranked.rankRoleIndex = 0;
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    await expect(generateGroupExplanationV7(f.context, f.plan, f.specs[0], options)).rejects.toMatchObject({
      issues: [`invalid_rank_student_basis:${ranked.itemId}`],
    });
    expect(modelCall).not.toHaveBeenCalled();

    delete ranked.rankRoleIndex;
    ranked.reasons = [claim(fact.text, "official", [], [fact.id])];
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, f.specs[0], options);
    expect(prepared.explanation.recommendations[0]).toMatchObject({ roleIndex: 0, reasons: [{ studentFactIds: [f.personal.id] }] });
    expect(prepared.explanation.recommendations[0]).not.toHaveProperty("rankRoleIndex");
    expect(modelCall).toHaveBeenCalledTimes(1);

    const mixed = fixture(2);
    mixed.plan.recommendations[0].rankRoleIndex = 0;
    expect(() => createExplanationGroupSpecsV7(mixed.context, mixed.plan, mixed.run)).toThrow("incomplete_rank_role_bindings");
  });

  it("rejects a same-item non-task anchor before dispatch", async () => {
    const f = rankedBasisFixture(), ranked = f.plan.recommendations[0], record = f.context.candidates[0].record;
    const nonTask = { ...record.facts[0], field: "registration", id: `${record.recordId}.registration` };
    record.facts.push(nonTask);
    ranked.rankRoleIndex = 0;
    ranked.rankTaskStepIndex = 0;
    ranked.reasons = [claim("把本人数据分析联系到赛事记录核对。", "inference", [f.personal.id], [nonTask.id])];
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const modelCall = vi.fn(async (prompt: string) => success(rankBoundEnvelope(f, prompt)));
    await expect(generateGroupExplanationV7(f.context, f.plan, f.specs[0], {
      requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750, modelCall,
    })).rejects.toMatchObject({ issues: [`invalid_rank_task_anchor:${ranked.itemId}`] });
    expect(modelCall).not.toHaveBeenCalled();
  });

  it.each([true, false])("seals experience, preserves the attribution refusals and blocks an internal marker (rank-bound: %s)", async ranked => {
    const f = fixture(5), options = { requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750 };
    const past = "自己实现序列比对并核验公开样例";
    const goal = "只读来源并核对引文";
    const current = "没有现场设备许可";
    const expired = "此前使用过专用设备";
    const experience = { ...f.personal, field: "experience.0.task", id: "s.original-experience", answerId: "a.original-experience",
      originalText: past, value: past, label: past };
    const constraint = `${expired}；${current}；只读公开资料核对原文`;
    const mixed = "有农场导师并已经跑过三轮校准";
    const independent = "无实验室，预算400，不得公开上传；先用可点击原型";
    const denied = "不提供个人案件法律代理意见";
    const preference = "先用纸面原型。";
    f.context.profile.facts.push(experience, { ...f.personal, id: "s.current-permission", field: "constraints",
      label: constraint, value: constraint, originalText: constraint },
      { ...f.personal, id: "s.mixed-permission", field: "constraints", label: mixed, value: mixed, originalText: mixed },
      { ...f.personal, id: "s.independent-permission", field: "constraints", label: independent, value: independent, originalText: independent },
      { ...f.personal, id: "s.denied-advice", field: "constraints.advice", label: denied, value: false, originalText: denied, state: "negated" },
      { ...f.personal, id: "s.future-format", field: "constraints.format", label: preference, value: preference, originalText: preference });
    f.context.profile.goals = [goal];
    f.context.profile.primaryGoal = goal;
    for (const item of f.plan.recommendations) {
      const fact = f.context.candidates.find(row => row.record.recordId === item.itemId)!.record.facts[0];
      if (ranked) Object.assign(item, { rankRoleIndex: 0, rankTaskStepIndex: 0, rankGoalIndex: 0,
        reasons: [claim("排序内部临时联系，记录现有样例的复现路径。", "inference", [experience.id], [fact.id])] });
      else item.reasons = [claim(fact.text, "official", [], [fact.id])];
    }
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const [spec] = f.specs;
    const taskConnections = [
      "处理前后记录如何各自指向来源，哪些位置仍需查阅。",
      "借用自己核验公开样例时把实现输出与样例结果分开记录的方式，核对同一对象的记录。",
      "把纸面原型测试选择理解时的“选择—理由”追问迁移为问题措辞，核对问题和目标是否对应。",
      "按卡上已记录的理解错误对预期回答分类，核对同一对象的记录。",
      "成本分析如何区分固定投入与变动成本，并界定@C19成本分析参数表的范围。",
    ];
    const explain = vi.fn(async (prompt: string) => {
      const wire = expandCandidateEvidence(expandMatchingTables(decodedGroupWire(prompt))) as {
        currentLimits: { field: string; text: string }[];
        candidates: { rankedSelection?: { factIndex: number } }[];
        studentBasisOptions?: { index: number; label?: string }[]; studentGoalOptions?: { index: number; text: string }[];
      };
      expect(wire).not.toHaveProperty("profile");
      expect(wire).not.toHaveProperty("learningMode");
      expect(wire).not.toHaveProperty("practicePreferences");
      for (const candidate of wire.candidates) expect(candidate).not.toHaveProperty("learningMode");
      const { currentLimits, ...withoutLimitContext } = wire;
      for (const text of [constraint, mixed, independent]) {
        expect(currentLimits).toContainEqual({ field: "constraints", state: "affirmed", confirmed: true,
          text, use: "constraints_and_counterevidence_only" });
      }
      expect(currentLimits).toContainEqual({ field: "constraints.advice", state: "negated", confirmed: true,
        text: denied, value: false, use: "constraints_and_counterevidence_only" });
      expect(JSON.stringify(withoutLimitContext)).not.toContain(expired);
      expect(JSON.stringify(withoutLimitContext)).not.toContain("跑过三轮校准");
      expect(JSON.stringify(wire)).not.toContain(preference);
      expect(JSON.stringify(wire)).not.toContain("排序内部临时联系");
      if (ranked) {
        expect(wire).not.toHaveProperty("studentBasisOptions");
        expect(wire).not.toHaveProperty("declaredLearningGoal");
        expect(wire).toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({
          learnerBasisOptions: [{ index: 0, kind: "student_fact", factKind: "reported_experience", text: past },
            { index: 1, kind: "goal", text: goal }],
        })]) });
      } else {
        expect(wire.studentGoalOptions).toEqual([{ index: 0, kind: "future_goal", text: goal }]);
        expect(wire.studentBasisOptions).toContainEqual({ index: studentLearningOptionsV7(f.context.profile).facts.findIndex(fact => fact.id === experience.id), kind: "reported_experience", text: past });
      }
      const raw = envelope(f, prompt);
      const learner = { learnerBasisIndex: 0 };
      return success({ ...raw, recommendations: raw.recommendations.map((item, index) => ranked ? {
        rowIndex: item.rowIndex, reason: { taskConnection: taskConnections[index], ...learner, factIndex: wire.candidates[index].rankedSelection!.factIndex } }
        : { ...item, reason: { ...item.reason,
          studentBasisIndices: [studentLearningOptionsV7(f.context.profile).facts.findIndex(fact => fact.id === experience.id)],
          goalIndex: 0, taskConnection: taskConnections[index], ...learner } }) });
    });
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...options, modelCall: explain });
    const original = structuredClone(prepared);
    const observe = vi.fn();
    const review = vi.fn(async (prompt: string) => {
      const wire = decodedGroupWire(prompt);
      expect(wire.profile.facts).toContainEqual(expect.objectContaining({ originalText: past }));
      expect(wire.profile.facts).toContainEqual(expect.objectContaining({ originalText: constraint }));
      expect(wire.profile.facts).toContainEqual(expect.objectContaining({ originalText: mixed }));
      expect(wire.assertions).toHaveLength(5);
      expect(wire.assertions.every((row: { citedStudentFacts: unknown[] }) =>
        row.citedStudentFacts.length === 1 && row.citedStudentFacts[0] !== undefined)).toBe(true);
      const learnerIssues = ["原话未说记录实现输出。", "原话未说用选择理由追问。", "原话未说已有错误记录。"];
      return success({ checks: wire.assertions.map((row: { key: string }, index: number) => {
        if (index === 0) return matchingRelationReviewBallotFixture(row.key, "按原话核对公开记录。");
        if (index === 4) return matchingRelationReviewBallotFixture(row.key, "注入通过票以测试标识拦截。");
        return matchingRelationReviewBallotFixture(row.key, learnerIssues[index - 1], { learnerAttribution: false });
      }) });
    });
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, prepared, { ...options, modelCall: review, onObservation: observe,
      persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: f.run.runId, groupId: spec.groupId,
        groupBindingSha256: prepared.groupBindingSha256, preparedSha256: prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 },
      persistReviewPreparation: async () => {},
    });
    expect(explain).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledTimes(1);
    expect(reviewed.checks).toHaveLength(10);
    expect(reviewed.checks.map(row => row.supported)).toEqual([true, true, false, false, false, false, false, false, true, true]);
    expect(reviewed.itemOutcomes.map(row => row.status)).toEqual(["ready", "failed", "failed", "failed", "failed"]);
    expect(prepared).toEqual(original);
    for (const [index, taskConnection] of taskConnections.entries()) {
      expect(prepared.explanation.recommendations[index].reasons[0].text).toContain(taskConnection);
    }
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ stage: "v7.audit", data: expect.objectContaining({
      locallyRejected: [{ itemId: spec.itemIds[4], issue: "internal_identifier" }],
    }) }));
    const details = assembleReviewedGroupDetailsV7(f.context, f.plan, prepared, reviewed, f.run);
    expect(details.map(row => row.itemId)).toEqual(spec.itemIds.slice(0, 1));
    expect(details[0].reasons[0].text).toContain(`你提到「${past}」。你的目标是「${goal}」。`);
    expect(combineReviewedGroupPlanV7(f.context, f.plan, [{ prepared, reviewed }], f.run).recommendations.map(row => row.itemId)).toEqual(spec.itemIds.slice(0, 1));
    const { reviewedSha256: _old, ...tampered } = structuredClone(reviewed);
    tampered.itemOutcomes[1] = { ...tampered.itemOutcomes[1], status: "ready", unsupportedKeys: [] };
    expect(() => validateReviewedGroupV7(f.context, f.plan, prepared, { ...tampered, reviewedSha256: groupCanonicalSha256V7(tampered) }, f.run))
      .toThrow("reviewed_group_changed");
  });

  it.each([false, true])("uses only the bound goal and still requires review when another positive fact exists: %s", async otherStudentBasis => {
    const f = fixture(), goal = "把问卷观察结果整理成可核对的图表";
    if (!otherStudentBasis) f.context.profile.facts = f.context.profile.facts.filter(fact => fact.field === "stage");
    f.context.profile.primaryGoal = goal;
    f.context.profile.goals = [goal];
    const ranked = f.plan.recommendations[0];
    ranked.rankRoleIndex = 0;
    ranked.rankGoalIndex = 0;
    ranked.rankTaskStepIndex = 0;
    ranked.reasons = [claim("从学生目标联系到按口径核对赛事数据。", "suggestion", [], [f.context.candidates[0].record.facts[0].id])];
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const [spec] = f.specs;
    const options = { requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750 };
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...options, modelCall: async (prompt, request) => {
      const wire = expandCandidateEvidence(expandMatchingTables(decodedGroupWire(prompt))) as { candidates: unknown[] };
      expect(wire.candidates[0]).not.toHaveProperty("fixedStudentBasis");
      expect(wire.candidates[0]).not.toHaveProperty("rankBasisGoal");
      expect(wire.candidates[0]).toMatchObject({ learnerBasisOptions: [{ index: 0, kind: "goal", text: goal }] });
      expect(prompt).not.toContain("数据分析与建模");
      expect(request.systemPrompt).toContain("taskConnection");
      const raw = rankBoundEnvelope(f, prompt);
      const [row] = raw.recommendations;
      const { learnerBasisIndex: _fixed, ...reason } = row.reason;
      if (otherStudentBasis) reason.taskConnection = "沿用你已有的数据分析方法核对问卷记录。";
      return success({ ...raw, recommendations: [{ ...row, reason }] });
    } });
    const restored = JSON.parse(JSON.stringify(prepared)) as PreparedGroupExplanationV7;
    expect(() => validatePreparedGroupV7(f.context, f.plan, restored, f.run)).not.toThrow();
    expect(restored.explanation.recommendations[0].reasons[0]).toMatchObject({ basis: "suggestion", studentFactIds: [], conditions: [] });
    expect(restored.explanation.recommendations[0].reasons[0].text).toContain(`你的目标是「${goal}」。\n可选分工（编辑建议）「数据整理」`);
    expect(restored.criticalKeys).toHaveLength(2);
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, restored, { ...options,
      persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: f.run.runId, groupId: spec.groupId,
        groupBindingSha256: restored.groupBindingSha256, preparedSha256: restored.preparedSha256, persistedResultVersion: 1, groupVersion: 1 },
      persistReviewPreparation: async () => {}, modelCall: async (prompt, request) => {
        const wire = decodedGroupWire(prompt);
        expect(wire.profile.goals).toEqual([goal]);
        expect(wire.profile.facts.some((fact: { field: string }) => fact.field === "skills")).toBe(otherStudentBasis);
        expect(wire.assertions[0].citedStudentFacts).toEqual([]);
        expect(wire.assertions[0].reason.studentFactIds).toEqual([]);
        expect(wire.assertions[0].explicitStudentGoal).toBe(goal);
        expect(wire.assertions[0].reviewPurposes).toEqual(["recommendation_fit", "selected_role_action"]);
        expect(wire.assertions[0].learnerBasisSelection).toEqual(goalBasis);
        expect(request.systemPrompt).toContain("泛题材、通用整理或只核出处不够");
        return success({ checks: [otherStudentBasis
          ? matchingRelationReviewBallotFixture(wire.assertions[0].key, "未选依据不能证明已有方法。", { learnerAttribution: false })
          : matchingRelationReviewBallotFixture(wire.assertions[0].key, "目标未与具体环节关联。", { fit: false })] });
      },
    });
    expect(reviewed.checks.map(check => check.supported)).toEqual([false, false]);
    expect(assembleReviewedGroupDetailsV7(f.context, f.plan, restored, reviewed, f.run)).toEqual([]);
  });

  it("retains the strongest actual goal and both used facts in one bridge", async () => {
    const f = fixture(), goal = "建立可以复核的数据处理过程档案";
    const rawExperience = "我自己对照过清理前后的问卷记录，并标了缺失项";
    const past = { ...f.personal, id: "s.experience-check", field: "experience.1.task",
      label: "问卷清理记录", value: rawExperience, originalText: rawExperience };
    f.context.profile.facts.push(past);
    f.context.profile.primaryGoal = goal;
    f.context.profile.goals = [goal];
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const [spec] = f.specs;
    const taskConnection = "原任务怎样用数据清理前后的记录说明处理决定、变化及缺失，让过程档案可以复核。";
    const result = await generateGroupExplanationV7(f.context, f.plan, spec, { requestId: f.run.runId, runBinding: f.run,
      deadlineEpochMs: f.run.detailDeadlineEpochMs - 750, modelCall: async (prompt, options) => {
        const raw = envelope(f, prompt);
        const facts = studentLearningOptionsV7(f.context.profile).facts;
        Object.assign(raw.recommendations[0].reason, { goalIndex: 0, studentBasisIndices: [f.personal.id, past.id].map(id => facts.findIndex(fact => fact.id === id)), taskConnection, learnerBasisIndex: 0 });
        expect(options.schema!.safeParse(raw).success).toBe(true);
        return success(raw);
      } });
    const restored = JSON.parse(JSON.stringify(result.prepared)) as PreparedGroupExplanationV7;
    expect(() => validatePreparedGroupV7(f.context, f.plan, restored, f.run)).not.toThrow();
    const [item] = restored.explanation.recommendations;
    expect(item.reasons).toHaveLength(1);
    expect(item.reasons[0]).toMatchObject({ basis: "inference", studentFactIds: [f.personal.id, past.id] });
    expect(item.reasons[0].text).toContain(`你提到「数据分析与建模」、「${rawExperience}」。你的目标是「${goal}」。`);
    expect(item.reasons[0].text.endsWith(`匹配关系：${composeTaskConnectionV767(studentFactBasis(), taskConnection)}`)).toBe(true);
    expect(restored.criticalKeys).toHaveLength(2);
  });

  it.each(["stage", "unknown", "other-goal"])("rejects an unbound %s student basis", async invalidBasis => {
    const f = fixture(), [spec] = f.specs;
    const modelCall = vi.fn(async (prompt: string) => {
      const raw = envelope(f, prompt), choice = raw.recommendations[0].reason;
      if (invalidBasis === "stage") choice.studentBasisIndices = [f.context.profile.facts.length - 1];
      if (invalidBasis === "unknown") choice.studentBasisIndices = [999];
      if (invalidBasis === "other-goal") { choice.studentBasisIndices = []; Object.assign(choice, { goalIndex: 7 }); }
      return success(raw);
    });
    await expect(generateGroupExplanationV7(f.context, f.plan, spec, { requestId: f.run.runId, runBinding: f.run,
      deadlineEpochMs: f.run.detailDeadlineEpochMs - 750, modelCall })).rejects.toMatchObject({ issues: [`invalid_learning_basis:${spec.itemIds[0]}`] });
    expect(modelCall).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "duplicate", "swapped", "extra"])("rejects %s provider row indices without redrawing", async defect => {
    const f = fixture(2), spec = f.specs[0];
    const modelCall = vi.fn(async (prompt: string) => {
      const raw = envelope(f, prompt);
      if (defect === "missing") raw.recommendations.pop();
      if (defect === "duplicate") raw.recommendations[1].rowIndex = 0;
      if (defect === "swapped") raw.recommendations.reverse();
      if (defect === "extra") raw.recommendations.push({ ...raw.recommendations[1], rowIndex: 2 });
      return success(raw);
    });
    await expect(generateGroupExplanationV7(f.context, f.plan, spec, { requestId: f.run.runId, runBinding: f.run,
      deadlineEpochMs: f.run.detailDeadlineEpochMs - 750, modelCall })).rejects.toMatchObject({ issues: ["group_membership_or_order_changed"] });
    expect(modelCall).toHaveBeenCalledTimes(1);
  });

  it.each(["other-item", "source-id", "wrong-scope", "long-anchor", "long-composition"])("fails closed on an invalid %s anchor without replacing it", async defect => {
    const f = fixture(), record = f.context.candidates[0].record, fact = record.facts[0];
    if (defect === "wrong-scope") fact.scope = "其他届次的资料";
    if (defect === "long-anchor") fact.text = "学".repeat(1600);
    if (defect === "long-composition") fact.text = "学".repeat(1600 - (matchReasonAnchorPrefixV7(fact).length - fact.text.length) - 8);
    const [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    f.specs = [spec];
    const reply = vi.fn(async (prompt: string) => {
      const raw = envelope(f, prompt);
      if (defect === "other-item") raw.recommendations[0].reason.factIndex = 99;
      if (defect === "source-id") Object.assign(raw.recommendations[0].reason, { factIndex: record.sources[0].id });
      if (defect === "long-anchor") expect(matchExplanationInputV7(f.context, f.plan).candidates[0].citationRules.competitionFactIds).not.toContain(fact.id);
      if (defect === "long-composition") expect(matchExplanationInputV7(f.context, f.plan).candidates[0].citationRules.competitionFactIds).toContain(fact.id);
      return success(raw);
    });
    await expect(generateGroupExplanationV7(f.context, f.plan, spec, { requestId: f.run.runId, runBinding: f.run,
      deadlineEpochMs: f.run.detailDeadlineEpochMs - 750, modelCall: reply })).rejects.toMatchObject({
      issues: defect === "source-id" ? [expect.stringMatching(/recommendations\.0\.reason\.factIndex:invalid_type/u)]
        : [`${defect === "long-composition" ? "reason_anchor_capacity_exceeded" : "invalid_reason_anchor"}:${record.recordId}`],
    });
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["single", "emoji300"], ["single", "short173"],
    ["parallel-2", "above320"], ["parallel-2", "spaced180"],
  ])("carries %s %s unchanged through preparation, joint review, partial publication, merge and final report", async (layout, boundary) => {
    vi.stubEnv("SAITU_V7_DETAIL_LAYOUT", layout);
    const f = fixture(5);
    for (const { record } of f.context.candidates) {
      const fact = record.facts[0];
      const nonAnchorLength = countCompactReasonCharactersV7(anchored(f, record.recordId)) - countCompactReasonCharactersV7(fact.text);
      const count = (boundary === "short173" ? 173 : boundary === "above320" ? 321 : boundary === "emoji300" ? 300 : 180) - nonAnchorLength;
      fact.text = boundary === "emoji300" ? "🧭".repeat(count) : boundary === "spaced180" ? Array.from("学".repeat(count)).join("              ") : "学".repeat(count);
    }
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const groups: { prepared: PreparedGroupExplanationV7; reviewed: ReviewedPreparedGroupV7 }[] = [], calls: UniqueGroupJournalCallV7[] = [];
    for (const spec of f.specs) {
      const options = { requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750 };
      const generation = await generateGroupExplanationV7(f.context, f.plan, spec, { ...options, modelCall: async (prompt, request) => {
        expect(request.promptVersion).not.toContain(".repair");
        calls.push({ runId: f.run.runId, callId: randomUUID(), reservationId: randomUUID(), callKey: groupCallKeyV7(spec.groupId, "explain"), upstreamAttempted: true, usage: null });
        return success(envelope(f, prompt));
      } });
      const reviewed = await reviewPreparedGroupV7(f.context, f.plan, generation.prepared, { ...options,
        persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: f.run.runId, groupId: spec.groupId, groupBindingSha256: generation.prepared.groupBindingSha256, preparedSha256: generation.prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 },
        persistReviewPreparation: async () => {}, modelCall: async (prompt, request) => {
          expect(request.promptVersion).not.toContain(".repair");
          calls.push({ runId: f.run.runId, callId: randomUUID(), reservationId: randomUUID(), callKey: groupCallKeyV7(spec.groupId, "review"), upstreamAttempted: true, usage: null });
          const wire = decodedGroupWire(prompt);
          return success({ checks: wire.assertions.map((row: { key: string }) =>
            matchingRelationReviewBallotFixture(row.key, "长度路径使用模拟通过票。")) });
        } });
      groups.push({ prepared: generation.prepared, reviewed: reviewed.reviewed });
      const partial = assembleReviewedGroupDetailsV7(f.context, f.plan, generation.prepared, reviewed.reviewed, f.run);
      expect(partial.map(item => item.itemId)).toEqual(spec.itemIds);
      expect(partial.every(item => item.reasons[0].text === anchored(f, item.itemId) && item.nextStep.text === item.reasons[0].text)).toBe(true);
    }
    const combined = combineReviewedGroupPlanV7(f.context, f.plan, groups, f.run), scope = { compactReasonItemIds: f.plan.recommendations.map(item => item.itemId), compactReasonLengthPolicy: "soft_target" as const };
    expect(combined.recommendations.every(item => item.reasons[0].text === anchored(f, item.itemId) && item.roleReason?.text === item.reasons[0].text)).toBe(true);
    expect(validateMatchPlanV7(combined, f.context, scope).ok).toBe(true);
    // This is the exact old guard that blocked these values. Ordinary/direct
    // validation keeps it; only the bound compact owners use the new rule.
    if (boundary !== "short173") {
      expect(combined.recommendations[0].reasons[0].text.length).toBeGreaterThan(320);
      expect(validateMatchPlanV7(combined, f.context).issues).toContain(`explanation_too_long:${f.plan.recommendations[0].itemId}`);
      expect(validateMatchPlanV7(combined, f.context, { ...scope, compactReasonItemIds: scope.compactReasonItemIds.slice(0, 1) }).issues).toContain(`explanation_too_long:${f.plan.recommendations[1].itemId}`);
    }
    if (boundary === "short173" || boundary === "above320")
      expect(validateMatchPlanV7(combined, f.context, { compactReasonItemIds: scope.compactReasonItemIds }).issues).toContain(`compact_match_reason_length:${f.plan.recommendations[0].itemId}`);
    for (const compactReasonItemIds of [["foreign-owner"], [scope.compactReasonItemIds[0], scope.compactReasonItemIds[0]]])
      expect(validateMatchPlanV7(combined, f.context, { compactReasonItemIds }).issues).toContain("invalid_compact_reason_scope");
    const report = assembleReviewedGroupsReportV7(f.context, f.plan, groups, f.run, { calls, startedAtEpochMs: 0, completedAtEpochMs: 1 });
    expect(report.recommendations.every(item => item.reasons[0].text === anchored(f, item.itemId) && item.nextStep.text === item.reasons[0].text)).toBe(true);
    expect(validateDecisionReportV7(report, f.context, scope).ok).toBe(true);
    expect(calls).toHaveLength(f.specs.length * 2);
    expect(report.trace.callCount).toBe(calls.length);
  });

  it("supplies the selected owner's constraints and usable prerequisite facts without changing source records", () => {
    const f = fixture(), record = f.context.candidates[0].record, original = record.facts[0];
    record.facts.push({ ...original, id: "compact-equipment", field: "equipment", text: "该任务需要使用受许可的设备。" },
      { ...original, id: "compact-unreviewed", field: "equipment", status: "pending_review" });
    const before = structuredClone(f.context), packet = matchExplanationInputV7(f.context, f.plan), selected = packet.candidates[0];
    expect(selected.boundaries.conditions).toEqual(f.context.candidates[0].conditions);
    expect(selected.boundaries.conditions).toContain("设备使用权和个人支出尚未确认。");
    expect(selected.facts.some(fact => fact.id === "compact-equipment")).toBe(true);
    expect(selected.facts.some(fact => fact.id === "compact-unreviewed")).toBe(false);
    expect(packet.candidates).toHaveLength(1); expect(f.context).toEqual(before);
  });

  it("binds one complete generated statement to both logical claims and persists the real joint verdict mapping", async () => {
    const f = fixture(), spec = f.specs[0]; let saved: GroupReviewPreparationV7 | undefined;
    const generation = await generateGroupExplanationV7(f.context, f.plan, spec, {
      requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750,
      modelCall: async (prompt, options) => {
        const value = envelope(f, prompt), extra = structuredClone(value);
        expect(value.recommendations[0]).not.toHaveProperty("roleReason");
        Object.assign(extra.recommendations[0], { roleReason: value.recommendations[0].reason });
        expect(options.schema!.safeParse(extra).success).toBe(false);
        return success(value);
      },
    });
    const item = generation.prepared.explanation.recommendations[0];
    expect(item.roleReason).toEqual(item.reasons[0]); expect(item.roleReason).not.toBe(item.reasons[0]);
    expect(item.roleReason!.text).toBe(anchored(f, item.itemId)); expect(generation.prepared.criticalKeys).toHaveLength(2);
    const reviewed = await reviewPreparedGroupV7(f.context, f.plan, generation.prepared, {
      requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750,
      persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: f.run.runId, groupId: spec.groupId, groupBindingSha256: generation.prepared.groupBindingSha256, preparedSha256: generation.prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 },
      persistReviewPreparation: async preparation => { saved = structuredClone(preparation); },
      modelCall: async prompt => {
        const raw = JSON.parse(prompt);
        const wire = decodedGroupWire(prompt); expect(wire.assertions).toHaveLength(1);
        expect(raw.reviewContract).toBe(MATCHING_RELATION_REVIEW_CONTRACT_V767);
        expect(raw.assertions[0]).not.toHaveProperty("reviewPurpose");
        expect(raw.assertions[0]).not.toHaveProperty("reviewPurposes");
        expect(wire.assertions[0].reviewPurposes).toEqual(["recommendation_fit", "selected_role_action"]);
        return success({ checks: [matchingRelationReviewBallotFixture(wire.assertions[0].key, "有据关联和关键前提完整。")] });
      },
    });
    expect(saved!.call.reviewKeys.map(row => row.key)).toEqual(generation.prepared.criticalKeys);
    expect(new Set(saved!.call.reviewKeys.map(row => row.alias)).size).toBe(1);
    expect(saved!.call.jointReviewBindings).toEqual([{ alias: saved!.call.reviewKeys[0].alias, keys: generation.prepared.criticalKeys,
      reviewPurposes: ["recommendation_fit", "selected_role_action"], verdictSemantics: "conjunction_single_provider_verdict" }]);
    expect(reviewed.reviewed.checks.map(row => row.key)).toEqual(generation.prepared.criticalKeys);
    expect(reviewed.reviewed.checks.map(row => row.supported)).toEqual([true, true]);
    expect(reviewed.reviewed.matchingRelationReview?.ballots).toEqual([
      matchingRelationReviewBallotFixture(saved!.call.reviewKeys[0].alias, "有据关联和关键前提完整。"),
    ]);
    expect(assembleReviewedGroupDetailsV7(f.context, f.plan, generation.prepared, reviewed.reviewed, f.run)[0].reasons[0].text).toBe(anchored(f, f.plan.recommendations[0].itemId));
  });

  it("reviews and restores the same concrete understanding point without adding an action contract", async () => {
    const f = fixture(1, "作者用受许可的现场设备记录同一对象处理前后的变化。");
    f.context.candidates[0].record.roles[0].task = "记录同一对象处理前后的变化，比较两份读数";
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const [spec] = f.specs;
    const taskConnection = "同一对象处理前后的读数怎样支持对变化的判断。";
    const oldRelation = { mode: "apply", taskPoint: "用现场设备记录同一对象处理前后的变化。",
      prerequisite: "确认现场设备使用许可。" } as const;
    const options = { requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750 };
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...options,
      modelCall: async (prompt, request) => {
        const raw = envelope(f, prompt), row = raw.recommendations[0];
        const { taskConnection: _default, ...bindings } = row.reason;
        const value = { ...raw, recommendations: [{ ...row, reason: { ...bindings, taskConnection } }] };
        expect(request.schema!.safeParse(value).success).toBe(true);
        for (const invalid of [
          { ...bindings, taskConnection: oldRelation },
          { ...bindings, taskConnection, mode: "understand" },
          { ...bindings, taskConnection, prerequisite: oldRelation.prerequisite },
          { ...bindings, taskConnection, taskRelation: oldRelation },
          { ...bindings, taskRelation: oldRelation },
          { ...bindings, futureUse: oldRelation.taskPoint },
          { ...bindings, taskConnection, learnerQuotation: "本人已经使用过现场设备。" },
        ]) {
          expect(request.schema!.safeParse({ ...raw, recommendations: [{ ...row, reason: invalid }] }).success).toBe(false);
        }
        return success(value);
      },
    });
    const restored = JSON.parse(JSON.stringify(prepared)) as PreparedGroupExplanationV7;
    const [selection] = restored.explanation.taskSelections!;
    expect(selection.taskConnection).toBe(taskConnection);
    expect(selection).not.toHaveProperty("taskRelation");
    expect(selection).not.toHaveProperty("futureUseSelection");
    expect(() => validatePreparedGroupV7(f.context, f.plan, restored, f.run)).not.toThrow();
    const mixed = structuredClone(restored);
    mixed.explanation.taskSelections![0].taskRelation = oldRelation;
    expect(() => validatePreparedGroupV7(f.context, f.plan, mixed, f.run)).toThrow("invalid_output");
    const substituted = structuredClone(restored);
    substituted.explanation.taskSelections![0].taskConnection = "现场设备已经确认可以使用。";
    expect(() => validatePreparedGroupV7(f.context, f.plan, substituted, f.run)).toThrow("invalid_output");

    const original = restored.explanation.recommendations[0].reasons[0];
    expect(publicConnectionText(original.text)).toBe(taskConnection);
    expect(original.text).not.toContain("前置核实");
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, restored, { ...options,
      persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: f.run.runId, groupId: spec.groupId,
        groupBindingSha256: restored.groupBindingSha256, preparedSha256: restored.preparedSha256, persistedResultVersion: 1, groupVersion: 1 },
      persistReviewPreparation: async () => {}, modelCall: async (prompt, request) => {
        const wire = decodedGroupWire(prompt), [row] = wire.assertions;
        expect(wire.reviewContract).toBe(MATCHING_RELATION_REVIEW_CONTRACT_V767);
        expect(row.reason.text).toBe(publicConnectionText(original.text));
        expect(row).not.toHaveProperty("relationMode");
        expect(row).not.toHaveProperty("actionPrerequisite");
        expect(prompt).toContain("设备使用权和个人支出尚未确认");
        const ballot = matchingRelationReviewBallotFixture(row.key, "有据理解处理前后读数。");
        expect(request.schema!.safeParse({ checks: [{ key: row.key, supported: true, reason: "旧单轴回执。" }] }).success).toBe(false);
        const { conditions: _axis, ...incomplete } = ballot;
        expect(request.schema!.safeParse({ checks: [incomplete] }).success).toBe(false);
        return success({ checks: [ballot] });
      },
    });
    expect(reviewed.matchingRelationReview?.ballots).toEqual([
      expect.objectContaining({ fit: true, source: true, learnerAttribution: true, conditions: true }),
    ]);
    expect(assembleReviewedGroupDetailsV7(f.context, f.plan, restored, reviewed, f.run)[0].reasons[0]).toEqual(original);
  });

  it("jointly reviews the visible premises and role obligations without inventing a separate action or hiding a rejection", async () => {
    const f = fixture();
    const denied = "学校已明确不允许使用这台现场设备。";
    f.context.profile.facts.push({ ...f.personal, id: "s.denied-device", field: "constraints.equipment",
      label: denied, value: denied, originalText: denied });
    f.specs = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const [boundSpec] = f.specs, taskConnection = "直接用这台现场设备记录同一对象处理前后的变化。";
    const generation = await generateGroupExplanationV7(f.context, f.plan, boundSpec, {
      requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750,
      modelCall: async (prompt, options) => {
        expect(options.systemPrompt).toContain("标题或代码标记");
        const value = envelope(f, prompt);
        expect(value.recommendations[0]).not.toHaveProperty("roleReason");
        value.recommendations[0].reason.taskConnection = taskConnection;
        return success(value);
      },
    });
    const keys = generation.prepared.assertions.map(row => row.key), original = structuredClone(generation.prepared);
    const reviewed = await reviewPreparedGroupV7(f.context, f.plan, generation.prepared, {
      requestId: f.run.runId, runBinding: f.run, deadlineEpochMs: f.run.detailDeadlineEpochMs - 750,
      persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: f.run.runId, groupId: boundSpec.groupId, groupBindingSha256: generation.prepared.groupBindingSha256, preparedSha256: generation.prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 }, persistReviewPreparation: async () => {},
      modelCall: async (prompt, options) => {
        const wire = decodedGroupWire(prompt);
        expect(wire.fixedOrder.groupReview.purpose).toBe(MATCHING_RELATION_REVIEW_CONTRACT_V767);
        expect(wire.fixedOrder.groupReview).not.toHaveProperty("studentPresentation");
        expect(options.systemPrompt).toContain("只按真实限制核实际行动所需设备");
        expect(options.systemPrompt).toContain("每行分别给四个布尔值");
        expect(wire.assertions).toHaveLength(1);
        expect(wire.assertions[0].reviewPurposes).toEqual(["recommendation_fit", "selected_role_action"]);
        expect(wire.profile.facts).toContainEqual(expect.objectContaining({ originalText: denied }));
        expect(prompt).toContain("设备使用权和个人支出尚未确认");
        expect(wire.assertions[0].reason.text).toBe(taskConnection);
        expect(wire.assertions[0]).not.toHaveProperty("relationMode");
        expect(wire.assertions[0]).not.toHaveProperty("actionPrerequisite");
        return success({ checks: [matchingRelationReviewBallotFixture(wire.assertions[0].key,
          "建议使用已明确禁用的设备。", { conditions: false })] });
      },
    });
    expect(generation.prepared).toEqual(original); expect(reviewed.reviewed.checks.map(value => value.supported)).toEqual([false, false]);
    expect(reviewed.reviewed.matchingRelationReview?.ballots).toEqual([
      expect.objectContaining({ fit: true, source: true, learnerAttribution: true, conditions: false }),
    ]);
    expect(generation.prepared.explanation.recommendations[0].roleReason).toEqual(generation.prepared.explanation.recommendations[0].reasons[0]);
    expect(generation.prepared.explanation.recommendations[0].roleReason).not.toBe(generation.prepared.explanation.recommendations[0].reasons[0]);
    expect(reviewed.reviewed.itemOutcomes[0].status).toBe("failed");
    expect(assembleReviewedGroupDetailsV7(f.context, f.plan, generation.prepared, reviewed.reviewed, f.run)).toEqual([]);
    expect(() => combineReviewedGroupPlanV7(f.context, f.plan, [{ prepared: generation.prepared, reviewed: reviewed.reviewed }], f.run)).toThrow("NO_SUPPORTED_RECOMMENDATIONS");
    const explained = { ...f.plan, recommendations: generation.prepared.explanation.recommendations };
    const legacy = projectReviewedReasonsV7(f.context, explained, generation.prepared.assertions, keys, reviewed.reviewed.checks);
    expect(legacy.promoted).toBe(0); expect(legacy.readyItemIds).toEqual([]);
  });

  it.each([0, 1, 2, 3, 4, 5])("keeps the chosen layout explicit and the global order/deadline for %i items", count => {
    const f = fixture(count), single = f.specs;
    expect(single.map(spec => spec.itemIds.length)).toEqual(count ? [count] : []);
    vi.stubEnv("SAITU_V7_DETAIL_LAYOUT", "parallel-2");
    const parallel = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    expect(parallel.map(spec => spec.itemIds.length)).toEqual(count >= 4 ? [2, count - 2] : count ? [count] : []);
    expect(parallel.flatMap(spec => spec.itemIds)).toEqual(f.plan.recommendations.map(item => item.itemId));
    expect(parallel.flatMap(spec => spec.globalRanks)).toEqual(Array.from({ length: count }, (_, index) => index + 1));
    expect(parallel.every(spec => spec.run.detailDeadlineEpochMs === f.run.detailDeadlineEpochMs)).toBe(true);
    if (parallel[1]) expect(parallel[1].comparison.allowedItemIds).toEqual([]);
  });
});
