import "server-only";
import type { CompetitionDirection } from "@/content/competitions";
import { getCompetitionCatalog } from "./catalog";
import { getDecisionCatalog } from "./v6/catalog";
import type { DecisionCompetitionRecord, TaskFamily } from "./v6/catalog-types";
import { getPublishedDecisionRecords } from "./v6/public-catalog";
import { getOfficialEntry } from "./v7/catalog";

export type DirectoryOfficialSource = {
  url: string; title: string; publisher: string; scope: string; checkedAt: string | null;
};
export type DirectorySeries = {
  seriesId: string; name: string; aliases: readonly string[]; organizer: string;
  direction: CompetitionDirection; summary: string; officialSource: DirectoryOfficialSource | null;
};

// Navigation categories describe tasks; they do not establish eligibility.
const directions: Record<TaskFamily, CompetitionDirection> = {
  "software-algorithms": "人工智能与物联", "data-modeling": "学术科研", "engineering-prototype": "工程与制造",
  "experimental-research": "学术科研", investigation: "学术科研", "business-practice": "商业与职业",
  "visual-interaction": "创意与数字", "language-communication": "语言人文", "teaching-service": "语言人文",
};
const unknownDetails = "具体任务、参赛资格、时间和费用尚待核对，请先查看已有官方资料。";

function officialSource(record: DecisionCompetitionRecord): DirectoryOfficialSource | null {
  const entry = getOfficialEntry(record);
  if (entry) return { url: entry.url, title: entry.title, publisher: entry.publisher, scope: record.sources.find(source => source.id === entry.sourceId)?.scope ?? "", checkedAt: entry.checkedAt };
  const source = record.sources.find(item => {
    if (!["organizer", "official_host"].includes(item.authority) || item.accessStatus !== "body_read" ||
      item.integrity !== "consistent" || !item.title.trim() || !item.publisher.trim()) return false;
    try { const url = new URL(item.url); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
  });
  return source ? { url: source.url, title: source.title, publisher: source.publisher, scope: source.scope, checkedAt: source.checkedAt } : null;
}

/** Directory identities include existing series whose full task text remains unreviewed.
 * This projection never admits a record to the recommendation or exact-detail pool. */
export function getDirectorySeries(): DirectorySeries[] {
  const legacy = getCompetitionCatalog();
  const byId = new Map<string, DirectorySeries>(legacy.map(item => [item.id, {
    seriesId: item.id, name: item.name, aliases: item.identity.aliases, organizer: item.identity.organizer,
    direction: item.direction, summary: item.summary, officialSource: null,
  }]));
  const reviewed = new Map(getPublishedDecisionRecords().map(record => [record.seriesId, record]));
  for (const record of getDecisionCatalog()) {
    if (byId.has(record.seriesId)) continue;
    const checked = reviewed.get(record.seriesId);
    byId.set(record.seriesId, {
      seriesId: record.seriesId, name: record.name, aliases: record.aliases, organizer: record.organizer,
      direction: directions[record.taskFamily], summary: checked?.summary ?? unknownDetails,
      officialSource: officialSource(checked ?? record),
    });
  }
  return [...byId.values()];
}

export function getAdditionalDirectorySeries(): DirectorySeries[] {
  const legacyIds = new Set(getCompetitionCatalog().map(item => item.id));
  return getDirectorySeries().filter(item => !legacyIds.has(item.seriesId));
}

export function findDirectorySeries(id: string): DirectorySeries | undefined {
  return getDirectorySeries().find(item => item.seriesId === id);
}
