import { execFile } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const runnerPath = path.join(root, "scripts/run-release-evidence.mjs");
const verifierPath = path.join(root, "ops/bin/verify-release-evidence.mjs");

describe("release evidence privilege boundary", () => {
  it("admits root only through the installed, source-manifest-bound coordinator", async () => {
    const source = await readFile(runnerPath, "utf8");
    expect(source).toContain(
      'const REQUIRED_COORDINATOR_PATH = "/usr/local/lib/resume-ai/run-release-evidence.mjs"'
    );
    expect(source).toContain("coordinator !== REQUIRED_COORDINATOR_PATH");
    expect(source).toContain("installed control file differs from reviewed source");
    expect(source).toContain('const SOURCE_MANIFEST_MEMBER = "scripts/run-release-evidence.mjs"');
    expect(source).not.toContain("spawn(process.execPath");
    expect(source).not.toMatch(/spawn\([^\n]+create-release-source-manifest\.sh/u);
  });

  it("runs every package/application gate as resume-ai-build through env-i and systemd-run", async () => {
    const source = await readFile(runnerPath, "utf8");
    expect(source).toContain('const BUILD_ACCOUNT = "resume-ai-build"');
    expect(source).toContain('const SYSTEMD_RUN = "/usr/bin/systemd-run"');
    expect(source).toContain('systemdArgv.push(ENV_BIN, "-i"');
    expect(source).toContain('"NoNewPrivileges=yes"');
    expect(source).toContain('"ProtectSystem=strict"');
    expect(source).toContain('"CapabilityBoundingSet="');
    expect(source).toContain('"PrivateNetwork=yes"');
    expect(source).toContain("sourceReadOnly: true");
    expect(source).toContain("BindPaths=");
    expect(source).toContain('"-/opt/resume-ai/releases"');
    expect(source).toContain('inaccessible.push("-/run/credentials")');
    for (const gate of [
      "typecheck",
      "lint",
      "unit",
      "production-build",
      "production-dependency-audit",
      "postgres-integration",
      "production-e2e"
    ]) {
      expect(source).toContain(`"${gate}"`);
    }
    expect(source).toContain("runPnpmGate({");
    expect(source).not.toContain("...process.env");
    expect(source).not.toContain("env: gateEnvironment");
  });

  it("never gives project code the DeepSeek credential", async () => {
    const source = await readFile(runnerPath, "utf8");
    expect(source).toContain('const VERIFY_ACCOUNT = "resume-ai-verify"');
    expect(source).toContain(
      'const REQUIRED_DEEPSEEK_VERIFIER_PATH = "/usr/local/lib/resume-ai/release-evidence-deepseek-verifier.mjs"'
    );
    expect(source).toContain("LoadCredential=");
    expect(source).toContain('credentialTransport: credentials.length ? "systemd-LoadCredential"');
    expect(source).toContain('"IPAddressDeny=any"');
    expect(source).toContain('resolveHost("api.deepseek.com")');
    expect(source).toContain("delete process.env.AI_API_KEY");
    expect(source).toContain('AI_API_KEY: ""');
    expect(source).not.toContain("scripts/verify-deepseek.mjs");
    expect(source).not.toMatch(/runPnpmGate\([\s\S]{0,300}deepseek-preflight/u);
  });

  it("uses a fixed resume-ai-verify HTTP probe instead of root network fetch", async () => {
    const source = await readFile(runnerPath, "utf8");
    expect(source).toContain(
      'const REQUIRED_HTTP_PROBE_PATH = "/usr/local/lib/resume-ai/release-evidence-http-probe.mjs"'
    );
    expect(source).toContain("runFixedRedirectProbe");
    expect(source).toContain('name: "www-redirect-probe"');
    expect(source).toContain(
      'request.href !== "https://www.siyuanjiaxin.com/release-evidence-probe"'
    );
    expect(source).toContain(
      'new URL("https://siyuanjiaxin.com/release-evidence-probe")'
    );
    expect(source).not.toContain('request.href !== "https://www.siyuanjiaxin.com/"');
    expect(source).not.toContain("const redirectResponse = await fetch");
  });

  it("binds every privileged evidence control and the exact www redirect contract to reviewed source rows", async () => {
    const source = await readFile(verifierPath, "utf8");
    for (const member of [
      "scripts/run-release-evidence.mjs",
      "scripts/lib/release-evidence-deepseek-verifier.mjs",
      "scripts/lib/release-evidence-http-probe.mjs",
      "scripts/lib/macos_trusted_deep_scan_generation.py"
    ]) {
      expect(source).toContain(`sourceRows.get("${member}")`);
    }
    expect(source).toContain("validation?.coordinator?.sha256 !== controlHashes.coordinator");
    expect(source).toContain("gate?.command?.verifierSha256 !== controlHashes.deepseek");
    expect(source).toContain("e2e?.wwwRedirect?.verifierSha256 !== controlHashes.httpProbe");
    expect(source).toContain(
      'e2e?.wwwRedirect?.requestUrl !== "https://www.siyuanjiaxin.com/release-evidence-probe"'
    );
    expect(source).toContain(
      'e2e?.wwwRedirect?.expectedLocation !== "https://siyuanjiaxin.com/release-evidence-probe"'
    );
  });

  it("seals each Linux validation generation with the persistent root trust anchor", async () => {
    const [runner, verifier, preparer] = await Promise.all([
      readFile(runnerPath, "utf8"),
      readFile(verifierPath, "utf8"),
      readFile(path.join(root, "ops/bin/prepare-release-bundle.sh"), "utf8")
    ]);
    for (const source of [runner, verifier]) {
      expect(source).toContain(
        'const REQUIRED_EVIDENCE_GENERATIONS_ROOT = "/var/lib/resume-ai/release-evidence-generations"'
      );
      expect(source).toContain(
        'const EVIDENCE_SIGNING_PUBLIC_KEY = "/etc/resume-ai/release-evidence-signing.pub"'
      );
    }
    expect(runner).toContain(
      'const EVIDENCE_SIGNING_PRIVATE_KEY = "/etc/resume-ai/release-evidence-signing.key"'
    );
    expect(runner).toContain("sealLinuxValidationGeneration({");
    expect(runner).toContain("signBytes(null, payloadBytes, privateKeyArtifact.bytes)");
    expect(runner).toContain("release evidence output must be a new generation-UUIDv4 below");
    expect(runner).not.toContain("/root/release-evidence/run-");
    expect(verifier).toContain("validateLinuxGenerationAttestation({");
    expect(verifier).toContain("verifyBytes(null, payloadBytes, publicKeyArtifact.bytes, signatureBytes)");
    expect(verifier).toContain("linuxValidationAttestation");
    expect(preparer).toContain("LINUX_VALIDATION_ATTESTATION_SHA256");
    expect(preparer).toContain('"linuxValidationAttestation": {');
  });

  it("rejects exclusions, empty surface ledgers, and scoped coverage at every Deep Scan evidence boundary", async () => {
    const sources = await Promise.all([
      readFile(path.join(root, "scripts/export-deep-scan-evidence.mjs"), "utf8"),
      readFile(path.join(root, "scripts/finalize-deep-scan-evidence.mjs"), "utf8"),
      readFile(verifierPath, "utf8")
    ]);
    for (const source of sources) {
      expect(source).toContain('coverage?.inventoryStrategy !== "repository"');
      expect(source).toContain('JSON.stringify(coverage?.includePaths) !== JSON.stringify(["."])');
      expect(source).toContain("coverage.excludePaths.length !== 0");
      expect(source).toContain("coverage.explicitExclusions.length !== 0");
      expect(source).toContain("coverage.surfaces.length === 0");
    }
  });

  it("binds the formal Deep Scan to one root-owned macOS generation and independent root approval", async () => {
    const [exporter, trustedGeneration, finalizer, verifier, approve, deploy] = await Promise.all([
      readFile(path.join(root, "scripts/export-deep-scan-evidence.mjs"), "utf8"),
      readFile(path.join(root, "scripts/lib/trusted-macos-deep-scan-generation.mjs"), "utf8"),
      readFile(path.join(root, "scripts/finalize-deep-scan-evidence.mjs"), "utf8"),
      readFile(verifierPath, "utf8"),
      readFile(path.join(root, "ops/bin/approve-release-bundle.sh"), "utf8"),
      readFile(path.join(root, "ops/bin/deploy-release.sh"), "utf8")
    ]);
    expect(exporter).toContain('"--trusted-generation-attestation-sha256"');
    expect(exporter).toContain('"--trusted-generation-producer-sha256"');
    expect(exporter).not.toContain("--scan-target-receipt");
    expect(exporter).not.toContain("scripts/prepare-deep-scan-target.mjs");
    expect(trustedGeneration).toContain('TRUSTED_GENERATIONS_ROOT = "/private/var/db/com.siyuanjiaxin.resume-ai/deep-scan-generations"');
    expect(trustedGeneration).toContain("metadata.uid !== 0n");
    expect(trustedGeneration).toContain("attestationArtifact.sha256 !== attestationSha256");
    for (const source of [exporter, finalizer, verifier]) {
      expect(source).toContain("trustedGenerationAttestation");
      expect(source).toContain("sourceModeManifestSha256");
    }
    for (const source of [finalizer, verifier]) {
      expect(source).toContain("canonicalFinding");
      expect(source).toContain("surface.receiptRefs.some");
      expect(source).toContain("receipt?.producer?.version");
    }
    expect(approve).toContain("SNAPSHOT_PARENT=/opt/resume-ai/approval-staging");
    expect(approve).toContain("TRUSTED_DEEP_SCAN_ATTESTATION_SHA256");
    expect(approve).toContain("TRUSTED_DEEP_SCAN_PRODUCER_SHA256");
    expect(approve).toContain("TRUSTED_DEEP_SCAN_COMPLETION_SHA256");
    expect(approve).toContain("SCHEMA_VERSION=6");
    expect(approve).toContain("LINUX_VALIDATION_ATTESTATION_SHA256=");
    expect(approve).toContain("TRUSTED_REQUIRED_TEST_POLICY_SHA256");
    expect(approve).toContain("REQUIRED_TEST_POLICY_SHA256=$TRUSTED_REQUIRED_TEST_POLICY_SHA256");
    expect(approve).toContain('if observed != binding["sha256"]:');
    expect(approve).toContain("Linux validation attestation differs from the release manifest");
    expect(deploy).toContain('[ "${#approval[@]}" -eq 13 ] && [ "${approval[SCHEMA_VERSION]:-}" = 6 ]');
    expect(deploy).toContain('observed_linux_validation_attestation_sha256" = "${approval[LINUX_VALIDATION_ATTESTATION_SHA256]}"');
    expect(deploy).toContain("signed Linux validation generation differs from the root approval");
    expect(deploy).toContain("REQUIRED_TEST_POLICY_SHA256");
    expect(deploy).toContain('--trusted-generation-attestation-sha256 "${approval[TRUSTED_DEEP_SCAN_ATTESTATION_SHA256]}"');
    expect(deploy).toContain('--trusted-deep-scan-completion-sha256 "${approval[TRUSTED_DEEP_SCAN_COMPLETION_SHA256]}"');
  });

  it("keeps release preparation on installed controls and disables candidate Git execution hooks", async () => {
    const [prepare, approve, secretScan] = await Promise.all([
      readFile(path.join(root, "ops/bin/prepare-release-bundle.sh"), "utf8"),
      readFile(path.join(root, "ops/bin/approve-release-bundle.sh"), "utf8"),
      readFile(path.join(root, "ops/bin/scan-release-secrets.sh"), "utf8")
    ]);
    expect(prepare).toContain("PREPARE_CONTROL=$CONTROL_ROOT/prepare-release-bundle.sh");
    expect(prepare).toContain('"$(readlink -f -- "$0")" != "$PREPARE_CONTROL"');
    for (const control of [
      "SNAPSHOT_CONTROL",
      "SOURCE_MANIFEST_CONTROL",
      "SOURCE_MANIFEST_PY_CONTROL",
      "SECRET_SCAN_CONTROL",
      "EVIDENCE_VERIFY_CONTROL"
    ]) {
      expect(prepare).toContain(`$${control}`);
    }
    expect(prepare).not.toMatch(/\$SOURCE_DIR\/ops\/bin\/(?:snapshot-release-bundle|create-release-source-manifest|scan-release-secrets|verify-release-evidence)/u);
    expect(prepare).toContain("GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0=false");
    expect(prepare).toContain("GIT_CONFIG_KEY_1=core.hooksPath GIT_CONFIG_VALUE_1=/dev/null");
    expect(prepare).toContain("--no-ext-diff --no-textconv");
    expect(prepare).not.toContain('cd "$SOURCE_DIR"');
    expect(approve).toContain("/usr/bin/python3 -I -");
    expect(secretScan).toContain('/usr/bin/python3 -I - "$scan_mode"');
    expect(secretScan).not.toContain('value.startswith((b"$(", b"${", b"$"))');
  });

  it("expires stale validation, Deep Scan, bundle, and approval generations", async () => {
    const [verifier, approve] = await Promise.all([
      readFile(verifierPath, "utf8"),
      readFile(path.join(root, "ops/bin/approve-release-bundle.sh"), "utf8")
    ]);
    expect(verifier).toContain("const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60_000");
    expect(verifier).toContain('fail("release validation is older than 24 hours")');
    expect(verifier).toContain('fail("Deep Scan evidence is older than 24 hours")');
    expect(verifier).toContain("releaseCreatedAt < validationEnd");
    expect(verifier).toContain("releaseCreatedAt < security.finalCompleted");
    expect(approve).toContain("age > 24 * 60 * 60");
    expect(approve).toContain("release bundle is not within the 24-hour approval window");
  });

  it("keeps browser binaries read-only and grants only the E2E namespace exception", async () => {
    const source = await readFile(runnerPath, "utf8");
    expect(source).toContain('const PLAYWRIGHT_BROWSER_DIRECTORY = ".release-evidence-playwright-browsers"');
    expect(source).toContain('name: "playwright-browser-fetch"');
    expect(source).toContain("copyReadOnlyTree(\n    browserOutput,\n    trustedBrowsers");
    expect(source).toContain("ambientInputUsed: false");
    expect(source).not.toContain('"/root/.cache/ms-playwright"');
    expect(source).toContain("PLAYWRIGHT_BROWSERS_PATH: builder.browsers");
    expect(source).toContain('allowNamespaces: name === "production-e2e"');
    expect(source).toContain('"RestrictNamespaces=mnt pid user ipc"');
    expect(source).toContain('"RestrictNamespaces=yes"');
  });

  it("runs the disposable database under a dedicated pgtest identity with production paths hidden", async () => {
    const source = await readFile(runnerPath, "utf8");
    expect(source).toContain('const PGTEST_ACCOUNT = "resume-ai-pgtest"');
    expect(source).toContain('`--uid=${PGTEST_ACCOUNT}`');
    expect(source).toContain("COPY (SELECT 1) TO PROGRAM");
    expect(source).toContain("copy-program-uid");
    for (const productionPath of [
      "/run/postgresql",
      "/var/run/postgresql",
      "/var/lib/postgresql",
      "/etc/postgresql",
      "/opt/resume-ai/current",
      "/opt/resume-ai/releases"
    ]) {
      expect(source).toContain(productionPath);
    }
    expect(source).toContain("await assertAccountIdle(pgtestIdentity)");
  });

  it("fails closed in both fixed verifier programs before network access", async () => {
    const deepseekVerifier = path.join(
      root,
      "scripts/lib/release-evidence-deepseek-verifier.mjs"
    );
    const redirectVerifier = path.join(
      root,
      "scripts/lib/release-evidence-http-probe.mjs"
    );
    await expect(execFileAsync(process.execPath, [
      deepseekVerifier,
      "/tmp/not-a-systemd-credential",
      "model",
      "model"
    ])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("fixed verifier arguments are invalid")
    });
    await expect(execFileAsync(process.execPath, [
      redirectVerifier,
      "https://attacker.invalid/probe",
      "https://example.invalid/probe"
    ])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("outside the fixed www-to-apex contract")
    });
  });

  it("binds the excluded prospective baseline before and after sandboxed gates", async () => {
    const source = await readFile(runnerPath, "utf8");
    expect(source).toContain(
      'const PROSPECTIVE_BASELINE_MEMBER = "tests/fixtures/competition-score-prospective-baseline.json"'
    );
    expect(source).toContain("prospectiveBaselineCandidate");
    expect(source).toContain("byteSha256: baseline.byteSha256");
    expect(source).toContain("artifactSha256: baseline.artifactSha256");
    expect(source).toContain("finalBaseline.byteSha256 !== baseline.byteSha256");
    expect(source).toContain("sandboxed source inventory differs from reviewed source manifest");
  });

  it.skipIf(process.env.RELEASE_EVIDENCE_SANDBOX !== "1")(
    "proves hostile repository code cannot write source, reach the Internet, read credentials, or traverse production releases",
    async () => {
      expect(process.getuid?.()).toBe(Number(process.env.RELEASE_EVIDENCE_EXPECTED_UID));
      expect(process.env.AI_API_KEY).toBe("");
      expect(process.env.CREDENTIALS_DIRECTORY).toBeUndefined();

      await expect(writeFile(
        path.join(root, ".release-evidence-hostile-write"),
        "repository code must not write this\n",
        "utf8"
      )).rejects.toMatchObject({ code: expect.stringMatching(/^(?:EACCES|EROFS)$/u) });

      await expect(readdir(
        process.env.RELEASE_EVIDENCE_PRODUCTION_PATH ?? "/opt/resume-ai/releases"
      )).rejects.toMatchObject({ code: expect.stringMatching(/^(?:EACCES|ENOENT)$/u) });
      await expect(readdir("/run/credentials")).rejects.toMatchObject({
        code: expect.stringMatching(/^(?:EACCES|ENOENT)$/u)
      });

      await expect(new Promise<void>((resolve, reject) => {
        const socket = createConnection({ host: "1.1.1.1", port: 443 });
        const timeout = setTimeout(() => {
          socket.destroy();
          reject(new Error("external network attempt timed out inside the private namespace"));
        }, 1_500);
        socket.once("connect", () => {
          clearTimeout(timeout);
          socket.destroy();
          resolve();
        });
        socket.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      })).rejects.toBeDefined();
    }
  );

  it.skipIf(
    process.platform !== "linux" ||
    process.getuid?.() !== 0 ||
    process.version !== "v24.20.0"
  )("rejects direct root execution from the repository on the formal Linux runtime", async () => {
    await expect(execFileAsync(process.execPath, [
      runnerPath,
      "--source-manifest", "/does/not/exist/source-manifest.txt",
      "--output", "/does/not/exist/output",
      "--www-url", "https://www.example.invalid/probe"
    ], { cwd: root })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "release evidence must use the installed coordinator: /usr/local/lib/resume-ai/run-release-evidence.mjs"
      )
    });
  });
});
