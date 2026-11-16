import { currentDecisionPublicationBinding } from "@/lib/competitions/v6/publication-binding";
import { presentPublishedDecisionAsV5, isPublishedLegacyResponseCurrent, LEGACY_PUBLICATION_ADAPTER_VERSION } from "@/lib/competitions/v6/legacy-presentation";
import {currentDecisionCatalogVersion} from "@/lib/competitions/v6/catalog-binding";
import { createHash } from "node:crypto";
import { mergeQuestionnaireEdits, projectProfileToLegacy } from "@/lib/competitions/v6/profile";
import { initializeDecisionState, readDecisionState, verifyDecisionToken, createDecisionToken, compareAndSwapDecisionState, type DecisionState } from "@/lib/competitions/v6/decision-state";
import { getAiConfigurationFingerprint } from "@/lib/ai/ai-client";
import { getConfiguredAiProvider } from "@/lib/ai/ai-client";
import {
  aiConsentRequiredResponse,
  hasValidAiConsent,
  recordAiConsent
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
  getCompetitionRecommendModel
} from "@/lib/ai/competition-ranking";
import { competitionRecommendRequestSchema } from "@/lib/ai/competition-request-schema";
import {
  createCompetitionRequestDeadlines,
  capDecisionRequestDeadlines,
  sessionHasRequestBudget
} from "@/lib/ai/request-deadline";
import {
  recordVerifiedRecommendationCompleted
} from "@/lib/analytics/server";
import { isCompetitionRecommenderEnabled } from "@/lib/config/features";
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
import { DECISION_RESPONSE_VERSION, DECISION_ENGINE_VERSION, type DecisionReportV6 } from "@/lib/competitions/v6/contracts";
import { buildDecisionContext } from "@/lib/competitions/v6/engine";
import { DECISION_MATCH_PROMPT_VERSION, runDecisionRecommendation } from "@/lib/competitions/v6/model";
import { withRecommendationAccountingTrace } from "@/lib/ai/product-observation";
import { RECOMMENDATION_RESPONSE_VERSION } from "@/lib/competitions/v7/contracts";
import { recommendV7 } from "@/lib/competitions/v7/recommend-api";
import { readSubmissionTimingV7 } from "@/lib/competitions/v7/submission-timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try { readSubmissionTimingV7(request); }
  catch { return withRequestId(competitionAiJson({ok:false,error:"DECISION_TIMING_INVALID"},{status:400}),requestId); }
  return withRecommendationAccountingTrace(requestId,()=>recommend(request,requestId));
}

