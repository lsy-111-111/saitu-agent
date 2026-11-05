import series from "@/content/competition-series-20261104.json";
import { describe, expect, it } from "vitest";
import {
  COMPETITION_SUBJECT_PROFILE_SIGNALS,
  getCompetitionTaxonomySignals
} from "@/content/competition-taxonomy";
import { competitions, type CompetitionSubjectArea } from "@/content/competitions";
import {
  COMPETITION_QUESTIONNAIRE_FIELD_SPECS,
  normalizeCompetitionQuestionnaire
} from "@/lib/ai/competition-questionnaire";
import type {
  CompetitionQuestionnaireFieldId,
  CompetitionQuestionnaireV1
} from "@/types/competition-recommendation";

const specialistSignals = [
  ["medicine-health", "medicine", "medicine-health"],
  ["biology-life-science", "biology-life-science", "biology-life-science"],
  ["chemistry-chemical", "chemistry-materials", "chemistry-materials"],
  ["agriculture-equipment", "agriculture-environment", "agriculture-environment"],
  ["civil-architecture", "civil-architecture", "civil-architecture"],
  ["language-culture", "language-culture", "culture-language"],
  ["finance-accounting", "finance-taxation", "finance-taxation"],
  ["public-management", "public-management", "public-management"],
  ["physics-optics", "physics-geoscience", "physics-geoscience"]
] as const satisfies readonly [CompetitionSubjectArea, string, string][];

function questionnaireWithText(
  fieldId: "majorFields" | "specificSubjects" | "skills" | "interests",
  freeText: string
): CompetitionQuestionnaireV1 {
  const fieldAnswers = [
    { fieldId: "stage", selectedValues: ["undergraduate-3"] },
    { fieldId: "majorFields", selectedValues: ["computer-science"] },
    { fieldId: "specificSubjects", selectedValues: ["information-communication"] },
    { fieldId: "skills", selectedValues: ["programming"] },
    { fieldId: "interests", selectedValues: ["ai"] },
    { fieldId: "goals", selectedValues: ["project"] },
    { fieldId: "preferredOutputs", selectedValues: ["software"] },
    { fieldId: "startingPoint", selectedValues: ["prototype"] },
    { fieldId: "weeklyCommitment", selectedValues: ["5-10"] },
    { fieldId: "teamStatus", selectedValues: ["partial"] },
    { fieldId: "availableResources", selectedValues: ["mentor"] },
    { fieldId: "participationMode", selectedValues: ["flexible"] },
    { fieldId: "participationTiming", selectedValues: ["next-cycle-ok"] },
    { fieldId: "taskFormats", selectedValues: ["research"] },
    { fieldId: "experienceLevel", selectedValues: ["participated"] },
    { fieldId: "evidence", selectedValues: ["project"] },
    { fieldId: "enrollmentStatus", selectedValues: ["full-time-student"] },
    { fieldId: "teamSize", selectedValues: ["three"] },
    { fieldId: "teamUnit", selectedValues: ["same-unit"] }
  ] as const;
  const questionFields = {
    stage: ["stage", "enrollmentStatus"],
    majorFields: ["majorFields", "specificSubjects"],
    skills: ["skills"], interests: ["interests"], taskFormats: ["taskFormats"], goals: ["goals"],
    preferredOutputs: ["preferredOutputs"], startingPoint: ["startingPoint"],
    experienceLevel: ["experienceLevel", "evidence"], weeklyCommitment: ["weeklyCommitment"],
    participationTiming: ["participationTiming"], teamStatus: ["teamStatus", "teamSize", "teamUnit"],
    availableResources: ["availableResources"], participationMode: ["participationMode"]
  } as const;
  return {
    version: "competition-questionnaire.v1",
    answers: Object.entries(questionFields).map(([questionId, subfields]) => ({
      fieldId: questionId as CompetitionQuestionnaireV1["answers"][number]["fieldId"],
      selectedValues: subfields.flatMap((subfield) => {
        if (subfield === fieldId) return [];
        const answer = fieldAnswers.find((candidate) => candidate.fieldId === subfield);
        return answer?.selectedValues.map((value) => `${subfield}:${value}`) ?? [];
      }),
      ...(subfields.includes(fieldId as never) ? { freeText } : {})
    }))
  };
}

