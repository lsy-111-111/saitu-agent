import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { MetricDerivation } from "./acceptance-artifact-derivation";
// Explicit .ts resolution keeps the Node 24 CLI executable without tsconfig alias loaders.
const { deriveAcceptanceArtifacts, deriveBudgetArtifact } = createRequire(import.meta.url)("./acceptance-artifact-derivation.ts") as typeof import("./acceptance-artifact-derivation");

export const CASE_QUOTAS = Object.freeze({ hard_constraints: 300, factual: 100, ranking: 120, profile: 120, conversation: 80, robustness: 80 });
export const ACCEPTANCE_TASK_GROUPS = Object.freeze(["software_data", "engineering_design", "experimental_agriculture", "business_practice", "survey_education", "arts_language"]);
export type ChallengeCase = {
  caseId: string; familyId: string; templateFamilyId: string; layer: keyof typeof CASE_QUOTAS;
  taskGroup: string; inputSha256: string; answerSha256: string; sourceSnapshotSha256: string;
  authorContextId: string; reviewerContextIds: [string, string]; adjudicatorContextId?: string;
  origin: "ai_authored" | "human_authored"; split: "sealed";
};
export type ChallengeManifest = {
  schemaVersion: "saitu.challenge-manifest.v1";
  evidenceClass: "ai_proxy" | "independent_human";
  frozenAt: string; openedAt: string | null; implementationFrozenAt: string;
  implementationSha256: string; configurationSha256: string;
  isolation: "separate_contexts_shared_filesystem" | "externally_access_controlled";
  developmentFamilyIds: string[]; developmentTemplateFamilyIds: string[]; developmentInputSha256: string[];
  publicSeedManifestSha256: string;
  cases: ChallengeCase[];
};
const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isTime = (value: string) => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

/** Structure/provenance gate only: disjoint IDs cannot establish semantic independence. */
export function inspectChallengeManifest(manifest: ChallengeManifest): string[] {
  const issues: string[] = [];
  if (manifest.schemaVersion !== "saitu.challenge-manifest.v1") issues.push("unsupported_manifest");
  if (!["ai_proxy", "independent_human"].includes(manifest.evidenceClass)) issues.push("evidence_class_required");
  if (!isTime(manifest.frozenAt) || !isTime(manifest.implementationFrozenAt) ||
    manifest.openedAt !== null && (!isTime(manifest.openedAt) || Date.parse(manifest.openedAt) < Math.max(Date.parse(manifest.frozenAt), Date.parse(manifest.implementationFrozenAt)))) issues.push("invalid_freeze_timeline");
  if (![manifest.implementationSha256, manifest.configurationSha256, manifest.publicSeedManifestSha256].every(isHash)) issues.push("freeze_hashes_required");
  if (new Set(manifest.developmentInputSha256).size < 96 || new Set(manifest.developmentFamilyIds).size < 36 || !manifest.developmentTemplateFamilyIds.length) issues.push("public_development_exclusion_inventory_incomplete");
  if (manifest.evidenceClass === "independent_human" && manifest.isolation !== "externally_access_controlled") issues.push("human_sealing_requires_external_access_control");
  if (manifest.cases.length !== 800) issues.push("requires_800_sealed_cases");
  const ids = new Set<string>(), inputs = new Set<string>();
  for (const row of manifest.cases) {
    if (!row.caseId || !row.familyId || !row.templateFamilyId || !row.taskGroup || row.split !== "sealed") issues.push(`invalid_case_identity:${row.caseId}`);
    if (ids.has(row.caseId) || inputs.has(row.inputSha256)) issues.push(`duplicate_case_or_input:${row.caseId}`);
    ids.add(row.caseId); inputs.add(row.inputSha256);
    if (![row.inputSha256, row.answerSha256, row.sourceSnapshotSha256].every(isHash)) issues.push(`case_hash_required:${row.caseId}`);
    if (manifest.developmentFamilyIds.includes(row.familyId) || manifest.developmentTemplateFamilyIds.includes(row.templateFamilyId) || manifest.developmentInputSha256.includes(row.inputSha256)) issues.push(`development_contamination:${row.caseId}`);
    const roles = [row.authorContextId, ...(row.reviewerContextIds ?? []), ...(row.adjudicatorContextId ? [row.adjudicatorContextId] : [])];
    if (row.reviewerContextIds?.length !== 2 || roles.some(role => !role) || new Set(roles).size !== roles.length) issues.push(`review_contexts_not_separated:${row.caseId}`);
    if (manifest.evidenceClass === "independent_human" && row.origin !== "human_authored") issues.push(`ai_case_cannot_certify_human_gold:${row.caseId}`);
  }
  for (const [layer, quota] of Object.entries(CASE_QUOTAS)) if (manifest.cases.filter(row => row.layer === layer).length !== quota) issues.push(`layer_quota:${layer}`);
  const ranking = manifest.cases.filter(row => row.layer === "ranking");
  const groups = new Set(ranking.map(row => row.taskGroup));
  if (new Set(ranking.map(row => row.familyId)).size !== 120 || groups.size !== 6 || ACCEPTANCE_TASK_GROUPS.some(group => !groups.has(group)) || [...groups].some(group => new Set(ranking.filter(row => row.taskGroup === group).map(row => row.familyId)).size < 20)) issues.push("ranking_requires_six_groups_of_twenty_families");
  return [...new Set(issues)];
}

