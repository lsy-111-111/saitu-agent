import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { bindBatchOutput, checkpointedRanking, validateBatchPolicy } from "../../../scripts/competitions/v6/ranking-batches.mjs";
import { canonicalHash } from "../../../scripts/competitions/v6/frozen-ranking-executor.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "saitu-ranking-batch-"));
  t.after(() => rm(directory, { recursive:true, force:true }));
  let dispatched = 0;
  const input = { profile:{ confirmed:true } }, freezeBinding = {catalogSha256:"same-frozen-input"};
  const run = {directory,slot:"C-001-01",input,algorithm:"C",repetition:1,freezeBinding,profileId:"p",caseId:"c",
    canStart:async()=>({ceiling:100}),
    execute:async invocationId=>{
      dispatched++;
      const output = {recommendations:[{itemId:"item1"}]};
      const shared = {invocationId,inputSha256:canonicalHash(input),outputSha256:canonicalHash(output),reservationIds:["synthetic-reservation"],freezeBinding,candidateSetSha256:canonicalHash(["item1"])};
      const observation = {...shared,output,operation:"recommend",algorithm:"C",repetition:0,profileId:"p",caseId:"c",fallback:false,execution:{modelStatus:"ok"}};
      const ranking = {...shared,runId:invocationId,algorithm:"C",profileId:"p",fallbackUsed:false,modelStatus:"ok",displayedItemIds:["item1"]};
      return {observation,ranking};
    }};
  return {directory,run,count:()=>dispatched};
}

test("resume reuses output hash and reservation ID without spending again", async t=>{
  const {run,count}=await fixture(t);
  const first=await checkpointedRanking(run);
  const resumed=await checkpointedRanking({...run,canStart:()=>assert.fail("budget checked for completed run")});
  assert.equal(first.status,"executed"); assert.equal(resumed.status,"reused");
  assert.deepEqual(resumed.result,first.result); assert.equal(count(),1);
  await assert.rejects(checkpointedRanking({...run,freezeBinding:{catalogSha256:"changed"}}),/binding_mismatch/);
});

test("a crash after intent never resends; an insufficient allowance never creates an intent",async t=>{
  const {run,count}=await fixture(t);
  assert.equal((await checkpointedRanking({...run,canStart:()=>null})).status,"paused");
  await assert.rejects(checkpointedRanking({...run,execute:async()=>{throw new Error("process_killed");}}),/process_killed/);
  assert.equal((await checkpointedRanking(run)).status,"indeterminate"); assert.equal(count(),0);
});

test("overlapping starts dispatch once, and a modified receipt is rejected",async t=>{
  const {directory,run,count}=await fixture(t);
  const starts=await Promise.allSettled([checkpointedRanking(run),checkpointedRanking(run)]);
  assert.ok(starts.some(row=>row.status==="fulfilled" && row.value.status==="executed")); assert.equal(count(),1);
  const file=path.join(directory,"C-001-01.result.json");
  const receipt=JSON.parse(await readFile(file)); receipt.result.observation.reservationIds=[];
  await writeFile(file,JSON.stringify(receipt));
  await assert.rejects(checkpointedRanking(run),/receipt_binding_mismatch/);
});

test("registration cannot open another output or change batch bounds",async t=>{
  const {directory}=await fixture(t);
  const registration=path.join(directory,"reg.json"); await writeFile(registration,"{}");
  await bindBatchOutput(registration,"a".repeat(64),directory,false);
  await bindBatchOutput(registration,"a".repeat(64),directory,true);
  await assert.rejects(bindBatchOutput(registration,"a".repeat(64),tmpdir(),true),/output_registration_mismatch/);
  await assert.rejects(bindBatchOutput(registration,"a".repeat(64),directory,false));
  validateBatchPolicy({runsPerBatch:15,maxCReservationMicros:5000000,order:"profile_then_repeat_then_arm"});
  assert.throws(()=>validateBatchPolicy({runsPerBatch:0,maxCReservationMicros:99,order:"profile_then_repeat_then_arm"}));
});
