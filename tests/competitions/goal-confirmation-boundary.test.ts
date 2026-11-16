import { describe, expect, it } from "vitest";
import { competitions } from "@/content/competitions";
import { scoreCompetitionRecommendations } from "@/lib/competitions/scoring";
import type { CompetitionDynamicExchangeV3, CompetitionRecommendationProfileV5 } from "@/types/competition-recommendation";
import { competitionAnchorPersonas, QUALITY_BENCHMARK_NOW } from "../fixtures/competition-quality-personas";

const base = competitionAnchorPersonas.find(item => item.id === "anchor-understanding-contemporary-china-foreign-language")!.profile;
// Remove track refinement so this test observes the priority boundary itself across the complete catalog.
const catalog = competitions.map(item => ({ ...item, recommendation: { ...item.recommendation, tracks: [] } }));
const score = (profile: CompetitionRecommendationProfileV5, transcript: CompetitionDynamicExchangeV3[] = []) =>
  scoreCompetitionRecommendations(catalog, profile, { now: QUALITY_BENCHMARK_NOW, transcript });
const project = (results: ReturnType<typeof score>) => results.map(item => ({
  id: item.competition.id, score: item.baseMatchScore, fit: item.decisionFit,
}));
function assertUnknown(profile: CompetitionRecommendationProfileV5) {
  const results = score(profile);
  expect(results.length).toBeGreaterThan(50);
  for (const item of results) {
    expect(item.decisionFit!.dimensions.goal, item.competition.id).toBe(0);
    expect(item.decisionFit!.evidence.goal, item.competition.id).toEqual([]);
    expect(item.decisionFit!.upper - item.decisionFit!.lower, item.competition.id).toBeGreaterThanOrEqual(29.9);
  }
  return results;
}

describe("confirmed goal priority in production scoring", () => {
  it("keeps undecided priorities unknown and invariant to goal order, even with a stale primary goal", () => {
    const profile: CompetitionRecommendationProfileV5 = { ...base, goals: ["portfolio", "employment"],
      decisionContext: { goalResolution: "undecided", primaryGoal: "portfolio" } };
    const first = assertUnknown(profile);
    expect(project(assertUnknown({ ...profile, goals: ["employment", "portfolio"] }))).toEqual(project(first));
  });

  it("does not score unconfirmed defaults or choose a priority from multiple confirmed goals", () => {
    const absent = project(assertUnknown({ ...base, goals: [], decisionContext: undefined }));
    expect(project(assertUnknown({ ...base, goals: ["employment"], decisionContext: undefined,
      confirmedFields: base.confirmedFields.filter(field => field !== "goals") }))).toEqual(absent);
    assertUnknown({ ...base, goals: ["employment", "portfolio"], decisionContext: undefined,
      confirmedFields: [...new Set([...base.confirmedFields, "goals" as const])] });
  });

  it("uses a confirmed single goal and an explicit resolved intent consistently", () => {
    const single = { ...base, goals: ["employment" as const], decisionContext: undefined,
      confirmedFields: [...new Set([...base.confirmedFields, "goals" as const])] };
    const results = score(single);
    expect(results.some(item => item.decisionFit!.dimensions.goal > 0)).toBe(true);
    expect(project(score({ ...single, goals: ["portfolio", "employment"],
      decisionContext: { goalIntent: "employment", goalResolution: "confirmed", primaryGoal: "portfolio" } }))).toEqual(project(results));
    expect(project(score({ ...single, goals: ["portfolio", "employment"],
      decisionContext: { primaryGoal: "employment" } }))).toEqual(project(results));
  });

  it("does not convert unresolved, exploration, skill, or award intents to known goal points", () => {
    assertUnknown({ ...base, goals: ["employment"], decisionContext: { goalIntent: "employment", primaryGoal: "employment" } });
    for (const goalIntent of ["explore", "skill", "award"] as const) {
      assertUnknown({ ...base, goals: ["employment"], decisionContext: { goalIntent, goalResolution: "confirmed", primaryGoal: "employment" } });
    }
  });

  it("allows a later explicit tradeoff answer to resolve an undecided priority", () => {
    const transcript: CompetitionDynamicExchangeV3[] = [{ question: {
      questionId: "confirm-goal", signalKey: "candidate-goal-tradeoff", prompt: "现在确认优先哪个目标？",
      selection: "single", options: [{ value: "employment", label: "就业准备" }, { value: "portfolio", label: "作品积累" }],
      allowsNote: true, maxNoteLength: 120, impact: "material", estimatedPreferenceOutcomeChanges: 2,
    }, answer: { selectedValues: ["employment"] } }];
    const profile: CompetitionRecommendationProfileV5 = { ...base, goals: ["portfolio", "employment"],
      decisionContext: { goalResolution: "undecided", primaryGoal: "portfolio" } };
    assertUnknown(profile);
    expect(project(score(profile, transcript))).toEqual(project(score({ ...profile,
      decisionContext: { primaryGoal: "employment", goalResolution: "confirmed" } })));
  });
});
