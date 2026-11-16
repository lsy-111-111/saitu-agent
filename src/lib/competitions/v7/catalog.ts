import coreReviewLedger from "@/content/competitions-v6/core-review-ledger-v7.json";
import reviewLedger from "@/content/competitions-v6/ai-review-ledger.json";
import metadataLedger from "@/content/competitions-v6/catalog-metadata-v7.json";
import { createHash } from "node:crypto";
import { getDecisionCatalog } from "../v6/catalog";
import { catalogContentDigest } from "../v6/catalog-review";
import type { CatalogAiReview, CatalogEligibilityRule, CatalogFact, CatalogSource, DecisionCompetitionRecord } from "../v6/catalog-types";
import type { StudentProfileV6 } from "../v6/contracts";
import { canonicalHash } from "../v6/evaluation-contracts";
import { activeStudentFacts } from "../v6/profile";
import { isDecisionEvidenceFact, isEvidenceForRecord } from "../v6/evidence";
import { appendApprovedPublishedWorkFactsV734, isApprovedPublishedWorkFactV734 } from "./published-work-evidence";

export const MATCHING_CATALOG_POLICY_VERSION = "saitu.policy.2026-11-09.v7";

export type OfficialEntry = {
  url: string;
  title: string;
  publisher: string;
  checkedAt: string | null;
  sourceId: string;
  kind: "organizer_website" | "official_host_website" | "official_archive";
};

export type StableAudienceRule = {
  id: string;
  field: "degree" | "major" | "region" | "institution" | "enrolled" | "fullTime";
  operator: "in" | "not_in" | "eq";
  value: string | boolean | string[];
  factIds: string[];
  sourceIds: string[];
  stabilityBasis: "standing_rule" | "multiple_held_editions";
  explanation: string;
};

export type HistoricalEvent = {
  edition: string;
  label: string;
  startDate: string | null;
  endDate: string | null;
  precision: "day" | "month" | "year";
  sourceUrl: string;
  checkedAt: string;
  scope: string;
};

export type MatchingCatalogMetadata = {
  recordId: string;
  coreDigest: string;
  authorAgentId: string;
  officialEntry: (OfficialEntry & { evidenceArtifact: string }) | null;
  lastHeldEvent: HistoricalEvent | null;
  stableAudienceRules: StableAudienceRule[];
  /** Reviewed with the metadata digest; never rewrites a historical core review. */
  stableAudienceEvidence?: { facts: CatalogFact[]; sources: CatalogSource[]; evidenceArtifact: string };
  reviews: { reviewerId: string; runId: string; reviewedAt: string; metadataDigest: string; evidenceArtifact: string; outcome: "approved" | "changes_requested" }[];
};

/** A projection of an actual full-record review, not a newly claimed review. */
export type CoreReviewProjection = {
  recordId: string;
  coreDigest: string;
  originalContentDigest: string;
  review: CatalogAiReview;
};

const officialAuthorities = new Set<CatalogSource["authority"]>(["organizer", "official_host", "university_local"]);
const coreFields = new Set(["task", "track", "deliverables"]);
const meaningful = (value: string) => value.trim().length >= 8 && !/^(待补充|待完善|提升综合能力)[。！!]?$/u.test(value.trim());

