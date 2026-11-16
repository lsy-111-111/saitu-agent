import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadRankingReuse} from './ranking-reuse.mjs';
import {sourceManifest} from './run-experiment.mjs';
import {canonicalHash,validateReusableRanking,summarizeBoundRuns} from './frozen-ranking-executor.mjs';
/** One entry point after authorized opening; pending labels/reviews never become pass. */
export function scoreEvaluationBundle(bundle,{evaluateRankings,scoreProductObservations,frozenMatrix}) {
  const product=scoreProductObservations(bundle.product);
  if(!bundle.rankingEvidence)return {schemaVersion:'saitu.combined-evaluation.v1',product,ranking:null,rankingExecution:null,status:'pending_ranking_evidence',productAcceptance:false};
  const {input,observations,freezeBinding}=bundle.rankingEvidence;
  if(!frozenMatrix)throw new Error('verified_matrix_artifact_bytes_required');
  if(canonicalHash(observations)!==canonicalHash(frozenMatrix.originalObservations)||canonicalHash(input.runs)!==canonicalHash(frozenMatrix.originalRankingInput.runs)||canonicalHash(freezeBinding)!==canonicalHash(frozenMatrix.freezeBinding))throw new Error('scoring_matrix_differs_from_frozen_artifacts');
  const identity=profile=>({profileId:profile.profileId,familyId:profile.familyId,taskGroup:profile.taskGroup,poolItemIds:profile.poolItemIds,judgments:profile.judgments.map(({itemId,seriesId})=>({itemId,seriesId}))});
  if(canonicalHash(input.profiles.map(identity))!==canonicalHash(frozenMatrix.originalRankingInput.profiles.map(identity)))throw new Error('review_changed_frozen_pool_or_family');
  if(input.purpose!=='ai_proxy_acceptance'||JSON.stringify(input.algorithms)!=='["A1","B","C"]'||input.profiles.length!==120||observations.length!==1800||input.runs.length!==1800)throw new Error('combined_scoring_requires_complete_formal_matrix');
  if(!freezeBinding?.registrationSha256||!freezeBinding.challengeManifestSha256||!freezeBinding.sourceSnapshotSha256)throw new Error('combined_scoring_formal_provenance_required');
  const allIds=new Set(observations.map(row=>row.invocationId));
  if(allIds.size!==1800)throw new Error('duplicate_matrix_invocation');
  for(const observation of observations){
    const ranking=input.runs.find(row=>row.invocationId===observation.invocationId);
    const profile=input.profiles.find(row=>row.profileId===observation.profileId);
    if(!profile||canonicalHash([...profile.poolItemIds].sort())!==observation.candidateSetSha256)throw new Error('ranking_pool_changed_since_execution');
    if(!ranking||observation.outputSha256!==canonicalHash(observation.output)||canonicalHash(observation.freezeBinding)!==canonicalHash(freezeBinding))throw new Error('matrix_output_or_freeze_binding_mismatch');
    for(const key of ['invocationId','inputSha256','outputSha256','reservationIds','freezeBinding','candidateSetSha256'])if(canonicalHash(observation[key])!==canonicalHash(ranking[key]))throw new Error('matrix_ranking_binding_mismatch');
  }
  const ranking=evaluateRankings(input),rankingExecution=summarizeBoundRuns(observations);
  const selected=bundle.selectedAlgorithm;
  if(!['A1','B','C'].includes(selected))throw new Error('selected_algorithm_required');
  for(const observation of bundle.product.observations.filter(row=>row.operation==='recommend')){
    const item=bundle.product.cases.find(row=>row.caseId===observation.caseId);
    const matrixObservation=observations.find(row=>row.invocationId===observation.invocationId);
    if(!matrixObservation||canonicalHash(observation.output)!==canonicalHash(matrixObservation.output)||observation.caseId!==matrixObservation.caseId)throw new Error('product_ranking_must_reuse_same_invocation');
    validateReusableRanking({observation,ranking:input.runs.find(row=>row.invocationId===observation.invocationId),input:item.input,algorithm:selected,repetition:observation.repetition,freezeBinding});
  }
  const combinedCases=product.cases.map(item=>{
    if(item.operation!=='recommend')return item;
    const selectedObservations=bundle.product.observations.filter(row=>row.caseId===item.caseId&&row.algorithm===selected);
    const profileId=selectedObservations[0]?.profileId;
    const row=ranking.profileResults.find(row=>row.algorithm===selected&&row.profileId===profileId);
    const ready=row?.status==='scored'&&row.annotationStatus==='ai_blind_reviewed';
    const runs=item.runs.map(run=>({...run,checks:run.checks.map(check=>check.id==='independent_full_pool_labels'&&ready?{...check,status:'passed',reason:'same_invocation_complete_independent_pool_scored'}:check)}));
    for(const run of runs)if(run.status==='pending'&&run.checks.length&&run.checks.every(check=>check.status==='passed'))run.status='passed';
    return {...item,runs,status:runs.some(run=>run.status==='failed')?'failed':runs.some(run=>run.status==='not_run')?'not_run':runs.some(run=>run.status==='pending')?'pending':'passed'};
  });
  const counts=Object.fromEntries(['passed','failed','not_run','pending'].map(status=>[status,combinedCases.filter(row=>row.status===status).length]));
  return {schemaVersion:'saitu.combined-evaluation.v1',product,ranking,rankingExecution,cases:combinedCases,counts,status:combinedCases.every(row=>row.status==='passed')?'scored_requires_acceptance_gate':'pending_or_failed',productAcceptance:false,limitations:['Aggregate thresholds and all other product gates still require acceptance-gate.ts.','Actual model runs count distinct dispatched recommendation invocations; match/verify/repair remain HTTP stages.']};
}
async function main(){
  const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
  if(!args.includes('--open')||!args.includes('--input')||!args.includes('--input-sha256')||!args.includes('--output'))throw new Error('explicit_open_input_hash_and_output_required');
  const bytes=await readFile(value('--input'));
  if(createHash('sha256').update(bytes).digest('hex')!==value('--input-sha256'))throw new Error('combined_bundle_hash_mismatch');
  const bundle=JSON.parse(bytes),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
  let frozenMatrix;
  if(bundle.rankingEvidence){
    if(!args.includes('--ranking-run')||!args.includes('--freeze-manifest-sha256'))throw new Error('explicit_frozen_matrix_bytes_required');
    const binding=bundle.rankingEvidence.freezeBinding;
    frozenMatrix=await loadRankingReuse({directory:value('--ranking-run'),freezeManifestSha256:value('--freeze-manifest-sha256'),algorithm:bundle.selectedAlgorithm,implementationSha256:canonicalHash(await sourceManifest(root)),catalogSha256:binding.catalogSha256,challengeManifestSha256:binding.challengeManifestSha256,sourceSnapshotSha256:binding.sourceSnapshotSha256,asOf:bundle.asOf,seed:bundle.seed});
  }
  const dependencies=createRequire(import.meta.resolve('vitest/package.json'));const {createServer}=await import(dependencies.resolve('vite'));
  const server=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,watch:null},appType:'custom',logLevel:'silent'});
  try{const [ranking,product]=await Promise.all([server.ssrLoadModule('/scripts/competitions/v6/evaluate-rankings.ts'),server.ssrLoadModule('/scripts/competitions/v6/score-product-observations.ts')]);
    const result=scoreEvaluationBundle(bundle,{...ranking,...product,frozenMatrix});
    await writeFile(value('--output'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
    if(result.status!=='scored_requires_acceptance_gate')process.exitCode=1;
  }finally{await server.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
