/** Pure/readonly delivery contract. Signing authority is not exported here. */
import {createHash,verify} from 'node:crypto';
import {constants,lstatSync,openSync,closeSync,fstatSync,readFileSync,readdirSync,readlinkSync,realpathSync} from 'node:fs';
import path from 'node:path';
export const DELIVERY_DOMAIN='saitu.v6-delivery-generation.v1';
export const SIGNING_PUBLIC_KEY='/etc/resume-ai/release-evidence-signing.pub';
export const NODE_PATH='/opt/nodejs/node-v24.20.0-linux-x64/bin/node';
export const PNPM_TOOLS_ROOT='/opt/nodejs/node-v24.20.0-linux-x64/lib/runtime-tools';
export const PNPM_PATH='/opt/nodejs/node-v24.20.0-linux-x64/lib/runtime-tools/node_modules/pnpm/bin/pnpm.mjs';
export const COORDINATOR='/usr/local/lib/resume-ai/run-release-evidence.mjs';
export const PRODUCER='/usr/local/lib/resume-ai/release-evidence-v6-delivery.mjs';
export const CONTRACT='/usr/local/lib/resume-ai/release-evidence-v6-contract.mjs';
export const DELIVERY_PARENT='/var/lib/resume-ai/v6-delivery-generations';
export const fail=(ok,code)=>{if(!ok)throw new Error(code);};
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function canonical(value){if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;fail(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype,'delivery_non_json');return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;}
export const digest=value=>sha(canonical(value));
export function exact(value,keys){fail(value&&typeof value==='object'&&!Array.isArray(value)&&canonical(Object.keys(value).sort())===canonical([...keys].sort()),'delivery_unknown_fields');return value;}
export function member(value){fail(typeof value==='string'&&value.length>0&&value===value.normalize('NFC')&&!/[\\\0\r\n\t]/u.test(value)&&!path.posix.isAbsolute(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'),'delivery_unsafe_path');return value;}
export function physicalRoot(value){fail(typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value,'delivery_absolute_root_required');let current=path.parse(value).root;for(const part of value.slice(current.length).split('/').filter(Boolean)){current=path.join(current,part);const s=lstatSync(current);fail(s.isDirectory()&&!s.isSymbolicLink(),'delivery_linked_root');}fail(realpathSync(value)===value,'delivery_root_changed');return value;}
const stable=s=>[s.dev,s.ino,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
export function ordinary(filename){
 const before=lstatSync(filename,{bigint:true});fail(before.isFile()&&before.nlink===1n&&before.size<=512n*1024n**2n&&!before.isSymbolicLink(),'delivery_regular_file_required');
 const fd=openSync(filename,constants.O_RDONLY|constants.O_NOFOLLOW);try{fail(stable(before)===stable(fstatSync(fd,{bigint:true})),'delivery_file_changed');const bytes=readFileSync(fd);fail(stable(before)===stable(fstatSync(fd,{bigint:true}))&&stable(before)===stable(lstatSync(filename,{bigint:true})),'delivery_file_changed');return{bytes,sha256:sha(bytes),metadata:before};}finally{closeSync(fd);}
}
export function rawAt(root,name){member(name);let cursor=root;const parts=name.split('/');for(const part of parts.slice(0,-1)){cursor=path.join(cursor,part);const s=lstatSync(cursor);fail(s.isDirectory()&&!s.isSymbolicLink(),'delivery_linked_parent');}return ordinary(path.join(root,name));}
export function sourceRows(bytes){
 const text=bytes.toString('utf8');fail(Buffer.from(text).equals(bytes)&&text.endsWith('\n')&&!text.includes('\r'),'delivery_source_encoding');
 const rows=text.slice(0,-1).split('\n').map(line=>{const match=/^([a-f0-9]{64})\tF\t(.+)$/u.exec(line);fail(match,'delivery_regular_source_required');return{path:member(match[2]),sha256:match[1]};});
 fail(rows.length>0&&new Set(rows.map(row=>row.path)).size===rows.length&&rows.every((row,i)=>!i||Buffer.compare(Buffer.from(rows[i-1].path),Buffer.from(row.path))<0),'delivery_source_membership');return rows;
}
export function verifySource(root,manifestBytes,modeBytes){
 physicalRoot(root);const rows=sourceRows(manifestBytes),text=modeBytes.toString('utf8');fail(text.endsWith('\n'),'delivery_source_modes_required');
 const modes=text.slice(0,-1).split('\n').map(line=>{const m=/^(0[0-7]{3})\t(.+)$/u.exec(line);fail(m,'delivery_source_modes_required');return{path:member(m[2]),mode:parseInt(m[1],8)};});
 fail(rows.length===modes.length&&rows.every((row,i)=>row.path===modes[i].path),'delivery_source_mode_membership');
 for(let i=0;i<rows.length;i++){const observed=rawAt(root,rows[i].path);fail(observed.sha256===rows[i].sha256&&Number(observed.metadata.mode&0o7777n)===modes[i].mode,'delivery_source_mismatch');}
 return rows;
}
/** Full file/link/directory/mode inventory. Only the existing .next/cache rule
 * is exempt; links anywhere else must resolve within this same runtime tree. */
function inventoryTree(directory,cachePath){
 const root=physicalRoot(directory),rows=[];let bytes=0;
 function walk(relative){const dir=path.join(root,relative),before=lstatSync(dir,{bigint:true}),names=readdirSync(dir).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
  for(const name of names){const item=relative?`${relative}/${name}`:name;member(item);if(item===cachePath)continue;
   const filename=path.join(root,item),s=lstatSync(filename,{bigint:true}),mode=Number(s.mode&0o7777n);fail((mode&0o7000)===0,'delivery_special_mode');
   if(s.isSymbolicLink()){const target=readlinkSync(filename);fail(!path.isAbsolute(target)&&!/[\0\r\n]/.test(target),'delivery_unsafe_link');const resolved=realpathSync(filename);fail(resolved.startsWith(root+path.sep),'delivery_escaping_link');fail(stable(s)===stable(lstatSync(filename,{bigint:true})),'delivery_link_changed');rows.push({path:item,kind:'L',mode,target,sha256:sha(target)});}
   else if(s.isDirectory()){rows.push({path:item,kind:'D',mode});walk(item);}
   else{const file=ordinary(filename);bytes+=file.bytes.length;fail(bytes<=8*1024**3&&file.bytes.length<=512*1024**2,'delivery_size_limit');rows.push({path:item,kind:'F',mode,bytes:file.bytes.length,sha256:file.sha256});}
   fail(rows.length<=250000,'delivery_member_limit');
  }
  fail(stable(before)===stable(lstatSync(dir,{bigint:true}))&&canonical(names)===canonical(readdirSync(dir).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))),'delivery_tree_changed');
 }walk('');fail(rows.length>0,'delivery_empty_tree');return rows.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
}
export const runtimeInventory=directory=>inventoryTree(directory,'.next/cache');
export const buildInventory=directory=>inventoryTree(directory,'cache');
/** The worker is a closed two-file artifact paired to the same compiled Next
 * source binding. No arbitrary dist subtree can enter a signed runtime. */
export function verifyEffortBuildBinding(manifest,binding,nextConfig,required=false){
 const carries=Object.hasOwn(manifest,'effortPolicy')||Object.hasOwn(manifest,'effortPolicySha256');
 if(!carries){fail(!required&&!Object.hasOwn(binding,'effortPolicy')&&!Object.hasOwn(binding,'effortPolicySha256')&&nextConfig?.env?.SAITU_V7_EFFORT_POLICY===undefined&&nextConfig?.env?.SAITU_V7_EFFORT_POLICY_SHA256===undefined,'delivery_worker_effort_binding_required');return;}
 const p=manifest.effortPolicy;exact(p,['version','rank','explain','review']);
 fail(p.version==='saitu.effort-policy.v1'&&['rank','explain','review'].every(stage=>['high','low'].includes(p[stage])),'delivery_worker_effort_policy_invalid');
 const normalized={version:p.version,rank:p.rank,explain:p.explain,review:p.review},fingerprint=sha(JSON.stringify(normalized));
 fail(manifest.effortPolicySha256===fingerprint&&binding.effortPolicySha256===fingerprint&&canonical(binding.effortPolicy)===canonical(normalized)&&nextConfig?.env?.SAITU_V7_EFFORT_POLICY===JSON.stringify(normalized)&&nextConfig?.env?.SAITU_V7_EFFORT_POLICY_SHA256===fingerprint,'delivery_worker_effort_binding_changed');
 return fingerprint;
}
export function verifyExecutionBuildBinding(manifest,binding,nextConfig,required=false){
 const carries=Object.hasOwn(manifest,'executionMode')||Object.hasOwn(binding,'executionMode')||nextConfig?.env?.SAITU_AI_EXECUTION_MODE!==undefined;
 if(!carries){fail(!required,'delivery_worker_execution_mode_required');return;}
 fail(manifest.executionMode==='user-unbounded'&&binding.executionMode==='user-unbounded'&&nextConfig?.env?.SAITU_AI_EXECUTION_MODE==='user-unbounded','delivery_worker_execution_mode_changed');
 return 'user-unbounded';
}
export function verifyWorkerBuildArtifacts(nextRoot,workerRoot,{requireEffortPolicy=false,requireExecutionMode=false}={}){
 physicalRoot(nextRoot);physicalRoot(workerRoot);
 const files=runtimeInventory(workerRoot);
 fail(canonical(files.map(row=>[row.path,row.kind]))===canonical([['manifest.json','F'],['worker.mjs','F']]),'delivery_worker_closed_artifact_required');
 const manifestBytes=rawAt(workerRoot,'manifest.json'),manifest=JSON.parse(manifestBytes.bytes);
 exact(manifest,['schemaVersion','sourceSha256','artifactSha256','nodeMajor','inputs','nextBuildId','nextBindingSha256',...(Object.hasOwn(manifest,'effortPolicy')?['effortPolicy','effortPolicySha256']:[]),...(Object.hasOwn(manifest,'executionMode')?['executionMode']:[])]);
 fail(manifest.schemaVersion==='saitu.worker-build.v7'&&manifest.nodeMajor===24&&[manifest.sourceSha256,manifest.artifactSha256,manifest.nextBindingSha256].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))&&Array.isArray(manifest.inputs)&&manifest.inputs.length>0,'delivery_worker_manifest_invalid');
 fail(rawAt(workerRoot,'worker.mjs').sha256===manifest.artifactSha256,'delivery_worker_artifact_changed');
 const bindingBytes=rawAt(nextRoot,'decision-worker-binding.json'),binding=JSON.parse(bindingBytes.bytes),buildId=rawAt(nextRoot,'BUILD_ID').bytes.toString('utf8').trim(),required=JSON.parse(rawAt(nextRoot,'required-server-files.json').bytes);
 exact(binding,['schemaVersion','sourceSha256','workerArtifactSha256','nextBuildId',...(Object.hasOwn(manifest,'effortPolicy')?['effortPolicy','effortPolicySha256']:[]),...(Object.hasOwn(manifest,'executionMode')?['executionMode']:[])]);
 const effortPolicySha256=verifyEffortBuildBinding(manifest,binding,required.config,requireEffortPolicy);
 const executionMode=verifyExecutionBuildBinding(manifest,binding,required.config,requireExecutionMode);
 fail(bindingBytes.sha256===manifest.nextBindingSha256&&binding.schemaVersion==='saitu.next-worker-binding.v7'&&binding.sourceSha256===manifest.sourceSha256&&binding.workerArtifactSha256===manifest.artifactSha256&&required.config?.env?.SAITU_V7_SOURCE_SHA256===manifest.sourceSha256&&buildId.length>0&&manifest.nextBuildId===buildId&&binding.nextBuildId===buildId,'delivery_worker_next_source_binding_changed');
 return {sourceSha256:manifest.sourceSha256,artifactSha256:manifest.artifactSha256,manifestSha256:manifestBytes.sha256,nextBuildId:buildId,...(effortPolicySha256?{effortPolicySha256}:{}),...(executionMode?{executionMode}:{})};
}
export function verifyDeliveryShape(root,source,rows){
 const sourceNames=new Set(source.map(row=>row.path)),workerRequired=sourceNames.has('scripts/competitions/v7/worker-entry.ts');
 for(const row of rows){const generated=row.path==='.next'||row.path.startsWith('.next/')||row.path==='node_modules'||row.path.startsWith('node_modules/');
  const worker=workerRequired&&((row.kind==='D'&&['dist','dist/decision-worker'].includes(row.path))||(row.kind==='F'&&['dist/decision-worker/manifest.json','dist/decision-worker/worker.mjs'].includes(row.path)));
  fail(generated||worker||sourceNames.has(row.path)||row.kind==='D'&&source.some(file=>file.path.startsWith(row.path+'/')),'delivery_unreviewed_runtime_member');}
 fail(!rows.some(row=>['node_modules/playwright','node_modules/@playwright/test','node_modules/eslint','node_modules/typescript','node_modules/vitest','node_modules/.release-evidence-playwright-browsers','node_modules/.vite'].includes(row.path)),'delivery_development_dependencies_remain');
 const buildId=rawAt(root,'.next/BUILD_ID').bytes.toString('utf8').trim(),required=JSON.parse(rawAt(root,'.next/required-server-files.json').bytes);
 fail(buildId.length>0&&required.version===1&&required.config?.distDir==='.next'&&Array.isArray(required.files)&&required.files.length>0,'delivery_production_build_required');
 const nextPath=realpathSync(path.join(root,'node_modules/next/package.json'));fail(nextPath.startsWith(root+path.sep),'delivery_escaping_next_package');const next=JSON.parse(ordinary(nextPath).bytes);
 if(workerRequired)verifyWorkerBuildArtifacts(path.join(root,'.next'),path.join(root,'dist/decision-worker'),{requireEffortPolicy:sourceNames.has('src/lib/ai/effort-policy.mjs'),requireExecutionMode:sourceNames.has('src/lib/ai/execution-policy.mjs')||sourceNames.has('db/migrations/20261109_spend_user_unbounded_execution.sql')});
 fail(next.version==='15.5.24','delivery_next_version_mismatch');return buildId;
}
function b64(value){fail(typeof value==='string'&&Buffer.from(value,'base64').toString('base64')===value,'delivery_noncanonical_base64');return Buffer.from(value,'base64');}
/** publicKey bytes are passed only by fixed-root authority callers. Tests can
 * exercise crypto with synthetic keys; production U never accepts a key option. */
