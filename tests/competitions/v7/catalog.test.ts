import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogAiReview } from "@/lib/competitions/v6/catalog-types";
import type { MatchingCatalogMetadata } from "@/lib/competitions/v7/catalog";

const { ledger, metadata } = vi.hoisted(() => ({ ledger: {} as Record<string, CatalogAiReview[]>, metadata: [] as MatchingCatalogMetadata[] }));
vi.mock("@/content/competitions-v6/ai-review-ledger.json", async importOriginal => {
  const actual = await importOriginal<{ default: Record<string, CatalogAiReview[]> }>();
  Object.assign(ledger, structuredClone(actual.default));
  return { default: ledger };
});
vi.mock("@/content/competitions-v6/catalog-metadata-v7.json", async importOriginal => {
  const actual = await importOriginal<{ default: MatchingCatalogMetadata[] }>();
  metadata.push(...structuredClone(actual.default));
  return { default: metadata };
});

import { getDecisionCatalog } from "@/lib/competitions/v6/catalog";
import { catalogContentDigest } from "@/lib/competitions/v6/catalog-review";
import { createStudentProfile } from "@/lib/competitions/v6/profile";
import { decisionRecordHref, resolvePublishedDecisionRoute } from "@/lib/competitions/v6/public-catalog";
import { getLastHeldEvent, getMatchingCatalogMetadata, getMatchingCatalogRecords, getMatchingCatalogSummary, getOfficialEntry, getScopedAudienceConflictNotices, getStableAudienceConflictNotices, inspectMatchingRecord, isExplicitAudienceConflict, matchingCoreDigest, matchingMetadataDigest } from "@/lib/competitions/v7/catalog";
import { buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import { rankTaskFactsV7 } from "@/lib/competitions/v7/rank-packet";
import { matchReasonAnchorFactsV7 } from "@/lib/competitions/v7/reason-anchor";
import { student } from "../v6/decision-fixtures";

const baseline = structuredClone(ledger);
const baselineMetadata = structuredClone(metadata);
const record = () => getMatchingCatalogRecords().find(item => item.seriesId === "national-college-math-modeling")!;
afterEach(() => {
  Object.keys(ledger).forEach(key => delete ledger[key]);
  Object.assign(ledger, structuredClone(baseline));
  metadata.splice(0, metadata.length, ...structuredClone(baselineMetadata));
});

describe("v7 independently verified core catalog", () => {
  it("integrates the actual detached 45-series candidate across all nine task families", () => {
    const summary = getMatchingCatalogSummary();
    expect(summary).toMatchObject({ totalRecords: 273, totalSeries: 167, matchingRecords: 45, matchingSeries: 45 });
    expect(Object.keys(summary.families)).toHaveLength(9);
    expect(new Set(getMatchingCatalogRecords().map(item => item.recordId)).size).toBe(45);
    expect(getDecisionCatalog().length).toBe(273);
  });

  it("keeps Formula Student case facts in scope and table 7.2 as scoring context", () => {
    const recordId = "formula-student-china:2026-fscc:cost-manufacturing:university-combustion:china-2026-fscc-cost:v3";
    const item = resolvePublishedDecisionRoute(encodeURIComponent(recordId))!;
    const rubric = item.facts.find(fact => fact.id === "formula-student-china:v2:rubric")!;
    const track = item.facts.find(fact => fact.id === "formula-student-china:v2:track")!;

    expect(item).toMatchObject({ recordId, contentTier: "L3", deepDive: { status: "reviewed" }, publication: { productionReady: true } });
    expect(decisionRecordHref(item.recordId)).toBe(`/competitions/records/${encodeURIComponent(recordId)}`);
    expect(getOfficialEntry(item)?.url).toBe("https://www.formulastudent.cn/");
    expect(rubric.sourceIds).toEqual(["fsc-2026-rules-cost"]);
    expect(rubric.text).toContain("现场比赛日/制造流程40分");
    expect(rubric.text).not.toMatch(/扩产|性能优化|追加投入/);
    expect(track.sourceIds).toEqual(["fsc-2026-rules-cost", "fsc-2026-cost-case"]);
    expect(rankTaskFactsV7(item).map(fact => fact.id)).toContain(track.id);
    expect(rankTaskFactsV7(item).map(fact => fact.id)).not.toContain(rubric.id);
  });

  it("keeps the official special education theme and the archived lesson distinct at the saved record route", () => {
    const recordId = "ncyu-special-education-demonstration:2016-2017-105:reading-lesson-design:pre-service-teachers:taiwan-105-special-education:v3";
    const item = resolvePublishedDecisionRoute(encodeURIComponent(recordId))!;
    const track = item.facts.find(fact => fact.id === "ncyu-special-education-demonstration:v2:track");

    expect(item).toMatchObject({
      recordId, contentTier: "L3", publication: { productionReady: true },
      track: { id: "reading-lesson-design", name: "特教教学设计（阅读与识字为公开作品案例）" },
      deepDive: { status: "reviewed", workedExample: { sourceIds: ["teach-d2-2017-rules", "teach-d2-official-work", "teach-d2-roaming-lesson"] } },
    });
    expect(track).toMatchObject({ sourceIds: ["teach-d2-2017-rules"], text: "教学以普通教育课纲调整及特殊需求为主题，包含资优、身心障碍或学前特殊教育的教学活动设计。" });
    expect(item.deepDive?.workedExample.sourceBoundary).toContain("教案第14—17页的第三节40分钟方案");
    expect(item.facts.find(fact => fact.id === "ncyu-special-education-demonstration:material:v734:lesson-design-structure")?.sourceIds).toEqual(["teach-d2-roaming-lesson"]);
    expect(decisionRecordHref(item.recordId)).toBe(`/competitions/records/${encodeURIComponent(recordId)}`);
    expect(getOfficialEntry(item)?.url).toBe("https://www.ncyu.edu.tw/cset/");
  });

  it("exposes the historical Saxon Bowl task while keeping the original CUPT role evidence", () => {
    const seriesId = "china-undergraduate-physics-tournament";
    const recordId = `${seriesId}:2020-rules:physics-fight:undergraduate:china-historical-2020:v3`;
    const item = resolvePublishedDecisionRoute(encodeURIComponent(recordId))!;
    const taskId = `${seriesId}:v2:task`;
    const rulesId = `${seriesId}:v2:deliverables`;

    expect(item).toMatchObject({ recordId, contentTier: "L3", publication: { productionReady: true } });
    expect(item.roles.map(role => role.factIds)).toEqual([[rulesId], [rulesId]]);
    expect(item.sections.skills.map(claim => claim.factIds)).toEqual([[rulesId], [rulesId]]);
    expect(rankTaskFactsV7(item).map(fact => fact.id)).toContain(taskId);
    expect(matchReasonAnchorFactsV7(item).find(fact => fact.id === taskId)).toMatchObject({
      kind: "official_fact", status: "historical", sourceIds: ["iypt-2020-problem6"],
      text: expect.stringContaining("Saxon Bowl"),
    });
    expect(getOfficialEntry(item)?.url).toBe("https://pt.nankai.edu.cn/cupt/");
  });

  it.each([
    ["apple-swift-student-challenge", "voiceover-input-feedback", "swift-accessibility-2025-full"],
    ["cfa-research-challenge", "dom-development-valuation-basis", "b-cfa-report"],
    ["igem-collegiate", "hkust-structure-prediction-scope", "igem-2025-hkust-model"],
  ])("makes %s's checked author case available to ranking and explanation", (seriesId, suffix, sourceId) => {
    const item = getMatchingCatalogRecords().find(row => row.seriesId === seriesId)!;
    const factId = `${seriesId}:material:v734:${suffix}`;

    expect(rankTaskFactsV7(item).map(fact => fact.id)).toContain(factId);
    expect(matchReasonAnchorFactsV7(item).find(fact => fact.id === factId)).toMatchObject({
      kind: "participant_report", status: "historical", sourceIds: [sourceId],
    });
    expect(item.sources.find(source => source.id === sourceId)?.authority).toBe("other");
    expect(getDecisionCatalog().find(row => row.recordId === item.recordId)?.facts.some(fact => fact.id === factId)).toBe(false);
  });

  it("keeps checked core tasks when enrollment, dates, registration and L3 detail are unknown", () => {
    const item = record();
    const digest = matchingCoreDigest(item);
    item.registration = { status: "unknown", checkedAt: null, factIds: [], note: "报名未知" };
    item.eligibilityRules = [];
    item.facts = item.facts.filter(fact => !fact.field.startsWith("eligibility"));
    item.sections.eligibility = [{ text: "当前具体报名资格未核实，须在官方入口查看。", kind: "unknown", factIds: [], conditions: [], unknownReason: "当前资格未核实" }];
    item.milestones = [];
    item.deepDive = undefined;
    item.contentTier = "L1";
    item.publication.productionReady = false;
    expect(matchingCoreDigest(item)).toBe(digest);
    expect(inspectMatchingRecord(item).eligibleForMatching).toBe(true);
  });

  it("requires one actual independent source recheck for ordinary core information", () => {
    const item = record();
    const approved = ledger[item.recordId].find(review => review.outcome === "approved" && review.contentDigest === catalogContentDigest(item))!;
    ledger[item.recordId] = [approved];
    expect(inspectMatchingRecord(item).eligibleForMatching).toBe(true);
    ledger[item.recordId] = [];
    expect(inspectMatchingRecord(item).eligibleForMatching).toBe(false);
  });

  it("keeps entries with pending or revoked official-homepage review in the directory only", () => {
    const item = record();
    const entry = metadata.find(row => row.recordId === item.recordId)!;
    entry.reviews = [];
    expect(inspectMatchingRecord(item).blockers).toContain("independently_reviewed_official_entry_missing");
    expect(getMatchingCatalogRecords().some(row => row.recordId === item.recordId)).toBe(false);
    expect(getDecisionCatalog().some(row => row.recordId === item.recordId)).toBe(true);
    approve(entry);
    expect(inspectMatchingRecord(item).eligibleForMatching).toBe(true);
    entry.reviews.push({ ...entry.reviews[0], reviewedAt: "2099-01-01T00:00:00Z", outcome: "changes_requested" });
    expect(inspectMatchingRecord(item).eligibleForMatching).toBe(false);
  });

  it("honors a later source-review denial and refuses caller self-approval or changed tasks", () => {
    const item = record();
    const approved = ledger[item.recordId].find(review => review.outcome === "approved" && review.contentDigest === catalogContentDigest(item))!;
    ledger[item.recordId].push({ ...approved, reviewedAt: "2099-01-01T00:00:00Z", outcome: "changes_requested", findings: [{ id: "test-denial", severity: "major", description: "Synthetic isolated denial", resolved: false }] });
    expect(inspectMatchingRecord(item).eligibleForMatching).toBe(false);
    ledger[item.recordId] = structuredClone(baseline[item.recordId]);
    item.summary += "新增未经独立核实的任务。";
    item.review.status = "ai_dual_reviewed";
    item.publication.productionReady = true;
    expect(inspectMatchingRecord(item).eligibleForMatching).toBe(false);
  });

  it("rejects unavailable evidence and cross-track core facts", () => {
    const item = record();
    item.sources.forEach(source => source.accessStatus = "unavailable");
    expect(inspectMatchingRecord(item).blockers).toContain("official_task_missing");
    const other = record();
    other.facts.filter(fact => ["track", "task", "deliverables"].includes(fact.field)).forEach(fact => {
      if (fact.entity) fact.entity.trackId = "another-track";
    });
    expect(inspectMatchingRecord(other).eligibleForMatching).toBe(false);
  });

  it("keeps source documents distinct from verified contest landing pages", () => {
    const item = record();
    item.sources = [{ ...item.sources[0], authority: "university_local", accessStatus: "body_read", url: "https://example.edu.cn/old-notice.pdf", locator: "历史通知的正文位置", scope: "某学校的历史校内通知范围" }];
    expect(getOfficialEntry(item)).toBeNull();
  });

  it("never treats a GitHub task PDF or directory as the official archive landing page", () => {
    const item = record();
    const source = { ...item.sources[0], authority: "organizer" as const, accessStatus: "body_read" as const };
    item.sources = [{ ...source, url: "https://github.com/google/coding-competitions-archive/blob/main/codejam/2022/qualification_round/3d_printing/analysis.pdf" }];
    expect(getOfficialEntry(item)).toBeNull();
    item.sources = [{ ...source, url: "https://github.com/google/coding-competitions-archive/tree/main/codejam/2022" }];
    expect(getOfficialEntry(item)).toBeNull();
    item.sources = [{ ...source, url: "https://github.com/google/coding-competitions-archive/" }];
    expect(getOfficialEntry(item)).toMatchObject({ kind: "official_archive", url: "https://github.com/google/coding-competitions-archive/" });
  });
});

function reviewedMetadata(item: ReturnType<typeof record>): MatchingCatalogMetadata {
  const entry: MatchingCatalogMetadata = { recordId: item.recordId, coreDigest: matchingCoreDigest(item), authorAgentId: "/test/author", officialEntry: { url: "https://www.mcm.edu.cn/", title: "合成入口标定测试", publisher: "合成测试", checkedAt: "2026-11-09", sourceId: "test-landing", kind: "organizer_website", evidenceArtifact: "test-fixture-only" }, lastHeldEvent: null, stableAudienceRules: [], reviews: [] };
  return entry;
}
function approve(entry: MatchingCatalogMetadata) {
  entry.reviews = [{ reviewerId: "/test/independent-reviewer", runId: "test-only", reviewedAt: "2026-11-09T00:00:00Z", metadataDigest: matchingMetadataDigest(entry), evidenceArtifact: "test-fixture-only", outcome: "approved" }];
  const index = metadata.findIndex(row => row.recordId === entry.recordId);
  if (index >= 0) metadata.splice(index, 1);
  metadata.push(entry);
}

describe("explicit audience and historical metadata", () => {
  it("never infers an audience exclusion from historical/current registration qualification alone", () => {
    const item = record();
    approve(reviewedMetadata(item));
    expect(isExplicitAudienceConflict(createStudentProfile(student({ stage: "master" })), item)).toBe(false);
    expect(getLastHeldEvent(item)).toBeNull();
    expect(inspectMatchingRecord(item).eligibleForMatching).toBe(true);
  });

  it("requires independently reviewed metadata and exact confirmed user evidence for stable audience conflicts", () => {
    const item = record();
    const source = item.sources.find(source => source.accessStatus === "body_read")!;
    item.facts.push({ id: "test-audience", field: "eligibility.degree.test-standing-audience", text: "合成测试限制：只限在校本科生。", kind: "official_fact", status: "historical", sourceIds: [source.id], scope: source.scope, checkedAt: source.checkedAt, supersedes: [], conflictsWith: [], entity: item.identity ? { editionId: item.identity.editionId, trackId: item.identity.trackId, groupId: item.identity.groupId, scopeId: item.identity.scopeId } : undefined });
    const entry = reviewedMetadata(item);
    entry.stableAudienceRules = [{ id: "test-degree", field: "degree", operator: "in", value: ["undergraduate"], factIds: ["test-audience"], sourceIds: [source.id], stabilityBasis: "standing_rule", explanation: "合成测试专用的常设人群限制证据。" }];
    metadata.splice(0, metadata.length, entry);
    const graduate = createStudentProfile(student({ stage: "master" }));
    expect(isExplicitAudienceConflict(graduate, item)).toBe(false);
    metadata.splice(0); approve(entry);
    expect(isExplicitAudienceConflict(graduate, item)).toBe(true);
    graduate.facts.forEach(fact => fact.confirmed = false);
    expect(isExplicitAudienceConflict(graduate, item)).toBe(false);
    entry.officialEntry!.url += "changed";
    expect(getMatchingCatalogMetadata(item)).toBeNull();
  });

  it("prefers a specifically reviewed official landing page over a recently fetched document", () => {
    const item = record();
    const entry = reviewedMetadata(item); approve(entry);
    expect(getOfficialEntry(item)?.url).toBe("https://www.mcm.edu.cn/");
  });

  it("does not admit reviewed metadata that labels a document or unsafe URL as a homepage", () => {
    const item = record();
    const entry = reviewedMetadata(item);
    entry.officialEntry!.url = "https://www.mcm.edu.cn/historical-rules.pdf";
    approve(entry);
    expect(inspectMatchingRecord(item).blockers).toContain("independently_reviewed_official_entry_missing");
    entry.officialEntry!.url = "javascript:alert(1)";
    approve(entry);
    expect(inspectMatchingRecord(item).eligibleForMatching).toBe(false);
  });

  it("requires exact fact fields, source closure and record identity for metadata audience evidence", () => {
    const item = record();
    const entry = reviewedMetadata(item);
    const source = { ...item.sources.find(source => source.accessStatus === "body_read")!, id: "test-metadata-source" };
    entry.stableAudienceEvidence = { evidenceArtifact: "test-fixture-only", sources: [source], facts: [{ id: "test-metadata-fact", field: "eligibility.degree.test-standing", text: "合成测试仅排研究生学生参赛身份。", kind: "official_fact", status: "historical", sourceIds: [source.id], sourceScopes: [{ sourceId: source.id, scope: source.scope }], scope: source.scope, checkedAt: source.checkedAt, supersedes: [], conflictsWith: [], entity: item.identity ? { editionId: item.identity.editionId, trackId: item.identity.trackId, groupId: item.identity.groupId, scopeId: item.identity.scopeId } : undefined }] };
    entry.stableAudienceRules = [{ id: "test-metadata-degree", field: "degree", operator: "not_in", value: ["master", "doctorate"], factIds: ["test-metadata-fact"], sourceIds: [source.id], stabilityBasis: "standing_rule", explanation: "合成测试专用的常设学生身份限制。" }];
    const graduate = createStudentProfile(student({ stage: "master" }));
    approve(entry);
    expect(isExplicitAudienceConflict(graduate, item)).toBe(true);
    const fact = entry.stableAudienceEvidence.facts[0];
    fact.field = "eligibility.major.test-standing";
    approve(entry);
    expect(isExplicitAudienceConflict(graduate, item)).toBe(false);
    fact.field = "eligibility.degree.test-standing";
    fact.entity!.trackId = "another-track";
    approve(entry);
    expect(isExplicitAudienceConflict(graduate, item)).toBe(false);
    fact.entity!.trackId = item.identity!.trackId;
    entry.stableAudienceRules[0].sourceIds.push("unrelated-source");
    approve(entry);
    expect(isExplicitAudienceConflict(graduate, item)).toBe(false);
    entry.stableAudienceRules[0].sourceIds = [source.id];
    source.accessStatus = "unavailable";
    approve(entry);
    expect(isExplicitAudienceConflict(graduate, item)).toBe(false);
  });
});

describe("source-bound historical qualification reminders", () => {
  it.each([
    ["national-college-math-modeling", "2023章程", ["cumcm-c-charter"]],
    ["china-undergraduate-physics-tournament", "2020全国规则", ["cupt-2020-rules"]],
    ["china-college-computer-design", "2026本科资格", ["4c-c2-national"]],
    ["mathorcup", "2026春季资格", ["mathorcup-c6-notice", "mathorcup-c6-rules"]],
    ["national-college-electronic-design", "2025全国主赛资格", ["electronics-2025-main-notice"]],
  ])("cites the exact scope and evidence for %s", (seriesId, scope, sourceIds) => {
    const item = getMatchingCatalogRecords().find(row => row.seriesId === seriesId)!;
    const profile = createStudentProfile(student({ stage: "doctorate" }));
    const degree = profile.facts.find(fact => fact.field === "stage")!;
    const notices = getScopedAudienceConflictNotices(profile, item);
    expect(notices).toHaveLength(1);
    const [notice] = notices;
    expect(notice.text).toContain(scope);
    expect(notice.text).toContain("现届资格仍待核");
    expect(notice.studentFactIds).toEqual([degree.id]);
    expect(notice.sources.map(source => source.id)).toEqual(sourceIds);
    expect(notice.facts.flatMap(fact => fact.sourceIds)).toEqual(sourceIds);
    if (seriesId === "national-college-math-modeling") {
      expect(notice.text).toContain("第三条");
      expect(notice.text).toContain("研究生不能参加");
    }
  });

  it("requires an affirmed direct degree and a matching independent eligibility review", () => {
    const profile = createStudentProfile(student({ stage: "doctorate" }));
    const stage = profile.facts.find(fact => fact.field === "stage")!;
    stage.field = "degree";
    expect(getScopedAudienceConflictNotices(profile, record())).toHaveLength(1);
    profile.facts.push({ ...stage, id: "conflicting-stage", field: "stage", value: "undergraduate-4" });
    expect(getScopedAudienceConflictNotices(profile, record())).toEqual([]);
    profile.facts.pop();
    stage.state = "conditional";
    expect(getScopedAudienceConflictNotices(profile, record())).toEqual([]);
    stage.state = "affirmed";
    profile.retractedFactIds.push(stage.id);
    expect(getScopedAudienceConflictNotices(profile, record())).toEqual([]);
    profile.retractedFactIds.pop();

    const item = getMatchingCatalogRecords().find(row => row.seriesId === "national-college-electronic-design")!;
    const fact = item.facts.find(value => value.field === "eligibility" && value.sourceIds.includes("electronics-2025-main-notice"))!;
    fact.text += " 这里不是已复核的条文。";
    expect(getScopedAudienceConflictNotices(profile, item)).toEqual([]);
  });

  it("discloses MathorCup's team-level D problem rule while accepting the vocational category", () => {
    const item = getMatchingCatalogRecords().find(row => row.seriesId === "mathorcup")!;
    const profile = createStudentProfile(student({ stage: "doctorate" }));
    const [notice] = getScopedAudienceConflictNotices(profile, item);
    expect(notice.text).toContain("按队内最高学历分组");
    expect(notice.text).toContain("专科组均可选D题");
    expect(notice.text).toContain("研究生组和教师组只能选A或B题");
    expect(getScopedAudienceConflictNotices(createStudentProfile(student({ stage: "vocational" })), item)).toEqual([]);
    const stage = profile.facts.find(fact => fact.field === "stage")!;
    stage.field = "degree";
    stage.value = "high-school";
    expect(getScopedAudienceConflictNotices(profile, item)).toHaveLength(1);
  });

  it("leaves unclear history and campus scope unresolved and uses one cited stable rule when available", () => {
    const profile = createStudentProfile(student({ stage: "doctorate" }));
    const rows = getMatchingCatalogRecords();
    for (const seriesId of ["biomod", "national-college-mathematics", "comap-mcm-icm"]) {
      expect(getScopedAudienceConflictNotices(profile, rows.find(row => row.seriesId === seriesId)!)).toEqual([]);
    }
    const comap = rows.find(row => row.seriesId === "comap-mcm-icm")!;
    const [stable] = getStableAudienceConflictNotices(profile, comap);
    expect(stable.studentFactIds).toEqual([profile.facts.find(fact => fact.field === "stage")!.id]);
    expect(stable.sources.map(source => source.id)).toEqual(stable.facts[0].sourceIds);
    expect(stable.sources).toHaveLength(2);
    expect(getScopedAudienceConflictNotices(createStudentProfile(student()), record())).toEqual([]);
  });
});

describe("actual independently reviewed stable audience boundaries", () => {
  it("identifies COMAP's verified postgraduate rule and keeps the task eligible for matching", () => {
    const item = getMatchingCatalogRecords().find(row => row.seriesId === "comap-mcm-icm")!;
    expect(isExplicitAudienceConflict(createStudentProfile(student({ stage: "master" })), item)).toBe(true);
    expect(isExplicitAudienceConflict(createStudentProfile(student({ stage: "doctorate" })), item)).toBe(true);
    expect(isExplicitAudienceConflict(createStudentProfile(student({ stage: "vocational" })), item)).toBe(false);
    const unknown = createStudentProfile(student({ stage: "master" }));
    unknown.facts.forEach(fact => fact.confirmed = false);
    expect(isExplicitAudienceConflict(unknown, item)).toBe(false);
    const explicit = buildDecisionContextV7(undefined, { profile: createStudentProfile(student({ stage: "master" })), records: [item] });
    expect(explicit.excluded.size).toBe(0);
    expect(explicit.candidates[0].conditions[0]).toMatch(/^参赛提醒：.*2026.*高中及大学本科.*现届规则请核对官网/);
    const uncertain = buildDecisionContextV7(undefined, { profile: unknown, records: [item] });
    expect(uncertain.candidates[0].conditions.some(note => note.startsWith("参赛提醒："))).toBe(false);
  });

  it("uses Yau's two held editions without treating BIOMOD's mentor role as a degree conflict", () => {
    const rows = getMatchingCatalogRecords();
    const graduate = createStudentProfile(student({ stage: "master" }));
    const yau = rows.find(row => row.seriesId === "yau-college-mathematics")!;
    expect(isExplicitAudienceConflict(graduate, yau)).toBe(true);
    const alumnus = createStudentProfile(student({ stage: "undergraduate-4", enrollmentStatus: "graduated", confirmedFields: ["stage"], confirmedFacts: ["enrollmentStatus"] }));
    expect(isExplicitAudienceConflict(alumnus, yau)).toBe(true);
    expect(isExplicitAudienceConflict(createStudentProfile(student()), yau)).toBe(false);
    expect(isExplicitAudienceConflict(graduate, rows.find(row => row.seriesId === "biomod")!)).toBe(false);
  });
});
