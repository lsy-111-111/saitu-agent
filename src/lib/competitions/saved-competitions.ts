import type {
  CompetitionRecommendationExplanation,
  CompetitionRecommendationFallbackMode,
  CompetitionRecommendationRole,
  CompetitionRecommendationRoleV2,
  CompetitionRegistrationStatus,
  CompetitionScoreCalibration,
  CompetitionScoreBreakdown
} from "@/types/competition-recommendation";
import { COMPETITION_RECOMMENDATION_RESPONSE_VERSION } from "@/types/competition-recommendation";
import {
  competitionCurrentScoreBreakdownSchema,
  competitionScoreCalibrationSchema,
  hasValidCompetitionScoreInvariant
} from "@/lib/competitions/recommendation-runtime-schema";

// Keep the key stable so existing browser data remains discoverable.
export const SAVED_COMPETITIONS_STORAGE_KEY = "saitu.savedCompetitions.v1";
export const SAVED_COMPETITIONS_V1_SCHEMA_VERSION = "saitu.savedCompetitions.v1" as const;
export const SAVED_COMPETITIONS_SCHEMA_VERSION = "saitu.savedCompetitions.v2" as const;

export type SavedCompetitionRankingSource = "deepseek" | "rule-fallback" | "evidence-rules";

export type SavedCompetitionRecommendationSnapshotV1 = {
  rank: number;
  role: CompetitionRecommendationRole;
  baseMatchScore: number;
  scoreBreakdown: CompetitionScoreBreakdown;
  rankingSource: SavedCompetitionRankingSource;
  registrationStatus: CompetitionRegistrationStatus;
  dataNotices: string[];
  explanation: CompetitionRecommendationExplanation;
  catalogVersion: string;
  scorerVersion: string;
  promptVersion: string;
  fallbackUsed: boolean;
  fallbackMode: CompetitionRecommendationFallbackMode;
  fallbackReason?: string;
};

export type SavedCompetitionEntryV1 = {
  competitionId: string;
  source: "competition-recommendation";
  batchId: string;
  firstSavedAt: string;
  latestSavedAt: string;
  recommendation: SavedCompetitionRecommendationSnapshotV1;
};

export type SavedCompetitionStoreV1 = {
  schemaVersion: typeof SAVED_COMPETITIONS_V1_SCHEMA_VERSION;
  entries: SavedCompetitionEntryV1[];
};

type SavedTrack = { id: string; label: string };

export type SavedCompetitionRecommendationSnapshotV2 = SavedCompetitionRecommendationSnapshotV1 & {
  recommendedTrack?: SavedTrack | null;
} & (
  | {
      legacyScore?: never;
      responseVersion: typeof COMPETITION_RECOMMENDATION_RESPONSE_VERSION;
      recommendationRole: CompetitionRecommendationRoleV2;
      matchScore: number;
      scoreCalibration: CompetitionScoreCalibration;
    }
  | {
      /** Explicit marker used only for an in-memory/persisted migration from V1. */
      legacyScore: true;
      recommendationRole?: never;
      matchScore?: never;
      scoreCalibration?: never;
    }
);

export type SavedCompetitionEntryV2 = Omit<SavedCompetitionEntryV1, "recommendation"> & {
  recommendation: SavedCompetitionRecommendationSnapshotV2;
};

export type SavedCompetitionStoreV2 = {
  schemaVersion: typeof SAVED_COMPETITIONS_SCHEMA_VERSION;
  entries: SavedCompetitionEntryV2[];
};

export type SavedCompetitionScoreDisplay = {
  label: "综合匹配分" | "历史基础分";
  scoreText: string;
  detailText?: string;
};

function formatSavedScore(score: number) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

/** Shared by the saved page and save/reload integration tests. */
export function savedCompetitionScoreDisplay(
  snapshot: SavedCompetitionRecommendationSnapshotV2
): SavedCompetitionScoreDisplay {
  if (snapshot.matchScore !== undefined && snapshot.scoreCalibration) {
    return {
      label: "综合匹配分",
      scoreText: `${formatSavedScore(snapshot.matchScore)}/100`,
      detailText: `基础 ${formatSavedScore(snapshot.baseMatchScore)} + 校准 ${formatSavedScore(snapshot.scoreCalibration.adjustment)}`
    };
  }
  return {
    label: "历史基础分",
    scoreText: `${formatSavedScore(snapshot.baseMatchScore)}/100`
  };
}

