# Raw ranking acceptance metrics

This implementation adds six raw metric consumers; it does not execute a matrix,
open private cases/labels, approve a catalog or produce actual acceptance evidence.
The actual `TRUSTED_SCORING_REVIEWS` remains empty. No threshold or existing 800/
120-family/five-repeat/six-task-group contract changes.

## Evidence boundary

Each metric's `evidencePath` and `evidenceSha256` must equal
`input.rawScoringEvidence` exactly. It uses the existing
`saitu.acceptance-raw-scoring.v1` envelope, not a new summary schema. Its existing
reader recomputes all source/input/answer/review/freeze/implementation/runtime
bindings, the complete 1800-row matrix, exact selected 600 reuse and the other
680 observations. Independent review still requires an exact finite registration
outside the submitted envelope in the reviewed verifier copy. A declared reviewer,
caller count, boolean, `passed` report or matching summary hash cannot replace it.

`deriveSealedExecution` additionally returns aggregate metadata obtained from its
validated reviewed profiles and frozen registration. It does not accept this
metadata from an input. `deriveAcceptanceArtifacts` invokes that reader once per
acceptance call and privately reuses its result for the six metric consumers.
No public proof/result/callback parameter and no cross-call cache are added.
The standalone `deriveMetricArtifact` always replays raw evidence itself. The
raw scorer's existing `actualModelRuns` validation remains a separate non-ranking
branch, so the lazy synchronous lookup does not recurse or introduce top-level
await. Native Node 24 CLI and one-replay instrumentation are tested.

Only a fully derived raw chain authorizes formal ranking metrics. Missing review
registration, unresolved/incomplete labels, not-run or failed 800 cases keep the
metrics pending (or invalid for malformed/drifting evidence). The original raw
scorer's diagnostic ranking output still retains every failed/fallback run; none
are dropped to improve scores. Correct fallback display quality is distinct from
successful model generation, and both failure/fallback counts remain visible.

## Explicit preregistration

Existing code is not evidence of preregistration. Before opening, the ranking
registration's `config.metricAggregation` must contain this exact public object:

```json
{
  "schemaVersion": "saitu.ranking-metric-aggregation.v1",
  "runWeighting": "equal_within_profile",
  "profileWeighting": "equal_within_family",
  "familyWeighting": "equal",
  "ndcg": "best_track_per_series_idcg",
  "noRelevantPool": "exclude_and_report_null",
  "taskGroups": "minimum_of_six_equal_family_means",
  "poolLabelCoverage": "complete_profiles_over_all_120_profiles",
  "unresolvedLabels": "unresolved_pool_items",
  "jaccard": {
    "k": 5,
    "identity": "series",
    "pairs": "all_10_unordered_pairs_per_five_runs",
    "emptyUnion": 1,
    "noRelevantPool": "exclude_from_family_mean"
  }
}
```

The existing registration CLI preserves this public config field in the raw
registration; it does not open inputs. Its exact byte SHA is already bound into
the matrix freeze and the independently reviewed raw envelope. The consumer also
requires the original registration, opening and experiment timestamps and checks
`registeredAt <= ranking.openedAt <= startedAt <= completedAt` and
`registeredAt <= challengeManifest.openedAt`. The challenge opening comes from the
existing byte-bound challenge document, not a new caller declaration. A later
ranking receipt cannot reset earlier challenge exposure. The existing challenge
freeze/implementation-freeze chronology must also be valid. Missing challenge
opening stays pending; malformed or contradictory chronology is invalid. Distinct
valid challenge/ranking openings need not be equal.

The product opening is a separate existing receipt after matrix completion; the
raw scorer already validates that relation. Answer keys and double-review label
contracts do not contain an authoritative separate opening timestamp. No new
self-attested label-opening field is accepted as proof: exact independent review
registration must still establish the real provenance/isolation, and absent
registration remains pending. Missing policy/timestamps
stay pending; changed/unsupported policy or reversed chronology is invalid.
Timestamps alone do not prove independence: the separate trusted provenance
registration is still mandatory. Never retrofit this field into an old run and
call it preregistered. No real registration was created by this development work.

## Values, denominators and exclusions

