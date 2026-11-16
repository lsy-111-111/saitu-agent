import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
  it("freezes the benchmark clock and every literal fixture source", () => {
    expect(QUALITY_BENCHMARK_NOW.toISOString()).toBe(
      competitionGoldFreezeManifest.benchmarkNowIso
    );
    for (const [relativePath, expectedHash] of Object.entries(
      competitionGoldFreezeManifest.fileSha256
    )) {
      const actualHash = sha256(readFileSync(path.join(process.cwd(), relativePath), "utf8"));
      expect(actualHash, relativePath).toBe(expectedHash);
    }
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
  });

  it("freezes every direct tests/ dependency imported by a listed verifier", () => {
    const frozenTestFiles = new Set<string>([
      ...competitionGoldFreezeManifest.authoredInputFiles,
      ...competitionGoldFreezeManifest.verifierFiles,
      ...competitionGoldFreezeManifest.verifierDependencyFiles
    ]);
    const failures: string[] = [];
    for (const verifierFile of competitionGoldFreezeManifest.verifierFiles) {
      const source = readFileSync(path.join(process.cwd(), verifierFile), "utf8");
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
