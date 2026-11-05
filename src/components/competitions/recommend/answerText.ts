import { containsCompetitionNotePersonalInfo } from "@/lib/ai/competition-note";

export const COMPETITION_ANSWER_TEXT_MAX_LENGTH = 120;

export function normalizeCompetitionAnswerText(
  value: string | undefined,
  maxLength = COMPETITION_ANSWER_TEXT_MAX_LENGTH
) {
  return value?.trim().slice(0, maxLength) ?? "";
}

export function isCompetitionAnswerTextValid(
  value: string | undefined,
  maxLength = COMPETITION_ANSWER_TEXT_MAX_LENGTH
) {
  const normalized = normalizeCompetitionAnswerText(value, maxLength);
  return (
    normalized.length > 0 &&
    normalized.length <= maxLength &&
    !containsCompetitionNotePersonalInfo(normalized)
  );
}

