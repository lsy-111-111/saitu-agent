import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sourceManifest} from '../../../scripts/competitions/v6/run-experiment.mjs';
import {canonicalHash} from '../../../scripts/competitions/v6/frozen-ranking-executor.mjs';
import {runtimeConfiguration,runtimeConfigurationHash} from '../../../scripts/competitions/v6/runtime-configuration.mjs';

test('execution freeze covers build configuration, CSS, loaders, aliases and public assets',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'saitu-source-binding-'));
  try{
    for(const name of ['src','db','scripts/lib','ops','public','tests/fixtures'])await mkdir(path.join(root,name),{recursive:true});
    const members=['next.config.mjs','tsconfig.json','scripts/lib/load-typescript-source.mjs','tests/fixtures/server-only.ts','src/styles.css','public/diagram.svg'];
    for(const member of members)await writeFile(path.join(root,member),'first');
    const before=await sourceManifest(root);
    assert.ok(members.every(member=>before.some(row=>row.path===member)));
    for(const member of members){await writeFile(path.join(root,member),'changed');assert.notEqual(canonicalHash(await sourceManifest(root)),canonicalHash(before));await writeFile(path.join(root,member),'first');}
  }finally{await rm(root,{recursive:true,force:true});}
});

test('runtime freezes public controls without recording credentials',()=>{
  const environment={AI_PROVIDER:'deepseek',AI_TIMEOUT_MS:'12000',AI_API_KEY:'test-secret',DATABASE_URL:'test-secret-db',AI_CONVERSATION_SIGNING_SECRET:'test-secret-signing'};
  assert.ok(!JSON.stringify(runtimeConfiguration(environment)).includes('test-secret'));
  assert.notEqual(runtimeConfigurationHash(environment),runtimeConfigurationHash({...environment,AI_TIMEOUT_MS:'45000'}));
  assert.throws(()=>runtimeConfiguration({...environment,AI_API_URL:'https://api.deepseek.com/chat?key=test-secret'}));
});
