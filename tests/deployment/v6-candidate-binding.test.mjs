import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {chmodSync,linkSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {candidateFixture} from './v6-candidate.fixture.mjs';
import {canonical,runtimeInventory,sha,verifyDelivery} from '../../scripts/lib/release-evidence-v6-contract.mjs';
import {controllerInventory,validateCandidateRecord} from '../../scripts/competitions/v6/final-candidate-binding.mjs';
import {captureProductionBuild} from '../../scripts/lib/release-evidence-v6-delivery.mjs';
import {parseArguments} from '../../scripts/run-release-evidence.mjs';
const fixture=fn=>()=>{const root=realpathSync(mkdtempSync(path.join(tmpdir(),'saitu-v6-u-test-')));try{return fn(candidateFixture(root),root);}finally{rmSync(root,{recursive:true,force:true});}};
const verified=f=>verifyDelivery(f.dirs.delivery,f.dirs.runtime,f.engineering,f.publicBytes);
const replaceSignature=f=>{f.payload.runtimeManifest=f.put(f.dirs.delivery,'runtime-manifest.json',canonical(runtimeInventory(f.dirs.runtime))+'\n');f.resign();};
test('synthetic correctly signed post-prune tree binds independent C and delivery bytes (not actual evidence)',fixture(f=>{assert.equal(verified(f).payload.buildId,f.payload.buildId);assert.ok(validateCandidateRecord(f.record,f.locations,f.dirs.controller).candidateSha256);assert.equal(controllerInventory(f.dirs.controller).length,8);}));
for(const [name,mutate]of [
 ['rebuild',f=>writeFileSync(path.join(f.dirs.runtime,'.next/server.js'),'rebuilt')],
 ['prune after seal',f=>rmSync(path.join(f.dirs.runtime,'node_modules/next/package.json'))],
 ['changed source',f=>writeFileSync(path.join(f.dirs.runtime,'src/synthetic.ts'),'drift')],
 ['mode change',f=>chmodSync(path.join(f.dirs.runtime,'.next/server.js'),0o600)],
 ['additional runtime file',f=>writeFileSync(path.join(f.dirs.runtime,'.next/new.js'),'added')],
 ['deleted runtime file',f=>rmSync(path.join(f.dirs.runtime,'.next/server.js'))],
 ['outside link',f=>symlinkSync('/etc/passwd',path.join(f.dirs.runtime,'.next/escape'))],
 ['signed raw log modified',f=>writeFileSync(path.join(f.dirs.delivery,'prune.log'),'caller says passed')],
 ['source modes artifact modified',f=>writeFileSync(path.join(f.dirs.delivery,'source-modes.txt'),'0644\tfake\n')],
 ['engineering generation replaced',f=>f.engineering.runId='22222222-2222-4222-8222-222222222222'],
 ['different engineering attestation',f=>f.engineering.attestationSha256=sha('wrong')]
])test(`reject ${name}`,fixture(f=>{mutate(f);assert.throws(()=>verified(f));}));
test('reject wrong signer',fixture(f=>{f.resign(generateKeyPairSync('ed25519').privateKey);assert.throws(()=>verified(f),/bad_signature/);}));
for(const [name,mutate]of [
 ['wrong domain',p=>p.domain='resume-ai-linux-validation-generation.v1'],
 ['wrong generation',p=>p.generationRoot='/tmp/caller-generation'],
 ['wrong producer path',p=>p.producer.path='/tmp/producer.mjs'],
 ['prune failure',p=>p.prune.exitCode=1],
 ['prune omits offline',p=>p.prune.command=p.prune.command.filter(a=>a!=='--offline')],
 ['performance build substituted',p=>p.buildId='performance-id'],
 ['stale delivery',p=>p.createdAt='2020-01-01T00:00:00Z']
])test(`reject signed ${name}`,fixture(f=>{mutate(f.payload);f.resign();assert.throws(()=>verified(f));}));
test('a newly signed inventory cannot hide changed original source',fixture(f=>{writeFileSync(path.join(f.dirs.runtime,'src/synthetic.ts'),'changed');replaceSignature(f);assert.throws(()=>verified(f),/source_mismatch/);}));
test('a newly signed inventory cannot add undeclared source',fixture(f=>{writeFileSync(path.join(f.dirs.runtime,'unreviewed.js'),'changed');replaceSignature(f);assert.throws(()=>verified(f),/unreviewed_runtime_member/);}));
test('legitimate internal dependency link is bound; replacing its target fails',fixture(f=>{f.put(f.dirs.runtime,'node_modules/.store/next.json','{"version":"15.5.24"}');rmSync(path.join(f.dirs.runtime,'node_modules/next/package.json'));symlinkSync('../.store/next.json',path.join(f.dirs.runtime,'node_modules/next/package.json'));replaceSignature(f);assert.ok(verified(f));writeFileSync(path.join(f.dirs.runtime,'node_modules/.store/next.json'),'{}');assert.throws(()=>verified(f));}));
test('mock/performance config is not the production build shape',fixture(f=>{f.put(f.dirs.runtime,'.next/required-server-files.json',JSON.stringify({version:1,config:{distDir:'.next-performance'},files:['x']}));replaceSignature(f);assert.throws(()=>verified(f),/production_build/);}));
for(const target of ['candidate','engineering','delivery','productRecord','controller'])test(`U rejects changed ${target} binding`,fixture(f=>{if(target==='productRecord')writeFileSync(f.productRecord,'{}');else if(target==='controller')writeFileSync(path.join(f.dirs.controller,'ops/bin/verify-release-evidence.mjs'),'// changed');else if(target==='candidate')writeFileSync(path.join(f.dirs.candidate,'src/synthetic.ts'),'changed');else writeFileSync(path.join(f.dirs[target],'extra.json'),'{}');assert.throws(()=>validateCandidateRecord(f.record,f.locations,f.dirs.controller));}));
test('U does not authorize arbitrary closure files',fixture(f=>{writeFileSync(path.join(f.dirs.controller,'approve.json'),'true');assert.throws(()=>controllerInventory(f.dirs.controller));}));
test('U rejects substituted root symlink',fixture(f=>{renameSync(f.dirs.engineering,f.dirs.engineering+'-moved');symlinkSync(f.dirs.engineering+'-moved',f.dirs.engineering);assert.throws(()=>validateCandidateRecord(f.record,f.locations,f.dirs.controller));}));
function runU(f,root,env={}){const args=['record',f.recordPath,'product-record',f.productRecord,...Object.entries(f.dirs).filter(([key])=>key!=='controller').flatMap(([key,value])=>[key,value]),'output',path.join(root,'result.json')];const result=spawnSync(process.execPath,[path.join(f.dirs.controller,'ops/bin/verify-v6-candidate-evidence.mjs'),...args.map((value,i)=>i%2===0?'--'+value:value)],{env:{PATH:'/usr/bin:/bin',...env},encoding:'utf8'});return{result,value:JSON.parse(readFileSync(path.join(root,'result.json')))}}
test('native U unregistered input stays pending despite caller passed assertions and env',fixture((f,root)=>{writeFileSync(f.recordPath,JSON.stringify({...f.record,passed:true,v6CandidateAcceptancePassed:true}));const {result,value}=runU(f,root,{V6_APPROVED:'true',TRUSTED_CANDIDATE_BINDINGS:sha(readFileSync(f.recordPath))});assert.equal(result.status,1);assert.equal(value.status,'pending');assert.equal(value.reason,'unified_independent_registration_required');assert.equal(value.v6CandidateAcceptancePassed,false);}));
test('native U rejects NODE_OPTIONS injection before trust lookup',fixture((f,root)=>{const {result,value}=runU(f,root,{NODE_OPTIONS:'--no-warnings'});assert.equal(result.status,1);assert.equal(value.status,'invalid');assert.match(value.reason,/environment_injection/);}));
test('protected producer rejects development root/path/runtime before any build or key reads',()=>{assert.throws(()=>captureProductionBuild({sourceState:{},buildRoot:'/missing'}),/root_x64_runtime_required|installed_coordinator_required/);});
test('coordinator v5 flags unchanged and V6 is explicit/strict',()=>{const base=['--source-manifest','/a','--output','/b','--www-url','https://example.invalid'];assert.equal(Object.keys(parseArguments(base)).length,3);assert.equal(parseArguments([...base,'--v6-delivery-output','/c'])['--v6-delivery-output'],'/c');assert.throws(()=>parseArguments([...base,'--passed','true']));assert.throws(()=>parseArguments([...base,'--v6-delivery-output','/c','--v6-delivery-output','/d']));});
test('native coordinator bad platform/privilege cannot use V6 caller path as signing authority',()=>{const run=spawnSync(process.execPath,['scripts/run-release-evidence.mjs','--source-manifest','/nonexistent','--output','/nonexistent','--www-url','https://example.invalid','--v6-delivery-output','/tmp/caller-choice'],{cwd:process.cwd(),env:{PATH:'/usr/bin:/bin'},encoding:'utf8'});assert.equal(run.status,1);assert.match(run.stderr,/Linux|root|Node/);});
test('coordinator keeps V6 after seal and routes late failure away from exact old artifact set',()=>{const text=readFileSync('scripts/run-release-evidence.mjs','utf8');const sealed=text.lastIndexOf('await sealLinuxValidationGeneration('),prune=text.lastIndexOf('v6-delivery-prune'),success=text.lastIndexOf('process.stdout.write(`${output}');assert.ok(sealed<prune&&prune<success);assert.ok(text.includes('if (!engineeringSealed) await writeEvidenceFailure(output, error)'));assert.ok(text.includes('v6Delivery.captureProductionBuild({ sourceState, buildRoot: builder.mounts.next.source, workerRoot: path.join(builder.mounts.worker.source, "decision-worker") })'));assert.ok(text.includes('await verifyInstalledControlFile("/usr/local/lib/resume-ai/release-evidence-v6-delivery.mjs"'));assert.ok(text.includes('privateNetwork: true'));});
test('post-prune snapshot rejects leftover development/browser installation even when re-signed',fixture(f=>{f.put(f.dirs.runtime,'node_modules/.release-evidence-playwright-browsers/chrome','synthetic browser');replaceSignature(f);assert.throws(()=>verified(f),/development_dependencies_remain/);}));
test('signed dependencies JSON cannot list dev tooling',fixture(f=>{f.payload.prune.dependencies=f.put(f.dirs.delivery,'production-dependencies.json',JSON.stringify([{dependencies:{next:{},vitest:{}}}]));f.resign();assert.throws(()=>verified(f),/production_dependencies_required/);}));
test('missing pnpm closure original rejects',fixture(f=>{rmSync(path.join(f.dirs.delivery,'pnpm-toolchain-manifest.json'));assert.throws(()=>verified(f));}));
test('signed incomplete pnpm closure rejects',fixture(f=>{f.payload.pnpmClosure.manifest=f.put(f.dirs.delivery,'pnpm-toolchain-manifest.json','[]');f.resign();assert.throws(()=>verified(f),/pnpm_closure_incomplete/);}));
test('existing cache exemption is bounded to .next/cache',fixture(f=>{f.put(f.dirs.runtime,'.next/cache/local','synthetic cache');assert.ok(verified(f));f.put(f.dirs.runtime,'.next/not-cache/local','other');assert.throws(()=>verified(f));}));
test('hardlinks are not accepted runtime originals',fixture(f=>{linkSync(path.join(f.dirs.runtime,'.next/server.js'),path.join(f.dirs.runtime,'.next/hardlink'));assert.throws(()=>verified(f),/regular_file_required/);}));
