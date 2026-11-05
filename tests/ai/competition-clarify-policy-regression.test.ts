import { describe, expect, it } from "vitest";
import { competitionClarifyMaterialOutcomeSignature } from "../../src/lib/ai/competition-clarify";

describe("competition clarify materiality regressions", () => {
  it("does not make a goal question material when only a recommended track changes", () => {
    const first = {
      topThree: [
        { competitionId: "competition-a", recommendedTrackId: "track-a" },
        { competitionId: "competition-b", recommendedTrackId: null },
        { competitionId: "competition-c", recommendedTrackId: null }
      ]
    };
    const trackOnlyDifference = {
      topThree: [
        { competitionId: "competition-a", recommendedTrackId: "track-b" },
        { competitionId: "competition-b", recommendedTrackId: null },
        { competitionId: "competition-c", recommendedTrackId: null }
      ]
    };

    expect(competitionClarifyMaterialOutcomeSignature(
      "candidate-goal-tradeoff",
      first
    )).toBe(competitionClarifyMaterialOutcomeSignature(
      "candidate-goal-tradeoff",
      trackOnlyDifference
    ));
    expect(competitionClarifyMaterialOutcomeSignature(
      "competition-fit",
      first
    )).not.toBe(competitionClarifyMaterialOutcomeSignature(
      "competition-fit",
      trackOnlyDifference
    ));
  });

  it("still treats a changed Top3 member or relative order as a material goal result", () => {
    const baseline = {
      topThree: [
        { competitionId: "competition-a", recommendedTrackId: null },
        { competitionId: "competition-b", recommendedTrackId: null },
        { competitionId: "competition-c", recommendedTrackId: null }
      ]
    };
    const reordered = {
      topThree: [
        { competitionId: "competition-b", recommendedTrackId: null },
        { competitionId: "competition-a", recommendedTrackId: null },
        { competitionId: "competition-c", recommendedTrackId: null }
      ]
    };
    const changedMember = {
      topThree: [
        { competitionId: "competition-a", recommendedTrackId: null },
        { competitionId: "competition-b", recommendedTrackId: null },
        { competitionId: "competition-d", recommendedTrackId: null }
      ]
    };
    const baselineSignature = competitionClarifyMaterialOutcomeSignature(
      "candidate-goal-tradeoff",
      baseline
    );

    expect(competitionClarifyMaterialOutcomeSignature(
      "candidate-goal-tradeoff",
      reordered
    )).not.toBe(baselineSignature);
    expect(competitionClarifyMaterialOutcomeSignature(
      "candidate-goal-tradeoff",
      changedMember
    )).not.toBe(baselineSignature);
  });
});
