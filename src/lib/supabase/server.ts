import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { AnalyticsEventName, AnalyticsPayload } from "@/types/analytics";
import { getSupabaseConfig } from "./config";

export const ANALYTICS_SUPABASE_WRITE_TIMEOUT_MS = 1_500;

type AnalyticsWriteOptions = {
  /** The originating HTTP request or producer cancellation signal. */
  signal: AbortSignal;
  /** An optional earlier absolute application/proxy deadline. */
  deadlineEpochMs?: number;
};

function linkedFetch(parentSignal: AbortSignal) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const fetchSignal = init?.signal;

    parentSignal.addEventListener("abort", abort, { once: true });
    fetchSignal?.addEventListener("abort", abort, { once: true });
    if (parentSignal.aborted || fetchSignal?.aborted) abort();

    try {
      if (controller.signal.aborted) {
        throw controller.signal.reason ?? new DOMException("Analytics write aborted", "AbortError");
      }
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      parentSignal.removeEventListener("abort", abort);
      fetchSignal?.removeEventListener("abort", abort);
    }
  };
}

function analyticsWriteScope(options: AnalyticsWriteOptions) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const configuredDeadline = Number.isFinite(options.deadlineEpochMs)
    ? Math.floor(Number(options.deadlineEpochMs))
    : Number.POSITIVE_INFINITY;
  const deadlineEpochMs = Math.min(
    configuredDeadline,
    Date.now() + ANALYTICS_SUPABASE_WRITE_TIMEOUT_MS
  );
  const remainingMs = Math.max(0, deadlineEpochMs - Date.now());
  const timeout = remainingMs > 0 ? setTimeout(abort, remainingMs) : undefined;
  timeout?.unref?.();

  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted || remainingMs <= 0) abort();

  return {
    signal: controller.signal,
    dispose() {
      if (timeout !== undefined) clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
    }
  };
}

export function createAnalyticsSupabaseClient(options: { signal: AbortSignal }) {
  const { url, serviceRoleKey } = getSupabaseConfig();

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase is not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    },
    global: {
      fetch: linkedFetch(options.signal)
    }
  });
}

/**
 * Best-effort analytics storage with a real abort boundary. The outer race is
 * intentional: it also bounds non-compliant/mocked clients that ignore fetch
 * cancellation, while the linked fetch stops actual network I/O.
 */
export async function storeAnalyticsEvent(
  eventName: AnalyticsEventName,
  payload: AnalyticsPayload,
  options: AnalyticsWriteOptions
) {
  const scope = analyticsWriteScope(options);
  if (scope.signal.aborted) {
    scope.dispose();
    return false;
  }

  let removeAbortListener: (() => void) | undefined;
  try {
    const supabase = createAnalyticsSupabaseClient({ signal: scope.signal });
    const write = Promise.resolve(
      supabase.from("events").insert({
        user_id: null,
        event_name: eventName,
        payload
      })
    ).then(({ error }) => !error, () => false);
    const aborted = new Promise<false>((resolve) => {
      const onAbort = () => resolve(false);
      scope.signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => scope.signal.removeEventListener("abort", onAbort);
      if (scope.signal.aborted) resolve(false);
    });

    return await Promise.race([write, aborted]);
  } catch {
    return false;
  } finally {
    removeAbortListener?.();
    scope.dispose();
  }
}
