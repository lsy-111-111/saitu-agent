import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ persistent: false, pool: undefined as pg.Pool | undefined }));
vi.mock("@/lib/db/pool", () => ({
  isDatabaseConfigured: () => database.persistent,
  getPool: () => { if (!database.pool) throw new Error("private_api_count_fixture_not_ready"); return database.pool; },
}));

import { createUserUnboundedValidationTokenV7, USER_UNBOUNDED_VALIDATION_HEADER_V7 } from "@/lib/ai/execution-authorization";
import { effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import { USER_UNBOUNDED_AUTHORIZATION, USER_UNBOUNDED_AUTHORIZATION_POLICY, USER_UNBOUNDED_CONDITION_SCHEMA,
  USER_UNBOUNDED_EXECUTION_LIMITS, USER_UNBOUNDED_GRANT_VERSION } from "@/lib/ai/execution-policy.mjs";
import { createV7TestDatabase } from "../helpers/v7-database-environment";

const original = { ...process.env }, origin = "http://127.0.0.1:31337", batch = "saitu-v7-top5-unbounded-20261109-formal-91";
const policy = { version: "saitu.effort-policy.v1", rank: "low", explain: "low", review: "low" } as const;
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
let limiter: typeof import("@/lib/security/rate-limit");
let active = true;

function condition(mainRunId: string, policySha256: string) {
  return { schemaVersion: USER_UNBOUNDED_CONDITION_SCHEMA, authorization: USER_UNBOUNDED_AUTHORIZATION, sourcePolicy: USER_UNBOUNDED_AUTHORIZATION_POLICY,
    executionMode: "user-unbounded", executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS, policyVersion: "saitu.policy.2026-11-09.v7.top5",
    implementationVersion: "saitu.async.2026-11-09.v7.3.top5", model: "deepseek-flash", effort: "stage", mainRunId, phase: "formal",
    policySha256, effortPolicy: policy, effortPolicySha256: effortPolicySha256(policy), freshPgRowsVerified: true, priorLedgerSha256: sha("[]") };
}
function authorizationRow() {
  return { main_run_id: "synthetic-api-count-main", grant_version: USER_UNBOUNDED_GRANT_VERSION, state: active ? "active" : "closed",
    authorized_phase: "formal", authorized_effort: "stage", policy_sha256: "d".repeat(64), effort_condition_sha256: "e".repeat(64),
    effort_condition: condition("synthetic-api-count-main", "d".repeat(64)), effort_policy: policy, effort_policy_sha256: effortPolicySha256(policy),
    execution_mode: "user-unbounded", call_limit: null, budget_mode: "user-unbounded", hard_limit_micros: null };
}
function request(index: string | number, token?: string, requestOrigin = origin) {
  return new Request(`${requestOrigin}/api/ai/competition-recommend`, { method: "POST", body: "{}", headers: {
    "Content-Type": "application/json", "Idempotency-Key": `api-count-request-${index}`, "X-Real-IP": "203.0.113.92",
    ...(token ? { [USER_UNBOUNDED_VALIDATION_HEADER_V7]: token } : {}),
  } });
}
const token = () => createUserUnboundedValidationTokenV7(origin, Date.now() + 60_000);
const start = (index: string | number, capability?: string, producer = async () => Response.json({ ok: true }), requestOrigin = origin) =>
  limiter.executeCompetitionSessionStart({ request: request(index, capability, requestOrigin), requestId: `api-count-owner-${index}`,
    operation: "competition_normalize", transitionId: limiter.competitionTransitionId("competition_normalize", { index }), producer });
const transition = (sessionId: string, index: string | number, capability?: string,
  producer = async () => Response.json({ ok: true }), transitionId?: string) => limiter.executeCompetitionSessionTransition({
  request: request(index, capability), requestId: `api-transition-owner-${index}`, operation: "competition_chat", sessionId,
  sessionExpiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 1800,
  transitionId: transitionId ?? limiter.competitionTransitionId("competition_chat", { index }), producer,
});

beforeAll(async () => {
  Object.assign(process.env, { SESSION_STARTS_PER_IP_MINUTE: "2", SESSION_STARTS_PER_IP_DAY: "3", SESSION_TRANSITIONS_PER_SESSION: "2", MAX_TRACK_PER_IP_MINUTE: "2" });
  limiter = await import("@/lib/security/rate-limit");
});
beforeEach(() => {
  active = true; database.persistent = false;
  // Memory-path tests use the real HMAC/origin/grant predicate with a synthetic
  // query result. The separate describe below uses actual disposable PostgreSQL.
  database.pool = { query: vi.fn(async () => ({ rows: [authorizationRow()], rowCount: 1 })) } as unknown as pg.Pool;
  Object.assign(process.env, { DATABASE_URL: "", SAITU_AI_EXECUTION_MODE: "user-unbounded", AI_SPEND_RUN_ID: batch, AI_SPEND_PHASE: "formal",
    AI_SPEND_AUTHORIZED_EFFORT: "stage", AI_SPEND_POLICY_SHA256: "d".repeat(64), AI_SPEND_EFFORT_CONDITION_SHA256: "e".repeat(64),
    SAITU_V7_EFFORT_POLICY: JSON.stringify(policy), SAITU_V7_EFFORT_POLICY_SHA256: effortPolicySha256(policy),
    AI_CONVERSATION_SIGNING_SECRET: "synthetic-api-counter-signing-secret-no-real-credentials" });
  limiter.resetRateLimitStateForTests();
  vi.spyOn(console, "info").mockImplementation(() => undefined); vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", () => { throw new Error("api_count_tests_forbid_all_network"); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); process.env = { ...original }; database.persistent = false; database.pool = undefined; });
afterAll(() => { process.env = { ...original }; });

describe("signed user-unbounded validation API counters", () => {
  it("allows a verified collector above both start quotas while recording hits and retaining normal limits", async () => {
    const capability = token();
    for (let index = 0; index < 6; index++) expect((await start(index, capability)).status).toBe(200);
    const producer = vi.fn(async () => Response.json({ ok: true }));
    const ordinary = await start("ordinary-after-collector", undefined, producer);
    expect(ordinary.status).toBe(429); expect(await ordinary.json()).toMatchObject({ bucket: "session_start_minute" });
    expect(producer).not.toHaveBeenCalled();
  });

  it.each(["only-env", "forged", "wrong-origin", "expired", "closed-grant", "finite-mode"])("keeps ordinary start limits for %s", async kind => {
    let capability: string | undefined = token();
    if (kind === "only-env") capability = undefined;
    if (kind === "forged") capability = `${capability!.slice(0, -1)}${capability!.endsWith("A") ? "B" : "A"}`;
    if (kind === "expired") {
      const expiry = Date.now() + 60_000;
      capability = createUserUnboundedValidationTokenV7(origin, expiry);
      vi.spyOn(Date, "now").mockReturnValue(expiry + 1);
    }
    if (kind === "closed-grant") active = false;
    if (kind === "finite-mode") process.env.SAITU_AI_EXECUTION_MODE = "finite";
    const requestOrigin = kind === "wrong-origin" ? "http://127.0.0.1:31338" : origin;
    expect((await start(1, capability, undefined, requestOrigin)).status).toBe(200);
    expect((await start(2, capability, undefined, requestOrigin)).status).toBe(200);
    expect((await start(3, capability, undefined, requestOrigin)).status).toBe(429);
  });

  it("allows collector transitions above quota without relaxing signed session expiry", async () => {
    const capability = token(), sessionId = randomUUID();
    for (let index = 0; index < 6; index++) expect((await transition(sessionId, index, capability)).status).toBe(200);
    expect((await transition(sessionId, "ordinary-after-collector")).status).toBe(429);
    const producer = vi.fn(async () => Response.json({ ok: true }));
    const tooLong = await limiter.executeCompetitionSessionTransition({ request: request("bad-expiry", capability), requestId: "bad-expiry-request",
      sessionId, sessionExpiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 1802, operation: "competition_chat", transitionId: "invalid-expiry-transition", producer });
    expect(tooLong.status).toBe(429); expect(producer).not.toHaveBeenCalled();
  });

  it("keeps one pending producer and replay identity for collector requests above transition quota", async () => {
    const capability = token(), sessionId = randomUUID();
    for (let index = 0; index < 2; index++) await transition(sessionId, index, capability);
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const producer = vi.fn(async () => { await wait; return Response.json({ ok: true, value: "same-owner" }); });
    const transitionId = limiter.competitionTransitionId("competition_chat", { same: true });
    const first = transition(sessionId, "pending-first", capability, producer, transitionId);
    const duplicate = transition(sessionId, "pending-second", capability, producer, transitionId);
    try { await vi.waitFor(() => expect(producer).toHaveBeenCalledTimes(1)); }
    finally { release(); }
    const responses = await Promise.all([first, duplicate]);
    expect(responses.every(value => value.status === 200)).toBe(true); expect(producer).toHaveBeenCalledTimes(1);
    expect(responses[1].headers.get("X-Request-ID")).toBe("api-transition-owner-pending-second");
    expect(await responses[1].json()).toMatchObject({ value: "same-owner" });
  });

  it("preserves the per-transition retry boundary for a signed collector", async () => {
    const capability = token(), producer = vi.fn(async () => {
      const value = Response.json({ ok: true }); value.headers.set("X-Idempotency-Cache", "no-store"); return value;
    });
    for (let index = 0; index < 3; index++) expect((await start("same-retry", capability, producer)).status).toBe(200);
    const exhausted = await start("same-retry", capability, producer);
    expect(exhausted.status).toBe(429); expect(await exhausted.json()).toMatchObject({ bucket: "transition_retries" });
    expect(producer).toHaveBeenCalledTimes(3);
  });

  it("lifts only verified collector polling counts and leaves track and ordinary polling limits intact", async () => {
    const capability = token(), signed = request("poll", capability);
    for (let index = 0; index < 260; index++) expect((await limiter.checkDecisionPollRateLimitV7(signed)).ok).toBe(true);
    expect((await limiter.checkDecisionPollRateLimitV7(request("ordinary-poll"))).ok).toBe(false);
    expect(limiter.checkRateLimit(signed, "track").ok).toBe(true);
    expect(limiter.checkRateLimit(signed, "track").ok).toBe(true);
    expect(limiter.checkRateLimit(signed, "track").ok).toBe(false);
    limiter.resetRateLimitStateForTests();
    for (let index = 0; index < 240; index++) expect((await limiter.checkDecisionPollRateLimitV7(request("ordinary-poll"))).ok).toBe(true);
    expect((await limiter.checkDecisionPollRateLimitV7(request("ordinary-poll"))).ok).toBe(false);
  });
});

const integration = process.env.RUN_V7_DATABASE_TESTS === "1" ? describe : describe.skip;
integration("signed collector API counters on an owned disposable PostgreSQL database", () => {
  let fixture: Awaited<ReturnType<typeof createV7TestDatabase>>, pool: pg.Pool;
  let policySha: string, conditionSha: string;
  beforeAll(async () => {
    fixture = await createV7TestDatabase("durable");
    expect(fixture.database).toMatch(/^saitu_v7_durable_[a-f0-9]{32}$/);
    expect((await fixture.admin.query("select current_database() as name")).rows[0].name).toBe(fixture.database);
    await fixture.admin.query(readFileSync("db/migrations/20261109_spend_user_unbounded_execution.sql", "utf8"));
    const main = `synthetic-api-main-${randomUUID()}`;
    policySha = sha(readFileSync(USER_UNBOUNDED_AUTHORIZATION_POLICY));
    const grantCondition = condition(main, policySha); conditionSha = sha(JSON.stringify(grantCondition));
    await fixture.admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros,execution_mode) values($1,10000000,null),($2,null,'user-unbounded')", [main, batch]);
    await fixture.admin.query("insert into ai_spend_authority(singleton,run_id) values(true,$1)", [main]);
    await fixture.admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,
      baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256,effort_policy,effort_policy_sha256,execution_mode)
      values($1,$2,null,10000000,0,10000000,'{}','Synthetic API counters, owned disposable DB','stage',$3,$4::jsonb,$5,'formal',$6,$7::jsonb,$8,'user-unbounded')`,
      [batch, main, conditionSha, JSON.stringify(grantCondition), USER_UNBOUNDED_GRANT_VERSION, policySha, JSON.stringify(policy), effortPolicySha256(policy)]);
    pool = new pg.Pool({ connectionString: fixture.runtimeUrl, max: 10 });
  });
  beforeEach(async () => {
    await fixture.admin.query("truncate competition_idempotency,competition_session_transitions,competition_sessions,competition_session_starts,competition_rate_limit_counters");
    database.persistent = true; database.pool = pool;
    Object.assign(process.env, { DATABASE_URL: fixture.runtimeUrl, AI_SPEND_POLICY_SHA256: policySha, AI_SPEND_EFFORT_CONDITION_SHA256: conditionSha });
  });
  afterAll(async () => { await pool?.end(); await fixture?.close(); });

  it("records start counts above both limits only for the signed active-grant collector", async () => {
    const capability = token();
    for (let index = 0; index < 6; index++) expect((await start(index, capability)).status).toBe(200);
    expect((await fixture.admin.query("select bucket,hit_count from competition_rate_limit_counters order by bucket")).rows).toEqual([
      { bucket: "session_start_daily", hit_count: 6 }, { bucket: "session_start_minute", hit_count: 6 },
    ]);
    const producer = vi.fn(async () => Response.json({ ok: true }));
    expect((await start("unsigned", undefined, producer)).status).toBe(429); expect(producer).not.toHaveBeenCalled();
  });

  it("preserves persistent pending and retry guards above the signed collector transition quota", async () => {
    const capability = token(), sessionId = randomUUID();
    for (let index = 0; index < 6; index++) expect((await transition(sessionId, index, capability)).status).toBe(200);
    expect((await fixture.admin.query("select count(*)::int as n from competition_session_transitions")).rows[0].n).toBe(6);
    expect((await transition(sessionId, "unsigned")).status).toBe(429);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const pendingProducer = vi.fn(async () => { await pending; return Response.json({ ok: true, value: "one-persistent-owner" }); });
    const pendingId = limiter.competitionTransitionId("competition_chat", { pending: true });
    const owner = transition(sessionId, "pending-owner", capability, pendingProducer, pendingId);
    await vi.waitFor(() => expect(pendingProducer).toHaveBeenCalledTimes(1));
    const reads = vi.spyOn(pool, "query");
    const duplicate = transition(sessionId, "pending-duplicate", capability, pendingProducer, pendingId);
    try {
      await vi.waitFor(() => expect(reads.mock.calls.some(([query]) => typeof query === "string" && query.includes("select state, generation"))).toBe(true));
    } finally { release(); }
    const pendingResponses = await Promise.all([owner, duplicate]);
    expect(pendingResponses.every(value => value.status === 200)).toBe(true); expect(pendingProducer).toHaveBeenCalledTimes(1);
    expect(pendingResponses[1].headers.get("X-Idempotent-Replay")).toBe("true");
    const producer = vi.fn(async () => Response.json({ ok: false }, { status: 503 }));
    const transitionId = limiter.competitionTransitionId("competition_chat", { retry: true });
    for (let index = 0; index < 3; index++) expect((await transition(sessionId, `retry-${index}`, capability, producer, transitionId)).status).toBe(503);
    const exhausted = await transition(sessionId, "retry-final", capability, producer, transitionId);
    expect(exhausted.status).toBe(429); expect(await exhausted.json()).toMatchObject({ bucket: "transition_retries" });
    expect(producer).toHaveBeenCalledTimes(3);
  });
});
