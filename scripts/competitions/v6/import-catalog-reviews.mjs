import {readFile,writeFile,mkdir,rename,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const checks=['factualSupport','entityScope','studentUsefulness','temporalAccuracy'];

export function mergeCatalogReviews({records,reviewedRecords=records,ledger,incoming,digest,dualReviewed}){
  const byId=new Map(records.map(record=>[record.recordId,record]));
  const reviewedByDigest=new Map(reviewedRecords.map(record=>[JSON.stringify([record.recordId,digest(record)]),record]));
  const merged=structuredClone(ledger),report=[];
  for(const {recordId,review} of incoming){
    const record=reviewedByDigest.get(JSON.stringify([recordId,review?.contentDigest]));
    if(!record||!review||!review.runId||!review.reviewerId||!review.model||review.reviewerId===record.review.authorAgentId||!Number.isFinite(Date.parse(review.reviewedAt))||Date.parse(review.reviewedAt)>Date.now()+300000||!review.contentDigest?.match(/^[a-f0-9]{64}$/)||review.method!=='independent_source_recheck'||!['approved','changes_requested'].includes(review.outcome)||!Array.isArray(review.sourceIds)||new Set(review.sourceIds).size!==review.sourceIds.length||review.sourceIds.some(id=>!record.sources.some(source=>source.id===id))||!review.evidenceArtifact||!checks.every(key=>typeof review.checks?.[key]==='boolean')||!Array.isArray(review.findings)||review.findings.some(f=>!f.id||!['critical','major','minor'].includes(f.severity)||!f.description||typeof f.resolved!=='boolean'))throw new Error(`invalid_independent_review:${recordId}`);
    if(review.outcome==='approved'&&(!checks.every(key=>review.checks[key])||review.findings.some(f=>!f.resolved)))throw new Error(`approval_has_unresolved_checks:${recordId}`);
    const existing=merged[recordId]??[];
    const duplicate=existing.find(r=>r.reviewerId===review.reviewerId&&r.runId===review.runId&&r.contentDigest===review.contentDigest);
    if(duplicate&&JSON.stringify(duplicate)!==JSON.stringify(review))throw new Error(`immutable_review_conflict:${recordId}`);
    if(!duplicate)merged[recordId]=[...existing,structuredClone(review)];
    const current=byId.get(recordId),currentDigest=current?digest(current):null;
    report.push({recordId,reviewerId:review.reviewerId,runId:review.runId,outcome:review.outcome,contentDigest:review.contentDigest,currentDigest,current:review.contentDigest===currentDigest,retired:!current,added:!duplicate});
  }
  const approved=records.filter(record=>dualReviewed({...record,review:{...record.review,aiReviews:merged[record.recordId]??record.review.aiReviews}}));
  return {ledger:merged,report,dualReviewedRecords:approved.map(r=>r.recordId),dualReviewedSeries:[...new Set(approved.map(r=>r.seriesId))],limitations:['Contract validation does not replace the independent source readings.','Dual-reviewed is not automatically L3; content validation still applies.','Stale reviews are retained but never carried to a changed digest.']};
}

async function main(){
  const args=process.argv.slice(2),options={};
  for(let index=0;index<args.length;index++){
    const flag=args[index];if(flag==='--apply'){if(options.apply)throw new Error('duplicate_option');options.apply=true;}
    else if(['--bundle','--bundle-sha256','--output'].includes(flag)){if(options[flag]||!args[index+1]||args[index+1].startsWith('--'))throw new Error('invalid_option');options[flag]=args[++index];}
    else throw new Error('unsupported_option');
  }
  if(!options['--bundle']||!options['--bundle-sha256']||!options['--output'])throw new Error('bundle_hash_new_output_required');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
  const safeRead=async file=>{if(typeof file!=='string')throw new Error('review_evidence_path_required');const resolved=await realpath(path.resolve(root,file));if(!resolved.startsWith(path.join(await realpath(root),'artifacts')+path.sep))throw new Error('outside_review_artifact_directory');return {bytes:await readFile(resolved),relative:path.relative(root,resolved)};};
  const bytes=await readFile(options['--bundle']);if(sha(bytes)!==options['--bundle-sha256'])throw new Error('review_bundle_hash_mismatch');
  const bundle=JSON.parse(bytes);if(bundle.schemaVersion!=='saitu.catalog-review-import.v1'||!Array.isArray(bundle.files)||!bundle.files.length)throw new Error('review_bundle_required');
  const incoming=[],evidence=[];
  for(const file of bundle.files){const {bytes:raw}=await safeRead(file.path);if(sha(raw)!==file.sha256)throw new Error('review_file_changed');const rows=JSON.parse(raw);if(!Array.isArray(rows))throw new Error('review_array_required');incoming.push(...rows);}
  for(const row of incoming){const {bytes:raw,relative}=await safeRead(row.review?.evidenceArtifact);if(!raw.length)throw new Error('empty_reading_evidence');evidence.push({originalPath:row.review.evidenceArtifact,path:relative,sha256:sha(raw)});row.review.evidenceArtifact=relative;}
  const {installSourceLoader}=await import('../../lib/load-typescript-source.mjs');installSourceLoader();
  const {getAuthoredDecisionCatalog}=await import('../../../src/lib/competitions/v6/catalog.ts');
  const {catalogContentDigest,hasDualAiReview}=await import('../../../src/lib/competitions/v6/catalog-review.ts');
  if(!Array.isArray(bundle.recordSnapshots)||!bundle.recordSnapshots.length)throw new Error('immutable_reviewed_record_snapshots_required');
  const reviewedRecords=[];
  for(const file of bundle.recordSnapshots){const {bytes:raw}=await safeRead(file.path);if(sha(raw)!==file.sha256)throw new Error('reviewed_snapshot_hash_mismatch');const snapshot=JSON.parse(raw);for(const row of snapshot.records){if(catalogContentDigest(row.record)!==row.contentDigest)throw new Error('reviewed_record_digest_mismatch');reviewedRecords.push(row.record);}}
  const ledgerPath=path.join(root,'src/content/competitions-v6/ai-review-ledger.json'),before=await readFile(ledgerPath);
  const result=mergeCatalogReviews({records:getAuthoredDecisionCatalog(),reviewedRecords,ledger:JSON.parse(before),incoming,digest:catalogContentDigest,dualReviewed:hasDualAiReview});
  const next=JSON.stringify(result.ledger,null,2)+'\n',output=path.resolve(options['--output']);await mkdir(output,{recursive:false});
  await writeFile(path.join(output,'ledger-before.json'),before,{flag:'wx'});
  await writeFile(path.join(output,'ledger-candidate.json'),next,{flag:'wx'});
  const receipt={schemaVersion:'saitu.catalog-review-import-receipt.v1',createdAt:new Date().toISOString(),bundleSha256:sha(bytes),previousLedgerSha256:sha(before),candidateLedgerSha256:sha(next),evidence,reviewReport:result.report,dualReviewedRecords:result.dualReviewedRecords,dualReviewedSeries:result.dualReviewedSeries,limitations:result.limitations,applied:false};
  if(options.apply){
    if(sha(await readFile(ledgerPath))!==sha(before))throw new Error('review_ledger_changed_during_import');
    const temporary=`${ledgerPath}.pending-${process.pid}`;await writeFile(temporary,next,{flag:'wx'});await rename(temporary,ledgerPath);receipt.applied=true;
  }
  await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({applied:receipt.applied,reviewRows:incoming.length,dualReviewedSeries:result.dualReviewedSeries.length,staleReviews:result.report.filter(r=>!r.current).length,receipt:path.join(output,'receipt.json')}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
