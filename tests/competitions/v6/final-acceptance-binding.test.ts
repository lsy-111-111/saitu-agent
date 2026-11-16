import {afterEach,describe,expect,it} from 'vitest';
import {appendFileSync,cpSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {finalBindingFixture} from './final-acceptance-binding.fixture';
const {treeInventory,verifyTree,identityHash,candidateInventory}=createRequire(import.meta.url)('../../../scripts/competitions/v6/final-acceptance-binding.mjs');
const roots:string[]=[];
const launchCounts=new WeakMap<object,number>();
function fixture(){const root=realpathSync(mkdtempSync(path.join(tmpdir(),'saitu-final-binding-synthetic-')));roots.push(root);return finalBindingFixture(root);}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function launch(f:ReturnType<typeof fixture>,extra:string[]=[],env:Record<string,string>={}){
 // Actual controller prelaunch operation: independent saved inventory compared
 // BEFORE launching native Node. No hash arrives via product input/env flags.
 const approvedK=f.controllerApproval;verifyTree(f.dirs.controller,approvedK);
 const count=(launchCounts.get(f)??0)+1;launchCounts.set(f,count);
 const output=path.join(f.dirs.output,count===1?'result.json':`result-${count}.json`);
 const run=spawnSync(process.execPath,[f.entry,'--record',f.recordPath,'--candidate',f.dirs.candidate,'--evidence',f.dirs.evidence,'--reviews',f.dirs.reviews,'--verifier',f.dirs.verifier,'--output',output,...extra],{env:{NODE_ENV:'production',...env},encoding:'utf8',timeout:30_000});
 verifyTree(f.dirs.controller,approvedK);
 let result;try{result=JSON.parse(readFileSync(output,'utf8'));}catch{result=null;}
 if(result===null&&extra.length===0)throw new Error(JSON.stringify({nativeStatus:run.status,signal:run.signal,error:run.error?.message,stderr:run.stderr,stdout:run.stdout}));
 return {run,result,approvedK};
}
describe('independent final K binding (synthetic pins are isolated copies, never real registration)',()=>{
 it('runs the real V gate with C != V, native loader closure and honest pending product gates',()=>{
  const f=fixture(),before=candidateInventory(f.dirs.candidate),{run,result,approvedK}=launch(f);
  expect(run.status,run.stderr).toBe(1);expect(result.reason).toBe('product_gates_not_passed');
  expect(result.bindingValidated).toBe(true);expect(result.productAcceptancePassed).toBe(false);
  expect(result.identities.candidateSha256).not.toBe(result.identities.verifierSha256);
  expect(result.controllerSha256).toBe(identityHash(approvedK));
  expect(result.productResult.executionDerivation.rawValidated).toBe(true);
  expect(result.productResult.executionDerivation.reason).toBe('independent_ai_review_registration_required');
  expect(result.loadedVerifierFiles.some((row:{path:string})=>row.path.startsWith('node_modules/zod/'))).toBe(true);
  expect(candidateInventory(f.dirs.candidate)).toEqual(before);
  expect(result).not.toHaveProperty('releaseCandidateApproved');
  expect(result.verifierPackageMetadataFiles.map((row:{path:string})=>row.path)).toEqual(['node_modules/zod/package.json','package.json']);
  const artifacts=path.join(process.cwd(),'artifacts/continuation-20261105/final-acceptance-binding-03');mkdirSync(artifacts,{recursive:true});
  const saved=mkdtempSync(path.join(artifacts,'synthetic-native-probe-'));cpSync(path.dirname(f.recordPath),saved,{recursive:true});
  writeFileSync(path.join(saved,'SYNTHETIC-NOT-AN-APPROVAL.txt'),'Public synthetic fixture and TEST-ONLY pinned K. Never register as formal evidence.\n');
  writeFileSync(path.join(saved,'controller-launch-manifest.json'),JSON.stringify({files:approvedK,sha256:identityHash(approvedK)},null,2));
 });
 it('keeps the production empty pin table pending even for self-described approved reports',()=>{
  const f=fixture();f.refresh(false);const {result}=launch(f);
  expect(result.reason).toBe('controller_independent_registration_required');expect(result.bindingValidated).toBe(false);
 });
 it.each(['candidate','evidence','reviews','verifier'])('rejects changed %s bytes after controller registration',which=>{
  const f=fixture(),files=treeInventory(f.dirs[which]);appendFileSync(path.join(f.dirs[which],files[0].path),'\nchanged');
  const {result}=launch(f);expect(result.status).toBe('invalid');expect(result.productAcceptancePassed).toBe(false);
 });
 it('rejects an added acceptance script in C and does not exclude tools from identity',()=>{
  const f=fixture();writeFileSync(path.join(f.dirs.candidate,'scripts/competitions/v6/new-acceptance.mjs'),'// change');
  expect(launch(f).result.reason).toBe('final_candidate_differs_from_execution');
 });
 it('rejects updated E/V hashes supplied in a self-approved control record',()=>{
  const f=fixture();const record=JSON.parse(readFileSync(f.recordPath,'utf8'));record.verifierFiles[0].sha256='0'.repeat(64);writeFileSync(f.recordPath,JSON.stringify(record));
  expect(launch(f).result.reason).toBe('controller_independent_registration_required');
 });
 it('rejects unknown files and symbolic links in the frozen verifier',()=>{
  const f=fixture();symlinkSync(path.join(f.dirs.evidence,'acceptance.json'),path.join(f.dirs.verifier,'escape.json'));
  expect(launch(f).result.reason).toBe('symlink_identity_path');
 });
 it('rejects an unknown ordinary V member even if not imported',()=>{
  const f=fixture();writeFileSync(path.join(f.dirs.verifier,'unexpected.json'),'{}');
  expect(launch(f).result.reason).toBe('frozen_tree_changed');
 });
 it.each(['catalog-snapshot.json','runtime-configuration.json','synthetic-build-original.json','synthetic-ledger.json'])('rejects changed %s against the control record',member=>{
  const f=fixture();appendFileSync(path.join(f.dirs.evidence,member),' ');
  expect(launch(f).result.reason).toBe('frozen_tree_changed');
 });
 it('requires the actual startup K bytes to match the controller saved inventory',()=>{
  const f=fixture(),approved=treeInventory(f.dirs.controller);appendFileSync(f.worker,'\n// unreviewed change');
  expect(()=>verifyTree(f.dirs.controller,approved)).toThrow('frozen_tree_changed');
  expect(()=>launch(f)).toThrow('frozen_tree_changed');
 });
 it('keeps candidate membership identical to the existing complete sourceManifest protocol',()=>{
  const f=fixture(),runnerModule=path.join(process.cwd(),'scripts/competitions/v6/run-experiment.mjs');
  const probe=spawnSync(process.execPath,['--input-type=module','-e',`import {sourceManifest} from ${JSON.stringify('file://'+runnerModule)}; process.stdout.write(JSON.stringify(await sourceManifest(process.argv[1])));`,f.dirs.candidate],{env:{NODE_ENV:'production'},encoding:'utf8'});
  expect(probe.status,probe.stderr).toBe(0);expect(JSON.parse(probe.stdout)).toEqual(candidateInventory(f.dirs.candidate));
 });
 it.each(['null','throw','cwd','outside_import','claimed_success'])('does not bless %s from an incompatible synthetic V',variant=>{
  const f=fixture(),entry=path.join(f.dirs.verifier,'scripts/competitions/v6/acceptance-gate.ts');
  const body=variant==='null'?'return null;':variant==='throw'?"throw undefined;":variant==='cwd'?"process.chdir('..'); return null;":variant==='outside_import'?`await import(${JSON.stringify('file://'+path.join(f.dirs.evidence,'acceptance.json'))}); return null;`:"return {schemaVersion:'saitu.product-acceptance-result.v1',blockers:[],gates:[{passed:true}],agreedAiProxyGatesPassed:true};";
  writeFileSync(entry,`export async function evaluateProductAcceptance(){${body}}`);f.refresh();
  const {result}=launch(f);expect(result.status).toBe('invalid');expect(result.productAcceptancePassed).toBe(false);
 });
 it('rejects V mutation even when the mutated verifier throws',()=>{
  const f=fixture(),entry=path.join(f.dirs.verifier,'scripts/competitions/v6/acceptance-gate.ts');
  writeFileSync(entry,"import {appendFileSync} from 'node:fs'; export function evaluateProductAcceptance(){appendFileSync(new URL(import.meta.url),'\\n// mutation'); throw null;}");f.refresh();
  expect(launch(f).result.reason).toBe('frozen_tree_changed');
 });
 it('does not forward secret environment or Node loader injection into V',()=>{
  const f=fixture(),entry=path.join(f.dirs.verifier,'scripts/competitions/v6/acceptance-gate.ts');
  writeFileSync(entry,"export function evaluateProductAcceptance(){return {schemaVersion:'saitu.product-acceptance-result.v1',blockers:[process.env.SYNTHETIC_SECRET?'leaked':'clean'],gates:[{passed:false}],agreedAiProxyGatesPassed:false};}");f.refresh();
  const {run,result}=launch(f,[],{SYNTHETIC_SECRET:'secret-never-forward'});expect(run.status,JSON.stringify({stderr:run.stderr,error:run.error?.message})).toBe(1);expect(result.productResult.blockers).toEqual(['clean']);
 });
 it('forbids caller-selected entry/approve flags',()=>{
  const f=fixture();const {run,result}=launch(f,['--approve','true']);expect(run.status).toBe(2);expect(result).toBeNull();
 });
 it('rejects Node search-path injection rather than passing it to V',()=>{
  const f=fixture();expect(launch(f,[],{NODE_PATH:f.dirs.evidence}).result.reason).toBe('controller_node_environment_injection');
 });
 it('never writes failure or pending output into an immutable input tree',()=>{
  const f=fixture(),output=path.join(f.dirs.candidate,'public','result.json');
  const run=spawnSync(process.execPath,[f.entry,'--record',f.recordPath,'--candidate',f.dirs.candidate,'--evidence',f.dirs.evidence,'--reviews',f.dirs.reviews,'--verifier',f.dirs.verifier,'--output',output],{env:{NODE_ENV:'production'},encoding:'utf8'});
  expect(run.status).toBe(2);expect(()=>readFileSync(output)).toThrow();
 });
 it('keeps the same approved native V result under ancestor type, self-reference exports and imports changes',()=>{
  const f=fixture(),baseline=launch(f).result,approvedK=f.controllerApproval;
  const inventory=treeInventory(f.dirs.verifier),recordBytes=readFileSync(f.recordPath),probes=[];
  for(const metadata of [{type:'commonjs'},{type:'module'},{name:'zod',type:'module',exports:'./verifier/src/lib/competitions/v6/contracts.ts'},{name:'saitu-reviewed-verifier',type:'commonjs',imports:{'#x':'./evil.js'},exports:'./evil.js'}]){
   writeFileSync(path.join(path.dirname(f.recordPath),'package.json'),JSON.stringify(metadata));
   const {run,result}=launch(f);expect(run.status).toBe(1);
   expect(result).toEqual(baseline);expect(treeInventory(f.dirs.verifier)).toEqual(inventory);expect(readFileSync(f.recordPath)).toEqual(recordBytes);expect(f.controllerApproval).toEqual(approvedK);
   probes.push({metadata,exitCode:run.status,outputFile:`result-${probes.length+2}.json`,sameResultAsBaseline:true});
  }
  writeFileSync(path.join(path.dirname(f.recordPath),'ancestor-probe-results.json'),JSON.stringify({purpose:'synthetic_only_not_approval',baselineOutput:'result.json',unchangedControllerFiles:approvedK,unchangedVerifierFiles:inventory,probes},null,2));
  const artifacts=path.join(process.cwd(),'artifacts/continuation-20261105/final-acceptance-binding-03');mkdirSync(artifacts,{recursive:true});
  cpSync(path.dirname(f.recordPath),mkdtempSync(path.join(artifacts,'synthetic-ancestor-probe-')),{recursive:true});
 });
 it.each(['missing','type','self_reference','imports'])('rejects unsupported local root package scope before V execution: %s',variant=>{
  const f=fixture(),pkg=path.join(f.dirs.verifier,'package.json');
  if(variant==='missing')rmSync(pkg);else writeFileSync(pkg,JSON.stringify(variant==='type'?{name:'saitu-reviewed-verifier',private:true,type:'commonjs'}:variant==='self_reference'?{name:'zod',type:'module',exports:'./src/lib/competitions/v6/contracts.ts'}:{name:'saitu-reviewed-verifier',private:true,type:'module',imports:{'#alias':'zod'}}));
  f.refresh();const {result}=launch(f);expect(result.status).toBe('invalid');expect(result.reason).toBe(variant==='missing'?'verifier_root_package_scope_required':variant==='imports'?'unsupported_verifier_package_imports':'unsupported_verifier_root_package_scope');
 });
 it('rejects changed dependency package metadata even if its loaded JS is unchanged',()=>{
  const f=fixture();appendFileSync(path.join(f.dirs.verifier,'node_modules/zod/package.json'),' ');
  expect(launch(f).result.reason).toBe('frozen_tree_changed');
 });
 it.each(['external_package','package_import','escaping_main','legacy_fallback'])('does not delegate %s to unregistered Node metadata',variant=>{
  const f=fixture(),entry=path.join(f.dirs.verifier,'scripts/competitions/v6/acceptance-gate.ts');
  if(variant==='escaping_main'||variant==='legacy_fallback'){
   const pkg=path.join(f.dirs.verifier,'node_modules/zod/package.json'),value=JSON.parse(readFileSync(pkg,'utf8'));
   if(variant==='escaping_main')value.main='../../../outside.js';else{delete value.exports;value.main='./missing.js';}
   writeFileSync(pkg,JSON.stringify(value));
  }else{
   mkdirSync(path.join(path.dirname(f.recordPath),'node_modules/outside'),{recursive:true});
   writeFileSync(path.join(path.dirname(f.recordPath),'node_modules/outside/package.json'),JSON.stringify({name:'outside',type:'module',exports:'./index.js'}));
   writeFileSync(path.join(path.dirname(f.recordPath),'node_modules/outside/index.js'),'throw new Error("must never resolve external package");');
   writeFileSync(entry,`import ${JSON.stringify(variant==='external_package'?'outside':'#outside')}; export function evaluateProductAcceptance(){return null;}`);
  }
  f.refresh();const {result}=launch(f);expect(result.status).toBe('invalid');expect(result.reason).toBe(variant==='escaping_main'?'package_target_outside_registered_scope':'verifier_process_failed');
 });
 it.each(['local_index','ancestor_fallback','self_reference'])('rejects top-level exports:null without legacy fallback: %s',variant=>{
  const f=fixture(),pkg=path.join(f.dirs.verifier,'node_modules/review-null');mkdirSync(pkg,{recursive:true});
  writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'review-null',exports:null}));
  if(variant==='local_index')writeFileSync(path.join(pkg,'index.cjs'),'module.exports="MUST_NOT_LOAD";');
  if(variant==='local_index')writeFileSync(path.join(pkg,'index.js'),'module.exports="MUST_NOT_LOAD";');
  if(variant==='self_reference')writeFileSync(path.join(pkg,'self.cjs'),"module.exports=require('review-null');");
  const target=variant==='self_reference'?'../../../node_modules/review-null/self.cjs':'review-null';
  writeFileSync(path.join(f.dirs.verifier,'scripts/competitions/v6/acceptance-gate.ts'),`import{createRequire}from'node:module';export function evaluateProductAcceptance(){const value=createRequire(import.meta.url)(${JSON.stringify(target)});return {schemaVersion:'saitu.product-acceptance-result.v1',blockers:[value],gates:[{passed:false}],agreedAiProxyGatesPassed:false};}`);
  const alt=path.join(f.dirs.verifier,'node_modules/review-alt');mkdirSync(alt,{recursive:true});
  writeFileSync(path.join(alt,'package.json'),JSON.stringify({name:'review-alt',exports:'./index.cjs'}));writeFileSync(path.join(alt,'index.cjs'),'module.exports="EXTERNAL-METADATA-REDIRECTED-TO-REGISTERED-CODE";');
  f.refresh();const baseline=launch(f).result;
  expect(baseline.reason).toBe('verifier_process_failed');expect(baseline.bindingValidated).toBe(false);
  const frozen=treeInventory(f.dirs.verifier),record=readFileSync(f.recordPath);
  const external=path.join(path.dirname(f.recordPath),'node_modules/review-null');mkdirSync(external,{recursive:true});
  writeFileSync(path.join(external,'package.json'),JSON.stringify({name:'review-null',main:'../../verifier/node_modules/review-alt/index.cjs'}));
  expect(launch(f).result).toEqual(baseline);expect(treeInventory(f.dirs.verifier)).toEqual(frozen);expect(readFileSync(f.recordPath)).toEqual(record);
 });
 it('preserves null inside exports maps as a disabled subpath, while valid exports still load',()=>{
  const f=fixture(),pkg=path.join(f.dirs.verifier,'node_modules/review-map');mkdirSync(pkg,{recursive:true});
  writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'review-map',exports:{'.':'./index.cjs','./disabled':null}}));
  writeFileSync(path.join(pkg,'index.cjs'),'module.exports="mapped-main-ok";');
  writeFileSync(path.join(f.dirs.verifier,'scripts/competitions/v6/acceptance-gate.ts'),"import{createRequire}from'node:module';export function evaluateProductAcceptance(){const require=createRequire(import.meta.url),value=require('review-map');let blocked=false;try{require('review-map/disabled');}catch(error){blocked=error.code==='ERR_PACKAGE_PATH_NOT_EXPORTED';}return {schemaVersion:'saitu.product-acceptance-result.v1',blockers:[value,blocked?'disabled-subpath-ok':'FAILED'],gates:[{passed:false}],agreedAiProxyGatesPassed:false};}");
  f.refresh();const {result}=launch(f);expect(result.bindingValidated).toBe(true);expect(result.productAcceptancePassed).toBe(false);expect(result.productResult.blockers).toEqual(['mapped-main-ok','disabled-subpath-ok']);
 });
});