export type MetricEvidence = {
  value: number | null; numerator?: number; denominator: number;
  evidencePath: string; evidenceSha256: string;
  evidenceClass: "deterministic" | "real_product" | "live_model" | "ai_proxy" | "independent_human" | "real_students";
};
export type AcceptanceInput = {
  schemaVersion: "saitu.product-acceptance.v1";
  mode: "ai_proxy" | "original_human";
  selectedAlgorithm: "A1" | "B" | "C";
  selectedReasoningEffort: "max" | "high" | "low";
  metrics: Record<string, MetricEvidence>;
  challengeManifest: ChallengeManifest;
  /** Caller claims only. A raw scoring derivation must establish execution before acceptance. */
  sealedCaseExecution: { caseId: string; status: "passed" | "failed" | "not_run" }[];
  rawScoringEvidence?: { path: string; sha256: string };
  recallsTrimmed: boolean;
  budgetEvidence?: { path: string; sha256: string };
  budget: { maximumCny: number; spentCny: number; reservedCny: number; unpricedCalls: number };
  humanStudies: { actualParticipants: number; independentHumanReviewers: number };
  comprehensionProtocol: { baselineMean: number; baselineCriticalMisunderstandings: number; mode: "superiority" | "noninferiority"; frozenBeforeStudy: boolean };
};

