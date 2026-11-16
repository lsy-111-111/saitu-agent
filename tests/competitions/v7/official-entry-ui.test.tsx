import * as React from "react";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SavedCompetitionsClient } from "@/components/competitions/SavedCompetitionsClient";
import { CompactDecisionDetails } from "@/components/competitions/recommend/CompactDecisionDetails";
import { DecisionDetails, DecisionOverview } from "@/components/competitions/recommend/DecisionReport";
import { DecisionRunChat } from "@/components/competitions/recommend/DecisionRunChat";
import { DecisionRunReport } from "@/components/competitions/recommend/DecisionRunReport";
import { mergeRecommendationRun } from "@/components/competitions/recommend/useRecommendationRunV7";
import { DEFAULT_EFFORT_POLICY, effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import { compareDecisionItems, decisionReportSchema, type DecisionClaimV6, type MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import {
  readSavedDecisions,
  saveSelectedDecisions,
  saveSelectedRunDecisions,
  SAVED_DECISIONS_KEY,
  SAVED_DECISION_OFFICIAL_ENTRY_POLICY,
  type SavedDecision,
} from "@/lib/competitions/v6/saved-decisions";
import { recommendationRunSchema, type RecommendationChatReplyV7, type RecommendationRunV7 } from "@/lib/competitions/v7/contracts";
import { getMatchingCatalogRecords } from "@/lib/competitions/v7/catalog";
import { assembleReviewedGroupDetailsV7, assembleReviewedGroupsReportV7, createExplanationGroupSpecsV7, generateGroupExplanationV7, groupCallKeyV7, reviewPreparedGroupV7 } from "@/lib/competitions/v7/explanation-groups";
import { buildDecisionContextV7, matchExplanationInputV7, validateMatchPlanV7, type DecisionModelCallV7 } from "@/lib/competitions/v7/model";
import { displayedRecommendationAdvisoriesV7 } from "@/lib/competitions/v7/recommendation-notes";
import { completedRunFixture, recommendationRunFixture } from "../../fixtures/recommendation-run-v7";

// SSR cannot run effects or user events. Seed only the component's existing state
// to inspect a delivered comparison, chat transcript, or reloaded saved collection.
const renderState = vi.hoisted(() => ({ values: null as unknown[] | null, index: 0 }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const [value, setValue] = actual.useState(initial);
      const index = renderState.index++;
      return [renderState.values && index < renderState.values.length ? renderState.values[index] : value, setValue];
    },
  };
});

const HISTORICAL_URLS = ["https://history.example.org/2024/rules.pdf", "https://history.example.org/2025/notice"];
const SOURCE_FACT = "过去任务中整理图表并说明方法";
const CONDITION = "先完成一次练习，再评估持续投入";
const REASON = "仅在展开后阅读的专属匹配理由";

