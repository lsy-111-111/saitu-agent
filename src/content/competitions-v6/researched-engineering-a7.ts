import { authoredDeepCase, readSource, type ResearchedContent } from "./research-types";

const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/engineering-a-reading-log.json" });
const entry = source("robomaster-2026-participant", "https://bbs-web-static.robomaster.com/3fcc5b752b7a435b9323892f57c574141766654205303/RoboMaster%202026%20%E6%9C%BA%E7%94%B2%E5%A4%A7%E5%B8%88%E8%B6%85%E7%BA%A7%E5%AF%B9%E6%8A%97%E8%B5%9B%E5%8F%82%E8%B5%9B%E6%89%8B%E5%86%8CV1.1.0%EF%BC%8820251225%EF%BC%89.pdf", "RMUC2026参赛手册V1.1.0", "RoboMaster组委会", "2026超级对抗赛资格与技术评审", "PDF第7—14、16—19页", "2025-12-25");
const task = source("robomaster-2026-core-task", "https://bbs-web-static.robomaster.com/e354d2750e17485e8f67e5b5a9d1a2891786094242879/RoboMaster%202026%20%E6%9C%BA%E7%94%B2%E5%A4%A7%E5%B8%88%E8%B6%85%E7%BA%A7%E5%AF%B9%E6%8A%97%E8%B5%9B%E6%AF%94%E8%B5%9B%E8%A7%84%E5%88%99%E6%89%8B%E5%86%8CV2.2.0%EF%BC%8820260807%EF%BC%89.pdf", "RMUC2026比赛规则V2.2.0：科技核心装配", "RoboMaster组委会", "2026超级对抗赛科技核心任务", "PDF第85—91页，印刷页84—90", "2026-08-07");