type GateRule = { id: string; op: "min" | "max" | "equal"; target: number; minDenominator?: number; classes?: MetricEvidence["evidenceClass"][] };
export const PRODUCT_GATE_RULES: readonly GateRule[] = [
  { id: "currentTestFailures", op: "equal", target: 0, minDenominator: 1, classes: ["deterministic"] },
  { id: "missingRequiredTests", op: "equal", target: 0, minDenominator: 1, classes: ["deterministic"] },
  { id: "unresolvedHistoricalFailures", op: "equal", target: 0, minDenominator: 27, classes: ["deterministic"] },
  { id: "lintTypeBuildPassed", op: "equal", target: 1, minDenominator: 3, classes: ["deterministic"] },
  { id: "hardConstraintViolations", op: "equal", target: 0, minDenominator: 300 },
  { id: "criticalFactErrors", op: "equal", target: 0, minDenominator: 100 },
  { id: "factAccuracy", op: "min", target: 0.98, minDenominator: 500 },
  { id: "citationPrecision", op: "min", target: 0.98 },
  { id: "citationCoverage", op: "min", target: 0.95 },
  { id: "criticalCitationCoverage", op: "equal", target: 1 },
  { id: "profileMicroF1", op: "min", target: 0.95, minDenominator: 120 },
  { id: "profileMinimumSliceF1", op: "min", target: 0.90 },
  { id: "abilityInflationOrRevocationFailures", op: "equal", target: 0 },
  { id: "correctionSuccess", op: "equal", target: 1 },
  { id: "pooledNdcg5", op: "min", target: 0.85, minDenominator: 120 },
  { id: "pooledNdcg10", op: "min", target: 0.80, minDenominator: 120 },
  { id: "minimumTaskGroupNdcg5", op: "min", target: 0.75, minDenominator: 20 },
  { id: "completePoolLabelCoverage", op: "equal", target: 1 },
  { id: "unresolvedLabels", op: "equal", target: 0 },
  { id: "validReasons", op: "min", target: 0.95 },
  { id: "expectedCounterfactualResponses", op: "min", target: 0.90 },
  { id: "top5Jaccard", op: "min", target: 0.80 },
  { id: "reportContractPass", op: "equal", target: 1 },
  { id: "sourceSeriesReviewed", op: "min", target: 135 },
  { id: "distinctCatalogSeries", op: "min", target: 155 },
  { id: "newDistinctL2Series", op: "min", target: 20 },
  { id: "deepPilotRecords", op: "min", target: 10 },
  { id: "deepL3Records", op: "min", target: 45 },
  { id: "distinctL3Series", op: "min", target: 45 },
  { id: "priorityCandidatesReviewed", op: "min", target: 20 },
  { id: "strictCoverage", op: "min", target: 0.90, minDenominator: 40 },
  { id: "pilotJourneysCompleted", op: "min", target: 12, minDenominator: 12 },
  { id: "simulatedIndependentProfiles", op: "min", target: 60, minDenominator: 60 },
  { id: "comprehensionMean", op: "min", target: 85, minDenominator: 60 },
  { id: "actionableNextStep", op: "min", target: 0.80, minDenominator: 60 },
  { id: "quickCompletion", op: "min", target: 0.85, minDenominator: 60 },
  { id: "firstScreenP95Ms", op: "max", target: 15000, minDenominator: 100, classes: ["real_product", "live_model"] },
  { id: "fullReportP95Ms", op: "max", target: 45000, minDenominator: 100, classes: ["real_product", "live_model"] },
  { id: "fallbackContractPass", op: "equal", target: 1, classes: ["deterministic", "live_model"] },
  { id: "actualModelRuns", op: "min", target: 600, minDenominator: 600, classes: ["live_model"] },
  { id: "frozenCandidateEvidenceComplete", op: "equal", target: 1, classes: ["deterministic"] },
  { id: "preregisteredExperimentControlsPass", op: "equal", target: 1, classes: ["deterministic"] },
  { id: "flashThinkingEffortTransportPass", op: "equal", target: 1, classes: ["deterministic", "live_model"] },
  { id: "blindReviewProtocolPass", op: "equal", target: 1, classes: ["deterministic"] },
  { id: "rawReviewerAgreementAlpha", op: "min", target: 0.70 },
  { id: "sourceUpdateReplayAndRollbackPass", op: "equal", target: 1, classes: ["deterministic"] },
  { id: "desktopMobileEndToEndPass", op: "equal", target: 1, minDenominator: 12, classes: ["deterministic", "live_model"] },
];

