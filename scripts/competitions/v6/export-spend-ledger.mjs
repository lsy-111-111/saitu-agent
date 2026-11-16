import nextEnv from '@next/env';
import {Pool} from 'pg';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Read-only, complete ledger evidence. Aggregate totals alone cannot establish
// that historical reservations survived a later run or budget change.
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--output')throw new Error('new_output_directory_required');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
  nextEnv.loadEnvConfig(root,false,{info(){},error(){}});
  if(!process.env.DATABASE_URL||!process.env.AI_SPEND_RUN_ID)throw new Error('existing_ledger_configuration_required');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:3000});
  const client=await pool.connect();
  try{
    await client.query('begin isolation level repeatable read read only');
    await client.query("set local statement_timeout='10000ms'");
    const authority=(await client.query('select singleton,run_id,created_at from ai_spend_authority order by run_id')).rows;
    const budgets=(await client.query('select run_id,hard_limit_micros::text,created_at from ai_spend_budgets order by run_id')).rows;
    const ledger=(await client.query(`select id::text,run_id,model,effort,phase,operation,price_version,
      reserved_micros::text,charged_micros::text,state,input_tokens::text,output_tokens::text,
      cached_input_tokens::text,created_at,settled_at from ai_spend_ledger order by created_at,id`)).rows;
    const observedAt=(await client.query('select transaction_timestamp() as observed_at')).rows[0].observed_at;
    await client.query('commit');
    if(authority.length!==1||authority[0].singleton!==true||authority[0].run_id!==process.env.AI_SPEND_RUN_ID)throw new Error('authorized_main_run_mismatch');
    const snapshot={schemaVersion:'saitu.spend-ledger-snapshot.v1',observedAt,runId:process.env.AI_SPEND_RUN_ID,
      configuration:{hardLimitCny:Number(process.env.AI_SPEND_LIMIT_CNY),fundedLimitCny:Number(process.env.AI_SPEND_FUNDED_CNY)},
      transaction:'repeatable_read_read_only',authority,budgets,ledger,
      priceBasis:'conservative_peak_price_estimate_not_provider_invoice',paidCallsInThisCommand:0,
      limitation:'Unsigned local database evidence; an independent acceptance consumer must verify history continuity, dispatch linkage and the approved authority.'};
    const output=path.resolve(args[1]);await mkdir(output,{recursive:false});
    const raw=JSON.stringify(snapshot,null,2)+'\n';
    await writeFile(path.join(output,'ledger.json'),raw,{flag:'wx',mode:0o600});
    const rows=ledger.filter(row=>row.run_id===snapshot.runId),sum=rows.reduce((total,row)=>total+BigInt(row.charged_micros??row.reserved_micros),0n);
    const manifest={schemaVersion:'saitu.spend-ledger-export.v1',observedAt,
      files:[{path:'ledger.json',sha256:createHash('sha256').update(raw).digest('hex')}],
      mainRunCalls:rows.length,otherRunCalls:ledger.length-rows.length,accountedMicros:sum.toString(),
      unknownUsageCalls:rows.filter(row=>['reserved','conservative'].includes(row.state)).length,
      releasedReservationsInThisCommand:0,paidCallsInThisCommand:0};
    await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({output,...manifest}));
  }finally{await client.query('rollback').catch(()=>{});client.release();await pool.end();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(typeof error.code==='string'?error.code:'ledger_export_failed');process.exitCode=1;});
