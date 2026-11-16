import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { evaluationFixture } from "./evaluation.fixture";
import { POLICY_VERSION, POLICY_SHA256, EVALUATION_POLICY, canonicalHash, byteHash } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { buildRankingPanelPlan, assignRankingPanelAuthors, rankingPanelProfilePoolSha256, verifyRankingPanelMetadata, RANKING_PANEL_RULES } from "../../../scripts/competitions/v7/evaluation-ranking-panels.mjs";

/** Entirely invented material. Actual temporary files exercise the real reader;
 * this helper never reads a repository artifact, real answer, judge or provider. */
export async function rankingPanelsFixture(options: { root?: string; manifest?: any; config?: any; mode?: "high" | "low" | "constant"; adjudication?: boolean } = {}) {
  const base = evaluationFixture(), root = options.root ?? await mkdtemp(path.join(os.tmpdir(), "saitu-panel-unit-"));
  const policy = { policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256 }, mode = options.mode ?? "high";
  const manifest = options.manifest ?? structuredClone({ ...base.manifest, openedAt: null }), config = options.config ?? structuredClone(base.registration.config);
  const t = { frozen: "2026-11-09T00:00:00Z", issued: "2026-11-09T00:00:01Z", packet: "2026-11-09T00:00:02Z", opened: "2026-11-09T00:00:03Z", sealed: "2026-11-09T00:00:04Z", collected: "2026-11-09T00:00:05Z", adjudicatedOpened: "2026-11-09T00:00:06Z", adjudicatedSealed: "2026-11-09T00:00:07Z", registered: "2026-11-09T00:01:00Z" };
  async function put(member: string, value: unknown) {
    const filename = path.join(root, member), bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes);
    return { path: member, rawSha256: byteHash(bytes), canonicalSha256: canonicalHash(value) };
  }
  const inputs = new Map(base.matrix.profileSnapshot.profiles.map((row: any) => [row.profileId, row.input]));
  const candidates = Array.from({ length: 45 }, (_, i) => ({ itemId: `fictional-item-${String(i).padStart(2, "0")}`, seriesId: `fictional-series-${i}` }));
  const candidateEvidence = candidates.map(row => ({ ...row, facts: [{ factId: `fictional-fact-${row.itemId}`, value: "invented official evidence", sourceId: "fictional-source" }] }));
  const metadata = { profiles: base.matrix.profileSnapshot.profiles.map((row: any) => ({ profileId: row.profileId, caseId: row.caseId, familyId: row.familyId, taskGroup: row.taskGroup, inputSha256: canonicalHash(row.input) })), candidates,
    binding: { catalogSha256: manifest.catalogSha256, candidateEvidenceSha256: canonicalHash(candidateEvidence), sourceSnapshotSha256: manifest.rankingSourceSnapshotSha256,
      rubricSha256: canonicalHash("fictional-rubric"), inputAdaptorSha256: canonicalHash("fictional-adapter"), decisionEvidenceFilterSha256: canonicalHash("fictional-filter") } };
  const planOptions = { roundId: "fictional-round", seed: 20261109, frozenAt: t.frozen, coordinators: ["fictional-coordinator-a", "fictional-coordinator-b"], blockedAuthorContextIds: ["implementer", "case-author", "prior-reviewer"] };
  const plan = buildRankingPanelPlan(metadata, planOptions), assignments = assignRankingPanelAuthors(plan, Array.from({ length: 48 }, (_, i) => `fictional-fresh-author-${i}`));
  const pools = plan.profiles.map(row => ({ profileId: row.profileId, familyId: row.familyId, taskGroup: row.taskGroup, poolItemIds: candidates.map(item => item.itemId), judgments: candidates.map(item => ({ ...item, relevance: "U" as const })) }));
  const assignmentFile = { schemaVersion: "saitu.ranking-shard-assignments.v7.2", ...policy, evidenceClass: "ai_proxy", roundId: plan.roundId, partitionSha256: plan.partitionSha256, inputMetadataSha256: plan.inputMetadataSha256, issuedAt: t.issued, assignments };
  const collection: any = { schemaVersion: "saitu.ranking-shard-sealed-collection.v7.2", ...policy, evidenceClass: "ai_proxy", roundId: plan.roundId, partitionSha256: plan.partitionSha256, assignmentsSha256: canonicalHash(assignments), collectedAt: t.collected, originals: [] };
  const rawRows: any[] = [];
  for (const assignment of assignments) {
    const packet = { schemaVersion: "saitu.ranking-shard-source-packet.v7.2", ...policy, evidenceClass: "ai_proxy", roundId: plan.roundId, panelId: assignment.panelId, shardId: assignment.shardId, assignedAuthorContextId: assignment.authorContextId,
      createdAt: t.packet, partitionSha256: plan.partitionSha256, inputMetadataSha256: plan.inputMetadataSha256, binding: plan.binding, profileIds: assignment.profileIds,
      profiles: assignment.profileIds.map(profileId => ({ ...plan.profiles.find(row => row.profileId === profileId), input: inputs.get(profileId) })),
      candidateRegistry: candidateEvidence, candidateOrder: candidates.map(row => row.itemId), rubric: { rubricSha256: plan.binding.rubricSha256, allowedGrades: [0, 1, 2, 3, "U"], full45Required: true, unknownIsNotZero: true }, authorModel: "gpt-6.1-sol", authorEffort: "max", labelsIncluded: false, productOutputsIncluded: false };
    const sourcePacket = await put(assignment.expectedPacketPath, packet);
    const raw = { schemaVersion: "saitu.ranking-shard-original.v7.2", ...policy, evidenceClass: "ai_proxy", roundId: plan.roundId, panelId: assignment.panelId, shardId: assignment.shardId, authorContextId: assignment.authorContextId,
      authorModel: "gpt-6.1-sol", authorEffort: "max", status: "sealed", blindState: { blindToAlgorithms: true, productOutputsRead: false, oldJudgmentsRead: false, otherPanelJudgmentsRead: false, priorSameProfileJudgmentsRead: false, freshContext: true, coordinatorGeneratedGrades: false },
      sourcePacket, partitionSha256: plan.partitionSha256, openedAt: t.opened, sealedAt: t.sealed,
      profiles: assignment.profileIds.map(profileId => ({ profileId, poolItemIds: candidates.map(row => row.itemId), judgments: candidates.map((item, j) => {
        const i = plan.profiles.findIndex(row => row.profileId === profileId); let relevance: number | "U" = (i + j) % 4;
        if (mode === "constant") relevance = 0;
        if (mode === "low" && assignment.panelId === "panel_b") relevance = 3 - (relevance as number);
        if (mode === "high" && i === 0 && j === 0) relevance = "U";
        if (mode === "high" && i === 1 && j === 1 && assignment.panelId === "panel_b") relevance = 3;
        return { itemId: item.itemId, relevance, reason: "invented original author judgment" };
      }) })) };
    const original = await put(assignment.expectedRawPath, raw); rawRows.push(raw);
    collection.originals.push({ panelId: assignment.panelId, shardId: assignment.shardId, authorContextId: assignment.authorContextId, sourcePacket, original, openedAt: t.opened, sealedAt: t.sealed, blindState: raw.blindState });
  }
  const contract: any = { schemaVersion: "saitu.ranking-panels-contract.v7.2", ...policy, roundId: plan.roundId, frozenAt: t.frozen,
    publicPlan: await put(`ranking-panel-metadata/${plan.roundId}/plan.json`, plan), publicAssignments: await put(`ranking-panel-metadata/${plan.roundId}/assignments.json`, assignmentFile), sealedCollection: await put(`ranking-panel-metadata/${plan.roundId}/sealed-collection.json`, collection), adjudication: null,
    catalogSha256: manifest.catalogSha256, rankingSourceSnapshotSha256: manifest.rankingSourceSnapshotSha256, profilePoolSha256: rankingPanelProfilePoolSha256(pools), inputMetadataSha256: plan.inputMetadataSha256, partitionSha256: plan.partitionSha256, rules: RANKING_PANEL_RULES };
  async function putAdjudication(mutate?: (value: any) => void) {
    const resolutions: any[] = [];
    for (const pool of pools) for (const item of pool.judgments) {
      const judgments = ["panel_a", "panel_b"].map(panel => rawRows.find(raw => raw.panelId === panel && raw.profiles.some((row: any) => row.profileId === pool.profileId)).profiles.find((row: any) => row.profileId === pool.profileId).judgments.find((row: any) => row.itemId === item.itemId));
      if (judgments.some(row => row.relevance === "U") || judgments[0].relevance !== judgments[1].relevance) resolutions.push({ profileId: pool.profileId, itemId: item.itemId, relevance: 2, reason: "invented independent third judgment", originalJudgmentSha256: judgments.map(canonicalHash) });
    }
    const value = { schemaVersion: "saitu.ranking-panel-adjudication.v7.2", ...policy, evidenceClass: "ai_proxy", contextId: "fictional-fresh-third", openedAt: t.adjudicatedOpened, sealedAt: t.adjudicatedSealed,
      blindToAlgorithms: true, productOutputsRead: false, resolvesCollection: contract.sealedCollection, partitionSha256: plan.partitionSha256, resolutions };
    mutate?.(value); contract.adjudication = await put(`ranking-panels/${plan.roundId}/adjudication.json`, value); return value;
  }
  if (options.adjudication) await putAdjudication();
  config.rankingReviewContract = contract;
  const args = () => ({ evidenceRoot: root, config, manifest, migration: base.migration, registeredAt: t.registered, contract });
  const updateCollection = async () => { contract.sealedCollection = await put(contract.sealedCollection.path, collection); };
  async function mutateOriginal(index: number, mutate: (value: any) => void) {
    const descriptor = collection.originals[index], raw = JSON.parse(await readFile(path.join(root, descriptor.original.path), "utf8")); mutate(raw);
    descriptor.original = await put(descriptor.original.path, raw); await updateCollection(); return raw;
  }
  async function mutatePacket(index: number, mutate: (value: any) => void) {
    const descriptor = collection.originals[index], packet = JSON.parse(await readFile(path.join(root, descriptor.sourcePacket.path), "utf8")); mutate(packet);
    descriptor.sourcePacket = await put(descriptor.sourcePacket.path, packet);
    await mutateOriginal(index, raw => { raw.sourcePacket = descriptor.sourcePacket; }); return packet;
  }
  return { root, base, config, manifest, plan, metadata, planOptions, assignments, assignmentFile, collection, contract, pools, t, args, put, putAdjudication, updateCollection, mutateOriginal, mutatePacket, dispose: () => options.root ? Promise.resolve() : rm(root, { recursive: true, force: true }) };
}