export const engineeringResearchA7: ResearchedContent[] = [{
  seriesId: "robomaster-university", name: "RoboMaster机甲大师高校系列赛", organizer: "RoboMaster组委会", aliases: ["RMUC"], authorAgentId: "/root",
  editionId: "2026-rmuc", edition: "2026超级对抗赛历史档案", groupId: "university", group: "高校正式队员", scopeId: "rmuc-2026-core-assembly", scope: "2026超级对抗赛工程机器人科技核心装配", origin: "legacy_135", trackId: "engineering-core-assembly", trackName: "工程机器人装配与系统测试", taskFamily: "engineering-prototype", subjectDomains: ["engineering"], factStatus: "historical", registrationStatus: "historical", registrationNote: "本档案记录2026已结束赛季，不将2027规则或其他赛项混入；下一赛季报名资格须重核。",
  sources: [entry, task],
  verified: {
    eligibility: { text: "2026正式学生队员为规定赛季内具有本校在校证明的全日制本专科、硕士或博士，正式队员10—35人。队伍还须满足往届RMUC中期考核或RMUL晋级等报名条件；仅学历符合不能确认可报名。梯队队员没有本手册所述获奖资格。", source: 0 },
    track: { text: "工程机器人将能量单元装入科技核心；难度逐级开放，高级任务增加平移、旋转及双核心协同。确认后由裁判系统检测装配是否正确。", source: 1 },
    participation: { text: "依托高校战队报名，按顺序完成规划、规则测评、中期、完整形态及裁判系统考核等环节，满足条件后参加线下赛；不能由个人临时组队直接进入RMUC。", source: 0 },
    deliverables: { text: "技术评审涉及赛季规划、进度与预算、项目分析、完整形态视频、技术方案、成本报告、支出流水和BOM；装配训练可贡献对应子系统的代码、图纸与测试证据。", source: 0 },
    rubric: { text: "科技核心以规定顺序、位姿和裁判确认判定成功；不同难度获得不同游戏内资源收益。该子任务不是独立论文评分赛，不能把工程机器人训练分数等同全队获奖概率。", source: 1 }
  },
  eligibilityRules: [
    { id: "rmuc-degree", field: "degree", operator: "in", value: ["vocational", "undergraduate", "master", "doctorate"], factIds: ["robomaster-university:v2:eligibility"], note: "正式学生队员学历" },
    { id: "rmuc-enrolled", field: "enrolled", operator: "eq", value: true, factIds: ["robomaster-university:v2:eligibility"], note: "规定赛季内本校在校证明" },
    { id: "rmuc-fulltime", field: "fullTime", operator: "eq", value: true, factIds: ["robomaster-university:v2:eligibility"], note: "全日制" },
    { id: "rmuc-path", field: "priorQualification", operator: "requires_confirmation", value: "学校战队既往资格、本人正式队员身份及名单", factIds: ["robomaster-university:v2:eligibility"], note: "本人四人学习小组不能当作满足正式战队人数与往届资格" }
  ],
  task: "在既有战队中承担装配机构、反馈控制或系统测试，解释机械动作与裁判状态为何一致或失配。",
  roles: [{ name: "装配控制", task: "把机械动作分为带反馈的阶段，处理不到位和错误确认", skills: ["programming", "engineering", "electronics"], evidence: "你的程序怎样判断动作完成，而不是只延时后进入下一步？", output: "本人状态机、日志与重复测试" }, { name: "质量与项目管理", task: "把故障、成本和复现步骤写清，追踪修复是否有效", skills: ["data-analysis", "project-management", "writing"], evidence: "你怎样把一次故障转成下一次能稳定复现的检查？", output: "故障清单、测试矩阵、成本与进度证据" }],
  gain: "可积累跨机械、电控和软件的协作经验；个人收益取决于真实贡献及可复现记录，加入战队或参加梯队训练不自动获得奖项。",
  entry: "新生可先做状态图、日志分析和低风险台架测试，再争取正式子系统岗位。需要确认学校战队是否接收及资源可用。",
  completion: "正式完赛依赖全队多机器人研发与技术评审。装配岗位从单次成功到变化条件下稳定运行，再到协同和战术效率，难度逐层增加。",
  investment: "编辑建议四周每周5—8小时做一个装配子任务。正式赛季通常需要学校战队、加工测试场地、指导与设备；个人费用和报名相关支出未核，不称免费。",
  fit: ["愿意反复排查系统故障", "能长期参与已有工程团队"], avoid: ["只希望短期个人报名获奖", "无法获得战队、设备和稳定时间"],
  trial: { action: "用纸面或程序模拟一级到三级装配状态，注入不到位、确认失败和取出三类事件，检查是否错误宣布成功。", output: "状态图、事件序列和故障处理表", check: "仅有动作发出不代表裁判确认；模拟明确标为模拟。", reflection: "你更享受机构与控制，还是测试和项目协作？" },
  remaining: ["下一届报名资格与规则重新核验", "加入具体战队后的身份、资源、时间和费用由本人确认"],
  deepCase: authoredDeepCase({
    seriesId: "robomaster-university", task: "2026 RMUC科技核心装配：从插入到平移、转动和裁判确认。", title: "把机械动作变为可验证的装配状态机", sourceIds: [entry.id, task.id],
    boundary: "只拆解2026规则V2.2.0装配任务，并以同赛季参赛手册说明入口；未声称已读取整本158页规则。训练不含对抗兵种制作，也不承诺整队成绩。",
    steps: ["对照规则把动作命令、到位反馈与成功确认分开。", "先验证一级流程，再逐项加入更高等级的移动与旋转条件。", "注入提前动作、错误角度、确认失败和途中取出，检查系统能否正确停止或恢复。", "比较多次成功率与失败恢复时间，记录每次代码或机构改动的作用。"],
    questions: ["动作执行完但裁判没确认时，系统是否误报成功？", "机构变化后，既有反馈条件是否仍成立？", "成功视频之外的失败次数与原因是否完整保留？"],
    rubrics: [["按等级完成规定动作并由裁判确认", "编辑检查：每个状态有对应反馈和失败分支"], ["高级装配有时限和协同要求", "编辑检查：分别测量单步骤稳定性与完整流程，而非只展示最快一次"]],
    roles: [{ role: "控制实现", steps: ["建立状态模型", "实现反馈与异常处理", "对比重复运行"], contributionProof: "本人代码差异及失败到修复的日志" }, { role: "系统验证", steps: ["提取任务约束", "设计故障注入", "整理可复现测试"], contributionProof: "本人测试用例、缺陷报告和复核记录" }],
    weeks: [["读装配规则并画状态机", "每一步能区分指令、反馈和成功"], ["在模拟或已有台架验证一级流程", "重复运行并记录全部结果"], ["增加约束和异常恢复", "错误输入不会变为虚假成功"], ["整理贡献与交接材料", "另一队员能按记录复现并说明局限"]],
    exits: ["没有战队和台架时只保留模拟学习，不声称硬件已验证", "动作不稳定时暂停追求高等级，优先找出反馈与机械误差"]
  })
}];
