import { z } from "zod";
import { getConfiguredAiProvider } from "@/lib/ai/ai-client";
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
  COMPETITION_NORMALIZE_PROMPT_VERSION,
  confirmCompetitionQuestionnaire,
  createCompetitionQuestionnaireToken,
  enhanceCompetitionQuestionnaireWithAi,
  getCompetitionNormalizeModel,
  normalizeCompetitionQuestionnaire,
  questionnaireInterpretationsForClient,
  competitionQuestionnaireConfirmationSchema,
  competitionQuestionnaireV1Schema,
  verifyCompetitionQuestionnaireToken
} from "@/lib/ai/competition-questionnaire";
import { aiConsentSchema } from "@/lib/ai/competition-request-schema";
import { canonicalizeKeyedSelections } from "@/lib/ai/competition-transition-canonicalization";
import {
  createCompetitionRequestDeadlines,
  sessionHasRequestBudget
} from "@/lib/ai/request-deadline";
import { isCompetitionRecommenderEnabled } from "@/lib/config/features";
import {
  competitionTransitionId,
  executeCompetitionSessionStart,
  executeCompetitionSessionTransition,
  getRequestId,
  rejectLargeRequest,
  withRequestId,
  type CompetitionProducerContext
} from "@/lib/security/rate-limit";
import { COMPETITION_QUESTIONNAIRE_FIELD_IDS } from "@/types/competition-recommendation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normalizeRequestSchema = z.object({
  aiConsent: aiConsentSchema,
  questionnaire: competitionQuestionnaireV1Schema
}).strict();

const confirmRequestSchema = z.object({
  aiConsent: aiConsentSchema,
  questionnaireToken: z.string().min(32).max(48 * 1024),
  confirmations: z.array(competitionQuestionnaireConfirmationSchema)
    .max(COMPETITION_QUESTIONNAIRE_FIELD_IDS.length)
    .refine(
      (confirmations) => new Set(confirmations.map(({ fieldId }) => fieldId)).size === confirmations.length,
      "Confirmation fields must be unique"
    )
}).strict();

const requestSchema = z.union([normalizeRequestSchema, confirmRequestSchema]);
type NormalizeRequest = z.infer<typeof requestSchema>;

function tokenError(reason: "missing_secret" | "invalid_token" | "expired_token") {
  return competitionAiJson(
    { ok: false, error: reason === "expired_token" ? "QUESTIONNAIRE_EXPIRED" : "INVALID_QUESTIONNAIRE_TOKEN" },
    { status: 400 }
  );
}

