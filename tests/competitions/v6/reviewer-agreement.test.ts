import { describe, expect, it } from "vitest";
import { ordinalAgreement } from "../../../scripts/competitions/v6/reviewer-agreement";
describe("agreement before adjudication", () => {
  it("retains unknowns in the inventory and excludes them from coincidence marginals", () => {
    const scores = ordinalAgreement([[0,0],[1,1],[2,2],[3,3],["U",0]]);
    expect(scores).toMatchObject({value:1, paired:4, candidates:5, withUnknown:1, counts:[2,2,2,2]});
  });
  it("computes a negative coefficient without clamping", () => {
    expect(ordinalAgreement([[0,3],[3,0]]).value).toBe(-0.5);
  });
  it("a constant scale or entirely unknown sample has undefined alpha", () => {
    expect(ordinalAgreement([[2,2],[2,2]]).value).toBeNull();
    expect(ordinalAgreement([["U","U"]]).value).toBeNull();
  });
});
