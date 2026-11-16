import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/pool", () => ({
  isDatabaseConfigured: () => false,
  getPool: vi.fn(() => { throw new Error("consumer_concurrency_tests_forbid_database"); }),
}));
vi.mock("@/lib/ai/execution-authorization", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/ai/execution-authorization")>(),
  // This consumer test starts after authority verification. The real DB grant
  // and fail-closed authorization branches have their own integration tests.
  readUserUnboundedExecutionAuthorizationV7: vi.fn(async () => ({
    runId: "saitu-v7-top5-unbounded-20261109-formal-91", mainRunId: "synthetic-consumer-main", phase: "formal",
    policySha256: "b".repeat(64), effortPolicySha256: effortPolicySha256(policy), conditionSha256: "c".repeat(64),
  })),
}));
vi.mock("@/lib/ai/spend-ledger", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/ai/spend-ledger")>(),
  reserveAiSpend: vi.fn(async () => ({ ok: true as const, reservation: {
    id: randomUUID(), reservedMicros: 0, settle: async () => 0,
  } })),
}));

import { requestAiJson, type AiJsonResult } from "@/lib/ai/ai-client";
import type { readDurableDecisionJournalV7 } from "@/lib/ai/durable-call";
import { effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import { resetModelCallGovernorForTests } from "@/lib/ai/model-call-governor";
import { getPool } from "@/lib/db/pool";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { draftDecisionChatV7 } from "@/lib/competitions/v7/chat";
import { RECOMMENDATION_DETAIL_DEADLINE_MS, type RecommendationRunStatusV7 } from "@/lib/competitions/v7/contracts";
import { generateGroupExplanationV7, groupCanonicalSha256V7, reviewPreparedGroupV7 } from "@/lib/competitions/v7/explanation-groups";
import { processDetailGroupsV7, type GroupWorkerBodyV7 } from "@/lib/competitions/v7/group-worker";
import { buildDecisionContextV7, explainDecisionV7, type DecisionModelCallV7 } from "@/lib/competitions/v7/model";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { decodedGroupWire, groupReasonFixture, matchingRelationReviewBallotFixture } from "./group-reason-fixture";

const policy = { version: "saitu.effort-policy.v1", rank: "low", explain: "low", review: "low" } as const;
const success = (data: unknown): AiJsonResult<unknown> => ({ ok: true, data, model: "deepseek-flash", upstreamAttempted: true,
  attempts: 1, httpStatus: 200, finishReason: "stop", durationMs: 1 });
const response = (data: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: "stop" }],
  usage: { prompt_tokens: 20, completion_tokens: 10, prompt_cache_hit_tokens: 5 } }), { status: 200 });
const barrier = () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  return { pending, release };
};

function fixture() {
  const legacy = student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] });
  const context = buildDecisionContextV7(legacy, { profileId: randomUUID(), records: Array.from({ length: 45 }, (_, i) => syntheticRecord(i + 1)) });
  const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, shortfallReason: null,
    recommendations: context.candidates.slice(0, 5).map(({ record }) => ({ itemId: record.recordId,
      reasons: [{ text: "固定内部方向，尚待生成与复核。", basis: "suggestion", studentFactIds: [], competitionFactIds: [], conditions: [] }] })) };
  const codec = createModelIdentifierCodec({ candidates: context.candidates.map(({ record }) => record.recordId),
    series: context.candidates.map(({ record }) => record.seriesId), facts: context.candidates.flatMap(({ record }) => record.facts.map(fact => fact.id)),
    students: context.profile.facts.map(fact => fact.id) });
  return { legacy, context, plan, codec };
}
type Fixture = ReturnType<typeof fixture>;
const novel = (value: Fixture, itemId: string) => ({ text: "你可结合自报的信息与给定分析任务，先整理一份本人练习记录，说明数据处理决策并检查结果是否可复现；这是未来可尝试的学习路径，资源和参加条件仍需核实，不把团队成果当作本人已有能力。", basis: "inference" as const,
  studentFactIds: [value.context.profile.facts[0].id], competitionFactIds: [value.context.candidates.find(row => row.record.recordId === itemId)!.record.facts[0].id],
  conditions: [] });

