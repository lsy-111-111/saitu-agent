import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { byteHash, canonicalHash, POLICY_VERSION, POLICY_SHA256, EVALUATION_POLICY } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { DEVELOPMENT_CONSUMER_VERSION, UNKNOWN_TEMPLATE_CONTRACT, verifyDevelopmentExclusions } from "../../../scripts/competitions/v7/evaluation-development-exclusions.mjs";
import { inspectChallengeManifest } from "../../../scripts/competitions/v7/evaluation-score.mjs";
import { createRegistration, preflightScoringRegistration, validateRegistrationMetadata } from "../../../scripts/competitions/v7/evaluation-registration.mjs";
import { verifyCaseSourceDependencies } from "../../../scripts/competitions/v7/evaluation-source-dependencies.mjs";
import { loadScoringOriginals, isVerifiedOriginals } from "../../../scripts/competitions/v7/evaluation-originals.mjs";
import { evaluationFixture } from "./evaluation.fixture";

const sensitiveReads = vi.hoisted(() => [] as string[]);
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: async (...args: any[]) => {
    if (/private[\\/](keys|observations|product-originals)\.json/.test(String(args[0]))) { sensitiveReads.push(String(args[0])); throw new Error("PRIVATE_SCORING_READ_REACHED"); }
    return (actual.readFile as any)(...args);
  } };
});
const policy = { policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256 };
const hash = canonicalHash;
const unique = (values: string[]) => [...new Set(values)].sort();

