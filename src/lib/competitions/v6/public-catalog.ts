import "server-only";
import { getMatchingCatalogRecords } from "../v7/catalog";
import type { DecisionCompetitionRecord } from "./catalog-types";

/** Public reading pages share v7's independently checked core-information pool. */
export function getPublishedDecisionRecords(): DecisionCompetitionRecord[] {
  return getMatchingCatalogRecords().sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || b.contentTier.localeCompare(a.contentTier) || a.recordId.localeCompare(b.recordId));
}

/** Exact record identity only: never redirect an archived edition to another. */
export function getPublishedDecisionRecord(recordId: string): DecisionCompetitionRecord | undefined {
  return getPublishedDecisionRecords().find(record => record.recordId === recordId);
}

/** Full-page requests and client navigation can supply encoded or decoded params. */
export function resolvePublishedDecisionRoute(value: string): DecisionCompetitionRecord | undefined {
  try { return getPublishedDecisionRecord(decodeURIComponent(value)); }
  catch { return undefined; }
}

export function decisionRecordHref(recordId: string): string {
  return `/competitions/records/${encodeURIComponent(recordId)}`;
}
