import { competitionRankingHoldoutCases } from "./competition-quality-personas";
import {
  COMPETITION_FIT_SIGNALS,
  COMPETITION_PROFILE_FIELD_IDS,
  type CompetitionFitSignal,
  type CompetitionMajorField,
  type CompetitionQuestionnaireFieldId,
  type CompetitionQuestionnaireV1,
  type CompetitionRecommendationProfileV5
} from "../../src/types/competition-recommendation";

export const DEEPSEEK_LIVE_ROUNDS = 3;

export const DEEPSEEK_LIVE_REQUIRED_MAJOR_FIELDS = [
  "computer-science",
  "business",
  "design",
  "engineering",
  "medicine",
  "mathematics",
  "humanities",
  "biology-life-science",
  "chemistry-materials",
  "agriculture-environment",
  "civil-architecture",
  "finance-taxation",
  "public-management",
  "language-culture",
  "physics-geoscience"
] as const satisfies readonly CompetitionMajorField[];

export type DeepSeekLiveStageGroup =
  | "vocational"
  | "undergraduate-lower"
  | "undergraduate-upper"
  | "master"
  | "doctorate"
  | "recent-graduate";

export type DeepSeekLiveTextNormalization = {
  fieldId: CompetitionQuestionnaireFieldId;
  freeText: string;
  confirmedValues: string[];
};

export type DeepSeekLivePersona = {
  id: string;
  stageGroup: DeepSeekLiveStageGroup;
  profile: CompetitionRecommendationProfileV5;
  preferredFitSignals: readonly CompetitionFitSignal[];
  acceptableIds: readonly string[];
  /** A deliberately non-alias answer that must be resolved by DeepSeek. */
  textNormalization: DeepSeekLiveTextNormalization;
};

type ProfileOverrides = Partial<Omit<
  CompetitionRecommendationProfileV5,
  "profileVersion" | "questionnaireVersion" | "confirmedFields" | "confirmedFacts"
>>;

function holdout(caseId: string) {
  const found = competitionRankingHoldoutCases.find(({ id }) => id === caseId);
  if (!found) throw new Error(`Missing live acceptance holdout: ${caseId}`);
  return found;
}

function isFitSignal(value: string): value is CompetitionFitSignal {
  return COMPETITION_FIT_SIGNALS.includes(value as CompetitionFitSignal);
}

function personaFromHoldout(input: {
  caseId: string;
  id?: string;
  stageGroup: DeepSeekLiveStageGroup;
  profile?: ProfileOverrides;
  preferredFitSignals?: readonly CompetitionFitSignal[];
  acceptableIds?: readonly string[];
  textNormalization: DeepSeekLiveTextNormalization;
}): DeepSeekLivePersona {
  const source = holdout(input.caseId);
  const sourceFitSignals = source.transcript
    .filter(({ question }) => question.signalKey === "competition-fit")
    .flatMap(({ answer }) => answer.selectedValues)
    .filter(isFitSignal);
  return {
    id: input.id ?? input.caseId.replace(/^rank-/, ""),
    stageGroup: input.stageGroup,
    profile: {
      ...source.profile,
      ...input.profile,
      confirmedFields: [...COMPETITION_PROFILE_FIELD_IDS],
      confirmedFacts: [...source.profile.confirmedFacts]
    },
    preferredFitSignals: input.preferredFitSignals ?? sourceFitSignals,
    acceptableIds: input.acceptableIds ?? source.labels.map(({ competitionId }) => competitionId),
    textNormalization: input.textNormalization
  };
}

/**
 * Twenty-one independent expert-labelled V5 scenarios. The set deliberately
 * covers every first-class discipline, every education band, and a recent
 * graduate fact while keeping labels separate from the live model output.
 */
