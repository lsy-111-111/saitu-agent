import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {getPool} from "@/lib/db/pool";
import {student} from "../v6/decision-fixtures";
import {buildDecisionContextV7} from "@/lib/competitions/v7/model";
import {applyExplicitCorrectionV7} from "@/lib/competitions/v7/corrections";
import {createDecisionTokenV7,verifyDecisionTokenV7} from "@/lib/competitions/v7/crypto";
import {claimRunV7,commitRunV7,createRunWriterV7,enqueueRunV7,presentRunV7,readRunV7,readSessionV7,releaseRunLeaseV7,submissionKeyV7} from "@/lib/competitions/v7/store";
import {runDurableAiAttempt,withDurableAiRun} from "@/lib/ai/durable-call";
import {createV7TestDatabase} from "../../helpers/v7-database-environment";

const integration=process.env.RUN_V7_DATABASE_TESTS==="1"?describe:describe.skip;
integration("v7 durable PostgreSQL state with no live provider",()=>{
  const original={...process.env},states:string[]=[],runs:string[]=[];
  let admin:pg.Client,fixture:Awaited<ReturnType<typeof createV7TestDatabase>>;
  beforeAll(async()=>{
    fixture=await createV7TestDatabase("durable");admin=fixture.admin;
    Object.assign(process.env,{DATABASE_URL:fixture.runtimeUrl,AI_API_KEY:"",AI_CONVERSATION_SIGNING_SECRET:"v7-isolated-database-test-signing-key-0000"});
  });
  afterAll(async()=>{
    if(admin){
      await admin.query("delete from competition_decision_calls where run_id=any($1::uuid[])",[runs]);
      await admin.query("delete from competition_decision_runs where state_key=any($1::text[])",[states]);
      await admin.query("delete from competition_decision_states where state_key=any($1::text[])",[states]);
    }
    const globals=globalThis as typeof globalThis&{__pgPool?:pg.Pool};
    await globals.__pgPool?.end();delete globals.__pgPool;
    await fixture?.close();process.env={...original};
  });
  async function create(){
    const sessionId=randomUUID(),legacy=student(),context=buildDecisionContextV7(legacy,{profileId:sessionId});
    const input={sessionId,expiresAt:Date.now()+180000,legacy,context,submissionKey:submissionKeyV7(sessionId,"initial")};
    const created=await enqueueRunV7(input);states.push(created.session.id);runs.push(created.run.row.run_id);return {...created,input};
  }
  it("persists one logical submission and replays it after the HTTP cache is lost",async()=>{
    const created=await create();
    const replay=await enqueueRunV7(created.input);
    expect(replay.run.row.run_id).toBe(created.run.row.run_id);
    expect(replay.run.row.submitted_at).toEqual(created.run.row.submitted_at);
    expect(created.run.row.ciphertext.toString()).not.toContain("weeklyCommitment");
    const token=verifyDecisionTokenV7(createDecisionTokenV7(created.session))!;
    expect((await readSessionV7(token))?.currentRunId).toBe(created.run.row.run_id);
    expect((await readRunV7(created.run.row.run_id))?.body.context.profile.revision).toBe(created.input.context.profile.revision);
    // Keep this fixture out of subsequent worker claims.
    await getPool().query("update competition_decision_runs set status='superseded' where run_id=$1",[created.run.row.run_id]);
  });
  it("rejects competing corrections and never publishes a late old worker result",async()=>{
    const created=await create(),token=verifyDecisionTokenV7(createDecisionTokenV7(created.session))!;
    const claim=(await claimRunV7("test-old-worker"))!;
    expect(claim.row.run_id).toBe(created.run.row.run_id);
    await commitRunV7(claim,"ranking",claim.body);
    const changed=applyExplicitCorrectionV7(created.session.profile,"刚才填错了，每周8小时改成3小时",created.input.legacy);
    expect(changed.kind).toBe("applied");
    const input={...created.input,context:buildDecisionContextV7(created.input.legacy,{profile:changed.profile}),previous:token,expectedRevision:created.session.profile.revision};
    const updates=await Promise.allSettled([enqueueRunV7({...input,submissionKey:submissionKeyV7(token.sessionId,"correction-a")}),enqueueRunV7({...input,submissionKey:submissionKeyV7(token.sessionId,"correction-b")})]);
    expect(updates.filter(value=>value.status==="fulfilled")).toHaveLength(1);
    const saved=updates.find(value=>value.status==="fulfilled")!;if(saved.status!=="fulfilled")throw new Error("missing_commit");runs.push(saved.value.run.row.run_id);
    await expect(commitRunV7(claim,"ready",claim.body)).rejects.toThrow("DECISION_LEASE_LOST");
    await expect(readSessionV7(token)).rejects.toThrow("DECISION_REVISION_CHANGED");
    expect(presentRunV7(saved.value.run,saved.value.session).profileRevision).toBe(changed.profile.revision);
    await getPool().query("update competition_decision_runs set status='superseded' where run_id=$1",[saved.value.run.row.run_id]);
  });
  it("reclaims an expired lease and refuses to repeat a call with unknown dispatch outcome",async()=>{
    const created=await create(),first=(await claimRunV7("test-crashed"))!;
    expect(first.row.run_id).toBe(created.run.row.run_id);
    await commitRunV7(first,"ranking",first.body);
    let calls=0;
    await withDurableAiRun({runId:first.row.run_id,owner:first.owner,fence:first.fence},()=>runDurableAiAttempt({key:"v7.rank:batch:1",prompt:"fixture"},async()=>{calls++;return {ok:true,data:{answer:1},model:"deepseek-flash",attempts:1,httpStatus:200,finishReason:"stop",upstreamAttempted:true,durationMs:1};},()=>{throw new Error("unexpected_receipt");}));
    await getPool().query("update competition_decision_calls set state='dispatch_intent',ciphertext=null,iv=null,tag=null where run_id=$1",[first.row.run_id]);
    await getPool().query("update competition_decision_runs set lease_expires_at=now()-interval '1 second' where run_id=$1",[first.row.run_id]);
    const second=(await claimRunV7("test-restarted"))!;
    expect(Number(second.fence)).toBeGreaterThan(Number(first.fence));
    const result=await withDurableAiRun({runId:second.row.run_id,owner:second.owner,fence:second.fence},()=>runDurableAiAttempt({key:"v7.rank:batch:1",prompt:"fixture"},async()=>{calls++;throw new Error("duplicate_paid_call");},()=>{throw new Error("unexpected_receipt");}));
    expect(result).toMatchObject({ok:false,reason:"durable_outcome_unknown"});expect(calls).toBe(1);
    await expect(commitRunV7(first,"ready",first.body)).rejects.toThrow("DECISION_LEASE_LOST");
    await releaseRunLeaseV7(second);
    await getPool().query("update competition_decision_runs set status='superseded' where run_id=$1",[second.row.run_id]);
  });
  it("rejects a stale copy from the same lease without overwriting a newer result",async()=>{
    const created=await create(),claim=(await claimRunV7("test-cas"))!;
    expect(claim.row.run_id).toBe(created.run.row.run_id);
    const stale={...claim,row:{...claim.row},body:structuredClone(claim.body)};
    await commitRunV7(claim,"ranking",{...claim.body,error:"newer-result"});
    await expect(commitRunV7(stale,"ranking",{...stale.body,error:"stale-result"})).rejects.toThrow("DECISION_LEASE_LOST");
    expect((await readRunV7(claim.row.run_id))?.body.error).toBe("newer-result");
    expect((await readRunV7(claim.row.run_id))?.row.result_version).toBe(created.run.row.result_version+1);
    await commitRunV7(claim,"failed",claim.body);
  });
  it("serializes concurrent patches against the latest body, retaining every audit observation",async()=>{
    const created=await create(),claim=(await claimRunV7("test-single-writer"))!;
    expect(claim.row.run_id).toBe(created.run.row.run_id);
    const writer=createRunWriterV7(claim);
    await Promise.all(Array.from({length:12},(_,index)=>writer.update(body=>({status:"explaining",body:{...body,
      auditObservations:[...body.auditObservations??[],{stage:"v7.audit",kind:"validation",data:{index}}]}}))));
    await writer.flush();
    const saved=(await readRunV7(claim.row.run_id))!;
    expect(saved.body.auditObservations?.map(value=>value.data)).toEqual(Array.from({length:12},(_,index)=>({index})));
    expect(saved.row.result_version).toBe(created.run.row.result_version+12);
    await writer.update(body=>({status:"failed",body}));
    await expect(writer.update(body=>({status:"explaining",body}))).rejects.toThrow("DECISION_RUN_ALREADY_TERMINAL");
    expect((await readRunV7(claim.row.run_id))?.row.status).toBe("failed");
  });
  it("binds writes to the persisted session generation even when the lease is still valid",async()=>{
    const created=await create(),claim=(await claimRunV7("test-generation"))!;
    expect(claim.row.run_id).toBe(created.run.row.run_id);
    expect(claim.body.sessionGeneration).toBe(created.session.generation);
    await expect(commitRunV7(claim,"ranking",{...claim.body,sessionGeneration:claim.body.sessionGeneration+1})).rejects.toThrow("DECISION_RUN_BINDING_CHANGED");
    await admin.query("update competition_decision_states set generation=generation+1 where state_key=$1",[created.session.id]);
    await expect(commitRunV7(claim,"ranking",claim.body)).rejects.toThrow("DECISION_LEASE_LOST");
    expect((await readRunV7(claim.row.run_id))?.row.result_version).toBe(created.run.row.result_version);
    await admin.query("update competition_decision_runs set status='superseded' where run_id=$1",[claim.row.run_id]);
  });
});
