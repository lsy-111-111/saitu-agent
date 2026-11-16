import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const ledger = vi.hoisted(() => ({ settle: vi.fn(async () => 0), reserve: vi.fn() }));
vi.mock("@/lib/ai/spend-ledger", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/ai/spend-ledger")>(),
  reserveAiSpend: ledger.reserve
}));
vi.mock("@/lib/db/pool", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/db/pool")>(),
  getPool: () => { throw new Error("receipt client fixture forbids database"); },
  isDatabaseConfigured: () => false
}));
import { requestAiJson } from "@/lib/ai/ai-client";
import { withPrivateAiPublicReceiptTap, type PrivateAiPublicReceiptV7 } from "@/lib/ai/durable-call";
import { DEFAULT_EFFORT_POLICY, effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import { resetModelCallGovernorForTests } from "@/lib/ai/model-call-governor";
import { withProductObservationTap, type ProductObservation } from "@/lib/ai/product-observation";

const original = { ...process.env };
beforeEach(() => {
  process.env = { ...original };
  delete process.env.DATABASE_URL;
  delete process.env.AI_SPEND_RUN_ID;
  Object.assign(process.env, { AI_PROVIDER: "deepseek", AI_API_KEY: "synthetic-never-sent", AI_SPEND_AUTHORIZED_EFFORT: "stage",
    SAITU_V7_EFFORT_POLICY: JSON.stringify(DEFAULT_EFFORT_POLICY), SAITU_V7_EFFORT_POLICY_SHA256: effortPolicySha256(DEFAULT_EFFORT_POLICY) });
  ledger.reserve.mockReset(); ledger.settle.mockClear();
  ledger.reserve.mockResolvedValue({ ok: true, reservation: { id: "synthetic-receipt-reservation", reservedMicros: 0, settle: ledger.settle } });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => { resetModelCallGovernorForTests(); process.env = { ...original }; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("real HTTP response parser with synthetic transport and private public receipt capture", () => {
  it.each([
    { name: "valid", content: '  {"ok":true}\n', finishReason: "stop", reason: null },
    { name: "invalid output", content: '{"wrong":"PRIVATE_RAW_INVALID"}', finishReason: "stop", reason: "invalid_output" },
    { name: "truncated", content: '{"wrong":"PRIVATE_RAW_TRUNCATED', finishReason: "length", reason: "truncated" },
    { name: "empty string", content: "", finishReason: "stop", reason: "empty_content" },
    { name: "null content", content: null, finishReason: "stop", reason: "empty_content" }
  ])("retains $name before validation without another dispatch", async sample => {
    const captured: PrivateAiPublicReceiptV7[] = [], events: ProductObservation[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: sample.content, reasoning_content: "HIDDEN_REASONING_SENTINEL" }, finish_reason: sample.finishReason }],
      usage: { prompt_tokens: 10, completion_tokens: 20, prompt_cache_hit_tokens: 2 }
    }), { headers: { "x-request-id": "synthetic-request", "x-private-secret": "SECRET_HEADER_SENTINEL" } })));
    const result = await withProductObservationTap(event => { events.push(event); }, () =>
      withPrivateAiPublicReceiptTap(value => { captured.push(value); }, () => requestAiJson("synthetic", {
        operation: "competition_v7_explain", maxAttempts: 1, schema: z.object({ ok: z.literal(true) })
      })));
    if (sample.reason === null) expect(result).toMatchObject({ ok: true, data: { ok: true } });
    else expect(result).toMatchObject({ ok: false, reason: sample.reason, upstreamAttempted: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ content: sample.content, finishReason: sample.finishReason, httpStatus: 200, attempts: 1,
      usage: { inputTokens: 10, outputTokens: 20, cachedInputTokens: 2 } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ledger.reserve).toHaveBeenCalledTimes(1);
    expect(ledger.settle).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(captured)).not.toMatch(/HIDDEN_REASONING_SENTINEL|SECRET_HEADER_SENTINEL|reasoning_content/);
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE_RAW_|HIDDEN_REASONING_SENTINEL|SECRET_HEADER_SENTINEL|privateProviderReceipt/);
    if (!result.ok) expect(result).not.toHaveProperty("content");
  });
});
