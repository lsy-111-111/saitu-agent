import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const installerPath = path.join(root, "ops/bin/install-runtime-layout.sh");

function extractHeredoc(source: string, marker: string) {
  const opening = `<<'${marker}'\n`;
  const start = source.indexOf(opening);
  const end = source.indexOf(`\n${marker}`, start + opening.length);
  if (start < 0 || end < 0) throw new Error(`missing ${marker} heredoc`);
  return source.slice(start + opening.length, end);
}

const explicitInputs = [
  "ops/config/control-plane-files.conf",
  "ops/bin/install-runtime-layout.sh",
  "ops/bin/open-root-lock.sh",
  "ops/bin/verify-control-plane-generation.py",
  "ops/bin/install-control-plane-generation.sh",
  "ops/bin/recover-control-plane-generation.sh",
  "ops/generated/quota-generation.env",
  "ops/generated/application-quota.env",
  "ops/generated/00-resume-ai-global.conf",
  "ops/generated/nginx-quota.inc",
  "ops/generated/nginx-track-quota.inc",
  "ops/config/app.env.example"
];

async function createSourceFixture(destination: string) {
  const specText = await readFile(
    path.join(root, "ops/config/control-plane-files.conf"),
    "utf8"
  );
  const allowlisted = specText
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("\t")[1]);
  for (const relative of new Set([...allowlisted, ...explicitInputs])) {
    const source = path.join(root, relative);
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    await copyFile(source, target);
    const metadata = await stat(source);
    await chmod(target, metadata.mode & 0o111 ? 0o555 : 0o444);
  }
  await chmod(destination, 0o700);
}

async function createTransactionRoot(fixture: string, label: string) {
  const transaction = path.join(fixture, label);
  const generations = path.join(transaction, "generations");
  const state = path.join(transaction, "state");
  await mkdir(generations, { recursive: true, mode: 0o700 });
  await mkdir(state, { recursive: true, mode: 0o700 });
  await chmod(transaction, 0o700);
  await chmod(generations, 0o700);
  await chmod(state, 0o700);
  return {
    generations,
    pending: path.join(state, "runtime-layout.pending")
  };
}

