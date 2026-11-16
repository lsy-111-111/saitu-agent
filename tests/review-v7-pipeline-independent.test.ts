import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readPublicDiagnosticFixture } from "./fixtures/v7-public-diagnostics";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DurableReceipt } from "@/lib/ai/durable-call";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { isDecisionEvidenceFact } from "@/lib/competitions/v6/evidence";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { buildDecisionContextV7, explainDecisionV7, rankDecisionV7, validateDecisionReportV7, validateMatchPlanV7 } from "@/lib/competitions/v7/model";

type StoredRequest = { key: string; prompt: string };
const offline = vi.hoisted(() => ({ requests: [] as StoredRequest[], newHttpCalls: 0,
  provide: undefined as undefined | ((input: StoredRequest) => unknown) }));
vi.mock("@/lib/ai/durable-call", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/ai/durable-call")>(), hasDurableAiRun: () => true,
  runDurableAiAttempt: async (input: StoredRequest, _work: () => Promise<unknown>, replay: (receipt: unknown) => unknown) => {
    offline.requests.push(input);
    if (!offline.provide) throw new Error("offline_fixture_missing_no_dispatch_allowed");
    return replay(offline.provide(input));
  },
}));

const root = process.cwd(), sourceDir = "artifacts/continuation-v7-20261109/latency-diagnostic-03";
const outputDir = process.env.SAITU_V7_INDEPENDENT_REVIEW_ARTIFACT_DIR
  ? path.resolve(process.env.SAITU_V7_INDEPENDENT_REVIEW_ARTIFACT_DIR) : null;
const readJson = (file: string) => readPublicDiagnosticFixture(`${sourceDir}/${file}`);
const input = readJson("input.json"), registration = readJson("registration.json"), diagnostic = readJson("result.json");
const originalRankReceipt = diagnostic.calls[1].saved.receipt as DurableReceipt;
const publicContext = () => buildDecisionContextV7(input.originalProfile, { profile: structuredClone(input.profile), records: structuredClone(input.records), now: new Date(registration.asOf) });
type Context = ReturnType<typeof publicContext>;
function codec(ctx: Context) {
  return createModelIdentifierCodec({ candidates: ctx.candidates.map(({ record }) => record.recordId), series: ctx.candidates.map(({ record }) => record.seriesId),
    facts: ctx.candidates.flatMap(({ record }) => record.facts.map(fact => fact.id)), students: ctx.profile.facts.map(fact => fact.id) });
}
// The following explanation/review receipts are contract fixtures, not model outputs.
const syntheticReceipt = (data: unknown): DurableReceipt => ({ model: "deepseek-flash", httpStatus: 200, finishReason: "stop",
  content: JSON.stringify(data), durationMs: 0, attempts: 1, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } });
