import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetitionQuestionnaireV1 } from "../../src/types/competition-recommendation";

const enabled = process.env.RUN_POSTGRES_SECURITY_STATE_TESTS === "1";
const integrationDescribe = enabled ? describe : describe.skip;
const originalEnv = { ...process.env };
let adminPool: Pool;
let runtimeProbePool: Pool;
let runtimeRole = "";
const applicationPools = new Set<Pool>();

const SHARED_NAT_NEXT_PORT = 3111;
const SHARED_NAT_NGINX_PORT = 3112;
const SHARED_NAT_WAVE_INTERVAL_MS = 10_000;
const SHARED_NAT_SESSION_COUNT = 50;
const SHARED_NAT_SIGNING_SECRET =
  "shared-nat-full-stack-signing-secret-000000000000000000000000";
const SHARED_NAT_CONSENT_SALT =
  "shared-nat-full-stack-consent-salt-0000000000000000000000000";
const SHARED_NAT_LOG_HASH_SECRET =
  "shared-nat-full-stack-log-hash-secret-00000000000000000000000";
const SHARED_NAT_RATE_HASH_SALT =
  "shared-nat-full-stack-rate-hash-salt-0000000000000000000000";
const SHARED_NAT_CONSENT_VERSION = "2026-08-26.v5";
const CHILD_DIAGNOSTIC_LIMIT_BYTES = 64 * 1024;

type BoundedOutput = {
  bytes: Buffer;
  totalBytes: number;
};

type ManagedChild = {
  child: ChildProcess;
  label: string;
  stdout: BoundedOutput;
  stderr: BoundedOutput;
  spawnError: Error | null;
};

type SharedNatQuestion = {
  options: Array<{ value: string }>;
};

type SharedNatJourney = {
  index: number;
  questionnaireToken: string;
  conversationToken: string;
  sessionId: string;
  nextQuestion: SharedNatQuestion | null;
  dynamicQuestionCount: number;
};

function appendBounded(output: BoundedOutput, chunk: Buffer | string) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  output.totalBytes += bytes.byteLength;
  output.bytes = Buffer.concat([output.bytes, bytes]);
  if (output.bytes.byteLength > CHILD_DIAGNOSTIC_LIMIT_BYTES) {
    output.bytes = output.bytes.subarray(
      output.bytes.byteLength - CHILD_DIAGNOSTIC_LIMIT_BYTES
    );
  }
}

function spawnManaged(
  label: string,
  executable: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
) {
  const stdout: BoundedOutput = { bytes: Buffer.alloc(0), totalBytes: 0 };
  const stderr: BoundedOutput = { bytes: Buffer.alloc(0), totalBytes: 0 };
  const managed: ManagedChild = {
    child: spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    }),
    label,
    stdout,
    stderr,
    spawnError: null
  };
  managed.child.stdout?.on("data", (chunk: Buffer) => appendBounded(stdout, chunk));
  managed.child.stderr?.on("data", (chunk: Buffer) => appendBounded(stderr, chunk));
  managed.child.on("error", (error) => { managed.spawnError = error; });
  return managed;
}

function waitForChildExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((resolveExit) => {
    const completed = () => {
      clearTimeout(timer);
      child.off("exit", completed);
      resolveExit(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", completed);
      resolveExit(false);
    }, timeoutMs);
    child.once("exit", completed);
  });
}

async function stopManaged(managed: ManagedChild | null) {
  if (!managed) return true;
  if (managed.child.exitCode !== null || managed.child.signalCode !== null) return true;
  managed.child.kill("SIGTERM");
  if (await waitForChildExit(managed.child, 5_000)) return true;
  managed.child.kill("SIGKILL");
  return waitForChildExit(managed.child, 5_000);
}

