// Wrapper name differs from evaluate-coverage.ts so Vitest resolves the typed module unambiguously.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import {sourceManifest} from "./run-experiment.mjs";
import {canonicalHash} from "./frozen-ranking-executor.mjs";

const dependencies = createRequire(import.meta.resolve("vitest/package.json"));
const { createServer } = await import(dependencies.resolve("vite"));
const root = fileURLToPath(new URL("../../../", import.meta.url));
const argument = key => { const index = process.argv.indexOf(key); return index >= 0 ? process.argv[index + 1] : undefined; };
const output = path.resolve(root, argument("--output") ?? "artifacts/v6/evaluation/coverage-results.json");
const now = new Date(argument("--as-of") ?? Date.now());
if (!Number.isFinite(now.valueOf())) throw new Error("Invalid --as-of date");
const server = await createServer({ root, optimizeDeps: { noDiscovery: true, entries: [] }, configFile: false, logLevel: "error", appType: "custom",
  resolve: { alias: { "@": path.join(root, "src"), "server-only": path.join(root, "tests/fixtures/server-only.ts") } },
  server: { middlewareMode: true, hmr: false, watch: null } });
try {
  const implementationSha256=canonicalHash(await sourceManifest(root));
  const { evaluateCoverage } = await server.ssrLoadModule("/@fs/" + path.join(root, "scripts/competitions/v6/evaluate-coverage.ts"));
  const result = {...evaluateCoverage({ now }),implementationSha256,implementationUnchanged:canonicalHash(await sourceManifest(root))===implementationSha256};
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ output, measuredCoverage: result.measuredCoverage, independentSuitabilityMeasured: false }));
  if(!result.implementationUnchanged)process.exitCode=1;
} finally { await server.close(); }
