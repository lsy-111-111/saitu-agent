import type { CatalogSource, DecisionModule, TaskFamily, FactStatus } from "@/lib/competitions/v6/catalog-types";

export type PilotContent = {
  authorAgentId?: string;
  governanceFactField?: DecisionModule;
  roleEvidenceField?: "task" | "deliverables";
  seriesId: string; taskFamily: TaskFamily; trackId: string; trackName: string; edition: string; scope: string;
  /** Explicit source assessment, never inferred from digits in the edition title. */
  factStatus?: Extract<FactStatus, "historical" | "verified_current">;
  sources: CatalogSource[];
  verified: Partial<Record<DecisionModule, { text: string; source: number | number[]; sources?: number[] }>>;
  task: string; roles: { name: string; task: string; skills: string[]; evidence: string; output: string }[];
  gain: string; entry: string; completion: string; investment: string;
  fit: string[]; avoid: string[]; trial: { action: string; output: string; check: string; reflection: string };
  remaining: string[]; deep?: { title: string; steps: string[]; checks: string[]; weeks: [string, string, string, string]; exits: string[] };
};
function source(id: string, url: string, title: string, publisher: string, scope: string, locator: string, authority: CatalogSource["authority"] = "organizer"): CatalogSource {
  return { id, url, title, publisher, authority, scope, locator, checkedAt: "2026-11-05", publishedAt: null, accessStatus: "body_read", verificationMethod: "agent_web_read" };
}

