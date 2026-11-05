import type { Competition } from "@/content/competitions";
import {
  competitionDynamicQuestionFamilyV3,
  competitionDynamicQuestionV3Schema,
  MAX_COMPETITION_DYNAMIC_QUESTIONS
} from "@/lib/ai/competition-dynamic-question";
import {
  getCompetitionCatalog,
  getCompetitionPreferenceQuestionTracks
} from "@/lib/competitions/catalog";
import {
  getCompetitionRecommendationCandidates,
  selectFinalVisibleCompetitionRecommendations,
  type DeterministicCompetitionRecommendation
} from "@/lib/competitions/recommendation-engine";
import {
  COMPETITION_FIT_SIGNALS,
  COMPETITION_GOALS,
  COMPETITION_CLARIFICATION_RESPONSE_VERSION,
  type CompetitionDynamicExchangeV3,
  type CompetitionDynamicQuestionOption,
  type CompetitionDynamicQuestionV3,
  type CompetitionDynamicSignalKeyV3,
  type CompetitionFitSignal,
  type CompetitionGoal,
  type CompetitionQualificationSnapshotV1,
  type CompetitionRecommendationProfileV5
} from "@/types/competition-recommendation";

export const COMPETITION_CLARIFY_PROMPT_VERSION = "competition-clarify.v8" as const;
export const COMPETITION_CLARIFY_POLICY_MODEL = "deterministic-preference-policy.v1" as const;
export const COMPETITION_CLARIFY_CANDIDATE_LIMIT = 10;

type CompetitionClarifyProfile = CompetitionRecommendationProfileV5;

export type CompetitionClarifySimulationOptions = {
  /** Frozen V5 conversation time; never advance it between answer branches. */
  now?: Date;
  /** Defaults to the complete official directory, not the current Top10. */
  catalog?: readonly Competition[];
};

export type CompetitionClarifyAskableQuestion = {
  signalKey: CompetitionDynamicSignalKeyV3;
  target:
    | { kind: "candidate-set"; competitionIds: string[] }
    | { kind: "competition"; competitionId: string; competitionName: string };
  allowedOptionValues: string[];
  optionCatalog: CompetitionDynamicQuestionOption[];
  allowedSelections: ("single" | "multiple")[];
  optionCount: { min: 2; max: 4 | 6 | 8 };
  requiredOptionCount: number;
  /** Distinct ordered Top-3 / selected-track outcomes from legal answer simulations. */
  estimatedPreferenceOutcomeChanges: number;
  /** @deprecated Test-only compatibility alias. */
  estimatedOutcomeChanges: number;
  impact: "material" | "optional";
  maxSelections?: number;
};

export type CompetitionClarificationResponseV6 = {
  ok: true;
  responseVersion: typeof COMPETITION_CLARIFICATION_RESPONSE_VERSION;
  status: "question" | "optional_question" | "completed";
  nextQuestion: CompetitionDynamicQuestionV3 | null;
  promptVersion: typeof COMPETITION_CLARIFY_PROMPT_VERSION;
  model: typeof COMPETITION_CLARIFY_POLICY_MODEL;
  provider: "server";
  fallback: false;
};

/** @deprecated Use the V6 preference-only response. */
export type CompetitionClarificationResponseV5 = CompetitionClarificationResponseV6;
/** @deprecated Use the V6 preference-only response. */
export type CompetitionClarificationResponseV4 = CompetitionClarificationResponseV6;
/** @deprecated Use the V6 preference-only response. */
export type CompetitionClarificationResponseV3 = CompetitionClarificationResponseV6;

export function getCompetitionClarifyModel() {
  return COMPETITION_CLARIFY_POLICY_MODEL;
}

type CompetitionClarifyOutcome = {
  /** Membership, order and selected track are the only material preference outcomes. */
  topThree: readonly {
    competitionId: string;
    recommendedTrackId: string | null;
  }[];
  /** Present only when the track target is visible in this branch's final Top 3. */
  targetTrack?: {
    competitionId: string;
    recommendedTrackId: string | null;
  };
};

