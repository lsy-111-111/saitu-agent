import {describe,it,expect} from "vitest";
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import type {AcceptanceInput} from "../../../scripts/competitions/v6/acceptance-gate";
import {buildRuleDecisionReport} from "../../../src/lib/competitions/v6/engine";
import {student,syntheticRecord} from "./decision-fixtures";
import {acceptanceCanonicalHash as hash,deriveBudgetArtifact,deriveMetricArtifact,LOCKED_LEDGER_BASELINE_SHA256} from "../../../scripts/competitions/v6/acceptance-artifact-derivation";
const {runtimeConfiguration}=createRequire(import.meta.url)("../../../scripts/competitions/v6/runtime-configuration.mjs") as {runtimeConfiguration:(env:Record<string,string>)=>unknown};
const {performanceProfileSemantics}=createRequire(import.meta.url)("../../../scripts/competitions/v6/product-performance.mjs") as {performanceProfileSemantics:(profile:unknown,options?:unknown)=>unknown};
const bytesHash=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
const baselineBytes=readFileSync(path.join(process.cwd(),"tests/fixtures/spend-ledger-baseline-20261105.json"));
function environment(){
 const root=mkdtempSync(path.join(tmpdir(),"saitu-raw-prereq-"));
 const put=(name:string,value:unknown)=>{const raw=JSON.stringify(value);writeFileSync(path.join(root,name),raw);return {path:name,sha256:bytesHash(raw)};};
 const raw=(name:string,value:string|Buffer)=>{writeFileSync(path.join(root,name),value);return {path:name,sha256:bytesHash(value)};};
 const input={budget:{maximumCny:230.02,spentCny:0,reservedCny:0,unpricedCalls:0},challengeManifest:{implementationSha256:""}} as unknown as AcceptanceInput;
 return {root,put,raw,input,clean:()=>rmSync(root,{recursive:true,force:true})};
}
function ledgerFixture(reviewed=false){
 const env=environment(),snapshot=JSON.parse(baselineBytes.toString());
 expect(bytesHash(baselineBytes)).toBe(LOCKED_LEDGER_BASELINE_SHA256);
 const baseline=env.raw("baseline.json",baselineBytes);
 snapshot.observedAt="2026-11-05T18:40:00.000Z";
 const snapshotRef=env.put("snapshot.json",snapshot);
 const records=snapshot.ledger.map((row:Record<string,unknown>)=>{
   const details={reservationId:row.id,chargedMicros:Number(row.charged_micros??row.reserved_micros),reservedMicros:Number(row.reserved_micros),state:row.state,upstreamAttempted:row.state!=="cancelled",priceVersion:row.price_version,
    usage:row.state==="usage_estimated"&&row.input_tokens!==null?{inputTokens:Number(row.input_tokens),outputTokens:Number(row.output_tokens),cachedInputTokens:Number(row.cached_input_tokens)}:null};
   const unknown=["reserved","conservative"].includes(String(row.state));
   return {reservationId:row.id,runId:row.run_id,origin:row.run_id===snapshot.runId?"live_provider":"synthetic_transport",
     events:[{type:row.state==="reserved"?"ai_budget_reserved":"ai_budget_settled",details},...(row.run_id===snapshot.runId?[
       ...(row.state!=="reserved"?[{type:"ai_budget_reserved",details:{reservationId:row.id,reservedMicros:Number(row.reserved_micros),model:row.model,effort:row.effort,phase:row.phase,priceVersion:row.price_version}}]:[]),
       {type:"ai_transport_dispatch",details:{reservationId:row.id,model:row.model,operation:row.operation}}]:[])],
     ...(unknown?{requestLimits:{promptUtf8Bytes:(Number(row.reserved_micros)-8)/2-1024,systemUtf8Bytes:0,outputTokenLimit:1,priceVersion:row.price_version}}:{})};
 });
 const sources=env.put("sources.json",{schemaVersion:"saitu.ledger-source-observations.v1",records});
 const review={schemaVersion:"saitu.ledger-source-review.v1",snapshotSha256:snapshotRef.sha256,baselineSha256:baseline.sha256,sourceObservationsSha256:sources.sha256,authorContextId:"synthetic-author",
   reviews:["synthetic-A","synthetic-B"].map(contextId=>({contextId,rows:snapshot.ledger.map((row:Record<string,unknown>,index:number)=>({reservationId:row.id,ledgerRowSha256:hash(row),sourceRecordSha256:hash(records[index]),verdict:"accounted_without_exclusion"}))}))};
 const reviewRef=env.put("review.json",review);
 const envelope={schemaVersion:"saitu.acceptance-ledger-budget-evidence.v1",baseline,snapshot:snapshotRef,...reviewed?{sourceObservations:sources,sourceReview:reviewRef}:{}};
 env.input.budgetEvidence=env.put("budget-evidence.json",envelope);
 const facts=deriveBudgetArtifact(env.input,env.root);
 if(facts.derived)env.input.budget=facts.derived;
 return {...env,snapshot,envelope,records,review};
}
describe("full raw ledger safety prerequisite",()=>{
 it("preserves all 48 locked reservations and 430 other-run rows without claiming invoice or automatically exempting tests",()=>{
  const f=ledgerFixture();try{const result=deriveBudgetArtifact(f.input,f.root);
   expect(result.status).toBe("pending");expect(result.reason).toBe("ledger_source_review_required");
   expect(result.details.lockedMainRows).toBe(48);expect(result.details.otherRunRows).toBe(430);
   expect(result.details.allTableEvidenceMicros).toBe("129626940");expect(result.details.providerBudgetAccountedMicros).toBeNull();expect(result.details.unknownUsageCalls).toBe(36);
   expect(result.details.unpricedCalls).toBe(0);expect(result.details.providerInvoiceCny).toBeNull();
  }finally{f.clean();}
 });
 it("keeps caller-authored synthetic source reviews pending without an independent sealed origin registration",()=>{
  const f=ledgerFixture(true);try{const result=deriveBudgetArtifact(f.input,f.root);
   expect(result.reason).toBe("trusted_synthetic_origin_registration_required");expect(result.status).toBe("pending");
   expect(result.details.unknownUsageCalls).toBe(36);expect(result.details.unknownOriginCalls).toBe(430);expect(result.details.otherRunRows).toBe(430);
   f.input.budget.spentCny=0;expect(deriveBudgetArtifact(f.input,f.root).status).toBe("pending");
  }finally{f.clean();}
 });
 it("rejects deleting history, lowering occupied amounts, or dropping a test-named run even when hashes are recomputed",()=>{
  for(const change of ["remove_main","lower_main","remove_other"]){const f=ledgerFixture();try{
   const index=f.snapshot.ledger.findIndex((row:{run_id:string})=>(row.run_id===f.snapshot.runId)===(change!=="remove_other"));
   if(change==="lower_main")f.snapshot.ledger[index].charged_micros="0";else f.snapshot.ledger.splice(index,1);
   f.envelope.snapshot=f.put("snapshot.json",f.snapshot);f.input.budgetEvidence=f.put("budget-evidence.json",f.envelope);
   expect(deriveBudgetArtifact(f.input,f.root).reason).toBe("historical_ledger_identity_or_occupancy_removed");
  }finally{f.clean();}}
 });
 it("keeps a conservative hold pending without its recomputable raw output/input bound",()=>{
  const f=ledgerFixture(true);try{
   const index=f.records.findIndex((row:{requestLimits?:unknown})=>row.requestLimits);delete f.records[index].requestLimits;
   const source=f.put("sources.json",{schemaVersion:"saitu.ledger-source-observations.v1",records:f.records});
   f.review.sourceObservationsSha256=source.sha256;for(const reviewer of f.review.reviews)reviewer.rows[index].sourceRecordSha256=hash(f.records[index]);
   const envelope={...f.envelope,sourceObservations:source,sourceReview:f.put("review.json",f.review)};
   f.input.budgetEvidence=f.put("budget-evidence.json",envelope);
   const result=deriveBudgetArtifact(f.input,f.root);
   expect(result.status).toBe("pending");expect(Number(result.details.unverifiedConservativeBoundCalls)).toBeGreaterThan(0);
  }finally{f.clean();}
 });
});
function performanceFixture(){
 const f=environment();mkdirSync(path.join(f.root,"build"));
 f.input.selectedAlgorithm="A1";
 const source=f.raw("source.txt","synthetic source fixture only");
 const implementation={implementationSha256:hash([source]),files:[source]};
 f.input.challengeManifest.implementationSha256=implementation.implementationSha256;
 const runtimeConfig=runtimeConfiguration({NODE_ENV:"production",AI_PROVIDER:"deepseek",AI_REASONING_EFFORT:"max",AI_SPEND_PHASE:"performance",AI_SPEND_RUN_ID:"synthetic-performance-run"});
 const runtimeArtifact={configuration:runtimeConfig,runtimeConfigurationSha256:hash(runtimeConfig)};
 const journeys=Array.from({length:100},(_,index)=>{const mode=index%2?"deep":"quick";return {journeyId:`journey-${index}`,profileId:`profile-${index}`,flow:mode,viewport:index<50?"desktop":"mobile",
  profileInput:{schemaVersion:"saitu.performance-profile.v1",facts:[{field:"goal",value:`synthetic-${index}`,state:"affirmed",confirmed:true,evidenceLevel:"self_report"}],unknownFields:[],goals:["explore"],primaryGoal:"explore",tradeoffStatus:"confirmed",mode},steps:[{action:"click",selector:"button.confirm",startDecisionClock:true}]};});
 const review={schemaVersion:"saitu.performance-profile-review.v1",authorContextId:"synthetic-author",reviewerContextIds:["synthetic-A","synthetic-B"],profiles:journeys.map(j=>({profileId:j.profileId,familyId:`family-${j.profileId}`,semanticSha256:hash(performanceProfileSemantics(j.profileInput,{registered:true})),outcome:"approved"}))};
 const reviewRef=f.put("profile-review.json",review);
 const registration={schemaVersion:"saitu.browser-performance-registration.v1",purpose:"formal",latencyClock:"confirmed_submission_to_browser_report",retries:0,timeoutMs:45000,journeys,
  implementationSha256:implementation.implementationSha256,runtimeConfigurationSha256:hash(runtimeConfig),profileIndependenceReviewSha256:reviewRef.sha256};
 const template=buildRuleDecisionReport(student(),{now:new Date("2026-11-05T20:00:00Z"),records:Array.from({length:6},(_,i)=>syntheticRecord(i+1))});
 const rows=journeys.map((j,index)=>{const report={...template,profile:{...template.profile,...j.profileInput,schemaVersion:"saitu.profile.v6",facts:j.profileInput.facts.map((fact,i)=>({...fact,id:`fact-${i}`,label:"synthetic profile fact"}))}};
  const click={perf:100,at:Date.parse("2026-11-05T20:00:01Z"),registeredClick:true,trustedClick:true};return {journeyId:j.journeyId,profileId:j.profileId,profileInputSha256:hash(j.profileInput),flow:j.flow,viewport:j.viewport,status:"observed",
   startedAt:"2026-11-05T20:00:01Z",finishedAt:"2026-11-05T20:00:10Z",firstDecisionMs:1000+index,fullReportMs:2000+index,outputSha256:hash(report),actualProfileSha256:hash(performanceProfileSemantics(report.profile)),errors:[],horizontalOverflow:false,
   requests:[{path:"/api/competitions/recommend/normalize",method:"POST",at:click.at+1},{path:"/api/ai/competition-recommend",method:"POST",at:click.at+2}],responses:[{at:click.at+500,requestId:`synthetic-request-${index}`,status:200,responseVersion:"competition-recommendation.v6",report}],
   browserClock:{clock:{start:100,responseAt:600,first:1000+index,full:2000+index,expected:report,clicks:[click],boundary:{requestPath:"/api/competitions/recommend/normalize",requestAt:click.at+1,clickAt:click.at,registeredClick:true,trustedClick:true}}}};});
 const ledger={schemaVersion:"saitu.spend-ledger-snapshot.v1",transaction:"repeatable_read_read_only",runId:"synthetic-performance-run",authority:[{singleton:true,run_id:"synthetic-performance-run"}],configuration:{hardLimitCny:300,fundedLimitCny:230.02},budgets:[],ledger:[]};
 const buildId=f.raw("build/BUILD_ID","synthetic-build-id\n"),buildManifest=f.put("build/build-manifest.json",{pages:{"/":[]}}),required=f.put("build/required-server-files.json",{version:1,files:["server.js"],config:{}}),nextEnv=f.raw("build/next-env.d.ts","// synthetic fixture");
 const buildArtifacts={buildId:"synthetic-build-id",files:[{...buildId,sourcePath:".next-performance/BUILD_ID"},{...buildManifest,sourcePath:".next-performance/build-manifest.json"},{...required,sourcePath:".next-performance/required-server-files.json"},{...nextEnv,sourcePath:"next-env.d.ts"}]};
 const runtime={mode:"real_product",provider:"deepseek",effort:"max",strategy:"rules",implementationSha256:implementation.implementationSha256,recommendationWarmup:false,buildId:"synthetic-build-id",database:{database:"synthetic_pg",version:"16.0",spendRunId:"synthetic-performance-run",ledger:{calls:0,accounted_micros:null}}};
 const envelope={schemaVersion:"saitu.acceptance-browser-performance-evidence.v1",serverLog:f.raw("server.log",""),challengeManifest:f.put("challenge.json",f.input.challengeManifest),registration:f.put("registration.json",registration),profileReview:reviewRef,
  implementationBefore:f.put("implementation.json",implementation),implementationAfter:f.put("implementation-after.json",implementation),runtimeConfigurationBefore:f.put("runtime-configuration.json",runtimeArtifact),runtimeConfigurationAfter:f.put("runtime-configuration-after.json",runtimeArtifact),runtime:f.put("runtime.json",runtime),buildArtifacts:f.put("generated-build-artifacts.json",buildArtifacts),
  ledgerBefore:f.put("ledger-before.json",{...ledger,observedAt:"2026-11-05T20:00:00Z"}),ledgerAfter:f.put("ledger-after.json",{...ledger,observedAt:"2026-11-05T20:01:00Z"}),rows:rows.map((row,index)=>f.put(`journey-${index}.json`,row))};
 const evidence=f.put("performance-evidence.json",envelope);
 const metric={value:1094,denominator:100,evidenceClass:"real_product" as const,evidencePath:evidence.path,evidenceSha256:evidence.sha256};
 return {...f,envelope,rows,runtime,registration,metric,ledger};
}
describe("performance metrics are recomputed from formal raw browser evidence",()=>{
 it("derives p95 using the shared real product registration/profile/clock/response validators, never a summary scalar",()=>{
  const f=performanceFixture();try{
   expect(deriveMetricArtifact("firstScreenP95Ms",f.metric,f.input,f.root).derived?.value).toBe(1094);
   expect(deriveMetricArtifact("fullReportP95Ms",{...f.metric,value:2094},f.input,f.root).derived?.value).toBe(2094);
   expect(deriveMetricArtifact("firstScreenP95Ms",{...f.metric,value:1},f.input,f.root).reason).toBe("claimed_metric_differs_from_raw_derivation");
  }finally{f.clean();}
 });
 it("rejects mock runtime, missing raw rows and altered production build bytes",()=>{
  for(const kind of ["mock","missing","build"]){const f=performanceFixture();try{
   if(kind==="mock")f.envelope.runtime=f.put("runtime.json",{...f.runtime,mode:"mock_engineering_smoke",database:null});
   if(kind==="missing")f.envelope.rows.pop();
   if(kind==="build")writeFileSync(path.join(f.root,"build/BUILD_ID"),"different build");
   const evidence=f.put("performance-evidence.json",f.envelope);
   expect(deriveMetricArtifact("firstScreenP95Ms",{...f.metric,evidenceSha256:evidence.sha256},f.input,f.root).status).toBe("invalid");
  }finally{f.clean();}}
 });
 it("keeps timeout/failed observations in the 100-run denominator and derives null rather than inventing a finite p95",()=>{
  const f=performanceFixture();try{
   for(let index=0;index<6;index++)f.envelope.rows[index]=f.put(`journey-${index}.json`,{...f.rows[index],status:"error",firstDecisionMs:null,fullReportMs:null});
   const evidence=f.put("performance-evidence.json",f.envelope);
   const result=deriveMetricArtifact("firstScreenP95Ms",{...f.metric,value:null,evidenceSha256:evidence.sha256},f.input,f.root);
   expect(result.status).toBe("derived");expect(result.derived?.value).toBeNull();expect(result.derived?.denominator).toBe(100);
  }finally{f.clean();}
 });
 it("rejects resealed browser clocks that precede the raw HTTP response",()=>{
  for(const clock of ["monotonic","epoch"]){const f=performanceFixture();try{
   const row=f.rows[0];row.firstDecisionMs=row.browserClock.clock.first=1;row.fullReportMs=row.browserClock.clock.full=2;
   if(clock==="epoch")row.browserClock.clock.responseAt=101;
   f.envelope.rows[0]=f.put("journey-0.json",row);
   const evidence=f.put("performance-evidence.json",f.envelope);
   expect(deriveMetricArtifact("firstScreenP95Ms",{...f.metric,evidenceSha256:evidence.sha256},f.input,f.root).reason).toBe("performance_paint_precedes_response");
  }finally{f.clean();}}
 });
 it("rejects a confirmation moved after the final recommendation response even with a resealed clock",()=>{
  const f=performanceFixture();try{
   const row=f.rows[0],clock=row.browserClock.clock;
   clock.boundary.clickAt+=8000;clock.boundary.requestAt+=8000;clock.clicks[0].at+=8000;row.requests[0].at+=8000;
   row.firstDecisionMs=clock.first=1;row.fullReportMs=clock.full=2;clock.responseAt=101;
   f.envelope.rows[0]=f.put("journey-0.json",row);const evidence=f.put("performance-evidence.json",f.envelope);
   expect(deriveMetricArtifact("firstScreenP95Ms",{...f.metric,evidenceSha256:evidence.sha256},f.input,f.root).reason).toBe("performance_raw_http_timeline_invalid");
  }finally{f.clean();}
 });
 it("requires max/Flash and actual dispatch-to-ledger evidence for C, while accepting a fully bound synthetic control",()=>{
  for(const mutation of ["valid","empty_ledger","mock_low","reused_reservation","no_dispatch","unknown_hold_reduced","false_usage","valid_unknown","unknown_price"]){const f=performanceFixture();try{
   f.input.selectedAlgorithm="C";
   const config=runtimeConfiguration({NODE_ENV:"production",AI_PROVIDER:"deepseek",AI_REASONING_EFFORT:"max",AI_SPEND_PHASE:"performance",AI_SPEND_RUN_ID:"synthetic-performance-run",SAITU_DECISION_STRATEGY:"llm"});
   f.registration.runtimeConfigurationSha256=hash(config);
   f.envelope.registration=f.put("registration.json",f.registration);
   f.envelope.runtimeConfigurationBefore=f.put("runtime-configuration.json",{configuration:config,runtimeConfigurationSha256:hash(config)});
   f.envelope.runtimeConfigurationAfter=f.put("runtime-configuration-after.json",{configuration:config,runtimeConfigurationSha256:hash(config)});
   f.envelope.runtime=f.put("runtime.json",{...f.runtime,strategy:"llm"});
   const ledgerRows:Record<string,unknown>[]=[],events:Record<string,unknown>[]=[];
   for(const [index,row]of f.rows.entries()){
    const report=row.responses[0].report,at=row.requests[1].at;
    const unknown=["unknown_hold_reduced","valid_unknown","unknown_price"].includes(mutation);
    report.trace={...report.trace,method:"llm",model:mutation==="mock_low"?"mock":"deepseek-flash",reasoningEffort:mutation==="mock_low"?"low":"max",callCount:1,verification:"model_reviewed",
     inputTokens:unknown?null:mutation==="false_usage"?1_000_000_000:1,outputTokens:unknown?null:1,cachedInputTokens:unknown?null:0,
     costCny:unknown?null:mutation==="false_usage"?2000.000008:0.00001,costStatus:unknown?"unknown":"usage_upper_bound",priceVersion:mutation==="unknown_price"?"unknown-price":"deepseek-flash-cny-20261105-peak-upper-bound"};
    row.outputSha256=hash(report);
    const id=mutation==="reused_reservation"?"reservation-0":`reservation-${index}`,price=report.trace.priceVersion!;
    const state=unknown?"conservative":"usage_estimated",charge=mutation==="unknown_hold_reduced"?0:unknown?100:10;
    if(mutation!=="reused_reservation"||index===0)ledgerRows.push({id,run_id:"synthetic-performance-run",model:"deepseek-flash",effort:"max",phase:"performance",operation:"competition_recommend",price_version:price,state,input_tokens:unknown?null:"1",output_tokens:unknown?null:"1",cached_input_tokens:unknown?null:"0",reserved_micros:"100",charged_micros:String(charge),created_at:new Date(at+1).toISOString()});
    events.push(...[
     {type:"ai_budget_reserved",details:{reservationId:id,phase:"performance",model:"deepseek-flash",effort:"max",reservedMicros:100,priceVersion:price}},
     ...mutation==="no_dispatch"?[]:[{type:"ai_transport_dispatch",details:{reservationId:id,model:"deepseek-flash",operation:"competition_recommend"}}],
     {type:"ai_budget_settled",details:{reservationId:id,chargedMicros:charge,upstreamAttempted:true,state,priceVersion:price}},
    ].map(event=>({event:"competition_accounting_trace",requestId:row.responses[0].requestId,time:new Date(at+2).toISOString(),...event})));
    f.envelope.rows[index]=f.put(`journey-${index}.json`,row);
   }
   f.envelope.serverLog=f.raw("server.log",events.map(event=>JSON.stringify(event)).join("\n"));
   f.envelope.ledgerAfter=f.put("ledger-after.json",{...f.ledger,observedAt:"2026-11-05T20:01:00Z",ledger:mutation==="empty_ledger"?[]:ledgerRows});
   const evidence=f.put("performance-evidence.json",f.envelope),result=deriveMetricArtifact("firstScreenP95Ms",{...f.metric,evidenceSha256:evidence.sha256},f.input,f.root);
   expect(result.status).toBe(["valid","valid_unknown"].includes(mutation)?"derived":mutation==="unknown_price"?"pending":"invalid");
   if(mutation==="unknown_price")expect(result.reason).toBe("live_usage_price_snapshot_unrecognized");
   if(["valid","valid_unknown"].includes(mutation))expect(result.derived?.value).toBe(1094);
  }finally{f.clean();}}
 });
 it("does not certify C or B using a rules runtime, or an unexpected report method",()=>{
  for(const selectedAlgorithm of ["B","C"] as const){const f=performanceFixture();try{
   f.input.selectedAlgorithm=selectedAlgorithm;
   expect(deriveMetricArtifact("firstScreenP95Ms",f.metric,f.input,f.root).reason).toBe("performance_selected_algorithm_runtime_mismatch");
  }finally{f.clean();}}
  const f=performanceFixture();try{
   f.rows[0].responses[0].report.trace.method="llm";
   f.envelope.rows[0]=f.put("journey-0.json",f.rows[0]);const evidence=f.put("performance-evidence.json",f.envelope);
   expect(deriveMetricArtifact("firstScreenP95Ms",{...f.metric,evidenceSha256:evidence.sha256},f.input,f.root).reason).toBe("performance_selected_algorithm_report_mismatch");
  }finally{f.clean();}
 });
 it("rejects historical ledger mutation with intact IDs and recomputed artifact hashes",()=>{
  for(const mutation of ["run_id","model","charged_micros","input_tokens"]){const f=performanceFixture();try{
   const old={id:"earlier-call",run_id:"earlier-run",model:"deepseek-flash",state:"usage_estimated",reserved_micros:"100",charged_micros:"10",input_tokens:"1",output_tokens:"1",cached_input_tokens:"0"};
   const after={...old,[mutation]:mutation.endsWith("micros")||mutation.endsWith("tokens")?"0":"changed"};
   f.envelope.ledgerBefore=f.put("ledger-before.json",{...f.ledger,observedAt:"2026-11-05T20:00:00Z",ledger:[old]});
   f.envelope.ledgerAfter=f.put("ledger-after.json",{...f.ledger,observedAt:"2026-11-05T20:01:00Z",ledger:[after]});
   const evidence=f.put("performance-evidence.json",f.envelope);
   expect(deriveMetricArtifact("firstScreenP95Ms",{...f.metric,evidenceSha256:evidence.sha256},f.input,f.root).reason).toBe("performance_pg_history_changed");
  }finally{f.clean();}}
 });
 it("requires the full report contract, not a profile and method-shaped placeholder",()=>{
  const f=performanceFixture();try{
   const report=f.rows[0].responses[0].report;
   const row={...f.rows[0],responses:[{...f.rows[0].responses[0],report:{profile:report.profile,trace:report.trace,fallback:report.fallback}}]};
   f.envelope.rows[0]=f.put("journey-0.json",row);const evidence=f.put("performance-evidence.json",f.envelope);
   expect(deriveMetricArtifact("firstScreenP95Ms",{...f.metric,evidenceSha256:evidence.sha256},f.input,f.root).reason).toBe("performance_complete_report_required");
  }finally{f.clean();}
 });
});

