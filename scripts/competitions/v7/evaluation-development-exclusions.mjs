import path from "node:path";
import { realpath } from "node:fs/promises";
import { canonicalHash, same, isHash, isTime, requirePolicy, readBoundBytes, assertUnique, assertQuotas, jsonPointer } from "./evaluation-policy.mjs";
import { inspectMigration } from "./evaluation-migration.mjs";
import { verifyCaseSourceDependencies } from "./evaluation-source-dependencies.mjs";

export const DEVELOPMENT_CONSUMER_VERSION = "saitu.public-development-consumer.v7.1";
export const CALIBRATION_DEVELOPMENT_CONSUMER_VERSION = "saitu.public-development-consumer.v7.2";
export const UNKNOWN_TEMPLATE_CONTRACT = "absent_original_ids_with_independent_semantic_review.v7.1";
const FINGERPRINT_VERSION = "saitu.public-development-fingerprints.v7.2";
const CALIBRATION_FINGERPRINT_VERSION = "saitu.public-development-fingerprints.v7.3";
const consumerVersion = version => [DEVELOPMENT_CONSUMER_VERSION, CALIBRATION_DEVELOPMENT_CONSUMER_VERSION].includes(version);
const sorted = values => [...new Set(values)].sort();
const requireCondition = (condition, message) => { if (!condition) throw new Error(`development_exclusions:${message}`); };
const exact = (actual, expected, label) => requireCondition(same(actual, expected), label);
const refEqual = (left, right) => Boolean(left && right && left.path === right.path && left.sha256 === right.sha256);
const identity = row => ({ caseId: row.caseId, layer: row.layer, familyId: row.familyId, templateFamilyId: row.templateFamilyId,
  inputSha256: row.inputSha256, answerSha256: row.answerSha256, sourceSnapshotSha256: row.sourceSnapshotSha256 });
const forbidden = member => /(?:^|[\\/])(?:scoring-private|ranking-blind[^/]*|reviewer_[ab]|judge[-_][ab])(?:[\\/]|$)|(?:^|[\\/])(?:keys|gold)(?:[.\\/-]|$)|(?:^|[\\/])public-calibration-v[0-9]+[\\/]comparison(?:[.\\/]|$)/i.test(member) ||
  /(?:^|[\\/])private[\\/]/i.test(member) && !/[\\/]private[\\/]producer-wrappers[\\/]product\.json$/.test(member);

async function readPublicBytes(evidenceRoot, reference) {
  requireCondition(typeof reference?.path === "string" && !forbidden(reference.path), "private_key_or_grade_reference_forbidden");
  const actualRoot = await realpath(evidenceRoot), resolved = await realpath(path.resolve(actualRoot, reference.path));
  requireCondition(!forbidden(path.relative(actualRoot, resolved)), "private_key_or_grade_realpath_forbidden");
  const result = await readBoundBytes(actualRoot, reference);
  if (reference.bytes !== undefined) requireCondition(reference.bytes === result.bytes.length, "reference_byte_length_changed");
  return result;
}
/** Non-sensitive metadata reader shared with the CLI bootstrap. */
export async function readPublicEvaluationJson(evidenceRoot, reference) {
  const result = await readPublicBytes(evidenceRoot, reference);
  return { ...result, value: JSON.parse(result.bytes) };
}

/** Pure shape check only. Actual approval always requires the hashed reader below. */
export function hasVersionedUnknownTemplateContract(manifest) {
  const contract = manifest.publicDevelopmentContract;
  return Boolean(consumerVersion(contract?.schemaVersion) && contract.originalTemplateProvenance === UNKNOWN_TEMPLATE_CONTRACT &&
    (contract.schemaVersion !== CALIBRATION_DEVELOPMENT_CONSUMER_VERSION || isHash(contract.calibrationScopeSha256)) &&
    isHash(contract.fingerprintContractSha256) && isHash(contract.materialReview?.sha256) && isHash(contract.finalExecutionAdoption?.sha256) &&
    refEqual(contract.publicDevelopmentManifest, manifest.publicDevelopmentManifest) && manifest.publicDevelopmentManifestSha256 === contract.publicDevelopmentManifest.sha256 &&
    Array.isArray(manifest.developmentTemplateFamilyIds) && manifest.developmentTemplateFamilyIds.length === 0);
}

export function validateDevelopmentConsumerContract(config) {
  const contract = config.publicDevelopmentContract;
  requireCondition(consumerVersion(contract?.schemaVersion) &&
    [UNKNOWN_TEMPLATE_CONTRACT, "complete_original_ids.v7.1"].includes(contract.originalTemplateProvenance), "versioned_consumer_contract_required");
  for (const key of ["publicDevelopmentManifest", "materialReview", "finalExecutionAdoption"]) requireCondition(typeof contract[key]?.path === "string" && isHash(contract[key]?.sha256), `bound_${key}_required`);
  requireCondition(isHash(contract.fingerprintContractSha256) && refEqual(contract.publicDevelopmentManifest, config.publicDevelopmentManifest) &&
    contract.publicDevelopmentManifest.sha256 === config.publicDevelopmentManifestSha256, "consumer_manifest_reference_changed");
  if (contract.schemaVersion === CALIBRATION_DEVELOPMENT_CONSUMER_VERSION) requireCondition(isHash(contract.calibrationScopeSha256), "bound_calibration_scope_required");
  return contract;
}

/** Verify only the new public INPUT/metadata delta. This deliberately does not
 * approve a final runtime, revisit old semantic judgments, or read old sources.
 * The full consumer still verifies its entire v7.1 closure and runs the existing
 * source helper last. Preparation may call this without inventing a final seal. */