export type SavedCompetitionStorageFailure =
  | "corrupt"
  | "invalid-recommendations"
  | "quota"
  | "unavailable";

export type SavedCompetitionStorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: SavedCompetitionStorageFailure; message: string };

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type SavableRecommendation = {
  recommendedTrack?: SavedTrack | null;
  rank: number;
  competitionId: string;
  role: CompetitionRecommendationRole;
  recommendationRole: CompetitionRecommendationRoleV2;
  baseMatchScore?: number;
  matchScore: number;
  scoreCalibration: CompetitionScoreCalibration;
  totalScore?: number;
  scoreBreakdown: CompetitionScoreBreakdown;
  registrationStatus: CompetitionRegistrationStatus;
  dataNotices: readonly string[];
  explanationSource: "deepseek" | "rule";
  explanation: CompetitionRecommendationExplanation;
};

export type SaveRecommendationResultInput = {
  responseVersion: typeof COMPETITION_RECOMMENDATION_RESPONSE_VERSION;
  catalogVersion?: string;
  scorerVersion?: string;
  promptVersion?: string;
  rankingSource?: SavedCompetitionRankingSource;
  fallbackUsed?: boolean;
  fallbackMode?: CompetitionRecommendationFallbackMode;
  fallbackReason?: string;
  recommendations: readonly SavableRecommendation[];
};

const registrationStatuses = new Set(["open", "upcoming", "unknown", "stale", "closed", "cancelled"]);
const recommendationRoles = new Set(["best-match", "practical", "stretch", "portfolio", "reference"]);
const recommendationRolesV2 = new Set(["best", "steady", "reference"]);
const explanationSources = new Set(["deepseek", "rule"]);
const fallbackModes = new Set(["none", "partial", "full"]);
const rankingSources = new Set(["deepseek", "rule-fallback", "evidence-rules"]);
const legacyScoreBreakdownKeys = [
  "interest",
  "background",
  "goal",
  "difficulty",
  "access",
  "feasibility"
] as const;
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]) {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown, maxLength = 500): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isIsoTimestamp(value: unknown): value is string {
  return isNonEmptyString(value, 64) && !Number.isNaN(Date.parse(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length <= 500);
}

function hasValidLegacyScoreBreakdown(value: Record<string, unknown>) {
  return legacyScoreBreakdownKeys.every((key) => value[key] === null || isFiniteNumber(value[key]));
}

function isLegacyScoreBreakdown(value: unknown): value is CompetitionScoreBreakdown {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [...legacyScoreBreakdownKeys, "completenessPenalty"]) ||
    !isFiniteNumber(value.completenessPenalty)
  ) return false;

  return hasValidLegacyScoreBreakdown(value);
}

function isScoreBreakdown(value: unknown): value is CompetitionScoreBreakdown {
  return competitionCurrentScoreBreakdownSchema.safeParse(value).success || isLegacyScoreBreakdown(value);
}

function isScoreCalibration(value: unknown): value is CompetitionScoreCalibration {
  return competitionScoreCalibrationSchema.safeParse(value).success;
}

function isRegistrationStatus(value: unknown): value is CompetitionRegistrationStatus {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ["status", "label", "note", "registrationStart", "registrationEnd"])) return false;
  if (!registrationStatuses.has(String(value.status))) return false;
  if (!isNonEmptyString(value.label, 100)) return false;
  if (value.note !== undefined && !isNonEmptyString(value.note, 500)) return false;
  if (value.registrationStart !== undefined && !isNonEmptyString(value.registrationStart, 64)) return false;
  return value.registrationEnd === undefined || isNonEmptyString(value.registrationEnd, 64);
}

function isExplanation(value: unknown): value is CompetitionRecommendationExplanation {
  return isRecord(value) &&
    hasOnlyKeys(value, ["matchReasons", "possibleGaps", "preparationTips"]) &&
    isStringArray(value.matchReasons) &&
    isStringArray(value.possibleGaps) &&
    isStringArray(value.preparationTips);
}

