/**
 * Run against the active catalog. Optionally provide a historical checkout as the
 * single argument to evaluate the exact same labeled profiles on that checkout.
 * Unjudged tracks and expanded catalog entries are never counted as negatives.
 */
import path from "node:path";
import {positiveJudgmentMetrics} from "./competition-judgment-metrics.mjs";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const dependencies = createRequire(import.meta.resolve("vitest/package.json"));
const {createServer} = await import(dependencies.resolve("vite"));

const root = fileURLToPath(new URL("../", import.meta.url));
const base = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith("--")) || root);
const existingOnly = process.argv.includes("--original-series");
const server = await createServer({
  root, configFile: false, logLevel: "error", appType: "custom",
  resolve: { alias: { "@": path.join(base, "src") } },
  server: { middlewareMode: true, hmr: false, watch:null }
});
try {
  const load = (filename) => server.ssrLoadModule("/@fs/" + path.join(base, filename));
  const { getCompetitionRecommendationCandidates, recommendCompetitions } = await load("src/lib/competitions/recommendation-engine.ts");
  const { getCompetitionCatalog, COMPETITION_CATALOG_VERSION } = await load("src/lib/competitions/catalog.ts");
  const { COMPETITION_SCORER_VERSION } = await load("src/lib/competitions/scoring.ts");
  const labelsPath = "tests/fixtures/competition-quality-ranking-gold.ts";
  const { staticCompetitionRankingHoldoutCases: profiles } = await load(labelsPath);
  const newSeries = new Set(JSON.parse(readFileSync(path.join(root, "src/content/competition-series-20261104.json"), "utf8")).map(item => item.id));
  const catalog = getCompetitionCatalog().filter(item => !existingOnly || !newSeries.has(item.id));
  const count = profiles.length;
  const emptyKnownTop3 = [];
  const expandedTop3 = new Map();
  const expandedTop10 = new Map();
  const totals = {hitAt3:0,recallAt10KnownRelevant:0,listedCoverage:0,annotatedTop3:0};
  for (const {id,profile,labels} of profiles) {
    const knownRelevant = new Set(labels.map(row => row.competitionId));
    if (!knownRelevant.size) throw new Error("This fixture expects a nonempty assigned relevant set");
    const options = {catalog,now:new Date("2026-08-23T00:00:00Z"),transcript:[]};
    const pool = getCompetitionRecommendationCandidates(profile,options).recommendations.map(item => item.competitionId);
    const shown = recommendCompetitions(profile,options).recommendations.map(item => item.competitionId);
    const overlap = ids => positiveJudgmentMetrics(ids,knownRelevant,ids.length).hits;
    const top = shown.slice(0,3);
    if (!overlap(top)) emptyKnownTop3.push({profile:id,shown:top});
    for (const series of pool.slice(0,10).filter(series => newSeries.has(series))) expandedTop10.set(series,(expandedTop10.get(series) ?? 0)+1);
    for (const series of top.filter(series => newSeries.has(series))) expandedTop3.set(series,(expandedTop3.get(series) ?? 0)+1);
    totals.hitAt3 += Number(overlap(top) > 0);
    totals.recallAt10KnownRelevant += overlap(pool.slice(0,10)) / knownRelevant.size;
    totals.listedCoverage += overlap(pool) / knownRelevant.size;
    totals.annotatedTop3 += overlap(shown.slice(0,3));
  }
  console.log(JSON.stringify({profileCount:count, catalogSize:catalog.length, catalogVersion:COMPETITION_CATALOG_VERSION,
    scorerVersion:COMPETITION_SCORER_VERSION, fixtureSha256:createHash("sha256").update(readFileSync(path.join(base,labelsPath))).digest("hex"),
    source:"Frozen August positive judgments, fixed questionnaire only, series level; unjudged entries and tracks have unknown relevance.",
    emptyKnownTop3, expandedTop10:Object.fromEntries([...expandedTop10].sort((a,b) => b[1]-a[1])), expandedTop3:Object.fromEntries([...expandedTop3].sort((a,b) => b[1]-a[1])),
    metrics:Object.fromEntries(Object.entries(totals).map(([name,value])=>[name,Number((value/count).toFixed(4))]))},null,2));
} finally {
  await server.close();
}
