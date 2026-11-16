import { describe, expect, it } from "vitest";
import type { AiJsonResult } from "@/lib/ai/ai-client";
import type { MatchPlanV6, StudentProfileV6 } from "@/lib/competitions/v6/contracts";
import type { DecisionContextV6 } from "@/lib/competitions/v6/engine";
import { isDecisionEvidenceFact } from "@/lib/competitions/v6/evidence";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { getMatchingCatalogRecords } from "@/lib/competitions/v7/catalog";
import { buildDecisionContextV7, explainDecisionV7, rankDecisionV7, validateDecisionReportV7 } from "@/lib/competitions/v7/model";
import { expandRankEvidenceV7, rankingCandidatesV7, compactRankingCandidatesV7, readableRankInputV7, rankTaskFactsV7, rankTaskFactsV754 } from "@/lib/competitions/v7/rank-packet";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";

const legacy = student({ skills: ["data-analysis"], interests: ["data"], confirmedFields: ["stage", "skills", "interests"] });
const context = () => buildDecisionContextV7(legacy, { records: Array.from({ length: 6 }, (_, index) => syntheticRecord(index + 1)) });
const success = (data: unknown): AiJsonResult<unknown> => ({ ok: true, data, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, attempts: 1, durationMs: 1, finishReason: "stop" });
const rankOutput = (ctx: DecisionContextV6) => ({ profileRevision: ctx.profile.revision, catalogVersion: ctx.catalogVersion,
  recommendations: ctx.candidates.slice(0, 5).reverse().map(({ record }) => ({ itemId: record.recordId, roleIndex: 0, rationale: "将所学数据分析用于清理输入并记录数据修改。", ...rankFixtureEvidence(ctx, record.recordId) })),
  shortfallReason: ctx.candidates.length < 5 ? "合成资料没有五个不同的任务方向。" : null });

function decodePacket(prompt: string, ctx: DecisionContextV6) {
  const codec = createModelIdentifierCodec({ candidates: ctx.candidates.map(({ record }) => record.recordId), series: ctx.candidates.map(({ record }) => record.seriesId),
    facts: ctx.candidates.flatMap(({ record }) => record.facts.map(fact => fact.id)), students: ctx.profile.facts.map(fact => fact.id) });
  return codec.decode(expandCandidateEvidence(expandMatchingTables(JSON.parse(prompt))));
}

function unpack(prompt: string, ctx: DecisionContextV6) {
  return decodePacket(prompt, ctx) as ReturnType<typeof readableRankInputV7> & { profile: StudentProfileV6 };
}

async function capture(ctx: DecisionContextV6) {
  let prompt = "";
  const plan = await rankDecisionV7(ctx, { modelCall: async (input, options) => {
    prompt = input;
    expect(options).toMatchObject({ model: "deepseek-flash", thinking: "enabled", reasoningEffort: "low", maxAttempts: 1, maxTokens: 8192 });
    return success(rankFixtureAssessmentReply(ctx, echoRankWireHeaders(input, rankOutput(ctx))));
  } });
  return { prompt, plan };
}

function officialPlan(ctx: DecisionContextV6, plan: MatchPlanV6): MatchPlanV6 {
  return { ...plan, recommendations: plan.recommendations.map(item => {
    const record = ctx.candidates.find(candidate => candidate.record.recordId === item.itemId)!.record;
    const fact = record.facts.find(fact => isDecisionEvidenceFact(record, fact))!;
    const reason = { text: fact.text, basis: "official" as const, studentFactIds: [], competitionFactIds: [fact.id], conditions: [] };
    if (item.rankRoleIndex === undefined) throw new Error("fresh_rank_fixture_requires_explicit_role_binding");
    return { itemId: item.itemId, reasons: [reason], roleIndex: item.rankRoleIndex, roleReason: structuredClone(reason) };
  }) };
}

