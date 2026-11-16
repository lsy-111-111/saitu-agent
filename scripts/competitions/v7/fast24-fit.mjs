import { FAST24, FAST24_MATCH_POLICY_VERSION, hasFast24RecommendationCount } from './fast24-config.mjs';

/** Compute the fixed 48 fit fractions from independent per-report judgments. */
export function scoreFast24Fit(rows, { legacyReasonableEmpty = false } = {}) {
  const fail = reason => { throw new Error(`fast24_fit:${reason}`); };
  if (!Array.isArray(rows) || rows.length !== 48 || new Set(rows.map(row => row.slotId)).size !== 48 ||
      rows.some(row => typeof row.slotId !== 'string' || !row.slotId || !FAST24.groups.includes(row.taskGroup)))
    fail('fixed48_unique_known_group_slots_required');
  if (FAST24.groups.some(group => rows.filter(row => row.taskGroup === group).length !== 8))
    fail('fixed8_per_group_required');
  const scored = rows.map(row => {
    if (typeof row.technicalComplete !== 'boolean') fail('explicit_technical_completion_required');
    if (row.technicalComplete && (!Number.isInteger(row.displayedCount) || row.displayedCount < 0 || row.displayedCount > 5))
      fail('complete_report_count_must_be_0_to_5');
    if (row.technicalComplete && row.displayedCount > 0 && (!Number.isInteger(row.fittingCount) || row.fittingCount < 0 || row.fittingCount > row.displayedCount))
      fail('independent_fit_count_required');
    const reviews = row.emptyReviews ?? [];
    if (!Array.isArray(reviews)) fail('empty_reviews_must_be_array');
    const boundReviews = reviews.filter(review => typeof review.reviewer === 'string' && review.reviewer &&
      /^[a-f0-9]{64}$/.test(row.originalSha256 ?? '') && review.originalSha256 === row.originalSha256);
    const doubleReasonableEmpty = row.technicalComplete && row.displayedCount === 0 &&
      new Set(boundReviews.filter(review => review.reasonableEmpty === true).map(review => review.reviewer)).size >= 2 &&
      !boundReviews.some(review => review.reasonableEmpty !== true);
    const legacyFit = row.technicalComplete && row.displayedCount > 0 ? row.fittingCount / row.displayedCount : 0;
    const complete = row.technicalComplete && hasFast24RecommendationCount(row.displayedCount) && row.fittingCount > 0;
    return { slotId: row.slotId, taskGroup: row.taskGroup, legacyFit,
      ...(!legacyReasonableEmpty ? { complete } : {}),
      fit: legacyReasonableEmpty && doubleReasonableEmpty ? 1 : legacyFit, doubleReasonableEmpty,
      emptyDecision: !row.technicalComplete || row.displayedCount !== 0 ? 'not_applicable' : doubleReasonableEmpty ? 'double_review_justified' : 'unresolved_or_not_justified' };
  });
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  return { schemaVersion: legacyReasonableEmpty ? 'saitu.fast24-fit-clarified-empty.v1' : 'saitu.fast24-fit-nonempty.v1',
    ...(!legacyReasonableEmpty ? { matchPolicyVersion: FAST24_MATCH_POLICY_VERSION, completeC: scored.filter(row => row.complete).length } : {}),
    denominator: 48,
    fitMean: mean(scored.map(row => row.fit)), legacyFitMean: mean(scored.map(row => row.legacyFit)),
    groupFit: Object.fromEntries(FAST24.groups.map(group => [group, mean(scored.filter(row => row.taskGroup === group).map(row => row.fit))])),
    legacyGroupFit: Object.fromEntries(FAST24.groups.map(group => [group, mean(scored.filter(row => row.taskGroup === group).map(row => row.legacyFit))])),
    doubleReviewedReasonableEmptyReports: scored.filter(row => row.doubleReasonableEmpty).length,
    policy: legacyReasonableEmpty
      ? 'Historical reasonable delivered empty earns fit1 after two independent judgments.'
      : 'A complete report needs 1–5 displayed recommendations and at least one independently judged fit. Empty reports, failures and unknowns score zero in the fixed 48.',
    jaccardDefinitionChanged: false, rows: scored };
}
