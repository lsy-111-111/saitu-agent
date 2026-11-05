import {
  COMPETITION_FIT_SIGNALS,
  type CompetitionDynamicExchangeV2,
  type CompetitionDynamicExchangeV3,
  type CompetitionDynamicSignalKeyV3
} from "@/types/competition-recommendation";

const competitionFitSignalSet = new Set<string>(COMPETITION_FIT_SIGNALS);

/**
 * Compatibility boundary for legacy in-memory V2 conversations.
 *
 * The current scorer never accepts V2. This adapter copies only preference
 * signals that V3 can represent and deliberately drops the former eligibility
 * and team families. Track answers must also have been present in the signed
 * question options; qualification-snapshot validation remains mandatory at the
 * API boundary before a projected track preference is scored.
 */
export function projectLegacyCompetitionPreferenceTranscript(
  transcript: readonly CompetitionDynamicExchangeV2[]
): CompetitionDynamicExchangeV3[] {
  const projected: CompetitionDynamicExchangeV3[] = [];
  const seenSignals = new Set<string>();

  for (const { question, answer } of transcript) {
    const signalKey = question.signalKey;
    const isCompetitionFit = signalKey === "competition-fit";
    const isTrackPreference = signalKey.startsWith("track:") && signalKey.length > "track:".length;
    if ((!isCompetitionFit && !isTrackPreference) || seenSignals.has(signalKey)) continue;

    const options = question.options.filter(({ value }) =>
      isCompetitionFit ? competitionFitSignalSet.has(value) : value.trim().length > 0
    );
    const allowedValues = new Set(options.map(({ value }) => value));
    const selectedValues = [...new Set(answer.selectedValues.filter((value) => allowedValues.has(value)))];
    // Historical V2 records may contain a single server-authored option. The
    // adapter preserves that signed preference, while current V3 question
    // generation independently enforces its own 2–4 option policy.
    if (options.length === 0 || selectedValues.length === 0) continue;

    seenSignals.add(signalKey);
    projected.push({
      question: {
        questionId: question.questionId,
        signalKey: signalKey as CompetitionDynamicSignalKeyV3,
        prompt: question.prompt,
        selection: question.selection,
        options,
        ...(question.maxSelections === undefined ? {} : { maxSelections: question.maxSelections }),
        allowsNote: true,
        maxNoteLength: question.maxNoteLength,
        // Legacy records have no server-side counterfactual proof. Mark the
        // projection optional with the schema's one-outcome sentinel instead
        // of inventing material information gain from the option count.
        impact: "optional",
        estimatedPreferenceOutcomeChanges: 1
      },
      // Free text from the removed policy is not forwarded into V3 scoring or
      // AI context; only the whitelisted enum preference survives.
      answer: { selectedValues }
    });
  }

  return projected;
}
