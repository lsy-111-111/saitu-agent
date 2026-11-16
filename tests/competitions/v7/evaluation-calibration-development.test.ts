import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalHash as hash, POLICY_VERSION, POLICY_SHA256 } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { CALIBRATION_DEVELOPMENT_CONSUMER_VERSION, DEVELOPMENT_CONSUMER_VERSION, verifyDevelopmentExclusions, verifyPublicCalibrationDevelopmentDelta } from "../../../scripts/competitions/v7/evaluation-development-exclusions.mjs";
import { preflightScoringRegistration } from "../../../scripts/competitions/v7/evaluation-registration.mjs";
import { syntheticDevelopmentCalibrationFixture } from "./evaluation-calibration-development.fixture";

const sensitiveReads = vi.hoisted(() => [] as string[]);
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: async (...args: any[]) => {
    if (/private[\\/](?:keys|observations|product-originals)\.json|judge-[ab][\\/]|public-calibration-v3[\\/]comparison\.json/.test(String(args[0]))) {
      sensitiveReads.push(String(args[0])); throw new Error("PRIVATE_OR_CALIBRATION_ANSWERS_READ");
    }
    return (actual.readFile as any)(...args);
  } };
});
const policy = { policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256 };
const unique = (values: string[]) => [...new Set(values)].sort();
const pick = (value: any, keys: string[]) => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));

