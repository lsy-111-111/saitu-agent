import { z } from "zod";
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_AI_REQUEST_DEADLINE_MS,
  getCompetitionAiProviderFailureReason,
  getConfiguredAiProvider,
  getConfiguredAiModel,
  requestAiJson,
  waitForAiRetry,
  type AiJsonFailureReason,
  type RequestAiJsonOptions
} from "@/lib/ai/ai-client";
import { sanitizeCompetitionProfileForExplanation } from "@/lib/ai/competition-request-schema";
import { buildPrompt } from "@/lib/ai/prompt-builder";
import type { DeterministicCompetitionRecommendation } from "@/lib/competitions/recommendation-engine";
import type {
  CompetitionRecommendationExplanation,
  CompetitionRecommendationExplanationSource,
  CompetitionRecommendationFallbackMode,
  CompetitionRecommendationProfileV2,
  CompetitionScoreBreakdown
} from "@/types/competition-recommendation";

export const COMPETITION_EXPLAIN_PROMPT_VERSION = "competition-explain.v3";

export const competitionExplanationSchema = z
  .object({
    matchReasons: z.array(z.string().trim().min(1).max(180)).min(1).max(2),
    possibleGaps: z.array(z.string().trim().min(1).max(180)).min(1).max(2),
    preparationTips: z.array(z.string().trim().min(1).max(180)).min(2).max(3)
  })
  .strict();

const explainOutputEnvelopeSchema = z
  .object({
    explanationsById: z.record(z.unknown())
  })
  .strict();

type CompetitionAiExplanation = CompetitionRecommendationExplanation & {
  competitionId: string;
  explanationSource: CompetitionRecommendationExplanationSource;
};

export type CompetitionExplanationResult = {
  explanations: CompetitionAiExplanation[];
  promptVersion: typeof COMPETITION_EXPLAIN_PROMPT_VERSION;
  model: string;
  provider: string;
  fallbackUsed: boolean;
  fallbackMode: CompetitionRecommendationFallbackMode;
  fallbackReason?: AiJsonFailureReason;
};

export function getCompetitionExplainModel() {
  return process.env.AI_COMPETITION_RECOMMEND_MODEL?.trim() || getConfiguredAiModel(DEFAULT_DEEPSEEK_MODEL);
}

const dimensionLabels: Record<keyof Omit<CompetitionScoreBreakdown, "completenessPenalty">, string> = {
  subjectTask: "学科方向与赛项形式",
  skillsEvidence: "技能与已有证据",
  goalsOutputs: "参赛目标与成果类型",
  maturity: "项目成熟度",
  teamResources: "团队、投入与资源",
  availabilityTiming: "报名状态与时间安排",
  dataConfidence: "赛事资料可信度",
  interest: "兴趣方向和成果偏好",
  background: "专业、技能与已有经历",
  goal: "参赛目标",
  difficulty: "难度预期",
  access: "地区与参赛方式",
  feasibility: "时间、团队和资源条件"
};

function strongestDimension(scoreBreakdown: CompetitionScoreBreakdown) {
  return (Object.keys(dimensionLabels) as Array<keyof typeof dimensionLabels>)
    .filter((dimension) => typeof scoreBreakdown[dimension] === "number")
    .sort((left, right) => scoreBreakdown[right]! - scoreBreakdown[left]!)[0] ?? "interest";
}

function weakestDimension(scoreBreakdown: CompetitionScoreBreakdown) {
  return (Object.keys(dimensionLabels) as Array<keyof typeof dimensionLabels>)
    .filter((dimension) => typeof scoreBreakdown[dimension] === "number")
    .sort((left, right) => scoreBreakdown[left]! - scoreBreakdown[right]!)[0] ?? "interest";
}

