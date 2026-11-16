import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Fetch public documents only. Changes are review proposals, never new facts. */
export async function observeSource(source, fetcher = fetch) {
  const url = new URL(source.url);
  if (url.protocol !== "https:" || url.username || url.password ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) {
    return { sourceId: source.id, url: source.url, status: "not_checked", reason: "unsupported_public_https_url", digest: null };
  }
  try {
    const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Accept: "text/html,text/plain,application/pdf", "User-Agent": "SaituSourceReview/1.0" } });
    if (!response.ok) throw new Error(`http_${response.status}`);
    if (Number(response.headers.get("content-length")) > 2_000_000) throw new Error("document_too_large");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("empty_body");
    const hash = createHash("sha256"); let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 2_000_000) throw new Error("document_too_large");
        hash.update(value);
      }
    } finally { await reader.cancel(); }
    if (!bytes) throw new Error("empty_body");
    return { sourceId: source.id, url: source.url, status: "observed", digest: hash.digest("hex"), bytes,
      contentType: response.headers.get("content-type"), checkedAt: new Date().toISOString() };
  } catch (error) {
    return { sourceId: source.id, url: source.url, status: "unavailable", digest: null,
      reason: error instanceof Error ? error.message : "fetch_failed", checkedAt: new Date().toISOString() };
  }
}

export function proposeSourceChanges(previous, current, recordIds) {
  const before = new Map(previous.map(value => [value.sourceId, value]));
  return current.flatMap(value => {
    const old = before.get(value.sourceId);
    const changed = old?.digest && value.digest && (old.digest !== value.digest || old.url !== value.url);
    if (!changed && value.status !== "unavailable") return [];
    return [{ sourceId: value.sourceId, recordIds: recordIds[value.sourceId] ?? [], url: value.url,
      status: "pending_review", autoPublished: false,
      reason: changed ? "document_bytes_changed_not_yet_a_rule_change" : "source_unavailable_requires_recheck",
      previousDigest: old?.digest ?? null, observedDigest: value.digest,
      fieldsToReview: ["eligibility", "investment", "registration", "deliverables"],
      instruction: "先确认原文是否发生实质规则变化及适用范围，再提交字段级提案。网站模板或广告变化不等于规则变化；此记录不得用于自动改写资格。" }];
  });
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const arg = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
  const limit = Number(arg("--limit") ?? 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit must be 1..1000");
  const directory = path.resolve(root, arg("--output") ?? "artifacts/v6/source-watch");
  const previousPath = arg("--previous");
  const previous = previousPath ? JSON.parse(await readFile(path.resolve(previousPath), "utf8")).observations : [];
  if (!Array.isArray(previous)) throw new Error("Previous observations must be an array");
  const dependencies = createRequire(import.meta.resolve("vitest/package.json"));
  const { createServer } = await import(dependencies.resolve("vite"));
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true, watch: null },
    resolve: { alias: { "@": path.join(root, "src") } }, appType: "custom", logLevel: "error" });
  try {
    const catalog = await server.ssrLoadModule("/src/lib/competitions/v6/catalog.ts");
    const records = [...catalog.getDecisionCatalog()].sort((a, b) =>
      Number(["open", "upcoming"].includes(b.registration.status)) - Number(["open", "upcoming"].includes(a.registration.status)) || Number(b.pilot) - Number(a.pilot));
    const sourceMap = new Map(), recordIds = {};
    for (const record of records) for (const source of record.sources) {
      sourceMap.set(source.id, source);
      (recordIds[source.id] ??= []).push(record.recordId);
    }
    const sources = [...sourceMap.values()].slice(0, limit);
    const observations = [];
    // Bounded concurrency prevents a large catalog from overwhelming one organizer.
    for (let start = 0; start < sources.length; start += 2) {
      observations.push(...await Promise.all(sources.slice(start, start + 2).map(source => observeSource(source))));
    }
    const proposals = proposeSourceChanges(previous, observations, recordIds);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "observations.json"), JSON.stringify({ generatedAt: new Date().toISOString(),
      totalKnownSources: sourceMap.size, checkedSources: sources.length, remainingSources: sourceMap.size - sources.length,
      observations, autoPublished: false }, null, 2) + "\n");
    await writeFile(path.join(directory, "review-proposals.json"), JSON.stringify({ proposals, autoPublished: false }, null, 2) + "\n");
    console.log(JSON.stringify({ checked: observations.length, proposals: proposals.length, remainingSources: sourceMap.size - sources.length, output: directory }));
  } finally { await server.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "Source review failed"); process.exitCode = 1; });
}
