import { describe, expect, it } from "vitest";
import { generateNextCompetitionQuestion } from "@/lib/ai/competition-clarify";
import { competitionDynamicQuestionFamilyV3 } from "@/lib/ai/competition-dynamic-question";
import { getCompetitionRecommendationCandidates } from "@/lib/competitions/recommendation-engine";
import { buildCompetitionQualificationSnapshot, scoreCompetitionRecommendations } from "@/lib/competitions/scoring";
import { getCompetitionCatalog } from "@/lib/competitions/catalog";
import type { CompetitionDynamicExchangeV3 } from "@/types/competition-recommendation";
import { competitionAnchorPersonas, QUALITY_BENCHMARK_NOW } from "../fixtures/competition-quality-personas";

// This checks factual invariance on actually generated paths. It does not
// replace the historical tests of exact question order or authored answers.
describe("qualification on reached legacy clarification paths", () => {
  it("checks every emitted track branch against its precomputed state without treating preferences as eligibility evidence", async () => {
    const ids = [
      "anchor-intercultural-competence", "anchor-understanding-contemporary-china-foreign-language",
      "anchor-graduate-rural-revitalization-agritech", "anchor-embedded-chip-system-design",
      "anchor-energy-conservation-emission-reduction", "anchor-21st-century-english-speaking",
      "anchor-national-innovation-training-annual",
    ];
    let reachedTrackBranches = 0;
    let unresolvedTrackBranches = 0;
    for (const id of ids) {
      const profile = competitionAnchorPersonas.find(persona => persona.id === id)!.profile;
      const snapshot = buildCompetitionQualificationSnapshot(profile, undefined, QUALITY_BENCHMARK_NOW);
      const before = structuredClone(snapshot);
      const transcript: CompetitionDynamicExchangeV3[] = [];
      const families = new Set<string>();
      for (let turn = 0; turn < 3; turn++) {
        const candidates = getCompetitionRecommendationCandidates(profile, { now: QUALITY_BENCHMARK_NOW, transcript }).recommendations;
        const response = await generateNextCompetitionQuestion(profile, transcript, candidates, [], snapshot, { now: QUALITY_BENCHMARK_NOW });
        if (!response.nextQuestion) break;
        const question = response.nextQuestion;
        const family = competitionDynamicQuestionFamilyV3(question.signalKey);
        expect(families.has(family), `${id}: no repeated question family`).toBe(false);
        families.add(family);
        if (question.signalKey.startsWith("track:")) {
          const targetId = question.signalKey.slice("track:".length);
          const entry = before.entries.find(entry => entry.competitionId === targetId)!;
          expect(entry).toBeDefined();
          for (const option of question.options) {
            const state = entry.tracks.find(track => track.trackId === option.value)!;
            expect(state).toBeDefined();
            expect(state.status).not.toBe("ineligible");
            const branch = [...transcript, { question, answer: { selectedValues: [option.value] } }];
            const result = scoreCompetitionRecommendations(getCompetitionCatalog(), profile, { now: QUALITY_BENCHMARK_NOW, transcript: branch })
              .find(result => result.competition.id === targetId)!;
            expect(result, `${id}/${option.value}: target remains in the eligible scoring pool`).toBeDefined();
            expect(result.recommendedTrack?.id).toBe(option.value);
            expect(result.eligibility.status).toBe(state.status);
            expect(result.eligibility.reasons).toEqual(state.reasons);
            reachedTrackBranches++;
            if (state.status === "needs_clarification") unresolvedTrackBranches++;
          }
        }
        // Follow one real server-whitelisted branch; never substitute a stale
        // authored answer that the server did not present in this context.
        transcript.push({ question, answer: { selectedValues: [question.options[0]!.value] } });
        expect(snapshot).toEqual(before);
      }
      expect(transcript.length).toBeLessThanOrEqual(3);
    }
    expect(reachedTrackBranches).toBeGreaterThan(0);
    expect(unresolvedTrackBranches).toBeGreaterThan(0);
  }, 30_000);
});
