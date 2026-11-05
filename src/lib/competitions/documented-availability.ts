import { getCompetitionFactSheet } from "@/content/competition-facts";
import type { Competition } from "@/content/competitions";
import { deriveCompetitionAvailability, type CompetitionAvailability } from "./availability";

/** Only an explicitly documented national student registration window can label a whole series open. */
export function getDocumentedCompetitionAvailability(
  competition: Pick<Competition, "id" | "recommendation">,
  now = new Date()
): CompetitionAvailability {
  const facts = getCompetitionFactSheet(competition.id);
  if (!facts) return deriveCompetitionAvailability(competition.recommendation.schedule, now);

  const national = facts.nodes.filter(node => node.scope === "全国学生团队报名");
  const start = national.find(node => node.kind === "报名开始");
  const end = national.find(node => node.kind === "报名截止");
  if (start && end && start.sourceUrl === end.sourceUrl) {
    const window = deriveCompetitionAvailability({
      state: "scheduled",
      datePrecision: "day",
      edition: facts.edition,
      registrationStart: start.date,
      registrationEnd: end.date,
      verifiedAt: facts.checkedAt,
      sourceType: "unknown",
      sourceUrl: end.sourceUrl
    }, now);
    const status = window.registrationStatus;
    return {
      ...window,
      registrationStatus: {
        ...status,
        label: status.status === "open" ? "全国报名窗口内" : status.label,
        note: `${facts.edition}全国学生团队报名窗口。请另核本校推荐和审核安排。${status.status === "stale" ? status.note : ""}`
      }
    };
  }

  return {
    tier: "unknown",
    tierRank: 2,
    registrationStatus: facts.nodes.length
      ? { status: "unknown", label: "按届次查赛程", note: "已有部分节点。请在详情中核对届次、赛道和适用学校，再确认本人报名入口。" }
      : { status: "unknown", label: "报名时间待核验", note: "尚未核实对所有学生适用的当前报名窗口，请核对当届公告及本校安排。" }
  };
}
