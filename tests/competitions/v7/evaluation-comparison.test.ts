import { describe, expect, it } from "vitest";
import { COMPARISON_QUALITY_DIMENSIONS, COMPREHENSION_QUESTIONS, prepareComparisonPlan, validateComparisonPlan,
  collectComparisonReports, comparisonReaderPackets, scoreComparisonRecords, scoreComparisonOriginals, validateSimulationCostScope } from "../../../scripts/competitions/v7/evaluation-comparison.mjs";
import { POLICY_VERSION, POLICY_SHA256, EVALUATION_POLICY, canonicalHash } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { evaluationFixture } from "./evaluation.fixture";
import { DEFAULT_EFFORT_POLICY, TOP5_EFFORT_GRANT_VERSION, effortPolicySha256, evaluationRuntimeForEffort } from "../../../scripts/competitions/v7/evaluation-effort.mjs";

function fixture() {
  const original = evaluationFixture(), policy = { policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256 };
  const profiles = original.matrix.profileSnapshot.profiles.map((row: any) => ({ profileId: row.profileId, caseId: row.caseId, familyId: row.familyId, taskGroup: row.taskGroup, inputSha256: canonicalHash(row.input) }));
  const plan = prepareComparisonPlan({ profiles, seed: 20261109, frozenAt: "2026-11-09T00:01:00Z", freezeBinding: original.matrix.freezeBinding,
    coordinatorContextId: "coordinator-not-a-reviewer", blockedContextIds: ["implementer"] });
  const collection: any = { schemaVersion: "saitu.report-comparison-originals.v7.1", ...policy, plan, planSha256: canonicalHash(plan),
    originalPaidReservationIds: ["formal-reservation-must-not-be-reused"], runtime: EVALUATION_POLICY.runtime,
    pairs: plan.pairs.map((selection: any) => ({ ...selection, profileInput: { selfReport: "愿意整理调研数据，队友尚未落实" }, reports: selection.armOrder.map((algorithm: string, index: number) => {
      const report = { task: "整理调研数据", next: "先做小样本试编码", conditions: "队友尚未落实" };
      return { side: index === 0 ? "A" : "B", algorithm, report, reportSha256: canonicalHash(report), status: "observed", fallback: false };
    }) })) };
  const references: any[] = [], responses: any[] = [], judgments: any[] = [];
  for (const pair of collection.pairs) for (const report of pair.reports) {
    const id = { comparisonId: pair.comparisonId, side: report.side }, evidence = [{ target: "report", pointer: "/task", valueSha256: canonicalHash(report.report.task) }];
    const reference = { ...id, reportSha256: report.reportSha256, contextId: "independent-assessor", preparedAt: "2026-11-09T00:02:00Z",
      quality: Object.fromEntries(COMPARISON_QUALITY_DIMENSIONS.map(dimension => [dimension, { value: report.algorithm === "C" ? 3 : 2, reason: "Synthetic rubric judgment only.", evidence }])),
      questions: COMPREHENSION_QUESTIONS.map(question => ({ id: question.id, expectedAnswer: report.report.task, evidence })) };
    const response = { ...id, reportSha256: report.reportSha256, referenceSha256: canonicalHash(reference), contextId: `fresh-${pair.comparisonId}-${report.side}`,
      freshContext: true, blindToArm: true, otherArmRead: false, referenceAnswersRead: false, evidenceClass: "simulated_ai_not_real_student", status: "observed",
      openedAt: "2026-11-09T00:03:00Z", sealedAt: "2026-11-09T00:04:00Z", model: "gpt-6.1-sol", reasoningEffort: "max",
      answers: COMPREHENSION_QUESTIONS.map(question => ({ id: question.id, text: "只在此合成夹具中作答。" })), accounting: { kind: "work_context", paidCalls: 0, accountingMicros: 0, providerInvoiceCny: null } };
    references.push(reference); responses.push(response); judgments.push({ ...id, contextId: reference.contextId, referenceSha256: canonicalHash(reference), responseSha256: canonicalHash(response), reviewedAt: "2026-11-09T00:05:00Z",
      answers: COMPREHENSION_QUESTIONS.map((question, index) => ({ id: question.id, correct: report.algorithm === "C" || index < 2, reason: "Synthetic answer evaluation only.",
        evidence: [{ target: "response", pointer: `/answers/${index}/text`, valueSha256: canonicalHash(response.answers[index].text) }] })) });
  }
  const assessment = { schemaVersion: "saitu.report-comparison-assessment.v7.1", ...policy, collectionSha256: canonicalHash(collection), references, responses, judgments };
  return { original, plan, collection, assessment };
}

