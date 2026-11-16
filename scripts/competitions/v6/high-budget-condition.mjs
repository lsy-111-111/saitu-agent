// Read-only independent budget gate. Exact parent-approved evidence digests are
// pinned here; neither CLI paths nor a self-reported summary can grant effort.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>JSON.stringify(value);
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof Date)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const cost=rows=>rows.reduce((sum,row)=>sum+BigInt(row.charged_micros??row.reserved_micros),0n);
export const HIGH_CONDITION_INPUTS=Object.freeze({
 directory:'artifacts/c-sync-20261106/live/v619-max-five-01',
 auditSha256:'4cfa36cbbcb149d53e9e46339c3b4bfc48a66afa2c1c68a9d6cdadb2b01f2e69',
 coordinationPath:'artifacts/c-sync-20261106/coordination/max-failure-condition.json',
 coordinationSha256:'f941dd94d3bdac21613e0c2e9f372ca73deaa8c22dded9c4e6ce7a047a9d38f3',
});
export async function verifyHighBudgetCondition(client,root){
 const approved=HIGH_CONDITION_INPUTS,dir=path.join(root,approved.directory);
 const bytes=async file=>readFile(path.join(dir,file));
 const auditBytes=await bytes('audit.json'),coordBytes=await readFile(path.join(root,approved.coordinationPath));
 assert.equal(sha(auditBytes),approved.auditSha256,'approved_max_audit_changed');
 assert.equal(sha(coordBytes),approved.coordinationSha256,'approved_failure_condition_changed');
 const audit=JSON.parse(auditBytes),coord=JSON.parse(coordBytes);
 assert.equal(coord.paymentAuthorizationIssuedByThisArtifact,false);
 for(const entry of coord.evidence){assert(entry.path.startsWith(approved.directory+'/'));assert.equal(sha(await readFile(path.join(root,entry.path))),entry.sha256,'condition_evidence_changed');}
 const manifest=JSON.parse(await bytes('manifest.json'));
 for(const entry of manifest.files){assert(!path.isAbsolute(entry.path)&&!entry.path.split('/').includes('..'));assert.equal(sha(await bytes(entry.path)),entry.sha256,'raw_max_evidence_changed');}
 const registration=JSON.parse(await bytes('registration.json')),before=JSON.parse(await bytes('ledger-before.json')),after=JSON.parse(await bytes('ledger-after.json'));
 assert(registration.mode==='five'&&registration.repeat===5&&registration.effort==='max'&&registration.model==='deepseek-flash'&&registration.expectedCandidateCount===39&&registration.expectedVerifyShards===39&&registration.expectedProcessConcurrency===40,'full_max_group_registration_required');
 assert(audit.effort==='max'&&audit.fixedDenominator===5&&audit.executedPages===5&&audit.pages.length===5&&audit.distinctCandidateOrders===5&&audit.successfulPages<4&&!audit.groupPassed,'max_group_failure_required');
 assert.equal(canonical(before.authority),canonical(after.authority));assert.equal(canonical(before.budgets),canonical(after.budgets));assert.equal(canonical(before.developmentBatches),canonical(after.developmentBatches));
 const afterMap=new Map(after.rows.map(row=>[row.id,row])),beforeIds=new Set(before.rows.map(row=>row.id));
 for(const row of before.rows)assert.equal(canonical(afterMap.get(row.id)),canonical(row),'historical_snapshot_changed');
 const fresh=after.rows.filter(row=>!beforeIds.has(row.id)),freshMap=new Map(fresh.map(row=>[row.id,row]));
 assert.equal(fresh.length,200);assert.equal(String(cost(fresh)),audit.accountedMicros);
 const current=(await client.query(`select id::text,run_id,model,effort,phase,operation,price_version,reserved_micros::text,charged_micros::text,state,input_tokens::text,output_tokens::text,cached_input_tokens::text,created_at,settled_at from ai_spend_ledger where id=any($1::uuid[]) order by id`,[after.rows.map(row=>row.id)])).rows;
 assert.equal(current.length,after.rows.length,'fresh_pg_rows_missing');
 for(const row of current)assert.equal(canonical(row),canonical(afterMap.get(row.id)),'fresh_pg_row_differs_from_raw_evidence');
 const latestAuthority=(await client.query('select singleton,run_id,created_at from ai_spend_authority order by run_id')).rows;
 assert.equal(canonical(latestAuthority),canonical(after.authority),'original_authority_changed');
 for(const row of fresh){
  assert(row.run_id===registration.runId&&row.model==='deepseek-flash'&&row.effort==='max'&&row.phase==='calibration'&&row.operation==='competition_recommend'&&row.state!=='reserved','settled_max_pg_calls_required');
  if(row.state==='usage_estimated'){
   const input=BigInt(row.input_tokens),output=BigInt(row.output_tokens),cache=BigInt(row.cached_input_tokens);
   assert(input>=cache&&cache>=0n&&output>=0n);assert.equal(BigInt(row.charged_micros),((input-cache)*50n+cache+output*200n+24n)/25n);
  }else assert.equal(BigInt(row.charged_micros),row.state==='cancelled'?0n:BigInt(row.reserved_micros));
 }
 const events=(await bytes('server.log')).toString().split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
 const attributed=new Set(),orders=new Set(),semantics=new Set(),pages=[];
 for(const expected of audit.pages){
  const page=JSON.parse(await bytes(expected.id+'.json')),report=page.report;
  const requestEvents=events.filter(event=>event.requestId===page.reportRequestId),details=type=>requestEvents.filter(event=>event.type===type).map(event=>event.details);
  const dispatch=details('ai_transport_dispatch'),invocations=details('decision_model_invocation'),stages=details('decision_model_stage'),bindings=details('decision_support_binding');
  assert.equal(invocations.length,1);const invocation=invocations[0];
  assert(invocation.candidateCount===39&&report.trace.candidateCount===39&&report.trace.reasoningEffort==='max'&&report.trace.invocationId===invocation.invocationId&&report.trace.candidateOrderSha256===invocation.candidateOrderSha256,'raw_full_pool_binding_required');
  orders.add(invocation.candidateOrderSha256);
  assert.equal(page.semanticInputSha256,registration.expectedSemanticInputSha256);assert.equal(sha(stable(page.semanticInput)),page.semanticInputSha256);semantics.add(page.semanticInputSha256);
  assert.equal(page.reportSha256,sha(stable(report)));assert.equal(page.domTextSha256,sha(page.domText));assert.equal(page.sanitizedHttpResponseSha256,sha(stable(page.sanitizedHttpResponse)));assert.equal(canonical(page.sanitizedHttpResponse.report),canonical(report));
  const verification=dispatch.filter(event=>event.stage==='verify');
  assert(dispatch.length===40&&dispatch.filter(event=>event.stage==='match').length===1&&verification.length===39&&new Set(verification.map(event=>event.reviewId)).size===39,'raw_40_dispatches_required');
  for(const event of dispatch){assert(event.model==='deepseek-flash'&&event.thinkingType==='enabled'&&event.reasoningEffort==='max'&&event.attempt===1&&freshMap.has(event.reservationId)&&!attributed.has(event.reservationId),'max_dispatch_pg_binding_invalid');attributed.add(event.reservationId);}
  const starts=stages.filter(stage=>stage.status==='started'),ends=stages.filter(stage=>stage.status==='completed');
  assert(starts.length===40&&ends.length===40&&new Set(starts.map(stage=>stage.deadlineEpochMs)).size===1,'actual_stage_group_incomplete');
  assert(starts.every(stage=>ends.some(end=>end.stage===stage.stage&&end.reviewId===stage.reviewId)));
  const binding=bindings.at(-1),claims=report.recommendations.flatMap(item=>[...item.reasons,item.currentRole].map(reason=>({itemId:item.itemId,claimSha256:sha(stable({profileRevision:report.profile.revision,catalogVersion:report.catalogVersion,itemId:item.itemId,reason}))})));
  const supported=binding&&binding.bindingSha256===sha(stable(binding.bindings))&&stable(binding.selectedItemIds)===stable(report.recommendations.map(item=>item.itemId))&&binding.expectedClaims===claims.length&&binding.coveredClaims===claims.length&&binding.bindings.length===claims.length&&claims.every(claim=>binding.bindings.some(bound=>bound.itemId===claim.itemId&&bound.claimSha256===claim.claimSha256&&bound.supported===true&&verification.some(event=>event.reviewId===bound.reviewId)&&ends.some(end=>end.stage==='verify'&&end.reviewId===bound.reviewId&&end.ok&&end.completedAtEpochMs<=end.deadlineEpochMs)));
  const passed=Boolean(page.nonBlank&&page.noFrameworkOverlay&&page.console.every(entry=>!['error','pageerror'].includes(entry.type))&&report.trace.method==='llm'&&!report.fallback.used&&report.trace.verification==='model_reviewed'&&page.recommendationHttpMs>0&&page.recommendationHttpMs<=40000&&report.trace.elapsedMs<=40000&&supported);
  assert.equal(passed,expected.passed,'raw_page_result_differs_from_pinned_audit');pages.push({id:page.id,passed,requestId:page.reportRequestId,dispatches:dispatch.length,candidateOrderSha256:invocation.candidateOrderSha256});
 }
 assert.equal(orders.size,5);assert.equal(semantics.size,1);assert.equal(attributed.size,fresh.length);
 const successes=pages.filter(page=>page.passed).length;assert(successes<4);assert.equal(successes,audit.successfulPages);
 return {schemaVersion:'saitu.max-failure-budget-condition.v1',initialEffort:'max',nextPermittedEffort:'high',sourceRunId:registration.runId,sourceBatchId:registration.batchId,auditSha256:approved.auditSha256,coordinationSha256:approved.coordinationSha256,rawManifestSha256:sha(await bytes('manifest.json')),registeredPages:5,executedPages:5,successfulPages:successes,candidateCount:39,distinctCandidateOrders:orders.size,processConcurrency:40,providerHttp:fresh.length,accountedMicros:String(cost(fresh)),freshPgRowsVerified:true,freshPgRowSha256:sha(canonical(fresh)),freshReservationIds:fresh.map(row=>row.id),pages};
}