All six have evidence class `ai_proxy`, derived from the checked chain. Submitted
value, denominator, class and optional numerator must match the computed result.

| Metric | Raw calculation | Denominator |
|---|---|---|
| pooledNdcg5 / pooledNdcg10 | Existing `evaluateRankings`: actual run nDCG, then profile means, then equal independent-family means; best track per series defines IDCG | Scored independent families, at most 120 |
| minimumTaskGroupNdcg5 | Minimum of the six task-group equal-family nDCG@5 means; null if any group has no scored family | Minimum scored-family count across all six groups |
| completePoolLabelCoverage | Number of profiles with complete resolved double-review labels divided by all 120 frozen profiles | 120 profiles; numerator is complete profiles |
| unresolvedLabels | Number of unresolved candidate-label slots from the reviewed full pools; missing/disagreed labels remain U | Actual total candidate-label slots across frozen profiles; numerator is unresolved slots |
| top5Jaccard | Existing scorer's mean of the ten unordered pairs of actual five displayed series lists per profile, then equal independent-family means | Effective scored independent families, never 600 repeats or 1200 pairs |

The protocol deliberately matches the current scorer's exclusion of
`no_relevant_pool` families from both pooled nDCG and its Jaccard family summary.
Those families remain in the complete 120-profile/600-selected-run matrix and
have separate per-family null nDCG and empty-output results. Every family has ten
observed pairs; details report all pairs, aggregated pairs, excluded family IDs
and effective independent n. This does not invent a new Jaccard aggregation.

A correctly reviewed all-zero pool with five empty outputs can be a correct
individual case, but has no defined nDCG. It does not receive 1 and is not padded
back into the denominator. One such family leaves n=119 and the original n>=120
ranking gate still fails. An all-zero group reduces the minimum effective group
n to zero and the group minimum to null. All-zero pools throughout yield null
pooled nDCG/Jaccard with n=0; no fake score is inserted. Existing threshold policy
would need a separate explicit decision to change, which this patch does not do.

Incomplete/duplicate/U labels cannot turn into coverage=1 or unresolved=0. Raw
metadata can show the gap, but formal metrics remain pending/invalid until all
existing label, execution and provenance prerequisites are satisfied.

Relative C gain and its paired CI, strongest preregistered baseline selection,
profile/citation/comprehension and all other unsupported metrics remain pending.
This patch does not declare that the current catalog or private 120 labels match.

## Development verification

Synthetic fixtures use a separate temporary verifier with a test-only finite pin
solely to exercise the native CLI success path for these six metrics. Actual
source trust tables stay empty; the actual/default path remains pending. The
synthetic positive output still fails overall product acceptance because other
required metrics/budget evidence are missing. No synthetic review is entered into
production and no private label, live call, deployment, U/K or coordinator edit
is involved.

Tests cover exact raw references, preregistration/timeline, full/fewer/zero scored
families, actual weighted nDCG and ten-pair Jaccard, value/class/numerator/n spoofing,
unknown/missing/duplicate labels and reviewers, not-run/error/deleted/duplicate
observations, source/config drift, failure/fallback denominators and revalidation
after file mutation. Existing gate/raw-scoring/budget/performance regressions are
kept unchanged. All resulting code and native inputs/results are frozen for
independent review; they are development evidence only.


## November 6: blinded agreement and paired baseline gain

The raw scorer now derives ordinal Krippendorff alpha from paired, original A/B judgments across the full pool, and also reports each task group. Adjudication cannot replace either original. U and missing judgments remain in the coverage counts. If there are no usable pairs or no label variability, alpha is null. Completing a batch of labels does not certify a product result.

For a batched registration, the unique control must be chosen from the six public development families and both complete A1/B arms. The fixed priority is family-averaged nDCG@5, then nDCG@10, then A1. The frozen selection and blind review are replayed. Formal C minus control is measured on the same independent families with non-null IDCG, never on individual repeats; the 95% percentile interval resamples paired family differences 2,000 times with seed 6141. The gain and interval are required to promote C. The existing minimum-family gate still applies. The development results and preparatory reviews alone cannot satisfy the formal evidence chain.
