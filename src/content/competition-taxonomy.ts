import type { CompetitionSubjectArea } from "@/content/competitions";
import type {
  CompetitionInterest,
  CompetitionMajorField,
  CompetitionSkill
} from "@/types/competition-recommendation";

export type CompetitionTaxonomySignals = {
  majors: readonly CompetitionMajorField[];
  skills: readonly CompetitionSkill[];
  interests: readonly CompetitionInterest[];
};

/**
 * Editorial soft-match signals derived only from a catalog entry's subject tags.
 * They never express official eligibility and are intentionally kept separate
 * from evidence-backed stages, team rules, schedules and resource requirements.
 */
export const COMPETITION_SUBJECT_PROFILE_SIGNALS = {
  "medicine-health": {
    majors: ["medicine"],
    skills: ["laboratory", "research"],
    interests: ["medicine-health"]
  },
  "civil-architecture": {
    majors: ["civil-architecture"],
    skills: ["structural-design", "fieldwork"],
    interests: ["civil-architecture"]
  },
  "visual-communication": {
    majors: ["design"],
    skills: ["design", "presentation"],
    interests: ["design", "media"]
  },
  "engineering-practice": {
    majors: ["engineering"],
    skills: ["hardware", "structural-design"],
    interests: ["engineering"]
  },
  "chemistry-chemical": {
    majors: ["chemistry-materials"],
    skills: ["laboratory", "research"],
    interests: ["chemistry-materials"]
  },
  "geoscience-surveying": {
    majors: ["physics-geoscience", "civil-architecture"],
    skills: ["fieldwork", "data-analysis"],
    interests: ["physics-geoscience"]
  },
  "physics-optics": {
    majors: ["physics-geoscience"],
    skills: ["laboratory", "research", "hardware"],
    interests: ["physics-geoscience"]
  },
  "mechanics-materials": {
    majors: ["chemistry-materials", "engineering"],
    skills: ["laboratory", "structural-design"],
    interests: ["chemistry-materials", "engineering"]
  },
  "information-communication": {
    majors: ["computer-science", "engineering"],
    skills: ["programming", "hardware"],
    interests: ["data", "engineering"]
  },
  "biology-life-science": {
    majors: ["biology-life-science"],
    skills: ["laboratory", "research"],
    interests: ["biology-life-science"]
  },
  "robotics-automation": {
    majors: ["engineering", "computer-science"],
    skills: ["hardware", "programming"],
    interests: ["robotics"]
  },
  "water-environment": {
    majors: ["agriculture-environment"],
    skills: ["fieldwork", "laboratory", "data-analysis"],
    interests: ["agriculture-environment"]
  },
  "cybersecurity-systems": {
    majors: ["computer-science"],
    skills: ["programming", "research"],
    interests: ["data"]
  },
  "statistics-mathematics": {
    majors: ["mathematics"],
    skills: ["data-analysis", "research"],
    interests: ["data", "academic-research"]
  },
  "finance-accounting": {
    majors: ["finance-taxation"],
    skills: ["accounting-finance", "data-analysis"],
    interests: ["finance-taxation"]
  },
  "digital-construction": {
    majors: ["civil-architecture"],
    skills: ["structural-design", "design"],
    interests: ["civil-architecture"]
  },
  "agriculture-equipment": {
    majors: ["agriculture-environment", "engineering"],
    skills: ["fieldwork", "hardware"],
    interests: ["agriculture-environment"]
  },
  "language-culture": {
    majors: ["language-culture"],
    skills: ["language", "writing"],
    interests: ["culture-language"]
  },
  "public-management": {
    majors: ["public-management"],
    skills: ["policy-analysis", "research"],
    interests: ["public-management"]
  },
  "vocational-skills": {
    majors: ["engineering", "business"],
    skills: ["hardware", "product"],
    interests: ["career"]
  },
  "synthetic-biology": {
    majors: ["biology-life-science", "engineering"],
    skills: ["laboratory", "research"],
    interests: ["biology-life-science", "innovation"]
  },
  "legal-studies": {
    majors: ["humanities"], skills: ["writing", "research", "presentation"], interests: ["public-management"]
  },
  "computing-algorithms": {
    majors: ["computer-science", "mathematics"], skills: ["programming"], interests: ["data"]
  },
  "business-innovation": {
    majors: ["business"], skills: ["product", "presentation"], interests: ["entrepreneurship"]
  },
  "arts-performance": {
    majors: ["design", "humanities"], skills: ["presentation", "design"], interests: ["media", "culture-language"]
  },
  "tourism-planning": {
    majors: ["language-culture", "public-management", "business"],
    skills: ["fieldwork", "policy-analysis", "presentation"],
    interests: ["culture-language", "public-management"]
  }
} as const satisfies Record<CompetitionSubjectArea, CompetitionTaxonomySignals>;

function unique<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)];
}

export function getCompetitionTaxonomySignals(
  subjects: readonly CompetitionSubjectArea[]
): CompetitionTaxonomySignals {
  const signals = subjects.map((subject) => COMPETITION_SUBJECT_PROFILE_SIGNALS[subject]);
  return {
    majors: unique(signals.flatMap(({ majors }) => majors)),
    skills: unique(signals.flatMap(({ skills }) => skills)),
    interests: unique(signals.flatMap(({ interests }) => interests))
  };
}

export function enrichCompetitionTaxonomy(
  existing: CompetitionTaxonomySignals,
  subjects: readonly CompetitionSubjectArea[]
): CompetitionTaxonomySignals {
  const mapped = getCompetitionTaxonomySignals(subjects);
  return {
    // Subject-derived values come first so a three-choice user profile retains
    // the discipline signal instead of collapsing back to a broad legacy tag.
    majors: unique([...mapped.majors, ...existing.majors]),
    skills: unique([...mapped.skills, ...existing.skills]),
    interests: unique([...mapped.interests, ...existing.interests])
  };
}