function addSyntheticExclusionProof(f:ReturnType<typeof ledgerFixture>,ids:string[]) {
 const fixtureSource=f.raw("synthetic-transport-fixture.ts","// TEST ONLY: a local fake with outbound network denied\n");
 const testExecution=f.put("synthetic-test-execution.json",{schemaVersion:"saitu.synthetic-ledger-test-execution.v1",fixtureSourceSha256:fixtureSource.sha256,transportKind:"in_process_fake",networkPolicy:"deny_all",networkAttempts:[],outcome:"passed",reservationIds:ids});
 for(const [index,record] of f.records.entries())if(ids.includes(record.reservationId)) {
   delete record.requestLimits;
   Object.assign(record,{noUpstreamProof:{schemaVersion:"saitu.synthetic-no-upstream-proof.v1",reservationId:record.reservationId,fixtureSource,testExecution}});
   for(const review of f.review.reviews){review.rows[index].verdict="exclude_proven_synthetic_no_dispatch";review.rows[index].sourceRecordSha256=hash(record);}
 }
 const sources=f.put("sources.json",{schemaVersion:"saitu.ledger-source-observations.v1",records:f.records});f.review.sourceObservationsSha256=sources.sha256;
 const envelope={...f.envelope,sourceObservations:sources,sourceReview:f.put("review.json",f.review)};
 f.input.budgetEvidence=f.put("budget-evidence.json",envelope);
}
describe("provider budget scope preserves history while excluding only proven synthetic transport",()=>{
 it("does not let comment-only fixtures and self-authored execution JSON exclude any historical row",()=>{
  const f=ledgerFixture(true);try{
   const ids=f.snapshot.ledger.filter((row:{run_id:string})=>row.run_id!==f.snapshot.runId).map((row:{id:string})=>row.id);
   addSyntheticExclusionProof(f,ids);
   const first=deriveBudgetArtifact(f.input,f.root);expect(first.derived).not.toBeNull();f.input.budget=first.derived!;
   const result=deriveBudgetArtifact(f.input,f.root);
   expect(result.status).toBe("pending");expect(result.reason).toBe("trusted_synthetic_origin_registration_required");
   expect(result.details.rowCount).toBe(478);expect(result.details.excludedProvenSyntheticRows).toBe(0);
   expect(result.details.allTableEvidenceMicros).toBe("129626940");expect(result.details.providerBudgetAccountedMicros).toBeNull();
   expect(result.details.unknownOriginCalls).toBe(430);
  }finally{f.clean();}
 });
 it("never excludes a locked main reservation, even if a purported source review asks to",()=>{
  const f=ledgerFixture(true);try{
   const id=f.snapshot.ledger.find((row:{run_id:string})=>row.run_id===f.snapshot.runId).id;
   addSyntheticExclusionProof(f,[id]);
   expect(deriveBudgetArtifact(f.input,f.root).reason).toBe("locked_main_reservations_cannot_be_excluded");
  }finally{f.clean();}
 });
 it("does not let names/origin or two verdict strings replace the raw no-upstream proof",()=>{
  const f=ledgerFixture(true);try{
   const index=f.snapshot.ledger.findIndex((row:{run_id:string})=>row.run_id!==f.snapshot.runId);
   for(const review of f.review.reviews)review.rows[index].verdict="exclude_proven_synthetic_no_dispatch";
   f.input.budgetEvidence=f.put("budget-evidence.json",{...f.envelope,sourceReview:f.put("review.json",f.review)});
   expect(deriveBudgetArtifact(f.input,f.root).reason).toBe("trusted_synthetic_origin_registration_required");
  }finally{f.clean();}
 });
});

