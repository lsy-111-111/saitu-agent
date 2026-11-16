import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { RECOMMENDATION_DETAIL_DEADLINE_MS, RECOMMENDATION_RANK_HARD_TIMEOUT_MS } from "./contracts";

export const SUBMISSION_TIMING_HEADER = "X-Saitu-Submission-Timing";
export const SUBMISSION_ELAPSED_HEADER = "X-Saitu-Submission-Elapsed-Ms";
type SubmissionTiming = { version: "saitu.submission-timing.v1"; submittedAtEpochMs: number };
const starts = new WeakMap<Request, SubmissionTiming>();
function secret() {
  const value = process.env.AI_CONVERSATION_SIGNING_SECRET?.trim();
  if ((!value || value.length < 32) && process.env.NODE_ENV === "production") throw new Error("DECISION_TIMING_UNAVAILABLE");
  return value || "development-only-competition-token-secret-do-not-deploy";
}
function signature(encoded: string) {
  return createHmac("sha256", secret()).update(`saitu-submission-timing.v1\0${encoded}`).digest();
}
function decode(token: string): SubmissionTiming {
  if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error("DECISION_TIMING_INVALID");
  const [encoded, mac] = token.split("."), supplied = Buffer.from(mac, "base64url"), bytes = Buffer.from(encoded, "base64url");
  const expected = signature(encoded);
  if (supplied.toString("base64url") !== mac || bytes.toString("base64url") !== encoded || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("DECISION_TIMING_INVALID");
  const value: SubmissionTiming = JSON.parse(bytes.toString("utf8"));
  if (!value || Object.keys(value).sort().join(",") !== "submittedAtEpochMs,version" || value.version !== "saitu.submission-timing.v1" || !Number.isSafeInteger(value.submittedAtEpochMs) || value.submittedAtEpochMs < 0) throw new Error("DECISION_TIMING_INVALID");
  return value;
}
/** The client may only spend an existing budget, never extend a server anchor.
 * A signed anchor survives normalization/clarification and all network retries. */
export function readSubmissionTimingV7(request: Request, receivedAt = Date.now()): SubmissionTiming {
  const existing = starts.get(request);
  if (existing) return existing;
  const elapsedHeader = request.headers.get(SUBMISSION_ELAPSED_HEADER);
  const elapsed = elapsedHeader === null ? 0 : Number(elapsedHeader);
  if (elapsedHeader !== null && (!/^\d+(?:\.\d+)?$/.test(elapsedHeader) || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 86_400_000)) throw new Error("DECISION_TIMING_INVALID");
  const token = request.headers.get(SUBMISSION_TIMING_HEADER);
  const previous = token ? decode(token) : null;
  if (previous && previous.submittedAtEpochMs > receivedAt) throw new Error("DECISION_TIMING_INVALID");
  const submittedAtEpochMs = Math.min(previous?.submittedAtEpochMs ?? receivedAt, receivedAt - Math.ceil(elapsed));
  if (submittedAtEpochMs < 0) throw new Error("DECISION_TIMING_INVALID");
  const timing: SubmissionTiming = Object.freeze({ version: "saitu.submission-timing.v1", submittedAtEpochMs });
  starts.set(request, timing);
  return timing;
}
export function attachSubmissionTimingV7(request: Request, response: Response): Response {
  // A producer/cache replay must preserve its original signed timing.
  if (!response.headers.has(SUBMISSION_TIMING_HEADER)) {
    const encoded = Buffer.from(JSON.stringify(readSubmissionTimingV7(request))).toString("base64url");
    response.headers.set(SUBMISSION_TIMING_HEADER, `${encoded}.${signature(encoded).toString("base64url")}`);
  }
  return response;
}
export function assertSubmissionHasDetailBudgetV7(timing: SubmissionTiming, now = Date.now()) {
  if (timing.submittedAtEpochMs + RECOMMENDATION_DETAIL_DEADLINE_MS <= now) throw new Error("DECISION_TIMEOUT");
}
/** Preparatory work must leave the original ranking cutoff intact. Chat may
 * answer without reranking, but even that work shares the original detail cap. */
export function submissionModelDeadlineV7(request: Request, requestDeadline: number, stage: "before_rank" | "chat"): number {
  const timing = readSubmissionTimingV7(request);
  const deadline = Math.min(requestDeadline, timing.submittedAtEpochMs +
    (stage === "before_rank" ? RECOMMENDATION_RANK_HARD_TIMEOUT_MS : RECOMMENDATION_DETAIL_DEADLINE_MS));
  if (deadline <= Date.now()) throw new Error("DECISION_TIMEOUT");
  return deadline;
}
