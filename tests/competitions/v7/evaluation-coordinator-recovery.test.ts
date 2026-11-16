import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import path from "node:path";

const hooks = vi.hoisted(() => ({ beforeRename: null as null | ((source: string, target: string) => Promise<void>) }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: async (source: string, target: string) => { await hooks.beforeRename?.(source, target); return actual.rename(source, target); } };
});
import { acquireCoordinatorLock } from "../../../scripts/competitions/v7/evaluation-executor.mjs";
import { byteHash } from "../../../scripts/competitions/v7/evaluation-policy.mjs";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

describe("v7 stale coordinator recovery", () => {
  it("serializes two recoverers so the second cannot move the first live lock", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "saitu-v7-recovery-race-"));
    const child = spawn(process.execPath, ["-e", ""]); await once(child, "exit");
    const identity = { registrationSha256: "same-registered-work", mode: "ranking" };
    const filename = path.join(directory, "coordinator.lock.json");
    const old = { token: "dead-original", pid: child.pid, hostname: hostname(), identity };
    await writeFile(filename, JSON.stringify(old)); const oldBytes = await readFile(filename), oldSha256 = byteHash(oldBytes);
    const firstAtRename = deferred(), secondAtRename = deferred(), firstMayRename = deferred(), secondMayRename = deferred(), anySettled = deferred();
    let renames = 0, releaseWinner: (() => Promise<void>) | undefined;
    let attempts: Promise<() => Promise<void>>[] = [];
    hooks.beforeRename = async (source, target) => {
      if (source !== filename || !target.includes("coordinator.abandoned-")) return;
      if (++renames === 1) { firstAtRename.resolve(); await firstMayRename.promise; }
      else { secondAtRename.resolve(); await secondMayRename.promise; }
    };
    try {
      attempts = [acquireCoordinatorLock(directory, identity, oldSha256), acquireCoordinatorLock(directory, identity, oldSha256)];
      for (const attempt of attempts) void attempt.then(anySettled.resolve, anySettled.resolve);
      await firstAtRename.promise;
      // Old code lets both observe the old SHA before either rename. New code rejects
      // the competitor at the O_EXCL recovery guard while the first is paused here.
      await Promise.race([secondAtRename.promise, anySettled.promise]);
      firstMayRename.resolve(); releaseWinner = await Promise.any(attempts);
      const liveBytes = await readFile(filename); expect(JSON.parse(liveBytes.toString()).pid).toBe(process.pid);
      secondMayRename.resolve();
      const outcomes = await Promise.allSettled(attempts);
      expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter(row => row.status === "rejected")).toHaveLength(1);
      expect(byteHash(await readFile(filename))).toBe(byteHash(liveBytes));
      const archives = (await readdir(directory)).filter(name => name.startsWith("coordinator.abandoned-"));
      expect(archives).toHaveLength(1); expect(byteHash(await readFile(path.join(directory, archives[0])))).toBe(oldSha256);
      expect(renames).toBe(1);
    } finally {
      firstMayRename.resolve(); secondMayRename.resolve(); await Promise.allSettled(attempts); hooks.beforeRename = null;
      await releaseWinner?.(); await rm(directory, { recursive: true, force: true });
    }
  });
});
