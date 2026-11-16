/** Synthetic keys and source only. Never install/pin these as actual evidence. */
import {generateKeyPairSync,sign} from 'node:crypto';
import {chmodSync,cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {canonical,CONTRACT,COORDINATOR,DELIVERY_DOMAIN,DELIVERY_PARENT,NODE_PATH,PNPM_PATH,PNPM_TOOLS_ROOT,PRODUCER,runtimeInventory,sha,SIGNING_PUBLIC_KEY} from '../../scripts/lib/release-evidence-v6-contract.mjs';
import {candidateInventory,treeInventory} from '../../scripts/competitions/v6/final-acceptance-binding.mjs';
import {U_MEMBERS} from '../../scripts/competitions/v6/final-candidate-binding.mjs';
import {PRUNE_ARGUMENTS} from '../../scripts/lib/release-evidence-v6-delivery.mjs';
export function candidateFixture(root){
 const dirs=Object.fromEntries(['candidate','evidence','reviews','verifier','engineering','delivery','runtime','controller'].map(name=>{const dir=path.join(root,name);mkdirSync(dir);return[name,dir];}));
 const put=(dir,name,bytes)=>{const target=path.join(dir,name);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,bytes);chmodSync(target,0o644);return {path:name,sha256:sha(bytes)};};
 for(const prefix of ['src','db','scripts','ops','public'])mkdirSync(path.join(dirs.candidate,prefix));
 for(const name of ['src/synthetic.ts','db/synthetic.sql','public/synthetic.txt','scripts/run-release-evidence.mjs','scripts/lib/release-evidence-v6-delivery.mjs','scripts/lib/release-evidence-v6-contract.mjs','ops/bin/verify-v6-candidate-evidence.mjs','package.json'])put(dirs.candidate,name,name==='package.json'?'{}':'// synthetic source only\n');
 const candidate=candidateInventory(dirs.candidate),source=Buffer.from(candidate.map(row=>`${row.sha256}\tF\t${row.path}\n`).join('')),modes=Buffer.from(candidate.map(row=>`0644\t${row.path}\n`).join(''));
 cpSync(dirs.candidate,dirs.runtime,{recursive:true});
 put(dirs.runtime,'.next/BUILD_ID','synthetic-real-shape-only\n');put(dirs.runtime,'.next/required-server-files.json',JSON.stringify({version:1,config:{distDir:'.next'},files:['.next/server.js']}));put(dirs.runtime,'.next/server.js','export default "SYNTHETIC";');put(dirs.runtime,'node_modules/next/package.json','{"version":"15.5.24"}');
 const runId='12121212-1212-4212-8212-121212121212',createdAt=new Date(Date.now()-2000).toISOString(),coordinatorSha256=candidate.find(row=>row.path==='scripts/run-release-evidence.mjs').sha256;
 const ep={runId,createdAt,sourceManifestSha256:sha(source),sourceModeManifestSha256:sha(modes),sourceModeMemberCount:candidate.length,producer:{path:COORDINATOR,sha256:coordinatorSha256}};
 const eBytes=JSON.stringify({payloadBase64:Buffer.from(JSON.stringify(ep)).toString('base64')});put(dirs.engineering,'linux-validation-attestation.json',eBytes);
 const engineering={...ep,coordinatorSha256,attestationSha256:sha(eBytes)};
 const {privateKey,publicKey}=generateKeyPairSync('ed25519'),publicBytes=publicKey.export({type:'spki',format:'pem'});
 const payload={domain:DELIVERY_DOMAIN,runId,generationRoot:`${DELIVERY_PARENT}/delivery-${runId}`,createdAt:new Date(Date.now()-1000).toISOString(),sourceManifestSha256:sha(source),sourceModeManifestSha256:sha(modes),sourceModeMemberCount:candidate.length,engineeringAttestationSha256:sha(eBytes),coordinatorSha256,producer:{path:PRODUCER,sha256:sha('synthetic')},contract:{path:CONTRACT,sha256:sha('synthetic')},node:{path:NODE_PATH,version:'v24.20.0',sha256:sha(readFileSync(process.execPath))},pnpmSha256:sha('synthetic pnpm'),pnpmClosure:{root:PNPM_TOOLS_ROOT,manifest:put(dirs.delivery,'pnpm-toolchain-manifest.json',JSON.stringify([{path:'node_modules/pnpm/bin/pnpm.mjs',kind:'F',sha256:sha('synthetic pnpm')},{path:'node_modules/pnpm/package.json',kind:'F',sha256:sha('synthetic package')}]))},runtimeManifest:put(dirs.delivery,'runtime-manifest.json',canonical(runtimeInventory(dirs.runtime))+'\n'),sourceManifest:put(dirs.delivery,'source-manifest.txt',source),sourceModes:put(dirs.delivery,'source-modes.txt',modes),prune:{command:[NODE_PATH,PNPM_PATH,...PRUNE_ARGUMENTS,'--store-dir=<generation-store>'],exitCode:0,log:put(dirs.delivery,'prune.log','SYNTHETIC exit0\n'),dependencies:put(dirs.delivery,'production-dependencies.json',JSON.stringify([{dependencies:{next:{version:'15.5.24'}}}]))},buildId:'synthetic-real-shape-only'};
 function resign(key=privateKey){const bytes=Buffer.from(canonical(payload)+'\n');const attestation={schemaVersion:DELIVERY_DOMAIN,algorithm:'Ed25519',publicKey:{path:SIGNING_PUBLIC_KEY,sha256:sha(publicBytes)},payloadBase64:bytes.toString('base64'),payloadSha256:sha(bytes),signatureBase64:sign(null,bytes,key).toString('base64')};put(dirs.delivery,'delivery-attestation.json',JSON.stringify(attestation));return attestation;}
 resign();
 for(const member of U_MEMBERS){const from=member.startsWith('product-k/')?member.slice('product-k/'.length):member;put(dirs.controller,member,readFileSync(path.join(process.cwd(),from)));}
 const productRecord=path.join(root,'product-record.json');writeFileSync(productRecord,JSON.stringify({candidateFiles:candidate}));
 const record={schemaVersion:'saitu.final-candidate-binding.v1',node:{version:process.version,sha256:sha(readFileSync(process.execPath))},productRecordSha256:sha(readFileSync(productRecord)),productControllerFiles:treeInventory(path.join(dirs.controller,'product-k')),engineeringVerifierSha256:sha(readFileSync(path.join(dirs.controller,'ops/bin/verify-release-evidence.mjs'))),engineeringFiles:treeInventory(dirs.engineering),deliveryFiles:treeInventory(dirs.delivery),deepScanPins:{attestationSha256:sha('synthetic attestation'),producerSha256:sha('synthetic producer'),completionSha256:sha('synthetic completion')}};
 const recordPath=path.join(root,'record.json');writeFileSync(recordPath,JSON.stringify(record));
 return {dirs,put,payload,engineering,publicBytes,privateKey,record,recordPath,productRecord,resign,locations:{...dirs,productRecord}};
}
