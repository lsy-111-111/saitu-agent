import { createRequire } from "node:module";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { POLICY_VERSION, POLICY_SHA256, TASK_GROUPS, canonicalHash, same, isHash, isTime, isUint32, requirePolicy, readBoundJson, readBoundBytes } from "./evaluation-policy.mjs";
import { readPublicEvaluationJson, verifyDevelopmentExclusions } from "./evaluation-development-exclusions.mjs";
const { ordinalAgreement } = createRequire(import.meta.url)("../v6/reviewer-agreement.ts");

export const RANKING_PANELS_VERSION = "saitu.ranking-panels-contract.v7.2";
export const RANKING_PANEL_RULES = Object.freeze({ panels: 2, shardsPerPanel: 24, profilesPerShard: 5, candidatesPerProfile: 45, authors: 48,
  maxConcurrentAuthors: 6, minimumRawOrdinalAlpha: .70, model: "gpt-6.1-sol", reasoningEffort: "max", unknownTreatment: "preserve_U_never_zero" });
const policy = { policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256 }, panelIds = ["panel_a", "panel_b"];
const metaFields = ["profileId", "caseId", "familyId", "taskGroup", "inputSha256"];
const bindingFields = ["catalogSha256", "candidateEvidenceSha256", "sourceSnapshotSha256", "rubricSha256", "inputAdaptorSha256", "decisionEvidenceFilterSha256"];
const planFields = ["schemaVersion", "policyVersion", "policySha256", "evidenceClass", "roundId", "seed", "frozenAt", "profiles", "candidates", "binding", "shards", "inputMetadataSha256", "partitionSha256", "coordinators", "blockedAuthorContextIds"];
const contractFields = ["schemaVersion", "policyVersion", "policySha256", "roundId", "frozenAt", "publicPlan", "publicAssignments", "sealedCollection", "adjudication", "catalogSha256", "rankingSourceSnapshotSha256", "profilePoolSha256", "inputMetadataSha256", "partitionSha256", "rules"];
const check = (condition, message) => { if (!condition) throw new Error(`ranking_panels:${message}`); };
const record = value => value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, fields, message) => check(record(value) && same(Object.keys(value).sort(), [...fields].sort()), message);
const identity = value => typeof value === "string" && value.length > 0 && value.length <= 512 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const roundId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const unique = values => new Set(values).size === values.length;
const sorted = values => [...values].sort();
const freeze = value => { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const grade = value => value === "U" || Number.isInteger(value) && value >= 0 && value <= 3;
const reasonText = value => typeof value === "string" && value.trim().length > 0;
const blindFields = ["blindToAlgorithms", "productOutputsRead", "oldJudgmentsRead", "otherPanelJudgmentsRead", "priorSameProfileJudgmentsRead", "freshContext", "coordinatorGeneratedGrades"];
function blind(value) {
  exact(value, blindFields, "exact_blind_declaration_required");
  check(value.blindToAlgorithms === true && value.productOutputsRead === false && value.oldJudgmentsRead === false && value.otherPanelJudgmentsRead === false &&
    value.priorSameProfileJudgmentsRead === false && value.freshContext === true && value.coordinatorGeneratedGrades === false, "blind_original_required");
}
function document(value, schemaVersion, fields) {
  exact(value, ["schemaVersion", "policyVersion", "policySha256", "evidenceClass", ...fields], "unknown_or_missing_document_field");
  requirePolicy(value); check(value.schemaVersion === schemaVersion && value.evidenceClass === "ai_proxy", "versioned_ai_proxy_document_required");
}
function safePath(value) {
  check(typeof value === "string" && value.length <= 1024 && value.split("/").every(segment => segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment)), "canonical_relative_reference_path_required");
}
function reference(value) {
  exact(value, ["path", "rawSha256", "canonicalSha256"], "raw_and_canonical_reference_required"); safePath(value.path);
  check(isHash(value.rawSha256) && isHash(value.canonicalSha256), "raw_and_canonical_hashes_required");
  return value;
}
const permute = (values, seed, salt, id = value => value) => [...values].sort((a, b) => canonicalHash([seed, salt, id(a)]).localeCompare(canonicalHash([seed, salt, id(b)])) || String(id(a)).localeCompare(String(id(b))));
const plans = new WeakMap(), verified = new WeakMap();
function verifyPlan(plan) {
  const proof = plans.get(plan);
  check(proof && proof.hash === canonicalHash(plan) && Object.isFrozen(plan), "issued_immutable_plan_required");
  check(proof.metadataHash === canonicalHash(proof.metadata) && proof.optionsHash === canonicalHash(proof.options), "source_metadata_or_options_changed_after_freeze");
  check(same(plan.shards, partition(plan.profiles, plan.seed)) && plan.inputMetadataSha256 === canonicalHash({ profiles: plan.profiles, candidates: plan.candidates, binding: plan.binding }) &&
    plan.partitionSha256 === canonicalHash({ schemaVersion: "saitu.ranking-shard-partition.v7.2", seed: plan.seed, inputMetadataSha256: plan.inputMetadataSha256, shards: partition(plan.profiles, plan.seed) }), "plan_canonical_bindings_changed");
}
function partition(profiles, seed) {
  const groups = sorted(new Set(profiles.map(row => row.taskGroup)));
  check(same(groups, sorted(TASK_GROUPS)) && groups.every(group => profiles.filter(row => row.taskGroup === group).length === 20), "six_groups_of_twenty_required");
  const queues = new Map(groups.map(group => [group, permute(profiles.filter(row => row.taskGroup === group), seed, `profiles:${group}`, row => row.profileId)]));
  return Array.from({ length: 24 }, (_, index) => ({ shardId: `shard_${String(index + 1).padStart(2, "0")}`, profileIds: groups.filter((_group, i) => i !== index % 6).map(group => queues.get(group).shift().profileId) }));
}

