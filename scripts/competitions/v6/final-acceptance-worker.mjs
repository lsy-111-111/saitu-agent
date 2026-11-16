/** K-owned loader, not an input-selected entrypoint. Only reviewed V is imported. */
import {registerHooks,isBuiltin} from 'node:module';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {artifact,bytesAt,FIXED_V_ENTRY,requireBinding,sha256,strictRoot,verifierPackageMetadata,verifyTree} from './final-acceptance-binding.mjs';
let hooks;
try{
 requireBinding(process.argv.length===4,'internal_worker_plan_required');
 const planRoot=strictRoot(path.dirname(process.argv[2]));
 const plan=artifact(planRoot,{path:path.basename(process.argv[2]),sha256:process.argv[3]}).json(),root=strictRoot(plan.verifier),evidence=strictRoot(plan.evidence),files=new Map(plan.files.map(row=>[row.path,row.sha256])),loaded=new Map();
 requireBinding(process.cwd()===evidence,'worker_cwd_not_evidence');verifyTree(root,plan.files);
 const {metadata:packageMetadataFiles,packages}=verifierPackageMetadata(root,plan.files);
 function inside(filename){requireBinding(filename.startsWith(root+path.sep),'verifier_dependency_outside_closure');return path.relative(root,filename).split(path.sep).join('/');}
 function parentDirectory(context){requireBinding(context.parentURL?.startsWith('file:'),'verifier_parent_scope_required');return path.posix.dirname(inside(fileURLToPath(context.parentURL)));}
 function scopeAt(directory){
  for(let current=directory;;current=path.posix.dirname(current)){
   if(packages.has(current))return packages.get(current);
   requireBinding(current!=='.'&&path.posix.basename(current)!=='node_modules','verifier_local_package_scope_required');
  }
 }
 function preflight(specifier,context){
  if(isBuiltin(specifier))return;
  if(specifier.startsWith('file:')||specifier.startsWith('.')||path.isAbsolute(specifier)){
   const target=new URL(specifier,context.parentURL);requireBinding(target.protocol==='file:'&&!target.search&&!target.hash,'unsupported_verifier_import');inside(fileURLToPath(target));return;
  }
  // #imports and non-file URL schemes are unsupported, not delegated to an
  // ancestor or external Node search path. Bare packages must already exist
  // inside V before Node is allowed to inspect their exports/main metadata.
  requireBinding(!specifier.startsWith('#')&&!specifier.includes(':')&&!specifier.includes('\\')&&!specifier.includes('%'),'unsupported_verifier_import');
  const parts=specifier.split('/'),name=parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0];
  requireBinding(name&&parts.every(part=>part&&part!=='.'&&part!=='..'),'unsupported_verifier_package_name');
  const directory=parentDirectory(context),scope=scopeAt(directory);
  if(scope.name===name&&scope.exports!==undefined){requireBinding(scope.exports!==null,'verifier_package_exports_required');return;}
  for(let current=directory;;current=path.posix.dirname(current)){
   const dependency=packages.get(path.posix.join(current,'node_modules',name));
   if(path.posix.basename(current)!=='node_modules'&&dependency){
    // Node's legacy main/index search can fall through to another ancestor
    // node_modules. Export-mapped packages stop at this registered package.
    requireBinding(dependency.exports!==undefined&&dependency.exports!==null,'verifier_package_exports_required');return;
   }
   if(current==='.')break;
  }
  throw new Error('verifier_package_outside_closure');
 }
 function verifyUrl(url){
  if(isBuiltin(url))return;
  requireBinding(url.startsWith('file:'),'unsupported_verifier_import');const parsed=new URL(url);
  requireBinding(!parsed.search&&!parsed.hash,'unsupported_verifier_import');
  const filename=fileURLToPath(parsed);requireBinding(filename.startsWith(root+path.sep),'verifier_dependency_outside_closure');
  const member=path.relative(root,filename).split(path.sep).join('/');
  requireBinding(/\.(?:mjs|cjs|js|mts|cts|ts|json)$/.test(member)&&files.has(member),'unregistered_verifier_dependency');
  const digest=sha256(bytesAt(root,member));requireBinding(digest===files.get(member),'loaded_verifier_bytes_changed');loaded.set(member,digest);
 }
 hooks=registerHooks({resolve(specifier,context,next){preflight(specifier,context);const resolved=next(specifier,context);verifyUrl(resolved.url);return resolved;},load(url,context,next){verifyUrl(url);return next(url,context);}});
 const verifier=await import(pathToFileURL(path.join(root,FIXED_V_ENTRY)).href);
 requireBinding(typeof verifier.evaluateProductAcceptance==='function','fixed_verifier_export_required');
 const input=artifact(evidence,plan.input).json();
 const result=await verifier.evaluateProductAcceptance(input,evidence);
 verifyTree(root,plan.files);requireBinding(process.cwd()===evidence,'worker_cwd_changed');
 requireBinding(result&&typeof result==='object'&&result.schemaVersion==='saitu.product-acceptance-result.v1'
  &&Array.isArray(result.blockers)&&Array.isArray(result.gates)&&result.gates.length>0,'invalid_verifier_result');
 process.stdout.write(JSON.stringify({schemaVersion:'saitu.final-verifier-run.v1',result,packageMetadataFiles,loadedFiles:[...loaded].map(([path,sha256])=>({path,sha256})).sort((a,b)=>a.path.localeCompare(b.path))}));
 if(result.blockers.length||result.agreedAiProxyGatesPassed!==true)process.exitCode=1;
}catch{process.stderr.write('final_verifier_execution_failed\n');process.exitCode=2;}
finally{hooks?.deregister();}
