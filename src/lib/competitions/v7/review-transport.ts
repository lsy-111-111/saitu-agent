import type { AssertionReviewPacketV7 } from "./evidence-packet";
import type { DecisionClaimV6 } from "../v6/contracts";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { compactCandidateEvidence, expandCandidateEvidence } from "../v6/model-evidence-pack";
import { compactMatchingTables, expandMatchingTables } from "../v6/model-match-tables";
import { GROUNDED_PRACTICE_LABEL_V7, MATCHING_RELATION_LABEL_V764 } from "./match-learning-selection";
import { rankTaskFocusOptionsV7, readMatchingRelationV764, readMatchingRelationV765, readTaskRelationV766, readTaskConnectionV767, readSealedTaskPracticeReviewV7, readRankBoundTaskPracticeBridgeV7 } from "./role-task-practice";
import type { FutureUseSelectionV764, LearnerBasisSelectionV760, LearnerRelationV759, MatchingRelationReviewV765, TaskRelationSelectionV766 } from "./group-contracts";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const groundedReviewEncoding = "saitu.grounded-review-tables.v1";
const ownerReviewRowsVersion = "saitu.owner-review-rows.v1";
export const MATCHING_RELATION_REVIEW_CONTRACT_V765 = "saitu.matching-relation-review.v1";
export const MATCHING_RELATION_REVIEW_CONTRACT_V766 = "saitu.matching-relation-review.v2";
export const MATCHING_RELATION_REVIEW_CONTRACT_V767 = "saitu.matching-relation-review.v3";
export type MatchingRelationReviewContractV7 = typeof MATCHING_RELATION_REVIEW_CONTRACT_V765
  | typeof MATCHING_RELATION_REVIEW_CONTRACT_V766 | typeof MATCHING_RELATION_REVIEW_CONTRACT_V767;
const isMatchingRelationReviewContract = (value: unknown): value is MatchingRelationReviewContractV7 =>
  value === MATCHING_RELATION_REVIEW_CONTRACT_V765 || value === MATCHING_RELATION_REVIEW_CONTRACT_V766
  || value === MATCHING_RELATION_REVIEW_CONTRACT_V767;
export const matchingRelationReviewSchemaV765 = z.object({
  checks: z.array(z.object({
    key: z.string().min(1), fit: z.boolean(), source: z.boolean(),
    learnerAttribution: z.boolean(), conditions: z.boolean(), reason: z.string().max(240),
  }).strict()).max(64),
}).strict();
const jointPurpose = "joint_recommendation_fit_and_role_action";
const jointPurposes = ["recommendation_fit", "selected_role_action"];
const jointSemantics = "supported_requires_all_reviewPurposes_one_provider_verdict_not_independent_reviews";
const ownerIdentityFields = ["name", "edition", "track", "scope"];
const emptyCompetitionCounterevidence = {
  facts: [], unresolvedFactIds: [], sourceBindings: { sources: [], unresolvedSourceIds: [], ambiguousSourceIds: [] },
  use: "conditions_and_counterevidence_only_not_positive_support",
};
export const GROUNDED_REVIEW_EVIDENCE_ENCODING_PROMPT_V7 = "审核包reviewEvidenceEncoding为saitu.grounded-review-tables.v1时，assertions与profile直接读取。展开evidenceBundle时，{$table:'tN',rows:[…]}按tableSchemas列名还原对象，{$text:'tN'}与{$scope:'sN'}逐字查本包evidenceDictionary的texts/scopes。把唯一一行的sharedCandidateBoundaries归回根层，再解析$reviewRef。原值与所属行不变。";

/** Restore candidate boundaries before resolving review pointers. The actual
 * assertions, their direct evidence and the full profile remain inline. */
function expandGroundedReviewTables<T>(value: T): T {
  if (!object(value) || !Object.hasOwn(value, "reviewEvidenceEncoding")) return value;
  const { reviewEvidenceEncoding, evidenceBundle, evidenceDictionary, tableSchemas, ...headers } = value;
  if (reviewEvidenceEncoding !== groundedReviewEncoding || !object(tableSchemas)
    || !Array.isArray(headers.assertions) || Object.hasOwn(headers, "sharedCandidateBoundaries")) throw new Error("invalid_grounded_review_evidence_encoding");
  const decoded = expandCandidateEvidence(expandMatchingTables({ candidates: evidenceBundle, tableSchemas,
    ...(evidenceDictionary === undefined ? {} : { evidenceDictionary }) }));
  if (!object(decoded) || !Array.isArray(decoded.candidates) || decoded.candidates.length !== 1) throw new Error("invalid_grounded_review_evidence_encoding");
  const evidence: unknown = decoded.candidates[0];
  if (!object(evidence) || Object.keys(evidence).length !== 1 || !Array.isArray(evidence.sharedCandidateBoundaries)) throw new Error("invalid_grounded_review_evidence_encoding");
  return { ...headers, sharedCandidateBoundaries: evidence.sharedCandidateBoundaries } as T;
}

