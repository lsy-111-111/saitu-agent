// Ordinal Krippendorff alpha for two independent reviewers per candidate.
// Midranks depend on pooled category frequencies. U is an unscorable original
// rating, never an adjudicated replacement or a fabricated zero.
type Grade = 0 | 1 | 2 | 3 | "U";
export function ordinalAgreement(pairs: readonly (readonly [Grade, Grade])[]) {
  const counts = [0, 0, 0, 0];
  const coincidences = counts.map(() => [0, 0, 0, 0]);
  let paired = 0, exact = 0;
  for (const [a, b] of pairs) {
    if (a === "U" || b === "U") continue;
    if (![a,b].every(n => Number.isInteger(n) && n >= 0 && n <= 3)) throw new Error("invalid_original_reviewer_grade");
    counts[a]++; counts[b]++; coincidences[a][b]++; coincidences[b][a]++;
    paired++;
    if (a === b) exact++;
  }
  let preceding = 0;
  const midranks = counts.map(count => { const rank = preceding + count / 2; preceding += count; return rank; });
  let observed = 0, expected = 0;
  for (let a = 0; a < counts.length; a++) {
    for (let b = 0; b < counts.length; b++) {
      const distance = (midranks[a] - midranks[b]) ** 2;
      observed += coincidences[a][b] * distance;
      expected += counts[a] * counts[b] * distance;
    }
  }
  const value = paired >= 2 && expected > 0 ? 1 - observed * (2 * paired - 1) / expected : null;
  return { value, paired, exact, candidates: pairs.length, withUnknown: pairs.length - paired, counts, coincidences };
}

export type ReviewerGrade = Grade;