/** Entirely synthetic metadata. No real public/formal input, answer or label file. */
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "saitu-development-consumer-")));
  for (const name of ["src", "db", "scripts", "ops", "public", "private/sources"]) await mkdir(path.join(root, name), { recursive: true });
  const put = async (member: string, value: any) => { const data = Buffer.from(JSON.stringify(value)); await writeFile(path.join(root, member), data); return { path: member, sha256: byteHash(data) }; };
  const f = evaluationFixture(), manifest: any = structuredClone(f.manifest), migration: any = structuredClone(f.migration);
  manifest.openedAt = null; manifest.implementationFrozenAt = "2026-11-09T00:00:00Z"; manifest.frozenAt = "2026-11-09T00:00:20Z";
  const records = Array.from({ length: 45 }, (_, i) => ({ recordId: `public-candidate-${i}`, seriesId: `series-${i}` }));
  const profile = { schemaVersion: "saitu.profile.v6", profileId: "public-novice", facts: [], unknownFields: [] };
  const legacy = { student: "public-novice" };
  const fullInput = { profile, originalProfile: legacy, records };
  const corpus: any[] = [], projected: any[] = [];
  const kinds: [string, number][] = [["public_seed_input", 96], ["public_seed_profile_representation", 24], ["public_legacy_experiment_input", 6], ["actual_public_browser_submission", 10], ["public_diagnostic_input_reuse", 6], ["public_local_B_preflight_input", 1]];
  for (const [kind, count] of kinds) for (let i = 0; i < count; i++) {
    const recordId = kind === "actual_public_browser_submission" && i === 0 ? "public-admission-02:v7-public-desktop-novice" : `${kind}-${i}`;
    const p = kind === "public_diagnostic_input_reuse" || recordId.startsWith("public-admission-02:") ? profile : { ...profile, profileId: recordId };
    let input: any = kind === "public_seed_input" ? { utterance: `public student ${i}` } : { profile: p };
    if (["public_legacy_experiment_input", "public_local_B_preflight_input"].includes(kind)) input = { legacy: { student: recordId }, profile: p, currentV7AdapterProjection: p };
    if (kind === "actual_public_browser_submission") input = { profile: p, legacy, registeredBrowserParameters: { student: i } };
    if (kind === "public_diagnostic_input_reuse") input = { profile, legacy };
    const familySha256 = hash(`public-family-${corpus.length % 42}`), templateSha256 = hash(`public-template-${corpus.length % 38}`);
    const row: any = { recordId, kind, originalFamilyId: kind === "public_seed_input" ? `development-family-${i % 36}` : null, originalTemplateFamilyId: null,
      familySha256, templateSha256, derivedFamilyId: `pub-family.v7.2:${familySha256}`, derivedTemplateId: `pub-template.v7.2:${templateSha256}`,
      canonicalInputSha256: hash(kind === "public_seed_input" ? input : ["public_legacy_experiment_input", "public_local_B_preflight_input"].includes(kind) ? { legacy: input.legacy } : { profile: input.profile }) };
    if (input.profile) Object.assign(row, { actualProfileSha256: hash(input.profile), profileInputSha256: hash({ profile: input.profile }) });
    if (kind === "public_legacy_experiment_input") Object.assign(row, { currentAdapterProjection: { profileInputSha256: hash({ profile: p }), profileFamilySha256: hash(`adapter-family-${i}`) }, projectionIsHistoricalActualCanonicalClaim: false });
    if (kind === "actual_public_browser_submission") Object.assign(row, { legacyEnvelopeSha256: hash({ legacy }), browserParameterSha256: hash(input.registeredBrowserParameters) });
    if (kind === "public_diagnostic_input_reuse") row.diagnosticSubmittedEnvelopeSha256 = hash(fullInput);
    if (kind === "public_diagnostic_input_reuse") {
      const origin = corpus.find(previous => previous.recordId === "public-admission-02:v7-public-desktop-novice");
      for (const field of ["familySha256", "templateSha256", "derivedFamilyId", "derivedTemplateId", "browserParameterSha256", "legacyEnvelopeSha256"]) row[field] = origin[field];
      row.reusedFrom = origin.recordId;
    }
    corpus.push(row); projected.push({ recordId, input });
  }
  const original = await put("public-original.json", { records: projected });
  const mainSources = [original];
  for (const [index, row] of corpus.entries()) {
    row.source = original;
    row.sourcePointer = `/records/${index}/input${row.kind === "public_seed_input" ? "" : row.kind === "public_legacy_experiment_input" ? "/legacy" : "/profile"}`;
    if (row.kind === "public_diagnostic_input_reuse") { row.source = await put(`public-diagnostic-${index}.json`, fullInput); row.sourcePointer = "/profile"; mainSources.push(row.source); }
    if (row.kind === "public_local_B_preflight_input") { row.source = await put("public-local-B.json", { profile: { inputSha256: hash(projected[index].input.legacy), profileSha256: row.actualProfileSha256 } }); row.sourcePointer = "/profile"; mainSources.push(row.source); }
  }
  const mainProjection = await put("public-inputs.json", { records: projected });
  const families = unique(corpus.flatMap(row => row.originalFamilyId ? [row.originalFamilyId] : []));
  const df = unique(corpus.map(row => row.derivedFamilyId));
  const dt = unique(corpus.map(row => row.derivedTemplateId));
  const exactEnvelopes = unique(corpus.flatMap(row => [row.canonicalInputSha256, row.profileInputSha256, row.legacyEnvelopeSha256, row.currentAdapterProjection?.profileInputSha256].filter(Boolean)));
  const main: any = { schemaVersion: "saitu.public-development-exclusion-manifest.v7.2", ...policy, records: corpus, inputProjection: mainProjection,
    recipes: await put("recipes.json", { schemaVersion: "saitu.public-development-hash-recipes.v7.2" }), sourceClosure: { files: mainSources },
    originalMetadataExclusions: { developmentFamilyIds: families, developmentTemplateFamilyIds: [], templateIdsAbsentFromHistoricalMetadata: true },
    derivedReviewExclusions: { developmentInputSha256: exactEnvelopes, familyIds: df, sourceTemplateIds: dt } };
  const mainRef = await put("main.json", main);
  const anchorInputs = Array.from({ length: 15 }, (_, i) => ({ recordId: `anchor-${i}`, input: { utterance: `fictional anchor ${i}` } }));
  const anchorProjection = await put("anchor-inputs.json", { records: anchorInputs }), anchorOriginal = await put("opaque-anchor.json", { originalPublicSource: true });
  await writeFile(path.join(root, "private/sources/official.txt"), "official synthetic source");
  const body = { path: "private/sources/official.txt", sha256: byteHash("official synthetic source") };
  const nrSource = { sourceId: "official", bodyArtifact: "sources/official.txt", bodySha256: body.sha256, rawSourceArtifact: body.path, rawSourceSha256: body.sha256 };
  const rankSource = { sourceId: "official", raw: body, body };
  const nonranking = { sources: [nrSource] }, ranking = { catalogSha256: manifest.catalogSha256, sources: [rankSource] };
  const components = [{ id: "nonranking", canonicalSha256: hash(nonranking.sources), manifest: await put("nonranking.json", nonranking) }, { id: "ranking", canonicalSha256: hash(ranking), manifest: await put("ranking.json", ranking) }];
  manifest.sourceSnapshotSha256 = components[0].canonicalSha256; manifest.rankingSourceSnapshotSha256 = components[1].canonicalSha256;
  manifest.implementationSha256 = hash([]);
  for (const row of manifest.cases) { row.sourceEvidenceIds = ["official"]; row.sourceSnapshotSha256 = components[row.layer === "ranking" ? 1 : 0].canonicalSha256; }
  const metadata = { ...policy, cases: manifest.cases };
  const metadataRef = await put("metadata.json", metadata);
  const dependencies: any = { schemaVersion: "saitu.case-source-dependencies.v7.1", ...policy, contract: "layer_primary_with_explicit_secondary_sources.v7.1", originalCaseMetadata: metadataRef, components,
    cases: manifest.cases.map((row: any) => { const c = components[row.layer === "ranking" ? 1 : 0]; return { caseId: row.caseId, inputSha256: row.inputSha256, answerSha256: row.answerSha256,
      primaryComponentId: c.id, primarySourceSnapshotSha256: c.canonicalSha256, requiredComponentIds: [c.id], sources: [{ sourceId: "official", componentId: c.id, componentSha256: c.canonicalSha256, sourceRecordSha256: hash(c.id === "ranking" ? rankSource : nrSource), raw: body, body }] }; }) };
  manifest.originalCaseMetadata = metadataRef; manifest.sourceDependencies = await put("dependencies.json", dependencies); manifest.caseSourceDependenciesSha256 = manifest.sourceDependencies.sha256;
  const productRef = await put("product.json", { cases: manifest.cases.map((row: any) => ({ caseId: row.caseId, inputSha256: row.inputSha256 })) });
  const reviews: any = { schemaVersion: "saitu.current-input-applicability-independent.v7.2", ...policy, contextId: "material-reviewer", bindings: { product: productRef, metadata: metadataRef,
    dependencies: manifest.sourceDependencies, exclusion: mainRef, public: mainProjection, anchors: anchorOriginal },
    method: { mainPublicRecordsRead: 143, supplementalAnchorInputsRead: 15, fullCurrentInputsRead: 800 }, formalExecution: { cases: 0 },
    rows: manifest.cases.map((row: any, i: number) => ({ ...row, answerBindingOpaqueFromAllowedMetadata: { answerSha256: row.answerSha256 }, contextId: "material-reviewer", sourceDependencyRecordSha256: hash(dependencies.cases[i]),
      materialApplicability: { decision: "applicable", finalImplementationRuntimeApproval: false }, publicDevelopmentExclusion: { decision: "distinct" }, answerOrRankingJudgmentIssued: false })) };
  const reviewRef = await put("material-review.json", reviews);
  const reviewSummary: any = { contextId: "material-reviewer", details: reviewRef, reviewedInputCases: 800, publicRecords: 143, supplementalAnchors: 15, semanticDecisions: { distinct: 800 }, materialInputBlockers: [] };
  const material: any = { schemaVersion: "saitu.material-applicability-adoption.v7.4", originalReview: reviewRef, originalReviewSummary: await put("material-summary.json", reviewSummary), originalCaseMetadata: metadataRef, sourceDependencies: manifest.sourceDependencies, originalFormalInput: productRef,
    cases: manifest.cases.map((row: any, i: number) => ({ caseId: row.caseId, inputSha256: row.inputSha256, answerSha256OpaqueMetadataOnly: row.answerSha256, materialDecision: "applicable", publicExclusionDecision: "distinct", finalExecutionBasisApproved: false,
      review: { ...reviewRef, pointer: `/rows/${i}`, rowCanonicalSha256: hash(reviews.rows[i]) }, metadata: { ...metadataRef, pointer: `/cases/${i}`, rowCanonicalSha256: hash(row) }, sourceDependency: { ...manifest.sourceDependencies, pointer: `/cases/${i}`, rowCanonicalSha256: hash(dependencies.cases[i]) } })) };
  const materialRef = await put("material-adoption.json", material);
  const adoption: any = { schemaVersion: "saitu.independent-public-exclusion-adoption.v7.2", contextId: "material-reviewer", mainManifest: mainRef, mainInputProjection: mainProjection,
    supplementalSource: anchorOriginal, supplementalInputProjection: anchorProjection, originalDevelopmentFamilyIds: families, originalDevelopmentTemplateFamilyIds: [], originalTemplateIdsUnknownNotFabricated: true,
    derivedFamilyFingerprintIds: df, derivedSourceTemplateFingerprintIds: dt, mainCanonicalInputSha256: unique(corpus.map(row => row.canonicalInputSha256)), supplementalCanonicalInputSha256: unique(anchorInputs.map(row => hash(row.input))), independentSemanticReview: reviewRef };
  const novice = corpus.find(row => row.recordId === "public-admission-02:v7-public-desktop-novice");
  const assertionRef = await put("public-assertion-input.json", { assertions: Array.from({ length: 20 }, (_, i) => `public assertion ${i}`) });
  const diagnostics = [];
  for (const name of ["review-diagnostic-01", "review-diagnostic-02"]) {
    const input = await put(`${name}-input.json`, fullInput), registered = { inputSha256: input.sha256, profileSha256: hash(profile), candidatePoolSha256: hash(records), publicInputSource: novice.source,
      expectedCheckKeys: Array.from({ length: 20 }, (_, i) => `${i}`), expectedAssertionsSha256: hash("public assertions"), expectedChecksSha256: assertionRef.sha256 };
    diagnostics.push({ recordId: name, input, registration: await put(`${name}-registration.json`, registered), profileSha256: hash(profile), candidatePoolSha256: hash(records), canonicalInputSha256: hash({ profile }), diagnosticSubmittedEnvelopeSha256: hash(fullInput),
      reusedPublicRecordId: novice.recordId, expectedAssertionsSha256: registered.expectedAssertionsSha256, expectedAssertionByteReference: assertionRef, additionalIndependentStudents: 0, additionalFormalCases: 0, diagnosticExecutionOutputsRead: false,
      originalFamilyId: null, originalTemplateFamilyId: null, derivedFamilyFingerprintId: novice.derivedFamilyId, derivedSourceTemplateFingerprintId: novice.derivedTemplateId });
  }
  const allInputs = unique([...exactEnvelopes, ...corpus.flatMap(row => [row.browserParameterSha256, row.diagnosticSubmittedEnvelopeSha256].filter(Boolean)), ...anchorInputs.map(row => hash(row.input)), ...diagnostics.flatMap(row => [row.canonicalInputSha256, row.diagnosticSubmittedEnvelopeSha256])]);
  const pub: any = { schemaVersion: "saitu.public-development-assembly.v7.4", ...policy, mainManifest: mainRef, mainInputProjection: mainProjection, independentAdoption: await put("independent-adoption.json", adoption), independentPerCaseMaterialReview: materialRef, original800IndependentReview: reviewRef,
    derivedReviewFingerprints: { familyIds: df, sourceTemplateIds: dt, notOriginalAuthorIds: true }, developmentFamilyIds: families, developmentTemplateFamilyIds: [], developmentInputSha256: allInputs,
    supplements: [{ kind: "synthetic_anchor_input_only", originalSource: anchorOriginal, inputProjection: anchorProjection, records: anchorInputs.map((row, i) => ({ recordId: row.recordId, inputSha256: hash(row.input), projection: { ...anchorProjection, pointer: `/records/${i}/input` } })) },
      { kind: "same_public_novice_review_diagnostic_input_reuses", records: diagnostics }] };
  const cfg: any = { ...policy, schemaVersion: "saitu.ranking-registration-config.v7.1", purpose: "ai_proxy_acceptance", algorithms: ["B", "C"], profileCount: 120, repeats: 5, rankingReports: 1200, reuseAlgorithm: "C", candidatePolicy: "full_core_reviewed", seed: 1, reviewSampleSeed: 1, runtime: EVALUATION_POLICY.runtime, rankingProtocol: EVALUATION_POLICY.ranking, reviewProtocol: EVALUATION_POLICY.review, executionPhase: "formal", invocationConcurrency: 1,
    ...Object.fromEntries(["inputSha256", "profileSliceProtocolSha256", "runtimeSourceBindingSha256", "runtimeConfigurationSha256", "publicSpecificationSha256", "finalPromptSha256", "productionProfileAdapterSha256"].map(key => [key, hash(key)])),
    productInputSha256: productRef.sha256, catalogSha256: manifest.catalogSha256, implementationSha256: manifest.implementationSha256, candidatePoolSha256: hash(records), sourceSnapshotSha256: manifest.sourceSnapshotSha256, rankingSourceSnapshotSha256: manifest.rankingSourceSnapshotSha256,
    batchPolicy: { order: "profile_then_repeat_then_arm", runsPerBatch: 2, maxCReservationMicros: 1, maxHttpPerCInvocation: 5, measuredBoundEvidenceSha256: hash("cost") }, productBatchPolicy: { runsPerBatch: 1, maxReservationMicros: 1, maxHttpPerInvocation: 1, measuredBoundEvidenceSha256: hash("cost") }, publicAdmission: { path: "unused-admission.json", sha256: hash("admission") } };
  Object.assign(manifest, { implementationSha256: cfg.implementationSha256, runtimeSourceBindingSha256: cfg.runtimeSourceBindingSha256, runtimeConfigurationSha256: cfg.runtimeConfigurationSha256, finalPromptSha256: cfg.finalPromptSha256, productionProfileAdapterSha256: cfg.productionProfileAdapterSha256,
    developmentFamilyIds: families, developmentTemplateFamilyIds: [], developmentInputSha256: allInputs });
  cfg.profileSliceProtocolSha256 = manifest.profileSliceProtocolSha256;
  migration.reviewBasis = { publicSpecificationSha256: cfg.publicSpecificationSha256, catalogSha256: cfg.catalogSha256, implementationSha256: cfg.implementationSha256, runtimeConfigurationSha256: cfg.runtimeConfigurationSha256 };
  migration.rows.forEach((row: any, i: number) => { row.replacement = manifest.cases[i]; row.applicabilityReview.basisSha256 = hash(migration.reviewBasis); });
  migration.independentReview.decisionsSha256 = hash(migration.rows); migration.independentReview.basisSha256 = hash(migration.reviewBasis);
  const basis = { ...migration.reviewBasis, runtimeSourceBindingSha256: cfg.runtimeSourceBindingSha256, promptSha256: cfg.finalPromptSha256, productionProfileAdapterSha256: cfg.productionProfileAdapterSha256, frozenAt: manifest.implementationFrozenAt };
  const caseBindings = manifest.cases.map((row: any, i: number) => ({ caseId: row.caseId, layer: row.layer, familyId: row.familyId, templateFamilyId: row.templateFamilyId, inputSha256: row.inputSha256, answerSha256: row.answerSha256, sourceSnapshotSha256: row.sourceSnapshotSha256, materialReviewRowSha256: hash(reviews.rows[i]), sourceDependencyRowSha256: hash(dependencies.cases[i]) }));
  const fingerprintContract = { schemaVersion: "saitu.public-development-fingerprints.v7.2", mainManifestSha256: mainRef.sha256, recipesSha256: main.recipes.sha256, originalFamilyIds: families, originalTemplateIds: [], familyFingerprintIds: df, sourceTemplateFingerprintIds: dt };
  const adapter: any = { schemaVersion: "saitu.production-profile-adapter-review.v7.1", ...policy, passed: true, contextId: "final-adapter-reviewer", basisSha256: hash(basis), caseBindingsSha256: hash(caseBindings), profileAdapterSha256: cfg.productionProfileAdapterSha256, inputSha256: productRef.sha256,
    casesChecked: 800, rankingProfilesChecked: 120, providerCalls: 0, sealedKeysRead: false, rankingLabelsRead: false, reviewedAt: "2026-11-09T00:00:05Z" };
  const final: any = { schemaVersion: "saitu.independent-execution-applicability-adoption.v7.1", ...policy, passed: true, contextId: "final-execution-reviewer", reviewedAt: "2026-11-09T00:00:10Z", basis, materialReview: materialRef, fingerprintContractSha256: hash(fingerprintContract), caseBindingsSha256: hash(caseBindings), migrationDecisionsSha256: hash(migration.rows), productionAdapterReview: await put("adapter-review.json", adapter) };
  const contract: any = { schemaVersion: DEVELOPMENT_CONSUMER_VERSION, originalTemplateProvenance: UNKNOWN_TEMPLATE_CONTRACT, materialReview: materialRef, fingerprintContractSha256: hash(fingerprintContract) };
  const persist = async () => {
    const pubRef = await put("public-composite.json", pub); final.publicDevelopmentManifest = pubRef;
    contract.publicDevelopmentManifest = pubRef; contract.finalExecutionAdoption = await put("final-adoption.json", final);
    for (const target of [manifest, cfg]) Object.assign(target, { publicDevelopmentContract: structuredClone(contract), publicDevelopmentManifest: pubRef, publicDevelopmentManifestSha256: pubRef.sha256 });
    cfg.migration = await put("migration.json", migration); cfg.migrationSha256 = cfg.migration.sha256; manifest.migrationSha256 = cfg.migrationSha256;
    cfg.challengeManifest = await put("challenge.json", manifest); cfg.challengeManifestSha256 = cfg.challengeManifest.sha256;
  };
  await persist();
  const sourceProof = () => verifyCaseSourceDependencies({ evidenceRoot: root, manifest, config: cfg });
  return { root, manifest, migration, cfg, pub, material, reviews, adoption, main, final, adapter, contract, put, persist, sourceProof, productFixture: f,
    async verify() { return verifyDevelopmentExclusions({ evidenceRoot: root, manifest, config: cfg, migration, registeredAt: "2026-11-09T00:01:00Z" }); },
    async dispose() { await rm(root, { recursive: true, force: true }); } };
}

