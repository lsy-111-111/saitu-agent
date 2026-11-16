import type { CompetitionSchedule } from "@/content/competitions";
import type { CompetitionRegistrationStatus } from "@/types/competition-recommendation";

export const SCHEDULE_VERIFICATION_MAX_AGE_DAYS = 180;
const UPCOMING_WINDOW_DAYS = 90;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CompetitionAvailabilityTier = "current-or-upcoming" | "unknown" | "closed";

export type CompetitionAvailability = {
  registrationStatus: CompetitionRegistrationStatus;
  tier: CompetitionAvailabilityTier;
  tierRank: 1 | 2 | 3;
};

function parseCalendarDate(
  value: string,
  precision: CompetitionSchedule["datePrecision"],
  boundary: "start" | "end"
): number | null {
  if (precision === "unknown") return null;
  const match = precision === "month"
    ? /^(\d{4})-(\d{2})$/.exec(value)
    : /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const day = precision === "month"
    ? boundary === "start" ? 1 : new Date(Date.UTC(year, month, 0)).getUTCDate()
    : Number(match[3]);
  const utcMidnight = Date.UTC(year, month - 1, day);
  const parsed = new Date(utcMidnight);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }

  const shanghaiMidnightUtc = utcMidnight - SHANGHAI_OFFSET_MS;
  return boundary === "end" ? shanghaiMidnightUtc + DAY_MS - 1 : shanghaiMidnightUtc;
}

function isVerificationStale(verifiedAt: string | undefined, nowMs: number): boolean {
  if (!verifiedAt) return true;
  const verifiedMs = parseCalendarDate(verifiedAt, "day", "start");
  if (verifiedMs === null || verifiedMs > nowMs + DAY_MS) return true;
  return nowMs - verifiedMs > SCHEDULE_VERIFICATION_MAX_AGE_DAYS * DAY_MS;
}

export function deriveCompetitionAvailability(schedule: CompetitionSchedule, now = new Date()): CompetitionAvailability {
  const common = {
    registrationStart: schedule.registrationStart,
    registrationEnd: schedule.registrationEnd
  };

  if (schedule.state === "cancelled") {
    return {
      registrationStatus: { status: "cancelled", label: "本届已取消", note: "该赛事当前届次已取消。", ...common },
      tier: "closed",
      tierRank: 3
    };
  }

  if (schedule.state === "unknown") {
    return {
      registrationStatus: {
        status: "unknown",
        label: "报名时间待核验",
        note: "请在官方页面确认当前届次和报名安排。",
        ...common
      },
      tier: "unknown",
      tierRank: 2
    };
  }

  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new TypeError("now must be a valid Date");
  }

  if (isVerificationStale(schedule.verifiedAt, nowMs)) {
    return {
      registrationStatus: {
        status: "stale",
        label: "赛程信息待复核",
        note: "该赛程的核验时间已超过180天，请以官方最新通知为准。",
        ...common
      },
      tier: "unknown",
      tierRank: 2
    };
  }

  const startMs = schedule.registrationStart
    ? parseCalendarDate(schedule.registrationStart, schedule.datePrecision, "start")
    : null;
  const endMs = schedule.registrationEnd
    ? parseCalendarDate(schedule.registrationEnd, schedule.datePrecision, "end")
    : null;

  if (schedule.registrationStart && startMs === null) {
    return {
      registrationStatus: { status: "unknown", label: "报名日期格式异常", note: "请以官方通知为准。", ...common },
      tier: "unknown",
      tierRank: 2
    };
  }
  if (schedule.registrationEnd && endMs === null) {
    return {
      registrationStatus: { status: "unknown", label: "报名日期格式异常", note: "请以官方通知为准。", ...common },
      tier: "unknown",
      tierRank: 2
    };
  }

  if (endMs !== null && nowMs > endMs) {
    return {
      registrationStatus: {
        status: "closed",
        label: "本届报名已截止",
        note: "仅供下一届备赛参考。",
        ...common
      },
      tier: "closed",
      tierRank: 3
    };
  }

  if (startMs !== null && nowMs < startMs) {
    const daysUntilStart = Math.ceil((startMs - nowMs) / DAY_MS);
    return {
      registrationStatus: {
        status: "upcoming",
        label: daysUntilStart <= UPCOMING_WINDOW_DAYS ? "即将开放报名" : "后续开放报名",
        note:
          daysUntilStart <= UPCOMING_WINDOW_DAYS
            ? `预计${daysUntilStart}天内开放，请留意官方通知。`
            : "开放时间超过90天，建议临近时再次核验。",
        ...common
      },
      tier: daysUntilStart <= UPCOMING_WINDOW_DAYS ? "current-or-upcoming" : "unknown",
      tierRank: daysUntilStart <= UPCOMING_WINDOW_DAYS ? 1 : 2
    };
  }

  if (endMs !== null) {
    return {
      registrationStatus: { status: "open", label: "当前可报名", note: "提交前仍请核对具体赛道通知。", ...common },
      tier: "current-or-upcoming",
      tierRank: 1
    };
  }

  return {
    registrationStatus: {
      status: "unknown",
      label: "报名截止时间待核验",
      note: "官方来源未提供可用于实时判断的精确截止日期。",
      ...common
    },
    tier: "unknown",
    tierRank: 2
  };
}
