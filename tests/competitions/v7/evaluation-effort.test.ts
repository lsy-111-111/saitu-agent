import { describe, expect, it } from "vitest";
import { EVALUATION_POLICY, LEGACY_EVALUATION_RUNTIME, POLICY_SHA256, canonicalHash } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { DEFAULT_EFFORT_POLICY, LEGACY_DEFAULT_EFFORT_POLICY, EFFORT_GRANT_VERSION, effortPolicySha256, evaluationRuntimeForEffort, validateEvaluationRuntime,
  effortPolicyForScope, assertDispatchEffort, assertLedgerEffort } from "../../../scripts/competitions/v7/evaluation-effort.mjs";
import { hasBoundProviderDispatch } from "../../../scripts/competitions/v7/evaluation-dispatch-evidence.mjs";
import { validateFrozenMatrix } from "../../../scripts/competitions/v7/evaluation-reuse.mjs";
import { scoreRankingGate, scoreEvaluationBundle } from "../../../scripts/competitions/v7/evaluation-score.mjs";
import { runtimeBehaviorConfiguration } from "../../../scripts/competitions/v7/evaluation-runtime.mjs";
import { evaluationFixture } from "./evaluation.fixture";

const mixed = { version: "saitu.effort-policy.v1", rank: "low", explain: "high", review: "low" } as const;
const runtime = evaluationRuntimeForEffort(mixed), hash = effortPolicySha256(mixed);
const dispatch = (operation = "competition_v7_rank", reasoningEffort = "low") => ({ operation, reasoningEffort, thinkingType: "enabled", effortPolicySha256: hash });
function stageFixture() {
  const fixture = evaluationFixture(); fixture.matrix.runtime = runtime; fixture.registration.config.runtime = runtime;
  for (const original of fixture.gold.originals) Object.assign(original, { freshContext: true, oldJudgmentsRead: false, otherReviewerJudgmentsRead: false, authorModel: "gpt-6.1-sol", authorEffort: "max" });
  for (const observation of fixture.matrix.observations) {
    observation.runtime = runtime;
    for (const event of observation.events) if (event.type === "ai_transport_dispatch") event.details = { ...dispatch(), model: "deepseek-flash", reservationId: observation.invocationId };
  }
  for (const observation of fixture.bundle.observations) observation.runtime = runtime;
  for (const review of fixture.bundle.reviews) review.observationSha256 = canonicalHash(fixture.bundle.observations.find((row: any) => row.caseId === review.caseId && row.repetition === review.repetition));
  return fixture;
}

