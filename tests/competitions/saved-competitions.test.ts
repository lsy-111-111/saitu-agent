import { describe, expect, it } from "vitest";
import {
  SAVED_COMPETITIONS_STORAGE_KEY,
  SAVED_COMPETITIONS_SCHEMA_VERSION,
  SAVED_COMPETITIONS_V1_SCHEMA_VERSION,
  clearSavedCompetitionStore,
  isSavedCompetitionStoreV1,
  isSavedCompetitionStoreV2,
  readSavedCompetitionStore,
  removeSavedCompetition,
  saveRecommendationResult,
  type SaveRecommendationResultInput
} from "@/lib/competitions/saved-competitions";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function result(scoreOffset = 0): SaveRecommendationResultInput {
  return {
    responseVersion: "competition-recommendation.v5",
    catalogVersion: "catalog.1",
    scorerVersion: "scorer.1",
    promptVersion: "prompt.1",
    rankingSource: "deepseek",
    fallbackUsed: false,
    fallbackMode: "none",
    recommendations: [0, 1, 2].map((index) => {
      const subjectTask = 22 + scoreOffset;
      const availabilityTiming = 10 - index * 5;
      const baseMatchScore = 80 + subjectTask - 22 + availabilityTiming;
      const rawAlignment =
        0.5 * subjectTask / 25 +
        0.3 * 18 / 20 +
        0.2 * 13 / 15;
      const alignment = Math.round(rawAlignment * 10_000) / 10_000;
      const adjustment = Math.round(Math.min(
        8,
        (100 - baseMatchScore) * 0.6 * rawAlignment
      ) * 10) / 10;
      return {
        rank: index + 1,
        competitionId: `competition-${index + 1}`,
        role: index === 0 ? "best-match" as const : index === 1 ? "practical" as const : "stretch" as const,
        recommendationRole: index === 0 ? "best" as const : "steady" as const,
        baseMatchScore,
        matchScore: Math.round(Math.min(95, baseMatchScore + adjustment) * 10) / 10,
        scoreCalibration: {
          version: "competition-score-calibration.v1" as const,
          qualified: true,
          alignment,
          evidenceConfidence: 1,
          adjustment
        },
        scoreBreakdown: {
        subjectTask,
        skillsEvidence: 18,
        goalsOutputs: 13,
        maturity: 8,
        teamResources: 14,
        availabilityTiming,
        dataConfidence: 5,
        interest: subjectTask,
        background: 18,
        goal: 13,
        difficulty: 8,
        access: availabilityTiming,
        feasibility: 14,
        completenessPenalty: 0
        },
        registrationStatus: { status: "unknown" as const, label: "请核验本届通知" },
        dataNotices: ["报名时间待核验"],
        explanationSource: "deepseek" as const,
        explanation: {
          matchReasons: [`推荐理由 ${index + 1}`],
          possibleGaps: [`可能差距 ${index + 1}`],
          preparationTips: [`准备建议 ${index + 1}`]
        }
      };
    })
  };
}

