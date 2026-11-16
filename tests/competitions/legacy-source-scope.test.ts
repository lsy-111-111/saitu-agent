import { describe, expect, it } from "vitest";
import { competitions } from "@/content/competitions";
import { getCompetitionFactSheet } from "@/content/competition-facts";
import { competitionAnchorPersonas } from "../fixtures/competition-quality-personas";
import { buildCompetitionQualificationSnapshot } from "@/lib/competitions/scoring";
import { getDecisionCatalog } from "@/lib/competitions/v6/catalog";
import type { CompetitionRecommendationProfileV5 } from "@/types/competition-recommendation";

const base: CompetitionRecommendationProfileV5 = {
  ...competitionAnchorPersonas[0].profile,
  stage: "undergraduate-2", teamStatus: "ready", enrollmentStatus: "full-time-student",
  teamUnit: "same-unit", teamSize: "three",
  confirmedFacts: ["enrollmentStatus", "teamUnit", "teamSize"], decisionContext: { fixedTeam: true }
};
function assess(id: string, change: Partial<CompetitionRecommendationProfileV5> = {}) {
  return buildCompetitionQualificationSnapshot({ ...base, ...change }, competitions.filter(c => c.id === id)).entries[0];
}
function track(entry: ReturnType<typeof assess>, id: string) { return entry.tracks.find(t => t.trackId === id)!; }
const records = getDecisionCatalog();

describe("source scope corrections reach actual qualification and detail data", () => {
  it("does not lend the teacher individual category to a fixed solo student", () => {
    expect(assess("business-elite-innovation", { teamStatus: "solo", teamSize: "solo" }).hardFilterReason).toBe("team-size-ineligible");
    expect(assess("business-elite-innovation").hardFilterReason).toBeNull();
    expect(assess("business-elite-innovation").status).toBe("needs_clarification");
  });
  it("keeps the limited doctoral exception unresolved and rejects natural science doctoral entries", () => {
    const result = assess("challenge-cup-academic-science", { stage: "doctorate" });
    expect(track(result, "natural-science-paper").hardFilterReason).toBe("stage-ineligible");
    expect(track(result, "social-survey").status).toBe("needs_clarification");
    expect(track(result, "technology-invention").status).toBe("needs_clarification");
  });
  it("applies the five-person undergraduate inquiry rule separately from six-person college innovation", () => {
    const vocational = assess("culsc-life-sciences", { stage: "vocational" });
    expect(track(vocational, "scientific-inquiry").hardFilterReason).toBe("stage-ineligible");
    for (const id of ["biological-innovation", "biological-venture"]) {
      expect(track(vocational, id).hardFilterReason).toBeNull();
      expect(track(vocational, id).status).toBe("needs_clarification");
    }
    const large = assess("culsc-life-sciences", { teamSize: "over-five" });
    expect(track(large, "scientific-inquiry").hardFilterReason).toBe("team-size-ineligible");
    // over-five does not prove an exact team of six, so it remains unresolved, never eligible.
    for (const id of ["biological-innovation", "biological-venture"]) {
      expect(track(large, id).hardFilterReason).toBeNull();
      expect(track(large, id).status).toBe("needs_clarification");
    }
  });
  it("does not enforce last-edition BIM team size on an unselected new module", () => {
    const result = assess("bim-graduation-design", { teamSize: "over-five" });
    expect(result.hardFilterReason).toBeNull();
    expect(result.status).toBe("needs_clarification");
    expect(getCompetitionFactSheet("bim-graduation-design")!.fee).toContain("80");
    const r = records.find(r => r.seriesId === "bim-graduation-design")!;
    expect(r.cost?.maximumPersonalCny ?? null).toBeNull();
  });
  it("binds innovation and inquiry amounts and sources to the actual distinct records", () => {
    const life = records.filter(r => r.seriesId === "culsc-life-sciences");
    expect(life).toHaveLength(3);
    for (const r of life) {
      const fee = r.facts.find(f => f.id === "culsc-life-sciences:legacy:fact:fee")!;
      const inquiry = r.track.id === "scientific-inquiry";
      expect(fee.text).toContain(inquiry ? "400" : "320");
      expect(fee.sourceIds).toEqual([`culsc-life-sciences:legacy:source:${inquiry ? 1 : 2}`]);
      expect(fee.entity?.trackId).toBe(r.track.id);
      expect(r.cost?.maximumPersonalCny ?? null).toBeNull();
    }
  });
  it("does not certify six non-industrial tracks using industrial eligibility", () => {
    const rows = records.filter(r => r.seriesId === "china-international-college-innovation");
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      const fact = r.facts.find(f => f.id.endsWith(":legacy:fact:eligibility"))!;
      expect(fact.kind).toBe("unknown");
      expect(fact.sourceIds).toEqual([]);
      expect(fact.entity?.trackId).toBe(r.track.id);
      expect(r.contentTier).toBe("L1");
    }
  });
  it("preserves 2026 national reference identity inside the 2025 local classics case", () => {
    const r = records.find(r => r.seriesId === "chinese-classics" && r.track.id === "classics-recitation")!;
    for (const id of ["eligibility", "team", "mentor", "fee"]) {
      const f = r.facts.find(f => f.id === `chinese-classics:legacy:fact:${id}`)!;
      expect(f.entity).toEqual({ editionId: "2026-national-8", trackId: "multi-event-reference", groupId: "source-defined-groups", scopeId: "china-national" });
      expect(f.status).toBe(id === "team" || id === "fee" ? "unknown" : "pending_review");
    }
    expect(r.cost?.maximumPersonalCny ?? null).toBeNull();
  });
});