function groupRun(value: Fixture) {
  const submitted = Date.now();
  let status: RecommendationRunStatusV7 = "list_ready";
  const claim = { row: { run_id: randomUUID(), state_key: `offline-${randomUUID()}`, result_version: 0, status: status as RecommendationRunStatusV7,
    submitted_at: new Date(submitted), detail_deadline_at: new Date(submitted + RECOMMENDATION_DETAIL_DEADLINE_MS) },
  body: { implementationSha256: "b".repeat(64), sessionGeneration: 0, effortPolicySha256: effortPolicySha256(policy), detailsReadyAt: null,
    plan: value.plan, shortfallReason: value.plan.shortfallReason,
    items: value.plan.recommendations.map((item, index) => {
      const record = value.context.candidates.find(row => row.record.recordId === item.itemId)!.record;
      return { rank: index + 1, itemId: item.itemId, seriesId: record.seriesId, name: record.name, trackLabel: record.track.name,
        edition: record.edition, officialUrl: null, detailStatus: "pending" as const };
    }) } as GroupWorkerBodyV7 };
  const committed: { status: RecommendationRunStatusV7; body: GroupWorkerBodyV7 }[] = [];
  const journal: Awaited<ReturnType<typeof readDurableDecisionJournalV7>> = [];
  // These are independent in-memory commit journals, not substitutes for the
  // PostgreSQL CAS/authority tests. They expose the consumer's await boundaries.
  const writer = { async update(change: (body: GroupWorkerBodyV7, status: RecommendationRunStatusV7) =>
    { body: GroupWorkerBodyV7; status: RecommendationRunStatusV7 } | null) {
    const next = change(claim.body, status);
    if (!next) return;
    claim.body = structuredClone(next.body); status = next.status; claim.row.status = status; claim.row.result_version++;
    committed.push(structuredClone({ status, body: claim.body }));
  }, async flush() {} };
  const modelCall: DecisionModelCallV7 = async (prompt, options) => {
    const result = await requestAiJson(prompt, options);
    journal.push({ runId: claim.row.run_id, callId: randomUUID(), reservationId: result.upstreamAttempted ? randomUUID() : null,
      callKey: `${options.diagnosticContext!.stage}:${options.diagnosticContext!.reviewId}:1`, operation: options.operation ?? null,
      reasoningEffort: options.reasoningEffort ?? null, effortPolicySha256: effortPolicySha256(policy),
      upstreamAttempted: result.upstreamAttempted, usage: result.usage ?? null });
    return result;
  };
  const work = () => processDetailGroupsV7({ claim, writer, context: value.context, plan: value.plan, controller: new AbortController(),
    onObservation: async () => undefined, models: {
      generate: (context, plan, spec, options) => generateGroupExplanationV7(context, plan, spec, { ...options, modelCall }),
      review: (context, plan, prepared, options) => reviewPreparedGroupV7(context, plan, prepared, { ...options, modelCall }),
    }, readJournal: async () => journal });
  return { ...value, claim, work, committed, journal, status: () => status };
}

