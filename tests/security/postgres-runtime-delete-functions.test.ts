import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "db/migrations/20260826_runtime_delete_functions.sql"
), "utf8");
const schema = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8");
const rateLimitSource = readFileSync(resolve(process.cwd(), "src/lib/security/rate-limit.ts"), "utf8");
const governorSource = readFileSync(
  resolve(process.cwd(), "src/lib/ai/model-call-governor.ts"),
  "utf8"
);

const approvedFunctions = [
  "resume_ai_runtime_prune_competition_state",
  "resume_ai_runtime_delete_expired_session_start",
  "resume_ai_runtime_reset_expired_session_transitions",
  "resume_ai_runtime_delete_pending_transition",
  "resume_ai_runtime_prune_model_gate",
  "resume_ai_runtime_delete_model_waiter",
  "resume_ai_runtime_delete_model_lease"
] as const;

function functionBlock(name: string) {
  const pattern = new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$function\\$;`,
    "u"
  );
  const block = migration.match(pattern)?.[0];
  expect(block, `missing SQL function ${name}`).toBeDefined();
  return block!;
}

describe("PostgreSQL runtime deletion boundary", () => {
  it("removes every direct table DELETE from application runtime TypeScript", () => {
    expect(rateLimitSource).not.toMatch(/delete\s+from\s+competition_/iu);
    expect(governorSource).not.toMatch(/delete\s+from\s+ai_model_/iu);
    expect(rateLimitSource.match(/public\.resume_ai_runtime_[a-z_]+/gu)?.sort()).toEqual([
      "public.resume_ai_runtime_delete_expired_session_start",
      "public.resume_ai_runtime_delete_pending_transition",
      "public.resume_ai_runtime_delete_pending_transition",
      "public.resume_ai_runtime_prune_competition_state",
      "public.resume_ai_runtime_reset_expired_session_transitions"
    ]);
    expect(governorSource.match(/public\.resume_ai_runtime_[a-z_]+/gu)?.sort()).toEqual([
      "public.resume_ai_runtime_delete_model_lease",
      "public.resume_ai_runtime_delete_model_waiter",
      "public.resume_ai_runtime_delete_model_waiter",
      "public.resume_ai_runtime_prune_model_gate"
    ]);
  });

  it("defines only fixed-path, fixed-predicate SECURITY DEFINER deletion APIs", () => {
    const declared = [...migration.matchAll(
      /create or replace function public\.(resume_ai_runtime_[a-z_]+)\(/gu
    )].map((match) => match[1]);
    expect(declared).toEqual(approvedFunctions);

    for (const name of approvedFunctions) {
      const block = functionBlock(name);
      expect(block).toContain("security definer");
      expect(block).toContain("set search_path = pg_catalog");
      expect(block).not.toMatch(/\bexecute\b/iu);
      expect(block).not.toMatch(/format\s*\(|quote_ident\s*\(/iu);
      expect(migration).toContain(`revoke all on function public.${name}(`);
      expect(schema).toContain(`function public.${name}(`);
    }
  });

  it("keeps each capability constrained to its intended row predicate", () => {
    expect(functionBlock("resume_ai_runtime_delete_expired_session_start"))
      .toMatch(/start_key = p_start_key[\s\S]*expires_at <= pg_catalog\.now\(\)/u);
    expect(functionBlock("resume_ai_runtime_reset_expired_session_transitions"))
      .toMatch(/transition\.session_key = p_session_key[\s\S]*session\.expires_at <= pg_catalog\.now\(\)/u);
    expect(functionBlock("resume_ai_runtime_delete_pending_transition"))
      .toMatch(/session_key = p_session_key[\s\S]*transition_key = p_transition_key[\s\S]*state = 'pending'/u);
    expect(functionBlock("resume_ai_runtime_delete_model_waiter"))
      .toMatch(/where waiter_id = p_waiter_id/u);
    expect(functionBlock("resume_ai_runtime_delete_model_lease"))
      .toMatch(/where lease_id = p_lease_id/u);
    expect(functionBlock("resume_ai_runtime_prune_competition_state"))
      .toMatch(/expires_at <= pg_catalog\.now\(\)[\s\S]*limit 500[\s\S]*for update skip locked/u);
    expect(functionBlock("resume_ai_runtime_prune_model_gate"))
      .toMatch(/leases[\s\S]*expires_at <= pg_catalog\.now\(\)[\s\S]*waiters[\s\S]*expires_at <= pg_catalog\.now\(\)/u);
  });

  it("validates all externally supplied hashed identifiers before deletion", () => {
    for (const name of [
      "resume_ai_runtime_delete_expired_session_start",
      "resume_ai_runtime_reset_expired_session_transitions",
      "resume_ai_runtime_delete_pending_transition"
    ]) {
      const block = functionBlock(name);
      expect(block).toContain("^[0-9a-f]{64}$");
      expect(block).toContain("errcode = '22023'");
      expect(block).toMatch(/\bstrict\b/u);
    }
    expect(functionBlock("resume_ai_runtime_delete_model_waiter")).toMatch(/p_waiter_id uuid/u);
    expect(functionBlock("resume_ai_runtime_delete_model_lease")).toMatch(/p_lease_id uuid/u);
  });
});
