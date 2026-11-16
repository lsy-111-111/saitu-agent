import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {canonicalHash,validateReusableRanking,summarizeBoundRuns,deriveRunSeed,seededShuffle} from './frozen-ranking-executor.mjs';
import {validateFormalProfiles} from './experiment-registration.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Check every arm before selecting one. A count of 1800 alone cannot prove 120 x 5 x 3. */
export function validateFrozenMatrix({profileSnapshot,rankings,observations,binding,seed}) {
  validateFormalProfiles(profileSnapshot);
  if(rankings.purpose!=='ai_proxy_acceptance'||rankings.expectedRunsPerProfile!==5||rankings.profiles.length!==120||rankings.runs.length!==1800||observations.length!==1800||JSON.stringify(rankings.algorithms)!=='["A1","B","C"]')throw new Error('ranking_reuse_requires_formal_matrix');
  const profiles=new Map(profileSnapshot.profiles.map(row=>[row.profileId,row]));
  const pools=new Map(rankings.profiles.map(row=>[row.profileId,row]));
  const rows=new Map(rankings.runs.map(row=>[row.invocationId,row]));
  if(profiles.size!==120||pools.size!==120||rows.size!==1800)throw new Error('duplicate_formal_matrix_identity');
  for(const [id,profile] of profiles){
    const pool=pools.get(id);
    if(!pool||pool.familyId!==profile.familyId||pool.taskGroup!==profile.taskGroup||new Set(pool.poolItemIds).size!==pool.poolItemIds.length||canonicalHash([...pool.judgments.map(j=>j.itemId)].sort())!==canonicalHash([...pool.poolItemIds].sort()))throw new Error('formal_matrix_pool_identity_mismatch');
  }
  const keys=new Set(),invocations=new Set();
  for(const observation of observations){
    const profile=profiles.get(observation.profileId),pool=pools.get(observation.profileId),ranking=rows.get(observation.invocationId);
    if(!profile||!ranking||!['A1','B','C'].includes(observation.algorithm)||!Number.isInteger(observation.repetition)||observation.repetition<0||observation.repetition>4||observation.caseId!==profile.caseId)throw new Error('formal_matrix_case_or_repetition_mismatch');
    const key=JSON.stringify([observation.profileId,observation.algorithm,observation.repetition]);
    if(keys.has(key)||invocations.has(observation.invocationId))throw new Error('duplicate_formal_matrix_run');
    keys.add(key);invocations.add(observation.invocationId);
    validateReusableRanking({observation,ranking,input:profile.input,algorithm:observation.algorithm,repetition:observation.repetition,freezeBinding:binding});
    if(canonicalHash([...pool.poolItemIds].sort())!==observation.candidateSetSha256)throw new Error('formal_matrix_candidate_set_mismatch');
    const poolEvents=observation.events.filter(event=>event.type==='candidate_pool_frozen');
    const shuffleSeed=deriveRunSeed(seed,profile.profileId,observation.repetition+1);
    if(poolEvents.length!==1||poolEvents[0].details.shuffleSeed!==shuffleSeed||poolEvents[0].details.skipIndependentRecall!==true||canonicalHash(poolEvents[0].details.candidateOrder)!==canonicalHash(seededShuffle(pool.poolItemIds,shuffleSeed)))throw new Error('formal_matrix_candidate_order_mismatch');
  }
  summarizeBoundRuns(observations);
  return {profiles:120,repetitions:5,algorithms:3,reports:keys.size};
}
/** Verify the frozen artifact bytes, then expose an exact lookup. Missing records never trigger a new call. */
export async function loadRankingReuse({directory,freezeManifestSha256,algorithm,implementationSha256,catalogSha256,challengeManifestSha256,sourceSnapshotSha256,asOf,seed}) {
  if(!directory||!['A1','B','C'].includes(algorithm))throw new Error('ranking_reuse_location_and_algorithm_required');
  const bytes=await readFile(path.join(directory,'freeze-manifest.json'));
  if(sha(bytes)!==freezeManifestSha256)throw new Error('ranking_reuse_freeze_hash_mismatch');
  const manifest=JSON.parse(bytes),binding=manifest.freezeBinding;
  if(manifest.schemaVersion!=='saitu.experiment-freeze.v1'||!binding?.registrationSha256||!binding.challengeManifestSha256||!binding.sourceSnapshotSha256||binding.implementationSha256!==implementationSha256||binding.catalogSha256!==catalogSha256||binding.challengeManifestSha256!==challengeManifestSha256||binding.sourceSnapshotSha256!==sourceSnapshotSha256)throw new Error('ranking_reuse_requires_same_formal_implementation_catalog');
  const entries=manifest.files;
  if(!Array.isArray(entries)||new Set(entries.map(f=>f.path)).size!==entries.length)throw new Error('invalid_reuse_manifest');
  const verified=new Map();
  for(const file of entries){if(path.isAbsolute(file.path)||file.path.split(/[\\/]/).includes('..'))throw new Error('unsafe_reuse_artifact_path');const data=await readFile(path.join(directory,file.path));if(sha(data)!==file.sha256)throw new Error('ranking_reuse_artifact_hash_mismatch');verified.set(file.path,data);}
  for(const name of ['product-observations.json','ranking-input.json','profiles-snapshot.json','experiment.json','runtime-configuration.json','registration.json'])if(!verified.has(name))throw new Error('ranking_reuse_missing_bound_artifact');
  const profileSnapshot=JSON.parse(verified.get('profiles-snapshot.json')),experiment=JSON.parse(verified.get('experiment.json'));
  const runtime=JSON.parse(verified.get('runtime-configuration.json')),registration=JSON.parse(verified.get('registration.json'));
  if(runtime.sha256!==canonicalHash(runtime.configuration)||runtime.sha256!==binding.runtimeConfigurationSha256||registration.runtimeConfigurationSha256!==runtime.sha256)throw new Error('ranking_reuse_runtime_configuration_mismatch');
  if(profileSnapshot.asOf!==asOf||experiment.seed!==seed||experiment.reasoningEffort!=='max'||experiment.candidatePolicy!=='full'||experiment.implementationUnchanged!==true||experiment.runtimeConfigurationUnchanged!==true)throw new Error('ranking_reuse_configuration_or_implementation_mismatch');
  const observations=JSON.parse(verified.get('product-observations.json')),rankings=JSON.parse(verified.get('ranking-input.json'));
  if(rankings.purpose!=='ai_proxy_acceptance'||rankings.expectedRunsPerProfile!==5||rankings.profiles.length!==120||rankings.runs.length!==1800||observations.observations.length!==1800||JSON.stringify(rankings.algorithms)!=='["A1","B","C"]'||canonicalHash(observations.freezeBinding)!==canonicalHash(binding))throw new Error('ranking_reuse_requires_formal_matrix');
  validateFrozenMatrix({profileSnapshot,rankings,observations:observations.observations,binding,seed});
  const selected=observations.observations.filter(o=>o.algorithm===algorithm),rankingRows=rankings.runs.filter(r=>r.algorithm===algorithm);
  if(selected.length!==600||rankingRows.length!==600)throw new Error('ranking_reuse_requires_all_600_runs');
  const byKey=new Map(),ids=new Set();
  for(const observation of selected){const key=JSON.stringify([observation.caseId,observation.repetition]);if(byKey.has(key)||ids.has(observation.invocationId))throw new Error('duplicate_ranking_reuse_invocation');ids.add(observation.invocationId);const ranking=rankingRows.find(r=>r.invocationId===observation.invocationId);if(!ranking)throw new Error('missing_bound_ranking');byKey.set(key,{observation,ranking});}
  return {profileSnapshot,registration,originalRankingInput:rankings,originalObservations:observations.observations,freezeBinding:binding,freezeManifestSha256,algorithm,size:byKey.size,get({caseId,repetition,input}){const entry=byKey.get(JSON.stringify([caseId,repetition]));if(!entry)throw new Error('ranking_reuse_missing_case_no_regeneration');return validateReusableRanking({...entry,input,algorithm,repetition,freezeBinding:binding});}};
}
