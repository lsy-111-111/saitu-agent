export const FAST24_MATCH_POLICY_VERSION = "saitu.fast24.substantive-match.v1";

export function hasFast24RecommendationCount(count) {
  return Number.isInteger(count) && count >= 1 && count <= 5;
}

/** Separate, practical 24-hour acceptance line. Historical formal policy is unchanged. */
export const FAST24 = Object.freeze({
  version: "fast24-v1", seed: 20261109,
  groups: ["software_data", "engineering_design", "experimental_agriculture", "business_practice", "survey_education", "arts_language"],
  counts: { constraint_check: 300, ranking: 24, fact_check: 24, extract_profile: 24, conversation: 12, robustness: 12 },
  repetitions: 2, blindPairsPerGroup: 2,
  thresholds: { completeCReports: 46, expectedCReports: 48, top5Fit: .90, minimumGroupFit: .80,
    top5SeriesJaccard: .80, distinctFacts: 100, factAccuracy: .98, citationPrecision: .98,
    citationCoverage: .95, criticalFactAndCitationCoverage: 1, profileMicroF1: .95,
    correctionSuccess: 1, correctionIsolation: 1, conversationPasses: 11, robustnessPasses: 11,
    blindCNotWorsePairs: 10, blindPairs: 12 },
  productSource: "artifacts/continuation-v7-20261109/challenge-author/private/producer-wrappers/product.json",
  rankingSource: "artifacts/continuation-v7-20261109/challenge-author/private/producer-wrappers/ranking.json",
  developmentExclusions: "artifacts/continuation-v7-20261109/evaluation/formal-preparation/assembly-v5/public-development-manifest.draft.safe.json",
  output: "artifacts/fast24-20261109/D", e5Cache: "/Users/jiumian/.cache/saitu/e5",
});