/**
 * Goal priority is material only when the ordered visible competition IDs
 * change. A track-only difference belongs to the dedicated track family and
 * must not manufacture an automatic goal follow-up.
 */
export function competitionClarifyMaterialOutcomeSignature(
  signalKey: CompetitionDynamicSignalKeyV3,
  outcome: CompetitionClarifyOutcome
) {
  return signalKey === "candidate-goal-tradeoff"
    ? JSON.stringify(outcome.topThree.map(({ competitionId }) => competitionId))
    : JSON.stringify(outcome);
}

function simulationExchange(
  signalKey: CompetitionDynamicSignalKeyV3,
  selectedValues: readonly string[],
  candidates: readonly DeterministicCompetitionRecommendation[],
  catalog: readonly Competition[]
): CompetitionDynamicExchangeV3 {
  const addFallbackOptions = (
    selected: readonly string[],
    fallback: readonly string[],
    maximum: number
  ) => [...new Set([...selected, ...fallback])].slice(0, maximum);
  const trackFallbackOptions = () => {
    const targetCompetitionId = signalKey.slice("track:".length);
    const targetCompetition = candidates.find(({ competitionId }) =>
      competitionId === targetCompetitionId
    )?.competition ?? catalog.find(({ id }) => id === targetCompetitionId);
    if (!targetCompetition) {
      throw new Error(`Counterfactual track target ${targetCompetitionId} is outside the supplied candidate set`);
    }
    return getCompetitionPreferenceQuestionTracks(targetCompetition).map(({ id }) => id);
  };
  const selection = signalKey === "competition-fit" ? "multiple" as const : "single" as const;
  const optionValues = signalKey === "competition-fit"
    ? addFallbackOptions(selectedValues, COMPETITION_FIT_SIGNALS, 6)
    : signalKey === "candidate-goal-tradeoff"
      ? addFallbackOptions(selectedValues, COMPETITION_GOALS, 4)
      : addFallbackOptions(
          selectedValues,
          trackFallbackOptions(),
          6
        );
  if (optionValues.length < 2) {
    throw new Error(`Counterfactual ${signalKey} requires at least two server-owned options`);
  }
  const question = competitionDynamicQuestionV3Schema.parse({
    questionId: stableQuestionId(signalKey, 0),
    signalKey,
    prompt: "服务端偏好反事实模拟",
    selection,
    ...(selection === "multiple" ? { maxSelections: 2 } : {}),
    options: optionValues.map((value) => ({ value, label: value })),
    allowsNote: true,
    maxNoteLength: 120,
    impact: "material",
    estimatedPreferenceOutcomeChanges: 2
  });
  return {
    question,
    answer: { selectedValues: [...selectedValues] }
  };
}

/**
 * Re-run the production scorer for one legal preference answer. Eligibility is
 * deliberately absent from the outcome signature, so a qualification change
 * can never make a question askable.
 */