function fallbackExplanation(
  profile: CompetitionRecommendationProfileV2,
  recommendation: DeterministicCompetitionRecommendation
): CompetitionAiExplanation {
  const strongest = dimensionLabels[strongestDimension(recommendation.scoreBreakdown)];
  const weakest = dimensionLabels[weakestDimension(recommendation.scoreBreakdown)];
  const possibleGap = recommendation.dataNotices[0] ?? `你在${weakest}方面的信息或准备度还可以进一步确认。`;
  const preparationTips = [
    "先查看详情页和官方通知，核对本届资格、赛道与时间。",
    `围绕${profile.goals[0] ?? "目标成果"}整理一份可展示的方案、过程证据和分工说明。`
  ];
  if (profile.constraints.includes("team")) {
    preparationTips.push("尽早确定队友、指导资源与每周推进节奏。");
  }

  return {
    competitionId: recommendation.competitionId,
    explanationSource: "rule",
    matchReasons: [
      `规则评分显示，你的${strongest}与该竞赛更为匹配。`,
      `该项目在本次站内候选中的基础匹配分为 ${recommendation.baseMatchScore} 分。`
    ],
    possibleGaps: [possibleGap],
    preparationTips: preparationTips.slice(0, 3)
  };
}

function acceptedExplanations(
  rawById: Record<string, unknown>,
  expectedIds: readonly string[]
): Map<string, CompetitionRecommendationExplanation> {
  const accepted = new Map<string, CompetitionRecommendationExplanation>();
  for (const competitionId of expectedIds) {
    const parsed = competitionExplanationSchema.safeParse(rawById[competitionId]);
    if (parsed.success) {
      accepted.set(competitionId, parsed.data);
    }
  }
  return accepted;
}

function isRetryableExplanationFailure(reason: AiJsonFailureReason) {
  return [
    "rate_limited",
    "upstream_server_error",
    "timeout",
    "network_error",
    "invalid_json",
    "invalid_output",
    "empty_content",
    "truncated"
  ].includes(reason);
}

function logExplanationOutcome(input: {
  provider: string;
  model: string;
  candidateCount: number;
  fallbackMode: CompetitionRecommendationFallbackMode;
  fallbackReason?: AiJsonFailureReason;
}) {
  const entry = JSON.stringify({
    event: "ai_operation_completed",
    operation: "competition_recommend",
    provider: input.provider,
    model: input.model,
    promptVersion: COMPETITION_EXPLAIN_PROMPT_VERSION,
    candidateCount: input.candidateCount,
    fallbackMode: input.fallbackMode,
    fallbackReason: input.fallbackReason
  });
  if (input.fallbackMode === "none") {
    console.info(entry);
  } else {
    console.warn(entry);
  }
}

function promptRecommendations(recommendations: readonly DeterministicCompetitionRecommendation[]) {
  return recommendations.map((recommendation) => ({
    competitionId: recommendation.competitionId,
    name: recommendation.name,
    category: recommendation.category,
    summary: recommendation.summary,
    baseMatchScore: recommendation.baseMatchScore,
    scoreBreakdown: recommendation.scoreBreakdown,
    registrationStatus: recommendation.registrationStatus,
    dataNotices: recommendation.dataNotices
  }));
}

