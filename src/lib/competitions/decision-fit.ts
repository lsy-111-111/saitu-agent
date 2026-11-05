import { businessActivities, getSeriesBusinessActivities } from "./business-activities";
import type { Competition } from "@/content/competitions";
import type { CompetitionFitEvidence, CompetitionGoal, CompetitionRecommendationProfileV5 } from "@/types/competition-recommendation";
import {
  availableResourceOptions, evidenceOptions, goalOptions, interestOptions, preferredOutputOptions,
  skillOptions, specificSubjectOptions, taskFormatOptions
} from "@/components/competitions/recommend/questionContent";

type Profile = CompetitionRecommendationProfileV5;
const labels = new Map<string, string>([...skillOptions, ...interestOptions, ...specificSubjectOptions,
  ...preferredOutputOptions, ...goalOptions, ...evidenceOptions, ...availableResourceOptions, ...taskFormatOptions]
  .map(option => [option.value, option.label]));
const label = (value: string) => labels.get(value) ?? value;
const round = (n: number) => Math.round(n * 10) / 10;
const intersection = (a: readonly string[], b: readonly string[]) => a.filter(value => b.includes(value));

export type DecisionFit = {
  lower: number;
  upper: number;
  actionable: boolean;
  evidence: CompetitionFitEvidence;
  dimensions: { goal: number; task: number; experience: number; readiness: number; growth: number };
};

/** Values without a confirmed input retain their whole interval; school recognition always needs local policy. */
export function assessDecisionFit(competition: Competition, profile: Profile, input: {
  goal: CompetitionGoal | undefined; task: number | null; readiness: number | null;
  experience: number | null; growth: number | null; trackLabel?: string;
}): DecisionFit {
  const metadata = competition.recommendation;
  const subject = intersection(profile.specificSubjects, metadata.subjects ?? []);
  const skills = intersection(profile.skills, metadata.skills);
  const interests = intersection(profile.interests, metadata.interests);
  const outputs = intersection(profile.preferredOutputs, metadata.preferredOutputs);
  const artifacts = intersection(profile.evidence.filter(value => value !== "none"), metadata.evidence);
  const target = input.trackLabel ?? competition.name;
  const evidence: CompetitionFitEvidence = { goal: [], task: [], experience: [], readiness: [], growth: [], unknowns: [] };
  if (input.goal && input.goal !== "award") {
    if (metadata.goalValues[input.goal] >= 0.5) evidence.goal.push(`你希望积累${label(input.goal)}相关经历。可以先用“${target}”的作品要求判断这份投入能否服务这个目标。`);
  } else if (input.goal === "award") evidence.unknowns.push("本校如何认定奖项，需要核对你所在学校的最新文件。");
  if (subject.length) evidence.task.push(`你确认的细分方向“${subject.map(label).join("、")}”与${target}的任务相近。`);
  if (interests.length) evidence.task.push(`你对${interests.map(label).join("、")}感兴趣，可以从${target}的相应任务开始了解。`);
  if (input.task !== null && input.task > 0.3 && !evidence.task.length) evidence.task.push(`你偏好的任务与“${target}”有交集，可先比较作品要求和自己愿意承担的工作。`);
  const chemistryRoles: Record<string, string> = {
    "chemistry-experiment-innovation": input.trackLabel === "科普实验"
      ? "赛途建议分工：把实验原理写成面向非专业听众的讲解，并和负责实验的成员核对演示证据。"
      : input.trackLabel === "数智化实验" ? "赛途建议分工：处理实验数据或实现软件原型，再与实验成员共同验证结果。"
      : input.trackLabel === "改进实验" ? "赛途建议分工：比较改进前后的测量结果，记录可复现的步骤。"
      : "赛途建议分工：设计一组能验证实验假设的对照，记录数据及误差来源。",
    "chemical-engineering-experiment": "赛途建议分工：练习实际操作和数据记录，用重复测量检查实验结果。",
    "chemical-engineering-design": "赛途建议分工：从一个单元操作入手，做物料衡算并核对流程图上的输入输出。"
  };
  if (chemistryRoles[competition.id]) evidence.task.push(chemistryRoles[competition.id]!);
  const activity=profile.decisionContext?.businessActivity;
  const confirmedActivity = activity && getSeriesBusinessActivities(competition.id)?.includes(activity);
  if (confirmedActivity) {
    const taskLabel = businessActivities.find(item => item.value === activity)!.label;
    evidence.task.unshift(`你特意选了“${taskLabel}”。这项赛事有对应的实际工作，可以优先比较交付物。`);
  }
  const role = profile.decisionContext?.experienceRole;
  if (skills.length) evidence.experience.push(`你提到的${skills.map(label).join("、")}可用于${target}的相关工作。`);
  if (artifacts.length) evidence.experience.push(`你已有的${artifacts.map(label).join("、")}可以作为备赛起点。`);
  if (role && role !== "unknown") evidence.experience.push(({observed:"你上次主要观察学习，先尝试一个可独立完成的小任务。", assisted:"你上次协助完成项目，可以从相近分工开始。", independent:"你独立完成过部分任务，可以复用自己的工作记录。", led:"你曾主导项目，可以先拆分交付物，再与队友确认分工。"} as const)[role]);
  const missing = (metadata.requiredResources ?? []).filter(r => r !== "none" && !profile.availableResources.includes(r));
  if (missing.length) evidence.readiness.push(`准备前先核实${missing.map(label).join("、")}是否需要、如何获得。`);
  if (outputs.length) evidence.growth.push(`你希望做出${outputs.map(label).join("、")}，这与目录记录的成果方向有交集。`);
  const goal = input.goal && input.goal !== "award" ? metadata.goalValues[input.goal] : null;
  const dimensions = {goal: round(30 * (goal ?? 0)), task: round(25 * (input.task ?? 0)),
    experience: round(20 * (input.experience ?? 0)), readiness: round(15 * (input.readiness ?? 0)),
    growth: round(10 * (input.growth ?? 0))};
  const lower = round(Object.values(dimensions).reduce((n, x) => n + x, 0));
  const upper = round(lower + (goal === null ? 30 : 0) + (input.task === null ? 25 : 0) +
    (input.experience === null ? 20 : 0) + (input.readiness === null ? 15 : 0) + (input.growth === null ? 10 : 0));
  if (upper > lower) evidence.unknowns.push("有些关于目标、经历或准备条件的信息尚未确认，比较结果需结合这些条件。");
  // Generic skills and aspirations alone cannot distinguish one competition
  // from another. A beginner can establish a concrete direction without a prize
  // or past project, e.g. a chemistry course + experimental work, or coding.
  const generalSkills = new Set(["writing", "presentation", "research"]);
  const generalInterests = new Set(["career", "innovation", "academic-research"]);
  const generalTasks = new Set(["career", "product", "research"]);
  const taskSpecific = profile.taskFormats.some(task => !generalTasks.has(task));
  const hasConcreteConnection = confirmedActivity || artifacts.length > 0 ||
    skills.some(skill => !generalSkills.has(skill)) ||
    interests.some(interest => !generalInterests.has(interest)) ||
    (subject.length > 0 && (profile.majorFields.some(major => major !== "other") || taskSpecific)) ||
    (taskSpecific && (input.task ?? 0) >= 0.6) ||
    ((profile.decisionContext?.experienceRole === "independent" || profile.decisionContext?.experienceRole === "led") && skills.length > 0);
  const actionable = hasConcreteConnection && (input.task ?? 0) >= 0.35 && lower >= 17;
  return { lower, upper, dimensions, evidence, actionable };
}
