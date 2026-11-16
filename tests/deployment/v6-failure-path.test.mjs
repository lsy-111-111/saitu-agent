/** R1-01 exact failure-block probes. No root coordinator, deployment or key use. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmodSync,chownSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {hashOrdinaryFile} from '../../scripts/run-release-evidence.mjs';
import {physicalRoot} from '../../scripts/lib/release-evidence-v6-contract.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const coordinator=readFileSync(new URL('../../scripts/run-release-evidence.mjs',import.meta.url),'utf8');
const start=coordinator.indexOf('    else if (v6Delivery) {',coordinator.indexOf('    engineeringSealed = true;'))+'    else if (v6Delivery) {'.length;
const stop=coordinator.indexOf('\n    }\n    throw error;',start);
assert.ok(start>0&&stop>start);
const currentBlock=coordinator.slice(start,stop);
const oldBlock=readFileSync(new URL('../fixtures/v6-late-failure-r1.txt',import.meta.url),'utf8');
assert.equal(sha(oldBlock),'9a2940bdcbbcb9cd70e5a228f445d37dc11228d8ab4196aa59f3a2b0778a2bd3');
assert.equal(sha(oldBlock.slice(0,-1)),'b1d55fdf1468fb649ff1c7dab5ecb0e92bd52240bf0fcbb301edbc44fe3157b8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const execute=(block,environment)=>new AsyncFunction('mkdir','writeFile','readFile','path','args','workRoot','process','hashOrdinaryFile',block)(mkdir,writeFile,readFile,path,environment.args,environment.workRoot,environment.process,hashOrdinaryFile);
function snapshot(root){const rows=[];function walk(relative){for(const name of readdirSync(path.join(root,relative)).sort()){const item=relative?`${relative}/${name}`:name,p=path.join(root,item),s=lstatSync(p);if(s.isDirectory()){rows.push({path:item,kind:'D',mode:s.mode});walk(item);}else if(s.isFile())rows.push({path:item,kind:'F',mode:s.mode,sha256:sha(readFileSync(p))});else rows.push({path:item,kind:'L',mode:s.mode});}}walk('');return rows;}
function setup(){const root=realpathSync(mkdtempSync(path.join(tmpdir(),'saitu-v6-late-failure-'))),parent=path.join(root,'delivery-parent'),history=path.join(root,'old-generation'),workRoot=path.join(root,'trusted-work');for(const dir of [parent,history,workRoot])mkdirSync(dir,{mode:0o700});writeFileSync(path.join(history,'signed-original.json'),'sealed historical bytes\n',{mode:0o400});const output=path.join(parent,'delivery-12121212-1212-4212-8212-121212121212');const chunks=[];return {root,parent,history,workRoot,output,chunks,args:{'--v6-delivery-output':output},process:{stderr:{write:bytes=>chunks.push(Buffer.from(bytes))}},stderr:()=>Buffer.concat(chunks).toString('utf8')};}
const withFixture=fn=>async()=>{const f=setup();try{await fn(f);}finally{rmSync(f.root,{recursive:true,force:true});}};
function log(f,name,bytes){const dir=path.join(f.workRoot,'v6-delivery');mkdirSync(dir,{recursive:true,mode:0o750});writeFileSync(path.join(dir,name),bytes,{mode:0o600});}
function logs(f){return f.stderr().trim().split('\n').slice(1).map(line=>JSON.parse(line));}
test('exact R1 frozen block reproduces symlink pollution in an isolated unprivileged directory',withFixture(async f=>{chmodSync(f.parent,0o777);symlinkSync(f.history,f.output);assert.throws(()=>physicalRoot(f.output),/linked_root/);await execute(oldBlock,f);assert.equal(readFileSync(path.join(f.history,'V6_DELIVERY_FAILED'),'utf8'),'v6_delivery_failed_after_engineering_seal\n');}));
for(const variant of ['output-symlink','ancestor-symlink','nonprivate-parent','nonroot-parent','existing-history','missing-parent','regular-file-output'])test(`fixed exact block never writes rejected ${variant}`,withFixture(async f=>{
 if(variant==='output-symlink'){chmodSync(f.parent,0o777);symlinkSync(f.history,f.output);}
 if(variant==='ancestor-symlink'){rmSync(f.parent,{recursive:true});symlinkSync(f.history,f.parent);}
 if(variant==='nonprivate-parent')chmodSync(f.parent,0o777);
 if(variant==='nonroot-parent'){if(process.getuid?.()===0)chownSync(f.parent,65534,65534);assert.notEqual(lstatSync(f.parent).uid,0);}
 if(variant==='existing-history')f.args['--v6-delivery-output']=f.history;
 if(variant==='missing-parent')rmSync(f.parent,{recursive:true});
 if(variant==='regular-file-output')writeFileSync(f.output,'existing file');
 log(f,'prune.log',Buffer.from('synthetic failed prune stdout/stderr\n'));
 const before=snapshot(f.root);await execute(currentBlock,f);assert.deepEqual(snapshot(f.root),before);assert.match(f.stderr(),/^v6_delivery_failed_after_engineering_seal\n/);assert.equal(logs(f).length,1);
}));
test('failure handler does not even read caller output after a guard rejection',withFixture(async f=>{f.args=new Proxy({}, {get(){throw new Error('caller output accessed');}});await execute(currentBlock,f);assert.equal(f.stderr(),'v6_delivery_failed_after_engineering_seal\n');}));
test('existing exact helper owner/mode predicate rejects wrong owner/group/mode; links reject separately',withFixture(async f=>{
 const source=readFileSync(new URL('../../scripts/lib/release-evidence-v6-delivery.mjs',import.meta.url),'utf8');
 const expression=source.match(/fail\((parent\.uid===0&&parent\.gid===0&&\(parent\.mode&0o777\)===0o700),'delivery_private_parent_required'\)/)?.[1];assert.ok(expression);
 const check=new Function('parent',`return ${expression}`);assert.equal(check({uid:0,gid:0,mode:0o700}),true);
 for(const metadata of [{uid:501,gid:0,mode:0o700},{uid:0,gid:501,mode:0o700},{uid:0,gid:0,mode:0o777},{uid:0,gid:0,mode:0o755}])assert.equal(check(metadata),false);
 symlinkSync(f.history,f.output);assert.throws(()=>physicalRoot(f.output),/linked_root/);
}));
for(const failure of ['prune','dependencies'])test(`legitimate ${failure} failure preserves raw diagnostic bytes on stderr before cleanup`,withFixture(async f=>{
 mkdirSync(f.output,{mode:0o700});const raw=Buffer.from([0,10,13,27,91,109,255,97,10]);log(f,'prune.log',raw);if(failure==='dependencies')log(f,'dependencies.log',Buffer.from('dependency failure\n'));
 const historyBefore=snapshot(f.history),outputBefore=snapshot(f.output);await execute(currentBlock,f);const entries=logs(f);assert.equal(entries.length,failure==='prune'?1:2);
 for(const entry of entries){assert.equal(entry.schemaVersion,'saitu.v6-delivery-failure-log.v1');assert.equal(entry.encoding,'base64');const bytes=Buffer.from(entry.data,'base64');assert.equal(sha(bytes),entry.sha256);assert.equal(bytes.length,entry.bytes);assert.deepEqual(bytes,readFileSync(path.join(f.workRoot,'v6-delivery',entry.name)));}
 rmSync(f.workRoot,{recursive:true});assert.deepEqual(Buffer.from(entries[0].data,'base64'),raw);assert.deepEqual(snapshot(f.history),historyBefore);assert.deepEqual(snapshot(f.output),outputBefore);
}));
test('missing or linked stage logs do not cause fallback writes',withFixture(async f=>{mkdirSync(path.join(f.workRoot,'v6-delivery'));symlinkSync(path.join(f.history,'signed-original.json'),path.join(f.workRoot,'v6-delivery/prune.log'));const before=snapshot(f.root);await execute(currentBlock,f);assert.deepEqual(snapshot(f.root),before);assert.equal(f.stderr(),'v6_delivery_failed_after_engineering_seal\n');}));
test('diagnostic sink failure cannot replace original exception or trigger a path fallback',withFixture(async f=>{f.process.stderr.write=()=>{throw new Error('EPIPE synthetic');};const before=snapshot(f.root);const original=new Error('original delivery failure');await assert.rejects(async()=>{await execute(currentBlock,f);throw original;},error=>error===original);assert.deepEqual(snapshot(f.root),before);}));
test('current catch still rethrows, preserves old v5 failure branch and performs no output recovery',()=>{const catchStart=coordinator.indexOf('  } catch (error) {',coordinator.indexOf('    engineeringSealed = true;'));const catchEnd=coordinator.indexOf('  } finally {',catchStart);const block=coordinator.slice(catchStart,catchEnd);assert.ok(block.includes('if (!engineeringSealed) await writeEvidenceFailure(output, error).catch(() => undefined);'));assert.ok(block.includes('    throw error;'));assert.ok(!currentBlock.includes('--v6-delivery-output'));assert.ok(!/\b(?:mkdir|writeFile)\s*\(/u.test(currentBlock));});
