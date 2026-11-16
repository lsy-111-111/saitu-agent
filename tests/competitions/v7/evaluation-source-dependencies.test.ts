import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyCaseSourceDependencies } from "../../../scripts/competitions/v7/evaluation-source-dependencies.mjs";
import { loadScoringOriginals } from "../../../scripts/competitions/v7/evaluation-originals.mjs";
import { byteHash, canonicalHash, POLICY_VERSION, POLICY_SHA256 } from "../../../scripts/competitions/v7/evaluation-policy.mjs";

const policy = { policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256 };
async function fixture(absolute = false, absoluteDirectory = "raw") {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "saitu-case-source-")));
  await mkdir(path.join(root, "private/sources"), { recursive: true }); await mkdir(path.join(root, "raw"));
  const ref = async (member: string, value: any) => { await writeFile(path.join(root, member), JSON.stringify(value)); return { path: member, sha256: byteHash(await readFile(path.join(root, member))) }; };
  await writeFile(path.join(root, "private/sources/common.txt"), "public-source-common"); await writeFile(path.join(root, "raw/common.txt"), "public-source-common");
  await writeFile(path.join(root, "raw/secondary.txt"), "public-source-secondary");
  if (absolute && absoluteDirectory !== "raw") {
    await mkdir(path.join(root, absoluteDirectory), { recursive: true });
    await writeFile(path.join(root, absoluteDirectory, "secondary.txt"), "public-source-secondary");
  }
  const nonrankingSource = { sourceId: "common", bodyArtifact: "sources/common.txt", bodySha256: byteHash("public-source-common"), rawSourceArtifact: "raw/common.txt", rawSourceSha256: byteHash("public-source-common") };
  const secondaryMember = absolute ? `${absoluteDirectory}/secondary.txt` : "raw/secondary.txt";
  const secondaryRef = { path: absolute ? path.join(root, secondaryMember) : secondaryMember, sha256: byteHash("public-source-secondary") };
  const rankingSource = { sourceId: "secondary", raw: secondaryRef, body: secondaryRef };
  const nonranking = { schemaVersion: "saitu.challenge-source-snapshot.v7.1", sources: [nonrankingSource] };
  const ranking = { schemaVersion: "saitu.ranking-source-snapshot.v7.1", ...policy, catalogSha256: canonicalHash("catalog"), sources: [rankingSource] };
  const components = [{ id: "nonranking", canonicalSha256: canonicalHash(nonranking.sources), manifest: await ref("nonranking.json", nonranking) },
    { id: "ranking", canonicalSha256: canonicalHash(ranking), manifest: await ref("ranking.json", ranking) }];
  const cases = [{ caseId: "hard", layer: "hard_constraints", inputSha256: canonicalHash("hard-input"), answerSha256: canonicalHash("hard-key"), sourceSnapshotSha256: components[0].canonicalSha256, sourceEvidenceIds: ["common", "secondary"] },
    { caseId: "rank", layer: "ranking", inputSha256: canonicalHash("rank-input"), answerSha256: canonicalHash("rank-key"), sourceSnapshotSha256: components[1].canonicalSha256, sourceEvidenceIds: ["secondary"] }];
  const originalCaseMetadata = await ref("metadata.json", { ...policy, cases });
  const commonBinding = { sourceId: "common", componentId: "nonranking", componentSha256: components[0].canonicalSha256, sourceRecordSha256: canonicalHash(nonrankingSource), raw: { path: "raw/common.txt", sha256: nonrankingSource.rawSourceSha256 }, body: { path: "private/sources/common.txt", sha256: nonrankingSource.bodySha256 } };
  const secondaryBinding = { sourceId: "secondary", componentId: "ranking", componentSha256: components[1].canonicalSha256, sourceRecordSha256: canonicalHash(rankingSource), raw: { path: secondaryMember, sha256: secondaryRef.sha256 }, body: { path: secondaryMember, sha256: secondaryRef.sha256 } };
  const dependencies: any = { schemaVersion: "saitu.case-source-dependencies.v7.1", ...policy, contract: "layer_primary_with_explicit_secondary_sources.v7.1", originalCaseMetadata, components,
    cases: [{ caseId: "hard", inputSha256: cases[0].inputSha256, answerSha256: cases[0].answerSha256, primaryComponentId: "nonranking", primarySourceSnapshotSha256: cases[0].sourceSnapshotSha256, requiredComponentIds: ["nonranking", "ranking"], sources: [commonBinding, secondaryBinding] },
      { caseId: "rank", inputSha256: cases[1].inputSha256, answerSha256: cases[1].answerSha256, primaryComponentId: "ranking", primarySourceSnapshotSha256: cases[1].sourceSnapshotSha256, requiredComponentIds: ["ranking"], sources: [secondaryBinding] }] };
  if (absolute) dependencies.relocations = await ref("relocations.json", { schemaVersion: "saitu.source-reference-relocation.v7.1", root,
    relocations: ["raw", "body"].map(kind => ({ component: "ranking", sourceId: "secondary", kind, originalSnapshot: components[1].manifest, originalReference: secondaryRef, repositoryRelativeReference: { path: secondaryMember, sha256: secondaryRef.sha256 } })) });
  const manifest: any = { ...policy, cases, originalCaseMetadata, sourceSnapshotSha256: components[0].canonicalSha256, rankingSourceSnapshotSha256: components[1].canonicalSha256,
    sourceDependencies: await ref("dependencies.json", dependencies), caseSourceDependenciesSha256: "" };
  manifest.caseSourceDependenciesSha256 = manifest.sourceDependencies.sha256;
  const config = { sourceSnapshotSha256: manifest.sourceSnapshotSha256, rankingSourceSnapshotSha256: manifest.rankingSourceSnapshotSha256, catalogSha256: ranking.catalogSha256 };
  const rebind = async () => { manifest.sourceDependencies = await ref("dependencies.json", dependencies); manifest.caseSourceDependenciesSha256 = manifest.sourceDependencies.sha256; };
  return { root, manifest, config, dependencies, rebind, ref, async verify() { return verifyCaseSourceDependencies({ evidenceRoot: root, manifest, config }); } };
}

