import type { CompetitionRecommendationResponseV5, CompetitionRecommendationItemV3 } from "@/types/competition-recommendation";
import { COMPETITION_RECOMMENDATION_RESPONSE_VERSION } from "@/types/competition-recommendation";
import { parseCompetitionRecommendationResponseV5 } from "@/lib/competitions/recommendation-runtime-schema";
import { assembleDecisionReport, buildRuleMatchPlan, type DecisionContextV6 } from "./engine";
import { selectPublishedDecisionRecords } from "./published-records";
import { isDecisionEvidenceFact, isEvidenceForRecord } from "./evidence";
import { validateDecisionRecord } from "./catalog-validation";
import type { DecisionCompetitionRecord } from "./catalog-types";

export const LEGACY_PUBLICATION_ADAPTER_VERSION = "v5-published-record-presentation.v2";
const round1 = (value: number) => Math.round((value + Number.EPSILON) * 10) / 10;
const bounded = (text: string, maximum = 500) => text.length <= maximum ? text : text.slice(0, maximum - 1) + "…";

/** Citation projection only. Publication authority remains the canonical gate.
 * Metadata membership is insufficient: each displayed source must support an
 * applicable official fact and itself satisfy that fact's source binding. */
export function legacyOfficialEvidence(record: DecisionCompetitionRecord) {
  const facts = record.facts.filter(fact => fact.kind === "official_fact"
    && isDecisionEvidenceFact(record, fact) && isEvidenceForRecord(record, fact));
  const references = facts.flatMap(fact => fact.sourceIds.flatMap(sourceId => {
    const matches = record.sources.filter(source => source.id === sourceId);
    // Do not let one checked duplicate authorize a different unchecked entry.
    if (matches.length !== 1) return [];
    const source = matches[0], scope = fact.sourceScopes?.find(binding => binding.sourceId === sourceId)?.scope ?? fact.scope;
    if (source.accessStatus !== "body_read" || !["organizer", "official_host", "university_local"].includes(source.authority)
      || source.scope !== scope || !/^https?:\/\//.test(source.url)) return [];
    try { const url = new URL(source.url); if (url.username || url.password) return []; } catch { return []; }
    return [{ fact, source }];
  }));
  const sources = [...new Map(references.map(({ source }) => [source.id, source])).values()];
  const officialFacts = references.map(({ fact, source }) => ({ fact: bounded(fact.text, 1000), sourceRef: source.id, sourceUrl: source.url })).slice(0, 40);
  return { sources, officialFacts };
}

/** Rendering only: same deterministic A1 selection, no old catalog facts or
 * model-generated prose. Callers cannot supply a replacement report or ledger. */
export function presentPublishedDecisionAsV5(context: DecisionContextV6): CompetitionRecommendationResponseV5 {
  const report = assembleDecisionReport(context, buildRuleMatchPlan(context));
  const published = new Map(selectPublishedDecisionRecords(context.records).map(record => [record.recordId, record]));
  const candidates = new Map(context.candidates.map(candidate => [candidate.record.recordId, candidate]));
  const recommendations = report.recommendations.slice(0, 3).map((item, index): CompetitionRecommendationItemV3 => {
    const record = published.get(item.itemId), candidate = candidates.get(item.itemId);
    if (!record || !candidate?.nativeScore || candidate.score !== null) throw new Error("PUBLISHED_RECORD_CONTEXT_REQUIRED");
    const native = candidate.nativeScore;
    const dimension = (name: string) => round1(native.dimensions.find(value => value.name === name)?.lower ?? 0);
    const subjectTask = dimension("task"), skillsEvidence = dimension("experience"), goalsOutputs = dimension("goal"), maturity = dimension("growth"), teamResources = dimension("preparation");
    const score = round1(subjectTask + skillsEvidence + goalsOutputs + maturity + teamResources);
    const qualified = item.preparation === "ready" && item.eligibilityStatus === "eligible";
    const evidence = legacyOfficialEvidence(record);
    const source = evidence.sources[0];
    if (!source) throw new Error("PUBLISHED_RECORD_SOURCE_REQUIRED");
    const currentRegistration = record.registration.factIds.length > 0 && record.registration.factIds.every(id => record.facts.some(fact =>
      fact.id === id && fact.status === "verified_current" && fact.kind === "official_fact" && isDecisionEvidenceFact(record, fact) && isEvidenceForRecord(record, fact)));
    const status = item.registration.status === "historical" ? "stale" : item.registration.status === "open" && !validateDecisionRecord(record, context.now).currentRegistrationVerified ? "unknown" : ["open", "upcoming"].includes(item.registration.status) && !currentRegistration ? "unknown" : item.registration.status;
    const statusLabels = { open: "报名开放", upcoming: "尚未开放", closed: "报名已结束", unknown: "当前报名状态待核实", stale: "历史届次资料" };
    const reasons = item.reasons.map(reason => bounded(reason.text));
    const gaps = item.gaps.map(gap => bounded(gap.text)).slice(0, 10);
    const officialFacts = evidence.officialFacts;
    return {
      rank: index + 1, competitionId: item.seriesId, name: item.name, category: record.group,
      summary: bounded(`${item.edition}·${item.trackLabel}：${item.coreTask.text}`, 2000), sourceUrl: source.url,
      role: qualified ? index === 0 ? "best-match" : "practical" : "reference",
      recommendationRole: qualified ? index === 0 ? "best" : "steady" : "reference",
      baseMatchScore: score, matchScore: score, rankingSource: "evidence-rules",
      scoreCalibration: { version: "competition-evidence-interval.v1", qualified, alignment: score / 100,
        evidenceConfidence: 1 - (native.upper - native.lower) / 100, adjustment: 0 },
      scoreBreakdown: { subjectTask, skillsEvidence, goalsOutputs, maturity, teamResources, availabilityTiming: 0, dataConfidence: 0,
        interest: subjectTask, background: skillsEvidence, goal: goalsOutputs, difficulty: maturity, access: 0, feasibility: teamResources, completenessPenalty: 0 },
      registrationStatus: { status, label: statusLabels[status], note: bounded(item.registration.note) },
      eligibility: { status: item.eligibilityStatus === "eligible" ? "eligible" : "needs_clarification", reasons: item.eligibilityNotes.slice(0, 20).map(text => bounded(text, 1000)) },
      fit: { score, matchedSignals: reasons, gaps },
      dataNotices: [bounded(`精确资料：${item.itemId}；${item.edition}；${item.trackLabel}`, 1000),
        `已知适配依据 ${round1(native.lower)}–${round1(native.upper)} 分；未知项保留区间，不代表能力认证或获奖概率。`,
        bounded(item.registration.note, 1000)],
      recommendedTrack: { id: record.track.id, label: bounded(item.trackLabel, 200), evidenceRef: item.itemId },
      evaluatedTrackId: record.track.id,
      explanationSource: "rule", explanation: { matchReasons: reasons, possibleGaps: gaps,
        preparationTips: [bounded(item.currentRole.text), bounded(item.nextStep.text), bounded(item.opportunityCost.text)] },
      evidenceRefs: { match: [...new Set(item.reasons.flatMap(reason => reason.competitionFactIds))].slice(0, 20),
        gaps: [...new Set(item.gaps.flatMap(gap => gap.competitionFactIds))].slice(0, 20),
        source: evidence.sources.slice(0, 20).map(entry => entry.url), tips: item.nextStep.competitionFactIds.slice(0, 20), officialFacts },
    };
  });
  const selected = new Set(recommendations.map(item => item.competitionId));
  const response: CompetitionRecommendationResponseV5 = {
    responseVersion: COMPETITION_RECOMMENDATION_RESPONSE_VERSION, status: recommendations.length ? "matched" : "no_match",
    catalogVersion: report.catalogVersion, scorerVersion: report.trace.engineVersion, promptVersion: LEGACY_PUBLICATION_ADAPTER_VERSION,
    provider: "rules", model: "server", fallbackUsed: false, fallbackMode: "none", rankingSource: "evidence-rules", recommendations,
    alternatives: report.recommendations.filter(item => !selected.has(item.seriesId)).slice(0, 7).map(item => ({ competitionId: item.seriesId, name: item.name, reason: bounded(`${item.edition}·${item.trackLabel}：${item.reasons[0].text}`) })),
    candidateAudit: [...new Set(report.candidateAudit.map(item => item.seriesId))].map(seriesId => {
      const rows = report.candidateAudit.filter(item => item.seriesId === seriesId);
      const current = rows.filter(item => item.status !== "content_pending");
      return { competitionId: seriesId, name: rows[0].name, reason: bounded(`当前已审${current.length}条、待审${rows.length - current.length}条；未发布不代表不适合你。` + [...current, ...rows.filter(item => item.status === "content_pending")].map(item => `${item.recordId}：${item.reason.text}`).join("；"), 1000) };
    }).map(({ competitionId, reason }) => ({ competitionId, reason })).concat(
      report.candidateAudit.map(item => { if (!item.recordId) throw new Error("EXACT_RECORD_AUDIT_REQUIRED"); return { competitionId: item.recordId, reason: bounded(`${item.recordId} [${item.status}]：${item.reason.text}`, 1000) }; })),
  };
  // Existing V5 schema and arithmetic, also used when reading saved results.
  const parsed = parseCompetitionRecommendationResponseV5(response);
  if (!parsed) throw new Error("INVALID_V5_PUBLICATION_PRESENTATION");
  return parsed;
}

/** Replayed success bodies retain exact-record authority and may not keep an
 * expired now-open badge merely because their session/cache is still alive. */
export function isPublishedLegacyResponseCurrent(value: unknown, now = new Date()): boolean {
  const response = parseCompetitionRecommendationResponseV5(value);
  if (!response) return false;
  const published = new Map(selectPublishedDecisionRecords().map(record => [record.recordId, record]));
  return response.recommendations.every(item => {
    const record = published.get(item.recommendedTrack?.evidenceRef ?? "");
    if (!record) return false;
    const evidence = legacyOfficialEvidence(record);
    return Boolean(record.seriesId === item.competitionId && record.track.id === item.evaluatedTrackId
      && record.track.id === item.recommendedTrack?.id && evidence.sources.length > 0
      && item.sourceUrl === evidence.sources[0].url
      && JSON.stringify(item.evidenceRefs?.source) === JSON.stringify(evidence.sources.slice(0, 20).map(source => source.url))
      && JSON.stringify(item.evidenceRefs?.officialFacts) === JSON.stringify(evidence.officialFacts)
      && (item.registrationStatus.status !== "open" || validateDecisionRecord(record, now).currentRegistrationVerified));
  });
}
