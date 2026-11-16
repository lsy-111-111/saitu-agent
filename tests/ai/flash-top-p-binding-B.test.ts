import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { RequestAiJsonOptions } from "@/lib/ai/ai-client";

const boundary = vi.hoisted(() => ({
  requests: [] as Record<string, unknown>[], receipts: [] as Record<string, unknown>[],
  events: [] as { type: string; details: Record<string, unknown> }[],
  settle: vi.fn(async (..._args: unknown[]) => 0), release: vi.fn(),
}));
vi.mock("@/lib/ai/durable-call", () => ({
  currentDurableRequestVersionV7: () => undefined, hasDurableAiRun: () => false,
  markDurableDispatch: vi.fn(async () => undefined),
  recordDurableReceipt: async (receipt: Record<string, unknown>) => { boundary.receipts.push(receipt); },
  runDurableAiAttempt: async (input: Record<string, unknown>, work: () => Promise<unknown>) => {
    boundary.requests.push(input); return work();
  },
}));
vi.mock("@/lib/ai/model-call-governor", () => ({
  acquireModelCallPermit: vi.fn(async () => ({ ok: true, permit: { release: boundary.release } })),
  recordModelCallCapacityFeedbackV7: vi.fn(),
}));
vi.mock("@/lib/ai/spend-ledger", () => ({
  configuredDevelopmentEffort: () => "high",
  reserveAiSpend: vi.fn(async () => ({ ok: true, reservation: { id: "synthetic-reservation-never-provider", reservedMicros: 100, settle: boundary.settle } })),
}));
vi.mock("@/lib/ai/product-observation", () => ({
  emitProductObservation: (type: string, details: Record<string, unknown>) => { boundary.events.push({ type, details }); },
}));

import { requestAiJson } from "@/lib/ai/ai-client";
import { reserveAiSpend } from "@/lib/ai/spend-ledger";
import { acquireModelCallPermit } from "@/lib/ai/model-call-governor";
import { decisionRequestSha256 } from "@/lib/ai/effort-policy.mjs";

const originalEnvironment = { ...process.env };
const input = { prompt: "Synthetic prompt", system: "Synthetic system JSON", model: "deepseek-flash", maxTokens: 32,
  promptVersion: "source09.synthetic", thinking: "enabled" as const, reasoningEffort: "low" as const,
  effortPolicySha256: "04962f576d20346af8a8f076ce64fdbda5aea13fdbd2fae39f3c7456fe30aa48" };
const options = (operation = "competition_v7_rank"): RequestAiJsonOptions<unknown> => ({
  operation, model: input.model, systemPrompt: input.system, maxTokens: input.maxTokens,
  promptVersion: input.promptVersion, thinking: "enabled", maxAttempts: 1,
});
const oldBody = '{"model":"deepseek-flash","messages":[{"role":"system","content":"Synthetic system JSON"},{"role":"user","content":"Synthetic prompt"}],"thinking":{"type":"enabled"},"reasoning_effort":"low","max_tokens":32,"response_format":{"type":"json_object"}}';
const successful = () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 0 } }));

