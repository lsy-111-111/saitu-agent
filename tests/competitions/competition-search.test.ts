import { describe, expect, it } from "vitest";
import { competitions } from "@/content/competitions";
import {
  ALL_COMPETITION_DIRECTIONS,
  COMPETITION_QUERY_MAX_LENGTH,
  buildCompetitionDirectoryUrl,
  filterCompetitions,
  parseCompetitionDirection,
  parseCompetitionPage,
  parseCompetitionQuery,
  tokenizeCompetitionSearch
} from "@/lib/competitions/search";

describe("competition directory search", () => {
  it("normalizes NFKC, ignores English casing, and splits whitespace", () => {
    expect(tokenizeCompetitionSearch("  ＩＯＴ\n传感器  ")).toEqual(["iot", "传感器"]);

    const matches = filterCompetitions(
      competitions,
      "ＩＯＴ 传感器",
      ALL_COMPETITION_DIRECTIONS
    );

    expect(matches.map((competition) => competition.id)).toEqual(["iot-design"]);
    expect(
      filterCompetitions(competitions, "3d", ALL_COMPETITION_DIRECTIONS).map(
        (competition) => competition.id
      )
    ).toEqual(["3d-digital-innovation-design"]);
  });

  it("requires every query term across the searchable card fields", () => {
    const matches = filterCompetitions(
      competitions,
      "飞行器 工程",
      ALL_COMPETITION_DIRECTIONS
    );

    expect(matches.map((competition) => competition.id)).toEqual([
      "future-aircraft-design"
    ]);
    expect(filterCompetitions(competitions, "飞行器 商业", ALL_COMPETITION_DIRECTIONS)).toEqual([]);
  });

  it("combines query and direction with AND while preserving catalog order", () => {
    const unfilteredIds = filterCompetitions(
      competitions,
      "",
      ALL_COMPETITION_DIRECTIONS
    ).map((competition) => competition.id);
    const expectedDirectionIds = competitions
      .filter((competition) => competition.direction === "工程与制造")
      .map((competition) => competition.id);

    expect(unfilteredIds).toEqual(competitions.map((competition) => competition.id));
    expect(
      filterCompetitions(competitions, "", "工程与制造").map(
        (competition) => competition.id
      )
    ).toEqual(expectedDirectionIds);
    expect(
      filterCompetitions(competitions, "机械", "工程与制造").map(
        (competition) => competition.id
      )
    ).toEqual([
      "advanced-graphics-bim",
      "future-aircraft-design",
      "mechanical-innovation-design",
      "mechanical-engineering-innovation",
      "smart-agricultural-equipment",
      "robomaster-university"
    ]);
  });

  it("validates server-provided URL values and caps queries at 80 characters", () => {
    expect(parseCompetitionDirection("工程与制造")).toBe("工程与制造");
    expect(parseCompetitionDirection("不存在的方向")).toBe(ALL_COMPETITION_DIRECTIONS);
    expect(parseCompetitionDirection(["人工智能与物联", "工程与制造"])).toBe(
      "人工智能与物联"
    );
    expect(parseCompetitionQuery(["  ＡＩ 应用  ", "ignored"])).toBe("AI 应用");
    expect(parseCompetitionQuery("竞".repeat(100))).toHaveLength(
      COMPETITION_QUERY_MAX_LENGTH
    );
    expect(parseCompetitionPage("3")).toBe(3);
    expect(parseCompetitionPage(["4", "2"])).toBe(4);
    expect(parseCompetitionPage("0")).toBe(1);
    expect(parseCompetitionPage("2abc")).toBe(1);
  });

  it("updates only directory params while retaining unrelated params and the hash", () => {
    const filteredUrl = buildCompetitionDirectoryUrl(
      "https://example.com/competitions?campaign=campus&unused=1#competition-directory-title",
      { query: "  ＡＩ 应用  ", direction: "人工智能与物联", page: 3 }
    );
    const filtered = new URL(filteredUrl, "https://example.com");

    expect(filtered.pathname).toBe("/competitions");
    expect(filtered.searchParams.get("campaign")).toBe("campus");
    expect(filtered.searchParams.get("unused")).toBe("1");
    expect(filtered.searchParams.get("q")).toBe("AI 应用");
    expect(filtered.searchParams.get("direction")).toBe("人工智能与物联");
    expect(filtered.searchParams.get("page")).toBe("3");
    expect(filtered.hash).toBe("#competition-directory-title");

    const clearedUrl = buildCompetitionDirectoryUrl(
      `https://example.com${filteredUrl}`,
      { query: "   ", direction: ALL_COMPETITION_DIRECTIONS, page: 1 }
    );
    const cleared = new URL(clearedUrl, "https://example.com");

    expect(cleared.searchParams.has("q")).toBe(false);
    expect(cleared.searchParams.has("direction")).toBe(false);
    expect(cleared.searchParams.has("page")).toBe(false);
    expect(cleared.searchParams.get("campaign")).toBe("campus");
    expect(cleared.hash).toBe("#competition-directory-title");
  });
});