function isSnapshotV1(value: unknown): value is SavedCompetitionRecommendationSnapshotV1 {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, [
    "rank",
    "role",
    "baseMatchScore",
    "scoreBreakdown",
    "rankingSource",
    "registrationStatus",
    "dataNotices",
    "explanation",
    "catalogVersion",
    "scorerVersion",
    "promptVersion",
    "fallbackUsed",
    "fallbackMode",
    "fallbackReason"
  ])) return false;
  if (!Number.isInteger(value.rank) || Number(value.rank) < 1 || Number(value.rank) > 3) return false;
  if (!recommendationRoles.has(String(value.role))) return false;
  if (!isFiniteNumber(value.baseMatchScore) || value.baseMatchScore < 0 || value.baseMatchScore > 100) return false;
  if (!isLegacyScoreBreakdown(value.scoreBreakdown)) return false;
  if (!rankingSources.has(String(value.rankingSource))) return false;
  if (!isRegistrationStatus(value.registrationStatus)) return false;
  if (!isStringArray(value.dataNotices)) return false;
  if (!isExplanation(value.explanation)) return false;
  if (!isNonEmptyString(value.catalogVersion, 120)) return false;
  if (!isNonEmptyString(value.scorerVersion, 120)) return false;
  if (!isNonEmptyString(value.promptVersion, 120)) return false;
  if (typeof value.fallbackUsed !== "boolean") return false;
  if (!fallbackModes.has(String(value.fallbackMode))) return false;
  return value.fallbackReason === undefined || isNonEmptyString(value.fallbackReason, 160);
}

function validTrack(track: unknown): track is SavedTrack {
  return isRecord(track) && isNonEmptyString(track.id, 160) && isNonEmptyString(track.label, 200);
}

function isSnapshotV2(value: unknown): value is SavedCompetitionRecommendationSnapshotV2 {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, [
    "rank",
    "recommendedTrack",
    "role",
    "legacyScore",
    "responseVersion",
    "recommendationRole",
    "baseMatchScore",
    "matchScore",
    "scoreCalibration",
    "scoreBreakdown",
    "rankingSource",
    "registrationStatus",
    "dataNotices",
    "explanation",
    "catalogVersion",
    "scorerVersion",
    "promptVersion",
    "fallbackUsed",
    "fallbackMode",
    "fallbackReason"
  ])) return false;
  const track = value.recommendedTrack;
  if (track !== undefined && track !== null && (
    !validTrack(track) || !hasOnlyKeys(track, ["id", "label"])
  )) return false;
  if (!Number.isInteger(value.rank) || Number(value.rank) < 1 || Number(value.rank) > 3) return false;
  if (!recommendationRoles.has(String(value.role))) return false;
  if (value.legacyScore !== undefined && value.legacyScore !== true) return false;
  if (!isFiniteNumber(value.baseMatchScore) || value.baseMatchScore < 0 || value.baseMatchScore > 100) return false;
  if (!isScoreBreakdown(value.scoreBreakdown)) return false;
  if (!rankingSources.has(String(value.rankingSource))) return false;
  if (!isRegistrationStatus(value.registrationStatus)) return false;
  if (!isStringArray(value.dataNotices)) return false;
  if (!isExplanation(value.explanation)) return false;
  if (!isNonEmptyString(value.catalogVersion, 120)) return false;
  if (!isNonEmptyString(value.scorerVersion, 120)) return false;
  if (!isNonEmptyString(value.promptVersion, 120)) return false;
  if (typeof value.fallbackUsed !== "boolean") return false;
  if (!fallbackModes.has(String(value.fallbackMode))) return false;
  if (value.fallbackReason !== undefined && !isNonEmptyString(value.fallbackReason, 160)) return false;

  const isLegacyMigration = value.legacyScore === true;
  const hasRecommendationRole = value.recommendationRole !== undefined;
  const hasMatchScore = value.matchScore !== undefined;
  const calibration = value.scoreCalibration;
  const hasCalibration = calibration !== undefined;
  if (isLegacyMigration) {
    if (value.recommendedTrack !== undefined || value.responseVersion !== undefined || hasRecommendationRole || hasMatchScore || hasCalibration) return false;
    if (!isLegacyScoreBreakdown(value.scoreBreakdown)) return false;
  } else if (
    value.responseVersion !== COMPETITION_RECOMMENDATION_RESPONSE_VERSION ||
    !hasRecommendationRole ||
    !hasMatchScore ||
    !hasCalibration
  ) {
    return false;
  }
  if (!isLegacyMigration && !competitionCurrentScoreBreakdownSchema.safeParse(value.scoreBreakdown).success) return false;
  if (hasRecommendationRole && !recommendationRolesV2.has(String(value.recommendationRole))) return false;
  if (hasMatchScore !== hasCalibration) return false;
  if (hasMatchScore && (!isFiniteNumber(value.matchScore) || value.matchScore < 0 || value.matchScore > 100)) return false;
  if (hasCalibration && !isScoreCalibration(calibration)) return false;
  if (
    !isLegacyMigration &&
    !hasValidCompetitionScoreInvariant({
      baseMatchScore: value.baseMatchScore,
      matchScore: value.matchScore as number,
      scoreBreakdown: value.scoreBreakdown,
      scoreCalibration: calibration as CompetitionScoreCalibration
    })
  ) return false;
  const isReference = value.recommendationRole === "reference" ||
    (value.recommendationRole === undefined && value.role === "reference");
  if (
    isReference &&
    hasCalibration &&
    (!isScoreCalibration(calibration) || calibration.qualified !== false || calibration.adjustment !== 0)
  ) return false;
  if (
    hasCalibration &&
    (calibration as CompetitionScoreCalibration).qualified !== (value.recommendationRole !== "reference")
  ) return false;
  if (
    value.recommendationRole === "best" &&
    (value.rank !== 1 || value.role !== "best-match")
  ) return false;
  if (
    value.recommendationRole === "steady" &&
    (value.rank === 1 || value.role === "best-match" || value.role === "reference")
  ) return false;
  if (value.recommendationRole === "reference" && value.role !== "reference") return false;
  if (
    !isLegacyMigration &&
    !value.fallbackUsed &&
    (value.fallbackMode !== "none" || value.fallbackReason !== undefined)
  ) return false;
  if (
    !isLegacyMigration &&
    value.fallbackUsed &&
    (value.fallbackMode === "none" || value.fallbackReason === undefined)
  ) return false;
  return true;
}

