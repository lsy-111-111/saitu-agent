import { completedRunFixture } from "./fixtures/recommendation-run-v7";
import type { DecisionClaimV6, DecisionRecommendationV6, DecisionReportV6 } from "../src/lib/competitions/v6/contracts";
import type { RecommendationRunV7 } from "../src/lib/competitions/v7/contracts";

// Independent synthetic UI fixtures; never product ranking/gold/challenge inputs.
export const reviewSourcePrefix = "https://historical.review.example/";
export const reviewOfficialUrls = ["https://official.review.example/contest-one", "http://official.review.example/contest-two", null] as const;
export const reviewClaim = (text: string, factId = "review-fact-0"): DecisionClaimV6 => ({
  text, basis: "inference", studentFactIds: ["browser-skill"], competitionFactIds: [factId], conditions: ["完成自己的练习后再决定投入"],
});

export function independentReviewRun(): RecommendationRunV7 {
  const base = completedRunFixture();
  const recommendations: DecisionRecommendationV6[] = base.items.map((item, index) => {
    const seed = base.items[index < 2 ? index : 1].detail!;
    const factId = `review-fact-${index}`;
    const claim = (text: string) => reviewClaim(text, factId);
    return { ...seed, rank: item.rank, itemId: item.itemId, seriesId: item.seriesId, name: item.name,
      coreTask: claim(`独立复审任务${index + 1}`), reasons: [claim(`独立复审理由${index + 1}`)], currentRole: claim(`独立复审角色${index + 1}`),
      gaps: Array.from({ length: 5 }, (_, gap) => claim(`独立复审差距${index + 1}-${gap + 1}`)),
      values: [{ dimension: "skill", claim: claim(`独立复审收获${index + 1}`) }],
      difficulty: (["entry", "completion", "award"] as const).map(stage => ({ stage, claim: claim(`独立复审难度${index + 1}-${stage}`) })),
      opportunityCost: claim(`独立复审代价${index + 1}`), nextStep: claim(`独立复审下一步${index + 1}`),
      sources: [
        { id: `review-source-${index}`, title: `历史任务资料${index + 1}`, url: `${reviewSourcePrefix}rules-${index}.pdf`, scope: "历史任务参考，不是当前报名安排", checkedAt: "2026-10-01" },
        { id: `review-archive-${index}`, title: `历史组织者通知${index + 1}`, url: `${reviewSourcePrefix}archive-${index}`, scope: "保留原始档案供后端校验", checkedAt: "2026-10-02" },
      ],
      evidenceFacts: [{ id: factId, text: `独立复审资料事实${index + 1}`, sourceIds: [`review-source-${index}`, `review-archive-${index}`], scope: "历史任务范围", status: "historical", kind: "official_fact" }],
    };
  });
  const report: DecisionReportV6 = {
    schemaVersion: "saitu.report.v6", reportId: "independent-review-report", generatedAt: new Date().toISOString(), catalogVersion: base.catalogVersion, profile: base.profile,
    summary: { direction: reviewClaim("独立复审总览方向"), personalEvidence: [reviewClaim("独立复审总览依据")], mainGap: reviewClaim("独立复审总览差距"), nextStep: reviewClaim("独立复审总览下一步"), focusItemIds: recommendations.slice(0, 2).map(item => item.itemId) },
    recommendations, shortlistShortfallReason: null, comparisons: [],
    goalPaths: [{ goal: "能力训练", condition: "先做练习再比较", itemIds: [recommendations[0].itemId], nextStep: reviewClaim("独立复审目标路径下一步") }],
    candidateAudit: [], pendingQuestions: [], usefulQuestions: [], schoolPolicyReminder: "学校政策自行核对", fallback: { used: false, reason: null },
    trace: { engineVersion: "independent-review", method: "rules", model: "synthetic-no-live-model", promptVersion: "independent-review", candidateCount: 3, callCount: 0, elapsedMs: 0, verification: "deterministic", inputTokens: null, outputTokens: null, costCny: 0 },
  };
  return { ...base, report, items: base.items.map((item, index) => ({ ...item, officialUrl: reviewOfficialUrls[index], detailStatus: "ready", detail: recommendations[index] })) };
}

export function independentLegacyDecisionStore() {
  const recommendation = structuredClone(independentReviewRun().items[0].detail!);
  recommendation.itemId = "review-legacy-v6";
  recommendation.name = "独立复审旧v6收藏";
  return { schemaVersion: "saitu.savedDecisionChoices.v6" as const, items: [{ savedAt: "2026-10-01T00:00:00.000Z", reportId: "legacy-review-report", catalogVersion: "legacy-review-catalog", profileRevision: "legacy-revision", recommendation }] };
}

export const independentLegacyV5Store = {
  schemaVersion: "saitu.savedCompetitions.v1",
  entries: [{ competitionId: "future-aircraft-design", source: "competition-recommendation", batchId: "independent-review-v5", firstSavedAt: "2026-08-22T08:00:00.000Z", latestSavedAt: "2026-08-22T08:00:00.000Z",
    recommendation: { rank: 1, role: "best-match", baseMatchScore: 92,
      scoreBreakdown: { interest: 20, background: 18, goal: 16, difficulty: 12, access: 12, feasibility: 12, completenessPenalty: 0 },
      rankingSource: "deepseek", registrationStatus: { status: "open", label: "当前可报名" }, dataNotices: ["报名时间待核验"],
      explanation: { matchReasons: ["独立复审旧v5理由"], possibleGaps: ["需要核验本届参赛条件"], preparationTips: ["从自己的练习开始"] },
      catalogVersion: "independent-review-v5", scorerVersion: "independent-review-v5", promptVersion: "independent-review-v5", fallbackUsed: false, fallbackMode: "none" } }],
};