describe("competition specialist taxonomy", () => {
  it("gives every required specialist subject a distinct discipline signal", () => {
    const signatures = specialistSignals.map(([subject, expectedMajor, expectedInterest]) => {
      const signals = getCompetitionTaxonomySignals([subject]);
      expect(signals.majors).toContain(expectedMajor);
      expect(signals.interests).toContain(expectedInterest);
      return `${signals.majors[0]}:${signals.interests[0]}`;
    });

    expect(new Set(signatures).size).toBe(specialistSignals.length);
    expect(COMPETITION_SUBJECT_PROFILE_SIGNALS["medicine-health"].skills).toContain("laboratory");
    expect(COMPETITION_SUBJECT_PROFILE_SIGNALS["civil-architecture"].skills).toContain("structural-design");
    expect(COMPETITION_SUBJECT_PROFILE_SIGNALS["finance-accounting"].skills).toContain("accounting-finance");
    expect(COMPETITION_SUBJECT_PROFILE_SIGNALS["public-management"].skills).toContain("policy-analysis");
    expect(COMPETITION_SUBJECT_PROFILE_SIGNALS["language-culture"].skills).toContain("language");
    expect(COMPETITION_SUBJECT_PROFILE_SIGNALS["geoscience-surveying"].skills).toContain("fieldwork");
  });

  it("enriches all catalog entries from subjects without removing legacy signals", () => {
    expect(competitions).toHaveLength(100 + series.length);
    for (const competition of competitions) {
      const subjects = competition.recommendation.subjects ?? [];
      expect(subjects.length, competition.id).toBeGreaterThan(0);
      const expected = getCompetitionTaxonomySignals(subjects);
      expect(competition.recommendation.majors, competition.id).toEqual(expect.arrayContaining([...expected.majors]));
      expect(competition.recommendation.skills, competition.id).toEqual(expect.arrayContaining([...expected.skills]));
      expect(competition.recommendation.interests, competition.id).toEqual(expect.arrayContaining([...expected.interests]));
    }
  });

  it("keeps specialist pure-text answers inside deterministic field whitelists", () => {
    const cases = [
      ["majorFields", "生命科学", "biology-life-science"],
      ["majorFields", "化工", "chemistry-materials"],
      ["majorFields", "农学", "agriculture-environment"],
      ["majorFields", "土木", "civil-architecture"],
      ["majorFields", "会计", "finance-taxation"],
      ["majorFields", "公管", "public-management"],
      ["majorFields", "外语", "language-culture"],
      ["majorFields", "地质", "physics-geoscience"],
      ["specificSubjects", "集成电路", "information-communication"],
      ["specificSubjects", "网络安全", "cybersecurity-systems"],
      ["specificSubjects", "合成生物", "synthetic-biology"],
      ["specificSubjects", "旅游管理", "tourism-planning"],
      ["skills", "实验技能", "laboratory"],
      ["skills", "BIM", "structural-design"],
      ["skills", "财务分析", "accounting-finance"],
      ["skills", "政策分析", "policy-analysis"],
      ["skills", "翻译", "language"],
      ["skills", "野外调查", "fieldwork"],
      ["interests", "医学与健康", "medicine-health"],
      ["interests", "生物与生命科学", "biology-life-science"],
      ["interests", "化学化工与材料", "chemistry-materials"],
      ["interests", "农林水利与环境", "agriculture-environment"],
      ["interests", "土木建筑与数字建造", "civil-architecture"],
      ["interests", "语言文化与经典传播", "culture-language"],
      ["interests", "财税金融与企业经营", "finance-taxation"],
      ["interests", "公共管理与社会治理", "public-management"],
      ["interests", "物理光电与地球科学", "physics-geoscience"]
    ] as const satisfies readonly ["majorFields" | "specificSubjects" | "skills" | "interests", string, string][];

    for (const [fieldId, freeText, expectedValue] of cases) {
      const result = normalizeCompetitionQuestionnaire(questionnaireWithText(fieldId, freeText));
      expect(result.ok, `${fieldId}: ${freeText}`).toBe(true);
      if (!result.ok) continue;
      expect(result.interpretations.find((item) => item.fieldId === fieldId)).toMatchObject({
        source: "deterministic",
        suggestedValues: [expectedValue],
        requiresConfirmation: true
      });
    }

    for (const fieldId of ["majorFields", "specificSubjects", "skills", "interests"] as CompetitionQuestionnaireFieldId[]) {
      expect(COMPETITION_QUESTIONNAIRE_FIELD_SPECS[fieldId].maxSelections).toBe(3);
    }
  });
});