describe("versioned public-development consumer read-through", () => {
  it("reads all143/15/800 bindings and permits unknown original templates only under the fully reviewed contract", async () => {
    const f = await fixture(); try {
      expect(inspectChallengeManifest(f.manifest)).toEqual([]);
      expect(f.pub.derivedReviewFingerprints.familyIds).toHaveLength(42);
      expect(f.pub.derivedReviewFingerprints.familyIds).not.toContain(`pub-family.v7.2:${f.main.records.find((row: any) => row.currentAdapterProjection).currentAdapterProjection.profileFamilySha256}`);
      expect(await f.verify()).toMatchObject({ cases: 800, mainRecords: 143, anchorInputs: 15, diagnosticReuses: 2, additionalIndependentStudents: 0, originalFamilies: 36, originalTemplates: 0 });
      const old = evaluationFixture().manifest; old.developmentTemplateFamilyIds = [];
      expect(inspectChallengeManifest(old)).toContain("public_development_exclusion_inventory_required");
      old.unknownOriginalTemplate = true; expect(inspectChallengeManifest(old)).toContain("public_development_exclusion_inventory_required");
    } finally { await f.dispose(); }
  });
  it.each(["family-omission", "input-omission", "extra-input", "derived-as-original", "anchor-omission", "diagnostic-omission", "derived-fingerprint-omission", "unreviewed-adapter-family-injection"])("rejects incomplete or substituted arrays after outer rehash: %s", async mode => {
    const f = await fixture(); try {
      if (mode === "family-omission") f.pub.developmentFamilyIds.pop();
      if (mode === "input-omission") f.pub.developmentInputSha256.pop();
      if (mode === "extra-input") f.pub.developmentInputSha256.push(hash("injected"));
      if (mode === "derived-as-original") f.pub.developmentTemplateFamilyIds = [f.pub.derivedReviewFingerprints.sourceTemplateIds[0]];
      if (mode === "anchor-omission") f.pub.supplements[0].records.pop();
      if (mode === "diagnostic-omission") f.pub.supplements[1].records.pop();
      if (mode === "derived-fingerprint-omission") f.pub.derivedReviewFingerprints.familyIds.pop();
      if (mode === "unreviewed-adapter-family-injection") f.pub.derivedReviewFingerprints.familyIds.push(`pub-family.v7.2:${f.main.records.find((row: any) => row.currentAdapterProjection).currentAdapterProjection.profileFamilySha256}`);
      await f.persist(); await expect(f.verify()).rejects.toThrow();
    } finally { await f.dispose(); }
  });
  it.each(["missing-contract", "unknown-version", "wrong-fingerprint", "missing-final", "material-only-final", "wrong-final-basis", "self-adoption", "stale-prompt", "stale-adapter"])("never converts material review into final execution approval: %s", async mode => {
    const f = await fixture(); try {
      if (mode === "material-only-final") f.final.passed = false;
      if (mode === "wrong-final-basis") f.final.basis.runtimeConfigurationSha256 = hash("other-runtime");
      if (mode === "self-adoption") f.final.contextId = "implementer";
      if (mode === "stale-adapter") { f.adapter.basisSha256 = hash("old-basis"); f.final.productionAdapterReview = await f.put("adapter-review.json", f.adapter); }
      await f.persist();
      if (mode === "missing-contract") delete f.cfg.publicDevelopmentContract;
      if (mode === "unknown-version") f.cfg.publicDevelopmentContract.schemaVersion = "unregistered-version";
      if (mode === "wrong-fingerprint") f.cfg.publicDevelopmentContract.fingerprintContractSha256 = hash("partial");
      if (mode === "missing-final") delete f.cfg.publicDevelopmentContract.finalExecutionAdoption;
      if (mode === "stale-prompt") f.cfg.finalPromptSha256 = null;
      await expect(f.verify()).rejects.toThrow();
    } finally { await f.dispose(); }
  });
  it.each(["missing-main", "main-byte-tamper", "anchor-byte-tamper", "missing-case", "duplicate-case", "wrong-input", "wrong-source", "self-review", "wrong-diagnostic-profile", "wrong-diagnostic-pool", "wrong-diagnostic-assertions", "fake-new-student"])("rejects missing/stale/duplicate/scope-substituted originals: %s", async mode => {
    const f = await fixture(); try {
      if (mode === "missing-main") await rm(path.join(f.root, "main.json"));
      if (mode === "main-byte-tamper") await writeFile(path.join(f.root, "main.json"), "{}");
      if (mode === "anchor-byte-tamper") await writeFile(path.join(f.root, "anchor-inputs.json"), "{}");
      if (["missing-case", "duplicate-case", "wrong-input", "wrong-source", "self-review"].includes(mode)) {
        if (mode === "missing-case") f.material.cases.pop();
        if (mode === "duplicate-case") f.material.cases[1] = f.material.cases[0];
        if (mode === "wrong-input") f.material.cases[0].inputSha256 = hash("different");
        if (mode === "wrong-source") f.material.cases[0].sourceDependency.rowCanonicalSha256 = hash("different");
        if (mode === "self-review") f.manifest.implementationAuthorContextIds.push("material-reviewer");
        if (mode !== "self-review") { const ref = await f.put("material-adoption.json", f.material); f.pub.independentPerCaseMaterialReview = ref; f.final.materialReview = ref; f.contract.materialReview = ref; }
      }
      const d = f.pub.supplements[1].records[0];
      if (mode === "wrong-diagnostic-profile") d.profileSha256 = hash("another-profile");
      if (mode === "wrong-diagnostic-pool") d.candidatePoolSha256 = hash("short-pool");
      if (mode === "wrong-diagnostic-assertions") d.expectedAssertionsSha256 = hash("nineteen");
      if (mode === "fake-new-student") d.additionalIndependentStudents = 1;
      await f.persist(); await expect(f.verify()).rejects.toThrow();
    } finally { await f.dispose(); }
  });
  it("preserves existing source-byte/root checks rather than trusting the public review", async () => {
    const f = await fixture(); try { await writeFile(path.join(f.root, "private/sources/official.txt"), "changed"); await expect(f.verify()).rejects.toThrow("bytes_changed"); }
    finally { await f.dispose(); }
  });
  it("rejects private-key references, including a same-root public-looking symlink, before any key read", async () => {
    const f = await fixture(); try {
      sensitiveReads.length = 0;
      const ref = { path: "private/keys.json", sha256: hash("secret") };
      f.pub.mainManifest = ref; await f.persist(); await expect(f.verify()).rejects.toThrow("private_key_or_grade_reference_forbidden");
      await writeFile(path.join(f.root, ref.path), "secret"); await symlink(path.join(f.root, ref.path), path.join(f.root, "public-alias.json"));
      f.pub.mainManifest = { ...ref, path: "public-alias.json" }; await f.persist(); await expect(f.verify()).rejects.toThrow("private_key_or_grade_realpath_forbidden");
      expect(sensitiveReads).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("both actual entrypoints reject incomplete public scope before any private product/key/observation read", async () => {
    const f = await fixture(); try {
      f.pub.developmentInputSha256.pop(); await f.persist(); sensitiveReads.length = 0;
      await expect(createRegistration(f.cfg, { repositoryRoot: f.root, now: "2026-11-09T00:01:00Z" })).rejects.toThrow("development_exclusions:");
      await expect(loadScoringOriginals({ evidenceRoot: f.root, bundle: { migration: f.migration, manifest: { ...f.manifest, openedAt: "2026-11-09T00:03:00Z" }, productOriginals: { path: "private/product-originals.json", sha256: hash("not-to-be-read") } },
        ranking: { registration: { registeredAt: "2026-11-09T00:01:00Z", config: f.cfg }, matrix: {} } })).rejects.toThrow("development_exclusions:");
      expect(sensitiveReads).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("binds the read-through hashes into an actual synthetic raw-reader proof and invalidates it on bundle mutation", async () => {
    const f = await fixture(); try {
      const fixture = f.productFixture, openedAt = "2026-11-09T00:03:00Z", producer = { path: "scripts/competitions/v7/evaluation-executor.mjs", sha256: hash("synthetic-frozen-producer") };
      const nonranking = fixture.bundle.observations.filter((row: any) => row.algorithm !== "C");
      const binding = fixture.matrix.freezeBinding;
      const approval = await f.put("approval.json", { syntheticApprovalBytes: true });
      const scope = { grantVersion: "saitu.v7.top5.v1", runId: "synthetic-formal", phase: "formal", authorizedPhase: "formal", authorizedEffort: "stage", effortPolicy: EVALUATION_POLICY.runtime.effortPolicy, effortPolicySha256: EVALUATION_POLICY.runtime.effortPolicySha256, authorizationPolicySha256: approval.sha256,
        environmentAuthorizationPolicySha256: approval.sha256, authorizationPolicySnapshot: approval, evaluationPolicySha256: POLICY_SHA256, executionRuntimeConfigurationSha256: hash("synthetic-execution-runtime"), callLimit: 1, fundingLimitCny: 1 };
      const receipts = nonranking.map((row: any) => ({ schemaVersion: "saitu.product-execution-receipt.v7.1", invocationId: row.invocationId, observationSha256: hash(row), inputSha256: row.inputSha256,
        producerSha256: producer.sha256, freezeBinding: binding, executionRuntimeConfigurationSha256: scope.executionRuntimeConfigurationSha256, executionScope: scope, events: row.events, ledgerRows: [] }));
      const execution: any = { schemaVersion: "saitu.product-execution-manifest.v7.1", ...policy, originalNonrankingSlots: 680, productInputSha256: f.cfg.productInputSha256, producer, freezeBinding: binding, openedAt,
        originalAttempts: [await f.put("synthetic-attempt.json", { synthetic: true })], observations: await f.put("synthetic-observations.json", nonranking), receipts: await f.put("synthetic-receipts.json", receipts), executionScopes: [scope] };
      const original: any = { schemaVersion: "saitu.product-originals.v7.1", ...policy, freezeBinding: binding, openedAt, producer, executionManifest: await f.put("synthetic-execution.json", execution) };
      for (const key of ["cases", "keys", "reviews", "sources"]) original[key] = await f.put(`synthetic-${key}.json`, (fixture.bundle as any)[key]);
      const productOriginals = await f.put("synthetic-product-originals.json", original);
      const bundle = { ...fixture.bundle, migration: f.migration, manifest: { ...f.manifest, openedAt }, productOriginals };
      const registration = { registeredAt: "2026-11-09T00:01:00Z", config: f.cfg, implementation: [producer] };
      const ranking = { registration, matrix: fixture.matrix, freezeManifestSha256: hash("synthetic-matrix-freeze") };
      const proof = await loadScoringOriginals({ evidenceRoot: f.root, bundle, ranking });
      expect(proof).toMatchObject({ publicDevelopmentManifestSha256: f.cfg.publicDevelopmentManifestSha256, materialReviewSha256: f.contract.materialReview.sha256,
        finalExecutionAdoptionSha256: f.contract.finalExecutionAdoption.sha256, publicDevelopmentVerification: { cases: 800, mainRecords: 143, anchorInputs: 15, diagnosticReuses: 2 } });
      expect(isVerifiedOriginals(proof, { bundle, matrix: fixture.matrix, registration })).toBe(true);
      bundle.manifest.developmentInputSha256 = [hash("substituted-after-proof")];
      expect(isVerifiedOriginals(proof, { bundle, matrix: fixture.matrix, registration })).toBe(false);
    } finally { await f.dispose(); }
  });
  it("rejects incomplete public arrays before a rehashed source component can read a private key", async () => {
    const f = await fixture(); try {
      expect((await f.verify()).cases).toBe(800);
      f.pub.developmentInputSha256.pop();
      const secret = await f.put("private/keys.json", { syntheticOnly: true });
      const dependency = JSON.parse(await readFile(path.join(f.root, f.manifest.sourceDependencies.path), "utf8"));
      const component = dependency.components.find((row: any) => row.id === "nonranking");
      const snapshot = { sources: [{ sourceId: "official", rawSourceArtifact: secret.path, rawSourceSha256: secret.sha256, bodyArtifact: "keys.json", bodySha256: secret.sha256 }] };
      component.manifest = await f.put("injected-source-component.json", snapshot); component.canonicalSha256 = hash(snapshot.sources);
      f.cfg.sourceSnapshotSha256 = component.canonicalSha256; f.manifest.sourceSnapshotSha256 = component.canonicalSha256;
      f.manifest.sourceDependencies = await f.put("injected-source-dependencies.json", dependency); f.manifest.caseSourceDependenciesSha256 = f.manifest.sourceDependencies.sha256;
      await f.persist(); sensitiveReads.length = 0;
      await expect(createRegistration(f.cfg, { repositoryRoot: f.root, now: "2026-11-09T00:01:00Z" })).rejects.toThrow("development_exclusions:");
      await expect(loadScoringOriginals({ evidenceRoot: f.root, bundle: { migration: f.migration, manifest: { ...f.manifest, openedAt: "2026-11-09T00:03:00Z" }, productOriginals: { path: "private/product-originals.json", sha256: hash("unused") } },
        ranking: { registration: { registeredAt: "2026-11-09T00:01:00Z", config: f.cfg }, matrix: {} } })).rejects.toThrow("development_exclusions:");
      expect(sensitiveReads).toEqual([]);
    } finally { await f.dispose(); }
  });
  it.each(["missing-metadata", "incomplete-public-metadata", "wrong-metadata-sha", "legacy-bypass-flag", "complete-public-positive-control"])("the actual CLI gates its bundle read using independent metadata: %s", async mode => {
    const f = await fixture(); try {
      const initialProof = await f.verify();
      if (mode === "incomplete-public-metadata") { f.pub.developmentInputSha256.pop(); await f.persist(); }
      const registration = { schemaVersion: "saitu.ranking-registration.v7.1", ...policy, registeredAt: "2026-11-09T00:01:00Z", inputOpened: false, formalRunsExecuted: 0, config: f.cfg,
        implementation: [], implementationSha256: f.cfg.implementationSha256, publicDevelopmentVerification: initialProof };
      const metadata = await f.put("registration.public.json", registration);
      const input = path.join(f.root, "synthetic-key-output-bundle.json"), trace = path.join(f.root, "cli-trace.json"), bootstrap = path.join(f.root, "cli-bootstrap.mjs");
      await writeFile(input, JSON.stringify({ keys: [{ syntheticOnly: true }], observations: [], rankingGold: {} }));
      const score = path.resolve("scripts/competitions/v7/evaluation-score.mjs");
      const args = ["--open", "--input", input, "--input-sha256", hash("unused"), "--ranking-run", path.join(f.root, "unused-ranking"), "--freeze-manifest-sha256", hash("unused"), "--output", path.join(f.root, "unused-result.json")];
      if (mode !== "missing-metadata") args.push("--registration", metadata.path, "--registration-sha256", mode === "wrong-metadata-sha" ? hash("other-metadata") : metadata.sha256, "--evidence-root", f.root);
      if (mode === "legacy-bypass-flag") args.push("--legacy-synthetic");
      const code = `import fs from 'node:fs';import fsp from 'node:fs/promises';import path from 'node:path';import{syncBuiltinESMExports}from'node:module';import{pathToFileURL}from'node:url';const events=[];const original=fsp.readFile;process.on('exit',()=>fs.writeFileSync(${JSON.stringify(trace)},JSON.stringify(events)));fsp.readFile=async(filename,...rest)=>{if(path.resolve(String(filename))===${JSON.stringify(input)}){events.push('SYNTHETIC_BUNDLE_READ');throw Error('SYNTHETIC_BUNDLE_SENTINEL_NO_BYTES_RETURNED');}if(path.resolve(String(filename)).startsWith(${JSON.stringify(path.resolve("artifacts") + path.sep)}))throw Error('REAL_ARTIFACT_READ_FORBIDDEN');return original(filename,...rest)};syncBuiltinESMExports();globalThis.fetch=()=>{throw Error('HTTP_FORBIDDEN')};process.argv=[process.execPath,${JSON.stringify(score)},...${JSON.stringify(args)}];await import(pathToFileURL(${JSON.stringify(score)}));`;
      await writeFile(bootstrap, code);
      const exec = promisify(execFile);
      const result = await exec(process.execPath, [bootstrap], { env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" }, maxBuffer: 128000 }).then(r => ({ stderr: r.stderr }), e => ({ stderr: String(e.stderr) }));
      const events = JSON.parse(await readFile(trace, "utf8"));
      expect(events).toEqual(mode === "complete-public-positive-control" ? ["SYNTHETIC_BUNDLE_READ"] : []);
      if (mode === "missing-metadata") expect(result.stderr).toContain("evaluation_option_required:--registration");
      if (mode === "incomplete-public-metadata") expect(result.stderr).toContain("development_exclusions:");
      if (mode === "wrong-metadata-sha") expect(result.stderr).toContain("evaluation_reference_bytes_changed");
      if (mode === "legacy-bypass-flag") expect(result.stderr).toContain("unsupported_or_duplicate_evaluation_option");
      if (mode === "complete-public-positive-control") expect(result.stderr).toContain("SYNTHETIC_BUNDLE_SENTINEL_NO_BYTES_RETURNED");
    } finally { await f.dispose(); }
  });
  it.each(["registration-unknown-carrier", "config-unknown-carrier", "formal-runs-wrong-type"])("the metadata roots reject E3 carriers: %s", async mode => {
    const f = await fixture(); try {
      const proof = await f.verify();
      const registration: any = { schemaVersion: "saitu.ranking-registration.v7.1", ...policy, registeredAt: "2026-11-09T00:01:00Z", inputOpened: false, formalRunsExecuted: 0,
        config: f.cfg, implementation: [], implementationSha256: f.cfg.implementationSha256, publicDevelopmentVerification: proof };
      const carrier = { keys: [{ syntheticOnly: true }], observations: [{ syntheticOnly: true }], rankingGold: { syntheticOnly: true } };
      if (mode === "registration-unknown-carrier") registration.opaque = carrier;
      if (mode === "config-unknown-carrier") registration.config.opaque = carrier;
      if (mode === "formal-runs-wrong-type") registration.formalRunsExecuted = carrier;
      if (mode === "config-unknown-carrier") expect(() => validateRegistrationMetadata(registration)).toThrow("unknown_or_invalid_v7_registration_config_field");
      const reference = await f.put("registration.public.json", registration); sensitiveReads.length = 0;
      await expect(preflightScoringRegistration({ evidenceRoot: f.root, reference })).rejects.toThrow(mode === "registration-unknown-carrier" ? "metadata_only_scoring_registration_required" : mode === "config-unknown-carrier" ? "unknown_or_invalid_v7_registration_config_field" : "v7_registration_metadata_scalar_or_structure_invalid");
      expect(sensitiveReads).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("accepts the complete production-shaped v7.1 metadata including the versioned public contract and declared annotations", async () => {
    const f = await fixture(); try {
      f.cfg.materialApplicabilityReview = { ...f.contract.materialReview };
      f.cfg.preparation = { status: "synthetic_frozen_metadata", productInput: { path: "product.json", sha256: f.cfg.productInputSha256 } };
      const proof = await f.verify();
      const registration = { schemaVersion: "saitu.ranking-registration.v7.1", ...policy, registeredAt: "2026-11-09T00:01:00Z", inputOpened: false, formalRunsExecuted: 0,
        config: f.cfg, implementation: [], implementationSha256: f.cfg.implementationSha256, publicDevelopmentVerification: proof };
      const reference = await f.put("registration.public.json", registration);
      const result = await preflightScoringRegistration({ evidenceRoot: f.root, reference });
      expect(result.registration).toEqual(registration);
      expect(result.registrationSha256).toBe(reference.sha256);
      expect(result.publicDevelopmentVerification).toMatchObject({ cases: 800, mainRecords: 143, anchorInputs: 15 });
    } finally { await f.dispose(); }
  });
  it.each([1, "0", false, null, { keys: [] }])("requires the literal zero formal-run scalar: %j", value => {
    expect(() => validateRegistrationMetadata({ schemaVersion: "saitu.ranking-registration.v7.1", ...policy, registeredAt: "2026-11-09T00:01:00Z", inputOpened: false,
      formalRunsExecuted: value, config: {}, implementation: [], implementationSha256: hash([]) })).toThrow("v7_registration_metadata_scalar_or_structure_invalid");
  });
  it.each([true, "false", 0, null])("requires the literal false input-opened scalar: %j", value => {
    expect(() => validateRegistrationMetadata({ schemaVersion: "saitu.ranking-registration.v7.1", ...policy, registeredAt: "2026-11-09T00:01:00Z", inputOpened: value,
      formalRunsExecuted: 0, config: {}, implementation: [], implementationSha256: hash([]) })).toThrow("v7_registration_metadata_scalar_or_structure_invalid");
  });
});
