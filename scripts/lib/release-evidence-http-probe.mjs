#!/usr/bin/env node

const [requestUrl, expectedLocation] = process.argv.slice(2);
const VERIFIER_ID = "release-evidence-http-probe.v1";

function fail(message) {
  throw new Error(message);
}

async function main() {
  const request = new URL(requestUrl);
  const expected = new URL(expectedLocation);
  if (
    request.protocol !== "https:" ||
    !request.hostname.startsWith("www.") ||
    request.port ||
    request.username ||
    request.password ||
    expected.protocol !== "https:" ||
    expected.hostname !== request.hostname.slice(4) ||
    expected.port ||
    expected.username ||
    expected.password ||
    expected.pathname !== request.pathname ||
    expected.search !== request.search ||
    expected.hash !== request.hash
  ) {
    fail("redirect probe arguments are outside the fixed www-to-apex contract");
  }
  const response = await fetch(request, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000)
  });
  const location = response.headers.get("location");
  if (![301, 308].includes(response.status) || location !== expected.href) {
    fail("www redirect response differs from the fixed contract");
  }
  process.stdout.write(`${JSON.stringify({
    event: "www_redirect_probe",
    status: "ok",
    verifier: VERIFIER_ID,
    requestUrl: request.href,
    responseStatus: response.status,
    location,
    expectedLocation: expected.href
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    event: "www_redirect_probe",
    status: "failed",
    verifier: VERIFIER_ID,
    reason: error instanceof Error ? error.message : "unknown error"
  })}\n`);
  process.exitCode = 1;
});
