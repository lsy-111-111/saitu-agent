import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const performanceTools = createRequire(import.meta.url)("./product-performance.mjs") as { readAccountingTrace:(log:string)=>JsonObject[]; validatePerformanceRegistration:(value:unknown)=>unknown; validatePerformanceProfileReview:(registration:unknown,review:unknown)=>unknown; summarizePerformance:(registration:unknown,rows:unknown[])=>Record<string,unknown> };
const { decisionReportSchema } = createRequire(import.meta.url)("../../../src/lib/competitions/v6/contracts.ts") as typeof import("../../../src/lib/competitions/v6/contracts");
import type { AcceptanceInput, MetricEvidence } from "./acceptance-gate";
import type { RawScoringDerivation } from "./acceptance-raw-scoring";

type JsonObject = Record<string, unknown>;
export type ArtifactReference = { path: string; sha256: string };
export type DerivedMetric = Pick<MetricEvidence, "value" | "denominator" | "evidenceClass"> & { numerator?: number };
export type MetricDerivation = {
  status: "derived" | "pending" | "invalid";
  reason: string | null;
  derived: DerivedMetric | null;
  details?: Record<string, unknown>;
};
const object = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("artifact_object_required");
  return value as JsonObject;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("artifact_array_required");
  return value;
};
const text = (value: unknown): string => {
  if (typeof value !== "string" || !value) throw new Error("artifact_string_required");
  return value;
};
const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const byteHash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
export function acceptanceCanonicalHash(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    const record = object(item);
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  };
  return createHash("sha256").update(canonical(value)).digest("hex");
}
const same = (left: unknown, right: unknown) => acceptanceCanonicalHash(left) === acceptanceCanonicalHash(right);
class PendingRawEvidence extends Error {}
const requireEvidence = (condition: unknown, reason: string): void => { if (!condition) throw new Error(reason); };

/** Both lexical and real paths must remain inside the evidence root; a symlink cannot escape it. */
class ArtifactReader {
  readonly root: string;
  constructor(root: string) { this.root = realpathSync(root); }
  bytes(reference: ArtifactReference, relativeTo = this.root): { bytes: Buffer; file: string } {
    requireEvidence(isHash(reference.sha256), "artifact_sha256_required");
    const filename = path.resolve(relativeTo, text(reference.path));
    requireEvidence(filename.startsWith(this.root + path.sep), "artifact_outside_evidence_root");
    const real = realpathSync(filename);
    requireEvidence(real.startsWith(this.root + path.sep), "artifact_symlink_outside_evidence_root");
    const bytes = readFileSync(real);
    requireEvidence(byteHash(bytes) === reference.sha256, "artifact_bytes_mismatch");
    return { bytes, file: real };
  }
  read(reference: ArtifactReference, relativeTo = this.root): { value: JsonObject; bytes: Buffer; file: string } {
    const result = this.bytes(reference, relativeTo);
    return { ...result, value: object(JSON.parse(result.bytes.toString("utf8"))) };
  }
}
function reference(value: unknown): ArtifactReference {
  const entry = object(value);
  return { path: text(entry.path), sha256: text(entry.sha256) };
}

/** Fixed whitelist: adding a schema alone never grants permission to satisfy another metric. */
export const ACCEPTANCE_METRIC_DERIVERS = Object.freeze({
  actualModelRuns: "saitu.acceptance-ranking-dispatch-evidence.v1",
  firstScreenP95Ms: "saitu.acceptance-browser-performance-evidence.v1",
  fullReportP95Ms: "saitu.acceptance-browser-performance-evidence.v1",
  pooledNdcg5: "saitu.acceptance-raw-scoring.v1",
  pooledNdcg10: "saitu.acceptance-raw-scoring.v1",
  minimumTaskGroupNdcg5: "saitu.acceptance-raw-scoring.v1",
  completePoolLabelCoverage: "saitu.acceptance-raw-scoring.v1",
  unresolvedLabels: "saitu.acceptance-raw-scoring.v1",
  top5Jaccard: "saitu.acceptance-raw-scoring.v1",
  hardConstraintViolations: "saitu.acceptance-raw-scoring.v1",
  validReasons:"saitu.acceptance-raw-scoring.v1",
  abilityInflationOrRevocationFailures:"saitu.acceptance-raw-scoring.v1",
  correctionSuccess:"saitu.acceptance-raw-scoring.v1",
  expectedCounterfactualResponses:"saitu.acceptance-raw-scoring.v1",
  factAccuracy:"saitu.acceptance-raw-scoring.v1",
  criticalFactErrors:"saitu.acceptance-raw-scoring.v1",
  citationPrecision:"saitu.acceptance-raw-scoring.v1",
  citationCoverage:"saitu.acceptance-raw-scoring.v1",
  criticalCitationCoverage:"saitu.acceptance-raw-scoring.v1",
  profileMicroF1: "saitu.acceptance-raw-scoring.v1",
  profileMinimumSliceF1: "saitu.acceptance-raw-scoring.v1",
  rawReviewerAgreementAlpha: "saitu.acceptance-raw-scoring.v1",
  relativeNdcg5Gain: "saitu.acceptance-raw-scoring.v1",
  relativeNdcg5CiLower: "saitu.acceptance-raw-scoring.v1",
});

// The public-only contract emitted by runtime-configuration.mjs. Do not accept arbitrary env keys.
const RUNTIME_CONTROL_KEYS = ["AI_PROVIDER", "AI_MODEL", "AI_COMPETITION_NORMALIZE_MODEL", "AI_COMPETITION_RECOMMEND_MODEL",
  "AI_TIMEOUT_MS", "AI_REQUEST_DEADLINE_MS", "AI_RETRY_MAX_DELAY_MS", "AI_TEST_MODE", "ALLOW_AI_MOCK",
  "AI_SPEND_RUN_ID", "AI_SPEND_PHASE", "AI_SPEND_FUNDED_CNY", "AI_SPEND_LIMIT_CNY", "AI_CALIBRATION_CALL_LIMIT", "AI_BUDGET_TIMEZONE",
  "AI_REASONING_EFFORT", "SAITU_DECISION_STRATEGY", "SAITU_CATALOG_SNAPSHOT_PATH", "SAITU_FROZEN_EVIDENCE_INDEX",
  "SAITU_FROZEN_EVIDENCE_INDEX_SHA256", "SAITU_FROZEN_EVIDENCE_ROOT", "NODE_ENV", "AI_API_URL"] as const;
export function validatePublicRuntimeConfiguration(value: unknown) {
  const configuration = object(value), values = object(configuration.values);
  // Frozen v1 originals omitted the new control. Absence means the original
  // hard default 100; never insert a field or rewrite their canonical hashes.
  const expectedKeys = Object.hasOwn(values, "AI_CALIBRATION_CALL_LIMIT") ? [...RUNTIME_CONTROL_KEYS]
    : RUNTIME_CONTROL_KEYS.filter(key => key !== "AI_CALIBRATION_CALL_LIMIT");
  requireEvidence(Object.keys(configuration).sort().join(",") === "schemaVersion,values"
    && configuration.schemaVersion === "saitu.runtime-configuration.v1"
    && same(Object.keys(values).sort(), expectedKeys.sort())
    && Object.values(values).every(value => value === null || typeof value === "string")
    && typeof values.NODE_ENV === "string" && values.NODE_ENV.length > 0,
  "runtime_configuration_public_contract_invalid");
  const callLimit = values.AI_CALIBRATION_CALL_LIMIT;
  requireEvidence(callLimit === undefined || callLimit === null || (typeof callLimit === "string"
    && /^[1-9][0-9]*$/.test(callLimit) && Number.isSafeInteger(Number(callLimit)) && Number(callLimit) <= 100), "runtime_calibration_call_limit_invalid");
  if (values.AI_API_URL !== null) {
    const url = new URL(text(values.AI_API_URL));
    requireEvidence(!url.username && !url.password && !url.search && !url.hash && url.href === values.AI_API_URL,
      "runtime_configuration_credential_bearing_url");
  }
  return configuration;
}
function validateRuntimeBinding(artifact: JsonObject, registration: JsonObject, registeredConfig: JsonObject, binding: JsonObject) {
  requireEvidence(Object.keys(artifact).sort().join(",") === "configuration,sha256", "runtime_configuration_public_contract_invalid");
  const configuration = validatePublicRuntimeConfiguration(artifact.configuration);
  const runtimeHash = acceptanceCanonicalHash(configuration);
  requireEvidence(artifact.sha256 === runtimeHash && binding.runtimeConfigurationSha256 === runtimeHash
    && registration.runtimeConfigurationSha256 === runtimeHash
    && same(registration.runtimeConfiguration, configuration), "runtime_configuration_binding_mismatch");
  const expectedConfigurationHash = acceptanceCanonicalHash({ phase: registeredConfig.phase, seed: registeredConfig.seed,
    effort: registeredConfig.effort, repeats: registeredConfig.repeats, candidatePolicy: registeredConfig.candidatePolicy,
    algorithms: registeredConfig.algorithms, runtimeConfigurationSha256: runtimeHash });
  requireEvidence(binding.configurationSha256 === expectedConfigurationHash,
    "runtime_registered_execution_configuration_hash_mismatch");
}

