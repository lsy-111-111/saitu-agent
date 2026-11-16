import { getCoverageProfiles, getDecisionCatalog } from "@/lib/competitions/v6/catalog";
import { buildDecisionContext, buildRuleDecisionReport } from "@/lib/competitions/v6/engine";
import { validateDecisionReport } from "@/lib/competitions/v6/validation";
import type { CoverageProfile, DecisionCompetitionRecord, TaskFamily } from "@/lib/competitions/v6/catalog-types";
import type { CompetitionRecommendationProfileV5 } from "@/types/competition-recommendation";
import { createHash } from "node:crypto";
import { preparationPaths, type PreparationPath } from "@/content/competitions-v6/preparation-paths";
import { isDecisionEvidenceFact, isEvidenceForRecord } from "@/lib/competitions/v6/evidence";
import { assessFormalParticipationPlan, yuanToFen } from "@/lib/competitions/v6/participation-plan";
import { assessStrictParticipation, assessNowRegistration } from "./coverage-participation";

/** Historical preparation is a separate bounded activity, never current registration approval. */
export function assessPreparationPath(path: PreparationPath, source: CoverageProfile, records: DecisionCompetitionRecord[]) {
  const record = records.find(item => item.seriesId === path.seriesId && item.track.id === path.trackId && path.sourceIds.every(id => item.sources.some(s => s.id === id)));
  const reasons: string[] = [];
  if (!record || !["L2", "L3"].includes(record.contentTier)) reasons.push("missing_decision_complete_record");
  if (!path.sourceIds.length || !record?.deepDive || !["official_task", "published_work"].includes(record.deepDive.workedExample.origin) ||
      !path.sourceIds.every(id => record.sources.some(s => s.id === id && s.accessStatus === "body_read" && s.integrity !== "requires_recheck" && (["organizer", "official_host", "university_local"].includes(s.authority) || (record.deepDive?.workedExample.origin === "published_work" && record.deepDive.workedExample.sourceIds.includes(id)))))) reasons.push("complete_task_source_not_supported");
  if (source.taskFamily !== path.taskFamily) reasons.push("different_task_family");
  if (source.kind === "special" && !path.specialProfileIds.includes(source.id)) reasons.push("special_interest_constraints_not_explicitly_supported");
  if (path.minimumExperience === "coursework" && source.experience !== "coursework") reasons.push("required_coursework_not_confirmed");
  if (path.prerequisites.length) reasons.push("additional_prerequisites_not_confirmed");
  if (path.requiredEquipment.some(equipment => !source.equipment.includes(equipment))) reasons.push("required_equipment_not_confirmed");
  if (path.needsTeam) reasons.push("actual_teammates_not_confirmed");
  // This fixed protocol records mentor/lab flags as obtainable resources.
  // A possibility of access never establishes permission or present access.
  if (path.needsMentor) reasons.push("mentor_not_confirmed");
  if (path.needsLaboratory) reasons.push("laboratory_not_confirmed");
  if (!Number.isFinite(path.maximumHours) || path.maximumHours <= 0 || path.maximumHours > source.weeklyHours) reasons.push("time_budget_not_satisfied");
  const maximum = path.maximumIncrementalPersonalCny;
  if (typeof maximum !== "number" || !Number.isFinite(maximum) || maximum < 0 || maximum > source.budgetCny || !path.budgetBasis.trim()) reasons.push("preparation_budget_unknown_or_exceeded");
  if (![path.action, path.output, path.check].every(text => text.trim().length >= 8)) reasons.push("preparation_task_not_actionable");
  return { pathId: path.id, seriesId: path.seriesId, recordId: record?.recordId ?? null, taskFamily: path.taskFamily, role: path.role,
    action: path.action, output: path.output, completionCheck: path.check, pathKind: path.pathKind, sourceIds: path.sourceIds,
    maximumHours: path.maximumHours, requiredEquipment: path.requiredEquipment, maximumIncrementalPersonalCny: maximum,
    budgetKind: path.budgetKind, budgetBasis: path.budgetBasis, reviewStatus: path.reviewStatus,
    passed: reasons.length === 0, reasons, formalParticipationEligible: false };
}

