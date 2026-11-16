import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/pool", () => ({
  isDatabaseConfigured: () => false,
  getPool: vi.fn(() => { throw new Error("database_forbidden_in_role_transport_test"); }),
}));
// Authority and spend are explicit local fixtures. Only the JSON request,
// response parsing and production schema/failure routing are under test.
vi.mock("@/lib/ai/execution-authorization", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/ai/execution-authorization")>(),
  readUserUnboundedExecutionAuthorizationV7: vi.fn(async () => ({ runId: "synthetic-role-transport-grant", mainRunId: "synthetic", phase: "calibration",
    policySha256: "a".repeat(64), effortPolicySha256: "b".repeat(64), conditionSha256: "c".repeat(64) })),
}));
vi.mock("@/lib/ai/spend-ledger", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/ai/spend-ledger")>(),
  reserveAiSpend: vi.fn(async () => ({ ok: true as const, reservation: { id: "synthetic-role-transport-reservation", reservedMicros: 0, settle: async () => 0 } })),
}));

import { requestAiJson } from "@/lib/ai/ai-client";
import { getPool } from "@/lib/db/pool";
import { DEFAULT_EFFORT_POLICY, effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import { resetModelCallGovernorForTests } from "@/lib/ai/model-call-governor";
import { buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import { createExplanationGroupSpecsV7, generateGroupExplanationV7 } from "@/lib/competitions/v7/explanation-groups";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { groupReasonFixture } from "./group-reason-fixture";

type Wire = { messages: { role: string; content: string }[]; thinking: { type: string }; reasoning_effort: string };
let wires: Wire[];
let envelope: (prompt: Record<string, any>) => Record<string, any>;

function fixture() {
  const record = syntheticRecord(31), context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records: [record] });
  const studentFactId = context.profile.facts.find(fact => fact.field === "skills")!.id;
  const claim = (text: string) => ({ text, basis: "inference" as const, studentFactIds: [studentFactId], competitionFactIds: [record.facts[0].id], conditions: [] });
  const plan = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
    recommendations: [{ itemId: record.recordId, reasons: [claim("内部排序提示，未作实际推荐证据。" )] }], shortfallReason: "合成候选只有一项。" };
  const run = { runId: randomUUID(), stateKey: "role-transport-offline", generation: 0, implementationSha256: "a".repeat(64), effortPolicySha256: effortPolicySha256(DEFAULT_EFFORT_POLICY), detailDeadlineEpochMs: Date.now() + 150_000 };
  const [spec] = createExplanationGroupSpecsV7(context, plan, run);
  envelope = prompt => ({ schemaVersion: "saitu.group-explanation.v1", groupBindingSha256: prompt.groupBindingSha256,
    groupId: spec.groupId, profileRevision: context.profile.revision, catalogVersion: context.catalogVersion,
    recommendations: [{ rowIndex: 0, reason: groupReasonFixture(0, 0),
      roleIndex: 0 }], shortfallReason: plan.shortfallReason });
  return { record, context, plan, run, spec };
}

beforeEach(() => {
  wires = [];
  for (const [key, value] of Object.entries({ DATABASE_URL: "", AI_SPEND_RUN_ID: "", RUN_SPEND_LEDGER_POSTGRES_TESTS: "", RUN_DEEPSEEK_LIVE: "",
    AI_PROVIDER: "deepseek", AI_API_KEY: "synthetic-never-networked", AI_API_URL: "https://api.deepseek.com/chat/completions",
    SAITU_AI_EXECUTION_MODE: "user-unbounded", SAITU_V7_EFFORT_POLICY: JSON.stringify(DEFAULT_EFFORT_POLICY),
    SAITU_V7_EFFORT_POLICY_SHA256: effortPolicySha256(DEFAULT_EFFORT_POLICY), AI_SPEND_AUTHORIZED_EFFORT: "stage",
    AI_TIMEOUT_MS: "150000", AI_REQUEST_DEADLINE_MS: "150000" })) vi.stubEnv(key, value);
  vi.mocked(getPool).mockClear();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: RequestInit) => {
    expect(String(url)).toBe("https://api.deepseek.com/chat/completions");
    const wire = JSON.parse(String(init.body)) as Wire;
    wires.push(wire);
    const prompt = JSON.parse(wire.messages.find(row => row.role === "user")!.content);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(envelope(prompt)) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 40, prompt_cache_hit_tokens: 0 } }), { status: 200 });
  }));
});
afterEach(() => {
  expect(getPool).not.toHaveBeenCalled();
  resetModelCallGovernorForTests();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe("new role binding through actual JSON transport and schema parsing", () => {
  it.each(["missing-index", "missing-reason", "array-instead-of-reason", "null-index", "null-reason", "wrong-index-type", "wrong-reason-type"])("fails %s once without a fallback action or a paid retry", async defect => {
    const { context, plan, spec, run } = fixture(), valid = envelope;
    envelope = prompt => {
      const value = valid(prompt), row = value.recommendations[0];
      if (defect === "missing-index") delete row.roleIndex;
      if (defect === "missing-reason") delete row.reason;
      if (defect === "array-instead-of-reason") row.reason = [];
      if (defect === "null-index") row.roleIndex = null;
      if (defect === "null-reason") row.reason = null;
      if (defect === "wrong-index-type") row.roleIndex = "0";
      if (defect === "wrong-reason-type") row.reason = "待核角色动作";
      return value;
    };
    await expect(generateGroupExplanationV7(context, plan, spec, { requestId: run.runId, runBinding: run,
      deadlineEpochMs: run.detailDeadlineEpochMs - 750, modelCall: (prompt, options) => requestAiJson(prompt, options) })).rejects.toThrow("invalid_output");
    expect(wires).toHaveLength(1);
    expect(wires[0]).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "low" });
  });

  it("retains the existing one structural repair for an explicitly supplied malformed joint claim", async () => {
    const { context, plan, spec, run } = fixture(), valid = envelope;
    envelope = prompt => {
      const value = valid(prompt), reason = value.recommendations[0].reason;
      value.recommendations[0].reason = { ...reason, unexpectedField: true };
      return value;
    };
    await expect(generateGroupExplanationV7(context, plan, spec, { requestId: run.runId, runBinding: run,
      deadlineEpochMs: run.detailDeadlineEpochMs - 750, modelCall: (prompt, options) => requestAiJson(prompt, options) })).rejects.toThrow("invalid_output");
    expect(wires).toHaveLength(2);
  });

  it("preserves the valid selected role and puts its actual action into synchronous review", async () => {
    const { record, context, plan, spec, run } = fixture();
    const result = await generateGroupExplanationV7(context, plan, spec, { requestId: run.runId, runBinding: run,
      deadlineEpochMs: run.detailDeadlineEpochMs - 750, modelCall: (prompt, options) => requestAiJson(prompt, options) });
    expect(wires).toHaveLength(1);
    expect(result.prepared.explanation.recommendations[0].roleIndex).toBe(0);
    expect(result.prepared.explanation.recommendations[0].roleReason).toEqual(result.prepared.explanation.recommendations[0].reasons[0]);
    expect(result.prepared.explanation.recommendations[0].roleReason).not.toBe(result.prepared.explanation.recommendations[0].reasons[0]);
    expect(result.prepared.criticalKeys).toContain(`${record.recordId}.role`);
    expect(result.prepared.explanation.shortfallReason).toBe(plan.shortfallReason);
  });
});
