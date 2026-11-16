import { authoredDeepCase, readSource, type ResearchedContent } from "./research-types";

const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/engineering-a-reading-log.json" });
const requirements = { ...source("biomod-2023-requirements", "https://biomod.net/requirements/", "BIOMOD Requirements：2023费用及团队、交付要求", "BIOMOD Foundation", "混合年代网页：费用明确标2023，团队/导师及FAQ在2023适用性待核；旧UCSF场地不沿用", "Registration fees、Team structure、Project Deliverables及学术诚信段落", null), evidenceArtifact: "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json", integrity: "requires_recheck" as const };

const observedRequirements = { ...requirements, id: "biomod-requirements-observed-text", title: "BIOMOD Requirements：网页实际条款记录（不认证2023适用性）", scope: "仅核对Team structure、Project Timeline、Project Deliverables及FAQ实际文字；不证明这些未标届次条款在2023有效", locator: "Team structure、Project Timeline、Project Deliverables；FAQ What is a faculty mentor；混合年代适用性另列未知", integrity: "consistent" as const };
const fees2023 = { ...requirements, id: "biomod-requirements-fees-2023", title: "BIOMOD Requirements：明确标2023的费用段落", scope: "仅Registration fees明确标2023的团队费30000JPY及个人Jamboree费TBD，不包括历史资格或个人总成本", locator: "Registration fees：May 31, 2023 / September 15, 2023；not including hotel lodging", integrity: "consistent" as const };

const rubric = source("biomod-2023-rubric", "https://biomod.net/jamboree/BIOMOD2023-QuickGuide.pdf", "BIOMOD2023 Quick Guide", "BIOMOD Foundation与日本分子机器人研究组", "2023 Jamboree评分及展示", "PDF第4、10—12页", "2023-10-24");
const project = { ...source("biomod-2023-sendai-project", "https://teamsendai2023.github.io/project.html", "Team Sendai 2023 NanoStoma：Project", "Team Sendai 2023", "作者公开作品的动机与目标，不代表功能已全部实现", "Problem、Challenges、Solution、Feasibility", "2023"), authority: "other" as const, evidenceArtifact: "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json" };
const design = { ...source("biomod-2023-sendai-design", "https://teamsendai2023.github.io/design.html", "Team Sendai 2023 NanoStoma：Design", "Team Sendai 2023", "作者公开的结构设计与模拟", "Overview、Main structure、Self-stacking、Slit", "2023"), authority: "other" as const, evidenceArtifact: "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json" };
const experiment = { ...source("biomod-2023-sendai-experiment", "https://teamsendai2023.github.io/experiment.html", "Team Sendai 2023 NanoStoma：Experiment", "Team Sendai 2023", "作者公开的组件实验、失败与修改，不等于完整气体阀已验证", "Summary及各实验Results and Discussion，尤其Locking mechanism", "2023"), authority: "other" as const, evidenceArtifact: "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json" };
const deep = authoredDeepCase({
  seriesId: "biomod", task: "拆解2023 NanoStoma公开作品：从DNA结构设计到组件验证，辨别最终应用与已有证据。", title: "用证据表解释一个生物分子设计项目究竟验证了什么", sourceIds: [requirements.id, rubric.id, project.id, design.id, experiment.id],
  boundary: "使用同届官方评分与作者公开完整作品页面；只做公开资料分析，不指导无实验条件学生自行开展实验。公开作品中的预测、作者推断与已展示实验分别记录，未核具体奖项。设计/实验页全部43个图像引用含图表、GIF和标志已补原件并解码；原站超时部分由同一作者公开仓库Git blob补齐并核Git SHA。PAGE正文写16%而表7标题写20%，不据此提供可复现实验配方；学习分析保留该不一致。",
  steps: ["把最终功能拆为结构形成、堆叠、开关组件与膜中结合，列出每项成功需要什么证据。", "对照设计和实验页面，区分计算预测、成像或条带观测、组件替代验证及尚未完成的集成。", "对照实验Fig 6/7：原设计第2链30nt时，四链组合未形成作者预期条带；改成34nt后，作者将四链高位条带与加第五链后的两条带解释为TMSD锁开关。图像和正文支持的是替代链置换组件，不是偶氮苯光响应或完整气体交换；不能从条带直接读出未公开的定量成功率。", "按同届评分写一页清晰、可追溯的项目说明，并标出原始数据和进一步验证的缺口。"],
  questions: ["作者测试的替代开关，是否等于最终光响应系统已运行？", "图像支持的是组件存在，还是气体交换功能？", "设计失败后的改动与结果能否在原文中逐项对应？"],
  rubrics: [["项目目标与可行性", "编辑检查：最终应用与本阶段可检验目标分开"], ["文档清晰性与透明度", "编辑检查：每个结果有图表定位，未提供原始数据处明确标缺"], ["项目执行", "编辑检查：逐项比较承诺目标与真实完成的组件"]],
  roles: [{ role: "证据分析", steps: ["拆成功条件", "对照模型与结果", "标记未验证环节"], contributionProof: "本人证据表、图表定位和推断边界" }, { role: "科学沟通", steps: ["定义目标读者", "绘制机制与证据图", "检查读者是否误解成果"], contributionProof: "本人讲解稿、引用和理解反馈改版" }],
  weeks: [["读项目背景并画组件关系", "能用自己的话说明研究问题"], ["核对各组件设计与结果", "预测、观测和推断有不同标记"], ["追踪一次失败与修改", "说明修改依据及仍未验证的部分"], ["完成证据说明和短讲解", "他人可沿引用检查且不会误以为整机已验证"]],
  exits: ["只想做资料分析可保留为学习作品，不称原项目作者或参赛成果", "正式项目没有导师、实验资源或费用方案时，暂不承诺报名"]
});

