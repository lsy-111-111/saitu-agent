import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeFile, readFile, symlink, unlink, mkdtemp, rm, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const oracle = vi.hoisted(() => ({ allowed: true, calls: 0, reads: [] as string[], onRead: null as null | ((filename: string) => Promise<void>) }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: async (...args: any[]) => { const filename = String(args[0]); oracle.reads.push(filename); const bytes = await (actual.readFile as any)(...args); await oracle.onRead?.(filename); return bytes; } };
});
vi.mock("../../../scripts/competitions/v7/evaluation-development-exclusions.mjs", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../scripts/competitions/v7/evaluation-development-exclusions.mjs")>();
  return { ...actual, verifyDevelopmentExclusions: async ({ config }: any) => { oracle.calls++; if (!oracle.allowed) throw new Error("development_exclusions:synthetic_guard_rejected"); return { publicDevelopmentManifestSha256: config.publicDevelopmentManifestSha256, materialReviewSha256: "a".repeat(64), finalExecutionAdoptionSha256: "b".repeat(64), sourceDependencyVerification: { dependencyManifestSha256: "c".repeat(64) } }; } };
});
import { canonicalHash } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { buildRankingPanelPlan, assignRankingPanelAuthors, validateRankingReviewContract, verifyRankingPanelMetadata, loadRankingPanelsOriginals, isVerifiedRankingPanels } from "../../../scripts/competitions/v7/evaluation-ranking-panels.mjs";
import { loadScoringOriginals, getVerifiedRankingPanels, isVerifiedOriginals } from "../../../scripts/competitions/v7/evaluation-originals.mjs";
import { rankingPanelsFixture, syntheticPanelScoringInputs } from "./evaluation-ranking-panels.fixture";

// Only the public-exclusion oracle is mocked in this file; all metadata, packet,
// grade, hash, symlink, realpath and product-original reads use real temp files.
// Existing development/source-dependency suites separately retain the actual
// public graph and all its rejection assertions. No formal artifacts are read.
const privateReads = () => oracle.reads.filter(file => /[/\\]ranking-panels[/\\]/.test(file));
beforeEach(() => { oracle.allowed = true; oracle.calls = 0; oracle.reads.length = 0; oracle.onRead = null; });