async function handleNormalizeRequest(
  request: Request,
  data: NormalizeRequest,
  context: CompetitionProducerContext
) {
  try {
    if ("questionnaire" in data) {
      const normalized = normalizeCompetitionQuestionnaire(data.questionnaire);
      if (!normalized.ok) return competitionAiJson({ ok: false, error: "INVALID_QUESTIONNAIRE" }, { status: 400 });
      const enhanced = await enhanceCompetitionQuestionnaireWithAi(
        normalized.questionnaire,
        normalized.interpretations,
        {
          deadlineEpochMs: context.deadlines.aiDeadlineEpochMs,
          signal: context.signal
        }
      );
      await recordAiConsent(request, "competition_normalize", competitionAiConsentAuditTarget({
        provider: enhanced.provider,
        model: enhanced.model,
        upstreamAttempted: enhanced.upstreamAttempted
      }, COMPETITION_NORMALIZE_PROMPT_VERSION), {
        deadlineEpochMs: context.deadlines.producerDeadlineEpochMs,
        signal: context.signal
      });
      const requiresConfirmation = enhanced.interpretations.some(({ requiresConfirmation }) => requiresConfirmation);
      if (!requiresConfirmation) {
        const confirmed = confirmCompetitionQuestionnaire(enhanced.interpretations, [], data.questionnaire.decisionContext);
        if (!confirmed.ok) return competitionAiJson({ ok: false, error: "NORMALIZATION_FAILED" }, { status: 422 });
        const questionnaireToken = createCompetitionQuestionnaireToken({
          decisionContext: data.questionnaire.decisionContext,
          rawAnswerContext: normalized.questionnaire.answers,
          interpretations: enhanced.interpretations,
          profile: confirmed.profile,
          confirmed: true
        });
        return competitionAiJson({
          ok: true,
          status: "confirmed",
          profile: confirmed.profile,
          questionnaireToken,
          interpretations: questionnaireInterpretationsForClient(enhanced.interpretations, normalized.questionnaire.answers),
          promptVersion: COMPETITION_NORMALIZE_PROMPT_VERSION,
          provider: enhanced.provider,
          model: enhanced.model,
          aiUsed: enhanced.aiUsed
        });
      }
      const questionnaireToken = createCompetitionQuestionnaireToken({
        decisionContext: data.questionnaire.decisionContext,
          rawAnswerContext: normalized.questionnaire.answers,
        interpretations: enhanced.interpretations,
        profile: null,
        confirmed: false
      });
      const response = competitionAiJson({
        ok: true,
        status: "needs_confirmation",
        questionnaireToken,
        interpretations: questionnaireInterpretationsForClient(enhanced.interpretations, normalized.questionnaire.answers),
        promptVersion: COMPETITION_NORMALIZE_PROMPT_VERSION,
        provider: enhanced.provider,
        model: enhanced.model,
        aiUsed: enhanced.aiUsed,
        ...(enhanced.failureReason ? { fallbackReason: enhanced.failureReason } : {})
      });
      if (enhanced.failureReason) response.headers.set("X-Idempotency-Cache", "no-store");
      return response;
    }

    const verified = verifyCompetitionQuestionnaireToken(data.questionnaireToken);
    if (!verified.ok) return tokenError(verified.reason);
    if (verified.payload.confirmed || verified.payload.profile) {
      return competitionAiJson({ ok: false, error: "QUESTIONNAIRE_ALREADY_CONFIRMED" }, { status: 409 });
    }
    const confirmed = confirmCompetitionQuestionnaire(verified.payload.interpretations, data.confirmations, verified.payload.decisionContext);
    if (!confirmed.ok) return competitionAiJson({ ok: false, error: "INVALID_CONFIRMATION" }, { status: 400 });
    await recordAiConsent(request, "competition_normalize", {
      provider: "server",
      model: COMPETITION_NORMALIZE_PROMPT_VERSION
    }, {
      deadlineEpochMs: context.deadlines.producerDeadlineEpochMs,
      signal: context.signal
    });
    const questionnaireToken = createCompetitionQuestionnaireToken({
      decisionContext: verified.payload.decisionContext,
      rawAnswerContext: verified.payload.rawAnswerContext,
      interpretations: verified.payload.interpretations,
      profile: confirmed.profile,
      confirmed: true,
      sessionId: verified.payload.sessionId
    }, new Date(verified.payload.issuedAt * 1000));
    return competitionAiJson({
      ok: true,
      status: "confirmed",
      profile: confirmed.profile,
      questionnaireToken,
      interpretations: questionnaireInterpretationsForClient(verified.payload.interpretations, verified.payload.rawAnswerContext),
      promptVersion: COMPETITION_NORMALIZE_PROMPT_VERSION,
      provider: getConfiguredAiProvider(),
      model: getCompetitionNormalizeModel(),
      aiUsed: verified.payload.interpretations.some(({ source }) => source === "model")
    });
  } catch {
    return competitionAiJson({ ok: false, error: "COMPETITION_NORMALIZATION_FAILED" }, { status: 500 });
  }
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
  if (!parsedBody.ok) {
    return respond(competitionAiRequestErrorResponse(parsedBody.error));
  }
  if (!hasValidAiConsent(parsedBody.value)) return respond(noStoreResponse(aiConsentRequiredResponse()));
  const validated = requestSchema.safeParse(parsedBody.value);
  if (!validated.success) {
    return respond(competitionAiJson({ ok: false, error: "INVALID_INPUT" }, { status: 400 }));
  }

  const transitionValue = "confirmations" in validated.data
    ? {
        ...validated.data,
        confirmations: canonicalizeKeyedSelections(
          validated.data.confirmations,
          "values"
        )
      }
    : {
        ...validated.data,
        questionnaire: {
          ...validated.data.questionnaire,
          answers: canonicalizeKeyedSelections(
            validated.data.questionnaire.answers,
            "selectedValues"
          )
        }
      };
  const transitionId = competitionTransitionId("competition_normalize", transitionValue);
  if ("questionnaire" in validated.data) {
    return executeCompetitionSessionStart({
      request,
      requestId,
      operation: "competition_normalize",
      transitionId,
      deadlines,
      producer: (context) => handleNormalizeRequest(request, validated.data, context)
    });
  }

  const verified = verifyCompetitionQuestionnaireToken(validated.data.questionnaireToken);
  if (!verified.ok) return respond(tokenError(verified.reason));
  if (!sessionHasRequestBudget(verified.payload.expiresAt, deadlines)) {
    return respond(tokenError("expired_token"));
  }
  return executeCompetitionSessionTransition({
    request,
    requestId,
    operation: "competition_normalize_confirmation",
    sessionId: verified.payload.sessionId,
    sessionExpiresAtEpochSeconds: verified.payload.expiresAt,
    transitionId,
    deadlines,
    producer: (context) => handleNormalizeRequest(request, validated.data, context)
  });
}
