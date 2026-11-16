import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ai/competition-recommend/route";
import { createCompetitionConversationToken } from "@/lib/ai/competition-conversation-token";
import {
  capDecisionRequestDeadlines,
  createCompetitionRequestDeadlines,
} from "@/lib/ai/request-deadline";
import { resetRateLimitStateForTests } from "@/lib/security/rate-limit";
import {
  DECISION_RESPONSE_VERSION,
  decisionResponseSchema,
} from "@/lib/competitions/v6/contracts";
import { student } from "./decision-fixtures";

const environment = { ...process.env };
beforeEach(() => {
  Object.assign(process.env, {
    FEATURE_AI: "1",
    FEATURE_COMPETITION_RECOMMENDER: "1",
    AI_CONSENT_VERSION: "v6-route-test",
    AI_PROVIDER: "mock",
    AI_TEST_MODE: "1",
    ALLOW_AI_MOCK: "1",
    SAITU_DECISION_STRATEGY: "rules",
    AI_CONVERSATION_SIGNING_SECRET:
      "v6-route-test-signing-secret-longer-than-thirty-two-characters",
  });
  resetRateLimitStateForTests();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...environment };
  vi.restoreAllMocks();
});

function body() {
  const profile = student({
    decisionContext: {
      goalIntent: "explore",
      goalResolution: "confirmed",
      experienceStatus: "none",
    },
  });
  return {
    aiConsent: { accepted: true, version: "v6-route-test" },
    reportVersion: DECISION_RESPONSE_VERSION,
    conversationToken: createCompetitionConversationToken({
      profile,
      transcript: [],
      pendingQuestion: null,
      completed: true,
      rawAnswerContext: [{ fieldId: "stage", selectedValues: [profile.stage] }],
    }),
  };
}
function request(value: unknown, key: string) {
  return new Request("http://localhost/api/ai/competition-recommend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.233",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(value),
  });
}

describe("v6 signed recommendation boundary", () => {
  it("returns a checked v6 report from the signed conversation and replays its exact snapshot", async () => {
    const payload = body();
    const first = await POST(request(payload, "decision-v6-route-replay-0001"));
    expect(first.status).toBe(200);
    const report = decisionResponseSchema.parse(await first.json());
    expect(report.report.profile.primaryGoal).toBe("探索适合自己的方向");
    expect(report.report.trace.method).toBe("rules");
    const replay = await POST(
      request(payload, "decision-v6-route-replay-0001"),
    );
    expect(replay.headers.get("x-idempotent-replay")).toBe("true");
    expect(await replay.json()).toEqual(report);
  });
  it("rejects a client-injected profile and outdated consent", async () => {
    const payload = body();
    const injection = await POST(
      request(
        { ...payload, profile: student({ skills: ["programming"] }) },
        "decision-v6-profile-injection",
      ),
    );
    expect(injection.status).toBe(400);
    const oldConsent = await POST(
      request(
        { ...payload, aiConsent: { accepted: true, version: "2026-11-05.v7" } },
        "decision-v6-old-consent-0001",
      ),
    );
    expect(oldConsent.status).toBe(403);
  });
  it("labels rule fallback when model matching is configured but only a mock provider is available", async () => {
    process.env.SAITU_DECISION_STRATEGY = "llm";
    const response = await POST(
      request(body(), "decision-v6-model-fallback-001"),
    );
    expect(response.status).toBe(200);
    const result = decisionResponseSchema.parse(await response.json());
    expect(result.report.fallback).toEqual({ used: true, reason: "mock_mode" });
    expect(result.report.trace.callCount).toBe(0);
  });
  it("reserves fallback and persistence time within the 45-second v6 budget", () => {
    const base = createCompetitionRequestDeadlines(0);
    const capped = capDecisionRequestDeadlines(base);
    expect(capped.responseDeadlineEpochMs).toBeLessThanOrEqual(45_000);
    const phases = [
      capped.aiDeadlineEpochMs,
      capped.producerDeadlineEpochMs,
      capped.finalizeDeadlineEpochMs,
      capped.duplicateWaitDeadlineEpochMs,
      capped.responseDeadlineEpochMs,
    ];
    expect(
      phases.every((phase, index) => index === 0 || phase > phases[index - 1]),
    ).toBe(true);
    expect(base.responseDeadlineEpochMs).toBe(65_000);
  });
});
