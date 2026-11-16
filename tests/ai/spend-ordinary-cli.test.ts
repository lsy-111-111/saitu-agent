import {it,expect} from "vitest";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
it("ordinary requestAiJson CLI cannot bypass authority merely by setting NODE_ENV=test",async()=>{
 const program=`import {installSourceLoader} from './scripts/lib/load-typescript-source.mjs';installSourceLoader();const {requestAiJson}=await import('./src/lib/ai/ai-client.ts');const {z}=await import('zod');let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected upstream');};const result=await requestAiJson('synthetic',{schema:z.object({}),maxAttempts:1,maxTokens:128});console.log(JSON.stringify({result,calls}));`;
 const result=await promisify(execFile)(process.execPath,["--input-type=module","-e",program],{cwd:process.cwd(),env:{PATH:process.env.PATH??"",NODE_ENV:"test",AI_PROVIDER:"deepseek",AI_API_KEY:"synthetic-only-key",AI_REASONING_EFFORT:"max"},maxBuffer:100000});
 const output=JSON.parse(result.stdout.trim().split("\n").at(-1)!);expect(output.calls).toBe(0);expect(output.result).toMatchObject({ok:false,upstreamAttempted:false,reason:"spend_configuration_invalid"});
// A real child Node process under the x64 validation VM can take over five
// seconds to start. This bounds test setup, not an upstream request deadline.
},30_000);
