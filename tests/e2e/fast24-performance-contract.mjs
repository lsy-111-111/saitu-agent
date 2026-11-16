import { FAST24_MATCH_POLICY_VERSION, hasFast24RecommendationCount } from '../../scripts/competitions/v7/fast24-config.mjs';

export const FAST24_PERFORMANCE = Object.freeze({
  schemaVersion: 'saitu.fast24-performance-policy.v1',
  matchPolicyVersion: FAST24_MATCH_POLICY_VERSION,
  sampleCount: 30, desktop: 15, mobile: 15, requiredComplete: 29,
  firstListP95Ms: 40_000, allDetailsP95Ms: 120_000, readyExpansionP95Ms: 1_000,
  listHardMs: 60_000, detailsHardMs: 150_000,
  failuresRemainInDenominator: true, automaticPaidRetries: false, paidWarmupRequests: 0,
});

const finite = value => Number.isFinite(value) && value >= 0;
const validList = (count, ids) => hasFast24RecommendationCount(count) && Array.isArray(ids) && ids.length === count &&
  new Set(ids).size === count && ids.every(id => typeof id === 'string' && id.trim().length > 0);

export function hasFast24PerformanceDelivery(record) {
  const { listItemCount, listItemIds, finalListItemCount, finalListItemIds, reportItemCount, reportItemIds } = record;
  if (!validList(listItemCount, listItemIds) || !validList(finalListItemCount, finalListItemIds) ||
      !validList(reportItemCount, reportItemIds) || finalListItemCount !== reportItemCount) return false;
  const finalItems = new Set(finalListItemIds);
  const retained = listItemIds.filter(id => finalItems.has(id));
  return finalListItemIds.every((id, index) => id === retained[index] && id === reportItemIds[index]);
}

function p95(values, target) {
  const sorted = values.map(value => finite(value) ? value : Infinity).sort((a, b) => a - b);
  const value = sorted[Math.ceil(sorted.length * .95) - 1];
  return { denominator: sorted.length, p95Ms: Number.isFinite(value) ? value : null,
    p95IsUndelivered: !Number.isFinite(value), missingOrFailed: sorted.filter(item => !Number.isFinite(item)).length,
    targetMs: target, passed: Number.isFinite(value) && value <= target };
}

/** Missing, failed and unstarted requests occupy their original denominator. */
export function scoreFast24Performance(records) {
  if (!Array.isArray(records) || records.length !== 30 || new Set(records.map(row => row.caseId)).size !== 30 ||
      ['desktop', 'mobile'].some(viewport => records.filter(row => row.viewport === viewport).length !== 15))
    throw new Error('fast24_requires_30_unique_requests_15_desktop_15_mobile');
  const verified = row => row.realProviderDispatch === true && /^[a-f0-9]{64}$/.test(row.receiptSha256 ?? '');
  const complete = row => verified(row) && row.success === true && row.pageDelivered === true &&
    hasFast24PerformanceDelivery(row) &&
    finite(row.timing?.listMs) && row.timing.listMs <= FAST24_PERFORMANCE.listHardMs &&
    finite(row.timing?.allDetailsMs) && row.timing.allDetailsMs >= row.timing.listMs && row.timing.allDetailsMs <= FAST24_PERFORMANCE.detailsHardMs &&
    finite(row.timing?.readyExpansionMs);
  const metric = (key, target) => p95(records.map(row => complete(row) ? row.timing[key] : null), target);
  const metrics = { firstList: metric('listMs', 40_000), allDetails: metric('allDetailsMs', 120_000), readyExpansion: metric('readyExpansionMs', 1_000) };
  const completed = records.filter(complete).length;
  return { schemaVersion: 'saitu.fast24-performance-score.v1', policy: FAST24_PERFORMANCE,
    denominator: 30, completed, requiredComplete: 29,
    failedCaseIds: records.filter(row => !complete(row)).map(row => row.caseId), metrics,
    perViewport: Object.fromEntries(['desktop', 'mobile'].map(viewport => {
      const rows = records.filter(row => row.viewport === viewport);
      const viewportMetric = (key, target) => p95(rows.map(row => complete(row) ? row.timing[key] : null), target);
      return [viewport, { denominator: rows.length, completed: rows.filter(complete).length,
        metrics: { firstList: viewportMetric('listMs', 40_000), allDetails: viewportMetric('allDetailsMs', 120_000), readyExpansion: viewportMetric('readyExpansionMs', 1_000) } }];
    })),
    passed: completed >= 29 && Object.values(metrics).every(metric => metric.passed),
    independentQualityReview: 'required_separately', historicalResultsAdded: false, automaticPaidRetries: false };
}

export function fast24PerformancePlan(original) {
  const cases = original.cases.slice(0, 30).map((entry, index) => ({ ...entry, caseId: `fast24-performance-${String(index + 1).padStart(2, '0')}` }));
  if (cases.length !== 30 || ['desktop', 'mobile'].some(viewport => cases.filter(row => row.viewport === viewport).length !== 15))
    throw new Error('fast24_plan_requires_15_desktop_and_15_mobile');
  return { ...FAST24_PERFORMANCE, schemaVersion: 'saitu.fast24-performance-plan.v1',
    origin: 'first_30_existing_public_timing_profiles', independentStudentSamplesClaimed: false,
    clock: 'browser_performance_now_before_initial_submit_click', requestConcurrency: 'adaptive', modelConcurrencyLimit: null, cases };
}
