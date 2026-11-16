import type { DecisionRecommendationV6 } from "@/lib/competitions/v6/contracts";

type ClaimField = "coreTask" | "reason" | "value" | "advisory";

export function RecommendationEvidenceLinks({ factIds, item, field }: {
  factIds: readonly string[];
  item: Pick<DecisionRecommendationV6, "evidenceFacts" | "sources">;
  field: ClaimField;
}) {
  const facts = item.evidenceFacts.filter(fact => factIds.includes(fact.id));
  const sourceIds = new Set(facts.flatMap(fact => fact.sourceIds));
  return item.sources.map((source, index) => {
    if (!sourceIds.has(source.id)) return null;
    // A source can contain a participant report alongside official material.
    const includesParticipantReport = facts.some(fact => fact.sourceIds.includes(source.id) && fact.kind === "participant_report");
    return <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer"
      className="ml-1 inline-block px-1 align-super text-[11px] font-semibold leading-5 text-brand-700 underline decoration-brand-300 underline-offset-2"
      data-claim-field={field} data-source-id={source.id}
      aria-label={`来源${includesParticipantReport ? "（含作者或参与者资料）" : ""}：${source.title}${source.scope ? `（${source.scope}）` : ""}`}
      title={`${includesParticipantReport ? "作者或参与者资料 · " : ""}${source.title}${source.scope ? ` · ${source.scope}` : ""}`}>
      [{index + 1}]
    </a>;
  });
}
