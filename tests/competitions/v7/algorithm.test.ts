import { describe, expect, it, vi } from "vitest";
import type { AiJsonResult } from "@/lib/ai/ai-client";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { getMatchingCatalogRecords } from "@/lib/competitions/v7/catalog";
import { buildDecisionContextV7, explainDecisionV7, isLowRiskAuditSampleV7, rankDecisionV7, validateDecisionReportV7, validateMatchPlanV7 } from "@/lib/competitions/v7/model";
import { isDecisionEvidenceFact } from "@/lib/competitions/v6/evidence";
import { syntheticCatalog, syntheticRecord, student } from "../v6/decision-fixtures";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";

const success = (data: unknown): AiJsonResult<unknown> => ({ ok: true, data, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, attempts: 1, durationMs: 1, finishReason: "stop" });
const legacy = student({ confirmedFields: ["stage", "skills", "interests"], skills: ["data-analysis"], interests: ["data"] });
const context = () => buildDecisionContextV7(legacy, { records: structuredClone(syntheticCatalog), now: new Date("2026-11-09T00:00:00Z") });
const selected = (ctx: ReturnType<typeof context>) => ctx.candidates.slice(0, 5).sort((a, b) => a.record.recordId < b.record.recordId ? -1 : 1);
const ranking = (ctx: ReturnType<typeof context>) => ({ profileRevision: ctx.profile.revision, catalogVersion: ctx.catalogVersion,
  recommendations: selected(ctx).map(candidate => ({ itemId: candidate.record.recordId, roleIndex: 0, rationale: "用自报分析能力清理本项输入并核对处理记录。", ...rankFixtureEvidence(ctx, candidate.record.recordId) })), shortfallReason: "当前合成资料的其余方向与已选任务相同，没有更多有意义的差异。" });
const explained = (ctx: ReturnType<typeof context>, ranked?: MatchPlanV6): MatchPlanV6 => ({ profileRevision: ctx.profile.revision, catalogVersion: ctx.catalogVersion,
  recommendations: selected(ctx).map(candidate => {
    const reason = { text: candidate.record.facts[0].text, basis: "official" as const, studentFactIds: [], competitionFactIds: [candidate.record.facts[0].id], conditions: [] };
    const binding = ranked?.recommendations.find(item => item.itemId === candidate.record.recordId)?.rankRoleIndex;
    if (ranked && binding === undefined) throw new Error("fresh_rank_fixture_requires_explicit_role_binding");
    return { itemId: candidate.record.recordId, reasons: [reason],
      ...(binding === undefined ? {} : { roleIndex: binding, roleReason: structuredClone(reason) }) };
  }), shortfallReason: ranked ? ranked.shortfallReason : ranking(ctx).shortfallReason });