function ownerReviewRows(packet: Record<string, unknown>) {
  const invalid = (): never => { throw new Error("invalid_owner_review_rows"); };
  if (!Array.isArray(packet.assertions) || !Array.isArray(packet.sharedCandidateBoundaries)
    || !packet.assertions.length || packet.assertions.length !== packet.sharedCandidateBoundaries.length
    || packet.additionalCandidateBoundaries !== undefined) return invalid();
  const boundaries = new Map<string, Record<string, unknown>>();
  for (const shared of packet.sharedCandidateBoundaries) {
    if (!object(shared) || typeof shared.itemId !== "string" || typeof shared.boundaryId !== "string"
      || !object(shared.boundary) || shared.boundary.itemId !== shared.itemId || boundaries.has(shared.itemId)) return invalid();
    boundaries.set(shared.itemId, shared);
  }
  const seen = new Set<string>();
  return packet.assertions.map(row => {
    if (!object(row) || typeof row.itemId !== "string" || typeof row.selectedTaskFocus !== "string"
      || !Array.isArray(row.competitionItems) || row.competitionItems.length !== 1 || !object(row.competitionItems[0])
      || !object(row.reason) || !Array.isArray(row.reason.competitionFactIds)
      || row.reason.competitionFactIds.length !== 1 || seen.has(row.itemId)) return invalid();
    const shared = boundaries.get(row.itemId);
    const boundary = shared?.boundary;
    if (!shared || !object(boundary) || !object(boundary.selectedRoleOriginal)) return invalid();
    seen.add(row.itemId);
    const rankSelection = { taskStepIndex: row.selectedTaskStepIndex, taskFocus: row.selectedTaskFocus,
      competitionFactId: row.reason.competitionFactIds[0] };
    return { row, evidence: row.competitionItems[0], shared, boundary, role: boundary.selectedRoleOriginal, rankSelection };
  });
}

/** The one-owner joint contract already fixes identity, scope and purpose.
 * Omit only redundant coordinates and exact copies of the inline task. */
function compactOwnerReviewRowsV761(value: Record<string, unknown>): Record<string, unknown> {
  const packet = structuredClone(value);
  const matchingRelation = isMatchingRelationReviewContract(packet.reviewContract);
  if (packet.jointReviewSemantics !== jointSemantics || Object.hasOwn(packet, "ownerReviewRows")) throw new Error("invalid_owner_review_rows");
  for (const { row, evidence, shared, boundary, role, rankSelection } of ownerReviewRows(packet)) {
    if (!isDeepStrictEqual(row.allowedItemIds, [row.itemId]) || row.reviewPurpose !== jointPurpose
      || !isDeepStrictEqual(row.reviewPurposes, jointPurposes) || evidence.itemId !== row.itemId
      || evidence.candidateBoundaryId !== shared.boundaryId || Object.hasOwn(row, "provisionalSelectionMatches")) {
      throw new Error("invalid_owner_review_rows");
    }
    delete row.allowedItemIds;
    delete row.reviewPurpose;
    delete row.reviewPurposes;
    delete evidence.itemId;
    delete evidence.candidateBoundaryId;
    for (const key of ownerIdentityFields) {
      if (Object.hasOwn(evidence, key) && isDeepStrictEqual(boundary[key], evidence[key])) delete boundary[key];
    }
    if (isDeepStrictEqual(evidence.contradictionContext, emptyCompetitionCounterevidence)) delete evidence.contradictionContext;
    if (row.selectedTaskStepIndex === 0 && role.task === row.selectedTaskFocus) delete role.task;
    if (isDeepStrictEqual(row.provisionalRankSelection, rankSelection)) {
      delete row.provisionalRankSelection;
      row.provisionalSelectionMatches = true;
    }
    if (matchingRelation) {
      row.taskScope = { stepIndex: row.selectedTaskStepIndex, text: row.selectedTaskFocus };
      delete row.selectedTaskStepIndex;
      delete row.selectedTaskFocus;
    }
  }
  delete packet.jointReviewSemantics;
  return { ...packet, ownerReviewRows: ownerReviewRowsVersion };
}

