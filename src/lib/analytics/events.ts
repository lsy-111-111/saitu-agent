import { analyticsCtaNames, analyticsEvents } from "@/lib/analytics/constants";
import { isCatalogCompetitionId } from "@/lib/competitions/catalog";
import type { AnalyticsEventName, AnalyticsPayload, AnalyticsPayloadValue } from "@/types/analytics";

export { analyticsEvents };

type AnalyticsPayloadKey = keyof AnalyticsPayload;

const eventNames = new Set<AnalyticsEventName>(Object.values(analyticsEvents));
const authoritativeEventNames = new Set<AnalyticsEventName>([
  analyticsEvents.competition_recommend_completed,
  analyticsEvents.competition_recommend_failed
]);
const basePayloadKeys = ["source", "device", "path"] as const;

const payloadKeysByEvent: Record<AnalyticsEventName, readonly AnalyticsPayloadKey[]> = {
  page_view_home: [...basePayloadKeys],
  cta_click: [...basePayloadKeys, "ctaName", "position"],
  competition_detail_open: [...basePayloadKeys, "competitionId"],
  competition_source_click: [...basePayloadKeys, "competitionId"],
  competition_resource_open: [...basePayloadKeys, "competitionId"],
  competition_team_open: [...basePayloadKeys, "competitionId"],
  competition_recommend_started: [...basePayloadKeys],
  competition_recommend_completed: [
    ...basePayloadKeys,
    "resultCount",
    "fallbackUsed",
    "fallbackMode",
    "fallbackReason",
    "provider",
    "competitionIds"
  ],
  competition_recommend_failed: [...basePayloadKeys, "failureReason"]
};

const forbiddenPayloadKeys = new Set([
  "fullcontact",
  "phone",
  "email",
  "errorstack",
  "stack",
  "content",
  "description"
]);

const directSources = new Set(["direct", "referral"]);
const deviceTypes = new Set(["desktop", "mobile", "server"]);
const publicPaths = new Set([
  "/",
  "/about",
  "/competitions",
  "/competitions/recommend",
  "/competitions/saved",
  "/privacy",
  "/resources",
  "/teams",
  "/terms"
]);
const ctaNames = new Set(Object.values(analyticsCtaNames));
const fallbackModes = new Set(["none", "partial", "full"]);
const fallbackReasons = new Set([
  "missing_api_key",
  "mock_mode",
  "mock_not_allowed",
  "provider_not_allowed",
  "authentication_error",
  "insufficient_balance",
  "invalid_request",
  "rate_limited",
  "upstream_server_error",
  "api_error",
  "response_too_large",
  "invalid_json",
  "invalid_output",
  "empty_content",
  "truncated",
  "network_error",
  "timeout",
  "capacity_exhausted",
  "daily_budget_exhausted",
  "budget_store_unavailable"
]);
const providers = new Set(["deepseek", "mock", "openai-compatible", "server"]);
const failureReasons = new Set([
  "rate_limited",
  "consent_required",
  "unsafe_request",
  "session_recovery",
  "service_unavailable",
  "invalid_response",
  "network_error",
  "request_failed"
]);
const invalidValue = Symbol("invalid analytics value");

export function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return typeof value === "string" && eventNames.has(value as AnalyticsEventName);
}

/**
 * These events describe a server outcome, not a browser observation. Public
 * telemetry must never be allowed to assert them on the server's behalf.
 */
export function isAuthoritativeAnalyticsEventName(
  eventName: AnalyticsEventName
) {
  return authoritativeEventNames.has(eventName);
}

function enumValue(value: unknown, allowed: ReadonlySet<string>) {
  return typeof value === "string" && allowed.has(value) ? value : invalidValue;
}

function competitionIdsValue(value: unknown) {
  if (typeof value !== "string") return invalidValue;
  if (value === "") return "";
  const ids = value.split(",");
  if (
    ids.length < 1 || ids.length > 10 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !isCatalogCompetitionId(id))
  ) {
    return invalidValue;
  }
  return ids.join(",");
}

function validatedValue(
  key: AnalyticsPayloadKey,
  value: unknown
): AnalyticsPayloadValue | typeof invalidValue {
  switch (key) {
    case "source":
      return enumValue(value, directSources);
    case "device":
      return enumValue(value, deviceTypes);
    case "path":
    case "position":
      return enumValue(value, publicPaths);
    case "ctaName":
      return enumValue(value, ctaNames);
    case "competitionId":
      return typeof value === "string" && isCatalogCompetitionId(value) ? value : invalidValue;
    case "competitionIds":
      return competitionIdsValue(value);
    case "resultCount":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3
        ? value
        : invalidValue;
    case "fallbackUsed":
      return typeof value === "boolean" ? value : invalidValue;
    case "fallbackMode":
      return enumValue(value, fallbackModes);
    case "fallbackReason":
      return enumValue(value, fallbackReasons);
    case "provider":
      return enumValue(value, providers);
    case "failureReason":
      return enumValue(value, failureReasons);
  }
}

export function hasForbiddenAnalyticsKeys(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  return Object.keys(payload).some((key) => forbiddenPayloadKeys.has(key.toLowerCase()));
}

function hasOwn(payload: AnalyticsPayload, key: AnalyticsPayloadKey) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function validEventShape(eventName: AnalyticsEventName, payload: AnalyticsPayload) {
  const path = payload.path;
  switch (eventName) {
    case "page_view_home":
      return path === undefined || path === "/";
    case "cta_click":
      return hasOwn(payload, "ctaName") && hasOwn(payload, "position") &&
        (path === undefined || path === payload.position);
    case "competition_detail_open":
    case "competition_source_click":
    case "competition_resource_open":
    case "competition_team_open":
      return hasOwn(payload, "competitionId");
    case "competition_recommend_started":
      return path === undefined || path === "/competitions/recommend";
    case "competition_recommend_failed":
      return hasOwn(payload, "failureReason") &&
        (path === undefined || path === "/competitions/recommend");
    case "competition_recommend_completed": {
      if (
        !hasOwn(payload, "resultCount") || !hasOwn(payload, "fallbackUsed") ||
        !hasOwn(payload, "fallbackMode") || !hasOwn(payload, "provider") ||
        !hasOwn(payload, "competitionIds") ||
        (path !== undefined && path !== "/competitions/recommend")
      ) return false;

      const ids = payload.competitionIds === "" ? [] : String(payload.competitionIds).split(",");
      if (payload.resultCount !== ids.length) return false;
      return payload.fallbackUsed
        ? payload.fallbackMode !== "none" && hasOwn(payload, "fallbackReason")
        : payload.fallbackMode === "none" && !hasOwn(payload, "fallbackReason");
    }
  }
}

export function sanitizeAnalyticsPayload(
  eventName: AnalyticsEventName,
  payload: unknown
): AnalyticsPayload | null {
  if (hasForbiddenAnalyticsKeys(payload)) return null;
  if (payload === undefined) {
    return validEventShape(eventName, {}) ? {} : null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  const allowedKeys = new Set(payloadKeysByEvent[eventName]);
  const sanitized: AnalyticsPayload = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!allowedKeys.has(key as AnalyticsPayloadKey)) continue;

    const clean = validatedValue(key as AnalyticsPayloadKey, value);
    if (clean === invalidValue) return null;
    sanitized[key as AnalyticsPayloadKey] = clean;
  }

  return validEventShape(eventName, sanitized) ? sanitized : null;
}