describe("v7 full-pool evidence ranking", () => {
  it("admits every supplied core record regardless of publication tier, qualification or registration", () => {
    const records = structuredClone(syntheticCatalog);
    records[0].contentTier = "L1"; records[0].publication.mode = "discovery_only";
    records[0].registration.status = "closed";
    const built = buildDecisionContextV7(legacy, { records });
    expect(built.candidates.map(candidate => candidate.record.recordId)).toEqual(records.map(record => record.recordId));
    expect(built.candidates.every(candidate => candidate.score === null && candidate.nativeScore === undefined)).toBe(true);
  });
  it("sends the entire pool in one governed low call and uses the stable order for positive evidence", async () => {
    const ctx = context(), calls: string[] = [];
    const plan = await rankDecisionV7(ctx, { requestId: "full-pool-test", modelCall: async (prompt, options) => {
      calls.push(options.diagnosticContext!.stage);
      const packet = expandMatchingTables(JSON.parse(prompt));
      expect(packet.candidates).toHaveLength(ctx.candidates.length);
      expect(packet.candidates.every((row: object) => !("registration" in row) && !("milestones" in row))).toBe(true);
      expect(options).toMatchObject({ model: "deepseek-flash", thinking: "enabled", reasoningEffort: "low", maxAttempts: 1, operation: "competition_v7_rank" });
      return success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, ranking(ctx))));
    } });
    expect(plan.recommendations.map(item => item.itemId)).toEqual(selected(ctx).map(candidate => candidate.record.recordId));
    expect(calls).toEqual(["v7.rank"]);
  });
  it("also includes the real matching pool without a hidden top-N shortlist", async () => {
    const records = getMatchingCatalogRecords();
    expect(records.length).toBeGreaterThan(10);
    const ctx = buildDecisionContextV7(legacy, { records });
    let sent = 0;
    await rankDecisionV7(ctx, { modelCall: async prompt => {
      sent = expandMatchingTables(JSON.parse(prompt)).candidates.length;
      return success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, ranking(ctx))));
    } });
    expect(sent).toBe(ctx.candidates.length);
  });
  it("selects and explains exactly the five model choices from the complete pool", async () => {
    const ctx = buildDecisionContextV7(legacy, { records: Array.from({ length: 12 }, (_, index) => syntheticRecord(index + 1)) });
    const items = ctx.candidates.slice(0, 5).sort((a, b) => a.record.recordId < b.record.recordId ? -1 : 1); let calls = 0;
    const plan = await rankDecisionV7(ctx, { modelCall: async prompt => { calls++; return success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, {
      recommendations: items.map(candidate => ({ itemId: candidate.record.recordId, roleIndex: 0, rationale: "可用数据分析能力核对处理前后的输入。", ...rankFixtureEvidence(ctx, candidate.record.recordId) })), shortfallReason: null }))); } });
    const report = await explainDecisionV7(ctx, plan, { modelCall: async () => { calls++; return success({ ...plan, recommendations: items.map(candidate => ({ itemId: candidate.record.recordId,
      reasons: [{ text: candidate.record.facts[0].text, basis: "official", studentFactIds: [], competitionFactIds: [candidate.record.facts[0].id], conditions: [] }], roleIndex: 0,
      roleReason: { text: candidate.record.facts[0].text, basis: "official", studentFactIds: [], competitionFactIds: [candidate.record.facts[0].id], conditions: [] } })) }); } });
    expect(report.recommendations).toHaveLength(5);
    expect(report.recommendations.map(item => item.itemId)).toEqual(items.map(candidate => candidate.record.recordId));
    expect(report.recommendations.slice(5)).toHaveLength(0); expect(calls).toBe(2);
  });
  it("rejects a foreign ID without another model call", async () => {
    const ctx = context(), calls: string[] = [];
    await expect(rankDecisionV7(ctx, { modelCall: async (prompt, options) => {
      calls.push(options.diagnosticContext?.reviewId ?? "initial");
      const output = echoRankWireHeaders(prompt, ranking(ctx)); output.recommendations[0].itemId = "outside-catalog";
      return success(rankFixtureAssessmentReply(ctx, output));
    } })).rejects.toThrow("invalid_output");
    expect(calls).toEqual(["effort-v1.initial"]);
  });
  it.each(["timeout", "network_error", "durable_outcome_unknown"] as const)("does not repay after an unknown %s outcome", async reason => {
    let count = 0;
    await expect(rankDecisionV7(context(), { modelCall: async () => { count++; return { ok: false, reason, model: "deepseek-flash", upstreamAttempted: true }; } })).rejects.toThrow(reason);
    expect(count).toBe(1);
  });
  it("passes the remaining original 60/150-second hard budget through every AI-client deadline layer", async () => {
    const ctx = context(), firstSubmittedAt = 1_799_999_000_000;
    let current = firstSubmittedAt;
    const now = vi.spyOn(Date, "now").mockImplementation(() => current);
    const budgets: { stage: string; remaining: number | undefined; timeout: number | undefined; deadline: number | undefined }[] = [];
    try {
      const plan = await rankDecisionV7(ctx, { deadlineEpochMs: firstSubmittedAt + 60_000 - 750, modelCall: async (prompt, options) => {
        budgets.push({ stage: options.diagnosticContext!.stage, remaining: options.requestDeadlineMs, timeout: options.timeoutMs, deadline: options.deadlineEpochMs });
        return success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, ranking(ctx))));
      } });
      current += 12_000;
      await explainDecisionV7(ctx, plan, { deadlineEpochMs: firstSubmittedAt + 150_000 - 750, modelCall: async (prompt, options) => {
        budgets.push({ stage: options.diagnosticContext!.stage, remaining: options.requestDeadlineMs, timeout: options.timeoutMs, deadline: options.deadlineEpochMs });
        if (options.operation === "competition_v7_review") return success({ checks: JSON.parse(prompt).assertions.map((row: { key: string }) => ({ key: row.key, supported: true, reason: "原文与自报支持" })) });
        const output = explained(ctx, plan);
        output.recommendations[0].reasons[0] = { ...output.recommendations[0].reasons[0], text: "你自报的数据分析能力与这项报告任务有联系。", basis: "inference", studentFactIds: [ctx.profile.facts.find(fact => fact.field === "skills")!.id] };
        current += 10_000;
        return success(output);
      } });
      expect(budgets).toEqual([
        { stage: "v7.rank", remaining: 59_250, timeout: 59_250, deadline: firstSubmittedAt + 59_250 },
        { stage: "v7.explain", remaining: 137_250, timeout: 137_250, deadline: firstSubmittedAt + 149_250 },
        { stage: "v7.review", remaining: 127_250, timeout: 127_250, deadline: firstSubmittedAt + 149_250 },
      ]);
    } finally { now.mockRestore(); }
  });
  it("rejects duplicate series, stale versions, fabricated sources and foreign student IDs", async () => {
    const ctx = context();
    const plan = await rankDecisionV7(ctx, { modelCall: async prompt => success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, ranking(ctx)))) });
    const duplicate = structuredClone(plan); duplicate.recommendations[1] = duplicate.recommendations[0];
    expect(validateMatchPlanV7(duplicate, ctx).issues.some(issue => issue.startsWith("duplicate_series"))).toBe(true);
    const stale = structuredClone(plan); stale.profileRevision = "old";
    expect(validateMatchPlanV7(stale, ctx).issues).toContain("stale_profile_revision");
    const foreign = structuredClone(plan); foreign.recommendations[0].reasons[0].studentFactIds = ["foreign-student"];
    expect(validateMatchPlanV7(foreign, ctx).ok).toBe(false);
  });
  it("rejects a personal fit inference that cites no task and an illegal confirmed conditional fact", () => {
    const ctx = context(), output = explained(ctx);
    output.recommendations[0].reasons[0] = { text: "你的能力适合这个任务。", basis: "inference", studentFactIds: [ctx.profile.facts.find(fact => fact.field === "skills")!.id], competitionFactIds: [], conditions: [] };
    expect(validateMatchPlanV7(output, ctx).issues).toContain(`match_inference_without_task_evidence:${output.recommendations[0].itemId}`);
    ctx.profile.facts[0] = { ...ctx.profile.facts[0], state: "conditional", confirmed: true };
    expect(validateMatchPlanV7(explained(ctx), ctx).issues.some(issue => issue.startsWith("invalid_confirmed_state:"))).toBe(true);
  });
});

