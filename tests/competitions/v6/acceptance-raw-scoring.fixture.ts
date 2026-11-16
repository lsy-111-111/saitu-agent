import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { acceptanceCanonicalHash as hash } from "../../../scripts/competitions/v6/acceptance-artifact-derivation";
import { CASE_QUOTAS, ACCEPTANCE_TASK_GROUPS, type AcceptanceInput } from "../../../scripts/competitions/v6/acceptance-gate";
import { semanticRulePointers, type ScoringKey } from "../../../scripts/competitions/v6/score-product-observations";
const { deriveRunSeed, seededShuffle } = createRequire(import.meta.url)("../../../scripts/competitions/v6/frozen-ranking-executor.mjs") as {
  deriveRunSeed(seed: number, id: string, repetition: number): number; seededShuffle<T>(rows: T[], seed: number): T[];
};
type Row = Record<string, unknown>;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
/** LOCAL SYNTHETIC CONTRACT FIXTURE ONLY. No collected cases/reviews/provider
 * events and no private challenge material. It must remain pending in the gate. */
export function rawScoringFixture(root: string, implementationOverride?: { path: string; sha256: string }[], rankingMetrics?: { protocol: unknown; registeredAt: string; openedAt: string; startedAt: string }) {
  const write = (name: string, value: unknown, jsonl = false) => {
    const bytes = jsonl ? (value as unknown[]).map(row => JSON.stringify(row)).join("\n") + "\n" : JSON.stringify(value);
    writeFileSync(path.join(root, name), bytes); return { path: name, sha256: sha(bytes) };
  };
  const sourceBody = "PUBLIC SYNTHETIC SOURCE: this is a local contract test, not a collected source.";
  writeFileSync(path.join(root, "synthetic.body.txt"), sourceBody);
  writeFileSync(path.join(root, "synthetic.source.txt"), sourceBody);
  writeFileSync(path.join(root, "synthetic-implementation.ts"), "export const synthetic = true;\n");
  const implementation = implementationOverride ?? [{ path: "synthetic-implementation.ts", sha256: sha("export const synthetic = true;\n") }];
  const sourceIndex = { schemaVersion: "saitu.sealed-source-index.v2", sources: [{ sourceId: "synthetic-source", scope: "synthetic", sourceArtifact: "synthetic.source.txt", sourceByteSha256: sha(sourceBody), bodyArtifact: "synthetic.body.txt", bodySha256: sha(sourceBody) }] };
  const sourceRef = write("sources.json", sourceIndex);
  const runtimeKeys = ["AI_PROVIDER", "AI_MODEL", "AI_COMPETITION_NORMALIZE_MODEL", "AI_COMPETITION_RECOMMEND_MODEL", "AI_TIMEOUT_MS", "AI_REQUEST_DEADLINE_MS", "AI_RETRY_MAX_DELAY_MS", "AI_TEST_MODE", "ALLOW_AI_MOCK", "AI_SPEND_RUN_ID", "AI_SPEND_PHASE", "AI_SPEND_FUNDED_CNY", "AI_SPEND_LIMIT_CNY", "AI_BUDGET_TIMEZONE", "AI_REASONING_EFFORT", "SAITU_DECISION_STRATEGY", "SAITU_CATALOG_SNAPSHOT_PATH", "SAITU_FROZEN_EVIDENCE_INDEX", "SAITU_FROZEN_EVIDENCE_INDEX_SHA256", "SAITU_FROZEN_EVIDENCE_ROOT", "NODE_ENV", "AI_API_URL"];
  const runtime = { schemaVersion: "saitu.runtime-configuration.v1", values: { ...Object.fromEntries(runtimeKeys.map(key => [key, null])), NODE_ENV: "production", AI_PROVIDER: "deepseek", AI_SPEND_PHASE: "formal" } };
  const runtimeHash = hash(runtime), seed = 6141, asOf = "2026-11-05T12:00:00Z";
  const operations = { hard_constraints: "qualify", factual: "fact_check", ranking: "recommend", profile: "extract_profile", conversation: "conversation", robustness: "robustness" };
  const cases: Row[] = [], keys: ScoringKey[] = [], rawProfiles: Row[] = [], otherObservations: Row[] = [];
  for (const [layer, count] of Object.entries(CASE_QUOTAS)) for (let index = 0; index < count; index++) {
    const caseId = `${layer}-${index}`, operation = operations[layer as keyof typeof operations], familyId = `${layer}-family-${index}`, taskGroup = ACCEPTANCE_TASK_GROUPS[index % 6];
    const profile = { schemaVersion: "saitu.profile.v6", profileId: `profile-${index}`, facts: [] };
    const input: Row = operation === "recommend" ? { profile } : operation === "qualify" ? { fixtureId: caseId, target: { kind: "condition" }, editionScope: "synthetic" }
      : operation === "conversation" ? { fixtureId: caseId, turns: [{ id: "turn-1", text: "synthetic utterance" }], initialFacts: [] }
        : { fixtureId: caseId, utterance: "synthetic utterance" };
    const scoring: Row = operation === "qualify" ? { expected: { decision: "unknown" } }
      : operation === "fact_check" ? { expected: { judgments: [{ id: "claim", status: "unknown" }] } }
        : operation === "extract_profile" ? { expected: { facts: [], unknownFields: [] } }
          : operation === "conversation" ? { checkpoints: [{ afterTurn: 1, expected: [], unknownFields: [] }] }
            : { required: ["synthetic criterion"] };
    cases.push({ schemaVersion: "saitu.sealed-case.v2", caseId, familyId, taskGroup, operation, input });
    keys.push({ caseId, authorContextId: "synthetic-author", annotationStatus: "adjudicated", scoring });
    if (operation === "recommend") rawProfiles.push({ caseId, familyId, taskGroup, profileId: profile.profileId, profile, input });
    else {
      const output = operation === "qualify" ? { decision: "unknown", targetKind: "condition", scope: "synthetic", evidence: [] }
        : operation === "fact_check" ? { judgments: [{ id: "claim", status: "unknown", evidence: [] }] }
          : operation === "extract_profile" ? { facts: [], unknownFields: [] }
            : operation === "conversation" ? { states: [{ afterTurn: 1, facts: [] }] } : { handled: true };
      const requestId = `${caseId}-r0`;
      otherObservations.push({ caseId, repetition: 0, operation, inputSha256: hash(input), adapterVersion: "synthetic-adapter", status: "observed", output, error: null,
        events: [{ type: "request_dispatch", origin: "transport", requestId, details: { operation, inputSha256: hash(input) } }, { type: "response_received", origin: "transport", requestId, details: { outputSha256: hash(output) } }] });
    }
  }
  const data: AcceptanceInput = { schemaVersion: "saitu.product-acceptance.v1", mode: "ai_proxy", selectedAlgorithm: "B", selectedReasoningEffort: "max", recallsTrimmed: false, metrics: {},
    budget: { maximumCny: 300, spentCny: 0, reservedCny: 0, unpricedCalls: 0 }, humanStudies: { actualParticipants: 0, independentHumanReviewers: 0 },
    comprehensionProtocol: { baselineMean: 70, baselineCriticalMisunderstandings: 1, mode: "superiority", frozenBeforeStudy: true }, sealedCaseExecution: [],
    challengeManifest: { schemaVersion: "saitu.challenge-manifest.v1", evidenceClass: "ai_proxy", frozenAt: "2026-11-05T09:00:00Z", implementationFrozenAt: "2026-11-05T10:00:00Z", openedAt: asOf,
      implementationSha256: hash(implementation), configurationSha256: hash({ phase: "E2", seed, effort: "max", repeats: 5, candidatePolicy: "full", algorithms: ["A1", "B", "C"], runtimeConfigurationSha256: runtimeHash }),
      isolation: "separate_contexts_shared_filesystem", publicSeedManifestSha256: sha("synthetic-development-inventory"), developmentInputSha256: Array.from({ length: 96 }, (_, i) => sha(`synthetic-dev-${i}`)), developmentFamilyIds: Array.from({ length: 36 }, (_, i) => `dev-${i}`), developmentTemplateFamilyIds: ["synthetic-dev-template"],
      cases: cases.map((item, index) => ({ caseId: String(item.caseId), familyId: String(item.familyId), templateFamilyId: `synthetic-template-${index}`, taskGroup: String(item.taskGroup),
        layer: String(item.caseId).replace(/-\d+$/, "") as keyof typeof CASE_QUOTAS, inputSha256: hash(item.input), answerSha256: hash(keys[index]), sourceSnapshotSha256: sourceRef.sha256,
        authorContextId: "synthetic-author", reviewerContextIds: ["synthetic-reviewer-a", "synthetic-reviewer-b"], adjudicatorContextId: "synthetic-adjudicator", origin: "ai_authored", split: "sealed" })) } };
  data.sealedCaseExecution = cases.map(item => ({ caseId: String(item.caseId), status: "passed" }));
  const profileSnapshot = { origin: "ai_authored_sealed", asOf, profiles: rawProfiles };
  const catalog = [{ recordId: "candidate-1", seriesId: "series-1" }, { recordId: "candidate-2", seriesId: "series-2" }];
  const binding: Row = {}, matrix: Row[] = [], runs: Row[] = [];
  const pools = rawProfiles.map(profile => ({ profileId: profile.profileId, familyId: profile.familyId, taskGroup: profile.taskGroup, poolItemIds: ["candidate-1", "candidate-2"], annotationStatus: "pending", judgments: catalog.map(item => ({ itemId: item.recordId, seriesId: item.seriesId, relevance: "U" })) }));
  for (const profile of rawProfiles) for (const algorithm of ["A1", "B", "C"]) for (let repetition = 0; repetition < 5; repetition++) {
    const invocationId = `${profile.profileId}:${algorithm}:${repetition}`, reservationIds = algorithm === "C" ? [`synthetic-${invocationId}`] : [];
    const runSeed = deriveRunSeed(seed, String(profile.profileId), repetition + 1);
    const events: Row[] = [{ type: "candidate_pool_frozen", origin: "transport", requestId: invocationId, details: { shuffleSeed: runSeed, skipIndependentRecall: true, candidateOrder: seededShuffle(["candidate-1", "candidate-2"], runSeed) } }];
    if (algorithm === "C") events.push({ type: "ai_budget_reserved", origin: "product", requestId: invocationId, details: { reservationId: reservationIds[0], phase: "formal", model: "deepseek-flash", effort: "max" } }, { type: "ai_transport_dispatch", origin: "product", requestId: invocationId, details: { reservationId: reservationIds[0], model: "deepseek-flash", operation: "competition_recommend" } }, { type: "ai_budget_settled", origin: "product", requestId: invocationId, details: { reservationId: reservationIds[0], upstreamAttempted: true } });
    const output = { recommendations: [{ itemId: "candidate-1" }, { itemId: "candidate-2" }], trace: { method: algorithm === "C" ? "llm" : algorithm === "B" ? "hybrid" : "rules" }, fallback: { used: false } };
    const shared = { invocationId, profileId: profile.profileId, algorithm, inputSha256: hash(profile.input), outputSha256: hash(output), candidateSetSha256: hash(["candidate-1", "candidate-2"]), reservationIds, freezeBinding: binding };
    matrix.push({ ...shared, caseId: profile.caseId, operation: "recommend", adapterVersion: "saitu-frozen-ranking.v1", repetition, status: "observed", output, fallback: false, events, execution: { modelStatus: "ok", actualModelRun: algorithm === "C", httpDispatches: algorithm === "C" ? 1 : 0 } });
    runs.push({ ...shared, runId: invocationId, modelStatus: "ok", displayedItemIds: ["candidate-1", "candidate-2"], fallbackUsed: false });
  }
  const rankingReviews: Row[] = pools.flatMap(pool => {
    const profile = rawProfiles.find(profile => profile.profileId === pool.profileId)!, key = keys.find(key => key.caseId === profile.caseId)!;
    return ["reviewer_a", "reviewer_b"].map(role => ({ profileId: profile.profileId, caseId: profile.caseId, role, contextId: role === "reviewer_a" ? "synthetic-reviewer-a" : "synthetic-reviewer-b", keySha256: hash(key), inputSha256: hash(profile.input), sourceSnapshotSha256: sourceRef.sha256,
      poolSha256: hash(pool.judgments.map(({ itemId, seriesId }) => ({ itemId, seriesId }))), judgments: pool.judgments.map((row, index) => ({ ...row, relevance: index === 0 ? 3 : 2 })) }));
  });
  let transformProductRows: (rows: Row[]) => Row[] = rows => rows;
  const persist = () => {
    const challenge = write("challenge.json", data.challengeManifest), rankingInput = write("ranking-original-input.json", profileSnapshot);
    const rankConfig = { ...(rankingMetrics ? { metricAggregation: rankingMetrics.protocol } : {}), schemaVersion: "saitu.ranking-registration-config.v1", purpose: "ai_proxy_acceptance", profileCount: 120, repeats: 5, effort: "max", phase: "E2", candidatePolicy: "full", algorithms: ["A1", "B", "C"], seed, challengeManifestSha256: challenge.sha256, sourceSnapshotSha256: sourceRef.sha256, inputSha256: rankingInput.sha256 };
    const rankRegistration = write("registration.json", { ...(rankingMetrics ? { registeredAt: rankingMetrics.registeredAt } : {}), schemaVersion: "saitu.ranking-registration.v1", config: rankConfig, inputOpened: false, implementationSha256: hash(implementation), runtimeConfiguration: runtime, runtimeConfigurationSha256: runtimeHash });
    Object.assign(binding, { registrationSha256: rankRegistration.sha256, challengeManifestSha256: challenge.sha256, sourceSnapshotSha256: sourceRef.sha256, implementationSha256: hash(implementation), configurationSha256: data.challengeManifest.configurationSha256, profilesSha256: hash(profileSnapshot), catalogSha256: hash(catalog), runtimeConfigurationSha256: runtimeHash });
    const files = [rankRegistration, write("runtime-configuration.json", { configuration: runtime, sha256: runtimeHash }), write("opening.json", { ...(rankingMetrics ? { openedAt: rankingMetrics.openedAt } : {}), registrationSha256: rankRegistration.sha256, inputSha256: rankConfig.inputSha256 }),
      write("experiment.json", { ...(rankingMetrics ? { startedAt: rankingMetrics.startedAt } : {}), schemaVersion: "saitu.experiment-run.v2", purpose: "ai_proxy_acceptance", liveRequested: true, implementationUnchanged: true, runtimeConfigurationUnchanged: true, completedAt: "2026-11-05T12:05:00Z", implementationSha256: binding.implementationSha256, catalogSha256: binding.catalogSha256, reasoningEffort: "max", candidatePolicy: "full", seed }),
      write("profiles-snapshot.json", profileSnapshot), write("catalog-snapshot.json", { records: catalog }), write("implementation-snapshot.json", { sha256: hash(implementation), files: implementation }),
      write("contexts.json", rawProfiles.map(profile => ({ profile: profile.profile, candidates: catalog.map(row => ({ itemId: row.recordId, seriesId: row.seriesId })), excluded: [] }))),
      write("ranking-input.json", { schemaVersion: "saitu.ranking-evaluation.v1", purpose: "ai_proxy_acceptance", catalogVersion: "synthetic", expectedRunsPerProfile: 5, algorithms: ["A1", "B", "C"], profiles: pools, runs }),
      write("product-observations.json", { schemaVersion: "saitu.bound-ranking-observations.v1", freezeBinding: binding, observations: matrix })];
    const freeze = write("freeze-manifest.json", { schemaVersion: "saitu.experiment-freeze.v1", freezeBinding: binding, phase: "E2", seed, configuration: { effort: "max", repeats: 5, candidatePolicy: "full", skipIndependentRecall: true }, requestedAlgorithms: ["A1", "B", "C"], files });
    const productCases = write("product-cases.jsonl", cases, true);
    const productConfig = { schemaVersion: "saitu.sealed-run-config.v1", asOf, seed, repeats: 5, method: "hybrid", modelMode: "disabled", inputSha256: productCases.sha256, challengeManifestSha256: challenge.sha256, sourceSnapshotSha256: sourceRef.sha256, sources: { indexSha256: sourceRef.sha256 }, rankingReuse: { algorithm: "B", freezeManifestSha256: freeze.sha256 } };
    const productRegistration = write("product-registration.json", { schemaVersion: "saitu.sealed-run-registration.v1", registeredAt: "2026-11-05T11:00:00Z", adapterVersion: "synthetic-adapter", config: productConfig, inputOpened: false, sourceManifest: implementation, runtimeConfiguration: runtime, runtimeConfigurationSha256: runtimeHash, catalogSha256: hash(catalog) });
    const order = cases.flatMap(item => Array.from({ length: item.operation === "recommend" ? 5 : 1 }, (_, repetition) => ({ caseId: item.caseId, repetition, inputSha256: hash(item.input) })));
    let orderState = seed >>> 0;
    for (let index = order.length - 1; index > 0; index--) {
      orderState = (Math.imul(orderState, 1664525) + 1013904223) >>> 0;
      const selected = orderState % (index + 1); [order[index], order[selected]] = [order[selected], order[index]];
    }
    const productRows = transformProductRows(order.map(entry => {
      const original = matrix.find(row => row.algorithm === "B" && row.caseId === entry.caseId && row.repetition === entry.repetition) ?? otherObservations.find(row => row.caseId === entry.caseId)!;
      return { ...original, registrationSha256: productRegistration.sha256, ...(original.operation === "recommend" ? { reusedFromFreezeSha256: freeze.sha256 } : {}) };
    }));
    const semanticReviews = productRows.filter(row => row.operation !== "recommend").flatMap(observation => {
      const key = keys.find(key => key.caseId === observation.caseId)!;
      return ["reviewer_a", "reviewer_b"].map(role => ({ caseId: observation.caseId, repetition: 0, role, contextId: role === "reviewer_a" ? "synthetic-reviewer-a" : "synthetic-reviewer-b", keySha256: hash(key), observationSha256: hash(observation),
        decisions: semanticRulePointers(key).map(rulePointer => ({ rulePointer, status: "passed", reason: "synthetic fixture assertion, not an independent judgment", observations: [{ pointer: "/output", valueSha256: hash(observation.output) }], sources: [{ sourceId: "synthetic-source", bodySha256: sha(sourceBody), quote: sourceBody }] })) }));
    });
    const implementationBefore = write("implementation-before.json", { implementationSha256: hash(implementation), files: implementation });
    const implementationAfter = write("implementation-after.json", { implementationSha256: hash(implementation), files: implementation });
    const runtimeBefore = write("runtime-before.json", { sha256: runtimeHash, configuration: runtime });
    const runtimeAfter = write("runtime-after.json", { sha256: runtimeHash, configuration: runtime });
    const executionIntegrity = write("execution-integrity.json", { schemaVersion: "saitu.sealed-execution-integrity.v1", registrationSha256: productRegistration.sha256, configurationSha256: hash(productConfig), before: { implementation: implementationBefore, runtime: runtimeBefore }, after: { implementation: implementationAfter, runtime: runtimeAfter }, implementationUnchanged: true, runtimeConfigurationUnchanged: true, status: "completed", failureArtifact: null });
    const envelope = write("raw-scoring.json", { schemaVersion: "saitu.acceptance-raw-scoring.v1", dispatchEvidence: write("dispatch-evidence.json", { schemaVersion: "saitu.acceptance-ranking-dispatch-evidence.v1", challengeManifest: challenge, freezeManifest: freeze }), rankingInput, productRegistration,
      productOpening: write("product-opening.json", { schemaVersion: "saitu.sealed-opening.v1", openedAt: "2026-11-05T12:06:00Z", registrationSha256: productRegistration.sha256, expectedInputSha256: productCases.sha256, sourceIndexSha256: sourceRef.sha256 }),
      productCases, productObservations: write("observations.jsonl", productRows, true), executionOrder: write("execution-order.json", order), implementationBefore, implementationAfter, runtimeBefore, runtimeAfter, executionIntegrity,
      answers: write("answers.jsonl", keys, true), sourceSnapshot: sourceRef, semanticReviews: write("semantic-reviews.jsonl", semanticReviews, true), rankingReviews: write("ranking-reviews.jsonl", rankingReviews, true) });
    data.rawScoringEvidence = envelope;
  };
  persist();
  return { data, matrix, runs, cases, keys, rankingReviews, runtime, write, persist, mutateProductRows: (fn: (rows: Row[]) => Row[]) => { transformProductRows = fn; } };
}
