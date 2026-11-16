import { createHash } from 'node:crypto';
import { mkdir,readFile,writeFile,readdir,open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { sourceManifest as sharedSourceManifest } from './run-experiment.mjs';
import { executeFrozenRanking,canonicalHash } from './frozen-ranking-executor.mjs';
import { loadRankingReuse } from './ranking-reuse.mjs';
import { runtimeConfiguration,runtimeConfigurationHash } from './runtime-configuration.mjs';
import { withSealedExecutionArtifacts } from './sealed-execution-artifacts.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function args(values){const result={};for(let i=0;i<values.length;i++){const flag=values[i];if(['--live','--open'].includes(flag)){result[flag.slice(2)]=true;continue;}if(!['--config','--registration','--registration-sha256','--input','--output','--source-index','--source-root','--identities','--ranking-run'].includes(flag)||!values[i+1]||values[i+1].startsWith('--')||result[flag.slice(2)])throw new Error('invalid_cli_arguments');result[flag.slice(2)]=values[++i];}return result;}
async function sourceManifest(){return sharedSourceManifest(root);}
async function runtime(){const dependencies=createRequire(import.meta.resolve('vitest/package.json'));const {createServer}=await import(dependencies.resolve('vite'));const server=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,watch:null},resolve:{alias:{'@':path.join(root,'src'),'server-only':path.join(root,'tests/fixtures/server-only.ts')}},appType:'custom',logLevel:'silent'});try{return {server,adapter:await server.ssrLoadModule('/src/lib/competitions/v6/evaluation-adapter.ts'),contract:await server.ssrLoadModule('/src/lib/competitions/v6/evaluation-contracts.ts'),registry:await server.ssrLoadModule('/src/lib/competitions/v6/evaluation-source-registry.ts'),catalog:await server.ssrLoadModule('/src/lib/competitions/v6/catalog.ts')};}catch(error){await server.close();throw error;}}
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&/(?:Z|[+-]\d\d:\d\d)$/.test(value);
function validateConfig(config){if(config.schemaVersion!=='saitu.sealed-run-config.v1'||!iso(config.asOf)||!['disabled','live'].includes(config.modelMode)||!['rules','llm',...(config.rankingReuse?['hybrid']:[])].includes(config.method)||!Number.isSafeInteger(config.seed)||config.seed<0||!Number.isInteger(config.repeats)||config.repeats!==5||!/^[a-f0-9]{64}$/.test(config.inputSha256))throw new Error('invalid_preregistration_config');if(config.rankingReuse&&(!/^[a-f0-9]{64}$/.test(config.challengeManifestSha256)||!/^[a-f0-9]{64}$/.test(config.sourceSnapshotSha256)||!/^[a-f0-9]{64}$/.test(config.rankingReuse.freezeManifestSha256)||!['A1','B','C'].includes(config.rankingReuse.algorithm)||config.repeats!==5))throw new Error('invalid_ranking_reuse_registration');if(config.sources&&!/^[a-f0-9]{64}$/.test(config.sources.indexSha256))throw new Error('invalid_source_index_hash');}
function liveGate(config,options){if(config.modelMode!=='live')return;if(!options.live)throw new Error('explicit_live_flag_required');if(process.env.AI_PROVIDER!=='deepseek'||!process.env.AI_API_KEY||!process.env.DATABASE_URL||!process.env.AI_SPEND_RUN_ID||process.env.AI_SPEND_PHASE!=='formal'||!Number.isFinite(Number(process.env.AI_SPEND_FUNDED_CNY))||process.env.AI_TEST_MODE==='1'||process.env.ALLOW_AI_MOCK==='1')throw new Error('live_provider_formal_ledger_configuration_required');}
function shuffle(values,seed){const result=[...values];let state=seed>>>0;for(let i=result.length-1;i>0;i--){state=(Math.imul(state,1664525)+1013904223)>>>0;const j=state%(i+1);[result[i],result[j]]=[result[j],result[i]];}return result;}
async function durableJson(file,value){const handle=await open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}}
export async function main(argv=process.argv.slice(2)){
 const [command,...rest]=argv,options=args(rest);if(!['register','run'].includes(command)||!options.output)throw new Error('usage: register --config FILE --output FILE | run --registration FILE --registration-sha256 SHA --input FILE --output NEW_DIR --open [--live]');
 // Environment loading does not print or copy credentials. Neither mode makes a provider call until invoke.
 const {loadEnvConfig}=createRequire(import.meta.url)('@next/env');loadEnvConfig(root,true,{info:()=>{},error:()=>{}},true);
 let modules;
 try{
  if(command==='register'){
   modules=await runtime();
   const config=JSON.parse(await readFile(options.config,'utf8'));validateConfig(config);
   const capabilities=modules.adapter.evaluationCapabilities({...config,registry:config.sources?{root:'registered-at-opening',index:'index.json',indexSha256:config.sources.indexSha256}:undefined});
   const catalog=modules.catalog.getDecisionCatalog();
   const publicRuntime=runtimeConfiguration();
   const registration={schemaVersion:'saitu.sealed-run-registration.v1',registeredAt:new Date().toISOString(),adapterVersion:modules.contract.EVALUATION_ADAPTER_VERSION,config,capabilities,unsupportedCapabilities:[],chatInitialization:{stage:'undergraduate-2',confirmed:true,initialGoal:'from supplied synthetic fixture, proposed and confirmed through product'},sourceManifest:await sourceManifest(),runtimeConfiguration:publicRuntime,runtimeConfigurationSha256:canonicalHash(publicRuntime),catalogSha256:modules.contract.canonicalHash(catalog),inputOpened:false,rankLabels:'pending_independent_review'};
   await durableJson(options.output,registration);console.log(JSON.stringify({registration:options.output,sha256:sha(await readFile(options.output)),capabilities}));return;
  }
  if(!options.open||!options.registration||!options['registration-sha256']||!options.input)throw new Error('recorded_opening_arguments_required');
  const registrationBytes=await readFile(options.registration);if(sha(registrationBytes)!==options['registration-sha256'])throw new Error('registration_hash_mismatch');
  const registration=JSON.parse(registrationBytes.toString('utf8')),config=registration.config;validateConfig(config);liveGate(config,options);
  await mkdir(options.output,{recursive:false,mode:0o700});
  const execution=await withSealedExecutionArtifacts({directory:options.output,repositoryRoot:root,registration,registrationSha256:options['registration-sha256']},async()=>{
  modules=await runtime();
  const catalog=modules.catalog.getDecisionCatalog();if(modules.contract.canonicalHash(catalog)!==registration.catalogSha256)throw new Error('catalog_changed_since_preregistration');
  const rankingReuse=config.rankingReuse?await loadRankingReuse({directory:options['ranking-run'],...config.rankingReuse,implementationSha256:canonicalHash(await sourceManifest()),catalogSha256:registration.catalogSha256,challengeManifestSha256:config.challengeManifestSha256,sourceSnapshotSha256:config.sourceSnapshotSha256,asOf:config.asOf,seed:config.seed}):null;
  if(rankingReuse&&config.method!==({A1:'rules',B:'hybrid',C:'llm'}[rankingReuse.algorithm]))throw new Error('selected_algorithm_method_mismatch');
  const rankingModules={};
  if(!rankingReuse){for(const name of ['engine','model','hybrid-retrieval','validation','canonical-adapter'])rankingModules[name]=await modules.server.ssrLoadModule(`/src/lib/competitions/v6/${name}.ts`);rankingModules.productObservation=await modules.server.ssrLoadModule('/src/lib/ai/product-observation.ts');}
  await durableJson(path.join(options.output,'opening.json'),{schemaVersion:'saitu.sealed-opening.v1',openedAt:new Date().toISOString(),registrationSha256:options['registration-sha256'],expectedInputSha256:config.inputSha256,sourceIndexSha256:config.sources?.indexSha256??null,live:config.modelMode==='live',privateAnswerKeysRead:false});
  const inputBytes=await readFile(options.input);if(sha(inputBytes)!==config.inputSha256)throw new Error('input_file_sha256_mismatch');
  const cases=inputBytes.toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));const seen=new Set();
  for(const item of cases){if(item.schemaVersion!=='saitu.sealed-case.v2'||typeof item.caseId!=='string'||seen.has(item.caseId)||!modules.contract.evaluationOperations.includes(item.operation))throw new Error('invalid_or_duplicate_case_envelope');seen.add(item.caseId);}
  let registry;
  if(config.sources){if(!options['source-index']||!options['source-root'])throw new Error('frozen_source_import_arguments_required');let identities;
   if(config.sources.identitiesSha256){const bytes=await readFile(options.identities);if(sha(bytes)!==config.sources.identitiesSha256)throw new Error('source_authority_manifest_hash_mismatch');identities=JSON.parse(bytes.toString('utf8'));}
   const imported=modules.registry.importEvaluationSourceRegistry({sourceRoot:path.resolve(options['source-root']),indexFile:options['source-index'],indexSha256:config.sources.indexSha256,outputRoot:path.join(options.output,'evidence-runtime'),identities});registry=imported.location;await durableJson(path.join(options.output,'source-import.json'),imported);
  }
  const capabilities=modules.adapter.evaluationCapabilities({...config,registry});if(modules.contract.canonicalHash(capabilities)!==modules.contract.canonicalHash(registration.capabilities))throw new Error('capabilities_changed_since_preregistration');
  await durableJson(path.join(options.output,'candidate-catalog.json'),{sha256:registration.catalogSha256,records:catalog});
  const invocations=shuffle(cases.flatMap(item=>Array.from({length:item.operation==='recommend'?config.repeats:1},(_,repetition)=>({item,repetition}))),config.seed);
  await durableJson(path.join(options.output,'execution-order.json'),invocations.map(({item,repetition})=>({caseId:item.caseId,repetition,inputSha256:modules.contract.canonicalHash(item.input)})));
  const counts={observed:0,error:0,not_run:0};
  // Resolve every reused input before executing the other 680 cases. Any mismatch blocks, never pays again.
  const reused=new Map();
  if(rankingReuse){const rankingCases=cases.filter(c=>c.operation==='recommend');if(rankingCases.length!==120||cases.length!==800)throw new Error('reuse_requires_800_cases_with_120_rankings');for(const {item,repetition}of invocations.filter(i=>i.item.operation==='recommend'))reused.set(`${item.caseId}:${repetition}`,rankingReuse.get({caseId:item.caseId,repetition,input:item.input}));}
  const output=await open(path.join(options.output,'observations.jsonl'),'wx',0o600);
  try{for(const {item,repetition}of invocations){
    if(runtimeConfigurationHash()!==registration.runtimeConfigurationSha256)throw new Error('runtime_changed_during_sealed_execution');
    let result;
    if(item.operation==='recommend'&&rankingReuse)result=reused.get(`${item.caseId}:${repetition}`);
    else if(item.operation==='recommend'&&!(config.method==='llm'&&config.modelMode==='disabled')){
      const {profile,legacy}=rankingModules['canonical-adapter'].canonicalProfileInput(item.input.profile);
      const context=rankingModules.engine.buildDecisionContext(legacy,{profile,records:structuredClone(catalog),now:new Date(config.asOf)});
      const execution=await executeFrozenRanking({algorithm:config.method==='llm'?'C':'A1',profile: item.input.profile,input:item.input,context,caseId:item.caseId,profileId:profile.profileId,familyId:item.familyId,taskGroup:item.taskGroup,repetition:repetition+1,seed:config.seed,effort:'max',freezeBinding:{registrationSha256:options['registration-sha256'],catalogSha256:registration.catalogSha256,implementationSha256:canonicalHash(registration.sourceManifest),configurationSha256:canonicalHash(config)},modules:{engine:rankingModules.engine,model:rankingModules.model,hybrid:rankingModules['hybrid-retrieval'],validation:rankingModules.validation,productObservation:rankingModules.productObservation}});
      result=execution.observation;
    }else result=await modules.adapter.invokeEvaluationProduct({caseId:item.caseId,operation:item.operation,input:item.input,inputSha256:modules.contract.canonicalHash(item.input)},{...config,registry,records:catalog,requestId:`${item.caseId}-r${repetition}`});
    await output.write(JSON.stringify({...result,repetition,registrationSha256:options['registration-sha256'],...(item.operation==='recommend'&&rankingReuse?{reusedFromFreezeSha256:rankingReuse.freezeManifestSha256}: {})})+'\n');await output.sync();counts[result.status]++;console.log(JSON.stringify({completed:Object.values(counts).reduce((a,b)=>a+b,0),total:invocations.length,counts}));}}
  finally{await output.close();}
  return {completedAt:new Date().toISOString(),counts,caseCount:cases.length,invocationCount:invocations.length,inputSha256:config.inputSha256,runtimeConfigurationSha256:registration.runtimeConfigurationSha256,observationsSha256:sha(await readFile(path.join(options.output,'observations.jsonl'))),reusedRankingInvocations:rankingReuse?600:0,newRankingInvocations:rankingReuse?0:cases.filter(c=>c.operation==='recommend').length*config.repeats,verdict:'not_scored',rankingEvaluation:'pending_independent_review'};
  });
  await durableJson(path.join(options.output,'execution-summary.json'),{...execution.value,implementationUnchanged:execution.integrity.implementationUnchanged,runtimeConfigurationUnchanged:execution.integrity.runtimeConfigurationUnchanged});
 }finally{await modules?.server.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({error:error instanceof Error?error.message:'runner_failed'}));process.exitCode=1;});
