import { describe, expect, it } from "vitest";
import { resolveAnalyticsCtaName } from "@/lib/analytics/constants";
import { sanitizeAnalyticsPayload } from "@/lib/analytics/events";

describe("competition recommender analytics", () => {
  it("maps every legitimate CTA source to a stable non-content identifier", () => {
    expect(resolveAnalyticsCtaName("/competitions/recommend", "打开竞赛助手 →"))
      .toBe("competition_assistant");
    expect(resolveAnalyticsCtaName("/competitions", "浏览竞赛信息"))
      .toBe("competition_directory");
    expect(resolveAnalyticsCtaName("", "开始匹配")).toBe("start_match");
    expect(resolveAnalyticsCtaName("", "同意，请乐乐开始匹配")).toBe("start_match");
    expect(resolveAnalyticsCtaName("", "重新匹配一次")).toBe("retry_match");
    expect(resolveAnalyticsCtaName("", "返回匹配结果")).toBe("return_results");
    expect(resolveAnalyticsCtaName("", "student@example.com 请帮我匹配")).toBeNull();
  });

  it("keeps only result metadata and in-site IDs", () => {
    expect(
      sanitizeAnalyticsPayload("competition_recommend_completed", {
        resultCount: 3,
        fallbackUsed: true,
        fallbackMode: "partial",
        fallbackReason: "invalid_output",
        provider: "deepseek",
        competitionIds: "iot-design,national-college-math-modeling,graduate-rural-revitalization-agritech",
        questionnaire: { major: "computer-science" },
        otherContext: "private answer"
      })
    ).toEqual({
      resultCount: 3,
      fallbackUsed: true,
      fallbackMode: "partial",
      fallbackReason: "invalid_output",
      provider: "deepseek",
      competitionIds: "iot-design,national-college-math-modeling,graduate-rural-revitalization-agritech"
    });
  });

  it("keeps only a controlled failure reason", () => {
    expect(
      sanitizeAnalyticsPayload("competition_recommend_failed", {
        failureReason: "rate_limited",
        errorMessage: "private upstream response"
      })
    ).toEqual({ failureReason: "rate_limited" });
  });

  it("tracks resource and team opens by in-site ID without file or QR content", () => {
    const unsafeDetails = {
      competitionId: "national-college-math-modeling",
      href: "/private/template.pptx",
      qrSrc: "data:image/png;base64,secret",
      operator: "private group"
    };

    expect(sanitizeAnalyticsPayload("competition_resource_open", unsafeDetails)).toEqual({
      competitionId: "national-college-math-modeling"
    });
    expect(sanitizeAnalyticsPayload("competition_team_open", unsafeDetails)).toEqual({
      competitionId: "national-college-math-modeling"
    });
  });

  it("accepts only enumerated metadata and internal route paths", () => {
    expect(sanitizeAnalyticsPayload("cta_click", {
      source: "direct",
      device: "desktop",
      path: "/competitions",
      position: "/competitions",
      ctaName: "competition_assistant"
    })).toEqual({
      source: "direct",
      device: "desktop",
      path: "/competitions",
      position: "/competitions",
      ctaName: "competition_assistant"
    });

    for (const payload of [
      { source: "campaign-42" },
      { device: "bot" },
      { path: "https://attacker.example/collect" },
      { path: "/competitions?email=student@example.com" }
    ]) {
      expect(sanitizeAnalyticsPayload("page_view_home", payload)).toBeNull();
    }
    expect(sanitizeAnalyticsPayload("cta_click", {
      ctaName: "student@example.com",
      position: "/competitions"
    })).toBeNull();
    expect(sanitizeAnalyticsPayload("cta_click", {
      ctaName: "competition_assistant",
      position: "/competitions",
      path: "/about"
    })).toBeNull();
  });

  it("rejects unknown, legacy, duplicate, and inconsistent competition result IDs", () => {
    for (const competitionId of [
      "unknown-competition",
      "ai-application-scenarios",
      "student@example.com"
    ]) {
      expect(sanitizeAnalyticsPayload("competition_detail_open", { competitionId })).toBeNull();
    }

    const validResult = {
      resultCount: 2,
      fallbackUsed: false,
      fallbackMode: "none",
      provider: "server",
      competitionIds: "iot-design,national-college-math-modeling"
    };
    expect(sanitizeAnalyticsPayload("competition_recommend_completed", validResult)).toEqual(validResult);
    const noMatch = {...validResult, resultCount: 0, competitionIds: ""};
    expect(sanitizeAnalyticsPayload("competition_recommend_completed", noMatch)).toEqual(noMatch);
    expect(sanitizeAnalyticsPayload("competition_recommend_completed", {
      ...validResult,
      competitionIds: "iot-design,iot-design"
    })).toBeNull();
    expect(sanitizeAnalyticsPayload("competition_recommend_completed", {
      ...validResult,
      resultCount: 3
    })).toBeNull();
  });

  it("rejects out-of-range result metadata, invalid enums, and inconsistent fallback state", () => {
    const validFallback = {
      resultCount: 1,
      fallbackUsed: true,
      fallbackMode: "full",
      fallbackReason: "timeout",
      provider: "deepseek",
      competitionIds: "iot-design"
    };
    expect(sanitizeAnalyticsPayload("competition_recommend_completed", validFallback)).toEqual(validFallback);

    for (const override of [
      { resultCount: 0 },
      { resultCount: 1.5 },
      { resultCount: 11 },
      { fallbackMode: "sometimes" },
      { fallbackReason: "raw upstream error: student@example.com" },
      { provider: "attacker-provider" },
      { fallbackUsed: false, fallbackMode: "none" }
    ]) {
      expect(sanitizeAnalyticsPayload("competition_recommend_completed", {
        ...validFallback,
        ...override
      })).toBeNull();
    }
    expect(sanitizeAnalyticsPayload("competition_recommend_failed", {
      failureReason: "request_failed: student@example.com"
    })).toBeNull();
  });

  it("rejects forbidden PII keys and non-object payload representations", () => {
    expect(sanitizeAnalyticsPayload("page_view_home", { Email: "student@example.com" })).toBeNull();
    expect(sanitizeAnalyticsPayload("page_view_home", [])).toBeNull();
    expect(sanitizeAnalyticsPayload("page_view_home", "garbage")).toBeNull();
  });
});