async function fixture() {
  const f = await syntheticDevelopmentCalibrationFixture();
  const old = structuredClone(f.pub), previous = await f.put("previous-v4.json", old);
  const anchors = old.supplements[0], novice = f.main.records.find((row: any) => row.recordId === "public-admission-02:v7-public-desktop-novice");
  const profileInput = JSON.parse(await readFile(path.join(f.root, old.supplements[1].records[0].input.path), "utf8"));
  const source: any = { pairCount: 12, pairs: Array.from({ length: 12 }, (_, i) => ({ pairId: `fictional-calibration-${i}`, kind: "fictional_input",
    student: { studentId: `fictional-student-${i}`, originalUtterance: `fictional story ${i}`, goalVerbatim: `fictional goal ${i}`, necessaryState: { known: true } },
    activity: { activityId: `fictional-activity-${i}`, sourceRanges: [{ sourceId: `fictional-source-${i}` }], facts: [{ factId: `fictional-fact-${i}`, informationKind: "task", sourceRange: "one", scope: "fictional", statement: `fictional task ${i}` }] },
    judgeAid: { studentGoalAndConstraints: "", candidateEvidence: "", personalRoute: "", benefitAndRemainingGap: "", unknownAndScope: "" } })) };
  let sourceRef = await f.put("neutral-inputs.json", source);
  const records: any[] = source.pairs.map((pair: any, i: number) => {
    const student = pick(pair.student, ["originalUtterance", "goalVerbatim", "necessaryState", "earlierUtterance", "correctionScope"]), activity = pair.activity.facts.map((fact: any) => pick(fact, ["informationKind", "sourceRange", "scope", "statement"]));
    return { recordId: pair.pairId, kind: "synthetic_public_calibration", reference: { ...sourceRef, pointer: `/pairs/${i}` }, sourcePairId: pair.pairId,
      studentId: pair.student.studentId, activityId: pair.activity.activityId, sourceIds: pair.activity.sourceRanges.map((item: any) => item.sourceId), factIds: pair.activity.facts.map((item: any) => item.factId),
      originalFamilyId: null, originalTemplateFamilyId: null, originalIdsUnknownNotFabricated: true, canonicalPairSha256: hash(pair), canonicalInputProjectionSha256: hash({ student: pair.student, activity: pair.activity }),
      studentContentSha256: hash(student), activityFactContentSha256: hash(activity), derivedStudentStoryFingerprint: `pc3-story.v7.3:${hash(student)}`, derivedMaterialFingerprint: `pc3-material.v7.3:${hash(activity)}`,
      derivedFingerprintsAreNotOriginalFamilyOrTemplateIds: true, developmentExposure: true, formalUseEligibility: "exclude_same_student_activity_substantive_content_and_derivatives", finalAdoption: null };
  });
  const proposal: any = { schemaVersion: "saitu.public-development-exclusion-delta-proposal.v7.3", contextId: "calibration-reviewer", preservedMain143Manifest: old.mainManifest,
    preservedOld15InputProjection: anchors.inputProjection, new12NeutralInputReference: sourceRef, new12Records: records,
    originalDevelopmentFamilyExclusionsRetainedByReference: old.developmentFamilyIds, originalDevelopmentTemplateExclusionsRetainedByReference: [],
    originalTemplateIdsUnknownNotFabricated: true, finalSourceFreeze: null, finalAdoption: null, registrationExecuted: false };
  const component: any = { schemaVersion: "saitu.public-development-calibration-component.v7.1", ...policy, records: structuredClone(records), inputSource: sourceRef,
    originalFamilyIds: [], originalTemplateFamilyIds: [], independentStudentsClaimed: 0, independentTemplatesClaimed: 0, finalAdoption: null };
  const novelty: any = { schemaVersion: "saitu.public-calibration.novelty-independent.v7.3", contextId: "calibration-reviewer", bindings: { newInputs: sourceRef, oldAnchors: anchors.inputProjection },
    newSpecificStories: 12, statisticallyIndependentStudentsClaimed: 0, independentAnswerTemplatesClaimed: 0, newReviewerAnswersRead: false, comparisonRead: false, rankingGradesIssued: false,
    rows: records.map((row, i) => ({ pairId: row.recordId, reference: { ...sourceRef, pointer: `/pairs/${i}` }, inputProjectionSha256: row.canonicalInputProjectionSha256,
      comparisonOldAnchorIds: anchors.records.map((item: any) => item.recordId), specificStoryNovelty: "new_specific_student_activity_combination", sharedBoundaryPatternsDisclosed: true,
      independentStatisticalStudentOrTemplateClaim: false, policyChanged: false, relevanceGradeIssued: false })) };
  const metadata = JSON.parse(await readFile(path.join(f.root, f.material.originalCaseMetadata.path), "utf8"));
  const metadataFields = ["caseId", "layer", "familyId", "templateFamilyId", "taskGroup", "scope", "inputSha256", "sourceSnapshotSha256", "authorContextId", "sourceEvidenceIds"];
  const delta: any = { schemaVersion: "saitu.public-calibration.formal800-input-delta-independent.v7.3", contextId: "calibration-reviewer", classification: "restricted_input_evidence_no_answers",
    changedApplicability: 0, changedPublicExclusion: 0, replacementRequiredCaseIds: [], uncertainCaseIds: [], confirmedContaminationCaseIds: [],
    prior143And15ReviewReusedWithinSameInputAndPolicyBindings: true, prior143NotClaimedAsFreshSemanticReviewHere: true, relevanceLevelsOrKeysRead: false, formalExecutions: { formal800: 0, ranking1200: 0 },
    rows: metadata.cases.map((item: any, i: number) => {
      const safe = pick(item, metadataFields);
      return { caseId: item.caseId, layer: item.layer, familyId: item.familyId, templateFamilyId: item.templateFamilyId, taskGroup: item.taskGroup, inputSha256: item.inputSha256,
        inputReference: { ...f.material.originalFormalInput, pointer: `/cases/${i}/input` }, metadataReference: { ...f.material.originalCaseMetadata, pointer: `/cases/${i}`,
          consumedProjectionSha256: hash(safe), consumedFieldNames: Object.keys(safe) }, inputEvidence: [{ pointer: `/cases/${i}/input/text`, valueSha256: hash(`fictional formal input ${i}`) }],
        materialApplicabilityDelta: { currentDecision: "retain_prior_input_material_applicability", changed: false, finalRuntimeApprovalIssued: false, policySha256: POLICY_SHA256, priorDecisionSource: old.original800IndependentReview },
        publicExposureDelta: { currentDecision: "distinct_from_new12", changed: false, semanticReason: `Fictional input ${i} has a different specific story.`, lexicalThresholdUsed: false, comparedNewRecordIds: records.map(row => row.recordId) },
        rankingGradeOrAnswerJudgmentIssued: false };
    }) };
  const diagnosticRegistration: any = { inputSha256: old.supplements[1].records[0].input.sha256, profileSha256: novice.actualProfileSha256, publicInputSource: novice.source, inputReuse: "same fictional input" };
  const reuse: any = { schemaVersion: "saitu.development-diagnostic-reuse-proposal.v7.3", contextId: "calibration-reviewer", noObservationsOpened: true, finalAdoption: null, oldManifestBinding: old.mainManifest,
    record: { recordId: "explanation-diagnostic-02", kind: "public_diagnostic_reuse", inputReference: old.supplements[1].records[0].input, reuseOf: novice.recordId,
      registrationMetadataConsumed: structuredClone(diagnosticRegistration), sourcePathRecordedButNotOpened: novice.source, sourceCaseReused: true,
      independentStudentIncrement: 0, newIndependentSampleClaim: false, outputReasonsOrReusedPlanRead: false, finalAdoption: null, originalFamilyId: null, originalTemplateFamilyId: null,
      actualProfileSha256: hash(profileInput.profile), profileInputSha256: hash({ profile: profileInput.profile }), canonicalInputSha256: hash({ profile: profileInput.profile }),
      approvedProfileLegacyProjectionSha256: hash({ profile: profileInput.profile, legacy: profileInput.originalProfile }), derivedFamilyId: novice.derivedFamilyId, derivedTemplateId: novice.derivedTemplateId } };
  const checkpoint: any = { schemaVersion: "saitu.public-calibration.delta-independent-checkpoint.v7.3.final", contextId: "calibration-reviewer", policySha256: POLICY_SHA256,
    newInputsSha256: sourceRef.sha256, formalInputSha256: f.material.originalFormalInput.sha256, formalMetadataSha256: f.material.originalCaseMetadata.sha256,
    newSpecificCalibrationStories: 12, oldAnchorInputsCompared: 15, statisticallyIndependentStudentsOrTemplatesClaimed: 0, formalReviewed: 800,
    formalApplicabilityDelta: { retained: 800, changed: 0 }, formalPublicExclusionDelta: { distinct: 800, same_family_or_template: 0, uncertain: 0 }, replacementRequiredCaseIds: [],
    diagnosticReuseIndependentStudentIncrement: 0, finalSourceFreeze: null, finalAdoption: null, formalKeysOrGradesOrOutputsRead: false, newCalibrationReviewerAnswersOrComparisonRead: false,
    newFormalRegistrations: 0, formalExecution: { formal800: 0, ranking1200: 0 }, newProviderCalls: 0, databaseOperations: 0, vmOperations: 0, workerRuns: 0, productAcceptance: false, newFinalBasisOrAdoptionGranted: false };
  Object.assign(f.pub, { schemaVersion: "saitu.public-development-assembly.v7.5", previousPublicAssembly: previous, finalExecutionBasis: null, finalSourceFreeze: null, finalAdoption: null, registeredOrAcceptanceApproved: false });
  Object.assign(f.contract, { schemaVersion: CALIBRATION_DEVELOPMENT_CONSUMER_VERSION });
  async function persist(recomputeScope = false) {
    sourceRef = await f.put("neutral-inputs.json", source);
    component.inputSource = sourceRef; proposal.new12NeutralInputReference = sourceRef; novelty.bindings.newInputs = sourceRef; checkpoint.newInputsSha256 = sourceRef.sha256;
    for (const rows of [component.records, proposal.new12Records]) for (const row of rows) row.reference = { ...sourceRef, pointer: row.reference.pointer };
    for (const row of novelty.rows) row.reference = { ...sourceRef, pointer: row.reference.pointer };
    reuse.record.registrationMetadataReference = await f.put("diagnostic02-registration.json", diagnosticRegistration);
    const reuseRef = await f.put("diagnostic02-reuse.json", reuse); proposal.newDiagnosticReuse = reuseRef;
    component.independentProposal = await f.put("calibration-proposal.json", proposal);
    const componentRef = await f.put("calibration-component.json", component), deltaRef = await f.put("input-delta.json", delta), noveltyRef = await f.put("novelty.json", novelty);
    checkpoint.artifacts = { proposedExclusion: component.independentProposal, formalInputDelta: deltaRef, novelty: noveltyRef, proposedDiagnosticReuse: reuseRef };
    f.pub.calibration = { component: componentRef, deltaCheckpoint: await f.put("delta-checkpoint.json", checkpoint), inputDelta: deltaRef, noveltyReview: noveltyRef, diagnosticReuse: reuseRef };
    f.pub.developmentInputSha256 = unique([...old.developmentInputSha256, ...component.records.flatMap((row: any) => [row.canonicalPairSha256, row.canonicalInputProjectionSha256]), reuse.record.profileInputSha256, reuse.record.approvedProfileLegacyProjectionSha256]);
    f.manifest.developmentInputSha256 = f.pub.developmentInputSha256;
    if (recomputeScope) {
      delete f.pub.calibrationScopeSha256;
      const checked = await verifyPublicCalibrationDevelopmentDelta({ evidenceRoot: f.root, publicDevelopmentManifest: await f.put("unsealed-v5.json", f.pub) });
      f.pub.calibrationScopeSha256 = checked.calibrationScopeSha256;
    }
    f.contract.calibrationScopeSha256 = f.pub.calibrationScopeSha256; f.final.calibrationScopeSha256 = f.pub.calibrationScopeSha256;
    f.contract.fingerprintContractSha256 = hash({ schemaVersion: "saitu.public-development-fingerprints.v7.3", mainManifestSha256: old.mainManifest.sha256, recipesSha256: f.main.recipes.sha256,
      originalFamilyIds: old.developmentFamilyIds, originalTemplateIds: [], familyFingerprintIds: old.derivedReviewFingerprints.familyIds, sourceTemplateFingerprintIds: old.derivedReviewFingerprints.sourceTemplateIds,
      calibrationScopeSha256: f.pub.calibrationScopeSha256 });
    f.final.fingerprintContractSha256 = f.contract.fingerprintContractSha256;
    await f.persist();
  }
  await persist(true);
  return { ...f, old, source, component, proposal, delta, novelty, reuse, checkpoint, diagnosticRegistration, profileInput, persist,
    verifyDelta: () => verifyPublicCalibrationDevelopmentDelta({ evidenceRoot: f.root, publicDevelopmentManifest: f.cfg.publicDevelopmentManifest }),
    verifyAll: () => verifyDevelopmentExclusions({ evidenceRoot: f.root, manifest: f.manifest, config: f.cfg, migration: f.migration, registeredAt: "2026-11-09T00:01:00Z" }) };
}

