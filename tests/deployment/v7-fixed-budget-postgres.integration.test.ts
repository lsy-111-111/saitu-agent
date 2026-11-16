import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createSpendPostgresFixture } from "../helpers/spend-postgres-fixture";
import { getPool } from "@/lib/db/pool";
// @ts-expect-error Standalone root control has no TypeScript declaration.
import { authorizationSha256, createBudgetPermit, reservationSql, settlementPlan, settlementSql, transitionSql, validateSpendPolicy } from "../../scripts/lib/release-evidence-spend.mjs";
// @ts-expect-error Standalone fixed verifier has no TypeScript declaration.
import { fixedRequestDefinitions } from "../../scripts/lib/release-evidence-deepseek-verifier.mjs";

const integration = process.env.RUN_SPEND_LEDGER_POSTGRES_TESTS === "1" ? describe : describe.skip;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const createdAt = "2026-11-09T00:00:00.000123Z";
type Request = { reservationId: string; requestSha256: string; operation: string; reservedMicros: number };
integration("v7 fixed budget on an asserted random disposable database; zero provider", () => {
  const original = { ...process.env };
  let fixture: Awaited<ReturnType<typeof createSpendPostgresFixture>>;
  async function assertDisposable() {
    expect(fixture.database).toMatch(/^saitu_spend_test_[a-f0-9]{32}$/);
    expect(new URL(process.env.DATABASE_URL!).pathname).toBe(`/${fixture.database}`);
    const adminIdentity = (await fixture.admin.query("select current_database() as database")).rows[0];
    const runtimeIdentity = (await getPool().query("select current_database() as database")).rows[0];
    expect(adminIdentity.database).toBe(fixture.database); expect(runtimeIdentity.database).toBe(fixture.database);
    if (adminIdentity.database !== fixture.database || runtimeIdentity.database !== fixture.database || !/^saitu_spend_test_[a-f0-9]{32}$/.test(fixture.database)) throw Error("refuse_non_disposable_budget_database");
  }
  beforeAll(async () => {
    fixture = await createSpendPostgresFixture(); await assertDisposable();
    console.info(JSON.stringify({ event: "v7_fixed_budget_disposable_database", database: fixture.database, adminAndRuntimeIdentityVerified: true, sharedLedgerTouched: false }));
  });
  afterAll(async () => {
    const database = fixture?.database;
    await fixture?.close(); process.env = { ...original };
    if (database) console.info(JSON.stringify({ event: "v7_fixed_budget_disposable_database_closed", database, dropCompleted: true }));
  });
  beforeEach(async () => {
    await assertDisposable();
    await fixture.admin.query("delete from ai_spend_ledger;delete from ai_spend_development_batches;delete from ai_spend_authority;delete from ai_spend_budgets;");
  });
  async function execute(sql: string) {
    const client = await getPool().connect();
    try { return await client.query(sql); } finally { await client.query("rollback"); client.release(); }
  }
  async function grant(phase = "formal", calls = 4, fundingLimit = 300000000) {
    const mainRunId = `synthetic-main-${randomUUID()}`, runId = `saitu-v7-20261109-${phase}-00`;
    await fixture.bind(mainRunId, 300000000);
    await fixture.admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,300000000)", [runId]);
    const condition = { schemaVersion: "saitu.user-approved-budget-condition.v7", model: "deepseek-flash", effort: "high", phase,
      policySha256: "a".repeat(64), authorization: "user-approved-20261109-continuation", freshPgRowsVerified: true };
    await fixture.admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,state,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,created_at,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256)
      values($1,$2,$3,'active',300000000,0,$4,'{}'::uuid[],'synthetic random database only',$5,'high',$6,$7,'saitu.v7',$8,$9)`,
    [runId, mainRunId, calls, fundingLimit, createdAt, "c".repeat(64), condition, phase, "a".repeat(64)]);
    const policy = validateSpendPolicy({ schemaVersion: "release-evidence-spend-policy.v7", runId, phase,
      pgServiceFile: "/etc/resume-ai/ai-spend-ledger.pg_service.conf", pgService: "synthetic_disposable", limitCny: 300, fundedCny: 200,
      authorization: { mainRunId, grantVersion: "saitu.v7", policySha256: "a".repeat(64), authorizedEffort: "high", effortConditionSha256: "c".repeat(64), callLimit: calls,
        funding: { runId, createdAt, fundingLimitMicros: fundingLimit, baselineIdsSha256: digest("") } } });
    return createBudgetPermit(policy, "b".repeat(64), fixedRequestDefinitions("v7-high"));
  }
  const rebind = (p: Awaited<ReturnType<typeof grant>>) => { p.authorizationSha256 = authorizationSha256(p.authorization); return p; };
  async function seedLedger(runId: string, phase: string, charged: number | null, reserved = charged ?? 100, id = randomUUID()) {
    await fixture.admin.query(`insert into ai_spend_ledger(id,run_id,model,effort,phase,operation,price_version,reserved_micros,charged_micros,state)
      values($1,$2,'deepseek-flash','high',$3,'synthetic-prior-reservation','synthetic-price',$4,$5,$6)`, [id, runId, phase, reserved, charged, charged === null ? "reserved" : "usage_estimated"]);
    return id;
  }
  function event(p: Awaited<ReturnType<typeof grant>>, r: Request, operation: string, extra: Record<string, unknown>) {
    return JSON.stringify({ event: "deepseek_preflight", verifier: "release-evidence-deepseek.v7.1", status: "ok", permitId: p.permitId, permitSha256: "d".repeat(64),
      runId: p.runId, authorizationSha256: p.authorizationSha256, mainRunId: p.authorization.mainRunId, phase: p.phase, reservationId: r.reservationId, requestSha256: r.requestSha256, operation, ...extra });
  }

  it("reserves two existing high batch rows and leaves real singleton/budgets/grants unchanged", async () => {
    const p = await grant(), before = (await fixture.admin.query("select run_id from ai_spend_authority")).rows;
    await execute(reservationSql(p));
    expect((await getPool().query("select effort,state,count(*)::int n from ai_spend_ledger group by effort,state")).rows).toEqual([{ effort: "high", state: "reserved", n: 2 }]);
    expect((await fixture.admin.query("select run_id from ai_spend_authority")).rows).toEqual(before);
    expect((await fixture.admin.query("select count(*)::int n from ai_spend_budgets")).rows[0].n).toBe(2);
    await expect(getPool().query("update ai_spend_development_batches set call_limit=999")).rejects.toThrow(/permission denied/);
  });

  it.each(["main", "missing-batch", "policy", "condition", "calls", "funding-limit", "funding-row", "funding-time", "baseline"])("rejects mismatched %s without inserting either row", async field => {
    const p = await grant();
    if (field === "main") p.authorization.mainRunId = "synthetic-wrong-main";
    if (field === "missing-batch") { p.runId = "saitu-v7-20261109-formal-99"; }
    if (field === "policy") p.authorization.policySha256 = "f".repeat(64);
    if (field === "condition") p.authorization.effortConditionSha256 = "f".repeat(64);
    if (field === "calls") p.authorization.callLimit++;
    if (field === "funding-limit") p.authorization.funding.fundingLimitMicros--;
    if (field === "funding-row") p.authorization.funding.runId = "saitu-v7-20261109-formal-98";
    if (field === "funding-time") p.authorization.funding.createdAt = "2026-11-09T00:00:00.000124Z";
    if (field === "baseline") p.authorization.funding.baselineIdsSha256 = "f".repeat(64);
    await expect(execute(reservationSql(rebind(p)))).rejects.toThrow(/mismatch/);
    expect((await getPool().query("select count(*)::int n from ai_spend_ledger")).rows[0].n).toBe(0);
  });

  it("rejects a closed batch and a changed authorized phase", async () => {
    const p = await grant();
    await fixture.admin.query("update ai_spend_development_batches set state='closed',closed_at=now()");
    await expect(execute(reservationSql(p))).rejects.toThrow("v7_batch_authorization_mismatch");
    await fixture.admin.query("update ai_spend_development_batches set state='active',closed_at=null,authorized_phase='repair',effort_condition=jsonb_set(effort_condition,'{phase}','\"repair\"')");
    await expect(execute(reservationSql(p))).rejects.toThrow("v7_batch_authorization_mismatch");
  });

  it("keeps the existing database hard cap authoritative over caller limits and rejects v1 downgrade for a batch", async () => {
    const p = await grant();
    await fixture.admin.query("update ai_spend_budgets set hard_limit_micros=137735 where run_id=$1", [p.runId]);
    await expect(execute(reservationSql(p))).rejects.toThrow("shared_budget_exhausted");
    const legacy = { ...p, schemaVersion: "release-evidence-budget-permit.v1", requests: fixedRequestDefinitions().map((r: Request) => ({
      operation: r.operation, requestSha256: r.requestSha256, reservedMicros: r.reservedMicros, reservationId: randomUUID(), model: "deepseek-flash", effort: "max", maxTokens: 8192 })) };
    await expect(execute(reservationSql(legacy))).rejects.toThrow("shared_budget_authority_mismatch");
    expect((await getPool().query("select count(*)::int n from ai_spend_ledger")).rows[0].n).toBe(0);
  });

  it("does not reinterpret an existing legacy max development grant as v7 high", async () => {
    const p = await grant();
    await fixture.admin.query("update ai_spend_development_batches set grant_version='legacy',authorized_phase='calibration',policy_sha256=null,authorized_effort='max',effort_condition_sha256=null,effort_condition=null");
    await expect(execute(reservationSql(p))).rejects.toThrow("v7_batch_authorization_mismatch");
  });

  it.each(["calibration", "formal", "repair", "performance", "reserve"])("enforces finite count+2 atomically for %s", async phase => {
    const p = await grant(phase, 3);
    await seedLedger(p.runId, phase, 1); await seedLedger(p.runId, phase, null, 1);
    await expect(execute(reservationSql(p))).rejects.toThrow("v7_batch_call_limit_exhausted");
    expect((await getPool().query("select count(*)::int n from ai_spend_ledger")).rows[0].n).toBe(2);
  });

  it("uses explicit v7 calibration caps rather than reinterpreting legacy 100 calls/30 CNY", async () => {
    const p = await grant("calibration", 104);
    await fixture.admin.query(`insert into ai_spend_ledger(id,run_id,model,effort,phase,operation,price_version,reserved_micros,charged_micros,state)
      select gen_random_uuid(),$1,'deepseek-flash','high','calibration','synthetic-authorized-prior','synthetic-price',300000,300000,'usage_estimated' from generate_series(1,101)`, [p.runId]);
    await execute(reservationSql(p)); expect((await getPool().query("select count(*)::int n from ai_spend_ledger")).rows[0].n).toBe(103);
  });

  it("admits only one concurrent two-row reserve under the same fresh funding checkpoint", async () => {
    const total = 137736, a = await grant("formal", 2, total), b = structuredClone(a);
    b.permitId = randomUUID(); b.requests = b.requests.map((r: Request) => ({ ...r, reservationId: randomUUID() }));
    const result = await Promise.allSettled([execute(reservationSql(a)), execute(reservationSql(b))]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await getPool().query("select count(*)::int n,sum(reserved_micros)::text total from ai_spend_ledger")).rows[0]).toEqual({ n: 2, total: String(total) });
  });

  it("counts unknown spend from main/other phases and excludes only exact UUID checkpoint rows", async () => {
    const p = await grant("formal", 4, 137785), a = p.authorization;
    const baseline = await seedLedger(a.mainRunId, "performance", 400000000);
    await seedLedger(a.mainRunId, "reserve", null, 50);
    await fixture.admin.query("update ai_spend_development_batches set baseline_reservation_ids=$1::uuid[]", [[baseline]]);
    a.funding.baselineIdsSha256 = digest(baseline); rebind(p);
    await expect(execute(reservationSql(p))).rejects.toThrow("v7_fresh_funding_exhausted");
    await fixture.admin.query("update ai_spend_development_batches set funding_limit_micros=funding_limit_micros+1");
    a.funding.fundingLimitMicros++; rebind(p); await execute(reservationSql(p));
  });

  it("counts a closed older development batch in the common fresh balance", async () => {
    const p = await grant("formal", 4, 137785), old = "synthetic-older-batch";
    await fixture.admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,300000000)", [old]);
    await fixture.admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,state,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,created_at,closed_at)
      values($1,$2,2,'closed',300000000,0,300000000,'{}','synthetic older grant','2026-11-08T00:00:00Z','2026-11-08T00:01:00Z')`, [old, p.authorization.mainRunId]);
    await seedLedger(old, "repair", null, 50);
    await expect(execute(reservationSql(p))).rejects.toThrow("v7_fresh_funding_exhausted");
  });

  it("rejects a newer funding checkpoint from another main even while the target grant is active", async () => {
    const p = await grant();
    await fixture.admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros) values('synthetic-other-main',300000000),('synthetic-newer-foreign-funding',300000000)");
    await fixture.admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,state,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,created_at,closed_at)
      values('synthetic-newer-foreign-funding','synthetic-other-main',2,'closed',300000000,0,300000000,'{}','synthetic foreign checkpoint','2026-11-09T00:00:01Z','2026-11-09T00:00:02Z')`);
    await expect(execute(reservationSql(p))).rejects.toThrow("v7_funding_checkpoint_mismatch");
  });

  it.each(["null", "unknown"])("rejects %s UUIDs in a forged funding baseline rather than excluding future spend", async kind => {
    const p=await grant();const ids=kind==="null"?[null]:[randomUUID()];
    await fixture.admin.query("update ai_spend_development_batches set baseline_reservation_ids=$1::uuid[]",[ids]);
    p.authorization.funding.baselineIdsSha256=digest(kind==="null"?"":String(ids[0]));rebind(p);
    await expect(execute(reservationSql(p))).rejects.toThrow("v7_funding_checkpoint_mismatch");
  });

  it("claim is single-launch across clients and does not double-add its held reserve", async () => {
    const p = await grant("formal", 2, 137736); await execute(reservationSql(p));
    const altered = structuredClone(p); altered.fundedMicros--;
    await expect(execute(transitionSql(altered, "claim"))).rejects.toThrow("permit_already_consumed");
    const result = await Promise.allSettled([execute(transitionSql(p, "claim")), execute(transitionSql(p, "claim"))]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    await expect(execute(transitionSql(p, "cancel"))).rejects.toThrow("permit_already_consumed");
  });

  it("rejects stale funding/batch before claim, then permits exact prepared cancellation", async () => {
    const p = await grant(); await execute(reservationSql(p));
    await fixture.admin.query("update ai_spend_development_batches set funding_limit_micros=funding_limit_micros-1");
    await expect(execute(transitionSql(p, "claim"))).rejects.toThrow("v7_funding_checkpoint_mismatch");
    await fixture.admin.query("update ai_spend_development_batches set state='closed',closed_at=now()");
    await execute(transitionSql(p, "cancel"));
    expect((await getPool().query("select state,charged_micros::text charged from ai_spend_ledger")).rows).toEqual([{ state: "cancelled", charged: "0" }, { state: "cancelled", charged: "0" }]);
  });

  it("settles after batch close/authority change, holds unknown cost and rejects changed usage idempotently", async () => {
    const p = await grant(); await execute(reservationSql(p)); await execute(transitionSql(p, "claim")); p.state = "launched";
    const r = p.requests[0], log = [event(p, r, "budget_attempt", { attempt: 1, model: "deepseek-flash", reasoningEffort: "high", maxTokens: 8192 }),
      event(p, r, "budget_terminal", { upstreamAttempted: true, usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 20 } })].join("\n");
    const plan = settlementPlan(p, log, "d".repeat(64));
    await fixture.admin.query("update ai_spend_development_batches set state='closed',closed_at=now();insert into ai_spend_budgets(run_id,hard_limit_micros) values('synthetic-next-main',1);update ai_spend_authority set run_id='synthetic-next-main'");
    await execute(settlementSql(p, plan)); await execute(settlementSql(p, plan));
    const rows = (await getPool().query("select id,state,charged_micros::text charged from ai_spend_ledger")).rows;
    expect(rows.find(row => row.id === r.reservationId)).toMatchObject({ state: "usage_estimated", charged: "561" });
    expect(rows.find(row => row.id !== r.reservationId)).toMatchObject({ state: "conservative", charged: String(p.requests[1].reservedMicros) });
    const changed = structuredClone(plan); changed[0].usage = { inputTokens: 101, outputTokens: 50, cachedInputTokens: 20 }; changed[0].chargedMicros = 563;
    await expect(execute(settlementSql(p, changed))).rejects.toThrow("settlement_binding_mismatch");
  });

  it("cancels only the explicitly undispatched operation after first launched request fails", async () => {
    const p = await grant(); await execute(reservationSql(p)); await execute(transitionSql(p, "claim")); p.state = "launched";
    const r = p.requests[1], log = event(p, r, "budget_terminal", { upstreamAttempted: false, usage: null });
    await execute(settlementSql(p, settlementPlan(p, log, "d".repeat(64))));
    expect((await getPool().query("select state,charged_micros::text charged from ai_spend_ledger where id=$1", [r.reservationId])).rows[0]).toEqual({ state: "cancelled", charged: "0" });
    expect((await getPool().query("select state from ai_spend_ledger where id=$1", [p.requests[0].reservationId])).rows[0].state).toBe("conservative");
  });
});
