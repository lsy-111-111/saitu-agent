import { describe, expect, it } from "vitest";
import { buildCompetitionRankingPromptCandidates } from "@/lib/ai/competition-ranking";
import {
  getCompetitionRecommendationCandidates,
  selectFinalQualityRecommendations
} from "@/lib/competitions/recommendation-engine";
import {
  assessCompetitionConfirmedSubjectAlignment,
  hasDominantConfirmedSubjectMatch,
  semanticArchetypeFit
} from "@/lib/competitions/scoring";
import type { CompetitionDynamicExchangeV3 } from "@/types/competition-recommendation";
import {
  deepSeekLivePersonas,
  type DeepSeekLivePersona
} from "../fixtures/deepseek-live-personas";

function fitTranscript(persona: DeepSeekLivePersona): CompetitionDynamicExchangeV3[] {
  return [{
    question: {
      questionId: `regression_fit_${persona.id}`,
      signalKey: "competition-fit",
      prompt: "你最希望重点证明哪一类实战能力？",
      selection: "multiple",
      maxSelections: Math.min(2, persona.preferredFitSignals.length),
      options: persona.preferredFitSignals.map((value) => ({ value, label: value })),
      allowsNote: true,
      maxNoteLength: 120,
      impact: "material",
      estimatedPreferenceOutcomeChanges: 2
    },
    answer: { selectedValues: [...persona.preferredFitSignals] }
  }];
}

function persona(id: string) {
  const found = deepSeekLivePersonas.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing live regression persona: ${id}`);
  return found;
}

describe("live ranking regressions", () => {
  it.each([
    "vocational-career-language",
    "undergraduate-lower-career-language"
  ])("keeps a confirmed career task ahead of broadly related language events for %s", (personaId) => {
    const current = persona(personaId);
    const transcript = fitTranscript(current);
    const recalled = getCompetitionRecommendationCandidates(current.profile, { transcript }).recommendations;
    const deliberatelyAdverseModelOrder = [
      ...recalled.filter(({ competitionId }) => competitionId === "understanding-contemporary-china-foreign-language"),
      ...recalled.filter(({ competitionId }) => competitionId !== "understanding-contemporary-china-foreign-language")
    ];

    const final = selectFinalQualityRecommendations(
      deliberatelyAdverseModelOrder,
      current.profile,
      transcript
    );

    expect(final[0]?.competitionId, JSON.stringify(recalled.map((item) => ({
      id: item.competitionId,
      base: item.baseMatchScore,
      subjectTask: item.scoreBreakdown.subjectTask,
      archetype: semanticArchetypeFit(item.competition, current.profile),
      fitSignals: item.competition.recommendation.fit?.signals ?? []
    })))).toBe("career-planning");
    expect(
      final.every(({ competition }) =>
        hasDominantConfirmedSubjectMatch(
          assessCompetitionConfirmedSubjectAlignment(competition, current.profile)
        ) ||
        (semanticArchetypeFit(competition, current.profile) ?? 0) > 0
      ),
      `final=${final.map(({ competitionId, competition }) => `${competitionId}:${semanticArchetypeFit(competition, current.profile)}`).join(",")}`
    ).toBe(true);
  });

  it("keeps the robotics Top10 protocol complete while bounding ranking context", () => {
    const current = persona("undergraduate-lower-robotics");
    const transcript = fitTranscript(current);
    const recalled = getCompetitionRecommendationCandidates(current.profile, { transcript }).recommendations;
    const promptCandidates = buildCompetitionRankingPromptCandidates(
      current.profile,
      transcript,
      recalled
    );

    expect(promptCandidates).toHaveLength(10);
    expect(new Set(promptCandidates.map(({ competitionId }) => competitionId)).size).toBe(10);
    const promptCandidateBytes = Buffer.byteLength(JSON.stringify(promptCandidates), "utf8");
    expect(promptCandidateBytes).toBeLessThan(36 * 1024);
    expect(promptCandidates.every(({ evidenceCatalog }) => evidenceCatalog.length <= 11)).toBe(true);
    expect(promptCandidates.some(({ confirmedFitSignalAssessment }) =>
      confirmedFitSignalAssessment.matched.includes("robotics-integration")
    )).toBe(true);

    const deterministicFinal = selectFinalQualityRecommendations(recalled, current.profile, transcript);
    expect(deterministicFinal.length).toBeGreaterThan(0);
    expect(deterministicFinal.every(({ competition }) =>
      hasDominantConfirmedSubjectMatch(
        assessCompetitionConfirmedSubjectAlignment(competition, current.profile)
      ) ||
      (semanticArchetypeFit(competition, current.profile) ?? 0) > 0
    )).toBe(true);
  });

  it("keeps a confirmed agriculture primary discipline ahead of generic robotics overlap", () => {
    const current = persona("doctorate-agriculture-environment");
    const transcript = fitTranscript(current).map((exchange) => ({
      ...exchange,
      answer: { selectedValues: exchange.answer.selectedValues.slice(0, 2) }
    }));
    const recalled = getCompetitionRecommendationCandidates(current.profile, { transcript }).recommendations;
    const promptCandidates = buildCompetitionRankingPromptCandidates(
      current.profile,
      transcript,
      recalled
    );
    const smartAgriculture = promptCandidates.find(
      ({ competitionId }) => competitionId === "smart-agricultural-equipment"
    );
    const genericRobot = promptCandidates.find(
      ({ competitionId }) => competitionId === "intelligent-robot-creativity"
    );
    const deliberatelyAdverseModelOrder = [
      ...recalled.filter(({ competitionId }) => competitionId === "intelligent-robot-creativity"),
      ...recalled.filter(({ competitionId }) => competitionId !== "intelligent-robot-creativity")
    ];
    const final = selectFinalQualityRecommendations(
      deliberatelyAdverseModelOrder,
      current.profile,
      transcript
    );

    expect(recalled.map(({ competitionId }) => competitionId)).toContain("smart-agricultural-equipment");
    expect(smartAgriculture?.confirmedSubjectAssessment).toMatchObject({
      matchedPrimaryMajors: ["agriculture-environment"],
    });
    expect(genericRobot?.confirmedSubjectAssessment?.matchedPrimaryMajors ?? []).toEqual([]);
    expect(smartAgriculture?.confirmedFitSignalAssessment.matched).toEqual([
      "sustainability-impact",
      "hardware-build"
    ]);
    expect(smartAgriculture?.evidenceCatalog.some(({ ref }) =>
      ref === "profile.major:agriculture-environment"
    )).toBe(true);
    expect(final[0]?.competitionId, JSON.stringify(recalled.map((item) => ({
      id: item.competitionId,
      base: item.baseMatchScore,
      subjectTask: item.scoreBreakdown.subjectTask,
      archetype: semanticArchetypeFit(item.competition, current.profile),
      fitSignals: item.competition.recommendation.fit?.signals ?? []
    })))).toBe("smart-agricultural-equipment");
    expect(
      final.every(({ competition }) =>
        hasDominantConfirmedSubjectMatch(
          assessCompetitionConfirmedSubjectAlignment(competition, current.profile)
        ) ||
        (semanticArchetypeFit(competition, current.profile) ?? 0) > 0
      ),
      `final=${final.map(({ competitionId, competition }) => `${competitionId}:${semanticArchetypeFit(competition, current.profile)}`).join(",")}`
    ).toBe(true);
  });
});
