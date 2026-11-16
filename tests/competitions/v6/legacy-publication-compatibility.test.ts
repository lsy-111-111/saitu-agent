import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { CatalogAiReview } from "@/lib/competitions/v6/catalog-types";
const { ledger, analytics } = vi.hoisted(() => ({ ledger: {} as Record<string, CatalogAiReview[]>, analytics: vi.fn() }));
vi.mock("@/content/competitions-v6/ai-review-ledger.json", async importOriginal => {
  const actual = await importOriginal<{ default: Record<string, CatalogAiReview[]> }>();
  Object.assign(ledger, structuredClone(actual.default)); return { default: ledger };
});
vi.mock("@/lib/analytics/server", () => ({ recordVerifiedRecommendationCompleted: analytics }));
import { getCoverageProfiles, getDecisionCatalog } from "@/lib/competitions/v6/catalog";
import * as canonicalCatalog from "@/lib/competitions/v6/catalog";
import { selectPublishedDecisionRecords } from "@/lib/competitions/v6/published-records";
import { catalogContentDigest } from "@/lib/competitions/v6/catalog-review";
import { buildDecisionContext, buildRuleMatchPlan } from "@/lib/competitions/v6/engine";
import { presentPublishedDecisionAsV5, isPublishedLegacyResponseCurrent } from "@/lib/competitions/v6/legacy-presentation";
import { currentDecisionPublicationBinding } from "@/lib/competitions/v6/publication-binding";
import * as bindingModule from "@/lib/competitions/v6/publication-binding";
import { coverageProfileToConfirmedChoices } from "../../../scripts/competitions/v6/evaluate-coverage";
import { parseCompetitionRecommendationResponseV5 } from "@/lib/competitions/recommendation-runtime-schema";
import { POST } from "@/app/api/ai/competition-recommend/route";
import { POST as normalize } from "@/app/api/competitions/recommend/normalize/route";
import { POST as clarify } from "@/app/api/ai/competition-clarify/route";
import { createCompetitionConversationToken, summarizeCompetitionQualificationSnapshot } from "@/lib/ai/competition-conversation-token";
import { buildCompetitionQualificationSnapshot } from "@/lib/competitions/scoring";
import { getCompetitionCatalog } from "@/lib/competitions/catalog";
import { buildCompetitionQuestionnaireRawContext } from "../../fixtures/competition-questionnaire-context";
import { resetRateLimitStateForTests } from "@/lib/security/rate-limit";
import { saveRecommendationResult, readSavedCompetitionStore } from "@/lib/competitions/saved-competitions";
import { COMPETITION_PROFILE_FIELD_IDS } from "@/types/competition-recommendation";
import type { CompetitionRecommendationProfileV5, CompetitionDynamicExchangeV3 } from "@/types/competition-recommendation";
const originalEnv = { ...process.env }, originalLedger = structuredClone(ledger);
const secret = "v5-publication-test-secret-at-least-thirty-two-characters";
const now = new Date("2026-11-05T12:00:00+08:00");
const profile = (): CompetitionRecommendationProfileV5 => ({
  profileVersion: "competition-profile.v5", questionnaireVersion: "competition-questionnaire.v1", confirmedFields: [...COMPETITION_PROFILE_FIELD_IDS],
  confirmedFacts: ["enrollmentStatus", "teamUnit", "teamSize"], stage: "undergraduate-2", majorFields: ["engineering"], specificSubjects: ["engineering-practice"],
  skills: ["programming"], interests: ["engineering"], goals: ["project"], preferredOutputs: ["software"], startingPoint: "coursework", weeklyCommitment: "5-10",
  teamStatus: "solo", availableResources: ["equipment"], participationMode: "flexible", participationTiming: "flexible", taskFormats: ["software"],
  experienceLevel: "participated", evidence: ["project"], enrollmentStatus: "full-time-student", teamSize: "solo", teamUnit: "same-unit",
});
const context = (p = profile(), transcript?: CompetitionDynamicExchangeV3[]) => buildDecisionContext(p, { qualificationSource: "record_only", now, transcript });
function revoke(recordId: string) {
  const record = getDecisionCatalog().find(record => record.recordId === recordId)!;
  const review = ledger[recordId].find(review => review.contentDigest === catalogContentDigest(record))!;
  ledger[recordId].push({ ...review, reviewedAt: "2099-01-01T00:00:00Z", outcome: "changes_requested", findings: [{ id: "test-revocation", severity: "major", description: "Synthetic isolated denial", resolved: false }] });
}
function token() { const p = profile(); return createCompetitionConversationToken({ profile: p, rawAnswerContext: buildCompetitionQuestionnaireRawContext(p), transcript: [], pendingQuestion: null, completed: true }); }
function request(conversationToken: string, extra = {}) { return new Request("http://localhost/api/ai/competition-recommend", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.177" }, body: JSON.stringify({ conversationToken, aiConsent: { accepted: true, version: "test.v1" }, ...extra }) }); }
class MemoryStorage { data = new Map<string, string>(); getItem(key: string) { return this.data.get(key) ?? null; } setItem(key: string, value: string) { this.data.set(key, value); } removeItem(key: string) { this.data.delete(key); } }
beforeEach(() => {
  Object.assign(process.env, { FEATURE_AI: "1", FEATURE_COMPETITION_RECOMMENDER: "1", AI_CONSENT_VERSION: "test.v1", AI_PROVIDER: "mock", AI_TEST_MODE: "1", ALLOW_AI_MOCK: "1", AI_CONVERSATION_SIGNING_SECRET: secret });
  resetRateLimitStateForTests(); analytics.mockReset(); analytics.mockResolvedValue(true);
  vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("NO_UPSTREAM_ALLOWED"); }));
});
afterEach(() => { for (const key of Object.keys(ledger)) delete ledger[key]; Object.assign(ledger, structuredClone(originalLedger)); vi.restoreAllMocks(); vi.unstubAllGlobals(); process.env = { ...originalEnv }; });
describe("V5 published exact-record compatibility", () => {
  it("keeps all forty public profiles schema-valid and nonempty without using them as quality gold", () => {
    const published = new Map(selectPublishedDecisionRecords().map(record => [record.recordId, record]));
    for (const source of getCoverageProfiles()) {
      const c = context(coverageProfileToConfirmedChoices(source)), response = presentPublishedDecisionAsV5(c);
      expect(parseCompetitionRecommendationResponseV5(response), source.id).not.toBeNull();
      expect(response.recommendations.length, source.id).toBeGreaterThan(0); expect(response.recommendations.length).toBeLessThanOrEqual(3);
      expect(response.recommendations.map(item => item.recommendedTrack?.evidenceRef)).toEqual(buildRuleMatchPlan(c).recommendations.slice(0, 3).map(item => item.itemId));
      for (const item of response.recommendations) {
        const record = published.get(item.recommendedTrack!.evidenceRef!)!;
        expect(record).toBeDefined(); expect(record.seriesId).toBe(item.competitionId); expect(record.track.id).toBe(item.evaluatedTrackId);
        expect(record.sources.some(source => source.url === item.sourceUrl)).toBe(true);
        expect(item.summary).toContain(record.edition); expect(item.summary).toContain(record.track.name);
        expect(item.evidenceRefs?.officialFacts?.every(fact => record.sources.some(source => source.id === fact.sourceRef && source.url === fact.sourceUrl))).toBe(true);
      }
      expect(c.candidates.every(candidate => candidate.score === null)).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
  }, 30000);
  it("does not authorize an altered sibling, forged source, or altered reviewed bytes", () => {
    const record = selectPublishedDecisionRecords()[0];
    for (const patch of [{ recordId: record.recordId + "-sibling" }, { summary: "unreviewed changed facts" }, { track: { ...record.track, id: record.track.id + "-sibling" } }]) {
      const c = buildDecisionContext(profile(), { now, qualificationSource: "record_only", records: [{ ...record, ...patch }] });
      expect(presentPublishedDecisionAsV5(c).recommendations).toEqual([]);
      expect(presentPublishedDecisionAsV5(c).candidateAudit?.[0].reason).toContain("尚未通过");
    }
  });
  it("keeps the actual unpublished sibling pending instead of inheriting its series approval", () => {
    const records = getDecisionCatalog(), allowed = selectPublishedDecisionRecords(records);
    const good = allowed.find(record => records.some(other => other.seriesId === record.seriesId && other.recordId !== record.recordId && !other.publication.productionReady))!;
    const sibling = records.find(record => record.seriesId === good.seriesId && record.recordId !== good.recordId && !record.publication.productionReady)!;
    const c = buildDecisionContext(profile(), { now, qualificationSource: "record_only", records: [good, sibling] });
    const response = presentPublishedDecisionAsV5(c);
    expect(response.candidateAudit?.find(item => item.competitionId === sibling.recordId)?.reason).toContain("content_pending");
    expect(response.recommendations.every(item => item.recommendedTrack?.evidenceRef !== sibling.recordId)).toBe(true);
  });
  it("supports a published new series absent from the legacy catalog without inventing qualification", () => {
    const oldIds = new Set(getCompetitionCatalog().map(record => record.id));
    const record = selectPublishedDecisionRecords().find(record => !oldIds.has(record.seriesId)); expect(record).toBeDefined();
    const p = profile(); p.confirmedFields = p.confirmedFields.filter(field => field !== "taskFormats" && field !== "interests" && field !== "skills");
    const response = presentPublishedDecisionAsV5(buildDecisionContext(p, { now, qualificationSource: "record_only", records: [record!] }));
    expect(response.recommendations).toHaveLength(1); expect(response.recommendations[0].competitionId).toBe(record!.seriesId);
    expect(parseCompetitionRecommendationResponseV5(response)).not.toBeNull(); expect(saveRecommendationResult(response, new MemoryStorage()).ok).toBe(true);
  });
  it("rechecks exact response identity and refuses an unverified now-open badge on replay", () => {
    const response = presentPublishedDecisionAsV5(context());
    expect(isPublishedLegacyResponseCurrent(response, now)).toBe(true);
    const changed = structuredClone(response); changed.recommendations[0].registrationStatus = { status: "open", label: "报名开放" };
    expect(isPublishedLegacyResponseCurrent(changed, new Date("2099-01-01T00:00:00Z"))).toBe(false);
    const sibling = structuredClone(response); sibling.recommendations[0].recommendedTrack!.evidenceRef += "-unpublished-sibling";
    expect(isPublishedLegacyResponseCurrent(sibling, now)).toBe(false);
  });
  it("keeps unknown readiness as an interval and excludes old eligibility scores", () => {
    const response = presentPublishedDecisionAsV5(context());
    for (const item of response.recommendations) { expect(item.scoreBreakdown.availabilityTiming).toBe(0); expect(item.scoreBreakdown.dataConfidence).toBe(0); expect(item.scoreCalibration.adjustment).toBe(0); expect(item.dataNotices.join(" ")).toContain("未知项保留区间"); }
  });
  it("does not substitute siblings when a confirmed track is unavailable", () => {
    const record = context().candidates[0].record;
    const transcript = [{ question: { signalKey: `track:${record.seriesId}` }, answer: { selectedValues: ["unavailable-exact-track"] } }] as CompetitionDynamicExchangeV3[];
    const response = presentPublishedDecisionAsV5(context(profile(), transcript));
    expect(response.recommendations.some(item => item.competitionId === record.seriesId)).toBe(false);
    expect(response.candidateAudit?.find(item => item.competitionId === record.seriesId)?.reason).toContain("另一个具体赛道");
  });
  it("returns real API V5 results, preserves saves, and replays only the current binding", async () => {
    const signed = token(), first = await POST(request(signed)); expect(first.status).toBe(200);
    const response = await first.json(); expect(parseCompetitionRecommendationResponseV5(response)).not.toBeNull();
    const replay = await POST(request(signed)); expect(replay.headers.get("X-Idempotent-Replay")).toBe("true"); expect(await replay.json()).toEqual(response);
    const storage = new MemoryStorage(); const saved = saveRecommendationResult(response, storage); expect(saved.ok).toBe(true); expect(readSavedCompetitionStore(storage).ok).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("revocation rejects both old tokens and their cached reports; fresh signed sessions recompute", async () => {
    const signed = token(), response = await (await POST(request(signed))).json(); const firstId = response.recommendations[0].recommendedTrack.evidenceRef;
    const before = currentDecisionPublicationBinding(); revoke(firstId); expect(currentDecisionPublicationBinding()).not.toBe(before);
    const stale = await POST(request(signed)); expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ error: "QUALIFICATION_SNAPSHOT_CHANGED" });
    const fresh = await POST(request(token())); expect(fresh.status).toBe(200); expect((await fresh.json()).recommendations.every((item: { recommendedTrack: { evidenceRef: string } }) => item.recommendedTrack.evidenceRef !== firstId)).toBe(true);
  });
  it.each(["producer", "cached replay"])("rechecks the %s immediately before delivery when the real ledger changes", async mode => {
    const signed = token();
    const recordId = mode === "cached replay" ? (await (await POST(request(signed))).json()).recommendations[0].recommendedTrack.evidenceRef : context().candidates[0].record.recordId;
    const original = bindingModule.currentDecisionPublicationBinding; let reads = 0;
    vi.spyOn(bindingModule, "currentDecisionPublicationBinding").mockImplementation(() => {
      // Initial binding, signed-snapshot recompute and its stability check see
      // the same original ledger. Change the actual isolated ledger at the next
      // boundary, not the returned hash or the cache implementation.
      if (++reads === 4) revoke(recordId);
      return original();
    });
    const response = await POST(request(signed)); expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "QUALIFICATION_SNAPSHOT_CHANGED" }); expect(reads).toBeGreaterThanOrEqual(4);
  });
  it("invalidates an old signed session after canonical content bytes change, even with the same record id", async () => {
    const signed = token(), response = await (await POST(request(signed))).json(), id = response.recommendations[0].recommendedTrack.evidenceRef;
    const changed = getDecisionCatalog(); changed.find(record => record.recordId === id)!.summary += " Synthetic changed content requires fresh review.";
    vi.spyOn(canonicalCatalog, "getDecisionCatalog").mockImplementation(() => structuredClone(changed));
    const stale = await POST(request(signed)); expect(stale.status).toBe(409);
    expect(selectPublishedDecisionRecords().some(record => record.recordId === id)).toBe(false);
    const fresh = await POST(request(token())); expect(fresh.status).toBe(200);
    expect((await fresh.json()).recommendations.every((item: { recommendedTrack: { evidenceRef: string } }) => item.recommendedTrack.evidenceRef !== id)).toBe(true);
  });
  it("rejects a correctly signed pre-upgrade qualification digest rather than silently migrating it", async () => {
    const signed = token(), payload = JSON.parse(Buffer.from(signed.split(".")[0], "base64url").toString());
    payload.qualificationSnapshot = summarizeCompetitionQualificationSnapshot(buildCompetitionQualificationSnapshot(payload.profile, getCompetitionCatalog(), new Date(payload.issuedAt * 1000)), payload.issuedAt);
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url"), signature = createHmac("sha256", secret).update(encoded).digest("base64url");
    const response = await POST(request(`${encoded}.${signature}`)); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: "QUALIFICATION_SNAPSHOT_CHANGED" });
  });
  it("checks current publication again after producer completion before delivering the response", async () => {
    analytics.mockImplementationOnce(async (response) => { revoke(response.recommendations[0].recommendedTrack.evidenceRef); });
    const response = await POST(request(token())); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: "QUALIFICATION_SNAPSHOT_CHANGED" });
  });
  it("runs normalize → clarify → signed V5 recommendation with real modules and no upstream", async () => {
    const fixed = buildCompetitionQuestionnaireRawContext(profile());
    const groups: Record<string, string[]> = { stage: ["stage", "enrollmentStatus"], majorFields: ["majorFields", "specificSubjects"],
      skills: ["skills"], interests: ["interests"], taskFormats: ["taskFormats"], goals: ["goals"], preferredOutputs: ["preferredOutputs"],
      startingPoint: ["startingPoint"], experienceLevel: ["experienceLevel", "evidence"], weeklyCommitment: ["weeklyCommitment"],
      participationTiming: ["participationTiming"], teamStatus: ["teamStatus", "teamSize", "teamUnit"], availableResources: ["availableResources"], participationMode: ["participationMode"] };
    const questionnaire = { version: "competition-questionnaire.v1", answers: Object.entries(groups).map(([fieldId, fields]) => ({ fieldId,
      selectedValues: fields.flatMap(field => fixed.find(answer => answer.fieldId === field)!.selectedValues.map(value => `${field}:${value}`)) })) };
    const req = (body: unknown) => new Request("http://localhost/api/test", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.178" }, body: JSON.stringify({ aiConsent: { accepted: true, version: "test.v1" }, ...body as object }) });
    const normalized = await normalize(req({ questionnaire })); expect(normalized.status).toBe(200); const n = await normalized.json(); expect(n.status).toBe("confirmed");
    let next = await clarify(req({ questionnaireToken: n.questionnaireToken })); expect(next.status).toBe(200); let body = await next.json();
    for (let count = 0; body.nextQuestion && count < 4; count++) {
      next = await clarify(req({ conversationToken: body.conversationToken, ...(body.status === "optional_question" ? { action: "skip_optional" } : { answer: { selectedValues: [body.nextQuestion.options[0].value] } }) }));
      expect(next.status).toBe(200); body = await next.json();
    }
    expect(body.status).toBe("completed"); const response = await POST(request(body.conversationToken)); expect(response.status).toBe(200);
    const result = await response.json(); expect(parseCompetitionRecommendationResponseV5(result)).not.toBeNull(); expect(result.recommendations.length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects unsigned profile/options injection", async () => {
    expect((await POST(request(token(), { profile: profile(), qualificationSource: "legacy", records: [] }))).status).toBe(400);
    expect((await POST(request("unsigned-not-a-real-conversation-token"))).status).toBe(400);
  });
});
