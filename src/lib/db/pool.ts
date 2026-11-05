import { Pool } from "pg";

// Singleton pg Pool. In Next.js dev, module reloads (HMR) would otherwise create a new
// Pool on every change and leak connections, so we cache it on globalThis.
const globalForPg = globalThis as unknown as { __pgPool?: Pool };
const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const LOCAL_POSTGRES_SOCKET_DIRECTORIES = new Set([
  "/run/postgresql",
  "/var/run/postgresql"
]);

function assertLocalDatabaseConnection(connectionString: string) {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }
  if (parsed.hash) throw new Error("DATABASE_URL must not contain a fragment.");
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("DATABASE_URL must contain a valid database name.");
  }
  if (!databaseName || databaseName.includes("/")) {
    throw new Error("DATABASE_URL must identify exactly one database.");
  }

  const socketDirectories = parsed.searchParams.getAll("host");
  if (socketDirectories.length > 0) {
    if (
      parsed.hostname || parsed.port || parsed.searchParams.size !== 1 ||
      socketDirectories.length !== 1 ||
      !LOCAL_POSTGRES_SOCKET_DIRECTORIES.has(socketDirectories[0]!)
    ) {
      throw new Error("DATABASE_URL must use the local PostgreSQL socket.");
    }
    return;
  }
  if (parsed.search || !LOCAL_DATABASE_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("DATABASE_URL must target the local PostgreSQL instance.");
  }
  if (parsed.port && parsed.port !== "5432") {
    throw new Error("DATABASE_URL must use the local PostgreSQL port 5432.");
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }
  assertLocalDatabaseConnection(connectionString);

  if (!globalForPg.__pgPool) {
    globalForPg.__pgPool = new Pool({
      connectionString,
      ssl: false,
      application_name: "resume-ai",
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // Security-state queries are intentionally short. Bound both the server
      // statement and client wait so a blocked row/advisory lock cannot retain
      // a Next worker or pool connection after the proxy has timed out.
      statement_timeout: 10_000,
      lock_timeout: 5_000,
      idle_in_transaction_session_timeout: 15_000,
      query_timeout: 12_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000
    });
  }
  return globalForPg.__pgPool;
}