describe("v7 minimal ranking packet", () => {
  it("accepts an authoritative typed profile without inventing a legacy stage", () => {
    const profile = structuredClone(context().profile);
    profile.facts = profile.facts.filter(fact => fact.field !== "stage");
    const ctx = buildDecisionContextV7(undefined, { profile, records: [syntheticRecord(1)] });
    expect(ctx.profile).toBe(profile);
    expect(ctx.profile.facts.some(fact => fact.field === "stage")).toBe(false);
    expect(ctx.originalProfile).toBeUndefined();
    expect(() => buildDecisionContextV7(undefined)).toThrow("profile_input_required");
  });

  it("keeps the complete real pool and exact task/track/output text in plain rank input", async () => {
    const ctx = buildDecisionContextV7(legacy, { records: getMatchingCatalogRecords() });
    const { prompt, plan } = await capture(ctx), packet = unpack(prompt, ctx);
    expect(ctx.candidates).toHaveLength(45);
    const canonical = { ...ctx, candidates: [...ctx.candidates].sort((a, b) => a.record.recordId < b.record.recordId ? -1 : 1) };
    const { candidateDefaults, candidateConditions, items } = packet.candidateBoundaries;
    expect(items.map(row => row.itemId)).toEqual(packet.candidates.map(row => row.itemId));
    const combined = packet.candidates.map((card, index) => {
      const boundary = items[index], unknowns = boundary.unknowns ?? candidateDefaults?.unknowns;
      if (!unknowns) throw new Error("missing_candidate_unknowns");
      return { supportingTaskFacts: [], personalCost: null, participationRequirements: null, participationBounds: [],
        officialClaimBoundaries: [], ...card, ...boundary, unknowns,
        resources: boundary.resources.map(resource => ({ conditions: [], ...resource })) };
    });
    expect(combined).toEqual(compactRankingCandidatesV7(canonical));
    expect(candidateConditions).toEqual(readableRankInputV7(canonical).candidateBoundaries.candidateConditions);
    expect(packet.candidates[0]).not.toHaveProperty("sourceBoundary");
    expect(packet.candidates.map(row => row.itemId)).toEqual(canonical.candidates.map(({ record }) => record.recordId));
    expect(plan.recommendations.map(item => item.itemId)).toEqual(rankOutput(ctx).recommendations.map(item => item.itemId).sort());
    for (const [index, { record }] of canonical.candidates.entries()) {
      const card = combined[index];
      expect(card.task.text).toBe(record.deepDive!.representativeTask);
      const texts = card.officialTask.flatMap(group => group.text);
      for (const fact of record.facts.filter(fact => isDecisionEvidenceFact(record, fact) && ["task", "track"].includes(fact.field))) expect(texts).toContain(`${fact.field}: ${fact.text}`);
      const anchors = card.officialTask.flatMap(group => group.factIds.flatMap((id, i) => id === null ? [] : [{ id, text: group.text[i], scope: group.scope }]));
      expect(anchors.length).toBeGreaterThan(0);
      for (const anchor of anchors) {
        const fact = record.facts.find(value => value.id === anchor.id)!;
        expect(isDecisionEvidenceFact(record, fact)).toBe(true);
        expect(anchor.text).toBe(`${fact.field}: ${fact.text}`);
        expect(anchor.scope).toBe(fact.scope);
      }
      expect(card.sourceBoundary).toBe(record.deepDive?.workedExample.sourceBoundary ?? null);
      for (const section of record.sections.investment) expect(card.resources.some(value => value.text === section.text) || card.unknowns.some(value => value.text === section.text)).toBe(true);
      expect(packet.candidates[index].scope).toBe(record.scope);
      expect(packet.candidates[index].contributions).toHaveLength(record.roles.length);
      expect(card.contributions).toMatchObject(record.roles.map((role, roleIndex) => ({
        roleIndex, name: role.name, task: role.task, personalDeliverable: role.personalDeliverable, prerequisite: role.prerequisite,
      })));
    }
  });

  it("preserves known team/resource bounds with their original scope and status", () => {
    const record = syntheticRecord(1), source = record.facts[0];
    record.facts.push({ ...source, id: "known-team", field: "eligibility", text: "每队需要两名成员及一名指导者。", status: "historical", scope: source.scope });
    record.eligibilityRules = [{ id: "team", field: "teamSize", operator: "eq", value: 2, note: "正式任务需两人协作。", factIds: ["known-team"] }];
    const row = rankingCandidatesV7(buildDecisionContextV7(legacy, { records: [record] }))[0];
    expect(row.participationBounds).toEqual([{ field: "teamSize", operator: "eq", value: 2, note: "正式任务需两人协作。",
      evidence: [{ id: "known-team", kind: "official_fact", status: "historical", scope: source.scope, usable: true }], verified: true }]);
    expect(expandRankEvidenceV7(row.taskEvidence).some(fact => fact.id === "known-team")).toBe(false);
  });

  it("keeps score weights and packaging as context and only offers actionable evidence IDs", () => {
    const record = syntheticRecord(1), source = record.facts[0];
    const score = { ...source, id: "score-weights", field: "rubric", text: "测试算法20分、报告展示10分。" };
    const check = { ...source, id: "measured-check", field: "rubric", text: "测量误差不得超过2毫米，记录偏差再核验输出。" };
    const packaging = { ...source, id: "packaging-only", field: "deliverables", text: "提交PDF报告及三份匿名纸本，另附报名材料。" };
    const data = { ...source, id: "task-output", field: "deliverables", text: "按标准输入读入传感器数据，输出两行校验结果。" };
    const eligibility = { ...source, id: "school-eligibility", field: "eligibility", text: "仅本校成员可报名。" };
    record.facts.push(score, check, packaging, data, eligibility);
    expect(rankTaskFactsV7(record).map(fact => fact.id)).toEqual([source.id, data.id, check.id]);
    expect(rankTaskFactsV754(record).map(fact => fact.id)).toContain(score.id);
    const [card] = compactRankingCandidatesV7(buildDecisionContextV7(legacy, { records: [record] }));
    expect(card.supportingTaskFacts.map(fact => fact.id)).toEqual([check.id]);
    expect(card.officialClaimBoundaries).toContainEqual({
      module: "rubric", text: score.text, conditions: [], scope: score.scope, status: score.status,
    });
    const outputGroup = card.officialTask.find(group => group.text.includes("deliverables: " + packaging.text))!;
    expect(outputGroup.factIds[outputGroup.text.indexOf("deliverables: " + packaging.text)]).toBeNull();
    expect(outputGroup.factIds[outputGroup.text.indexOf("deliverables: " + data.text)]).toBe(data.id);
  });

  it("keeps exact technical actions from mixed catalog deliverables and rubrics", () => {
    const records = getMatchingCatalogRecords();
    const context = buildDecisionContextV7(legacy, { records });
    const cards = new Map(compactRankingCandidatesV7(context).map(card => [card.itemId, card]));
    const examples = [
      ["icpc-programming", "deliverables", "输入网格与移动记录", "最少改变次数"],
      ["embedded-chip-system-design", "rubric", "数量乘实际输出采样率", "频谱与RTL互证"],
      ["atcoder-beginner-contest", "rubric", "2秒1024MiB", "425分"],
      ["aiaa-design-build-fly", "deliverables", "实机须与报告构型相符", "设计报告最多60页"],
      ["market-research-analysis", "deliverables", "任务必须含网络定量调查", "报告正文至多2万字"],
    ] as const;
    for (const [series, field, action, contextText] of examples) {
      const record = records.find(value => value.recordId.startsWith(`${series}:`))!;
      const original = record.facts.find(fact => fact.field === field && fact.text.includes(action))!;
      expect(original.text).toContain(contextText);
      expect(rankTaskFactsV7(record)).toContainEqual(original);
      const card = cards.get(record.recordId)!;
      if (field === "rubric") {
        expect(card.supportingTaskFacts).toContainEqual(expect.objectContaining({ id: original.id, text: original.text, scope: original.scope }));
      } else {
        const group = card.officialTask.find(row => row.factIds.includes(original.id))!;
        expect(group.scope).toBe(original.scope);
        expect(group.text[group.factIds.indexOf(original.id)]).toBe(`${field}: ${original.text}`);
      }
    }
    const weightedOnly = records.find(value => value.recordId.startsWith("loreal-brandstorm:"))!;
    const rubric = rankTaskFactsV754(weightedOnly).find(fact => fact.field === "rubric")!;
    expect(rankTaskFactsV7(weightedOnly)).not.toContainEqual(rubric);
    expect(cards.get(weightedOnly.recordId)?.officialClaimBoundaries).toContainEqual(expect.objectContaining({ text: rubric.text, scope: rubric.scope }));
  });

  it("retains a production or documentation requirement when an original role works on its exact object", () => {
    const examples = [
      ["dandad-new-blood", "五幅静态作品"],
      ["biomod", "项目网站记录目标、数据和结果"],
      ["igem-collegiate", "建模内容须在指定model页面清楚说明"],
    ] as const;
    const records = getMatchingCatalogRecords();
    const context = buildDecisionContextV7(legacy, { records });
    const cards = new Map(compactRankingCandidatesV7(context).map(card => [card.itemId, card]));
    for (const [series, requiredAction] of examples) {
      const record = records.find(value => value.recordId.startsWith(`${series}:`))!;
      const fact = record.facts.find(value => value.field === "deliverables" && value.text.includes(requiredAction))!;
      expect(rankTaskFactsV7(record)).toContainEqual(fact);
      const group = cards.get(record.recordId)?.officialTask.find(row => row.factIds.includes(fact.id));
      expect(group?.scope).toBe(fact.scope);
      expect(group?.text).toContain(`deliverables: ${fact.text}`);
      const unrelated = { ...record, roles: record.roles.map(role => ({ ...role, task: "整理报名材料和文件格式" })) };
      expect(rankTaskFactsV7(unrelated)).not.toContainEqual(fact);
      expect(rankTaskFactsV754(unrelated)).toContainEqual(fact);
    }
  });

  it("keeps mixed date/resource unknowns and every student state verbatim", async () => {
    const record = syntheticRecord(1);
    const uncertainty = "历史日期另核；实验设备与个人总支出仍然未知。";
    record.suitability.uncertainties = [uncertainty];
    record.facts.push({ ...record.facts[0], id: "unknown-skill", field: "skills", kind: "unknown", status: "unknown", text: "所需技能尚无适用原文。", scope: "单独的未知技能范围", sourceIds: [] });
    record.sections.skills = [{ text: "所需技能尚无适用原文。", kind: "unknown", factIds: ["unknown-skill"], conditions: ["不得当作无需技能"], unknownReason: "该赛道没有可核实的先修说明。" }];
    const ctx = buildDecisionContextV7(legacy, { records: [record, syntheticRecord(2)] });
    const base = ctx.profile.facts.find(fact => fact.field === "skills")!;
    ctx.profile.facts.push(...(["unknown", "conditional", "retracted", "negated"] as const).map(state => ({ ...base, id: `state-${state}`, state,
      confirmed: state === "negated", originalText: `原话保留：${state}` })));
    ctx.profile.retractedFactIds.push("state-retracted");
    const { prompt } = await capture(ctx), packet = unpack(prompt, ctx);
    expect(packet.profile).toEqual({ ...ctx.profile, revision: JSON.parse(prompt).outputFormat.profileRevision });
    const { candidateDefaults, candidateConditions, items } = packet.candidateBoundaries;
    expect(candidateDefaults).toBeUndefined();
    expect(candidateConditions).toContainEqual({ text: uncertainty, itemIds: [record.recordId] });
    const own = items.find(row => row.itemId === record.recordId);
    expect(own?.unknowns).toContainEqual({ modules: ["skills"], text: "所需技能尚无适用原文。", reason: "该赛道没有可核实的先修说明。", conditions: ["不得当作无需技能"] });
    expect(JSON.stringify(items.filter(row => row.itemId !== record.recordId))).not.toContain("所需技能尚无适用原文");
  });

  it("retains every role capability instead of selecting a single learnable role", () => {
    const record = syntheticRecord(1);
    record.roles.push({ ...record.roles[0], name: "控制系统设计", task: "设计并验证实时闭环控制器", skills: ["programming", "research"], prerequisite: "required",
      personalDeliverable: "编辑建议的个人准备产物", evidenceToAsk: "不能把这个举证问题发给用户" });
    const rows = rankingCandidatesV7(buildDecisionContextV7(legacy, { records: [record] }));
    expect(rows[0].editorialRoleCapabilities).toEqual(record.roles.map(({ name, task, skills, prerequisite, factIds }) => ({ name, task, skills, prerequisite, factIds })));
    expect(JSON.stringify(rows)).not.toContain("编辑建议的个人准备产物");
    expect(JSON.stringify(rows)).not.toContain("举证问题");
  });

  it("does not read B scores, native scores, profile preferences or date ordering", () => {
    const ctx = context(), expected = rankingCandidatesV7(ctx), poisoned = structuredClone(ctx);
    poisoned.candidates.forEach((candidate, index) => {
      candidate.nativeScore = { lower: 1_000_000 - index, upper: 1_000_001 - index, dimensions: [] };
      Reflect.set(candidate, "score", { score: 1_000_000 - index, rank: index });
      candidate.eligibility = "eligible";
    });
    poisoned.profile.goals.reverse(); poisoned.profile.primaryGoal = null;
    expect(rankingCandidatesV7(poisoned)).toEqual(expected);
    for (const row of expected) expect(row).not.toHaveProperty("score");
    expect(JSON.stringify(expected)).not.toMatch(/nativeScore|registration|milestones|reviewedRole|difficulty/);
  });

  it("keeps catalog rows stable across profiles while binding the echoed headers to each request", async () => {
    const first = context(), second = structuredClone(first);
    second.profile.revision = "independent-profile-revision";
    const a = (await capture(first)).prompt, b = (await capture(second)).prompt;
    const left = JSON.parse(a), right = JSON.parse(b);
    const keys = Object.keys(left);
    for (const field of ["profileRevision", "studentBasisOptions", "studentGoalOptions", "profile", "candidateIds"]) {
      expect(keys.indexOf(field)).toBeGreaterThanOrEqual(0);
      expect(keys.indexOf(field)).toBeLessThan(keys.indexOf("candidates"));
    }
    expect(keys.indexOf("candidateBoundaries")).toBeGreaterThan(keys.indexOf("candidates"));
    expect(JSON.stringify(left.candidates)).toBe(JSON.stringify(right.candidates));
    expect(JSON.stringify(left.candidateBoundaries)).toBe(JSON.stringify(right.candidateBoundaries));
    expect(left.rankVersionBindingSha256).not.toBe(right.rankVersionBindingSha256);
    for (const wire of [left, right]) {
      expect(wire.profile.revision).toBe(wire.outputFormat.profileRevision);
      expect(wire.catalogVersion).toBe(wire.outputFormat.catalogVersion);
    }
  });

  it("retains supported input IDs and a short internal rationale in stable ID order", async () => {
    const ctx = context(), { plan } = await capture(ctx);
    expect(plan.recommendations.map(item => item.itemId)).toEqual(rankOutput(ctx).recommendations.map(item => item.itemId).sort());
    expect(plan.recommendations.map(item => item.rankRoleIndex)).toEqual(rankOutput(ctx).recommendations.map(item => item.roleIndex));
    expect(plan.recommendations.every(item => item.reasons.length === 1 && item.reasons[0].basis === "inference" && item.reasons[0].studentFactIds.length === 1 && item.reasons[0].competitionFactIds.length === 1)).toBe(true);
  });

  it.each(["candidate", "revision", "rationale"])("still rejects an invalid %s instead of replacing C's output", async field => {
    const ctx = context(); let calls = 0;
    await expect(rankDecisionV7(ctx, { modelCall: async prompt => {
      calls++;
      const output = echoRankWireHeaders(prompt, rankOutput(ctx));
      if (field === "candidate") output.recommendations[0].itemId = "outside-the-pool";
      if (field === "revision") output.profileRevision = "old-profile";
      if (field === "rationale") output.recommendations[0].rationale = "字".repeat(161);
      return success(rankFixtureAssessmentReply(ctx, output));
    } })).rejects.toThrow("invalid_output");
    expect(calls).toBe(field === "rationale" ? 2 : 1);
  });
});