/** Adds only invented 680 originals/receipts to a temporary panel fixture. With
 * a complete public fixture supplied, the real public guard remains in force. */
export async function syntheticPanelScoringInputs(f: Awaited<ReturnType<typeof rankingPanelsFixture>>, options: { migration?: any; legacy?: boolean } = {}) {
  const policy = { policyVersion: POLICY_VERSION, policySha256: POLICY_SHA256 }, base = f.base, config = f.config, migration = options.migration ?? base.migration;
  const std = async (member: string, value: unknown) => { const ref = await f.put(member, value); return { path: ref.path, sha256: ref.rawSha256 }; };
  if (!config.challengeManifest) { config.challengeManifest = await std("synthetic-product-public-challenge.json", f.manifest); config.challengeManifestSha256 = config.challengeManifest.sha256; }
  if (!config.migration) { config.migration = await std("synthetic-product-public-migration.json", migration); config.migrationSha256 = config.migration.sha256; }
  const producer = { path: "scripts/competitions/v7/evaluation-executor.mjs", sha256: canonicalHash("synthetic-unit-producer") };
  const matrix = structuredClone(base.matrix); if (!options.legacy) matrix.rankings.profiles = f.pools;
  const openedAt = "2026-11-09T00:03:00Z", binding = matrix.freezeBinding;
  const approval = await std("synthetic-product-approval.json", { syntheticApprovalBytes: true });
  const scope = { grantVersion: "saitu.v7.top5.v1", runId: "synthetic-formal", phase: "formal", authorizedPhase: "formal", authorizedEffort: "stage", effortPolicy: EVALUATION_POLICY.runtime.effortPolicy, effortPolicySha256: EVALUATION_POLICY.runtime.effortPolicySha256, authorizationPolicySha256: approval.sha256,
    environmentAuthorizationPolicySha256: approval.sha256, authorizationPolicySnapshot: approval, evaluationPolicySha256: POLICY_SHA256, executionRuntimeConfigurationSha256: canonicalHash("synthetic-execution-runtime"), callLimit: 1, fundingLimitCny: 1 };
  const nonranking = base.bundle.observations.filter((row: any) => row.algorithm !== "C");
  const receipts = nonranking.map((row: any) => ({ schemaVersion: "saitu.product-execution-receipt.v7.1", invocationId: row.invocationId, observationSha256: canonicalHash(row), inputSha256: row.inputSha256,
    producerSha256: producer.sha256, freezeBinding: binding, executionRuntimeConfigurationSha256: scope.executionRuntimeConfigurationSha256, executionScope: scope, events: row.events, ledgerRows: [] }));
  const execution = { schemaVersion: "saitu.product-execution-manifest.v7.1", ...policy, originalNonrankingSlots: 680, ...(config.productInputSha256 ? { productInputSha256: config.productInputSha256 } : {}), producer, freezeBinding: binding, openedAt,
    originalAttempts: [await std("synthetic-product-attempt.json", { synthetic: true })], observations: await std("synthetic-product-observations.json", nonranking), receipts: await std("synthetic-product-receipts.json", receipts), executionScopes: [scope] };
  const original: any = { schemaVersion: "saitu.product-originals.v7.1", ...policy, freezeBinding: binding, openedAt, producer, executionManifest: await std("synthetic-product-execution.json", execution) };
  for (const key of ["cases", "keys", "reviews", "sources"]) original[key] = await std(`synthetic-product-${key}.json`, base.bundle[key]);
  const productOriginals = await std("synthetic-product-product-originals.json", original);
  const bundle = { ...base.bundle, manifest: { ...f.manifest, openedAt }, migration, productOriginals,
    rankingGold: options.legacy ? base.gold : { schemaVersion: "saitu.ranking-gold.v7.2", ...policy, reviewContract: f.contract } };
  if (options.legacy) delete config.rankingReviewContract;
  const registration: any = { registeredAt: f.t.registered, config, implementation: [producer] };
  if (!options.legacy) registration.rankingPanelMetadataVerification = await verifyRankingPanelMetadata(f.args());
  return { bundle, ranking: { registration, matrix, freezeManifestSha256: canonicalHash("synthetic-matrix-freeze") }, producer };
}
