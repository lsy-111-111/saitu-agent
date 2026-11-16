import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EFFORT_POLICY, effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { claim } from "@/lib/competitions/v6/engine";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { RECOMMENDATION_EXECUTION_POLICY, RECOMMENDATION_IMPLEMENTATION_VERSION } from "@/lib/competitions/v7/contracts";
import {
  assembleReviewedGroupsFinalV7, createExplanationGroupSpecsV7, generateGroupExplanationV7, groupCanonicalSha256V7,
  reviewPreparedGroupV7, validatePreparedGroupV7, type GroupReviewPreparationV7, type PreparedGroupExplanationV7,
} from "@/lib/competitions/v7/explanation-groups";
import type { GroupTaskSelectionV7 } from "@/lib/competitions/v7/group-contracts";
import { MATCHING_RELATION_LABEL_V764 } from "@/lib/competitions/v7/match-learning-selection";
import { buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import { MATCHING_RELATION_REVIEW_CONTRACT_V767 } from "@/lib/competitions/v7/review-transport";
import {
  composeIndexedTaskPracticeBridgeV760, composeTaskRelationV766, quotedTaskPracticeTextIssueV759,
  readSealedTaskPracticeFieldsV7, readTaskConnectionV767, readTaskRelationV766,
} from "@/lib/competitions/v7/role-task-practice";
import { freezeContextV7, presentRunV7, type DecisionSessionV7, type LoadedRunV7 } from "@/lib/competitions/v7/store";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import {
  decodedGroupWire, goalBasis, matchingRelationReviewBallotFixture, studentFactBasis, taskConnectionReasonFixture,
} from "./group-reason-fixture";

const readGoal = "只读来源并核对引文";
const buildGoal = "制作实体样机并现场测量";
const past = "我自己逐项核对过分支对话的纸面原型。";
const unrelated = "我自己参加过诗歌朗诵活动。";
const trial = taskConnectionReasonFixture("逐项核对能帮助区分同一处理决定对应的记录变化。");
const legacyTrial = { practice: "按同一对象并列记录变化前后的结果", check: "逐项回看原文提供的结果，缺项标待查。",
  connection: "把逐项核对用于确认哪些变化能归到同一处理决定。" };
const success = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash",
  upstreamAttempted: true as const, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });

function fixture(count = 2) {
  const legacy = student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] });
  const records = Array.from({ length: count }, (_, index) => syntheticRecord(index + 1));
  const primary = records[0];
  primary.roles[0].task = "比较旧记录与新记录，核对数据边界";
  const original = primary.facts[0];
  const alternative = { ...original, id: `${original.id}.observations`, text: "将处理前与处理后的观察记录并列，注明相同对象。" };
  const boundary = { ...original, id: `${original.id}.budget`, field: "investment", text: "仅供核对设备预算。" };
  primary.facts.push(alternative, boundary);
  const context = buildDecisionContextV7(legacy, { records });
  const studentFact = context.profile.facts.find(fact => fact.field === "skills")!;
  const experience = { ...studentFact, field: "experience.1.task", id: "student.past.bound", originalText: past, value: past };
  context.profile.facts.push(experience,
    { ...experience, field: "experience.2.task", id: "student.past.unbound", originalText: unrelated, value: unrelated },
    { ...experience, field: "constraints", id: "student.practice.format", originalText: "没有编程伙伴，先用可点击原型", value: "没有编程伙伴，先用可点击原型" });
  context.profile.primaryGoal = readGoal;
  context.profile.goals = [readGoal, buildGoal];
  const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, shortfallReason: "固定初选测试。",
    recommendations: records.map((record, index) => ({ itemId: record.recordId, rankRoleIndex: 0, rankTaskStepIndex: 0,
      ...(index === 0 ? { rankGoalIndex: 1 } : {}),
      reasons: [claim("初选关联供细化核对。", "inference", [index === 0 ? experience.id : studentFact.id], [record.facts[0].id])] })) };
  const started = Date.now();
  const run = { runId: randomUUID(), stateKey: "a".repeat(64), generation: 0, implementationSha256: "a".repeat(64),
    effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), detailDeadlineEpochMs: started + 150_000 };
  const options = { requestId: run.runId, runBinding: run, deadlineEpochMs: run.detailDeadlineEpochMs - 750 };
  return { alternative, boundary, context, experience, legacy, options, original, plan, records, run, started };
}

function explainWire(prompt: string) {
  return expandCandidateEvidence(expandMatchingTables(decodedGroupWire(prompt))) as {
    groupBindingSha256: string; groupId: string;
    candidates: { rowIndex: number; evidenceOptions: { factIndex: number; text: string }[]; rankedSelection: { factIndex: number };
      learnerBasisOptions: { index: number; kind: string; text: string }[] }[];
  };
}

function response(f: ReturnType<typeof fixture>, prompt: string, pick: (rowIndex: number) => Record<string, unknown>) {
  const wire = explainWire(prompt);
  return success({ schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: wire.groupBindingSha256, groupId: wire.groupId,
    profileRevision: f.plan.profileRevision, catalogVersion: f.plan.catalogVersion, shortfallReason: f.plan.shortfallReason,
    recommendations: wire.candidates.map(({ rowIndex, learnerBasisOptions, rankedSelection }) => ({
      rowIndex, reason: { ...trial, factIndex: rankedSelection.factIndex, ...(learnerBasisOptions.length > 1 ? { learnerBasisIndex: 0 } : {}), ...pick(rowIndex) },
    })) });
}

function receipt(f: ReturnType<typeof fixture>, prepared: PreparedGroupExplanationV7) {
  return { schemaVersion: "saitu.persisted-group-explanation.v1" as const, runId: f.run.runId, groupId: prepared.groupSpec.groupId,
    groupBindingSha256: prepared.groupBindingSha256, preparedSha256: prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 };
}