const taskMapping: Record<TaskFamily, Pick<CompetitionRecommendationProfileV5, "majorFields" | "interests" | "taskFormats" | "skills">> = {
  "software-algorithms": { majorFields: ["computer-science"], interests: ["innovation"], taskFormats: ["software"], skills: ["programming"] },
  "data-modeling": { majorFields: ["mathematics"], interests: ["data"], taskFormats: ["modeling"], skills: ["data-analysis"] },
  "engineering-prototype": { majorFields: ["engineering"], interests: ["engineering"], taskFormats: ["hardware"], skills: ["hardware"] },
  "experimental-research": { majorFields: ["biology-life-science"], interests: ["biology-life-science"], taskFormats: ["research"], skills: ["laboratory"] },
  investigation: { majorFields: ["public-management"], interests: ["public-management"], taskFormats: ["research"], skills: ["fieldwork", "research"] },
  "business-practice": { majorFields: ["business"], interests: ["career"], taskFormats: ["product"], skills: ["accounting-finance"] },
  "visual-interaction": { majorFields: ["design"], interests: ["design"], taskFormats: ["design"], skills: ["design"] },
  "language-communication": { majorFields: ["language-culture"], interests: ["language-communication"], taskFormats: ["language"], skills: ["writing", "presentation"] },
  "teaching-service": { majorFields: ["humanities"], interests: ["language-communication"], taskFormats: ["language"], skills: ["presentation"] }
};

/** A documented synthetic choice mapping, not a claimed NLP interpretation or measured student ability. */
export function coverageProfileToConfirmedChoices(source: CoverageProfile): CompetitionRecommendationProfileV5 {
  const mapping = taskMapping[source.taskFamily];
  const p: CompetitionRecommendationProfileV5 = {
    profileVersion: "competition-profile.v5", questionnaireVersion: "competition-questionnaire.v1",
    stage: source.education.year === 1 ? "undergraduate-1" : "undergraduate-2",
    confirmedFields: ["stage", "majorFields", "interests", "goals", "taskFormats", "weeklyCommitment", "teamStatus", "availableResources", "participationMode"],
    confirmedFacts: [], majorFields: [...mapping.majorFields], interests: [...mapping.interests], taskFormats: [...mapping.taskFormats],
    skills: [], specificSubjects: [], goals: ["project", "portfolio"], preferredOutputs: [],
    startingPoint: source.experience === "coursework" ? "coursework" : "idea_only",
    weeklyCommitment: source.weeklyHours < 5 ? "under-5" : source.weeklyHours <= 10 ? "5-10" : "over-10",
    teamStatus: source.team === "none" ? "solo" : "looking", availableResources: [],
    participationMode: source.mobility === "remote_only" ? "remote" : "offline-local", participationTiming: "flexible",
    experienceLevel: "none", evidence: [],
    decisionContext: { mode: "quick", goalResolution: "undecided", experienceStatus: source.experience === "coursework" || source.kind === "special" ? "provided" : "none",
      fixedTeam: false, obtainableResources: [...(source.mentor ? ["mentor" as const] : []), ...(source.laboratory ? ["lab" as const, "equipment" as const] : [])],
      budget: { range: source.budgetCny === 0 ? "zero" : source.budgetCny < 100 ? "under100" : source.budgetCny <= 500 ? "100-500" : "over500",
        maximumYuan: source.budgetCny, scope: "personal" } }
  };
  if (source.experience === "coursework") {
    p.skills = [...mapping.skills]; p.confirmedFields.push("skills");
  }
  if (p.decisionContext!.experienceStatus === "provided") p.decisionContext!.experiences = source.evidence.map((task, index) => ({
    id: `coverage-evidence-${index + 1}`, task, contribution: task.includes("独立") ? "independent" : "unknown", completion: "unknown", challenge: "", confirmed: true
  }));
  if (source.id === "special:humanities-evidence") {
    p.majorFields = ["humanities"]; p.interests = ["culture-language"]; p.skills = [];
    p.decisionContext!.excludedTaskFormats = ["software", "algorithm", "entrepreneurship"];
  }
  if (source.id === "special:education-transfer") { p.majorFields = ["humanities"]; p.interests = ["culture-language"]; p.skills = []; }
  if (source.id === "special:agriculture-no-lab") { p.majorFields = ["agriculture-environment"]; p.interests = ["agriculture-environment"]; p.skills = []; }
  if (source.id === "special:law-language-boundary") {
    p.majorFields = ["humanities"]; p.specificSubjects = ["legal-studies"]; p.confirmedFields.push("specificSubjects"); p.skills = [];
  }
  return p;
}

export function hasVerifiedAffordableTotal(record: DecisionCompetitionRecord, personalBudget: number, profile?: CoverageProfile, now: Date = new Date()): boolean {
  const budgetFen = yuanToFen(personalBudget);
  if (budgetFen === null) return false;
  if (record.participationPlans !== undefined) {
    if (!profile || profile.budgetCny !== personalBudget) return false;
    const result = assessFormalParticipationPlan(record, profile, now);
    return result.costReasons.length === 0 && result.maximumPersonalFen !== null && result.maximumPersonalFen <= budgetFen;
  }
  const cost = record.cost;
  const maximum = cost?.maximumPersonalCny;
  if (!cost || typeof maximum !== "number" || !Number.isFinite(maximum) || maximum < 0 ||
    yuanToFen(maximum) === null || yuanToFen(maximum)! > budgetFen || !cost.factIds.length) return false;
  // A registration fee (including zero) is not a bound on all personal expenses.
  return cost.factIds.some(id => record.facts.some(fact => fact.id === id && fact.field === "personalTotalCost")) && cost.factIds.every(id => record.facts.some(fact => fact.id === id && fact.kind === "official_fact" &&
    ["investment", "fee", "cost", "personalTotalCost"].includes(fact.field) && fact.status === "verified_current" && fact.scope === cost.scope && fact.sourceIds.length > 0 &&
    isEvidenceForRecord(record, fact) && isDecisionEvidenceFact(record, fact) && fact.sourceIds.every(sourceId => record.sources.some(source => source.id === sourceId && source.integrity !== "requires_recheck"))));
}

