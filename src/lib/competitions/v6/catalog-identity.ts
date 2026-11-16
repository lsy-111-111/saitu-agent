import { createHash } from "node:crypto";
import type { Competition, CompetitionTrackMetadata } from "@/content/competitions";
import { legacyTrackFactOverride, legacyReferenceEntity } from "@/content/competitions-v6/legacy-track-fact-overrides";
import type { DecisionCompetitionRecord, EvidenceDate, SubjectDomain } from "./catalog-types";

const token = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);
export const unknownDate = (): EvidenceDate => ({ raw: null, value: null, precision: "unknown", timezone: null });

/** Preserve the original date precision. A check date does not imply a publication date. */
export function sourceDate(raw: string | null): EvidenceDate {
  if (!raw) return unknownDate();
  const precision = /^\d{4}$/.test(raw) ? "year" : /^\d{4}-\d{2}$/.test(raw) ? "month" : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? "day" : /T.*(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? "instant" : "unknown";
  return { raw, value: precision === "unknown" ? null : raw, precision, timezone: precision === "instant" ? raw.endsWith("Z") ? "UTC" : raw.slice(-6) : null };
}

/** Editorial subject coverage; never used as a hard major/eligibility rule. */
export function inferSubjectDomains(record: DecisionCompetitionRecord): SubjectDomain[] {
  const text = `${record.name} ${record.subjectTags.join(" ")}`;
  const matches: [SubjectDomain, RegExp][] = [
    ["philosophy", /哲学|伦理/], ["economics", /经济|金融|税收|finance|accounting/],
    ["law", /法庭|法律|法学|仲裁|公共管理|公共关系|社会工作/], ["education", /教学|教育|师范|体育/],
    ["literature", /英语|语言|诵|翻译|口译|新闻|文案|文学|language/], ["history", /历史|文博|史料|考古/],
    ["science", /数学|物理|化学|地质|地理|生物|生命科学|建模|math|physics|chemistry|biology|geoscience/],
    ["engineering", /工程|电子|计算机|软件|机械|设计建造|建筑|机器人|安全|芯片|物联网|科技|engineering|construction|systems/],
    ["agriculture", /农业|农学|植物|乡村|园林|agriculture/], ["medicine", /医学|药学|制药|药苑|护理|medicine/],
    ["management", /管理|商业|经营|创业|商务|物流|职业规划|business|finance/],
    ["arts", /艺术|广告|设计|创意|美术|音乐|design|visual/], ["interdisciplinary", /跨学科|交叉学科/]
  ];
  return matches.filter(([,pattern]) => pattern.test(text)).map(([domain]) => domain);
}

export function bindRecordIdentity(record: DecisionCompetitionRecord): DecisionCompetitionRecord {
  const previousId = record.recordId;
  record.identity ??= {
    editionId: `edition-${token(record.edition)}`, trackId: record.track.id,
    groupId: `group-${token(record.group)}`, scopeId: `scope-${token(record.scope)}`,
    stageIds: [], supersedesRecordIds: [], legacyRecordIds: [previousId]
  };
  const entity = record.identity;
  record.recordId = `${record.seriesId}:${entity.editionId}:${entity.trackId}:${entity.groupId}:${entity.scopeId}:v3`;
  record.subjectDomains ??= inferSubjectDomains(record);
  record.stages ??= [];
  record.milestones ??= [];
  record.sources = record.sources.map(source => ({
    ...source, retrievedAt: source.retrievedAt ?? null,
    publicationDate: source.publicationDate ?? sourceDate(source.publishedAt), integrity: source.integrity ?? "unassessed"
  }));
  record.facts = record.facts.map(fact => ({
    ...fact, entity: legacyReferenceEntity(record.seriesId, record.track.id, fact.id) ?? fact.entity ?? { editionId: entity.editionId, trackId: entity.trackId, groupId: entity.groupId, scopeId: entity.scopeId },
    validFrom: fact.validFrom ?? unknownDate(), validUntil: fact.validUntil ?? unknownDate(),
    retrievedAt: fact.retrievedAt ?? null, lastVerifiedAt: fact.lastVerifiedAt ?? fact.checkedAt,
    reviewStatus: fact.reviewStatus ?? "pending_review"
  }));
  record.review.policy = "ai_dual_review";
  record.review.authorAgentId ??= "catalog-author-v6";
  record.review.humanReview ??= { status: "not_performed", reviewerIds: [], reviewedAt: null };
  record.review.aiReviews ??= [];
  return record;
}

/** Track metadata survives migration verbatim as an audit artifact, never promoted to freshly verified facts. */
export function migrateLegacyTrack(base: DecisionCompetitionRecord, competition: Competition, track: CompetitionTrackMetadata): DecisionCompetitionRecord {
  const record = structuredClone(base);
  record.recordId = `${competition.id}:${track.id}:v2`;
  record.track = { id: track.id, name: track.label };
  record.summary = track.taskSummary ?? `${track.label}：${base.summary}`;
  record.sections.task = [{ text: record.summary, kind: "editorial_inference", factIds: [], conditions: [] }];
  record.sections.track = [{ text: `旧目录记载${track.label}；已保留原始赛道合同，尚待逐项核验本届原文，不能借用相邻赛道的资格。`, kind: "unknown", factIds: [], conditions: [], unknownReason: "这是原始赛道结构迁移，不是新一轮事实核验。" }];
  if (track.document) record.sources.push({ id: `${competition.id}:${track.id}:legacy-document`, url: track.document.url, title: track.document.title, publisher: "旧赛道文件所列发布方待复核", authority: "other", scope: track.document.scope, checkedAt: null, publishedAt: null, accessStatus: "imported_unrechecked", locator: "旧目录赛道document字段；正文定位待核验", verificationMethod: "legacy_import" });
  record.skills = [...(track.skills ?? record.skills)];
  record.subjectTags = [...(track.subjects ?? record.subjectTags)];
  record.migration.legacyTrack = structuredClone(track);
  const correction = legacyTrackFactOverride(competition.id, track.id);
  if (correction) {
    record.edition = correction.edition;
    record.group = correction.group;
    record.scope = correction.scope;
    for (const [field, text] of Object.entries(correction.facts)) {
      const fact = record.facts.find(item => item.id === `${competition.id}:legacy:fact:${field}`);
      if (!fact || !text) throw new Error("Missing imported fact for scoped correction");
      const cited = [...text.matchAll(/〔(\d+)〕/g)].map(match => `${competition.id}:legacy:source:${match[1]}`);
      if (cited.some(id => !record.sources.some(source => source.id === id))) throw new Error("Missing source for scoped correction");
      const unresolved = /待核|待确认|未核|不明/.test(text);
      Object.assign(fact, { text, kind: unresolved ? "unknown" : "official_fact", status: unresolved ? "unknown" : "pending_review", sourceIds: cited, scope: correction.scope });
      // Source-scope correction precedes binding this exact track's identity.
      delete fact.entity;
      fact.sourceScopes = cited.map(id => ({ sourceId: id, scope: record.sources.find(source => source.id === id)!.scope }));
      if (field === "eligibility" || field === "fee") {
        const sectionName = field === "fee" ? "investment" : "eligibility";
        record.sections[sectionName] = [{ text, kind: fact.kind, factIds: [fact.id], conditions: [], ...(unresolved ? { unknownReason: text } : {}) }];
      }
    }
  }
  return record;
}
