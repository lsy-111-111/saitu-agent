import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import DirectoryPage from "@/app/(marketing)/competitions/page";
import SeriesPage, { generateMetadata } from "@/app/(marketing)/competitions/[id]/page";
import RecordPage from "@/app/(marketing)/competitions/records/[recordId]/page";
import sitemap from "@/app/sitemap";
import { getCompetitionCatalog } from "@/lib/competitions/catalog";
import { getDirectorySeries, getAdditionalDirectorySeries, findDirectorySeries } from "@/lib/competitions/directory-series";
import { getDecisionCatalog } from "@/lib/competitions/v6/catalog";
import { getPublishedDecisionRecords, resolvePublishedDecisionRoute } from "@/lib/competitions/v6/public-catalog";

const missingIds = ["geographical-science-innovation", "schneider-go-green", "meteorological-science-innovation", "real-estate-urban-renewal-planning", "national-software-testing", "hackharvard", "asme-sme-manufacturing-design", "psychology-undergraduate-innovation-forum", "china-data-journalism", "vocational-small-animal-clinical-skills", "national-supply-chain", "zhongshe-social-service-skills", "national-marine-knowledge", "national-student-network-culture", "william-lowell-putnam"];

describe("C 167 directory identities and 45 reviewed record boundary", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("lists all existing167 identities once and retains the135 legacy entries", () => {
    const series = getDirectorySeries();
    expect(series).toHaveLength(167);
    expect(new Set(series.map(item => item.seriesId)).size).toBe(167);
    expect(getAdditionalDirectorySeries()).toHaveLength(32);
    const byId = new Map(series.map(item => [item.seriesId, item]));
    for (const item of getCompetitionCatalog()) expect(byId.get(item.id)).toMatchObject({ seriesId: item.id, name: item.name, organizer: item.identity.organizer });
  });

  it("uses only existing basic identities and trusted scoped official sources for the15 missing series", () => {
    const records = getDecisionCatalog();
    for (const id of missingIds) {
      const item = findDirectorySeries(id)!, record = records.find(row => row.seriesId === id)!;
      expect(item.name).toBe(record.name); expect(item.organizer).toBe(record.organizer);
      const source = record.sources.find(row => row.url === item.officialSource?.url)!;
      expect(source).toMatchObject({ accessStatus: "body_read", integrity: "consistent" });
      expect(["organizer", "official_host"]).toContain(source.authority);
      expect(item.officialSource).toMatchObject({ url: source.url, title: source.title, publisher: source.publisher, scope: source.scope });
      expect(item.summary).toBe("具体任务、参赛资格、时间和费用尚待核对，请先查看已有官方资料。");
    }
  });

  it("renders15 basic series pages without publishing their unchecked full task text", async () => {
    for (const id of missingIds) {
      const params = Promise.resolve({ id }), series = findDirectorySeries(id)!;
      const html = renderToStaticMarkup(await SeriesPage({ params }));
      expect(html).toContain("series-basic-information");
      expect(html).toContain("查看官方资料（新窗口）");
      expect(html).toContain("具体任务、准备建议与完整参赛要求尚待核实");
      expect(html).not.toContain("decision-catalog-detail");
      expect(html).not.toContain("/competitions/records/");
      expect(JSON.stringify(await generateMetadata({ params }))).toContain(series.name);
    }
  });

  it("retains exactly45 checked record routes and leaves unreviewed exact records unavailable", async () => {
    const records = getPublishedDecisionRecords(); expect(records).toHaveLength(45);
    for (const record of records) expect(resolvePublishedDecisionRoute(encodeURIComponent(record.recordId))?.recordId).toBe(record.recordId);
    for (const id of missingIds) {
      const record = getDecisionCatalog().find(row => row.seriesId === id)!;
      expect(resolvePublishedDecisionRoute(record.recordId)).toBeUndefined();
    }
    const pending = getDecisionCatalog().find(record => record.seriesId === missingIds[0])!;
    await expect(RecordPage({ params: Promise.resolve({ recordId: pending.recordId }) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
    await expect(SeriesPage({ params: Promise.resolve({ id: "missing-competition-xyz" }) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("renders neutral additional listings and indexes all167 series without exposing pending record URLs", async () => {
    const html = renderToStaticMarkup(await DirectoryPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("目录共 167 个赛事系列");
    expect(html.match(/data-directory-series=/g)).toHaveLength(32);
    expect(html).toContain("更多赛事资料"); expect(html).not.toContain("更多已核对的赛事资料");
    const urls = sitemap().map(item => new URL(item.url).pathname).filter(url => url.startsWith("/competitions/"));
    expect(urls).toHaveLength(167); expect(new Set(urls).size).toBe(167);
    for (const id of missingIds) expect(urls).toContain(`/competitions/${id}`);
    expect(urls.some(url => url.startsWith("/competitions/records/"))).toBe(false);
  });
});