function deriveActualModelRuns(envelope: JsonObject, reader: ArtifactReader, input: AcceptanceInput): DerivedMetric {
  requireEvidence(Object.keys(envelope).sort().join(",") === "challengeManifest,freezeManifest,schemaVersion", "dispatch_evidence_envelope_contract");
  const challenge = reader.read(reference(envelope.challengeManifest));
  requireEvidence(same(challenge.value, input.challengeManifest), "challenge_manifest_not_bound_to_acceptance");
  const freeze = reader.read(reference(envelope.freezeManifest));
  requireEvidence(freeze.value.schemaVersion === "saitu.experiment-freeze.v1", "formal_ranking_freeze_required");
  const binding = object(freeze.value.freezeBinding);
  requireEvidence(binding.challengeManifestSha256 === byteHash(challenge.bytes)
    && binding.implementationSha256 === input.challengeManifest.implementationSha256
    && binding.configurationSha256 === input.challengeManifest.configurationSha256,
  "ranking_challenge_implementation_or_configuration_mismatch");
  for (const key of ["registrationSha256", "sourceSnapshotSha256", "catalogSha256", "profilesSha256", "runtimeConfigurationSha256"])
    requireEvidence(isHash(binding[key]), "incomplete_ranking_freeze_binding");
  const config = object(freeze.value.configuration);
  requireEvidence(freeze.value.phase === "E2" && config.effort === "max" && config.repeats === 5
    && config.candidatePolicy === "full" && config.skipIndependentRecall === true
    && same(freeze.value.requestedAlgorithms, ["A1", "B", "C"]), "formal_full_matrix_configuration_required");
  // Freeze inventories contain both object documents and contexts.json arrays.
  // Verify every member's raw bytes first; enforce object shape only when a
  // required object document is consumed below. Unknown members are not skipped.
  const artifacts = new Map<string, Buffer>();
  for (const raw of array(freeze.value.files)) {
    const entry = reference(raw);
    requireEvidence(!path.isAbsolute(entry.path) && !entry.path.split(/[\\/]/).includes("..") && !artifacts.has(entry.path), "invalid_frozen_artifact_inventory");
    const artifact = reader.bytes(entry, path.dirname(freeze.file));
    artifacts.set(entry.path, artifact.bytes);
  }
  const get = (name: string): JsonObject => {
    const value = artifacts.get(name);
    if (!value) throw new Error(`missing_frozen_artifact:${name}`);
    return object(JSON.parse(value.toString("utf8")));
  };
  const registration = get("registration.json"), opening = get("opening.json"), experiment = get("experiment.json");
  const registrationRef = array(freeze.value.files).map(reference).find(row => row.path === "registration.json")!;
  requireEvidence(registrationRef.sha256 === binding.registrationSha256
    && opening.registrationSha256 === binding.registrationSha256
    && registration.schemaVersion === "saitu.ranking-registration.v1" && registration.inputOpened === false
    && registration.implementationSha256 === binding.implementationSha256, "ranking_registration_or_opening_mismatch");
  const registeredConfig = object(registration.config);
  requireEvidence(registeredConfig.purpose === "ai_proxy_acceptance" && registeredConfig.profileCount === 120
    && registeredConfig.repeats === 5 && registeredConfig.effort === "max" && registeredConfig.phase === "E2"
    && registeredConfig.candidatePolicy === "full" && same(registeredConfig.algorithms, ["A1", "B", "C"])
    && registeredConfig.challengeManifestSha256 === binding.challengeManifestSha256
    && registeredConfig.sourceSnapshotSha256 === binding.sourceSnapshotSha256
    && opening.inputSha256 === registeredConfig.inputSha256, "ranking_registered_configuration_mismatch");
  requireEvidence(artifacts.has("runtime-configuration.json"), "frozen_runtime_configuration_artifact_required");
  validateRuntimeBinding(get("runtime-configuration.json"), registration, registeredConfig, binding);
  requireEvidence(experiment.schemaVersion === "saitu.experiment-run.v2" && experiment.purpose === "ai_proxy_acceptance"
    && experiment.liveRequested === true && experiment.implementationUnchanged === true && experiment.runtimeConfigurationUnchanged === true && typeof experiment.completedAt === "string"
    && experiment.implementationSha256 === binding.implementationSha256 && experiment.catalogSha256 === binding.catalogSha256
    && experiment.reasoningEffort === "max" && experiment.candidatePolicy === "full"
    && experiment.seed === freeze.value.seed && registeredConfig.seed === freeze.value.seed,
  "live_completed_frozen_experiment_required");
  const profiles = get("profiles-snapshot.json"), catalog = get("catalog-snapshot.json"), source = get("implementation-snapshot.json");
  requireEvidence(acceptanceCanonicalHash(profiles) === binding.profilesSha256 && profiles.origin === "ai_authored_sealed"
    && acceptanceCanonicalHash(catalog.records) === binding.catalogSha256
    && source.sha256 === binding.implementationSha256 && acceptanceCanonicalHash(source.files) === binding.implementationSha256,
  "frozen_profile_catalog_or_source_hash_mismatch");
  const rawProfiles = array(profiles.profiles).map(object);
  requireEvidence(rawProfiles.length === 120, "ranking_requires_120_profiles");
  const byProfile = new Map(rawProfiles.map(row => [text(row.profileId), row]));
  const challengeCases = new Map(input.challengeManifest.cases.filter(row => row.layer === "ranking").map(row => [row.caseId, row]));
  requireEvidence(byProfile.size === 120 && challengeCases.size === 120, "ranking_profile_case_bijection_required");
  const caseIds = new Set<string>();
  for (const profile of rawProfiles) {
    const caseId = text(profile.caseId), item = challengeCases.get(caseId);
    requireEvidence(item && !caseIds.has(caseId) && profile.familyId === item.familyId && profile.taskGroup === item.taskGroup
      && acceptanceCanonicalHash(profile.input) === item.inputSha256
      && same(object(profile.input).profile, profile.profile)
      && item.sourceSnapshotSha256 === binding.sourceSnapshotSha256, "ranking_profile_not_bound_to_challenge");
    caseIds.add(caseId);
  }
  const ranked = get("ranking-input.json"), observed = get("product-observations.json");
  requireEvidence(ranked.schemaVersion === "saitu.ranking-evaluation.v1" && ranked.purpose === "ai_proxy_acceptance"
    && ranked.expectedRunsPerProfile === 5 && same(ranked.algorithms, ["A1", "B", "C"])
    && observed.schemaVersion === "saitu.bound-ranking-observations.v1" && same(observed.freezeBinding, binding), "ranking_observation_schema_or_freeze_mismatch");
  const runs = array(ranked.runs).map(object), observations = array(observed.observations).map(object);
  const pools = new Map(array(ranked.profiles).map(object).map(row => [text(row.profileId), row]));
  const rankedRuns = new Map(runs.map(row => [text(row.invocationId), row]));
  requireEvidence(runs.length === 1800 && rankedRuns.size === 1800 && observations.length === 1800 && pools.size === 120, "complete_1800_matrix_required");
  const invocations = new Set<string>(), combinations = new Set<string>(), paidReservations = new Set<string>();
  let actualModelRuns = 0, recommendationDenominator = 0;
  for (const observation of observations) {
    const id = text(observation.invocationId), profile = byProfile.get(text(observation.profileId)), pool = pools.get(text(observation.profileId));
    const ranking = rankedRuns.get(id), algorithm = observation.algorithm, repetition = observation.repetition;
    requireEvidence(profile && pool && ranking && !invocations.has(id) && ["A1", "B", "C"].includes(String(algorithm))
      && Number.isInteger(repetition) && Number(repetition) >= 0 && Number(repetition) < 5,
    "matrix_identity_or_repetition_invalid");
    invocations.add(id);
    const combination = JSON.stringify([observation.profileId, algorithm, repetition]);
    requireEvidence(!combinations.has(combination), "duplicate_matrix_combination"); combinations.add(combination);
    const profileRow = profile!, poolRow = pool!, rankingRow = ranking!;
    requireEvidence(observation.caseId === profileRow.caseId && observation.operation === "recommend"
      && ["observed", "error", "not_run"].includes(String(observation.status))
      && observation.inputSha256 === acceptanceCanonicalHash(profileRow.input)
      && observation.outputSha256 === acceptanceCanonicalHash(observation.output)
      && observation.candidateSetSha256 === acceptanceCanonicalHash([...array(poolRow.poolItemIds)].sort())
      && same(observation.freezeBinding, binding), "raw_ranking_input_output_binding_mismatch");
    for (const key of ["invocationId", "inputSha256", "outputSha256", "reservationIds", "freezeBinding", "candidateSetSha256"])
      requireEvidence(same(observation[key], rankingRow[key]), "ranking_observation_link_mismatch");
    requireEvidence(rankingRow.profileId === observation.profileId && rankingRow.algorithm === algorithm, "ranking_arm_profile_mismatch");
    const events = array(observation.events).map(object);
    requireEvidence(!events.some(event => event.origin === "injected" || String(event.type).endsWith("_injected")), "injected_transport_cannot_certify_live_runs");
    const dispatches = events.filter(event => event.type === "ai_transport_dispatch");
    const reservations = array(observation.reservationIds).map(text);
    for (const dispatch of dispatches) {
      const details = object(dispatch.details), reservationId = text(details.reservationId);
      requireEvidence(algorithm === "C" && observation.status !== "not_run" && dispatch.origin === "product"
        && dispatch.requestId === id && details.model === "deepseek-flash" && details.operation === "competition_recommend"
        && reservations.includes(reservationId) && !paidReservations.has(reservationId), "live_dispatch_identity_or_reservation_mismatch");
      const reserved = events.filter(event => event.type === "ai_budget_reserved" && object(event.details).reservationId === reservationId);
      const settled = events.filter(event => ["ai_budget_settled", "ai_settlement_failed"].includes(String(event.type)) && object(event.details).reservationId === reservationId);
      requireEvidence(reserved.length === 1 && object(reserved[0].details).phase === "formal"
        && object(reserved[0].details).model === "deepseek-flash" && object(reserved[0].details).effort === "max"
        && settled.length === 1 && object(settled[0].details).upstreamAttempted === true, "live_dispatch_budget_observation_missing");
      paidReservations.add(reservationId);
    }
    const execution = object(observation.execution);
    requireEvidence(execution.httpDispatches === dispatches.length && execution.actualModelRun === (dispatches.length > 0), "declared_dispatch_count_mismatch");
    if (algorithm === "C") { recommendationDenominator++; if (dispatches.length) actualModelRuns++; }
  }
  requireEvidence(recommendationDenominator === 600, "ranking_requires_600_C_invocations");
  return { value: actualModelRuns, numerator: actualModelRuns, denominator: recommendationDenominator, evidenceClass: "live_model" };
}