function rebindBudgetSources(f:ReturnType<typeof ledgerFixture>) {
 const sources=f.put("sources.json",{schemaVersion:"saitu.ledger-source-observations.v1",records:f.records});
 f.review.sourceObservationsSha256=sources.sha256;
 for(const reviewer of f.review.reviews)for(const [index,record] of f.records.entries())reviewer.rows[index].sourceRecordSha256=hash(record);
 f.input.budgetEvidence=f.put("budget-evidence.json",{...f.envelope,sourceObservations:sources,sourceReview:f.put("review.json",f.review)});
}
describe("AIR1 budget settlement and source trust regression",()=>{
 it("rejects a settlement price version that contradicts the ledger and reservation",()=>{
  const f=ledgerFixture(true);try{
   const index=f.snapshot.ledger.findIndex((row:{run_id:string;state:string})=>row.run_id===f.snapshot.runId&&row.state==="usage_estimated");
   f.records[index].events.find((event:{type:string})=>event.type==="ai_budget_settled").details.priceVersion="inconsistent-price-version";
   rebindBudgetSources(f);
   expect(deriveBudgetArtifact(f.input,f.root).reason).toBe("live_settlement_price_version_mismatch");
  }finally{f.clean();}
 });
 it("rejects an upstream=false settlement for an actual live usage row even after review hashes are refreshed",()=>{
  const f=ledgerFixture(true);try{
   const index=f.snapshot.ledger.findIndex((row:{run_id:string;state:string})=>row.run_id===f.snapshot.runId&&row.state==="usage_estimated");
   f.records[index].events.find((event:{type:string})=>event.type==="ai_budget_settled").details.upstreamAttempted=false;
   rebindBudgetSources(f);
   expect(deriveBudgetArtifact(f.input,f.root).reason).toBe("live_settlement_upstream_state_mismatch");
  }finally{f.clean();}
 });
 it("checks settlement usage and original request output caps rather than trusting recomputed outer hashes",()=>{
  const f=ledgerFixture(true);try{
   const index=f.snapshot.ledger.findIndex((row:{run_id:string;state:string})=>row.run_id===f.snapshot.runId&&row.state==="usage_estimated"),row=f.snapshot.ledger[index];
   const settled=f.records[index].events.find((event:{type:string})=>event.type==="ai_budget_settled");
   settled.details.usage.outputTokens+=1;rebindBudgetSources(f);
   expect(deriveBudgetArtifact(f.input,f.root).reason).toBe("ledger_raw_usage_mismatch");
   settled.details.usage.outputTokens-=1;
   const outputLimit=Number(row.output_tokens)-1;
   f.records[index].requestLimits={promptUtf8Bytes:(Number(row.reserved_micros)-outputLimit*8)/2-1024,systemUtf8Bytes:0,outputTokenLimit:outputLimit,priceVersion:row.price_version};
   rebindBudgetSources(f);
   expect(deriveBudgetArtifact(f.input,f.root).reason).toBe("live_usage_exceeds_request_token_limits");
  }finally{f.clean();}
 });
});
