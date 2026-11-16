import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DurableReceipt } from "@/lib/ai/durable-call";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { buildDecisionContextV7, DECISION_RANK_PROMPT_VERSION_V7, rankDecisionV7 } from "@/lib/competitions/v7/model";
import { rankingCandidatesV7, rankingConditionsV7 } from "@/lib/competitions/v7/rank-packet";
import { readPublicDiagnosticFixture } from "./fixtures/v7-public-diagnostics";

// Replace only durable storage lookup, never the production JSON parser or rank
// validation. The work callback, database and network must remain unused.
const offline = vi.hoisted(() => ({
  receipts: [] as unknown[], requests: [] as { key: string; prompt: string }[],
  newHttpCalls: 0,
}));
vi.mock("@/lib/ai/durable-call", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/ai/durable-call")>(),
  hasDurableAiRun: () => true,
  runDurableAiAttempt: async (input: { key: string; prompt: string }, _work: () => Promise<unknown>, replay: (receipt: unknown) => unknown) => {
    offline.requests.push(input);
    if (!offline.receipts.length) throw new Error("offline_receipt_exhausted_no_dispatch_allowed");
    return replay(offline.receipts.shift());
  },
}));

const root = process.cwd();
const diagnostic = "artifacts/continuation-v7-20261109/latency-diagnostic-03";
const outputDir = process.env.SAITU_V7_INDEPENDENT_REVIEW_ARTIFACT_DIR
  ? path.resolve(process.env.SAITU_V7_INDEPENDENT_REVIEW_ARTIFACT_DIR) : null;
const readJson = (name: string) => readPublicDiagnosticFixture(`${diagnostic}/${name}`);
const input = readJson("input.json"), registration = readJson("registration.json"), result = readJson("result.json");
const savedReceipts = result.calls.map((call: { saved: { kind: string; receipt: DurableReceipt } }) => {
  if (call.saved.kind !== "receipt") throw new Error("expected_preserved_real_http_receipt");
  return call.saved.receipt;
}) as DurableReceipt[];

type RankPayload = {
  type?: unknown; profileRevision: string; catalogVersion: string; shortfallReason: string | null;
  recommendations: { itemId: string; rationale?: string; studentFactIds?: string[]; competitionFactIds?: string[]; [key: string]: unknown }[];
  [key: string]: unknown;
};
const historicalOutput = () => JSON.parse(String(savedReceipts[1].content)) as RankPayload;
// Author an explicit offline Top5 fixture from preserved public content. This
// tests current parsing only; it is not a new real five-item success receipt.
const rawOutput = () => {
  const output = historicalOutput();
  return { ...output, recommendations: output.recommendations.slice(0, 5), shortfallReason: null };
};
const context = () => buildDecisionContextV7(input.originalProfile, {
  profile: structuredClone(input.profile), records: structuredClone(input.records), now: new Date(registration.asOf),
});
function codec(ctx: ReturnType<typeof context>) {
  return createModelIdentifierCodec({ candidates: ctx.candidates.map(({ record }) => record.recordId),
    series: ctx.candidates.map(({ record }) => record.seriesId), facts: ctx.candidates.flatMap(({ record }) => record.facts.map(fact => fact.id)),
    students: ctx.profile.facts.map(fact => fact.id) });
}
const receiptWith = (output: RankPayload): DurableReceipt => ({ ...savedReceipts[1], content: JSON.stringify(output) });
const replayRecords: unknown[] = [];
function recordReplay(label: string, plan: MatchPlanV6, observations: unknown[]) {
  replayRecords.push({ label, storageLookupMocked: true, productionPath: ["rankDecisionV7", "requestAiJson", "replayDurableReceipt", "rankingSchema", "validateMatchPlanV7"],
    outputFixture: "explicit offline Top5 projection; original historical receipt remains unchanged",
    receiptCount: offline.requests.length, newHttpCalls: offline.newHttpCalls,
    callKeys: offline.requests.map(row => row.key), currentPromptSha256: offline.requests.map(row => createHash("sha256").update(row.prompt).digest("hex")),
    outputItemIds: plan.recommendations.map(row => row.itemId), outputHasType: Object.hasOwn(plan, "type"), observations });
}

