import { z } from "zod";
import {
  DEFAULT_DEEPSEEK_MODEL,
  getCompetitionAiProviderFailureReason,
  getConfiguredAiModel,
  getConfiguredAiProvider,
  requestAiJson,
  type AiJsonFailureReason
} from "@/lib/ai/ai-client";
import { containsCompetitionNotePersonalInfo } from "@/lib/ai/competition-note";
import { buildPrompt } from "@/lib/ai/prompt-builder";
import {
  MAX_COMPETITION_DYNAMIC_OPTIONS,
  competitionDynamicQuestionV3Schema
} from "@/lib/competitions/recommendation-runtime-schema";
import {
  COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH,
  type CompetitionDynamicAnswerV3,
  type CompetitionDynamicQuestionV3
} from "@/types/competition-recommendation";

export {
  MAX_COMPETITION_DYNAMIC_OPTIONS,
  MAX_COMPETITION_DYNAMIC_QUESTIONS,
  MIN_COMPETITION_DYNAMIC_OPTIONS,
  competitionDynamicPromptFingerprint,
  competitionDynamicQuestionFamilyV3,
  competitionDynamicQuestionV3Schema,
  competitionDynamicSignalKeyV3Schema
} from "@/lib/competitions/recommendation-runtime-schema";

export const COMPETITION_DYNAMIC_NORMALIZE_PROMPT_VERSION = "competition-dynamic-normalize.v1" as const;

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

export const competitionDynamicAnswerSchema = z
  .object({
    selectedValues: z.array(z.string().trim().min(1).max(48)).max(MAX_COMPETITION_DYNAMIC_OPTIONS).refine(unique),
    note: z
      .string()
      .trim()
      .min(1)
      .max(COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH)
      .refine((value) => !containsCompetitionNotePersonalInfo(value), "Personal information is not accepted")
      .optional()
  })
  .strict()
  .superRefine((answer, context) => {
    if (answer.selectedValues.length === 0 && !answer.note) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose an option or provide a text answer" });
    }
  });

export function parseCompetitionDynamicAnswer(
  question: CompetitionDynamicQuestionV3,
  input: unknown
): CompetitionDynamicAnswerV3 | null {
  const parsed = competitionDynamicAnswerSchema.safeParse(input);
  if (!parsed.success) return null;

  const allowed = new Set(question.options.map((option) => option.value));
  const maximum = question.selection === "single" ? 1 : question.maxSelections ?? question.options.length;
  if (
    parsed.data.selectedValues.length > maximum ||
    parsed.data.selectedValues.some((value) => !allowed.has(value))
  ) {
    return null;
  }

  return parsed.data;
}

export type CompetitionDynamicTextInterpretation = {
  status: "ready" | "conflict" | "ambiguous" | "unmapped";
  originalText: string;
  explicitValues: string[];
  suggestedValues: string[];
  source: "deterministic" | "model" | "mixed" | "unresolved";
  confidence: number;
  rationale: string;
  evidenceSpan?: string;
  allowedOptions: CompetitionDynamicQuestionV3["options"];
};

function sameValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function combineDynamicValues(
  question: CompetitionDynamicQuestionV3,
  explicitValues: readonly string[],
  mappedValues: readonly string[]
) {
  const proposed = [...new Set([...explicitValues, ...mappedValues])];
  const maximum = question.selection === "single" ? 1 : question.maxSelections ?? question.options.length;
  const conflict = mappedValues.length > 0 && (
    proposed.length > maximum ||
    (question.selection === "single" && explicitValues.length > 0 && !sameValues(explicitValues, mappedValues))
  );
  return { proposed, conflict };
}

export function interpretCompetitionDynamicFreeText(
  question: CompetitionDynamicQuestionV3,
  note: string,
  explicitValues: readonly string[] = []
): CompetitionDynamicTextInterpretation {
  const normalized = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN").replace(/\s/g, "");
  const optionByText = new Map<string, string>();
  for (const option of question.options) {
    optionByText.set(normalized(option.value), option.value);
    optionByText.set(normalized(option.label), option.value);
  }
  const pieces = question.selection === "multiple" ? note.split(/[、,，;；/|\n]+/) : [note];
  const mapped = pieces.map((piece) => optionByText.get(normalized(piece)));
  const maximum = question.selection === "single" ? 1 : question.maxSelections ?? question.options.length;
  const suggestedValues = mapped.every(Boolean) ? [...new Set(mapped as string[])] : [];
  const ready = suggestedValues.length > 0 && suggestedValues.length <= maximum;
  const { proposed, conflict } = combineDynamicValues(question, explicitValues, suggestedValues);
  const resolvedSuggestions = ready
    ? conflict ? suggestedValues : proposed
    : [...explicitValues];
  return {
    status: conflict ? "conflict" : ready ? "ready" : "unmapped",
    originalText: note,
    explicitValues: [...explicitValues],
    suggestedValues: resolvedSuggestions,
    source: ready ? explicitValues.length ? "mixed" : "deterministic" : "unresolved",
    confidence: ready ? explicitValues.length ? 0.9 : 0.95 : 0,
    ...(ready ? { evidenceSpan: note } : {}),
    rationale: conflict
      ? "自由文本与已选白名单答案不一致，需要用户确认最终值。"
      : ready
        ? "自由文本与当前问题的白名单选项唯一对应；确认后才会采用。"
      : "自由文本无法唯一对应当前问题选项，请确认一个白名单答案后继续。",
    allowedOptions: question.options.map(({ value, label }) => ({ value, label }))
  };
}

