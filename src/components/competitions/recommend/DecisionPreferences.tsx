import { businessActivities } from "@/lib/competitions/business-activities";
import { ChoiceGroup } from "./ChoiceGroup";
import { availableResourceOptions } from "./questionContent";
import type { DecisionContext, DraftCompetitionProfile, FixedQuestionTurn } from "./questionFlow";

import { avoidableTasks, experienceRoles } from "./questionFlow";

export function DecisionPreferences({ turn, profile, context, onChange }: {
  turn: FixedQuestionTurn;
  profile: DraftCompetitionProfile;
  context: DecisionContext;
  onChange: (context: DecisionContext) => void;
}) {
  if (turn.id === "teamStatus") return <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" checked={context.fixedTeam ?? false}
      onChange={event => onChange({...context, fixedTeam: event.target.checked})} />
    必须保持当前队伍及人数
  </label>;
  if (turn.id === "experienceLevel") return (
    <ChoiceGroup compact label="这段经历里，哪些工作是你本人做的？" name="decision-experience-role"
      options={experienceRoles} value={context.experienceRole} onChange={value => onChange({
        ...context, experienceRole: experienceRoles.find(role => role.value === value)?.value
      })} />
  );
  if (turn.id === "taskFormats") {
    const options = avoidableTasks
      .filter(option => !profile.taskFormats?.some(value => value === option.value));
    const showBusinessChoices = Boolean(context.businessActivity || profile.majorFields?.some(value => value === "business" || value === "finance-taxation") ||
      profile.taskFormats?.includes("entrepreneurship") || profile.interests?.includes("finance-taxation"));
    return <div className="space-y-3">
      {showBusinessChoices && <ChoiceGroup compact label="商科方向里，你更想亲手做哪类工作？（可跳过）" name="decision-business-activity"
        options={[...businessActivities,{value:"unspecified",label:"还没想好"}]} value={context.businessActivity}
        onChange={value => onChange({...context,businessActivity:businessActivities.find(item=>item.value===value)?.value})} />}
      <details className="rounded-xl border border-border p-3">
      <summary className="cursor-pointer font-semibold text-brand-700">有没有明确不想做的任务？</summary>
      <ChoiceGroup compact multiple label="我希望避开" name="decision-excluded-tasks" options={options}
        value={context.excludedTaskFormats} onChange={value => onChange({
          ...context, excludedTaskFormats: options.filter(option => value.includes(option.value)).map(option => option.value)
        })} />
    </details></div>;
  }
  if (turn.id !== "availableResources") return null;
  const possible = availableResourceOptions.filter(option => option.value !== "none" && !profile.availableResources?.some(value => value === option.value));
  return <details className="rounded-xl border border-border p-3">
    <summary className="cursor-pointer font-semibold text-brand-700">哪些资源可以争取，哪些确实无法获得？</summary>
    {(["obtainableResources", "unavailableResources"] as const).map(key => {
      const other = key === "obtainableResources" ? "unavailableResources" : "obtainableResources";
      const options = possible.filter(option => !context[other]?.some(value => value === option.value));
      return <div className="mt-3" key={key}><ChoiceGroup compact multiple
        label={key === "obtainableResources" ? "可以通过老师或队友争取" : "确认无法获得"}
        name={key} options={options} value={context[key]} onChange={value => onChange({
          ...context, [key]: options.filter(option => value.includes(option.value)).map(option => option.value)
        })} /></div>;
    })}
  </details>;
}
