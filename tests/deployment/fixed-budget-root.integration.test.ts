import {describe,it,expect} from "vitest";
import {mkdtemp,writeFile,chmod,chown,symlink,link,rm} from "node:fs/promises";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {randomUUID} from "node:crypto";
// @ts-expect-error Standalone trusted control module.
import {assertRootControlled} from "../../scripts/lib/release-evidence-spend.mjs";
const integration=process.platform==="linux"&&process.getuid?.()===0?describe:describe.skip;
integration("real Linux root ownership boundary; synthetic files and no provider",()=>{
 it("accepts a protected executable and rejects replaceable ancestors, owner, hardlinks and service mode",async()=>{
  const directory=await mkdtemp("/opt/saitu-fixed-budget-boundary-");try{
   await chmod(directory,0o700);const service=path.join(directory,"pg_service.conf");await writeFile(service,"[synthetic-only]\nhost=127.0.0.1\n",{mode:0o600});
   expect(await assertRootControlled(service,{privateFile:true})).toBe(service);
   await chmod(service,0o644);await expect(assertRootControlled(service,{privateFile:true})).rejects.toThrow();await chmod(service,0o600);
   await chmod(directory,0o777);await expect(assertRootControlled(service,{privateFile:true})).rejects.toThrow();await chmod(directory,0o700);
   await chown(service,65534,65534);await expect(assertRootControlled(service,{privateFile:true})).rejects.toThrow();await chown(service,0,0);
   const alias=path.join(directory,"alias.conf");await symlink(service,alias);expect(await assertRootControlled(alias,{privateFile:true})).toBe(service);
   const duplicate=path.join(directory,"duplicate.conf");await link(service,duplicate);await expect(assertRootControlled(service,{privateFile:true})).rejects.toThrow();await rm(duplicate);
   const exe=path.join(directory,"psql");await writeFile(exe,"#!/bin/sh\nexit 0\n",{mode:0o755});expect(await assertRootControlled(exe,{executable:true})).toBe(exe);await chmod(exe,0o644);await expect(assertRootControlled(exe,{executable:true})).rejects.toThrow();
  }finally{await rm(directory,{recursive:true,force:true});}
 });
 it("transports only the synthetic permit through real systemd credentials while denying its root original",async()=>{
  const directory=await mkdtemp("/run/saitu-fixed-budget-credential-");try{
   await chmod(directory,0o700);const credential=path.join(directory,"permit");await writeFile(credential,"synthetic-permit-no-api-key",{mode:0o400});
   const unit=`saitu-fixed-budget-${randomUUID()}`;
   const program=`const fs=require('node:fs');const assert=require('node:assert/strict');assert.equal(fs.readFileSync(process.env.CREDENTIALS_DIRECTORY+'/budget-permit','utf8'),'synthetic-permit-no-api-key');assert.throws(()=>fs.readFileSync(${JSON.stringify(credential)}));assert.notEqual(process.getuid(),0);console.log('credential-boundary-ok');`;
   const result=await promisify(execFile)("/usr/bin/systemd-run",["--quiet","--wait","--collect","--pipe","--service-type=exec",`--unit=${unit}`,"--property=User=nobody","--property=Group=nogroup","--property=PrivateNetwork=yes","--property=ProtectSystem=strict","--property=ProtectHome=yes","--property=NoNewPrivileges=yes","--property=CapabilityBoundingSet=",`--property=LoadCredential=budget-permit:${credential}`,"/usr/bin/env","-i",`PATH=/usr/bin:/bin`,`CREDENTIALS_DIRECTORY=/run/credentials/${unit}.service`,process.execPath,"-e",program],{timeout:20000});
   expect(result.stdout).toContain("credential-boundary-ok");
  }finally{await rm(directory,{recursive:true,force:true});}
 });
});
