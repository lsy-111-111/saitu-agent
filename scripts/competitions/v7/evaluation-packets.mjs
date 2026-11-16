import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { seededShuffle, deriveRunSeed } from "../v6/frozen-ranking-executor.mjs";
import { POLICY_VERSION, POLICY_SHA256, canonicalHash, byteHash, requirePolicy, assertRankingGroups, assertUnique, isHash, isTime, writeNewJson, parseFileCli } from "./evaluation-policy.mjs";
const { ordinalAgreement } = createRequire(import.meta.url)("../v6/reviewer-agreement.ts");

export function sanitizeRankingCandidate(record, isDecisionEvidenceFact, matchingMetadata = null) {
  if (typeof isDecisionEvidenceFact !== "function") throw new Error("actual_product_evidence_predicate_required");
  const audience = matchingMetadata?.stableAudienceEvidence;
  const evidenceRecord = audience ? { ...record, facts: [...record.facts, ...audience.facts], sources: [...record.sources, ...audience.sources] } : record;
  const audienceFactIds = new Set((matchingMetadata?.stableAudienceRules ?? []).flatMap(rule => rule.factIds));
  const facts = evidenceRecord.facts.filter(fact => isDecisionEvidenceFact(evidenceRecord, fact) &&
    (!/registration|eligibility|milestone|current.*date/i.test(fact.field) || audienceFactIds.has(fact.id)));
  const legal = new Set(facts.map(fact => fact.id)), sourceIds = new Set(facts.flatMap(fact => fact.sourceIds));
  const closed = claim => Array.isArray(claim.factIds) && claim.factIds.length > 0 && claim.factIds.every(id => legal.has(id));
  return { itemId: record.recordId, seriesId: record.seriesId, name: record.name, track: record.track,
    taskFamily: record.taskFamily, sections: Object.fromEntries(Object.entries(record.sections).filter(([key]) => !/registration|eligibility|milestone|current.*date/i.test(key)).map(([key, claims]) => [key, claims.filter(closed)])),
    roles: record.roles.filter(closed), editorialSoftSignals: { skills: record.skills, preferredOutputs: record.preferredOutputs },
    valueDimensions: record.valueDimensions.filter(row => closed(row.assessment)), facts,
    reliableAudienceRules: (matchingMetadata?.stableAudienceRules ?? []).filter(rule => rule.factIds.length && rule.factIds.every(id => legal.has(id))),
    sources: evidenceRecord.sources.filter(source => sourceIds.has(source.id) && source.accessStatus === "body_read").map(source => ({ ...source, factIds: facts.filter(fact => fact.sourceIds.includes(source.id)).map(fact => fact.id) })),
    excludedFactMetadata: evidenceRecord.facts.filter(fact => !facts.includes(fact)).map(({ id, status }) => ({ id, status, use: "excluded_not_reliable_judgment_evidence" })) };
}
/** Both reviewers see the same new full pool, never old judgments, rule scores or product order. */
export function buildRankingPackets({ profiles, catalog, binding, applicability, authorContextId, isDecisionEvidenceFact, matchingMetadataById = {}, seeds = [randomBytes(4).readUInt32LE(), randomBytes(4).readUInt32LE()] }) {
  requirePolicy(binding); assertRankingGroups(profiles);
  if (!authorContextId || binding.scope !== "ranking_gold_preparation_only" || binding.formalRegistration !== false ||
      ![binding.catalogSha256, binding.rankingSourceSnapshotSha256, binding.poolDerivationSourceSha256].every(isHash) ||
      canonicalHash(catalog) !== binding.catalogSha256 || !Array.isArray(applicability) || applicability.length !== 120) throw new Error("frozen_v7_full_catalog_and_independent_120_applicability_required");
  if (seeds.length !== 2 || seeds[0] === seeds[1]) throw new Error("independent_packet_permutations_required");
  const records = new Map(catalog.map(record => [record.recordId, record]));
  const normal = profiles.map(profile => {
    const review = applicability.find(row => row.caseId === profile.caseId);
    if (!review || !review.contextId || review.contextId === authorContextId || review.inputSha256 !== canonicalHash(profile.input) ||
        review.policySha256 !== POLICY_SHA256 || review.decision !== "applicable" || !review.reason?.trim()) throw new Error("fresh_independent_ranking_input_applicability_pending");
    const assessmentItemIds = profile.assessmentItemIds ?? profile.candidateItemIds;
    assertUnique(assessmentItemIds, "unique_full_profile_pool_required");
    if (assessmentItemIds.some(id => !records.has(id)) || profile.candidateItemIds.some(id => !assessmentItemIds.includes(id))) throw new Error("ranking_pool_outside_frozen_catalog");
    if (!profile.poolDerivation || profile.poolDerivation.policySha256 !== POLICY_SHA256 || profile.poolDerivation.poolDerivationSourceSha256 !== binding.poolDerivationSourceSha256 ||
        profile.poolDerivation.inputSha256 !== canonicalHash(profile.input) || !isHash(profile.poolDerivation.evidenceSha256)) throw new Error("actual_v7_candidate_membership_derivation_required");
    return { profileId: profile.profileId, caseId: profile.caseId, familyId: profile.familyId, taskGroup: profile.taskGroup,
      inputSha256: canonicalHash(profile.input), input: profile.input, poolItemIds: assessmentItemIds,
      candidates: assessmentItemIds.map(id => sanitizeRankingCandidate(records.get(id), isDecisionEvidenceFact, matchingMetadataById[id] ?? null)) };
  });
  const profilePoolSha256 = canonicalHash(normal.map(profile => ({ profileId: profile.profileId, familyId: profile.familyId, taskGroup: profile.taskGroup,
    poolItemIds: profile.poolItemIds, series: profile.poolItemIds.map(itemId => ({ itemId, seriesId: records.get(itemId).seriesId })) })));
  const rubric = { scale: { "3": "strong_task_and_goal_fit_or_feasible_beginner_path", "2": "useful_alternative_with_clear_conditions", "1": "weak_or_uncertain_exploration", "0": "known_conflict_or_not_useful_for_expressed_goal", U: "insufficient_evidence_requires_review" },
    selfReport: "adopt_explicit_student_statement_without_proof_or_repeat_confirmation", exclusions: "only_reliable_audience_conflict_or_explicit_student_constraint",
    historicalRegistration: "not_a_current_enrollment_gate", unknown: "never_silently_grade_as_zero", allCandidatesRequired: true,
    independence: "do_not_read_old_labels_other_reviewer_or_product_outputs" };
  const registry = [...new Map(normal.flatMap(profile => profile.candidates).map(candidate => [candidate.itemId, candidate])).values()];
  const packets = seeds.map((seed, index) => ({ schemaVersion: "saitu.ranking-review-packet.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    role: index ? "reviewer_b" : "reviewer_a", coordinatorContextId: authorContextId, binding, profilePoolSha256, rubric,
    candidateRegistry: seededShuffle(registry, seed),
    profiles: seededShuffle(normal, seed).map(({ candidates, ...profile }) => ({ ...profile, candidateOrder: seededShuffle(candidates.map(row => row.itemId), deriveRunSeed(seed, profile.profileId, 1)) })),
    originalOutputContract: { contextId: null, openedAt: null, sealedAt: null, blindToAlgorithms: true, productOutputsRead: false,
      authorModel: "gpt-6.1-sol", authorEffort: "max", freshContext: true, oldJudgmentsRead: false, otherReviewerJudgmentsRead: false,
      profiles: normal.map(profile => ({ profileId: profile.profileId, poolItemIds: profile.poolItemIds,
        judgments: profile.poolItemIds.map(itemId => ({ itemId, relevance: "U", reason: "" })) })) } }));
  return { packets, privateCoordinatorSeeds: seeds, publicSummary: { schemaVersion: "saitu.ranking-packet-summary.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    profiles: 120, independentFamilies: 120, candidatePairsPerReviewer: normal.reduce((sum, profile) => sum + profile.poolItemIds.length, 0), profilePoolSha256,
    catalogSha256: binding.catalogSha256, rankingSourceSnapshotSha256: binding.rankingSourceSnapshotSha256, implementationSha256: null,
    poolDerivationSourceSha256: binding.poolDerivationSourceSha256,
    runtimeConfigurationSha256: binding.runtimeConfigurationSha256 ?? null, formalRegistration: false,
    freezeScope: "independent_input_catalog_source_and_rubric_not_paid_execution_registration", oldLabelsRead: false, productOutputsRead: false, rankingGoldComplete: false } };
}
/** Shared by packet preparation and the actual new-stage raw/scoring consumers. */
export function validateCompleteReviewerProvenance(original, { blockedContextIds = [] } = {}) {
  if (!original?.contextId || blockedContextIds.includes(original.contextId) || original.blindToAlgorithms !== true || original.productOutputsRead !== false || original.freshContext !== true ||
      original.oldJudgmentsRead !== false || original.otherReviewerJudgmentsRead !== false || original.authorModel !== "gpt-6.1-sol" || original.authorEffort !== "max" ||
      !isTime(original.openedAt) || !isTime(original.sealedAt) || Date.parse(original.openedAt) > Date.parse(original.sealedAt) || !Array.isArray(original.profiles) || original.profiles.length !== 120) throw new Error("complete_fresh_blind_original_provenance_required");
  return original;
}
/** Anonymous statistics only. File-byte verification belongs to the authorized isolated reader. */
export function inspectCompleteBlindOriginals({ originalA, originalB, cleanPacket }) {
  requirePolicy(cleanPacket); assertRankingGroups(cleanPacket.profiles);
  const originals = [originalA, originalB], contexts = originals.map(row => row?.contextId), pairs = [];
  if (contexts.some(id => !id || id === cleanPacket.coordinatorContextId) || new Set(contexts).size !== 2) throw new Error("two_distinct_complete_fresh_reviewers_required");
  for (const original of originals) {
    validateCompleteReviewerProvenance(original, { blockedContextIds: [cleanPacket.coordinatorContextId] });
    assertUnique(original.profiles.map(row => row.profileId), "duplicate_complete_reviewer_profile");
  }
  for (const profile of cleanPacket.profiles) {
    if (profile.poolItemIds?.length !== 45) throw new Error("complete_reviewer_requires_120_by_45_pool");
    assertUnique(profile.poolItemIds, "duplicate_complete_reviewer_pool_item");
    const rows = originals.map(original => original.profiles.find(row => row.profileId === profile.profileId));
    for (const row of rows) {
      if (!row || !Array.isArray(row.judgments) || row.judgments.length !== 45 ||
          canonicalHash([...row.poolItemIds].sort()) !== canonicalHash([...profile.poolItemIds].sort()) ||
          row.judgments.some(judgment => !profile.poolItemIds.includes(judgment.itemId) || ![0, 1, 2, 3, "U"].includes(judgment.relevance) || !judgment.reason?.trim())) throw new Error("complete_original_blind_pool_judgments_required");
      assertUnique(row.judgments.map(judgment => judgment.itemId), "duplicate_original_blind_judgment");
    }
    for (const itemId of profile.poolItemIds) pairs.push(rows.map(row => row.judgments.find(judgment => judgment.itemId === itemId).relevance));
  }
  const agreement = ordinalAgreement(pairs);
  return { schemaVersion: "saitu.complete-blind-agreement.safe.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    reviewers: 2, profilesPerReviewer: 120, judgmentsPerReviewer: 5400, pairedUnitDenominator: 5400, missingOriginalJudgments: 0,
    originalCanonicalSha256: originals.map(canonicalHash), reviewerContextSha256: contexts.map(canonicalHash), rawOriginalAlpha: agreement.value,
    numericPairs: agreement.paired, unknownPairs: agreement.withUnknown, minimumRawOrdinalAlpha: .70,
    disagreementsPlusUnknown: pairs.filter(pair => pair.includes("U") || pair[0] !== pair[1]).length,
    eligibleForAdjudication: agreement.value !== null && agreement.value >= .70, rawOriginalBytesVerified: false, productAcceptance: false };
}
export function buildAdjudicationPacket({ originalA, originalB, cleanPacket, adjudicatorContextId }) {
  requirePolicy(cleanPacket);
  if (!adjudicatorContextId || [originalA.contextId, originalB.contextId, cleanPacket.coordinatorContextId].includes(adjudicatorContextId) ||
      !originalA.contextId || !originalB.contextId || originalA.contextId === originalB.contextId || [originalA, originalB].some(row => row.blindToAlgorithms !== true || row.productOutputsRead !== false)) throw new Error("fresh_third_adjudicator_and_two_blind_originals_required");
  const agreement = inspectCompleteBlindOriginals({ originalA, originalB, cleanPacket });
  if (!agreement.eligibleForAdjudication) throw new Error("original_blind_agreement_alpha_below_070_or_null_no_adjudication");
  const cases = [];
  for (const profile of cleanPacket.profiles) {
    const rows = [originalA, originalB].map(original => original.profiles.find(row => row.profileId === profile.profileId));
    if (rows.some(row => !row || !Array.isArray(row.judgments) || new Set(row.judgments.map(judgment => judgment.itemId)).size !== profile.poolItemIds.length ||
        profile.poolItemIds.some(id => !row.judgments.some(judgment => judgment.itemId === id && [0, 1, 2, 3, "U"].includes(judgment.relevance))))) throw new Error("complete_original_blind_pool_judgments_required");
    for (const itemId of profile.poolItemIds) {
      const originals = rows.map(row => row.judgments.find(judgment => judgment.itemId === itemId));
      if (originals[0].relevance !== originals[1].relevance || originals[0].relevance === "U") cases.push({ profileId: profile.profileId, itemId, input: profile.input,
        candidate: cleanPacket.candidateRegistry.find(row => row.itemId === itemId), originalJudgmentSha256: originals.map(canonicalHash), originals,
        relevance: "U", reason: "" });
    }
  }
  return { schemaVersion: "saitu.ranking-adjudication-packet.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    contextId: adjudicatorContextId, sealedAt: null, resolvesOriginalSha256: [canonicalHash(originalA), canonicalHash(originalB)],
    profilePoolSha256: cleanPacket.profilePoolSha256, disputes: cases, productOutputsIncluded: false };
}
async function main() {
  const options = parseFileCli(process.argv.slice(2), ["--profiles", "--catalog", "--binding", "--applicability", "--author-context", "--output"]);
  const data = await Promise.all(["--profiles", "--catalog", "--binding", "--applicability"].map(async key => JSON.parse(await readFile(options[key], "utf8"))));
  const { installSourceLoader } = await import("../../lib/load-typescript-source.mjs"); installSourceLoader();
  const { isDecisionEvidenceFact } = await import("../../../src/lib/competitions/v6/evidence.ts");
  const { getMatchingCatalogMetadata } = await import("../../../src/lib/competitions/v7/catalog.ts");
  const matchingMetadataById = Object.fromEntries(data[1].map(record => [record.recordId, getMatchingCatalogMetadata(record)]));
  const result = buildRankingPackets({ profiles: data[0].profiles ?? data[0], catalog: data[1], binding: data[2], applicability: data[3], authorContextId: options["--author-context"], isDecisionEvidenceFact, matchingMetadataById });
  await mkdir(options["--output"], { recursive: false, mode: 0o700 });
  const packets = [];
  for (let index = 0; index < 2; index++) {
    const directory = path.join(options["--output"], index ? "reviewer_b" : "reviewer_a"); await mkdir(directory, { mode: 0o700 });
    const filename = path.join(directory, "packet.json"); await writeNewJson(filename, result.packets[index]);
    packets.push({ role: result.packets[index].role, path: `${result.packets[index].role}/packet.json`, sha256: byteHash(await readFile(filename)) });
  }
  await writeNewJson(path.join(options["--output"], "coordinator-only-seeds.json"), result.privateCoordinatorSeeds);
  await writeNewJson(path.join(options["--output"], "public-summary.json"), { ...result.publicSummary, packets,
    filters: { packetProducerSha256: byteHash(await readFile(fileURLToPath(import.meta.url))), productEvidencePredicatePath: "src/lib/competitions/v6/evidence.ts",
      productEvidencePredicateSha256: byteHash(await readFile(new URL("../../../src/lib/competitions/v6/evidence.ts", import.meta.url))) } });
  console.log(JSON.stringify({ output: options["--output"], profiles: 120, candidatePairsPerReviewer: result.publicSummary.candidatePairsPerReviewer, gold: "pending_two_blind_originals_and_adjudication" }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
