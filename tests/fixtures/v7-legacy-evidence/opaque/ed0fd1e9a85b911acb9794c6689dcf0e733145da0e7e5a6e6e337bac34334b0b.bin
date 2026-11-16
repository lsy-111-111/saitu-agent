import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMPETITION_CATALOG_VERSION, getCompetitionCatalog } from "@/lib/competitions/catalog";
import {
  calibrateCompetitionScore,
  getCompetitionRecommendationCandidates,
  recommendCompetitions
} from "@/lib/competitions/recommendation-engine";
import { projectLegacyCompetitionPreferenceTranscript } from "@/lib/competitions/legacy-preference-adapter";
import { COMPETITION_SCORER_VERSION, scoreCompetition } from "@/lib/competitions/scoring";
import { COMPETITION_QUESTIONNAIRE_VERSION } from "@/types/competition-recommendation";
import {
  QUALITY_BENCHMARK_NOW,
  competitionAnchorPersonas,
  competitionRankingHoldoutCases
} from "../fixtures/competition-quality-personas";

const IMPLEMENTATION_STARTED_AT = "2026-08-24T14:51:22.643Z";
const HISTORICAL_ARTIFACT_PATH = path.join(
  process.cwd(),
  "tests/fixtures/competition-score-baseline-v11.json"
);
const LIMITATION_PATH = path.join(
  process.cwd(),
  "tests/fixtures/competition-historical-baseline-limitation.json"
);
const PROSPECTIVE_ARTIFACT_PATH = path.join(
  process.cwd(),
  "tests/fixtures/competition-score-prospective-baseline.json"
);
const CAPTURE_REQUESTED = process.env.CAPTURE_COMPETITION_PROSPECTIVE_BASELINE === "1";

const SOURCE_FILES = [
  "src/content/competition-expansion.ts",
  "src/content/competition-guide.ts",
  "src/content/competition-taxonomy.ts",
  "src/content/competitions.ts",
  "src/lib/competitions/availability.ts",
  "src/lib/competitions/catalog.ts",
  "src/lib/competitions/legacy-preference-adapter.ts",
  "src/lib/competitions/recommendation-engine.ts",
  "src/lib/competitions/scoring.ts",
  "src/types/competition-recommendation.ts"
] as const;

const DATASET_FILES = [
  "tests/fixtures/competition-quality-anchors-1.ts",
  "tests/fixtures/competition-quality-anchors-2.ts",
  "tests/fixtures/competition-quality-anchors-3.ts",
  "tests/fixtures/competition-quality-anchors-4.ts",
  "tests/fixtures/competition-quality-negative-gold.ts",
  "tests/fixtures/competition-quality-no-match-gold.ts",
  "tests/fixtures/competition-quality-personas.ts",
  "tests/fixtures/competition-quality-ranking-gold.ts",
  "tests/fixtures/competition-quality-year-gold.ts"
] as const;

type BaselineDataset = "anchor" | "holdout";

type ContentAddress = {
  path: string;
  sha256: string;
};

type ProspectiveResult = {
  dataset: BaselineDataset;
  personaId: string;
  inputSha256: string;
  fixedCompetitionId: string;
  fixedCompetitionDisplayedScore: number;
  top10: string[];
  finalTop3: string[];
};

type ProspectiveBaseline = {
  schemaVersion: "competition-score-prospective-baseline.v1";
  capturedAt: string;
  captureIntent: "forward-regression-denominator-only";
  historicalComparisonAllowed: false;
  captureCommand: string;
  provenance: {
    kind: "dirty-working-tree-content-addressed";
    scope: "competition-scorer-and-benchmark-inputs";
    releaseId: string | null;
    sourceArchiveSha256: string | null;
    releaseBindingContract: {
      sourceArchiveMembership: "excluded-to-avoid-self-reference";
      bundleSidecarPath: "baseline/competition-score-prospective-baseline.json";
      installPath: "tests/fixtures/competition-score-prospective-baseline.json";
      installationOrder: "copy-before-pnpm-test";
      checksumManifest: "SHA256SUMS";
    };
  };
  versions: {
    scorer: string;
    catalog: string;
    questionnaire: string;
  };
  benchmarkNow: string;
  sourceSnapshot: {
    algorithm: "sha256";
    files: ContentAddress[];
    snapshotSha256: string;
  };
  datasets: {
    algorithm: "sha256";
    files: ContentAddress[];
    snapshotSha256: string;
    anchorCaseCount: number;
    holdoutCaseCount: number;
  };
  results: ProspectiveResult[];
  aggregates: {
    anchorFixedPairMean: number;
    holdoutFixedPairMean: number;
  };
  resultsSha256: string;
  artifactSha256: string;
};

