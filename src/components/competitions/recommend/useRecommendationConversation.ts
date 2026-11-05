"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyFieldAnswer,
  decisionQuestionTurns,
  fixedQuestionTurns,
  hasDecisionAnswer,
  type SelectionDepth,
  type DecisionContext,
  getFieldAnswer,
  normalizeMultipleAnswer,
  toCompetitionQuestionnaireDraft,
  type DraftCompetitionProfile,
  type FixedQuestionField,
  type FixedQuestionFieldId,
  type FixedQuestionTextAnswers
} from "@/components/competitions/recommend/questionFlow";
import type { QuestionnaireInterpretationReviewItem } from "@/components/competitions/recommend/QuestionnaireInterpretationReview";
import {
  COMPETITION_ANSWER_TEXT_MAX_LENGTH,
  isCompetitionAnswerTextValid
} from "@/components/competitions/recommend/answerText";
import {
  isDynamicAnswerConfirmationResolved,
  normalizeDynamicAnswerConfirmationValues,
  parseDynamicAnswerConfirmation,
  type DynamicAnswerConfirmation
} from "@/components/competitions/recommend/dynamicAnswerConfirmation";
import {
  parseAiConsentDisclosureV1,
  type AiConsentDisclosureV1
} from "@/lib/ai/client-consent";
import { trackEvent } from "@/lib/analytics/track";
import {
  competitionDynamicQuestionFamilyV3,
  competitionDynamicQuestionV3Schema,
  competitionDynamicSignalKeyV3Schema,
  parseCompetitionRecommendationResponseV5
} from "@/lib/competitions/recommendation-runtime-schema";
import {
  COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH,
  COMPETITION_CLARIFICATION_RESPONSE_VERSION,
  type CompetitionClarificationAnswer,
  type CompetitionClarificationAnswers,
  type CompetitionDynamicQuestionV3,
  type CompetitionDynamicSignalKeyV3,
  type CompetitionFixedQuestionId,
  type CompetitionQuestionnaireFieldId,
  type CompetitionRecommendationResponseV5
} from "@/types/competition-recommendation";

export type ConversationPhase =
  | "questions"
  | "summary"
  | "normalizing"
  | "interpretation"
  | "clarifying"
  | "optional_followup"
  | "followups"
  | "recommending"
  | "results"
  | "error";

type RetryAction = "normalize" | "clarify" | "recommend";

export const FIXED_AUTO_ADVANCE_DELAY_MS = 0;
export const MAX_CLARIFICATION_QUESTIONS = 3;

type RequestContext = {
  controller: AbortController;
  generation: number;
};

type ClarifyRequestInput =
  | { questionnaireToken: string }
  | {
      conversationToken: string;
      answer: CompetitionClarificationAnswer;
      interpretationConfirmed?: true;
    }
  | { conversationToken: string; action: "skip_optional" };

type NormalizationInterpretationPayload = {
  allowedOptions?: Array<{ value: string; label: string }>;
  explicitValues?: string[];
  fieldId?: string;
  originalText?: string;
  rationale?: string;
  requiresConfirmation?: boolean;
  source?: string;
  status?: string;
  suggestedValues?: string[];
};

type ClarifyRetryContext = {
  input: ClarifyRequestInput;
  questionIndex: number;
  questions: CompetitionDynamicQuestionV3[];
  questionTokens: string[];
  answers: CompetitionClarificationAnswers;
};

type ApiFailureReason =
  | "rate_limited"
  | "consent_required"
  | "unsafe_request"
  | "session_recovery"
  | "service_unavailable"
  | "invalid_response"
  | "network_error"
  | "request_failed";

class CompetitionApiError extends Error {
  readonly failureReason: ApiFailureReason;
  readonly retryAfter: number;
  readonly errorCode: string;
  readonly consentVersion: string | null;
  readonly consentDisclosure: AiConsentDisclosureV1 | null;

  constructor(
    message: string,
    failureReason: ApiFailureReason,
    retryAfter = 0,
    errorCode = "",
    consentVersion: string | null = null,
    consentDisclosure: AiConsentDisclosureV1 | null = null
  ) {
    super(message);
    this.name = "CompetitionApiError";
    this.failureReason = failureReason;
    this.retryAfter = retryAfter;
    this.errorCode = errorCode;
    this.consentVersion = consentVersion;
    this.consentDisclosure = consentDisclosure;
  }
}

function payloadErrorCode(payload: unknown) {
  return payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "";
}

function payloadConsentVersion(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("consentVersion" in payload)) return null;
  const version = typeof payload.consentVersion === "string" ? payload.consentVersion : "";
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(version) ? version : null;
}

export function retryAfterSeconds(response: Response, payload: unknown, now = Date.now()) {
  const payloadValue = payload && typeof payload === "object" && "retryAfter" in payload
    ? Number(payload.retryAfter)
    : Number.NaN;
  const retryAfterHeader = response.headers.get("Retry-After")?.trim() ?? "";
  const headerSeconds = Number(retryAfterHeader);
  const headerDate = Date.parse(retryAfterHeader);
  const headerValue = Number.isFinite(headerSeconds) && headerSeconds >= 0
    ? headerSeconds
    : Number.isFinite(headerDate)
      ? Math.max(1, Math.ceil((headerDate - now) / 1000))
      : Number.NaN;
  const value = Number.isFinite(payloadValue) && payloadValue > 0 ? payloadValue : headerValue;
  return Number.isFinite(value) && value > 0 ? Math.min(86_400, Math.ceil(value)) : 60;
}

export function serviceUnavailableRetryAfterSeconds(
  response: Response,
  payload: unknown,
  now = Date.now()
) {
  const hasPayloadHint = Boolean(
    payload && typeof payload === "object" && "retryAfter" in payload
  );
  const hasHeaderHint = Boolean(response.headers.get("Retry-After")?.trim());
  return payloadErrorCode(payload) === "SECURITY_STATE_UNAVAILABLE" ||
    hasPayloadHint || hasHeaderHint
    ? retryAfterSeconds(response, payload, now)
    : 0;
}

function createClientIdempotencyKey() {
  return globalThis.crypto.randomUUID();
}

