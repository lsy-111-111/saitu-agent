import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DurableReceipt, PrivateAiPublicReceiptV7 } from "@/lib/ai/durable-call";

const db = vi.hoisted(() => ({ getPool: vi.fn(() => { throw new Error("unexpected database access"); }) }));
vi.mock("@/lib/db/pool", () => db);
import { recordDurableReceipt, withPrivateAiPublicReceiptTap } from "@/lib/ai/durable-call";

function receipt(overrides: Partial<DurableReceipt> = {}): DurableReceipt {
  return { model: "deepseek-flash", httpStatus: 200, requestId: "request-test", finishReason: "stop",
    content: '{"recommendations":[]}', usage: { inputTokens: 10, outputTokens: 20, cachedInputTokens: 2 },
    durationMs: 123, attempts: 1, operation: "competition_v7_explain", thinking: "enabled",
    reasoningEffort: "low", effortPolicySha256: "a".repeat(64), ...overrides };
}

describe("server-owned public answer receipt capture", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("copies only the public answer and explicit metadata, without touching the database", async () => {
    const source = Object.assign(receipt(), {
      reasoning_content: "hidden reasoning sentinel", headers: { authorization: "secret sentinel" },
      apiKey: "secret sentinel", futureProviderField: { value: "secret sentinel" }
    });
    Object.assign(source.usage!, { reasoning_tokens: "hidden reasoning sentinel" });
    const captured: PrivateAiPublicReceiptV7[] = [];
    await withPrivateAiPublicReceiptTap(value => { captured.push(value); }, () => recordDurableReceipt(source));
    expect(captured).toEqual([receipt()]);
    expect(JSON.stringify(captured)).not.toMatch(/hidden reasoning sentinel|secret sentinel|reasoning_content|reasoning_tokens/);
    expect(db.getPool).not.toHaveBeenCalled();
  });

  it("clones the receipt so the diagnostic consumer cannot alter the real response", async () => {
    const source = receipt();
    await withPrivateAiPublicReceiptTap(value => {
      value.content = "mutated";
      value.usage!.inputTokens = 999;
    }, () => recordDurableReceipt(source));
    expect(source).toEqual(receipt());
    expect(db.getPool).not.toHaveBeenCalled();
  });

  it.each([null, undefined, { reasoning_content: "hidden" }, ["not a public string"]])(
    "preserves non-string content as null (%j)", async content => {
      const captured: PrivateAiPublicReceiptV7[] = [];
      await withPrivateAiPublicReceiptTap(value => { captured.push(value); }, () => recordDurableReceipt(receipt({ content })));
      expect(captured).toHaveLength(1);
      expect(captured[0].content).toBeNull();
    }
  );

  it("retains the exact empty or truncated public string without parsing or rewriting it", async () => {
    const captured: PrivateAiPublicReceiptV7[] = [];
    await withPrivateAiPublicReceiptTap(value => { captured.push(value); }, async () => {
      await recordDurableReceipt(receipt({ content: "" }));
      await recordDurableReceipt(receipt({ content: '{"reason":"原文未结束', finishReason: "length" }));
    });
    expect(captured.map(value => [value.content, value.finishReason])).toEqual([
      ["", "stop"], ['{"reason":"原文未结束', "length"]
    ]);
  });

  it("does not carry a runtime object through an optional primitive metadata key", async () => {
    const source = receipt();
    Object.assign(source, { requestId: { secret: "hidden" }, temperature: Number.NaN });
    const captured: PrivateAiPublicReceiptV7[] = [];
    await withPrivateAiPublicReceiptTap(value => { captured.push(value); }, () => recordDurableReceipt(source));
    expect(captured[0]).not.toHaveProperty("requestId");
    expect(captured[0]).not.toHaveProperty("temperature");
    expect(JSON.stringify(captured)).not.toContain("hidden");
  });

  it("keeps disabled thinking metadata explicit without inventing wire reasoning effort", async () => {
    const source = receipt({ operation: "competition_v7_rank", thinking: "disabled", reasoningEffort: undefined,
      policyReasoningEffort: "low", wireReasoningEffort: null, temperature: 0, topP: 1 });
    const captured: PrivateAiPublicReceiptV7[] = [];
    await withPrivateAiPublicReceiptTap(value => { captured.push(value); }, () => recordDurableReceipt(source));
    expect(captured[0]).toMatchObject({ thinking: "disabled", policyReasoningEffort: "low", wireReasoningEffort: null, temperature: 0, topP: 1 });
    expect(captured[0]).not.toHaveProperty("reasoningEffort");
  });

  it("isolates concurrent captures and restores outer captures after nesting", async () => {
    const a: string[] = [], b: string[] = [], inner: string[] = [];
    let releaseA!: () => void;
    const barrier = new Promise<void>(resolve => { releaseA = resolve; });
    await Promise.all([
      withPrivateAiPublicReceiptTap(value => { a.push(value.content!); }, async () => {
        await barrier;
        await recordDurableReceipt(receipt({ content: "a-before" }));
        await withPrivateAiPublicReceiptTap(value => { inner.push(value.content!); }, () => recordDurableReceipt(receipt({ content: "inner" })));
        await recordDurableReceipt(receipt({ content: "a-after" }));
      }),
      withPrivateAiPublicReceiptTap(value => { b.push(value.content!); }, async () => {
        await recordDurableReceipt(receipt({ content: "b" }));
        releaseA();
      })
    ]);
    await recordDurableReceipt(receipt({ content: "outside" }));
    expect(a).toEqual(["a-before", "a-after"]);
    expect(b).toEqual(["b"]);
    expect(inner).toEqual(["inner"]);
    expect(db.getPool).not.toHaveBeenCalled();
  });

  it("does not let synchronous or asynchronous capture failures change completion", async () => {
    await expect(withPrivateAiPublicReceiptTap(() => { throw new Error("capture failed"); },
      () => recordDurableReceipt(receipt()))).resolves.toBeUndefined();
    await expect(withPrivateAiPublicReceiptTap(async () => { throw new Error("capture failed async"); },
      () => recordDurableReceipt(receipt()))).resolves.toBeUndefined();
    await Promise.resolve();
    expect(db.getPool).not.toHaveBeenCalled();
  });

  it("is a no-op without an evaluation tap", async () => {
    await expect(recordDurableReceipt(receipt())).resolves.toBeUndefined();
    expect(db.getPool).not.toHaveBeenCalled();
  });
});