export function expandGroundedReviewEvidenceV7<T>(value: T): T {
  const unfolded = expandGroundedReviewTables(value);
  if (!object(unfolded) || !Object.hasOwn(unfolded, "ownerReviewRows")) return unfolded;
  const packet: Record<string, unknown> = structuredClone(unfolded);
  if (packet.ownerReviewRows !== ownerReviewRowsVersion || Object.hasOwn(packet, "jointReviewSemantics")) throw new Error("invalid_owner_review_rows");
  if (isMatchingRelationReviewContract(packet.reviewContract)) {
    if (!Array.isArray(packet.assertions)) throw new Error("invalid_owner_review_rows");
    for (const row of packet.assertions) {
      if (!object(row) || !object(row.taskScope) || Object.keys(row.taskScope).length !== 2
        || typeof row.taskScope.text !== "string" || !Number.isSafeInteger(row.taskScope.stepIndex)
        || Object.hasOwn(row, "selectedTaskFocus") || Object.hasOwn(row, "selectedTaskStepIndex")) throw new Error("invalid_owner_review_rows");
      row.selectedTaskFocus = row.taskScope.text;
      row.selectedTaskStepIndex = row.taskScope.stepIndex;
      delete row.taskScope;
    }
  }
  delete packet.ownerReviewRows;
  packet.jointReviewSemantics = jointSemantics;
  for (const { row, evidence, shared, boundary, role, rankSelection } of ownerReviewRows(packet)) {
    if (["allowedItemIds", "reviewPurpose", "reviewPurposes"].some(key => Object.hasOwn(row, key))
      || Object.hasOwn(evidence, "itemId") || Object.hasOwn(evidence, "candidateBoundaryId")) throw new Error("invalid_owner_review_rows");
    row.allowedItemIds = [row.itemId];
    row.reviewPurpose = jointPurpose;
    row.reviewPurposes = [...jointPurposes];
    evidence.itemId = row.itemId;
    evidence.candidateBoundaryId = shared.boundaryId;
    for (const key of ownerIdentityFields) {
      if (!Object.hasOwn(boundary, key) && Object.hasOwn(evidence, key)) boundary[key] = structuredClone(evidence[key]);
    }
    if (!Object.hasOwn(evidence, "contradictionContext")) evidence.contradictionContext = structuredClone(emptyCompetitionCounterevidence);
    if (!Object.hasOwn(role, "task")) {
      if (row.selectedTaskStepIndex !== 0) throw new Error("invalid_owner_review_rows");
      role.task = row.selectedTaskFocus;
    }
    if (Object.hasOwn(row, "provisionalSelectionMatches")) {
      if (row.provisionalSelectionMatches !== true || Object.hasOwn(row, "provisionalRankSelection")) throw new Error("invalid_owner_review_rows");
      delete row.provisionalSelectionMatches;
      row.provisionalRankSelection = rankSelection;
    }
  }
  return packet as T;
}

/** Share only exact values and column names in the versioned review wire.
 * The original preparation, evidence owners and response key map are separate. */
export function compactGroundedReviewEvidenceV7(value: unknown, ownerScoped = false): { packet: unknown; compacted: boolean } {
  if (!object(value) || value.reviewContract !== "grounded_future_bridge_v1"
      && (!ownerScoped || !isMatchingRelationReviewContract(value.reviewContract)) || !Array.isArray(value.assertions)
    || !Array.isArray(value.sharedCandidateBoundaries)) throw new Error("invalid_grounded_review_evidence_encoding");
  const source = ownerScoped ? compactOwnerReviewRowsV761(value) : value;
  const { sharedCandidateBoundaries, ...headers } = source;
  const encoded = compactMatchingTables(compactCandidateEvidence({ candidates: [{ sharedCandidateBoundaries }] }));
  if (!object(encoded)) throw new Error("invalid_grounded_review_evidence_encoding");
  const { candidates: evidenceBundle, ...metadata } = encoded;
  const packed = { ...headers, reviewEvidenceEncoding: groundedReviewEncoding, ...metadata, evidenceBundle };
  const compacted = Buffer.byteLength(JSON.stringify(packed), "utf8") + Buffer.byteLength(GROUNDED_REVIEW_EVIDENCE_ENCODING_PROMPT_V7, "utf8")
    < Buffer.byteLength(JSON.stringify(source), "utf8");
  const packet = compacted ? packed : source;
  if (!isDeepStrictEqual(expandGroundedReviewEvidenceV7(packet), value)) throw new Error("grounded_review_evidence_roundtrip_mismatch");
  return { packet, compacted };
}

