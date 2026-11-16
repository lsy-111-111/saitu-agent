import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyAssetFile, verifyLocalE5Assets } from "../../../scripts/competitions/v6/local-e5.mjs";

test("asset bytes must match the pinned digest and cannot be a symlink", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "saitu-e5-integrity-"));
  try {
    const filename = path.join(root, "model"), bytes = Buffer.from("synthetic model bytes");
    const hash = createHash("sha256").update(bytes).digest("hex");
    await writeFile(filename, bytes);
    assert.deepEqual(await verifyAssetFile(filename, hash), { sha256: hash, bytes: bytes.length });
    await writeFile(filename, "changed");
    await assert.rejects(verifyAssetFile(filename, hash), /hash_mismatch/);
    await symlink(filename, path.join(root, "link"));
    await assert.rejects(verifyAssetFile(path.join(root, "link"), hash), /regular_file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an absent cache is rejected without downloading or trusting a local manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "saitu-e5-missing-"));
  try {
    await writeFile(path.join(root, "download-manifest.json"), JSON.stringify({ verified: true }));
    await assert.rejects(verifyLocalE5Assets(root), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
