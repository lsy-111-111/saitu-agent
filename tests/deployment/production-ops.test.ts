import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp, link, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = process.cwd();

async function read(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("production operations control plane", () => {
  it("allows only an exactly bound deploy journal to relax the in-flight artifact gate", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-pending-host-"));
    const state = path.join(fixture, "active.env");
    const journal = path.join(fixture, "deploy.pending");
    const helper = path.join(root, "ops/bin/validate-pending-deploy-host-state.py");
    const approval = path.join(fixture, "approval.env");
    const uid = process.getuid?.() ?? 0;
    const gid = process.getgid?.() ?? 0;
    const release = "20260826T000001Z";
    const previous = "20260825T000001Z";
    const approvalText = "test-only immutable approval\n";
    const approvalHash = createHash("sha256").update(approvalText).digest("hex");
    const stateText = [
      "ACTIVE_PORT=3001",
      `ACTIVE_RELEASE=${release}`,
      "PREVIOUS_PORT=3000",
      `PREVIOUS_RELEASE=${previous}`,
      "SWITCHED_AT=2026-08-26T00:00:01Z"
    ].join("\n") + "\n";
    const journalText = (phase: string, nextRelease = release) => [
      "KIND=deploy",
      `PHASE=${phase}`,
      "OLD_ACTIVE_PORT=3000",
      `OLD_ACTIVE_RELEASE=${previous}`,
      "OLD_PREVIOUS_PORT=none",
      "OLD_PREVIOUS_RELEASE=none",
      "NEW_PORT=3001",
      `NEW_RELEASE=${nextRelease}`,
      "NEW_PREVIOUS_PORT=3000",
      `NEW_PREVIOUS_RELEASE=${previous}`,
      `APPROVAL_FILE_SHA256=${approvalHash}`
    ].join("\n") + "\n";
    const validate = () => execFileAsync("python3", [
      "-I", helper, state, journal, String(uid), String(gid),
      approval, String(uid), String(gid)
    ]);
    try {
      await writeFile(approval, approvalText, "utf8");
      await chmod(approval, 0o400);
      await writeFile(state, stateText, "utf8");
      await writeFile(journal, journalText("nginx_switched"), "utf8");
      await chmod(state, 0o640);
      await chmod(journal, 0o640);
      await expect(validate()).resolves.toMatchObject({ stdout: "nginx_switched\n" });

      await writeFile(journal, journalText("prepared"), "utf8");
      await expect(validate()).rejects.toBeDefined();
      await writeFile(journal, journalText("nginx_switched", "20260826T000002Z"), "utf8");
      await expect(validate()).rejects.toBeDefined();
      await writeFile(journal, journalText("state_committed"), "utf8");
      await expect(validate()).resolves.toMatchObject({ stdout: "state_committed\n" });
      await writeFile(
        state,
        stateText.replace("SWITCHED_AT=2026-08-26T00:00:01Z", "SWITCHED_AT=2999-08-27T00:00:01Z"),
        "utf8"
      );
      await expect(validate()).rejects.toBeDefined();
      await writeFile(state, stateText, "utf8");
      await expect(execFileAsync("python3", [
        "-I", helper, state, journal, String(uid + 1), String(gid)
      ])).rejects.toBeDefined();

      const linked = `${journal}.link`;
      await symlink(journal, linked);
      await expect(execFileAsync("python3", [
        "-I", helper, state, linked, String(uid), String(gid)
      ])).rejects.toBeDefined();
      await rm(journal);
      await expect(validate()).rejects.toBeDefined();

      const host = await read("ops/bin/verify-production-host.sh");
      expect(host).toContain("pending host validation requires one ordinary deploy journal");
      expect(host).toContain("nginx_switched|permissions_hardened) PENDING_ACTIVE_VALIDATION=1");
      expect(host).toContain("state_committed) PENDING_ACTIVE_VALIDATION=0");
      expect(host).toContain("pending artifact must not claim deployment completion");
      expect(host).toContain("expected_artifact_contract=root:root:550");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("fails closed when production AI traffic could leave the reviewed DeepSeek endpoints", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-app-env-"));
    const envFile = path.join(fixture, "app.env");
    const validEnvironment = [
      "DATABASE_URL=postgresql://runtime:deployment-test-db-password@127.0.0.1/resume_ai",
      "AI_API_KEY=deployment-test-key",
      "AI_CONSENT_SALT=deployment-test-consent-salt-000000000000",
      "AI_CONVERSATION_SIGNING_SECRET=deployment-test-signing-secret-0000000000",
      "LOG_HASH_SECRET=deployment-test-log-secret-0000000000000000",
      "SUPABASE_URL=https://deployment-test.supabase.co",
      "SUPABASE_SERVICE_ROLE_KEY=deployment-test-service-role-key-00000000",
      "NEXT_PUBLIC_SITE_URL=https://siyuanjiaxin.com",
      "NEXT_PUBLIC_CONTACT_EMAIL=privacy@siyuanjiaxin.com",
      "FEATURE_AI=1",
      "FEATURE_COMPETITION_RECOMMENDER=1",
      "AI_PROVIDER=deepseek",
      "AI_MODEL=deepseek-v4-pro",
      "AI_COMPETITION_NORMALIZE_MODEL=deepseek-v4-pro",
      "AI_COMPETITION_CLARIFY_MODEL=deepseek-v4-pro",
      "AI_COMPETITION_RECOMMEND_MODEL=deepseek-v4-pro",
      "AI_TIMEOUT_MS=30000",
      "AI_RETRY_MAX_DELAY_MS=5000",
      "AI_TEST_MODE=0",
      "ALLOW_AI_MOCK=0",
      "NEXT_PUBLIC_AI_TEST_MODE=0"
    ];
    const validate = (lines: string[]) =>
      execFileAsync("/bin/bash", [
        path.join(root, "ops/bin/validate-app-env.sh"),
        "production",
        envFile
      ]).then(() => undefined);
    try {
      await writeFile(envFile, `${validEnvironment.join("\n")}\n`, "utf8");
      await expect(validate(validEnvironment)).resolves.toBeUndefined();

      const wrongProvider = validEnvironment.map((line) =>
        line === "AI_PROVIDER=deepseek" ? "AI_PROVIDER=compatible" : line
      );
      await writeFile(envFile, `${wrongProvider.join("\n")}\n`, "utf8");
      await expect(validate(wrongProvider)).rejects.toMatchObject({ code: 1 });

      const wrongEndpoint = [
        ...validEnvironment,
        "AI_API_URL=https://attacker.invalid/chat/completions"
      ];
      await writeFile(envFile, `${wrongEndpoint.join("\n")}\n`, "utf8");
      await expect(validate(wrongEndpoint)).rejects.toMatchObject({ code: 1 });

      const obsoletePublicSupabase = [
        ...validEnvironment,
        "NEXT_PUBLIC_SUPABASE_URL=https://deployment-test.supabase.co"
      ];
      await writeFile(envFile, `${obsoletePublicSupabase.join("\n")}\n`, "utf8");
      await expect(validate(obsoletePublicSupabase)).rejects.toMatchObject({ code: 1 });

      for (const unsafeOrigin of [
        "http://deployment-test.supabase.co",
        "https://service-role@deployment-test.supabase.co",
        "https://deployment-test.supabase.co/rest/v1",
        "https://deployment-test.supabase.co/?redirect=attacker.example",
        "https://deployment-test.supabase.co/#secret",
        "https://deployment-test.supabase.co:443",
        "https://deployment-test.supabase.co:8443",
        " https://deployment-test.supabase.co",
        "https://attacker.example"
      ]) {
        const unsafeSupabase = validEnvironment.map((line) =>
          line.startsWith("SUPABASE_URL=")
            ? `${line.split("=", 1)[0]}=${unsafeOrigin}`
            : line
        );
        await writeFile(envFile, `${unsafeSupabase.join("\n")}\n`, "utf8");
        await expect(validate(unsafeSupabase)).rejects.toMatchObject({ code: 1 });
      }

      const missingSupabaseCredential = validEnvironment.filter(
        (line) => !line.startsWith("SUPABASE_SERVICE_ROLE_KEY=")
      );
      await writeFile(envFile, `${missingSupabaseCredential.join("\n")}\n`, "utf8");
      await expect(validate(missingSupabaseCredential)).rejects.toMatchObject({ code: 1 });

      const sentinel = path.join(fixture, "must-not-execute");
      const executableValue = validEnvironment.map((line) =>
        line.startsWith("AI_API_KEY=") ? `AI_API_KEY=$(touch ${sentinel})` : line
      );
      await writeFile(envFile, `${executableValue.join("\n")}\n`, "utf8");
      await expect(validate(executableValue)).rejects.toMatchObject({ code: 1 });
      await expect(readFile(sentinel, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("renders the application and Nginx quotas from one validated root config", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-quota-render-"));
    try {
      await execFileAsync("/bin/bash", [
        path.join(root, "ops/bin/render-quota-config.sh"),
        path.join(root, "ops/config/quotas.conf"),
        fixture
      ]);
      const app = await readFile(path.join(fixture, "application-quota.env"), "utf8");
      const globalNginx = await readFile(path.join(fixture, "00-resume-ai-global.conf"), "utf8");
      const endpointNginx = await readFile(path.join(fixture, "nginx-quota.inc"), "utf8");
      const trackNginx = await readFile(path.join(fixture, "nginx-track-quota.inc"), "utf8");

      expect(app).toContain("SESSION_STARTS_PER_IP_MINUTE=60");
      expect(app).toContain("SESSION_STARTS_PER_IP_DAY=600");
      expect(app).toContain("SESSION_TRANSITIONS_PER_SESSION=12");
      expect(app).toContain("SESSION_TTL_SECONDS=1800");
      expect(app).toContain("AI_CONCURRENCY_MAX=8");
      expect(app).toContain("AI_QUEUE_MAX=32");
      expect(app).toContain("AI_QUEUE_WAIT_MS=15000");
      expect(app).toContain("AI_REQUEST_DEADLINE_MS=45000");
      expect(app).toContain("AI_PRODUCER_DEADLINE_MS=50000");
      expect(app).toContain("IDEMPOTENCY_FINALIZE_DEADLINE_MS=60000");
      expect(app).toContain("IDEMPOTENCY_DUPLICATE_WAIT_MS=62000");
      expect(app).toContain("APP_RESPONSE_DEADLINE_MS=65000");
      expect(app).toContain("AI_MODEL_CALLS_PER_DAY=1200");
      expect(app).toContain("AI_BUDGET_TIMEZONE=Asia/Shanghai");
      expect(globalNginx).toContain("rate=240r/m");
      expect(globalNginx).toContain(
        "/api/ai/competition-recommend competition-recommend;"
      );
      expect(globalNginx).toContain("/api/track analytics-track;");
      expect(globalNginx).toContain("recommend-ip-minute;");
      expect(globalNginx).toContain("track-ip-minute;");
      expect(globalNginx).toContain('"endpoint":"$resume_ai_log_endpoint"');
      expect(globalNginx).toContain('"stage":"$resume_ai_log_stage"');
      expect(globalNginx).toContain('"rateBucket":"$resume_ai_log_rate_bucket"');
      expect(globalNginx).toContain('"rateSource":"$resume_ai_log_rate_source"');
      expect(globalNginx).toContain('"429:REJECTED" gateway;');
      expect(globalNginx).toContain('"429:PASSED" application;');
      expect(globalNginx).not.toContain("$remote_addr");
      expect(globalNginx).not.toContain("$binary_remote_addr\"");
      expect(endpointNginx).toContain("burst=120 nodelay");
      expect(endpointNginx).toContain("client_max_body_size 64k");
      expect(trackNginx).toContain("burst=60 nodelay");
      expect(app).toContain("MAX_TRACK_PER_IP_MINUTE=60");
      expect(await read("ops/generated/application-quota.env")).toBe(app);
      expect(await read("ops/generated/00-resume-ai-global.conf")).toBe(globalNginx);
      expect(await read("ops/generated/nginx-quota.inc")).toBe(endpointNginx);
      expect(await read("ops/generated/nginx-track-quota.inc")).toBe(trackNginx);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects unknown root quota keys instead of silently drifting", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-quota-invalid-"));
    try {
      const invalidConfig = path.join(fixture, "quotas.conf");
      await writeFile(invalidConfig, "UNREVIEWED_LIMIT=1\n", "utf8");
      await expect(
        execFileAsync("/bin/bash", [
          path.join(root, "ops/bin/render-quota-config.sh"),
          invalidConfig,
          path.join(fixture, "output")
        ])
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("applies the same coarse quota to all three recommendation endpoints", async () => {
    const nginx = await read("ops/nginx/20-resume-ai.conf");
    const endpoints = [
      "/api/competitions/recommend/normalize",
      "/api/ai/competition-clarify",
      "/api/ai/competition-recommend"
    ];

    for (const endpoint of endpoints) {
      const escaped = endpoint.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const block = nginx.match(new RegExp(`location = ${escaped} \\{([\\s\\S]*?)\\n    \\}`, "u"));
      expect(block?.[1]).toContain("include /etc/nginx/snippets/resume-ai-recommend-quota.inc;");
      expect(block?.[1]).toContain("proxy_pass http://resume_ai_active;");
      expect(block?.[1]).toContain("proxy_read_timeout 75s;");
    }
    expect(nginx).toContain('"ok":false,"error":"RATE_LIMITED"');
    expect(nginx).toContain('add_header Retry-After "1" always;');
    expect(nginx).toContain('add_header X-RateLimit-Source "gateway" always;');
    expect(nginx).toContain('"requestId":"$request_id"');
    expect(nginx).toContain("listen 443 ssl default_server;");
    expect(nginx).toContain("listen [::]:443 ssl default_server;");
    expect(nginx).not.toMatch(/listen[^;]*\bhttp2\b/gu);
    expect(nginx.match(/^[ ]{4}http2 on;$/gmu)).toHaveLength(3);
    expect(nginx).toContain("return 444;");
    expect(nginx.match(/server_name www\.siyuanjiaxin\.com;/gu)).toHaveLength(2);
    expect(nginx).toContain("return 301 https://siyuanjiaxin.com$request_uri;");
    const wwwTls = nginx.match(
      /server \{[\s\S]*?listen 443 ssl;[\s\S]*?server_name www\.siyuanjiaxin\.com;([\s\S]*?)\n\}/u
    );
    expect(wwwTls?.[1]).toContain(
      "include /etc/nginx/snippets/resume-ai-transport-security.conf;"
    );
    expect(nginx.match(/access_log off;/gu)).toHaveLength(6);
    expect(nginx).toContain("error_log /var/log/nginx/resume-ai-error.log crit;");
    expect(nginx).not.toContain("Content-Security-Policy");
    expect(nginx).not.toContain("unsafe-eval");
    const proxyCommon = await read("ops/nginx/resume-ai-proxy-common.conf");
    expect(proxyCommon).not.toContain("proxy_read_timeout");
    const generatedGlobal = await read("ops/generated/00-resume-ai-global.conf");
    expect(generatedGlobal).toContain("    '' '';\n");
    expect(generatedGlobal).not.toContain("    '' close;");
    const applicationDeadlineMs = 65_000;
    const proxyTimeoutMs = 75_000;
    expect(proxyTimeoutMs - applicationDeadlineMs).toBeGreaterThanOrEqual(10_000);
  });

  it("retires the legacy production path before it can mutate server state", async () => {
    const setup = await read("deploy/setup.sh");
    expect(setup).toContain("permanently retired");
    expect(setup).toContain("exit 64");
    expect(setup).toContain("ops/bin/deploy-release.sh");
    expect(setup).not.toContain("ALLOW_LEGACY_SETUP_FOR_TESTS");
    expect(setup).not.toContain("apt-get");
    expect(setup).not.toContain("sudo");
  });

  it("requires migrations, budget-table verification, E2E evidence and a 30-minute soak", async () => {
    const deploy = await read("ops/bin/deploy-release.sh");
    const recovery = await read("ops/bin/recover-deployment-state.sh");
    const prepare = await read("ops/bin/prepare-release-bundle.sh");
    const approve = await read("ops/bin/approve-release-bundle.sh");
    const snapshot = await read("ops/bin/snapshot-release-bundle.py");
    const verificationManifest = await read("ops/config/database-verification.manifest");
    const verificationRows = verificationManifest
      .split("\n")
      .filter((line) => line && !line.startsWith("#"));
    expect(verificationRows).toHaveLength(1);
    const [verificationSha, verificationName, verificationIdentity, verificationExtra] =
      verificationRows[0].split(/\s+/u);
    expect(verificationExtra).toBeUndefined();
    expect(verificationName).toBe("verify-production-database-readonly.sql");
    expect(verificationIdentity).toBe("readonly-peer-v1");
    const verificationSql = await readFile(
      path.join(root, "ops/postgresql/verify-production-database-readonly.sql")
    );
    expect(verificationSha).toBe(createHash("sha256").update(verificationSql).digest("hex"));
    expect(deploy).toContain('MIGRATION_MANIFEST="$STAGING_RELEASE/ops/config/migrations.manifest"');
    expect(deploy).toContain(
      'SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"'
    );
    expect(deploy.indexOf("SCRIPT_DIR=")).toBeLessThan(
      deploy.indexOf('"$SCRIPT_DIR/render-quota-config.sh"')
    );
    expect(deploy).toContain("validate-expand-migration.py");
    expect(deploy).toContain("validate-reviewed-migration.py");
    expect(deploy).toContain("/usr/local/lib/resume-ai/verify-production-database-readonly.sh");
    expect(deploy).toContain('postgres_peer psql --dbname="$DATABASE_NAME"');
    expect(deploy).toContain('SOAK_SECONDS="${SOAK_SECONDS:-1800}"');
    expect(deploy).toContain("pnpm audit --prod --audit-level=low");
    expect(deploy).toContain("/usr/local/lib/resume-ai/release-evidence-deepseek-verifier.mjs");
    expect(deploy).not.toContain("scripts/verify-deepseek.mjs");
    expect(deploy).toContain("run_soak_security_gate");
    expect(deploy).toContain("security-scan-result.json");
    expect(deploy).toContain("playwright-report.json");
    expect(prepare).toContain("E2E_EVIDENCE=${E2E_EVIDENCE:-}");
    expect(prepare).toContain("SECURITY_SCAN_REPORT=${SECURITY_SCAN_REPORT:-}");
    expect(prepare).toContain("SECURITY_SCAN_RESULT=${SECURITY_SCAN_RESULT:-}");
    expect(prepare).toContain("e2e-evidence.tar.gz");
    expect(prepare).toContain("baseline/competition-score-prospective-baseline.json");
    expect(prepare).toContain('"artifactSha256": "$BASELINE_ARTIFACT_SHA256"');
    expect(prepare).toContain("secretFilesIncluded\": false");
    expect(deploy).toContain("SET LOCAL lock_timeout TO '5s';");
    expect(deploy).toContain("SET LOCAL statement_timeout TO '60s';");
    expect(deploy).toContain('chmod 0750 "$MIGRATION_TEMP_DIR"');
    expect(deploy).toContain("root:postgres:750");
    expect(deploy).toContain('readlink -e -- "$MIGRATION_TEMP_DIR"');
    expect(deploy).toContain('fsync_tree "$FINAL_RELEASE"');
    expect(deploy).toContain('fsync_tree "$ARTIFACT_DIR"');
    expect(deploy).toContain("write_journal publishing");
    expect(deploy.indexOf("write_journal publishing")).toBeLessThan(
      deploy.indexOf('cp -a -- "$BUNDLE_DIR" "$ARTIFACT_DIR"')
    );
    expect(deploy).toContain("cleanup_uncommitted_publish");
    expect(deploy).toContain("write_deployment_complete_marker");
    const rollbackHandlerStart = deploy.indexOf("restore_previous_state() {");
    const rollbackHandlerEnd = deploy.indexOf("trap restore_previous_state ERR EXIT");
    const rollbackHandler = deploy.slice(rollbackHandlerStart, rollbackHandlerEnd);
    const rollbackCleanup = rollbackHandler.indexOf("if ! cleanup_uncommitted_publish; then");
    expect(rollbackCleanup).toBeGreaterThan(rollbackHandler.indexOf("systemctl reload nginx"));
    expect(rollbackCleanup).toBeGreaterThan(rollbackHandler.indexOf("pm2_as_app pm2 save"));
    const markerWrite = deploy.lastIndexOf("write_deployment_complete_marker");
    const artifactSeal = deploy.lastIndexOf('chmod -R a-w "$ARTIFACT_DIR"');
    const commitDecision = deploy.indexOf("DEPLOYMENT_COMMITTED=1");
    const sealedHostGate = deploy.lastIndexOf(
      "/usr/local/lib/resume-ai/verify-production-host.sh",
      commitDecision
    );
    const finalHostGate = deploy.lastIndexOf(
      "/usr/local/lib/resume-ai/verify-production-host.sh"
    );
    const controlInstall = deploy.lastIndexOf("install-control-plane-generation.sh commit");
    const controlFinalize = deploy.lastIndexOf("install-control-plane-generation.sh finalize");
    expect(markerWrite).toBeLessThan(artifactSeal);
    expect(controlInstall).toBeLessThan(
      deploy.lastIndexOf("/usr/local/lib/resume-ai/verify-postgres-restore.sh")
    );
    expect(artifactSeal).toBeLessThan(sealedHostGate);
    expect(sealedHostGate).toBeLessThan(commitDecision);
    expect(sealedHostGate).toBeLessThan(controlFinalize);
    expect(controlFinalize).toBeLessThan(commitDecision);
    expect(commitDecision).toBeLessThan(
      deploy.lastIndexOf('rm -f -- "$PENDING_FILE"')
    );
    expect(deploy.lastIndexOf('rm -f -- "$PENDING_FILE"')).toBeLessThan(
      finalHostGate
    );
    expect(deploy).toContain('DECLARED_ROLLBACK_RELEASE=');
    expect(deploy).toContain(
      "release manifest rollback target differs from the currently active release"
    );
    expect(deploy).toContain("ROLLBACK_RELEASE=$ACTIVE_RELEASE");
    expect(recovery).toContain('if [ "$PHASE" = publishing ]');
    expect(recovery).toContain("safe_remove_uncommitted_tree");
    expect(recovery).toContain("write_deployment_complete_marker");
    expect(recovery).toContain("seal_deployment_artifact");
    expect(recovery).toContain("write_recovery_journal_phase state_committed");
    expect(recovery).toContain("SCHEMA_VERSION=2");
    expect(recovery).toContain('set(values) != allowed');
    expect(recovery).toContain('datetime.timedelta(minutes=5)');
    const deployRecoveryUnit = await read("ops/systemd/resume-ai-deploy-recovery.service");
    expect(deployRecoveryUnit).toContain("ProtectSystem=strict");
    expect(deployRecoveryUnit).toContain(
      "ReadWritePaths=/opt/resume-ai /etc/resume-ai /etc/nginx/conf.d /var/lib/resume-ai /var/log/resume-ai /var/cache/resume-ai /run/resume-ai-locks"
    );
    expect(deploy.indexOf('fsync_tree "$FINAL_RELEASE"')).toBeLessThan(
      deploy.indexOf("write_journal prepared")
    );
    expect(recovery).toContain("--max-redirs 0");
    expect(recovery).toContain('"$RELEASE_ROOT/$release/scripts/verify-next-assets.mjs"');
    expect(recovery).toContain("runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai");
    const committedRecovery = recovery.indexOf('if [ "$PHASE" = state_committed ]');
    expect(recovery.indexOf('start_release_process "$NEW_RELEASE" "$NEW_PORT"', committedRecovery))
      .toBeGreaterThan(committedRecovery);
    expect(recovery.indexOf('wait_for_release "$NEW_PORT" "$NEW_RELEASE"', committedRecovery))
      .toBeGreaterThan(committedRecovery);
    expect(recovery.indexOf("wait_for_release \"$NEW_PORT\" \"$NEW_RELEASE\"")).toBeLessThan(
      recovery.indexOf("write_managed_state \"$NEW_PORT\"")
    );
    expect(approve).toContain("/opt/resume-ai/approval-staging");
    expect(approve).toContain("SNAPSHOT_HELPER=/usr/local/lib/resume-ai/snapshot-release-bundle.py");
    expect(approve).toContain("installed root-owned release snapshot helper is missing or unsafe");
    expect(approve).toContain("open_root_lock 9 deploy");
    expect(approve).not.toContain('BUNDLE_DIR="$(cd -- "$BUNDLE_DIR"');
    expect(snapshot).toContain("bundle changed while it was snapshotted");
    expect(snapshot).toContain("bundle contains or is a mount point");
    expect(snapshot).toContain("st_ctime_ns");
    expect(approve.indexOf('BUNDLE_DIR="$SNAPSHOT_DIR/bundle"')).toBeLessThan(
      approve.indexOf("cmp -s \"$REVIEWED_MANIFEST\"")
    );
    expect(deploy).toContain('BUNDLE_DIR="$DEPLOY_INPUT_SNAPSHOT/bundle"');
    expect(deploy).not.toContain('CALLER_BUNDLE_DIR="$(cd -- "$CALLER_BUNDLE_DIR"');
    expect(deploy.indexOf('root_python "$SNAPSHOT_HELPER"')).toBeLessThan(
      deploy.indexOf("for artifact in release-manifest.json")
    );
    expect(deploy.indexOf("cleanup_deploy_input_snapshot\ninstall -o root")).toBeGreaterThan(-1);
  });

  it.skipIf(!existsSync("/proc/self/mountinfo"))(
    "copies one stable no-link bundle generation before approval or deploy parsing",
    async () => {
      const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-bundle-snapshot-"));
      const source = path.join(fixture, "source");
      const snapshotRoot = path.join(fixture, "snapshot");
      const linkedRoot = path.join(fixture, "linked-source");
      const linkedSnapshot = path.join(fixture, "linked-snapshot");
      const symlinkRoot = path.join(fixture, "source-link");
      const symlinkSnapshot = path.join(fixture, "symlink-snapshot");
      const raceRoot = path.join(fixture, "race-source");
      const raceSnapshot = path.join(fixture, "race-snapshot");
      try {
        await mkdir(path.join(source, "nested"), { recursive: true });
        await mkdir(snapshotRoot);
        await writeFile(path.join(source, "root.txt"), "root-generation\n", "utf8");
        await writeFile(path.join(source, "nested", "child.txt"), "child-generation\n", "utf8");
        await expect(execFileAsync("python3", [
          path.join(root, "ops/bin/snapshot-release-bundle.py"), source, snapshotRoot
        ])).resolves.toBeDefined();
        await expect(readFile(path.join(snapshotRoot, "bundle", "nested", "child.txt"), "utf8"))
          .resolves.toBe("child-generation\n");

        await mkdir(linkedRoot);
        await mkdir(linkedSnapshot);
        const original = path.join(linkedRoot, "original.txt");
        await writeFile(original, "one inode\n", "utf8");
        await link(original, path.join(linkedRoot, "second-name.txt"));
        await expect(execFileAsync("python3", [
          path.join(root, "ops/bin/snapshot-release-bundle.py"), linkedRoot, linkedSnapshot
        ])).rejects.toMatchObject({ code: 1 });

        await symlink(source, symlinkRoot, "dir");
        await mkdir(symlinkSnapshot);
        await expect(execFileAsync("python3", [
          path.join(root, "ops/bin/snapshot-release-bundle.py"), symlinkRoot, symlinkSnapshot
        ])).rejects.toBeDefined();

        await mkdir(raceRoot);
        await mkdir(raceSnapshot);
        await Promise.all(Array.from({ length: 500 }, (_, index) =>
          writeFile(path.join(raceRoot, `${index.toString().padStart(4, "0")}.bin`), Buffer.alloc(4096, index % 251))
        ));
        const racingCopy = execFileAsync("python3", [
          path.join(root, "ops/bin/snapshot-release-bundle.py"), raceRoot, raceSnapshot
        ]);
        const raceDeadline = Date.now() + 5_000;
        while (!existsSync(path.join(raceSnapshot, "bundle")) && Date.now() < raceDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(existsSync(path.join(raceSnapshot, "bundle"))).toBe(true);
        await rename(raceRoot, path.join(fixture, "race-source-swapped"));
        await expect(racingCopy).rejects.toBeDefined();
      } finally {
        await execFileAsync("chmod", ["-R", "u+w", fixture]).catch(() => undefined);
        await rm(fixture, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(!existsSync("/proc/self/mountinfo") || process.getuid?.() !== 0)(
    "keeps pre-checksum backups auditable while selecting only checksummed restore candidates",
    async () => {
      const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-backup-inspector-"));
      const tier = path.join(fixture, "daily");
      const inspector = path.join(root, "ops/bin/inspect-postgres-backups.py");
      const formatId = (date: Date) => date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
      const writeBackup = async (date: Date, checksums: "on" | "off") => {
        const backupId = formatId(date);
        const backup = path.join(tier, backupId);
        await mkdir(backup, { mode: 0o700 });
        const createdAt = date.toISOString().replace(/\.\d{3}Z$/u, "Z");
        const contents = new Map([
          ["database.dump", `dump-${checksums}\n`],
          ["globals.sql", `globals-${checksums}\n`],
          ["archive.list", `archive-${checksums}\n`],
          ["manifest.env", [
            `BACKUP_ID=${backupId}`,
            "BACKUP_TIER=daily",
            "DATABASE_NAME=resume_ai",
            `CREATED_AT=${createdAt}`,
            "POSTGRES_VERSION=14.24",
            `DATA_CHECKSUMS=${checksums}`,
            "SYSTEM_IDENTIFIER=1234567890123456789",
            "DATABASE_SIZE_BYTES=1024",
            "RPO_HOURS=24",
            "RTO_SECONDS=7200",
            ""
          ].join("\n")]
        ]);
        for (const [name, content] of contents) {
          await writeFile(path.join(backup, name), content, { mode: 0o600 });
        }
        const checksumManifest = [...contents].map(([name, content]) =>
          `${createHash("sha256").update(content).digest("hex")}  ${name}`
        ).join("\n") + "\n";
        await writeFile(path.join(backup, "SHA256SUMS"), checksumManifest, { mode: 0o600 });
        await chmod(backup, 0o700);
        return backup;
      };

      try {
        await mkdir(tier, { mode: 0o700 });
        await writeBackup(new Date(Date.now() - 120_000), "off");
        const checksummed = await writeBackup(new Date(Date.now() - 60_000), "on");
        const mixed = await execFileAsync("python3", [
          inspector, tier, "daily", "resume_ai", "--require-checksums"
        ]);
        expect(mixed.stdout.trim().split("\n")).toHaveLength(1);
        expect(mixed.stdout).toContain(checksummed);

        await rm(checksummed, { recursive: true });
        await expect(execFileAsync("python3", [
          inspector, tier, "daily", "resume_ai", "--require-checksums"
        ])).rejects.toMatchObject({ code: 1 });
        await expect(execFileAsync("python3", [
          inspector, tier, "daily", "resume_ai"
        ])).resolves.toMatchObject({ stdout: expect.stringContaining("/daily/") });
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    }
  );

  it("defines rollback, least-privilege runtime and backup recovery controls", async () => {
    const deploy = await read("ops/bin/deploy-release.sh");
    const rollback = await read("ops/bin/rollback-release.sh");
    const runtime = await read("ops/bin/install-runtime-layout.sh");
    const pm2 = await read("ops/pm2/ecosystem.config.cjs");
    const pm2Boot = await read("ops/bin/verify-pm2-boot-state.sh");
    const pm2Effective = await read("ops/bin/assert-pm2-effective-service.sh");
    const service = await read("ops/systemd/resume-ai-pm2.service");
    const sshInstaller = await read("ops/bin/install-ssh-hardening.sh");
    const sshPolicy = await read("ops/bin/assert-ssh-effective-policy.sh");
    const backup = await read("ops/bin/backup-postgres.sh");
    const restore = await read("ops/bin/verify-postgres-restore.sh");
    const postgresRuntime = await read("ops/bin/provision-postgres-runtime-role.sh");
    const prune = await read("ops/bin/prune-releases.sh");

    expect(deploy).toContain("/opt/resume-ai/releases");
    expect(deploy).toContain("CANDIDATE_PORT=3001");
    expect(deploy).toContain("mv -Tf");
    expect(rollback).toContain("PREVIOUS_RELEASE");
    expect(runtime).toContain("--shell /usr/sbin/nologin");
    expect(runtime).toContain('gpasswd -d "$account" "$supplementary_group"');
    expect(runtime).toContain('[ "$(id -G "$account")" = "$account_gid" ]');
    expect(runtime).toContain("LOG_HASH_SECRET");
    expect(runtime).toContain("-o root -g resume-ai -m 0750 /opt/resume-ai/releases");
    expect(runtime).toContain(
      "systemctl enable resume-ai-security-state-cleanup.timer"
    );
    const cleanupConfiguration = await read(
      "ops/bin/configure-security-state-cleanup.sh"
    );
    expect(cleanupConfiguration).toContain(
      "systemctl start resume-ai-security-state-cleanup.timer"
    );
    expect(deploy).toContain('set_tree_readonly_for_runtime "$FINAL_RELEASE"');
    expect(deploy).toContain("os.fchmod(descriptor, mode)");
    expect(deploy).toContain('chown -h root:resume-ai "$FINAL_RELEASE/.next/cache"');
    expect(deploy).not.toContain('chown -R root:resume-ai "$FINAL_RELEASE"');
    expect(deploy).toContain('"$FINAL_RELEASE/.next/cache"');
    expect(deploy).toContain(
      "Nginx rollback could not be durably validated and reloaded"
    );
    expect(deploy).toContain(
      "Rolled-back PM2 topology could not be durably saved"
    );
    const firstPreparedJournal = deploy.indexOf("write_journal prepared");
    const candidateMutationMarker = deploy.indexOf(
      "CANDIDATE_SLOT_TOUCHED=1",
      firstPreparedJournal
    );
    expect(firstPreparedJournal).toBeGreaterThan(-1);
    expect(candidateMutationMarker).toBeGreaterThan(firstPreparedJournal);
    expect(candidateMutationMarker).toBeLessThan(
      deploy.indexOf(
        'start_release_process "$RELEASE_ID" "$CANDIDATE_PORT"',
        candidateMutationMarker
      )
    );
    expect(pm2).toContain('max_memory_restart: "768M"');
    expect(postgresRuntime).toContain(
      'REASSIGN OWNED BY "$RUNTIME_ROLE" TO "$OWNER_ROLE";'
    );
    expect(postgresRuntime).not.toContain(
      'ALTER ROLE "$RUNTIME_ROLE" RENAME TO "$OWNER_ROLE";'
    );
    expect(postgresRuntime.indexOf('printf \'REASSIGN OWNED BY "%s" TO "%s";'))
      .toBeLessThan(postgresRuntime.indexOf('printf \'DROP ROLE "%s";'));
    expect(postgresRuntime).toContain(
      'psql_admin --single-transaction --file="$apply_sql"'
    );
    expect(pm2).toContain("log_date_format");
    expect(service).toContain("User=resume-ai");
    expect(service).toContain("NoNewPrivileges=true");
    expect(service).toContain("CapabilityBoundingSet=\n");
    expect(service).toContain("AmbientCapabilities=\n");
    expect(service).toContain("RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6");
    expect(pm2Effective).toContain('"$(property FragmentPath)" = "$fragment"');
    expect(pm2Effective).toContain('"$(property DropInPaths)" = "$dropin"');
    expect(pm2Effective).toContain('"$(property CapabilityBoundingSet)"');
    expect(pm2Effective).toContain('"$(property AmbientCapabilities)"');
    expect(pm2Effective).toContain("PM2 effective ExecStart differs from the reviewed command");
    expect(service).toContain("ExecStartPre=+/usr/local/lib/resume-ai/verify-pm2-boot-state.sh");
    expect(service).toContain("Requires=postgresql.service");
    expect(pm2Boot).toContain("reset_pm2_dump_for_recovery");
    expect(pm2Boot).toContain("pending recovery journal: $pending_path");
    expect(pm2Boot).toContain("safe pre-adoption boot without managed active state");
    expect(pm2Boot).toContain("printf '[]\\n' > \"$empty_temp\"");
    expect(pm2Boot).toContain('for dump_candidate in "$DUMP_FILE" "$DUMP_BACKUP_FILE"');
    expect(pm2Boot).toContain("mv -T -f -- \"$empty_temp\" \"$dump_candidate\"");
    expect(pm2Boot).toContain("root:resume-ai:640:1");
    expect(pm2Boot).toContain("PM2 boot input changed during trust verification");
    expect(pm2Boot).toContain("module_conf.json");
    expect(pm2Boot).toContain("PM2 module persistence directory is non-empty");
    expect(pm2Boot).toContain("dump.pm2.bak");
    expect(pm2Boot).toContain('"$(stat -c \'%s\' "$DUMP_FILE")" -le 4194304');
    expect(pm2Boot).toContain("install_verified_dump_backup");
    expect(pm2Boot.indexOf("reset_pm2_dump_for_recovery \"pending recovery journal"))
      .toBeLessThan(pm2Boot.indexOf("exit 0", pm2Boot.indexOf("reset_pm2_dump_for_recovery \"pending recovery journal")));
    expect(sshInstaller).toContain("00-resume-ai-hardening.conf");
    expect(sshInstaller).not.toContain("99-resume-ai-hardening.conf");
    expect(sshInstaller).toContain('"$OPS_DIR/bin/assert-ssh-effective-policy.sh"');
    expect(sshPolicy).toContain('sshd_bin" -T -f "$main_config" -C "$connection_spec"');
    expect(sshPolicy).toContain("context-sensitive SSH Match rules are forbidden");
    expect(sshPolicy).toContain("'authenticationmethods publickey'");
    expect(sshPolicy).toContain("'disableforwarding yes'");
    expect(sshPolicy).toContain("'allowstreamlocalforwarding no'");
    expect(backup).toContain("DAILY_RETENTION=14");
    expect(backup).toContain("WEEKLY_RETENTION=8");
    expect(backup).toContain("PREDEPLOY_RETENTION=5");
    expect(restore).toContain("temporaryDatabaseDropped\": true");
    expect(restore).toContain("fixed read-only database verification manifest is malformed");
    expect(prune).not.toContain('. "$STATE_FILE"');
    expect(prune).toContain("refusing to prune while a release transaction is pending");
    expect(prune).toContain("ARTIFACT_ROOT=/opt/resume-ai/release-artifacts");
    expect(prune).toContain("CACHE_ROOT=/var/cache/resume-ai");
    expect(prune).toContain("deployment-complete.env");
    expect(prune).toContain("release_ids+=(\"$release_id\")");
    expect(prune).toContain('/proc/self/mountinfo');
    expect(backup).not.toContain("--no-owner");
    expect(backup).toContain("trap cleanup_incomplete_on_exit EXIT");
    expect(backup).toContain('/proc/self/mountinfo');
    expect(backup).toContain('safe_delete_backup_tree "$pruning_path"');
    expect(backup).toContain("refusing to publish a future-dated PostgreSQL backup");
    expect(backup).toContain("inspect-postgres-backups.py");
    expect(restore).not.toContain("--no-owner");
    expect(restore).not.toContain("--no-privileges");
    expect(restore).toContain("backupDatabaseDumpSha256");
    expect(restore).toContain('"verificationId": "$VERIFY_ID"');
    expect(restore).toContain("backup path and internal creation timestamps are inconsistent");
    expect(restore).toContain("generated restore evidence ID and internal timestamp are inconsistent");
    expect(restore).toContain("--require-checksums");
    expect(restore).toContain('EVIDENCE_TEMP="$(mktemp "$VERIFY_ROOT/.verification.XXXXXX")"');
    expect(restore.indexOf('sync -f "$EVIDENCE_TEMP"')).toBeLessThan(
      restore.indexOf('mv -- "$EVIDENCE_TEMP" "$EVIDENCE_FINAL"')
    );
    expect(restore).toContain("insufficient PostgreSQL filesystem headroom");
    expect(restore).toContain('--file="$READONLY_DATABASE_SQL"');
    expect(restore).toContain("verified_sql_count=1");
    expect(restore).not.toContain("restore-sql.");
    expect(rollback).toContain("--max-redirs 0");
    expect(rollback).toContain('public_status" = 200');
    expect(rollback).toContain(
      '"$RELEASE_ROOT/$PREVIOUS_RELEASE/scripts/verify-next-assets.mjs" "$PUBLIC_URL"'
    );
    expect(rollback.indexOf('public_status" = 200')).toBeLessThan(
      rollback.indexOf("write_journal state_committed")
    );
    const hostVerification = await read("ops/bin/verify-production-host.sh");
    expect(hostVerification).toContain(
      'apt_simulation="$(apt-get -s dist-upgrade)"'
    );
    expect(hostVerification).toContain(
      'fail "APT upgrade simulation failed; patch state cannot be verified"'
    );
    expect(hostVerification).toContain('held_system_packages="$(apt-mark showhold)"');
    expect(hostVerification).toContain("AllowDowngradeToInsecureRepositories");
    expect(hostVerification).toContain("APT_CONFIG override is forbidden");
    expect(hostVerification).toContain("/etc/apt/apt.conf.d");
    expect(hostVerification).toContain("/usr/share/keyrings");
    expect(hostVerification).toContain("approved-apt-effective.conf");
    expect(hostVerification).toContain("assert-apt-effective-config.sh");
    expect(hostVerification).toContain("apt-get indextargets");
    expect(hostVerification).toContain("assert-apt-active-sources.sh");
    expect(hostVerification).toContain("approved-apt-sources.conf");
    expect(hostVerification).toContain("mirrors.tencentyun.com_ubuntu_dists_jammy-security_InRelease");
    expect(hostVerification).toContain("mirrors.tencentyun.com_ubuntu_dists_jammy-updates_InRelease");
    expect(hostVerification).toContain("signed APT metadata Date");
    expect(hostVerification).toContain("Valid-Until");
    expect(hostVerification).toContain('metadata_age" -le 86400');
    expect(hostVerification).toContain(
      "systemctl show nginx.service --property=Requires --value"
    );
    expect(hostVerification).toContain(
      "systemctl show nginx.service --property=After --value"
    );
    expect(hostVerification).toContain('held_system_packages="$(apt-mark showhold)"');
    expect(hostVerification).toContain("APT has unreviewed held packages");
    expect(hostVerification).toContain("assert-pm2-effective-service.sh");
    expect(hostVerification).toContain("/proc/$active_pid/status");
    expect(hostVerification).toContain("CapEff");
    expect(hostVerification).toContain("CapAmb");
    expect(hostVerification).toContain("NoNewPrivs:");
    expect(hostVerification).toContain("deployment-complete.env");
    expect(hostVerification).toContain(
      "active/previous topology is not bound to a reviewed deployment or rollback record"
    );
  });

  it("masks recursive rc-local and preserves QCloud tuning behind a PrivateTmp unit", async () => {
    const disable = await read("ops/bin/disable-rc-local.sh");
    const host = await read("ops/bin/verify-production-host.sh");
    const runner = await read("ops/bin/run-qcloud-network-tuning.sh");
    const unit = await read("ops/systemd/resume-ai-qcloud-network-tuning@.service");
    const rule = await read("ops/udev/80-qcloud-nic.rules");
    const policy = await read("ops/config/approved-qcloud-network-tuning.conf");
    const control = await read("ops/bin/qcloud-network-control.py");
    const recovery = await read("ops/bin/rc-local-backup.py");

    expect(disable).toContain(".pending-$backup_timestamp.XXXXXXXX");
    expect(disable).toContain("trap cleanup_pending_backup EXIT");
    expect(disable).toContain("rm -rf --one-file-system -- \"$pending\"");
    expect(disable.lastIndexOf("BACKUP_PENDING=")).toBeGreaterThan(
      disable.indexOf('mv -T -- "$BACKUP_PENDING" "$BACKUP_DIR"')
    );
    expect(disable).toContain('verify "$BACKUP_PENDING"');
    expect(disable).toContain('mv -T -- "$BACKUP_PENDING" "$BACKUP_DIR"');
    expect(disable).toContain("unlink /etc/systemd/system/rc-local.service");
    expect(disable).toContain("ln -s /dev/null /etc/systemd/system/rc-local.service");
    expect(disable).toContain("udevadm control --reload");
    expect(disable).toContain("run-qcloud-network-tuning.sh --verify-only");
    expect(disable).toContain("assert_trusted_source_chain");
    expect(disable).toContain("REVIEWED_SOURCE_SHA256");
    expect(rule).toContain('TAG+="systemd"');
    expect(rule).toContain('resume-ai-qcloud-network-tuning@%k.service');
    expect(rule).not.toContain("RUN+=");
    expect(unit).toContain("PrivateTmp=yes");
    expect(unit).toContain("NoNewPrivileges=yes");
    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain("RuntimeDirectory=resume-ai-locks");
    expect(unit).toContain("RuntimeDirectoryMode=0700");
    expect(unit).toContain("CapabilityBoundingSet=CAP_DAC_OVERRIDE CAP_KILL CAP_NET_ADMIN CAP_SYS_ADMIN");
    expect(unit).toContain("AmbientCapabilities=\n");
    expect(runner).toContain("PATH=/usr/sbin:/usr/bin");
    expect(runner).not.toContain("/usr/local/bin:/usr/sbin");
    expect(runner).toContain("qcloud-network-control.py");
    expect(runner).toContain('^eth[0-9]+$');
    expect(control).toContain("os.O_NOFOLLOW");
    expect(control).toContain("pass_fds=(descriptor,)");
    expect(control).toContain("NeedDaemonReload");
    expect(control).toContain("INSTANCE_PATTERN");
    expect(control).toContain("/var/spool/cron/crontabs/root");
    expect(control).toContain("/etc/network/if-up.d");
    expect(control).toContain("/etc/cloud/cloud.cfg.d");
    expect(recovery).toContain("BACKUP_COMPLETE.json");
    expect(recovery).toContain('entry["state"] = "absent"');
    expect(recovery).toContain("restore-test");
    expect(policy.match(/^[^#\n].*\|[a-f0-9]{64}$/gmu)).toHaveLength(4);
    expect(policy).toContain("7d2ed707dfdc72c97b85a27db8fcf1d04b7366e4ebb81155b17ca63921159a00");
    expect(host).toContain("rc-local.service does not have the exact local /dev/null mask");
    expect(host).toContain("qcloud-network-control.py host-state");
    expect(host).toContain("no complete rc-local recovery generation exists");
  });

  it("executes the one opened QCloud generation and excludes local PATH shadows", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-qcloud-fd-"));
    const control = path.join(root, "ops/bin/qcloud-network-control.py");
    const vendorPaths = {
      dispatcher: "/usr/local/qcloud/udev_run/udev_run.sh",
      irq: "/usr/local/qcloud/irq/net_smp_affinity.sh",
      rps: "/usr/local/qcloud/rps/set_rps.sh",
      xps: "/usr/local/qcloud/xps/set_xps.sh"
    } as const;
    const rooted = (absolute: string) => path.join(fixture, absolute.slice(1));
    const writeExecutable = async (absolute: string, content: string, mode = 0o755) => {
      const destination = rooted(absolute);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
      await writeFile(destination, content, { mode });
      await chmod(destination, mode);
      return destination;
    };
    let running: ReturnType<typeof execFileAsync> | undefined;
    try {
      await writeExecutable(vendorPaths.dispatcher, "#!/usr/bin/bash\nexit 0\n");
      await writeExecutable(
        vendorPaths.irq,
        [
          "#!/usr/bin/bash",
          'fixture_root=${0%/usr/local/qcloud/irq/net_smp_affinity.sh}',
          'probe-command "$fixture_root"',
          ': > "$fixture_root/first-script-running"',
          'while [ ! -e "$fixture_root/release-first-script" ]; do /bin/sleep 0.02; done',
          ""
        ].join("\n")
      );
      const oldRps = [
        "#!/usr/bin/bash",
        'fixture_root=${0%/usr/local/qcloud/rps/set_rps.sh}',
        "printf 'old-reviewed-generation\\n' > \"$fixture_root/rps-result\"",
        ""
      ].join("\n");
      const rpsPath = await writeExecutable(vendorPaths.rps, oldRps);
      await writeExecutable(
        vendorPaths.xps,
        [
          "#!/usr/bin/bash",
          'fixture_root=${0%/usr/local/qcloud/xps/set_xps.sh}',
          "printf 'xps-reviewed\\n' > \"$fixture_root/xps-result\"",
          ""
        ].join("\n"),
        0o744
      );
      await writeExecutable(
        "/usr/bin/probe-command",
        "#!/bin/bash\nprintf 'system-path\\n' > \"$1/path-result\"\n"
      );
      await writeExecutable(
        "/usr/local/bin/probe-command",
        "#!/bin/bash\nprintf 'LOCAL-PATH-HIJACK\\n' > \"$1/path-result\"\n"
      );
      await writeExecutable("/usr/sbin/ethtool", "#!/bin/bash\nexit 0\n");

      const policyPath = rooted(
        "/usr/local/share/resume-ai/approved-qcloud-network-tuning.conf"
      );
      await mkdir(path.dirname(policyPath), { recursive: true, mode: 0o755 });
      const vendorModes = new Map([
        [vendorPaths.dispatcher, "755"],
        [vendorPaths.irq, "755"],
        [vendorPaths.rps, "755"],
        [vendorPaths.xps, "744"]
      ]);
      const policy = ["# path|mode|sha256"];
      for (const absolute of Object.values(vendorPaths)) {
        const content = await readFile(rooted(absolute));
        policy.push(
          `${absolute}|${vendorModes.get(absolute)}|${createHash("sha256").update(content).digest("hex")}`
        );
      }
      await writeFile(policyPath, `${policy.join("\n")}\n`, { mode: 0o444 });
      await chmod(policyPath, 0o444);

      const device = rooted("/sys/devices/virtual/net/eth0");
      const classNet = rooted("/sys/class/net");
      await mkdir(device, { recursive: true, mode: 0o755 });
      await mkdir(classNet, { recursive: true, mode: 0o755 });
      await symlink("../../devices/virtual/net/eth0", path.join(classNet, "eth0"));

      await expect(
        execFileAsync("python3", [control, "vendor", "--verify-only", "--fixture-root", fixture])
      ).resolves.toBeDefined();

      running = execFileAsync(
        "python3",
        [control, "vendor", "eth0", "--fixture-root", fixture],
        { timeout: 35_000 }
      );
      void running.catch(() => undefined);
      const marker = path.join(fixture, "first-script-running");
      const deadline = Date.now() + 8_000;
      while (!existsSync(marker) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!existsSync(marker)) {
        await running;
      }
      expect(existsSync(marker)).toBe(true);

      await rename(rpsPath, `${rpsPath}.reviewed-open-inode`);
      await writeFile(
        rpsPath,
        "#!/usr/bin/bash\nfixture_root=${0%/usr/local/qcloud/rps/set_rps.sh}\nprintf 'REPLACED-PATH\\n' > \"$fixture_root/rps-result\"\n",
        { mode: 0o755 }
      );
      await chmod(rpsPath, 0o755);
      await rename(policyPath, `${policyPath}.reviewed-open-inode`);
      await writeFile(
        policyPath,
        `${vendorPaths.rps}|755|${createHash("sha256").update(await readFile(rpsPath)).digest("hex")}\n`,
        { mode: 0o444 }
      );
      await chmod(policyPath, 0o444);
      await writeFile(path.join(fixture, "release-first-script"), "release\n", "utf8");

      await expect(running).resolves.toBeDefined();
      expect(await readFile(path.join(fixture, "rps-result"), "utf8"))
        .toBe("old-reviewed-generation\n");
      expect(await readFile(path.join(fixture, "path-result"), "utf8"))
        .toBe("system-path\n");

      await chmod(rooted("/usr/local/qcloud/rps"), 0o775);
      await expect(
        execFileAsync("python3", [control, "vendor", "--verify-only", "--fixture-root", fixture])
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await writeFile(path.join(fixture, "release-first-script"), "release\n", "utf8").catch(
        () => undefined
      );
      await running?.catch(() => undefined);
      await execFileAsync("chmod", ["-R", "u+rwX", fixture]).catch(() => undefined);
      await rm(fixture, { recursive: true, force: true });
    }
  }, 45_000);

  it("rejects real and future QCloud instance overrides plus alternate root schedulers", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-qcloud-state-"));
    const stateDir = await mkdtemp(path.join(tmpdir(), "resume-ai-qcloud-systemctl-"));
    const control = path.join(root, "ops/bin/qcloud-network-control.py");
    const rooted = (absolute: string) => path.join(fixture, absolute.slice(1));
    const unit = "resume-ai-qcloud-network-tuning@eth0.service";
    const stateFile = path.join(stateDir, `${unit}.json`);
    const validState = {
      LoadState: "loaded",
      FragmentPath: rooted("/etc/systemd/system/resume-ai-qcloud-network-tuning@.service"),
      DropInPaths: "",
      NeedDaemonReload: "no",
      Type: "oneshot",
      User: "root",
      Group: "root",
      RuntimeDirectory: "resume-ai-locks",
      RuntimeDirectoryMode: "0700",
      ExecStart:
        "{ path=/usr/local/lib/resume-ai/run-qcloud-network-tuning.sh ; argv[]=/usr/local/lib/resume-ai/run-qcloud-network-tuning.sh eth0 ; ignore_errors=no ; }",
      PrivateTmp: "yes",
      NoNewPrivileges: "yes",
      ProtectSystem: "strict",
      ProtectHome: "yes",
      ProtectKernelModules: "yes",
      ProtectControlGroups: "yes",
      ProtectHostname: "yes",
      RestrictSUIDSGID: "yes",
      RestrictNamespaces: "yes",
      LockPersonality: "yes",
      MemoryDenyWriteExecute: "yes",
      CapabilityBoundingSet: "cap_dac_override cap_kill cap_net_admin cap_sys_admin",
      AmbientCapabilities: "",
      RestrictAddressFamilies: "AF_UNIX AF_INET AF_INET6 AF_NETLINK"
    };
    const runStateCheck = () =>
      execFileAsync("python3", [
        control,
        "host-state",
        "--fixture-root",
        fixture,
        "--systemctl-state-dir",
        stateDir
      ]);
    try {
      for (const directory of [
        "/etc/systemd/system",
        "/run/systemd/system",
        "/run/systemd/transient",
        "/usr/local/lib/systemd/system",
        "/usr/lib/systemd/system",
        "/etc/udev/rules.d",
        "/sys/class/net",
        "/sys/devices/virtual/net/eth0"
      ]) {
        await mkdir(rooted(directory), { recursive: true, mode: 0o755 });
      }
      await writeFile(
        rooted("/etc/systemd/system/resume-ai-qcloud-network-tuning@.service"),
        "[Service]\nExecStart=/usr/local/lib/resume-ai/run-qcloud-network-tuning.sh %i\n",
        "utf8"
      );
      await symlink("/dev/null", rooted("/etc/systemd/system/rc-local.service"));
      await symlink(
        "../../devices/virtual/net/eth0",
        rooted("/sys/class/net/eth0")
      );
      await writeFile(
        rooted("/etc/udev/rules.d/80-qcloud-nic.rules"),
        'SUBSYSTEM=="net", ACTION=="add", KERNEL=="eth[0-9]*", TAG+="systemd", ENV{SYSTEMD_WANTS}+="resume-ai-qcloud-network-tuning@%k.service"\n',
        "utf8"
      );
      await writeFile(
        rooted("/usr/lib/systemd/system/rc-local.service"),
        "[Service]\nExecStart=/etc/rc.local start\n",
        "utf8"
      );
      await writeFile(stateFile, JSON.stringify(validState), "utf8");
      await expect(runStateCheck()).resolves.toBeDefined();

      for (const relative of [
        "/etc/systemd/system/resume-ai-qcloud-network-tuning@eth0.service",
        "/run/systemd/transient/resume-ai-qcloud-network-tuning@eth9.service"
      ]) {
        await writeFile(rooted(relative), "[Service]\nExecStart=/bin/false\n", "utf8");
        await expect(runStateCheck()).rejects.toMatchObject({ code: 1 });
        await rm(rooted(relative), { force: true });
      }

      const instanceDropin = rooted(
        "/etc/systemd/system/resume-ai-qcloud-network-tuning@eth0.service.d"
      );
      await mkdir(instanceDropin, { recursive: true });
      await writeFile(path.join(instanceDropin, "override.conf"), "[Service]\nPrivateTmp=no\n");
      await expect(runStateCheck()).rejects.toMatchObject({ code: 1 });
      await rm(instanceDropin, { recursive: true, force: true });

      await writeFile(
        stateFile,
        JSON.stringify({ ...validState, NeedDaemonReload: "yes" }),
        "utf8"
      );
      await expect(runStateCheck()).rejects.toMatchObject({ code: 1 });
      await writeFile(stateFile, JSON.stringify(validState), "utf8");

      const alternateControls = [
        ["/var/spool/cron/crontabs/root", "/usr/bin/bash /etc/rc.local\n"],
        ["/etc/init.d/legacy-qcloud", "/usr/local/qcloud/udev_run/udev_run.sh\n"],
        ["/etc/network/if-up.d/legacy-rc", "/bin/bash /etc/rc.d/rc.local\n"],
        ["/etc/cloud/cloud.cfg.d/99-legacy.cfg", "runcmd: [ /bin/bash, /etc/rc.local ]\n"],
        [
          "/usr/lib/systemd/system-generators/legacy-qcloud",
          "/usr/local/qcloud/irq/net_smp_affinity.sh\n"
        ]
      ] as const;
      for (const [relative, content] of alternateControls) {
        await mkdir(path.dirname(rooted(relative)), { recursive: true });
        await writeFile(rooted(relative), content, "utf8");
        await expect(runStateCheck()).rejects.toMatchObject({ code: 1 });
        await rm(rooted(relative), { force: true });
      }
      await expect(runStateCheck()).resolves.toBeDefined();
    } finally {
      await rm(fixture, { recursive: true, force: true });
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("publishes only complete rc-local backups and round-trips the fixed restore allowlist", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-rc-backup-"));
    const sourceRoot = path.join(fixture, "source");
    const backupRoot = path.join(fixture, "backups");
    const backupId = "20260827T001500Z.ABCDEFGH";
    const pending = path.join(backupRoot, `.pending-${backupId}`);
    const complete = path.join(backupRoot, backupId);
    const recovery = path.join(root, "ops/bin/rc-local-backup.py");
    const rooted = (base: string, absolute: string) => path.join(base, absolute.slice(1));
    const runVerify = (candidate: string) =>
      execFileAsync("python3", [recovery, "verify", candidate, "--expected-backup-id", backupId]);
    try {
      await mkdir(sourceRoot, { mode: 0o700 });
      await mkdir(backupRoot, { mode: 0o700 });
      await mkdir(rooted(sourceRoot, "/etc/rc.d"), { recursive: true });
      await mkdir(rooted(sourceRoot, "/etc/udev/rules.d"), { recursive: true });
      await mkdir(rooted(sourceRoot, "/usr/local/lib/resume-ai"), { recursive: true });
      await writeFile(rooted(sourceRoot, "/etc/rc.local"), "#!/usr/bin/bash\nlegacy\n", {
        mode: 0o755
      });
      await chmod(rooted(sourceRoot, "/etc/rc.local"), 0o755);
      await symlink("/etc/rc.local", rooted(sourceRoot, "/etc/rc.d/rc.local"));
      await writeFile(
        rooted(sourceRoot, "/etc/udev/rules.d/80-qcloud-nic.rules"),
        "legacy qcloud rule\n",
        { mode: 0o644 }
      );
      await writeFile(
        rooted(sourceRoot, "/usr/local/lib/resume-ai/run-qcloud-network-tuning.sh"),
        "#!/usr/bin/bash\nexit 0\n",
        { mode: 0o755 }
      );
      await chmod(
        rooted(sourceRoot, "/usr/local/lib/resume-ai/run-qcloud-network-tuning.sh"),
        0o755
      );
      await mkdir(pending, { mode: 0o700 });
      await writeFile(path.join(pending, "rc-local-status.txt"), "inactive\n", { mode: 0o600 });
      await chmod(path.join(pending, "rc-local-status.txt"), 0o600);

      await expect(
        execFileAsync("python3", [
          recovery,
          "create",
          pending,
          backupId,
          "--fixture-source-root",
          sourceRoot
        ])
      ).resolves.toBeDefined();
      await rename(pending, complete);
      await expect(execFileAsync("python3", [recovery, "verify", complete]))
        .resolves.toBeDefined();

      const restoreRoot = await mkdtemp(path.join(tmpdir(), "resume-ai-rc-restore-"));
      try {
        const absentTarget = rooted(
          restoreRoot,
          "/usr/local/share/resume-ai/approved-qcloud-network-tuning.conf"
        );
        await mkdir(path.dirname(absentTarget), { recursive: true });
        await writeFile(absentTarget, "must be removed\n", "utf8");
        await expect(
          execFileAsync("python3", [recovery, "restore-test", complete, restoreRoot])
        ).resolves.toBeDefined();
        expect(await readFile(rooted(restoreRoot, "/etc/rc.local"), "utf8"))
          .toBe("#!/usr/bin/bash\nlegacy\n");
        expect((await lstat(rooted(restoreRoot, "/etc/rc.local"))).mode & 0o777)
          .toBe(0o755);
        expect(await readlink(rooted(restoreRoot, "/etc/rc.d/rc.local")))
          .toBe("/etc/rc.local");
        expect(existsSync(absentTarget)).toBe(false);
      } finally {
        await rm(restoreRoot, { recursive: true, force: true });
      }

      const cloneBackup = async (label: string) => {
        const parent = path.join(fixture, label);
        const candidate = path.join(parent, backupId);
        await mkdir(parent, { mode: 0o700 });
        await cp(complete, candidate, { recursive: true, preserveTimestamps: true });
        await chmod(candidate, 0o700);
        return candidate;
      };

      const withoutMarker = await cloneBackup("without-marker");
      await rm(path.join(withoutMarker, "BACKUP_COMPLETE.json"));
      await expect(runVerify(withoutMarker)).rejects.toMatchObject({ code: 1 });

      const withExtra = await cloneBackup("with-extra");
      await writeFile(path.join(withExtra, "unreviewed"), "extra\n", "utf8");
      await expect(runVerify(withExtra)).rejects.toMatchObject({ code: 1 });

      const changedBytes = await cloneBackup("changed-bytes");
      await writeFile(path.join(changedBytes, "rc.local"), "changed\n", "utf8");
      await expect(runVerify(changedBytes)).rejects.toMatchObject({ code: 1 });

      const changedMode = await cloneBackup("changed-mode");
      await chmod(path.join(changedMode, "rc.local"), 0o700);
      await expect(runVerify(changedMode)).rejects.toMatchObject({ code: 1 });

      const changedLink = await cloneBackup("changed-link");
      await rm(path.join(changedLink, "rc.d-rc-local"));
      await symlink("/attacker", path.join(changedLink, "rc.d-rc-local"));
      await expect(runVerify(changedLink)).rejects.toMatchObject({ code: 1 });
    } finally {
      await execFileAsync("chmod", ["-R", "u+rwX", fixture]).catch(() => undefined);
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects an SSH Match rule before it can reopen a hardened setting", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-sshd-match-"));
    const config = path.join(fixture, "sshd_config");
    try {
      await writeFile(
        config,
        [
          "PasswordAuthentication no",
          "AllowTcpForwarding no",
          "Match User ubuntu",
          "  PasswordAuthentication yes",
          "  AllowTcpForwarding yes",
          ""
        ].join("\n"),
        "utf8"
      );
      await expect(
        execFileAsync(
          "/bin/bash",
          [path.join(root, "ops/bin/assert-ssh-effective-policy.sh"), config],
          { env: { ...process.env, PATH: `/usr/sbin:${process.env.PATH ?? ""}` } }
        )
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("context-sensitive SSH Match rules are forbidden")
      });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("pins the official Nginx package only after exact signing-key verification", async () => {
    const installer = await read("ops/bin/migrate-nginx-1.30.4.sh");
    const approved = await read("ops/config/approved-nginx-versions.conf");
    const base = await read("ops/nginx/nginx.conf");
    const nginxRecovery = await read("ops/systemd/nginx-resume-ai-recovery.conf");
    const migrationRecovery = await read(
      "ops/systemd/resume-ai-nginx-migration-recovery.service"
    );
    const migrationGate = await read("ops/bin/nginx-migration-recovery-gate.sh");
    const recoverMigration = await read("ops/bin/recover-nginx-migration.sh");
    const finalizeRecovery = await read(
      "ops/bin/finalize-nginx-migration-recovery.sh"
    );
    expect(approved).toContain("573BFD6B3D8FBC641079A6ABABF5BD827BD9BF62");
    expect(approved).toContain("NGINX_PACKAGE_VERSION=1.30.4-1~jammy");
    expect(approved).toContain(
      "APPROVED_NGINX_PACKAGE_SHA256=6e4460183d918f245de67290a56a9ea0d84c39b7135fc87a202d72b3a6942fb2"
    );
    expect(approved).toContain(
      "APPROVED_NGINX_PACKAGE_URL=https://nginx.org/packages/ubuntu/pool/nginx/n/nginx/nginx_1.30.4-1~jammy_amd64.deb"
    );
    const nginxPolicy = new Map(
      approved
        .split("\n")
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)] as const;
        })
    );
    expect(nginxPolicy.get("AUTOMATIC_RECOVERY_PACKAGE_VERSION")).toBe(
      nginxPolicy.get("APPROVED_NGINX_PACKAGE_VERSION")
    );
    expect(nginxPolicy.get("AUTOMATIC_RECOVERY_PACKAGE_SHA256")).toBe(
      nginxPolicy.get("APPROVED_NGINX_PACKAGE_SHA256")
    );
    expect(approved).not.toMatch(/^UBUNTU_ROLLBACK_/mu);
    expect(installer).toContain("primary_fingerprints");
    expect(installer).toContain('cmp -s "$OFFICIAL_DEB" "${signed_apt_debs[0]}"');
    expect(installer).toContain('apt-get -s install "$OFFICIAL_DEB"');
    expect(installer).toContain('-o Dpkg::Options::=--force-confold "$OFFICIAL_DEB"');
    expect(installer.indexOf("official key bundle primary-key members differ from the exact approved set")).toBeLessThan(
      installer.indexOf("apt-get update")
    );
    expect(installer).toContain("recover-nginx-migration.sh");
    expect(installer).toContain(
      'cmp -s "$SCRIPT_DIR/recover-nginx-migration.sh" "$RECOVERY_SCRIPT"'
    );
    expect(installer).toContain("install_live_marker");
    expect(installer).toContain('OFFICIAL_DEB="$BACKUP_DIR/approved-deb/');
    expect(installer).toContain(
      '-o Dpkg::Options::=--force-confold "$OFFICIAL_DEB"'
    );
    expect(installer).not.toContain("sha256sum ./*.deb > SHA256SUMS");
    expect(installer.indexOf('sync -f "$OFFICIAL_DEB"')).toBeLessThan(
      installer.indexOf("write_migration_journal prepared")
    );
    expect(installer).toContain(
      "normal Nginx restart incorrectly activated boot recovery"
    );
    expect(installer.indexOf("install_live_marker")).toBeLessThan(
      installer.indexOf("systemctl restart nginx")
    );
    expect(migrationRecovery).toContain(
      "ExecCondition=/usr/local/lib/resume-ai/nginx-migration-recovery-gate.sh"
    );
    expect(migrationGate).toContain("START_TIME_TICKS");
    expect(migrationGate).toContain("/proc/$PID/cmdline");
    expect(migrationGate).toContain("sync -f \"$RUNTIME_DIR\"");
    expect(recoverMigration).toContain("systemctl stop nginx");
    expect(recoverMigration).toContain("systemctl start --no-block nginx");
    expect(recoverMigration).not.toContain("systemctl restart nginx");
    expect(recoverMigration).toContain(
      "EXPECTED_OFFICIAL_SHA256=6e4460183d918f245de67290a56a9ea0d84c39b7135fc87a202d72b3a6942fb2"
    );
    expect(recoverMigration.indexOf("cached official Nginx recovery package differs")).toBeLessThan(
      recoverMigration.indexOf("systemctl stop nginx")
    );
    expect(recoverMigration).toContain(
      '-o Dpkg::Options::=--force-confold "$OFFICIAL_DEB"'
    );
    expect(recoverMigration).not.toContain("--allow-downgrades");
    expect(recoverMigration).not.toContain("1.18.0-6ubuntu14.20");
    expect(recoverMigration).toContain("PHASE=recovered_waiting_for_service");
    expect(recoverMigration.match(/rm -f -- "\$PENDING_FILE"/gu)).toHaveLength(1);
    expect(finalizeRecovery).toContain('unlink "$PENDING_FILE"');
    expect(base).toContain("user nginx;");
    expect(base).toContain("ssl_protocols TLSv1.2 TLSv1.3;");
    expect(base).toContain("include /etc/nginx/conf.d/*.conf;");
    expect(base).not.toContain("modules-enabled");
    expect(base).not.toContain("sites-enabled");
    expect(nginxRecovery).toContain("Requires=resume-ai-pm2.service");
  });

  it("freezes the complete PM2 and pnpm runtime dependency graph", async () => {
    const installer = await read("ops/bin/install-node-runtime.sh");
    const policy = await read("ops/config/approved-node-runtime.conf");
    const packageJsonBytes = await readFile(path.join(root, "ops/node-runtime/package.json"));
    const packageLockBytes = await readFile(path.join(root, "ops/node-runtime/package-lock.json"));
    const packageJson = JSON.parse(packageJsonBytes.toString("utf8")) as {
      dependencies: Record<string, string>;
    };
    const packageLock = JSON.parse(packageLockBytes.toString("utf8")) as {
      lockfileVersion: number;
      packages: Record<string, { integrity?: string; link?: boolean; resolved?: string }>;
    };

    expect(packageJson.dependencies).toEqual({ pm2: "7.0.4", pnpm: "11.19.0" });
    expect(packageLock.lockfileVersion).toBe(3);
    expect(Object.keys(packageLock.packages).length).toBeGreaterThan(2);
    for (const [name, metadata] of Object.entries(packageLock.packages)) {
      if (name === "") continue;
      expect(metadata.link).not.toBe(true);
      expect(metadata.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//u);
      expect(metadata.integrity).toMatch(/^sha512-/u);
    }
    expect(policy).toContain(
      `RUNTIME_PACKAGE_JSON_SHA256=${createHash("sha256").update(packageJsonBytes).digest("hex")}`
    );
    expect(policy).toContain(
      `RUNTIME_PACKAGE_LOCK_SHA256=${createHash("sha256").update(packageLockBytes).digest("hex")}`
    );
    expect(installer).toContain("runtime_npm ci");
    expect(installer).toContain("env -i HOME=\"$WORK_DIR/npm-home\"");
    expect(installer).toContain("npm_config_userconfig=/dev/null");
    expect(installer).toContain("npm_config_registry=https://registry.npmjs.org/");
    expect(installer).toContain("curl -q -fL");
    expect(installer).toContain('cd "$RUNTIME_TOOLS_DIR"');
    expect(installer).not.toContain('--prefix "$RUNTIME_TOOLS_DIR"');
    expect(installer).not.toMatch(/npm"? install/u);
    expect(installer).toContain('"$OPS_DIR/bin/verify-single-link-tree.sh" "$STAGING_DIR"');
    expect(installer).toContain('"$OPS_DIR/bin/verify-single-link-tree.sh" "$FINAL_DIR"');
    expect(installer).toContain("node24-installed-tree.jsonl");
    expect(installer).toContain("node24-existing-tree.jsonl");
  });

  it("recovers every durable Node runtime switch phase before PM2 can boot", async () => {
    const installer = await read("ops/bin/install-node-runtime.sh");
    const recovery = await read("ops/bin/recover-node-runtime.sh");
    const gate = await read("ops/bin/node-runtime-recovery-gate.sh");
    const unit = await read("ops/systemd/resume-ai-node-runtime-recovery.service");
    const dropIn = await read("ops/systemd/resume-ai-pm2-node-recovery.conf");
    const layout = await read("ops/bin/install-runtime-layout.sh");
    const host = await read("ops/bin/verify-production-host.sh");
    const phases = [
      "prepared",
      "runtime_ready",
      "pointer_switched",
      "unit_installed",
      "service_restarted",
      "sources_disabled",
      "committed"
    ];
    for (const phase of phases) {
      expect(installer).toContain(`write_node_journal ${phase}`);
      expect(recovery).toContain(phase);
    }
    expect(installer.indexOf('fsync_tree "$STAGING_DIR"')).toBeLessThan(
      installer.indexOf("write_node_journal prepared")
    );
    expect(installer.indexOf("install_live_marker")).toBeLessThan(
      installer.indexOf("systemctl restart resume-ai-pm2.service")
    );
    expect(installer).toContain('fsync_tree "$FINAL_DIR"');
    expect(installer).toContain('fsync_tree "$BACKUP_DIR"');
    expect(installer).toContain("NodeSource source file is linked, writable, or not root-owned");
    expect(recovery).toContain("disabled NodeSource file differs from its protected backup");
    expect(installer).toContain('sync -f "$NODE_ROOT"');
    expect(installer).toContain('sync -f "$BACKUP_ROOT"');
    expect(recovery).toContain('if systemctl is-active --quiet resume-ai-pm2.service; then');
    expect(recovery).toContain('systemctl stop resume-ai-pm2.service');
    expect(recovery.indexOf('unlink "$PENDING_FILE"')).toBeLessThan(
      recovery.indexOf("systemctl start --no-block resume-ai-pm2.service")
    );
    expect(gate).toContain("START_TIME_TICKS");
    expect(gate).toContain("/proc/$PID/cmdline");
    expect(gate).toContain("cannot read the live Node installer process identity");
    expect(gate).toContain("stale Node installer marker could not be removed");
    expect(unit).toContain("Before=resume-ai-pm2.service");
    expect(unit).toContain("ConditionPathExists=/opt/nodejs/node-runtime.pending");
    expect(unit).toContain(
      "ExecCondition=/usr/local/lib/resume-ai/node-runtime-recovery-gate.sh"
    );
    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain(
      "ReadWritePaths=/opt/nodejs /etc/systemd/system /etc/logrotate.d -/etc/apt/sources.list /etc/apt/sources.list.d -/var/lib/resume-ai /run/resume-ai-locks"
    );
    expect(dropIn).toContain("Requires=resume-ai-node-runtime-recovery.service");
    expect(layout).toContain("resume-ai-node-runtime-recovery.service");
    expect(layout).toContain("node-runtime-recovery-gate.sh");
    expect(layout).toContain("recover-node-runtime.sh");
    expect(layout).toContain("install_boot_control()");
    expect(layout.indexOf("read-proc-start-ticks.py")).toBeLessThan(
      layout.indexOf("resume-ai-pm2-node-recovery.conf")
    );
    expect(host).toContain("/opt/nodejs/node-runtime.pending");
    expect(host).toContain("/run/resume-ai-locks/node-runtime.live");
    expect(host).toContain("PM2 does not require Node runtime recovery");
    expect(host).toContain("PM2 is not ordered after Node runtime recovery");
    expect(installer).toContain("open_root_lock 8 deploy");
    expect(installer).toContain("open_root_lock 9 node-runtime");
    expect(recovery).toContain("open_root_lock 8 deploy");
    expect(recovery).toContain("open_root_lock 9 node-runtime");
    expect(installer).toContain("snapshot-pm2-dump.py");
    expect(installer).toContain("read-proc-start-ticks.py");
    expect(installer).not.toContain("awk '{print $22}'");
    expect(gate).not.toContain("awk '{print $22}'");
    expect(installer).toContain("install_root_control()");
    expect(installer).toContain('sync -f "$temporary"');
    expect(installer).toContain('mv -f -- "$temporary" "$destination"');
    expect(recovery).toContain("unsafe_previous_member");
    expect(recovery).toContain("unsafe_previous_link");
    expect(recovery).toContain('"$SCRIPT_DIR/verify-single-link-tree.sh" "$previous_resolved"');
    expect(recovery).toContain("/proc/self/mountinfo");
  });

  it("snapshots a PM2 dump through stable no-follow descriptors", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-pm2-dump-"));
    const pm2Home = path.join(fixture, "pm2-home");
    const source = path.join(pm2Home, "dump.pm2");
    const destination = path.join(fixture, "protected.dump.pm2");
    const helper = path.join(root, "ops/bin/snapshot-pm2-dump.py");
    const uid = process.getuid?.() ?? 0;
    const gid = process.getgid?.() ?? 0;
    try {
      await mkdir(pm2Home, { mode: 0o750 });
      await chmod(pm2Home, 0o750);
      await writeFile(source, "[]\n", { encoding: "utf8", mode: 0o600 });
      await chmod(source, 0o600);
      await expect(execFileAsync("python3", [
        "-I", helper, source, destination, String(uid), String(gid)
      ])).resolves.toMatchObject({ stdout: "present\n" });
      await expect(readFile(destination, "utf8")).resolves.toBe("[]\n");

      await rm(destination);
      await rm(source);
      await symlink("/etc/passwd", source);
      await expect(execFileAsync("python3", [
        "-I", helper, source, destination, String(uid), String(gid)
      ])).rejects.toBeDefined();

      await rm(source);
      const secondName = path.join(pm2Home, "dump-alias.pm2");
      await writeFile(source, "[]\n", { encoding: "utf8", mode: 0o600 });
      await chmod(source, 0o600);
      await link(source, secondName);
      await expect(execFileAsync("python3", [
        "-I", helper, source, destination, String(uid), String(gid)
      ])).rejects.toBeDefined();
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it.skipIf(!existsSync(`/proc/${process.pid}/stat`))(
    "reads Linux process start ticks after the complete parenthesized comm field",
    async () => {
      const helper = path.join(root, "ops/bin/read-proc-start-ticks.py");
      const raw = await readFile(`/proc/${process.pid}/stat`, "utf8");
      const closingParenthesis = raw.lastIndexOf(")");
      const expected = raw.slice(closingParenthesis + 1).trim().split(/\s+/u)[19];
      await expect(execFileAsync("python3", ["-I", helper, String(process.pid)]))
        .resolves.toMatchObject({ stdout: `${expected}\n` });
      const source = await read("ops/bin/read-proc-start-ticks.py");
      expect(source).toContain('value.rfind(")")');
      expect(source).toContain("suffix[19]");
    }
  );

  it("rejects hard links and dependency symlinks that escape the frozen tree", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-link-tree-"));
    const tree = path.join(fixture, "node_modules");
    const packageDirectory = path.join(tree, "package");
    const packageFile = path.join(packageDirectory, "index.js");
    const outsideFile = path.join(fixture, "outside.js");
    const verifier = path.join(root, "ops/bin/verify-single-link-tree.sh");
    try {
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(packageFile, "export default true;\n", "utf8");
      await writeFile(outsideFile, "outside\n", "utf8");
      await symlink("package/index.js", path.join(tree, "internal-link.js"));
      await expect(execFileAsync("/bin/bash", [verifier, tree])).resolves.toBeDefined();

      await link(outsideFile, path.join(tree, "cache-hardlink.js"));
      await expect(execFileAsync("/bin/bash", [verifier, tree])).rejects.toMatchObject({ code: 1 });
      await rm(path.join(tree, "cache-hardlink.js"));

      await symlink("../outside.js", path.join(tree, "escape.js"));
      await expect(execFileAsync("/bin/bash", [verifier, tree])).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("binds immutable runtime evidence to each symlink target and metadata entry", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-tree-manifest-"));
    const tree = path.join(fixture, "runtime");
    const manifest = path.join(root, "ops/bin/create-immutable-tree-manifest.py");
    try {
      await mkdir(tree);
      await writeFile(path.join(tree, "first.js"), "same bytes\n", "utf8");
      await writeFile(path.join(tree, "second.js"), "same bytes\n", "utf8");
      await symlink("first.js", path.join(tree, "entry.js"));
      const first = await execFileAsync(manifest, [tree]);
      await rm(path.join(tree, "entry.js"));
      await symlink("second.js", path.join(tree, "entry.js"));
      const second = await execFileAsync(manifest, [tree]);
      expect(first.stdout).not.toBe(second.stdout);
      expect(first.stdout).toContain('"target":"first.js"');
      expect(second.stdout).toContain('"target":"second.js"');
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects every extra PM2 process and execution-critical environment injection", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-pm2-topology-"));
    const live = path.join(fixture, "live.json");
    const dump = path.join(fixture, "dump.json");
    const appEnvironment = path.join(fixture, "app.env");
    const quotaEnvironment = path.join(fixture, "quota.env");
    const verifier = path.join(root, "ops/bin/verify-pm2-topology.mjs");
    const release = "20260826T120000Z";
    const releaseDirectory = `/opt/resume-ai/releases/${release}`;
    const environment = {
      status: "online",
      pm_cwd: releaseDirectory,
      pm_exec_path: `${releaseDirectory}/node_modules/next/dist/bin/next`,
      exec_interpreter: "/opt/nodejs/current/bin/node",
      exec_mode: "fork_mode",
      args: ["start", "--hostname", "127.0.0.1", "--port", "3000"],
      AI_PROVIDER: "deepseek",
      SESSION_TRANSITIONS_PER_SESSION: "12",
      APP_RELEASE_DIR: releaseDirectory,
      APP_PORT: "3000",
      APP_PROCESS_NAME: "resume-ai-3000",
      HOME: "/var/lib/resume-ai",
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PM2_HOME: "/var/lib/resume-ai/.pm2",
      PORT: "3000",
      PATH: "/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      instances: 1,
      autorestart: true,
      watch: false,
      merge_logs: true,
      max_memory_restart: 768 * 1024 * 1024,
      restart_delay: 1000,
      exp_backoff_restart_delay: 100,
      min_uptime: 10_000,
      max_restarts: 10,
      kill_timeout: 10_000,
      listen_timeout: 15_000,
      pm_out_log_path: "/var/log/resume-ai/resume-ai-3000-out.log",
      pm_err_log_path: "/var/log/resume-ai/resume-ai-3000-error.log"
    };
    const approved = [{ name: "resume-ai-3000", pm2_env: environment }];
    const persistedEnvironment = { ...environment, instances: undefined };
    const persistedApproved = [{ name: "resume-ai-3000", pm2_env: persistedEnvironment }];
    const verify = () =>
      execFileAsync(process.execPath, [
        verifier,
        live,
        dump,
        "/opt/resume-ai/releases",
        "3000",
        release,
        "none",
        "none",
        appEnvironment,
        quotaEnvironment
      ]);
    const verifyPersistedBootState = () =>
      execFileAsync(process.execPath, [
        verifier,
        "--dump-only",
        dump,
        "/opt/resume-ai/releases",
        "3000",
        release,
        "none",
        "none",
        appEnvironment,
        quotaEnvironment
      ]);
    try {
      await writeFile(appEnvironment, "AI_PROVIDER=deepseek\n", "utf8");
      await writeFile(quotaEnvironment, "SESSION_TRANSITIONS_PER_SESSION=12\n", "utf8");
      await writeFile(live, JSON.stringify(approved), "utf8");
      await writeFile(dump, JSON.stringify(persistedApproved), "utf8");
      await expect(verify()).resolves.toBeDefined();
      await expect(verifyPersistedBootState()).resolves.toBeDefined();

      await writeFile(
        dump,
        JSON.stringify([...persistedApproved, { name: "boot-persistence", ...persistedEnvironment }]),
        "utf8"
      );
      await expect(verifyPersistedBootState()).rejects.toMatchObject({ code: 1 });
      await writeFile(dump, JSON.stringify(persistedApproved), "utf8");

      await writeFile(
        live,
        JSON.stringify([...approved, { name: "unapproved-worker", pm2_env: environment }]),
        "utf8"
      );
      await expect(verify()).rejects.toMatchObject({ code: 1 });

      await writeFile(live, JSON.stringify(approved), "utf8");
      for (const [key, value] of [
        ["NODE_OPTIONS", "--require=/tmp/x.js"],
        ["NODE_EXTRA_CA_CERTS", "/var/lib/resume-ai/attacker-ca.pem"],
        ["NODE_USE_ENV_PROXY", "1"],
        ["HTTPS_PROXY", "http://127.0.0.1:8080"],
        ["https_proxy", "http://127.0.0.1:8080"],
        ["OPENSSL_CONF", "/var/lib/resume-ai/openssl.cnf"],
        ["TZ", "Pacific/Kiritimati"]
      ] as const) {
        const injected = [{ name: "resume-ai-3000", pm2_env: { ...environment, [key]: value } }];
        await writeFile(live, JSON.stringify(injected), "utf8");
        await expect(verify()).rejects.toMatchObject({ code: 1 });
        await writeFile(dump, JSON.stringify(injected), "utf8");
        await expect(verifyPersistedBootState()).rejects.toMatchObject({ code: 1 });
        await writeFile(dump, JSON.stringify(persistedApproved), "utf8");
      }
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("runs retention from immutable SQL under a fixed NOLOGIN database role", async () => {
    const service = await read("ops/systemd/resume-ai-security-state-cleanup.service");
    const sql = await read("ops/postgresql/cleanup-security-state.sql");
    const provision = await read("ops/bin/provision-postgres-maintenance-role.sh");
    expect(service).toContain(
      "ExecStart=/usr/local/lib/resume-ai/run-security-state-cleanup.sh"
    );
    expect(service).not.toContain("/opt/resume-ai/current");
    expect(service).not.toContain("node_modules");
    expect(sql).toContain("SET ROLE resume_ai_security_maintenance;");
    expect(sql).toContain("LIMIT 500 FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("interval '180 days'");
    expect(sql.match(/^COMMIT;/gmu)).toHaveLength(8);
    expect(sql).toContain("CLEANUP_REMAINING");
    expect(provision).toContain("NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT");
    expect(provision).toContain("GRANT SELECT,DELETE ON TABLE");
    expect(provision).toContain("GRANT UPDATE (%s) ON TABLE");
    expect(provision).toContain("legacy-without-lock-columns");
  });

  it("requires the exact unheld PostgreSQL 14.24 server and package revision", async () => {
    const policy = await read("ops/config/approved-postgres-runtime.conf");
    const assertion = await read("ops/bin/assert-postgres-security-version.sh");
    const checksum = await read("ops/bin/enable-postgres-checksums.sh");
    const host = await read("ops/bin/verify-production-host.sh");
    const installer = await read("ops/bin/install-backup-jobs.sh");
    expect(policy).toContain("POSTGRES_SERVER_VERSION_NUM=140024");
    expect(policy).toContain("POSTGRES_PACKAGE_VERSION=14.24-0ubuntu0.22.04.1");
    expect(policy).toContain("POSTGRES_SERVER_PACKAGE=postgresql-14");
    expect(policy).toContain("POSTGRES_CLIENT_PACKAGE=postgresql-client-14");
    expect(policy).toContain("POSTGRES_LIBPQ_PACKAGE=libpq5");
    expect(assertion).toContain("apt-mark showhold");
    expect(assertion).toContain("current_setting('server_version_num')");
    expect(assertion).toContain("PGHOST=/var/run/postgresql");
    expect(assertion).toContain("PGPORT=\"${policy[POSTGRES_PORT]}\"");
    expect(checksum).toContain("assert-postgres-security-version.sh");
    expect(host).toContain("PostgreSQL 14.24 package and live-server security revision");
    expect(installer).toContain("approved-postgres-runtime.conf");
  });

  it("binds an installed PostgreSQL package to the reviewed security pocket", async () => {
    const assertion = path.join(root, "ops/bin/assert-postgres-security-version.sh");
    const version = "14.24-0ubuntu0.22.04.1";
    const uri = "http://mirrors.tencentyun.com/ubuntu";
    const suite = "jammy-security/main";
    const approvedSuites = "jammy-security/main,jammy-updates/main";
    const verify = (fixture: string) =>
      execFileAsync("/bin/bash", [
        assertion,
        "--verify-apt-policy-source",
        path.join(root, fixture),
        version,
        uri,
        suite,
        approvedSuites
      ]);

    await expect(
      verify("tests/fixtures/apt-cache-policy/postgresql-14-installed.txt")
    ).resolves.toBeDefined();
    await expect(
      verify("tests/fixtures/apt-cache-policy/postgresql-14-wrong-origin.txt")
    ).rejects.toMatchObject({ code: 1 });
    await expect(
      verify("tests/fixtures/apt-cache-policy/postgresql-14-same-version-evil.txt")
    ).rejects.toMatchObject({ code: 1 });
  });

  it.skipIf(!existsSync("/proc/self/mountinfo"))(
    "rejects an APT root hook or trust-path override without executing it",
    async () => {
      const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-apt-hook-"));
      const helper = path.join(root, "ops/bin/assert-apt-effective-config.sh");
      const expected = path.join(root, "ops/config/approved-apt-effective.conf");
      const approved = await readFile(expected, "utf8");
      const dump = path.join(fixture, "apt-config.dump");
      const marker = path.join(fixture, "must-not-run");
      try {
        await writeFile(dump, `${approved}Unrelated::Safe \"1\";\n`, { mode: 0o600 });
        await expect(execFileAsync("/bin/bash", [helper, expected, dump])).resolves.toBeDefined();

        await writeFile(
          dump,
          `${approved}DPkg::Pre-Invoke:: \"touch ${marker}\";\n` +
            'Dir::Etc::sourcelist \"attacker.list\";\n',
          { mode: 0o600 }
        );
        await expect(execFileAsync("/bin/bash", [helper, expected, dump]))
          .rejects.toMatchObject({ code: 1 });
        await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    }
  );

  it("requires every authenticated Jammy security and updates target to be active", async () => {
    const helper = path.join(root, "ops/bin/assert-apt-active-sources.sh");
    const policy = path.join(root, "ops/config/approved-apt-sources.conf");
    const verify = (fixture: string) =>
      execFileAsync("/bin/bash", [helper, policy, path.join(root, fixture)]);

    await expect(
      verify("tests/fixtures/apt-indextargets/active.txt")
    ).resolves.toBeDefined();
    await expect(
      verify("tests/fixtures/apt-indextargets/security-disabled.txt")
    ).rejects.toMatchObject({ code: 1 });
    await expect(
      verify("tests/fixtures/apt-indextargets/duplicate-security.txt")
    ).rejects.toMatchObject({ code: 1 });

    const unauthenticated = await mkdtemp(path.join(tmpdir(), "resume-ai-apt-targets-"));
    try {
      const active = await read("tests/fixtures/apt-indextargets/active.txt");
      await writeFile(
        path.join(unauthenticated, "targets.txt"),
        active.replace("jammy-security_main_binary-amd64_Packages|yes", "jammy-security_main_binary-amd64_Packages|no"),
        "utf8"
      );
      await expect(
        execFileAsync("/bin/bash", [helper, policy, path.join(unauthenticated, "targets.txt")])
      ).rejects.toMatchObject({ code: 1 });
      await writeFile(
        path.join(unauthenticated, "targets.txt"),
        active.replaceAll("|amd64|", "|arm64|"),
        "utf8"
      );
      await expect(
        execFileAsync("/bin/bash", [helper, policy, path.join(unauthenticated, "targets.txt")])
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(unauthenticated, { recursive: true, force: true });
    }
  });

  it("keeps runtime DELETE behind reviewed RPCs and preserves legacy ordering", async () => {
    const tables = await read("ops/postgresql/runtime-table-privileges.conf");
    const functions = await read("ops/postgresql/runtime-function-privileges.conf");
    const provision = await read("ops/bin/provision-postgres-runtime-role.sh");
    const deploy = await read("ops/bin/deploy-release.sh");
    expect(tables).not.toMatch(/(^|,)DELETE(,|$)/mu);
    expect(functions.match(/^resume_ai_runtime_/gmu)).toHaveLength(7);
    expect(provision).toContain("legacy runtime DELETE differs from the exact eight-table compatibility set");
    expect(provision).toContain("SET statement_timeout TO '10s'");
    expect(provision).toContain("SET lock_timeout TO '5s'");
    expect(provision).toContain("SET idle_in_transaction_session_timeout TO '15s'");
    expect(deploy.indexOf("write_journal hardening_started")).toBeLessThan(
      deploy.indexOf("provision-postgres-runtime-role.sh reconcile", deploy.indexOf("write_journal hardening_started"))
    );
    expect(deploy.indexOf("DB_PERMISSIONS_HARDENED=1", deploy.indexOf("write_journal hardening_started"))).toBeLessThan(
      deploy.indexOf("provision-postgres-runtime-role.sh reconcile", deploy.indexOf("write_journal hardening_started"))
    );
    expect(deploy).toContain("write_journal permissions_hardened");
    expect(provision).toContain("SCRAM-SHA-256");
    expect(provision).toContain("unexpected connectable databases");
    expect(provision).toContain('REVOKE ALL PRIVILEGES ON DATABASE postgres FROM PUBLIC');
  });

  it("rejects privilege-changing automatic migrations outside the frozen PUBLIC revokes", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-expand-policy-"));
    const validator = path.join(root, "ops/bin/validate-expand-migration.py");
    try {
      for (const [name, sql] of [
        ["grant.sql", "GRANT ALL ON TABLE confidential_rows TO reporting_login;\n"],
        ["revoke.sql", "REVOKE SELECT ON TABLE live_state FROM active_runtime;\n"]
      ] as const) {
        const migration = path.join(fixture, name);
        await writeFile(migration, sql, "utf8");
        await expect(execFileAsync("python3", [validator, migration])).rejects.toMatchObject({ code: 1 });
      }
      for (const migration of [
        "20260826_ai_model_daily_usage.sql",
        "20260826_competition_shared_security_state.sql"
      ]) {
        await expect(execFileAsync("python3", [validator, path.join(root, "db/migrations", migration)]))
          .resolves.toBeDefined();
      }
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("isolates the real PostgreSQL gate from the production network namespace", async () => {
    const deploy = await read("ops/bin/deploy-release.sh");
    expect(deploy).toContain("POSTGRES_SECURITY_STATE_TEST_DATABASE_URL");
    expect(deploy).toContain("POSTGRES_SECURITY_STATE_RUNTIME_DATABASE_URL");
    expect(deploy).toContain('JoinsNamespaceOf=$TEST_PG_UNIT');
    expect(deploy).toContain("PrivateNetwork=yes");
    expect(deploy).toContain("InaccessiblePaths=/run/postgresql /var/run/postgresql");
    expect(deploy).toContain("isolated builder unexpectedly reached the production PostgreSQL socket");
    expect(deploy).not.toContain('createuser --login');
  });

  it("scans large binary evidence instead of skipping NUL-containing files", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-secret-scan-"));
    const binary = path.join(fixture, "large-evidence.bin");
    try {
      const data = Buffer.alloc(21 * 1024 * 1024, 0);
      Buffer.from("-----BEGIN " + "OPENSSH PRIVATE KEY-----").copy(data, data.length - 128);
      await writeFile(binary, data);
      await expect(
        execFileAsync("/bin/bash", [path.join(root, "ops/bin/scan-release-secrets.sh"), binary])
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("fully scans excluded-looking evidence paths and never trusts marker substrings", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-secret-scan-full-"));
    const hidden = path.join(fixture, "artifacts", ".next", "node_modules");
    try {
      await mkdir(hidden, { recursive: true });
      await writeFile(
        path.join(hidden, "credential.txt"),
        "-----BEGIN " + "OPENSSH PRIVATE KEY-----\nnot-a-real-key\n",
        "utf8"
      );
      await expect(
        execFileAsync("/bin/bash", [
          path.join(root, "ops/bin/scan-release-secrets.sh"),
          "--full",
          fixture
        ])
      ).rejects.toMatchObject({ code: 1 });

      await writeFile(
        path.join(hidden, "credential.txt"),
        `AI_API_KEY=sk-example${"a".repeat(32)}\n`,
        "utf8"
      );
      await expect(
        execFileAsync("/bin/bash", [
          path.join(root, "ops/bin/scan-release-secrets.sh"),
          "--full",
          fixture
        ])
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("scans nested generated-looking source paths and signs them into the source manifest", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-nested-source-"));
    const pathsOutput = path.join(tmpdir(), `resume-ai-nested-source-paths-${process.pid}-${Date.now()}.nul`);
    try {
      await execFileAsync("/usr/bin/git", ["init", "-q", fixture]);
      for (const relative of ["public/artifacts/credential.txt", "src/.next-cache/credential.txt"]) {
        const absolute = path.join(fixture, relative);
        await mkdir(path.dirname(absolute), { recursive: true });
        await writeFile(absolute, `AI_API_KEY=sk-${"a".repeat(32)}\n`, "utf8");
      }
      await execFileAsync("/usr/bin/git", ["-C", fixture, "add", "-f", "."]);
      await expect(execFileAsync("/bin/bash", [
        path.join(root, "ops/bin/scan-release-secrets.sh"), "--source-tree", fixture
      ])).rejects.toMatchObject({ code: 1 });
      const { stdout } = await execFileAsync("/bin/bash", [
        path.join(root, "ops/bin/create-release-source-manifest.sh"), fixture
      ], { env: { ...process.env, RELEASE_SOURCE_PATHS_NUL: pathsOutput } });
      expect(stdout).toContain("public/artifacts/credential.txt");
      expect(stdout).toContain("src/.next-cache/credential.txt");
    } finally {
      await rm(fixture, { recursive: true, force: true });
      await rm(pathsOutput, { force: true });
    }
  });

  it.skipIf(!existsSync("/Volumes/Postgres-2.9.5-14/Postgres.app/Contents/Versions/14/bin/initdb"))(
    "passes the real PostgreSQL cleanup, cross-database, restore and lock-timeout regression",
    async () => {
      await expect(execFileAsync("/bin/bash", [
        path.join(root, "tests/deployment/postgres-ops-regression.sh")
      ], { timeout: 30_000 })).resolves.toBeDefined();
    },
    35_000
  );

  it("uses private root-only locks and bounded observable PostgreSQL jobs", async () => {
    const lock = await read("ops/bin/open-root-lock.sh");
    const backupService = await read("ops/systemd/resume-ai-postgres-backup.service");
    const restoreService = await read("ops/systemd/resume-ai-postgres-restore-verify.service");
    const installer = await read("ops/bin/install-backup-jobs.sh");
    expect(lock).toContain("/run/resume-ai-locks");
    expect(lock).toContain("root:root:700");
    expect(lock).toContain('readlink -e -- "$lock_root"');
    expect(lock).toContain("root:root:600:1");
    expect(installer).toContain("open-root-lock.sh");
    for (const service of [backupService, restoreService]) {
      expect(service).toContain("RuntimeDirectory=resume-ai-locks");
      expect(service).toContain("RestrictAddressFamilies=AF_UNIX");
      expect(service).toContain("OnFailure=resume-ai-postgres-ops-alert@%n.service");
      expect(service).toContain("TimeoutStartSec=");
      expect(service).not.toContain("RuntimeMaxSec=");
    }
  });

  it("requires real reboot evidence and explicit Lighthouse cloud review", async () => {
    const reboot = await read("ops/bin/record-maintenance-reboot.sh");
    const hardening = await read("ops/bin/harden-host-file-permissions.sh");
    const verify = await read("ops/bin/verify-production-host.sh");
    expect(reboot).toContain("BEFORE_BOOT_ID");
    expect(reboot).toContain("AFTER_BOOT_ID");
    expect(reboot).toContain('"${pending[BEFORE_BOOT_ID]}" != "$boot_id"');
    expect(hardening).toContain("CLOUD_CONSOLE_LIGHTHOUSE_DEPENDENCY");
    expect(hardening).toContain("CONFIRMED_ABSENT");
    expect(verify).toContain("last-maintenance-reboot.env");
    expect(verify).toContain("lighthouse-disabled.env");
    expect(verify).toContain('OPS_DIR="$ACTIVE_ROOT/ops"');
    expect(verify).toContain("OPS_DIR_OVERRIDE is forbidden");
    expect(verify).not.toContain("OPS_DIR=${OPS_DIR_OVERRIDE:-");
  });
});