function responseError(response: Response, payload: unknown) {
  const error = payloadErrorCode(payload);
  if (error === "REQUEST_IN_PROGRESS") {
    return new CompetitionApiError(
      "上一条相同请求仍在安全完成中，倒计时结束后会用同一答案原地重试。",
      "rate_limited",
      retryAfterSeconds(response, payload),
      error
    );
  }
  if (response.status === 429 || error === "RATE_LIMITED") {
    return new CompetitionApiError(
      "今天找乐乐匹配的人有点多，倒计时结束后可在原地重试。",
      "rate_limited",
      retryAfterSeconds(response, payload)
    );
  }
  if (error === "AI_CONSENT_REQUIRED") {
    const consentVersion = payloadConsentVersion(payload);
    const consentDisclosure = payload && typeof payload === "object" && "consentDisclosure" in payload
      ? parseAiConsentDisclosureV1(payload.consentDisclosure)
      : null;
    return new CompetitionApiError(
      "AI 使用说明已更新，请阅读最新说明并重新确认。",
      "consent_required",
      0,
      error,
      consentVersion,
      consentDisclosure && consentDisclosure.version === consentVersion ? consentDisclosure : null
    );
  }
  if (error === "UNSAFE_REQUEST") {
    return new CompetitionApiError(
      "当前页面来源未通过安全校验，请从当前站点重新打开后再试。",
      "unsafe_request",
      0,
      error
    );
  }
  if (response.status === 403) {
    return new CompetitionApiError(
      "这次请求没有通过服务端校验，请刷新页面后再试。",
      "request_failed",
      0,
      error
    );
  }
  if (isCompetitionSessionRecoveryErrorCode(error)) {
    return new CompetitionApiError(
      "会话验证已更新，正在保留你已回答的条件并重新分析。",
      "session_recovery",
      0,
      error
    );
  }
  if (error === "COMPETITION_CATALOG_COVERAGE_INSUFFICIENT") {
    return new CompetitionApiError(
      "当前资料不足以生成可靠推荐。你可以返回修改条件，或在资料更新后再试。",
      "service_unavailable"
    );
  }
  if (response.status === 503) {
    const retryAfter = serviceUnavailableRetryAfterSeconds(response, payload);
    return new CompetitionApiError(
      retryAfter > 0
        ? "竞赛助手暂时没开放，你的答案还在，倒计时结束后可以直接重试。"
        : "竞赛助手暂时没开放，你的答案还在，稍后可以直接重试。",
      "service_unavailable",
      retryAfter,
      error
    );
  }
  return new CompetitionApiError("这次匹配没有完成，你的答案还在当前页面，可以原地重试。", "request_failed");
}

const competitionSessionRecoveryErrorCodes = new Set([
  "CONVERSATION_EXPIRED",
  "CONVERSATION_TOKEN_EXPIRED",
  "INVALID_CONVERSATION_TOKEN",
  "QUESTIONNAIRE_EXPIRED",
  "INVALID_QUESTIONNAIRE_TOKEN",
  "CONVERSATION_POLICY_CHANGED",
  "QUALIFICATION_SNAPSHOT_CHANGED",
  "INVALID_DYNAMIC_QUESTION",
  "CONVERSATION_NOT_COMPLETED"
]);

const reusableQuestionnaireSessionRecoveryErrorCodes = new Set([
  "CONVERSATION_POLICY_CHANGED",
  "QUALIFICATION_SNAPSHOT_CHANGED",
  "INVALID_DYNAMIC_QUESTION",
  "CONVERSATION_NOT_COMPLETED"
]);

export function isCompetitionSessionRecoveryErrorCode(value: unknown) {
  return typeof value === "string" && competitionSessionRecoveryErrorCodes.has(value);
}

export function canReuseConfirmedQuestionnaireForSessionRecovery(value: unknown) {
  return typeof value === "string" && reusableQuestionnaireSessionRecoveryErrorCodes.has(value);
}

