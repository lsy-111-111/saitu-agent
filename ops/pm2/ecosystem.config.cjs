"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readEnvironmentFile(filePath, required, allowedKeys) {
  if (!fs.existsSync(filePath)) {
    if (required) throw new Error(`Required environment file is missing: ${filePath}`);
    return {};
  }

  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error(`Environment file must be a single ordinary file: ${filePath}`);
  }
  if (stats.uid !== 0 || stats.gid !== process.getgid() || (stats.mode & 0o777) !== 0o640) {
    throw new Error(`Environment file must be root:resume-ai mode 0640: ${filePath}`);
  }

  const result = Object.create(null);
  for (const [index, rawLine] of fs.readFileSync(filePath, "utf8").split("\n").entries()) {
    if (!rawLine || rawLine.startsWith("#")) continue;
    if (rawLine.includes("\r")) throw new Error(`CRLF is not accepted at ${filePath}:${index + 1}`);
    const line = rawLine;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`Invalid environment entry at ${filePath}:${index + 1}`);
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) {
      throw new Error(`Invalid environment key at ${filePath}:${index + 1}`);
    }
    if (!allowedKeys.has(key)) {
      throw new Error(`Unapproved environment key at ${filePath}:${index + 1}`);
    }
    if (Object.hasOwn(result, key)) {
      throw new Error(`Duplicate environment key at ${filePath}:${index + 1}`);
    }
    result[key] = value;
  }
  return result;
}

const releaseDirectory = process.env.APP_RELEASE_DIR || "/opt/resume-ai/current";
const port = Number(process.env.APP_PORT || "3000");
const processName = process.env.APP_PROCESS_NAME || `resume-ai-${port}`;

if (!path.isAbsolute(releaseDirectory)) throw new Error("APP_RELEASE_DIR must be absolute");
if (![3000, 3001].includes(port)) throw new Error("APP_PORT must be 3000 or 3001");
if (!/^resume-ai-(3000|3001)$/u.test(processName)) {
  throw new Error("APP_PROCESS_NAME must match the selected application port");
}

const applicationKeys = new Set([
  "DATABASE_URL", "AI_API_KEY", "AI_API_URL", "AI_MODELS_URL", "AI_CONSENT_SALT",
  "AI_CONVERSATION_SIGNING_SECRET", "LOG_HASH_SECRET",
  "RATE_LIMIT_HASH_SALT", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_CONTACT_EMAIL",
  "NEXT_PUBLIC_ICP_LABEL", "NEXT_PUBLIC_POLICE_CODE", "NEXT_PUBLIC_POLICE_LABEL",
  "FEATURE_AI", "FEATURE_COMPETITION_RECOMMENDER", "AI_PROVIDER", "AI_MODEL",
  "AI_COMPETITION_NORMALIZE_MODEL", "AI_COMPETITION_CLARIFY_MODEL",
  "AI_COMPETITION_RECOMMEND_MODEL", "AI_TIMEOUT_MS", "AI_RETRY_MAX_DELAY_MS",
  "AI_VERIFY_TIMEOUT_MS", "AI_CLARIFY_SCHEMA_DIAGNOSTICS", "AI_RANK_SCHEMA_DIAGNOSTICS",
  "AI_TEST_MODE", "ALLOW_AI_MOCK", "NEXT_PUBLIC_AI_TEST_MODE"
]);
const quotaKeys = new Set([
  "SESSION_STARTS_PER_IP_MINUTE", "SESSION_STARTS_PER_IP_DAY",
  "SESSION_TRANSITIONS_PER_SESSION", "SESSION_TTL_SECONDS", "MAX_TRACK_PER_IP_MINUTE",
  "AI_CONCURRENCY_MAX", "AI_QUEUE_MAX", "AI_QUEUE_WAIT_MS", "AI_REQUEST_DEADLINE_MS",
  "AI_PRODUCER_DEADLINE_MS", "IDEMPOTENCY_FINALIZE_DEADLINE_MS",
  "IDEMPOTENCY_DUPLICATE_WAIT_MS", "APP_RESPONSE_DEADLINE_MS",
  "AI_MODEL_CALLS_PER_DAY",
  "AI_BUDGET_TIMEZONE"
]);
const applicationEnvironment = readEnvironmentFile("/etc/resume-ai/app.env", true, applicationKeys);
const quotaEnvironment = readEnvironmentFile("/etc/resume-ai/quota.env", true, quotaKeys);
for (const [key, expected] of Object.entries({
  AI_REQUEST_DEADLINE_MS: "45000",
  AI_PRODUCER_DEADLINE_MS: "50000",
  IDEMPOTENCY_FINALIZE_DEADLINE_MS: "60000",
  IDEMPOTENCY_DUPLICATE_WAIT_MS: "62000",
  APP_RESPONSE_DEADLINE_MS: "65000"
})) {
  if (quotaEnvironment[key] !== expected) {
    throw new Error(`${key} differs from the reviewed production deadline`);
  }
}
if (applicationEnvironment.AI_PROVIDER !== "deepseek") {
  throw new Error("AI_PROVIDER must be deepseek in production");
}
for (const [key, expected] of [
  ["AI_API_URL", "https://api.deepseek.com/chat/completions"],
  ["AI_MODELS_URL", "https://api.deepseek.com/models"]
]) {
  const configured = applicationEnvironment[key] || expected;
  if (configured !== expected) throw new Error(`${key} is not an approved DeepSeek endpoint`);
}

module.exports = {
  apps: [
    {
      name: processName,
      cwd: releaseDirectory,
      script: path.join(releaseDirectory, "node_modules/next/dist/bin/next"),
      interpreter: "/opt/nodejs/current/bin/node",
      args: `start --hostname 127.0.0.1 --port ${port}`,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      time: true,
      log_date_format: "YYYY-MM-DDTHH:mm:ss.SSSZ",
      out_file: `/var/log/resume-ai/${processName}-out.log`,
      error_file: `/var/log/resume-ai/${processName}-error.log`,
      combine_logs: true,
      max_memory_restart: "768M",
      restart_delay: 1000,
      exp_backoff_restart_delay: 100,
      min_uptime: "10s",
      max_restarts: 10,
      kill_timeout: 10000,
      listen_timeout: 15000,
      env: {
        ...applicationEnvironment,
        ...quotaEnvironment,
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(port)
      }
    }
  ]
};
