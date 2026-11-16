import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile,realpath,lstat,copyFile,readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {verifyLocalE5Assets,verifyAssetFile,E5_MODEL,E5_REVISION} from './local-e5.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashPattern=/^[a-f0-9]{64}$/;
async function sourceBytes(root,filename,expected,limit){
  const publicRoots=['artifacts/v6/content-research/source-byte-snapshots/','artifacts/v6/content-research/frozen-source-text/'];
  if(typeof filename!=='string'||path.isAbsolute(filename)||filename.includes('\\')||!publicRoots.some(prefix=>filename.startsWith(prefix))
    ||filename.split('/').some(part=>part==='..'||part.startsWith('.')||/private|secret|sealed|credential|auth|token/i.test(part))
    ||/\.(?:key|pem|p12|pfx)$/i.test(filename))throw new Error('runtime_source_path_not_public_relative');
  const resolved=path.resolve(root,filename),actual=await realpath(resolved),stat=await lstat(resolved);
  if(actual!==resolved||!actual.startsWith(root+path.sep)||!stat.isFile()||stat.size>limit)throw new Error('runtime_source_not_regular_or_outside_root');
  const bytes=await readFile(actual);
  if(expected!==undefined&&(!hashPattern.test(expected)||hash(bytes)!==expected))throw new Error('runtime_source_hash_mismatch');
  return bytes;
}

/** Explicit asset packaging, independent of Next's automatic tracing. No network or credentials. */
export async function packageRuntimeSources({root,indexPath,output}){
  root=await realpath(root);output=path.resolve(output);
  await mkdir(output,{recursive:false});
  const raw=await sourceBytes(root,indexPath,undefined,2_000_000),index=JSON.parse(raw);
  if(index.schemaVersion!=='saitu.frozen-source-text.v1'||!Array.isArray(index.sources))throw new Error('frozen_source_index_required');
  if(index.sources.some(row=>row.conflictingVersions?.length))throw new Error('fault_injected_sources_not_runtime_candidate_assets');
  const files=[],copied=new Set(),unavailable=[];
  async function put(name,bytes){
    if(copied.has(name))return;
    await mkdir(path.dirname(path.join(output,name)),{recursive:true});
    await writeFile(path.join(output,name),bytes,{flag:'wx',mode:0o644});
    copied.add(name);files.push({path:name,sha256:hash(bytes),bytes:bytes.length});
  }
  await put('original-index.json',raw);
  for(const row of index.sources){
    if(row.status!=='body_available_not_verified')unavailable.push({sourceId:row.sourceId,url:row.url,status:row.status});
    for(const [field,hashField,extension,limit]of [['sourceArtifact','sourceByteSha256','raw',100_000_000],['bodyArtifact','bodySha256','txt',2_000_000]]){
      if(row[field]===undefined||row[field]===null){if(row.status==='body_available_not_verified')throw new Error('available_source_missing_original_bytes');continue;}
      if(!hashPattern.test(row[hashField]??''))throw new Error('source_content_hash_required');
      const bytes=await sourceBytes(root,row[field],row[hashField],limit),destination=`sources/${row[hashField]}.${extension}`;
      await put(destination,bytes);row[field]=destination;
    }
  }
  const encoded=JSON.stringify(index,null,2)+'\n';await put('index.json',Buffer.from(encoded));
  return {schemaVersion:'saitu.runtime-assets.v1',createdAt:new Date().toISOString(),sourceIndexSha256:hash(raw),runtimeIndexSha256:hash(encoded),sourceCount:index.sources.length,unavailableSources:unavailable,files,e5:null,
    bindings:{SAITU_FROZEN_EVIDENCE_ROOT:'<absolute installed asset directory>',SAITU_FROZEN_EVIDENCE_INDEX:'index.json',SAITU_FROZEN_EVIDENCE_INDEX_SHA256:hash(encoded)},
    acceptancePassed:false,limitation:'Packaging verifies bytes and runtime paths. It does not approve source facts, eligibility, content reviews or a release.'};
}

