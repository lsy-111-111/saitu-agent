import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const [action, id] = process.argv.slice(2);
if (!["stage", "activate", "rollback"].includes(action) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(id ?? "")) throw new Error("Usage: catalog-snapshot.mjs stage|activate|rollback <snapshot-id>");
const dependencies = createRequire(import.meta.resolve("vitest/package.json"));
const { createServer } = await import(dependencies.resolve("vite"));
const server = await createServer({ root, optimizeDeps: { noDiscovery: true, entries: [] }, configFile: false, server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": path.join(root, "src") } }, appType: "custom", logLevel: "error" });
try {
  const catalog = await server.ssrLoadModule("/src/lib/competitions/v6/catalog.ts");
  const { snapshotDigest, checkSnapshot } = await server.ssrLoadModule("/src/lib/competitions/v6/catalog-snapshot.ts");
  const directory = process.env.SAITU_CATALOG_SNAPSHOT_DIRECTORY ?? path.join(root, "artifacts/v6/catalog-snapshots");
  const activePath = process.env.SAITU_CATALOG_SNAPSHOT_PATH ?? path.join(root, "src/content/competitions-v6/active-snapshot.json");
  if (!path.isAbsolute(directory) || !path.isAbsolute(activePath)) throw new Error("Snapshot paths must be absolute");
  let previous = null;
  try { previous = JSON.parse(await readFile(activePath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const previousRecords = previous?.records ?? catalog.getAuthoredDecisionCatalog();
  if (previous) {
    const priorAssessment = checkSnapshot(previous, catalog.getAuthoredDecisionCatalog(), new Date(), true);
    if (!priorAssessment.valid) throw new Error(`Previous snapshot invalid: ${priorAssessment.errors.join(", ")}`);
  }
  await mkdir(directory, { recursive: true });
  const candidatePath = path.join(directory, `${id}.json`);
  if (action === "stage") {
    const records = catalog.getAuthoredDecisionCatalog();
    const snapshot = { schemaVersion: "saitu.catalog-snapshot.v1", snapshotId: id, createdAt: new Date().toISOString(), policy: "ai_dual_review", digest: snapshotDigest(records), records };
    const assessment = checkSnapshot(snapshot, previousRecords);
    await writeFile(candidatePath, JSON.stringify(snapshot, null, 2) + "\n", { flag: "wx" });
    await writeFile(path.join(directory, `${id}.assessment.json`), JSON.stringify({ ...assessment, autoPublished: false }, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ action, id, path: candidatePath, ready: assessment.valid, blockers: assessment.errors.length, activeUnchanged: true }));
  } else {
    const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
    if (candidate.snapshotId !== id) throw new Error("Snapshot filename and identity disagree");
    // Rollback is an explicit action; it still rechecks review digests and content validity today.
    const assessment = checkSnapshot(candidate, previousRecords, new Date(), action === "rollback");
    if (!assessment.valid) throw new Error(`Snapshot not activated: ${assessment.errors.join(", ")}`);
    const history = { at: new Date().toISOString(), action, previousSnapshotId: previous?.snapshotId ?? "authored", snapshotId: id, digest: candidate.digest, policy: candidate.policy };
    const pending = `${activePath}.${process.pid}.tmp`;
    await writeFile(pending, JSON.stringify(candidate, null, 2) + "\n", { flag: "wx" });
    await rename(pending, activePath);
    await writeFile(path.join(directory, `switch-${Date.now()}-${process.pid}.json`), JSON.stringify(history, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ ...history, nextStep: process.env.SAITU_CATALOG_SNAPSHOT_PATH ? "Running server reads the configured path on its next catalog request; old signed sessions must be rebound to the new fingerprint." : "Rebuild/restart to load the bundled snapshot, or configure SAITU_CATALOG_SNAPSHOT_PATH for runtime switching." }));
  }
} finally { await server.close(); }