async function recommend(request:Request,requestId:string) {
  let deadlines = createCompetitionRequestDeadlines();
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
  if (validated.data.reportVersion === DECISION_RESPONSE_VERSION) {
    deadlines = capDecisionRequestDeadlines(deadlines);
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
  if(validated.data.reportVersion===RECOMMENDATION_RESPONSE_VERSION)return recommendV7(request,requestId,validated.data,verified.payload);
  if (!sessionHasRequestBudget(verified.payload.expiresAt, deadlines)) {
    return respond(competitionAiJson(
      { ok: false, error: "CONVERSATION_EXPIRED" },
      { status: 400 }
    ));
  }
  const publicationBinding = currentDecisionPublicationBinding();
  const qualificationSnapshot = buildSignedCompetitionQualificationSnapshot(
    verified.payload.profile,
    verified.payload.qualificationSnapshot.evaluatedAt
  );
  if (!competitionQualificationSnapshotMatches(
    verified.payload.qualificationSnapshot,
    qualificationSnapshot.snapshot
  ) || publicationBinding !== currentDecisionPublicationBinding()) {
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
  let committedDecision: DecisionReportV6 | null = null;
  let editingState: DecisionState | null = null;
  let effectiveLegacy = verified.payload.profile;
  let editedProfile;
  const editKey = createHash("sha256").update(JSON.stringify(validated.data)).digest("hex");
  if (validated.data.decisionEdit) {
    if(validated.data.reportVersion!==DECISION_RESPONSE_VERSION)return respond(competitionAiJson({ok:false,error:"INVALID_INPUT"},{status:400}));
    const edit=validated.data.decisionEdit, token=verifyDecisionToken(edit.decisionToken);
    if(!token)return respond(competitionAiJson({ok:false,error:"DECISION_SESSION_EXPIRED"},{status:401}));
    try {
      editingState=await readDecisionState(token.id);
      if(!editingState||editingState.sessionId!==token.sessionId)return respond(competitionAiJson({ok:false,error:"DECISION_SESSION_EXPIRED"},{status:401}));
      if(editingState.report.catalogVersion!==currentDecisionCatalogVersion())return respond(competitionAiJson({ok:false,error:"DECISION_CATALOG_CHANGED",message:"赛事资料已经更新，请重新生成报告。"},{status:409}));
      if(editingState.lastQuestionnaireEdit===editKey)return respond(competitionAiJson({responseVersion:DECISION_RESPONSE_VERSION,report:editingState.report,decisionToken:createDecisionToken(editingState)}));
      if(editingState.generation!==token.generation||editingState.report.profile.revision!==edit.expectedRevision)return respond(competitionAiJson({ok:false,error:"DECISION_REVISION_CHANGED"},{status:409}));
      editedProfile=mergeQuestionnaireEdits(editingState.report.profile,verified.payload.profile,edit.changedFields,{answerId:`questionnaire-edit-${editKey.slice(0,24)}`,at:new Date().toISOString(),answerContext:verified.payload.rawAnswerContext});
      effectiveLegacy=projectProfileToLegacy(editedProfile,verified.payload.profile);
    } catch {return respond(competitionAiJson({ok:false,error:"DECISION_EDIT_UNAVAILABLE"},{status:409}));}
  }
  const isV6 = validated.data.reportVersion === DECISION_RESPONSE_VERSION;
  const decisionContext = buildDecisionContext(effectiveLegacy, {
        ...(isV6 ? {} : { qualificationSource: "record_only" as const }),
        profile:editedProfile, questionHistory:editingState?.questionHistory,
        now: new Date(verified.payload.qualificationSnapshot.evaluatedAt * 1000),
        transcript: verified.payload.transcript,
        profileId: verified.payload.sessionId,
        answerContext: verified.payload.rawAnswerContext, answeredAt: new Date(verified.payload.issuedAt * 1000).toISOString()
      });
  const decisionMethod = process.env.SAITU_DECISION_STRATEGY === "llm" ? "llm" : "rules";
  const response = await executeCompetitionSessionTransition({
    request,
    requestId,
    operation: "competition_recommend",
    sessionId: verified.payload.sessionId,
    sessionExpiresAtEpochSeconds: verified.payload.expiresAt,
    transitionId: competitionTransitionId("competition_recommend", {
      ...validated.data, profileRevision: decisionContext.profile.revision,
      catalogVersion: decisionContext.catalogVersion, engineVersion: DECISION_ENGINE_VERSION,
      method: isV6 ? decisionMethod : "rules", model: isV6 ? getCompetitionRecommendModel() : "server",
      configuration: isV6 ? getAiConfigurationFingerprint() : LEGACY_PUBLICATION_ADAPTER_VERSION,
      ...(isV6 && decisionMethod === "llm" ? { matchPromptVersion: DECISION_MATCH_PROMPT_VERSION } : {}),
      publicationBinding
    }),
    deadlines,
    onOwnerCommitted: async (context) => {
      if (context.status === 200 && committedDecision) {
        console.info(JSON.stringify({event:"decision_v6_completed",...committedDecision.trace,
          resultCount:committedDecision.recommendations.length,fallbackUsed:committedDecision.fallback.used,
          fallbackReason:committedDecision.fallback.reason,requestId}));
        return;
      }
      if (context.status !== 200 || !committedRecommendation) return;
      await recordVerifiedRecommendationCompleted(committedRecommendation, {
        sessionId: verified.payload.sessionId,
        signal: context.signal,
        deadlineEpochMs: context.deadlines.responseDeadlineEpochMs
      });
    },
    producer: async (context) => {
      try {
        if (isV6) {
          let auditRecorded = false;
          committedDecision = await runDecisionRecommendation(effectiveLegacy, {
            context: decisionContext, method: decisionMethod, requestId,
            deadlineEpochMs: Math.min(context.deadlines.aiDeadlineEpochMs, deadlines.startedAtEpochMs + 40_000),
            signal: context.signal,
            onUpstreamAttempt: async (model) => {
              if (auditRecorded) return;
              auditRecorded = true;
              await recordAiConsent(request,"competition_recommend",{provider:getConfiguredAiProvider(),model},
                {deadlineEpochMs:context.deadlines.producerDeadlineEpochMs,signal:context.signal});
            }
          });
          if(editingState){
            const next={...editingState,generation:editingState.generation+1,legacy:effectiveLegacy,report:committedDecision,proposal:null,history:[],historyRevision:committedDecision.profile.revision,lastQuestionnaireEdit:editKey,lastRequestId:undefined,lastRequestHash:undefined,lastReply:undefined};
            if(context.signal.aborted||Date.now()>=context.deadlines.producerDeadlineEpochMs)return competitionAiJson({ok:false,error:"DECISION_TIMEOUT"},{status:503});
            if(!await compareAndSwapDecisionState(next,editingState.generation,{signal:context.signal,expectedCatalogVersion:editingState.report.catalogVersion}))return competitionAiJson({ok:false,error:"DECISION_REVISION_CHANGED"},{status:409});
            return competitionAiJson({responseVersion:DECISION_RESPONSE_VERSION,report:next.report,decisionToken:createDecisionToken(next)});
          }
          if(committedDecision.catalogVersion!==currentDecisionCatalogVersion())return competitionAiJson({ok:false,error:"DECISION_CATALOG_CHANGED"},{status:409});
          const decisionSession = await initializeDecisionState({ sessionId: verified.payload.sessionId,
            expiresAt: verified.payload.expiresAt * 1000, legacy: verified.payload.profile, report: committedDecision });
          committedDecision = decisionSession.report;
          return competitionAiJson({responseVersion:DECISION_RESPONSE_VERSION,...decisionSession});
        }
        const legacyResponse = presentPublishedDecisionAsV5(decisionContext);
        if (publicationBinding !== currentDecisionPublicationBinding())
          return competitionAiJson({ ok: false, error: "QUALIFICATION_SNAPSHOT_CHANGED" }, { status: 409 });
        committedRecommendation = legacyResponse;
        console.info(JSON.stringify({ event: "ai_route_completed", operation: "competition_recommend",
          provider: legacyResponse.provider, model: legacyResponse.model, promptVersion: legacyResponse.promptVersion,
          candidateCount: decisionContext.candidates.length, resultCount: legacyResponse.recommendations.length,
          rankingSource: legacyResponse.rankingSource, fallbackUsed: false, fallbackMode: "none", requestId, outcome: "success" }));
        return competitionAiJson(legacyResponse);
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
  if (!isV6 && response.status === 200) {
    let current = false;
    try { current = isPublishedLegacyResponseCurrent(await response.clone().json()); } catch { /* Fail closed on an unreadable cached body. */ }
    if (!current) return respond(competitionAiJson({ ok: false, error: "QUALIFICATION_SNAPSHOT_CHANGED" }, { status: 409 }));
  }
  // Covers cached responses as well as producer results. A changed publication
  // cannot be replayed merely because this request entered under the old key.
  if (!isV6 && publicationBinding !== currentDecisionPublicationBinding())
    return respond(competitionAiJson({ ok: false, error: "QUALIFICATION_SNAPSHOT_CHANGED" }, { status: 409 }));
  return response;
}
