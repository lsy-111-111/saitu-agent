import type { CompetitionDecisionContext } from "@/types/competition-recommendation";

type Budget = NonNullable<CompetitionDecisionContext["budget"]>;

export function decisionBudgetBounds(range: Budget["range"]): readonly [number, number] | null {
  if (range === "under100") return [1, 100];
  if (range === "100-500") return [101, 500];
  if (range === "over500") return [501, 1000000];
  return null;
}

export function isDecisionBudgetMaximumValid(budget: Budget | undefined): boolean {
  if (budget?.maximumYuan === undefined) return true;
  const bounds = decisionBudgetBounds(budget.range);
  return bounds !== null && Number.isInteger(budget.maximumYuan) && budget.maximumYuan >= bounds[0] && budget.maximumYuan <= bounds[1];
}