function isEntryV1(value: unknown): value is SavedCompetitionEntryV1 {
  return isRecord(value) &&
    hasOnlyKeys(value, [
      "competitionId",
      "source",
      "batchId",
      "firstSavedAt",
      "latestSavedAt",
      "recommendation"
    ]) &&
    isNonEmptyString(value.competitionId, 160) &&
    value.source === "competition-recommendation" &&
    isNonEmptyString(value.batchId, 320) &&
    isIsoTimestamp(value.firstSavedAt) &&
    isIsoTimestamp(value.latestSavedAt) &&
    isSnapshotV1(value.recommendation);
}

function isEntryV2(value: unknown): value is SavedCompetitionEntryV2 {
  return isRecord(value) &&
    hasOnlyKeys(value, [
      "competitionId",
      "source",
      "batchId",
      "firstSavedAt",
      "latestSavedAt",
      "recommendation"
    ]) &&
    isNonEmptyString(value.competitionId, 160) &&
    value.source === "competition-recommendation" &&
    isNonEmptyString(value.batchId, 320) &&
    isIsoTimestamp(value.firstSavedAt) &&
    isIsoTimestamp(value.latestSavedAt) &&
    isSnapshotV2(value.recommendation);
}

export function isSavedCompetitionStoreV1(value: unknown): value is SavedCompetitionStoreV1 {
  if (!isRecord(value) || value.schemaVersion !== SAVED_COMPETITIONS_V1_SCHEMA_VERSION) return false;
  if (!hasOnlyKeys(value, ["schemaVersion", "entries"])) return false;
  if (!Array.isArray(value.entries) || !value.entries.every(isEntryV1)) return false;
  return new Set(value.entries.map((entry) => entry.competitionId)).size === value.entries.length;
}

