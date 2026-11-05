import { execFile } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const copierPath = path.join(root, "ops/bin/create-bootstrap-generation.py");
const generatorPath = path.join(root, "ops/bin/generate-bootstrap-source-manifest.py");
const manifestPath = path.join(root, "bootstrap-source-manifest.txt");

describe("first-root bootstrap generation", () => {
  it("has a reproducible canonical full-ops manifest", async () => {
    const generated = await execFileAsync("python3", [
      "-I", generatorPath, "generate", root
    ], { maxBuffer: 16 * 1024 * 1024 });
    const committed = await readFile(manifestPath, "utf8");
    expect(generated.stdout).toBe(committed);
    const lines = committed.trimEnd().split("\n");
    expect(lines[0]).toBe("RESUME_AI_BOOTSTRAP_SOURCE_MANIFEST_V1");
    const members = lines.slice(1).map((line) => line.split("\t")[4]);
    expect(members).toEqual(
      [...members].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
    );
    expect(new Set(members).size).toBe(members.length);
    for (const required of [
      "ops/bin/create-bootstrap-generation.py",
      "ops/bin/capture-host-baseline.sh",
      "ops/bin/install-node-runtime.sh",
      "ops/bin/install-runtime-layout.sh",
      "ops/bin/record-cloud-snapshot-evidence.py",
      "ops/bin/verify-host-baseline.py"
    ]) {
      expect(members).toContain(required);
    }
    await expect(execFileAsync("python3", [
      "-I", generatorPath, "check", root, manifestPath
    ])).resolves.toBeDefined();
  });

  it("rejects a stale or operator-edited manifest", async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), "resume-ai-bootstrap-manifest-"));
    try {
      await mkdir(path.join(fixture, "ops/config"), { recursive: true });
      await mkdir(path.join(fixture, "ops/bin"), { recursive: true });
      await writeFile(path.join(fixture, "ops/config/control-plane-files.conf"), "# empty\n");
      await writeFile(path.join(fixture, "ops/bin/example.sh"), "#!/bin/sh\nexit 0\n");
      const tampered = path.join(fixture, "bootstrap-source-manifest.txt");
      const generated = await execFileAsync("python3", [
        "-I", generatorPath, "generate", fixture
      ]);
      await writeFile(tampered, generated.stdout, "utf8");
      await expect(execFileAsync("python3", [
        "-I", generatorPath, "check", fixture, tampered
      ])).resolves.toBeDefined();
      await writeFile(tampered, `${generated.stdout}FILE\t0400\t0\t${"0".repeat(64)}\tops/forged\n`);
      await expect(execFileAsync("python3", [
        "-I", generatorPath, "check", fixture, tampered
      ])).rejects.toMatchObject({ code: 1 });

      await writeFile(tampered, generated.stdout, "utf8");
      await link(
        path.join(fixture, "ops/bin/example.sh"),
        path.join(fixture, "ops/bin/example-hardlink.sh")
      );
      await expect(execFileAsync("python3", [
        "-I", generatorPath, "generate", fixture
      ])).rejects.toMatchObject({ code: 1 });
      await rm(path.join(fixture, "ops/bin/example-hardlink.sh"));
      await symlink("example.sh", path.join(fixture, "ops/bin/example-link.sh"));
      await expect(execFileAsync("python3", [
        "-I", generatorPath, "generate", fixture
      ])).rejects.toMatchObject({ code: 1 });
      await rm(path.join(fixture, "ops/bin/example-link.sh"));
      await execFileAsync("mkfifo", [path.join(fixture, "ops/bin/example.fifo")]);
      await expect(execFileAsync("python3", [
        "-I", generatorPath, "generate", fixture
      ])).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("uses no-clobber publication, a fixed lock, stable dirfd reads, and strict cleanup", async () => {
    const copier = await readFile(copierPath, "utf8");
    for (const contract of [
      "INSTALLED_SELF = pathlib.Path(\"/usr/local/lib/resume-ai/create-bootstrap-generation.py\")",
      "GENERATION_ROOT = pathlib.Path(\"/var/lib/resume-ai/bootstrap-generations\")",
      "ACTIVE_RECEIPT = pathlib.Path(\"/var/lib/resume-ai/bootstrap-generation.env\")",
      "RESUME_AI_BOOTSTRAP_SOURCE_MANIFEST_V1",
      "os.O_NOFOLLOW",
      "bootstrap source member changed while read",
      "/usr/local/lib/resume-ai/.bootstrap-generation.lock",
      "renameat2",
      "open_bootstrap_lock",
      "fcntl.flock",
      "cleanup_abandoned_publications",
      "validate_abandoned_stage",
      "physical_root_chain",
      "written < len(data)",
      "exact ops ordinary-file inventory"
    ]) {
      expect(copier).toContain(contract);
    }
    expect(copier).not.toContain("os.replace(");
    expect(copier).not.toContain("subprocess");
  });

  it("blocks candidate first-root entry points and binds baseline, Node, and layout", async () => {
    const baseline = await readFile(
      path.join(root, "ops/bin/capture-host-baseline.sh"), "utf8"
    );
    const node = await readFile(path.join(root, "ops/bin/install-node-runtime.sh"), "utf8");
    const layout = await readFile(path.join(root, "ops/bin/install-runtime-layout.sh"), "utf8");
    const snapshot = await readFile(
      path.join(root, "ops/bin/record-cloud-snapshot-evidence.py"), "utf8"
    );
    for (const source of [baseline, node, layout]) {
      expect(source).toContain("create-bootstrap-generation.py");
      expect(source).toContain("bootstrap generation failed its fixed verifier");
      expect(source).toContain("BOOTSTRAP_MANIFEST_SHA256");
    }
    for (const source of [node, layout]) {
      expect(source).toContain("HOST_BASELINE_MANIFEST_SHA256");
      expect(source).toContain("verify-host-baseline.py");
      expect(source).toContain("--verify-initial-pre-bootstrap");
    }
    expect(layout).toContain('BOOTSTRAP_BIN="$BOOTSTRAP_GENERATION/ops/bin"');
    expect(layout).toContain('"$BOOTSTRAP_BIN/record-cloud-snapshot-evidence.py"');
    expect(layout).not.toContain(
      '"$CANDIDATE_SOURCE_ROOT/ops/bin/record-cloud-snapshot-evidence.py"'
    );
    expect(baseline).toContain("bootstrap-boundary.env");
    expect(baseline).toContain("INITIAL_SNAPSHOT_RESPONSE_SHA256");
    expect(snapshot).toContain("initial snapshot control must execute from the active bootstrap generation");
    expect(snapshot.indexOf("verify_execution_trust(sys.argv[1])")).toBeLessThan(
      snapshot.lastIndexOf("claim_snapshot_id(")
    );
  });
});
