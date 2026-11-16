import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalHash, POLICY_VERSION, POLICY_SHA256 } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { verifyDevelopmentExclusions } from "../../../scripts/competitions/v7/evaluation-development-exclusions.mjs";
import { verifyRankingPanelMetadata } from "../../../scripts/competitions/v7/evaluation-ranking-panels.mjs";
import { createRegistration, preflightScoringRegistration, validateRegistrationConfig, validateRegistrationMetadata, verifyRegistration } from "../../../scripts/competitions/v7/evaluation-registration.mjs";
import { syntheticDevelopmentCalibrationFixture } from "./evaluation-calibration-development.fixture";
import { rankingPanelsFixture } from "./evaluation-ranking-panels.fixture";
import { DEFAULT_EFFORT_POLICY, TOP5_EFFORT_GRANT_VERSION, effortPolicySha256, evaluationRuntimeForEffort } from "../../../scripts/competitions/v7/evaluation-effort.mjs";

const reads = vi.hoisted(() => ({ private: [] as string[], panelMetadata: [] as string[] }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: async (...args: any[]) => {
    const filename = String(args[0]);
    if (/ranking-panels[\\/]fictional-round[\\/]|private[\\/](?:keys|observations)\.json/.test(filename)) { reads.private.push(filename); throw new Error("SYNTHETIC_RAW_GRADE_READ_FORBIDDEN"); }
    if (/ranking-panel-metadata[\\/]fictional-round[\\/]/.test(filename)) reads.panelMetadata.push(filename);
    return (actual.readFile as any)(...args);
  } };
});

async function fixture() {
  const f = await syntheticDevelopmentCalibrationFixture({ concreteInputValues: false });
  const panels = await rankingPanelsFixture({ root: f.root, manifest: f.manifest, config: f.cfg });
  await f.persist();
  const args = { ...panels.args(), migration: f.migration };
  const publicDevelopmentVerification = await verifyDevelopmentExclusions({ evidenceRoot: f.root, manifest: f.manifest, config: f.cfg, migration: f.migration, registeredAt: args.registeredAt });
  const report = await verifyRankingPanelMetadata(args);
  const registration: any = { schemaVersion: "saitu.ranking-registration.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    registeredAt: args.registeredAt, inputOpened: false, formalRunsExecuted: 0, config: f.cfg, implementation: [], implementationSha256: canonicalHash([]), publicDevelopmentVerification,
    rankingPanelMetadataVerification: structuredClone(report) };
  return { ...f, panels, report, registration, reference: () => f.put("registration-ranking-metadata.json", registration),
    preflight: async () => preflightScoringRegistration({ evidenceRoot: f.root, reference: await f.put("registration-ranking-metadata.json", registration) }) };
}

