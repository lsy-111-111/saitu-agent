/** Offline strong baseline: multilingual lexical BM25 + exact E5 cosine + RRF.
 * Eligibility is deliberately outside this module. Only inject audited candidates.
 */
export type RetrievalDocument = { itemId: string; text: string };
export type EmbeddingProvider = {
  model: string;
  revision: string;
  embed: (texts: string[]) => Promise<number[][]>;
};
export type HybridOptions = {
  query: string;
  documents: readonly RetrievalDocument[];
  embeddingProvider: EmbeddingProvider;
  /** E2 must set this: all supplied candidates are scored; no recall truncation. */
  skipIndependentRecall?: boolean;
  recallPerChannel?: number;
  rrfK?: number;
};

/** Words plus CJK characters/bigrams avoid a whitespace-only Chinese baseline. */
export function retrievalTokens(text: string): string[] {
  const normalized = text.normalize("NFKC").toLocaleLowerCase("en");
  const words = normalized.match(/[a-z0-9]+/g) ?? [];
  const chinese = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  return [...words, ...chinese.flatMap(run => {
    const chars = [...run];
    return [...chars, ...chars.slice(1).map((char, i) => chars[i] + char)];
  })];
}

export function bm25Scores(query: string, documents: readonly RetrievalDocument[], k1 = 1.2, b = 0.75): number[] {
  const terms = [...new Set(retrievalTokens(query))];
  const tokens = documents.map(doc => retrievalTokens(doc.text));
  const frequencies = tokens.map(row => {
    const counts = new Map<string, number>();
    for (const term of row) counts.set(term, (counts.get(term) ?? 0) + 1);
    return counts;
  });
  const averageLength = tokens.reduce((sum, row) => sum + row.length, 0) / Math.max(tokens.length, 1) || 1;
  const documentFrequency = new Map(terms.map(term => [term, frequencies.filter(counts => counts.has(term)).length]));
  return frequencies.map((counts, i) => terms.reduce((sum, term) => {
    const frequency = counts.get(term) ?? 0;
    const df = documentFrequency.get(term) ?? 0;
    const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
    return sum + idf * frequency * (k1 + 1) / (frequency + k1 * (1 - b + b * tokens[i].length / averageLength));
  }, 0));
}

export function cosine(left: readonly number[], right: readonly number[]): number {
  if (!left.length || left.length !== right.length || [...left, ...right].some(value => !Number.isFinite(value))) throw new Error("invalid_embedding_vector");
  let dot = 0, a = 0, b = 0;
  for (let i = 0; i < left.length; i++) { dot += left[i] * right[i]; a += left[i] ** 2; b += right[i] ** 2; }
  if (!a || !b) throw new Error("zero_embedding_vector");
  return dot / Math.sqrt(a * b);
}