function redactChildDiagnostic(value: string) {
  let redacted = value;
  for (const secret of [
    SHARED_NAT_SIGNING_SECRET,
    SHARED_NAT_CONSENT_SALT,
    SHARED_NAT_LOG_HASH_SECRET,
    SHARED_NAT_RATE_HASH_SALT
  ]) {
    redacted = redacted.replaceAll(secret, "[REDACTED_SYNTHETIC_SECRET]");
  }
  redacted = redacted
    .replaceAll(/postgres(?:ql)?:\/\/[^\s"'<>]+/giu, "[REDACTED_DATABASE_URL]")
    .replaceAll(/[A-Za-z0-9_-]{80,}\.[A-Za-z0-9_-]{40,}/gu, "[REDACTED_SIGNED_TOKEN]");
  return redacted.split("\n").map((line) =>
    /questionnaire|conversationToken|selectedValues|freeText|"answer"/iu.test(line)
      ? "[REDACTED_SENSITIVE_LOG_LINE]"
      : line
  ).join("\n");
}

function childDiagnostic(managed: ManagedChild | null) {
  if (!managed) return "not started";
  const describe = (output: BoundedOutput) => {
    const prefix = output.totalBytes > output.bytes.byteLength ? "[tail truncated]\n" : "";
    return `${prefix}${redactChildDiagnostic(output.bytes.toString("utf8"))}`.trim();
  };
  return [
    `${managed.label} exit=${managed.child.exitCode ?? "running"} signal=${managed.child.signalCode ?? "none"}`,
    `stdout: ${describe(managed.stdout) || "<empty>"}`,
    `stderr: ${describe(managed.stderr) || "<empty>"}`,
    ...(managed.spawnError ? [`spawn: ${managed.spawnError.message}`] : [])
  ].join("\n");
}

function nginxQuote(value: string) {
  if (/[\0\r\n]/u.test(value)) throw new Error("Nginx fixture path contains a forbidden byte");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function sharedNatQuestionnaire(): CompetitionQuestionnaireV1 {
  return {
    version: "competition-questionnaire.v1",
    answers: [
      { fieldId: "stage", selectedValues: ["stage:undergraduate-2"] },
      {
        fieldId: "majorFields",
        selectedValues: [
          "majorFields:computer-science",
          "majorFields:engineering",
          "specificSubjects:information-communication",
          "specificSubjects:robotics-automation"
        ]
      },
      {
        fieldId: "skills",
        selectedValues: ["skills:programming", "skills:hardware", "skills:presentation"]
      },
      { fieldId: "interests", selectedValues: ["interests:ai", "interests:innovation"] },
      { fieldId: "taskFormats", selectedValues: ["taskFormats:software", "taskFormats:hardware"] },
      { fieldId: "goals", selectedValues: ["goals:project", "goals:employment"] },
      {
        fieldId: "preferredOutputs",
        selectedValues: ["preferredOutputs:software", "preferredOutputs:prototype"]
      },
      { fieldId: "startingPoint", selectedValues: ["startingPoint:coursework"] },
      {
        fieldId: "experienceLevel",
        selectedValues: ["experienceLevel:participated", "evidence:project", "evidence:prototype"]
      },
      { fieldId: "weeklyCommitment", selectedValues: ["weeklyCommitment:5-10"] },
      { fieldId: "participationTiming", selectedValues: ["participationTiming:flexible"] },
      { fieldId: "teamStatus", selectedValues: ["teamStatus:looking"] },
      { fieldId: "availableResources", selectedValues: ["availableResources:mentor"] },
      { fieldId: "participationMode", selectedValues: ["participationMode:flexible"] }
    ]
  };
}

function signedTokenPayload(token: string, expectedVersion: string) {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Server returned a malformed ${expectedVersion} token`);
  }
  const signature = Buffer.from(parts[1], "base64url");
  const expected = createHmac("sha256", SHARED_NAT_SIGNING_SECRET)
    .update(parts[0])
    .digest();
  if (
    signature.byteLength !== expected.byteLength ||
    Buffer.from(signature).toString("base64url") !== parts[1] ||
    !timingSafeEqual(signature, expected)
  ) {
    throw new Error(`Server returned an invalid ${expectedVersion} signature`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    throw new Error(`Server returned an undecodable ${expectedVersion} payload`);
  }
  if (!payload || typeof payload !== "object" || (payload as { version?: unknown }).version !== expectedVersion) {
    throw new Error(`Server returned the wrong signed token version; expected ${expectedVersion}`);
  }
  return payload as Record<string, unknown>;
}

function buildSharedNatNginxConfig(input: {
  fixtureRoot: string;
  accessLog: string;
  nginxGlobal: string;
  nginxQuota: string;
  proxyCommon: string;
  transportSecurity: string;
}) {
  const clientTemp = join(input.fixtureRoot, "client-temp");
  const proxyTemp = join(input.fixtureRoot, "proxy-temp");
  const pid = join(input.fixtureRoot, "nginx.pid");
  for (const directory of [clientTemp, proxyTemp]) mkdirSync(directory, { mode: 0o700 });
  const quotaInclude = `include ${nginxQuote(input.nginxQuota)};`;
  const proxyInclude = `include ${nginxQuote(input.proxyCommon)};`;
  const location = (path: string) => `
        location = ${path} {
            ${quotaInclude}
            proxy_buffering off;
            proxy_read_timeout 75s;
            proxy_pass http://shared_nat_next;
        }`;
  const config = `
pid ${nginxQuote(pid)};
error_log stderr notice;
worker_processes 1;

events {
    worker_connections 4096;
}

http {
    include ${nginxQuote(input.nginxGlobal)};
    client_body_temp_path ${nginxQuote(clientTemp)};
    proxy_temp_path ${nginxQuote(proxyTemp)};
    access_log ${nginxQuote(input.accessLog)} resume_ai_json;

    upstream shared_nat_next {
        server 127.0.0.1:${SHARED_NAT_NEXT_PORT};
        keepalive 64;
    }

    server {
        listen 127.0.0.1:${SHARED_NAT_NGINX_PORT};
        server_name 127.0.0.1;
        error_log stderr crit;
        limit_req_log_level info;
        include ${nginxQuote(input.transportSecurity)};
        ${proxyInclude}
        error_page 429 = @shared_nat_gateway_rate_limited;

        location = /__resume_ai_quota_generation {
            access_log off;
            default_type text/plain;
            return 200 "$resume_ai_quota_generation\\n";
        }
${location("/api/competitions/recommend/normalize")}
${location("/api/ai/competition-clarify")}
${location("/api/ai/competition-recommend")}

        location @shared_nat_gateway_rate_limited {
            include ${nginxQuote(input.transportSecurity)};
            default_type application/json;
            add_header Retry-After "1" always;
            add_header X-RateLimit-Source "gateway" always;
            add_header Cache-Control "no-store" always;
            return 429 '{"ok":false,"error":"RATE_LIMITED","retryAfter":1,"source":"gateway","bucket":"ip-minute","requestId":"$request_id"}';
        }
    }
}
`;
  if (config.split(quotaInclude).length - 1 !== 3) {
    throw new Error("Every recommendation endpoint must directly include the same generated quota file");
  }
  if (
    config.split(proxyInclude).length - 1 !== 1 ||
    config.split("proxy_buffering off;").length - 1 !== 3
  ) {
    throw new Error("The shared proxy contract must be inherited once with response buffering disabled per endpoint");
  }
  return config;
}

function nextProductionEnvironment(runtimeUrl: string): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    LANG: "C.UTF-8",
    TZ: "UTC",
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_DIST_DIR: ".next",
    DATABASE_URL: runtimeUrl,
    FEATURE_AI: "1",
    FEATURE_COMPETITION_RECOMMENDER: "1",
    AI_PROVIDER: "mock",
    AI_MODEL: "mock",
    AI_TEST_MODE: "1",
    ALLOW_AI_MOCK: "1",
    NEXT_PUBLIC_AI_TEST_MODE: "1",
    E2E_ALLOW_EPHEMERAL_SECURITY_STATE: "0",
    AI_CONVERSATION_SIGNING_SECRET: SHARED_NAT_SIGNING_SECRET,
    AI_CONSENT_SALT: SHARED_NAT_CONSENT_SALT,
    LOG_HASH_SECRET: SHARED_NAT_LOG_HASH_SECRET,
    RATE_LIMIT_HASH_SALT: SHARED_NAT_RATE_HASH_SALT,
    SESSION_STARTS_PER_IP_MINUTE: "60",
    SESSION_STARTS_PER_IP_DAY: "600",
    SESSION_TRANSITIONS_PER_SESSION: "12",
    SESSION_TTL_SECONDS: "1800",
    AI_CONCURRENCY_MAX: "8",
    AI_QUEUE_MAX: "32",
    AI_QUEUE_WAIT_MS: "15000",
    AI_MODEL_CALLS_PER_DAY: "1200",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: ""
  };
}

async function waitForHttpReady(url: string, managed: ManagedChild, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (managed.spawnError) throw new Error(`${managed.label} failed to spawn`);
    if (managed.child.exitCode !== null || managed.child.signalCode !== null) {
      throw new Error(`${managed.label} exited before becoming ready`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      await response.body?.cancel();
      return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  throw new Error(`${managed.label} did not become ready within ${timeoutMs}ms`);
}

function guardedTestUrl(variable: string) {
  const value = process.env[variable]?.trim();
  if (!value) throw new Error(`${variable} is required when RUN_POSTGRES_SECURITY_STATE_TESTS=1`);
  const parsed = new URL(value);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${variable} must use PostgreSQL`);
  }
  if (!new Set(["", "localhost", "127.0.0.1", "[::1]", "::1"]).has(parsed.hostname)) {
    throw new Error(`${variable} must target a local PostgreSQL instance`);
  }
  if (parsed.port && parsed.port !== "5432") {
    throw new Error(`${variable} must use the application PostgreSQL port 5432`);
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/(?:test|tmp|scratch)/i.test(databaseName)) {
    throw new Error("The dedicated database name must contain test, tmp, or scratch");
  }
  return { value, databaseName };
}

function testDatabaseUrls() {
  const admin = guardedTestUrl("POSTGRES_SECURITY_STATE_TEST_DATABASE_URL");
  const runtime = guardedTestUrl("POSTGRES_SECURITY_STATE_RUNTIME_DATABASE_URL");
  if (admin.databaseName !== runtime.databaseName) {
    throw new Error("The PostgreSQL admin and runtime test URLs must target the same database");
  }
  if (admin.value === runtime.value) {
    throw new Error("The PostgreSQL runtime test URL must use a distinct non-owner role");
  }
  return { adminUrl: admin.value, runtimeUrl: runtime.value, databaseName: admin.databaseName };
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function legacyTestDatabaseUrlGuard() {
  const value = process.env.POSTGRES_SECURITY_STATE_TEST_DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      "POSTGRES_SECURITY_STATE_TEST_DATABASE_URL is required when " +
      "RUN_POSTGRES_SECURITY_STATE_TESTS=1"
    );
  }
  if (value === originalEnv.DATABASE_URL?.trim()) {
    throw new Error("The PostgreSQL security-state test URL must not equal DATABASE_URL");
  }
  const databaseName = decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
  if (!/(?:test|tmp|scratch)/i.test(databaseName)) {
    throw new Error("The dedicated database name must contain test, tmp, or scratch");
  }
  return value;
}

