/** Public development seeds only; records actual Flash/max extraction and shared-ledger events. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, open } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceManifest } from "./run-experiment.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const fields={
 "SEED-025":["interests","experience.modeling"],
 "SEED-028":["experience.teamOutcome","experience.personalContribution","experience.completion"],
 "SEED-031":["weeklyCommitment","budget.maximumYuan","availableResources"],
 "SEED-034":["skills.python","taskPreferences.coding"],
 "SEED-037":["stage","education.degree"],
 "SEED-040":["experience.experimentParticipation","experience.personalContribution"],
 "SEED-043":["resources.laboratory.current","resources.laboratory.future"],
 "SEED-046":["experience.competition","experience.personalTask","experience.personalContribution","experience.completion"]
};
const args=process.argv.slice(2),outputIndex=args.indexOf("--output");
if(outputIndex<0||!args[outputIndex+1]||args.some((arg,index)=>!["--live","--output"].includes(arg)&&index!==outputIndex+1))throw new Error("Usage: calibrate-profile-extraction.mjs --output NEW_DIRECTORY [--live]");
const output=path.resolve(args[outputIndex+1]);await mkdir(output,{recursive:false,mode:0o700});
const source=await readFile(path.join(root,"artifacts/v6/evaluation/public-seeds-v1.jsonl"));
const cases=source.toString("utf8").split("\n").filter(Boolean).map(JSON.parse).filter(row=>Object.hasOwn(fields,row.caseId)).map(row=>({caseId:row.caseId,familyId:row.familyId,input:{utterance:row.inputs.utterance,requestedFields:fields[row.caseId]}}));
if(cases.length!==8||new Set(cases.map(row=>row.caseId)).size!==8)throw new Error("eight_exact_public_development_cases_required");
const implementation=await sourceManifest(root),implementationSha256=sha(JSON.stringify(implementation));
const registration={schemaVersion:"saitu.public-profile-calibration.v1",registeredAt:new Date().toISOString(),sourceSha256:sha(source),implementationSha256,implementation,cases,model:"deepseek-flash",thinking:"enabled",reasoningEffort:"max",outputTokens:8192,maxCalls:8,concurrency:2,phase:"calibration",deadlineMs:45000,acceptanceEligible:false,origin:"96_public_development_seeds",liveRequested:args.includes("--live")};
await writeFile(path.join(output,"registration.json"),JSON.stringify(registration,null,2)+"\n",{flag:"wx",mode:0o600});
if(!args.includes("--live")){console.log(JSON.stringify({output,registered:8,paidCalls:0,notRun:true}));process.exit(0);}
const require=createRequire(import.meta.url);require("@next/env").loadEnvConfig(root,true,{info:()=>{},error:()=>{}},true);
if(process.env.AI_SPEND_PHASE!=="calibration"||process.env.AI_PROVIDER!=="deepseek"||!process.env.AI_API_KEY||!process.env.AI_SPEND_RUN_ID||process.env.AI_TEST_MODE==="1"||process.env.ALLOW_AI_MOCK==="1")throw new Error("actual_calibration_provider_and_existing_main_ledger_required");
const dependencies=createRequire(import.meta.resolve("vitest/package.json"));const {createServer}=await import(dependencies.resolve("vite"));
const server=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,watch:null},resolve:{alias:{"@":path.join(root,"src"),"server-only":path.join(root,"tests/fixtures/server-only.ts")}},appType:"custom",logLevel:"silent"});
try{
 const [extract,observation,ai]=await Promise.all([server.ssrLoadModule("/src/lib/competitions/v6/extract-profile.ts"),server.ssrLoadModule("/src/lib/ai/product-observation.ts"),server.ssrLoadModule("/src/lib/ai/ai-client.ts")]);
 if(ai.getConfiguredAiModel()!=="deepseek-flash"||ai.getConfiguredReasoningEffort()!=="max")throw new Error("calibration_requires_exact_flash_max");
 const results=await open(path.join(output,"observations.jsonl"),"wx",0o600);let cursor=0,completed=0;
 try{await Promise.all(Array.from({length:2},async()=>{
  for(;;){const index=cursor++;if(index>=cases.length)return;const item=cases[index],events=[],started=Date.now();let result;
   try{const actual=await observation.withProductObservation({observer:event=>events.push(event)},()=>extract.extractProfileFacts(item.input,{deadlineEpochMs:Date.now()+45000}));
    const trace=actual.trace;result={caseId:item.caseId,inputSha256:sha(JSON.stringify(item.input)),facts:actual.facts,unknownFields:actual.unknownFields,fallback:actual.fallback,error:actual.error,trace:Object.fromEntries(["ok","model","reason","durationMs","usage","attempts","upstreamAttempted","httpStatus","finishReason"].filter(key=>key in trace).map(key=>[key,trace[key]]))};
   }catch(error){result={caseId:item.caseId,error:error instanceof Error?error.message:"extraction_failed",fallback:true};}
   await results.write(JSON.stringify({...result,events,elapsedMs:Date.now()-started})+"\n");await results.sync();completed++;
   console.log(JSON.stringify({completed,total:cases.length,caseId:item.caseId,fallback:result.fallback,error:result.error}));
  }
 }));}finally{await results.close();}
 const unchanged=sha(JSON.stringify(await sourceManifest(root)))===implementationSha256;
 await writeFile(path.join(output,"summary.json"),JSON.stringify({completedAt:new Date().toISOString(),completed,sourceUnchanged:unchanged,observationsSha256:sha(await readFile(path.join(output,"observations.jsonl"))),acceptanceEligible:false,semanticStatus:"development_observations_not_independent_scoring"},null,2)+"\n",{flag:"wx"});
 if(!unchanged)throw new Error("implementation_changed_during_calibration");
}finally{await server.close();}
