import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SelectionResultActions } from "@/components/competitions/recommend/SelectionResultActions";
import { decisionQuestionTurns } from "@/components/competitions/recommend/questionFlow";
import { competitions } from "@/content/competitions";
import type { CompetitionRecommendationItemV3 } from "@/types/competition-recommendation";

function recommendation(index: number): CompetitionRecommendationItemV3 {
  const competition = competitions[index];
  return {
    rank: index + 1,
    competitionId: competition.id,
    role: index === 0 ? "best-match" : index === 1 ? "practical" : "stretch",
    recommendationRole: index === 0 ? "best" : "steady",
    baseMatchScore: 86 - index * 5,
    matchScore: 90 - index * 5,
    scoreCalibration: {
      version: "competition-score-calibration.v1",
      qualified: true,
      alignment: 0.8,
      evidenceConfidence: 1,
      adjustment: 4
    },
    rankingSource: "rule-fallback",
    eligibility: { status: "eligible", reasons: [] },
    fit: { score: 80, matchedSignals: [], gaps: [] },
    scoreBreakdown: {
      subjectTask: 22,
      skillsEvidence: 18,
      goalsOutputs: 14,
      maturity: 8,
      teamResources: 13,
      availabilityTiming: 10,
      dataConfidence: 5,
      interest: null,
      background: null,
      goal: null,
      difficulty: null,
      access: null,
      feasibility: null,
      completenessPenalty: 0
    },
    registrationStatus: { status: "unknown", label: "请核验本届通知" },
    dataNotices: [],
    name: competition.name,
    category: competition.category,
    summary: competition.summary,
    sourceUrl: competition.sourceUrl,
    explanationSource: "rule",
    explanation: { matchReasons: [], possibleGaps: [], preparationTips: [] }
  };
}

describe("recommendation next-step services", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("keeps correction, comparison, saving and optional contact reachable after selection", () => {
    const html = renderToStaticMarkup(
      <SelectionResultActions editTurn={vi.fn()} openDetails={vi.fn()} turns={decisionQuestionTurns("quick", {})}
        result={{
          responseVersion: "competition-recommendation.v5", status: "matched",
          catalogVersion: "test", scorerVersion: "test", promptVersion: "test", model: "structured-fit",
          provider: "server", rankingSource: "evidence-rules", fallbackUsed: false, fallbackMode: "none",
          recommendations: [recommendation(0), recommendation(1)]
        }} />
    );
    expect(html).toContain("比较两到三项竞赛");
    expect(html).toContain("为什么没推荐某场比赛");
    expect(html).toContain("修改条件后重新推荐");
    expect(html).toContain("保存并打开我的竞赛");
    expect(html).toContain('href="/about#contact"');
    expect(html).not.toContain("竞赛资源");
  });
});
