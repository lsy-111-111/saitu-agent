import { afterEach, expect, it, vi } from "vitest";
import * as ai from "@/lib/ai/ai-client";
import * as sources from "@/lib/competitions/v6/source-judgments";
import { getDecisionCatalog } from "@/lib/competitions/v6/catalog";
import { buildDecisionContext, buildRuleDecisionReport, assertCurrentReportCandidates } from "@/lib/competitions/v6/engine";
import { draftDecisionChat } from "@/lib/competitions/v6/chat";
import { draftEvidenceAction } from "@/lib/competitions/v6/evidence-actions";
import type { DecisionState } from "@/lib/competitions/v6/decision-state";
import { student } from "./decision-fixtures";

afterEach(() => vi.restoreAllMocks());
function state(): DecisionState {
  const legacy = student(); return { id: "synthetic-stale-state", sessionId: "synthetic-session", generation: 1,
    expiresAt: Date.now() + 60000, legacy, report: buildRuleDecisionReport(legacy), proposal: null, history: [] };
}
it.each(["unpublished", "old-version"])("rejects a %s saved report before a chat or source model call", async variant => {
  const saved = state();
  if (variant === "old-version") saved.report.catalogVersion = "v6-old-content-digest";
  else {
    const hidden = getDecisionCatalog().find(r => r.seriesId === "asme-sme-manufacturing-design")!;
    saved.report.recommendations[0].itemId = hidden.recordId;
  }
  const id = saved.report.recommendations[0].itemId;
  const invoke = vi.spyOn(ai, "requestAiJson").mockRejectedValue(new Error("unexpected model call"));
  const judge = vi.spyOn(sources, "judgeSourceClaims").mockRejectedValue(new Error("unexpected source call"));
  const qualify = vi.spyOn(sources, "qualifySourceCondition").mockRejectedValue(new Error("unexpected qualification call"));
  await expect(draftDecisionChat(saved, "核实这个任务的要求", [id])).rejects.toThrow("DECISION_CATALOG_CHANGED");
  await expect(draftDecisionChat(saved, "比较任务和投入", [id])).rejects.toThrow("DECISION_CATALOG_CHANGED");
  await expect(draftEvidenceAction(saved, { type: "qualify_condition", itemId: id, target: { kind: "student_eligibility", field: "eligibility.age" }, question: "我可以参加吗" })).rejects.toThrow("DECISION_CATALOG_CHANGED");
  expect(invoke).not.toHaveBeenCalled(); expect(judge).not.toHaveBeenCalled(); expect(qualify).not.toHaveBeenCalled();
});
it("rejects no-longer-eligible recommendations and keeps valid current reports usable", () => {
  const saved = state(), context = buildDecisionContext(saved.legacy, { profile: saved.report.profile });
  expect(() => assertCurrentReportCandidates(context, saved.report)).not.toThrow();
  const removed = saved.report.recommendations[0].itemId;
  context.candidates = context.candidates.filter(c => c.record.recordId !== removed);
  context.excluded.set(removed, "Confirmed qualification conflict");
  expect(() => assertCurrentReportCandidates(context, saved.report)).toThrow("DECISION_CATALOG_CHANGED");
});
