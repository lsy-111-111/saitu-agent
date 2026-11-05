import { getConfiguredAiProvider } from "@/lib/ai/ai-client";
import {
  aiConsentRequiredResponse,
  hasValidAiConsent
} from "@/lib/ai/consent";
import {
  COMPETITION_AI_MAX_REQUEST_BYTES,
  competitionAiJson,
  competitionAiRequestErrorResponse,
  noStoreResponse,
  readCompetitionAiJson
} from "@/lib/ai/competition-api";
import {
  buildSignedCompetitionQualificationSnapshot,
  competitionPreferenceQuestionsMatchQualificationSnapshot,
  competitionQualificationSnapshotMatches,
  verifyCompetitionConversationToken
} from "@/lib/ai/competition-conversation-token";
import {
  getCompetitionRecommendModel,
  explainDecisionShortlist
} from "@/lib/ai/competition-ranking";
import { personalizeFixedDecisionExplanations } from "@/lib/ai/competition-decision-explanation";
import { competitionRecommendRequestSchema } from "@/lib/ai/competition-request-schema";
import {
  createCompetitionRequestDeadlines,
  sessionHasRequestBudget
} from "@/lib/ai/request-deadline";
import {
  recordVerifiedRecommendationCompleted
} from "@/lib/analytics/server";
import { getCompetitionCatalog } from "@/lib/competitions/catalog";
import { isCompetitionRecommenderEnabled } from "@/lib/config/features";
import {
  competitionDecisionBasis,
  getCompetitionRecommendationCandidates,
  selectFinalVisibleCompetitionRecommendations
} from "@/lib/competitions/recommendation-engine";
import {
  competitionTransitionId,
  executeCompetitionSessionTransition,
  getRequestId,
  rejectLargeRequest,
  withRequestId
} from "@/lib/security/rate-limit";
import type {
  CompetitionRecommendationResponseV5
} from "@/types/competition-recommendation";
import { COMPETITION_RECOMMENDATION_RESPONSE_VERSION } from "@/types/competition-recommendation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const deadlines = createCompetitionRequestDeadlines();
  const requestId = getRequestId(request);
  const respond = <T extends Response>(response: T) => withRequestId(response, requestId);
  if (!isCompetitionRecommenderEnabled()) {
    return respond(competitionAiJson({ ok: false, error: "COMPETITION_RECOMMENDER_DISABLED" }, { status: 503 }));
  }

  const oversized = rejectLargeRequest(request, COMPETITION_AI_MAX_REQUEST_BYTES);
  if (oversized) return respond(noStoreResponse(oversized));

  const parsedBody = await readCompetitionAiJson(request);
  if (!parsedBody.ok) {
    return respond(competitionAiRequestErrorResponse(parsedBody.error));
  }
  if (!hasValidAiConsent(parsedBody.value)) return respond(noStoreResponse(aiConsentRequiredResponse()));

  const validated = competitionRecommendRequestSchema.safeParse(parsedBody.value);
  if (!validated.success) {
    return respond(competitionAiJson({ ok: false, error: "INVALID_INPUT" }, { status: 400 }));
  }
  const verified = verifyCompetitionConversationToken(validated.data.conversationToken);
  if (!verified.ok) {
    if (verified.reason === "policy_changed") {
      return respond(competitionAiJson(
        { ok: false, error: "CONVERSATION_POLICY_CHANGED" },
        { status: 409 }
      ));
    }
    return respond(competitionAiJson(
      { ok: false, error: verified.reason === "expired_token" ? "CONVERSATION_EXPIRED" : "INVALID_CONVERSATION_TOKEN" },
      { status: 400 }
    ));
  }
  if (!verified.payload.completed || verified.payload.pendingQuestion) {
    return respond(competitionAiJson({ ok: false, error: "CONVERSATION_NOT_COMPLETED" }, { status: 409 }));
  }
  if (!sessionHasRequestBudget(verified.payload.expiresAt, deadlines)) {
    return respond(competitionAiJson(
      { ok: false, error: "CONVERSATION_EXPIRED" },
      { status: 400 }
    ));
  }
  const qualificationSnapshot = buildSignedCompetitionQualificationSnapshot(
    verified.payload.profile,
    verified.payload.qualificationSnapshot.evaluatedAt
  );
  if (!competitionQualificationSnapshotMatches(
    verified.payload.qualificationSnapshot,
    qualificationSnapshot.snapshot
  )) {
    return respond(competitionAiJson(
      { ok: false, error: "QUALIFICATION_SNAPSHOT_CHANGED" },
      { status: 409 }
    ));
  }
  if (!competitionPreferenceQuestionsMatchQualificationSnapshot(
    qualificationSnapshot.snapshot,
    verified.payload.transcript,
    null
  )) {
    return respond(competitionAiJson(
      { ok: false, error: "INVALID_DYNAMIC_QUESTION" },
      { status: 409 }
    ));
  }

  let committedRecommendation: CompetitionRecommendationResponseV5 | null = null;
  return executeCompetitionSessionTransition({
    request,
    requestId,
    operation: "competition_recommend",
    sessionId: verified.payload.sessionId,
    sessionExpiresAtEpochSeconds: verified.payload.expiresAt,
    transitionId: competitionTransitionId("competition_recommend", validated.data),
    deadlines,
    onOwnerCommitted: async (context) => {
      if (context.status !== 200 || !committedRecommendation) return;
      await recordVerifiedRecommendationCompleted(committedRecommendation, {
        sessionId: verified.payload.sessionId,
        signal: context.signal,
        deadlineEpochMs: context.deadlines.responseDeadlineEpochMs
      });
    },
    producer: async (context) => {
      try {
        const candidates = getCompetitionRecommendationCandidates(verified.payload.profile, {
          now: new Date(verified.payload.qualificationSnapshot.evaluatedAt * 1000),
          transcript: verified.payload.transcript
        });
        const visible = selectFinalVisibleCompetitionRecommendations(candidates.recommendations,
          verified.payload.profile, verified.payload.transcript);
        const explanation = await personalizeFixedDecisionExplanations(
          explainDecisionShortlist(verified.payload.profile, verified.payload.transcript, visible),
          { request, aiConsent: validated.data.aiConsent, deadlineEpochMs: context.deadlines.aiDeadlineEpochMs,
            auditDeadlineEpochMs: context.deadlines.producerDeadlineEpochMs, signal: context.signal }
        );
        const byId = new Map(candidates.recommendations.map(item => [item.competitionId, item]));
        const selected = new Set(visible.map(item => item.competitionId));
        const comparable = new Map(visible.map(item => [competitionDecisionBasis(item),item.name]));
        const audit = new Map(qualificationSnapshot.snapshot.entries.map(item => [item.competitionId, item]));
        function reasonFor(id: string) {
          const candidate = byId.get(id);
          const qualification = audit.get(id);
          if (!candidate && qualification?.status === "ineligible") {
            const reasons: Record<string,string> = {"stage-ineligible":"当前学习阶段与核实的赛道条件冲突。", "major-ineligible":"已确认的专业与官方限制的专业范围不相符。",
              "full-time-status-ineligible":"当前学籍与全日制要求冲突。","enrollment-status-ineligible":"当前身份与在读要求冲突。",
              "team-size-ineligible":"已确定的队伍人数与赛道人数范围冲突。","same-institution-team-ineligible":"已确定的跨校队伍与同校要求冲突。",
              "required-resource-unavailable":"该方向需要你明确无法获得的资源。","first-higher-education-year-ineligible":"首次高等教育年份不符合已核实的条件。"};
            return reasons[qualification.hardFilterReason ?? ""] ?? "各已记录赛道的资格与已确认条件冲突。";
          }
          if (!candidate) return "这项比赛的任务与你明确拒绝的工作或指定赛道条件冲突。";
          if (!candidate.decisionFit?.actionable) return "已比较此项，但你的任务偏好、经历或投入条件尚不足以支持重点推荐。";
          const basis = candidate.decisionFit.evidence.task[0] ?? candidate.decisionFit.evidence.experience[0] ?? "与你的任务偏好存在交集。";
          const similar = comparable.get(competitionDecisionBasis(candidate));
          if (!selected.has(id) && similar) return `你的回答为它与“${similar}”提供了相同的适配依据，可展开比较具体任务。`;
          return selected.has(id) ? basis : `已纳入比较，本轮有其他候选排在前面。${basis}`;
        }
        const response: CompetitionRecommendationResponseV5 = {
          responseVersion: COMPETITION_RECOMMENDATION_RESPONSE_VERSION,
          status: explanation.recommendations.length ? "matched" : "no_match",
          catalogVersion: candidates.catalogVersion, scorerVersion: candidates.scorerVersion,
          ...explanation, rankingSource: "evidence-rules",
          alternatives: candidates.recommendations.filter(item => item.decisionFit?.actionable && !selected.has(item.competitionId))
            .slice(0,7).map(item => ({competitionId:item.competitionId,name:item.name,reason:reasonFor(item.competitionId)})),
          candidateAudit: getCompetitionCatalog().map(item => ({competitionId:item.id,reason:reasonFor(item.id)}))
        };
        committedRecommendation = response;
        console.info(
          JSON.stringify({
            event: "ai_route_completed",
            operation: "competition_recommend",
            provider: response.provider,
            model: response.model,
            promptVersion: response.promptVersion,
            candidateCount: candidates.recommendations.length,
            resultCount: response.recommendations.length,
            rankingSource: response.rankingSource,
            fallbackUsed: response.fallbackUsed,
            fallbackMode: response.fallbackMode,
            fallbackReason: response.fallbackReason,
            requestId,
            outcome: "success"
          })
        );
        return competitionAiJson(response);
      } catch {
        console.error(
          JSON.stringify({
            event: "ai_route_completed",
            operation: "competition_recommend",
            provider: getConfiguredAiProvider(),
            model: getCompetitionRecommendModel(),
            fallbackReason: "internal_error",
            requestId,
            outcome: "failure"
          })
        );
        return competitionAiJson(
          { ok: false, error: "COMPETITION_RECOMMENDATION_FAILED" },
          { status: 500 }
        );
      }
    }
  });
}
