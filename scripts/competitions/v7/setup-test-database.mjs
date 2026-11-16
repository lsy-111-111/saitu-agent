import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
const browser=process.argv.includes('--browser');
const databaseName=browser?'saitu_v7_browser_test':'saitu_v7_test';
const runtimeRole=browser?'saitu_v7_browser_runtime':'saitu_v7_test_runtime';
const directory=browser?'tmp/v7-browser-tests/private':'tmp/v7-tests/private',filename=`${directory}/database.json`;
const adminPassword=await readFile('tmp/postgres/private/admin-password','utf8');
const admin={host:'127.0.0.1',port:5432,user:'saitu_upgrade_admin',password:adminPassword,database:'saitu_upgrade'};
const client=new pg.Client(admin);await client.connect();
let credentials;
try{
  try{const mode=(await stat(filename)).mode;if(mode&0o077)throw new Error('unsafe_test_credentials');credentials=JSON.parse(await readFile(filename,'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(!credentials){
    if((await client.query("select 1 from pg_database where datname=$1",[databaseName])).rowCount)throw new Error('existing_test_database_without_owned_credentials');
    const password=randomBytes(32).toString('hex');
    await client.query(`create role ${runtimeRole} login nosuperuser nocreatedb nocreaterole password '${password}'`);
    await client.query(`create database ${databaseName} owner saitu_upgrade_admin`);
    credentials={runtime:`postgresql://${runtimeRole}:${password}@127.0.0.1:5432/${databaseName}`};
    await mkdir(directory,{recursive:true,mode:0o700});await writeFile(filename,JSON.stringify(credentials),{flag:'wx',mode:0o600});
  }
}finally{await client.end();}
const database=new pg.Client({...admin,database:databaseName});await database.connect();
try{
  await database.query('begin');
  await database.query(await readFile('db/schema.sql','utf8'));
  for(const name of ['20261105_ai_spend_ledger.sql','20261105_decision_states.sql','20261105_spend_authority.sql','20261106_ai_spend_development_batches.sql','20261106_ai_spend_development_effort.sql','20261109_decision_runs.sql','20261109_decision_runs_chat_requests.sql','20261109_spend_v7_batches.sql'])await database.query(await readFile(`db/migrations/${name}`,'utf8'));
  await database.query(`revoke all on all tables in schema public from ${runtimeRole}; grant usage on schema public to ${runtimeRole}`);
  for(const line of (await readFile('ops/postgresql/runtime-table-privileges.conf','utf8')).split('\n')){
    if(!line.trim()||line.startsWith('#'))continue;
    const match=/^([a-z_]+)=((?:SELECT|INSERT|UPDATE)(?:,(?:SELECT|INSERT|UPDATE))*)$/.exec(line);if(!match)throw new Error('invalid_runtime_privilege');
    await database.query(`grant ${match[2]} on ${match[1]} to ${runtimeRole}`);
  }
  await database.query(`grant select,insert,update on competition_decision_runs,competition_decision_calls,competition_decision_chat_requests to ${runtimeRole}`);
  for(const line of (await readFile('ops/postgresql/runtime-function-privileges.conf','utf8')).split('\n')){
    if(!line.trim()||line.startsWith('#'))continue;
    const match=/^([a-z_]+)=([a-z,]*)$/.exec(line);if(!match)throw new Error('invalid_runtime_function_privilege');
    await database.query(`grant execute on function public.${match[1]}(${match[2]}) to ${runtimeRole}`);
  }
  await database.query('commit');
  console.log(JSON.stringify({database:databaseName,runtimeNoDdl:true,paidCalls:0}));
}catch(error){await database.query('rollback');throw error;}finally{await database.end();}
