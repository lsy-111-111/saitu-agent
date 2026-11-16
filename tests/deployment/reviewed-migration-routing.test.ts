import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const root = process.cwd();
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const reviewedNames = [
  "20260826_runtime_delete_functions.sql",
  "20261105_ai_spend_ledger.sql",
  "20261105_decision_states.sql",
  "20261105_spend_authority.sql",
  "20261106_ai_spend_development_batches.sql",
  "20261106_ai_spend_development_effort.sql",
  "20261109_decision_runs.sql",
  "20261109_decision_runs_chat_requests.sql",
  "20261109_spend_v7_batches.sql",
  "20261109_spend_v7_effort_policy.sql",
  "20261109_spend_v7_top5_policy.sql",
  "20261109_spend_user_unbounded_execution.sql"
];

describe("reviewed migration deployment routing", () => {
  // Execute the real deployment selector without running deployment, backup,
  // database, or network operations. Only installed helper paths are relocated.
  async function fixture() {
    const directory = await mkdtemp(path.join(tmpdir(), "reviewed-migration-routing-"));
    await mkdir(path.join(directory, "db/migrations"), { recursive: true });
    const deploy = await readFile(path.join(root, "ops/bin/deploy-release.sh"), "utf8");
    const begin = deploy.indexOf('  migration_path="$STAGING_RELEASE/db/migrations/$migration_name"');
    const end = deploy.indexOf('  declared_migrations+=("$migration_name:$expected_hash")', begin);
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    const selector = deploy.slice(begin, end).replaceAll(
      "/usr/local/lib/resume-ai/", '"$VALIDATOR_ROOT"/'
    );
    const script = `set -euo pipefail
fail() { echo "$*" >&2; exit 1; }
sha256sum() { python3 -I -B -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1"; }
${selector}`;
    const run = async (name: string, bytes: Buffer | string, expectedHash = digest(bytes)) => {
      await writeFile(path.join(directory, "db/migrations", name), bytes);
      return exec("bash", ["-c", script], {
        env: { ...process.env, STAGING_RELEASE: directory, migration_name: name, expected_hash: expectedHash, VALIDATOR_ROOT: path.join(root, "ops/bin") }
      });
    };
    return { directory, run };
  }

  it("accepts all fourteen manifest migrations through the actual deployment selector", async () => {
    const { directory, run } = await fixture();
    try {
      const rows = (await readFile(path.join(root, "ops/config/migrations.manifest"), "utf8"))
        .split("\n").filter((line) => line && !line.startsWith("#"));
      expect(rows).toHaveLength(14);
      for (const row of rows) {
        const [hash, name, mode] = row.split(/\s+/u);
        expect(mode).toBe("expand");
        await expect(run(name, await readFile(path.join(root, "db/migrations", name)), hash)).resolves.toBeDefined();
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects wrong manifest hashes, byte tampering even with a matching manifest hash, wrong names and unknown reviewed SQL", async () => {
    const { directory, run } = await fixture();
    try {
      for (const name of reviewedNames) {
        const bytes = await readFile(path.join(root, "db/migrations", name));
        await expect(run(name, bytes, "0".repeat(64))).rejects.toMatchObject({ code: 1 });
        await expect(run(name, Buffer.concat([bytes, Buffer.from("\n-- tampered\n")]))).rejects.toMatchObject({ code: 1 });
        await expect(run("20261106_unknown_reviewed.sql", bytes)).rejects.toMatchObject({ code: 1 });
        const wrongName = reviewedNames.find((other) => other !== name)!;
        await expect(run(wrongName, bytes)).rejects.toMatchObject({ code: 1 });
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("keeps the generic expand restrictions and rejects unknown or symlinked reviewed files", async () => {
    const { directory, run } = await fixture();
    try {
      for (const sql of [
        "ALTER TABLE example ADD COLUMN secret text;\n",
        "GRANT SELECT ON TABLE example TO PUBLIC;\n",
        "REVOKE ALL ON TABLE unknown_table FROM PUBLIC;\n",
        "CREATE FUNCTION dangerous() RETURNS void LANGUAGE SQL AS 'SELECT 1';\n"
      ]) await expect(run("20261106_unknown.sql", sql)).rejects.toMatchObject({ code: 1 });
      const validator = path.join(root, "ops/bin/validate-reviewed-migration.py");
      const source = path.join(root, "db/migrations", reviewedNames[1]);
      const unknown = path.join(directory, "unknown.sql");
      await writeFile(unknown, await readFile(source));
      await expect(exec("python3", ["-I", "-B", validator, unknown])).rejects.toMatchObject({ code: 1 });
      const linked = path.join(directory, reviewedNames[1]);
      await symlink(source, linked);
      await expect(exec("python3", ["-I", "-B", validator, linked])).rejects.toMatchObject({ code: 1 });
      // Existing generic expand behavior is still available for simple new SQL.
      await expect(run("20261106_new_table.sql", "CREATE TABLE IF NOT EXISTS example (id integer PRIMARY KEY);\n")).resolves.toBeDefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