function evidenceRun(): RecommendationRunV7 {
  const run = completedRunFixture();
  const claim = (text: string): DecisionClaimV6 => ({
    text, basis: "inference", studentFactIds: [run.profile.facts[1].id],
    competitionFactIds: ["historical-task"], conditions: [CONDITION],
  });
  const items = run.items.map(item => item.detail ? {
    ...item,
    detail: {
      ...item.detail,
      coreTask: claim("整理资料并解释图表"), reasons: [claim(REASON)],
      currentRole: claim("从你自报的数据技能开始"),
      gaps: Array.from({ length: 4 }, (_, index) => claim(`准备事项${index + 1}`)),
      values: [{ dimension: "skill", claim: claim("完成可展示的实践") }],
      difficulty: item.detail.difficulty.map(difficulty => ({ ...difficulty, claim: claim("逐步尝试") })),
      opportunityCost: claim("每周保留练习时间"), nextStep: claim("先整理一页资料"),
      sources: HISTORICAL_URLS.map((url, index) => ({ id: `historical-source-${index}`, title: `历史任务来源${index}`, url, scope: "往届任务参考", checkedAt: "2026-11-09" })),
      evidenceFacts: [{ id: "historical-task", text: SOURCE_FACT, sourceIds: ["historical-source-0", "historical-source-1"], scope: "2024与2025任务", status: "reviewed", kind: "task" }],
    },
  } : item);
  const recommendations = items.flatMap(item => item.detail ? [item.detail] : []);
  const report = decisionReportSchema.parse({
    schemaVersion: "saitu.report.v6", reportId: "official-entry-test", generatedAt: "2026-11-09", catalogVersion: run.catalogVersion,
    profile: run.profile,
    summary: { direction: claim("整体建议"), personalEvidence: [claim("个人依据")], mainGap: claim("需要补充的条件"), nextStep: claim("整体第一步"), focusItemIds: recommendations.map(item => item.itemId) },
    recommendations, shortlistShortfallReason: null, comparisons: [], candidateAudit: [], pendingQuestions: [],
    goalPaths: [{ goal: "完成一个作品", condition: "愿意投入练习时间", itemIds: [recommendations[0].itemId], nextStep: claim("目标路径第一步") }],
    schoolPolicyReminder: "学校认定请向本校核实", fallback: { used: false, reason: null },
    trace: { engineVersion: "test", method: "rules", model: "none", promptVersion: "test", candidateCount: recommendations.length, callCount: 0, elapsedMs: 0, verification: "deterministic", inputTokens: null, outputTokens: null, costCny: null },
  });
  return { ...run, items, report };
}

function memoryStorage(initial: [string, string][] = []) {
  const data = new Map(initial);
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
  };
}

function renderWithState(element: React.ReactElement, values: unknown[]) {
  renderState.values = values;
  renderState.index = 0;
  try { return renderToStaticMarkup(element); }
  finally { renderState.values = null; renderState.index = 0; }
}

function renderSaved(items: SavedDecision[]) {
  return renderWithState(<SavedCompetitionsClient />, [[], items, null, false, null, null]);
}

function initialVisibleHtml(html: string) {
  let closedDetailsDepth = 0;
  return (html.match(/<[^>]*>|[^<]+/g) ?? []).filter(token => {
    if (/^<details\b/.test(token)) { closedDetailsDepth += 1; return false; }
    if (/^<\/details\b/.test(token)) { closedDetailsDepth -= 1; return false; }
    return closedDetailsDepth === 0;
  }).join("");
}

function expectEvidencePreserved(html: string) {
  expect(html).toContain(SOURCE_FACT);
  expect(html).toContain("你的回答：数据分析");
  expect(html).toContain(CONDITION);
}

