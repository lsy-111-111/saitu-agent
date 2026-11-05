// Export actual catalog IDs and the scope of each documented node. A school's
// selection deadline is not a series-wide deadline.
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dependencies = createRequire(import.meta.resolve("vitest/package.json"));
const { createServer } = await import(dependencies.resolve("vite"));
const server = await createServer({
  root, configFile: false, logLevel: "error", appType: "custom",
  resolve: { alias: { "@": path.join(root, "src") } },
  server: { middlewareMode: true, hmr: false, watch: null }
});
const rows = [];
const key = (...parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);

try {
  const { competitions } = await server.ssrLoadModule("/src/content/competitions.ts");
  const { getCompetitionFactSheet } = await server.ssrLoadModule("/src/content/competition-facts.ts");
  for (const c of competitions) {
    const series = c.id;
    const facts = getCompetitionFactSheet(series);
    rows.push({ type: "series", id: series, name: c.name });
    const edition = key(series, facts.edition);
    rows.push({ type: "edition-record", id: edition, series, label: facts.edition,
      scope: "资料所述届次或周期；含待确认记录", sources: facts.sources.map(s => s.url) });
    for (const scope of new Set(facts.nodes.map(node => node.scope))) {
      const venue = key(edition, scope);
      rows.push({ type: "notice-scope", id: venue, series, edition, label: scope });
      for (const node of facts.nodes.filter(n => n.scope === scope)) {
        rows.push({ type: "milestone", id: key(venue, node.kind, node.date, node.sourceUrl),
          series, edition, noticeScope: venue, kind: node.kind, date: node.date, source: node.sourceUrl });
      }
    }
    for (const track of c.recommendation.tracks ?? []) {
      const cited = [c.recommendation.source, ...(c.recommendation.supportingSources ?? [])]
        .find(row => row?.evidenceRef && row.evidenceRef === track.evidenceRef);
      rows.push({ type: "track", id: key(series, track.id), series, trackKey: track.id, label: track.label,
        task: track.taskSummary || null, documentTitle: track.document?.title || null,
        scope: track.document?.scope || "所引文件覆盖的赛道/组别；与新一届的关系须核实",
        source: track.document?.url || cited?.url || c.recommendation.source?.url || c.sourceUrl });
    }
  }
  await writeFile(path.join(root, "artifacts/catalog-research-20261104/registry.jsonl"),
    rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  console.log(rows.reduce((counts, row) => {
    counts[row.type] = (counts[row.type] || 0) + 1;
    return counts;
  }, {}));
} finally {
  await server.close();
}
