import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POLICY_VERSION, POLICY_SHA256, RETIRED_SCOPES, CASE_QUOTAS, canonicalHash, isHash, isTime, requirePolicy,
  assertQuotas, assertUnique, writeNewJson, parseFileCli } from "./evaluation-policy.mjs";

/** Public identities/hashes only. No answer, label, expected output or input text is needed. */
export function buildMigrationInventory(inventory) {
  if (inventory.schemaVersion !== "saitu.public-case-inventory.v7.1" || !isHash(inventory.sourceSha256)) throw new Error("redacted_public_inventory_required");
  assertQuotas(inventory.cases);
  return { schemaVersion: "saitu.evaluation-migration.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    originalInventorySha256: inventory.sourceSha256, originalPolicyVersion: "v6_unchanged", originalEvidencePreserved: true,
    createdAt: new Date().toISOString(), reviewBasis: null, independentReview: null,
    rows: inventory.cases.map(row => {
      if (!isHash(row.inputSha256)) throw new Error("original_public_input_hash_required");
      return { originalCaseId: row.caseId, layer: row.layer, originalInputSha256: row.inputSha256,
        scope: "unreviewed", action: "pending", rationale: null, replacement: null, applicabilityReview: null };
    }),
    execution: { old800: 0, old1800: 0, new800: 0, new1200: 0 },
    answersOrLabelsRead: false, qualityAcceptance: false,
  };
}
export function inspectMigration(migration) {
  requirePolicy(migration);
  if (migration.schemaVersion !== "saitu.evaluation-migration.v7.1" || migration.originalEvidencePreserved !== true ||
      !isHash(migration.originalInventorySha256) || !Array.isArray(migration.rows)) throw new Error("versioned_preserving_migration_required");
  const original = migration.rows.map(row => ({ caseId: row.originalCaseId, layer: row.layer }));
  assertQuotas(original, "v7_migration_must_preserve_800_layer_denominators");
  const blockers = [], pending = [], retained = [], replaced = [], nextCases = [];
  const basis = migration.reviewBasis;
  if (!basis || ![basis.publicSpecificationSha256, basis.catalogSha256, basis.implementationSha256, basis.runtimeConfigurationSha256].every(isHash)) blockers.push("exact_v7_applicability_basis_not_frozen");
  for (const row of migration.rows) {
    if (!isHash(row.originalInputSha256)) throw new Error("original_input_hash_missing_from_migration");
    if (row.action === "pending") { pending.push(row.originalCaseId); continue; }
    if (!["retain", "replace"].includes(row.action) || !row.scope || row.scope === "unreviewed" || !row.rationale?.trim()) throw new Error("explicit_case_applicability_decision_required");
    if (RETIRED_SCOPES.includes(row.scope) && row.action !== "replace") throw new Error("retired_v6_scope_requires_equal_layer_replacement");
    const next = row.replacement, review = row.applicabilityReview;
    if (!next || !next.caseId || next.layer !== row.layer || !next.familyId || !next.templateFamilyId || !next.taskGroup ||
        ![next.inputSha256, next.answerSha256, next.sourceSnapshotSha256].every(isHash) || !next.authorContextId ||
        !["reliable_audience_conflict", "explicit_student_constraint", "source_scoped_fact", "full_core_ranking", "direct_student_profile", "direct_correction_conversation", "robustness_and_recovery"].includes(next.scope)) throw new Error("complete_v7_replacement_metadata_required");
    if (row.action === "replace" && (next.caseId === row.originalCaseId || next.inputSha256 === row.originalInputSha256)) throw new Error("retired_case_cannot_be_relabelled_as_replacement");
    if (row.action === "retain" && next.inputSha256 !== row.originalInputSha256) throw new Error("retained_input_bytes_must_be_unchanged");
    if (!review || !review.contextId || [next.authorContextId, migration.authorContextId, ...(migration.implementationAuthorContextIds ?? [])].includes(review.contextId) ||
        review.policySha256 !== POLICY_SHA256 || review.inputSha256 !== next.inputSha256 || review.answerSha256 !== next.answerSha256 ||
        review.basisSha256 !== canonicalHash(basis) || review.decision !== "applicable" || !review.reason?.trim() || !isTime(review.reviewedAt) ||
        !isHash(review.evidenceSha256)) { pending.push(row.originalCaseId); continue; }
    nextCases.push(next); (row.action === "retain" ? retained : replaced).push(row.originalCaseId);
  }
  if (pending.length) blockers.push("independent_case_applicability_review_pending");
  assertUnique(nextCases.map(row => row.caseId), "duplicate_v7_replacement_case");
  assertUnique(nextCases.map(row => row.inputSha256), "duplicate_v7_replacement_input");
  if (nextCases.length === 800) assertQuotas(nextCases);
  const review = migration.independentReview;
  const decisionsSha256 = canonicalHash(migration.rows);
  if (!review || !review.contextId || [migration.authorContextId, ...(migration.implementationAuthorContextIds ?? [])].includes(review.contextId) ||
      review.decisionsSha256 !== decisionsSha256 || review.policySha256 !== POLICY_SHA256 || review.passed !== true ||
      !isTime(review.reviewedAt) || !isHash(review.evidenceSha256) || (basis && review.basisSha256 !== canonicalHash(basis))) blockers.push("one_independent_migration_round_pending");
  return { schemaVersion: "saitu.evaluation-migration-inspection.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    denominator: 800, quotas: CASE_QUOTAS, ready: blockers.length === 0 && nextCases.length === 800, blockers,
    retained: retained.length, replaced: replaced.length, pending: pending.length, pendingCaseIds: pending,
    decisionsSha256, cases: nextCases, originalEvidencePreserved: true, formalExecution: { cases: 0, rankingReports: 0 }, qualityAcceptance: false };
}
async function main() {
  const options = parseFileCli(process.argv.slice(2), ["--inventory", "--output"]);
  const inventory = JSON.parse(await readFile(options["--inventory"], "utf8"));
  const result = buildMigrationInventory(inventory);
  await writeNewJson(options["--output"], result);
  console.log(JSON.stringify({ output: options["--output"], cases: 800, independentApplicability: "pending", executed: 0 }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
