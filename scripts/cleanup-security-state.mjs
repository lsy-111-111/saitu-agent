#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { Pool } from "pg";

const CLEANUP_ADVISORY_LOCK = "724310896145222";
export const DEFAULT_CLEANUP_BATCH_SIZE = 500;
export const AI_CONSENT_RETENTION_DAYS = 180;
const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const LOCAL_POSTGRES_SOCKET_DIRECTORIES = new Set([
  "/run/postgresql",
  "/var/run/postgresql"
]);

export function assertLocalCleanupDatabaseUrl(connectionString) {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol");
  }
  if (parsed.hash) throw new Error("DATABASE_URL must not contain a fragment");
  let databaseName;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("DATABASE_URL must contain a valid database name");
  }
  if (!databaseName || databaseName.includes("/")) {
    throw new Error("DATABASE_URL must identify exactly one database");
  }
  const socketDirectories = parsed.searchParams.getAll("host");
  if (socketDirectories.length > 0) {
    if (
      parsed.hostname || parsed.port || parsed.searchParams.size !== 1 ||
      socketDirectories.length !== 1 ||
      !LOCAL_POSTGRES_SOCKET_DIRECTORIES.has(socketDirectories[0])
    ) {
      throw new Error("DATABASE_URL must use the local PostgreSQL socket");
    }
    return;
  }
  if (parsed.search || !LOCAL_DATABASE_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("DATABASE_URL must target the local PostgreSQL instance");
  }
  if (parsed.port && parsed.port !== "5432") {
    throw new Error("DATABASE_URL must use the local PostgreSQL port 5432");
  }
}

/**
 * This is a closed allowlist: the CLI never accepts a table name or predicate
 * from the environment or command line. Every operation removes only state
 * whose own expiry, reset time, or documented consent-audit retention has
 * elapsed.
 */
export const SECURITY_STATE_CLEANUP_OPERATIONS = Object.freeze([
  {
    name: "competition_idempotency",
    sql: `with expired as (
            select ctid from competition_idempotency
             where expires_at <= now()
             order by expires_at
             limit $1
          )
          delete from competition_idempotency target
           using expired
           where target.ctid = expired.ctid`
  },
  {
    name: "competition_session_transitions",
    sql: `with expired as (
            select ctid from competition_session_transitions
             where expires_at <= now()
             order by expires_at
             limit $1
          )
          delete from competition_session_transitions target
           using expired
           where target.ctid = expired.ctid`
  },
  {
    name: "competition_session_starts",
    sql: `with expired as (
            select ctid from competition_session_starts
             where expires_at <= now()
             order by expires_at
             limit $1
          )
          delete from competition_session_starts target
           using expired
           where target.ctid = expired.ctid`
  },
  {
    name: "competition_sessions",
    sql: `with expired as (
            select ctid from competition_sessions
             where expires_at <= now()
             order by expires_at
             limit $1
          )
          delete from competition_sessions target
           using expired
           where target.ctid = expired.ctid`
  },
  {
    name: "competition_rate_limit_counters",
    sql: `with expired as (
            select ctid from competition_rate_limit_counters
             where reset_at <= now()
             order by reset_at
             limit $1
          )
          delete from competition_rate_limit_counters target
           using expired
           where target.ctid = expired.ctid`
  },
  {
    name: "ai_model_call_leases",
    sql: `with expired as (
            select ctid from ai_model_call_leases
             where expires_at <= now()
             order by expires_at
             limit $1
          )
          delete from ai_model_call_leases target
           using expired
           where target.ctid = expired.ctid`
  },
  {
    name: "ai_model_call_waiters",
    sql: `with expired as (
            select ctid from ai_model_call_waiters
             where expires_at <= now()
             order by expires_at
             limit $1
          )
          delete from ai_model_call_waiters target
           using expired
           where target.ctid = expired.ctid`
  },
  {
    name: "ai_consents",
    sql: `with expired as (
            select ctid from ai_consents
             where created_at <= now() - ($2::integer * interval '1 day')
             order by created_at
             limit $1
          )
          delete from ai_consents target
           using expired
           where target.ctid = expired.ctid`,
    parameters: [AI_CONSENT_RETENTION_DAYS]
  }
]);

function assertBatchSize(batchSize) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 5_000) {
    throw new Error("Cleanup batch size must be an integer from 1 through 5000");
  }
}

async function pruneOperation(client, operation, batchSize) {
  let deleted = 0;
  while (true) {
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local statement_timeout = '30s'");
      const result = await client.query(operation.sql, [
        batchSize,
        ...(operation.parameters ?? [])
      ]);
      await client.query("commit");
      const rowCount = Number(result.rowCount ?? 0);
      deleted += rowCount;
      if (rowCount < batchSize) return deleted;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // Keep the original database failure as the command result.
      }
      throw error;
    }
  }
}

export async function cleanupSecurityState(
  client,
  { batchSize = DEFAULT_CLEANUP_BATCH_SIZE } = {}
) {
  assertBatchSize(batchSize);
  const lockResult = await client.query(
    "select pg_try_advisory_lock($1::bigint) as acquired",
    [CLEANUP_ADVISORY_LOCK]
  );
  if (lockResult.rows?.[0]?.acquired !== true) {
    return { status: "already_running", deleted: {} };
  }

  const deleted = {};
  try {
    for (const operation of SECURITY_STATE_CLEANUP_OPERATIONS) {
      deleted[operation.name] = await pruneOperation(client, operation, batchSize);
    }
    return { status: "ok", deleted };
  } finally {
    await client.query("select pg_advisory_unlock($1::bigint)", [CLEANUP_ADVISORY_LOCK]);
  }
}

async function runCli() {
  if (process.argv.length !== 2) {
    throw new Error("Usage: node scripts/cleanup-security-state.mjs");
  }
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required");
  assertLocalCleanupDatabaseUrl(connectionString);

  const pool = new Pool({
    connectionString,
    ssl: false,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000
  });
  let client;
  try {
    client = await pool.connect();
    const result = await cleanupSecurityState(client);
    console.info(JSON.stringify({ event: "security_state_cleanup", ...result }));
  } finally {
    client?.release();
    await pool.end();
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPoint) {
  runCli().catch(() => {
    // Do not echo connection strings, database errors, or row contents to logs.
    console.error(JSON.stringify({
      event: "security_state_cleanup",
      status: "failed",
      reason: "cleanup_failed"
    }));
    process.exitCode = 1;
  });
}
