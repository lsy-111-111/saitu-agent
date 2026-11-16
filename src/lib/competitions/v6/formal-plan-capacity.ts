/** Wall-clock feasibility only; the separate weekly profile budget is never prorated. */
export type RemainingWork = { deadline: number; milliseconds: bigint };
export type FixedInterval = { start: number; end: number };

/** All flexible work in a week shares one release time. Earliest-deadline scheduling
 * is feasible iff each cumulative demand fits the unreserved time before its deadline.
 * Fixed sessions reserve the same clock once, including when stages overlap. */
export function remainingWorkFits(start: number, end: number, work: RemainingWork[], fixed: FixedInterval[]): boolean {
  if (![start, end, ...work.map(w => w.deadline), ...fixed.flatMap(s => [s.start, s.end])].every(Number.isFinite)) return false;
  const reserved = fixed.filter(s => s.end > start && s.start < end)
    .map(s => ({ start: Math.max(start, s.start), end: Math.min(end, s.end) })).sort((a, b) => a.start - b.start);
  if (reserved.some((s, i) => s.end <= s.start || (i > 0 && s.start < reserved[i - 1].end))) return false;
  let demand = BigInt(0);
  for (const w of [...work].sort((a, b) => a.deadline - b.deadline)) {
    if (w.milliseconds < BigInt(0)) return false;
    demand += w.milliseconds;
    const until = Math.min(end, w.deadline);
    const occupied = reserved.reduce((sum, s) => sum + Math.max(0, Math.min(until, s.end) - s.start), 0);
    const available = Math.max(0, until - start) - occupied;
    if (demand > BigInt(Math.max(0, available))) return false;
  }
  return true;
}