/** Public metadata only; no grades, outputs or disagreement-driven partitioning. */
export function buildRankingPanelPlan(metadata, options) {
  const inputMetadata = metadata, inputOptions = options;
  exact(metadata, ["profiles", "candidates", "binding"], "exact_input_metadata_required");
  exact(options, ["roundId", "seed", "frozenAt", "coordinators", "blockedAuthorContextIds"], "exact_plan_options_required");
  check(Array.isArray(metadata.profiles) && metadata.profiles.length === 120 && Array.isArray(metadata.candidates) && metadata.candidates.length === 45, "120_profiles_and_45_candidates_required");
  for (const row of metadata.profiles) { exact(row, metaFields, "profile_metadata_fields_required"); check(metaFields.slice(0, 4).every(field => identity(row[field])) && isHash(row.inputSha256), "scalar_profile_metadata_required"); }
  for (const field of ["profileId", "caseId", "familyId", "inputSha256"]) check(unique(metadata.profiles.map(row => row[field])), "unique_profile_identity_required");
  for (const row of metadata.candidates) { exact(row, ["itemId", "seriesId"], "candidate_metadata_fields_required"); check(identity(row.itemId) && identity(row.seriesId), "scalar_candidate_identity_required"); }
  check(unique(metadata.candidates.map(row => row.itemId)) && unique(metadata.candidates.map(row => row.seriesId)), "45_unique_series_required");
  exact(metadata.binding, bindingFields, "gold_specific_binding_fields_required"); check(Object.values(metadata.binding).every(isHash), "gold_specific_hashes_required");
  check(roundId(options.roundId) && isUint32(options.seed) && isTime(options.frozenAt), "frozen_round_seed_and_time_required");
  check(Array.isArray(options.coordinators) && options.coordinators.length === 2 && options.coordinators.every(identity) && unique(options.coordinators), "two_assembler_roles_required");
  check(Array.isArray(options.blockedAuthorContextIds) && options.blockedAuthorContextIds.every(identity) && unique(options.blockedAuthorContextIds), "blocked_author_identities_required");
  metadata = structuredClone(metadata); options = structuredClone(options);
  const profiles = metadata.profiles.sort((a, b) => a.profileId.localeCompare(b.profileId)), candidates = metadata.candidates.sort((a, b) => a.itemId.localeCompare(b.itemId));
  const inputMetadataSha256 = canonicalHash({ profiles, candidates, binding: metadata.binding });
  const shards = partition(profiles, options.seed), partitionSha256 = canonicalHash({ schemaVersion: "saitu.ranking-shard-partition.v7.2", seed: options.seed, inputMetadataSha256, shards });
  const plan = freeze({ schemaVersion: "saitu.ranking-shard-plan.v7.2", ...policy, evidenceClass: "ai_proxy", ...options, profiles, candidates, binding: metadata.binding, shards, inputMetadataSha256, partitionSha256 });
  plans.set(plan, { hash: canonicalHash(plan), metadata: inputMetadata, metadataHash: canonicalHash(inputMetadata), options: inputOptions, optionsHash: canonicalHash(inputOptions) }); return plan;
}
function parsePlan(value) {
  exact(value, planFields, "plan_fields_changed"); requirePolicy(value); check(value.schemaVersion === "saitu.ranking-shard-plan.v7.2" && value.evidenceClass === "ai_proxy", "versioned_plan_required");
  const plan = buildRankingPanelPlan({ profiles: value.profiles, candidates: value.candidates, binding: value.binding }, Object.fromEntries(["roundId", "seed", "frozenAt", "coordinators", "blockedAuthorContextIds"].map(key => [key, value[key]])));
  check(same(value, plan), "plan_canonical_bindings_changed"); return plan;
}
export function assignRankingPanelAuthors(plan, authorContextIds) {
  verifyPlan(plan);
  check(Array.isArray(authorContextIds) && authorContextIds.length === 48 && authorContextIds.every(identity) && unique(authorContextIds), "48_distinct_actual_authors_required");
  check(!authorContextIds.some(id => [...plan.coordinators, ...plan.blockedAuthorContextIds].includes(id)), "coordinator_or_blocked_author_forbidden");
  return panelIds.flatMap((panelId, p) => partition(plan.profiles, plan.seed).map((shard, index) => ({ panelId, shardId: shard.shardId, jobId: `${panelId}/${shard.shardId}`,
    authorContextId: authorContextIds[p * 24 + index], profileIds: [...shard.profileIds], expectedPacketPath: `ranking-panels/${plan.roundId}/packets/${panelId}/${shard.shardId}.json`,
    expectedRawPath: `ranking-panels/${plan.roundId}/originals/${panelId}/${shard.shardId}.json`, model: "gpt-6.1-sol", reasoningEffort: "max", freshContextRequired: true })));
}
/** v7.2 pool identity is order-independent; v7.1 retains its existing formula. */
export function rankingPanelProfilePoolSha256(profiles) {
  return canonicalHash(profiles.map(row => ({ profileId: row.profileId, familyId: row.familyId, taskGroup: row.taskGroup, poolItemIds: sorted(row.poolItemIds),
    series: row.judgments.map(({ itemId, seriesId }) => ({ itemId, seriesId })).sort((a, b) => a.itemId.localeCompare(b.itemId)) })).sort((a, b) => a.profileId.localeCompare(b.profileId)));
}
const planPools = plan => plan.profiles.map(row => ({ profileId: row.profileId, familyId: row.familyId, taskGroup: row.taskGroup, poolItemIds: plan.candidates.map(item => item.itemId), judgments: plan.candidates }));
export function validateRankingReviewContract(contract, { config, manifest, registeredAt } = {}) {
  exact(contract, contractFields, "contract_fields_required"); requirePolicy(contract);
  check(contract.schemaVersion === RANKING_PANELS_VERSION && roundId(contract.roundId) && isTime(contract.frozenAt), "versioned_frozen_contract_required");
  for (const field of ["catalogSha256", "rankingSourceSnapshotSha256", "profilePoolSha256", "inputMetadataSha256", "partitionSha256"]) check(isHash(contract[field]), "contract_hash_required");
  for (const [field, filename] of [["publicPlan", "plan.json"], ["publicAssignments", "assignments.json"], ["sealedCollection", "sealed-collection.json"]]) {
    reference(contract[field]); check(contract[field].path === `ranking-panel-metadata/${contract.roundId}/${filename}`, "exact_public_reference_role_required");
  }
  check(contract.adjudication === null || Boolean(reference(contract.adjudication)), "adjudication_reference_or_null_required");
  if (contract.adjudication !== null) check(contract.adjudication.path === `ranking-panels/${contract.roundId}/adjudication.json`, "exact_adjudication_reference_role_required");
  check(same(contract.rules, RANKING_PANEL_RULES), "fixed_panel_rules_required");
  if (registeredAt !== undefined) check(isTime(registeredAt) && Date.parse(contract.frozenAt) <= Date.parse(registeredAt), "prefrozen_registered_time_required");
  for (const context of [config, manifest].filter(Boolean)) for (const field of ["catalogSha256", "rankingSourceSnapshotSha256"]) check(context[field] === contract[field], "contract_catalog_or_source_changed");
  return contract;
}

