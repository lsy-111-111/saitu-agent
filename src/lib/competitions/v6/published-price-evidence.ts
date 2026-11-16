import { z } from "zod";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { CatalogSource, DecisionCompetitionRecord } from "./catalog-types";
import { isEvidenceForRecord } from "./evidence";

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(x => Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x);
const priceSchema = z.object({ currency: z.literal("CNY"), maximumUnitFen: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), unit: z.string().trim().min(1), validFrom: calendarDate, validThrough: calendarDate, applicableScope: z.string().trim().min(1), conditions: z.array(z.string().trim().min(1)) }).strict().refine(x => x.validFrom <= x.validThrough);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
/** Public evidence files must remain inside the repository evidence area, without symlink escape. */
function verifiedArtifact(relative: string, digest: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(digest) || !/^artifacts\/(?:v6\/content-research\/(?:source-byte-snapshots|frozen-source-text)|continuation-\d{8}\/[A-Za-z0-9_-]+\/(?:raw|text|public-evidence))\/[A-Za-z0-9_./-]+$/.test(relative) || relative.split("/").some(s => !s || s === "." || s === "..") || /(?:^|\/)(?:private|sealed)|private800/i.test(relative)) return false;
  try {
    const root = realpathSync(process.cwd());
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || realpathSync(file) !== file || !lstatSync(file).isFile() || lstatSync(file).size > 50_000_000) return false;
    return sha(readFileSync(file)) === digest;
  } catch { return false; }
}
export function hasVerifiedPublicPriceCapture(source: CatalogSource, now: Date): boolean {
  const c = source.publicPriceCapture;
  if (!c || !/^https:\/\//.test(source.url) || source.authority !== "supplier" || source.accessStatus !== "body_read" || source.integrity !== "consistent" || !source.locator.trim() || !source.publisher.trim()) return false;
  const retrieved = Date.parse(c.retrievedAt);
  return Number.isFinite(retrieved) && retrieved <= now.getTime() && verifiedArtifact(c.sourceArtifact, c.sourceByteSha256) && verifiedArtifact(c.bodyArtifact, c.bodySha256);
}
/** A supplier quote proves a price, never official entry rules or a complete cost by itself. */
export function hasPublishedPriceFacts(record: DecisionCompetitionRecord, factIds: string[], now: Date): boolean {
  return factIds.length > 0 && new Set(factIds).size === factIds.length && factIds.every(id => {
    const f = record.facts.find(f => f.id === id);
    if (!f || !priceSchema.safeParse(f.publicPrice).success || f.kind !== "published_price" || f.status !== "verified_current" || !/^cost\./.test(f.field) || f.conflictsWith.length || !isEvidenceForRecord(record, f) || !f.sourceIds.length || new Set(f.sourceIds).size !== f.sourceIds.length || !Number.isFinite(Date.parse(f.checkedAt ?? "")) || Date.parse(f.checkedAt!) > now.getTime()) return false;
    const price = f.publicPrice!;
    if (price.applicableScope !== record.scope) return false;
    if (f.sourceScopes && (new Set(f.sourceScopes.map(b => b.sourceId)).size !== f.sourceIds.length || f.sourceScopes.some(b => !f.sourceIds.includes(b.sourceId)))) return false;
    return f.sourceIds.every(sourceId => {
      const s = record.sources.find(s => s.id === sourceId);
      const binding = f.sourceScopes?.find(b => b.sourceId === sourceId);
      return Boolean(s && (f.sourceScopes ? f.sourceScopes.length === f.sourceIds.length && s.scope === binding?.scope : s.scope === f.scope) && hasVerifiedPublicPriceCapture(s, now));
    });
  });
}
