#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_TIMEOUT_MS = 15_000;

const EXPECTED_MIME_TYPES = {
  css: new Set(["text/css"]),
  javascript: new Set([
    "application/ecmascript",
    "application/javascript",
    "application/x-javascript",
    "text/ecmascript",
    "text/javascript"
  ])
};

function decodeHtmlAttribute(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/gi, (entity, code) => {
    const normalized = code.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "apos") return "'";
    if (normalized === "gt") return ">";
    if (normalized === "lt") return "<";
    if (normalized === "quot") return '"';

    const radix = normalized.startsWith("#x") ? 16 : 10;
    const digits = normalized.slice(radix === 16 ? 2 : 1);
    const codePoint = Number.parseInt(digits, radix);
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return entity;
    }
  });
}

function parseAttributes(tag) {
  const attributes = new Map();
  const body = tag.replace(/^<\/?[a-z][\w:-]*/i, "").replace(/\/?\s*>$/, "");
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  for (const match of body.matchAll(attributePattern)) {
    const name = match[1].toLowerCase();
    const rawValue = match[2] ?? match[3] ?? match[4] ?? "";
    attributes.set(name, decodeHtmlAttribute(rawValue));
  }

  return attributes;
}

function classifyLink(attributes) {
  const rel = new Set(
    (attributes.get("rel") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
  );
  const as = (attributes.get("as") ?? "").toLowerCase();

  if (rel.has("stylesheet") || (rel.has("preload") && as === "style")) return "css";
  if (rel.has("modulepreload") || (rel.has("preload") && as === "script")) return "javascript";
  return null;
}

export function extractSameOriginAssets(html, documentUrl) {
  const pageUrl = new URL(documentUrl);
  const assets = new Map();
  const tagPattern = /<(link|script)\b[^>]*>/gi;

  for (const match of html.matchAll(tagPattern)) {
    const tagName = match[1].toLowerCase();
    const attributes = parseAttributes(match[0]);
    const kind = tagName === "script" ? "javascript" : classifyLink(attributes);
    const reference = attributes.get(tagName === "script" ? "src" : "href");
    if (!kind || !reference) continue;

    let assetUrl;
    try {
      assetUrl = new URL(reference, pageUrl);
    } catch {
      continue;
    }

    if (assetUrl.origin !== pageUrl.origin || !["http:", "https:"].includes(assetUrl.protocol)) continue;
    assetUrl.hash = "";
    assets.set(`${kind}:${assetUrl.href}`, { kind, url: assetUrl.href });
  }

  return [...assets.values()];
}

function normalizeContentType(value) {
  return value.split(";", 1)[0].trim().toLowerCase();
}

function assertHttpUrl(input) {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Base URL must use http or https, received ${url.protocol}`);
  }
  return url;
}

async function fetchWithContext(fetchImpl, url, timeoutMs) {
  try {
    const requestedUrl = assertHttpUrl(url);
    const response = await fetchImpl(requestedUrl.href, {
      headers: { Accept: "text/html, text/css, application/javascript, */*;q=0.1" },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.redirected) {
      throw new Error(`redirected away from ${requestedUrl.href}`);
    }
    if (response.url) {
      const responseUrl = assertHttpUrl(response.url);
      if (responseUrl.href !== requestedUrl.href) {
        throw new Error(`resolved outside the requested URL to ${responseUrl.href}`);
      }
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown network error";
    throw new Error(`Request failed for ${url}: ${reason}`);
  }
}

async function verifyAsset(asset, { fetchImpl, timeoutMs }) {
  const response = await fetchWithContext(fetchImpl, asset.url, timeoutMs);
  if (response.status !== 200) {
    throw new Error(`${asset.kind.toUpperCase()} asset ${asset.url} returned HTTP ${response.status}`);
  }

  const contentTypeHeader = response.headers.get("content-type") ?? "";
  const contentType = normalizeContentType(contentTypeHeader);
  if (!EXPECTED_MIME_TYPES[asset.kind].has(contentType)) {
    const expected = [...EXPECTED_MIME_TYPES[asset.kind]].join(" or ");
    throw new Error(
      `${asset.kind.toUpperCase()} asset ${asset.url} returned MIME ${contentType || "missing"}; expected ${expected}`
    );
  }

  const body = await response.text();
  if (!body.trim()) {
    throw new Error(`${asset.kind.toUpperCase()} asset ${asset.url} returned an empty body`);
  }

  return {
    ...asset,
    contentType,
    bytes: Buffer.byteLength(body)
  };
}

export async function verifyNextAssets(
  baseUrl = DEFAULT_BASE_URL,
  { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive number");

  const requestedUrl = assertHttpUrl(baseUrl);
  const pageResponse = await fetchWithContext(fetchImpl, requestedUrl.href, timeoutMs);
  if (pageResponse.status !== 200) {
    throw new Error(`Homepage ${requestedUrl.href} returned HTTP ${pageResponse.status}`);
  }

  const pageContentType = normalizeContentType(pageResponse.headers.get("content-type") ?? "");
  if (pageContentType !== "text/html") {
    throw new Error(
      `Homepage ${requestedUrl.href} returned MIME ${pageContentType || "missing"}; expected text/html`
    );
  }

  const html = await pageResponse.text();
  if (!html.trim()) throw new Error(`Homepage ${requestedUrl.href} returned an empty body`);

  const documentUrl = requestedUrl;
  const assets = extractSameOriginAssets(html, documentUrl);
  const cssCount = assets.filter((asset) => asset.kind === "css").length;
  const javascriptCount = assets.filter((asset) => asset.kind === "javascript").length;

  if (cssCount === 0) throw new Error(`Homepage ${documentUrl.href} does not reference any same-origin CSS assets`);
  if (javascriptCount === 0) {
    throw new Error(`Homepage ${documentUrl.href} does not reference any same-origin JavaScript assets`);
  }

  const settledAssets = await Promise.allSettled(
    assets.map((asset) => verifyAsset(asset, { fetchImpl, timeoutMs }))
  );
  const failures = settledAssets
    .filter((result) => result.status === "rejected")
    .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)));

  if (failures.length > 0) {
    throw new Error(`Static asset verification failed:\n- ${failures.join("\n- ")}`);
  }

  return {
    pageUrl: documentUrl.href,
    cssCount,
    javascriptCount,
    assetCount: assets.length,
    assets: settledAssets.map((result) => result.value)
  };
}

async function runCli() {
  const [baseUrl = DEFAULT_BASE_URL, ...extraArguments] = process.argv.slice(2);
  if (extraArguments.length > 0) {
    throw new Error("Usage: pnpm verify:assets [baseUrl]");
  }

  const result = await verifyNextAssets(baseUrl);
  console.info(
    JSON.stringify({
      event: "next_asset_verification",
      status: "ok",
      pageUrl: result.pageUrl,
      cssCount: result.cssCount,
      javascriptCount: result.javascriptCount,
      assetCount: result.assetCount
    })
  );
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPoint) {
  runCli().catch((error) => {
    console.error(
      JSON.stringify({
        event: "next_asset_verification",
        status: "failed",
        reason: error instanceof Error ? error.message : "unknown error"
      })
    );
    process.exitCode = 1;
  });
}
