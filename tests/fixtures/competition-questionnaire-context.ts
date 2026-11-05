import {
  COMPETITION_INITIAL_QUESTIONNAIRE_FIELD_IDS,
  type CompetitionQuestionnaireFieldId,
  type CompetitionRecommendationProfileV5
} from "@/types/competition-recommendation";

export function buildCompetitionQuestionnaireRawContext(
  profile: CompetitionRecommendationProfileV5
) {
  const fieldIds: CompetitionQuestionnaireFieldId[] = [
    ...COMPETITION_INITIAL_QUESTIONNAIRE_FIELD_IDS,
    ...(profile.confirmedFacts.includes("firstHigherEducationYear")
      ? (["firstHigherEducationYear"] as const)
      : [])
  ];

  return fieldIds.map((fieldId) => {
    const value = profile[fieldId as keyof CompetitionRecommendationProfileV5];
    if (value === undefined) {
      throw new Error(`Missing confirmed fixed-questionnaire value: ${fieldId}`);
    }
    return {
      fieldId,
      selectedValues: Array.isArray(value) ? [...value] : [String(value)]
    };
  });
}
