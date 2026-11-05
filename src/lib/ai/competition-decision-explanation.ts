import "server-only";
import { z } from "zod";
import {
  getCompetitionAiProviderFailureReason,
  getConfiguredAiProvider,
  isAiMockAllowed,
  requestAiJson,
  type AiJsonFailureReason
} from "@/lib/ai/ai-client";
import { hasValidAiConsent, recordAiConsent } from "@/lib/ai/consent";
import { AI_EVIDENCE_EXPLANATION_CONSENT_VERSION } from "@/lib/ai/consent-disclosure";
import { containsCompetitionGeneratedTextPersonalInfo } from "@/lib/ai/competition-note";
import { getCompetitionRecommendModel } from "@/lib/ai/competition-ranking";
import type { CompetitionRecommendRequestV5 } from "@/lib/ai/competition-request-schema";
import type { CompetitionRecommendationItemV3, CompetitionRecommendationResponseV5 } from "@/types/competition-recommendation";

type Item = CompetitionRecommendationItemV3;
type Outcome = Pick<CompetitionRecommendationResponseV5, "provider" | "model" | "promptVersion" | "fallbackUsed" | "fallbackMode" | "fallbackReason" | "recommendations">;
type ExplanationOptions = {
  request: Request;
  aiConsent: CompetitionRecommendRequestV5["aiConsent"];
  deadlineEpochMs: number;
  auditDeadlineEpochMs: number;
  signal?: AbortSignal;
};

const promptVersion = "decision-evidence-selection.v1";
const allowedDimensions = ["task", "experience", "goal"] as const;

function evidenceOptions(item: Item, index: number) {
  const options: { key: string; ref: string; text: string; promptText: string }[] = [];
  for (const dimension of allowedDimensions) {
    for (const [ordinal, text] of (item.fitEvidence?.[dimension] ?? []).entries()) {
      // These sentences come solely from confirmed, enumerated answers and the server's fixed track.
      // The selector needs neither the competition's identity nor its registration information.
      let promptText = text.replaceAll(item.name, "该竞赛");
      if (item.recommendedTrack?.label) promptText = promptText.replaceAll(item.recommendedTrack.label, "该赛道");
      if (containsCompetitionGeneratedTextPersonalInfo(promptText)) continue;
      if (/报名|截止|开放|届次|赛期|赛程|缴费|20\d{2}|\d{1,2}月\d{1,2}日/.test(promptText)) continue;
      options.push({ key: `s${index + 1}-${dimension}-${ordinal}`, ref: `decision.${dimension}:${ordinal}`, text, promptText });
    }
  }
  return { slot: index + 1, options };
}

export async function personalizeFixedDecisionExplanations(items: Item[], options: ExplanationOptions): Promise<Outcome> {
  const rules: Outcome = {
    recommendations: items, provider: "server", model: "structured-fit",
    promptVersion: "decision-explanation.v1", fallbackUsed: false, fallbackMode: "none"
  };
  function fallback(reason: AiJsonFailureReason): Outcome {
    return { ...rules, promptVersion, fallbackUsed: true, fallbackMode: "full", fallbackReason: reason };
  }

  if (!items.length || items.length > 3 || isAiMockAllowed()) return rules;
  if (options.aiConsent.version !== AI_EVIDENCE_EXPLANATION_CONSENT_VERSION ||
      !hasValidAiConsent({ aiConsent: options.aiConsent })) return rules;
  const provider = getConfiguredAiProvider();
  const disallowed = getCompetitionAiProviderFailureReason(provider);
  if (disallowed) return fallback(disallowed);
  if (options.signal?.aborted || options.deadlineEpochMs <= Date.now()) return fallback("timeout");

  const pools = items.map(evidenceOptions).filter(pool => pool.options.length > 0);
  if (!pools.length) return rules;
  const selection = z.object({
    choices: z.array(z.object({
      slot: z.number().int(),
      refs: z.array(z.string().max(64)).min(1).max(2)
    }).strict()).length(pools.length)
  }).strict().refine(({ choices }) => choices.every(({ slot, refs }, index) =>
    slot === pools[index].slot && new Set(refs).size === refs.length &&
    refs.every(ref => pools[index].options.some(option => option.key === ref))
  ));

  const model = getCompetitionRecommendModel();
  try {
    const result = await requestAiJson(JSON.stringify(pools.map(pool => ({
      slot: pool.slot,
      evidence: pool.options.map(({ key, promptText }) => ({ ref: key, text: promptText }))
    }))), {
      systemPrompt: '为每个固定的选赛结果选择最能帮助学生理解适配的1到2条已有依据。优先具体经历、技能与任务关联，避免两条重复。只能返回 JSON {"choices":[{"slot":1,"refs":["原样复制该项的ref"]}]}，每项按输入顺序出现一次，不得跨项、重排或生成说明文字。',
      model, schema: selection, thinking: "disabled", temperature: 0, maxAttempts: 1, maxTokens: 500,
      operation: "competition_recommend", promptVersion, candidateCount: pools.length,
      deadlineEpochMs: options.deadlineEpochMs, signal: options.signal
    });
    if (result.upstreamAttempted) {
      await recordAiConsent(options.request, "competition_recommend", { provider, model: result.model }, {
        deadlineEpochMs: options.auditDeadlineEpochMs, signal: options.signal
      });
    }
    if (!result.ok) return fallback(result.reason);

    const bySlot = new Map(result.data.choices.map(({ slot, refs }, i) => [
      slot, refs.map(ref => pools[i].options.find(option => option.key === ref)!)
    ]));
    return {
      ...rules, provider, model: result.model, promptVersion,
      recommendations: items.map((item, index) => {
        const chosen = bySlot.get(index + 1);
        if (!chosen || !item.evidenceRefs) return item;
        return {
          ...item, explanationSource: "deepseek",
          explanation: { ...item.explanation, matchReasons: chosen.map(choice => choice.text) },
          evidenceRefs: {
            ...item.evidenceRefs, match: chosen.map(choice => choice.ref),
            details: [
              ...chosen.map(({ ref }) => ({ evidenceRef: ref, kind: "match" as const, provenance: "editorial-inference" as const })),
              ...(item.evidenceRefs.details ?? []).filter(detail => detail.kind !== "match")
            ]
          }
        };
      })
    };
  } catch {
    return fallback(options.signal?.aborted ? "timeout" : "network_error");
  }
}
