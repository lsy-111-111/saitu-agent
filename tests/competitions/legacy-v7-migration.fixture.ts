import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AiJsonResult } from "@/lib/ai/ai-client";
import type { DecisionCompetitionRecord } from "@/lib/competitions/v6/catalog-types";
import type { DecisionContextV6 } from "@/lib/competitions/v6/engine";
import type { MatchPlanV6, StudentProfileV6 } from "@/lib/competitions/v6/contracts";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { isDecisionEvidenceFact } from "@/lib/competitions/v6/evidence";
import { RECOMMENDATION_POLICY_VERSION, RECOMMENDATION_RESPONSE_VERSION } from "@/lib/competitions/v7/contracts";
import { buildDecisionContextV7, rankDecisionV7 } from "@/lib/competitions/v7/model";
import type { CompetitionRecommendationProfileV5 } from "@/types/competition-recommendation";
import { student, syntheticRecord } from "./v6/decision-fixtures";

/** Contract fixtures only. Injected responses never establish formal ranking quality. */
export const LEGACY_V7_MIGRATION_ROOT = "artifacts/continuation-v7-20261109/legacy-test-migration";
export const LEGACY_V7_MIGRATED_TEST_FILES = [
  "tests/competitions/followup-gold-audit.test.ts",
  "tests/competitions/gold-freeze-manifest.test.ts",
  "tests/competitions/quality-benchmark.test.ts",
  "tests/competitions/recommendation-quality.test.ts",
  "tests/competitions/scoring-gold-audit.test.ts",
  "tests/competitions/strict-baseline-acceptance.test.ts",
] as const;
export const LEGACY_V7_CURRENT_FILES = [
  ...LEGACY_V7_MIGRATED_TEST_FILES,
  "tests/competitions/legacy-v7-migration.fixture.ts",
].sort();

export const migrationStudent = student;
export const migrationRecords = (count = 12): DecisionCompetitionRecord[] => Array.from({ length: count }, (_, index) => syntheticRecord(index + 1));
export function migrationContext(profile: CompetitionRecommendationProfileV5 = student(), records = migrationRecords()) {
  return buildDecisionContextV7(profile, { records, now: new Date("2026-11-09T00:00:00.000Z") });
}
export const migrationSuccess = (data: unknown): AiJsonResult<unknown> => ({ ok: true, data, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, attempts: 1, durationMs: 1, finishReason: "stop" });
export function migrationRankOutput(context: DecisionContextV6, itemIds: string[], shortfallReason: string | null = itemIds.length < 10 ? "其余候选没有本轮需要的任务差异，保留真实缺额。" : null) {
  return { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
    recommendations: itemIds.map(itemId => ({ itemId, rationale: "按本轮任务取舍保留的方向。", studentFactIds: [], competitionFactIds: [] })), shortfallReason };
}
export function migrationExplanation(context: DecisionContextV6, itemIds: string[]): MatchPlanV6 {
  return { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
    recommendations: itemIds.map(itemId => {
      const record = context.candidates.find(candidate => candidate.record.recordId === itemId)!.record;
      const fact = record.facts.find(fact => isDecisionEvidenceFact(record, fact))!;
      if (!fact) throw new Error("migration_fixture_requires_actual_task_evidence");
      return { itemId, reasons: [{ text: fact.text, basis: "official" as const, studentFactIds: [], competitionFactIds: [fact.id], conditions: [] }] };
    }), shortfallReason: migrationRankOutput(context, itemIds).shortfallReason };
}
export type MigrationRankPacket = {
  candidates: { itemId: string; seriesId: string; [key: string]: unknown }[];
  profile: StudentProfileV6;
  profileRevision: string;
  catalogVersion: string;
  instruction: string;
};
function migrationCodec(context: DecisionContextV6) {
  return createModelIdentifierCodec({ candidates: context.candidates.map(candidate => candidate.record.recordId),
    series: context.candidates.map(candidate => candidate.record.seriesId), facts: context.candidates.flatMap(candidate => candidate.record.facts.map(fact => fact.id)), students: context.profile.facts.map(fact => fact.id) });
}
export function decodeMigrationRankPacket(prompt: string, context: DecisionContextV6): MigrationRankPacket {
  return migrationCodec(context).decode(expandCandidateEvidence(expandMatchingTables(JSON.parse(prompt)))) as MigrationRankPacket;
}
export async function rankMigrationContext(context: DecisionContextV6, itemIds: string[], shortfallReason = migrationRankOutput(context, itemIds).shortfallReason) {
  const packets: MigrationRankPacket[] = [];
  const calls: { operation: string | undefined; effort: string | undefined; maxAttempts: number | undefined }[] = [];
  const plan = await rankDecisionV7(context, { requestId: "legacy-v7-contract-migration", modelCall: async (prompt, options) => {
    packets.push(decodeMigrationRankPacket(prompt, context));
    calls.push({ operation: options.operation, effort: options.reasoningEffort, maxAttempts: options.maxAttempts });
    return migrationSuccess(migrationCodec(context).encode(migrationRankOutput(context, itemIds, shortfallReason)));
  } });
  return { plan, packets, calls };
}

