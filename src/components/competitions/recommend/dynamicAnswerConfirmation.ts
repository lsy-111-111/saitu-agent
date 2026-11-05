import type {
  CompetitionDynamicQuestionOption,
  CompetitionDynamicQuestionV1
} from "@/types/competition-recommendation";

export type DynamicAnswerConfirmationStatus =
  | "ready"
  | "conflict"
  | "ambiguous"
  | "unmapped";

export type DynamicAnswerConfirmation = {
  allowedOptions: CompetitionDynamicQuestionOption[];
  originalText: string;
  questionId: string;
  rationale: string;
  resolvedValues: string[];
  status: DynamicAnswerConfirmationStatus;
  suggestedValues: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function uniqueStrings(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string")))
    : [];
}

function allowedStatus(value: unknown): DynamicAnswerConfirmationStatus | null {
  return value === "ready" || value === "conflict" || value === "ambiguous" || value === "unmapped"
    ? value
    : null;
}

/**
 * Turns the dedicated business-state response into client review state. The
 * signed question, rather than response labels, remains the source of truth for
 * the option whitelist. The legacy error code remains readable for an in-flight
 * client during deployment, but new responses use HTTP 200 + needs_confirmation.
 */
export function parseDynamicAnswerConfirmation(
  payload: unknown,
  question: CompetitionDynamicQuestionV1,
  submittedText: string
): DynamicAnswerConfirmation | null {
  if (
    !isRecord(payload) ||
    !(
      payload.status === "needs_confirmation" ||
      payload.error === "DYNAMIC_ANSWER_CONFIRMATION_REQUIRED"
    ) ||
    payload.interpretationRequired !== true ||
    !isRecord(payload.interpretation)
  ) {
    return null;
  }

  const serverStatus = allowedStatus(payload.interpretation.status);
  const serverOptions = Array.isArray(payload.interpretation.allowedOptions)
    ? payload.interpretation.allowedOptions
    : null;
  if (!serverStatus || !serverOptions) return null;

  const serverOptionValues = new Set(
    serverOptions.flatMap((option) =>
      isRecord(option) && typeof option.value === "string" ? [option.value] : []
    )
  );
  const allowedOptions = question.options.filter(({ value }) => serverOptionValues.has(value));
  if (allowedOptions.length !== question.options.length) return null;

  const allowedValues = new Set(allowedOptions.map(({ value }) => value));
  const maximum = question.selection === "single"
    ? 1
    : question.maxSelections ?? allowedOptions.length;
  const suggestions = uniqueStrings(payload.interpretation.suggestedValues)
    .filter((value) => allowedValues.has(value));
  const suggestionsAreValid =
    suggestions.length > 0 &&
    suggestions.length <= maximum &&
    (question.selection === "multiple" || suggestions.length === 1);
  const rationale = typeof payload.interpretation.rationale === "string"
    ? payload.interpretation.rationale.trim().slice(0, 240)
    : "请根据原回答确认一个白名单选项。";

  return {
    allowedOptions: allowedOptions.map((option) => ({ ...option })),
    originalText: submittedText.trim(),
    questionId: question.questionId,
    rationale: rationale || "请根据原回答确认一个白名单选项。",
    resolvedValues: serverStatus === "ready" && suggestionsAreValid ? suggestions : [],
    status: serverStatus === "ready" && !suggestionsAreValid ? "unmapped" : serverStatus,
    suggestedValues: suggestionsAreValid ? suggestions : []
  };
}

export function normalizeDynamicAnswerConfirmationValues(
  confirmation: DynamicAnswerConfirmation,
  question: CompetitionDynamicQuestionV1,
  values: string[]
) {
  const allowed = new Set(confirmation.allowedOptions.map(({ value }) => value));
  const maximum = question.selection === "single"
    ? 1
    : question.maxSelections ?? confirmation.allowedOptions.length;
  return Array.from(new Set(values)).filter((value) => allowed.has(value)).slice(0, maximum);
}

export function isDynamicAnswerConfirmationResolved(
  confirmation: DynamicAnswerConfirmation,
  question: CompetitionDynamicQuestionV1
) {
  const allowed = new Set(confirmation.allowedOptions.map(({ value }) => value));
  const maximum = question.selection === "single"
    ? 1
    : question.maxSelections ?? confirmation.allowedOptions.length;
  return (
    confirmation.questionId === question.questionId &&
    confirmation.resolvedValues.length >= 1 &&
    confirmation.resolvedValues.length <= maximum &&
    confirmation.resolvedValues.every((value) => allowed.has(value))
  );
}
