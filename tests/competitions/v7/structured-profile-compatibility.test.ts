import { describe, expect, it } from "vitest";
import { materializeStructuredProfileV7, ensureStructuredProfileProvenanceV7, applyProfileMutationsV7 } from "@/lib/competitions/v7/profile";
import { draftDecisionChatV7 } from "@/lib/competitions/v7/chat";
import { buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import type { StudentProfileV6 } from "@/lib/competitions/v6/contracts";

function legacy(): StudentProfileV6 {
  return { schemaVersion: "saitu.profile.v6", profileId: "legacy-canonical", revision: "legacy-revision", mode: "deep",
    primaryGoal: null, goals: [], tradeoffStatus: "undecided", unknownFields: ["equipment"], retractedFactIds: ["old"],
    facts: [
      { id: "stage", field: "stage", value: "undergraduate-lower", label: "本科低年级", state: "affirmed", confirmed: true, evidenceLevel: "self_report" },
      { id: "skill", field: "skills", value: "programming", label: "展示标签不得被扩写为精通", state: "negated", confirmed: true, evidenceLevel: "self_report" },
      { id: "equipment", field: "equipment", value: "unknown", label: "设备未确定", state: "unknown", confirmed: false, evidenceLevel: "unknown" },
      { id: "future", field: "skills", value: "design", label: "如果以后学设计", state: "conditional", confirmed: false, evidenceLevel: "self_report" },
      { id: "old", field: "weeklyHours", value: 8, label: "已撤回8小时", state: "retracted", confirmed: false, evidenceLevel: "self_report" },
    ] };
}
const submission = { kind: "explicit_canonical_submission" as const, inputSha256: "a".repeat(64), profilePointer: "/profile" };

describe("v7 legacy structured input provenance", () => {
  it("keeps the original input and all factual states unchanged while binding submitted values", () => {
    const input = legacy(), original = structuredClone(input);
    const { profile, provenance } = materializeStructuredProfileV7(input, submission);
    expect(input).toEqual(original);
    expect(profile.revision).not.toBe(input.revision);
    expect(profile.facts.map(({ id, field, value, state, evidenceLevel, confirmed }) => ({ id, field, value, state, evidenceLevel, confirmed })))
      .toEqual(input.facts.map(({ id, field, value, state, evidenceLevel, confirmed }) => ({ id, field, value, state, evidenceLevel, confirmed })));
    expect(profile.retractedFactIds).toEqual(["old"]); expect(profile.unknownFields).toEqual(["equipment"]);
    expect(profile.facts[1].originalText).toBe("programming"); expect(profile.facts[4].originalText).toBe("8");
    expect(provenance).toMatchObject({ origin: "explicitly_submitted_structured_values", historicalUtteranceInvented: false });
    expect(provenance.sources).toHaveLength(5); expect(provenance.sources[1].pointer).toBe("/profile/facts/1/value");
    expect(provenance.beforeProfileSha256).not.toBe(provenance.afterProfileSha256);
  });

  it("preserves genuine existing wording and is deterministic and idempotent", () => {
    const input = legacy(); input.facts[1] = { ...input.facts[1], originalText: "我不会编程", answerId: "actual-answer", sourceSpan: { start: 0, end: 5 } };
    const once = ensureStructuredProfileProvenanceV7(input, submission);
    expect(ensureStructuredProfileProvenanceV7(input, submission)).toEqual(once);
    expect(ensureStructuredProfileProvenanceV7(once, submission)).toEqual(once);
    expect(once.facts[1]).toEqual(input.facts[1]);
    expect(materializeStructuredProfileV7(once, submission).provenance.sources).toHaveLength(0);
  });

  it("rejects a broken existing utterance binding instead of silently repairing its evidence", () => {
    const input = legacy(); input.facts[1].answerId = "missing-original-utterance";
    expect(() => ensureStructuredProfileProvenanceV7(input, submission)).toThrow("incomplete_existing_profile_source");
  });

  it("does not truncate or substitute an unrepresentable submitted scalar", () => {
    for (const value of ["", "x".repeat(1601)]) {
      const input = legacy(); input.facts[1].value = value;
      expect(() => ensureStructuredProfileProvenanceV7(input, submission)).toThrow("structured_profile_value_source_unrepresentable");
    }
  });

  it("requires explicit submission provenance and binds a new source document into the revision", () => {
    expect(() => materializeStructuredProfileV7(legacy(), { ...submission, inputSha256: "" })).toThrow("explicit_structured_submission_binding_required");
    expect(ensureStructuredProfileProvenanceV7(legacy(), submission).revision)
      .not.toBe(ensureStructuredProfileProvenanceV7(legacy(), { ...submission, inputSha256: "b".repeat(64) }).revision);
  });

  it("allows an empty canonical profile without inventing a stage, legacy view or population exclusion", () => {
    const input = { ...legacy(), facts: [], retractedFactIds: [], unknownFields: ["stage"] };
    const profile = ensureStructuredProfileProvenanceV7(input, submission);
    const context = buildDecisionContextV7(undefined, { profile });
    expect(context.originalProfile).toBeUndefined(); expect(context.profile.facts).toEqual([]);
    expect(context.excluded.size).toBe(0); expect(context.candidates).toHaveLength(context.records.length);
  });

  it("adopts and retracts a clear goal through actual chat and mutation paths without a legacy stage", async () => {
    const profile = { ...legacy(), facts: [], retractedFactIds: [], unknownFields: ["stage"] };
    const reply = await draftDecisionChatV7({ profile }, "目标改为练习能力。", [], { requestId: "canonical-goal", at: "2026-11-09T00:00:00.000Z", modelCall: async () => { throw new Error("must_not_dispatch"); } });
    expect(reply.profile?.primaryGoal).toBe("练习具体能力");
    expect(reply.profile?.facts.some(fact => fact.field === "stage")).toBe(false);
    const next = reply.profile!, target = next.facts.find(fact => fact.field === "goalIntent")!;
    const withdrawn = applyProfileMutationsV7(next, [{ operation: "retract", field: "goalIntent", targetFactIds: [target.id], quote: "撤回目标" }],
      { answerId: "retract-canonical-goal", text: "撤回目标", at: "2026-11-09T00:00:01.000Z" }, undefined);
    expect(withdrawn.primaryGoal).toBeNull(); expect(withdrawn.goals).toEqual([]);
  });
});
