#!/usr/bin/env node
/** Unified U. Independently freeze/check this complete package at launch. */
import {mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {controllerInventory,validateCandidateRecord} from '../../scripts/competitions/v6/final-candidate-binding.mjs';
import {verifyTree} from '../../scripts/competitions/v6/final-acceptance-binding.mjs';
import {digest,exact,fail,ordinary,physicalRoot,rawAt,rootPublicKey,runtimeInventory,sha,verifyDelivery} from '../../scripts/lib/release-evidence-v6-contract.mjs';
// Controller-only registration in its reviewed copy. No caller/env/test hook.
const TRUSTED_CANDIDATE_BINDINGS=Object.freeze([]);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const FLAGS=['record','product-record','candidate','evidence','reviews','verifier','engineering','delivery','runtime','output'];
function argumentsOf(argv){const out={};fail(argv.length===FLAGS.length*2,'unified_arguments_required');for(let i=0;i<argv.length;i+=2){const key=argv[i].slice(2);fail(argv[i]===`--${key}`&&FLAGS.includes(key)&&!Object.hasOwn(out,key)&&path.isAbsolute(argv[i+1]),'unified_unknown_argument');out[key]=path.resolve(argv[i+1]);}return out;}
function run(entry,args,cwd){return spawnSync(process.execPath,[entry,...args],{cwd,env:{NODE_ENV:'production',TZ:'UTC',LANG:'C',PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe'],encoding:'utf8',maxBuffer:32*1024**2,timeout:180000});}
function reason(error){return error instanceof Error&&/^[a-z0-9_]+$/.test(error.message)?error.message:'unified_input_invalid_or_unreadable';}
export function consumeCandidate(args){
 let controllerFiles=null,scratch=null;
 const base={schemaVersion:'saitu.v6-candidate-consumption.v1',v6CandidateAcceptancePassed:false,bindingValidated:false,productAcceptancePassed:false,engineeringAcceptancePassed:false,deliveryBindingValidated:false};
 try{
  fail(process.execArgv.length===0&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'unified_environment_injection');controllerFiles=controllerInventory(ROOT);
  physicalRoot(path.dirname(args.record));
  const bytes=ordinary(args.record).bytes,recordSha256=sha(bytes),pin=TRUSTED_CANDIDATE_BINDINGS.find(row=>row.recordSha256===recordSha256);
  if(!pin)return{...base,status:'pending',reason:'unified_independent_registration_required',controllerFiles,controllerSha256:digest(controllerFiles)};
  exact(pin,['recordSha256']);const record=JSON.parse(bytes),locations={...args,productRecord:args['product-record']};
  const before=validateCandidateRecord(record,locations,ROOT),nodeSha=sha(readFileSync(process.execPath)),runtimeBefore=digest(runtimeInventory(args.runtime));
  scratch=realpathSync(mkdtempSync(path.join(tmpdir(),'saitu-unified-')));const productOutput=path.join(scratch,'product.json');
  const product=run(path.join(ROOT,'product-k/ops/bin/verify-v6-product-evidence.mjs'),['--record',args['product-record'],...['candidate','evidence','reviews','verifier'].flatMap(key=>[`--${key}`,args[key]]),'--output',productOutput],ROOT);
  fail(!product.error&&!product.signal&&(product.status===0||product.status===1),'unified_product_process_failed');
  const productResult=JSON.parse(ordinary(productOutput).bytes);
  fail(productResult.schemaVersion==='saitu.final-product-consumption.v1'&&productResult.status!=='invalid','unified_product_invalid');
  fail(product.status!==0||productResult.productAcceptancePassed===true&&productResult.bindingValidated===true&&productResult.status==='passed','unified_product_success_inconsistent');
  const e=before.engineering,pins=record.deepScanPins;
  const engineering=run(path.join(ROOT,'ops/bin/verify-release-evidence.mjs'),['--evidence-dir',args.engineering,'--source-manifest',path.join(args.delivery,'source-manifest.txt'),'--source-mode-manifest-sha256',e.sourceModeManifestSha256,'--source-mode-member-count',String(e.sourceModeMemberCount),'--trusted-generation-attestation-sha256',pins.attestationSha256,'--trusted-generation-producer-sha256',pins.producerSha256,'--trusted-deep-scan-completion-sha256',pins.completionSha256],ROOT);
  const engineeringPassed=!engineering.error&&!engineering.signal&&engineering.status===0&&engineering.stdout===`${e.runId}\n`;
  const delivery=verifyDelivery(args.delivery,args.runtime,e,rootPublicKey());
  fail(delivery.runtimeSha256===runtimeBefore,'unified_runtime_changed_during_execution');
  const source=delivery.source;
  for(const [name,relative]of [['producer','scripts/lib/release-evidence-v6-delivery.mjs'],['contract','scripts/lib/release-evidence-v6-contract.mjs']])fail(source.some(row=>row.path===relative&&row.sha256===delivery.payload[name].sha256),'unified_delivery_producer_not_source');
  fail(delivery.payload.contract.sha256===rawAt(ROOT,'scripts/lib/release-evidence-v6-contract.mjs').sha256,'unified_delivery_contract_changed');
  const validation=JSON.parse(rawAt(args.engineering,'validation-result.json').bytes);
  fail(validation.toolchain?.node?.sha256===delivery.payload.node.sha256&&validation.toolchain?.pnpm?.sha256===delivery.payload.pnpmSha256,'unified_delivery_toolchain_mismatch');
  const after=validateCandidateRecord(record,locations,ROOT);verifyTree(ROOT,controllerFiles);
  fail(before.identities===after.identities&&ordinary(args.record).sha256===recordSha256&&sha(readFileSync(process.execPath))===nodeSha,'unified_input_changed_during_execution');
  const passed=product.status===0&&productResult.productAcceptancePassed===true&&engineeringPassed;
  return {...base,status:passed?'passed':'pending',reason:passed?null:'product_or_engineering_gates_not_passed',bindingValidated:true,productAcceptancePassed:product.status===0&&productResult.productAcceptancePassed===true,engineeringAcceptancePassed:engineeringPassed,deliveryBindingValidated:true,v6CandidateAcceptancePassed:passed,recordSha256,controllerFiles,controllerSha256:digest(controllerFiles),node:record.node,candidateSha256:before.candidateSha256,productResult,engineeringExecution:{exitCode:engineering.status,stdoutSha256:sha(engineering.stdout??''),stderrSha256:sha(engineering.stderr??'')},delivery:{attestationSha256:delivery.attestationSha256,runtimeSha256:delivery.runtimeSha256}};
 }catch(error){return{...base,status:'invalid',reason:reason(error),controllerFiles,controllerSha256:controllerFiles?digest(controllerFiles):null};}
 finally{if(scratch)rmSync(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const args=argumentsOf(process.argv.slice(2));physicalRoot(path.dirname(args.output));fail(![ROOT,...['candidate','evidence','reviews','verifier','engineering','delivery','runtime'].map(key=>args[key])].some(root=>args.output===root||args.output.startsWith(root+path.sep))&&args.output!==args.record&&args.output!==args['product-record'],'unified_output_overwrites_input');const result=consumeCandidate(args);writeFileSync(args.output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});process.exitCode=result.v6CandidateAcceptancePassed?0:1;}catch{process.stderr.write('unified_candidate_consumer_failed\n');process.exitCode=2;}}