describe("我的竞赛本地存储", () => {
  it("支持保存恰好三项新推荐结果", () => {
    const storage = new MemoryStorage();
    const input = result();

    const saved = saveRecommendationResult(input, storage, new Date("2026-08-22T08:00:00.000Z"));

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.entries).toHaveLength(3);
  });

  it("只保存当时的赛道编号和名称，兼容没有赛道字段的旧结果", () => {
    const storage = new MemoryStorage();
    const input = result();
    const track = { id: "lab-design", label: "实验设计", evidenceRef: "rule-ref" };
    const first = input.recommendations[0];
    expect(saveRecommendationResult({...input, recommendations: [{...first, recommendedTrack: track}]}, storage).ok).toBe(true);
    const saved = readSavedCompetitionStore(storage);
    expect(saved.ok && saved.value.entries[0].recommendation.recommendedTrack).toEqual({id:"lab-design",label:"实验设计"});
    expect(saveRecommendationResult({...input, recommendations: [first]}, storage).ok).toBe(true);
    const historical = readSavedCompetitionStore(storage);
    expect(historical.ok && historical.value.entries[0].recommendation.recommendedTrack).toBeUndefined();
  });

  it.each([1, 2])("保存 %i 项有依据的短名单", count => {
    const storage = new MemoryStorage();
    const input = result();
    input.recommendations = input.recommendations.slice(0, count);
    expect(saveRecommendationResult(input, storage).ok).toBe(true);
    const stored = readSavedCompetitionStore(storage);
    expect(stored.ok && stored.value.entries.length).toBe(count);
  });

  it.each([0, 4])("拒绝 %i 项新推荐结果且不会静默截断", (count) => {
    const storage = new MemoryStorage();
    const input = result();
    input.recommendations = count <= 3
      ? input.recommendations.slice(0, count)
      : [...input.recommendations, {
          ...input.recommendations[0],
          rank: 4,
          competitionId: "competition-4"
        }];

    expect(saveRecommendationResult(input, storage)).toMatchObject({
      ok: false,
      reason: "invalid-recommendations"
    });
  });

  it("使用版本化键保存三项最小推荐快照", () => {
    const storage = new MemoryStorage();
    const saved = saveRecommendationResult(result(), storage, new Date("2026-08-22T08:00:00.000Z"));

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.entries).toHaveLength(3);
    expect(saved.value.entries.map((entry) => entry.recommendation.rank)).toEqual([1, 2, 3]);
    expect(saved.value.entries[0].recommendation.baseMatchScore).toBe(90);

    const serialized = storage.getItem(SAVED_COMPETITIONS_STORAGE_KEY) ?? "";
    expect(serialized).toContain(SAVED_COMPETITIONS_SCHEMA_VERSION);
    expect(serialized).not.toContain("profile");
    expect(serialized).not.toContain("clarification");
    expect(serialized).not.toContain("conversationToken");
    const parsed = JSON.parse(serialized);
    expect(isSavedCompetitionStoreV2(parsed)).toBe(true);
    expect(isSavedCompetitionStoreV1(parsed)).toBe(false);
    expect(parsed.entries[0].recommendation).toMatchObject({
      responseVersion: "competition-recommendation.v5",
      baseMatchScore: 90,
      matchScore: 95,
      scoreCalibration: { adjustment: 5.3 }
    });
    expect(parsed.entries[0].recommendation).not.toHaveProperty("provider");
    expect(parsed.entries[0].recommendation).not.toHaveProperty("model");
    expect(parsed.entries[0].recommendation).not.toHaveProperty("explanationSource");
  });

  it.each([1, 2])("将历史 V1 的 %i 项快照迁移到内存 V2", (count) => {
    const storage = new MemoryStorage();
    expect(saveRecommendationResult(result(), storage).ok).toBe(true);
    const historical = JSON.parse(storage.getItem(SAVED_COMPETITIONS_STORAGE_KEY) ?? "{}");
    historical.schemaVersion = SAVED_COMPETITIONS_V1_SCHEMA_VERSION;
    historical.entries = historical.entries.slice(0, count);
    for (const entry of historical.entries) {
      delete entry.recommendation.responseVersion;
      delete entry.recommendation.recommendationRole;
      delete entry.recommendation.matchScore;
      delete entry.recommendation.scoreCalibration;
      for (const key of [
        "subjectTask",
        "skillsEvidence",
        "goalsOutputs",
        "maturity",
        "teamResources",
        "availabilityTiming",
        "dataConfidence"
      ]) delete entry.recommendation.scoreBreakdown[key];
    }
    storage.setItem(SAVED_COMPETITIONS_STORAGE_KEY, JSON.stringify(historical));

    expect(isSavedCompetitionStoreV1(historical)).toBe(true);

    const read = readSavedCompetitionStore(storage);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.schemaVersion).toBe(SAVED_COMPETITIONS_SCHEMA_VERSION);
    expect(read.value.entries).toHaveLength(count);
    expect(read.value.entries[0].recommendation).toMatchObject({ legacyScore: true });
    expect(read.value.entries[0].recommendation.matchScore).toBeUndefined();
    // Migration is persisted only on the next write.
    expect(JSON.parse(storage.getItem(SAVED_COMPETITIONS_STORAGE_KEY) ?? "{}").schemaVersion)
      .toBe(SAVED_COMPETITIONS_V1_SCHEMA_VERSION);
  });

  it("兼容旧 totalScore 并在重复保存时保留首次时间、更新快照", () => {
    const storage = new MemoryStorage();
    const legacy = result();
    legacy.recommendations = legacy.recommendations.map(({ baseMatchScore, ...recommendation }) => ({
      ...recommendation,
      totalScore: baseMatchScore
    }));

    expect(saveRecommendationResult(legacy, storage, new Date("2026-08-22T08:00:00.000Z")).ok).toBe(true);
    const updated = saveRecommendationResult(result(3), storage, new Date("2026-08-23T09:30:00.000Z"));

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.entries).toHaveLength(3);
    expect(updated.value.entries[0]).toMatchObject({
      firstSavedAt: "2026-08-22T08:00:00.000Z",
      latestSavedAt: "2026-08-23T09:30:00.000Z",
      recommendation: { baseMatchScore: 93 }
    });
  });

  it("接受仅含现代七维的实际 API 分项并完整回读校准分", () => {
    const storage = new MemoryStorage();
    const modern = result();
    modern.recommendations = modern.recommendations.map((recommendation) => {
      const breakdown = { ...recommendation.scoreBreakdown } as Record<string, unknown>;
      for (const key of ["interest", "background", "goal", "difficulty", "access", "feasibility"]) {
        delete breakdown[key];
      }
      return { ...recommendation, scoreBreakdown: breakdown } as typeof recommendation;
    });

    expect(saveRecommendationResult(modern, storage).ok).toBe(true);
    const read = readSavedCompetitionStore(storage);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.entries[0].recommendation).toMatchObject({
      matchScore: 95,
      scoreCalibration: { version: "competition-score-calibration.v1", adjustment: 5.3 },
      scoreBreakdown: { subjectTask: 22, dataConfidence: 5 }
    });
  });

  it("保存前拒绝超上限、七维求和不一致、校准公式错误和排名错位", () => {
    const mutations: Array<(input: SaveRecommendationResultInput) => void> = [
      (input) => { input.recommendations[0].scoreBreakdown.subjectTask = 26; },
      (input) => { input.recommendations[0].baseMatchScore = 89; },
      (input) => { input.recommendations[0].scoreCalibration.alignment = 0.2; },
      (input) => { input.recommendations[0].scoreCalibration.adjustment = 1; },
      (input) => { input.recommendations[1].rank = 3; },
      (input) => { input.recommendations[1].recommendationRole = "reference"; }
    ];

    for (const mutate of mutations) {
      const invalid = result();
      mutate(invalid);
      expect(saveRecommendationResult(invalid, new MemoryStorage())).toMatchObject({
        ok: false,
        reason: "invalid-recommendations"
      });
    }
  });

  it("将篡改过七维求和或校准分的已存 V2 数据视为损坏", () => {
    const storage = new MemoryStorage();
    expect(saveRecommendationResult(result(), storage).ok).toBe(true);
    const malformed = JSON.parse(storage.getItem(SAVED_COMPETITIONS_STORAGE_KEY) ?? "{}");
    malformed.entries[0].recommendation.matchScore -= 0.1;
    storage.setItem(SAVED_COMPETITIONS_STORAGE_KEY, JSON.stringify(malformed));

    expect(readSavedCompetitionStore(storage)).toMatchObject({ ok: false, reason: "corrupt" });
  });

  it("拒绝让缺少综合分字段的新形状伪装成 V2 历史数据", () => {
    const storage = new MemoryStorage();
    expect(saveRecommendationResult(result(), storage).ok).toBe(true);
    const malformed = JSON.parse(storage.getItem(SAVED_COMPETITIONS_STORAGE_KEY) ?? "{}");
    delete malformed.entries[0].recommendation.recommendationRole;
    delete malformed.entries[0].recommendation.matchScore;
    delete malformed.entries[0].recommendation.scoreCalibration;
    storage.setItem(SAVED_COMPETITIONS_STORAGE_KEY, JSON.stringify(malformed));

    expect(readSavedCompetitionStore(storage)).toMatchObject({ ok: false, reason: "corrupt" });
  });

  it("拒绝给参考匹配伪造校准加成", () => {
    const storage = new MemoryStorage();
    const invalid = result();
    invalid.recommendations = invalid.recommendations.map((recommendation, index) => index === 2
      ? { ...recommendation, role: "reference" as const, recommendationRole: "reference" as const }
      : recommendation);

    expect(saveRecommendationResult(invalid, storage)).toMatchObject({
      ok: false,
      reason: "invalid-recommendations"
    });

    invalid.recommendations = invalid.recommendations.map((recommendation, index) => index === 2
      ? {
        ...recommendation,
        role: "reference" as const,
        recommendationRole: "reference" as const,
        matchScore: recommendation.baseMatchScore!,
        scoreCalibration: {
          ...recommendation.scoreCalibration!,
          qualified: false,
          adjustment: 0
        }
      }
      : recommendation);
    expect(saveRecommendationResult(invalid, storage).ok).toBe(true);
  });

  it("支持单项移除与清空全部", () => {
    const storage = new MemoryStorage();
    saveRecommendationResult(result(), storage);

    const removed = removeSavedCompetition("competition-2", storage);
    expect(removed.ok && removed.value.entries.map((entry) => entry.competitionId)).toEqual([
      "competition-1",
      "competition-3"
    ]);

    const cleared = clearSavedCompetitionStore(storage);
    expect(cleared.ok && cleared.value.entries).toEqual([]);
    expect(storage.getItem(SAVED_COMPETITIONS_STORAGE_KEY)).toBeNull();
  });

  it("不会自动覆盖损坏数据", () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVED_COMPETITIONS_STORAGE_KEY, "{not-json");

    expect(readSavedCompetitionStore(storage)).toMatchObject({ ok: false, reason: "corrupt" });
    expect(saveRecommendationResult(result(), storage)).toMatchObject({ ok: false, reason: "corrupt" });
    expect(storage.getItem(SAVED_COMPETITIONS_STORAGE_KEY)).toBe("{not-json");
  });

  it("把夹带问答或会话字段的快照视为损坏数据", () => {
    const storage = new MemoryStorage();
    expect(saveRecommendationResult(result(), storage).ok).toBe(true);
    const parsed = JSON.parse(storage.getItem(SAVED_COMPETITIONS_STORAGE_KEY) ?? "{}");
    parsed.entries[0].conversationToken = "must-not-persist";
    storage.setItem(SAVED_COMPETITIONS_STORAGE_KEY, JSON.stringify(parsed));

    expect(readSavedCompetitionStore(storage)).toMatchObject({ ok: false, reason: "corrupt" });
  });

  it("显式报告配额和权限错误", () => {
    const quotaStorage = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      }
    };
    const unavailableStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      removeItem: () => undefined,
      setItem: () => undefined
    };

    expect(saveRecommendationResult(result(), quotaStorage)).toMatchObject({ ok: false, reason: "quota" });
    expect(readSavedCompetitionStore(unavailableStorage)).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("拒绝重复的推荐", () => {
    const storage = new MemoryStorage();
    const duplicate = result();
    duplicate.recommendations = duplicate.recommendations.map((item) => ({
      ...item,
      competitionId: "same-id"
    }));

    expect(saveRecommendationResult(duplicate, storage)).toMatchObject({
      ok: false,
      reason: "invalid-recommendations"
    });
  });
});
