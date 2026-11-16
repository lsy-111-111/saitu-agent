import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { checkSnapshot, type CatalogSnapshot } from "./catalog-snapshot";
import type { DecisionCompetitionRecord } from "./catalog-types";

const context = new AsyncLocalStorage<string>();
const cache = new Map<string, { key: string; snapshot: CatalogSnapshot }>();

/** Isolates concurrent service evaluations while using the same production loader. */
export function withCatalogSnapshotPath<T>(path: string, run: () => T): T {
  if (!isAbsolute(path)) throw new Error("Catalog snapshot path must be absolute");
  return context.run(path, run);
}

export function configuredCatalogSnapshotPath(): string | undefined {
  return context.getStore() ?? process.env.SAITU_CATALOG_SNAPSHOT_PATH;
}

/** Fail closed for an explicitly configured file; never silently revert to author drafts. */
export function readRuntimeCatalogSnapshot(baseline: DecisionCompetitionRecord[], now = new Date()): CatalogSnapshot | null {
  const path = configuredCatalogSnapshotPath();
  if (!path) return null;
  if (!isAbsolute(path)) throw new Error("Catalog snapshot path must be absolute");
  try {
    if (statSync(path).size > 50_000_000) throw new Error("snapshot_size_limit");
    const bytes = readFileSync(path);
    const key = `${createHash("sha256").update(bytes).digest("hex")}:${now.toISOString().slice(0, 10)}`;
    const previous = cache.get(path);
    if (previous?.key === key) return previous.snapshot;
    const snapshot = JSON.parse(bytes.toString("utf8")) as CatalogSnapshot;
    if (!snapshot || !Array.isArray(snapshot.records)) throw new Error("invalid_snapshot_shape");
    // Activation enforces additions/removals. On load, only unchanged baseline L1
    // discoveries may remain unreviewed; every new or decision-ready entry is checked.
    const assessment = checkSnapshot(snapshot, baseline, now, true);
    if (!assessment.valid) throw new Error(assessment.errors.join(", "));
    if (cache.size >= 8 && !cache.has(path)) cache.delete(cache.keys().next().value!);
    cache.set(path, { key, snapshot });
    return snapshot;
  } catch (error) {
    throw new Error(`Runtime catalog snapshot rejected: ${error instanceof Error ? error.message : "unreadable_snapshot"}`);
  }
}