async function ranked(ctx: Context) {
  offline.provide = request => {
    if (!request.key.startsWith("v7.rank:")) throw new Error("unexpected_stage");
    return structuredClone(originalRankReceipt);
  };
  return rankDecisionV7(ctx);
}
function officialFact(ctx: Context, itemId: string) {
  const record = ctx.candidates.find(candidate => candidate.record.recordId === itemId)!.record;
  const fact = record.facts.find(fact => fact.kind === "official_fact" && isDecisionEvidenceFact(record, fact) && fact.text.length <= 250 && ["task", "track", "deliverables"].includes(fact.field))
    ?? record.facts.find(fact => fact.kind === "official_fact" && isDecisionEvidenceFact(record, fact) && fact.text.length <= 250);
  if (!fact) throw new Error(`no_short_usable_public_fact:${itemId}`);
  return fact;
}
function officialExplanation(ctx: Context, plan: MatchPlanV6): MatchPlanV6 {
  return { ...plan, recommendations: plan.recommendations.map(item => {
    const fact = officialFact(ctx, item.itemId);
    return { itemId: item.itemId, reasons: [{ text: fact.text, basis: "official", studentFactIds: [], competitionFactIds: [fact.id], conditions: [] }] };
  }) };
}
type JsonObject = Record<string, unknown>;
function provideExplanation(ctx: Context, explained: MatchPlanV6, markers: { explain?: boolean; review?: boolean;
  mutateExplain?: (value: JsonObject) => void; mutateReview?: (value: JsonObject) => void } = {}) {
  offline.provide = request => {
    if (request.key.startsWith("v7.explain:")) {
      const value = { ...codec(ctx).encode(explained) as object, ...(markers.explain ? { type: "json_object" } : {}) } as JsonObject;
      markers.mutateExplain?.(value); return syntheticReceipt(value);
    }
    if (request.key.startsWith("v7.review:")) {
      const outer = JSON.parse(request.prompt), payload = JSON.parse(outer.prompt) as { assertions: { key: string }[] };
      const value = { checks: payload.assertions.map(row => ({ key: row.key, supported: true, reason: "逐字原文事实支持此合同样例。" })), ...(markers.review ? { type: "json_object" } : {}) } as JsonObject;
      markers.mutateReview?.(value); return syntheticReceipt(value);
    }
    throw new Error("unexpected_stage");
  };
}
const probes: unknown[] = [];
function record(label: string, details: object) {
  probes.push({ label, newHttpCalls: offline.newHttpCalls, stages: offline.requests.map(request => request.key), ...details });
}
beforeEach(() => {
  offline.requests.length = 0; offline.provide = undefined;
  vi.stubGlobal("fetch", vi.fn(() => { offline.newHttpCalls++; throw new Error("new_http_forbidden"); }));
  vi.spyOn(console, "info").mockImplementation(() => undefined); vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  expect(offline.newHttpCalls).toBe(0); expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
afterAll(() => {
  if (!outputDir) return;
  if (existsSync(path.join(outputDir, "pipeline-probes.json"))) throw new Error("independent_review_output_already_exists");
  mkdirSync(outputDir, { recursive: true });
  const sources = ["src/lib/competitions/v7/model.ts", "src/lib/competitions/v6/engine.ts", "src/lib/competitions/v6/contracts.ts",
    "src/lib/competitions/v6/validation.ts", "src/lib/ai/ai-client.ts", "src/lib/ai/durable-call.ts", "tests/review-v7-pipeline-independent.test.ts"];
  const files = sources.map(file => {
    const bytes = readFileSync(path.join(root, file)), sha256 = createHash("sha256").update(bytes).digest("hex");
    const snapshot = `pipeline-${path.basename(file)}-${sha256}`;
    if (!existsSync(path.join(outputDir, snapshot))) writeFileSync(path.join(outputDir, snapshot), bytes, { flag: "wx" });
    return { path: file, sha256, snapshot };
  });
  writeFileSync(path.join(outputDir, "pipeline-probes.json"), JSON.stringify({ schemaVersion: "saitu.pipeline-independent-probes.v1", files, probes,
    newHttpCalls: offline.newHttpCalls, notAcceptanceEvidence: true,
    limitations: ["Only the ranking receipt is actual saved model content; all explanation and review receipts are explicit offline contract fixtures.",
      "Durable storage lookup is mocked; production receipt parser, stage schemas, ID codec, semantic validation and report assembly execute.",
      "These probes do not establish fresh model success, acceptance, performance, or recovery of an old durable database row."] }, null, 2) + "\n", { flag: "wx" });
});

describe("independent full C pipeline contract probes", () => {
  it("assembles the saved real ten-item rank with exact supported public facts", async () => {
    const ctx = publicContext(), plan = await ranked(ctx), explanation = officialExplanation(ctx, plan);
    provideExplanation(ctx, explanation);
    const report = await explainDecisionV7(ctx, plan);
    expect(validateDecisionReportV7(report, ctx)).toEqual({ ok: true, issues: [] });
    expect(report.recommendations.map(item => item.itemId)).toEqual(plan.recommendations.map(item => item.itemId));
    expect(offline.requests).toHaveLength(2);
    record("saved_rank_plus_exact_public_fact_explanation", { accepted: true, count: report.recommendations.length });
  });

  it("repairs a comparison citing the third selected item before review and completes the original order", async () => {
    const ctx = publicContext(), plan = await ranked(ctx), explanation = officialExplanation(ctx, plan);
    const thirdId = plan.recommendations[2].itemId, fact = officialFact(ctx, thirdId);
    const invalid = { ...explanation, comparison: { text: fact.text, basis: "official" as const, studentFactIds: [], competitionFactIds: [fact.id], conditions: [] } };
    expect(validateMatchPlanV7(invalid, ctx).ok).toBe(false);
    let attempts = 0;
    offline.provide = request => {
      if (!request.key.startsWith("v7.explain:")) throw new Error("review_not_expected_after_repair");
      attempts++;
      if (attempts === 2) {
        const payload = JSON.parse(JSON.parse(request.prompt).prompt);
        expect(payload.repairOnly).toBe(true); expect(JSON.stringify(payload.issues)).toContain(fact.id);
      }
      return syntheticReceipt(codec(ctx).encode(attempts === 1 ? invalid : explanation));
    };
    const observations: { stage: string; kind: string; data: unknown }[] = [];
    const report = await explainDecisionV7(ctx, plan, { onObservation: async event => { observations.push(event); } });
    const validations = observations.filter(event => event.stage === "v7.explain" && event.kind === "validation");
    expect(validations[0].data).toMatchObject({ ok: false }); expect(JSON.stringify(validations[0])).toContain(fact.id);
    expect(validations[1].data).toEqual({ ok: true, issues: [] });
    expect(report.recommendations.map(item => item.itemId)).toEqual(plan.recommendations.map(item => item.itemId));
    expect(offline.requests.map(request => request.key)).toEqual(["v7.rank:batch:1", "v7.explain:batch:1", "v7.explain:invalid-output-repair:1"]);
    record("comparison_third_selected_item_repaired_before_review", { accepted: true, explanationAttempts: attempts, reviewAttempts: 0,
      thirdItemId: thirdId, comparisonFactId: fact.id, sourceFactText: fact.text });
  });

  it("accepts the same optional comparison contract when its fact belongs to the first report item", async () => {
    const ctx = publicContext(), plan = await ranked(ctx), explanation = officialExplanation(ctx, plan), fact = officialFact(ctx, plan.recommendations[0].itemId);
    explanation.comparison = { text: fact.text, basis: "official", studentFactIds: [], competitionFactIds: [fact.id], conditions: [] };
    provideExplanation(ctx, explanation);
    const report = await explainDecisionV7(ctx, plan);
    expect(report.comparisons[0].tradeoff).toEqual(explanation.comparison);
    record("comparison_first_item_control", { accepted: true });
  });

  it("accepts a supported paraphrase through the synchronous support-review contract", async () => {
    const ctx = publicContext(), plan = await ranked(ctx), explanation = officialExplanation(ctx, plan);
    explanation.recommendations[0].reasons[0].text = `原文所述任务：${explanation.recommendations[0].reasons[0].text}`;
    provideExplanation(ctx, explanation);
    const report = await explainDecisionV7(ctx, plan);
    expect(report.trace.verification).toBe("model_reviewed"); expect(report.trace.supportChecks).toBe(1);
    record("supported_public_fact_paraphrase_review_control", { accepted: true, supportChecks: report.trace.supportChecks });
  });

  it("accepts the fixed marker at explanation without publishing it in the report", async () => {
    const ctx = publicContext(), plan = await ranked(ctx), explanation = officialExplanation(ctx, plan);
    provideExplanation(ctx, explanation, { explain: true });
    const report = await explainDecisionV7(ctx, plan);
    expect(report).not.toHaveProperty("type"); expect(offline.requests).toHaveLength(2);
    record("conditional_fixed_marker_at_explanation", { accepted: true, outputHasType: Object.hasOwn(report, "type"), markerObservedInActualExplanation: false });
  });

  it("accepts the fixed marker at support review without publishing it in the report", async () => {
    const ctx = publicContext(), plan = await ranked(ctx), explanation = officialExplanation(ctx, plan);
    explanation.recommendations[0].reasons[0].text = `原文所述任务：${explanation.recommendations[0].reasons[0].text}`;
    provideExplanation(ctx, explanation, { review: true });
    const report = await explainDecisionV7(ctx, plan);
    expect(report).not.toHaveProperty("type"); expect(report.trace.supportChecks).toBe(1);
    expect(offline.requests.map(request => request.key)).toEqual(["v7.rank:batch:1", "v7.explain:batch:1", "v7.review:batch:1"]);
    record("conditional_fixed_marker_at_support_review", { accepted: true, outputHasType: Object.hasOwn(report, "type"), markerObservedInActualReview: false });
  });

  it("rejects two consecutive out-of-scope comparisons before any support-review dispatch", async () => {
    const ctx = publicContext(), plan = await ranked(ctx), explanation = officialExplanation(ctx, plan), fact = officialFact(ctx, plan.recommendations[2].itemId);
    explanation.comparison = { text: fact.text, basis: "official", studentFactIds: [], competitionFactIds: [fact.id], conditions: [] };
    provideExplanation(ctx, explanation);
    await expect(explainDecisionV7(ctx, plan)).rejects.toThrow("invalid_output");
    expect(offline.requests.map(request => request.key)).toEqual(["v7.rank:batch:1", "v7.explain:batch:1", "v7.explain:invalid-output-repair:1"]);
    record("comparison_continuously_outside_first_two", { rejectedBeforeReview: true, explanationAttempts: 2, reviewAttempts: 0 });
  });

  it.each([0, 1])("requires at least two selected items for optional comparison: %s", async count => {
    const ctx = publicContext(), plan = await ranked(ctx), fact = officialFact(ctx, plan.recommendations[0].itemId);
    const fewer = { ...plan, recommendations: plan.recommendations.slice(0, count), shortfallReason: "公开离线合同样例仅保留此数量。",
      comparison: { text: fact.text, basis: "official" as const, studentFactIds: [], competitionFactIds: [fact.id], conditions: [] } };
    expect(validateMatchPlanV7(fewer, ctx).issues).toContain("comparison_requires_two_candidates");
  });

  it("also accepts comparison evidence from the second selected item through review", async () => {
    const ctx = publicContext(), plan = await ranked(ctx), explanation = officialExplanation(ctx, plan), fact = officialFact(ctx, plan.recommendations[1].itemId);
    explanation.comparison = { text: fact.text, basis: "official", studentFactIds: [], competitionFactIds: [fact.id], conditions: [] };
    provideExplanation(ctx, explanation, { explain: true, review: true });
    const report = await explainDecisionV7(ctx, plan);
    expect(report.comparisons[0].tradeoff).toEqual(explanation.comparison); expect(report.trace.supportChecks).toBe(1);
    const request = JSON.parse(offline.requests[1].prompt);
    expect(request.system).toContain("只比较fixedOrder中的前两项，只引用这两项的赛事事实");
    expect(request.system).toContain("所选不足两项时必须省略comparison");
  });
});

const explainDefects: [string, (value: JsonObject) => void][] = [
  ["wrong marker", value => { value.type = "json_schema"; }],
  ["null marker", value => { value.type = null; }],
  ["object marker", value => { value.type = { type: "json_object" }; }],
  ["extra top-level field with correct marker", value => { value.type = "json_object"; value.unverifiedWinner = true; }],
  ["nested marker with correct top-level marker", value => { value.type = "json_object"; (value.recommendations as JsonObject[])[0].type = "json_object"; }],
  ["stale profile version with correct marker", value => { value.type = "json_object"; value.profileRevision = "stale-profile"; }],
  ["foreign item ID with correct marker", value => { value.type = "json_object"; (value.recommendations as JsonObject[])[0].itemId = "@C999999"; }],
];
describe("independent explanation envelope regression", () => {
  it.each(explainDefects)("rejects %s within the existing two-attempt bound", async (_label, mutateExplain) => {
    const ctx = publicContext(), plan = await ranked(ctx), explanation = officialExplanation(ctx, plan);
    provideExplanation(ctx, explanation, { mutateExplain });
    await expect(explainDecisionV7(ctx, plan)).rejects.toThrow("invalid_output");
    expect(offline.requests.map(request => request.key)).toEqual(["v7.rank:batch:1", "v7.explain:batch:1", "v7.explain:invalid-output-repair:1"]);
  });
});
const reviewDefects: [string, (value: JsonObject) => void, string][] = [
  ["wrong marker", value => { value.type = "json_schema"; }, "invalid_output"],
  ["null marker", value => { value.type = null; }, "invalid_output"],
  ["object marker", value => { value.type = { type: "json_object" }; }, "invalid_output"],
  ["extra top-level field with correct marker", value => { value.type = "json_object"; value.unverifiedWinner = true; }, "invalid_output"],
  ["nested marker with correct top-level marker", value => { value.type = "json_object"; (value.checks as JsonObject[])[0].type = "json_object"; }, "invalid_output"],
  ["missing check key", value => { delete (value.checks as JsonObject[])[0].key; }, "invalid_output"],
  ["missing verdict row", value => { value.checks = []; }, "incomplete_support_review"],
  ["foreign check key", value => { (value.checks as JsonObject[])[0].key = "foreign-key"; }, "incomplete_support_review"],
  ["duplicate check key", value => { (value.checks as JsonObject[]).push(structuredClone((value.checks as JsonObject[])[0])); }, "incomplete_support_review"],
  ["unsupported verdict", value => { (value.checks as JsonObject[])[0].supported = false; }, "unsupported_reason"],
];
describe("independent support-review envelope regression", () => {
  it.each(reviewDefects)("rejects %s without an additional review call", async (_label, mutateReview, error) => {
    const ctx = publicContext(), plan = await ranked(ctx), explanation = officialExplanation(ctx, plan);
    explanation.recommendations[0].reasons[0].text = `原文所述任务：${explanation.recommendations[0].reasons[0].text}`;
    provideExplanation(ctx, explanation, { mutateReview });
    await expect(explainDecisionV7(ctx, plan)).rejects.toThrow(error);
    expect(offline.requests.map(request => request.key)).toEqual(["v7.rank:batch:1", "v7.explain:batch:1", "v7.review:batch:1"]);
  });
});
