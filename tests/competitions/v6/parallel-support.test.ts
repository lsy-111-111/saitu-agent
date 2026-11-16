import "./mock-publication-boundary";
import { describe, expect, it } from "vitest";
import { withProductObservation } from "@/lib/ai/product-observation";
import { buildDecisionContext } from "@/lib/competitions/v6/engine";
import { bindRankedCatalogSuggestions, runDecisionRecommendation } from "@/lib/competitions/v6/model";
import { boundSupportClaims, freezeCatalogSupport } from "@/lib/competitions/v6/parallel-support";
import { syntheticCatalog, syntheticRecord, student } from "./decision-fixtures";

const profile = student({ confirmedFields: ["stage", "interests"], interests: ["data"] });
const makeContext = () => buildDecisionContext(profile, { records: syntheticCatalog, now: new Date("2026-11-05T08:00:00Z") });
const success = (data: unknown) => ({ ok: true as const, data, model: "contract-test", upstreamAttempted: true as const,
  httpStatus: 200, attempts: 1, durationMs: 1, finishReason: "stop", usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0 } });

describe("parallel fixed-statement support review", () => {
  it("starts every full-pool support shard before matching completes and binds the exact displayed statements", async () => {
    const context = makeContext(), selected = context.candidates.slice(0, 5).map(row => row.record.recordId).reverse();
    const reviewIds: string[] = [], events: { type: string; details: Record<string, unknown> }[] = [];
    let releaseMatch!: () => void;
    const matchGate = new Promise<void>(resolve => { releaseMatch = resolve; });
    const report = await withProductObservation({ observer: event => { events.push(event); } }, () => runDecisionRecommendation(profile, {
      context, method: "llm", modelCall: async (prompt, options) => {
        expect(options.reasoningEffort).toBe("max"); expect(options.thinking).toBe("enabled");
        expect(options.maxAttempts).toBe(1);
        if (options.diagnosticContext?.stage === "match") {
          await matchGate;
          return success({ itemIds: selected, shortfallReason: null });
        }
        const input = JSON.parse(prompt);
        reviewIds.push(options.diagnosticContext!.reviewId!);
        expect(input.assertions.every((assertion: { itemId: string }) => input.candidates.some((candidate: { itemId: string }) => candidate.itemId === assertion.itemId))).toBe(true);
        if (reviewIds.length === context.candidates.length) releaseMatch();
        return success({ rows: input.assertions.map((row: { key: string }) => [row.key, 1, "合成合同依据"]) });
      },
    }));
    expect(report.fallback.used).toBe(false);
    expect(report.recommendations.map(row => row.itemId)).toEqual(selected);
    expect(report.trace.callCount).toBe(context.candidates.length + 1);
    const binding = events.find(event => event.type === "decision_support_binding")!.details;
    expect(binding.expectedClaims).toBe(10); expect(binding.coveredClaims).toBe(10);
    expect(binding.deadlineEpochMs).toBe(events.find(event => event.type === "decision_model_stage")!.details.deadlineEpochMs);
    const frozen = freezeCatalogSupport(context, bindRankedCatalogSuggestions(context, { itemIds: context.candidates.map(row => row.record.recordId) }));
    for (const row of report.recommendations) {
      const original = bindRankedCatalogSuggestions(context, { itemIds: [row.itemId] }).recommendations[0];
      expect(row.reasons).toEqual(original.reasons);
      expect(row.currentRole).toEqual(original.roleReason);
      expect((binding.bindings as { claimSha256: string }[]).map(row => row.claimSha256)).toEqual(expect.arrayContaining(frozen.entries.get(row.itemId)!.claims.map(claim => claim.claimSha256)));
    }
  });

  it("fails closed for missing, duplicate, unknown and negative selected verdicts", async () => {
    for (const fault of ["missing", "duplicate", "unknown", "unsupported"] as const) {
      const context = makeContext(), selected = context.candidates.slice(0, 5).map(row => row.record.recordId);
      const report = await runDecisionRecommendation(profile, { context, method: "llm", modelCall: async (prompt, options) => {
        if (options.diagnosticContext?.stage === "match") return success({ itemIds: selected, shortfallReason: null });
        const rows = JSON.parse(prompt).assertions.map((row: { key: string }) => [row.key, fault === "unsupported" ? 0 : 1, "合成审定"]);
        if (fault === "missing") rows.pop();
        if (fault === "duplicate") rows[1][0] = rows[0][0];
        if (fault === "unknown") rows[0][0] = "unknown-claim";
        return success({ rows });
      } });
      expect(report.trace.method).toBe("rules");
      expect(report.fallback.reason).toBe(fault === "unsupported" ? "unsupported_reason" : "incomplete_support_review");
    }
  });

  it("rejects changed final text, conditions, citations, role and candidate identity", () => {
    const context = makeContext(), plan = bindRankedCatalogSuggestions(context, { itemIds: context.candidates.map(row => row.record.recordId) });
    const frozen = freezeCatalogSupport(context, plan);
    const mutations = [
      (item: typeof plan.recommendations[number]) => { item.reasons[0].text += "新增断言"; },
      (item: typeof plan.recommendations[number]) => { item.reasons[0].conditions.push("新条件"); },
      (item: typeof plan.recommendations[number]) => { item.reasons[0].competitionFactIds = []; },
      (item: typeof plan.recommendations[number]) => { item.roleIndex = 999; },
      (item: typeof plan.recommendations[number]) => { item.itemId = "unknown"; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(plan); mutate(changed.recommendations[0]);
      expect(() => boundSupportClaims(frozen, changed)).toThrow("support_binding_mismatch");
    }
  });

  it("keeps every candidate in a larger pool within the bounded shard count", () => {
    const context = buildDecisionContext(profile, { records: Array.from({ length: 80 }, (_, index) => syntheticRecord(index + 500)), now: new Date("2026-11-05T08:00:00Z") });
    const plan = bindRankedCatalogSuggestions(context, { itemIds: context.candidates.map(row => row.record.recordId) });
    const frozen = freezeCatalogSupport(context, plan);
    expect(frozen.shards).toHaveLength(39);
    expect(frozen.entries.size).toBe(80);
    expect(frozen.shards.flatMap(shard => shard.claims)).toHaveLength(160);
    expect(new Set(frozen.shards.flatMap(shard => shard.claims.map(claim => claim.key))).size).toBe(160);
    expect(frozen.shards.every(shard => shard.claims.length <= 6)).toBe(true);
  });

  it("waits for every attempted review to settle before returning a failed match", async () => {
    const context = makeContext(), releases: (() => void)[] = [];
    let completed = false;
    const pending = runDecisionRecommendation(profile, { context, method: "llm", modelCall: async (prompt, options) => {
      if (options.diagnosticContext?.stage === "match") return { ok: false, reason: "timeout", upstreamAttempted: true, model: "contract-test" };
      await new Promise<void>(resolve => { releases.push(resolve); });
      return success({ rows: JSON.parse(prompt).assertions.map((row: { key: string }) => [row.key, 1, "合成依据"]) });
    } });
    void pending.then(() => { completed = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(releases).toHaveLength(context.candidates.length);
    expect(completed).toBe(false);
    releases.forEach(release => release());
    const report = await pending;
    expect(report.fallback.reason).toBe("timeout");
    expect(report.trace.callCount).toBe(context.candidates.length + 1);
  });
});
