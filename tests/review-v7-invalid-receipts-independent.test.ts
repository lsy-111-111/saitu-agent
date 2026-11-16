import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiJsonResult } from "@/lib/ai/ai-client";
import type { DurableReceipt } from "@/lib/ai/durable-call";
import { matchPlanSchema, type MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { isDecisionEvidenceFact } from "@/lib/competitions/v6/evidence";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { buildDecisionContextV7, DECISION_EXPLAIN_PROMPT_VERSION_V7, explainDecisionV7, rankDecisionV7 } from "@/lib/competitions/v7/model";
import { readPublicDiagnosticFixture } from "./fixtures/v7-public-diagnostics";

const offline = vi.hoisted(() => ({ receipts: [] as unknown[], requests: [] as { key: string; prompt: string }[], newHttpCalls: 0 }));
vi.mock("@/lib/ai/durable-call", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/ai/durable-call")>(), hasDurableAiRun: () => true,
  runDurableAiAttempt: async (input: { key: string; prompt: string }, _work: () => Promise<unknown>, replay: (receipt: unknown) => unknown) => {
    offline.requests.push(input);
    if (!offline.receipts.length) throw new Error("offline_receipts_exhausted_no_dispatch_allowed");
    return replay(offline.receipts.shift());
  },
}));
const root = process.cwd(), diagnosticDir = "artifacts/continuation-v7-20261109/pipeline-diagnostic-02";
const read = (name: string) => readPublicDiagnosticFixture(`${diagnosticDir}/${name}`);
const diagnostic = read("result.json"), input = read("input.json"), registration = read("registration.json");
const original = diagnostic.calls.map((call: { saved: { kind: string; receipt: DurableReceipt } }) => {
  if (call.saved.kind !== "receipt") throw new Error("real_receipt_required"); return call.saved.receipt;
}) as DurableReceipt[];
const outputDir = process.env.SAITU_V7_INDEPENDENT_REVIEW_ARTIFACT_DIR ? path.resolve(process.env.SAITU_V7_INDEPENDENT_REVIEW_ARTIFACT_DIR) : null;
const context = () => buildDecisionContextV7(input.originalProfile, { profile: structuredClone(input.profile), records: structuredClone(input.records), now: new Date(registration.asOf) });
function codec(ctx: ReturnType<typeof context>) {
  return createModelIdentifierCodec({ candidates: ctx.candidates.map(({ record }) => record.recordId), series: ctx.candidates.map(({ record }) => record.seriesId),
    facts: ctx.candidates.flatMap(({ record }) => record.facts.map(fact => fact.id)), students: ctx.profile.facts.map(fact => fact.id) });
}
const findings: unknown[] = [];
type JsonObject = Record<string, unknown>;
const syntheticReceipt = (value: unknown): DurableReceipt => ({ model: "deepseek-flash", httpStatus: 200, finishReason: "stop", content: JSON.stringify(value),
  attempts: 1, durationMs: 0, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } });
