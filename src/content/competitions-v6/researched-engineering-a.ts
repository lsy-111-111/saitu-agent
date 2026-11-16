import { authoredDeepCase, readSource, type ResearchedContent } from "./research-types";
import { engineeringResearchA2 } from "./researched-engineering-a2";
import { engineeringResearchA3 } from "./researched-engineering-a3";
import { engineeringResearchA4 } from "./researched-engineering-a4";
import { engineeringResearchA5 } from "./researched-engineering-a5";
import { engineeringResearchA6 } from "./researched-engineering-a6";
import { engineeringResearchA7 } from "./researched-engineering-a7";
import { engineeringResearchA8 } from "./researched-engineering-a8";
import { engineeringResearchA9 } from "./researched-engineering-a9";
import { engineeringResearchA10 } from "./researched-engineering-a10";

const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/engineering-a-reading-log.json" });

/** Authored from the linked rule text; publication still requires two independent source reviews. */
export const engineeringResearchA: ResearchedContent[] = [
  ...engineeringResearchA2,
  ...engineeringResearchA3,
  ...engineeringResearchA4,
  ...engineeringResearchA5,
  ...engineeringResearchA6,
  ...engineeringResearchA7,
  ...engineeringResearchA8,
  ...engineeringResearchA9,
  ...engineeringResearchA10,
  {
    seriesId: "mechanical-innovation-design", authorAgentId: "/root/continue_catalog", name: "全国大学生机械创新设计大赛", organizer: "全国大学生机械创新设计大赛组委会", aliases: [],
    editionId: "2026-12-regular", edition: "第十二届2026常规赛", groupId: "undergraduate-junior-college", group: "本科、专科及2026届毕业生", scopeId: "china-regular-vegetable", scope: "2026常规赛叶菜处理方向；不套用于2027数字孪生挑战赛", origin: "legacy_135",
    trackId: "vegetable-processing", trackName: "叶菜洁净化处理包装一体化机械", taskFamily: "engineering-prototype", subjectDomains: ["engineering", "agriculture"], factStatus: "verified_current", registrationStatus: "closed", registrationNote: "2026常规赛预赛、决赛时段均已过去；本记录供任务学习及下一届准备，不是当前可报名承诺。",
    sources: [source("mechanical-2026-notice", "https://12umic.hit.edu.cn/2025/0321/c20012a364782/page.htm", "第十二届大赛主题与内容通知", "全国组委会、哈尔滨工业大学赛事站", "2026常规赛全国规则", "第四节条件方式、第六节评奖、第七节经费", "2025-03-20"), { ...source("mechanical-2026-instructions", "https://jdxy.hsu.edu.cn/_upload/article/files/40/1f/feb2c7904f029972f37b54785c30/0a272ab2-669f-41ab-9f19-eb143648a954.pdf", "第十二届机械创新设计常规赛参赛须知", "全国组委会（黄山学院托管原件）", "2026常规赛全国命题、评分及交付", "PDF第1页叶菜任务、第2页评审、第3页图纸及学校费用承担", "2025-03-20"), authority: "official_host" }],
    verified: {
      eligibility: { text: "在校本、专科生及2026届毕业生可由学校推荐；个人或不超过5名学生组队，指导教师至多2名。", source: 0 },
      track: { text: "本条专指批量叶菜清理与称重包装，题目排除了根茎花类蔬菜及家庭厨房应用；另有水产品、仿生蝴蝶方向。", source: 1 },
      participation: { text: "经学校推荐、所在赛区预赛、全国初评与现场决赛；不得擅自跨赛区。", source: 1 },
      deliverables: { text: "交报名材料、设计说明、主要图纸、实物或比例样机，以及不超过3分钟的功能视频。", source: 0 },
      rubric: { text: "叶菜方向综合看选题价值、设计创新和合理性、制作与功能、现场讲解答辩；不借用仿生蝴蝶的60/40权重。", source: 1 },
      investment: { text: "须知要求校方承担学校参赛费用，不向学生个人收取；赛区可规定报名费，因此须确认学校落实及样机资源，不能标总成本为零。", source: [0, 1] }
    },
    eligibilityRules: [{ id: "mechanical-degree", field: "degree", operator: "in", value: ["undergraduate", "vocational"], factIds: ["mechanical-innovation-design:v2:eligibility"], note: "2026届毕业生例外另行核对，不强加当前在读要求。" }, { id: "mechanical-size", field: "teamSize", operator: "max", value: 5, factIds: ["mechanical-innovation-design:v2:eligibility"], note: "允许个人参加；本届学生队员至多5人。" }, { id: "mechanical-school", field: "priorQualification", operator: "requires_confirmation", value: "学校推荐和所在赛区通道", factIds: ["mechanical-innovation-design:v2:eligibility"], note: "不能以社会个人报名替代学校推荐。" }],
    task: "把叶菜从脏乱、长短不一的来料处理成可称重包装的批量产品，设计连续工序及可解释的样机。",
    roles: [{ name: "机构与加工", task: "选择送料、清理和包装连接方式，检查卡料与损伤", skills: ["mechanical", "engineering"], evidence: "哪次机构修改减少卡料？怎样重复验证而非只看一次成功演示？", output: "本人图纸、机构迭代和故障记录" }, { name: "检测与集成", task: "设置计量、状态检测和工序协调，记录误差及节拍", skills: ["programming", "electronics", "data-analysis"], evidence: "你负责的测量或控制部分怎样在湿滑、不同大小来料下工作？", output: "控制流程、试验表及接口说明" }],
    gain: "实际制作能形成工程图、加工取舍、失效分析与测试证据；学校认可和产业采用需另外确认，不由赛事名气保证。",
    entry: "可以从测量一种叶菜的尺寸差异、画一个送料机构开始；未做过加工者先承担调研与测试，别把兴趣写成机械设计能力。",
    completion: "完赛难在工序连续、样机可靠和图纸完整；获奖还取决于方案创新与可解释的对比测试，不能凭一次动作成功判断。",
    investment: "编辑建议四周先检验一个工序，每周4—6小时；正式样机需场地、加工工具、材料及指导，先确认校方资源与费用承担再扩大制作。",
    fit: ["喜欢做实体装置并排查卡料、振动等问题", "愿意把图纸、原理和实测证据连起来"], avoid: ["只想交概念海报而不做功能验证", "没有加工条件却准备直接制作整条生产线"],
    trial: { action: "用纸板或现成安全练习材料搭一个送料模型，比较两种尺寸的仿真来料，记录卡住的位置。", output: "机构草图、两组测试与一次修改理由", check: "明确模型不能证明真实叶菜加工性能，说明下一步怎样取得合法安全的验证条件。", reflection: "你更喜欢设计机构、调控制还是分析失败？" },
    remaining: ["2027数字孪生挑战赛另立规则，不能复用本条资格或交付", "具体校内名额、材料和费用承担需学校确认"],
    deepCase: authoredDeepCase({ seriesId: "mechanical-innovation-design", task: "2026官方具体命题：叶菜洁净化处理包装一体化机械。", title: "从叶菜来料差异到连续处理样机", sourceIds: ["mechanical-2026-instructions"], boundary: "来源为官方命题原文；下列方案是编辑设计路线，不是获奖方案，也没有规定唯一机构。", steps: ["选定一种叶菜，记录泥土、根叶和尺寸变化对工序的影响，明确批量使用场景。", "比较连续送料与分步送料，列出损伤、卡料、清理效果和节拍的取舍。", "先做单工序试验，再设计工序接口；失败时保留输入、动作和结果。", "将图纸、样机和测试对应，解释未解决的卫生、可靠性或生产规模限制。"], questions: ["怎样证明设计适用于目标叶菜，而不只是展示一次动作？", "哪个创新改善了功能或制作成本？", "如果上游卡料，后续包装怎样停止或恢复？"], rubrics: [["选题实用性", "编辑检查：真实加工问题与来料差异记录"], ["结构合理与创新", "编辑检查：两方案比较、运动和受力分析"], ["制作功能与性价比", "编辑检查：连续运行、损伤/卡料记录和材料成本"], ["答辩质疑", "编辑检查：图纸与实物一致，能承认验证边界"]], roles: [{ role: "机构负责人", steps: ["画工序与运动关系", "制作单机构并记失效", "连接相邻工序并检验接口"], contributionProof: "带日期的个人图纸与修改原因" }, { role: "试验负责人", steps: ["定义成功与损伤指标", "准备有差异的测试输入", "重测修改是否有效"], contributionProof: "原始测试表、反例与复测记录" }], weeks: [["限定一种叶菜及一个工序，核对场地与材料", "完成问题边界、两个候选机构及资源清单"], ["制作低风险机构模型并测试来料差异", "留下一次失败及可复现条件"], ["针对失败修改并比较前后表现", "用相同输入验证改动，不只展示最好一遍"], ["整理图纸、视频与限制说明", "另一人能从图纸理解本人机构和验证结果"]], exits: ["无法取得加工场地时停在桌面分析与小型教学模型，不声称完成生产样机", "真实来料试验不可安全开展时换成安全模拟材料并明确外推限制"] })
  },
  {
    seriesId: "national-structural-design", name: "全国大学生结构设计竞赛", organizer: "上海分区赛主办方东华大学", aliases: [], editionId: "2026-19-shanghai", edition: "第十九届2026上海分区赛", groupId: "undergraduate-junior-college", group: "全日制在校未毕业本、专科生", scopeId: "shanghai-division", scope: "上海分区赛采用全国勒勒车赛题；仅该分区通知范围的队伍与赛程", origin: "legacy_135",
    trackId: "lele-cart", trackName: "勒勒车模型结构设计与制作", taskFamily: "engineering-prototype", subjectDomains: ["engineering"], factStatus: "verified_current", registrationStatus: "closed", registrationNote: "通知计划2026年7月7—9日举办，时间已过去；不视为11月可报名赛事。",
    sources: [{ ...source("structure-shanghai-2026-notice", "https://www.sues.edu.cn/_upload/article/files/20/1e/2db459b7465887d8f668885071da/131fb335-fbb3-4ed9-bef3-3894867f2f46.pdf", "2026上海市结构设计竞赛暨全国分区赛一号通知", "东华大学（上海工程技术大学托管）", "上海分区的人员与赛程", "PDF第2页参赛条件和时间", "2026-05-13"), authority: "official_host" }, { ...source("structure-shanghai-2026-task", "https://www.sues.edu.cn/_upload/article/files/20/1e/2db459b7465887d8f668885071da/2c4a1ed7-4d28-437b-83d2-57787b0de0bb.pdf", "勒勒车模型结构设计与制作赛题", "上海分区赛组委会（上海工程技术大学托管）", "2026上海分区引用的全国题目版本", "PDF第1—3页任务，第5—7页材料与制作，第10—13页判定及评分"), authority: "official_host" }],
    verified: {
      eligibility: { text: "该分区通知要求未毕业的全日制本、专科生，每队3人，每校2队并由学校领队组织。", source: 0 },
      track: { text: "按给定竹材制作由动力小车牵引的勒勒车，运货经过坡、弯、减速带和单桥等路段。", source: 1 },
      participation: { text: "由学校组织上海分区参赛，赛题规定现场制作14小时；具体学校推荐通道另核。", source: 1 },
      deliverables: { text: "交理论方案和完成装配的实体模型，进行现场讲解、模型安装、装货及行驶测试。", source: 1 },
      rubric: { text: "总分100：理论5、制作10、答辩5、运输80；运输再看效率30、完成度10、载质比成本40，并执行违规扣分。", source: 1 }
    },
    eligibilityRules: [{ id: "structure-degree", field: "degree", operator: "in", value: ["undergraduate", "vocational"], factIds: ["national-structural-design:v2:eligibility"], note: "仅本条上海分区通知。" }, { id: "structure-enrolled", field: "enrolled", operator: "eq", value: true, factIds: ["national-structural-design:v2:eligibility"], note: "全日制且未毕业。" }, { id: "structure-fulltime", field: "fullTime", operator: "eq", value: true, factIds: ["national-structural-design:v2:eligibility"], note: "通知明确全日制。" }, { id: "structure-team", field: "teamSize", operator: "eq", value: 3, factIds: ["national-structural-design:v2:eligibility"], note: "每队3人，待组队者仍须落实。" }, { id: "structure-path", field: "priorQualification", operator: "requires_confirmation", value: "本校上海分区推荐名额", factIds: ["national-structural-design:v2:eligibility"], note: "学校报名名额不能仅凭所在地推定。" }],
    task: "在材料、重量与制作时间限制下，用可行的车架和车轮结构把货物稳定运过复杂路面，比较轻量化与可靠性。",
    roles: [{ name: "力学与结构", task: "比较受力路径和连接形式，估计承载与侧翻风险", skills: ["mathematics", "engineering", "mechanical"], evidence: "你如何用计算和载荷试验判断一个节点是薄弱点？", output: "受力简图、节点设计与载重对照" }, { name: "制作与试验", task: "控制粘接和装配质量，测试不同装货布局和行驶策略", skills: ["engineering", "data-analysis", "presentation"], evidence: "模型失败发生在材料、连接还是驾驶过程？你的证据是什么？", output: "制作记录、质量表、视频及试验结论" }],
    gain: "可积累结构计算、动手制作与失效诊断的个人作品；比赛载质比只是规定工况下的指标，不能宣称得到真实车辆工程认证。",
    entry: "可以先用简单梁和连接试验理解力传递；没有力学课基础时从测量与记录入手。", completion: "完赛要把计算转成能经受动态冲击的实体；获奖还要在运输速度、完整度和载质比之间做有证据的取舍。",
    investment: "编辑建议四周每周4—6小时做结构与测试练习；正式比赛另有集中制作和出行投入。报名、差旅与训练材料费用原文未给出，不能标免费。",
    fit: ["愿意反复做模型、测重量并解释失效", "对力学和可量化设计取舍感兴趣"], avoid: ["只愿画外观但不愿计算或加载验证", "无法安排集中制作及学校组队通道"],
    trial: { action: "用同量安全练习材料制作两种小梁，比较相同载荷下的变形和连接损伤。", output: "两种结构草图、材料用量与载荷记录", check: "测试条件一致，失败也记录；不能把小梁结果直接当整车通过。", reflection: "你更喜欢推导结构、动手加工还是解释试验？" },
    remaining: ["赛题说明可能补充调整，正式训练须核对最终分区文件", "收费、差旅和本人学校推荐通道仍待确认；不计作零费用覆盖"],
    deepCase: authoredDeepCase({ seriesId: "national-structural-design", task: "2026官方具体题目：勒勒车模型结构设计与制作（上海分区采用版）。", title: "载货更多是否就更好：勒勒车的结构取舍", sourceIds: ["structure-shanghai-2026-task"], boundary: "已读取赛题第1—13页文字。这里只拆解学习路线，不复制图纸或替代最终补充规则。", steps: ["列出车架、车轮、轴承连接和载货布局，画清重力、牵引及障碍冲击的受力路径。", "比较轻量车架和较重加强车架，分别估计节点强度、重心高度及侧翻风险。", "制作节点与小尺度载荷试验，记录质量、变形和破坏模式，再选择整车方案。", "把运输成功率、时间、货物保持和结构质量一起比较，不为多载货牺牲完赛概率。"], questions: ["载质比提高时是否同时增加倾覆或掉货风险？", "计算中的连接假设与实际粘接是否相同？", "失败是装货策略、结构还是操作引起，如何区分？"], rubrics: [["理论方案5分", "编辑检查：受力模型、假设和图纸能相互对应"], ["制作质量10分", "编辑检查：节点与实物符合设计，接缝和装配可检验"], ["陈述答辩5分", "编辑检查：本人能说明一项设计取舍和失败原因"], ["运输80分", "编辑检查：同时记录效率、货物保持和质量，不只展示最好一轮"]], roles: [{ role: "分析设计者", steps: ["画受力和重心示意", "比较两种节点", "用实测修正刚接或铰接假设"], contributionProof: "本人计算版本和设计修改表" }, { role: "制作验证者", steps: ["记录材料与粘接过程", "设计统一加载步骤", "区分结构失败与操作失误"], contributionProof: "本人制作照片、质量记录与连续试验表" }], weeks: [["读题并画限制及受力清单", "能解释材料、连接和任务评分之间的关系"], ["做两种节点或车架小样", "每种都有材料质量和加载证据"], ["在可控条件下比较载货布局", "记录失败与重测，而不是只保留成功视频"], ["整理方案、图纸与个人答辩", "用相同指标说明为何选择当前结构"]], exits: ["没有学校推荐名额时只做历史题练习，不宣称可直接参加分区赛", "无法安全做加载试验时缩小模型和载荷，由指导者确认条件再继续"] })
  }
];
