import { describe, expect, it } from "vitest";
import {
  availableResourceOptions,
  evidenceOptions,
  experienceLevelOptions,
  getOptionLabel,
  goalOptions,
  interestOptions,
  majorFieldOptions,
  participationModeOptions,
  participationTimingOptions,
  preferredOutputOptions,
  regionOptions,
  skillOptions,
  stageOptions,
  startingPointOptions,
  taskFormatOptions,
  teamStatusOptions,
  weeklyCommitmentOptions
} from "@/components/competitions/recommend/questionContent";

describe("competition question option labels", () => {
  it("keeps the fourteen fixed-question option values and labels stable", () => {
    expect(stageOptions.map(({ value }) => value)).toEqual([
      "vocational",
      "undergraduate-1",
      "undergraduate-2",
      "undergraduate-3",
      "undergraduate-4",
      "master",
      "doctorate",
      "other-or-non-full-time"
    ]);
    expect(skillOptions.map(({ value }) => value)).toEqual([
      "programming",
      "data-analysis",
      "research",
      "product",
      "design",
      "hardware",
      "writing",
      "presentation",
      "laboratory",
      "structural-design",
      "accounting-finance",
      "policy-analysis",
      "language",
      "fieldwork"
    ]);
    expect(experienceLevelOptions.map(({ value }) => value)).toEqual([
      "none", "participated", "project-or-award"
    ]);
    expect(evidenceOptions.map(({ value }) => value)).toEqual([
      "project", "paper", "prototype", "portfolio", "award", "none"
    ]);
    expect(majorFieldOptions.map(({ value }) => value)).toEqual([
      "computer-science", "business", "design", "engineering", "medicine",
      "mathematics", "humanities", "biology-life-science", "chemistry-materials",
      "agriculture-environment", "civil-architecture", "finance-taxation",
      "public-management", "language-culture", "physics-geoscience", "other"
    ]);
    expect(interestOptions).toHaveLength(20);
    expect(preferredOutputOptions).toHaveLength(7);
    expect(startingPointOptions).toHaveLength(4);
    expect(weeklyCommitmentOptions).toHaveLength(3);
    expect(teamStatusOptions).toHaveLength(4);
    expect(availableResourceOptions.map(({ value }) => value)).toEqual([
      "mentor", "lab", "equipment", "data", "budget",
      "school-registration", "safety-compliance",
      "none"
    ]);
    expect(regionOptions).toHaveLength(8);
    expect(participationModeOptions).toHaveLength(4);
    expect(participationTimingOptions.map(({ value }) => value)).toEqual([
      "current-cycle", "within-3-months", "next-cycle-ok", "flexible"
    ]);
    expect(taskFormatOptions.map(({ value }) => value)).toEqual([
      "algorithm", "modeling", "software", "hardware", "research",
      "product", "entrepreneurship", "design", "language", "career"
    ]);

    expect(getOptionLabel(stageOptions, "undergraduate-1")).toBe("本科大一");
    expect(getOptionLabel(skillOptions, "product")).toBe("产品策划与需求分析");
    expect(getOptionLabel(interestOptions, "design")).toBe("工业与产品设计");
    expect(getOptionLabel(interestOptions, "academic-research")).toBe("科研学术");
    expect(getOptionLabel(interestOptions, "language-communication")).toBe("语言传播");
    expect(getOptionLabel(majorFieldOptions, "finance-taxation")).toBe("财会、金融与税务");
    expect(getOptionLabel(skillOptions, "policy-analysis")).toBe("政策分析与案例研判");
    expect(getOptionLabel(interestOptions, "agriculture-environment")).toBe("农林水利与环境");
    expect(getOptionLabel(goalOptions, "project")).toBe("积累项目经历");
    expect(getOptionLabel(evidenceOptions, "none")).toBe("暂时没有可展示的材料");
    expect(getOptionLabel(availableResourceOptions, "none")).toBe("暂时没有");
  });

  it("keeps an unknown value readable instead of dropping it", () => {
    expect(getOptionLabel(goalOptions, "future-value")).toBe("future-value");
  });
});
