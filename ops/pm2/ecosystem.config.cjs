"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

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
  "AI_REASONING_EFFORT", "AI_SPEND_POLICY_SHA256", "AI_SPEND_RUN_ID", "AI_SPEND_LIMIT_CNY", "AI_SPEND_FUNDED_CNY", "AI_SPEND_PHASE",
  "AI_SPEND_AUTHORIZED_EFFORT", "AI_SPEND_HIGH_CONDITION_SHA256", "AI_SPEND_EFFORT_CONDITION_SHA256", "AI_CALIBRATION_CALL_LIMIT",
  "SAITU_V7_EFFORT_POLICY", "SAITU_V7_EFFORT_POLICY_SHA256", "SAITU_AI_EXECUTION_MODE",
  "SAITU_DECISION_STRATEGY", "SAITU_CATALOG_SNAPSHOT_PATH", "SAITU_V7_WORKER_CONCURRENCY",
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
const executionMode=applicationEnvironment.SAITU_AI_EXECUTION_MODE||"finite";
if(!["finite","user-unbounded"].includes(executionMode))throw new Error("Invalid AI execution mode");
const userUnbounded=executionMode==="user-unbounded";
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

const hasEffortSource = fs.existsSync(path.join(releaseDirectory, "src/lib/ai/effort-policy.mjs"));
const hasTop5Source = fs.existsSync(path.join(releaseDirectory, "db/migrations/20261109_spend_v7_top5_policy.sql"));
if(userUnbounded&&!hasTop5Source)throw new Error("User-unbounded execution requires Top5 source");
if(userUnbounded&&!fs.existsSync(path.join(releaseDirectory,"src/lib/ai/execution-policy.mjs")))throw new Error("User-unbounded execution requires its reviewed source");
const parseEffort = value => {
  if (!value || typeof value!=="object" || Array.isArray(value) || Object.keys(value).sort().join(",")!=="explain,rank,review,version" || value.version!=="saitu.effort-policy.v1" || ["rank","explain","review"].some(stage=>!["high","low"].includes(value[stage]))) throw new Error("Invalid v7 effort policy");
  return {version:value.version,rank:value.rank,explain:value.explain,review:value.review};
};
const effortHash = value => createHash("sha256").update(JSON.stringify(parseEffort(value))).digest("hex");
const hasWorker = fs.existsSync(path.join(releaseDirectory, "scripts/competitions/v7/worker-entry.ts"));
if (hasWorker || Object.keys(applicationEnvironment).some(key => key.startsWith("AI_SPEND_") || key === "AI_CALIBRATION_CALL_LIMIT")) {
  const policy = applicationEnvironment.AI_SPEND_POLICY_SHA256 || "";
  const condition = applicationEnvironment.AI_SPEND_HIGH_CONDITION_SHA256 || "";
  const effort = applicationEnvironment.AI_REASONING_EFFORT || "";
  const authorized = applicationEnvironment.AI_SPEND_AUTHORIZED_EFFORT || "";
  const run = applicationEnvironment.AI_SPEND_RUN_ID || "";
  const phase = applicationEnvironment.AI_SPEND_PHASE || "";
  const digest = value => /^[a-f0-9]{64}$/u.test(value);
  if ((policy && !digest(policy)) || (condition && !digest(condition)) || !["", "max", "high", "stage"].includes(authorized)) throw new Error("Invalid spend authorization format");
  const stageRaw = applicationEnvironment.SAITU_V7_EFFORT_POLICY;
  const stageSha = applicationEnvironment.SAITU_V7_EFFORT_POLICY_SHA256;
  const stageCondition = applicationEnvironment.AI_SPEND_EFFORT_CONDITION_SHA256;
  if (stageRaw || stageSha || stageCondition || authorized === "stage" || hasEffortSource) {
    let stagePolicy; try { stagePolicy = parseEffort(JSON.parse(stageRaw)); } catch { throw new Error("Explicit stage effort policy required"); }
    const match = new RegExp(`^saitu-v7-${userUnbounded?"top5-unbounded":hasTop5Source?"top5":"effort"}-20261109-(calibration|formal|repair|performance|reserve)-[0-9]{2}$`, "u").exec(run);
    if (!hasEffortSource || !policy || !match || match[1]!==phase || effort!=="high" || authorized!=="stage" || condition || !digest(stageCondition||"") || stageSha!==effortHash(stagePolicy)) throw new Error("v7 stage effort grant binding differs");
    if (hasTop5Source && ["rank","explain","review"].some(key=>stagePolicy[key]!=="low")) throw new Error("Top5 requires the approved low/low/low policy");
  } else if (policy) {
    const match = /^saitu-v7-20261109-(calibration|formal|repair|performance|reserve)-[0-9]{2}$/u.exec(run);
    if (!match || match[1] !== phase || effort !== "high" || authorized !== "high" || !condition) throw new Error("v7 high spend requires its exact phase, effort and condition binding");
  } else if (effort === "high") {
    if (!/^saitu-c-sync-20261106-[0-9]{2}$/u.test(run) || phase !== "calibration" || authorized !== "high" || !condition) throw new Error("Legacy high spend requires its exact conditional calibration grant");
  } else if (effort !== "max" || !["", "max"].includes(authorized) || condition) throw new Error("Conflicting max/high spend authorization");
  const cap = applicationEnvironment.AI_CALIBRATION_CALL_LIMIT || "";
  if (!userUnbounded && cap && (!/^[1-9][0-9]*$/u.test(cap) || Number(cap) > 100)) throw new Error("AI_CALIBRATION_CALL_LIMIT must be 1 through 100");
}
let workerManifest;
if (hasWorker) {
  const workerRoot = path.join(releaseDirectory, "dist/decision-worker");
  const ordinaryBytes = (filename) => {
    const metadata = fs.lstatSync(filename);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || fs.realpathSync(filename) !== filename) throw new Error("Unsafe decision worker build member");
    return fs.readFileSync(filename);
  };
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  workerManifest = JSON.parse(ordinaryBytes(path.join(workerRoot, "manifest.json")));
  const nextBindingBytes = ordinaryBytes(path.join(releaseDirectory, ".next/decision-worker-binding.json"));
  const nextBinding = JSON.parse(nextBindingBytes);
  const nextBuildId = ordinaryBytes(path.join(releaseDirectory, ".next/BUILD_ID")).toString("utf8").trim();
  const nextConfig = JSON.parse(ordinaryBytes(path.join(releaseDirectory, ".next/required-server-files.json"))).config;
  const hasManifestEffort = Object.hasOwn(workerManifest,"effortPolicy") || Object.hasOwn(workerManifest,"effortPolicySha256");
  if(userUnbounded ? workerManifest.executionMode!=="user-unbounded"||nextBinding.executionMode!=="user-unbounded"||nextConfig?.env?.SAITU_AI_EXECUTION_MODE!=="user-unbounded" : Object.hasOwn(workerManifest,"executionMode")||Object.hasOwn(nextBinding,"executionMode")||nextConfig?.env?.SAITU_AI_EXECUTION_MODE!==undefined)throw new Error("Application execution mode must match the signed Next-worker build");
  if (hasEffortSource || hasManifestEffort) {
    const policy = parseEffort(workerManifest.effortPolicy), fingerprint = effortHash(policy), serialized = JSON.stringify(policy);
    if (workerManifest.effortPolicySha256!==fingerprint || nextBinding.effortPolicySha256!==fingerprint || JSON.stringify(nextBinding.effortPolicy)!==serialized || nextConfig?.env?.SAITU_V7_EFFORT_POLICY!==serialized || nextConfig?.env?.SAITU_V7_EFFORT_POLICY_SHA256!==fingerprint || effortHash(JSON.parse(applicationEnvironment.SAITU_V7_EFFORT_POLICY))!==fingerprint || applicationEnvironment.SAITU_V7_EFFORT_POLICY_SHA256!==fingerprint) throw new Error("Application effort must match the signed Next-worker build");
  } else if (Object.hasOwn(nextBinding,"effortPolicy") || Object.hasOwn(nextBinding,"effortPolicySha256") || nextConfig?.env?.SAITU_V7_EFFORT_POLICY!==undefined || nextConfig?.env?.SAITU_V7_EFFORT_POLICY_SHA256!==undefined) throw new Error("Legacy build carries an unbound effort override");
  if (workerManifest.schemaVersion !== "saitu.worker-build.v7" || !/^[a-f0-9]{64}$/u.test(workerManifest.sourceSha256) || workerManifest.artifactSha256 !== hash(ordinaryBytes(path.join(workerRoot, "worker.mjs"))) || workerManifest.nextBindingSha256 !== hash(nextBindingBytes) || nextBinding.sourceSha256 !== workerManifest.sourceSha256 || nextConfig?.env?.SAITU_V7_SOURCE_SHA256 !== workerManifest.sourceSha256 || nextBinding.workerArtifactSha256 !== workerManifest.artifactSha256 || nextBinding.schemaVersion !== "saitu.next-worker-binding.v7" || !nextBuildId || workerManifest.nextBuildId !== nextBuildId || nextBinding.nextBuildId !== nextBuildId) throw new Error("Next and decision worker must be one verified build");
}
const runtimeEnvironment = {
  ...applicationEnvironment, ...quotaEnvironment, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port),
  APP_RELEASE_DIR: releaseDirectory,
  ...(workerManifest ? { SAITU_V7_SOURCE_SHA256: workerManifest.sourceSha256, ...(workerManifest.effortPolicy ? {SAITU_V7_EFFORT_POLICY:JSON.stringify(parseEffort(workerManifest.effortPolicy)),SAITU_V7_EFFORT_POLICY_SHA256:workerManifest.effortPolicySha256} : {}) } : {})
};
const application = {
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
      env: runtimeEnvironment
};
const worker = hasWorker ? {
  ...application,
  name: `resume-ai-worker-${port}`,
  script: path.join(releaseDirectory, "dist/decision-worker/worker.mjs"),
  args: [],
  max_memory_restart: "384M",
  kill_timeout: 20000,
  out_file: `/var/log/resume-ai/resume-ai-worker-${port}-out.log`,
  error_file: `/var/log/resume-ai/resume-ai-worker-${port}-error.log`,
  env: {
    ...runtimeEnvironment,
    APP_RELEASE_DIR: releaseDirectory,
    APP_PROCESS_NAME: `resume-ai-worker-${port}`,
    SAITU_V7_WORKER_HEALTH_FILE: `/var/cache/resume-ai/${path.basename(releaseDirectory)}/decision-worker-health.json`,
    SAITU_V7_WORKER_CONCURRENCY: applicationEnvironment.SAITU_V7_WORKER_CONCURRENCY || "2"
  }
} : undefined;
module.exports = { apps: [application, ...(worker ? [worker] : [])] };
