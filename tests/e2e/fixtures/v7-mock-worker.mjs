import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { installSourceLoader } from "../../../scripts/lib/load-typescript-source.mjs";

installSourceLoader(process.cwd());
if (process.env.AI_PROVIDER !== "mock" || process.env.AI_API_KEY || !process.env.SAITU_V7_SOURCE_SHA256) throw new Error("mock_browser_worker_only");
const { RECOMMENDATION_MAX_ITEMS } = await import("../../../src/lib/competitions/v7/contracts.ts");
const { claimRunV7 } = await import("../../../src/lib/competitions/v7/store.ts");
const { processClaimedRunV7 } = await import("../../../src/lib/competitions/v7/worker.ts");
const { rankDecisionV7, explainDecisionV7 } = await import("../../../src/lib/competitions/v7/model.ts");
const { isDecisionEvidenceFact } = await import("../../../src/lib/competitions/v6/evidence.ts");
const { getPool } = await import("../../../src/lib/db/pool.ts");
const stop = new AbortController();
process.on("SIGTERM", () => stop.abort()); process.on("SIGINT", () => stop.abort());
const success = data => ({ ok: true, data, model: "mock-browser-provider", upstreamAttempted: false, attempts: 0, httpStatus: 200, durationMs: 1, finishReason: "stop" });
async function control() { return JSON.parse(await readFile(process.env.V7_BROWSER_CONTROL_FILE, "utf8")); }
function selected(context) {
  const seen = new Set();
  return context.candidates.filter(candidate => { if (seen.has(candidate.record.seriesId)) return false; seen.add(candidate.record.seriesId); return true; }).slice(0, RECOMMENDATION_MAX_ITEMS);
}
const models = {
  async rank(context, options) {
    await delay(800, undefined, { signal: options.signal });
    const choices = selected(context);
    console.info(JSON.stringify({ event: "v7_mock_rank", runId: options.requestId, candidates: context.candidates.length, selected: choices.length, paidCalls: 0 }));
    return rankDecisionV7(context, { ...options, modelCall: async () => success({ profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
      recommendations: choices.map(candidate => ({ itemId: candidate.record.recordId, rationale: "确定性浏览器模拟样本，仅验证流程。", studentFactIds: [], competitionFactIds: [] })),
      shortfallReason: choices.length < RECOMMENDATION_MAX_ITEMS ? "本隔离流程样本不补齐数量。" : null }) });
  },
  async explain(context, plan, options) {
    while (!options.signal.aborted) {
      const settings = await control();
      if (!settings.holdDetails || settings.releaseDetailsFor.includes(options.requestId)) {
        if (settings.failDetailsFor.includes(options.requestId)) throw new Error("MOCK_BROWSER_DETAIL_FAILURE");
        break;
      }
      await delay(100, undefined, { signal: options.signal });
    }
    const explained = { ...plan, recommendations: plan.recommendations.map(chosen => {
      const record = context.candidates.find(candidate => candidate.record.recordId === chosen.itemId).record;
      const fact = record.facts.find(fact => ["task", "track", "deliverables"].includes(fact.field) && isDecisionEvidenceFact(record, fact));
      if (!fact) throw new Error("MOCK_BROWSER_EVIDENCE_MISSING");
      return { itemId: chosen.itemId, reasons: [{ text: fact.text, basis: "official", studentFactIds: [], competitionFactIds: [fact.id], conditions: [] }] };
    }) };
    console.info(JSON.stringify({ event: "v7_mock_explain", runId: options.requestId, paidCalls: 0 }));
    return explainDecisionV7(context, plan, { ...options, modelCall: async () => success(explained) });
  },
};
async function loop(index) {
  while (!stop.signal.aborted) {
    try {
      const claim = await claimRunV7(`browser-mock-${randomUUID()}-${index}`);
      if (claim) { await processClaimedRunV7(claim, models, stop.signal); continue; }
    } catch (error) { if (!stop.signal.aborted) console.error(JSON.stringify({ event: "v7_browser_worker_error", code: error instanceof Error ? error.message : "unknown" })); }
    await delay(100, undefined, { signal: stop.signal }).catch(() => undefined);
  }
}
await Promise.all([loop(0), loop(1)]);
await getPool().end();
