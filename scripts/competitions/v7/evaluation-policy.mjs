import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

export const POLICY_VERSION = "saitu.policy.2026-11-09.v7.top5";
export const TOP5_EFFORT_POLICY = Object.freeze({ version: "saitu.effort-policy.v1", rank: "low", explain: "low", review: "low" });
// Historical records retain their all-high runtime; new registration requires
// the explicit Top5 stage policy below, with its own policy hash.
export const LEGACY_EVALUATION_RUNTIME = Object.freeze({ provider: "deepseek", model: "deepseek-flash", thinking: "enabled", reasoningEffort: "high", candidatePolicy: "full_core_reviewed" });
export const CASE_QUOTAS = Object.freeze({ hard_constraints: 300, factual: 100, ranking: 120, profile: 120, conversation: 80, robustness: 80 });
export const TASK_GROUPS = Object.freeze(["software_data", "engineering_design", "experimental_agriculture", "business_practice", "survey_education", "arts_language"]);
export const FORMAL_ARMS = Object.freeze(["B", "C"]);
export const RETIRED_SCOPES = Object.freeze(["current_registration", "ability_certification", "confirmation_handshake", "research_dossier", "a1_formal_control", "fixed_rule_score"]);
export const EVALUATION_POLICY = Object.freeze({
  schemaVersion: "saitu.evaluation-policy.v7.1", policyVersion: POLICY_VERSION,
  cases: CASE_QUOTAS, formalArms: FORMAL_ARMS, profiles: 120, repetitions: 5, formalRankingReports: 1200,
  developmentOnlyArms: ["A0", "A1"], reuseArm: "C", reusedReports: 600, additionalRankingPaidRuns: 0,
  runtime: { ...LEGACY_EVALUATION_RUNTIME, reasoningEffort: "low", effortPolicy: TOP5_EFFORT_POLICY,
    effortPolicySha256: createHash("sha256").update(JSON.stringify(TOP5_EFFORT_POLICY)).digest("hex") },
  recommendationMaxItems: 5,
  ranking: { ndcg5: .85, minimumTaskGroupNdcg5: .75, top5SeriesJaccard: .80,
    pairedControl: "B", pairedFamilyCount: 120, confidenceLevel: .95, bootstrapSamples: 2000, ciLower: -.02, pointGainRequired: false },
  quality: { hardConstraintViolations: 0, criticalFactErrors: 0, factAccuracy: .98, citationPrecision: .98, citationCoverage: .95,
    criticalCitationCoverage: 1, profileMicroF1: .95, profileMinimumSliceF1: .90, correctionSuccess: 1, correctionIsolation: 1,
    validReasons: .95, expectedCounterfactualResponses: .90 },
  performance: { firstListP95Ms: 40000, rankHardTimeoutMs: 60000, allDetailsP95Ms: 120000, detailHardTimeoutMs: 150000, readyExpansionP95Ms: 1000, samples: 100, desktop: 50, mobile: 50,
    clock: "browser_original_submit_before_click_to_rendered_DOM", failuresRemainInDenominator: true },
  review: { ordinary: "one_independent_round_then_targeted_retest", rankingGold: "two_blind_originals_then_adjudication",
    lowRiskRecommendationSampleRate: .20, criticalClaimsSampleRate: 1, sampleSeedMustBeFrozen: true },
  retiredScopes: RETIRED_SCOPES,
  historicalEvidence: "preserve_original_policy_and_status; no_reinterpretation_as_v7",
});

export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  throw new Error("non_json_evaluation_binding");
}
export const canonicalHash = value => byteHash(canonicalJson(value));
export const byteHash = bytes => createHash("sha256").update(bytes).digest("hex");
export const POLICY_SHA256 = canonicalHash(EVALUATION_POLICY);
export const isHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const isTime = value => typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
export const isUint32 = value => Number.isSafeInteger(value) && value >= 0 && value <= 4294967295;
export const same = (left, right) => canonicalHash(left) === canonicalHash(right);
export function requirePolicy(value) {
  if (value?.policyVersion !== POLICY_VERSION || value.policySha256 !== POLICY_SHA256) throw new Error("v7_policy_binding_required");
}
export function assertUnique(values, message) {
  if (values.some(value => typeof value !== "string" || !value) || new Set(values).size !== values.length) throw new Error(message);
}
export function assertQuotas(cases, message = "v7_requires_original_six_layer_800_denominator") {
  if (!Array.isArray(cases) || cases.length !== 800 || Object.entries(CASE_QUOTAS).some(([layer, count]) => cases.filter(row => row.layer === layer).length !== count)) throw new Error(message);
  assertUnique(cases.map(row => row.caseId), "duplicate_or_missing_v7_case_id");
}
export function assertRankingGroups(profiles) {
  if (!Array.isArray(profiles) || profiles.length !== 120 || TASK_GROUPS.some(group => profiles.filter(row => row.taskGroup === group).length !== 20)) throw new Error("v7_ranking_requires_six_groups_of_twenty");
  for (const key of ["profileId", "caseId", "familyId"]) assertUnique(profiles.map(row => row[key]), `v7_ranking_unique_${key}_required`);
}
export function lowRiskSample(ids, seed) {
  assertUnique(ids, "duplicate_low_risk_sample_identity");
  if (!isUint32(seed)) throw new Error("frozen_sampling_seed_required");
  return [...ids].sort((a, b) => byteHash(`${seed}:${a}`).localeCompare(byteHash(`${seed}:${b}`)) || a.localeCompare(b))
    .slice(0, Math.ceil(ids.length * .20)).sort();
}
export function jsonPointer(value, pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/")) throw new Error("absolute_json_pointer_required");
  let result = value;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (result === null || typeof result !== "object" || !Object.hasOwn(result, key)) throw new Error("evidence_pointer_missing");
    result = result[key];
  }
  return result;
}
/** Reference traversal and symlinks cannot escape the explicitly selected evidence root. */
export async function readBoundBytes(rootDirectory, reference) {
  if (!reference || !isHash(reference.sha256) || typeof reference.path !== "string" || path.isAbsolute(reference.path) || reference.path.split(/[\\/]/).includes("..")) throw new Error("safe_hashed_evaluation_reference_required");
  const root = await realpath(rootDirectory), filename = await realpath(path.resolve(root, reference.path));
  if (!filename.startsWith(root + path.sep)) throw new Error("evaluation_reference_outside_root");
  const bytes = await readFile(filename);
  if (byteHash(bytes) !== reference.sha256) throw new Error("evaluation_reference_bytes_changed");
  return { bytes, filename };
}
export async function readBoundJson(rootDirectory, reference) {
  const result = await readBoundBytes(rootDirectory, reference);
  return { ...result, value: JSON.parse(result.bytes) };
}
export async function writeNewJson(filename, value) {
  await writeFile(filename, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
export function parseFileCli(args, accepted = ["--input", "--output"]) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!accepted.includes(flag) || Object.hasOwn(options, flag)) throw new Error("unsupported_or_duplicate_evaluation_option");
    if (flag === "--open") { options[flag] = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error("evaluation_option_value_required");
    options[flag] = value;
  }
  for (const flag of accepted) if (!options[flag]) throw new Error(`evaluation_option_required:${flag}`);
  return options;
}
