import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POLICY_VERSION, POLICY_SHA256, canonicalHash, byteHash, isHash, writeNewJson, parseFileCli } from "./evaluation-policy.mjs";

const TEST = "tests/competitions/v7/evaluation-contract.test.ts";
const RANKING = [TEST, "v7 same-invocation C reuse and ranking gates accepts a tied C/B family result without the retired .03 superiority gate"];
const INTEGRITY = [TEST, "v7 same-invocation C reuse and ranking gates checks both arms and all 1200 original bindings before exposing 600 C observations"];
const MIGRATION = [TEST, "v7 independent 800-case policy migration requires same-layer replacement for retired registration and evidence-certification cases"];
const RAW = [TEST, "v7 raw scoring replacement gates derives the 800-case gates from raw bound observations and retains separate product acceptance"];
const SELF = ["tests/competitions/v7/profile.test.ts", "v7 immediate self-report adoption uses submitted ability without requiring a concrete experience or another confirmation"];
const NEGATED = ["tests/competitions/v7/profile.test.ts", "v7 immediate self-report adoption adopts unknown and negated facts without manufacturing positive ability"];
const CORRECTION = ["tests/competitions/v7/profile.test.ts", "v7 clear correction and ambiguity applies 8-to-3 hours immediately and retains exact new hours plus the original wording"];
const QUESTIONNAIRE = ["tests/competitions/v7/profile.test.ts", "v7 clear correction and ambiguity adopts an unambiguous questionnaire text answer while keeping legacy normalization readable"];
const FULL_POOL = ["tests/competitions/v7/algorithm.test.ts", "v7 full-pool model-owned ranking sends the entire pool in one governed high call and preserves the LLM order"];
const REAL_POOL = ["tests/competitions/v7/algorithm.test.ts", "v7 full-pool model-owned ranking also includes the real matching pool without a hidden top-N shortlist"];
const CONTRACT = ["tests/competitions/v7/algorithm.test.ts", "v7 full-pool model-owned ranking rejects duplicate series, stale versions, fabricated sources and foreign student IDs"];
const EXCLUSION = ["tests/competitions/v7/algorithm.test.ts", "v7 batch grounded explanations honors explicit task refusal without excluding unknown readiness"];
const AUDIENCE = ["tests/competitions/v7/catalog.test.ts", "explicit audience and historical metadata requires independently reviewed metadata and exact confirmed user evidence for stable audience conflicts"];
const HISTORICAL = ["tests/competitions/v7/catalog.test.ts", "explicit audience and historical metadata never infers an audience exclusion from historical/current registration qualification alone"];
const REASONS = ["tests/competitions/v7/algorithm.test.ts", "v7 batch grounded explanations never allows explanation generation to reorder the C ranking"];
const FRONTEND = ["tests/competitions/recommendation-run-v7.test.tsx", "v7 list delivery and recovery boundaries rejects a stale version or changed identity while retaining delivered lists and detail"];
const SHORTFALL = ["tests/competitions/recommendation-run-v7.test.tsx", "v7 list delivery and recovery boundaries renders a useful list and official links before any detail exists"];
const BACKEND = ["tests/competitions/v7/durable-state.integration.test.ts", "v7 durable PostgreSQL state with no live provider rejects competing corrections and never publishes a late old worker result"];
const SOURCE_FREEZE = [TEST, "v7 source freeze reads actual current source bytes and rejects a changed source mirror or manifest"];
export const LEGACY_FAILURE_RULES = Object.freeze([
  { file: "tests/competitions/followup-gold-audit.test.ts", title: "reaches each track oracle through V5 and proves both emitted branches are distinct", kind: "retired_v5_followup_contract", replacement: [FULL_POOL, REAL_POOL, QUESTIONNAIRE, RANKING],
    reason: "V5 precomputed track-question paths and branch order do not govern the v7 full-pool LLM ranking; explicit constraints remain mandatory." },
  { file: "tests/competitions/followup-gold-audit.test.ts", title: "keeps every authored question material and its own branches outcome-distinct", kind: "retired_v5_followup_contract", replacement: [SELF, QUESTIONNAIRE, CORRECTION, BACKEND, FRONTEND],
    reason: "Fixed material-question branches were replaced by direct submitted input and clear correction adoption." },
  { file: "tests/competitions/followup-gold-audit.test.ts", title: "matches the authored fit and goal minimal member, relation and track oracles", kind: "retired_v5_ranking_oracle", replacement: [FULL_POOL, REAL_POOL, REASONS, RANKING, RAW],
    reason: "Exact V5 Top3 members/relations are a different policy target; v7 requires independent current-pool graded relevance and source-bound reasons." },
  { file: "tests/competitions/followup-gold-audit.test.ts", title: "keeps fit and goal answers qualification-invariant across the complete frozen snapshot", kind: "retired_v5_qualification_contract", replacement: [AUDIENCE, HISTORICAL, EXCLUSION, MIGRATION, RAW],
    reason: "Current enrollment and qualification certification are retired; independently reliable audience conflicts and explicit student limits still require validation." },
  { file: "tests/competitions/followup-gold-audit.test.ts", title: "limits goal trade-offs to the authored 75/25 goalsOutputs refinement", kind: "retired_rule_score_formula", replacement: [FULL_POOL, REASONS, RANKING],
    reason: "The 75/25 numerical refinement belongs to the retired deterministic scorer, not the v7 model-owned order." },
  { file: "tests/competitions/followup-gold-audit.test.ts", title: "allows reached track answers only from precomputed states and never upgrades needs_clarification", kind: "retired_confirmation_state_contract", replacement: [SELF, NEGATED, CORRECTION, BACKEND, FRONTEND, AUDIENCE, RAW],
    reason: "Precomputed qualification confirmation is retired; v7 adopts clear student answers while retaining unknown/negated states and correction isolation." },
  { file: "tests/competitions/gold-freeze-manifest.test.ts", title: "freezes the benchmark clock and every literal fixture source", kind: "historical_integrity_failure", replacement: [SOURCE_FREEZE, INTEGRITY],
    reason: "A frozen v5 verifier/source byte mismatch is a real historical integrity failure. It stays failed; the unchanged old artifact cannot certify today's v7 source." },
  { file: "tests/competitions/quality-benchmark.test.ts", title: "meets fixed-question and true V5 full-path ranking gates", kind: "retired_v5_ranking_oracle", replacement: [FULL_POOL, REAL_POOL, CONTRACT, RANKING, RAW],
    reason: "V5 fixed-question/full-path Top3 gates do not describe the v7 full-core B/C matrix. No old score is reinterpreted as a v7 pass." },
  { file: "tests/competitions/recommendation-quality.test.ts", title: "keeps the expert top choice and hard-negative gates while filling three unique items", kind: "retired_exact_three_oracle", replacement: [CONTRACT, EXCLUSION, AUDIENCE, SHORTFALL, RANKING, RAW],
    reason: "Fixed Top1/exact-three completion is retired; unique-series contract, reliable conflicts and explicit exclusions remain covered in v7." },
  { file: "tests/competitions/recommendation-quality.test.ts", title: "recovers fixed mechanical/hardware alternatives after the target is hard excluded", kind: "retired_v5_ranking_oracle", replacement: [EXCLUSION, AUDIENCE, REAL_POOL, RANKING, RAW],
    reason: "Authored fixed mechanical alternatives assume the retired scoring policy; v7 uses full-pool relevance and independently reviewed applicable explicit exclusions." },
  { file: "tests/competitions/scoring-gold-audit.test.ts", title: "places at least 90% of gold pairs inside their human-approved base-score intervals", kind: "retired_rule_score_interval", replacement: [FULL_POOL, REASONS, RANKING, RAW],
    reason: "Human-approved old numerical intervals remain old evidence. v7 does not emit that base score; its replacement is graded independent relevance, not a rescaled interval." },
  { file: "tests/competitions/strict-baseline-acceptance.test.ts", title: "retains the legacy exact-three and Top3-subset-of-Top10 quality gates for all original 125 inputs", kind: "retired_exact_three_oracle", replacement: [SHORTFALL, CONTRACT, REAL_POOL, RANKING, RAW],
    reason: "The mandatory three-item completion is retired; v7 permits honest shortfall while preserving identity, unique series and actual displayed-list scoring." },
  { file: "tests/competitions/strict-baseline-acceptance.test.ts", title: "captures only when explicitly requested, then verifies the prospective baseline byte-for-byte", kind: "historical_integrity_failure", replacement: [SOURCE_FREEZE, INTEGRITY],
    reason: "The old prospective snapshot no longer matches current source/behavior. Do not recapture or change its hash to claim a pass; freeze new v7 evidence separately." },
]);

