import { ChoiceGroup } from "./ChoiceGroup";
import { experienceRoles, type DecisionContext } from "./questionFlow";
import { isCompetitionAnswerTextValid } from "./answerText";

type Experience = NonNullable<DecisionContext["experiences"]>[number];
export const noviceTasks = [
  { value: "organize-information", label: "把零散资料整理成别人看得懂的一页说明" },
  { value: "explain-ideas", label: "向同学讲清一个问题，听反馈再修改表达" },
  { value: "observe-record", label: "观察一个校园问题，记录数据并比较原因" },
  { value: "make-content", label: "围绕一个主题做海报、短视频或文字作品" },
  { value: "build-tool", label: "做一个解决小麻烦的工具，反复试用和调整" }
] as const;

const completions = [
  { value: "learning", label: "只学习或试过" }, { value: "draft", label: "有草稿或初步结果" },
  { value: "delivered", label: "完成并交付" }, { value: "feedback", label: "有人使用、反馈或复现" },
  { value: "unknown", label: "暂不确定" }
] as const;
const control = "mt-2 w-full rounded-xl border border-control-border bg-white p-3 text-sm";

export function ExperiencePreferences({ context, onChange, depth }: {
  context: DecisionContext; onChange: (context: DecisionContext) => void; depth: "quick" | "deep";
}) {
  const experiences = context.experiences ?? [];
  function update(index: number, patch: Partial<Experience>) {
    onChange({ ...context, experiences: experiences.map((item, i) => i === index
      ? { ...item, ...patch, confirmed: true } : item) });
  }
  function addExperience() {
    onChange({ ...context, experienceStatus: "provided", experienceRole: undefined,
      experiences: [...experiences, { id: `experience-${globalThis.crypto.randomUUID()}`, task: "", contribution: "unknown", completion: "unknown", challenge: "", confirmed: false }] });
  }
  return <div className="space-y-5 rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
    <ChoiceGroup compact label="除了比赛，你能想起一件自己参与过的事吗？" name="experience-status"
      hint="课程作业、社团、生活中的小任务都算。你的自述会直接用于匹配，没有经历也能继续。"
      options={[{value:"provided",label:"有，我想补充一段具体经历"},{value:"none",label:"暂时想不起或还没有"},{value:"unknown",label:"暂不确定"}]}
      value={context.experienceStatus} onChange={value => {
        if (value === "provided") {
          if (!experiences.length) addExperience();
          else onChange({...context, experienceStatus: "provided", experienceRole: undefined});
        } else if (value === "none" || value === "unknown") onChange({...context, experienceStatus:value, experiences:[], experienceRole:undefined});
      }} />
    {context.experienceStatus === "provided" ? experiences.map((experience, index) => <fieldset className="space-y-4 rounded-xl border border-border bg-white p-4" key={experience.id}>
      <legend className="px-2 font-semibold">第 {index + 1} 段经历</legend>
      <label className="block text-sm font-semibold">具体做了什么？
        <textarea className={control} maxLength={120} rows={2} value={experience.task}
          placeholder="例如：整理社团活动问卷，做成三张图。只写任务，不填写姓名、学号等信息。"
          onChange={event => update(index,{task:event.target.value})} />
      </label>
      <label className="block text-sm font-semibold">其中你本人负责哪种程度的工作？
        <select className={control} value={experience.contribution} onChange={event => {
          const value=experienceRoles.find(role=>role.value===event.target.value)?.value;
          if(value) update(index,{contribution:value});
        }}>{experienceRoles.map(role=><option key={role.value} value={role.value}>{role.label}</option>)}</select>
      </label>
      <label className="block text-sm font-semibold">这件事最后到哪一步？
        <select className={control} value={experience.completion} onChange={event => {
          const value=completions.find(item=>item.value===event.target.value)?.value;
          if(value) update(index,{completion:value});
        }}>{completions.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select>
      </label>
      <label className="block text-sm font-semibold">遇到什么困难，你怎样处理？（可跳过）
        <textarea className={control} maxLength={120} rows={2} value={experience.challenge}
          placeholder="例如：数据不齐，我先记录缺失项，再向负责人确认。记不清可以留空。"
          onChange={event=>update(index,{challenge:event.target.value})} />
      </label>
      {(experience.task && !isCompetitionAnswerTextValid(experience.task)) || (experience.challenge && !isCompetitionAnswerTextValid(experience.challenge)) ? <p role="alert" className="text-sm text-error-700">请只描述任务和处理过程，删除姓名、电话、学号等个人信息。</p> : null}
      <button className="text-sm font-semibold text-brand-700" type="button" onClick={()=>onChange({...context,experiences:experiences.filter((_,i)=>i!==index),experienceStatus:experiences.length===1?"unknown":"provided"})}>撤回这段经历</button>
    </fieldset>) : null}
    {context.experienceStatus === "provided" && depth === "deep" && experiences.length < 2 ? <button type="button" className="min-h-11 rounded-full border border-brand-300 bg-white px-4 text-sm font-semibold text-brand-700" onClick={addExperience}>补充第二段经历</button> : null}
    {context.experienceStatus === "none" || context.experienceStatus === "unknown" ? <div className="space-y-3">
      <p className="text-sm leading-6">先看看你愿不愿意尝试下面的任务。这些选择只说明兴趣，不会当作已有能力。</p>
      {noviceTasks.map(task=><label className="block text-sm" key={task.value}>{task.label}
        <select className={control} value={context.noviceTaskPreferences?.find(item=>item.task===task.value)?.preference??"unknown"}
          onChange={event=>{
            const preference=event.target.value;
            if(preference!=="try"&&preference!=="avoid"&&preference!=="unknown")return;
            onChange({...context,noviceTaskPreferences:[...(context.noviceTaskPreferences??[]).filter(item=>item.task!==task.value),{task:task.value,preference}]});
          }}><option value="unknown">还不了解，暂不确定</option><option value="try">愿意试一试</option><option value="avoid">明确不想做</option></select>
      </label>)}
    </div> : null}
  </div>;
}
