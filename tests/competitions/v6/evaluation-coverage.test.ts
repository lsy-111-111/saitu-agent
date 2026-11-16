import { describe, expect, it } from "vitest";
import { getCoverageProfiles, getDecisionCatalog } from "@/lib/competitions/v6/catalog";
import { preparationPaths } from "@/content/competitions-v6/preparation-paths";
import { assessPreparationPath, coverageProfileToConfirmedChoices, evaluateCoverage, hasVerifiedAffordableTotal } from "../../../scripts/competitions/v6/evaluate-coverage";
import { syntheticRecord } from "./decision-fixtures";

describe("executed coverage accounting", () => {
  it("separates historical preparation from current eligibility without inventing free participation", () => {
    const profile = getCoverageProfiles()[0];
    const path = preparationPaths.find(path => path.id === "lanqiao-manual-trace")!;
    const assessment = assessPreparationPath(path, profile, getDecisionCatalog());
    expect(assessment.passed).toBe(true);
    expect(assessment.formalParticipationEligible).toBe(false);
    expect(assessment.budgetKind).toBe("editorial_inference");
    expect(assessment.reviewStatus).toBe("author_assessed_pending_independent_review");
    for (const patch of [{ maximumIncrementalPersonalCny: null }, { maximumIncrementalPersonalCny: 301 }, { needsLaboratory: true }, { needsTeam: true }, { requiredEquipment: ["独立GPU服务器"] }, { prerequisites: ["已通过抽象代数课程"] }]) {
      expect(assessPreparationPath({ ...path, ...patch }, profile, getDecisionCatalog()).passed).toBe(false);
    }
    expect(assessPreparationPath({...path,needsMentor:true},{...profile,mentor:true},getDecisionCatalog()).reasons).toContain("mentor_not_confirmed");
    expect(assessPreparationPath({...path,needsLaboratory:true},{...profile,laboratory:true},getDecisionCatalog()).reasons).toContain("laboratory_not_confirmed");
    const records = getDecisionCatalog();
    for (const record of records) for (const s of record.sources) if (path.sourceIds.includes(s.id)) s.accessStatus = "metadata_only";
    expect(assessPreparationPath(path, profile, records).passed).toBe(false);
  });
  it("permits cited complete published works for preparation but never turns them into official rules", () => {
    const profile = getCoverageProfiles().find(profile => profile.id === "core:experimental-research:coursework:constrained")!;
    const path = preparationPaths.find(path => path.id === "chemistry-paper-evidence")!;
    const records = getDecisionCatalog();
    const record = records.find(record => record.seriesId === path.seriesId && record.track.id === path.trackId)!;
    expect(assessPreparationPath(path, profile, records).passed).toBe(true);
    expect(assessPreparationPath(path, { ...profile, experience: "beginner" }, records).passed).toBe(false);
    record.deepDive!.workedExample.sourceIds = [];
    expect(assessPreparationPath(path, profile, records).passed).toBe(false);
    record.deepDive!.workedExample.sourceIds = path.sourceIds;
    record.deepDive!.workedExample.origin = "published_summary";
    expect(assessPreparationPath(path, profile, records).passed).toBe(false);
  });
  it("does not treat ordinary task-family overlap as satisfying special discipline constraints", () => {
    const special = getCoverageProfiles().find(profile => profile.id === "special:law-language-boundary")!;
    const path = preparationPaths.find(path => path.id === "classics-reading-explanation")!;
    expect(assessPreparationPath(path, special, getDecisionCatalog()).reasons).toContain("special_interest_constraints_not_explicitly_supported");
  });
  it("maps actual profile budgets and obtainable resources without asserting access already exists", () => {
    for (const source of getCoverageProfiles()) {
      const p = coverageProfileToConfirmedChoices(source);
      expect(p.decisionContext?.budget?.maximumYuan).toBe(source.budgetCny);
      expect(p.availableResources).not.toContain("lab");
      if (source.laboratory) expect(p.decisionContext?.obtainableResources).toContain("lab");
      if (source.experience === "beginner") expect(p.skills).toEqual([]);
    }
  });
  it("never counts unknown maximum personal expense as known affordable total", () => {
    const record = syntheticRecord(910);
    record.facts[0].field = "personalTotalCost";
    record.facts[0].text = "合成费用条件：个人总支出不超过100元。";
    record.cost = { minimumPersonalCny: 0, maximumPersonalCny: null, factIds: [record.facts[0].id], scope: record.scope, note: "费用下限不是总额上限" };
    expect(hasVerifiedAffordableTotal(record, 1000)).toBe(false);
    record.cost.maximumPersonalCny = 100;
    expect(hasVerifiedAffordableTotal(record, 1000)).toBe(false); // Historical is not current verification.
    record.facts[0].status = "verified_current";
    expect(hasVerifiedAffordableTotal(record, 1000)).toBe(true);
    record.facts[0].field = "fee";
    expect(hasVerifiedAffordableTotal(record, 1000)).toBe(false);
    record.facts[0].field = "personalTotalCost";
    expect(hasVerifiedAffordableTotal(record, 50)).toBe(false);
    record.cost.maximumPersonalCny = Number.NaN;
    expect(hasVerifiedAffordableTotal(record, 1000)).toBe(false);
  });
  it("executes all forty profiles and keeps conditional candidates outside strict coverage", () => {
    const result = evaluateCoverage({ now: new Date("2026-11-05T12:00:00+08:00") });
    expect(result.results).toHaveLength(40);
    expect(result.protocolVersion).toBe("saitu.coverage-protocol.v5");
    expect(result.measuredCoverage.overall.nowRegistrationPassed).toBeLessThanOrEqual(result.measuredCoverage.overall.strictPassed);
    expect(result.measuredCoverage.core.profileCount).toBe(36);
    expect(result.measuredCoverage.special.profileCount).toBe(4);
    for (const row of result.results) {
      expect(row.reportValidation.issues).toEqual([]);
      const strict = row.candidateAssessments.filter(item => item.strict);
      expect(row.nowRegistrationCoverage.seriesIds.every(id => strict.some(item => item.seriesId === id && item.nowRegistrationVerified))).toBe(true);
      expect(strict.every(item => item.eligibility === "eligible" && item.personalTotalVerifiedAffordable)).toBe(true);
      if (row.strictCoveragePassed) {
        expect(row.verifiedEligibilityAndPersonalTotalSeries.length).toBeGreaterThanOrEqual(3);
        expect(row.strictVerifiedPaths.length).toBeGreaterThanOrEqual(2);
      }
      if (row.preparationCoverage.passed) {
        expect(new Set(row.preparationCoverage.seriesIds).size).toBeGreaterThanOrEqual(3);
        expect(row.preparationCoverage.taskRolePathKinds.length).toBeGreaterThanOrEqual(2);
        expect(row.preparationCoverage.assessments.filter(item => item.passed).every(item => item.maximumIncrementalPersonalCny !== null && item.maximumIncrementalPersonalCny <= row.sourceProfile.budgetCny)).toBe(true);
      }
    }
    expect(result.independentSuitabilityMeasured).toBe(false);
  }, 20_000); // Forty complete profiles; execution allowance, not a product latency gate.
});