export const engineeringResearchA8: ResearchedContent[] = [{
  seriesId: "biomod", name: "BIOMOD国际生物分子设计竞赛", organizer: "BIOMOD Foundation", aliases: ["Biomolecular Design Competition"], authorAgentId: "/root/continue_catalog",
  editionId: "2023", edition: "2023历史档案", groupId: "undergraduate", group: "2023公开作品学习与准备（不确认正式参赛资格）", scopeId: "biomod-2023", scope: "2023 NanoStoma公开作品学习、当届Jamboree评分；混合年代Requirements不证明2023完整报名资格", origin: "verified_expansion", trackId: "biomolecular-design", trackName: "生物分子设计与证据沟通", taskFamily: "experimental-research", subjectDomains: ["science", "engineering"], factStatus: "historical", registrationStatus: "historical", registrationNote: "本条只推荐2023公开作品资料分析与准备，非正式参赛资格确认。2023团队与导师条款适用性仍须消歧；2026及以后报名、费用和规则须另核。",
  sources: [requirements, rubric, project, design, experiment, observedRequirements, fees2023],
  verified: {
    eligibility: { text: "Requirements网页正文记载：团队主要由认证高校攻读学士或当年毕业的本科生组成，本科生至多8名，至少一名faculty advisor；同页FAQ记载faculty mentor须为认证大学tenure-track professor（终身教职轨教授）。研究生和博士后记作导师。这些是网页实际文字记录。", source: 5 },
    track: { text: "团队自行确定一个生物分子设计项目，说明目标、设计、数据与结果；官方不要求复制NanoStoma，后者只是同届公开学习案例。", source: 5 },
    participation: { text: "团队注册后开展项目，按期限完成网站和视频，并在Jamboree展示；正式项目涉及导师、研究资源和报名安排。", source: 5 },
    deliverables: { text: "项目网站记录目标、数据和结果；视频至多3分钟，口头展示10分钟。2023会场每队总时段20分钟，含准备和约7分钟问答。", source: [5, 1] },
    rubric: { text: "2023评分为网站50、视频25、展示25；网站包含项目想法20、文档20、执行10。金级要求先满足银级且总分位于前50%，不能沿用通用网页不同版本的固定分数说法。", source: 1 },
    investment: { text: "Requirements页面明确2023团队注册费30000日元，个人Jamboree费仍标待定且不含住宿；这是历史费用，不推算当届费用或个人总额。", source: 6 }
  },
  eligibilityFacts: [{ idSuffix: "mentor-title", text: "Requirements的团队及导师条件在2023的适用性尚未消歧：该页有2023费用，也有旧UCSF场地FAQ，与2023 Quick Guide的东京会场不同。不能确认具体导师职衔或以任意教师推定资格满足。", sourceIds: [], kind: "unknown", status: "unknown", scope: "2023团队及导师资格适用性尚未证实；公开作品分析不确认正式参赛资格" }],
  eligibilityRules: [{ id: "biomod-mentor-title", field: "priorQualification", operator: "requires_confirmation", value: "2023导师职衔及FAQ版本适用性", factIds: ["biomod:v2:eligibility.mentor-title"], note: "未获原届资格条款消歧前保持unknown" },{ id: "biomod-undergraduate", field: "degree", operator: "eq", value: "undergraduate", factIds: ["biomod:v2:eligibility"], note: "本记录为本科生主导路径，研究生导师身份另核" }, { id: "biomod-max", field: "teamSize", operator: "max", value: 8, factIds: ["biomod:v2:eligibility"], note: "本科队员最多8名" }, { id: "biomod-mentor", field: "mentor", operator: "eq", value: true, factIds: ["biomod:v2:eligibility"], note: "至少faculty advisor；FAQ另限定tenure-track professor，2023适用性仍需确认" }, { id: "biomod-current", field: "priorQualification", operator: "requires_confirmation", value: "在读或当年毕业、认证高校与当届团队注册", factIds: ["biomod:v2:eligibility"], note: "不能以历史页面确认下一届资格" }],
  task: "把一个分子设计想法变成可检验的研究问题，并让他人看懂设计、数据和局限。",
  roles: [{ name: "建模与证据", task: "比较预测与观察，说明哪些机制得到支持", skills: ["research", "data-analysis", "biology"], evidence: "你如何区别预测结果和实验验证？", output: "本人模型说明、证据表或数据分析" }, { name: "科学表达", task: "组织网站、图示和短视频，使目标与局限清楚", skills: ["writing", "design", "presentation"], evidence: "你如何避免读者把局部结果理解成完整产品？", output: "本人图示、讲解和引用记录" }],
  gain: "可形成跨学科科研理解、证据分析和科学沟通作品；实际科研能力须由本人承担的任务证明，读过公开案例不等于已有实验经验。",
  entry: "新手可从公开图表与结论对应练起，无需先声称会实验；正式研究则需要导师、基础知识及合适的实验或计算条件。",
  completion: "完整项目须同时做好研究与公开说明；较高评价要求目标合理、证据透明、确有执行成果，单纯概念动画不足。",
  investment: "编辑建议四周每周3—5小时先做公开资料证据表；已有电脑与网络时该练习不额外购买材料。正式竞赛的实验、注册、展示与差旅另算，不能把练习零增量材料费等同免费参赛。",
  fit: ["喜欢生物、材料与设计交叉", "愿意诚实解释实验限制"], avoid: ["准备把别人的公开作品当自己成果", "只想短期获奖且不愿做验证"],
  trial: { action: "阅读NanoStoma的设计与实验摘要，将一个机制分成预测、观察和待验证三栏，并为每栏标原文位置。", output: "一页带引用的证据表", check: "不得把替代开关组件实验写成完整光控气体阀已成功。", reflection: "你更愿意分析证据、做模型，还是把科学讲清楚？" },
  remaining: ["下一届资格、完整费用和当地团队支持未核", "作者作品奖项未核，不作获奖等级背书"],
  deepCase: { ...deep, workedExample: { ...deep.workedExample, origin: "published_work" } }
}];