export async function rankHybridCandidates(options: HybridOptions) {
  const { query, documents, embeddingProvider } = options;
  if (!query.trim()) throw new Error("retrieval_query_required");
  if (new Set(documents.map(doc => doc.itemId)).size !== documents.length || documents.some(doc => !doc.itemId || !doc.text.trim())) throw new Error("unique_nonempty_retrieval_documents_required");
  if (!embeddingProvider.model || !/^[a-f0-9]{40}$/.test(embeddingProvider.revision)) throw new Error("embedding_revision_must_be_pinned");
  const rrfK = options.rrfK ?? 60;
  const recallPerChannel = options.recallPerChannel ?? 60;
  if (!Number.isInteger(recallPerChannel) || recallPerChannel < 1 || !Number.isFinite(rrfK) || rrfK <= 0) throw new Error("invalid_retrieval_configuration");
  if (!documents.length) return { itemIds: [], scores: [], recallApplied: false, model: embeddingProvider.model, revision: embeddingProvider.revision };
  const vectors = await embeddingProvider.embed([`query: ${query}`, ...documents.map(doc => `passage: ${doc.text}`)]);
  if (vectors.length !== documents.length + 1) throw new Error("embedding_count_mismatch");
  const lexical = bm25Scores(query, documents);
  const semantic = documents.map((_doc, i) => cosine(vectors[0], vectors[i + 1]));
  const order = (values: number[]) => documents.map((doc, i) => ({ ...doc, score: values[i] })).sort((a, b) => b.score - a.score || a.itemId.localeCompare(b.itemId));
  const lexicalOrder = order(lexical), semanticOrder = order(semantic);
  const lexicalRanks = new Map(lexicalOrder.map((doc, i) => [doc.itemId, i + 1]));
  const semanticRanks = new Map(semanticOrder.map((doc, i) => [doc.itemId, i + 1]));
  const selected = new Set(options.skipIndependentRecall ? documents.map(doc => doc.itemId)
    : [...lexicalOrder.slice(0, recallPerChannel), ...semanticOrder.slice(0, recallPerChannel)].map(doc => doc.itemId));
  const scores = documents.map((doc, i) => ({ itemId: doc.itemId, bm25: lexical[i], cosine: semantic[i],
    lexicalRank: lexicalRanks.get(doc.itemId)!, semanticRank: semanticRanks.get(doc.itemId)!,
    rrf: 1 / (rrfK + lexicalRanks.get(doc.itemId)!) + 1 / (rrfK + semanticRanks.get(doc.itemId)!) }))
    .filter(doc => selected.has(doc.itemId)).sort((a, b) => b.rrf - a.rrf || a.itemId.localeCompare(b.itemId));
  return { itemIds: scores.map(doc => doc.itemId), scores, recallApplied: !options.skipIndependentRecall && selected.size < documents.length,
    candidateCount: documents.length, model: embeddingProvider.model, revision: embeddingProvider.revision, rrfK, recallPerChannel };
}

export type HybridFitEvidence = {
  itemId: string;
  /** Supported points, not estimated ability. Unknown dimensions remain explicit. */
  dimensions: readonly { name: string; weight: number; lower: number; upper: number }[];
  unknowns: string[];
};

/** Preregistered strong-B reranker: 90% supported fit lower bound, 10% retrieval.
 * Uses the exact native A1 dimensions for old and newly researched series alike.
 * Missing support contributes no demonstrated fit; it never asserts low ability.
 */
export function rerankHybridCandidates(retrieved: Awaited<ReturnType<typeof rankHybridCandidates>>, evidence: readonly HybridFitEvidence[]) {
  const byId = new Map(evidence.map(row => [row.itemId, row]));
  if (byId.size !== evidence.length || retrieved.itemIds.some(id => !byId.has(id))) throw new Error("complete_unique_fit_evidence_required");
  const maximumRrf = 2 / ((("rrfK" in retrieved ? retrieved.rrfK : undefined) ?? 60) + 1);
  const scores = retrieved.scores.map(row => {
    const fit = byId.get(row.itemId)!;
    let supportedFit = 0;
    if (!fit.dimensions.length || new Set(fit.dimensions.map(d => d.name)).size !== fit.dimensions.length ||
        Math.abs(fit.dimensions.reduce((sum, d) => sum + d.weight, 0) - 100) > 1e-9) throw new Error("complete_native_dimensions_required");
    for (const dimension of fit.dimensions) {
      const { weight, lower, upper } = dimension;
      if (![weight, lower, upper].every(Number.isFinite) || weight <= 0 || lower < 0 || upper < lower || upper > weight) throw new Error("fit_dimension_out_of_range");
      supportedFit += lower;
    }
    return { ...row, dimensions: fit.dimensions, unknowns: fit.unknowns, supportedFitLowerBound: supportedFit,
      combinedScore: 0.9 * supportedFit / 100 + 0.1 * row.rrf / maximumRrf };
  }).sort((a, b) => b.combinedScore - a.combinedScore || a.itemId.localeCompare(b.itemId));
  return { ...retrieved, scores, itemIds: scores.map(row => row.itemId), rerankingVersion: "native-fit90-rrf10.v2",
    scoreSemantics: "evidence_supported_lower_bound_not_ability_probability", weights: { fit: 0.9, retrieval: 0.1 } };
}