const success = (data: unknown): AiJsonResult<unknown> => ({ ok: true, data, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 0 });
function officialExplanation(ctx: ReturnType<typeof context>, plan: MatchPlanV6): MatchPlanV6 {
  return { ...plan, recommendations: plan.recommendations.map(item => {
    const record = ctx.candidates.find(candidate => candidate.record.recordId === item.itemId)!.record;
    const fact = record.facts.find(fact => fact.kind === "official_fact" && isDecisionEvidenceFact(record, fact) && fact.text.length <= 250 && ["task", "track", "deliverables"].includes(fact.field))
      ?? record.facts.find(fact => fact.kind === "official_fact" && isDecisionEvidenceFact(record, fact) && fact.text.length <= 250);
    if (!fact) throw new Error("short_public_official_fact_required");
    return { itemId: item.itemId, reasons: [{ text: fact.text, basis: "official", studentFactIds: [], competitionFactIds: [fact.id], conditions: [] }] };
  }) };
}
async function ranked(ctx: ReturnType<typeof context>) {
  offline.receipts.push(structuredClone(original[0])); return rankDecisionV7(ctx);
}
const repairPayload = () => JSON.parse(JSON.parse(offline.requests.at(-1)!.prompt).prompt) as { repairOnly: boolean; issues: string[] };
beforeEach(() => {
  offline.receipts.length = 0; offline.requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(() => { offline.newHttpCalls++; throw new Error("new_http_forbidden"); }));
  vi.spyOn(console, "info").mockImplementation(() => undefined); vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  expect(offline.newHttpCalls).toBe(0); expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
afterAll(() => {
  if (!outputDir) return;
  if (existsSync(path.join(outputDir, "invalid-receipt-probes.json"))) throw new Error("independent_review_output_already_exists");
  mkdirSync(outputDir, { recursive: true });
  const files = ["src/lib/competitions/v7/model.ts", "src/lib/competitions/v6/contracts.ts", "src/lib/ai/ai-client.ts", "src/lib/ai/durable-call.ts",
    "tests/review-v7-invalid-receipts-independent.test.ts", `${diagnosticDir}/result.json`, `${diagnosticDir}/input.json`, `${diagnosticDir}/registration.json`].map(file => {
    const bytes = readFileSync(path.join(root, file)), sha256 = createHash("sha256").update(bytes).digest("hex");
    const snapshot = file.startsWith("src/") || file.startsWith("tests/") ? `${path.basename(file)}-${sha256}` : null;
    if (snapshot) writeFileSync(path.join(outputDir, snapshot), bytes, { flag: "wx" });
    return { path: file, sha256, snapshot };
  });
  writeFileSync(path.join(outputDir, "invalid-receipt-probes.json"), JSON.stringify({ schemaVersion: "saitu.real-invalid-receipt-independent.v1", files, findings,
    originalDiagnostic: { modelAttempts: diagnostic.modelAttempts, stageCounts: diagnostic.stageCounts, elapsedMs: diagnostic.elapsedMs, listReadyMs: diagnostic.listReadyMs,
      error: diagnostic.error, hasReport: Boolean(diagnostic.report) },
    newHttpCalls: offline.newHttpCalls, newPaidCalls: 0, notAcceptanceEvidence: true,
    limitations: ["All three saved receipts are real original pipeline02 content; this is offline replay, not a fresh model success.",
      "Durable storage lookup is mocked; production receipt parsing, schemas, ID decoding, rank and explain functions execute.",
      "No old durable database row recovery, 4-of-5 acceptance or performance success is claimed."] }, null, 2) + "\n", { flag: "wx" });
});

describe("independent real pipeline02 invalid receipt diagnosis", () => {
  it("independently finds string roleReason in both explanations and official_fact basis in the saved repair", () => {
    const ctx = context();
    const issues = original.slice(1).map((receipt, index) => {
      const raw = JSON.parse(String(receipt.content));
      if (index === 0) expect(raw.type).toBe("json_object");
      else expect(raw).not.toHaveProperty("type");
      expect(raw.recommendations).toHaveLength(10);
      expect(raw.recommendations.every((item: { roleReason: unknown }) => typeof item.roleReason === "string")).toBe(true);
      // Separate the already accepted literal transport marker from business
      // shape diagnosis, without changing any saved receipt or converting claims.
      const business = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "type"));
      const parsed = matchPlanSchema.safeParse(codec(ctx).decode(business));
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error("strict_schema_unexpectedly_accepted_actual_invalid_receipt");
      const summarized = parsed.error.issues.map(issue => ({ path: issue.path, code: issue.code,
        ...("expected" in issue ? { expected: issue.expected } : {}), ...("options" in issue ? { options: issue.options } : {}) }));
      expect(summarized.filter(issue => issue.path.at(-1) === "roleReason")).toHaveLength(10);
      return summarized;
    });
    expect(issues[0]).toHaveLength(10);
    expect(issues[1].filter(issue => issue.code === "invalid_enum_value")).toHaveLength(16);
    findings.push({ label: "independent_strict_schema_diagnosis", actualFirstExplanationHasFixedMarker: true, issues });
  });

  it("replays all three real receipts, preserves strict rejection and exposes sanitized roleReason paths to the one repair", async () => {
    offline.receipts.push(...structuredClone(original));
    const ctx = context(), plan = await rankDecisionV7(ctx);
    expect(plan.recommendations).toHaveLength(10);
    const observations: { stage: string; kind: string; data: unknown }[] = [];
    await expect(explainDecisionV7(ctx, plan, { onObservation: async event => { observations.push(event); } })).rejects.toThrow("invalid_output");
    expect(offline.requests.map(request => request.key)).toEqual(["v7.rank:batch:1", "v7.explain:batch:1", "v7.explain:invalid-output-repair:1"]);
    const repair = repairPayload();
    expect(repair.repairOnly).toBe(true); expect(repair.issues).toHaveLength(10);
    for (let index = 0; index < 10; index++) expect(repair.issues).toContain(`recommendations.${index}.roleReason:invalid_type expected=object`);
    const validations = observations.filter(event => event.kind === "validation" && (event.data as JsonObject).source === "transport_schema");
    expect(validations).toHaveLength(2);
    expect(JSON.stringify(validations[1].data)).toContain("allowed=student|official|inference|suggestion|unknown");
    findings.push({ label: "real_receipts_production_replay_after_fix", acceptedRank: true, acceptedExplanation: false,
      stages: offline.requests.map(request => request.key), repairIssues: repair.issues, validationEvents: validations });
  });

  it("can complete the one allowed repair with an explicit valid fixture after the real initial invalid receipt", async () => {
    const ctx = context(), plan = await ranked(ctx), valid = officialExplanation(ctx, plan);
    offline.receipts.push(structuredClone(original[1]), syntheticReceipt(codec(ctx).encode(valid)));
    const report = await explainDecisionV7(ctx, plan), repair = repairPayload();
    expect(report.recommendations.map(item => item.itemId)).toEqual(plan.recommendations.map(item => item.itemId));
    expect(repair.issues).toHaveLength(10); expect(offline.requests).toHaveLength(3);
    const outer = JSON.parse(offline.requests[1].prompt);
    expect(outer.promptVersion).toBe(`${DECISION_EXPLAIN_PROMPT_VERSION_V7}.explain`);
    expect(outer.system).toContain("text、basis、studentFactIds、competitionFactIds、conditions五个字段");
    expect(outer.system).toContain("basis只能是student、official、inference、suggestion、unknown之一");
    expect(outer.system).toContain("roleReason和comparison不能是字符串或null");
    findings.push({ label: "real_invalid_then_explicit_valid_contract_fixture", acceptedFixture: true, freshModelSuccess: false, repairIssues: repair.issues });
  });
});

