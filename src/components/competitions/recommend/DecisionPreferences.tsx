import { businessActivities } from "@/lib/competitions/business-activities";
import { decisionBudgetBounds, isDecisionBudgetMaximumValid } from "@/lib/competitions/decision-budget";
import { ChoiceGroup } from "./ChoiceGroup";
import { ExperiencePreferences } from "./ExperiencePreferences";
import { GoalPreferences } from "./GoalPreferences";
import { availableResourceOptions } from "./questionContent";
import type { DecisionContext, DraftCompetitionProfile, FixedQuestionTurn } from "./questionFlow";

import { avoidableTasks } from "./questionFlow";

export function DecisionPreferences({ turn, profile, context, onChange, depth = "quick" }: {
  turn: FixedQuestionTurn;
  profile: DraftCompetitionProfile;
  context: DecisionContext;
  onChange: (context: DecisionContext) => void;
  depth?: "quick" | "deep";
}) {
  if (turn.id === "goals") return <GoalPreferences profile={profile} context={context} onChange={onChange} />;
  if (turn.id === "weeklyCommitment") return <ChoiceGroup compact label="你想先准备多长时间？" name="preparation-horizon"
    options={[{value:"1-2-weeks",label:"先体验 1–2 周"},{value:"one-month",label:"约一个月"},{value:"2-3-months",label:"2–3 个月"},{value:"long-term",label:"可以长期准备"},{value:"unknown",label:"暂不确定"}]}
    value={context.preparationHorizon} onChange={value=>{
      if(value==="1-2-weeks"||value==="one-month"||value==="2-3-months"||value==="long-term"||value==="unknown")onChange({...context,preparationHorizon:value});
    }} />;
  if (turn.id === "teamStatus") return <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" checked={context.fixedTeam ?? false}
      onChange={event => onChange({...context, fixedTeam: event.target.checked})} />
    必须保持当前队伍及人数
  </label>;
  if (turn.id === "experienceLevel") return <ExperiencePreferences context={context} onChange={onChange} depth={depth} />;
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
  const budgetBounds = context.budget ? decisionBudgetBounds(context.budget.range) : null;
  return <div className="space-y-5"><ChoiceGroup compact label="这次可接受的自费预算是多少？" name="decision-budget"
    options={[{value:"zero",label:"暂不自费"},{value:"under100",label:"不超过 100 元"},{value:"100-500",label:"101–500 元"},{value:"over500",label:"500 元以上"},{value:"unknown",label:"暂不确定"}]}
    value={context.budget?.range} onChange={value=>{
      if(value==="zero"||value==="under100"||value==="100-500"||value==="over500"||value==="unknown")onChange({...context,budget:{range:value,scope:context.budget?.scope??"unknown"}});
    }}/>
    {context.budget && context.budget.range!=="unknown" ? <div className="space-y-3">
      {budgetBounds ? <label className="block text-sm">预算上限（元，可暂不填）<input className="mt-2 block w-full max-w-xs rounded-lg border border-control-border p-2" type="number" min={budgetBounds[0]} max={budgetBounds[1]}
        value={context.budget.maximumYuan??""} onChange={event=>onChange({...context,budget:{...context.budget!,maximumYuan:event.target.value?Number(event.target.value):undefined}})}/></label>:null}
      {!isDecisionBudgetMaximumValid(context.budget)?<p role="alert" className="text-sm text-error-700">{budgetBounds?`请填写 ${budgetBounds[0]}–${budgetBounds[1]} 元的整数上限；如果还不确定，可以清空此项。`:"当前预算选项无需填写确切上限，请清空此项。"}</p>:null}
      <ChoiceGroup compact label="这个预算指的是？" name="budget-scope" options={[{value:"personal",label:"我个人的总预算"},{value:"team",label:"整个团队的总预算"},{value:"unknown",label:"还没确定"}]}
        value={context.budget.scope} onChange={value=>{
          if(value==="personal"||value==="team"||value==="unknown")onChange({...context,budget:{...context.budget!,scope:value}});
        }} />
    </div>:null}
    <details className="rounded-xl border border-border p-3">
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
  </details></div>;
}