export const deepSeekLivePersonas: readonly DeepSeekLivePersona[] = [
  personaFromHoldout({
    caseId: "rank-vocational-algorithm",
    stageGroup: "vocational",
    profile: { skills: ["programming"], majorFields: ["computer-science"] },
    textNormalization: {
      fieldId: "startingPoint",
      freeText: "我手里已经有能跑通主要流程的初版成果，接下来还要打磨",
      confirmedValues: ["prototype"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-vocational-business-simulation",
    stageGroup: "vocational",
    profile: {
      majorFields: ["business", "finance-taxation"],
      skills: ["accounting-finance", "data-analysis", "presentation"],
      interests: ["finance-taxation", "data", "career"]
    },
    textNormalization: {
      fieldId: "weeklyCommitment",
      freeText: "平时每周大概能安排六到八个小时认真准备",
      confirmedValues: ["5-10"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-vocational-robotics",
    stageGroup: "vocational",
    profile: { majorFields: ["engineering", "computer-science"] },
    textNormalization: {
      fieldId: "participationMode",
      freeText: "线上线下我都能配合，去外地参赛也没有问题",
      confirmedValues: ["flexible"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-vocational-visual-design",
    stageGroup: "vocational",
    profile: { majorFields: ["design"] },
    textNormalization: {
      fieldId: "participationTiming",
      freeText: "本届或下一届都可以，我不限定开始时间",
      confirmedValues: ["flexible"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-vocational-career-language",
    stageGroup: "vocational",
    profile: {
      majorFields: ["humanities", "language-culture"],
      skills: ["language", "writing", "presentation"],
      interests: ["career", "culture-language", "language-communication"]
    },
    textNormalization: {
      fieldId: "startingPoint",
      freeText: "核心功能已经做出来，目前正在进行初版迭代",
      confirmedValues: ["prototype"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-undergraduate-lower-algorithm",
    stageGroup: "undergraduate-lower",
    profile: { stage: "undergraduate-1", majorFields: ["computer-science", "mathematics"] },
    textNormalization: {
      fieldId: "weeklyCommitment",
      freeText: "一周可以稳定拿出七个小时左右参赛",
      confirmedValues: ["5-10"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-undergraduate-lower-business-simulation",
    stageGroup: "undergraduate-lower",
    profile: { majorFields: ["business", "finance-taxation"] },
    textNormalization: {
      fieldId: "participationMode",
      freeText: "对参赛地点没有限制，远程或现场均可",
      confirmedValues: ["flexible"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-undergraduate-lower-robotics",
    stageGroup: "undergraduate-lower",
    profile: { majorFields: ["engineering", "computer-science"] },
    textNormalization: {
      fieldId: "participationTiming",
      freeText: "时间安排很灵活，近期和以后举办的都愿意准备",
      confirmedValues: ["flexible"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-undergraduate-lower-visual-design",
    stageGroup: "undergraduate-lower",
    profile: { majorFields: ["design", "humanities"] },
    textNormalization: {
      fieldId: "startingPoint",
      freeText: "已经完成第一版作品，现在有内容可以直接演示",
      confirmedValues: ["prototype"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-undergraduate-lower-career-language",
    stageGroup: "undergraduate-lower",
    profile: { majorFields: ["humanities", "language-culture"] },
    textNormalization: {
      fieldId: "weeklyCommitment",
      freeText: "课程之外每周能投入约五到十个小时",
      confirmedValues: ["5-10"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-undergraduate-upper-chemistry-lab",
    stageGroup: "undergraduate-upper",
    profile: {
      stage: "undergraduate-3",
      majorFields: ["chemistry-materials"],
      skills: ["laboratory", "research", "data-analysis"],
      interests: ["chemistry-materials", "academic-research"]
    },
    textNormalization: {
      fieldId: "participationMode",
      freeText: "无论在线参加还是到现场，我都可以安排",
      confirmedValues: ["flexible"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-undergraduate-upper-digital-building",
    stageGroup: "undergraduate-upper",
    profile: {
      majorFields: ["civil-architecture"],
      skills: ["structural-design", "design", "fieldwork"],
      interests: ["civil-architecture", "design", "engineering"]
    },
    textNormalization: {
      fieldId: "participationTiming",
      freeText: "什么时候开赛都能考虑，不必只看当前报名期",
      confirmedValues: ["flexible"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-undergraduate-upper-medical-research",
    stageGroup: "undergraduate-upper",
    profile: {
      majorFields: ["medicine", "biology-life-science"],
      skills: ["laboratory", "research", "data-analysis"],
      interests: ["medicine-health", "biology-life-science", "academic-research"]
    },
    textNormalization: {
      fieldId: "startingPoint",
      freeText: "现有成果已能完整跑通，但还处在雏形打磨阶段",
      confirmedValues: ["prototype"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-undergraduate-upper-finance-tax",
    stageGroup: "undergraduate-upper",
    profile: {
      majorFields: ["finance-taxation", "business"],
      skills: ["accounting-finance", "data-analysis", "research"],
      interests: ["finance-taxation", "data", "career"]
    },
    textNormalization: {
      fieldId: "weeklyCommitment",
      freeText: "我通常每周有八小时左右用来做项目",
      confirmedValues: ["5-10"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-undergraduate-upper-electronics",
    stageGroup: "undergraduate-upper",
    profile: {
      majorFields: ["physics-geoscience", "engineering"],
      skills: ["laboratory", "hardware", "research"],
      interests: ["physics-geoscience", "engineering", "innovation"]
    },
    textNormalization: {
      fieldId: "participationMode",
      freeText: "比赛采用哪种形式都行，需要跨城也能去",
      confirmedValues: ["flexible"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-master-modeling",
    stageGroup: "master",
    profile: { majorFields: ["mathematics", "computer-science"] },
    textNormalization: {
      fieldId: "weeklyCommitment",
      freeText: "每周至少可以拿出十二个小时推进",
      confirmedValues: ["over-10"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-master-ai-research",
    stageGroup: "master",
    profile: { majorFields: ["computer-science", "mathematics"] },
    textNormalization: {
      fieldId: "startingPoint",
      freeText: "手里已有可操作的雏形和实现代码，可以继续迭代",
      confirmedValues: ["prototype"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-master-public-management",
    stageGroup: "master",
    profile: {
      majorFields: ["public-management", "humanities"],
      skills: ["policy-analysis", "research", "writing"],
      interests: ["public-management", "academic-research", "career"]
    },
    textNormalization: {
      fieldId: "participationTiming",
      freeText: "当前届合适就参加，错过了也愿意等下一届",
      confirmedValues: ["flexible"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-doctorate-or-recent-culture",
    stageGroup: "doctorate",
    profile: {
      majorFields: ["language-culture", "humanities"],
      skills: ["language", "writing", "research"],
      interests: ["culture-language", "language-communication", "academic-research"]
    },
    textNormalization: {
      fieldId: "participationMode",
      freeText: "地点和形式都不构成限制，我可以灵活配合",
      confirmedValues: ["flexible"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-doctorate-or-recent-electronics",
    id: "doctorate-agriculture-environment",
    stageGroup: "doctorate",
    profile: {
      majorFields: ["agriculture-environment", "engineering"],
      skills: ["fieldwork", "hardware", "research"],
      interests: ["agriculture-environment", "engineering", "robotics"],
      taskFormats: ["hardware", "research", "product"],
      preferredOutputs: ["prototype", "research-paper"],
      availableResources: ["mentor", "lab", "equipment"],
      evidence: ["prototype", "paper"]
    },
    preferredFitSignals: ["sustainability-impact", "hardware-build", "research-provenance"],
    acceptableIds: [
      "smart-agricultural-equipment",
      "energy-conservation-emission-reduction",
      "energy-economics-academic-creativity",
      "green-development"
    ],
    textNormalization: {
      fieldId: "weeklyCommitment",
      freeText: "一星期能稳定投入十五小时左右",
      confirmedValues: ["over-10"]
    }
  }),
  personaFromHoldout({
    caseId: "rank-undergraduate-lower-career-language",
    id: "recent-graduate-career",
    stageGroup: "recent-graduate",
    profile: {
      stage: "undergraduate-4",
      enrollmentStatus: "recent-graduate",
      majorFields: ["public-management", "language-culture"],
      skills: ["policy-analysis", "writing", "presentation"],
      interests: ["career", "public-management", "culture-language"]
    },
    preferredFitSignals: ["career-evidence", "language-communication"],
    acceptableIds: ["career-planning", "21st-century-english-speaking", "intercultural-competence"],
    textNormalization: {
      fieldId: "participationTiming",
      freeText: "不急着马上参赛，合适的届次都能接受",
      confirmedValues: ["flexible"]
    }
  })
];

export function questionnaireForDeepSeekLivePersona(
  persona: DeepSeekLivePersona
): CompetitionQuestionnaireV1 {
  const profile = persona.profile;
  const fieldValues: Partial<Record<CompetitionQuestionnaireFieldId, string[]>> = {
    stage: [profile.stage],
    enrollmentStatus: [profile.enrollmentStatus ?? "other"],
    majorFields: [...profile.majorFields],
    specificSubjects: [...profile.specificSubjects],
    skills: [...profile.skills], interests: [...profile.interests], goals: [...profile.goals],
    preferredOutputs: [...profile.preferredOutputs], startingPoint: [profile.startingPoint],
    weeklyCommitment: [profile.weeklyCommitment], teamStatus: [profile.teamStatus],
    teamSize: [profile.teamSize ?? "unsure"], teamUnit: [profile.teamUnit ?? "unsure"],
    availableResources: [...profile.availableResources], participationMode: [profile.participationMode],
    participationTiming: [profile.participationTiming], taskFormats: [...profile.taskFormats],
    experienceLevel: [profile.experienceLevel], evidence: [...profile.evidence],
    ...(profile.firstHigherEducationYear
      ? { firstHigherEducationYear: [String(profile.firstHigherEducationYear)] }
      : {})
  };
  const questionFields = {
    stage: ["stage", "enrollmentStatus", "firstHigherEducationYear"],
    majorFields: ["majorFields", "specificSubjects"],
    skills: ["skills"], interests: ["interests"], taskFormats: ["taskFormats"], goals: ["goals"],
    preferredOutputs: ["preferredOutputs"], startingPoint: ["startingPoint"],
    experienceLevel: ["experienceLevel", "evidence"], weeklyCommitment: ["weeklyCommitment"],
    participationTiming: ["participationTiming"], teamStatus: ["teamStatus", "teamSize", "teamUnit"],
    availableResources: ["availableResources"], participationMode: ["participationMode"]
  } as const satisfies Readonly<Record<CompetitionQuestionnaireV1["answers"][number]["fieldId"], readonly CompetitionQuestionnaireFieldId[]>>;
  const answers: CompetitionQuestionnaireV1["answers"] = Object.entries(questionFields).map(
    ([questionId, fields]) => ({
      fieldId: questionId as CompetitionQuestionnaireV1["answers"][number]["fieldId"],
      selectedValues: fields.flatMap((fieldId) =>
        fieldId === persona.textNormalization.fieldId
          ? []
          : (fieldValues[fieldId] ?? []).map((value) => `${fieldId}:${value}`)
      ),
      ...(fields.includes(persona.textNormalization.fieldId as never)
        ? { freeText: persona.textNormalization.freeText }
        : {})
    })
  );
  return { version: "competition-questionnaire.v1", answers };
}
