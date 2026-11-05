import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createClient: vi.fn()
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMocks.createClient
}));

import { getSupabaseConfig, isSupabaseConfigured } from "@/lib/supabase/config";
import {
  ANALYTICS_SUPABASE_WRITE_TIMEOUT_MS,
  createAnalyticsSupabaseClient,
  storeAnalyticsEvent
} from "@/lib/supabase/server";

describe("server-only Supabase analytics configuration", () => {
  beforeEach(() => {
    supabaseMocks.createClient.mockReset();
    supabaseMocks.createClient.mockReturnValue({});
    vi.stubEnv("SUPABASE_URL", "https://server-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-service-role-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("ignores public anon configuration and creates the writer with server credentials", () => {
    expect(getSupabaseConfig()).toEqual({
      url: "https://server-project.supabase.co",
      serviceRoleKey: "server-only-service-role-key"
    });
    expect(isSupabaseConfigured()).toBe(true);

    const controller = new AbortController();
    createAnalyticsSupabaseClient({ signal: controller.signal });

    expect(supabaseMocks.createClient).toHaveBeenCalledWith(
      "https://server-project.supabase.co",
      "server-only-service-role-key",
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false
        },
        global: {
          fetch: expect.any(Function)
        }
      }
    );
  });

  it("does not enable analytics when only NEXT_PUBLIC anon values exist", () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    expect(isSupabaseConfigured()).toBe(false);
    expect(() => createAnalyticsSupabaseClient({ signal: new AbortController().signal }))
      .toThrow("Supabase is not configured.");
    expect(supabaseMocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["plain HTTP", "http://server-project.supabase.co"],
    ["userinfo", "https://service-role@example.supabase.co"],
    ["path", "https://server-project.supabase.co/rest/v1"],
    ["query", "https://server-project.supabase.co/?target=attacker.example"],
    ["fragment", "https://server-project.supabase.co/#secret"],
    ["explicit default port", "https://server-project.supabase.co:443"],
    ["port", "https://server-project.supabase.co:8443"],
    ["leading whitespace", " https://server-project.supabase.co"],
    ["arbitrary HTTPS host", "https://attacker.example"]
  ])("fails closed for a %s server URL", (_label, url) => {
    vi.stubEnv("SUPABASE_URL", url);

    expect(getSupabaseConfig()).toEqual({ url: "", serviceRoleKey: "" });
    expect(isSupabaseConfigured()).toBe(false);
    expect(() => createAnalyticsSupabaseClient({ signal: new AbortController().signal }))
      .toThrow("Supabase is not configured.");
    expect(supabaseMocks.createClient).not.toHaveBeenCalled();
  });

  it("does not couple server runtime configuration to a build-time public URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://different-project.supabase.co");

    expect(getSupabaseConfig()).toEqual({
      url: "https://server-project.supabase.co",
      serviceRoleKey: "server-only-service-role-key"
    });
    expect(isSupabaseConfigured()).toBe(true);
  });

  it("propagates parent cancellation into the Supabase fetch implementation", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    createAnalyticsSupabaseClient({ signal: controller.signal });
    const options = supabaseMocks.createClient.mock.calls[0]?.[2] as {
      global: { fetch: typeof fetch };
    };

    const pending = options.global.fetch("https://server-project.supabase.co/rest/v1/events");
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://server-project.supabase.co/rest/v1/events",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    const forwardedSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(forwardedSignal?.aborted).toBe(true);
  });
});

