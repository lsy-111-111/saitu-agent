import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withDecisionEffortPolicy } from "@/lib/ai/effort-context";
import { decisionRequestSha256, effortPolicySha256, RANK_NON_THINKING_EFFORT_POLICY } from "@/lib/ai/effort-policy.mjs";
import { decisionReportSchema, studentProfileSchema, type StudentFactV6 } from "@/lib/competitions/v6/contracts";
import { assembleDecisionReport, claim } from "@/lib/competitions/v6/engine";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { buildAssertionReviewPacketV7 } from "@/lib/competitions/v7/evidence-packet";
import { assembleReviewedGroupDetailsV7, createExplanationGroupSpecsV7, generateGroupExplanationV7, reviewPreparedGroupV7, type GroupReviewPreparationV7 } from "@/lib/competitions/v7/explanation-groups";
import { buildDecisionContextV7, completeAssertionReviewPacketV7, matchExplanationInputV7, rankDecisionV7, validateDecisionReportV7 } from "@/lib/competitions/v7/model";
import { composeTaskConnectionV767 } from "@/lib/competitions/v7/role-task-practice";
import { expandReviewPacketV7, projectReviewPacketV7, REVIEW_PACKET_PROJECTION_PROMPT_V7 } from "@/lib/competitions/v7/review-packet-projection";
import { directAssertionReviewPacketV7, groundedFutureBridgeReviewPacketV7, MATCHING_RELATION_REVIEW_CONTRACT_V767, type GroundedFutureBridgeReviewBindingV7 } from "@/lib/competitions/v7/review-transport";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";
import { decodedGroupWire, matchingRelationReviewBallotFixture, studentFactBasis } from "./group-reason-fixture";

// Synthetic transport regression only. Mock verdicts are never model quality
// evidence, an accepted development sample, or credit toward formal acceptance.
const success = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });

function fixture() {
  const record = syntheticRecord(1), source = record.sources[0];
  record.identity = { editionId: "fixture-edition", trackId: record.track.id, groupId: "fixture-group", scopeId: "fixture-scope",
    stageIds: [], supersedesRecordIds: [], legacyRecordIds: [] };
  const entity = { editionId: record.identity.editionId, trackId: record.identity.trackId, groupId: record.identity.groupId, scopeId: record.identity.scopeId };
  source.scope = "合成赛题原件的特定届次与赛道";
  const anchor = { ...record.facts[0], entity, sourceScopes: [{ sourceId: source.id, scope: source.scope }],
    text: Array.from({ length: 45 }, (_, index) => `第${index + 1}条记录须分别标明数据对象、清理步骤、核对结果和原始依据。`).join("\n") };
  const outsideSource = { ...source, id: "fixture-source-other-scope", scope: "另一届次的来源范围" };
  record.sources.push(outsideSource);
  record.facts = [anchor, { ...anchor, id: "fixture-wrong-source-scope", text: "另一届次的资料不能证明本赛道要求。",
    sourceIds: [outsideSource.id], sourceScopes: [{ sourceId: outsideSource.id, scope: source.scope }] }];
  const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records: [record] });
  const resource = (id: string, originalText: string, patch: Partial<StudentFactV6> = {}): StudentFactV6 => ({
    id, field: `resources.${id}`, value: originalText, label: originalText, originalText,
    answerId: `answer-${id}`, state: "affirmed", confirmed: true, evidenceLevel: "self_report", ...patch,
  });
  const resources = [
    resource("own-computer", "我目前有一台本人可用的电脑。"),
    resource("friend-permission", "朋友已获准使用其项目文件，我的材料权限尚未知。"),
    resource("future-device", "有机会争取另一台设备的使用权。"),
    resource("denied-network", "当前不能使用该网络。", { value: false, state: "negated" }),
    resource("unknown-permission", "本人材料使用权限未知。", { state: "unknown", confirmed: false }),
    resource("withdrawn-computer", "撤回另一台电脑可用的说法。", { state: "retracted", confirmed: false }),
  ];
  context.profile.facts.push(...resources);
  context.profile.retractedFactIds.push("withdrawn-computer");
  context.profile = studentProfileSchema.parse(context.profile);
  return { context, resources, anchor };
}

