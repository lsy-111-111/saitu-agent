import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPool } from "../../../src/lib/db/pool";
import { workNextRunV7 } from "../../../src/lib/competitions/v7/worker";
import { recommendationRuntimeBindingV7 } from "../../../src/lib/competitions/v7/runtime-binding";
import { isActiveDecisionReleaseV7 as isActiveRelease,readLocalDecisionPreviewV7 } from "../../../src/lib/competitions/v7/active-release";
import { getModelCallGovernorConfigurationSnapshot,providerCapacityReadyForNewWorkV7 } from "../../../src/lib/ai/model-call-governor";
import {readExecutionMode} from "../../../src/lib/ai/execution-policy.mjs";
import {claimRunV7} from "../../../src/lib/competitions/v7/store";
import {processClaimedRunV7} from "../../../src/lib/competitions/v7/worker";
import {createWorkerAbortScopeV7,drainRecommendationJobsV7} from "../../../src/lib/competitions/v7/worker-scheduler";
import {getHeapStatistics} from "node:v8";

const stop = new AbortController(), owner = `v7-${randomUUID()}`;
for (const event of ["SIGTERM", "SIGINT"] as const) process.on(event, () => stop.abort());
const binding = recommendationRuntimeBindingV7();
const executionMode=readExecutionMode();
const concurrency = executionMode==="user-unbounded"?null:Number(process.env.SAITU_V7_WORKER_CONCURRENCY ?? 2);
if (concurrency!==null&&(!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)) throw new Error("V7_WORKER_CONCURRENCY_RANGE_1_4");
const production = process.env.NODE_ENV === "production";
const releaseDirectory = process.env.APP_RELEASE_DIR;
const healthFile = process.env.SAITU_V7_WORKER_HEALTH_FILE;
const localPreview=readLocalDecisionPreviewV7();
if(process.env.SAITU_V7_LOCAL_PREVIEW&&!localPreview)throw new Error("V7_LOCAL_PREVIEW_CONFIGURATION_INVALID");
if (production && !localPreview && (!releaseDirectory || !/^\/opt\/resume-ai\/releases\/20\d{6}T\d{6}Z$/.test(releaseDirectory))) throw new Error("V7_WORKER_RELEASE_REQUIRED");
if (production && !localPreview && healthFile !== `/var/cache/resume-ai/${path.basename(releaseDirectory!)}/decision-worker-health.json`) throw new Error("V7_WORKER_HEALTH_PATH_REQUIRED");

let databaseReady = false;
const inFlight = new Set<AbortController>();
async function heartbeat() {
  try { await getPool().query("select 1"); databaseReady = true; }
  catch { databaseReady = false; }
  const state = { schemaVersion: "saitu.worker-health.v7", owner, pid: process.pid, sourceSha256: binding, releaseDirectory: releaseDirectory ?? process.cwd(), status: stop.signal.aborted ? "stopping" : isActiveRelease() ? "active" : "paused", databaseReady, concurrency,...(executionMode==="user-unbounded"?{executionMode}:{}), inFlight: inFlight.size, governor:getModelCallGovernorConfigurationSnapshot(), updatedAt: new Date().toISOString() };
  if (healthFile) {
    const temporary = `${healthFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await rename(temporary, healthFile);
  }
}
async function healthLoop() {
  while (!stop.signal.aborted) {
    try { await heartbeat(); }
    catch { console.error(JSON.stringify({ event: "decision_worker_health_failed", owner })); }
    await delay(2_000, undefined, { signal: stop.signal }).catch(() => undefined);
  }
}
async function loop(index: number) {
  while (!stop.signal.aborted) {
    if (isActiveRelease() && databaseReady) {
      const scope=createWorkerAbortScopeV7(stop.signal),stage=scope.controller;
      inFlight.add(stage);
      // Active-slot changes prohibit later dispatches while allowing an
      // already dispatched provider response to settle its original receipt.
      try { if (await workNextRunV7(`${owner}-${index}`, stage.signal, isActiveRelease)) continue; }
      catch { console.error(JSON.stringify({ event: "decision_worker_poll_failed", owner })); }
      finally { inFlight.delete(stage);scope.release(); }
    }
    await delay(500, undefined, { signal: stop.signal }).catch(() => undefined);
  }
}
console.info(JSON.stringify({ event: "decision_worker_started", owner, sourceSha256: binding, concurrency }));
let sequence=0;
const unboundedLoop=()=>drainRecommendationJobsV7({signal:stop.signal,ready:()=>isActiveRelease()&&databaseReady&&providerCapacityReadyForNewWorkV7(),
  resourcesAvailable:count=>{const heap=getHeapStatistics(),nextJobEstimate=process.memoryUsage().heapUsed/(count+1),headroom=Math.max(nextJobEstimate,heap.heap_size_limit/10);return heap.total_available_size>headroom&&process.availableMemory()>headroom;},
  take:()=>claimRunV7(`${owner}-${++sequence}`),
  run:async claim=>{const scope=createWorkerAbortScopeV7(stop.signal),stage=scope.controller;inFlight.add(stage);
    try{await processClaimedRunV7(claim,undefined,stage.signal,isActiveRelease);}finally{inFlight.delete(stage);scope.release();}},
  idle:()=>delay(500,undefined,{signal:stop.signal}).catch(()=>undefined),onError:()=>console.error(JSON.stringify({event:"decision_worker_poll_failed",owner}))});
await Promise.all([healthLoop(),...(concurrency===null?[unboundedLoop()]:Array.from({ length: concurrency }, (_, index) => loop(index)))]);
await getPool().end();
console.info(JSON.stringify({ event: "decision_worker_stopped", owner }));
