import { authoredDeepCase, readSource, type ResearchedContent } from "./research-types";
const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/continuation-20261105/content/source-rechecks-batch02/reading-log.json" });
const entry = source("igem-2026-registration", "https://competition.igem.org/registration/overview", "iGEM2026 Registration Overview", "iGEM Foundation", "2026高校机构组织的Collegiate团队", "Competition Types、Primary PI、Institutions、Organizer Type、Payment Order", null);
const roster = source("igem-2026-roster", "https://competition.igem.org/registration/team-roster", "iGEM2026 Team Roster", "iGEM Foundation", "2026成员、年龄分区与确认名单", "Rules & Requirements、Team Roles、Team Sections", null);
const rubric = source("igem-2026-special-prizes", "https://competition.igem.org/judging/special-prizes", "iGEM2026 Special Awards", "iGEM Foundation", "2026 Best Model的公开评审问题，不是2025作品获奖证明", "Scoring Rubric、Best Model及其四项Ballot Questions", null);
const deliverables = source("igem-2026-deliverables", "https://competition.igem.org/deliverables", "iGEM2026 Deliverables", "iGEM Foundation", "2026公开交付与贡献归属要求", "What are Deliverables、New in 2026、How to Submit", null);
const fees = source("igem-2026-fees", "https://competition.igem.org/registration/fees", "iGEM2026 Fees & Deadlines", "iGEM Foundation", "2026团队费与线下个人门票的不同范围", "Registration Stages、What’s new in 2026；未读取图形中的具体金额", null);
const work = { ...source("igem-2025-hkust-model", "https://2025.igem.wiki/hkust/model", "HKUST2025公开Model作品：金属结合模型", "HKUST iGEM2025团队", "2025作者公开研究的建模模块；仅作2026准备案例，不沿用旧规则", "完整Model页面：MT Cycle0、1A、1B、2、Biosensor及Kill Switch；原HTML及全部模型图像单独冻结", "2025"), authority: "other" as const };
const historicalRubric = { ...source("igem-2025-judge-handbook", "https://static.igem.org/websites/competition/2025/judging/2025judgehandbook.pdf", "iGEM 2025 Judge Handbook", "iGEM Foundation", "2025公开Model作品适用评分，不外推2026", "PDF第67—68页Model：开发记录、假设、数据、设计作用及四项评审", "2025"), evidenceArtifact: "artifacts/continuation-20261105/content/source-rechecks-batch02/reading-log.json" };
const deep = authoredDeepCase({
  seriesId: "igem-collegiate", task: "评读HKUST2025公开建模模块，区分结构预测置信度、结合假设与独立验证。", title: "不把高置信度预测误写成实验成功", sourceIds: [entry.id, roster.id, rubric.id, deliverables.id, fees.id, work.id, historicalRubric.id],
  boundary: "2026公开资格资料只说明报名边界；2025作品按同届手册第67—68页评读。已取得完整Model页面和模型图像，案例以MT Cycle0的完整筛选过程为主，并核对Cycle1A、1B、2及生物传感器后续结果。不声称复现整队实验，不把作者预测、模型置信度或方法解释当作独立科学证明。",
  steps: ["沿MT Cycle0完整路径记录筛选目标、候选蛋白、EC20六次预测差异与图2比较表；原作以锌代镉、以预测置信度筛选，均不是实测镉结合能力。", "对照Cycle0图13—19与验证/局限段：MIB2对锌的预测与所引文献不一致，静态构象不足以支持动态结合结论；保留反例，不从图形漂亮推断有效。", "接续Cycle1A的GROMACS过程与距离/稳定性图：作者承认未达到稳定结合状态，模拟时长、离子比例和计算资源限制仍在；Cycle1B膜模型又有脂质组成、基准数据及融合结构不确定性，不能包装成验证成功。", "阅读Cycle2预测网络与生成模型的不同证据等级：作者报告交叉验证及独立测试，生成部分主要为架构；未取得完整训练数据和运行记录，不能替其复算性能或声明生成序列已获实验验证。", "核对Biosensor参数表中人为估计项、模型曲线与未获得可重复湿实验结果的结论；Kill Switch结构相似仅支持作者选型假设，不单独证明跨宿主功能。", "按2025模型奖四项标准整理模型方法、对系统理解的作用、开发数据和可复用文档；把作者原文、自己的评读与需要独立测量的下一步分栏。"],
  questions: ["结构预测置信度高，能否证明目标金属结合能力已测得？", "替代输入与真实应用条件不同，会影响哪项结论？", "新模型应解决哪个已观察问题，而不是仅换一个更复杂工具？"],
  rubrics: [["2025模型方法的质量", "编辑检查：说明Cycle0到后续方法更替的理由，不因方法复杂就加分"], ["2025模型是否帮助理解部件、装置或系统", "编辑检查：追踪筛选决定及后续失败怎样修正认识"], ["2025是否用部件、装置或系统测量来开发模型", "编辑检查：区分文献数据、估计参数、作者模拟输出和未完成测量"], ["2025方法是否为他人提供良好示例", "编辑检查：假设、失败、引用和复现限制透明记录"]],
  roles: [{ role: "模型证据分析", steps: ["拆解假设和输出", "核对独立证据", "定位失配来源"], contributionProof: "本人分析表、引用定位及反例说明" }, { role: "研究文档与沟通", steps: ["界定读者问题", "画预测和验证关系图", "修正过度结论"], contributionProof: "本人图示、文字改版和来源记录" }],
  weeks: [["阅读建模模块并确定学习问题", "能说出模型预测的量与用途"], ["逐项核对假设及证据类型", "不把预测置信度当实验测量"], ["分析一个失配并提出验证方案", "方案针对具体不确定性且不编造结果"], ["完成可追溯的模型评读", "读者知道成果边界和本人贡献"]],
  exits: ["没有实验资源时保留资料分析，不宣称独立验证生物功能", "正式组队和费用未落实时只列提前准备，不承诺可报名"]
});
export const engineeringResearchA10: ResearchedContent[] = [{
  seriesId: "igem-collegiate", name: "iGEM国际遗传工程机器大赛高校组", organizer: "iGEM Foundation", aliases: ["iGEM Collegiate"], authorAgentId: "/root/continue_catalog",
  editionId: "2026-collegiate", edition: "2026高校组；历史作品作准备案例", groupId: "higher-education", group: "高校机构组织的学生团队", scopeId: "igem-2026-higher-education", scope: "2026高校机构类型；不套用商业组织或高中组", origin: "legacy_135", trackId: "model-evidence", trackName: "生物系统建模与证据分析", taskFamily: "experimental-research", subjectDomains: ["science", "engineering", "interdisciplinary"], factStatus: "verified_current", registrationStatus: "unknown", registrationNote: "本档案用于理解2026任务与提前准备；未凭规则页确认当前仍接受新队报名，具体窗口及下一届须另核。",
  sources: [entry, roster, rubric, deliverables, fees, work, historicalRubric],
  verified: {
    eligibility: { text: "高校组由高等教育机构在读学生构成，团队须正式依托机构，由符合身份的Primary PI注册和管理名单。2026成员须在3月31日满13岁；全部学生不超过23岁属Undergraduate，有24岁及以上学生属Overgraduate，分区依据年龄而非中文学位名称。", source: [0, 1] },
    track: { text: "团队围绕合成生物学问题设计研究；建模可用于理解、预测和设计系统，是整队研究的一类贡献，不是脱离团队的个人建模赛。", source: 2 },
    participation: { text: "Primary PI完成团队注册、机构与名单审核和费用步骤，学生加入名单并提交同意表；正式评审还需完成相应阶段费用及交付要求。", source: [0, 1, 4] },
    deliverables: { text: "按年度交付要求记录项目、网站、贡献归属及展示评审材料；2026仍须在平台提交归属表，但不再要求将其iframe嵌入Wiki。建模内容须在指定model页面清楚说明。", source: [2, 3] },
    rubric: { text: "本例适用2025手册模型奖四方面：建模质量、帮助理解部件/装置/系统、用其测量开发模型、为他人提供示例。手册称优秀模型应有完善文档，使评审能理解模型提供的信息、假设及理由、构建或评估所用数据和模型结果对项目设计的影响。2026公开评分只供另届准备参考，不替代2025依据；不虚构权重或获奖概率。", source: [6, 2] },
    investment: { text: "2026团队须完成Stage I和Stage II费用；线下赴巴黎成员另需个人Jamboree票，远程成员不需该门票。收费改用欧元，具体金额及个人承担比例未核，不能说远程免费。", source: 4 }
  },
  eligibilityRules: [{ id: "igem-enrolled", field: "enrolled", operator: "eq", value: true, factIds: ["igem-collegiate:v2:eligibility"], note: "高校机构组织的在读学生路径" }, { id: "igem-education", field: "degree", operator: "in", value: ["vocational", "undergraduate", "master", "doctorate"], factIds: ["igem-collegiate:v2:eligibility"], note: "Collegiate高等教育学生；年龄分区另核" }, { id: "igem-pi", field: "mentor", operator: "eq", value: true, factIds: ["igem-collegiate:v2:eligibility"], note: "需符合身份并承担责任的Primary PI" }, { id: "igem-roster", field: "priorQualification", operator: "requires_confirmation", value: "3月31日年龄、PI身份、机构名单与当届报名", factIds: ["igem-collegiate:v2:eligibility"], note: "不以当前年龄代替截止日年龄，不按本科/研究生学位误判分区" }],
  task: "将模型、研究证据和团队决策联系起来，准确说明做过什么与还不能证明什么。",
  roles: [{ name: "建模与验证设计", task: "核对假设、参数来源与预测边界", skills: ["mathematics", "programming", "research"], evidence: "你本人检查过哪个假设，什么证据会改变模型结论？", output: "模型说明、敏感性分析或验证计划" }, { name: "研究表达与归属", task: "把结果、局限与个人贡献组织成可追溯页面", skills: ["writing", "design", "presentation"], evidence: "读者如何区分作者预测、实验测量和你的评读？", output: "证据关系图、来源与个人贡献说明" }],
  gain: "可形成跨学科研究、建模和科学沟通作品；奖项、学术发表及就业收益均取决于实际贡献和额外条件，不从参赛名称直接推断。",
  entry: "零经历者先做公开资料证据表；具备数学和编程基础后再参与模型实现。正式生物研究须由有条件的机构与PI负责。",
  completion: "完赛需要整队按期完成研究与交付；高水平建模应影响研究决定并得到相关数据支撑，不只是运行一个工具。",
  investment: "编辑建议四周每周3—5小时用已有电脑阅读公开模型模块，初步证据分析不购买软件、不调用付费AI或开展实验。正式注册、研究及差旅支出另核。",
  fit: ["喜欢追问模型是否真正被证据支持", "愿意跨专业合作并公开局限"], avoid: ["想把预测图直接包装成实验证明", "无法落实团队、PI和正式经费"],
  trial: { action: "阅读HKUST2025建模模块的限制部分，把一种预测、一项独立依据和一个待核假设画成关系图。", output: "带原文定位的预测与验证关系图", check: "引用作者案例，不冒充本人研究或已验证性能。", reflection: "你更愿意做模型推理、检查证据，还是解释研究边界？" },
  remaining: ["当届新队报名是否仍开放与具体费率未核", "历史作品奖项未用于背书，2025模型评分不用于确认2026资格", "作者网页中预测置信度、结合机制和部分曲线的解释不等于独立验证；本稿只作有边界的原作评读"],
  deepCase: { ...deep, workedExample: { ...deep.workedExample, origin: "published_work" } }
}];