describe("runtime-layout bootstrap source transaction", () => {
  it("contains no candidate helper execution before the durable snapshot boundary", async () => {
    const source = await readFile(installerPath, "utf8");
    const snapshotBoundary = source.indexOf("OPS_DIR=\"$SNAPSHOT_ROOT/ops\"");
    const beforeSnapshot = source.slice(0, snapshotBoundary);
    const afterSnapshot = source.slice(snapshotBoundary);

    expect(snapshotBoundary).toBeGreaterThan(0);
    expect(beforeSnapshot).toContain("open_bootstrap_lock 9 deploy");
    expect(beforeSnapshot).toContain("open_bootstrap_lock 8 control-plane");
    expect(beforeSnapshot).not.toMatch(/^\s*\.\s+.*open-root-lock/mu);
    expect(beforeSnapshot).toContain("PY_RUNTIME_LAYOUT_SNAPSHOT_TCB");
    expect(beforeSnapshot).toContain("os.O_NOFOLLOW");
    expect(beforeSnapshot).toContain("dir_fd=current");
    expect(beforeSnapshot).toContain("runtime-layout source drifted during snapshot");
    expect(beforeSnapshot).toContain("RUNTIME_LAYOUT_SNAPSHOT_EXEC=1");
    expect(beforeSnapshot).toContain("SOURCE_GENERATION_SHA256");
    expect(beforeSnapshot).toContain("GENERATION_PATH");
    expect(afterSnapshot).not.toContain("$CANDIDATE_SOURCE_ROOT");
    expect(afterSnapshot).toContain("$SNAPSHOT_ROOT");
    expect(source).toContain("final_snapshot_state=\"$(run_runtime_layout_snapshot_tcb validate");
    expect(source).toContain("runtime-layout pending snapshot identity changed during bootstrap");
  });

  it("rejects a pre-existing snapshot registry symlink before install -d can follow it", async () => {
    const source = await readFile(installerPath, "utf8");
    const registry = "/var/lib/resume-ai/security/cloud-snapshots/by-snapshot-id";
    const preflight = source.indexOf(registry);
    const creation = source.indexOf(`install -d -o root -g root -m 0700 ${registry}`);
    expect(preflight).toBeGreaterThan(0);
    expect(creation).toBeGreaterThan(preflight);

    const functionStart = source.indexOf("reject_linked_ancestry() {");
    const functionEnd = source.indexOf("for planned_directory in", functionStart);
    expect(functionStart).toBeGreaterThan(0);
    expect(functionEnd).toBeGreaterThan(functionStart);
    const fixture = await mkdtemp(
      path.join(root, "tests/deployment/.runtime-layout-registry-")
    );
    try {
      const real = path.join(fixture, "real");
      const alias = path.join(fixture, "cloud-snapshots");
      const harness = path.join(fixture, "reject-linked-ancestry.sh");
      await mkdir(real, { mode: 0o700 });
      await symlink(real, alias);
      await writeFile(
        harness,
        "#!/usr/bin/env bash\nset -euo pipefail\n"
          + "fail() { printf '%s\\n' \"ERROR: $*\" >&2; exit 1; }\n"
          + source.slice(functionStart, functionEnd)
          + "reject_linked_ancestry \"$1\"\n"
      );
      await chmod(harness, 0o700);
      await expect(execFileAsync("bash", [
        harness, path.join(alias, "by-snapshot-id")
      ])).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("pins source dirfds and rejects writable, linked, hardlinked, drifted, or forged generations", async () => {
    const source = await readFile(installerPath, "utf8");
    const tcb = extractHeredoc(source, "PY_RUNTIME_LAYOUT_SNAPSHOT_TCB");
    const fixture = await mkdtemp(
      path.join(root, "tests/deployment/.runtime-layout-bootstrap-")
    );
    const candidateParent = path.join(fixture, "candidate-parent");
    const candidate = path.join(candidateParent, "source");
    const tcbPath = path.join(fixture, "snapshot-tcb.py");
    const uid = process.getuid?.() ?? -1;
    const gid = process.getgid?.() ?? -1;
    const invoke = (
      action: "create" | "validate",
      pending: string,
      generations: string,
      sourceOrExpected: string
    ) => execFileAsync("python3", [
      "-I", tcbPath, action, pending, generations, sourceOrExpected,
      String(uid), String(gid),
      action === "create" ? "2020-01-01T00:00:00Z" : "-",
      `/var/lib/resume-ai/bootstrap-generations/generation-${"d".repeat(64)}`,
      "d".repeat(64),
      "/var/backups/resume-ai/prechange/20200101T000000Z",
      "e".repeat(64)
    ]);

    try {
      expect(uid).toBeGreaterThanOrEqual(0);
      expect(gid).toBeGreaterThanOrEqual(0);
      await mkdir(candidateParent, { recursive: true, mode: 0o700 });
      await createSourceFixture(candidate);
      await writeFile(tcbPath, tcb);

      const writableParent = await createTransactionRoot(fixture, "writable-parent");
      await chmod(candidateParent, 0o777);
      await expect(invoke(
        "create", writableParent.pending, writableParent.generations, candidate
      )).rejects.toMatchObject({ code: 1 });
      await chmod(candidateParent, 0o700);

      const writableSubdir = await createTransactionRoot(fixture, "writable-subdir");
      await chmod(path.join(candidate, "ops/bin"), 0o775);
      await expect(invoke(
        "create", writableSubdir.pending, writableSubdir.generations, candidate
      )).rejects.toMatchObject({ code: 1 });
      await chmod(path.join(candidate, "ops/bin"), 0o755);

      const linked = path.join(candidate, "ops/config/app.env.example");
      const linkedBackup = `${linked}.ordinary`;
      await rename(linked, linkedBackup);
      await symlink("app.env.example.ordinary", linked);
      const symlinkTransaction = await createTransactionRoot(fixture, "symlink");
      await expect(invoke(
        "create", symlinkTransaction.pending, symlinkTransaction.generations, candidate
      )).rejects.toMatchObject({ code: 1 });
      await unlink(linked);
      await rename(linkedBackup, linked);

      const hardlinkMember = path.join(candidate, "ops/config/app.env.example");
      const extraHardlink = path.join(candidateParent, "extra-hardlink");
      await link(hardlinkMember, extraHardlink);
      const hardlinkTransaction = await createTransactionRoot(fixture, "hardlink");
      await expect(invoke(
        "create", hardlinkTransaction.pending, hardlinkTransaction.generations, candidate
      )).rejects.toMatchObject({ code: 1 });
      await unlink(extraHardlink);

      const parentRenameHarness = `${tcb.slice(0, tcb.indexOf('if __name__ == "__main__":'))}\n`
        + `EXPECTED_UID = int(sys.argv[4])\nEXPECTED_GID = int(sys.argv[5])\n`
        + `tree = RootFrozenTree(sys.argv[1])\n`
        + `os.rename(sys.argv[2], sys.argv[3])\n`
        + `try:\n    collect_source(tree)\nfinally:\n    tree.close()\n`;
      const parentHarnessPath = path.join(fixture, "parent-rename.py");
      const movedParent = path.join(fixture, "candidate-parent-moved");
      await writeFile(parentHarnessPath, parentRenameHarness);
      await expect(execFileAsync("python3", [
        "-I", parentHarnessPath, candidate, candidateParent, movedParent,
        String(uid), String(gid)
      ])).resolves.toBeDefined();
      await rename(movedParent, candidateParent);

      const driftHarness = `${tcb.slice(0, tcb.indexOf('if __name__ == "__main__":'))}\n`
        + `EXPECTED_UID = int(sys.argv[2])\nEXPECTED_GID = int(sys.argv[3])\n`
        + `tree = RootFrozenTree(sys.argv[1])\noriginal = tree.read\ncalls = 0\n`
        + `target = "ops/bin/install-runtime-layout.sh"\n`
        + `def drifting(relative):\n`
        + `    global calls\n    if relative == target:\n        calls += 1\n`
        + `        if calls == 2:\n`
        + `            fd = os.open("install-runtime-layout.sh", os.O_WRONLY | os.O_APPEND, dir_fd=tree.directory_fd(("ops", "bin")))\n`
        + `            try:\n                os.write(fd, b"\\n# deterministic drift\\n")\n            finally:\n                os.close(fd)\n`
        + `    return original(relative)\n`
        + `tree.read = drifting\n`
        + `try:\n    collect_source(tree)\nexcept SystemExit:\n    pass\nelse:\n    raise SystemExit("source drift was accepted")\nfinally:\n    tree.close()\n`;
      const driftHarnessPath = path.join(fixture, "source-drift.py");
      const driftTarget = path.join(candidate, "ops/bin/install-runtime-layout.sh");
      const pristineInstaller = await readFile(driftTarget);
      await chmod(driftTarget, 0o700);
      await writeFile(driftHarnessPath, driftHarness);
      await expect(execFileAsync("python3", [
        "-I", driftHarnessPath, candidate, String(uid), String(gid)
      ])).resolves.toBeDefined();
      await chmod(driftTarget, 0o600);
      await writeFile(driftTarget, pristineInstaller);
      await chmod(driftTarget, 0o555);

      const successful = await createTransactionRoot(fixture, "successful");
      const created = await invoke(
        "create", successful.pending, successful.generations, candidate
      );
      const [snapshotPath, generationHash] = created.stdout.trim().split("\t");
      expect(snapshotPath).toBe(
        path.join(successful.generations, `generation-${generationHash}`)
      );
      expect(generationHash).toMatch(/^[a-f0-9]{64}$/u);
      const pendingBefore = await readFile(successful.pending, "utf8");
      expect(pendingBefore.split("\n").filter(Boolean)).toHaveLength(11);
      expect(pendingBefore).toContain("SCHEMA_VERSION=5\n");
      expect(pendingBefore).toContain("STARTED_AT=2020-01-01T00:00:00Z\n");
      expect(pendingBefore).toContain(
        `BOOTSTRAP_MANIFEST_SHA256=${"d".repeat(64)}\n`
      );
      expect(pendingBefore).toContain(
        `HOST_BASELINE_MANIFEST_SHA256=${"e".repeat(64)}\n`
      );

      // Simulate power loss after generation rename and before pending publish.
      await unlink(successful.pending);
      const recoveredRenameWindow = await invoke(
        "create", successful.pending, successful.generations, candidate
      );
      expect(recoveredRenameWindow.stdout).toBe(created.stdout);
      expect(await readdir(successful.generations)).toEqual([
        `generation-${generationHash}`
      ]);
      expect(await readFile(successful.pending, "utf8")).toBe(pendingBefore);

      // Resume must bind only to the durable snapshot; later candidate drift is irrelevant.
      await chmod(driftTarget, 0o600);
      await writeFile(driftTarget, Buffer.from("replaced candidate bytes\n"));
      await chmod(driftTarget, 0o555);
      const resumed = await invoke(
        "validate", successful.pending, successful.generations, "-"
      );
      expect(resumed.stdout).toBe(created.stdout);

      const manifest = path.join(snapshotPath, "runtime-layout-snapshot.manifest");
      const manifestAlias = path.join(snapshotPath, "manifest-hardlink");
      await link(manifest, manifestAlias);
      await expect(invoke(
        "validate", successful.pending, successful.generations, "-"
      )).rejects.toMatchObject({ code: 1 });
      await unlink(manifestAlias);

      const forged = pendingBefore.replace(
        /^GENERATION_PATH=.*$/mu,
        `GENERATION_PATH=${fixture}/outside-generation`
      );
      await chmod(successful.pending, 0o600);
      await writeFile(successful.pending, forged);
      await chmod(successful.pending, 0o600);
      await expect(invoke(
        "validate", successful.pending, successful.generations, "-"
      )).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  }, 120_000);

  it("creates the Ed25519 trust anchor once and refuses overwrite or alias repair", async () => {
    const source = await readFile(installerPath, "utf8");
    const publisher = extractHeredoc(source, "PY_KEY_PUBLISH");
    expect(source).toContain(
      "EVIDENCE_GENERATIONS=/var/lib/resume-ai/release-evidence-generations"
    );
    expect(source).toContain("release-evidence-signing.key");
    expect(source).toContain("release-evidence-signing.pub");
    expect(source).toContain("-algorithm ED25519");
    expect(source).toContain("-----BEGIN PRIVATE KEY-----");
    expect(source).toContain("renameat2");
    expect(source).toContain("refusing overwrite");
    expect(source).toContain("public key differs from the private key derivation");
    expect(source).toContain("root:root:$mode:1");
    expect(source).toContain("cleanup_release_evidence_key_temps");
    expect(source).toContain("cleanup_orphaned_release_evidence_key_temps");
    expect(source).toContain(
      'publish_new_key_artifact "$signing_pending_temp" "$EVIDENCE_SIGNING_PENDING" 0600'
    );
    expect(source).not.toContain('mv -- "$signing_pending_temp" "$EVIDENCE_SIGNING_PENDING"');
    expect(source).toContain("refusing to clean unexpected key temp path");
    expect(source).toContain("trap cleanup_release_evidence_key_temps EXIT");
    expect(source).toContain("signing_private_temp=");
    expect(source).toContain("signing_public_temp=");
    expect(source).toContain("release-evidence-signing.pending");
    expect(source).toContain("PRIVATE_SHA256=");
    expect(source).toContain("PUBLIC_SHA256=");
    expect(source).toContain("unjournaled release-evidence keypair has a missing half");
    expect(source).toContain("journaled private key is missing and cannot be reconstructed");
    expect(source).toContain("derived public key differs from its durable journal");
    expect(source).toContain("journaled release-evidence public key exists without its private half");
    expect(source).toContain("EVIDENCE_SIGNING_MARKER=/etc/resume-ai/release-evidence-signing.env");
    expect(source).toContain("PROVISIONED_AT=%s");
    expect(source).toContain("PUBLIC_KEY_SHA256=%s");
    expect(source).toContain("ACK_ADOPT_EXISTING_EVIDENCE_SIGNING_KEY=YES");
    expect(source).toContain("adopting-existing");
    expect(source).toContain("release-evidence signing marker public hash drifted");
    expect(source).toContain("release-evidence keypair has no journaled provenance marker transaction");
    expect(source).toContain("directory_metadata=\"$(stat -c '%U:%a'");
    expect(source).not.toContain("directory_metadata=\"$(stat -c '%U:%a:%h'");
    expect(source).toContain("stat -c '%U:%G:%a' \"$lock_root\"");
    expect(source).not.toContain("stat -c '%U:%G:%a:%h' \"$lock_root\"");
    expect(source).toContain("stat -c '%U:%G:%a' \"$EVIDENCE_GENERATIONS\"");
    expect(source).not.toContain("stat -c '%U:%G:%a:%h' \"$EVIDENCE_GENERATIONS\"");
    expect(source.indexOf("sync -f \"$signing_pending_temp\"")).toBeLessThan(
      source.indexOf(
        'publish_new_key_artifact "$signing_pending_temp" "$EVIDENCE_SIGNING_PENDING"'
      )
    );
    expect(source.indexOf("cleanup_orphaned_release_evidence_key_temps\n")).toBeLessThan(
      source.indexOf("private_key_present=0")
    );
    const completeGuard = source.indexOf("runtime layout bootstrap is already complete");
    const keyGeneration = source.indexOf("openssl genpkey");
    expect(completeGuard).toBeGreaterThan(0);
    expect(completeGuard).toBeLessThan(source.indexOf("run_runtime_layout_snapshot_tcb"));
    expect(completeGuard).toBeLessThan(keyGeneration);

    // The completed/no-pending guard executes before any snapshot replay or
    // key generation, so rerunning bootstrap cannot regenerate or rotate keys.
    expect(source.slice(0, completeGuard)).toContain("$RUNTIME_LAYOUT_COMPLETE");
    expect(source.slice(0, completeGuard)).toContain("$RUNTIME_LAYOUT_PENDING");

  });

  it.skipIf(process.platform !== "linux")(
    "atomically no-clobbers key files and cleans failed or aborted key temps",
    async () => {
    const source = await readFile(installerPath, "utf8");
    const publisher = extractHeredoc(source, "PY_KEY_PUBLISH");
    const fixture = await mkdtemp(
      path.join(root, "tests/deployment/.runtime-layout-key-")
    );
    const publisherPath = path.join(fixture, "publisher.py");
    const first = path.join(fixture, "first.key");
    const second = path.join(fixture, "second.key");
    const destination = path.join(fixture, "persistent.key");
    const uid = process.getuid?.() ?? -1;
    const gid = process.getgid?.() ?? -1;
    try {
      await chmod(fixture, 0o700);
      await writeFile(publisherPath, publisher);
      await writeFile(first, "first immutable key\n", { mode: 0o600 });
      await chmod(first, 0o600);
      await execFileAsync("python3", [
        "-I", publisherPath, first, destination, "0600", String(uid), String(gid)
      ]);
      await writeFile(second, "replacement key\n", { mode: 0o600 });
      await chmod(second, 0o600);
      await expect(execFileAsync("python3", [
        "-I", publisherPath, second, destination, "0600", String(uid), String(gid)
      ])).rejects.toMatchObject({ code: 1 });
      expect(await readFile(destination, "utf8")).toBe("first immutable key\n");

      const linkedSource = path.join(fixture, "linked-source.key");
      await link(second, linkedSource);
      const otherDestination = path.join(fixture, "other.key");
      await expect(execFileAsync("python3", [
        "-I", publisherPath, second, otherDestination, "0600", String(uid), String(gid)
      ])).rejects.toMatchObject({ code: 1 });

      const cleanupStart = source.indexOf("cleanup_validated_release_evidence_key_temp() {");
      const cleanupEnd = source.indexOf("EVIDENCE_SIGNING_PRIVATE_KEY=", cleanupStart);
      const cleanupBlock = source.slice(cleanupStart, cleanupEnd);
      const cleanupHarness = path.join(fixture, "cleanup-harness.sh");
      const user = (await execFileAsync("id", ["-un"])).stdout.trim();
      const group = (await execFileAsync("id", ["-gn"])).stdout.trim();
      await mkdir(path.join(fixture, "directory-link-count-probe"), { mode: 0o700 });
      expect((await stat(fixture)).nlink).toBeGreaterThan(1);
      await writeFile(cleanupHarness, `#!/usr/bin/env bash\nset -euo pipefail\n${cleanupBlock}\n`
        + `cleanup_test_directory=$1\ncleanup_test_user=$2\ncleanup_test_group=$3\n`
        + `cleanup_release_evidence_key_temps() {\n`
        + `  cleanup_validated_release_evidence_key_temp "$cleanup_test_directory" "$cleanup_test_user" "$cleanup_test_group" "$signing_private_temp"\n`
        + `  cleanup_validated_release_evidence_key_temp "$cleanup_test_directory" "$cleanup_test_user" "$cleanup_test_group" "$signing_public_temp"\n}\n`
        + `signing_private_temp="$cleanup_test_directory/.release-evidence-signing.key.ABC123"\n`
        + `signing_public_temp="$cleanup_test_directory/.release-evidence-signing.pub.XYZ789"\n`
        + `case "\${4:-fail}" in fail) exit 73 ;; abort) kill -TERM $$ ;; esac\n`);
      await chmod(cleanupHarness, 0o700);
      for (const disposition of ["fail", "abort"]) {
        await writeFile(
          path.join(fixture, ".release-evidence-signing.key.ABC123"),
          "temporary private material\n",
          { mode: 0o600 }
        );
        await chmod(path.join(fixture, ".release-evidence-signing.key.ABC123"), 0o600);
        await writeFile(
          path.join(fixture, ".release-evidence-signing.pub.XYZ789"),
          "temporary public material\n",
          { mode: 0o644 }
        );
        await chmod(path.join(fixture, ".release-evidence-signing.pub.XYZ789"), 0o644);
        await expect(execFileAsync("bash", [
          cleanupHarness, fixture, user, group, disposition
        ])).rejects.toBeDefined();
        expect((await readdir(fixture)).filter((name) =>
          /^\.release-evidence-signing\.(?:key|pub)\./u.test(name)
        )).toEqual([]);
      }

      const orphanStart = source.indexOf(
        "cleanup_orphaned_release_evidence_key_temps() {"
      );
      const orphanEnd = source.indexOf(
        "trap cleanup_release_evidence_key_temps EXIT", orphanStart
      );
      const orphanHarness = path.join(fixture, "orphan-harness.sh");
      await writeFile(orphanHarness, `#!/usr/bin/env bash\nset -euo pipefail\n`
        + `fail() { printf '%s\\n' "ERROR: $*" >&2; exit 1; }\n`
        + `${source.slice(orphanStart, orphanEnd)}\n`
        + `cleanup_orphaned_release_evidence_key_temps "$1" "$2" "$3" "$2" "$3"\n`);
      await chmod(orphanHarness, 0o700);
      await chmod(fixture, 0o750);
      for (const [kind, mode] of [["key", 0o600], ["pub", 0o644], ["pending", 0o600], ["env", 0o600]] as const) {
        const orphan = path.join(fixture, `.release-evidence-signing.${kind}.ABC123`);
        await writeFile(orphan, `orphaned ${kind}\n`, { mode });
        await chmod(orphan, mode);
      }
      await execFileAsync("bash", [orphanHarness, fixture, user, group]);
      expect((await readdir(fixture)).filter((name) =>
        /^\.release-evidence-signing\.(?:key|pub|pending|env)\./u.test(name)
      )).toEqual([]);

      const unsafeOrphan = path.join(
        fixture, ".release-evidence-signing.key.BAD123"
      );
      const unsafeAlias = path.join(fixture, "unsafe-orphan-alias");
      await writeFile(unsafeOrphan, "orphaned private material\n", { mode: 0o600 });
      await chmod(unsafeOrphan, 0o600);
      await link(unsafeOrphan, unsafeAlias);
      await expect(execFileAsync("bash", [
        orphanHarness, fixture, user, group
      ])).rejects.toMatchObject({ code: 1 });
      expect(await readFile(unsafeOrphan, "utf8")).toContain("private material");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
