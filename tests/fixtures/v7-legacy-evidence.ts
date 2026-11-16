import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";
import {
  LEGACY_V7_MIGRATION_ROOT, LEGACY_V7_MIGRATED_TEST_FILES, LEGACY_V7_CURRENT_FILES,
  migrationCanonicalJson, migrationSha256, type MigrationFailureArchive,
  type CurrentMigrationBinding as PreviousMigrationBinding,
} from "../competitions/legacy-v7-migration.fixture";
import { RECOMMENDATION_POLICY_VERSION, RECOMMENDATION_RESPONSE_VERSION } from "@/lib/competitions/v7/contracts";

export { LEGACY_V7_MIGRATION_ROOT, LEGACY_V7_MIGRATED_TEST_FILES, migrationCanonicalJson, migrationSha256 };
const directory = path.join(process.cwd(), "tests/fixtures/v7-legacy-evidence");
export const LEGACY_PROSPECTIVE_BASELINE_PATH = "tests/fixtures/competition-score-prospective-baseline.json";
const allowedRoots = [
  "artifacts/continuation-v7-20261109/legacy-test-migration/",
  "artifacts/continuation-20261105/legacy-blind-review/",
  "artifacts/continuation-20261105/legacy-migration/",
  "artifacts/v6/legacy-review-20261105/",
];
type OpaqueIndex = { schemaVersion: string; files: { originalPath: string; fixturePath: string; bytes: number; sha256: string }[] };

/** Exact historical bytes only. There is no workspace-artifacts fallback and
 * no label transformation. Logical paths remain the original lock identity. */
function verifiedLegacyEvidence(originalPath: string, fixtureRoot: string) {
  if (!(originalPath === LEGACY_PROSPECTIVE_BASELINE_PATH || allowedRoots.some(root => originalPath.startsWith(root))) || path.posix.normalize(originalPath) !== originalPath) throw new Error("unknown_legacy_evidence_path");
  const indexName = originalPath === LEGACY_PROSPECTIVE_BASELINE_PATH ? "index.v7.3.json" : "index.json";
  const index = JSON.parse(readFileSync(path.join(fixtureRoot, indexName), "utf8")) as OpaqueIndex;
  if (index.schemaVersion !== "saitu.legacy-evidence-opaque-source-closure.v1") throw new Error("invalid_legacy_evidence_index");
  const entries = index.files.filter(row => row.originalPath === originalPath);
  if (entries.length !== 1) throw new Error("unknown_legacy_evidence_path");
  const row = entries[0];
  if (!/^[a-f0-9]{64}$/.test(row.sha256) || row.fixturePath !== `opaque/${row.sha256}.bin`) throw new Error("invalid_legacy_evidence_index");
  const filename = path.join(fixtureRoot, row.fixturePath);
  if (!lstatSync(filename).isFile() || lstatSync(filename).isSymbolicLink()) throw new Error("legacy_evidence_not_regular_file");
  const bytes = readFileSync(filename);
  if (bytes.length !== row.bytes || migrationSha256(bytes) !== row.sha256) throw new Error("legacy_evidence_bytes_changed");
  return { filename, bytes };
}
export function legacyEvidencePath(originalPath: string, fixtureRoot = directory) {
  return verifiedLegacyEvidence(originalPath, fixtureRoot).filename;
}
export function readLegacyEvidenceBytes(originalPath: string, fixtureRoot = directory) {
  return verifiedLegacyEvidence(originalPath, fixtureRoot).bytes;
}
export function readMigrationJson<T>(relativePath: string): T {
  return JSON.parse(readLegacyEvidenceBytes(`${LEGACY_V7_MIGRATION_ROOT}/${relativePath}`).toString("utf8")) as T;
}
export function currentMigrationSourcePath(repositoryRoot: string, relativePath: string): string {
  // A test mirror must validate its own copied contract/source bytes. The
  // source-only repository resolves immutable artifact identities via fixtures.
  if (path.resolve(repositoryRoot) === path.resolve(process.cwd()) && (relativePath.startsWith("artifacts/") || relativePath === LEGACY_PROSPECTIVE_BASELINE_PATH)) return legacyEvidencePath(relativePath);
  const filename = path.resolve(repositoryRoot, relativePath);
  if (!filename.startsWith(path.resolve(repositoryRoot) + path.sep)) throw new Error("invalid_current_migration_source_path");
  return filename;
}

