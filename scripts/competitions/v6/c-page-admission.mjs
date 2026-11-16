import {createHash} from "node:crypto";
import {readFile,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const jsonHash=value=>sha(JSON.stringify(value));
const assert=(value,message)=>{if(!value)throw Error(message);};
async function inside(root,file) {
  assert(typeof file==="string" && !path.isAbsolute(file),"relative_admission_file_required");
  const target=await realpath(path.resolve(root,file));
  assert(target.startsWith(root+path.sep),"admission_path_outside_evidence_root");
  return target;
}
async function bound(root,ref){
  assert(ref && /^[a-f0-9]{64}$/.test(ref.sha256),"admission_evidence_hash_required");
  const file=await inside(root,ref.path),bytes=await readFile(file);
  assert(sha(bytes)===ref.sha256,"admission_evidence_changed");
  return {file,bytes};
}
export async function inspectPublicCGroup(root,ref) {
  root=await realpath(root);
  const original=await bound(root,ref),dir=path.dirname(original.file),manifest=JSON.parse(original.bytes);
  const files=new Map(manifest.files.map(row=>[row.path,row]));
  assert(files.size===manifest.files.length,"duplicate_page_evidence_file");
  const read=async name=>(await bound(dir,files.get(name))).bytes;
  const registration=JSON.parse(await read("registration.json")),summary=JSON.parse(await read("summary.json"));
  const group=registration.cRegistration;
  assert(group?.schemaVersion==="saitu.public-c-five-browser-registration.v1" && group.repeat===5 && !group.diagnosticOnly && group.privateOrSealedInputsRead===false &&
    registration.strategy==="llm" && registration.model==="deepseek-flash" && registration.reasoningEffort==="max" && registration.noRouteInterception && registration.noResponseInjection &&
    registration.profiles.length===5 && new Set(registration.profiles.map(p=>p.id)).size===5 && summary.mode==="c_five" &&
    summary.registered===5 && summary.limitsRespected && summary.runtimeSnapshotUnchanged && summary.compiledProductionPackageUnchanged && summary.authorityUnchanged,
    "five_actual_predeclared_pages_required");
  const after=JSON.parse(await read("ledger-after.json")),reservations=new Set(after.rows.filter(r=>r.run_id===after.runId && r.phase==="calibration" && r.effort==="max" && r.state!=="cancelled").map(r=>r.id));
  const pages=[], reportRequests=new Set(),orders=new Set(),ids=new Set(),allReservations=new Set(),semantics=new Set(),dicts=new Set();
  for(const profile of registration.profiles) {
    const file=profile.id+".json", reported=summary.journeys.find(journey=>journey.id===profile.id);
    assert(reported,"missing_registered_journey_status");
    if (!files.has(file)) {
      assert(reported.status!=="c_observed","missing_successful_page_evidence");
      pages.push({id:profile.id,delivered:false,fallbackReason:reported.status});continue;
    }
    const row=JSON.parse(await read(file)),report=row.initialReport;
    if(!report || !row.reportRequestId || !row.modelInvocations?.length) {
      assert(row.journeyId===profile.id && row.status!=="c_observed","missing_evidence_for_claimed_delivery");
      pages.push({id:profile.id,delivered:false,fallbackReason:row.status??"not_observed"});continue;
    }
    assert(row.journeyId===profile.id && row.nonBlank && row.noFrameworkOverlay && row.reportSha256===jsonHash(report) &&
      row.domTextSha256===sha(row.domText) && row.domText.length>0 && typeof row.reportVisibleMs==="number" && Number.isFinite(row.reportVisibleMs),
      "page_result_or_dom_not_bound");
    // Old receipts keep only the hash of the bearer token and of the original
    // HTTP bytes. Recompute the displayed report from the preserved HTTP body.
    const responses=row.responses.filter(response=>response.path==="/api/ai/competition-recommend" && response.requestId===row.reportRequestId);
    assert(responses.length===1 && responses[0].status===200 && /^[a-f0-9]{64}$/.test(row.httpResponseSha256) &&
      /^[a-f0-9]{64}$/.test(responses[0].body.decisionTokenSha256) &&
      (!row.sanitizedHttpResponseSha256 || row.sanitizedHttpResponseSha256===jsonHash(responses[0].body)) &&
      jsonHash(responses[0].body.report)===row.reportSha256,"browser_http_response_does_not_match_report");
    const screenshot=await read(row.reportScreenshot);
    assert(screenshot.length>64 && screenshot.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
      screenshot.subarray(12,16).toString()==="IHDR" && screenshot.readUInt32BE(16)>100 && screenshot.readUInt32BE(20)>100 &&
      screenshot.includes(Buffer.from("IDAT")) && screenshot.subarray(-8,-4).toString()==="IEND","valid_browser_png_required");
    assert(row.modelInvocations.length===1 && row.modelInvocations[0].requestId===row.reportRequestId,"unique_model_invocation_per_page_required");
    const inv=row.modelInvocations[0].details;
    assert(inv.promptVersion===group.expectedPromptVersion && inv.candidateCount===group.expectedCandidateCount &&
      new Date(registration.registeredAt)<=new Date(row.modelInvocations[0].time) && row.canonicalInputSemanticSha256===jsonHash(row.canonicalInputSemantics),
      "changed_page_input_or_model_policy");
    reportRequests.add(row.reportRequestId);ids.add(inv.invocationId);orders.add(inv.candidateOrderSha256);semantics.add(row.canonicalInputSemanticSha256);dicts.add(inv.factDictionarySha256);
    const dispatch=row.allRequestEvents.filter(e=>e?.type==="ai_transport_dispatch");
    assert(dispatch.length && dispatch.every(e=>e.requestId===row.reportRequestId && e.details.model==="deepseek-flash" && reservations.has(e.details.reservationId) && row.reservationIds.includes(e.details.reservationId)),"page_dispatch_ledger_mismatch");
    for(const id of row.reservationIds){assert(!allReservations.has(id)&&reservations.has(id),"reused_or_missing_page_reservation");allReservations.add(id);}
    const success=row.status==="c_observed" && !report.fallback.used && report.trace.method==="llm" && report.trace.verification==="model_reviewed" &&
      report.trace.reasoningEffort==="max" && report.recommendations.length>0 && dispatch.length>=2 && report.recommendations.some(r=>row.domText.includes(r.name));
    pages.push({id:row.journeyId,reportSha256:row.reportSha256,domTextSha256:row.domTextSha256,requestId:row.reportRequestId,
      invocationId:inv.invocationId,dispatches:dispatch.length,delivered:success,reportVisibleMs:row.reportVisibleMs,fallbackReason:report.fallback.reason});
  }
  assert(reportRequests.size===pages.filter(p=>p.invocationId).length && ids.size===reportRequests.size && orders.size===ids.size && semantics.size<=1 && dicts.size<=1,"five_distinct_shuffles_same_full_pool_required");
  return {schemaVersion:"saitu.public-five-binding-audit.v1",manifest:ref,promptVersion:group.expectedPromptVersion,
    pages,delivered:pages.filter(p=>p.delivered).length,denominator:5,sourceCandidateManifestSha256:group.sourceCandidateManifestSha256,canRequestCriticalReview:pages.filter(p=>p.delivered).length>=4,
    reservedRows:allReservations.size,independentCriticalReview:false,formalAdmission:false};
}
async function main(){
  const [file,digest,output]=process.argv.slice(2);assert(file&&digest&&output,"usage_GROUP_MANIFEST_SHA_NEW_RESULT");
  const root=process.cwd(),audit=await inspectPublicCGroup(root,{path:file,sha256:digest});await writeFile(output,JSON.stringify(audit,null,2)+"\n",{flag:"wx"});
  if(!audit.canRequestCriticalReview)process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});

