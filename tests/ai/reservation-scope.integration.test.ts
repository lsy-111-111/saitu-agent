import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import type pg from "pg";
vi.unmock("@/lib/ai/spend-ledger");
import {reserveAiSpend,requestReserveMicros} from "@/lib/ai/spend-ledger";
import {scopedAiReservationLimitMicros,withAiReservationLimit,withAiSpendLimit} from "@/lib/ai/spend-run-context";
import {createV7TestDatabase} from "../helpers/v7-database-environment";

const integration=process.env.RUN_V7_DATABASE_TESTS==="1"?describe:describe.skip;
integration("additional per-reservation ceiling in disposable PostgreSQL",()=>{
  const original={...process.env},globals=globalThis as typeof globalThis&{__pgPool?:pg.Pool};
  const input={system:"synthetic",prompt:"reservation boundary only",maxTokens:100,model:"deepseek-flash",effort:"high"};
  const expected=requestReserveMicros(input.system,input.prompt,input.maxTokens);
  let fixture:Awaited<ReturnType<typeof createV7TestDatabase>>,runId:string;
  beforeAll(async()=>{
    fixture=await createV7TestDatabase("backend");
    expect(fixture.database).toMatch(/^saitu_v7_backend_[a-f0-9]{32}$/);
    expect((await fixture.admin.query("select current_database() as name")).rows[0].name).toBe(fixture.database);
    await globals.__pgPool?.end();delete globals.__pgPool;
    Object.assign(process.env,{DATABASE_URL:fixture.runtimeUrl,AI_SPEND_LIMIT_CNY:"10",AI_SPEND_FUNDED_CNY:"10",AI_SPEND_PHASE:"formal"});
  });
  beforeEach(async()=>{
    runId=`reservation-only-${randomUUID()}`;
    await fixture.admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,10000000)",[runId]);
    await fixture.admin.query("insert into ai_spend_authority(singleton,run_id) values(true,$1) on conflict(singleton) do update set run_id=excluded.run_id",[runId]);
    process.env.AI_SPEND_RUN_ID=runId;process.env.AI_SPEND_FUNDED_CNY="10";
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("NO_PROVIDER_ALLOWED");}));
  });
  afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});
  afterAll(async()=>{await globals.__pgPool?.end();delete globals.__pgPool;await fixture?.close();process.env={...original};});
  const reserve=()=>reserveAiSpend(input);
  async function rows(){return (await fixture.admin.query("select id,state,reserved_micros,charged_micros from ai_spend_ledger where run_id=$1 order by created_at,id",[runId])).rows;}
  it("allows an exact reservation after earlier spend without changing the old absolute scope",async()=>{
    const first=await reserve();expect(first.ok).toBe(true);if(!first.ok)throw new Error(first.reason);
    await first.reservation.settle(undefined,true);
    const initial=await rows();expect(initial).toHaveLength(1);
    await expect(withAiSpendLimit(expected,reserve)).resolves.toMatchObject({ok:false,reason:"spend_budget_exhausted"});
    const next=await withAiReservationLimit(expected,reserve);expect(next.ok).toBe(true);if(!next.ok)throw new Error(next.reason);
    await next.reservation.settle(undefined,true);
    const final=await rows();expect(final).toHaveLength(2);expect(final[0]).toEqual(initial[0]);
    expect(final.every(row=>row.state==="conservative"&&row.charged_micros===String(expected))).toBe(true);
  });
  it("rejects one micro below the required reservation without adding a ledger row",async()=>{
    await expect(withAiReservationLimit(expected-1,reserve)).resolves.toEqual({ok:false,reason:"spend_budget_exhausted"});
    expect(await rows()).toEqual([]);
  });
  it("cannot raise either the actual funded cap or the administrator's budget",async()=>{
    process.env.AI_SPEND_FUNDED_CNY=String((expected-1)/1_000_000);
    await expect(withAiReservationLimit(Number.MAX_SAFE_INTEGER,reserve)).resolves.toMatchObject({ok:false,reason:"spend_budget_exhausted"});
    process.env.AI_SPEND_FUNDED_CNY="10";
    await fixture.admin.query("update ai_spend_budgets set hard_limit_micros=$2 where run_id=$1",[runId,expected-1]);
    await expect(withAiReservationLimit(Number.MAX_SAFE_INTEGER,reserve)).resolves.toMatchObject({ok:false,reason:"spend_budget_exhausted"});
    expect(await rows()).toEqual([]);
  });
  it("nested ceilings only tighten and cannot relax the preexisting cumulative scope",async()=>{
    await expect(withAiReservationLimit(expected-1,()=>withAiReservationLimit(expected+1,reserve))).resolves.toMatchObject({ok:false});
    await expect(withAiReservationLimit(expected+1,()=>withAiReservationLimit(expected-1,reserve))).resolves.toMatchObject({ok:false});
    await expect(withAiSpendLimit(expected-1,()=>withAiReservationLimit(expected+1,reserve))).resolves.toMatchObject({ok:false});
    expect(await rows()).toEqual([]);expect(scopedAiReservationLimitMicros()).toBeUndefined();
  });
  it("isolates simultaneous asynchronous ceilings",async()=>{
    let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
    const low=withAiReservationLimit(expected-1,async()=>{await barrier;return reserve();});
    const high=withAiReservationLimit(expected,async()=>{release();await Promise.resolve();return reserve();});
    const [a,b]=await Promise.all([low,high]);expect(a).toMatchObject({ok:false,reason:"spend_budget_exhausted"});expect(b.ok).toBe(true);
    expect(await rows()).toHaveLength(1);expect(scopedAiReservationLimitMicros()).toBeUndefined();
  });
  it("zero denies every reservation and invalid ceilings fail before invoking work",async()=>{
    await expect(withAiReservationLimit(0,reserve)).resolves.toMatchObject({ok:false,reason:"spend_budget_exhausted"});
    const work=vi.fn();for(const value of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])expect(()=>withAiReservationLimit(value,work)).toThrow("invalid_reservation_limit");
    expect(work).not.toHaveBeenCalled();expect(await rows()).toEqual([]);
  });
  it("cannot create or select an ungranted funded run",async()=>{
    process.env.AI_SPEND_RUN_ID=`not-authorized-${randomUUID()}`;
    await expect(withAiReservationLimit(expected,reserve)).resolves.toMatchObject({ok:false,reason:"spend_configuration_invalid"});
    expect(await rows()).toEqual([]);
  });
});
