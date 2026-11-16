import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,open,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceManifest} from './run-experiment.mjs';
import {canonicalHash} from './frozen-ranking-executor.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--output')throw new Error('usage_verify_continuation_output_NEW_DIRECTORY');
  const output=path.resolve(args[1]);await mkdir(output,{recursive:false});
  const asOf=new Date().toISOString(),source=await sourceManifest(root),sourceSha256=canonicalHash(source);
  async function testManifest(){
    const files=[];
    async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){
      const filename=path.join(directory,entry.name);
      if(entry.isSymbolicLink())throw new Error('symlink_in_test_manifest');
      if(entry.isDirectory())await walk(filename);
      else if(entry.isFile()&&entry.name!=='.DS_Store')files.push({path:path.relative(root,filename),sha256:createHash('sha256').update(await readFile(filename)).digest('hex')});
    }}
    await walk(path.join(root,'tests'));return files.sort((a,b)=>a.path.localeCompare(b.path));
  }
  const testInputs=await testManifest(),testInputsSha256=canonicalHash(testInputs);
  const write=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  await write('source-before.json',{sourceSha256,files:source});
  await write('tests-before.json',{testInputsSha256,files:testInputs});
  const gates=[],environment={...process.env,AI_API_KEY:'',RUN_DEEPSEEK_LIVE:'0',CAPTURE_COMPETITION_PROSPECTIVE_BASELINE:'0',NEXT_DIST_DIR:'.next-continuation'};
  async function run(id,argv){
    const log=await open(path.join(output,`${id}.log`),'wx',0o600),startedAt=new Date().toISOString();
    const result=await new Promise(resolve=>{
      const child=spawn(process.execPath,argv,{cwd:root,env:environment,stdio:['ignore',log.fd,log.fd]});
      child.once('error',error=>resolve({exitCode:null,error:error.code??'spawn_error'}));
      child.once('exit',(exitCode,signal)=>resolve({exitCode,signal}));
    });await log.close();
    const gate={id,command:[process.execPath,...argv],startedAt,finishedAt:new Date().toISOString(),...result,status:result.exitCode===0?'passed':'failed',log:`${id}.log`};
    gates.push(gate);console.log(JSON.stringify({gate:id,status:gate.status,exitCode:gate.exitCode}));
  }
  const nodeTests=[];
  async function discover(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const filename=path.join(directory,entry.name);if(entry.isDirectory())await discover(filename);else if(entry.isFile()&&entry.name.endsWith('.test.mjs'))nodeTests.push(filename);}}
  await discover(path.join(root,'tests'));
  await run('typecheck',['node_modules/typescript/bin/tsc','--noEmit','--incremental','false']);
  await run('lint',['node_modules/eslint/bin/eslint.js','.','--max-warnings=0']);
  await run('node-tests',['--test',...nodeTests.sort()]);
  await run('vitest',['node_modules/vitest/vitest.mjs','run','--reporter=json',`--outputFile=${path.join(output,'vitest.json')}`]);
  await run('production-build',['node_modules/next/dist/bin/next','build']);
  await run('coverage',['scripts/competitions/v6/evaluate-coverage-cli.mjs','--as-of',asOf,'--output',path.join(output,'coverage.json')]);
  await run('catalog',['scripts/competitions/v6/catalog-audit.mjs','--as-of',asOf,'--output',path.join(output,'catalog'),'--coverage',path.relative(root,path.join(output,'coverage.json'))]);
  let unit=null,coverage=null,catalog=null;
  try{const v=JSON.parse(await readFile(path.join(output,'vitest.json')));unit={passed:v.numPassedTests,failed:v.numFailedTests,skipped:v.numPendingTests,total:v.numTotalTests};}catch{}
  try{coverage=JSON.parse(await readFile(path.join(output,'coverage.json'))).measuredCoverage.overall;}catch{}
  try{catalog=JSON.parse(await readFile(path.join(output,'catalog/catalog-audit.json'))).summary;}catch{}
  const after=await sourceManifest(root),sourceUnchanged=canonicalHash(after)===sourceSha256;
  const testsAfter=await testManifest(),testsUnchanged=canonicalHash(testsAfter)===testInputsSha256;
  await write('source-after.json',{sourceSha256:canonicalHash(after),files:after});
  await write('tests-after.json',{testInputsSha256:canonicalHash(testsAfter),files:testsAfter});
  const result={schemaVersion:'saitu.continuation-free-verification.v1',asOf,sourceSha256,sourceUnchanged,testInputsSha256,testsUnchanged,gates,unit,coverage,catalog,
    paidModelCallsAuthorized:false,productAcceptance:false,productionDeployed:false,
    pending:['sealed800_and_formal_1800_matrix','independent_content_and_coverage_acceptance','real_pg_and_x64_required_gate_revalidation','real_model_browser_performance','12_pilot_and_60_simulated_product_comparisons','positive_source_update_and_rollback','signed_release_evidence_and_30min_soak'],
    limitation:'Free engineering checks preserve all failures and skips. A green command is not product acceptance; outputs are invalid for final source binding if sourceUnchanged or testsUnchanged is false.'};
  await write('summary.json',result);
  if(!sourceUnchanged||!testsUnchanged||gates.some(g=>g.status!=='passed'))process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
