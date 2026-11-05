import { describe, expect, it } from "vitest";
import { competitions } from "@/content/competitions";
import { getCompetitionFactSheet } from "@/content/competition-facts";
import { getDocumentedCompetitionAvailability } from "@/lib/competitions/documented-availability";

function get(id: string) {
  const competition = competitions.find((entry) => entry.id === id);
  if (!competition) throw new Error(`Missing catalog record: ${id}`);
  return competition;
}

describe("dated and scoped competition evidence", () => {
  it("maps each catalog ID to a fact sheet and each published node to its source", () => {
    expect(competitions.length).toBeGreaterThanOrEqual(135);
    for (const competition of competitions) {
      const facts = getCompetitionFactSheet(competition.id);
      expect(facts, competition.id).toBeDefined();
      const urls = new Set(facts!.sources.map(source => source.url));
      expect(urls.size, competition.id).toBeGreaterThan(0);
      for (const node of facts!.nodes) expect(urls.has(node.sourceUrl), `${competition.id} ${node.date}`).toBe(true);
      for (const field of [facts!.eligibility, facts!.mentor, facts!.fee, facts!.team]) {
        for (const match of field.matchAll(/〔(\d+)〕/g)) {
          expect(facts!.sources[Number(match[1]) - 1]).toBeDefined();
        }
      }
    }
  });

  it("does not label all chemistry students eligible to register from one school's deadline", () => {
    const competition = get("chemistry-experiment-innovation");
    const sheet = getCompetitionFactSheet(competition.id)!;
    expect(sheet.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: expect.stringContaining("江西师范大学"), date: "2026-11-13 前" }),
      expect.objectContaining({ scope: expect.stringContaining("华中赛区"), date: "2027-01-31 前" })
    ]));
    expect(getDocumentedCompetitionAvailability(competition, new Date("2026-11-06T12:00:00+08:00")).registrationStatus.status).toBe("unknown");
  });

  it("labels only an evidenced student registration window as open", () => {
    const competition = get("energy-economics-academic-creativity");
    const state = (date: string) => getDocumentedCompetitionAvailability(competition, new Date(date)).registrationStatus.status;
    expect(state("2026-11-16T23:59:59+08:00")).toBe("upcoming");
    expect(state("2026-11-17T00:00:00+08:00")).toBe("open");
    expect(state("2026-12-17T00:00:00+08:00")).toBe("closed");
  });
});
