import type { DecisionRecommendationV6 } from "@/lib/competitions/v6/contracts";
import { displayedRecommendationAdvisoriesV7 } from "@/lib/competitions/v7/recommendation-notes";
import { RecommendationEvidenceLinks } from "./RecommendationEvidenceLinks";

export function RecommendationAdvisories({ item }: {
  item: Pick<DecisionRecommendationV6, "eligibilityNotes" | "gaps" | "evidenceFacts" | "sources">;
}) {
  const advisories = displayedRecommendationAdvisoriesV7(item);
  if (!advisories.length) return null;

  return <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground" data-testid="compact-recommendation-advisories">
    {advisories.map(({ text, claim }) => <p key={text} className="[overflow-wrap:anywhere]" data-advisory-note>
      {text}{claim ? <RecommendationEvidenceLinks factIds={claim.competitionFactIds} item={item} field="advisory" /> : null}
    </p>)}
  </div>;
}