describe("v7 student official-entry boundary", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());
  afterEach(() => { renderState.values = null; renderState.index = 0; });

  it("keeps v6 evidence links readable while v7 details and overview retain evidence text without links", () => {
    const run = evidenceRun();
    const report = run.report!;
    for (const element of [
      <DecisionDetails key="legacy-details" item={report.recommendations[0]} report={report} />,
      <DecisionOverview key="legacy-overview" report={report} turns={[]} onEdit={vi.fn()} />,
    ]) {
      const html = renderToStaticMarkup(element);
      for (const url of HISTORICAL_URLS) expect(html).toContain(`href="${url}"`);
      expectEvidencePreserved(html);
    }
    for (const element of [
      <DecisionDetails key="v7-details" item={report.recommendations[0]} report={report} showSourceLinks={false} />,
      <DecisionOverview key="v7-overview" report={report} turns={[]} onEdit={vi.fn()} showSourceLinks={false} />,
    ]) {
      const html = renderToStaticMarkup(element);
      for (const url of HISTORICAL_URLS) expect(html).not.toContain(url);
      expectEvidencePreserved(html);
    }
  });

  it("keeps the official entry in the list and source citations in the collapsed compact details", () => {
    const run = evidenceRun();
    const html = renderToStaticMarkup(<DecisionRunReport run={run} displayRun={run} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    const initial = initialVisibleHtml(html);
    for (const item of run.items) expect(initial).toContain(`href="${item.officialUrl}"`);
    const reason = html.match(/<p[^>]*data-claim-field="reason"[^>]*>[\s\S]*?<\/p>/)?.[0];
    for (const url of HISTORICAL_URLS) {
      expect(initial).not.toContain(url);
      expect(reason).toContain(`href="${url}"`);
    }
    expect(reason).toContain(REASON);
    expect(reason).toContain(CONDITION);
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
    expect(initial).not.toContain(REASON);
    expect(html).toContain("参赛资格和开赛时间请自行核查官网");
    expect(run.items[0].detail!.sources.map(source => source.url)).toEqual(HISTORICAL_URLS);
    expect(run.items[0].detail!.evidenceFacts[0].sourceIds).toEqual(["historical-source-0", "historical-source-1"]);
  });

  it("omits historical source links in a delivered v7 chat transcript without hiding supporting facts or conditions", () => {
    const run = evidenceRun();
    const reply: RecommendationChatReplyV7 = {
      responseVersion: "competition-decision-chat.v7", requestId: "chat-test", message: "可以从一页资料开始", profileRevision: run.profileRevision,
      decisionToken: run.decisionToken, claims: [run.report!.recommendations[0].reasons[0]], comparison: compareDecisionItems(run.report!.recommendations),
    };
    const html = renderWithState(<DecisionRunChat run={run} aiConsent={{ accepted: true, version: "test" }} onReply={vi.fn()} />, ["", [{ id: reply.requestId, text: "为什么推荐？", reply, run }], false, ""]);
    expect(html).toContain("可以从一页资料开始");
    expect(html).toContain(REASON);
    expectEvidencePreserved(html);
    for (const url of HISTORICAL_URLS) expect(html).not.toContain(url);
  });

  it("round-trips a v7 official entry and all maintenance evidence, and shows only its official link after reload", () => {
    const run = evidenceRun();
    const storage = memoryStorage();
    const result = saveSelectedRunDecisions(run, [run.items[0].itemId], storage);
    expect(result.ok).toBe(true);
    const reloaded = readSavedDecisions(storage);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.items).toHaveLength(1);
    expect(reloaded.value.items[0].officialEntry).toEqual({ sourcePolicy: SAVED_DECISION_OFFICIAL_ENTRY_POLICY, url: run.items[0].officialUrl });
    expect(reloaded.value.items[0].recommendation).toEqual(run.items[0].detail);
    const html = renderSaved(reloaded.value.items);
    expect(html.match(/href="https?:[^\"]+"/g)).toEqual([`href="${run.items[0].officialUrl}"`]);
    for (const url of HISTORICAL_URLS) expect(html).not.toContain(url);
    expect(html).toContain(REASON);
    expect(html).not.toContain("compact-recommendation-advisories");
    expect(initialVisibleHtml(html)).not.toContain(REASON);
    expect(initialVisibleHtml(html)).toContain(`href="${run.items[0].officialUrl}"`);
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
  });

  it("restores a reviewed subset after a refresh and saves only still-listed item identities", () => {
    const original = evidenceRun();
    const cached = recommendationRunSchema.parse(JSON.parse(JSON.stringify({ ...original, status: "list_ready", resultVersion: 2,
      detailsReadyAt: null, report: undefined, items: original.items.map(item => ({ ...item, detailStatus: "pending", detail: undefined })),
    })));
    const removed = original.items[0];
    const accepted = { ...original.items[1], rank: 1, detail: { ...original.items[1].detail!, rank: 1 } };
    const report = { ...original.report!, recommendations: [accepted.detail],
      summary: { ...original.report!.summary, focusItemIds: [accepted.itemId] },
      goalPaths: original.report!.goalPaths.map(row => ({ ...row, itemIds: [accepted.itemId] })),
      shortlistShortfallReason: "只交付一项已核实的推荐。" };
    const ready = recommendationRunSchema.parse({ ...original, resultVersion: 4, items: [accepted], report, shortfallReason: report.shortlistShortfallReason });
    expect(mergeRecommendationRun(cached, ready)).toEqual(ready);
    expect(mergeRecommendationRun(cached, { ...ready, resultVersion: cached.resultVersion })).toBeNull();
    expect(mergeRecommendationRun(cached, { ...ready, report: undefined })).toBeNull();
    expect(mergeRecommendationRun(cached, { ...ready, report: { ...report, fallback: { used: true, reason: "test" } } })).toBeNull();
    expect(mergeRecommendationRun(cached, { ...ready, report: { ...report, recommendations: [{ ...accepted.detail, checkpoint: "不同的报告内容" }] } })).toBeNull();
    expect(mergeRecommendationRun(cached, { ...ready, items: [{ ...accepted, officialUrl: removed.officialUrl }] })).toBeNull();
    const display = <DecisionRunReport run={ready} displayRun={ready} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />;
    const droppedSelection = renderWithState(display, [false, [removed.itemId], null, 0]);
    expect(droppedSelection).not.toContain(`data-item-id="${removed.itemId}"`);
    expect(droppedSelection).toMatch(/<button[^>]*disabled=""[^>]*>收藏所选 0 项<\/button>/);
    const acceptedSelection = renderWithState(display, [false, [removed.itemId, accepted.itemId], null, 0]);
    expect(acceptedSelection).toContain("收藏所选 1 项");
    expect(acceptedSelection).toContain(`data-item-id="${accepted.itemId}"`);
    const storage = memoryStorage();
    expect(saveSelectedRunDecisions(ready, [removed.itemId], storage).ok).toBe(false);
    expect(saveSelectedRunDecisions(ready, [removed.itemId, accepted.itemId], storage).ok).toBe(true);
    const saved = readSavedDecisions(storage);
    expect(saved.ok && saved.value.items.map(item => [item.recommendation.itemId, item.recommendation.rank])).toEqual([[accepted.itemId, 1]]);
  });

  it("keeps the specific restriction with the matching reason when a new recommendation is saved and reloaded", () => {
    const run = evidenceRun();
    const detail = run.items[0].detail!;
    const advisory = "参赛提醒：正式提交仅面向在读研究生。";
    detail.eligibilityNotes.push(advisory);
    const storage = memoryStorage();
    expect(saveSelectedRunDecisions(run, [detail.itemId], storage).ok).toBe(true);
    const reloaded = readSavedDecisions(storage);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;

    const html = renderSaved(reloaded.value.items);
    expect(html).toContain(advisory);
    expect(html.indexOf(advisory)).toBeGreaterThan(html.indexOf(REASON));
    expect(initialVisibleHtml(html)).not.toContain(advisory);
    expect(html).not.toContain('data-claim-field="advisory"');
  });

  it("carries the actual v744 qualification notices through grouped review, the ready detail and the reloaded saved card", async () => {
    const originalBytes = readFileSync("artifacts/accelerate-20261111/D/v744-formal-03/invocations/3128e16a277d86b51c27f5f7f082b5f356ba870bf0f266423844541d73ff21fe.json");
    expect(createHash("sha256").update(originalBytes).digest("hex")).toBe("13a79cbfe43c803040bcac1be08657826180426a2a4fede6ef869c54d4ece09f");
    const original = decisionReportSchema.parse(JSON.parse(originalBytes.toString("utf8")).observation.output);
    const cases = [
      { index: 2, factId: "physics-experiment-innovation:v2:eligibility", sourceIds: ["physics-2026-notice-task"],
        practice: "可以借助对输入和输出关系的建模经验，为冰与金属摩擦测量画出受力图。",
        check: "核对受力图能否区分滑动方向的摩擦力和垂直于接触面的支持力。" },
      { index: 3, factId: "v7-audience:comap-mcm-icm:degree", sourceIds: ["v7-audience:comap:standing-homepage", "v7-audience:comap:held-2026-rules"],
        practice: "可以把对输入与输出关系的建模思路用于手机耗能，试着为一个耗能输入写出它与剩余电量的关系。",
        check: "用自拟的轻、重使用情形检查这一关系能否区分电量下降的快慢。" },
    ].map(row => ({ ...row, item: original.recommendations[row.index] }));
    const records = getMatchingCatalogRecords().filter(record => cases.some(row => row.item.itemId === record.recordId));
    const context = buildDecisionContextV7(undefined, { profile: original.profile, records });
    const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
      shortfallReason: "只复现原报告中的两条资格提醒。",
      recommendations: cases.map(({ item }) => ({ itemId: item.itemId, rankRoleIndex: 0, rankTaskStepIndex: 0,
        reasons: [{ ...item.reasons[0], text: "复现原选定的任务与角色。", basis: "suggestion", conditions: [] }] })) };
    expect(context.records.find(record => record.seriesId === "comap-mcm-icm")?.facts.map(fact => fact.id)).toContain(cases[1].factId);
    expect(records.find(record => record.seriesId === "comap-mcm-icm")?.facts.map(fact => fact.id)).not.toContain(cases[1].factId);
    const comapMatch = matchExplanationInputV7(context, plan).candidates.find(candidate => candidate.itemId === cases[1].item.itemId)!;
    expect(comapMatch.facts.map(fact => fact.id)).not.toContain(cases[1].factId);
    expect(comapMatch.citationRules.competitionFactIds).not.toContain(cases[1].factId);
    const invalidPlan = structuredClone(plan);
    invalidPlan.recommendations[1].reasons[0].competitionFactIds = [cases[1].factId];
    expect(validateMatchPlanV7(invalidPlan, context).issues).toContain(`match_advisory_fact_is_not_task_evidence:${cases[1].item.itemId}:${cases[1].factId}`);

    const run = { runId: randomUUID(), stateKey: "advisory-evidence-offline", generation: 0, implementationSha256: "a".repeat(64),
      effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), detailDeadlineEpochMs: Date.now() + 150_000 };
    const [spec] = createExplanationGroupSpecsV7(context, plan, run);
    const success = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const,
      httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });
    const modelCall = vi.fn<DecisionModelCallV7>(async (prompt, request) => {
      const wire = JSON.parse(prompt);
      if (request.operation === "competition_v7_explain") return success({ schemaVersion: "saitu.group-explanation.v1",
        groupBindingSha256: wire.groupBindingSha256, groupId: spec.groupId, profileRevision: plan.profileRevision,
        catalogVersion: plan.catalogVersion, shortfallReason: plan.shortfallReason, recommendations: cases.map(({ item, practice, check }) => ({
          itemId: item.itemId, reason: { practice, check },
        })) });
      return success({ checks: wire.assertions.map((row: { key: string }) => ({ key: row.key, supported: true, reason: "离线复现原已核任务及同源资格提醒的交付。" })) });
    });
    const options = { requestId: run.runId, runBinding: run, deadlineEpochMs: run.detailDeadlineEpochMs - 750, modelCall };
    const { prepared } = await generateGroupExplanationV7(context, plan, spec, options);
    const { reviewed } = await reviewPreparedGroupV7(context, plan, prepared, { ...options, persisted: {
      schemaVersion: "saitu.persisted-group-explanation.v1", runId: run.runId, groupId: spec.groupId, groupBindingSha256: prepared.groupBindingSha256,
      preparedSha256: prepared.preparedSha256, persistedResultVersion: 2, groupVersion: 1,
    }, persistReviewPreparation: async () => {} });
    const details = assembleReviewedGroupDetailsV7(context, plan, prepared, reviewed, run);
    const report = assembleReviewedGroupsReportV7(context, plan, [{ prepared, reviewed }], run, {
      calls: (["explain", "review"] as const).map(stage => ({ runId: run.runId, callId: randomUUID(), reservationId: randomUUID(),
        callKey: groupCallKeyV7(spec.groupId, stage), upstreamAttempted: true, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 } })),
      startedAtEpochMs: Date.now() - 10, completedAtEpochMs: Date.now(),
    });
    expect(modelCall.mock.calls.map(([, request]) => request.operation)).toEqual(["competition_v7_explain", "competition_v7_review"]);
    expect(details).toEqual(report.recommendations);
    const saved = recommendationRunFixture({ status: "ready", runId: run.runId, profileId: context.profile.profileId,
      profileRevision: context.profile.revision, profile: context.profile, catalogVersion: context.catalogVersion, report,
      items: details.map(detail => ({ rank: detail.rank, itemId: detail.itemId, seriesId: detail.seriesId, name: detail.name,
        trackLabel: detail.trackLabel, edition: detail.edition, officialUrl: null, detailStatus: "ready", detail })) });
    const storage = memoryStorage();
    expect(saveSelectedRunDecisions(saved, details.map(detail => detail.itemId), storage).ok).toBe(true);
    const reloaded = readSavedDecisions(storage);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;

    for (const { item, factId, sourceIds } of cases) {
      const detail = details.find(row => row.itemId === item.itemId)!;
      const prior = displayedRecommendationAdvisoriesV7(item).find(row => row.text.startsWith("参赛提醒："))!;
      expect(prior.claim).toBeUndefined();
      const row = displayedRecommendationAdvisoriesV7(detail).find(row => row.text === prior.text)!;
      expect(row.claim?.competitionFactIds).toEqual([factId]);
      expect(row.claim?.studentFactIds).toEqual([context.profile.facts.find(fact => fact.field === "stage")?.id]);
      expect(detail.evidenceFacts.find(fact => fact.id === factId)?.sourceIds).toEqual(sourceIds);
      const reloadedItem = reloaded.value.items.find(row => row.recommendation.itemId === item.itemId)!;
      expect(reloadedItem.recommendation).toEqual(detail);
      for (const html of [renderToStaticMarkup(<CompactDecisionDetails item={detail} profile={context.profile} />), renderSaved([reloadedItem])]) {
        const note = html.match(/<p[^>]*data-advisory-note="true"[^>]*>参赛提醒：[\s\S]*?<\/p>/)?.[0];
        expect(note).toContain(prior.text);
        expect([...note!.matchAll(/data-source-id="([^"]+)"/g)].map(match => match[1])).toEqual(sourceIds);
      }
      const html = renderToStaticMarkup(<CompactDecisionDetails item={{ ...detail, gaps: detail.gaps.map(claim => claim.text === prior.text ? { ...claim, competitionFactIds: [cases.find(row => row.item.itemId !== item.itemId)!.factId] } : claim) }} />);
      expect(html).toContain(prior.text);
      expect(html).not.toContain('data-claim-field="advisory"');
    }
  });

  it("keeps an explicit missing official entry after reload and never falls back to historical sources", () => {
    const run = evidenceRun();
    run.items[0].officialUrl = null;
    const storage = memoryStorage();
    expect(saveSelectedRunDecisions(run, [run.items[0].itemId], storage).ok).toBe(true);
    const reloaded = readSavedDecisions(storage);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.items[0].officialEntry).toEqual({ sourcePolicy: SAVED_DECISION_OFFICIAL_ENTRY_POLICY, url: null });
    expect(reloaded.value.items[0].recommendation.sources.map(source => source.url)).toEqual(HISTORICAL_URLS);
    const html = renderSaved(reloaded.value.items);
    expect(html).toContain("官网链接暂缺");
    expect(html).not.toMatch(/href="https?:/);
    for (const url of HISTORICAL_URLS) expect(html).not.toContain(url);
  });

  it("reads historical v6 saves without rewriting them and preserves the separate v5 store when saving a new v7 item", () => {
    const run = evidenceRun();
    const legacy = { savedAt: "2026-11-05T01:00:00.000Z", reportId: "legacy-v6", catalogVersion: run.catalogVersion, profileRevision: "legacy-revision", recommendation: run.items[0].detail };
    const raw = JSON.stringify({ schemaVersion: SAVED_DECISIONS_KEY, items: [legacy] }, null, 2);
    const v5Raw = "  historical-v5-store-unchanged\n";
    const storage = memoryStorage([[SAVED_DECISIONS_KEY, raw], ["saitu.savedCompetitions.v1", v5Raw]]);
    const read = readSavedDecisions(storage);
    expect(read.ok).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.data.get(SAVED_DECISIONS_KEY)).toBe(raw);
    if (!read.ok) return;
    expect(read.value.items[0]).not.toHaveProperty("officialEntry");
    const legacyHtml = renderSaved(read.value.items);
    for (const url of HISTORICAL_URLS) expect(legacyHtml).toContain(`href="${url}"`);
    expect(saveSelectedRunDecisions(run, [run.items[1].itemId], storage).ok).toBe(true);
    const mixed = readSavedDecisions(storage);
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(mixed.value.items.find(item => item.recommendation.itemId === run.items[0].itemId)).toEqual(legacy);
    expect(mixed.value.items.find(item => item.recommendation.itemId === run.items[1].itemId)?.officialEntry?.url).toBe(run.items[1].officialUrl);
    expect(storage.data.get("saitu.savedCompetitions.v1")).toBe(v5Raw);
  });

  it.each(["javascript:alert(1)", "data:text/html,test", "file:///tmp/rules", "mailto:organizer@example.org", "//official.example.org", "https://"])("refuses a non-http(s) or malformed official entry before saving: %s", url => {
    const run = evidenceRun();
    run.items[0].officialUrl = url;
    const raw = JSON.stringify({ schemaVersion: SAVED_DECISIONS_KEY, items: [] }, null, 2);
    const storage = memoryStorage([[SAVED_DECISIONS_KEY, raw]]);
    expect(saveSelectedRunDecisions(run, [run.items[0].itemId], storage).ok).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.data.get(SAVED_DECISIONS_KEY)).toBe(raw);
  });

  it("does not write mismatched list identities, invalid final saves, or unreadable existing data", () => {
    const run = evidenceRun();
    const mismatch = structuredClone(run);
    mismatch.items[0].detail!.itemId = "another-item";
    const storage = memoryStorage();
    expect(saveSelectedRunDecisions(mismatch, [mismatch.items[0].itemId], storage).ok).toBe(false);
    const invalidReport = structuredClone(run.report!);
    invalidReport.recommendations[0].sources[0].url = "javascript:alert(1)";
    expect(saveSelectedDecisions(invalidReport, [invalidReport.recommendations[0].itemId], storage).ok).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    const unreadable = memoryStorage([[SAVED_DECISIONS_KEY, "broken-existing-data"]]);
    expect(saveSelectedRunDecisions(run, [run.items[0].itemId], unreadable).ok).toBe(false);
    expect(unreadable.data.get(SAVED_DECISIONS_KEY)).toBe("broken-existing-data");
    expect(unreadable.setItem).not.toHaveBeenCalled();
  });

  it("rejects corrupt or unknown official-entry metadata on read without dropping its policy or rewriting storage", () => {
    const run = evidenceRun();
    const base = { savedAt: "2026-11-05T01:00:00.000Z", reportId: "saved-v7", catalogVersion: run.catalogVersion, profileRevision: run.profileRevision, recommendation: run.items[0].detail };
    for (const officialEntry of [{ sourcePolicy: "official-entry-only.v7", url: "javascript:alert(1)" }, { sourcePolicy: "official-entry-only.v7" }, { sourcePolicy: "unknown", url: null }]) {
      const raw = JSON.stringify({ schemaVersion: SAVED_DECISIONS_KEY, items: [{ ...base, officialEntry }] });
      const storage = memoryStorage([[SAVED_DECISIONS_KEY, raw]]);
      expect(readSavedDecisions(storage).ok).toBe(false);
      expect(storage.data.get(SAVED_DECISIONS_KEY)).toBe(raw);
      expect(storage.setItem).not.toHaveBeenCalled();
    }
  });
});
