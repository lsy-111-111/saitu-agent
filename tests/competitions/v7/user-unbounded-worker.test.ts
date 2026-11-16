import {describe,expect,it} from "vitest";
import {getEventListeners} from "node:events";
import {createWorkerAbortScopeV7,drainRecommendationJobsV7} from "@/lib/competitions/v7/worker-scheduler";
describe("resource-aware worker drain without a fixed concurrency cap",()=>{
  it("runs twenty available jobs and aborts/awaits every managed scope without listener warnings",async()=>{
    const stop=new AbortController(),warnings:Error[]=[],onWarning=(warning:Error)=>warnings.push(warning);process.on("warning",onWarning);
    let next=0,active=0,peak=0,finished=0;
    try{
      const work=drainRecommendationJobsV7({signal:stop.signal,ready:()=>true,resourcesAvailable:()=>true,take:async()=>next<20?next++:null,
        run:async()=>{const scope=createWorkerAbortScopeV7(stop.signal);active+=1;peak=Math.max(peak,active);try{await new Promise<void>(resolve=>{scope.controller.signal.addEventListener("abort",()=>resolve(),{once:true});});}finally{active-=1;finished+=1;scope.release();}},
        idle:async()=>{if(peak===20)stop.abort();await new Promise(resolve=>setTimeout(resolve,0));},onError:()=>{throw new Error("unexpected_worker_error");}});
      await work;await new Promise(resolve=>setTimeout(resolve,0));expect(peak).toBe(20);expect(finished).toBe(20);expect(active).toBe(0);expect(getEventListeners(stop.signal,"abort")).toHaveLength(0);expect(warnings.filter(value=>value.name==="MaxListenersExceededWarning")).toHaveLength(0);
    }finally{process.removeListener("warning",onWarning);stop.abort();}
  });
  it("pauses acquisition on real resource pressure and resumes without changing job deadlines",async()=>{
    const stop=new AbortController();let headroom=false,taken=0,idle=0;const jobs=[{deadline:150000}];let observed:number|undefined;
    await drainRecommendationJobsV7({signal:stop.signal,ready:()=>true,resourcesAvailable:()=>headroom,take:async()=>{taken+=1;return jobs.shift()??null;},run:async job=>{observed=job.deadline;stop.abort();},
      idle:async()=>{idle+=1;expect(taken).toBe(0);headroom=true;},onError:()=>{throw new Error("unexpected");}});
    expect(idle).toBe(1);expect(observed).toBe(150000);
  });
});