async function readReference(evidenceRoot, ref, publicOnly, reads) {
  reference(ref);
  if (publicOnly) {
    // A public-looking same-root symlink must not open an assigned private
    // original before metadata schema validation. The common byte reader still
    // performs its own root/realpath/hash checks after this stricter role check.
    const root = await realpath(evidenceRoot), filename = path.resolve(root, ref.path);
    check(await realpath(filename) === filename, "public_panel_metadata_realpath_alias_forbidden");
  }
  const result = await (publicOnly ? readPublicEvaluationJson : readBoundJson)(evidenceRoot, { path: ref.path, sha256: ref.rawSha256 });
  check(canonicalHash(result.value) === ref.canonicalSha256, "reference_canonical_bytes_changed");
  reads?.push(structuredClone(ref)); return result.value;
}
async function reread(evidenceRoot, reads) { for (const ref of reads) { reference(ref); await readBoundBytes(evidenceRoot, { path: ref.path, sha256: ref.rawSha256 }); } }
const blocked = (plan, manifest) => new Set([...plan.coordinators, ...plan.blockedAuthorContextIds, ...(manifest.implementationAuthorContextIds ?? []), ...manifest.cases.map(row => row.authorContextId)]);
async function metadataContext(args) {
  const { evidenceRoot, config, manifest, migration, registeredAt } = args, contract = freeze(structuredClone(validateRankingReviewContract(args.contract, { config, manifest, registeredAt })));
  check(same(config.rankingReviewContract, contract), "registered_contract_changed");
  // No panel member (including the public panel graph) opens before this guard.
  const publicDevelopment = await verifyDevelopmentExclusions({ evidenceRoot, config, manifest, migration, registeredAt });
  const reads = [], plan = parsePlan(await readReference(evidenceRoot, contract.publicPlan, true, reads));
  check(plan.roundId === contract.roundId && plan.frozenAt === contract.frozenAt && plan.inputMetadataSha256 === contract.inputMetadataSha256 && plan.partitionSha256 === contract.partitionSha256 &&
    plan.binding.catalogSha256 === contract.catalogSha256 && plan.binding.sourceSnapshotSha256 === contract.rankingSourceSnapshotSha256 && rankingPanelProfilePoolSha256(planPools(plan)) === contract.profilePoolSha256, "contract_plan_binding_changed");
  const cases = manifest.cases.filter(row => row.layer === "ranking");
  check(cases.length === 120 && plan.profiles.every(row => cases.some(item => item.caseId === row.caseId && item.familyId === row.familyId && item.taskGroup === row.taskGroup && item.inputSha256 === row.inputSha256)), "plan_challenge_metadata_changed");
  const assignmentFile = await readReference(evidenceRoot, contract.publicAssignments, true, reads);
  document(assignmentFile, "saitu.ranking-shard-assignments.v7.2", ["roundId", "partitionSha256", "inputMetadataSha256", "issuedAt", "assignments"]);
  check(assignmentFile.roundId === plan.roundId && assignmentFile.partitionSha256 === plan.partitionSha256 && assignmentFile.inputMetadataSha256 === plan.inputMetadataSha256 &&
    isTime(assignmentFile.issuedAt) && Date.parse(assignmentFile.issuedAt) >= Date.parse(plan.frozenAt) && Date.parse(assignmentFile.issuedAt) <= Date.parse(registeredAt) && Array.isArray(assignmentFile.assignments), "frozen_assignments_required");
  const assignments = assignRankingPanelAuthors(plan, assignmentFile.assignments.map(row => row.authorContextId));
  check(same(assignments, assignmentFile.assignments) && assignments.every(row => !blocked(plan, manifest).has(row.authorContextId)), "actual_author_assignment_changed_or_not_independent");
  const collection = await readReference(evidenceRoot, contract.sealedCollection, true, reads);
  document(collection, "saitu.ranking-shard-sealed-collection.v7.2", ["roundId", "partitionSha256", "assignmentsSha256", "collectedAt", "originals"]);
  check(collection.roundId === plan.roundId && collection.partitionSha256 === plan.partitionSha256 && collection.assignmentsSha256 === canonicalHash(assignments) &&
    isTime(collection.collectedAt) && Date.parse(collection.collectedAt) <= Date.parse(registeredAt) && Array.isArray(collection.originals) && collection.originals.length === 48 &&
    unique(collection.originals.map(row => `${row.panelId}/${row.shardId}`)), "all48_sealed_original_descriptors_required");
  for (const assignment of assignments) {
    const row = collection.originals.find(item => item.panelId === assignment.panelId && item.shardId === assignment.shardId);
    exact(row, ["panelId", "shardId", "authorContextId", "sourcePacket", "original", "openedAt", "sealedAt", "blindState"], "sealed_descriptor_fields_required");
    reference(row.sourcePacket); reference(row.original); blind(row.blindState);
    check(row.authorContextId === assignment.authorContextId && row.sourcePacket.path === assignment.expectedPacketPath && row.original.path === assignment.expectedRawPath, "sealed_descriptor_assignment_changed");
    check(isTime(row.openedAt) && isTime(row.sealedAt) && Date.parse(row.openedAt) >= Date.parse(assignmentFile.issuedAt) && Date.parse(row.sealedAt) >= Date.parse(row.openedAt) && Date.parse(row.sealedAt) <= Date.parse(collection.collectedAt), "actual_open_seal_timeline_required");
  }
  await reread(evidenceRoot, reads); verifyPlan(plan);
  const summary = freeze({ schemaVersion: "saitu.ranking-panel-metadata-verification.v7.2", contractSha256: canonicalHash(contract), publicPlanRawSha256: contract.publicPlan.rawSha256,
    publicPlanCanonicalSha256: contract.publicPlan.canonicalSha256, assignmentsRawSha256: contract.publicAssignments.rawSha256, sealedCollectionRawSha256: contract.sealedCollection.rawSha256,
    partitionSha256: plan.partitionSha256, inputMetadataSha256: plan.inputMetadataSha256, profilePoolSha256: contract.profilePoolSha256, originalAuthors: 48, profiles: 120, pairedUnits: 5400,
    latestOriginalSealedAt: collection.originals.map(row => row.sealedAt).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1), adjudicationReference: contract.adjudication,
    publicDevelopmentManifestSha256: publicDevelopment.publicDevelopmentManifestSha256, rawGradesOpened: false });
  return { plan, assignments: freeze(assignments), collection: freeze(collection), contract, reads, summary };
}
/** Re-verifies public exclusions and reads only public provenance metadata. */
export async function verifyRankingPanelMetadata(args) { return (await metadataContext(args)).summary; }