describe("60 paired report quality and comprehension comparisons", () => {
  it("freezes 10 independent families per task group and one original repetition per arm before any reports are read", () => {
    const { plan } = fixture(); expect(validateComparisonPlan(plan).pairs).toHaveLength(60);
    expect(new Set(plan.pairs.map((row: any) => row.familyId)).size).toBe(60);
    for (const group of new Set(plan.pairs.map((row: any) => row.taskGroup))) expect(plan.pairs.filter((row: any) => row.taskGroup === group)).toHaveLength(10);
    expect(plan.pairs.every((row: any) => row.repetition >= 0 && row.repetition < 5)).toBe(true);
    expect(plan.additionalRecommendationPaidInvocations).toBe(0);
    const changed = structuredClone(plan); changed.pairs[0].repetition = (changed.pairs[0].repetition + 1) % 5;
    expect(() => validateComparisonPlan(changed)).toThrow("selection_or_rubric_changed");
  });
  it("rejects parsed matrices and booleans as substitutes for original byte proofs", async () => {
    const { plan, original, collection, assessment } = fixture();
    expect(() => collectComparisonReports(plan, { matrix: original.matrix, rawOriginalBytesVerified: true })).toThrow("raw_formal_B_C_originals_required");
    await expect(scoreComparisonOriginals(collection, assessment, { evidenceRoot: "/must-not-be-read" })).rejects.toThrow("proof_missing_or_changed");
  });
  it("keeps exact report content in single-side packets without exposing reference answers or arm IDs", () => {
    const { collection } = fixture(), packets = comparisonReaderPackets(collection);
    expect(packets).toHaveLength(120); expect(packets[0].report).toBe(collection.pairs[0].reports[0].report);
    expect(packets.every(row => !Object.hasOwn(row, "algorithm") && !Object.hasOwn(row, "expectedAnswer"))).toBe(true);
  });
  it("computes paired descriptive quality and comprehension while unverified fixtures cannot become acceptance", () => {
    const { collection, assessment } = fixture(), result = scoreComparisonRecords(collection, assessment);
    expect(result.summaries).toMatchObject([{ algorithm: "B", denominator: 60, qualityMean: 2 }, { algorithm: "C", denominator: 60, qualityMean: 3, comprehensionAccuracy: 1 }]);
    expect(result.additionalRecommendationPaidInvocations).toBe(0); expect(result.additionalSimulationPaidCalls).toBe(0);
    expect(result.rawOriginalBytesVerified).toBe(false); expect(result.status).toBe("fixture_or_unverified_originals_only");
    expect(result.productAcceptance).toBe(false); expect(result.actualParticipants).toBe(0); expect(result.numericalFormalQualityGatesChanged).toBe(false);
  });
  it("keeps unavailable reports and missing assessments in the original 60-pair denominators", () => {
    const { collection, assessment } = fixture(); collection.pairs[0].reports[0].report = null; collection.pairs[0].reports[0].status = "indeterminate";
    assessment.collectionSha256 = canonicalHash(collection); assessment.responses.pop();
    const result = scoreComparisonRecords(collection, assessment);
    expect(result.summaries.every((row: any) => row.denominator === 60)).toBe(true);
    expect(result.summaries.reduce((sum: number, row: any) => sum + row.unavailableReports, 0)).toBe(1);
    expect(result.incompleteUnits).toBe(1); expect(result.results.filter((row: any) => row.status === "original_report_unavailable")).toHaveLength(1);
  });
  it("rejects evaluator self-answering, cross-arm reader reuse and reference answers opened too late", () => {
    for (const mutate of [
      (a: any) => a.responses[0].contextId = a.references[0].contextId,
      (a: any) => a.responses[1].contextId = a.responses[0].contextId,
      (a: any) => a.responses[0].otherArmRead = true,
      (a: any) => a.responses[0].referenceAnswersRead = true,
      (a: any) => a.references[0].preparedAt = "2026-11-09T00:06:00Z",
    ]) { const { collection, assessment } = fixture(); mutate(assessment); expect(() => scoreComparisonRecords(collection, assessment)).toThrow(); }
  });
  it("rejects altered report evidence and extra or duplicate assessment slots", () => {
    const stale = fixture(); stale.assessment.references[0].quality.personal_task_fit.evidence[0].valueSha256 = "0".repeat(64);
    expect(() => scoreComparisonRecords(stale.collection, stale.assessment)).toThrow("evidence_pointer_or_value_changed");
    const duplicate = fixture(); duplicate.assessment.responses.push(duplicate.assessment.responses[0]);
    expect(() => scoreComparisonRecords(duplicate.collection, duplicate.assessment)).toThrow("duplicate_response_unit");
    const foreign = fixture(); foreign.assessment.responses[0].comparisonId = "outside-prefrozen-selection";
    expect(() => scoreComparisonRecords(foreign.collection, foreign.assessment)).toThrow("foreign_assessment_unit");
  });
  it("requires separate metered originals rather than relabeling work-context simulations as paid provider calls", () => {
    const { collection, assessment } = fixture(); assessment.responses[0].accounting.paidCalls = 1;
    expect(() => scoreComparisonRecords(collection, assessment)).toThrow("cannot_claim_provider_spend");
    const paid = fixture(); paid.assessment.responses[0].accounting = { kind: "metered_provider", originals: { path: "synthetic-not-existing-cost.json", sha256: "a".repeat(64) } } as any;
    const result = scoreComparisonRecords(paid.collection, paid.assessment); expect(result.incompleteUnits).toBe(1);
    expect(() => scoreComparisonRecords(paid.collection, paid.assessment, { costsVerified: true })).toThrow("actual_separate_simulation_cost_originals_required");
  });
  it("uses an existing calibration phase and a separately bound simulation purpose without extending database authority", () => {
    const hash = "a".repeat(64), runtime = evaluationRuntimeForEffort(DEFAULT_EFFORT_POLICY);
    const original: any = { purpose: "simulation_comprehension", executionScope: { grantVersion: TOP5_EFFORT_GRANT_VERSION, authorizedEffort: "stage", effortPolicy: DEFAULT_EFFORT_POLICY,
      effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), runId: "separate-synthetic-simulation-batch", phase: "calibration", authorizedPhase: "calibration",
      authorizationPolicySha256: hash, environmentAuthorizationPolicySha256: hash, evaluationPolicySha256: POLICY_SHA256,
      authorizationPolicySnapshot: { path: "synthetic-authority.json", sha256: hash }, executionRuntimeConfigurationSha256: hash, callLimit: 1, fundingLimitCny: 1 } };
    expect(validateSimulationCostScope(original, runtime)).toBe(original.executionScope);
    for (const phase of ["formal", "simulation_comprehension"]) {
      const changed = structuredClone(original); changed.executionScope.phase = phase; changed.executionScope.authorizedPhase = phase;
      expect(() => validateSimulationCostScope(changed, runtime)).toThrow("bounded_execution_authority");
    }
    expect(() => validateSimulationCostScope({ ...original, purpose: "ranking-diagnostic" }, runtime)).toThrow("separate_simulation_comprehension_purpose_required");
  });
});
