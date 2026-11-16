import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

/** The signed coordinator supplies a private-network PostgreSQL namespace.
 * Local development retains the existing private-file fixture. Never accept an
 * application database or an arbitrary caller-selected database for these DDL tests. */
export function validateV7TestDatabaseUrls(adminValue: string, runtimeValue: string, external: boolean) {
  let admin: URL, runtime: URL;
  try { admin = new URL(adminValue); runtime = new URL(runtimeValue); }
  catch { throw new Error("v7_test_database_urls_invalid"); }
  for (const value of [admin, runtime]) {
    if (!["postgres:", "postgresql:"].includes(value.protocol)
      || !["127.0.0.1", "localhost", "[::1]"].includes(value.hostname)
      || (value.port && value.port !== "5432") || value.search || value.hash)
      throw new Error("v7_test_database_requires_local_isolated_endpoint");
  }
  if (admin.hostname !== runtime.hostname || (admin.port || "5432") !== (runtime.port || "5432")
    || admin.pathname !== runtime.pathname || !admin.username || !runtime.username || admin.username === runtime.username)
    throw new Error("v7_test_database_endpoint_or_role_mismatch");
  const database = decodeURIComponent(admin.pathname.slice(1)), role = decodeURIComponent(runtime.username);
  if (external) {
    const match = /^resume_ai_test_([a-f0-9]{16})$/.exec(database);
    if (!match || decodeURIComponent(admin.username) !== "postgres" || role !== `resume_ai_test_runtime_${match[1]}`)
      throw new Error("v7_test_database_requires_coordinator_namespace");
  } else if (database !== "saitu_v7_test" || decodeURIComponent(admin.username) !== "saitu_upgrade_admin" || !/^[A-Za-z0-9_]+$/.test(role)) {
    throw new Error("v7_test_database_requires_local_development_fixture");
  }
  return { adminUrl: admin.toString(), runtimeUrl: runtime.toString(), database, role };
}

export function v7TestDatabaseEnvironment() {
  const admin = process.env.V7_TEST_ADMIN_DATABASE_URL?.trim(), runtime = process.env.V7_TEST_RUNTIME_DATABASE_URL?.trim();
  if (admin || runtime) {
    if (!admin || !runtime || process.env.RUN_V7_DATABASE_TESTS !== "1") throw new Error("v7_test_database_explicit_pair_required");
    if ([admin, runtime].includes(process.env.DATABASE_URL?.trim() || "")) throw new Error("v7_test_database_must_not_use_application_database");
    return validateV7TestDatabaseUrls(admin, runtime, true);
  }
  const local = JSON.parse(readFileSync("tmp/v7-tests/private/database.json", "utf8"));
  const adminUrl = new URL("postgresql://saitu_upgrade_admin@127.0.0.1:5432/saitu_v7_test");
  adminUrl.password = readFileSync("tmp/postgres/private/admin-password", "utf8");
  return validateV7TestDatabaseUrls(adminUrl.toString(), local.runtime, false);
}

/** All schema/ACL mutations happen only in a new random database. */
export async function createV7TestDatabase(label: "backend" | "durable") {
  const environment = v7TestDatabaseEnvironment();
  const database = `saitu_v7_${label}_${randomUUID().replaceAll("-", "")}`;
  const host = new pg.Client({ connectionString: environment.adminUrl });
  let admin: pg.Client | undefined, created = false;
  async function close() {
    await admin?.end();
    if (created) {
      await host.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [database]);
      await host.query(`drop database "${database}"`); created = false;
    }
    await host.end();
  }
  try {
    await host.connect();
    const identity = (await host.query("select current_database() as database,current_user as role")).rows[0];
    if (identity.database !== environment.database || identity.role !== decodeURIComponent(new URL(environment.adminUrl).username))
      throw new Error("v7_test_database_admin_identity_mismatch");
    const role = (await host.query("select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=$1", [environment.role])).rows[0];
    if (!role || Object.values(role).some(Boolean)) throw new Error("v7_test_database_runtime_is_privileged");
    await host.query(`create database "${database}"`); created = true;
    const adminUrl = new URL(environment.adminUrl); adminUrl.pathname = `/${database}`;
    admin = new pg.Client({ connectionString: adminUrl.toString() }); await admin.connect();
    await admin.query(readFileSync("db/schema.sql", "utf8"));
    for (const line of readFileSync("ops/config/migrations.manifest", "utf8").split("\n")) {
      if (!line.trim() || line.startsWith("#")) continue;
      const [, name] = line.split(/\s+/);
      if (!/^[a-zA-Z0-9_]+\.sql$/.test(name)) throw new Error("v7_test_database_invalid_migration");
      await admin.query(readFileSync(`db/migrations/${name}`, "utf8"));
    }
    // PostgreSQL14's PUBLIC defaults must not grant the runtime schema CREATE
    // or database TEMP. Scope this hardening to our newly created database.
    await admin.query("revoke create on schema public from public");
    await admin.query(`revoke create,temporary on database "${database}" from public`);
    await admin.query(`grant usage on schema public to "${environment.role}"`);
    for (const line of readFileSync("ops/postgresql/runtime-table-privileges.conf", "utf8").split("\n")) {
      if (!line.trim() || line.startsWith("#")) continue;
      const match = /^([a-z_]+)=((?:SELECT|INSERT|UPDATE)(?:,(?:SELECT|INSERT|UPDATE))*)$/.exec(line);
      if (!match) throw new Error("v7_test_database_invalid_table_privilege");
      await admin.query(`grant ${match[2]} on ${match[1]} to "${environment.role}"`);
    }
    for (const line of readFileSync("ops/postgresql/runtime-function-privileges.conf", "utf8").split("\n")) {
      if (!line.trim() || line.startsWith("#")) continue;
      const match = /^([a-z_]+)=([a-z,]*)$/.exec(line);
      if (!match) throw new Error("v7_test_database_invalid_function_privilege");
      await admin.query(`grant execute on function public.${match[1]}(${match[2]}) to "${environment.role}"`);
    }
    const runtime = new URL(environment.runtimeUrl); runtime.pathname = `/${database}`;
    return { admin, runtimeUrl: runtime.toString(), database, close };
  } catch (error) { await close().catch(() => undefined); throw error; }
}
