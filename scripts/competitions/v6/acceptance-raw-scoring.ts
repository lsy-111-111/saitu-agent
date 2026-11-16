import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { ReviewerGrade, ordinalAgreement as AgreementFunction } from "./reviewer-agreement";
import type { AcceptanceInput } from "./acceptance-gate";
import type { ArtifactReference } from "./acceptance-artifact-derivation";

// All dependencies are synchronous/pure at import. The Node 24 acceptance CLI
// must not start a runner, open private data implicitly, or dispatch a model.
const require = createRequire(import.meta.url);
const { acceptanceCanonicalHash: hash, deriveMetricArtifact } = require("./acceptance-artifact-derivation.ts") as typeof import("./acceptance-artifact-derivation");
const { ordinalAgreement } = require("./reviewer-agreement.ts") as typeof import("./reviewer-agreement");
const { evaluateRankings } = require("./evaluate-rankings.ts") as typeof import("./evaluate-rankings");
const { scoreProductObservations } = require("./score-product-observations.ts") as typeof import("./score-product-observations");
const { validateFrozenMatrix } = require("./ranking-reuse.mjs") as { validateFrozenMatrix(value: unknown): unknown };
const { summarizeBoundRuns } = require("./frozen-ranking-executor.mjs") as { summarizeBoundRuns(rows: unknown[]): Row };
const {aggregateStateObligations,STATE_AUDIT_PROTOCOL} = require("./state-obligation-audit.ts") as typeof import("./state-obligation-audit");
const {aggregateReasonAudit,REASON_PROTOCOL} = require("./reason-audit.ts") as typeof import("./reason-audit");
const {aggregateFactAudit,FACT_AUDIT_PROTOCOL} = require("./fact-claim-audit.ts") as typeof import("./fact-claim-audit");
const {aggregateConstraintAudit, CONSTRAINT_PROTOCOL} = require("./constraint-audit.ts") as typeof import("./constraint-audit");
const {reconcileProfileGold} = require("./profile-gold.ts") as typeof import("./profile-gold");
const { aggregateProfileAtoms, PROFILE_ATOM_PROTOCOL } = require("./profile-atom-metrics.ts") as typeof import("./profile-atom-metrics");
type Row = Record<string, unknown>;
type CaseResult = { caseId: string; status: string; runs: { status: string }[] };
type CombinedResult = { cases: CaseResult[]; counts: Record<string, number>; ranking: ReturnType<typeof evaluateRankings>; rankingExecution: Row };
export type VerifiedRankingMetadata = {
  rawScoringEvidence: ArtifactReference;
  challengeManifestSha256: string; sourceSnapshotSha256: string;
  implementationSha256: string; configurationSha256: string;
  registrationSha256: string; freezeManifestSha256: string;
  baselineSelection: unknown;
  originalAgreement: ReturnType<typeof AgreementFunction>; agreementByGroup: Record<string, ReturnType<typeof AgreementFunction>>;
  aggregationProtocol: unknown; registeredAt: unknown; openedAt: unknown; startedAt: unknown; completedAt: unknown;
  profileCount: number; totalPoolItems: number; unresolvedPoolItems: number; completePoolProfiles: number;
};
export type RawScoringDerivation = {
  status: "derived" | "pending" | "invalid"; reason: string | null;
  rawValidated: boolean; execution: { caseId: string; status: string }[];
  scoring: CombinedResult | null; pendingRequirements: string[];
  profileAtoms?: ReturnType<typeof aggregateProfileAtoms>;
  constraintAudit?: ReturnType<typeof aggregateConstraintAudit>;
  factAudit?: ReturnType<typeof aggregateFactAudit>;
  reasonAudit?: ReturnType<typeof aggregateReasonAudit>;
  stateAudit?: ReturnType<typeof aggregateStateObligations>;
  rankingMetadata?: VerifiedRankingMetadata;
};
const object = (value: unknown): Row => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("raw_scoring_object_required");
  return value as Row;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("raw_scoring_array_required");
  return value;
};
const rows = (value: unknown) => array(value).map(object);
const text = (value: unknown): string => {
  if (typeof value !== "string" || !value) throw new Error("raw_scoring_string_required");
  return value;
};
function check(condition: unknown, reason: string): asserts condition { if (!condition) throw new Error(reason); }
const same = (left: unknown, right: unknown) => hash(left) === hash(right);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
// The product runner uses the modulo LCG shuffle; ranking candidate shuffles
// use a different index conversion. Preserve the actual registered contract.
function productExecutionOrder<T>(values: T[], seed: number): T[] {
  const result = [...values]; let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const selected = state % (index + 1); [result[index], result[selected]] = [result[selected], result[index]];
  }
  return result;
}
const ref = (value: unknown): ArtifactReference => {
  const row = object(value); check(Object.keys(row).sort().join(",") === "path,sha256" && validHash(row.sha256), "raw_scoring_reference_invalid");
  return { path: text(row.path), sha256: row.sha256 };
};
class Reader {
  root: string;
  constructor(root: string) { this.root = realpathSync(root); }
  read(reference: ArtifactReference, relative = this.root) {
    const file = path.resolve(relative, reference.path);
    check(file.startsWith(this.root + path.sep), "raw_scoring_path_escape");
    const real = realpathSync(file); check(real.startsWith(this.root + path.sep), "raw_scoring_symlink_escape");
    const bytes = readFileSync(real); check(sha(bytes) === reference.sha256, "raw_scoring_bytes_changed");
    return { file: real, bytes, json: () => JSON.parse(bytes.toString("utf8")) as unknown,
      jsonl: () => bytes.toString("utf8").split("\n").filter(line => line.trim()).map(line => object(JSON.parse(line))) };
  }
}