export function verifyLegacyOriginalBytes() {
  const before = `${LEGACY_V7_MIGRATION_ROOT}/before`;
  const contract = readMigrationJson<{ archivalEvidence: Record<string, string> }>("migration-contract.json");
  for (const [relativePath, expected] of Object.entries(contract.archivalEvidence)) {
    if (migrationSha256(readLegacyEvidenceBytes(`${before}/${relativePath}`)) !== expected) throw new Error(`historical_archive_binding_changed:${relativePath}`);
  }
  for (const lockPath of ["before-lock.json", "historical-evidence-lock.json", "historical-scope-lock.json"]) {
    const lock = readMigrationJson<{ fileSha256: Record<string, string> }>(`before/${lockPath}`);
    for (const [relativePath, expected] of Object.entries(lock.fileSha256)) {
      if (migrationSha256(readLegacyEvidenceBytes(`${before}/${relativePath}`)) !== expected) throw new Error(`historical_original_bytes_changed:${relativePath}`);
    }
  }
  const archive = readMigrationJson<MigrationFailureArchive>("before/original-failures.json");
  const sourceBytes = readLegacyEvidenceBytes(`${before}/${archive.sourceReport}`);
  if (migrationSha256(sourceBytes) !== archive.sourceReportSha256) throw new Error("original_failure_report_binding_changed");
  const source = JSON.parse(sourceBytes.toString("utf8")) as {
    testResults: { name: string; assertionResults: Omit<MigrationFailureArchive["failures"][number], "file">[] }[];
  };
  const actual = source.testResults.flatMap(suite => {
    const marker = suite.name.lastIndexOf("/tests/");
    const file = marker >= 0 ? suite.name.slice(marker + 1) : path.relative(process.cwd(), suite.name);
    return (LEGACY_V7_MIGRATED_TEST_FILES as readonly string[]).includes(file)
      ? suite.assertionResults.filter(assertion => assertion.status === "failed").map(assertion => ({ file, ...assertion })) : [];
  });
  if (archive.failedCount !== 13 || actual.length !== 13 || migrationCanonicalJson(actual) !== migrationCanonicalJson(archive.failures)) throw new Error("original_thirteen_failure_records_changed");
  const evidence = readMigrationJson<{ fileSha256: Record<string, string> }>("before/historical-evidence-lock.json");
  for (const [relativePath, expected] of Object.entries(evidence.fileSha256)) {
    if (migrationSha256(readFileSync(currentMigrationSourcePath(process.cwd(), relativePath))) !== expected) throw new Error(`historical_fixture_was_rewritten:${relativePath}`);
  }
  return archive;
}

