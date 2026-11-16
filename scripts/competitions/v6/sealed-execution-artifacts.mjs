import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import path from 'node:path';
import {sourceManifest} from './run-experiment.mjs';
import {canonicalHash} from './frozen-ranking-executor.mjs';
import {runtimeConfiguration} from './runtime-configuration.mjs';

async function write(directory,name,value){
 const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),handle=await open(path.join(directory,name),'wx',0o600);
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 return {path:name,sha256:createHash('sha256').update(bytes).digest('hex')};
}
async function capture(directory,repositoryRoot,phase){
 const result={implementation:null,runtime:null,implementationSha256:null,runtimeSha256:null,errors:[]};
 try{
  const files=await sourceManifest(repositoryRoot),implementationSha256=canonicalHash(files);
  result.implementation=await write(directory,`implementation-${phase}.json`,{implementationSha256,files});result.implementationSha256=implementationSha256;
 }catch{result.errors.push('implementation_snapshot_capture_failed');await write(directory,`implementation-${phase}-error.json`,{code:'implementation_snapshot_capture_failed'});}
 try{
  const configuration=runtimeConfiguration(),sha256=canonicalHash(configuration);
  result.runtime=await write(directory,`runtime-${phase}.json`,{sha256,configuration});result.runtimeSha256=sha256;
 }catch{
  // Never serialize arbitrary environment/error text, especially a rejected
  // URL containing credentials. The public whitelist is the only source.
  result.errors.push('public_runtime_snapshot_capture_failed');await write(directory,`runtime-${phase}-error.json`,{code:'public_runtime_snapshot_capture_failed'});
 }
 return result;
}

/** Real filesystem/public-runtime snapshots surround work even when it throws.
 * No supplied unchanged boolean or supplied source/runtime object is evidence. */
export async function withSealedExecutionArtifacts({directory,repositoryRoot,registration,registrationSha256},work){
 let before,after,value,failure,didThrow=false;
 try{
  before=await capture(directory,repositoryRoot,'before');
  if(before.errors.length)throw new Error('sealed_before_snapshot_failed');
  if(before.implementationSha256!==canonicalHash(registration.sourceManifest))throw new Error('source_changed_since_preregistration');
  if(before.runtimeSha256!==registration.runtimeConfigurationSha256||before.runtimeSha256!==canonicalHash(registration.runtimeConfiguration))throw new Error('runtime_changed_since_preregistration');
  value=await work();
 }catch(error){didThrow=true;failure=error;}
 finally{after=await capture(directory,repositoryRoot,'after');}
 const implementationUnchanged=Boolean(before?.implementationSha256&&before.implementationSha256===after.implementationSha256&&after.implementationSha256===canonicalHash(registration.sourceManifest));
 const runtimeConfigurationUnchanged=Boolean(before?.runtimeSha256&&before.runtimeSha256===after.runtimeSha256&&after.runtimeSha256===registration.runtimeConfigurationSha256);
 if(!didThrow&&(!implementationUnchanged||!runtimeConfigurationUnchanged||after.errors.length)){didThrow=true;failure=new Error('frozen_implementation_or_runtime_changed_during_sealed_execution');}
 const failureArtifact=didThrow?await write(directory,'execution-failure.json',{schemaVersion:'saitu.sealed-execution-failure.v1',code:'execution_or_integrity_failed',recordedAt:new Date().toISOString()}):null;
 const integrity={schemaVersion:'saitu.sealed-execution-integrity.v1',registrationSha256,configurationSha256:canonicalHash(registration.config),
  before:{implementation:before?.implementation??null,runtime:before?.runtime??null},after:{implementation:after.implementation,runtime:after.runtime},
  implementationUnchanged,runtimeConfigurationUnchanged,status:didThrow?'failed':'completed',failureArtifact};
 await write(directory,'execution-integrity.json',integrity);
 if(didThrow)throw failure;
 return {value,integrity};
}
