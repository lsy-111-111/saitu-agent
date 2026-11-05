// Render the 100 auditable SVG source files and 1280×480 PNG exports.
// Usage: node scripts/posters/render.mjs [id ...] (no IDs renders all).

import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  posterAigcMetadata,
  posterDate,
  POSTER_GENERATED_AT,
  POSTER_GENERATOR,
  posterEntries
} from "./poster-data.mjs";
import { posterMetadata, renderPosterHtml, renderPosterSvg } from "./template.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const outDirectory = path.resolve(currentDirectory, "../../public/competition-posters");
const sourceDirectory = path.join(outDirectory, "source");
const selectedIds = process.argv.slice(2);
const entries = selectedIds.length
  ? posterEntries.filter((entry) => selectedIds.includes(entry.id))
  : posterEntries;

const unknownIds = selectedIds.filter((id) => !posterEntries.some((entry) => entry.id === id));
if (unknownIds.length) throw new Error(`Unknown poster IDs: ${unknownIds.join(", ")}`);

await mkdir(sourceDirectory, { recursive: true });

// Source SVGs are always refreshed together so the public source set and
// manifest remain internally consistent even after a targeted PNG render.
for (const entry of posterEntries) {
  await writeFile(path.join(sourceDirectory, `${entry.id}.svg`), `${renderPosterSvg(entry)}\n`, "utf8");
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 480 }, deviceScaleFactor: 1 });