beforeEach(() => {
  process.env = { ...originalEnvironment, AI_PROVIDER: "deepseek", AI_MODEL: "deepseek-flash", AI_API_URL: "https://api.deepseek.com/chat/completions", AI_API_KEY: "synthetic-never-sent", SAITU_AI_EXECUTION_MODE: "user-unbounded", AI_SPEND_AUTHORIZED_EFFORT: "stage",
    SAITU_V7_EFFORT_POLICY: JSON.stringify({ version: "saitu.effort-policy.v1", rank: "low", explain: "low", review: "low" }) };
  delete process.env.SAITU_V7_EFFORT_POLICY_SHA256;
  boundary.requests.length = 0; boundary.receipts.length = 0; boundary.events.length = 0;
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", vi.fn(async () => successful()));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); process.env = { ...originalEnvironment }; });

describe("DeepSeek flash optional sampling identity and actual transport boundary", () => {
  it("preserves both pre-change digest golden vectors when topP is absent or undefined", () => {
    // Golden vectors obtained from the exact saved pre-change effort-policy module.
    expect(decisionRequestSha256(input)).toBe("d3da967da5c8121a208cbe39c1d58d9a14f5a44f9dcfc4fee1cad42811ed7c3f");
    expect(decisionRequestSha256({ ...input, topP: undefined })).toBe(decisionRequestSha256(input));
    const versioned = { ...input, recommendationPolicyVersion: "saitu.policy.2026-11-09.v7.top5", implementationVersion: "saitu.async.2026-11-09.v7.3.top5" };
    expect(decisionRequestSha256(versioned)).toBe("e35ed6ae3a290e58326f404297f4e5a6f7e3134fd2341634058227de5f9b6549");
    expect(decisionRequestSha256({ ...versioned, topP: 0.95 })).not.toBe(decisionRequestSha256(versioned));
    expect(decisionRequestSha256({ ...input, topP: 0.95 })).not.toBe(decisionRequestSha256({ ...input, topP: 1 }));
  });

  it.each([false, true])("sends rank top_p with an exact durable identity, receipt and single settled reservation (versioned=%s)", async versioned => {
    const version = versioned ? { recommendationPolicyVersion: "saitu.policy.2026-11-09.v7.top5", implementationVersion: "saitu.async.2026-11-09.v7.3.top5" } : {};
    expect(await requestAiJson(input.prompt, { ...options(), ...version, topP: 0.95 })).toMatchObject({ ok: true, upstreamAttempted: true });
    const init = vi.mocked(fetch).mock.calls[0][1]!;
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
    expect(JSON.parse(String(init.body))).toEqual({ ...JSON.parse(oldBody), top_p: 0.95 });
    expect(boundary.requests[0].requestSha256).toBe(decisionRequestSha256({ ...input, ...version, topP: 0.95 }));
    expect(createHash("sha256").update(String(boundary.requests[0].prompt)).digest("hex")).toBe(boundary.requests[0].requestSha256);
    expect(JSON.parse(String(boundary.requests[0].prompt))).toMatchObject({ topP: 0.95 });
    expect(boundary.receipts[0]).toMatchObject({ topP: 0.95, thinking: "enabled", reasoningEffort: "low" });
    expect(boundary.events.find(event => event.type === "ai_transport_dispatch")?.details.topP).toBe(0.95);
    expect(boundary.events.find(event => event.type === "ai_attempt_result")?.details.topP).toBe(0.95);
    expect(fetch).toHaveBeenCalledTimes(1); expect(reserveAiSpend).toHaveBeenCalledTimes(1);
    expect(boundary.settle).toHaveBeenCalledExactlyOnceWith({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }, true);
    expect(boundary.release).toHaveBeenCalledTimes(1);
  });

  it.each(["competition_v7_rank", "competition_v7_explain", "competition_v7_review", "competition_v7_extract", "competition_v7_chat", "competition_v7_chat_review", "competition_normalize"])("keeps undefined %s wire bytes and receipt options unchanged", async operation => {
    expect((await requestAiJson(input.prompt, { ...options(operation), topP: undefined })).ok).toBe(true);
    const high = ["competition_v7_extract", "competition_v7_chat", "competition_v7_chat_review", "competition_normalize"].includes(operation);
    expect(vi.mocked(fetch).mock.calls[0][1]?.body).toBe(high ? oldBody.replace('"reasoning_effort":"low"', '"reasoning_effort":"high"') : oldBody);
    expect(boundary.receipts[0]).not.toHaveProperty("topP");
    expect(JSON.parse(String(boundary.requests[0].prompt))).not.toHaveProperty("topP");
    expect(boundary.events.find(event => event.type === "ai_transport_dispatch")?.details).not.toHaveProperty("topP");
    expect(boundary.requests[0].requestSha256).toBe(decisionRequestSha256({ ...input, reasoningEffort: high ? "high" : "low" }));
  });

  it("rejects invalid flash thinking sampling before permit, reserve, durable intent or HTTP", async () => {
    for (const topP of [0.94, 1.01, NaN, Infinity, null]) {
      expect(await requestAiJson(input.prompt, { ...options(), topP: topP as number })).toMatchObject({ ok: false, reason: "invalid_request", upstreamAttempted: false });
      expect(() => decisionRequestSha256({ ...input, topP: topP as number })).toThrow("invalid_decision_request_sampling_binding");
    }
    expect(acquireModelCallPermit).not.toHaveBeenCalled(); expect(reserveAiSpend).not.toHaveBeenCalled();
    expect(boundary.requests).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
  });

  it("retains a single unknown attempt and conservative settlement with the actual sampling dispatch metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("synthetic_disconnect_no_provider"); }));
    expect(await requestAiJson(input.prompt, { ...options(), topP: 0.95, maxAttempts: 3 })).toMatchObject({ ok: false, reason: "network_error", upstreamAttempted: true, attempts: 1 });
    expect(fetch).toHaveBeenCalledTimes(1); expect(reserveAiSpend).toHaveBeenCalledTimes(1);
    expect(boundary.settle).toHaveBeenCalledExactlyOnceWith(undefined, true);
    expect(boundary.events.find(event => event.type === "ai_transport_dispatch")?.details.topP).toBe(0.95);
    expect(boundary.receipts).toHaveLength(0);
  });
});
