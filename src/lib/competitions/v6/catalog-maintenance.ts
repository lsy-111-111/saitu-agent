import legacySemanticTriage from "@/content/competitions-v6/legacy-semantic-triage.json";
import { SUBJECT_DOMAINS, TASK_FAMILIES, type DecisionCompetitionRecord } from "./catalog-types";
import { catalogContentDigest, hasDualAiReview, hasHumanReview } from "./catalog-review";
import { validateDecisionRecord } from "./catalog-validation";

/** Independent series counts; several tracks/editions can never inflate a coverage cell. */
export function catalogCoverageMatrix(records: DecisionCompetitionRecord[]) {
  return SUBJECT_DOMAINS.map(domain => ({
    domain,
    taskFamilies: TASK_FAMILIES.map(taskFamily => {
      const matching = records.filter(record => record.subjectDomains?.includes(domain) && record.taskFamily === taskFamily);
      const decisionReady = matching.filter(record => ["L2", "L3"].includes(record.contentTier));
      return { taskFamily, seriesIds: [...new Set(matching.map(record => record.seriesId))], decisionReadySeriesIds: [...new Set(decisionReady.map(record => record.seriesId))],
        aiReviewedSeriesIds: [...new Set(decisionReady.filter(hasDualAiReview).map(record => record.seriesId))],
        gapReason: decisionReady.length ? null : matching.length ? "已有发现/迁移记录，但关键内容或来源尚不支持L2。" : "当前目录没有具体支持该专业门类与任务交叉的记录；不以泛创新标签凑覆盖。" };
    })
  }));
}

export function buildCatalogMaintenanceReport(records: DecisionCompetitionRecord[], now: Date) {
  const series = [...new Set(records.filter(record => record.migration.origin === "legacy_135").map(record => record.seriesId))];
  return {
    generatedAt: now.toISOString(), scope: "structural_audit_and_evidence_queue_not_independent_fact_verification",
    legacySeries: series.map(seriesId => {
      const items = records.filter(record => record.seriesId === seriesId);
      const semantic = legacySemanticTriage.items.find(item => item.seriesId === seriesId);
      const currentClaims = (items.find(item => item.facts.some(fact => fact.id.includes(":legacy:fact:")))?.facts ?? []).filter(fact => ["eligibility", "team", "fee"].includes(fact.field)).map(({ id, field, text, status, sourceIds }) => ({ id, field, text, status, sourceIds }));
      const semanticClaimsMatch = Boolean(semantic && JSON.stringify(currentClaims) === JSON.stringify(semantic.claimsRead));
      return { seriesId, semanticTriage: semantic ? { checkedAt: semantic.checkedAt, reviewedFields: semantic.reviewedFields,
        finding: semantic.finding, claimDigest: semantic.claimDigest, status: semanticClaimsMatch ? semantic.status : "stale_claims_require_retriage",
        claimsMatch: semanticClaimsMatch, independentReview: false, fullSourceRecheck: false } : null, recordIds: items.map(record => record.recordId),
        status: items.every(hasDualAiReview) ? "ai_dual_reviewed" : items.some(record => record.sources.some(source => source.accessStatus === "body_read")) ? "partially_source_read_pending_review" : "legacy_sources_require_recheck",
        allOriginalSourcesRechecked: items.every(record => record.sources.every(source => source.accessStatus === "body_read" && source.verificationMethod !== "legacy_import")),
        unresolved: items.flatMap(record => validateDecisionRecord(record, now).issues.map(issue => ({ recordId: record.recordId, ...issue }))) };
    }),
    fieldCoverage: Object.fromEntries(["eligibility", "team", "mentor", "fee", "deliverables", "rubric"].map(field => {
      const items = records.map(record => ({ record, facts: record.facts.filter(fact => fact.field === field) }));
      return [field, { recordCount: records.length, withoutFacts: items.filter(item => !item.facts.length).length,
        unknownOrPending: items.filter(item => item.facts.some(fact => ["unknown", "pending_review", "conflicting"].includes(fact.status))).length,
        supported: items.filter(item => item.facts.some(fact => ["verified_current", "historical"].includes(fact.status) && fact.sourceIds.every(id => item.record.sources.some(source => source.id === id && source.accessStatus === "body_read")))).length }];
    })),
    reviewQueue: records.map(record => ({ recordId: record.recordId, seriesId: record.seriesId, tier: record.contentTier,
      digest: catalogContentDigest(record), policy: record.review.policy, aiReviewComplete: hasDualAiReview(record), humanReviewComplete: hasHumanReview(record),
      sources: record.sources.map(source => ({ id: source.id, url: source.url, title: source.title, scope: source.scope, locator: source.locator, accessStatus: source.accessStatus, evidenceArtifact: source.evidenceArtifact ?? null })),
      unknownFacts: record.facts.filter(fact => ["unknown", "pending_review", "conflicting"].includes(fact.status)).map(fact => fact.id),
      deepBlockers: record.deepDive?.missingForPublication ?? ["尚无完整代表任务与官方评分映射。"] })),
    subjectTaskCoverage: catalogCoverageMatrix(records),
    sourcePolicy: "自动读取或摘要绑定只能提供可复核材料，不能自行制造独立审查记录。"
  };
}