describe("bounded Supabase analytics writes", () => {
  beforeEach(() => {
    supabaseMocks.createClient.mockReset();
    vi.stubEnv("SUPABASE_URL", "https://server-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-service-role-key");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns at the strict write ceiling when a client ignores cancellation", async () => {
    supabaseMocks.createClient.mockReturnValue({
      from: () => ({ insert: () => new Promise(() => undefined) })
    });
    const controller = new AbortController();
    const pending = storeAnalyticsEvent("page_view_home", { path: "/" }, {
      signal: controller.signal
    });

    await vi.advanceTimersByTimeAsync(ANALYTICS_SUPABASE_WRITE_TIMEOUT_MS);

    await expect(pending).resolves.toBe(false);
  });

  it("aborts the underlying network request at the same deadline", async () => {
    let forwardedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      forwardedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        forwardedSignal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    supabaseMocks.createClient.mockImplementation((_url, _key, options) => ({
      from: () => ({
        insert: () => options.global.fetch(
          "https://server-project.supabase.co/rest/v1/events",
          { method: "POST" }
        )
      })
    }));
    const pending = storeAnalyticsEvent("page_view_home", { path: "/" }, {
      signal: new AbortController().signal
    });

    await vi.advanceTimersByTimeAsync(ANALYTICS_SUPABASE_WRITE_TIMEOUT_MS);

    await expect(pending).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(forwardedSignal?.aborted).toBe(true);
  });

  it("returns immediately when the originating request is aborted", async () => {
    supabaseMocks.createClient.mockReturnValue({
      from: () => ({ insert: () => new Promise(() => undefined) })
    });
    const controller = new AbortController();
    const pending = storeAnalyticsEvent("page_view_home", { path: "/" }, {
      signal: controller.signal
    });

    controller.abort();

    await expect(pending).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses an earlier caller deadline instead of resetting the write clock", async () => {
    supabaseMocks.createClient.mockReturnValue({
      from: () => ({ insert: () => new Promise(() => undefined) })
    });
    const pending = storeAnalyticsEvent("page_view_home", { path: "/" }, {
      signal: new AbortController().signal,
      deadlineEpochMs: Date.now() + 75
    });

    await vi.advanceTimersByTimeAsync(75);

    await expect(pending).resolves.toBe(false);
  });
});

