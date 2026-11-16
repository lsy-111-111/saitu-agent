import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = path.join(root, 'artifacts/continuation-20261105/content');
const read = async p => JSON.parse(await readFile(path.join(root,p),'utf8'));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dependencies = createRequire(import.meta.resolve('vitest/package.json'));
const { createServer } = await import(dependencies.resolve('vite'));
const server = await createServer({ root, optimizeDeps: {noDiscovery:true,entries:[]},configFile:false,logLevel:'error',appType:'custom',resolve:{alias:{'@':path.join(root,'src'),'server-only':path.join(root,'tests/fixtures/server-only.ts')}},server:{middlewareMode:true,hmr:false,watch:null}});
try {
 const {getAuthoredDecisionCatalog,getCatalogSummary}=await server.ssrLoadModule('/src/lib/competitions/v6/catalog.ts');
 const {catalogContentDigest}=await server.ssrLoadModule('/src/lib/competitions/v6/catalog-review.ts');
 const records=getAuthoredDecisionCatalog();
 const a=await read('artifacts/v6/content-review/independent-a-20261105/raw-reviews.json');
 const b=(await read('artifacts/v6/content-review/independent-b-20261105/review-import-proposals.json')).reviews;
 const mapping=records.filter(r=>r.deepDive).map(record=>{
   const ar=a.find(r=>r.recordId===record.recordId),br=b.find(r=>r.recordId===record.recordId),digest=catalogContentDigest(record);
   const requiredSources=[...new Set([...record.facts.filter(f=>f.kind==='official_fact'&&['historical','verified_current'].includes(f.status)).flatMap(f=>f.sourceIds),...record.deepDive.workedExample.sourceIds])];
   const mapReview=(review,decision)=>review?{reviewerId:review.agentId,decision,contentDigest:review.contentDigest,digestMatches:review.contentDigest===digest,sourceIds:review.sourceIds,missingRequiredSourceIds:requiredSources.filter(id=>!review.sourceIds.includes(id)),actualReadingEvidence:review.actualReadingEvidence,findings:review.findings??review.reason,missingCertificationFields:['runId','model','reviewedAt','checks.factualSupport','checks.entityScope','checks.studentUsefulness','checks.temporalAccuracy','findings[].resolved'],evidenceOnly:true}:null;
   return {recordId:record.recordId,seriesId:record.seriesId,taskFamily:record.taskFamily,currentDigest:digest,requiredSources,missingForPublication:record.deepDive.missingForPublication,priorCommonApprove:ar?.decision==='approve'&&br?.verdict==='approve',sameCurrentDigestCommonApprove:ar?.decision==='approve'&&br?.verdict==='approve'&&ar.contentDigest===digest&&br.contentDigest===digest,A:mapReview(ar,ar?.decision),B:mapReview(br,br?.verdict)};
 });
 const legacyIds=[...new Set(records.filter(r=>r.migration.origin==='legacy_135').map(r=>r.seriesId))];
 const legacy=legacyIds.map(seriesId=>{
   const rows=records.filter(r=>r.seriesId===seriesId),oldSources=rows.flatMap(r=>r.sources.filter(s=>s.verificationMethod==='legacy_import'));
   const sourceMap=[...new Map(oldSources.map(s=>[s.id,s])).values()];
   return {seriesId,disposition:sourceMap.length?'unverified_inherited_claims_retained_as_pending_not_current_facts':'requires_independent_source_validation',allOriginalSourcesRechecked:false,originalSources:sourceMap.map(s=>({id:s.id,url:s.url,scope:s.scope,status:s.accessStatus,locator:s.locator})),records:rows.map(r=>({recordId:r.recordId,tier:r.contentTier,recommendationMode:r.publication.mode,originalSourceFacts:r.facts.filter(f=>f.sourceIds.some(id=>sourceMap.some(s=>s.id===id))).map(f=>({id:f.id,field:f.field,status:f.status,text:f.text})),registration:r.registration.status})),sourceRecheckComplete:false};
 });
 const coverage=await read('artifacts/continuation-20261105/content/strict-coverage-initial.json');
 const familyCoverage=[...new Set(coverage.results.map(r=>r.taskFamily))].map(taskFamily=>{
   const profiles=coverage.results.filter(r=>r.taskFamily===taskFamily),assessments=profiles.flatMap(r=>r.candidateAssessments);
   return {taskFamily,profileCount:profiles.length,strictPassed:profiles.filter(r=>r.strictCoveragePassed).length,strictRequiredSeriesPerProfile:3,candidateSeries:[...new Set(assessments.map(r=>r.seriesId))].length,eligibleAssessmentCount:assessments.filter(r=>r.eligibility==='eligible').length,unknownOrConditionalEligibilityCount:assessments.filter(r=>r.eligibility!=='eligible').length,verifiedAffordableTotalCount:assessments.filter(r=>r.personalTotalVerifiedAffordable).length,missingOrUnaffordableTotalCount:assessments.filter(r=>!r.personalTotalVerifiedAffordable).length,conditions:[...new Set(assessments.flatMap(r=>r.conditions))]};
 });
 await mkdir(output,{recursive:true});
 await writeFile(path.join(output,'review-contract-mapping.json'),JSON.stringify({generatedAt:new Date().toISOString(),authorAgentId:'/root/continue_catalog',noApprovalImported:true,summary:{...getCatalogSummary(),deepDrafts:mapping.length,priorCommonApprove:mapping.filter(r=>r.priorCommonApprove).length,sameCurrentDigestCommonApprove:mapping.filter(r=>r.sameCurrentDigestCommonApprove).length,commonApproveWithoutContentGaps:mapping.filter(r=>r.sameCurrentDigestCommonApprove&&!r.missingForPublication.length).length},mapping},null,2)+'\n');
 await writeFile(path.join(output,'legacy-135-disposition.json'),JSON.stringify({generatedAt:new Date().toISOString(),scope:'Explicit per-series inherited-claim downgrade inventory; not new source recheck or independent review',seriesCount:legacy.length,legacy},null,2)+'\n');
 await writeFile(path.join(output,'strict-coverage-blockers.json'),JSON.stringify({generatedAt:new Date().toISOString(),asOf:coverage.asOf,coverageSha256:sha(coverage),strictPassed:coverage.measuredCoverage.overall.strictPassed,profileCount:coverage.results.length,target:36,preparationExcluded:true,familyCoverage},null,2)+'\n');
 await writeFile(path.join(output,'current-records.json'),JSON.stringify({schemaVersion:'saitu.content-review-candidate.v1',records:records.map(r=>({recordId:r.recordId,contentDigest:catalogContentDigest(r),record:r}))},null,2)+'\n');
 console.log(JSON.stringify({output,legacySeries:legacy.length,deepDrafts:mapping.length,commonApprove:mapping.filter(r=>r.sameCurrentDigestCommonApprove).length,withoutContentGaps:mapping.filter(r=>r.sameCurrentDigestCommonApprove&&!r.missingForPublication.length).length,strictPassed:coverage.measuredCoverage.overall.strictPassed}));
} finally {await server.close();}