export function simulateCompetitionClarifyOutcome(
  profile: CompetitionClarifyProfile,
  allCandidates: readonly DeterministicCompetitionRecommendation[],
  signalKey: CompetitionDynamicSignalKeyV3,
  selectedValue: string | readonly string[],
  priorTranscript: readonly CompetitionDynamicExchangeV3[] = [],
  options: CompetitionClarifySimulationOptions = {}
): CompetitionClarifyOutcome {
  const candidates = allCandidates.slice(0, COMPETITION_CLARIFY_CANDIDATE_LIMIT);
  const catalog = options.catalog ?? getCompetitionCatalog();
  const selectedValues = typeof selectedValue === "string" ? [selectedValue] : [...selectedValue];
  const transcript = [
    ...priorTranscript.filter(({ question }) => question.signalKey !== signalKey),
    simulationExchange(signalKey, selectedValues, candidates, catalog)
  ];
  const simulated = getCompetitionRecommendationCandidates(profile, {
    catalog,
    now: options.now,
    transcript
  }).recommendations;
  // Information gain must reflect the same deterministic, user-visible
  // selection used by production: first put the confirmed subject/task quality
  // union ahead of the remaining Top10, then fill the final three through the
  // four qualification/calibration tiers. Raw recall changes that disappear at
  // this boundary are intentionally not askable.
  const visibleTopThree = selectFinalVisibleCompetitionRecommendations(
    simulated,
    profile,
    transcript
  );
  const targetCompetitionId = signalKey.startsWith("track:")
    ? signalKey.slice("track:".length)
    : null;
  const visibleTarget = targetCompetitionId
    ? visibleTopThree.find(({ competitionId }) => competitionId === targetCompetitionId)
    : undefined;
  return {
    topThree: visibleTopThree.map(({ competitionId, recommendedTrack }) => ({
      competitionId,
      recommendedTrackId: recommendedTrack?.id ?? null
    })),
    ...(targetCompetitionId && visibleTarget
      ? {
          targetTrack: {
            competitionId: targetCompetitionId,
            recommendedTrackId: visibleTarget.recommendedTrack?.id ?? null
          }
        }
      : {})
  };
}

function legalAnswerSets(
  values: readonly string[],
  selection: "single" | "multiple",
  maxSelections?: number
) {
  const answers = values.map((value) => [value]);
  if (selection !== "multiple" || (maxSelections ?? 1) < 2) return answers;
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      answers.push([values[left]!, values[right]!]);
    }
  }
  return answers;
}

function answerSetKey(values: readonly string[]) {
  return [...values].sort().join("\u0000");
}

