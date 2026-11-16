import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
// @ts-expect-error The plain Node helper is shared with native PostgreSQL checks.
import { loadProductionEcosystem, pm2EntriesFromEcosystem, productionGrantEnvironment, renderEnvironment } from "../helpers/v7-production-environment.mjs";

const exec = promisify(execFile), root = process.cwd();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function fixture(directory: string, release = "20261109T000000Z", unbounded = false) {
  const sourceSha256 = "a".repeat(64), worker = "// deterministic test worker bytes\n";
  const releaseRoot = path.join(directory, release);
  await mkdir(path.join(releaseRoot, "dist/decision-worker"), { recursive: true });
  await mkdir(path.join(releaseRoot, ".next"));
  await mkdir(path.join(releaseRoot, "scripts/competitions/v7"), { recursive: true });
  await writeFile(path.join(releaseRoot, "scripts/competitions/v7/worker-entry.ts"), "// v7 source marker\n");
  const binding = JSON.stringify({ schemaVersion: "saitu.next-worker-binding.v7", ...(unbounded?{executionMode:"user-unbounded"}:{}), sourceSha256, workerArtifactSha256: hash(worker), nextBuildId: release });
  const manifest = { schemaVersion: "saitu.worker-build.v7", ...(unbounded?{executionMode:"user-unbounded"}:{}), sourceSha256, artifactSha256: hash(worker), nextBuildId: release, nextBindingSha256: hash(binding), nodeMajor: 24, inputs: ["scripts/competitions/v7/worker-entry.ts"] };
  await writeFile(path.join(releaseRoot, "dist/decision-worker/worker.mjs"), worker);
  await writeFile(path.join(releaseRoot, "dist/decision-worker/manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(releaseRoot, ".next/decision-worker-binding.json"), binding);
  await writeFile(path.join(releaseRoot, ".next/BUILD_ID"), release);
  await writeFile(path.join(releaseRoot, ".next/required-server-files.json"), JSON.stringify({ config: { env: { SAITU_V7_SOURCE_SHA256: sourceSha256, ...(unbounded?{SAITU_AI_EXECUTION_MODE:"user-unbounded"}:{}) } } }));
  return { releaseRoot, release, manifest, sourceSha256 };
}
function run(script: string, args: string[]) { return exec(process.execPath, [path.join(root, "ops/bin", script), ...args]); }

describe("v7 decision worker operations contract", () => {
  it("passes an exact high grant through the production app validator, PM2 whitelist and live/dump topology", async () => {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), "saitu-v7-grant-env-")));
    try {
      const slot = await fixture(directory), appEnvFile = path.join(directory, "app.env"), quotaEnvFile = path.join(directory, "quota.env");
      const values = productionGrantEnvironment({ databaseUrl: "postgresql://runtime:fixture@127.0.0.1/test_fixture", runId: "saitu-v7-20261109-formal-99", policySha256: "a".repeat(64), conditionSha256: "b".repeat(64) });
      await writeFile(appEnvFile, renderEnvironment(values), { mode: 0o640 });
      await writeFile(quotaEnvFile, await readFile(path.join(root, "ops/generated/application-quota.env")), { mode: 0o640 });
      await exec("bash", [path.join(root, "ops/bin/validate-app-env.sh"), "production", appEnvFile]);
      const ecosystem = loadProductionEcosystem({ root, releaseDirectory: slot.releaseRoot, appEnvFile, quotaEnvFile });
      for (const app of ecosystem.apps) for (const key of ["AI_SPEND_AUTHORIZED_EFFORT", "AI_SPEND_HIGH_CONDITION_SHA256", "AI_CALIBRATION_CALL_LIMIT"]) expect(app.env[key]).toBe(values[key]);
      const entries = pm2EntriesFromEcosystem(ecosystem), live = path.join(directory, "live.json"), dump = path.join(directory, "dump.json");
      await writeFile(live, JSON.stringify(entries)); await writeFile(dump, JSON.stringify(entries));
      const args = [live, dump, directory, "3000", slot.release, "none", "none", appEnvFile, quotaEnvFile];
      await expect(run("verify-pm2-topology.mjs", args)).resolves.toBeDefined();
      for (const key of ["AI_SPEND_AUTHORIZED_EFFORT", "AI_SPEND_HIGH_CONDITION_SHA256", "AI_CALIBRATION_CALL_LIMIT"]) {
        const changed = JSON.parse(JSON.stringify(entries)); delete changed[1].pm2_env[key];
        await writeFile(live, JSON.stringify(changed));
        await expect(run("verify-pm2-topology.mjs", args)).rejects.toMatchObject({ code: 1 });
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects incomplete high authorization and malformed finite caps in both production readers", async () => {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), "saitu-v7-grant-invalid-")));
    try {
      const slot = await fixture(directory), appEnvFile = path.join(directory, "app.env"), quotaEnvFile = path.join(directory, "quota.env");
      const valid = productionGrantEnvironment({ databaseUrl: "postgresql://runtime:fixture@127.0.0.1/test_fixture", runId: "saitu-v7-20261109-formal-99", policySha256: "a".repeat(64), conditionSha256: "b".repeat(64) });
      await writeFile(quotaEnvFile, await readFile(path.join(root, "ops/generated/application-quota.env")), { mode: 0o640 });
      for (const patch of [
        { AI_SPEND_AUTHORIZED_EFFORT: "" }, { AI_SPEND_AUTHORIZED_EFFORT: "max" },
        { AI_SPEND_HIGH_CONDITION_SHA256: "" }, { AI_SPEND_HIGH_CONDITION_SHA256: "not-a-hash" },
        { AI_SPEND_POLICY_SHA256: "" }, { AI_SPEND_PHASE: "performance" },
        ...["0", "101", "1.5", "01"].map(AI_CALIBRATION_CALL_LIMIT => ({ AI_CALIBRATION_CALL_LIMIT }))
      ]) {
        await writeFile(appEnvFile, renderEnvironment({ ...valid, ...patch }), { mode: 0o640 });
        await expect(exec("bash", [path.join(root, "ops/bin/validate-app-env.sh"), "production", appEnvFile])).rejects.toMatchObject({ code: 1 });
        expect(() => loadProductionEcosystem({ root, releaseDirectory: slot.releaseRoot, appEnvFile, quotaEnvFile })).toThrow();
      }
      for (const cap of ["1", "100"]) {
        await writeFile(appEnvFile, renderEnvironment({ ...valid, AI_CALIBRATION_CALL_LIMIT: cap }), { mode: 0o640 });
        await expect(exec("bash", [path.join(root, "ops/bin/validate-app-env.sh"), "production", appEnvFile])).resolves.toBeDefined();
        expect(loadProductionEcosystem({ root, releaseDirectory: slot.releaseRoot, appEnvFile, quotaEnvFile }).apps[1].env.AI_CALIBRATION_CALL_LIMIT).toBe(cap);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects worker tampering and a Next build with a different compiled source binding", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "saitu-v7-worker-build-"));
    try {
      const { releaseRoot } = await fixture(directory);
      await expect(run("verify-decision-worker-build.mjs", [releaseRoot])).resolves.toBeDefined();
      const workerFile = path.join(releaseRoot, "dist/decision-worker/worker.mjs"), worker = await readFile(workerFile, "utf8");
      await writeFile(workerFile, `${worker}// substituted\n`);
      await expect(run("verify-decision-worker-build.mjs", [releaseRoot])).rejects.toMatchObject({ code: 1 });
      await writeFile(workerFile, worker);
      await writeFile(path.join(releaseRoot, ".next/required-server-files.json"), JSON.stringify({ config: { env: { SAITU_V7_SOURCE_SHA256: "b".repeat(64) } } }));
      await expect(run("verify-decision-worker-build.mjs", [releaseRoot])).rejects.toMatchObject({ code: 1 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("requires a fresh health record for the requested slot and live PID", async () => {
    for (const unbounded of [false,true]) {
    const directory = await mkdtemp(path.join(tmpdir(), "saitu-v7-worker-health-"));
    try {
      const { releaseRoot, sourceSha256 } = await fixture(directory,undefined,unbounded);
      const healthFile = path.join(directory, "health.json");
      const healthy = { ...(unbounded?{executionMode:"user-unbounded",concurrency:null}:{}), schemaVersion: "saitu.worker-health.v7", releaseDirectory: releaseRoot, sourceSha256, status: "paused", databaseReady: true, pid: process.pid, updatedAt: new Date().toISOString() };
      await writeFile(healthFile, JSON.stringify(healthy), { mode: 0o600 });
      await expect(run("verify-decision-worker-health.mjs", [releaseRoot, "paused", healthFile])).resolves.toBeDefined();
      await expect(run("verify-decision-worker-build.mjs", [releaseRoot])).resolves.toBeDefined();
      if(unbounded){
        await writeFile(healthFile, JSON.stringify({...healthy,concurrency:2}));
        await expect(run("verify-decision-worker-health.mjs", [releaseRoot,"paused",healthFile])).rejects.toMatchObject({code:1});
        await writeFile(healthFile, JSON.stringify({...healthy,executionMode:"finite"}));
        await expect(run("verify-decision-worker-health.mjs", [releaseRoot,"paused",healthFile])).rejects.toMatchObject({code:1});
        await writeFile(healthFile, JSON.stringify(healthy));
      }
      await expect(run("verify-decision-worker-health.mjs", [releaseRoot, "paused", healthFile, "--pid", String(process.pid + 1)])).rejects.toMatchObject({ code: 1 });
      await expect(run("verify-decision-worker-health.mjs", [releaseRoot, "paused", healthFile, "--idle"])).rejects.toMatchObject({ code: 1 });
      await writeFile(healthFile, JSON.stringify({ ...healthy, inFlight: 0 }));
      await expect(run("verify-decision-worker-health.mjs", [releaseRoot, "paused", healthFile, "--pid", String(process.pid), "--idle"])).resolves.toBeDefined();
      await expect(run("verify-decision-worker-health.mjs", [releaseRoot, "active", healthFile])).rejects.toMatchObject({ code: 1 });
      await writeFile(healthFile, JSON.stringify({ ...healthy, updatedAt: new Date(Date.now() - 11_000).toISOString() }));
      await expect(run("verify-decision-worker-health.mjs", [releaseRoot, "paused", healthFile])).rejects.toMatchObject({ code: 1 });
    } finally { await rm(directory, { recursive: true, force: true }); }
    }
  });

  it("drains before deleting only the named inactive worker and retains it when health cannot be proved", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "saitu-v7-worker-drain-"));
    try {
      await fixture(directory, "20261109T000000Z");
      await mkdir(path.join(directory, "20261108T000000Z"));
      const source = await readFile(path.join(root, "ops/bin/rollback-release.sh"), "utf8");
      const begin = source.indexOf("drain_previous_worker_for_legacy() {");
      const end = source.indexOf("\nstart_release_process() {", begin);
      expect(begin).toBeGreaterThan(0); expect(end).toBeGreaterThan(begin);
      const actions = path.join(directory, "actions.txt");
      const script = `set -euo pipefail
${source.slice(begin, end)}
fail() { echo "$*" >&2; exit 1; }
root_node() { return "$HEALTH_RESULT"; }
pm2_as_app() { if [ "$1:$2" = pm2:pid ]; then echo 123; else echo "$*" >> "$ACTIONS"; fi; }
chmod() { :; }
sync() { :; }
sleep() { SECONDS=$((SECONDS+106)); }
drain_previous_worker_for_legacy 20261108T000000Z 20261109T000000Z 3001
`;
      const environment = { ...process.env, RELEASE_ROOT: directory, PM2_HOME: directory, ACTIONS: actions };
      await exec("bash", ["-c", script], { env: { ...environment, HEALTH_RESULT: "0" } });
      expect(await readFile(actions, "utf8")).toBe("pm2 delete resume-ai-worker-3001\npm2 save\n");
      await writeFile(actions, "");
      await expect(exec("bash", ["-c", script], { env: { ...environment, HEALTH_RESULT: "1" } })).rejects.toMatchObject({ code: 1 });
      expect(await readFile(actions, "utf8")).toBe("");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("requires both slot workers in live and persisted PM2 topology and rejects stale bindings", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "saitu-v7-worker-pm2-"));
    try {
      const active = await fixture(directory), previous = await fixture(directory, "20261108T000000Z");
      const entries = [];
      for (const [slot, port] of [[active, "3000"], [previous, "3001"]] as const) {
        for (const worker of [false, true]) {
          const name = `resume-ai-${worker ? "worker-" : ""}${port}`;
          const environment = {
            APP_RELEASE_DIR: slot.releaseRoot, APP_PORT: port, APP_PROCESS_NAME: name,
            HOME: "/var/lib/resume-ai", HOSTNAME: "127.0.0.1", NODE_ENV: "production",
            PM2_HOME: "/var/lib/resume-ai/.pm2", PORT: port,
            PATH: "/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            SAITU_V7_SOURCE_SHA256: slot.sourceSha256,
            ...(worker ? { SAITU_V7_WORKER_HEALTH_FILE: `/var/cache/resume-ai/${slot.release}/decision-worker-health.json`, SAITU_V7_WORKER_CONCURRENCY: "2" } : {})
          };
          entries.push({ name, pm2_env: { ...environment, status: "online", pm_cwd: slot.releaseRoot, pm_exec_path: `${slot.releaseRoot}/${worker ? "dist/decision-worker/worker.mjs" : "node_modules/next/dist/bin/next"}`, exec_interpreter: "/opt/nodejs/current/bin/node", exec_mode: "fork_mode", args: worker ? [] : ["start", "--hostname", "127.0.0.1", "--port", port], instances: 1, autorestart: true, watch: false, merge_logs: true, max_memory_restart: (worker ? 384 : 768) * 1024 * 1024, restart_delay: 1000, exp_backoff_restart_delay: 100, min_uptime: 10000, max_restarts: 10, kill_timeout: worker ? 20000 : 10000, listen_timeout: 15000, pm_out_log_path: `/var/log/resume-ai/${name}-out.log`, pm_err_log_path: `/var/log/resume-ai/${name}-error.log` } });
        }
      }
      const live = path.join(directory, "live.json"), dump = path.join(directory, "dump.json"), env = path.join(directory, "app.env"), quota = path.join(directory, "quota.env");
      await writeFile(env, ""); await writeFile(quota, "");
      await writeFile(live, JSON.stringify(entries)); await writeFile(dump, JSON.stringify(entries));
      const args = [live, dump, directory, "3000", active.release, "3001", previous.release, env, quota];
      await expect(run("verify-pm2-topology.mjs", args)).resolves.toBeDefined();
      await writeFile(live, JSON.stringify(entries.filter(entry => entry.name !== "resume-ai-worker-3001")));
      await expect(run("verify-pm2-topology.mjs", args)).rejects.toMatchObject({ code: 1 });
      entries.find(entry => entry.name === "resume-ai-worker-3000")!.pm2_env.SAITU_V7_SOURCE_SHA256 = "b".repeat(64);
      await writeFile(live, JSON.stringify(entries));
      await expect(run("verify-pm2-topology.mjs", args)).rejects.toMatchObject({ code: 1 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
