import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { z } from "zod";
const ownedSocket=vi.hoisted(()=>({pool:undefined as pg.Pool|undefined}));
vi.mock("@/lib/db/pool",async importOriginal=>{
  const actual=await importOriginal<typeof import("@/lib/db/pool")>();
  return {getPool:()=>process.env.RUN_V7_TOP5_PRIVATE_PG==="1"?ownedSocket.pool!:actual.getPool(),isDatabaseConfigured:()=>process.env.RUN_V7_TOP5_PRIVATE_PG==="1"?Boolean(ownedSocket.pool):actual.isDatabaseConfigured()};
});

// Exercise the actual accounting implementation. The provider transport below
// is explicitly stubbed; these are database/crash tests, never live-model evidence.
vi.unmock("@/lib/ai/spend-ledger");

import { getPool } from "@/lib/db/pool";
import { requestAiJson, type AiJsonResult } from "@/lib/ai/ai-client";
import { estimateSpendMicros, reserveAiSpend } from "@/lib/ai/spend-ledger";
import { markDurableDispatch, recordDurableReceipt, runDurableAiAttempt, withDurableAiChat, withDurableAiRun } from "@/lib/ai/durable-call";
import { createCompetitionConversationToken, verifyCompetitionConversationToken } from "@/lib/ai/competition-conversation-token";
import { getCurrentAiConsentDisclosure } from "@/lib/ai/consent-disclosure";
import { resetRateLimitStateForTests } from "@/lib/security/rate-limit";
import { recommendV7 } from "@/lib/competitions/v7/recommend-api";
import { chatV7 } from "@/lib/competitions/v7/chat-api";
import { buildDecisionContextV7, isLowRiskAuditSampleV7 } from "@/lib/competitions/v7/model";
import { createDecisionTokenV7, sealV7, unsealV7, verifyDecisionTokenV7 } from "@/lib/competitions/v7/crypto";
import { claimRunV7, commitRunV7, enqueueRunV7, presentRunV7, readRunV7, readSessionV7, releaseRunLeaseV7, submissionKeyV7, type ChatSnapshotV7 } from "@/lib/competitions/v7/store";
import { processClaimedRunV7 } from "@/lib/competitions/v7/worker";
import { RECOMMENDATION_LIST_DEADLINE_MS, RECOMMENDATION_RANK_HARD_TIMEOUT_MS } from "@/lib/competitions/v7/contracts";
import { student } from "../v6/decision-fixtures";
import { decisionReportSchema, type DecisionReportV6 } from "@/lib/competitions/v6/contracts";
import type { DecisionChatRequest } from "@/lib/competitions/v6/chat-contracts";
import { runItemDetail } from "../../fixtures/recommendation-run-v7";
import { GET as getRun } from "@/app/api/ai/competition-recommend/runs/[runId]/route";
import { POST as retryRun } from "@/app/api/ai/competition-recommend/runs/[runId]/retry/route";
import { withProductObservation } from "@/lib/ai/product-observation";
import { createV7TestDatabase } from "../../helpers/v7-database-environment";
import {DEFAULT_EFFORT_POLICY,effortPolicySha256} from "@/lib/ai/effort-policy.mjs";

const privateMode=process.env.RUN_V7_TOP5_PRIVATE_PG==="1";
const integration = process.env.RUN_V7_DATABASE_TESTS === "1"||privateMode ? describe : describe.skip;