/** Finite reviewed entries only. No envelope flag, environment variable or test
 * hook can register itself. A separated AI review is sufficient; human review
 * or a different filesystem is NOT required for the agreed AI-proxy mode.
 * Before adding an entry, an independent agent must audit the raw execution,
 * source/answer provenance and blind context isolation, then freeze its report
 * and exact binding digest outside the submitted envelope. The report SHA is
 * pinned here after that review; strings naming two reviewers are insufficient.
 */
type TrustedReview = Readonly<{ bindingSha256: string; report: ArtifactReference; reportSha256: string }>;
const TRUSTED_SCORING_REVIEWS: readonly TrustedReview[] = Object.freeze([]);

export function mergeOriginalPoolReviews(original: Row[], reviews: Row[], profiles: Map<string, Row>, challenge: AcceptanceInput["challengeManifest"], sourceSha: string) {
  const manifest = new Map(challenge.cases.map(row => [row.caseId, row]));
  check(reviews.every(review => profiles.has(text(review.profileId))), "ranking_review_extra_profile");
  return original.map(pool => {
    const profile = profiles.get(text(pool.profileId))!, item = manifest.get(text(profile.caseId))!;
    const relevant = reviews.filter(review => review.profileId === pool.profileId);
    const role = (name: string) => relevant.filter(review => review.role === name);
    check(relevant.every(review => ["reviewer_a", "reviewer_b", "adjudicator"].includes(String(review.role)))
      && ["reviewer_a", "reviewer_b", "adjudicator"].every(name => role(name).length <= 1), "ranking_review_duplicate_or_unknown_role");
    const identities = rows(pool.judgments).map(({ itemId, seriesId }) => ({ itemId, seriesId }));
    for (const review of relevant) {
      const expectedContext = review.role === "reviewer_a" ? item.reviewerContextIds[0] : review.role === "reviewer_b" ? item.reviewerContextIds[1] : item.adjudicatorContextId;
      check(review.contextId === expectedContext && review.caseId === item.caseId && review.keySha256 === item.answerSha256
        && review.inputSha256 === item.inputSha256 && review.sourceSnapshotSha256 === sourceSha
        && review.poolSha256 === hash(identities), "ranking_review_provenance_mismatch");
      const judgments = rows(review.judgments);
      check(new Set(judgments.map(row => row.itemId)).size === judgments.length
        && judgments.every(row => identities.some(identity => same(identity, { itemId: row.itemId, seriesId: row.seriesId })) && [0, 1, 2, 3, "U"].includes(row.relevance as string | number)), "ranking_review_invalid_pool_labels");
    }
    const left = role("reviewer_a")[0], right = role("reviewer_b")[0], adjudicator = role("adjudicator")[0];
    if (adjudicator) check(left && right && same(adjudicator.resolvesReviewSha256, [hash(left), hash(right)]), "ranking_adjudication_not_bound_to_both_reviews");
    const judgments = identities.map(identity => {
      const grade = (review: Row | undefined) => review ? rows(review.judgments).find(row => row.itemId === identity.itemId)?.relevance : undefined;
      const a = grade(left), b = grade(right);
      const final = a === undefined || b === undefined ? "U" : a === b ? a : grade(adjudicator);
      return { ...identity, relevance: final ?? "U" };
    });
    return { ...pool, profileId: text(pool.profileId), taskGroup: text(pool.taskGroup), judgments, annotationStatus: left && right && judgments.every(row => row.relevance !== "U") ? "ai_blind_reviewed" : "pending" };
  });
}

