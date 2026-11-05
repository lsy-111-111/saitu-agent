"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

function assertProtectedFile(filePath, expectedMode) {
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error(`Protected legacy control must be one ordinary file: ${filePath}`);
  }
  if (stats.uid !== 0 || stats.gid !== process.getgid() || (stats.mode & 0o777) !== expectedMode) {
    throw new Error(`Protected legacy control has unsafe ownership or mode: ${filePath}`);
  }
}

function readExpectedKeys(policyPath) {
  assertProtectedFile(policyPath, 0o440);
  const keys = [];
  const seen = new Set();
  for (const [index, rawLine] of fs.readFileSync(policyPath, "utf8").split("\n").entries()) {
    if (!rawLine || rawLine.startsWith("#")) continue;
    if (!/^[A-Z][A-Z0-9_]*$/u.test(rawLine) || seen.has(rawLine)) {
      throw new Error(`Invalid legacy key policy at ${policyPath}:${index + 1}`);
    }
    seen.add(rawLine);
    keys.push(rawLine);
  }
  if (keys.length !== 31) throw new Error("Legacy environment policy must contain exactly 31 keys");
  return keys;
}

function readLegacyEnvironment(filePath, expectedKeys) {
  assertProtectedFile(filePath, 0o640);
  const raw = fs.readFileSync(filePath, "utf8");
  if (raw.includes("\0") || raw.includes("\r") || raw.includes("$")) {
    throw new Error("Legacy environment must not contain NUL, CRLF, or dotenv expansion data");
  }
  const expected = new Set(expectedKeys);
  const observed = new Set();
  for (const [index, line] of raw.split("\n").entries()) {
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match || !expected.has(match[1]) || observed.has(match[1])) {
      throw new Error(`Invalid, duplicate, or unapproved legacy environment entry at ${filePath}:${index + 1}`);
    }
    observed.add(match[1]);
  }
  if (observed.size !== expected.size || expectedKeys.some((key) => !observed.has(key))) {
    throw new Error("Legacy environment does not match the exact reviewed key set");
  }

  // Node 24 owns dotenv parsing without mutating the PM2 daemon environment.
  // This prevents legacy secrets from bleeding into a later modern process.
  let parsed;
  try {
    parsed = parseEnv(raw);
  } catch {
    throw new Error("Legacy environment could not be parsed by the pinned Node runtime");
  }
  const environment = Object.create(null);
  for (const key of expectedKeys) {
    if (parsed[key] === undefined) throw new Error(`Legacy environment did not load ${key}`);
    environment[key] = parsed[key];
  }
  return environment;
}

const releaseDirectory = process.env.APP_RELEASE_DIR || "";
const port = Number(process.env.APP_PORT || "0");
const processName = process.env.APP_PROCESS_NAME || "";
if (!/^\/opt\/resume-ai\/releases\/20\d{6}T\d{6}Z$/u.test(releaseDirectory)) {
  throw new Error("APP_RELEASE_DIR is not an immutable managed release path");
}
if (![3000, 3001].includes(port) || processName !== `resume-ai-${port}`) {
  throw new Error("Legacy process name and port are inconsistent");
}
const releaseStats = fs.lstatSync(releaseDirectory);
if (!releaseStats.isDirectory() || releaseStats.isSymbolicLink() || releaseStats.uid !== 0) {
  throw new Error("Legacy release root must be an ordinary root-owned directory");
}

const policyPath = path.join(releaseDirectory, "ops/config/legacy-env-keys.conf");
const legacyEnvironment = readLegacyEnvironment(
  "/etc/resume-ai/legacy.env",
  readExpectedKeys(policyPath)
);
if (legacyEnvironment.AI_PROVIDER !== "deepseek") {
  throw new Error("The adopted legacy provider must remain DeepSeek");
}
for (const key of ["AI_TEST_MODE", "ALLOW_AI_MOCK", "NEXT_PUBLIC_AI_TEST_MODE"]) {
  if (legacyEnvironment[key] !== "0") throw new Error(`${key} must be disabled in production`);
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
        ...legacyEnvironment,
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(port)
      }
    }
  ]
};
