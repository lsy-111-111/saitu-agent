import path from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".", testMatch: "fast24-reference-marker-ui.spec.ts", workers: 1, fullyParallel: false,
  timeout: 60_000, expect: { timeout: 15_000 },
  outputDir: "../../artifacts/fast24-20261109/C/reference-marker-display-fix/playwright",
  reporter: [["list"], ["json", { outputFile: path.resolve(__dirname, "../../artifacts/fast24-20261109/C/reference-marker-display-fix/browser-results.json") }]],
  use: { baseURL: process.env.FAST24_UI_BASE_URL ?? "http://127.0.0.1:3172", trace: "retain-on-failure", actionTimeout: 15_000,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
});
