import { describe, expect, it } from "vitest";
import { competitions, type Competition } from "@/content/competitions";
import { COMPETITION_QUESTIONNAIRE_FIELD_SPECS } from "@/lib/ai/competition-questionnaire";
import { getHardFilterReason, scoreCompetition } from "@/lib/competitions/scoring";
import {
  COMPETITION_PROFILE_FIELD_IDS,
  type CompetitionRecommendationProfileV5,
  type CompetitionTeamSize
} from "@/types/competition-recommendation";

const officialTeamSource = {
  url: "https://example.edu.cn/official-team-rules",
  sourceType: "education-authority" as const,
  verifiedAt: "2026-08-23",
  evidenceRef: "official:exact-four-fixture:team-rules",
  facts: ["identity", "eligibility", "teamRequirement"] as const
};

const exactFourCompetition: Competition = {
  ...competitions.find(({ id }) => id === "china-software-cup")!,
  recommendation: {
    ...competitions.find(({ id }) => id === "china-software-cup")!.recommendation,
    source: officialTeamSource,
    teamRequirement: { state: "known", mode: "team", minSize: 4, maxSize: 4 },
    eligibility: { state: "verified", notes: [], source: officialTeamSource }
  }
};

function profileWithTeamSize(teamSize: CompetitionTeamSize): CompetitionRecommendationProfileV5 {
  return {
    profileVersion: "competition-profile.v5",
    questionnaireVersion: "competition-questionnaire.v1",
    confirmedFields: [...COMPETITION_PROFILE_FIELD_IDS],
    decisionContext: {fixedTeam: true},
    confirmedFacts: ["teamSize"],
    stage: "undergraduate-3",
    majorFields: ["computer-science"],
    specificSubjects: ["information-communication"],
    skills: ["programming", "product"],
    interests: ["innovation"],
    goals: ["project"],
    preferredOutputs: ["software"],
    startingPoint: "prototype",
    weeklyCommitment: "5-10",
    teamStatus: "ready",
    availableResources: ["mentor"],
    participationMode: "flexible",
    participationTiming: "flexible",
    taskFormats: ["software"],
    experienceLevel: "project-or-award",
    evidence: ["project"],
    teamSize
  };
}

describe("precise competition team sizes", () => {
  it("offers exact four/five values while keeping the legacy range hidden", () => {
    expect(COMPETITION_QUESTIONNAIRE_FIELD_SPECS.teamSize.options.map(({ value }) => value)).toEqual([
      "solo", "two", "three", "four", "five", "over-five", "unsure"
    ]);
  });

  it("does not upgrade an ambiguous legacy range to exact-four eligibility", () => {
    expect(scoreCompetition(exactFourCompetition, profileWithTeamSize("four-five"))?.eligibility.status)
      .toBe("needs_clarification");
    expect(scoreCompetition(exactFourCompetition, profileWithTeamSize("four"))?.eligibility.status)
      .toBe("eligible");
    expect(getHardFilterReason(exactFourCompetition, profileWithTeamSize("five")))
      .toBe("team-size-ineligible");
  });
});