describe("evaluation stage effort binding", () => {
  it("accepts every frozen high/low stage combination without changing the original numerical scoring policy", () => {
    for (const rank of ["high", "low"] as const) for (const explain of ["high", "low"] as const) for (const review of ["high", "low"] as const) {
      const policy = { version: mixed.version, rank, explain, review };
      expect(validateEvaluationRuntime(evaluationRuntimeForEffort(policy), { requireStagePolicy: true })).toEqual(policy);
    }
    expect(POLICY_SHA256).not.toBe("b1b357f6906cb151022123e52f0b6aa52c9050541950bf6e95512c656caad19b");
    expect(validateEvaluationRuntime(LEGACY_EVALUATION_RUNTIME)).toEqual(LEGACY_DEFAULT_EFFORT_POLICY);
    expect(() => validateEvaluationRuntime(LEGACY_EVALUATION_RUNTIME, { requireStagePolicy: true })).toThrow("frozen_stage_effort");
    for (const mutate of [(r: any) => r.effortPolicy.rank = "high", (r: any) => r.reasoningEffort = "high", (r: any) => delete r.effortPolicySha256]) {
      const changed = structuredClone(runtime); mutate(changed); expect(() => validateEvaluationRuntime(changed)).toThrow();
    }
  });
  it("requires the new grant map/hash and keeps the historical high grant exactly high", () => {
    const scope = { grantVersion: EFFORT_GRANT_VERSION, authorizedEffort: "stage", effortPolicy: mixed, effortPolicySha256: hash };
    expect(effortPolicyForScope(scope)).toEqual(mixed);
    expect(effortPolicyForScope({ grantVersion: "saitu.v7", authorizedEffort: "high" })).toEqual(LEGACY_DEFAULT_EFFORT_POLICY);
    for (const change of [{ effortPolicySha256: "0".repeat(64) }, { effortPolicy: undefined }, { authorizedEffort: "high" }, { grantVersion: "saitu.v7" }]) expect(() => effortPolicyForScope({ ...scope, ...change })).toThrow();
    expect(() => effortPolicyForScope({ grantVersion: "saitu.v7", authorizedEffort: "high", effortPolicy: mixed })).toThrow();
  });
  it("rejects a wrong stage, changed policy or chat effort even when both values are supported", () => {
    expect(() => assertDispatchEffort(dispatch(), mixed)).not.toThrow();
    expect(() => assertDispatchEffort(dispatch("competition_v7_explain", "low"), mixed)).toThrow();
    expect(() => assertDispatchEffort(dispatch("competition_v7_chat_review", "low"), mixed)).toThrow();
    expect(() => assertDispatchEffort({ ...dispatch(), effortPolicySha256: "0".repeat(64) }, mixed)).toThrow();
    expect(() => assertLedgerEffort({ operation: "competition_v7_rank", effort: "low", effort_policy_sha256: hash }, mixed)).not.toThrow();
    expect(() => assertLedgerEffort({ operation: "competition_v7_explain", effort: "low", effort_policy_sha256: hash }, mixed)).toThrow();
    expect(() => assertLedgerEffort({ operation: "competition_v7_rank", effort: "low", effort_policy_sha256: hash }, mixed, { legacy: true })).toThrow();
  });
  it("does not let a valid receipt conceal a second potential call with the wrong stage or hash", () => {
    const good = { call_key: "v7.rank:effort-v1.initial:1", operation: "competition_v7_rank", effort: "low", effort_policy_sha256: hash,
      call_operation: "competition_v7_rank", call_thinking: "enabled", call_reasoning_effort: "low", call_effort_policy_sha256: hash,
      model: "deepseek-flash", spend_run_id: "finite-run", reservation_id: "original-reservation", originalReceipt: { kind: "receipt" } };
    expect(hasBoundProviderDispatch([good], "finite-run", runtime)).toBe(true);
    for (const change of [{ effort: "high" }, { effort_policy_sha256: "0".repeat(64) }, { operation: "competition_v7_explain" }, { operation: "unregistered" }]) {
      expect(hasBoundProviderDispatch([good, { ...good, ...change, call_state: "unknown", originalReceipt: null }], "finite-run", runtime)).toBe(false);
    }
  });
  it("rejects durable-call metadata that differs from its original ledger or call key", () => {
    const good = { call_key: "v7.rank:effort-v1.initial:1", operation: "competition_v7_rank", effort: "low", effort_policy_sha256: hash,
      call_operation: "competition_v7_rank", call_thinking: "enabled", call_reasoning_effort: "low", call_effort_policy_sha256: hash,
      model: "deepseek-flash", spend_run_id: "finite-run", reservation_id: "original-reservation", originalReceipt: { kind: "receipt" } };
    expect(hasBoundProviderDispatch([good], "finite-run", runtime)).toBe(true);
    for (const change of [{ call_operation: "competition_v7_explain" }, { call_thinking: "disabled" }, { call_reasoning_effort: "high" },
      { call_effort_policy_sha256: "0".repeat(64) }, { call_key: "v7.review:effort-v1.initial:1" }, { call_operation: undefined }]) {
      expect(hasBoundProviderDispatch([{ ...good, ...change }], "finite-run", runtime)).toBe(false);
    }
  });
  it("keeps all 1200 matrix slots and the two complete original reviewer alpha gate under mixed effort", () => {
    const fixture = stageFixture(); expect(validateFrozenMatrix(fixture.matrix).reports).toBe(1200);
    expect(scoreRankingGate(fixture.matrix, fixture.gold, fixture.manifest, fixture.registration.registeredAt).originalAgreement.value).toBe(1);
    expect(fixture.gold.originals).toHaveLength(2); expect(fixture.gold.originals.every((row: any) => row.profiles.length === 120)).toBe(true);
    const changed = structuredClone(fixture.matrix); changed.observations.find((row: any) => row.algorithm === "C").events[1].details.reasoningEffort = "high";
    expect(() => validateFrozenMatrix(changed)).toThrow("dispatch_differs");
  });
  it("requires the same registered effort policy in product originals while pure fixtures remain unverified", () => {
    const fixture = stageFixture(), result = scoreEvaluationBundle(fixture.bundle, { frozenMatrix: fixture.matrix, registration: fixture.registration });
    expect(result.formalDenominators).toMatchObject({ cases: 800, rankingReports: 1200, cReportsReused: 600 });
    expect(result.blockers).toContain("raw_680_product_originals_not_verified_fixture_only");
    fixture.bundle.observations.find((row: any) => !row.algorithm).runtime = evaluationRuntimeForEffort(DEFAULT_EFFORT_POLICY);
    expect(() => scoreEvaluationBundle(fixture.bundle, { frozenMatrix: fixture.matrix, registration: fixture.registration })).toThrow("nonranking_runtime_effort_policy_changed");
  });
  it("rejects nonfresh original provenance in new-stage formal scoring while retaining historical full-review reading", () => {
    const legacy = evaluationFixture(); expect(scoreRankingGate(legacy.matrix, legacy.gold, legacy.manifest, legacy.registration.registeredAt).originalAgreement.value).toBe(1);
    for (const change of [{ freshContext: false }, { oldJudgmentsRead: true }, { otherReviewerJudgmentsRead: true }, { authorModel: "other-model" }, { authorEffort: "high" }]) {
      const fixture = stageFixture(); Object.assign(fixture.gold.originals[0], change);
      expect(() => scoreRankingGate(fixture.matrix, fixture.gold, fixture.manifest, fixture.registration.registeredAt)).toThrow("complete_fresh_blind_original_provenance_required");
    }
  });
  it("includes the exact configured stage map in the business runtime identity", () => {
    const config = runtimeBehaviorConfiguration({ AI_PROVIDER: "deepseek", SAITU_V7_EFFORT_POLICY: JSON.stringify(mixed), SAITU_V7_EFFORT_POLICY_SHA256: hash });
    expect(config).toMatchObject({ effortPolicy: mixed, effortPolicySha256: hash, reasoningEffort: "mixed" });
    expect(() => runtimeBehaviorConfiguration({ SAITU_V7_EFFORT_POLICY: JSON.stringify(mixed), SAITU_V7_EFFORT_POLICY_SHA256: "0".repeat(64) })).toThrow("hash_mismatch");
  });
});
