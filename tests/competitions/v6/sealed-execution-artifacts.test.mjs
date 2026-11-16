import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {sourceManifest} from '../../../scripts/competitions/v6/run-experiment.mjs';
import {canonicalHash} from '../../../scripts/competitions/v6/frozen-ranking-executor.mjs';
import {runtimeConfiguration} from '../../../scripts/competitions/v6/runtime-configuration.mjs';
import {withSealedExecutionArtifacts} from '../../../scripts/competitions/v6/sealed-execution-artifacts.mjs';

async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),'saitu-synthetic-sealed-capture-'));
 for(const dir of ['src','db','scripts','ops','public','output'])await mkdir(path.join(root,dir));
 const file=path.join(root,'src','synthetic.ts');await writeFile(file,'export const synthetic = 1;\n');
 const runtime=runtimeConfiguration();
 const registration={sourceManifest:await sourceManifest(root),runtimeConfiguration:runtime,runtimeConfigurationSha256:canonicalHash(runtime),config:{fixture:'no model calls'}};
 const args={directory:path.join(root,'output'),repositoryRoot:root,registration,registrationSha256:canonicalHash(registration)};
 const json=async name=>JSON.parse(await readFile(path.join(args.directory,name),'utf8'));
 return {root,file,args,json,close:()=>rm(root,{recursive:true,force:true})};
}
test('captures actual before/after bytes and only whitelisted public runtime controls',async()=>{
 const original={AI_API_KEY:process.env.AI_API_KEY,DATABASE_URL:process.env.DATABASE_URL,ARBITRARY_TEST_SECRET:process.env.ARBITRARY_TEST_SECRET};
 const secret='SYNTHETIC_SECRET_NEVER_SERIALIZE';
 Object.assign(process.env,{AI_API_KEY:secret,DATABASE_URL:`postgres://test:${secret}@localhost/test`,ARBITRARY_TEST_SECRET:secret});
 const f=await fixture();
 try{
  const result=await withSealedExecutionArtifacts(f.args,async()=>({syntheticCompleted:true}));
  assert.equal(result.integrity.status,'completed');
  assert.equal(result.integrity.implementationUnchanged,true);assert.equal(result.integrity.runtimeConfigurationUnchanged,true);
  assert.deepEqual((await f.json('implementation-before.json')).files,await sourceManifest(f.root));
  assert.deepEqual(await f.json('runtime-before.json'),await f.json('runtime-after.json'));
  for(const name of ['runtime-before.json','runtime-after.json','execution-integrity.json'])assert.equal((await readFile(path.join(f.args.directory,name),'utf8')).includes(secret),false);
 }finally{await f.close();for(const [key,value]of Object.entries(original))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
test('a thrown execution preserves after snapshots, partial raw observations and a sanitized failure original',async()=>{
 const f=await fixture();try{
  await assert.rejects(withSealedExecutionArtifacts(f.args,async()=>{await writeFile(path.join(f.args.directory,'observations.jsonl'),'synthetic partial observation\n');throw new Error('SYNTHETIC_PRIVATE_ERROR');}));
  assert.equal((await f.json('execution-integrity.json')).status,'failed');
  assert.ok((await f.json('implementation-after.json')).files.length);
  assert.ok((await f.json('runtime-after.json')).configuration);
  assert.equal((await readFile(path.join(f.args.directory,'execution-failure.json'),'utf8')).includes('SYNTHETIC_PRIVATE_ERROR'),false);
  assert.equal(await readFile(path.join(f.args.directory,'observations.jsonl'),'utf8'),'synthetic partial observation\n');
 }finally{await f.close();}
});
for(const thrownValue of [null,undefined,0,false,'','SYNTHETIC_PRIVATE_THROWN_STRING'])test(`preserves failure evidence for thrown ${String(thrownValue)}`,async()=>{
 const f=await fixture();try{
  let caught=false;
  try{await withSealedExecutionArtifacts(f.args,async()=>{throw thrownValue;});}
  catch(error){caught=true;assert.strictEqual(error,thrownValue);}
  assert.equal(caught,true);
  const integrity=await f.json('execution-integrity.json');
  assert.equal(integrity.status,'failed');assert.ok(integrity.failureArtifact);
  assert.ok((await f.json('implementation-after.json')).files.length);
  assert.ok((await f.json('runtime-after.json')).configuration);
  const failure=await f.json('execution-failure.json');
  assert.deepEqual(Object.keys(failure).sort(),['code','recordedAt','schemaVersion']);
  assert.equal(failure.code,'execution_or_integrity_failed');
  for(const name of ['execution-integrity.json','execution-failure.json'])assert.equal((await readFile(path.join(f.args.directory,name),'utf8')).includes('SYNTHETIC_PRIVATE_THROWN_STRING'),false);
 }finally{await f.close();}
});
test('actual implementation drift is recorded and cannot complete formally',async()=>{
 const f=await fixture();try{
  await assert.rejects(withSealedExecutionArtifacts(f.args,()=>writeFile(f.file,'export const synthetic = 2;\n')),/frozen_implementation_or_runtime_changed/);
  const record=await f.json('execution-integrity.json');assert.equal(record.status,'failed');assert.equal(record.implementationUnchanged,false);
  assert.notEqual((await f.json('implementation-before.json')).implementationSha256,(await f.json('implementation-after.json')).implementationSha256);
 }finally{await f.close();}
});
test('actual public-runtime drift is recorded and cannot complete formally',async()=>{
 const original=process.env.AI_TIMEOUT_MS,f=await fixture();try{
  await assert.rejects(withSealedExecutionArtifacts(f.args,async()=>{process.env.AI_TIMEOUT_MS='123456';}),/frozen_implementation_or_runtime_changed/);
  assert.equal((await f.json('execution-integrity.json')).runtimeConfigurationUnchanged,false);
  assert.equal((await f.json('runtime-after.json')).configuration.values.AI_TIMEOUT_MS,'123456');
 }finally{if(original===undefined)delete process.env.AI_TIMEOUT_MS;else process.env.AI_TIMEOUT_MS=original;await f.close();}
});
test('a credential-bearing after URL records failure without recording the URL or credentials',async()=>{
 const original=process.env.AI_API_URL,f=await fixture();try{
  await assert.rejects(withSealedExecutionArtifacts(f.args,async()=>{process.env.AI_API_URL='https://synthetic-user:SYNTHETIC_PASSWORD@example.test/api';}));
  assert.equal((await f.json('execution-integrity.json')).status,'failed');
  assert.equal((await f.json('runtime-after-error.json')).code,'public_runtime_snapshot_capture_failed');
  const text=await readFile(path.join(f.args.directory,'runtime-after-error.json'),'utf8');assert.equal(text.includes('SYNTHETIC_PASSWORD'),false);
  assert.ok((await f.json('implementation-after.json')).files.length);
 }finally{if(original===undefined)delete process.env.AI_API_URL;else process.env.AI_API_URL=original;await f.close();}
});
test('preregistered source drift blocks work while still retaining before/after failure evidence',async()=>{
 const f=await fixture();let invoked=false;try{
  await writeFile(f.file,'export const changedBeforeOpening = true;\n');
  await assert.rejects(withSealedExecutionArtifacts(f.args,async()=>{invoked=true;}),/source_changed_since_preregistration/);
  assert.equal(invoked,false);assert.equal((await f.json('execution-integrity.json')).status,'failed');
  assert.ok((await f.json('implementation-before.json')).files.length);assert.ok((await f.json('implementation-after.json')).files.length);
 }finally{await f.close();}
});
test('the actual sealed runner retains failure snapshots when public input bytes do not match preregistration, without invoking a case',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'saitu-public-runner-failure-'));
 try{
  const runner=path.join(process.cwd(),'scripts/competitions/v6/run-sealed-product.mjs');
  const config=path.join(root,'config.json'),registration=path.join(root,'registration.json'),input=path.join(root,'public-input.jsonl'),output=path.join(root,'output');
  await writeFile(config,JSON.stringify({schemaVersion:'saitu.sealed-run-config.v1',asOf:'2026-11-05T12:00:00.000Z',seed:6141,repeats:5,method:'rules',modelMode:'disabled',inputSha256:'0'.repeat(64)}));
  await writeFile(input,'{"synthetic":"deliberately mismatched bytes; no case can be invoked"}\n');
  const registered=spawnSync(process.execPath,[runner,'register','--config',config,'--output',registration],{encoding:'utf8',timeout:30_000});
  assert.equal(registered.status,0,registered.stderr);
  const registeredOutput=JSON.parse(registered.stdout.trim().split('\n').at(-1));
  const run=spawnSync(process.execPath,[runner,'run','--registration',registration,'--registration-sha256',registeredOutput.sha256,'--input',input,'--output',output,'--open'],{encoding:'utf8',timeout:30_000});
  assert.equal(run.status,1,run.stderr);
  const integrity=JSON.parse(await readFile(path.join(output,'execution-integrity.json'),'utf8'));
  assert.equal(integrity.status,'failed');assert.ok(integrity.failureArtifact);
  for(const name of ['implementation-before.json','implementation-after.json','runtime-before.json','runtime-after.json','execution-failure.json'])await readFile(path.join(output,name));
  await assert.rejects(readFile(path.join(output,'observations.jsonl')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