export function isSavedCompetitionStoreV2(value: unknown): value is SavedCompetitionStoreV2 {
  if (!isRecord(value) || value.schemaVersion !== SAVED_COMPETITIONS_SCHEMA_VERSION) return false;
  if (!hasOnlyKeys(value, ["schemaVersion", "entries"])) return false;
  if (!Array.isArray(value.entries) || !value.entries.every(isEntryV2)) return false;
  return new Set(value.entries.map((entry) => entry.competitionId)).size === value.entries.length;
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function unavailable<T>(): SavedCompetitionStorageResult<T> {
  return {
    ok: false,
    reason: "unavailable",
    message: "当前浏览器无法使用本地存储，请检查隐私浏览或存储权限设置。"
  };
}

export function createEmptySavedCompetitionStore(): SavedCompetitionStoreV2 {
  return { schemaVersion: SAVED_COMPETITIONS_SCHEMA_VERSION, entries: [] };
}

function migrateSavedCompetitionStoreV1(store: SavedCompetitionStoreV1): SavedCompetitionStoreV2 {
  return {
    schemaVersion: SAVED_COMPETITIONS_SCHEMA_VERSION,
    entries: store.entries.map((entry) => ({
      ...entry,
      recommendation: { ...entry.recommendation, legacyScore: true }
    }))
  };
}

export function readSavedCompetitionStore(
  storage?: StorageLike
): SavedCompetitionStorageResult<SavedCompetitionStoreV2> {
  const target = resolveStorage(storage);
  if (!target) return unavailable();

  let serialized: string | null;
  try {
    serialized = target.getItem(SAVED_COMPETITIONS_STORAGE_KEY);
  } catch {
    return unavailable();
  }

  if (serialized === null) return { ok: true, value: createEmptySavedCompetitionStore() };

  try {
    const parsed: unknown = JSON.parse(serialized);
    if (isSavedCompetitionStoreV2(parsed)) return { ok: true, value: parsed };
    if (isSavedCompetitionStoreV1(parsed)) {
      return { ok: true, value: migrateSavedCompetitionStoreV1(parsed) };
    }
  } catch {
    // The caller decides whether to remove malformed user data.
  }

  return {
    ok: false,
    reason: "corrupt",
    message: "已保存的数据无法读取。清理损坏数据后即可重新保存。"
  };
}

function storageWriteFailure<T>(error: unknown): SavedCompetitionStorageResult<T> {
  const name = isRecord(error) && typeof error.name === "string" ? error.name : "";
  const quota = name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
  return {
    ok: false,
    reason: quota ? "quota" : "unavailable",
    message: quota
      ? "浏览器存储空间不足，未能保存。请清理部分站点数据后再试。"
      : "浏览器拒绝写入本地存储，当前推荐结果仍保留在本页。"
  };
}

function normalizedScore(recommendation: SavableRecommendation): number | null {
  const score = recommendation.baseMatchScore ?? recommendation.totalScore;
  return isFiniteNumber(score) ? score : null;
}

export function saveRecommendationResult(
  result: SaveRecommendationResultInput,
  storage?: StorageLike,
  now = new Date()
): SavedCompetitionStorageResult<SavedCompetitionStoreV2> {
  const target = resolveStorage(storage);
  if (!target) return unavailable();

  const recommendations = result.recommendations;
  const validRecommendations =
    result.responseVersion === COMPETITION_RECOMMENDATION_RESPONSE_VERSION &&
    recommendations.length > 0 && recommendations.length <= 3 &&
    recommendations.every((recommendation, index) => {
      const baseMatchScore = normalizedScore(recommendation);
      const qualified = recommendation.scoreCalibration.qualified;
      const expectedRole = qualified
        ? recommendation.rank === 1 ? "best" : "steady"
        : "reference";
      const legacyRoleValid = qualified
        ? recommendation.rank === 1
          ? recommendation.role === "best-match"
          : recommendation.role !== "best-match" && recommendation.role !== "reference"
        : recommendation.role === "reference";
      return (
    (recommendation.recommendedTrack == null || validTrack(recommendation.recommendedTrack)) &&
    isNonEmptyString(recommendation.competitionId, 160) &&
    Number.isInteger(recommendation.rank) &&
    recommendation.rank === index + 1 &&
    recommendationRoles.has(recommendation.role) &&
    recommendationRolesV2.has(recommendation.recommendationRole) &&
    recommendation.recommendationRole === expectedRole &&
    legacyRoleValid &&
    baseMatchScore !== null &&
    competitionCurrentScoreBreakdownSchema.safeParse(recommendation.scoreBreakdown).success &&
    isRegistrationStatus(recommendation.registrationStatus) &&
    isStringArray(recommendation.dataNotices) &&
    explanationSources.has(recommendation.explanationSource) &&
    isExplanation(recommendation.explanation) &&
    hasValidCompetitionScoreInvariant({
      baseMatchScore,
      matchScore: recommendation.matchScore,
      scoreBreakdown: recommendation.scoreBreakdown,
      scoreCalibration: recommendation.scoreCalibration
    })
      );
    });

  const fallbackUsed = Boolean(result.fallbackUsed);
  const fallbackMode = result.fallbackMode ?? "none";
  const validFallbackMetadata = fallbackModes.has(fallbackMode) && (
    fallbackUsed
      ? fallbackMode !== "none" && isNonEmptyString(result.fallbackReason, 160)
      : fallbackMode === "none" && result.fallbackReason === undefined
  );

  if (
    !validRecommendations ||
    !validFallbackMetadata ||
    (result.rankingSource !== undefined && !rankingSources.has(result.rankingSource)) ||
    new Set(recommendations.map((item) => item.competitionId)).size !== recommendations.length
  ) {
    return {
      ok: false,
      reason: "invalid-recommendations",
      message: "推荐结果无效，未写入“我的竞赛”。请重新完成一次匹配。"
    };
  }

  const existing = readSavedCompetitionStore(target);
  if (!existing.ok) return existing;

  const timestamp = now.toISOString();
  const batchId = `${timestamp}:${recommendations.map((item) => item.competitionId).join(",")}`;
  const existingById = new Map(existing.value.entries.map((entry) => [entry.competitionId, entry]));
  const rankingSource = result.rankingSource ?? (result.fallbackUsed ? "rule-fallback" : "deepseek");

  for (const recommendation of recommendations) {
    const previous = existingById.get(recommendation.competitionId);
    const track = recommendation.recommendedTrack;
    const snapshot: SavedCompetitionRecommendationSnapshotV2 = {
      ...(track ? {recommendedTrack: {id: track.id, label: track.label}}
        : rankingSource === "evidence-rules" || track === null ? {recommendedTrack: null} : {}),
      rank: recommendation.rank,
      role: recommendation.role,
      responseVersion: result.responseVersion,
      recommendationRole: recommendation.recommendationRole,
      baseMatchScore: normalizedScore(recommendation)!,
      matchScore: recommendation.matchScore,
      scoreCalibration: { ...recommendation.scoreCalibration },
      scoreBreakdown: recommendation.scoreBreakdown,
      rankingSource,
      registrationStatus: recommendation.registrationStatus,
      dataNotices: [...recommendation.dataNotices],
      explanation: {
        matchReasons: [...recommendation.explanation.matchReasons],
        possibleGaps: [...recommendation.explanation.possibleGaps],
        preparationTips: [...recommendation.explanation.preparationTips]
      },
      catalogVersion: result.catalogVersion || "unknown",
      scorerVersion: result.scorerVersion || "unknown",
      promptVersion: result.promptVersion || "unknown",
      fallbackUsed: Boolean(result.fallbackUsed),
      fallbackMode: result.fallbackMode || "none",
      ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {})
    };

    existingById.set(recommendation.competitionId, {
      competitionId: recommendation.competitionId,
      source: "competition-recommendation",
      batchId,
      firstSavedAt: previous?.firstSavedAt ?? timestamp,
      latestSavedAt: timestamp,
      recommendation: snapshot
    });
  }

  const nextStore: SavedCompetitionStoreV2 = {
    schemaVersion: SAVED_COMPETITIONS_SCHEMA_VERSION,
    entries: [...existingById.values()].sort((left, right) => {
      const savedDifference = Date.parse(right.latestSavedAt) - Date.parse(left.latestSavedAt);
      if (savedDifference) return savedDifference;
      const batchDifference = right.batchId.localeCompare(left.batchId);
      return batchDifference || left.recommendation.rank - right.recommendation.rank;
    })
  };

  try {
    target.setItem(SAVED_COMPETITIONS_STORAGE_KEY, JSON.stringify(nextStore));
    return { ok: true, value: nextStore };
  } catch (error) {
    return storageWriteFailure(error);
  }
}

export function removeSavedCompetition(
  competitionId: string,
  storage?: StorageLike
): SavedCompetitionStorageResult<SavedCompetitionStoreV2> {
  const target = resolveStorage(storage);
  if (!target) return unavailable();
  const existing = readSavedCompetitionStore(target);
  if (!existing.ok) return existing;

  const nextStore: SavedCompetitionStoreV2 = {
    ...existing.value,
    entries: existing.value.entries.filter((entry) => entry.competitionId !== competitionId)
  };

  try {
    target.setItem(SAVED_COMPETITIONS_STORAGE_KEY, JSON.stringify(nextStore));
    return { ok: true, value: nextStore };
  } catch (error) {
    return storageWriteFailure(error);
  }
}

export function clearSavedCompetitionStore(
  storage?: StorageLike
): SavedCompetitionStorageResult<SavedCompetitionStoreV2> {
  const target = resolveStorage(storage);
  if (!target) return unavailable();

  try {
    target.removeItem(SAVED_COMPETITIONS_STORAGE_KEY);
    return { ok: true, value: createEmptySavedCompetitionStore() };
  } catch (error) {
    return storageWriteFailure(error);
  }
}
