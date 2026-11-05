/** Unknown/unlabelled series are outside the supplied positive set, not negative judgments. */
export function positiveJudgmentMetrics(ranked, positives, k) {
  const relevant = new Set(positives);
  if (relevant.size === 0) return {hit: null, recall: null, hits:0};
  const hits = new Set(ranked.slice(0,k).filter(id => relevant.has(id))).size;
  return {hit: Number(hits > 0), recall: hits / relevant.size, hits};
}