describe("v7 batch grounded explanations", () => {
  it("can assemble every real core-admitted record without reviving the old publication gate", async () => {
    const ctx = buildDecisionContextV7(legacy);
    for (let offset = 0; offset < ctx.candidates.length; offset += 5) {
      const group = ctx.candidates.slice(offset, offset + 5);
      const plan = { profileRevision: ctx.profile.revision, catalogVersion: ctx.catalogVersion,
        recommendations: group.map(candidate => {
          const fact = candidate.record.facts.find(fact => ["task", "track", "deliverables"].includes(fact.field) && isDecisionEvidenceFact(candidate.record, fact));
          if (!fact) throw new Error(`no_usable_core_fact:${candidate.record.recordId}`);
          return { itemId: candidate.record.recordId, reasons: [{ text: fact.text, basis: "official" as const, studentFactIds: [], competitionFactIds: [fact.id], conditions: [] }] };
        }), shortfallReason: "本次离线合成分组有意义候选不足五项。" };
      const report = await explainDecisionV7(ctx, plan, { modelCall: async () => success(plan) });
      expect(report.recommendations.map(item => item.itemId)).toEqual(group.map(candidate => candidate.record.recordId));
    }
  });
  it("reuses already checked catalog facts in a single explanation call and retains ranking", async () => {
    const ctx = context();
    const plan = await rankDecisionV7(ctx, { modelCall: async prompt => success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, ranking(ctx)))) });
    const stages: string[] = [];
    const report = await explainDecisionV7(ctx, plan, { modelCall: async (_prompt, options) => { stages.push(options.diagnosticContext!.stage); return success(explained(ctx, plan)); } });
    expect(stages).toEqual(["v7.explain"]);
    expect(report.recommendations.map(item => item.itemId)).toEqual(plan.recommendations.map(item => item.itemId));
    expect(report.fallback.used).toBe(false);
    expect(validateDecisionReportV7(report, ctx).ok).toBe(true);
    const forged = structuredClone(report); forged.recommendations[0].sources[0].url = "https://example.org/forged";
    expect(validateDecisionReportV7(forged, ctx).ok).toBe(false);
  });
  it("reviews new critical personal claims in one batch rather than one call per item", async () => {
    const ctx = context(), ability = ctx.profile.facts.find(fact => fact.field === "skills")!;
    const plan = await rankDecisionV7(ctx, { modelCall: async prompt => success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, ranking(ctx)))) });
    const stages: string[] = [];
    const report = await explainDecisionV7(ctx, plan, { modelCall: async (prompt, options) => {
      stages.push(options.diagnosticContext!.stage);
      if (options.operation === "competition_v7_review") {
        const assertions = JSON.parse(prompt).assertions;
        expect(assertions).toHaveLength(5);
        return success({ checks: assertions.map((row: { key: string }) => ({ key: row.key, supported: true, reason: "任务及自述支持" })) });
      }
      const output = explained(ctx, plan);
      output.recommendations.forEach(item => { item.reasons[0] = { ...item.reasons[0], text: "你自报的数据分析能力可用于这项数据报告任务。", basis: "inference", studentFactIds: [ability.id] }; });
      return success(output);
    } });
    expect(stages).toEqual(["v7.explain", "v7.review"]);
    expect(report.trace.supportChecks).toBe(5);
  });
  it("reviews a rule even when it is mislabeled as an uncited suggestion", async () => {
    const ctx = context(), plan = explained(ctx), stages: string[] = [];
    await expect(explainDecisionV7(ctx, plan, { modelCall: async (prompt, options) => {
      stages.push(options.diagnosticContext!.stage);
      if (options.operation === "competition_v7_review") {
        const assertions = JSON.parse(prompt).assertions;
        expect(assertions).toHaveLength(1);
        expect(assertions[0].reason.text).toBe("该赛事要求提交纸质材料。");
        return success({ checks: [{ key: assertions[0].key, supported: false, reason: "引用资料没有纸质材料要求" }] });
      }
      const output = explained(ctx);
      output.recommendations[0].reasons = [{ text: "该赛事要求提交纸质材料。", basis: "suggestion", studentFactIds: [], competitionFactIds: [], conditions: [] }];
      return success(output);
    } })).rejects.toThrow("unsupported_reason");
    expect(stages).toEqual(["v7.explain", "v7.review"]);
  });
  it("rejects forged audit coverage and comparison row identities", async () => {
    const ctx = context(), report = await explainDecisionV7(ctx, explained(ctx), { modelCall: async () => success(explained(ctx)) });
    const duplicate = structuredClone(report); duplicate.candidateAudit[1] = duplicate.candidateAudit[0];
    expect(validateDecisionReportV7(duplicate, ctx).issues).toContain("incomplete_candidate_audit");
    const wrongRow = structuredClone(report); wrongRow.comparisons[0].dimensions[0].values[0].itemId = "outside-catalog";
    expect(validateDecisionReportV7(wrongRow, ctx).issues).toContain("comparison_wrong_or_duplicate_value");
  });
  it("repairs a verbose explanation once before dispatching the bounded support batch", async () => {
    const ctx = context(), plan = explained(ctx); let count = 0;
    const report = await explainDecisionV7(ctx, plan, { modelCall: async () => {
      const output = explained(ctx); count++;
      if (count === 1) output.recommendations[0].reasons = Array.from({ length: 4 }, () => output.recommendations[0].reasons[0]);
      return success(output);
    } });
    expect(count).toBe(2); expect(report.recommendations).toHaveLength(5);
  });
  it("never allows explanation generation to reorder the C ranking", async () => {
    const ctx = context();
    const plan = await rankDecisionV7(ctx, { modelCall: async prompt => success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(prompt, ranking(ctx)))) });
    let count = 0;
    await expect(explainDecisionV7(ctx, plan, { modelCall: async () => { count++; const output = explained(ctx, plan); output.recommendations.reverse(); return success(output); } })).rejects.toThrow("invalid_output");
    expect(count).toBe(2);
  });
  it("keeps the pool and carries an explicit refusal as a task advisory", () => {
    const records = [syntheticRecord(1), { ...syntheticRecord(2), taskFamily: "software-algorithms" as const }];
    const profile = student({ decisionContext: { excludedTaskFormats: ["modeling"] } });
    const ctx = buildDecisionContextV7(profile, { records });
    expect(ctx.candidates.map(candidate => candidate.record.recordId)).toEqual(records.map(record => record.recordId).sort());
    expect(ctx.excluded.has(records[0].recordId)).toBe(false);
    expect(ctx.candidates.find(candidate => candidate.record.recordId === records[0].recordId)?.conditions).toEqual(expect.arrayContaining([expect.stringMatching(/^任务边界：/)]));
    expect(ctx.candidates.find(candidate => candidate.record.recordId === records[1].recordId)?.conditions).not.toEqual(expect.arrayContaining([expect.stringMatching(/^任务边界：/)]));
  });
  it("does not expand a refusal of product planning into a refusal of software or design", () => {
    const records = [syntheticRecord(1), { ...syntheticRecord(2), taskFamily: "software-algorithms" as const }, { ...syntheticRecord(3), taskFamily: "visual-interaction" as const }];
    const ctx = buildDecisionContextV7(student({ decisionContext: { excludedTaskFormats: ["product"] }, skills: ["programming"], confirmedFields: ["stage", "skills"] }), { records });
    expect(ctx.candidates).toHaveLength(3); expect(ctx.excluded.size).toBe(0);
  });
  it("emits a complete reproducible offline sample rather than a dangling claim key", async () => {
    const ctx = context(), plan = explained(ctx), itemId = plan.recommendations[0].itemId;
    let reason = { text: "可以先制作一页观察札记。", basis: "suggestion" as const, studentFactIds: [], competitionFactIds: [], conditions: [] };
    for (let index = 0; index < 100; index++) {
      reason = { ...reason, text: `可以先制作一页观察札记${index}。` };
      if (isLowRiskAuditSampleV7(JSON.stringify([ctx.catalogVersion, ctx.profile.revision, { key: `${itemId}.reason.0`, itemId, reason }]))) break;
    }
    plan.recommendations[0].reasons = [reason];
    const observations: unknown[] = [];
    await explainDecisionV7(ctx, explained(ctx), { modelCall: async () => success(plan), onObservation: async event => { if (event.stage === "v7.audit") observations.push(event.data); } });
    expect(observations).toEqual([expect.objectContaining({ catalogVersion: ctx.catalogVersion, profileRevision: ctx.profile.revision,
      sampling: expect.objectContaining({ algorithm: "sha256-uint32be-mod5-zero", seed: [ctx.catalogVersion, ctx.profile.revision] }),
      offlineSamples: [expect.objectContaining({ itemId, reason, sampleDigest: expect.stringMatching(/^[a-f0-9]{64}$/) })] })]);
  });
});
