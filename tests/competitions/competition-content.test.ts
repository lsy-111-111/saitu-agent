import series from "@/content/competition-series-20261104.json";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { competitions } from "@/content/competitions";

const forbiddenAbsoluteClaims = ["必然加分", "一定加分", "固定加分", "保证加分"];
const forbiddenVisibleDisclosure = "AI生成配图｜赛途原创主题视觉，非赛事官方标识";

describe("competition detail content", () => {
  it("provides complete details for all competitions", () => {
    expect(competitions).toHaveLength(100 + series.length);

    for (const competition of competitions) {
      expect(competition.sourceUrl.trim()).not.toBe("");
      expect(competition.detail.intro.trim()).not.toBe("");
      expect(competition.detail.participationPath.trim()).not.toBe("");
      expect(competition.detail.userValue.trim()).not.toBe("");
      expect(competition.detail.suitableFor.length).toBeGreaterThanOrEqual(2);
      expect(competition.detail.suitableFor.every((item) => item.trim().length > 0)).toBe(true);
      expect(competition.detail.preparationTips.length).toBeGreaterThanOrEqual(2);
      expect(competition.detail.preparationTips.every((item) => item.trim().length > 0)).toBe(true);
      expect(competition.coverImage.src).toBe(`/competition-posters/${competition.id}.png`);
      expect(competition.coverImage.sourceSvgSrc).toBe(`/competition-posters/source/${competition.id}.svg`);
      expect(competition.coverImage.metadataSrc).toBe("/competition-posters/manifest.json");
      expect(competition.coverImage.alt.trim()).not.toBe("");
      expect(competition.coverImage.alt).not.toContain("原创主题视觉");
      expect(competition.coverImage.credit).toBe("");
      expect(competition.coverImage.origin).toBe("ai-generated");
      expect(competition.coverImage.rightsStatus).toBe("ai-generated-no-human-authorship-claim");
      expect(competition.coverImage.reviewStatus).toBe("editorial-review-passed");
      expect(competition.coverImage.reviewedAt).toBe(series.some(s => s.id === competition.id) ? "2026-11-04" : "2026-08-23");
      expect(competition.coverImage.aiGenerated).toBe(true);
      expect(competition.coverImage.humanReviewRequired).toBe(false);
    }

    expect(competitions.map((competition) => competition.coverImage.src)).toHaveLength(competitions.length);
    expect(new Set(competitions.map((competition) => competition.coverImage.src)).size).toBe(competitions.length);
  });

  it("provides local, equally sized and visually unique raster and vector assets", () => {
    const dimensions = new Set<string>();
    const pngHashes = new Set<string>();
    const svgHashes = new Set<string>();

    for (const competition of competitions) {
      const assetPath = path.join(process.cwd(), "public", competition.coverImage.src.replace(/^\//, ""));
      const sourcePath = path.join(process.cwd(), "public", competition.coverImage.sourceSvgSrc.replace(/^\//, ""));
      expect(existsSync(assetPath), `${competition.id} cover image exists`).toBe(true);
      expect(existsSync(sourcePath), `${competition.id} SVG source exists`).toBe(true);

      const asset = readFileSync(assetPath);
      const source = readFileSync(sourcePath, "utf8");
      expect(asset.subarray(1, 4).toString("ascii"), `${competition.id} is a PNG`).toBe("PNG");
      dimensions.add(`${asset.readUInt32BE(16)}x${asset.readUInt32BE(20)}`);
      pngHashes.add(createHash("sha256").update(asset).digest("hex"));
      svgHashes.add(createHash("sha256").update(source).digest("hex"));

      expect(asset.includes(Buffer.from("AIContent\0true; origin=ai-generated"))).toBe(true);
      const aigcOffset = asset.indexOf(Buffer.from("AIGC\0"));
      const imageDataOffset = asset.indexOf(Buffer.from("IDAT"));
      expect(aigcOffset, `${competition.id} has a GB 45438 AIGC metadata field`).toBeGreaterThan(0);
      expect(aigcOffset, `${competition.id} metadata precedes image data`).toBeLessThan(imageDataOffset);
      expect(asset.includes(Buffer.from('"Label":"1"'))).toBe(true);
      expect(asset.includes(Buffer.from('"ContentProducer":"Saitu Campus"'))).toBe(true);
      expect(asset.includes(Buffer.from('"ContentPropagator":"Saitu Campus"'))).toBe(true);
      expect(asset.includes(Buffer.from('"ProduceID":"'))).toBe(true);
      expect(asset.includes(Buffer.from('"PropagateID":"'))).toBe(true);
      expect(asset.includes(Buffer.from(forbiddenVisibleDisclosure, "utf8"))).toBe(false);
      expect(asset.includes(Buffer.from("Description\0", "latin1"))).toBe(false);
      expect(source).toContain('<metadata><![CDATA[{"id":');
      expect(source).toContain('"origin":"ai-generated"');
      expect(source).toContain('"humanAuthorshipClaimed":false');
      expect(source).not.toContain(forbiddenVisibleDisclosure);
      expect(source).not.toContain('class="disclosure"');
      expect(source).not.toMatch(/<(?:script|foreignObject)\b/i);
      expect(source).not.toMatch(/<(?:linearGradient|radialGradient)\b/i);
      expect(source).not.toMatch(/\b(?:href|xlink:href)\s*=/i);
      expect(source).not.toContain(competition.name);
    }

    expect(dimensions).toEqual(new Set(["1280x480"]));
    expect(pngHashes.size).toBe(competitions.length);
    expect(svgHashes.size).toBe(competitions.length);

    const posterDirectory = path.join(process.cwd(), "public", "competition-posters");
    const sourceDirectory = path.join(posterDirectory, "source");
    const eventPngIds = readdirSync(posterDirectory)
      .filter((name) => name.endsWith(".png") && name !== "overview.png")
      .map((name) => name.replace(/\.png$/, ""));
    const eventSvgIds = readdirSync(sourceDirectory)
      .filter((name) => name.endsWith(".svg"))
      .map((name) => name.replace(/\.svg$/, ""));
    const catalogIds = competitions.map((competition) => competition.id);

    expect(eventPngIds).toHaveLength(competitions.length);
    expect(eventSvgIds).toHaveLength(competitions.length);
    expect(new Set(eventPngIds)).toEqual(new Set(catalogIds));
    expect(new Set(eventSvgIds)).toEqual(new Set(catalogIds));
    expect(readdirSync(posterDirectory).filter((name) => name === "overview.png")).toHaveLength(1);
  });

  it("publishes a complete, hash-verified and honestly reviewed poster manifest", () => {
    const manifestPath = path.join(process.cwd(), "public", "competition-posters", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      schemaVersion: number;
      labelingStandard: string;
      visibleOriginLabel: boolean;
      implicitLabel: { keyword: string; placement: string };
      humanReview: { status: string; reviewedAt: string | null };
      editorialReview: { status: string; reviewedAt: string; reviewer: string; scope: string };
      entries: Array<{
        id: string;
        source: string;
        raster: string;
        sha256: { svg: string; png: string };
        rightsBasis: string;
        review: { checks: string[] };
        metadata: {
          origin: string;
          officialIdentityUsed: boolean;
          humanAuthorshipClaimed: boolean;
          implicitLabelStandard: string;
          implicitLabel: {
            Label: string;
            ContentProducer: string;
            ProduceID: string;
            ContentPropagator: string;
            PropagateID: string;
          };
        };
      }>;
    };

    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.labelingStandard).toBe("GB 45438-2025");
    expect(manifest.visibleOriginLabel).toBe(false);
    expect(manifest.implicitLabel).toEqual({ keyword: "AIGC", placement: "before first PNG IDAT chunk" });
    expect(manifest.humanReview).toEqual({ status: "not-claimed", reviewedAt: null });
    expect(manifest.editorialReview).toMatchObject({
      status: "assistant-reviewed-passed",
      reviewedAt: "2026-11-04",
      reviewer: "Codex visual audit"
    });
    expect(manifest.entries).toHaveLength(competitions.length);
    expect(new Set(manifest.entries.map((entry) => entry.id))).toEqual(new Set(competitions.map((entry) => entry.id)));
    expect(new Set(manifest.entries.map((entry) => entry.metadata.implicitLabel.ProduceID)).size).toBe(competitions.length);
    expect(JSON.stringify(manifest)).not.toContain(forbiddenVisibleDisclosure);

    for (const entry of manifest.entries) {
      const svg = readFileSync(path.join(process.cwd(), "public", entry.source.replace(/^\//, "")));
      const png = readFileSync(path.join(process.cwd(), "public", entry.raster.replace(/^\//, "")));
      expect(createHash("sha256").update(svg).digest("hex")).toBe(entry.sha256.svg);
      expect(createHash("sha256").update(png).digest("hex")).toBe(entry.sha256.png);
      expect(entry.metadata.origin).toBe("ai-generated");
      expect(entry.metadata.officialIdentityUsed).toBe(false);
      expect(entry.metadata.humanAuthorshipClaimed).toBe(false);
      expect(entry.metadata.implicitLabelStandard).toBe("GB 45438-2025");
      expect(entry.metadata.implicitLabel).toMatchObject({
        Label: "1",
        ContentProducer: "Saitu Campus",
        ContentPropagator: "Saitu Campus"
      });
      expect(entry.metadata.implicitLabel.ProduceID).toMatch(/^[a-f0-9]{32}$/);
      expect(entry.metadata.implicitLabel.PropagateID).toBe(entry.metadata.implicitLabel.ProduceID);
      expect(entry.review.checks).toContain("no-visible-origin-disclosure");
      expect(entry.rightsBasis).toContain("AI-assisted illustration");
    }
  });

  it("keeps benefit language conservative", () => {
    const allDetailText = competitions
      .flatMap((competition) => [
        competition.detail.intro,
        competition.detail.participationPath,
        competition.detail.userValue,
        ...competition.detail.suitableFor,
        ...competition.detail.preparationTips
      ])
      .join("\n");

    for (const claim of forbiddenAbsoluteClaims) {
      expect(allDetailText).not.toContain(claim);
    }

    expect(allDetailText).toContain("学校政策为准");
  });
});