type PreviousPortabilityBinding = PreviousMigrationBinding & {
  predecessorBinding: { path: string; sha256: string };
  portability: { files: { path: string; sha256: string }[] };
  changedCurrentFiles: { path: string; fromSha256: string; toSha256: string }[];
};
export type CurrentMigrationBinding = PreviousPortabilityBinding & {
  portabilityTransition: {
    adapter: { path: string; fromSha256: string; toSha256: string };
    originalIndex: { path: string; sha256: string };
    addedIndex: { path: string; sha256: string; logicalPaths: string[] };
  };
};
export function readCurrentLegacyMigrationBinding(): CurrentMigrationBinding {
  return JSON.parse(readFileSync(path.join(directory, "current-test-binding.v7.3.json"), "utf8")) as CurrentMigrationBinding;
}
export function verifyCurrentMigrationBinding(repositoryRoot = process.cwd(), binding = readCurrentLegacyMigrationBinding()) {
  const { bindingSha256, ...unsigned } = binding;
  if (binding.schemaVersion !== "saitu.legacy-test-applicability-binding.v7.3" || binding.policyVersion !== RECOMMENDATION_POLICY_VERSION || binding.responseVersion !== RECOMMENDATION_RESPONSE_VERSION ||
      binding.evidenceScope !== "current-v7-contract-unit-checks-only" || binding.migrationContract.path !== `${LEGACY_V7_MIGRATION_ROOT}/migration-contract.json` ||
      migrationSha256(migrationCanonicalJson(unsigned)) !== bindingSha256) throw new Error("current_migration_binding_changed");
  if (JSON.stringify(binding.files.map(file => file.path).sort()) !== JSON.stringify(LEGACY_V7_CURRENT_FILES)) throw new Error("all_six_current_tests_and_helper_must_be_bound");
  const predecessorPath = "tests/fixtures/v7-legacy-evidence/current-test-binding.v7.2.json";
  const predecessorBytes = readFileSync(currentMigrationSourcePath(repositoryRoot, predecessorPath)), previous = JSON.parse(predecessorBytes.toString("utf8")) as PreviousPortabilityBinding;
  const { bindingSha256: oldHash, ...oldUnsigned } = previous;
  if (binding.predecessorBinding.path !== predecessorPath || binding.predecessorBinding.sha256 !== migrationSha256(predecessorBytes) ||
      previous.schemaVersion !== "saitu.legacy-test-applicability-binding.v7.2" || migrationSha256(migrationCanonicalJson(oldUnsigned)) !== oldHash ||
      migrationCanonicalJson(previous.migrationContract) !== migrationCanonicalJson(binding.migrationContract)) throw new Error("current_migration_predecessor_changed");
  const historicalPredecessorPath = `${LEGACY_V7_MIGRATION_ROOT}/current-test-binding.json`;
  if (previous.predecessorBinding.path !== historicalPredecessorPath || previous.predecessorBinding.sha256 !== migrationSha256(readLegacyEvidenceBytes(historicalPredecessorPath))) throw new Error("current_migration_predecessor_changed");
  const changed = ["tests/competitions/gold-freeze-manifest.test.ts", "tests/competitions/strict-baseline-acceptance.test.ts"];
  if (JSON.stringify(binding.changedCurrentFiles.map(file => file.path).sort()) !== JSON.stringify(changed)) throw new Error("current_migration_change_scope_changed");
  for (const file of binding.files) {
    const old = previous.files.find(row => row.path === file.path), transition = binding.changedCurrentFiles.find(row => row.path === file.path);
    if (!old || (transition ? transition.fromSha256 !== old.sha256 || transition.toSha256 !== file.sha256 : file.sha256 !== old.sha256)) throw new Error("current_migration_change_scope_changed");
  }
  const adapterPath = "tests/fixtures/v7-legacy-evidence.ts", indexPath = "tests/fixtures/v7-legacy-evidence/index.json", addedIndexPath = "tests/fixtures/v7-legacy-evidence/index.v7.3.json";
  if (JSON.stringify(binding.portability.files.map(file => file.path).sort()) !== JSON.stringify([
    adapterPath, indexPath, addedIndexPath, predecessorPath,
  ].sort())) throw new Error("current_migration_portability_closure_changed");
  const transition = binding.portabilityTransition;
  if (transition.adapter.path !== adapterPath || transition.adapter.fromSha256 !== previous.portability.files.find(file => file.path === adapterPath)?.sha256 ||
      transition.adapter.toSha256 !== binding.portability.files.find(file => file.path === adapterPath)?.sha256 ||
      transition.originalIndex.path !== indexPath || transition.originalIndex.sha256 !== previous.portability.files.find(file => file.path === indexPath)?.sha256 ||
      transition.originalIndex.sha256 !== binding.portability.files.find(file => file.path === indexPath)?.sha256 ||
      transition.addedIndex.path !== addedIndexPath || transition.addedIndex.sha256 !== binding.portability.files.find(file => file.path === addedIndexPath)?.sha256 ||
      JSON.stringify(transition.addedIndex.logicalPaths) !== JSON.stringify([LEGACY_PROSPECTIVE_BASELINE_PATH])) throw new Error("current_migration_portability_closure_changed");
  for (const file of [...binding.files, binding.migrationContract, ...binding.portability.files]) {
    if (migrationSha256(readFileSync(currentMigrationSourcePath(repositoryRoot, file.path))) !== file.sha256) throw new Error(`current_migration_source_bytes_changed:${file.path}`);
  }
  const originalIndex = JSON.parse(readFileSync(currentMigrationSourcePath(repositoryRoot, indexPath), "utf8")) as OpaqueIndex;
  const addedIndex = JSON.parse(readFileSync(currentMigrationSourcePath(repositoryRoot, addedIndexPath), "utf8")) as OpaqueIndex;
  const archived = originalIndex.files.find(file => file.originalPath === `${LEGACY_V7_MIGRATION_ROOT}/before/${LEGACY_PROSPECTIVE_BASELINE_PATH}`);
  if (!archived || addedIndex.schemaVersion !== originalIndex.schemaVersion || migrationCanonicalJson(addedIndex.files) !== migrationCanonicalJson([{ ...archived, originalPath: LEGACY_PROSPECTIVE_BASELINE_PATH }])) throw new Error("current_migration_portability_closure_changed");
  return { filesVerified: binding.files.length, formalRankingQualityClaim: false as const };
}