describe("Supabase analytics database boundary", () => {
  const configSource = readFileSync(
    path.join(process.cwd(), "src/lib/supabase/config.ts"),
    "utf8"
  );
  const serverSource = readFileSync(
    path.join(process.cwd(), "src/lib/supabase/server.ts"),
    "utf8"
  );
  const rootEnvExample = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  const initialMigration = readFileSync(
    path.join(process.cwd(), "supabase/migrations/001_initial_schema.sql"),
    "utf8"
  );
  const hardeningMigration = readFileSync(
    path.join(process.cwd(), "supabase/migrations/002_harden_events_analytics.sql"),
    "utf8"
  );
  const payloadContractMigration = readFileSync(
    path.join(process.cwd(), "supabase/migrations/003_validate_events_payload_contract.sql"),
    "utf8"
  );
  const retentionMigration = readFileSync(
    path.join(process.cwd(), "supabase/migrations/004_expire_anonymous_events.sql"),
    "utf8"
  );

  it("documents the fail-closed server-runtime-only Supabase contract", () => {
    expect(configSource).toMatch(/^import "server-only";/u);
    expect(serverSource).toMatch(/^import "server-only";/u);
    for (const key of [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY"
    ]) {
      expect(rootEnvExample).toMatch(new RegExp(`^${key}=$`, "mu"));
    }
    expect(rootEnvExample).not.toMatch(/^NEXT_PUBLIC_SUPABASE_URL=/mu);
    expect(rootEnvExample).not.toMatch(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=/mu);
    expect(rootEnvExample).not.toMatch(/^NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=/mu);
    expect(rootEnvExample).toContain("Leave both blank");
  });

  it("removes public event inserts and grants the server role explicitly", () => {
    for (const migration of [initialMigration, hardeningMigration]) {
      expect(migration).toMatch(
        /revoke insert on public\.events from public, anon, authenticated;/i
      );
      expect(migration).toMatch(/grant insert on public\.events to service_role;/i);
      expect(migration).not.toMatch(/grant insert on public\.events to anon/i);
      expect(migration).not.toMatch(/create policy "events_insert_sanitized"/i);
    }
  });

  it("enforces and validates the event allowlist, JSON object shape, and byte ceiling", () => {
    const allowedEvents = [
      "page_view_home",
      "cta_click",
      "competition_detail_open",
      "competition_source_click",
      "competition_resource_open",
      "competition_team_open",
      "competition_recommend_started",
      "competition_recommend_completed",
      "competition_recommend_failed"
    ];

    for (const eventName of allowedEvents) {
      expect(initialMigration).toContain(`'${eventName}'`);
      expect(hardeningMigration).toContain(`'${eventName}'`);
    }
    for (const constraint of [
      "events_event_name_allowed",
      "events_payload_object",
      "events_payload_size"
    ]) {
      expect(initialMigration).toContain(constraint);
      expect(hardeningMigration).toContain(constraint);
    }
    expect(initialMigration).toContain("jsonb_typeof(payload) = 'object'");
    expect(initialMigration).toContain("octet_length(payload::text) <= 8192");
    expect(hardeningMigration).toMatch(/check \(jsonb_typeof\(payload\) = 'object'\) not valid/i);
    expect(hardeningMigration).toMatch(
      /check \(octet_length\(payload::text\) <= 8192\) not valid/i
    );
    expect(hardeningMigration.match(/not valid;/gi)).toHaveLength(3);
    for (const constraint of [
      "events_event_name_allowed",
      "events_payload_object",
      "events_payload_size"
    ]) {
      expect(hardeningMigration).toContain(`validate constraint ${constraint}`);
    }
  });

  it("mirrors the route's event-specific value contract for direct service-role writes", () => {
    expect(initialMigration).toContain("events_payload_contract");
    expect(payloadContractMigration).toContain("events_payload_contract");
    expect(payloadContractMigration).toMatch(/\) not valid;/i);
    expect(payloadContractMigration.match(/not valid;/gi)).toHaveLength(1);
    expect(payloadContractMigration).toContain(
      "validate constraint events_payload_contract"
    );

    for (const fixedValue of [
      "competition_assistant",
      "/competitions/recommend",
      "openai-compatible",
      "budget_store_unavailable",
      "service_unavailable"
    ]) {
      expect(initialMigration).toContain(`'${fixedValue}'`);
      expect(payloadContractMigration).toContain(`'${fixedValue}'`);
    }
    for (const requiredShape of [
      "payload ?& array['ctaName', 'position']",
      "payload ? 'competitionId'",
      "payload ?& array['resultCount', 'fallbackUsed', 'fallbackMode', 'provider', 'competitionIds']",
      "payload ->> 'resultCount')::integer",
      "payload ? 'failureReason'"
    ]) {
      expect(initialMigration).toContain(requiredShape);
      expect(payloadContractMigration).toContain(requiredShape);
    }
  });

  it("makes analytics anonymous at the database boundary and removes direct reads", () => {
    for (const migration of [initialMigration, retentionMigration]) {
      expect(migration).toContain("events_user_id_anonymous");
      expect(migration).toMatch(/check \(user_id is null\)/i);
      expect(migration).toMatch(/drop policy if exists "events_select_own"/i);
      expect(migration).toMatch(
        /revoke select on public\.events from public, anon, authenticated, service_role;/i
      );
      expect(migration).not.toMatch(/create policy "events_select_own"/i);
      expect(migration).not.toMatch(/grant select on public\.events to authenticated/i);
    }
    expect(retentionMigration).toMatch(
      /update public\.events set user_id = null where user_id is not null;/i
    );
    expect(retentionMigration).toContain(
      "alter table public.events validate constraint events_user_id_anonymous"
    );
  });

  it("schedules bounded daily deletion of analytics older than 180 days", () => {
    expect(retentionMigration).toMatch(/create extension if not exists pg_cron;/i);
    expect(retentionMigration).toContain("private.purge_expired_analytics_events");
    expect(retentionMigration).toContain("security definer");
    expect(retentionMigration).toContain("set search_path = pg_catalog");
    expect(retentionMigration).toContain("clock_timestamp() - interval '180 days'");
    expect(retentionMigration).toContain("limit p_batch_size");
    expect(retentionMigration).toContain("for update skip locked");
    expect(retentionMigration).toContain("p_batch_size > 5000");
    expect(retentionMigration).toContain("p_max_batches > 100");
    expect(retentionMigration).toMatch(
      /revoke all on function private\.purge_expired_analytics_events\(integer, integer\)[\s\S]*from public, anon, authenticated, service_role;/i
    );
    expect(retentionMigration).toContain("'resume-ai-events-retention'");
    expect(retentionMigration).toContain("'17 3 * * *'");
    expect(retentionMigration).toContain("events_created_at_idx");
  });
});
