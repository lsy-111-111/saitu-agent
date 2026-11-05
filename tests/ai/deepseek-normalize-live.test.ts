import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { processEnv } from "@next/env";
import { describe, expect, it } from "vitest";
import { DEFAULT_DEEPSEEK_MODEL } from "../../src/lib/ai/ai-client";
import { getAiConsentVersion } from "../../src/lib/config/features";
import {
  deepSeekLivePersonas,
  questionnaireForDeepSeekLivePersona
} from "../fixtures/deepseek-live-personas";
import type {
  CompetitionNormalizeResponseV1,
  CompetitionQuestionnaireFieldId
} from "../../src/types/competition-recommendation";

const RUN_LIVE = process.env.RUN_DEEPSEEK_NORMALIZE_LIVE === "1";
const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";
const ROUNDS = 3;
const PERSONA_IDS = [
  "vocational-visual-design",
  "master-public-management",
  "recent-graduate-career"
] as const;

type SafeOutcome = {
  personaId: string;
  round: number;
  source: string;
  status: string;
  suggestedValues: string[];
  confirmed: boolean;
  safeReason?: string;
};

function loadLocalEnv() {
  if (!existsSync(".env.local")) return { ...process.env };
  const [combinedEnv] = processEnv(
    [{ path: ".env.local", contents: readFileSync(".env.local", "utf8"), env: {} }],
    process.cwd(),
    { info: () => undefined, error: () => undefined },
    true
  );
  return combinedEnv as NodeJS.ProcessEnv;
}

if (RUN_LIVE) {
  const localEnv = loadLocalEnv();
  if (localEnv.AI_API_KEY?.trim()) process.env.AI_API_KEY = localEnv.AI_API_KEY;
  process.env.AI_PROVIDER = "deepseek";
  process.env.AI_API_URL = DEEPSEEK_CHAT_URL;
  process.env.AI_MODEL = localEnv.AI_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;
  process.env.AI_COMPETITION_NORMALIZE_MODEL =
    localEnv.AI_COMPETITION_NORMALIZE_MODEL?.trim() || process.env.AI_MODEL;
  process.env.AI_TIMEOUT_MS = "60000";
  process.env.AI_RETRY_MAX_DELAY_MS = "2000";
  process.env.DATABASE_URL = "";
  process.env.FEATURE_AI = "1";
  process.env.FEATURE_COMPETITION_RECOMMENDER = "1";
  process.env.ALLOW_AI_MOCK = "0";
  process.env.AI_TEST_MODE = "0";
  process.env.AI_CONVERSATION_SIGNING_SECRET =
    "deepseek-normalize-live-signing-secret-at-least-thirty-two-characters";
}

function request(pathname: string, body: unknown, ip: string) {
  return new Request(`http://127.0.0.1${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1",
      "Sec-Fetch-Site": "same-origin",
      "x-forwarded-for": ip
    },
    body: JSON.stringify(body)
  });
}

function interpretationFor(
  body: CompetitionNormalizeResponseV1,
  fieldId: CompetitionQuestionnaireFieldId
) {
  return body.interpretations.find((interpretation) => interpretation.fieldId === fieldId);
}

describe.skipIf(!RUN_LIVE)("DeepSeek normalization focused live acceptance", () => {
  it("uniquely maps and confirms three timing personas for three rounds", async () => {
    expect(process.env.AI_API_KEY?.trim()).toBeTruthy();
    const { POST } = await import("../../src/app/api/competitions/recommend/normalize/route");
    const aiConsent = { accepted: true as const, version: getAiConsentVersion() };
    const outcomes: SafeOutcome[] = [];

    for (const [personaIndex, personaId] of PERSONA_IDS.entries()) {
      const persona = deepSeekLivePersonas.find(({ id }) => id === personaId);
      expect(persona, `Missing focused live persona: ${personaId}`).toBeDefined();
      if (!persona) continue;
      for (let round = 1; round <= ROUNDS; round += 1) {
        const ipSuffix = personaIndex * ROUNDS + round;
        const normalizedResponse = await POST(request(
          "/api/competitions/recommend/normalize",
          {
            aiConsent,
            questionnaire: questionnaireForDeepSeekLivePersona(persona)
          },
          `198.19.10.${ipSuffix}`
        ));
        const normalizedBody = await normalizedResponse.json() as
          CompetitionNormalizeResponseV1 | Record<string, unknown>;
        if (normalizedResponse.status !== 200 || normalizedBody.ok !== true) {
          outcomes.push({
            personaId,
            round,
            source: "route-error",
            status: String(normalizedResponse.status),
            suggestedValues: [],
            confirmed: false,
            safeReason: "normalize_route_error"
          });
          continue;
        }

        const normalized = normalizedBody as CompetitionNormalizeResponseV1;
        const expected = persona.textNormalization;
        const interpretation = interpretationFor(normalized, expected.fieldId);
        const safe = {
          personaId,
          round,
          source: interpretation?.source ?? "missing",
          status: interpretation?.status ?? "missing",
          suggestedValues: interpretation?.suggestedValues ?? [],
          confirmed: false
        };
        const exactMapping =
          normalized.aiUsed === true &&
          normalized.status === "needs_confirmation" &&
          interpretation?.source === "model" &&
          interpretation.status === "ready" &&
          isDeepStrictEqual(interpretation.suggestedValues, expected.confirmedValues);
        if (!exactMapping) {
          outcomes.push({ ...safe, safeReason: "mapping_contract_failed" });
          continue;
        }

        const confirmedResponse = await POST(request(
          "/api/competitions/recommend/normalize",
          {
            aiConsent,
            questionnaireToken: normalized.questionnaireToken,
            confirmations: [{ fieldId: expected.fieldId, values: expected.confirmedValues }]
          },
          `198.19.11.${ipSuffix}`
        ));
        const confirmedBody = await confirmedResponse.json() as
          CompetitionNormalizeResponseV1 | Record<string, unknown>;
        const confirmed =
          confirmedResponse.status === 200 &&
          confirmedBody.ok === true &&
          confirmedBody.status === "confirmed" &&
          isDeepStrictEqual(confirmedBody.profile, persona.profile);
        outcomes.push({
          ...safe,
          confirmed,
          ...(confirmed ? {} : { safeReason: "confirmation_contract_failed" })
        });
      }
    }

    console.info(JSON.stringify({
      scope: "deepseek-normalize-focused-live-summary",
      personaCount: PERSONA_IDS.length,
      roundsPerPersona: ROUNDS,
      totalRuns: PERSONA_IDS.length * ROUNDS,
      outcomes
    }));
    expect(outcomes).toHaveLength(PERSONA_IDS.length * ROUNDS);
    expect(
      outcomes.filter(({ confirmed, safeReason }) => !confirmed || safeReason),
      JSON.stringify(outcomes)
    ).toEqual([]);
  }, 10 * 60 * 1000);
});
