import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { canonicalHash, validateReusableRanking } from "./frozen-ranking-executor.mjs";

export function validateBatchPolicy(policy) {
  if (!policy || policy.order !== "profile_then_repeat_then_arm" ||
      !Number.isSafeInteger(policy.runsPerBatch) || policy.runsPerBatch < 1 || policy.runsPerBatch > 1800 ||
      !Number.isSafeInteger(policy.maxCReservationMicros) || policy.maxCReservationMicros < 1 || policy.maxCReservationMicros > 300_000_000) {
    throw new Error("invalid_preregistered_batch_policy");
  }
}

async function readOptional(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

// Link publishes fully flushed bytes without replacing an earlier claim or receipt.
async function publish(file, value) {
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.claim-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    try { await handle.writeFile(JSON.stringify(value) + "\n"); await handle.sync(); }
    finally { await handle.close(); }
    await link(temporary, file);
    const directoryHandle = await open(directory, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } finally { await unlink(temporary); }
}

export async function bindBatchOutput(registrationFile, registrationHash, output, resume) {
  const directory = path.join(path.dirname(await realpath(registrationFile)), ".ranking-executions");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, registrationHash + ".json");
  const binding = { registrationHash, output: await realpath(output) };
  if (resume) {
    const saved = await readOptional(file);
    if (canonicalHash(binding) !== canonicalHash(saved)) throw new Error("resume_output_registration_mismatch");
  } else {
    await publish(file, binding);
  }
}

// The database lock is released by PostgreSQL even if the runner is killed.
export async function openBatchLedger(registrationHash) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString).hostname) ||
      !process.env.AI_SPEND_RUN_ID || process.env.AI_SPEND_PHASE !== "formal")
    throw new Error("isolated_formal_ledger_required");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000 });
  const client = await pool.connect().catch(async error => { await pool.end(); throw error; });
  const close = async () => { client.release(true); await pool.end(); };
  try {
    const { rows } = await client.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", ["ranking-batch:" + registrationHash]);
    if (!rows[0].locked) throw new Error("formal_batch_already_running");
  } catch (error) { await close(); throw error; }
  return { close, async ceilingForNextRun(maximum) {
    const { rows } = await client.query(`select b.hard_limit_micros::text as cap,
      (select coalesce(sum(coalesce(l.charged_micros,l.reserved_micros)),0)::text from ai_spend_ledger l where l.run_id=b.run_id) as spent
      from ai_spend_budgets b where b.run_id=$1`, [process.env.AI_SPEND_RUN_ID]);
    const spent = Number(rows[0]?.spent);
    const cap = Math.min(Number(rows[0]?.cap), Math.floor(Number(process.env.AI_SPEND_LIMIT_CNY) * 1e6),
      Math.floor(Number(process.env.AI_SPEND_FUNDED_CNY) * 1e6), 300_000_000);
    if (!Number.isSafeInteger(spent) || !Number.isSafeInteger(cap) || spent < 0 || cap <= 0)
      throw new Error("formal_batch_budget_evidence_missing");
    return spent + maximum <= cap ? spent + maximum : null;
  } };
}

export async function checkpointedRanking({ directory, slot, input, algorithm, repetition, freezeBinding, profileId,
  caseId, canStart, execute }) {
  const base = path.join(directory, slot);
  const identity = { slot, inputSha256: canonicalHash(input), algorithm, repetition, freezeBinding, profileId, caseId };
  const claimFile = base + ".claim.json", receiptFile = base + ".result.json";
  const claim = await readOptional(claimFile);
  if (claim) {
    if (canonicalHash(claim.identity) !== canonicalHash(identity)) throw new Error("batch_claim_binding_mismatch");
    const receipt = await readOptional(receiptFile);
    // An upstream request may have been sent. A missing receipt cannot authorize another dispatch.
    if (!receipt) return { status: "indeterminate", claim };
    const result = receipt.result;
    if (receipt.claimSha256 !== canonicalHash(claim) || receipt.resultSha256 !== canonicalHash(result) ||
        result.observation.invocationId !== claim.invocationId || result.observation.caseId !== caseId ||
        result.observation.profileId !== profileId) throw new Error("batch_receipt_binding_mismatch");
    validateReusableRanking({ observation: result.observation, ranking: result.ranking, input, algorithm, repetition: repetition - 1, freezeBinding });
    return { status: "reused", result };
  }
  if (await readOptional(receiptFile)) throw new Error("batch_receipt_without_claim");
  const permit = await canStart();
  if (!permit) return { status: "paused" };
  const intent = { identity, invocationId: randomUUID(), claimedAt: new Date().toISOString() };
  await publish(claimFile, intent);
  const result = JSON.parse(JSON.stringify(await execute(intent.invocationId, permit)));
  validateReusableRanking({ observation: result.observation, ranking: result.ranking, input, algorithm, repetition: repetition - 1, freezeBinding });
  if (result.observation.invocationId !== intent.invocationId || result.observation.caseId !== caseId ||
      result.observation.profileId !== profileId) throw new Error("batch_result_identity_mismatch");
  await publish(receiptFile, { claimSha256: canonicalHash(intent), resultSha256: canonicalHash(result), result });
  return { status: "executed", result };
}
