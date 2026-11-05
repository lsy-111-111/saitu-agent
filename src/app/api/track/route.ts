import { NextResponse } from "next/server";
import {
  isAnalyticsEventName,
  isAuthoritativeAnalyticsEventName,
  sanitizeAnalyticsPayload
} from "@/lib/analytics/events";
import {
  checkRateLimit,
  getRequestId,
  rateLimitResponse,
  securityStateUnavailableResponse,
  withRequestId
} from "@/lib/security/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { storeAnalyticsEvent } from "@/lib/supabase/server";

const TRACK_OPERATION = "analytics_track";
const TRACK_MAX_BODY_BYTES = 8 * 1024;
type HttpProtocol = "http:" | "https:";

const hostAuthorityPattern = /^(?:\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::[0-9]{1,5})?$/i;

function trackJson(payload: unknown, requestId: string, init: ResponseInit = {}) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return withRequestId(response, requestId);
}

function asHttpProtocol(value: string): HttpProtocol | null {
  const normalized = value.trim().toLowerCase();
  return normalized === "http:" || normalized === "https:" ? normalized : null;
}

function originFromAuthority(authorityInput: string, protocol: HttpProtocol) {
  const authority = authorityInput.trim();
  if (!authority || !hostAuthorityPattern.test(authority)) return null;

  try {
    const parsed = new URL(`${protocol}//${authority}/`);
    return parsed.protocol === protocol &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

function requestTargetOrigin(request: Request) {
  let parsedRequestUrl: URL;
  try {
    parsedRequestUrl = new URL(request.url);
  } catch {
    return null;
  }

  const requestProtocol = asHttpProtocol(parsedRequestUrl.protocol);
  if (!requestProtocol) return null;

  const host = request.headers.get("host");
  if (host === null) return parsedRequestUrl.origin;

  const forwardedProto = request.headers.get("x-forwarded-proto");
  let protocol = requestProtocol;
  if (forwardedProto !== null) {
    const value = forwardedProto.split(",", 1)[0]?.trim().toLowerCase();
    if (value !== "http" && value !== "https") return null;
    protocol = `${value}:`;
  }

  return originFromAuthority(host, protocol);
}

function parseOriginHeader(value: string) {
  const match = /^(https?):\/\/(.+)$/i.exec(value.trim());
  if (!match) return null;
  return originFromAuthority(match[2], `${match[1].toLowerCase()}:` as HttpProtocol);
}

function unsafeRequestReason(request: Request) {
  const contentType = request.headers.get("content-type");
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return "unsupported_media_type" as const;
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") {
    return "unsafe_request" as const;
  }

  const origin = request.headers.get("origin");
  const targetOrigin = requestTargetOrigin(request);
  if (!targetOrigin || (origin !== null && parseOriginHeader(origin) !== targetOrigin)) {
    return "unsafe_request" as const;
  }

  return null;
}

type BoundedBodyResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "invalid_body" | "payload_too_large" };

async function readBoundedBody(request: Request, maxBytes: number): Promise<BoundedBodyResult> {
  if (!request.body) return { ok: false, reason: "invalid_body" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel("analytics request body exceeded the byte ceiling").catch(() => undefined);
        return { ok: false, reason: "payload_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "invalid_body" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

function parseTrackBody(bytes: Uint8Array) {
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const unsafeReason = unsafeRequestReason(request);
  if (unsafeReason) {
    return trackJson(
      { ok: false, reason: unsafeReason },
      requestId,
      { status: unsafeReason === "unsupported_media_type" ? 415 : 403 }
    );
  }

  const limit = checkRateLimit(request, "track");
  if (!limit.ok) {
    if (limit.stateUnavailable) {
      return securityStateUnavailableResponse({
        request,
        requestId,
        operation: TRACK_OPERATION
      }, "track");
    }
    return rateLimitResponse(limit.resetAt, {
      bucket: "track",
      operation: TRACK_OPERATION,
      request,
      requestId
    });
  }

  const boundedBody = await readBoundedBody(request, TRACK_MAX_BODY_BYTES);
  if (!boundedBody.ok) {
    return boundedBody.reason === "payload_too_large"
      ? trackJson({ ok: false, error: "PAYLOAD_TOO_LARGE" }, requestId, { status: 413 })
      : trackJson({ ok: false, reason: "invalid_event" }, requestId, { status: 400 });
  }

  const body = parseTrackBody(boundedBody.bytes) as {
    eventName?: unknown;
    payload?: unknown;
  } | null;

  if (!body || !isAnalyticsEventName(body.eventName)) {
    return trackJson({ ok: false, reason: "invalid_event" }, requestId, { status: 400 });
  }

  if (isAuthoritativeAnalyticsEventName(body.eventName)) {
    return trackJson(
      { ok: false, reason: "untrusted_authoritative_event" },
      requestId,
      { status: 403 }
    );
  }

  const payload = sanitizeAnalyticsPayload(body.eventName, body.payload);
  if (!payload) {
    return trackJson(
      { ok: false, reason: "invalid_payload" },
      requestId,
      { status: 400 }
    );
  }

  if (!isSupabaseConfigured()) {
    return trackJson({ ok: true, stored: false }, requestId);
  }

  try {
    const stored = await storeAnalyticsEvent(body.eventName, payload, {
      signal: request.signal
    });
    return trackJson({ ok: true, stored }, requestId);
  } catch {
    return trackJson({ ok: true, stored: false }, requestId);
  }
}