describe("registration binds optional ranking panel metadata after the public guard", () => {
  it("round trips the metadata contract and exact report without opening invented raw grades", async () => {
    const f = await fixture(); try {
      expect(validateRegistrationConfig(f.cfg)).toBe(f.cfg);
      expect(validateRegistrationMetadata(f.registration)).toBe(f.registration);
      expect(verifyRegistration(f.registration, f.cfg)).toBe(f.registration);
      expect((await f.preflight()).rankingPanelMetadataVerification).toEqual(f.report);
      expect(f.report).toMatchObject({ originalAuthors: 48, profiles: 120, pairedUnits: 5400, rawGradesOpened: false });
      expect(reads.private).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("new creation omits the unused panel contract and binds stage effort with five invented admission receipts", async () => {
    const f = await fixture(); try {
      delete f.cfg.rankingReviewContract;
      f.cfg.runtime = evaluationRuntimeForEffort(DEFAULT_EFFORT_POLICY);
      const diagnostic = JSON.parse(await readFile(path.join(f.root, f.pub.supplements[1].records[0].input.path), "utf8"));
      const screenshot = await f.put("synthetic-screenshot.json", { syntheticOnly: true });
      const runs = [], runChecks = [];
      for (let i = 0; i < 5; i++) {
        const invocationId = `synthetic-admission-${i}`, timing = { timeOrigin: 1000, start: 10, listMs: 40000, allDetailsMs: 120000, readyExpansionMs: 1000 };
        const dom = await f.put(`synthetic-dom-${i}.json`, { syntheticOnly: true, record: { invocationId, timing } });
        const receipt = await f.put(`synthetic-receipt-${i}.json`, { schemaVersion: "saitu.public-browser-receipts.v7.1", invocationId, realProviderDispatch: true,
          calls: [{ originalReceipt: { kind: "receipt", syntheticOnly: true }, spend_run_id: "synthetic-funded-scope", model: "deepseek-flash", effort: "low", operation: "competition_v7_rank", effort_policy_sha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), reservation_id: `synthetic-reservation-${i}`,
            call_key: "v7.rank:effort-v1.initial:1", call_operation: "competition_v7_rank", call_thinking: "enabled", call_reasoning_effort: "low", call_effort_policy_sha256: effortPolicySha256(DEFAULT_EFFORT_POLICY) }],
          runSnapshot: { context: { records: diagnostic.records }, items: [{ itemId: "synthetic-one" }], report: { recommendations: [{ itemId: "synthetic-one" }] } }, syntheticOnly: true });
        runs.push({ invocationId, timing, receiptSha256: receipt.sha256, receiptPath: receipt.path, realProviderDispatch: true, success: true, pageDelivered: true, criticalReviewPassed: true });
        runChecks.push({ invocationId, receiptSha256: receipt.sha256, criticalReviewPassed: true, dom, screenshot });
      }
      const review = await f.put("synthetic-admission-review.json", { schemaVersion: "saitu.public-critical-review.v7.1", contextId: "synthetic-public-reviewer", passed: true, admissionRunsSha256: canonicalHash(runs), runChecks });
      f.cfg.publicAdmission = await f.put("synthetic-admission.json", { schemaVersion: "saitu.public-admission.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
        ...Object.fromEntries(["implementationSha256", "runtimeConfigurationSha256", "catalogSha256", "candidatePoolSha256", "runtimeSourceBindingSha256"].map(key => [key, f.cfg[key]])),
        executionScope: { runId: "synthetic-funded-scope", grantVersion: TOP5_EFFORT_GRANT_VERSION, authorizedEffort: "stage", effortPolicy: DEFAULT_EFFORT_POLICY, effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY) }, runs, authorContextId: "synthetic-public-author",
        independentReview: { contextId: "synthetic-public-reviewer", passed: true, evidencePath: review.path, evidenceSha256: review.sha256 } });
      const created = await createRegistration(f.cfg, { repositoryRoot: f.root, now: f.registration.registeredAt });
      expect(created.rankingPanelMetadataVerification).toBeUndefined();
      expect(created.config.rankingReviewContract).toBeUndefined();
      expect(validateRegistrationMetadata(created)).toBe(created);
      expect(created.formalRunsExecuted).toBe(0); expect(created.inputOpened).toBe(false); expect(reads.private).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("rejects new panel registrations while preserving the historical metadata validators", async () => {
    const f = await fixture(); try {
      f.cfg.runtime = evaluationRuntimeForEffort(DEFAULT_EFFORT_POLICY);
      await expect(createRegistration(f.cfg, { repositoryRoot: f.root, now: f.registration.registeredAt })).rejects.toThrow("two_complete_blind_originals_not_panels");
      expect(reads.private).toEqual([]);
    } finally { await f.dispose(); }
  });
  it.each(["missing", "opaque", "count-object", "grade-field", "invalid-ref"])("rejects malformed metadata summary before the panel reader: %s", async mode => {
    const f = await fixture(); try {
      if (mode === "missing") delete f.registration.rankingPanelMetadataVerification;
      if (mode === "opaque") f.registration.rankingPanelMetadataVerification.opaque = { judgments: [3] };
      if (mode === "count-object") f.registration.rankingPanelMetadataVerification.originalAuthors = { judgments: [3] };
      if (mode === "grade-field") f.registration.rankingPanelMetadataVerification.rawGradesOpened = true;
      if (mode === "invalid-ref") f.registration.rankingPanelMetadataVerification.adjudicationReference = { path: "invented", rawSha256: canonicalHash("invented"), canonicalSha256: canonicalHash("invented"), judgments: [3] };
      const before = reads.panelMetadata.length;
      await expect(f.preflight()).rejects.toThrow("ranking_panel_metadata_summary");
      expect(reads.panelMetadata).toHaveLength(before); expect(reads.private).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("rejects a correctly typed but stale report after reading only public provenance", async () => {
    const f = await fixture(); try {
      f.registration.rankingPanelMetadataVerification.partitionSha256 = canonicalHash("stale");
      await expect(f.preflight()).rejects.toThrow("registered_ranking_panel_metadata_verification_changed");
      expect(reads.private).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("freezes the complete optional contract in verifyRegistration", async () => {
    const f = await fixture(); try {
      const changed = structuredClone(f.cfg); changed.rankingReviewContract.publicPlan.rawSha256 = canonicalHash("changed");
      expect(() => verifyRegistration(f.registration, changed)).toThrow("v7_frozen_configuration_changed:rankingReviewContract");
      expect(() => verifyRegistration(f.registration, { ...f.cfg, rankingReviewContract: undefined })).toThrow("v7_frozen_configuration_changed:rankingReviewContract");
    } finally { await f.dispose(); }
  });
  it("preserves public-first failure in both creation and scoring preflight", async () => {
    const f = await fixture(); try {
      f.pub.developmentInputSha256.pop(); await f.persist();
      const before = reads.panelMetadata.length;
      const creationConfig = { ...f.cfg, runtime: evaluationRuntimeForEffort(DEFAULT_EFFORT_POLICY) }; delete creationConfig.rankingReviewContract;
      await expect(createRegistration(creationConfig, { repositoryRoot: f.root, now: f.registration.registeredAt })).rejects.toThrow("development_exclusions:");
      await expect(f.preflight()).rejects.toThrow("development_exclusions:");
      expect(reads.panelMetadata).toHaveLength(before); expect(reads.private).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("rejects a metadata report without its declared contract", async () => {
    const f = await fixture(); try {
      delete f.registration.config.rankingReviewContract;
      expect(() => validateRegistrationMetadata(f.registration)).toThrow("ranking_panel_metadata_contract_required");
    } finally { await f.dispose(); }
  });
});
