import { afterEach, describe, expect, it, vi } from "vitest";
import { requestAiJson, getAiConfigurationFingerprint, getConfiguredReasoningEffort } from "../../src/lib/ai/ai-client";
import { estimateSpendMicros, requestReserveMicros, reserveAiSpend } from "../../src/lib/ai/spend-ledger";

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Flash maximum-effort policy", () => {
  it("rejects an obsolete disabled override and keeps ordinary Flash max requests unchanged", async () => {
    process.env.AI_PROVIDER = "deepseek"; process.env.AI_API_KEY = "test-key";
    delete process.env.AI_MODEL; delete process.env.AI_SPEND_RUN_ID;
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] })));
    vi.stubGlobal("fetch", fetch);
    const result = await requestAiJson("Return json", { thinking: "disabled" });
    expect(result).toMatchObject({ok:false,upstreamAttempted:false,reason:"spend_configuration_invalid"});
    expect(fetch).not.toHaveBeenCalled();
    expect((await requestAiJson("Return json")).ok).toBe(true);
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ model: "deepseek-flash", thinking: { type: "enabled" }, reasoning_effort: "max", max_tokens: 8192 });
    expect(body).not.toHaveProperty("temperature");
  });
  it("environment edits cannot silently downgrade the promoted configuration", () => {
    process.env.AI_REASONING_EFFORT = "low";
    expect(getConfiguredReasoningEffort()).toBe("max");
    expect(getAiConfigurationFingerprint()).toContain("thinking-enabled:max");
  });
  it("only explicit experiments can request another effort", async () => {
    process.env.AI_PROVIDER = "deepseek"; process.env.AI_API_KEY = "test-key";
    delete process.env.AI_MODEL; delete process.env.AI_SPEND_RUN_ID;
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{}' } }] })));
    vi.stubGlobal("fetch", fetch);
    await requestAiJson("json", { reasoningEffort: "low" });
    await requestAiJson("json", { reasoningEffort: "high", evaluationRun: true });
    const bodies = fetch.mock.calls.map(call => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
    expect(bodies.map(body => body.reasoning_effort)).toEqual(["max", "high"]);
  });
});

describe("Yuan budget accounting", () => {
  it("counts cached inputs and reasoning-inclusive completion usage separately", () => {
    expect(estimateSpendMicros({ inputTokens: 1000000, cachedInputTokens: 0, outputTokens: 1000000 })).toBe(10000000);
    expect(estimateSpendMicros({ inputTokens: 1000000, cachedInputTokens: 1000000, outputTokens: 0 })).toBe(40000);
    expect(estimateSpendMicros({ inputTokens: 26, cachedInputTokens: 26, outputTokens: 0 })).toBe(2);
    expect(estimateSpendMicros({ inputTokens: Number.MAX_SAFE_INTEGER, cachedInputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0 })).toBe(360287970189640);
    expect(() => estimateSpendMicros({ inputTokens: Number.MAX_SAFE_INTEGER, cachedInputTokens: 0, outputTokens: 0 })).toThrow(/safe integer/);
    expect(() => estimateSpendMicros({ inputTokens: 1, cachedInputTokens: 2, outputTokens: 0 })).toThrow();
    expect(requestReserveMicros("系统", "文字", 8192)).toBeGreaterThan(8192 * 8);
  });
  it("fails closed before network access without a valid funded allowance", async () => {
    process.env.AI_SPEND_RUN_ID = "budget-test";
    process.env.AI_SPEND_LIMIT_CNY = "300";
    process.env.AI_SPEND_FUNDED_CNY = "0";
    const result = await reserveAiSpend({ system: "", prompt: "", maxTokens: 8192, model: "deepseek-flash", effort: "max" });
    expect(result).toEqual({ ok: false, reason: "spend_configuration_invalid" });
  });
});
