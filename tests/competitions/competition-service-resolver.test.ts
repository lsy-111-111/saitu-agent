import { describe, expect, it } from "vitest";
import { competitions } from "@/content/competitions";
import { resolveCompetitionService } from "@/lib/competitions/service-resolver";

describe("competition service resolver", () => {
  it("resolves catalog competitions to the truthful planned resource and team states", () => {
    const competition = competitions[0];
    const resolved = resolveCompetitionService(competition.id);

    expect(resolved).toMatchObject({
      competitionId: competition.id,
      knownCompetition: true,
      name: competition.name,
      sourceUrl: competition.sourceUrl,
      team: { status: "planned" }
    });
    expect(resolved.resources.map((resource) => [
      resource.label,
      resource.availability.status
    ])).toEqual([
      ["路演 PPT", "planned"],
      ["商业计划书", "planned"]
    ]);
  });

  it("keeps unknown recommendation ids visible but marks every service unavailable", () => {
    const resolved = resolveCompetitionService("synthetic-unknown", {
      category: "合成类别",
      name: "合成竞赛",
      sourceUrl: "https://example.com/synthetic-unknown"
    });

    expect(resolved).toMatchObject({
      competitionId: "synthetic-unknown",
      knownCompetition: false,
      name: "合成竞赛",
      category: "合成类别",
      sourceUrl: "https://example.com/synthetic-unknown",
      team: { status: "unavailable" }
    });
    expect(resolved.resources).toHaveLength(2);
    expect(resolved.resources.every((resource) => (
      resource.availability.status === "unavailable"
    ))).toBe(true);
  });

  it("resolves retired saved IDs to replacement services without admitting them as canonical IDs", () => {
    expect(resolveCompetitionService("china-medical-skills")).toMatchObject({
      competitionId: "graduate-cybersecurity-innovation",
      knownCompetition: true,
      name: "中国研究生网络安全创新大赛"
    });
    expect(resolveCompetitionService("ai-application-scenarios")).toMatchObject({
      competitionId: "graduate-rural-revitalization-agritech",
      knownCompetition: true,
      name: "中国研究生乡村振兴科技强农+创新大赛第五届科技作品竞赛"
    });
  });
});