export function evaluateProductAcceptance(input: AcceptanceInput, evidenceRoot: string | ReadonlySet<string> = process.cwd()) {
  // Legacy caller-supplied verification Sets are deliberately ignored, never treated as proof.
  const batch = deriveAcceptanceArtifacts(input, typeof evidenceRoot === "string" ? evidenceRoot : process.cwd());
  const artifactDerivations = typeof evidenceRoot === "string" ? batch.artifactDerivations : {};

  const budgetDerivation = typeof evidenceRoot === "string" ? deriveBudgetArtifact(input,evidenceRoot) : {status:"pending",reason:"raw_ledger_evidence_required",derived:null,details:{}};
  const blockers = inspectChallengeManifest(input.challengeManifest).map(issue => `manifest:${issue}`);
  if (input.schemaVersion !== "saitu.product-acceptance.v1") blockers.push("unsupported_acceptance_contract");
  if (!["ai_proxy", "original_human"].includes(input.mode) || !["A1", "B", "C"].includes(input.selectedAlgorithm)) blockers.push("invalid_acceptance_mode_or_algorithm");
  if (!["max", "high", "low"].includes(input.selectedReasoningEffort)) blockers.push("explicit_supported_reasoning_effort_required");
  if (input.challengeManifest.openedAt === null) blockers.push("sealed_set_not_executed");
  if (input.challengeManifest.evidenceClass !== (input.mode === "ai_proxy" ? "ai_proxy" : "independent_human")) blockers.push("evidence_mode_mismatch");
  if (typeof evidenceRoot !== "string") blockers.push("caller_supplied_verification_is_not_evidence");
  const executionDerivation = batch.executionDerivation;
  if (executionDerivation.status !== "derived") blockers.push(`sealed_case_execution:${executionDerivation.reason}`);
  if(budgetDerivation.status!=="derived")blockers.push(`budget:${budgetDerivation.reason}`);
  const rawExecutions = executionDerivation.status === "derived" ? executionDerivation.execution : [];
  const executions = new Map(rawExecutions.map(row => [row.caseId, row.status]));
  if (executions.size !== rawExecutions.length || executions.size !== 800 || input.challengeManifest.cases.some(row => executions.get(row.caseId) !== "passed")) blockers.push("all_800_cases_must_execute_and_pass");
  const rules = [...PRODUCT_GATE_RULES];
  if (!input.comprehensionProtocol?.frozenBeforeStudy || !Number.isFinite(input.comprehensionProtocol.baselineMean) || input.comprehensionProtocol.baselineMean < 0 || input.comprehensionProtocol.baselineMean > 100 || !Number.isInteger(input.comprehensionProtocol.baselineCriticalMisunderstandings) || input.comprehensionProtocol.baselineCriticalMisunderstandings < 0) blockers.push("comprehension_protocol_not_preregistered");
  if (input.comprehensionProtocol?.baselineMean <= 80 || input.comprehensionProtocol?.mode === "superiority") {
    rules.push({ id: "comprehensionGain", op: "min", target: 15, minDenominator: 60 }, { id: "comprehensionGainCiLower", op: "min", target: Number.MIN_VALUE, minDenominator: 60 });
  } else if (input.comprehensionProtocol?.mode === "noninferiority") {
    rules.push({ id: "comprehensionGainCiLower", op: "min", target: -5, minDenominator: 60 });
    rules.push(input.comprehensionProtocol.baselineCriticalMisunderstandings === 0
      ? { id: "criticalMisunderstandings", op: "equal", target: 0, minDenominator: 60 }
      : { id: "criticalMisunderstandingReduction", op: "min", target: Number.MIN_VALUE, minDenominator: 60 });
  } else blockers.push("invalid_comprehension_protocol");
  if (input.selectedAlgorithm === "C") rules.push({ id: "relativeNdcg5Gain", op: "min", target: 0.03, minDenominator: 120 }, { id: "relativeNdcg5CiLower", op: "min", target: Number.MIN_VALUE, minDenominator: 120 });
  if (input.selectedReasoningEffort !== "max") rules.push(
    { id: "effortVsMaxNdcg5CiLower", op: "min", target: Number.MIN_VALUE, minDenominator: 120 },
    { id: "effortOtherQualityNonregressionPass", op: "equal", target: 1 },
    { id: "effortFrozenUnseenRevalidationPass", op: "equal", target: 1, minDenominator: 800 },
  );
  if (input.recallsTrimmed) rules.push({ id: "recallAt60", op: "min", target: 0.98, minDenominator: 20 }, { id: "fullyAuditedRecallCatalogSize", op: "min", target: 100 });
  if (input.mode === "original_human") {
    if (input.humanStudies.actualParticipants < 60 || input.humanStudies.independentHumanReviewers < 2) blockers.push("actual_human_evidence_required");
    rules.push({ id: "humanTimingProtocolPass", op: "equal", target: 1, classes: ["real_students"] });
  }
  const gates = rules.map(rule => {
    const metric = input.metrics[rule.id];
    const derivation = artifactDerivations[rule.id];
    const isRatio = /(?:Accuracy|Precision|Coverage|MicroF1|SliceF1|Success|Ndcg5|Ndcg10|Reasons|Responses|Jaccard|ContractPass|NextStep|Completion|AgreementAlpha|ProtocolPass|ControlsPass|EndToEndPass|RollbackPass|EvidenceComplete|TestsPassed|recallAt60|lintTypeBuildPassed)$/.test(rule.id) && !rule.id.startsWith("relative");
    const reason = !metric ? "missing_metric" : metric.value === null || !Number.isFinite(metric.value) ? "unmeasured_metric"
      : !["deterministic", "real_product", "live_model", "ai_proxy", "independent_human", "real_students"].includes(metric.evidenceClass) ? "invalid_evidence_class"
      : isRatio && (metric.value < 0 || metric.value > 1) ? "metric_out_of_range"
      : rule.id === "comprehensionMean" && (metric.value < 0 || metric.value > 100) ? "metric_out_of_range"
      : !Number.isInteger(metric.denominator) || metric.denominator < (rule.minDenominator ?? 1) ? "insufficient_denominator"
      : rule.classes && !rule.classes.includes(metric.evidenceClass) ? "wrong_evidence_class"
      : input.mode === "original_human" && ["comprehensionMean", "comprehensionGain", "comprehensionGainCiLower", "criticalMisunderstandingReduction", "actionableNextStep", "quickCompletion"].includes(rule.id) && metric.evidenceClass !== "real_students" ? "actual_students_required"
      : input.mode === "original_human" && metric.evidenceClass === "ai_proxy" ? "ai_proxy_cannot_satisfy_human_gate"
      : !(rule.op === "equal" ? metric.value === rule.target : rule.op === "min" ? metric.value >= rule.target : metric.value <= rule.target) ? "threshold_not_met"
      : !derivation || derivation.status !== "derived" ? derivation?.reason ?? "raw_metric_derivation_required" : null;
    if (reason) blockers.push(`${rule.id}:${reason}`);
    return { ...rule, actual: derivation?.derived?.value ?? null, claimed: metric?.value ?? null,
      evidenceStatus: derivation?.status ?? "pending", derivedDenominator: derivation?.derived?.denominator ?? null,
      passed: reason === null, reason };
  });
  const budget = input.budget;
  if (![budget.maximumCny, budget.spentCny, budget.reservedCny].every(value => Number.isFinite(value) && value >= 0) || budget.maximumCny > 300 || budget.spentCny + budget.reservedCny > budget.maximumCny || budget.unpricedCalls !== 0) blockers.push("budget_not_reconciled_within_300_cny");
  return { schemaVersion: "saitu.product-acceptance-result.v1", gates, blockers, artifactDerivations, budgetDerivation, executionDerivation,
    rawEvidenceReadiness: { sealedCaseExecution: executionDerivation.status === "derived" ? "derived" : executionDerivation.reason, budget: budgetDerivation.status === "derived" ? "derived" : budgetDerivation.reason },
    agreedAiProxyGatesPassed: input.mode === "ai_proxy" && blockers.length === 0,
    originalAllProductGatesPassed: input.mode === "original_human" && blockers.length === 0,
    realStudentStudy: input.humanStudies.actualParticipants ? "external_evidence_requires_review" : "not_performed",
    productionApproval: "not_performed", productionDeployment: "not_performed",
    limitation: "AI proxy evidence and separate agent contexts do not establish independent human judgment or actual student understanding." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const inputIndex = process.argv.indexOf("--input"), outputIndex = process.argv.indexOf("--output");
  if (inputIndex < 0 || !process.argv[inputIndex + 1]) throw new Error("Usage: acceptance-gate.ts --input INPUT.json [--output RESULT.json]");
  const input = JSON.parse(readFileSync(process.argv[inputIndex + 1], "utf8")) as AcceptanceInput;
  const result = evaluateProductAcceptance(input, process.cwd());
  const json = JSON.stringify(result, null, 2) + "\n";
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) writeFileSync(process.argv[outputIndex + 1], json);
  else process.stdout.write(json);
  if (result.blockers.length) process.exitCode = 1;
}

/** Semantic, metric-specific validation; matching bytes alone are never a success certificate. */
export function verifyMetricArtifacts(input: AcceptanceInput, root: string): Record<string, MetricDerivation> {
  return deriveAcceptanceArtifacts(input, root).artifactDerivations;
}
