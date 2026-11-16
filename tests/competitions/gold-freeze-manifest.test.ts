import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  QUALITY_BENCHMARK_NOW,
  competitionAnchorPersonas,
  competitionRankingHoldoutCases
} from "../fixtures/competition-quality-personas";
import { competitionGoldFreezeManifest } from "../fixtures/competition-gold-freeze-manifest";
import { staticCompetitionScoringGoldPairs } from "../fixtures/competition-scoring-gold";
import { staticCompetitionFollowupGoldCases } from "../fixtures/competition-followup-gold";
import { staticCompetitionPreferenceOracles } from "../fixtures/competition-preference-oracle";
import {
  LEGACY_V7_MIGRATED_TEST_FILES,
  LEGACY_V7_MIGRATION_ROOT,
  migrationCanonicalJson,
  migrationSha256,
  readMigrationJson,
  readCurrentLegacyMigrationBinding,
  readLegacyEvidenceBytes,
  legacyEvidencePath,
  currentMigrationSourcePath,
  verifyCurrentMigrationBinding,
  verifyLegacyOriginalBytes,
  type CurrentMigrationBinding
} from "../fixtures/v7-legacy-evidence";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function resolveLocalTypeScriptImport(importer: string, specifier: string) {
  const unresolved = path.normalize(path.join(path.dirname(importer), specifier));
  const candidates = [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    path.join(unresolved, "index.ts"),
    path.join(unresolved, "index.tsx")
  ];
  return candidates.find((candidate) => existsSync(path.join(process.cwd(), candidate))) ?? null;
}

