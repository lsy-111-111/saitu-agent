import type { CompetitionRecommendationProfileV5 } from "@/types/competition-recommendation";
import {
  DECISION_MODULES,
  VALUE_DIMENSIONS,
  type DecisionCompetitionRecord,
} from "@/lib/competitions/v6/catalog-types";

/** Synthetic contract fixtures only; these records are never part of the product catalog. */
export function student(
  overrides: Partial<CompetitionRecommendationProfileV5> = {},
): CompetitionRecommendationProfileV5 {
  return {
    profileVersion: "competition-profile.v5",
    questionnaireVersion: "competition-questionnaire.v1",
    stage: "undergraduate-1",
    majorFields: [],
    specificSubjects: [],
    skills: [],
    interests: [],
    goals: [],
    preferredOutputs: [],
    startingPoint: "idea_only",
    weeklyCommitment: "under-5",
    teamStatus: "solo",
    availableResources: [],
    participationMode: "flexible",
    participationTiming: "flexible",
    taskFormats: [],
    experienceLevel: "none",
    evidence: [],
    confirmedFields: ["stage"],
    confirmedFacts: [],
    ...overrides,
  };
}
export function syntheticRecord(index: number): DecisionCompetitionRecord {
  const seriesId = `contract-fixture-${index}`;
  const factId = `${seriesId}.task`;
  const sourceId = `${seriesId}.source`;
  const official = {
    text: "为一个明确问题制作可复现的数据分析报告。",
    kind: "official_fact" as const,
    factIds: [factId],
    conditions: [],
  };
  return {
    schemaVersion: "saitu.competition.v2",
    catalogVersion: "test-fixtures-only",
    recordId: `${seriesId}.2026.analysis`,
    seriesId,
    name: `合成测试赛事${index}`,
    aliases: [],
    organizer: "合成测试组织",
    edition: "2026测试届次",
    track: { id: "analysis", name: "数据任务" },
    group: "本科生",
    scope: "合成测试范围",
    taskFamily: "data-modeling",
    subjectTags: [],
    summary: "仅用于契约测试",
    pilot: false,
    contentTier: "L2",
    targetTier: "L2",
    review: { status: "draft", reviewerIds: [], reviewedAt: null },
    registration: {
      status: "historical",
      checkedAt: null,
      factIds: [],
      note: "合成历史资料，不是真实赛事",
    },
    sources: [
      {
        id: sourceId,
        url: "https://example.org/fixture",
        title: "合成测试原文",
        publisher: "测试",
        authority: "organizer",
        scope: "合成测试范围",
        checkedAt: "2026-11-05",
        publishedAt: "2026-01-01",
        accessStatus: "body_read",
        locator: "fixture",
        verificationMethod: "agent_web_read",
      },
    ],
    facts: [
      {
        id: factId,
        field: "task",
        text: official.text,
        kind: "official_fact",
        status: "historical",
        sourceIds: [sourceId],
        scope: "合成测试范围",
        checkedAt: "2026-11-05",
        supersedes: [],
        conflictsWith: [],
      },
    ],
    sections: Object.fromEntries(
      DECISION_MODULES.map((m) => [m, [official]]),
    ) as unknown as DecisionCompetitionRecord["sections"],
    roles: [
      {
        name: "数据整理",
        task: "清理一份数据并记录处理决策",
        skills: ["data-analysis"],
        evidenceToAsk: "独立处理过什么数据",
        personalDeliverable: "可复现笔记",
        prerequisite: "learnable",
        factIds: [factId],
      },
    ],
    valueDimensions: VALUE_DIMENSIONS.map((d) => ({
      dimension: d,
      assessment: {
        text: "完成并能够说明本人贡献后，可整理一个练习作品。",
        kind: "editorial_inference",
        factIds: [factId],
        conditions: ["实际完成并有权展示"],
      },
      evidenceLevel: "partial",
    })),
    difficulty: (["entry", "completion", "award"] as const).map((stage) => ({
      stage,
      summary: "先试一项小任务，再检查完成质量。",
      assumptions: ["资源条件仍需确认"],
      factIds: [factId],
    })),
    skills: ["data-analysis"],
    interests: ["data"],
    preferredOutputs: ["research-paper"],
    experienceSignals: [],
    suitability: {
      goodFit: ["愿意处理数据"],
      poorFit: ["明确拒绝分析工作"],
      uncertainties: ["资格与费用待核实"],
    },
    sevenDayTrial: {
      action: "整理一张表并写出一个发现",
      output: "表格与说明",
      completionCheck: "另一人能理解数据来源和处理过程",
      reflection: "是否愿意继续处理数据",
    },
    schoolPolicyReminder: "学校政策需核对",
    publication: {
      mode: "conditional_exploration",
      productionReady: false,
      blockers: ["synthetic_fixture"],
    },
    migration: {
      origin: "verified_expansion",
      originalSeriesId: seriesId,
      originalCheckedAt: null,
      note: "test only",
    },
  };
}
export const syntheticCatalog = Array.from({ length: 6 }, (_, i) =>
  syntheticRecord(i + 1),
);