export async function verifyPublicCalibrationDevelopmentDelta({ evidenceRoot, publicDevelopmentManifest, forbiddenContextIds = [] }) {
  const cache = new Map();
  async function read(reference) {
    requireCondition(typeof reference?.path === "string" && isHash(reference.sha256), "calibration_bound_reference_required");
    const key = JSON.stringify([reference.path, reference.sha256]);
    if (!cache.has(key)) cache.set(key, await readPublicBytes(evidenceRoot, reference));
    const result = cache.get(key);
    if (reference.bytes !== undefined) requireCondition(reference.bytes === result.bytes.length, "reference_byte_length_changed");
    return JSON.parse(result.bytes);
  }
  const assembly = await read(publicDevelopmentManifest); requirePolicy(assembly);
  requireCondition(assembly.schemaVersion === "saitu.public-development-assembly.v7.5", "calibration_v75_assembly_required");
  const previous = await read(assembly.previousPublicAssembly); requirePolicy(previous);
  requireCondition(previous.schemaVersion === "saitu.public-development-assembly.v7.4", "calibration_original_v4_assembly_required");
  for (const key of ["mainManifest", "mainInputProjection", "independentAdoption", "independentPerCaseMaterialReview", "original800IndependentReview", "originalIndependentSummary", "supplements", "developmentFamilyIds", "developmentTemplateFamilyIds", "derivedReviewFingerprints"])
    if (assembly[key] !== undefined || previous[key] !== undefined) exact(assembly[key], previous[key], "calibration_previous_scope_changed");
  requireCondition(assembly.finalExecutionBasis === null && assembly.finalSourceFreeze === null && assembly.finalAdoption === null && assembly.registeredOrAcceptanceApproved === false, "calibration_material_scope_must_not_self_approve_execution");
  const main = await read(assembly.mainManifest), projection = await read(assembly.mainInputProjection), material = await read(assembly.independentPerCaseMaterialReview);
  requireCondition(main.records?.length === 143 && projection.records?.length === 143 && material.cases?.length === 800, "calibration_preserved_143_and_800_scope_required");
  const anchor = previous.supplements?.find(row => row.kind === "synthetic_anchor_input_only");
  requireCondition(anchor?.records?.length === 15, "calibration_preserved_15_anchors_required");
  const calibration = assembly.calibration;
  requireCondition(calibration && typeof calibration === "object" && !Array.isArray(calibration) &&
    same(Object.keys(calibration).sort(), ["component", "deltaCheckpoint", "inputDelta", "noveltyReview", "diagnosticReuse"].sort()), "calibration_reference_roles_required");
  const component = await read(calibration.component); requirePolicy(component);
  requireCondition(component.schemaVersion === "saitu.public-development-calibration-component.v7.1" && component.records?.length === 12 &&
    component.originalFamilyIds?.length === 0 && component.originalTemplateFamilyIds?.length === 0 && component.finalAdoption === null &&
    component.independentStudentsClaimed === 0 && component.independentTemplatesClaimed === 0, "calibration_twelve_input_component_required");
  const proposal = await read(component.independentProposal), source = await read(component.inputSource), checkpoint = await read(calibration.deltaCheckpoint),
    delta = await read(calibration.inputDelta), novelty = await read(calibration.noveltyReview), reuse = await read(calibration.diagnosticReuse);
  const contextId = checkpoint.contextId;
  const forbiddenAuthors = new Set([...forbiddenContextIds, ...main.records.map(row => row.authorContextId), ...material.cases.map(row => row.authorContextId)].filter(Boolean));
  requireCondition(typeof contextId === "string" && contextId && !forbiddenAuthors.has(contextId) &&
    [proposal, delta, novelty, reuse].every(value => value.contextId === contextId), "calibration_independent_delta_context_required");
  requireCondition(checkpoint.schemaVersion === "saitu.public-calibration.delta-independent-checkpoint.v7.3.final" && checkpoint.policySha256 === assembly.policySha256 &&
    checkpoint.newInputsSha256 === component.inputSource.sha256 && checkpoint.formalInputSha256 === material.originalFormalInput.sha256 &&
    checkpoint.formalMetadataSha256 === material.originalCaseMetadata.sha256 && checkpoint.newSpecificCalibrationStories === 12 && checkpoint.oldAnchorInputsCompared === 15 &&
    checkpoint.statisticallyIndependentStudentsOrTemplatesClaimed === 0 && checkpoint.formalReviewed === 800 &&
    same(checkpoint.formalApplicabilityDelta, { retained: 800, changed: 0 }) && same(checkpoint.formalPublicExclusionDelta, { distinct: 800, same_family_or_template: 0, uncertain: 0 }) &&
    checkpoint.replacementRequiredCaseIds?.length === 0 && checkpoint.diagnosticReuseIndependentStudentIncrement === 0 && checkpoint.finalSourceFreeze === null && checkpoint.finalAdoption === null &&
    checkpoint.formalKeysOrGradesOrOutputsRead === false && checkpoint.newCalibrationReviewerAnswersOrComparisonRead === false && checkpoint.newFormalRegistrations === 0 &&
    checkpoint.newProviderCalls === 0 && checkpoint.databaseOperations === 0 && checkpoint.vmOperations === 0 && checkpoint.workerRuns === 0 &&
    checkpoint.productAcceptance === false && checkpoint.newFinalBasisOrAdoptionGranted === false &&
    same(checkpoint.formalExecution, { formal800: 0, ranking1200: 0 }), "calibration_independent_checkpoint_scope_changed");
  for (const [key, expected] of [["proposedExclusion", component.independentProposal], ["formalInputDelta", calibration.inputDelta], ["novelty", calibration.noveltyReview], ["proposedDiagnosticReuse", calibration.diagnosticReuse]])
    requireCondition(refEqual(checkpoint.artifacts?.[key], expected), "calibration_checkpoint_artifact_binding_changed");
  requireCondition(proposal.schemaVersion === "saitu.public-development-exclusion-delta-proposal.v7.3" && refEqual(proposal.preservedMain143Manifest, assembly.mainManifest) &&
    refEqual(proposal.preservedOld15InputProjection, anchor.inputProjection) && refEqual(proposal.new12NeutralInputReference, component.inputSource) &&
    refEqual(proposal.newDiagnosticReuse, calibration.diagnosticReuse) && proposal.finalSourceFreeze === null && proposal.finalAdoption === null && proposal.registrationExecuted === false &&
    proposal.originalTemplateIdsUnknownNotFabricated === true, "calibration_proposal_or_original_binding_changed");
  exact(component.records, proposal.new12Records, "calibration_independently_reviewed_records_changed");
  exact(proposal.originalDevelopmentFamilyExclusionsRetainedByReference, previous.developmentFamilyIds, "calibration_original_family_scope_changed");
  exact(proposal.originalDevelopmentTemplateExclusionsRetainedByReference, previous.developmentTemplateFamilyIds, "calibration_original_template_scope_changed");
  requireCondition(source.pairs?.length === 12 && source.pairCount === 12, "calibration_neutral_twelve_inputs_required");
  assertUnique(component.records.map(row => row.recordId), "duplicate_calibration_record");
  const identifiers = { pairIds: [], studentIds: [], activityIds: [], sourceIds: [], factIds: [] }, exactHashes = [], stories = [], materials = [];
  const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
  for (const [index, row] of component.records.entries()) {
    const pair = source.pairs[index];
    requireCondition(pair && row.recordId === pair.pairId && row.sourcePairId === pair.pairId && row.studentId === pair.student?.studentId && row.activityId === pair.activity?.activityId &&
      refEqual(row.reference, component.inputSource) && row.reference.pointer === `/pairs/${index}`, "calibration_source_pointer_or_identifier_changed");
    requireCondition(pair.judgeAid && Object.values(pair.judgeAid).every(value => value === ""), "calibration_judge_answers_forbidden");
    const input = { student: pair.student, activity: pair.activity }, student = pick(pair.student, ["originalUtterance", "goalVerbatim", "necessaryState", "earlierUtterance", "correctionScope"]),
      activity = pair.activity.facts.map(fact => pick(fact, ["informationKind", "sourceRange", "scope", "statement"]));
    exact(row.sourceIds, pair.activity.sourceRanges.map(item => item.sourceId), "calibration_source_identifier_scope_changed");
    exact(row.factIds, pair.activity.facts.map(fact => fact.factId), "calibration_fact_identifier_scope_changed");
    requireCondition(row.originalFamilyId === null && row.originalTemplateFamilyId === null && row.originalIdsUnknownNotFabricated === true && row.developmentExposure === true &&
      row.derivedFingerprintsAreNotOriginalFamilyOrTemplateIds === true && row.finalAdoption === null && row.canonicalPairSha256 === canonicalHash(pair) &&
      row.canonicalInputProjectionSha256 === canonicalHash(input) && row.studentContentSha256 === canonicalHash(student) && row.activityFactContentSha256 === canonicalHash(activity) &&
      row.derivedStudentStoryFingerprint === `pc3-story.v7.3:${row.studentContentSha256}` && row.derivedMaterialFingerprint === `pc3-material.v7.3:${row.activityFactContentSha256}` &&
      row.formalUseEligibility === "exclude_same_student_activity_substantive_content_and_derivatives", "calibration_input_hash_or_original_namespace_changed");
    for (const [key, value] of [["pairIds", [row.recordId]], ["studentIds", [row.studentId]], ["activityIds", [row.activityId]], ["sourceIds", row.sourceIds], ["factIds", row.factIds]]) identifiers[key].push(...value);
    exactHashes.push(row.canonicalPairSha256, row.canonicalInputProjectionSha256); stories.push(row.derivedStudentStoryFingerprint); materials.push(row.derivedMaterialFingerprint);
  }
  for (const key of Object.keys(identifiers)) { assertUnique(identifiers[key], `duplicate_calibration_${key}`); identifiers[key] = sorted(identifiers[key]); }
  requireCondition(novelty.schemaVersion === "saitu.public-calibration.novelty-independent.v7.3" && refEqual(novelty.bindings?.newInputs, component.inputSource) && refEqual(novelty.bindings?.oldAnchors, anchor.inputProjection) &&
    novelty.rows?.length === 12 && novelty.newSpecificStories === 12 && novelty.statisticallyIndependentStudentsClaimed === 0 && novelty.independentAnswerTemplatesClaimed === 0 &&
    novelty.newReviewerAnswersRead === false && novelty.comparisonRead === false && novelty.rankingGradesIssued === false, "calibration_novelty_scope_changed");
  for (const [index, row] of novelty.rows.entries()) {
    const input = component.records[index];
    requireCondition(row.pairId === input.recordId && refEqual(row.reference, component.inputSource) && row.reference.pointer === `/pairs/${index}` &&
      row.inputProjectionSha256 === input.canonicalInputProjectionSha256 && row.specificStoryNovelty === "new_specific_student_activity_combination" && row.sharedBoundaryPatternsDisclosed === true &&
      row.independentStatisticalStudentOrTemplateClaim === false && row.policyChanged === false && row.relevanceGradeIssued === false, "calibration_independent_novelty_record_changed");
    exact(sorted(row.comparisonOldAnchorIds), sorted(anchor.records.map(item => item.recordId)), "calibration_all_fifteen_anchor_comparisons_required");
  }
  const metadata = await read(material.originalCaseMetadata), product = await read(material.originalFormalInput);
  requireCondition(delta.schemaVersion === "saitu.public-calibration.formal800-input-delta-independent.v7.3" && delta.classification === "restricted_input_evidence_no_answers" &&
    delta.rows?.length === 800 && metadata.cases?.length === 800 && product.cases?.length === 800 && delta.changedApplicability === 0 && delta.changedPublicExclusion === 0 &&
    delta.replacementRequiredCaseIds?.length === 0 && delta.uncertainCaseIds?.length === 0 && delta.confirmedContaminationCaseIds?.length === 0 &&
    delta.prior143And15ReviewReusedWithinSameInputAndPolicyBindings === true && delta.prior143NotClaimedAsFreshSemanticReviewHere === true && delta.relevanceLevelsOrKeysRead === false &&
    same(delta.formalExecutions, { formal800: 0, ranking1200: 0 }), "calibration_complete_800_input_delta_required");
  assertUnique(delta.rows.map(row => row.caseId), "duplicate_calibration_delta_case"); assertQuotas(delta.rows);
  const metadataById = new Map(metadata.cases.map((row, index) => [row.caseId, { row, index }])), productById = new Map(product.cases.map((row, index) => [row.caseId, { row, index }]));
  const allIdentifiers = new Set(Object.values(identifiers).flat()), allExactHashes = new Set(exactHashes), deltaBindings = [];
  function noExactExposedInput(value) {
    requireCondition(!allExactHashes.has(canonicalHash(value)), "calibration_exact_formal_input_exposure");
    if (typeof value === "string") requireCondition(!allIdentifiers.has(value), "calibration_formal_identifier_exposure");
    else if (Array.isArray(value)) value.forEach(noExactExposedInput);
    else if (value && typeof value === "object") Object.values(value).forEach(noExactExposedInput);
  }
  const metadataFields = ["caseId", "layer", "familyId", "templateFamilyId", "taskGroup", "scope", "inputSha256", "sourceSnapshotSha256", "authorContextId", "sourceEvidenceIds"];
  for (const row of delta.rows) {
    const current = metadataById.get(row.caseId), original = productById.get(row.caseId);
    requireCondition(current && original && row.layer === current.row.layer && row.familyId === current.row.familyId && row.templateFamilyId === current.row.templateFamilyId &&
      row.taskGroup === current.row.taskGroup && row.inputSha256 === current.row.inputSha256 && canonicalHash(original.row.input) === row.inputSha256 &&
      refEqual(row.inputReference, material.originalFormalInput) && row.inputReference.pointer === `/cases/${original.index}/input` &&
      refEqual(row.metadataReference, material.originalCaseMetadata) && row.metadataReference.pointer === `/cases/${current.index}`, "calibration_delta_current_input_or_metadata_changed");
    const safeMetadata = pick(current.row, metadataFields);
    exact(row.metadataReference.consumedFieldNames, Object.keys(safeMetadata), "calibration_delta_metadata_projection_fields_changed");
    requireCondition(row.metadataReference.consumedProjectionSha256 === canonicalHash(safeMetadata), "calibration_delta_metadata_projection_hash_changed");
    requireCondition(!forbiddenAuthors.has(contextId) && current.row.authorContextId !== contextId && row.materialApplicabilityDelta?.currentDecision === "retain_prior_input_material_applicability" &&
      row.materialApplicabilityDelta.changed === false && row.materialApplicabilityDelta.finalRuntimeApprovalIssued === false && row.materialApplicabilityDelta.policySha256 === assembly.policySha256 &&
      refEqual(row.materialApplicabilityDelta.priorDecisionSource, assembly.original800IndependentReview) && row.publicExposureDelta?.currentDecision === "distinct_from_new12" &&
      row.publicExposureDelta.changed === false && typeof row.publicExposureDelta.semanticReason === "string" && row.publicExposureDelta.semanticReason.trim() &&
      row.publicExposureDelta.lexicalThresholdUsed === false && row.rankingGradeOrAnswerJudgmentIssued === false, "calibration_delta_independent_input_decision_changed");
    exact(sorted(row.publicExposureDelta.comparedNewRecordIds), identifiers.pairIds, "calibration_delta_twelve_comparison_scope_changed");
    requireCondition(Array.isArray(row.inputEvidence) && row.inputEvidence.length > 0, "calibration_delta_input_evidence_required");
    for (const item of row.inputEvidence) {
      requireCondition(typeof item.pointer === "string" && (item.pointer === row.inputReference.pointer || item.pointer.startsWith(`${row.inputReference.pointer}/`)), "calibration_delta_input_evidence_pointer_changed");
      const pointer = item.pointer.slice(row.inputReference.pointer.length);
      requireCondition(canonicalHash(pointer ? jsonPointer(original.row.input, pointer) : original.row.input) === item.valueSha256, "calibration_delta_input_evidence_hash_changed");
    }
    noExactExposedInput(original.row.input);
    deltaBindings.push({ caseId: row.caseId, inputSha256: row.inputSha256, metadataProjectionSha256: row.metadataReference.consumedProjectionSha256, deltaRowSha256: canonicalHash(row) });
  }
  const novice = main.records.find(row => row.recordId === "public-admission-02:v7-public-desktop-novice"), noviceProjection = projection.records.find(row => row.recordId === novice?.recordId);
  const record = reuse.record;
  requireCondition(reuse.schemaVersion === "saitu.development-diagnostic-reuse-proposal.v7.3" && reuse.noObservationsOpened === true && reuse.finalAdoption === null && record?.recordId === "explanation-diagnostic-02" &&
    record.kind === "public_diagnostic_reuse" && novice && noviceProjection && record.reuseOf === novice.recordId && record.sourceCaseReused === true &&
    record.independentStudentIncrement === 0 && record.newIndependentSampleClaim === false && record.outputReasonsOrReusedPlanRead === false && record.finalAdoption === null &&
    record.originalFamilyId === null && record.originalTemplateFamilyId === null && refEqual(reuse.oldManifestBinding, assembly.mainManifest), "calibration_diagnostic_reuse_scope_changed");
  // Only these two INPUT fields and four registration metadata fields are used.
  // In particular, do not follow publicInputSource to an observation, or inspect
  // /records, /reusedRank, reasons, independentReview, plans or runtime outputs.
  const diagnosticDocument = await read(record.inputReference), registrationDocument = await read(record.registrationMetadataReference);
  const diagnosticInput = { profile: diagnosticDocument.profile, legacy: diagnosticDocument.originalProfile },
    registered = pick(registrationDocument, ["inputSha256", "profileSha256", "publicInputSource", "inputReuse"]);
  exact(registered, record.registrationMetadataConsumed, "calibration_diagnostic_metadata_projection_changed");
  exact(diagnosticInput, { profile: noviceProjection.input.profile, legacy: noviceProjection.input.legacy }, "calibration_diagnostic_profile_or_legacy_changed");
  requireCondition(registered.inputSha256 === record.inputReference.sha256 && registered.profileSha256 === novice.actualProfileSha256 && refEqual(registered.publicInputSource, novice.source) &&
    refEqual(record.sourcePathRecordedButNotOpened, novice.source) && record.actualProfileSha256 === canonicalHash(diagnosticInput.profile) && record.actualProfileSha256 === novice.actualProfileSha256 &&
    record.profileInputSha256 === canonicalHash({ profile: diagnosticInput.profile }) && record.canonicalInputSha256 === record.profileInputSha256 &&
    record.approvedProfileLegacyProjectionSha256 === canonicalHash(diagnosticInput) && record.derivedFamilyId === novice.derivedFamilyId && record.derivedTemplateId === novice.derivedTemplateId,
  "calibration_diagnostic_original_ancestry_changed");
  const newInputs = sorted([...exactHashes, record.profileInputSha256, record.approvedProfileLegacyProjectionSha256]);
  const scope = { schemaVersion: "saitu.public-development-calibration-scope.v7.1", previousAssemblySha256: assembly.previousPublicAssembly.sha256,
    componentSha256: calibration.component.sha256, deltaCheckpointSha256: calibration.deltaCheckpoint.sha256, deltaReviewSha256: calibration.inputDelta.sha256,
    noveltyReviewSha256: calibration.noveltyReview.sha256, diagnosticReuseSha256: calibration.diagnosticReuse.sha256,
    identifiers, studentStoryFingerprints: sorted(stories), materialFingerprints: sorted(materials), newExactInputSha256: newInputs,
    deltaCaseBindingsSha256: canonicalHash(deltaBindings), diagnosticInputBindingSha256: canonicalHash({ recordId: record.recordId, inputSha256: record.inputReference.sha256, registrationSha256: record.registrationMetadataReference.sha256,
      profileInputSha256: record.profileInputSha256, approvedProfileLegacyProjectionSha256: record.approvedProfileLegacyProjectionSha256, reuseOf: record.reuseOf, independentStudentIncrement: 0 }) };
  const scopeSha256 = canonicalHash(scope);
  if (assembly.calibrationScopeSha256 !== undefined) requireCondition(assembly.calibrationScopeSha256 === scopeSha256, "calibration_complete_scope_hash_changed");
  exact(assembly.developmentInputSha256, sorted([...previous.developmentInputSha256, ...newInputs]), "calibration_complete_composite_input_array_required");
  return { schemaVersion: "saitu.public-development-calibration-delta-verification.v7.1", calibrationScopeSha256: scopeSha256, scope,
    previousExactInputSha256: previous.developmentInputSha256, newExactInputSha256: newInputs, newCalibrationRecords: 12, deltaCases: 800, diagnosticReusesAdded: 1,
    additionalIndependentStudents: 0, additionalIndependentTemplates: 0, fullLegacyClosureVerified: false, finalExecutionApproved: false, readThroughFiles: cache.size };
}