integration("independent v7 backend crash and replay review (real disposable PostgreSQL, stubbed transport)", () => {
  const original = { ...process.env };
  const budgetRunId = `v7-backend-review-${randomUUID()}`;
  const globals = globalThis as typeof globalThis & { __pgPool?: pg.Pool };
  let admin: pg.Client, fixture: Awaited<ReturnType<typeof createV7TestDatabase>>;
  const temporaryDirectories: string[] = [];

  beforeAll(async () => {
    if(privateMode){
      const filename=process.env.V7_TOP5_PRIVATE_CONFIG??"";expect(filename).toMatch(/^\/(?:private\/)?tmp\/saitu-top5-c-[A-Za-z0-9]+\/client\.json$/);
      const config=JSON.parse(readFileSync(filename,"utf8"));expect(config.database).toMatch(/^top5_private_[a-f0-9]{16}$/);expect(config.port).toBe(55479);
      admin=new pg.Client({host:config.host,port:config.port,user:"top5_admin",database:config.database});await admin.connect();
      expect((await admin.query("select current_database() as db,current_setting('unix_socket_directories') as socket,current_setting('listen_addresses') as addresses")).rows[0]).toEqual({db:config.database,socket:config.host,addresses:""});
      expect((await admin.query("select nonce from top5_test_control")).rows[0].nonce).toBe(config.nonce);
      await admin.query("truncate competition_decision_chat_requests,competition_decision_calls,competition_decision_runs,competition_decision_states,ai_spend_ledger,ai_spend_development_batches,ai_spend_authority,ai_spend_budgets,ai_model_call_leases,ai_model_call_waiters,ai_model_daily_usage");
      ownedSocket.pool=new pg.Pool({host:config.host,port:config.port,user:config.runtime,database:config.database,max:10});
    }else {fixture = await createV7TestDatabase("backend"); admin = fixture.admin;}
    await admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,10000000)", [budgetRunId]);
    await admin.query("insert into ai_spend_authority(singleton,run_id) values(true,$1)", [budgetRunId]);
    if (globals.__pgPool) await globals.__pgPool.end();
    delete globals.__pgPool;
    Object.assign(process.env, {
      ...(fixture?{DATABASE_URL:fixture.runtimeUrl}:{}), AI_PROVIDER: "deepseek", AI_API_KEY: "transport-stub-only-never-live",
      AI_CONVERSATION_SIGNING_SECRET: "v7-backend-review-isolated-signing-secret-0000",
      AI_SPEND_RUN_ID: budgetRunId, AI_SPEND_LIMIT_CNY: "10", AI_SPEND_FUNDED_CNY: "10", AI_SPEND_PHASE: "formal",
      FEATURE_AI: "1", FEATURE_COMPETITION_RECOMMENDER: "1",
    });
  });
  let batchSequence=0;
  beforeEach(async()=>{
    const runId=`saitu-v7-top5-20261109-formal-${String(++batchSequence).padStart(2,"0")}`,policySha=createHash("sha256").update(readFileSync("docs/v7/top5-continuation-contract-20261109.md")).digest("hex");
    const policy=DEFAULT_EFFORT_POLICY,policyHash=effortPolicySha256(policy);
    const condition={schemaVersion:"saitu.user-approved-budget-condition.v7.top5.v1",model:"deepseek-flash",effort:"stage",phase:"formal",mainRunId:budgetRunId,policySha256:policySha,
      sourcePolicy:"docs/v7/top5-continuation-contract-20261109.md",policyVersion:"saitu.policy.2026-11-09.v7.top5",implementationVersion:"saitu.async.2026-11-09.v7.3.top5",
      effortPolicy:policy,effortPolicySha256:policyHash,authorization:"user-approved-20261109-top5-continuation",freshPgRowsVerified:true,priorLedgerSha256:createHash("sha256").update("[]").digest("hex")};
    const conditionHash=createHash("sha256").update(JSON.stringify(condition)).digest("hex");
    await admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,10000000)",[runId]);
    const baseline=(await admin.query("select id from ai_spend_ledger")).rows.map(row=>row.id);
    await admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256,effort_policy,effort_policy_sha256)
      values($1,$2,100,10000000,0,10000000,$3,'Synthetic backend regression Top5 grant','stage',$4,$5,'saitu.v7.top5.v1','formal',$6,$7,$8)`,[runId,budgetRunId,baseline,conditionHash,JSON.stringify(condition),policySha,JSON.stringify(policy),policyHash]);
    Object.assign(process.env,{AI_SPEND_RUN_ID:runId,AI_SPEND_PHASE:"formal",AI_SPEND_AUTHORIZED_EFFORT:"stage",AI_SPEND_EFFORT_CONDITION_SHA256:conditionHash,AI_SPEND_POLICY_SHA256:policySha,
      SAITU_V7_EFFORT_POLICY:JSON.stringify(policy),SAITU_V7_EFFORT_POLICY_SHA256:policyHash,SAITU_AI_EXECUTION_MODE:"finite"});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetRateLimitStateForTests();
    if (admin) {
      await admin.query("update competition_decision_runs set status='superseded',lease_owner=null,lease_expires_at=null where status not in ('ready','failed','expired','superseded')");
      await admin.query("update ai_spend_development_batches set state='closed',closed_at=now() where state='active'");
    }
    Object.assign(process.env, { AI_SPEND_RUN_ID: budgetRunId, AI_SPEND_PHASE: "formal", AI_SPEND_LIMIT_CNY: "10", AI_SPEND_FUNDED_CNY: "10" });
    if (original.SAITU_V7_SOURCE_SHA256 === undefined) delete process.env.SAITU_V7_SOURCE_SHA256;
    else process.env.SAITU_V7_SOURCE_SHA256 = original.SAITU_V7_SOURCE_SHA256;
    for (const name of ["APP_RELEASE_DIR", "SAITU_V7_WORKER_ACTIVE_LINK", "AI_SPEND_POLICY_SHA256", "AI_SPEND_AUTHORIZED_EFFORT", "AI_SPEND_HIGH_CONDITION_SHA256","AI_SPEND_EFFORT_CONDITION_SHA256","SAITU_V7_EFFORT_POLICY","SAITU_V7_EFFORT_POLICY_SHA256"]) {
      if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name];
    }
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  afterAll(async () => {
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    if (globals.__pgPool) await globals.__pgPool.end();
    await ownedSocket.pool?.end();ownedSocket.pool=undefined;
    delete globals.__pgPool;
    await fixture?.close();
    if(privateMode)await admin?.end();
    process.env = { ...original };
  });

  async function create() {
    const sessionId = randomUUID();
    const legacy = student({ weeklyCommitment: "5-10", confirmedFields: ["stage", "weeklyCommitment"] });
    const context = buildDecisionContextV7(legacy, { profileId: sessionId });
    const input = { sessionId, expiresAt: Date.now() + 180_000, legacy, context, submissionKey: submissionKeyV7(sessionId, "independent-initial") };
    return { ...await enqueueRunV7(input), input };
  }

  async function claimed() {
    const created = await create();
    const claim = await claimRunV7(`review-${randomUUID()}`);
    expect(claim?.row.run_id).toBe(created.run.row.run_id);
    await commitRunV7(claim!, "ranking", claim!.body);
    return { ...created, claim: claim! };
  }

  function transport(content: unknown = { answer: 42 }) {
    const fetch = vi.fn(async () => {
      return providerResponse(content);
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }
  function providerResponse(content: unknown = { answer: 42 }) {
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content), reasoning_content: "NEVER_PERSIST_HIDDEN_REASONING" }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10, prompt_cache_hit_tokens: 5 } }), { status: 200, headers: { "x-request-id": "isolated-transport-fixture" } });
  }
  function reportFixture(profile: DecisionReportV6["profile"], catalogVersion: string) {
    const detail = runItemDetail(0), suggestion = { text: "隔离后端测试中的任务建议", basis: "suggestion" as const, studentFactIds: [], competitionFactIds: [], conditions: [] };
    return decisionReportSchema.parse({ schemaVersion: "saitu.report.v6", reportId: randomUUID(), generatedAt: new Date().toISOString(), profile, catalogVersion,
      summary: { direction: suggestion, personalEvidence: [], mainGap: suggestion, nextStep: suggestion, focusItemIds: [detail.itemId] }, recommendations: [detail],
      shortlistShortfallReason: "隔离后端测试仅构造一个候选。", comparisons: [], goalPaths: [], candidateAudit: [], pendingQuestions: [], schoolPolicyReminder: "具体政策请核查。",
      fallback: { used: false, reason: null }, trace: { engineVersion: "isolated-fixture", method: "llm", model: "transport-stub", promptVersion: "isolated-fixture", candidateCount: 1, callCount: 1, elapsedMs: 1, verification: "deterministic", inputTokens: 20, outputTokens: 10, costCny: null } });
  }
  function releaseSlots() {
    const directory = mkdtempSync(path.join(tmpdir(), "saitu-v7-backend-release-")); temporaryDirectories.push(directory);
    const a = path.join(directory, "release-a"), b = path.join(directory, "release-b"), link = path.join(directory, "current");
    mkdirSync(a); mkdirSync(b); symlinkSync(a, link);
    Object.assign(process.env, { APP_RELEASE_DIR: a, SAITU_V7_WORKER_ACTIVE_LINK: link });
    return { activate(target: "a" | "b") { rmSync(link); symlinkSync(target === "a" ? a : b, link); } };
  }

  const requestOptions = { model: "deepseek-flash", operation: "competition_v7_rank", schema: z.object({ answer: z.number() }), maxAttempts: 1 as const, maxTokens: 100, deadlineEpochMs: 0, diagnosticContext: { invocationId: "backend-review", stage: "v7.rank" } };
  function call() { return requestAiJson("independent durable fixture", { ...requestOptions, deadlineEpochMs: Date.now() + 20_000 }); }

  it("replays an accepted run near token expiry without moving the original deadlines", async () => {
    const created = await create(), now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 100_000);
    const replay = await enqueueRunV7(created.input);
    expect(replay.run.row.run_id).toBe(created.run.row.run_id);
    expect(replay.run.row.submitted_at).toEqual(created.run.row.submitted_at);
    expect(replay.run.row.list_deadline_at).toEqual(created.run.row.list_deadline_at);
    expect(replay.run.row.detail_deadline_at).toEqual(created.run.row.detail_deadline_at);
    await expect(enqueueRunV7({ ...created.input, sessionId: randomUUID(), submissionKey: submissionKeyV7(randomUUID(), "new-too-late") })).rejects.toThrow("DECISION_SESSION_EXPIRED");
  });

  it("replays a questionnaire correction after deleting the actual HTTP response cache", async () => {
    const created = await create();
    const incoming = { ...created.input.legacy, weeklyCommitment: "under-5" as const };
    const conversationToken = createCompetitionConversationToken({ profile: incoming, rawAnswerContext: [{ fieldId: "stage", selectedValues: [incoming.stage] }, { fieldId: "weeklyCommitment", selectedValues: [incoming.weeklyCommitment] }], transcript: [], pendingQuestion: null, completed: true });
    const verified = verifyCompetitionConversationToken(conversationToken);
    if (!verified.ok) throw new Error("invalid_conversation_fixture");
    const input = { aiConsent: { accepted: true as const, version: getCurrentAiConsentDisclosure().version }, conversationToken, reportVersion: "competition-recommendation.v7" as const, decisionEdit: { decisionToken: createDecisionTokenV7(created.session), expectedRevision: created.session.profile.revision, changedFields: ["weeklyCommitment"] } };
    const invoke = () => recommendV7(new Request("http://localhost/api/ai/competition-recommend", { method: "POST", headers: { "x-real-ip": "127.0.0.19" } }), randomUUID(), input, verified.payload);
    const first = await invoke(), firstBody = await first.json();
    expect(first.status).toBe(202);
    const cacheRows = await admin.query("delete from competition_idempotency returning cache_key");
    expect(cacheRows.rowCount).toBeGreaterThan(0);
    resetRateLimitStateForTests();
    const replay = await invoke(), replayBody = await replay.json();
    expect(replay.status, JSON.stringify(replayBody)).toBe(202);
    expect(replayBody.runId).toBe(firstBody.runId);
    expect(replayBody.submittedAt).toBe(firstBody.submittedAt);
    expect((await readSessionV7(verifyDecisionTokenV7(firstBody.decisionToken)!))?.generation).toBe(1);
    expect(Number((await admin.query("select count(*) from competition_decision_runs where state_key=$1", [created.session.id])).rows[0].count)).toBe(2);
  });

  it("persists an actual atomic reservation and content receipt, then replays without another transport", async () => {
    const { claim } = await claimed(), fetch = transport();
    const scope = { runId: claim.row.run_id, owner: claim.owner, fence: claim.fence };
    const first = await withDurableAiRun(scope, call);
    expect(first).toMatchObject({ ok: true, data: { answer: 42 } });
    const row = (await admin.query("select * from competition_decision_calls where run_id=$1", [claim.row.run_id])).rows[0];
    expect(row.state).toBe("completed"); expect(row.reservation_id).toBeTruthy();
    const sealed = unsealV7<{ kind: string; receipt: { content: string; durationMs: number } }>(`call:${row.call_id}`, row);
    expect(sealed.kind).toBe("receipt"); expect(sealed.receipt.content).toBe('{"answer":42}');
    expect(JSON.stringify(sealed)).not.toContain("NEVER_PERSIST_HIDDEN_REASONING");
    const ledger = (await admin.query("select * from ai_spend_ledger where id=$1", [row.reservation_id])).rows[0];
    expect(ledger.state).toBe("usage_estimated");
    expect(Number(ledger.charged_micros)).toBe(estimateSpendMicros({ inputTokens: 20, outputTokens: 10, cachedInputTokens: 5 }));
    const replay = await withDurableAiRun(scope, call);
    // A raw receipt measures receipt arrival before schema validation; the
    // first return can include a later validation millisecond. Business and
    // accounting fields must replay exactly without dispatching again.
    expect(replay).toMatchObject({ ok: true, data: { answer: 42 }, model: first.model, httpStatus: first.httpStatus, requestId: first.requestId, finishReason: first.finishReason, usage: first.usage, attempts: first.attempts, upstreamAttempted: true });
    expect(replay.durationMs).toBe(sealed.receipt.durationMs); expect(first.durationMs).toBeGreaterThanOrEqual(sealed.receipt.durationMs);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a successful raw receipt after completion and revalidates both schemas without another dispatch", async () => {
    const { claim } = await claimed(), fetch = transport({ answer: 42 });
    const scope = { runId: claim.row.run_id, owner: claim.owner, fence: claim.fence };
    expect(await withDurableAiRun(scope, call)).toMatchObject({ ok: true, data: { answer: 42 } });
    const before = (await admin.query("select * from competition_decision_calls where run_id=$1", [claim.row.run_id])).rows[0];
    expect(before.state).toBe("completed");
    const saved = unsealV7<{ kind: string; receipt: { content: string } }>(`call:${before.call_id}`, before);
    expect(saved.kind).toBe("receipt"); expect(saved.receipt.content).toBe('{"answer":42}');
    expect(JSON.stringify(saved)).not.toContain("NEVER_PERSIST_HIDDEN_REASONING");
    const transformed = await withDurableAiRun(scope, () => requestAiJson("independent durable fixture", {
      ...requestOptions, schema: z.object({ answer: z.number().transform(value => `revalidated:${value}`) }), deadlineEpochMs: Date.now() + 20_000,
    }));
    expect(transformed).toMatchObject({ ok: true, data: { answer: "revalidated:42" } });
    expect(await withDurableAiRun(scope, call)).toMatchObject({ ok: true, data: { answer: 42 } });
    const after = (await admin.query("select * from competition_decision_calls where call_id=$1", [before.call_id])).rows[0];
    expect(after.ciphertext).toEqual(before.ciphertext); expect(after.iv).toEqual(before.iv); expect(after.tag).toEqual(before.tag);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Number((await admin.query("select count(*) from ai_spend_ledger where id=$1", [before.reservation_id])).rows[0].count)).toBe(1);
  });

  it("keeps invalid-output raw content after completion and repairs schema replay without another dispatch", async () => {
    const { claim } = await claimed(), fetch = transport({ answer: "42" });
    const scope = { runId: claim.row.run_id, owner: claim.owner, fence: claim.fence };
    expect(await withDurableAiRun(scope, call)).toMatchObject({ ok: false, reason: "invalid_output", httpStatus: 200 });
    const before = (await admin.query("select * from competition_decision_calls where run_id=$1", [claim.row.run_id])).rows[0];
    expect(before.state).toBe("completed");
    const saved = unsealV7<{ kind: string; receipt: { content: string } }>(`call:${before.call_id}`, before);
    expect(saved.kind).toBe("receipt"); expect(saved.receipt.content).toBe('{"answer":"42"}');
    expect(JSON.stringify(saved)).not.toContain("NEVER_PERSIST_HIDDEN_REASONING");
    expect(await withDurableAiRun(scope, call)).toMatchObject({ ok: false, reason: "invalid_output" });
    const repaired = await withDurableAiRun(scope, () => requestAiJson("independent durable fixture", {
      ...requestOptions, schema: z.object({ answer: z.coerce.number() }), deadlineEpochMs: Date.now() + 20_000,
    }));
    expect(repaired).toMatchObject({ ok: true, data: { answer: 42 } });
    const after = (await admin.query("select * from competition_decision_calls where call_id=$1", [before.call_id])).rows[0];
    expect(after.ciphertext).toEqual(before.ciphertext); expect(after.iv).toEqual(before.iv); expect(after.tag).toEqual(before.tag);
    expect(fetch).toHaveBeenCalledTimes(1);
    const ledger = (await admin.query("select state,charged_micros from ai_spend_ledger where id=$1", [before.reservation_id])).rows[0];
    expect(ledger.state).toBe("usage_estimated"); expect(Number(ledger.charged_micros)).toBe(estimateSpendMicros({ inputTokens: 20, outputTokens: 10, cachedInputTokens: 5 }));
  });

  it("recovers a persisted response receipt and settles its still-reserved ledger without transport", async () => {
    const { claim } = await claimed(), fetch = transport();
    const scope = { runId: claim.row.run_id, owner: claim.owner, fence: claim.fence };
    await withDurableAiRun(scope, call);
    const row = (await admin.query("select * from competition_decision_calls where run_id=$1", [claim.row.run_id])).rows[0];
    const receipt = { model: "deepseek-flash", httpStatus: 200, finishReason: "stop", content: '{"answer":42}', usage: { inputTokens: 20, outputTokens: 10, cachedInputTokens: 5 }, durationMs: 1, attempts: 1 };
    const saved = sealV7(`call:${row.call_id}`, { kind: "receipt", receipt });
    // Explicitly reconstruct the crash boundary after receipt commit and before
    // settlement/final-result commit. This is injected state, not a live crash.
    await admin.query("update competition_decision_calls set state='response_received',ciphertext=$2,iv=$3,tag=$4 where call_id=$1", [row.call_id, saved.ciphertext, saved.iv, saved.tag]);
    await admin.query("update ai_spend_ledger set state='reserved',charged_micros=null,settled_at=null,input_tokens=null,output_tokens=null,cached_input_tokens=null where id=$1", [row.reservation_id]);
    await admin.query("update competition_decision_runs set lease_expires_at=now()-interval '1 second' where run_id=$1", [claim.row.run_id]);
    const recovered = (await claimRunV7("review-restarted"))!;
    const replay = await withDurableAiRun({ runId: recovered.row.run_id, owner: recovered.owner, fence: recovered.fence }, call);
    expect(replay).toMatchObject({ ok: true, data: { answer: 42 } }); expect(fetch).toHaveBeenCalledTimes(1);
    const ledger = (await admin.query("select state,charged_micros from ai_spend_ledger where id=$1", [row.reservation_id])).rows[0];
    expect(ledger.state).toBe("usage_estimated"); expect(Number(ledger.charged_micros)).toBe(estimateSpendMicros(receipt.usage));
    await expect(commitRunV7(claim, "ready", claim.body)).rejects.toThrow("DECISION_LEASE_LOST");
    await releaseRunLeaseV7(recovered);
  });

  it("keeps unknown dispatch conservative across restart and never makes a second transport", async () => {
    const { claim } = await claimed(), fetch = transport();
    await withDurableAiRun({ runId: claim.row.run_id, owner: claim.owner, fence: claim.fence }, call);
    const row = (await admin.query("select * from competition_decision_calls where run_id=$1", [claim.row.run_id])).rows[0];
    await admin.query("update competition_decision_calls set state='dispatch_intent',ciphertext=null,iv=null,tag=null where call_id=$1", [row.call_id]);
    await admin.query("update ai_spend_ledger set state='reserved',charged_micros=null,settled_at=null where id=$1", [row.reservation_id]);
    await admin.query("update competition_decision_runs set lease_expires_at=now()-interval '1 second' where run_id=$1", [claim.row.run_id]);
    const recovered = (await claimRunV7("review-unknown-restarted"))!;
    const scope = { runId: recovered.row.run_id, owner: recovered.owner, fence: recovered.fence };
    expect(await withDurableAiRun(scope, call)).toMatchObject({ ok: false, reason: "durable_outcome_unknown" });
    expect(await withDurableAiRun(scope, call)).toMatchObject({ ok: false, reason: "durable_outcome_unknown" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const ledger = (await admin.query("select state,charged_micros,reserved_micros from ai_spend_ledger where id=$1", [row.reservation_id])).rows[0];
    expect(ledger.state).toBe("reserved"); expect(ledger.charged_micros).toBeNull(); expect(Number(ledger.reserved_micros)).toBeGreaterThan(0);
    await releaseRunLeaseV7(recovered);
  });

  it("retains a real late response after the replacement owner has classified dispatch as unknown", async () => {
    const { claim } = await claimed();
    let respond!: (response: Response) => void, dispatched!: () => void;
    const dispatchedPromise = new Promise<void>(resolve => { dispatched = resolve; });
    const fetch = vi.fn(() => { dispatched(); return new Promise<Response>(resolve => { respond = resolve; }); });
    vi.stubGlobal("fetch", fetch);
    const first = withDurableAiRun({ runId: claim.row.run_id, owner: claim.owner, fence: claim.fence }, call);
    await dispatchedPromise;
    await admin.query("update competition_decision_runs set lease_expires_at=now()-interval '1 second' where run_id=$1", [claim.row.run_id]);
    const recovered = (await claimRunV7("review-late-restarted"))!;
    const scope = { runId: recovered.row.run_id, owner: recovered.owner, fence: recovered.fence };
    expect(await withDurableAiRun(scope, call)).toMatchObject({ ok: false, reason: "durable_outcome_unknown" });
    respond(providerResponse());
    await first;
    const replay = await withDurableAiRun(scope, call);
    expect(replay).toMatchObject({ ok: true, data: { answer: 42 } });
    expect(fetch).toHaveBeenCalledTimes(1);
    await releaseRunLeaseV7(recovered);
  });

  it("prevents the old owner from overwriting a replacement reservation before its response arrives", async () => {
    const { claim } = await claimed();
    let firstReserved!: () => void, finishFirst!: () => void, secondDispatched!: () => void, finishSecond!: () => void;
    const firstReservedPromise = new Promise<void>(resolve => { firstReserved = resolve; });
    const finishFirstPromise = new Promise<void>(resolve => { finishFirst = resolve; });
    const secondDispatchedPromise = new Promise<void>(resolve => { secondDispatched = resolve; });
    const finishSecondPromise = new Promise<void>(resolve => { finishSecond = resolve; });
    const attempt = (work: () => Promise<AiJsonResult<{ answer: number }>>) => runDurableAiAttempt({ key: "reserved-race:batch:1", prompt: "isolated reserved race" }, work, receipt => ({ ok: true, data: JSON.parse(String(receipt.content)), model: receipt.model, httpStatus: receipt.httpStatus, finishReason: receipt.finishReason, usage: receipt.usage, durationMs: receipt.durationMs, attempts: receipt.attempts, upstreamAttempted: true }));
    const reserve = () => reserveAiSpend({ system: "isolated", prompt: "isolated reserved race", maxTokens: 100, model: "deepseek-flash", effort: "low", operation: "competition_v7_rank",effortPolicySha256:effortPolicySha256(DEFAULT_EFFORT_POLICY) });
    const first = withDurableAiRun({ runId: claim.row.run_id, owner: claim.owner, fence: claim.fence }, () => attempt(async () => {
      const spend = await reserve(); if (!spend.ok) throw new Error(spend.reason);
      firstReserved(); await finishFirstPromise;
      try { await markDurableDispatch(); throw new Error("old_owner_must_not_dispatch"); }
      catch (error) {
        expect((error as Error).message).toBe("DECISION_LEASE_LOST");
        await spend.reservation.settle(undefined, false);
        return { ok: false, model: "deepseek-flash", reason: "network_error", upstreamAttempted: false };
      }
    }));
    await firstReservedPromise;
    await admin.query("update competition_decision_runs set lease_expires_at=now()-interval '1 second' where run_id=$1", [claim.row.run_id]);
    const recovered = (await claimRunV7("review-reserved-restarted"))!, scope = { runId: recovered.row.run_id, owner: recovered.owner, fence: recovered.fence };
    const second = withDurableAiRun(scope, () => attempt(async () => {
      const spend = await reserve(); if (!spend.ok) throw new Error(spend.reason);
      await markDurableDispatch(); secondDispatched(); await finishSecondPromise;
      const usage = { inputTokens: 20, outputTokens: 10, cachedInputTokens: 5 };
      await recordDurableReceipt({ model: "deepseek-flash", httpStatus: 200, finishReason: "stop", content: '{"answer":42}', usage, durationMs: 1, attempts: 1 });
      await spend.reservation.settle(usage, true);
      return { ok: true, data: { answer: 42 }, model: "deepseek-flash", httpStatus: 200, finishReason: "stop", usage, durationMs: 1, attempts: 1, upstreamAttempted: true };
    }));
    await secondDispatchedPromise; finishFirst(); await first; finishSecond();
    expect(await second).toMatchObject({ ok: true, data: { answer: 42 } });
    const saved = (await admin.query("select * from competition_decision_calls where run_id=$1", [claim.row.run_id])).rows[0];
    expect(unsealV7<{ kind: string; receipt: { content: string } }>(`call:${saved.call_id}`, saved)).toMatchObject({ kind: "receipt", receipt: { content: '{"answer":42}' } });
    const ledgers = (await admin.query("select state from ai_spend_ledger where operation='competition_v7_rank' and run_id=$1 order by created_at",[process.env.AI_SPEND_RUN_ID])).rows.map(row => row.state);
    expect(ledgers).toEqual(["cancelled", "usage_estimated"]);
    await releaseRunLeaseV7(recovered);
  });

  it("rolls back the ledger reservation if the durable owner is lost before the reservation binds", async () => {
    const { claim } = await claimed();
    const before = Number((await admin.query("select count(*) from ai_spend_ledger")).rows[0].count);
    const result = await withDurableAiRun({ runId: claim.row.run_id, owner: claim.owner, fence: claim.fence }, () => runDurableAiAttempt({ key: "reserve-rollback", prompt: "isolated rollback" }, async () => {
      await admin.query("update competition_decision_runs set lease_expires_at=now()-interval '1 second' where run_id=$1", [claim.row.run_id]);
      const spend = await reserveAiSpend({ system: "isolated", prompt: "isolated rollback", maxTokens: 100, model: "deepseek-flash", effort: "low", operation: "competition_v7_rank",effortPolicySha256:effortPolicySha256(DEFAULT_EFFORT_POLICY) });
      if (spend.ok) throw new Error("reservation_must_not_survive_lost_owner");
      return { ok: false, reason: spend.reason, model: "deepseek-flash", upstreamAttempted: false };
    }, () => { throw new Error("unexpected_receipt"); }));
    expect(result).toMatchObject({ ok: false, reason: "spend_store_unavailable" });
    expect(Number((await admin.query("select count(*) from ai_spend_ledger")).rows[0].count)).toBe(before);
    expect((await admin.query("select reservation_id from competition_decision_calls where run_id=$1", [claim.row.run_id])).rows[0].reservation_id).toBeNull();
  });

  it("releases an inactive worker lease before any model call or journal entry", async () => {
    const created = await create(), claim = (await claimRunV7("review-inactive-worker"))!, rank = vi.fn(), explain = vi.fn();
    await processClaimedRunV7(claim, { rank, explain }, undefined, () => false);
    const saved = (await readRunV7(created.run.row.run_id))!;
    expect(saved.row.status).toBe("queued"); expect(saved.row.lease_owner).toBeNull();
    expect(rank).not.toHaveBeenCalled(); expect(explain).not.toHaveBeenCalled();
    expect((await admin.query("select call_id from competition_decision_calls where run_id=$1", [claim.row.run_id])).rowCount).toBe(0);
  });

  it("cancels an undispatched reservation when the active slot changes before dispatch, then safely resumes", async () => {
    const { claim } = await claimed(), fetch = transport(); let active = true;
    const scope = { runId: claim.row.run_id, owner: claim.owner, fence: claim.fence, canDispatch: () => active };
    await expect(withProductObservation({ observer: event => { if (event.type === "ai_budget_reserved") active = false; } }, () => withDurableAiRun(scope, call))).rejects.toThrow("DECISION_RELEASE_INACTIVE");
    expect(fetch).not.toHaveBeenCalled();
    const row = (await admin.query("select * from competition_decision_calls where run_id=$1", [claim.row.run_id])).rows[0];
    const cancelled = (await admin.query("select state,charged_micros from ai_spend_ledger where id=$1", [row.reservation_id])).rows[0];
    expect(cancelled.state).toBe("cancelled"); expect(Number(cancelled.charged_micros)).toBe(0); expect(row.dispatched_at).toBeNull();
    active = true;
    expect(await withDurableAiRun(scope, call)).toMatchObject({ ok: true, data: { answer: 42 } }); expect(fetch).toHaveBeenCalledTimes(1);
    expect(Number((await admin.query("select count(*) from ai_spend_ledger where id in (select reservation_id from competition_decision_calls where run_id=$1)", [claim.row.run_id])).rows[0].count)).toBe(1);
  });

  it("persists and settles an already dispatched response while blocking the next stage after an active-slot switch", async () => {
    const { claim } = await claimed(); let active = true;
    const fetch = vi.fn(async () => { active = false; return providerResponse(); }); vi.stubGlobal("fetch", fetch);
    const scope = { runId: claim.row.run_id, owner: claim.owner, fence: claim.fence, canDispatch: () => active };
    await expect(withDurableAiRun(scope, async () => {
      expect(await call()).toMatchObject({ ok: true, data: { answer: 42 } });
      await requestAiJson("next review stage", { ...requestOptions, operation: "competition_v7_review", deadlineEpochMs: Date.now() + 20_000, diagnosticContext: { invocationId: "backend-review", stage: "v7.review" } });
    })).rejects.toThrow("DECISION_RELEASE_INACTIVE");
    expect(fetch).toHaveBeenCalledTimes(1);
    const rows = (await admin.query("select * from competition_decision_calls where run_id=$1", [claim.row.run_id])).rows;
    expect(rows).toHaveLength(1); expect(rows[0].state).toBe("completed");
    expect(unsealV7<{ kind: string; receipt: { content: string } }>(`call:${rows[0].call_id}`, rows[0])).toMatchObject({ kind: "receipt", receipt: { content: '{"answer":42}' } });
    const ledger = (await admin.query("select state,charged_micros from ai_spend_ledger where id=$1", [rows[0].reservation_id])).rows[0];
    expect(ledger.state).toBe("usage_estimated"); expect(Number(ledger.charged_micros)).toBeGreaterThan(0);
  });

  it("publishes the list before details, keeps one token, and resumes the second phase under a new lease", async () => {
    const created = await create(), originalToken = createDecisionTokenV7(created.session);
    const candidate = created.input.context.candidates[0].record;
    const plan = { profileRevision: created.session.profile.revision, catalogVersion: created.input.context.catalogVersion,
      recommendations: [{ itemId: candidate.recordId, reasons: [{ text: "隔离测试排序理由", basis: "suggestion" as const, studentFactIds: [], competitionFactIds: [], conditions: [] }] }], shortfallReason: "隔离测试只选择一个系列。" };
    const report = reportFixture(created.session.profile, created.input.context.catalogVersion);
    report.recommendations[0] = { ...report.recommendations[0], itemId: candidate.recordId, seriesId: candidate.seriesId, name: candidate.name, trackLabel: candidate.track.name, edition: candidate.edition };
    const rank = vi.fn(async () => plan), explain = vi.fn(async () => report);
    const fetch = vi.fn(() => { throw new Error("injected_worker_models_have_no_transport"); }); vi.stubGlobal("fetch", fetch);
    const first = (await claimRunV7("review-phase-one"))!;
    await processClaimedRunV7(first, { rank, explain });
    const list = (await readRunV7(created.run.row.run_id))!, listResponse = presentRunV7(list, created.session);
    expect(list.row.status).toBe("list_ready"); expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].detailStatus).toBe("pending"); expect(list.body.report).toBeUndefined();
    expect(listResponse.decisionToken).toBe(originalToken); expect(list.body.listReadyAt).toBeTruthy(); expect(list.body.detailsReadyAt).toBeNull();
    expect(explain).not.toHaveBeenCalled();
    const second = (await claimRunV7("review-phase-two"))!;
    expect(Number(second.fence)).toBeGreaterThan(Number(first.fence));
    await processClaimedRunV7(second, { rank, explain });
    const ready = (await readRunV7(created.run.row.run_id))!, readyResponse = presentRunV7(ready, created.session);
    expect(ready.row.status).toBe("ready"); expect(readyResponse.decisionToken).toBe(originalToken);
    expect(ready.body.items[0].detailStatus).toBe("ready"); expect(ready.body.items[0].detail?.itemId).toBe(candidate.recordId);
    expect(ready.body.listReadyAt).toBe(list.body.listReadyAt); expect(ready.body.detailsReadyAt).toBeTruthy();
    expect(ready.row.submitted_at).toEqual(created.run.row.submitted_at); expect(ready.row.detail_deadline_at).toEqual(created.run.row.detail_deadline_at);
    expect(rank).toHaveBeenCalledTimes(1); expect(explain).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  });

  it("restores one encrypted worker audit sample after an interrupted explanation and never includes it in the public run", async () => {
    const created = await create(), claim = (await claimRunV7("review-audit-first"))!, candidate = created.input.context.candidates[0].record;
    const report = reportFixture(created.session.profile, created.input.context.catalogVersion);
    report.recommendations[0] = { ...report.recommendations[0], itemId: candidate.recordId, seriesId: candidate.seriesId, name: candidate.name, trackLabel: candidate.track.name, edition: candidate.edition };
    let reason = { text: "", basis: "suggestion" as const, studentFactIds: [] as string[], competitionFactIds: [] as string[], conditions: [] as string[] };
    const key = `${candidate.recordId}.reason.0`;
    for (let index = 0; index < 1000; index++) {
      reason = { ...reason, text: `建议把资料分组。WORKER_AUDIT_PRIVATE_MARKER_${index}` };
      if (isLowRiskAuditSampleV7(JSON.stringify([created.input.context.catalogVersion, created.session.profile.revision, { key, itemId: candidate.recordId, reason }]))) break;
    }
    const sampled = { key, itemId: candidate.recordId, reason }, seed = [created.input.context.catalogVersion, created.session.profile.revision];
    const event = { stage: "v7.audit", kind: "validation" as const, data: { profileRevision: created.session.profile.revision, catalogVersion: created.input.context.catalogVersion,
      sampling: { algorithm: "sha256-uint32be-mod5-zero", seed, rate: 0.2 }, rate: 0.2, offlineSamples: [{ ...sampled, sampleDigest: createHash("sha256").update(JSON.stringify([...seed, sampled])).digest("hex") }] } };
    const plan = { profileRevision: created.session.profile.revision, catalogVersion: created.input.context.catalogVersion, recommendations: [{ itemId: candidate.recordId, reasons: [reason] }], shortfallReason: "隔离审计持久化测试。" };
    const detail = report.recommendations[0], items = [{ rank: 1, itemId: candidate.recordId, seriesId: candidate.seriesId, name: candidate.name, trackLabel: candidate.track.name, edition: candidate.edition, officialUrl: null, detailStatus: "pending" as const }];
    await commitRunV7(claim, "list_ready", { ...claim.body, plan, items, listReadyAt: new Date().toISOString() });
    let interrupted = false;
    const rank = vi.fn(), explain: typeof import("@/lib/competitions/v7/model").explainDecisionV7 = async (_context, _plan, options) => {
      await options?.onObservation?.(event); await options?.onObservation?.(event);
      if (!interrupted) { interrupted = true; throw new Error("DECISION_LEASE_LOST"); }
      return { ...report, recommendations: [detail] };
    };
    await processClaimedRunV7(claim, { rank, explain });
    const recovering = (await readRunV7(claim.row.run_id))!;
    expect(recovering.row.status).toBe("explaining"); expect(recovering.body.auditObservations).toEqual([event]); expect(recovering.body.report).toBeUndefined();
    const restarted = (await claimRunV7("review-audit-restarted"))!;
    await processClaimedRunV7(restarted, { rank, explain });
    const saved = (await readRunV7(claim.row.run_id))!;
    expect(saved.row.status).toBe("ready"); expect(saved.body.auditObservations).toEqual([event]);
    expect(saved.row.ciphertext.toString()).not.toContain("WORKER_AUDIT_PRIVATE_MARKER");
    expect(JSON.stringify(presentRunV7(saved, created.session))).not.toMatch(/auditObservations|offlineSamples|sampleDigest|WORKER_AUDIT_PRIVATE_MARKER/);
    expect(rank).not.toHaveBeenCalled();
  });

  it("refuses old source binding before either model phase can dispatch", async () => {
    const created = await create(), claim = (await claimRunV7("review-source-mismatch"))!;
    expect(claim.row.run_id).toBe(created.run.row.run_id);
    process.env.SAITU_V7_SOURCE_SHA256 = "b".repeat(64);
    const rank = vi.fn(), explain = vi.fn();
    await processClaimedRunV7(claim, { rank, explain });
    const saved = (await readRunV7(claim.row.run_id))!;
    expect(saved.row.status).toBe("failed"); expect(saved.body.error).toBe("DECISION_IMPLEMENTATION_CHANGED");
    expect(rank).not.toHaveBeenCalled(); expect(explain).not.toHaveBeenCalled();
  });

  it("does not reset an already missed list deadline on worker restart", async () => {
    const created = await create();
    await admin.query("update competition_decision_runs set submitted_at=now()-interval '61 seconds',list_deadline_at=now()-interval '1 second',detail_deadline_at=now()+interval '89 seconds' where run_id=$1", [created.run.row.run_id]);
    const claim = (await claimRunV7("review-list-expired"))!, rank = vi.fn(), explain = vi.fn();
    await processClaimedRunV7(claim, { rank, explain });
    const saved = (await readRunV7(claim.row.run_id))!;
    expect(saved.row.status).toBe("failed"); expect(saved.body.error).toBe("LIST_DEADLINE_EXCEEDED");
    expect(saved.row.submitted_at).toEqual(claim.row.submitted_at); expect(saved.body.listReadyAt).toBeNull();
    expect(rank).not.toHaveBeenCalled(); expect(explain).not.toHaveBeenCalled();
  });

  it("continues ranking after the 40-second target within the approved 60-second cutoff without resetting details", async () => {
    expect(RECOMMENDATION_LIST_DEADLINE_MS).toBe(40_000);
    expect(RECOMMENDATION_RANK_HARD_TIMEOUT_MS).toBe(60_000);
    const created = await create();
    expect(created.run.row.list_deadline_at.getTime() - created.run.row.submitted_at.getTime()).toBe(60_000);
    expect(created.run.row.detail_deadline_at.getTime() - created.run.row.submitted_at.getTime()).toBe(150_000);
    await admin.query("update competition_decision_runs set submitted_at=now()-interval '45 seconds',list_deadline_at=now()+interval '15 seconds',detail_deadline_at=now()+interval '105 seconds' where run_id=$1", [created.run.row.run_id]);
    const claim = (await claimRunV7("review-approved-rank-cutoff"))!, explain = vi.fn();
    const rank = vi.fn(async (_context, options) => {
      expect(options.deadlineEpochMs).toBe(claim.row.submitted_at.getTime() + 60_000 - 750);
      throw new Error("RANK_BOUNDARY_PROBE");
    });
    await processClaimedRunV7(claim, { rank, explain });
    const saved = (await readRunV7(claim.row.run_id))!;
    expect(rank).toHaveBeenCalledTimes(1); expect(explain).not.toHaveBeenCalled();
    expect(saved.body.error).toBe("RANK_BOUNDARY_PROBE");
    expect(saved.row.submitted_at).toEqual(claim.row.submitted_at);
    expect(saved.row.detail_deadline_at).toEqual(claim.row.detail_deadline_at);
    expect(saved.row.detail_deadline_at.getTime() - saved.row.submitted_at.getTime()).toBe(150_000);
  });

  it("isolates chat journal request IDs and rejects a stale generation before accounting", async () => {
    const created = await create(), fetch = transport();
    const before = Number((await admin.query("select count(*) from ai_spend_ledger")).rows[0].count);
    await expect(withDurableAiChat(created.run.row.run_id, created.session.generation + 1, "stale-request", call)).rejects.toThrow("DECISION_REVISION_CHANGED");
    expect(Number((await admin.query("select count(*) from ai_spend_ledger")).rows[0].count)).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
    await withDurableAiChat(created.run.row.run_id, created.session.generation, "request-one", call);
    await withDurableAiChat(created.run.row.run_id, created.session.generation, "request-two", call);
    await withDurableAiChat(created.run.row.run_id, created.session.generation, "request-one", call);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await admin.query("select call_key from competition_decision_calls where run_id=$1 order by call_key", [created.run.row.run_id])).rows.map(row => row.call_key)).toEqual(["chat:request-one:v7.rank:batch:1", "chat:request-two:v7.rank:batch:1"]);
  });

  it("replays an ordinary chat after HTTP cache loss without changing its paid prompt or duplicating history", async () => {
    const { claim, session } = await claimed();
    const report = reportFixture(session.profile, claim.body.context.catalogVersion), detail = report.recommendations[0];
    await commitRunV7(claim, "ready", { ...claim.body, report });
    const token = verifyDecisionTokenV7(createDecisionTokenV7(session))!;
    const fetch = transport({ message: "可以结合现有任务逐项讨论。", claims: [] });
    const input: DecisionChatRequest = { requestId: randomUUID(), expectedRevision: session.profile.revision, action: { type: "message", text: "这项任务可以分成几个阶段安排？", selectedItemIds: [detail.itemId] }, aiConsent: { accepted: true, version: getCurrentAiConsentDisclosure().version }, decisionToken: createDecisionTokenV7(session) };
    const invoke = () => chatV7(new Request("http://localhost/api/ai/competition-chat", { method: "POST", headers: { "x-real-ip": "127.0.0.20" } }), randomUUID(), input, token);
    const first = await invoke(), firstBody = await first.json();
    expect(first.status, JSON.stringify(firstBody)).toBe(200);
    await admin.query("delete from competition_idempotency"); resetRateLimitStateForTests();
    const replay = await invoke(), replayBody = await replay.json();
    expect(replay.status, JSON.stringify(replayBody)).toBe(200); expect(replayBody).toEqual(firstBody);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await readSessionV7(token))?.history).toHaveLength(2);
    const changedInput = await chatV7(new Request("http://localhost/api/ai/competition-chat", { method: "POST", headers: { "x-real-ip": "127.0.0.20" } }), randomUUID(), { ...input, action: { ...input.action as Extract<DecisionChatRequest["action"], { type: "message" }>, text: "同一个请求号换成了另一条输入" } }, token);
    expect(changedInput.status).toBe(409); expect((await changedInput.json()).error).toBe("DECISION_REQUEST_CHANGED");
    expect(fetch).toHaveBeenCalledTimes(1); expect((await readSessionV7(token))?.history).toHaveLength(2);
  });

  it("blocks the old Next chat review after a real active symlink switch, retaining its first response and accounting", async () => {
    const { claim, session } = await claimed(), report = reportFixture(session.profile, claim.body.context.catalogVersion);
    await commitRunV7(claim, "ready", { ...claim.body, report });
    const slots = releaseSlots(), token = verifyDecisionTokenV7(createDecisionTokenV7(session))!, requestId = randomUUID();
    const fact = session.profile.facts[0];
    const assertion = { text: fact.label, basis: "student" as const, studentFactIds: [fact.id], competitionFactIds: [], conditions: [] };
    const input: DecisionChatRequest = { requestId, expectedRevision: session.profile.revision, action: { type: "message", text: "这项任务中如何安排团队的合作流程？", selectedItemIds: [report.recommendations[0].itemId] }, aiConsent: { accepted: true, version: getCurrentAiConsentDisclosure().version }, decisionToken: createDecisionTokenV7(session) };
    let calls = 0;
    const fetch = vi.fn(async () => { calls++; if (calls === 1) { slots.activate("b"); return providerResponse({ message: "有依据的回答", claims: [assertion] }); } return providerResponse({ checks: [{ key: "chat.0", supported: true, reason: "直接引用已保存的学生事实。" }] }); }); vi.stubGlobal("fetch", fetch);
    const invoke = () => chatV7(new Request("http://localhost/api/ai/competition-chat", { method: "POST", headers: { "x-real-ip": "127.0.0.25" } }), randomUUID(), input, token);
    const inactive = await invoke(); expect(inactive.status).toBe(503); expect(fetch).toHaveBeenCalledTimes(1);
    const row = (await admin.query("select * from competition_decision_calls where run_id=$1", [claim.row.run_id])).rows[0];
    expect(row.state).toBe("completed"); expect((await admin.query("select state from ai_spend_ledger where id=$1", [row.reservation_id])).rows[0].state).toBe("usage_estimated");
    expect((await readSessionV7(token))?.history).toHaveLength(0);
    slots.activate("a"); await admin.query("delete from competition_idempotency"); resetRateLimitStateForTests();
    const recovered = await invoke(), body = await recovered.json();
    expect(recovered.status, JSON.stringify(body)).toBe(200); expect(fetch).toHaveBeenCalledTimes(2); expect(body.claims).toEqual([assertion]);
    expect((await readSessionV7(token))?.history).toHaveLength(2);
  });

  it("encrypts a sampled chat claim and restores its one audit record after HTTP cache loss", async () => {
    const { claim, session } = await claimed(), report = reportFixture(session.profile, claim.body.context.catalogVersion);
    await commitRunV7(claim, "ready", { ...claim.body, report });
    let sample = { text: "", basis: "suggestion" as const, studentFactIds: [] as string[], competitionFactIds: [] as string[], conditions: [] as string[] };
    for (let index = 0; index < 1000; index++) {
      sample = { ...sample, text: `建议把资料归为若干组再讨论。AUDIT_PRIVATE_MARKER_${index}` };
      if (isLowRiskAuditSampleV7(JSON.stringify([claim.body.context.catalogVersion, session.profile.revision, { key: "chat.0", claim: sample }]))) break;
    }
    expect(isLowRiskAuditSampleV7(JSON.stringify([claim.body.context.catalogVersion, session.profile.revision, { key: "chat.0", claim: sample }]))).toBe(true);
    const token = verifyDecisionTokenV7(createDecisionTokenV7(session))!, requestId = randomUUID(), fetch = transport({ message: "供讨论的建议", claims: [sample] });
    const input: DecisionChatRequest = { requestId, expectedRevision: session.profile.revision, action: { type: "message", text: "这项任务中如何安排团队的合作流程？", selectedItemIds: [report.recommendations[0].itemId] }, aiConsent: { accepted: true, version: getCurrentAiConsentDisclosure().version }, decisionToken: createDecisionTokenV7(session) };
    const invoke = () => chatV7(new Request("http://localhost/api/ai/competition-chat", { method: "POST", headers: { "x-real-ip": "127.0.0.26" } }), randomUUID(), input, token);
    const first = await invoke(), body = await first.json(); expect(first.status, JSON.stringify(body)).toBe(200);
    const row = (await admin.query("select * from competition_decision_chat_requests where run_id=$1 and request_id=$2", [claim.row.run_id, requestId])).rows[0];
    const snapshot = unsealV7<ChatSnapshotV7>(`chat:${claim.row.run_id}:${requestId}`, row);
    expect(snapshot.auditObservations).toHaveLength(1);
    const data = snapshot.auditObservations![0].data as { rate: number; offlineSamples: { claim: typeof sample; sampleDigest: string }[] };
    expect(data.rate).toBe(0.2); expect(data.offlineSamples).toHaveLength(1); expect(data.offlineSamples[0].claim).toEqual(sample); expect(data.offlineSamples[0].sampleDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(row.ciphertext.toString()).not.toContain("AUDIT_PRIVATE_MARKER"); expect(JSON.stringify(body)).not.toMatch(/auditObservations|offlineSamples|sampleDigest|sampling/);
    await admin.query("delete from competition_idempotency"); resetRateLimitStateForTests();
    const replay = await invoke(); expect(replay.status).toBe(200); expect(await replay.json()).toEqual(body); expect(fetch).toHaveBeenCalledTimes(1);
    const saved = (await admin.query("select * from competition_decision_chat_requests where run_id=$1 and request_id=$2", [claim.row.run_id, requestId])).rows[0];
    expect(unsealV7<ChatSnapshotV7>(`chat:${claim.row.run_id}:${requestId}`, saved).auditObservations).toHaveLength(1);
  });

  it("recovers a chat commit failure after the paid journal completed, with one transport and one history append", async () => {
    const { claim, session } = await claimed(), report = reportFixture(session.profile, claim.body.context.catalogVersion);
    await commitRunV7(claim, "ready", { ...claim.body, report });
    const token = verifyDecisionTokenV7(createDecisionTokenV7(session))!, requestId = randomUUID();
    const input: DecisionChatRequest = { requestId, expectedRevision: session.profile.revision, action: { type: "message", text: "这项任务中如何安排团队的合作流程？", selectedItemIds: [report.recommendations[0].itemId] }, aiConsent: { accepted: true, version: getCurrentAiConsentDisclosure().version }, decisionToken: createDecisionTokenV7(session) };
    const fetch = transport({ message: "可以围绕现有任务继续讨论。", claims: [] });
    // A real PostgreSQL trigger rejects the final chat commit. The paid call
    // journal has already committed; the snapshot/reply/history transaction rolls back.
    await admin.query("create function public.backend_review_fail_chat_finish() returns trigger language plpgsql as $$ begin raise exception 'injected_chat_commit_failure'; end $$");
    await admin.query("create trigger backend_review_chat_finish before update on competition_decision_chat_requests for each row execute function public.backend_review_fail_chat_finish()");
    const invoke = () => chatV7(new Request("http://localhost/api/ai/competition-chat", { method: "POST", headers: { "x-real-ip": "127.0.0.24" } }), randomUUID(), input, token);
    const interrupted = await invoke();
    expect(interrupted.status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1); expect((await readSessionV7(token))?.history).toHaveLength(0);
    expect((await admin.query("select state from competition_decision_calls where run_id=$1 and call_key like $2", [claim.row.run_id, `chat:${requestId}:%`])).rows[0].state).toBe("completed");
    await admin.query("drop trigger backend_review_chat_finish on competition_decision_chat_requests");
    await admin.query("drop function public.backend_review_fail_chat_finish()");
    await admin.query("delete from competition_idempotency"); resetRateLimitStateForTests();
    const recovered = await invoke(), body = await recovered.json();
    expect(recovered.status, JSON.stringify(body)).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1); expect((await readSessionV7(token))?.history).toHaveLength(2);
    expect(Number((await admin.query("select count(*) from ai_spend_ledger where id in (select reservation_id from competition_decision_calls where run_id=$1)", [claim.row.run_id])).rows[0].count)).toBe(1);
  });

  it("returns one chat correction run across HTTP cache loss and rejects a distinct stale correction", async () => {
    const created = await create(), token = verifyDecisionTokenV7(createDecisionTokenV7(created.session))!;
    const input: DecisionChatRequest = { requestId: randomUUID(), expectedRevision: created.session.profile.revision, action: { type: "message", text: "刚才填错了，每周8小时改成3小时" }, aiConsent: { accepted: true, version: getCurrentAiConsentDisclosure().version }, decisionToken: createDecisionTokenV7(created.session) };
    const fetch = vi.fn(() => { throw new Error("deterministic_correction_must_not_dispatch"); }); vi.stubGlobal("fetch", fetch);
    const invoke = (value = input) => chatV7(new Request("http://localhost/api/ai/competition-chat", { method: "POST", headers: { "x-real-ip": "127.0.0.21" } }), randomUUID(), value, token);
    const first = await invoke(), firstBody = await first.json();
    expect(first.status, JSON.stringify(firstBody)).toBe(200); expect(firstBody.run).toBeTruthy();
    await admin.query("delete from competition_idempotency"); resetRateLimitStateForTests();
    const replay = await invoke(), replayBody = await replay.json();
    expect(replay.status, JSON.stringify(replayBody)).toBe(200); expect(replayBody.run.runId).toBe(firstBody.run.runId);
    expect((await readSessionV7(verifyDecisionTokenV7(firstBody.decisionToken)!))?.generation).toBe(1);
    const conflict = await invoke({ ...input, requestId: randomUUID() }); expect(conflict.status).toBe(409);
    expect(Number((await admin.query("select count(*) from competition_decision_runs where state_key=$1", [created.session.id])).rows[0].count)).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prevents a valid token for another session from reading a run", async () => {
    const first = await create(), second = await create();
    const request = (token: string) => new Request(`http://localhost/api/ai/competition-recommend/runs/${first.run.row.run_id}`, { headers: { authorization: `Bearer ${token}`, "x-real-ip": "127.0.0.22" } });
    const wrong = await getRun(request(createDecisionTokenV7(second.session)), { params: Promise.resolve({ runId: first.run.row.run_id }) });
    expect(wrong.status).toBe(404);
    expect(await wrong.json()).toEqual({ ok: false, error: "DECISION_RUN_NOT_FOUND" });
    const right = await getRun(request(createDecisionTokenV7(first.session)), { params: Promise.resolve({ runId: first.run.row.run_id }) });
    expect(right.status).toBe(200); expect((await right.json()).runId).toBe(first.run.row.run_id);
  });

  function retryRequest(created: Awaited<ReturnType<typeof create>>, input: Record<string, unknown> = {}, runId = created.run.row.run_id) {
    return retryRun(new Request(`http://localhost/api/ai/competition-recommend/runs/${runId}/retry`, {
      method: "POST", headers: { "content-type": "application/json", "x-real-ip": "127.0.0.23" },
      body: JSON.stringify({ decisionToken: createDecisionTokenV7(created.session), expectedRevision: created.session.profile.revision, requestId: randomUUID(), aiConsent: { accepted: true, version: getCurrentAiConsentDisclosure().version }, ...input }),
    }), { params: Promise.resolve({ runId }) });
  }

  async function authorizeTestBatch(callLimit = 3) {
    await admin.query("update ai_spend_development_batches set state='closed',closed_at=now() where state='active'");
    const runId = `v7-review-formal-${randomUUID()}`, policyHash = createHash("sha256").update(readFileSync("docs/v7/implementation-contract.md")).digest("hex");
    const condition = { schemaVersion: "saitu.user-approved-budget-condition.v7", model: "deepseek-flash", effort: "high", phase: "formal", policySha256: policyHash, authorization: "user-approved-20261109-continuation", freshPgRowsVerified: true };
    const conditionHash = createHash("sha256").update(JSON.stringify(condition)).digest("hex");
    await admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,1000000)", [runId]);
    const baseline = (await admin.query("select id from ai_spend_ledger")).rows.map(row => row.id);
    await admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256)
      values($1,$2,$3,10000000,0,10000000,$4,'Isolated test authorization; no provider network', 'high',$5,$6::jsonb,'saitu.v7','formal',$7)`, [runId, budgetRunId, callLimit, baseline, conditionHash, JSON.stringify(condition), policyHash]);
    Object.assign(process.env, { AI_SPEND_RUN_ID: runId, AI_SPEND_PHASE: "formal", AI_SPEND_POLICY_SHA256: policyHash, AI_SPEND_AUTHORIZED_EFFORT: "high", AI_SPEND_HIGH_CONDITION_SHA256: conditionHash });
    return { runId, policyHash, conditionHash };
  }

  it("creates one explicit failed retry with new deadlines, including concurrent and cache-lost replay", async () => {
    const created = await create(), requestId = randomUUID();
    await admin.query("update competition_decision_runs set status='failed',submitted_at=now()-interval '75 seconds',list_deadline_at=now()-interval '15 seconds',detail_deadline_at=now()+interval '75 seconds' where run_id=$1", [created.run.row.run_id]);
    const [first, concurrent] = await Promise.all([retryRequest(created, { requestId }), retryRequest(created, { requestId })]);
    const firstBody = await first.json(), concurrentBody = await concurrent.json();
    expect(first.status, JSON.stringify(firstBody)).toBe(202); expect(concurrent.status, JSON.stringify(concurrentBody)).toBe(202);
    expect(firstBody.runId).not.toBe(created.run.row.run_id); expect(concurrentBody.runId).toBe(firstBody.runId);
    expect(firstBody.profileRevision).toBe(created.session.profile.revision); expect(verifyDecisionTokenV7(firstBody.decisionToken)?.generation).toBe(1);
    const saved = (await readRunV7(firstBody.runId))!;
    expect(saved.row.list_deadline_at.getTime() - saved.row.submitted_at.getTime()).toBe(60_000);
    expect(saved.row.detail_deadline_at.getTime() - saved.row.submitted_at.getTime()).toBe(150_000);
    expect((await readRunV7(created.run.row.run_id))?.row.status).toBe("superseded");
    await admin.query("delete from competition_idempotency"); resetRateLimitStateForTests();
    const replay = await retryRequest(created, { requestId }), replayBody = await replay.json();
    expect(replay.status, JSON.stringify(replayBody)).toBe(202); expect(replayBody.runId).toBe(firstBody.runId); expect(replayBody.submittedAt).toBe(firstBody.submittedAt);
    const staleDistinct = await retryRequest(created); expect(staleDistinct.status).toBe(409);
    expect(Number((await admin.query("select count(*) from competition_decision_runs where state_key=$1", [created.session.id])).rows[0].count)).toBe(2);
  });

  it("rejects retries for a live run, another session, and a token near or beyond expiry", async () => {
    const created = await create(), another = await create();
    const live = await retryRequest(created); expect(live.status).toBe(409); expect((await live.json()).error).toBe("DECISION_RUN_NOT_FAILED");
    await admin.query("update competition_decision_runs set status='failed' where run_id=$1", [created.run.row.run_id]);
    const cross = await retryRequest(another, {}, created.run.row.run_id); expect(cross.status).toBe(409);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 100_000);
    const near = await retryRequest(created); expect(near.status).toBe(409); expect((await near.json()).error).toBe("DECISION_SESSION_RENEWAL_REQUIRED");
    vi.mocked(Date.now).mockReturnValue(created.session.expiresAt + 1);
    const expired = await retryRequest(created); expect(expired.status).toBe(401); expect((await expired.json()).error).toBe("DECISION_SESSION_EXPIRED");
    expect(Number((await admin.query("select count(*) from competition_decision_runs where state_key=$1", [created.session.id])).rows[0].count)).toBe(1);
  });

  it("requires the exact administrator-granted v7 phase, policy, high condition, and effort before reserving", async () => {
    const batch = await authorizeTestBatch(), input = { system: "isolated", prompt: "v7 phase test", maxTokens: 100, model: "deepseek-flash", effort: "high" };
    process.env.AI_SPEND_PHASE = "performance"; expect(await reserveAiSpend(input)).toEqual({ ok: false, reason: "spend_configuration_invalid" });
    process.env.AI_SPEND_PHASE = "formal"; process.env.AI_SPEND_POLICY_SHA256 = "f".repeat(64); expect(await reserveAiSpend(input)).toEqual({ ok: false, reason: "spend_configuration_invalid" });
    process.env.AI_SPEND_POLICY_SHA256 = batch.policyHash; process.env.AI_SPEND_HIGH_CONDITION_SHA256 = "e".repeat(64); expect(await reserveAiSpend(input)).toEqual({ ok: false, reason: "spend_configuration_invalid" });
    process.env.AI_SPEND_HIGH_CONDITION_SHA256 = batch.conditionHash; expect(await reserveAiSpend({ ...input, effort: "max" })).toEqual({ ok: false, reason: "spend_configuration_invalid" });
    expect(Number((await admin.query("select count(*) from ai_spend_ledger where run_id=$1", [batch.runId])).rows[0].count)).toBe(0);
    const accepted = await reserveAiSpend(input); expect(accepted.ok).toBe(true); if (accepted.ok) await accepted.reservation.settle(undefined, false);
  });

  it("prevents the runtime role from issuing its own v7 grant, budget, or authority", async () => {
    const batch = await authorizeTestBatch();
    await expect(getPool().query("update ai_spend_development_batches set call_limit=999999 where run_id=$1", [batch.runId])).rejects.toMatchObject({ code: "42501" });
    await expect(getPool().query("insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,1000000)", [`unauthorized-${randomUUID()}`])).rejects.toMatchObject({ code: "42501" });
    await expect(getPool().query("update ai_spend_authority set run_id=$1 where singleton=true", [batch.runId])).rejects.toMatchObject({ code: "42501" });
    expect((await admin.query("select run_id from ai_spend_authority where singleton=true")).rows[0].run_id).toBe(budgetRunId);
    expect((await admin.query("select call_limit from ai_spend_development_batches where run_id=$1", [batch.runId])).rows[0].call_limit).toBe(3);
  });

  it("enforces a v7 formal call cap atomically under concurrent reservations and preserves conservative unknown costs", async () => {
    const batch = await authorizeTestBatch(3), input = { system: "isolated", prompt: "v7 formal call race", maxTokens: 100, model: "deepseek-flash", effort: "high" };
    const attempts = await Promise.all(Array.from({ length: 12 }, () => reserveAiSpend(input)));
    const accepted = attempts.filter(result => result.ok); expect(accepted).toHaveLength(3);
    expect(attempts.filter(result => !result.ok)).toEqual(Array.from({ length: 9 }, () => ({ ok: false, reason: "spend_budget_exhausted" })));
    await Promise.all(accepted.map(result => result.reservation.settle()));
    expect(await reserveAiSpend(input)).toEqual({ ok: false, reason: "spend_budget_exhausted" });
    const ledger = (await admin.query("select state,phase,charged_micros,reserved_micros from ai_spend_ledger where run_id=$1", [batch.runId])).rows;
    expect(ledger).toHaveLength(3); expect(ledger.every(row => row.state === "conservative" && row.phase === "formal" && row.charged_micros === row.reserved_micros)).toBe(true);
  });

  it("replays the forward Top5 grant migration without invalidating historical v7 grants", async () => {
    const batch = await authorizeTestBatch();
    const before = (await admin.query("select * from ai_spend_development_batches where run_id=$1", [batch.runId])).rows[0];
    for (let repeat = 0; repeat < 2; repeat++) {
      await admin.query(readFileSync("db/migrations/20261109_spend_v7_top5_policy.sql", "utf8"));
      await admin.query(readFileSync("db/migrations/20261109_spend_user_unbounded_execution.sql", "utf8"));
    }
    expect((await admin.query("select * from ai_spend_development_batches where run_id=$1", [batch.runId])).rows[0]).toEqual(before);
    const accepted = await reserveAiSpend({ system: "isolated", prompt: "idempotent grant", maxTokens: 100, model: "deepseek-flash", effort: "high" });
    expect(accepted.ok).toBe(true); if (accepted.ok) await accepted.reservation.settle(undefined, false);
  });

  it("requires the read-only budget CHECK gate to reject a missing phase/policy/evidence predicate", async () => {
    const source = readFileSync("ops/postgresql/verify-production-database-readonly.sql", "utf8");
    const marker = " AS budget_state_checks_contract \\gset", end = source.indexOf(marker), start = source.lastIndexOf("WITH expected(table_name, expression)", end);
    expect(start).toBeGreaterThanOrEqual(0); expect(end).toBeGreaterThan(start);
    // Execute this exact catalog-query block from the production SQL. The full
    // peer/socket/session protocol is independently exercised by the ops suite.
    const query = source.slice(start, end) + " AS budget_state_checks_contract";
    expect((await admin.query(query)).rows[0].budget_state_checks_contract).toBe(true);
    const constraint = (await admin.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_development_effort_evidence_check'")).rows[0].definition;
    await admin.query("alter table ai_spend_development_batches drop constraint ai_spend_development_effort_evidence_check");
    try { expect((await admin.query(query)).rows[0].budget_state_checks_contract).toBe(false); }
    finally { await admin.query(`alter table ai_spend_development_batches add constraint ai_spend_development_effort_evidence_check ${constraint}`); }
  });
});
