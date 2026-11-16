import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmCompetitionQuestionnaire, enhanceCompetitionQuestionnaireWithAi, normalizeCompetitionQuestionnaire } from "@/lib/ai/competition-questionnaire";
import { createStudentProfile } from "@/lib/competitions/v6/profile";
import { activeStudentFacts, projectProfileToLegacy } from "@/lib/competitions/v6/profile";
import { createStudentProfileV7, applyProfileMutationsV7 } from "@/lib/competitions/v7/profile";
import { getMatchingCatalogRecords } from "@/lib/competitions/v7/catalog";
import { buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import type { CompetitionQuestionnaireV1 } from "@/types/competition-recommendation";

const cases = ["C09-novice-fewer", "C-supplemental-pure-math-proof"];
function actualQuestionnaire(caseId: string) {
  const receipt = JSON.parse(readFileSync(`artifacts/fast24-20261109/C/live-01/${caseId}/receipts.json`, "utf8"));
  const http = receipt.httpOriginals.find((row: { path: string }) => row.path === "/api/competitions/recommend/normalize");
  const request = typeof http.requestBody === "string" ? JSON.parse(http.requestBody) : http.requestBody;
  return request.questionnaire as CompetitionQuestionnaireV1;
}
function prepare(caseId: string) {
  const input = actualQuestionnaire(caseId), normalized = normalizeCompetitionQuestionnaire(input, { policy: "v7" });
  if (!normalized.ok) throw new Error("Actual questionnaire was rejected");
  const confirmed = confirmCompetitionQuestionnaire(normalized.interpretations, [], input.decisionContext);
  if (!confirmed.ok) throw new Error("Raw task cannot pass the current entry");
  const options = { answerContext: normalized.questionnaire.answers, answeredAt: "2026-11-10T01:00:00.000Z" };
  return { input, normalized, legacy: confirmed.profile, profile: createStudentProfileV7(confirmed.profile, options), options };
}
afterEach(() => vi.unstubAllGlobals());

describe("C exact live01 raw task entry without a fabricated whitelist choice", () => {
  it.each(cases)("adopts %s original task text without another confirmation or provider call", async caseId => {
    const fetch = vi.fn(() => { throw new Error("Offline test forbids HTTP"); }); vi.stubGlobal("fetch", fetch);
    const { input, normalized, legacy, profile } = prepare(caseId);
    const original = input.answers.find(answer => answer.fieldId === "taskFormats")!.freeText!;
    expect(normalized.interpretations.find(item => item.fieldId === "taskFormats")).toMatchObject({ source: "unresolved", requiresConfirmation: false, explicitValues: [], suggestedValues: [] });
    const enhanced = await enhanceCompetitionQuestionnaireWithAi(normalized.questionnaire, normalized.interpretations, { policy: "v7" });
    expect(enhanced.upstreamAttempted).toBe(false); expect(fetch).not.toHaveBeenCalled();
    expect(legacy.taskFormats).toEqual([]);
    expect(profile.facts.find(fact => fact.field === "taskFormats.raw")).toMatchObject({ value: original, originalText: original, answerId: "questionnaire.taskFormats", sourceSpan: { start: 0, end: original.length }, state: "affirmed", confirmed: true, evidenceLevel: "self_report" });
    expect(profile.unknownFields).not.toContain("taskFormats");
    expect(profile.unknownFields).not.toContain("taskFormats.raw");
    expect(projectProfileToLegacy(profile, legacy).taskFormats).toEqual([]);
    expect(profile.facts.filter(fact => fact.field === "skills")).toEqual(createStudentProfile(legacy, { answerContext: normalized.questionnaire.answers, answeredAt: "2026-11-10T01:00:00.000Z" }).facts.filter(fact => fact.field === "skills"));
  });

  it("keeps original negatives/exclusions and supports withdrawing the raw preference without enum pollution", () => {
    const { legacy, profile } = prepare(cases[1]), fact = profile.facts.find(item => item.field === "taskFormats.raw")!;
    expect(String(fact.value)).toContain("不做算法编程、数据建模、软件、硬件、实验");
    const excluded = profile.facts.filter(item => item.field === "excludedTask"); expect(excluded).toHaveLength(10);
    const text = "撤回此前的任务偏好原话。";
    const changed = applyProfileMutationsV7(profile, [{ operation: "retract", field: "taskFormats.raw", targetFactIds: [fact.id], quote: text }], { answerId: "C-offline-withdraw", text, at: "2026-11-10T01:01:00.000Z" }, legacy);
    expect(activeStudentFacts(changed).some(item => item.id === fact.id)).toBe(false);
    expect(changed.retractedFactIds).toContain(fact.id);
    expect(changed.facts.filter(item => item.field === "excludedTask")).toEqual(excluded);
    expect(projectProfileToLegacy(changed, legacy).taskFormats).toEqual([]);
  });

  it("retains the whole actual45 pool and existing candidate logic without forcing three recommendations", () => {
    const { legacy, profile, options } = prepare(cases[1]), records = getMatchingCatalogRecords();
    const withRaw = buildDecisionContextV7(legacy, { records, profile });
    const withoutRaw = buildDecisionContextV7(legacy, { records, profile: createStudentProfileV7(legacy, { ...options, answerContext: options.answerContext.filter(answer => answer.fieldId !== "taskFormats") }) });
    expect(withRaw.records).toEqual(records); expect(withRaw.records).toHaveLength(45);
    expect(withRaw.candidates.map(item => item.record.recordId)).toEqual(withoutRaw.candidates.map(item => item.record.recordId));
    for (const id of ["international-mathematics-competition", "national-college-mathematics", "yau-college-mathematics"]) expect(withRaw.candidates.some(item => item.record.seriesId === id)).toBe(true);
  });

  it("keeps v6 classification and genuine structured/free-text conflicts unchanged", () => {
    const input = actualQuestionnaire(cases[0]), legacy = normalizeCompetitionQuestionnaire(input);
    expect(legacy.ok && legacy.interpretations.find(item => item.fieldId === "taskFormats")?.requiresConfirmation).toBe(true);
    const conflict = structuredClone(input); conflict.answers.find(answer => answer.fieldId === "stage")!.freeText = "本科大三";
    const result = normalizeCompetitionQuestionnaire(conflict, { policy: "v7" });
    expect(result.ok && result.interpretations.find(item => item.fieldId === "stage")).toMatchObject({ status: "conflict", requiresConfirmation: true });
  });
});