export async function explainCompetitionRecommendations(
  profile: CompetitionRecommendationProfileV2,
  recommendations: readonly DeterministicCompetitionRecommendation[],
  options: Pick<RequestAiJsonOptions<unknown>, "deadlineEpochMs" | "signal"> = {}
): Promise<CompetitionExplanationResult> {
  const deadlineEpochMs = Number.isFinite(options.deadlineEpochMs)
    ? Math.floor(Number(options.deadlineEpochMs))
    : Date.now() + DEFAULT_AI_REQUEST_DEADLINE_MS;
  const model = getCompetitionExplainModel();
  const provider = getConfiguredAiProvider();
  if (recommendations.length === 0) {
    const result: CompetitionExplanationResult = {
      explanations: [],
      promptVersion: COMPETITION_EXPLAIN_PROMPT_VERSION,
      model,
      provider,
      fallbackUsed: true,
      fallbackMode: "full",
      fallbackReason: "invalid_output"
    };
    logExplanationOutcome({ ...result, candidateCount: 0 });
    return result;
  }

  const providerFailure = getCompetitionAiProviderFailureReason(provider);
  if (providerFailure) {
    const result: CompetitionExplanationResult = {
      explanations: recommendations.map((recommendation) => fallbackExplanation(profile, recommendation)),
      promptVersion: COMPETITION_EXPLAIN_PROMPT_VERSION,
      model: provider === "mock" ? "mock" : model,
      provider,
      fallbackUsed: true,
      fallbackMode: "full",
      fallbackReason: providerFailure
    };
    logExplanationOutcome({ ...result, candidateCount: recommendations.length });
    return result;
  }

  const safeProfile = sanitizeCompetitionProfileForExplanation(profile);
  const expectedIds = recommendations.map((recommendation) => recommendation.competitionId);
  const prompt = await buildPrompt("competition-explain.v3.md", {
    profileJson: JSON.stringify(safeProfile),
    recommendationsJson: JSON.stringify(promptRecommendations(recommendations))
  });
  const requestOptions = {
    model,
    systemPrompt: "Return JSON only. Explain only the server-ranked competition IDs supplied by the user message.",
    temperature: 0,
    maxTokens: 2200,
    maxAttempts: 1 as const,
    schema: explainOutputEnvelopeSchema,
    thinking: "disabled" as const,
    operation: "competition_recommend",
    promptVersion: COMPETITION_EXPLAIN_PROMPT_VERSION,
    candidateCount: recommendations.length,
    deadlineEpochMs,
    signal: options.signal
  };
  const firstResult = await requestAiJson(prompt, requestOptions);
  const accepted = firstResult.ok
    ? acceptedExplanations(firstResult.data.explanationsById, expectedIds)
    : new Map<string, CompetitionRecommendationExplanation>();
  let lastResult = firstResult;
  let pendingIds = expectedIds.filter((competitionId) => !accepted.has(competitionId));

  if (pendingIds.length > 0 && (firstResult.ok || isRetryableExplanationFailure(firstResult.reason))) {
    const retryAllowed = firstResult.ok || await waitForAiRetry(firstResult, requestOptions);
    if (retryAllowed) {
      const pendingSet = new Set(pendingIds);
      const pendingRecommendations = recommendations.filter((recommendation) => pendingSet.has(recommendation.competitionId));
      const retryPrompt = await buildPrompt("competition-explain.v3.md", {
        profileJson: JSON.stringify(safeProfile),
        recommendationsJson: JSON.stringify(promptRecommendations(pendingRecommendations))
      });
      const correctedPrompt = `${retryPrompt}\n\nCorrection: return complete valid explanations only for these IDs: ${pendingIds.join(", ")}.`;
      lastResult = await requestAiJson(correctedPrompt, {
        ...requestOptions,
        candidateCount: pendingRecommendations.length
      });
      if (lastResult.ok) {
        const recovered = acceptedExplanations(lastResult.data.explanationsById, pendingIds);
        for (const [competitionId, explanation] of recovered) {
          accepted.set(competitionId, explanation);
        }
      }
      pendingIds = expectedIds.filter((competitionId) => !accepted.has(competitionId));
    }
  }

  const fallbackMode: CompetitionRecommendationFallbackMode =
    pendingIds.length === 0 ? "none" : accepted.size === 0 ? "full" : "partial";
  const fallbackReason =
    fallbackMode === "none" ? undefined : lastResult.ok ? "invalid_output" : lastResult.reason;
  const explanationById = new Map(
    recommendations.map((recommendation) => [
      recommendation.competitionId,
      accepted.has(recommendation.competitionId)
        ? {
            competitionId: recommendation.competitionId,
            explanationSource: "deepseek" as const,
            ...accepted.get(recommendation.competitionId)!
          }
        : fallbackExplanation(profile, recommendation)
    ])
  );

  const result: CompetitionExplanationResult = {
    explanations: expectedIds.map((competitionId) => explanationById.get(competitionId)!),
    promptVersion: COMPETITION_EXPLAIN_PROMPT_VERSION,
    model: lastResult.model,
    provider,
    fallbackUsed: fallbackMode !== "none",
    fallbackMode,
    fallbackReason
  };
  logExplanationOutcome({ ...result, candidateCount: recommendations.length });
  return result;
}
