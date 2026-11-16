/** U's byte bindings; all decisions remain in fixed K / engineering consumers. */
import {lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {candidateInventory,identityHash,treeInventory,verifyTree} from './final-acceptance-binding.mjs';
import {canonical,exact,fail,ordinary,physicalRoot,rawAt,sha,sourceRows,verifySource} from '../../lib/release-evidence-v6-contract.mjs';
export const U_MEMBERS=[
 'ops/bin/verify-v6-candidate-evidence.mjs','ops/bin/verify-release-evidence.mjs',
 'scripts/competitions/v6/final-candidate-binding.mjs','scripts/competitions/v6/final-acceptance-binding.mjs',
 'scripts/lib/release-evidence-v6-contract.mjs',
 'product-k/ops/bin/verify-v6-product-evidence.mjs','product-k/scripts/competitions/v6/final-acceptance-binding.mjs','product-k/scripts/competitions/v6/final-acceptance-worker.mjs'
].sort();
export function controllerInventory(root){const files=treeInventory(root);fail(canonical(files.map(row=>row.path))===canonical(U_MEMBERS),'unified_controller_complete_separate_package_required');return files;}
export function validateCandidateRecord(record,locations,controllerRoot){
 exact(record,['schemaVersion','node','productRecordSha256','productControllerFiles','engineeringVerifierSha256','engineeringFiles','deliveryFiles','deepScanPins']);
 fail(record.schemaVersion==='saitu.final-candidate-binding.v1','unified_record_schema');exact(record.node,['version','sha256']);
 fail(record.node.version===process.version&&record.node.sha256===sha(readFileSync(process.execPath)),'unified_node_changed');
 const roots=Object.fromEntries(['candidate','evidence','reviews','verifier','engineering','delivery','runtime'].map(key=>[key,physicalRoot(locations[key])]));
 const all=[controllerRoot,...Object.values(roots)];fail(all.every((a,i)=>all.every((b,j)=>i===j||a!==b&&!a.startsWith(b+path.sep)&&!b.startsWith(a+path.sep))),'unified_roots_not_separate');
 physicalRoot(path.dirname(locations.productRecord));
 fail(ordinary(locations.productRecord).sha256===record.productRecordSha256,'unified_product_record_changed');
 verifyTree(path.join(controllerRoot,'product-k'),record.productControllerFiles);
 fail(rawAt(controllerRoot,'ops/bin/verify-release-evidence.mjs').sha256===record.engineeringVerifierSha256,'unified_engineering_verifier_changed');
 verifyTree(roots.engineering,record.engineeringFiles);verifyTree(roots.delivery,record.deliveryFiles);
 exact(record.deepScanPins,['attestationSha256','producerSha256','completionSha256']);
 fail(Object.values(record.deepScanPins).every(value=>/^[a-f0-9]{64}$/.test(value)),'unified_deep_scan_pins_required');
 const source=rawAt(roots.delivery,'source-manifest.txt').bytes,modes=rawAt(roots.delivery,'source-modes.txt').bytes;
 verifySource(roots.candidate,source,modes);const sourceList=sourceRows(source),candidate=candidateInventory(roots.candidate),runtimeCandidate=candidateInventory(roots.runtime);
 fail(canonical(candidate)===canonical(runtimeCandidate)&&candidate.every(row=>sourceList.some(file=>file.path===row.path&&file.sha256===row.sha256)),'unified_delivery_not_product_candidate');
 // K sees complete C including every acceptance/ops/script member. Engineering
 // additionally binds all source files (tests/docs etc), never just this projection.
 const productRecord=JSON.parse(ordinary(locations.productRecord).bytes);
 fail(canonical(productRecord.candidateFiles)===canonical(candidate),'unified_product_source_mismatch');
 const attestation=rawAt(roots.engineering,'linux-validation-attestation.json');
 const signed=JSON.parse(attestation.bytes),payload=JSON.parse(Buffer.from(signed.payloadBase64,'base64'));
 // This is binding, NOT signature approval. The unchanged fixed engineering CLI
 // must subsequently verify signature, raw gates, source, age and Deep Scan.
 fail(payload.sourceManifestSha256===sha(source)&&payload.sourceModeManifestSha256===sha(modes)&&payload.sourceModeMemberCount===sourceList.length,'unified_engineering_source_mismatch');
 const coordinator=sourceList.find(row=>row.path==='scripts/run-release-evidence.mjs');
 fail(coordinator&&payload.producer?.sha256===coordinator.sha256,'unified_coordinator_source_mismatch');
 const ids=Object.fromEntries(all.map(root=>{const s=lstatSync(root);return[root,{dev:s.dev,ino:s.ino}];}));
 return {roots,identities:identityHash(ids),candidateSha256:identityHash(candidate),engineering:{createdAt:payload.createdAt,runId:payload.runId,sourceManifestSha256:sha(source),sourceModeManifestSha256:sha(modes),sourceModeMemberCount:sourceList.length,attestationSha256:attestation.sha256,coordinatorSha256:coordinator.sha256}};
}