beforeEach(() => {
  vi.stubEnv("SAITU_V7_DETAIL_LAYOUT", "single");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("v736_resource_chain_forbids_http"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("original v736 resource provenance through the current bound model chain", () => {
  it.each([true, false])("retains full resource provenance when the scripted conditions axis is %s", async supported => {
    await withDecisionEffortPolicy(RANK_NON_THINKING_EFFORT_POLICY, async () => {
      const { context, resources, anchor } = fixture(), originalContext = structuredClone(context);
      const selectedId = context.candidates[0].record.recordId;
      const role = context.candidates[0].record.roles[0];
      const taskConnection = supported
        ? "数据分析能帮助理解同一对象的数据清理决定怎样影响结果。"
        : "通过该网络调取朋友的项目文件，可以核对同一对象的数据清理决定与结果。";
      const learnerBasisSelection = studentFactBasis();
      const bridge = composeTaskConnectionV767(learnerBasisSelection, taskConnection);
      const composed = `已核资料（历史资料，${anchor.scope}）：${anchor.text}\n据此分析：你提到「数据分析与建模」。\n可选分工（编辑建议）「${role.name}」：${role.task}\n匹配关系：${bridge}`;
      expect(composed.length).toBeGreaterThan(1500);
      expect(composed.length).toBeLessThanOrEqual(1600);
      const personal = context.profile.facts.find(fact => fact.field === "skills")!;
      const plan = await rankDecisionV7(context, { modelCall: async (prompt, options) => {
        expect(options).toMatchObject({ operation: "competition_v7_rank", thinking: "disabled", temperature: 0, topP: 1, maxAttempts: 1 });
        return success(rankFixtureAssessmentReply(context, echoRankWireHeaders(prompt, {
          recommendations: [{ itemId: selectedId, roleIndex: 0,
            rationale: "用自报的数据分析能力核对原任务数据清理决策。", ...rankFixtureEvidence(context, selectedId) }], shortfallReason: "合成测试仅选一项。" })));
      } });
      expect(plan.recommendations.map(row => row.itemId)).toEqual([selectedId]);
      const run = { runId: randomUUID(), stateKey: "v736-resource-chain-offline", generation: 0, implementationSha256: "a".repeat(64),
        effortPolicySha256: effortPolicySha256(RANK_NON_THINKING_EFFORT_POLICY), detailDeadlineEpochMs: Date.now() + 150_000 };
      const [spec] = createExplanationGroupSpecsV7(context, plan, run);
      const codec = createModelIdentifierCodec({ candidates: context.candidates.map(row => row.record.recordId), series: context.candidates.map(row => row.record.seriesId),
        facts: context.candidates.flatMap(row => row.record.facts.map(fact => fact.id)), students: context.profile.facts.map(fact => fact.id) });
      const options = { requestId: run.runId, runBinding: run, deadlineEpochMs: run.detailDeadlineEpochMs - 750 };
      const generated = await generateGroupExplanationV7(context, plan, spec, { ...options, modelCall: async (prompt, request) => {
        expect(request).toMatchObject({ operation: "competition_v7_explain", thinking: "enabled", reasoningEffort: "low", maxAttempts: 1 });
        const expected = matchExplanationInputV7(context, plan);
        const wire = decodedGroupWire(prompt), restored = codec.decode(expandCandidateEvidence(expandMatchingTables(wire))) as { candidates: unknown[] };
        const { facts: [boundFact], roles } = expected.candidates[0];
        const scopeOnlyRoles = roles.map(({ personalDeliverable: _displayDeliverable, ...scope }) => ({ ...scope,
          use: "role_scope_only", taskOptions: [{ index: 0, text: scope.task }] }));
        expect(restored).not.toHaveProperty("profile");
        expect(restored.candidates[0]).toMatchObject({ rowIndex: 0,
          evidenceOptions: [{ factIndex: 0, text: boundFact.text, kind: boundFact.kind, status: boundFact.status, scope: boundFact.scope }],
          rankedSelection: { factIndex: 0, taskStepIndex: 0 } });
        expect(restored.candidates[0]).toHaveProperty("roles", scopeOnlyRoles);
        expect(restored.candidates[0]).not.toHaveProperty("itemId");
        expect(restored.candidates[0]).not.toHaveProperty("internalRationale");
        expect(restored.candidates[0]).not.toHaveProperty("fixedStudentBasis");
        expect(restored.candidates[0]).not.toHaveProperty("provisionalRankRelation");
        expect(boundFact.id).toBe(anchor.id);
        expect(restored).not.toHaveProperty("studentBasisOptions");
        return success({ schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: wire.groupBindingSha256, groupId: spec.groupId,
          profileRevision: plan.profileRevision, catalogVersion: plan.catalogVersion, shortfallReason: plan.shortfallReason,
          recommendations: [{ rowIndex: 0, reason: { taskConnection, factIndex: wire.candidates[0].rankedSelection.factIndex } }] });
      } });
      const restoredPrepared = JSON.parse(JSON.stringify(generated.prepared)) as typeof generated.prepared;
      expect(restoredPrepared.explanation.recommendations[0].reasons[0].text).toBe(composed);
      expect(restoredPrepared.explanation.recommendations[0].roleReason).toEqual(restoredPrepared.explanation.recommendations[0].reasons[0]);
      const explained = { ...plan, recommendations: generated.prepared.explanation.recommendations };
      const critical = generated.prepared.assertions.filter(row => generated.prepared.criticalKeys.includes(row.key));
      const raw = completeAssertionReviewPacketV7(context, explained, buildAssertionReviewPacketV7(context, explained, critical), { compactReasonItemIds: spec.itemIds, compactReasonLengthPolicy: "soft_target" });
      const packet = { ...raw, fixedOrder: { ...raw.fixedOrder, groupReview: { groupId: spec.groupId, groupBindingSha256: generated.prepared.groupBindingSha256,
        preparedSha256: generated.prepared.preparedSha256, assertionsSha256: generated.prepared.assertionsSha256,
        purpose: MATCHING_RELATION_REVIEW_CONTRACT_V767 } } };
      const expectedDirect = directAssertionReviewPacketV7(codec.encode(packet));
      const bindings = codec.encode([{
        itemId: selectedId, fullReason: restoredPrepared.explanation.recommendations[0].reasons[0],
        bridge: taskConnection, selectedTaskFocus: role.task, selectedTaskStepIndex: 0, connectedTaskPractice: true,
        learnerBasisSelection, taskConnection,
        provisionalRankRelation: plan.recommendations[0].reasons[0].text,
        provisionalRankSelection: { taskStepIndex: 0, taskFocus: role.task, competitionFactId: anchor.id },
      }]) as GroundedFutureBridgeReviewBindingV7[];
      const expectedFocused = groundedFutureBridgeReviewPacketV7(expectedDirect, bindings, MATCHING_RELATION_REVIEW_CONTRACT_V767);
      expect(() => groundedFutureBridgeReviewPacketV7(expectedDirect, [{ ...bindings[0], bridge: `${taskConnection}。另加操作。` }], MATCHING_RELATION_REVIEW_CONTRACT_V767))
        .toThrow("invalid_grounded_future_bridge_review");
      const expectedProjection = projectReviewPacketV7(expectedFocused);
      let persisted: GroupReviewPreparationV7 | undefined;
      let actualReviewPrompt = "", actualReviewSystem = "";
      const reviewCall = vi.fn(async (prompt: string, request: { systemPrompt?: string; operation?: string; thinking?: string; reasoningEffort?: string; maxAttempts?: number }) => {
        expect(request).toMatchObject({ operation: "competition_v7_review", thinking: "enabled", reasoningEffort: "low", maxAttempts: 1 });
        const encoded = JSON.parse(prompt);
        expect(encoded.ownerReviewRows).toBe("saitu.owner-review-rows.v1");
        expect(encoded.assertions[0]).not.toHaveProperty("allowedItemIds");
        expect(encoded.assertions[0].competitionItems[0]).not.toHaveProperty("itemId");
        const exchanged = structuredClone(encoded);
        exchanged.assertions[0].itemId = "@C999";
        expect(() => decodedGroupWire(JSON.stringify(exchanged))).toThrow("invalid_owner_review_rows");
        const wire = decodedGroupWire(prompt);
        expect(request.systemPrompt?.includes(REVIEW_PACKET_PROJECTION_PROMPT_V7)).toBe(expectedProjection.projected);
        actualReviewPrompt = prompt; actualReviewSystem = request.systemPrompt!;
        expect(expandReviewPacketV7(wire)).toEqual(expectedFocused);
        const restored = codec.decode(expandReviewPacketV7(wire)) as typeof expectedFocused;
        expect(restored.profile).toEqual(context.profile);
        expect(restored.sharedCandidateBoundaries).toMatchObject([{ itemId: selectedId,
          boundary: { selectedRoleOriginal: { ...role, roleIndex: 0, kind: "editorial_inference" } } }]);
        expect(restored.assertions).toHaveLength(1);
        const row = restored.assertions[0];
        expect(row.reviewPurposes).toEqual(["recommendation_fit", "selected_role_action"]);
        expect(row.reason.text).toBe(taskConnection);
        expect(row).not.toHaveProperty("relationMode");
        expect(row).not.toHaveProperty("actionPrerequisite");
        expect(row.selectedTaskFocus).toBe(role.task);
        expect(restored.reviewContract).toBe(MATCHING_RELATION_REVIEW_CONTRACT_V767);
        expect(row.competitionItems[0].citedFacts).toEqual([anchor]);
        expect(row.competitionItems[0].sources.map(source => [source.id, source.scope])).toEqual(anchor.sourceScopes.map(source => [source.sourceId, source.scope]));
        expect(row.citedStudentFacts).toEqual([personal]);
        expect(restored.profile.facts).toEqual(expect.arrayContaining(resources));
        expect(row.studentCounterEvidence.facts).toEqual(expect.arrayContaining(resources.slice(3)));
        expect(row.citedStudentFacts.some(fact => resources.slice(2).some(resource => fact.id === resource.id))).toBe(false);
        return success({ checks: [matchingRelationReviewBallotFixture(wire.assertions[0].key, "合成传输判决，不能证明真实内容质量。", { conditions: supported })] });
      });
      const reviewed = await reviewPreparedGroupV7(context, plan, restoredPrepared, { ...options,
        persisted: { schemaVersion: "saitu.persisted-group-explanation.v1", runId: run.runId, groupId: spec.groupId,
          groupBindingSha256: generated.prepared.groupBindingSha256, preparedSha256: generated.prepared.preparedSha256, persistedResultVersion: 1, groupVersion: 1 },
        persistReviewPreparation: async value => { persisted = structuredClone(value); }, modelCall: reviewCall });
      expect(reviewCall).toHaveBeenCalledTimes(1);
      expect(persisted!.call.reviewKeys).toHaveLength(2);
      expect(new Set(persisted!.call.reviewKeys.map(row => row.alias)).size).toBe(1);
      const boundCall = persisted!.call;
      expect(boundCall.wirePromptSha256).toBe(createHash("sha256").update(actualReviewPrompt).digest("hex"));
      expect(boundCall.systemPromptSha256).toBe(createHash("sha256").update(actualReviewSystem).digest("hex"));
      expect(boundCall.durableRequestSha256).toBe(decisionRequestSha256({ prompt: actualReviewPrompt, system: actualReviewSystem,
        model: boundCall.model, maxTokens: boundCall.maxTokens, promptVersion: boundCall.promptVersion, thinking: boundCall.thinking,
        reasoningEffort: boundCall.reasoningEffort, effortPolicySha256: boundCall.effortPolicySha256,
        recommendationPolicyVersion: boundCall.recommendationPolicyVersion, implementationVersion: boundCall.implementationVersion }));
      expect(reviewed.reviewed.checks.map(row => row.supported)).toEqual([supported, supported]);
      expect(reviewed.reviewed.matchingRelationReview?.ballots).toEqual([
        matchingRelationReviewBallotFixture(boundCall.reviewKeys[0].alias, "合成传输判决，不能证明真实内容质量。", { conditions: supported }),
      ]);
      const visible = assembleReviewedGroupDetailsV7(context, plan, generated.prepared, reviewed.reviewed, run);
      expect(visible).toHaveLength(supported ? 1 : 0);
      if (supported) expect(visible[0].reasons[0].text).toBe(composed);
      expect(context).toEqual(originalContext);
    });
  });

  it("reads the old report with its original reason and no generated source prefix", () => {
    const { context } = fixture();
    const reason = claim("以前保存的竞赛学习建议。", "suggestion");
    const report = assembleDecisionReport(context, {
      profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, shortfallReason: "旧报告只有一项。",
      recommendations: [{ itemId: context.candidates[0].record.recordId, reasons: [reason] }],
    }, {}, undefined, { admissionPolicy: "matching", profilePolicy: "self_report" });
    const restored = decisionReportSchema.parse(JSON.parse(JSON.stringify(report)));
    expect(restored).toEqual(report);
    expect(restored.recommendations[0].reasons[0]).toEqual(reason);
    expect(validateDecisionReportV7(restored, context).ok).toBe(true);
  });
});
