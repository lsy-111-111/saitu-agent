#!/usr/bin/python3
"""Validate and run the reviewed Tencent Cloud NIC tuning chain.

The production modes intentionally use fixed absolute paths.  A rooted fixture
mode exists so the same validation and execution boundaries can be exercised
without touching a host configuration.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import signal
import stat
import subprocess
import sys
from collections.abc import Iterable


POLICY_PATH = "/usr/local/share/resume-ai/approved-qcloud-network-tuning.conf"
EXPECTED_POLICY_SHA256 = "681d6cadf973be1b54701e81bc9be7ad9e6b2140d9da51e52b7eb195dfa95a8f"
RUNNER_PATH = "/usr/local/lib/resume-ai/run-qcloud-network-tuning.sh"
TEMPLATE_PATH = "/etc/systemd/system/resume-ai-qcloud-network-tuning@.service"
TEMPLATE_NAME = "resume-ai-qcloud-network-tuning@.service"
INSTANCE_PATTERN = re.compile(r"^resume-ai-qcloud-network-tuning@.+\.service$")
DROPIN_PATTERN = re.compile(r"^resume-ai-qcloud-network-tuning@.*\.service\.d$")
INTERFACE_PATTERN = re.compile(r"^eth[0-9]+$")

VENDOR_CONTRACT = {
    "/usr/local/qcloud/udev_run/udev_run.sh": "755",
    "/usr/local/qcloud/irq/net_smp_affinity.sh": "755",
    "/usr/local/qcloud/rps/set_rps.sh": "755",
    "/usr/local/qcloud/xps/set_xps.sh": "744",
}
EXECUTED_VENDOR_SCRIPTS = (
    ("/usr/local/qcloud/irq/net_smp_affinity.sh", True),
    ("/usr/local/qcloud/rps/set_rps.sh", False),
    ("/usr/local/qcloud/xps/set_xps.sh", False),
)
SYSTEMD_SEARCH_ROOTS = (
    "/etc/systemd/system",
    "/run/systemd/system",
    "/run/systemd/transient",
    "/run/systemd/generator",
    "/run/systemd/generator.early",
    "/run/systemd/generator.late",
    "/usr/local/lib/systemd/system",
    "/usr/lib/systemd/system",
)
SCHEDULE_SEARCH_ROOTS = (
    "/etc/systemd",
    "/run/systemd/system",
    "/run/systemd/transient",
    "/usr/local/lib/systemd/system",
    "/usr/lib/systemd/system",
    "/etc/crontab",
    "/etc/anacrontab",
    "/etc/cron.d",
    "/etc/cron.hourly",
    "/etc/cron.daily",
    "/etc/cron.weekly",
    "/etc/cron.monthly",
    "/var/spool/cron/crontabs/root",
    "/var/spool/cron/atjobs",
    "/etc/init.d",
    "/etc/network/if-up.d",
    "/etc/network/if-pre-up.d",
    "/etc/network/if-down.d",
    "/etc/network/if-post-down.d",
    "/etc/NetworkManager/dispatcher.d",
    "/etc/networkd-dispatcher",
    "/usr/lib/networkd-dispatcher",
    "/etc/cloud/cloud.cfg",
    "/etc/cloud/cloud.cfg.d",
    "/var/lib/cloud/scripts",
    "/var/lib/cloud/instances",
    "/var/lib/cloud/seed",
    "/etc/systemd/system-generators",
    "/usr/local/lib/systemd/system-generators",
    "/usr/lib/systemd/system-generators",
    "/etc/profile",
    "/etc/profile.d",
    "/root/.profile",
    "/root/.bash_profile",
    "/root/.bashrc",
    "/root/.config/systemd",
)
UDEV_SEARCH_ROOTS = (
    "/etc/udev/rules.d",
    "/run/udev/rules.d",
    "/usr/lib/udev/rules.d",
)
APPROVED_UDEV_RULE = "/etc/udev/rules.d/80-qcloud-nic.rules"
APPROVED_UDEV_WANT = b"resume-ai-qcloud-network-tuning@%k.service"
QCLOUD_REFERENCE = re.compile(rb"/usr/local/qcloud/(?:udev_run|irq|rps|xps)(?:/|\b)")
RC_LOCAL_REFERENCE = re.compile(
    rb"(?:^|[\s\"'=])/(?:etc/rc\.local|etc/rc\.d/rc\.local)(?:$|[\s\"';&|)])"
)
SYSTEMD_PROPERTIES = (
    "LoadState",
    "FragmentPath",
    "DropInPaths",
    "NeedDaemonReload",
    "Type",
    "User",
    "Group",
    "RuntimeDirectory",
    "RuntimeDirectoryMode",
    "ExecStart",
    "PrivateTmp",
    "NoNewPrivileges",
    "ProtectSystem",
    "ProtectHome",
    "ProtectKernelModules",
    "ProtectControlGroups",
    "ProtectHostname",
    "RestrictSUIDSGID",
    "RestrictNamespaces",
    "LockPersonality",
    "MemoryDenyWriteExecute",
    "CapabilityBoundingSet",
    "AmbientCapabilities",
    "RestrictAddressFamilies",
)


class ControlError(RuntimeError):
    pass


def fail(message: str) -> "NoReturn":
    raise ControlError(message)


def normalized_root(raw: str) -> pathlib.Path:
    root = pathlib.Path(raw)
    if not root.is_absolute() or any(part in {".", ".."} for part in root.parts):
        fail("fixture root must be a normalized absolute path")
    try:
        metadata = os.lstat(root)
    except OSError as error:
        fail(f"fixture root is unavailable: {error}")
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        fail("fixture root must be an ordinary directory")
    return root


def rooted(root: pathlib.Path, absolute: str) -> pathlib.Path:
    value = pathlib.PurePosixPath(absolute)
    if not value.is_absolute() or any(part in {".", ".."} for part in value.parts):
        fail(f"unsafe absolute control path: {absolute}")
    if root == pathlib.Path("/"):
        return pathlib.Path(absolute)
    return root.joinpath(*value.parts[1:])


def stable(metadata: os.stat_result) -> tuple[int, ...]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_nlink,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def trusted_identity(root: pathlib.Path) -> tuple[int, int]:
    if root == pathlib.Path("/"):
        return (0, 0)
    metadata = os.lstat(root)
    return (metadata.st_uid, metadata.st_gid)


def assert_directory_chain(root: pathlib.Path, absolute: str) -> None:
    target = rooted(root, absolute)
    owner_uid, _ = trusted_identity(root)
    boundary = root if root != pathlib.Path("/") else pathlib.Path("/")
    current = target
    chain: list[pathlib.Path] = []
    while True:
        chain.append(current)
        if current == boundary:
            break
        if boundary not in current.parents:
            fail(f"trusted directory escaped its root: {absolute}")
        current = current.parent
    for directory in reversed(chain):
        try:
            metadata = os.lstat(directory)
        except OSError as error:
            fail(f"trusted directory is unavailable: {directory}: {error}")
        if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
            fail(f"trusted directory is linked or not a directory: {directory}")
        if metadata.st_uid != owner_uid or stat.S_IMODE(metadata.st_mode) & 0o022:
            fail(f"trusted directory is not owner-controlled: {directory}")


def hash_fd(descriptor: int) -> str:
    digest = hashlib.sha256()
    offset = 0
    while True:
        chunk = os.pread(descriptor, 1024 * 1024, offset)
        if not chunk:
            return digest.hexdigest()
        digest.update(chunk)
        offset += len(chunk)


def read_fd(descriptor: int, maximum: int) -> bytes:
    metadata = os.fstat(descriptor)
    if metadata.st_size > maximum:
        fail("reviewed control file exceeds its size bound")
    chunks: list[bytes] = []
    offset = 0
    while offset < metadata.st_size:
        chunk = os.pread(descriptor, min(1024 * 1024, metadata.st_size - offset), offset)
        if not chunk:
            fail("reviewed control file changed while it was read")
        chunks.append(chunk)
        offset += len(chunk)
    return b"".join(chunks)


def open_verified_file(
    root: pathlib.Path,
    absolute: str,
    expected_mode: int,
    expected_sha256: str | None,
) -> int:
    assert_directory_chain(root, str(pathlib.PurePosixPath(absolute).parent))
    mapped = rooted(root, absolute)
    flags = os.O_RDONLY | os.O_NOFOLLOW
    try:
        descriptor = os.open(mapped, flags)
    except OSError as error:
        fail(f"reviewed file could not be opened without following links: {absolute}: {error}")
    try:
        metadata = os.fstat(descriptor)
        owner_uid, owner_gid = trusted_identity(root)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_nlink != 1
            or metadata.st_uid != owner_uid
            or metadata.st_gid != owner_gid
            or stat.S_IMODE(metadata.st_mode) != expected_mode
        ):
            fail(f"reviewed file metadata is unsafe: {absolute}")
        if expected_sha256 is not None and hash_fd(descriptor) != expected_sha256:
            fail(f"reviewed file differs from its approved hash: {absolute}")
        try:
            path_metadata = os.lstat(mapped)
        except OSError as error:
            fail(f"reviewed path changed while it was opened: {absolute}: {error}")
        if stable(path_metadata) != stable(metadata):
            fail(f"reviewed path changed while it was opened: {absolute}")
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def parse_policy(value: bytes) -> dict[str, tuple[int, str]]:
    try:
        text = value.decode("ascii")
    except UnicodeDecodeError:
        fail("QCloud tuning policy is not ASCII")
    approved: dict[str, tuple[int, str]] = {}
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        fields = line.split("|")
        if len(fields) != 3:
            fail("malformed QCloud tuning policy entry")
        path, mode, sha256 = fields
        if path not in VENDOR_CONTRACT or mode != VENDOR_CONTRACT[path]:
            fail("QCloud tuning policy contains an unreviewed path or mode")
        if path in approved or re.fullmatch(r"[a-f0-9]{64}", sha256) is None:
            fail("QCloud tuning policy contains a duplicate or malformed hash")
        approved[path] = (int(mode, 8), sha256)
    if set(approved) != set(VENDOR_CONTRACT):
        fail("QCloud tuning policy does not contain the exact reviewed vendor files")
    return approved


def open_vendor_generation(
    root: pathlib.Path,
) -> tuple[dict[str, int], dict[str, tuple[int, str]]]:
    policy_expected = EXPECTED_POLICY_SHA256 if root == pathlib.Path("/") else None
    policy_fd = open_verified_file(root, POLICY_PATH, 0o444, policy_expected)
    try:
        approved = parse_policy(read_fd(policy_fd, 64 * 1024))
    finally:
        os.close(policy_fd)
    descriptors: dict[str, int] = {}
    try:
        for path, (mode, sha256) in approved.items():
            descriptors[path] = open_verified_file(root, path, mode, sha256)
        return descriptors, approved
    except Exception:
        for descriptor in descriptors.values():
            os.close(descriptor)
        raise


def validate_interface(root: pathlib.Path, interface: str) -> None:
    if INTERFACE_PATTERN.fullmatch(interface) is None:
        fail("untrusted network interface name")
    interface_path = rooted(root, f"/sys/class/net/{interface}")
    try:
        metadata = os.lstat(interface_path)
    except OSError as error:
        fail(f"network interface sysfs link is unavailable: {error}")
    if not stat.S_ISLNK(metadata.st_mode):
        fail("network interface does not have the expected kernel-owned sysfs link")
    resolved = pathlib.Path(os.path.realpath(interface_path))
    devices = pathlib.Path(os.path.realpath(rooted(root, "/sys/devices")))
    if devices not in resolved.parents or not resolved.is_dir():
        fail("network interface sysfs target is outside the reviewed devices tree")
    ethtool = rooted(root, "/usr/sbin/ethtool")
    try:
        ethtool_metadata = os.lstat(ethtool)
    except OSError as error:
        fail(f"ethtool is unavailable: {error}")
    if not stat.S_ISREG(ethtool_metadata.st_mode) or not os.access(ethtool, os.X_OK):
        fail("ethtool is required; refusing vendor fallback behavior")


def terminate_process_group(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    process.wait(timeout=5)


def run_stable_vendor_script(
    root: pathlib.Path,
    descriptor: int,
    original_path: str,
    arguments: list[str],
    interface: str,
) -> None:
    if root == pathlib.Path("/"):
        descriptor_path = f"/proc/self/fd/{descriptor}"
        if not pathlib.Path("/proc/self/fd").is_dir():
            fail("stable descriptor execution requires procfs")
        vendor_path = "/usr/sbin:/usr/bin"
        script_zero = original_path
    else:
        descriptor_path = f"/dev/fd/{descriptor}"
        if not pathlib.Path("/dev/fd").is_dir():
            fail("fixture descriptor execution requires /dev/fd")
        vendor_path = f"{root}/usr/sbin:{root}/usr/bin"
        script_zero = str(rooted(root, original_path))
    command = [
        "/usr/bin/env",
        "-i",
        "ACTION=add",
        f"INTERFACE={interface}",
        f"PATH={vendor_path}",
        "/bin/bash",
        "-c",
        'source "$1" "${@:2}"',
        script_zero,
        descriptor_path,
        *arguments,
    ]
    process = subprocess.Popen(command, pass_fds=(descriptor,), start_new_session=True)
    try:
        status = process.wait(timeout=25)
    except subprocess.TimeoutExpired:
        terminate_process_group(process)
        fail(f"reviewed QCloud tuning script timed out: {original_path}")
    if status != 0:
        fail(f"reviewed QCloud tuning script failed: {original_path}")


def vendor_command(root: pathlib.Path, action: str) -> None:
    if root == pathlib.Path("/") and os.geteuid() != 0:
        fail("QCloud network tuning must run as root")
    descriptors, _ = open_vendor_generation(root)
    try:
        if action == "--verify-only":
            print("QCloud network tuning vendor generation matches the reviewed contract.")
            return
        validate_interface(root, action)
        for path, takes_interface in EXECUTED_VENDOR_SCRIPTS:
            run_stable_vendor_script(
                root,
                descriptors[path],
                path,
                [action] if takes_interface else [],
                action,
            )
        print(f"Reviewed QCloud tuning completed for {action}.")
    finally:
        for descriptor in descriptors.values():
            os.close(descriptor)


def iter_tree_files(root: pathlib.Path, absolute: str) -> Iterable[tuple[str, pathlib.Path]]:
    start = rooted(root, absolute)
    try:
        metadata = os.lstat(start)
    except FileNotFoundError:
        return
    except OSError as error:
        fail(f"control path could not be inspected: {absolute}: {error}")
    if stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        yield (absolute, start)
        return
    if not stat.S_ISDIR(metadata.st_mode):
        fail(f"control path is a special file: {absolute}")
    for directory, directory_names, filenames in os.walk(start, followlinks=False):
        directory_names.sort()
        filenames.sort()
        for name in list(directory_names):
            candidate = pathlib.Path(directory, name)
            candidate_metadata = os.lstat(candidate)
            if stat.S_ISLNK(candidate_metadata.st_mode):
                directory_names.remove(name)
                logical = "/" + str(candidate.relative_to(root)) if root != pathlib.Path("/") else str(candidate)
                yield (logical, candidate)
        for name in filenames:
            candidate = pathlib.Path(directory, name)
            logical = "/" + str(candidate.relative_to(root)) if root != pathlib.Path("/") else str(candidate)
            yield (logical, candidate)


def read_control_file(path: pathlib.Path, logical: str) -> bytes:
    try:
        link_metadata = os.lstat(path)
        if stat.S_ISLNK(link_metadata.st_mode) and os.readlink(path) == "/dev/null":
            return b""
        metadata = os.stat(path)
    except OSError as error:
        fail(f"scheduled control could not be read: {logical}: {error}")
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 4 * 1024 * 1024:
        fail(f"scheduled control is special or oversized: {logical}")
    try:
        return path.read_bytes()
    except OSError as error:
        fail(f"scheduled control could not be read: {logical}: {error}")


def active_lines(value: bytes) -> Iterable[bytes]:
    for line in value.splitlines():
        stripped = line.lstrip()
        if not stripped or stripped.startswith((b"#", b";")):
            continue
        yield stripped


def assert_no_instance_artifacts(root: pathlib.Path) -> None:
    allowed_template = rooted(root, TEMPLATE_PATH)
    for search_root in SYSTEMD_SEARCH_ROOTS:
        start = rooted(root, search_root)
        if not start.exists():
            continue
        for directory, directory_names, filenames in os.walk(start, followlinks=False):
            for name in directory_names:
                if DROPIN_PATTERN.fullmatch(name):
                    fail(f"instance or template drop-in directory is forbidden: {pathlib.Path(directory, name)}")
                if INSTANCE_PATTERN.fullmatch(name):
                    fail(f"instance-specific QCloud tuning unit is forbidden: {pathlib.Path(directory, name)}")
            for name in filenames:
                candidate = pathlib.Path(directory, name)
                if name == TEMPLATE_NAME:
                    if candidate != allowed_template:
                        fail(f"duplicate QCloud tuning template is forbidden: {candidate}")
                elif INSTANCE_PATTERN.fullmatch(name):
                    fail(f"instance-specific QCloud tuning unit is forbidden: {candidate}")


def systemctl_properties(root: pathlib.Path, state_dir: pathlib.Path | None, unit: str) -> dict[str, str]:
    if state_dir is not None:
        state_file = state_dir / f"{unit}.json"
        try:
            value = json.loads(state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            fail(f"fixture systemd state is unavailable: {state_file}: {error}")
        if not isinstance(value, dict) or set(value) != set(SYSTEMD_PROPERTIES):
            fail(f"fixture systemd state has an invalid property set: {state_file}")
        if not all(isinstance(item, str) for item in value.values()):
            fail(f"fixture systemd state contains a non-string property: {state_file}")
        return value
    command = ["/usr/bin/systemctl", "show", unit, "--no-pager"]
    command.extend(f"--property={name}" for name in SYSTEMD_PROPERTIES)
    result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=15)
    if result.returncode != 0 or result.stderr:
        fail(f"systemd effective state could not be read for {unit}")
    properties: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if "=" not in line:
            fail(f"systemd returned malformed state for {unit}")
        name, value = line.split("=", 1)
        if name not in SYSTEMD_PROPERTIES or name in properties:
            fail(f"systemd returned an unknown or duplicate property for {unit}")
        properties[name] = value
    if set(properties) != set(SYSTEMD_PROPERTIES):
        fail(f"systemd omitted an effective property for {unit}")
    return properties


def assert_effective_instance(root: pathlib.Path, state_dir: pathlib.Path | None, interface: str) -> None:
    unit = f"resume-ai-qcloud-network-tuning@{interface}.service"
    properties = systemctl_properties(root, state_dir, unit)
    expected_fragment = str(rooted(root, TEMPLATE_PATH))
    exact = {
        "LoadState": "loaded",
        "FragmentPath": expected_fragment,
        "DropInPaths": "",
        "NeedDaemonReload": "no",
        "Type": "oneshot",
        "User": "root",
        "Group": "root",
        "RuntimeDirectory": "resume-ai-locks",
        "RuntimeDirectoryMode": "0700",
        "PrivateTmp": "yes",
        "NoNewPrivileges": "yes",
        "ProtectSystem": "strict",
        "ProtectHome": "yes",
        "ProtectKernelModules": "yes",
        "ProtectControlGroups": "yes",
        "ProtectHostname": "yes",
        "RestrictSUIDSGID": "yes",
        "RestrictNamespaces": "yes",
        "LockPersonality": "yes",
        "MemoryDenyWriteExecute": "yes",
        "AmbientCapabilities": "",
    }
    for name, expected in exact.items():
        if properties[name] != expected:
            fail(f"QCloud tuning instance has unsafe {name}: {unit}")
    expected_exec = f"path={RUNNER_PATH} ; argv[]={RUNNER_PATH} {interface} ;"
    if expected_exec not in properties["ExecStart"] or properties["ExecStart"].count("path=") != 1:
        fail(f"QCloud tuning instance has an unreviewed ExecStart: {unit}")
    capabilities = set(properties["CapabilityBoundingSet"].lower().split())
    if capabilities != {"cap_dac_override", "cap_kill", "cap_net_admin", "cap_sys_admin"}:
        fail(f"QCloud tuning instance has an unreviewed capability set: {unit}")
    families = set(properties["RestrictAddressFamilies"].split())
    if families != {"AF_UNIX", "AF_INET", "AF_INET6", "AF_NETLINK"}:
        fail(f"QCloud tuning instance has unreviewed address families: {unit}")


def assert_effective_instances(root: pathlib.Path, state_dir: pathlib.Path | None) -> None:
    interfaces = rooted(root, "/sys/class/net")
    try:
        names = sorted(item.name for item in interfaces.iterdir())
    except OSError as error:
        fail(f"network interface inventory is unavailable: {error}")
    for name in names:
        if INTERFACE_PATTERN.fullmatch(name):
            assert_effective_instance(root, state_dir, name)


def assert_mask(root: pathlib.Path) -> None:
    mask = rooted(root, "/etc/systemd/system/rc-local.service")
    try:
        metadata = os.lstat(mask)
    except OSError as error:
        fail(f"rc-local mask is unavailable: {error}")
    if not stat.S_ISLNK(metadata.st_mode) or os.readlink(mask) != "/dev/null":
        fail("rc-local does not have the exact local /dev/null mask")


def assert_no_alternate_execution(root: pathlib.Path) -> None:
    assert_mask(root)
    seen: set[str] = set()
    allowed_vendor_rc_unit = "/usr/lib/systemd/system/rc-local.service"
    for search_root in SCHEDULE_SEARCH_ROOTS:
        for logical, path in iter_tree_files(root, search_root):
            if logical in seen:
                continue
            seen.add(logical)
            value = read_control_file(path, logical)
            for line in active_lines(value):
                if QCLOUD_REFERENCE.search(line):
                    fail(f"alternate root control directly references QCloud vendor code: {logical}")
                if logical != allowed_vendor_rc_unit and RC_LOCAL_REFERENCE.search(line):
                    fail(f"alternate root control can execute the inert rc.local file: {logical}")


def assert_udev_dispatch(root: pathlib.Path) -> None:
    references: list[str] = []
    for search_root in UDEV_SEARCH_ROOTS:
        for logical, path in iter_tree_files(root, search_root):
            value = read_control_file(path, logical)
            for line in active_lines(value):
                if QCLOUD_REFERENCE.search(line):
                    fail(f"udev directly references QCloud vendor code: {logical}")
                if APPROVED_UDEV_WANT in line:
                    references.append(logical)
    if references != [APPROVED_UDEV_RULE]:
        fail("udev does not contain exactly one reviewed QCloud systemd dispatch")


def host_state_command(root: pathlib.Path, state_dir: pathlib.Path | None) -> None:
    if root == pathlib.Path("/"):
        if os.geteuid() != 0:
            fail("QCloud host-state verification must run as root")
        if state_dir is not None:
            fail("fixture systemd state is forbidden for the production root")
    elif state_dir is None:
        fail("a fixture systemd state directory is required with a fixture root")
    assert_no_instance_artifacts(root)
    assert_effective_instances(root, state_dir)
    assert_udev_dispatch(root)
    assert_no_alternate_execution(root)
    print("QCloud/rc-local effective execution paths are exact.")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=True)
    subparsers = parser.add_subparsers(dest="command", required=True)
    vendor = subparsers.add_parser("vendor")
    vendor.add_argument("interface", nargs="?")
    vendor.add_argument("--verify-only", action="store_true")
    vendor.add_argument("--fixture-root")
    host = subparsers.add_parser("host-state")
    host.add_argument("--fixture-root")
    host.add_argument("--systemctl-state-dir")
    return parser.parse_args()


def main() -> None:
    if not hasattr(os, "O_NOFOLLOW"):
        fail("no-follow descriptor operations are unavailable")
    arguments = parse_arguments()
    root = normalized_root(arguments.fixture_root or "/")
    if arguments.command == "vendor":
        if arguments.verify_only == (arguments.interface is not None):
            fail("vendor mode requires exactly one interface or --verify-only")
        vendor_command(root, "--verify-only" if arguments.verify_only else arguments.interface)
        return
    state_dir = pathlib.Path(arguments.systemctl_state_dir) if arguments.systemctl_state_dir else None
    if state_dir is not None:
        state_dir = normalized_root(str(state_dir))
    host_state_command(root, state_dir)


if __name__ == "__main__":
    try:
        main()
    except (ControlError, OSError, subprocess.SubprocessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1) from None
