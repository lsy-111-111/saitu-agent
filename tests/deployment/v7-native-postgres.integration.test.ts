import { beforeAll, describe, expect, it } from "vitest";
import { runNativeV7Postgres, V7_NATIVE_ASSERTIONS } from "../../scripts/lib/release-evidence-v7-postgres.mjs";

const integration = process.env.RUN_V7_NATIVE_POSTGRES_TESTS === "1" ? describe : describe.skip;
integration("v7 native Linux x64 PostgreSQL14 worker contract", () => {
  let result: Awaited<ReturnType<typeof runNativeV7Postgres>>;
  beforeAll(async () => {
    const output = process.env.V7_NATIVE_EVIDENCE_DIRECTORY;
    if (!output) throw new Error("native_v7_evidence_output_required");
    result = await runNativeV7Postgres({ root: process.cwd(), output });
  }, 240_000);
  it.each(V7_NATIVE_ASSERTIONS)("%s", observation => {
    expect(result.observations).toContain(observation);
    expect(result.paidCalls).toBe(0); expect(result.productionTouched).toBe(false);
  });
});