export const pilotContents: PilotContent[] = [
  {
    seriesId: "china-college-computer-design", taskFamily: "software-algorithms", trackId: "software-development", trackName: "软件应用与开发", edition: "2026年第19届（历史届次）", scope: "2026第19届软件应用与开发本科组；不自动适用于2027",
    sources: [source("4c-rules-2026", "https://jsjds.blcu.edu.cn/gyds1/csyq.htm", "2026参赛要求", "中国大学生计算机设计大赛组委会", "2026第19届本科作品、全国国赛上推规则", "参赛要求，第1—9条；大类列表"), source("4c-submission-2026", "https://jsjds.blcu.edu.cn/info/1045/2013.htm", "4C2026作品提交要求索引", "中国大学生计算机设计大赛组委会", "2026第19届11大类与国赛答辩形式；网盘内文件未读", "正文大类与六场国赛答辩说明；模板下载入口")],
    verified: {
      eligibility: { text: "2026规则面向在籍本科生；每件作品为同校2—9名本科生共同完成，国赛现场答辩至少2名作者。", source: 0 },
      track: { text: "2026设软件应用与开发大类；同件作品不能跨11个大类重复提交。", source: 0 },
      participation: { text: "通过校、省选拔后由省级赛事上推国赛；具体本校/赛区通道单独核实。", source: 0 },
      deliverables: { text: "提交原创的软件类参赛作品并参加国赛线下答辩；2026详细文件清单在模板包中，本次尚未读到，需补核。", source: 1 }
    },
    task: "选择一个真实用户问题，做出别人可以实际操作的软件，并解释需求、实现和验证。",
    roles: [{ name: "功能实现与测试", task: "实现一个可演示流程，设计异常输入并修复问题", skills: ["programming", "product"], evidence: "你做过什么能运行的功能？哪一个问题由你独立定位并修复？", output: "本人功能代码、测试记录、修复前后对比" }, { name: "需求与交互", task: "访谈使用者并把需求转为操作流程和验收条件", skills: ["product", "writing", "design"], evidence: "你是否根据别人的实际使用反馈修改过页面或功能？", output: "用户问题、流程图、修改理由和验收清单" }],
    gain: "若实际完成且允许公开，可用演示、代码和测试记录证明需求分析及软件交付能力；获奖与招聘认可另有条件。",
    entry: "会实现一个小功能或画出清晰操作流程可先试做；仅喜欢AI或手机产品还不能证明开发能力。", completion: "难点在稳定运行、资料完整和多人整合；需要代码、需求、测试各项有人承担。", investment: "编辑建议先用4周验证一个功能，每周4—8小时；完整作品周期、服务器与差旅成本另估，不等于官方要求。",
    fit: ["愿意从实际使用反馈反复改作品", "希望积累能说明本人贡献的软件案例"], avoid: ["只想短时间刷题拿证", "不愿调试、测试或维护作品"],
    trial: { action: "访谈一名同学，选择一个小需求，做可点击原型或一个可运行功能，再请他试用。", output: "一张流程图、一个演示和三条使用反馈", check: "另一人能独立完成核心操作，你能指出一次根据反馈的修改。", reflection: "你更享受理解需求、写代码，还是测试与表达？" },
    remaining: ["2026模板包内的软件提交清单和评分细则尚未全文核验", "2027新规、赛区费用和本校推荐通道未知"],
    deep: { title: "编辑示范：把社团物品借用流程做成可验证的小应用", steps: ["访谈一名管理员，记录现有借还步骤与一个真实错误", "画出借出、归还、异常三条路径，明确哪个环节由本人负责", "只实现登记和归还，测试重复借出、空输入、异常归还", "用真实试用反馈修订，不把团队所有功能写成本人成果"], checks: ["测试能否证明需求被解决？", "公开时是否隐藏了学生个人信息？", "本人贡献能否追到代码或测试记录？"], weeks: ["第1周：确认一个真实问题并完成流程与验收清单", "第2周：完成最小功能和可重复演示", "第3周：请使用者试用并保留失败与修复记录", "第4周：整理需求、实现、测试证据及个人贡献说明"], exits: ["无法联系使用者时先缩小问题，不假造访谈", "4周仍不能独立演示核心功能时先补基础，不急于报名"] }
  },
  {
    seriesId: "lanqiao-cup", taskFamily: "software-algorithms", trackId: "software", trackName: "个人软件赛（具体科目需选定）", edition: "2026—2027个人赛页面", scope: "官网个人软件赛报名科目；大学组别按学校及科目区分",
    sources: [source("lanqiao-individual-2026", "https://dasai.lanqiao.cn/pages/v7/dasai/competition/individual_competition.html", "个人赛报名说明", "蓝桥杯大赛组委会", "页面列个人赛软件/电子科目及其适用组别", "软件赛科目、参赛对象、报名流程、报名及参赛费用")],
    verified: { eligibility: { text: "页面列全日制在校研究生、本科及高职高专学生；按学籍和学校类别选相应组别，不能把某科目的组别推广至全部。", source: 0 }, track: { text: "软件赛列C/C++、Java、Python、Web应用、软件测试和网络安全等个人科目。", source: 0 }, participation: { text: "个人实名认证后经院校报名并配置指导教师，缴费、下载准考证后参加考试。", source: 0 }, investment: { text: "页面列每科报名费300元/人，住宿、餐饮及交通另计；不等于总支出300元。", source: 0 } },
    task: "选定程序设计等一个个人科目，在规定环境中独立完成任务，通过练习检验解题与查错能力。",
    roles: [{ name: "个人程序设计", task: "把题意转成算法，构造边界输入并实现正确程序", skills: ["programming"], evidence: "能否讲清一道独立完成的题以及一次错误是怎样被测试发现的？", output: "题解、代码、反例和复杂度解释" }],
    gain: "通过持续训练可留下独立解题与错误修订记录；考试成绩不是完整软件开发项目，也不保证就业结果。",
    entry: "应先能独立读写基础程序和调试；看懂答案不等于能在限时下解决问题。", completion: "需要按所选科目适应环境、时间和题型；跨科目已有基础未必能直接迁移。", investment: "先安排三次各60分钟练习，记录独立完成程度；报名费以外还要检查出行与备赛时间。",
    fit: ["愿意独立做题并复盘错误", "偏好明确反馈的个人任务"], avoid: ["更想做用户访谈与长期产品作品", "预算只够报名费却无法承担其他必要支出"],
    trial: { action: "选择一门熟悉语言，独立做三道基础题；每题先写思路，再写代码和边界样例。", output: "三份题解和一次错题复盘", check: "不看答案可解释思路，并用反例验证至少一个边界条件。", reflection: "限时推理与查错是否有趣？还是更喜欢把功能做成产品？" },
    remaining: ["具体科目的当届赛纲、实际提交规则和评测标准尚未读到原文", "页面报名窗口经联网查看，但未经人工审核不显示当前可报"]
  },
  {
    seriesId: "national-college-math-modeling", taskFamily: "data-modeling", trackId: "undergraduate-group", trackName: "本科组", edition: "2026规则及现行章程（历史训练参考）", scope: "全国大学生数学建模竞赛本科组；赛区和学校报名安排另核",
    sources: [source("cumcm-charter", "https://www.mcm.edu.cn/html_cn/node/9183046a45d10cedcd4bce2688fc98b3.html", "章程（2023年修订稿）", "全国大学生数学建模竞赛组委会", "官网公布的全国章程，须结合2026补充规则", "第二条竞赛内容；第三条形式；第四条组织；第五条评奖"), source("cumcm-format-2026", "https://www.mcm.edu.cn/html_cn/node/4cd596519c9eb9fbd866398f6df0caa3.html", "论文格式规范（2026年修订稿）", "全国大学生数学建模竞赛组委会", "2026论文及支撑材料格式", "第三至十一条：论文、代码、数据与支撑材料")],
    verified: { eligibility: { text: "章程面向大学生，同校不超过3人一队、专业不限；研究生不得参加，高职高专学生可选择本科组。", source: 0 }, track: { text: "竞赛区分本科与高职高专组；本记录讨论本科组，不能照搬到研究生数学建模赛事。", source: 0 }, participation: { text: "全国统一题目，通过学校及赛区组织参赛；竞赛期间队伍独立完成，指导教师不得参与讨论。", source: 0 }, deliverables: { text: "2026要求参赛论文和支撑材料，包含必要的可运行程序、数据及较大中间结果，并保持论文与支撑内容一致。", source: 1 }, rubric: { text: "章程列假设合理、建模创造性、结果正确和表达清晰作为主要评奖依据；没有据此给出个人获奖率。", source: 0 } },
    task: "把一个现实问题简化为可解释的假设和模型，用数据计算、检验结果，再写成可复算的论文。",
    roles: [{ name: "数据与验证", task: "整理数据、建立简单基线并检查结果对假设的敏感性", skills: ["data-analysis", "programming"], evidence: "你能举例说明一张图怎样支持结论，以及数据有什么偏差吗？", output: "清洗脚本、基线结果、误差与敏感性分析" }, { name: "建模与写作", task: "组织变量、假设与论证，使读者能复算主要结论", skills: ["research", "writing"], evidence: "你是否在课程报告里解释过为什么选这个模型而不是另一个？", output: "假设表、推导过程、图表说明及论文贡献" }],
    gain: "完成并能复算的模型与报告可展示分析、验证和写作能力；证据质量比只展示奖状更能说明个人工作。", entry: "高等数学基础有帮助；先检验能否读数据、解释简单图表和假设，不要求一开始掌握复杂模型。", completion: "集中时间协作、方法取舍和论文整合是主要难点；复杂模型无法复算会降低作品可信度。", investment: "编辑建议4周各安排4—8小时完成一道历史题的缩小版本；正式连续赛期和校内费用另查。",
    fit: ["喜欢用数据解释现实问题", "愿意检查假设而非只追求复杂算法"], avoid: ["不愿写明假设或验证结果", "无法安排正式比赛要求的连续时间"],
    trial: { action: "用一份公开小数据回答一个具体问题，建立最简单的模型，再修改一条假设比较结果。", output: "一页问题、假设、图表与局限说明", check: "同学按说明能复现一张图，你能说明改变假设为何改变结论。", reflection: "你更喜欢数据清洗、模型推理还是论证写作？" }, remaining: ["当前/下一届报名窗口及个人所在赛区要求需重新核对", "人工智能工具使用规定须另读当届条款"]
  },
  {
    seriesId: "national-college-electronic-design", taskFamily: "engineering-prototype", trackId: "main", trackName: "全国主赛（2025历史参考）", edition: "2025全国主赛（历史届次）", scope: "2025全国大学生电子设计竞赛主赛；本科组与高职高专组按题目区分，不含2026地方赛或专题赛",
    sources: [source("electronics-national-2025", "https://hnedc.hnie.edu.cn/__local/0/0D/80/FD1C067B95F5F7BF3968A58D3D5_331E6B71_D7CEE.pdf", "关于组织2025年全国大学生电子设计竞赛的通知", "全国大学生电子设计竞赛组委会（湖南赛区托管原文件）", "电组字〔2025〕01号全国主赛原通知；历史参考，不证明2027报名资格", "PDF第2页题目与实物要求，第3页组织，第5页资格与交付，第6页费用", "official_host")],
    verified: {
      eligibility: { text: "原通知面向全日制在校本科或高职高专学生，同队3人须全程参赛与评审；队中含本科生只能选本科组题目。", source: 0 },
      track: { text: "2025全国主赛分别设置本科组与高职高专组题目；任务同时包括理论设计和实际电子制作，不等于地方赛或专题赛。", source: 0 },
      participation: { text: "由学校统一向赛区报名，赛区组织并推荐全国评审；竞赛期间不得与队外人员讨论，教师须回避。", source: 0 },
      deliverables: { text: "提交设计报告与制作实物，由赛区收取封存后测评；除题目特许，实物不能包含个人电脑或手机，所需芯片须预先下载程序并脱机封箱。", source: 0 },
      investment: { text: "场地、仪器与材料原则上由学校提供；赛区可收报名费并由学校支付，金额因赛区而异。个人其他支出仍需另核。", source: 0 }
    },
    task: "按电子系统问题设计电路，搭建设备并测量性能，解释为何达标或失败。",
    roles: [{ name: "测量与排障", task: "记录接线、供电、输入输出，逐段定位误差来源", skills: ["hardware", "laboratory"], evidence: "你用过什么仪器，如何排除一个实际电路故障？", output: "接线图、测量表和故障定位过程" }], gain: "如完成，可用装置演示和测量记录证明动手与工程验证能力；获奖不替代对个人贡献的说明。", entry: "需要基础电路知识与安全操作条件；未接触仪器可先做低风险仿真和读图练习。", completion: "器件、仪器、三人协作与连续排障是门槛；仅有编程兴趣不保证能完成硬件作品。", investment: "先核对实验室、指导和仪器能否获得，再估器材费用；未取得安全指导前不自行做危险电路。",
    fit: ["愿意测量、接线并查故障", "可以获得基础仪器和指导"], avoid: ["只能远程且无法获得硬件条件", "不愿反复测量记录"],
    trial: { action: "用仿真工具构建一个基础传感信号链，改变一个参数，记录输入输出变化。", output: "电路图、三组输入输出及误差解释", check: "能指出一个参数如何影响输出，并解释预期与结果的差异。", reflection: "你是否喜欢先猜测故障再通过测量排除？" }, remaining: ["全国官网旧通知访问失败后，已取得赛区托管的2025全国原通知；当前届次规则仍待核验", "每题具体指标、器件清单和本校资源需另读；只作历史任务参考，不表示当前可报"]
  },
  {
    seriesId: "culsc-life-sciences", taskFamily: "experimental-research", trackId: "scientific-inquiry", trackName: "科学探究类", edition: "第12届（2026—2027）", scope: "第12届科学探究类；根据西安交通大学转发通知，校内资格确认另核",
    sources: [source("life-inquiry-2027", "https://pec.xjtu.edu.cn/info/1117/5536.htm", "第12届生命科学竞赛科学探究类通知", "西安交通大学实践教学中心", "第12届科学探究类通知；具体校内组织仅限发布高校", "参赛对象与要求、竞赛内容与形式、时间安排", "university_local")],
    verified: { eligibility: { text: "通知列全日制在校本科生，资格由学校确认；每队学生不超过5名、指导老师1—2名，另有参赛次数限制。", source: 0 }, track: { text: "科学探究类下有科学研究、野外实习及英文类；不能与创新创业类成果组别混用。", source: 0 }, participation: { text: "依通知网络报名、分阶段提交材料、指导教师确认，之后网络评审、省赛及国赛；校内手续另核。", source: 0 }, deliverables: { text: "分阶段提交研究综述与实验设计，再提交实验记录、论文及参赛承诺材料；项目需要原创研究过程。", source: 0 } },
    task: "围绕生命科学问题提出假设，设计对照或实地调查，持续记录过程，再解释结果与局限。",
    roles: [{ name: "实验设计与记录", task: "定义变量和对照，保存可追溯的原始数据与异常记录", skills: ["laboratory", "research"], evidence: "你能说明一次实验的对照为什么必要，以及原始数据怎样保存吗？", output: "实验方案、日志、原始数据和结果图表" }, { name: "文献与数据", task: "比较已有研究并整理数据，不把协助整理说成独立完成实验", skills: ["research", "data-analysis", "writing"], evidence: "你是否能找出两篇研究的相同问题与方法差异？", output: "文献对照表、数据清洗及个人分析说明" }], gain: "持续完成研究可形成问题、方法、原始记录和失败修订的研究证据；不能仅凭报名保证论文发表。", entry: "对生命科学感兴趣可先做文献比较，但正式实验需要方法、场地、材料和指导。", completion: "长周期记录、样本与对照设计容易成为瓶颈；不能把未开展的实验写成已完成成果。", investment: "按研究问题与材料周期估算；先核对导师、场地与合规条件，四周只能作为可行性体验，不能保证完成研究。",
    fit: ["愿意耐心记录过程并接受不支持假设的结果", "有可落实的实验或调查指导与资源"], avoid: ["希望一周获得完整科研成果", "无资源仍要求立即开展湿实验"],
    trial: { action: "围绕一个安全可观察的问题阅读两篇资料，写出假设、变量、对照与需要的资源，不急于实际实验。", output: "一页研究问题和资源核对表", check: "能解释怎样的观察会推翻自己的假设，并列出尚未具备的条件。", reflection: "你更喜欢观察提问、实验操作还是解释数据？" }, remaining: ["仍需对照组委会原始规程及本人学校组织路径", "具体课题伦理、场地与成本须分别确认"]
  },
  {
    seriesId: "market-research-analysis", authorAgentId: "/root/continue_catalog", taskFamily: "investigation", trackId: "undergraduate-practice", trackName: "本科组实践赛", edition: "第17届（2026—2027）", scope: "依据常州工学院第17届通知；校内日期、费用仅限该校",
    sources: [source("market-czu-2027", "https://www.czu.cn/2026/1008/c6a178011/page.htm", "第17届市调大赛通知", "常州工学院创新创业学院", "第17届本科组规则转述及常州工学院校内选拔；非其他学校报名依据", "二参赛对象；四竞赛形式；五竞赛安排；七校赛组织", "university_local")],
    verified: { eligibility: { text: "该通知本科实践队伍由同校3—5名全日制本科生组成；全日制本科生须先通过知识赛，不能仅凭年级判定已具备实践赛资格。", source: 0 }, track: { text: "本科组包含个人知识赛和团队实践赛；本记录讨论调查项目实践阶段。", source: 0 }, participation: { text: "经学校组织报名和知识赛后组队实践，涉及校赛、企业命题赛、省赛与国赛；不同组别路径不同。", source: 0 }, deliverables: { text: "实践赛要求团队完成调研项目、提交报告并答辩；国赛初赛包含报告与PPT评审，细则需结合后续实践赛通知。", source: 0 } },
    task: "把市场或社会问题转成可调查的问题，获取合适样本，分析证据并提出有边界的结论。",
    roles: [{ name: "调查设计", task: "设计受访者条件与问题，先试访再修改歧义项", skills: ["fieldwork", "research", "writing"], evidence: "你是否发现过某个问题让不同人产生不同理解，并据此改过问卷？", output: "抽样说明、问卷迭代和访谈记录" }, { name: "数据分析与表达", task: "检查无效回答、比较数据并说明结论能推广到谁", skills: ["data-analysis", "presentation"], evidence: "你做过的数据结论依赖什么样本？哪些人没有被调查到？", output: "清洗规则、图表、局限和答辩说明" }], gain: "可积累调研设计、数据分析及报告表达作品；好看的图表不能代替可靠样本，报告是否公开还要看授权。", entry: "访谈、写作、统计基础都可以成为起点；没有经历时先用小样本体验检验兴趣。", completion: "最难常是找到合适样本和避免偏差，再把证据与结论连接起来；并非只写一份文案。", investment: "先用一周做5人试访，再评估样本招募和调研成本；不要把试访当作足够支持总体结论的正式研究。",
    fit: ["愿意和不同的人交流并核对证据", "想练习研究与表达的配合"], avoid: ["不愿联系受访者或解释抽样局限", "准备编造问卷答案凑样本"],
    trial: { action: "选择一个校园问题，设计5个中性问题，邀请5人试答，记录误解并修改。", output: "两版问题、五份匿名试访记录与修改理由", check: "能指出至少一处歧义和一类未覆盖人群，不能以5人试访代表全校。", reflection: "你更喜欢提出问题、接触受访者还是分析数据？" }, remaining: ["组委会原始实践赛细则尚待补读", "当前学校是否仍可报名与知识赛通过情况需用户核实"],
    deep: { title: "编辑示范：校园二手物品交易为何难成交", steps: ["限定为近一个月尝试交易的同学，不把所有学生混作同一人群", "区分价格、信任、沟通成本等假设，用中性问题试访", "保存匿名原始记录，说明方便抽样的局限", "先提出可验证的小改进，再讨论结论是否有足够证据"], checks: ["受访者是否真的符合研究问题？", "问卷是否暗示答案？", "本人负责哪个环节，证据在哪里？"], weeks: ["第1周：确定问题、目标人群和5人试访", "第2周：修改工具并记录招募渠道与样本局限", "第3周：清洗数据、做描述分析并查反例", "第4周：写报告、制作图表并用证据回答质疑"], exits: ["无法取得合适受访者时调整问题，不编造答案", "样本无法支持总体结论时缩小结论范围"] }
  },
  {
    seriesId: "ecommerce-innovation-creativity-entrepreneurship", taskFamily: "business-practice", trackId: "regular", trackName: "常规赛（安徽工业大学通知范围）", edition: "第17届（2026—2027）", scope: "安徽工业大学第17届校内选拔通知；跨校报名和校内名额须本人学校确认",
    sources: [source("ecommerce-ahut-2027", "https://ggxy.ahut.edu.cn/info/1083/11364.htm", "第17届三创赛校内选拔通知", "安徽工业大学管理科学与工程学院", "安徽工业大学校内选拔及通知转述的常规/实战规则", "二参赛要求、三赛事分类、四赛项规程、五竞赛形式", "university_local")],
    verified: { eligibility: { text: "该校通知面向本校全日制本科和研究生，3—5人组队并允许跨校跨专业；不能直接替其他学校确认通道。", source: 0 }, track: { text: "通知区分常规赛、实战赛、国际赛；常规赛侧重创新创意策划，实战赛要求实际运营证据。", source: 0 }, participation: { text: "按校、省、全国三级选拔；常规赛项目需在官网选赛道报名并参加本校选拔。", source: 0 }, deliverables: { text: "提交项目报告书、演讲PPT和支撑材料；实战赛另需运营佐证和对应知情/授权材料。", source: 0 }, rubric: { text: "该通知说明考察创新、创意、创业能力、团队协作及答辩表现；本记录没有编造各项分数权重。", source: 0 } },
    task: "围绕电子商务需求设计可解释的业务方案，说明用户、履约、成本与验证依据。",
    roles: [{ name: "用户与经营验证", task: "访问目标用户，核算一次交易的收入、履约成本与风险", skills: ["product", "fieldwork", "accounting-finance"], evidence: "你实际卖过或组织过什么？能否说明一次成本或需求判断出错？", output: "访谈摘要、成本表、验证记录与项目方案" }], gain: "可形成用户研究、业务模型和路演案例；只有真实运营与个人工作能作为经营经验，想法不能写成创业成绩。", entry: "先能说明一个具体用户与问题；不必先成立公司，但应区分策划和实战赛。", completion: "可靠的需求证据、团队分工、财务假设与答辩比堆叠商业术语更重要。", investment: "先用访谈与桌面成本测算，不强迫先投入商品采购；真实运营的资金、授权和履约责任另评估。",
    fit: ["对用户、经营和项目表达有兴趣", "愿意用实际证据修正商业假设"], avoid: ["只想制作漂亮PPT而不验证需求", "预算不足却选择必须实际运营的路径"], trial: { action: "选择一个具体商品或服务，访问3位潜在使用者，计算一次交付的收入与完整成本。", output: "需求假设表和一页收支测算", check: "能指出一个用户不愿购买的原因，并写出最脆弱的成本假设。", reflection: "你更享受访谈、运营、算账还是表达？" }, remaining: ["组委会完整规则与本人学校的报名通道仍需复核", "各实战赛企业命题可能附加条件，不能沿用常规赛结论"]
  },
  {
    seriesId: "national-advertising-art", authorAgentId: "/root/continue_catalog", taskFamily: "visual-interaction", trackId: "graphic", trackName: "平面类", edition: "2026第18届（历史届次）", scope: "第18届平面类官方指南，2026-04-01修订版；不含视频/UI等其他小类",
    sources: [source("advertising-guide-2026", "https://www.sun-ada.net/home/about_intrs2.html", "第18届大广赛参赛指南", "全国大学生广告艺术大赛组委会", "第18届平面类及通用参赛流程；其他小类规则不能混用", "参赛办法一至五；A平面类作品规格与提交要求")],
    verified: { eligibility: { text: "平面类每件作品作者最多2人、指导教师最多1人，不允许跨校组队；指南面向高校全日制大学生和研究生及列明的港澳台、留学生；作品须原创并遵循统一命题。", source: 0 }, track: { text: "平面类含平面广告、产品包装、IP与创意周边；与视频、互动和文案等类别分开。", source: 0 }, participation: { text: "从官方命题下载素材、创作、线上提交及生成报名承诺材料，再按学校与赛区要求报送。", source: 0 }, deliverables: { text: "2026平面类可单幅或最多3张系列画面；线上提交JPG，单文件不大于5MB，需符合指南的尺寸、分辨率与色彩要求。", source: 0 } },
    task: "理解品牌命题和目标受众，把一个传播观点做成有说服力的平面广告，并解释创意取舍。",
    roles: [{ name: "视觉设计", task: "围绕受众和传播目标完成构图、层级、字体与图像设计", skills: ["design", "product"], evidence: "你做过哪两版作品，为什么改，目标受众看懂了吗？", output: "草图、设计稿、修改过程与素材授权记录" }, { name: "策略与文案", task: "把产品事实转为面向具体人群的主张并与视觉统一", skills: ["writing", "research"], evidence: "你是否根据不同受众修改过同一条信息的表达？", output: "受众洞察、文案版本、创意解释及验证记录" }], gain: "完成且获得所需授权后，可形成命题理解、设计过程和视觉作品证据；不等于品牌方采用或实习录用。", entry: "能分析一张广告的信息层级即可先试做；熟悉设计软件不等于已具备命题创意能力。", completion: "难点是回应真实命题、创意表达与制作规范一致；还要检查素材授权和匿名提交要求。", investment: "编辑建议一周做3张草图，再用4周完善一个方向；软件、素材、打印和赛区费用按实际核对。",
    fit: ["愿意根据受众反馈反复改设计", "希望积累有过程证据的视觉作品"], avoid: ["只想模仿名作而不回应命题", "无法说明素材来源与本人创作过程"], trial: { action: "阅读一份历史命题，写出受众与一句传播主张，画3张构图草图，请2人说出看到的重点。", output: "3张草图、受众说明和反馈修改记录", check: "两位观看者能说出你希望传达的核心信息，且你能解释选择哪版。", reflection: "你更喜欢洞察文案还是视觉制作与反复打磨？" }, remaining: ["2027命题、报名窗口及各赛区收费未知", "平面类作者/导师人数及作品权利条款需逐项复核"],
    deep: { title: "编辑示范：为一项校园服务设计一张清晰海报", steps: ["区分宣传对象和观看场景，确定只传达一个主要信息", "列出产品事实与编辑想法，不虚构效果承诺", "画3张低保真草图，先验证信息层级再做精修", "记录素材来源、个人负责环节与反馈导致的修改"], checks: ["观众能否在短时间内找到主要信息？", "设计是否回应命题而非只有好看？", "素材与字体是否有允许用途？"], weeks: ["第1周：读命题、分析受众并完成3版草图", "第2周：完成视觉初稿和素材来源表", "第3周：做小范围理解测试并记录修改", "第4周：核对格式、授权、个人贡献与创意说明"], exits: ["无法取得素材授权时替换或重新创作", "受众始终误解核心信息时回到主张与构图，不只换颜色"] }
  },
  {
    seriesId: "chinese-classics", taskFamily: "language-communication", trackId: "reading-student", trackName: "诵读中国·大学生组", edition: "2026第8届（历史届次）", scope: "第8届诵读中国大学生组；不混用教师、讲解、书写和篆刻组别",
    sources: [source("classics-official-attachment-2026", "https://www.cup.edu.cn/docs/2026-05/e6e258c803314bdfbd3f183fe944c111.pdf", "教育部国家语委第8届通知及方案", "教育部、国家语委（中国石油大学托管原附件）", "教语用函〔2026〕1号及附件1诵读中国方案", "原附件第7—11页；正文其他事项收费与AI使用说明", "official_host")],
    verified: { eligibility: { text: "诵读方案大学生组含研究生，可个人或团队参赛；团队最多20人，不能跨设定组别混报，摄像伴奏不作为参赛者。", source: 0 }, track: { text: "本记录仅为诵读中国大学生组，其他讲解、书写、篆刻与教师组另有要求。", source: 0 }, participation: { text: "官网注册并完成知识测评，按赛区初赛推荐复赛，再按后续赛段安排参评；2026初复赛窗口已属历史。", source: 0 }, deliverables: { text: "2026方案要求新录制的3—6分钟横屏MP4诵读视频，同期录音且不得后期配音修音；须遵守文本来源与匿名展示规则。", source: 0 }, investment: { text: "正式通知规定不得以大赛名义收取参赛费用；录制器材、制作与出行仍是个人可能产生的成本。", source: 0 } },
    task: "理解经典文本，用普通话、节奏和声音表达含义，录制符合赛项要求的诵读作品。",
    roles: [{ name: "诵读与文本理解", task: "考证文本意思，设计停连重音，并通过录音检查表达效果", skills: ["language", "presentation", "research"], evidence: "你如何决定一句话的停顿和重音？能说明文本依据吗？", output: "文本批注、录音版本与表达修改说明" }], gain: "可形成文本理解与语言表现作品；摄像等辅助工作的收获不等于有参赛作者资格，须区分团队角色。", entry: "喜欢文学或表达可先用一分钟录音试做；关键是理解文本，而非堆背景音乐。", completion: "选文、同期录音、稳定表达和文件规范需要多次练习；不能以剪辑或AI配音替代要求的真实诵读。", investment: "先用手机做一分钟练习，无需购买器材；正式制作条件、时间与出行另核。",
    fit: ["愿意理解文本并通过声音表达", "喜欢听反馈后打磨停连与节奏"], avoid: ["只想依靠视频特效或AI配音", "不愿核对文本与素材出处"], trial: { action: "选择一段已确认出处的经典文本，标注两种停连，分别录一分钟并请同学复述含义。", output: "文本批注、两段录音和听众反馈", check: "能用文本依据解释选择哪种表达，而不是只说声音好听。", reflection: "你享受阅读理解、声音表达还是幕后制作？" }, remaining: ["下一届方案尚未核验", "本人赛区推荐通道和晋级条件需另查"]
  },
  {
    seriesId: "physics-experiment-innovation", taskFamily: "teaching-service", trackId: "physics-teaching", trackName: "大学生物理实验讲课比赛", edition: "2026第12届（历史届次）", scope: "2026第12届普通讲课通道；依据承办单位托管组委会原通知及附件3.1，不包含校企合作通道",
    sources: [source("physics-teaching-2026", "https://physics.hit.edu.cn/_upload/article/files/2a/4b/3bb6b5634e5e96ee685875bf0541/c046329a-3efa-4ea2-9fab-5c265fc16d24.pdf", "第12届第一轮通知及完整竞赛附件", "全国大学生物理实验竞赛组委会（承办单位哈尔滨工业大学托管）", "2026全国普通讲课通道；资格见正文第2页，讲课细则及评分见第18—19页；不包含附件3.2校企通道", "PDF第2页资格与费用、第18—19页附件3.1，原通知签署2026年2月1日", "official_host")],
    verified: { eligibility: { text: "通知列2026秋季在籍本专科学生，每人只能一队；讲课类最多3名学生、导师最多2名，并有往届获奖限制。", source: 0 }, track: { text: "讲课类按公布形式要求自选物理实验讲授内容；与命题、自选创新实验作品分开。", source: 0 }, participation: { text: "由学校组织、审核与推荐；普通讲课通道学校推荐名额受限，初赛交视频、决赛通常现场讲授，主讲及实验内容须保持一致。", source: 0 }, deliverables: { text: "附件3.1要求选本校大学物理实验课程内容，提交16—20分钟同步课堂实录，720P且不超过200M；学生出镜、导师不出镜，画面与PPT匿名，经学院审核。", source: 0 }, rubric: { text: "普通讲课评分分为教学理念10、内容30、过程30、效果10、仪态10、展示10分；内容要求物理正确、安全规范，并解释有效数字和不确定度等实验依据。", source: 0 }, investment: { text: "第一轮通知按队收取1000元，涵盖网络初评及远程答辩，不含现场会务；设备等由高校安排，个人自费额仍需学校确认。", source: 0 } },
    task: "围绕物理实验设计一段清晰讲授，解释现象、操作与测量依据，让学习者能理解而非只看演示。",
    roles: [{ name: "实验讲授设计", task: "识别学习难点，把实验原理、操作与误差组织成可理解讲解", skills: ["laboratory", "presentation", "writing"], evidence: "你能讲清一个物理实验为什么这样测，并发现学习者哪里没理解吗？", output: "讲义、演示脚本、理解问题和讲解修改记录" }], gain: "完成可形成物理理解、实验解释和教学设计证据；普通辅导经历不能自动证明实验技能或教师职业资格。", entry: "需要相应物理实验基础；喜欢教学但没有实验经历，可先做概念讲解体验。", completion: "既要准确解释物理与测量依据，也要设计能发现理解困难的互动；须满足视频匿名、长度、画质要求，决赛主讲还需回答问题。", investment: "先借助教材和低风险演示验证讲解；正式作品器材、实验室与通知列费用需学校确认。",
    fit: ["既喜欢物理实验又愿意解释给别人听", "有基础实验记录并能获得指导"], avoid: ["没有物理基础却希望只靠表达参赛", "没有实验条件且无法取得指导"], trial: { action: "选择一个已学物理实验，写3分钟讲解，并设计一个能发现误解的问题让同学回答。", output: "讲稿、原理图和一次理解反馈", check: "听者能说明实验测量什么，你能纠正一个具体误解并修改讲稿。", reflection: "你喜欢解释原理、演示操作还是设计学习问题？" }, remaining: ["普通讲课附件3.1已全文核验；校企通道有额外条件，不在本记录范围", "本人往届奖项、学校名额、实验资源与后续通知变更需确认；不表示现在可报名"]
  }
];