function originalProfiles(profiles, assignment, plan) {
  check(Array.isArray(profiles) && profiles.length === 5 && unique(profiles.map(row => row.profileId)) && same(sorted(profiles.map(row => row.profileId)), sorted(assignment.profileIds)), "exact_five_profile_original_required");
  const full = plan.candidates.map(row => row.itemId);
  for (const row of profiles) {
    exact(row, ["profileId", "poolItemIds", "judgments"], "original_profile_fields_required");
    check(Array.isArray(row.poolItemIds) && row.poolItemIds.length === 45 && unique(row.poolItemIds) && same(sorted(row.poolItemIds), full) && Array.isArray(row.judgments) && row.judgments.length === 45 &&
      unique(row.judgments.map(item => item.itemId)) && same(sorted(row.judgments.map(item => item.itemId)), full), "complete_unique_45_originals_required");
    for (const item of row.judgments) { exact(item, ["itemId", "relevance", "reason"], "original_judgment_fields_required"); check(grade(item.relevance) && reasonText(item.reason), "original_grade_and_reason_required_no_U_coercion"); }
  }
}
export function isVerifiedRankingPanels(value, context) { return Boolean(value && context && verified.has(value) && same(verified.get(value), { result: canonicalHash(value), contract: canonicalHash(context.contract), manifest: canonicalHash(context.manifest), registeredAt: context.registeredAt, pool: rankingPanelProfilePoolSha256(context.expectedProfiles) })); }