function fixedSizeSubsets(values: readonly string[], size: number) {
  const subsets: string[][] = [];
  const visit = (start: number, selected: string[]) => {
    if (selected.length === size) {
      subsets.push([...selected]);
      return;
    }
    const remaining = size - selected.length;
    for (let index = start; index <= values.length - remaining; index += 1) {
      selected.push(values[index]!);
      visit(index + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return subsets;
}

/**
 * Pick the UI-bounded option set only after evaluating every server-owned
 * legal value. The callback is memoized per answer set, so subset search never
 * re-runs an expensive scorer branch.
 */
export function selectMaximumInformationOptionSubset(
  optionValues: readonly string[],
  selection: "single" | "multiple",
  maxSelections: number | undefined,
  maximumOptions: number,
  outcomeSignature: (selectedValues: readonly string[]) => string
) {
  const uniqueValues = [...new Set(optionValues)];
  const subsetSize = Math.min(maximumOptions, uniqueValues.length);
  if (subsetSize === 0) return { optionValues: [] as string[], outcomeCount: 0 };

  const outcomeByAnswer = new Map(
    legalAnswerSets(uniqueValues, selection, maxSelections).map((values) => [
      answerSetKey(values),
      outcomeSignature(values)
    ])
  );
  let bestValues = uniqueValues.slice(0, subsetSize);
  let bestOutcomeCount = -1;
  for (const subset of fixedSizeSubsets(uniqueValues, subsetSize)) {
    const signatures = new Set(
      legalAnswerSets(subset, selection, maxSelections).map((values) =>
        outcomeByAnswer.get(answerSetKey(values))!
      )
    );
    if (signatures.size > bestOutcomeCount) {
      bestValues = subset;
      bestOutcomeCount = signatures.size;
    }
  }
  return { optionValues: bestValues, outcomeCount: Math.max(0, bestOutcomeCount) };
}

function actualPreferenceOutcomeChangeCount(
  profile: CompetitionClarifyProfile,
  candidates: readonly DeterministicCompetitionRecommendation[],
  signalKey: CompetitionDynamicSignalKeyV3,
  allowedOptionValues: readonly string[],
  priorTranscript: readonly CompetitionDynamicExchangeV3[],
  selection: "single" | "multiple" = "single",
  maxSelections?: number,
  options: CompetitionClarifySimulationOptions = {}
) {
  return new Set(
    legalAnswerSets(allowedOptionValues, selection, maxSelections).map((values) =>
      competitionClarifyMaterialOutcomeSignature(signalKey, simulateCompetitionClarifyOutcome(
        profile,
        candidates,
        signalKey,
        values,
        priorTranscript,
        options
      ))
    )
  ).size;
}

function maximumInformationOptions(
  profile: CompetitionClarifyProfile,
  candidates: readonly DeterministicCompetitionRecommendation[],
  signalKey: CompetitionDynamicSignalKeyV3,
  allOptionValues: readonly string[],
  priorTranscript: readonly CompetitionDynamicExchangeV3[],
  selection: "single" | "multiple",
  maxSelections: number | undefined,
  maximumOptions: number,
  options: CompetitionClarifySimulationOptions
) {
  return selectMaximumInformationOptionSubset(
    allOptionValues,
    selection,
    maxSelections,
    maximumOptions,
    (selectedValues) => competitionClarifyMaterialOutcomeSignature(
      signalKey,
      simulateCompetitionClarifyOutcome(
        profile,
        candidates,
        signalKey,
        selectedValues,
        priorTranscript,
        options
      )
    )
  );
}

function goalOptionsForCandidates(
  profile: CompetitionClarifyProfile,
  candidates: readonly DeterministicCompetitionRecommendation[]
): CompetitionGoal[] {
  const selected = [...new Set(profile.goals)].slice(0, 2);
  if (selected.length >= 2) return selected;
  const remaining = COMPETITION_GOALS
    .filter((goal) => !selected.includes(goal))
    .map((goal, catalogIndex) => {
      const values = candidates.map(({ competition }) => competition.recommendation.goalValues[goal] ?? 0);
      const maximum = values.length ? Math.max(...values) : 0;
      const minimum = values.length ? Math.min(...values) : 0;
      const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      return { goal, spread: maximum - minimum, maximum, average, catalogIndex };
    })
    .sort((left, right) =>
      right.spread - left.spread ||
      right.maximum - left.maximum ||
      right.average - left.average ||
      left.catalogIndex - right.catalogIndex
    );
  for (const { goal } of remaining) {
    selected.push(goal);
    if (selected.length >= 2) break;
  }
  return selected;
}

function clarifyCandidateTrackFitSignals(
  candidate: DeterministicCompetitionRecommendation
): readonly CompetitionFitSignal[] {
  const track = candidate.recommendedTrack
    ? candidate.competition.recommendation.tracks?.find(({ id }) =>
        id === candidate.recommendedTrack?.id
      )
    : undefined;
  return track?.fitSignals ?? [];
}

function qualificationTrackIds(
  qualificationSnapshot: CompetitionQualificationSnapshotV1 | undefined,
  competitionId: string
) {
  const entry = qualificationSnapshot?.entries.find((item) => item.competitionId === competitionId);
  return new Set(
    entry?.tracks.filter(({ status }) => status !== "ineligible").map(({ trackId }) => trackId) ?? []
  );
}

const fitSignalLabels: Record<(typeof COMPETITION_FIT_SIGNALS)[number], string> = {
  "algorithm-competition": "算法竞速与编程",
  "modeling-intensive": "建模、编程与论文",
  "hardware-build": "电路、嵌入式与联调",
  "software-engineering": "软件工程与系统交付",
  "network-systems": "网络系统与安全实践",
  "robotics-integration": "机器人系统集成与调试",
  "field-research": "实地调研与数据分析",
  "research-provenance": "原创研究与学术证据",
  "product-validation": "产品原型与用户验证",
  "venture-readiness": "创业项目、运营与路演",
  "design-portfolio": "设计作品与作品集",
  "sustainability-impact": "低碳工程与可持续效益",
  "finance-operations": "金融、供应链与经营决策",
  "language-communication": "外语表达与国际传播",
  "career-evidence": "职业目标与行动证据"
};

const goalLabels: Record<CompetitionGoal, string> = {
  project: "项目经历",
  award: "竞赛奖项",
  postgraduate: "科研升学",
  employment: "就业能力",
  portfolio: "作品集",
  entrepreneurship: "创业落地",
  networking: "人脉协作"
};

function addAskable(
  askable: CompetitionClarifyAskableQuestion[],
  asked: ReadonlySet<string>,
  question: Omit<CompetitionClarifyAskableQuestion, "estimatedOutcomeChanges">
) {
  if (!asked.has(question.signalKey)) {
    askable.push({ ...question, estimatedOutcomeChanges: question.estimatedPreferenceOutcomeChanges });
  }
}

export function buildCompetitionClarifyAskableContext(
  profile: CompetitionClarifyProfile,
  allCandidates: readonly DeterministicCompetitionRecommendation[],
  askedSignalKeys: readonly string[],
  priorTranscript: readonly CompetitionDynamicExchangeV3[],
  qualificationSnapshot: CompetitionQualificationSnapshotV1,
  simulationOptions?: CompetitionClarifySimulationOptions
): CompetitionClarifyAskableQuestion[];
export function buildCompetitionClarifyAskableContext(
  profile: CompetitionClarifyProfile,
  allCandidates: readonly DeterministicCompetitionRecommendation[],
  askedSignalKeys: readonly string[] = [],
  priorTranscript: readonly CompetitionDynamicExchangeV3[] = [],
  qualificationSnapshot?: CompetitionQualificationSnapshotV1,
  simulationOptions: CompetitionClarifySimulationOptions = {}
): CompetitionClarifyAskableQuestion[] {
  const candidates = allCandidates.slice(0, COMPETITION_CLARIFY_CANDIDATE_LIMIT);
  if (new Set(candidates.map(({ competitionId }) => competitionId)).size < 3) return [];
  const asked = new Set(askedSignalKeys);
  const askable: CompetitionClarifyAskableQuestion[] = [];

  const allFitSignals = [...new Set(
    [
      ...candidates.flatMap(({ competition }) => competition.recommendation.fit?.signals ?? []),
      ...candidates.flatMap((candidate) => clarifyCandidateTrackFitSignals(candidate))
    ]
  )];
  const fitSelection = maximumInformationOptions(
    profile,
    candidates,
    "competition-fit",
    allFitSignals,
    priorTranscript,
    "multiple",
    2,
    8,
    simulationOptions
  );
  const fitSignals = fitSelection.optionValues as CompetitionFitSignal[];
  const fitOutcomeChanges = fitSelection.outcomeCount;
  if (fitSignals.length >= 2 && fitOutcomeChanges >= 2) {
    addAskable(askable, asked, {
      signalKey: "competition-fit",
      target: { kind: "candidate-set", competitionIds: candidates.map(({ competitionId }) => competitionId) },
      allowedOptionValues: fitSignals,
      optionCatalog: fitSignals.map((value) => ({ value, label: fitSignalLabels[value] })),
      allowedSelections: ["multiple"],
      optionCount: { min: 2, max: 8 },
      requiredOptionCount: fitSignals.length,
      estimatedPreferenceOutcomeChanges: fitOutcomeChanges,
      impact: "material",
      maxSelections: 2
    });
  }

  const goalValues = goalOptionsForCandidates(profile, candidates);
  const goalOutcomeChanges = actualPreferenceOutcomeChangeCount(
    profile,
    candidates,
    "candidate-goal-tradeoff",
    goalValues,
    priorTranscript,
    "single",
    undefined,
    simulationOptions
  );
  if (goalValues.length >= 2 && goalOutcomeChanges >= 2) {
    addAskable(askable, asked, {
      signalKey: "candidate-goal-tradeoff",
      target: { kind: "candidate-set", competitionIds: candidates.map(({ competitionId }) => competitionId) },
      allowedOptionValues: goalValues,
      optionCatalog: goalValues.map((value) => ({ value, label: goalLabels[value] })),
      allowedSelections: ["single"],
      optionCount: { min: 2, max: 4 },
      requiredOptionCount: goalValues.length,
      estimatedPreferenceOutcomeChanges: goalOutcomeChanges,
      impact: "material"
    });
  }

  for (const candidate of candidates) {
    const allowedTrackIds = qualificationTrackIds(qualificationSnapshot, candidate.competitionId);
    // The frozen official snapshot is the sole eligibility boundary for a
    // track question. Editorial/non-official stage metadata must not hide a
    // track that the snapshot did not explicitly exclude.
    const compatibleTracks = getCompetitionPreferenceQuestionTracks(candidate.competition)
      .filter(({ id }) => allowedTrackIds.has(id));
    if (compatibleTracks.length < 2) continue;
    const signalKey = `track:${candidate.competitionId}` as const;
    const trackSelection = maximumInformationOptions(
      profile,
      candidates,
      signalKey,
      compatibleTracks.map(({ id }) => id),
      priorTranscript,
      "single",
      undefined,
      6,
      simulationOptions
    );
    const selectedTrackIds = new Set(trackSelection.optionValues);
    const trackOptions = compatibleTracks
      .filter(({ id }) => selectedTrackIds.has(id))
      .map(({ id, label }) => ({ value: id, label }));
    const trackOutcomeChanges = trackSelection.outcomeCount;
    if (trackOutcomeChanges >= 2) {
      addAskable(askable, asked, {
        signalKey,
        target: { kind: "competition", competitionId: candidate.competitionId, competitionName: candidate.name },
        allowedOptionValues: trackOptions.map(({ value }) => value),
        optionCatalog: trackOptions,
        allowedSelections: ["single"],
        optionCount: { min: 2, max: 6 },
        requiredOptionCount: trackOptions.length,
        estimatedPreferenceOutcomeChanges: trackOutcomeChanges,
        impact: "material"
      });
    }
  }

  return askable;
}

export function buildOptionalGoalTradeoffAskable(
  profile: CompetitionClarifyProfile,
  allCandidates: readonly DeterministicCompetitionRecommendation[],
  priorTranscript: readonly CompetitionDynamicExchangeV3[] = [],
  simulationOptions: CompetitionClarifySimulationOptions = {}
): CompetitionClarifyAskableQuestion | null {
  if (priorTranscript.some(({ question }) => question.signalKey === "candidate-goal-tradeoff")) return null;
  const candidates = allCandidates.slice(0, COMPETITION_CLARIFY_CANDIDATE_LIMIT);
  if (new Set(candidates.map(({ competitionId }) => competitionId)).size < 3) return null;
  const goalValues = goalOptionsForCandidates(profile, candidates);
  if (goalValues.length < 2) return null;
  const outcomeChanges = actualPreferenceOutcomeChangeCount(
    profile,
    candidates,
    "candidate-goal-tradeoff",
    goalValues,
    priorTranscript,
    "single",
    undefined,
    simulationOptions
  );
  return {
    signalKey: "candidate-goal-tradeoff",
    target: { kind: "candidate-set", competitionIds: candidates.map(({ competitionId }) => competitionId) },
    allowedOptionValues: goalValues,
    optionCatalog: goalValues.map((value) => ({ value, label: goalLabels[value] })),
    allowedSelections: ["single"],
    optionCount: { min: 2, max: 4 },
    requiredOptionCount: goalValues.length,
    estimatedPreferenceOutcomeChanges: outcomeChanges,
    estimatedOutcomeChanges: outcomeChanges,
    impact: "optional"
  };
}

export function selectAskableQuestionForTurn(
  askableQuestions: readonly CompetitionClarifyAskableQuestion[],
  askedSignalKeys: readonly CompetitionDynamicSignalKeyV3[] = [],
  _recentSignalKeys: readonly CompetitionDynamicSignalKeyV3[] = []
) {
  const asked = new Set(askedSignalKeys);
  const askedFamilies = new Set(askedSignalKeys.map(competitionDynamicQuestionFamilyV3));
  const familyPriority = ({ signalKey }: CompetitionClarifyAskableQuestion) => {
    const family = competitionDynamicQuestionFamilyV3(signalKey);
    return family === "fit" ? 0 : family === "goal" ? 1 : 2;
  };
  return [...askableQuestions]
    .filter(({ signalKey }) => !asked.has(signalKey))
    .filter(({ signalKey }) => !askedFamilies.has(competitionDynamicQuestionFamilyV3(signalKey)))
    .filter(({ impact, estimatedPreferenceOutcomeChanges }) =>
      impact === "material" && estimatedPreferenceOutcomeChanges >= 2
    )
    .sort((left, right) =>
      right.estimatedPreferenceOutcomeChanges - left.estimatedPreferenceOutcomeChanges ||
      familyPriority(left) - familyPriority(right) ||
      left.signalKey.localeCompare(right.signalKey)
    )[0];
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableQuestionId(signalKey: CompetitionDynamicSignalKeyV3, questionNumber: number) {
  const readable = signalKey.replace(/[^a-z0-9_-]/gi, "_").slice(0, 38);
  return `dq_${questionNumber}_${readable}_${stableHash(signalKey).toString(36)}`;
}

function controlledPromptVariant(
  signalKey: CompetitionDynamicSignalKeyV3,
  variants: readonly string[],
  recentSignalKeys: readonly CompetitionDynamicSignalKeyV3[]
) {
  const catalog = variants.filter((variant) => variant.length <= 160);
  const previousOccurrences = recentSignalKeys.filter((value) => value === signalKey).length;
  const usable = catalog.length ? catalog : variants;
  return usable[(stableHash(signalKey) + previousOccurrences) % usable.length]!;
}

/** Every client-visible byte is server-authored; no model can author a question. */
export function materializeCompetitionClarifyQuestion(
  askable: CompetitionClarifyAskableQuestion,
  questionNumber: number,
  recentSignalKeys: readonly CompetitionDynamicSignalKeyV3[] = []
): CompetitionDynamicQuestionV3 {
  const base = {
    questionId: stableQuestionId(askable.signalKey, questionNumber),
    signalKey: askable.signalKey,
    options: askable.optionCatalog.map((option) => ({ ...option })),
    allowsNote: true as const,
    maxNoteLength: 120 as const,
    impact: askable.impact,
    estimatedPreferenceOutcomeChanges: Math.max(1, askable.estimatedPreferenceOutcomeChanges)
  };
  let question: CompetitionDynamicQuestionV3;
  if (askable.signalKey === "competition-fit") {
    question = {
      ...base,
      prompt: controlledPromptVariant(askable.signalKey, [
        "在这组候选赛事中，你最希望重点证明哪类实战能力？",
        "面对这组候选赛事，你希望优先展示哪类实战能力？",
        "从本轮候选赛事看，哪类实战能力最值得你重点证明？"
      ], recentSignalKeys),
      selection: "multiple",
      maxSelections: askable.maxSelections ?? 2
    };
  } else if (askable.signalKey === "candidate-goal-tradeoff") {
    question = {
      ...base,
      prompt: controlledPromptVariant(askable.signalKey, [
        "结合当前候选，如果只能优先一种收获，你更看重哪一项？",
        "在这组候选赛事中，你最想优先获得哪类成果？",
        "若需要在当前收获中做取舍，你会把哪一项放在首位？"
      ], recentSignalKeys),
      selection: "single"
    };
  } else {
    if (askable.target.kind !== "competition") {
      throw new Error("Track preference is missing its server-owned competition target");
    }
    question = {
      ...base,
      prompt: `《${askable.target.competitionName}》的这些候选方向中，你更想优先准备哪个赛道？`,
      selection: "single"
    };
  }
  return competitionDynamicQuestionV3Schema.parse(question);
}

export function generateNextCompetitionQuestion(
  profile: CompetitionClarifyProfile,
  transcript: readonly CompetitionDynamicExchangeV3[],
  allCandidates: readonly DeterministicCompetitionRecommendation[],
  recentSignalKeys: readonly CompetitionDynamicSignalKeyV3[],
  qualificationSnapshot: CompetitionQualificationSnapshotV1,
  simulationOptions?: CompetitionClarifySimulationOptions
): Promise<CompetitionClarificationResponseV6>;
export async function generateNextCompetitionQuestion(
  profile: CompetitionClarifyProfile,
  transcript: readonly CompetitionDynamicExchangeV3[],
  allCandidates: readonly DeterministicCompetitionRecommendation[],
  recentSignalKeys: readonly CompetitionDynamicSignalKeyV3[] = [],
  qualificationSnapshot?: CompetitionQualificationSnapshotV1,
  simulationOptions: CompetitionClarifySimulationOptions = {}
): Promise<CompetitionClarificationResponseV6> {
  const completed = (): CompetitionClarificationResponseV6 => ({
    ok: true,
    responseVersion: COMPETITION_CLARIFICATION_RESPONSE_VERSION,
    status: "completed",
    nextQuestion: null,
    promptVersion: COMPETITION_CLARIFY_PROMPT_VERSION,
    model: COMPETITION_CLARIFY_POLICY_MODEL,
    provider: "server",
    fallback: false
  });
  if (!qualificationSnapshot) return completed();
  if (transcript.length >= MAX_COMPETITION_DYNAMIC_QUESTIONS) return completed();

  const candidates = allCandidates.slice(0, COMPETITION_CLARIFY_CANDIDATE_LIMIT);
  if (new Set(candidates.map(({ competitionId }) => competitionId)).size < 3) return completed();
  const askedSignalKeys = transcript.map(({ question }) => question.signalKey);
  const selected = selectAskableQuestionForTurn(
    buildCompetitionClarifyAskableContext(
      profile,
      candidates,
      askedSignalKeys,
      transcript,
      qualificationSnapshot,
      simulationOptions
    ),
    askedSignalKeys,
    recentSignalKeys
  );
  if (selected) {
    return {
      ok: true,
      responseVersion: COMPETITION_CLARIFICATION_RESPONSE_VERSION,
      status: "question",
      nextQuestion: materializeCompetitionClarifyQuestion(selected, transcript.length + 1, recentSignalKeys),
      promptVersion: COMPETITION_CLARIFY_PROMPT_VERSION,
      model: COMPETITION_CLARIFY_POLICY_MODEL,
      provider: "server",
      fallback: false
    };
  }

  // The opt-in refinement is offered only immediately after the fixed
  // questionnaire. Once a material answer exists, no-value turns terminate.
  if (transcript.length === 0) {
    const optional = buildOptionalGoalTradeoffAskable(
      profile,
      candidates,
      transcript,
      simulationOptions
    );
    if (optional) {
      return {
        ok: true,
        responseVersion: COMPETITION_CLARIFICATION_RESPONSE_VERSION,
        status: "optional_question",
        nextQuestion: materializeCompetitionClarifyQuestion(optional, 1, recentSignalKeys),
        promptVersion: COMPETITION_CLARIFY_PROMPT_VERSION,
        model: COMPETITION_CLARIFY_POLICY_MODEL,
        provider: "server",
        fallback: false
      };
    }
  }
  return completed();
}

/** @deprecated Current questions are preference-only and stop after zero through three turns. */
export const chooseNextCompetitionClarification = generateNextCompetitionQuestion;