export function classifyLegacyFailures(baseline, { baselineSha256, repositoryRoot, authorContextId }) {
  if (!isHash(baselineSha256) || !authorContextId) throw new Error("original_machine_report_hash_and_author_required");
  const results = baseline.testResults.flatMap(suite => suite.assertionResults.filter(row => row.status === "failed").map(row => ({ file: path.relative(repositoryRoot, suite.name).replaceAll(path.sep, "/"), ...row })));
  const rows = LEGACY_FAILURE_RULES.map(rule => {
    const matches = results.filter(row => row.file === rule.file && row.fullName.endsWith(rule.title));
    if (matches.length !== 1) throw new Error(`original_13_failure_missing_or_ambiguous:${rule.file}:${rule.title}`);
    const failure = matches[0];
    return { file: rule.file, fullName: failure.fullName, originalStatus: "failed", classification: rule.kind,
      runtimeDefectUnderV7: false, originalEvidenceStatus: "failed_preserved", rationale: rule.reason,
      replacementTests: rule.replacement.map(([file, fullName]) => ({ file, fullName })),
      requiredFormalEvidence: rule.kind === "historical_integrity_failure" ? null : { schemaVersion: "saitu.evaluation-result.v7.1", cases: 800, rankingReports: 1200,
        status: "evaluation_gates_passed_requires_remaining_product_acceptance", verifiedOriginalBytes: true, syntheticEvidenceAllowed: false },
      requiredSetDisposition: "pending_independent_applicability_review", releasePassClaim: false,
      originalFailureMessageSha256: canonicalHash(failure.failureMessages),
      scopeCondition: "Only the v7 submitted-input/full-core model workflow is current; old v5/v6 saved records retain read compatibility." };
  });
  return { schemaVersion: "saitu.legacy-test-applicability.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    baselineSha256, authorContextId, baselineCounts: { total: baseline.numTotalTests, passed: baseline.numPassedTests, failed: baseline.numFailedTests, pending: baseline.numPendingTests },
    rows, classifiedOriginalFailures: 13, historicalIntegrityFailures: rows.filter(row => row.classification === "historical_integrity_failure").length,
    oldTestsDeleted: false, oldGoldChanged: false, oldFailuresConvertedToPass: false, independentReview: null,
    remainingScope: "Other current UI/privacy/catalog/ops defects are separate and must be fixed under their owners; this report does not exclude them.",
    qualityAcceptance: false };
}
/** Only exact, independently approved old failures may leave the new required set. New failures remain defects. */
export function applyReviewedLegacyTransition(report, independentReview, replacementReports, formalEvaluation = null) {
  if (report.schemaVersion !== "saitu.legacy-test-applicability.v7.1" || report.policySha256 !== POLICY_SHA256 || report.rows.length !== 13 ||
      !independentReview || !independentReview.contextId || independentReview.contextId === report.authorContextId || independentReview.reportSha256 !== canonicalHash(report) ||
      independentReview.policySha256 !== POLICY_SHA256 || independentReview.passed !== true || independentReview.decisions?.length !== 13) throw new Error("independent_exact_legacy_transition_review_required");
  const tests = replacementReports.flatMap(item => item.testResults.flatMap(suite => suite.assertionResults.map(row => ({ ...row, filename: suite.name.replaceAll(path.sep, "/") }))));
  for (const row of report.rows) {
    const decision = independentReview.decisions.filter(item => item.file === row.file && item.fullName === row.fullName);
    if (decision.length !== 1 || decision[0].disposition !== "retire_from_v7_required_set" || !decision[0].reason?.trim()) throw new Error("each_legacy_required_test_needs_explicit_independent_disposition");
    for (const test of row.replacementTests) if (!tests.some(actual => actual.filename.endsWith("/" + test.file) && actual.fullName === test.fullName && actual.status === "passed")) throw new Error(`meaningful_v7_replacement_not_passed:${test.fullName}`);
    if (row.requiredFormalEvidence && (!formalEvaluation || formalEvaluation.schemaVersion !== "saitu.evaluation-result.v7.1" ||
        formalEvaluation.policySha256 !== POLICY_SHA256 || formalEvaluation.status !== "evaluation_gates_passed_requires_remaining_product_acceptance" ||
        formalEvaluation.formalDenominators?.cases !== 800 || formalEvaluation.formalDenominators?.rankingReports !== 1200 ||
        formalEvaluation.product?.counts?.not_run !== 0 || formalEvaluation.product?.counts?.pending !== 0 ||
        formalEvaluation.ranking?.execution?.actualModelRuns !== 600 || formalEvaluation.evidenceVerification?.rawOriginalBytesVerified !== true ||
        !isHash(formalEvaluation.evidenceVerification?.bundleSha256) || !isHash(formalEvaluation.evidenceVerification?.matrixFreezeSha256) ||
        independentReview.formalEvaluationSha256 !== canonicalHash(formalEvaluation))) throw new Error("formal_800_1200_quality_artifact_required_synthetic_tests_do_not_retire_quality_gates");
  }
  return { schemaVersion: "saitu.required-test-transition.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    originalBaselineSha256: report.baselineSha256, applicabilityReportSha256: canonicalHash(report), independentReviewSha256: canonicalHash(independentReview),
    retiredSelectors: report.rows.map(({ file, fullName }) => ({ file, fullName, originalStatus: "failed_preserved" })),
    replacementTests: [...new Map(report.rows.flatMap(row => row.replacementTests).map(test => [JSON.stringify(test), test])).values()],
    formalEvaluationSha256: formalEvaluation ? canonicalHash(formalEvaluation) : null,
    scope: "new_v7_required_set_only", oldEvidenceChanged: false, oldFailurePasses: 0, releaseAcceptance: false };
}
async function main() {
  const options = parseFileCli(process.argv.slice(2), ["--baseline", "--author-context", "--output"]);
  const bytes = await readFile(options["--baseline"]), repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const report = classifyLegacyFailures(JSON.parse(bytes), { baselineSha256: byteHash(bytes), repositoryRoot, authorContextId: options["--author-context"] });
  await writeNewJson(options["--output"], report);
  console.log(JSON.stringify({ output: options["--output"], classified: 13, pendingIndependentReview: 13, legacyPasses: 0 }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