describe("competition gold freeze manifest", () => {
  it("v7 preserves the failed historical freeze and rejects changes to its separately bound current verifiers", () => {
    const archive = verifyLegacyOriginalBytes();
    const originalFailure = archive.failures.find(failure => failure.fullName === "competition gold freeze manifest freezes the benchmark clock and every literal fixture source");
    expect(originalFailure?.status).toBe("failed");
    expect(originalFailure?.failureMessages.length).toBeGreaterThan(0);
    expect(QUALITY_BENCHMARK_NOW.toISOString()).toBe(
      competitionGoldFreezeManifest.benchmarkNowIso
    );
    for (const relativePath of competitionGoldFreezeManifest.authoredInputFiles) {
      const expectedHash = competitionGoldFreezeManifest.fileSha256[relativePath];
      const actualHash = sha256(readFileSync(currentMigrationSourcePath(process.cwd(), relativePath), "utf8"));
      expect(actualHash, relativePath).toBe(expectedHash);
    }
    const historical = readMigrationJson<{ goldFreezeStatus: string; goldFreezeMismatches: { path: string; expectedSha256: string; archivedActualSha256: string }[] }>("before/historical-integrity.json");
    const mismatches = Object.entries(competitionGoldFreezeManifest.fileSha256).flatMap(([relativePath, expectedHash]) => {
      const actualHash = migrationSha256(readLegacyEvidenceBytes(`${LEGACY_V7_MIGRATION_ROOT}/before/${relativePath}`));
      return actualHash === expectedHash ? [] : [{ path: relativePath, expectedSha256: expectedHash, archivedActualSha256: actualHash }];
    });
    expect(historical.goldFreezeStatus).toBe("failed_preserved");
    expect(mismatches).toEqual(historical.goldFreezeMismatches);
    expect(mismatches.length).toBeGreaterThan(0);
    expect(Object.keys(competitionGoldFreezeManifest.fileSha256).sort()).toEqual(
      [
        ...competitionGoldFreezeManifest.authoredInputFiles,
        ...competitionGoldFreezeManifest.verifierFiles,
        ...competitionGoldFreezeManifest.verifierDependencyFiles,
        ...competitionGoldFreezeManifest.toolchainFiles
      ].sort()
    );
    expect(competitionGoldFreezeManifest.authoredInputFiles).toEqual(
      expect.arrayContaining([
        "tests/fixtures/competition-quality-no-match-gold.ts",
        "tests/fixtures/competition-quality-year-gold.ts",
        "tests/fixtures/competition-free-text-samples.ts"
      ])
    );
    expect(competitionGoldFreezeManifest.verifierFiles).toContain(
      "tests/competitions/gold-freeze-manifest.test.ts"
    );
    expect(competitionGoldFreezeManifest.verifierFiles).toEqual(
      expect.arrayContaining([
        "tests/competitions/scoring-gold-audit.test.ts",
        "tests/competitions/followup-gold-audit.test.ts",
        "tests/competitions/quality-benchmark.test.ts",
        "tests/competitions/qualification-status-audit.test.ts",
        "tests/competitions/recommendation-quality.test.ts",
        "tests/competitions/strict-baseline-acceptance.test.ts",
        "tests/competitions/live-ranking-regression.test.ts",
        "tests/ai/competition-clarify-context.test.ts",
        "tests/ai/competition-clarify-route.test.ts",
        "tests/ai/competition-recommend-route.test.ts",
        "tests/ai/deepseek-live.test.ts"
      ])
    );
    expect(competitionGoldFreezeManifest.verifierDependencyFiles).toEqual([
      "tests/fixtures/deepseek-live-personas.ts",
      "tests/fixtures/competition-questionnaire-context.ts"
    ]);
    expect(competitionGoldFreezeManifest.toolchainFiles).toEqual([
      "package.json",
      "pnpm-lock.yaml",
      "vitest.config.ts",
      "tsconfig.json"
    ]);
    expect(competitionGoldFreezeManifest.externalRootBoundary).toEqual({
      algorithm: "sha256",
      manifestPath: "tests/fixtures/competition-gold-freeze-manifest.ts",
      storage: "external-release-record-required",
      repositoryCommitOrTag: null
    });
    expect(Object.keys(competitionGoldFreezeManifest.fileSha256)).not.toContain(
      competitionGoldFreezeManifest.externalRootBoundary.manifestPath
    );
    expect(competitionGoldFreezeManifest.evidenceDrivenSemanticMigrations.length)
      .toBeGreaterThanOrEqual(6);
    expect(competitionGoldFreezeManifest.goldMethodMigrations).toHaveLength(3);

    const binding = readCurrentLegacyMigrationBinding();
    expect(verifyCurrentMigrationBinding(process.cwd(), binding)).toEqual({ filesVerified: 7, formalRankingQualityClaim: false });
    const mirror = mkdtempSync(path.join(os.tmpdir(), "saitu-v7-current-verifier-binding-"));
    try {
      for (const file of [...binding.files, binding.migrationContract, ...binding.portability.files]) {
        const target = path.join(mirror, file.path);
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(currentMigrationSourcePath(process.cwd(), file.path), target);
      }
      expect(verifyCurrentMigrationBinding(mirror, binding).filesVerified).toBe(7);
      appendFileSync(path.join(mirror, "tests/competitions/legacy-v7-migration.fixture.ts"), "\n// changed after current applicability binding\n");
      expect(() => verifyCurrentMigrationBinding(mirror, binding)).toThrow("current_migration_source_bytes_changed");
      const forged = structuredClone(binding);
      forged.files[0].sha256 = "f".repeat(64);
      expect(() => verifyCurrentMigrationBinding(mirror, forged)).toThrow("current_migration_binding_changed");
      const incomplete = structuredClone(binding);
      incomplete.files.pop();
      const { bindingSha256: _oldHash, ...unsigned } = incomplete;
      incomplete.bindingSha256 = migrationSha256(migrationCanonicalJson(unsigned));
      expect(() => verifyCurrentMigrationBinding(mirror, incomplete)).toThrow("all_six_current_tests_and_helper_must_be_bound");
    } finally { rmSync(mirror, { recursive: true, force: true }); }
  });

  it("keeps every historical verifier dependency closed in its archived pre-migration snapshot", () => {
    const frozenTestFiles = new Set<string>([
      ...competitionGoldFreezeManifest.authoredInputFiles,
      ...competitionGoldFreezeManifest.verifierFiles,
      ...competitionGoldFreezeManifest.verifierDependencyFiles
    ]);
    const failures: string[] = [];
    for (const verifierFile of competitionGoldFreezeManifest.verifierFiles) {
      const historicalFile = (LEGACY_V7_MIGRATED_TEST_FILES as readonly string[]).includes(verifierFile)
        ? path.join(LEGACY_V7_MIGRATION_ROOT, "before", verifierFile) : verifierFile;
      const source = readFileSync(currentMigrationSourcePath(process.cwd(), historicalFile), "utf8");
      for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
        const specifier = match[1]!;
        if (!specifier.startsWith(".")) continue;
        const dependency = resolveLocalTypeScriptImport(verifierFile, specifier);
        if (
          dependency?.startsWith("tests/") &&
          dependency !== competitionGoldFreezeManifest.externalRootBoundary.manifestPath &&
          !frozenTestFiles.has(dependency)
        ) {
          failures.push(`${verifierFile} -> ${dependency}`);
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("freezes every V5 profile referenced by scoring, follow-up or preference gold", () => {
    const referencedIds = [...new Set([
      ...staticCompetitionScoringGoldPairs.map(({ personaId }) => personaId),
      ...staticCompetitionFollowupGoldCases.map(({ personaId }) => personaId),
      ...staticCompetitionPreferenceOracles.map(({ personaId }) => personaId)
    ])].sort();
    expect(Object.keys(competitionGoldFreezeManifest.profileSha256ByPersona).sort())
      .toEqual(referencedIds);

    const personas = new Map(
      [...competitionAnchorPersonas, ...competitionRankingHoldoutCases]
        .map((persona) => [persona.id, persona])
    );
    for (const personaId of referencedIds) {
      const persona = personas.get(personaId);
      expect(persona, personaId).toBeDefined();
      expect(persona?.profile.profileVersion, personaId).toBe("competition-profile.v5");
      const actualHash = sha256(JSON.stringify(canonicalize(persona!.profile)));
      const expectedHash = competitionGoldFreezeManifest.profileSha256ByPersona[
        personaId as keyof typeof competitionGoldFreezeManifest.profileSha256ByPersona
      ];
      expect(actualHash, personaId).toBe(expectedHash);
    }
  });
});

/** Supplemental trust checks; original historical drift remains failed in its archived result. */
describe("legacy policy advisory provenance (pending external approval)", () => {
  const fixturePath = "tests/fixtures/competition-legacy-policy-advisory-v1.json";
  const reviewRoot = "artifacts/continuation-20261105/legacy-blind-review";
  const advisory = JSON.parse(readFileSync(path.join(process.cwd(), fixturePath), "utf8")) as {
    schemaVersion: string; humanApproved: boolean; replacesHistoricalAcceptance: boolean;
    reviewLockSha256: string; reviewFileHashes: Record<string, string>; sourceHashes: Record<string, string>;
    candidateIds: string[]; taskLabels: Record<string, Record<string, number[]>>;
    unresolvedPersonalContributionCases: string[]; followupBranches: { caseId: string; selectedValues: string[] }[];
    historicalContract: Record<string, number>;
  };

  it("binds the independent AI review to the communicated lock without claiming human approval", () => {
    expect(advisory.schemaVersion).toBe("saitu.legacy-policy-advisory.v1");
    expect(advisory.humanApproved).toBe(false);
    expect(advisory.replacesHistoricalAcceptance).toBe(false);
    expect(advisory.reviewLockSha256).toBe("8958065fdf8d7e10a44df87a9d62a25ad94dd5508055c422a1cd6e66ed946379");
    expect(sha256(readLegacyEvidenceBytes(`${reviewRoot}/review-lock.json`).toString("utf8")))
      .toBe(advisory.reviewLockSha256);
    for (const [file, expected] of Object.entries(advisory.reviewFileHashes)) {
      expect(sha256(readLegacyEvidenceBytes(`${reviewRoot}/${file}`).toString("utf8")), file).toBe(expected);
    }
    for (const [file, expected] of Object.entries(advisory.sourceHashes)) {
      expect(sha256(readLegacyEvidenceBytes(`artifacts/v6/legacy-review-20261105/${file}`).toString("utf8")), file)
        .toBe(expected);
    }
  });

  it("covers every candidate in all 25 ranking, 18 legacy and 36 followup inputs before observing output", () => {
    const pool = JSON.parse(readLegacyEvidenceBytes("artifacts/v6/legacy-review-20261105/candidate-pool.json").toString("utf8")) as { catalog: { id: string }[] };
    expect(advisory.candidateIds).toEqual(pool.catalog.map(row => row.id));
    expect(new Set(advisory.candidateIds).size).toBe(135);
    for (const [kind, file, count] of [
      ["ranking", "ranking-full-pool.jsonl", 25],
      ["legacy", "legacy-v4-full-pool.jsonl", 18],
      ["followupBase", "followup-base-full-pool.jsonl", 36]
    ] as const) {
      const rows = readLegacyEvidenceBytes(`${reviewRoot}/${file}`).toString("utf8").trim().split("\n")
        .map(line => JSON.parse(line) as { caseId: string; candidateId: string; taskRelevance: number });
      expect(rows).toHaveLength(count * 135);
      expect(Object.keys(advisory.taskLabels[kind])).toHaveLength(count);
      for (const [caseId, labels] of Object.entries(advisory.taskLabels[kind])) {
        expect(labels, caseId).toHaveLength(135);
        expect(labels.every(value => Number.isInteger(value) && value >= 0 && value <= 3), caseId).toBe(true);
        const caseRows = rows.filter(row => row.caseId === caseId);
        expect(new Set(caseRows.map(row => row.candidateId)).size, caseId).toBe(135);
        expect(labels, caseId).toEqual(advisory.candidateIds.map(id => caseRows.find(row => row.candidateId === id)!.taskRelevance));
      }
    }
  });

  it("keeps all original obligations and all 96 contribution gaps explicit", () => {
    expect(advisory.historicalContract).toEqual({ scoringPairs: 96, labelDerivedRelations: 104,
      numericIntervalPassRate: 0.9, relationPassRate: 1, literalRationaleSamples: 40 });
    expect(advisory.unresolvedPersonalContributionCases.sort())
      .toEqual(staticCompetitionScoringGoldPairs.map(row => row.id).sort());
    expect(advisory.followupBranches).toHaveLength(75);
    expect(advisory.followupBranches.map(row => `${row.caseId}:${row.selectedValues.join("+")}`).sort())
      .toEqual(staticCompetitionFollowupGoldCases.flatMap(row => row.branches.map(branch =>
        `${row.id}:${branch.selectedValues.join("+")}`)).sort());
  });
});

describe("legacy migration preserves old byte evidence", () => {
  it("keeps the old manifest, gold bytes and original failed run available for independent replay", () => {
    const root = "artifacts/continuation-20261105/legacy-migration";
    const lock = JSON.parse(readLegacyEvidenceBytes(`${root}/before-lock.json`).toString("utf8")) as {
      externalApproval: boolean; fileSha256: Record<string, string>;
    };
    expect(lock.externalApproval).toBe(false);
    for (const [file, expected] of Object.entries(lock.fileSha256)) {
      expect(sha256(readLegacyEvidenceBytes(`${root}/before/${file}`).toString("utf8")), file).toBe(expected);
    }
    for (const file of [...competitionGoldFreezeManifest.authoredInputFiles,
      "tests/fixtures/competition-gold-freeze-manifest.ts"]) {
      expect(sha256(readFileSync(currentMigrationSourcePath(process.cwd(), file), "utf8")), file).toBe(lock.fileSha256[file]);
    }
    const original = JSON.parse(readLegacyEvidenceBytes(`${root}/before/artifacts/continuation-20261105/full-vitest-01.json`).toString("utf8")) as {
      numFailedTests: number; numPassedTests: number;
    };
    expect(original.numFailedTests).toBe(14);
    expect(original.numPassedTests).toBe(1207);
  });

  it("rejects altered opaque legacy bytes and unknown/private logical paths without using workspace artifacts", () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "saitu-legacy-byte-integrity-"));
    const original = `${LEGACY_V7_MIGRATION_ROOT}/migration-contract.json`;
    try {
      const index = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/v7-legacy-evidence/index.json"), "utf8")) as { schemaVersion: string; files: { originalPath: string; fixturePath: string; bytes: number; sha256: string }[] };
      const row = index.files.find(file => file.originalPath === original)!;
      mkdirSync(path.join(fixture, "opaque"));
      copyFileSync(path.join(process.cwd(), "tests/fixtures/v7-legacy-evidence/index.json"), path.join(fixture, "index.json"));
      copyFileSync(legacyEvidencePath(original), path.join(fixture, row.fixturePath));
      expect(readLegacyEvidenceBytes(original, fixture)).toEqual(readLegacyEvidenceBytes(original));
      appendFileSync(path.join(fixture, row.fixturePath), "changed-byte");
      expect(() => readLegacyEvidenceBytes(original, fixture)).toThrow("legacy_evidence_bytes_changed");
      expect(() => readLegacyEvidenceBytes("artifacts/continuation-v7-20261109/evaluation/private/unknown.json", fixture)).toThrow("unknown_legacy_evidence_path");
      expect(() => readLegacyEvidenceBytes(`${LEGACY_V7_MIGRATION_ROOT}/../unknown.json`, fixture)).toThrow("unknown_legacy_evidence_path");
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });

  it("returns the same opaque bytes that passed verification without a second unverified read", () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "saitu-legacy-single-read-"));
    const original = `${LEGACY_V7_MIGRATION_ROOT}/migration-contract.json`;
    const originalRead = fs.readFileSync;
    let blobReads = 0;
    try {
      const index = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/v7-legacy-evidence/index.json"), "utf8")) as { files: { originalPath: string; fixturePath: string; sha256: string }[] };
      const row = index.files.find(file => file.originalPath === original)!;
      mkdirSync(path.join(fixture, "opaque"));
      copyFileSync(path.join(process.cwd(), "tests/fixtures/v7-legacy-evidence/index.json"), path.join(fixture, "index.json"));
      copyFileSync(legacyEvidencePath(original), path.join(fixture, row.fixturePath));
      const blob = path.join(fixture, row.fixturePath);
      fs.readFileSync = ((filename: unknown, ...args: unknown[]) => {
        if (path.resolve(String(filename)) === path.resolve(blob) && ++blobReads === 2) appendFileSync(blob, "changed-after-verification");
        return (originalRead as (...values: unknown[]) => ReturnType<typeof originalRead>).call(fs, filename, ...args);
      }) as typeof fs.readFileSync;
      syncBuiltinESMExports();
      const verified = readLegacyEvidenceBytes(original, fixture);
      expect(blobReads).toBe(1);
      expect(migrationSha256(verified)).toBe(row.sha256);
    } finally { fs.readFileSync = originalRead; syncBuiltinESMExports(); rmSync(fixture, { recursive: true, force: true }); }
  });
});