beforeEach(() => {
  for (const [key, value] of Object.entries({ DATABASE_URL: "", AI_SPEND_RUN_ID: "saitu-v7-top5-unbounded-20261109-formal-91", AI_SPEND_PHASE: "formal",
    RUN_SPEND_LEDGER_POSTGRES_TESTS: "", RUN_DEEPSEEK_LIVE: "",
    AI_PROVIDER: "deepseek", AI_API_KEY: "synthetic-never-networked", AI_API_URL: "https://api.deepseek.com/chat/completions",
    AI_SPEND_POLICY_SHA256: "b".repeat(64), AI_SPEND_EFFORT_CONDITION_SHA256: "c".repeat(64),
    SAITU_AI_EXECUTION_MODE: "user-unbounded", AI_CONCURRENCY_MAX: "1", AI_MODEL_CALLS_PER_DAY: "1", AI_QUEUE_MAX: "1", AI_QUEUE_WAIT_MS: "1",
    AI_SPEND_AUTHORIZED_EFFORT: "stage", SAITU_V7_EFFORT_POLICY: JSON.stringify(policy), SAITU_V7_EFFORT_POLICY_SHA256: effortPolicySha256(policy) })) vi.stubEnv(key, value);
  vi.spyOn(console, "info").mockImplementation(() => undefined); vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  expect(getPool).not.toHaveBeenCalled();
  resetModelCallGovernorForTests(); vi.mocked(getPool).mockClear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe("B independent unbounded consumers keep their data dependencies", () => {
  it("compares only the accepted final report and stops with a single accepted item", async () => {
    const value = fixture(), retained = value.plan.recommendations[2], rejected = value.plan.recommendations[0];
    const fact = value.context.candidates.find(row => row.record.recordId === retained.itemId)!.record.facts[0];
    const finalPlan: MatchPlanV6 = { ...value.plan, shortfallReason: "其余项未形成可核实的匹配理由。", recommendations: [{ ...retained,
      reasons: [{ text: fact.text, basis: "official", studentFactIds: [], competitionFactIds: [fact.id], conditions: [] }] }] };
    const report = await explainDecisionV7(value.context, finalPlan, { modelCall: async () => success(finalPlan) });
    const state = { ...value, profile: value.context.profile, report };
    const modelCall = vi.fn(async () => { throw new Error("no_model_needed_for_ineligible_comparison"); });
    const only = await draftDecisionChatV7(state, "比较推荐任务", [retained.itemId], { modelCall });
    expect(only.message).toContain("只有一项可比较");
    expect(only.comparison).toBeUndefined();
    await expect(draftDecisionChatV7(state, "比较推荐任务", [retained.itemId, rejected.itemId], { modelCall })).rejects.toThrow("unknown_comparison_item");
    expect(modelCall).not.toHaveBeenCalled();
  });

  it("admits three actual group transports concurrently while persisting each g0 before its own review", async () => {
    const runs = Array.from({ length: 3 }, () => groupRun(fixture())), gate = barrier();
    const calls: { profileId: string; stage: string }[] = [];
    let active = 0, peak = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
      const wire = JSON.parse(String(init.body)), input = decodedGroupWire(wire.messages.find((row: { role: string }) => row.role === "user").content);
      const run = runs.find(row => input.profile
        ? row.context.profile.profileId === input.profile.profileId
        : row.claim.body.detailGroups?.groups.some(group => groupCanonicalSha256V7(group.spec) === input.groupBindingSha256))!;
      const payload = run.codec.decode(expandCandidateEvidence(expandMatchingTables(input))) as any;
      const stage = input.assertions ? "review" : "explain";
      calls.push({ profileId: run.context.profile.profileId, stage }); active++; peak = Math.max(peak, active);
      try {
        expect(wire.thinking).toEqual({ type: "enabled" }); expect(wire.reasoning_effort).toBe("low");
        if (stage === "explain") {
          expect(payload).not.toHaveProperty("profile");
          expect(payload).not.toHaveProperty("groupSpec");
          expect(payload.studentBasisOptions).toEqual([{ index: 0, kind: "reported_skill", text: "数据分析与建模" }]);
        } else expect(payload.profile).toEqual(run.context.profile);
        if (stage === "explain") {
          expect(payload.groupId).toBe("g0"); expect(payload.fixedOrder.rowIndices).toEqual(run.plan.recommendations.map((_item, index) => index));
          await gate.pending;
          return response(run.codec.encode({ schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: payload.groupBindingSha256, groupId: "g0",
            profileRevision: run.context.profile.revision, catalogVersion: run.context.catalogVersion, shortfallReason: null,
            recommendations: run.plan.recommendations.map((_item, rowIndex) => ({ rowIndex, reason: groupReasonFixture(0, 0), roleIndex: 0 })) }));
        }
        const group = run.claim.body.detailGroups!.groups[0];
        expect(group.status).toBe("reviewing"); expect(group.prepared).toBeDefined();
        expect(group.prepared!.assertions).toHaveLength(10);
        expect(input.assertions).toHaveLength(5);
        for (const item of group.prepared!.explanation.recommendations) {
          expect(item.roleReason).toEqual(item.reasons[0]);
          expect(item.roleReason).not.toBe(item.reasons[0]);
        }
        expect(group.reviewPreparation!.preparedSha256).toBe(group.prepared!.preparedSha256);
        expect(group.reviewPreparation!.call.callKey).toBe("v7.review:detail-v2.g0.initial:1");
        expect(group.reviewPreparation!.call.reviewKeys).toHaveLength(10);
        expect(new Set(group.reviewPreparation!.call.reviewKeys.map(row => row.alias)).size).toBe(5);
        expect(group.reviewPreparation!.call.jointReviewBindings).toHaveLength(5);
        for (const item of group.prepared!.explanation.recommendations) {
          const whyAlias = group.reviewPreparation!.call.reviewKeys.find(row => row.key === `${item.itemId}.reason.0`)!.alias;
          const roleAlias = group.reviewPreparation!.call.reviewKeys.find(row => row.key === `${item.itemId}.role`)!.alias;
          expect(roleAlias).toBe(whyAlias);
        }
        expect(run.claim.body.items.every(item => item.detailStatus === "checking" && !item.detail)).toBe(true);
        return response({ checks: input.assertions.map((row: { key: string }) => matchingRelationReviewBallotFixture(row.key, "Synthetic dependency test only.")) });
      } finally { active--; }
    }));
    const work = Promise.all(runs.map(run => run.work()));
    try {
      await vi.waitFor(() => expect(calls.filter(row => row.stage === "explain")).toHaveLength(3), { timeout: 1000 });
      expect(peak).toBe(3); expect(calls.some(row => row.stage === "review")).toBe(false);
    } finally { gate.release(); await work; }
    for (const run of runs) {
      expect(run.status()).toBe("ready"); expect(run.context.records).toHaveLength(45);
      expect(run.claim.body.items).toHaveLength(5); expect(run.claim.body.report!.recommendations).toHaveLength(5);
      expect(run.claim.body.detailGroups!.groups.map(group => group.spec.groupId)).toEqual(["g0"]);
      expect(run.journal.map(row => row.callKey)).toEqual(["v7.explain:detail-v2.g0.initial:1", "v7.review:detail-v2.g0.initial:1"]);
      expect(calls.filter(row => row.profileId === run.context.profile.profileId).map(row => row.stage)).toEqual(["explain", "review"]);
      expect(run.committed.find(row => row.body.detailGroups?.groups[0].status === "prepared")).toBeDefined();
    }
    expect(calls).toHaveLength(6);
  });

  it("admits three high chat answers concurrently and starts each support review only after its answer", async () => {
    const states = await Promise.all(Array.from({ length: 3 }, async () => {
      const value = fixture(), plan = { ...value.plan, recommendations: value.plan.recommendations.map(item => {
        const fact = value.context.candidates.find(row => row.record.recordId === item.itemId)!.record.facts[0];
        return { itemId: item.itemId, reasons: [{ text: fact.text, basis: "official" as const, studentFactIds: [], competitionFactIds: [fact.id], conditions: [] }] };
      }) };
      const report = await explainDecisionV7(value.context, plan, { modelCall: async () => success(plan) });
      return { ...value, profile: value.context.profile, report };
    }));
    const gate = barrier(), answersFinished = new Set<string>(), calls: { profileId: string; stage: string }[] = [];
    let active = 0, peak = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
      const wire = JSON.parse(String(init.body)), input = JSON.parse(wire.messages.find((row: { role: string }) => row.role === "user").content);
      const state = states.find(row => row.profile.profileId === input.profile.profileId)!, stage = input.assertions ? "review" : "chat";
      calls.push({ profileId: state.profile.profileId, stage }); active++; peak = Math.max(peak, active);
      try {
        expect(wire.thinking).toEqual({ type: "enabled" }); expect(wire.reasoning_effort).toBe("high");
        if (stage === "chat") {
          await gate.pending; answersFinished.add(state.profile.profileId);
          return response({ message: "一条合成引导句。", claims: [novel(state, state.report.recommendations[0].itemId)] });
        }
        expect(answersFinished.has(state.profile.profileId)).toBe(true);
        return response({ checks: input.assertions.map((row: { key: string }) => ({ key: row.key, supported: true, reason: "Synthetic dependency test only." })) });
      } finally { active--; }
    }));
    const work = Promise.all(states.map(state => draftDecisionChatV7(state, "这种做法有什么限制？", [], { requestId: randomUUID(), deadlineEpochMs: Date.now() + 10_000 })));
    let replies: Awaited<typeof work>;
    try {
      await vi.waitFor(() => expect(calls.filter(row => row.stage === "chat")).toHaveLength(3), { timeout: 1000 });
      expect(peak).toBe(3); expect(calls.some(row => row.stage === "review")).toBe(false);
    } finally { gate.release(); replies = await work; }
    expect(replies).toHaveLength(3); expect(replies.every(reply => reply.claims.length === 1)).toBe(true);
    for (const state of states) expect(calls.filter(row => row.profileId === state.profile.profileId).map(row => row.stage)).toEqual(["chat", "review"]);
    expect(calls).toHaveLength(6);
  });
});
