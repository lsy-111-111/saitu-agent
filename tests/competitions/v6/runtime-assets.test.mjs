import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {packageRuntimeSources,verifyRuntimeAssetBundle} from '../../../scripts/competitions/v6/package-runtime-assets.mjs';
import {verifyLocalE5Assets,E5_MODEL,E5_REVISION} from '../../../scripts/competitions/v6/local-e5.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const publicDirectory='artifacts/v6/content-research/source-byte-snapshots/';
const indexPath='artifacts/v6/content-research/frozen-source-text/index.json';
async function fixture(work){
  const root=await mkdtemp(path.join(tmpdir(),'saitu-assets-'));
  try{
    await mkdir(path.join(root,publicDirectory),{recursive:true});await mkdir(path.dirname(path.join(root,indexPath)),{recursive:true});
    await writeFile(path.join(root,publicDirectory,'source.html'),'<h1>Official task fixture</h1>');
    await writeFile(path.join(root,publicDirectory,'body.txt'),'Official task fixture');
    const row={sourceId:'test-only',url:'https://example.org/rules',status:'body_available_not_verified',sourceArtifact:publicDirectory+'source.html',sourceByteSha256:sha('<h1>Official task fixture</h1>'),bodyArtifact:publicDirectory+'body.txt',bodySha256:sha('Official task fixture')};
    const index={schemaVersion:'saitu.frozen-source-text.v1',sources:[row,{sourceId:'unknown',url:'https://example.org/missing',status:'metadata_only',sourceArtifact:null,sourceByteSha256:null}]};
    const save=()=>writeFile(path.join(root,indexPath),JSON.stringify(index));await save();
    await work({root,index,row,save,output:path.join(root,'bundle')});
  }finally{await rm(root,{recursive:true,force:true});}
}
test('runtime bundle preserves unknown sources and remains readable after original files are removed',async()=>fixture(async f=>{
  const manifest=await packageRuntimeSources({root:f.root,indexPath,output:f.output});
  assert.equal(manifest.sourceCount,2);assert.equal(manifest.unavailableSources.length,1);
  await rm(path.join(f.root,f.row.sourceArtifact));await rm(path.join(f.root,f.row.bodyArtifact));
  const index=JSON.parse(await readFile(path.join(f.output,'index.json'),'utf8'));
  assert.equal(await readFile(path.join(f.output,index.sources[0].bodyArtifact),'utf8'),'Official task fixture');
  assert.equal((await verifyRuntimeAssetBundle(f.output,manifest)).verifiedFiles,4);
  await assert.rejects(verifyRuntimeAssetBundle(f.output,{...manifest,files:manifest.files.filter(file=>file.path!==index.sources[0].bodyArtifact)}),/dependency_missing/);
  await writeFile(path.join(f.output,index.sources[0].bodyArtifact),'tampered');
  await assert.rejects(verifyRuntimeAssetBundle(f.output,manifest),/hash_mismatch/);
}));
test('missing bytes, traversal, secrets, symlinks and changed source hashes fail closed',async()=>{
  for(const kind of ['missing','traversal','secret','symlink','hash','conflict'])await fixture(async f=>{
    if(kind==='missing')await rm(path.join(f.root,f.row.bodyArtifact));
    if(kind==='traversal')f.row.bodyArtifact='../outside';
    if(kind==='secret')f.row.bodyArtifact='.env.local';
    if(kind==='symlink'){await symlink(path.join(f.root,f.row.bodyArtifact),path.join(f.root,publicDirectory,'link.txt'));f.row.bodyArtifact=publicDirectory+'link.txt';}
    if(kind==='hash')f.row.bodySha256='0'.repeat(64);
    if(kind==='conflict')f.row.conflictingVersions=[{origin:'synthetic_fault_injection'}];
    await f.save();await assert.rejects(packageRuntimeSources({root:f.root,indexPath,output:f.output}));
  });
});
test('public capture roots do not allow private, sealed, credential or secret-named artifacts',async()=>{
  for(const relative of ['questions-private/data.txt','sealed800/data.txt','secrets.json','.git/credentials','PRIVATE.json','auth.json','password.key'])await fixture(async f=>{
    const name=publicDirectory+relative;await mkdir(path.dirname(path.join(f.root,name)),{recursive:true});
    await writeFile(path.join(f.root,name),'dummy private fixture only');
    f.row.bodyArtifact=name;f.row.bodySha256=sha('dummy private fixture only');await f.save();
    await assert.rejects(packageRuntimeSources({root:f.root,indexPath,output:f.output}),/not_public_relative/);
  });
});
test('rebinding runtime hashes cannot remove unknown rows or change source semantics',async()=>{
  for(const kind of ['drop_unknown','change_status','drop_available','extra_file'])await fixture(async f=>{
    const manifest=await packageRuntimeSources({root:f.root,indexPath,output:f.output});
    const runtime=JSON.parse(await readFile(path.join(f.output,'index.json'),'utf8'));
    if(kind==='extra_file')await writeFile(path.join(f.output,'dummy-secrets.txt'),'dummy only');
    else {
      if(kind==='drop_unknown')runtime.sources.pop();
      if(kind==='drop_available')runtime.sources.shift();
      if(kind==='change_status')runtime.sources[1].status='body_available_not_verified';
      const bytes=JSON.stringify(runtime,null,2)+'\n';await writeFile(path.join(f.output,'index.json'),bytes);
      Object.assign(manifest.files.find(file=>file.path==='index.json'),{sha256:sha(bytes),bytes:Buffer.byteLength(bytes)});
      manifest.runtimeIndexSha256=sha(bytes);manifest.sourceCount=runtime.sources.length;
    }
    await assert.rejects(verifyRuntimeAssetBundle(f.output,manifest),/unmanifested_file|changed_original_source_semantics/);
  });
});
test('a model namespace symlink cannot redirect locked asset reads outside the cache',async()=>fixture(async f=>{
  const cache=path.join(f.root,'model-cache'),outside=path.join(f.root,'outside-model');
  await mkdir(path.join(outside,E5_MODEL.split('/')[1],E5_REVISION),{recursive:true});await mkdir(cache);
  await writeFile(path.join(outside,E5_MODEL.split('/')[1],E5_REVISION,'config.json'),'dummy model config');
  await symlink(outside,path.join(cache,E5_MODEL.split('/')[0]));
  await assert.rejects(verifyLocalE5Assets(cache),/parent_symlink_rejected/);
}));