function resetTestQuotas() {
  process.env.SESSION_STARTS_PER_IP_MINUTE = "60";
  process.env.SESSION_STARTS_PER_IP_DAY = "600";
  process.env.SESSION_TRANSITIONS_PER_SESSION = "12";
  process.env.SESSION_TTL_SECONDS = "1800";
  process.env.AI_CONCURRENCY_MAX = "2";
  process.env.AI_QUEUE_MAX = "2";
  process.env.AI_QUEUE_WAIT_MS = "1000";
  process.env.AI_MODEL_CALLS_PER_DAY = "2";
}

function request(idempotencyKey: string, requestId: string, ip = "203.0.113.77") {
  return new Request("https://example.test/api/competitions/recommend/normalize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Real-IP": ip,
      "X-Request-ID": requestId
    },
    body: "{}"
  });
}

async function clearSecurityState() {
  await adminPool.query(`
    truncate table
      competition_session_transitions,
      competition_sessions,
      competition_session_starts,
      competition_idempotency,
      competition_rate_limit_counters,
      ai_model_call_waiters,
      ai_model_call_leases
    restart identity cascade;
    delete from ai_model_daily_usage where bucket = 'global';
  `);
}

async function freshRateLimitModule() {
  vi.resetModules();
  return import("@/lib/security/rate-limit");
}

async function freshGovernorModule() {
  vi.resetModules();
  return import("@/lib/ai/model-call-governor");
}

function detachApplicationPool() {
  const pool = (globalThis as typeof globalThis & { __pgPool?: Pool }).__pgPool;
  if (pool) applicationPools.add(pool);
  Reflect.deleteProperty(globalThis, "__pgPool");
  return pool;
}

async function waitForCount(
  table: "competition_idempotency" | "competition_session_transitions" |
    "ai_model_call_waiters" | "ai_model_call_leases",
  count: number,
  timeoutMs = 2_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await adminPool.query<{ count: string }>(
      `select count(*)::text as count from ${table}`
    );
    if (Number(result.rows[0]?.count) === count) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(`Timed out waiting for ${table} count ${count}`);
}

