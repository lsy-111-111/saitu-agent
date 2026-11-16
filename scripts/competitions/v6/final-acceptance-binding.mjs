/** Final candidate identities only. Scoring remains in independently approved V. */
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import path from 'node:path';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function requireBinding(ok,code){if(!ok)throw new Error(code);}
export function canonical(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 requireBinding(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype,'non_json_identity');
 return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
export const identityHash=value=>sha256(canonical(value));
const same=(a,b)=>canonical(a)===canonical(b);
export function exactObject(value,keys){requireBinding(value&&typeof value==='object'&&!Array.isArray(value)&&same(Object.keys(value).sort(),[...keys].sort()),'unexpected_identity_fields');return value;}
export function safeMember(member){requireBinding(typeof member==='string'&&member.length>0&&!member.includes('\\')&&!member.includes('\0')&&!/[\r\n]/.test(member)&&!path.posix.isAbsolute(member)&&member.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'),'unsafe_identity_path');return member;}
export function strictRoot(value){
 requireBinding(typeof value==='string'&&path.isAbsolute(value),'absolute_root_required');
 const resolved=path.resolve(value);let cursor=path.parse(resolved).root;
 for(const part of resolved.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);requireBinding(!lstatSync(cursor).isSymbolicLink(),'symlink_identity_path');}
 requireBinding(lstatSync(resolved).isDirectory()&&realpathSync(resolved)===resolved,'identity_root_changed');return resolved;
}
export function bytesAt(root,member){
 safeMember(member);let cursor=root;
 for(const part of member.split('/')){cursor=path.join(cursor,part);requireBinding(!lstatSync(cursor).isSymbolicLink(),'symlink_identity_path');}
 requireBinding(lstatSync(cursor).isFile()&&realpathSync(cursor)===cursor,'identity_member_not_regular');return readFileSync(cursor);
}
export function validateInventory(files){
 requireBinding(Array.isArray(files)&&files.length>0,'complete_inventory_required');
 const seen=new Set();for(const row of files){exactObject(row,['path','sha256']);safeMember(row.path);requireBinding(/^[a-f0-9]{64}$/.test(row.sha256)&&!seen.has(row.path),'invalid_inventory_member');seen.add(row.path);}
 requireBinding(same(files.map(row=>row.path),files.map(row=>row.path).sort()),'inventory_order_required');return files;
}
export function treeInventory(directory){
 const root=strictRoot(directory),files=[];
 function walk(member){for(const name of readdirSync(path.join(root,member)).sort()){
  const relative=member?`${member}/${name}`:name,meta=lstatSync(path.join(root,relative));safeMember(relative);
  requireBinding(!meta.isSymbolicLink(),'symlink_identity_path');
  if(meta.isDirectory())walk(relative);else{requireBinding(meta.isFile(),'identity_member_not_regular');files.push({path:relative,sha256:sha256(bytesAt(root,relative))});}
 }}walk('');return files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
// Same membership contract as run-experiment.sourceManifest, including ALL scripts
// and acceptance code. Build-generated next-env belongs to build evidence, not C.
const C_CONFIG=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc','.eslintrc.json','.eslintignore','tsconfig.json','next.config.mjs','postcss.config.mjs','postcss.config.js','tailwind.config.ts','vitest.config.ts','playwright.config.ts','tests/fixtures/server-only.ts','tests/fixtures/mock-spend-ledger.setup.ts'];
export function candidateInventory(directory){
 const root=strictRoot(directory),files=[];
 for(const prefix of ['src','db','scripts','ops','public'])for(const row of treeInventory(path.join(root,prefix))){
  const parts=row.path.split('/');
  if(parts.slice(0,-1).includes('__pycache__')||row.path.endsWith('.pyc')||parts.at(-1)==='.DS_Store')continue;
  files.push({...row,path:`${prefix}/${row.path}`});
 }
 for(const member of C_CONFIG){let meta;try{meta=lstatSync(path.join(root,member));}catch(error){if(error.code==='ENOENT')continue;throw error;}
  requireBinding(!meta.isSymbolicLink()&&meta.isFile(),'candidate_configuration_not_regular');files.push({path:member,sha256:sha256(bytesAt(root,member))});}
 return files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export function verifyTree(root,expected){validateInventory(expected);requireBinding(same(treeInventory(root),expected),'frozen_tree_changed');}
export function artifact(root,ref){exactObject(ref,['path','sha256']);requireBinding(/^[a-f0-9]{64}$/.test(ref.sha256),'artifact_hash_required');const bytes=bytesAt(root,ref.path);requireBinding(sha256(bytes)===ref.sha256,'bound_artifact_changed');return {bytes,json:()=>JSON.parse(bytes.toString('utf8'))};}
const refSame=(a,b)=>same(exactObject(a,['path','sha256']),exactObject(b,['path','sha256']));
export const FIXED_V_ENTRY='scripts/competitions/v6/acceptance-gate.ts';
// An explicit local scope stops Node from inheriting an unregistered ancestor's
// type or package self-reference. This is a physical, pinned file, not a loader
// override of Node's normal package semantics.
export const VERIFIER_ROOT_PACKAGE=Object.freeze({name:'saitu-reviewed-verifier',private:true,type:'module'});
export function verifierPackageMetadata(root,files){
 const metadata=files.filter(row=>row.path==='package.json'||row.path.endsWith('/package.json'));
 requireBinding(metadata.some(row=>row.path==='package.json'),'verifier_root_package_scope_required');
 const packages=new Map();
 for(const ref of metadata){
  const value=artifact(root,ref).json();requireBinding(value&&typeof value==='object'&&!Array.isArray(value),'invalid_verifier_package_metadata');
  // The supported Node-only closure has no package-import aliases or native
  // targets. Reject unsupported redirects before calling Node's resolver.
  requireBinding(value.imports===undefined,'unsupported_verifier_package_imports');
  const target=value=>{if(value===null)return;if(typeof value==='string'){requireBinding(value.startsWith('./')&&!value.split('/').includes('..')&&!value.includes('\\'),'package_target_outside_registered_scope');return;}
   requireBinding(value&&typeof value==='object','unsupported_package_target');for(const child of Object.values(value))target(child);};
  if(value.exports!==undefined)target(value.exports);
  if(value.main!==undefined){requireBinding(typeof value.main==='string'&&!path.posix.isAbsolute(value.main)&&!value.main.split('/').includes('..')&&!value.main.includes('\\'),'package_target_outside_registered_scope');}
  packages.set(path.posix.dirname(ref.path),value);
 }
 requireBinding(same(packages.get('.'),VERIFIER_ROOT_PACKAGE),'unsupported_verifier_root_package_scope');
 return {metadata,packages};
}
export function validateFinalBinding(record,locations){
 exactObject(record,['schemaVersion','candidateFiles','evidenceFiles','reviewFiles','verifierFiles','node','input','review','rawScoring','catalog','rankingRuntime','performance','budget']);
 requireBinding(record.schemaVersion==='saitu.final-product-binding.v1','final_binding_schema_required');
 exactObject(record.node,['version','sha256']);
 requireBinding(record.node.version===process.version&&record.node.sha256===sha256(readFileSync(process.execPath)),'node_runtime_not_registered');
 const roots=Object.fromEntries(['candidate','evidence','reviews','verifier'].map(key=>[key,strictRoot(locations[key])]));
 const values=Object.values(roots);
 requireBinding(values.every((a,i)=>values.every((b,j)=>i===j||a!==b&&!a.startsWith(b+path.sep)&&!b.startsWith(a+path.sep))),'identity_roots_must_be_separate');
 validateInventory(record.candidateFiles);requireBinding(same(candidateInventory(roots.candidate),record.candidateFiles),'final_candidate_differs_from_execution');
 for(const [name,key]of [['evidence','evidenceFiles'],['reviews','reviewFiles'],['verifier','verifierFiles']])verifyTree(roots[name],record[key]);
 requireBinding(record.verifierFiles.some(row=>row.path===FIXED_V_ENTRY)&&record.verifierFiles.every(row=>!row.path.endsWith('.node')),'unsupported_verifier_closure');
 verifierPackageMetadata(roots.verifier,record.verifierFiles);
 const read=ref=>artifact(roots.evidence,ref).json();
 const input=read(record.input),raw=read(record.rawScoring),review=artifact(roots.reviews,record.review).json();
 requireBinding(refSame(input.rawScoringEvidence,record.rawScoring),'raw_scoring_reference_mismatch');
 const implementationSha256=identityHash(record.candidateFiles);
 requireBinding(input.challengeManifest.implementationSha256===implementationSha256,'challenge_not_final_candidate');
 // R identity/approval fields are necessary structure, never the source of trust:
 // K's private exact record pin already binds every byte of this report closure.
 exactObject(review,['schemaVersion','mode','status','candidateSha256','evidenceSha256','verifierSha256','isolation','contexts']);
 requireBinding(review.schemaVersion==='saitu.final-product-independent-review.v1'&&review.mode==='ai_proxy'&&review.status==='approved'
  &&review.isolation==='separate_contexts_shared_filesystem'&&review.candidateSha256===implementationSha256
  &&review.evidenceSha256===identityHash(record.evidenceFiles)&&review.verifierSha256===identityHash(record.verifierFiles),'independent_review_binding_mismatch');
 requireBinding(Array.isArray(review.contexts)&&review.contexts.length>=2&&review.contexts.every(row=>typeof row==='string'&&row.length>0)&&new Set(review.contexts).size===review.contexts.length,'independent_review_contexts_required');
 const registration=read(raw.productRegistration),before=read(raw.implementationBefore),after=read(raw.implementationAfter);
 requireBinding(same(registration.sourceManifest,record.candidateFiles)&&[before,after].every(row=>row.implementationSha256===implementationSha256&&same(row.files,record.candidateFiles)),'raw_execution_not_final_candidate');
 const dispatch=read(raw.dispatchEvidence),freeze=read(dispatch.freezeManifest),binding=freeze.freezeBinding;
 requireBinding(binding.implementationSha256===implementationSha256,'matrix_not_final_candidate');
 const catalog=read(record.catalog),runtime=read(record.rankingRuntime);
 requireBinding(identityHash(catalog.records)===binding.catalogSha256&&registration.catalogSha256===binding.catalogSha256,'final_catalog_mismatch');
 requireBinding(runtime.sha256===identityHash(runtime.configuration)&&runtime.sha256===binding.runtimeConfigurationSha256
  &&registration.runtimeConfigurationSha256===runtime.sha256&&same(registration.runtimeConfiguration,runtime.configuration),'final_runtime_mismatch');
 for(const member of [record.catalog,record.rankingRuntime])requireBinding(freeze.files.some(row=>row.path===path.posix.relative(path.posix.dirname(dispatch.freezeManifest.path),member.path)&&row.sha256===member.sha256),'matrix_snapshot_not_same_original');
 exactObject(record.performance,['evidence','runtime','build']);
 const performance=read(record.performance.evidence),performanceRuntime=read(record.performance.runtime),build=read(record.performance.build);
 for(const id of ['firstScreenP95Ms','fullReportP95Ms'])requireBinding(input.metrics[id]?.evidencePath===record.performance.evidence.path&&input.metrics[id]?.evidenceSha256===record.performance.evidence.sha256,'final_performance_reference_mismatch');
 requireBinding(refSame(performance.runtimeConfigurationBefore,record.performance.runtime)&&refSame(performance.buildArtifacts,record.performance.build),'final_build_or_runtime_reference_mismatch');
 const perfRegistration=read(performance.registration);
 requireBinding(perfRegistration.implementationSha256===implementationSha256&&performanceRuntime.runtimeConfigurationSha256===identityHash(performanceRuntime.configuration)
  &&perfRegistration.runtimeConfigurationSha256===performanceRuntime.runtimeConfigurationSha256,'performance_not_final_candidate');
 requireBinding(Array.isArray(build.files)&&build.files.length>0,'final_build_originals_required');
 for(const row of build.files){const relative=path.posix.join(path.posix.dirname(record.performance.build.path),safeMember(row.path));artifact(roots.evidence,{path:relative,sha256:row.sha256});}
 exactObject(record.budget,['evidence','snapshot']);
 requireBinding(refSame(input.budgetEvidence,record.budget.evidence),'final_budget_reference_mismatch');
 const budget=read(record.budget.evidence);requireBinding(refSame(budget.snapshot,record.budget.snapshot),'final_budget_snapshot_mismatch');read(record.budget.snapshot);
 return {roots,input,identities:{candidateSha256:implementationSha256,evidenceSha256:identityHash(record.evidenceFiles),reviewSha256:identityHash(record.reviewFiles),verifierSha256:identityHash(record.verifierFiles),catalogSha256:binding.catalogSha256,rankingRuntimeSha256:runtime.sha256,performanceRuntimeSha256:performanceRuntime.runtimeConfigurationSha256,buildArtifactSha256:record.performance.build.sha256,budgetSnapshotSha256:record.budget.snapshot.sha256}};
}
