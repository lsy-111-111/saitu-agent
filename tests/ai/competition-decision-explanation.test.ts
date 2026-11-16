import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ai/competition-recommend/route";
import { createCompetitionConversationToken } from "@/lib/ai/competition-conversation-token";
import { parseCompetitionRecommendationResponseV5 } from "@/lib/competitions/recommendation-runtime-schema";
import { competitions } from "@/content/competitions";
import { personalizeFixedDecisionExplanations } from "@/lib/ai/competition-decision-explanation";
import { AI_EVIDENCE_EXPLANATION_CONSENT_VERSION } from "@/lib/ai/consent-disclosure";
import { resetModelCallGovernorForTests } from "@/lib/ai/model-call-governor";
import { explainDecisionShortlist } from "@/lib/ai/competition-ranking";
import { normalizeCompetitionQuestionnaire, confirmCompetitionQuestionnaire } from "@/lib/ai/competition-questionnaire";
import { getCompetitionRecommendationCandidates } from "@/lib/competitions/recommendation-engine";
import { selectPublishedDecisionRecords } from "@/lib/competitions/v6/published-records";
import { isDecisionEvidenceFact, isEvidenceForRecord } from "@/lib/competitions/v6/evidence";
import { COMPETITION_QUESTIONNAIRE_VERSION } from "@/types/competition-recommendation";

const fetchMock = vi.fn<typeof fetch>();
const audit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/consent", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/ai/consent")>(),
  recordAiConsent: audit
}));

function fixture() {
  const normalized = normalizeCompetitionQuestionnaire({ version: COMPETITION_QUESTIONNAIRE_VERSION, answers: [
    { fieldId: "stage", selectedValues: ["stage:undergraduate-2"] },
    { fieldId: "majorFields", selectedValues: ["majorFields:chemistry-materials", "specificSubjects:chemistry-chemical"] },
    { fieldId: "skills", selectedValues: ["skills:laboratory"] },
    { fieldId: "taskFormats", selectedValues: ["taskFormats:research"] }
  ] });
  if (!normalized.ok) throw Error("invalid questionnaire fixture");
  const confirmed = confirmCompetitionQuestionnaire(normalized.interpretations, []);
  if (!confirmed.ok) throw Error("invalid profile");
  return { profile: confirmed.profile, answers: normalized.questionnaire.answers };
}

function baseline() {
  const { profile } = fixture();
  const ids = ["chemistry-experiment-innovation", "chemical-engineering-experiment"];
  const candidates = getCompetitionRecommendationCandidates(profile, {
    catalog: competitions.filter(item => ids.includes(item.id))
  }).recommendations;
  return explainDecisionShortlist(profile, [], candidates).map(item => ({
    ...item, dataNotices: ["PRIVATE-NOTICE"], registrationStatus: { ...item.registrationStatus, note: "PRIVATE-SCHEDULE" }
  }));
}

function options() {
  return {
    request: new Request("http://localhost/api/ai/competition-recommend"),
    aiConsent: { accepted: true, version: AI_EVIDENCE_EXPLANATION_CONSENT_VERSION },
    deadlineEpochMs: Date.now() + 20_000, auditDeadlineEpochMs: Date.now() + 22_000
  };
}

type Pool = { slot: number; evidence: { ref: string; text: string }[] };

function answer(build: (pools: Pool[]) => unknown) {
  fetchMock.mockImplementation(async (_url, init) => {
    const messages = JSON.parse(String(init?.body)).messages as { role: string; content: string }[];
    const prompt = messages.find(message => message.role === "user")!.content;
    expect(prompt).not.toMatch(/PRIVATE-|registration|报[名]|截止|202[0-9]|https?:|@/);
    return Response.json({ choices: [{ message: { content: JSON.stringify(build(JSON.parse(prompt))) }, finish_reason: "stop" }] });
  });
}

beforeEach(() => {
  resetModelCallGovernorForTests();
  fetchMock.mockReset();
  audit.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("AI_API_KEY", "unit-test-credential");
  vi.stubEnv("AI_API_URL", "https://api.deepseek.com/chat/completions");
  vi.stubEnv("AI_PROVIDER", "deepseek");
  vi.stubEnv("AI_CONSENT_VERSION", AI_EVIDENCE_EXPLANATION_CONSENT_VERSION);
  vi.stubEnv("ALLOW_AI_MOCK", "0");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SUPABASE_URL", "");
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetModelCallGovernorForTests(); });

