import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import pg from "pg";

const database=vi.hoisted(()=>({pool:undefined as pg.Pool|undefined}));
vi.mock("@/lib/db/pool",()=>({isDatabaseConfigured:()=>Boolean(database.pool),getPool:()=>database.pool!}));
import {retryAfterSeconds} from "@/components/competitions/recommend/useRecommendationConversation";

const enabled=process.env.RUN_V7_TOP5_PRIVATE_PG==="1",run=enabled?describe:describe.skip,original={...process.env};
run("ordinary unsigned journey quotas on a disposable PostgreSQL database",()=>{
  let admin:pg.Client,limiter:typeof import("@/lib/security/rate-limit");
  beforeAll(async()=>{
    const filename=process.env.V7_TOP5_PRIVATE_CONFIG??"";
    expect(filename).toMatch(/^\/(?:private\/)?tmp\/saitu-top5-c-[A-Za-z0-9]+\/client\.json$/);
    const config=JSON.parse(readFileSync(filename,"utf8"));
    expect(config.database).toMatch(/^top5_private_[a-f0-9]{16}$/);expect(config.port).toBe(55479);
    admin=new pg.Client({host:config.host,port:config.port,user:"top5_admin",database:config.database});await admin.connect();
    expect((await admin.query("select nonce from top5_test_control")).rows[0].nonce).toBe(config.nonce);
    expect((await admin.query("show listen_addresses")).rows[0].listen_addresses).toBe("");
    database.pool=new pg.Pool({host:config.host,port:config.port,user:config.runtime,database:config.database,max:4});
    for(const key of ["SESSION_STARTS_PER_IP_MINUTE","SESSION_STARTS_PER_IP_DAY","SESSION_TRANSITIONS_PER_SESSION","SESSION_TTL_SECONDS"])delete process.env[key];
    limiter=await import("@/lib/security/rate-limit");
  });
  beforeEach(async()=>{
    await admin.query("truncate competition_idempotency,competition_session_transitions,competition_sessions,competition_session_starts,competition_rate_limit_counters");
    process.env={...original,NODE_ENV:"test",SAITU_AI_EXECUTION_MODE:"user-unbounded",AI_CONVERSATION_SIGNING_SECRET:"synthetic-ordinary-journey-signing-secret-no-real-credentials"};
    limiter.resetRateLimitStateForTests();
    vi.spyOn(console,"info").mockImplementation(()=>undefined);vi.spyOn(console,"warn").mockImplementation(()=>undefined);vi.spyOn(console,"error").mockImplementation(()=>undefined);
    vi.stubGlobal("fetch",vi.fn(()=>{throw new Error("ordinary_journey_tests_forbid_provider_network");}));
  });
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();process.env={...original};});
  afterAll(async()=>{await database.pool?.end();database.pool=undefined;await admin?.end();process.env={...original};});
  const request=(key:string)=>{
    const value=new Request("http://127.0.0.1:3172/api/ai/competition-recommend",{method:"POST",headers:{"Content-Type":"application/json","X-Real-IP":"203.0.113.71","Idempotency-Key":key},body:"{}"});
    expect(value.headers.has("X-Saitu-Validation-Execution")).toBe(false);return value;
  };
  const start=(key:string)=>limiter.executeCompetitionSessionStart({request:request(key),requestId:key,operation:"competition_normalize",transitionId:limiter.competitionTransitionId("competition_normalize",{key}),producer:async()=>Response.json({ok:true})});
  const transition=(sessionId:string,key:string,operation:string)=>limiter.executeCompetitionSessionTransition({request:request(key),requestId:key,sessionId,
    sessionExpiresAtEpochSeconds:Math.floor(Date.now()/1000)+1800,operation,transitionId:limiter.competitionTransitionId(operation,{key}),producer:async()=>Response.json({ok:true})});

  it("allows normalize, confirmation, three clarify answers and recommend beyond the fourth ordinary request",async()=>{
    const session=randomUUID(),responses=[await start("ordinary-normalize")];
    for(const [key,operation] of [["confirmation","competition_normalize_confirmation"],["clarify-initial","competition_clarify"],["clarify-answer-1","competition_clarify"],["clarify-answer-2","competition_clarify"],["clarify-answer-3","competition_clarify"],["recommend","competition_recommend"]])
      responses.push(await transition(session,`ordinary-${key}`,operation));
    expect(responses.map(value=>value.status)).toEqual([200,200,200,200,200,200,200]);
    expect((await admin.query("select count(*)::int as n from competition_session_transitions")).rows[0].n).toBe(6);
    expect((await admin.query("select bucket,hit_count from competition_rate_limit_counters order by bucket")).rows).toEqual([{bucket:"session_start_daily",hit_count:1},{bucket:"session_start_minute",hit_count:1}]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts four new ordinary sessions on one IP and retains the real sixty-start minute cap and cooldown",async()=>{
    for(let index=0;index<60;index++)expect((await start(`ordinary-start-${index}`)).status).toBe(200);
    const limited=await start("ordinary-start-61"),body=await limited.json();
    expect(limited.status).toBe(429);expect(body).toMatchObject({error:"RATE_LIMITED",bucket:"session_start_minute",source:"application"});
    const seconds=retryAfterSeconds(limited,body);expect(seconds).toBeGreaterThan(0);expect(seconds).toBeLessThanOrEqual(60);expect(Number(limited.headers.get("Retry-After"))).toBe(seconds);
    await admin.query("update competition_rate_limit_counters set reset_at=now()-interval '1 second' where bucket='session_start_minute'");
    expect((await start("ordinary-start-after-cooldown")).status).toBe(200);
  });
  it("preserves the twelve-transition session limit and exposes a bounded retry countdown",async()=>{
    const session=randomUUID();for(let index=0;index<12;index++)expect((await transition(session,`ordinary-turn-${index}`,"competition_clarify")).status).toBe(200);
    const limited=await transition(session,"ordinary-turn-13","competition_clarify"),body=await limited.json();
    expect(limited.status).toBe(429);expect(body).toMatchObject({error:"RATE_LIMITED",bucket:"session_transitions"});
    expect(retryAfterSeconds(limited,body)).toBeGreaterThan(0);expect(retryAfterSeconds(limited,body)).toBeLessThanOrEqual(1800);
  });
});
