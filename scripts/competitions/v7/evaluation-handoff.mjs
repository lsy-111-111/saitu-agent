import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POLICY_VERSION, POLICY_SHA256, CASE_QUOTAS, canonicalHash, byteHash, assertQuotas, assertRankingGroups, writeNewJson, parseFileCli } from "./evaluation-policy.mjs";

/** Identity/provenance export only: student inputs, answers and ranking judgments are not exported. */
export function buildHandoffMetadata({ inventory, profiles, oldMembership, currentMembership, references }) {
  assertQuotas(inventory.cases); assertRankingGroups(profiles);
  const byCase = new Map(inventory.cases.map(row => [row.caseId, row]));
  const profileMetadata = profiles.map(row => {
    const original = byCase.get(row.caseId), inputSha256 = canonicalHash(row.input);
    if (original?.layer !== "ranking" || original.inputSha256 !== inputSha256 || row.originalInputCanonicalSha256 !== inputSha256) throw new Error("original_120_input_identity_or_hash_changed");
    return { caseId: row.caseId, profileId: row.profileId, familyId: row.familyId, taskGroup: row.taskGroup, inputSha256,
      originalProfileSha256: canonicalHash(row.profile), originalInputBytesValidated: true,
      applicability: "pending_fresh_v7_input_review", labelsInheritedAsV7: false };
  });
  const old = new Map(oldMembership.map(row => [row.itemId, row])), current = new Map(currentMembership.map(row => [row.itemId, row]));
  const common = currentMembership.filter(row => old.has(row.itemId)).map(row => ({ itemId: row.itemId, seriesId: row.seriesId,
    oldContentDigest: old.get(row.itemId).contentDigest, currentContentDigest: row.contentDigest, currentCoreDigest: row.coreDigest,
    exactContentUnchanged: row.contentDigest === old.get(row.itemId).contentDigest,
    semanticApplicability: "pending_independent_v7_policy_review", oldGradeAutomaticallyReusable: false }));
  const added = currentMembership.filter(row => !old.has(row.itemId)), removed = oldMembership.filter(row => !current.has(row.itemId));
  return { schemaVersion: "saitu.evaluation-handoff-metadata.v7.1", policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256,
    observedAt: new Date().toISOString(), references, caseQuotas: CASE_QUOTAS, publicCaseCount: 800, profileCount: 120, profileMetadata,
    poolDifference: { oldRecords: oldMembership.length, oldSeries: new Set(oldMembership.map(row => row.seriesId)).size,
      currentCoreRecords: currentMembership.length, currentCoreSeries: new Set(currentMembership.map(row => row.seriesId)).size,
      common, added, removed, exactContentUnchanged: common.filter(row => row.exactContentUnchanged).length,
      wholePoolUnchanged: added.length === 0 && removed.length === 0 && common.every(row => row.exactContentUnchanged) },
    annotationReuse: { mechanicalEligibility: ["identical original input canonical hash", "same candidate item/series identity", "unchanged candidate content and source snapshot",
      "same complete candidate pool", "same rubric/policy scope", "new independent applicability reviewer approves exact frozen v7 source/runtime"],
      sufficientByHashAlone: false, oldRankingLabelsMayBeCopiedWithoutReview: false,
      rankingFamiliesRequiringCurrentFullPoolBlindReview: 120, ordinaryCasesRequiringApplicabilityReview: 680 },
    rewriteCounts: { determined: false, byLayer: Object.fromEntries(Object.keys(CASE_QUOTAS).map(layer => [layer, null])),
      applicabilityPendingByLayer: CASE_QUOTAS, reason: "The public status inventory contains no question semantics. A fresh input-only reviewer must decide retained vs same-layer replacement; guessing exact rewrite counts from old labels is forbidden." },
    remainingAnnotation: { ordinaryIndependentApplicabilityCases: 680, rankingIndependentApplicabilityCases: 120, rankingBlindOriginals: 2,
      rankingFamiliesPerOriginal: 120, rankingPairsPerOriginalUpperBound: currentMembership.length * 120,
      profileExhaustiveGoldCases: 120, originalProfileReferenceUnresolved: 19, originalConversationSemanticUnresolved: 1, originalRuntimeApplicabilityCells: 8,
      originalPreparationStatesAreNotV7Acceptance: true },
    originalAnswersRead: false, originalRankingLabelsRead: false, modelCalls: 0, paidCalls: 0, formalExecutions: { cases: 0, rankingReports: 0 }, productAcceptance: false };
}
async function main() {
  const options = parseFileCli(process.argv.slice(2), ["--inventory", "--profile-inputs", "--old-membership", "--output"]);
  const [inventoryBytes, profileBytes, membershipBytes] = await Promise.all([readFile(options["--inventory"]), readFile(options["--profile-inputs"]), readFile(options["--old-membership"])]);
  const inventory = JSON.parse(inventoryBytes), profiles = profileBytes.toString("utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
  const { installSourceLoader } = await import("../../lib/load-typescript-source.mjs"); installSourceLoader();
  const [{ getMatchingCatalogRecords, matchingCoreDigest }, { catalogContentDigest }] = await Promise.all([
    import("../../../src/lib/competitions/v7/catalog.ts"), import("../../../src/lib/competitions/v6/catalog-review.ts"),
  ]);
  const currentMembership = getMatchingCatalogRecords().map(record => ({ itemId: record.recordId, seriesId: record.seriesId, contentDigest: catalogContentDigest(record), coreDigest: matchingCoreDigest(record) }));
  const metadata = buildHandoffMetadata({ inventory, profiles, oldMembership: JSON.parse(membershipBytes), currentMembership,
    references: { public800: { path: options["--inventory"], sha256: byteHash(inventoryBytes) }, inputOnly120: { path: options["--profile-inputs"], sha256: byteHash(profileBytes), containsAnswers: false },
      oldPublicMembership: { path: options["--old-membership"], sha256: byteHash(membershipBytes), containsAnswers: false },
      inputOnly800: { path: "artifacts/v6/sealed-ai-20261105/author-revised-private/cases.jsonl", access: "fresh_migration_author_inputs_only_no_answer_keys" },
      originalSafeStatus: { path: "artifacts/specialist-20261106/case-status/status-800-current.summary.json", access: "public_summary" } } });
  await writeNewJson(options["--output"], metadata);
  console.log(JSON.stringify({ output: options["--output"], profiles: 120, oldRecords: metadata.poolDifference.oldRecords,
    currentCoreRecords: metadata.poolDifference.currentCoreRecords, currentCoreSeries: metadata.poolDifference.currentCoreSeries,
    added: metadata.poolDifference.added.length, removed: metadata.poolDifference.removed.length, unchangedContent: metadata.poolDifference.exactContentUnchanged, labelsRead: false }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
