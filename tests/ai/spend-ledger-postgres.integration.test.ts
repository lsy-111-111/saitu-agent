import { randomUUID } from "node:crypto";
import {createSpendPostgresFixture} from "../helpers/spend-postgres-fixture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool } from "../../src/lib/db/pool";
import { reserveAiSpend } from "../../src/lib/ai/spend-ledger";

const enabled = process.env.RUN_SPEND_LEDGER_POSTGRES_TESTS === "1";
const original = { ...process.env };
const request = { system: "Budget race test", prompt: "No upstream call", maxTokens: 8192, model: "deepseek-flash", effort: "max" };

describe.skipIf(!enabled)("real PostgreSQL spend reservations (no upstream calls)", () => {
  let fixture:Awaited<ReturnType<typeof createSpendPostgresFixture>>;
  beforeAll(async()=>{fixture=await createSpendPostgresFixture();});
  afterAll(async () => { await fixture?.close(); process.env = { ...original }; });

  async function isolate(funded = "130.02") {
    process.env.AI_SPEND_RUN_ID = `ledger-test-${randomUUID()}`;
    process.env.AI_SPEND_LIMIT_CNY = "300";
    process.env.AI_SPEND_FUNDED_CNY = funded;
    process.env.AI_SPEND_PHASE = "calibration";
    await fixture.bind(process.env.AI_SPEND_RUN_ID);
    return process.env.AI_SPEND_RUN_ID;
  }

  it("admits only the funded reservation under concurrent requests and refunds only an unattempted call", async () => {
    const runId = await isolate("0.10");
    const attempts = await Promise.all(Array.from({ length: 12 }, () => reserveAiSpend(request)));
    const accepted = attempts.filter(attempt => attempt.ok);
    expect(accepted).toHaveLength(1);
    expect(attempts.filter(attempt => !attempt.ok).every(attempt => attempt.reason === "spend_budget_exhausted")).toBe(true);
    await accepted[0]!.reservation.settle(undefined, false);
    const retried = await reserveAiSpend(request);
    expect(retried.ok).toBe(true);
    if (retried.ok) await retried.reservation.settle();
    const result = await getPool().query("select sum(coalesce(charged_micros,reserved_micros))::bigint::text as total from ai_spend_ledger where run_id=$1", [runId]);
    expect(Number(result.rows[0].total)).toBeLessThanOrEqual(100_000);
  });

  it("retains the full reserve for unknown charged usage and makes concurrent settlement idempotent", async () => {
    await isolate();
    const held = await reserveAiSpend(request);
    expect(held.ok).toBe(true);
    if (!held.ok) throw new Error("Reservation was refused");
    const costs = await Promise.all([held.reservation.settle(), held.reservation.settle({ inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 })]);
    expect(costs).toEqual([held.reservation.reservedMicros / 1_000_000, held.reservation.reservedMicros / 1_000_000]);
    const row = (await getPool().query("select state,charged_micros::text from ai_spend_ledger where id=$1", [held.reservation.id])).rows[0];
    expect(row.state).toBe("conservative");
    expect(Number(row.charged_micros)).toBe(held.reservation.reservedMicros);
  });

  it("enforces 100 calibration attempts without sending any model request", async () => {
    const runId = await isolate();
    const first = await reserveAiSpend(request);
    if (!first.ok) throw new Error("Reservation was refused");
    await first.reservation.settle({ inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 });
    await getPool().query("insert into ai_spend_ledger(id,run_id,model,effort,phase,operation,price_version,reserved_micros,charged_micros,state) select gen_random_uuid(),$1,'deepseek-flash','max','calibration','test_fixture','test',10,10,'usage_estimated' from generate_series(1,98)", [runId]);
    const hundredth = await reserveAiSpend(request);
    expect(hundredth.ok).toBe(true);
    if (hundredth.ok) await hundredth.reservation.settle({ inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 });
    expect(await reserveAiSpend(request)).toEqual({ ok: false, reason: "spend_budget_exhausted" });
  });

  it("enforces the separate 30 CNY calibration ceiling", async () => {
    const runId = await isolate();
    const first = await reserveAiSpend(request);
    if (!first.ok) throw new Error("Reservation was refused");
    await first.reservation.settle(undefined, false);
    await getPool().query("insert into ai_spend_ledger(id,run_id,model,effort,phase,operation,price_version,reserved_micros,charged_micros,state) values(gen_random_uuid(),$1,'deepseek-flash','max','calibration','test_fixture','test',29999000,29999000,'usage_estimated')", [runId]);
    expect(await reserveAiSpend(request)).toEqual({ ok: false, reason: "spend_budget_exhausted" });
  });
});