beforeEach(() => {
  offline.receipts.length = 0; offline.requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(() => { offline.newHttpCalls++; throw new Error("new_http_forbidden_in_offline_review"); }));
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  expect(offline.newHttpCalls).toBe(0);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
afterAll(() => {
  if (!outputDir) return;
  if (["source-manifest.json", "offline-replay.json"].some(file => existsSync(path.join(outputDir, file)))) throw new Error("independent_review_output_already_exists");
  mkdirSync(outputDir, { recursive: true });
  const files = ["src/lib/competitions/v7/model.ts", "src/lib/competitions/v7/rank-packet.ts", "src/lib/ai/ai-client.ts", "src/lib/ai/durable-call.ts",
    `${diagnostic}/input.json`, `${diagnostic}/result.json`, `${diagnostic}/registration.json`,
    "artifacts/continuation-v7-20261109/rank-format-repair/model-before.ts", "artifacts/continuation-v7-20261109/rank-format-repair/model-after.ts",
    "artifacts/continuation-v7-20261109/rank-format-repair/candidate.patch", "tests/review-v7-rank-format-independent.test.ts"];
  writeFileSync(path.join(outputDir, "source-manifest.json"), JSON.stringify({ files: files.map(file => ({ path: file,
    sha256: createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex") })) }, null, 2) + "\n", { flag: "wx" });
  writeFileSync(path.join(outputDir, "offline-replay.json"), JSON.stringify({ schemaVersion: "saitu.rank-format-independent-review.v1",
    notAcceptanceEvidence: true, newHttpCalls: offline.newHttpCalls,
    originalReceiptMetadata: savedReceipts.map(receipt => ({ finishReason: receipt.finishReason, durationMs: receipt.durationMs, usage: receipt.usage,
      contentSha256: createHash("sha256").update(String(receipt.content)).digest("hex") })), replayRecords,
    limitations: ["Preserved public receipts plus an explicit offline Top5 content projection; no fresh model success, 4-of-5 acceptance or performance evidence.",
      "Durable storage lookup is mocked; production parsing, ID decoding, schemas and semantic rank validation run unchanged.",
      "Changed prompt/version hashes prevent direct recovery of old durable database rows; this is content compatibility, not database recovery."] }, null, 2) + "\n", { flag: "wx" });
});

describe("independent review: saved real HTTP content through production rank parsing", () => {
  it("accepts an offline Top5 projection of the saved stop receipt and preserves all five decoded IDs and rationales", async () => {
    const ctx = context(), raw = rawOutput(), decoded = codec(ctx).decode(raw) as RankPayload;
    expect(ctx.candidates).toHaveLength(45);
    expect(raw.type).toBe("json_object");
    expect(raw.profileRevision).toBe(ctx.profile.revision); expect(raw.catalogVersion).toBe(ctx.catalogVersion);
    offline.receipts.push(receiptWith(rawOutput()));
    const observations: unknown[] = [];
    const plan = await rankDecisionV7(ctx, { onObservation: async event => { observations.push(event); } });
    expect(offline.requests.map(row => row.key)).toEqual(["v7.rank:effort-v1.initial:1"]);
    expect(offline.receipts).toHaveLength(0);
    expect(plan.recommendations).toHaveLength(5);
    expect(plan.recommendations.map(row => row.itemId)).toEqual(decoded.recommendations.map(row => row.itemId));
    expect(plan.recommendations.map(row => row.reasons[0].text)).toEqual(raw.recommendations.map(row => row.rationale));
    expect(new Set(plan.recommendations.map(row => ctx.candidates.find(candidate => candidate.record.recordId === row.itemId)!.record.seriesId)).size).toBe(5);
    expect(plan).not.toHaveProperty("type");
    expect(plan.recommendations.every(row => row.reasons[0].basis === "suggestion" && !row.reasons[0].studentFactIds.length && !row.reasons[0].competitionFactIds.length)).toBe(true);
    recordReplay("offline_top5_projection_single_parse", plan, observations);
  });

  it("replays the original truncation and an offline Top5 repair fixture without new HTTP", async () => {
    offline.receipts.push(structuredClone(savedReceipts[0]), receiptWith(rawOutput()));
    const observations: { stage: string; kind: string; data: unknown }[] = [];
    const plan = await rankDecisionV7(context(), { onObservation: async event => { observations.push(event); } });
    expect(offline.requests.map(row => row.key)).toEqual(["v7.rank:effort-v1.initial:1", "v7.rank:effort-v1.invalid-output-repair:1"]);
    expect(observations.filter(row => row.kind === "response").map(row => row.data)).toMatchObject([
      { ok: false, repair: false, reason: "truncated" }, { ok: true, repair: true, reason: null },
    ]);
    expect(offline.receipts).toHaveLength(0);
    recordReplay("original_truncation_then_offline_top5_fixture_no_new_dispatch", plan, observations);
  });

  it("accepts the original marker-free contract with the same result", async () => {
    const ctx = context(), raw = rawOutput(); delete raw.type;
    offline.receipts.push(receiptWith(raw));
    const plan = await rankDecisionV7(ctx), expected = codec(ctx).decode(raw) as RankPayload;
    expect(plan.recommendations.map(row => row.itemId)).toEqual(expected.recommendations.map(row => row.itemId));
    expect(offline.requests).toHaveLength(1); expect(plan).not.toHaveProperty("type");
  });

  it("keeps the 40-character boundary after withdrawing the 12–18 character generation target", async () => {
    const raw = rawOutput(); raw.recommendations[0].rationale = "依".repeat(40);
    offline.receipts.push(receiptWith(raw));
    const plan = await rankDecisionV7(context());
    expect(plan.recommendations[0].reasons[0].text).toHaveLength(40);
    expect(offline.requests).toHaveLength(1);
  });

  it("retains the complete fee packet and explicitly preserves historical/current and registration/total-cost boundaries", async () => {
    const ctx = context(); offline.receipts.push(receiptWith(rawOutput()));
    await rankDecisionV7(ctx);
    const request = JSON.parse(offline.requests[0].prompt) as { prompt: string; system: string; promptVersion: string; model: string; maxTokens: number };
    const packet = codec(ctx).decode(expandCandidateEvidence(expandMatchingTables(JSON.parse(request.prompt)))) as {
      candidates: ReturnType<typeof rankingCandidatesV7>; candidateConditions: ReturnType<typeof rankingConditionsV7>;
      candidateDefaults?: Pick<ReturnType<typeof rankingCandidatesV7>[number], "unknowns">;
    };
    if (packet.candidateDefaults) packet.candidates = packet.candidates.map(candidate => ({ ...packet.candidateDefaults!, ...candidate }));
    expect(request).toMatchObject({ model: "deepseek-flash", maxTokens: 8192,
      promptVersion: `${DECISION_RANK_PROMPT_VERSION_V7}.rank` });
    expect(packet.candidates).toEqual(rankingCandidatesV7(ctx));
    expect(packet.candidateConditions).toEqual(rankingConditionsV7(ctx));
    const unknownCost = packet.candidates.filter(row => row.personalCost && !row.personalCost.verifiedCurrent);
    expect(unknownCost.length).toBeGreaterThan(0);
    for (const row of unknownCost) expect(packet.candidateConditions.some(condition => condition.itemIds.includes(row.itemId) && condition.text === "个人总支出仍需核实，尚不能认定符合已报预算。")).toBe(true);
    expect(request.system).toContain("历史费用不是当前保证，报名费不等于个人总支出");
    expect(request.system).toContain("未给明确汇率不得换算外币或据此断言预算满足");
    expect(request.system).toContain("总支出未知不能写成免费、预算内或已满足预算");
    expect(request.system).not.toMatch(/目标12至18字|完整读一遍全部候选|决策分三步/);
  });
});

const badOutputs: [string, (output: RankPayload) => void, string?][] = [
  ["wrong marker", output => { output.type = "json_schema"; }],
  ["null marker", output => { output.type = null; }],
  ["object marker", output => { output.type = { type: "json_object" }; }],
  ["unknown top-level field", output => { output.unverifiedWinner = true; }],
  ["unknown recommendation field", output => { output.recommendations[0].type = "json_object"; }],
  ["out-of-pool ID", output => { output.recommendations[0].itemId = "@C999999"; }, "unknown_or_excluded_candidate"],
  ["stale profile revision", output => { output.profileRevision = "stale-profile"; }, "stale_profile_revision"],
  ["stale catalog version", output => { output.catalogVersion = "stale-catalog"; }, "stale_catalog_version"],
  ["duplicate series", output => { output.recommendations[1].itemId = output.recommendations[0].itemId; }, "duplicate_series"],
  ["six recommendations", output => { output.recommendations.push(structuredClone(historicalOutput().recommendations[5])); }],
  ["41-character rationale", output => { output.recommendations[0].rationale = "依".repeat(41); }],
  ["blank rationale", output => { output.recommendations[0].rationale = "   "; }],
  ["missing rationale", output => { delete output.recommendations[0].rationale; }],
  ["unexplained shortfall", output => { output.recommendations.pop(); }, "unexplained_shortlist_shortfall"],
  ["unknown student reference", output => { output.recommendations[0].studentFactIds = ["@P999999"]; }],
  ["unknown competition reference", output => { output.recommendations[0].competitionFactIds = ["@F999999"]; }],
];
describe("independent review: marker does not relax structural or semantic validation", () => {
  it.each(badOutputs)("rejects %s", async (_label, mutate, semanticIssue) => {
    const raw = rawOutput(); mutate(raw); const receipt = receiptWith(raw);
    offline.receipts.push(receipt, structuredClone(receipt));
    const observations: { kind: string; data: unknown }[] = [];
    await expect(rankDecisionV7(context(), { onObservation: async event => { observations.push(event); } })).rejects.toThrow("invalid_output");
    const terminal = Boolean(semanticIssue && /unknown_or_excluded_candidate|stale_|duplicate_series/.test(semanticIssue));
    expect(offline.requests).toHaveLength(terminal ? 1 : 2); expect(offline.receipts).toHaveLength(terminal ? 1 : 0);
    if (semanticIssue) expect(JSON.stringify(observations.filter(event => event.kind === "validation"))).toContain(semanticIssue);
  });

  it("rejects finish_reason length even when the saved content is otherwise valid JSON", async () => {
    const receipt = { ...receiptWith(rawOutput()), finishReason: "length" };
    offline.receipts.push(receipt, structuredClone(receipt));
    await expect(rankDecisionV7(context())).rejects.toThrow("invalid_output");
    expect(offline.requests).toHaveLength(2);
  });
});
