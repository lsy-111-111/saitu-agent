import { defineConfig, devices } from "@playwright/test";

process.env.RUN_V7_BROWSER_BACKEND = "1";

export default defineConfig({
  testDir: ".", testMatch: "competition-decision-v7-backend.spec.ts", workers: 1, fullyParallel: false,
  timeout: 90_000, expect: { timeout: 20_000 }, reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3147", trace: "retain-on-failure", actionTimeout: 15_000,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
  webServer: { command: `"${process.execPath}" tests/e2e/fixtures/v7-backend-server.mjs`, cwd: process.cwd(), url: "http://127.0.0.1:3147", reuseExistingServer: false, timeout: 120_000 },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }, { name: "mobile", use: { ...devices["Pixel 5"] } }],
});
