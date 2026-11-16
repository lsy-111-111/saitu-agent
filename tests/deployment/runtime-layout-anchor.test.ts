import { constants } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Source-command-driven POSIX simulation. This does not chmod/chown the host,
// execute the installer, create an account, install a key, or launch PM2/AI.
type Actor = { uid: number; gid: number; groups: number[] };
type Entry = { uid: number; gid: number; mode: number; kind: "file" | "dir" | "link"; data: Buffer; ino: number; nlink: number };
const root = process.cwd();
const directory = "/etc/resume-ai";
const release = "/opt/resume-ai/releases/20261109T000000Z";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const actors: Record<string, Actor> = {
  root: { uid: 0, gid: 0, groups: [0] },
  runtime: { uid: 1001, gid: 1001, groups: [1001] },
  build: { uid: 1002, gid: 1002, groups: [1002] },
  verifier: { uid: 1003, gid: 1003, groups: [1003] },
  unrelated: { uid: 1004, gid: 1004, groups: [1004] }
};

class PosixModel {
  entries = new Map<string, Entry>();
  actor = actors.root;
  descriptors = new Map<number, string>();
  nextFd = 10;
  constructor() { this.put("/", "dir", 0, 0, 0o755); this.put("/etc", "dir", 0, 0, 0o755); }
  put(name: string, kind: Entry["kind"], uid: number, gid: number, mode: number, data = Buffer.alloc(0)) {
    if (name !== "/" && !this.entries.has(path.dirname(name))) this.put(path.dirname(name), "dir", 0, 0, 0o755);
    const old = this.entries.get(name);
    this.entries.set(name, { uid, gid, mode, kind, data, ino: old?.ino ?? this.entries.size + 1, nlink: 1 });
  }
  allowed(entry: Entry, bit: number) {
    if (this.actor.uid === 0) return true;
    const shift = entry.uid === this.actor.uid ? 6 : this.actor.groups.includes(entry.gid) ? 3 : 0;
    return ((entry.mode >> shift) & bit) === bit;
  }
  lookup(name: string) {
    for (let parent = path.dirname(name);; parent = path.dirname(parent)) {
      const entry = this.entries.get(parent);
      if (!entry || entry.kind !== "dir" || !this.allowed(entry, 1)) throw new Error("EACCES: parent traversal");
      if (parent === "/") break;
    }
    const entry = this.entries.get(name);
    if (!entry) throw new Error("ENOENT: model path");
    return entry;
  }
  stats(name: string, options?: { bigint?: boolean }) {
    const entry = this.lookup(name);
    const cast = (value: number) => options?.bigint ? BigInt(value) : value;
    return {
      uid: cast(entry.uid), gid: cast(entry.gid), mode: cast(entry.mode | (entry.kind === "dir" ? 0o040000 : entry.kind === "link" ? 0o120000 : 0o100000)),
      dev: cast(1), ino: cast(entry.ino), nlink: cast(entry.nlink), size: cast(entry.data.length), mtimeNs: cast(1), ctimeNs: cast(1),
      isDirectory: () => entry.kind === "dir", isFile: () => entry.kind === "file", isSymbolicLink: () => entry.kind === "link"
    };
  }
  as<T>(name: string, operation: () => T): T {
    const before = this.actor; this.actor = actors[name];
    try { return operation(); } finally { this.actor = before; }
  }
  fs = {
    constants,
    existsSync: (name: string) => { try { this.lookup(name); return true; } catch { return false; } },
    lstatSync: (name: string, options?: { bigint?: boolean }) => this.stats(name, options),
    realpathSync: (name: string) => {
      if (this.lookup(name).kind === "link") throw new Error("linked model path");
      return name;
    },
    openSync: (name: string) => {
      const entry = this.lookup(name);
      if (entry.kind !== "file" || !this.allowed(entry, 4)) throw new Error("EACCES: file read");
      const fd = this.nextFd++; this.descriptors.set(fd, name); return fd;
    },
    fstatSync: (fd: number, options?: { bigint?: boolean }) => this.stats(this.descriptors.get(fd)!, options),
    closeSync: (fd: number) => { this.descriptors.delete(fd); },
    readFileSync: (name: string | number, encoding?: string) => {
      const entry = this.lookup(typeof name === "number" ? this.descriptors.get(name)! : name);
      if (entry.kind !== "file" || !this.allowed(entry, 4)) throw new Error("EACCES: file read");
      return encoding ? entry.data.toString("utf8") : Buffer.from(entry.data);
    },
    readdirSync: (name: string) => {
      const entry = this.lookup(name);
      if (entry.kind !== "dir" || !this.allowed(entry, 5)) throw new Error("EACCES: directory listing");
      return [...this.entries.keys()].filter(value => value !== name && path.dirname(value) === name).map(value => path.basename(value));
    },
    readlinkSync: () => { throw new Error("unexpected link read"); }
  };
}