type Boundary = AssertionReviewPacketV7["candidateBoundaries"][number];
type ItemEvidence = AssertionReviewPacketV7["assertionEvidence"][number]["competitionItems"][number];
export type JointReviewBindingV7 = {
  alias: string; keys: string[];
  reviewPurposes: ["recommendation_fit", "selected_role_action"];
  verdictSemantics: "conjunction_single_provider_verdict";
};
export type GroundedFutureBridgeReviewBindingV7 = {
  itemId: string;
  fullReason: DecisionClaimV6;
  bridge: string;
  explicitStudentGoal?: string;
  provisionalRankRelation?: string;
  selectedTaskFocus?: string;
  selectedTaskStepIndex?: number;
  connectedTaskPractice?: true;
  provisionalRankSelection?: { taskStepIndex: number; taskFocus: string; competitionFactId: string };
  learnerRelation?: LearnerRelationV759;
  learnerBasisSelection?: LearnerBasisSelectionV760;
  futureUseSelection?: FutureUseSelectionV764;
  taskRelation?: TaskRelationSelectionV766;
  taskConnection?: string;
};
export type OwnerBoundReviewKeyV759 = { itemId: string; ownerAlias: string; reviewAlias: string };
const sourceForReview = <T extends { evidenceArtifact?: string; verificationMethod?: string; retrievedAt?: string | null }>(value: T) => {
  const { evidenceArtifact: _artifact, verificationMethod: _method, retrievedAt: _retrieved, ...source } = structuredClone(value);
  return source;
};
function projectBoundary(boundary: Boundary, owners: ItemEvidence[]) {
  // Only remove a copy if the identical same-owner object remains directly
  // visible in EVERY assertion using this boundary, including comparisons.
  const boundaryFacts = boundary.boundaryFacts.filter(fact => !owners.length || !owners.every(item => [...item.citedFacts, ...item.contradictionContext.facts].some(other => isDeepStrictEqual(fact, other))));
  const sources = boundary.boundarySourceBindings.sources.filter(source => !owners.length || !owners.every(item => [...item.sources, ...item.contradictionContext.sourceBindings.sources].some(other => isDeepStrictEqual(source, other))));
  const editorialSectionBoundaries = boundary.editorialSectionBoundaries.map(value => {
    // Keep qualification/resource/negative/conditional wording. Plain optional
    // solution narratives cannot support a claim and invite solving the task.
    if (value.conditions.length || value.unknownReason || /\/(?:investment|eligibility|participation|difficulty)\//.test(value.path)
      || /资格|报名|截止|免费|费用|预算|支出|购买|设备|资源|实验室|队友|导师|许可|不能|不应|不得|并非|不是|未知|核实|条件/.test(value.text)) return structuredClone(value);
    const { text: _narrative, ...identityAndLimits } = value;
    return structuredClone(identityAndLimits);
  });
  return { ...structuredClone(boundary), editorialSectionBoundaries, boundaryFacts: structuredClone(boundaryFacts),
    boundarySourceBindings: { ...structuredClone(boundary.boundarySourceBindings), sources: sources.map(sourceForReview) } };
}

/** Put each claim beside its cited evidence and all necessary counterevidence.
 * Omit only exact visible duplicates, research tooling and optional narratives.
 * Short response keys are local to this request and never become stored IDs. */
