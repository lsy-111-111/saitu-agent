import path from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";

export const E5_MODEL = "Xenova/multilingual-e5-small";
export const E5_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
const lockBytes = await readFile(new URL("./e5-assets.lock.json", import.meta.url));
const assetLock = JSON.parse(lockBytes);
if (assetLock.model !== E5_MODEL || assetLock.revision !== E5_REVISION || assetLock.dtype !== "q8") throw new Error("e5_asset_lock_identity_mismatch");
export const E5_ASSET_LOCK_SHA256 = createHash("sha256").update(lockBytes).digest("hex");

export async function verifyAssetFile(filename, expectedSha256) {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("e5_asset_must_be_regular_file");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  const sha256 = hash.digest("hex");
  if (sha256 !== expectedSha256) throw new Error(`e5_asset_hash_mismatch:${path.basename(filename)}`);
  return { sha256, bytes: stat.size };
}

export async function verifyLocalE5Assets(cacheDir) {
  const cache = await lstat(cacheDir);
  if(!cache.isDirectory()||cache.isSymbolicLink())throw new Error("e5_cache_must_be_regular_directory");
  const directory = path.join(await realpath(cacheDir), E5_MODEL, E5_REVISION);
  const files = [];
  for (const file of assetLock.files) {
    const filename=path.join(directory,file.path);
    if(await realpath(filename)!==filename)throw new Error("e5_asset_parent_symlink_rejected");
    files.push({ path: file.path, ...await verifyAssetFile(filename, file.sha256) });
  }
  return { model: E5_MODEL, revision: E5_REVISION, assetLockSha256: E5_ASSET_LOCK_SHA256, files };
}

async function prepareAssets(cacheDir) {
  const directory = path.join(cacheDir, E5_MODEL, E5_REVISION);
  for (const file of assetLock.files) {
    const destination = path.join(directory, file.path);
    try { await verifyAssetFile(destination, file.sha256); continue; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.download-${randomUUID()}`;
    try {
      const response = await fetch(`https://huggingface.co/${E5_MODEL}/resolve/${E5_REVISION}/${file.path}`, { signal: AbortSignal.timeout(600_000) });
      if (!response.ok || !response.body) throw new Error(`e5_download_http_${response.status}`);
      await streamPipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
      await verifyAssetFile(temporary, file.sha256);
      await rename(temporary, destination);
    } finally { await rm(temporary, { force: true }); }
  }
}

/** Explicit preparation may download model weights; inference is always local. */
export async function createLocalE5({ cacheDir, allowDownload = false } = {}) {
  cacheDir = path.resolve(cacheDir ?? path.join(homedir(), ".cache/saitu/e5"));
  if (allowDownload) await prepareAssets(cacheDir);
  const verifiedAssets = await verifyLocalE5Assets(cacheDir);
  const { pipeline } = await import("@huggingface/transformers");
  const extractor = await pipeline("feature-extraction", E5_MODEL, {
    revision: E5_REVISION, dtype: "q8", device: "cpu", local_files_only: true, cache_dir: cacheDir,
  });
  const memo = new Map();
  return {
    model: E5_MODEL, revision: E5_REVISION, verifiedAssets,
    async embed(texts) {
      const missing = [...new Set(texts.filter(text => !memo.has(text)))];
      // Bounded batches; prefixes and masked mean pooling follow the E5 model card.
      for (let offset = 0; offset < missing.length; offset += 16) {
        const batch = missing.slice(offset, offset + 16);
        const tensor = await extractor(batch, { pooling: "mean", normalize: true, truncation: true, max_length: 512 });
        const vectors = tensor.tolist();
        for (let i = 0; i < batch.length; i++) memo.set(batch[i], vectors[i]);
      }
      return texts.map(text => [...memo.get(text)]);
    },
    dispose: () => extractor.dispose(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--prepare-cache") throw new Error("usage: local-e5.mjs --prepare-cache DIRECTORY");
  const provider = await createLocalE5({ cacheDir: path.resolve(args[1]), allowDownload: true });
  const vectors = await provider.embed(["query: 软件作品", "passage: 制作可运行的小程序"]);
  console.log(JSON.stringify({ model: E5_MODEL, revision: E5_REVISION, dimensions: vectors[0].length, localInferenceVerified: true }));
  await provider.dispose();
}
