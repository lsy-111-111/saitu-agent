import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

function key() {
  const configured = process.env.AI_CONVERSATION_SIGNING_SECRET?.trim();
  if ((!configured || configured.length < 32) && process.env.NODE_ENV === "production") throw new Error("decision_state_secret_unavailable");
  return createHash("sha256").update(`saitu-decision-state.v7\0${configured || "development-only-competition-token-secret-do-not-deploy"}`).digest();
}
export type SealedV7 = { ciphertext: Buffer; iv: Buffer; tag: Buffer };
export function sealV7(identity: string, value: unknown, maxBytes = 8_388_608): SealedV7 {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > maxBytes) throw new Error("decision_state_too_large");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(identity));
  return {ciphertext: Buffer.concat([cipher.update(bytes),cipher.final()]),iv,tag:cipher.getAuthTag()};
}
export function unsealV7<T>(identity: string, value: SealedV7): T {
  const cipher = createDecipheriv("aes-256-gcm",key(),value.iv);
  cipher.setAAD(Buffer.from(identity)); cipher.setAuthTag(value.tag);
  return JSON.parse(Buffer.concat([cipher.update(value.ciphertext),cipher.final()]).toString("utf8")) as T;
}
export const sessionKeyV7 = (sessionId: string) => createHmac("sha256",key()).update(`session\0${sessionId}`).digest("hex");
const tokenSchema = z.object({version:z.literal("decision-session.v7"),id:z.string().regex(/^[a-f0-9]{64}$/),sessionId:z.string().min(1).max(180),generation:z.number().int().nonnegative(),expiresAt:z.number().int().positive()}).strict();
export type DecisionTokenV7 = z.infer<typeof tokenSchema>;
export function createDecisionTokenV7(state: Omit<DecisionTokenV7,"version">) {
  const encoded = Buffer.from(JSON.stringify(tokenSchema.parse({id:state.id,sessionId:state.sessionId,generation:state.generation,expiresAt:state.expiresAt,version:"decision-session.v7"}))).toString("base64url");
  return `${encoded}.${createHmac("sha256",key()).update(encoded).digest("base64url")}`;
}
export function verifyDecisionTokenV7(token: string): DecisionTokenV7 | null {
  try {
    if (token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const payload = Buffer.from(parts[0],"base64url"),signature = Buffer.from(parts[1],"base64url");
    if (payload.toString("base64url") !== parts[0] || signature.toString("base64url") !== parts[1]) return null;
    const expected = createHmac("sha256",key()).update(parts[0]).digest();
    if (signature.length !== expected.length || !timingSafeEqual(signature,expected)) return null;
    const parsed = tokenSchema.parse(JSON.parse(payload.toString("utf8")));
    return parsed.expiresAt > Date.now() ? parsed : null;
  } catch { return null; }
}
