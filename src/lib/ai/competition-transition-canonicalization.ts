import type { CompetitionClarifyRequestV5 } from "@/lib/ai/competition-request-schema";

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalizeSelectionValues(values: readonly string[]) {
  return [...values].sort(compareStrings);
}

/**
 * Questionnaire answers and confirmation entries are sets keyed by fieldId.
 * Their wire-array order must not create a distinct logical transition.
 */
export function canonicalizeKeyedSelections<
  ValueKey extends "selectedValues" | "values",
  Entry extends { fieldId: string } & Record<ValueKey, string[]>
>(
  entries: readonly Entry[],
  valueKey: ValueKey
) {
  return entries
    .map((entry) => ({
      ...entry,
      [valueKey]: canonicalizeSelectionValues(entry[valueKey])
    }) as Entry)
    .sort((left, right) => compareStrings(left.fieldId, right.fieldId));
}

/**
 * Clarify identity is the signed root/action plus the semantic answer. Recent
 * signal history is an unsigned question-selection hint and cannot define a
 * new state transition. Tokens, notes and the signed action remain byte-exact.
 */
export function canonicalizeCompetitionClarifyTransition(
  request: CompetitionClarifyRequestV5
) {
  if ("questionnaireToken" in request) {
    return {
      aiConsent: request.aiConsent,
      questionnaireToken: request.questionnaireToken
    };
  }

  if ("action" in request) {
    return {
      aiConsent: request.aiConsent,
      conversationToken: request.conversationToken,
      action: request.action
    };
  }

  return {
    aiConsent: request.aiConsent,
    conversationToken: request.conversationToken,
    answer: {
      ...request.answer,
      selectedValues: canonicalizeSelectionValues(request.answer.selectedValues)
    },
    ...(request.interpretationConfirmed
      ? { interpretationConfirmed: request.interpretationConfirmed }
      : {})
  };
}