type HistoricalLimitation = {
  schemaVersion: "competition-historical-baseline-limitation.v1";
  recordedAt: string;
  implementationStartedAt: string;
  missingArtifactPath: string;
  claim: {
    fromScorer: "deterministic-2026-08.v11";
    expectedAverageUpliftPoints: [12, 15];
    status: "unprovable";
    reason: string;
  };
  evidencePolicy: {
    retrospectiveReconstruction: "prohibited";
    backdating: "prohibited";
    currentReleaseEffect: "historical-claim-not-a-release-gate";
    replacementGate: "competition-score-prospective-baseline.v1";
  };
};

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function assertSha256(value: string, label: string) {
  expect(value, label).toMatch(/^[a-f0-9]{64}$/);
}

function addressFiles(files: readonly string[]): ContentAddress[] {
  return [...files]
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => ({
      path: filePath,
      sha256: sha256(readFileSync(path.join(process.cwd(), filePath)))
    }));
}

function snapshotSha256(files: readonly ContentAddress[]) {
  return sha256(canonicalJson([...files].sort((left, right) => left.path.localeCompare(right.path))));
}

function currentResults(): ProspectiveResult[] {
  const catalog = getCompetitionCatalog();
  const catalogById = new Map(catalog.map((competition) => [competition.id, competition]));
  const cases = [
    ...competitionAnchorPersonas.map((persona) => ({
      dataset: "anchor" as const,
      persona,
      fixedCompetitionId: persona.expectedId
    })),
    ...competitionRankingHoldoutCases.map((persona) => ({
      dataset: "holdout" as const,
      persona,
      fixedCompetitionId: persona.labels
        .filter(({ relevance }) => relevance === 2)
        .map(({ competitionId }) => competitionId)
        .sort((left, right) => left.localeCompare(right))[0] ?? ""
    }))
  ];

  return cases.map(({ dataset, persona, fixedCompetitionId }) => {
    if (!fixedCompetitionId) throw new Error(`${dataset}:${persona.id} has no fixed relevance-2 pair`);
    const competition = catalogById.get(fixedCompetitionId);
    if (!competition) throw new Error(`${dataset}:${persona.id} has unknown competition ${fixedCompetitionId}`);
    const transcript = projectLegacyCompetitionPreferenceTranscript(persona.transcript);
    const scored = scoreCompetition(competition, persona.profile, QUALITY_BENCHMARK_NOW, transcript);
    if (!scored) throw new Error(`${dataset}:${persona.id} fixed pair is no longer scoreable`);
    const top10 = getCompetitionRecommendationCandidates(persona.profile, {
      catalog,
      now: QUALITY_BENCHMARK_NOW,
      transcript
    }).recommendations.map(({ competitionId }) => competitionId);
    const finalTop3 = recommendCompetitions(persona.profile, {
      catalog,
      now: QUALITY_BENCHMARK_NOW,
      transcript
    }).recommendations.map(({ competitionId }) => competitionId);
    if (top10.length !== 10) throw new Error(`${dataset}:${persona.id} produced ${top10.length} Top10 entries`);
    if (finalTop3.length !== 3) throw new Error(`${dataset}:${persona.id} produced ${finalTop3.length} Top3 entries`);
    return {
      dataset,
      personaId: persona.id,
      inputSha256: sha256(canonicalJson({ profile: persona.profile, transcript: persona.transcript })),
      fixedCompetitionId,
      fixedCompetitionDisplayedScore: calibrateCompetitionScore(persona.profile, scored).matchScore,
      top10,
      finalTop3
    };
  });
}

