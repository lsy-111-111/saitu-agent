import {setMaxListeners} from "node:events";
/** Managed job scopes may exceed Node's diagnostic default; cleanup remains explicit. */
export function createWorkerAbortScopeV7(parent:AbortSignal){
  setMaxListeners(0,parent);
  const controller=new AbortController(),abort=()=>controller.abort();
  parent.addEventListener("abort",abort,{once:true});if(parent.aborted)controller.abort();
  return {controller,release:()=>parent.removeEventListener("abort",abort)};
}
/** Drain available persisted jobs without a fixed parallel-job ceiling.
 * Real resource pressure pauses acquisition; existing work retains its deadlines. */
export async function drainRecommendationJobsV7<T>(options:{signal:AbortSignal;ready:()=>boolean;resourcesAvailable:(inFlight:number)=>boolean;take:()=>Promise<T|null>;run:(job:T)=>Promise<void>;idle:()=>Promise<void>;onError:()=>void}){
  const running=new Set<Promise<void>>();
  while(!options.signal.aborted){
    if(options.ready()&&options.resourcesAvailable(running.size)){
      let job:T|null=null;
      try{job=await options.take();}catch{options.onError();}
      if(job!==null){
        const task=Promise.resolve().then(()=>options.run(job!)).catch(()=>options.onError());
        running.add(task);void task.finally(()=>running.delete(task));
        continue;
      }
    }
    if(options.signal.aborted)break;
    await options.idle();
  }
  await Promise.allSettled(running);
}