/** Read-through public metadata only. No scoring keys, observations or ranking labels
 * may be opened here. Source-body/absolute-alias authority stays with the existing
 * verifyCaseSourceDependencies reader, whose result is required by both callers. */
export async function verifyDevelopmentExclusions({ evidenceRoot, manifest, config, migration, registeredAt }) {
  // Preserve the old absent-dependency structural rejection without opening any
  // referenced member. The source reader itself runs only after this whole guard.
  if (!isHash(manifest.caseSourceDependenciesSha256) || manifest.sourceDependencies?.sha256 !== manifest.caseSourceDependenciesSha256) throw new Error("registered_case_source_dependencies_required");
  const contract = validateDevelopmentConsumerContract(config);
  exact(manifest.publicDevelopmentContract, contract, "challenge_consumer_contract_changed");
  requireCondition(refEqual(manifest.publicDevelopmentManifest, contract.publicDevelopmentManifest) && manifest.publicDevelopmentManifestSha256 === config.publicDevelopmentManifestSha256, "challenge_manifest_reference_changed");
  const actualEvidenceRoot = await realpath(evidenceRoot);
  const cache = new Map();
  async function read(reference, parse = true) {
    requireCondition(typeof reference?.path === "string", "safe_public_metadata_reference_required");
    const key = JSON.stringify([reference.path, reference.sha256]);
    if (!cache.has(key)) cache.set(key, await readPublicBytes(evidenceRoot, reference));
    const result = cache.get(key);
    if (reference.bytes !== undefined) requireCondition(reference.bytes === result.bytes.length, "reference_byte_length_changed");
    return parse ? JSON.parse(result.bytes) : result;
  }
  const publicManifest = await read(contract.publicDevelopmentManifest);
  requirePolicy(publicManifest);
  const withCalibration = contract.schemaVersion === CALIBRATION_DEVELOPMENT_CONSUMER_VERSION;
  requireCondition(publicManifest.schemaVersion === (withCalibration ? "saitu.public-development-assembly.v7.5" : "saitu.public-development-assembly.v7.4"), "versioned_public_assembly_required");
  const main = await read(publicManifest.mainManifest), projection = await read(publicManifest.mainInputProjection), adoption = await read(publicManifest.independentAdoption);
  requirePolicy(main);
  requireCondition(main.schemaVersion === "saitu.public-development-exclusion-manifest.v7.2" && main.records?.length === 143 && projection.records?.length === 143, "complete_143_main_scope_required");
  requireCondition(refEqual(main.inputProjection, publicManifest.mainInputProjection) && refEqual(adoption.mainManifest, publicManifest.mainManifest) && refEqual(adoption.mainInputProjection, publicManifest.mainInputProjection), "main_projection_or_independent_scope_changed");
  const recipes = await read(main.recipes);
  requireCondition(recipes.schemaVersion === "saitu.public-development-hash-recipes.v7.2" && adoption.schemaVersion === "saitu.independent-public-exclusion-adoption.v7.2", "reviewed_fingerprint_recipe_required");
  assertUnique(main.records.map(row => row.recordId), "duplicate_public_development_record");
  assertUnique(projection.records.map(row => row.recordId), "duplicate_public_input_projection");
  const inputs = new Map(projection.records.map(row => [row.recordId, row.input]));
  const recordsById = new Map(main.records.map(row => [row.recordId, row]));
  const sourceFiles = new Map();
  requireCondition(Array.isArray(main.sourceClosure?.files) && main.sourceClosure.files.length > 0, "main_original_source_closure_required");
  for (const source of main.sourceClosure.files) {
    requireCondition(!sourceFiles.has(source.path), "duplicate_main_source_member");
    await read(source, false); sourceFiles.set(source.path, source.sha256);
  }
  const kinds = new Map(), exactInputs = [], extras = [];
  for (const row of main.records) {
    const input = inputs.get(row.recordId);
    requireCondition(input && sourceFiles.get(row.source?.path) === row.source.sha256, "main_record_original_source_unbound");
    kinds.set(row.kind, (kinds.get(row.kind) ?? 0) + 1);
    const expectedInput = row.kind === "public_seed_input" ? input : ["public_legacy_experiment_input", "public_local_B_preflight_input"].includes(row.kind) ? { legacy: input.legacy } : { profile: input.profile };
    requireCondition(canonicalHash(expectedInput) === row.canonicalInputSha256, "main_exact_input_projection_changed");
    const originalBytes = (await read(row.source, false)).bytes;
    if (row.kind === "public_local_B_preflight_input") {
      const original = JSON.parse(originalBytes);
      requireCondition(original.profile?.inputSha256 === canonicalHash(input.legacy) && original.profile.profileSha256 === row.actualProfileSha256, "public_local_B_original_input_binding_changed");
    } else {
      let originalValue;
      if (row.sourcePointer?.startsWith("/line/")) {
        const match = row.sourcePointer.match(/^\/line\/([1-9][0-9]*)\/(.+)$/);
        requireCondition(match, "public_jsonl_input_pointer_required");
        const line = originalBytes.toString("utf8").split("\n").filter(Boolean)[Number(match[1]) - 1];
        requireCondition(line !== undefined, "public_jsonl_input_line_missing");
        originalValue = jsonPointer(JSON.parse(line), `/${match[2]}`);
      } else originalValue = jsonPointer(JSON.parse(originalBytes), row.sourcePointer);
      const expectedValue = row.kind === "public_seed_input" ? input : row.kind === "public_legacy_experiment_input" ? input.legacy : input.profile;
      requireCondition(canonicalHash(originalValue) === canonicalHash(expectedValue), "public_original_input_pointer_changed");
    }
    if (row.profileInputSha256) requireCondition(canonicalHash({ profile: input.profile }) === row.profileInputSha256 && canonicalHash(input.profile) === row.actualProfileSha256, "main_actual_profile_changed");
    if (row.legacyEnvelopeSha256) requireCondition(canonicalHash({ legacy: input.legacy }) === row.legacyEnvelopeSha256, "main_legacy_envelope_changed");
    if (row.currentAdapterProjection) requireCondition(canonicalHash({ profile: input.currentV7AdapterProjection }) === row.currentAdapterProjection.profileInputSha256 && row.projectionIsHistoricalActualCanonicalClaim === false, "current_adapter_projection_misrepresented");
    if (row.kind === "public_diagnostic_input_reuse") {
      const origin = recordsById.get(row.reusedFrom);
      requireCondition(origin?.kind === "actual_public_browser_submission" && row.actualProfileSha256 === origin.actualProfileSha256 && row.canonicalInputSha256 === origin.canonicalInputSha256 &&
        row.derivedFamilyId === origin.derivedFamilyId && row.derivedTemplateId === origin.derivedTemplateId && row.browserParameterSha256 === origin.browserParameterSha256, "main_diagnostic_reuse_ancestry_changed");
    }
    if (row.browserParameterSha256) {
      // Diagnostic projections contain profile+legacy only and inherit the exact
      // already-verified browser parameter hash through their source record.
      if (row.kind !== "public_diagnostic_input_reuse") requireCondition(canonicalHash(input.registeredBrowserParameters) === row.browserParameterSha256, "browser_parameters_changed");
      extras.push(row.browserParameterSha256);
    }
    if (row.diagnosticSubmittedEnvelopeSha256) {
      const original = await read(row.source);
      requireCondition(canonicalHash(original) === row.diagnosticSubmittedEnvelopeSha256 && canonicalHash(original.profile) === row.actualProfileSha256, "diagnostic_main_input_changed"); extras.push(row.diagnosticSubmittedEnvelopeSha256);
    }
    requireCondition(row.derivedFamilyId === `pub-family.v7.2:${row.familySha256}` && row.derivedTemplateId === `pub-template.v7.2:${row.templateSha256}`, "derived_namespace_contract_changed");
    exactInputs.push(...[row.canonicalInputSha256, row.profileInputSha256, row.legacyEnvelopeSha256, row.currentAdapterProjection?.profileInputSha256].filter(Boolean));
  }
  exact([...kinds].sort(), [["public_seed_input", 96], ["public_seed_profile_representation", 24], ["public_legacy_experiment_input", 6], ["actual_public_browser_submission", 10], ["public_diagnostic_input_reuse", 6], ["public_local_B_preflight_input", 1]].sort(), "main_143_strata_changed");
  exact(sorted(exactInputs), main.derivedReviewExclusions.developmentInputSha256, "main_exact_envelope_array_incomplete");
  exact(sorted(main.records.map(row => row.canonicalInputSha256)), adoption.mainCanonicalInputSha256, "independent_main_input_scope_changed");
  const families = sorted(main.records.flatMap(row => row.originalFamilyId ? [row.originalFamilyId] : []));
  const templates = sorted(main.records.flatMap(row => row.originalTemplateFamilyId ? [row.originalTemplateFamilyId] : []));
  exact(families, main.originalMetadataExclusions.developmentFamilyIds, "original_family_scope_changed");
  exact(templates, main.originalMetadataExclusions.developmentTemplateFamilyIds, "original_template_scope_changed");
  exact(families, adoption.originalDevelopmentFamilyIds, "independent_original_family_scope_changed");
  exact(templates, adoption.originalDevelopmentTemplateFamilyIds, "independent_original_template_scope_changed");
  // The frozen v7.2 identity namespace is record.derivedFamilyId. Adapter profile
  // fingerprints remain separately reviewed comparison cues, never new author IDs.
  const derivedFamilies = sorted(main.records.map(row => row.derivedFamilyId));
  const derivedTemplates = sorted(main.records.map(row => row.derivedTemplateId));
  exact(derivedFamilies, main.derivedReviewExclusions.familyIds, "main_derived_family_scope_changed");
  exact(derivedTemplates, main.derivedReviewExclusions.sourceTemplateIds, "main_derived_template_scope_changed");
  exact(derivedFamilies, adoption.derivedFamilyFingerprintIds, "reviewed_derived_family_scope_changed");
  exact(derivedTemplates, adoption.derivedSourceTemplateFingerprintIds, "reviewed_derived_template_scope_changed");
  exact(publicManifest.derivedReviewFingerprints.familyIds, derivedFamilies, "composite_derived_family_scope_changed");
  exact(publicManifest.derivedReviewFingerprints.sourceTemplateIds, derivedTemplates, "composite_derived_template_scope_changed");
  requireCondition(publicManifest.derivedReviewFingerprints.notOriginalAuthorIds === true && ![...families, ...templates].some(id => /^pub-(family|template)\./.test(id)), "original_and_derived_namespaces_mixed");
  const fingerprintContract = { schemaVersion: withCalibration ? CALIBRATION_FINGERPRINT_VERSION : FINGERPRINT_VERSION, mainManifestSha256: publicManifest.mainManifest.sha256, recipesSha256: main.recipes.sha256,
    originalFamilyIds: families, originalTemplateIds: templates, familyFingerprintIds: derivedFamilies, sourceTemplateFingerprintIds: derivedTemplates,
    ...(withCalibration ? { calibrationScopeSha256: contract.calibrationScopeSha256 } : {}) };
  requireCondition(canonicalHash(fingerprintContract) === contract.fingerprintContractSha256, "reviewed_complete_fingerprint_contract_changed");
  requireCondition(Array.isArray(publicManifest.supplements) && publicManifest.supplements.length === 2, "complete_anchor_and_diagnostic_supplements_required");
  const anchor = publicManifest.supplements.find(row => row.kind === "synthetic_anchor_input_only"), diagnostics = publicManifest.supplements.find(row => row.kind === "same_public_novice_review_diagnostic_input_reuses");
  requireCondition(anchor && diagnostics && anchor.records?.length === 15 && diagnostics.records?.length === 2, "complete_15_anchor_and_two_reuse_scope_required");
  requireCondition(refEqual(anchor.originalSource, adoption.supplementalSource) && refEqual(anchor.inputProjection, adoption.supplementalInputProjection), "independent_anchor_references_changed");
  await read(anchor.originalSource, false);
  const anchorProjection = await read(anchor.inputProjection);
  requireCondition(anchorProjection.records?.length === 15, "full_anchor_input_projection_required");
  assertUnique(anchorProjection.records.map(row => row.recordId), "duplicate_anchor_input_record");
  const anchorHashes = anchorProjection.records.map((row, index) => {
    const bound = anchor.records[index], hash = canonicalHash(row.input);
    requireCondition(bound.recordId === row.recordId && bound.inputSha256 === hash && refEqual(bound.projection, anchor.inputProjection) && bound.projection.pointer === `/records/${index}/input`, "anchor_input_pointer_or_hash_changed");
    return hash;
  });
  exact(sorted(anchorHashes), adoption.supplementalCanonicalInputSha256, "independent_anchor_hash_scope_changed");
  const novice = main.records.find(row => row.recordId === "public-admission-02:v7-public-desktop-novice");
  requireCondition(novice, "actual_public_novice_origin_required");
  exact(diagnostics.records.map(row => row.recordId).sort(), ["review-diagnostic-01", "review-diagnostic-02"], "diagnostic_reuse_id_scope_changed");
  const diagnosticBindings = [];
  for (const row of diagnostics.records) {
    const input = await read(row.input), registration = await read(row.registration);
    await read(row.expectedAssertionByteReference, false);
    requireCondition(row.input.sha256 === registration.inputSha256 && canonicalHash(input.profile) === novice.actualProfileSha256 && row.profileSha256 === novice.actualProfileSha256 && registration.profileSha256 === row.profileSha256 &&
      row.canonicalInputSha256 === canonicalHash({ profile: input.profile }) && row.diagnosticSubmittedEnvelopeSha256 === canonicalHash(input), "diagnostic_not_same_actual_public_input");
    requireCondition(input.records?.length === 45 && canonicalHash(input.records) === config.candidatePoolSha256 && registration.candidatePoolSha256 === config.candidatePoolSha256 && row.candidatePoolSha256 === config.candidatePoolSha256 &&
      refEqual(registration.publicInputSource, novice.source) && row.reusedPublicRecordId === novice.recordId, "diagnostic_pool_or_ancestry_changed");
    requireCondition(registration.expectedCheckKeys?.length === 20 && isHash(registration.expectedAssertionsSha256) && row.expectedAssertionsSha256 === registration.expectedAssertionsSha256 && row.expectedAssertionByteReference.sha256 === registration.expectedChecksSha256 &&
      row.additionalIndependentStudents === 0 && row.additionalFormalCases === 0 && row.diagnosticExecutionOutputsRead === false && row.originalFamilyId === null && row.originalTemplateFamilyId === null &&
      row.derivedFamilyFingerprintId === novice.derivedFamilyId && row.derivedSourceTemplateFingerprintId === novice.derivedTemplateId, "diagnostic_assertion_or_independence_claim_changed");
    diagnosticBindings.push([row.input.sha256, row.expectedAssertionsSha256, row.expectedAssertionByteReference.sha256]);
    extras.push(row.canonicalInputSha256, row.diagnosticSubmittedEnvelopeSha256);
  }
  exact(diagnosticBindings[0], diagnosticBindings[1], "diagnostic_pair_input_or_assertions_changed");
  const legacyInputs = sorted([...exactInputs, ...extras, ...anchorHashes]);
  const calibrationVerification = withCalibration ? await verifyPublicCalibrationDevelopmentDelta({ evidenceRoot, publicDevelopmentManifest: contract.publicDevelopmentManifest,
    forbiddenContextIds: [...(manifest.implementationAuthorContextIds ?? []), migration.authorContextId, ...manifest.cases.map(row => row.authorContextId)] }) : null;
  if (calibrationVerification) {
    exact(calibrationVerification.previousExactInputSha256, legacyInputs, "calibration_previous_exact_input_array_changed");
    requireCondition(calibrationVerification.calibrationScopeSha256 === contract.calibrationScopeSha256 && publicManifest.calibrationScopeSha256 === contract.calibrationScopeSha256,
      "calibration_contract_scope_binding_changed");
  }
  const allInputs = sorted([...legacyInputs, ...(calibrationVerification?.newExactInputSha256 ?? [])]);
  for (const [key, expected] of [["developmentFamilyIds", families], ["developmentTemplateFamilyIds", templates], ["developmentInputSha256", allInputs]]) {
    exact(publicManifest[key], expected, `complete_composite_${key}_required`); exact(manifest[key], expected, `complete_challenge_${key}_required`);
  }
  if (!templates.length) requireCondition(hasVersionedUnknownTemplateContract(manifest) && main.originalMetadataExclusions.templateIdsAbsentFromHistoricalMetadata === true && adoption.originalTemplateIdsUnknownNotFabricated === true, "unknown_original_template_provenance_unreviewed");
  else requireCondition(contract.originalTemplateProvenance === "complete_original_ids.v7.1", "original_template_provenance_changed");

  requireCondition(refEqual(contract.materialReview, publicManifest.independentPerCaseMaterialReview), "material_adoption_reference_changed");
  const material = await read(contract.materialReview), review = await read(material.originalReview), summary = await read(material.originalReviewSummary), metadata = await read(material.originalCaseMetadata), dependencies = await read(material.sourceDependencies);
  requireCondition(material.schemaVersion === "saitu.material-applicability-adoption.v7.4" && review.schemaVersion === "saitu.current-input-applicability-independent.v7.2", "versioned_full_material_review_required");
  requirePolicy(review); requirePolicy(metadata);
  requireCondition(refEqual(manifest.sourceDependencies, material.sourceDependencies) && manifest.caseSourceDependenciesSha256 === material.sourceDependencies.sha256 &&
    refEqual(manifest.originalCaseMetadata, material.originalCaseMetadata), "verified_existing_source_dependency_binding_required");
  requireCondition(refEqual(publicManifest.original800IndependentReview, material.originalReview) && refEqual(adoption.independentSemanticReview, material.originalReview) && refEqual(summary.details, material.originalReview) &&
    refEqual(review.bindings.metadata, material.originalCaseMetadata) && refEqual(review.bindings.dependencies, material.sourceDependencies) && refEqual(review.bindings.exclusion, publicManifest.mainManifest) &&
    refEqual(review.bindings.public, publicManifest.mainInputProjection) && refEqual(review.bindings.anchors, anchor.originalSource), "independent_800_review_reference_scope_changed");
  requireCondition(refEqual(material.originalFormalInput, review.bindings.product) && review.bindings.product.sha256 === config.productInputSha256, "reviewed_formal_input_original_changed");
  await read(review.bindings.product, false);
  requireCondition(summary.reviewedInputCases === 800 && summary.publicRecords === 143 && summary.supplementalAnchors === 15 && summary.semanticDecisions?.distinct === 800 && summary.materialInputBlockers?.length === 0 &&
    review.method?.mainPublicRecordsRead === 143 && review.method.supplementalAnchorInputsRead === 15 && review.method.fullCurrentInputsRead === 800 && review.formalExecution?.cases === 0, "complete_independent_semantic_scope_required");
  const authors = new Set([...(manifest.implementationAuthorContextIds ?? []), migration.authorContextId, ...manifest.cases.map(row => row.authorContextId)]);
  requireCondition(review.contextId && !authors.has(review.contextId) && adoption.contextId === review.contextId && summary.contextId === review.contextId, "independent_material_reviewer_required");
  const groups = [manifest.cases, material.cases, review.rows, metadata.cases, dependencies.cases];
  for (const rows of groups) { requireCondition(Array.isArray(rows) && rows.length === 800, "exact_800_material_scope_required"); assertUnique(rows.map(row => row.caseId), "duplicate_800_material_case"); }
  assertQuotas(manifest.cases);
  const maps = groups.slice(1).map(rows => new Map(rows.map((row, index) => [row.caseId, { row, index }])));
  const boundCases = [];
  for (const item of manifest.cases) {
    const matches = maps.map(map => map.get(item.caseId)); requireCondition(matches.every(Boolean), "missing_current_case_material_binding");
    const [bound, reviewed, original, source] = matches, row = reviewed.row;
    exact(identity(original.row), identity(item), "current_case_metadata_identity_changed");
    exact({ ...identity(row), answerSha256: row.answerBindingOpaqueFromAllowedMetadata?.answerSha256 }, identity(item), "independent_case_input_or_opaque_answer_binding_changed");
    requireCondition(bound.row.inputSha256 === item.inputSha256 && bound.row.answerSha256OpaqueMetadataOnly === item.answerSha256 && bound.row.materialDecision === "applicable" && bound.row.publicExclusionDecision === "distinct" &&
      row.materialApplicability?.decision === "applicable" && row.publicDevelopmentExclusion?.decision === "distinct" && row.materialApplicability.finalImplementationRuntimeApproval === false && row.answerOrRankingJudgmentIssued === false &&
      row.contextId === review.contextId && row.sourceDependencyRecordSha256 === canonicalHash(source.row), "per_case_independent_material_decision_changed");
    for (const [key, ref, match, pointer] of [["review", material.originalReview, reviewed, "rows"], ["metadata", material.originalCaseMetadata, original, "cases"], ["sourceDependency", material.sourceDependencies, source, "cases"]]) {
      requireCondition(refEqual(bound.row[key], ref) && bound.row[key].pointer === `/${pointer}/${match.index}` && bound.row[key].rowCanonicalSha256 === canonicalHash(match.row), "per_case_material_pointer_or_hash_changed");
    }
    requireCondition(bound.row.finalExecutionBasisApproved === false, "material_review_must_not_self_approve_runtime");
    boundCases.push({ ...identity(item), materialReviewRowSha256: canonicalHash(row), sourceDependencyRowSha256: canonicalHash(source.row) });
  }
  const caseBindingsSha256 = canonicalHash(boundCases);
  const final = await read(contract.finalExecutionAdoption); requirePolicy(final);
  const basis = { publicSpecificationSha256: config.publicSpecificationSha256, catalogSha256: config.catalogSha256, implementationSha256: config.implementationSha256,
    runtimeSourceBindingSha256: config.runtimeSourceBindingSha256, runtimeConfigurationSha256: config.runtimeConfigurationSha256,
    promptSha256: config.finalPromptSha256, productionProfileAdapterSha256: config.productionProfileAdapterSha256, frozenAt: manifest.implementationFrozenAt };
  requireCondition(Object.entries(basis).every(([key, value]) => key === "frozenAt" ? isTime(value) : isHash(value)) &&
    ["catalogSha256", "implementationSha256", "runtimeConfigurationSha256", "runtimeSourceBindingSha256"].every(key => manifest[key] === basis[key]) &&
    manifest.finalPromptSha256 === basis.promptSha256 && manifest.productionProfileAdapterSha256 === basis.productionProfileAdapterSha256, "final_frozen_execution_basis_required");
  exact(final.basis, basis, "final_independent_execution_basis_changed");
  requireCondition(final.schemaVersion === "saitu.independent-execution-applicability-adoption.v7.1" && final.passed === true && final.contextId && !authors.has(final.contextId) &&
    isTime(final.reviewedAt) && isTime(manifest.frozenAt) && isTime(registeredAt) && Date.parse(final.reviewedAt) >= Date.parse(basis.frozenAt) &&
    Date.parse(final.reviewedAt) <= Date.parse(manifest.frozenAt) && Date.parse(final.reviewedAt) <= Date.parse(registeredAt), "independent_prefrozen_final_adoption_required");
  requireCondition(refEqual(final.publicDevelopmentManifest, contract.publicDevelopmentManifest) && refEqual(final.materialReview, contract.materialReview) && final.caseBindingsSha256 === caseBindingsSha256 &&
    final.fingerprintContractSha256 === contract.fingerprintContractSha256 && final.migrationDecisionsSha256 === canonicalHash(migration.rows) &&
    (!withCalibration || final.calibrationScopeSha256 === contract.calibrationScopeSha256), "final_adoption_material_or_fingerprint_binding_changed");
  requireCondition(inspectMigration(migration).ready && ["publicSpecificationSha256", "catalogSha256", "implementationSha256", "runtimeConfigurationSha256"].every(key => migration.reviewBasis[key] === basis[key]), "final_independent_migration_basis_required");
  const adapter = await read(final.productionAdapterReview); requirePolicy(adapter);
  requireCondition(adapter.schemaVersion === "saitu.production-profile-adapter-review.v7.1" && adapter.passed === true && adapter.contextId && !authors.has(adapter.contextId) &&
    adapter.basisSha256 === canonicalHash(basis) && adapter.caseBindingsSha256 === caseBindingsSha256 && adapter.profileAdapterSha256 === basis.productionProfileAdapterSha256 &&
    adapter.inputSha256 === review.bindings.product.sha256 && adapter.casesChecked === 800 && adapter.rankingProfilesChecked === 120 && adapter.providerCalls === 0 &&
    adapter.sealedKeysRead === false && adapter.rankingLabelsRead === false && isTime(adapter.reviewedAt) && Date.parse(adapter.reviewedAt) >= Date.parse(basis.frozenAt) && Date.parse(adapter.reviewedAt) <= Date.parse(final.reviewedAt), "independent_production_adapter_basis_review_required");
  // Inspect effective and original source references without reading their bytes.
  // Official captures under private/sources remain legal; scoring payloads never
  // become source evidence merely by rehashing a component or same-root alias.
  async function guardSourceMember(reference) {
    requireCondition(typeof reference?.path === "string" && isHash(reference.sha256), "safe_source_member_reference_required");
    const member = path.isAbsolute(reference.path) ? path.relative(actualEvidenceRoot, reference.path) : reference.path;
    const sourceForbidden = value => forbidden(value) && !/(?:^|[\\/])private[\\/]sources[\\/]/.test(value) || /(?:^|[\\/])(?:scoring-private|ranking-blind[^/]*|reviewer_[ab]|keys(?:[.\\/-]|$)|gold(?:[.\\/-]|$))/i.test(value);
    requireCondition(!member.split(/[\\/]/).includes("..") && !sourceForbidden(member), "private_scoring_payload_cannot_be_source_member");
    const resolved = await realpath(path.resolve(actualEvidenceRoot, member));
    requireCondition(resolved.startsWith(actualEvidenceRoot + path.sep) && !sourceForbidden(path.relative(actualEvidenceRoot, resolved)), "private_scoring_realpath_cannot_be_source_member");
  }
  if (dependencies.relocations) await read(dependencies.relocations);
  for (const component of dependencies.components ?? []) {
    const snapshot = await read(component.manifest);
    for (const source of snapshot.sources ?? []) for (const kind of ["raw", "body"]) {
      const member = component.id === "ranking" ? source[kind] : kind === "raw" ? { path: source.rawSourceArtifact, sha256: source.rawSourceSha256 } :
        { path: typeof source.bodyArtifact === "string" && (source.bodyArtifact.startsWith("artifacts/") || path.isAbsolute(source.bodyArtifact)) ? source.bodyArtifact : path.posix.join(path.posix.dirname(component.manifest.path), "private", source.bodyArtifact ?? ""), sha256: source.bodySha256 };
      await guardSourceMember(member);
    }
  }
  for (const row of dependencies.cases) for (const source of row.sources) for (const kind of ["raw", "body"]) await guardSourceMember(source[kind]);
  // This is the first arbitrary source-member byte reader. Its original
  // root/absolute-alias/same-realpath and per-case closure rules stay unchanged.
  const sourceDependencies = await verifyCaseSourceDependencies({ evidenceRoot, manifest, config });
  return { schemaVersion: withCalibration ? "saitu.public-development-verification.v7.2" : "saitu.public-development-verification.v7.1", consumerVersion: contract.schemaVersion, publicDevelopmentManifestSha256: config.publicDevelopmentManifestSha256,
    mainManifestSha256: publicManifest.mainManifest.sha256, anchorProjectionSha256: anchor.inputProjection.sha256, materialReviewSha256: contract.materialReview.sha256,
    independent800ReviewSha256: material.originalReview.sha256, finalExecutionAdoptionSha256: contract.finalExecutionAdoption.sha256, fingerprintContractSha256: contract.fingerprintContractSha256,
    caseBindingsSha256, cases: 800, mainRecords: 143, anchorInputs: 15, diagnosticReuses: 2, additionalIndependentStudents: 0,
    ...(withCalibration ? { newCalibrationRecords: 12, diagnosticReusesAdded: 1, calibrationScopeSha256: calibrationVerification.calibrationScopeSha256, calibrationDeltaReviewSha256: publicManifest.calibration.inputDelta.sha256 } : {}),
    originalFamilies: families.length, originalTemplates: templates.length, exactInputHashes: allInputs.length, sourceBytesVerifiedByExistingHelper: true, sourceDependencyVerification: sourceDependencies, readThroughFiles: cache.size };
}
