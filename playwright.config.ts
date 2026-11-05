import { defineConfig, devices } from "@playwright/test";

const e2eBaseUrl = "http://127.0.0.1:3111";
const runProductionBuild = process.env.E2E_PRODUCTION === "1";
const nextCli = `"${process.execPath}" node_modules/next/dist/bin/next`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 15_000
  },
  reporter: [["list"]],
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry"
  },
  webServer: {
    command: runProductionBuild
      ? `${nextCli} build && ${nextCli} start --hostname 127.0.0.1 --port 3111`
      : `${nextCli} dev --hostname 127.0.0.1 --port 3111`,
    url: e2eBaseUrl,
    env: {
      AI_API_KEY: "",
      AI_MODEL: "mock",
      AI_PROVIDER: "mock",
      AI_TEST_MODE: "1",
      ALLOW_AI_MOCK: "1",
      AI_CONVERSATION_SIGNING_SECRET: "e2e-competition-signing-secret-at-least-thirty-two-characters",
      DATABASE_URL: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      E2E_ALLOW_EPHEMERAL_SECURITY_STATE: "1",
      FEATURE_AI: "1",
      FEATURE_COMPETITION_RECOMMENDER: "1",
      SESSION_STARTS_PER_IP_MINUTE: "60",
      SESSION_STARTS_PER_IP_DAY: "600",
      SESSION_TRANSITIONS_PER_SESSION: "12",
      SESSION_TTL_SECONDS: "1800",
      AI_CONCURRENCY_MAX: "8",
      AI_QUEUE_MAX: "32",
      AI_QUEUE_WAIT_MS: "15000",
      AI_MODEL_CALLS_PER_DAY: "1200",
      AI_BUDGET_TIMEZONE: "Asia/Shanghai",
      NEXT_DIST_DIR: ".next-e2e",
      NEXT_PUBLIC_AI_TEST_MODE: "1",
      NEXT_PUBLIC_SITE_URL: e2eBaseUrl
    },
    reuseExistingServer: false,
    timeout: runProductionBuild ? 240_000 : 120_000
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] }
    }
  ]
});
