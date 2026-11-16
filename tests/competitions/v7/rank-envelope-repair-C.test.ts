import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db/pool", () => ({
  isDatabaseConfigured: () => false,
  getPool: vi.fn(() => { throw new Error("database_forbidden_in_rank_envelope_test"); }),
}));
vi.mock("@/lib/ai/spend-ledger", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/ai/spend-ledger")>(),
  reserveAiSpend: vi.fn(async () => ({ ok: true as const, reservation: {
    id: "synthetic-rank-envelope-reservation", reservedMicros: 0, settle: async () => 0,
  } })),
}));
vi.mock("@/lib/ai/durable-call", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/ai/durable-call")>();
  return { ...actual, runDurableAiAttempt: vi.fn(actual.runDurableAiAttempt), recordDurableReceipt: vi.fn(actual.recordDurableReceipt) };
});

import { requestAiJson, type AiJsonResult, type RequestAiJsonOptions } from "@/lib/ai/ai-client";
import * as durable from "@/lib/ai/durable-call";
import { reserveAiSpend } from "@/lib/ai/spend-ledger";
import { getPool } from "@/lib/db/pool";
import { resetModelCallGovernorForTests } from "@/lib/ai/model-call-governor";
import { decisionRequestSha256, effortPolicySha256, parseEffortPolicy } from "@/lib/ai/effort-policy.mjs";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { buildDecisionContextV7, InvalidModelOutputV7, rankDecisionV7, validateMatchPlanV7 } from "@/lib/competitions/v7/model";
import { RECOMMENDATION_IMPLEMENTATION_VERSION, RECOMMENDATION_POLICY_VERSION } from "@/lib/competitions/v7/contracts";
import { RANK_ENVELOPE_REPAIR_SYSTEM_PROMPT_V7 } from "@/lib/competitions/v7/rank-envelope-repair";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";

const policy = parseEffortPolicy({ version: "saitu.effort-policy.v1", rank: "low", explain: "low", review: "low" });
type Context = ReturnType<typeof buildDecisionContextV7>;
type Request = { prompt: string; options: RequestAiJsonOptions<unknown> };
type Wire = { messages: { role: string; content: string }[]; thinking: { type: string }; reasoning_effort: string; max_tokens: number; top_p?: number };
let requests: Request[], wires: Wire[], sequence: string[];
let responder: (wire: Wire, index: number) => Response;
let current: number;
const start = 1_799_999_000_000, deadline = start + 60_000;

function context() {
  const records = Array.from({ length: 45 }, (_, i) => syntheticRecord(i + 1));
  return buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records });
}
function output(ctx: Context) {
  const seen = new Set<string>();
  const selected = ctx.candidates.filter(({ record }) => !seen.has(record.seriesId) && Boolean(seen.add(record.seriesId))).slice(0, 5).reverse();
  return { profileRevision: ctx.profile.revision, catalogVersion: ctx.catalogVersion,
    recommendations: selected.map(({ record }) => ({ itemId: record.recordId, roleIndex: 0, rationale: "可按自报分析能力整理清理决定并检查结果。", ...rankFixtureEvidence(ctx, record.recordId) })), shortfallReason: null as string | null };
}
function wireOutput(ctx: Context) {
  const codec = createModelIdentifierCodec({ candidates: ctx.candidates.map(c => c.record.recordId), series: ctx.candidates.map(c => c.record.seriesId),
    facts: ctx.candidates.flatMap(c => c.record.facts.map(f => f.id)), students: ctx.profile.facts.map(f => f.id) });
  const body = rankFixtureAssessmentReply(ctx, output(ctx));
  return codec.encode(body) as typeof body;
}
const currentOutput = (ctx: Context) => echoRankWireHeaders(requests.at(-1)!.prompt, wireOutput(ctx));
function missingHeaders(ctx: Context) {
  const { assessments, shortfallReason } = wireOutput(ctx);
  return { type: "json_object", assessments, shortfallReason };
}
function response(value: unknown, finishReason = "stop") {
  return new Response(JSON.stringify({ choices: [{ message: { content: typeof value === "string" ? value : JSON.stringify(value) }, finish_reason: finishReason }],
    usage: { prompt_tokens: 100, completion_tokens: 30, prompt_cache_hit_tokens: 0 } }), { status: 200 });
}
function secondInput() { return JSON.parse(requests[1].prompt); }
function isEnvelopeRepair() { return requests[1]?.options.systemPrompt === RANK_ENVELOPE_REPAIR_SYSTEM_PROMPT_V7; }
function run(ctx: Context, modelCall?: NonNullable<Parameters<typeof rankDecisionV7>[1]>["modelCall"]) {
  return rankDecisionV7(ctx, { requestId: "synthetic-rank-envelope-invocation", deadlineEpochMs: deadline, modelCall: modelCall ?? (async (prompt, options) => {
    requests.push({ prompt, options });
    const schema = options.schema!;
    return requestAiJson(prompt, { ...options, schema: { safeParse(value) { sequence.push("schema"); return schema.safeParse(value); } } });
  }) });
}

