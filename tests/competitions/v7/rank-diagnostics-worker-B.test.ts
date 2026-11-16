import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effortPolicySha256, RANK_NON_THINKING_EFFORT_POLICY } from "@/lib/ai/effort-policy.mjs";
import { RECOMMENDATION_EXECUTION_POLICY, RECOMMENDATION_IMPLEMENTATION_VERSION } from "@/lib/competitions/v7/contracts";
import { sealV7, sessionKeyV7, unsealV7 } from "@/lib/competitions/v7/crypto";
import { buildDecisionContextV7, rankDecisionV7 } from "@/lib/competitions/v7/model";
import { createRunWriterV7, freezeContextV7, presentRunV7, type ClaimedRunV7, type DecisionSessionV7, type RunBodyV7 } from "@/lib/competitions/v7/store";
import { processClaimedRunV7 } from "@/lib/competitions/v7/worker";
import { student } from "../v6/decision-fixtures";

const pool = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => pool, isDatabaseConfigured: () => true }));

const source = "f".repeat(64);
const isRankDiagnostic = (event: NonNullable<RunBodyV7["auditObservations"]>[number]) =>
  event.stage === "v7.audit" && (event.data as { source?: string }).source === "rank_diagnostics";
const unrelatedAudit = { stage: "v7.audit", kind: "validation" as const, data: { source: "existing_review_audit" } };

beforeEach(() => {
  vi.stubEnv("SAITU_V7_SOURCE_SHA256", source);
  vi.stubEnv("SAITU_AI_EXECUTION_MODE", "finite");
  vi.stubEnv("SAITU_V7_DETAIL_LAYOUT", "single");
  vi.stubEnv("AI_CONVERSATION_SIGNING_SECRET", "synthetic-rank-audit-isolated-writer-fixture");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_worker_diagnostics_only"); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks();
});

/** The worker, writer queue, binding checks, seal, and commit paths are real.
 * Only the PostgreSQL boundary is supplied by this local fixture. */
function isolatedWriter(mode: "failure" | "delay") {
  const started = Date.now(), runId = randomUUID(), sessionId = randomUUID(), stateKey = sessionKeyV7(sessionId);
  const expires = started + 300_000, legacy = student(), context = buildDecisionContextV7(legacy, { profileId: sessionId });
  const policy = RECOMMENDATION_EXECUTION_POLICY;
  const effortPolicy = RANK_NON_THINKING_EFFORT_POLICY;
  const body: RunBodyV7 = { implementationSha256: source, executionPolicy: policy, executionMode: "finite", sessionGeneration: 0,
    effortPolicy, effortPolicySha256: effortPolicySha256(effortPolicy), detailLayout: "single", context: freezeContextV7(context),
    legacy, items: [], listReadyAt: null, detailsReadyAt: null, shortfallReason: null };
  const session: DecisionSessionV7 = { id: stateKey, sessionId, currentRunId: runId, generation: 0, expiresAt: expires,
    profile: context.profile, legacy, history: [] };
  const state = { ...sealV7(`session:${stateKey}`, session), generation: 0, expires_at: new Date(expires) };
  const claim: ClaimedRunV7 = { owner: "rank-test-worker", fence: "1", body, row: { ...sealV7(`run:${runId}`, body), run_id: runId,
    state_key: stateKey, submission_key: "isolated-rank-diagnostic", implementation_version: RECOMMENDATION_IMPLEMENTATION_VERSION,
    status: "queued", result_version: 0, submitted_at: new Date(started), expires_at: new Date(expires),
    list_deadline_at: new Date(started + policy.rankHardTimeoutMs), detail_deadline_at: new Date(started + policy.detailHardTimeoutMs),
    lease_owner: "rank-test-worker", lease_fence: "1", lease_expires_at: new Date(expires) } };
  let clock = claim.row.list_deadline_at.getTime() - 1000, standaloneAttempts = 0;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const commits: { status: ClaimedRunV7["row"]["status"]; body: RunBodyV7 }[] = [];
  pool.connect.mockResolvedValue({ query: vi.fn(async (sql: string, values: unknown[] = []) => {
    if (["begin", "commit", "rollback"].includes(sql)) return { rows: [] };
    if (sql.includes("from competition_decision_states") && sql.includes("for share")) return { rows: [state] };
    if (!sql.includes("result_version=result_version+1")) throw new Error("unexpected_test_query");
    const [id, owner, fence, status, ciphertext, iv, tag, _terminal, expectedVersion] = values as
      [string, string, string, ClaimedRunV7["row"]["status"], Buffer, Buffer, Buffer, boolean, number];
    expect([id, owner, fence, expectedVersion]).toEqual([runId, claim.owner, claim.fence, claim.row.result_version]);
    const snapshot = unsealV7<RunBodyV7>(`run:${runId}`, { ciphertext, iv, tag });
    if (status === "ranking" && snapshot.auditObservations?.some(isRankDiagnostic)) {
      standaloneAttempts++;
      if (mode === "failure") throw new Error("synthetic_diagnostic_storage_fault");
      clock = claim.row.list_deadline_at.getTime() + 1;
    }
    commits.push({ status, body: snapshot });
    return { rows: [{ ...claim.row, status, ciphertext, iv, tag, result_version: expectedVersion + 1 }] };
  }), release: vi.fn() });
  pool.query.mockResolvedValue({ rows: [], rowCount: 1 });
  return { claim, session, commits, standaloneAttempts: () => standaloneAttempts };
}