describe("independent schema repair diagnostic boundaries", () => {
  it("sends expected types and legal enums without copying invalid raw strings, enum values or unknown keys", async () => {
    const ctx = context(), plan = await ranked(ctx), valid = officialExplanation(ctx, plan), raw = codec(ctx).encode(valid) as JsonObject;
    const row = (raw.recommendations as JsonObject[])[0], reason = (row.reasons as JsonObject[])[0];
    row.roleIndex = 0; row.roleReason = "RAW_ROLE_SENTINEL_DO_NOT_ECHO";
    reason.basis = "RAW_ENUM_SENTINEL_DO_NOT_ECHO"; reason.conditions = { privateValue: "RAW_CONDITION_SENTINEL_DO_NOT_ECHO" };
    raw.RAW_UNKNOWN_KEY_SENTINEL_DO_NOT_ECHO = "RAW_UNKNOWN_VALUE_SENTINEL_DO_NOT_ECHO";
    offline.receipts.push(syntheticReceipt(raw), syntheticReceipt(codec(ctx).encode(valid)));
    const observations: unknown[] = [];
    await explainDecisionV7(ctx, plan, { onObservation: async event => { observations.push(event); } });
    const issues = repairPayload().issues, safe = JSON.stringify(issues);
    expect(safe).toContain("roleReason:invalid_type expected=object");
    expect(safe).toContain("conditions:invalid_type expected=array");
    expect(safe).toContain("basis:invalid_enum_value allowed=student|official|inference|suggestion|unknown");
    expect(safe).toContain("unrecognized_keys");
    expect(safe).not.toContain("SENTINEL");
    expect(JSON.stringify(observations)).not.toContain("SENTINEL"); expect(offline.requests[2].prompt).not.toContain("SENTINEL");
    findings.push({ label: "sanitized_diagnostics_no_raw_values_or_unknown_keys", issues });
  });

  it("bounds invalid response diagnostics to 64 short issues while retaining strict output rejection", async () => {
    const ctx = context(), plan = await ranked(ctx), raw = codec(ctx).encode(officialExplanation(ctx, plan)) as JsonObject;
    const row = (raw.recommendations as JsonObject[])[0]; row.roleReason = "RAW_LONG_VALUE_DO_NOT_ECHO".repeat(100);
    ((row.reasons as JsonObject[])[0]).basis = "RAW_BAD_ENUM_DO_NOT_ECHO";
    raw.recommendations = Array.from({ length: 80 }, () => structuredClone(row));
    const receipt = syntheticReceipt(raw); offline.receipts.push(receipt, structuredClone(receipt));
    await expect(explainDecisionV7(ctx, plan)).rejects.toThrow("invalid_output");
    const issues = repairPayload().issues;
    expect(issues).toHaveLength(64); expect(issues.every(issue => issue.length <= 320)).toBe(true);
    expect(JSON.stringify(issues)).not.toContain("DO_NOT_ECHO"); expect(offline.requests).toHaveLength(3);
    findings.push({ label: "bounded_shape_diagnostics", count: issues.length, maximumLength: Math.max(...issues.map(issue => issue.length)) });
  });

  it("uses the same safe diagnostic format when a model-call adapter bypasses transport schema parsing", async () => {
    const ctx = context(), plan = await ranked(ctx), valid = officialExplanation(ctx, plan), raw = codec(ctx).encode(valid) as JsonObject;
    (raw.recommendations as JsonObject[])[0].roleReason = "RAW_DECODE_SENTINEL_DO_NOT_ECHO";
    let attempts = 0, repairIssues: string[] = [];
    const report = await explainDecisionV7(ctx, plan, { modelCall: async prompt => {
      attempts++; if (attempts === 1) return success(raw);
      repairIssues = JSON.parse(prompt).issues; return success(codec(ctx).encode(valid));
    } });
    expect(report.recommendations).toHaveLength(10); expect(attempts).toBe(2);
    expect(repairIssues).toEqual(["recommendations.0.roleReason:invalid_type expected=object"]);
    expect(JSON.stringify(repairIssues)).not.toContain("SENTINEL");
    findings.push({ label: "post_decode_safe_diagnostic_format", repairIssues });
  });

  it.each(["timeout", "network_error", "durable_outcome_unknown"] as const)("never turns %s into a repair even after a failed schema probe", async reason => {
    const ctx = context(), plan = await ranked(ctx), raw = codec(ctx).encode(officialExplanation(ctx, plan)) as JsonObject;
    (raw.recommendations as JsonObject[])[0].roleReason = "RAW_SHAPE_NOT_A_RETRY_TRIGGER";
    let attempts = 0;
    await expect(explainDecisionV7(ctx, plan, { modelCall: async (_prompt, options) => {
      attempts++; expect(options.schema!.safeParse(raw).success).toBe(false);
      return { ok: false, reason, model: "deepseek-flash", upstreamAttempted: true };
    } })).rejects.toThrow(reason);
    expect(attempts).toBe(1);
  });

  it("does not reuse captured schema issues from an earlier attempt when the repair adapter returns only invalid_output", async () => {
    const ctx = context(), plan = await ranked(ctx), raw = codec(ctx).encode(officialExplanation(ctx, plan)) as JsonObject;
    (raw.recommendations as JsonObject[])[0].roleReason = null;
    let attempts = 0; const observations: { data: unknown; kind: string }[] = [];
    await expect(explainDecisionV7(ctx, plan, { onObservation: async event => { observations.push(event); }, modelCall: async (_prompt, options) => {
      attempts++; if (attempts === 1) expect(options.schema!.safeParse(raw).success).toBe(false);
      return { ok: false, reason: "invalid_output", model: "deepseek-flash", upstreamAttempted: true };
    } })).rejects.toThrow("invalid_output");
    expect(attempts).toBe(2);
    expect(observations.filter(event => event.kind === "validation" && (event.data as JsonObject).source === "transport_schema")).toHaveLength(1);
  });
});
