import nextEnv from "@next/env";
import { Pool } from "pg";
import { writeFile } from "node:fs/promises";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL || !process.env.AI_SPEND_RUN_ID) throw new Error("Budget database and run ID are required");
const database = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname)) throw new Error("Local ledger required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 3000 });
try {
  const rows = (await pool.query(`select phase,state,effort,count(*)::int as calls,
    sum(reserved_micros)::text as reserved_micros,
    sum(coalesce(charged_micros,reserved_micros))::text as accounted_micros,
    sum(input_tokens)::text as input_tokens,sum(output_tokens)::text as output_tokens,
    sum(cached_input_tokens)::text as cached_input_tokens
    from ai_spend_ledger where run_id=$1 group by phase,state,effort order by phase,state,effort`, [process.env.AI_SPEND_RUN_ID])).rows;
  const report = { schemaVersion: "saitu.budget-status.v1", observedAt: new Date().toISOString(), runId: process.env.AI_SPEND_RUN_ID,
    hardLimitCny: Number(process.env.AI_SPEND_LIMIT_CNY), fundedLimitCny: Number(process.env.AI_SPEND_FUNDED_CNY),
    accountedCny: rows.reduce((sum, row) => sum + Number(row.accounted_micros), 0) / 1_000_000,
    priceBasis: "peak_price_upper_bound_not_invoice", rows, providerBalance: null };
  if (process.argv.includes("--balance")) {
    const response = await fetch("https://api.deepseek.com/user/balance", { headers: { Authorization: `Bearer ${process.env.AI_API_KEY}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Balance HTTP ${response.status}`);
    const payload = await response.json();
    report.providerBalance = { isAvailable: payload.is_available === true,
      balances: Array.isArray(payload.balance_infos) ? payload.balance_infos.map(row => ({ currency: row.currency, totalBalance: row.total_balance })) : [] };
  }
  const index = process.argv.indexOf("--output");
  if (index >= 0) await writeFile(process.argv[index + 1], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await pool.end(); }
