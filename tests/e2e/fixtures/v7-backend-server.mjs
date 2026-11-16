import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { installSourceLoader } from "../../../scripts/lib/load-typescript-source.mjs";

// Isolated integration fixture. No credentials are printed or copied to artifacts.
installSourceLoader(process.cwd());
const { recommendationRuntimeBindingV7 } = await import("../../../src/lib/competitions/v7/runtime-binding.ts");
const credentials = JSON.parse(await readFile("tmp/v7-browser-tests/private/database.json", "utf8"));
const database = new URL(credentials.runtime);
if (database.hostname !== "127.0.0.1" || database.pathname !== "/saitu_v7_browser_test") throw new Error("isolated_browser_database_required");
const controlFile = path.resolve("tmp/v7-browser-tests/control.json");
await mkdir(path.dirname(controlFile), { recursive: true });
await writeFile(controlFile, JSON.stringify({ holdDetails: true, releaseDetailsFor: [], failDetailsFor: [] }));
const env = { ...process.env, DATABASE_URL: credentials.runtime,
  AI_API_KEY: "", DEEPSEEK_API_KEY: "", OPENAI_API_KEY: "", AI_PROVIDER: "mock", AI_MODEL: "mock", AI_TEST_MODE: "1", ALLOW_AI_MOCK: "1",
  AI_CONVERSATION_SIGNING_SECRET: "v7-isolated-browser-signing-secret-00000000000000",
  SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", FEATURE_AI: "1", FEATURE_COMPETITION_RECOMMENDER: "1",
  NEXT_DIST_DIR: ".next-v7-browser", NEXT_PUBLIC_AI_TEST_MODE: "1", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3147",
  SESSION_STARTS_PER_IP_MINUTE: "60", SESSION_STARTS_PER_IP_DAY: "600", SESSION_TRANSITIONS_PER_SESSION: "40", SESSION_TTL_SECONDS: "1800",
  AI_CONCURRENCY_MAX: "8", AI_QUEUE_MAX: "32", AI_QUEUE_WAIT_MS: "15000", AI_MODEL_CALLS_PER_DAY: "1200", AI_BUDGET_TIMEZONE: "Asia/Shanghai",
  V7_BROWSER_CONTROL_FILE: controlFile, SAITU_V7_SOURCE_SHA256: recommendationRuntimeBindingV7(),
};
console.info(JSON.stringify({ event: "v7_browser_fixture", database: database.pathname.slice(1), provider: "mock", paidCalls: 0, sourceSha256: env.SAITU_V7_SOURCE_SHA256 }));
const children = [
  spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3147"], { env, stdio: "inherit" }),
  spawn(process.execPath, ["tests/e2e/fixtures/v7-mock-worker.mjs"], { env, stdio: "inherit" }),
];
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill("SIGTERM"); }
process.on("SIGTERM", stop); process.on("SIGINT", stop);
for (const child of children) child.on("exit", (code) => { if (!stopping) { stop(); process.exitCode = code || 1; } });
await Promise.all(children.map(child => new Promise(resolve => child.once("exit", resolve))));
