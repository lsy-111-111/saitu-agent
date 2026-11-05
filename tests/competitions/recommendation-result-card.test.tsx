import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RecommendationResultCard } from "@/components/competitions/recommend/RecommendationResultCard";
import type { CompetitionRecommendationItemV3 } from "@/types/competition-recommendation";

const recommendation: CompetitionRecommendationItemV3 = {
  rank: 1,
  competitionId: "track-aware-fixture",
  role: "best-match",
  recommendationRole: "best",
  baseMatchScore: 86,
  matchScore: 92.4,
  scoreCalibration: {
    version: "competition-score-calibration.v1",
    qualified: true,
    alignment: 0.9,
    evidenceConfidence: 1,
    adjustment: 6.4
  },
  rankingSource: "rule-fallback",
  eligibility: { status: "eligible", reasons: [] },
  fit: { score: 86, matchedSignals: ["software-engineering"], gaps: [] },
  evidenceRefs: {
    match: ["profile.skill:programming"],
    gaps: ["candidate.schedule:track-aware-fixture"],
    tips: ["tip.official:track-aware-fixture"],
    source: ["official:track-aware-fixture:rules"],
    details: [
      {
        evidenceRef: "profile.skill:programming",
        kind: "match",
        provenance: "editorial-inference"
      },
      {
        evidenceRef: "candidate.schedule:track-aware-fixture",
        kind: "gap",
        provenance: "official-fact",
        fact: "schedule",
        sourceRef: "official:track-aware-fixture:rules",
        sourceUrl: "https://example.com/competition/rules"
      },
      {
        evidenceRef: "tip.official:track-aware-fixture",
        kind: "tip",
        provenance: "preparation"
      }
    ],
    officialFacts: [{
      fact: "schedule",
      sourceRef: "official:track-aware-fixture:rules",
      sourceUrl: "https://example.com/competition/rules"
    }]
  },
  recommendedTrack: { id: "software", label: "软件应用赛道" },
  scoreBreakdown: {
    subjectTask: 22,
    skillsEvidence: 17,
    goalsOutputs: 13,
    maturity: 8,
    teamResources: 12,
    availabilityTiming: 9,
    dataConfidence: 5,
    interest: 22,
    background: 17,
    goal: 13,
    difficulty: 8,
    access: 9,
    feasibility: 12,
    completenessPenalty: 0
  },
  registrationStatus: { status: "upcoming", label: "即将开放" },
  dataNotices: [],
  name: "赛道评分示例竞赛",
  category: "软件 / 应用开发",
  summary: "用于验证赛道与七维评分展示。",
  sourceUrl: "https://example.com/competition",
  explanationSource: "rule",
  explanation: {
    matchReasons: ["结构化条件匹配。"],
    possibleGaps: ["本届日期以官方通知为准。"],
    preparationTips: ["核对官方通知。"]
  }
};

describe("recommendation result card", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("explains the selected track using evidence without an unexplained percentage", () => {
    const html = renderToStaticMarkup(
      <RecommendationResultCard
        onOpenDetails={vi.fn()}
        onSourceClick={vi.fn()}
        recommendation={recommendation}
      />
    );

    expect(html).toContain("推荐赛道：软件应用赛道");
    expect(html).not.toContain("综合匹配分");
    expect(html).toContain("为什么匹配");
    expect(html).toContain("系统匹配推断");
    expect(html).toContain("官方事实");
    expect(html).toContain("核验／准备建议");
    expect(html).toContain("证据引用 official:track-aware-fixture:rules");
    expect(html).toContain('href="https://example.com/competition/rules"');
  });

  it("诚实标记参考匹配和资格待核验", () => {
    const html = renderToStaticMarkup(
      <RecommendationResultCard
        onOpenDetails={vi.fn()}
        onSourceClick={vi.fn()}
        recommendation={{
          ...recommendation,
          role: "reference",
          recommendationRole: "reference",
          matchScore: 70,
          baseMatchScore: 70,
          eligibility: { status: "needs_clarification", reasons: ["需核对当届官方通知。"] },
          scoreCalibration: {
            ...recommendation.scoreCalibration,
            qualified: false,
            adjustment: 0
          }
        }}
      />
    );

    expect(html).toContain("参考匹配");
    expect(html).toContain("资格待核验");
    expect(html).toContain("尚待核实的条件");
  });
});