export function verifyDeliverySignature(attestation,publicKeyBytes){
 exact(attestation,['schemaVersion','algorithm','publicKey','payloadBase64','payloadSha256','signatureBase64']);exact(attestation.publicKey,['path','sha256']);
 fail(attestation.schemaVersion===DELIVERY_DOMAIN&&attestation.algorithm==='Ed25519'&&attestation.publicKey.path===SIGNING_PUBLIC_KEY&&attestation.publicKey.sha256===sha(publicKeyBytes),'delivery_signature_domain_or_key');
 const bytes=b64(attestation.payloadBase64),signature=b64(attestation.signatureBase64);
 fail(bytes.length<=4*1024**2&&bytes.length>0&&sha(bytes)===attestation.payloadSha256&&signature.length===64&&verify(null,bytes,publicKeyBytes,signature),'delivery_bad_signature');
 const payload=JSON.parse(bytes);fail(Buffer.from(canonical(payload)+'\n').equals(bytes),'delivery_noncanonical_payload');
 exact(payload,['domain','runId','generationRoot','createdAt','sourceManifestSha256','sourceModeManifestSha256','sourceModeMemberCount','engineeringAttestationSha256','coordinatorSha256','producer','contract','node','pnpmSha256','pnpmClosure','runtimeManifest','sourceManifest','sourceModes','prune','buildId']);
 fail(payload.domain===DELIVERY_DOMAIN&&/^[0-9a-f-]{36}$/.test(payload.runId)&&payload.generationRoot===`${DELIVERY_PARENT}/delivery-${payload.runId}`,'delivery_payload_domain_or_generation');
 exact(payload.producer,['path','sha256']);exact(payload.contract,['path','sha256']);exact(payload.node,['path','version','sha256']);
 fail(payload.producer.path===PRODUCER&&payload.contract.path===CONTRACT&&payload.node.path===NODE_PATH&&payload.node.version==='v24.20.0','delivery_producer_or_runtime_identity');
 fail([payload.sourceManifestSha256,payload.sourceModeManifestSha256,payload.engineeringAttestationSha256,payload.coordinatorSha256,payload.producer.sha256,payload.contract.sha256,payload.node.sha256,payload.pnpmSha256].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))&&Number.isSafeInteger(payload.sourceModeMemberCount)&&payload.sourceModeMemberCount>0,'delivery_identity_required');
 return payload;
}
export function rootPublicKey(){physicalRoot(path.dirname(SIGNING_PUBLIC_KEY));let cursor=path.dirname(SIGNING_PUBLIC_KEY);while(cursor!=='/'){const parent=lstatSync(cursor);fail(parent.uid===0&&parent.gid===0&&(parent.mode&0o022)===0,'delivery_public_key_parent_not_root_anchor');cursor=path.dirname(cursor);}const observed=ordinary(SIGNING_PUBLIC_KEY),s=observed.metadata;fail(s.uid===0n&&s.gid===0n&&(s.mode&0o777n)===0o644n,'delivery_public_key_not_root_anchor');return observed.bytes;}
export function verifyDelivery(directory,runtimeRoot,engineering,publicKeyBytes){
 physicalRoot(directory);const attestation=JSON.parse(rawAt(directory,'delivery-attestation.json').bytes),payload=verifyDeliverySignature(attestation,publicKeyBytes);
 fail(payload.runId===engineering.runId&&payload.engineeringAttestationSha256===engineering.attestationSha256&&payload.sourceManifestSha256===engineering.sourceManifestSha256&&payload.sourceModeManifestSha256===engineering.sourceModeManifestSha256&&payload.sourceModeMemberCount===engineering.sourceModeMemberCount&&payload.coordinatorSha256===engineering.coordinatorSha256,'delivery_engineering_generation_mismatch');
 fail(Number.isFinite(Date.parse(payload.createdAt))&&Date.parse(payload.createdAt)>=Date.parse(engineering.createdAt)&&Date.parse(payload.createdAt)<=Date.now()&&Date.now()-Date.parse(payload.createdAt)<=24*60*60*1000,'delivery_not_fresh_generation');
 const read=ref=>{exact(ref,['path','sha256']);const a=rawAt(directory,ref.path);fail(a.sha256===ref.sha256,'delivery_original_changed');return a.bytes;};
 fail(payload.sourceManifest.path==='source-manifest.txt'&&payload.sourceModes.path==='source-modes.txt'&&payload.runtimeManifest.path==='runtime-manifest.json'&&payload.prune.log.path==='prune.log'&&payload.prune.dependencies.path==='production-dependencies.json','delivery_fixed_artifact_paths');
 const source=read(payload.sourceManifest),modes=read(payload.sourceModes),inventory=JSON.parse(read(payload.runtimeManifest));
 exact(payload.pnpmClosure,['root','manifest']);fail(payload.pnpmClosure.root===PNPM_TOOLS_ROOT&&payload.pnpmClosure.manifest.path==='pnpm-toolchain-manifest.json','delivery_fixed_pnpm_closure');
 const toolchain=JSON.parse(read(payload.pnpmClosure.manifest));fail(Array.isArray(toolchain)&&toolchain.some(row=>row.path==='node_modules/pnpm/bin/pnpm.mjs'&&row.kind==='F'&&row.sha256===payload.pnpmSha256)&&toolchain.some(row=>row.path==='node_modules/pnpm/package.json'&&row.kind==='F'),'delivery_pnpm_closure_incomplete');
 fail(sha(source)===payload.sourceManifestSha256&&sha(modes)===payload.sourceModeManifestSha256,'delivery_source_binding');
 const sourceList=verifySource(runtimeRoot,source,modes),actual=runtimeInventory(runtimeRoot);
 fail(canonical(actual)===canonical(inventory),'delivery_runtime_bytes_or_modes_changed');fail(sourceList.length===payload.sourceModeMemberCount&&verifyDeliveryShape(runtimeRoot,sourceList,actual)===payload.buildId,'delivery_build_id_changed');
 exact(payload.prune,['command','exitCode','log','dependencies']);
 fail(canonical(payload.prune.command)==canonical([NODE_PATH,PNPM_PATH,'prune','--prod','--ignore-scripts','--package-import-method=copy','--offline','--ignore-pnpmfile','--config.manage-package-manager-versions=false','--store-dir=<generation-store>'])&&payload.prune.exitCode===0,'delivery_prune_protocol_required');read(payload.prune.log);
 const report=JSON.parse(read(payload.prune.dependencies)),item=Array.isArray(report)?report[0]:report;
 fail(item&&typeof item.dependencies==='object'&&Object.hasOwn(item.dependencies,'next')&&!['playwright','@playwright/test','eslint','typescript','vitest'].some(name=>name in item.dependencies),'delivery_production_dependencies_required');
 return {payload,attestationSha256:sha(rawAt(directory,'delivery-attestation.json').bytes),runtimeSha256:digest(actual),source:sourceList};
}