/** Actual bounded filesystem reader. No injected byte reader or implicit v7.1 conversion. */
export async function loadRankingPanelsOriginals(args) {
  const { evidenceRoot, manifest, registeredAt } = args, expectedProfiles = structuredClone(args.expectedProfiles), state = await metadataContext(args);
  const { plan, assignments, collection, contract, reads, summary } = state;
  if (args.expectedMetadataVerification !== undefined) check(same(summary, args.expectedMetadataVerification), "registered_panel_metadata_verification_changed");
  check(Array.isArray(expectedProfiles) && expectedProfiles.length === 120 && unique(expectedProfiles.map(row => row.profileId)) &&
    expectedProfiles.every(row => row.poolItemIds.length === 45 && unique(row.poolItemIds) && row.judgments.length === 45 && unique(row.judgments.map(item => item.itemId))) &&
    rankingPanelProfilePoolSha256(expectedProfiles) === contract.profilePoolSha256, "frozen_matrix_pool_differs_from_plan");
  const loaded = new Map();
  for (const assignment of assignments) {
    const descriptor = collection.originals.find(row => row.panelId === assignment.panelId && row.shardId === assignment.shardId);
    const packet = await readReference(evidenceRoot, descriptor.sourcePacket, false, reads);
    document(packet, "saitu.ranking-shard-source-packet.v7.2", ["roundId", "panelId", "shardId", "assignedAuthorContextId", "createdAt", "partitionSha256", "inputMetadataSha256", "binding", "profileIds", "profiles", "candidateRegistry", "candidateOrder", "rubric", "authorModel", "authorEffort", "labelsIncluded", "productOutputsIncluded"]);
    check(packet.roundId === plan.roundId && packet.panelId === assignment.panelId && packet.shardId === assignment.shardId && packet.assignedAuthorContextId === assignment.authorContextId &&
      packet.partitionSha256 === plan.partitionSha256 && packet.inputMetadataSha256 === plan.inputMetadataSha256 && same(packet.binding, plan.binding) && packet.labelsIncluded === false && packet.productOutputsIncluded === false &&
      packet.authorModel === RANKING_PANEL_RULES.model && packet.authorEffort === RANKING_PANEL_RULES.reasoningEffort, "packet_source_or_blind_binding_changed");
    check(Array.isArray(packet.profiles) && packet.profiles.length === 5 && Array.isArray(packet.profileIds) && packet.profileIds.length === 5 && same(sorted(packet.profileIds), sorted(assignment.profileIds)) &&
      unique(packet.profiles.map(row => row.profileId)) && same(sorted(packet.profiles.map(row => row.profileId)), sorted(assignment.profileIds)) && packet.profiles.every(row => {
        exact(row, [...metaFields, "input"], "packet_exact_metadata_fields_required");
        const meta = plan.profiles.find(item => item.profileId === row.profileId); return meta && metaFields.every(field => typeof row[field] === "string" && row[field] === meta[field]) && canonicalHash(row.input) === meta.inputSha256;
      }), "packet_frozen_metadata_or_input_changed");
    check(Array.isArray(packet.candidateRegistry) && packet.candidateRegistry.length === 45 && canonicalHash(packet.candidateRegistry) === plan.binding.candidateEvidenceSha256 &&
      same(packet.candidateRegistry.map(({ itemId, seriesId }) => ({ itemId, seriesId })).sort((a, b) => a.itemId.localeCompare(b.itemId)), plan.candidates) &&
      Array.isArray(packet.candidateOrder) && packet.candidateOrder.length === 45 && unique(packet.candidateOrder) && same(sorted(packet.candidateOrder), plan.candidates.map(row => row.itemId)), "packet_full45_evidence_required");
    check(same(packet.rubric, { rubricSha256: plan.binding.rubricSha256, allowedGrades: [0, 1, 2, 3, "U"], full45Required: true, unknownIsNotZero: true }), "fixed_rubric_required");
    const raw = await readReference(evidenceRoot, descriptor.original, false, reads);
    document(raw, "saitu.ranking-shard-original.v7.2", ["roundId", "panelId", "shardId", "authorContextId", "authorModel", "authorEffort", "status", "blindState", "sourcePacket", "partitionSha256", "openedAt", "sealedAt", "profiles"]);
    check(raw.roundId === plan.roundId && raw.panelId === assignment.panelId && raw.shardId === assignment.shardId && raw.authorContextId === assignment.authorContextId && raw.authorModel === RANKING_PANEL_RULES.model &&
      raw.authorEffort === RANKING_PANEL_RULES.reasoningEffort && raw.status === "sealed" && same(raw.sourcePacket, descriptor.sourcePacket) && raw.partitionSha256 === plan.partitionSha256 && same(raw.blindState, descriptor.blindState), "actual_sealed_author_or_source_changed"); blind(raw.blindState);
    check(raw.openedAt === descriptor.openedAt && raw.sealedAt === descriptor.sealedAt && isTime(packet.createdAt) && Date.parse(packet.createdAt) >= Date.parse(plan.frozenAt) && Date.parse(packet.createdAt) <= Date.parse(raw.openedAt), "actual_packet_open_seal_timeline_required");
    originalProfiles(raw.profiles, assignment, plan); loaded.set(assignment.jobId, { descriptor, raw });
  }
  const panels = panelIds.map((panelId, p) => ({ schemaVersion: "saitu.ranking-review-panel.v7.2", ...policy, evidenceClass: "ai_proxy", panelId, roundId: plan.roundId,
    partitionSha256: plan.partitionSha256, inputMetadataSha256: plan.inputMetadataSha256, collectionReference: contract.sealedCollection,
    assembly: { coordinatorContextId: plan.coordinators[p], role: "assembler_only_no_grading", assembledAt: new Date().toISOString(), gradesGenerated: false },
    shards: assignments.filter(row => row.panelId === panelId).map(assignment => { const { descriptor, raw } = loaded.get(assignment.jobId); return { shardId: assignment.shardId,
      authorContextId: assignment.authorContextId, sourcePacket: descriptor.sourcePacket, original: descriptor.original, openedAt: raw.openedAt, sealedAt: raw.sealedAt,
      blindState: raw.blindState, profileIds: assignment.profileIds, profiles: raw.profiles }; }) }));
  const rows = expectedProfiles.flatMap(profile => profile.poolItemIds.map(itemId => {
    const sources = panels.map(panel => { const shard = panel.shards.find(row => row.profileIds.includes(profile.profileId)), pi = shard.profiles.findIndex(row => row.profileId === profile.profileId), ji = shard.profiles[pi].judgments.findIndex(row => row.itemId === itemId), judgment = shard.profiles[pi].judgments[ji];
      return { panelId: panel.panelId, shardId: shard.shardId, authorContextId: shard.authorContextId, original: shard.original, sourcePacket: shard.sourcePacket, pointer: `/profiles/${pi}/judgments/${ji}`, judgmentCanonicalSha256: canonicalHash(judgment), relevance: judgment.relevance }; });
    return { profileId: profile.profileId, itemId, taskGroup: profile.taskGroup, grades: sources.map(row => row.relevance), sources };
  }));
  const pairs = rows.map(row => row.grades), groupIds = sorted(new Set(rows.map(row => row.taskGroup))), baseAgreement = ordinalAgreement(pairs);
  const originalAgreement = { ...baseAgreement, minimumAlpha: .70, source: "48_actual_shard_authors_two_sealed_panels_before_adjudication", actualAuthorCount: 48, disconnectedAssignmentComponents: 24,
    denominator: 5400, missingOriginalJudgments: [], coverageComplete: true, unknownPairs: baseAgreement.withUnknown,
    byTaskGroup: groupIds.map(taskGroup => ({ taskGroup, ...ordinalAgreement(rows.filter(row => row.taskGroup === taskGroup).map(row => row.grades)) })) };
  const unresolved = rows.filter(row => row.grades.includes("U") || row.grades[0] !== row.grades[1]), blockers = [];
  if (baseAgreement.value === null) blockers.push("original_blind_agreement_alpha_pending_or_null"); else if (baseAgreement.value < .70) blockers.push("original_blind_agreement_alpha_below_070");
  const resolutions = new Map();
  if (!blockers.length && contract.adjudication !== null) {
    const adjudicator = await readReference(evidenceRoot, contract.adjudication, false, reads);
    document(adjudicator, "saitu.ranking-panel-adjudication.v7.2", ["contextId", "openedAt", "sealedAt", "blindToAlgorithms", "productOutputsRead", "resolvesCollection", "partitionSha256", "resolutions"]);
    check(identity(adjudicator.contextId) && !blocked(plan, manifest).has(adjudicator.contextId) && !assignments.some(row => row.authorContextId === adjudicator.contextId) && adjudicator.blindToAlgorithms === true && adjudicator.productOutputsRead === false &&
      same(adjudicator.resolvesCollection, contract.sealedCollection) && adjudicator.partitionSha256 === plan.partitionSha256 && isTime(adjudicator.openedAt) && isTime(adjudicator.sealedAt) &&
      Date.parse(adjudicator.openedAt) >= Date.parse(collection.collectedAt) && Date.parse(adjudicator.sealedAt) >= Date.parse(adjudicator.openedAt) && Date.parse(adjudicator.sealedAt) <= Date.parse(registeredAt) && Array.isArray(adjudicator.resolutions), "fresh_third_bound_adjudication_required");
    for (const row of adjudicator.resolutions) {
      exact(row, ["profileId", "itemId", "relevance", "reason", "originalJudgmentSha256"], "resolution_fields_required");
      const key = JSON.stringify([row.profileId, row.itemId]), unit = unresolved.find(item => item.profileId === row.profileId && item.itemId === row.itemId);
      check(unit && !resolutions.has(key) && grade(row.relevance) && reasonText(row.reason) && same(row.originalJudgmentSha256, unit.sources.map(item => item.judgmentCanonicalSha256)), "resolution_not_bound_to_two_original_judgments"); resolutions.set(key, row);
    }
  }
  const unresolvedAfterAdjudication = unresolved.filter(row => { const resolution = resolutions.get(JSON.stringify([row.profileId, row.itemId])); return !resolution || resolution.relevance === "U"; });
  if (unresolvedAfterAdjudication.length) blockers.push("ranking_panel_adjudication_pending_or_U");
  const resolvedProfiles = blockers.length ? null : expectedProfiles.map(profile => ({ ...profile, annotationStatus: "ai_blind_reviewed", judgments: profile.judgments.map(item => {
    const unit = rows.find(row => row.profileId === profile.profileId && row.itemId === item.itemId), resolution = resolutions.get(JSON.stringify([profile.profileId, item.itemId]));
    return { itemId: item.itemId, seriesId: item.seriesId, relevance: resolution ? resolution.relevance : unit.grades[0] };
  }) }));
  await reread(evidenceRoot, reads); verifyPlan(plan);
  const result = { schemaVersion: "saitu.ranking-panel-originals-verification.v7.2", ...policy, metadataVerification: summary, panels, rows, statPairs: pairs, originalAgreement,
    unresolved: unresolved.map(row => ({ profileId: row.profileId, itemId: row.itemId, grades: row.grades, sources: row.sources })), unresolvedAfterAdjudication: unresolvedAfterAdjudication.length,
    resolvedProfiles, blockers: [...new Set(blockers)], actualAuthorContextIds: assignments.map(row => row.authorContextId), rawOriginalBytesVerified: true, allOriginalsSealedBeforeStatistics: true,
    coordinatorGeneratedGrades: false, goldReady: blockers.length === 0, productAcceptance: false };
  verified.set(result, { result: canonicalHash(result), contract: canonicalHash(args.contract), manifest: canonicalHash(manifest), registeredAt, pool: rankingPanelProfilePoolSha256(expectedProfiles) }); return result;
}