function buildProspectiveBaseline(): ProspectiveBaseline {
  const sourceFiles = addressFiles(SOURCE_FILES);
  const datasetFiles = addressFiles(DATASET_FILES);
  const results = currentResults();
  const anchorScores = results
    .filter(({ dataset }) => dataset === "anchor")
    .map(({ fixedCompetitionDisplayedScore }) => fixedCompetitionDisplayedScore);
  const holdoutScores = results
    .filter(({ dataset }) => dataset === "holdout")
    .map(({ fixedCompetitionDisplayedScore }) => fixedCompetitionDisplayedScore);
  const releaseId = process.env.PROSPECTIVE_BASELINE_RELEASE_ID?.trim() || null;
  const sourceArchiveSha256 = process.env.PROSPECTIVE_BASELINE_SOURCE_ARCHIVE_SHA256?.trim() || null;
  if (sourceArchiveSha256 && !/^[a-f0-9]{64}$/.test(sourceArchiveSha256)) {
    throw new Error("PROSPECTIVE_BASELINE_SOURCE_ARCHIVE_SHA256 must be a lowercase SHA-256");
  }
  const withoutArtifactHash = {
    schemaVersion: "competition-score-prospective-baseline.v1" as const,
    capturedAt: new Date().toISOString(),
    captureIntent: "forward-regression-denominator-only" as const,
    historicalComparisonAllowed: false as const,
    captureCommand: "node scripts/capture-competition-prospective-baseline.mjs",
    provenance: {
      kind: "dirty-working-tree-content-addressed" as const,
      scope: "competition-scorer-and-benchmark-inputs" as const,
      releaseId,
      sourceArchiveSha256,
      releaseBindingContract: {
        sourceArchiveMembership: "excluded-to-avoid-self-reference" as const,
        bundleSidecarPath: "baseline/competition-score-prospective-baseline.json" as const,
        installPath: "tests/fixtures/competition-score-prospective-baseline.json" as const,
        installationOrder: "copy-before-pnpm-test" as const,
        checksumManifest: "SHA256SUMS" as const
      }
    },
    versions: {
      scorer: COMPETITION_SCORER_VERSION,
      catalog: COMPETITION_CATALOG_VERSION,
      questionnaire: COMPETITION_QUESTIONNAIRE_VERSION
    },
    benchmarkNow: QUALITY_BENCHMARK_NOW.toISOString(),
    sourceSnapshot: {
      algorithm: "sha256" as const,
      files: sourceFiles,
      snapshotSha256: snapshotSha256(sourceFiles)
    },
    datasets: {
      algorithm: "sha256" as const,
      files: datasetFiles,
      snapshotSha256: snapshotSha256(datasetFiles),
      anchorCaseCount: competitionAnchorPersonas.length,
      holdoutCaseCount: competitionRankingHoldoutCases.length
    },
    results,
    aggregates: {
      anchorFixedPairMean: mean(anchorScores),
      holdoutFixedPairMean: mean(holdoutScores)
    },
    resultsSha256: sha256(canonicalJson(results))
  };
  return {
    ...withoutArtifactHash,
    artifactSha256: sha256(canonicalJson(withoutArtifactHash))
  };
}

