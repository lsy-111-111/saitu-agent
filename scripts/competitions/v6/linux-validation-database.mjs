import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
if(process.platform!=='linux')throw Error('Linux validation VM only');
const privateDir=join(homedir(),'saitu-validation','private');
if(existsSync(join(privateDir,'database.json')))throw Error('Validation database is already configured; refusing to rotate existing credentials.');
const adminPassword=randomBytes(24).toString('hex'),runtimePassword=randomBytes(24).toString('hex');
const sql=`DO $$BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='saitu_test_admin') THEN CREATE ROLE saitu_test_admin LOGIN SUPERUSER; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='saitu_test_runtime') THEN CREATE ROLE saitu_test_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF; END$$; ALTER ROLE saitu_test_admin PASSWORD '${adminPassword}'; ALTER ROLE saitu_test_runtime PASSWORD '${runtimePassword}'; SELECT 'CREATE DATABASE saitu_linux_test OWNER saitu_test_admin' WHERE NOT EXISTS(SELECT FROM pg_database WHERE datname='saitu_linux_test')\n\\gexec\n`;
const psql=process.arch==='x64'?'/usr/bin/psql':'/opt/postgresql/14.24/bin/psql';
const setup=spawnSync('sudo',['-n','-u','postgres',psql,'-v','ON_ERROR_STOP=1','-d','postgres'],{input:sql,encoding:'utf8'});
if(setup.status!==0)throw Error('VM-only PostgreSQL roles setup failed; no credentials logged');
const url=(user,password)=>`postgresql://${user}:${password}@127.0.0.1:5432/saitu_linux_test`;
const credentials={admin:url('saitu_test_admin',adminPassword),runtime:url('saitu_test_runtime',runtimePassword)};
mkdirSync(privateDir,{recursive:true,mode:0o700});writeFileSync(join(privateDir,'database.json'),JSON.stringify(credentials),{mode:0o600,flag:'wx'});
const client=new pg.Client({connectionString:credentials.admin});await client.connect();
await client.query(readFileSync('db/schema.sql','utf8'));
const migrations=readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort();
for(const name of migrations)await client.query(readFileSync('db/migrations/'+name,'utf8'));
await client.query('grant connect on database saitu_linux_test to saitu_test_runtime; grant usage on schema public to saitu_test_runtime; revoke all on all tables in schema public from saitu_test_runtime; grant execute on all functions in schema public to saitu_test_runtime');
for(const line of readFileSync('ops/postgresql/runtime-table-privileges.conf','utf8').split('\n')){
 if(!line.trim()||line.startsWith('#'))continue;
 const match=/^([a-z_]+)=((?:SELECT|INSERT|UPDATE)(?:,(?:SELECT|INSERT|UPDATE))*)$/.exec(line);
 if(!match)throw Error('Invalid validation runtime table policy');
 await client.query(`grant ${match[2]} on public.${match[1]} to saitu_test_runtime`);
}
console.log(JSON.stringify({database:'saitu_linux_test',serverVersion:(await client.query('show server_version')).rows[0].server_version,migrations:migrations.length,credentialsPrinted:false}));await client.end();
