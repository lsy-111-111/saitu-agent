export type AnalyticsEventName =
  | "page_view_home"
  | "cta_click"
  | "competition_detail_open"
  | "competition_source_click"
  | "competition_resource_open"
  | "competition_team_open"
  | "competition_recommend_started"
  | "competition_recommend_completed"
  | "competition_recommend_failed";

export type AnalyticsPayloadValue = string | number | boolean | null;

export type AnalyticsPayload = Partial<
  Record<
    | "source"
    | "device"
    | "path"
    | "ctaName"
    | "position"
    | "competitionId"
    | "competitionIds"
    | "resultCount"
    | "fallbackUsed"
    | "fallbackMode"
    | "fallbackReason"
    | "provider"
    | "failureReason",
    AnalyticsPayloadValue
  >
>;