export function directAssertionReviewPacketV7(value: unknown) {
  if (!object(value) || !Array.isArray(value.assertions) || !Array.isArray(value.assertionEvidence)
    || !Array.isArray(value.candidateBoundaries)) throw new Error("invalid_review_packet");
  const packet = value as AssertionReviewPacketV7;
  if (!packet.assertions.length || packet.assertions.length > 64
    || packet.assertionEvidence.length !== packet.assertions.length
    || new Set(packet.assertions.map(row => row.key)).size !== packet.assertions.length
    || new Set(packet.assertionEvidence.map(row => row.key)).size !== packet.assertionEvidence.length
    || new Set(packet.candidateBoundaries.map(row => row.itemId)).size !== packet.candidateBoundaries.length) throw new Error("invalid_review_packet");
  const usedBoundaries = new Set<string>();
  const boundaries = packet.candidateBoundaries.map(boundary => projectBoundary(boundary,
    packet.assertionEvidence.flatMap(row => row.competitionItems).filter(item => item.itemId === boundary.itemId)));
  const sharedBoundaryIds = new Map(boundaries.map((boundary, index) => [boundary.itemId, `B${index + 1}`]));
  const logicalRows = packet.assertions.map((assertion, index) => {
    const evidence = packet.assertionEvidence.find(row => row.key === assertion.key);
    if (!evidence || evidence.itemId !== assertion.itemId) throw new Error("invalid_review_packet");
    const { key: _key, itemId, competitionItems, ...ownEvidence } = evidence;
    const alias = `R${String(index + 1).padStart(2, "0")}`;
    return { key: alias, itemId, reviewPurpose: assertion.key === "comparison" ? "comparison" : ownEvidence.editorialRoleIdentity ? "selected_role_action" : "recommendation_fit", reason: structuredClone(assertion.reason), ...structuredClone(ownEvidence),
      competitionItems: competitionItems.map(item => {
        const boundary = boundaries.find(row => row.itemId === item.itemId);
        if (!boundary) throw new Error("invalid_review_packet");
        usedBoundaries.add(item.itemId);
        return { ...structuredClone(item), sources: item.sources.map(sourceForReview),
          contradictionContext: { ...structuredClone(item.contradictionContext), sourceBindings: { ...structuredClone(item.contradictionContext.sourceBindings), sources: item.contradictionContext.sourceBindings.sources.map(sourceForReview) } },
          candidateBoundaryId: sharedBoundaryIds.get(item.itemId)! };
      }) };
  });
  const fixedOrder = packet.fixedOrder as unknown as Record<string, unknown>;
  const jointAllowed = object(fixedOrder.groupReview) && (fixedOrder.groupReview.studentPresentation === "compact_action_reason_v2"
    || isMatchingRelationReviewContract(fixedOrder.groupReview.purpose));
  const consumed = new Set<number>(), logicalAliases = new Map<string, string>();
  const jointReviewBindings: JointReviewBindingV7[] = [];
  type WireRow = typeof logicalRows[number] & { reviewPurposes?: JointReviewBindingV7["reviewPurposes"] };
  const assertions: WireRow[] = [];
  const commonEvidence = (index: number) => {
    const evidence = packet.assertionEvidence.find(row => row.key === packet.assertions[index].key)!;
    const { key: _key, editorialRoleIdentity: _roleIdentity, ...common } = evidence;
    return common;
  };
  for (let index = 0; index < logicalRows.length; index += 1) {
    if (consumed.has(index)) continue;
    const original = packet.assertions[index], current = logicalRows[index];
    let whyIndex = -1, roleIndex = -1;
    if (jointAllowed && original.key !== "comparison" && /\.reason\.0$|\.role$/.test(original.key)) {
      const prefix = original.key.replace(/\.(?:reason\.0|role)$/, "");
      whyIndex = packet.assertions.findIndex((row, candidate) => !consumed.has(candidate) && row.itemId === original.itemId && row.key === `${prefix}.reason.0` && logicalRows[candidate].reviewPurpose === "recommendation_fit");
      roleIndex = packet.assertions.findIndex((row, candidate) => !consumed.has(candidate) && row.itemId === original.itemId && row.key === `${prefix}.role` && logicalRows[candidate].reviewPurpose === "selected_role_action");
      if (whyIndex < 0 || roleIndex < 0 || !isDeepStrictEqual(packet.assertions[whyIndex].reason, packet.assertions[roleIndex].reason)
        || !isDeepStrictEqual(commonEvidence(whyIndex), commonEvidence(roleIndex))) whyIndex = roleIndex = -1;
    }
    const alias = `R${String(assertions.length + 1).padStart(2, "0")}`;
    if (whyIndex >= 0 && roleIndex >= 0) {
      const keys = [whyIndex, roleIndex].sort((left, right) => left - right).map(value => packet.assertions[value].key);
      const reviewPurposes: JointReviewBindingV7["reviewPurposes"] = ["recommendation_fit", "selected_role_action"];
      assertions.push({ ...structuredClone(logicalRows[whyIndex]), key: alias,
        reviewPurpose: "joint_recommendation_fit_and_role_action", reviewPurposes: [...reviewPurposes],
        editorialRoleIdentity: structuredClone(logicalRows[roleIndex].editorialRoleIdentity!) });
      keys.forEach(key => logicalAliases.set(key, alias)); consumed.add(whyIndex); consumed.add(roleIndex);
      jointReviewBindings.push({ alias, keys, reviewPurposes, verdictSemantics: "conjunction_single_provider_verdict" });
    } else {
      assertions.push({ ...current, key: alias }); logicalAliases.set(original.key, alias); consumed.add(index);
    }
  }
  const reviewKeys = packet.assertions.map(row => ({ alias: logicalAliases.get(row.key)!, key: row.key }));
  const restorationKeys = structuredClone(reviewKeys), hasJointVerdicts = jointReviewBindings.length > 0;
  const keyMap = new Map<string, string[]>();
  for (const { alias, key } of reviewKeys) keyMap.set(alias, [...(keyMap.get(alias) ?? []), key]);
  // A selected item can have no synchronous-review claim. Keep its boundaries
  // too, without making them positive support for any other assertion.
  const additionalCandidateBoundaries = boundaries.filter(row => !usedBoundaries.has(row.itemId));
  return {
    reviewKeys: structuredClone(reviewKeys), jointReviewBindings: structuredClone(jointReviewBindings),
    packet: { profileRevision: packet.profileRevision, catalogVersion: packet.catalogVersion,
      profile: structuredClone(packet.profile), fixedOrder: structuredClone(packet.fixedOrder), assertions,
      ...(jointReviewBindings.length ? { jointReviewSemantics: "supported_requires_all_reviewPurposes_one_provider_verdict_not_independent_reviews" } : {}),
      sharedCandidateBoundaries: boundaries.filter(row => usedBoundaries.has(row.itemId)).map(row => ({ boundaryId: sharedBoundaryIds.get(row.itemId)!, itemId: row.itemId, boundary: structuredClone(row) })),
      ...(additionalCandidateBoundaries.length ? { additionalCandidateBoundaries: structuredClone(additionalCandidateBoundaries) } : {}) },
    restoreChecks(response: unknown): unknown {
      if (!object(response) || !Array.isArray(response.checks)) throw new Error("incomplete_support_review");
      const seen = new Set<string>();
      if (response.checks.length !== keyMap.size) throw new Error("incomplete_support_review");
      const byAlias = new Map<string, Record<string, unknown>>();
      const responseOrder: string[] = [];
      for (const row of response.checks) {
        if (!object(row) || typeof row.key !== "string" || !keyMap.has(row.key) || seen.has(row.key)) throw new Error("incomplete_support_review");
        seen.add(row.key); byAlias.set(row.key, row); responseOrder.push(row.key);
      }
      // One joint result is expanded to both logical obligations, with its
      // single provenance retained in jointReviewBindings and prepared calls.
      // A false result stays false for both; no second judgment is invented.
      const restoration = hasJointVerdicts ? restorationKeys
        : responseOrder.flatMap(alias => keyMap.get(alias)!.map(key => ({ alias, key })));
      const checks = restoration.map(({ alias, key }) => ({ ...byAlias.get(alias)!, key }));
      return { ...response, checks };
    },
  };
}

