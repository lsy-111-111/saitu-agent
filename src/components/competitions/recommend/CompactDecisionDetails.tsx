"use client";

import type { DecisionClaimV6, DecisionRecommendationV6, StudentProfileV6 } from "@/lib/competitions/v6/contracts";
import { compactTaskClaimV7, selectCompactValuesV7 } from "@/lib/competitions/v7/compact-content";
import { decisionDisplayText } from "./DecisionReport";
import { RecommendationAdvisories } from "./RecommendationAdvisories";
import { RecommendationEvidenceLinks } from "./RecommendationEvidenceLinks";

type ClaimField = "coreTask" | "reason" | "value";

/** Keep precise citations beside the short text without repeating its evidence packet. */
function CompactClaim({ claim, item, field }: { claim: DecisionClaimV6; item: DecisionRecommendationV6; field: ClaimField }) {
  const text = decisionDisplayText(claim.text);
  const conditions = claim.conditions.map(decisionDisplayText).filter(condition => condition && !text.includes(condition));
  return <p className={`text-sm leading-7 text-ink${field === "reason" ? " whitespace-pre-line [overflow-wrap:anywhere]" : ""}`} data-testid="compact-claim" data-claim-field={field}>
    {text}{conditions.length ? <span> 前提：{conditions.join("；")}</span> : null}
    <RecommendationEvidenceLinks factIds={claim.competitionFactIds} item={item} field={field} />
  </p>;
}

export function CompactDecisionDetails({ item, profile }: { item: DecisionRecommendationV6; profile?: Pick<StudentProfileV6, "primaryGoal" | "goals"> | null }) {
  const task = compactTaskClaimV7(item);
  const reason = item.reasons[0];
  const values = selectCompactValuesV7(item, profile);
  return <div className="space-y-5" data-testid="compact-decision-details">
    <section><h4 className="mb-1 text-sm font-semibold text-brand-700">具体做什么</h4><CompactClaim claim={task} item={item} field="coreTask" /></section>
    <section>
      <h4 className="mb-1 text-sm font-semibold text-brand-700">为什么适合你</h4>
      {reason ? <CompactClaim claim={reason} item={item} field="reason" /> : <p className="text-sm leading-7">匹配理由暂缺，可向乐乐追问。</p>}
      <RecommendationAdvisories item={item} />
    </section>
    <section><h4 className="mb-1 text-sm font-semibold text-brand-700">价值与收获</h4>
      {values.length ? <ul className="space-y-2 pl-4 marker:text-brand-500">{values.map((value, index) => <li key={`${value.dimension}-${index}`} className="list-disc"><CompactClaim claim={value.claim} item={item} field="value" /></li>)}</ul> : <p className="text-sm leading-7">相关收益仍需结合具体任务确认。</p>}
    </section>
  </div>;
}