/** Explicit preregistration, not an inference from whichever scorer is current.
 * The entire object must be in ranking registration.config.metricAggregation
 * before opening; that registration's exact bytes are already in the raw freeze. */
export const RANKING_METRIC_AGGREGATION = Object.freeze({
  schemaVersion: "saitu.ranking-metric-aggregation.v1",
  runWeighting: "equal_within_profile", profileWeighting: "equal_within_family", familyWeighting: "equal",
  ndcg: "best_track_per_series_idcg", noRelevantPool: "exclude_and_report_null",
  taskGroups: "minimum_of_six_equal_family_means",
  poolLabelCoverage: "complete_profiles_over_all_120_profiles", unresolvedLabels: "unresolved_pool_items",
  jaccard: Object.freeze({ k: 5, identity: "series", pairs: "all_10_unordered_pairs_per_five_runs", emptyUnion: 1,
    noRelevantPool: "exclude_from_family_mean" }),
});
const RANKING_METRICS = new Set(["pooledNdcg5", "pooledNdcg10", "minimumTaskGroupNdcg5", "completePoolLabelCoverage", "unresolvedLabels", "top5Jaccard", "rawReviewerAgreementAlpha", "relativeNdcg5Gain","relativeNdcg5CiLower"]);
const TASK_GROUPS = ["software_data", "engineering_design", "experimental_agriculture", "business_practice", "survey_education", "arts_language"];
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function replayRawScoring(input: AcceptanceInput, root: string): RawScoringDerivation {
  // Lazy, synchronous lookup avoids a top-level artifact <-> raw-scoring cycle.
  // Raw scoring's dispatch validation calls only the non-ranking single metric.
  return (createRequire(import.meta.url)("./acceptance-raw-scoring.ts") as typeof import("./acceptance-raw-scoring")).deriveSealedExecution(input, root);
}
function deriveRankingMetric(metricId: string, raw: RawScoringDerivation, input: AcceptanceInput, reader: ArtifactReader): MetricDerivation {
  const metadata = raw.rankingMetadata, scoring = raw.scoring;
  const summary = scoring?.ranking.summaries.find(row => row.algorithm === input.selectedAlgorithm);
  const details = { rawStatus: raw.status, rawReason: raw.reason, selectedAlgorithm: input.selectedAlgorithm,
    independentFamilyCount: summary?.familyCount ?? null, scoredFamilyCount: summary?.scoredFamilyCount ?? null,
    noRelevantProfileIds: summary?.noRelevantProfileIds ?? [], actualRunCount: summary?.actualRunCount ?? null,
    generationFailureCount: summary?.generationFailureCount ?? null, fallbackCount: summary?.fallbackCount ?? null,
    aggregationProtocol: metadata?.aggregationProtocol ?? null };
  // Do not promote diagnostic rescoring, even if the envelope self-names reviews.
  if (raw.status !== "derived") return { status: raw.status, reason: raw.reason, derived: null, details };
  requireEvidence(raw.rawValidated && metadata && scoring && summary, "ranking_raw_aggregation_metadata_required");
  requireEvidence(input.rawScoringEvidence && same(metadata!.rawScoringEvidence, input.rawScoringEvidence)
    && metadata!.implementationSha256 === input.challengeManifest.implementationSha256
    && metadata!.configurationSha256 === input.challengeManifest.configurationSha256
    && input.challengeManifest.cases.every(row => row.sourceSnapshotSha256 === metadata!.sourceSnapshotSha256), "ranking_raw_provenance_mismatch");
  if (metadata!.aggregationProtocol === null) return { status: "pending", reason: "ranking_metric_aggregation_not_preregistered", derived: null, details };
  requireEvidence(same(metadata!.aggregationProtocol, RANKING_METRIC_AGGREGATION), "unsupported_ranking_metric_aggregation");
  const times = [metadata!.registeredAt, metadata!.openedAt, metadata!.startedAt, metadata!.completedAt];
  if (times.some(time => typeof time !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(time) || !Number.isFinite(Date.parse(time))))
    return { status: "pending", reason: "ranking_metric_preregistration_timeline_required", derived: null, details };
  // The challenge has its own byte-bound opening, which may precede the
  // runner's later input-opening receipt. The latter cannot reset exposure.
  const challengeTimes = [input.challengeManifest.openedAt, input.challengeManifest.frozenAt, input.challengeManifest.implementationFrozenAt];
  if (challengeTimes.some(time => time === null || time === undefined || time === ""))
    return { status: "pending", reason: "ranking_challenge_opening_timeline_required", derived: null, details };
  requireEvidence(challengeTimes.every(time => typeof time === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(time) && Number.isFinite(Date.parse(time))),
    "ranking_challenge_opening_timeline_invalid");
  const [challengeOpened, challengeFrozen, implementationFrozen] = challengeTimes.map(time => Date.parse(time as string));
  requireEvidence(challengeOpened >= Math.max(challengeFrozen, implementationFrozen), "ranking_challenge_opening_before_freeze");
  const instants = times.map(time => Date.parse(time as string));
  requireEvidence(instants[0] <= challengeOpened, "ranking_metric_registration_after_challenge_opening");
  requireEvidence(instants.every((time, index) => !index || instants[index - 1] <= time), "ranking_metric_registration_after_opening");
  const profiles = scoring!.ranking.profileResults.filter(row => row.algorithm === input.selectedAlgorithm);
  const cases = input.challengeManifest.cases.filter(row => row.layer === "ranking");
  requireEvidence(profiles.length === 120 && new Set(profiles.map(row => row.familyId)).size === 120
    && cases.length === 120 && new Set(cases.map(row => row.familyId)).size === 120
    && profiles.every(row => row.runCount === 5 && row.runs.length === 5 && row.annotationStatus === "ai_blind_reviewed"
      && cases.some(item => item.familyId === row.familyId && item.taskGroup === row.taskGroup))
    && TASK_GROUPS.every(group => profiles.filter(row => row.taskGroup === group).length === 20)
    && summary!.familyCount === 120 && summary!.actualRunCount === 600 && summary!.aiProxyAcceptanceEligible,
  "ranking_requires_complete_120_families_five_runs_six_groups");
  requireEvidence(metadata!.profileCount === 120 && metadata!.completePoolProfiles === 120 && metadata!.unresolvedPoolItems === 0,
    "ranking_complete_reviewed_pool_labels_required");
  const scored = profiles.filter(row => row.status === "scored"), noRelevant = profiles.filter(row => row.status === "no_relevant_pool");
  requireEvidence(scored.length + noRelevant.length === 120 && scored.length === summary!.scoredFamilyCount
    && noRelevant.every(row => row.pooledNdcg5 === null && row.pooledNdcg10 === null), "ranking_invalid_or_blocked_family");
  const groups = TASK_GROUPS.map(taskGroup => {
    const group = scored.filter(row => row.taskGroup === taskGroup);
    return { taskGroup, independentFamilyCount: 20, scoredFamilyCount: group.length,
      noRelevantFamilyIds: noRelevant.filter(row => row.taskGroup === taskGroup).map(row => row.familyId),
      pooledNdcg5: mean(group.map(row => row.pooledNdcg5!)) };
  });
  const groupValues = groups.map(row => row.pooledNdcg5);
  let derived: DerivedMetric;
  const evidenceClass = "ai_proxy" as const;
  if (metricId === "relativeNdcg5Gain" || metricId === "relativeNdcg5CiLower") {
    if (!metadata!.baselineSelection) throw new PendingRawEvidence("preselected_development_baseline_required");
    const preregistered = object(metadata!.baselineSelection), seal = reader.read(reference(preregistered)).value;
    requireEvidence(seal.schemaVersion === "saitu.public-development-baseline.v1" && seal.algorithm === preregistered.algorithm &&
      ["A1","B"].includes(text(seal.algorithm)) && input.selectedAlgorithm === "C" && Date.parse(text(seal.createdAt)) <= Date.parse(text(metadata!.registeredAt)), "invalid_preselected_baseline_or_time");
    const {replayDevelopmentSeal} = createRequire(import.meta.url)("./select-development-baseline.mjs") as {replayDevelopmentSeal(root:string,seal:JsonObject):{algorithm:string}};
    requireEvidence(replayDevelopmentSeal(reader.root,seal).algorithm === seal.algorithm, "baseline_selection_not_reproducible");
    const base = scoring!.ranking.summaries.find(arm=>arm.algorithm===seal.algorithm);
    requireEvidence(base && base.familyCount === 120 && base.actualRunCount === 600 && base.aiProxyAcceptanceEligible, "incomplete_baseline_comparison");
    const pairs = (families: NonNullable<typeof summary>["families"]) => families.filter(f=>f.pooledNdcg5!==null).map(f=>({familyId:f.familyId,value:f.pooledNdcg5!}));
    const candidate = pairs(summary!.families), control = pairs(base!.families);
    if (candidate.length < 2 || control.length < 2) throw new PendingRawEvidence("insufficient_paired_families");
    const {pairedFamilyBootstrap} = createRequire(import.meta.url)("./evaluate-rankings.ts") as typeof import("./evaluate-rankings");
    const paired = pairedFamilyBootstrap(candidate,control,2000,6141);
    return {status:"derived",reason:null,derived:{value:metricId==="relativeNdcg5Gain"?paired.meanDifference:paired.interval[0],denominator:paired.familyCount,evidenceClass},
      details:{...details,baseline:seal.algorithm,paired}};
  }
  if (metricId === "rawReviewerAgreementAlpha") {
    const agreement = metadata!.originalAgreement;
    requireEvidence(agreement.candidates === metadata!.totalPoolItems, "raw_agreement_incomplete_denominator");
    return {status: "derived", reason: null, derived: {value: agreement.value, denominator: agreement.paired, evidenceClass},
      details: {...details, originalAgreement: agreement, taskGroups: metadata!.agreementByGroup}};
  }
  if (metricId === "completePoolLabelCoverage") derived = { value: metadata!.completePoolProfiles / 120, numerator: metadata!.completePoolProfiles, denominator: 120, evidenceClass };
  else if (metricId === "unresolvedLabels") derived = { value: metadata!.unresolvedPoolItems, numerator: metadata!.unresolvedPoolItems, denominator: metadata!.totalPoolItems, evidenceClass };
  else if (metricId === "minimumTaskGroupNdcg5") derived = { value: groupValues.every(value => value !== null) ? Math.min(...groupValues as number[]) : null,
    denominator: Math.min(...groups.map(row => row.scoredFamilyCount)), evidenceClass };
  else derived = { value: metricId === "top5Jaccard" ? summary!.top5SeriesJaccard : metricId === "pooledNdcg5" ? summary!.pooledNdcg5 : summary!.pooledNdcg10,
    denominator: scored.length, evidenceClass };
  return { status: "derived", reason: null, derived, details: { ...details,
    provenance: metadata, metricScope: scoring!.ranking.metricScope, taskGroups: groups,
    noRelevantFamilies: noRelevant.map(row => ({ familyId: row.familyId, profileId: row.profileId, runCount: row.runCount, pooledNdcg5: null, pooledNdcg10: null, emptyOutputRate: row.noRelevantPoolEmptyOutputRate })),
    jaccard: { pairsPerFamily: 10, totalObservedPairs: profiles.reduce((sum, row) => sum + row.runCount * (row.runCount - 1) / 2, 0),
      aggregatedPairs: scored.reduce((sum, row) => sum + row.runCount * (row.runCount - 1) / 2, 0),
      effectiveIndependentFamilies: scored.length, excludedFamilyIds: noRelevant.map(row => row.familyId) } } };
}
const FACT_METRICS = new Set(["factAccuracy","criticalFactErrors","citationPrecision","citationCoverage","criticalCitationCoverage"]);
const PRODUCT_QUALITY_METRICS = new Set([...FACT_METRICS,"abilityInflationOrRevocationFailures","correctionSuccess","expectedCounterfactualResponses","validReasons","hardConstraintViolations","profileMicroF1","profileMinimumSliceF1"]);
function deriveProductQualityMetric(id:string, raw:RawScoringDerivation, openedAt:string|null):MetricDerivation {
  const pending=(reason:string,details?:Record<string,unknown>):MetricDerivation=>({status:"pending",reason,derived:null,details});
  // A failed case keeps overall product acceptance blocked. Its independently
  // verified measurements remain reportable, including the actual errors.
  if (!raw.rawValidated || raw.status==="invalid" || raw.pendingRequirements.includes("independent_ai_review_registration_required"))
    return {status:raw.status,reason:raw.reason,derived:null};
  const registeredAt=raw.rankingMetadata?.registeredAt;
  if(typeof registeredAt!=="string" || !openedAt || !(Date.parse(registeredAt)<=Date.parse(openedAt)))
    return pending("product_metric_protocol_not_registered_before_challenge_open");
  const evidenceClass="ai_proxy" as const;
  if(["abilityInflationOrRevocationFailures","correctionSuccess","expectedCounterfactualResponses"].includes(id)) {
    const audit=raw.stateAudit;
    if (!audit) return pending("preregistered_800_state_obligation_inventory_required");
    const counts=id==="abilityInflationOrRevocationFailures"?[audit.ability,audit.revocation]:
      id==="correctionSuccess"?[audit.correction,audit.version]:[audit.counterfactual];
    if(counts.some(c=>c.expected===0 || c.pending!==0)) return pending("missing_or_unresolved_state_obligations",audit);
    const denominator=counts.reduce((n,c)=>n+c.expected,0);
    const isFailureCount=id==="abilityInflationOrRevocationFailures";
    const numerator=counts.reduce((n,c)=>n+(isFailureCount?c.failed:c.passed),0);
    return {status:"derived",reason:null,derived:{value:isFailureCount?numerator:numerator/denominator,numerator,denominator,evidenceClass},details:audit};
  }
  if(id==="validReasons") {
    const audit=raw.reasonAudit;
    if (!audit?.complete) return pending("complete_600_report_reason_reviews_required",audit);
    return {status:"derived",reason:null,derived:{value:audit.valid/audit.displayed,numerator:audit.valid,denominator:audit.displayed,evidenceClass},details:audit};
  }
  if (FACT_METRICS.has(id)) {
    const audit=raw.factAudit;
    if (!audit?.complete) return pending("complete_preregistered_atomic_fact_reviews_required",audit);
    const counts=audit.counts;
    if (id==="criticalFactErrors" && counts.criticalUnverified) return pending("unverified_critical_facts",audit);
    const ratios:Record<string,[number,number]>={factAccuracy:[counts.accurate,counts.atoms],
      criticalFactErrors:[counts.criticalErrors,counts.factualCases],citationPrecision:[counts.supported,counts.citations],
      citationCoverage:[counts.covered,counts.required],criticalCitationCoverage:[counts.criticalCovered,counts.criticalRequired]};
    const [numerator,denominator]=ratios[id];
    const value=id==="criticalFactErrors"?numerator:denominator?numerator/denominator:null;
    return {status:"derived",reason:null,derived:{value,numerator,denominator,evidenceClass},details:audit};
  }
  if (id==="hardConstraintViolations") {
    const audit=raw.constraintAudit;
    if(!audit?.complete) return pending("complete_constraint_audit_required",audit);
    const count=audit.violations.length;
    return {status:"derived",reason:null,derived:{value:count,numerator:count,denominator:audit.assessed,evidenceClass},details:audit};
  }
  const atoms=raw.profileAtoms;
  if (!atoms?.complete) return pending("complete_preregistered_profile_atom_reviews_required",atoms);
  const micro=id==="profileMicroF1";
  return {status:"derived",reason:null,derived:{value:micro?atoms.microF1:atoms.minimumSliceF1,
    denominator:micro?atoms.total.cases:Math.min(...atoms.slices.map(row=>row.cases)),evidenceClass},details:atoms};
}
function deriveMetricInternal(metricId: string, metric: MetricEvidence, input: AcceptanceInput, root: string, rawReplay: () => RawScoringDerivation): MetricDerivation {
  try {
    const reader = new ArtifactReader(root);
    const envelope = reader.read({ path: metric.evidencePath, sha256: metric.evidenceSha256 }).value;
    const schema = ACCEPTANCE_METRIC_DERIVERS[metricId as keyof typeof ACCEPTANCE_METRIC_DERIVERS];
    if (!schema) return { status: "pending", reason: "raw_metric_deriver_unavailable", derived: null };
    if (RANKING_METRICS.has(metricId) && !input.rawScoringEvidence)
      return { status: "pending", reason: "ranking_raw_scoring_evidence_required", derived: null };
    requireEvidence(envelope.schemaVersion === schema, "artifact_schema_not_authorized_for_metric");
    let result: MetricDerivation;
    if (PRODUCT_QUALITY_METRICS.has(metricId)) {
      requireEvidence(input.rawScoringEvidence && metric.evidencePath===input.rawScoringEvidence.path &&
        metric.evidenceSha256===input.rawScoringEvidence.sha256,"product_metric_not_exact_raw_scoring_reference");
      result=deriveProductQualityMetric(metricId,rawReplay(),input.challengeManifest.openedAt);
      if (result.status!=="derived") return result;
    } else if (RANKING_METRICS.has(metricId)) {
      requireEvidence(input.rawScoringEvidence && metric.evidencePath === input.rawScoringEvidence.path
        && metric.evidenceSha256 === input.rawScoringEvidence.sha256, "ranking_metric_not_exact_raw_scoring_reference");
      result = deriveRankingMetric(metricId, rawReplay(), input, reader);
      if (result.status !== "derived") return result;
    } else result = { status: "derived", reason: null, derived: metricId === "actualModelRuns" ? deriveActualModelRuns(envelope, reader, input) : deriveBrowserPerformance(metricId, envelope, reader, input) };
    const derived = result.derived!;
    requireEvidence(metric.value === derived.value && metric.denominator === derived.denominator
      && metric.evidenceClass === derived.evidenceClass
      && (metric.numerator === undefined || metric.numerator === derived.numerator), "claimed_metric_differs_from_raw_derivation");
    return result;
  } catch (error) {
    if(error instanceof PendingRawEvidence || (error as NodeJS.ErrnoException)?.code === "ENOENT")return {status:"pending",reason:error instanceof PendingRawEvidence?error.message:"raw_artifact_missing",derived:null};
    return { status: "invalid", reason: error instanceof Error && /^[a-zA-Z0-9_:]+$/.test(error.message) ? error.message : "unreadable_or_invalid_raw_artifact", derived: null };
  }
}
/** Always reads/replays raw files; no public argument accepts computed proof. */
export function deriveMetricArtifact(metricId: string, metric: MetricEvidence, input: AcceptanceInput, root: string): MetricDerivation {
  return deriveMetricInternal(metricId, metric, input, root, () => replayRawScoring(input, root));
}
/** Reuse only within this invocation. Nothing is cached across calls or exposed
 * as a caller-provided result/callback; subsequent file mutation is revalidated. */
