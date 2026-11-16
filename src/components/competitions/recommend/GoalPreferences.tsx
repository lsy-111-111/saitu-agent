import { ChoiceGroup } from "./ChoiceGroup";
import { goalOptions } from "./questionContent";
import type { DecisionContext, DraftCompetitionProfile } from "./questionFlow";

const extraGoals = [{value:"explore",label:"先发现自己愿意长期做的方向"},{value:"skill",label:"先练会一项具体能力"}] as const;
const goalTradeoffs: Record<string,string> = {
  explore:"先用小任务比较兴趣，暂时可能没有完整作品或比赛成绩。",
  skill:"优先重复练习与反馈，需要明确想练的任务；短期不一定有完整作品。",
  portfolio:"优先完成能展示的作品，需要留时间做验证和整理，可能少参加几场比赛。",
  project:"优先亲手完成项目，要为需求、协作与交付投入持续时间。",
  employment:"优先积累能讲清本人贡献的项目案例；参赛本身不保证实习或就业。",
  award:"优先围绕评审要求备赛，需要接受竞争结果不确定；本校认定另行核实。",
  postgraduate:"优先积累可解释的研究或项目经历，学校认定与升学结果仍需分别核实。",
  entrepreneurship:"优先验证真实需求，需要接触用户并接受想法可能被推翻。",
  networking:"优先寻找合作和反馈机会，需要主动沟通；不保证结识导师或获得机会。"
};

export function GoalPreferences({profile,context,onChange}:{profile:DraftCompetitionProfile;context:DecisionContext;onChange:(value:DecisionContext)=>void}) {
  const options=[...extraGoals,...goalOptions.filter(item=>profile.goals?.includes(item.value))];
  return <div className="space-y-4 rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
    <ChoiceGroup compact label="如果先解决一件事，你更想优先得到什么？" name="goal-intent" options={options}
      hint="可以先探索方向或练能力，也可以从上面选中的目标中确定优先项。"
      value={context.goalIntent} onChange={value=>{
        const goal=options.find(item=>item.value===value)?.value;
        if(goal)onChange({...context,goalIntent:goal,goalResolution:undefined,primaryGoal:undefined});
      }} />
    {context.goalIntent ? <p className="rounded-xl bg-white p-3 text-sm leading-6" role="status">这项选择的取舍：{goalTradeoffs[context.goalIntent]}</p> : null}
    {(profile.goals?.length??0)>1 ? <div className="space-y-2 text-sm leading-6"><p className="font-semibold">你选中的目标可能需要不同投入：</p>{profile.goals?.map(goal=><p key={goal}>{goalOptions.find(item=>item.value===goal)?.label}：{goalTradeoffs[goal]}</p>)}</div> : null}
    <ChoiceGroup compact label="了解取舍后，你现在如何决定？" name="goal-resolution"
      options={context.goalIntent?[{value:"confirmed",label:"确认，先按这个方向比较"},{value:"undecided",label:"暂不决定，先看不同方向的取舍"}]:[{value:"undecided",label:"暂不决定，先看不同方向的取舍"}]}
      value={context.goalResolution} onChange={value=>{
        if(value==="confirmed"||value==="undecided")onChange({...context,goalResolution:value,primaryGoal:undefined});
      }} />
  </div>;
}
