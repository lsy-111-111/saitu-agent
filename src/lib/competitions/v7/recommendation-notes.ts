import type { DecisionRecommendationV6 } from "../v6/contracts";

/** Specific limits carried in the existing eligibilityNotes field. */
export const RECOMMENDATION_ADVISORY_PREFIXES = {
  eligibility: "参赛提醒：",
  budget: "预算提醒：",
  task: "任务边界：",
} as const;

const advisoryPrefixes = Object.values(RECOMMENDATION_ADVISORY_PREFIXES);

export function displayedRecommendationAdvisoriesV7(
  item: Pick<DecisionRecommendationV6, "eligibilityNotes" | "gaps" | "evidenceFacts" | "sources">,
) {
  const seen = new Set<string>();
  const sourceIds = new Set(item.sources.map(source => source.id));
  const supported = new Set(item.evidenceFacts.filter(fact => fact.kind === "official_fact" &&
    fact.sourceIds.length > 0 && fact.sourceIds.every(id => sourceIds.has(id))).map(fact => fact.id));
  return item.eligibilityNotes.flatMap((text, noteIndex) => {
    if (seen.has(text) || !advisoryPrefixes.some(prefix => text.startsWith(prefix))) return [];
    seen.add(text);
    const claimIndex = item.gaps.findIndex(claim => claim.text === text && claim.competitionFactIds.length > 0 &&
      claim.competitionFactIds.every(id => supported.has(id)));
    return [{ text, noteIndex, claimIndex, claim: claimIndex >= 0 ? item.gaps[claimIndex] : undefined }];
  });
}