export function deriveAcceptanceArtifacts(input: AcceptanceInput, root: string) {
  const executionDerivation = replayRawScoring(input, root);
  const artifactDerivations = Object.fromEntries(Object.entries(input.metrics).map(([id, metric]) =>
    [id, deriveMetricInternal(id, metric, input, root, () => executionDerivation)]));
  return { executionDerivation, artifactDerivations };
}

/** Reuse the product's real profile/clock/response validators, then require the actual production artifacts. */
function deriveBrowserPerformance(metricId:string,envelope:JsonObject,reader:ArtifactReader,input:AcceptanceInput):DerivedMetric {
  const get=(key:string)=>{if(!envelope[key])throw new PendingRawEvidence("performance_raw_evidence_missing");return reader.read(reference(envelope[key]));};
  const challenge=get("challengeManifest");
  requireEvidence(same(challenge.value,input.challengeManifest),"performance_challenge_binding_mismatch");
  const registration=get("registration"),review=get("profileReview"),runtime=get("runtime"),before=get("implementationBefore"),after=get("implementationAfter");
  requireEvidence(before.file!==after.file,"distinct_before_after_source_artifacts_required");
  const registered=registration.value;
  performanceTools.validatePerformanceRegistration(registered);
  requireEvidence(registered.purpose==="formal" && registered.implementationSha256===input.challengeManifest.implementationSha256,"formal_performance_final_implementation_required");
  requireEvidence(byteHash(review.bytes)===registered.profileIndependenceReviewSha256,"performance_review_bytes_mismatch");
  performanceTools.validatePerformanceProfileReview(registered,review.value);
  for(const snapshot of [before,after]) {
    requireEvidence(snapshot.value.implementationSha256===registered.implementationSha256
      && acceptanceCanonicalHash(snapshot.value.files)===registered.implementationSha256,"performance_source_snapshot_mismatch");
    const entries=array(snapshot.value.files).map(reference);
    requireEvidence(entries.length>0&&new Set(entries.map(entry=>entry.path)).size===entries.length,"complete_performance_source_inventory_required");
    for(const entry of entries)reader.bytes(entry);
  }
  const runtimeBefore=get("runtimeConfigurationBefore"),runtimeAfter=get("runtimeConfigurationAfter");
  requireEvidence(runtimeBefore.file!==runtimeAfter.file,"distinct_before_after_runtime_artifacts_required");
  for(const artifact of [runtimeBefore,runtimeAfter]) {
    const configuration=object(artifact.value.configuration),values=object(configuration.values);
    requireEvidence(configuration.schemaVersion==="saitu.runtime-configuration.v1"
      && same(Object.keys(values).sort(),[...RUNTIME_CONTROL_KEYS].sort())
      && acceptanceCanonicalHash(configuration)===artifact.value.runtimeConfigurationSha256
      && artifact.value.runtimeConfigurationSha256===registered.runtimeConfigurationSha256,"performance_runtime_binding_mismatch");
    requireEvidence(values.NODE_ENV==="production"&&values.AI_PROVIDER==="deepseek"&&values.AI_REASONING_EFFORT==="max"
      && values.AI_SPEND_PHASE==="performance"&&values.AI_TEST_MODE!=="1"&&values.ALLOW_AI_MOCK!=="1","real_performance_runtime_required");
  }
  requireEvidence(same(runtimeBefore.value,runtimeAfter.value),"performance_runtime_changed");
  const controls=object(object(runtimeBefore.value.configuration).values),rt=runtime.value,db=object(rt.database);
  const selectedMethod=({A1:"rules",B:"hybrid",C:"llm"} as const)[input.selectedAlgorithm];
  requireEvidence(selectedMethod&&(controls.SAITU_DECISION_STRATEGY??"rules")===selectedMethod
    &&rt.strategy===selectedMethod,"performance_selected_algorithm_runtime_mismatch");
  requireEvidence(rt.mode==="real_product"&&rt.provider==="deepseek"&&rt.effort==="max"
    && rt.implementationSha256===registered.implementationSha256&&rt.recommendationWarmup===false
    && typeof db.database==="string"&&String(db.database).length>0&&typeof db.version==="string"
    && db.spendRunId===controls.AI_SPEND_RUN_ID,"real_production_pg_runtime_required");
  const buildArtifacts=get("buildArtifacts"),buildRows=array(buildArtifacts.value.files).map(object);
  const buildEntry=(name:string,sourcePath:string)=>{
    const matches=buildRows.filter(row=>row.path===`build/${name}`&&row.sourcePath===sourcePath);
    requireEvidence(matches.length===1,"production_build_inventory_incomplete");
    return reader.bytes(reference(matches[0]),path.dirname(buildArtifacts.file));
  };
  const buildId=buildEntry("BUILD_ID",".next-performance/BUILD_ID").bytes.toString("utf8").trim();
  const required=object(JSON.parse(buildEntry("required-server-files.json",".next-performance/required-server-files.json").bytes.toString("utf8")));
  const buildManifest=object(JSON.parse(buildEntry("build-manifest.json",".next-performance/build-manifest.json").bytes.toString("utf8")));
  buildEntry("next-env.d.ts","next-env.d.ts");
  requireEvidence(buildArtifacts.value.buildId===buildId,"production_build_id_mismatch");
  requireEvidence(buildId.length>0&&buildId===rt.buildId&&required.version===1&&Array.isArray(required.files)
    && required.files.length>0&&typeof required.config==="object"&&typeof buildManifest.pages==="object"
    && Object.keys(object(buildManifest.pages)).length>0,"production_build_originals_required");
  const ledgerBefore=get("ledgerBefore").value,ledgerAfter=get("ledgerAfter").value;
  for(const ledger of [ledgerBefore,ledgerAfter]) {
    requireEvidence(ledger.schemaVersion==="saitu.spend-ledger-snapshot.v1"&&ledger.transaction==="repeatable_read_read_only"
      && ledger.runId===db.spendRunId&&array(ledger.authority).length===1
      && object(array(ledger.authority)[0]).singleton===true&&object(array(ledger.authority)[0]).run_id===db.spendRunId,"performance_pg_ledger_originals_required");
  }
  const oldRows=readLedgerSnapshot(ledgerBefore),afterRows=readLedgerSnapshot(ledgerAfter),newRows=new Map(afterRows.map(row=>[row.id,row]));
  requireEvidence(oldRows.every(row=>newRows.has(row.id)),"performance_pg_history_removed");
  requireEvidence(same(ledgerBefore.authority,ledgerAfter.authority)&&same(ledgerBefore.configuration,ledgerAfter.configuration)
    &&same(ledgerBefore.budgets,ledgerAfter.budgets),"performance_pg_authority_or_limits_changed");
  // Start the measurement only after earlier calls have settled. Concurrent
  // changes to historical calls make this before/after evidence ambiguous.
  requireEvidence(oldRows.every(row=>same(row,newRows.get(row.id))),"performance_pg_history_changed");
  for(const row of afterRows)if(row.run_id===db.spendRunId){
    if(row.state==="usage_estimated")validateLiveUsageAmount(row);
    else if(row.state==="reserved"||row.state==="conservative"){
      if(row.model!=="deepseek-flash"||row.price_version!==LIVE_PRICE_VERSION)throw new PendingRawEvidence("live_usage_price_snapshot_unrecognized");
      requireEvidence(ledgerOccupancy(row)>BigInt(0)&&ledgerOccupancy(row)===ledgerInteger(row.reserved_micros),"performance_unknown_usage_hold_reduced");
    }
  }
  const pgLedger=object(db.ledger),mainBefore=oldRows.filter(row=>row.run_id===db.spendRunId);
  requireEvidence(pgLedger.calls===mainBefore.length&&String(pgLedger.accounted_micros??0)===mainBefore.reduce((sum,row)=>sum+ledgerOccupancy(row),BigInt(0)).toString(),"runtime_pg_query_not_bound_to_snapshot");
  const registeredJourneys=array(registered.journeys).map(object),rows=array(envelope.rows).map(ref=>reader.read(reference(ref)).value);
  if(!envelope.serverLog)throw new PendingRawEvidence("performance_original_server_log_required");
  const accounting=performanceTools.readAccountingTrace(reader.bytes(reference(envelope.serverLog)).bytes.toString("utf8"));
  const oldIds=new Set(oldRows.map(row=>row.id)),usedReservations=new Set<unknown>(),responseIds=new Set<unknown>();
  requireEvidence(rows.length===registeredJourneys.length,"performance_raw_rows_missing");
  const journeyMap=new Map(registeredJourneys.map(row=>[row.journeyId,row]));
  const beforeTime=Date.parse(text(ledgerBefore.observedAt)),afterTime=Date.parse(text(ledgerAfter.observedAt));
  for(const row of rows) {
    const journey=journeyMap.get(row.journeyId);
    requireEvidence(journey&&row.profileId===journey.profileId&&row.flow===journey.flow&&row.viewport===journey.viewport
      && row.profileInputSha256===acceptanceCanonicalHash(journey.profileInput),"performance_raw_journey_binding_mismatch");
    requireEvidence(Number.isFinite(beforeTime)&&Number.isFinite(afterTime)&&Date.parse(text(row.startedAt))>=beforeTime
      && Date.parse(text(row.finishedAt))<=afterTime&&Date.parse(text(row.finishedAt))>=Date.parse(text(row.startedAt)),"performance_pg_observation_time_mismatch");
    if(row.status!=="observed")continue; // Failures remain in the product summarizer's denominator.
    const requests=array(row.requests).map(object),responses=array(row.responses).map(object),clock=object(object(row.browserClock).clock);
    requireEvidence(requests.some(request=>request.path==="/api/competitions/recommend/normalize"&&request.method==="POST")
      && requests.some(request=>request.path==="/api/ai/competition-recommend"&&request.method==="POST")
      && responses.length>0&&array(row.errors).length===0&&row.horizontalOverflow===false,"performance_real_http_trace_required");
    const last=responses.at(-1)!,boundary=object(clock.boundary);
    const report=decisionReportSchema.safeParse(last.report);
    requireEvidence(report.success,"performance_complete_report_required");
    if(report.success)requireEvidence(report.data.trace.method===selectedMethod
      ||selectedMethod!=="rules"&&report.data.trace.method==="rules"&&report.data.fallback.used===true
        &&typeof report.data.fallback.reason==="string"&&report.data.fallback.reason.trim().length>0,
    "performance_selected_algorithm_report_mismatch");
    if(report.success&&report.data.trace.method==="llm")requireEvidence(report.data.trace.model==="deepseek-flash"
      &&report.data.trace.reasoningEffort==="max"&&report.data.trace.callCount>0
      &&report.data.trace.verification==="model_reviewed","performance_real_max_model_trace_required");
    const started=Date.parse(text(row.startedAt)),finished=Date.parse(text(row.finishedAt));
    requireEvidence(requests.every(request=>typeof request.at==="number"&&Number.isFinite(request.at)&&request.at>=started&&request.at<=finished)
      &&typeof last.at==="number"&&last.at>=started&&last.at<=finished
      &&typeof boundary.clickAt==="number"&&boundary.clickAt>=started
      &&typeof boundary.requestAt==="number"&&boundary.clickAt<=boundary.requestAt
      &&requests.some(request=>request.path==="/api/competitions/recommend/normalize"&&request.at===boundary.requestAt)
      &&requests.some(request=>request.path==="/api/ai/competition-recommend"&&Number(request.at)>=Number(boundary.requestAt)
        &&Number(request.at)<=Number(last.at)),"performance_raw_http_timeline_invalid");
    const recommendationRequest=requests.filter(request=>request.path==="/api/ai/competition-recommend"&&request.method==="POST");
    requireEvidence(recommendationRequest.length===1&&typeof last.requestId==="string"&&last.requestId.length>0
      &&!responseIds.has(last.requestId),"performance_unique_recommendation_request_required");
    responseIds.add(last.requestId);
    const events=accounting.filter(event=>event.requestId===last.requestId);
    requireEvidence(events.every(event=>Date.parse(text(event.time))>=Number(recommendationRequest[0].at)
      &&Date.parse(text(event.time))<=Number(last.at)),"performance_accounting_event_outside_request");
    const dispatches=events.filter(event=>event.type==="ai_transport_dispatch");
    requireEvidence(report.success&&dispatches.length===report.data.trace.callCount,"performance_trace_dispatch_count_mismatch");
    if(report.success&&dispatches.length)requireEvidence(report.data.trace.model==="deepseek-flash"
      &&report.data.trace.reasoningEffort==="max","performance_real_max_model_trace_required");
    for(const event of dispatches) {
      const dispatch=object(event.details),id=dispatch.reservationId,ledger=newRows.get(id);
      const reservation=events.filter(e=>e.type==="ai_budget_reserved"&&object(e.details).reservationId===id);
      const settlement=events.filter(e=>e.type==="ai_budget_settled"&&object(e.details).reservationId===id);
      requireEvidence(!oldIds.has(id)&&!usedReservations.has(id)&&ledger&&ledger.run_id===db.spendRunId
        &&ledger.phase==="performance"&&ledger.model==="deepseek-flash"&&ledger.effort==="max"
        &&dispatch.model===ledger.model&&dispatch.operation===ledger.operation&&reservation.length===1,
      "performance_dispatch_ledger_binding_mismatch");
      usedReservations.add(id);
      const held=object(reservation[0].details);
      requireEvidence(held.model===ledger!.model&&held.effort===ledger!.effort&&held.phase===ledger!.phase
        &&held.priceVersion===ledger!.price_version&&held.reservedMicros===Number(ledgerInteger(ledger!.reserved_micros))
        &&Date.parse(text(reservation[0].time))<=Date.parse(text(event.time)),"performance_reservation_metadata_mismatch");
      requireEvidence(Date.parse(text(ledger!.created_at))>=Number(recommendationRequest[0].at)
        &&Date.parse(text(ledger!.created_at))<=Date.parse(text(event.time)),"performance_ledger_call_time_mismatch");
      if(ledger!.state==="reserved")requireEvidence(settlement.length===0
        &&events.some(e=>e.type==="ai_settlement_failed"&&object(e.details).reservationId===id),"performance_unsettled_call_unexplained");
      else {
        requireEvidence(settlement.length===1&&["usage_estimated","conservative"].includes(String(ledger!.state)),"performance_dispatched_call_not_accounted");
        const settled=object(settlement[0].details);
        requireEvidence(settled.state===ledger!.state&&settled.upstreamAttempted===true
          &&settled.priceVersion===ledger!.price_version&&settled.chargedMicros===Number(ledgerOccupancy(ledger!))
          &&Date.parse(text(settlement[0].time))>=Date.parse(text(event.time)),"performance_settlement_metadata_mismatch");
      }
    }
    if(report.success&&dispatches.length){
      const callRows=dispatches.map(event=>newRows.get(object(event.details).reservationId)!);
      const trace=report.data.trace;
      requireEvidence(callRows.every(row=>row.price_version===trace.priceVersion),"performance_trace_price_version_mismatch");
      if(callRows.every(row=>row.state==="usage_estimated")){
        const sum=(field:string)=>callRows.reduce((total,row)=>total+ledgerInteger(row[field]),BigInt(0));
        const inputTokens=sum("input_tokens"),outputTokens=sum("output_tokens"),cachedInputTokens=sum("cached_input_tokens");
        requireEvidence([inputTokens,outputTokens,cachedInputTokens].every(value=>value<=BigInt(Number.MAX_SAFE_INTEGER)),"performance_trace_usage_outside_safe_integer");
        const aggregate=repriceLiveLedgerUsage({...callRows[0],input_tokens:inputTokens.toString(),output_tokens:outputTokens.toString(),cached_input_tokens:cachedInputTokens.toString()});
        // Report cost rounds once over aggregate usage; the ledger rounds each
        // individual call. Compare each to its own exact, documented basis.
        requireEvidence(trace.inputTokens===Number(inputTokens)&&trace.outputTokens===Number(outputTokens)
          &&trace.cachedInputTokens===Number(cachedInputTokens)&&trace.costCny===Number(aggregate)/1_000_000
          &&trace.costStatus==="usage_upper_bound","performance_trace_usage_or_cost_mismatch");
      }else requireEvidence(trace.inputTokens===null&&trace.outputTokens===null&&trace.cachedInputTokens===null
        &&trace.costCny===null&&trace.costStatus==="unknown","performance_unknown_usage_claimed_known");
    }
    // Epoch timestamps from HTTP and the browser monotonic clock must both
    // place visible report content after the final response has arrived.
    requireEvidence(typeof clock.responseAt==="number"&&Number.isFinite(clock.responseAt)
      &&typeof clock.start==="number"&&clock.responseAt>=clock.start
      &&typeof clock.first==="number"&&typeof clock.full==="number"&&clock.full>=clock.first
      &&clock.first>=clock.responseAt-clock.start
      &&clock.first+5>=Number(last.at)-Number(boundary.clickAt),"performance_paint_precedes_response");
    requireEvidence(same(clock.expected,last.report)&&object(clock.boundary).requestAt!==undefined
      && array(clock.clicks).map(object).some(click=>click.perf===clock.start&&click.at===object(clock.boundary).clickAt
        && click.registeredClick===true&&click.trustedClick===true),"performance_raw_click_response_binding_required");
  }
  const summary=performanceTools.summarizePerformance(registered,rows);
  // An invalid profile or clock cannot be hidden by providing a convenient scalar; it is an infinite observation.
  const value=summary[metricId==="firstScreenP95Ms"?"firstDecisionP95Ms":"fullReportP95Ms"];
  requireEvidence(value===null||typeof value==="number"&&Number.isFinite(value),"invalid_derived_performance_quantile");
  return {value:value as number|null,denominator:registeredJourneys.length,evidenceClass:"real_product"};
}