describe("v763 private rank audit commits", () => {
  it.each(["failure", "delay"] as const)("avoids a standalone diagnostic write under %s injection", async mode => {
    const { claim, session, commits, standaloneAttempts } = isolatedWriter(mode);
    let rankCalls = 0;
    await processClaimedRunV7(claim, { rank: async (context, options) => {
      if (mode === "delay") await options?.onObservation?.(unrelatedAudit);
      return rankDecisionV7(context, { ...options, modelCall: async (prompt, request) => {
        rankCalls++;
        const wire = JSON.parse(prompt);
        const ids: string[] = wire.candidateIds;
        expect(ids).toHaveLength(45);
        expect(request).toMatchObject({ maxAttempts: 1, thinking: "disabled", maxTokens: 8192 });
        const result = request.schema!.safeParse({ profileRevision: wire.outputFormat.profileRevision, catalogVersion: wire.outputFormat.catalogVersion,
          shortfallReason: null, assessments: ids.map(itemId => ({ itemId, fit: null })),
          rankDiagnostics: { codes: Object.fromEntries(ids.map(id => [id, "L"])) } });
        if (!result.success) throw new Error("unexpected_rank_schema_failure");
        return { ok: true, data: result.data, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", durationMs: 1, attempts: 1 };
      } });
    }, explain: async () => { throw new Error("unexpected_explain"); } });
    expect(rankCalls).toBe(1);
    expect(standaloneAttempts()).toBe(0);
    expect(commits.map(entry => entry.status)).toEqual(mode === "delay" ? ["ranking", "ranking", "list_ready"] : ["ranking", "list_ready"]);
    expect(claim.row.result_version).toBe(commits.length);
    expect(claim.body.plan?.recommendations).toEqual([]);
    const internal = unsealV7<RunBodyV7>(`run:${claim.row.run_id}`, claim.row);
    const diagnostics = internal.auditObservations?.filter(isRankDiagnostic);
    expect(diagnostics).toEqual([expect.objectContaining({ data: expect.objectContaining({ source: "rank_diagnostics", status: "valid", codes: expect.any(Array) }) })]);
    expect((diagnostics?.[0].data as { codes: unknown[] }).codes).toHaveLength(45);
    if (mode === "delay") expect(internal.auditObservations).toContainEqual(unrelatedAudit);
    expect(JSON.stringify(presentRunV7(claim, session))).not.toContain("rank_diagnostics");
  });

  it("demonstrates why an independent diagnostic write poisoned the real writer", async () => {
    const { claim, standaloneAttempts } = isolatedWriter("failure"), writer = createRunWriterV7(claim);
    await writer.update(body => ({ status: "ranking", body }));
    await expect(writer.update(body => ({ status: "ranking", body: { ...body,
      auditObservations: [{ stage: "v7.audit", kind: "validation", data: { source: "rank_diagnostics", status: "absent" } }] } })))
      .rejects.toThrow("synthetic_diagnostic_storage_fault");
    await expect(writer.update(body => ({ status: "list_ready", body }))).rejects.toThrow("synthetic_diagnostic_storage_fault");
    expect(standaloneAttempts()).toBe(1);
    expect(claim.row.result_version).toBe(1);
  });
});