async function inputs() {
  const [installer, contract, ecosystem] = await Promise.all([
    readFile(path.join(root, "ops/bin/install-runtime-layout.sh"), "utf8"),
    readFile(path.join(root, "scripts/lib/release-evidence-v6-contract.mjs"), "utf8"),
    readFile(path.join(root, "ops/pm2/ecosystem.config.cjs"), "utf8")
  ]);
  return { installer, contract, ecosystem };
}

function deliveryReader(source: string, model: PosixModel) {
  const names = source.match(/import \{([^}]+)\} from ['"]node:fs['"];/u)?.[1];
  if (!names) throw new Error("delivery fs import shape changed");
  // Execute the COMPLETE actual consumer module with only its fs import bound
  // to the permission model; all crypto/path code and rootPublicKey stay intact.
  const body = source.replace(/^import [^\n]+;\r?$/gmu, "").replace(/^export /gmu, "");
  return new Function("fsBindings", "crypto", "path", `const {${names}}=fsBindings;const {createHash,verify}=crypto;${body}\nreturn {rootPublicKey};`)(
    model.fs, { createHash, verify }, path
  ) as { rootPublicKey: () => Buffer };
}

function runtimeReader(source: string, model: PosixModel) {
  const semanticModule = { exports: {} as { apps: Array<{ name: string; env: Record<string, string> }> } };
  const requireModel = (name: string) => {
    if (name === "node:fs") return model.fs;
    if (name === "node:path") return path;
    if (name === "node:crypto") return { createHash };
    throw new Error("unexpected runtime import");
  };
  new Function("require", "process", "module", source)(requireModel, {
    env: { APP_RELEASE_DIR: release, APP_PORT: "3000", APP_PROCESS_NAME: "resume-ai-3000" },
    getgid: () => model.actor.gid
  }, semanticModule);
  return semanticModule.exports;
}

function world(installer: string, adoption: boolean) {
  const model = new PosixModel();
  const keypair = generateKeyPairSync("ed25519");
  const privateBytes = Buffer.from(keypair.privateKey.export({ type: "pkcs8", format: "pem" }));
  const publicBytes = Buffer.from(keypair.publicKey.export({ type: "spki", format: "pem" }));
  if (adoption) {
    model.put(directory, "dir", 0, actors.runtime.gid, 0o750);
    model.put(directory + "/release-evidence-signing.key", "file", 0, 0, 0o600, privateBytes);
    model.put(directory + "/release-evidence-signing.pub", "file", 0, 0, 0o644, publicBytes);
  }
  const directoryCommands = [...installer.matchAll(/^install -d -o (\S+) -g (\S+) -m ([0-7]{4}) \/etc\/resume-ai$/gmu)];
  if (directoryCommands.length !== 2) throw new Error("both installer parent phases must be modeled");
  for (const match of directoryCommands) {
    const uid = match[1] === "root" ? 0 : -1;
    const gid = match[2] === "root" ? 0 : match[2] === "resume-ai" ? actors.runtime.gid : -1;
    if (uid < 0 || gid < 0) throw new Error("unknown installer identity");
    model.put(directory, "dir", uid, gid, Number.parseInt(match[3], 8));
  }
  // The real shared orphan gate runs before both fresh and adoption branches.
  const cleanup = installer.slice(installer.indexOf("cleanup_orphaned_release_evidence_key_temps() {"), installer.indexOf("trap cleanup_release_evidence_key_temps EXIT"));
  const defaultGroup = cleanup.match(/directory_group=\$\{3:-([^}]+)\}/u)?.[1];
  const cleanupMode = cleanup.match(/\$directory_user:\$directory_group:([0-7]+)"/u)?.[1];
  const expectedGid = defaultGroup === "root" ? 0 : defaultGroup === "resume-ai" ? actors.runtime.gid : -1;
  const parent = model.entries.get(directory)!;
  if (!cleanupMode || parent.uid !== 0 || parent.gid !== expectedGid || parent.mode !== Number.parseInt(cleanupMode, 8)) throw new Error("installer orphan gate rejects its own parent");
  const privateMode = installer.match(/"\$EVIDENCE_SIGNING_PRIVATE_KEY" (0[0-7]{3})/u)?.[1];
  const publicMode = installer.match(/"\$EVIDENCE_SIGNING_PUBLIC_KEY" (0[0-7]{3})/u)?.[1];
  if (privateMode !== "0600" || publicMode !== "0644" || !installer.includes('"root:root:$mode:1"')) throw new Error("key artifact ownership contract relaxed");
  if (!adoption) {
    model.put(directory + "/release-evidence-signing.key", "file", 0, 0, Number.parseInt(privateMode, 8), privateBytes);
    model.put(directory + "/release-evidence-signing.pub", "file", 0, 0, Number.parseInt(publicMode, 8), publicBytes);
  }
  if (!installer.includes('install -o root -g resume-ai -m 0640 "$OPS_DIR/config/app.env.example" /etc/resume-ai/app.env') || !installer.includes('/etc/resume-ai/quota.env root resume-ai 0640')) throw new Error("runtime file ownership contract changed");
  const app = ["AI_PROVIDER=deepseek", "FEATURE_AI=false", "FEATURE_COMPETITION_RECOMMENDER=false", "DATABASE_URL=postgresql://synthetic/not_connected", "AI_REASONING_EFFORT=high", "AI_SPEND_POLICY_SHA256=" + "a".repeat(64), "AI_SPEND_RUN_ID=saitu-v7-20261109-formal-99", "AI_SPEND_PHASE=formal", "AI_SPEND_AUTHORIZED_EFFORT=high", "AI_SPEND_HIGH_CONDITION_SHA256=" + "b".repeat(64)].join("\n");
  const quota = ["AI_REQUEST_DEADLINE_MS=45000", "AI_PRODUCER_DEADLINE_MS=50000", "IDEMPOTENCY_FINALIZE_DEADLINE_MS=60000", "IDEMPOTENCY_DUPLICATE_WAIT_MS=62000", "APP_RESPONSE_DEADLINE_MS=65000"].join("\n");
  model.put(directory + "/app.env", "file", 0, actors.runtime.gid, 0o640, Buffer.from(app));
  model.put(directory + "/quota.env", "file", 0, actors.runtime.gid, 0o640, Buffer.from(quota));
  model.put(directory + "/ai-spend-ledger.pg_service.conf", "file", 0, 0, 0o600, Buffer.from("synthetic-only-no-credential"));
  // In-memory build bytes activate the ACTUAL Next+worker PM2 configuration
  // branch. No bundle is executed and the synthetic grant format grants nothing.
  const worker = Buffer.from("synthetic unexecuted worker"), sourceSha256 = "c".repeat(64), nextBuildId = "synthetic-build";
  const binding = Buffer.from(JSON.stringify({ schemaVersion: "saitu.next-worker-binding.v7", sourceSha256, workerArtifactSha256: digest(worker), nextBuildId }));
  model.put(release + "/scripts/competitions/v7/worker-entry.ts", "file", 0, 0, 0o444);
  model.put(release + "/dist/decision-worker/worker.mjs", "file", 0, 0, 0o444, worker);
  model.put(release + "/dist/decision-worker/manifest.json", "file", 0, 0, 0o444, Buffer.from(JSON.stringify({ schemaVersion: "saitu.worker-build.v7", sourceSha256, artifactSha256: digest(worker), nextBindingSha256: digest(binding), nextBuildId, nodeMajor: 24 })));
  model.put(release + "/.next/decision-worker-binding.json", "file", 0, 0, 0o444, binding);
  model.put(release + "/.next/BUILD_ID", "file", 0, 0, 0o444, Buffer.from(nextBuildId));
  model.put(release + "/.next/required-server-files.json", "file", 0, 0, 0o444, Buffer.from(JSON.stringify({ config: { env: { SAITU_V7_SOURCE_SHA256: sourceSha256 } } })));
  return { model, keypair, privateHash: digest(privateBytes), publicHash: digest(publicBytes), directoryCommands };
}

describe("runtime-layout signing anchor permission model", () => {
  it("connects fresh installer parent phases to the actual delivery anchor and Next-worker readers", async () => {
    const source = await inputs(), fixture = world(source.installer, false);
    const key = fixture.model.as("root", () => deliveryReader(source.contract, fixture.model).rootPublicKey());
    const message = Buffer.from("synthetic permission closure");
    expect(verify(null, message, key, sign(null, message, fixture.keypair.privateKey))).toBe(true);
    const apps = fixture.model.as("runtime", () => runtimeReader(source.ecosystem, fixture.model).apps);
    expect(apps.map(app => app.name)).toEqual(["resume-ai-3000", "resume-ai-worker-3000"]);
    expect(apps.every(app => app.env.DATABASE_URL === "postgresql://synthetic/not_connected")).toBe(true);
    expect(fixture.directoryCommands.map(match => [match[1], match[2], match[3]])).toEqual([["root", "root", "0711"], ["root", "root", "0711"]]);
  });

  it("uses the same anchor contract for adopted keys without changing key bytes or file modes", async () => {
    const source = await inputs(), fixture = world(source.installer, true);
    const key = fixture.model.as("root", () => deliveryReader(source.contract, fixture.model).rootPublicKey());
    expect(digest(key)).toBe(fixture.publicHash);
    expect(digest(fixture.model.entries.get(directory + "/release-evidence-signing.key")!.data)).toBe(fixture.privateHash);
    expect(fixture.model.entries.get(directory + "/release-evidence-signing.key")!.mode).toBe(0o600);
    expect(fixture.model.entries.get(directory + "/release-evidence-signing.pub")!.mode).toBe(0o644);
    expect(fixture.model.as("runtime", () => runtimeReader(source.ecosystem, fixture.model).apps)).toHaveLength(2);
    expect(source.installer).toContain("ACK_ADOPT_EXISTING_EVIDENCE_SIGNING_KEY=YES");
    expect(source.installer).toContain("validate_existing_evidence_keypair\n");
  });

  it("permits configuration traversal while denying directory listing and private-key or ledger reads", async () => {
    const source = await inputs();
    for (const adoption of [false, true]) {
      const { model } = world(source.installer, adoption);
      for (const actor of ["runtime", "build", "verifier", "unrelated"]) {
        model.as(actor, () => {
          expect(() => model.fs.readdirSync(directory)).toThrow("EACCES");
          expect(() => model.fs.readFileSync(directory + "/release-evidence-signing.key")).toThrow("EACCES");
          expect(() => model.fs.readFileSync(directory + "/ai-spend-ledger.pg_service.conf")).toThrow("EACCES");
          if (actor === "runtime") expect(runtimeReader(source.ecosystem, model).apps).toHaveLength(2);
          else expect(() => model.fs.readFileSync(directory + "/app.env")).toThrow("EACCES");
        });
      }
    }
  });

  it("keeps the actual consumer and runtime guards rejecting unsafe parent and file metadata", async () => {
    const source = await inputs();
    for (const mutate of [
      (m: PosixModel) => { m.entries.get(directory)!.gid = actors.runtime.gid; },
      (m: PosixModel) => { m.entries.get(directory)!.mode = 0o733; },
      (m: PosixModel) => { m.entries.get(directory + "/release-evidence-signing.pub")!.mode = 0o640; },
      (m: PosixModel) => { m.entries.get(directory + "/release-evidence-signing.pub")!.uid = actors.runtime.uid; },
      (m: PosixModel) => { m.entries.get(directory + "/release-evidence-signing.pub")!.nlink = 2; }
    ]) {
      const { model } = world(source.installer, false); mutate(model);
      expect(() => model.as("root", () => deliveryReader(source.contract, model).rootPublicKey())).toThrow();
    }
    for (const mutate of [
      (m: PosixModel) => { m.entries.get(directory + "/app.env")!.uid = actors.runtime.uid; },
      (m: PosixModel) => { m.entries.get(directory + "/quota.env")!.gid = 0; },
      (m: PosixModel) => { m.entries.get(directory + "/app.env")!.mode = 0o644; },
      (m: PosixModel) => { m.entries.get(directory + "/quota.env")!.nlink = 2; }
    ]) {
      const { model } = world(source.installer, false); mutate(model);
      expect(() => model.as("runtime", () => runtimeReader(source.ecosystem, model))).toThrow();
    }
  });

  it("binds both installer phases and the shared fresh-or-adoption orphan gate to root0711", async () => {
    const source = await inputs();
    expect([...source.installer.matchAll(/^install -d -o root -g root -m 0711 \/etc\/resume-ai$/gmu)]).toHaveLength(2);
    expect(source.installer).not.toContain("install -d -o root -g resume-ai -m 0750 /etc/resume-ai");
    expect(source.installer).toContain("directory_group=${3:-root}");
    expect(source.installer).toContain('"$directory_user:$directory_group:711"');
    for (const command of source.installer.matchAll(/^install -d -o root -g root -m 0711 \/etc\/resume-ai$/gmu)) {
      expect(command.index).toBeLessThan(source.installer.indexOf("cleanup_orphaned_release_evidence_key_temps\n"));
    }
    expect(source.installer.indexOf("cleanup_orphaned_release_evidence_key_temps\n")).toBeLessThan(source.installer.indexOf("private_key_present=0"));
  });
});
