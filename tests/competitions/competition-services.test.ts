import { describe, expect, it } from "vitest";
import {
  competitionResourceTemplates,
  defaultCompetitionTeamAvailability
} from "@/content/competition-services";

describe("competition resource and team service states", () => {
  it("publishes exactly two planned resource types without empty file links", () => {
    expect(competitionResourceTemplates.map((resource) => resource.label)).toEqual([
      "路演 PPT",
      "商业计划书"
    ]);
    for (const resource of competitionResourceTemplates) {
      expect(resource.availability).toEqual({ status: "planned" });
      expect("href" in resource.availability).toBe(false);
    }
  });

  it("keeps the default team entry planned without QR or operator data", () => {
    expect(defaultCompetitionTeamAvailability).toEqual({ status: "planned" });
    expect("qrSrc" in defaultCompetitionTeamAvailability).toBe(false);
    expect("operator" in defaultCompetitionTeamAvailability).toBe(false);
  });
});
