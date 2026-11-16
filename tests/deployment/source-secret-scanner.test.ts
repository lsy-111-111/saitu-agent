import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const root = process.cwd();
const scanner = path.join(root, "ops/bin/scan-release-secrets.sh");
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
// Exact public source-line identities; no fixture secrets are duplicated here.
const approvedCases = [
  {
    "id": "approved-source-01",
    "path": "ops/bin/install-runtime-layout.sh",
    "ruleCategory": "private_material",
    "assignmentLine": 1192,
    "tokenOffsetInLine": 54,
    "tokenBytes": 27,
    "tokenSha256": "3021d90eb9437b2d8f30e8363695c4418b5e5f1870801b5c317e9398ee0f572d",
    "lineSha256": "8356256256fdf91f9ea1b8f00ca5cb55956b03e4a6120b3e2f6845dee1c41feb",
    "classification": "code_header_format_assertion"
  },
  {
    "id": "approved-source-02",
    "path": "ops/bin/install-runtime-layout.sh",
    "ruleCategory": "private_material",
    "assignmentLine": 1240,
    "tokenOffsetInLine": 46,
    "tokenBytes": 27,
    "tokenSha256": "3021d90eb9437b2d8f30e8363695c4418b5e5f1870801b5c317e9398ee0f572d",
    "lineSha256": "41b59e83045fa5cad756f1a82cda7bcce59f51ddac9106d82c19e934288ed63d",
    "classification": "code_header_format_assertion"
  },
  {
    "id": "approved-source-03",
    "path": "ops/bin/install-runtime-layout.sh",
    "ruleCategory": "named_secret",
    "assignmentLine": 1607,
    "tokenOffsetInLine": 17,
    "tokenBytes": 46,
    "tokenSha256": "cdeff5fa18fe97c0bba016cee76bea3b60534e7cd401806b987ed6b622899996",
    "lineSha256": "826dfd53e0590a96c11305498f731dcb45108019c1de0523d12340851645d80b",
    "classification": "shell_command_reference"
  },
  {
    "id": "approved-source-04",
    "path": "ops/config/ai-spend-ledger.pg_service.example.conf",
    "ruleCategory": "named_secret",
    "assignmentLine": 9,
    "tokenOffsetInLine": 9,
    "tokenBytes": 37,
    "tokenSha256": "f7c0e70cedaab0deeb8acca6c76e7d7c70a27176bc715c97130c5eef797fbea0",
    "lineSha256": "4f6e256aa11380b8b5a2692f7f1fec4b8ef44cfcea586a229110eaa239bece5d",
    "classification": "explicit_provisioning_placeholder"
  },
  {
    "id": "approved-source-05",
    "path": "tests/competitions/v6/sealed-execution-artifacts.test.mjs",
    "ruleCategory": "postgres_credential",
    "assignmentLine": 25,
    "tokenOffsetInLine": 76,
    "tokenBytes": 9,
    "tokenSha256": "edf696994b298f535bc4919f5bc31dfac4487db8bbeaedbba09f5b0a52c34a69",
    "lineSha256": "aaf07d5ca51060179a39cc200c00546ee605c8d4df210788dbb22ae4dc11020c",
    "classification": "synthetic_javascript_url_template"
  },
  {
    "id": "approved-source-06",
    "path": "tests/competitions/v7/backend-review.integration.test.ts",
    "ruleCategory": "named_secret",
    "assignmentLine": 52,
    "tokenOffsetInLine": 39,
    "tokenBytes": 46,
    "tokenSha256": "b0c698f805ccd5f7da5ad9f752d1c6adb6bf1fa2146b472a4f8b74604d984172",
    "lineSha256": "e4af866054699367756435c65408ee99a6de0703d370aba7063f5687ad8a7dd4",
    "classification": "fixed_synthetic_test_literal"
  },
  {
    "id": "approved-source-07",
    "path": "tests/deployment/runtime-layout-bootstrap.test.ts",
    "ruleCategory": "private_material",
    "assignmentLine": 321,
    "tokenOffsetInLine": 30,
    "tokenBytes": 27,
    "tokenSha256": "3021d90eb9437b2d8f30e8363695c4418b5e5f1870801b5c317e9398ee0f572d",
    "lineSha256": "368d300b996c5d7cd70de8f6ba28a54f2d32065ad4e9037592141a20e17006d7",
    "classification": "code_header_format_assertion"
  },
  {
    "id": "approved-source-08",
    "path": "tests/e2e/fixtures/v7-backend-server.mjs",
    "ruleCategory": "named_secret",
    "assignmentLine": 17,
    "tokenOffsetInLine": 35,
    "tokenBytes": 49,
    "tokenSha256": "2fd34319ebc1865842b4c5d639d4023ab36354ee0d7423073881aed7ba8dc310",
    "lineSha256": "3b3bec10783aca4ecdb5bf268636be531cf4e8fd9663e88c4891ae815bf7d7a7",
    "classification": "fixed_synthetic_test_literal"
  },
  {
    "id": "approved-source-09",
    "path": "tests/helpers/v7-production-environment.mjs",
    "ruleCategory": "named_secret",
    "assignmentLine": 10,
    "tokenOffsetInLine": 22,
    "tokenBytes": 45,
    "tokenSha256": "7bc003b6c5bdcb0a1040f12ca9f9ff15860e7b057f6863c6eca73504bc0ed1dc",
    "lineSha256": "1c2d8b3eaf51284cb9497425c7d5b71a80f7689b78e535f7ad6605e04a8d47ef",
    "classification": "fixed_synthetic_test_literal"
  },
  {
    "id": "approved-source-10",
    "path": "tests/helpers/v7-production-environment.mjs",
    "ruleCategory": "named_secret",
    "assignmentLine": 11,
    "tokenOffsetInLine": 37,
    "tokenBytes": 47,
    "tokenSha256": "d81609ce154678e8d85aa2f5657bb6697328fd4d5000249bd8481bcc13a0987f",
    "lineSha256": "37ee7f789e36b8992d784fa95edc29fd112b96fb0f7f1946a8ac243da24833ff",
    "classification": "fixed_synthetic_test_literal"
  },
  {
    "id": "approved-source-11",
    "path": "tests/helpers/v7-production-environment.mjs",
    "ruleCategory": "named_secret",
    "assignmentLine": 12,
    "tokenOffsetInLine": 22,
    "tokenBytes": 48,
    "tokenSha256": "926bdd4bf445ce979dbba80f99650a6bd281e621abed14ffec9d2686df559389",
    "lineSha256": "8d0a1cabdec3102c4a46cc10bf9a96df8fd78a76e824b1c307210caa3b15d288",
    "classification": "fixed_synthetic_test_literal"
  },
  {
    "id": "approved-source-12",
    "path": "tests/security/competition-shared-state-postgres.integration.test.ts",
    "ruleCategory": "named_secret",
    "assignmentLine": 334,
    "tokenOffsetInLine": 36,
    "tokenBytes": 25,
    "tokenSha256": "a2b0c93069bd4c04aa2a7200899034737680b57e7f3d8aab16398142963f932b",
    "lineSha256": "c4a410575d66ed6c5cce3073d3bc9f9982dbf323704f9c7f7f4504122e8fb8b6",
    "classification": "code_identifier_reference"
  },
  {
    "id": "approved-source-13",
    "path": "tests/security/competition-shared-state-postgres.integration.test.ts",
    "ruleCategory": "named_secret",
    "assignmentLine": 335,
    "tokenOffsetInLine": 21,
    "tokenBytes": 23,
    "tokenSha256": "8597469e881a04d2b46d0903e53f4f81630e4d959bdc04891a506f5da5d40dd7",
    "lineSha256": "0b74622a603249816db40571e58e3145432d3067ca1cb4e8911ec0867debab79",
    "classification": "code_identifier_reference"
  },
  {
    "id": "approved-source-14",
    "path": "tests/security/competition-shared-state-postgres.integration.test.ts",
    "ruleCategory": "named_secret",
    "assignmentLine": 336,
    "tokenOffsetInLine": 21,
    "tokenBytes": 26,
    "tokenSha256": "e066bb9a1e09b702907e617718e527a8c942291a8f6044ac21f1b5dc1fdb31e1",
    "lineSha256": "885eb38f63e5584216ffa623f833bd9d65249c008fb9bcf38c4edf7149ebc42f",
    "classification": "code_identifier_reference"
  },
  {
    "id": "approved-source-15",
    "path": "tests/security/competition-shared-state-postgres.integration.test.ts",
    "ruleCategory": "named_secret",
    "assignmentLine": 337,
    "tokenOffsetInLine": 26,
    "tokenBytes": 25,
    "tokenSha256": "235b0a8ac674e705ad022b97f60ed80d02f278a94da6c837e04785c2ad55742e",
    "lineSha256": "e723fc0d67da331c1733731d3d4f5a6552f9555a223ee007d1c1c4c90fc8dfa5",
    "classification": "code_identifier_reference"
  }
] as const;
type ApprovedCase = (typeof approvedCases)[number];
async function scan(filename: string, cwd: string, mode: "--source-tree" | "--full" = "--source-tree") {
  try { await exec("/bin/bash", [scanner, mode, filename], { cwd, maxBuffer: 64000 }); return 0; }
  catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 1) throw new Error("scanner_execution_failed_without_secret_output");
    return code;
  }
}
async function originalLine(row: ApprovedCase) {
  const source = await readFile(path.join(root, row.path), "utf8");
  const line = Buffer.from(source.split("\n")[row.assignmentLine - 1]);
  if (digest(line) !== row.lineSha256 || digest(line.subarray(row.tokenOffsetInLine, row.tokenOffsetInLine + row.tokenBytes)) !== row.tokenSha256)
    throw new Error(`${row.id}: reviewed public source line changed`);
  return line;
}
async function fixture() {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "source-secret-exact-")));
  return { directory, async put(relative: string, bytes: Buffer | string) { const filename = path.join(directory, relative); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes, { mode: 0o600 }); return filename; },
    async close() { await rm(directory, { recursive: true, force: true }); } };
}
function patch(relative: string, line: string, prefix = "+") {
  return `diff --git a/${relative} b/${relative}\n--- a/${relative}\n+++ b/${relative}\n@@ -1 +1 @@\n${prefix}${line}\n`;
}
const privateBlock = () => `${"-".repeat(5)}BEGIN ${"PRIVATE KEY"}${"-".repeat(5)}\n${"A".repeat(64)}\n${"-".repeat(5)}END ${"PRIVATE KEY"}${"-".repeat(5)}\n`;
const dangerousProvider = () => `sk-${"X".repeat(48)}\n`;
const dangerousNamed = () => `AI_API_KEY=${"X".repeat(48)}\n`;
const dangerousPostgres = () => `postgresql://${"unreviewed_user"}:${"X".repeat(32)}@127.0.0.1:5432/unreviewed\n`;

