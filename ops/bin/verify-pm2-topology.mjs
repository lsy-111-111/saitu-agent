#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const dumpOnly = process.argv[2] === "--dump-only";
let livePath;
let dumpPath;
let releaseRoot;
let activePort;
let activeRelease;
let previousPort;
let previousRelease;
let appEnvironmentPath;
let quotaEnvironmentPath;
if (dumpOnly) {
  [
    dumpPath,
    releaseRoot,
    activePort,
    activeRelease,
    previousPort,
    previousRelease,
    appEnvironmentPath,
    quotaEnvironmentPath
  ] = process.argv.slice(3);
} else {
  [
    livePath,
    dumpPath,
    releaseRoot,
    activePort,
    activeRelease,
    previousPort,
    previousRelease,
    appEnvironmentPath,
    quotaEnvironmentPath
  ] = process.argv.slice(2);
}

if (!quotaEnvironmentPath || !dumpPath) {
  throw new Error(
    "usage: verify-pm2-topology.mjs live dump root activePort activeRelease previousPort previousRelease app.env quota.env"
  );
}

function readEnvironment(path) {
  const values = new Map();
  for (const [index, rawLine] of fs.readFileSync(path, "utf8").split("\n").entries()) {
    if (!rawLine || rawLine.startsWith("#")) continue;
    if (rawLine.includes("\r")) throw new Error(`CRLF in environment file at ${path}:${index + 1}`);
    const separator = rawLine.indexOf("=");
    if (separator < 1) throw new Error(`malformed environment row at ${path}:${index + 1}`);
    const key = rawLine.slice(0, separator);
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key) || values.has(key)) {
      throw new Error(`invalid or duplicate environment key at ${path}:${index + 1}`);
    }
    values.set(key, rawLine.slice(separator + 1));
  }
  return values;
}

const applicationEnvironment = readEnvironment(appEnvironmentPath);
const quotaEnvironment = readEnvironment(quotaEnvironmentPath);
if (!["", "finite", "user-unbounded"].includes(applicationEnvironment.get("SAITU_AI_EXECUTION_MODE") || "")) throw new Error("invalid application execution mode");
const expected = new Map([[`resume-ai-${activePort}`, activeRelease]]);
if (previousPort !== "none") expected.set(`resume-ai-${previousPort}`, previousRelease);
const activeHasWorker = fs.existsSync(`${releaseRoot}/${activeRelease}/scripts/competitions/v7/worker-entry.ts`);
for (const [name, release] of [...expected]) {
  if (fs.existsSync(`${releaseRoot}/${release}/scripts/competitions/v7/worker-entry.ts`)) {
    const check = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "verify-decision-worker-build.mjs"), `${releaseRoot}/${release}`], { env: { NODE_ENV: "production" }, stdio: "pipe", maxBuffer: 65536 });
    if (check.error || check.status !== 0) throw new Error(`PM2 release has an invalid Next-worker build: ${release}`);
    if (activeHasWorker) expected.set(`resume-ai-worker-${name.slice(-4)}`, release);
  }
}

function valueFrom(environment, key) {
  if (Object.hasOwn(environment, key)) return environment[key];
  if (environment.env && typeof environment.env === "object" && Object.hasOwn(environment.env, key)) {
    return environment.env[key];
  }
  return undefined;
}

function normalizeArguments(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.trim().split(/\s+/u).filter(Boolean);
  return [];
}

