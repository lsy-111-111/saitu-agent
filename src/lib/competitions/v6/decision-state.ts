import {currentDecisionCatalogVersion} from "./catalog-binding";
import { emitProductObservation,observeProductBoundary } from "@/lib/ai/product-observation";
import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getPool, isDatabaseConfigured } from "@/lib/db/pool";
import { isEphemeralE2eSecurityStateAllowed } from "@/lib/config/e2e-runtime";
import { competitionRecommendationProfileV5Schema } from "@/lib/ai/competition-request-schema";
import type { CompetitionRecommendationProfileV5 } from "@/types/competition-recommendation";
import { decisionReportSchema, type DecisionReportV6 } from "./contracts";
import { decisionChatReplySchema, updateProposalSchema } from "./chat-contracts";

const stateSchema = z.object({
  id: z.string(), sessionId: z.string(), generation: z.number().int().nonnegative(), expiresAt: z.number().int(),
  legacy: competitionRecommendationProfileV5Schema, report: decisionReportSchema,
  proposal: updateProposalSchema.nullable(),
  historyRevision:z.string().optional(),
  history: z.array(z.object({role: z.enum(["user", "assistant"]), text: z.string().max(1600)})).max(12),
  lastQuestionnaireEdit: z.string().optional(),
  questionHistory: z.array(z.object({questionId:z.string(),field:z.string().optional(),catalogVersion:z.string(),disposition:z.enum(["skipped","unknown"])})).max(100).optional(),
  lastRequestId: z.string().optional(), lastRequestHash: z.string().optional(), lastReply: decisionChatReplySchema.optional(),
}).strict();
export type DecisionState = z.infer<typeof stateSchema>;
const tokenSchema = z.object({ version: z.literal("decision-session.v6"), id: z.string().regex(/^[a-f0-9]{64}$/), sessionId: z.string().max(180), generation: z.number().int().nonnegative(), expiresAt: z.number().int() }).strict();
type Envelope = { ciphertext: Buffer; iv: Buffer; tag: Buffer; generation: number; expiresAt: number };
const developmentGlobal = globalThis as typeof globalThis & { __saituDecisionStatesV6?: Map<string, Envelope> };
const memory = developmentGlobal.__saituDecisionStatesV6 ??= new Map<string, Envelope>();
function secret() {
  const value = process.env.AI_CONVERSATION_SIGNING_SECRET?.trim();
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV !== "production") return "development-only-competition-token-secret-do-not-deploy";
  throw new Error("decision_state_secret_unavailable");
}
function key() { return createHash("sha256").update(`saitu-decision-state.v6\0${secret()}`).digest(); }
export function createDecisionToken(state: Pick<DecisionState, "id" | "sessionId" | "generation" | "expiresAt">) {
  const encoded = Buffer.from(JSON.stringify({ version: "decision-session.v6", id: state.id, sessionId: state.sessionId, generation: state.generation, expiresAt: state.expiresAt })).toString("base64url");
  return `${encoded}.${createHmac("sha256", key()).update(encoded).digest("base64url")}`;
}
export function verifyDecisionToken(token: string) {
  try {
    const parts = token.split("."); if (parts.length !== 2 || token.length > 4096 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const payload = Buffer.from(parts[0], "base64url"), signature = Buffer.from(parts[1], "base64url");
    if (payload.toString("base64url") !== parts[0] || signature.toString("base64url") !== parts[1]) return null;
    const expected = createHmac("sha256", key()).update(parts[0]).digest();
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
    const value = tokenSchema.parse(JSON.parse(payload.toString("utf8")));
    return value.expiresAt > Date.now() ? value : null;
  } catch { return null; }
}
function seal(state: DecisionState): Envelope {
  const data = Buffer.from(JSON.stringify(stateSchema.parse(state)));
  if (data.byteLength > 1_048_576) throw new Error("decision_state_too_large");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(state.id));
  return { ciphertext: Buffer.concat([cipher.update(data), cipher.final()]), iv, tag: cipher.getAuthTag(), generation: state.generation, expiresAt: state.expiresAt };
}
function unseal(id: string, envelope: Envelope): DecisionState {
  const decipher = createDecipheriv("aes-256-gcm", key(), envelope.iv);
  decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(envelope.tag);
  const state = stateSchema.parse(JSON.parse(Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]).toString("utf8")));
  if (state.id !== id || state.generation !== envelope.generation || state.expiresAt !== envelope.expiresAt) throw new Error("decision_state_mismatch");
  return state;
}
function memoryAllowed() {
  if (process.env.NODE_ENV === "production" && !isEphemeralE2eSecurityStateAllowed()) throw new Error("decision_state_store_unavailable");
  for (const [id, row] of memory) if (row.expiresAt <= Date.now()) memory.delete(id);
}
export async function readDecisionState(id: string): Promise<DecisionState | null> {
  let row: Envelope | undefined;
  if (isDatabaseConfigured()) {
    const result = await getPool().query<{ciphertext: Buffer; iv: Buffer; tag: Buffer; generation: number; expires_at: Date}>("select ciphertext, iv, tag, generation, expires_at from competition_decision_states where state_key = $1 and expires_at > now()", [id]);
    const found = result.rows[0]; if (found) row = { ...found, expiresAt: found.expires_at.getTime() };
  } else { memoryAllowed(); row = memory.get(id); }
  const state=row && row.expiresAt > Date.now() ? unseal(id, row) : null;
  emitProductObservation("decision_state_read",{stateKey:id,exists:Boolean(state),generation:state?.generation??null,profileRevision:state?.report.profile.revision??null,persistent:isDatabaseConfigured()});
  return state;
}
export async function initializeDecisionState(input: { sessionId: string; expiresAt: number; legacy: CompetitionRecommendationProfileV5; report: DecisionReportV6 }) {
  const id = createHmac("sha256", key()).update(`${input.sessionId}\0${input.report.reportId}`).digest("hex");
  const state: DecisionState = { ...input, id, generation: 0, proposal: null, history: [] };
  const row = seal(state);
  if (isDatabaseConfigured()) {
    await getPool().query("insert into competition_decision_states(state_key, generation, ciphertext, iv, tag, expires_at) values ($1, $2, $3, $4, $5, $6) on conflict (state_key) do nothing", [id, 0, row.ciphertext, row.iv, row.tag, new Date(row.expiresAt)]);
  } else { memoryAllowed(); if (!memory.has(id)) { if (memory.size >= 1000) throw new Error("decision_state_capacity"); memory.set(id, row); } }
  const saved = await readDecisionState(id); if (!saved) throw new Error("decision_state_expired");
  return { decisionToken: createDecisionToken(saved), report: saved.report };
}
export async function compareAndSwapDecisionState(next: DecisionState, expectedGeneration: number, options:{signal?:AbortSignal;expectedCatalogVersion?:string}={}): Promise<boolean> {
  if (next.generation !== expectedGeneration + 1 || next.expiresAt <= Date.now()) throw new Error("invalid_decision_generation");
  await observeProductBoundary("before_product_commit",{stateKey:next.id,expectedGeneration,nextGeneration:next.generation,profileRevision:next.report.profile.revision,persistent:isDatabaseConfigured()});
  if(options.signal?.aborted){emitProductObservation("decision_commit_cancelled",{stateKey:next.id,expectedGeneration});await observeProductBoundary("after_product_commit",{stateKey:next.id,committed:false,cancelled:true,generation:expectedGeneration,persistent:isDatabaseConfigured()});return false;}
  if(options.expectedCatalogVersion&&currentDecisionCatalogVersion()!==options.expectedCatalogVersion){emitProductObservation("decision_catalog_commit_rejected",{stateKey:next.id,expectedCatalogVersion:options.expectedCatalogVersion});return false;}
  const row = seal(next);
  if (isDatabaseConfigured()) {
    const result = await getPool().query("update competition_decision_states set generation=$2, ciphertext=$3, iv=$4, tag=$5, updated_at=now() where state_key=$1 and generation=$6 and expires_at > now()", [next.id, next.generation, row.ciphertext, row.iv, row.tag, expectedGeneration]);
    const committed=result.rowCount===1;
    await observeProductBoundary("after_product_commit",{stateKey:next.id,committed,generation:committed?next.generation:expectedGeneration,profileRevision:next.report.profile.revision,persistent:true});
    return committed;
  }
  memoryAllowed(); const current = memory.get(next.id);
  if (!current || current.generation !== expectedGeneration) return false;
  memory.set(next.id, row);
  await observeProductBoundary("after_product_commit",{stateKey:next.id,committed:true,generation:next.generation,profileRevision:next.report.profile.revision,persistent:false});
  return true;
}
export function resetDecisionStatesForTests() { if (process.env.NODE_ENV === "test") memory.clear(); }