describe("v7.2 actual ranking-panel bounded reader", () => {
  it("reads public provenance only before private grades, preserving 48 actual author identities", async () => {
    const f = await rankingPanelsFixture(); try {
      oracle.reads.length = 0;
      const summary = await verifyRankingPanelMetadata(f.args());
      expect(oracle.calls).toBe(1); expect(summary).toMatchObject({ originalAuthors: 48, profiles: 120, pairedUnits: 5400, rawGradesOpened: false });
      expect(privateReads()).toEqual([]);
      const result = await loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: f.pools, expectedMetadataVerification: summary });
      expect(result.panels).toHaveLength(2); expect(new Set(result.actualAuthorContextIds).size).toBe(48);
      expect(result.panels.every(panel => !Object.hasOwn(panel, "contextId"))).toBe(true);
      expect(result.rows).toHaveLength(5400); expect(result.originalAgreement).toMatchObject({ denominator: 5400, paired: 5399, unknownPairs: 1, actualAuthorCount: 48, minimumAlpha: .7 });
      expect(result.unresolved).toHaveLength(2); expect(result.unresolved.some((row: any) => row.grades.every((grade: unknown) => grade === "U"))).toBe(true);
      expect(result.goldReady).toBe(false); expect(result.resolvedProfiles).toBeNull(); expect(result.blockers).toContain("ranking_panel_adjudication_pending_or_U");
      expect(isVerifiedRankingPanels(result, { ...f.args(), expectedProfiles: f.pools })).toBe(true);
      const clone = structuredClone(result); expect(isVerifiedRankingPanels(clone, { ...f.args(), expectedProfiles: f.pools })).toBe(false);
      (result.statPairs[0] as any)[0] = "changed"; expect(isVerifiedRankingPanels(result, { ...f.args(), expectedProfiles: f.pools })).toBe(false);
    } finally { await f.dispose(); }
  });
  it("a fresh bound third resolves both numeric disagreement and common U without changing original alpha", async () => {
    const f = await rankingPanelsFixture({ adjudication: true }); try {
      const result = await loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: f.pools });
      expect(result.goldReady).toBe(true); expect(result.blockers).toEqual([]); expect(result.unresolvedAfterAdjudication).toBe(0);
      expect(result.unresolved).toHaveLength(2); expect(result.originalAgreement.paired).toBe(5399);
      expect(result.resolvedProfiles).toHaveLength(120); expect(result.resolvedProfiles!.every(row => row.judgments.length === 45 && row.judgments.every(item => item.relevance !== "U"))).toBe(true);
      expect(result.panels.every((panel: any) => panel.assembly.role === "assembler_only_no_grading" && panel.shards.length === 24)).toBe(true);
    } finally { await f.dispose(); }
  });
  it.each(["low", "constant"] as const)("%s raw alpha preserves failure and never opens an adjudication file", async mode => {
    const f = await rankingPanelsFixture({ mode }); try {
      f.contract.adjudication = await f.put(`ranking-panels/${f.plan.roundId}/adjudication.json`, { mustNotRead: "invented adjudication sentinel" });
      oracle.reads.length = 0; const result = await loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: f.pools });
      expect(result.goldReady).toBe(false); expect(result.resolvedProfiles).toBeNull(); expect(result.blockers.some(value => value.includes("alpha"))).toBe(true);
      expect(oracle.reads.some(file => file.endsWith("adjudication.json"))).toBe(false);
    } finally { await f.dispose(); }
  });
  it("rejects failed public exclusions before any panel graph or product original is opened", async () => {
    const f = await rankingPanelsFixture(); try {
      oracle.allowed = false; oracle.reads.length = 0;
      await expect(verifyRankingPanelMetadata(f.args())).rejects.toThrow("development_exclusions");
      await expect(loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: f.pools })).rejects.toThrow("development_exclusions");
      expect(oracle.reads).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("requires actual registeredAt and exact registered metadata summary before grade reads", async () => {
    const f = await rankingPanelsFixture(); try {
      oracle.reads.length = 0; await expect(loadRankingPanelsOriginals({ ...f.args(), registeredAt: null as any, expectedProfiles: f.pools })).rejects.toThrow("registered_time"); expect(oracle.reads).toEqual([]);
      const summary = await verifyRankingPanelMetadata(f.args()); oracle.reads.length = 0;
      await expect(loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: f.pools, expectedMetadataVerification: { ...summary, partitionSha256: canonicalHash("wrong") } })).rejects.toThrow("registered_panel_metadata");
      expect(privateReads()).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("deep copies and freezes plan metadata, invalidating changed issuance before source construction", async () => {
    const f = await rankingPanelsFixture(); try {
      const hash = canonicalHash(f.plan); expect(f.plan.profiles[0]).not.toBe(f.metadata.profiles[0]);
      expect(() => { f.plan.profiles[0].taskGroup = "changed"; }).toThrow(TypeError);
      f.metadata.profiles[0].taskGroup = "changed"; expect(canonicalHash(f.plan)).toBe(hash);
      expect(() => assignRankingPanelAuthors(f.plan, f.assignments.map(row => row.authorContextId))).toThrow("source_metadata_or_options_changed");
      const metadata = structuredClone(f.metadata); metadata.profiles[0].caseId = { relevance: 3 } as any;
      expect(() => buildRankingPanelPlan(metadata, f.planOptions)).toThrow("scalar_profile_metadata");
    } finally { await f.dispose(); }
  });
  it.each(["caseId", "familyId", "taskGroup", "inputSha256"])("rehashed packet %s mismatch cannot substitute another frozen identity", async field => {
    const f = await rankingPanelsFixture(); try {
      await f.mutatePacket(0, packet => { packet.profiles[0][field] = field === "inputSha256" ? canonicalHash("other") : "fictional-other"; });
      await expect(loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: f.pools })).rejects.toThrow("packet_frozen_metadata");
    } finally { await f.dispose(); }
  });
  it.each(["missing-shard", "duplicate-shard", "author-reuse", "coordinator-author", "late-seal"])("public %s fails before any original is opened", async mode => {
    const f = await rankingPanelsFixture(); try {
      if (mode === "missing-shard") f.collection.originals.pop();
      if (mode === "duplicate-shard") f.collection.originals[47] = structuredClone(f.collection.originals[0]);
      if (mode === "author-reuse") f.collection.originals[0].authorContextId = f.collection.originals[24].authorContextId;
      if (mode === "coordinator-author") f.collection.originals[0].authorContextId = f.plan.coordinators[0];
      if (mode === "late-seal") f.collection.originals[0].sealedAt = "2099-01-01T00:00:00Z";
      await f.updateCollection(); oracle.reads.length = 0;
      await expect(loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: f.pools })).rejects.toThrow(); expect(privateReads()).toEqual([]);
    } finally { await f.dispose(); }
  });
  it.each(["missing-item", "duplicate-item", "string-grade", "coordinator-author", "unsealed", "blind-false"])("rehashed private %s cannot become valid grading", async mode => {
    const f = await rankingPanelsFixture(); try {
      await f.mutateOriginal(0, raw => {
        if (mode === "missing-item") raw.profiles[0].judgments.pop();
        if (mode === "duplicate-item") raw.profiles[0].judgments[1] = structuredClone(raw.profiles[0].judgments[0]);
        if (mode === "string-grade") raw.profiles[0].judgments[0].relevance = "3";
        if (mode === "coordinator-author") raw.authorContextId = f.plan.coordinators[0];
        if (mode === "unsealed") raw.status = "draft";
        if (mode === "blind-false") raw.blindState.otherPanelJudgmentsRead = true;
      }); await expect(loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: f.pools })).rejects.toThrow();
    } finally { await f.dispose(); }
  });
  it("changed raw bytes and canonical hash mismatch are rejected separately", async () => {
    const f = await rankingPanelsFixture(); try {
      const descriptor = f.collection.originals[0], filename = path.join(f.root, descriptor.original.path), before = await readFile(filename);
      await writeFile(filename, Buffer.concat([before, Buffer.from(" ")]));
      await expect(loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: f.pools })).rejects.toThrow("bytes_changed");
      await writeFile(filename, before); descriptor.original.canonicalSha256 = canonicalHash("not-original"); await f.updateCollection();
      await expect(loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: f.pools })).rejects.toThrow("canonical_bytes_changed");
    } finally { await f.dispose(); }
  });
  it.each(["traversal", "absolute", "wrong-role"])("%s public ref is rejected before any file read", async mode => {
    const f = await rankingPanelsFixture(); try {
      f.contract.publicPlan.path = mode === "traversal" ? "ranking-panel-metadata/../../private/keys.json" : mode === "absolute" ? path.join(f.root, f.contract.publicPlan.path) : f.collection.originals[0].original.path;
      oracle.reads.length = 0; await expect(verifyRankingPanelMetadata(f.args())).rejects.toThrow(); expect(oracle.reads).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("public-looking same-root symlink cannot open private raw grades during metadata verification", async () => {
    const f = await rankingPanelsFixture(); try {
      const publicName = path.join(f.root, f.contract.publicPlan.path), rawName = path.join(f.root, f.collection.originals[0].original.path);
      await unlink(publicName); await symlink(rawName, publicName); oracle.reads.length = 0;
      await expect(verifyRankingPanelMetadata(f.args())).rejects.toThrow("realpath_alias_forbidden"); expect(privateReads()).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("the common bounded reader rejects private originals symlinked outside the evidence root", async () => {
    const f = await rankingPanelsFixture(), outside = await mkdtemp(path.join(os.tmpdir(), "saitu-panel-outside-")); try {
      const descriptor = f.collection.originals[0], filename = path.join(f.root, descriptor.original.path), target = path.join(outside, "fictional-original.json");
      await writeFile(target, await readFile(filename)); await unlink(filename); await symlink(target, filename); oracle.reads.length = 0;
      await expect(loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: f.pools })).rejects.toThrow("outside_root"); expect(oracle.reads).not.toContain(target);
    } finally { await f.dispose(); await rm(outside, { recursive: true, force: true }); }
  });
  it("rereads every private original and rejects an edit during assembly", async () => {
    const f = await rankingPanelsFixture(); try {
      const filename = await realpath(path.join(f.root, f.collection.originals[0].original.path)); let changed = false;
      oracle.onRead = async current => { if (current === filename && !changed) { changed = true; await writeFile(filename, "changed after first read"); } };
      await expect(loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: f.pools })).rejects.toThrow("bytes_changed");
      expect(changed).toBe(true);
    } finally { oracle.onRead = null; await f.dispose(); }
  });
  it.each(["old-author", "wrong-original-hash", "extra-resolution", "still-U"])("third-person %s cannot silently complete the gold", async mode => {
    const f = await rankingPanelsFixture(); try {
      await f.putAdjudication(value => {
        if (mode === "old-author") value.contextId = f.assignments[0].authorContextId;
        if (mode === "wrong-original-hash") value.resolutions[0].originalJudgmentSha256[0] = canonicalHash("wrong");
        if (mode === "extra-resolution") value.resolutions.push({ ...value.resolutions[0], itemId: "fictional-foreign" });
        if (mode === "still-U") value.resolutions[0].relevance = "U";
      });
      if (mode === "still-U") { const result = await loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: f.pools }); expect(result.goldReady).toBe(false); expect(result.unresolvedAfterAdjudication).toBe(1); }
      else await expect(loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: f.pools })).rejects.toThrow();
    } finally { await f.dispose(); }
  });
  it("frozen matrix membership must match before original grade bytes are opened", async () => {
    const f = await rankingPanelsFixture(); try {
      const pools = structuredClone(f.pools); pools[0].poolItemIds.pop(); oracle.reads.length = 0;
      await expect(loadRankingPanelsOriginals({ ...f.args(), expectedProfiles: pools })).rejects.toThrow("matrix_pool"); expect(privateReads()).toEqual([]);
      expect(() => validateRankingReviewContract({ ...f.contract, opaque: { relevance: 3 } })).toThrow("contract_fields");
    } finally { await f.dispose(); }
  });
  it("actual product-original proof exposes panels only while bundle/matrix/registration and proof remain unchanged", async () => {
    const f = await rankingPanelsFixture({ adjudication: true }); try {
      const inputs = await syntheticPanelScoringInputs(f), proof = await loadScoringOriginals({ evidenceRoot: f.root, ...inputs });
      const context = { bundle: inputs.bundle, matrix: inputs.ranking.matrix, registration: inputs.ranking.registration };
      expect(isVerifiedOriginals(proof, context)).toBe(true); expect(getVerifiedRankingPanels(proof, context)?.goldReady).toBe(true);
      expect(proof).toHaveProperty("rankingPanelsVerification"); expect(JSON.stringify(proof)).not.toContain("invented original author judgment");
      inputs.ranking.matrix.seed++; expect(getVerifiedRankingPanels(proof, context)).toBeNull(); inputs.ranking.matrix.seed--;
      (proof.rankingPanelsVerification as any).goldReady = false; expect(getVerifiedRankingPanels(proof, context)).toBeNull();
    } finally { await f.dispose(); }
  });
  it("v7.1 no-contract path still verifies full existing originals and never opens a v7.2 grade", async () => {
    const f = await rankingPanelsFixture(); try {
      const inputs = await syntheticPanelScoringInputs(f, { legacy: true }); oracle.reads.length = 0;
      const proof = await loadScoringOriginals({ evidenceRoot: f.root, ...inputs }), context = { bundle: inputs.bundle, matrix: inputs.ranking.matrix, registration: inputs.ranking.registration };
      expect(isVerifiedOriginals(proof, context)).toBe(true); expect(getVerifiedRankingPanels(proof, context)).toBeNull(); expect(proof).not.toHaveProperty("rankingPanelsVerification"); expect(privateReads()).toEqual([]);
    } finally { await f.dispose(); }
  });
});
