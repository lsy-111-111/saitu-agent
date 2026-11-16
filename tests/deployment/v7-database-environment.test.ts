import { describe, expect, it } from "vitest";
import { validateV7TestDatabaseUrls } from "../helpers/v7-database-environment";

describe("v7 dedicated PostgreSQL test environment", () => {
  const admin = "postgresql://postgres@127.0.0.1:5432/resume_ai_test_0123456789abcdef";
  const runtime = "postgresql://resume_ai_test_runtime_0123456789abcdef@127.0.0.1:5432/resume_ai_test_0123456789abcdef";
  it("accepts only a matching coordinator namespace and distinct runtime role", () => {
    expect(validateV7TestDatabaseUrls(admin, runtime, true).database).toBe("resume_ai_test_0123456789abcdef");
    expect(() => validateV7TestDatabaseUrls(admin, admin, true)).toThrow("v7_test_database_endpoint_or_role_mismatch");
  });
  it("rejects application databases, remote hosts, query overrides and unrelated runtime roles", () => {
    for (const value of [admin.replace("resume_ai_test_0123456789abcdef", "resume_ai"), admin.replace("127.0.0.1", "database.example.org"), `${admin}?options=-c%20role%3Dpostgres`])
      expect(() => validateV7TestDatabaseUrls(value, runtime, true)).toThrow();
    expect(() => validateV7TestDatabaseUrls(admin, runtime.replace("runtime_0123", "runtime_ffff"), true)).toThrow("v7_test_database_requires_coordinator_namespace");
  });
  it("retains the established local development database fallback without accepting a generic test name", () => {
    expect(validateV7TestDatabaseUrls("postgresql://saitu_upgrade_admin@127.0.0.1:5432/saitu_v7_test", "postgresql://saitu_runtime@127.0.0.1:5432/saitu_v7_test", false).database).toBe("saitu_v7_test");
    expect(() => validateV7TestDatabaseUrls(admin, runtime, false)).toThrow("v7_test_database_requires_local_development_fixture");
  });
});
