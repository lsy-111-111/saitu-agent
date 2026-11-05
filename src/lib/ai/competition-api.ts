import { NextResponse } from "next/server";

// A V5 conversation can contain fourteen bounded questionnaire notes plus up to
// three preference-only dynamic exchanges. Keep the body bounded while leaving room for the
// signed token, consent envelope and confirmation metadata.
export const COMPETITION_AI_MAX_REQUEST_BYTES = 64 * 1024;

export function noStoreResponse<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export function competitionAiJson(payload: unknown, init: ResponseInit = {}) {
  return noStoreResponse(NextResponse.json(payload, init));
}

export type CompetitionAiRequestError =
  | "UNSAFE_REQUEST"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INVALID_JSON"
  | "PAYLOAD_TOO_LARGE";

type HttpProtocol = "http:" | "https:";

const hostAuthorityPattern = /^(?:\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::[0-9]{1,5})?$/i;

function requestUrl(request: Request) {
  try {
    return new URL(request.url);
  } catch {
    return null;
  }
}

function asHttpProtocol(value: string): HttpProtocol | null {
  const normalized = value.trim().toLowerCase();
  return normalized === "http:" || normalized === "https:"
    ? normalized
    : null;
}

function originFromAuthority(authorityInput: string, protocol: HttpProtocol) {
  const authority = authorityInput.trim();
  if (!authority || !hostAuthorityPattern.test(authority)) return null;

  try {
    const parsed = new URL(`${protocol}//${authority}/`);
    if (
      parsed.protocol !== protocol ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function requestTargetOrigin(request: Request) {
  const parsedRequestUrl = requestUrl(request);
  if (!parsedRequestUrl) return null;

  const requestProtocol = asHttpProtocol(parsedRequestUrl.protocol);
  if (!requestProtocol) return null;

  const host = request.headers.get("host");
  if (host === null) return parsedRequestUrl.origin;

  const forwardedProto = request.headers.get("x-forwarded-proto");
  let protocol = requestProtocol;
  if (forwardedProto !== null) {
    const firstForwardedProto = forwardedProto.split(",", 1)[0]?.trim().toLowerCase();
    if (firstForwardedProto !== "http" && firstForwardedProto !== "https") return null;
    protocol = `${firstForwardedProto}:`;
  }

  return originFromAuthority(host, protocol);
}

function parseOriginHeader(originInput: string) {
  const origin = originInput.trim();
  const match = /^(https?):\/\/(.+)$/i.exec(origin);
  if (!match) return null;
  const protocol = `${match[1].toLowerCase()}:` as HttpProtocol;
  return originFromAuthority(match[2], protocol);
}

function validateCompetitionAiRequestMetadata(request: Request): CompetitionAiRequestError | null {
  const contentType = request.headers.get("content-type");
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return "UNSUPPORTED_MEDIA_TYPE";
  }

  if (request.headers.get("sec-fetch-site")?.trim().toLowerCase() === "cross-site") {
    return "UNSAFE_REQUEST";
  }

  const targetOrigin = requestTargetOrigin(request);
  if (!targetOrigin) return "UNSAFE_REQUEST";

  const origin = request.headers.get("origin");
  if (origin !== null && parseOriginHeader(origin) !== targetOrigin) return "UNSAFE_REQUEST";

  return null;
}

export function competitionAiRequestErrorResponse(error: CompetitionAiRequestError) {
  const status = error === "PAYLOAD_TOO_LARGE"
    ? 413
    : error === "UNSUPPORTED_MEDIA_TYPE"
      ? 415
      : error === "UNSAFE_REQUEST"
        ? 403
        : 400;
  return competitionAiJson({ ok: false, error }, { status });
}

export async function readCompetitionAiJson(request: Request): Promise<
  | { ok: true; value: unknown }
  | { ok: false; error: CompetitionAiRequestError }
> {
  const metadataError = validateCompetitionAiRequestMetadata(request);
  if (metadataError) {
    return { ok: false, error: metadataError };
  }

  if (!request.body) {
    return { ok: false, error: "INVALID_JSON" };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > COMPETITION_AI_MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { ok: false, error: "PAYLOAD_TOO_LARGE" };
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false, error: "INVALID_JSON" };
  } finally {
    reader.releaseLock();
  }
}