function captureProspectiveBaseline() {
  const artifact = buildProspectiveBaseline();
  mkdirSync(path.dirname(PROSPECTIVE_ARTIFACT_PATH), { recursive: true });
  writeFileSync(PROSPECTIVE_ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

describe.sequential("honest scoring baseline policy", () => {
  it("records that the pre-v12 uplift claim cannot be proved or reconstructed", () => {
    expect(existsSync(HISTORICAL_ARTIFACT_PATH),
      "A newly supplied historical artifact requires independent provenance review; do not silently replace the limitation record")
      .toBe(false);
    expect(existsSync(LIMITATION_PATH)).toBe(true);
    const limitation = JSON.parse(readFileSync(LIMITATION_PATH, "utf8")) as HistoricalLimitation;
    expect(limitation.schemaVersion).toBe("competition-historical-baseline-limitation.v1");
    expect(limitation.implementationStartedAt).toBe(IMPLEMENTATION_STARTED_AT);
    expect(Date.parse(limitation.recordedAt)).toBeGreaterThan(Date.parse(IMPLEMENTATION_STARTED_AT));
    expect(limitation.missingArtifactPath).toBe("tests/fixtures/competition-score-baseline-v11.json");
    expect(limitation.claim).toMatchObject({
      fromScorer: "deterministic-2026-08.v11",
      expectedAverageUpliftPoints: [12, 15],
      status: "unprovable"
    });
    expect(limitation.claim.reason).toContain("before 2026-08-24T14:51:22.643Z is missing");
    expect(limitation.evidencePolicy).toEqual({
      retrospectiveReconstruction: "prohibited",
      backdating: "prohibited",
      currentReleaseEffect: "historical-claim-not-a-release-gate",
      replacementGate: "competition-score-prospective-baseline.v1"
    });
  });

  it("captures only when explicitly requested, then verifies the prospective baseline byte-for-byte", () => {
    if (CAPTURE_REQUESTED) captureProspectiveBaseline();
    expect(existsSync(PROSPECTIVE_ARTIFACT_PATH),
      "Prospective baseline missing. Run: node scripts/capture-competition-prospective-baseline.mjs")
      .toBe(true);

    const artifact = JSON.parse(readFileSync(PROSPECTIVE_ARTIFACT_PATH, "utf8")) as ProspectiveBaseline;
    expect(artifact.schemaVersion).toBe("competition-score-prospective-baseline.v1");
    expect(artifact.captureIntent).toBe("forward-regression-denominator-only");
    expect(artifact.historicalComparisonAllowed).toBe(false);
    expect(Number.isFinite(Date.parse(artifact.capturedAt))).toBe(true);
    expect(Date.parse(artifact.capturedAt)).toBeGreaterThan(Date.parse(IMPLEMENTATION_STARTED_AT));
    expect(artifact.captureCommand).toBe("node scripts/capture-competition-prospective-baseline.mjs");
    expect(artifact.provenance.kind).toBe("dirty-working-tree-content-addressed");
    expect(artifact.provenance.scope).toBe("competition-scorer-and-benchmark-inputs");
    expect(artifact.provenance.releaseBindingContract).toEqual({
      sourceArchiveMembership: "excluded-to-avoid-self-reference",
      bundleSidecarPath: "baseline/competition-score-prospective-baseline.json",
      installPath: "tests/fixtures/competition-score-prospective-baseline.json",
      installationOrder: "copy-before-pnpm-test",
      checksumManifest: "SHA256SUMS"
    });
    if (artifact.provenance.sourceArchiveSha256 !== null) {
      assertSha256(artifact.provenance.sourceArchiveSha256, "source archive");
      expect(artifact.provenance.releaseId?.trim().length).toBeGreaterThan(0);
    }
    expect(artifact.versions).toEqual({
      scorer: COMPETITION_SCORER_VERSION,
      catalog: COMPETITION_CATALOG_VERSION,
      questionnaire: COMPETITION_QUESTIONNAIRE_VERSION
    });
    expect(artifact.benchmarkNow).toBe(QUALITY_BENCHMARK_NOW.toISOString());

    const expectedSourceFiles = addressFiles(SOURCE_FILES);
    const expectedDatasetFiles = addressFiles(DATASET_FILES);
    expect(artifact.sourceSnapshot).toEqual({
      algorithm: "sha256",
      files: expectedSourceFiles,
      snapshotSha256: snapshotSha256(expectedSourceFiles)
    });
    expect(artifact.datasets).toEqual({
      algorithm: "sha256",
      files: expectedDatasetFiles,
      snapshotSha256: snapshotSha256(expectedDatasetFiles),
      anchorCaseCount: 100,
      holdoutCaseCount: 25
    });
    for (const content of [...artifact.sourceSnapshot.files, ...artifact.datasets.files]) {
      assertSha256(content.sha256, content.path);
    }

    const expectedResults = currentResults();
    expect(artifact.results).toEqual(expectedResults);
    expect(artifact.results).toHaveLength(125);
    expect(new Set(artifact.results.map(({ personaId }) => personaId)).size).toBe(125);
    expect(artifact.resultsSha256).toBe(sha256(canonicalJson(expectedResults)));
    for (const result of artifact.results) {
      assertSha256(result.inputSha256, `${result.dataset}:${result.personaId}`);
      expect(result.top10).toHaveLength(10);
      expect(new Set(result.top10).size).toBe(10);
      expect(result.finalTop3).toHaveLength(3);
      expect(new Set(result.finalTop3).size).toBe(3);
      expect(result.finalTop3.every((competitionId) => result.top10.includes(competitionId))).toBe(true);
      expect(result.fixedCompetitionDisplayedScore).toBeGreaterThanOrEqual(0);
      expect(result.fixedCompetitionDisplayedScore).toBeLessThanOrEqual(100);
    }

    const anchorScores = expectedResults
      .filter(({ dataset }) => dataset === "anchor")
      .map(({ fixedCompetitionDisplayedScore }) => fixedCompetitionDisplayedScore);
    const holdoutScores = expectedResults
      .filter(({ dataset }) => dataset === "holdout")
      .map(({ fixedCompetitionDisplayedScore }) => fixedCompetitionDisplayedScore);
    expect(artifact.aggregates.anchorFixedPairMean).toBeCloseTo(mean(anchorScores), 12);
    expect(artifact.aggregates.holdoutFixedPairMean).toBeCloseTo(mean(holdoutScores), 12);

    const { artifactSha256, ...withoutArtifactHash } = artifact;
    assertSha256(artifactSha256, "canonical artifact");
    expect(artifactSha256).toBe(sha256(canonicalJson(withoutArtifactHash)));
  });
});
