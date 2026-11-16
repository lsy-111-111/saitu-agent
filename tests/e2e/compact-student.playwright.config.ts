import path from "node:path";
import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3193";
const outputRoot = path.join("/Users/jiumian/.codex/visualizations/2026/11/10/01a1c3e2-ea13-7981-8494-7965aec1955b/compact-ui",
  process.env.COMPACT_UI_RUN_LABEL ?? new Date().toISOString().replace(/[:.]/g, "-"));

export default defineConfig({
  testDir: ".", testMatch: ["compact-student-report-ui.spec.ts", "fast24-student-ui.spec.ts"],
  workers: 1, fullyParallel: false, timeout: 70_000, expect: { timeout: 15_000 },
  outputDir: outputRoot,
  reporter: [["list"], ["json", { outputFile: path.join(outputRoot, "browser-results.json") }]],
  use: { baseURL, trace: "retain-on-failure", actionTimeout: 15_000,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } },
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3193`,
    cwd: path.resolve(__dirname, "../.."),
    url: baseURL, reuseExistingServer: false, timeout: 120_000,
    env: {
      AI_API_KEY: "", AI_MODEL: "mock", AI_PROVIDER: "mock", AI_TEST_MODE: "1", ALLOW_AI_MOCK: "1",
      AI_CONVERSATION_SIGNING_SECRET: "compact-ui-only-signing-secret-at-least-thirty-two-characters",
      DATABASE_URL: "", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
      E2E_ALLOW_EPHEMERAL_SECURITY_STATE: "1", FEATURE_AI: "1", FEATURE_COMPETITION_RECOMMENDER: "1",
      NEXT_DIST_DIR: ".next-compact-ui", NEXT_PUBLIC_AI_TEST_MODE: "1", NEXT_PUBLIC_SITE_URL: baseURL,
      SESSION_STARTS_PER_IP_MINUTE: "60", SESSION_STARTS_PER_IP_DAY: "600", SESSION_TRANSITIONS_PER_SESSION: "12", SESSION_TTL_SECONDS: "1800",
    },
  },
});