describe("explicit per-case multi-component source binding", () => {
  it("verifies a secondary source per case without changing its primary snapshot", async () => {
    const f = await fixture();
    try { expect(await f.verify()).toMatchObject({ cases: 2, componentSourceRecords: 2, uniqueSourceFiles: 3, crossComponentCases: 1, crossComponentCaseIds: ["hard"], crossComponentSourceIds: ["secondary"], sourceBytesVerified: true }); }
    finally { await rm(f.root, { recursive: true, force: true }); }
  });
  it.each(["missing-source", "wrong-component", "missing-case", "wrong-record", "hidden-secondary", "wrong-primary", "wrong-metadata"])("rejects a broken case dependency even when its outer hash is recomputed: %s", async mode => {
    const f = await fixture();
    try {
      const row = f.dependencies.cases[0];
      if (mode === "missing-source") row.sources.pop();
      if (mode === "wrong-component") row.sources[1].componentId = "nonranking";
      if (mode === "missing-case") f.dependencies.cases.pop();
      if (mode === "wrong-record") row.sources[1].sourceRecordSha256 = canonicalHash("different-record");
      if (mode === "hidden-secondary") row.requiredComponentIds = ["nonranking"];
      if (mode === "wrong-primary") row.primaryComponentId = "ranking";
      if (mode === "wrong-metadata") f.manifest.originalCaseMetadata = { ...f.manifest.originalCaseMetadata, sha256: canonicalHash("stale-metadata") };
      await f.rebind(); await expect(f.verify()).rejects.toThrow();
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
  it("rejects changed actual source bytes and a symlink escaping the evidence root", async () => {
    const f = await fixture(), outside = await mkdtemp(path.join(tmpdir(), "saitu-outside-source-"));
    try {
      await writeFile(path.join(f.root, "raw/secondary.txt"), "tampered"); await expect(f.verify()).rejects.toThrow("bytes_changed");
      await writeFile(path.join(outside, "same-bytes.txt"), "public-source-secondary"); await rm(path.join(f.root, "raw/secondary.txt"));
      await symlink(path.join(outside, "same-bytes.txt"), path.join(f.root, "raw/secondary.txt")); await expect(f.verify()).rejects.toThrow("outside_root");
    } finally { await rm(f.root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });
  it("accepts only the exact same-byte repository member for frozen absolute-reference relocation", async () => {
    const f = await fixture(true);
    try {
      expect((await f.verify()).sourceBytesVerified).toBe(true);
      await writeFile(path.join(f.root, "raw/duplicate.txt"), "public-source-secondary");
      const relocations = JSON.parse(await readFile(path.join(f.root, "relocations.json"), "utf8"));
      relocations.relocations[0].repositoryRelativeReference.path = "raw/duplicate.txt";
      f.dependencies.relocations = await f.ref("relocations.json", relocations); await f.rebind();
      await expect(f.verify()).rejects.toThrow("exact_repository_relative_member");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
  it("refuses a raw proof from the scoring entrypoint when the registered dependency artifact is absent", async () => {
    const f = await fixture();
    try {
      const unopened = { ...f.manifest, openedAt: null, sourceDependencies: undefined, caseSourceDependenciesSha256: null };
      delete unopened.sourceDependencies;
      const challengeManifest = await f.ref("challenge.json", unopened), migration = await f.ref("migration.json", {});
      await expect(loadScoringOriginals({ evidenceRoot: f.root, bundle: { migration: {}, manifest: { ...unopened, openedAt: "2026-11-09T00:00:00Z" } },
        ranking: { registration: { config: { ...f.config, challengeManifest, challengeManifestSha256: challengeManifest.sha256, migration, migrationSha256: migration.sha256 } }, matrix: {} } })).rejects.toThrow("case_source_dependencies_required");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
  it("rejects a spoofed relocation root redirecting every dependency to another same-byte file", async () => {
    const f = await fixture(true, "legacy/raw");
    try {
      expect((await f.verify()).sourceBytesVerified).toBe(true);
      const relocation = JSON.parse(await readFile(path.join(f.root, "relocations.json"), "utf8"));
      relocation.root = path.join(f.root, "legacy");
      for (const row of relocation.relocations) row.repositoryRelativeReference.path = "raw/secondary.txt";
      for (const row of f.dependencies.cases) for (const source of row.sources) if (source.sourceId === "secondary") {
        source.raw.path = "raw/secondary.txt"; source.body.path = "raw/secondary.txt";
      }
      f.dependencies.relocations = await f.ref("relocations.json", relocation); await f.rebind();
      await expect(f.verify()).rejects.toThrow("relocation_root_must_match_real_evidence_root");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});
