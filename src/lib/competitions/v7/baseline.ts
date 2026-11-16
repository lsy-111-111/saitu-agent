import "server-only";
import { createHash } from "node:crypto";
import type { DecisionContextV6 } from "../v6/engine";
import { claim } from "../v6/engine";
import type { EmbeddingProvider } from "../v6/hybrid-retrieval";
import { rankHybridCandidates, rerankHybridCandidates } from "../v6/hybrid-retrieval";
import { scoreNativeDecision } from "../v6/native-score";
import { activeStudentFacts } from "../v6/profile";
import { rankingDecisionTable } from "../v6/ranking-decision-table";
import { isDecisionEvidenceFact } from "../v6/evidence";
import type { MatchPlanV6 } from "../v6/contracts";
import { validateMatchPlanV7 } from "./model";
import { RECOMMENDATION_MAX_ITEMS } from "./contracts";

export const BASELINE_VERSION_V7 = "saitu-baseline.v7.2.top5.bm25-e5-native90";
export const BASELINE_E5_MODEL_V7 = "Xenova/multilingual-e5-small";
export const BASELINE_E5_REVISION_V7 = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
export type BaselineOptionsV7 = {
  embeddingProvider: EmbeddingProvider & { verifiedAssets?: unknown; executionResource?: unknown };
  /** Exact permutation of the shared C pool, never a recall shortlist. */
  candidateOrder?: readonly string[];
  seed?: string | number;
};

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Evaluation-only B. It consumes the already frozen V7 context, recomputes
 * transparent native dimensions from its adopted self reports, and scores the
 * entire identical pool. It never calls a provider or changes C's ordering. */
export async function buildBaselineMatchPlanV7(context: DecisionContextV6, options: BaselineOptionsV7) {
  if (options.embeddingProvider.model !== BASELINE_E5_MODEL_V7 || options.embeddingProvider.revision !== BASELINE_E5_REVISION_V7) throw new Error("v7_baseline_requires_pinned_local_e5");
  const originalIds = context.candidates.map(candidate => candidate.record.recordId);
  const order = options.candidateOrder ? [...options.candidateOrder] : [...originalIds];
  if (order.length !== originalIds.length || new Set(order).size !== originalIds.length || order.some(id => !originalIds.includes(id))) throw new Error("v7_baseline_requires_same_candidate_pool");
  const index = new Map(context.candidates.map(candidate => [candidate.record.recordId, candidate]));
  const candidates = order.map(id => index.get(id)!);
  const orderedContext = { ...context, candidates };
  // V7 has already adopted submitted self reports. Native fit sees those same
  // active assertions and explicit unknown intervals, with no experience gate.
  const active = activeStudentFacts(context.profile).filter(fact => fact.state === "affirmed");
  const query = active.map(fact => `${fact.field}: ${fact.label} ${JSON.stringify(fact.value)}`).join("\n") || "探索任务与准备路径";
  const tables = rankingDecisionTable(orderedContext);
  const documents = candidates.map((candidate, offset) => {
    const { registration: _registration, milestones: _milestones, eligibility: _eligibility, ...business } = tables[offset];
    void _registration; void _milestones; void _eligibility;
    return { itemId: candidate.record.recordId, text: JSON.stringify({ ...business,
      conditions: candidate.conditions.filter(condition => !/报名|资格|日期|届次|历史/.test(condition)),
      taskEvidence: candidate.record.facts.filter(fact => isDecisionEvidenceFact(candidate.record, fact) && /task|deliverable|skills|rubric|investment|benefit|value/i.test(fact.field)) }) };
  });
  const retrieved = await rankHybridCandidates({ query, documents, embeddingProvider: options.embeddingProvider, skipIndependentRecall: true, rrfK: 60 });
  const fit = candidates.map(candidate => {
    const native = scoreNativeDecision(candidate.record, context.profile);
    return { itemId: candidate.record.recordId, dimensions: native.dimensions, unknowns: native.dimensions.filter(dimension => dimension.lower !== dimension.upper).map(dimension => dimension.name) };
  });
  const ranked = rerankHybridCandidates(retrieved, fit);
  const series = new Set<string>();
  const recommendations: MatchPlanV6["recommendations"] = [];
  for (const row of ranked.scores) {
    const candidate = index.get(row.itemId)!;
    if (series.has(candidate.record.seriesId)) continue;
    series.add(candidate.record.seriesId);
    const dimensionEvidence = fit.find(item => item.itemId === row.itemId)!.dimensions.filter(dimension => dimension.lower > 0);
    const studentFactIds = [...new Set(dimensionEvidence.flatMap(dimension => dimension.studentFactIds))];
    const task = candidate.record.facts.find(fact => ["task", "track", "deliverables"].includes(fact.field) && isDecisionEvidenceFact(candidate.record, fact));
    recommendations.push({ itemId: row.itemId, reasons: [claim("本地基线按固定任务联系与检索分数比较候选。", "suggestion", studentFactIds, task ? [task.id] : [])] });
    if (recommendations.length === RECOMMENDATION_MAX_ITEMS) break;
  }
  const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, recommendations,
    shortfallReason: recommendations.length < RECOMMENDATION_MAX_ITEMS ? `共享候选池只有${series.size}个不同系列，已全部保留；未从池外补足。` : null };
  const validation = validateMatchPlanV7(plan, context);
  if (!validation.ok) throw new Error(`invalid_v7_baseline:${validation.issues.join(";")}`);
  return { plan, diagnostics: {
    schemaVersion: "saitu-baseline-diagnostics.v7", algorithm: "B", baselineVersion: BASELINE_VERSION_V7, providerDispatch: false,
    profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, seed: options.seed ?? null,
    candidatePolicy: "identical_v7_full_core_pool_no_recall_truncation", candidateIds: order, candidateCount: candidates.length,
    excluded: [...context.excluded].map(([itemId, reason]) => ({ itemId, reason })), profileDigest: digest(context.profile),
    query, queryDigest: digest(query), queryPolicy: "same_v7_adopted_active_affirmed_facts; unknown/conditional/negated_not_positive_ability_evidence",
    documents: documents.map(document => ({ itemId: document.itemId, sha256: digest(document.text) })),
    retrieval: { bm25: { k1: 1.2, b: 0.75, tokenizer: "latin_words_cjk_chars_and_bigrams" }, e5: { model: options.embeddingProvider.model, revision: options.embeddingProvider.revision,
      dtype: "q8", inference: "local_cpu", maxLength: 512, pooling: "masked_mean_normalized", verifiedAssets: options.embeddingProvider.verifiedAssets ?? null,
      executionResource: options.embeddingProvider.executionResource ?? null },
      rrfK: 60, recallApplied: ranked.recallApplied, independentRecall: false },
    reranking: { version: ranked.rerankingVersion, weights: ranked.weights, scoreSemantics: ranked.scoreSemantics,
      nativeDimensionsSource: "scoreNativeDecision(record, same_v7_profile); ignores_candidate.nativeScore_and_legacy_eligibility" },
    scores: ranked.scores,
    evidencePacks: candidates.map(candidate => ({ itemId: candidate.record.recordId,
      facts: candidate.record.facts.filter(fact => isDecisionEvidenceFact(candidate.record, fact)), sources: candidate.record.sources })),
    finalItemIds: recommendations.map(item => item.itemId), validation,
  } };
}