export async function verifyRuntimeAssetBundle(output,manifest){
  output=await realpath(output);
  if(manifest.schemaVersion!=='saitu.runtime-assets.v1'||!Array.isArray(manifest.files)||new Set(manifest.files.map(file=>file.path)).size!==manifest.files.length)throw new Error('runtime_asset_manifest_invalid');
  for(const entry of manifest.files){
    if(path.isAbsolute(entry.path)||entry.path.split('/').includes('..'))throw new Error('runtime_asset_path_invalid');
    const filename=path.join(output,entry.path),actual=await realpath(filename);
    if(actual!==filename||!actual.startsWith(output+path.sep))throw new Error('runtime_asset_symlink_or_escape');
    const checked=await verifyAssetFile(filename,entry.sha256);
    if(checked.bytes!==entry.bytes)throw new Error('runtime_asset_size_mismatch');
  }
  const runtime=manifest.files.find(row=>row.path==='index.json');
  if(runtime?.sha256!==manifest.runtimeIndexSha256)throw new Error('runtime_index_binding_mismatch');
  const original=manifest.files.find(row=>row.path==='original-index.json');
  if(original?.sha256!==manifest.sourceIndexSha256)throw new Error('original_index_binding_mismatch');
  const index=JSON.parse(await readFile(path.join(output,'index.json'),'utf8'));
  const originalIndex=JSON.parse(await readFile(path.join(output,'original-index.json'),'utf8'));
  const expectedIndex=structuredClone(originalIndex);
  const requiredPaths=new Set(['index.json','original-index.json']);
  for(const row of expectedIndex.sources)for(const [field,hashField,extension]of [['sourceArtifact','sourceByteSha256','raw'],['bodyArtifact','bodySha256','txt']]){
    if(row[field]==null)continue;
    row[field]=`sources/${row[hashField]}.${extension}`;requiredPaths.add(row[field]);
  }
  if(JSON.stringify(index)!==JSON.stringify(expectedIndex))throw new Error('runtime_index_changed_original_source_semantics');
  if(index.schemaVersion!=='saitu.frozen-source-text.v1'||index.sources.length!==manifest.sourceCount)throw new Error('runtime_index_inventory_mismatch');
  const unavailable=index.sources.filter(row=>row.status!=='body_available_not_verified').map(row=>({sourceId:row.sourceId,url:row.url,status:row.status}));
  if(JSON.stringify(unavailable)!==JSON.stringify(manifest.unavailableSources))throw new Error('runtime_unknown_source_inventory_mismatch');
  for(const row of index.sources)for(const [field,hashField]of [['sourceArtifact','sourceByteSha256'],['bodyArtifact','bodySha256']]){
    if(row[field]==null){if(row.status==='body_available_not_verified')throw new Error('available_source_missing_original_bytes');continue;}
    const entry=manifest.files.find(file=>file.path===row[field]);
    if(!entry||entry.sha256!==row[hashField])throw new Error('runtime_source_dependency_missing');
  }
  if(manifest.e5!==null){
    const actual=await verifyLocalE5Assets(path.join(output,'e5-cache'));
    if(manifest.e5.model!==actual.model||manifest.e5.revision!==actual.revision||manifest.e5.assetLockSha256!==actual.assetLockSha256)throw new Error('runtime_model_lock_mismatch');
    for(const file of actual.files){
      const name=`e5-cache/${E5_MODEL}/${E5_REVISION}/${file.path}`;requiredPaths.add(name);
      if(!manifest.files.some(entry=>entry.path===name&&entry.sha256===file.sha256&&entry.bytes===file.bytes))throw new Error('runtime_model_dependency_missing');
    }
  }
  if(manifest.files.length!==requiredPaths.size||manifest.files.some(file=>!requiredPaths.has(file.path)))throw new Error('runtime_asset_closure_has_unreferenced_files');
  const result={verifiedFiles:manifest.files.length,bytes:manifest.files.reduce((sum,row)=>sum+row.bytes,0),sourceCount:manifest.sourceCount,acceptancePassed:false};
  async function inspect(directory){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const filename=path.join(directory,entry.name),relative=path.relative(output,filename);
      if(entry.isSymbolicLink())throw new Error('runtime_asset_symlink_or_escape');
      if(entry.isDirectory())await inspect(filename);
      else if(!entry.isFile()||!requiredPaths.has(relative)&&!['manifest.json','verification.json'].includes(relative))throw new Error('runtime_asset_unmanifested_file');
      else if(relative==='manifest.json'||relative==='verification.json'){
        const expected=relative==='manifest.json'?manifest:result;
        if(JSON.stringify(JSON.parse(await readFile(filename,'utf8')))!==JSON.stringify(expected))throw new Error('runtime_asset_metadata_mismatch');
      }
    }
  }
  await inspect(output);
  return result;
}

async function main(){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){if(!['--output','--root','--index','--e5-cache'].includes(args[i])||!args[i+1]||options[args[i]])throw new Error('runtime_asset_arguments_invalid');options[args[i]]=args[i+1];}
  if(!options['--output'])throw new Error('new_runtime_asset_output_required');
  const root=options['--root']??path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
  const output=path.resolve(options['--output']),cache=options['--e5-cache']??path.join(homedir(),'.cache/saitu/e5');
  // Verify every locked model asset before creating a candidate bundle. Never download here.
  const assets=await verifyLocalE5Assets(cache);
  const manifest=await packageRuntimeSources({root,indexPath:options['--index']??'artifacts/v6/content-research/frozen-source-text/index.json',output});
  for(const file of assets.files){
    const relative=`e5-cache/${E5_MODEL}/${E5_REVISION}/${file.path}`,destination=path.join(output,relative);
    await mkdir(path.dirname(destination),{recursive:true});
    await copyFile(path.join(cache,E5_MODEL,E5_REVISION,file.path),destination);
    await verifyAssetFile(destination,file.sha256);
    manifest.files.push({path:relative,sha256:file.sha256,bytes:file.bytes});
  }
  manifest.e5={...assets,cacheDirectory:'e5-cache'};
  manifest.files.sort((a,b)=>a.path.localeCompare(b.path));
  const verification=await verifyRuntimeAssetBundle(output,manifest);
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  await writeFile(path.join(output,'verification.json'),JSON.stringify(verification,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({output,...verification,unavailableSources:manifest.unavailableSources.length,e5Included:true}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
