import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { createV7TestDatabase } from "../helpers/v7-database-environment";
import { effortPolicySha256, parseEffortPolicy } from "../../src/lib/ai/effort-policy.mjs";
// @ts-expect-error Root budget control intentionally remains standalone JavaScript.
import { authorizationSha256, createBudgetPermit, reservationSql, settlementPlan, settlementSql, transitionSql, validateSpendPolicy } from "../../scripts/lib/release-evidence-spend.mjs";
// @ts-expect-error Root verifier intentionally remains standalone JavaScript.
import { fixedRequestDefinitions } from "../../scripts/lib/release-evidence-deepseek-verifier.mjs";

const privateMode = process.env.RUN_V7_RELEASE_PRIVATE_PG === "1";
const integration = privateMode || process.env.RUN_V7_DATABASE_TESTS === "1" ? describe : describe.skip;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const createdAt = "2026-11-09T00:00:00.000123Z";

for (const [top5,unbounded] of [[false,false],[true,false],[true,true]]) integration(unbounded ? "user-unbounded fixed release budget SQL in an isolated random PostgreSQL database" : top5 ? "top5 fixed release budget SQL in an isolated random PostgreSQL database" : "stage fixed release budget SQL in an isolated random PostgreSQL database", () => {
  let fixture: {admin:pg.Client;database:string;close:()=>Promise<void>}, pool: pg.Pool;
  beforeAll(async () => {
    if (!privateMode) {
      const value=await createV7TestDatabase("durable"); fixture=value;
      pool=new pg.Pool({connectionString:value.runtimeUrl,max:4}); return;
    }
    const filename=process.env.V7_RELEASE_PRIVATE_CONFIG??"";
    expect(filename).toMatch(/^\/(?:private\/)?tmp\/saitu-top5-f-[A-Za-z0-9]+\/client\.json$/);
    const config=JSON.parse(readFileSync(filename,"utf8"));
    expect(config.host).toBe(filename.slice(0,-"client.json".length)+"socket");
    expect(config.dataDirectory).toBe(filename.slice(0,-"client.json".length)+"data");
    expect(config.database).toMatch(/^top5_private_[a-f0-9]{16}$/); expect(config.port).toBe(55481);
    expect(config.runtime).toBe("top5_runtime");
    const admin=new pg.Client({host:config.host,port:config.port,user:"f_top5_admin",database:config.database});
    await admin.connect();
    expect((await admin.query("select current_database() as db,session_user as role,current_setting('unix_socket_directories') as socket,current_setting('data_directory') as data,current_setting('listen_addresses') as addresses")).rows[0])
      .toEqual({db:config.database,role:"f_top5_admin",socket:config.host,data:config.dataDirectory,addresses:""});
    expect((await admin.query("select nonce from top5_test_control")).rows[0].nonce).toBe(config.nonce);
    fixture={admin,database:config.database,close:()=>admin.end()};
    pool=new pg.Pool({host:config.host,port:config.port,user:config.runtime,database:config.database,max:4});
  }, 120000);
  afterAll(async () => { await pool?.end(); await fixture?.close(); });
  beforeEach(async () => {
    expect(fixture.database).toMatch(privateMode ? /^top5_private_[a-f0-9]{16}$/ : /^saitu_v7_durable_[a-f0-9]{32}$/);
    expect((await fixture.admin.query("select current_database() as database")).rows[0].database).toBe(fixture.database);
    expect((await pool.query("select current_database() as database")).rows[0].database).toBe(fixture.database);
    const runtimeRole = (await pool.query("select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows[0];
    expect(runtimeRole).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false });
    await fixture.admin.query("delete from ai_spend_ledger;delete from ai_spend_development_batches;delete from ai_spend_authority;delete from ai_spend_budgets;");
  });
  async function execute(sql: string) {
    const client = await pool.connect();
    try { return await client.query(sql); } finally { await client.query("rollback"); client.release(); }
  }
  async function grant(callLimit = 4) {
    const mainRunId = `synthetic-fixed-main-${randomUUID()}`, runId = `saitu-v7-${unbounded ? "top5-unbounded" : top5 ? "top5" : "effort"}-20261109-formal-00`;
    const effortPolicy = parseEffortPolicy({ version: "saitu.effort-policy.v1", rank: "low", explain: "low", review: top5 ? "low" : "high" }), fingerprint = effortPolicySha256(effortPolicy);
    const condition = { schemaVersion: unbounded ? "saitu.user-approved-budget-condition.v7.top5.user-unbounded.v1" : top5 ? "saitu.user-approved-budget-condition.v7.top5.v1" : "saitu.user-approved-budget-condition.v7.effort.v1", model: "deepseek-flash", effort: "stage", mainRunId, phase: "formal", policySha256: "a".repeat(64), effortPolicy, effortPolicySha256: fingerprint, authorization: unbounded ? "user-approved-20261109-top5-unbounded-execution" : top5 ? "user-approved-20261109-top5-continuation" : "user-approved-20261109-effort-exploration", freshPgRowsVerified: true, ...(top5 ? {sourcePolicy:unbounded?"docs/v7/top5-unbounded-execution-contract-20261109.md":"docs/v7/top5-continuation-contract-20261109.md",policyVersion:"saitu.policy.2026-11-09.v7.top5",implementationVersion:"saitu.async.2026-11-09.v7.3.top5",priorLedgerSha256:sha("isolated synthetic fixed SQL")} : {}),...(unbounded?{executionMode:"user-unbounded",executionLimits:{modelConcurrencyLimit:null,totalCallLimit:null,totalCostLimitMicros:null}}:{}) };
    const conditionSha = sha(JSON.stringify(condition));
    await fixture.admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros,execution_mode) values($1,$3,$4),($2,$3,$4)", [mainRunId, runId,unbounded?null:1000000,unbounded?"user-unbounded":null]);
    await fixture.admin.query("insert into ai_spend_authority(singleton,run_id) values(true,$1)", [mainRunId]);
    await fixture.admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,created_at,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256,effort_policy,effort_policy_sha256,execution_mode)
      values($1,$2,$3,1000000,0,1000000,'{}','synthetic fixed SQL gate',$4,'stage',$5,$6::jsonb,'${unbounded ? 'saitu.v7.top5.user-unbounded.v1' : top5 ? 'saitu.v7.top5.v1' : 'saitu.v7.effort.v1'}','formal',$7,$8::jsonb,$9,$10)`, [runId, mainRunId, unbounded?null:callLimit, createdAt, conditionSha, JSON.stringify(condition), "a".repeat(64), JSON.stringify(effortPolicy), fingerprint,unbounded?"user-unbounded":null]);
    const configured = validateSpendPolicy({ schemaVersion: unbounded ? "release-evidence-spend-policy.v7.top5.user-unbounded.v1" : top5 ? "release-evidence-spend-policy.v7.top5.v1" : "release-evidence-spend-policy.v7.effort.v1", runId, phase: "formal", pgServiceFile: "/etc/resume-ai/ai-spend-ledger.pg_service.conf", pgService: "synthetic_disposable", limitCny: unbounded?null:1, fundedCny: 1,...(unbounded?{executionMode:"user-unbounded"}:{}),
      authorization: { mainRunId, grantVersion: unbounded ? "saitu.v7.top5.user-unbounded.v1" : top5 ? "saitu.v7.top5.v1" : "saitu.v7.effort.v1", policySha256: "a".repeat(64), authorizedEffort: "stage", effortConditionSha256: conditionSha, effortPolicy, effortPolicySha256: fingerprint, callLimit:unbounded?null:callLimit,...(unbounded?{executionMode:"user-unbounded"}:{}),
        funding: { runId, createdAt, fundingLimitMicros: 1000000, baselineIdsSha256: sha("") } } });
    return createBudgetPermit(configured, "b".repeat(64), fixedRequestDefinitions(unbounded ? "v7-top5-user-unbounded" : top5 ? "v7-top5" : "v7-effort", effortPolicy));
  }

  it("executes exact paired reservation, claim and cancellation with separate high and low ledger rows", async () => {
    const p = await grant(), before = (await fixture.admin.query("select * from ai_spend_authority")).rows;
    await execute(reservationSql(p));
    expect((await pool.query("select effort,effort_policy_sha256 from ai_spend_ledger order by effort")).rows).toEqual(["high", "low"].map(effort => ({ effort, effort_policy_sha256: p.authorization.effortPolicySha256 })));
    expect((await fixture.admin.query("select * from ai_spend_authority")).rows).toEqual(before);
    await execute(transitionSql(p, "claim")); p.state = "launched";
    const terminal = JSON.stringify({ event: "deepseek_preflight", ...(unbounded?{executionMode:"user-unbounded"}:{}), verifier: unbounded ? "release-evidence-deepseek.v7.top5.user-unbounded.v1" : top5 ? "release-evidence-deepseek.v7.top5.v1" : "release-evidence-deepseek.v7.effort.v1", operation: "budget_terminal", permitId: p.permitId, permitSha256: "d".repeat(64), runId: p.runId, authorizationSha256: p.authorizationSha256, mainRunId: p.authorization.mainRunId, phase: p.phase, reservationId: p.requests[0].reservationId, requestSha256: p.requests[0].requestSha256, upstreamAttempted: false, usage: null });
    await execute(settlementSql(p, settlementPlan(p, terminal, "d".repeat(64))));
    const rows = (await pool.query("select id,state,charged_micros::text charged from ai_spend_ledger")).rows;
    expect(rows.find(r => r.id === p.requests[0].reservationId)).toMatchObject({ state: "cancelled", charged: "0" });
    expect(rows.find(r => r.id === p.requests[1].reservationId)).toMatchObject({ state: "conservative", charged: String(p.requests[1].reservedMicros) });
  });

  it(unbounded?"rejects policy substitution and unknown physical funding exhaustion without inserting either reservation":"rejects policy substitution and a database cap without inserting either reservation", async () => {
    const p = await grant(), changed = structuredClone(p); changed.authorization.effortPolicy.review = top5 ? "high" : "low"; changed.authorization.effortPolicySha256 = effortPolicySha256(changed.authorization.effortPolicy); changed.authorizationSha256 = authorizationSha256(changed.authorization);
    if (top5) expect(() => reservationSql(changed)).toThrow(/top5 requires/);
    else await expect(execute(reservationSql(changed))).rejects.toThrow(/effort_policy_mismatch/);
    if(unbounded){
      await fixture.admin.query("insert into ai_spend_ledger(id,run_id,model,effort,phase,operation,price_version,reserved_micros,charged_micros,state) values($1,$2,'deepseek-flash','high','formal','synthetic-unknown-hold','synthetic-fixed',900000,900000,'conservative')",[randomUUID(),p.runId]);
      await expect(execute(reservationSql(p))).rejects.toThrow(/fresh_funding_exhausted/);
    }else{
      await fixture.admin.query("update ai_spend_budgets set hard_limit_micros=137735 where run_id=$1", [p.runId]);
      await expect(execute(reservationSql(p))).rejects.toThrow(/budget_exhausted/);
    }
    expect((await pool.query("select count(*)::int n from ai_spend_ledger where state='reserved'")).rows[0].n).toBe(0);
  });

  it("keeps immutable ledger policy rows and unknown reservations through closed-grant settlement", async () => {
    const p = await grant(); await execute(reservationSql(p));
    await fixture.admin.query("update ai_spend_ledger set effort_policy_sha256=$1 where id=$2", ["f".repeat(64), p.requests[0].reservationId]);
    await expect(execute(transitionSql(p, "claim"))).rejects.toThrow(/binding_mismatch/);
    await fixture.admin.query("update ai_spend_ledger set effort_policy_sha256=$1 where id=$2", [p.authorization.effortPolicySha256, p.requests[0].reservationId]);
    await execute(transitionSql(p, "claim")); p.state = "launched";
    await fixture.admin.query("update ai_spend_development_batches set state='closed',closed_at=now()");
    const plan = settlementPlan(p, "", "d".repeat(64)); await execute(settlementSql(p, plan)); await execute(settlementSql(p, plan));
    expect((await pool.query("select state,charged_micros=reserved_micros as fully_held from ai_spend_ledger")).rows).toEqual([{ state: "conservative", fully_held: true }, { state: "conservative", fully_held: true }]);
    expect((await pool.query("select count(*)::int n from ai_spend_ledger")).rows[0].n).toBe(2);
  });

  it(unbounded?"admits parallel paired reservations beyond the former count ceiling and admits a single claim":"serializes two paired reservations under the common count ceiling and admits a single claim", async () => {
    const p = await grant(3), second = structuredClone(p); second.permitId = randomUUID(); second.requests = second.requests.map((r: Record<string, unknown>) => ({ ...r, reservationId: randomUUID() }));
    const results = await Promise.allSettled([execute(reservationSql(p)), execute(reservationSql(second))]); expect(results.filter(r => r.status === "fulfilled")).toHaveLength(unbounded?2:1);
    expect((await pool.query("select count(*)::int n from ai_spend_ledger")).rows[0].n).toBe(unbounded?4:2);
    const winner = results[0].status === "fulfilled" ? p : second;
    const claims = await Promise.allSettled([execute(transitionSql(winner, "claim")), execute(transitionSql(winner, "claim"))]); expect(claims.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
});
