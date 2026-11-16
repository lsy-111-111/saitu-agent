import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const directory = path.join(process.cwd(), "tests/fixtures/v7-public-diagnostics");
const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8")) as {
  files: { sourcePath: string; fixturePath: string; bytes: number; sha256: string }[];
};

/** Public development receipts are copied verbatim into the reviewed source
 * closure. Tests must also work without the mutable workspace artifacts tree. */
export function readPublicDiagnosticFixture(originalArtifactRelativePath: string) {
  const entries = manifest.files.filter(row => row.sourcePath === originalArtifactRelativePath);
  if (entries.length !== 1) throw new Error("unknown_public_diagnostic_fixture");
  const row = entries[0];
  const filename = path.resolve(directory, row.fixturePath);
  if (!filename.startsWith(directory + path.sep)) throw new Error("invalid_public_diagnostic_fixture_path");
  const bytes = readFileSync(filename);
  if (bytes.byteLength !== row.bytes || createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
    throw new Error("public_diagnostic_fixture_changed");
  }
  return JSON.parse(bytes.toString("utf8"));
}