// Only an independent, reviewed report may unlock a paid formal batch.
// Add a finite receipt after assessment and before final implementation freeze.
const INDEPENDENT_ADMISSIONS = Object.freeze([]);
export async function verifyPaidCAdmission(root,config){
  const evidence=config.cPageAdmission;
  assert(evidence?.group && evidence?.review,"registered_C_requires_five_pages_and_independent_critical_review");
  const group=await inspectPublicCGroup(root,evidence.group);
  assert(group.canRequestCriticalReview,"insufficient_real_C_page_deliveries");
  assert(evidence.modelSourceLock?.sha256===group.sourceCandidateManifestSha256,"C_development_source_not_bound");
  const lock=JSON.parse((await bound(root,evidence.modelSourceLock)).bytes);
  assert(lock.promptVersion===group.promptVersion && Array.isArray(lock.files) && lock.files.length &&
    lock.files.some(f=>f.path==="src/lib/competitions/v6/model.ts"),"C_prompt_or_code_lock_changed");
  for(const component of lock.files) await bound(root,component);
  const report=await bound(root,evidence.review), review=JSON.parse(report.bytes);
  const trusted=INDEPENDENT_ADMISSIONS.find(r=>r.reviewSha256===evidence.review.sha256 && r.groupManifestSha256===evidence.group.sha256);
  assert(trusted && review.schemaVersion==="saitu.independent-public-c-critical-review.v1" &&
    review.groupManifestSha256===evidence.group.sha256 && review.contextId===trusted.contextId && review.contextId!==review.implementationAuthorContextId,
    "independent_C_critical_review_not_registered");
  assert(Array.isArray(review.pages) && review.pages.length===5 && group.pages.every(p=>review.pages.some(r=>r.id===p.id &&
    r.reportSha256===p.reportSha256 && r.criticalFactErrors===0 && r.eligibilityErrors===0 && Array.isArray(r.checks) && r.checks.length)),
    "C_critical_facts_or_qualification_unresolved");
  return group;
}
