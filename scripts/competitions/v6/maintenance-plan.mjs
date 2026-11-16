import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { observeSource, proposeSourceChanges } from './discover-source-changes.mjs';
export function maintenanceTier(record, now, policy) {
 const time=now.valueOf();
 const close=record.milestones?.some(m=>['registration','submission'].includes(m.kind)&&['day','instant'].includes(m.date.precision)&&m.date.timezone&&m.date.value&&m.factIds.length&&m.factIds.every(id=>record.facts.some(f=>f.id===id&&f.status==='verified_current'&&f.sourceIds.length&&f.sourceIds.every(sid=>record.sources.some(s=>s.id===sid&&s.accessStatus==='body_read'))))&&Date.parse(m.date.value)+(m.date.precision==='day'?86400000:0)>=time&&Date.parse(m.date.value)-time<=policy.nearDeadlineDays*86400000);
 if(close)return 'near_deadline';
 if(['open','upcoming','unknown'].includes(record.registration.status)||record.facts.some(f=>f.status==='conflicting'))return 'active_or_unresolved';
 if(record.facts.some(f=>f.status==='verified_current'))return 'current_edition';
 return 'historical';
}
export function nextMaintenanceAt(lastChecked, tier, policy) {
 const date=new Date(lastChecked); if(!Number.isFinite(date.valueOf()))return null;
 const spec=policy.tiers[tier];
 if(spec.intervalHours)return new Date(date.valueOf()+spec.intervalHours*3600000).toISOString();
 const originalDay=date.getUTCDate(); date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+spec.intervalCalendarMonths);
 const maxDay=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(originalDay,maxDay));return date.toISOString();
}
export function planMaintenance(records, previous, now, policy) {
 const prior=new Map(previous.map(r=>[r.sourceId,r])),sources=new Map();
 for(const record of records){const tier=maintenanceTier(record,now,policy);for(const source of record.sources){
  const observation=prior.get(source.id),last=observation?.status==='observed'?observation.checkedAt:null;
  const next=last?nextMaintenanceAt(last,tier,policy):null;
  const existing=sources.get(source.id),row={sourceId:source.id,url:source.url,tier,recordIds:[record.recordId],lastSuccessfulObservation:last,nextCheckAt:next,due:!next||Date.parse(next)<=now.valueOf(),source};
  if(!existing)sources.set(source.id,row);else {row.recordIds=[...existing.recordIds,...row.recordIds];const priority=['near_deadline','active_or_unresolved','current_edition','historical'];sources.set(source.id,priority.indexOf(tier)<priority.indexOf(existing.tier)?row:{...existing,recordIds:row.recordIds});}
 }}
 return {generatedAt:now.toISOString(),productionEnabled:false,paidModelCalls:false,autoPublished:false,observationsAreNotFactVerification:true,sources:[...sources.values()].sort((a,b)=>Number(b.due)-Number(a.due)||String(a.nextCheckAt??'').localeCompare(String(b.nextCheckAt??'')))};
}
async function main(){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');const arg=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
 const policy=JSON.parse(await readFile(path.join(root,'src/content/competitions-v6/maintenance-policy.json'),'utf8'));
 const previous=arg('--previous')?JSON.parse(await readFile(path.resolve(arg('--previous')),'utf8')).observations:[];
 const now=new Date(arg('--as-of')??Date.now());if(!Number.isFinite(now.valueOf()))throw new Error('Invalid as-of date');
 const directory=path.resolve(root,arg('--output')??'artifacts/continuation-20261105/content/maintenance');
 const dependencies=createRequire(import.meta.resolve('vitest/package.json'));const {createServer}=await import(dependencies.resolve('vite'));
 const server=await createServer({root,optimizeDeps:{noDiscovery:true,entries:[]},configFile:false,logLevel:'error',appType:'custom',resolve:{alias:{'@':path.join(root,'src')}},server:{middlewareMode:true,watch:null}});
 try{const {getAuthoredDecisionCatalog}=await server.ssrLoadModule('/src/lib/competitions/v6/catalog.ts');const plan=planMaintenance(getAuthoredDecisionCatalog(),previous,now,policy);await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'plan.json'),JSON.stringify(plan,null,2)+'\n');
 if(process.argv.includes('--execute-due')){const selected=plan.sources.filter(s=>s.due).slice(0,policy.maximumSourcesPerManualRun),observations=[];for(let start=0;start<selected.length;start+=policy.maximumConcurrentFetches)observations.push(...await Promise.all(selected.slice(start,start+policy.maximumConcurrentFetches).map(row=>observeSource(row.source))));const recordIds=Object.fromEntries(selected.map(r=>[r.sourceId,r.recordIds]));await writeFile(path.join(directory,'observations.json'),JSON.stringify({generatedAt:new Date().toISOString(),observations,autoPublished:false},null,2)+'\n');await writeFile(path.join(directory,'review-proposals.json'),JSON.stringify({proposals:proposeSourceChanges(previous,observations,recordIds),autoPublished:false},null,2)+'\n');}
 console.log(JSON.stringify({sources:plan.sources.length,due:plan.sources.filter(s=>s.due).length,tiers:Object.fromEntries(Object.keys(policy.tiers).map(tier=>[tier,plan.sources.filter(s=>s.tier===tier).length])),directory,productionEnabled:false}));
 }finally{await server.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error);process.exitCode=1;});