describe("fixed decision explanations", () => {
  it("selects only existing references and preserves rank, score, track, gaps and official sources", async () => {
    const items = baseline();
    expect(items).toHaveLength(2);
    answer(pools => ({ choices: pools.map(p => ({ slot: p.slot, refs: [p.evidence.at(-1)!.ref] })) }));
    const result = await personalizeFixedDecisionExplanations(items, options());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("deepseek");
    expect(audit).toHaveBeenCalledTimes(1);
    result.recommendations.forEach((item, index) => {
      const initial = items[index];
      expect(item.explanationSource).toBe("deepseek");
      expect(item).toMatchObject({
        competitionId: initial.competitionId, rank: initial.rank, matchScore: initial.matchScore,
        recommendedTrack: initial.recommendedTrack, registrationStatus: initial.registrationStatus,
        rankingSource: "evidence-rules", eligibility: initial.eligibility
      });
      expect(item.explanation.possibleGaps).toEqual(initial.explanation.possibleGaps);
      expect(item.evidenceRefs!.officialFacts).toEqual(initial.evidenceRefs!.officialFacts);
      const [dimension, n] = item.evidenceRefs!.match[0].replace("decision.", "").split(":");
      expect(item.explanation.matchReasons).toEqual([initial.fitEvidence![dimension as "goal" | "task" | "experience"][Number(n)]]);
    });
  });

  it.each(["wrong-card", "reordered", "invented-text"] as const)("rejects %s output without changing any item", async attack => {
    const items = baseline();
    answer(pools => {
      const choices = pools.map(p => ({ slot: p.slot, refs: [p.evidence[0].ref] }));
      if (attack === "wrong-card") choices[0].refs = choices[1].refs;
      if (attack === "reordered") choices.reverse();
      if (attack === "invented-text") return { choices, explanation: "guaranteed scholarship" };
      return { choices };
    });
    const result = await personalizeFixedDecisionExplanations(items, options());
    expect(result.recommendations).toEqual(items);
    expect(result.fallbackReason).toBe("invalid_output");
  });

  it("fails closed for missing consent, old consent, an empty set, an expired deadline, and mock mode", async () => {
    const items = baseline();
    const input = options();
    await personalizeFixedDecisionExplanations(items, { ...input, aiConsent: { ...input.aiConsent, accepted: false } });
    await personalizeFixedDecisionExplanations(items, { ...input, aiConsent: { accepted: true, version: "2026-11-04.v6" } });
    await personalizeFixedDecisionExplanations([], input);
    expect((await personalizeFixedDecisionExplanations(items, { ...input, deadlineEpochMs: 0 })).fallbackReason).toBe("timeout");
    vi.stubEnv("AI_PROVIDER", "mock"); vi.stubEnv("ALLOW_AI_MOCK", "1"); vi.stubEnv("AI_TEST_MODE", "1");
    expect((await personalizeFixedDecisionExplanations(items, input)).recommendations).toEqual(items);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("returns reviewed exact-record rule reasons from the signed V5 route under v7 consent without a model call", async () => {
    vi.stubEnv("FEATURE_AI", "1");
    vi.stubEnv("FEATURE_COMPETITION_RECOMMENDER", "1");
    vi.stubEnv("AI_CONVERSATION_SIGNING_SECRET", "test-only-final-route-signature-secret-123456");
    const { profile, answers } = fixture();
    const conversationToken = createCompetitionConversationToken({
      profile, rawAnswerContext: answers, transcript: [], pendingQuestion: null, completed: true
    });
    const payload = { aiConsent: options().aiConsent, conversationToken };
    // The V5 compatibility route projects the current reviewed decision records.
    // Model reference-selection behavior remains covered by the tests above.
    fetchMock.mockRejectedValue(new Error("V5 compatibility must not call a provider"));
    const response = await POST(new Request("http://localhost/api/ai/competition-recommend", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
    }));
    expect(response.status).toBe(200);
    const parsed = parseCompetitionRecommendationResponseV5(await response.json());
    expect(parsed).toMatchObject({ status: "matched", provider: "rules", model: "server", rankingSource: "evidence-rules", fallbackUsed: false });
    expect(parsed!.recommendations.length).toBeGreaterThan(0);
    expect(parsed!.recommendations.length).toBeLessThanOrEqual(3);
    expect(new Set(parsed!.recommendations.map(item => item.competitionId)).size).toBe(parsed!.recommendations.length);
    const published = new Map(selectPublishedDecisionRecords().map(record => [record.recordId, record]));
    for (const item of parsed!.recommendations) {
      const record = published.get(item.recommendedTrack?.evidenceRef ?? "");
      expect(record).toBeDefined();
      if (!record) throw new Error("unpublished exact record returned by V5 route");
      expect(item).toMatchObject({ competitionId: record.seriesId, evaluatedTrackId: record.track.id,
        recommendedTrack: { id: record.track.id, evidenceRef: record.recordId }, explanationSource: "rule" });
      expect(item.explanation.matchReasons.length).toBeGreaterThan(0);
      const facts = record.facts.filter(fact => fact.kind === "official_fact" && isDecisionEvidenceFact(record, fact) && isEvidenceForRecord(record, fact));
      const evidenceSourceIds = new Set(facts.flatMap(fact => fact.sourceIds));
      expect(record.sources.some(source => source.url === item.sourceUrl && evidenceSourceIds.has(source.id))).toBe(true);
      expect(item.evidenceRefs?.officialFacts?.length).toBeGreaterThan(0);
      for (const reference of item.evidenceRefs!.officialFacts!) {
        expect(facts.some(fact => fact.text === reference.fact && fact.sourceIds.includes(reference.sourceRef)
          && record.sources.some(source => source.id === reference.sourceRef && source.url === reference.sourceUrl))).toBe(true);
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("uses rules on an upstream error, a missing key, or a spent model budget", async () => {
    const items = baseline();
    vi.stubEnv("AI_MODEL_CALLS_PER_DAY", "1");
    fetchMock.mockRejectedValueOnce(new Error("offline fixture"));
    expect((await personalizeFixedDecisionExplanations(items, options())).fallbackReason).toBe("network_error");
    expect((await personalizeFixedDecisionExplanations(items, options())).fallbackReason).toBe("daily_budget_exhausted");
    vi.stubEnv("AI_API_KEY", "");
    expect((await personalizeFixedDecisionExplanations(items, options())).fallbackReason).toBe("missing_api_key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
  });
});
