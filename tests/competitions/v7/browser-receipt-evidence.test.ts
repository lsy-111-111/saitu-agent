import { describe, expect, it } from "vitest";
// @ts-expect-error Plain Node evidence helper shared by both live browser runners.
import { hasBoundProviderDispatch } from "../../e2e/v7-browser-evidence.mjs";

const paid = () => ({ spend_run_id: "registered", model: "deepseek-flash", effort: "high", reservation_id: "actual-ledger-id", originalReceipt: { kind: "receipt", receipt: { httpStatus: 200 } } });
describe("actual browser provider-dispatch evidence", () => {
  it("retains an unpaid timeout slot without erasing the separately bound real dispatch", () => {
    expect(hasBoundProviderDispatch([paid(), { reservation_id: null, originalReceipt: { kind: "result", result: { upstreamAttempted: false, reason: "timeout" } } }], "registered")).toBe(true);
  });
  it("does not let a bound dispatch conceal another unbound actual attempt", () => {
    expect(hasBoundProviderDispatch([paid(), { reservation_id: null, originalReceipt: { kind: "result", result: { upstreamAttempted: true, reason: "timeout" } } }], "registered")).toBe(false);
  });
  it("requires an actual attempt in the registered finite scope", () => {
    expect(hasBoundProviderDispatch([], "registered")).toBe(false);
    expect(hasBoundProviderDispatch([{ originalReceipt: { kind: "result", result: { upstreamAttempted: false } } }], "registered")).toBe(false);
    expect(hasBoundProviderDispatch([paid()], "different-scope")).toBe(false);
  });
  it.each(["dispatch_intent", "unknown", "response_received"])("checks a possible paid crash-window call without inventing proof of dispatch: %s", call_state => {
    const potential = { ...paid(), call_state, originalReceipt: null };
    expect(hasBoundProviderDispatch([potential], "registered")).toBe(false);
    expect(hasBoundProviderDispatch([paid(), potential], "registered")).toBe(true);
    expect(hasBoundProviderDispatch([paid(), { ...potential, spend_run_id: "wrong-scope" }], "registered")).toBe(false);
    expect(hasBoundProviderDispatch([paid(), { ...potential, reservation_id: null }], "registered")).toBe(false);
  });
});