export const LOCKED_LEDGER_BASELINE_SHA256="b060c9199cffa7123e9fd7534a2de4b4402553ae03a9cbc1a113232a1e01d8be";
/** This trust root is deliberately private and empty. Only a separately reviewed release may add
 * a finite historical registration. Neither an acceptance envelope, env var nor a test hook can add entries. */
type TrustedSyntheticOrigin = Readonly<{ reservationId:string; baselineRowSha256:string;
  registration:ArtifactReference; fixtureClosure:ArtifactReference; originalExecution:ArtifactReference }>;
const TRUSTED_SYNTHETIC_LEDGER_ORIGINS:readonly TrustedSyntheticOrigin[]=Object.freeze([]);
const LIVE_PRICE_VERSION="deepseek-flash-cny-20261105-peak-upper-bound";

/** Exact micro-CNY: 2 uncached + 1/25 cached + 8 output. No floating-point rounding. */
export function repriceLiveLedgerUsage(row:Record<string,unknown>):string {
  if(row.model!=="deepseek-flash"||row.price_version!==LIVE_PRICE_VERSION)throw new PendingRawEvidence("live_usage_price_snapshot_unrecognized");
  const tokens=[row.input_tokens,row.output_tokens,row.cached_input_tokens].map(ledgerInteger);
  requireEvidence(tokens.every(value=>value<=BigInt(Number.MAX_SAFE_INTEGER)),"live_usage_token_count_not_safe_integer");
  const [input,output,cached]=tokens;
  requireEvidence(cached<=input,"live_usage_cached_tokens_exceed_input");
  return (((input-cached)*BigInt(50)+cached+output*BigInt(200)+BigInt(24))/BigInt(25)).toString();
}
function validateLiveUsageAmount(row:JsonObject) {
  const expected=BigInt(repriceLiveLedgerUsage(row));
  requireEvidence(ledgerInteger(row.charged_micros)===expected,"live_usage_charge_price_mismatch");
  requireEvidence(expected<=ledgerInteger(row.reserved_micros),"live_usage_exceeds_reserved_upper_bound");
  return expected;
}
function trustedSyntheticOrigin(row:JsonObject,baselineRow:JsonObject|undefined,reader:ArtifactReader):boolean {
  const entry=TRUSTED_SYNTHETIC_LEDGER_ORIGINS.find(item=>item.reservationId===row.id);
  if(!entry||!baselineRow)return false;
  requireEvidence(entry.baselineRowSha256===acceptanceCanonicalHash(baselineRow)
    &&entry.baselineRowSha256===acceptanceCanonicalHash(row),"trusted_synthetic_history_row_changed");
  const registration=reader.read(entry.registration).value;
  requireEvidence(registration.schemaVersion==="saitu.sealed-synthetic-origin-registration.v1"
    &&registration.reservationId===row.id&&registration.ledgerRowSha256===entry.baselineRowSha256
    &&registration.fixtureClosureSha256===entry.fixtureClosure.sha256
    &&registration.originalExecutionSha256===entry.originalExecution.sha256,"trusted_synthetic_registration_mismatch");
  const closure=reader.read(entry.fixtureClosure).value,execution=reader.read(entry.originalExecution).value;
  const files=array(closure.files).map(reference);
  requireEvidence(closure.schemaVersion==="saitu.synthetic-fixture-source-closure.v1"&&files.length>0
    &&new Set(files.map(file=>file.path)).size===files.length,"trusted_synthetic_fixture_closure_required");
  for(const file of files)reader.bytes(file);
  requireEvidence(execution.schemaVersion==="saitu.sealed-ledger-fixture-execution.v1"
    &&execution.fixtureClosureSha256===entry.fixtureClosure.sha256&&array(execution.reservationIds).includes(row.id)
    &&execution.networkIsolation==="externally_enforced_deny_all"&&array(execution.upstreamDispatches).length===0,
  "trusted_synthetic_original_execution_mismatch");
  return true;
}
export type BudgetDerivation={status:"derived"|"pending"|"invalid";reason:string|null;derived:AcceptanceInput["budget"]|null;details:Record<string,unknown>};
function ledgerInteger(value:unknown):bigint {
  requireEvidence(typeof value==="string"&&/^\d+$/.test(value),"invalid_ledger_integer");return BigInt(value as string);
}
function ledgerOccupancy(row:JsonObject):bigint{return ledgerInteger(row.charged_micros??row.reserved_micros);}
function readLedgerSnapshot(value:JsonObject) {
  requireEvidence(value.schemaVersion==="saitu.spend-ledger-snapshot.v1"&&value.transaction==="repeatable_read_read_only","complete_read_only_ledger_snapshot_required");
  const rows=array(value.ledger).map(object),ids=new Set(rows.map(row=>row.id));
  requireEvidence(ids.size===rows.length,"duplicate_ledger_reservation");
  for(const row of rows) {
    text(row.id);text(row.run_id);ledgerInteger(row.reserved_micros);ledgerOccupancy(row);
    requireEvidence(["reserved","conservative","usage_estimated","cancelled"].includes(String(row.state)),"unknown_ledger_state");
    if(row.state==="usage_estimated") {
      const tokens=[row.input_tokens,row.output_tokens,row.cached_input_tokens];
      requireEvidence(row.charged_micros!==null&&(tokens.every(value=>value===null)||tokens.every(value=>typeof value==="string"&&/^\d+$/.test(value))),"ledger_usage_incomplete");
      if(tokens.every(value=>value!==null))requireEvidence(ledgerInteger(row.cached_input_tokens)<=ledgerInteger(row.input_tokens),"ledger_usage_incomplete");
    }
    if(row.state==="cancelled")requireEvidence(row.charged_micros==="0","cancelled_ledger_charge_not_zero");
  }
  return rows;
}
/** Preserve every historical row; only independently evidenced synthetic no-dispatch rows may leave the provider-budget scope. */
export function deriveBudgetArtifact(input:AcceptanceInput,root:string):BudgetDerivation {
  let derived:AcceptanceInput["budget"]|null=null;const details:Record<string,unknown>={providerInvoiceCny:null,accountingBasis:"historical_rows_preserved_provider_scope_requires_bound_source_review_not_invoice"};
  try {
    if(!input.budgetEvidence)return {status:"pending",reason:"raw_ledger_evidence_required",derived,details};
    const reader=new ArtifactReader(root),envelope=reader.read(input.budgetEvidence).value;
    requireEvidence(envelope.schemaVersion==="saitu.acceptance-ledger-budget-evidence.v1","budget_evidence_schema_required");
    const baseline=reader.read(reference(envelope.baseline)),snapshot=reader.read(reference(envelope.snapshot));
    requireEvidence(byteHash(baseline.bytes)===LOCKED_LEDGER_BASELINE_SHA256,"locked_ledger_baseline_required");
    const oldRows=readLedgerSnapshot(baseline.value),rows=readLedgerSnapshot(snapshot.value),byId=new Map(rows.map(row=>[row.id,row]));
    const mainOld=oldRows.filter(row=>row.run_id===baseline.value.runId);
    const baselineById=new Map(oldRows.map(row=>[row.id,row]));
    requireEvidence(mainOld.length===48&&mainOld.reduce((sum,row)=>sum+ledgerOccupancy(row),BigInt(0))===BigInt(8664228),"locked_main_history_inventory_mismatch");
    requireEvidence(snapshot.value.runId===baseline.value.runId&&same(snapshot.value.authority,baseline.value.authority)
      && Date.parse(text(snapshot.value.observedAt))>=Date.parse(text(baseline.value.observedAt)),"ledger_authority_or_timeline_changed");
    for(const old of oldRows) {
      const current=byId.get(old.id);
      requireEvidence(current&&["run_id","model","effort","phase","operation","price_version","reserved_micros","created_at"].every(key=>same(current[key],old[key]))
        && ledgerOccupancy(current)>=ledgerOccupancy(old),"historical_ledger_identity_or_occupancy_removed");
    }
    // Check known live rows before any pending origin decision can conceal an underpriced call.
    for(const row of rows)if(row.run_id===baseline.value.runId&&row.state==="usage_estimated")validateLiveUsageAmount(row);
    const controls=object(snapshot.value.configuration),oldControls=object(baseline.value.configuration);
    requireEvidence(typeof controls.hardLimitCny==="number"&&controls.hardLimitCny>0&&controls.hardLimitCny<=300
      && controls.hardLimitCny<=Number(oldControls.hardLimitCny)&&typeof controls.fundedLimitCny==="number"
      && controls.fundedLimitCny>0&&controls.fundedLimitCny<=Number(oldControls.fundedLimitCny),"ledger_cap_or_funding_increased_without_authorization");
    const budgetRows=array(snapshot.value.budgets).map(object),mainBudget=budgetRows.filter(row=>row.run_id===snapshot.value.runId);
    requireEvidence(mainBudget.length===1,"main_ledger_budget_required");
    const maximumCny=Math.min(Number(controls.hardLimitCny),Number(controls.fundedLimitCny),Number(ledgerInteger(mainBudget[0].hard_limit_micros))/1e6);
    let spent=BigInt(0),reserved=BigInt(0),unknown=0,unpriced=0;
    for(const row of rows) {
      if(row.state==="reserved"||row.state==="conservative"){
        reserved+=ledgerOccupancy(row);unknown++;
        if(row.price_version!=="deepseek-flash-cny-20261105-peak-upper-bound"||ledgerOccupancy(row)!==ledgerInteger(row.reserved_micros)||ledgerOccupancy(row)<=BigInt(0))unpriced++;
      }else spent+=ledgerOccupancy(row);
    }
    requireEvidence(spent+reserved<=BigInt(Number.MAX_SAFE_INTEGER),"ledger_amount_outside_safe_integer");
    derived={maximumCny,spentCny:Number(spent)/1e6,reservedCny:Number(reserved)/1e6,unpricedCalls:unpriced};
    Object.assign(details,{rowCount:rows.length,lockedMainRows:48,lockedMainMinimumCny:8.664228,otherRunRows:rows.filter(row=>row.run_id!==snapshot.value.runId).length,incompleteUsageRows:rows.filter(row=>row.state==="usage_estimated"&&row.input_tokens===null).length,unknownUsageCalls:unknown,unpricedCalls:unpriced,unknownOriginCalls:rows.length,unverifiedConservativeBoundCalls:unknown,allTableEvidenceMicros:(spent+reserved).toString(),providerBudgetAccountedMicros:null,provisionalUnreviewedUpperBoundCny:Number(spent+reserved)/1e6});
    if(!envelope.sourceObservations||!envelope.sourceReview)return {status:"pending",reason:"ledger_source_review_required",derived,details};
    const sources=reader.read(reference(envelope.sourceObservations)),review=reader.read(reference(envelope.sourceReview));
    requireEvidence(sources.value.schemaVersion==="saitu.ledger-source-observations.v1"&&review.value.schemaVersion==="saitu.ledger-source-review.v1"
      &&review.value.snapshotSha256===byteHash(snapshot.bytes)&&review.value.baselineSha256===LOCKED_LEDGER_BASELINE_SHA256
      &&review.value.sourceObservationsSha256===byteHash(sources.bytes),"ledger_source_review_binding_mismatch");
    const records=array(sources.value.records).map(object),sourceMap=new Map(records.map(row=>[row.reservationId,row]));
    const reviews=array(review.value.reviews).map(object),contexts=[review.value.authorContextId,...reviews.map(row=>row.contextId)];
    requireEvidence(records.length===rows.length&&sourceMap.size===rows.length&&reviews.length===2
      &&contexts.every(value=>typeof value==="string"&&value.length>0)&&new Set(contexts).size===3,"complete_independent_ledger_review_required");
    const missingBounds=new Set<unknown>(),excluded=new Set<unknown>(),untrustedSynthetic=new Set<unknown>();
    for(const row of rows) {
      const source=sourceMap.get(row.id);
      requireEvidence(source&&source.runId===row.run_id&&["live_provider","synthetic_transport"].includes(String(source.origin)),"ledger_origin_unreviewed");
      const events=array(source!.events).map(object),settled=events.filter(event=>event.type==="ai_budget_settled"),reservations=events.filter(event=>event.type==="ai_budget_reserved");
      const live=row.run_id===baseline.value.runId||source!.origin==="live_provider";
      requireEvidence(row.run_id!==baseline.value.runId||source!.origin==="live_provider","locked_main_origin_cannot_be_synthetic");
      if(!live&&!trustedSyntheticOrigin(row,baselineById.get(row.id),reader))untrustedSynthetic.add(row.id);
      if(live&&row.state==="usage_estimated")validateLiveUsageAmount(row);
      if(live&&["reserved","conservative","usage_estimated"].includes(String(row.state))) {
        if(!source!.requestLimits)missingBounds.add(row.id);
        else {
          const limits=object(source!.requestLimits);
          const numbers=[limits.promptUtf8Bytes,limits.systemUtf8Bytes,limits.outputTokenLimit];
          requireEvidence(numbers.every(value=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0)
            &&Number(limits.outputTokenLimit)>0&&limits.priceVersion===row.price_version,"invalid_conservative_request_limits");
          const upper=(BigInt(Number(limits.promptUtf8Bytes))+BigInt(Number(limits.systemUtf8Bytes))+BigInt(1024))*BigInt(2)+BigInt(Number(limits.outputTokenLimit))*BigInt(8);
          if(row.model!=="deepseek-flash"||row.price_version!==LIVE_PRICE_VERSION)throw new PendingRawEvidence("live_usage_price_snapshot_unrecognized");
          requireEvidence(upper===ledgerInteger(row.reserved_micros),"request_reserved_upper_bound_mismatch");
          if(row.state==="usage_estimated")requireEvidence(ledgerInteger(row.output_tokens)<=BigInt(Number(limits.outputTokenLimit))
            &&ledgerInteger(row.input_tokens)<=BigInt(Number(limits.promptUtf8Bytes))+BigInt(Number(limits.systemUtf8Bytes))+BigInt(1024),"live_usage_exceeds_request_token_limits");
          else requireEvidence(ledgerOccupancy(row)===upper,"conservative_upper_bound_not_fully_held");
        }
      }
      requireEvidence(events.every(event=>object(event.details).reservationId===row.id),"ledger_event_reservation_mismatch");
      if(live)requireEvidence(reservations.length===1
        &&object(reservations[0].details).reservedMicros===Number(ledgerInteger(row.reserved_micros))
        &&object(reservations[0].details).model===row.model&&object(reservations[0].details).effort===row.effort
        &&object(reservations[0].details).phase===row.phase&&object(reservations[0].details).priceVersion===row.price_version,
      "live_reservation_metadata_mismatch");
      if(source!.origin==="live_provider"&&["usage_estimated","conservative"].includes(String(row.state)))requireEvidence(events.some(event=>event.type==="ai_transport_dispatch"
        &&object(event.details).model===row.model&&object(event.details).operation===row.operation),"ledger_live_dispatch_origin_not_supported");
      if(row.state==="reserved")requireEvidence(reservations.length===1&&settled.length===0
        &&object(reservations[0].details).reservedMicros===Number(ledgerInteger(row.reserved_micros)),"raw_ledger_reservation_missing");
      else {
        requireEvidence(settled.length===1&&object(settled[0].details).chargedMicros===Number(ledgerOccupancy(row)),"raw_ledger_settlement_missing");
        const settlement=object(settled[0].details);
        requireEvidence(settlement.state===row.state,"ledger_settlement_state_mismatch");
        if(live) {
          requireEvidence(settlement.priceVersion===row.price_version,"live_settlement_price_version_mismatch");
          requireEvidence(settlement.upstreamAttempted===(row.state!=="cancelled"),"live_settlement_upstream_state_mismatch");
          if(row.state==="cancelled")requireEvidence(!events.some(event=>event.type==="ai_transport_dispatch"),"cancelled_live_row_contains_upstream_dispatch");
          if(row.state==="usage_estimated")requireEvidence(BigInt(Number(settlement.chargedMicros))===validateLiveUsageAmount(row),"live_settlement_repriced_charge_mismatch");
          else requireEvidence(settlement.usage===null,"unknown_or_cancelled_settlement_has_usage");
        }
        if(row.state==="usage_estimated") {
          if(row.input_tokens===null)requireEvidence(source!.origin==="synthetic_transport"&&settlement.usage===null,"live_ledger_usage_metadata_incomplete");
          else requireEvidence(same(settlement.usage,{inputTokens:Number(ledgerInteger(row.input_tokens)),outputTokens:Number(ledgerInteger(row.output_tokens)),cachedInputTokens:Number(ledgerInteger(row.cached_input_tokens))}),"ledger_raw_usage_mismatch");
        }
      }
      const verdicts:string[]=[];
      for(const reviewer of reviews) {
        const decisions=array(reviewer.rows).map(object);
        requireEvidence(decisions.length===rows.length&&new Set(decisions.map(item=>item.reservationId)).size===rows.length,"ledger_review_row_bijection_required");
        const decision=decisions.find(item=>item.reservationId===row.id);
        requireEvidence(decision&&["accounted_without_exclusion","exclude_proven_synthetic_no_dispatch"].includes(String(decision.verdict))&&decision.ledgerRowSha256===acceptanceCanonicalHash(row)
          &&decision.sourceRecordSha256===acceptanceCanonicalHash(source),"ledger_review_row_evidence_mismatch");
        verdicts.push(String(decision!.verdict));
      }
      requireEvidence(new Set(verdicts).size===1,"ledger_source_review_disagreement");
      if(verdicts[0]==="exclude_proven_synthetic_no_dispatch") {
        requireEvidence(row.run_id!==baseline.value.runId,"locked_main_reservations_cannot_be_excluded");
        requireEvidence(source!.origin==="synthetic_transport"&&!events.some(event=>event.type==="ai_transport_dispatch"),"synthetic_exclusion_has_dispatch_evidence");
        // Caller-written source files and deny_all JSON cannot establish this authority.
        // The fixed trust root, not this envelope's reviewer strings, must already authorize the exact row.
        if(!trustedSyntheticOrigin(row,baselineById.get(row.id),reader)) {untrustedSynthetic.add(row.id);continue;}
        excluded.add(row.id);
      }
    }
    if(untrustedSynthetic.size) {
      Object.assign(details,{unknownOriginCalls:untrustedSynthetic.size,excludedProvenSyntheticRows:0,providerBudgetAccountedMicros:null,unverifiedConservativeBoundCalls:missingBounds.size});
      return {status:"pending",reason:"trusted_synthetic_origin_registration_required",derived,details};
    }
    const included=rows.filter(row=>!excluded.has(row.id));
    let providerSpent=BigInt(0),providerReserved=BigInt(0),providerUnknown=0,providerUnpriced=0;
    for(const row of included) {
      if(["reserved","conservative"].includes(String(row.state))) {
        providerReserved+=ledgerOccupancy(row);providerUnknown++;
        if(row.price_version!=="deepseek-flash-cny-20261105-peak-upper-bound"||ledgerOccupancy(row)!==ledgerInteger(row.reserved_micros)||ledgerOccupancy(row)<=BigInt(0))providerUnpriced++;
      } else providerSpent+=ledgerOccupancy(row);
    }
    const remainingBounds=[...missingBounds].filter(id=>!excluded.has(id)).length;
    derived={maximumCny,spentCny:Number(providerSpent)/1e6,reservedCny:Number(providerReserved)/1e6,unpricedCalls:providerUnpriced};
    Object.assign(details,{unknownOriginCalls:0,excludedProvenSyntheticRows:excluded.size,providerBudgetAccountedMicros:(providerSpent+providerReserved).toString(),unknownUsageCalls:providerUnknown,unpricedCalls:providerUnpriced,unverifiedConservativeBoundCalls:remainingBounds});
    if(remainingBounds)return {status:"pending",reason:"ledger_conservative_bound_evidence_required",derived,details};
    if(providerUnpriced)return {status:"pending",reason:"ledger_unpriced_calls_pending",derived,details};
    requireEvidence(same(derived,input.budget),"claimed_budget_differs_from_raw_ledger");
    return {status:"derived",reason:null,derived,details};
  }catch(error){if(error instanceof PendingRawEvidence)return {status:"pending",reason:error.message,derived,details};if((error as NodeJS.ErrnoException)?.code==="ENOENT")return {status:"pending",reason:"raw_ledger_artifact_missing",derived,details};return {status:"invalid",reason:error instanceof Error&&/^[a-zA-Z0-9_:]+$/.test(error.message)?error.message:"invalid_raw_ledger_evidence",derived,details};}
}
