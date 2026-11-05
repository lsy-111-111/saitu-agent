import { describe, expect, it } from "vitest";
import type { CompetitionSchedule } from "@/content/competitions";
import { deriveCompetitionAvailability } from "@/lib/competitions/availability";
import { findCatalogCompetition } from "@/lib/competitions/catalog";

const baseSchedule: CompetitionSchedule = {
  state: "scheduled",
  edition: "test",
  registrationStart: "2026-08-01",
  registrationEnd: "2026-08-02",
  datePrecision: "day",
  verifiedAt: "2026-08-02",
  sourceUrl: "https://example.edu/official",
  sourceType: "organizer"
};

describe("competition availability", () => {
  it("uses the end of the calendar day in Asia/Shanghai as the deadline", () => {
    expect(deriveCompetitionAvailability(baseSchedule, new Date("2026-08-02T15:59:59.999Z")).registrationStatus.status).toBe(
      "open"
    );
    expect(deriveCompetitionAvailability(baseSchedule, new Date("2026-08-02T16:00:00.000Z")).registrationStatus.status).toBe(
      "closed"
    );
  });

  it("uses strict month precision and Shanghai month boundaries", () => {
    const monthSchedule: CompetitionSchedule = {
      ...baseSchedule,
      registrationStart: "2026-08",
      registrationEnd: "2026-08",
      datePrecision: "month",
      verifiedAt: "2026-07-31"
    };

    expect(
      deriveCompetitionAvailability(monthSchedule, new Date("2026-07-31T15:59:59.999Z")).registrationStatus.status
    ).toBe("upcoming");
    expect(
      deriveCompetitionAvailability(monthSchedule, new Date("2026-07-31T16:00:00.000Z")).registrationStatus.status
    ).toBe("open");
    expect(
      deriveCompetitionAvailability(monthSchedule, new Date("2026-08-31T15:59:59.999Z")).registrationStatus.status
    ).toBe("open");
    expect(
      deriveCompetitionAvailability(monthSchedule, new Date("2026-08-31T16:00:00.000Z")).registrationStatus.status
    ).toBe("closed");
  });

  it("handles leap-year month ends and rejects invalid or mismatched precision", () => {
    const leapFebruary: CompetitionSchedule = {
      ...baseSchedule,
      registrationStart: "2028-02",
      registrationEnd: "2028-02",
      datePrecision: "month",
      verifiedAt: "2028-02-01"
    };

    expect(
      deriveCompetitionAvailability(leapFebruary, new Date("2028-02-29T15:59:59.999Z")).registrationStatus.status
    ).toBe("open");
    expect(
      deriveCompetitionAvailability(leapFebruary, new Date("2028-02-29T16:00:00.000Z")).registrationStatus.status
    ).toBe("closed");

    for (const registrationStart of ["2028-00", "2028-13", "2028-02-01"]) {
      expect(deriveCompetitionAvailability({
        ...leapFebruary,
        registrationStart
      }, new Date("2028-02-01T00:00:00.000Z")).registrationStatus.status).toBe("unknown");
    }
    expect(deriveCompetitionAvailability({
      ...baseSchedule,
      registrationStart: "2026-08",
      datePrecision: "day"
    }, new Date("2026-08-01T00:00:00.000Z")).registrationStatus.status).toBe("unknown");
    expect(deriveCompetitionAvailability({
      ...baseSchedule,
      datePrecision: "unknown"
    }, new Date("2026-08-01T00:00:00.000Z")).registrationStatus.status).toBe("unknown");
  });

  it("derives current catalog month schedules without changing their facts", () => {
    const chinaGoodDesign = findCatalogCompetition("china-good-design");
    const milanDesignWeek = findCatalogCompetition("milan-design-week-china");
    expect(chinaGoodDesign).not.toBeNull();
    expect(milanDesignWeek).not.toBeNull();

    const now = new Date("2026-08-23T04:00:00.000Z");
    expect(
      deriveCompetitionAvailability(chinaGoodDesign!.recommendation.schedule, now).registrationStatus.status
    ).toBe("open");
    expect(
      deriveCompetitionAvailability(milanDesignWeek!.recommendation.schedule, now).registrationStatus.status
    ).toBe("closed");
  });

  it("puts starts within 90 days in the first availability tier", () => {
    const result = deriveCompetitionAvailability(
      { ...baseSchedule, registrationStart: "2026-10-01", registrationEnd: "2026-10-20" },
      new Date("2026-08-02T04:00:00.000Z")
    );

    expect(result.registrationStatus.status).toBe("upcoming");
    expect(result.tierRank).toBe(1);
  });

  it("treats unknown and stale schedules as unverified rather than open", () => {
    const unknown = deriveCompetitionAvailability(
      { ...baseSchedule, state: "unknown", datePrecision: "unknown" },
      new Date("2026-08-02T00:00:00.000Z")
    );
    const stale = deriveCompetitionAvailability(
      { ...baseSchedule, verifiedAt: "2025-01-01" },
      new Date("2026-08-02T00:00:00.000Z")
    );

    expect(unknown.registrationStatus.status).toBe("unknown");
    expect(stale.registrationStatus.status).toBe("stale");
    expect(unknown.tierRank).toBe(2);
    expect(stale.tierRank).toBe(2);
  });
});