beforeEach(() => {
  vi.stubEnv("SAITU_V7_DETAIL_LAYOUT", "single");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("connected_task_offline_only"); }));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("connected task selection", () => {
  it("scopes the learner evidence, seals the refined citation before review, and restores a good sibling", async () => {
    vi.stubEnv("SAITU_V7_DETAIL_LAYOUT", "parallel-2");
    const f = fixture(4), groups = [];
    const immutableRank = structuredClone(f.plan);
    const taskConnection = "逐项核对纸面原型的经验，可以帮助理解同一对象的两份记录中哪些字段发生变化。";
    for (const [groupIndex, spec] of createExplanationGroupSpecsV7(f.context, f.plan, f.run).entries()) {
      const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options, modelCall: async (prompt, request) => {
        const wire = explainWire(prompt);
        expect(request).toMatchObject({ thinking: "enabled", reasoningEffort: "low", maxAttempts: 1 });
        expect(wire).not.toHaveProperty("declaredLearningGoal");
        expect(wire).not.toHaveProperty("learningMode");
        expect(prompt).not.toMatch(/@[CFPS]\d+/u);
        for (const value of [readGoal, unrelated, f.experience.id, f.original.id, f.alternative.id]) expect(prompt).not.toContain(value);
        expect(wire).not.toHaveProperty("practicePreferences");
        expect(wire).toMatchObject({ currentLimits: [{ field: "constraints", state: "affirmed", confirmed: true,
          text: "没有编程伙伴，先用可点击原型", use: "constraints_and_counterevidence_only" }] });
        if (groupIndex === 0) {
          expect(wire.candidates[0]).toMatchObject({ learnerBasisOptions: [
            { index: 0, kind: "student_fact", factKind: "reported_experience", text: past },
            { index: 1, kind: "goal", text: buildGoal }] });
          expect(wire.candidates[1]).toMatchObject({ learnerBasisOptions: [
            { index: 0, kind: "student_fact", factKind: "reported_skill", text: "数据分析与建模" }] });
          expect(wire.candidates[0].evidenceOptions.map(option => option.text)).not.toContain(f.boundary.text);
        }
        for (const candidate of wire.candidates) expect(candidate).not.toHaveProperty("learningMode");
        const factIndex = wire.candidates[0].evidenceOptions.find(option => option.text === f.alternative.text)?.factIndex;
        return response(f, prompt, row => groupIndex === 0 && row === 0 ? { factIndex, taskStepIndex: 1, taskConnection } : {});
      } });
      const snapshot = structuredClone(prepared);
      if (groupIndex === 0) {
        expect(prepared.explanation.taskSelections?.[0]).toEqual({ itemId: f.records[0].recordId, roleIndex: 0, taskStepIndex: 1,
          competitionFactId: f.alternative.id, learnerBasisSelection: studentFactBasis(), taskConnection });
        const { text } = prepared.explanation.recommendations[0].reasons[0];
        expect(text).toContain(`你的目标是「${buildGoal}」`);
        expect(text).toContain(`你提到「${past}」。`);
        expect(text.endsWith(`\n${MATCHING_RELATION_LABEL_V764}：对应上述第1条自述。${taskConnection}`)).toBe(true);
        expect(text).toContain(`可选分工（编辑建议）「${f.records[0].roles[0].name}」：${f.records[0].roles[0].task}`);
        expect(text).not.toMatch(/聚焦「|适配练习（可选）：|；核对：|；适配用途：/u);
        const swapped = structuredClone(prepared);
        swapped.explanation.taskSelections![0].competitionFactId = f.records[1].facts[0].id;
        expect(() => validatePreparedGroupV7(f.context, f.plan, swapped, f.run)).toThrow(/invalid_output/u);
      }
      let reviewPreparation!: GroupReviewPreparationV7;
      const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, prepared, { ...f.options, persisted: receipt(f, prepared),
        persistReviewPreparation: async entry => { expect(entry.preparedSha256).toBe(prepared.preparedSha256); reviewPreparation = entry; },
        modelCall: async (prompt, request) => {
          const wire = decodedGroupWire(prompt);
          expect(request).toMatchObject({ thinking: "enabled", reasoningEffort: "low", maxTokens: 16384, maxAttempts: 1 });
          if (groupIndex === 0) {
            const rawWire = JSON.parse(prompt);
            expect(rawWire.reviewContract).toBe(MATCHING_RELATION_REVIEW_CONTRACT_V767);
            expect(rawWire.assertions[0]).toMatchObject({ taskScope: { stepIndex: 1, text: "比较旧记录与新记录" } });
            expect(rawWire.assertions[0]).not.toHaveProperty("reviewPurposes");
            expect(wire.assertions[0]).toMatchObject({ selectedTaskStepIndex: 1,
              selectedTaskFocus: "比较旧记录与新记录", competitionItems: [{ citedFacts: [{ text: f.alternative.text }] }] });
            expect(wire.assertions[0]).not.toHaveProperty("provisionalRankRelation");
            expect(wire.assertions[0]).not.toHaveProperty("provisionalRankSelection");
            expect(prepared.groupSpec.fullPlanSha256).toBe(groupCanonicalSha256V7(immutableRank));
            expect(immutableRank.recommendations[0].reasons[0].competitionFactIds).toEqual([f.original.id]);
            expect(prepared.explanation.recommendations[0].reasons[0].competitionFactIds).toEqual([f.alternative.id]);
            const studentFactId = wire.assertions[0].reason.studentFactIds[0];
            expect(wire.assertions[0].learnerBasisSelection).toEqual({ ...studentFactBasis(), studentFactId });
            expect(wire.profile.facts).toContainEqual(expect.objectContaining({ id: studentFactId, originalText: past }));
            expect(wire.assertions[0].reason.text).toBe(taskConnection);
            expect(wire.assertions[0]).not.toHaveProperty("relationMode");
            expect(wire.assertions[0]).not.toHaveProperty("actionPrerequisite");
          }
          return success({ checks: wire.assertions.map(({ key }: { key: string }, index: number) =>
            matchingRelationReviewBallotFixture(key, "离线注入票，验证封存与恢复。", { fit: groupIndex === 0 && index === 0 })) });
        },
      });
      expect(prepared).toEqual(snapshot);
      groups.push({ prepared, reviewed, reviewPreparation });
    }
    expect(f.plan).toEqual(immutableRank);
    const final = assembleReviewedGroupsFinalV7(f.context, f.plan, groups, f.run,
      { calls: [], startedAtEpochMs: f.started, completedAtEpochMs: f.started });
    expect(final.plan.recommendations.map(item => item.itemId)).toEqual([f.records[0].recordId]);
    const detail = final.report.recommendations[0], expiresAt = f.started + 180_000;
    const run: LoadedRunV7 = { row: { run_id: f.run.runId, state_key: f.run.stateKey, submission_key: "offline", status: "ready",
      implementation_version: RECOMMENDATION_IMPLEMENTATION_VERSION, result_version: 4, submitted_at: new Date(f.started),
      list_deadline_at: new Date(f.started + RECOMMENDATION_EXECUTION_POLICY.rankHardTimeoutMs),
      detail_deadline_at: new Date(f.run.detailDeadlineEpochMs), expires_at: new Date(expiresAt), lease_owner: null, lease_fence: "0",
      lease_expires_at: null, ciphertext: Buffer.alloc(0), iv: Buffer.alloc(0), tag: Buffer.alloc(0) },
    body: { implementationSha256: f.run.implementationSha256, executionPolicy: RECOMMENDATION_EXECUTION_POLICY, sessionGeneration: 0,
      effortPolicy: DEFAULT_EFFORT_POLICY, effortPolicySha256: f.run.effortPolicySha256, context: freezeContextV7(f.context), legacy: f.legacy,
      plan: f.plan, finalPlan: final.plan, report: final.report, shortfallReason: final.plan.shortfallReason,
      listReadyAt: new Date(f.started).toISOString(), detailsReadyAt: new Date(f.started).toISOString(),
      items: [{ itemId: detail.itemId, seriesId: detail.seriesId, rank: detail.rank, name: detail.name, edition: detail.edition,
        trackLabel: detail.trackLabel, officialUrl: null, detailStatus: "ready", detail }],
      detailGroups: { schemaVersion: "saitu.persisted-detail-groups.v1", groups: groups.map(group =>
        ({ ...group, spec: group.prepared.groupSpec, status: "failed", version: 3, updatedAt: new Date(f.started).toISOString() })) } } };
    const session: DecisionSessionV7 = { id: f.run.stateKey, sessionId: randomUUID(), currentRunId: f.run.runId,
      generation: 0, expiresAt, profile: f.context.profile, legacy: f.legacy, history: [] };
    expect(presentRunV7(run, session).items[0].detail).toEqual(detail);
    const tampered = structuredClone(run);
    tampered.body.detailGroups!.groups[0].prepared!.explanation.taskSelections![0].competitionFactId = f.original.id;
    expect(() => presentRunV7(tampered, session)).toThrow("INVALID_FINAL_SELECTION_BINDING");
    const changeBasis = (selection: GroupTaskSelectionV7) => { selection.learnerBasisSelection = goalBasis; };
    const changeConnection = (selection: GroupTaskSelectionV7) => { selection.taskConnection = "可直接公开个人记录。"; };
    for (const change of [changeBasis, changeConnection]) {
      const changedRun = structuredClone(run);
      const { prepared, reviewPreparation, reviewed } = changedRun.body.detailGroups!.groups[0];
      change(prepared!.explanation.taskSelections![0]);
      prepared!.explanationSha256 = groupCanonicalSha256V7(prepared!.explanation);
      const { preparedSha256: _previousPreparation, ...changedPreparation } = prepared!;
      prepared!.preparedSha256 = groupCanonicalSha256V7(changedPreparation);
      reviewPreparation!.preparedSha256 = prepared!.preparedSha256;
      reviewed!.preparedSha256 = prepared!.preparedSha256;
      const { reviewedSha256: _previousReview, ...changedReview } = reviewed!;
      reviewed!.reviewedSha256 = groupCanonicalSha256V7(changedReview);
      expect(() => presentRunV7(changedRun, session)).toThrow("INVALID_FINAL_SELECTION_BINDING");
    }
    const wrongOwner = structuredClone(run).body.detailGroups!.groups[0].reviewPreparation!;
    wrongOwner.call.reviewOwnerKeyBindings![0].ownerAlias = "@C999";
    wrongOwner.ownerKeyMapSha256 = groupCanonicalSha256V7(wrongOwner.call.reviewOwnerKeyBindings);
    tampered.body.detailGroups!.groups[0] = { ...run.body.detailGroups!.groups[0], reviewPreparation: wrongOwner };
    expect(() => presentRunV7(tampered, session)).toThrow("INVALID_FINAL_SELECTION_BINDING");
    const changedVote = structuredClone(run).body.detailGroups!.groups[0].reviewed!;
    changedVote.checks[0].supported = false;
    const { reviewedSha256: _oldSha, ...newReview } = changedVote;
    changedVote.reviewedSha256 = groupCanonicalSha256V7(newReview);
    run.body.detailGroups!.groups[0].reviewed = changedVote;
    expect(() => presentRunV7(run, session)).toThrow("INVALID_FINAL_SELECTION_BINDING");
  });

  it.each([{ index: undefined, issue: "missing_explicit_fact_index" }, { index: 999, issue: "invalid_reason_anchor" }])(
    "rejects a missing or out-of-row explicit fact index ($index) without reusing the rank anchor", async ({ index, issue }) => {
      const f = fixture(1), [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
      const modelCall = vi.fn(async (prompt: string) => response(f, prompt, () => ({ factIndex: index })));
      await expect(generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options, modelCall }))
        .rejects.toMatchObject({ issues: [`${issue}:${f.records[0].recordId}`] });
      expect(modelCall).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the conditions axis for actions implied in otherwise valid connection text", async () => {
    const f = fixture(3), [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const connections = [
      "在纸面原型上核对反馈的经验有助于理解同一对象的两份记录为什么要对应相同字段。",
      "断网重开处理记录页面后记录反馈，可以核对同一对象前后的处理决定。",
      "若可借设备并取得离线运行工具，再用同一对象核对断网前后记录的差异。",
    ];
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options,
      modelCall: async prompt => response(f, prompt, row => ({ taskConnection: connections[row] })) });
    const item = prepared.explanation.recommendations[0], selected = prepared.explanation.taskSelections![0];
    expect(prepared.explanation.taskSelections?.map(selection => selection.taskConnection)).toEqual(connections);
    const prefix = `\n${MATCHING_RELATION_LABEL_V764}：`;
    const [display, bridge] = item.reasons[0].text.split(prefix);
    expect(display).toContain(past);
    expect(readTaskConnectionV767(bridge, selected)).toBe(connections[0]);
    expect(readTaskConnectionV767(bridge, {
      learnerBasisSelection: selected.learnerBasisSelection, taskConnection: connections[1],
    })).toBeUndefined();
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, prepared, { ...f.options, persisted: receipt(f, prepared),
      persistReviewPreparation: async () => {}, modelCall: async (prompt, request) => {
        const { assertions } = decodedGroupWire(prompt);
        expect(assertions.map((row: { reason: { text: string } }) => row.reason.text)).toEqual(connections);
        for (const row of assertions) {
          expect(row).not.toHaveProperty("relationMode");
          expect(row).not.toHaveProperty("actionPrerequisite");
        }
        expect(request.systemPrompt).toContain("只在正文确实建议行动时审该行动的真实依赖");
        expect(request.systemPrompt).not.toContain("actionPrerequisite");
        expect(request.systemPrompt).toContain("已知拒做或未获许可不能假定解除");
        // These scripted verdicts exercise the display and review routing.
        return success({ checks: assertions.map(({ key }: { key: string }, index: number) =>
          matchingRelationReviewBallotFixture(key, index === 1 ? "直接操作缺待核条件" : "条件覆盖实做或仅作理解", { conditions: index !== 1 })) });
      },
    });
    expect(reviewed.itemOutcomes.map(row => row.status)).toEqual(["ready", "failed", "ready"]);
  });

  it("rejects exchanging a specifically ranked step for another step in the same role", async () => {
    const f = fixture();
    f.plan.recommendations[0].rankTaskStepIndex = 1;
    const [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const modelCall = vi.fn(async (prompt: string) => {
      const wire = explainWire(prompt);
      expect(wire.candidates[0]).toMatchObject({ roles: [{ taskOptions: [{ index: 1, text: "比较旧记录与新记录" }] }] });
      return response(f, prompt, row => row === 0 ? { taskStepIndex: 2 } : {});
    });
    await expect(generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options, modelCall }))
      .rejects.toMatchObject({ issues: [`invalid_group_task_selection:${f.records[0].recordId}`] });
    expect(modelCall).toHaveBeenCalledTimes(1);
  });

  it("keeps omitted official quantifiers and implementation names out of a published sibling", async () => {
    const f = fixture(4);
    for (const record of f.records) record.facts[0].text = "选题要求至少两个独立控制维度、至少四个声部且总延迟不高于10毫秒。";
    const [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const connections = [
      "先读所引选题二原文，在纸面把“至少两个独立控制维度、四声部、总延迟≤10毫秒”逐条抄成核验表",
      "用boundFact逐项核对设备限制。",
      "原文要求至少四个声部，先自拟四声部小例子走查每条路径",
      "题面要求四个声部或更多；作者和来源缺项仍待查。",
    ];
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options,
      modelCall: async prompt => response(f, prompt, row => ({ taskConnection: connections[row] })) });
    const original = structuredClone(prepared);
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, prepared, { ...f.options, persisted: receipt(f, prepared),
      persistReviewPreparation: async () => {}, modelCall: async prompt => success({ checks: decodedGroupWire(prompt).assertions.map(({ key }: { key: string }) =>
        matchingRelationReviewBallotFixture(key, "模拟全真票，核对本地逐项否决。")) }),
    });
    expect(prepared).toEqual(original);
    expect(reviewed.checks.every(row => row.supported)).toBe(true);
    expect(reviewed.itemOutcomes.map(row => row.status)).toEqual(["failed", "failed", "ready", "ready"]);
  });

  it("still parses the stored v763 conditional practice in its historical format", () => {
    const task = "比较旧记录与新记录";
    const conditionalPractice = { needs: "可借设备及离线运行工具", action: "制作可点击原型，断网重开并检查反馈。" };
    const fields = { ...legacyTrial,
      practice: `${legacyTrial.practice}。前置核实：可借设备及离线运行工具。确认后可制作可点击原型，断网重开并检查反馈` };
    const learnerBasisSelection = studentFactBasis();
    const bridge = composeIndexedTaskPracticeBridgeV760(task, fields, learnerBasisSelection);
    const binding = { learnerBasisSelection, conditionalPractice };
    expect(readSealedTaskPracticeFieldsV7(task, bridge, binding, true)).toEqual({ ...fields, check: "逐项回看原文提供的结果，缺项标待查" });
    expect(readSealedTaskPracticeFieldsV7(task, bridge, binding)).toBeUndefined();
  });

  it("preserves the typed prerequisite in the historical v766 connection", () => {
    const learnerBasisSelection = studentFactBasis();
    const taskRelation = { mode: "apply" as const, taskPoint: "制作纸面原型并核对选项反馈。", prerequisite: "能取得可公开使用的任务记录" };
    const bridge = composeTaskRelationV766(learnerBasisSelection, taskRelation);
    expect(bridge).toBe("对应上述第1条自述。前置核实：能取得可公开使用的任务记录。条件满足后，可据此尝试：制作纸面原型并核对选项反馈。");
    expect(readTaskRelationV766(bridge, { learnerBasisSelection, taskRelation })).toBe(
      "前置核实：能取得可公开使用的任务记录。条件满足后，可据此尝试：制作纸面原型并核对选项反馈。");
    expect(readTaskConnectionV767(bridge, { learnerBasisSelection, taskConnection: taskRelation.taskPoint })).toBeUndefined();
  });

  it("recognizes equivalent bounds and a separate paper example of the same amount in v759 prose", () => {
    const source = "规则要求连接至少一个云端大模型并处理非音视频数据";
    const issue = (check: string) => quotedTaskPracticeTextIssueV759({ ...legacyTrial, check }, [], source);
    expect(issue("核对原文要求连接一个云端大模型或更多。")).toBeUndefined();
    expect(issue("原文要求连接至少一个云端大模型，先选一个云端大模型做纸面示例，实际接入仍待验证。")).toBeUndefined();
    expect(issue("题面要求只接入一个云端大模型。")).toBe("changed_source_quantifier");
  });

  it.each([
    {
      label: "adds a repeated reading to the student's past",
      source: "校准过土壤含水量传感器并做烘干对照",
      taskConnection: "用所选校准与烘干对照中同一对象重复读数的既有做法，理解为什么读数需要与参照值成对核对。",
      supported: false,
    },
    {
      label: "uses actual regular measurements",
      source: "校准过土壤含水量传感器，每小时给同一对象测一次，并做烘干对照",
      taskConnection: "同一对象的重复测量能帮助读懂参照核对，区分来自同一对象的读数变化。",
      supported: true,
    },
    {
      label: "uses a synonym for an actual action",
      source: "校准过土壤含水量传感器并做烘干对照",
      taskConnection: "标定经验有助于理解原任务为什么要用参照核对区分测量值与参照值。",
      supported: true,
    },
    {
      label: "schedules a new frequency for the future",
      source: "校准过土壤含水量传感器并做烘干对照",
      taskConnection: "若可取得设备及授权且符合安全条件，可以自拟每小时一次的读数频次，比较同一对象的测量值与参照值。",
      supported: true,
    },
    {
      label: "honors an explicit negative",
      source: "校准过土壤含水量传感器并做烘干对照，但未对同一对象重复测量",
      taskConnection: "参照核对中的两类记录怎样对应，以及哪些条件下才需要重复测量。",
      supported: true,
    },
    {
      label: "turns a negative into previous participation",
      source: "校准过土壤含水量传感器并做烘干对照，但未对同一对象重复测量",
      taskConnection: "用已在同一对象上重复测量的做法，理解参照表为何区分不同读数。",
      supported: false,
    },
  ])("keeps the full source for reviewer judgment when a matching relation $label", async example => {
    const f = fixture(1);
    Object.assign(f.experience, { originalText: example.source, value: example.source, label: example.source });
    delete f.plan.recommendations[0].rankGoalIndex;
    const [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options,
      modelCall: async (prompt, request) => {
        expect(explainWire(prompt).candidates[0].learnerBasisOptions).toEqual([
          { index: 0, kind: "student_fact", factKind: "reported_experience", text: example.source },
        ]);
        expect(request.systemPrompt).toContain("taskConnection");
        expect(request.systemPrompt).not.toMatch(/taskRelation\.taskPoint|mode为apply/u);
        return response(f, prompt, () => taskConnectionReasonFixture(example.taskConnection));
      },
    });
    const unchanged = structuredClone(prepared);
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, prepared, { ...f.options,
      persisted: receipt(f, prepared), persistReviewPreparation: async () => {},
      modelCall: async (prompt, request) => {
        const wire = decodedGroupWire(prompt), [row] = wire.assertions;
        expect(row.learnerBasisSelection).toEqual({ ...studentFactBasis(), studentFactId: row.reason.studentFactIds[0] });
        expect(wire.profile.facts).toContainEqual(expect.objectContaining({ id: row.learnerBasisSelection.studentFactId,
          originalText: example.source, state: "affirmed" }));
        expect(row.reason.text).toBe(example.taskConnection);
        expect(row).not.toHaveProperty("relationMode");
        expect(row).not.toHaveProperty("actionPrerequisite");
        expect(request.systemPrompt).toContain("保留主体、时态、否定和条件；计划不等于已有");
        // Use scripted verdicts to verify evidence transport and receipt projection.
        return success({ checks: [matchingRelationReviewBallotFixture(row.key,
          example.supported ? "原始依据与未来用途可对照" : "文案增补未证实的过去动作", { learnerAttribution: example.supported })] });
      },
    });
    expect(prepared).toEqual(unchanged);
    expect(reviewed.checks.map(row => row.supported)).toEqual([example.supported, example.supported]);
    expect(reviewed.itemOutcomes[0].status).toBe(example.supported ? "ready" : "failed");
  });

  it("keeps explanation evidence literal and rejects control tokens without rejecting a public task identifier", async () => {
    const f = fixture(4);
    f.records[1].facts[0].text = "题面把测量参照件命名为 t11。";
    f.records[2].facts[0].text = "题面要求对照公开的 $text 查询与匹配输出。";
    const [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const applications = [
      "选t11：为未来的记录对照标出输入。",
      "选t11：按题面公开参照件编号完成同对象走查。",
      "用 $text: 公开查询作为对照并核对匹配结果。",
      "将字典 {$scope:'s7'} 写到记录旁。",
    ];
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options,
      modelCall: async (prompt, request) => {
        const literal = JSON.parse(prompt);
        expect(literal).not.toHaveProperty("evidenceDictionary");
        expect(literal).not.toHaveProperty("tableSchemas");
        expect(literal.candidates[0].learnerBasisOptions[0].text).toBe(past);
        expect(literal.candidates[1].evidenceOptions.map((fact: { text: string }) => fact.text)).toContain(f.records[1].facts[0].text);
        expect(request.systemPrompt).not.toContain("tableSchemas");
        return response(f, prompt, row => taskConnectionReasonFixture(applications[row]));
      },
    });
    const frozen = structuredClone(prepared), observations = vi.fn();
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, prepared, { ...f.options, persisted: receipt(f, prepared),
      persistReviewPreparation: async () => {}, onObservation: observations,
      modelCall: async prompt => success({ checks: decodedGroupWire(prompt).assertions.map(({ key }: { key: string }) =>
        matchingRelationReviewBallotFixture(key, "模拟原票用于核对本地识别，不判断语义。")) }),
    });
    expect(reviewed.checks.every(check => check.supported)).toBe(true);
    expect(prepared).toEqual(frozen);
    expect(reviewed.itemOutcomes.map(row => row.status)).toEqual(["failed", "ready", "ready", "failed"]);
    expect(observations).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      locallyRejected: [0, 3].map(index => ({ itemId: spec.itemIds[index], issue: "internal_identifier" })),
    }) }));
  });

  it("filters only generated internal fact references while retaining the raw review and a real public label", async () => {
    const f = fixture(4);
    f.records[2].facts[0].text = "该资料把公开对照模块的技术标识写为 FACT2。";
    f.experience.originalText = "做过用 fact1 标记输入的纸面试验。";
    f.experience.value = f.experience.originalText;
    const [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const connections = [
      "核fact2人数及子样本同源；DOI不可达待查。",
      "ＦＡＣＴ１给开放题对象与待研究参数；可用同一对象核对结果。",
      "对照FACT2在原文中的公开模块名和输入。",
      "查原文第6题、Case #1与条件1.21的标注位置。",
    ];
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options,
      modelCall: async prompt => response(f, prompt, row => taskConnectionReasonFixture(connections[row])) });
    expect(prepared.explanation.recommendations[0].reasons[0].text).toContain(f.experience.originalText);
    expect(prepared.explanation.recommendations[0].reasons[0].text).toContain("核fact2人数");
    const original = structuredClone(prepared);
    const onObservation = vi.fn();
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, prepared, { ...f.options, persisted: receipt(f, prepared),
      persistReviewPreparation: async () => {}, onObservation,
      modelCall: async prompt => success({ checks: decodedGroupWire(prompt).assertions.map(({ key }: { key: string }) =>
        matchingRelationReviewBallotFixture(key, "合成真票核对本地逐项保护。")) }),
    });
    expect(prepared).toEqual(original);
    expect(reviewed.checks.every(row => row.supported)).toBe(true);
    expect(reviewed.itemOutcomes.map(row => row.status)).toEqual(["failed", "failed", "ready", "ready"]);
    expect(onObservation).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      locallyRejected: [0, 1].map(index => ({ itemId: spec.itemIds[index], issue: "internal_identifier" })),
    }) }));
  });

  it("keeps opposite attribution axes for one account-book claim against distinct complete sources in one review", async () => {
    const f = fixture();
    const task = "区分单位变动成本中的材料费和工时成本";
    const anchorText = "单位变动成本要分别归集材料费和工时成本。";
    const taskConnection = "自己账表里逐项记录的材料费和工时，可用于核对原任务的两类单位变动成本。";
    const sources = [
      "售出过手工陶饰并计算材料工时成本，在自己的账表逐项记录了材料费和工时。",
      "售出过手工陶饰并计算材料工时成本，当时只口头算过，没有留存账表。",
    ];
    const noAccountBook = { ...f.experience, id: "student.past.no-account-book", field: "experience.3.task",
      originalText: sources[1], value: sources[1], label: sources[1] };
    Object.assign(f.experience, { originalText: sources[0], value: sources[0], label: sources[0] });
    f.context.profile.facts.push(noAccountBook);
    for (const [index, row] of f.plan.recommendations.entries()) {
      delete row.rankGoalIndex;
      row.reasons[0].studentFactIds = [index === 0 ? f.experience.id : noAccountBook.id];
      f.records[index].roles[0].task = task;
      f.records[index].facts[0].text = anchorText;
    }
    const [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options, modelCall: async prompt => {
      expect(explainWire(prompt).candidates.map(row => row.learnerBasisOptions)).toEqual(sources.map(text => [
        { index: 0, kind: "student_fact", factKind: "reported_experience", text },
      ]));
      return response(f, prompt, () => taskConnectionReasonFixture(taskConnection));
    } });
    expect(prepared.explanation.taskSelections?.map(selection => selection.taskConnection)).toEqual([taskConnection, taskConnection]);
    for (const [index, item] of prepared.explanation.recommendations.entries()) {
      expect(item.reasons[0].text).toContain(`你提到「${sources[index]}」。`);
      expect(item.reasons[0].text.endsWith(`对应上述第1条自述。${taskConnection}`)).toBe(true);
    }
    let ballots: ReturnType<typeof matchingRelationReviewBallotFixture>[] = [];
    const modelCall = vi.fn(async (prompt: string) => {
      const { assertions, profile } = decodedGroupWire(prompt);
      expect(assertions).toHaveLength(2);
      const [withBook, withoutBook] = assertions;
      expect(withBook.learnerBasisSelection.studentFactId).not.toBe(withoutBook.learnerBasisSelection.studentFactId);
      for (const [index, row] of assertions.entries()) {
        const id = row.learnerBasisSelection.studentFactId;
        expect(row.learnerBasisSelection).toEqual({ ...studentFactBasis(), studentFactId: id });
        expect(row.reason.studentFactIds).toEqual([id]);
        expect(profile.facts).toContainEqual(expect.objectContaining({ id, originalText: sources[index], state: "affirmed" }));
        expect(row.competitionItems[0].citedFacts).toEqual([expect.objectContaining({ text: anchorText })]);
        expect(row.reason.text).toBe(taskConnection);
        expect(row).not.toHaveProperty("relationMode");
        expect(row).not.toHaveProperty("actionPrerequisite");
      }
      // Fixed axes verify evidence transport, conjunction and publication routing.
      ballots = [
        matchingRelationReviewBallotFixture(withoutBook.key, "合成票：所选原话否认留有账表", { learnerAttribution: false }),
        matchingRelationReviewBallotFixture(withBook.key, "合成票：所选原话明确留有账表"),
      ];
      return success({ checks: ballots });
    });
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, prepared, { ...f.options, persisted: receipt(f, prepared),
      persistReviewPreparation: async entry => { expect(entry.preparedSha256).toBe(prepared.preparedSha256); }, modelCall });
    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(reviewed.matchingRelationReview?.ballots).toEqual(ballots);
    expect(reviewed.checks.map(row => row.supported)).toEqual([true, true, false, false]);
    expect(reviewed.itemOutcomes.map(row => row.status)).toEqual(["ready", "failed"]);
    const final = assembleReviewedGroupsFinalV7(f.context, f.plan, [{ prepared, reviewed }], f.run,
      { calls: [], startedAtEpochMs: f.started, completedAtEpochMs: f.started });
    expect(final.report.recommendations.map(item => item.itemId)).toEqual([f.records[0].recordId]);
    expect(final.report.recommendations[0].reasons[0].studentFactIds).toEqual([f.experience.id]);
  });

  it.each([
    { source: "校准过土壤含水量传感器并做烘干对照",
      taskConnection: "本人校准传感器时留下的条件记录，可帮助区分参照值和测量值。", supported: false },
    { source: "售出过手工陶饰并计算材料工时成本",
      taskConnection: "计算材料与工时成本的经验，能帮助理解原任务如何区分这两类单位变动成本。", supported: true },
  ])("transports the exact learner source for the scripted verdict on $taskConnection", async draft => {
    const f = fixture(1), [selected] = f.plan.recommendations;
    delete selected.rankGoalIndex;
    Object.assign(f.experience, { originalText: draft.source, value: draft.source, label: draft.source });
    const [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options,
      modelCall: async prompt => response(f, prompt, () => taskConnectionReasonFixture(draft.taskConnection)) });
    expect(prepared.explanation.recommendations[0].reasons[0].text).toContain(`你提到「${draft.source}」。`);
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, prepared, { ...f.options, persisted: receipt(f, prepared),
      persistReviewPreparation: async () => {}, modelCall: async (prompt, request) => {
        const wire = decodedGroupWire(prompt), [row] = wire.assertions;
        expect(wire.profile.facts).toContainEqual(expect.objectContaining({ id: row.learnerBasisSelection.studentFactId, originalText: draft.source }));
        expect(row.reason.text).toBe(draft.taskConnection);
        expect(request.systemPrompt).toContain("保留主体、时态、否定和条件；计划不等于已有");
        return success({ checks: [matchingRelationReviewBallotFixture(row.key,
          draft.supported ? "合成支持票" : "合成票：所引自述未证既有记录", { learnerAttribution: draft.supported })] });
      },
    });
    expect(reviewed.checks.map(row => row.supported)).toEqual([draft.supported, draft.supported]);
    expect(reviewed.itemOutcomes[0].status).toBe(draft.supported ? "ready" : "failed");
  });

  it.each([{ row: 0, index: undefined }, { row: 0, index: 2 }, { row: 1, index: 1 }, { row: 1, index: 999 }])(
    "rejects missing or out-of-row learner selection ($row, $index)", async ({ row, index }) => {
    const f = fixture(), [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const modelCall = vi.fn(async (prompt: string) => response(f, prompt, indexInGroup => indexInGroup === row
      ? { learnerBasisIndex: index } : {}));
    await expect(generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options, modelCall }))
      .rejects.toMatchObject({ issues: [`invalid_learner_basis_selection:${f.records[row].recordId}`] });
    expect(modelCall).toHaveBeenCalledTimes(1);
  });

  it("rejects historical mode, free prose and quote fields in v767 generation", async () => {
    const f = fixture(), [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const modelCall = vi.fn(async (prompt: string) => response(f, prompt, row => row === 0 ? {
      taskConnection: undefined, taskRelation: { mode: "apply", taskPoint: legacyTrial.connection, prerequisite: "能核对原始记录" },
      futureUse: legacyTrial.connection, practice: legacyTrial.practice, check: legacyTrial.check,
      connection: { basis: { ...studentFactBasis(), quote: past }, application: legacyTrial.connection },
    } : {}));
    await expect(generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options, modelCall })).rejects.toMatchObject({ issues: [
      "recommendations.0.reason.taskConnection:invalid_type expected=string", "recommendations.0.reason:unrecognized_keys",
    ] });
    expect(modelCall).toHaveBeenCalledTimes(1);
  });

  it("gives the reviewer the full conditional source for each scripted relation verdict", async () => {
    const f = fixture(3);
    const original = "我只在有公开资料时做「均值和图表」，没做因果推断";
    Object.assign(f.experience, { originalText: original, value: original, label: original });
    for (const row of f.plan.recommendations) row.reasons[0].studentFactIds = [f.experience.id];
    const [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const connections = [
      "只在有公开原记录时，前后均值与并列图可以帮助读懂原任务如何核对同组数据的差值。",
      "已有的因果推断能力可以证明处理决定导致了差值。",
      "读原文并做表可以积累资料整理能力。",
    ];
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options,
      modelCall: async prompt => response(f, prompt, index => taskConnectionReasonFixture(connections[index])) });
    const { reviewed } = await reviewPreparedGroupV7(f.context, f.plan, prepared, { ...f.options,
      persisted: receipt(f, prepared), persistReviewPreparation: async () => {},
      modelCall: async prompt => {
        const wire = decodedGroupWire(prompt);
        expect(wire.profile.facts).toContainEqual(expect.objectContaining({ originalText: original }));
        for (const row of wire.assertions) {
          const studentFactId = row.reason.studentFactIds[0];
          expect(row.learnerBasisSelection).toEqual({ ...studentFactBasis(), studentFactId });
          expect(wire.profile.facts).toContainEqual(expect.objectContaining({ id: studentFactId, originalText: original, state: "affirmed" }));
        }
        expect(wire.assertions.map((row: { reason: { text: string } }) => row.reason.text)).toEqual(connections);
        expect(wire.assertions[0]).not.toHaveProperty("actionPrerequisite");
        return success({ checks: wire.assertions.map(({ key }: { key: string }, index: number) =>
          matchingRelationReviewBallotFixture(key, ["共享前后均值核对", "原话否定因果方法", "泛读表格未落到共同行为"][index],
            { learnerAttribution: index !== 1, fit: index !== 2 })) });
      },
    });
    expect(reviewed.itemOutcomes.map(row => row.status)).toEqual(["ready", "failed", "failed"]);
    expect(reviewed.checks.map(row => row.supported)).toEqual([true, true, false, false, false, false]);
  });

  it("renders the entire goal including its exclusion", async () => {
    const f = fixture(), goal = "探索计算生物而非湿实验";
    f.context.profile.primaryGoal = goal;
    f.context.profile.goals = [goal, buildGoal];
    f.plan.recommendations[0].rankGoalIndex = 0;
    const [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
    const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options,
      modelCall: async prompt => response(f, prompt, index => index === 0
        ? taskConnectionReasonFixture("公开资料中的计算方法与结果如何对应，是了解该计算任务的一个环节。", 1) : {}) });
    const visible = prepared.explanation.recommendations[0].reasons[0].text;
    expect(prepared.explanation.taskSelections?.[0].learnerBasisSelection).toEqual(goalBasis);
    expect(visible).toContain(`你的目标是「${goal}」`);
    expect(visible).toContain("对应上述目标。公开资料中的计算方法与结果如何对应");
    expect(visible).not.toContain("围绕目标「湿实验」");
  });

  it.each(["valid-owner", "group-external", "duplicate", "missing", "unknown"] as const)(
    "resolves only unique, exactly owned review keys: %s", async scenario => {
      vi.stubEnv("SAITU_V7_DETAIL_LAYOUT", "parallel-2");
      const f = fixture(4), [spec] = createExplanationGroupSpecsV7(f.context, f.plan, f.run);
      const { prepared } = await generateGroupExplanationV7(f.context, f.plan, spec, { ...f.options,
        modelCall: async prompt => response(f, prompt, () => ({})) });
      const observe = vi.fn();
      let persisted: GroupReviewPreparationV7 | undefined;
      let raw: ReturnType<typeof matchingRelationReviewBallotFixture>[] = [];
      const modelCall = vi.fn(async (prompt: string) => {
        const wire = decodedGroupWire(prompt);
        const [first, second] = wire.assertions;
        expect(persisted?.call.reviewOwnerKeyBindings).toEqual([
          { itemId: spec.itemIds[0], ownerAlias: first.itemId, reviewAlias: first.key },
          { itemId: spec.itemIds[1], ownerAlias: second.itemId, reviewAlias: second.key },
        ]);
        expect(persisted?.ownerKeyMapSha256).toBe(groupCanonicalSha256V7(persisted!.call.reviewOwnerKeyBindings));
        raw = [matchingRelationReviewBallotFixture(spec.itemIds[1], "@P0", { fit: false }),
          matchingRelationReviewBallotFixture(first.itemId, "  可核联系。  ")];
        if (scenario === "group-external") raw[0].key = "@C2";
        if (scenario === "duplicate") raw[0].key = first.key;
        if (scenario === "unknown") raw[0].key = "@C999";
        if (scenario === "missing") raw.pop();
        return success({ checks: raw });
      });
      const result = reviewPreparedGroupV7(f.context, f.plan, prepared, { ...f.options, persisted: receipt(f, prepared), onObservation: observe,
        persistReviewPreparation: async entry => { persisted = entry; }, modelCall });
      if (scenario === "valid-owner") {
        const { reviewed } = await result;
        expect(raw.map(row => row.key)).toEqual([spec.itemIds[1], "@C0"]);
        expect(reviewed.matchingRelationReview?.ballots).toEqual(raw);
        expect(reviewed.checks.map(({ supported, reason }) => ({ supported, reason }))).toEqual([
          { supported: true, reason: "  可核联系。  " }, { supported: true, reason: "  可核联系。  " },
          { supported: false, reason: "@P0" }, { supported: false, reason: "@P0" },
        ]);
        expect(reviewed.itemOutcomes.map(row => row.status)).toEqual(["ready", "failed"]);
        expect(observe).toHaveBeenCalledWith(expect.objectContaining({ stage: "v7.review", kind: "validation",
          data: expect.objectContaining({ source: "unique_owner_review_key", resolutions: [
            { originalKey: spec.itemIds[1], reviewKey: "R02" }, { originalKey: "@C0", reviewKey: "R01" },
          ] }) }));
      } else {
        await expect(result).rejects.toThrow("incomplete_support_review");
        expect(observe).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ source: "unique_owner_review_key" }) }));
      }
      expect(modelCall).toHaveBeenCalledTimes(1);
    },
  );
});
