import type { DecisionClaimV6, DecisionRecommendationV6 } from "../../src/lib/competitions/v6/contracts";
import { LEGACY_RECOMMENDATION_POLICY_VERSION, RECOMMENDATION_EXECUTION_POLICY, RECOMMENDATION_IMPLEMENTATION_VERSION, RECOMMENDATION_POLICY_VERSION, RECOMMENDATION_RESPONSE_VERSION, type RecommendationRunV7 } from "../../src/lib/competitions/v7/contracts";

export const runFixtureId = "91e5ae60-60b4-4cb6-8e20-fb2e55751001";
export const nextRunFixtureId = "91e5ae60-60b4-4cb6-8e20-fb2e55751002";
const claim = (text: string): DecisionClaimV6 => ({ text, basis: "student", studentFactIds: [], competitionFactIds: [], conditions: [] });
// Repeated snapshots of this synthetic run retain their original time anchors.
const fixtureSubmittedAtEpochMs = Date.now();

export function runItemDetail(index: number): DecisionRecommendationV6 {
  return { rank: index + 1, itemId: `run-item-${index}`, seriesId: `run-series-${index}`, name: `列表先出测试竞赛${index + 1}`,
    trackLabel: "资料与数据表达", edition: "2026测试届次", contentTier: "L2", eligibilityStatus: "unknown", eligibilityNotes: ["资格请核查官网"],
    registration: { status: "unknown", note: "时间请核查官网" }, preparation: "explore", coreTask: claim("整理资料并解释图表"),
    reasons: [claim(`详情中的专属匹配理由${index + 1}`)], currentRole: claim("从你自报的数据技能开始"), gaps: [claim("练习复查与修改")],
    values: [{ dimension: "skill", claim: claim("完成一次可展示的实践") }],
    difficulty: ["entry", "completion", "award"].map(stage => ({ stage: stage as "entry" | "completion" | "award", claim: claim("按目标逐步投入") })),
    opportunityCost: claim("每周留出练习时间"), nextStep: claim("先整理一页资料"), checkpoint: "一周后再判断",
    sources: [{ id: `task-source-${index}`, title: "任务参考资料", url: `https://sources.example.org/task-${index}`, scope: "任务参考", checkedAt: "2026-11-09" }], evidenceFacts: [],
  };
}

export function recommendationRunFixture(overrides: Partial<RecommendationRunV7> = {}): RecommendationRunV7 {
  const now = fixtureSubmittedAtEpochMs;
  const run: Omit<RecommendationRunV7, "profile"> = { responseVersion: RECOMMENDATION_RESPONSE_VERSION, runId: runFixtureId, decisionToken: "opaque-v7-test-token-12345678901234567890",
    profileId: "profile-v7-browser", profileRevision: "revision-one", catalogVersion: "catalog-v7-browser", policyVersion: RECOMMENDATION_POLICY_VERSION,
    status: "list_ready", resultVersion: 1, submittedAt: new Date(now).toISOString(), expiresAt: new Date(now + 25 * 60_000).toISOString(), listReadyAt: new Date(now).toISOString(), detailsReadyAt: null,
    pollAfterMs: 500, items: Array.from({ length: 3 }, (_, index) => ({ rank: index + 1, itemId: `run-item-${index}`, seriesId: `run-series-${index}`,
      name: `列表先出测试竞赛${index + 1}`, trackLabel: "资料与数据表达", edition: "2026测试届次", officialUrl: `https://official.example.org/entry-${index}`, detailStatus: "pending" })),
    shortfallReason: "本次只有三项有充分依据，不补齐数量。", ...overrides };
  return { ...run, profile: overrides.profile ?? { schemaVersion: "saitu.profile.v6", profileId: run.profileId, revision: run.profileRevision,
    facts: [{ id: "browser-stage", field: "stage", value: "undergraduate-1", label: "本科大一", state: "affirmed", confirmed: true, evidenceLevel: "self_report" },
      { id: "browser-skill", field: "skills", value: "data-analysis", label: "数据分析", state: "affirmed", confirmed: true, evidenceLevel: "self_report" }],
    unknownFields: [], retractedFactIds: [], goals: [], primaryGoal: null, tradeoffStatus: "not_needed", mode: "quick" } };
}

export function completedRunFixture(): RecommendationRunV7 {
  const run = recommendationRunFixture({ status: "ready", resultVersion: 3, detailsReadyAt: new Date().toISOString() });
  return { ...run, items: run.items.map((item, index) => index === 2 ? { ...item, detailStatus: "failed" } : { ...item, detailStatus: "ready", detail: runItemDetail(index) }) };
}

/** New submissions contain the complete five-item list, with frozen timing. */
export function topFiveRunFixture(overrides: Partial<RecommendationRunV7> = {}): RecommendationRunV7 {
  const base = recommendationRunFixture();
  return recommendationRunFixture({
    implementationVersion: RECOMMENDATION_IMPLEMENTATION_VERSION,
    executionPolicy: { ...RECOMMENDATION_EXECUTION_POLICY },
    listTargetAt: new Date(fixtureSubmittedAtEpochMs + 40_000).toISOString(),
    rankDeadlineAt: new Date(fixtureSubmittedAtEpochMs + 60_000).toISOString(),
    detailTargetAt: new Date(fixtureSubmittedAtEpochMs + 120_000).toISOString(),
    detailDeadlineAt: new Date(fixtureSubmittedAtEpochMs + 150_000).toISOString(),
    items: Array.from({ length: 5 }, (_, index) => ({ ...base.items[0], rank: index + 1, itemId: `run-item-${index}`, seriesId: `run-series-${index}`, name: `列表先出测试竞赛${index + 1}`, officialUrl: `https://official.example.org/entry-${index}` })),
    shortfallReason: null, ...overrides,
  });
}

/** Historical ten-item records retain their own policy and original deadlines. */
export function legacyTenRunFixture(overrides: Partial<RecommendationRunV7> = {}): RecommendationRunV7 {
  const base = recommendationRunFixture();
  return recommendationRunFixture({
    policyVersion: LEGACY_RECOMMENDATION_POLICY_VERSION,
    rankDeadlineAt: new Date(fixtureSubmittedAtEpochMs + 45_000).toISOString(),
    detailDeadlineAt: new Date(fixtureSubmittedAtEpochMs + 90_000).toISOString(),
    items: Array.from({ length: 10 }, (_, index) => ({ ...base.items[0], rank: index + 1, itemId: `run-item-${index}`, seriesId: `run-series-${index}`, name: `历史测试竞赛${index + 1}`, officialUrl: `https://official.example.org/entry-${index}` })),
    shortfallReason: null, ...overrides,
  });
}