export function getCompetitionDynamicNormalizeModel() {
  return process.env.AI_COMPETITION_NORMALIZE_MODEL?.trim() || getConfiguredAiModel(DEFAULT_DEEPSEEK_MODEL);
}

export async function enhanceCompetitionDynamicFreeTextWithAi(
  question: CompetitionDynamicQuestionV3,
  note: string,
  explicitValues: readonly string[] = [],
  options: { deadlineEpochMs?: number; signal?: AbortSignal } = {}
): Promise<CompetitionDynamicTextInterpretation & {
  provider: string;
  model: string;
  aiUsed: boolean;
  upstreamAttempted: boolean;
  failureReason?: AiJsonFailureReason;
}> {
  const deterministic = interpretCompetitionDynamicFreeText(question, note, explicitValues);
  const provider = getConfiguredAiProvider();
  const model = getCompetitionDynamicNormalizeModel();
  if (deterministic.source !== "unresolved") {
    return {
      ...deterministic,
      provider,
      model: provider === "mock" ? "mock" : model,
      aiUsed: false,
      upstreamAttempted: false
    };
  }
  const providerFailure = getCompetitionAiProviderFailureReason(provider);
  if (providerFailure) {
    return {
      ...deterministic,
      provider,
      model: provider === "mock" ? "mock" : model,
      aiUsed: false,
      upstreamAttempted: false,
      failureReason: providerFailure
    };
  }

  const allowedValues = new Set(question.options.map(({ value }) => value));
  const maximum = question.selection === "single" ? 1 : question.maxSelections ?? question.options.length;
  const outputSchema = z.object({
    status: z.enum(["unique", "ambiguous", "no_match"]),
    values: z.array(z.string().trim().min(1).max(48)).max(MAX_COMPETITION_DYNAMIC_OPTIONS).refine(unique),
    evidenceSpan: z.string().trim().min(1).max(COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH).optional(),
    rationale: z.string().trim().min(1).max(120)
  }).strict().superRefine((output, context) => {
    const validUnique =
      output.status === "unique" &&
      output.values.length >= 1 &&
      output.values.length <= maximum &&
      output.values.every((value) => allowedValues.has(value));
    const validNonUnique = output.status !== "unique" && output.values.length === 0;
    if (!validUnique && !validNonUnique) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Dynamic mapping must obey the supplied whitelist" });
    }
    if (output.evidenceSpan && !note.includes(output.evidenceSpan)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Evidence span must occur in the original text" });
    }
  });
  const prompt = await buildPrompt("competition-dynamic-normalize.v1.md", {
    requestJson: JSON.stringify({
      freeText: note,
      selection: question.selection,
      maxSelections: maximum,
      allowedOptions: question.options
    })
  });
  const result = await requestAiJson(prompt, {
    model,
    systemPrompt: "Return JSON only. Map text only to the supplied whitelist; use ambiguous or no_match instead of guessing.",
    temperature: 0,
    maxTokens: 500,
    maxAttempts: 2,
    schema: outputSchema,
    thinking: "disabled",
    operation: "competition_normalize",
    promptVersion: COMPETITION_DYNAMIC_NORMALIZE_PROMPT_VERSION,
    candidateCount: question.options.length,
    deadlineEpochMs: options.deadlineEpochMs,
    signal: options.signal,
    retryInstruction: "Use only allowed option values. Ambiguous or unmatched text must return an empty values array."
  });
  if (!result.ok) {
    return {
      ...deterministic,
      provider,
      model: result.model,
      aiUsed: false,
      upstreamAttempted: result.upstreamAttempted,
      failureReason: result.reason
    };
  }
  if (result.data.status !== "unique") {
    return {
      ...deterministic,
      status: result.data.status === "ambiguous" ? "ambiguous" : "unmapped",
      rationale: result.data.rationale,
      ...(result.data.evidenceSpan ? { evidenceSpan: result.data.evidenceSpan } : {}),
      provider,
      model: result.model,
      aiUsed: true,
      upstreamAttempted: result.upstreamAttempted
    };
  }
  const { proposed, conflict } = combineDynamicValues(question, explicitValues, result.data.values);
  return {
    ...deterministic,
    status: conflict ? "conflict" : "ready",
    explicitValues: [...explicitValues],
    suggestedValues: conflict ? [...result.data.values] : proposed,
    source: explicitValues.length ? "mixed" : "model",
    confidence: 0.75,
    rationale: result.data.rationale,
    ...(result.data.evidenceSpan ? { evidenceSpan: result.data.evidenceSpan } : {}),
    provider,
    model: result.model,
    aiUsed: true,
    upstreamAttempted: result.upstreamAttempted
  };
}

export function isSafeCompetitionDynamicQuestionV3(input: unknown): input is CompetitionDynamicQuestionV3 {
  return competitionDynamicQuestionV3Schema.safeParse(input).success;
}
