import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = process.cwd();

async function read(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("exact APT and unattended-upgrades controls", () => {
  it("treats all active Packages indexes as an exact allowlist", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-apt-policy-"));
    const helper = path.join(root, "ops/bin/assert-apt-active-sources.sh");
    const policy = path.join(root, "ops/config/approved-apt-sources.conf");
    const canonical = await read("tests/fixtures/apt-indextargets/active.txt");
    const targets = path.join(fixture, "targets.txt");
    const verify = (...extra: string[]) =>
      execFileAsync("/bin/bash", [helper, policy, targets, ...extra]);
    const esmRows = [
      "https://esm.ubuntu.com/apps/ubuntu|jammy-apps-security|jammy|main|amd64|Packages|Packages|/var/lib/apt/lists/esm.ubuntu.com_apps_ubuntu_dists_jammy-apps-security_main_binary-amd64_Packages|yes",
      "https://esm.ubuntu.com/infra/ubuntu|jammy-infra-security|jammy|main|amd64|Packages|Packages|/var/lib/apt/lists/esm.ubuntu.com_infra_ubuntu_dists_jammy-infra-security_main_binary-amd64_Packages|yes"
    ].join("\n") + "\n";
    try {
      await writeFile(targets, canonical, { mode: 0o600 });
      await expect(verify()).resolves.toMatchObject({ stdout: expect.stringContaining("13 targets") });

      await writeFile(
        targets,
        canonical + "https://deb.nodesource.com/node_20.x|nodistro|nodistro|main|amd64|Packages|Packages|/var/lib/apt/lists/deb.nodesource.com_node20_Packages|yes\n"
      );
      await expect(verify()).rejects.toMatchObject({ code: 1 });

      await writeFile(targets, canonical.replace("|jammy-updates|jammy|main|", "|jammy-backports|jammy|main|"));
      await expect(verify()).rejects.toMatchObject({ code: 1 });
      await writeFile(targets, canonical.replace("|jammy|jammy|nginx|", "|jammy|jammy|main|"));
      await expect(verify()).rejects.toMatchObject({ code: 1 });
      await writeFile(targets, canonical.replaceAll("|amd64|", "|arm64|"));
      await expect(verify()).rejects.toMatchObject({ code: 1 });
      await writeFile(targets, canonical.replace(/^https:\/\/nginx[^\n]+\n/mu, ""));
      await expect(verify()).rejects.toMatchObject({ code: 1 });
      await writeFile(
        targets,
        canonical.replace(
          "/var/lib/apt/lists/nginx.org_packages_ubuntu_dists_jammy_nginx_binary-amd64_Packages",
          "/tmp/fake-nginx-Packages"
        )
      );
      await expect(verify()).rejects.toMatchObject({ code: 1 });
      await writeFile(
        targets,
        canonical.replace(
          /\/var\/lib\/apt\/lists\/nginx[^|\n]+/u,
          "/var/lib/apt/lists/.."
        )
      );
      await expect(verify()).rejects.toMatchObject({ code: 1 });
      const firstIndex = canonical.match(/\/var\/lib\/apt\/lists\/[^|\n]+/u)?.[0];
      const nginxIndex = canonical.match(/\/var\/lib\/apt\/lists\/nginx[^|\n]+/u)?.[0];
      expect(firstIndex).toBeDefined();
      expect(nginxIndex).toBeDefined();
      await writeFile(targets, canonical.replace(nginxIndex!, firstIndex!));
      await expect(verify()).rejects.toMatchObject({ code: 1 });
      await writeFile(targets, canonical);
      const targetAlias = path.join(fixture, "targets-link.txt");
      await symlink(targets, targetAlias);
      await expect(execFileAsync("/bin/bash", [helper, policy, targetAlias]))
        .rejects.toMatchObject({ code: 1 });
      await rm(targetAlias);
      const targetHardlink = path.join(fixture, "targets-hardlink.txt");
      await link(targets, targetHardlink);
      await expect(verify()).rejects.toMatchObject({ code: 1 });
      await rm(targetHardlink);

      await writeFile(targets, canonical + esmRows);
      await expect(verify()).rejects.toMatchObject({ code: 1 });
      await expect(verify("--enable-esm")).resolves.toMatchObject({
        stdout: expect.stringContaining("15 targets")
      });

      await writeFile(
        targets,
        canonical + "https://attacker.invalid/ubuntu|evil|evil|main|amd64|Translation-en|Translation|/var/lib/apt/lists/attacker_translation|no\n"
      );
      await expect(verify()).resolves.toBeDefined();
      await writeFile(
        targets,
        canonical + "https://attacker.invalid/ubuntu|evil|evil|main|amd64|Packages|Sources|/var/lib/apt/lists/attacker_packages|yes\n"
      );
      await expect(verify()).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("requires the exact unattended security origin set and fail-closed scalar policy", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-unattended-config-"));
    const helper = path.join(root, "ops/bin/assert-unattended-upgrades-config.py");
    const dump = path.join(fixture, "apt-config.dump");
    const base = [
      'APT::Periodic::Update-Package-Lists "1";',
      'APT::Periodic::Unattended-Upgrade "1";',
      'APT::Periodic::AutocleanInterval "7";',
      'Unattended-Upgrade::Allowed-Origins "";',
      'Unattended-Upgrade::Allowed-Origins:: "${distro_id}:${distro_codename}-security";',
      'Unattended-Upgrade::Package-Blacklist "";',
      'Unattended-Upgrade::Remove-Unused-Kernel-Packages "false";',
      'Unattended-Upgrade::Remove-New-Unused-Dependencies "false";',
      'Unattended-Upgrade::Remove-Unused-Dependencies "false";',
      'Unattended-Upgrade::Automatic-Reboot "false";',
      'Unattended-Upgrade::Automatic-Reboot-WithUsers "false";',
      'Unattended-Upgrade::InstallOnShutdown "false";',
      'Unattended-Upgrade::Skip-Updates-On-Metered-Connections "false";',
      'Unattended-Upgrade::Allow-downgrade "false";',
      'Unattended-Upgrade::SyslogEnable "true";'
    ];
    const verify = (mode: "disabled" | "enabled") =>
      execFileAsync("python3", ["-I", helper, "--dump", dump, "--esm", mode]);
    try {
      await writeFile(dump, base.join("\n") + "\n", { mode: 0o600 });
      await chmod(dump, 0o600);
      await expect(verify("disabled")).resolves.toBeDefined();

      await writeFile(
        dump,
        [...base, 'Unattended-Upgrade::Allowed-Origins:: "attacker:stable";'].join("\n") + "\n"
      );
      await expect(verify("disabled")).rejects.toMatchObject({ code: 1 });
      await writeFile(
        dump,
        [...base, 'Unattended-Upgrade::Origins-Pattern:: "origin=attacker";'].join("\n") + "\n"
      );
      await expect(verify("disabled")).rejects.toMatchObject({ code: 1 });
      await writeFile(
        dump,
        base.join("\n").replace('Automatic-Reboot "false"', 'Automatic-Reboot "true"') + "\n"
      );
      await expect(verify("disabled")).rejects.toMatchObject({ code: 1 });
      await writeFile(
        dump,
        base.join("\n").replace('Allow-downgrade "false"', 'Allow-downgrade "true"') + "\n"
      );
      await expect(verify("disabled")).rejects.toMatchObject({ code: 1 });
      await writeFile(
        dump,
        [...base, 'Unattended-Upgrade::Package-Whitelist:: "openssl";'].join("\n") + "\n"
      );
      await expect(verify("disabled")).rejects.toMatchObject({ code: 1 });

      const esm = [
        ...base.slice(0, 5),
        'Unattended-Upgrade::Allowed-Origins:: "${distro_id}ESMApps:${distro_codename}-apps-security";',
        'Unattended-Upgrade::Allowed-Origins:: "${distro_id}ESM:${distro_codename}-infra-security";',
        ...base.slice(5)
      ];
      await writeFile(dump, esm.join("\n") + "\n");
      await expect(verify("enabled")).resolves.toBeDefined();
      await expect(verify("disabled")).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("parses the binary OpenPGP primary-key fingerprint used by Signed-By", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-openpgp-"));
    const keyring = path.join(fixture, "keyring.gpg");
    const modulePath = path.join(root, "ops/bin/assert-apt-trust-contract.py");
    const body = Buffer.from([4, 0, 0, 0, 1, 1, 0, 8, 3, 0, 8, 3]);
    const packet = Buffer.concat([Buffer.from([0xc6, body.length]), body]);
    const expected = createHash("sha1")
      .update(Buffer.concat([Buffer.from([0x99, 0, body.length]), body]))
      .digest("hex")
      .toUpperCase();
    const script = [
      "import importlib.util,pathlib,sys",
      "spec=importlib.util.spec_from_file_location('apttrust',sys.argv[1])",
      "module=importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "actual=module.primary_fingerprints(pathlib.Path(sys.argv[2]).read_bytes())",
      "raise SystemExit(0 if actual == {sys.argv[3]} else 1)"
    ].join(";");
    try {
      await writeFile(keyring, packet, { mode: 0o600 });
      await expect(execFileAsync("python3", ["-I", "-c", script, modulePath, keyring, expected]))
        .resolves.toBeDefined();
      await writeFile(keyring, packet.subarray(0, packet.length - 1));
      await expect(execFileAsync("python3", ["-I", "-c", script, modulePath, keyring, expected]))
        .rejects.toBeDefined();
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects an unknown, symlinked, or hard-linked active source before key use", async () => {
    const fixtureAlias = await mkdtemp(path.join(tmpdir(), "resume-ai-apt-root-"));
    const fixture = await realpath(fixtureAlias);
    const aptRoot = path.join(fixture, "etc/apt");
    const sources = path.join(aptRoot, "sources.list.d");
    const preferences = path.join(aptRoot, "preferences.d");
    const helper = path.join(root, "ops/bin/assert-apt-trust-contract.py");
    const templates = path.join(root, "ops/apt");
    const verify = () =>
      execFileAsync("python3", ["-I", helper, "--root", fixture, "--templates", templates]);
    const sourceNames = ["resume-ai-ubuntu.sources", "nginx.list"];
    const preferenceNames = [
      "99nginx",
      "99resume-ai-ubuntu",
      "ubuntu-pro-esm-apps",
      "ubuntu-pro-esm-infra"
    ];
    try {
      await mkdir(sources, { recursive: true, mode: 0o755 });
      await mkdir(preferences, { recursive: true, mode: 0o755 });
      for (const name of sourceNames) {
        await copyFile(path.join(templates, name), path.join(sources, name));
        await chmod(path.join(sources, name), 0o600);
      }
      for (const name of preferenceNames) {
        await copyFile(path.join(templates, name), path.join(preferences, name));
        await chmod(path.join(preferences, name), 0o600);
      }

      const unknown = path.join(sources, "nodesource.list");
      await writeFile(unknown, "deb https://deb.nodesource.com/node_20.x nodistro main\n", {
        mode: 0o600
      });
      await expect(verify()).rejects.toMatchObject({ code: 1 });
      await rm(unknown);

      const nginxSource = path.join(sources, "nginx.list");
      await rm(nginxSource);
      await symlink(path.join(templates, "nginx.list"), nginxSource);
      await expect(verify()).rejects.toMatchObject({ code: 1 });
      await rm(nginxSource);
      await copyFile(path.join(templates, "nginx.list"), nginxSource);
      await chmod(nginxSource, 0o600);

      const hardlinkAlias = path.join(fixture, "nginx-source-hardlink");
      await link(nginxSource, hardlinkAlias);
      await expect(verify()).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixtureAlias, { recursive: true, force: true });
    }
  });

  it("ships a journaled, recoverable transaction and a runnable Jammy gate", async () => {
    const installer = await read("ops/bin/install-unattended-upgrades.sh");
    const recovery = await read("ops/bin/recover-unattended-upgrades.sh");
    const runtime = await read("ops/bin/assert-unattended-upgrades-runtime.sh");
    const gate = await read("ops/bin/verify-apt-unattended-jammy.sh");
    const defaultPolicy = await read("ops/apt/52resume-ai-unattended-upgrades");
    const esmPolicy = await read("ops/apt/52resume-ai-unattended-upgrades-esm");
    const nginxPin = await read("ops/apt/99nginx");
    const recoveryUnit = await read("ops/systemd/resume-ai-apt-recovery.service");
    const linuxGate = await read("tests/deployment/apt-unattended-linux-root.sh");

    expect(installer).toContain("open_root_lock 8 deploy");
    expect(installer).toContain("open_root_lock 9 apt-dpkg");
    expect(installer).toContain("fcntl.LOCK_EX | fcntl.LOCK_NB");
    expect(installer).toContain("write_journal prepared");
    expect(installer.indexOf("write_journal prepared")).toBeLessThan(
      installer.indexOf("systemctl stop apt-daily.timer")
    );
    expect(installer).toContain("sync -f \"$STATE_DIR\"");
    expect(installer).toContain("TARGETS_SHA256=$TARGETS_SHA256");
    expect(installer).toContain("BACKUP_MANIFEST_SHA256=$BACKUP_MANIFEST_SHA256");
    expect(installer).toContain("TIMER_STATE_SHA256=$TIMER_STATE_SHA256");
    expect(installer).toContain("target_mode=\"$(stat -c '%a' \"$target\")\"");
    expect(installer).toContain("assert-apt-effective-config.sh");
    expect(installer).toContain("APT_TRANSACTION_LOCKS_HELD=1 \"$RECOVERY_SCRIPT\"");
    expect(installer).toContain("ACK_ENABLE_UBUNTU_ESM");
    expect(recovery).toContain("open_root_lock 9 apt-dpkg");
    expect(recovery).toContain("invalid APT recovery phase");
    expect(recovery).toContain("digest differs from its journal");
    expect(recovery).toContain("sealed manifest");
    expect(recovery.indexOf('sha256sum "$backup_manifest"')).toBeLessThan(
      recovery.indexOf("systemctl stop apt-daily.timer")
    );
    expect(recovery.lastIndexOf('unlink "$PENDING_FILE"')).toBeGreaterThan(
      recovery.indexOf("systemctl start \"$timer\"")
    );
    expect(runtime).toContain("--property=TimersCalendar");
    expect(runtime).toContain("--property=DropInPaths");
    expect(runtime).toContain("NextElapseUSecRealtime");
    expect(runtime).toContain("resume-ai-apt-recovery.service");
    expect(defaultPolicy).not.toContain("ESMApps");
    expect(defaultPolicy).not.toContain("infra-security");
    expect(esmPolicy).toContain("ESMApps");
    expect(nginxPin).toContain("Pin: version 1.30.4-1~jammy");
    expect(nginxPin).toContain("Pin: origin nginx.org");
    expect(nginxPin).not.toContain("Pin: release o=nginx");
    expect(nginxPin.match(/^Pin:/gmu)).toHaveLength(2);
    expect(recoveryUnit).toContain("Before=apt-daily.service apt-daily-upgrade.service");
    expect(recoveryUnit).toContain("RemainAfterExit=no");
    expect(recoveryUnit).not.toContain("RemainAfterExit=yes");
    expect(gate).toContain('VERSION_CODENAME:-}" = jammy');
    expect(gate).toContain("assert-apt-trust-contract.py");
    expect(gate).toContain("apt-get indextargets");
    expect(linuxGate).toContain("Ubuntu 22.04");
    expect(linuxGate).toContain("verify-apt-unattended-jammy.sh");
    await expect(execFileAsync("/bin/bash", ["-n", path.join(root, "ops/bin/verify-apt-unattended-jammy.sh")]))
      .resolves.toBeDefined();
    await expect(execFileAsync("/bin/bash", ["-n", path.join(root, "tests/deployment/apt-unattended-linux-root.sh")]))
      .resolves.toBeDefined();
  });
});
