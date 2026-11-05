import { describe, expect, it } from "vitest";
import playwrightConfig from "../../playwright.config";

describe("Playwright isolation", () => {
  it("cannot inherit production AI, database, or analytics credentials", () => {
    const webServer = Array.isArray(playwrightConfig.webServer)
      ? playwrightConfig.webServer[0]
      : playwrightConfig.webServer;

    expect(webServer?.env).toMatchObject({
      AI_API_KEY: "",
      DATABASE_URL: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      E2E_ALLOW_EPHEMERAL_SECURITY_STATE: "1",
      AI_PROVIDER: "mock",
      AI_TEST_MODE: "1",
      ALLOW_AI_MOCK: "1"
    });
  });
});
