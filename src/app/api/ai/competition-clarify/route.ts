import {
  aiConsentRequiredResponse,
  competitionAiConsentAuditTarget,
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
  COMPETITION_CLARIFY_PROMPT_VERSION,
  generateNextCompetitionQuestion,
  getCompetitionClarifyModel
} from "@/lib/ai/competition-clarify";
import {
  buildSignedCompetitionQualificationSnapshot,
  competitionPreferenceQuestionsMatchQualificationSnapshot,
  competitionQualificationSnapshotMatches,
  createCompetitionConversationToken,
  verifyCompetitionConversationToken,
  type CompetitionQualificationSnapshotSummaryV1
} from "@/lib/ai/competition-conversation-token";
import {
  MAX_COMPETITION_DYNAMIC_QUESTIONS,
  enhanceCompetitionDynamicFreeTextWithAi,
  parseCompetitionDynamicAnswer
} from "@/lib/ai/competition-dynamic-question";
import {
  verifyCompetitionQuestionnaireToken,
  type CompetitionNormalizedQuestionnaireAnswerV1
} from "@/lib/ai/competition-questionnaire";
import { competitionClarifyRequestSchema } from "@/lib/ai/competition-request-schema";
import { canonicalizeCompetitionClarifyTransition } from "@/lib/ai/competition-transition-canonicalization";
import {
  createCompetitionRequestDeadlines,
  sessionHasRequestBudget
} from "@/lib/ai/request-deadline";
import { isCompetitionRecommenderEnabled } from "@/lib/config/features";
import { getCompetitionRecommendationCandidates } from "@/lib/competitions/recommendation-engine";
import {
  competitionTransitionId,
  executeCompetitionSessionTransition,
  getRequestId,
  rejectLargeRequest,
  withRequestId
} from "@/lib/security/rate-limit";
import type {
  CompetitionDynamicExchangeV3,
  CompetitionRecommendationProfileV5
} from "@/types/competition-recommendation";
import { COMPETITION_CLARIFICATION_RESPONSE_VERSION } from "@/types/competition-recommendation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function conversationTokenError(reason: "missing_secret" | "invalid_token" | "expired_token" | "policy_changed") {
  if (reason === "policy_changed") {
    return competitionAiJson({ ok: false, error: "CONVERSATION_POLICY_CHANGED" }, { status: 409 });
  }
  return competitionAiJson(
    { ok: false, error: reason === "expired_token" ? "CONVERSATION_EXPIRED" : "INVALID_CONVERSATION_TOKEN" },
    { status: 400 }
  );
}

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
  if (!parsedBody.ok) return respond(competitionAiRequestErrorResponse(parsedBody.error));
  if (!hasValidAiConsent(parsedBody.value)) return respond(noStoreResponse(aiConsentRequiredResponse()));
  const validated = competitionClarifyRequestSchema.safeParse(parsedBody.value);
  if (!validated.success) {
    return respond(competitionAiJson({ ok: false, error: "INVALID_INPUT" }, { status: 400 }));
  }

  const recentSignalKeys = validated.data.recentSignalKeys ?? [];
  const transitionId = competitionTransitionId(
    "competition_clarify",
    canonicalizeCompetitionClarifyTransition(validated.data)
  );
  let sessionId: string;
  let sessionExpiresAtEpochSeconds: number;
  let tokenProfile: CompetitionRecommendationProfileV5;
  let rawAnswerContext: CompetitionNormalizedQuestionnaireAnswerV1[];
  let transcript: CompetitionDynamicExchangeV3[];
  let qualificationSnapshotSummary: CompetitionQualificationSnapshotSummaryV1;
  let qualificationSnapshot: ReturnType<typeof buildSignedCompetitionQualificationSnapshot>["snapshot"];
  let pendingTextAnswer: CompetitionDynamicExchangeV3 | null = null;

  if ("questionnaireToken" in validated.data) {
    const verified = verifyCompetitionQuestionnaireToken(validated.data.questionnaireToken);
    if (!verified.ok) {
      return respond(competitionAiJson(
        { ok: false, error: verified.reason === "expired_token" ? "QUESTIONNAIRE_EXPIRED" : "INVALID_QUESTIONNAIRE_TOKEN" },
        { status: 400 }
      ));
    }
    if (!verified.payload.confirmed || !verified.payload.profile) {
      return respond(competitionAiJson({ ok: false, error: "QUESTIONNAIRE_NOT_CONFIRMED" }, { status: 409 }));
    }
    if (!sessionHasRequestBudget(verified.payload.expiresAt, deadlines)) {
      return respond(competitionAiJson(
        { ok: false, error: "QUESTIONNAIRE_EXPIRED" },
        { status: 400 }
      ));
    }
    sessionId = verified.payload.sessionId;
    sessionExpiresAtEpochSeconds = verified.payload.expiresAt;
    tokenProfile = verified.payload.profile;
    rawAnswerContext = verified.payload.rawAnswerContext;
    transcript = [];
    const frozen = buildSignedCompetitionQualificationSnapshot(
      tokenProfile,
      verified.payload.issuedAt
    );
    qualificationSnapshot = frozen.snapshot;
    qualificationSnapshotSummary = frozen.summary;
  } else {
    const verified = verifyCompetitionConversationToken(validated.data.conversationToken);
    if (!verified.ok) return respond(conversationTokenError(verified.reason));
    if (!sessionHasRequestBudget(verified.payload.expiresAt, deadlines)) {
      return respond(conversationTokenError("expired_token"));
    }
    sessionId = verified.payload.sessionId;
    sessionExpiresAtEpochSeconds = verified.payload.expiresAt;
    tokenProfile = verified.payload.profile;
    rawAnswerContext = verified.payload.rawAnswerContext;
    transcript = [...verified.payload.transcript];
    qualificationSnapshotSummary = verified.payload.qualificationSnapshot;
    const frozen = buildSignedCompetitionQualificationSnapshot(
      tokenProfile,
      qualificationSnapshotSummary.evaluatedAt
    );
    qualificationSnapshot = frozen.snapshot;
    if (!competitionQualificationSnapshotMatches(qualificationSnapshotSummary, qualificationSnapshot)) {
      return respond(competitionAiJson({ ok: false, error: "QUALIFICATION_SNAPSHOT_CHANGED" }, { status: 409 }));
    }
    if (!competitionPreferenceQuestionsMatchQualificationSnapshot(
      qualificationSnapshot,
      transcript,
      verified.payload.pendingQuestion
    )) {
      return respond(competitionAiJson({ ok: false, error: "INVALID_DYNAMIC_QUESTION" }, { status: 409 }));
    }

    if ("action" in validated.data) {
      if (verified.payload.completed || !verified.payload.pendingQuestion) {
        return respond(competitionAiJson({ ok: false, error: "CONVERSATION_ALREADY_COMPLETED" }, { status: 409 }));
      }
      if (verified.payload.pendingQuestion.impact !== "optional") {
        return respond(competitionAiJson({ ok: false, error: "OPTIONAL_SKIP_NOT_ALLOWED" }, { status: 409 }));
      }
      return executeCompetitionSessionTransition({
        request,
        requestId,
        operation: "competition_clarify",
        sessionId,
        sessionExpiresAtEpochSeconds,
        transitionId,
        deadlines,
        producer: async () => {
          const conversationToken = createCompetitionConversationToken({
            profile: tokenProfile,
            rawAnswerContext,
            qualificationSnapshot: qualificationSnapshotSummary,
            sessionId,
            transcript,
            pendingQuestion: null,
            completed: true
          }, new Date(qualificationSnapshotSummary.evaluatedAt * 1000));
          return competitionAiJson({
            ok: true,
            responseVersion: COMPETITION_CLARIFICATION_RESPONSE_VERSION,
            status: "completed",
            nextQuestion: null,
            conversationToken,
            askedQuestionCount: transcript.length,
            promptVersion: COMPETITION_CLARIFY_PROMPT_VERSION,
            provider: "server",
            model: getCompetitionClarifyModel(),
            fallback: false
          });
        }
      });
    }

    if (verified.payload.completed || !verified.payload.pendingQuestion) {
      return respond(competitionAiJson({ ok: false, error: "CONVERSATION_ALREADY_COMPLETED" }, { status: 409 }));
    }
    const answer = parseCompetitionDynamicAnswer(verified.payload.pendingQuestion, validated.data.answer);
    if (!answer) return respond(competitionAiJson({ ok: false, error: "INVALID_DYNAMIC_ANSWER" }, { status: 400 }));
    if (
      answer.note &&
      answer.selectedValues.length === 0 &&
      !validated.data.interpretationConfirmed
    ) {
      pendingTextAnswer = { question: verified.payload.pendingQuestion, answer };
    } else {
      // Once the user explicitly confirms a whitelist value, the original
      // note is no longer model evidence and must not trigger interpretation
      // again or enter the signed preference transcript.
      transcript.push({
        question: verified.payload.pendingQuestion,
        answer: { selectedValues: answer.selectedValues }
      });
    }
  }

  return executeCompetitionSessionTransition({
    request,
    requestId,
    operation: "competition_clarify",
    sessionId,
    sessionExpiresAtEpochSeconds,
    transitionId,
    deadlines,
    producer: async (context) => {
      try {
        let consentRecorded = false;
        if (pendingTextAnswer?.answer.note) {
          const interpretation = await enhanceCompetitionDynamicFreeTextWithAi(
            pendingTextAnswer.question,
            pendingTextAnswer.answer.note,
            pendingTextAnswer.answer.selectedValues,
            {
              deadlineEpochMs: context.deadlines.aiDeadlineEpochMs,
              signal: context.signal
            }
          );
          await recordAiConsent(
            request,
            "competition_clarify",
            competitionAiConsentAuditTarget({
              provider: interpretation.provider,
              model: interpretation.model,
              upstreamAttempted: interpretation.upstreamAttempted
            }, getCompetitionClarifyModel()),
            {
              deadlineEpochMs: context.deadlines.producerDeadlineEpochMs,
              signal: context.signal
            }
          );
          consentRecorded = true;
          const selected = pendingTextAnswer.answer.selectedValues;
          const matchesSelection =
            interpretation.suggestedValues.length === selected.length &&
            interpretation.suggestedValues.every((value) => selected.includes(value));
          if (interpretation.status !== "ready" || !matchesSelection) {
            const {
              provider: _provider,
              model: _model,
              aiUsed: _aiUsed,
              upstreamAttempted: _upstreamAttempted,
              failureReason: _failureReason,
              ...clientInterpretation
            } = interpretation;
            const response = competitionAiJson({
              ok: true,
              status: "needs_confirmation",
              interpretationRequired: true,
              interpretation: clientInterpretation
            });
            if (interpretation.failureReason) {
              response.headers.set("X-Idempotency-Cache", "no-store");
            }
            return response;
          }
          transcript.push({
            question: pendingTextAnswer.question,
            answer: { selectedValues: pendingTextAnswer.answer.selectedValues }
          });
        }

        if (!consentRecorded) {
          await recordAiConsent(request, "competition_clarify", {
            provider: "server",
            model: getCompetitionClarifyModel()
          }, {
            deadlineEpochMs: context.deadlines.producerDeadlineEpochMs,
            signal: context.signal
          });
        }

        const candidates = getCompetitionRecommendationCandidates(tokenProfile, {
          transcript,
          now: new Date(qualificationSnapshotSummary.evaluatedAt * 1000)
        });
        const answeredOptional = transcript.some(({ question }) => question.impact === "optional");
        const result = answeredOptional
          ? {
              ok: true as const,
              responseVersion: COMPETITION_CLARIFICATION_RESPONSE_VERSION,
              status: "completed" as const,
              nextQuestion: null,
              promptVersion: COMPETITION_CLARIFY_PROMPT_VERSION,
              model: getCompetitionClarifyModel(),
              provider: "server" as const,
              fallback: false as const
            }
          : await generateNextCompetitionQuestion(
              tokenProfile,
              transcript,
              candidates.recommendations,
              recentSignalKeys,
              qualificationSnapshot,
              { now: new Date(qualificationSnapshotSummary.evaluatedAt * 1000) }
            );
        const nextQuestion = transcript.length >= MAX_COMPETITION_DYNAMIC_QUESTIONS
          ? null
          : result.nextQuestion;
        const status = nextQuestion === null ? "completed" : result.status;
        const conversationToken = createCompetitionConversationToken({
          profile: tokenProfile,
          rawAnswerContext,
          qualificationSnapshot: qualificationSnapshotSummary,
          sessionId,
          transcript,
          pendingQuestion: nextQuestion,
          completed: nextQuestion === null
        }, new Date(qualificationSnapshotSummary.evaluatedAt * 1000));
        const response = {
          ...result,
          status,
          nextQuestion,
          conversationToken,
          askedQuestionCount: transcript.length
        };
        console.info(JSON.stringify({
          event: "ai_route_completed",
          operation: "competition_clarify",
          provider: response.provider,
          model: response.model,
          promptVersion: response.promptVersion,
          status: response.status,
          askedQuestionCount: response.askedQuestionCount,
          hasNextQuestion: response.nextQuestion !== null,
          requestId,
          outcome: "success"
        }));
        return competitionAiJson(response);
      } catch {
        console.error(JSON.stringify({
          event: "ai_route_completed",
          operation: "competition_clarify",
          provider: "server",
          model: getCompetitionClarifyModel(),
          fallbackReason: "internal_error",
          requestId,
          outcome: "failure"
        }));
        return competitionAiJson(
          { ok: false, error: "COMPETITION_CLARIFICATION_FAILED" },
          { status: 500 }
        );
      }
    }
  });
}
