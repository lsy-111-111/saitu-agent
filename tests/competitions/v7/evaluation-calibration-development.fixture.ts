// Synthetic fixture copied from the preserved v7.1 test, then extended with
// explicit fictional INPUT values for the new delta reader. No real artifacts.
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { byteHash, canonicalHash, POLICY_VERSION, POLICY_SHA256, EVALUATION_POLICY } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { DEVELOPMENT_CONSUMER_VERSION, UNKNOWN_TEMPLATE_CONTRACT, verifyDevelopmentExclusions } from "../../../scripts/competitions/v7/evaluation-development-exclusions.mjs";
import { verifyCaseSourceDependencies } from "../../../scripts/competitions/v7/evaluation-source-dependencies.mjs";
import { evaluationFixture } from "./evaluation.fixture";
const policy = { policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256 };
const hash = canonicalHash;
const unique = (values: string[]) => [...new Set(values)].sort();
/** Entirely synthetic metadata. No real public/formal input, answer or label file. */
async function fixture({ concreteInputValues = true } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "saitu-development-consumer-")));
  for (const name of ["src", "db", "scripts", "ops", "public", "private/sources"]) await mkdir(path.join(root, name), { recursive: true });
  const put = async (member: string, value: any) => { const data = Buffer.from(JSON.stringify(value)); await writeFile(path.join(root, member), data); return { path: member, sha256: byteHash(data) }; };
  const f = evaluationFixture(), manifest: any = structuredClone(f.manifest), migration: any = structuredClone(f.migration);
  if (concreteInputValues) manifest.cases.forEach((row: any, i: number) => { row.inputSha256 = hash({ text: `fictional formal input ${i}` }); if (row.keyReview) row.keyReview.inputSha256 = row.inputSha256; });
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
  const productRef = await put("product.json", { cases: manifest.cases.map((row: any, i: number) => ({ caseId: row.caseId, inputSha256: row.inputSha256, input: { text: `fictional formal input ${i}` } })) });
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
  migration.rows.forEach((row: any, i: number) => { row.replacement = manifest.cases[i]; row.applicabilityReview.basisSha256 = hash(migration.reviewBasis); row.applicabilityReview.inputSha256 = manifest.cases[i].inputSha256; });
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

export { fixture as syntheticDevelopmentCalibrationFixture };