function verify(path, label) {
  const entries = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!Array.isArray(entries)) throw new Error(`${label} is not an array`);
  if (entries.length !== expected.size) {
    throw new Error(`${label} contains an extra, duplicate, or missing PM2 process`);
  }
  for (const entry of entries) {
    if (!expected.has(entry?.name)) throw new Error(`${label} contains an unapproved PM2 process`);
  }

  for (const [name, release] of expected) {
    const matches = entries.filter((entry) => entry?.name === name);
    if (matches.length !== 1) throw new Error(`${label} has a duplicate or missing ${name}`);
    const environment = matches[0].pm2_env ?? matches[0];
    const expectedDirectory = `${releaseRoot}/${release}`;
    const port = name.slice(-4);
    const isWorker = name.startsWith("resume-ai-worker-");
    if (environment.status !== "online" || environment.pm_cwd !== expectedDirectory) {
      throw new Error(`${label} does not bind ${name} to the expected online release`);
    }
    if (
      environment.pm_exec_path !== `${expectedDirectory}/${isWorker ? "dist/decision-worker/worker.mjs" : "node_modules/next/dist/bin/next"}` ||
      environment.exec_interpreter !== "/opt/nodejs/current/bin/node" ||
      environment.exec_mode !== "fork_mode"
    ) {
      throw new Error(`${label} has an unapproved executable, interpreter, or mode for ${name}`);
    }
    const expectedArguments = isWorker ? [] : ["start", "--hostname", "127.0.0.1", "--port", port];
    if (JSON.stringify(normalizeArguments(environment.args)) !== JSON.stringify(expectedArguments)) {
      throw new Error(`${label} has unapproved Next.js arguments for ${name}`);
    }
    const exactRuntimeEnvironment = new Map([
      ...applicationEnvironment,
      ...quotaEnvironment,
      ["APP_RELEASE_DIR", expectedDirectory],
      ["APP_PORT", port],
      ["APP_PROCESS_NAME", name],
      ["HOME", "/var/lib/resume-ai"],
      ["HOSTNAME", "127.0.0.1"],
      ["NODE_ENV", "production"],
      ["PM2_HOME", "/var/lib/resume-ai/.pm2"],
      ["PORT", port],
      ["PATH", "/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"]
    ]);
    if (fs.existsSync(`${expectedDirectory}/scripts/competitions/v7/worker-entry.ts`)) {
      const manifest = JSON.parse(fs.readFileSync(`${expectedDirectory}/dist/decision-worker/manifest.json`, "utf8"));
      if (manifest.schemaVersion !== "saitu.worker-build.v7" || !/^[a-f0-9]{64}$/u.test(manifest.sourceSha256)) throw new Error(`${label} has an invalid worker source binding`);
      const executionMode=applicationEnvironment.get("SAITU_AI_EXECUTION_MODE")||"finite";
      if(executionMode==="user-unbounded"?manifest.executionMode!=="user-unbounded":Object.hasOwn(manifest,"executionMode"))throw new Error(`${label} worker execution mode differs from application authorization`);
      exactRuntimeEnvironment.set("SAITU_V7_SOURCE_SHA256", manifest.sourceSha256);
      const effortRequired=fs.existsSync(`${expectedDirectory}/src/lib/ai/effort-policy.mjs`);
      if(effortRequired||Object.hasOwn(manifest,"effortPolicy")||Object.hasOwn(manifest,"effortPolicySha256")){
        const p=manifest.effortPolicy;
        if(!p||Object.keys(p).sort().join(",")!=="explain,rank,review,version"||p.version!=="saitu.effort-policy.v1"||["rank","explain","review"].some(stage=>!["high","low"].includes(p[stage])))throw new Error(`${label} lacks the signed worker effort policy`);
        const serialized=JSON.stringify({version:p.version,rank:p.rank,explain:p.explain,review:p.review}),fingerprint=createHash("sha256").update(serialized).digest("hex");
        if(manifest.effortPolicySha256!==fingerprint||applicationEnvironment.get("SAITU_V7_EFFORT_POLICY_SHA256")!==fingerprint)throw new Error(`${label} worker effort policy differs from application authorization`);
        exactRuntimeEnvironment.set("SAITU_V7_EFFORT_POLICY",serialized);exactRuntimeEnvironment.set("SAITU_V7_EFFORT_POLICY_SHA256",fingerprint);
      }
    }
    if (isWorker) {
      exactRuntimeEnvironment.set("SAITU_V7_WORKER_HEALTH_FILE", `/var/cache/resume-ai/${release}/decision-worker-health.json`);
      exactRuntimeEnvironment.set("SAITU_V7_WORKER_CONCURRENCY", applicationEnvironment.get("SAITU_V7_WORKER_CONCURRENCY") || "2");
    }
    for (const [key, expectedValue] of exactRuntimeEnvironment) {
      if (String(valueFrom(environment, key) ?? "") !== expectedValue) {
        throw new Error(`${label} has stale or missing ${key} for ${name}`);
      }
      if (
        environment.env &&
        typeof environment.env === "object" &&
        Object.hasOwn(environment.env, key) &&
        String(environment.env[key]) !== expectedValue
      ) {
        throw new Error(`${label} has a conflicting nested ${key} for ${name}`);
      }
    }
    const allowedUppercaseEnvironment = new Set([
      ...exactRuntimeEnvironment.keys(),
      "NODE_APP_INSTANCE",
      "PM2_INTERACTOR_PROCESSING",
      "PM2_JSON_PROCESSING",
      "PM2_USAGE"
    ]);
    for (const environmentLayer of [environment, environment.env]) {
      if (!environmentLayer || typeof environmentLayer !== "object") continue;
      for (const key of Object.keys(environmentLayer)) {
        if (/^[A-Z_][A-Z0-9_]*$/u.test(key) && !allowedUppercaseEnvironment.has(key)) {
          throw new Error(`${label} injects unapproved environment key ${key} into ${name}`);
        }
        if (
          /^(https?|all|no)_proxy$/iu.test(key) ||
          /^(ssl_cert_(file|dir)|openssl_(conf|modules))$/iu.test(key)
        ) {
          throw new Error(`${label} injects trust or proxy key ${key} into ${name}`);
        }
      }
    }
    const instanceContractIsExact =
      label === "persisted PM2 state"
        ? environment.instances === undefined || Number(environment.instances) === 1
        : Number(environment.instances) === 1;
    if (
      !instanceContractIsExact ||
      environment.autorestart !== true ||
      environment.watch !== false ||
      environment.merge_logs !== true ||
      Number(environment.max_memory_restart) !== (isWorker ? 384 : 768) * 1024 * 1024 ||
      Number(environment.restart_delay) !== 1000 ||
      Number(environment.exp_backoff_restart_delay) !== 100 ||
      Number(environment.min_uptime) !== 10_000 ||
      Number(environment.max_restarts) !== 10 ||
      Number(environment.kill_timeout) !== (isWorker ? 20_000 : 10_000) ||
      Number(environment.listen_timeout) !== 15_000
    ) {
      throw new Error(`${label} has unapproved lifecycle controls for ${name}`);
    }
    if (
      environment.pm_out_log_path !== `/var/log/resume-ai/${name}-out.log` ||
      environment.pm_err_log_path !== `/var/log/resume-ai/${name}-error.log`
    ) {
      throw new Error(`${label} writes ${name} logs outside the approved files`);
    }
  }
}

if (livePath) verify(livePath, "live PM2 state");
verify(dumpPath, "persisted PM2 state");
