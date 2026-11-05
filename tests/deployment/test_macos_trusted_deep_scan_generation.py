"""Focused tests for the local macOS trusted Deep Scan generation boundary."""

from __future__ import annotations

import ast
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[2]
CREATOR_PATH = ROOT / "scripts/lib/macos_trusted_deep_scan_generation.py"
CLEANUP_PATH = ROOT / "scripts/lib/macos_cleanup_trusted_deep_scan_generation.py"


def _load(name: str, filename: pathlib.Path):
    specification = importlib.util.spec_from_file_location(name, filename)
    if specification is None or specification.loader is None:
        raise RuntimeError("cannot load test subject")
    module = importlib.util.module_from_spec(specification)
    sys.modules[name] = module
    specification.loader.exec_module(module)
    return module


creator = _load("trusted_deep_scan_creator", CREATOR_PATH)
cleanup = _load("trusted_deep_scan_cleanup", CLEANUP_PATH)


def _digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _write_manifest(filename: pathlib.Path, members):
    lines = []
    for relative, kind, payload in sorted(members, key=lambda item: item[0].encode("utf-8")):
        lines.append("%s\t%s\t%s\n" % (_digest(payload), kind, relative))
    filename.write_bytes("".join(lines).encode("utf-8"))


class TrustedMacGenerationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="resume-ai-macos-boundary-")
        # macOS exposes /var as a symlink to /private/var; the boundary
        # deliberately rejects symlink ancestors, so tests use the physical path.
        self.root = pathlib.Path(self.temporary.name).resolve()
        self.source = self.root / "source"
        self.source.mkdir(mode=0o755)
        os.chmod(self.source, 0o755)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o755)
        os.chmod(self.state, 0o755)
        self.generations = self.state / "application/deep-scan-generations"
        self.manifest = self.root / "source-manifest.txt"
        self.owner_uid = os.getuid()
        self.owner_gid = os.getgid()
        self.scanner = {
            "uid": max(1, self.owner_uid),
            "gid": max(1, self.owner_gid),
            "name": "boundary-test-scanner",
        }
        self.helper = {
            "installedPath": creator.TRUSTED_INSTALL_PATH,
            "sha256": _digest(CREATOR_PATH.read_bytes()),
            "mode": "0444",
            "device": "test",
            "inode": "test",
        }
        self.now = datetime.datetime(2026, 8, 27, 1, 2, 3, tzinfo=datetime.timezone.utc)

    def tearDown(self):
        self.temporary.cleanup()

    def _create(self):
        return creator.create_generation(
            str(self.source),
            str(self.manifest),
            self.scanner,
            generations_root=str(self.generations),
            owner_uid=self.owner_uid,
            owner_gid=self.owner_gid,
            helper_identity=self.helper,
            now=self.now,
        )

    def _ordinary_fixture(self):
        alpha = b"reviewed source\n"
        tool = b"#!/bin/sh\nexit 99\n"
        (self.source / "alpha.txt").write_bytes(alpha)
        os.chmod(self.source / "alpha.txt", 0o644)
        (self.source / "bin").mkdir(mode=0o755)
        os.chmod(self.source / "bin", 0o755)
        (self.source / "bin/tool.sh").write_bytes(tool)
        os.chmod(self.source / "bin/tool.sh", 0o755)
        os.symlink("tool.sh", self.source / "bin/tool-link")
        _write_manifest(
            self.manifest,
            [
                ("alpha.txt", "F", alpha),
                ("bin/tool-link", "L", b"tool.sh"),
                ("bin/tool.sh", "F", tool),
            ],
        )

    def test_creates_exact_sealed_generation_and_machine_attestation(self):
        self._ordinary_fixture()
        result = self._create()
        generation = pathlib.Path(result["generationRoot"])
        scan_source = pathlib.Path(result["scanSource"])
        attestation_path = pathlib.Path(result["attestation"])
        attestation_bytes = attestation_path.read_bytes()
        attestation = json.loads(attestation_bytes)

        self.assertEqual(_digest(attestation_bytes), result["attestationSha256"])
        self.assertEqual(stat.S_IMODE(generation.stat().st_mode), 0o555)
        self.assertEqual(stat.S_IMODE(scan_source.stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE((scan_source / "alpha.txt").stat().st_mode), 0o644)
        self.assertEqual(stat.S_IMODE((scan_source / "bin/tool.sh").stat().st_mode), 0o755)
        self.assertEqual(os.readlink(scan_source / "bin/tool-link"), "tool.sh")
        self.assertEqual((scan_source / "alpha.txt").read_bytes(), b"reviewed source\n")
        self.assertEqual(set(path.name for path in generation.iterdir()), {"source", "attestation.json"})
        self.assertEqual(attestation["sourceManifest"]["sha256"], _digest(self.manifest.read_bytes()))
        self.assertEqual(attestation["snapshot"]["sourceMemberCount"], 3)
        self.assertRegex(
            attestation["snapshot"]["snapshotDigest"],
            r"^codex-security-snapshot/v1:sha256:[a-f0-9]{64}$",
        )
        self.assertEqual(attestation["producer"]["sha256"], self.helper["sha256"])
        self.assertFalse(attestation["boundary"]["candidateCodeExecuted"])
        self.assertTrue(attestation["boundary"]["atomicNoClobber"])
        self.assertFalse(attestation["boundary"]["extendedAclEntries"])

        control_lock = self.generations / creator._CONTROL_LOCK_NAME
        control_lock_metadata = control_lock.stat()
        self.assertTrue(control_lock.is_file())
        self.assertEqual(control_lock_metadata.st_nlink, 1)
        self.assertEqual(stat.S_IMODE(control_lock_metadata.st_mode), 0o444)

        for path in [generation, scan_source, scan_source / "bin"]:
            metadata = path.stat()
            self.assertEqual((metadata.st_uid, metadata.st_gid), (self.owner_uid, self.owner_gid))
            self.assertEqual(stat.S_IMODE(metadata.st_mode) & 0o022, 0)
            self.assertEqual(stat.S_IMODE(metadata.st_mode) & 0o005, 0o005)
            descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                self.assertEqual(creator._acl_text(descriptor), b"")
            finally:
                os.close(descriptor)
        for path in [scan_source / "alpha.txt", scan_source / "bin/tool.sh", attestation_path]:
            metadata = path.stat()
            self.assertEqual((metadata.st_uid, metadata.st_gid), (self.owner_uid, self.owner_gid))
            self.assertEqual(stat.S_IMODE(metadata.st_mode) & 0o022, 0)
            self.assertNotEqual(stat.S_IMODE(metadata.st_mode) & 0o004, 0)
            descriptor = os.open(path, os.O_RDONLY)
            try:
                self.assertEqual(creator._acl_text(descriptor), b"")
            finally:
                os.close(descriptor)

    def test_never_executes_manifest_member_and_rejects_symlink_escape(self):
        marker = self.root / "candidate-executed"
        payload = ("from pathlib import Path\nPath(%r).write_text('bad')\n" % str(marker)).encode()
        (self.source / "payload.py").write_bytes(payload)
        os.chmod(self.source / "payload.py", 0o644)
        _write_manifest(self.manifest, [("payload.py", "F", payload)])
        result = self._create()
        self.assertFalse(marker.exists())
        self.assertEqual(pathlib.Path(result["scanSource"], "payload.py").read_bytes(), payload)

        other_source = self.root / "escape-source"
        other_source.mkdir(mode=0o755)
        os.chmod(other_source, 0o755)
        os.symlink("../outside", other_source / "escape")
        escape_manifest = self.root / "escape-manifest.txt"
        _write_manifest(escape_manifest, [("escape", "L", b"../outside")])
        with self.assertRaisesRegex(creator.BoundaryError, "escapes"):
            creator.create_generation(
                str(other_source),
                str(escape_manifest),
                self.scanner,
                generations_root=str(self.generations),
                owner_uid=self.owner_uid,
                owner_gid=self.owner_gid,
                helper_identity=self.helper,
                now=self.now,
            )
        self.assertFalse(any(path.name.startswith(".staging-") for path in self.generations.iterdir()))

    def test_rejects_symlink_ancestor_manifest_mismatch_and_unreadable_mode(self):
        outside = self.root / "outside"
        outside.mkdir(mode=0o755)
        os.chmod(outside, 0o755)
        (outside / "secret.txt").write_bytes(b"outside\n")
        os.chmod(outside / "secret.txt", 0o644)
        os.symlink(str(outside), self.source / "linked")
        _write_manifest(self.manifest, [("linked/secret.txt", "F", b"outside\n")])
        with self.assertRaises(OSError):
            self._create()

        direct_source = self.root / "direct-source"
        direct_source.mkdir(mode=0o755)
        os.chmod(direct_source, 0o755)
        (direct_source / "private.txt").write_bytes(b"private\n")
        os.chmod(direct_source / "private.txt", 0o600)
        private_manifest = self.root / "private-manifest.txt"
        _write_manifest(private_manifest, [("private.txt", "F", b"private\n")])
        with self.assertRaisesRegex(creator.BoundaryError, "not scanner-readable"):
            creator.create_generation(
                str(direct_source),
                str(private_manifest),
                self.scanner,
                generations_root=str(self.generations),
                owner_uid=self.owner_uid,
                owner_gid=self.owner_gid,
                helper_identity=self.helper,
                now=self.now,
            )

        (direct_source / "private.txt").write_bytes(b"changed\n")
        os.chmod(direct_source / "private.txt", 0o644)
        with self.assertRaisesRegex(creator.BoundaryError, "differs from its manifest"):
            creator.create_generation(
                str(direct_source),
                str(private_manifest),
                self.scanner,
                generations_root=str(self.generations),
                owner_uid=self.owner_uid,
                owner_gid=self.owner_gid,
                helper_identity=self.helper,
                now=self.now,
            )
        self.assertFalse(any(path.name.startswith(".staging-") for path in self.generations.iterdir()))

    def test_clears_inherited_acl_and_publishes_without_clobber(self):
        if sys.platform != "darwin":
            self.skipTest("macOS extended ACL and renameatx_np test")
        subprocess.run(
            [
                "/bin/chmod",
                "+a",
                "everyone allow write,delete,file_inherit,directory_inherit",
                str(self.state),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        payload = b"acl boundary\n"
        (self.source / "member.txt").write_bytes(payload)
        os.chmod(self.source / "member.txt", 0o644)
        _write_manifest(self.manifest, [("member.txt", "F", payload)])
        result = self._create()
        destination = pathlib.Path(result["scanSource"], "member.txt")
        descriptor = os.open(destination, os.O_RDONLY)
        try:
            self.assertEqual(creator._acl_text(descriptor), b"")
        finally:
            os.close(descriptor)

        second_state = self.root / "second-state"
        second_state.mkdir(mode=0o755)
        os.chmod(second_state, 0o755)
        second_root = second_state / "application/deep-scan-generations"
        second_root.mkdir(parents=True, mode=0o755)
        os.chmod(second_root.parent, 0o755)
        os.chmod(second_root, 0o755)
        expected_id = "ds-20260827T010203Z-aaaaaaaaaaaaaaaa"
        occupied = second_root / expected_id
        occupied.mkdir(mode=0o755)
        occupied_inode = occupied.stat().st_ino
        with mock.patch.object(
            creator.secrets,
            "token_hex",
            side_effect=["a" * 16, "b" * 32],
        ):
            with self.assertRaisesRegex(creator.BoundaryError, "identifier collision"):
                creator.create_generation(
                    str(self.source),
                    str(self.manifest),
                    self.scanner,
                    generations_root=str(second_root),
                    owner_uid=self.owner_uid,
                    owner_gid=self.owner_gid,
                    helper_identity=self.helper,
                    now=self.now,
                )
        self.assertEqual(occupied.stat().st_ino, occupied_inode)
        self.assertEqual(list(occupied.iterdir()), [])
        self.assertFalse(any(path.name.startswith(".staging-") for path in second_root.iterdir()))

    def test_serializes_generation_lifecycle_and_recovers_only_strict_staging(self):
        self._ordinary_fixture()
        self.generations.mkdir(parents=True, mode=0o755)
        os.chmod(self.generations, 0o755)
        base_fd = os.open(
            self.generations,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
        )
        first_lock = creator._acquire_control_lock(
            base_fd, self.owner_uid, self.owner_gid
        )
        started = threading.Event()
        acquired = threading.Event()
        second_descriptor = []

        def acquire_second_lock():
            second_base = os.open(
                self.generations,
                os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
            )
            try:
                started.set()
                descriptor = creator._acquire_control_lock(
                    second_base, self.owner_uid, self.owner_gid
                )
                second_descriptor.append(descriptor)
                acquired.set()
            finally:
                os.close(second_base)

        waiter = threading.Thread(target=acquire_second_lock, daemon=True)
        waiter.start()
        self.assertTrue(started.wait(timeout=2))
        time.sleep(0.1)
        self.assertFalse(acquired.is_set())
        os.close(first_lock)
        self.assertTrue(acquired.wait(timeout=2))
        os.close(second_descriptor.pop())
        waiter.join(timeout=2)
        os.close(base_fd)

        stale = self.generations / (".staging-" + "a" * 32)
        (stale / "source").mkdir(parents=True, mode=0o700)
        os.chmod(stale, 0o700)
        os.chmod(stale / "source", 0o700)
        (stale / "source/partial.txt").write_bytes(b"partial\n")
        os.chmod(stale / "source/partial.txt", 0o600)
        self._create()
        self.assertFalse(stale.exists())

        malformed = self.generations / ".staging-not-a-generation"
        malformed.mkdir(mode=0o700)
        os.chmod(malformed, 0o700)
        with self.assertRaisesRegex(creator.BoundaryError, "malformed staging"):
            self._create()
        malformed.rmdir()

    def test_cleanup_requires_attestation_pin_and_only_removes_exact_generation(self):
        self._ordinary_fixture()
        result = self._create()
        generation = pathlib.Path(result["generationRoot"])
        with self.assertRaisesRegex(cleanup.BoundaryError, "caller pin"):
            cleanup.cleanup_generation(
                result["generationId"],
                "0" * 64,
                generations_root=str(self.generations),
                owner_uid=self.owner_uid,
                owner_gid=self.owner_gid,
                expected_creator_path=creator.TRUSTED_INSTALL_PATH,
            )
        self.assertTrue(generation.is_dir())
        with self.assertRaisesRegex(cleanup.BoundaryError, "generation ID"):
            cleanup.cleanup_generation(
                "../outside",
                result["attestationSha256"],
                generations_root=str(self.generations),
                owner_uid=self.owner_uid,
                owner_gid=self.owner_gid,
                expected_creator_path=creator.TRUSTED_INSTALL_PATH,
            )
        if sys.platform == "darwin":
            protected_file = pathlib.Path(result["scanSource"], "alpha.txt")
            subprocess.run(
                ["/bin/chmod", "+a", "everyone allow write", str(protected_file)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            with self.assertRaisesRegex(cleanup.BoundaryError, "extended ACL"):
                cleanup.cleanup_generation(
                    result["generationId"],
                    result["attestationSha256"],
                    generations_root=str(self.generations),
                    owner_uid=self.owner_uid,
                    owner_gid=self.owner_gid,
                    expected_creator_path=creator.TRUSTED_INSTALL_PATH,
                )
            subprocess.run(
                ["/bin/chmod", "-N", str(protected_file)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        removed = cleanup.cleanup_generation(
            result["generationId"],
            result["attestationSha256"],
            generations_root=str(self.generations),
            owner_uid=self.owner_uid,
            owner_gid=self.owner_gid,
            expected_creator_path=creator.TRUSTED_INSTALL_PATH,
        )
        self.assertTrue(removed["ok"])
        self.assertFalse(generation.exists())
        self.assertFalse(any(path.name.startswith(".deleting-") for path in self.generations.iterdir()))

    def test_cleanup_resumes_an_attestation_bound_tombstone_after_failure(self):
        self._ordinary_fixture()
        result = self._create()
        original_remove = cleanup._remove_tree_at
        with mock.patch.object(
            cleanup,
            "_remove_tree_at",
            side_effect=OSError("simulated power loss after tombstone publish"),
        ):
            with self.assertRaisesRegex(OSError, "simulated power loss"):
                cleanup.cleanup_generation(
                    result["generationId"],
                    result["attestationSha256"],
                    generations_root=str(self.generations),
                    owner_uid=self.owner_uid,
                    owner_gid=self.owner_gid,
                    expected_creator_path=creator.TRUSTED_INSTALL_PATH,
                )
        tombstones = [
            path for path in self.generations.iterdir()
            if path.name.startswith(".deleting-")
        ]
        self.assertEqual(len(tombstones), 1)
        self.assertIn(result["attestationSha256"], tombstones[0].name)
        self.assertIs(cleanup._remove_tree_at, original_remove)

        recovered = cleanup.cleanup_generation(
            result["generationId"],
            result["attestationSha256"],
            generations_root=str(self.generations),
            owner_uid=self.owner_uid,
            owner_gid=self.owner_gid,
            expected_creator_path=creator.TRUSTED_INSTALL_PATH,
        )
        self.assertTrue(recovered["ok"])
        self.assertTrue(recovered["alreadyRemoved"])
        self.assertTrue(recovered["recoveredAfterCrash"])
        self.assertFalse(tombstones[0].exists())

        repeated = cleanup.cleanup_generation(
            result["generationId"],
            result["attestationSha256"],
            generations_root=str(self.generations),
            owner_uid=self.owner_uid,
            owner_gid=self.owner_gid,
            expected_creator_path=creator.TRUSTED_INSTALL_PATH,
        )
        self.assertTrue(repeated["ok"])
        self.assertTrue(repeated["alreadyRemoved"])
        self.assertFalse(repeated["recoveredAfterCrash"])

        malformed = self.generations / ".deleting-not-a-generation"
        malformed.mkdir(mode=0o700)
        os.chmod(malformed, 0o700)
        with self.assertRaisesRegex(cleanup.BoundaryError, "malformed cleanup tombstone"):
            cleanup.cleanup_generation(
                result["generationId"],
                result["attestationSha256"],
                generations_root=str(self.generations),
                owner_uid=self.owner_uid,
                owner_gid=self.owner_gid,
                expected_creator_path=creator.TRUSTED_INSTALL_PATH,
            )
        malformed.rmdir()

    def test_fixed_cli_refuses_source_execution_and_has_no_candidate_process_sink(self):
        result = subprocess.run(
            [
                "/usr/bin/python3",
                "-I",
                "-S",
                str(CREATOR_PATH),
                "--source-root",
                str(self.source),
                "--source-manifest",
                str(self.manifest),
                "--scanner-uid",
                str(max(1, os.getuid())),
            ],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertRegex(result.stderr, r"UID/GID 0|fixed installed path")

        for filename in (CREATOR_PATH, CLEANUP_PATH):
            tree = ast.parse(filename.read_text("utf-8"), filename=str(filename))
            imported = {
                alias.name.split(".")[0]
                for node in ast.walk(tree)
                if isinstance(node, (ast.Import, ast.ImportFrom))
                for alias in node.names
            }
            self.assertNotIn("subprocess", imported)
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                if isinstance(node.func, ast.Name):
                    self.assertNotIn(node.func.id, {"eval", "exec", "compile", "__import__"})
                if isinstance(node.func, ast.Attribute):
                    self.assertNotIn(node.func.attr, {"system", "popen", "spawn", "execv", "execve"})
        self.assertIn("/Library/PrivilegedHelperTools/", creator.TRUSTED_INSTALL_PATH)
        self.assertEqual(creator.GENERATIONS_ROOT, cleanup.GENERATIONS_ROOT)


if __name__ == "__main__":
    unittest.main(verbosity=2)
