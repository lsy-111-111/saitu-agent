import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, symlinkSync, rmSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { readUserUnboundedExecutionAuthorizationV7 } from "@/lib/ai/execution-authorization";
import { RANK_NON_THINKING_EFFORT_POLICY, effortPolicySha256 } from "@/lib/ai/effort-policy.mjs";
import { LOCAL_PREVIEW_AUTHORIZATION_POLICY, LOCAL_PREVIEW_AUTHORIZATION, LOCAL_PREVIEW_ORIGIN,
  RANK_NONTHINKING_AUTHORIZATION_POLICY, RANK_NONTHINKING_AUTHORIZATION, RANK_NONTHINKING_TRIAL_ID, RANK_NONTHINKING_TRIAL_SLOTS,
  USER_UNBOUNDED_CONDITION_SCHEMA, USER_UNBOUNDED_EXECUTION_LIMITS, USER_UNBOUNDED_GRANT_VERSION } from "@/lib/ai/execution-policy.mjs";
import { createV7TestDatabase } from "../helpers/v7-database-environment";

const describePg = process.env.RUN_V7_DATABASE_TESTS === "1" ? describe : describe.skip;
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
describePg("independent local preview authority", () => {
  it("preserves old grants, admits a bound local reserve trial and rejects malformed, remote, changed and closed scopes", async () => {
    const fixture = await createV7TestDatabase("durable"), admin = fixture.admin;
    const runtime = new pg.Client({ connectionString: fixture.runtimeUrl });
    const directory = mkdtempSync(path.join(process.cwd(), "artifacts/local-preview-v767/auth-test-"));
    symlinkSync(process.cwd(), path.join(directory, "current"));
    const main = "local-preview-fixture-main", old = "saitu-v7-top5-unbounded-20261109-calibration-95", trial = "saitu-v7-top5-unbounded-20261109-reserve-95";
    const policy = RANK_NON_THINKING_EFFORT_POLICY, policyHash = effortPolicySha256(policy);
    const common = (sourcePolicy: string, authorization: string, phase: string) => ({
      schemaVersion: USER_UNBOUNDED_CONDITION_SCHEMA, sourcePolicy, authorization, phase, mainRunId: main,
      policySha256: sha(readFileSync(sourcePolicy)), policyVersion: "saitu.policy.2026-11-09.v7.top5", implementationVersion: "saitu.async.2026-11-09.v7.3.top5",
      model: "deepseek-flash", effort: "stage", effortPolicy: policy, effortPolicySha256: policyHash, priorLedgerSha256: sha("[]"), freshPgRowsVerified: true,
      executionMode: "user-unbounded", executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS,
      rankModelSettings: { thinking: "disabled", policyReasoningEffort: "low", wireReasoningEffort: null, temperature: 0, topP: 1 }, pilotContinuation: null,
    });
    const insert = (id: string, condition: ReturnType<typeof common>) => admin.query(`insert into ai_spend_development_batches
      (run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,
      authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256,effort_policy,effort_policy_sha256,execution_mode)
      values($1,$2,null,10000000,0,10000000,'{}','local test','stage',$3,$4,$5,$6,$7,$8,$9,'user-unbounded')`,
    [id, main, sha(JSON.stringify(condition)), JSON.stringify(condition), USER_UNBOUNDED_GRANT_VERSION, condition.phase, condition.policySha256, JSON.stringify(policy), policyHash]);
    try {
      await runtime.connect();
      for (const file of ["20261110_compact_rank_high_authority.sql", "20261110_rank_nonthinking_authority.sql", "20261111_fast24_repair_authority.sql"]) await admin.query(readFileSync(`db/migrations/${file}`, "utf8"));
      await admin.query("insert into ai_spend_budgets(run_id,hard_limit_micros,execution_mode) values($1,10000000,null),($2,null,'user-unbounded'),($3,null,'user-unbounded')", [main, old, trial]);
      await admin.query("insert into ai_spend_authority(singleton,run_id) values(true,$1)", [main]);
      await insert(old, { ...common(RANK_NONTHINKING_AUTHORIZATION_POLICY, RANK_NONTHINKING_AUTHORIZATION, "calibration"), ...{ developmentTrial: { id: RANK_NONTHINKING_TRIAL_ID, maxReports: 3, slotIds: RANK_NONTHINKING_TRIAL_SLOTS } } });
      await admin.query("update ai_spend_development_batches set state='closed',closed_at=now() where run_id=$1", [old]);
      const oldRows = (await admin.query("select * from ai_spend_development_batches where run_id=$1", [old])).rows;
      const migration = readFileSync("db/migrations/20261112_local_preview_authority.sql", "utf8");
      await admin.query(migration);
      const binding = { schemaVersion: "saitu.local-preview.binding.v1", applicationRuntimeSourceSha256: "a".repeat(64), candidatePoolSha256: "b".repeat(64), workerArtifactSha256: "c".repeat(64), nextBindingSha256: "d".repeat(64), productionBuildId: "preview-test-build", origin: LOCAL_PREVIEW_ORIGIN };
      const condition = { ...common(LOCAL_PREVIEW_AUTHORIZATION_POLICY, LOCAL_PREVIEW_AUTHORIZATION, "reserve"), runPurpose: "local_preview", localPreview: binding };
      await insert(trial, condition); await admin.query(migration);
      expect((await runtime.query("select * from ai_spend_development_batches where run_id=$1", [old])).rows).toEqual(oldRows);
      for (const change of [{ ...condition, localPreview: null }, { ...condition, runPurpose: "final_acceptance" },
        { ...condition, phase: "formal" }, { ...condition, developmentTrial: {} }, { ...condition, repairValidation: {} },
        { ...condition, sourcePolicy: RANK_NONTHINKING_AUTHORIZATION_POLICY },
        ...["https://example.com", "http://0.0.0.0:3177", "http://127.0.0.1:3178"].map(origin => ({ ...condition, localPreview: { ...binding, origin } })),
        { ...condition, localPreview: { ...binding, productionBuildId: "development" } }]) {
        await expect(admin.query("update ai_spend_development_batches set effort_condition=$2 where run_id=$1", [trial, JSON.stringify(change)])).rejects.toMatchObject({ code: "23514" });
      }
      await expect(runtime.query("update ai_spend_development_batches set state='closed' where run_id=$1", [trial])).rejects.toMatchObject({ code: "42501" });
      const environment = { NODE_ENV: "production", SAITU_AI_EXECUTION_MODE: "user-unbounded", AI_SPEND_RUN_ID: trial, AI_SPEND_PHASE: "reserve", AI_SPEND_AUTHORIZED_EFFORT: "stage",
        AI_SPEND_EFFORT_CONDITION_SHA256: sha(JSON.stringify(condition)), AI_SPEND_POLICY_SHA256: condition.policySha256,
        SAITU_V7_EFFORT_POLICY: JSON.stringify(policy), SAITU_V7_EFFORT_POLICY_SHA256: policyHash, SAITU_V7_SOURCE_SHA256: binding.applicationRuntimeSourceSha256,
        SAITU_V7_LOCAL_PREVIEW: "1", APP_RELEASE_DIR: process.cwd(), SAITU_V7_WORKER_ACTIVE_LINK: path.join(directory, "current"),
        SAITU_V7_WORKER_HEALTH_FILE: path.join(directory, "worker-health.json"), NEXT_PUBLIC_SITE_URL: LOCAL_PREVIEW_ORIGIN, DATABASE_URL: fixture.runtimeUrl,
        SAITU_LOCAL_PREVIEW_BUILD_ID: binding.productionBuildId, SAITU_LOCAL_PREVIEW_WORKER_SHA256: binding.workerArtifactSha256, SAITU_LOCAL_PREVIEW_NEXT_BINDING_SHA256: binding.nextBindingSha256 };
      for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
      await expect(readUserUnboundedExecutionAuthorizationV7(runtime)).resolves.toMatchObject({ runId: trial, phase: "reserve" });
      for (const [key, value] of Object.entries({ SAITU_V7_SOURCE_SHA256: "f".repeat(64), SAITU_LOCAL_PREVIEW_BUILD_ID: "other-build", SAITU_LOCAL_PREVIEW_WORKER_SHA256: "f".repeat(64), SAITU_LOCAL_PREVIEW_NEXT_BINDING_SHA256: "f".repeat(64), NEXT_PUBLIC_SITE_URL: "https://example.com", SAITU_V7_LOCAL_PREVIEW: "0" })) {
        vi.stubEnv(key, value);
        await expect(readUserUnboundedExecutionAuthorizationV7(runtime)).rejects.toThrow("USER_UNBOUNDED_AUTHORIZATION_REQUIRED");
        vi.stubEnv(key, environment[key as keyof typeof environment]);
      }
      await admin.query("update ai_spend_development_batches set state='closed',closed_at=now() where run_id=$1", [trial]);
      await expect(readUserUnboundedExecutionAuthorizationV7(runtime)).rejects.toThrow("USER_UNBOUNDED_AUTHORIZATION_REQUIRED");
    } finally { vi.unstubAllEnvs(); await runtime.end(); await fixture.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
