import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const production=path.join(root,'src/content/competitions-v6/active-snapshot.json');
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const before=digest(await readFile(production));
const id=`continuation-${new Date().toISOString().replace(/[^0-9]/g,'')}`;
const directory=path.join(root,'artifacts/continuation-20261105/content/snapshot-drill',id);
await mkdir(path.join(directory,'candidates'),{recursive:true});
const active=path.join(directory,'active-snapshot.json');await writeFile(active,'null\n',{flag:'wx'});
const initial=await readFile(active);const actions=[];
for(const action of ['stage','activate','rollback']){
 const result=spawnSync(process.execPath,['scripts/competitions/v6/catalog-snapshot.mjs',action,id],{cwd:root,env:{...process.env,SAITU_CATALOG_SNAPSHOT_PATH:active,SAITU_CATALOG_SNAPSHOT_DIRECTORY:path.join(directory,'candidates')},encoding:'utf8',maxBuffer:16*1024*1024});
 await writeFile(path.join(directory,`${action}.log`),`${result.stdout}\n${result.stderr}`);
 actions.push({action,exitCode:result.status,log:path.relative(root,path.join(directory,`${action}.log`)),activeChanged:!initial.equals(await readFile(active))});
 // On a real successful activation, stop: there is no earlier approved real snapshot to roll back to.
 if(action==='activate'&&result.status===0)break;
}
const after=digest(await readFile(production));
const summary={schemaVersion:'saitu.isolated-catalog-drill.v1',generatedAt:new Date().toISOString(),directory,productionActivePath:production,productionBeforeSha256:before,productionAfterSha256:after,productionUnchanged:before===after,actions,limitation:'真实作者候选在隔离路径经过门槛，缺审时activate/rollback应拒绝。拒绝演练不等于完成可发布快照的成功回退；未伪造审查以打通链路。',paidCalls:0};
await writeFile(path.join(directory,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
if(before!==after||actions[0].exitCode!==0)process.exitCode=1;
