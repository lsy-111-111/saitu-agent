import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceManifest} from './run-experiment.mjs';
import {canonicalHash} from './frozen-ranking-executor.mjs';
import {runtimeConfiguration} from './runtime-configuration.mjs';
import {validatePerformanceRegistration,validatePerformanceProfileReview,measureBrowserJourney,summarizePerformance} from './product-performance.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
  const args=process.argv.slice(2),options={},seen=new Set();
  for(let index=0;index<args.length;index++){
    const flag=args[index];if(seen.has(flag))throw new Error('duplicate_option');seen.add(flag);
    if(flag==='--live'||flag==='--mock-smoke')options[flag.slice(2)]=true;
    else if(['--registration','--registration-sha256','--output','--chrome'].includes(flag)){if(!args[index+1]||args[index+1].startsWith('--'))throw new Error('option_value_required');options[flag.slice(2)]=args[++index];}
    else throw new Error('unknown_option');
  }
  if(!options.registration||!options['registration-sha256']||!options.output||options.live&&options['mock-smoke'])throw new Error('registration_hash_output_and_one_mode_required');
  const bytes=await readFile(options.registration);
  if(sha(bytes)!==options['registration-sha256'])throw new Error('registration_changed');
  const registration=JSON.parse(bytes),counts=validatePerformanceRegistration(registration);
  if(registration.purpose==='formal'){
    if(!registration.profileIndependenceReviewPath||sha(await readFile(registration.profileIndependenceReviewPath))!==registration.profileIndependenceReviewSha256)throw new Error('profile_independence_review_bytes_required');
    validatePerformanceProfileReview(registration,JSON.parse(await readFile(registration.profileIndependenceReviewPath,'utf8')));
  }
  if(options['mock-smoke']&&registration.purpose!=='development')throw new Error('mock_cannot_execute_formal_measurement');
  const output=path.resolve(options.output);await mkdir(output,{recursive:false});
  const write=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  await write('registration.json',registration);
  if(!options.live&&!options['mock-smoke']){await write('not-run.json',{registeredAt:new Date().toISOString(),counts,paidCalls:0,executed:false});return;}
  const implementation=await sourceManifest(root),implementationSha256=canonicalHash(implementation);
  if(registration.purpose==='formal'&&registration.implementationSha256!==implementationSha256)throw new Error('formal_performance_source_changed_since_registration');
  await write('implementation.json',{implementationSha256,files:implementation});
  const nextEnv=(await import('@next/env')).default;nextEnv.loadEnvConfig(root,false,{info(){},error(){}});
  const env={...process.env,NODE_ENV:'production',NEXT_DIST_DIR:'.next-performance',NEXT_PUBLIC_SITE_URL:'http://127.0.0.1:3131',SESSION_STARTS_PER_IP_MINUTE:'60',SESSION_STARTS_PER_IP_DAY:'600',AI_SPEND_PHASE:'performance'};
  const snapshotLedger=async name=>{
    const child=spawn(process.execPath,['scripts/competitions/v6/export-spend-ledger.mjs','--output',path.join(output,name)],{cwd:root,env,stdio:'ignore'});
    const [code]=await once(child,'exit');if(code!==0)throw new Error('performance_ledger_snapshot_failed');
  };
  let database=null;
  if(options.live){
    if(env.AI_PROVIDER!=='deepseek'||!env.AI_API_KEY||!env.DATABASE_URL||!env.AI_SPEND_RUN_ID||env.AI_REASONING_EFFORT!=='max'||['AI_TEST_MODE','ALLOW_AI_MOCK','NEXT_PUBLIC_AI_TEST_MODE','E2E_ALLOW_EPHEMERAL_SECURITY_STATE'].some(key=>env[key]==='1'))throw new Error('real_provider_pg_shared_budget_max_and_no_mock_required');
    await snapshotLedger('ledger-before');
    const {default:pg}=await import('pg');const client=new pg.Client({connectionString:env.DATABASE_URL});await client.connect();
    try{database=(await client.query('select current_database() as database,current_setting(\'server_version\') as version')).rows[0];
      const ledger=await client.query('select count(*)::int calls,sum(coalesce(charged_micros,reserved_micros))::text accounted_micros from ai_spend_ledger where run_id=$1',[env.AI_SPEND_RUN_ID]);
      database={...database,spendRunId:env.AI_SPEND_RUN_ID,ledger:ledger.rows[0]};
    }finally{await client.end();}
  }else Object.assign(env,{AI_API_KEY:'',AI_MODEL:'mock',AI_PROVIDER:'mock',AI_TEST_MODE:'1',ALLOW_AI_MOCK:'1',NEXT_PUBLIC_AI_TEST_MODE:'1',E2E_ALLOW_EPHEMERAL_SECURITY_STATE:'1',DATABASE_URL:'',AI_CONVERSATION_SIGNING_SECRET:'synthetic-performance-smoke-signing-key-32-chars',FEATURE_AI:'1',FEATURE_COMPETITION_RECOMMENDER:'1'});
  const runtime=runtimeConfiguration(env),runtimeConfigurationSha256=canonicalHash(runtime);
  if(registration.purpose==='formal'&&registration.runtimeConfigurationSha256!==runtimeConfigurationSha256)throw new Error('formal_performance_runtime_changed_since_registration');
  await write('runtime-configuration.json',{runtimeConfigurationSha256,configuration:runtime});
  const log=await open(path.join(output,'server.log'),'wx',0o600);
  let server,browser;
  const rows=[];
  try{
    await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(3131,'127.0.0.1',()=>probe.close(resolve));});
    const build=spawn(process.execPath,['node_modules/next/dist/bin/next','build'],{cwd:root,env,stdio:['ignore',log.fd,log.fd]});
    const [code]=await once(build,'exit');if(code!==0)throw new Error('production_build_failed');
    if(canonicalHash(await sourceManifest(root))!==implementationSha256)throw new Error('source_changed_during_build');
    const buildId=(await readFile(path.join(root,'.next-performance/BUILD_ID'),'utf8')).trim();
    await mkdir(path.join(output,'build'));
    const buildFiles=[];
    for(const name of ['BUILD_ID','build-manifest.json','required-server-files.json']){
      const raw=await readFile(path.join(root,'.next-performance',name));
      await writeFile(path.join(output,'build',name),raw,{flag:'wx',mode:0o600});
      buildFiles.push({path:`build/${name}`,sourcePath:`.next-performance/${name}`,sha256:sha(raw)});
    }
    const generatedTypes=await readFile(path.join(root,'next-env.d.ts'));
    await writeFile(path.join(output,'build/next-env.d.ts'),generatedTypes,{flag:'wx',mode:0o600});
    buildFiles.push({path:'build/next-env.d.ts',sourcePath:'next-env.d.ts',sha256:sha(generatedTypes)});
    await write('generated-build-artifacts.json',{buildId,files:buildFiles});
    server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3131'],{cwd:root,env,stdio:['ignore',log.fd,log.fd]});
    await new Promise((resolve,reject)=>{
      const started=Date.now();
      // Poll readiness through actual HTTP. This warms the landing route only;
      // the first questionnaire and recommendation requests are not pre-run.
      const poll=async()=>{if(server.exitCode!==null)return reject(new Error('production_server_exited'));try{const r=await fetch('http://127.0.0.1:3131',{signal:AbortSignal.timeout(1000)});if(r.ok)return resolve();}catch{}if(Date.now()-started>30000)return reject(new Error('production_server_not_ready'));setTimeout(poll,200);};void poll();
    });
    await write('runtime.json',{mode:options.live?'real_product':'mock_engineering_smoke',node:process.version,platform:process.platform,architecture:process.arch,buildId,implementationSha256,database,provider:env.AI_PROVIDER,effort:env.AI_REASONING_EFFORT??null,strategy:env.SAITU_DECISION_STRATEGY??'rules',browserRouting:'Browser plugin not available; repository Playwright',landingReadinessProbe:true,recommendationWarmup:false});
    const {chromium}=await import('playwright');browser=await chromium.launch({headless:true,...(options.chrome?{executablePath:options.chrome}:{})});
    await mkdir(path.join(output,'screenshots'));
    for(const journey of registration.journeys){
      if(canonicalHash(await sourceManifest(root))!==implementationSha256)throw new Error('source_changed_during_measurement');
      const row=await measureBrowserJourney({browser,baseURL:'http://127.0.0.1:3131',journey,timeoutMs:registration.timeoutMs,artifactDirectory:path.join(output,'screenshots'),purpose:registration.purpose});
      row.serverRecommendationCold=rows.length===0;rows.push(row);await write(`${journey.journeyId}.json`,row);
      // Every failure is retained and the remaining registered rows still run.
    }
  }finally{
    await browser?.close();if(server&&server.exitCode===null){const exit=once(server,'exit');server.kill('SIGTERM');const force=setTimeout(()=>server.kill('SIGKILL'),10000);await exit;clearTimeout(force);}
    await log.close();
    const after=await sourceManifest(root),afterSha256=canonicalHash(after);
    const runtimeAfter=runtimeConfiguration(env),runtimeAfterSha256=canonicalHash(runtimeAfter);
    await write('implementation-after.json',{implementationSha256:afterSha256,files:after});
    await write('runtime-configuration-after.json',{runtimeConfigurationSha256:runtimeAfterSha256,configuration:runtimeAfter});
    if(options.live)try{await snapshotLedger('ledger-after');}catch{await write('ledger-after-error.json',{status:'error',reason:'performance_ledger_snapshot_failed'});process.exitCode=1;}
    await write('summary.json',{...summarizePerformance(registration,rows),implementationUnchanged:afterSha256===implementationSha256,runtimeConfigurationUnchanged:runtimeAfterSha256===runtimeConfigurationSha256,realProduct:options.live===true,paidCallsAreLedgerMeasured:true,acceptancePassed:false});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