/** Accept an owner identifier only in a packet proven to have one exact joint
 * vote per owner. The raw provider object is kept separately by the caller. */
export function ownerBoundReviewKeysV759(transport: ReturnType<typeof directAssertionReviewPacketV7>,
  owners: readonly Pick<OwnerBoundReviewKeyV759, "itemId" | "ownerAlias">[]) {
  const fail = (): never => { throw new Error("invalid_review_owner_key_binding"); };
  const { assertions } = transport.packet;
  const byOwner = new Map(owners.map(owner => [owner.ownerAlias, owner]));
  const jointByAlias = new Map(transport.jointReviewBindings.map(joint => [joint.alias, joint]));
  if (!owners.length || owners.length !== assertions.length || byOwner.size !== owners.length
    || new Set(owners.map(owner => owner.itemId)).size !== owners.length || jointByAlias.size !== assertions.length
    || transport.jointReviewBindings.length !== assertions.length || transport.reviewKeys.length !== assertions.length * 2) fail();
  const bindings = assertions.map(row => {
    const owner = byOwner.get(row.itemId);
    const joint = jointByAlias.get(row.key);
    const logicalKeys = owner && [`${owner.itemId}.reason.0`, `${owner.itemId}.role`];
    if (!owner || !joint || row.reviewPurpose !== "joint_recommendation_fit_and_role_action"
      || joint.verdictSemantics !== "conjunction_single_provider_verdict"
      || !isDeepStrictEqual(joint.reviewPurposes, ["recommendation_fit", "selected_role_action"])
      || !isDeepStrictEqual(joint.keys, logicalKeys)
      || !isDeepStrictEqual(transport.reviewKeys.filter(entry => entry.alias === row.key).map(entry => entry.key), logicalKeys)) return fail();
    return { ...owner, reviewAlias: row.key };
  });
  const byIdentifier = ownerReviewAliasIndex(bindings);
  return {
    bindings,
    resolve: (response: unknown) => resolveOwnerReviewResponse(response, byIdentifier, bindings.length),
  };
}

function ownerReviewAliasIndex(bindings: readonly OwnerBoundReviewKeyV759[]): Map<string, string> {
  const byIdentifier = new Map<string, string>();
  for (const { itemId, ownerAlias, reviewAlias } of bindings) {
    for (const identity of new Set([itemId, ownerAlias, reviewAlias])) {
      if (typeof identity !== "string" || !identity || byIdentifier.has(identity)) throw new Error("invalid_review_owner_key_binding");
      byIdentifier.set(identity, reviewAlias);
    }
  }
  return byIdentifier;
}

function resolveOwnerReviewResponse(response: unknown, byIdentifier: ReadonlyMap<string, string>, ownerCount: number) {
  if (!object(response) || !Array.isArray(response.checks) || response.checks.length !== ownerCount) {
    throw new Error("incomplete_support_review");
  }
  const seen = new Set<string>(), resolutions: { originalKey: string; reviewKey: string }[] = [];
  const checks = response.checks.map(row => {
    const originalKey = object(row) && typeof row.key === "string" ? row.key : undefined;
    const reviewKey = originalKey && byIdentifier.get(originalKey);
    if (!originalKey || !reviewKey || seen.has(reviewKey)) throw new Error("incomplete_support_review");
    seen.add(reviewKey);
    if (originalKey !== reviewKey) resolutions.push({ originalKey, reviewKey });
    return { ...row, key: reviewKey };
  });
  return { value: { ...response, checks }, resolutions };
}

/** Retain the provider's four axes. Compatibility checks are derived only
 * after complete, unambiguous owner coverage has been verified. */
