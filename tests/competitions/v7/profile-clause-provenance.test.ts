import { describe, expect, it } from "vitest";
import { validateSelfReportedExtractionV7 } from "@/lib/competitions/v7/profile";
import type { DomainFact } from "@/lib/competitions/v6/domain-facts";

const fact = (field: string, value: string, sourceText: string, state: DomainFact["state"] = "affirmed"): DomainFact => ({
  field, value, sourceText, state, evidenceLevel: "self_report", confirmed: false,
});
const extract = (text: string, facts: DomainFact[]) => validateSelfReportedExtractionV7(text, { facts, unknownFields: [] }, { confirmedSelection: true });

describe("v7 self-report clause provenance", () => {
  it("keeps an existing ability current when a later clause describes a future plan", () => {
    const text = "我会Python，计划以后学习硬件。";
    const result = extract(text, [fact("skills", "programming", "我会Python"), fact("skills", "hardware", "计划以后学习硬件", "conditional")]);
    expect(result.facts.map(({ value, state, confirmed }) => ({ value, state, confirmed }))).toEqual([
      { value: "programming", state: "affirmed", confirmed: true },
      { value: "hardware", state: "conditional", confirmed: false },
    ]);
  });

  it("does not let a later interest clause invalidate an already stated ability", () => {
    const text = "我会Python，但对硬件感兴趣。";
    const result = extract(text, [fact("skills", "programming", "我会Python"), fact("interests", "hardware", "对硬件感兴趣")]);
    expect(result.facts[0]).toMatchObject({ state: "affirmed", confirmed: true, sourceText: "我会Python" });
    expect(result.facts[1]).toMatchObject({ field: "interests", value: "hardware" });
  });

  it("does not attribute an earlier first-person ability to a later reported speaker", () => {
    const text = "我会Python，但队友说他计划学习硬件。";
    const result = extract(text, [fact("skills", "programming", "我会Python")]);
    expect(result.facts[0]).toMatchObject({ state: "affirmed", confirmed: true });
  });

  it("retains a preceding condition when the quoted ability depends on it", () => {
    const result = extract("如果能借到设备，我会做硬件。", [fact("skills", "hardware", "我会做硬件")]);
    expect(result.facts[0]).toMatchObject({ state: "conditional", confirmed: false });
  });

  it("retains a condition following a partial quote in the same clause", () => {
    const result = extract("我会Python如果后续课程合格。", [fact("skills", "programming", "我会Python")]);
    expect(result.facts[0]).toMatchObject({ state: "conditional", confirmed: false });
  });

  it("still rejects a preceding reported speaker as personal ability", () => {
    expect(() => extract("队友说，我会Python。", [fact("skills", "programming", "我会Python")]))
      .toThrow("quoted_other_person_is_not_self_evidence");
  });

  it("still rejects an interest assertion being presented as a current ability", () => {
    expect(() => extract("我对Python感兴趣，计划以后学硬件。", [fact("skills", "programming", "我对Python感兴趣")]))
      .toThrow("interest_cannot_become_ability");
  });
});