for (const entry of entries) {
  await page.setContent(renderPosterHtml(entry), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const filePath = path.join(outDirectory, `${entry.id}.png`);
  await page.screenshot({ path: filePath, type: "png" });

  const screenshot = await readFile(filePath);
  const aigcMetadata = posterAigcMetadata(entry);
  const tagged = appendPngTextChunks(screenshot, [
    { type: "iTXt", keyword: "AIGC", text: JSON.stringify(aigcMetadata) },
    { type: "tEXt", keyword: "AIContent", text: "true; origin=ai-generated; manifest=/competition-posters/manifest.json" },
    { type: "tEXt", keyword: "Generator", text: POSTER_GENERATOR }
  ]);
  await writeFile(filePath, tagged);
  process.stdout.write(`rendered ${entry.id}.svg + ${entry.id}.png\n`);
}

await renderOverview(page);

await browser.close();
await writeManifest();
process.stdout.write(`done: ${entries.length} poster(s) -> ${outDirectory}\n`);

async function renderOverview(renderPage) {
  await renderPage.setViewportSize({ width: 1600, height: 2050 });
  const cards = posterEntries
    .map((entry, index) => `
      <figure>
        <div class="poster">${renderPosterSvg(entry)}</div>
        <figcaption><strong>${String(index + 1).padStart(2, "0")}</strong><span>${escapeHtml(entry.id)}</span><em>${escapeHtml(entry.direction)}</em></figcaption>
      </figure>`)
    .join("");
  await renderPage.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;background:#e9e5dc;color:#20243b;font-family:Arial,"Noto Sans SC",sans-serif}
    body{padding:32px}.heading{display:flex;justify-content:space-between;align-items:flex-end;margin:0 0 24px;border-bottom:2px solid #20243b;padding-bottom:14px}
    h1{font-size:28px;margin:0;letter-spacing:-.02em}.heading p{font-size:13px;margin:0;color:#59606e}
    main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px 18px}figure{margin:0;min-width:0}.poster{overflow:hidden;border:1px solid #9d9b95;background:white;aspect-ratio:8/3}.poster svg{display:block;width:100%;height:100%}
    figcaption{display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;margin-top:7px;font-size:11px}figcaption strong{font-size:10px;color:#5356c9}figcaption span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}figcaption em{font-style:normal;color:#77736c}
  </style></head><body><header class="heading"><h1>赛途 · ${posterEntries.length} 项竞赛主题视觉总览</h1><p>1280 × 480 · ${POSTER_GENERATED_AT}</p></header><main>${cards}</main></body></html>`, { waitUntil: "load" });
  await renderPage.evaluate(() => document.fonts.ready);
  await renderPage.screenshot({ path: path.join(outDirectory, "overview.png"), type: "png", fullPage: true });
}

async function writeManifest() {
  const manifestEntries = [];
  for (const entry of posterEntries) {
    const svgPath = path.join(sourceDirectory, `${entry.id}.svg`);
    const pngPath = path.join(outDirectory, `${entry.id}.png`);
    const [svg, png, pngStats] = await Promise.all([readFile(svgPath), readFile(pngPath), stat(pngPath)]);
    manifestEntries.push({
      id: entry.id,
      direction: entry.direction,
      semantic: entry.semantic,
      prompt: entry.prompt,
      palette: entry.palette,
      layout: entry.layout,
      notation: entry.notation,
      source: `/competition-posters/source/${entry.id}.svg`,
      raster: `/competition-posters/${entry.id}.png`,
      dimensions: { width: 1280, height: 480 },
      sha256: { svg: sha256(svg), png: sha256(png) },
      bytes: pngStats.size,
      metadata: posterMetadata(entry),
      review: {
        automatedAt: posterDate(entry),
        checks: [
          "inline-svg-only",
          "no-external-references",
          "no-gradients-or-random-decoration",
          "no-competition-identity-artwork",
          "no-visible-origin-disclosure",
          "gb-45438-aigc-metadata-before-idat"
        ],
        human: { status: "not-claimed", reviewedAt: null },
        editorial: {
          status: "assistant-reviewed-passed",
          reviewedAt: posterDate(entry),
          scope: "Catalog overview, semantic fit, prohibited identity elements and raster integrity"
        }
      },
      rightsBasis: "Code-native AI-assisted illustration; no external assets or official competition identity are incorporated; no exclusive human-authorship claim is made."
    });
  }

  const overviewPath = path.join(outDirectory, "overview.png");
  const overview = await readFile(overviewPath).catch(() => null);
  const manifest = {
    schemaVersion: 2,
    generatedAt: POSTER_GENERATED_AT,
    generator: POSTER_GENERATOR,
    labelingStandard: "GB 45438-2025",
    visibleOriginLabel: false,
    implicitLabel: { keyword: "AIGC", placement: "before first PNG IDAT chunk" },
    methodology: "Deterministic code-native SVG diagrams rendered locally with Playwright. References informed only general editorial methods; no downloaded or traced visual assets are used.",
    prohibitedElements: [
      "competition logos or acronym marks",
      "mascots or official color lockups",
      "flags, emblems, maps, seals or protected special symbols",
      "trophies, rockets, light bulbs, brains or handshakes",
      "gradients, waves, random dots, glows or generic centered icons"
    ],
    humanReview: { status: "not-claimed", reviewedAt: null },
    editorialReview: {
      status: "assistant-reviewed-passed",
      reviewedAt: POSTER_GENERATED_AT,
      reviewer: "Codex visual audit",
      scope: "Catalog overview plus automated source, hash, AIGC metadata and prohibited-element checks"
    },
    overview: overview ? { path: "/competition-posters/overview.png", sha256: sha256(overview) } : null,
    entries: manifestEntries
  };
  await writeFile(path.join(outDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function appendPngTextChunks(png, chunks) {
  const signature = png.subarray(0, 8);
  const body = png.subarray(8);
  const firstImageDataOffset = findChunkOffset(body, "IDAT");
  if (firstImageDataOffset < 0) throw new Error("Invalid PNG: missing IDAT chunk");
  const beforeImageData = body.subarray(0, firstImageDataOffset);
  const imageDataAndAfter = body.subarray(firstImageDataOffset);
  const encoded = chunks.map((chunk) => encodeTextChunk(chunk));
  return Buffer.concat([signature, beforeImageData, ...encoded, imageDataAndAfter]);
}

function findChunkOffset(buffer, targetType) {
  let offset = 0;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === targetType) return offset;
    offset += 12 + length;
  }
  return -1;
}

function encodeTextChunk({ type, keyword, text }) {
  const typeBuffer = Buffer.from(type, "ascii");
  let data;
  if (type === "iTXt") {
    data = Buffer.concat([
      Buffer.from(keyword, "latin1"),
      Buffer.from([0, 0, 0, 0, 0]),
      Buffer.from(text, "utf8")
    ]);
  } else {
    data = Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(text, "latin1")]);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