/** Only supplied raw references are read. Caller execution/status/count fields
 * never participate. Raw-valid synthetic data remains pending until separately
 * reviewed exact provenance is in the finite internal registration above. */
export function deriveSealedExecution(input: AcceptanceInput, root: string): RawScoringDerivation {
  const empty = (status: RawScoringDerivation["status"], reason: string): RawScoringDerivation => ({ status, reason, rawValidated: false, execution: [], scoring: null, pendingRequirements: [reason] });
  if (!input.rawScoringEvidence) return empty("pending", "raw_scoring_deriver_unavailable");
  if (input.mode !== "ai_proxy") return empty("pending", "human_raw_scoring_protocol_not_implemented");
  try {
    check(input.challengeManifest.cases.length === 800 && new Set(input.challengeManifest.cases.map(item => item.caseId)).size === 800
      && input.selectedReasoningEffort === "max" && input.recallsTrimmed === false, "raw_scoring_complete_max_full_challenge_required");
    const reader = new Reader(root), envelopeRef = ref(input.rawScoringEvidence), envelope = object(reader.read(envelopeRef).json());
    check(envelope.schemaVersion === "saitu.acceptance-raw-scoring.v1", "unsupported_raw_scoring_envelope");
    const required = ["dispatchEvidence", "rankingInput", "productRegistration", "productOpening", "productCases", "productObservations", "executionOrder", "implementationBefore", "implementationAfter", "runtimeBefore", "runtimeAfter", "executionIntegrity", "answers", "sourceSnapshot", "semanticReviews", "rankingReviews"];
    check(Object.keys(envelope).every(key => key === "schemaVersion" || key === "factReviews" || key === "reasonReviews" || key === "stateReviews" || required.includes(key)), "raw_scoring_unknown_envelope_field");
    if (required.some(key => envelope[key] === undefined)) return empty("pending", "raw_scoring_original_artifacts_required");
    const artifacts = new Map(required.map(key => [key, reader.read(ref(envelope[key]))]));
    const get = (key: string) => artifacts.get(key)!;
    const dispatchEnvelope = object(get("dispatchEvidence").json());
    check(dispatchEnvelope.schemaVersion === "saitu.acceptance-ranking-dispatch-evidence.v1", "ranking_dispatch_binding_required");
    const challengeRef = ref(dispatchEnvelope.challengeManifest), challenge = object(reader.read(challengeRef).json());
    check(same(challenge, input.challengeManifest), "raw_scoring_challenge_mismatch");
    const freezeRef = ref(dispatchEnvelope.freezeManifest), freezeArtifact = reader.read(freezeRef), freeze = object(freezeArtifact.json()), binding = object(freeze.freezeBinding);
    const frozen = new Map<string, ReturnType<Reader["read"]>>();
    for (const entry of rows(freeze.files)) {
      const reference = ref(entry); check(!frozen.has(reference.path) && !path.isAbsolute(reference.path) && !reference.path.split(/[\\/]/).includes(".."), "raw_scoring_invalid_freeze_inventory");
      frozen.set(reference.path, reader.read(reference, path.dirname(freezeArtifact.file)));
    }
    const frozenGet = (name: string) => { const item = frozen.get(name); check(item, `raw_scoring_missing_frozen:${name}`); return object(item.json()); };
    const originalRanking = frozenGet("ranking-input.json"), profileSnapshot = frozenGet("profiles-snapshot.json"), observed = frozenGet("product-observations.json");
    const matrixObservations = rows(observed.observations), rawProfiles = rows(profileSnapshot.profiles), profiles = new Map(rawProfiles.map(row => [text(row.profileId), row]));
    const dispatchCount = matrixObservations.filter(row => row.algorithm === "C" && rows(row.events).some(event => event.type === "ai_transport_dispatch")).length;
    const dispatchRef = ref(envelope.dispatchEvidence);
    const dispatchValidation = deriveMetricArtifact("actualModelRuns", { value: dispatchCount, denominator: 600, evidenceClass: "live_model", evidencePath: dispatchRef.path, evidenceSha256: dispatchRef.sha256 }, input, root);
    check(dispatchValidation.status === "derived", `raw_scoring_matrix_binding:${dispatchValidation.reason}`);
    validateFrozenMatrix({ profileSnapshot, rankings: originalRanking, observations: matrixObservations, binding, seed: freeze.seed });
    const rankingRegistration = frozenGet("registration.json");
    const registeredRankingInput = object(get("rankingInput").json());
    check(sha(get("rankingInput").bytes) === object(rankingRegistration.config).inputSha256
      && registeredRankingInput.origin === profileSnapshot.origin
      && new Date(text(registeredRankingInput.asOf)).toISOString() === new Date(text(profileSnapshot.asOf)).toISOString()
      && same(rows(registeredRankingInput.profiles).map(({ profileId, caseId, familyId, taskGroup, profile, input }) => ({ profileId, caseId, familyId, taskGroup, profile, input })), rawProfiles),
    "raw_scoring_registered_ranking_input_changed");
    const catalogRecords = rows(frozenGet("catalog-snapshot.json").records);
    const catalogById = new Map(catalogRecords.map(row => [text(row.recordId), row]));
    check(catalogById.size === catalogRecords.length && rows(originalRanking.profiles).every(pool => rows(pool.judgments).every(judgment => catalogById.get(text(judgment.itemId))?.seriesId === judgment.seriesId)), "raw_scoring_pool_catalog_series_mismatch");
    const sourceRef = ref(envelope.sourceSnapshot), sourceIndex = object(get("sourceSnapshot").json());
    check(sourceRef.sha256 === binding.sourceSnapshotSha256 && sourceIndex.schemaVersion === "saitu.sealed-source-index.v2"
      && input.challengeManifest.cases.every(item => item.sourceSnapshotSha256 === sourceRef.sha256), "raw_scoring_source_snapshot_mismatch");
    const sources = rows(sourceIndex.sources).map(source => {
      reader.read({ path: text(source.sourceArtifact), sha256: text(source.sourceByteSha256) }, path.dirname(get("sourceSnapshot").file));
      const body = reader.read({ path: text(source.bodyArtifact), sha256: text(source.bodySha256) }, path.dirname(get("sourceSnapshot").file));
      return { sourceId: text(source.sourceId), scope: text(source.scope), body: body.bytes.toString("utf8"), bodySha256: text(source.bodySha256) };
    });
    check(new Set(sources.map(source => source.sourceId)).size === sources.length, "raw_scoring_duplicate_source");
    const cases = get("productCases").jsonl(), keys = get("answers").jsonl(), semanticReviews = get("semanticReviews").jsonl(), rankingReviews = get("rankingReviews").jsonl();
    const byCase = new Map(cases.map(row => [text(row.caseId), row])), byKey = new Map(keys.map(row => [text(row.caseId), row]));
    check(cases.length === 800 && byCase.size === 800 && keys.length === 800 && byKey.size === 800, "raw_scoring_800_case_key_bijection_required");
    const operations = { hard_constraints: "qualify", factual: "fact_check", ranking: "recommend", profile: "extract_profile", conversation: "conversation", robustness: "robustness" };
    for (const item of input.challengeManifest.cases) {
      const row = byCase.get(item.caseId), key = byKey.get(item.caseId);
      check(row && key && row.schemaVersion === "saitu.sealed-case.v2" && row.operation === operations[item.layer]
        && row.familyId === item.familyId && row.taskGroup === item.taskGroup && hash(row.input) === item.inputSha256
        && hash(key) === item.answerSha256 && key.authorContextId === item.authorContextId, "raw_scoring_case_input_or_answer_changed");
    }
    for (const review of semanticReviews) {
      const item = input.challengeManifest.cases.find(item => item.caseId === review.caseId);
      check(item && item.layer !== "ranking" && review.repetition === 0
        && ["reviewer_a", "reviewer_b", "adjudicator"].includes(String(review.role)), "raw_scoring_extra_semantic_review");
      const context = review.role === "reviewer_a" ? item.reviewerContextIds[0] : review.role === "reviewer_b" ? item.reviewerContextIds[1] : item.adjudicatorContextId;
      check(review.contextId === context, "raw_scoring_semantic_reviewer_binding_mismatch");
    }
    const registration = object(get("productRegistration").json()), config = object(registration.config), opening = object(get("productOpening").json());
    const registrationRef = ref(envelope.productRegistration), implementationBefore = object(get("implementationBefore").json()), implementationAfter = object(get("implementationAfter").json()), runtimeBefore = object(get("runtimeBefore").json()), runtimeAfter = object(get("runtimeAfter").json());
    check(get("implementationBefore").file !== get("implementationAfter").file && get("runtimeBefore").file !== get("runtimeAfter").file, "raw_scoring_distinct_before_after_originals_required");
    check(rows(registration.sourceManifest).length > 0, "raw_scoring_original_implementation_bytes_required");
    for (const file of rows(registration.sourceManifest)) reader.read(ref(file));
    check(registration.schemaVersion === "saitu.sealed-run-registration.v1" && registration.inputOpened === false
      && hash(registration.sourceManifest) === binding.implementationSha256 && registration.catalogSha256 === binding.catalogSha256
      && same(implementationBefore, implementationAfter)
      && same(implementationAfter.files, registration.sourceManifest) && implementationAfter.implementationSha256 === binding.implementationSha256,
    "raw_scoring_product_implementation_changed");
    check(hash(registration.runtimeConfiguration) === registration.runtimeConfigurationSha256
      && same(runtimeBefore, runtimeAfter)
      && same(runtimeAfter.configuration, registration.runtimeConfiguration) && runtimeAfter.sha256 === registration.runtimeConfigurationSha256
      && registration.runtimeConfigurationSha256 === binding.runtimeConfigurationSha256, "raw_scoring_product_runtime_changed");
    check(config.schemaVersion === "saitu.sealed-run-config.v1" && config.repeats === 5 && config.seed === freeze.seed
      && config.asOf === profileSnapshot.asOf && config.challengeManifestSha256 === challengeRef.sha256
      && config.sourceSnapshotSha256 === sourceRef.sha256 && object(config.sources).indexSha256 === sourceRef.sha256
      && config.inputSha256 === sha(get("productCases").bytes)
      && config.method === ({ A1: "rules", B: "hybrid", C: "llm" }[input.selectedAlgorithm])
      && ["disabled", "live"].includes(String(config.modelMode)) && (input.selectedAlgorithm !== "C" || config.modelMode === "live")
      && object(config.rankingReuse).algorithm === input.selectedAlgorithm && object(config.rankingReuse).freezeManifestSha256 === freezeRef.sha256,
    "raw_scoring_product_configuration_changed");
    const integrity = object(get("executionIntegrity").json());
    check(integrity.schemaVersion === "saitu.sealed-execution-integrity.v1" && integrity.registrationSha256 === registrationRef.sha256
      && integrity.configurationSha256 === hash(config), "raw_scoring_execution_integrity_binding_changed");
    for (const [phase, kind, name] of [["before", "implementation", "implementationBefore"], ["after", "implementation", "implementationAfter"], ["before", "runtime", "runtimeBefore"], ["after", "runtime", "runtimeAfter"]]) {
      const original = reader.read(ref(object(integrity[phase])[kind]), path.dirname(get("executionIntegrity").file));
      check(original.file === get(name).file && sha(original.bytes) === ref(envelope[name]).sha256, "raw_scoring_execution_integrity_original_mismatch");
    }
    if (integrity.status !== "completed" || integrity.failureArtifact !== null) return empty("pending", "raw_product_execution_incomplete");
    check(integrity.implementationUnchanged === true && integrity.runtimeConfigurationUnchanged === true, "raw_scoring_execution_integrity_inconsistent");
    check(opening.schemaVersion === "saitu.sealed-opening.v1" && opening.registrationSha256 === registrationRef.sha256
      && opening.expectedInputSha256 === config.inputSha256 && opening.sourceIndexSha256 === sourceRef.sha256
      && Number.isFinite(Date.parse(text(registration.registeredAt))) && Date.parse(text(opening.openedAt)) >= Date.parse(text(registration.registeredAt))
      && Date.parse(text(opening.openedAt)) >= Date.parse(text(frozenGet("experiment.json").completedAt)), "raw_scoring_product_opening_mismatch");
    const expectedOrder = productExecutionOrder(cases.flatMap(item => Array.from({ length: item.operation === "recommend" ? 5 : 1 }, (_, repetition) => ({ caseId: item.caseId, repetition, inputSha256: hash(item.input) }))), Number(config.seed));
    check(same(get("executionOrder").json(), expectedOrder), "raw_scoring_execution_order_changed");
    const observations = get("productObservations").jsonl();
    check(observations.length === 1280 && observations.every((row, index) => row.caseId === expectedOrder[index].caseId && row.repetition === expectedOrder[index].repetition
      && row.inputSha256 === expectedOrder[index].inputSha256 && row.registrationSha256 === registrationRef.sha256), "raw_scoring_missing_duplicate_or_reordered_observation");
    const byInvocation = new Map(matrixObservations.map(row => [text(row.invocationId), row]));
    const allInvocations = new Set<string>();
    for (const observation of observations) {
      const item = byCase.get(text(observation.caseId))!;
      check(observation.operation === item.operation && ["observed", "not_run", "error"].includes(String(observation.status)), "raw_scoring_observation_operation_or_status");
      if (item.operation === "recommend") {
        const { registrationSha256: _registration, reusedFromFreezeSha256, ...copied } = observation;
        const original = byInvocation.get(text(observation.invocationId));
        check(original && observation.algorithm === input.selectedAlgorithm && reusedFromFreezeSha256 === freezeRef.sha256 && same(copied, original), "raw_scoring_selected_600_not_exact_reuse");
        check(!allInvocations.has(text(observation.invocationId)), "raw_scoring_duplicate_invocation"); allInvocations.add(text(observation.invocationId));
      } else {
        const invocation = `${text(observation.caseId)}-r0`, events = rows(observation.events);
        check(!allInvocations.has(invocation) && !byInvocation.has(invocation) && observation.adapterVersion === registration.adapterVersion
          && events.every(event => event.requestId === invocation), "raw_scoring_other_680_invocation_binding"); allInvocations.add(invocation);
        if (observation.status === "observed") {
          const dispatches = events.filter(event => event.type === "request_dispatch" && event.origin === "transport");
          const responses = events.filter(event => event.type === "response_received" && event.origin === "transport");
          check(dispatches.length === 1 && responses.length === 1 && object(dispatches[0].details).inputSha256 === observation.inputSha256
            && object(dispatches[0].details).operation === observation.operation && object(responses[0].details).outputSha256 === hash(observation.output), "raw_scoring_other_680_raw_dispatch_or_response_missing");
        }
      }
    }
    const reviewed = mergeOriginalPoolReviews(rows(originalRanking.profiles), rankingReviews, profiles, input.challengeManifest, sourceRef.sha256);
    // Provenance, role identities, uniqueness and pool membership were verified
    // above. Match by item identity rather than either reviewer's shuffled order.
    const pairsByGroup: Record<string, [ReviewerGrade, ReviewerGrade][]> = {};
    for (const profile of reviewed) {
      const source = rankingReviews.filter(row => row.profileId === profile.profileId);
      const grades = (role: string) => new Map(rows(source.find(row => row.role === role)?.judgments ?? [])
        .map(row => [text(row.itemId), row.relevance as ReviewerGrade]));
      const left = grades("reviewer_a"), right = grades("reviewer_b");
      const pairs = pairsByGroup[text(profile.taskGroup)] ??= [];
      for (const candidate of profile.judgments) {
        pairs.push([left.get(text(candidate.itemId)) ?? "U", right.get(text(candidate.itemId)) ?? "U"]);
      }
    }
    const originalAgreement = ordinalAgreement(Object.values(pairsByGroup).flat());
    const agreementByGroup = Object.fromEntries(Object.entries(pairsByGroup).map(([group, pairs]) => [group, ordinalAgreement(pairs)]));
    const rankingInput = { ...originalRanking, profiles: reviewed };
    // Reuse the two pure scorers. The combined CLI imports run-experiment.mjs,
    // whose guarded top-level await cannot be required by the synchronous gate.
    const ranking = evaluateRankings(rankingInput as Parameters<typeof evaluateRankings>[0]);
    const rankConfig = object(rankingRegistration.config);
    let factAudit: ReturnType<typeof aggregateFactAudit> | undefined;
    let reasonAudit: ReturnType<typeof aggregateReasonAudit> | undefined;
    const collectFacts=rankConfig.factAuditProtocol===FACT_AUDIT_PROTOCOL && envelope.factReviews;
    const collectReasons=rankConfig.reasonProtocol===REASON_PROTOCOL && envelope.reasonReviews;
    if (collectFacts || collectReasons) {
      const factSources=[...sources], identities=input.challengeManifest.cases;
      if (rankConfig.factAuditCatalogSources) {
        const snapshot=reader.read(ref(rankConfig.factAuditCatalogSources)), metadata=object(snapshot.json());
        check(metadata.schemaVersion==="saitu.reviewed-catalog-source-bodies.v1" && metadata.catalogSha256===binding.catalogSha256,"fact_audit_catalog_source_binding_mismatch");
        const catalogSources=catalogRecords.flatMap(record=>rows(record.sources));
        for(const source of rows(metadata.sources)){
          const identity=catalogSources.find(s=>s.id===source.sourceId && s.scope===source.scope);
          check(identity && identity.url===source.url,"fact_audit_source_not_in_frozen_catalog");
          reader.read(ref(source.raw),path.dirname(snapshot.file));
          const body=reader.read(ref(source.body),path.dirname(snapshot.file));
          const parsed={sourceId:text(source.sourceId),scope:text(source.scope),body:body.bytes.toString("utf8"),bodySha256:sha(body.bytes)};
          const existing=factSources.find(s=>s.sourceId===parsed.sourceId);
          if(existing) check(same(existing,parsed),"fact_audit_source_identity_conflict"); else factSources.push(parsed);
        }
      }
      if(collectFacts) factAudit=aggregateFactAudit({cases,observations,identities,reviews:reader.read(ref(envelope.factReviews)).jsonl(),sources:factSources} as unknown as Parameters<typeof aggregateFactAudit>[0]);
      if(collectReasons) reasonAudit=aggregateReasonAudit({observations,identities,reviews:reader.read(ref(envelope.reasonReviews)).jsonl(),sources:factSources} as unknown as Parameters<typeof aggregateReasonAudit>[0]);
    }
    const stateAudit= rankConfig.stateAuditProtocol===STATE_AUDIT_PROTOCOL && rankConfig.stateObligationInventory && envelope.stateReviews
      ? aggregateStateObligations({cases,keys,observations,identities:input.challengeManifest.cases,
          plan:reader.read(ref(rankConfig.stateObligationInventory)).json(),reviews:reader.read(ref(envelope.stateReviews)).jsonl()} as unknown as Parameters<typeof aggregateStateObligations>[0]) : undefined;
    const constraintAudit = object(rankingRegistration.config).constraintProtocol===CONSTRAINT_PROTOCOL
      ? aggregateConstraintAudit({cases,keys,observations,reviews:semanticReviews,sources} as unknown as Parameters<typeof aggregateConstraintAudit>[0]) : undefined;
    const sliceByCase = new Map(input.challengeManifest.cases.map(item=>[item.caseId,item.templateFamilyId]));
    let profileAtoms: ReturnType<typeof aggregateProfileAtoms> | undefined;
    if (same(rankConfig.profileAtomProtocol ?? null,PROFILE_ATOM_PROTOCOL) && rankConfig.profileGoldReference) {
      const gold=object(reader.read(ref(rankConfig.profileGoldReference)).json());
      check(gold.schemaVersion==="saitu.exhaustive-120-profile-gold.v1","invalid_profile_gold_schema");
      const originals=rows(gold.originals).map(row=>reader.read(ref(row)));
      check(originals.length===2,"profile_gold_two_originals_required");
      const clean=reader.read(ref(gold.cleanInputPackage));
      const cleanCases=rows(clean.json()), expectedCases=cases.filter(c=>c.operation==="extract_profile");
      check(cleanCases.length===120 && new Set(cleanCases.map(c=>c.caseId)).size===120 &&
        expectedCases.every(c=>cleanCases.some(r=>r.caseId===c.caseId && same(r.input,c.input))),"profile_gold_clean_package_changed");
      const expectedByCase=reconcileProfileGold({originals:originals.map(r=>r.json()),originalBytes:originals.map(r=>sha(r.bytes)),
        inputPackageSha256:sha(clean.bytes),adjudication:gold.adjudication?reader.read(ref(gold.adjudication)).json():undefined,
        registeredAt:rankingRegistration.registeredAt,cases,keys} as unknown as Parameters<typeof reconcileProfileGold>[0]);
      profileAtoms=aggregateProfileAtoms({cases:cases.map(row=>({...row,templateFamilyId:sliceByCase.get(text(row.caseId))})),keys,observations,reviews:semanticReviews,expectedByCase} as unknown as Parameters<typeof aggregateProfileAtoms>[0]);
    }
    const product = scoreProductObservations({ cases, keys, observations, semanticReviews, sources, expectedRankingRepeats: 5 } as Parameters<typeof scoreProductObservations>[0]);
    const scoredCases = product.cases.map(item => {
      if (item.operation !== "recommend") return item;
      const profile = rawProfiles.find(profile => profile.caseId === item.caseId)!;
      const row = ranking.profileResults.find(row => row.algorithm === input.selectedAlgorithm && row.profileId === profile.profileId);
      // A fully reviewed all-zero pool has no defined nDCG. Its five empty
      // outputs are a separate correct case, never an ordinary scored family.
      const correctEmptyPool = row?.status === "no_relevant_pool" && row.runCount === 5 && row.noRelevantPoolEmptyOutputRate === 1;
      const ready = row?.annotationStatus === "ai_blind_reviewed" && (row.status === "scored" || correctEmptyPool);
      const runs = item.runs.map(run => {
        const checks = run.checks.map(check => check.id === "independent_full_pool_labels" && ready
          ? { ...check, status: "passed" as const, reason: correctEmptyPool ? "exact_reused_invocation_no_relevant_pool_correct_empty_output" : "exact_reused_invocation_complete_pool_scored" } : check);
        return { ...run, checks, status: run.status === "pending" && checks.length && checks.every(check => check.status === "passed") ? "passed" : run.status };
      });
      return { ...item, runs, status: runs.some(run => run.status === "failed") ? "failed" : runs.some(run => run.status === "not_run") ? "not_run" : runs.some(run => run.status === "pending") ? "pending" : "passed" };
    });
    const scoring: CombinedResult = { cases: scoredCases, counts: Object.fromEntries(["passed", "failed", "not_run", "pending"].map(status => [status, scoredCases.filter(item => item.status === status).length])), ranking, rankingExecution: summarizeBoundRuns(matrixObservations) };
    check(scoring.cases.length === 800, "raw_scoring_computed_denominator_changed");
    const pendingRequirements: string[] = [];
    if (reviewed.some(profile => profile.annotationStatus !== "ai_blind_reviewed")) pendingRequirements.push("ranking_labels_incomplete_or_unresolved");
    if (scoring.cases.some(item => item.status !== "passed")) pendingRequirements.push("raw_800_not_all_passed");
    // The exact envelope references bind challenge/keys/source/reviews/matrix,
    // registered implementation/config/runtime, raw observations and reuse.
    const bindingSha256 = hash(envelope), trusted = TRUSTED_SCORING_REVIEWS.find(entry => entry.bindingSha256 === bindingSha256);
    if (!trusted) pendingRequirements.push("independent_ai_review_registration_required");
    else {
      check(trusted.report.sha256 === trusted.reportSha256, "trusted_review_registration_invalid");
      const report = object(reader.read(trusted.report).json());
      check(report.schemaVersion === "saitu.raw-scoring-independent-review.v1" && report.bindingSha256 === bindingSha256
        && report.mode === "ai_proxy" && report.status === "approved", "trusted_review_report_binding_changed");
    }
    return { status: pendingRequirements.length ? "pending" : "derived", reason: pendingRequirements[0] ?? null, rawValidated: true,
      execution: scoring.cases.map(({ caseId, status }) => ({ caseId, status })), scoring, pendingRequirements, profileAtoms, constraintAudit, factAudit, reasonAudit, stateAudit,
      rankingMetadata: {
        baselineSelection: object(rankingRegistration.config).baselineSelection ?? null,
        originalAgreement, agreementByGroup,
        rawScoringEvidence: envelopeRef, challengeManifestSha256: challengeRef.sha256,
        sourceSnapshotSha256: sourceRef.sha256, implementationSha256: text(binding.implementationSha256),
        configurationSha256: text(binding.configurationSha256), registrationSha256: text(binding.registrationSha256),
        freezeManifestSha256: freezeRef.sha256,
        aggregationProtocol: object(rankingRegistration.config).metricAggregation ?? null,
        registeredAt: rankingRegistration.registeredAt ?? null, openedAt: frozenGet("opening.json").openedAt ?? null,
        startedAt: frozenGet("experiment.json").startedAt ?? null, completedAt: frozenGet("experiment.json").completedAt ?? null,
        profileCount: reviewed.length,
        totalPoolItems: reviewed.reduce((sum, profile) => sum + profile.judgments.length, 0),
        unresolvedPoolItems: reviewed.reduce((sum, profile) => sum + profile.judgments.filter(item => item.relevance === "U").length, 0),
        completePoolProfiles: reviewed.filter(profile => profile.annotationStatus === "ai_blind_reviewed").length,
      } };
  } catch (error) {
    return empty("invalid", error instanceof Error ? error.message : "invalid_raw_scoring_evidence");
  }
}