function normalizeRequestError(error: unknown, fallbackMessage: string) {
  if (error instanceof CompetitionApiError) return error;
  if (error instanceof TypeError) return new CompetitionApiError(fallbackMessage, "network_error");
  return new CompetitionApiError(
    error instanceof Error ? error.message : fallbackMessage,
    "request_failed"
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizedClarificationAnswer(
  answer: CompetitionClarificationAnswer | undefined
): CompetitionClarificationAnswer {
  const note = answer?.note?.trim().slice(0, COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH);
  return {
    selectedValues: Array.from(new Set(answer?.selectedValues ?? [])),
    ...(note ? { note } : {})
  };
}

export function normalizeClarificationSelection(
  question: CompetitionDynamicQuestionV3,
  selectedValues: string[]
) {
  const allowed = new Set(question.options.map((option) => option.value));
  const values = Array.from(new Set(selectedValues)).filter((value) => allowed.has(value));
  const maximum = question.selection === "single" ? 1 : question.maxSelections ?? values.length;
  return values.slice(0, maximum);
}

export function keepClarificationAnswersThroughIndex(
  answers: CompetitionClarificationAnswers,
  questions: readonly CompetitionDynamicQuestionV3[],
  index: number
) {
  return Object.fromEntries(
    questions.slice(0, index + 1).flatMap((question) => {
      const answer = answers[question.questionId];
      return answer ? [[question.questionId, answer] as const] : [];
    })
  ) as CompetitionClarificationAnswers;
}

export const COMPETITION_RECENT_SIGNAL_HISTORY_LIMIT = 24;

export function isCompetitionDynamicSignalKey(value: unknown): value is CompetitionDynamicSignalKeyV3 {
  return competitionDynamicSignalKeyV3Schema.safeParse(value).success;
}

export function appendRecentCompetitionSignal(
  history: readonly CompetitionDynamicSignalKeyV3[],
  signalKey: CompetitionDynamicSignalKeyV3
) {
  return [...history, signalKey].slice(-COMPETITION_RECENT_SIGNAL_HISTORY_LIMIT);
}

export function clarificationSignalFamily(signalKey: CompetitionDynamicSignalKeyV3) {
  return competitionDynamicQuestionFamilyV3(signalKey);
}

export function isSafePreferenceQuestion(value: unknown): value is CompetitionDynamicQuestionV3 {
  return competitionDynamicQuestionV3Schema.safeParse(value).success;
}

const fixedFieldById = new Map<FixedQuestionFieldId, FixedQuestionField>();
const fixedTurnIdByField = new Map<FixedQuestionFieldId, CompetitionFixedQuestionId>();
for (const turn of fixedQuestionTurns) {
  for (const field of turn.fields) {
    fixedFieldById.set(field.id, field);
    fixedTurnIdByField.set(field.id, turn.id);
  }
}

function sameValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function interpretationReviewItems(
  payload: readonly NormalizationInterpretationPayload[],
  textAnswers: FixedQuestionTextAnswers
): QuestionnaireInterpretationReviewItem[] | null {
  const items = payload.flatMap((interpretation) => {
    if (!interpretation.fieldId) return [];
    const field = fixedFieldById.get(interpretation.fieldId as FixedQuestionFieldId);
    if (!field) return [];
    const allowedOptions = Array.isArray(interpretation.allowedOptions)
      ? interpretation.allowedOptions.filter(
        (option): option is { value: string; label: string } =>
          Boolean(option) && typeof option.value === "string" && typeof option.label === "string"
      )
      : [...field.options];
    const allowed = new Set(allowedOptions.map(({ value }) => value));
    const explicitValues = Array.from(new Set(interpretation.explicitValues ?? []))
      .filter((value) => allowed.has(value));
    const suggestedValues = Array.from(new Set(interpretation.suggestedValues ?? []))
      .filter((value) => allowed.has(value));
    const maximum = field.selection === "single" ? 1 : field.maxSelections ?? allowedOptions.length;
    const combined = Array.from(new Set([...explicitValues, ...suggestedValues]));
    const conflicts =
      (field.selection === "single" && explicitValues.length > 0 && suggestedValues.length > 0 && !sameValues(explicitValues, suggestedValues)) ||
      combined.length > maximum ||
      Boolean(field.exclusiveNone && combined.length > 1 && combined.includes("none"));
    const serverStatus = interpretation.status;
    const status: QuestionnaireInterpretationReviewItem["status"] = conflicts
      ? "conflict"
      : serverStatus === "conflict" || serverStatus === "ambiguous" || serverStatus === "unmapped" || serverStatus === "ready"
        ? serverStatus
        : interpretation.source === "unresolved" || suggestedValues.length === 0
          ? "unmapped"
          : "ready";
    // A conflict, ambiguity, or unmapped answer must require an explicit user
    // choice. Keeping an earlier option preselected here would let the global
    // confirmation button silently treat the conflict as resolved.
    const resolvedValues = status === "ready"
      ? combined.slice(0, maximum)
      : [];
    return [{
      allowedOptions,
      explicitValues,
      fieldId: field.id as CompetitionQuestionnaireFieldId,
      label: field.label,
      maxSelections: field.maxSelections,
      minSelections: field.minSelections,
      originalText: interpretation.originalText ?? textAnswers[fixedTurnIdByField.get(field.id)!] ?? "",
      rationale: interpretation.rationale ?? "请根据你的原回答确认最终结构化选项。",
      requiresConfirmation: interpretation.requiresConfirmation === true,
      resolvedValues,
      selection: field.selection,
      status,
      suggestedValues,
      ...(field.exclusiveNone ? { exclusiveNone: true } : {})
    } satisfies QuestionnaireInterpretationReviewItem];
  });
  const expected = payload.filter(({ requiresConfirmation }) => requiresConfirmation).length;
  return items.filter(({ requiresConfirmation }) => requiresConfirmation).length === expected ? items : null;
}

export function useRecommendationConversation(initialAiConsentDisclosure: AiConsentDisclosureV1) {
  const router = useRouter();
  const [isConsentRefreshPending, startConsentRefresh] = useTransition();
  const [editingCompleted, setEditingCompleted] = useState(false);
  const [depth, setDepth] = useState<SelectionDepth>("quick");
  const [decisionContext, setDecisionContext] = useState<DecisionContext>({});
  const [phase, setPhase] = useState<ConversationPhase>("questions");
  const [turnIndex, setTurnIndex] = useState(0);
  const [profile, setProfile] = useState<DraftCompetitionProfile>({});
  const [fixedQuestionTextAnswers, setFixedQuestionTextAnswers] = useState<FixedQuestionTextAnswers>({});
  const [aiConsentDisclosure, setAiConsentDisclosure] = useState(initialAiConsentDisclosure);
  const [acceptedConsentVersion, setAcceptedConsentVersion] = useState<string | null>(null);
  const [requiredConsentVersion, setRequiredConsentVersion] = useState<string | null>(null);
  const [consentDisclosureReady, setConsentDisclosureReady] = useState(true);
  const [consentDisclosureNotice, setConsentDisclosureNotice] = useState("");
  const [questionnaireToken, setQuestionnaireToken] = useState<string | null>(null);
  const [interpretationItems, setInterpretationItems] = useState<QuestionnaireInterpretationReviewItem[]>([]);
  const [clarificationQuestions, setClarificationQuestions] = useState<CompetitionDynamicQuestionV3[]>([]);
  const [clarificationQuestionTokens, setClarificationQuestionTokens] = useState<string[]>([]);
  const [clarificationIndex, setClarificationIndex] = useState(0);
  const [clarificationAnswers, setClarificationAnswers] = useState<CompetitionClarificationAnswers>({});
  const [optionalClarification, setOptionalClarification] = useState<{
    question: CompetitionDynamicQuestionV3;
    conversationToken: string;
  } | null>(null);
  const [dynamicAnswerConfirmation, setDynamicAnswerConfirmation] = useState<DynamicAnswerConfirmation | null>(null);
  const [result, setResult] = useState<CompetitionRecommendationResponseV5 | null>(null);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [retryAction, setRetryAction] = useState<RetryAction>("clarify");
  const [requestPending, setRequestPending] = useState(false);
  const [retryDeadline, setRetryDeadline] = useState<number | null>(null);
  const [retryAfter, setRetryAfter] = useState(0);
  const requestInFlightRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const retryDeadlineRef = useRef<number | null>(null);
  const normalizeIdempotencyKeyRef = useRef<string | null>(null);
  const clarifyRetryContextRef = useRef<ClarifyRetryContext | null>(null);
  const recommendTokenRef = useRef<string | null>(null);
  const rebuildConversationSessionRef = useRef<(questionnaireToken?: string | null) => void>(
    () => undefined
  );
  const recentSignalKeysRef = useRef<CompetitionDynamicSignalKeyV3[]>([]);
  const lastConsentDisclosurePropRef = useRef(initialAiConsentDisclosure);

  const activeTurns = useMemo(() => decisionQuestionTurns(depth, profile, fixedQuestionTextAnswers), [depth, profile, fixedQuestionTextAnswers]);
  const questionnaireComplete = Boolean(profile.stage || fixedQuestionTextAnswers.stage?.trim());
  const currentTurn = activeTurns[turnIndex];
  const currentClarification = clarificationQuestions[clarificationIndex];
  const currentClarificationAnswer = currentClarification
    ? clarificationAnswers[currentClarification.questionId]
    : undefined;
  const consentAccepted =
    consentDisclosureReady && acceptedConsentVersion === aiConsentDisclosure.version;

  useEffect(() => {
    if (retryDeadline === null) return;
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((retryDeadline - Date.now()) / 1000));
      setRetryAfter(remaining);
      if (remaining === 0) {
        retryDeadlineRef.current = null;
        setRetryDeadline(null);
      }
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1_000);
    return () => window.clearInterval(timer);
  }, [retryDeadline]);

  useEffect(() => () => {
    requestGenerationRef.current += 1;
    activeRequestControllerRef.current?.abort();
  }, []);

  const startRequest = useCallback(() => {
    if (requestInFlightRef.current || (retryDeadlineRef.current !== null && retryDeadlineRef.current > Date.now())) {
      return null;
    }
    const context: RequestContext = {
      controller: new AbortController(),
      generation: requestGenerationRef.current
    };
    requestInFlightRef.current = true;
    activeRequestControllerRef.current = context.controller;
    setRequestPending(true);
    return context;
  }, []);

  const finishRequest = useCallback((generation: number) => {
    if (requestGenerationRef.current !== generation) return;
    requestInFlightRef.current = false;
    activeRequestControllerRef.current = null;
    setRequestPending(false);
  }, []);

  const cancelActiveRequest = useCallback(() => {
    requestGenerationRef.current += 1;
    activeRequestControllerRef.current?.abort();
    activeRequestControllerRef.current = null;
    requestInFlightRef.current = false;
    setRequestPending(false);
  }, []);

  const applyRequestError = useCallback((error: unknown, fallbackMessage: string) => {
    const requestError = normalizeRequestError(error, fallbackMessage);
    if (requestError.retryAfter > 0) {
      const deadline = Date.now() + requestError.retryAfter * 1000;
      retryDeadlineRef.current = deadline;
      setRetryDeadline(deadline);
      setRetryAfter(requestError.retryAfter);
    }
    setErrorMessage(requestError.message);
    trackEvent("competition_recommend_failed", { failureReason: requestError.failureReason });
  }, []);

  const clearConversationSessionState = useCallback(() => {
    setQuestionnaireToken(null);
    setInterpretationItems([]);
    setClarificationQuestions([]);
    setClarificationQuestionTokens([]);
    setClarificationAnswers({});
    setOptionalClarification(null);
    setDynamicAnswerConfirmation(null);
    setClarificationIndex(0);
    setResult(null);
    setSelectedCompetitionId(null);
    setErrorMessage("");
    clarifyRetryContextRef.current = null;
    recommendTokenRef.current = null;
    normalizeIdempotencyKeyRef.current = null;
    recentSignalKeysRef.current = [];
  }, []);

  const clearRemoteState = useCallback(() => {
    setAcceptedConsentVersion(null);
    if (consentDisclosureReady) setConsentDisclosureNotice("");
    clearConversationSessionState();
  }, [clearConversationSessionState, consentDisclosureReady]);

  const setConsentAccepted = useCallback((accepted: boolean) => {
    setAcceptedConsentVersion(
      accepted && consentDisclosureReady ? aiConsentDisclosure.version : null
    );
  }, [aiConsentDisclosure.version, consentDisclosureReady]);

  const acceptedAiConsent = useCallback(() => {
    if (
      !consentDisclosureReady ||
      acceptedConsentVersion !== aiConsentDisclosure.version
    ) {
      return null;
    }
    return { accepted: true as const, version: acceptedConsentVersion };
  }, [acceptedConsentVersion, aiConsentDisclosure.version, consentDisclosureReady]);

  const refreshConsentDisclosure = useCallback(() => {
    startConsentRefresh(() => router.refresh());
  }, [router]);

  const recoverFromConsentError = useCallback((error: unknown, fallbackMessage: string) => {
    const requestError = normalizeRequestError(error, fallbackMessage);
    if (requestError.failureReason !== "consent_required") return false;

    clearConversationSessionState();
    retryDeadlineRef.current = null;
    setRetryDeadline(null);
    setRetryAfter(0);
    setAcceptedConsentVersion(null);
    setPhase("summary");
    trackEvent("competition_recommend_failed", { failureReason: requestError.failureReason });

    if (
      requestError.consentDisclosure &&
      requestError.consentVersion === requestError.consentDisclosure.version
    ) {
      setAiConsentDisclosure(requestError.consentDisclosure);
      // Keep the demanded version until a future RSC payload catches up. This
      // prevents an already-mounted page prop from replacing the newer atomic
      // disclosure received directly from the API response.
      setRequiredConsentVersion(requestError.consentVersion);
      setConsentDisclosureReady(true);
      setConsentDisclosureNotice("AI 使用说明已更新，请阅读下方最新说明并重新勾选确认。");
      return true;
    }

    setRequiredConsentVersion(requestError.consentVersion);
    setConsentDisclosureReady(false);
    setConsentDisclosureNotice("正在获取与服务端一致的最新 AI 使用说明；在确认完成前不会发送任何答案。");
    refreshConsentDisclosure();
    return true;
  }, [clearConversationSessionState, refreshConsentDisclosure]);

  useEffect(() => {
    // router.refresh() preserves this mounted client component. Only consume a
    // newly delivered server prop; a local state update alone must never make
    // an old descriptor look freshly verified.
    if (lastConsentDisclosurePropRef.current === initialAiConsentDisclosure) return;
    lastConsentDisclosurePropRef.current = initialAiConsentDisclosure;

    const nextDisclosure = parseAiConsentDisclosureV1(initialAiConsentDisclosure);
    if (!nextDisclosure) return;

    if (!consentDisclosureReady && requiredConsentVersion === null) {
      setConsentDisclosureNotice("服务端未提供可核对的说明版本，确认与提交继续锁定。");
      return;
    }

    const descriptorChanged =
      nextDisclosure.version !== aiConsentDisclosure.version ||
      nextDisclosure.heading !== aiConsentDisclosure.heading ||
      nextDisclosure.body !== aiConsentDisclosure.body ||
      nextDisclosure.privacyHref !== aiConsentDisclosure.privacyHref;
    const satisfiesRequiredVersion =
      requiredConsentVersion !== null && nextDisclosure.version === requiredConsentVersion;

    if (requiredConsentVersion !== null && !satisfiesRequiredVersion) {
      if (!consentDisclosureReady) {
        setConsentDisclosureNotice("服务端说明仍未与要求的版本一致，确认与提交继续锁定。");
      }
      return;
    }
    if (satisfiesRequiredVersion && consentDisclosureReady && !descriptorChanged) {
      setRequiredConsentVersion(null);
      return;
    }
    if (satisfiesRequiredVersion && consentDisclosureReady && descriptorChanged) {
      // A complete, internally consistent API disclosure is newer than the
      // mounted page payload. Never replace its copy merely because an older
      // RSC payload happens to reuse the same version label.
      return;
    }
    if (!descriptorChanged && !satisfiesRequiredVersion) return;

    cancelActiveRequest();
    setAiConsentDisclosure(nextDisclosure);
    setRequiredConsentVersion(null);
    setConsentDisclosureReady(true);
    setAcceptedConsentVersion(null);
    clearConversationSessionState();
    if (questionnaireComplete) setPhase("summary");
    setConsentDisclosureNotice("AI 使用说明已更新，请阅读下方最新说明并重新勾选确认。");
  }, [
    aiConsentDisclosure.body,
    aiConsentDisclosure.heading,
    aiConsentDisclosure.privacyHref,
    aiConsentDisclosure.version,
    cancelActiveRequest,
    clearConversationSessionState,
    initialAiConsentDisclosure,
    questionnaireComplete,
    requiredConsentVersion,
    consentDisclosureReady
  ]);

  const chooseFixedAnswer = useCallback((field: FixedQuestionField, rawAnswer: string | string[]) => {
    setProfile((current) => {
      const previous = getFieldAnswer(field, current);
      const answer = Array.isArray(rawAnswer)
        ? normalizeMultipleAnswer(field, rawAnswer, Array.isArray(previous) ? previous : undefined)
        : rawAnswer;
      return applyFieldAnswer(current, field, answer);
    });
    if (Array.isArray(rawAnswer) && field.id === "availableResources") {
      setDecisionContext(prev => ({ ...prev,
        obtainableResources: prev.obtainableResources?.filter(value => !rawAnswer.includes(value)),
        unavailableResources: prev.unavailableResources?.filter(value => !rawAnswer.includes(value))
      }));
    } else if (Array.isArray(rawAnswer) && field.id === "taskFormats") {
      setDecisionContext(prev => ({ ...prev,
        excludedTaskFormats: prev.excludedTaskFormats?.filter(value => !rawAnswer.includes(value))
      }));
    }
    clearRemoteState();
  }, [clearRemoteState]);

  const updateFixedQuestionText = useCallback((fieldId: CompetitionFixedQuestionId, value: string) => {
    const nextValue = value.slice(0, COMPETITION_ANSWER_TEXT_MAX_LENGTH);
    setFixedQuestionTextAnswers((current) => {
      if (nextValue) return { ...current, [fieldId]: nextValue };
      if (!(fieldId in current)) return current;
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    clearRemoteState();
  }, [clearRemoteState]);

  const advanceTurn = useCallback(() => {
    if (turnIndex < activeTurns.length - 1) setTurnIndex(turnIndex + 1);
    else if (questionnaireComplete) { setEditingCompleted(true); setPhase("summary"); }
  }, [activeTurns.length, questionnaireComplete, turnIndex]);

  const hasContextAnswer = (currentTurn.id === "experienceLevel" && Boolean(decisionContext.experienceRole)) ||
    (currentTurn.id === "taskFormats" && Boolean(decisionContext.excludedTaskFormats?.length || decisionContext.businessActivity)) ||
    (currentTurn.id === "availableResources" && Boolean(decisionContext.obtainableResources?.length || decisionContext.unavailableResources?.length));

  const confirmFixedAnswer = useCallback(() => {
    if (hasDecisionAnswer(currentTurn, profile, fixedQuestionTextAnswers) || hasContextAnswer) advanceTurn();
  }, [advanceTurn, currentTurn, fixedQuestionTextAnswers, hasContextAnswer, profile]);

  const skipFixedAnswer = useCallback(() => {
    if (currentTurn.id === "stage") return;
    setProfile(previous => {
      const next = { ...previous };
      currentTurn.fields.forEach(field => { delete next[field.id]; });
      return next;
    });
    setFixedQuestionTextAnswers(previous => {
      const next = { ...previous };
      delete next[currentTurn.id];
      return next;
    });
    setDecisionContext(previous => {
      const next = { ...previous };
      if (currentTurn.id === "availableResources") {
        delete next.obtainableResources;
        delete next.unavailableResources;
      } else if (currentTurn.id === "teamStatus") delete next.fixedTeam;
      else if (currentTurn.id === "experienceLevel") delete next.experienceRole;
      else if (currentTurn.id === "taskFormats") { delete next.excludedTaskFormats; delete next.businessActivity; }
      return next;
    });
    clearRemoteState();
    advanceTurn();
  }, [advanceTurn, clearRemoteState, currentTurn]);

  const changeContext = useCallback((next: DecisionContext) => {
    setDecisionContext(next);
    clearRemoteState();
  }, [clearRemoteState]);

  const editTurn = useCallback((index: number) => {
    cancelActiveRequest();
    clearRemoteState();
    setTurnIndex(Math.max(0, Math.min(index, activeTurns.length - 1)));
    setPhase("questions");
  }, [activeTurns.length, cancelActiveRequest, clearRemoteState]);

  const goBackFixed = useCallback(() => setTurnIndex((current) => Math.max(0, current - 1)), []);

  const restart = useCallback(() => {
    cancelActiveRequest();
    setPhase("questions");
    setTurnIndex(0);
    setProfile({});
    setDepth("quick");
    setEditingCompleted(false);
    setDecisionContext({});
    setFixedQuestionTextAnswers({});
    clearRemoteState();
    retryDeadlineRef.current = null;
    setRetryDeadline(null);
    setRetryAfter(0);
  }, [cancelActiveRequest, clearRemoteState]);

  const runRecommend = useCallback(async (conversationToken: string) => {
    const aiConsent = acceptedAiConsent();
    if (!aiConsent) return;
    const requestContext = startRequest();
    if (!requestContext) return;
    recommendTokenRef.current = conversationToken;
    setPhase("recommending");
    setErrorMessage("");

    let rebuildSession = false;
    let recoveryQuestionnaireToken: string | null = null;
    try {
      const response = await fetch("/api/ai/competition-recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: requestContext.controller.signal,
        body: JSON.stringify({
          aiConsent,
          conversationToken
        })
      });
      const payload = await readJson(response);
      if (requestGenerationRef.current !== requestContext.generation) return;
      if (!response.ok) throw responseError(response, payload);
      const nextResult = parseCompetitionRecommendationResponseV5(payload);
      if (!nextResult) {
        throw new CompetitionApiError("返回的推荐结果不完整，请原地重试。", "invalid_response");
      }
      setResult(nextResult);
      setPhase("results");
      trackEvent("competition_recommend_completed", {
        resultCount: nextResult.recommendations.length,
        fallbackUsed: nextResult.fallbackUsed,
        fallbackMode: nextResult.fallbackMode,
        fallbackReason: nextResult.fallbackReason,
        provider: nextResult.provider,
        competitionIds: nextResult.recommendations.map((item) => item.competitionId).join(",")
      });
    } catch (error) {
      if (requestGenerationRef.current !== requestContext.generation) return;
      if (recoverFromConsentError(error, "这次匹配没有完成，请原地重试。")) {
        // The recovery helper atomically installs or refreshes the disclosure.
      } else if (error instanceof CompetitionApiError && error.failureReason === "session_recovery") {
        recoveryQuestionnaireToken = canReuseConfirmedQuestionnaireForSessionRecovery(error.errorCode)
          ? questionnaireToken
          : null;
        clearConversationSessionState();
        rebuildSession = true;
      } else {
        setRetryAction("recommend");
        applyRequestError(error, "这次匹配没有完成，请原地重试。");
        setPhase("error");
      }
    } finally {
      finishRequest(requestContext.generation);
    }

    if (rebuildSession) {
      rebuildConversationSessionRef.current(recoveryQuestionnaireToken);
    }
  }, [
    acceptedAiConsent,
    applyRequestError,
    clearConversationSessionState,
    finishRequest,
    questionnaireToken,
    recoverFromConsentError,
    startRequest
  ]);

  const requestNextClarification = useCallback(async (
    input: ClarifyRequestInput,
    context: Omit<ClarifyRetryContext, "input">
  ) => {
    const aiConsent = acceptedAiConsent();
    if (!aiConsent) return;
    const requestContext = startRequest();
    if (!requestContext) return;
    clarifyRetryContextRef.current = { input, ...context };
    setPhase("clarifying");
    setErrorMessage("");
    setResult(null);
    if ("questionnaireToken" in input) trackEvent("competition_recommend_started");

    let completedToken: string | null = null;
    let rebuildSession = false;
    let recoveryQuestionnaireToken: string | null = null;
    try {
      const response = await fetch("/api/ai/competition-clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: requestContext.controller.signal,
        body: JSON.stringify({
          aiConsent,
          recentSignalKeys: recentSignalKeysRef.current,
          ...input
        })
      });
      const payload = await readJson(response);
      if (requestGenerationRef.current !== requestContext.generation) return;
      const pendingQuestion = "answer" in input
        ? context.questions[context.questionIndex]
        : undefined;
      const confirmation =
        pendingQuestion &&
        "answer" in input &&
        input.answer.note
          ? parseDynamicAnswerConfirmation(payload, pendingQuestion, input.answer.note)
          : null;
      if (confirmation) {
        setDynamicAnswerConfirmation(confirmation);
        clarifyRetryContextRef.current = null;
        setPhase("followups");
        return;
      }
      if (!response.ok) {
        throw responseError(response, payload);
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        !("responseVersion" in payload) ||
        payload.responseVersion !== COMPETITION_CLARIFICATION_RESPONSE_VERSION ||
        !("nextQuestion" in payload) ||
        !("conversationToken" in payload) ||
        typeof payload.conversationToken !== "string" ||
        payload.conversationToken.length < 32 ||
        payload.conversationToken.length > 48 * 1024 ||
        !("status" in payload) ||
        (payload.status !== "question" &&
          payload.status !== "optional_question" &&
          payload.status !== "completed")
      ) {
        throw new CompetitionApiError("补充问题的格式有些异常，请原地重试。", "invalid_response");
      }

      const conversationToken = payload.conversationToken;
      const nextQuestionInput = payload.nextQuestion;
      const answeredQuestionCount = "answer" in input ? context.questionIndex + 1 : 0;
      setDynamicAnswerConfirmation(null);
      if (payload.status === "completed") {
        if (nextQuestionInput !== null) {
          throw new CompetitionApiError("补充问题的格式有些异常，请原地重试。", "invalid_response");
        }
        setOptionalClarification(null);
        completedToken = conversationToken;
        clarifyRetryContextRef.current = null;
      } else {
        const parsedQuestion = competitionDynamicQuestionV3Schema.safeParse(nextQuestionInput);
        if (!parsedQuestion.success) {
          throw new CompetitionApiError("补充问题不符合当前的偏好问答规则，请原地重试。", "invalid_response");
        }
        const nextQuestion = parsedQuestion.data;
        if (
          (payload.status === "question" && nextQuestion.impact !== "material") ||
          (payload.status === "optional_question" && nextQuestion.impact !== "optional")
        ) {
          throw new CompetitionApiError("补充问题的作用标记有些异常，请原地重试。", "invalid_response");
        }
        const prefixLength = answeredQuestionCount;
        if (context.questions.slice(0, prefixLength).some(
          ({ signalKey }) => clarificationSignalFamily(signalKey) === clarificationSignalFamily(nextQuestion.signalKey)
        )) {
          throw new CompetitionApiError("补充问题出现重复，请原地重试。", "invalid_response");
        }
        if (prefixLength >= MAX_CLARIFICATION_QUESTIONS) {
          throw new CompetitionApiError("补充问题数量超出限制，请原地重试。", "invalid_response");
        }
        if (payload.status === "optional_question") {
          if (
            prefixLength !== 0 ||
            nextQuestion.signalKey !== "candidate-goal-tradeoff"
          ) {
            throw new CompetitionApiError("可选偏好问题的格式有些异常，请原地重试。", "invalid_response");
          }
          setOptionalClarification({ question: nextQuestion, conversationToken });
          clarifyRetryContextRef.current = null;
          setPhase("optional_followup");
          return;
        }
        const nextQuestions = [...context.questions.slice(0, prefixLength), nextQuestion];
        const nextTokens = [...context.questionTokens.slice(0, prefixLength), conversationToken];
        const nextAnswers = prefixLength > 0
          ? keepClarificationAnswersThroughIndex(context.answers, context.questions, prefixLength - 1)
          : {};
        recentSignalKeysRef.current = appendRecentCompetitionSignal(
          recentSignalKeysRef.current,
          nextQuestion.signalKey
        );
        setClarificationQuestions(nextQuestions);
        setClarificationQuestionTokens(nextTokens);
        setClarificationAnswers(nextAnswers);
        setOptionalClarification(null);
        setClarificationIndex(nextQuestions.length - 1);
        clarifyRetryContextRef.current = null;
        setPhase("followups");
        return;
      }
    } catch (error) {
      if (requestGenerationRef.current !== requestContext.generation) return;
      if (recoverFromConsentError(error, "暂时无法分析问卷，请原地重试。")) {
        // Consent recovery returns to the fixed-answer summary.
      } else if (error instanceof CompetitionApiError && error.failureReason === "session_recovery") {
        // A stale conversation token does not invalidate the already-confirmed
        // fixed questionnaire. Reuse it once; if that token is also stale, the
        // questionnaire-token branch below falls back to normalization.
        recoveryQuestionnaireToken =
          canReuseConfirmedQuestionnaireForSessionRecovery(error.errorCode) && !("questionnaireToken" in input)
            ? questionnaireToken
            : null;
        clearConversationSessionState();
        rebuildSession = true;
      } else {
        setRetryAction("clarify");
        applyRequestError(error, "暂时无法分析问卷，请原地重试。");
        setPhase("error");
      }
    } finally {
      finishRequest(requestContext.generation);
    }

    if (rebuildSession) {
      rebuildConversationSessionRef.current(recoveryQuestionnaireToken);
      return;
    }
    if (completedToken && requestGenerationRef.current === requestContext.generation) {
      await runRecommend(completedToken);
    }
  }, [
    acceptedAiConsent,
    applyRequestError,
    clearConversationSessionState,
    finishRequest,
    questionnaireToken,
    recoverFromConsentError,
    runRecommend,
    startRequest
  ]);

  const beginClarification = useCallback(async (confirmedQuestionnaireToken: string) => {
    setClarificationQuestions([]);
    setClarificationQuestionTokens([]);
    setClarificationAnswers({});
    setOptionalClarification(null);
    setDynamicAnswerConfirmation(null);
    setClarificationIndex(0);
    await requestNextClarification(
      { questionnaireToken: confirmedQuestionnaireToken },
      { questionIndex: -1, questions: [], questionTokens: [], answers: {} }
    );
  }, [requestNextClarification]);

  const runNormalize = useCallback(async () => {
    const questionnaire = toCompetitionQuestionnaireDraft(profile, fixedQuestionTextAnswers, { turns: activeTurns, context: decisionContext });
    const aiConsent = acceptedAiConsent();
    if (!questionnaire || !aiConsent) return;
    const requestContext = startRequest();
    if (!requestContext) return;
    setPhase("normalizing");
    setErrorMessage("");
    setRetryAction("normalize");
    let confirmedToken: string | null = null;

    try {
      const idempotencyKey = normalizeIdempotencyKeyRef.current ?? createClientIdempotencyKey();
      normalizeIdempotencyKeyRef.current = idempotencyKey;
      const response = await fetch("/api/competitions/recommend/normalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        signal: requestContext.controller.signal,
        body: JSON.stringify({
          aiConsent,
          questionnaire
        })
      });
      const payload = await readJson(response);
      if (requestGenerationRef.current !== requestContext.generation) return;
      if (!response.ok) throw responseError(response, payload);
      if (
        !payload ||
        typeof payload !== "object" ||
        !("questionnaireToken" in payload) ||
        typeof payload.questionnaireToken !== "string" ||
        !("status" in payload)
      ) {
        throw new CompetitionApiError("文字理解结果不完整，请原地重试。", "invalid_response");
      }
      if (payload.status === "confirmed") {
        setQuestionnaireToken(payload.questionnaireToken);
        setInterpretationItems([]);
        confirmedToken = payload.questionnaireToken;
      } else if (payload.status === "needs_confirmation" && "interpretations" in payload && Array.isArray(payload.interpretations)) {
        const items = interpretationReviewItems(
          payload.interpretations as NormalizationInterpretationPayload[],
          fixedQuestionTextAnswers
        );
        if (!items || items.every(({ requiresConfirmation }) => !requiresConfirmation)) {
          throw new CompetitionApiError("文字理解结果不完整，请原地重试。", "invalid_response");
        }
        if (
          "fallbackReason" in payload &&
          typeof payload.fallbackReason === "string" &&
          payload.fallbackReason.length > 0
        ) {
          throw new CompetitionApiError(
            "DeepSeek 暂时无法完成文字理解。原回答已经保留，你可以原地重试，或返回改用预设选项。",
            "service_unavailable"
          );
        }
        setQuestionnaireToken(payload.questionnaireToken);
        setInterpretationItems(items);
        setPhase("interpretation");
      } else {
        throw new CompetitionApiError("文字理解结果不完整，请原地重试。", "invalid_response");
      }
    } catch (error) {
      if (requestGenerationRef.current !== requestContext.generation) return;
      if (!recoverFromConsentError(error, "暂时无法理解文字回答，请原地重试。")) {
        applyRequestError(error, "暂时无法理解文字回答，请原地重试。");
        setPhase("error");
      }
    } finally {
      finishRequest(requestContext.generation);
    }

    if (confirmedToken && requestGenerationRef.current === requestContext.generation) {
      await beginClarification(confirmedToken);
    }
  }, [
    acceptedAiConsent,
    applyRequestError,
    beginClarification,
    activeTurns,
    decisionContext,
    finishRequest,
    fixedQuestionTextAnswers,
    profile,
    recoverFromConsentError,
    startRequest
  ]);

  const updateInterpretationValues = useCallback((fieldId: CompetitionQuestionnaireFieldId, values: string[]) => {
    setInterpretationItems((current) => current.map((item) => {
      if (item.fieldId !== fieldId) return item;
      const allowed = new Set(item.allowedOptions.map(({ value }) => value));
      const maximum = item.selection === "single" ? 1 : item.maxSelections ?? values.length;
      let nextValues = Array.from(new Set(values)).filter((value) => allowed.has(value));
      if (item.exclusiveNone && nextValues.includes("none")) {
        nextValues = item.resolvedValues.includes("none")
          ? nextValues.filter((value) => value !== "none")
          : ["none"];
      }
      return { ...item, resolvedValues: nextValues.slice(0, maximum) };
    }));
  }, []);

  const confirmInterpretations = useCallback(async () => {
    if (!questionnaireToken || interpretationItems.length === 0) return;
    const confirmations = interpretationItems
      .filter(({ requiresConfirmation }) => requiresConfirmation)
      .map(({ fieldId, resolvedValues }) => ({ fieldId, values: [...resolvedValues] }));
    if (confirmations.some(({ values }) => values.length === 0)) return;
    const aiConsent = acceptedAiConsent();
    if (!aiConsent) return;
    const requestContext = startRequest();
    if (!requestContext) return;
    setErrorMessage("");
    setRetryAction("normalize");
    let confirmedToken: string | null = null;
    let rebuildSession = false;

    try {
      const response = await fetch("/api/competitions/recommend/normalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: requestContext.controller.signal,
        body: JSON.stringify({
          aiConsent,
          questionnaireToken,
          confirmations
        })
      });
      const payload = await readJson(response);
      if (requestGenerationRef.current !== requestContext.generation) return;
      if (!response.ok) throw responseError(response, payload);
      if (
        !payload ||
        typeof payload !== "object" ||
        !("status" in payload) ||
        payload.status !== "confirmed" ||
        !("questionnaireToken" in payload) ||
        typeof payload.questionnaireToken !== "string"
      ) {
        throw new CompetitionApiError("确认结果不完整，请原地重试。", "invalid_response");
      }
      setQuestionnaireToken(payload.questionnaireToken);
      confirmedToken = payload.questionnaireToken;
    } catch (error) {
      if (requestGenerationRef.current !== requestContext.generation) return;
      if (recoverFromConsentError(error, "暂时无法确认文字理解，请原地重试。")) {
        // Consent recovery returns to the fixed-answer summary.
      } else if (error instanceof CompetitionApiError && error.failureReason === "session_recovery") {
        clearConversationSessionState();
        rebuildSession = true;
      } else {
        applyRequestError(error, "暂时无法确认文字理解，请原地重试。");
        setPhase("error");
      }
    } finally {
      finishRequest(requestContext.generation);
    }

    if (rebuildSession) {
      rebuildConversationSessionRef.current();
    } else if (confirmedToken && requestGenerationRef.current === requestContext.generation) {
      await beginClarification(confirmedToken);
    }
  }, [
    acceptedAiConsent,
    applyRequestError,
    beginClarification,
    clearConversationSessionState,
    finishRequest,
    interpretationItems,
    questionnaireToken,
    recoverFromConsentError,
    startRequest
  ]);

  const backFromInterpretation = useCallback(() => {
    setQuestionnaireToken(null);
    setInterpretationItems([]);
    setPhase("summary");
  }, []);

  const runClarify = runNormalize;

  useEffect(() => {
    rebuildConversationSessionRef.current = (confirmedQuestionnaireToken) => {
      if (confirmedQuestionnaireToken) {
        setQuestionnaireToken(confirmedQuestionnaireToken);
        void beginClarification(confirmedQuestionnaireToken);
      } else {
        void runNormalize();
      }
    };
  }, [beginClarification, runNormalize]);

  const continueOptionalClarification = useCallback(() => {
    if (!optionalClarification) return;
    const { question, conversationToken } = optionalClarification;
    setClarificationQuestions([question]);
    setClarificationQuestionTokens([conversationToken]);
    setClarificationAnswers({});
    setClarificationIndex(0);
    setOptionalClarification(null);
    recentSignalKeysRef.current = appendRecentCompetitionSignal(
      recentSignalKeysRef.current,
      question.signalKey
    );
    setPhase("followups");
  }, [optionalClarification]);

  const skipOptionalClarification = useCallback(() => {
    if (!optionalClarification) return;
    const { conversationToken } = optionalClarification;
    void requestNextClarification(
      { conversationToken, action: "skip_optional" },
      { questionIndex: -1, questions: [], questionTokens: [], answers: {} }
    );
  }, [optionalClarification, requestNextClarification]);

  const chooseClarification = useCallback((selectedValues: string[]) => {
    if (!currentClarification) return;
    setDynamicAnswerConfirmation(null);
    setClarificationAnswers((current) => {
      const previous = current[currentClarification.questionId];
      return {
        ...current,
        [currentClarification.questionId]: {
          selectedValues: normalizeClarificationSelection(currentClarification, selectedValues),
          ...(previous?.note ? { note: previous.note } : {})
        }
      };
    });
  }, [currentClarification]);

  const updateClarificationNote = useCallback((note: string) => {
    if (!currentClarification) return;
    setDynamicAnswerConfirmation(null);
    setClarificationAnswers((current) => {
      const previous = current[currentClarification.questionId];
      return {
        ...current,
        [currentClarification.questionId]: {
          selectedValues: previous?.selectedValues ?? [],
          ...(note ? { note: note.slice(0, currentClarification.maxNoteLength) } : {})
        }
      };
    });
  }, [currentClarification]);

  const submitClarificationAnswer = useCallback((
    answer: CompetitionClarificationAnswer,
    options: { interpretationConfirmed?: true } = {}
  ) => {
    if (!currentClarification) return;
    const normalizedBase = normalizedClarificationAnswer(answer);
    const normalized: CompetitionClarificationAnswer = {
      selectedValues: normalizeClarificationSelection(
        currentClarification,
        normalizedBase.selectedValues
      ),
      ...(normalizedBase.note ? { note: normalizedBase.note } : {})
    };
    if (!normalized.note && normalized.selectedValues.length === 0) return;
    if (
      normalized.note &&
      !isCompetitionAnswerTextValid(normalized.note, currentClarification.maxNoteLength)
    ) return;
    const conversationToken = clarificationQuestionTokens[clarificationIndex];
    if (!conversationToken) return;

    const nextAnswers = {
      ...clarificationAnswers,
      [currentClarification.questionId]: normalized
    };
    const nextQuestions = clarificationQuestions.slice(0, clarificationIndex + 1);
    const truncatedAnswers = keepClarificationAnswersThroughIndex(
      nextAnswers,
      nextQuestions,
      nextQuestions.length - 1
    );
    setClarificationQuestions(nextQuestions);
    setClarificationQuestionTokens((current) => current.slice(0, clarificationIndex + 1));
    setClarificationAnswers(truncatedAnswers);
    setDynamicAnswerConfirmation(null);
    void requestNextClarification(
      {
        conversationToken,
        answer: normalized,
        ...(options.interpretationConfirmed ? { interpretationConfirmed: true as const } : {})
      },
      {
        questionIndex: clarificationIndex,
        questions: nextQuestions,
        questionTokens: clarificationQuestionTokens.slice(0, clarificationIndex + 1),
        answers: truncatedAnswers
      }
    );
  }, [
    clarificationAnswers,
    clarificationIndex,
    clarificationQuestions,
    clarificationQuestionTokens,
    currentClarification,
    requestNextClarification
  ]);

  const confirmClarification = useCallback(() => {
    if (!currentClarificationAnswer) return;
    submitClarificationAnswer(currentClarificationAnswer);
  }, [currentClarificationAnswer, submitClarificationAnswer]);

  const updateDynamicAnswerConfirmationValues = useCallback((values: string[]) => {
    if (!currentClarification) return;
    setDynamicAnswerConfirmation((current) => current?.questionId === currentClarification.questionId
      ? {
        ...current,
        resolvedValues: normalizeDynamicAnswerConfirmationValues(current, currentClarification, values)
      }
      : current);
  }, [currentClarification]);

  const cancelDynamicAnswerConfirmation = useCallback(() => {
    setDynamicAnswerConfirmation(null);
    setPhase("followups");
  }, []);

  const confirmDynamicAnswerConfirmation = useCallback(() => {
    if (
      !currentClarification ||
      !dynamicAnswerConfirmation ||
      dynamicAnswerConfirmation.questionId !== currentClarification.questionId ||
      !isDynamicAnswerConfirmationResolved(dynamicAnswerConfirmation, currentClarification)
    ) return;
    submitClarificationAnswer({
      selectedValues: dynamicAnswerConfirmation.resolvedValues,
      note: dynamicAnswerConfirmation.originalText
    }, { interpretationConfirmed: true });
  }, [currentClarification, dynamicAnswerConfirmation, submitClarificationAnswer]);

  const goBackClarification = useCallback(() => {
    if (clarificationIndex > 0) setClarificationIndex((current) => current - 1);
    else setPhase("summary");
  }, [clarificationIndex]);

  const editClarification = useCallback((index: number) => {
    if (clarificationQuestions.length === 0) return;
    const nextIndex = Math.max(0, Math.min(index, clarificationQuestions.length - 1));
    cancelActiveRequest();
    setResult(null);
    setSelectedCompetitionId(null);
    setErrorMessage("");
    setDynamicAnswerConfirmation(null);
    clarifyRetryContextRef.current = null;
    recommendTokenRef.current = null;
    setClarificationQuestions((current) => current.slice(0, nextIndex + 1));
    setClarificationQuestionTokens((current) => current.slice(0, nextIndex + 1));
    setClarificationAnswers((current) => keepClarificationAnswersThroughIndex(
      current,
      clarificationQuestions,
      nextIndex
    ));
    setClarificationIndex(nextIndex);
    setPhase("followups");
  }, [cancelActiveRequest, clarificationQuestions]);

  const retry = useCallback(() => {
    if (requestInFlightRef.current || retryAfter > 0) return;
    if (retryAction === "normalize") {
      if (questionnaireToken && interpretationItems.length > 0) {
        void confirmInterpretations();
      } else {
        void runNormalize();
      }
      return;
    }
    if (retryAction === "clarify") {
      const retryContext = clarifyRetryContextRef.current;
      if (retryContext) {
        const { input, ...context } = retryContext;
        void requestNextClarification(input, context);
      } else {
        void runClarify();
      }
      return;
    }
    if (recommendTokenRef.current) void runRecommend(recommendTokenRef.current);
  }, [
    confirmInterpretations,
    interpretationItems.length,
    questionnaireToken,
    requestNextClarification,
    retryAction,
    retryAfter,
    runClarify,
    runNormalize,
    runRecommend
  ]);

  const openDetails = useCallback((competitionId: string) => {
    setSelectedCompetitionId(competitionId);
    trackEvent("competition_detail_open", { competitionId });
  }, []);
  const closeDetails = useCallback(() => setSelectedCompetitionId(null), []);
  const trackSourceClick = useCallback((competitionId: string) => {
    trackEvent("competition_source_click", { competitionId });
  }, []);

  return {
    phase,
    returnToSummary: editingCompleted && questionnaireComplete ? () => setPhase("summary") : null,
    depth, setDepth, activeTurns, decisionContext, changeContext, skipFixedAnswer, hasContextAnswer,
    turnIndex,
    profile,
    fixedQuestionTextAnswers,
    questionnaireComplete,
    currentTurn,
    aiConsentDisclosure,
    consentDisclosureReady,
    consentDisclosureNotice,
    isConsentRefreshPending,
    refreshConsentDisclosure,
    consentAccepted,
    setConsentAccepted,
    clarificationQuestions,
    clarificationIndex,
    clarificationAnswers,
    optionalClarification,
    currentClarification,
    currentClarificationAnswer,
    dynamicAnswerConfirmation,
    result,
    selectedCompetitionId,
    errorMessage,
    requestPending,
    retryAfter,
    fixedTransitionPending: false,
    chooseFixedAnswer,
    updateFixedQuestionText,
    confirmFixedAnswer,
    editTurn,
    goBackFixed,
    restart,
    runClarify,
    interpretationItems,
    updateInterpretationValues,
    confirmInterpretations,
    backFromInterpretation,
    continueOptionalClarification,
    skipOptionalClarification,
    chooseClarification,
    updateClarificationNote,
    confirmClarification,
    updateDynamicAnswerConfirmationValues,
    cancelDynamicAnswerConfirmation,
    confirmDynamicAnswerConfirmation,
    goBackClarification,
    editClarification,
    retry,
    openDetails,
    closeDetails,
    trackSourceClick
  };
}