describe("new calibration development inputs remain a versioned INPUT-only delta", () => {
  it("supports the full v7.2 path while preserving 143/15/two old reuses and a zero independence increment", async () => {
    const f = await fixture(); try {
      expect(DEVELOPMENT_CONSUMER_VERSION).toBe("saitu.public-development-consumer.v7.1");
      expect(await f.verifyDelta()).toMatchObject({ newCalibrationRecords: 12, deltaCases: 800, diagnosticReusesAdded: 1, additionalIndependentStudents: 0, additionalIndependentTemplates: 0, finalExecutionApproved: false, fullLegacyClosureVerified: false });
      expect(await f.verifyAll()).toMatchObject({ consumerVersion: CALIBRATION_DEVELOPMENT_CONSUMER_VERSION, cases: 800, mainRecords: 143, anchorInputs: 15, diagnosticReuses: 2, newCalibrationRecords: 12, diagnosticReusesAdded: 1, additionalIndependentStudents: 0 });
      expect(f.pub.supplements).toEqual(f.old.supplements);
      expect(sensitiveReads).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("scoring metadata preflight binds the complete calibration scope without opening formal payloads", async () => {
    const f = await fixture(); try {
      const registration = { schemaVersion: "saitu.ranking-registration.v7.1", ...policy, registeredAt: "2026-11-09T00:01:00Z", inputOpened: false, formalRunsExecuted: 0,
        config: f.cfg, implementation: [], implementationSha256: hash([]), publicDevelopmentVerification: await f.verifyAll() };
      const run = async () => preflightScoringRegistration({ evidenceRoot: f.root, reference: await f.put("calibration-registration-metadata.json", registration) });
      expect((await run()).publicDevelopmentVerification.calibrationScopeSha256).toBe(f.pub.calibrationScopeSha256);
      registration.publicDevelopmentVerification.calibrationScopeSha256 = hash("stale");
      await expect(run()).rejects.toThrow("registered_public_calibration_verification_changed");
      expect(sensitiveReads).toEqual([]);
    } finally { await f.dispose(); }
  });
  it.each(["freeze", "adoption", "provider-calls", "database-operations"])("rejects any promotion or operation claim in the prepared delta: %s", async mode => {
    const f = await fixture(); try {
      if (mode === "freeze") f.pub.finalSourceFreeze = { approved: true };
      if (mode === "adoption") f.checkpoint.finalAdoption = { approved: true };
      if (mode === "provider-calls") f.checkpoint.newProviderCalls = 1;
      if (mode === "database-operations") f.checkpoint.databaseOperations = 1;
      await f.persist(); await expect(f.verifyDelta()).rejects.toThrow("development_exclusions:");
    } finally { await f.dispose(); }
  });
  it.each(["missing-record", "fabricated-family", "fabricated-template", "wrong-input-hash", "wrong-source-id", "wrong-pointer", "answered-judge-aid", "independent-student-claim"])("rejects a rehashed component mutation: %s", async mode => {
    const f = await fixture(); try {
      if (mode === "missing-record") f.component.records.pop();
      if (mode === "fabricated-family") f.component.records[0].originalFamilyId = "invented";
      if (mode === "fabricated-template") f.component.records[0].originalTemplateFamilyId = "invented";
      if (mode === "wrong-input-hash") f.component.records[0].canonicalInputProjectionSha256 = hash("wrong");
      if (mode === "wrong-source-id") f.component.records[0].sourceIds = ["invented"];
      if (mode === "wrong-pointer") f.component.records[0].reference.pointer = "/pairs/1";
      if (mode === "answered-judge-aid") f.source.pairs[0].judgeAid.candidateEvidence = "SHOULD_NEVER_BECOME_A_KEY";
      if (mode === "independent-student-claim") f.component.independentStudentsClaimed = 12;
      await f.persist(); await expect(f.verifyDelta()).rejects.toThrow("development_exclusions:");
    } finally { await f.dispose(); }
  });
  it.each(["missing-case", "changed-applicability", "changed-public-exclusion", "missing-compared-record", "metadata-hash", "metadata-field", "outside-input-evidence", "input-evidence-hash", "self-reviewer", "answer-grade-claim"])("rejects a rehashed 800 delta mutation: %s", async mode => {
    const f = await fixture(); try {
      if (mode === "missing-case") f.delta.rows.pop();
      if (mode === "changed-applicability") f.delta.rows[0].materialApplicabilityDelta.changed = true;
      if (mode === "changed-public-exclusion") f.delta.rows[0].publicExposureDelta.currentDecision = "same_family_or_template";
      if (mode === "missing-compared-record") f.delta.rows[0].publicExposureDelta.comparedNewRecordIds.pop();
      if (mode === "metadata-hash") f.delta.rows[0].metadataReference.consumedProjectionSha256 = hash("wrong");
      if (mode === "metadata-field") f.delta.rows[0].metadataReference.consumedFieldNames.push("answerSha256");
      if (mode === "outside-input-evidence") f.delta.rows[0].inputEvidence[0].pointer = "/cases/0/answer";
      if (mode === "input-evidence-hash") f.delta.rows[0].inputEvidence[0].valueSha256 = hash("wrong");
      if (mode === "self-reviewer") for (const item of [f.checkpoint, f.proposal, f.delta, f.novelty, f.reuse]) item.contextId = f.manifest.cases[0].authorContextId;
      if (mode === "answer-grade-claim") f.delta.rows[0].rankingGradeOrAnswerJudgmentIssued = true;
      await f.persist(); await expect(f.verifyDelta()).rejects.toThrow("development_exclusions:");
    } finally { await f.dispose(); }
  });
  it.each(["independent-increment", "wrong-profile", "wrong-ancestry", "changed-legacy-hash", "fake-original-family"])("rejects a rehashed diagnostic reuse mutation: %s", async mode => {
    const f = await fixture(); try {
      if (mode === "independent-increment") f.reuse.record.independentStudentIncrement = 1;
      if (mode === "wrong-profile") f.reuse.record.actualProfileSha256 = hash("wrong");
      if (mode === "wrong-ancestry") f.reuse.record.reuseOf = "other-public-student";
      if (mode === "changed-legacy-hash") f.reuse.record.approvedProfileLegacyProjectionSha256 = hash("wrong");
      if (mode === "fake-original-family") f.reuse.record.originalFamilyId = "derived-is-not-original";
      await f.persist(); await expect(f.verifyDelta()).rejects.toThrow("development_exclusions:");
    } finally { await f.dispose(); }
  });
  it("does not consume diagnostic /records or registration reasons/plans and does not return their content", async () => {
    const f = await fixture(); try {
      const marker = "SYNTHETIC_NONCONSUMED_OUTPUT_SENTINEL";
      f.reuse.record.inputReference = await f.put("diagnostic02-input.json", { ...f.profileInput, records: [{ body: marker }] });
      f.diagnosticRegistration.inputSha256 = f.reuse.record.inputReference.sha256;
      f.diagnosticRegistration.reusedRank = { marker }; f.diagnosticRegistration.reason = marker; f.diagnosticRegistration.independentReview = { marker };
      f.reuse.record.registrationMetadataConsumed.inputSha256 = f.reuse.record.inputReference.sha256;
      await f.persist(true);
      expect(JSON.stringify(await f.verifyDelta())).not.toContain(marker);
    } finally { await f.dispose(); }
  });
  it("forbids calibration judge/comparison references before opening their bytes", async () => {
    const f = await fixture(); try {
      const publicDoc = structuredClone(f.pub);
      publicDoc.calibration.component = { path: "artifacts/public-calibration-v3/judge-a/originals.json", sha256: hash("synthetic") };
      const reference = await f.put("forbidden-calibration-ref.json", publicDoc);
      await expect(verifyPublicCalibrationDevelopmentDelta({ evidenceRoot: f.root, publicDevelopmentManifest: reference })).rejects.toThrow("private_key_or_grade_reference_forbidden");
      expect(sensitiveReads).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("requires the new scope on final execution adoption and refuses null draft adoption before any source bytes", async () => {
    const f = await fixture(); try {
      delete f.final.calibrationScopeSha256; await f.persist(); delete f.final.calibrationScopeSha256; await f.put("final-adoption.json", f.final);
      f.contract.finalExecutionAdoption = await f.put("final-adoption.json", f.final);
      for (const item of [f.cfg, f.manifest]) item.publicDevelopmentContract = structuredClone(f.contract);
      await expect(f.verifyAll()).rejects.toThrow("final_adoption_material_or_fingerprint_binding_changed");
      for (const item of [f.cfg, f.manifest]) item.publicDevelopmentContract.finalExecutionAdoption = null;
      await expect(f.verifyAll()).rejects.toThrow("bound_finalExecutionAdoption_required");
      expect(sensitiveReads).toEqual([]);
    } finally { await f.dispose(); }
  });
});
