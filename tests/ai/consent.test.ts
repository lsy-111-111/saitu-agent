import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  aiConsentDisclosureV1Schema,
  parseAiConsentDisclosureV1
} from "../../src/lib/ai/client-consent";
import { getCurrentAiConsentDisclosure } from "../../src/lib/ai/consent-disclosure";
import { getAiConsentVersion } from "../../src/lib/config/features";
import {
  aiConsentRequiredResponse,
  competitionAiConsentAuditTarget,
  hasValidAiConsent
} from "../../src/lib/ai/consent";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_VERSION = process.env.AI_CONSENT_VERSION;
const ORIGINAL_PUBLIC_VERSION = process.env.NEXT_PUBLIC_AI_CONSENT_VERSION;

function setNodeEnv(value: string | undefined) {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, "NODE_ENV");
  } else {
    Reflect.set(process.env, "NODE_ENV", value);
  }
}

beforeEach(() => {
  setNodeEnv("test");
  process.env.AI_CONSENT_VERSION = "test.v1";
});

afterEach(() => {
  setNodeEnv(ORIGINAL_NODE_ENV);
  if (ORIGINAL_VERSION === undefined) {
    delete process.env.AI_CONSENT_VERSION;
  } else {
    process.env.AI_CONSENT_VERSION = ORIGINAL_VERSION;
  }
  if (ORIGINAL_PUBLIC_VERSION === undefined) {
    delete process.env.NEXT_PUBLIC_AI_CONSENT_VERSION;
  } else {
    process.env.NEXT_PUBLIC_AI_CONSENT_VERSION = ORIGINAL_PUBLIC_VERSION;
  }
});

describe("AI consent gate", () => {
  it("allows tests to select a fixture version on the complete disclosure", () => {
    expect(getAiConsentVersion()).toBe("test.v1");
    expect(getCurrentAiConsentDisclosure()).toMatchObject({
      schemaVersion: "ai-consent-disclosure.v1",
      version: "test.v1",
      privacyHref: "/privacy"
    });
    expect(getCurrentAiConsentDisclosure().body).toContain("DeepSeek");
  });

  it("pins production to the code-owned disclosure instead of an environment-only version", () => {
    setNodeEnv("production");
    process.env.AI_CONSENT_VERSION = "unpaired.server.v9";
    process.env.NEXT_PUBLIC_AI_CONSENT_VERSION = "unpaired.client.v8";

    expect(getAiConsentVersion()).toBe("2026-11-05.v7");
    expect(getCurrentAiConsentDisclosure().version).toBe("2026-11-05.v7");
  });

  it("requires explicit renewed consent before fixed-candidate evidence can leave the service", async () => {
    setNodeEnv("production");
    process.env.AI_CONSENT_VERSION = "2026-11-04.v6";
    const disclosure = getCurrentAiConsentDisclosure();
    expect(hasValidAiConsent({aiConsent:{accepted:true, version:"2026-11-04.v6"}})).toBe(false);
    expect(hasValidAiConsent({aiConsent:{accepted:false, version:disclosure.version}})).toBe(false);
    expect(hasValidAiConsent({aiConsent:{accepted:true, version:disclosure.version}})).toBe(true);
    expect(disclosure.body).toContain("备选依据短句");
    expect(disclosure.body).toContain("排序均由本站程序决定");
    expect(await aiConsentRequiredResponse().json()).toMatchObject({
      consentVersion: "2026-11-05.v7", consentDisclosure: disclosure
    });
  });

  it("strictly parses only the supported atomic disclosure contract", () => {
    const disclosure = getCurrentAiConsentDisclosure();
    expect(aiConsentDisclosureV1Schema.parse(disclosure)).toEqual(disclosure);
    expect(parseAiConsentDisclosureV1(disclosure)).toEqual(disclosure);
    expect(parseAiConsentDisclosureV1({ ...disclosure, extra: true })).toBeNull();
    expect(parseAiConsentDisclosureV1({ ...disclosure, privacyHref: "https://example.com/privacy" })).toBeNull();
    expect(parseAiConsentDisclosureV1({ ...disclosure, body: "   " })).toBeNull();
    expect(parseAiConsentDisclosureV1({ ...disclosure, version: "next version" })).toBeNull();
  });

  it("returns the same complete disclosure in the backward-compatible 403 response", async () => {
    const disclosure = getCurrentAiConsentDisclosure();
    const response = aiConsentRequiredResponse();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "AI_CONSENT_REQUIRED",
      consentVersion: disclosure.version,
      consentDisclosure: disclosure
    });
  });

  it("accepts only explicit consent for the current version", () => {
    expect(hasValidAiConsent({ aiConsent: { accepted: true, version: "test.v1" } })).toBe(true);
    expect(hasValidAiConsent({ aiConsent: { accepted: true, version: "old" } })).toBe(false);
    expect(hasValidAiConsent({ aiConsent: { accepted: false, version: "test.v1" } })).toBe(false);
    expect(hasValidAiConsent({})).toBe(false);
  });

  it("records DeepSeek only when competition text reached or was attempted against that provider", () => {
    expect(competitionAiConsentAuditTarget({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      upstreamAttempted: true
    }, "competition-policy.v1")).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-pro"
    });
    expect(competitionAiConsentAuditTarget({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      upstreamAttempted: true
    }, "competition-policy.v1")).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-pro"
    });
    for (const failureReason of [
      "missing_api_key",
      "mock_mode",
      "mock_not_allowed",
      "provider_not_allowed",
      "capacity_exhausted",
      "daily_budget_exhausted",
      "budget_store_unavailable",
      "timeout_before_fetch"
    ]) {
      expect(competitionAiConsentAuditTarget({
        provider: failureReason === "provider_not_allowed" ? "openai-compatible" : "deepseek",
        model: "configured-model",
        upstreamAttempted: false
      }, "competition-policy.v1"), failureReason).toEqual({
        provider: "server",
        model: "competition-policy.v1"
      });
    }
  });
});
