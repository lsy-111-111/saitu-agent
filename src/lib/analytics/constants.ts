import type { AnalyticsEventName } from "@/types/analytics";

export const analyticsEvents: Record<AnalyticsEventName, AnalyticsEventName> = {
  page_view_home: "page_view_home",
  cta_click: "cta_click",
  competition_detail_open: "competition_detail_open",
  competition_source_click: "competition_source_click",
  competition_resource_open: "competition_resource_open",
  competition_team_open: "competition_team_open",
  competition_recommend_started: "competition_recommend_started",
  competition_recommend_completed: "competition_recommend_completed",
  competition_recommend_failed: "competition_recommend_failed"
};

export const analyticsCtaNames = {
  about: "about",
  competitionAssistant: "competition_assistant",
  competitionDirectory: "competition_directory",
  resources: "resources",
  retryMatch: "retry_match",
  returnResults: "return_results",
  startMatch: "start_match",
  teams: "teams"
} as const;

const ctaNameByHref: Readonly<Record<string, string>> = {
  "/about": analyticsCtaNames.about,
  "/competitions": analyticsCtaNames.competitionDirectory,
  "/competitions/recommend": analyticsCtaNames.competitionAssistant,
  "/resources": analyticsCtaNames.resources,
  "/teams": analyticsCtaNames.teams
};

const ctaNameByText: Readonly<Record<string, string>> = {
  "开始匹配": analyticsCtaNames.startMatch,
  "同意，请乐乐开始匹配": analyticsCtaNames.startMatch,
  "重新匹配一次": analyticsCtaNames.retryMatch,
  "返回匹配结果": analyticsCtaNames.returnResults
};

export function resolveAnalyticsCtaName(href: string, text: string) {
  return ctaNameByHref[href] ?? ctaNameByText[text] ?? null;
}