export function migrationSha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function migrationCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(migrationCanonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${migrationCanonicalJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function readMigrationJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), LEGACY_V7_MIGRATION_ROOT, relativePath), "utf8")) as T;
}
export type MigrationOriginalFailure = { file: string; fullName: string; status: string; failureMessages: string[] };
export type MigrationFailureArchive = { sourceReport: string; sourceReportSha256: string; failedCount: number; failures: MigrationOriginalFailure[] };
export function verifyLegacyOriginalBytes() {
  const before = path.join(process.cwd(), LEGACY_V7_MIGRATION_ROOT, "before");
  const contract = readMigrationJson<{ archivalEvidence: Record<string, string> }>("migration-contract.json");
  for (const [relativePath, expected] of Object.entries(contract.archivalEvidence)) {
    if (migrationSha256(readFileSync(path.join(before, relativePath))) !== expected) throw new Error(`historical_archive_binding_changed:${relativePath}`);
  }
  for (const lockPath of ["before-lock.json", "historical-evidence-lock.json", "historical-scope-lock.json"]) {
    const lock = readMigrationJson<{ fileSha256: Record<string, string> }>(`before/${lockPath}`);
    for (const [relativePath, expected] of Object.entries(lock.fileSha256)) {
      if (migrationSha256(readFileSync(path.join(before, relativePath))) !== expected) throw new Error(`historical_original_bytes_changed:${relativePath}`);
    }
  }
  const archive = readMigrationJson<MigrationFailureArchive>("before/original-failures.json");
  if (migrationSha256(readFileSync(path.join(before, archive.sourceReport))) !== archive.sourceReportSha256) throw new Error("original_failure_report_binding_changed");
  const source = JSON.parse(readFileSync(path.join(before, archive.sourceReport), "utf8")) as {
    testResults: { name: string; assertionResults: Omit<MigrationOriginalFailure, "file">[] }[];
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
    if (migrationSha256(readFileSync(path.join(process.cwd(), relativePath))) !== expected) throw new Error(`historical_fixture_was_rewritten:${relativePath}`);
  }
  return archive;
}
export type CurrentMigrationBinding = {
  schemaVersion: string;
  policyVersion: string;
  responseVersion: string;
  evidenceScope: string;
  files: { path: string; sha256: string }[];
  migrationContract: { path: string; sha256: string };
  bindingSha256: string;
};
export function verifyCurrentMigrationBinding(repositoryRoot = process.cwd(), binding = readMigrationJson<CurrentMigrationBinding>("current-test-binding.json")) {
  const { bindingSha256, ...unsigned } = binding;
  if (binding.schemaVersion !== "saitu.legacy-test-applicability-binding.v7.1" || binding.policyVersion !== RECOMMENDATION_POLICY_VERSION || binding.responseVersion !== RECOMMENDATION_RESPONSE_VERSION ||
      binding.evidenceScope !== "current-v7-contract-unit-checks-only" || binding.migrationContract.path !== `${LEGACY_V7_MIGRATION_ROOT}/migration-contract.json` ||
      migrationSha256(migrationCanonicalJson(unsigned)) !== bindingSha256) throw new Error("current_migration_binding_changed");
  if (JSON.stringify(binding.files.map(file => file.path).sort()) !== JSON.stringify(LEGACY_V7_CURRENT_FILES)) throw new Error("all_six_current_tests_and_helper_must_be_bound");
  for (const file of [...binding.files, binding.migrationContract]) {
    if (migrationSha256(readFileSync(path.join(repositoryRoot, file.path))) !== file.sha256) throw new Error(`current_migration_source_bytes_changed:${file.path}`);
  }
  return { filesVerified: binding.files.length, formalRankingQualityClaim: false as const };
}