export function matchingRelationLogicalChecksV765({ ballots, ownerKeys }: Pick<MatchingRelationReviewV765, "ballots" | "ownerKeys">) {
  const raw = matchingRelationReviewSchemaV765.parse({ checks: ballots });
  const { value, resolutions } = resolveOwnerReviewResponse(raw, ownerReviewAliasIndex(ownerKeys), ownerKeys.length);
  const normalized = matchingRelationReviewSchemaV765.parse(value).checks;
  const byKey = new Map(normalized.map(row => [row.key, row]));
  const checks = ownerKeys.flatMap(({ itemId, reviewAlias }) => {
    const row = byKey.get(reviewAlias);
    if (!row) throw new Error("incomplete_support_review");
    const { fit, source, learnerAttribution, conditions, reason } = row;
    const supported = fit && source && learnerAttribution && conditions;
    return [`${itemId}.reason.0`, `${itemId}.role`].map(key => ({ key, supported, reason }));
  });
  return { checks, resolutions };
}

/** Apply only after the original full reason and its exact assembled prefix
 * have been checked. The ordinary transport still owns the two logical keys. */
export function groundedFutureBridgeReviewPacketV7(
  transport: ReturnType<typeof directAssertionReviewPacketV7>,
  bindings: readonly GroundedFutureBridgeReviewBindingV7[],
  relationContract?: MatchingRelationReviewContractV7,
) {
  const wire = transport.packet;
  const byOwner = new Map(bindings.map(binding => [binding.itemId, binding]));
  const boundaries = new Map(wire.sharedCandidateBoundaries.map(row => [row.itemId, row]));
  const jointByAlias = new Map(transport.jointReviewBindings.map(binding => [binding.alias, binding]));
  const rankBound = bindings.some(binding => binding.selectedTaskFocus !== undefined);
  const matchingRelation = relationContract !== undefined;
  const taskRelation = relationContract === MATCHING_RELATION_REVIEW_CONTRACT_V766;
  const taskConnection = relationContract === MATCHING_RELATION_REVIEW_CONTRACT_V767;
  const fail = (): never => { throw new Error("invalid_grounded_future_bridge_review"); };
  const groupReview: unknown = Reflect.get(wire.fixedOrder, "groupReview");
  if (!object(groupReview) || (matchingRelation ? groupReview.purpose !== relationContract
    : groupReview.reasonAssembly !== "grounded_optional_bridge_v1")
    || wire.additionalCandidateBoundaries || !bindings.length || byOwner.size !== bindings.length
    || boundaries.size !== bindings.length || wire.assertions.length !== bindings.length
    || jointByAlias.size !== bindings.length || transport.reviewKeys.length !== bindings.length * 2) fail();
  const assertions = wire.assertions.map(row => {
    const binding = byOwner.get(row.itemId);
    const ownItem = row.competitionItems[0], boundary = boundaries.get(row.itemId);
    const joint = jointByAlias.get(row.key);
    if (!binding || !boundary || joint?.keys.length !== 2 || row.reviewPurpose !== "joint_recommendation_fit_and_role_action"
      || row.allowedItemIds.length !== 1 || row.allowedItemIds[0] !== row.itemId
      || row.competitionItems.length !== 1 || ownItem?.itemId !== row.itemId || ownItem.candidateBoundaryId !== boundary.boundaryId
      || ownItem.citedFacts.length !== 1 || !row.editorialRoleIdentity
      || row.reason.conditions.length || !isDeepStrictEqual(row.reason, binding.fullReason)) return fail();
    const selectedBasis = binding.learnerBasisSelection;
    const selectedFact = selectedBasis?.kind === "student_fact" ? row.citedStudentFacts[selectedBasis.index] : undefined;
    if (selectedBasis && (binding.learnerRelation || !binding.connectedTaskPractice
      || (selectedBasis.kind === "goal" ? selectedBasis.index !== 0 || !binding.explicitStudentGoal
        : !selectedFact || selectedFact.id !== row.reason.studentFactIds[selectedBasis.index]))) return fail();
    if (taskRelation !== (binding.taskRelation !== undefined) || taskConnection !== (binding.taskConnection !== undefined)
      || (taskRelation || taskConnection) && binding.futureUseSelection
      || matchingRelation && (!selectedBasis || !taskRelation && !taskConnection && !binding.futureUseSelection)) return fail();
    if (rankBound) {
      const focus = binding.selectedTaskFocus;
      const originalRole: unknown = Reflect.get(boundary.boundary, "selectedRoleOriginal");
      const prefix = `\n${binding.futureUseSelection || taskRelation || taskConnection ? MATCHING_RELATION_LABEL_V764 : GROUNDED_PRACTICE_LABEL_V7}：`;
      const practiceOffset = binding.fullReason.text.lastIndexOf(prefix);
      if (!focus || !object(originalRole) || typeof originalRole.task !== "string" || practiceOffset < 0) return fail();
      const steps = rankTaskFocusOptionsV7(originalRole.task);
      if (binding.connectedTaskPractice) {
        const original = binding.provisionalRankSelection;
        if (steps.find(step => step.index === binding.selectedTaskStepIndex)?.text !== focus
          || Boolean(original) !== (binding.provisionalRankRelation !== undefined)
          || original && (!original.competitionFactId || steps.find(step => step.index === original.taskStepIndex)?.text !== original.taskFocus
            || original.taskStepIndex !== 0 && original.taskStepIndex !== binding.selectedTaskStepIndex)) return fail();
      } else if (binding.provisionalRankRelation !== undefined || binding.provisionalRankSelection !== undefined
        || binding.selectedTaskStepIndex !== undefined || binding.learnerRelation !== undefined || !steps.some(option => option.text === focus)) return fail();
      const displayed = binding.fullReason.text.slice(practiceOffset + prefix.length);
      const actual = taskConnection ? readTaskConnectionV767(displayed, binding)
        : binding.taskRelation ? readTaskRelationV766(displayed, binding) : binding.futureUseSelection ? (matchingRelation
        ? readMatchingRelationV765(displayed, binding) : readMatchingRelationV764(focus, displayed, binding))
        : binding.connectedTaskPractice ? readSealedTaskPracticeReviewV7(focus, displayed, binding)
          : readRankBoundTaskPracticeBridgeV7(focus, displayed);
      if (actual !== binding.bridge) return fail();
    }
    const statement = binding.futureUseSelection;
    const condition = binding.taskRelation?.mode === "apply" ? binding.taskRelation.prerequisite : statement?.prerequisite;
    const checkedReason = matchingRelation ? { ...row.reason, text: statement?.futureUse ?? binding.bridge,
      studentFactIds: selectedFact ? [selectedFact.id] : [] } : { ...row.reason, text: binding.bridge };
    return { ...row, reason: checkedReason,
      ...(matchingRelation ? { citedStudentFacts: selectedFact ? [selectedFact] : [] } : {}),
      ...(binding.taskRelation ? { relationMode: binding.taskRelation.mode } : {}),
      ...(matchingRelation && condition !== undefined ? { actionPrerequisite: condition } : {}),
      ...(binding.explicitStudentGoal !== undefined && (!matchingRelation || selectedBasis?.kind === "goal")
        ? { explicitStudentGoal: binding.explicitStudentGoal } : {}),
      ...(!matchingRelation && binding.provisionalRankRelation !== undefined ? { provisionalRankRelation: binding.provisionalRankRelation } : {}),
      ...(!matchingRelation && binding.provisionalRankSelection !== undefined ? { provisionalRankSelection: binding.provisionalRankSelection } : {}),
      ...(binding.learnerRelation === undefined ? {} : { learnerRelation: binding.learnerRelation }),
      ...(selectedBasis === undefined ? {} : { learnerBasisSelection: { ...selectedBasis,
        ...(selectedFact ? { studentFactId: selectedFact.id } : {}) } }),
      ...(binding.selectedTaskStepIndex === undefined ? {} : { selectedTaskStepIndex: binding.selectedTaskStepIndex }),
      ...(binding.selectedTaskFocus === undefined ? {} : { selectedTaskFocus: binding.selectedTaskFocus }) };
  });
  if (new Set(assertions.map(row => row.itemId)).size !== bindings.length) fail();
  const sharedCandidateBoundaries = wire.sharedCandidateBoundaries.map(row => {
    const { currentRole, nextStep, ...display } = row.boundary.displayedRecommendation;
    const fullReason = byOwner.get(row.itemId)?.fullReason;
    const sameRole = isDeepStrictEqual(currentRole, fullReason), sameStep = isDeepStrictEqual(nextStep, fullReason);
    const reviewedClaimFields = [...(sameRole ? ["currentRole"] : []), ...(sameStep ? ["nextStep"] : [])];
    const { checkpoint, ...otherDisplay } = display;
    const role = Reflect.get(row.boundary, "selectedRoleOriginal");
    const duplicateCheckpoint = matchingRelation && object(role) && checkpoint === role.personalDeliverable;
    return { ...row, boundary: { ...row.boundary, displayedRecommendation: {
      ...(duplicateCheckpoint ? otherDisplay : display), ...(sameRole ? {} : { currentRole }), ...(sameStep ? {} : { nextStep }),
      ...(!matchingRelation && reviewedClaimFields.length ? { reviewedClaimFields } : {}),
    } } };
  });
  // Point to the unchanged profile facts. A limit can constrain an optional
  // action without becoming positive evidence for the student's fit.
  const currentStudentConstraintFactIds = wire.profile.facts.filter(fact =>
    fact.confirmed && fact.state === "affirmed" && !wire.profile.retractedFactIds.includes(fact.id)
    && /^(?:constraints|budget)(?:[.:]|$)/u.test(fact.field)).map(fact => fact.id);
  return { ...wire, reviewContract: relationContract ?? "grounded_future_bridge_v1", assertions, sharedCandidateBoundaries,
    ...(currentStudentConstraintFactIds.length ? { currentStudentConstraintFactIds } : {}) };
}