const distinctSeries = (records: DecisionCompetitionRecord[]) => [...new Set(records.map(record => record.seriesId))];
function paths(records: DecisionCompetitionRecord[]) {
  return [...new Set(records.flatMap(record => record.roles.map(role => `${record.taskFamily} | ${role.name.trim()} | ${role.task.trim()}`)))];
}

export function evaluateCoverage(options: { now?: Date; profiles?: CoverageProfile[]; records?: DecisionCompetitionRecord[] } = {}) {
  const now = options.now ?? new Date();
  const profiles = options.profiles ?? getCoverageProfiles();
  const records = options.records ?? getDecisionCatalog();
  const results = profiles.map(source => {
    const confirmedChoices = coverageProfileToConfirmedChoices(source);
    const context = buildDecisionContext(confirmedChoices, { now, records, profileId: source.id });
    const report = buildRuleDecisionReport(confirmedChoices, { now, records, profileId: source.id });
    const validation = validateDecisionReport(report, context);
    const related = context.candidates.filter(candidate => candidate.relevant);
    const participation = new Map(related.map(candidate => [candidate.record.recordId, assessStrictParticipation(candidate.record, source, now)]));
    const proven = related.filter(candidate => candidate.eligibility === "eligible" && hasVerifiedAffordableTotal(candidate.record, source.budgetCny, source, now) && participation.get(candidate.record.recordId)?.passed === true);
    const nowOpen = proven.filter(candidate => assessNowRegistration(candidate.record, now));
    const nowOpenRecords = nowOpen.map(candidate => candidate.record);
    const nowOpenSeries = distinctSeries(nowOpenRecords), nowOpenPaths = paths(nowOpenRecords);
    const conditional = related.filter(candidate => !proven.includes(candidate));
    const provenRecords = proven.map(candidate => candidate.record);
    const provenSeries = distinctSeries(provenRecords), provenPaths = paths(provenRecords);
    const passed = validation.ok && provenSeries.length >= 3 && provenPaths.length >= 2;
    const preparationAssessments = preparationPaths.filter(path => path.taskFamily === source.taskFamily).map(path => assessPreparationPath(path, source, records));
    const usablePreparation = preparationAssessments.filter(item => item.passed);
    const preparationSeries = [...new Set(usablePreparation.map(item => item.seriesId))];
    const preparationPathKinds = [...new Set(usablePreparation.map(item => item.pathKind))];
    const preparationPassed = validation.ok && preparationSeries.length >= 3 && preparationPathKinds.length >= 2;
    const combinedSeries = [...new Set([...provenSeries, ...preparationSeries])];
    const combinedPaths = [...new Set([...provenPaths.map(path => `formal:${path}`), ...preparationPathKinds.map(path => `preparation:${path}`)])];
    return {
      profileId: source.id, kind: source.kind, taskFamily: source.taskFamily, label: source.label,
      sourceProfile: source, confirmedChoices, catalogVersion: context.catalogVersion,
      nonConflictingCandidateSeries: distinctSeries(context.candidates.map(candidate => candidate.record)),
      taskRelatedCandidateSeries: distinctSeries(related.map(candidate => candidate.record)),
      conditionalCandidateSeries: distinctSeries(conditional.map(candidate => candidate.record)),
      verifiedEligibilityAndPersonalTotalSeries: provenSeries,
      taskRelatedPaths: paths(related.map(candidate => candidate.record)), strictVerifiedPaths: provenPaths,
      displayedSeries: report.recommendations.map(item => item.seriesId), shortlistShortfallReason: report.shortlistShortfallReason,
      reportValidation: validation, strictCoveragePassed: passed,
      nowRegistrationCoverage: { passed: validation.ok && nowOpenSeries.length >= 3 && nowOpenPaths.length >= 2, seriesIds: nowOpenSeries, taskRolePaths: nowOpenPaths },
      preparationCoverage: { status: "author_assessed_pending_independent_review", passed: preparationPassed,
        seriesIds: preparationSeries, taskRolePathKinds: preparationPathKinds, assessments: preparationAssessments,
        gaps: [...(preparationSeries.length < 3 ? ["fewer_than_three_supported_preparation_series"] : []), ...(preparationPathKinds.length < 2 ? ["fewer_than_two_preparation_task_role_paths"] : [])] },
      learningOrParticipationCoverage: { passed: validation.ok && combinedSeries.length >= 3 && combinedPaths.length >= 2,
        seriesIds: combinedSeries, taskRolePaths: combinedPaths, independentAcceptance: "pending" },
      candidateAssessments: related.map(candidate => ({ itemId: candidate.record.recordId, seriesId: candidate.record.seriesId,
        taskFamily: candidate.record.taskFamily, eligibility: candidate.eligibility,
        nowRegistrationVerified: assessNowRegistration(candidate.record, now),
        personalTotalVerifiedAffordable: hasVerifiedAffordableTotal(candidate.record, source.budgetCny, source, now),
        knownPersonalTotalMaximum: candidate.record.participationPlans !== undefined ? (() => { const fen = assessFormalParticipationPlan(candidate.record, source, now).maximumPersonalFen; return fen === null ? null : fen / 100; })() : candidate.record.cost?.maximumPersonalCny ?? null,
        participationFeasibility: participation.get(candidate.record.recordId),
        conditions: candidate.conditions, strict: proven.includes(candidate) })),
      gaps: [
        ...(distinctSeries(related.map(candidate => candidate.record)).length < 3 ? ["fewer_than_three_task_related_series"] : []),
        ...(related.some(candidate => candidate.eligibility !== "eligible") ? ["eligibility_unknown_for_some_candidates"] : []),
        ...(related.some(candidate => !hasVerifiedAffordableTotal(candidate.record, source.budgetCny, source, now)) ? ["personal_total_cost_not_verified_for_some_candidates"] : []),
        ...(related.some(candidate => participation.get(candidate.record.recordId)?.passed !== true) ? ["resources_or_current_registration_not_verified_for_some_candidates"] : []),
        ...(provenSeries.length < 3 ? ["fewer_than_three_fully_verified_series"] : []),
        ...(provenPaths.length < 2 ? ["fewer_than_two_fully_verified_task_role_paths"] : [])
      ]
    };
  });
  function summary(rows: typeof results) {
    const passed = rows.filter(row => row.strictCoveragePassed).length;
    return { profileCount: rows.length, strictPassed: passed, nowRegistrationPassed: rows.filter(row => row.nowRegistrationCoverage.passed).length, strictRate: rows.length ? passed / rows.length : null,
      preparationPassed: rows.filter(row => row.preparationCoverage.passed).length,
      preparationRate: rows.length ? rows.filter(row => row.preparationCoverage.passed).length / rows.length : null,
      learningOrParticipationPassed: rows.filter(row => row.learningOrParticipationCoverage.passed).length,
      learningOrParticipationRate: rows.length ? rows.filter(row => row.learningOrParticipationCoverage.passed).length / rows.length : null,
      profilesWithThreeTaskRelatedSeries: rows.filter(row => row.taskRelatedCandidateSeries.length >= 3).length,
      profilesWithTwoTaskRelatedPaths: rows.filter(row => row.taskRelatedPaths.length >= 2).length };
  }
  return {
    schemaVersion: "saitu.coverage-execution.v1", asOf: now.toISOString(), generatedAt: new Date().toISOString(),
    protocolVersion: "saitu.coverage-protocol.v5", protocolDocument: "docs/v6/coverage-protocol-v5.md",
    preparationEvidenceDigest: createHash("sha256").update(JSON.stringify(preparationPaths)).digest("hex"),
    acceptanceStatus: "pending_independent_protocol_and_path_review",
    method: "40 synthetic confirmed-choice profiles through actual decision engine; rule candidate/task coverage, not independent suitability validation",
    target: { distinctVerifiedSeries: 3, distinctVerifiedTaskRolePaths: 2, targetRate: 0.9 },
    measuredCoverage: { overall: summary(results), core: summary(results.filter(row => row.kind === "core")), special: summary(results.filter(row => row.kind === "special")) },
    independentSuitabilityMeasured: false, realStudentEvidence: false,
    limitations: ["Unknown eligibility and unknown personal total cost never count as verified formal participation coverage.",
      "Preparation costs are explicitly editorial incremental estimates using already confirmed equipment; they are not official entry fees or full participation budgets.",
      "Preparation paths and protocol remain author-assessed pending independent review; a computed pass is not final acceptance.",
      "Task and role paths are editorial identifiers; semantic distinctness requires independent review.",
      "Source mentor/lab access described as obtainable is mapped to conditional resources, never already available.",
      "This run does not establish that any student is objectively skilled or that automatic ranking is correct."],
    results
  };
}