beforeEach(() => {
  for (const [key, value] of Object.entries({ DATABASE_URL: "", AI_SPEND_RUN_ID: "", RUN_SPEND_LEDGER_POSTGRES_TESTS: "", RUN_DEEPSEEK_LIVE: "",
    AI_PROVIDER: "deepseek", AI_API_KEY: "synthetic-never-networked", AI_API_URL: "https://api.deepseek.com/chat/completions", AI_SPEND_AUTHORIZED_EFFORT: "stage",
    SAITU_V7_EFFORT_POLICY: JSON.stringify(policy), SAITU_V7_EFFORT_POLICY_SHA256: effortPolicySha256(policy), AI_TIMEOUT_MS: "60000", AI_REQUEST_DEADLINE_MS: "60000" })) vi.stubEnv(key, value);
  requests = []; wires = []; sequence = []; current = start;
  vi.spyOn(Date, "now").mockImplementation(() => current);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.mocked(reserveAiSpend).mockClear(); vi.mocked(getPool).mockClear();
  vi.mocked(durable.runDurableAiAttempt).mockClear(); vi.mocked(durable.recordDurableReceipt).mockClear();
  vi.mocked(durable.recordDurableReceipt).mockImplementation(async () => { sequence.push("receipt"); });
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: RequestInit) => {
    expect(String(url)).toBe("https://api.deepseek.com/chat/completions");
    const wire = JSON.parse(String(init.body)) as Wire;
    wires.push(wire);
    return responder(wire, wires.length - 1);
  }));
});
afterEach(() => {
  expect(getPool).not.toHaveBeenCalled();
  resetModelCallGovernorForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe("rank envelope repair through the actual JSON transport", () => {
  it("repairs only the missing headers and preserves all assessed rows, budget, key and effort", async () => {
    const ctx = context();
    responder = (_wire, index) => { if (!index) { current += 23_003; return response(missingHeaders(ctx)); } return response(currentOutput(ctx)); };
    const plan = await run(ctx);
    expect(plan.recommendations.map(r => r.itemId)).toEqual(output(ctx).recommendations.map(r => r.itemId).sort());
    expect(validateMatchPlanV7(plan, ctx).ok).toBe(true);
    expect(wires).toHaveLength(2); expect(isEnvelopeRepair()).toBe(true);
    expect((expandMatchingTables(JSON.parse(requests[0].prompt)) as { candidates: unknown[] }).candidates).toHaveLength(45);
    expect(secondInput()).not.toHaveProperty("candidates"); expect(secondInput()).not.toHaveProperty("profile");
    expect(secondInput().expectedHeaders).not.toEqual(JSON.parse(requests[0].prompt).outputFormat);
    expect(secondInput().expectedHeaders.catalogVersion).not.toBe(JSON.parse(requests[0].prompt).catalogVersion);
    expect(secondInput().fixedBody.assessments).toEqual(wireOutput(ctx).assessments);
    expect(secondInput().fixedBody.assessments).toHaveLength(45);
    expect(secondInput().sourceRequestSha256).toBe(decisionRequestSha256({ prompt: requests[0].prompt, system: requests[0].options.systemPrompt!,
      model: "deepseek-flash", maxTokens: 8192, topP: requests[0].options.topP, promptVersion: requests[0].options.promptVersion!, thinking: "enabled", reasoningEffort: "low", effortPolicySha256: effortPolicySha256(policy),
      recommendationPolicyVersion: RECOMMENDATION_POLICY_VERSION, implementationVersion: RECOMMENDATION_IMPLEMENTATION_VERSION }));
    expect(secondInput().sourceRequestSha256).toBe(vi.mocked(durable.runDurableAiAttempt).mock.calls[0][0].requestSha256);
    expect(requests.every(request => request.options.recommendationPolicyVersion === RECOMMENDATION_POLICY_VERSION
      && request.options.implementationVersion === RECOMMENDATION_IMPLEMENTATION_VERSION)).toBe(true);
    expect(sequence).toEqual(["receipt", "schema", "receipt", "schema"]);
    expect(requests.map(r => r.options.diagnosticContext?.reviewId)).toEqual(["effort-v1.initial", "effort-v1.invalid-output-repair"]);
    expect(requests.map(r => r.options.deadlineEpochMs)).toEqual([deadline, deadline]);
    expect(requests.map(r => r.options.requestDeadlineMs)).toEqual([60_000, 36_997]);
    expect(requests.map(r => r.options.timeoutMs)).toEqual([60_000, 36_997]);
    expect(wires.every(w => w.thinking.type === "enabled" && w.reasoning_effort === "low" && w.max_tokens === 8192 && w.top_p === 0.95)).toBe(true);
    expect(requests.map(request => request.options.topP)).toEqual([0.95, 0.95]);
    expect(vi.mocked(reserveAiSpend).mock.calls.map(([input]) => [input.operation, input.effort, input.effortPolicySha256])).toEqual(
      Array.from({ length: 2 }, () => ["competition_v7_rank", "low", effortPolicySha256(policy)]));
  });

  it.each(["order", "candidate", "rationale", "shortfall", "citations", "version"])("rejects an otherwise shaped repair that changes %s, without a third call", async mutation => {
    const ctx = context();
    responder = (_wire, index) => {
      if (!index) return response(missingHeaders(ctx));
      const value = currentOutput(ctx);
      if (mutation === "order") value.assessments.reverse();
      if (mutation === "candidate") [value.assessments[0].itemId, value.assessments[44].itemId] = [value.assessments[44].itemId, value.assessments[0].itemId];
      if (mutation === "rationale") value.assessments[0].fit!.rationale = "另一条看起来合法的内部依据";
      if (mutation === "shortfall") value.shortfallReason = "额外新增的取舍";
      if (mutation === "citations") value.assessments[0].fit!.competitionFactIds = ["@F0"];
      if (mutation === "version") value.profileRevision = "stale-profile";
      return response(value);
    };
    await expect(run(ctx)).rejects.toThrow("invalid_output");
    expect(isEnvelopeRepair()).toBe(true); expect(wires).toHaveLength(2);
  });

  it.each(["one-version", "foreign-claim", "invalid-index", "mixed-alias", "extra-root", "extra-row", "wrong-marker", "missing-row", "duplicate-row"])("does not redraw the list when %s lacks eligible captured headers or body", async defect => {
    const ctx = context();
    responder = () => {
      const value = missingHeaders(ctx);
      if (defect === "one-version") Reflect.set(value, "profileRevision", currentOutput(ctx).profileRevision);
      if (defect === "foreign-claim") value.assessments[0].fit!.competitionFactIds = ["@F999"];
      if (defect === "invalid-index") value.assessments[0].fit!.studentBasisIndices = [1];
      if (defect === "mixed-alias") value.assessments[0].fit!.studentBasisIndices = [0, "@P999"];
      if (defect === "extra-root") Reflect.set(value, "unverified", true);
      if (defect === "extra-row") Reflect.set(value.assessments[0], "unverified", true);
      if (defect === "wrong-marker") value.type = "WRONG";
      if (defect === "missing-row") value.assessments.pop();
      if (defect === "duplicate-row") value.assessments.push(structuredClone(value.assessments[0]));
      return response(value);
    };
    await expect(run(ctx)).rejects.toThrow("invalid_output");
    expect(isEnvelopeRepair()).toBe(false); expect(wires).toHaveLength(1);
  });

  it.each(["stale-version", "null-version", "empty-version", "foreign-id", "excluded-id", "duplicate-id", "foreign-with-extra"])("fails %s on the initial real transport path without a second call", async defect => {
    const ctx = context();
    if (defect === "excluded-id") {
      const excluded = ctx.candidates.pop()!;
      ctx.excluded.set(excluded.record.recordId, "用户明确不承担这个任务。");
    }
    responder = () => {
      const value = missingHeaders(ctx);
      if (defect === "stale-version") Reflect.set(value, "catalogVersion", "stale-catalog");
      if (defect === "null-version") Reflect.set(value, "profileRevision", null);
      if (defect === "empty-version") Reflect.set(value, "profileRevision", "");
      if (defect === "foreign-id" || defect === "foreign-with-extra") value.assessments[0].itemId = "@C999";
      if (defect === "excluded-id") value.assessments[0].itemId = [...ctx.excluded.keys()][0];
      if (defect === "foreign-with-extra") Reflect.set(value.assessments[0], "extra", true);
      if (defect === "duplicate-id") value.assessments[1].itemId = value.assessments[0].itemId;
      return response(value);
    };
    await expect(run(ctx)).rejects.toThrow("invalid_output");
    expect(requests).toHaveLength(1); expect(wires).toHaveLength(1);
    expect(vi.mocked(durable.runDurableAiAttempt).mock.calls.map(([input]) => input.key)).toEqual(["v7.rank:effort-v1.initial:1"]);
    expect(reserveAiSpend).toHaveBeenCalledTimes(1);
  });

  it.each(["invalid-json", "truncated", "empty"])("does not reinterpret %s as the missing-header case", async defect => {
    const ctx = context();
    responder = (_wire, index) => index ? response(currentOutput(ctx)) : defect === "invalid-json" ? response("{bad") : defect === "empty" ? response("") : response(missingHeaders(ctx), "length");
    await run(ctx); expect(isEnvelopeRepair()).toBe(false); expect(secondInput()).toHaveProperty("candidates"); expect(wires).toHaveLength(2);
  });

  it("never returns local filled headers when the one model repair also omits them", async () => {
    const ctx = context(); responder = () => response(missingHeaders(ctx));
    await expect(run(ctx)).rejects.toThrow("invalid_output"); expect(wires).toHaveLength(2); expect(isEnvelopeRepair()).toBe(true);
  });

  it("stops after an uncertain repair timeout", async () => {
    const ctx = context(); responder = (_wire, index) => { if (!index) return response(missingHeaders(ctx)); throw new DOMException("synthetic timeout", "AbortError"); };
    await expect(run(ctx)).rejects.toThrow("timeout"); expect(wires).toHaveLength(2); expect(isEnvelopeRepair()).toBe(true);
  });

  it.each(["timeout", "network_error", "durable_outcome_unknown"] as const)("does not repair initial %s, even if a seam previously called safeParse on bad raw", async reason => {
    const ctx = context(); let calls = 0;
    await expect(run(ctx, async (_prompt, options) => {
      calls++; options.schema!.safeParse(missingHeaders(ctx));
      return { ok: false, reason, upstreamAttempted: true, model: "deepseek-flash", httpStatus: 200, finishReason: "stop", attempts: 1 };
    })).rejects.toThrow(reason);
    expect(calls).toBe(1); expect(wires).toHaveLength(0);
  });

  it("does not trust an arbitrary caller-created InvalidModelOutputV7 as captured initial output", async () => {
    const ctx = context(); let calls = 0;
    await expect(run(ctx, async (prompt, options) => {
      requests.push({ prompt, options });
      if (++calls === 1) throw new InvalidModelOutputV7(["profileRevision:invalid_type expected=string", "catalogVersion:invalid_type expected=string"]);
      const parsed = options.schema!.safeParse(currentOutput(ctx));
      return { ok: true, data: parsed.success ? parsed.data : undefined, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 };
    })).rejects.toThrow("invalid_output");
    expect(isEnvelopeRepair()).toBe(false); expect(calls).toBe(1);
  });

  it("revalidates a saved initial receipt through the same transport capture, without dispatching that initial request again", async () => {
    const ctx = context();
    vi.mocked(durable.runDurableAiAttempt).mockImplementationOnce(async (_input, _work, replay) => replay({ model: "deepseek-flash", httpStatus: 200,
      finishReason: "stop", content: JSON.stringify(missingHeaders(ctx)), attempts: 1, durationMs: 23003, usage: { inputTokens: 100, outputTokens: 30, cachedInputTokens: 0 } }) as AiJsonResult<unknown>);
    responder = () => response(currentOutput(ctx));
    const plan = await run(ctx);
    expect(plan.recommendations.map(r => r.itemId)).toEqual(output(ctx).recommendations.map(r => r.itemId).sort());
    expect(requests).toHaveLength(2); expect(wires).toHaveLength(1); expect(isEnvelopeRepair()).toBe(true);
    expect(vi.mocked(durable.runDurableAiAttempt).mock.calls.map(([input]) => input.key)).toEqual(["v7.rank:effort-v1.initial:1", "v7.rank:effort-v1.invalid-output-repair:1"]);
  });
});