integrationDescribe("real PostgreSQL shared security state", () => {
  beforeAll(async () => {
    legacyTestDatabaseUrlGuard();
    const { adminUrl, runtimeUrl } = testDatabaseUrls();
    process.env.DATABASE_URL = runtimeUrl;
    process.env.AI_CONVERSATION_SIGNING_SECRET =
      "postgres-integration-signing-secret-more-than-thirty-two-characters";
    resetTestQuotas();
    Reflect.deleteProperty(globalThis, "__pgPool");

    adminPool = new Pool({ connectionString: adminUrl, max: 8, application_name: "security-state-test-admin" });
    runtimeProbePool = new Pool({
      connectionString: runtimeUrl,
      max: 2,
      application_name: "security-state-test-runtime-probe"
    });
    const identity = await adminPool.query<{ database_name: string }>(
      `select current_database() as database_name`
    );
    if (!/(?:test|tmp|scratch)/i.test(identity.rows[0]!.database_name)) {
      throw new Error("Connected database failed the dedicated-test name guard");
    }
    for (const migration of [
      "db/migrations/20260826_ai_model_daily_usage.sql",
      "db/migrations/20260826_competition_shared_security_state.sql",
      "db/migrations/20260826_runtime_delete_functions.sql"
    ]) {
      await adminPool.query(readFileSync(resolve(process.cwd(), migration), "utf8"));
    }

    const runtimeIdentity = await runtimeProbePool.query<{
      database_name: string;
      role_name: string;
    }>(`select current_database() as database_name, current_user as role_name`);
    runtimeRole = runtimeIdentity.rows[0]!.role_name;
    if (runtimeIdentity.rows[0]!.database_name !== identity.rows[0]!.database_name) {
      throw new Error("Runtime and admin pools reached different databases");
    }
    const runtimeOwnsState = await adminPool.query<{ count: string }>(
      `select count(*)::text as count
         from pg_class relation
         join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname in (
            'ai_model_daily_usage', 'competition_rate_limit_counters',
            'competition_session_starts', 'competition_sessions',
            'competition_session_transitions', 'competition_idempotency',
            'ai_model_call_leases', 'ai_model_call_waiters'
          )
          and pg_get_userbyid(relation.relowner) = $1`,
      [runtimeRole]
    );
    if (Number(runtimeOwnsState.rows[0]!.count) !== 0) {
      throw new Error("The PostgreSQL runtime test role must not own security-state tables");
    }

    const quotedRuntimeRole = quoteIdentifier(runtimeRole);
    await adminPool.query(`
      revoke all on all functions in schema public from public;
      revoke all on all tables in schema public from ${quotedRuntimeRole};
      revoke all on all sequences in schema public from ${quotedRuntimeRole};
      revoke all on all functions in schema public from ${quotedRuntimeRole};
      grant usage on schema public to ${quotedRuntimeRole};
      grant select, insert, update on table
        public.ai_model_daily_usage,
        public.competition_rate_limit_counters,
        public.competition_session_starts,
        public.competition_sessions,
        public.competition_session_transitions,
        public.competition_idempotency,
        public.ai_model_call_leases,
        public.ai_model_call_waiters
      to ${quotedRuntimeRole};
      grant execute on function public.resume_ai_runtime_prune_competition_state()
        to ${quotedRuntimeRole};
      grant execute on function public.resume_ai_runtime_delete_expired_session_start(text)
        to ${quotedRuntimeRole};
      grant execute on function public.resume_ai_runtime_reset_expired_session_transitions(text)
        to ${quotedRuntimeRole};
      grant execute on function public.resume_ai_runtime_delete_pending_transition(text, text)
        to ${quotedRuntimeRole};
      grant execute on function public.resume_ai_runtime_prune_model_gate()
        to ${quotedRuntimeRole};
      grant execute on function public.resume_ai_runtime_delete_model_waiter(uuid)
        to ${quotedRuntimeRole};
      grant execute on function public.resume_ai_runtime_delete_model_lease(uuid)
        to ${quotedRuntimeRole};
    `);
    await clearSecurityState();
  }, 15_000);

  beforeEach(() => {
    resetTestQuotas();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    detachApplicationPool();
    await Promise.all([...applicationPools].map((pool) => pool.end()));
    applicationPools.clear();
    await clearSecurityState();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    detachApplicationPool();
    await Promise.all([...applicationPools].map((pool) => pool.end()));
    applicationPools.clear();
    if (runtimeProbePool) await runtimeProbePool.end();
    if (adminPool) await adminPool.end();
    process.env = { ...originalEnv };
  });

  it("runs with no table DELETE while retaining only the approved delete functions", async () => {
    const privileges = await adminPool.query<{
      table_name: string;
      can_delete: boolean;
    }>(
      `select relation.relname as table_name,
              has_table_privilege($1, relation.oid, 'DELETE') as can_delete
         from pg_class relation
         join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname in (
            'ai_model_daily_usage', 'competition_rate_limit_counters',
            'competition_session_starts', 'competition_sessions',
            'competition_session_transitions', 'competition_idempotency',
            'ai_model_call_leases', 'ai_model_call_waiters'
          )
        order by relation.relname`,
      [runtimeRole]
    );
    expect(privileges.rows).toHaveLength(8);
    expect(privileges.rows.every(({ can_delete }) => !can_delete)).toBe(true);
    await expect(runtimeProbePool.query(
      `delete from public.competition_session_starts where false`
    )).rejects.toMatchObject({ code: "42501" });

    const functionPrivileges = await adminPool.query<{ function_name: string }>(
      `select procedure.proname as function_name
         from pg_proc procedure
         join pg_namespace namespace on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'public'
          and has_function_privilege($1, procedure.oid, 'EXECUTE')
        order by procedure.proname`,
      [runtimeRole]
    );
    expect(functionPrivileges.rows.map(({ function_name }) => function_name)).toEqual([
      "resume_ai_runtime_delete_expired_session_start",
      "resume_ai_runtime_delete_model_lease",
      "resume_ai_runtime_delete_model_waiter",
      "resume_ai_runtime_delete_pending_transition",
      "resume_ai_runtime_prune_competition_state",
      "resume_ai_runtime_prune_model_gate",
      "resume_ai_runtime_reset_expired_session_transitions"
    ]);

    const rateLimiter = await freshRateLimitModule();
    const sessionId = "1ec31bd9-6697-4ef0-80cb-3997e2cd6ce7";
    const failed = await rateLimiter.executeCompetitionSessionTransition({
      request: request("runtime-delete-boundary-0001", "runtime-delete-boundary-request-0001"),
      requestId: "runtime-delete-boundary-request-0001",
      operation: "competition_clarify",
      sessionId,
      sessionExpiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 1800,
      transitionId: rateLimiter.competitionTransitionId("competition_clarify", { failure: true }),
      producer: async () => Response.json({ ok: false }, { status: 503 })
    });
    expect(failed.status).toBe(503);
    expect(Number((await adminPool.query<{ count: string }>(
      `select count(*)::text as count from competition_session_transitions`
    )).rows[0]!.count)).toBe(0);

    process.env.AI_CONCURRENCY_MAX = "1";
    process.env.AI_MODEL_CALLS_PER_DAY = "2";
    const governor = await freshGovernorModule();
    const permit = await governor.acquireModelCallPermit();
    expect(permit.ok).toBe(true);
    if (permit.ok) permit.permit.release();
    await waitForCount("ai_model_call_leases", 0);
  });

  it("accepts 50 shared-NAT sessions and limits only the sixty-first minute start", async () => {
    const rateLimiter = await freshRateLimitModule();
    const ip = "198.51.100.44";
    const executeStart = (index: number) => rateLimiter.executeCompetitionSessionStart({
      request: request(
        `shared-nat-minute-${index.toString().padStart(4, "0")}`,
        `shared-nat-minute-request-${index.toString().padStart(4, "0")}`,
        ip
      ),
      requestId: `shared-nat-minute-request-${index.toString().padStart(4, "0")}`,
      operation: "competition_normalize",
      transitionId: rateLimiter.competitionTransitionId("competition_normalize", { index }),
      producer: async () => Response.json({ ok: true })
    });

    const firstFifty = await Promise.all(Array.from({ length: 50 }, (_, index) => executeStart(index)));
    expect(firstFifty.every(({ status }) => status === 200)).toBe(true);
    const nextTen = await Promise.all(Array.from({ length: 10 }, (_, offset) => executeStart(offset + 50)));
    expect(nextTen.every(({ status }) => status === 200)).toBe(true);
    const limited = await executeStart(60);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ bucket: "session_start_minute" });

    const counters = await adminPool.query<{ bucket: string; hit_count: number }>(
      `select bucket, hit_count from competition_rate_limit_counters order by bucket`
    );
    expect(counters.rows).toEqual([
      { bucket: "session_start_daily", hit_count: 60 },
      { bucket: "session_start_minute", hit_count: 60 }
    ]);
  }, 30_000);

  it("serves 50 shared-NAT recommendation journeys through Nginx and real PostgreSQL", async () => {
    if (process.platform !== "linux") {
      throw new Error("The explicitly enabled shared-NAT full-stack evidence gate requires Linux");
    }
    if (typeof process.getuid !== "function" || process.getuid() === 0) {
      throw new Error("The shared-NAT Next and Nginx children must run as a non-root evidence user");
    }
    if (process.env.CI !== "1") {
      throw new Error("The explicitly enabled shared-NAT full-stack gate requires the isolated CI evidence environment");
    }

    const repositoryRoot = process.cwd();
    const nginxBinary = "/usr/sbin/nginx";
    const nextBinary = resolve(repositoryRoot, "node_modules/next/dist/bin/next");
    const buildFiles = [
      ".next/BUILD_ID",
      ".next/routes-manifest.json",
      ".next/required-server-files.json",
      ".next/server/app-paths-manifest.json"
    ].map((relative) => resolve(repositoryRoot, relative));
    const nginxGlobal = resolve(repositoryRoot, "ops/generated/00-resume-ai-global.conf");
    const nginxQuota = resolve(repositoryRoot, "ops/generated/nginx-quota.inc");
    const proxyCommon = resolve(repositoryRoot, "ops/nginx/resume-ai-proxy-common.conf");
    const transportSecurity = resolve(
      repositoryRoot,
      "ops/nginx/resume-ai-transport-security.conf"
    );
    for (const filename of [
      nginxBinary,
      nextBinary,
      ...buildFiles,
      nginxGlobal,
      nginxQuota,
      proxyCommon,
      transportSecurity
    ]) {
      if (!existsSync(filename) || !statSync(filename).isFile()) {
        throw new Error(`Required shared-NAT full-stack evidence input is missing: ${filename}`);
      }
    }
    if ((statSync(nginxBinary).mode & 0o111) === 0) {
      throw new Error("The reviewed /usr/sbin/nginx is not executable");
    }
    const buildId = readFileSync(buildFiles[0]!, "utf8").trim();
    if (!/^[A-Za-z0-9_-]+$/u.test(buildId)) {
      throw new Error("The existing production .next build lacks a valid BUILD_ID");
    }

    const version = spawnSync(nginxBinary, ["-v"], {
      encoding: "utf8",
      maxBuffer: CHILD_DIAGNOSTIC_LIMIT_BYTES,
      timeout: 5_000
    });
    if (version.error || version.status !== 0) {
      throw new Error("Unable to execute the reviewed /usr/sbin/nginx version probe");
    }
    const versionOutput = `${version.stdout ?? ""}${version.stderr ?? ""}`.trim();
    if (versionOutput !== "nginx version: nginx/1.30.4") {
      throw new Error(`Expected nginx/1.30.4 exactly, received ${versionOutput || "no version"}`);
    }

    const globalConfig = readFileSync(nginxGlobal, "utf8");
    const quotaConfig = readFileSync(nginxQuota, "utf8");
    const generationPattern = /# Quota-Generation-SHA256: ([a-f0-9]{64})/gu;
    const globalGenerations = [...globalConfig.matchAll(generationPattern)].map((match) => match[1]!);
    const quotaGenerations = [...quotaConfig.matchAll(generationPattern)].map((match) => match[1]!);
    if (
      globalGenerations.length !== 1 ||
      quotaGenerations.length !== 1 ||
      globalGenerations[0] !== quotaGenerations[0]
    ) {
      throw new Error("The current Nginx global and endpoint quota generations do not match");
    }
    const expectedQuotaGeneration = globalGenerations[0]!;
    const { runtimeUrl } = testDatabaseUrls();
    const fixtureRoot = mkdtempSync(join(tmpdir(), "resume-ai-shared-nat-full-stack-"));
    const nginxConfig = join(fixtureRoot, "nginx.conf");
    const accessLog = join(fixtureRoot, "access.jsonl");
    let nextChild: ManagedChild | null = null;
    let nginxChild: ManagedChild | null = null;
    const responseStatuses: number[] = [];
    const nginxRequestIds: string[] = [];
    const sensitiveTransportValues: string[] = [];
    let clientRequestCount = 0;

    const delayBetweenWaves = () => new Promise((resolveDelay) =>
      setTimeout(resolveDelay, SHARED_NAT_WAVE_INTERVAL_MS)
    );
    const postJson = async (
      path: string,
      body: Record<string, unknown>,
      idempotencyKey: string,
      label: string
    ) => {
      clientRequestCount += 1;
      const response = await fetch(
        `http://127.0.0.1:${SHARED_NAT_NGINX_PORT}${path}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(70_000)
        }
      );
      responseStatuses.push(response.status);
      const requestId = response.headers.get("x-request-id")?.trim();
      if (!requestId || !/^[a-f0-9]{32}$/u.test(requestId)) {
        throw new Error(`${label} lacked the Nginx-owned request ID`);
      }
      nginxRequestIds.push(requestId);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await response.text());
      } catch {
        throw new Error(`${label} returned invalid JSON with status ${response.status}`);
      }
      if (response.status !== 200) {
        const errorCode = parsed && typeof parsed === "object" &&
          typeof (parsed as { error?: unknown }).error === "string"
          ? (parsed as { error: string }).error
          : "UNKNOWN";
        throw new Error(`${label} returned status ${response.status} error ${errorCode}`);
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${label} returned a non-object JSON response`);
      }
      return parsed as Record<string, unknown>;
    };
    const parseClarifyResponse = (
      body: Record<string, unknown>,
      journey: SharedNatJourney,
      expectedAnsweredCount: number
    ) => {
      if (typeof body.conversationToken !== "string") {
        throw new Error(`clarify session ${journey.index} omitted its conversation token`);
      }
      const payload = signedTokenPayload(
        body.conversationToken,
        "competition-conversation.v6"
      );
      if (payload.sessionId !== journey.sessionId) {
        throw new Error(`clarify session ${journey.index} crossed a signed session boundary`);
      }
      if (body.askedQuestionCount !== expectedAnsweredCount) {
        throw new Error(`clarify session ${journey.index} reported the wrong answered count`);
      }
      const nextQuestion = body.nextQuestion;
      if (nextQuestion !== null) {
        if (
          !nextQuestion || typeof nextQuestion !== "object" ||
          !Array.isArray((nextQuestion as { options?: unknown }).options) ||
          (nextQuestion as { options: unknown[] }).options.length === 0 ||
          !(nextQuestion as { options: unknown[] }).options.every((option) =>
            Boolean(option) && typeof option === "object" &&
            typeof (option as { value?: unknown }).value === "string"
          )
        ) {
          throw new Error(`clarify session ${journey.index} returned an invalid server-owned question`);
        }
      }
      if (
        (nextQuestion === null && body.status !== "completed") ||
        (nextQuestion !== null && !new Set(["question", "optional_question"]).has(String(body.status)))
      ) {
        throw new Error(`clarify session ${journey.index} returned an inconsistent status`);
      }
      sensitiveTransportValues.push(body.conversationToken);
      journey.conversationToken = body.conversationToken;
      journey.nextQuestion = nextQuestion as SharedNatQuestion | null;
    };

    try {
      writeFileSync(nginxConfig, buildSharedNatNginxConfig({
        fixtureRoot,
        accessLog,
        nginxGlobal,
        nginxQuota,
        proxyCommon,
        transportSecurity
      }), { encoding: "utf8", mode: 0o600, flag: "wx" });
      const nginxEnvironment: NodeJS.ProcessEnv = {
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        LANG: "C.UTF-8",
        TZ: "UTC",
        NODE_ENV: "test"
      };
      const nginxPrefix = `${fixtureRoot}/`;
      const nginxSyntax = spawnSync(
        nginxBinary,
        ["-p", nginxPrefix, "-c", nginxConfig, "-e", "stderr", "-t"],
        {
          cwd: repositoryRoot,
          env: nginxEnvironment,
          encoding: "utf8",
          maxBuffer: CHILD_DIAGNOSTIC_LIMIT_BYTES,
          timeout: 10_000
        }
      );
      if (nginxSyntax.error || nginxSyntax.status !== 0) {
        const safeNginxError = redactChildDiagnostic(
          `${nginxSyntax.stdout ?? ""}\n${nginxSyntax.stderr ?? ""}`
        ).slice(-8_192);
        throw new Error(`The isolated Nginx configuration was rejected\n${safeNginxError}`);
      }

      nextChild = spawnManaged(
        "Next production",
        process.execPath,
        [nextBinary, "start", "--hostname", "127.0.0.1", "--port", String(SHARED_NAT_NEXT_PORT)],
        { cwd: repositoryRoot, env: nextProductionEnvironment(runtimeUrl) }
      );
      await waitForHttpReady(
        `http://127.0.0.1:${SHARED_NAT_NEXT_PORT}/`,
        nextChild,
        30_000
      );

      nginxChild = spawnManaged(
        "Nginx 1.30.4",
        nginxBinary,
        [
          "-p",
          nginxPrefix,
          "-c",
          nginxConfig,
          "-e",
          "stderr",
          "-g",
          "daemon off; master_process off;"
        ],
        { cwd: repositoryRoot, env: nginxEnvironment }
      );
      const quotaProbeUrl =
        `http://127.0.0.1:${SHARED_NAT_NGINX_PORT}/__resume_ai_quota_generation`;
      await waitForHttpReady(quotaProbeUrl, nginxChild, 10_000);
      const quotaProbe = await fetch(quotaProbeUrl, { signal: AbortSignal.timeout(2_000) });
      if (quotaProbe.status !== 200 || (await quotaProbe.text()) !== `${expectedQuotaGeneration}\n`) {
        throw new Error("The running Nginx worker loaded the wrong quota generation");
      }

      const questionnaire = sharedNatQuestionnaire();
      const journeys = await Promise.all(Array.from(
        { length: SHARED_NAT_SESSION_COUNT },
        async (_, index): Promise<SharedNatJourney> => {
          const body = await postJson(
            "/api/competitions/recommend/normalize",
            {
              aiConsent: { accepted: true, version: SHARED_NAT_CONSENT_VERSION },
              questionnaire
            },
            `shared-nat-full-stack-normalize-${index.toString().padStart(3, "0")}`,
            `normalize session ${index}`
          );
          if (body.ok !== true || body.status !== "confirmed" || typeof body.questionnaireToken !== "string") {
            throw new Error(`normalize session ${index} did not return a confirmed questionnaire`);
          }
          const payload = signedTokenPayload(
            body.questionnaireToken,
            "competition-questionnaire-token.v2"
          );
          if (typeof payload.sessionId !== "string") {
            throw new Error(`normalize session ${index} omitted its signed session ID`);
          }
          sensitiveTransportValues.push(body.questionnaireToken);
          return {
            index,
            questionnaireToken: body.questionnaireToken,
            conversationToken: "",
            sessionId: payload.sessionId,
            nextQuestion: null,
            dynamicQuestionCount: 0
          };
        }
      ));
      expect(new Set(journeys.map(({ sessionId }) => sessionId)).size).toBe(
        SHARED_NAT_SESSION_COUNT
      );

      await delayBetweenWaves();
      await Promise.all(journeys.map(async (journey) => {
        const body = await postJson(
          "/api/ai/competition-clarify",
          {
            aiConsent: { accepted: true, version: SHARED_NAT_CONSENT_VERSION },
            questionnaireToken: journey.questionnaireToken,
            recentSignalKeys: []
          },
          `shared-nat-full-stack-clarify-initial-${journey.index.toString().padStart(3, "0")}`,
          `initial clarify session ${journey.index}`
        );
        parseClarifyResponse(body, journey, 0);
        if (!journey.nextQuestion) {
          throw new Error(`clarify session ${journey.index} completed without one dynamic question`);
        }
      }));

      await delayBetweenWaves();
      for (let wave = 1; journeys.some(({ nextQuestion }) => nextQuestion !== null); wave += 1) {
        if (wave > 3) throw new Error("A session exceeded the three-question dynamic limit");
        const pendingJourneys = journeys.filter(
          (journey): journey is SharedNatJourney & { nextQuestion: SharedNatQuestion } =>
            journey.nextQuestion !== null
        );
        await Promise.all(pendingJourneys.map(async (journey) => {
          const selectedValue = journey.nextQuestion.options[0]?.value;
          if (!selectedValue) {
            throw new Error(`clarify session ${journey.index} lacked a whitelist answer option`);
          }
          const body = await postJson(
            "/api/ai/competition-clarify",
            {
              aiConsent: { accepted: true, version: SHARED_NAT_CONSENT_VERSION },
              conversationToken: journey.conversationToken,
              answer: { selectedValues: [selectedValue] },
              recentSignalKeys: []
            },
            `shared-nat-full-stack-clarify-${wave}-${journey.index.toString().padStart(3, "0")}`,
            `clarify wave ${wave} session ${journey.index}`
          );
          journey.dynamicQuestionCount += 1;
          parseClarifyResponse(body, journey, journey.dynamicQuestionCount);
        }));
        await delayBetweenWaves();
      }

      if (journeys.some(({ dynamicQuestionCount }) =>
        dynamicQuestionCount < 1 || dynamicQuestionCount > 3
      )) {
        throw new Error("Every shared-NAT journey must answer between one and three dynamic questions");
      }
      await Promise.all(journeys.map(async (journey) => {
        const body = await postJson(
          "/api/ai/competition-recommend",
          {
            aiConsent: { accepted: true, version: SHARED_NAT_CONSENT_VERSION },
            conversationToken: journey.conversationToken
          },
          `shared-nat-full-stack-recommend-${journey.index.toString().padStart(3, "0")}`,
          `recommend session ${journey.index}`
        );
        const recommendationIds = Array.isArray(body.recommendations)
          ? body.recommendations.map((item) =>
              item && typeof item === "object" &&
                typeof (item as { competitionId?: unknown }).competitionId === "string"
                ? (item as { competitionId: string }).competitionId
                : null
            )
          : [];
        if (
          body.status !== "matched" ||
          recommendationIds.length !== 3 ||
          recommendationIds.some((competitionId) => !competitionId) ||
          new Set(recommendationIds).size !== 3
        ) {
          throw new Error(`recommend session ${journey.index} did not return three unique recommendations`);
        }
      }));

      expect(responseStatuses).toHaveLength(clientRequestCount);
      expect(responseStatuses.every((status) => status === 200)).toBe(true);
      expect(responseStatuses.filter((status) => status === 429)).toHaveLength(0);
      expect(nginxRequestIds).toHaveLength(clientRequestCount);
      expect(new Set(nginxRequestIds).size).toBe(clientRequestCount);

      const childrenStopped = await Promise.all([
        stopManaged(nginxChild),
        stopManaged(nextChild)
      ]);
      if (childrenStopped.some((stopped) => !stopped)) {
        throw new Error("An isolated Next or Nginx child survived SIGKILL cleanup");
      }

      const stateCounts = await adminPool.query<{
        session_starts: string;
        sessions: string;
        transitions: string;
      }>(`
        select
          (select count(*)::text from competition_session_starts) as session_starts,
          (select count(*)::text from competition_sessions) as sessions,
          (select count(*)::text from competition_session_transitions) as transitions
      `);
      const expectedTransitions = journeys.reduce(
        (total, journey) => total + journey.dynamicQuestionCount + 2,
        0
      );
      expect(stateCounts.rows[0]).toEqual({
        session_starts: String(SHARED_NAT_SESSION_COUNT),
        sessions: String(SHARED_NAT_SESSION_COUNT),
        transitions: String(expectedTransitions)
      });
      const transitionDistribution = await adminPool.query<{
        session_count: string;
        minimum: string;
        maximum: string;
        all_committed: boolean;
      }>(`
        select count(*)::text as session_count,
               min(transition_count)::text as minimum,
               max(transition_count)::text as maximum,
               bool_and(all_committed) as all_committed
          from (
            select session_key,
                   count(*) as transition_count,
                   bool_and(state = 'committed') as all_committed
              from competition_session_transitions
             group by session_key
          ) distribution
      `);
      expect(transitionDistribution.rows[0]).toEqual({
        session_count: String(SHARED_NAT_SESSION_COUNT),
        minimum: String(Math.min(...journeys.map(({ dynamicQuestionCount }) => dynamicQuestionCount + 2))),
        maximum: String(Math.max(...journeys.map(({ dynamicQuestionCount }) => dynamicQuestionCount + 2))),
        all_committed: true
      });
      expect(Number(transitionDistribution.rows[0]!.minimum)).toBeGreaterThanOrEqual(3);
      expect(Number(transitionDistribution.rows[0]!.maximum)).toBeLessThanOrEqual(5);
      const sharedIpCounters = await adminPool.query<{ bucket: string; hit_count: number }>(
        `select bucket, hit_count from competition_rate_limit_counters order by bucket`
      );
      expect(sharedIpCounters.rows).toEqual([
        { bucket: "session_start_daily", hit_count: SHARED_NAT_SESSION_COUNT },
        { bucket: "session_start_minute", hit_count: SHARED_NAT_SESSION_COUNT }
      ]);

      const rawAccessLog = readFileSync(accessLog, "utf8");
      const logLines = rawAccessLog.split("\n").filter(Boolean);
      if (logLines.length !== clientRequestCount) {
        throw new Error(
          `Nginx logged ${logLines.length} requests but the client completed ${clientRequestCount}`
        );
      }
      const logEntries = logLines.map((line, index) => {
        try {
          const parsed = JSON.parse(line) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("not an object");
          }
          return parsed as Record<string, unknown>;
        } catch {
          throw new Error(`Nginx access-log line ${index + 1} is not valid JSON`);
        }
      });
      const expectedEndpointCounts = new Map([
        ["competition-normalize", SHARED_NAT_SESSION_COUNT],
        [
          "competition-clarify",
          journeys.reduce((total, journey) => total + journey.dynamicQuestionCount + 1, 0)
        ],
        ["competition-recommend", SHARED_NAT_SESSION_COUNT]
      ]);
      for (const entry of logEntries) {
        if (
          typeof entry.endpoint !== "string" ||
          entry.stage !== "upstream-or-handler" ||
          entry.rateBucket !== "recommend-ip-minute" ||
          entry.rateSource !== "none" ||
          entry.status !== 200 ||
          typeof entry.requestId !== "string"
        ) {
          throw new Error("Nginx JSON access log omitted a required endpoint/rate correlation field");
        }
      }
      for (const [endpoint, count] of expectedEndpointCounts) {
        expect(logEntries.filter((entry) => entry.endpoint === endpoint)).toHaveLength(count);
      }
      expect(new Set(logEntries.map(({ requestId }) => requestId))).toEqual(
        new Set(nginxRequestIds)
      );
      if (
        rawAccessLog.includes("127.0.0.1") ||
        /questionnaireToken|conversationToken|selectedValues|"answer"/u.test(rawAccessLog) ||
        [
          SHARED_NAT_SIGNING_SECRET,
          SHARED_NAT_CONSENT_SALT,
          SHARED_NAT_LOG_HASH_SECRET,
          SHARED_NAT_RATE_HASH_SALT,
          ...sensitiveTransportValues
        ].some((value) => rawAccessLog.includes(value))
      ) {
        throw new Error("Nginx JSON access log exposed an IP, answer, signed token, or secret");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error([
        redactChildDiagnostic(message),
        "--- bounded child diagnostics ---",
        childDiagnostic(nextChild),
        childDiagnostic(nginxChild)
      ].join("\n"), { cause: error });
    } finally {
      await stopManaged(nginxChild);
      await stopManaged(nextChild);
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }, 240_000);

  it("accepts 600 daily starts and limits only the six-hundred-first", async () => {
    const rateLimiter = await freshRateLimitModule();
    const ip = "198.51.100.45";
    const executeStart = (index: number) => rateLimiter.executeCompetitionSessionStart({
      request: request(
        `shared-nat-daily-${index.toString().padStart(4, "0")}`,
        `shared-nat-daily-request-${index.toString().padStart(4, "0")}`,
        ip
      ),
      requestId: `shared-nat-daily-request-${index.toString().padStart(4, "0")}`,
      operation: "competition_normalize",
      transitionId: rateLimiter.competitionTransitionId("competition_normalize", { daily: index }),
      producer: async () => Response.json({ ok: true })
    });

    for (let batch = 0; batch < 10; batch += 1) {
      const accepted = await Promise.all(Array.from(
        { length: 60 },
        (_, offset) => executeStart(batch * 60 + offset)
      ));
      expect(accepted.every(({ status }) => status === 200)).toBe(true);
      await adminPool.query(
        `delete from competition_rate_limit_counters where bucket = 'session_start_minute'`
      );
    }
    const daily = await adminPool.query<{ hit_count: number }>(
      `select hit_count from competition_rate_limit_counters
        where bucket = 'session_start_daily'`
    );
    expect(daily.rows[0]!.hit_count).toBe(600);

    const limited = await executeStart(600);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ bucket: "session_start_daily" });
  }, 90_000);

  it("holds 8 active and 32 queued calls while rejecting the next request", async () => {
    process.env.AI_CONCURRENCY_MAX = "8";
    process.env.AI_QUEUE_MAX = "32";
    process.env.AI_QUEUE_WAIT_MS = "15000";
    process.env.AI_MODEL_CALLS_PER_DAY = "1200";
    const governor = await freshGovernorModule();
    const active = await Promise.all(Array.from(
      { length: 8 },
      () => governor.acquireModelCallPermit()
    ));
    expect(active.every(({ ok }) => ok)).toBe(true);
    await waitForCount("ai_model_call_leases", 8, 5_000);

    const queued = Array.from({ length: 32 }, () => governor.acquireModelCallPermit());
    await waitForCount("ai_model_call_waiters", 32, 10_000);
    const full = await governor.acquireModelCallPermit();
    expect(full).toEqual({ ok: false, reason: "capacity_exhausted" });
    await waitForCount("ai_model_call_leases", 8);
    await waitForCount("ai_model_call_waiters", 32);

    for (const result of active) if (result.ok) result.permit.release();
    const drained = await Promise.all(queued.map(async (resultPromise) => {
      const result = await resultPromise;
      if (result.ok) result.permit.release();
      return result;
    }));
    expect(drained.every(({ ok }) => ok)).toBe(true);
    await waitForCount("ai_model_call_waiters", 0, 10_000);
    await waitForCount("ai_model_call_leases", 0, 10_000);
  }, 30_000);

  it("deduplicates one producer across two module instances and restart", async () => {
    const moduleA = await freshRateLimitModule();
    const transitionId = moduleA.competitionTransitionId("competition_normalize", { same: true });
    let finish!: () => void;
    const pending = new Promise<void>((resolvePending) => { finish = resolvePending; });
    const sensitiveToken = "postgres-encrypted-signed-token-fixture";
    const producerA = vi.fn(async () => {
      await pending;
      return Response.json({ ok: true, token: sensitiveToken });
    });
    const firstPromise = moduleA.executeCompetitionSessionStart({
      request: request("postgres-shared-start-0001", "postgres-request-a-0001"),
      requestId: "postgres-request-a-0001",
      operation: "competition_normalize",
      transitionId,
      producer: producerA
    });
    await waitForCount("competition_idempotency", 1);
    const firstApplicationPool = detachApplicationPool();

    const moduleB = await freshRateLimitModule();
    const producerB = vi.fn(async () => Response.json({ ok: true, token: "wrong" }));
    const secondPromise = moduleB.executeCompetitionSessionStart({
      request: request("postgres-shared-start-0001", "postgres-request-b-0002"),
      requestId: "postgres-request-b-0002",
      operation: "competition_normalize",
      transitionId,
      producer: producerB
    });
    await waitForCount("competition_idempotency", 1);
    const secondApplicationPool =
      (globalThis as typeof globalThis & { __pgPool?: Pool }).__pgPool;
    expect(firstApplicationPool).toBeDefined();
    expect(secondApplicationPool).toBeDefined();
    expect(secondApplicationPool).not.toBe(firstApplicationPool);
    finish();

    expect((await firstPromise).status).toBe(200);
    const replay = await secondPromise;
    expect(replay.status).toBe(200);
    expect(replay.headers.get("X-Idempotent-Replay")).toBe("true");
    expect(await replay.json()).toEqual({ ok: true, token: sensitiveToken });
    expect(producerA).toHaveBeenCalledTimes(1);
    expect(producerB).not.toHaveBeenCalled();

    const persisted = await adminPool.query<{
      response_ciphertext: Buffer;
      response_iv: Buffer;
      response_tag: Buffer;
    }>(`select response_ciphertext, response_iv, response_tag from competition_idempotency`);
    expect(persisted.rows[0]!.response_iv).toHaveLength(12);
    expect(persisted.rows[0]!.response_tag).toHaveLength(16);
    expect(persisted.rows[0]!.response_ciphertext.includes(Buffer.from(sensitiveToken))).toBe(false);

    const moduleAfterRestart = await freshRateLimitModule();
    const restartProducer = vi.fn(async () => Response.json({ ok: true, token: "wrong" }));
    const afterRestart = await moduleAfterRestart.executeCompetitionSessionStart({
      request: request("postgres-shared-start-0001", "postgres-request-c-0003"),
      requestId: "postgres-request-c-0003",
      operation: "competition_normalize",
      transitionId,
      producer: restartProducer
    });
    expect(afterRestart.headers.get("X-Idempotent-Replay")).toBe("true");
    expect(restartProducer).not.toHaveBeenCalled();
  });

  it("serializes concurrent transitions and rejects the thirteenth across pools", async () => {
    const moduleA = await freshRateLimitModule();
    const sessionId = "bf9d37f8-3c39-49f2-95d6-6559a8bbbdf4";
    const expiresAt = Math.floor(Date.now() / 1000) + 1800;
    let finish!: () => void;
    const pending = new Promise<void>((resolvePending) => { finish = resolvePending; });
    const first = moduleA.executeCompetitionSessionTransition({
      request: request("postgres-transition-0000", "postgres-transition-request-0"),
      requestId: "postgres-transition-request-0",
      operation: "competition_clarify",
      sessionId,
      sessionExpiresAtEpochSeconds: expiresAt,
      transitionId: moduleA.competitionTransitionId("competition_clarify", { index: 0 }),
      producer: async () => {
        await pending;
        return Response.json({ ok: true, index: 0 });
      }
    });
    await waitForCount("competition_session_transitions", 1);
    const firstPool = detachApplicationPool();
    const moduleB = await freshRateLimitModule();
    const remaining = Array.from({ length: 11 }, (_, offset) => {
      const index = offset + 1;
      const rateLimiter = index % 2 === 0 ? moduleA : moduleB;
      return rateLimiter.executeCompetitionSessionTransition({
        request: request(`postgres-transition-${index.toString().padStart(4, "0")}`, `postgres-transition-request-${index}`),
        requestId: `postgres-transition-request-${index}`,
        operation: "competition_clarify",
        sessionId,
        sessionExpiresAtEpochSeconds: expiresAt,
        transitionId: rateLimiter.competitionTransitionId("competition_clarify", { index }),
        producer: async () => {
          await pending;
          return Response.json({ ok: true, index });
        }
      });
    });
    await waitForCount("competition_session_transitions", 12);
    const secondPool = (globalThis as typeof globalThis & { __pgPool?: Pool }).__pgPool;
    expect(firstPool).toBeDefined();
    expect(secondPool).toBeDefined();
    expect(secondPool).not.toBe(firstPool);
    const limited = await moduleB.executeCompetitionSessionTransition({
      request: request("postgres-transition-0012", "postgres-transition-request-12"),
      requestId: "postgres-transition-request-12",
      operation: "competition_clarify",
      sessionId,
      sessionExpiresAtEpochSeconds: expiresAt,
      transitionId: moduleB.competitionTransitionId("competition_clarify", { index: 12 }),
      producer: async () => Response.json({ ok: true })
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ bucket: "session_transitions" });
    finish();
    const accepted = await Promise.all([first, ...remaining]);
    expect(accepted.every(({ status }) => status === 200)).toBe(true);
  });

  it("rejects ciphertext moved between replay keys by AES-GCM AAD", async () => {
    const rateLimiter = await freshRateLimitModule();
    const firstTransition = rateLimiter.competitionTransitionId("competition_normalize", { row: 1 });
    const secondTransition = rateLimiter.competitionTransitionId("competition_normalize", { row: 2 });
    await rateLimiter.executeCompetitionSessionStart({
      request: request("postgres-aad-start-0001", "postgres-aad-request-0001"),
      requestId: "postgres-aad-request-0001",
      operation: "competition_normalize",
      transitionId: firstTransition,
      producer: async () => Response.json({ ok: true, row: 1 })
    });
    const firstKey = (await adminPool.query<{ cache_key: string }>(
      `select cache_key from competition_idempotency`
    )).rows[0]!.cache_key;
    await rateLimiter.executeCompetitionSessionStart({
      request: request("postgres-aad-start-0002", "postgres-aad-request-0002"),
      requestId: "postgres-aad-request-0002",
      operation: "competition_normalize",
      transitionId: secondTransition,
      producer: async () => Response.json({ ok: true, row: 2 })
    });
    const secondKey = (await adminPool.query<{ cache_key: string }>(
      `select cache_key from competition_idempotency where cache_key <> $1`,
      [firstKey]
    )).rows[0]!.cache_key;
    await adminPool.query(
      `update competition_idempotency target
          set response_ciphertext = source.response_ciphertext,
              response_iv = source.response_iv,
              response_tag = source.response_tag,
              response_bytes = source.response_bytes
         from competition_idempotency source
        where target.cache_key = $1 and source.cache_key = $2`,
      [firstKey, secondKey]
    );

    const replayModule = await freshRateLimitModule();
    const producer = vi.fn(async () => Response.json({ ok: true, row: "wrong" }));
    const rejected = await replayModule.executeCompetitionSessionStart({
      request: request("postgres-aad-start-0001", "postgres-aad-request-0003"),
      requestId: "postgres-aad-request-0003",
      operation: "competition_normalize",
      transitionId: firstTransition,
      producer
    });
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toMatchObject({ error: "SECURITY_STATE_UNAVAILABLE" });
    expect(producer).not.toHaveBeenCalled();
  });

  it("keeps model concurrency and daily budget global and releases queue leases", async () => {
    process.env.AI_MODEL_CALLS_PER_DAY = "3";
    const governorA = await freshGovernorModule();
    const first = await governorA.acquireModelCallPermit();
    const second = await governorA.acquireModelCallPermit();
    expect(first.ok && second.ok).toBe(true);
    expect(Number((await adminPool.query<{ count: string }>(
      `select count(*)::text as count from ai_model_call_leases`
    )).rows[0]!.count)).toBe(2);

    const firstGovernorPool = detachApplicationPool();
    const governorB = await freshGovernorModule();
    const queued = governorB.acquireModelCallPermit();
    await waitForCount("ai_model_call_waiters", 1);
    const secondGovernorPool =
      (globalThis as typeof globalThis & { __pgPool?: Pool }).__pgPool;
    expect(firstGovernorPool).toBeDefined();
    expect(secondGovernorPool).toBeDefined();
    expect(secondGovernorPool).not.toBe(firstGovernorPool);
    if (first.ok) first.permit.release();
    const third = await queued;
    expect(third.ok).toBe(true);
    expect(Number((await adminPool.query<{ count: string }>(
      `select count(*)::text as count from ai_model_call_leases`
    )).rows[0]!.count)).toBeLessThanOrEqual(2);
    if (second.ok) second.permit.release();
    if (third.ok) third.permit.release();
    await waitForCount("ai_model_call_waiters", 0);

    const governorAfterRestart = await freshGovernorModule();
    expect(await governorAfterRestart.acquireModelCallPermit()).toEqual({
      ok: false,
      reason: "daily_budget_exhausted"
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    const leases = await adminPool.query<{ count: string }>(
      `select count(*)::text as count from ai_model_call_leases`
    );
    expect(Number(leases.rows[0]!.count)).toBe(0);
  });
});
