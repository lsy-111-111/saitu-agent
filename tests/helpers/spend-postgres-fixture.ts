import {randomUUID} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import pg from "pg";
/** Administrator-created disposable database. Never mutates authority in the application's DB. */
export async function createSpendPostgresFixture(){
 const adminUrl=process.env.AI_SPEND_TEST_ADMIN_DATABASE_URL,runtimeUrl=process.env.DATABASE_URL;
 if(!adminUrl||!runtimeUrl)throw Error("explicit_local_spend_test_admin_and_runtime_required");
 for(const value of [adminUrl,runtimeUrl])if(!["127.0.0.1","localhost"].includes(new URL(value).hostname))throw Error("local_test_database_only");
 const database=`saitu_spend_test_${randomUUID().replaceAll("-","")}`,role=decodeURIComponent(new URL(runtimeUrl).username);
 if(!/^[A-Za-z0-9_]+$/.test(role))throw Error("invalid_runtime_role");
 const host=new pg.Client({connectionString:adminUrl});await host.connect();await host.query(`create database "${database}"`);
 const adminConnection=new URL(adminUrl);adminConnection.pathname=`/${database}`;const admin=new pg.Client({connectionString:adminConnection.toString()});await admin.connect();
 for(const name of (await readdir("db/migrations")).filter(n=>n.endsWith(".sql")).sort())await admin.query(await readFile(`db/migrations/${name}`,"utf8"));
 await admin.query(`grant usage on schema public to "${role}";grant select,insert,update on all tables in schema public to "${role}";revoke all on ai_spend_budgets,ai_spend_authority,ai_spend_development_batches from "${role}";grant select on ai_spend_budgets,ai_spend_authority,ai_spend_development_batches to "${role}";grant execute on all functions in schema public to "${role}"`);
 const globals=globalThis as unknown as {__pgPool?:pg.Pool};if(globals.__pgPool)await globals.__pgPool.end();delete globals.__pgPool;
 const runtime=new URL(runtimeUrl);runtime.pathname=`/${database}`;process.env.DATABASE_URL=runtime.toString();
 return {admin,database,async bind(runId:string,cap=300000000){await admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,$2)",[runId,cap]);await admin.query("delete from ai_spend_authority");await admin.query("insert into ai_spend_authority(singleton,run_id) values(true,$1)",[runId]);},async close(){if(globals.__pgPool)await globals.__pgPool.end();delete globals.__pgPool;await admin.end();await host.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()",[database]);await host.query(`drop database "${database}"`);await host.end();}};
}
