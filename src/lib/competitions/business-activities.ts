/** Editorial task descriptions taken from the published competition catalog. A missing mapping means unknown. */
export const businessActivities = [
  {value:"simulation",label:"用经营沙盘做决策，比较每轮经营结果"},
  {value:"case-analysis",label:"分析企业案例，提出会计或经营方案"},
  {value:"investment",label:"研究上市公司，做财务预测和估值"},
  {value:"tax-practice",label:"识别税务风险，处理财税实务"},
  {value:"interview",label:"练习职场面试和商业陈述"}
] as const;

export type BusinessActivity = (typeof businessActivities)[number]["value"];
export const businessActivityValues = ["simulation","case-analysis","investment","tax-practice","interview"] as const;
const activitiesBySeries: Partial<Record<string, readonly BusinessActivity[]>> = {
  "xuechuangbei-business-simulation":["simulation"],
  "enterprise-competition-simulation":["simulation"],
  "digital-enterprise-sandbox":["simulation"],
  "ima-management-accounting":["case-analysis"],
  "cgma-global-business":["case-analysis"],
  "acca-job-hunting":["interview","case-analysis"],
  "cfa-research-challenge":["investment"],
  "tax-risk-case":["tax-practice"]
};
export function getSeriesBusinessActivities(id: string) {
  return Object.hasOwn(activitiesBySeries,id) ? activitiesBySeries[id] : undefined;
}
