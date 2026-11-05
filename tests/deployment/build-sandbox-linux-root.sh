#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${RESUME_AI_DISPOSABLE_VM:-}" = YES ] \
  || fail "run only in the disposable Ubuntu 22.04 deployment VM"
[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run the VM gate as root"
. /etc/os-release
[ "${ID:-}:${VERSION_ID:-}" = ubuntu:22.04 ] \
  || fail "this compatibility gate is pinned to Ubuntu 22.04"
[ "$(/usr/bin/env -i PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
  /opt/nodejs/current/bin/node --version)" = v24.20.0 ] \
  || fail "the fixed Node 24.20.0 runtime is required"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
SOURCE_VERIFIER="$REPO_ROOT/ops/bin/verify-release-source-tree.py"
[ -f "$SOURCE_VERIFIER" ] && [ ! -L "$SOURCE_VERIFIER" ] \
  || fail "source-tree verifier is unavailable"

account=resume-ai-build
uid="$(id -u "$account")"
gid="$(id -g "$account")"
[[ "$uid" =~ ^[1-9][0-9]*$ ]] && [[ "$gid" =~ ^[1-9][0-9]*$ ]] \
  && [ "$(id -gn "$account")" = "$account" ] \
  && [ "$(id -G "$account")" = "$gid" ] \
  || fail "builder account is root-equivalent or has supplementary groups"
pgrep -u "$uid" >/dev/null 2>&1 \
  && fail "builder account was not idle before the VM smoke"

fixture="$(mktemp -d /var/tmp/resume-ai-build-sandbox.XXXXXX)"
home="/run/resume-ai-build-smoke.$$"
unit="resume-ai-build-smoke-$$.service"
network_unit="resume-ai-build-network-smoke-$$.service"
registry_hosts="/run/resume-ai-build-registry-hosts.$$"
http_server_pid=""
cleanup() {
  systemctl stop "$unit" >/dev/null 2>&1 || true
  systemctl stop "$network_unit" >/dev/null 2>&1 || true
  if [ -n "$http_server_pid" ]; then kill "$http_server_pid" >/dev/null 2>&1 || true; fi
  pkill -KILL -u "$uid" >/dev/null 2>&1 || true
  rm -f -- "$registry_hosts"
  rm -rf --one-file-system -- "$home" "$fixture"
}
trap cleanup EXIT
install -d -o root -g "$account" -m 0750 "$fixture/source"
install -o root -g "$account" -m 0640 /dev/null "$fixture/source/reviewed.txt"
printf '%s\n' reviewed > "$fixture/source/reviewed.txt"
install -d -o "$account" -g "$account" -m 0700 "$fixture/source/output" "$home"

# The source verifier is a root-only, no-follow data gate. Exercise the real
# Jammy filesystem semantics: exact root-frozen input passes, while a linked
# root, an extra directory, or a writable reviewed member fails closed.
install -d -o root -g root -m 0750 "$fixture/verified-source"
printf '%s\n' reviewed-source > "$fixture/verified-source/reviewed.txt"
chown root:root "$fixture/verified-source/reviewed.txt"
chmod 0640 "$fixture/verified-source/reviewed.txt"
source_digest="$(sha256sum "$fixture/verified-source/reviewed.txt" | awk '{print $1}')"
printf '%s\tF\treviewed.txt\n' "$source_digest" > "$fixture/source-manifest.txt"
chown root:root "$fixture/source-manifest.txt"
chmod 0400 "$fixture/source-manifest.txt"
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I "$SOURCE_VERIFIER" \
  --source "$fixture/verified-source" --manifest "$fixture/source-manifest.txt" \
  > "$fixture/observed-source-manifest.txt"
cmp -s "$fixture/observed-source-manifest.txt" "$fixture/source-manifest.txt" \
  || fail "root-frozen source did not reproduce its manifest"
ln -s "$fixture/verified-source" "$fixture/linked-source"
if /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I "$SOURCE_VERIFIER" \
  --source "$fixture/linked-source" --manifest "$fixture/source-manifest.txt" \
  >/dev/null 2>&1; then
  fail "source verifier accepted a linked source root"
fi
install -d -o root -g root -m 0750 "$fixture/verified-source/unapproved"
if /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I "$SOURCE_VERIFIER" \
  --source "$fixture/verified-source" --manifest "$fixture/source-manifest.txt" \
  >/dev/null 2>&1; then
  fail "source verifier accepted an unapproved empty directory"
fi
rmdir "$fixture/verified-source/unapproved"
chmod 0660 "$fixture/verified-source/reviewed.txt"
if /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I "$SOURCE_VERIFIER" \
  --source "$fixture/verified-source" --manifest "$fixture/source-manifest.txt" \
  >/dev/null 2>&1; then
  fail "source verifier accepted a writable reviewed member"
fi
chmod 0640 "$fixture/verified-source/reviewed.txt"

# Jammy's CPython 3.10 does not implement chmod(..., follow_symlinks=False).
# Exercise the exact no-follow primitive used by deploy: open the reviewed
# inode with O_NOFOLLOW, revalidate it through fstat, then fchmod the descriptor.
install -d -o root -g root -m 0750 "$fixture/fchmod-tree"
install -o root -g root -m 0600 /dev/null "$fixture/fchmod-tree/member.txt"
ln -s member.txt "$fixture/fchmod-tree/member-link"
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I - "$fixture/fchmod-tree" "$gid" <<'PY'
import os
import pathlib
import stat
import sys

root = pathlib.Path(sys.argv[1])
link_gid = int(sys.argv[2])
member = root / "member.txt"
link = root / "member-link"
if os.chmod in os.supports_follow_symlinks:
    raise SystemExit("Jammy compatibility fixture unexpectedly supports no-follow chmod")
expected = member.lstat()
flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
handle = os.open(member, flags)
try:
    observed = os.fstat(handle)
    if (
        (observed.st_dev, observed.st_ino) != (expected.st_dev, expected.st_ino)
        or not stat.S_ISREG(observed.st_mode)
        or observed.st_nlink != 1
    ):
        raise SystemExit("descriptor identity changed before fchmod")
    os.fchmod(handle, 0o640)
finally:
    os.close(handle)
if stat.S_IMODE(member.stat().st_mode) != 0o640:
    raise SystemExit("descriptor chmod did not update the reviewed inode")
target_mode = stat.S_IMODE(member.stat().st_mode)
os.lchown(link, 0, link_gid)
link_metadata = link.lstat()
if not stat.S_ISLNK(link_metadata.st_mode) or link_metadata.st_gid != link_gid:
    raise SystemExit("no-follow symlink ownership update failed")
if stat.S_IMODE(member.stat().st_mode) != target_mode:
    raise SystemExit("symlink ownership update changed the target mode")
PY

# A newly created symlink inherits root's effective group even below a
# root:resume-ai directory on non-setgid filesystems. Deployment must therefore
# set and verify the no-follow owner explicitly so the host contract is real.
install -d -o root -g resume-ai -m 0750 "$fixture/cache-parent"
install -d -o resume-ai -g resume-ai -m 0750 "$fixture/runtime-cache"
ln -s "$fixture/runtime-cache" "$fixture/cache-parent/cache"
chown -h root:resume-ai "$fixture/cache-parent/cache"
[ "$(stat -c '%U:%G:%h' "$fixture/cache-parent/cache")" = root:resume-ai:1 ] \
  && [ "$(readlink -- "$fixture/cache-parent/cache")" = "$fixture/runtime-cache" ] \
  && [ "$(readlink -e -- "$fixture/cache-parent/cache")" = "$fixture/runtime-cache" ] \
  && [ "$(stat -c '%U:%G:%a' "$fixture/runtime-cache")" = resume-ai:resume-ai:750 ] \
  || fail "release cache symlink no-follow identity fixture failed"

# V8 is intentionally not placed behind MemoryDenyWriteExecute: that switch is
# incompatible with JIT runtimes on some Jammy kernels. The actual deployment
# boundary is the dedicated account plus namespace, mount, capability and
# no-new-privileges restrictions exercised here.
systemd-run --quiet --wait --collect --pipe --service-type=exec \
  --unit="$unit" --uid="$account" --gid="$account" \
  --working-directory="$fixture/source" \
  --property=KillMode=control-group --property=NoNewPrivileges=yes \
  --property=PrivateNetwork=yes --property=PrivateTmp=yes --property=PrivateDevices=yes \
  --property=ProtectHome=yes --property=ProtectSystem=strict \
  --property=ProtectKernelTunables=yes --property=ProtectKernelModules=yes \
  --property=ProtectControlGroups=yes --property=ProtectProc=invisible --property=ProcSubset=pid \
  --property=RestrictSUIDSGID=yes --property=RestrictNamespaces=yes \
  --property=LockPersonality=yes --property='CapabilityBoundingSet=' \
  --property='AmbientCapabilities=' --property='RestrictAddressFamilies=AF_UNIX' \
  --property="ReadOnlyPaths=$fixture/source" \
  --property="ReadWritePaths=$fixture/source/output $home" \
  /usr/bin/env -i HOME="$home" PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
    /opt/nodejs/current/bin/node -e '
      const fs = require("node:fs");
      let blocked = false;
      try { fs.writeFileSync("reviewed.txt", "tampered\n"); }
      catch (error) { blocked = error?.code === "EROFS" || error?.code === "EACCES"; }
      if (!blocked) process.exit(71);
      fs.writeFileSync("output/result.txt", "node-smoke-ok\n");
    '

[ "$(cat "$fixture/source/reviewed.txt")" = reviewed ] \
  && [ "$(cat "$fixture/source/output/result.txt")" = node-smoke-ok ] \
  || fail "read-only source or explicit output partition failed"
pgrep -u "$uid" >/dev/null 2>&1 \
  && fail "builder process survived the transient unit"

# Exercise the dependency unit's positive and negative egress boundary. DNS is
# replaced with one root-frozen hosts file, all IP traffic is denied by default,
# and only globally routable addresses resolved for the official npm registry
# are admitted. A real local listener proves that non-allowlisted loopback is
# denied by the unit rather than merely being unavailable.
mapfile -t registry_ips < <(/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/getent ahosts registry.npmjs.org | /usr/bin/awk '{print $1}' | /usr/bin/sort -u)
[ "${#registry_ips[@]}" -gt 0 ] || fail "official npm registry did not resolve"
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin /usr/bin/python3 -I - \
  "${registry_ips[@]}" <<'PY'
import ipaddress
import sys

for raw in sys.argv[1:]:
    address = ipaddress.ip_address(raw)
    if not address.is_global:
        raise SystemExit(f"non-public registry address: {address}")
PY
printf '%s\n' '127.0.0.1 localhost' > "$registry_hosts"
registry_allow=()
for registry_ip in "${registry_ips[@]}"; do
  printf '%s %s\n' "$registry_ip" registry.npmjs.org >> "$registry_hosts"
  registry_allow+=(--property="IPAddressAllow=$registry_ip")
done
chown root:root "$registry_hosts"
chmod 0444 "$registry_hosts"

/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I -m http.server 18080 --bind 127.0.0.1 \
  </dev/null >/dev/null 2>&1 &
http_server_pid=$!
for _ in 1 2 3 4 5; do
  /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    /usr/bin/curl --noproxy '*' -fsS http://127.0.0.1:18080/ >/dev/null && break
  sleep 1
done
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/curl --noproxy '*' -fsS http://127.0.0.1:18080/ >/dev/null \
  || fail "local negative-control listener is unavailable"

systemd-run --quiet --wait --collect --pipe --service-type=exec \
  --unit="$network_unit" --uid="$account" --gid="$account" \
  --working-directory=/ \
  --property=KillMode=control-group --property=NoNewPrivileges=yes \
  --property=PrivateTmp=yes --property=PrivateDevices=yes --property=ProtectHome=yes \
  --property=ProtectSystem=strict --property=ProtectKernelTunables=yes \
  --property=ProtectKernelModules=yes --property=ProtectControlGroups=yes \
  --property=ProtectProc=invisible --property=ProcSubset=pid \
  --property=RestrictSUIDSGID=yes --property=RestrictNamespaces=yes \
  --property=LockPersonality=yes --property='CapabilityBoundingSet=' \
  --property='AmbientCapabilities=' --property='RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' \
  --property=IPAddressDeny=any "${registry_allow[@]}" \
  --property="BindReadOnlyPaths=$registry_hosts:/etc/hosts" \
  /usr/bin/env -i HOME="$home" PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
    /opt/nodejs/current/bin/node - <<'NODE'
const https = require("node:https");
const net = require("node:net");

function registryRequest() {
  return new Promise((resolve, reject) => {
    const request = https.get("https://registry.npmjs.org/", { timeout: 10_000 }, (response) => {
      response.resume();
      response.on("end", () => response.statusCode === 200 ? resolve() : reject(new Error(`registry HTTP ${response.statusCode}`)));
    });
    request.on("timeout", () => request.destroy(new Error("registry request timeout")));
    request.on("error", reject);
  });
}

function requireBlockedLoopback() {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port: 18080 });
    socket.setTimeout(2_000, () => { socket.destroy(); resolve(); });
    socket.on("connect", () => { socket.destroy(); reject(new Error("non-allowlisted loopback connected")); });
    socket.on("error", () => resolve());
  });
}

(async () => {
  await registryRequest();
  await requireBlockedLoopback();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
pgrep -u "$uid" >/dev/null 2>&1 \
  && fail "builder process survived the registry egress unit"
printf '%s\n' "Node 24.20.0 Jammy build sandbox smoke passed."