type PrivateKind = "ed25519-pkcs8" | "rsa-pkcs8" | "rsa-pkcs1" | "ec-sec1" | "encrypted-pkcs8";
function temporaryMaterial(kind: PrivateKind) {
  let pair: { privateKey: KeyObject; publicKey: KeyObject };
  let type: "pkcs8" | "pkcs1" | "sec1" = "pkcs8";
  if (kind.startsWith("rsa")) { pair = generateKeyPairSync("rsa", { modulusLength: 2048 }); if (kind === "rsa-pkcs1") type = "pkcs1"; }
  else if (kind === "ec-sec1") { pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" }); type = "sec1"; }
  else pair = generateKeyPairSync("ed25519");
  const encryption = kind === "encrypted-pkcs8" ? { cipher: "aes-256-cbc", passphrase: "ephemeral-scanner-test-only" } : {};
  const pem = pair.privateKey.export({ format: "pem", type, ...encryption }).toString();
  const der = pair.privateKey.export({ format: "der", type, ...encryption });
  const publicDer = pair.publicKey.export({ format: "der", type: "spki" });
  // Validate real local cryptographic material, without ever printing it in an
  // assertion/failure message or retaining it in a report or source fixture.
  try {
    const reconstructed = createPrivateKey({ key: der, format: "der", type, ...(encryption.passphrase ? { passphrase: encryption.passphrase } : {}) });
    if (!createPublicKey(reconstructed).export({ format: "der", type: "spki" }).equals(publicDer)) throw Error("key mismatch");
  } catch { throw Error("ephemeral_private_material_validation_failed"); }
  const lines = pem.trim().split(/\r?\n/);
  return { der, publicDer, pem, body: lines.slice(1, -1).join("\n"), footer: lines.at(-1)! };
}

function mixedFoldedPieces(der: Buffer) {
  const prefix = der.subarray(0, 24).toString("base64");
  const pieces = [prefix.slice(0, 1), prefix.slice(1, 4), prefix.slice(4, 11), prefix.slice(11)];
  for (let at = 24; at < der.length; at += 16) pieces.push(der.subarray(at, at + 16).toString("base64"));
  return pieces;
}

async function rejectsBoth(f: Awaited<ReturnType<typeof fixture>>, relative: string, text: string) {
  const source = await f.put(relative, text);
  expect(await scan(source, f.directory)).toBe(1);
  const artifact = await f.put("candidate.patch", patch(relative, text.trimEnd().split("\n").join("\n+")));
  expect(await scan(artifact, f.directory, "--full")).toBe(1);
}

describe("path/token/code-line bound source scanner exceptions", () => {
  it.each(approvedCases)("$id $classification: exact source/patch only; variants and adjacent secrets still fail", async row => {
    const f = await fixture();
    try {
      const line = await originalLine(row), text = line.toString("utf8"), file = await f.put(row.path, Buffer.concat([Buffer.from("\n"), line, Buffer.from("\n")]));
      expect(await scan(file, f.directory)).toBe(0);
      const artifact = await f.put("candidate.patch", patch(row.path, text));
      expect(await scan(artifact, f.directory, "--full")).toBe(0);
      for (const prefix of [" ", "-"]) {
        await writeFile(artifact, patch(row.path, text, prefix));
        expect(await scan(artifact, f.directory, "--full")).toBe(0);
      }
      const rawLog = await f.put("raw-evidence.log", Buffer.concat([line, Buffer.from("\n")]));
      expect(await scan(rawLog, f.directory, "--full")).toBe(1);
      const wrong = await f.put("unreviewed/copied-source.txt", Buffer.concat([line, Buffer.from("\n")]));
      expect(await scan(wrong, f.directory)).toBe(1);
      await writeFile(artifact, patch("unreviewed/copied-source.txt", text));
      expect(await scan(artifact, f.directory, "--full")).toBe(1);

      let changed: Buffer;
      if (row.ruleCategory === "private_material") changed = Buffer.from(text.replace("PRIVATE KEY", "RSA PRIVATE KEY"));
      else { changed = Buffer.from(line); const at = row.tokenOffsetInLine + row.tokenBytes - 1; changed[at] = changed[at] === 90 ? 89 : 90; }
      await writeFile(file, Buffer.concat([changed, Buffer.from("\n")]));
      expect(await scan(file, f.directory)).toBe(1);
      await writeFile(artifact, patch(row.path, changed.toString("utf8")));
      expect(await scan(artifact, f.directory, "--full")).toBe(1);
      // Exact token bytes in a changed line do not grant the old capability.
      await writeFile(file, Buffer.concat([line, Buffer.from(" \n")]));
      expect(await scan(file, f.directory)).toBe(1);
      await writeFile(file, Buffer.concat([line, Buffer.from("\n"), line, Buffer.from("\n")]));
      expect(await scan(file, f.directory)).toBe(1);
      for (const addition of [dangerousProvider(), dangerousNamed(), dangerousPostgres(), privateBlock()]) {
        await writeFile(file, Buffer.concat([line, Buffer.from("\n" + addition)]));
        expect(await scan(file, f.directory)).toBe(1);
        await writeFile(artifact, patch(row.path, text + "\n" + addition.trimEnd().split("\n").map(x => "+" + x).join("\n")));
        expect(await scan(artifact, f.directory, "--full")).toBe(1);
      }
    } finally { await f.close(); }
  });

  it("passes all eight complete original files without skipping any file", async () => {
    const paths = [...new Set(approvedCases.map(row => row.path))];
    expect(paths).toHaveLength(8);
    await expect(exec("/bin/bash", [scanner, "--source-tree", ...paths], { cwd: root, maxBuffer: 64000 })).resolves.toBeDefined();
  });

  it("recognizes no other source path, raw JSON or binary-looking private payload", async () => {
    const f = await fixture();
    try {
      const row = approvedCases[0], line = (await originalLine(row)).toString("utf8");
      const rawJson = await f.put("raw.json", JSON.stringify({ data: patch(row.path, line) }));
      expect(await scan(rawJson, f.directory, "--full")).toBe(1);
      const material = await f.put(row.path, privateBlock());
      expect(await scan(material, f.directory)).toBe(1);
      const encoded = await f.put("unreviewed.bin", privateBlock());
      expect(await scan(encoded, f.directory, "--full")).toBe(1);
    } finally { await f.close(); }
  });
});

describe("private material cannot borrow an approved public header assertion", () => {
  it.each<PrivateKind>(["ed25519-pkcs8", "rsa-pkcs8", "rsa-pkcs1", "ec-sec1", "encrypted-pkcs8"])("rejects valid ephemeral %s material in source/patch, with or without footer and across representations", async kind => {
    const f = await fixture(), material = temporaryMaterial(kind), row = approvedCases[0];
    try {
      const line = (await originalLine(row)).toString("utf8");
      const plain = material.der.toString("base64"), shortFold = plain.match(/.{1,4}/g)!.join("\n"), oddFold = plain.match(/.{1,17}/g)!.join("\n");
      const separatePieces: string[] = [];
      for (let at = 0; at < material.der.length; at += 16) separatePieces.push(material.der.subarray(at, at + 16).toString("base64"));
      const variants = [
        line + "\n" + material.body + "\n" + material.footer,
        line + "\n" + material.body,
        material.body + "\n" + line,
        line + "\n" + "unrelated-context\n".repeat(20) + material.body,
        line + "\n" + shortFold,
        line + "\n" + oddFold,
        line + "\n" + material.body.replaceAll("\n", "\\n"),
        line + "\n" + material.der.toString("base64url"),
        line + "\n" + material.der.toString("hex"),
        line + "\n" + Array.from(plain).map(x => "\\u00" + x.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
        line + "\n" + Array.from(plain).map(x => "\\x" + x.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
        line + "\n" + separatePieces.map(x => JSON.stringify(x)).join(" +\n"),
        line + "\n" + material.pem,
        line + "\n" + material.footer,
        material.footer + "\n" + line + "\n" + material.body
      ];
      for (const [index, text] of variants.entries()) {
        try { await rejectsBoth(f, row.path, text + "\n"); }
        catch { throw Error(`private_material_boundary_${kind}_variant_${index}`); }
      }
      await rejectsBoth(f, row.path, material.body + "\n");
      const other = await f.put("other/private-body.txt", material.body);
      expect(await scan(other, f.directory)).toBe(1);
      const raw = await f.put("raw-private-body.log", material.body);
      expect(await scan(raw, f.directory, "--full")).toBe(1);
      const rawJson = await f.put("raw-private-body.json", JSON.stringify({ material: material.body }));
      expect(await scan(rawJson, f.directory, "--full")).toBe(1);
      const binary = await f.put("raw-private-body.bin", material.der);
      expect(await scan(binary, f.directory, "--full")).toBe(1);
      const inSource = await f.put(row.path, Buffer.concat([Buffer.from(line + "\n"), material.der]));
      expect(await scan(inSource, f.directory)).toBe(1);
    } finally { material.der.fill(0); await f.close(); }
  }, 15000);

  it("preserves a leading base64 plus when joining lines and scans body-only/context/deleted patch payloads", async () => {
    const f = await fixture(), row = approvedCases[0];
    let material = temporaryMaterial("ed25519-pkcs8");
    try {
      let plain = material.der.toString("base64");
      for (let count = 0; !plain.includes("+") && count < 64; count++) {
        material.der.fill(0); material = temporaryMaterial("ed25519-pkcs8"); plain = material.der.toString("base64");
      }
      if (!plain.includes("+")) throw Error("ephemeral_plus_boundary_sample_unavailable");
      const line = (await originalLine(row)).toString("utf8"), at = plain.indexOf("+"), body = plain.slice(0, at) + "\n" + plain.slice(at);
      await rejectsBoth(f, row.path, line + "\n" + body + "\n");
      await rejectsBoth(f, "other/material.ts", body + "\n");
      for (const prefix of [" ", "-"]) {
        const data = body.trimEnd().split("\n").join("\n" + prefix);
        const artifact = await f.put("candidate.patch", patch(row.path, data, prefix));
        expect(await scan(artifact, f.directory, "--full")).toBe(1);
      }
      const separated = `diff --git a/${row.path} b/${row.path}\n--- a/${row.path}\n+++ b/${row.path}\n@@ -1 +1 @@\n ${line}\n@@ -90,0 +91,2 @@\n+${body.split("\n").join("\n+")}\n`;
      const artifact = await f.put("candidate.patch", separated);
      expect(await scan(artifact, f.directory, "--full")).toBe(1);
    } finally { material.der.fill(0); await f.close(); }
  });

  it("preserves short-fold bootstraps followed by independently padded pieces and later candidate starts", async () => {
    const f = await fixture(), material = temporaryMaterial("ed25519-pkcs8"), row = approvedCases[0];
    try {
      const line = (await originalLine(row)).toString("utf8"), pieces = mixedFoldedPieces(material.der);
      for (const join of ["\n", '" +\n"']) {
        const body = join === "\n" ? pieces.join(join) : '"' + pieces.join(join) + '"';
        await rejectsBoth(f, row.path, line + "\n" + body + "\n");
        await rejectsBoth(f, row.path, line + "\n" + "MCEwDQYJYIZIAWUDBAIBBQAE".repeat(64) + "\n" + body + "\n");
      }
    } finally { material.der.fill(0); await f.close(); }
  });

  it("bounds decoded and scanned byte work for large public folded ASN.1 and repeated candidate starts", async () => {
    // Meter actual helper inputs rather than timing assertions. The vulnerable
    // loop exceeds this linear allowance after repeatedly decoding old prefixes.
    const program = String.raw`
import base64, json, pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
program = source.split("<<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
program = program.split("\nviolations: list[str] = []", 1)[0]
sys.argv = ["scanner", "source-tree"]
scope = {}
exec(compile(program, "scanner-work-meter", "exec"), scope)
original_decode, original_scan, original_header = scope["decode_key_base64"], scope["contains_private_binary"], scope["der_header"]
work = {"decoded": 0, "scanned": 0, "headers": 0, "sliced": 0, "allowance": 0, "headerAllowance": 0}
class MeteredBytes(bytes):
    def __getitem__(self, key):
        value = super().__getitem__(key)
        if isinstance(key, slice):
            work["sliced"] += len(value)
            if work["sliced"] > work["allowance"]:
                raise RuntimeError("private_material_slice_work_exceeds_linear_allowance")
        return value
def decode(value):
    work["decoded"] += len(value)
    if work["decoded"] > work["allowance"]:
        raise RuntimeError("private_material_decode_work_exceeds_linear_allowance")
    return original_decode(value)
def scan(value, **kwargs):
    prefix = kwargs.get("prefix_length")
    work["scanned"] += len(value) if prefix is None else min(len(value), prefix + 16)
    if work["scanned"] > work["allowance"]:
        raise RuntimeError("private_material_scan_work_exceeds_linear_allowance")
    return original_scan(value, **kwargs)
def header(*args, **kwargs):
    work["headers"] += 1
    if work["headers"] > work["headerAllowance"]:
        raise RuntimeError("private_material_header_work_exceeds_linear_allowance")
    return original_header(*args, **kwargs)
scope["decode_key_base64"], scope["contains_private_binary"], scope["der_header"] = decode, scan, header
def head(tag, size):
    width = (size.bit_length() + 7) // 8
    length = bytes([size]) if size < 128 else bytes([0x80 + width]) + size.to_bytes(width, "big")
    return bytes([tag]) + length
def tlv(tag, value):
    return head(tag, len(value)) + value
algorithm = bytes.fromhex("300d06096086480165030402010500")
values = [tlv(0x30, algorithm + tlv(0x04, bytes(size))) for size in (8192, 32768, 131072)]
values.append(tlv(0x30, algorithm + tlv(0x04, bytes(23))) * 4096)
inputs = []
for value in values:
    encoded = base64.b64encode(value)
    inputs.append(b"\n".join(encoded[at:at + 4] for at in range(0, len(encoded), 4)) + b"\n")
# Every apparent BER root skips its opaque primitive value to the same public
# NULL tail. Header/end caches must share this tail across the root candidates.
prefix = b""
for _ in range(1024):
    prefix = b"\x30\x80" + algorithm + tlv(0x04, prefix)
public_ber = prefix + b"\x05\x00" * 1024 + b"\x00\x00"
inputs.append(public_ber)
encoded = base64.b64encode(public_ber)
inputs.append(b"\n".join(encoded[at:at + 4] for at in range(0, len(encoded), 4)) + b"\n")
# Public AlgorithmIdentifier/OCTET STRING objects may overlap inside an OID's
# opaque bytes too. Checking an OID family needs bounded reads, not OID copies.
prefix, tail, octets = b"", bytes(1024), tlv(0x04, bytes(1))
for _ in range(1024):
    oid_head = head(0x06, len(prefix) + len(tail))
    algorithm_head = head(0x30, len(oid_head) + len(prefix) + len(tail))
    prefix = head(0x30, len(algorithm_head) + len(oid_head) + len(prefix) + len(tail) + len(octets)) + algorithm_head + oid_head + prefix
inputs.append(prefix + tail + octets)
inputs.append(b"\\" * 131072 + b"z\n")
results = []
for data in inputs:
    work.update(decoded=0, scanned=0, headers=0, sliced=0, allowance=64 * len(data), headerAllowance=16 * len(data))
    if scope["contains_private_body"](MeteredBytes(data)):
        raise RuntimeError("public_asn1_control_rejected")
    results.append({"inputBytes": len(data), "decodedBytes": work["decoded"], "scannedBytes": work["scanned"], "headerCalls": work["headers"], "slicedBytes": work["sliced"]})
print(json.dumps(results))
`;
    const result = await exec("/usr/bin/python3", ["-I", "-c", program, scanner], { cwd: root, maxBuffer: 64000, timeout: 10000 });
    const rows = JSON.parse(result.stdout) as { inputBytes: number; decodedBytes: number; scannedBytes: number; headerCalls: number; slicedBytes: number }[];
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.decodedBytes).toBeLessThanOrEqual(64 * row.inputBytes);
      expect(row.scannedBytes).toBeLessThanOrEqual(64 * row.inputBytes);
      expect(row.headerCalls).toBeLessThanOrEqual(16 * row.inputBytes);
      expect(row.slicedBytes).toBeLessThanOrEqual(64 * row.inputBytes);
    }
  }, 15000);

  it("rejects recoverable nonminimal and indefinite BER forms rather than relying on canonical DER", async () => {
    const f = await fixture(), material = temporaryMaterial("ed25519-pkcs8"), row = approvedCases[0];
    try {
      const line = (await originalLine(row)).toString("utf8");
      const nonminimal = Buffer.concat([material.der.subarray(0, 1), Buffer.from([0x81, material.der[1]]), material.der.subarray(2)]);
      const indefinite = Buffer.concat([Buffer.from([0x30, 0x80]), material.der.subarray(2), Buffer.from([0, 0])]);
      for (const der of [nonminimal, indefinite]) {
        try {
          const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
          if (!createPublicKey(key).export({ format: "der", type: "spki" }).equals(material.publicDer)) throw Error("mismatch");
        } catch { throw Error("ephemeral_BER_reconstruction_failed"); }
        await rejectsBoth(f, row.path, line + "\n" + der.toString("base64") + "\n");
        await rejectsBoth(f, row.path, line + "\n" + mixedFoldedPieces(der).join("\n") + "\n");
        const raw = await f.put("raw-BER.bin", der); expect(await scan(raw, f.directory, "--full")).toBe(1);
        der.fill(0);
      }
    } finally { material.der.fill(0); await f.close(); }
  });

  it("retains plain header, public SPKI and public DigestInfo compatibility", async () => {
    const f = await fixture(), material = temporaryMaterial("ed25519-pkcs8"), row = approvedCases[0];
    try {
      const line = (await originalLine(row)).toString("utf8");
      const digestInfo = Buffer.concat([Buffer.from("3031300d060960864801650304020105000420", "hex"), createHash("sha256").update("public fixture").digest()]);
      for (const suffix of ["", material.publicDer.toString("base64"), material.publicDer.toString("hex"), digestInfo.toString("base64"), digestInfo.toString("hex")]) {
        const text = line + "\n" + suffix + "\n", source = await f.put(row.path, text);
        expect(await scan(source, f.directory)).toBe(0);
        const artifact = await f.put("candidate.patch", patch(row.path, text.trimEnd().split("\n").join("\n+")));
        expect(await scan(artifact, f.directory, "--full")).toBe(0);
      }
    } finally { material.der.fill(0); await f.close(); }
  });

  it("rejects a complete OpenSSH private envelope while retaining its public wire blob", async () => {
    const f = await fixture(), material = temporaryMaterial("ed25519-pkcs8"), row = approvedCases[0];
    let seed: Buffer | undefined, envelope: Buffer | undefined;
    try {
      const key = createPrivateKey({ key: material.der, type: "pkcs8", format: "der" }).export({ format: "jwk" });
      if (!key.d || !key.x) throw Error("ephemeral_ed25519_parts_unavailable");
      seed = Buffer.from(key.d, "base64url"); const publicBytes = Buffer.from(key.x, "base64url");
      const uint = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; };
      const field = (b: Buffer) => Buffer.concat([uint(b.length), b]);
      const algorithm = Buffer.from("ssh-ed25519"), publicBlob = Buffer.concat([field(algorithm), field(publicBytes)]);
      let secret = Buffer.concat([uint(0x12345678), uint(0x12345678), field(algorithm), field(publicBytes), field(Buffer.concat([seed, publicBytes])), field(Buffer.alloc(0))]);
      const padding = Buffer.from(Array.from({ length: 8 - secret.length % 8 }, (_, n) => n + 1));
      secret = Buffer.concat([secret, padding]);
      envelope = Buffer.concat([Buffer.from("openssh-key-v1\0"), field(Buffer.from("none")), field(Buffer.from("none")), field(Buffer.alloc(0)), uint(1), field(publicBlob), field(secret)]);
      const line = (await originalLine(row)).toString("utf8");
      await rejectsBoth(f, row.path, line + "\n" + envelope.toString("base64") + "\n");
      await rejectsBoth(f, row.path, line + "\n" + mixedFoldedPieces(envelope).join("\n") + "\n");
      const binary = await f.put("private-ssh.bin", envelope); expect(await scan(binary, f.directory, "--full")).toBe(1);
      const publicFile = await f.put("public-ssh.txt", publicBlob.toString("base64")); expect(await scan(publicFile, f.directory)).toBe(0);
      secret.fill(0);
    } finally { seed?.fill(0); envelope?.fill(0); material.der.fill(0); await f.close(); }
  });

  it("rejects private DER recovered from a real Git binary patch literal", async () => {
    const f = await fixture(), material = temporaryMaterial("ed25519-pkcs8");
    try {
      const binary = await f.put("private-material.bin", material.der);
      let data = "";
      try {
        const result = await exec("/usr/bin/git", ["diff", "--binary", "--no-index", "--", "/dev/null", binary], {
          cwd: f.directory, env: { PATH: "/usr/bin:/bin", NODE_ENV: "test", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, maxBuffer: 64000
        });
        data = result.stdout;
      } catch (error) {
        const result = error as { code?: number; stdout?: string | Buffer };
        if (result.code !== 1) throw Error("temporary_binary_diff_failed_without_private_output");
        data = typeof result.stdout === "string" ? result.stdout : result.stdout?.toString("utf8") ?? "";
      }
      if (!data.includes("GIT binary patch")) throw Error("temporary_binary_literal_unavailable");
      const artifact = await f.put("candidate.patch", data);
      expect(await scan(artifact, f.directory, "--full")).toBe(1);
    } finally { material.der.fill(0); await f.close(); }
  });
});
