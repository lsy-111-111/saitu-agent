import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { readUserUnboundedExecutionAuthorizationV7 } from "@/lib/ai/execution-authorization";
import { effortPolicySha256, RANK_NON_THINKING_EFFORT_POLICY } from "@/lib/ai/effort-policy.mjs";
import { FAST24_REPAIR_AUTHORIZATION, FAST24_REPAIR_AUTHORIZATION_POLICY, RANK_NONTHINKING_AUTHORIZATION,
  RANK_NONTHINKING_AUTHORIZATION_POLICY, RANK_NONTHINKING_TRIAL_ID, RANK_NONTHINKING_TRIAL_SLOTS,
  USER_UNBOUNDED_AUTHORIZATION_POLICY, USER_UNBOUNDED_CONDITION_SCHEMA, USER_UNBOUNDED_EXECUTION_LIMITS, USER_UNBOUNDED_GRANT_VERSION } from "@/lib/ai/execution-policy.mjs";
import { createV7TestDatabase } from "../helpers/v7-database-environment";

const describePostgres = process.env.RUN_V7_DATABASE_TESTS === "1" ? describe : describe.skip;
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const sourceSha256 = "a".repeat(64);
const effort = RANK_NON_THINKING_EFFORT_POLICY;
const effortHash = effortPolicySha256(effort);
const main = "test-step8-main";
const old = "saitu-v7-top5-unbounded-20261109-calibration-90";
const repair = "saitu-v7-top5-unbounded-20261109-repair-90";

describePostgres("Fast24 repair authority on a disposable PostgreSQL database", () => {
  it("preserves a pre-existing grant and grants read-only authorization to the exact frozen repair", async () => {
    const fixture = await createV7TestDatabase("durable");
    const admin = fixture.admin, runtime = new pg.Client({ connectionString: fixture.runtimeUrl });
    const migration = (filename: string) => readFileSync(`db/migrations/${filename}`, "utf8");
    const conditionFor = (sourcePolicy: string, authorization: string, phase: string) => ({
      schemaVersion: USER_UNBOUNDED_CONDITION_SCHEMA, sourcePolicy, authorization, phase, mainRunId: main,
      policySha256: sha(readFileSync(sourcePolicy)), policyVersion: "saitu.policy.2026-11-09.v7.top5",
      implementationVersion: "saitu.async.2026-11-09.v7.3.top5", model: "deepseek-flash", effort: "stage",
      effortPolicy: effort, effortPolicySha256: effortHash, priorLedgerSha256: sha("[]"), freshPgRowsVerified: true,
      executionMode: "user-unbounded", executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS,
      rankModelSettings: { thinking: "disabled", policyReasoningEffort: "low", wireReasoningEffort: null, temperature: 0, topP: 1 },
      pilotContinuation: null,
    });
    const insert = (id: string, condition: ReturnType<typeof conditionFor>) => admin.query(`insert into ai_spend_development_batches
      (run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,
       authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256,effort_policy,effort_policy_sha256,execution_mode)
      values($1,$2,null,10000000,0,10000000,'{}','disposable test','stage',$3,$4,$5,$6,$7,$8,$9,'user-unbounded')`,
    [id, main, sha(JSON.stringify(condition)), JSON.stringify(condition), USER_UNBOUNDED_GRANT_VERSION, condition.phase, condition.policySha256, JSON.stringify(effort), effortHash]);
    try {
      await runtime.connect();
      for (const filename of ["20261110_compact_rank_high_authority.sql", "20261110_rank_nonthinking_authority.sql"]) await admin.query(migration(filename));
      await admin.query(`insert into ai_spend_budgets (run_id,hard_limit_micros,execution_mode)
        values($1,10000000,null),($2,null,'user-unbounded'),($3,null,'user-unbounded')`, [main, old, repair]);
      await admin.query("insert into ai_spend_authority(singleton,run_id) values(true,$1)", [main]);
      const legacy = { ...conditionFor(RANK_NONTHINKING_AUTHORIZATION_POLICY, RANK_NONTHINKING_AUTHORIZATION, "calibration"),
        developmentTrial: { id: RANK_NONTHINKING_TRIAL_ID, maxReports: 3, slotIds: RANK_NONTHINKING_TRIAL_SLOTS } };
      await insert(old, legacy);
      await admin.query("update ai_spend_development_batches set state='closed',closed_at=now() where run_id=$1", [old]);
      const oldBytes = (await admin.query("select * from ai_spend_development_batches where run_id=$1", [old])).rows;
      const newMigration = migration("20261111_fast24_repair_authority.sql");
      await admin.query(newMigration);
      const current = { ...conditionFor(FAST24_REPAIR_AUTHORIZATION_POLICY, FAST24_REPAIR_AUTHORIZATION, "repair"),
        runPurpose: "repair_validation", repairAuthorizationRecordSha256: "b".repeat(64), repairValidation: {
          schemaVersion: "saitu.fast24.repair-validation.v1", applicationRuntimeSourceSha256: sourceSha256,
          candidatePoolSha256: "c".repeat(64), productionBuildId: "disposable-next-build", selectionSha256: "d".repeat(64),
        } };
      await insert(repair, current);
      await admin.query(newMigration);
      expect((await admin.query("select * from ai_spend_development_batches where run_id=$1", [old])).rows).toEqual(oldBytes);
      for (const changed of [{ ...current, repairValidation: null },
        { ...current, repairValidation: { ...current.repairValidation, selectionSha256: Number("1".repeat(32)) } },
        { ...current, pilotContinuation: { complete: 3 } }, { ...current, runPurpose: "final_acceptance" },
        { ...current, sourcePolicy: USER_UNBOUNDED_AUTHORIZATION_POLICY }]) {
        await expect(admin.query("update ai_spend_development_batches set effort_condition=$2 where run_id=$1", [repair, JSON.stringify(changed)]))
          .rejects.toMatchObject({ code: "23514" });
      }
      await expect(runtime.query("update ai_spend_development_batches set effort_condition=effort_condition where run_id=$1", [repair]))
        .rejects.toMatchObject({ code: "42501" });
      for (const [key, value] of Object.entries({ SAITU_AI_EXECUTION_MODE: "user-unbounded", AI_SPEND_RUN_ID: repair,
        AI_SPEND_PHASE: "repair", AI_SPEND_AUTHORIZED_EFFORT: "stage", AI_SPEND_EFFORT_CONDITION_SHA256: sha(JSON.stringify(current)),
        AI_SPEND_POLICY_SHA256: current.policySha256, SAITU_V7_EFFORT_POLICY: JSON.stringify(effort),
        SAITU_V7_EFFORT_POLICY_SHA256: effortHash, SAITU_V7_SOURCE_SHA256: sourceSha256 })) vi.stubEnv(key, value);
      await expect(readUserUnboundedExecutionAuthorizationV7(runtime)).resolves.toMatchObject({ runId: repair, phase: "repair", mainRunId: main });
      vi.stubEnv("SAITU_V7_SOURCE_SHA256", "f".repeat(64));
      await expect(readUserUnboundedExecutionAuthorizationV7(runtime)).rejects.toThrow("USER_UNBOUNDED_AUTHORIZATION_REQUIRED");
    } finally {
      vi.unstubAllEnvs();
      await runtime.end();
      await fixture.close();
    }
  });
});
