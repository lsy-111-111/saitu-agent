import { expect, it } from "vitest";
import { validateSelfReportedExtractionV7 } from "../../../src/lib/competitions/v7/profile";
const raw = {facts:[{field:"skills",value:"programming",state:"affirmed",evidenceLevel:"self_report",confirmed:false,sourceText:"我会Python"}],unknownFields:[]};
it.each([
  "我会Python，如果下学期课程通过的话。",
  "我会Python，但前提是将来有人辅导。",
  "我会Python，但这只是我的计划。",
])("retains a following qualification on the same claimed ability: %s", text => {
  expect(validateSelfReportedExtractionV7(text, raw, {confirmedSelection:true}).facts[0]).toMatchObject({state:"conditional",confirmed:false});
});
it("does not cut away a following explicit attribution to another speaker", () => {
  expect(() => validateSelfReportedExtractionV7("我会Python，这是我朋友说的，不是我。",raw,{confirmedSelection:true})).toThrow();
});
