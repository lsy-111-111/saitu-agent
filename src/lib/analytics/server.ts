import { analyticsEvents } from "@/lib/analytics/constants";
import { sanitizeAnalyticsPayload } from "@/lib/analytics/events";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { storeAnalyticsEvent } from "@/lib/supabase/server";
import type { CompetitionRecommendationResponseV5 } from "@/types/competition-recommendation";

type VerifiedRecommendationContext = {
  /** A session ID obtained from a successfully verified conversation token. */
  sessionId: string;
  signal: AbortSignal;
  deadlineEpochMs: number;
};

type CompletedRecommendation = Pick<
  CompetitionRecommendationResponseV5,
  | "fallbackUsed"
  | "fallbackMode"
  | "fallbackReason"
  | "provider"
> & {
  recommendations: readonly { competitionId: string }[];
};

const signedSessionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function canRecord(context: VerifiedRecommendationContext) {
  return signedSessionIdPattern.test(context.sessionId) &&
    !context.signal.aborted &&
    context.deadlineEpochMs > Date.now() &&
    isSupabaseConfigured();
}

/**
 * Record the response that the verified recommendation producer actually
 * created. The signed session ID is deliberately used only as an authorization
 * precondition and is never persisted as analytics data.
 */
export async function recordVerifiedRecommendationCompleted(
  response: CompletedRecommendation,
  context: VerifiedRecommendationContext
) {
  if (!canRecord(context)) return false;

  const payload = sanitizeAnalyticsPayload(
    analyticsEvents.competition_recommend_completed,
    {
      device: "server",
      path: "/competitions/recommend",
      resultCount: response.recommendations.length,
      fallbackUsed: response.fallbackUsed,
      fallbackMode: response.fallbackMode,
      ...(response.fallbackReason ? { fallbackReason: response.fallbackReason } : {}),
      provider: response.provider,
      competitionIds: response.recommendations.map(({ competitionId }) => competitionId).join(",")
    }
  );
  if (!payload) return false;

  return storeAnalyticsEvent(
    analyticsEvents.competition_recommend_completed,
    payload,
    {
      signal: context.signal,
      deadlineEpochMs: context.deadlineEpochMs
    }
  );
}
