import { describe, expect, it } from "vitest";
import {
  canonicalizeCompetitionClarifyTransition,
  canonicalizeKeyedSelections
} from "@/lib/ai/competition-transition-canonicalization";

const aiConsent = { accepted: true, version: "test.v1" } as const;

describe("competition transition canonicalization", () => {
  it("sorts questionnaire fields and their set-valued selections without mutating content", () => {
    const answers = [
      { fieldId: "skills", selectedValues: ["skills:programming", "skills:hardware"], freeText: "保留原文" },
      { fieldId: "goals", selectedValues: ["goals:project"] }
    ];

    expect(canonicalizeKeyedSelections(answers, "selectedValues")).toEqual([
      { fieldId: "goals", selectedValues: ["goals:project"] },
      { fieldId: "skills", selectedValues: ["skills:hardware", "skills:programming"], freeText: "保留原文" }
    ]);
    expect(answers[0].selectedValues).toEqual(["skills:programming", "skills:hardware"]);
  });

  it("drops unsigned recent history and sorts only the answer's set values", () => {
    const conversationToken = "signed-conversation-token-00000000000000000000";

    expect(canonicalizeCompetitionClarifyTransition({
      aiConsent,
      conversationToken,
      answer: {
        selectedValues: ["product-validation", "hardware-build"],
        note: "保留原始答案"
      },
      interpretationConfirmed: true,
      recentSignalKeys: ["competition-fit", "candidate-goal-tradeoff"]
    })).toEqual({
      aiConsent,
      conversationToken,
      answer: {
        selectedValues: ["hardware-build", "product-validation"],
        note: "保留原始答案"
      },
      interpretationConfirmed: true
    });
  });

  it("preserves the signed token and action byte-for-byte while excluding recent history", () => {
    const conversationToken = "signed-conversation-token-00000000000000000000";

    expect(canonicalizeCompetitionClarifyTransition({
      aiConsent,
      conversationToken,
      action: "skip_optional",
      recentSignalKeys: ["candidate-goal-tradeoff"]
    })).toEqual({
      aiConsent,
      conversationToken,
      action: "skip_optional"
    });
  });
});
