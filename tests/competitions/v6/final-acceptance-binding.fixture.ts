/** SYNTHETIC ONLY: test-only K pins below are never written into actual K. */
import {cpSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {rawScoringFixture} from './acceptance-raw-scoring.fixture';
const {candidateInventory,treeInventory,identityHash,sha256}=createRequire(import.meta.url)('../../../scripts/competitions/v6/final-acceptance-binding.mjs');
const kFiles=['ops/bin/verify-v6-product-evidence.mjs','scripts/competitions/v6/final-acceptance-binding.mjs','scripts/competitions/v6/final-acceptance-worker.mjs'];
const vFiles=['acceptance-gate.ts','acceptance-artifact-derivation.ts','select-development-baseline.mjs','state-obligation-audit.ts','reason-audit.ts','fact-claim-audit.ts','constraint-audit.ts','profile-gold.ts','profile-atom-metrics.ts','reviewer-agreement.ts','ranking-batches.mjs','acceptance-raw-scoring.ts','evaluate-rankings.ts','score-product-observations.ts','ranking-reuse.mjs','frozen-ranking-executor.mjs','experiment-registration.mjs','runtime-configuration.mjs','product-performance.mjs'].map(file=>'scripts/competitions/v6/'+file).concat(['src/lib/competitions/v6/contracts.ts','tests/fixtures/spend-ledger-baseline-20261105.json']);
export function finalBindingFixture(root:string){
 const dirs=Object.fromEntries(['candidate','evidence','reviews','verifier','controller','output'].map(name=>{const dir=path.join(root,name);mkdirSync(dir);return[name,dir];}));
 for(const dir of ['src','db','scripts/competitions/v6','ops','public'])mkdirSync(path.join(dirs.candidate,dir),{recursive:true});
 writeFileSync(path.join(dirs.candidate,'src/synthetic.ts'),'export const syntheticCandidate = true;\n');
 writeFileSync(path.join(dirs.candidate,'scripts/competitions/v6/acceptance-gate.ts'),'// Entire candidate includes its original acceptance script, unchanged.\n');
 const candidateFiles=candidateInventory(dirs.candidate);
 const f=rawScoringFixture(dirs.evidence,candidateFiles);
 for(const row of candidateFiles){const dest=path.join(dirs.evidence,row.path);mkdirSync(path.dirname(dest),{recursive:true});cpSync(path.join(dirs.candidate,row.path),dest);}
 const ref=(name:string,value:unknown)=>f.write(name,value);
 const runtime=f.write('performance-runtime.json',{runtimeConfigurationSha256:identityHash(f.runtime),configuration:f.runtime});
 const buildFile=f.write('synthetic-build-original.json',{syntheticOnly:true});
 const build=ref('performance-build.json',{buildId:'SYNTHETIC-NOT-A-PRODUCTION-BUILD',files:[{...buildFile,sourcePath:'.next-performance/synthetic-build-original.json'}]});
 const performance=ref('performance-envelope.json',{schemaVersion:'saitu.acceptance-browser-performance-evidence.v1',runtimeConfigurationBefore:runtime,buildArtifacts:build,registration:ref('performance-registration.json',{implementationSha256:identityHash(candidateFiles),runtimeConfigurationSha256:identityHash(f.runtime)})});
 const snapshot=ref('synthetic-ledger.json',{syntheticOnly:true,noFinancialClaim:true});
 const budget=ref('budget-envelope.json',{schemaVersion:'saitu.acceptance-ledger-budget-evidence.v1',snapshot});
 f.data.budgetEvidence=budget;
 for(const id of ['firstScreenP95Ms','fullReportP95Ms'])f.data.metrics[id]={value:null,denominator:0,evidenceClass:'real_product',evidencePath:performance.path,evidenceSha256:performance.sha256};
 const input=ref('acceptance.json',f.data);
 const copy=(name:string,to:string)=>{mkdirSync(path.dirname(path.join(to,name)),{recursive:true});cpSync(path.join(process.cwd(),name),path.join(to,name));};
 for(const name of kFiles)copy(name,dirs.controller);
 for(const name of vFiles)copy(name,dirs.verifier);
 writeFileSync(path.join(dirs.verifier,'package.json'),JSON.stringify({name:'saitu-reviewed-verifier',private:true,type:'module'}));
 mkdirSync(path.join(dirs.verifier,'node_modules'));
 cpSync(realpathSync(path.join(process.cwd(),'node_modules/zod')),path.join(dirs.verifier,'node_modules/zod'),{recursive:true,dereference:true});
 const recordPath=path.join(root,'control-record.json');
 let controllerApproval: {path:string;sha256:string}[]=[];
 const refresh=(pin=true)=>{
  const evidenceFiles=treeInventory(dirs.evidence),verifierFiles=treeInventory(dirs.verifier);
  const report={schemaVersion:'saitu.final-product-independent-review.v1',mode:'ai_proxy',status:'approved',candidateSha256:identityHash(candidateFiles),evidenceSha256:identityHash(evidenceFiles),verifierSha256:identityHash(verifierFiles),isolation:'separate_contexts_shared_filesystem',contexts:['TEST-ONLY-SYNTHETIC-NOT-APPROVAL-A','TEST-ONLY-SYNTHETIC-NOT-APPROVAL-B']};
  writeFileSync(path.join(dirs.reviews,'synthetic-review.json'),JSON.stringify(report));
  const record={schemaVersion:'saitu.final-product-binding.v1',candidateFiles,evidenceFiles,verifierFiles,reviewFiles:treeInventory(dirs.reviews),node:{version:process.version,sha256:sha256(readFileSync(process.execPath))},input,review:{path:'synthetic-review.json',sha256:sha256(readFileSync(path.join(dirs.reviews,'synthetic-review.json')))},rawScoring:f.data.rawScoringEvidence,catalog:{path:'catalog-snapshot.json',sha256:sha256(readFileSync(path.join(dirs.evidence,'catalog-snapshot.json')))},rankingRuntime:{path:'runtime-configuration.json',sha256:sha256(readFileSync(path.join(dirs.evidence,'runtime-configuration.json')))},performance:{evidence:performance,runtime,build},budget:{evidence:budget,snapshot}};
  writeFileSync(recordPath,JSON.stringify(record));
  const original=readFileSync(path.join(process.cwd(),kFiles[0]),'utf8');
  // Changes a temporary copied K only. There is no production callable hook.
  writeFileSync(path.join(dirs.controller,kFiles[0]),pin?original.replace('const TRUSTED_FINAL_BINDINGS = Object.freeze([]);',`const TRUSTED_FINAL_BINDINGS = Object.freeze([{recordSha256:${JSON.stringify(sha256(readFileSync(recordPath)))}}]);`):original);
  controllerApproval=treeInventory(dirs.controller);
  return record;
 };
 const record=refresh();
 return {dirs,f,record,recordPath,refresh,get controllerApproval(){return controllerApproval;},entry:path.join(dirs.controller,kFiles[0]),worker:path.join(dirs.controller,kFiles[2])};
}