describe("v7 shortened rank output keeps final grounding", () => {
  it("keeps deferred roles, difficulty, original facts and sources in the final explanation", async () => {
    const ctx = context(), { plan } = await capture(ctx);
    let sent = false;
    const report = await explainDecisionV7(ctx, plan, { modelCall: async (prompt, options) => {
      expect(options.operation).toBe("competition_v7_explain");
      const packet = decodePacket(prompt, ctx) as { candidates: { itemId: string; roles: unknown; difficulty: unknown; facts: unknown; sources: unknown }[] };
      for (const row of packet.candidates) {
        const record = ctx.candidates.find(candidate => candidate.record.recordId === row.itemId)!.record;
        expect(row.roles).toEqual(record.roles.map((role, roleIndex) => ({ roleIndex, ...role, kind: "editorial_inference",
          use: "optional_editorial_advice_not_official_requirement", factIdsArePremisesOnly: true })));
        expect(row.difficulty).toEqual(record.difficulty);
        expect(row.facts).toEqual(record.facts.filter(fact => isDecisionEvidenceFact(record, fact)));
        expect(row.sources).toEqual(record.sources.map(({ evidenceArtifact: _artifact, verificationMethod: _method, retrievedAt: _retrieved, ...source }) => source));
      }
      sent = true;
      return success(officialPlan(ctx, plan));
    } });
    expect(sent).toBe(true);
    expect(validateDecisionReportV7(report, ctx).ok).toBe(true);
    expect(report.recommendations.map(item => item.itemId)).toEqual(plan.recommendations.map(item => item.itemId));
  });

  it("still rejects a final official reason without a fact reference", async () => {
    const ctx = context(), { plan } = await capture(ctx); let calls = 0;
    await expect(explainDecisionV7(ctx, plan, { modelCall: async () => {
      calls++; const output = officialPlan(ctx, plan);
      output.recommendations[0].reasons[0].competitionFactIds = [];
      return success(rankFixtureAssessmentReply(ctx, output));
    } })).rejects.toThrow("invalid_output");
    expect(calls).toBe(2);
  });

  it("reviews and rejects an invented ability even if the internal rationale suggested it", async () => {
    const ctx = context(), { plan } = await capture(ctx);
    const ability = ctx.profile.facts.find(fact => fact.field === "skills")!;
    plan.recommendations[0].reasons[0].text = "你已熟练掌握电路焊接。";
    const stages: string[] = [];
    await expect(explainDecisionV7(ctx, plan, { modelCall: async (prompt, options) => {
      stages.push(options.operation!);
      if (options.operation === "competition_v7_review") {
        const assertion = JSON.parse(prompt).assertions[0];
        expect(assertion.reason.text).toBe("你已熟练掌握电路焊接。");
        return success({ checks: [{ key: assertion.key, supported: false, reason: "学生只自报数据分析，没有电路焊接能力原话。" }] });
      }
      const output = officialPlan(ctx, plan);
      output.recommendations[0].reasons[0] = { ...output.recommendations[0].reasons[0], text: "你已熟练掌握电路焊接。", basis: "inference", studentFactIds: [ability.id] };
      return success(output);
    } })).rejects.toThrow("unsupported_reason");
    expect(stages).toEqual(["competition_v7_explain", "competition_v7_review"]);
  });
});
