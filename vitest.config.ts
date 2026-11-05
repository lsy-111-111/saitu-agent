import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Next replaces this marker with a client-import build error. Unit tests
      // execute server modules directly, so they use an inert marker while the
      // production build remains the authoritative boundary check.
      "server-only": path.resolve(__dirname, "tests/fixtures/server-only.ts")
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]
  }
});
