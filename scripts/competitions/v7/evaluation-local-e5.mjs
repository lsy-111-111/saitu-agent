import { fork } from "node:child_process";
import { constants, getPriority, setPriority, homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { E5_MODEL, E5_REVISION } from "../v6/local-e5.mjs";

const self = fileURLToPath(import.meta.url);
/** One persistent local CPU model/cache, outside the C timing/event-loop process. */
export async function createIsolatedLocalE5({ cacheDir }) {
  const child = fork(self, ["--local-e5-worker", path.resolve(cacheDir ?? path.join(homedir(), ".cache/saitu/e5"))], { execArgv: [], serialization: "advanced",
    stdio: ["ignore", "ignore", "pipe", "ipc"], env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" } });
  let closed = false, nextId = 0, readyResolve, readyReject, stderr = "";
  const pending = new Map(), ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-16384); });
  const fail = error => { readyReject(error); for (const task of pending.values()) task.reject(error); pending.clear(); };
  child.on("error", fail);
  child.on("exit", code => { if (!closed) fail(new Error(`local_e5_worker_exited:${code}:${stderr}`)); });
  child.on("message", message => {
    if (message.type === "ready") {
      if (message.model !== E5_MODEL || message.revision !== E5_REVISION) { fail(new Error("isolated_e5_identity_changed")); child.kill(); }
      else readyResolve(message);
      return;
    }
    if (message.type === "startup_error") { fail(new Error(message.error)); return; }
    const task = pending.get(message.id); if (!task) return; pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error)); else task.resolve(message.value);
  });
  try { setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL); }
  catch (error) { closed = true; ready.catch(() => {}); child.kill(); await exited; throw new Error("local_e5_background_priority_required", { cause: error }); }
  const information = await ready;
  const request = (method, texts) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject });
    child.send({ id, method, ...(texts ? { texts } : {}) }, error => { if (error) { pending.delete(id); reject(error); } });
  });
  return { model: information.model, revision: information.revision, verifiedAssets: information.verifiedAssets,
    executionResource: { process: "persistent_local_background_worker", pid: child.pid, priority: getPriority(child.pid),
      sharedCache: true, network: "disabled", serializedEmbeddingRequests: true },
    embed: texts => request("embed", texts),
    async dispose() { if (closed) return; closed = true; await request("dispose"); await exited; },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === self && process.argv[2] === "--local-e5-worker") {
  if (!process.send || !path.isAbsolute(process.argv[3] ?? "")) throw new Error("local_e5_worker_requires_parent_IPC_and_absolute_cache");
  globalThis.fetch = () => { throw new Error("isolated_e5_forbids_network"); };
  try {
    const { createLocalE5 } = await import("../v6/local-e5.mjs");
    const provider = await createLocalE5({ cacheDir: process.argv[3], allowDownload: false });
    process.send({ type: "ready", model: provider.model, revision: provider.revision, verifiedAssets: provider.verifiedAssets });
    let tail = Promise.resolve();
    process.on("message", message => {
      tail = tail.then(async () => {
        try {
          if (message.method === "dispose") { await provider.dispose(); process.send({ id: message.id, value: true }, () => process.disconnect()); return; }
          if (message.method !== "embed" || !Array.isArray(message.texts) || message.texts.some(text => typeof text !== "string")) throw new Error("invalid_local_e5_embedding_request");
          process.send({ id: message.id, value: await provider.embed(message.texts) });
        } catch (error) { process.send({ id: message.id, error: error instanceof Error ? error.message : "local_e5_failed" }); }
      });
    });
  } catch (error) { process.send({ type: "startup_error", error: error instanceof Error ? error.message : "local_e5_startup_failed" }, () => process.disconnect()); }
}