function reliableSource(source: CatalogSource): boolean {
  if (!officialAuthorities.has(source.authority) || source.accessStatus !== "body_read" || source.integrity === "requires_recheck" ||
      !meaningful(source.scope) || !meaningful(source.locator) || !source.publisher.trim() || !source.checkedAt || !Number.isFinite(Date.parse(source.checkedAt))) return false;
  try {
    const url = new URL(source.url);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function coreFactSupported(record: DecisionCompetitionRecord, fact: CatalogFact): boolean {
  return fact.kind === "official_fact" && ["historical", "verified_current"].includes(fact.status) &&
    isEvidenceForRecord(record, fact) && isDecisionEvidenceFact(record, fact) &&
    meaningful(fact.text) && meaningful(fact.scope) && fact.sourceIds.length > 0 &&
    new Set(fact.sourceIds).size === fact.sourceIds.length && fact.sourceIds.every(id => record.sources.some(source => source.id === id && reliableSource(source)));
}

function coreEvidence(record: DecisionCompetitionRecord) {
  const facts = record.facts.filter(fact => coreFields.has(fact.field) && coreFactSupported(record, fact));
  const ids = new Set(facts.map(fact => fact.id));
  const sourceIds = new Set(facts.flatMap(fact => fact.sourceIds));
  const claims = (section: "task" | "track" | "deliverables") => (record.sections[section] ?? [])
    .filter(claim => meaningful(claim.text) && claim.kind !== "unknown")
    .map(claim => ({ ...claim, factIds: claim.factIds.filter(id => ids.has(id)) }));
  return { facts, sourceIds, task: claims("task"), track: claims("track"), deliverables: claims("deliverables") };
}

/** Enrollment, registration, dates, review tiers, fees and resources are not pool gates.
 * A later change to those fields does not invalidate an independently checked task. */
export function matchingCoreDigest(record: DecisionCompetitionRecord): string {
  const core = coreEvidence(record);
  const sources = record.sources.filter(source => core.sourceIds.has(source.id)).map(source => {
    const { checkedAt: _checked, retrievedAt: _retrieved, publishedAt: _published, publicationDate: _date, ...stable } = source;
    return stable;
  });
  const facts = core.facts.map(fact => {
    const { checkedAt: _checked, retrievedAt: _retrieved, lastVerifiedAt: _verified, validFrom: _from, validUntil: _until, reviewStatus: _review, status: _status, ...stable } = fact;
    return stable;
  });
  return createHash("sha256").update(JSON.stringify({
    policy: MATCHING_CATALOG_POLICY_VERSION,
    recordId: record.recordId, seriesId: record.seriesId, name: record.name, aliases: record.aliases,
    organizer: record.organizer, track: record.track, scope: record.scope, taskFamily: record.taskFamily,
    summary: record.summary, task: core.task, trackClaims: core.track, deliverables: core.deliverables, facts, sources,
  })).digest("hex");
}

function validReview(record: DecisionCompetitionRecord, review: CatalogAiReview, requiredSourceIds: ReadonlySet<string>): boolean {
  return Boolean(record.review.authorAgentId && review.reviewerId && review.reviewerId !== record.review.authorAgentId &&
    review.runId && review.model && review.evidenceArtifact && Number.isFinite(Date.parse(review.reviewedAt)) &&
    review.method === "independent_source_recheck" && review.outcome === "approved" &&
    requiredSourceIds.size && [...requiredSourceIds].every(id => review.sourceIds.includes(id)) &&
    ["factualSupport", "entityScope", "studentUsefulness", "temporalAccuracy"].every(key => review.checks[key as keyof CatalogAiReview["checks"]] === true) && review.findings.every(finding => finding.resolved));
}

/** Reuse the source recheck already performed for a stricter full-record review. */
export function projectIndependentCoreReviews(record: DecisionCompetitionRecord, reviews: readonly CatalogAiReview[]): CoreReviewProjection[] {
  const fullDigest = catalogContentDigest(record);
  const coreDigest = matchingCoreDigest(record);
  return reviews.filter(review => review.contentDigest === fullDigest).map(review => ({ recordId: record.recordId, coreDigest, originalContentDigest: fullDigest, review }));
}

function independentCoreReviews(record: DecisionCompetitionRecord): CatalogAiReview[] {
  const canonical = (reviewLedger as Record<string, CatalogAiReview[]>)[record.recordId] ?? [];
  const coreDigest = matchingCoreDigest(record);
  const projected = (coreReviewLedger as CoreReviewProjection[]).filter(row => row.recordId === record.recordId && row.coreDigest === coreDigest &&
    row.originalContentDigest === row.review.contentDigest && canonical.some(review => JSON.stringify(review) === JSON.stringify(row.review)));
  const originals = new Set(projected.map(row => row.originalContentDigest));
  const current = projectIndependentCoreReviews(record, canonical);
  // A canonical later/equal-time denial on the reviewed content revokes its projection.
  const reviews = [...projected.map(row => row.review), ...current.map(row => row.review), ...canonical.filter(review => originals.has(review.contentDigest))];
  return reviews.filter(review => !reviews.some(other => other.reviewerId === review.reviewerId && Date.parse(other.reviewedAt) > Date.parse(review.reviewedAt)));
}

export function matchingMetadataDigest(metadata: MatchingCatalogMetadata): string {
  const { reviews: _reviews, ...content } = metadata;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function getMatchingCatalogMetadata(record: DecisionCompetitionRecord): MatchingCatalogMetadata | null {
  const metadata = (metadataLedger as MatchingCatalogMetadata[]).find(row => row.recordId === record.recordId && row.coreDigest === matchingCoreDigest(record));
  if (!metadata) return null;
  const digest = matchingMetadataDigest(metadata);
  const matching = metadata.reviews.filter(review => review.metadataDigest === digest && review.reviewerId && review.reviewerId !== metadata.authorAgentId &&
    review.runId && review.evidenceArtifact && Number.isFinite(Date.parse(review.reviewedAt)));
  const latest = matching.filter(review => !matching.some(other => other.reviewerId === review.reviewerId && Date.parse(other.reviewedAt) > Date.parse(review.reviewedAt)));
  return latest.length && latest.every(review => review.outcome === "approved") ? structuredClone(metadata) : null;
}

function sourceEntryKind(source: CatalogSource): OfficialEntry["kind"] | null {
  if (!reliableSource(source) || source.authority === "university_local") return null;
  const url = new URL(source.url);
  // A university repost or a stored rules PDF is useful evidence, but is not a student-facing contest homepage.
  if (/\.(pdf|rar|zip|docx?)(?:$|\?)/iu.test(url.pathname) || /(?:\.edu\.cn|\.edu\.tw)$/iu.test(url.hostname)) return null;
  if (url.hostname === "github.com") {
    return url.pathname.replace(/\/$/u, "") === "/google/coding-competitions-archive" ? "official_archive" : null;
  }
  return source.authority === "organizer" ? "organizer_website" : "official_host_website";
}

function reviewedOfficialEntry(record: DecisionCompetitionRecord): OfficialEntry | null {
  const selected = getMatchingCatalogMetadata(record)?.officialEntry;
  if (!selected || !selected.title.trim() || !selected.publisher.trim() || !selected.sourceId.trim() ||
      !selected.checkedAt || !Number.isFinite(Date.parse(selected.checkedAt)) || !selected.evidenceArtifact) return null;
  try {
    const url = new URL(selected.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || /\.(pdf|rar|zip|docx?)(?:$|\?)/iu.test(url.pathname)) return null;
    if (selected.kind === "official_archive" && (url.hostname !== "github.com" || url.pathname.replace(/\/$/u, "") !== "/google/coding-competitions-archive")) return null;
  } catch { return null; }
  return { url: selected.url, title: selected.title, publisher: selected.publisher, checkedAt: selected.checkedAt, sourceId: selected.sourceId, kind: selected.kind };
}

export function getOfficialEntry(record: DecisionCompetitionRecord): OfficialEntry | null {
  const selected = reviewedOfficialEntry(record);
  if (selected) return selected;
  const candidates = record.sources.filter(source => sourceEntryKind(source) !== null).sort((a, b) =>
    Number(a.authority !== "organizer") - Number(b.authority !== "organizer") ||
    Date.parse(b.checkedAt!) - Date.parse(a.checkedAt!) || a.id.localeCompare(b.id));
  const source = candidates[0];
  return source ? { url: source.url, title: source.title, publisher: source.publisher, checkedAt: source.checkedAt, sourceId: source.id, kind: sourceEntryKind(source)! } : null;
}

export function inspectMatchingRecord(record: DecisionCompetitionRecord): { eligibleForMatching: boolean; blockers: string[]; coreDigest: string; independentReviewerIds: string[] } {
  const blockers: string[] = [];
  const core = coreEvidence(record);
  if (!record.recordId || !record.seriesId || !record.name.trim() || !record.organizer.trim() || !record.track.id || !record.scope.trim()) blockers.push("core_identity_missing");
  if (!record.sources.some(reliableSource)) blockers.push("reliable_official_evidence_missing");
  if (!reviewedOfficialEntry(record)) blockers.push("independently_reviewed_official_entry_missing");
  if (!meaningful(record.summary) || !core.task.length || !core.facts.some(fact => ["task", "track"].includes(fact.field))) blockers.push("official_task_missing");
  if (!core.deliverables.some(claim => claim.kind === "official_fact" && claim.factIds.length > 0)) blockers.push("official_deliverables_missing");
  const reviews = independentCoreReviews(record);
  const denied = reviews.some(review => review.outcome !== "approved" || review.findings.some(finding => !finding.resolved));
  const approved = denied ? [] : reviews.filter(review => validReview(record, review, core.sourceIds));
  if (!approved.length) blockers.push(denied ? "independent_core_review_changes_requested" : "independent_core_review_missing");
  return { eligibleForMatching: blockers.length === 0, blockers, coreDigest: matchingCoreDigest(record), independentReviewerIds: [...new Set(approved.map(review => review.reviewerId))] };
}

/** Complete v6-shaped records keep archived report rendering compatible. */
export function getMatchingCatalogRecords(): DecisionCompetitionRecord[] {
  return appendApprovedPublishedWorkFactsV734(getDecisionCatalog().filter(record => inspectMatchingRecord(record).eligibleForMatching));
}

function audienceEvidenceRecord(record: DecisionCompetitionRecord, metadata: MatchingCatalogMetadata): DecisionCompetitionRecord | null {
  const evidence = metadata.stableAudienceEvidence;
  if (!evidence) return record;
  if (!evidence.evidenceArtifact || !evidence.facts.length ||
      new Set(evidence.facts.map(fact => fact.id)).size !== evidence.facts.length ||
      new Set(evidence.sources.map(source => source.id)).size !== evidence.sources.length ||
      evidence.facts.some(fact => record.facts.some(existing => existing.id === fact.id)) ||
      evidence.sources.some(source => record.sources.some(existing => existing.id === source.id))) return null;
  const combined = { ...record, facts: [...record.facts, ...evidence.facts], sources: [...record.sources, ...evidence.sources] };
  const usedSources = new Set(evidence.facts.flatMap(fact => fact.sourceIds));
  if (evidence.sources.some(source => !usedSources.has(source.id) || !reliableSource(source)) ||
      evidence.facts.some(fact => !fact.field.startsWith("eligibility.") || !coreFactSupported(combined, fact))) return null;
  return combined;
}

type AudienceConflictNotice = {
  text: string;
  studentFactIds: string[];
  facts: CatalogFact[];
  sources: CatalogSource[];
};

/** Return independently supported standing or repeated-edition conflicts with their own evidence. */
export function getStableAudienceConflictNotices(profile: StudentProfileV6, record: DecisionCompetitionRecord): AudienceConflictNotice[] {
  const metadata = getMatchingCatalogMetadata(record);
  if (!metadata) return [];
  const evidenceRecord = audienceEvidenceRecord(record, metadata);
  if (!evidenceRecord) return [];
  const rules = metadata.stableAudienceRules;
  const conflicts: AudienceConflictNotice[] = [];
  const facts = activeStudentFacts(profile).filter(fact => fact.state === "affirmed" || fact.state === "negated" && typeof fact.value === "boolean");
  const studentEvidence = (field: string) => facts.findLast(fact => fact.field === field);
  for (const rule of rules) {
    const audienceFacts = rule.factIds.map(id => evidenceRecord.facts.find(fact => fact.id === id));
    const sourceIds = new Set(audienceFacts.flatMap(fact => fact?.sourceIds ?? []));
    const expected = Array.isArray(rule.value) ? rule.value : [rule.value];
    if (!rule.factIds.length || new Set(rule.factIds).size !== rule.factIds.length || !rule.sourceIds.length ||
        new Set(rule.sourceIds).size !== rule.sourceIds.length || rule.sourceIds.length !== sourceIds.size || rule.sourceIds.some(id => !sourceIds.has(id)) ||
        !["in", "not_in", "eq"].includes(rule.operator) || rule.stabilityBasis === "multiple_held_editions" && sourceIds.size < 2 ||
        !expected.length || expected.some(value => ["enrolled", "fullTime"].includes(rule.field) ? typeof value !== "boolean" : typeof value !== "string" || !value.trim()) ||
        !meaningful(rule.explanation) || !["standing_rule", "multiple_held_editions"].includes(rule.stabilityBasis) ||
        !audienceFacts.every(fact => fact && (fact.field === `eligibility.${rule.field}` || fact.field.startsWith(`eligibility.${rule.field}.`)) && coreFactSupported(evidenceRecord, fact))) continue;
    let studentFact = studentEvidence(`eligibility.${rule.field}`);
    let actual = studentFact?.value;
    if (actual === undefined && rule.field === "degree") {
      studentFact = studentEvidence("stage");
      const stage = studentFact?.value;
      actual = typeof stage === "string" ? stage.startsWith("undergraduate") ? "undergraduate" : ["master", "doctorate", "vocational"].includes(stage) ? stage : undefined : undefined;
    }
    if (actual === undefined && ["enrolled", "fullTime"].includes(rule.field)) {
      studentFact = studentEvidence("enrollmentStatus");
      const enrollment = studentFact?.value;
      actual = rule.field === "enrolled" ? ["full-time-student", "part-time-student"].includes(String(enrollment)) ? true : enrollment === "graduated" ? false : undefined
        : enrollment === "full-time-student" ? true : ["part-time-student", "graduated"].includes(String(enrollment)) ? false : undefined;
    }
    // Major, institution and region require the exact confirmed field, never a broad subject or inferred location.
    if (!studentFact || actual === undefined) continue;
    const matches = expected.some(item => item === actual || item === "postgraduate" && ["master", "doctorate"].includes(String(actual)));
    if (rule.operator === "not_in" ? !matches : matches) continue;
    for (const fact of audienceFacts) {
      if (!fact || conflicts.some(notice => notice.facts.some(existing => existing.id === fact.id))) continue;
      conflicts.push({
        text: `${fact.text.replace(/[。；]+$/u, "")}。该已核范围与你当前自述的身份有冲突，现届规则请核对官网。`,
        studentFactIds: [studentFact.id],
        facts: [fact],
        sources: evidenceRecord.sources.filter(source => fact.sourceIds.includes(source.id)),
      });
    }
  }
  return conflicts;
}

export function getExplicitAudienceConflictFacts(profile: StudentProfileV6, record: DecisionCompetitionRecord): CatalogFact[] {
  return getStableAudienceConflictNotices(profile, record).flatMap(notice => notice.facts);
}

export function isExplicitAudienceConflict(profile: StudentProfileV6, record: DecisionCompetitionRecord): boolean {
  return getExplicitAudienceConflictFacts(profile, record).length > 0;
}

const degreeLabels = new Map([
  ["high-school", "高中"], ["vocational", "高职高专"], ["undergraduate", "本科"],
  ["master", "硕士"], ["doctorate", "博士"], ["postgraduate", "研究生"],
]);
const postgraduateDegrees = ["master", "doctorate"];
const degreeEvidenceField = (field: string) => field === "eligibility.degree" || field.startsWith("eligibility.degree.");
const uncertainHistoricalScope = /未标届次|混合年代|不(?:证明|认证).{0,16}(?:适用|有效)|适用性.{0,8}(?:待核|未知)|(?:校内|本校)(?:组织|报名|通知)|导师身份.{0,8}(?:另核|待核)|例外须核实|毕业.{0,18}有例外/u;

// Exact unchanged qualification slice independently checked in
// artifacts/accelerate-20261111/E/v745-electronics-scoped-projection.safe.json.
const reviewedHistoricalAudienceProjections = new Map([
  ["f8ea2f211247959366c3583be1d9cb10b14d7dd696b2137206bf452b1568fef8", "746d9ea506b1cb4f330ad407be182d371d0f3014270cab1bc1ae9274302dc029"],
]);

function hasIndependentHistoricalAudienceReview(record: DecisionCompetitionRecord, rule: CatalogEligibilityRule, facts: CatalogFact[], sources: CatalogSource[]): boolean {
  const identity = record.identity;
  if (!identity) return false;
  const { editionId, trackId, groupId, scopeId } = identity;
  // The catalog appends only independently approved published-work observations to the authored record.
  const authoredFacts = record.facts.filter(fact => !isApprovedPublishedWorkFactV734(record, fact));
  const fullDigest = catalogContentDigest({ ...record, facts: authoredFacts });
  const projectionDigest = canonicalHash(JSON.parse(JSON.stringify({
    recordId: record.recordId, identity: { editionId, trackId, groupId, scopeId },
    eligibility: record.sections.eligibility, rule, facts, sources,
  })));
  const reviewedProjection = reviewedHistoricalAudienceProjections.get(projectionDigest);
  const canonical = (reviewLedger as Record<string, CatalogAiReview[]>)[record.recordId] ?? [];
  const matching = canonical.filter(review => review.contentDigest === fullDigest || review.contentDigest === reviewedProjection);
  const latest = matching.filter(review => !matching.some(other => other.reviewerId === review.reviewerId &&
    other.contentDigest === review.contentDigest && Date.parse(other.reviewedAt) > Date.parse(review.reviewedAt)));
  const sourceIds = new Set(sources.map(source => source.id));
  return !latest.some(review => review.outcome !== "approved" || review.findings.some(finding => !finding.resolved)) &&
    latest.some(review => validReview(record, review, sourceIds));
}

/** Compare a confirmed student's degree only with a reviewed rule within its own historical scope. */
export function getScopedAudienceConflictNotices(profile: StudentProfileV6, record: DecisionCompetitionRecord): AudienceConflictNotice[] {
  const editionYear = record.identity?.editionId.match(/(?:^|[-_])((?:19|20)\d{2})(?=$|[-_])/u)?.[1];
  const rules = record.eligibilityRules?.filter(rule => rule.field === "degree" && ["eq", "in", "not_in"].includes(rule.operator));
  if (!editionYear || !rules?.length) return [];
  const confirmed = activeStudentFacts(profile).filter(fact => fact.state === "affirmed");
  const studentDegrees = ["eligibility.degree", "degree", "stage"].flatMap(field => {
    const fact = confirmed.findLast(candidate => candidate.field === field);
    if (!fact || typeof fact.value !== "string") return [];
    const degree = /^undergraduate(?:-[1-4])?$/u.test(fact.value) ? "undergraduate" : fact.value;
    return degreeLabels.has(degree) ? [{ fact, degree }] : [];
  });
  const student = studentDegrees[0];
  if (!student) return [];
  const possibleDegrees = student.degree === "postgraduate" ? postgraduateDegrees : [student.degree];
  if (studentDegrees.some(other => !possibleDegrees.some(degree =>
    other.degree === degree || other.degree === "postgraduate" && postgraduateDegrees.includes(degree)))) return [];
  const notices: AudienceConflictNotice[] = [];
  for (const rule of rules) {
    const expected = Array.isArray(rule.value) ? rule.value : [rule.value];
    if (!expected.length || expected.some(degree => typeof degree !== "string" || !degreeLabels.has(degree)) ||
        !rule.factIds.length || new Set(rule.factIds).size !== rule.factIds.length) continue;
    const conflicts = possibleDegrees.every(degree => {
      const matches = expected.includes(degree) || postgraduateDegrees.includes(degree) && expected.includes("postgraduate");
      return rule.operator === "not_in" ? matches : !matches;
    });
    if (!conflicts) continue;
    const facts = rule.factIds.map(id => record.facts.find(fact => fact.id === id));
    if (!facts.every((fact): fact is CatalogFact => Boolean(fact && fact.status === "historical" &&
      (fact.field === "eligibility" || degreeEvidenceField(fact.field)) && coreFactSupported(record, fact)))) continue;
    const sourceIds = new Set(facts.flatMap(fact => fact.sourceIds));
    const sources = [...sourceIds].map(id => record.sources.find(source => source.id === id));
    if (!sources.every((source): source is CatalogSource => Boolean(source && source.authority !== "university_local" &&
      `${source.scope} ${source.title}`.includes(editionYear)))) continue;
    const scope = [...new Set(sources.map(source => source.scope))].join("；");
    const sourceContext = sources.map(source => `${source.title} ${source.locator}`).join(" ");
    if (uncertainHistoricalScope.test(`${scope} ${sourceContext} ${rule.note} ${facts.map(fact => fact.text).join(" ")}`) ||
        !hasIndependentHistoricalAudienceReview(record, rule, facts, sources)) continue;

    const labels = expected.map(degree => degreeLabels.get(String(degree))).join("、");
    const quotedExclusion = possibleDegrees.every(degree => postgraduateDegrees.includes(degree))
      ? facts.map(fact => fact.text.match(/研究生(?:不能参加|不得参赛)/u)?.[0]).find(Boolean)
      : undefined;
    const clause = sources.length === 1 ? sources[0].locator.match(/第[一二三四五六七八九十百0-9]+条(?=(?:参赛)?资格)/u)?.[0] : undefined;
    const document = sources.length === 1 ? `《${sources[0].title}》${clause ?? ""}` : "所引资料";
    const datedScope = scope.includes(editionYear) ? scope : `${editionYear}年${scope}`;
    const teamQualification = rule.note.includes("按队内最高学历分组") ? rule.note.replace(/[。；]+$/u, "") : undefined;
    const qualification = teamQualification ?? quotedExclusion ??
      (rule.operator === "not_in" ? `${record.group}排除${labels}学段` : `${record.group}的参赛学段范围为${labels}`);
    notices.push({
      text: `按${document}（${datedScope}），${qualification}。你自述的学段与该范围不符，现届资格仍待核。`,
      studentFactIds: [student.fact.id],
      facts,
      sources,
    });
  }
  if (notices.length && getStableAudienceConflictNotices(profile, record).some(notice => notice.facts.some(fact => degreeEvidenceField(fact.field)))) return [];
  return notices;
}

export function getLastHeldEvent(record: DecisionCompetitionRecord): HistoricalEvent | null {
  return getMatchingCatalogMetadata(record)?.lastHeldEvent ?? null;
}

export function getMatchingCatalogSummary() {
  const all = getDecisionCatalog();
  const inspections = all.map(record => ({ record, inspection: inspectMatchingRecord(record) }));
  const matching = inspections.filter(item => item.inspection.eligibleForMatching).map(item => item.record);
  return {
    policyVersion: MATCHING_CATALOG_POLICY_VERSION,
    totalRecords: all.length, totalSeries: new Set(all.map(record => record.seriesId)).size,
    matchingRecords: matching.length, matchingSeries: new Set(matching.map(record => record.seriesId)).size,
    families: Object.fromEntries([...new Set(matching.map(record => record.taskFamily))].sort().map(family => [family, new Set(matching.filter(record => record.taskFamily === family).map(record => record.seriesId)).size])),
    missingCoreOrReviewRecords: inspections.filter(item => !item.inspection.eligibleForMatching).map(item => ({ recordId: item.record.recordId, blockers: item.inspection.blockers })),
  };
}
